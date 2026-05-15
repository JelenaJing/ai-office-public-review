// vNext freeze: compat task APIs remain the active paper runtime.
// This service can normalize paper outputs, but it is not the document kernel itself.
import type { DocumentArtifact } from '../../../document/core'
import { createPaperSession, toPaperArtifact, type PaperArtifactBoundary, type PaperCommandId, type PaperOutlineSnapshot, type PaperResultFragments } from '../../../document/profiles'
import { buildDocumentSchemaFromText } from '../../../document/schema'
import { extractPaperTextFromOoxmlSnapshot, serializeEmbeddedBlocksToMarkdown } from '../../../engines/documentEngine/embeddedPaperDocument'

function extractStructuredBlocks(payload: Record<string, any> | null | undefined): any[] {
  if (!payload) return []
  if (Array.isArray(payload.structured_blocks)) return payload.structured_blocks
  if (Array.isArray(payload.structuredBlocks)) return payload.structuredBlocks
  return []
}

function normalizeOptionalString(value: unknown): string | undefined {
  const normalized = String(value || '').trim()
  return normalized || undefined
}

function collectStringRefs(...sources: unknown[]): string[] {
  const values: string[] = []
  for (const source of sources) {
    if (Array.isArray(source)) {
      for (const item of source) {
        const normalized = normalizeOptionalString(item)
        if (normalized) values.push(normalized)
      }
      continue
    }
    const normalized = normalizeOptionalString(source)
    if (normalized) values.push(normalized)
  }
  return Array.from(new Set(values))
}

function clonePaperOutline(outline: PaperOutlineSnapshot | null | undefined): PaperOutlineSnapshot | undefined {
  if (!outline) return undefined
  return {
    title: normalizeOptionalString(outline.title),
    sections: Array.isArray(outline.sections) ? outline.sections.map((section) => String(section || '').trim()).filter(Boolean) : [],
  }
}

function extractPaperOutline(markdown: string): string[] {
  const lines = String(markdown || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const headingCandidates = lines.filter((line) => {
    if (line.length > 48) return false
    if (/^#{1,6}\s+/.test(line)) return true
    if (/^(第[一二三四五六七八九十百]+[章节部分]|[0-9]{1,2}(\.[0-9]{1,2})*|[一二三四五六七八九十]+[、.])/.test(line)) return true
    if (/^(摘要|引言|背景|概述|方法|研究方法|结果|讨论|结论|建议|附录|Abstract|Introduction|Background|Method|Methods|Results|Discussion|Conclusion|Recommendations|Appendix)$/i.test(line)) return true
    return false
  })

  if (headingCandidates.length >= 3) {
    return headingCandidates.slice(0, 10).map((line) => line.replace(/^#{1,6}\s+/, '').trim())
  }

  return lines
    .filter((line) => line.length >= 4 && line.length <= 28)
    .slice(0, 8)
}

function deriveCitationSidecarPath(manuscriptPath: string | undefined): string | undefined {
  const normalized = normalizeOptionalString(manuscriptPath)
  if (!normalized) return undefined
  const slashIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  const dotIndex = normalized.lastIndexOf('.')
  if (dotIndex > slashIndex) {
    return `${normalized.slice(0, dotIndex)}.references.json`
  }
  return `${normalized}.references.json`
}

function resolveArtifactBoundary(payload: Record<string, any>): PaperArtifactBoundary {
  if (
    payload.status
    || payload.current_structured_blocks
    || payload.current_ooxml_snapshot
    || payload.current_content
    || payload.result
  ) {
    return 'compat-task'
  }
  return 'compat-result'
}

function resolvePaperCommand(command: string | undefined, boundary: PaperArtifactBoundary): PaperCommandId {
  switch (command) {
    case 'select-topic':
    case 'analyze-topic':
      return 'analyze-topic'
    case 'retrieve-references':
      return 'retrieve-references'
    case 'draft-outline':
    case 'generate-outline':
      return 'generate-outline'
    case 'generate-sections':
    case 'generate-section-draft':
      return 'generate-section-draft'
    case 'generate-body':
      return 'generate-body'
    case 'sync-citation-sidecar':
      return 'sync-citation-sidecar'
    case 'resume-task':
      return 'resume-task'
    default:
      return boundary === 'compat-task' ? 'resume-task' : 'generate-body'
  }
}

function resolvePaperOutline(payload: Record<string, any>, markdown: string, outlineOverride?: PaperOutlineSnapshot): PaperOutlineSnapshot | undefined {
  if (outlineOverride) {
    return clonePaperOutline(outlineOverride)
  }

  const outlineSections = Array.isArray(payload.outline)
    ? payload.outline.map((item: unknown) => String(item || '').trim()).filter(Boolean)
    : []
  const sections = outlineSections.length > 0 ? outlineSections.slice(0, 10) : extractPaperOutline(markdown)
  const title = normalizeOptionalString(payload.title) ?? normalizeOptionalString(payload.paperTitle)

  if (!title && sections.length === 0) {
    return undefined
  }

  return {
    title,
    sections,
  }
}

function buildPaperResultFragments(payload: Record<string, any>): PaperResultFragments {
  const markdown = resolvePaperText(payload)
  const structuredBlocks = Array.isArray(payload.current_structured_blocks)
    ? payload.current_structured_blocks
    : extractStructuredBlocks(payload)
  const ooxmlSnapshot = payload.current_ooxml_snapshot ?? payload.currentOoxmlSnapshot ?? payload.ooxml_snapshot ?? payload.ooxmlSnapshot
  const referenceList = Array.isArray(payload.reference_list)
    ? payload.reference_list
    : Array.isArray(payload.references)
    ? payload.references
    : []
  const figures = Array.isArray(payload.figures)
    ? payload.figures
    : Array.isArray(payload.images)
    ? payload.images.map((item: Record<string, any>) => ({
        url: item.path ?? item.url,
        image_url: item.path ?? item.url,
        path: item.path ?? item.url,
        caption: item.caption ?? item.section ?? '',
        markdown: item.markdown,
        filename: String(item.path || item.url || '').split(/[\\/]/).pop(),
      }))
    : []

  return {
    title: normalizeOptionalString(payload.title),
    markdown: normalizeOptionalString(markdown),
    paperMarkdown: normalizeOptionalString(payload.paper_markdown) ?? normalizeOptionalString(markdown),
    structuredBlocks: structuredBlocks.length > 0 ? structuredBlocks : undefined,
    ooxmlSnapshot: ooxmlSnapshot && typeof ooxmlSnapshot === 'object' ? ooxmlSnapshot : undefined,
    referenceList: referenceList.length > 0 ? referenceList : undefined,
    figures: figures.length > 0 ? figures : undefined,
  }
}

export interface PaperArtifactContext {
  artifactId?: string
  command?: PaperCommandId | string
  topic?: string
  outline?: PaperOutlineSnapshot
  referenceDocumentIds?: string[]
  taskId?: string
  citationSidecarPath?: string
  manuscriptPath?: string
  lastKnowledgeTaskId?: string
  sourceRefs?: string[]
  exportRefs?: string[]
}

function resolveArtifactContext(context?: string | PaperArtifactContext): PaperArtifactContext | undefined {
  if (!context || typeof context === 'string') {
    return undefined
  }
  return context
}

export function buildPaperArtifact(payload: Record<string, any> | null | undefined, context: PaperArtifactContext = {}): DocumentArtifact | null {
  if (!payload) {
    return null
  }

  const boundary = resolveArtifactBoundary(payload)
  const resultFragments = buildPaperResultFragments(payload)
  const taskId = normalizeOptionalString(context.taskId) ?? normalizeOptionalString(payload.task_id) ?? normalizeOptionalString(payload.taskId)
  const topic = normalizeOptionalString(context.topic) ?? normalizeOptionalString(payload.topic)
  const referenceDocumentIds = collectStringRefs(context.referenceDocumentIds, payload.referenceDocumentIds)
  const citationSidecarPath = normalizeOptionalString(context.citationSidecarPath) ?? deriveCitationSidecarPath(context.manuscriptPath)
  const session = createPaperSession({
    topic,
    outline: resolvePaperOutline(payload, resultFragments.markdown || '', context.outline),
    referenceDocumentIds,
    taskId,
    citationSidecarPath,
    lastKnowledgeTaskId: normalizeOptionalString(context.lastKnowledgeTaskId) ?? normalizeOptionalString(payload.lastKnowledgeTaskId),
  })
  const sourceRefs = collectStringRefs(context.sourceRefs, referenceDocumentIds)
  const exportRefs = collectStringRefs(context.exportRefs, normalizeOptionalString(context.manuscriptPath), citationSidecarPath)
  const document = buildDocumentSchemaFromText({
    id: `document:${normalizeOptionalString(context.artifactId) ?? taskId ?? 'paper-compat'}`,
    profile: 'paper',
    title: topic || '论文',
    text: resultFragments.paperMarkdown || resultFragments.markdown || resolvePaperText(payload),
    sourceType: 'compat',
  })

  return toPaperArtifact({
    artifactId: normalizeOptionalString(context.artifactId) ?? `paper:${taskId || 'compat'}:${boundary}`,
    command: resolvePaperCommand(typeof context.command === 'string' ? context.command : undefined, boundary),
    session,
    document,
    sourceRefs,
    patches: [],
    exportRefs: exportRefs.length > 0 ? exportRefs : undefined,
    metadata: {
      manuscriptPath: normalizeOptionalString(context.manuscriptPath),
      artifactBoundary: boundary,
      resultFragments,
    },
  })
}

export function resolvePaperText(payload: Record<string, any> | null | undefined, fallback = ''): string {
  if (!payload) return String(fallback || '')

  const directMarkdown = typeof payload.paper_markdown === 'string' && payload.paper_markdown.trim()
    ? payload.paper_markdown
    : typeof payload.markdown === 'string' && payload.markdown.trim()
    ? payload.markdown
    : ''
  if (directMarkdown) return directMarkdown

  const structuredBlocks = Array.isArray(payload.current_structured_blocks)
    ? payload.current_structured_blocks
    : extractStructuredBlocks(payload)
  if (structuredBlocks.length > 0) {
    return serializeEmbeddedBlocksToMarkdown(structuredBlocks)
  }

  const ooxmlSnapshot = payload.ooxml_snapshot ?? payload.ooxmlSnapshot ?? payload.current_ooxml_snapshot ?? payload.currentOoxmlSnapshot
  const snapshotText = extractPaperTextFromOoxmlSnapshot(ooxmlSnapshot)
  if (snapshotText) return snapshotText

  const compatContent = typeof payload.current_content === 'string' && payload.current_content.trim()
    ? payload.current_content
    : typeof payload.content === 'string' && payload.content.trim()
    ? payload.content
    : ''

  return compatContent || String(fallback || '')
}

function normalizeTaskResultPayload(rawResult: Record<string, any> | null | undefined, artifactContext?: PaperArtifactContext) {
  if (!rawResult) {
    return rawResult
  }

  const structuredBlocks = extractStructuredBlocks(rawResult)
  const ooxmlSnapshot = rawResult.ooxml_snapshot ?? rawResult.ooxmlSnapshot
  const derivedMarkdown = resolvePaperText({ ...rawResult, ooxml_snapshot: ooxmlSnapshot })

  const normalizedResult = {
    ...rawResult,
    markdown: derivedMarkdown,
    paper_markdown: derivedMarkdown,
    ooxml_snapshot: ooxmlSnapshot,
    reference_list: rawResult.reference_list ?? rawResult.references ?? [],
    structured_blocks: structuredBlocks,
    structuredBlocks,
    figures: Array.isArray(rawResult.figures)
      ? rawResult.figures
      : Array.isArray(rawResult.images)
      ? rawResult.images.map((item: Record<string, any>) => ({
          url: item.path,
          image_url: item.path,
          path: item.path,
          caption: item.section || '',
          markdown: item.path ? `![${item.section || 'figure'}](${item.path})` : '',
          filename: String(item.path || '').split(/[\\/]/).pop(),
        }))
      : [],
  }

  const documentArtifact = buildPaperArtifact(normalizedResult, artifactContext)
  return documentArtifact ? { ...normalizedResult, documentArtifact } : normalizedResult
}

function normalizeTaskPayload(rawTask: Record<string, any> | null | undefined, artifactContext?: PaperArtifactContext) {
  if (!rawTask) {
    return rawTask
  }

  const normalizedResult = normalizeTaskResultPayload(rawTask.result, artifactContext)
  const currentOoxmlSnapshot = rawTask.current_ooxml_snapshot
    ?? rawTask.currentOoxmlSnapshot
    ?? normalizedResult?.ooxml_snapshot
  const structuredBlocks = Array.isArray(rawTask.current_structured_blocks)
    ? rawTask.current_structured_blocks
    : extractStructuredBlocks(normalizedResult)
  const derivedMarkdown = resolvePaperText({
    ...rawTask,
    current_ooxml_snapshot: currentOoxmlSnapshot,
    current_structured_blocks: structuredBlocks,
  })

  const normalizedTask = {
    ...rawTask,
    current_structured_blocks: structuredBlocks.length > 0 ? structuredBlocks : undefined,
    current_ooxml_snapshot: currentOoxmlSnapshot,
    paper_markdown: derivedMarkdown || undefined,
    result: normalizedResult,
  }

  const documentArtifact = buildPaperArtifact(normalizedTask, artifactContext)
  return documentArtifact ? { ...normalizedTask, documentArtifact } : normalizedTask
}

export interface PaperGenerationParams {
  topic: string
  scope?: 'paper' | 'daily-report' | 'essay-writing'
  yearFrom?: string
  yearTo?: string
  noImageMode?: boolean
  paperTitle?: string
  enableKnowledgeTreeCheck?: boolean
  paperType?: 'research' | 'review' | 'thesis_research'
  citationMode?: 'deferred' | 'inline'
  referenceTargetMode?: 'soft' | 'hard'
  skipSectionThinking?: boolean
  incrementalReferencePassMode?: 'off' | 'weak' | 'strong'
  incrementalReferencePassInterval?: number
  finalReferencePassMode?: 'off' | 'weak' | 'strong'
  finalReferenceVerification?: boolean
  enableFullReview?: boolean
  language?: string
  extraContext?: string
  workspacePath?: string
}

export interface PaperChunk {
  type: 'status' | 'progress' | 'content' | 'complete' | 'draft_complete' | 'error'
  step?: number
  status_message?: string
  message?: string
  event_type?: 'references' | 'image'
  reference_action?: 'status' | 'paragraph_analyzed' | 'reference_inserted' | 'complete'
  content_type?: string
  paper_markdown?: string
  cumulative_markdown?: string
  content?: string
  structured_blocks?: any[]
  references?: any[]
  image?: Record<string, any>
  paragraph_index?: number
  citation_number?: number
  citation?: string
  sentence_text?: string
  updated_paragraph?: string
  task_id?: string
  [key: string]: any
}

export interface PaperGenerationCallbacks {
  onStatus: (step: number, message: string) => void
  onEvent?: (chunk: PaperChunk) => void
  onContent: (chunk: PaperChunk) => void
  onComplete: (chunk: PaperChunk) => void
  onError: (error: string) => void
}

export function getTaskBackendKind(_taskId?: string): 'main' {
  return 'main'
}

export function getTaskBackendUrl(_taskId?: string): string {
  return 'local://electron-main'
}

export async function submitTask(params: PaperGenerationParams): Promise<string> {
  const result = (await window.electronAPI.compatSubmitTask(params as unknown as Record<string, unknown>)) as Record<string, any>
  if (result.status !== 'success') {
    throw new Error(result.error || '提交失败')
  }
  return String(result.task_id)
}

export async function getTaskStatus(taskId: string, backendOrArtifactContext?: string | PaperArtifactContext) {
  const artifactContext = resolveArtifactContext(backendOrArtifactContext)
  const result = (await window.electronAPI.compatGetTaskStatus(taskId)) as Record<string, any>
  if (result.status === 'success' && result.task) {
    return { ...result, task: normalizeTaskPayload(result.task, { ...artifactContext, taskId }) }
  }
  return result
}

export async function getTaskResult(taskId: string, backendOrArtifactContext?: string | PaperArtifactContext) {
  const artifactContext = resolveArtifactContext(backendOrArtifactContext)
  const result = (await window.electronAPI.compatGetTaskResult(taskId)) as Record<string, any>
  if (result.status === 'success' && result.result) {
    return { ...result, result: normalizeTaskResultPayload(result.result, { ...artifactContext, taskId }) }
  }
  return result
}

export async function getActiveTasks() {
  const result = (await window.electronAPI.compatGetActiveTasks()) as Record<string, any>
  if (result.status === 'success') {
    return {
      ...result,
      tasks: Array.isArray(result.tasks) ? result.tasks.map((task: Record<string, any>) => normalizeTaskPayload(task)) : [],
    }
  }
  return result
}

export async function getRecentTasks(limit = 20) {
  const result = (await window.electronAPI.compatGetRecentTasks(limit)) as Record<string, any>
  if (result.status === 'success') {
    return {
      ...result,
      tasks: Array.isArray(result.tasks) ? result.tasks.map((task: Record<string, any>) => normalizeTaskPayload(task)) : [],
    }
  }
  return result
}

export async function stopTask(taskId: string) {
  return window.electronAPI.compatStopTask(taskId)
}

function isTaskScope(task: Record<string, any> | null | undefined, scope: 'daily-report' | 'essay-writing'): boolean {
  return String(task?.scope || '').trim() === scope
}

function subscribeToScopedTaskEvents(scope: 'daily-report' | 'essay-writing', taskId: string, callback: (payload: Record<string, any>) => void): () => void {
  return window.electronAPI.onAiEvent((payload) => {
    const event = payload as Record<string, any>
    if (event.scope !== scope) return
    if (String(event.taskId || '').trim() !== String(taskId || '').trim()) return
    callback(event)
  })
}

export async function submitDailyReportTask(params: PaperGenerationParams): Promise<string> {
  return submitTask({
    ...params,
    scope: 'daily-report',
    paperType: 'review',
    citationMode: 'deferred',
  })
}

export async function getDailyReportTaskStatus(taskId: string, backendOrArtifactContext?: string | PaperArtifactContext) {
  const result = await getTaskStatus(taskId, backendOrArtifactContext)
  if ((result as any)?.status === 'success' && !isTaskScope((result as any)?.task, 'daily-report')) {
    return { status: 'failed', error: '任务类型不匹配' }
  }
  return result
}

export async function getDailyReportTaskResult(taskId: string, backendOrArtifactContext?: string | PaperArtifactContext) {
  const result = await getTaskResult(taskId, backendOrArtifactContext)
  if ((result as any)?.status === 'success' && !isTaskScope((result as any)?.result, 'daily-report')) {
    return { status: 'failed', error: '任务类型不匹配' }
  }
  return result
}

export async function getActiveDailyReportTasks() {
  const result = await getActiveTasks()
  if ((result as any)?.status !== 'success') return result
  return {
    ...(result as any),
    tasks: Array.isArray((result as any)?.tasks)
      ? (result as any).tasks.filter((task: Record<string, any>) => isTaskScope(task, 'daily-report'))
      : [],
  }
}

export function subscribeToDailyReportEvents(taskId: string, callback: (payload: Record<string, any>) => void): () => void {
  return subscribeToScopedTaskEvents('daily-report', taskId, callback)
}

export function stopDailyReportTask(taskId: string) {
  return stopTask(taskId)
}

export async function submitEssayTask(params: PaperGenerationParams): Promise<string> {
  return submitTask({
    ...params,
    scope: 'essay-writing',
    citationMode: 'deferred',
  })
}

export async function getEssayTaskStatus(taskId: string, backendOrArtifactContext?: string | PaperArtifactContext) {
  const result = await getTaskStatus(taskId, backendOrArtifactContext)
  if ((result as any)?.status === 'success' && !isTaskScope((result as any)?.task, 'essay-writing')) {
    return { status: 'failed', error: '任务类型不匹配' }
  }
  return result
}

export async function getEssayTaskResult(taskId: string, backendOrArtifactContext?: string | PaperArtifactContext) {
  const result = await getTaskResult(taskId, backendOrArtifactContext)
  if ((result as any)?.status === 'success' && !isTaskScope((result as any)?.result, 'essay-writing')) {
    return { status: 'failed', error: '任务类型不匹配' }
  }
  return result
}

export function subscribeToEssayTaskEvents(taskId: string, callback: (payload: Record<string, any>) => void): () => void {
  return subscribeToScopedTaskEvents('essay-writing', taskId, callback)
}

export function stopEssayTask(taskId: string) {
  return stopTask(taskId)
}

export async function pauseTask(taskId: string) {
  return window.electronAPI.compatPauseTask(taskId)
}

export async function resumeTask(taskId: string) {
  return window.electronAPI.compatResumeTask(taskId)
}

export async function generatePaper(
  params: PaperGenerationParams,
  callbacks: PaperGenerationCallbacks,
  signal?: AbortSignal,
): Promise<Record<string, any> | null> {
  let disposed = false
  const dispose = window.electronAPI.onAiEvent((payload) => {
    const event = payload as Record<string, any>
    if (event.scope !== 'paper') return
    if (event.type === 'progress') {
      callbacks.onEvent?.({
        type: 'progress',
        step: Number(event.step || 0),
        message: String(event.message || ''),
        event_type: event.eventType as 'references' | 'image' | undefined,
        reference_action: event.referenceAction as 'status' | 'paragraph_analyzed' | 'reference_inserted' | 'complete' | undefined,
        references: Array.isArray(event.references) ? event.references : undefined,
        paragraph_index: typeof event.paragraphIndex === 'number' ? event.paragraphIndex : undefined,
        citation_number: typeof event.citationNumber === 'number' ? event.citationNumber : undefined,
        citation: typeof event.citation === 'string' ? event.citation : undefined,
        sentence_text: typeof event.sentenceText === 'string' ? event.sentenceText : undefined,
        updated_paragraph: typeof event.updatedParagraph === 'string' ? event.updatedParagraph : undefined,
        image: event.image as Record<string, any> | undefined,
      })
      callbacks.onStatus(Number(event.step || 0), String(event.message || ''))
    } else if (event.type === 'content') {
      const structuredBlocks = Array.isArray(event.structuredBlocks) ? event.structuredBlocks : undefined
      const markdownFromBlocks = structuredBlocks && structuredBlocks.length > 0 ? serializeEmbeddedBlocksToMarkdown(structuredBlocks) : ''
      const cumulativeMarkdown = typeof event.cumulativeMarkdown === 'string' && event.cumulativeMarkdown.trim()
        ? String(event.cumulativeMarkdown)
        : ''
      const fallbackContent = typeof event.content === 'string' ? String(event.content) : ''
      const normalizedContentType = String(event.contentType || '')
      if (!cumulativeMarkdown && !markdownFromBlocks && normalizedContentType !== 'body' && normalizedContentType !== 'final') {
        return
      }
      callbacks.onContent({
        type: 'content',
        step: Number(event.step || 0),
        paper_markdown: cumulativeMarkdown || fallbackContent || markdownFromBlocks,
        content: fallbackContent,
        content_type: normalizedContentType,
        cumulative_markdown: cumulativeMarkdown,
        structured_blocks: structuredBlocks,
        event_type: event.eventType as 'references' | 'image' | undefined,
        reference_action: event.referenceAction as 'status' | 'paragraph_analyzed' | 'reference_inserted' | 'complete' | undefined,
        references: Array.isArray(event.references) ? event.references : undefined,
        image: event.image as Record<string, any> | undefined,
        paragraph_index: typeof event.paragraphIndex === 'number' ? event.paragraphIndex : undefined,
        citation_number: typeof event.citationNumber === 'number' ? event.citationNumber : undefined,
        citation: typeof event.citation === 'string' ? event.citation : undefined,
        sentence_text: typeof event.sentenceText === 'string' ? event.sentenceText : undefined,
        updated_paragraph: typeof event.updatedParagraph === 'string' ? event.updatedParagraph : undefined,
      })
    } else if (event.type === 'done') {
      const structuredBlocks = Array.isArray(event.result?.structuredBlocks) ? event.result.structuredBlocks : undefined
      const ooxmlSnapshot = event.result?.ooxmlSnapshot || event.result?.ooxml_snapshot
      callbacks.onComplete({
        type: 'complete',
        paper_markdown: resolvePaperText({
          ...(event.result || {}),
          ooxml_snapshot: ooxmlSnapshot,
          structured_blocks: structuredBlocks,
        }),
        structured_blocks: structuredBlocks,
        ooxml_snapshot: ooxmlSnapshot,
        image: event.result?.image as Record<string, any> | undefined,
        images: Array.isArray(event.result?.images) ? event.result.images : undefined,
      })
    }
  })

  const safeDispose = () => {
    if (disposed) return
    disposed = true
    dispose()
  }

  const abortHandler = () => {
    safeDispose()
    callbacks.onError('已停止')
  }
  signal?.addEventListener('abort', abortHandler, { once: true })

  try {
    const request = window.electronAPI.generatePaper({
      topic: params.topic,
      yearFrom: params.yearFrom,
      yearTo: params.yearTo,
      paperType: params.paperType,
      language: params.language,
      extraContext: params.extraContext,
      workspacePath: params.workspacePath,
      withImages: params.noImageMode ? false : true,
    }) as Promise<Record<string, any>>

    if (!signal) {
      return await request
    }

    return await Promise.race<Record<string, any> | null>([
      request,
      new Promise<null>((resolve) => {
        if (signal.aborted) {
          resolve(null)
          return
        }
        signal.addEventListener('abort', () => resolve(null), { once: true })
      }),
    ])
  } catch (error) {
    safeDispose()
    callbacks.onError(error instanceof Error ? error.message : String(error))
    return null
  } finally {
    safeDispose()
    signal?.removeEventListener('abort', abortHandler)
  }
}

export async function organizeReferences(params: Record<string, unknown>) {
  return window.electronAPI.organizeReferences(params)
}

// ── Step-by-step paper generation ─────────────────────────────────────────

export interface PaperSectionInfo {
  index: number
  title: string
  status: 'pending' | 'running' | 'done' | 'error'
}

export interface PaperProjectSnapshot {
  id: string
  status: string
  title: string
  abstract: string
  sections: Array<PaperSectionInfo & { error?: string }>
  conclusion: { status: string; error?: string }
  assembledMarkdown: string
}

/** 创建项目并运行初始化阶段（文献检索 + 结构规划 + 标题/摘要） */
export async function initPaperProject(
  params: PaperGenerationParams,
  workspacePath?: string,
): Promise<{ projectId: string; title: string; sections: PaperSectionInfo[] }> {
  const result = await window.electronAPI.paperInitProject(
    params as unknown as Record<string, unknown>,
    workspacePath,
  )
  if (result.status !== 'success' || !result.projectId) {
    throw new Error(result.error || '项目初始化失败')
  }
  return {
    projectId: result.projectId,
    title: result.title ?? '',
    sections: (result.sections ?? []) as PaperSectionInfo[],
  }
}

/** 生成指定章节 */
export async function runPaperSection(projectId: string, sectionIndex: number): Promise<void> {
  const result = await window.electronAPI.paperRunSection(projectId, sectionIndex)
  if (result.status !== 'success') throw new Error(result.error || '章节生成失败')
}

/** 生成结论章节 */
export async function runPaperConclusion(projectId: string): Promise<void> {
  const result = await window.electronAPI.paperRunConclusion(projectId)
  if (result.status !== 'success') throw new Error(result.error || '结论生成失败')
}

/** 最终整理（引用组织 + 全文审查 + 打包） */
export async function finalizePaperProject(projectId: string): Promise<Record<string, any>> {
  const result = await window.electronAPI.paperFinalizeProject(projectId)
  if (result.status !== 'success') throw new Error(result.error || '最终整理失败')
  return result.result ?? {}
}

/** 获取项目当前状态 */
export async function getPaperProject(projectId: string): Promise<PaperProjectSnapshot> {
  const result = await window.electronAPI.paperGetProject(projectId)
  if (result.status !== 'success' || !result.project) throw new Error(result.error || '项目不存在')
  return result.project as unknown as PaperProjectSnapshot
}

/** 删除项目（清理内存） */
export async function deletePaperProject(projectId: string): Promise<void> {
  await window.electronAPI.paperDeleteProject(projectId)
}

/**
 * 订阅分步论文生成事件（scope='paper-section'）。
 * 返回 unsubscribe 函数。
 */
export function subscribeToPaperSectionEvents(
  projectId: string,
  callback: (event: Record<string, any>) => void,
): () => void {
  return window.electronAPI.onAiEvent((payload) => {
    const event = payload as Record<string, any>
    if (event.scope !== 'paper-section') return
    if (String(event.projectId || '') !== String(projectId)) return
    callback(event)
  })
}