/**
 * academic_defense — Academic/thesis presentation template manifest + brand template.
 *
 * Visual: Dark slate (#2C3E50) primary, academic blue (#2980B9) accent, white clean background.
 * Use case: Academic defenses, thesis presentations, research reports, conference papers.
 *
 * Template profile: high text capacity (bodyMaxChars ~400), long text stays intact,
 * images go to dedicated figure pages, cards are medium capacity.
 *
 * Call initAcademicDefense(sourceTemplatePath) once at app startup.
 */

import {
  registerTemplateManifest,
  type PptTemplateManifest,
} from '../../../../../src/types/pptTemplateManifest'
import {
  registerSkillTemplate,
  type SkillTemplateDef,
} from '../../pptTemplateRegistry'

export const ACADEMIC_DEFENSE_ID = 'academic_defense'

const MANIFEST: PptTemplateManifest = {
  manifestId: ACADEMIC_DEFENSE_ID,
  name: '学术答辩',
  description: '深灰主色，适合毕业答辩、学术研究汇报、论文展示等严谨学术场景。',
  previewColor: '2C3E50',
  version: '1.0',
  templateProfile: {
    textCapacity: 'high',
    imageCapacity: 'medium',
    cardCapacity: 'medium',
    preferredLayouts: ['text_heavy', 'metrics'],
    longTextFallback: 'keep',
    missingImageFallback: 'text_only',
    extraImageFallback: 'figure_page',
    contentStyle: 'academic',
  },
  layouts: [
    {
      layoutId: 'ad_cover',
      intent: 'cover',
      layoutKind: 'cover',
      sourceSlideIndex: 1,
      supports: { image: false, longText: false, cards: false, metrics: false, chart: false },
      capacity: {
        titleMaxChars: 20,
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
          maxChars: 15,
          locator: { shapeId: '40', shapeName: '文本框 39' },
          contentPriority: ['displayTitle', 'shortTitle', 'title'],
          fitPolicy: 'truncate',
        },
        {
          slotId: 'cover_subtitle',
          role: 'subtitle',
          required: false,
          maxChars: 60,
          locator: { shapeId: '54', shapeName: '文本框 53' },
          contentPriority: ['subtitle', 'summary'],
          fitPolicy: 'truncate',
        },
        // Category bar "论文答辩 / 开题报告 / 学术汇报 / 毕业总结" — replace with subtitle or clear
        {
          slotId: 'cover_category_bar',
          role: 'subtitle',
          required: false,
          maxChars: 25,
          locator: { shapeId: '68', shapeName: '文本框 67' },
          contentPriority: ['subtitle', 'oneLiner'],
          fitPolicy: 'truncate',
        },
        // Date field — always clear
        { slotId: 'cover_date', role: 'notes', required: false, maxChars: 0, locator: { shapeId: '46', shapeName: '文本框 45' }, fitPolicy: 'clear' },
        { slotId: 'watermark1', role: 'notes', required: false, maxChars: 0, locator: { shapeId: '42' }, fitPolicy: 'clear' },
        { slotId: 'watermark2', role: 'notes', required: false, maxChars: 0, locator: { shapeId: '45' }, fitPolicy: 'clear' },
      ],
    },
    {
      layoutId: 'ad_toc',
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
        { slotId: 'toc_item_1', role: 'items', required: false, maxChars: 25, locator: { shapeId: '27', shapeName: '文本框 26' }, contentPriority: ['items[0]'], fitPolicy: 'truncate' },
        { slotId: 'toc_item_2', role: 'items', required: false, maxChars: 25, locator: { shapeId: '78', shapeName: '文本框 77' }, contentPriority: ['items[1]'], fitPolicy: 'truncate' },
        { slotId: 'toc_item_3', role: 'items', required: false, maxChars: 25, locator: { shapeId: '91', shapeName: '文本框 90' }, contentPriority: ['items[2]'], fitPolicy: 'truncate' },
        { slotId: 'toc_item_4', role: 'items', required: false, maxChars: 25, locator: { shapeId: '87', shapeName: '文本框 86' }, contentPriority: ['items[3]'], fitPolicy: 'truncate' },
      ],
    },
    {
      layoutId: 'ad_section',
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
          locator: { shapeId: '27', shapeName: '文本框 26' },
          contentPriority: ['displayTitle', 'shortTitle', 'title'],
          fitPolicy: 'truncate',
        },
        {
          slotId: 'section_body',
          role: 'body',
          required: false,
          maxChars: 100,
          locator: { shapeId: '3', shapeName: '文本框 2' },
          contentPriority: ['summary', 'oneLiner'],
          fitPolicy: 'body_summary',
        },
      ],
    },
    {
      layoutId: 'ad_content_text',
      intent: 'text_content',
      layoutKind: 'text_heavy',
      sourceSlideIndex: 4,
      alternativeIntents: ['content_cards', 'unknown'],
      supports: { image: false, longText: true, cards: true, metrics: false, chart: false },
      capacity: {
        titleMaxChars: 25,
        bodyMaxChars: 200,
        itemMin: 0,
        itemMax: 8,
        bodyMaxCharsPerItem: 80,
        imageSlots: 0,
      },
      supportsImage: false,
      maxTextBlocks: 5,
      slots: [
        {
          slotId: 'heading',
          role: 'heading',
          required: true,
          maxChars: 25,
          locator: { shapeId: '11', shapeName: '文本框 10' },
          contentPriority: ['displayTitle', 'shortTitle', 'title'],
          fitPolicy: 'truncate',
        },
        {
          slotId: 'body_upper',
          role: 'body',
          required: false,
          maxChars: 200,
          locator: { shapeId: '4', shapeName: '文本框 3' },
          contentPriority: ['body', 'summary'],
          fitPolicy: 'body_summary',
        },
        {
          slotId: 'body_lower',
          role: 'body2',
          required: false,
          maxChars: 150,
          locator: { shapeId: '5', shapeName: '文本框 4' },
          contentPriority: ['keyTakeaways', 'body'],
          fitPolicy: 'body_summary',
        },
      ],
    },
    {
      layoutId: 'ad_content_image',
      intent: 'image_text',
      layoutKind: 'image_heavy',
      sourceSlideIndex: 4,
      alternativeIntents: ['text_content', 'content_cards'],
      supports: { image: true, longText: true, cards: false, metrics: false, chart: true },
      capacity: {
        titleMaxChars: 25,
        bodyMaxChars: 150,
        itemMin: 0,
        itemMax: 6,
        bodyMaxCharsPerItem: 60,
        imageSlots: 1,
      },
      supportsImage: true,
      maxTextBlocks: 4,
      slots: [
        {
          slotId: 'heading',
          role: 'heading',
          required: true,
          maxChars: 25,
          locator: { shapeId: '11', shapeName: '文本框 10' },
          contentPriority: ['displayTitle', 'shortTitle', 'title'],
          fitPolicy: 'truncate',
        },
        {
          slotId: 'body_upper',
          role: 'body',
          required: false,
          maxChars: 150,
          locator: { shapeId: '4', shapeName: '文本框 3' },
          contentPriority: ['summary', 'body'],
          fitPolicy: 'body_summary',
        },
        { slotId: 'image', role: 'image', required: false },
      ],
    },
    {
      layoutId: 'ad_metrics',
      intent: 'text_content',
      layoutKind: 'metrics',
      sourceSlideIndex: 7,
      alternativeIntents: ['content_cards'],
      supports: { image: false, longText: false, cards: true, metrics: true, chart: false },
      capacity: {
        titleMaxChars: 25,
        bodyMaxChars: 100,
        itemMin: 2,
        itemMax: 6,
        bodyMaxCharsPerItem: 50,
        imageSlots: 0,
      },
      slots: [
        { slotId: 'heading', role: 'heading', required: true, maxChars: 25 },
        { slotId: 'items', role: 'items', required: false },
        { slotId: 'metrics', role: 'metrics', required: false },
      ],
    },
    {
      layoutId: 'ad_closing',
      intent: 'closing',
      layoutKind: 'closing',
      sourceSlideIndex: 23,
      alternativeIntents: ['unknown'],
      supports: { image: false, longText: false, cards: false, metrics: false, chart: false },
      capacity: {
        titleMaxChars: 15,
        bodyMaxChars: 80,
        itemMin: 0,
        itemMax: 5,
        bodyMaxCharsPerItem: 60,
        imageSlots: 0,
      },
      slots: [
        {
          slotId: 'closing_title',
          role: 'heading',
          required: true,
          maxChars: 15,
          locator: { shapeId: '40', shapeName: '文本框 39' },
          contentPriority: ['oneLiner', 'title'],
          fitPolicy: 'short_phrase',
        },
        {
          slotId: 'closing_body',
          role: 'body',
          required: false,
          maxChars: 80,
          locator: { shapeId: '54', shapeName: '文本框 53' },
          contentPriority: ['summary', 'keyTakeaways'],
          fitPolicy: 'truncate',
        },
        { slotId: 'closing_watermark1', role: 'notes', required: false, maxChars: 0, locator: { shapeId: '42' }, fitPolicy: 'clear' },
        { slotId: 'closing_watermark2', role: 'notes', required: false, maxChars: 0, locator: { shapeId: '45' }, fitPolicy: 'clear' },
        // Category bar and date — always clear on closing slide
        { slotId: 'closing_category_bar', role: 'notes', required: false, maxChars: 0, locator: { shapeId: '68', shapeName: '文本框 67' }, fitPolicy: 'clear' },
        { slotId: 'closing_date', role: 'notes', required: false, maxChars: 0, locator: { shapeId: '46', shapeName: '文本框 45' }, fitPolicy: 'clear' },
      ],
    },
  ],
}

const BRAND_DEF: Omit<SkillTemplateDef, 'extracted_pptx_path'> = {
  skill_id: ACADEMIC_DEFENSE_ID,
  name: '学术答辩',
  version: '1.0',
  enabled: true,
}

let _initialized = false

/**
 * Register academic_defense manifest and brand template.
 * @param sourceTemplatePath Absolute path to a .pptx source file for PptxGenJS master.
 */
export function initAcademicDefense(sourceTemplatePath: string): void {
  if (_initialized) return
  _initialized = true
  registerTemplateManifest(MANIFEST)
  registerSkillTemplate({ ...BRAND_DEF, extracted_pptx_path: sourceTemplatePath })
}
