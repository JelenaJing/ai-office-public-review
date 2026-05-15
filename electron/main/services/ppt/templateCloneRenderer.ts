/**
 * TemplateCloneRenderer — clones actual template slides and replaces only text content.
 *
 * Instead of redrawing slides from scratch with pptxGenJS, this renderer:
 *   1. Opens the source template PPTX as a ZIP archive.
 *   2. Clones the template slide at `layout.sourceSlideIndex` for each bound slide.
 *   3. Replaces placeholder text in the clone using pattern matching.
 *   4. Assembles a new PPTX with the cloned/modified slides.
 *
 * This preserves the template's original shapes, animations, backgrounds, fonts,
 * and visual design. Only the text content in known placeholder shapes is replaced.
 *
 * tokenCost = 0, llmCalls = 0, imageCalls = 0 — always.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import JSZip from 'jszip'
import type { BindingPlan, BoundSlide, BoundSlotValues } from '../../../../src/types/pptBindingPlan'
import type { DeckSlide } from '../../../../src/types/deckDocument'
import type { LayoutSlot } from '../../../../src/types/pptTemplateManifest'

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface CloneRendererOptions {
  templatePptxPath: string
  outputPath: string
  bindingPlan: BindingPlan
  deckTitle: string
}

export interface CloneRendererResult {
  success: boolean
  outputPath: string
  slideCount: number
  error?: string
  warnings?: string[]
  /** Always 0 */
  llmCalls: 0
  /** Always 0 */
  imageCalls: 0
  /** Always 0 */
  tokenCost: 0
}

// ---------------------------------------------------------------------------
// Text shape representation (used internally)
// ---------------------------------------------------------------------------

interface TextShape {
  id: string
  name: string
  x: number
  y: number
  combinedText: string
  xml: string
}

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Parse all <p:sp> shapes in a slide XML that have text content.
 * Returns shapes sorted by y position (top to bottom), then x (left to right).
 */
function parseTextShapes(slideXml: string): TextShape[] {
  const shapes: TextShape[] = []
  const spRe = /<p:sp>[\s\S]*?<\/p:sp>/g
  let m: RegExpExecArray | null
  while ((m = spRe.exec(slideXml)) !== null) {
    const spXml = m[0]
    const idMatch = spXml.match(/<p:cNvPr id="(\d+)" name="([^"]*)"/)
    const posMatch = spXml.match(/<a:off x="(\d+)" y="(\d+)"/)
    const texts: string[] = []
    const atRe = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g
    let at: RegExpExecArray | null
    while ((at = atRe.exec(spXml)) !== null) {
      texts.push(at[1])
    }
    const combined = texts.join('')
    if (combined.length > 1) {
      shapes.push({
        id: idMatch?.[1] ?? '',
        name: idMatch?.[2] ?? '',
        x: parseInt(posMatch?.[1] ?? '0', 10),
        y: parseInt(posMatch?.[2] ?? '0', 10),
        combinedText: combined,
        xml: spXml,
      })
    }
  }
  return shapes.sort((a, b) => a.y - b.y || a.x - b.x)
}

/**
 * Replace the <p:txBody> of a shape with new text, preserving the original
 * bodyPr, lstStyle, paragraph properties, and run properties (font/color/size).
 *
 * @param spXml     Full <p:sp>...</p:sp> XML
 * @param newLines  One or more lines of text (each becomes a <a:p> paragraph).
 *                  Pass '' or [] to clear the shape (empty paragraph).
 */
function replaceShapeText(spXml: string, newLines: string | string[]): string {
  const lines = Array.isArray(newLines)
    ? newLines.filter(l => l.trim() !== '')
    : newLines.trim() ? [newLines] : []

  // Extract structure from existing txBody
  const bodyPrM = spXml.match(/<a:bodyPr(?:[^>]*\/>|[^>]*>[\s\S]*?<\/a:bodyPr>)/)
  const bodyPr = bodyPrM?.[0] ?? '<a:bodyPr/>'

  const lstStyleM = spXml.match(/<a:lstStyle(?:\/>|>[\s\S]*?<\/a:lstStyle>)/)
  const lstStyle = lstStyleM?.[0] ?? '<a:lstStyle/>'

  // Extract first paragraph's properties (alignment, line spacing, etc.)
  const firstParaM = spXml.match(/<a:p>([\s\S]*?)<\/a:p>/)
  const firstParaContent = firstParaM?.[1] ?? ''
  const pPrM = firstParaContent.match(/<a:pPr(?:[^>]*\/>|[^>]*>[\s\S]*?<\/a:pPr>)/)
  const pPr = pPrM?.[0] ?? ''

  // Extract first run's properties (font size, bold, color)
  const rPrM = firstParaContent.match(/<a:rPr(?:[^>]*\/>|[^>]*>[\s\S]*?<\/a:rPr>)/)
  const rPr = rPrM?.[0] ?? ''

  let newTxBody: string
  if (lines.length === 0) {
    // Clear the shape — produce a valid empty paragraph (preserves layout shape)
    newTxBody = `<p:txBody>${bodyPr}${lstStyle}<a:p>${pPr}</a:p></p:txBody>`
  } else {
    // Build new paragraphs — one per line
    const newParas = lines
      .map(line => `<a:p>${pPr}<a:r>${rPr}<a:t>${escapeXml(line)}</a:t></a:r></a:p>`)
      .join('')
    newTxBody = `<p:txBody>${bodyPr}${lstStyle}${newParas}</p:txBody>`
  }

  return spXml.replace(/<p:txBody>[\s\S]*?<\/p:txBody>/, newTxBody)
}

// ---------------------------------------------------------------------------
// Pattern matchers for identifying placeholder shapes
// ---------------------------------------------------------------------------

/** The primary heading placeholder in business_report slides */
const isHeadingPrimary = (t: string) => /单击此处添加标题文本/.test(t)

/** Generic heading placeholder (exact match only) */
const isHeadingSecondary = (t: string) => /^添加标题文本$/.test(t.trim())

/** Card/item title placeholders (shorter form) */
const isItemTitle = (t: string) => /^(添加标题文本|添加标题)$/.test(t.trim())

/** Long body text placeholder — main body areas and column bodies */
const isBodyPlaceholder = (t: string) =>
  /此处添加详细文本描述/.test(t) || /Your content to play here/.test(t)

/** Short item body placeholder — typically inside card items */
const isItemBodyPlaceholder = (t: string) =>
  /根据自己的需要添加适当的文字/.test(t) ||
  /此处添加详细文本描述，文字内容建议/.test(t)

/** Cover title placeholders (template-specific main visual text) */
const isCoverTitle = (t: string) =>
  /工作汇报商务通用/.test(t) ||
  /毕业论文答辩/.test(t) ||
  /立夏是二十四节气/.test(t) ||
  /感谢老师聆听指导/.test(t)

/** Decorative shapes that should never be replaced */
const isDecorative = (t: string) =>
  /传统节气/.test(t) ||
  /工作汇报\s*\/\s*工作总结/.test(t) ||
  /论文答辩\s*\/\s*开题报告/.test(t) ||
  /CONTENTS/.test(t) ||
  /^汇报人：/.test(t) ||
  /^指导老师：/.test(t) ||
  /^答辩学生：/.test(t) ||
  /^时间：/.test(t)

/**
 * Any placeholder pattern — used for the final "clear all remaining" pass.
 * "51PPT" is the template author watermark — clear it on output.
 */
const isAnyPlaceholder = (t: string) =>
  isHeadingPrimary(t) ||
  isItemTitle(t) ||
  isBodyPlaceholder(t) ||
  isItemBodyPlaceholder(t) ||
  isCoverTitle(t) ||
  /51PPT/.test(t) ||
  /添加关键词/.test(t)

/**
 * Final pass: clear every placeholder shape that wasn't already filled.
 * This ensures no template placeholder text leaks into the output.
 */
function clearRemainingPlaceholders(slideXml: string, shapes: TextShape[], usedIds: Set<string>): string {
  let result = slideXml
  for (const shape of shapes) {
    if (usedIds.has(shape.id)) continue
    if (isDecorative(shape.combinedText)) continue
    if (isAnyPlaceholder(shape.combinedText)) {
      const cleared = replaceShapeText(shape.xml, '')
      result = result.replace(shape.xml, cleared)
      usedIds.add(shape.id)
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Per-intent content application
// ---------------------------------------------------------------------------

function applyCoverContent(slideXml: string, shapes: TextShape[], slots: BoundSlotValues): string {
  let result = slideXml
  const title = slots.title || slots.heading || ''
  const subtitle = slots.subtitle || slots.body || ''
  const usedIds = new Set<string>()

  for (const shape of shapes) {
    if (isDecorative(shape.combinedText)) continue

    if (title && isCoverTitle(shape.combinedText)) {
      const newXml = replaceShapeText(shape.xml, title)
      result = result.replace(shape.xml, newXml)
      usedIds.add(shape.id)
      continue
    }
    if (subtitle && isBodyPlaceholder(shape.combinedText)) {
      const newXml = replaceShapeText(shape.xml, subtitle)
      result = result.replace(shape.xml, newXml)
      usedIds.add(shape.id)
    }
  }

  return clearRemainingPlaceholders(result, shapes, usedIds)
}

function applyTocContent(slideXml: string, shapes: TextShape[], slots: BoundSlotValues): string {
  if (!slots.items || slots.items.length === 0) return slideXml
  let result = slideXml
  const usedIds = new Set<string>()

  // Find all shapes that are simple heading placeholders (TOC items)
  const tocShapes = shapes.filter(s => isItemTitle(s.combinedText) || isHeadingSecondary(s.combinedText))
  for (let i = 0; i < tocShapes.length; i++) {
    const item = slots.items[i] ?? ''
    const newXml = replaceShapeText(tocShapes[i].xml, item) // clears if no item
    result = result.replace(tocShapes[i].xml, newXml)
    usedIds.add(tocShapes[i].id)
  }
  return clearRemainingPlaceholders(result, shapes, usedIds)
}

function applySectionContent(slideXml: string, shapes: TextShape[], slots: BoundSlotValues): string {
  let result = slideXml
  const heading = slots.heading || slots.title || ''
  const body = slots.body || slots.subtitle || ''
  const usedIds = new Set<string>()

  // Find heading: either primary (单击此处) or the single/leftmost secondary
  let headingShape: TextShape | null = null
  for (const shape of shapes) {
    if (isDecorative(shape.combinedText)) continue
    if (isHeadingPrimary(shape.combinedText)) {
      headingShape = shape
      break
    }
    if (!headingShape && (isHeadingSecondary(shape.combinedText) || isItemTitle(shape.combinedText))) {
      headingShape = shape
    }
  }

  if (headingShape && heading) {
    const newXml = replaceShapeText(headingShape.xml, heading)
    result = result.replace(headingShape.xml, newXml)
    usedIds.add(headingShape.id)
  }

  // Find body: first long-body placeholder
  if (body) {
    const bodyShape = shapes.find(s => !isDecorative(s.combinedText) && isBodyPlaceholder(s.combinedText))
    if (bodyShape) {
      const newXml = replaceShapeText(bodyShape.xml, splitIntoParagraphs(body))
      result = result.replace(bodyShape.xml, newXml)
      usedIds.add(bodyShape.id)
    }
  }

  return clearRemainingPlaceholders(result, shapes, usedIds)
}

function applyTextContent(slideXml: string, shapes: TextShape[], slots: BoundSlotValues): string {
  let result = slideXml
  const heading = slots.heading || slots.title || ''
  const body = slots.body || ''
  const items = slots.items ?? []
  const usedIds = new Set<string>()

  // Step 1: identify the heading shape
  let headingShape: TextShape | null = null
  for (const shape of shapes) {
    if (isDecorative(shape.combinedText)) continue
    if (isHeadingPrimary(shape.combinedText)) { headingShape = shape; break }
  }
  if (!headingShape) {
    // Use leftmost (smallest x) heading-pattern shape
    const candidates = shapes.filter(s => !isDecorative(s.combinedText) && isItemTitle(s.combinedText))
    if (candidates.length > 0) {
      headingShape = candidates.reduce((best, s) => (s.x < best.x ? s : best), candidates[0])
    }
  }

  if (headingShape && heading) {
    const newXml = replaceShapeText(headingShape.xml, heading)
    result = result.replace(headingShape.xml, newXml)
    usedIds.add(headingShape.id)
  }

  // Step 2: identify item pairs (title + body)
  const itemTitles = shapes.filter(
    s => !usedIds.has(s.id) && !isDecorative(s.combinedText) && isItemTitle(s.combinedText),
  )
  const itemBodies = shapes.filter(
    s => !usedIds.has(s.id) && !isDecorative(s.combinedText) && isItemBodyPlaceholder(s.combinedText),
  )

  // Replace item titles (fill with items[i] or clear)
  for (let i = 0; i < itemTitles.length; i++) {
    const titleShape = itemTitles[i]
    const itemText = items[i] ?? ''
    const newXml = replaceShapeText(titleShape.xml, itemText) // clears if no item
    result = result.replace(titleShape.xml, newXml)
    usedIds.add(titleShape.id)
  }

  // Always clear item body shapes (template placeholders below each item title)
  for (const bodyShape of itemBodies) {
    const newXml = replaceShapeText(bodyShape.xml, '')
    result = result.replace(bodyShape.xml, newXml)
    usedIds.add(bodyShape.id)
  }

  // Step 3: replace body area shapes
  const bodyShapes = shapes.filter(
    s => !usedIds.has(s.id) && !isDecorative(s.combinedText) && isBodyPlaceholder(s.combinedText),
  )
  if (body) {
    // Fill first body shape with content, clear rest
    for (let i = 0; i < bodyShapes.length; i++) {
      const text = i === 0 ? splitIntoParagraphs(body) : ''
      const newXml = replaceShapeText(bodyShapes[i].xml, text)
      result = result.replace(bodyShapes[i].xml, newXml)
      usedIds.add(bodyShapes[i].id)
    }
  } else {
    // No body — clear all body shapes
    for (const bs of bodyShapes) {
      result = result.replace(bs.xml, replaceShapeText(bs.xml, ''))
      usedIds.add(bs.id)
    }
  }

  return clearRemainingPlaceholders(result, shapes, usedIds)
}

function applyCardsContent(slideXml: string, shapes: TextShape[], slots: BoundSlotValues): string {
  let result = slideXml
  const heading = slots.heading || slots.title || ''
  const items = slots.items ?? []
  const usedIds = new Set<string>()

  // Identify the slide heading — either unique-text or leftmost "添加标题文本"
  let headingShape: TextShape | null = null
  for (const shape of shapes) {
    if (isDecorative(shape.combinedText)) continue
    if (isHeadingPrimary(shape.combinedText)) { headingShape = shape; break }
  }
  if (!headingShape) {
    // For templates without "单击此处", find the heading as leftmost item title
    const candidates = shapes.filter(s => !isDecorative(s.combinedText) && isItemTitle(s.combinedText))
    if (candidates.length > 0) {
      headingShape = candidates.reduce((best, s) => (s.x < best.x ? s : best), candidates[0])
    }
  }

  if (headingShape) {
    const newXml = replaceShapeText(headingShape.xml, heading)
    result = result.replace(headingShape.xml, newXml)
    usedIds.add(headingShape.id)
  }

  // Collect card title shapes
  const cardTitles = shapes.filter(
    s => !usedIds.has(s.id) && !isDecorative(s.combinedText) && isItemTitle(s.combinedText),
  )
  cardTitles.sort((a, b) => a.y - b.y || a.x - b.x)

  // Fill card titles; clear extras
  for (let i = 0; i < cardTitles.length; i++) {
    const titleShape = cardTitles[i]
    const itemText = items[i] ?? '' // empty string clears the shape
    result = result.replace(titleShape.xml, replaceShapeText(titleShape.xml, itemText))
    usedIds.add(titleShape.id)
  }

  // Clear ALL card body placeholder shapes (template filler text under each card)
  const cardBodies = shapes.filter(
    s => !usedIds.has(s.id) && !isDecorative(s.combinedText) && isItemBodyPlaceholder(s.combinedText),
  )
  for (const shape of cardBodies) {
    result = result.replace(shape.xml, replaceShapeText(shape.xml, ''))
    usedIds.add(shape.id)
  }

  // Clear any stray long-body placeholder shapes
  const bodyShapes = shapes.filter(
    s => !usedIds.has(s.id) && !isDecorative(s.combinedText) && isBodyPlaceholder(s.combinedText),
  )
  for (const shape of bodyShapes) {
    result = result.replace(shape.xml, replaceShapeText(shape.xml, ''))
    usedIds.add(shape.id)
  }

  return clearRemainingPlaceholders(result, shapes, usedIds)
}

function applyClosingContent(slideXml: string, shapes: TextShape[], slots: BoundSlotValues): string {
  let result = slideXml
  const heading = slots.heading || slots.title || ''
  const body = slots.body || ''
  const usedIds = new Set<string>()

  for (const shape of shapes) {
    if (isDecorative(shape.combinedText)) continue
    if (isCoverTitle(shape.combinedText) || isHeadingPrimary(shape.combinedText) || isHeadingSecondary(shape.combinedText)) {
      const newXml = replaceShapeText(shape.xml, heading)
      result = result.replace(shape.xml, newXml)
      usedIds.add(shape.id)
      continue
    }
    if (isBodyPlaceholder(shape.combinedText)) {
      const newXml = replaceShapeText(shape.xml, body)
      result = result.replace(shape.xml, newXml)
      usedIds.add(shape.id)
    }
  }

  return clearRemainingPlaceholders(result, shapes, usedIds)
}

/**
 * Split a long text block into a list of paragraphs for multi-line shapes.
 * Splits on newline, double newline, or bullet-style ". " separators.
 */
function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n+/)
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .slice(0, 10) // cap at 10 paragraphs to avoid overflow
}

// ---------------------------------------------------------------------------
// Locator-based slot binding (new, precise path)
// ---------------------------------------------------------------------------

/**
 * Read a single field from a DeckSlide by a contentPriority path string.
 * Supports:
 *   - Simple field names: 'title', 'summary', 'body', 'oneLiner', 'subtitle'
 *   - Indexed arrays:  'items[0]', 'keywords[2]', 'keyTakeaways[1]'
 *   - Full arrays:     'items', 'keywords', 'keyTakeaways' → joined string
 */
function readDeckSlideField(slide: DeckSlide, fieldPath: string): string | null {
  // Handle indexed path: 'keywords[0]', 'items[2]', etc.
  const indexedMatch = fieldPath.match(/^(\w+)\[(\d+)\]$/)
  if (indexedMatch) {
    const arrayField = indexedMatch[1]
    const idx = parseInt(indexedMatch[2], 10)
    const arr = (slide as Record<string, unknown>)[arrayField]
    if (Array.isArray(arr) && arr[idx] != null) {
      const v = arr[idx]
      if (typeof v === 'string') return v || null
      if (typeof v === 'object' && v !== null && 'title' in v) return (v as { title: string }).title || null
    }
    return null
  }

  // Handle plain field names
  const value = (slide as Record<string, unknown>)[fieldPath]
  if (value == null) return null
  if (typeof value === 'string') return value.trim() || null
  if (Array.isArray(value)) {
    const joined = value
      .map(v => (typeof v === 'string' ? v : (v as Record<string, unknown>).title ?? ''))
      .filter(Boolean)
      .join('\n')
    return joined || null
  }
  return null
}

/**
 * Find a shape in the shapes list using the slot locator.
 * Priority: shapeId > shapeName > placeholderText.
 */
function findShapeByLocator(shapes: TextShape[], slot: LayoutSlot): TextShape | null {
  const loc = slot.locator
  if (!loc) return null

  if (loc.shapeId) {
    const found = shapes.find(s => s.id === loc.shapeId)
    if (found) return found
  }
  if (loc.shapeName) {
    const found = shapes.find(s => s.name === loc.shapeName)
    if (found) return found
  }
  if (loc.placeholderText) {
    const found = shapes.find(s => s.combinedText.includes(loc.placeholderText!))
    if (found) return found
  }
  return null
}

/**
 * Apply fitPolicy to resolve raw text into final output.
 * Returns:
 *   - null         → preserve: caller should NOT modify this shape
 *   - string | string[] → content to pass to replaceShapeText
 */
function applyFitPolicy(
  rawText: string,
  slot: LayoutSlot,
): string | string[] | null {
  const policy = slot.fitPolicy ?? 'truncate'
  const maxChars = slot.maxChars ?? 999

  switch (policy) {
    case 'preserve':
      return null

    case 'clear':
      return ''

    case 'single_keyword': {
      // Take first token (split on ，,、\s)
      const first = rawText.split(/[，,、\s]+/)[0].trim()
      return (first || rawText).slice(0, maxChars)
    }

    case 'short_phrase': {
      // Take first clause before ，。！？；\n
      const phraseMatch = rawText.match(/^([^，。！？；\n]+)/)
      const phrase = (phraseMatch?.[1] ?? rawText).trim()
      return phrase.slice(0, maxChars)
    }

    case 'body_summary': {
      // Split into paragraphs, cap total chars
      const lines = rawText.split(/\n+/).map(l => l.trim()).filter(l => l.length > 0)
      const result: string[] = []
      let total = 0
      for (const line of lines) {
        if (total + line.length > maxChars && result.length > 0) break
        result.push(line)
        total += line.length
      }
      return result.length > 0 ? result : [rawText.slice(0, maxChars)]
    }

    case 'truncate':
    default:
      return rawText.slice(0, maxChars)
  }
}

/**
 * Locator-first slot binding pass.
 *
 * For each LayoutSlot that has a locator (shapeId/shapeName):
 *   1. Find the exact shape in the slide XML.
 *   2. If fitPolicy='preserve' → mark used, skip.
 *   3. If fitPolicy='clear' → empty the shape.
 *   4. Otherwise: resolve content from sourceSlide using contentPriority,
 *      apply fitPolicy, and replace the shape text.
 *
 * Marks all touched shape IDs in usedIds so the heuristic cleanup pass
 * (`clearRemainingPlaceholders`) skips them.
 */
function applyLocatorBasedSlots(
  slideXml: string,
  shapes: TextShape[],
  layoutSlots: LayoutSlot[],
  sourceSlide: DeckSlide,
  usedIds: Set<string>,
): string {
  let result = slideXml

  for (const slot of layoutSlots) {
    if (!slot.locator) continue

    const shape = findShapeByLocator(shapes, slot)
    if (!shape) {
      console.log(
        `[template-slot-bind] slotId=${slot.slotId} locator shapeId=${slot.locator.shapeId} NOT FOUND`,
      )
      continue
    }

    const policy = slot.fitPolicy ?? 'truncate'

    // preserve: mark used so heuristic pass won't touch it
    if (policy === 'preserve') {
      usedIds.add(shape.id)
      continue
    }

    // clear: always empty the shape
    if (policy === 'clear') {
      result = result.replace(shape.xml, replaceShapeText(shape.xml, ''))
      usedIds.add(shape.id)
      console.log(
        `[template-slot-bind] slotId=${slot.slotId} shapeId=${shape.id} fitAction=clear`,
      )
      continue
    }

    // Resolve content using contentPriority
    const priorities = slot.contentPriority ?? []
    let rawText: string | null = null
    let sourcePath = '(none)'
    for (const field of priorities) {
      const v = readDeckSlideField(sourceSlide, field)
      if (v) {
        rawText = v
        sourcePath = field
        break
      }
    }

    if (rawText == null) {
      // No content found — clear the shape so no placeholder leaks
      result = result.replace(shape.xml, replaceShapeText(shape.xml, ''))
      usedIds.add(shape.id)
      console.log(
        `[template-slot-bind] slotId=${slot.slotId} shapeId=${shape.id} fitAction=cleared_no_content`,
      )
      continue
    }

    const fitted = applyFitPolicy(rawText, slot)
    if (fitted === null) {
      // preserve returned → don't touch
      usedIds.add(shape.id)
      continue
    }

    result = result.replace(shape.xml, replaceShapeText(shape.xml, fitted))
    usedIds.add(shape.id)

    const preview = Array.isArray(fitted) ? fitted.join(' | ') : fitted
    console.log(
      `[template-slot-bind] slotId=${slot.slotId} shapeId=${shape.id} role=${slot.role} source=${sourcePath} rawLen=${rawText.length} final="${preview.slice(0, 50)}" fit=${policy}`,
    )
  }

  return result
}

/**
 * Apply BoundSlotValues to a slide XML.
 *
 * Priority:
 *   1. Locator-based slots (from layout.slots with locator defined) — precise.
 *   2. Heuristic placeholder-text matching per intent — fallback only.
 */
function applyContentToSlide(slideXml: string, boundSlide: BoundSlide): string {
  const shapes = parseTextShapes(slideXml)
  const layoutSlots = boundSlide.layout.slots ?? []
  const locatorSlots = layoutSlots.filter(s => s.locator)

  if (locatorSlots.length > 0) {
    // Path 1: locator-first (precise)
    const usedIds = new Set<string>()
    let result = applyLocatorBasedSlots(slideXml, shapes, layoutSlots, boundSlide.sourceSlide, usedIds)
    result = clearRemainingPlaceholders(result, shapes, usedIds)
    return result
  }

  // Path 2: heuristic fallback (no locator slots defined for this layout)
  const { intent } = boundSlide.sourceSlide
  const { slots } = boundSlide
  switch (intent) {
    case 'cover':
      return applyCoverContent(slideXml, shapes, slots)
    case 'toc':
      return applyTocContent(slideXml, shapes, slots)
    case 'section_divider':
      return applySectionContent(slideXml, shapes, slots)
    case 'text_content':
    case 'image_text':
      return applyTextContent(slideXml, shapes, slots)
    case 'content_cards':
      return applyCardsContent(slideXml, shapes, slots)
    case 'closing':
      return applyClosingContent(slideXml, shapes, slots)
    default:
      return applyTextContent(slideXml, shapes, slots)
  }
}

// ---------------------------------------------------------------------------
// Presentation XML / rels updaters
// ---------------------------------------------------------------------------

const SLIDE_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide'

function updatePresentationXml(originalXml: string, slideCount: number): string {
  // Build new sldIdLst with sequential IDs starting at 2001
  const newEntries = Array.from({ length: slideCount }, (_, i) =>
    `<p:sldId id="${2001 + i}" r:id="rId${1001 + i}"/>`,
  ).join('')
  return originalXml.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, `<p:sldIdLst>${newEntries}</p:sldIdLst>`)
}

function updatePresentationRels(originalRels: string, slideCount: number): string {
  // Remove all existing slide relationships
  let result = originalRels.replace(
    new RegExp(`<Relationship[^>]+Type="${SLIDE_REL_TYPE}"[^>]*/>`, 'g'),
    '',
  )
  // Add new slide relationships with IDs starting at rId1001
  const newRels = Array.from({ length: slideCount }, (_, i) =>
    `<Relationship Id="rId${1001 + i}" Type="${SLIDE_REL_TYPE}" Target="slides/slide${i + 1}.xml"/>`,
  ).join('\n  ')
  result = result.replace('</Relationships>', `  ${newRels}\n</Relationships>`)
  // Clean up extra blank lines from removed entries
  return result.replace(/\n{3,}/g, '\n\n')
}

// ---------------------------------------------------------------------------
// Main renderer
// ---------------------------------------------------------------------------

/**
 * Check if all layouts in the binding plan have a sourceSlideIndex defined.
 * If any layout is missing one, we can't use the clone renderer.
 */
export function canUseCloneRenderer(bindingPlan: BindingPlan): boolean {
  return bindingPlan.boundSlides.every(s => s.layout.sourceSlideIndex != null && s.layout.sourceSlideIndex > 0)
}

/**
 * Render a PPTX by cloning actual template slides and replacing placeholder text.
 *
 * Requires:
 *  - All layouts in bindingPlan have `sourceSlideIndex`
 *  - `templatePptxPath` exists and is a valid PPTX file
 */
export async function renderWithClone(options: CloneRendererOptions): Promise<CloneRendererResult> {
  const { templatePptxPath, outputPath, bindingPlan, deckTitle } = options
  const warnings: string[] = []

  // Validate template file exists
  if (!fs.existsSync(templatePptxPath)) {
    return {
      success: false,
      outputPath,
      slideCount: 0,
      error: `Template PPTX not found: ${templatePptxPath}`,
      llmCalls: 0,
      imageCalls: 0,
      tokenCost: 0,
    }
  }

  try {
    console.log(`[templateCloneRenderer] Started: ${bindingPlan.boundSlides.length} slides → ${path.basename(outputPath)}`)
    console.log(`[templateCloneRenderer] Template: ${templatePptxPath}`)

    const templateBuffer = fs.readFileSync(templatePptxPath)
    const templateZip = await JSZip.loadAsync(templateBuffer)

    const outputZip = new JSZip()

    // Copy all non-slide files from template into the output zip
    const skipPrefixes = ['ppt/slides/']
    const skipExact = new Set(['ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels'])

    for (const [relPath, file] of Object.entries(templateZip.files)) {
      if (file.dir) continue
      if (skipExact.has(relPath)) continue
      if (skipPrefixes.some(p => relPath.startsWith(p))) continue
      outputZip.file(relPath, await file.async('nodebuffer'))
    }

    // Process each bound slide
    let outputIdx = 0
    for (const boundSlide of bindingPlan.boundSlides) {
      const sourceSlideIndex = boundSlide.layout.sourceSlideIndex ?? 4
      outputIdx++

      console.log(`[templateCloneRenderer]   slide ${outputIdx}: intent=${boundSlide.sourceSlide.intent} sourceSlideIndex=${sourceSlideIndex} layoutId=${boundSlide.layout.layoutId}`)

      // Clone slide XML
      const slideFile = templateZip.file(`ppt/slides/slide${sourceSlideIndex}.xml`)
      if (!slideFile) {
        warnings.push(`Template slide ${sourceSlideIndex} not found, skipping output slide ${outputIdx}`)
        outputIdx-- // don't count this one
        continue
      }
      let slideXml = await slideFile.async('text')

      // Apply content replacements
      try {
        slideXml = applyContentToSlide(slideXml, boundSlide)
      } catch (err) {
        warnings.push(`Content replacement failed for slide ${outputIdx}: ${err instanceof Error ? err.message : String(err)}`)
        // Use unmodified slide XML as fallback
      }

      outputZip.file(`ppt/slides/slide${outputIdx}.xml`, slideXml)

      // Clone slide rels (references slide layout, embedded media, etc.)
      const relsFile = templateZip.file(`ppt/slides/_rels/slide${sourceSlideIndex}.xml.rels`)
      if (relsFile) {
        const relsXml = await relsFile.async('text')
        outputZip.file(`ppt/slides/_rels/slide${outputIdx}.xml.rels`, relsXml)
      }
    }

    const finalSlideCount = outputIdx

    // Update presentation.xml with new slide list
    const presXmlFile = templateZip.file('ppt/presentation.xml')
    if (presXmlFile) {
      const presXml = await presXmlFile.async('text')
      outputZip.file('ppt/presentation.xml', updatePresentationXml(presXml, finalSlideCount))
    }

    // Update presentation.xml.rels with new slide relationships
    const presRelsFile = templateZip.file('ppt/_rels/presentation.xml.rels')
    if (presRelsFile) {
      const presRels = await presRelsFile.async('text')
      outputZip.file('ppt/_rels/presentation.xml.rels', updatePresentationRels(presRels, finalSlideCount))
    }

    // Write output PPTX
    const outputBuffer = await outputZip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    })

    const outputDir = path.dirname(outputPath)
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }
    fs.writeFileSync(outputPath, outputBuffer)

    console.log(`[templateCloneRenderer] Rendered ${finalSlideCount} slides → ${outputPath}`)
    console.log(`[templateCloneRenderer] cloneRendererUsed: true`)
    if (warnings.length > 0) {
      console.warn(`[templateCloneRenderer] Warnings:`, warnings)
    }

    return {
      success: true,
      outputPath,
      slideCount: finalSlideCount,
      warnings: warnings.length > 0 ? warnings : undefined,
      llmCalls: 0,
      imageCalls: 0,
      tokenCost: 0,
    }
  } catch (err) {
    return {
      success: false,
      outputPath,
      slideCount: 0,
      error: err instanceof Error ? err.message : String(err),
      llmCalls: 0,
      imageCalls: 0,
      tokenCost: 0,
    }
  }
}
