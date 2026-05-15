/**
 * business_report_light — Corporate deep-blue template manifest + brand template.
 *
 * Visual: Deep navy (#1F3864) primary, gold accent, light gray body.
 * Use case: Corporate reports, executive summaries, annual reviews.
 *
 * Call initBusinessReportLight(sourceTemplatePath) once at app startup.
 */

import {
  registerTemplateManifest,
  type PptTemplateManifest,
} from '../../../../../src/types/pptTemplateManifest'
import {
  registerSkillTemplate,
  type SkillTemplateDef,
} from '../../pptTemplateRegistry'

export const BUSINESS_REPORT_LIGHT_ID = 'business_report_light'

const MANIFEST: PptTemplateManifest = {
  manifestId: BUSINESS_REPORT_LIGHT_ID,
  name: '商务报告（浅色）',
  description: '深蓝主色调，适合企业年报、商业提案、执行摘要等正式商务场景。',
  previewColor: '1F3864',
  version: '1.0',
  templateProfile: {
    textCapacity: 'medium',
    imageCapacity: 'medium',
    cardCapacity: 'high',
    preferredLayouts: ['cards', 'metrics'],
    longTextFallback: 'split_to_bullets',
    missingImageFallback: 'text_only',
    extraImageFallback: 'unplaced_assets',
    contentStyle: 'business',
  },
  layouts: [
    {
      layoutId: 'brl_cover',
      intent: 'cover',
      layoutKind: 'cover',
      sourceSlideIndex: 1,
      supports: { image: false, longText: false, cards: false, metrics: false, chart: false },
      capacity: {
        titleMaxChars: 30,
        bodyMaxChars: 60,
        itemMin: 0,
        itemMax: 0,
        bodyMaxCharsPerItem: 0,
        imageSlots: 0,
      },
      slots: [
        {
          slotId: 'cover_title',
          role: 'title',
          required: true,
          maxChars: 14,
          locator: { shapeId: '52', shapeName: '文本框 51' },
          contentPriority: ['displayTitle', 'shortTitle', 'title'],
          fitPolicy: 'truncate',
        },
        {
          slotId: 'cover_subtitle',
          role: 'subtitle',
          required: false,
          maxChars: 60,
          locator: { shapeId: '142', shapeName: '文本框 141' },
          contentPriority: ['subtitle', 'summary'],
          fitPolicy: 'truncate',
        },
        // Category bar "工作汇报 / 工作总结 / 述职报告..." — replace with subtitle or clear
        {
          slotId: 'cover_category_bar',
          role: 'subtitle',
          required: false,
          maxChars: 25,
          locator: { shapeId: '150', shapeName: '文本框 149' },
          contentPriority: ['subtitle', 'oneLiner'],
          fitPolicy: 'truncate',
        },
        // Date field — always clear (no date in DeckDocument)
        { slotId: 'cover_date', role: 'notes', required: false, maxChars: 0, locator: { shapeId: '146', shapeName: '文本框 145' }, fitPolicy: 'clear' },
        // decorative shape — always clear 51PPT watermark
        { slotId: 'watermark', role: 'notes', required: false, maxChars: 0, locator: { shapeId: '144' }, fitPolicy: 'clear' },
      ],
    },
    {
      layoutId: 'brl_toc',
      intent: 'toc',
      layoutKind: 'section',
      sourceSlideIndex: 2,
      supports: { image: false, longText: false, cards: false, metrics: false, chart: false },
      capacity: {
        titleMaxChars: 25,
        bodyMaxChars: 0,
        itemMin: 1,
        itemMax: 4,
        bodyMaxCharsPerItem: 25,
        imageSlots: 0,
      },
      slots: [
        { slotId: 'toc_item_1', role: 'items', required: false, maxChars: 25, locator: { shapeId: '45', shapeName: '文本框 44' }, contentPriority: ['items[0]'], fitPolicy: 'truncate' },
        { slotId: 'toc_item_2', role: 'items', required: false, maxChars: 25, locator: { shapeId: '156', shapeName: '文本框 155' }, contentPriority: ['items[1]'], fitPolicy: 'truncate' },
        { slotId: 'toc_item_3', role: 'items', required: false, maxChars: 25, locator: { shapeId: '168', shapeName: '文本框 167' }, contentPriority: ['items[2]'], fitPolicy: 'truncate' },
        { slotId: 'toc_item_4', role: 'items', required: false, maxChars: 25, locator: { shapeId: '164', shapeName: '文本框 163' }, contentPriority: ['items[3]'], fitPolicy: 'truncate' },
      ],
    },
    {
      layoutId: 'brl_section',
      intent: 'section_divider',
      layoutKind: 'section',
      sourceSlideIndex: 3,
      alternativeIntents: ['unknown'],
      supports: { image: false, longText: false, cards: false, metrics: false, chart: false },
      capacity: {
        titleMaxChars: 25,
        bodyMaxChars: 100,
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
          maxChars: 25,
          locator: { shapeId: '45', shapeName: '文本框 44' },
          contentPriority: ['displayTitle', 'shortTitle', 'title'],
          fitPolicy: 'truncate',
        },
        {
          slotId: 'section_body',
          role: 'body',
          required: false,
          maxChars: 100,
          locator: { shapeId: '2', shapeName: '文本框 1' },
          contentPriority: ['summary', 'oneLiner'],
          fitPolicy: 'body_summary',
        },
      ],
    },
    {
      layoutId: 'brl_content_text',
      intent: 'text_content',
      layoutKind: 'cards',
      sourceSlideIndex: 4,
      alternativeIntents: ['content_cards', 'unknown'],
      supports: { image: false, longText: true, cards: true, metrics: false, chart: false },
      capacity: {
        titleMaxChars: 25,
        bodyMaxChars: 200,
        itemMin: 0,
        itemMax: 2,
        bodyMaxCharsPerItem: 60,
        imageSlots: 0,
      },
      supportsImage: false,
      maxTextBlocks: 3,
      slots: [
        {
          slotId: 'heading',
          role: 'heading',
          required: true,
          maxChars: 25,
          locator: { shapeId: '45', shapeName: '文本框 44' },
          contentPriority: ['displayTitle', 'shortTitle', 'title'],
          fitPolicy: 'truncate',
        },
        {
          slotId: 'card_title_1',
          role: 'items',
          required: false,
          maxChars: 14,
          locator: { shapeId: '5', shapeName: '文本框 4' },
          contentPriority: ['items[0]'],
          fitPolicy: 'short_phrase',
        },
        {
          slotId: 'card_title_2',
          role: 'items',
          required: false,
          maxChars: 14,
          locator: { shapeId: '9', shapeName: '文本框 8' },
          contentPriority: ['items[1]'],
          fitPolicy: 'short_phrase',
        },
        { slotId: 'card_body_1', role: 'body', required: false, maxChars: 40, locator: { shapeId: '4' }, contentPriority: ['keyTakeaways[0]'], fitPolicy: 'truncate' },
        { slotId: 'card_body_2', role: 'body', required: false, maxChars: 40, locator: { shapeId: '8' }, contentPriority: ['keyTakeaways[1]'], fitPolicy: 'truncate' },
        {
          slotId: 'main_body',
          role: 'body',
          required: false,
          maxChars: 200,
          locator: { shapeId: '10', shapeName: '文本框 9' },
          contentPriority: ['body', 'summary'],
          fitPolicy: 'body_summary',
        },
      ],
    },
    {
      layoutId: 'brl_content_image',
      intent: 'image_text',
      layoutKind: 'image_heavy',
      sourceSlideIndex: 4,
      alternativeIntents: ['text_content', 'content_cards'],
      supports: { image: true, longText: false, cards: true, metrics: false, chart: false },
      capacity: {
        titleMaxChars: 25,
        bodyMaxChars: 150,
        itemMin: 0,
        itemMax: 2,
        bodyMaxCharsPerItem: 50,
        imageSlots: 1,
      },
      supportsImage: true,
      maxTextBlocks: 2,
      slots: [
        {
          slotId: 'heading',
          role: 'heading',
          required: true,
          maxChars: 25,
          locator: { shapeId: '45', shapeName: '文本框 44' },
          contentPriority: ['displayTitle', 'shortTitle', 'title'],
          fitPolicy: 'truncate',
        },
        {
          slotId: 'main_body',
          role: 'body',
          required: false,
          maxChars: 150,
          locator: { shapeId: '10', shapeName: '文本框 9' },
          contentPriority: ['summary', 'body'],
          fitPolicy: 'body_summary',
        },
        { slotId: 'image', role: 'image', required: false },
      ],
    },
    {
      layoutId: 'brl_closing',
      intent: 'closing',
      layoutKind: 'closing',
      sourceSlideIndex: 23,
      alternativeIntents: ['unknown'],
      supports: { image: false, longText: false, cards: false, metrics: false, chart: false },
      capacity: {
        titleMaxChars: 15,
        bodyMaxChars: 80,
        itemMin: 0,
        itemMax: 0,
        bodyMaxCharsPerItem: 0,
        imageSlots: 0,
      },
      slots: [
        {
          slotId: 'closing_title',
          role: 'heading',
          required: true,
          maxChars: 15,
          locator: { shapeId: '52', shapeName: '文本框 51' },
          contentPriority: ['oneLiner', 'title'],
          fitPolicy: 'short_phrase',
        },
        {
          slotId: 'closing_body',
          role: 'body',
          required: false,
          maxChars: 80,
          locator: { shapeId: '142', shapeName: '文本框 141' },
          contentPriority: ['summary', 'keyTakeaways'],
          fitPolicy: 'truncate',
        },
        { slotId: 'closing_watermark', role: 'notes', required: false, maxChars: 0, locator: { shapeId: '144' }, fitPolicy: 'clear' },
        // Category bar and date — always clear on closing slide
        { slotId: 'closing_category_bar', role: 'notes', required: false, maxChars: 0, locator: { shapeId: '150', shapeName: '文本框 149' }, fitPolicy: 'clear' },
        { slotId: 'closing_date', role: 'notes', required: false, maxChars: 0, locator: { shapeId: '146', shapeName: '文本框 145' }, fitPolicy: 'clear' },
      ],
    },
  ],
}

const BRAND_DEF: Omit<SkillTemplateDef, 'extracted_pptx_path'> = {
  skill_id: BUSINESS_REPORT_LIGHT_ID,
  name: '商务报告（浅色）',
  version: '1.0',
  enabled: true,
}

let _initialized = false

/**
 * Register business_report_light manifest and brand template.
 * Also registers under the canonical short ID 'business_report' as an alias.
 * @param sourceTemplatePath Absolute path to a .pptx source file for PptxGenJS master.
 */
export function initBusinessReportLight(sourceTemplatePath: string): void {
  if (_initialized) return
  _initialized = true
  registerTemplateManifest(MANIFEST)
  // Alias: 'business_report' → same manifest and brand template
  registerTemplateManifest({ ...MANIFEST, manifestId: 'business_report', name: '商务汇报' })
  registerSkillTemplate({ ...BRAND_DEF, extracted_pptx_path: sourceTemplatePath })
  registerSkillTemplate({ ...BRAND_DEF, skill_id: 'business_report', name: '商务汇报', extracted_pptx_path: sourceTemplatePath })
}
