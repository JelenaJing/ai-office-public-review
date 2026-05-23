export type MinimaxPptxTaskStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface MinimaxPptxTaskResult {
  sessionId: string
  pptxPath: string
  slideCount: number
  previewImages: string[]
  previewStatus: 'pending' | 'ready' | 'unavailable' | 'failed'
  downloadUrl: string
}

export interface MinimaxPptxTask {
  taskId: string
  status: MinimaxPptxTaskStatus
  progress: number
  message: string
  sessionId?: string
  error?: string
  result?: MinimaxPptxTaskResult
  createdAt: string
  updatedAt: string
}

const tasks = new Map<string, MinimaxPptxTask>()

export function createMinimaxPptxTask(taskId: string, message = '任务已排队'): MinimaxPptxTask {
  const now = new Date().toISOString()
  const task: MinimaxPptxTask = {
    taskId,
    status: 'queued',
    progress: 0,
    message,
    createdAt: now,
    updatedAt: now,
  }
  tasks.set(taskId, task)
  return task
}

export function getMinimaxPptxTask(taskId: string): MinimaxPptxTask | null {
  return tasks.get(taskId) ?? null
}

export function updateMinimaxPptxTask(
  taskId: string,
  patch: Partial<Omit<MinimaxPptxTask, 'taskId' | 'createdAt' | 'updatedAt'>>,
): MinimaxPptxTask {
  const current = tasks.get(taskId)
  if (!current) {
    throw new Error(`PPT 任务不存在：${taskId}`)
  }

  const next: MinimaxPptxTask = {
    ...current,
    ...patch,
    progress: Math.max(0, Math.min(100, patch.progress ?? current.progress)),
    updatedAt: new Date().toISOString(),
  }
  tasks.set(taskId, next)
  return next
}
