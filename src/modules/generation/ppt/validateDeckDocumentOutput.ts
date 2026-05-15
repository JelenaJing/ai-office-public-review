/**
 * validateDeckDocumentOutput — enhanced validator for LLM-produced or assembled DeckDocuments.
 *
 * Beyond the basic structural validation in src/types/deckDocument.ts, this module:
 *  - Detects and auto-strips forbidden template-related fields (theme, color, font, etc.)
 *  - Records every stripped field in `warnings` (never silently discards)
 *  - Downgrades invalid intents to 'unknown' rather than hard-failing
 *  - Validates content_cards slides have items (downgrades to text_content if missing)
 *  - Returns { valid, errors, warnings, deck } — callers decide whether to proceed or abort
 *
 * This validator never throws. Callers receive structured output for logging.
 */

import { validateDeckDocument, type DeckDocument } from '../../../types/deckDocument'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeckValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  /** Populated only when valid === true */
  deck?: DeckDocument
}

// ---------------------------------------------------------------------------
// Forbidden field sets
// ---------------------------------------------------------------------------

const FORBIDDEN_DOC_FIELDS: ReadonlyArray<string> = [
  'templateId', 'theme', 'color', 'font', 'background', 'layout',
  'x', 'y', 'w', 'h', 'master', 'animation',
]

// Fields that are content/semantic, NOT template-visual — must NOT be stripped
const CONTENT_DOC_FIELDS_ALLOW = new Set([
  'imageMode', 'textBlocks', 'assetRequests', 'assetRefs', 'assets',
  'sectionId', 'sections', 'semanticTags',
])

const FORBIDDEN_SLIDE_FIELDS: ReadonlyArray<string> = [
  'templateId', 'theme', 'color', 'font', 'background', 'layout',
  'x', 'y', 'w', 'h', 'master', 'animation', 'style', 'pptxConfig',
]

// Explicit whitelist of content fields that must NEVER be stripped from slides
const _CONTENT_SLIDE_FIELDS_ALLOW = new Set([
  'id', 'sectionId', 'textBlocks', 'assetRequests', 'assetRefs',
  'semanticTags', 'speakerNotes', 'notes', 'summary',
])

const VALID_INTENTS = new Set([
  'cover', 'toc', 'section_divider', 'text_content',
  'content_cards', 'image_text', 'closing', 'unknown',
])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripFields(obj: Record<string, unknown>, forbidden: ReadonlyArray<string>, label: string, warnings: string[]): void {
  for (const field of forbidden) {
    if (field in obj) {
      warnings.push(`[validateDeckDocumentOutput] ${label} contains forbidden field "${field}" — stripped`)
      delete obj[field]
    }
  }
}

// ---------------------------------------------------------------------------
// Main validator
// ---------------------------------------------------------------------------

/**
 * Validates a DeckDocument (raw object, pre-parsed JSON or assembled in memory).
 *
 * The input object MAY be mutated (forbidden fields are deleted in-place).
 * Always returns a DeckValidationResult — never throws.
 */
export function validateDeckDocumentOutput(raw: unknown): DeckValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, errors: ['Input is not an object'], warnings }
  }

  const r = raw as Record<string, unknown>

  // ── Strip forbidden fields at document level ──────────────────────────────
  stripFields(r, FORBIDDEN_DOC_FIELDS, 'document', warnings)

  // ── Basic structure checks ────────────────────────────────────────────────
  if (!r.deckId || typeof r.deckId !== 'string') {
    errors.push('Missing or invalid deckId')
  }
  if (!r.title || typeof r.title !== 'string') {
    errors.push('Missing or invalid title')
  }
  if (!Array.isArray(r.slides)) {
    errors.push('slides must be an array')
    return { valid: false, errors, warnings }
  }
  if ((r.slides as unknown[]).length === 0) {
    errors.push('slides array is empty')
  }
  if (r.status !== 'partial' && r.status !== 'completed') {
    errors.push(`Invalid status: "${r.status}"`)
  }
  if (r.schemaVersion !== '1.0') {
    errors.push(`Unsupported schemaVersion: "${r.schemaVersion}"`)
  }

  // ── Per-slide validation ──────────────────────────────────────────────────
  for (let i = 0; i < (r.slides as unknown[]).length; i++) {
    const slide = (r.slides as unknown[])[i]
    if (slide === null || typeof slide !== 'object' || Array.isArray(slide)) {
      errors.push(`slides[${i}] is not an object`)
      continue
    }

    const s = slide as Record<string, unknown>

    // Strip forbidden fields from slide
    stripFields(s, FORBIDDEN_SLIDE_FIELDS, `slides[${i}]`, warnings)

    // Validate intent
    const intent = String(s.intent || '')
    if (!VALID_INTENTS.has(intent)) {
      warnings.push(`slides[${i}].intent "${intent}" is not a valid DeckSlideIntent — downgrading to "unknown"`)
      s.intent = 'unknown'
    }

    // content_cards must have non-empty items array
    if (s.intent === 'content_cards') {
      if (!Array.isArray(s.items) || (s.items as unknown[]).length === 0) {
        warnings.push(`slides[${i}]: content_cards has no items — downgrading intent to "text_content"`)
        s.intent = 'text_content'
      }
    }
  }

  // ── Auto-derive display title fields when LLM omitted them ──────────────
  // qwen models often skip shortTitle/displayTitle — fill from title as fallback
  let autoFilledCount = 0
  for (let i = 0; i < (r.slides as unknown[]).length; i++) {
    const s = (r.slides as unknown[])[i] as Record<string, unknown>
    const title = typeof s.title === 'string' ? s.title : ''
    if (!title) continue
    let filled = false
    if (!s.displayTitle) {
      s.displayTitle = title.length <= 14 ? title : title.slice(0, 14)
      filled = true
    }
    if (!s.shortTitle) {
      s.shortTitle = title.length <= 8 ? title : title.slice(0, 8)
      filled = true
    }
    if (filled) autoFilledCount++
  }
  if (autoFilledCount > 0) {
    warnings.push(`[validateDeckDocumentOutput] Auto-derived shortTitle/displayTitle for ${autoFilledCount} slide(s)`)
  }

  // ── Return early on structural errors ─────────────────────────────────────
  if (errors.length > 0) {
    return { valid: false, errors, warnings }
  }

  // ── Run full schema validation ────────────────────────────────────────────
  try {
    const deck = validateDeckDocument(r)
    return { valid: true, errors: [], warnings, deck }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { valid: false, errors: [msg], warnings }
  }
}
