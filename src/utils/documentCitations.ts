/**
 * documentCitations.ts
 *
 * Utilities for operating on DocumentSchema citation data:
 *   - Collect first-appearance citation order from a document
 *   - Renumber all citations so they are sequential by first appearance
 *   - Insert a new citation at a specific block position (auto-shifts later numbers)
 *   - Render bibliography for preview (text) or export (structured items)
 *
 * These operate on the frontend-safe DocumentSchema type only — no electron imports.
 */

import type {
  DocumentSchema,
  DocumentBibliography,
  DocumentBibliographyItem,
  DocumentCitationMark,
  DocumentBlock,
} from '../document/schema/index'
import { createHeadingBlock, createParagraphBlock } from '../document/schema/index'
import { collectCitationOrder, updateCitationNumbersInText } from './citationGroups'

const LEADING_BIBLIOGRAPHY_NUMBER_PATTERN = /^\s*(?:\[\s*\d+\s*\]|［\s*\d+\s*］|\(\s*\d+\s*\)|（\s*\d+\s*）|\d+\s*[.)．、])\s*/

/**
 * Render a bibliography label from the canonical citationNumber.
 *
 * Paper-generation bibliography items can carry stale labels copied from
 * markdown (for example "[7] Some Paper") while citationNumber has already
 * been renumbered to 3.  Always strip any old leading number and re-prefix
 * from citationNumber so editor/export references stay continuous.
 */
export function renderBibliographyItemLabel(item: DocumentBibliographyItem): string {
  const cleanLabel = String(item.label || '')
    .replace(LEADING_BIBLIOGRAPHY_NUMBER_PATTERN, '')
    .trim()
  return `[${item.citationNumber}] ${cleanLabel}`.trim()
}

function isPaperCitationDocument(document: DocumentSchema): boolean {
  return document.profile === 'paper' || document.document?.metadata?.generatedBy === 'paper-generation'
}

function isReferencesSectionHeading(block: DocumentBlock): boolean {
  if (block.metadata?.role === 'references-section') return true
  if (block.type !== 'heading') return false
  return /^(参考文献|引用文献|references|bibliography)$/i.test(String(block.text || '').trim())
}

function stripReferencesSectionBlocks(blocks: DocumentBlock[]): { bodyBlocks: DocumentBlock[]; headingText?: string } {
  const bodyBlocks: DocumentBlock[] = []
  let headingText: string | undefined
  let inReferencesSection = false

  for (const block of blocks) {
    if (isReferencesSectionHeading(block)) {
      if (block.type === 'heading' && block.text) headingText = block.text
      inReferencesSection = true
      continue
    }
    if (inReferencesSection) continue
    bodyBlocks.push(block)
  }

  return { bodyBlocks, headingText }
}

function isFigureCaptionText(text: string): boolean {
  return /^(?:Figure|Fig\.?|图|图表)\s*\d+(?:\.\d+)*[\s:：.．-]/i.test(String(text || '').trim())
}

function normalizeCaptionKey(text: string): string {
  return String(text || '')
    .trim()
    .replace(/^\*\*(.+)\*\*$/, '$1')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function dedupePaperFigureCaptionBlocks(blocks: DocumentBlock[]): DocumentBlock[] {
  const result: DocumentBlock[] = []
  let previousImageCaptionKey = ''

  for (const block of blocks) {
    if (block.type === 'image') {
      const caption = String(block.value?.caption || block.metadata?.caption || '')
      previousImageCaptionKey = normalizeCaptionKey(caption)
      result.push(block)
      continue
    }

    if (block.type === 'paragraph') {
      const text = String(block.text || '')
      const captionKey = normalizeCaptionKey(text)
      if (captionKey && isFigureCaptionText(text) && captionKey === previousImageCaptionKey) {
        continue
      }
      previousImageCaptionKey = ''
      result.push(block)
      continue
    }

    previousImageCaptionKey = ''
    result.push(block)
  }

  return result
}

// ── collectCitationOrderFromDocument ──────────────────────────────────────

/**
 * Return citation numbers in first-appearance order across all body blocks.
 *
 * For each paragraph/heading block (skipping `role="references-section"` blocks):
 *   - If `metadata.citationMarks` is present, use the citationNumber values there.
 *   - Otherwise fall back to scanning `block.text` via collectCitationOrder().
 *
 * Duplicates are deduplicated; order reflects document reading order.
 */
export function collectCitationOrderFromDocument(document: DocumentSchema): number[] {
  const seen = new Set<number>()
  const order: number[] = []

  for (const block of document.blocks || []) {
    if (block.metadata?.role === 'references-section') continue
    if (block.type !== 'paragraph' && block.type !== 'heading') continue

    // Always scan block.text so order reflects actual text position,
    // not the marks-array insertion order (which may differ after insertions).
    const text = String((block as { text?: string }).text || '')
    const nums = collectCitationOrder(text)

    for (const n of nums) {
      if (!seen.has(n)) {
        seen.add(n)
        order.push(n)
      }
    }
  }
  return order
}

// ── renumberDocumentCitations ──────────────────────────────────────────────

/**
 * Rebuild bibliography and block citationMarks so citation numbers are
 * sequential starting from 1, ordered by first appearance in the document body.
 *
 * Also renumbers any `[N]` markers inside `block.text`.
 * Idempotent: calling twice in a row returns the same document.
 */
export function renumberDocumentCitations(document: DocumentSchema): DocumentSchema {
  if (!isPaperCitationDocument(document)) return document
  const bib = document.bibliography
  if (!bib) return document

  // Collect current first-appearance order
  const appearanceOrder = collectCitationOrderFromDocument(document)

  // Append any bibliography items not referenced in body text
  const bodyNums = new Set(appearanceOrder)
  for (const item of bib.items) {
    if (!bodyNums.has(item.citationNumber)) appearanceOrder.push(item.citationNumber)
  }

  if (!appearanceOrder.length) return document

  // Build remap: current citationNumber → new sequential number
  const remap = new Map<number, number>()
  appearanceOrder.forEach((oldNum, idx) => remap.set(oldNum, idx + 1))

  // Rebuild bibliography items
  const itemByOldNum = new Map(bib.items.map((item) => [item.citationNumber, item]))
  const newItems: DocumentBibliographyItem[] = appearanceOrder
    .filter((n) => itemByOldNum.has(n))
    .map((oldNum, idx) => {
      const oldItem = itemByOldNum.get(oldNum)!
      const newNum = idx + 1
      return {
        ...oldItem,
        id: `citation-${newNum}`,
        citationNumber: newNum,
        label: renderBibliographyItemLabel({ ...oldItem, citationNumber: newNum }),
        metadata: {
          ...(oldItem.metadata || {}),
          originalCitationNumber: oldNum,
        },
      }
    })

  // Update blocks
  const newBlocks = document.blocks.map((block) => updateBlockCitationMarks(block, remap))

  return {
    ...document,
    blocks: newBlocks,
    bibliography: {
      ...bib,
      items: newItems,
      generatedAt: new Date().toISOString(),
    },
  }
}

function updateBlockCitationMarks(block: DocumentBlock, remap: Map<number, number>): DocumentBlock {
  if (block.type !== 'paragraph') return block
  const marks = block.metadata?.citationMarks as DocumentCitationMark[] | undefined
  const text = String((block as { text?: string }).text || '')

  const newText = updateCitationNumbersInText(text, remap as Map<number, number | null | undefined>)
  const newMarks = Array.isArray(marks) && marks.length
    ? marks.map((mark) => {
        const newNum = remap.get(mark.citationNumber)
        if (newNum === undefined) return mark
        return { ...mark, citationNumber: newNum, citationId: `citation-${newNum}` }
      })
    : undefined

  if (newText === text && !newMarks) return block
  return {
    ...block,
    text: newText,
    metadata: {
      ...(block.metadata || {}),
      ...(newMarks ? { citationMarks: newMarks } : {}),
    },
  }
}

// ── insertCitationIntoDocument ─────────────────────────────────────────────

export interface InsertCitationOptions {
  /** ID of the block to receive the new citation mark. */
  blockId: string
  /** Character offset in block.text where the mark is inserted (optional). */
  offset?: number
  /** The reference to insert. */
  reference: {
    title?: string
    doi?: string
    url?: string
    authors?: string[]
    year?: number
    journal?: string
    abstract?: string
  }
}

/**
 * Insert a new citation into the document at the specified block.
 *
 * The new citation number is `maxPrecedingNumber + 1` where "preceding"
 * means citation numbers in all blocks before the target block.
 * All subsequent citation numbers (≥ the new number) are shifted up by 1.
 *
 * Calls renumberDocumentCitations() at the end to ensure consistency.
 */
export function insertCitationIntoDocument(
  document: DocumentSchema,
  options: InsertCitationOptions,
): DocumentSchema {
  if (!isPaperCitationDocument(document)) return document
  const bib: DocumentBibliography = document.bibliography || { items: [] }

  // Find the target block index
  const blockIndex = document.blocks.findIndex((b) => b.id === options.blockId)
  if (blockIndex < 0) return document

  // Compute anchor: max citation number used in blocks BEFORE the target block
  let anchorNumber = 0
  for (let i = 0; i < blockIndex; i++) {
    const marks = document.blocks[i].metadata?.citationMarks as DocumentCitationMark[] | undefined
    if (Array.isArray(marks)) {
      for (const mark of marks) anchorNumber = Math.max(anchorNumber, mark.citationNumber)
    }
  }
  const newCitationNumber = anchorNumber + 1

  // Build shift remap: all current numbers >= newCitationNumber → +1
  const shiftRemap = new Map<number, number>()
  for (const item of bib.items) {
    if (item.citationNumber >= newCitationNumber) {
      shiftRemap.set(item.citationNumber, item.citationNumber + 1)
    }
  }

  // Shift bibliography items
  const shiftedItems: DocumentBibliographyItem[] = bib.items.map((item) => {
    if (item.citationNumber < newCitationNumber) return item
    const shifted = item.citationNumber + 1
    return {
      ...item,
      citationNumber: shifted,
      id: `citation-${shifted}`,
      label: renderBibliographyItemLabel({ ...item, citationNumber: shifted }),
    }
  })

  // Add the new bibliography item
  const newId = `citation-${newCitationNumber}`
  shiftedItems.push({
    id: newId,
    citationNumber: newCitationNumber,
    label: `[${newCitationNumber}] ${String(options.reference.title || '').trim()}`,
    uri: options.reference.doi
      ? `https://doi.org/${options.reference.doi}`
      : (options.reference.url || undefined),
    metadata: {
      title: options.reference.title,
      authors: options.reference.authors || [],
      year: options.reference.year,
      journal: options.reference.journal,
      doi: options.reference.doi,
      abstract: options.reference.abstract,
    },
  })
  shiftedItems.sort((a, b) => a.citationNumber - b.citationNumber)

  // Shift all blocks' citationMarks and text
  const newBlocks = document.blocks.map((block, i): DocumentBlock => {
    // Shift existing marks in every block
    let shifted = updateBlockCitationMarks(block, shiftRemap)

    // Insert new mark in the target block
    if (i === blockIndex && shifted.type === 'paragraph') {
      const existingMarks = (shifted.metadata?.citationMarks || []) as DocumentCitationMark[]
      const newMark: DocumentCitationMark = {
        citationId: newId,
        citationNumber: newCitationNumber,
        rawMark: `[${newCitationNumber}]`,
        offset: options.offset,
      }
      const newText = String((shifted as { text?: string }).text || '')
      const insertedText = options.offset !== undefined
        ? `${newText.slice(0, options.offset)}[${newCitationNumber}]${newText.slice(options.offset)}`
        : `${newText} [${newCitationNumber}]`
      shifted = {
        ...shifted,
        text: insertedText,
        metadata: {
          ...(shifted.metadata || {}),
          citationMarks: [...existingMarks, newMark],
        },
      }
    }

    return shifted
  })

  return renumberDocumentCitations({
    ...document,
    blocks: newBlocks,
    bibliography: { items: shiftedItems, generatedAt: new Date().toISOString() },
  })
}

// ── renderDocumentCitationsForPreview ─────────────────────────────────────

/**
 * Render the bibliography as plain text for preview.
 * Returns one entry per line, ordered by citation number.
 */
export function renderDocumentCitationsForPreview(document: DocumentSchema): string {
  if (!isPaperCitationDocument(document)) return ''
  const bib = document.bibliography
  if (!bib || !bib.items.length) return ''
  return bib.items
    .slice()
    .sort((a, b) => a.citationNumber - b.citationNumber)
    .map((item) => renderBibliographyItemLabel(item))
    .join('\n')
}

// ── renderInlineCitationTextFromMarks ────────────────────────────────────

/**
 * Re-sync the inline `[N]` markers in a paragraph block's text so they match
 * the `citationNumber` values stored in `metadata.citationMarks`.
 *
 * Use case: after citation renumbering, the block's `text` may still contain
 * the original numbers (e.g., `[2]`) while `citationMarks[0].citationNumber`
 * records the correct new number (e.g., `1`).  This function rebuilds the text
 * so that `[2]` → `[1]`.
 *
 * Rules:
 *  - Only operates on `paragraph` blocks.
 *  - Skips blocks with `metadata.role === 'references-section'`.
 *  - Uses `rawMark` on each citation mark to identify which `[N]` to replace.
 *  - Falls back to `offset` when `rawMark` is absent.
 *  - Returns the original block unchanged if no remap is needed.
 */
function renderInlineCitationTextFromMarks(block: DocumentBlock): DocumentBlock {
  if (block.type !== 'paragraph') return block
  if (block.metadata?.role === 'references-section') return block

  const marks = block.metadata?.citationMarks as DocumentCitationMark[] | undefined
  if (!Array.isArray(marks) || !marks.length) return block

  const text = String((block as unknown as { text?: string }).text || '')
  if (!text) return block

  // Build remap: original number in text → desired citationNumber
  const remap = new Map<number, number>()

  for (const mark of marks) {
    if (mark.rawMark) {
      // Extract the first digit run from rawMark, e.g., "[2]" → 2, "[1,2]" → 1
      const m = /\d+/.exec(mark.rawMark)
      if (m) {
        const originalNum = Number.parseInt(m[0], 10)
        if (!Number.isNaN(originalNum) && !remap.has(originalNum)) {
          remap.set(originalNum, mark.citationNumber)
        }
      }
    } else if (mark.offset !== undefined) {
      // No rawMark: inspect the text at the recorded offset
      const fragment = text.slice(mark.offset)
      const m2 = /^\[(\d+)/.exec(fragment)
      if (m2) {
        const numInText = Number.parseInt(m2[1], 10)
        if (!Number.isNaN(numInText) && !remap.has(numInText)) {
          remap.set(numInText, mark.citationNumber)
        }
      }
    }
  }

  if (!remap.size) return block

  const newText = updateCitationNumbersInText(text, remap as Map<number, number | null | undefined>)
  if (newText === text) return block

  return { ...block, text: newText }
}

// ── renderDocumentCitationsForExport ──────────────────────────────────────

/**
 * Prepare a DocumentSchema for export by:
 *   1. Syncing inline `[N]` markers in each body paragraph with the
 *      `citationNumber` stored in `metadata.citationMarks` (if present).
 *   2. Removing all blocks with `metadata.role === 'references-section'`.
 *   3. Generating a fresh references section (heading + one paragraph per
 *      bibliography item) and appending it at the end of the block list.
 *
 * This guarantees that the exported docx references section always matches the
 * inline [N] markers in the body text.  Call this before
 * `compileDocumentSchemaToOoxmlBlocks`.
 *
 * If the document has no bibliography items, old references-section blocks are
 * still removed (so a stale section doesn't leak into the export).
 */
export function renderDocumentCitationsForExport(document: DocumentSchema): DocumentSchema {
  if (!isPaperCitationDocument(document)) return document

  const bib = document.bibliography

  // 1. Sync inline citation numbers from citationMarks metadata, then strip references-section
  const renderedBlocks = dedupePaperFigureCaptionBlocks(document.blocks)
    .map((block) => renderInlineCitationTextFromMarks(block))
  const { bodyBlocks, headingText } = stripReferencesSectionBlocks(renderedBlocks)

  // No bibliography — return document with references-section stripped
  if (!bib || !bib.items.length) {
    return { ...document, blocks: bodyBlocks }
  }

  // Sort bibliography items by citation number for the rendered section
  const sortedItems = bib.items.slice().sort((a, b) => a.citationNumber - b.citationNumber)
  const bodyText = bodyBlocks
    .filter((block) => block.type === 'heading' || block.type === 'paragraph')
    .map((block) => String((block as { text?: string }).text || ''))
    .join('\n')

  const headingBlock = createHeadingBlock({
    id: 'refs-export-heading',
    level: 1,
    text: headingText || (/[\u4e00-\u9fff]/.test(bodyText) ? '参考文献' : 'References'),
    metadata: { role: 'references-section' },
  })

  const refParagraphs: DocumentBlock[] = sortedItems.map((item) =>
    createParagraphBlock({
      id: `refs-export-item-${item.citationNumber}`,
      text: renderBibliographyItemLabel(item),
      metadata: { role: 'references-section' },
    }),
  )

  return {
    ...document,
    blocks: [...bodyBlocks, headingBlock, ...refParagraphs],
  }
}
