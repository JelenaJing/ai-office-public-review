import { randomUUID } from 'node:crypto'
import type { AppSettings } from './settingsStore'
import { generatePaperSmart, type PaperGenerationParams, type PaperGenerationResult } from './paperGenerator'
import type { WorkspaceService } from './workspaceService'
import { extractPaperTextFromOoxmlSnapshot, serializeEmbeddedBlocksToMarkdown } from '../../../src/engines/documentEngine/embeddedPaperDocument'

export interface LocalTaskInfo {
  task_id: string
  topic: string
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'interrupted'
  created_at: string
  updated_at: string
  current_step: number
  status_message: string
  error?: string
  current_structured_blocks?: unknown[]
  current_ooxml_snapshot?: Record<string, unknown>
  paper_markdown?: string
  progress_updates: Array<{ step: number; status_message: string; message?: string; updated_at: string }>
  request_received_time: string
  completion_time?: string
  paper_type?: string
  language?: string
}

interface InternalTaskInfo extends LocalTaskInfo {
  current_content?: string
}

interface TaskRecord {
  info: InternalTaskInfo
  params: PaperGenerationParams
  result?: PaperGenerationResult
  abortController: AbortController
  pauseDeferred: {
    promise: Promise<void>
    resolve: () => void
  } | null
}

type CompatTaskResult = PaperGenerationResult & {
  paper_markdown: string
  structured_blocks: PaperGenerationResult['structuredBlocks']
  ooxml_snapshot?: Record<string, unknown>
  reference_list: PaperGenerationResult['references']
  figures: Array<{
    url: string
    image_url: string
    path: string
    caption: string
    markdown: string
    filename?: string
  }>
}

export class LocalTaskService {
  constructor(
    private readonly workspaceService?: WorkspaceService,
    private readonly emitAiEvent?: (payload: Record<string, unknown>) => void,
  ) {}

  private readonly tasks = new Map<string, TaskRecord>()

  private buildCompatTaskInfo(record: TaskRecord): LocalTaskInfo {
    const info = record.info
    const structuredBlocks = Array.isArray(info.current_structured_blocks) ? info.current_structured_blocks : []
    const snapshotText = extractPaperTextFromOoxmlSnapshot(info.current_ooxml_snapshot)
    const streamingText = String(info.current_content || '').trim()
    const derivedMarkdown = structuredBlocks.length > 0
      ? serializeEmbeddedBlocksToMarkdown(structuredBlocks as Parameters<typeof serializeEmbeddedBlocksToMarkdown>[0])
      : snapshotText || streamingText

    return {
      ...info,
      current_structured_blocks: structuredBlocks.length > 0 ? structuredBlocks : undefined,
      current_ooxml_snapshot: info.current_ooxml_snapshot,
      paper_markdown: derivedMarkdown || undefined,
    }
  }

  private buildCompatTaskResult(record: TaskRecord): CompatTaskResult | null {
    if (!record.result) {
      return null
    }

    const structuredBlocks = Array.isArray(record.result.structuredBlocks)
      ? record.result.structuredBlocks
      : []
    const snapshotText = extractPaperTextFromOoxmlSnapshot(record.result.ooxmlSnapshot)
    const derivedMarkdown = structuredBlocks.length > 0
      ? serializeEmbeddedBlocksToMarkdown(structuredBlocks)
      : snapshotText || record.result.markdown

    return {
      ...record.result,
      markdown: derivedMarkdown,
      paper_markdown: derivedMarkdown,
      structuredBlocks,
      structured_blocks: structuredBlocks,
      ooxml_snapshot: record.result.ooxmlSnapshot,
      references: Array.isArray(record.result.references) ? record.result.references : [],
      reference_list: Array.isArray(record.result.references) ? record.result.references : [],
      images: Array.isArray(record.result.images) ? record.result.images : [],
      figures: Array.isArray(record.result.images)
        ? record.result.images.map((item) => ({
            url: item.url || item.path,
            image_url: item.url || item.path,
            path: item.path,
            caption: item.caption || (item as { section?: string }).section || '',
            markdown: item.markdown || (item.url || item.path
              ? `![${item.caption || (item as { section?: string }).section || 'figure'}](${item.url || item.path})`
              : ''),
            filename: String(item.path || item.url || '').split(/[\\/]/).pop(),
          }))
        : [],
    }
  }

  async submitTask(settings: AppSettings, outputDir: string, params: PaperGenerationParams): Promise<string> {
    const taskId = randomUUID()
    const now = new Date().toISOString()
    const task: TaskRecord = {
      params,
      abortController: new AbortController(),
      pauseDeferred: null,
      info: {
        task_id: taskId,
        topic: params.topic,
        status: 'pending',
        created_at: now,
        updated_at: now,
        current_step: 0,
        status_message: '已收到您的请求，正在准备生成内容...',
        progress_updates: [],
        request_received_time: now,
        paper_type: params.paperType,
        language: params.language,
      },
    }

    this.tasks.set(taskId, task)
    void this.runTask(taskId, settings, outputDir)
    return taskId
  }

  private async runTask(taskId: string, settings: AppSettings, outputDir: string): Promise<void> {
    const task = this.tasks.get(taskId)
    if (!task) return

    task.info.status = 'running'
    task.info.updated_at = new Date().toISOString()

    try {
      // 统一走 NFTCORE 主线生成。
      const result = await generatePaperSmart(settings, outputDir, task.params, async (event) => {
        const current = this.tasks.get(taskId)
        if (!current || current.abortController.signal.aborted) {
          throw new Error('TASK_ABORTED')
        }

        await this.waitIfPaused(current)
        if (current.abortController.signal.aborted) {
          throw new Error('TASK_ABORTED')
        }

        current.info.current_step = event.step
        current.info.status_message = event.message
        current.info.updated_at = new Date().toISOString()
        const lastUpdate = current.info.progress_updates[current.info.progress_updates.length - 1]
        if (!lastUpdate || lastUpdate.step !== event.step || lastUpdate.status_message !== event.message) {
          current.info.progress_updates.push({
            step: event.step,
            status_message: event.message,
            message: event.message,
            updated_at: current.info.updated_at,
          })
        }

        const ev = event as unknown as Record<string, unknown>
        const contentType = (typeof ev.contentType === 'string' ? ev.contentType : undefined)
          ?? (typeof ev.content_type === 'string' ? ev.content_type : undefined)
        const cumulativeMarkdown = (typeof ev.cumulativeMarkdown === 'string' ? ev.cumulativeMarkdown : undefined)
          ?? (typeof ev.cumulative_markdown === 'string' ? ev.cumulative_markdown : undefined)
        const structuredBlocksNorm = Array.isArray(ev.structuredBlocks)
          ? ev.structuredBlocks
          : Array.isArray(ev.structured_blocks)
            ? ev.structured_blocks
            : []

        const shouldWriteBodyContent = contentType === 'body' || contentType === 'final'

        if (structuredBlocksNorm.length > 0) {
          current.info.current_structured_blocks = structuredBlocksNorm
          current.info.current_content = undefined
        } else if (cumulativeMarkdown) {
          current.info.current_content = cumulativeMarkdown
        } else if (event.content && shouldWriteBodyContent) {
          current.info.current_content = `${current.info.current_content ?? ''}${event.content}`
        }

        this.emitAiEvent?.({
          scope: 'paper',
          type: 'progress',
          taskId,
          step: event.step,
          message: event.message,
          eventType: event.eventType,
          referenceAction: event.referenceAction,
          references: event.references,
          image: event.image,
          paragraphIndex: event.paragraphIndex,
          citationNumber: event.citationNumber,
          citation: event.citation,
          sentenceText: event.sentenceText,
          updatedParagraph: event.updatedParagraph,
        })
        if ((event.content && shouldWriteBodyContent) || cumulativeMarkdown || structuredBlocksNorm.length > 0) {
          this.emitAiEvent?.({
            scope: 'paper',
            type: 'content',
            taskId,
            step: event.step,
            content: event.content,
            contentType: contentType,
            cumulativeMarkdown: structuredBlocksNorm.length > 0 ? undefined : cumulativeMarkdown,
            structuredBlocks: structuredBlocksNorm.length > 0 ? structuredBlocksNorm : undefined,
            eventType: event.eventType,
            referenceAction: event.referenceAction,
            references: event.references,
            image: event.image,
            paragraphIndex: event.paragraphIndex,
            citationNumber: event.citationNumber,
            citation: event.citation,
            sentenceText: event.sentenceText,
            updatedParagraph: event.updatedParagraph,
          })
        }

        const workspacePath = String((current.params as PaperGenerationParams & { workspacePath?: string }).workspacePath || '').trim()
        if (workspacePath && this.workspaceService && Array.isArray(event.references) && event.references.length > 0) {
          // Only saveReferences — appendReferences would be a redundant second write to the same file.
          void this.workspaceService.saveReferences(workspacePath, event.references)
        }
      })

      const latest = this.tasks.get(taskId)
      if (!latest) return
      latest.result = result
      latest.info.status = 'completed'
      latest.info.current_structured_blocks = result.structuredBlocks
      latest.info.current_ooxml_snapshot = result.ooxmlSnapshot
      latest.info.current_content = result.ooxmlSnapshot || result.structuredBlocks.length > 0 ? undefined : result.markdown
      latest.info.updated_at = new Date().toISOString()
      latest.info.completion_time = latest.info.updated_at
      latest.info.status_message = '生成完成'
      this.emitAiEvent?.({ scope: 'paper', type: 'done', taskId, result })
    } catch (error) {
      const latest = this.tasks.get(taskId)
      if (!latest) return
      latest.info.updated_at = new Date().toISOString()

      if (latest.abortController.signal.aborted || (error instanceof Error && error.message === 'TASK_ABORTED')) {
        latest.info.status = 'interrupted'
        latest.info.status_message = '任务已停止'
        latest.info.error = '任务被用户停止'
        this.emitAiEvent?.({ scope: 'paper', type: 'progress', taskId, step: latest.info.current_step, message: latest.info.status_message })
        return
      }

      latest.info.status = 'failed'
      latest.info.status_message = '生成失败'
      latest.info.error = error instanceof Error ? error.message : String(error)
      this.emitAiEvent?.({ scope: 'paper', type: 'progress', taskId, step: latest.info.current_step, message: latest.info.error || latest.info.status_message })
    }
  }

  getTaskStatus(taskId: string): LocalTaskInfo | null {
    const record = this.tasks.get(taskId)
    return record ? this.buildCompatTaskInfo(record) : null
  }

  getTaskResult(taskId: string): CompatTaskResult | null {
    const record = this.tasks.get(taskId)
    return record ? this.buildCompatTaskResult(record) : null
  }

  getActiveTasks(): LocalTaskInfo[] {
    return Array.from(this.tasks.values())
      .map((task) => this.buildCompatTaskInfo(task))
      .filter((task) => task.status === 'pending' || task.status === 'running' || task.status === 'paused')
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
  }

  getRecentTasks(limit = 20): LocalTaskInfo[] {
    return Array.from(this.tasks.values())
      .map((task) => this.buildCompatTaskInfo(task))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, limit)
  }

  stopTask(taskId: string): boolean {
    const task = this.tasks.get(taskId)
    if (!task) return false
    task.pauseDeferred?.resolve()
    task.pauseDeferred = null
    task.abortController.abort()
    task.info.status = 'interrupted'
    task.info.status_message = '任务已停止'
    task.info.error = '任务被用户停止'
    task.info.updated_at = new Date().toISOString()
    return true
  }

  pauseTask(taskId: string): boolean {
    const task = this.tasks.get(taskId)
    if (!task) return false
    if (task.abortController.signal.aborted) return false
    if (task.info.status !== 'running' && task.info.status !== 'pending') return false
    if (!task.pauseDeferred) {
      let resolve: () => void = () => undefined
      const promise = new Promise<void>((resume) => {
        resolve = resume
      })
      task.pauseDeferred = { promise, resolve }
    }
    task.info.status = 'paused'
    task.info.status_message = '任务已暂停'
    task.info.updated_at = new Date().toISOString()
    this.emitAiEvent?.({ scope: 'paper', type: 'progress', taskId, step: task.info.current_step, message: task.info.status_message })
    return true
  }

  resumeTask(taskId: string): boolean {
    const task = this.tasks.get(taskId)
    if (!task) return false
    if (task.abortController.signal.aborted) return false
    if (task.info.status !== 'paused') return false
    task.pauseDeferred?.resolve()
    task.pauseDeferred = null
    task.info.status = 'running'
    task.info.status_message = '任务已继续'
    task.info.updated_at = new Date().toISOString()
    this.emitAiEvent?.({ scope: 'paper', type: 'progress', taskId, step: task.info.current_step, message: task.info.status_message })
    return true
  }

  private async waitIfPaused(task: TaskRecord): Promise<void> {
    while (task.pauseDeferred) {
      task.info.status = 'paused'
      task.info.updated_at = new Date().toISOString()
      await task.pauseDeferred.promise
      if (task.abortController.signal.aborted) {
        throw new Error('TASK_ABORTED')
      }
      task.info.status = 'running'
      task.info.updated_at = new Date().toISOString()
    }
  }
}