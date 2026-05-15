import path from 'node:path'
import {
  buildDocumentSchemaFromHtml,
  buildDocumentSchemaFromText,
  createDocumentSchema,
  createHeadingBlock,
  createImageBlock,
  createParagraphBlock,
  createTableBlock,
  type DocumentBlock,
  type DocumentDocxTemplateMode,
  type DocumentResource,
  type DocumentSchema,
  type DocumentSectionContract,
  type DocumentSectionType,
} from '../../../src/document/schema'
import type {
  OoxmlBlockSnapshot,
  OoxmlInlineRunSnapshot,
  OoxmlPackageSnapshot,
  OoxmlTableCellSnapshot,
} from './documentEngineService'

export const DOCX_BOUNDARY_METADATA_KEY = '__docxBoundary'
export const DOCX_SOURCE_BLOCK_INDEX_METADATA_KEY = '__docxSourceBlockIndices'
export const DOCX_SOURCE_XML_METADATA_KEY = '__docxSourceXml'
export const DOCX_SECTION_CONTRACT_ID_METADATA_KEY = '__docxSectionContractId'

export type DocumentSchemaDocxTemplateMode = DocumentDocxTemplateMode

export interface CompileDocumentSchemaToDocxBlocksOptions {
  workspacePath?: string
  resourceBasePath?: string
}

export interface ImportDocumentSchemaFromDocxOptions {
  resolveImageAsset?: (input: { suggestedName: string; source: string; mimeType?: string }) => Promise<{ relativePath: string; mimeType?: string; width?: number; height?: number } | null>
  profile?: DocumentSchema['profile']
  templateId?: string
  metadata?: Record<string, unknown>
  templateHints?: Partial<NonNullable<DocumentSchema['templateHints']>>
}

export interface CoerceLegacyDocxContentToSchemaOptions {
  filename?: string
  documentId?: string
  profile?: DocumentSchema['profile']
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeOptionalString(value: unknown): string | undefined {
  const normalized = String(value ?? '').trim()
  return normalized || undefined
}

function normalizeOptionalInteger(value: unknown): number | undefined {
  const normalized = Number(value)
  return Number.isInteger(normalized) ? normalized : undefined
}

function looksLikeHtml(value: string): boolean {
  return /<\s*[a-z][^>]*>/i.test(String(value || ''))
}

function buildDocumentTitle(filename?: string): string {
  const baseName = path.basename(String(filename || '').trim() || 'document')
  return baseName.replace(/\.[^.]+$/g, '') || 'document'
}

function buildDocxSourceMetadata(sourceBlockIndices: number[], sourceXml?: string, extra?: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    ...(extra || {}),
    [DOCX_SOURCE_BLOCK_INDEX_METADATA_KEY]: sourceBlockIndices,
  }
  if (normalizeOptionalString(sourceXml)) metadata[DOCX_SOURCE_XML_METADATA_KEY] = sourceXml
  return metadata
}

export function collectDocumentSchemaDocxSourceBlockIndices(block: DocumentBlock): number[] {
  const candidate = isRecord(block.metadata) ? block.metadata[DOCX_SOURCE_BLOCK_INDEX_METADATA_KEY] : undefined
  if (Array.isArray(candidate)) {
    return candidate.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 0)
  }
  const single = normalizeOptionalInteger(candidate)
  return single !== undefined ? [single] : []
}

function blockTextFromRuns(block: OoxmlBlockSnapshot): string {
  if (Array.isArray(block.inlineRuns) && block.inlineRuns.length > 0) {
    return block.inlineRuns.map((run: OoxmlInlineRunSnapshot) => String(run.text || '')).join('')
  }
  return String(block.text || '')
}

function resolveImagePath(block: OoxmlBlockSnapshot, resourceBasePath?: string): string {
  const source = normalizeOptionalString(block.previewSrc)
    || normalizeOptionalString(block.mediaPath)
    || normalizeOptionalString(block.title)
    || `image-${block.index + 1}.png`
  if (!source) return `image-${block.index + 1}.png`
  if (/^(https?:\/\/|data:|file:\/\/)/i.test(source) || path.isAbsolute(source)) return source
  return resourceBasePath ? path.resolve(resourceBasePath, source) : source
}

function buildTableRows(value: OoxmlTableCellSnapshot[][] | undefined): { headers: string[]; rows: string[][] } {
  const rows = Array.isArray(value) ? value.map((row) => row.map((cell) => String(cell.text || '').trim())) : []
  return {
    headers: rows[0] || [],
    rows: rows.slice(1),
  }
}

function toDocumentBlock(block: OoxmlBlockSnapshot, resourceBasePath?: string): { block: DocumentBlock | null; resource?: DocumentResource | null; sectionContract?: DocumentSectionContract | null } {
  const text = blockTextFromRuns(block)
  const sourceMetadata = buildDocxSourceMetadata([block.index], block.sourceXml)

  if (block.kind === 'heading') {
    return {
      block: createHeadingBlock({
        id: `docx-block-${block.index + 1}`,
        level: Math.max(1, Math.min(block.level || 1, 6)) as 1 | 2 | 3 | 4 | 5 | 6,
        text,
        styleRef: block.paragraphStyle,
        metadata: sourceMetadata,
      }),
    }
  }

  if (block.kind === 'image-placeholder') {
    const resourcePath = resolveImagePath(block, resourceBasePath)
    const resourceId = resourcePath
    return {
      block: createImageBlock({
        id: `docx-block-${block.index + 1}`,
        resourceRef: resourceId,
        text: normalizeOptionalString(block.alt) || normalizeOptionalString(block.title),
        width: block.imageWidthPx,
        height: block.imageHeightPx,
        value: {
          alt: normalizeOptionalString(block.alt),
          caption: normalizeOptionalString(block.title),
          width: block.imageWidthPx,
          height: block.imageHeightPx,
        },
        metadata: sourceMetadata,
      }),
      resource: {
        id: resourceId,
        kind: 'image',
        path: resourcePath,
        mimeType: block.mediaContentType,
        width: block.imageWidthPx,
        height: block.imageHeightPx,
      },
    }
  }

  if (block.kind === 'table-placeholder') {
    const tableValue = buildTableRows(block.tableRows)
    return {
      block: createTableBlock({
        id: `docx-block-${block.index + 1}`,
        value: tableValue,
        metadata: sourceMetadata,
      }),
    }
  }

  if (block.kind === 'page-break' || block.kind === 'section-break') {
    const boundaryKind = block.kind === 'page-break' ? 'page-break' : 'section-break'
    const blockId = `docx-block-${block.index + 1}`
    return {
      block: createParagraphBlock({
        id: blockId,
        text: text || '',
        metadata: {
          ...sourceMetadata,
          [DOCX_BOUNDARY_METADATA_KEY]: {
            kind: boundaryKind,
            sectionType: block.sectionType,
            sectionPropertiesXml: block.sectionPropertiesXml,
            sectionBreakXml: block.sectionBreakXml,
            hasManualPageBreak: block.hasManualPageBreak,
          },
        },
      }),
      sectionContract: block.kind === 'section-break'
        ? {
            id: `section-contract-${block.index + 1}`,
            scope: 'block-boundary',
            boundaryBlockId: blockId,
            sectionType: block.sectionType as DocumentSectionType | undefined,
            sectionPropertiesXml: block.sectionPropertiesXml,
          }
        : null,
    }
  }

  return {
    block: createParagraphBlock({
      id: `docx-block-${block.index + 1}`,
      text,
      styleRef: block.paragraphStyle,
      metadata: sourceMetadata,
    }),
  }
}

export function resolveDocumentSchemaDocxTemplateMode(document: DocumentSchema, templateSourcePath?: string): DocumentSchemaDocxTemplateMode {
  return document.templateHints?.docxTemplateMode
    || document.templateHints?.templateContract?.mode
    || (normalizeOptionalString(templateSourcePath) ? 'base-replace' : 'overlay')
}

export function resolveDocumentSchemaDocumentSectionPropertiesXml(document: DocumentSchema): string | undefined {
  const contracts = document.templateHints?.sectionContracts || []
  return [...contracts].reverse().find((contract) => normalizeOptionalString(contract.sectionPropertiesXml))?.sectionPropertiesXml
}

export function coerceLegacyDocxContentToDocumentSchema(content: string, options: CoerceLegacyDocxContentToSchemaOptions = {}): DocumentSchema {
  const title = buildDocumentTitle(options.filename)
  if (looksLikeHtml(content)) {
    return buildDocumentSchemaFromHtml({
      id: options.documentId || `document:${title}`,
      profile: options.profile || 'freewrite',
      title,
      html: content,
      sourceType: 'compat',
    })
  }
  return buildDocumentSchemaFromText({
    id: options.documentId || `document:${title}`,
    profile: options.profile || 'freewrite',
    title,
    text: content,
    sourceType: 'compat',
  })
}

export async function importDocumentSchemaFromOoxmlSnapshot(
  workspacePath: string,
  sourcePath: string,
  snapshot: OoxmlPackageSnapshot,
  options: ImportDocumentSchemaFromDocxOptions = {},
): Promise<DocumentSchema> {
  const blocks: DocumentSchema['blocks'] = []
  const resources: DocumentResource[] = []
  const sectionContracts: DocumentSectionContract[] = []

  for (const snapshotBlock of snapshot.blocks || []) {
    const converted = toDocumentBlock(snapshotBlock, workspacePath)
    if (converted.block) blocks.push(converted.block)
    if (converted.resource) resources.push(converted.resource)
    if (converted.sectionContract) sectionContracts.push(converted.sectionContract)
  }

  const document = createDocumentSchema({
    id: `document:${path.basename(sourcePath)}`,
    profile: options.profile || 'freewrite',
    title: path.basename(sourcePath).replace(/\.[^.]+$/g, ''),
    sourceType: 'docx-import',
    templateId: options.templateId,
    metadata: {
      sourcePath,
      workspacePath,
      ...(options.metadata || {}),
    },
    blocks: blocks.length > 0 ? blocks : [createParagraphBlock({ id: 'docx-block-empty', text: snapshot.plainText || '' })],
    resources,
    templateHints: {
      docxTemplateMode: normalizeOptionalString(sourcePath) ? 'base-replace' : 'overlay',
      templateContract: {
        kind: 'docx-boundary',
        mode: normalizeOptionalString(sourcePath) ? 'base-replace' : 'overlay',
        sourcePath,
      },
      sectionContracts,
      ...(options.templateHints || {}),
    },
    html: snapshot.html || undefined,
  })

  return document
}

export function compileDocumentSchemaToOoxmlBlocks(
  document: DocumentSchema,
  options: CompileDocumentSchemaToDocxBlocksOptions = {},
): OoxmlBlockSnapshot[] {
  return document.blocks.map((block, index) => {
    const sourceIndices = collectDocumentSchemaDocxSourceBlockIndices(block)
    const boundaryMeta = isRecord(block.metadata) ? block.metadata[DOCX_BOUNDARY_METADATA_KEY] : undefined

    if (block.type === 'heading') {
      return {
        index,
        kind: 'heading',
        text: String(block.text || ''),
        level: block.level,
        paragraphStyle: block.styleRef,
        sourceId: sourceIndices.length > 0 ? String(sourceIndices[0]) : undefined,
        sourceXml: normalizeOptionalString(isRecord(block.metadata) ? block.metadata[DOCX_SOURCE_XML_METADATA_KEY] : undefined),
      }
    }

    if (block.type === 'image') {
      const source = String(block.resourceRef || '').trim()
      const mediaPath = source && options.resourceBasePath && !path.isAbsolute(source) && !/^https?:\/\//i.test(source)
        ? path.resolve(options.resourceBasePath, source)
        : source
      return {
        index,
        kind: 'image-placeholder',
        text: String(block.text || block.value?.caption || ''),
        alt: normalizeOptionalString(block.value?.alt),
        title: normalizeOptionalString(block.value?.caption || block.text),
        mediaPath,
        previewSrc: mediaPath,
        mediaContentType: document.resources.find((resource) => resource.id === block.resourceRef || resource.path === block.resourceRef)?.mimeType,
        imageWidthPx: block.width || block.value?.width,
        imageHeightPx: block.height || block.value?.height,
        sourceId: sourceIndices.length > 0 ? String(sourceIndices[0]) : undefined,
        sourceXml: normalizeOptionalString(isRecord(block.metadata) ? block.metadata[DOCX_SOURCE_XML_METADATA_KEY] : undefined),
      }
    }

    if (block.type === 'table') {
      const headers = block.value?.headers || []
      const bodyRows = block.value?.rows || []
      const tableRows: OoxmlTableCellSnapshot[][] = []
      if (headers.length > 0) tableRows.push(headers.map((header, column) => ({ text: String(header || ''), header: true, column })))
      bodyRows.forEach((row) => tableRows.push((row || []).map((cell, column) => ({ text: String(cell ?? ''), column }))))
      return {
        index,
        kind: 'table-placeholder',
        text: '',
        rows: tableRows.length,
        columns: headers.length || tableRows[0]?.length || 0,
        tableRows,
        sourceId: sourceIndices.length > 0 ? String(sourceIndices[0]) : undefined,
        sourceXml: normalizeOptionalString(isRecord(block.metadata) ? block.metadata[DOCX_SOURCE_XML_METADATA_KEY] : undefined),
      }
    }

    if (isRecord(boundaryMeta) && boundaryMeta.kind === 'page-break') {
      return {
        index,
        kind: 'page-break',
        text: String(block.text || ''),
        hasManualPageBreak: Boolean(boundaryMeta.hasManualPageBreak ?? true),
        sourceId: sourceIndices.length > 0 ? String(sourceIndices[0]) : undefined,
        sourceXml: normalizeOptionalString(isRecord(block.metadata) ? block.metadata[DOCX_SOURCE_XML_METADATA_KEY] : undefined),
      }
    }

    if (isRecord(boundaryMeta) && boundaryMeta.kind === 'section-break') {
      return {
        index,
        kind: 'section-break',
        text: String(block.text || ''),
        sectionType: boundaryMeta.sectionType as DocumentSectionType | undefined,
        sectionPropertiesXml: normalizeOptionalString(boundaryMeta.sectionPropertiesXml),
        sectionBreakXml: normalizeOptionalString(boundaryMeta.sectionBreakXml),
        hasManualPageBreak: Boolean(boundaryMeta.hasManualPageBreak),
        sourceId: sourceIndices.length > 0 ? String(sourceIndices[0]) : undefined,
        sourceXml: normalizeOptionalString(isRecord(block.metadata) ? block.metadata[DOCX_SOURCE_XML_METADATA_KEY] : undefined),
      }
    }

    return {
      index,
      kind: 'paragraph',
      text: String(block.text || ''),
      paragraphStyle: block.styleRef,
      sourceId: sourceIndices.length > 0 ? String(sourceIndices[0]) : undefined,
      sourceXml: normalizeOptionalString(isRecord(block.metadata) ? block.metadata[DOCX_SOURCE_XML_METADATA_KEY] : undefined),
    }
  })
}