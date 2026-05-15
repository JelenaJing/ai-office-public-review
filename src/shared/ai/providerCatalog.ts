import aiConfig from '../../../build/ai-config.json'

export type LlmProvider = 'cuhk' | 'qwen' | 'openai' | 'deepseek' | 'anthropic' | 'custom'
export type ImageProvider = 'nanobanana' | 'openai-image' | 'custom'
export type BuiltinKeySource = 'build-config' | 'environment' | 'none'

export interface LlmProviderPreset {
  id: LlmProvider
  label: string
  defaultModel: string
  defaultBaseUrl: string
  builtinKeySupported: boolean
  builtinKeyEnvNames: string[]
}

export interface ImageProviderPreset {
  id: ImageProvider
  label: string
  defaultModel: string
  defaultEndpoint: string
  builtinKeySupported: boolean
  builtinKeyEnvNames: string[]
}

const _llm = aiConfig.llm.providers
const _img = aiConfig.image.providers

export const LLM_PROVIDER_PRESETS: Record<LlmProvider, LlmProviderPreset> = {
  cuhk: { id: 'cuhk', ...(_llm as any).cuhk },
  qwen: { id: 'qwen', ..._llm.qwen },
  deepseek: { id: 'deepseek', ..._llm.deepseek },
  openai: { id: 'openai', ..._llm.openai },
  anthropic: { id: 'anthropic', ..._llm.anthropic },
  custom: { id: 'custom', ..._llm.custom },
}

export const IMAGE_PROVIDER_PRESETS: Record<ImageProvider, ImageProviderPreset> = {
  nanobanana: { id: 'nanobanana', ..._img.nanobanana },
  'openai-image': { id: 'openai-image', ..._img['openai-image'] },
  custom: { id: 'custom', ..._img.custom },
}

/** 当前激活的 LLM provider（由 build/ai-config.json 的 llm.active 控制） */
export const ACTIVE_LLM_PROVIDER: LlmProvider = aiConfig.llm.active as LlmProvider

/** 当前激活的 Image provider（由 build/ai-config.json 的 image.active 控制） */
export const ACTIVE_IMAGE_PROVIDER: ImageProvider = aiConfig.image.active as ImageProvider

const PROVIDER_LABELS: Record<string, string> = {
  cuhk: LLM_PROVIDER_PRESETS.cuhk.label,
  qwen: LLM_PROVIDER_PRESETS.qwen.label,
  deepseek: LLM_PROVIDER_PRESETS.deepseek.label,
  openai: LLM_PROVIDER_PRESETS.openai.label,
  anthropic: LLM_PROVIDER_PRESETS.anthropic.label,
  custom: LLM_PROVIDER_PRESETS.custom.label,
  nanobanana: IMAGE_PROVIDER_PRESETS.nanobanana.label,
  'openai-image': IMAGE_PROVIDER_PRESETS['openai-image'].label,
}

export function getLlmProviderPreset(provider: LlmProvider): LlmProviderPreset {
  return LLM_PROVIDER_PRESETS[provider]
}

export function getImageProviderPreset(provider: ImageProvider): ImageProviderPreset {
  return IMAGE_PROVIDER_PRESETS[provider]
}

export function supportsBuiltinLlmProvider(provider: LlmProvider): boolean {
  return getLlmProviderPreset(provider).builtinKeySupported
}

export function supportsBuiltinImageProvider(provider: ImageProvider): boolean {
  return getImageProviderPreset(provider).builtinKeySupported
}

export function formatProviderLabel(provider?: string): string {
  if (!provider) return '未设置'
  return PROVIDER_LABELS[provider] || provider
}

export function formatBuiltinKeySource(source?: BuiltinKeySource): string {
  if (source === 'build-config') return '本地 build 配置'
  if (source === 'environment') return '环境变量 / .env'
  return '未配置'
}

export function resolveLlmEndpoint(provider: LlmProvider, baseUrl: string): string {
  if (provider === 'cuhk') {
    return 'https://ai.cuhk.edu.cn/open/v1/chat/completions'
  }
  if (provider === 'qwen') {
    const trimmed = String(baseUrl || '').trim() || LLM_PROVIDER_PRESETS.qwen.defaultBaseUrl
    if (trimmed.endsWith('/chat/completions')) {
      return trimmed
    }
    return `${trimmed.replace(/\/$/, '')}/chat/completions`
  }
  if (provider === 'openai') {
    return 'https://api.openai.com/v1/chat/completions'
  }
  if (provider === 'deepseek') {
    return 'https://api.deepseek.com/v1/chat/completions'
  }
  if (provider === 'anthropic') {
    return 'https://api.anthropic.com/v1/messages'
  }

  const trimmed = String(baseUrl || '').trim()
  if (!trimmed) return ''
  if (trimmed.endsWith('/chat/completions') || trimmed.endsWith('/messages')) {
    return trimmed
  }
  return `${trimmed.replace(/\/$/, '')}/chat/completions`
}