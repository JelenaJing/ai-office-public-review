import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const localConfigPath = path.join(rootDir, 'build', 'builtin-keys.local.json')

const candidateEnvFiles = [
  path.join(rootDir, '.env.local'),
  path.join(rootDir, '.env'),
  '/data/ywt/Nanobanana/Back/.env',
]

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {}
  }

  const raw = fs.readFileSync(filePath, 'utf-8')
  const lines = raw.split(/\r?\n/)
  const result = {}

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }
    const equalIndex = trimmed.indexOf('=')
    if (equalIndex <= 0) {
      continue
    }
    const key = trimmed.slice(0, equalIndex).trim()
    const value = trimmed.slice(equalIndex + 1).trim()
    result[key] = value
  }

  return result
}

function loadExistingConfig() {
  if (!fs.existsSync(localConfigPath)) {
    return {}
  }

  try {
    return JSON.parse(fs.readFileSync(localConfigPath, 'utf-8'))
  } catch (error) {
    throw new Error(`无法解析 ${localConfigPath}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = String(value || '').trim()
    if (normalized) {
      return normalized
    }
  }
  return ''
}

const existingConfig = loadExistingConfig()
const envMaps = candidateEnvFiles.map((filePath) => parseEnvFile(filePath))

const syncedConfig = {
  qwenApiKey: firstNonEmpty(
    existingConfig.qwenApiKey,
    ...envMaps.map((envMap) => envMap.AI_WRITER_DEFAULT_QWEN_API_KEY),
    ...envMaps.map((envMap) => envMap.QWEN_API_KEY),
    process.env.AI_WRITER_DEFAULT_QWEN_API_KEY,
    process.env.QWEN_API_KEY,
  ),
  deepseekApiKey: firstNonEmpty(
    existingConfig.deepseekApiKey,
    ...envMaps.map((envMap) => envMap.AI_WRITER_DEFAULT_DEEPSEEK_API_KEY),
    ...envMaps.map((envMap) => envMap.DEEPSEEK_API_KEY),
    process.env.AI_WRITER_DEFAULT_DEEPSEEK_API_KEY,
    process.env.DEEPSEEK_API_KEY,
  ),
  nanobananaApiKey: firstNonEmpty(
    existingConfig.nanobananaApiKey,
    ...envMaps.map((envMap) => envMap.AI_WRITER_DEFAULT_NANOBANANA_API_KEY),
    ...envMaps.map((envMap) => envMap.NANOBANANA_API_KEY),
    ...envMaps.map((envMap) => envMap.API_KEY),
    process.env.AI_WRITER_DEFAULT_NANOBANANA_API_KEY,
    process.env.NANOBANANA_API_KEY,
  ),
  cuhkApiKey: firstNonEmpty(
    existingConfig.cuhkApiKey,
    ...envMaps.map((envMap) => envMap.AI_WRITER_DEFAULT_CUHK_API_KEY),
    ...envMaps.map((envMap) => envMap.CUHK_API_KEY),
    process.env.AI_WRITER_DEFAULT_CUHK_API_KEY,
    process.env.CUHK_API_KEY,
  ),
}

fs.writeFileSync(localConfigPath, `${JSON.stringify(syncedConfig, null, 2)}\n`, 'utf-8')
console.log(`已同步内置 Key 配置到 ${localConfigPath}`)