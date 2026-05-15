import { createDocumentArtifact, type DocumentArtifact, type DocumentPatch } from '../../../core'
import {
  buildDocumentBlocksFromText,
  cloneDocumentSchema,
  createDocumentSchema,
  createHeadingBlock,
  createParagraphBlock,
  createSlotBlock,
  type DocumentBlock,
  type DocumentSchema,
} from '../../../schema'
import {
  FORMAL_TEMPLATE_DEBUG_SNAPSHOT_METADATA_KEY,
  type FormalTemplateDebugSnapshot,
  type FormalTemplateExecutionMode,
  type FormalTemplateRoutingPlan,
  type RenderResult,
} from '../../../../types/templateGeneration'

export interface TemplateDocumentSessionMetadata {
  templateDocumentId?: string
  slotBindings: Record<string, string>
  previewResultPath?: string
  commitResultPath?: string
  activeTaskId?: string
}

export type TemplateDocumentCommandId =
  | 'identify-template'
  | 'analyze-template-structure'
  | 'preview-template-document'
  | 'commit-template-document'

interface TemplateDocumentArtifactInput {
  artifactId: string
  command: TemplateDocumentCommandId
  session: TemplateDocumentSessionMetadata
  document?: DocumentSchema
  sourceRefs?: string[]
  patches?: DocumentPatch[]
  exportRefs?: string[]
  metadata?: Record<string, unknown>
}

export interface TemplateDocumentCommitArtifactInput {
  artifactId?: string
  templateDocumentId?: string
  templateTitle?: string
  outputPath?: string
  activeTaskId?: string
  fieldValues?: Array<{ fieldId: string; value: string }>
  fieldLabels?: Record<string, string>
  regionResults?: Array<{ regionId: string; candidateText: string }>
  regionLabels?: Record<string, string>
  patches?: DocumentPatch[]
  documentOverride?: DocumentSchema
  routingPlan?: FormalTemplateRoutingPlan
  executionMode?: FormalTemplateExecutionMode
}

export interface TemplateDocumentRenderResultArtifactContext {
  artifactId?: string
  templateDocumentId?: string
  templateTitle?: string
  activeTaskId?: string
  fieldLabels?: Record<string, string>
  regionLabels?: Record<string, string>
  patches?: DocumentPatch[]
  documentOverride?: DocumentSchema
  routingPlan?: FormalTemplateRoutingPlan
}

export interface TemplateDocumentRegionBinding {
  regionId: string
  label?: string
  index?: number
  editable?: boolean
}

export interface TemplateDocumentFieldBinding {
  fieldId: string
  label?: string
}

const TEMPLATE_DOCUMENT_REGION_ID_METADATA_KEY = 'templateRegionId'
const TEMPLATE_DOCUMENT_REGION_LABEL_METADATA_KEY = 'templateRegionLabel'
const TEMPLATE_DOCUMENT_REGION_INDEX_METADATA_KEY = 'templateRegionIndex'
const TEMPLATE_DOCUMENT_REGION_EDITABLE_METADATA_KEY = 'templateRegionEditable'
const TEMPLATE_DOCUMENT_FIELD_ID_METADATA_KEY = 'templateFieldId'
const TEMPLATE_DOCUMENT_FIELD_LABEL_METADATA_KEY = 'templateFieldLabel'

export function createTemplateDocumentSession(input: Partial<TemplateDocumentSessionMetadata> = {}): TemplateDocumentSessionMetadata {
  return {
    templateDocumentId: input.templateDocumentId,
    slotBindings: { ...(input.slotBindings || {}) },
    previewResultPath: input.previewResultPath,
    commitResultPath: input.commitResultPath,
    activeTaskId: input.activeTaskId,
  }
}

function normalizeOptionalString(value: unknown): string | undefined {
  const normalized = String(value ?? '').trim()
  return normalized || undefined
}

function buildFormalTemplateDebugSnapshot(input: {
  routingPlan?: FormalTemplateRoutingPlan
  executionMode?: FormalTemplateExecutionMode
}): FormalTemplateDebugSnapshot | undefined {
  if (!input.routingPlan && !input.executionMode) return undefined
  return {
    routingPlan: input.routingPlan,
    executionMode: input.executionMode,
  }
}

function attachFormalTemplateDebugSnapshot(
  document: DocumentSchema,
  debugSnapshot: FormalTemplateDebugSnapshot | undefined,
): DocumentSchema {
  if (!debugSnapshot) return document
  const nextDocument = cloneDocumentSchema(document)
  nextDocument.document.metadata = {
    ...(nextDocument.document.metadata || {}),
    [FORMAL_TEMPLATE_DEBUG_SNAPSHOT_METADATA_KEY]: debugSnapshot,
  }
  return nextDocument
}

function createTemplateDocumentRegionBlockPrefix(regionId: string, index: number): string {
  const normalizedRegionId = regionId
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
  return `template-document-region-${normalizedRegionId || index + 1}`
}

function annotateTemplateDocumentRegionBlocks(blocks: DocumentBlock[], binding: TemplateDocumentRegionBinding): DocumentBlock[] {
  return blocks.map((block) => ({
    ...block,
    metadata: {
      ...(block.metadata || {}),
      [TEMPLATE_DOCUMENT_REGION_ID_METADATA_KEY]: binding.regionId,
      [TEMPLATE_DOCUMENT_REGION_LABEL_METADATA_KEY]: binding.label,
      [TEMPLATE_DOCUMENT_REGION_INDEX_METADATA_KEY]: binding.index,
      [TEMPLATE_DOCUMENT_REGION_EDITABLE_METADATA_KEY]: binding.editable !== false,
    },
  }))
}

export function getTemplateDocumentRegionBindingFromBlock(block: DocumentBlock | null | undefined): TemplateDocumentRegionBinding | null {
  if (!block?.metadata) return null
  const regionId = normalizeOptionalString(block.metadata[TEMPLATE_DOCUMENT_REGION_ID_METADATA_KEY])
  if (!regionId) return null
  const label = normalizeOptionalString(block.metadata[TEMPLATE_DOCUMENT_REGION_LABEL_METADATA_KEY])
  const index = Number(block.metadata[TEMPLATE_DOCUMENT_REGION_INDEX_METADATA_KEY])
  const editableValue = block.metadata[TEMPLATE_DOCUMENT_REGION_EDITABLE_METADATA_KEY]
  return {
    regionId,
    label,
    index: Number.isFinite(index) ? index : undefined,
    editable: editableValue === undefined ? true : Boolean(editableValue),
  }
}

export function getTemplateDocumentFieldBindingFromBlock(block: DocumentBlock | null | undefined): TemplateDocumentFieldBinding | null {
  if (!block?.metadata) return null
  const fieldId = normalizeOptionalString(block.metadata[TEMPLATE_DOCUMENT_FIELD_ID_METADATA_KEY])
  if (!fieldId) return null
  return {
    fieldId,
    label: normalizeOptionalString(block.metadata[TEMPLATE_DOCUMENT_FIELD_LABEL_METADATA_KEY]),
  }
}

export function collectTemplateDocumentRegionBlocks(document: DocumentSchema, regionId: string): DocumentBlock[] {
  return document.blocks.filter((block) => getTemplateDocumentRegionBindingFromBlock(block)?.regionId === regionId)
}

function serializeTemplateDocumentBlockText(block: DocumentBlock): string {
  if (block.type === 'heading') {
    const level = Math.max(1, Math.min(block.level || 1, 6))
    return `${'#'.repeat(level)} ${String(block.text || '').trim()}`.trim()
  }
  if (block.type === 'image') {
    const alt = typeof block.value === 'object' && block.value && 'alt' in block.value
      ? String((block.value as Record<string, unknown>).alt || '').trim()
      : String(block.text || '').trim()
    return `![${alt}](${block.resourceRef})`
  }
  if (block.type === 'table') {
    const headers = Array.isArray((block.value as Record<string, unknown> | undefined)?.headers)
      ? ((block.value as Record<string, unknown>).headers as unknown[]).map((value) => String(value ?? ''))
      : []
    const rows = Array.isArray((block.value as Record<string, unknown> | undefined)?.rows)
      ? ((block.value as Record<string, unknown>).rows as unknown[]).map((row) => Array.isArray(row) ? row.map((value) => String(value ?? '')) : [])
      : []
    if (headers.length === 0) return ''
    return [
      `| ${headers.join(' | ')} |`,
      `| ${headers.map(() => '---').join(' | ')} |`,
      ...rows.map((row) => `| ${row.join(' | ')} |`),
    ].join('\n')
  }
  return String(block.text || '').trim()
}

export function serializeTemplateDocumentRegionBlocks(blocks: DocumentBlock[]): { finalText: string; finalParagraphs: string[] } {
  const finalParagraphs = blocks
    .map((block) => serializeTemplateDocumentBlockText(block))
    .map((text) => text.trim())
    .filter(Boolean)
  return {
    finalText: finalParagraphs.join('\n\n'),
    finalParagraphs,
  }
}

function buildTemplateDocumentArtifactDocument(input: TemplateDocumentArtifactInput): DocumentSchema {
  if (input.document) return input.document
  const slotEntries = Object.entries(input.session.slotBindings)
  return createDocumentSchema({
    id: `document:${input.artifactId}`,
    profile: 'templateDocument',
    templateId: input.session.templateDocumentId,
    metadata: {
      activeTaskId: input.session.activeTaskId,
      previewResultPath: input.session.previewResultPath,
      commitResultPath: input.session.commitResultPath,
    },
    blocks: [
      createHeadingBlock({
        id: 'template-document-title',
        level: 1,
        text: input.session.templateDocumentId ? `Template ${input.session.templateDocumentId}` : 'Template Document',
      }),
      ...slotEntries.map(([slotKey, value], index) => createSlotBlock({
        id: `slot-${index + 1}`,
        slotKey,
        text: value,
        value: { text: value },
      })),
    ],
    templateHints: {
      slotOrder: slotEntries.map(([slotKey]) => slotKey),
    },
    exportHints: {
      preferredDelivery: 'docx',
      wordSkill: { route: 'format-apply', docType: 'report' },
      pdfSkill: { docType: 'report' },
    },
  })
}

function buildTemplateDocumentCommitSlotBindings(input: TemplateDocumentCommitArtifactInput): Record<string, string> {
  return Object.fromEntries(
    (input.fieldValues || [])
      .map((fieldValue) => {
        const value = normalizeOptionalString(fieldValue.value)
        if (!value) return null
        const slotKey = normalizeOptionalString(input.fieldLabels?.[fieldValue.fieldId]) || fieldValue.fieldId
        return [slotKey, value] as const
      })
      .filter((item): item is readonly [string, string] => Boolean(item)),
  )
}

export function buildTemplateDocumentCommitDocument(input: TemplateDocumentCommitArtifactInput): DocumentSchema {
  const slotBindings = buildTemplateDocumentCommitSlotBindings(input)
  const title = normalizeOptionalString(input.templateTitle) || '正式文稿'
  const blocks: DocumentSchema['blocks'] = [
    createHeadingBlock({ id: 'template-document-commit-title', level: 1, text: title }),
  ]

  const fieldEntries = (input.fieldValues || [])
    .map((fieldValue) => ({
      fieldId: fieldValue.fieldId,
      label: normalizeOptionalString(input.fieldLabels?.[fieldValue.fieldId]),
      value: normalizeOptionalString(fieldValue.value),
    }))
    .filter((entry): entry is { fieldId: string; label: string | undefined; value: string } => Boolean(entry.value))

  if (fieldEntries.length > 0) {
    blocks.push(createHeadingBlock({ id: 'template-document-slot-heading', level: 2, text: '字段填充' }))
    fieldEntries.forEach((fieldEntry, index) => {
      blocks.push(createSlotBlock({
        id: `template-document-slot-${index + 1}`,
        slotKey: fieldEntry.label || fieldEntry.fieldId,
        text: fieldEntry.value,
        value: { text: fieldEntry.value },
        metadata: {
          [TEMPLATE_DOCUMENT_FIELD_ID_METADATA_KEY]: fieldEntry.fieldId,
          [TEMPLATE_DOCUMENT_FIELD_LABEL_METADATA_KEY]: fieldEntry.label,
        },
      }))
    })
  }

  const normalizedRegionResults = (input.regionResults || [])
    .map((regionResult) => ({ regionId: regionResult.regionId, candidateText: normalizeOptionalString(regionResult.candidateText) || '' }))
    .filter((regionResult) => Boolean(regionResult.candidateText))

  normalizedRegionResults.forEach((regionResult, index) => {
    const regionLabel = normalizeOptionalString(input.regionLabels?.[regionResult.regionId])
    if (regionLabel) blocks.push(createHeadingBlock({ id: `template-document-region-heading-${index + 1}`, level: 2, text: regionLabel }))
    const regionBlocks = annotateTemplateDocumentRegionBlocks(buildDocumentBlocksFromText({
      text: regionResult.candidateText,
      blockIdPrefix: createTemplateDocumentRegionBlockPrefix(regionResult.regionId, index),
    }), {
      regionId: regionResult.regionId,
      label: regionLabel,
      index,
      editable: true,
    })
    if (regionBlocks.length > 0) {
      blocks.push(...regionBlocks)
    } else {
      blocks.push(createParagraphBlock({
        id: `${createTemplateDocumentRegionBlockPrefix(regionResult.regionId, index)}-fallback`,
        type: 'paragraph',
        text: regionResult.candidateText,
        metadata: {
          [TEMPLATE_DOCUMENT_REGION_ID_METADATA_KEY]: regionResult.regionId,
          [TEMPLATE_DOCUMENT_REGION_LABEL_METADATA_KEY]: regionLabel,
          [TEMPLATE_DOCUMENT_REGION_INDEX_METADATA_KEY]: index,
          [TEMPLATE_DOCUMENT_REGION_EDITABLE_METADATA_KEY]: true,
        },
      }))
    }
  })

  if (blocks.length === 1) {
    blocks.push(createParagraphBlock({ id: 'template-document-empty-body', type: 'paragraph', text: '当前结果已生成，但暂未提取到可展示的正文内容。' }))
  }

  const debugSnapshot = buildFormalTemplateDebugSnapshot({ routingPlan: input.routingPlan, executionMode: input.executionMode })
  const defaultTemplateMode = input.routingPlan?.defaultExecution.strategy

  return createDocumentSchema({
    id: `document:${input.artifactId || input.templateDocumentId || 'template-document-commit'}`,
    profile: 'templateDocument',
    templateId: input.templateDocumentId,
    metadata: {
      activeTaskId: input.activeTaskId,
      commitResultPath: input.outputPath,
      previewSource: 'commit-result',
      ...(debugSnapshot ? { [FORMAL_TEMPLATE_DEBUG_SNAPSHOT_METADATA_KEY]: debugSnapshot } : {}),
    },
    blocks,
    templateHints: {
      slotOrder: Object.keys(slotBindings),
      docxTemplateMode: defaultTemplateMode,
      templateContract: defaultTemplateMode ? {
        kind: 'formal-template',
        mode: defaultTemplateMode,
        preserveShell: true,
      } : undefined,
    },
    exportHints: {
      preferredDelivery: 'docx',
      wordSkill: { route: 'format-apply', docType: 'report' },
      pdfSkill: { docType: 'report' },
    },
  })
}

export function buildTemplateDocumentCommitArtifact(input: TemplateDocumentCommitArtifactInput): DocumentArtifact {
  const slotBindings = buildTemplateDocumentCommitSlotBindings(input)
  const debugSnapshot = buildFormalTemplateDebugSnapshot({ routingPlan: input.routingPlan, executionMode: input.executionMode })
  return toTemplateDocumentArtifact({
    artifactId: input.artifactId || `templateDocument:commit:${input.templateDocumentId || 'result'}`,
    command: 'commit-template-document',
    session: createTemplateDocumentSession({
      templateDocumentId: input.templateDocumentId,
      slotBindings,
      commitResultPath: input.outputPath,
      activeTaskId: input.activeTaskId,
    }),
    document: attachFormalTemplateDebugSnapshot(input.documentOverride || buildTemplateDocumentCommitDocument(input), debugSnapshot),
    patches: input.patches,
    metadata: {
      previewSource: 'commit-result',
      outputPath: input.outputPath,
      ...(debugSnapshot ? { [FORMAL_TEMPLATE_DEBUG_SNAPSHOT_METADATA_KEY]: debugSnapshot } : {}),
    },
    exportRefs: input.outputPath ? [input.outputPath] : undefined,
  })
}

export function attachTemplateDocumentArtifact(result: RenderResult, context: TemplateDocumentRenderResultArtifactContext): RenderResult {
  return {
    ...result,
    documentArtifact: buildTemplateDocumentCommitArtifact({
      artifactId: context.artifactId,
      templateDocumentId: context.templateDocumentId,
      templateTitle: context.templateTitle,
      outputPath: result.outputPath,
      activeTaskId: context.activeTaskId,
      fieldValues: result.fieldValues,
      fieldLabels: context.fieldLabels,
      regionResults: result.regionResults,
      regionLabels: context.regionLabels,
      patches: context.patches,
      documentOverride: context.documentOverride || result.documentArtifact?.document,
      routingPlan: context.routingPlan,
      executionMode: result.executionMode,
    }),
  }
}

export function toTemplateDocumentArtifact(input: TemplateDocumentArtifactInput): DocumentArtifact {
  const sourceRefs = input.sourceRefs ?? (input.session.templateDocumentId ? [input.session.templateDocumentId] : [])
  const exportRefs = input.exportRefs ?? [input.session.previewResultPath, input.session.commitResultPath].filter((value): value is string => Boolean(value))
  return createDocumentArtifact({
    id: input.artifactId,
    profile: 'templateDocument',
    document: buildTemplateDocumentArtifactDocument(input),
    sourceRefs,
    patches: input.patches ?? [],
    metadata: input.metadata,
    profileMetadata: {
      ...input.metadata,
      command: input.command,
      templateDocumentId: input.session.templateDocumentId,
      slotBindingCount: Object.keys(input.session.slotBindings).length,
      previewResultPath: input.session.previewResultPath,
      commitResultPath: input.session.commitResultPath,
      activeTaskId: input.session.activeTaskId,
      runtime: 'TemplateDocumentCommandBridge -> useFormalTemplateGeneration -> formalTemplateTaskService',
    },
    exportRefs,
  })
}