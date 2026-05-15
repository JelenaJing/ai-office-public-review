/**
 * 引用插入与编号顺延工具。
 *
 * 用于右键"查找文献并插入"流程：新插入的条目按照插入位置
 * 之前已使用的最大编号 +1 作为起始编号，插入位置之后的已有
 * 编号全部顺延 k 位（k=本次插入条数），reference.json 与正文
 * 保持一致。
 */

import type { CitationReferenceItem } from './citationGroups'
import { extractCitationNumbers, updateCitationNumbersInText } from './citationGroups'

export interface ReferenceJsonItem {
  reference_number: number
  citation: string
  [key: string]: unknown
}

/** 扫描 `precedingText` 中出现过的全部引用编号，返回最大值（没有返回 0）。 */
export function computeInsertionAnchorNumber(precedingText: string): number {
  const numbers = extractCitationNumbers(precedingText)
  if (!numbers.length) return 0
  return numbers.reduce((maxValue, value) => Math.max(maxValue, value), 0)
}

/**
 * 构造 "≥threshold 的编号全部 +delta" 的 remap，
 * usedNumbers 是文档中出现过的所有编号集合。
 */
export function buildShiftRemap(threshold: number, delta: number, usedNumbers: number[]): Map<number, number> {
  const remap = new Map<number, number>()
  if (!Number.isFinite(threshold) || !Number.isFinite(delta) || delta <= 0) return remap
  const uniqueNumbers = Array.from(new Set(usedNumbers.filter((value) => Number.isFinite(value) && value > 0)))
  uniqueNumbers.forEach((number) => {
    if (number >= threshold) remap.set(number, number + delta)
  })
  return remap
}

/**
 * 在 HTML 字符串中把所有引用标记 [N] 里 ≥threshold 的数字 +delta。
 * 同时处理正文的 `[1, 2-4]` 复合引用。不处理参考文献段落前缀，
 * 因为参考文献段会在随后被重建。但即便处理了也无妨——重建会覆盖。
 */
export function shiftCitationsInHtml(html: string, threshold: number, delta: number): string {
  if (!html || delta <= 0) return html
  const numbers = extractCitationNumbers(html)
  const remap = buildShiftRemap(threshold, delta, numbers)
  if (!remap.size) return html
  // updateCitationNumbersInText 直接对整段文本做正则替换，可作用于 HTML。
  return updateCitationNumbersInText(html, remap)
}

/**
 * 顺延 reference.json：原本 ≥threshold 的条目编号 +delta，
 * 然后在空出的 threshold..threshold+k-1 位置插入新条目。
 * 返回按编号升序排序的新数组。
 */
export function shiftReferenceJson(
  existing: ReferenceJsonItem[],
  threshold: number,
  newInsertions: ReferenceJsonItem[],
): ReferenceJsonItem[] {
  const delta = newInsertions.length
  if (!delta) return existing.slice().sort((l, r) => (l.reference_number || 0) - (r.reference_number || 0))
  const shifted: ReferenceJsonItem[] = existing.map((item) => {
    const currentNumber = Number(item.reference_number) || 0
    if (currentNumber >= threshold) {
      return { ...item, reference_number: currentNumber + delta }
    }
    return { ...item }
  })
  // 新插入项按顺序占据 threshold..threshold+delta-1
  newInsertions.forEach((item, index) => {
    shifted.push({ ...item, reference_number: threshold + index })
  })
  shifted.sort((l, r) => (l.reference_number || 0) - (r.reference_number || 0))
  return shifted
}

/** reference.json 条目 → editor 使用的 CitationReferenceItem。 */
export function jsonToCitationReferenceItems(items: ReferenceJsonItem[]): CitationReferenceItem[] {
  return items
    .filter((item) => Number.isFinite(Number(item.reference_number)) && Number(item.reference_number) > 0)
    .map((item) => ({
      citationNumber: Number(item.reference_number),
      text: String(item.citation || '').trim(),
    }))
    .sort((l, r) => l.citationNumber - r.citationNumber)
}
