/**
 * SlotBinder — maps DeckSlide fields to layout slots, producing a BindingPlan.
 *
 * No LLM. No image generation. Pure structural mapping.
 *
 * Each DeckSlide (after ContentPaginator) is paired with its chosen TemplateLayout,
 * and the relevant text / image values are pulled into BoundSlotValues.
 * Images are resolved by assetId from the DeckAsset pool; any assets that cannot
 * be placed are tracked in unplacedAssets for caller logging.
 *
 * Adaptation actions are recorded in BoundSlide.adaptation for traceability.
 *
 * Content-layer selection is style-aware:
 *   'academic'  → body > summary; keyTakeaways as bullets; speakerNotes for notes
 *   'business'  → items > keyTakeaways > split body; keywords for keyword slots
 *   'aesthetic' → oneLiner > summary > short body; keywords as accents; visualBrief
 */

import type { DeckSlide, DeckAsset } from '../../../../types/deckDocument'
import type { TemplateLayout, TemplateProfile } from '../../../../types/pptTemplateManifest'
import type { LayoutMatchResult } from './layoutMatcher'
import type {
  BindingPlan,
  BoundSlide,
  BoundSlotValues,
  UnplacedAsset,
  AdaptationRecord,
} from '../../../../types/pptBindingPlan'

type ContentStyle = 'academic' | 'business' | 'aesthetic' | undefined

/** Resolve the best imagePath for a slide from the DeckAsset pool. */
function resolveImagePath(slide: DeckSlide, assets: DeckAsset[]): { imagePath: string | undefined; assetId: string | undefined } {
  // Prefer assetRefs-based lookup (Phase 3 path)
  if (slide.assetRefs && slide.assetRefs.length > 0) {
    for (const ref of slide.assetRefs) {
      const asset = assets.find((a) => a.assetId === ref)
      if (asset) {
        const path = asset.path ?? asset.imagePath
        return { imagePath: path, assetId: asset.assetId }
      }
    }
  }

  // Fallback: try to find asset by targetSlideId
  if (slide.id) {
    const asset = assets.find((a) => a.targetSlideId === slide.id)
    if (asset) {
      const path = asset.path ?? asset.imagePath
      return { imagePath: path, assetId: asset.assetId }
    }
  }

  // Legacy fallback: use slide.imagePath directly
  return { imagePath: slide.imagePath ?? undefined, assetId: undefined }
}

/**
 * Determine if body text should be converted to bullets based on template profile.
 * Only applies when profile.longTextFallback = 'split_to_bullets'.
 */
function convertBodyToBullets(body: string): string[] {
  // Split on Chinese sentence delimiters or newlines
  const parts = body.split(/[。！？\n]+/).map((s) => s.trim()).filter(Boolean)
  return parts.length > 1 ? parts : [body]
}

// ---------------------------------------------------------------------------
// Style-aware content resolvers
// ---------------------------------------------------------------------------

/**
 * Select the best body text for the given slide and template content style.
 * Academic: long body preferred. Business: shorter summary preferred. Aesthetic: oneLiner/summary only.
 */
function resolveBody(slide: DeckSlide, style: ContentStyle): string | undefined {
  const body = slide.body ?? ''
  const summary = slide.summary ?? ''

  if (style === 'aesthetic') {
    // Aesthetic templates prefer brevity — use summary or oneLiner, not long body
    return summary || slide.oneLiner || (body ? body.slice(0, 120) : undefined)
  }
  if (style === 'academic') {
    // Academic templates prefer full body text
    return body || summary
  }
  // Business / default
  return summary || body || undefined
}

/**
 * Select the best items list for the given slide and template content style.
 * Business: items or keyTakeaways; Academic: keyTakeaways or items; Aesthetic: keywords or short items.
 */
function resolveItems(slide: DeckSlide, style: ContentStyle): string[] | undefined {
  const items = slide.items ?? []
  const keyTakeaways = slide.keyTakeaways ?? []
  const keywords = slide.keywords ?? []

  if (style === 'aesthetic') {
    // Aesthetic prefer short keywords as items; fall back to shortened items
    if (keywords.length > 0) return keywords
    if (items.length > 0) return items.map(s => s.slice(0, 20))
    return keyTakeaways.length > 0 ? keyTakeaways.map(s => s.slice(0, 20)) : undefined
  }
  if (style === 'academic') {
    // Academic prefer items, then keyTakeaways as bullet equivalents
    if (items.length > 0) return items
    return keyTakeaways.length > 0 ? keyTakeaways : undefined
  }
  // Business: items first, then keyTakeaways
  if (items.length > 0) return items
  return keyTakeaways.length > 0 ? keyTakeaways : undefined
}

/**
 * Select the best heading text, respecting aesthetic templates that prefer oneLiner.
 */
function resolveHeading(slide: DeckSlide, style: ContentStyle): string | undefined {
  if (style === 'aesthetic') {
    // For section_divider and cover, aesthetic templates prefer oneLiner as the sub-heading
    if ((slide.intent === 'section_divider' || slide.intent === 'cover') && slide.oneLiner) {
      return slide.oneLiner
    }
  }
  return slide.heading ?? slide.title
}

/** Extract slot values from a paginated DeckSlide for the given layout. */
function extractSlotValues(
  slide: DeckSlide,
  layout: TemplateLayout,
  assets: DeckAsset[],
  profile?: TemplateProfile,
): { slots: BoundSlotValues; adaptation: AdaptationRecord } {
  const style: ContentStyle = profile?.contentStyle
  const slotRoles = new Set(layout.slots.map((s) => s.role))
  const values: BoundSlotValues = {}
  let adaptation: AdaptationRecord = { action: 'direct_bind', reason: 'Content fits layout directly' }

  if (slotRoles.has('title')) values.title = slide.title
  if (slotRoles.has('subtitle')) values.subtitle = slide.subtitle
  if (slotRoles.has('heading')) values.heading = resolveHeading(slide, style)

  if (slotRoles.has('body')) {
    const { bodyMaxChars } = layout.capacity
    const selectedBody = resolveBody(slide, style) ?? ''

    if (
      selectedBody &&
      bodyMaxChars > 0 &&
      selectedBody.length > bodyMaxChars &&
      profile?.longTextFallback === 'split_to_bullets' &&
      slotRoles.has('items') &&
      !slide.items?.length
    ) {
      // Convert long body to bullets
      const bullets = convertBodyToBullets(selectedBody)
      values.body = undefined
      values.items = bullets
      adaptation = {
        action: 'convert_text_to_bullets',
        reason: `Body (${selectedBody.length} chars) exceeds layout capacity (${bodyMaxChars}); converted to ${bullets.length} bullets`,
        slot: 'body',
      }
    } else {
      values.body = selectedBody || undefined
      if (selectedBody.length > bodyMaxChars && bodyMaxChars > 0) {
        adaptation = {
          action: 'split_text',
          reason: `Body (${selectedBody.length} chars) exceeds capacity (${bodyMaxChars}); split by ContentPaginator`,
          slot: 'body',
          detail: `Page is a ${slide.heading?.endsWith('(续)') ? 'continuation' : 'first'} page`,
        }
      }
    }
  }

  if (slotRoles.has('items')) {
    const { itemMax } = layout.capacity
    if (!values.items) { // not already set by body→bullets conversion
      const selectedItems = resolveItems(slide, style) ?? []
      values.items = selectedItems
      if (itemMax > 0 && selectedItems.length > itemMax) {
        adaptation = {
          action: 'split_cards',
          reason: `${selectedItems.length} items exceed layout max (${itemMax}); split by ContentPaginator`,
          slot: 'items',
        }
      }
    }
  }

  if (slotRoles.has('left_title')) values.leftTitle = slide.leftTitle
  if (slotRoles.has('left_items')) values.leftItems = slide.leftItems
  if (slotRoles.has('right_title')) values.rightTitle = slide.rightTitle
  if (slotRoles.has('right_items')) values.rightItems = slide.rightItems
  if (slotRoles.has('metrics')) values.metrics = slide.metrics
  if (slotRoles.has('timeline')) values.timeline = slide.timeline

  if (slotRoles.has('image')) {
    const { imagePath, assetId } = resolveImagePath(slide, assets)
    if (imagePath) {
      values.imagePath = imagePath
      if (assetId) values.assetId = assetId
    } else if (slide.visualDemand === 'required') {
      // Image required but not available
      values.imagePath = null
      adaptation = {
        action: 'text_only_fallback',
        reason: 'Image required by slide but no asset found; using text-only rendering',
        slot: 'image',
      }
    }
  } else if (resolveImagePath(slide, assets).imagePath) {
    // Layout has no image slot but slide has an image — will be tracked as unplaced
  }

  // notes slot: prefer speakerNotes (academic), fall back to notes alias
  if (slotRoles.has('notes')) {
    values.notes = slide.speakerNotes ?? slide.notes
  }

  return { slots: values, adaptation }
}

/**
 * Binds paginated slides to their matched layouts.
 *
 * @param paginatedSlides  Flat list of DeckSlides after ContentPaginator
 * @param matchResults     One LayoutMatchResult per original (pre-pagination) slide
 * @param manifestId       The manifest being applied (stored in plan for traceability)
 * @param assets           All DeckAssets from the DeckDocument (for assetId lookup)
 * @param deckId           Optional deck ID for traceability
 * @param profile          Template profile (for adaptation decisions)
 */
export function bindSlots(
  paginatedSlides: DeckSlide[],
  matchResults: LayoutMatchResult[],
  manifestId: string,
  assets: DeckAsset[] = [],
  deckId?: string,
  profile?: TemplateProfile,
): BindingPlan {
  // Build a lookup from original slide index → match result
  const matchByOriginalIndex = new Map<number, LayoutMatchResult>()
  matchResults.forEach((m, i) => {
    matchByOriginalIndex.set(i, m)
  })

  // Track which assetIds were actually placed
  const placedAssetIds = new Set<string>()

  const boundSlides: BoundSlide[] = paginatedSlides.map((slide, outputIndex) => {
    const directMatch = matchByOriginalIndex.get(slide.index)
    const match = directMatch ?? matchResults[0]

    const isContinuation = (slide.heading?.endsWith(' (续)')) ?? false
    const { slots, adaptation } = extractSlotValues(slide, match.layout, assets, profile)

    // Track placed assets
    if (slots.assetId) placedAssetIds.add(slots.assetId)

    return {
      outputIndex,
      sourceSlide: slide,
      sourceSlideIds: slide.id ? [slide.id] : undefined,
      layout: match.layout,
      matchScore: match.score,
      slots,
      adaptation,
      isContinuation,
    }
  })

  // Identify assets that were never placed in any slide
  const unplacedAssets: UnplacedAsset[] = assets
    .filter((a) => !placedAssetIds.has(a.assetId))
    .map((a) => ({
      assetId: a.assetId,
      reason: 'No matching image slot found in any layout for this asset',
      suggestion: (profile?.extraImageFallback === 'unplaced_assets'
        ? 'ignore'
        : 'add_image_page') as UnplacedAsset['suggestion'],
    }))

  // Collect warnings
  const warnings: string[] = []
  for (const bs of boundSlides) {
    if (bs.adaptation.action !== 'direct_bind') {
      warnings.push(`[slide ${bs.outputIndex}] ${bs.adaptation.action}: ${bs.adaptation.reason}`)
    }
  }
  for (const ua of unplacedAssets) {
    warnings.push(`[asset ${ua.assetId}] unplaced: ${ua.reason}`)
  }

  return {
    deckId,
    templateSkillId: manifestId,
    manifestId,
    boundSlides,
    unplacedAssets: unplacedAssets.length > 0 ? unplacedAssets : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  }
}

