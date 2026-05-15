import { randomUUID } from 'node:crypto'
import type { AppSettings } from './settingsStore'
import type { LocalTaskInfo } from './localTaskService'
import {
  generateEssay,
  type EssayGenerationParams,
  type EssayTaskResult,
} from './essayGenerator'

export type { EssayGenerationParams, EssayTaskResult } from './essayGenerator'

interface EssayTaskInfo extends LocalTaskInfo {
  scope: 'essay-writing'
  task_type: 'essay-writing'
  normalized_topic?: string
  planned_title?: string
  illustration_style?: EssayTaskResult['illustration_style']
  current_content?: string
}

interface TaskRecord {
  info: EssayTaskInfo
  params: EssayGenerationParams
  result?: EssayTaskResult
  abortController?: AbortController
}

function nowIso(): string {
  return new Date().toISOString()
}

function normalizeOptionalString(value: unknown): string | undefined {
  const normalized = String(value || '').trim()
  return normalized || undefined
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.message === '任务已停止'
}

function buildProgressUpdate(step: number, message: string) {
  return {
    step,
    status_message: message,
    message,
    updated_at: nowIso(),
  }
}

export class EssayTaskService {
  private readonly tasks = new Map<string, TaskRecord>()

  constructor(
    private readonly emitAiEvent?: (payload: Record<string, unknown>) => void,
  ) {}

  async submitTask(settings: AppSettings, params: EssayGenerationParams): Promise<string> {
    const normalizedTopic = String(params.topic || '').trim()
    if (!normalizedTopic) {
      throw new Error('散文主题不能为空')
    }

    const taskId = randomUUID()
    const timestamp = nowIso()
    const task: TaskRecord = {
      params: { ...params, topic: normalizedTopic, scope: 'essay-writing' },
      info: {
        scope: 'essay-writing',
        task_type: 'essay-writing',
        task_id: taskId,
        topic: normalizedTopic,
        status: 'pending',
        created_at: timestamp,
        updated_at: timestamp,
        current_step: 0,
        status_message: '散文任务已提交，正在准备执行...',
        progress_updates: [buildProgressUpdate(0, '散文任务已提交，正在准备执行...')],
        request_received_time: timestamp,
        paper_type: 'essay',
        language: String(params.language || settings.defaults.language || 'zh'),
      },
    }
    this.tasks.set(taskId, task)
    void this.runTask(taskId, settings)
    return taskId
  }

  private updateTaskProgress(task: TaskRecord, step: number, message: string): void {
    task.info.current_step = step
    task.info.status_message = message
    task.info.updated_at = nowIso()
    const latest = task.info.progress_updates[task.info.progress_updates.length - 1]
    if (!latest || latest.step !== step || latest.status_message !== message) {
      task.info.progress_updates.push(buildProgressUpdate(step, message))
    }
  }

  private async runTask(taskId: string, settings: AppSettings): Promise<void> {
    const task = this.tasks.get(taskId)
    if (!task) return

    task.info.status = 'running'
    task.info.updated_at = nowIso()
    task.abortController = new AbortController()

    try {
      const result = await generateEssay(
        settings,
        {
          ...task.params,
          topic: task.info.topic,
          language: task.info.language || 'zh',
          scope: 'essay-writing',
        },
        {
          onProgress: ({ step, message }) => {
            const current = this.tasks.get(taskId)
            if (!current) return
            this.updateTaskProgress(current, step, message)
            this.emitAiEvent?.({
              scope: 'essay-writing',
              type: 'progress',
              taskId,
              step,
              message,
            })
          },
          onContent: ({ step, content, contentType, cumulativeMarkdown, eventType, image }) => {
            const current = this.tasks.get(taskId)
            if (!current) return
            const normalizedMarkdown = String(cumulativeMarkdown || '').trim()
            if (!normalizedMarkdown) return
            current.info.current_content = normalizedMarkdown
            current.info.updated_at = nowIso()
            this.emitAiEvent?.({
              scope: 'essay-writing',
              type: 'content',
              taskId,
              step,
              content,
              contentType,
              cumulativeMarkdown: normalizedMarkdown,
              eventType,
              image,
            })
          },
        },
        task.abortController.signal,
      )

      const latest = this.tasks.get(taskId)
      if (!latest) return
      latest.result = {
        scope: 'essay-writing',
        topic: String(result.topic || latest.info.topic || ''),
        normalized_topic: normalizeOptionalString(result.normalized_topic),
        planned_title: normalizeOptionalString(result.planned_title),
        markdown: String(result.paper_markdown || result.markdown || latest.info.current_content || ''),
        paper_markdown: String(result.paper_markdown || result.markdown || latest.info.current_content || ''),
        images: Array.isArray(result.images) ? result.images : undefined,
        illustration_style: result.illustration_style,
      }
      latest.info.status = 'completed'
      latest.info.normalized_topic = latest.result.normalized_topic
      latest.info.planned_title = latest.result.planned_title
      latest.info.illustration_style = latest.result.illustration_style
      latest.info.current_content = latest.result.paper_markdown
      latest.info.completion_time = nowIso()
      this.updateTaskProgress(latest, Math.max(latest.info.current_step, 4), '散文生成完成')
      this.emitAiEvent?.({ scope: 'essay-writing', type: 'done', taskId, result: latest.result })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const latest = this.tasks.get(taskId)
      if (latest) {
        latest.info.status = latest.info.status === 'interrupted' || isAbortError(error) ? 'interrupted' : 'failed'
        latest.info.error = latest.info.status === 'interrupted' ? '任务被用户停止' : message
        this.updateTaskProgress(latest, latest.info.current_step, latest.info.status === 'interrupted' ? '任务已停止' : '散文生成失败')
        this.emitAiEvent?.({
          scope: 'essay-writing',
          type: 'progress',
          taskId,
          step: latest.info.current_step,
          message: latest.info.error || latest.info.status_message,
        })
      }
    } finally {
      const latest = this.tasks.get(taskId)
      if (latest) {
        latest.abortController = undefined
      }
    }
  }

  getTaskStatus(taskId: string): EssayTaskInfo | null {
    const record = this.tasks.get(taskId)
    if (!record) return null
    return {
      ...record.info,
      paper_markdown: record.info.current_content || undefined,
    }
  }

  getTaskResult(taskId: string): EssayTaskResult | null {
    return this.tasks.get(taskId)?.result || null
  }

  getActiveTasks(): EssayTaskInfo[] {
    return Array.from(this.tasks.values())
      .map((task) => this.getTaskStatus(task.info.task_id))
      .filter((task): task is EssayTaskInfo => Boolean(task))
      .filter((task) => task.status === 'pending' || task.status === 'running')
      .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)))
  }

  getRecentTasks(limit = 20): EssayTaskInfo[] {
    return Array.from(this.tasks.values())
      .map((task) => this.getTaskStatus(task.info.task_id))
      .filter((task): task is EssayTaskInfo => Boolean(task))
      .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))
      .slice(0, limit)
  }

  stopTask(taskId: string): boolean {
    const task = this.tasks.get(taskId)
    if (!task) return false
    task.info.status = 'interrupted'
    task.info.error = '任务被用户停止'
    task.info.updated_at = nowIso()
    task.abortController?.abort()
    this.emitAiEvent?.({ scope: 'essay-writing', type: 'progress', taskId, step: task.info.current_step, message: '任务已停止' })
    return true
  }

  pauseTask(_taskId: string): boolean {
    return false
  }

  resumeTask(_taskId: string): boolean {
    return false
  }
}