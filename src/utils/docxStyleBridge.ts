/**
 * docxStyleBridge — TipTap 节点类型 ↔ Word 样式的统一映射。
 *
 * 编辑器 CSS 和 docx 导出使用完全相同的一组数值，
 * 确保"编辑器里看到的内容 = 最终 docx 输出的内容"。
 */

import type { PaperTemplateConfig, PageMargins } from './paperTemplates'

/* ── Word 字号：磅 ↔ 半磅（half-point，OOXML 内部单位） ─── */
export function ptToHalfPt(pt: number): number { return Math.round(pt * 2) }
export function ptToTwip(pt: number): number { return Math.round(pt * 20) }

/* ── 页边距：mm → twips（OOXML 内部单位，1 inch = 1440 twip, 1 mm = 56.6929 twip） ─── */
const MM_TO_TWIP = 56.6929
export function mmToTwip(mm: number): number { return Math.round(mm * MM_TO_TWIP) }

export function pageMarginsToTwips(m: PageMargins) {
  return { top: mmToTwip(m.top), right: mmToTwip(m.right), bottom: mmToTwip(m.bottom), left: mmToTwip(m.left) }
}

/* ── 行距：倍数 → OOXML line240 单位（1 倍行距 = 240） ─── */
export function lineSpacingToOoxml(multiple: number): number { return Math.round(multiple * 240) }

/* ── 段落样式映射 ─── */
export interface DocxParagraphStyle {
  name: string
  fontSizeHalfPt: number
  bold: boolean
  alignment: 'center' | 'left' | 'right' | 'both'
  lineSpacing240: number
  spacingBeforeTwip: number
  spacingAfterTwip: number
  indentFirstLineTwip: number
  fontFamily: string
}

/** 根据 TipTap 节点类型和当前模板，返回 docx 段落样式参数 */
export function resolveDocxParagraphStyle(
  nodeType: 'heading1' | 'heading2' | 'heading3' | 'heading4' | 'paragraph' | 'blockquote' | 'listItem',
  template: PaperTemplateConfig,
): DocxParagraphStyle {
  const base: DocxParagraphStyle = {
    name: 'Normal',
    fontSizeHalfPt: ptToHalfPt(template.fontSizePt),
    bold: false,
    alignment: 'both',
    lineSpacing240: lineSpacingToOoxml(template.lineSpacingMultiple),
    spacingBeforeTwip: ptToTwip(template.spacingBeforePt),
    spacingAfterTwip: ptToTwip(template.spacingAfterPt),
    indentFirstLineTwip: template.textIndent === '2em' ? ptToTwip(template.fontSizePt * 2) : 0,
    fontFamily: template.fontFamily.split(',')[0].trim().replace(/['"]/g, ''),
  }

  switch (nodeType) {
    case 'heading1':
      return { ...base, name: 'Heading 1', fontSizeHalfPt: ptToHalfPt(22), bold: true, alignment: 'center', spacingBeforeTwip: ptToTwip(24), spacingAfterTwip: ptToTwip(12), indentFirstLineTwip: 0 }
    case 'heading2':
      return { ...base, name: 'Heading 2', fontSizeHalfPt: ptToHalfPt(16), bold: true, alignment: template.headingAlign === 'center' ? 'center' : 'left', spacingBeforeTwip: ptToTwip(18), spacingAfterTwip: ptToTwip(6), indentFirstLineTwip: 0 }
    case 'heading3':
      return { ...base, name: 'Heading 3', fontSizeHalfPt: ptToHalfPt(14), bold: true, alignment: 'left', spacingBeforeTwip: ptToTwip(12), spacingAfterTwip: ptToTwip(4), indentFirstLineTwip: 0 }
    case 'heading4':
      return { ...base, name: 'Heading 4', fontSizeHalfPt: ptToHalfPt(12), bold: true, alignment: 'left', spacingBeforeTwip: ptToTwip(8), spacingAfterTwip: ptToTwip(4), indentFirstLineTwip: 0 }
    case 'blockquote':
      return { ...base, name: 'Quote', fontSizeHalfPt: ptToHalfPt(template.fontSizePt - 1), alignment: 'left', indentFirstLineTwip: 0 }
    case 'listItem':
      return { ...base, indentFirstLineTwip: 0 }
    default:
      return base
  }
}

/** TipTap heading level → 映射 key */
export function headingLevelToNodeType(level: number): 'heading1' | 'heading2' | 'heading3' | 'heading4' {
  if (level <= 1) return 'heading1'
  if (level === 2) return 'heading2'
  if (level === 3) return 'heading3'
  return 'heading4'
}
