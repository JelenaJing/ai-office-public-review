export type DocumentProfile = 'freewrite' | 'paper' | 'templateDocument' | string
export type DocumentSchemaVersion = '0.1' | '1.0'
export type DocumentSourceType =
  | 'workspace-json'
  | 'legacy-workspace'
  | 'docx-import'
  | 'html-import'
  | 'markdown-import'
  | 'plaintext-import'
  | 'compat'
  | 'unknown'
  | string
export type DocumentTextAlign = 'left' | 'center' | 'right' | 'justify'
export type DocumentImageAlign = 'left' | 'center' | 'right'
export type DocumentDocxTemplateMode = 'overlay' | 'base-replace'
export type DocumentSectionType = 'nextPage' | 'continuous' | 'evenPage' | 'oddPage'
export type DocumentHeaderFooterVariant = 'default' | 'first' | 'even'

export interface DocumentMeasurement {
  value: number
  unit: 'pt' | 'mm' | 'cm' | 'in'
}

export interface DocumentPageSettings {
  size: {
    preset: 'a4' | 'letter' | 'legal' | 'a3' | 'custom'
    width?: DocumentMeasurement
    height?: DocumentMeasurement
  }
  margins: {
    top: DocumentMeasurement
    right: DocumentMeasurement
    bottom: DocumentMeasurement
    left: DocumentMeasurement
  }
  orientation?: 'portrait' | 'landscape'
}

export interface DocumentMeta {
  title: string
  createdAt: string
  updatedAt: string
  sourceType: DocumentSourceType
  templateId?: string
  version: DocumentSchemaVersion
  [key: string]: unknown
}

export interface DocumentStyleToken {
  id: string
  fontFamily?: string
  fontSize?: number
  fontWeight?: number | 'normal' | 'bold'
  italic?: boolean
  lineHeight?: number
  color?: string
  backgroundColor?: string
  textAlign?: DocumentTextAlign
  spacingBefore?: number
  spacingAfter?: number
  indentLeft?: number
  indentRight?: number
  borderLeftColor?: string
  borderLeftWidth?: number
}

export type DocumentStyleTokenMap = Record<string, DocumentStyleToken>

export interface DocumentSourceRef {
  id: string
  kind?: 'reference' | 'document' | 'image' | 'citation' | 'workspace' | 'external' | 'skill-input'
  label?: string
  uri?: string
  metadata?: Record<string, unknown>
}

export type DocumentSourceRefLike = string | DocumentSourceRef

export interface DocumentImageCrop {
  top?: number
  right?: number
  bottom?: number
  left?: number
}

export interface DocumentImageValue {
  alt?: string
  caption?: string
  width?: number
  height?: number
  align?: DocumentImageAlign
  crop?: DocumentImageCrop
  text?: string
  [key: string]: unknown
}

export interface DocumentSlotValue {
  text?: string
  richText?: string
  boundSourceId?: string
  [key: string]: unknown
}

export interface DocumentTableValue {
  headers?: string[]
  rows?: Array<Array<string | number | boolean | null>>
  caption?: string
  [key: string]: unknown
}

export interface DocumentResource {
  id: string
  kind: 'image'
  path: string
  mimeType?: string
  width?: number
  height?: number
  metadata?: Record<string, unknown>
}

export interface DocumentHeaderFooterContract {
  variant: DocumentHeaderFooterVariant
  relationshipId?: string
  entryPath?: string
  contentXml?: string
}

export interface DocumentPageNumberContract {
  start?: number
  format?: string
  chapterSeparator?: string
  chapterStyle?: number
}

export interface DocumentSectionContract {
  id: string
  scope: 'block-boundary' | 'document-end'
  boundaryBlockId?: string
  sectionType?: DocumentSectionType
  titlePage?: boolean
  pageNumber?: DocumentPageNumberContract
  headerRefs?: DocumentHeaderFooterContract[]
  footerRefs?: DocumentHeaderFooterContract[]
  sectionPropertiesXml?: string
}

export interface DocumentTemplateContract {
  kind?: 'formal-template' | 'docx-boundary'
  mode?: DocumentDocxTemplateMode
  sourcePath?: string
  preserveShell?: boolean
  legacyFallback?: 'ooxml-block-patch' | string
  shellEntries?: string[]
}

export interface DocumentTemplateHints {
  slotOrder?: string[]
  lockedSlotKeys?: string[]
  styleBindings?: Record<string, string>
  docxTemplateMode?: DocumentDocxTemplateMode
  templateContract?: DocumentTemplateContract
  sectionContracts?: DocumentSectionContract[]
}

export interface DocumentExportHints {
  preferredDelivery?: 'docx' | 'pdf'
  wordSkill?: Record<string, unknown>
  pdfSkill?: Record<string, unknown>
}

interface DocumentBlockBase {
  id: string
  styleRef?: string
  text?: string
  metadata?: Record<string, unknown>
  children?: DocumentBlock[]
}

export interface HeadingBlock extends DocumentBlockBase {
  type: 'heading'
  text: string
  level?: 1 | 2 | 3 | 4 | 5 | 6
}

export interface ParagraphBlock extends DocumentBlockBase {
  type: 'paragraph' | 'html' | 'citation'
  text: string
}

export interface ImageBlock extends DocumentBlockBase {
  type: 'image'
  resourceRef: string
  width?: number
  height?: number
  align?: DocumentImageAlign
  value?: DocumentImageValue
}

export interface SlotBlock extends DocumentBlockBase {
  type: 'slot'
  slotKey: string
  value?: DocumentSlotValue
}

export interface TableBlock extends DocumentBlockBase {
  type: 'table'
  value?: DocumentTableValue
}

export type DocumentBlock = HeadingBlock | ParagraphBlock | ImageBlock | SlotBlock | TableBlock

export interface DocumentSchema {
  version: DocumentSchemaVersion
  id: string
  profile: DocumentProfile
  meta: DocumentMeta
  blocks: DocumentBlock[]
  resources: DocumentResource[]
  document: {
    id: string
    profile: DocumentProfile
    templateId?: string
    metadata?: Record<string, unknown>
  }
  page: DocumentPageSettings
  styles: DocumentStyleTokenMap
  citations?: DocumentSourceRef[]
  sourceRefs?: DocumentSourceRef[]
  exportHints?: DocumentExportHints
  templateHints?: DocumentTemplateHints
  html: string
}

export interface CreateDocumentSchemaInput {
  id: string
  profile: DocumentProfile
  title?: string
  createdAt?: string
  updatedAt?: string
  sourceType?: DocumentSourceType
  templateId?: string
  metadata?: Record<string, unknown>
  page?: Partial<DocumentPageSettings>
  styles?: Record<string, Partial<DocumentStyleToken>>
  blocks?: DocumentBlock[]
  resources?: DocumentResource[]
  citations?: DocumentSourceRefLike[]
  sourceRefs?: DocumentSourceRefLike[]
  exportHints?: DocumentExportHints
  templateHints?: DocumentTemplateHints
  html?: string
  text?: string
  blockIdPrefix?: string
}

export interface BuildDocumentSchemaFromTextInput extends CreateDocumentSchemaInput {
  text?: string
}

export interface BuildDocumentSchemaFromHtmlInput extends CreateDocumentSchemaInput {
  html?: string
}

const DEFAULT_PAGE_SETTINGS: DocumentPageSettings = {
  size: { preset: 'a4' },
  margins: {
    top: { value: 72, unit: 'pt' },
    right: { value: 72, unit: 'pt' },
    bottom: { value: 72, unit: 'pt' },
    left: { value: 72, unit: 'pt' },
  },
  orientation: 'portrait',
}

const DEFAULT_STYLE_TOKENS: DocumentStyleTokenMap = {
  title: { id: 'title', fontFamily: 'Source Serif 4', fontSize: 28, fontWeight: 700, lineHeight: 1.2, spacingAfter: 18, color: '#1f2937' },
  heading: { id: 'heading', fontFamily: 'Source Serif 4', fontSize: 18, fontWeight: 700, lineHeight: 1.3, spacingBefore: 16, spacingAfter: 10, color: '#1f2937' },
  body: { id: 'body', fontFamily: 'Source Serif 4', fontSize: 12, lineHeight: 1.65, spacingAfter: 8, textAlign: 'justify', color: '#111827' },
  caption: { id: 'caption', fontFamily: 'Source Sans 3', fontSize: 10, italic: true, lineHeight: 1.4, spacingBefore: 4, spacingAfter: 10, textAlign: 'center', color: '#4b5563' },
  slot: { id: 'slot', fontFamily: 'Source Sans 3', fontSize: 12, lineHeight: 1.5, spacingAfter: 8, color: '#0f172a', backgroundColor: '#eef4ff' },
  table: { id: 'table', fontFamily: 'Source Sans 3', fontSize: 11, lineHeight: 1.5, spacingAfter: 8, color: '#111827' },
}

function nowIso(): string {
  return new Date().toISOString()
}

function cloneUnknownValue<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T
  } catch {
    return value
  }
}

export { cloneUnknownValue }

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function decodeHtmlEntities(value: string): string {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

function normalizeOptionalString(value: unknown): string | undefined {
  const normalized = String(value ?? '').trim()
  return normalized || undefined
}

function createBlockId(prefix: string, index: number): string {
  return `${prefix || 'block'}-${index + 1}`
}

export function normalizeDocumentSourceRefs(
  refs: DocumentSourceRefLike[] | undefined,
  defaultKind: DocumentSourceRef['kind'] = 'document',
): DocumentSourceRef[] {
  return (refs || []).map((ref, index) => {
    if (typeof ref === 'string') {
      const normalized = ref.trim()
      return {
        id: normalized || `ref-${index + 1}`,
        label: normalized || `ref-${index + 1}`,
        uri: normalized || undefined,
        kind: defaultKind,
      }
    }
    return {
      id: normalizeOptionalString(ref.id) || `ref-${index + 1}`,
      kind: ref.kind || defaultKind,
      label: normalizeOptionalString(ref.label),
      uri: normalizeOptionalString(ref.uri),
      metadata: ref.metadata ? cloneUnknownValue(ref.metadata) : undefined,
    }
  })
}

function htmlToPlainText(html: string): string {
  const raw = String(html || '').trim()
  if (!raw) return ''

  const root = typeof DOMParser !== 'undefined'
    ? new DOMParser().parseFromString(`<div>${raw}</div>`, 'text/html').body.firstElementChild
    : null

  if (root) {
    const pieces = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,td,th'))
      .map((node) => String(node.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    if (pieces.length > 0) return pieces.join('\n\n')
  }

  return decodeHtmlEntities(raw.replace(/<\s*br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '\n'))
}

function parseMarkdownTable(chunk: string): DocumentTableValue | null {
  const lines = chunk.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length < 2) return null
  if (!lines.every((line) => line.includes('|'))) return null
  const cells = lines.map((line) => line.replace(/^\|?|\|?$/g, '').split('|').map((cell) => cell.trim()))
  if (cells.length < 2) return null
  if (!cells[1].every((cell) => /^:?-{3,}:?$/.test(cell))) return null
  return {
    headers: cells[0],
    rows: cells.slice(2),
  }
}

export function createHeadingBlock(input: Omit<HeadingBlock, 'type'>): HeadingBlock {
  return {
    ...input,
    type: 'heading',
    text: String(input.text || '').trim(),
    level: input.level || 1,
  }
}

export function createParagraphBlock(input: string | (Omit<ParagraphBlock, 'type'> & { type?: ParagraphBlock['type'] }), id?: string): ParagraphBlock {
  if (typeof input === 'string') {
    return {
      id: id || `block-${Date.now()}`,
      type: 'paragraph',
      text: input.trim(),
    }
  }
  return {
    ...input,
    type: input.type === 'html' || input.type === 'citation' ? input.type : 'paragraph',
    text: String(input.text || '').trim(),
  }
}

export function createImageBlock(input: Omit<ImageBlock, 'type'>): ImageBlock {
  return {
    ...input,
    type: 'image',
    resourceRef: String(input.resourceRef || '').trim(),
  }
}

export function createSlotBlock(input: Omit<SlotBlock, 'type'>): SlotBlock {
  return {
    ...input,
    type: 'slot',
    slotKey: String(input.slotKey || '').trim(),
  }
}

export function createTableBlock(input: Omit<TableBlock, 'type'>): TableBlock {
  return {
    ...input,
    type: 'table',
  }
}

export function buildDocumentBlocksFromText(input: { text?: string; blockIdPrefix?: string; includeTitle?: string }): DocumentBlock[] {
  const blocks: DocumentBlock[] = []
  const prefix = input.blockIdPrefix || 'block'
  let cursor = 0

  if (normalizeOptionalString(input.includeTitle)) {
    blocks.push(createHeadingBlock({ id: createBlockId(prefix, cursor), level: 1, text: String(input.includeTitle).trim() }))
    cursor += 1
  }

  const chunks = String(input.text || '')
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)

  for (const chunk of chunks) {
    const table = parseMarkdownTable(chunk)
    if (table) {
      blocks.push(createTableBlock({ id: createBlockId(prefix, cursor), value: table }))
      cursor += 1
      continue
    }

    const heading = chunk.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      blocks.push(createHeadingBlock({ id: createBlockId(prefix, cursor), level: Math.min(heading[1].length, 6) as 1 | 2 | 3 | 4 | 5 | 6, text: heading[2].trim() }))
      cursor += 1
      continue
    }

    blocks.push(createParagraphBlock({ id: createBlockId(prefix, cursor), type: 'paragraph', text: chunk }))
    cursor += 1
  }

  return blocks
}

function buildDocumentBlocksFromHtmlInternal(html: string, prefix: string): DocumentBlock[] {
  return buildDocumentBlocksFromText({ text: htmlToPlainText(html), blockIdPrefix: prefix })
}

function mergePageSettings(page: Partial<DocumentPageSettings> | undefined): DocumentPageSettings {
  return {
    size: {
      ...DEFAULT_PAGE_SETTINGS.size,
      ...(page?.size || {}),
    },
    margins: {
      ...DEFAULT_PAGE_SETTINGS.margins,
      ...(page?.margins || {}),
    },
    orientation: page?.orientation || DEFAULT_PAGE_SETTINGS.orientation,
  }
}

function mergeStyles(styles: Record<string, Partial<DocumentStyleToken>> | undefined): DocumentStyleTokenMap {
  const merged: DocumentStyleTokenMap = cloneUnknownValue(DEFAULT_STYLE_TOKENS)
  for (const [key, value] of Object.entries(styles || {})) {
    merged[key] = {
      ...(merged[key] || { id: key }),
      ...value,
      id: key,
    }
  }
  return merged
}

export function cloneDocumentBlocks(blocks: DocumentBlock[]): DocumentBlock[] {
  return cloneUnknownValue(blocks || [])
}

export function cloneDocumentSchema(document: DocumentSchema): DocumentSchema {
  return normalizeDocumentSchema(cloneUnknownValue(document))
}

function serializeDocumentBlocksToHtml(blocks: DocumentBlock[]): string {
  return blocks.map((block) => {
    if (block.type === 'heading') {
      const level = Math.max(1, Math.min(block.level || 1, 6))
      return `<h${level}>${escapeHtml(block.text || '')}</h${level}>`
    }
    if (block.type === 'image') {
      const alt = escapeHtml(String(block.value?.alt || block.text || ''))
      const caption = normalizeOptionalString(block.value?.caption || block.text)
      return `<figure><img src="${escapeHtml(block.resourceRef)}" alt="${alt}" />${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''}</figure>`
    }
    if (block.type === 'slot') {
      const content = escapeHtml(String(block.value?.text || block.text || ''))
      return `<p data-slot-key="${escapeHtml(block.slotKey)}">${content}</p>`
    }
    if (block.type === 'table') {
      const headers = block.value?.headers || []
      const rows = block.value?.rows || []
      const thead = headers.length > 0
        ? `<thead><tr>${headers.map((header) => `<th>${escapeHtml(String(header || ''))}</th>`).join('')}</tr></thead>`
        : ''
      const tbody = `<tbody>${rows.map((row) => `<tr>${(row || []).map((cell) => `<td>${escapeHtml(String(cell ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody>`
      return `<table>${thead}${tbody}</table>`
    }
    return `<p>${escapeHtml(block.text || '')}</p>`
  }).join('\n')
}

export function serializeDocumentSchemaToHtml(document: DocumentSchema): string {
  const normalized = normalizeDocumentSchema(document)
  return serializeDocumentBlocksToHtml(normalized.blocks)
}

export function createDocumentSchema(input: CreateDocumentSchemaInput): DocumentSchema {
  const createdAt = input.createdAt || nowIso()
  const updatedAt = input.updatedAt || createdAt
  const blocks = Array.isArray(input.blocks)
    ? cloneDocumentBlocks(input.blocks)
    : normalizeOptionalString(input.html)
      ? buildDocumentBlocksFromHtmlInternal(String(input.html), input.blockIdPrefix || 'block')
      : buildDocumentBlocksFromText({ text: input.text, blockIdPrefix: input.blockIdPrefix || 'block' })

  const document: DocumentSchema = {
    version: '1.0',
    id: input.id,
    profile: input.profile,
    meta: {
      title: input.title || String(input.metadata?.title || '').trim() || '未命名文稿',
      createdAt,
      updatedAt,
      sourceType: input.sourceType || 'compat',
      templateId: input.templateId,
      version: '1.0',
      ...(input.metadata || {}),
    },
    blocks,
    resources: cloneUnknownValue(input.resources || []),
    document: {
      id: input.id,
      profile: input.profile,
      templateId: input.templateId,
      metadata: cloneUnknownValue(input.metadata || {}),
    },
    page: mergePageSettings(input.page),
    styles: mergeStyles(input.styles),
    citations: input.citations ? normalizeDocumentSourceRefs(input.citations, 'citation') : undefined,
    sourceRefs: input.sourceRefs ? normalizeDocumentSourceRefs(input.sourceRefs, 'document') : undefined,
    exportHints: input.exportHints ? cloneUnknownValue(input.exportHints) : undefined,
    templateHints: input.templateHints ? cloneUnknownValue(input.templateHints) : undefined,
    html: '',
  }

  document.html = normalizeOptionalString(input.html) || serializeDocumentBlocksToHtml(document.blocks)
  return document
}

export function buildDocumentSchemaFromText(input: BuildDocumentSchemaFromTextInput): DocumentSchema {
  return createDocumentSchema({
    ...input,
    blocks: buildDocumentBlocksFromText({
      text: input.text,
      blockIdPrefix: input.blockIdPrefix || 'block',
    }),
  })
}

export function buildDocumentSchemaFromHtml(input: BuildDocumentSchemaFromHtmlInput): DocumentSchema {
  return createDocumentSchema({
    ...input,
    blocks: buildDocumentBlocksFromHtmlInternal(String(input.html || ''), input.blockIdPrefix || 'block'),
    html: String(input.html || ''),
  })
}

export function normalizeDocumentSchema(document: Partial<DocumentSchema> | null | undefined): DocumentSchema {
  if (!document) {
    return createDocumentSchema({
      id: 'document:empty',
      profile: 'freewrite',
      title: '未命名文稿',
      html: '',
      blocks: [],
    })
  }

  return createDocumentSchema({
    id: document.id || 'document:compat',
    profile: document.profile || document.document?.profile || 'freewrite',
    title: document.meta?.title || (document as { title?: string }).title || String(document.document?.metadata?.title || '').trim() || '未命名文稿',
    createdAt: document.meta?.createdAt || nowIso(),
    updatedAt: document.meta?.updatedAt || document.meta?.createdAt || nowIso(),
    sourceType: document.meta?.sourceType || 'compat',
    templateId: document.meta?.templateId || document.document?.templateId,
    metadata: {
      ...(document.document?.metadata || {}),
      ...(document.meta || {}),
    },
    page: document.page,
    styles: document.styles,
    blocks: Array.isArray(document.blocks) ? document.blocks : undefined,
    resources: document.resources,
    citations: document.citations,
    sourceRefs: document.sourceRefs,
    exportHints: document.exportHints,
    templateHints: document.templateHints,
    html: typeof document.html === 'string' ? document.html : undefined,
  })
}