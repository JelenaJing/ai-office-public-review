/**
 * chinese_season_light — Warm red-gold Chinese-style template manifest + brand template.
 *
 * Visual: Warm crimson (#8B1A1A) primary, gold (#C9A227) accent, warm cream background.
 * Use case: Chinese-style presentations, cultural events, traditional industry reports.
 *
 * Template profile: low text capacity, high image capacity, always split long text.
 *
 * Call initChineseSeasonLight(sourceTemplatePath) once at app startup.
 */

import {
  registerTemplateManifest,
  type PptTemplateManifest,
} from '../../../../../src/types/pptTemplateManifest'
import {
  registerSkillTemplate,
  type SkillTemplateDef,
} from '../../pptTemplateRegistry'

export const CHINESE_SEASON_LIGHT_ID = 'chinese_season_light'

const MANIFEST: PptTemplateManifest = {
  manifestId: CHINESE_SEASON_LIGHT_ID,
  name: '国风雅致（浅色）',
  description: '暖红金配色，适合传统文化展示、国风活动、中式行业报告等场景。',
  previewColor: '8B1A1A',
  version: '1.0',
  templateProfile: {
    textCapacity: 'low',
    imageCapacity: 'high',
    cardCapacity: 'low',
    preferredLayouts: ['image_heavy', 'quote'],
    longTextFallback: 'split_page',
    missingImageFallback: 'use_template_decoration',
    extraImageFallback: 'image_page',
    contentStyle: 'aesthetic',
  },
  layouts: [
    {
      layoutId: 'csl_cover',
      intent: 'cover',
      layoutKind: 'cover',
      sourceSlideIndex: 1,
      supports: { image: false, longText: false, cards: false, metrics: false, chart: false },
      capacity: {
        titleMaxChars: 25,
        bodyMaxChars: 0,
        itemMin: 0,
        itemMax: 0,
        bodyMaxCharsPerItem: 0,
        imageSlots: 0,
      },
      slots: [
        {
          slotId: 'cover_text',
          role: 'title',
          required: true,
          maxChars: 25,
          locator: { shapeId: '24', shapeName: '文本框 23' },
          contentPriority: ['oneLiner', 'title'],
          fitPolicy: 'short_phrase',
        },
      ],
    },
    {
      layoutId: 'csl_toc',
      intent: 'toc',
      layoutKind: 'section',
      sourceSlideIndex: 2,
      supports: { image: false, longText: false, cards: false, metrics: false, chart: false },
      capacity: {
        titleMaxChars: 20,
        bodyMaxChars: 0,
        itemMin: 1,
        itemMax: 4,
        bodyMaxCharsPerItem: 20,
        imageSlots: 0,
      },
      slots: [
        { slotId: 'toc_item_1', role: 'items', required: false, maxChars: 20, locator: { shapeId: '98', shapeName: '文本框 97' }, contentPriority: ['items[0]'], fitPolicy: 'short_phrase' },
        { slotId: 'toc_item_2', role: 'items', required: false, maxChars: 20, locator: { shapeId: '130', shapeName: '文本框 129' }, contentPriority: ['items[1]'], fitPolicy: 'short_phrase' },
        { slotId: 'toc_item_3', role: 'items', required: false, maxChars: 20, locator: { shapeId: '136', shapeName: '文本框 135' }, contentPriority: ['items[2]'], fitPolicy: 'short_phrase' },
        { slotId: 'toc_item_4', role: 'items', required: false, maxChars: 20, locator: { shapeId: '142', shapeName: '文本框 141' }, contentPriority: ['items[3]'], fitPolicy: 'short_phrase' },
      ],
    },
    {
      layoutId: 'csl_section',
      intent: 'section_divider',
      layoutKind: 'section',
      sourceSlideIndex: 3,
      alternativeIntents: ['unknown'],
      supports: { image: false, longText: false, cards: false, metrics: false, chart: false },
      capacity: {
        titleMaxChars: 12,
        bodyMaxChars: 120,
        itemMin: 0,
        itemMax: 0,
        bodyMaxCharsPerItem: 0,
        imageSlots: 0,
      },
      slots: [
        {
          slotId: 'section_heading',
          role: 'heading',
          required: true,
          maxChars: 12,
          locator: { shapeId: '98', shapeName: '文本框 97' },
          contentPriority: ['shortTitle', 'displayTitle', 'title', 'oneLiner'],
          fitPolicy: 'short_phrase',
        },
        {
          slotId: 'section_body',
          role: 'body',
          required: false,
          maxChars: 120,
          locator: { shapeId: '2', shapeName: '文本框 1' },
          contentPriority: ['summary', 'oneLiner'],
          fitPolicy: 'body_summary',
        },
      ],
    },
    {
      layoutId: 'csl_content_text',
      intent: 'text_content',
      layoutKind: 'text_heavy',
      sourceSlideIndex: 5,
      alternativeIntents: ['image_text', 'unknown'],
      supports: { image: false, longText: true, cards: false, metrics: false, chart: false },
      capacity: {
        titleMaxChars: 12,
        bodyMaxChars: 200,
        itemMin: 0,
        itemMax: 3,
        bodyMaxCharsPerItem: 55,
        imageSlots: 0,
      },
      supportsImage: false,
      maxTextBlocks: 3,
      slots: [
        {
          slotId: 'heading',
          role: 'heading',
          required: true,
          maxChars: 12,
          locator: { shapeId: '98', shapeName: '文本框 97' },
          contentPriority: ['shortTitle', 'displayTitle', 'title'],
          fitPolicy: 'short_phrase',
        },
        {
          slotId: 'body_left',
          role: 'body',
          required: false,
          maxChars: 200,
          locator: { shapeId: '37', shapeName: '文本框 36' },
          contentPriority: ['summary', 'oneLiner', 'body'],
          fitPolicy: 'body_summary',
        },
        {
          slotId: 'body_right',
          role: 'body2',
          required: false,
          maxChars: 150,
          locator: { shapeId: '49', shapeName: '文本框 48' },
          contentPriority: ['keywords', 'keyTakeaways', 'items'],
          fitPolicy: 'body_summary',
        },
        {
          slotId: 'subheading_left',
          role: 'subtitle',
          required: false,
          maxChars: 8,
          locator: { shapeId: '38', shapeName: '文本框 37' },
          contentPriority: ['keywords[0]'],
          fitPolicy: 'single_keyword',
        },
        {
          slotId: 'subheading_right',
          role: 'subtitle',
          required: false,
          maxChars: 8,
          locator: { shapeId: '50', shapeName: '文本框 49' },
          contentPriority: ['keywords[1]'],
          fitPolicy: 'single_keyword',
        },
      ],
    },
    {
      layoutId: 'csl_content_image',
      intent: 'image_text',
      layoutKind: 'image_heavy',
      sourceSlideIndex: 5,
      alternativeIntents: ['text_content', 'content_cards'],
      supports: { image: true, longText: false, cards: false, metrics: false, chart: false },
      capacity: {
        titleMaxChars: 12,
        bodyMaxChars: 120,
        itemMin: 0,
        itemMax: 4,
        bodyMaxCharsPerItem: 45,
        imageSlots: 1,
      },
      supportsImage: true,
      maxTextBlocks: 2,
      slots: [
        {
          slotId: 'heading',
          role: 'heading',
          required: true,
          maxChars: 12,
          locator: { shapeId: '98', shapeName: '文本框 97' },
          contentPriority: ['shortTitle', 'displayTitle', 'title'],
          fitPolicy: 'short_phrase',
        },
        {
          slotId: 'body_left',
          role: 'body',
          required: false,
          maxChars: 120,
          locator: { shapeId: '37', shapeName: '文本框 36' },
          contentPriority: ['summary', 'body'],
          fitPolicy: 'body_summary',
        },
        { slotId: 'image', role: 'image', required: false },
      ],
    },
    {
      layoutId: 'csl_content_cards',
      intent: 'content_cards',
      layoutKind: 'cards',
      sourceSlideIndex: 4,
      alternativeIntents: ['text_content'],
      supports: { image: false, longText: false, cards: true, metrics: false, chart: false },
      capacity: {
        titleMaxChars: 12,
        bodyMaxChars: 0,
        itemMin: 1,
        itemMax: 3,
        bodyMaxCharsPerItem: 20,
        imageSlots: 0,
      },
      supportsImage: false,
      maxTextBlocks: 2,
      slots: [
        {
          slotId: 'heading',
          role: 'heading',
          required: true,
          maxChars: 12,
          locator: { shapeId: '98', shapeName: '文本框 97' },
          contentPriority: ['shortTitle', 'displayTitle', 'title'],
          fitPolicy: 'short_phrase',
        },
        {
          slotId: 'card_title_1',
          role: 'items',
          required: false,
          maxChars: 14,
          locator: { shapeId: '20', shapeName: '文本框 19' },
          contentPriority: ['items[0]'],
          fitPolicy: 'short_phrase',
        },
        {
          slotId: 'card_title_2',
          role: 'items',
          required: false,
          maxChars: 14,
          locator: { shapeId: '23', shapeName: '文本框 22' },
          contentPriority: ['items[1]'],
          fitPolicy: 'short_phrase',
        },
        {
          slotId: 'card_title_3',
          role: 'items',
          required: false,
          maxChars: 14,
          locator: { shapeId: '26', shapeName: '文本框 25' },
          contentPriority: ['items[2]'],
          fitPolicy: 'short_phrase',
        },
        { slotId: 'card_body_1', role: 'body', required: false, maxChars: 0, locator: { shapeId: '19' }, fitPolicy: 'clear' },
        { slotId: 'card_body_2', role: 'body', required: false, maxChars: 0, locator: { shapeId: '22' }, fitPolicy: 'clear' },
        { slotId: 'card_body_3', role: 'body', required: false, maxChars: 0, locator: { shapeId: '25' }, fitPolicy: 'clear' },
      ],
    },
    {
      layoutId: 'csl_closing',
      intent: 'closing',
      layoutKind: 'closing',
      sourceSlideIndex: 19,
      alternativeIntents: ['unknown'],
      supports: { image: false, longText: false, cards: false, metrics: false, chart: false },
      capacity: {
        titleMaxChars: 25,
        bodyMaxChars: 0,
        itemMin: 0,
        itemMax: 0,
        bodyMaxCharsPerItem: 0,
        imageSlots: 0,
      },
      slots: [
        {
          slotId: 'closing_text',
          role: 'heading',
          required: true,
          maxChars: 25,
          locator: { shapeId: '24', shapeName: '文本框 23' },
          contentPriority: ['oneLiner', 'keyTakeaways[0]', 'title'],
          fitPolicy: 'short_phrase',
        },
      ],
    },
  ],
}

const BRAND_DEF: Omit<SkillTemplateDef, 'extracted_pptx_path'> = {
  skill_id: CHINESE_SEASON_LIGHT_ID,
  name: '国风雅致（浅色）',
  version: '1.0',
  enabled: true,
}

let _initialized = false

/**
 * Register chinese_season_light manifest and brand template.
 * Also registers under the canonical short ID 'chinese_season' as an alias.
 * @param sourceTemplatePath Absolute path to a .pptx source file for PptxGenJS master.
 */
export function initChineseSeasonLight(sourceTemplatePath: string): void {
  if (_initialized) return
  _initialized = true
  registerTemplateManifest(MANIFEST)
  // Alias: 'chinese_season' → same manifest and brand template
  registerTemplateManifest({ ...MANIFEST, manifestId: 'chinese_season', name: '中国风节气' })
  registerSkillTemplate({ ...BRAND_DEF, extracted_pptx_path: sourceTemplatePath })
  registerSkillTemplate({ ...BRAND_DEF, skill_id: 'chinese_season', name: '中国风节气', extracted_pptx_path: sourceTemplatePath })
}
