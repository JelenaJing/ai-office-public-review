/**
 * paperResultNormalizer
 *
 * Unified converter: PaperGenerationResult → DocumentSchema.
 * Both the one-shot NFTCORE chain and the step-by-step paperProjectRunner chain
 * call normalizePaperGenerationResultToDocumentSchema() at finalize time.
 *
 * assembledMarkdown stays for streaming preview;
 * DocumentSchema is the persisted, structured authority.
 */

import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import {
  createDocumentSchema,
  createHeadingBlock,
  createParagraphBlock,
  createImageBlock,
  type DocumentSchema,
  type DocumentResource,
  type DocumentBlock,
  type DocumentSourceRef,
  type DocumentCitationMark,
  type DocumentBibliography,
  type DocumentBibliographyItem,
} from '../../../src/document/schema/index'
import { collectCitationOrder, updateCitationNumbersInText } from '../../../src/utils/citationGroups'
import type { ReferenceItem } from './openAlexClient'
import type { FigureInfo } from './advancedFigureGenerator'

// ── Types ──────────────────────────────────────────────────────────────────

/** Minimal shape shared by both PaperGenerationResult.images variants. */
export interface PaperImageEntry {
  /** Section number string (e.g. "1", "2") or section title. */
  section?: string
  /** Numeric section number from advanced figure generation. */
  sectionNum?: number
  /** Resolved human-readable section title. */
  sectionTitle?: string
  /** Absolute local file path. */
  path?: string
  /** Figure caption text. */
  caption?: string
  /** Pre-built markdown snippet for this image. */
  markdown?: string
  /** file:// or http URL for the image. */
  url?: string
  /** Optional explicit placement anchors for paper-generated figures. */
  afterHeadingText?: string
  afterBlockId?: string
  anchorParagraphText?: string
  placementFallback?: boolean
}

export interface PaperGenerationResultLike {
  title?: string
  markdown?: string
  references?: ReferenceItem[]
  images?: PaperImageEntry[]
}

export interface DocumentImageResource {
  resource: DocumentResource
  block: DocumentBlock
}

function normalizeLocalFilePath(value: string): string {
  const raw = String(value || '').trim()
  if (!raw) return raw
  if (raw.startsWith('file://')) {
    try {
      const url = new URL(raw)
      const pathname = decodeURI(url.pathname || '')
      return /^\/[a-zA-Z]:[\\/]/.test(pathname) ? pathname.slice(1) : pathname
    } catch {
      const stripped = decodeURI(raw.replace(/^file:\/\//, ''))
      return /^\/[a-zA-Z]:[\\/]/.test(stripped) ? stripped.slice(1) : stripped
    }
  }
  return /^\/[a-zA-Z]:[\\/]/.test(raw) ? raw.slice(1) : raw
}

function getFileSizeIfExists(filePath: string): number {
  try {
    const stat = statSync(filePath)
    return stat.isFile() ? stat.size : 0
  } catch {
    return 0
  }
}

interface ImagePlacementStats {
  unmatchedImageCount: number
  fallbackImageCount: number
  imagePlacementMode: 'markdown' | 'section-anchor' | 'mixed' | 'fallback' | 'none'
}

// ── Figure normalizer ──────────────────────────────────────────────────────

/**
 * Convert a FigureInfo (from advancedFigureGenerator) into a
 * DocumentResource + ImageBlock pair ready for DocumentSchema.
 *
 * DocumentResource.metadata stores all paper-specific fields:
 *   localPath, relativePath, caption, sectionTitle, figureIndex, alt, source
 */
export function normalizeFigureToDocumentResource(
  fig: FigureInfo,
  options?: { blockIdPrefix?: string; blockIndex?: number },
): DocumentImageResource {
  const resourceId = `resource-image-s${fig.sectionNum}-f${fig.figureIndex}`
  const blockId = `${options?.blockIdPrefix || 'paper-block'}-img-s${fig.sectionNum}-f${options?.blockIndex ?? fig.figureIndex}`

  const altText = fig.caption || `Figure ${fig.sectionNum}.${fig.figureIndex}`
  const localPathForward = String(fig.localPath || '').replace(/\\/g, '/')
  const normalizedLocalPath = normalizeLocalFilePath(String(fig.localPath || ''))
  const imagePathExists = normalizedLocalPath ? existsSync(normalizedLocalPath) : false
  const imageFileSize = imagePathExists ? getFileSizeIfExists(normalizedLocalPath) : 0

  const resource: DocumentResource = {
    id: resourceId,
    kind: 'image',
    path: fig.localPath || fig.url || '',
    metadata: {
      localPath: fig.localPath || undefined,
      relativePath: localPathForward || undefined,
      caption: fig.caption || undefined,
      sectionTitle: fig.sectionTitle || undefined,
      figureIndex: fig.figureIndex,
      sectionNum: fig.sectionNum,
      alt: altText,
      source: 'paper-generation',
      pathExists: imagePathExists,
      fileSize: imageFileSize,
    },
  }
  console.info('[paper:image_resource_written]', {
    resourceId,
    resourcePath: resource.path,
    workspaceRelativePath: resource.metadata?.relativePath || '',
    localPath: normalizedLocalPath,
    fileExists: imagePathExists,
    fileSize: imageFileSize,
  })

  const block = createImageBlock({
    id: blockId,
    resourceRef: resourceId,
    value: {
      alt: altText,
      caption: fig.caption || undefined,
      text: fig.caption || undefined,
    },
    metadata: {
      sectionTitle: fig.sectionTitle || undefined,
      figureIndex: fig.figureIndex,
      sectionNum: fig.sectionNum,
      localPath: fig.localPath || undefined,
      caption: fig.caption || undefined,
      alt: altText,
      source: 'paper-generation',
    },
  })

  return { resource, block }
}

/**
 * Convert a generic PaperImageEntry (from PaperGenerationResult.images)
 * into a DocumentResource + ImageBlock pair.
 */
export function normalizePaperImageEntryToDocumentResource(
  img: PaperImageEntry,
  sectionNum: number,
  figureIndex: number,
  options?: { blockIdPrefix?: string; blockIndex?: number },
): DocumentImageResource {
  const fig: FigureInfo = {
    sectionNum,
    sectionTitle: img.sectionTitle || img.section || '',
    figureIndex,
    localPath: img.path || '',
    url: img.url || img.path || '',
    caption: img.caption || '',
    markdown: img.markdown || '',
  }
  return normalizeFigureToDocumentResource(fig, options)
}

// ── Citation helpers ───────────────────────────────────────────────────────

/**
 * Scan assembled markdown for inline citation marks like [1], [2,3], [4-6].
 * Returns a sorted, deduplicated array of referenced citation numbers.
 * Ranges like [4-6] are expanded to [4, 5, 6].
 */
export function scanMarkdownCitations(markdown: string): number[] {
  const nums = new Set<number>()
  const pattern = /\[(\d+(?:\s*[,\-]\s*\d+)*)\]/g
  let m: RegExpExecArray | null
  while ((m = pattern.exec(String(markdown || ''))) !== null) {
    const segment = m[1]
    // Split by comma first to get individual parts or ranges
    for (const commaPart of segment.split(',')) {
      const dashParts = commaPart.trim().split('-').map((p) => p.trim())
      if (dashParts.length === 2) {
        // It's a range like "4-6"
        const start = Number.parseInt(dashParts[0], 10)
        const end = Number.parseInt(dashParts[1], 10)
        if (!Number.isNaN(start) && !Number.isNaN(end) && start > 0 && end >= start) {
          for (let n = start; n <= end; n++) nums.add(n)
        }
      } else {
        const n = Number.parseInt(dashParts[0], 10)
        if (!Number.isNaN(n) && n > 0) nums.add(n)
      }
    }
  }
  return Array.from(nums).sort((a, b) => a - b)
}

/**
 * Build DocumentSourceRef entries (bibliography compat array) from a ReferenceItem array.
 * Each entry uses kind='citation'. This is a compat helper; the canonical authority is
 * DocumentBibliography returned from buildOrderedCitationBibliography().
 */
export function buildBibliographySourceRefs(references: ReferenceItem[]): DocumentSourceRef[] {
  return (references || []).map((ref, idx) => ({
    id: `citation-${idx + 1}`,
    kind: 'citation' as const,
    label: `[${idx + 1}] ${String(ref.title || '').trim()}`.trim(),
    uri: ref.doi
      ? `https://doi.org/${String(ref.doi).trim()}`
      : (String(ref.url || '').trim() || undefined),
    metadata: {
      citationNumber: idx + 1,
      title: ref.title,
      authors: Array.isArray(ref.authors) ? ref.authors : [],
      year: ref.year ?? undefined,
      journal: ref.journal || undefined,
      doi: ref.doi || undefined,
      abstract: ref.abstract || undefined,
    },
  }))
}

// ── Ordered citation bibliography builder ─────────────────────────────────

interface CitationBibliographyResult {
  bibliography: DocumentBibliography
  /** Maps original citation number (1-based, from references array) → new display number */
  remap: Map<number, number>
  /** Maps original citation number → new citation ID ("citation-N") */
  idRemap: Map<number, string>
}

/**
 * Build a DocumentBibliography whose items are ordered by first appearance
 * in the document body text (excluding the references section itself).
 *
 * Returns the bibliography, plus remap/idRemap to renumber existing citation marks.
 */
function buildOrderedCitationBibliography(
  references: ReferenceItem[],
  blocks: DocumentBlock[],
): CitationBibliographyResult {
  const N = references.length
  const empty: CitationBibliographyResult = {
    bibliography: { items: [], generatedAt: new Date().toISOString() },
    remap: new Map(),
    idRemap: new Map(),
  }
  if (!N) return empty

  // Collect first-appearance order of citation numbers (1..N) across body blocks
  const seen = new Set<number>()
  const appearanceOrder: number[] = []
  for (const block of blocks) {
    if (block.metadata?.role === 'references-section') continue
    if (block.type !== 'paragraph' && block.type !== 'heading') continue
    const text = String((block as { text?: string }).text || '')
    for (const num of collectCitationOrder(text)) {
      if (num >= 1 && num <= N && !seen.has(num)) {
        seen.add(num)
        appearanceOrder.push(num)
      }
    }
  }
  // Append any unreferenced citations at the end (so all refs appear in bibliography)
  for (let i = 1; i <= N; i++) {
    if (!seen.has(i)) appearanceOrder.push(i)
  }

  const remap = new Map<number, number>()
  const idRemap = new Map<number, string>()
  const items: DocumentBibliographyItem[] = []

  for (let idx = 0; idx < appearanceOrder.length; idx++) {
    const originalNum = appearanceOrder[idx]
    const newNum = idx + 1
    const newId = `citation-${newNum}`
    remap.set(originalNum, newNum)
    idRemap.set(originalNum, newId)

    const ref = references[originalNum - 1]
    if (!ref) continue
    items.push({
      id: newId,
      citationNumber: newNum,
      label: `[${newNum}] ${String(ref.title || '').trim()}`,
      uri: ref.doi
        ? `https://doi.org/${String(ref.doi).trim()}`
        : (String(ref.url || '').trim() || undefined),
      metadata: {
        citationNumber: newNum,
        title: ref.title,
        authors: Array.isArray(ref.authors) ? ref.authors : [],
        year: ref.year ?? undefined,
        journal: ref.journal || undefined,
        doi: ref.doi || undefined,
        abstract: ref.abstract || undefined,
        originalCitationNumber: originalNum,
      },
    })
  }

  return { bibliography: { items, generatedAt: new Date().toISOString() }, remap, idRemap }
}

// ── References-section marker ─────────────────────────────────────────────

const REFS_HEADING_PATTERN = /^(参考文献|References|REFERENCES|Bibliography|参考资料)/

/**
 * Mark heading and paragraph blocks that belong to the references section with
 * `metadata.role = "references-section"`.  The references section is detected
 * as the last heading matching common reference titles; everything after it is
 * also marked.
 */
function markReferencesSection(blocks: DocumentBlock[]): DocumentBlock[] {
  let inRefsSection = false
  return blocks.map((block) => {
    if (block.type === 'heading') {
      if (REFS_HEADING_PATTERN.test(String((block as { text?: string }).text || ''))) {
        inRefsSection = true
        return { ...block, metadata: { ...(block.metadata || {}), role: 'references-section' } }
      }
    }
    if (inRefsSection) {
      return { ...block, metadata: { ...(block.metadata || {}), role: 'references-section' } }
    }
    return block
  })
}

// ── Citation-mark annotator ───────────────────────────────────────────────

/**
 * Annotate each ParagraphBlock with metadata.citationMarks (using remapped IDs/numbers)
 * and update block.text so inline [N] markers reflect the new numbering.
 */
function annotateCitationMarks(
  blocks: DocumentBlock[],
  remap: Map<number, number>,
  idRemap: Map<number, string>,
): DocumentBlock[] {
  if (!remap.size) return blocks
  const citationPattern = /\[(\d+(?:\s*[,\-]\s*\d+)*)\]/g
  return blocks.map((block) => {
    if (block.type !== 'paragraph') return block
    // References-section paragraphs already have their own [N] text; skip annotation.
    if (block.metadata?.role === 'references-section') return block
    const text = String(block.text || '')

    // Extract citation marks from text using current (original) numbers
    const marks: DocumentCitationMark[] = []
    citationPattern.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = citationPattern.exec(text)) !== null) {
      const rawMark = m[0]
      const offset = m.index
      for (const commaPart of m[1].split(',')) {
        const dashParts = commaPart.trim().split('-').map((p) => p.trim())
        if (dashParts.length === 2) {
          const s = Number.parseInt(dashParts[0], 10)
          const e = Number.parseInt(dashParts[1], 10)
          if (!Number.isNaN(s) && !Number.isNaN(e)) {
            for (let n = s; n <= e; n++) {
              const newNum = remap.get(n)
              const citationId = idRemap.get(n)
              if (newNum !== undefined && citationId) {
                marks.push({ citationId, citationNumber: newNum, rawMark, offset })
              }
            }
          }
        } else {
          const n = Number.parseInt(dashParts[0], 10)
          if (!Number.isNaN(n)) {
            const newNum = remap.get(n)
            const citationId = idRemap.get(n)
            if (newNum !== undefined && citationId) {
              marks.push({ citationId, citationNumber: newNum, rawMark, offset })
            }
          }
        }
      }
    }

    // Renumber [N] markers in the text itself
    const newText = updateCitationNumbersInText(text, remap as Map<number, number | null | undefined>)

    if (!marks.length && newText === text) return block
    return {
      ...block,
      text: newText,
      metadata: {
        ...(block.metadata || {}),
        ...(marks.length ? { citationMarks: marks } : {}),
      },
    }
  })
}

// ── Markdown → DocumentBlocks ──────────────────────────────────────────────

function parseMarkdownTable(chunk: string): boolean {
  const lines = chunk.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) return false
  if (!lines.every((l) => l.includes('|'))) return false
  return lines.length >= 2 && !!lines[1] && /^[\s|:-]+$/.test(lines[1])
}

function normalizeAnchorText(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/^#{1,6}\s+/, '')
    .replace(/^第[一二三四五六七八九十百]+[章节部分]\s*/u, '')
    .replace(/^\s*\d+(?:\.\d+)*[.、\s-]*/u, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim()
}

function extractImageSectionNum(image: PaperImageEntry, fallback: number): number {
  const direct = typeof image.sectionNum === 'number'
    ? image.sectionNum
    : Number.parseInt(String(image.section || ''), 10)
  return Number.isFinite(direct) && direct > 0 ? direct : fallback
}

function getCaptionFromImageBlock(block: DocumentBlock): string {
  if (block.type !== 'image') return ''
  return String(block.value?.caption || block.value?.text || block.metadata?.caption || '').trim()
}

function isFigureCaptionText(text: string): boolean {
  const normalized = String(text || '').trim().replace(/^\*\*(.+)\*\*$/, '$1').trim()
  return /^(?:Figure|Fig\.?|图|图表)\s*\d+(?:\.\d+)*[\s:：.．-]/i.test(normalized)
}

function figureNumberKey(text: string): string {
  const normalized = String(text || '').trim().replace(/^\*\*(.+)\*\*$/, '$1').trim()
  const match = normalized.match(/^(?:Figure|Fig\.?|图|图表)\s*(\d+(?:\.\d+)*)/i)
  return match ? match[1] : ''
}

function mergeCaptionIntoImageBlock(block: DocumentBlock, caption: string): DocumentBlock {
  if (block.type !== 'image') return block
  const normalizedCaption = String(caption || '').trim().replace(/^\*\*(.+)\*\*$/, '$1').trim()
  if (!normalizedCaption) return block
  const existing = getCaptionFromImageBlock(block)
  if (existing && normalizeAnchorText(existing) === normalizeAnchorText(normalizedCaption)) return block
  return {
    ...block,
    value: {
      ...(block.value || {}),
      caption: existing || normalizedCaption,
      text: existing || normalizedCaption,
      alt: block.value?.alt || existing || normalizedCaption,
    },
    metadata: {
      ...(block.metadata || {}),
      caption: existing || normalizedCaption,
      alt: block.metadata?.alt || existing || normalizedCaption,
    },
  }
}

function applyImagePlacementMetadata(
  block: DocumentBlock,
  image: PaperImageEntry,
  placement: {
    sectionNum: number
    afterHeadingText?: string
    afterBlockId?: string
    anchorParagraphText?: string
    placementFallback: boolean
    placementMode: 'markdown' | 'section-title' | 'section-num' | 'fallback'
  },
): DocumentBlock {
  if (block.type !== 'image') return block
  return {
    ...block,
    metadata: {
      ...(block.metadata || {}),
      source: 'paper-generation',
      caption: block.metadata?.caption || image.caption || block.value?.caption || undefined,
      sectionTitle: image.sectionTitle || image.section || block.metadata?.sectionTitle || undefined,
      sectionNum: placement.sectionNum,
      afterHeadingText: placement.afterHeadingText,
      afterBlockId: placement.afterBlockId,
      anchorParagraphText: placement.anchorParagraphText,
      placementFallback: placement.placementFallback,
      placementMode: placement.placementMode,
    },
  }
}

function findSectionAnchorBlockIndex(
  blocks: DocumentBlock[],
  image: PaperImageEntry,
): { insertAfterIndex: number; afterHeadingText?: string; afterBlockId?: string; anchorParagraphText?: string; mode: 'section-title' | 'section-num' } | null {
  const imageTitle = normalizeAnchorText(image.sectionTitle || image.section || '')
  const sectionNum = String(image.sectionNum ?? image.section ?? '').trim()
  const explicitAfterBlockId = String(image.afterBlockId || '').trim()
  if (explicitAfterBlockId) {
    const explicitIndex = blocks.findIndex((block) => block.id === explicitAfterBlockId)
    if (explicitIndex >= 0) {
      const explicit = blocks[explicitIndex]
      return {
        insertAfterIndex: explicitIndex,
        afterHeadingText: explicit.type === 'heading' ? explicit.text : undefined,
        afterBlockId: explicit.id,
        anchorParagraphText: explicit.type === 'paragraph' ? explicit.text : undefined,
        mode: imageTitle ? 'section-title' : 'section-num',
      }
    }
  }

  let headingIndex = -1
  let matchMode: 'section-title' | 'section-num' = 'section-title'
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (block.metadata?.role === 'references-section') break
    if (block.type !== 'heading') continue
    const headingText = String(block.text || '')
    const normalizedHeading = normalizeAnchorText(headingText)
    if (imageTitle && (normalizedHeading.includes(imageTitle) || imageTitle.includes(normalizedHeading))) {
      headingIndex = i
      matchMode = 'section-title'
      break
    }
    if (sectionNum && new RegExp(`^\\s*(?:第\\s*)?${sectionNum.replace(/\./g, '\\.')}[\\.、\\s-]`).test(headingText)) {
      headingIndex = i
      matchMode = 'section-num'
      break
    }
  }

  if (headingIndex < 0) return null

  let insertAfterIndex = headingIndex
  let paragraphsSeen = 0
  for (let i = headingIndex + 1; i < blocks.length; i++) {
    const block = blocks[i]
    if (block.metadata?.role === 'references-section') break
    if (block.type === 'heading') break
    if (block.type === 'paragraph' && String(block.text || '').trim()) {
      paragraphsSeen += 1
      insertAfterIndex = i
      if (paragraphsSeen >= 2) break
    }
  }

  const heading = blocks[headingIndex]
  const anchor = blocks[insertAfterIndex]
  return {
    insertAfterIndex,
    afterHeadingText: heading.type === 'heading' ? heading.text : undefined,
    afterBlockId: anchor.id,
    anchorParagraphText: anchor.type === 'paragraph' ? anchor.text : undefined,
    mode: matchMode,
  }
}

function insertImageBlockNearSection(
  blocks: DocumentBlock[],
  imageBlock: DocumentBlock,
  image: PaperImageEntry,
  sectionNum: number,
): { fallback: boolean } {
  const anchor = findSectionAnchorBlockIndex(blocks, image)
  if (anchor) {
    blocks.splice(anchor.insertAfterIndex + 1, 0, applyImagePlacementMetadata(imageBlock, image, {
      sectionNum,
      afterHeadingText: anchor.afterHeadingText,
      afterBlockId: anchor.afterBlockId,
      anchorParagraphText: anchor.anchorParagraphText,
      placementFallback: false,
      placementMode: anchor.mode,
    }))
    return { fallback: false }
  }

  const refsIndex = blocks.findIndex((block) => block.metadata?.role === 'references-section')
  const insertIndex = refsIndex >= 0 ? refsIndex : blocks.length
  blocks.splice(insertIndex, 0, applyImagePlacementMetadata(imageBlock, image, {
    sectionNum,
    placementFallback: true,
    placementMode: 'fallback',
  }))
  return { fallback: true }
}

function dedupeFigureCaptions(blocks: DocumentBlock[]): DocumentBlock[] {
  const result: DocumentBlock[] = []
  let lastImageCaption = ''
  let lastImageFigure = ''
  let lastCaptionParagraph = ''
  let lastCaptionFigure = ''
  for (const block of blocks) {
    if (block.type === 'image') {
      const caption = getCaptionFromImageBlock(block)
      result.push(block)
      lastImageCaption = normalizeAnchorText(caption)
      lastImageFigure = figureNumberKey(caption || String(block.value?.alt || block.metadata?.alt || ''))
      lastCaptionParagraph = ''
      lastCaptionFigure = ''
      continue
    }

    if (block.type === 'paragraph' && (block.metadata?.role === 'figure-caption' || isFigureCaptionText(block.text))) {
      const normalized = normalizeAnchorText(block.text)
      const figure = figureNumberKey(block.text)
      if (normalized && (
        normalized === lastImageCaption
        || normalized === lastCaptionParagraph
        || (figure && (figure === lastImageFigure || figure === lastCaptionFigure))
      )) {
        continue
      }
      lastCaptionParagraph = normalized
      lastCaptionFigure = figure
      result.push(block)
      continue
    }

    lastImageCaption = ''
    lastImageFigure = ''
    lastCaptionParagraph = ''
    lastCaptionFigure = ''
    result.push(block)
  }
  return result
}

/**
 * Parse assembled markdown into DocumentBlocks, replacing image markdown
 * lines with proper ImageBlocks that reference DocumentResources.
 *
 * Images are matched by URL/path against the provided figures array.
 * Images missing from markdown are placed near their section anchor. Only if no
 * anchor can be found are they placed at the end and marked placementFallback.
 */
function buildBlocksFromMarkdownWithImages(
  markdown: string,
  images: PaperImageEntry[],
  blockIdPrefix: string,
): { blocks: DocumentBlock[]; resources: DocumentResource[]; placementStats: ImagePlacementStats } {
  const blocks: DocumentBlock[] = []
  const resources: DocumentResource[] = []
  let blockIdx = 0

  // Build a quick lookup: file basename → image entry
  const imageByBasename = new Map<string, PaperImageEntry>()
  for (const img of images) {
    const key = String(img.path || img.url || '').split(/[\\/]/).pop()?.toLowerCase()
    if (key) imageByBasename.set(key, img)
  }

  const usedImages = new Set<PaperImageEntry>()
  let markdownPlacedCount = 0
  let sectionPlacedCount = 0
  let fallbackImageCount = 0

  const lines = String(markdown || '').replace(/\r/g, '').split('\n')
  let pendingLines: string[] = []
  let lastImageBlockId: string | null = null

  const flushPending = () => {
    const text = pendingLines.join('\n').trim()
    pendingLines = []
    if (!text) return

    // Heading
    const headingMatch = text.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      blocks.push(
        createHeadingBlock({
          id: `${blockIdPrefix}-${++blockIdx}`,
          level: Math.min(headingMatch[1].length, 6) as 1 | 2 | 3 | 4 | 5 | 6,
          text: headingMatch[2].trim(),
        }),
      )
      return
    }

    // Multi-line table → single paragraph (preserve for rendering)
    if (parseMarkdownTable(text)) {
      blocks.push(
        createParagraphBlock({ id: `${blockIdPrefix}-${++blockIdx}`, text }),
      )
      return
    }

    const boldCaptionMatch = text.match(/^\*\*(.+)\*\*$/)
    const figureCaptionText = boldCaptionMatch && isFigureCaptionText(boldCaptionMatch[1])
      ? boldCaptionMatch[1].trim()
      : (isFigureCaptionText(text) ? text.trim() : '')
    if (figureCaptionText && lastImageBlockId) {
      const lastIndex = blocks.findIndex((block) => block.id === lastImageBlockId)
      if (lastIndex >= 0) {
        const caption = figureCaptionText
        blocks[lastIndex] = mergeCaptionIntoImageBlock(blocks[lastIndex], caption)
        const imageBlock = blocks[lastIndex]
        if (imageBlock.type === 'image') {
          const resource = resources.find((res) => res.id === imageBlock.resourceRef)
          if (resource) {
            resource.metadata = {
              ...(resource.metadata || {}),
              caption,
              alt: resource.metadata?.alt || caption,
            }
          }
        }
      }
      return
    }

    if (figureCaptionText) {
      blocks.push(
        createParagraphBlock({
          id: `${blockIdPrefix}-${++blockIdx}`,
          type: 'paragraph',
          text: figureCaptionText,
          metadata: { role: 'figure-caption' },
        } as Parameters<typeof createParagraphBlock>[0]),
      )
      return
    }

    // Regular paragraph
    blocks.push(
      createParagraphBlock({ id: `${blockIdPrefix}-${++blockIdx}`, text }),
    )
    lastImageBlockId = null
  }

  for (const line of lines) {
    // Detect image markdown: ![alt](url) or ![alt](url "title")
    const imgMatch = line.trim().match(/^!\[([^\]]*)\]\(([^)]+?)(?:\s+"([^"]*)")?\)$/)
    if (imgMatch) {
      flushPending()
      const imgUrl = String(imgMatch[2] || '').trim()
      const basename = imgUrl.split(/[\\/]/).pop()?.toLowerCase().split('?')[0]
      const matchedImg = basename ? imageByBasename.get(basename) : undefined

      if (matchedImg) {
        usedImages.add(matchedImg)
        // Determine sectionNum from image entry
        const sectionNum = extractImageSectionNum(matchedImg, images.indexOf(matchedImg) + 1)
        const figureIndex = 1
        const normalized = normalizePaperImageEntryToDocumentResource(
          matchedImg,
          sectionNum,
          figureIndex,
          { blockIdPrefix, blockIndex: ++blockIdx },
        )
        const previousTextBlock = [...blocks].reverse().find((block) => block.type === 'paragraph' || block.type === 'heading')
        const block = applyImagePlacementMetadata(normalized.block, matchedImg, {
          sectionNum,
          afterHeadingText: previousTextBlock?.type === 'heading' ? previousTextBlock.text : undefined,
          afterBlockId: previousTextBlock?.id,
          anchorParagraphText: previousTextBlock?.type === 'paragraph' ? previousTextBlock.text : undefined,
          placementFallback: false,
          placementMode: 'markdown',
        })
        const resource = normalized.resource
        resources.push(resource)
        blocks.push(block)
        lastImageBlockId = block.id
        markdownPlacedCount += 1
      }
      // Unknown images are silently skipped (not added as blocks)
      continue
    }

    if (!line.trim()) {
      flushPending()
    } else {
      pendingLines.push(line)
    }
  }
  flushPending()

  // Place images that were not represented in markdown near their section anchors.
  images.forEach((img, imgIdx) => {
    if (usedImages.has(img)) return
    const sectionNum = extractImageSectionNum(img, imgIdx + 1)
    const figureIndex = imgIdx + 1
    const { resource, block } = normalizePaperImageEntryToDocumentResource(
      img,
      sectionNum,
      figureIndex,
      { blockIdPrefix, blockIndex: ++blockIdx },
    )
    resources.push(resource)
    const placed = insertImageBlockNearSection(blocks, block, img, sectionNum)
    if (placed.fallback) {
      fallbackImageCount += 1
    } else {
      sectionPlacedCount += 1
    }
  })

  const unmatchedImageCount = images.length - usedImages.size
  const imagePlacementMode: ImagePlacementStats['imagePlacementMode'] =
    images.length === 0
      ? 'none'
      : fallbackImageCount === images.length
        ? 'fallback'
        : fallbackImageCount > 0 && (markdownPlacedCount > 0 || sectionPlacedCount > 0)
          ? 'mixed'
        : markdownPlacedCount > 0 && sectionPlacedCount > 0
          ? 'mixed'
          : markdownPlacedCount > 0
            ? 'markdown'
            : sectionPlacedCount > 0
              ? 'section-anchor'
              : fallbackImageCount > 0
                ? 'fallback'
                : 'none'

  return {
    blocks: dedupeFigureCaptions(blocks),
    resources,
    placementStats: {
      unmatchedImageCount,
      fallbackImageCount,
      imagePlacementMode,
    },
  }
}

// ── Main normalizer ────────────────────────────────────────────────────────

export interface NormalizePaperOptions {
  /** Override the generated document id. Defaults to a new UUID. */
  documentId?: string
  /** Block id prefix. Defaults to 'paper-block'. */
  blockIdPrefix?: string
}

/**
 * Convert a PaperGenerationResult (from either NFTCORE or paperProjectRunner)
 * into a canonical DocumentSchema.
 *
 * - Text sections → DocumentSchema.blocks (heading + paragraph blocks)
 * - Images → DocumentSchema.resources + ImageBlock entries inline with text;
 *   any images in the images array that aren't referenced in markdown are appended
 * - References → DocumentSchema.bibliography (items ordered by first appearance)
 * - Citation marks in text annotated per-paragraph in metadata.citationMarks
 * - Text renumbered so [N] markers reflect bibliography order
 * - References section heading/paragraphs tagged with metadata.role="references-section"
 */
export function normalizePaperGenerationResultToDocumentSchema(
  result: PaperGenerationResultLike,
  options?: NormalizePaperOptions,
): DocumentSchema {
  const docId = options?.documentId || `paper-${randomUUID()}`
  const blockIdPrefix = options?.blockIdPrefix || 'paper-block'

  // Step 1: Build blocks + resources from markdown (includes unmatched-images fallback)
  const { blocks: rawBlocks, resources, placementStats } = buildBlocksFromMarkdownWithImages(
    result.markdown || '',
    result.images || [],
    blockIdPrefix,
  )

  // Step 2: Mark references section blocks
  const markedBlocks = markReferencesSection(rawBlocks)

  // Step 3: Build ordered bibliography (by first appearance in body)
  const references = result.references || []
  const { bibliography, remap, idRemap } = buildOrderedCitationBibliography(references, markedBlocks)

  // Step 4: Annotate citation marks in paragraph blocks + renumber inline [N] markers
  const blocks = annotateCitationMarks(markedBlocks, remap, idRemap)

  // Step 5: Build compat citations array (ordered to match bibliography)
  const citations: DocumentSourceRef[] = bibliography.items.map((item) => ({
    id: item.id,
    kind: 'citation' as const,
    label: item.label,
    uri: item.uri,
    metadata: item.metadata,
  }))

  return createDocumentSchema({
    id: docId,
    profile: 'paper',
    title: String(result.title || '').trim() || '未命名论文',
    sourceType: 'workspace-json',
    blocks,
    resources,
    citations,
    bibliography,
    metadata: {
      generatedBy: 'paper-generation',
      citationCount: citations.length,
      imageCount: resources.length,
      imagePlacementMode: placementStats.imagePlacementMode,
      unmatchedImageCount: placementStats.unmatchedImageCount,
      fallbackImageCount: placementStats.fallbackImageCount,
    },
  })
}
