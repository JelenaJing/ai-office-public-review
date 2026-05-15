// ---------------------------------------------------------------------------
// fieldResolutionService.ts — 字段冲突合并与确认服务
// ---------------------------------------------------------------------------
// 职责：
//   - 多样本文档字段值冲突检测
//   - 优先级决策（用户覆写 > 样本值 > LLM 候选 > 模板默认值）
//   - 用户 override 冻结（一旦 userOverride=true，不再被后续候选覆盖）
//   - 必填校验
//
// 输入：FieldSchema[] + FieldValue[] + 样本候选值
// 输出：合并后的 FieldValue[] + 冲突报告
// ---------------------------------------------------------------------------

import type { FieldSchema, FieldValue, FormalTemplateErrorCode } from '../../../../src/types/templateGeneration'

// ---- 公共类型 ----

export interface FieldConflict {
  fieldId: string
  label: string
  values: Array<{ source: string; value: string }>
}

export interface FieldResolutionResult {
  /** 合并后最终字段值列表 */
  resolvedValues: FieldValue[]
  /** 存在冲突的字段 */
  conflicts: FieldConflict[]
  /** 必填但缺失的字段 ID */
  missingRequiredFieldIds: string[]
  /** 是否全部通过校验 */
  valid: boolean
  errorCode?: FormalTemplateErrorCode
}

// ---- 对外 API ----

/**
 * resolveFields — 合并多来源字段值，产出最终 FieldValue[]
 *
 * 优先级（高→低）：
 *   1. userOverride=true 的 FieldValue（用户手动填写，冻结）
 *   2. 样本文档候选值（单一致→采用；多冲突→标记冲突，取第一个）
 *   3. LLM 候选 candidateValue
 *   4. FieldSchema.defaultText（模板原始值）
 */
export function resolveFields(
  fields: FieldSchema[],
  currentValues: FieldValue[],
  sampleCandidates: Array<{ fieldId: string; sampleDocumentId: string; value: string }>,
): FieldResolutionResult {
  const currentMap = new Map(currentValues.map((v) => [v.fieldId, v]))
  const sampleByField = groupBy(sampleCandidates, (c) => c.fieldId)
  const conflicts: FieldConflict[] = []
  const resolvedValues: FieldValue[] = []

  for (const field of fields) {
    const current = currentMap.get(field.fieldId)

    // 优先级 1：用户冻结值
    if (current?.userOverride && current.confirmed) {
      resolvedValues.push(current)
      continue
    }

    // 优先级 2：样本候选
    const samples = sampleByField.get(field.fieldId) || []
    const uniqueSampleValues = [...new Set(samples.map((s) => s.value))]

    if (uniqueSampleValues.length > 1) {
      conflicts.push({
        fieldId: field.fieldId,
        label: field.label,
        values: samples.map((s) => ({ source: s.sampleDocumentId, value: s.value })),
      })
    }

    const sampleValue = uniqueSampleValues[0] // 取第一个（如有冲突，用户后续在 UI 选择）

    // 优先级 3：LLM 候选
    const candidateValue = current?.candidateValue

    // 优先级 4：模板默认
    const defaultValue = field.defaultText

    // 决策
    const finalValue = current?.userOverride
      ? current.value
      : sampleValue || candidateValue || defaultValue || ''

    resolvedValues.push({
      fieldId: field.fieldId,
      value: finalValue,
      userOverride: current?.userOverride ?? false,
      candidateValue: candidateValue || sampleValue,
      confirmed: current?.confirmed ?? false,
    })
  }

  // 必填校验
  const missingRequiredFieldIds = fields
    .filter((f) => f.required)
    .filter((f) => {
      const resolved = resolvedValues.find((v) => v.fieldId === f.fieldId)
      return !resolved || !resolved.value.trim()
    })
    .map((f) => f.fieldId)

  const valid = missingRequiredFieldIds.length === 0

  return {
    resolvedValues,
    conflicts,
    missingRequiredFieldIds,
    valid,
    errorCode: !valid ? 'FT_FIELD_MISSING_REQUIRED' : conflicts.length > 0 ? 'FT_FIELD_CONFLICT' : undefined,
  }
}

/**
 * freezeUserOverrides — 将用户确认过的字段标记为冻结
 * 后续 resolve 不再覆盖
 */
export function freezeUserOverrides(values: FieldValue[], confirmedFieldIds: string[]): FieldValue[] {
  const confirmedSet = new Set(confirmedFieldIds)
  return values.map((v) =>
    confirmedSet.has(v.fieldId)
      ? { ...v, userOverride: true, confirmed: true }
      : v,
  )
}

// ---- 内部工具 ----

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const key = keyFn(item)
    const group = map.get(key)
    if (group) group.push(item)
    else map.set(key, [item])
  }
  return map
}
