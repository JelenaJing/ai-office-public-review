// ---------------------------------------------------------------------------
// fieldExtractionService.ts — 字段抽取服务
// ---------------------------------------------------------------------------
// 职责：从 OOXML blocks 中识别可填字段。
// 三种来源：
//   1. w:sdt 内容控件 → sourceKind='content-control'
//   2. {{占位符}} 文本模式 → sourceKind='placeholder'
//   3. Word 文档属性 (title/author) → sourceKind='doc-property'（V1.1 预留）
//
// 输入：OoxmlBlockSnapshot[]
// 输出：FieldSchema[]
// ---------------------------------------------------------------------------

import type { OoxmlBlockSnapshot } from '../documentEngineService'
import type { FieldSchema, FieldSourceKind, FieldDataType } from '../../../../src/types/templateGeneration'

// ---- 配置 ----

/** 占位符正则：匹配 {{字段名}} 或 {{ 字段名 }}，支持中英文 */
const PLACEHOLDER_PATTERN = /\{\{\s*([^}]+?)\s*\}\}/g

// ---- 对外 API ----

/**
 * extractFields — 从 blocks 快照中抽取所有可识别字段
 */
export function extractFields(blocks: OoxmlBlockSnapshot[]): FieldSchema[] {
  const fields: FieldSchema[] = []
  const seenLabels = new Set<string>()

  for (const block of blocks) {
    // 1. 检测 sdt 内容控件（通过 fieldInstructions 字段识别）
    if (block.fieldInstructions && block.fieldInstructions.length > 0) {
      for (const instruction of block.fieldInstructions) {
        const label = normalizeFieldLabel(instruction)
        if (label && !seenLabels.has(label)) {
          seenLabels.add(label)
          fields.push(buildFieldSchema(label, 'content-control', block))
        }
      }
    }

    // 2. 检测 {{占位符}} 文本模式
    const text = block.text || ''
    let match: RegExpExecArray | null
    PLACEHOLDER_PATTERN.lastIndex = 0
    while ((match = PLACEHOLDER_PATTERN.exec(text)) !== null) {
      const label = normalizeFieldLabel(match[1])
      if (label && !seenLabels.has(label)) {
        seenLabels.add(label)
        fields.push(buildFieldSchema(label, 'placeholder', block))
      }
    }
  }

  return fields
}

/**
 * extractFieldsFromSample — 从已填写的样本文档中提取字段候选值
 * 对比模板字段的 blockIndices，读取样本中同位置blocks 的文本
 */
export function extractFieldsFromSample(
  templateFields: FieldSchema[],
  sampleBlocks: OoxmlBlockSnapshot[],
  sampleDocumentId: string,
): Array<{ fieldId: string; sampleDocumentId: string; value: string }> {
  const results: Array<{ fieldId: string; sampleDocumentId: string; value: string }> = []

  for (const field of templateFields) {
    const texts: string[] = []
    for (const idx of field.blockIndices) {
      if (idx < sampleBlocks.length) {
        const sampleText = sampleBlocks[idx]?.text || ''
        // 样本中对应位置的文本，去掉原始占位符
        const cleaned = sampleText.replace(PLACEHOLDER_PATTERN, '').trim()
        if (cleaned) texts.push(cleaned)
      }
    }
    if (texts.length > 0) {
      results.push({ fieldId: field.fieldId, sampleDocumentId, value: texts.join('\n') })
    }
  }

  return results
}

// ---- 内部工具 ----

function normalizeFieldLabel(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

function inferDataType(label: string): FieldDataType {
  const lower = label.toLowerCase()
  if (/日期|date|时间|time/.test(lower)) return 'date'
  if (/数量|数额|金额|number|amount|count/.test(lower)) return 'number'
  return 'text'
}

function buildFieldSchema(label: string, sourceKind: FieldSourceKind, block: OoxmlBlockSnapshot): FieldSchema {
  return {
    fieldId: `field-${sourceKind}-${simpleHash(label + block.index)}`,
    label,
    sourceKind,
    dataType: inferDataType(label),
    required: false, // V1 默认非必填，后续可由用户在确认阶段标记
    defaultText: block.text || '',
    blockIndices: [block.index],
  }
}

function simpleHash(text: string): string {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0
  }
  return hash.toString(36)
}
