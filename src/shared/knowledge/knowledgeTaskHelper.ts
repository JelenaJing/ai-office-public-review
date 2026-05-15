import type {
  KnowledgeGenerationTrace,
  KnowledgeRetrievalMode,
  KnowledgeTaskConstraints,
  KnowledgeTaskRecord,
  KnowledgeTaskStatus,
  KnowledgeTemplateInheritanceOptions,
  PreviewKnowledgeTaskContextInput,
  PreviewKnowledgeTaskContextResult,
  SaveKnowledgeTaskInput,
} from '../../types/knowledge'

const DEFAULT_PREVIEW_INSTRUCTION = '请根据当前资料生成新文稿'

const DEFAULT_TEMPLATE_INHERITANCE: KnowledgeTemplateInheritanceOptions = {
  structure: true,
  tone: true,
  terminology: true,
}

type PreviewKnowledgeTaskContextFn = (payload: PreviewKnowledgeTaskContextInput) => Promise<PreviewKnowledgeTaskContextResult>
type SaveKnowledgeTaskRecordFn = (payload: SaveKnowledgeTaskInput) => Promise<{ task: KnowledgeTaskRecord }>

function normalizeOptionalId(value: string | null | undefined): string | undefined {
  const normalized = String(value || '').trim()
  return normalized || undefined
}

function normalizeIdList(values: Array<string | null | undefined>, excludedId?: string): string[] {
  const normalizedExcludedId = String(excludedId || '').trim()
  const seen = new Set<string>()

  return values.reduce<string[]>((result, value) => {
    const normalized = String(value || '').trim()
    if (!normalized || normalized === normalizedExcludedId || seen.has(normalized)) {
      return result
    }
    seen.add(normalized)
    result.push(normalized)
    return result
  }, [])
}

function normalizePreviewInstruction(instruction: string, fallbackInstruction = DEFAULT_PREVIEW_INSTRUCTION): string {
  return String(instruction || '').trim() || fallbackInstruction
}

export function createDefaultTemplateInheritance(): KnowledgeTemplateInheritanceOptions {
  return { ...DEFAULT_TEMPLATE_INHERITANCE }
}

export function getRetrievalModeLabel(mode: KnowledgeRetrievalMode): string {
  if (mode === 'selected-only') return '仅使用已选资料'
  if (mode === 'selected-first') return '已选资料优先，允许自动补充'
  return '完全自动检索'
}

export function buildKnowledgeTaskConstraints(params: {
  mode: KnowledgeRetrievalMode
  templateDocumentId?: string | null
  requiredReferenceDocumentIds: Array<string | null | undefined>
  preferredReferenceDocumentIds?: Array<string | null | undefined>
  autoRetrievalLimit: number
  templateInheritance: KnowledgeTemplateInheritanceOptions
}): KnowledgeTaskConstraints {
  const templateDocumentId = normalizeOptionalId(params.templateDocumentId)
  const requiredReferenceDocumentIds = normalizeIdList(params.requiredReferenceDocumentIds, templateDocumentId)
  const preferredReferenceDocumentIds = normalizeIdList(params.preferredReferenceDocumentIds || [], templateDocumentId)
    .filter((documentId) => !requiredReferenceDocumentIds.includes(documentId))

  return {
    mode: params.mode,
    templateDocumentId,
    requiredReferenceDocumentIds,
    preferredReferenceDocumentIds,
    allowAutoRetrieval: params.mode !== 'selected-only',
    autoRetrievalLimit: params.autoRetrievalLimit,
    templateInheritance: { ...params.templateInheritance },
  }
}

export function shouldRequestKnowledgePreview(instruction: string, constraints: KnowledgeTaskConstraints): boolean {
  if (String(instruction || '').trim()) return true
  return Boolean(
    constraints.templateDocumentId
    || constraints.requiredReferenceDocumentIds.length
    || constraints.preferredReferenceDocumentIds.length,
  )
}

export async function resolveKnowledgeTaskPreview(params: {
  instruction: string
  constraints: KnowledgeTaskConstraints
  previewContext: PreviewKnowledgeTaskContextFn
  cachedInstruction?: string
  cachedPreview?: PreviewKnowledgeTaskContextResult | null
  fallbackInstruction?: string
}): Promise<PreviewKnowledgeTaskContextResult | null> {
  if (!shouldRequestKnowledgePreview(params.instruction, params.constraints)) {
    return null
  }

  const normalizedInstruction = normalizePreviewInstruction(params.instruction, params.fallbackInstruction)
  const normalizedCachedInstruction = normalizePreviewInstruction(params.cachedInstruction || '', params.fallbackInstruction)
  if (params.cachedPreview && normalizedInstruction === normalizedCachedInstruction) {
    return params.cachedPreview
  }

  try {
    return await params.previewContext({
      instruction: normalizedInstruction,
      constraints: params.constraints,
    })
  } catch {
    return null
  }
}

export function buildKnowledgeGenerationTrace(
  preview: PreviewKnowledgeTaskContextResult | null,
  constraints: KnowledgeTaskConstraints,
): KnowledgeGenerationTrace | undefined {
  if (!preview) return undefined

  const explicitCitations = preview.citations.filter((item) => item.sourceKind === 'required-reference' || item.sourceKind === 'preferred-reference')
  const autoCitations = preview.citations.filter((item) => item.sourceKind === 'auto-retrieval')

  return {
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
  }
}

/**
 * Returns true if the markdown already contains a structured reference/bibliography heading.
 * Used to avoid appending a second reference block when the LLM output already has one.
 */
export function markdownHasReferencesSection(markdown: string): boolean {
  return /^#{1,4}\s*(?:参考文献|references?|bibliography|文献[列清]?单?)\s*$/im.test(markdown)
}

export function buildKnowledgeReferenceMarkdown(trace: KnowledgeGenerationTrace | undefined): string {
  if (!trace || !trace.citations.length) return ''

  // Exclude template citations (style inheritance only, not factual sources)
  const factualCitations = trace.citations.filter((c) => c.sourceKind !== 'template')
  if (!factualCitations.length) return ''

  // Assign stable numeric index by first-occurrence of each documentId
  const indexMap = new Map<string, number>()
  const orderedDocs: Array<{ documentId: string; title: string }> = []
  let idx = 1
  for (const c of factualCitations) {
    if (!indexMap.has(c.documentId)) {
      indexMap.set(c.documentId, idx++)
      // Strip common file extensions for display
      const cleanTitle = c.documentTitle.replace(/\.(pdf|docx?|pptx?|xlsx?|txt|md)$/i, '')
      orderedDocs.push({ documentId: c.documentId, title: cleanTitle })
    }
  }

  const lines: string[] = ['', '---', '', '**本文参考了以下素材：**', '']
  for (const doc of orderedDocs) {
    const num = indexMap.get(doc.documentId)!
    lines.push(`[${num}] ${doc.title}`)
  }
  lines.push('')

  return lines.join('\n')
}

export function shouldSaveKnowledgeTaskRecord(constraints: KnowledgeTaskConstraints): boolean {
  return Boolean(
    constraints.templateDocumentId
    || constraints.requiredReferenceDocumentIds.length
    || constraints.preferredReferenceDocumentIds.length
    || constraints.mode === 'auto',
  )
}

export function buildKnowledgeTaskRecordInput(params: {
  taskId: string
  title: string
  status: KnowledgeTaskStatus
  constraints: KnowledgeTaskConstraints
  generationTrace?: KnowledgeGenerationTrace
  errorMessage?: string
  instruction?: string
  documentId?: string
  sourceVersionId?: string
  outputVersionId?: string
  outputPreview?: string
}): SaveKnowledgeTaskInput {
  const referenceDocumentIds = normalizeIdList([
    ...params.constraints.requiredReferenceDocumentIds,
    ...params.constraints.preferredReferenceDocumentIds,
  ], params.constraints.templateDocumentId)

  return {
    id: params.taskId,
    externalTaskId: params.taskId,
    type: params.constraints.templateDocumentId ? 'template-generation' : 'reference-generation',
    status: params.status,
    title: params.title,
    documentId: params.documentId,
    templateDocumentId: params.constraints.templateDocumentId,
    sourceDocumentIds: normalizeIdList([
      params.constraints.templateDocumentId,
      ...referenceDocumentIds,
    ]),
    referenceDocumentIds,
    constraints: params.constraints,
    generationTrace: params.generationTrace,
    sourceVersionId: params.sourceVersionId,
    outputVersionId: params.outputVersionId,
    instruction: params.instruction,
    outputPreview: params.outputPreview,
    errorMessage: params.errorMessage,
  }
}

export async function persistKnowledgeTaskRecord(params: {
  saveRecord: SaveKnowledgeTaskRecordFn
  taskId: string
  title: string
  status: KnowledgeTaskStatus
  constraints: KnowledgeTaskConstraints
  generationTrace?: KnowledgeGenerationTrace
  errorMessage?: string
  instruction?: string
  documentId?: string
  sourceVersionId?: string
  outputVersionId?: string
  outputPreview?: string
}): Promise<void> {
  if (!shouldSaveKnowledgeTaskRecord(params.constraints)) {
    return
  }

  await params.saveRecord(buildKnowledgeTaskRecordInput(params))
}