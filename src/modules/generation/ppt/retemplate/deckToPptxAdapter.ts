/**
 * DeckToPptxAdapter — converts a BindingPlan into PptxSlideDefinition[].
 *
 * This is the bridge between the new DeckDocument architecture and the existing
 * pptxGenerator.ts. It does NOT call generatePptx — it only converts the data.
 *
 * Intent → PptxSlideDefinition.type mapping:
 *   cover           → 'cover'
 *   toc             → 'toc'
 *   section_divider → 'section'
 *   text_content    → 'content'
 *   content_cards   → 'content'
 *   image_text      → 'content'
 *   closing         → 'summary'
 *   unknown         → 'content'  (safe fallback)
 */

import type { DeckSlideIntent } from '../../../../types/deckDocument'
import type { BindingPlan } from '../../../../types/pptBindingPlan'
import type { PptxSlideDefinition } from '../../../../../electron/main/services/pptxGenerator'

type PptxSlideType = PptxSlideDefinition['type']

const INTENT_TO_TYPE: Record<DeckSlideIntent, PptxSlideType> = {
  cover: 'cover',
  toc: 'toc',
  section_divider: 'section',
  text_content: 'content',
  content_cards: 'content',
  image_text: 'content',
  closing: 'summary',
  unknown: 'content',
}

/**
 * Converts a BindingPlan to a PptxSlideDefinition array suitable for pptxGenerator.ts.
 */
export function adaptToPptxSlides(plan: BindingPlan): PptxSlideDefinition[] {
  return plan.boundSlides.map(({ sourceSlide, slots, layout: _layout }) => {
    const intent = sourceSlide.intent
    const type = INTENT_TO_TYPE[intent] ?? 'content'

    const def: PptxSlideDefinition = { type }

    // Map slot values to PptxSlideDefinition fields
    if (slots.title != null) def.title = slots.title
    if (slots.subtitle != null) def.subtitle = slots.subtitle
    if (slots.heading != null) def.heading = slots.heading
    if (slots.body != null) def.body = slots.body
    if (slots.items != null) def.items = slots.items
    if (slots.leftTitle != null) def.leftTitle = slots.leftTitle
    if (slots.leftItems != null) def.leftItems = slots.leftItems
    if (slots.rightTitle != null) def.rightTitle = slots.rightTitle
    if (slots.rightItems != null) def.rightItems = slots.rightItems
    if (slots.metrics != null) def.metrics = slots.metrics
    if (slots.timeline != null) def.timeline = slots.timeline
    if (slots.imagePath != null) def.imagePath = slots.imagePath
    if (slots.notes != null) def.notes = slots.notes

    // For TOC slides the items should be the section/chapter names
    // (already mapped above via slots.items)

    return def
  })
}
