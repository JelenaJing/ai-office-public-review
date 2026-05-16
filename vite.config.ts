import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

type BuiltinKeyResolution = {
  value: string
  source: 'build-config' | 'environment' | 'none'
}

type AiProviderEntry = {
  builtinKeyEnvNames: string[]
  [key: string]: unknown
}

type AiConfig = {
  llm: { active: string; providers: Record<string, AiProviderEntry> }
  image: { active: string; providers: Record<string, AiProviderEntry> }
  [key: string]: unknown
}

const DEFAULT_AI_CONFIG: AiConfig = {
  llm: {
    active: 'cuhk',
    providers: {
      cuhk: {
        builtinKeyEnvNames: [
          'CUHK_API_KEY',
          'AI_WRITER_DEFAULT_CUHK_API_KEY',
        ],
      },
      qwen: {
        builtinKeyEnvNames: [
          'QWEN_API_KEY',
          'AI_WRITER_DEFAULT_QWEN_API_KEY',
        ],
      },
      deepseek: {
        builtinKeyEnvNames: [
          'DEEPSEEK_API_KEY',
          'AI_WRITER_DEFAULT_DEEPSEEK_API_KEY',
        ],
      },
    },
  },
  image: {
    active: 'nanobanana',
    providers: {
      nanobanana: {
        builtinKeyEnvNames: [
          'NANOBANANA_API_KEY',
          'AI_WRITER_DEFAULT_NANOBANANA_API_KEY',
        ],
      },
    },
  },
}

function loadAiConfig(rootDir: string): AiConfig {
  const configPath = path.join(rootDir, 'build', 'ai-config.json')
  if (!fs.existsSync(configPath)) {
    console.warn('[vite] build/ai-config.json not found, using default AI provider config')
    return DEFAULT_AI_CONFIG
  }
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as AiConfig
  } catch (error) {
    throw new Error(`无法解析 build/ai-config.json: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function createRendererManualChunks(id: string): string | undefined {
  const normalizedId = id.replace(/\\/g, '/')
  if (!normalizedId.includes('/node_modules/')) {
    return undefined
  }

  if (
    normalizedId.includes('/react/')
    || normalizedId.includes('/react-dom/')
    || normalizedId.includes('/scheduler/')
  ) {
    return 'vendor-react'
  }

  if (normalizedId.includes('/@tiptap/')) {
    return 'vendor-editor'
  }

  if (
    normalizedId.includes('/styled-components/')
    || normalizedId.includes('/lucide-react/')
  ) {
    return 'vendor-ui'
  }

  if (
    normalizedId.includes('/katex/')
    || normalizedId.includes('/marked/')
    || normalizedId.includes('/turndown/')
    || normalizedId.includes('/mammoth/')
    || normalizedId.includes('/jszip/')
    || normalizedId.includes('/fast-xml-parser/')
    || normalizedId.includes('/html-docx-js/')
  ) {
    return 'vendor-doc'
  }

  return 'vendor-shared'
}

function resolveKeyFromEnv(envNames: string[], env: Record<string, string>): BuiltinKeyResolution {
  for (const name of envNames) {
    const value = String(env[name] || '').trim()
    if (value) {
      return { value, source: 'environment' }
    }
  }
  return { value: '', source: 'none' }
}

function loadBuiltinKeysLocalJson(rootDir: string): Record<string, string> {
  const localConfigPath = path.join(rootDir, 'build', 'builtin-keys.local.json')
  if (!fs.existsSync(localConfigPath)) {
    return {}
  }
  try {
    return JSON.parse(fs.readFileSync(localConfigPath, 'utf-8')) as Record<string, string>
  } catch {
    return {}
  }
}

function resolveKey(
  envNames: string[],
  env: Record<string, string>,
  localConfigJsonKey: string,
  localConfig: Record<string, string>,
): BuiltinKeyResolution {
  const fromEnv = resolveKeyFromEnv(envNames, env)
  if (fromEnv.value) {
    return fromEnv
  }
  const fromLocal = String(localConfig[localConfigJsonKey] || '').trim()
  if (fromLocal) {
    return { value: fromLocal, source: 'build-config' }
  }
  return { value: '', source: 'none' }
}

// Prevent ELECTRON_RUN_AS_NODE from leaking into the spawned Electron process.
// When set (e.g. machine-wide via registry), Electron runs as plain Node.js and
// all browser-process APIs (app, protocol, BrowserWindow…) become undefined.
// Must use delete — setting to '' is not enough (C++ HasVar still returns true).
delete process.env.ELECTRON_RUN_AS_NODE

export default defineConfig(({ mode }) => {
  const rootDir = __dirname
  const env = loadEnv(mode, rootDir, '')
  const aiConfig = loadAiConfig(rootDir)
  const localBuiltinKeys = loadBuiltinKeysLocalJson(rootDir)

  // 从 ai-config.json 取各 provider 的 env 变量名列表，再从 .env / .env.local 里解析 key
  // 同时回落读取 build/builtin-keys.local.json（本地同步的内置 key 配置）
  const llmProviders = aiConfig.llm.providers
  const imgProviders = aiConfig.image.providers
  const cuhkKey = resolveKey(llmProviders.cuhk?.builtinKeyEnvNames ?? [], env, 'cuhkApiKey', localBuiltinKeys)
  const qwenKey = resolveKey(llmProviders.qwen?.builtinKeyEnvNames ?? [], env, 'qwenApiKey', localBuiltinKeys)
  const deepseekKey = resolveKey(llmProviders.deepseek?.builtinKeyEnvNames ?? [], env, 'deepseekApiKey', localBuiltinKeys)
  const nanobananaKey = resolveKey(imgProviders.nanobanana?.builtinKeyEnvNames ?? [], env, 'nanobananaApiKey', localBuiltinKeys)

  return {
    build: {
      rollupOptions: {
        output: {
          manualChunks: createRendererManualChunks,
        },
      },
    },
    plugins: [
      react(),
      electron({
        main: {
          entry: 'electron/main/index.ts',
          vite: {
            define: {
              'process.env.AI_WRITER_DEFAULT_CUHK_API_KEY': JSON.stringify(cuhkKey.value),
              'process.env.CUHK_API_KEY': JSON.stringify(cuhkKey.value),
              'process.env.AI_WRITER_DEFAULT_CUHK_API_KEY_SOURCE': JSON.stringify(cuhkKey.source),
              'process.env.AI_WRITER_DEFAULT_QWEN_API_KEY': JSON.stringify(qwenKey.value),
              'process.env.QWEN_API_KEY': JSON.stringify(qwenKey.value),
              'process.env.AI_WRITER_DEFAULT_QWEN_API_KEY_SOURCE': JSON.stringify(qwenKey.source),
              'process.env.AI_WRITER_DEFAULT_DEEPSEEK_API_KEY': JSON.stringify(deepseekKey.value),
              'process.env.DEEPSEEK_API_KEY': JSON.stringify(deepseekKey.value),
              'process.env.AI_WRITER_DEFAULT_DEEPSEEK_API_KEY_SOURCE': JSON.stringify(deepseekKey.source),
              'process.env.AI_WRITER_DEFAULT_NANOBANANA_API_KEY': JSON.stringify(nanobananaKey.value),
              'process.env.NANOBANANA_API_KEY': JSON.stringify(nanobananaKey.value),
              'process.env.AI_WRITER_DEFAULT_NANOBANANA_API_KEY_SOURCE': JSON.stringify(nanobananaKey.source),
            },
            build: {
              outDir: 'dist-electron/main',
              rollupOptions: {
                external: ['ws'],
              },
            },
          },
        },
        preload: {
          input: path.join(__dirname, 'electron/preload/index.ts'),
          vite: {
            build: {
              outDir: 'dist-electron/preload',
            },
          },
        },
      }),
    ],
  }
})