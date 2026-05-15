/**
 * PptTemplateManifest — semantic capacity declaration for a PPT template.
 *
 * A TemplateManifest describes WHAT each layout can hold (title length, item count,
 * image slots, etc.) independently of HOW it renders. The visual rendering details
 * live in PptBrandTemplate (pptTemplateRegistry.ts).
 *
 * Rules:
 *  - One manifest per "Skill" / template bundle.
 *  - Each layout declares exactly one primary intent, plus optional alternatives.
 *  - LayoutMatcher uses capacity + intent to pick the best layout for each DeckSlide.
 */

import type { DeckSlideIntent } from './deckDocument'

// ---------------------------------------------------------------------------
// Slot declarations
// ---------------------------------------------------------------------------

export type SlotRole =
  | 'title'
  | 'subtitle'
  | 'heading'
  | 'body'
  | 'body2'
  | 'items'
  | 'left_title'
  | 'left_items'
  | 'right_title'
  | 'right_items'
  | 'metrics'
  | 'timeline'
  | 'image'
  | 'notes'

/**
 * Precise locator for a shape in a PPTX slide.
 * TemplateCloneRenderer uses this to find the exact shape to replace,
 * instead of relying on heuristic placeholder-text matching.
 * At least one field must be provided. shapeId is the most reliable.
 */
export interface SlotLocator {
  /** Shape ID from the PPTX XML (<p:cNvPr id="...">). Most reliable. */
  shapeId?: string
  /** Shape name from the PPTX XML (<p:cNvPr name="...">). */
  shapeName?: string
  /** Fallback: match by placeholder text content substring. */
  placeholderText?: string
}

/**
 * How to fit DeckSlide content into a slot that has size constraints.
 *  - 'truncate'     : Cut text at maxChars.
 *  - 'short_phrase' : Take only first clause/phrase (before ，。\n), then truncate.
 *  - 'single_keyword': Take the first keyword (split on ，,\s), truncate.
 *  - 'body_summary' : Split text into paragraphs (for multi-line body boxes).
 *  - 'clear'        : Always produce empty text (clear the shape).
 *  - 'preserve'     : Do not modify this shape at all.
 */
export type FitPolicy =
  | 'truncate'
  | 'short_phrase'
  | 'single_keyword'
  | 'body_summary'
  | 'clear'
  | 'preserve'

/**
 * Content priority — which DeckSlide fields to try, in order.
 * Supports:
 *   - Simple field: 'title', 'summary', 'body', 'oneLiner', 'subtitle'
 *   - Array index:  'keywords[0]', 'items[0]', 'keyTakeaways[0]'
 *   - Joined array: 'keywords' → joined keywords string
 */
export type ContentPriorityField = string

export interface LayoutSlot {
  slotId: string
  role: SlotRole
  /** Whether this slot must be filled for the layout to be valid */
  required: boolean
  /** Max character count for text slots; ignored for image/list slots */
  maxChars?: number
  /**
   * Precise shape locator in the template PPTX.
   * When set, TemplateCloneRenderer uses this to find the exact shape
   * instead of heuristic placeholder-text matching.
   */
  locator?: SlotLocator
  /**
   * DeckSlide field names to try in order when resolving slot content.
   * E.g. ['oneLiner', 'title'] means: use oneLiner if available, else title.
   * Supports array indexing: 'keywords[0]', 'items[1]'.
   * When not set, falls back to role-based BoundSlotValues lookup.
   */
  contentPriority?: ContentPriorityField[]
  /**
   * How to fit text into this slot when it exceeds capacity.
   * Default: 'truncate'.
   */
  fitPolicy?: FitPolicy
  /**
   * Text orientation of this shape. 'vertical' means the box is narrow and
   * chars stack — do NOT put long sentences here.
   * Default: 'horizontal'.
   */
  orientation?: 'horizontal' | 'vertical'
}

// ---------------------------------------------------------------------------
// Layout capacity (drives LayoutMatcher scoring)
// ---------------------------------------------------------------------------

export interface LayoutCapacity {
  /** Max characters for the title/heading field */
  titleMaxChars: number
  /** Max characters for the body paragraph field */
  bodyMaxChars: number
  /** Minimum number of list items */
  itemMin: number
  /** Maximum number of list items */
  itemMax: number
  /** Max characters per individual list item */
  bodyMaxCharsPerItem: number
  /** Number of image slots (0 = no image, 1 = one image) */
  imageSlots: number
}

// ---------------------------------------------------------------------------
// Layout kind — describes the rendering style of the layout
// ---------------------------------------------------------------------------

export type LayoutKind =
  | 'cover'
  | 'toc'
  | 'section'
  | 'text_heavy'   // Long paragraphs, academic / detailed
  | 'image_heavy'  // Large image with short caption
  | 'cards'        // Grid of cards / key points
  | 'timeline'     // Sequential steps
  | 'metrics'      // KPI / data callouts
  | 'quote'        // Pull quote / highlight
  | 'closing'      // Thank-you / conclusion

// ---------------------------------------------------------------------------
// Layout supports — what content types a layout can handle well
// ---------------------------------------------------------------------------

export interface LayoutSupports {
  /** Has an image slot */
  image?: boolean
  /** Can comfortably display long body text (bodyMaxChars > 150) */
  longText?: boolean
  /** Designed for bullet/card lists */
  cards?: boolean
  /** Has a metrics/KPI display area */
  metrics?: boolean
  /** Has a chart/diagram placeholder */
  chart?: boolean
}

// ---------------------------------------------------------------------------
// Fallback rules (what to do when content exceeds layout capacity)
// ---------------------------------------------------------------------------

export interface FallbackRule {
  /** Condition expression (human-readable description, e.g. 'items.length > itemMax') */
  condition: string
  /** Action to take when condition is met */
  action: 'paginate' | 'truncate' | 'move_to_unplaced'
}

// ---------------------------------------------------------------------------
// Layout definition
// ---------------------------------------------------------------------------

export interface TemplateLayout {
  layoutId: string
  /** Primary semantic intent this layout is designed for */
  intent: DeckSlideIntent
  /** Additional intents this layout can acceptably serve */
  alternativeIntents?: DeckSlideIntent[]
  capacity: LayoutCapacity
  slots: LayoutSlot[]
  /** Visual / structural style of this layout */
  layoutKind?: LayoutKind
  /** Supported content types (for LayoutMatcher bonus scoring) */
  supports?: LayoutSupports
  /** Shorthand for capacity.imageSlots >= 1 */
  supportsImage?: boolean
  /** Maximum number of DeckTextBlock entries this layout can bind */
  maxTextBlocks?: number
  /** Rules applied when content overflows capacity */
  fallbackRules?: FallbackRule[]
  /**
   * 1-based index of the source slide in the template PPTX file.
   * Used by TemplateCloneRenderer to clone the actual template slide
   * instead of re-drawing from scratch. When present on all layouts,
   * the clone path is used; otherwise falls back to pptxGenerator.
   */
  sourceSlideIndex?: number
}

// ---------------------------------------------------------------------------
// Template profile — overall content capability of the whole template
// ---------------------------------------------------------------------------

/**
 * What to do when long text can't fit on one slide.
 *  - 'keep'            : Keep on one slide; may overflow visually (academic style).
 *  - 'split_page'      : Split onto multiple continuation pages.
 *  - 'split_to_bullets': Convert long paragraph into bullet points on the same slide.
 */
export type LongTextFallback = 'keep' | 'split_page' | 'split_to_bullets'

/**
 * What to do when a slide requests an image but no asset is available.
 *  - 'text_only'              : Use a text-only layout (no image placeholder).
 *  - 'use_template_decoration': Use the template's built-in decorative background.
 *  - 'placeholder'            : Insert a placeholder image box.
 */
export type MissingImageFallback = 'text_only' | 'use_template_decoration' | 'placeholder'

/**
 * What to do when there are more images than image slots.
 *  - 'figure_page'   : Insert a dedicated figure/image-only slide.
 *  - 'image_page'    : Same as figure_page (alias).
 *  - 'unplaced_assets': Move excess images to BindingPlan.unplacedAssets; do not create extra slides.
 */
export type ExtraImageFallback = 'figure_page' | 'image_page' | 'unplaced_assets'

export interface TemplateProfile {
  /** How much text this template comfortably holds per slide */
  textCapacity: 'low' | 'medium' | 'high'
  /** How well this template handles images */
  imageCapacity: 'low' | 'medium' | 'high'
  /** How well this template handles card/list content */
  cardCapacity: 'low' | 'medium' | 'high'
  /** What to do when long text overflows */
  longTextFallback: LongTextFallback
  /** What to do when an image is needed but unavailable */
  missingImageFallback: MissingImageFallback
  /** What to do with extra images that don't fit */
  extraImageFallback: ExtraImageFallback
  /** Preferred layout kinds for this template (LayoutMatcher bonus) */
  preferredLayouts?: LayoutKind[]
  /**
   * Content style preference — tells SlotBinder which content layer to prefer.
   *  - 'academic'  : Long body text, keyTakeaways as bullets, speakerNotes for annotation.
   *  - 'business'  : items/cards, metrics, keywords; body can be split to bullets.
   *  - 'aesthetic' : oneLiner first, then summary; keywords as accents; visualBrief for images.
   */
  contentStyle?: 'academic' | 'business' | 'aesthetic'
}

// ---------------------------------------------------------------------------
// Template manifest root
// ---------------------------------------------------------------------------

export interface PptTemplateManifest {
  /** Must match the PptBrandTemplate.id registered in pptTemplateRegistry.ts */
  manifestId: string
  name: string
  description: string
  /** Short hex color for preview swatches (no #), e.g. '1F3864' */
  previewColor: string
  /** Version string, e.g. '1.0' */
  version: string
  /** Overall content capability profile for this template */
  templateProfile?: TemplateProfile
  layouts: TemplateLayout[]
}

// ---------------------------------------------------------------------------
// Registry helpers (in-memory, populated by template files at startup)
// ---------------------------------------------------------------------------

const MANIFEST_REGISTRY: Map<string, PptTemplateManifest> = new Map()

export function registerTemplateManifest(manifest: PptTemplateManifest): void {
  MANIFEST_REGISTRY.set(manifest.manifestId, manifest)
}

export function getTemplateManifest(manifestId: string): PptTemplateManifest | undefined {
  return MANIFEST_REGISTRY.get(manifestId)
}

export function listTemplateManifests(): PptTemplateManifest[] {
  return Array.from(MANIFEST_REGISTRY.values())
}

