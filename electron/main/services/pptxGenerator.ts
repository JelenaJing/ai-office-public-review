/**
 * PptxGenJS-based PPT generator for the Electron main process.
 *
 * Receives a structured slide plan (JSON) and produces a .pptx file.
 * The output still follows the existing PptxGenJS mainline, but now
 * defaults to a registered brand master template derived from 模板.pptx.
 */

import PptxGenJS from 'pptxgenjs'
import fs from 'node:fs/promises'
import path from 'node:path'

import { resolvePptBrandTemplate, type PptBrandTemplate } from './pptTemplateRegistry'
import { applyTemplateBackground } from './pptxBackgroundInjector'

/* ---------- public types ---------- */

export interface PptxSlideTheme {
  primary: string
  secondary: string
  accent: string
  light: string
  bg: string
  text: string
  muted: string
}

export interface PptxMetricDefinition {
  value: string
  label: string
  detail?: string
}

export interface PptxTimelineDefinition {
  title: string
  detail?: string
}

export interface PptxSlideDefinition {
  type: 'cover' | 'toc' | 'section' | 'content' | 'comparison' | 'timeline' | 'metrics' | 'summary'
  title?: string
  subtitle?: string
  heading?: string
  body?: string
  items?: string[]
  leftTitle?: string
  leftItems?: string[]
  rightTitle?: string
  rightItems?: string[]
  metrics?: PptxMetricDefinition[]
  timeline?: PptxTimelineDefinition[]
  imagePath?: string
  notes?: string
}

export interface PptxSlidePlan {
  title: string
  templateId?: string
  theme?: Partial<PptxSlideTheme>
  slides: PptxSlideDefinition[]
}

export interface PptxGenerateInput {
  plan: PptxSlidePlan
  outputPath: string
  templateId?: string
}

export interface PptxGenerateResult {
  success: boolean
  outputPath: string
  slideCount: number
  templateId?: string
  error?: string
}

/* ---------- defaults ---------- */

const DEFAULT_THEME: PptxSlideTheme = {
  primary: '6D2268',
  secondary: '2F2A28',
  accent: 'C9A227',
  light: 'EEE6D8',
  bg: 'FFFFFF',
  text: '2F2A28',
  muted: '6F625A',
}

const FONT_EN = 'Arial'
const FONT_ZH = 'Microsoft YaHei'

function resolveTheme(partial?: Partial<PptxSlideTheme>): PptxSlideTheme {
  return { ...DEFAULT_THEME, ...partial }
}

function hex(color: string): string {
  return color.replace(/^#/, '').slice(0, 6)
}

function addMasterSlide(pres: PptxGenJS, template: PptBrandTemplate) {
  const slide = pres.addSlide({ masterName: template.master.name })
  if (template.assets.headerLogoPath) {
    slide.addImage({
      path: template.assets.headerLogoPath,
      x: template.master.headerLogoBox.x,
      y: template.master.headerLogoBox.y,
      w: template.master.headerLogoBox.w,
      h: template.master.headerLogoBox.h,
    })
  }
  return slide
}

async function ensureTemplateAssetsReady(template: PptBrandTemplate): Promise<void> {
  // Source template is required
  try {
    await fs.access(template.assets.sourceTemplatePath)
  } catch {
    throw new Error(`模板源文件缺失，无法生成 PPT：${template.assets.sourceTemplatePath}`)
  }
  // Background and logo are optional — skill-based templates may only ship the .pptx
}

function registerBrandMaster(pres: PptxGenJS, template: PptBrandTemplate): void {
  pres.defineLayout({
    name: template.slideSize.layoutName,
    width: template.slideSize.widthInches,
    height: template.slideSize.heightInches,
  })
  pres.layout = template.slideSize.layoutName
  const bgOpts: Record<string, unknown> = { color: hex(template.theme.bg) }
  if (template.assets.backgroundImagePath) {
    bgOpts['path'] = template.assets.backgroundImagePath
  }
  pres.defineSlideMaster({
    title: template.master.name,
    background: bgOpts as Parameters<PptxGenJS['defineSlideMaster']>[0]['background'],
  })
}

function addPageTitle(slide: ReturnType<PptxGenJS['addSlide']>, theme: PptxSlideTheme, template: PptBrandTemplate, text: string): void {
  slide.addText(text, {
    x: template.safeArea.title.x,
    y: template.safeArea.title.y,
    w: template.safeArea.title.w,
    h: template.safeArea.title.h,
    fontSize: 24,
    fontFace: FONT_ZH,
    color: hex(theme.primary),
    bold: true,
    fit: 'shrink',
    margin: 0,
  })
}

function addBodyParagraphs(
  slide: ReturnType<PptxGenJS['addSlide']>,
  theme: PptxSlideTheme,
  text: string,
  box: { x: number; y: number; w: number },
): number {
  const paragraphs = String(text || '')
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5)

  paragraphs.forEach((paragraph, index) => {
    slide.addText(paragraph, {
      x: box.x,
      y: box.y + index * 0.56,
      w: box.w,
      h: 0.52,
      fontSize: 13,
      fontFace: FONT_ZH,
      color: hex(theme.text),
      margin: 0,
      fit: 'shrink',
    })
  })

  return paragraphs.length > 0 ? paragraphs.length * 0.56 + 0.18 : 0
}

function addPanelTitle(
  slide: ReturnType<PptxGenJS['addSlide']>,
  theme: PptxSlideTheme,
  text: string,
  box: { x: number; y: number; w: number },
): void {
  slide.addText(text, {
    x: box.x,
    y: box.y,
    w: box.w,
    h: 0.38,
    fontSize: 16,
    fontFace: FONT_ZH,
    color: hex(theme.primary),
    bold: true,
    margin: 0,
    fit: 'shrink',
  })
}

function addListItems(
  slide: ReturnType<PptxGenJS['addSlide']>,
  theme: PptxSlideTheme,
  items: string[],
  box: { x: number; y: number; w: number; h?: number },
  prefix: string,
): void {
  if (items.length === 0) return
  const textRuns = items.map((item, index) => ({
    text: prefix ? `${prefix} ${item}` : item,
    options: index < items.length - 1 ? { breakLine: true } : {},
  }))
  slide.addText(textRuns as any, {
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h ?? 5.0,
    fontSize: 14,
    fontFace: FONT_ZH,
    color: hex(theme.secondary),
    valign: 'top',
    margin: 0,
    lineSpacingMultiple: 1.6,
  })
}

/* ---------- slide builders ---------- */

function addCoverSlide(pres: PptxGenJS, theme: PptxSlideTheme, slide: PptxSlideDefinition, template: PptBrandTemplate) {
  const s = addMasterSlide(pres, template)
  s.addText(slide.title || '', {
    x: template.safeArea.body.x,
    y: 2.1,
    w: 8.4,
    h: 0.9,
    fontSize: 28,
    fontFace: FONT_ZH,
    color: hex(theme.primary),
    bold: true,
    align: 'left',
    valign: 'middle',
    margin: 0,
    fit: 'shrink',
  })
  if (slide.subtitle) {
    s.addText(slide.subtitle, {
      x: template.safeArea.body.x,
      y: 3.05,
      w: 8.9,
      h: 0.6,
      fontSize: 18,
      fontFace: FONT_ZH,
      color: hex(theme.secondary),
      align: 'left',
      valign: 'middle',
      margin: 0,
      fit: 'shrink',
    })
  }
  if (slide.notes) s.addNotes(slide.notes)
}

function addTocSlide(pres: PptxGenJS, theme: PptxSlideTheme, slide: PptxSlideDefinition, template: PptBrandTemplate) {
  const s = addMasterSlide(pres, template)
  addPageTitle(s, theme, template, slide.title || '目录')
  const items = slide.items || []
  addListItems(s, theme, items.map((item, index) => `${index + 1}. ${item}`), {
    x: template.safeArea.body.x + 0.05,
    y: template.safeArea.body.y,
    w: template.safeArea.body.w - 0.65,
    h: template.safeArea.body.h,
  }, '')
  if (slide.notes) s.addNotes(slide.notes)
}

function addSectionSlide(pres: PptxGenJS, theme: PptxSlideTheme, slide: PptxSlideDefinition, template: PptBrandTemplate) {
  const s = addMasterSlide(pres, template)
  s.addText(slide.heading || slide.title || '', {
    x: template.safeArea.body.x,
    y: 2.45,
    w: 8.2,
    h: 0.9,
    fontSize: 30,
    fontFace: FONT_ZH,
    color: hex(theme.primary),
    bold: true,
    align: 'left',
    valign: 'middle',
    margin: 0,
    fit: 'shrink',
  })
  if (slide.subtitle) {
    s.addText(slide.subtitle, {
      x: template.safeArea.body.x,
      y: 3.35,
      w: 8.8,
      h: 0.55,
      fontSize: 16,
      fontFace: FONT_ZH,
      color: hex(theme.secondary),
      align: 'left',
      valign: 'middle',
      margin: 0,
      fit: 'shrink',
    })
  }
  if (slide.notes) s.addNotes(slide.notes)
}

function addContentSlide(
  pres: PptxGenJS,
  theme: PptxSlideTheme,
  slide: PptxSlideDefinition,
  template: PptBrandTemplate,
  imagePath?: string | null,
) {
  const s = addMasterSlide(pres, template)
  addPageTitle(s, theme, template, slide.heading || slide.title || '')

  const hasImage = Boolean(imagePath)
  const textWidth = hasImage
    ? Math.max(2.5, template.safeArea.image.x - template.safeArea.body.x - 0.4)
    : template.safeArea.body.w
  const bodyOffset = slide.body
    ? addBodyParagraphs(s, theme, slide.body, {
      x: template.safeArea.body.x,
      y: template.safeArea.body.y,
      w: textWidth,
    })
    : 0

  const bullets = slide.items || []
  addListItems(s, theme, bullets, {
    x: template.safeArea.body.x,
    y: template.safeArea.body.y + bodyOffset,
    w: textWidth,
    h: Math.max(0.8, template.safeArea.body.h - bodyOffset),
  }, '•')

  if (imagePath) {
    s.addImage({
      path: imagePath,
      x: template.safeArea.image.x,
      y: template.safeArea.image.y,
      w: template.safeArea.image.w,
      h: template.safeArea.image.h,
      sizing: { type: 'contain', w: template.safeArea.image.w, h: template.safeArea.image.h },
    })
  }

  if (slide.notes) s.addNotes(slide.notes)
}

function addMetricsSlide(pres: PptxGenJS, theme: PptxSlideTheme, slide: PptxSlideDefinition, template: PptBrandTemplate) {
  const s = addMasterSlide(pres, template)
  addPageTitle(s, theme, template, slide.heading || slide.title || '核心指标')
  const metrics = (slide.metrics || []).slice(0, 4)
  if (slide.body) {
    addBodyParagraphs(s, theme, slide.body, {
      x: template.safeArea.body.x,
      y: template.safeArea.body.y,
      w: template.safeArea.body.w,
    })
  }
  if (metrics.length === 0) {
    addListItems(s, theme, slide.items || [], {
      x: template.safeArea.body.x,
      y: template.safeArea.body.y + 0.9,
      w: template.safeArea.body.w,
      h: template.safeArea.body.h - 0.9,
    }, '•')
    if (slide.notes) s.addNotes(slide.notes)
    return
  }

  const cols = metrics.length <= 2 ? metrics.length : 2
  const rows = Math.ceil(metrics.length / cols)
  const gapX = 0.28
  const gapY = 0.24
  const startY = template.safeArea.body.y + 0.8
  const cardW = (template.safeArea.body.w - gapX * (cols - 1)) / cols
  const cardH = rows === 1 ? 1.85 : 1.62

  metrics.forEach((metric, index) => {
    const row = Math.floor(index / cols)
    const col = index % cols
    const x = template.safeArea.body.x + col * (cardW + gapX)
    const y = startY + row * (cardH + gapY)

    s.addShape('roundRect', {
      x,
      y,
      w: cardW,
      h: cardH,
      rectRadius: 0.08,
      fill: { color: hex(theme.light) },
      line: { color: hex(theme.accent), width: 1.1 },
    })
    s.addText(metric.value || '', {
      x: x + 0.2,
      y: y + 0.18,
      w: cardW - 0.4,
      h: 0.5,
      fontSize: 24,
      fontFace: FONT_EN,
      color: hex(theme.primary),
      bold: true,
      margin: 0,
      fit: 'shrink',
    })
    s.addText(metric.label || '', {
      x: x + 0.2,
      y: y + 0.75,
      w: cardW - 0.4,
      h: 0.34,
      fontSize: 13,
      fontFace: FONT_ZH,
      color: hex(theme.secondary),
      bold: true,
      margin: 0,
      fit: 'shrink',
    })
    if (metric.detail) {
      s.addText(metric.detail, {
        x: x + 0.2,
        y: y + 1.11,
        w: cardW - 0.4,
        h: 0.34,
        fontSize: 11,
        fontFace: FONT_ZH,
        color: hex(theme.muted),
        margin: 0,
        fit: 'shrink',
      })
    }
  })

  if (slide.notes) s.addNotes(slide.notes)
}

function addComparisonSlide(pres: PptxGenJS, theme: PptxSlideTheme, slide: PptxSlideDefinition, template: PptBrandTemplate) {
  const s = addMasterSlide(pres, template)
  addPageTitle(s, theme, template, slide.heading || slide.title || '对比分析')
  if (slide.body) {
    addBodyParagraphs(s, theme, slide.body, {
      x: template.safeArea.body.x,
      y: template.safeArea.body.y,
      w: template.safeArea.body.w,
    })
  }

  const gap = 0.28
  const panelY = template.safeArea.body.y + 0.74
  const panelH = 4.55
  const panelW = (template.safeArea.body.w - gap) / 2
  const leftX = template.safeArea.body.x
  const rightX = leftX + panelW + gap

  ;[
    { title: slide.leftTitle || '左侧', items: slide.leftItems || [], x: leftX },
    { title: slide.rightTitle || '右侧', items: slide.rightItems || [], x: rightX },
  ].forEach((column) => {
    s.addShape('roundRect', {
      x: column.x,
      y: panelY,
      w: panelW,
      h: panelH,
      rectRadius: 0.06,
      fill: { color: hex(theme.light) },
      line: { color: hex(theme.accent), width: 0.8 },
    })
    addPanelTitle(s, theme, column.title, {
      x: column.x + 0.18,
      y: panelY + 0.16,
      w: panelW - 0.36,
    })
    addListItems(s, theme, column.items.slice(0, 5), {
      x: column.x + 0.18,
      y: panelY + 0.64,
      w: panelW - 0.36,
      h: panelH - 0.82,
    }, '•')
  })

  if (slide.notes) s.addNotes(slide.notes)
}

function addTimelineSlide(pres: PptxGenJS, theme: PptxSlideTheme, slide: PptxSlideDefinition, template: PptBrandTemplate) {
  const s = addMasterSlide(pres, template)
  addPageTitle(s, theme, template, slide.heading || slide.title || '推进节奏')
  if (slide.body) {
    addBodyParagraphs(s, theme, slide.body, {
      x: template.safeArea.body.x,
      y: template.safeArea.body.y,
      w: template.safeArea.body.w,
    })
  }

  const entries = (slide.timeline || []).slice(0, 4)
  if (entries.length === 0) {
    addListItems(s, theme, slide.items || [], {
      x: template.safeArea.body.x,
      y: template.safeArea.body.y + 0.9,
      w: template.safeArea.body.w,
      h: template.safeArea.body.h - 0.9,
    }, '•')
    if (slide.notes) s.addNotes(slide.notes)
    return
  }

  const lineX = template.safeArea.body.x + 0.45
  const startY = template.safeArea.body.y + 0.95
  const verticalGap = 1.02
  s.addShape('rect', {
    x: lineX,
    y: startY - 0.02,
    w: 0.03,
    h: Math.max(0.5, (entries.length - 1) * verticalGap + 0.14),
    fill: { color: hex(theme.accent) },
    line: { color: hex(theme.accent), transparency: 100 },
  })

  entries.forEach((entry, index) => {
    const y = startY + index * verticalGap
    s.addShape('ellipse', {
      x: lineX - 0.08,
      y,
      w: 0.18,
      h: 0.18,
      fill: { color: hex(theme.primary) },
      line: { color: hex(theme.primary), transparency: 100 },
    })
    s.addText(entry.title || '', {
      x: lineX + 0.28,
      y: y - 0.04,
      w: template.safeArea.body.w - 0.85,
      h: 0.28,
      fontSize: 15,
      fontFace: FONT_ZH,
      color: hex(theme.primary),
      bold: true,
      margin: 0,
      fit: 'shrink',
    })
    if (entry.detail) {
      s.addText(entry.detail, {
        x: lineX + 0.28,
        y: y + 0.24,
        w: template.safeArea.body.w - 0.85,
        h: 0.34,
        fontSize: 11,
        fontFace: FONT_ZH,
        color: hex(theme.muted),
        margin: 0,
        fit: 'shrink',
      })
    }
  })

  if (slide.notes) s.addNotes(slide.notes)
}

function addSummarySlide(pres: PptxGenJS, theme: PptxSlideTheme, slide: PptxSlideDefinition, template: PptBrandTemplate) {
  const s = addMasterSlide(pres, template)
  addPageTitle(s, theme, template, slide.heading || slide.title || '总结')

  if (slide.body) {
    addBodyParagraphs(s, theme, slide.body, {
      x: template.safeArea.body.x,
      y: template.safeArea.body.y,
      w: template.safeArea.body.w,
    })
  }

  const items = slide.items || []
  const itemsBodyOffset = slide.body ? 0.86 : 0
  addListItems(s, theme, items, {
    x: template.safeArea.body.x,
    y: template.safeArea.body.y + itemsBodyOffset,
    w: template.safeArea.body.w - 0.2,
    h: template.safeArea.body.h - itemsBodyOffset,
  }, '✓')
  if (slide.notes) s.addNotes(slide.notes)
}

/* ---------- image helper ---------- */

async function tryResolveImagePath(imagePath: string | undefined): Promise<string | null> {
  if (!imagePath) return null
  try {
    const normalized = imagePath.startsWith('file://') ? decodeURI(imagePath.replace(/^file:\/\//, '')) : imagePath
    await fs.access(normalized)
    return normalized
  } catch {
    return null
  }
}

/* ---------- main entry ---------- */

export async function generatePptx(input: PptxGenerateInput): Promise<PptxGenerateResult> {
  const { plan, outputPath } = input

  if (!plan || !Array.isArray(plan.slides) || plan.slides.length === 0) {
    return { success: false, outputPath, slideCount: 0, error: '幻灯片计划为空，无法生成。' }
  }

  const template = resolvePptBrandTemplate(input.templateId || plan.templateId)
  console.log('[pptxGenerator] requested templateId=', input.templateId || plan.templateId || '(none)')
  console.log('[pptxGenerator] resolved template=', template.id, 'theme.primary=', template.theme.primary, 'sourceTemplatePath=', template.assets.sourceTemplatePath)
  await ensureTemplateAssetsReady(template)

  const theme = resolveTheme({ ...template.theme, ...(plan.theme || {}) })
  const pres = new PptxGenJS()
  registerBrandMaster(pres, template)
  pres.author = 'AI Writer 3.0'
  pres.company = 'The Chinese University of Hong Kong, Shenzhen'
  pres.title = plan.title || 'Presentation'
  pres.subject = template.name
  pres.theme = {
    headFontFace: FONT_EN,
    bodyFontFace: FONT_EN,
  }

  for (const slide of plan.slides) {
    switch (slide.type) {
      case 'cover':
        addCoverSlide(pres, theme, slide, template)
        break
      case 'toc':
        addTocSlide(pres, theme, slide, template)
        break
      case 'section':
        addSectionSlide(pres, theme, slide, template)
        break
      case 'content': {
        const imagePath = await tryResolveImagePath(slide.imagePath)
        addContentSlide(pres, theme, slide, template, imagePath)
        break
      }
      case 'metrics':
        addMetricsSlide(pres, theme, slide, template)
        break
      case 'comparison':
        addComparisonSlide(pres, theme, slide, template)
        break
      case 'timeline':
        addTimelineSlide(pres, theme, slide, template)
        break
      case 'summary':
        addSummarySlide(pres, theme, slide, template)
        break
      default:
        addContentSlide(pres, theme, slide, template, null)
        break
    }
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await pres.writeFile({ fileName: outputPath })

  // Stage 3-B1: inject decorative background shapes from Skill template.pptx
  if (template.source === 'skill' && template.assets.sourceTemplatePath) {
    const injResult = await applyTemplateBackground({
      outputPptxPath: outputPath,
      templatePptxPath: template.assets.sourceTemplatePath,
      templateId: template.id,
    })
    console.log('[pptxGenerator] background injection:', injResult.status, injResult)
  }

  return {
    success: true,
    outputPath,
    slideCount: plan.slides.length,
    templateId: template.id,
  }
}
