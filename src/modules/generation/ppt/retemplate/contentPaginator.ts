/**
 * ContentPaginator — splits a DeckSlide that exceeds a layout's capacity
 * into multiple smaller slides (continuation pages).
 *
 * Profile-aware behavior:
 *  - textCapacity low   : Always split body at bodyMaxChars boundary.
 *  - textCapacity high  : Allow body to stay long; only split if severely over (2x limit).
 *  - cardCapacity high  : Split items at itemMax per page.
 *  - extraImageFallback = 'figure_page' | 'image_page': Insert a new image-only slide for extra images.
 *  - extraImageFallback = 'unplaced_assets': Move excess to BindingPlan.unplacedAssets (handled in SlotBinder).
 *
 * Rules:
 *  - If items.length > itemMax, split into pages of at most itemMax items.
 *  - If body is too long (and profile says split), truncate to bodyMaxChars on page 1; overflow → new slide.
 *  - Images always travel with the first page; continuations don't repeat the image.
 *  - Continuation slides share the same intent and get ' (续)' appended to their heading.
 */

import type { DeckSlide } from '../../../../types/deckDocument'
import type { TemplateLayout, TemplateProfile } from '../../../../types/pptTemplateManifest'
import type { LayoutMatchResult } from './layoutMatcher'

/** Truncate a string to at most maxChars, splitting at sentence boundary where possible */
function truncate(str: string, maxChars: number): { text: string; overflow: string } {
  if (str.length <= maxChars) return { text: str, overflow: '' }
  // Try to split at a Chinese sentence end or newline within the last 40% of maxChars
  const searchFrom = Math.floor(maxChars * 0.6)
  const cut = str.lastIndexOf('。', maxChars)
  const splitAt = cut >= searchFrom ? cut + 1 : maxChars
  return {
    text: str.slice(0, splitAt),
    overflow: str.slice(splitAt).trim(),
  }
}

/**
 * Whether to split body text given the template profile and body length.
 * Returns true if splitting is recommended.
 */
function shouldSplitBody(body: string, layout: TemplateLayout, profile?: TemplateProfile): boolean {
  const { bodyMaxChars } = layout.capacity
  if (bodyMaxChars <= 0) return false
  if (body.length <= bodyMaxChars) return false

  const fallback = profile?.longTextFallback ?? 'split_page'
  if (fallback === 'keep') {
    // Only split if body is more than 2× the capacity (prevent extreme overflow)
    return body.length > bodyMaxChars * 2
  }
  if (fallback === 'split_to_bullets') {
    // Let SlotBinder handle the conversion; paginator does not split
    return false
  }
  // 'split_page' or default
  return true
}

/**
 * Paginate a single DeckSlide against a chosen layout's capacity.
 * Returns an array of DeckSlide-shaped objects (index will be reassigned by SlotBinder).
 */
export function paginateSlide(
  slide: DeckSlide,
  layout: TemplateLayout,
  profile?: TemplateProfile,
): DeckSlide[] {
  const { itemMax } = layout.capacity
  const pages: DeckSlide[] = []

  // ── Item overflow ─────────────────────────────────────────────────────────
  const items = slide.items ?? []
  const overflowItems: string[] = []
  let firstPageItems = items

  if (itemMax > 0 && items.length > itemMax) {
    firstPageItems = items.slice(0, itemMax)
    overflowItems.push(...items.slice(itemMax))
  }

  // ── Body overflow ─────────────────────────────────────────────────────────
  let bodyFirstPage = slide.body ?? ''
  let bodyOverflow = ''

  if (bodyFirstPage && shouldSplitBody(bodyFirstPage, layout, profile)) {
    const { text, overflow } = truncate(bodyFirstPage, layout.capacity.bodyMaxChars)
    bodyFirstPage = text
    bodyOverflow = overflow
  }

  // First page always carries the image (assetRefs stays on first page)
  pages.push({
    ...slide,
    body: bodyFirstPage || undefined,
    items: firstPageItems.length > 0 ? firstPageItems : undefined,
  })

  // Build continuation pages for overflowed items
  let remaining = overflowItems
  while (remaining.length > 0) {
    const chunk = remaining.slice(0, itemMax > 0 ? itemMax : remaining.length)
    remaining = remaining.slice(chunk.length)
    pages.push({
      ...slide,
      heading: (slide.heading ?? slide.title ?? '') + ' (续)',
      body: undefined,
      items: chunk,
      // Continuations don't carry images — assets stay on first page
      imagePath: undefined,
      imageLoading: undefined,
      assetRefs: undefined,
    })
  }

  // Body overflow page (if any)
  if (bodyOverflow) {
    pages.push({
      ...slide,
      heading: (slide.heading ?? slide.title ?? '') + ' (续)',
      body: bodyOverflow,
      items: undefined,
      imagePath: undefined,
      imageLoading: undefined,
      assetRefs: undefined,
    })
  }

  return pages
}

/**
 * Paginate all slides in the deck, flattening continuations into a single ordered list.
 * The returned slides have fresh sequential indexes starting from 0.
 */
export function paginateAll(
  slides: DeckSlide[],
  layouts: TemplateLayout[],
  matchResults: LayoutMatchResult[],
  profile?: TemplateProfile,
): DeckSlide[] {
  const out: DeckSlide[] = []
  slides.forEach((slide, i) => {
    const layout = matchResults[i]?.layout ?? layouts[0]
    const pages = paginateSlide(slide, layout, profile)
    for (const page of pages) {
      out.push({ ...page, index: out.length })
    }
  })
  return out
}
