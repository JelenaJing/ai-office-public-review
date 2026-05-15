import { randomUUID } from 'node:crypto'
import type { AppSettings } from './settingsStore'
import { runWritingAssistant } from './paperGenerator'
import type { LocalTaskInfo } from './localTaskService'
import type { KnowledgeDocumentDetail, KnowledgeDocumentVersionDetail, KnowledgeGenerationTrace, KnowledgeTaskConstraints, KnowledgeTaskRecord, KnowledgeTaskStatus, KnowledgeDocumentVersionMeta, KnowledgeDocumentMeta, KnowledgeRemakeTaskParams } from './knowledgeService'
import { KnowledgeService } from './knowledgeService'
import { KnowledgeRetrievalService } from './knowledgeRetrievalService'

interface KnowledgeTaskInfo extends LocalTaskInfo {
  scope: 'knowledge'
  task_type: 'knowledge-remake'
  document_id: string
  source_version_id?: string
  output_version_id?: string
  current_content?: string
}

interface KnowledgeTaskResult {
  task_id: string
  topic: string
  markdown: string
  paper_markdown: string
  current_content: string
  document_id: string
  output_version_id?: string
  output_preview?: string
}

interface KnowledgeTaskRecordInternal {
  info: KnowledgeTaskInfo
  params: KnowledgeRemakeTaskParams
  result?: KnowledgeTaskResult
  pauseDeferred: {
    promise: Promise<void>
    resolve: () => void
  } | null
  stopped: boolean
}

function buildKnowledgeRemakePrompt(documentTitle: string, instruction: string): string {
  return [
    `请对知识库文档“${documentTitle}”进行整篇 remake。`,
    '要求保留原文的总体结构、章节层级、信息组织方式和专业术语体系，但允许在表达、逻辑衔接、内容组织和叙述重点上做全面重写。',
    '如果用户要求改变主题，请保留原文框架风格并改写为新主题下的新版本，不要直接照抄原文句子。',
    `用户要求：${instruction}`,
  ].join('\n')
}

function normalizeConstraints(input?: KnowledgeTaskConstraints | null): KnowledgeTaskConstraints | undefined {
  if (!input) return undefined
  const requiredReferenceDocumentIds = Array.from(new Set((input.requiredReferenceDocumentIds || []).map((item) => String(item || '').trim()).filter(Boolean)))
  const preferredReferenceDocumentIds = Array.from(new Set((input.preferredReferenceDocumentIds || []).map((item) => String(item || '').trim()).filter(Boolean)))
    .filter((item) => !requiredReferenceDocumentIds.includes(item))
  return {
    mode: input.mode === 'selected-only' || input.mode === 'selected-first' || input.mode === 'auto' ? input.mode : 'selected-first',
    templateDocumentId: String(input.templateDocumentId || '').trim() || undefined,
    requiredReferenceDocumentIds,
    preferredReferenceDocumentIds,
    allowAutoRetrieval: input.allowAutoRetrieval !== false,
    autoRetrievalLimit: Math.max(1, Math.min(12, Number(input.autoRetrievalLimit || 5))),
    templateInheritance: {
      structure: input.templateInheritance?.structure !== false,
      tone: input.templateInheritance?.tone !== false,
      terminology: input.templateInheritance?.terminology !== false,
    },
  }
}

function normalizeKnowledgeSelection(documentId: string, params: KnowledgeRemakeTaskParams): { templateDocumentId?: string; referenceDocumentIds: string[] } {
  const normalizedDocumentId = String(documentId || '').trim()
  const constraints = normalizeConstraints(params.constraints)
  const templateDocumentId = String(params.templateDocumentId || constraints?.templateDocumentId || '').trim() || undefined
  const normalizedTemplateDocumentId = templateDocumentId && templateDocumentId !== normalizedDocumentId
    ? templateDocumentId
    : undefined
  const referenceDocumentIds = Array.from(new Set([
    ...(params.referenceDocumentIds || []),
    ...(constraints?.requiredReferenceDocumentIds || []),
    ...(constraints?.preferredReferenceDocumentIds || []),
  ].map((item) => String(item || '').trim()).filter(Boolean)))
    .filter((item) => item !== normalizedDocumentId && item !== normalizedTemplateDocumentId)
  return {
    templateDocumentId: normalizedTemplateDocumentId,
    referenceDocumentIds,
  }
}

function resolveTaskConstraints(documentId: string, params: KnowledgeRemakeTaskParams): KnowledgeTaskConstraints {
  const normalized = normalizeConstraints(params.constraints)
  const selection = normalizeKnowledgeSelection(documentId, params)
  const requiredReferenceDocumentIds = normalized
    ? Array.from(new Set([
      ...(normalized.requiredReferenceDocumentIds || []),
      ...(params.referenceDocumentIds || []),
    ].map((item) => String(item || '').trim()).filter(Boolean)))
      .filter((item) => item !== documentId && item !== selection.templateDocumentId)
    : selection.referenceDocumentIds
  const preferredReferenceDocumentIds = normalized
    ? Array.from(new Set(normalized.preferredReferenceDocumentIds.map((item) => String(item || '').trim()).filter(Boolean)))
        .filter((item) => item !== documentId && item !== selection.templateDocumentId && !requiredReferenceDocumentIds.includes(item))
    : []

  return {
    mode: normalized?.mode || (selection.templateDocumentId || requiredReferenceDocumentIds.length ? 'selected-first' : 'auto'),
    templateDocumentId: selection.templateDocumentId,
    requiredReferenceDocumentIds,
    preferredReferenceDocumentIds,
    allowAutoRetrieval: normalized ? normalized.allowAutoRetrieval : true,
    autoRetrievalLimit: normalized?.autoRetrievalLimit || 5,
    templateInheritance: normalized?.templateInheritance || {
      structure: true,
      tone: true,
      terminology: true,
    },
  }
}

function buildKnowledgeSourceDocumentIds(documentId: string, params: KnowledgeRemakeTaskParams): string[] {
  const constraints = resolveTaskConstraints(documentId, params)
  return Array.from(new Set([
    documentId,
    constraints.templateDocumentId || '',
    ...constraints.requiredReferenceDocumentIds,
    ...constraints.preferredReferenceDocumentIds,
  ].filter(Boolean)))
}

function extractTemplateOutline(text: string): string[] {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const headingCandidates = lines.filter((line) => {
    if (line.length > 36) return false
    if (/^(第[一二三四五六七八九十百]+[章节部分]|[0-9]{1,2}(\.[0-9]{1,2})*|[一二三四五六七八九十]+[、.])/.test(line)) return true
    if (/^(摘要|引言|背景|概述|方法|研究方法|结果|讨论|结论|建议|实施路径|风险分析|附录|Abstract|Introduction|Background|Method|Methods|Results|Discussion|Conclusion|Recommendations|Appendix)$/i.test(line)) return true
    return false
  })

  if (headingCandidates.length >= 3) return headingCandidates.slice(0, 8)
  return lines.filter((line) => line.length >= 4 && line.length <= 24).slice(0, 6)
}

function nowIso(): string {
  return new Date().toISOString()
}

function previewText(text: string): string {
  return String(text || '').trim().slice(0, 280)
}

export class KnowledgeTaskService {
  private readonly tasks = new Map<string, KnowledgeTaskRecordInternal>()

  constructor(
    private readonly knowledgeService: KnowledgeService,
    private readonly knowledgeRetrievalService: KnowledgeRetrievalService,
    private readonly getSettings: () => Promise<AppSettings>,
    private readonly emitAiEvent?: (payload: Record<string, unknown>) => void,
  ) {}

  async submitRemakeTask(params: KnowledgeRemakeTaskParams): Promise<string> {
    const documentId = String(params.documentId || '').trim()
    const instruction = String(params.instruction || '').trim()
    if (!documentId) throw new Error('知识库文档不能为空')
    if (!instruction) throw new Error('Remake 指令不能为空')

    const detail = await this.knowledgeService.getDocument(documentId)
    if (!detail) {
      throw new Error('未找到对应的知识库文档')
    }
    const constraints = resolveTaskConstraints(documentId, params)
    const normalizedSelection = normalizeKnowledgeSelection(documentId, { ...params, constraints })

    const taskId = `knowledge-${randomUUID()}`
    const timestamp = nowIso()
    const task: KnowledgeTaskRecordInternal = {
      params: {
        ...params,
        documentId,
        instruction,
        title: String(params.title || '').trim() || `${detail.meta.title} remake`,
        templateDocumentId: normalizedSelection.templateDocumentId,
        referenceDocumentIds: normalizedSelection.referenceDocumentIds,
        constraints,
      },
      pauseDeferred: null,
      stopped: false,
      info: {
        scope: 'knowledge',
        task_type: 'knowledge-remake',
        task_id: taskId,
        topic: String(params.title || '').trim() || `${detail.meta.title} remake`,
        status: 'pending',
        created_at: timestamp,
        updated_at: timestamp,
        current_step: 0,
        status_message: '知识库 remake 任务已提交，等待执行...',
        progress_updates: [],
        request_received_time: timestamp,
        document_id: documentId,
        source_version_id: String(params.sourceVersionId || '').trim() || undefined,
      },
    }

    this.tasks.set(taskId, task)
    await this.knowledgeService.saveTaskRecord({
      id: taskId,
      externalTaskId: taskId,
      type: 'document-remake',
      status: 'submitted',
      title: task.info.topic,
      documentId,
      sourceDocumentIds: buildKnowledgeSourceDocumentIds(documentId, task.params),
      templateDocumentId: task.params.templateDocumentId,
      referenceDocumentIds: task.params.referenceDocumentIds,
      constraints: task.params.constraints,
      sourceVersionId: task.info.source_version_id,
      instruction,
    })
    void this.runTask(taskId, detail)
    return taskId
  }

  private async runTask(taskId: string, initialDetail?: KnowledgeDocumentDetail | null): Promise<void> {
    const task = this.tasks.get(taskId)
    if (!task) return

    task.info.status = 'running'
    task.info.updated_at = nowIso()
    task.info.status_message = '正在准备知识库 remake...'
    task.info.progress_updates.push({
      step: 1,
      status_message: task.info.status_message,
      message: task.info.status_message,
      updated_at: task.info.updated_at,
    })
    this.emitAiEvent?.({ scope: 'knowledge', type: 'start', taskId, message: task.info.status_message })

    let generationTrace: KnowledgeGenerationTrace | undefined

    try {
      const detail = initialDetail || await this.knowledgeService.getDocument(task.params.documentId)
      if (!detail) {
        throw new Error('未找到对应的知识库文档')
      }

      const sourceVersion = task.params.sourceVersionId
        ? await this.knowledgeService.getDocumentVersion(detail.meta.id, task.params.sourceVersionId)
        : null
      const sourceText = String(sourceVersion?.text || detail.extractedText || '').trim()
      if (!sourceText) {
        throw new Error('当前知识库文档没有可用于 remake 的文本内容')
      }

      const settings = await this.getSettings()
      const evidenceBundle = await this.buildKnowledgeEvidenceBundle(detail.meta.id, task.params)
      const knowledgeContext = evidenceBundle.context
      generationTrace = evidenceBundle.generationTrace
      let accumulated = ''
      const outputText = await runWritingAssistant(settings, {
        instruction: buildKnowledgeRemakePrompt(detail.meta.title, task.params.instruction),
        documentText: sourceText,
        extraContext: [
          '这是知识库文档级 remake 任务，输出必须是一份完整的新版本正文。',
          knowledgeContext,
        ].filter(Boolean).join('\n\n'),
      }, async (chunk) => {
        const current = this.tasks.get(taskId)
        if (!current || current.stopped) {
          throw new Error('TASK_ABORTED')
        }
        await this.waitIfPaused(current)
        if (current.stopped) {
          throw new Error('TASK_ABORTED')
        }
        accumulated += chunk
        current.info.current_step = 2
        current.info.status = 'running'
        current.info.status_message = '正在生成 remake 新版本...'
        current.info.updated_at = nowIso()
        current.info.current_content = accumulated
        this.emitAiEvent?.({
          scope: 'knowledge',
          type: 'progress',
          taskId,
          step: current.info.current_step,
          message: current.info.status_message,
        })
        this.emitAiEvent?.({
          scope: 'knowledge',
          type: 'content',
          taskId,
          step: current.info.current_step,
          content: chunk,
          contentType: 'body',
          cumulativeMarkdown: accumulated,
        })
      })

      const latest = this.tasks.get(taskId)
      if (!latest || latest.stopped) {
        throw new Error('TASK_ABORTED')
      }

      const versionResult = await this.knowledgeService.createRemakeVersion({
        taskId,
        documentId: detail.meta.id,
        instruction: task.params.instruction,
        content: outputText,
        sourceVersionId: task.params.sourceVersionId,
        title: `${detail.meta.title}（Remake）`,
        templateDocumentId: task.params.templateDocumentId,
        referenceDocumentIds: task.params.referenceDocumentIds,
        constraints: task.params.constraints,
        generationTrace,
      })

      latest.result = {
        task_id: taskId,
        topic: latest.info.topic,
        markdown: outputText,
        paper_markdown: outputText,
        current_content: outputText,
        document_id: detail.meta.id,
        output_version_id: versionResult.version.id,
        output_preview: previewText(outputText),
      }
      latest.info.status = 'completed'
      latest.info.current_step = 3
      latest.info.status_message = '知识库 remake 已完成'
      latest.info.updated_at = nowIso()
      latest.info.completion_time = latest.info.updated_at
      latest.info.output_version_id = versionResult.version.id
      latest.info.current_content = outputText
      this.emitAiEvent?.({ scope: 'knowledge', type: 'done', taskId, result: latest.result })
    } catch (error) {
      const latest = this.tasks.get(taskId)
      if (!latest) return
      latest.info.updated_at = nowIso()
      const message = error instanceof Error ? error.message : String(error)
      if (latest.stopped || message === 'TASK_ABORTED') {
        latest.info.status = 'interrupted'
        latest.info.status_message = '知识库 remake 已停止'
        latest.info.error = '任务被用户停止'
        await this.knowledgeService.saveTaskRecord({
          id: taskId,
          externalTaskId: taskId,
          type: 'document-remake',
          status: 'stopped',
          title: latest.info.topic,
          documentId: latest.info.document_id,
          sourceDocumentIds: buildKnowledgeSourceDocumentIds(latest.info.document_id, latest.params),
          templateDocumentId: latest.params.templateDocumentId,
          referenceDocumentIds: latest.params.referenceDocumentIds,
          constraints: latest.params.constraints,
          generationTrace,
          sourceVersionId: latest.info.source_version_id,
          instruction: latest.params.instruction,
          errorMessage: '任务被用户停止',
        })
        this.emitAiEvent?.({ scope: 'knowledge', type: 'progress', taskId, step: latest.info.current_step, message: latest.info.status_message })
        return
      }

      latest.info.status = 'failed'
      latest.info.status_message = '知识库 remake 失败'
      latest.info.error = message
      await this.knowledgeService.saveTaskRecord({
        id: taskId,
        externalTaskId: taskId,
        type: 'document-remake',
        status: 'failed',
        title: latest.info.topic,
        documentId: latest.info.document_id,
        sourceDocumentIds: buildKnowledgeSourceDocumentIds(latest.info.document_id, latest.params),
        templateDocumentId: latest.params.templateDocumentId,
        referenceDocumentIds: latest.params.referenceDocumentIds,
        constraints: latest.params.constraints,
        generationTrace,
        sourceVersionId: latest.info.source_version_id,
        instruction: latest.params.instruction,
        errorMessage: message,
      })
      this.emitAiEvent?.({ scope: 'knowledge', type: 'progress', taskId, step: latest.info.current_step, message })
    }
  }

  async getTaskStatus(taskId: string): Promise<KnowledgeTaskInfo | null> {
    const record = this.tasks.get(String(taskId || '').trim())
    if (record) return { ...record.info }
    const persisted = (await this.knowledgeService.listTaskRecords(200)).find((item) => item.id === String(taskId || '').trim() || item.externalTaskId === String(taskId || '').trim())
    return persisted ? this.mapPersistedTaskToInfo(persisted) : null
  }

  async getTaskResult(taskId: string): Promise<KnowledgeTaskResult | null> {
    const normalizedTaskId = String(taskId || '').trim()
    const inMemory = this.tasks.get(normalizedTaskId)
    if (inMemory?.result) return inMemory.result

    const persisted = (await this.knowledgeService.listTaskRecords(200)).find((item) => item.id === normalizedTaskId || item.externalTaskId === normalizedTaskId)
    if (!persisted?.outputVersionId || !persisted.documentId) return null
    const version = await this.knowledgeService.getDocumentVersion(persisted.documentId, persisted.outputVersionId)
    if (!version) return null
    return {
      task_id: persisted.id,
      topic: persisted.title,
      markdown: version.text,
      paper_markdown: version.text,
      current_content: version.text,
      document_id: persisted.documentId,
      output_version_id: persisted.outputVersionId,
      output_preview: persisted.outputPreview,
    }
  }

  getActiveTasks(): KnowledgeTaskInfo[] {
    return Array.from(this.tasks.values())
      .map((task) => ({ ...task.info }))
      .filter((task) => task.status === 'pending' || task.status === 'running' || task.status === 'paused')
      .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)))
  }

  async getRecentTasks(limit = 20): Promise<KnowledgeTaskInfo[]> {
    const persisted = await this.knowledgeService.listTaskRecords(Math.max(limit, 20))
    const mappedPersisted = persisted.map((item) => this.mapPersistedTaskToInfo(item))
    const merged = new Map<string, KnowledgeTaskInfo>()
    for (const task of mappedPersisted) merged.set(task.task_id, task)
    for (const task of Array.from(this.tasks.values()).map((item) => ({ ...item.info }))) {
      merged.set(task.task_id, task)
    }
    return Array.from(merged.values())
      .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)))
      .slice(0, limit)
  }

  stopTask(taskId: string): boolean {
    const task = this.tasks.get(String(taskId || '').trim())
    if (!task) return false
    task.pauseDeferred?.resolve()
    task.pauseDeferred = null
    task.stopped = true
    task.info.status = 'interrupted'
    task.info.status_message = '知识库 remake 已停止'
    task.info.error = '任务被用户停止'
    task.info.updated_at = nowIso()
    return true
  }

  pauseTask(taskId: string): boolean {
    const task = this.tasks.get(String(taskId || '').trim())
    if (!task || task.stopped) return false
    if (task.info.status !== 'running' && task.info.status !== 'pending') return false
    if (!task.pauseDeferred) {
      let resolve: () => void = () => undefined
      const promise = new Promise<void>((resume) => {
        resolve = resume
      })
      task.pauseDeferred = { promise, resolve }
    }
    task.info.status = 'paused'
    task.info.status_message = '知识库 remake 已暂停'
    task.info.updated_at = nowIso()
    this.emitAiEvent?.({ scope: 'knowledge', type: 'progress', taskId: task.info.task_id, step: task.info.current_step, message: task.info.status_message })
    return true
  }

  resumeTask(taskId: string): boolean {
    const task = this.tasks.get(String(taskId || '').trim())
    if (!task || task.stopped) return false
    if (task.info.status !== 'paused') return false
    task.pauseDeferred?.resolve()
    task.pauseDeferred = null
    task.info.status = 'running'
    task.info.status_message = '知识库 remake 已继续'
    task.info.updated_at = nowIso()
    this.emitAiEvent?.({ scope: 'knowledge', type: 'progress', taskId: task.info.task_id, step: task.info.current_step, message: task.info.status_message })
    return true
  }

  private async waitIfPaused(task: KnowledgeTaskRecordInternal): Promise<void> {
    while (task.pauseDeferred) {
      task.info.status = 'paused'
      task.info.updated_at = nowIso()
      await task.pauseDeferred.promise
      if (task.stopped) {
        throw new Error('TASK_ABORTED')
      }
      task.info.status = 'running'
      task.info.updated_at = nowIso()
    }
  }

  private async buildKnowledgeEvidenceBundle(documentId: string, params: KnowledgeRemakeTaskParams): Promise<{ context?: string; generationTrace?: KnowledgeGenerationTrace }> {
    const constraints = resolveTaskConstraints(documentId, params)
    const preview = await this.knowledgeRetrievalService.previewTaskContext({
      instruction: params.instruction,
      documentId,
      sourceVersionId: params.sourceVersionId,
      constraints,
    })

    const parts: string[] = []
    if (preview.templateSummary) {
      parts.push([
        '任务级模板继承约束：以下内容只用于继承结构、语气与术语风格，不作为新的事实来源。',
        preview.templateSummary,
      ].join('\n\n'))
    }

    const explicitCitations = preview.citations.filter((item) => item.sourceKind === 'required-reference' || item.sourceKind === 'preferred-reference')
    if (explicitCitations.length) {
      parts.push([
        '任务级显式参考证据：以下片段来自本次明确指定的参考资料，优先级高于自动补充检索。',
        ...explicitCitations.map((item) => `- ${item.documentTitle}｜${item.locatorLabel}\n  ${item.quote}`),
      ].join('\n'))
    }

    const autoCitations = preview.citations.filter((item) => item.sourceKind === 'auto-retrieval')
    if (constraints.allowAutoRetrieval && autoCitations.length) {
      parts.push([
        '任务级自动补充证据：以下片段来自知识库自动检索，仅用于补足显式资料未覆盖的信息。',
        ...autoCitations.map((item) => `- ${item.documentTitle}｜${item.locatorLabel}\n  ${item.quote}`),
      ].join('\n'))
    }

    return {
      context: parts.join('\n\n') || undefined,
      generationTrace: {
        templateDocumentId: constraints.templateDocumentId,
        requiredReferenceDocumentIds: constraints.requiredReferenceDocumentIds,
        preferredReferenceDocumentIds: constraints.preferredReferenceDocumentIds,
        retrievedHits: preview.retrievedHits,
        citations: preview.citations,
        coverage: {
          templateApplied: Boolean(constraints.templateDocumentId && preview.templateSummary),
          explicitReferenceCount: explicitCitations.length,
          autoRetrievedCount: autoCitations.length,
        },
      },
    }
  }

  private mapPersistedTaskToInfo(task: KnowledgeTaskRecord): KnowledgeTaskInfo {
    const status = this.mapStatus(task.status)
    return {
      scope: 'knowledge',
      task_type: 'knowledge-remake',
      task_id: task.id,
      topic: task.title,
      status,
      created_at: task.createdAt,
      updated_at: task.updatedAt,
      current_step: task.outputVersionId ? 3 : status === 'failed' ? 3 : status === 'running' ? 2 : 0,
      status_message: task.errorMessage || (status === 'completed' ? '知识库 remake 已完成' : status === 'failed' ? '知识库 remake 失败' : status === 'paused' ? '知识库 remake 已暂停' : status === 'interrupted' ? '知识库 remake 已停止' : '知识库任务已记录'),
      error: task.errorMessage,
      paper_markdown: task.outputPreview,
      progress_updates: [],
      request_received_time: task.createdAt,
      completion_time: status === 'completed' ? task.updatedAt : undefined,
      document_id: String(task.documentId || '').trim() || task.sourceDocumentIds[0] || '',
      source_version_id: task.sourceVersionId,
      output_version_id: task.outputVersionId,
      current_content: task.outputPreview,
    }
  }

  private mapStatus(status: KnowledgeTaskStatus): KnowledgeTaskInfo['status'] {
    if (status === 'submitted') return 'pending'
    if (status === 'running') return 'running'
    if (status === 'completed') return 'completed'
    if (status === 'failed') return 'failed'
    return 'interrupted'
  }
}
