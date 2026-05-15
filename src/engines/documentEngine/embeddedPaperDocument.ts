import { getActiveDocumentEngine } from './registry'
import { markdownToHtml } from '../../utils/markdownToHtml'
import { hasDocumentResultNoise, normalizeDocumentResultMarkdown } from '../../utils/documentResultNormalization'

export const EMBEDDED_DOCUMENT_PAYLOAD_PREFIX = '__AI_WRITER_EMBEDDED_DOC_V1__:'

export interface EmbeddedReferenceListItem {
  id?: string
  text: string
  citationNumber?: number
  title?: string
  year?: number | null
  doi?: string | null
}

export interface EmbeddedFootnoteItem {
  id: string
  text: string
}

export type EmbeddedSemanticRole = 'paragraph' | 'title' | 'abstract-heading' | 'abstract-body' | 'keywords-heading' | 'keywords-body' | 'section-heading' | 'caption' | 'reference-item' | 'footnote-item' | 'references-heading' | 'footnotes-heading'

export interface EmbeddedPayloadTextBlock {
  id?: string
  type: 'paragraph' | 'heading'
  text: string
  level?: number
  paragraphStyle?: string
  paperStyle?: string
  alignment?: 'left' | 'center' | 'right' | 'justify'
  indentLevel?: number
  listType?: 'bullet' | 'number'
  listLevel?: number
  semanticRole?: EmbeddedSemanticRole
}

export interface EmbeddedPayloadImageBlock {
  id?: string
  type: 'image'
  alt: string
  title?: string
  sourceId?: string
  previewSrc?: string
  mediaPath?: string
  mediaContentType?: string
  caption?: string
  footnotes?: EmbeddedFootnoteItem[]
}

export interface EmbeddedPayloadFormulaBlock {
  id?: string
  type: 'formula'
  latex: string
  display: 'inline' | 'block'
}

export interface EmbeddedPayloadTableParagraph {
  text: string
  level?: number
  style?: string
  sourceXml?: string
}

export interface EmbeddedPayloadTableCell {
  text: string
  paragraphs: EmbeddedPayloadTableParagraph[]
  colspan: number
  rowspan: number
  header?: boolean
  width?: string
  column: number
}

export interface EmbeddedPayloadTableBlock {
  id?: string
  type: 'table'
  rows: number
  cols: number
  tableRows: EmbeddedPayloadTableCell[][]
  caption?: string
  columnAlignments?: Array<'left' | 'center' | 'right' | null>
  footnotes?: EmbeddedFootnoteItem[]
  sourceMarkdown?: string
}

export interface EmbeddedPayloadCaptionBlock {
  id?: string
  type: 'caption'
  text: string
  targetType: 'image' | 'table'
  targetId?: string
}

export interface EmbeddedPayloadReferenceListBlock {
  id?: string
  type: 'reference-list'
  heading?: string
  items: EmbeddedReferenceListItem[]
}

export interface EmbeddedPayloadFootnoteListBlock {
  id?: string
  type: 'footnote-list'
  heading?: string
  items: EmbeddedFootnoteItem[]
}

export type EmbeddedPayloadBlock = EmbeddedPayloadTextBlock | EmbeddedPayloadImageBlock | EmbeddedPayloadFormulaBlock | EmbeddedPayloadTableBlock | EmbeddedPayloadCaptionBlock | EmbeddedPayloadReferenceListBlock | EmbeddedPayloadFootnoteListBlock

export interface EmbeddedDocumentPayload {
  version: 1
  source: 'paper-generation'
  blocks: EmbeddedPayloadBlock[]
}

export interface PaperOoxmlSnapshot {
  html?: string
  plainText?: string
  documentXml?: string | null
  contentTypesXml?: string | null
  [key: string]: unknown
}

interface ParsePaperMarkdownOptions {
  references?: Array<{ title?: string; year?: number | null; doi?: string | null }>
}

function normalizeTitleCandidate(text: string): boolean {
  const normalized = String(text || '').trim()
  if (!normalized || normalized.length > 180) return false
  if (/^(摘要|abstract|关键词|关键字|keywords?|参考文献|references)$/i.test(normalized)) return false
  return !/[。！？.!?；;:]$/.test(normalized)
}

function parseImageSyntax(line: string): { alt: string; src: string; title?: string } | null {
  const trimmed = String(line || '').trim()
  const match = trimmed.match(/^!\[([^\]]*)\]\((\S+?)(?:\s+["'](.+?)["'])?\)$/)
  if (!match) return null
  return {
    alt: String(match[1] || '').trim(),
    src: String(match[2] || '').trim(),
    title: match[3] ? String(match[3]).trim() : undefined,
  }
}

function isMarkdownTableSeparator(line: string): boolean {
  return /^\|?(\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?$/.test(String(line || '').trim())
}

function splitMarkdownTableRow(line: string): string[] {
  return String(line || '')
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function isCaptionLine(line: string): boolean {
  return /^(图|表|figure|fig\.?|table)\s*\d+[\s.:：-]/i.test(String(line || '').trim())
}

function isFootnoteHeading(text: string): boolean {
  return /^(脚注|注释|footnotes?|notes?)$/i.test(String(text || '').trim())
}

function isReferencesHeading(text: string): boolean {
  return /^(参考文献|references)$/i.test(String(text || '').trim())
}

function parseFootnoteDefinition(line: string): EmbeddedFootnoteItem | null {
  const match = String(line || '').trim().match(/^\[\^([^\]]+)\]:\s+(.+)$/)
  if (!match) return null
  return {
    id: String(match[1] || '').trim(),
    text: String(match[2] || '').trim(),
  }
}

function parseReferenceLine(line: string, references: ParsePaperMarkdownOptions['references']): EmbeddedReferenceListItem | null {
  const trimmed = String(line || '').trim()
  const numberedMatch = trimmed.match(/^(?:\[(\d+)\]|(\d+)[.)])\s+(.+)$/)
  if (!numberedMatch) return null
  const citationNumber = Number(numberedMatch[1] || numberedMatch[2] || 0) || undefined
  const text = String(numberedMatch[3] || '').trim()
  const matchedReference = citationNumber && references?.[citationNumber - 1] ? references[citationNumber - 1] : undefined
  return {
    text,
    citationNumber,
    title: matchedReference?.title,
    year: matchedReference?.year ?? null,
    doi: matchedReference?.doi ?? null,
  }
}

function formatEmbeddedReferenceItem(item: EmbeddedReferenceListItem, index: number): string {
  const number = item.citationNumber || index + 1
  const text = String(item.text || '').trim()
  if (text) return `[${number}] ${text}`
  const parts = [
    item.title ? String(item.title).trim() : '',
    item.year ? `(${item.year})` : '',
    item.doi ? `DOI: ${item.doi}` : '',
  ].filter(Boolean)
  return `[${number}] ${parts.join(' ').trim() || 'Untitled reference'}`
}

function parseColumnAlignments(separatorLine: string, cols: number): Array<'left' | 'center' | 'right' | null> {
  const cells = splitMarkdownTableRow(separatorLine)
  return Array.from({ length: cols }, (_item, index) => {
    const token = String(cells[index] || '').trim()
    if (/^:-+:$/.test(token)) return 'center'
    if (/^-+:$/.test(token)) return 'right'
    if (/^:-+$/.test(token)) return 'left'
    return null
  })
}

function createTableBlock(lines: string[]): EmbeddedPayloadTableBlock | null {
  if (lines.length < 2 || !isMarkdownTableSeparator(lines[1])) return null
  const headerCells = splitMarkdownTableRow(lines[0])
  if (!headerCells.length) return null

  const bodyRows = lines.slice(2).map(splitMarkdownTableRow).filter((row) => row.length > 0)
  const cols = Math.max(headerCells.length, ...bodyRows.map((row) => row.length))
  const toCell = (text: string, column: number, header = false): EmbeddedPayloadTableCell => ({
    text,
    paragraphs: [{ text }],
    colspan: 1,
    rowspan: 1,
    header,
    column,
  })

  const tableRows: EmbeddedPayloadTableCell[][] = [
    Array.from({ length: cols }, (_item, index) => toCell(headerCells[index] || '', index, true)),
    ...bodyRows.map((row) => Array.from({ length: cols }, (_item, index) => toCell(row[index] || '', index, false))),
  ]

  return {
    type: 'table',
    rows: tableRows.length,
    cols,
    tableRows,
    columnAlignments: parseColumnAlignments(lines[1], cols),
    sourceMarkdown: lines.join('\n'),
  }
}

export function parsePaperMarkdownToEmbeddedBlocks(markdown: string, options: ParsePaperMarkdownOptions = {}): EmbeddedPayloadBlock[] {
  const normalized = String(markdown || '').replace(/\r/g, '').trim()
  if (!normalized) {
    return [{ type: 'paragraph', text: '' }]
  }

  const lines = normalized.split('\n')
  const blocks: EmbeddedPayloadBlock[] = []
  const paragraphBuffer: string[] = []
  let titleAssigned = false
  let sectionMode: 'abstract' | 'keywords' | null = null
  let cursor = 0
  const detachedFootnotes: EmbeddedFootnoteItem[] = []

  const flushParagraph = () => {
    const text = paragraphBuffer.join('\n').trim()
    paragraphBuffer.length = 0
    if (!text) return
    blocks.push({
      type: 'paragraph',
      text,
      paragraphStyle: sectionMode === 'abstract' ? 'Abstract' : sectionMode === 'keywords' ? 'Keywords' : undefined,
      alignment: sectionMode === 'abstract' ? 'justify' : sectionMode === 'keywords' ? 'left' : 'justify',
      semanticRole: sectionMode === 'abstract' ? 'abstract-body' : sectionMode === 'keywords' ? 'keywords-body' : 'paragraph',
    })
  }

  while (cursor < lines.length) {
    const rawLine = lines[cursor]
    const line = String(rawLine || '').trim()

    if (!line) {
      flushParagraph()
      cursor += 1
      continue
    }

    const detachedFootnote = parseFootnoteDefinition(line)
    if (detachedFootnote) {
      flushParagraph()
      detachedFootnotes.push(detachedFootnote)
      cursor += 1
      continue
    }

    const formulaStart = line.match(/^\$\$(.*)$/)
    if (formulaStart) {
      flushParagraph()
      const formulaLines: string[] = []
      let firstLine = formulaStart[1] || ''
      if (firstLine.trim()) formulaLines.push(firstLine)
      cursor += 1
      let closed = /\$\$$/.test(line)
      if (closed && firstLine.replace(/\$\$$/, '').trim()) {
        formulaLines[0] = firstLine.replace(/\$\$$/, '').trim()
      }
      while (!closed && cursor < lines.length) {
        const nextLine = String(lines[cursor] || '')
        if (/\$\$$/.test(nextLine.trim())) {
          const trimmed = nextLine.trim().replace(/\$\$$/, '').trim()
          if (trimmed) formulaLines.push(trimmed)
          closed = true
          cursor += 1
          break
        }
        formulaLines.push(nextLine)
        cursor += 1
      }
      blocks.push({
        type: 'formula',
        latex: formulaLines.join('\n').trim(),
        display: 'block',
      })
      continue
    }

    if (cursor + 1 < lines.length && line.includes('|') && isMarkdownTableSeparator(lines[cursor + 1])) {
      flushParagraph()
      const tableLines = [line, String(lines[cursor + 1] || '').trim()]
      cursor += 2
      while (cursor < lines.length && String(lines[cursor] || '').trim().includes('|')) {
        tableLines.push(String(lines[cursor] || '').trim())
        cursor += 1
      }
      const tableBlock = createTableBlock(tableLines)
      if (tableBlock) {
        while (cursor < lines.length && !String(lines[cursor] || '').trim()) cursor += 1
        if (cursor < lines.length && isCaptionLine(lines[cursor])) {
          tableBlock.caption = String(lines[cursor] || '').trim()
          blocks.push(tableBlock)
          blocks.push({ type: 'caption', text: tableBlock.caption, targetType: 'table' })
          cursor += 1
        } else {
          blocks.push(tableBlock)
        }
        sectionMode = null
        continue
      }
    }

    const image = parseImageSyntax(line)
    if (image) {
      flushParagraph()
      blocks.push({
        type: 'image',
        alt: image.alt || 'image',
        title: image.title,
        sourceId: image.src,
        previewSrc: image.src,
      })
      while (cursor + 1 < lines.length && !String(lines[cursor + 1] || '').trim()) cursor += 1
      if (cursor + 1 < lines.length && isCaptionLine(lines[cursor + 1])) {
        const captionText = String(lines[cursor + 1] || '').trim()
        const lastBlock = blocks[blocks.length - 1]
        if (lastBlock?.type === 'image') {
          lastBlock.caption = captionText
        }
        blocks.push({ type: 'caption', text: captionText, targetType: 'image' })
        cursor += 1
      }
      cursor += 1
      continue
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      flushParagraph()
      const level = Math.max(1, Math.min(headingMatch[1].length, 6))
      const headingText = headingMatch[2].trim()
      if (!titleAssigned && level === 1 && normalizeTitleCandidate(headingText)) {
        blocks.push({ type: 'paragraph', text: headingText, paragraphStyle: 'Title', alignment: 'center' })
        titleAssigned = true
        sectionMode = null
        cursor += 1
        continue
      }
      if (/^(摘要|abstract)$/i.test(headingText)) {
        blocks.push({ type: 'heading', level: 1, text: headingText, paragraphStyle: 'AbstractHeading', alignment: 'center', semanticRole: 'abstract-heading' })
        sectionMode = 'abstract'
        cursor += 1
        continue
      }
      if (/^(关键词|关键字|keywords?)$/i.test(headingText)) {
        blocks.push({ type: 'heading', level: 1, text: headingText, paragraphStyle: 'KeywordsHeading', alignment: 'left', semanticRole: 'keywords-heading' })
        sectionMode = 'keywords'
        cursor += 1
        continue
      }
      if (isReferencesHeading(headingText)) {
        flushParagraph()
        const items: EmbeddedReferenceListItem[] = []
        cursor += 1
        while (cursor < lines.length) {
          const candidate = String(lines[cursor] || '').trim()
          if (!candidate) {
            cursor += 1
            continue
          }
          if (/^#{1,6}\s+/.test(candidate)) break
          const referenceItem = parseReferenceLine(candidate, options.references)
          if (!referenceItem) break
          items.push(referenceItem)
          cursor += 1
        }
        blocks.push({ type: 'reference-list', heading: headingText, items })
        sectionMode = null
        continue
      }
      if (isFootnoteHeading(headingText)) {
        flushParagraph()
        const items: EmbeddedFootnoteItem[] = []
        cursor += 1
        while (cursor < lines.length) {
          const candidate = String(lines[cursor] || '').trim()
          if (!candidate) {
            cursor += 1
            continue
          }
          if (/^#{1,6}\s+/.test(candidate)) break
          const footnoteItem = parseFootnoteDefinition(candidate)
          if (footnoteItem) {
            items.push(footnoteItem)
            cursor += 1
            continue
          }
          items.push({ id: String(items.length + 1), text: candidate })
          cursor += 1
        }
        blocks.push({ type: 'footnote-list', heading: headingText, items })
        sectionMode = null
        continue
      }
      blocks.push({ type: 'heading', level, text: headingText, paragraphStyle: `Heading${level}` })
      titleAssigned = true
      sectionMode = null
      cursor += 1
      continue
    }

    if (!titleAssigned && normalizeTitleCandidate(line)) {
      flushParagraph()
      blocks.push({ type: 'paragraph', text: line, paragraphStyle: 'Title', alignment: 'center', semanticRole: 'title' })
      titleAssigned = true
      cursor += 1
      continue
    }

    paragraphBuffer.push(line)
    cursor += 1
  }

  flushParagraph()
  if (detachedFootnotes.length > 0) {
    blocks.push({ type: 'footnote-list', heading: 'Footnotes', items: detachedFootnotes })
  }
  return blocks.length ? blocks : [{ type: 'paragraph', text: '' }]
}

export function encodeEmbeddedDocumentPayload(blocks: EmbeddedPayloadBlock[]): string {
  const payload: EmbeddedDocumentPayload = {
    version: 1,
    source: 'paper-generation',
    blocks,
  }
  return `${EMBEDDED_DOCUMENT_PAYLOAD_PREFIX}${JSON.stringify(payload)}`
}

export function decodeEmbeddedDocumentPayload(content: string): EmbeddedDocumentPayload | null {
  const source = String(content || '')
  if (!source.startsWith(EMBEDDED_DOCUMENT_PAYLOAD_PREFIX)) return null
  try {
    const parsed = JSON.parse(source.slice(EMBEDDED_DOCUMENT_PAYLOAD_PREFIX.length)) as EmbeddedDocumentPayload
    if (parsed?.version !== 1 || !Array.isArray(parsed.blocks)) return null
    return parsed
  } catch {
    return null
  }
}

export function buildEmbeddedPaperDocumentPayload(markdown: string): string {
  return encodeEmbeddedDocumentPayload(parsePaperMarkdownToEmbeddedBlocks(markdown))
}

export function buildEmbeddedPaperDocumentPayloadFromBlocks(blocks: EmbeddedPayloadBlock[]): string {
  return encodeEmbeddedDocumentPayload(blocks)
}

function serializeTableToMarkdown(block: EmbeddedPayloadTableBlock): string {
  if (block.sourceMarkdown?.trim()) return block.sourceMarkdown.trim()
  if (!Array.isArray(block.tableRows) || block.tableRows.length === 0) return ''
  const rows = block.tableRows.map((row) => row.map((cell) => String(cell?.text || '').replace(/\n/g, '<br>').trim()))
  const header = rows[0] || Array.from({ length: block.cols }, () => '')
  const alignments = Array.from({ length: header.length || block.cols || 1 }, (_item, index) => {
    const alignment = block.columnAlignments?.[index]
    if (alignment === 'center') return ':---:'
    if (alignment === 'right') return '---:'
    if (alignment === 'left') return ':---'
    return '---'
  })
  const body = rows.slice(1)
  return [
    `| ${header.join(' | ')} |`,
    `| ${alignments.join(' | ')} |`,
    ...body.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')
}

function ensureMarkdownHeading(text: string | undefined, fallback: string): string {
  const normalized = String(text || '').trim()
  if (!normalized) return fallback
  return /^#{1,6}\s+/.test(normalized) ? normalized : `## ${normalized}`
}

export function serializeEmbeddedBlocksToMarkdown(blocks: EmbeddedPayloadBlock[]): string {
  return blocks.map((block) => {
    if (block.type === 'paragraph') return block.text
    if (block.type === 'heading') return `${'#'.repeat(Math.max(1, Math.min(block.level || 1, 6)))} ${block.text}`
    if (block.type === 'image') return `![${block.alt || 'image'}](${block.previewSrc || block.sourceId || ''})`
    if (block.type === 'formula') return block.display === 'inline' ? `$${block.latex}$` : `$$\n${block.latex}\n$$`
    if (block.type === 'table') return serializeTableToMarkdown(block)
    if (block.type === 'caption') return block.text
    if (block.type === 'reference-list') {
      const lines = block.items.map((item, index) => formatEmbeddedReferenceItem(item, index))
      return [ensureMarkdownHeading(block.heading, '## References'), ...lines].join('\n\n')
    }
    if (block.type === 'footnote-list') {
      const lines = block.items.map((item, index) => `[^${item.id || index + 1}]: ${item.text}`)
      return [ensureMarkdownHeading(block.heading, '## Footnotes'), ...lines].join('\n')
    }
    return ''
  }).filter(Boolean).join('\n\n').trim()
}

function htmlToPlainText(html: string): string {
  return String(html || '')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function extractPaperTextFromOoxmlSnapshot(snapshot?: Record<string, unknown> | null): string {
  const normalizedSnapshot = snapshot as PaperOoxmlSnapshot | undefined
  const html = typeof normalizedSnapshot?.html === 'string' ? normalizedSnapshot.html.trim() : ''
  if (html) return htmlToPlainText(html)
  const plainText = typeof normalizedSnapshot?.plainText === 'string' ? normalizedSnapshot.plainText.trim() : ''
  return plainText
}

export function extractPaperHtmlFromOoxmlSnapshot(snapshot?: Record<string, unknown> | null): string {
  const normalizedSnapshot = snapshot as PaperOoxmlSnapshot | undefined
  return typeof normalizedSnapshot?.html === 'string' ? normalizedSnapshot.html.trim() : ''
}

export function buildPaperGenerationPreviewContent(markdown: string, structuredBlocks?: EmbeddedPayloadBlock[], ooxmlSnapshot?: Record<string, unknown>): string {
  const snapshotHtml = extractPaperHtmlFromOoxmlSnapshot(ooxmlSnapshot)
  const snapshotPlainText = extractPaperTextFromOoxmlSnapshot(ooxmlSnapshot)
  const fallbackMarkdown = structuredBlocks && structuredBlocks.length > 0 ? serializeEmbeddedBlocksToMarkdown(structuredBlocks) : ''
  const effectiveMarkdown = normalizeDocumentResultMarkdown(String(markdown || '').trim() || fallbackMarkdown)
  const engine = getActiveDocumentEngine()
  if (engine.id !== 'embedded-office-engine' && effectiveMarkdown) {
    return markdownToHtml(effectiveMarkdown)
  }
  if (snapshotHtml && !hasDocumentResultNoise(snapshotPlainText)) {
    return snapshotHtml
  }
  if (engine.id === 'embedded-office-engine') {
    return buildEmbeddedPaperDocumentPayloadFromBlocks(structuredBlocks && structuredBlocks.length > 0 ? structuredBlocks : parsePaperMarkdownToEmbeddedBlocks(effectiveMarkdown))
  }
  return markdownToHtml(effectiveMarkdown)
}
