/**
 * PptBindingPlan — the output of SlotBinder, consumed by DeckToPptxAdapter.
 *
 * A BindingPlan is a list of BoundSlide objects, each pairing a chosen layout
 * with the actual slot values from the DeckDocument. The adapter converts this
 * into PptxSlideDefinition[] which pptxGenerator.ts can consume.
 *
 * No LLM calls; no image generation. Pure data mapping.
 */

import type { DeckSlide } from './deckDocument'
import type { TemplateLayout } from './pptTemplateManifest'

// ---------------------------------------------------------------------------
// Adaptation action tracking
// ---------------------------------------------------------------------------

/**
 * What the engine did to adapt a slide's content to fit the chosen layout.
 */
export type AdaptationActionKind =
  | 'direct_bind'             // Content fit perfectly; no changes needed
  | 'split_text'              // Long body was split across continuation pages
  | 'split_cards'             // Item list was split across continuation pages
  | 'convert_cards_to_bullets'// Card intent converted to text+bullets due to template capacity
  | 'convert_text_to_bullets' // Long body converted to bullet list
  | 'move_asset_to_unplaced'  // Image asset could not be placed; moved to unplacedAssets
  | 'create_image_page'       // A new dedicated image slide was inserted
  | 'text_only_fallback'      // Image was needed but unavailable; used text-only layout

export interface AdaptationRecord {
  action: AdaptationActionKind
  reason: string
  /** Slot or field that triggered this adaptation */
  slot?: string
  /** Additional context (e.g. original body length vs capacity) */
  detail?: string
}

// ---------------------------------------------------------------------------
// Explicit slot binding record (for traceability)
// ---------------------------------------------------------------------------

export interface SlotBinding {
  /** Layout slot ID being filled (e.g. 'heading', 'image') */
  slotId: string
  /** JSON-path-style reference to the source value (e.g. 'slides[2].items[0]') */
  sourcePath: string
  /** Type of content placed in this slot */
  valueType: 'text' | 'image' | 'chart'
  /** Filled text (when valueType = 'text') */
  text?: string
  /** Asset ID (when valueType = 'image' | 'chart') */
  assetId?: string
  /** Transform applied (e.g. 'truncate:50') */
  transform?: string
  /** What to do if content exceeds slot capacity */
  overflow?: 'truncate' | 'paginate' | 'ignore'
}

// ---------------------------------------------------------------------------
// Unplaced tracking
// ---------------------------------------------------------------------------

/** Content that could not fit into any layout slot */
export interface UnplacedContent {
  sourceSlideId: string
  sourcePath: string
  reason: string
  content: string | string[]
}

/** Asset that could not be placed in an image slot */
export interface UnplacedAsset {
  assetId: string
  reason: string
  /** Suggested fallback action */
  suggestion: 'add_image_page' | 'use_as_background' | 'ignore'
}

// ---------------------------------------------------------------------------
// Slot values (filled in by SlotBinder)
// ---------------------------------------------------------------------------

export interface BoundSlotValues {
  title?: string
  subtitle?: string
  heading?: string
  body?: string
  items?: string[]
  leftTitle?: string
  leftItems?: string[]
  rightTitle?: string
  rightItems?: string[]
  metrics?: Array<{ value: string; label: string; detail?: string }>
  timeline?: Array<{ title: string; detail?: string }>
  imagePath?: string | null
  /** Asset ID for image slot (preferred over imagePath for template switching) */
  assetId?: string
  notes?: string
}

// ---------------------------------------------------------------------------
// A single bound slide
// ---------------------------------------------------------------------------

export interface BoundSlide {
  /** 0-based index in the final PPTX (may differ from source DeckSlide index if paginator split) */
  outputIndex: number
  /** The source DeckSlide (before any pagination split) */
  sourceSlide: DeckSlide
  /** Source slide IDs that contributed to this output slide (for continuation pages) */
  sourceSlideIds?: string[]
  /** The layout chosen by LayoutMatcher */
  layout: TemplateLayout
  /** Matching score from LayoutMatcher */
  matchScore: number
  /** The actual content values mapped to each slot */
  slots: BoundSlotValues
  /** Explicit per-slot bindings (for traceability) */
  bindings?: SlotBinding[]
  /** Adaptation actions applied to fit content into this layout */
  adaptation?: AdaptationRecord
  /** True when this is a continuation page produced by ContentPaginator */
  isContinuation: boolean
}

// ---------------------------------------------------------------------------
// BindingPlan root
// ---------------------------------------------------------------------------

export interface BindingPlan {
  /** The deck this plan was built from */
  deckId?: string
  /** The manifest/skill ID that was used (canonical) */
  templateSkillId?: string
  /** The manifest ID (backward compat alias for templateSkillId) */
  manifestId: string
  /** Fully resolved bound slides in output order */
  boundSlides: BoundSlide[]
  /** Content that could not be placed in any layout slot */
  unplacedContent?: UnplacedContent[]
  /** Assets that could not be placed in any image slot */
  unplacedAssets?: UnplacedAsset[]
  /** Non-fatal warnings from the binding process */
  warnings?: string[]
}
