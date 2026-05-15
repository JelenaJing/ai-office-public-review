export type PaperTemplateId = 'academic-cn' | 'academic-en' | 'thesis' | 'compact'

/* ── A4 物理尺寸与 Word 默认页边距 ─────────────────────────────── */
/** A4: 210mm × 297mm. 以 96 DPI 计 1mm ≈ 3.7795px */
export const A4_WIDTH_MM = 210
export const A4_HEIGHT_MM = 297
export const MM_TO_PX = 3.7795275591
export const A4_WIDTH_PX = Math.round(A4_WIDTH_MM * MM_TO_PX)   // 794
export const A4_HEIGHT_PX = Math.round(A4_HEIGHT_MM * MM_TO_PX) // 1123

/** Word 默认页边距 (mm)，与 docx 导出保持一致 */
export interface PageMargins {
  top: number
  right: number
  bottom: number
  left: number
}

export interface PaperTemplateConfig {
  id: PaperTemplateId
  label: string
  pagePadding: string
  fontFamily: string
  fontSize: string
  lineHeight: string
  textIndent: string
  paragraphSpacing: string
  headingAlign: 'left' | 'center'
  /** Word 对齐的物理页边距 (mm)，用于 A4 分页视图和 docx 导出 */
  pageMargins: PageMargins
  /** Word 字号 (磅)，用于 docx 导出 */
  fontSizePt: number
  /** Word 行距倍数，用于 docx 导出 */
  lineSpacingMultiple: number
  /** Word 段前间距 (磅) */
  spacingBeforePt: number
  /** Word 段后间距 (磅) */
  spacingAfterPt: number
}

export const PAPER_TEMPLATES: Record<PaperTemplateId, PaperTemplateConfig> = {
  'academic-cn': {
    id: 'academic-cn',
    label: '中文期刊',
    pagePadding: '40px 60px 80px',
    fontFamily: 'Source Serif 4, Noto Serif SC, SimSun, serif',
    fontSize: '15px',
    lineHeight: '1.9',
    textIndent: '2em',
    paragraphSpacing: '8px',
    headingAlign: 'center',
    pageMargins: { top: 25.4, right: 31.7, bottom: 25.4, left: 31.7 },
    fontSizePt: 12,
    lineSpacingMultiple: 1.5,
    spacingBeforePt: 0,
    spacingAfterPt: 6,
  },
  'academic-en': {
    id: 'academic-en',
    label: 'English Journal',
    pagePadding: '44px 64px 84px',
    fontFamily: 'Times New Roman, Georgia, serif',
    fontSize: '14px',
    lineHeight: '1.8',
    textIndent: '0',
    paragraphSpacing: '8px',
    headingAlign: 'center',
    pageMargins: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
    fontSizePt: 12,
    lineSpacingMultiple: 2.0,
    spacingBeforePt: 0,
    spacingAfterPt: 8,
  },
  thesis: {
    id: 'thesis',
    label: '学位论文',
    pagePadding: '48px 72px 88px',
    fontFamily: 'Times New Roman, Noto Serif SC, serif',
    fontSize: '15px',
    lineHeight: '2',
    textIndent: '2em',
    paragraphSpacing: '10px',
    headingAlign: 'center',
    pageMargins: { top: 25.4, right: 31.7, bottom: 25.4, left: 31.7 },
    fontSizePt: 12,
    lineSpacingMultiple: 1.5,
    spacingBeforePt: 0,
    spacingAfterPt: 6,
  },
  compact: {
    id: 'compact',
    label: '紧凑报告',
    pagePadding: '32px 42px 64px',
    fontFamily: 'Source Serif 4, Noto Serif SC, serif',
    fontSize: '14px',
    lineHeight: '1.6',
    textIndent: '0',
    paragraphSpacing: '6px',
    headingAlign: 'left',
    pageMargins: { top: 20, right: 20, bottom: 20, left: 20 },
    fontSizePt: 11,
    lineSpacingMultiple: 1.15,
    spacingBeforePt: 0,
    spacingAfterPt: 4,
  },
}

/** 将物理页边距 (mm) 转为编辑器 CSS padding 字符串 */
export function pageMarginsToCSS(m: PageMargins): string {
  return `${Math.round(m.top * MM_TO_PX)}px ${Math.round(m.right * MM_TO_PX)}px ${Math.round(m.bottom * MM_TO_PX)}px ${Math.round(m.left * MM_TO_PX)}px`
}

export const DEFAULT_PAPER_TEMPLATE_ID: PaperTemplateId = 'academic-cn'

export function getRecommendedPaperTemplateId(language?: string | null): PaperTemplateId {
  return String(language || '').toLowerCase() === 'en' ? 'academic-en' : 'academic-cn'
}

export function getPaperTemplate(templateId?: string | null): PaperTemplateConfig {
  if (!templateId) return PAPER_TEMPLATES[DEFAULT_PAPER_TEMPLATE_ID]
  return PAPER_TEMPLATES[templateId as PaperTemplateId] || PAPER_TEMPLATES[DEFAULT_PAPER_TEMPLATE_ID]
}