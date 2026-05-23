export type MiniMaxPptxTaskStatus = 'queued' | 'running' | 'completed' | 'failed'
export type MiniMaxPptxPreviewStatus = 'pending' | 'ready' | 'unavailable' | 'failed'

export interface MiniMaxPptxTask {
  taskId: string
  status: MiniMaxPptxTaskStatus
  progress: number
  message: string
  sessionId?: string
  error?: string
  result?: {
    sessionId: string
    pptxPath: string
    slideCount: number
    previewImages: string[]
    previewStatus: MiniMaxPptxPreviewStatus
    downloadUrl: string
  }
}

export interface MiniMaxPptxSession {
  id: string
  title: string
  slideCount: number
  previewImages: string[]
  previewStatus: MiniMaxPptxPreviewStatus
  previewMessage?: string
  downloadUrl: string
}

function getStoredUserId(): string | null {
  try {
    const raw = localStorage.getItem('aios_auth_user')
    if (!raw) return null
    const user = JSON.parse(raw) as { id?: string; email?: string }
    return user.id || user.email || null
  } catch {
    return null
  }
}

function apiHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const userId = getStoredUserId()
  if (userId) headers['X-User-Id'] = userId
  return headers
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = typeof payload === 'object' && payload && 'message' in payload
      ? String((payload as { message?: unknown }).message || response.statusText)
      : response.statusText
    throw new Error(message)
  }
  return payload as T
}

export async function startMiniMaxPptxTask(input: {
  prompt: string
  title?: string
  workspacePath?: string
}): Promise<{ success: true; taskId: string; status: 'running' }> {
  const response = await fetch('/api/ppt/decks/start', {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify({
      workspacePath: input.workspacePath,
      prompt: input.prompt,
      title: input.title,
      mode: 'minimax_direct',
    }),
  })
  return readJsonResponse(response)
}

export async function getMiniMaxPptxTask(taskId: string): Promise<MiniMaxPptxTask> {
  const response = await fetch(`/api/ppt/tasks/${encodeURIComponent(taskId)}`)
  const payload = await readJsonResponse<{ success: true; task: MiniMaxPptxTask }>(response)
  return payload.task
}

export async function getMiniMaxPptxSession(sessionId: string): Promise<MiniMaxPptxSession> {
  const response = await fetch(`/api/ppt/sessions/${encodeURIComponent(sessionId)}`)
  const payload = await readJsonResponse<{ success: true; session: MiniMaxPptxSession }>(response)
  return payload.session
}

export function isWebMiniMaxPptxPreferred(): boolean {
  return typeof window !== 'undefined' && !window.electronAPI?.deckBuildFromPrompt
}
