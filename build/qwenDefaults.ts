import fs from 'node:fs'
import path from 'node:path'

export const QWEN_DEFAULT_PROVIDER = 'qwen'
export const QWEN_DEFAULT_MODEL = 'qwen3.6-plus'
export const QWEN_DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

type LocalBuiltinKeyConfig = {
  qwenApiKey?: string
  nanobananaApiKey?: string
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

function parseDotenv(raw: string): Record<string, string> {
  const result: Record<string, string> = {}
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

function readLocalEnv(rootDir: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const filePath of [path.join(rootDir, '.env'), path.join(rootDir, '.env.local')]) {
    if (!fs.existsSync(filePath)) {
      continue
    }
    Object.assign(result, parseDotenv(fs.readFileSync(filePath, 'utf-8')))
  }
  return result
}

function readLocalBuiltinKeyConfig(rootDir: string): LocalBuiltinKeyConfig {
  const configPath = path.join(rootDir, 'build', 'builtin-keys.local.json')
  if (!fs.existsSync(configPath)) {
    return {}
  }

  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as LocalBuiltinKeyConfig
  } catch {
    return {}
  }
}

export function loadLocalBuiltinKeys(rootDir: string): LocalBuiltinKeyConfig {
  const env = readLocalEnv(rootDir)
  const localConfig = readLocalBuiltinKeyConfig(rootDir)
  return {
    qwenApiKey: firstNonEmpty(
      process.env.AI_WRITER_DEFAULT_QWEN_API_KEY,
      process.env.QWEN_API_KEY,
      env.AI_WRITER_DEFAULT_QWEN_API_KEY,
      env.QWEN_API_KEY,
      localConfig.qwenApiKey,
    ),
    nanobananaApiKey: firstNonEmpty(
      process.env.AI_WRITER_DEFAULT_NANOBANANA_API_KEY,
      process.env.NANOBANANA_API_KEY,
      env.AI_WRITER_DEFAULT_NANOBANANA_API_KEY,
      env.NANOBANANA_API_KEY,
      localConfig.nanobananaApiKey,
    ),
  }
}

export function hydrateQwenEnv(rootDir: string): LocalBuiltinKeyConfig {
  const keys = loadLocalBuiltinKeys(rootDir)

  if (keys.qwenApiKey) {
    process.env.AI_WRITER_DEFAULT_QWEN_API_KEY = process.env.AI_WRITER_DEFAULT_QWEN_API_KEY || keys.qwenApiKey
    process.env.QWEN_API_KEY = process.env.QWEN_API_KEY || keys.qwenApiKey
  }
  if (keys.nanobananaApiKey) {
    process.env.AI_WRITER_DEFAULT_NANOBANANA_API_KEY = process.env.AI_WRITER_DEFAULT_NANOBANANA_API_KEY || keys.nanobananaApiKey
    process.env.NANOBANANA_API_KEY = process.env.NANOBANANA_API_KEY || keys.nanobananaApiKey
  }

  process.env.QWEN_MODEL = process.env.QWEN_MODEL || QWEN_DEFAULT_MODEL
  process.env.QWEN_BASE_URL = process.env.QWEN_BASE_URL || QWEN_DEFAULT_BASE_URL

  return keys
}