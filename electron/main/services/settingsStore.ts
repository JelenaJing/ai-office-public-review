import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  ACTIVE_IMAGE_PROVIDER,
  ACTIVE_LLM_PROVIDER,
  getImageProviderPreset,
  getLlmProviderPreset,
  type BuiltinKeySource,
  type ImageProvider,
  type LlmProvider,
} from '../../../src/shared/ai/providerCatalog'

export type { BuiltinKeySource, ImageProvider, LlmProvider } from '../../../src/shared/ai/providerCatalog'

type LocalEnvRecord = Record<string, string>

type LocalBuiltinKeyConfig = {
  qwenApiKey?: string
  deepseekApiKey?: string
  nanobananaApiKey?: string
  cuhkApiKey?: string
}

function firstNonEmpty(...values: Array<unknown>): string {
  for (const value of values) {
    const normalized = String(value || '').trim()
    if (normalized) {
      return normalized
    }
  }
  return ''
}

function parseDotenv(raw: string): LocalEnvRecord {
  const result: LocalEnvRecord = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }
    const pivot = trimmed.indexOf('=')
    if (pivot <= 0) {
      continue
    }
    const key = trimmed.slice(0, pivot).trim()
    let value = trimmed.slice(pivot + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    result[key] = value
  }
  return result
}

function readLocalEnvFiles(): LocalEnvRecord {
  const projectRoot = path.resolve(__dirname, '../../..')
  const candidates = [
    path.join(projectRoot, '.env'),
    path.join(projectRoot, '.env.local'),
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), '.env.local'),
  ]
  const result: LocalEnvRecord = {}
  for (const filePath of new Set(candidates)) {
    if (!fs.existsSync(filePath)) {
      continue
    }
    Object.assign(result, parseDotenv(fs.readFileSync(filePath, 'utf-8')))
  }
  return result
}

function readLocalBuiltinKeyConfig(): LocalBuiltinKeyConfig {
  const projectRoot = path.resolve(__dirname, '../../..')
  const candidates = [
    path.join(projectRoot, 'build', 'builtin-keys.local.json'),
    path.join(process.cwd(), 'build', 'builtin-keys.local.json'),
  ]

  for (const filePath of new Set(candidates)) {
    if (!fs.existsSync(filePath)) {
      continue
    }
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as LocalBuiltinKeyConfig
    } catch {
      continue
    }
  }

  return {}
}

const LOCAL_ENV_VALUES = readLocalEnvFiles()
const LOCAL_BUILTIN_KEY_CONFIG = readLocalBuiltinKeyConfig()
const PACKAGED_BUILTIN_KEY_CONFIG: LocalBuiltinKeyConfig = {
  qwenApiKey: firstNonEmpty(process.env.AI_WRITER_DEFAULT_QWEN_API_KEY, process.env.QWEN_API_KEY),
  deepseekApiKey: firstNonEmpty(process.env.AI_WRITER_DEFAULT_DEEPSEEK_API_KEY, process.env.DEEPSEEK_API_KEY),
  nanobananaApiKey: firstNonEmpty(process.env.AI_WRITER_DEFAULT_NANOBANANA_API_KEY, process.env.NANOBANANA_API_KEY),
  cuhkApiKey: firstNonEmpty(process.env.AI_WRITER_DEFAULT_CUHK_API_KEY, process.env.CUHK_API_KEY),
}

function resolveBuiltinKeyValue(envNames: string[], buildConfigKey?: keyof LocalBuiltinKeyConfig): string {
  return firstNonEmpty(
    buildConfigKey ? PACKAGED_BUILTIN_KEY_CONFIG[buildConfigKey] : '',
    ...envNames.map((name) => process.env[name]),
    ...envNames.map((name) => LOCAL_ENV_VALUES[name]),
    buildConfigKey ? LOCAL_BUILTIN_KEY_CONFIG[buildConfigKey] : '',
  )
}

function resolveBuiltinKeySourceValue(
  explicitSource: unknown,
  keyValue: string,
  buildConfigKey?: keyof LocalBuiltinKeyConfig,
): BuiltinKeySource {
  const normalizedSource = normalizeBuiltinKeySource(explicitSource)
  if (normalizedSource !== 'none') {
    return normalizedSource
  }
  if (!keyValue) {
    return 'none'
  }
  const buildConfigValue = buildConfigKey ? String(LOCAL_BUILTIN_KEY_CONFIG[buildConfigKey] || '').trim() : ''
  if (buildConfigValue && buildConfigValue === keyValue) {
    return 'build-config'
  }
  return 'environment'
}

const BUILTIN_LLM_KEYS: Partial<Record<LlmProvider, string>> = {
  cuhk: resolveBuiltinKeyValue(['AI_WRITER_DEFAULT_CUHK_API_KEY', 'CUHK_API_KEY'], 'cuhkApiKey'),
  qwen: resolveBuiltinKeyValue(['AI_WRITER_DEFAULT_QWEN_API_KEY', 'QWEN_API_KEY'], 'qwenApiKey'),
  deepseek: resolveBuiltinKeyValue(['AI_WRITER_DEFAULT_DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY'], 'deepseekApiKey'),
}

const BUILTIN_LLM_KEY_SOURCES: Partial<Record<LlmProvider, BuiltinKeySource>> = {
  cuhk: resolveBuiltinKeySourceValue(
    process.env.AI_WRITER_DEFAULT_CUHK_API_KEY_SOURCE,
    BUILTIN_LLM_KEYS.cuhk || '',
    'cuhkApiKey',
  ),
  qwen: resolveBuiltinKeySourceValue(
    process.env.AI_WRITER_DEFAULT_QWEN_API_KEY_SOURCE,
    BUILTIN_LLM_KEYS.qwen || '',
    'qwenApiKey',
  ),
  deepseek: resolveBuiltinKeySourceValue(
    process.env.AI_WRITER_DEFAULT_DEEPSEEK_API_KEY_SOURCE,
    BUILTIN_LLM_KEYS.deepseek || '',
    'deepseekApiKey',
  ),
}

const BUILTIN_IMAGE_KEYS: Partial<Record<ImageProvider, string>> = {
  nanobanana: resolveBuiltinKeyValue(
    ['AI_WRITER_DEFAULT_NANOBANANA_API_KEY', 'NANOBANANA_API_KEY'],
    'nanobananaApiKey',
  ),
}

const BUILTIN_IMAGE_KEY_SOURCES: Partial<Record<ImageProvider, BuiltinKeySource>> = {
  nanobanana: resolveBuiltinKeySourceValue(
    process.env.AI_WRITER_DEFAULT_NANOBANANA_API_KEY_SOURCE,
    BUILTIN_IMAGE_KEYS.nanobanana || '',
    'nanobananaApiKey',
  ),
}

interface PersistedAppSettings {
  llm: {
    provider: LlmProvider
    apiKey: string
    useBuiltinKey: boolean
    model: string
    baseUrl: string
  }
  image: {
    provider: ImageProvider
    apiKey: string
    useBuiltinKey: boolean
    model: string
    endpoint: string
  }
  defaults: AppSettings['defaults']
}

export interface AppSettings {
  llm: {
    provider: LlmProvider
    apiKey: string
    useBuiltinKey: boolean
    builtinKeyAvailable: boolean
    builtinKeySource: BuiltinKeySource
    model: string
    baseUrl: string
  }
  image: {
    provider: ImageProvider
    apiKey: string
    useBuiltinKey: boolean
    builtinKeyAvailable: boolean
    builtinKeySource: BuiltinKeySource
    model: string
    endpoint: string
  }
  defaults: {
    language: 'zh' | 'en'
    paperType: 'review' | 'research' | 'thesis_research'
    noImageMode: boolean
    yearFrom: string
    yearTo: string
    extraContext: string
    continueGoal: string
    targetWords: number
    rewriteRequirements: string
    referenceTopic: string
    referenceYearFrom: string
    referenceYearTo: string
    referenceCount: number
    referenceSoftFloorPercent: number
    referenceCandidatePoolSize: number
    referenceAnalysisWindow: number
    livePreview: boolean
    imageAspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | 'auto'
  }
}

const DEFAULT_LLM_PROVIDER = getLlmProviderPreset(ACTIVE_LLM_PROVIDER)
const LEGACY_DEFAULT_LLM_PROVIDER = getLlmProviderPreset('deepseek')
const DEFAULT_IMAGE_PROVIDER = getImageProviderPreset(ACTIVE_IMAGE_PROVIDER)
const LEGACY_QWEN_DEFAULT_MODEL = 'qwen3.6-plus'

export const defaultSettings: AppSettings = {
  llm: {
    provider: DEFAULT_LLM_PROVIDER.id,
    apiKey: '',
    useBuiltinKey: true,
    builtinKeyAvailable: true,
    builtinKeySource: 'none',
    model: DEFAULT_LLM_PROVIDER.defaultModel,
    baseUrl: DEFAULT_LLM_PROVIDER.defaultBaseUrl,
  },
  image: {
    provider: DEFAULT_IMAGE_PROVIDER.id,
    apiKey: '',
    useBuiltinKey: true,
    builtinKeyAvailable: true,
    builtinKeySource: 'none',
    model: DEFAULT_IMAGE_PROVIDER.defaultModel,
    endpoint: DEFAULT_IMAGE_PROVIDER.defaultEndpoint,
  },
  defaults: {
    language: 'zh',
    paperType: 'review',
    noImageMode: false,
    yearFrom: '2021',
    yearTo: new Date().getFullYear().toString(),
    extraContext: '',
    continueGoal: '保持学术风格自然续写',
    targetWords: 500,
    rewriteRequirements: '保持原意，增强学术表达与论证严谨性',
    referenceTopic: '',
    referenceYearFrom: '',
    referenceYearTo: '',
    referenceCount: 36,
    referenceSoftFloorPercent: 80,
    referenceCandidatePoolSize: 500,
    referenceAnalysisWindow: 40,
    livePreview: true,
    imageAspectRatio: '16:9',
  },
}

function shouldMigrateLegacyDeepseekSettings(input?: Partial<AppSettings>): boolean {
  const llm = input?.llm
  if (!llm || llm.provider !== 'deepseek') {
    return false
  }

  const useBuiltinKey = typeof llm.useBuiltinKey === 'boolean' ? llm.useBuiltinKey : defaultSettings.llm.useBuiltinKey
  const apiKey = String(llm.apiKey ?? '').trim()
  const model = String(llm.model ?? '').trim()
  const baseUrl = String(llm.baseUrl ?? '').trim()
  const deepseekBuiltinAvailable = llmBuiltinAvailable('deepseek')
  const hasUsableKey = useBuiltinKey ? deepseekBuiltinAvailable : apiKey.length > 0
  if (hasUsableKey) {
    return false
  }

  const matchesLegacyDefaults = (!model || model === LEGACY_DEFAULT_LLM_PROVIDER.defaultModel)
    && (!baseUrl || baseUrl === LEGACY_DEFAULT_LLM_PROVIDER.defaultBaseUrl)
  return matchesLegacyDefaults
}

function shouldMigrateLegacyQwenDefaults(input?: Partial<AppSettings>): boolean {
  const llm = input?.llm
  if (!llm || llm.provider !== 'qwen') {
    return false
  }

  const model = String(llm.model ?? '').trim()
  const baseUrl = String(llm.baseUrl ?? '').trim()
  const qwenPreset = getLlmProviderPreset('qwen')

  // Only migrate legacy bundled default values; keep user-customized qwen models untouched.
  const isLegacyModel = model === LEGACY_QWEN_DEFAULT_MODEL
  const keepsDefaultEndpoint = !baseUrl || baseUrl === qwenPreset.defaultBaseUrl
  const targetModelChanged = qwenPreset.defaultModel !== LEGACY_QWEN_DEFAULT_MODEL
  return isLegacyModel && keepsDefaultEndpoint && targetModelChanged
}

function migratePersistedSettings(input?: Partial<AppSettings>): Partial<AppSettings> | undefined {
  if (!input) {
    return input
  }

  if (shouldMigrateLegacyQwenDefaults(input)) {
    return {
      ...input,
      llm: {
        ...input.llm,
        model: getLlmProviderPreset('qwen').defaultModel,
      },
    }
  }

  if (!shouldMigrateLegacyDeepseekSettings(input)) {
    return input
  }

  return {
    ...input,
    llm: {
      ...input.llm,
      provider: defaultSettings.llm.provider,
      apiKey: '',
      useBuiltinKey: defaultSettings.llm.useBuiltinKey,
      builtinKeyAvailable: llmBuiltinAvailable(defaultSettings.llm.provider),
      builtinKeySource: builtinLlmKeySource(defaultSettings.llm.provider),
      model: defaultSettings.llm.model,
      baseUrl: defaultSettings.llm.baseUrl,
    },
  }
}

function fallbackString(value: string, fallback: string): string {
  return value.trim() ? value : fallback
}

function normalizeInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.round(parsed)))
}

function normalizeBuiltinKeySource(value: unknown): BuiltinKeySource {
  return value === 'build-config' || value === 'environment' ? value : 'none'
}

function builtinLlmKey(provider: LlmProvider): string {
  return BUILTIN_LLM_KEYS[provider]?.trim() || ''
}

export function resolveBuiltinLlmApiKey(provider: LlmProvider): string {
  return builtinLlmKey(provider)
}

function builtinLlmKeySource(provider: LlmProvider): BuiltinKeySource {
  if (!builtinLlmKey(provider)) return 'none'
  return BUILTIN_LLM_KEY_SOURCES[provider] || 'none'
}

function builtinImageKey(provider: ImageProvider): string {
  return BUILTIN_IMAGE_KEYS[provider]?.trim() || ''
}

export function resolveBuiltinImageApiKey(provider: ImageProvider): string {
  return builtinImageKey(provider)
}

function builtinImageKeySource(provider: ImageProvider): BuiltinKeySource {
  if (!builtinImageKey(provider)) return 'none'
  return BUILTIN_IMAGE_KEY_SOURCES[provider] || 'none'
}

function llmBuiltinAvailable(provider: LlmProvider): boolean {
  return builtinLlmKey(provider).length > 0
}

function imageBuiltinAvailable(provider: ImageProvider): boolean {
  return builtinImageKey(provider).length > 0
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function toPersistedSettings(input: AppSettings): PersistedAppSettings {
  return {
    llm: {
      provider: input.llm.provider,
      apiKey: input.llm.useBuiltinKey ? '' : String(input.llm.apiKey || '').trim(),
      useBuiltinKey: input.llm.useBuiltinKey,
      model: input.llm.model,
      baseUrl: input.llm.baseUrl,
    },
    image: {
      provider: input.image.provider,
      apiKey: input.image.useBuiltinKey ? '' : String(input.image.apiKey || '').trim(),
      useBuiltinKey: input.image.useBuiltinKey,
      model: input.image.model,
      endpoint: input.image.endpoint,
    },
    defaults: input.defaults,
  }
}

function normalizeSettings(input: AppSettings): AppSettings {
  const canUseBuiltinLlm = llmBuiltinAvailable(input.llm.provider)
  const canUseBuiltinImage = imageBuiltinAvailable(input.image.provider)
  const llmUseBuiltin = normalizeBoolean(input.llm.useBuiltinKey, defaultSettings.llm.useBuiltinKey) && canUseBuiltinLlm
  const imageUseBuiltin = normalizeBoolean(input.image.useBuiltinKey, defaultSettings.image.useBuiltinKey) && canUseBuiltinImage

  return {
    llm: {
      ...input.llm,
      apiKey: String(input.llm.apiKey ?? '').trim(),
      useBuiltinKey: llmUseBuiltin,
      builtinKeyAvailable: canUseBuiltinLlm,
      builtinKeySource: llmUseBuiltin ? builtinLlmKeySource(input.llm.provider) : 'none',
      model: fallbackString(input.llm.model, defaultSettings.llm.model),
      baseUrl: fallbackString(input.llm.baseUrl, defaultSettings.llm.baseUrl),
    },
    image: {
      ...input.image,
      apiKey: String(input.image.apiKey ?? '').trim(),
      useBuiltinKey: imageUseBuiltin,
      builtinKeyAvailable: canUseBuiltinImage,
      builtinKeySource: imageUseBuiltin ? builtinImageKeySource(input.image.provider) : 'none',
      model: fallbackString(input.image.model, defaultSettings.image.model),
      endpoint: fallbackString(input.image.endpoint, defaultSettings.image.endpoint),
    },
    defaults: {
      ...input.defaults,
      noImageMode: normalizeBoolean(input.defaults.noImageMode, defaultSettings.defaults.noImageMode),
      yearFrom: fallbackString(input.defaults.yearFrom, defaultSettings.defaults.yearFrom),
      yearTo: fallbackString(input.defaults.yearTo, defaultSettings.defaults.yearTo),
      continueGoal: fallbackString(input.defaults.continueGoal, defaultSettings.defaults.continueGoal),
      rewriteRequirements: fallbackString(input.defaults.rewriteRequirements, defaultSettings.defaults.rewriteRequirements),
      referenceTopic: String(input.defaults.referenceTopic ?? defaultSettings.defaults.referenceTopic),
      referenceYearFrom: String(input.defaults.referenceYearFrom ?? defaultSettings.defaults.referenceYearFrom),
      referenceYearTo: String(input.defaults.referenceYearTo ?? defaultSettings.defaults.referenceYearTo),
      referenceCount: normalizeInteger(input.defaults.referenceCount, defaultSettings.defaults.referenceCount, 1, 80),
      referenceSoftFloorPercent: normalizeInteger(
        input.defaults.referenceSoftFloorPercent,
        defaultSettings.defaults.referenceSoftFloorPercent,
        0,
        100,
      ),
      referenceCandidatePoolSize: normalizeInteger(
        input.defaults.referenceCandidatePoolSize,
        defaultSettings.defaults.referenceCandidatePoolSize,
        20,
        1000,
      ),
      referenceAnalysisWindow: normalizeInteger(
        input.defaults.referenceAnalysisWindow,
        defaultSettings.defaults.referenceAnalysisWindow,
        5,
        120,
      ),
    },
  }
}

function mergeSettings(base: AppSettings, input?: Partial<AppSettings>): AppSettings {
  const llmProvider = input?.llm?.provider ?? base.llm.provider
  const imageProvider = input?.image?.provider ?? base.image.provider
  const llmUseBuiltin = input?.llm && 'useBuiltinKey' in input.llm
    ? Boolean(input.llm.useBuiltinKey)
    : base.llm.useBuiltinKey
  const imageUseBuiltin = input?.image && 'useBuiltinKey' in input.image
    ? Boolean(input.image.useBuiltinKey)
    : base.image.useBuiltinKey

  return normalizeSettings({
    llm: {
      ...base.llm,
      ...(input?.llm ?? {}),
      provider: llmProvider,
      builtinKeySource: 'none',
      apiKey: llmUseBuiltin
        ? ''
        : (input?.llm && 'apiKey' in input.llm ? String(input.llm.apiKey ?? '') : base.llm.apiKey),
      useBuiltinKey: llmUseBuiltin,
    },
    image: {
      ...base.image,
      ...(input?.image ?? {}),
      provider: imageProvider,
      builtinKeySource: 'none',
      apiKey: imageUseBuiltin
        ? ''
        : (input?.image && 'apiKey' in input.image ? String(input.image.apiKey ?? '') : base.image.apiKey),
      useBuiltinKey: imageUseBuiltin,
    },
    defaults: { ...base.defaults, ...(input?.defaults ?? {}) },
  })
}

export class SettingsStore {
  constructor(private readonly userDataPath: string) {}

  private get settingsPath(): string {
    return path.join(this.userDataPath, 'settings.json')
  }

  async load(): Promise<AppSettings> {
    try {
      const raw = await fsp.readFile(this.settingsPath, 'utf-8')
      return mergeSettings(defaultSettings, migratePersistedSettings(JSON.parse(raw) as Partial<AppSettings>))
    } catch {
      return normalizeSettings(defaultSettings)
    }
  }

  async save(input: Partial<AppSettings>): Promise<AppSettings> {
    const next = mergeSettings(await this.load(), input)
    await fsp.mkdir(this.userDataPath, { recursive: true })
    await fsp.writeFile(this.settingsPath, JSON.stringify(toPersistedSettings(next), null, 2), 'utf-8')
    return this.getPublicSettings(next)
  }

  async getPublicSettings(existing?: AppSettings): Promise<AppSettings> {
    const stored = existing ?? await this.load()
    return {
      ...stored,
      llm: {
        ...stored.llm,
        apiKey: stored.llm.useBuiltinKey ? '' : stored.llm.apiKey,
        builtinKeyAvailable: llmBuiltinAvailable(stored.llm.provider),
        builtinKeySource: stored.llm.useBuiltinKey ? builtinLlmKeySource(stored.llm.provider) : 'none',
      },
      image: {
        ...stored.image,
        apiKey: stored.image.useBuiltinKey ? '' : stored.image.apiKey,
        builtinKeyAvailable: imageBuiltinAvailable(stored.image.provider),
        builtinKeySource: stored.image.useBuiltinKey ? builtinImageKeySource(stored.image.provider) : 'none',
      },
    }
  }

  async resolveEffectiveSettings(): Promise<AppSettings> {
    const stored = await this.load()
    return {
      ...stored,
      llm: {
        ...stored.llm,
        builtinKeySource: stored.llm.useBuiltinKey ? builtinLlmKeySource(stored.llm.provider) : 'none',
        apiKey: stored.llm.useBuiltinKey ? builtinLlmKey(stored.llm.provider) : stored.llm.apiKey,
      },
      image: {
        ...stored.image,
        builtinKeySource: stored.image.useBuiltinKey ? builtinImageKeySource(stored.image.provider) : 'none',
        apiKey: stored.image.useBuiltinKey ? builtinImageKey(stored.image.provider) : stored.image.apiKey,
      },
    }
  }
}