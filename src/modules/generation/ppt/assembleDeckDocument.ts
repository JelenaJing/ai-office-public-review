/**
 * assembleDeckDocument — converts the internal PPT generation output
 * (completedSlides + outlinePlan) into a DeckDocument.
 *
 * This is a pure local transformation. No LLM, no image generation, no token cost.
 * It bridges the old PresentationContentPackage generation chain to the new
 * DeckDocument architecture (Phase 2A parallel migration).
 *
 * Forbidden fields are stripped before assembly. Image paths from the generation
 * chain are lifted into DeckAsset objects with assetIds, and slides reference them
 * via assetRefs (so template switching never needs to re-generate images).
 */

import type { DeckDocument, DeckSlide, DeckSlideIntent, DeckAsset, ImageMode } from '../../../types/deckDocument'

// ---------------------------------------------------------------------------
// Types for callers
// ---------------------------------------------------------------------------

export interface OutlinePlanSlide {
  index: number
  role: string
  heading: string
  hint?: string
}

export interface CompletedSlideEntry {
  slideData: Record<string, unknown>
  outlineIndex: number
}

export interface ImageAssetEntry {
  slideIndex: number
  imagePath: string
  /** Optional: explicit purpose for this image asset */
  purpose?: DeckAsset['purpose']
}

export interface AssembleDeckDocumentOptions {
  outlineTitle: string
  completedSlides: CompletedSlideEntry[]
  outlinePlan: OutlinePlanSlide[]
  sourcePrompt: string
  imageAssets: ImageAssetEntry[]
  /** Image generation mode; controls which pages are expected to have images */
  imageMode?: ImageMode
  /** Scenario / use-case tag e.g. 'business_report', 'academic_defense' */
  scenario?: string
}

// ---------------------------------------------------------------------------
// Role → Intent mapping
// ---------------------------------------------------------------------------

const ROLE_TO_INTENT_MAP: Record<string, DeckSlideIntent> = {
  // New intent names (pass-through)
  cover: 'cover',
  toc: 'toc',
  section_divider: 'section_divider',
  text_content: 'text_content',
  content_cards: 'content_cards',
  image_text: 'image_text',
  closing: 'closing',
  unknown: 'unknown',
  // Legacy role names
  agenda: 'toc',
  section: 'section_divider',
  content: 'text_content',
  cards: 'content_cards',
  summary: 'closing',
  ending: 'closing',
  // Structural roles that map to text_content (metrics/comparison/timeline
  // have their own slide fields preserved in DeckSlide)
  metrics: 'text_content',
  comparison: 'text_content',
  timeline: 'text_content',
}

export function mapLegacyRoleToDeckIntent(role: string): DeckSlideIntent {
  const normalised = role.toLowerCase().trim()
  return ROLE_TO_INTENT_MAP[normalised] ?? 'unknown'
}

// ---------------------------------------------------------------------------
// Forbidden field stripping
// ---------------------------------------------------------------------------

const FORBIDDEN_SLIDE_FIELDS = new Set([
  'templateId', 'theme', 'color', 'font', 'background', 'layout',
  'x', 'y', 'w', 'h', 'master', 'animation', 'style', 'pptxConfig',
])

function stripForbiddenFields(obj: Record<string, unknown>): { cleaned: Record<string, unknown>; stripped: string[] } {
  const stripped: string[] = []
  const cleaned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (FORBIDDEN_SLIDE_FIELDS.has(key)) {
      stripped.push(key)
    } else {
      cleaned[key] = value
    }
  }
  return { cleaned, stripped }
}

// ---------------------------------------------------------------------------
// Main assembler
// ---------------------------------------------------------------------------

export function assembleDeckDocument(options: AssembleDeckDocumentOptions): DeckDocument {
  const { outlineTitle, completedSlides, outlinePlan, sourcePrompt, imageAssets, imageMode, scenario } = options

  const deckId = `deck-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const now = new Date().toISOString()

  // Build asset map: slideIndex → { assetId, imagePath, purpose }
  const assetBySlideIndex = new Map<number, { assetId: string; imagePath: string; purpose?: DeckAsset['purpose'] }>()
  const assets: DeckAsset[] = imageAssets.map((ia, idx) => {
    const assetId = `asset-${idx}-si${ia.slideIndex}`
    const slideId = `slide-${ia.slideIndex}`
    const purpose: DeckAsset['purpose'] = ia.purpose ?? 'illustration'
    assetBySlideIndex.set(ia.slideIndex, { assetId, imagePath: ia.imagePath, purpose })
    return {
      assetId,
      type: 'image' as const,
      source: 'generated' as const,
      path: ia.imagePath,
      purpose,
      targetSlideId: slideId,
      // backward compat
      imagePath: ia.imagePath,
      slideIndex: ia.slideIndex,
    } satisfies DeckAsset
  })

  // Build a quick lookup from outlinePlan
  const outlineByIndex = new Map<number, OutlinePlanSlide>()
  for (const op of outlinePlan) outlineByIndex.set(op.index, op)

  const strippedWarnings: string[] = []

  // Build slides
  const slides: DeckSlide[] = completedSlides.map(({ slideData: rawSlide, outlineIndex }) => {
    const { cleaned, stripped } = stripForbiddenFields(rawSlide)
    if (stripped.length > 0) {
      strippedWarnings.push(`slides[${outlineIndex}]: stripped forbidden fields [${stripped.join(', ')}]`)
    }

    // Determine intent: prefer 'intent' field, then 'type', then outline role
    const outlineInfo = outlineByIndex.get(outlineIndex)
    const rawRole = String(cleaned.intent || cleaned.type || outlineInfo?.role || 'unknown')
    const intent = mapLegacyRoleToDeckIntent(rawRole)

    // Stable slide ID for asset binding
    const slideId = `slide-${outlineIndex}`

    // Asset references from the image generated for this slide
    const assetEntry = assetBySlideIndex.get(outlineIndex)
    const assetRefs: string[] = assetEntry ? [assetEntry.assetId] : []

    const slide: DeckSlide = {
      id: slideId,
      index: outlineIndex,
      intent,
      title: cleaned.title != null ? String(cleaned.title) : undefined,
      subtitle: cleaned.subtitle != null ? String(cleaned.subtitle) : undefined,
      heading: cleaned.heading != null
        ? String(cleaned.heading)
        : (outlineInfo?.heading || undefined),
      body: cleaned.body != null ? String(cleaned.body) : undefined,
      items: Array.isArray(cleaned.items)
        ? (cleaned.items as unknown[]).map(String)
        : undefined,
      leftTitle: cleaned.leftTitle != null ? String(cleaned.leftTitle) : undefined,
      leftItems: Array.isArray(cleaned.leftItems)
        ? (cleaned.leftItems as unknown[]).map(String)
        : undefined,
      rightTitle: cleaned.rightTitle != null ? String(cleaned.rightTitle) : undefined,
      rightItems: Array.isArray(cleaned.rightItems)
        ? (cleaned.rightItems as unknown[]).map(String)
        : undefined,
      metrics: Array.isArray(cleaned.metrics)
        ? (cleaned.metrics as Array<Record<string, unknown>>).map((m) => ({
            value: String(m.value ?? ''),
            label: String(m.label ?? ''),
            detail: m.detail != null ? String(m.detail) : undefined,
          }))
        : undefined,
      timeline: Array.isArray(cleaned.timeline)
        ? (cleaned.timeline as Array<Record<string, unknown>>).map((t) => ({
            title: String(t.title ?? ''),
            detail: t.detail != null ? String(t.detail) : undefined,
          }))
        : undefined,
      // imagePath kept for backward compatibility with SlotBinder
      imagePath: assetEntry?.imagePath ?? null,
      assetRefs: assetRefs.length > 0 ? assetRefs : undefined,
      notes: cleaned.notes != null ? String(cleaned.notes) : undefined,
    }

    return slide
  })

  if (strippedWarnings.length > 0) {
    console.warn('[assembleDeckDocument] stripped forbidden fields from slides:', strippedWarnings)
  }

  // Collect section names from section_divider slides
  const sections = slides
    .filter((s) => s.intent === 'section_divider')
    .map((s) => s.heading || s.title || '')
    .filter(Boolean)

  const deck: DeckDocument = {
    deckId,
    schemaVersion: '1.0',
    title: outlineTitle,
    scenario: scenario ?? 'business_report',
    language: 'zh',
    sections: sections.length > 0 ? sections : undefined,
    imageMode: imageMode ?? 'none',
    slides,
    assets,
    sourcePrompt,
    source: { type: 'generated' },
    status: 'completed',
    expectedSlideCount: outlinePlan.length,
    completedSlideCount: completedSlides.length,
    createdAt: now,
    updatedAt: now,
  }

  return deck
}

