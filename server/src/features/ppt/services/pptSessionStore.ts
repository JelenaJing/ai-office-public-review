import fs from 'node:fs/promises'
import path from 'node:path'

export type PptPreviewStatus = 'pending' | 'ready' | 'unavailable' | 'failed'

export type PptSession = {
  id: string
  userId: string
  title: string
  prompt: string
  pptxPath: string
  previewImages: string[]
  previewStatus?: PptPreviewStatus
  previewMessage?: string
  slideCount: number
  createdAt: string
  updatedAt: string
}

const SERVER_ROOT = path.resolve(__dirname, '../../../..')
export const PPT_SESSIONS_ROOT = path.join(SERVER_ROOT, 'data', 'ppt-sessions')
const SESSION_INDEX_PATH = path.join(PPT_SESSIONS_ROOT, 'sessions.json')

let sessionCache: Map<string, PptSession> | null = null

export function sanitizePathSegment(value: string, fallback = 'default'): string {
  const normalized = String(value || '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return normalized || fallback
}

export function getPptSessionDir(userId: string, sessionId: string): string {
  return path.join(PPT_SESSIONS_ROOT, sanitizePathSegment(userId, 'web-user'), sanitizePathSegment(sessionId, 'session'))
}

export function getPptPreviewDir(userId: string, sessionId: string): string {
  return path.join(getPptSessionDir(userId, sessionId), 'previews')
}

export function getPptPreviewImagePath(userId: string, sessionId: string, fileName: string): string {
  return path.join(getPptPreviewDir(userId, sessionId), fileName)
}

async function loadSessionMap(): Promise<Map<string, PptSession>> {
  if (sessionCache) return sessionCache

  await fs.mkdir(PPT_SESSIONS_ROOT, { recursive: true })
  try {
    const raw = await fs.readFile(SESSION_INDEX_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as PptSession[]
    sessionCache = new Map(parsed.map((session) => [session.id, session]))
  } catch (error) {
    const maybeNodeError = error as NodeJS.ErrnoException
    if (maybeNodeError.code !== 'ENOENT') {
      throw error
    }
    sessionCache = new Map()
  }

  return sessionCache
}

async function persistSessionMap(map: Map<string, PptSession>): Promise<void> {
  await fs.mkdir(PPT_SESSIONS_ROOT, { recursive: true })
  await fs.writeFile(
    SESSION_INDEX_PATH,
    `${JSON.stringify(Array.from(map.values()), null, 2)}\n`,
    'utf-8',
  )
}

export async function savePptSession(session: PptSession): Promise<PptSession> {
  const map = await loadSessionMap()
  map.set(session.id, session)
  await persistSessionMap(map)
  return session
}

export async function getPptSession(sessionId: string): Promise<PptSession | null> {
  const map = await loadSessionMap()
  return map.get(sessionId) ?? null
}

export async function updatePptSession(
  sessionId: string,
  patch: Partial<Omit<PptSession, 'id' | 'createdAt'>>,
): Promise<PptSession> {
  const map = await loadSessionMap()
  const current = map.get(sessionId)
  if (!current) {
    throw new Error(`PPT 会话不存在：${sessionId}`)
  }

  const next: PptSession = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  }
  map.set(sessionId, next)
  await persistSessionMap(map)
  return next
}
