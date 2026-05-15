/**
 * LayoutMatcher — picks the best TemplateLayout for each DeckSlide.
 *
 * Pure rule-based scoring; never calls LLM.
 *
 * Scoring table:
 *   intent exact match                      +50
 *   intent in alternativeIntents            +25
 *   layoutKind matches slide.preferredLayout +20
 *   items count in [min, max]               +20
 *   slide has image & imageSlots >= 1       +15
 *   visualDemand matches imageCapacity      +10
 *   title fits in titleMaxChars             +10
 *   body fits in bodyMaxChars               +10
 *   contentDensity matches textCapacity     +10
 *   visualDemand='required' but no image slot -15 (penalty)
 *
 * The highest-scoring layout wins. Ties are broken by list order.
 */

import type { DeckSlide } from '../../../../types/deckDocument'
import type { TemplateLayout, TemplateProfile, LayoutKind } from '../../../../types/pptTemplateManifest'

export interface LayoutMatchResult {
  layout: TemplateLayout
  score: number
}

/** Map DeckSlide.preferredLayout to LayoutKind for comparison */
const PREFERRED_LAYOUT_TO_KIND: Record<NonNullable<DeckSlide['preferredLayout']>, LayoutKind> = {
  text_heavy: 'text_heavy',
  image_heavy: 'image_heavy',
  cards: 'cards',
  timeline: 'timeline',
  metrics: 'metrics',
  quote: 'quote',
}

/**
 * Returns true if this slide has any image content (assetRefs or imagePath).
 */
function slideHasImage(slide: DeckSlide): boolean {
  if (slide.assetRefs && slide.assetRefs.length > 0) return true
  if (slide.assetRequests && slide.assetRequests.length > 0) return true
  if (slide.imagePath) return true
  return false
}

/**
 * Scores a single layout against a slide.
 * Returns the numeric score (higher = better fit).
 */
function scoreLayout(
  slide: DeckSlide,
  layout: TemplateLayout,
  profile?: TemplateProfile,
): number {
  let score = 0

  // Intent matching
  if (layout.intent === slide.intent) {
    score += 50
  } else if (layout.alternativeIntents?.includes(slide.intent)) {
    score += 25
  }

  // layoutKind vs slide.preferredLayout
  if (slide.preferredLayout && layout.layoutKind) {
    const desiredKind = PREFERRED_LAYOUT_TO_KIND[slide.preferredLayout]
    if (layout.layoutKind === desiredKind) {
      score += 20
    }
  }

  // Item count
  const items = slide.items ?? []
  const { itemMin, itemMax } = layout.capacity
  if (items.length >= itemMin && items.length <= itemMax) {
    score += 20
  } else if (items.length > 0 && itemMax > 0) {
    score += 5
  }

  // Image slot match
  const hasImage = slideHasImage(slide)
  if (hasImage && layout.capacity.imageSlots >= 1) {
    score += 15
  } else if (!hasImage && layout.capacity.imageSlots === 0) {
    score += 5
  }

  // visualDemand vs imageCapacity (profile-aware)
  if (slide.visualDemand && profile) {
    const demand = slide.visualDemand
    const imgCap = profile.imageCapacity
    if (demand === 'required') {
      if (layout.capacity.imageSlots >= 1) {
        score += 10
      } else {
        score -= 15 // penalty: required image but no slot
      }
    } else if (demand === 'optional') {
      if (imgCap === 'high' && layout.capacity.imageSlots >= 1) score += 5
      else if (imgCap === 'low' && layout.capacity.imageSlots === 0) score += 5
    } else if (demand === 'none') {
      if (layout.capacity.imageSlots === 0) score += 5
    }
  } else if (slide.visualDemand === 'required' && layout.capacity.imageSlots === 0) {
    score -= 15 // penalty even without profile
  }

  // Title length
  const titleLen = (slide.heading ?? slide.title ?? '').length
  if (titleLen <= layout.capacity.titleMaxChars) {
    score += 10
  }

  // Body length
  const bodyLen = (slide.body ?? '').length
  if (bodyLen <= layout.capacity.bodyMaxChars) {
    score += 10
  }

  // contentDensity vs textCapacity (profile-aware)
  if (slide.contentDensity && profile) {
    const density = slide.contentDensity
    const textCap = profile.textCapacity
    if (density === 'high' && textCap === 'high') score += 10
    else if (density === 'medium' && textCap === 'medium') score += 10
    else if (density === 'low' && textCap === 'low') score += 10
    else if (density === 'high' && textCap === 'low') score -= 5
    else if (density === 'low' && textCap === 'high') score += 3
  }

  // Template-level preferredLayouts bonus
  if (profile?.preferredLayouts && layout.layoutKind) {
    if (profile.preferredLayouts.includes(layout.layoutKind)) {
      score += 5
    }
  }

  return score
}

/**
 * Finds the best-matching layout for the given slide from the provided layouts.
 * Falls back to the last layout in the list if nothing scores > 0.
 */
export function matchLayout(
  slide: DeckSlide,
  layouts: TemplateLayout[],
  profile?: TemplateProfile,
): LayoutMatchResult {
  if (layouts.length === 0) {
    throw new Error('LayoutMatcher: layouts array is empty')
  }

  let best: LayoutMatchResult = { layout: layouts[0], score: -Infinity }

  for (const layout of layouts) {
    const s = scoreLayout(slide, layout, profile)
    if (s > best.score) {
      best = { layout, score: s }
    }
  }

  return best
}

/**
 * Batch-match all slides in a deck against the provided layouts.
 * Returns one LayoutMatchResult per slide, in slide order.
 */
export function matchLayouts(
  slides: DeckSlide[],
  layouts: TemplateLayout[],
  profile?: TemplateProfile,
): LayoutMatchResult[] {
  return slides.map((slide) => matchLayout(slide, layouts, profile))
}
