import { app, net, protocol } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const VOSK_RESOURCE_SCHEME = 'ai-resource'
export const VOSK_RESOURCE_HOST = 'app'
export const VOSK_MODEL_FILE_NAME = 'vosk-model-small-cn-0.3.tar.gz'
export const VOSK_BUNDLED_RELATIVE_PATH = `vosk-models/${VOSK_MODEL_FILE_NAME}`
export const VOSK_BUNDLED_MODEL_URL = `${VOSK_RESOURCE_SCHEME}://${VOSK_RESOURCE_HOST}/${VOSK_BUNDLED_RELATIVE_PATH}`
export const VOSK_REMOTE_MODEL_URL = 'https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-cn-0.3.tar.gz'

export interface VoskModelInfo {
  modelUrl: string
  bundled: boolean
  modelPath: string | null
  relativePath: string
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: VOSK_RESOURCE_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

let registerProtocolPromise: Promise<void> | null = null

function uniquePaths(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => path.normalize(String(value || '').trim())).filter(Boolean)))
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

function getBundledModelCandidatePaths(): string[] {
  return uniquePaths([
    path.join(process.resourcesPath, 'vosk-models', VOSK_MODEL_FILE_NAME),
    path.join(path.dirname(app.getAppPath()), 'vosk-models', VOSK_MODEL_FILE_NAME),
    path.join(app.getAppPath(), 'build', 'vosk-models', VOSK_MODEL_FILE_NAME),
    path.join(process.cwd(), 'build', 'vosk-models', VOSK_MODEL_FILE_NAME),
  ])
}

function normalizeRequestedResourcePath(requestUrl: string): string | null {
  try {
    const parsed = new URL(requestUrl)
    if (parsed.protocol !== `${VOSK_RESOURCE_SCHEME}:`) {
      return null
    }
    if (parsed.hostname !== VOSK_RESOURCE_HOST) {
      return null
    }

    const normalized = path.posix.normalize(parsed.pathname.replace(/^\/+/, ''))
    if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
      return null
    }

    return normalized
  } catch {
    return null
  }
}

export async function resolveBundledVoskModelPath(): Promise<string | null> {
  for (const candidatePath of getBundledModelCandidatePaths()) {
    if (await pathExists(candidatePath)) {
      return candidatePath
    }
  }

  return null
}

export async function getVoskModelInfo(): Promise<VoskModelInfo> {
  const modelPath = await resolveBundledVoskModelPath()
  return {
    modelUrl: modelPath ? VOSK_BUNDLED_MODEL_URL : VOSK_REMOTE_MODEL_URL,
    bundled: Boolean(modelPath),
    modelPath,
    relativePath: VOSK_BUNDLED_RELATIVE_PATH,
  }
}

export async function registerVoskResourceProtocol(): Promise<void> {
  if (registerProtocolPromise) {
    return registerProtocolPromise
  }

  registerProtocolPromise = (async () => {
    if (await protocol.isProtocolHandled(VOSK_RESOURCE_SCHEME)) {
      return
    }

    protocol.handle(VOSK_RESOURCE_SCHEME, async (request) => {
      const requestedPath = normalizeRequestedResourcePath(request.url)
      if (requestedPath !== VOSK_BUNDLED_RELATIVE_PATH) {
        return new Response('Not found', { status: 404 })
      }

      const modelPath = await resolveBundledVoskModelPath()
      if (!modelPath) {
        return new Response('Not found', { status: 404 })
      }

      return net.fetch(pathToFileURL(modelPath).toString())
    })
  })().catch((error) => {
    registerProtocolPromise = null
    throw error
  })

  return registerProtocolPromise
}
