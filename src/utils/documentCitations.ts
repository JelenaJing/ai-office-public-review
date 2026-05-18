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
import { collectCitationOrder, updateCitationNumbersInText } from './citationGroups'

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
        label: oldItem.label.replace(/^\[\d+\]/, `[${newNum}]`),
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
      label: item.label.replace(/^\[\d+\]/, `[${shifted}]`),
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
  const bib = document.bibliography
  if (!bib || !bib.items.length) return ''
  return bib.items
    .slice()
    .sort((a, b) => a.citationNumber - b.citationNumber)
    .map((item) => item.label)
    .join('\n')
}

// ── renderDocumentCitationsForExport ──────────────────────────────────────

/**
 * Return sorted bibliography items ready for OOXML/docx export.
 * The returned array is ordered by citationNumber ascending.
 *
 * Call this before exporting so the docx references section matches the
 * inline citation markers in the body text.
 */
export function renderDocumentCitationsForExport(document: DocumentSchema): DocumentBibliographyItem[] {
  const bib = document.bibliography
  if (!bib || !bib.items.length) return []
  return bib.items.slice().sort((a, b) => a.citationNumber - b.citationNumber)
}
