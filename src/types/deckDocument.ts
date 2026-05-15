/**
 * DeckDocument — the semantic content source-of-truth for a presentation.
 *
 * PPTX is a rendering artifact. DeckDocument is what the LLM outputs and what
 * gets persisted. Any number of TemplateManifests can render from the same DeckDocument
 * without re-invoking the LLM.
 *
 * FORBIDDEN fields (must never appear here):
 *   templateId, theme, font, color, backgroundImage, layoutCoordinates, master, animation
 */

// ---------------------------------------------------------------------------
// Slide intent: semantic purpose of a slide, template-agnostic
// ---------------------------------------------------------------------------

export type DeckSlideIntent =
  | 'cover'           // Title page
  | 'toc'             // Table of contents
  | 'section_divider' // Chapter / section heading
  | 'text_content'    // Body text + optional bullet points
  | 'content_cards'   // Grid of cards / items
  | 'image_text'      // Text + image side-by-side
  | 'closing'         // Conclusion / thank-you
  | 'unknown'         // Fallback

// ---------------------------------------------------------------------------
// Image mode: controls whether/how images are generated for the deck
// ---------------------------------------------------------------------------

/**
 * Controls which slides receive generated images.
 *  - 'none'       : No images generated. All imageCalls = 0.
 *  - 'cover_only' : Only the cover slide gets a background image.
 *  - 'section'    : Section divider slides get a visual image.
 *  - 'per_slide'  : Each content slide may request an image.
 */
export type ImageMode = 'none' | 'cover_only' | 'section' | 'per_slide'

// ---------------------------------------------------------------------------
// Slide-level types
// ---------------------------------------------------------------------------

export interface DeckSlideMetric {
  value: string
  label: string
  detail?: string
}

export interface DeckSlideTimelineEntry {
  title: string
  detail?: string
}

/**
 * A named text block within a slide. Provides fine-grained slot binding.
 * When present, SlotBinder can match individual textBlocks to layout slots.
 */
export interface DeckTextBlock {
  /** Unique within the slide */
  blockId: string
  /** Semantic role of this text block */
  role: 'heading' | 'body' | 'caption' | 'callout' | 'subtitle' | 'item'
  text: string
  /** Soft character limit hint for layout matching */
  maxChars?: number
}

// ---------------------------------------------------------------------------
// Asset request: declares what images are needed BEFORE generation
// ---------------------------------------------------------------------------

export type DeckAssetPurpose =
  | 'cover_background'
  | 'illustration'
  | 'diagram'
  | 'section_visual'
  | 'background'

/**
 * A pre-declared image need attached to a slide.
 * Produced during Phase A (DeckPlan). Fulfilled during Phase C (generateDeckAssets).
 * When imageMode = 'none', assetRequests are recorded but never fulfilled.
 */
export interface AssetRequest {
  requestId: string
  purpose: DeckAssetPurpose
  /** Natural-language description for image generation prompt */
  sourceDescription: string
  /** Which slide this asset is destined for */
  targetSlideId?: string
  /** Which textBlock(s) in that slide this image relates to */
  targetTextBlockIds?: string[]
  semanticTags?: string[]
}

// ---------------------------------------------------------------------------
// Asset types
// ---------------------------------------------------------------------------

export type DeckAssetType = 'image' | 'chart' | 'icon'
export type DeckAssetSource = 'generated' | 'uploaded' | 'imported_pptx'

// ---------------------------------------------------------------------------
// Asset
// ---------------------------------------------------------------------------

export interface DeckAsset {
  /** Unique identifier for this asset, referenced by DeckSlide.assetRefs */
  assetId: string
  /** Asset media type */
  type?: DeckAssetType
  /** How this asset was obtained */
  source?: DeckAssetSource
  /** Canonical absolute local path to the file */
  path?: string
  /** Semantic purpose of this asset */
  purpose?: DeckAssetPurpose
  /** Which slide this asset belongs to (by slide id string, e.g. 'slide-0') */
  targetSlideId?: string
  /** Which textBlocks in that slide reference this asset */
  targetTextBlockIds?: string[]
  /** Human-readable caption for this asset */
  caption?: string
  /** Tags for semantic matching in SlotBinder */
  semanticTags?: string[]

  // Backward compatibility fields:
  /** @deprecated Use path instead */
  imagePath?: string
  /** @deprecated Use targetSlideId instead */
  slideIndex?: number
}

/**
 * One logical slide worth of semantic content.
 * A single DeckSlide may expand into multiple physical slides if the chosen
 * layout cannot fit all its content (ContentPaginator handles this).
 */
export interface DeckSlide {
  /** 0-based index in the deck */
  index: number
  intent: DeckSlideIntent
  /** Stable string ID for this slide, e.g. 'slide-0' (used in assetRefs binding) */
  id?: string
  /** Section this slide belongs to (for grouping / navigation) */
  sectionId?: string

  // ── Content demand hints (template-agnostic) ────────────────────────────
  /**
   * How text-dense this slide is.
   * 'low' = short labels; 'high' = long paragraphs or many bullets.
   */
  contentDensity?: 'low' | 'medium' | 'high'
  /**
   * How important imagery is for this slide.
   * 'required' = the slide loses meaning without an image.
   * 'optional' = an image enriches but is not critical.
   * 'none'     = purely text.
   */
  visualDemand?: 'none' | 'optional' | 'required'
  /**
   * The author's preferred rendering style for this slide.
   * LayoutMatcher uses this as a tiebreaker / bonus signal.
   */
  preferredLayout?: 'text_heavy' | 'image_heavy' | 'cards' | 'timeline' | 'metrics' | 'quote'

  // ── Text fields ─────────────────────────────────────────────────────────
  /** Main title text */
  title?: string
  /**
   * Short display title, ≤8 Chinese characters. Preferred for big-font PPT cover areas
   * (e.g. 72pt or 88pt shapes) where the full title would overflow.
   */
  shortTitle?: string
  /**
   * Display-safe title for large PPT title boxes, ≤14 Chinese characters.
   * Optimised for readability at large font sizes (40pt+).
   * Falls back to shortTitle then title if absent.
   */
  displayTitle?: string
  /** Subtitle (used on cover / section slides) */
  subtitle?: string
  /** Heading shown on content slides (may differ from title) */
  heading?: string
  /** Long-form paragraph body */
  body?: string
  /** Bullet point items */
  items?: string[]
  /** Fine-grained named text blocks (for slot binding) */
  textBlocks?: DeckTextBlock[]
  /** Pre-declared asset needs for this slide */
  assetRequests?: AssetRequest[]
  /** Two-column comparison data */
  leftTitle?: string
  leftItems?: string[]
  rightTitle?: string
  rightItems?: string[]
  /** Metric cards */
  metrics?: DeckSlideMetric[]
  /** Timeline nodes */
  timeline?: DeckSlideTimelineEntry[]

  // ── Asset fields ─────────────────────────────────────────────────────────
  /** Absolute local path to an already-generated image, if any */
  imagePath?: string | null
  /** True while the image is still being generated */
  imageLoading?: boolean
  /** Asset IDs from DeckDocument.assets associated with this slide */
  assetRefs?: string[]

  // ── Rich content layers (model-agnostic; SlotBinder picks per template style) ──
  /**
   * A single evocative sentence. Ideal for Chinese-aesthetic / minimal templates
   * where each slide carries one strong idea (section dividers, cover, closing).
   */
  oneLiner?: string
  /**
   * Short summary (2-5 sentences). Used by aesthetic & business templates
   * when a full `body` would be too long for the layout.
   */
  summary?: string
  /**
   * Keyword list — decorative terms, topic tags, or short labels.
   * Business templates use these on keyword-highlight pages;
   * Chinese-style templates use them as decorative accents.
   */
  keywords?: string[]
  /**
   * 2-5 distilled conclusions or action items from this slide's content.
   * Academic templates show these as a "takeaways" bullet block;
   * business templates use them in closing / summary cards.
   */
  keyTakeaways?: string[]
  /**
   * Natural-language description of the ideal visual for this slide.
   * Used by image-generation pipelines (Phase C) and for image matching.
   * When imageMode = 'none', this field is recorded but not fulfilled.
   */
  visualBrief?: string
  /** Speaker notes (preferred field name) */
  speakerNotes?: string
  /** Speaker notes (legacy alias — prefer speakerNotes) */
  notes?: string
}

// ---------------------------------------------------------------------------
// Asset (inline declaration above)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// DeckDocument root
// ---------------------------------------------------------------------------

/**
 * A reference from DeckDocument content back to its source material.
 * Used when source.type = 'manuscript' to trace PPT content to manuscript paragraphs.
 */
export interface DeckSourceRef {
  /** ID of the referenced source (manuscriptId, slideIndex as string, etc.) */
  sourceId: string
  /** Where this reference came from */
  sourceType: 'manuscript' | 'pptx_slide' | 'knowledge' | 'mail_attachment'
  /** Short excerpt of the source text being referenced */
  excerpt?: string
  /** Slide index in the original PPTX (when sourceType = 'pptx_slide') */
  slideIndex?: number
  /** Confidence that this reference is correctly mapped (0–1) */
  confidence?: number
  emailAttachment?: {
    messageId?: string
    attachmentId?: string
    filename?: string
  }
}

export interface DeckDocument {
  deckId: string
  schemaVersion: '1.0'
  title: string
  subtitle?: string
  /** Usage context, e.g. 'business_report' | 'academic_defense' | 'product_launch' */
  scenario?: string
  language: 'zh' | 'en'
  /** High-level chapter names, used to group slides */
  sections?: string[]
  /** Controls which slides will have images generated */
  imageMode?: ImageMode
  slides: DeckSlide[]
  assets: DeckAsset[]
  sourcePrompt?: string
  source: {
    /** How this DeckDocument was created */
    type: 'generated' | 'manuscript' | 'prompt' | 'imported_pptx'
    /** Path to the original PPTX when type = 'imported_pptx' */
    sourcePath?: string
    /** ID of the source manuscript when type = 'manuscript' */
    manuscriptId?: string
    emailAttachment?: {
      messageId?: string
      attachmentId?: string
      filename?: string
    }
  }
  /** References from this deck's content back to source material */
  sourceRefs?: DeckSourceRef[]
  status: 'partial' | 'completed'
  expectedSlideCount: number
  completedSlideCount: number
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Validation (no zod dependency)
// ---------------------------------------------------------------------------

const VALID_INTENTS = new Set<DeckSlideIntent>([
  'cover', 'toc', 'section_divider', 'text_content',
  'content_cards', 'image_text', 'closing', 'unknown',
])

function assertString(val: unknown, path: string): asserts val is string {
  if (typeof val !== 'string') {
    throw new TypeError(`DeckDocument: expected string at ${path}, got ${typeof val}`)
  }
}

function assertArray(val: unknown, path: string): asserts val is unknown[] {
  if (!Array.isArray(val)) {
    throw new TypeError(`DeckDocument: expected array at ${path}, got ${typeof val}`)
  }
}

function assertObject(val: unknown, path: string): asserts val is Record<string, unknown> {
  if (typeof val !== 'object' || val === null || Array.isArray(val)) {
    throw new TypeError(`DeckDocument: expected object at ${path}, got ${typeof val}`)
  }
}

function normalizeEmailAttachmentRef(raw: unknown): DeckSourceRef['emailAttachment'] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const r = raw as Record<string, unknown>
  return {
    messageId: r.messageId != null ? String(r.messageId) : undefined,
    attachmentId: r.attachmentId != null ? String(r.attachmentId) : undefined,
    filename: r.filename != null ? String(r.filename) : undefined,
  }
}

function validateSlide(raw: unknown, index: number): DeckSlide {
  assertObject(raw, `slides[${index}]`)
  const r = raw as Record<string, unknown>
  const intent = String(r.intent ?? 'unknown')
  if (!VALID_INTENTS.has(intent as DeckSlideIntent)) {
    throw new TypeError(`DeckDocument: unknown intent "${intent}" at slides[${index}].intent`)
  }
  return {
    index: typeof r.index === 'number' ? r.index : index,
    intent: intent as DeckSlideIntent,
    id: r.id != null ? String(r.id) : undefined,
    sectionId: r.sectionId != null ? String(r.sectionId) : undefined,
    title: r.title != null ? String(r.title) : undefined,
    shortTitle: r.shortTitle != null ? String(r.shortTitle) : undefined,
    displayTitle: r.displayTitle != null ? String(r.displayTitle) : undefined,
    subtitle: r.subtitle != null ? String(r.subtitle) : undefined,
    heading: r.heading != null ? String(r.heading) : undefined,
    body: r.body != null ? String(r.body) : undefined,
    items: Array.isArray(r.items) ? (r.items as unknown[]).map(String) : undefined,
    textBlocks: Array.isArray(r.textBlocks)
      ? (r.textBlocks as unknown[]).map((tb, tbi) => {
          assertObject(tb, `slides[${index}].textBlocks[${tbi}]`)
          const t = tb as Record<string, unknown>
          return {
            blockId: String(t.blockId ?? `block-${tbi}`),
            role: String(t.role ?? 'body') as DeckTextBlock['role'],
            text: String(t.text ?? ''),
            maxChars: typeof t.maxChars === 'number' ? t.maxChars : undefined,
          } satisfies DeckTextBlock
        })
      : undefined,
    assetRequests: Array.isArray(r.assetRequests)
      ? (r.assetRequests as unknown[]).map((req, ri) => {
          assertObject(req, `slides[${index}].assetRequests[${ri}]`)
          const rr = req as Record<string, unknown>
          return {
            requestId: String(rr.requestId ?? `req-${ri}`),
            purpose: String(rr.purpose ?? 'illustration') as AssetRequest['purpose'],
            sourceDescription: String(rr.sourceDescription ?? ''),
            targetSlideId: rr.targetSlideId != null ? String(rr.targetSlideId) : undefined,
            targetTextBlockIds: Array.isArray(rr.targetTextBlockIds)
              ? (rr.targetTextBlockIds as unknown[]).map(String)
              : undefined,
            semanticTags: Array.isArray(rr.semanticTags)
              ? (rr.semanticTags as unknown[]).map(String)
              : undefined,
          } satisfies AssetRequest
        })
      : undefined,
    leftTitle: r.leftTitle != null ? String(r.leftTitle) : undefined,
    leftItems: Array.isArray(r.leftItems) ? (r.leftItems as unknown[]).map(String) : undefined,
    rightTitle: r.rightTitle != null ? String(r.rightTitle) : undefined,
    rightItems: Array.isArray(r.rightItems) ? (r.rightItems as unknown[]).map(String) : undefined,
    metrics: Array.isArray(r.metrics)
      ? (r.metrics as unknown[]).map((m, mi) => {
        assertObject(m, `slides[${index}].metrics[${mi}]`)
        const mm = m as Record<string, unknown>
        return {
          value: String(mm.value ?? ''),
          label: String(mm.label ?? ''),
          detail: mm.detail != null ? String(mm.detail) : undefined,
        }
      })
      : undefined,
    timeline: Array.isArray(r.timeline)
      ? (r.timeline as unknown[]).map((t, ti) => {
        assertObject(t, `slides[${index}].timeline[${ti}]`)
        const tt = t as Record<string, unknown>
        return {
          title: String(tt.title ?? ''),
          detail: tt.detail != null ? String(tt.detail) : undefined,
        }
      })
      : undefined,
    imagePath: r.imagePath != null ? String(r.imagePath) : undefined,
    assetRefs: Array.isArray(r.assetRefs) ? (r.assetRefs as unknown[]).map(String) : undefined,
    oneLiner: r.oneLiner != null ? String(r.oneLiner) : undefined,
    summary: r.summary != null ? String(r.summary) : undefined,
    keywords: Array.isArray(r.keywords) ? (r.keywords as unknown[]).map(String) : undefined,
    keyTakeaways: Array.isArray(r.keyTakeaways) ? (r.keyTakeaways as unknown[]).map(String) : undefined,
    visualBrief: r.visualBrief != null ? String(r.visualBrief) : undefined,
    notes: r.notes != null ? String(r.notes) : r.speakerNotes != null ? String(r.speakerNotes) : undefined,
    speakerNotes: r.speakerNotes != null ? String(r.speakerNotes) : r.notes != null ? String(r.notes) : undefined,
    contentDensity: r.contentDensity != null
      ? (String(r.contentDensity) as 'low' | 'medium' | 'high')
      : undefined,
    visualDemand: r.visualDemand != null
      ? (String(r.visualDemand) as 'none' | 'optional' | 'required')
      : undefined,
    preferredLayout: r.preferredLayout != null
      ? (String(r.preferredLayout) as DeckSlide['preferredLayout'])
      : undefined,
  }
}

const VALID_IMAGE_MODES = new Set<ImageMode>(['none', 'cover_only', 'section', 'per_slide'])

/**
 * Validates raw JSON (parsed from disk) and returns a typed DeckDocument.
 * Throws a TypeError describing the first schema violation found.
 */
export function validateDeckDocument(raw: unknown): DeckDocument {
  assertObject(raw, 'root')
  const r = raw as Record<string, unknown>

  assertString(r.deckId, 'deckId')
  if (r.schemaVersion !== '1.0') {
    throw new TypeError(`DeckDocument: unsupported schemaVersion "${r.schemaVersion}"`)
  }
  assertString(r.title, 'title')
  assertArray(r.slides, 'slides')
  assertObject(r.source, 'source')

  const source = r.source as Record<string, unknown>
  const VALID_SOURCE_TYPES = new Set(['generated', 'manuscript', 'prompt', 'imported_pptx'])
  if (!VALID_SOURCE_TYPES.has(String(source.type))) {
    throw new TypeError(`DeckDocument: invalid source.type "${source.type}"`)
  }
  if (r.status !== 'partial' && r.status !== 'completed') {
    throw new TypeError(`DeckDocument: invalid status "${r.status}"`)
  }
  const lang = String(r.language ?? 'zh')
  if (lang !== 'zh' && lang !== 'en') {
    throw new TypeError(`DeckDocument: invalid language "${lang}"`)
  }

  // Validate imageMode if present
  let imageMode: ImageMode | undefined
  if (r.imageMode != null) {
    const im = String(r.imageMode)
    if (!VALID_IMAGE_MODES.has(im as ImageMode)) {
      throw new TypeError(`DeckDocument: invalid imageMode "${im}"`)
    }
    imageMode = im as ImageMode
  }

  return {
    deckId: r.deckId as string,
    schemaVersion: '1.0',
    title: r.title as string,
    subtitle: r.subtitle != null ? String(r.subtitle) : undefined,
    scenario: r.scenario != null ? String(r.scenario) : undefined,
    language: lang as 'zh' | 'en',
    sections: Array.isArray(r.sections) ? (r.sections as unknown[]).map(String) : undefined,
    imageMode,
    slides: (r.slides as unknown[]).map(validateSlide),
    assets: Array.isArray(r.assets)
      ? (r.assets as unknown[]).map((a, ai) => {
        assertObject(a, `assets[${ai}]`)
        const aa = a as Record<string, unknown>
        return {
          assetId: String(aa.assetId ?? `asset-${ai}`),
          type: aa.type != null ? String(aa.type) as DeckAssetType : undefined,
          source: aa.source != null ? String(aa.source) as DeckAssetSource : undefined,
          path: aa.path != null ? String(aa.path) : aa.imagePath != null ? String(aa.imagePath) : undefined,
          purpose: aa.purpose != null ? String(aa.purpose) as DeckAssetPurpose : undefined,
          targetSlideId: aa.targetSlideId != null ? String(aa.targetSlideId) : undefined,
          targetTextBlockIds: Array.isArray(aa.targetTextBlockIds)
            ? (aa.targetTextBlockIds as unknown[]).map(String)
            : undefined,
          caption: aa.caption != null ? String(aa.caption) : undefined,
          semanticTags: Array.isArray(aa.semanticTags) ? (aa.semanticTags as unknown[]).map(String) : undefined,
          // backward compat
          imagePath: aa.imagePath != null ? String(aa.imagePath) : aa.path != null ? String(aa.path) : undefined,
          slideIndex: aa.slideIndex != null ? Number(aa.slideIndex) : undefined,
        } satisfies DeckAsset
      })
      : [],
    sourcePrompt: r.sourcePrompt != null ? String(r.sourcePrompt) : undefined,
    source: {
      type: source.type as DeckDocument['source']['type'],
      sourcePath: source.sourcePath != null ? String(source.sourcePath) : undefined,
      manuscriptId: source.manuscriptId != null ? String(source.manuscriptId) : undefined,
      emailAttachment: normalizeEmailAttachmentRef(source.emailAttachment),
    },
    sourceRefs: Array.isArray(r.sourceRefs)
      ? (r.sourceRefs as unknown[]).map((ref, ri) => {
          assertObject(ref, `sourceRefs[${ri}]`)
          const rr = ref as Record<string, unknown>
          return {
            sourceId: String(rr.sourceId ?? ''),
            sourceType: String(rr.sourceType ?? 'manuscript') as DeckSourceRef['sourceType'],
            excerpt: rr.excerpt != null ? String(rr.excerpt) : undefined,
            slideIndex: rr.slideIndex != null ? Number(rr.slideIndex) : undefined,
            confidence: rr.confidence != null ? Number(rr.confidence) : undefined,
            emailAttachment: normalizeEmailAttachmentRef(rr.emailAttachment),
          } satisfies DeckSourceRef
        })
      : undefined,
    status: r.status as 'partial' | 'completed',
    expectedSlideCount: Number(r.expectedSlideCount ?? (r.slides as unknown[]).length),
    completedSlideCount: Number(r.completedSlideCount ?? (r.slides as unknown[]).length),
    createdAt: r.createdAt != null ? String(r.createdAt) : new Date().toISOString(),
    updatedAt: r.updatedAt != null ? String(r.updatedAt) : new Date().toISOString(),
  }
}
