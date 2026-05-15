// ---------------------------------------------------------------------------
// shellValidationService.ts — 壳层完整性校验服务
// ---------------------------------------------------------------------------
// 职责：写回后验证 region 外的 blocks、header/footer、rels、media 未被篡改。
//
// 校验策略：
//   1. block 级校验：region 外每个 block 的 kind + text hash + sourceId 必须与基线一致
//   2. 包级校验：zip 内的关键条目（header*.xml, footer*.xml, _rels/*.rels, word/media/*）
//      条目数量和名称必须与基线一致
//
// fail-closed：任何不一致 → ShellValidationResult.passed=false，直接报错
// ---------------------------------------------------------------------------

import type { OoxmlBlockSnapshot, OoxmlPackageSnapshot } from '../documentEngineService'
import type { TemplateRegion, ShellValidationResult } from '../../../../src/types/templateGeneration'

// ---- 对外 API ----

/**
 * validateShellIntegrity — 完整壳层校验
 *
 * @param baselineSnapshot  写回前的基线快照（由 admit 阶段保存）
 * @param afterSnapshot     写回后 re-read 的快照
 * @param regions           区域列表（用于确定哪些 blocks 是允许变化的）
 */
export function validateShellIntegrity(
  baselineSnapshot: OoxmlPackageSnapshot,
  afterSnapshot: OoxmlPackageSnapshot,
  regions: TemplateRegion[],
  options?: {
    extraEditableBlockIndices?: number[]
    replacementRanges?: Array<{ start: number; end: number; replacementLength: number }>
  },
): ShellValidationResult {
  const startMs = Date.now()

  // 收集所有可编辑区域的 block 下标
  const editableIndices = new Set<number>()
  for (const region of regions) {
    if (region.llmWritable && !region.shellLocked) {
      for (let i = region.blockRange.start; i < region.blockRange.end; i++) {
        editableIndices.add(i)
      }
    }
  }

  for (const index of options?.extraEditableBlockIndices || []) {
    if (Number.isInteger(index) && index >= 0) editableIndices.add(index)
  }

  const violations: number[] = []

  // 1. block 级校验：region 外每个 block 必须未变化
  const baseBlocks = baselineSnapshot.blocks
  const afterBlocks = afterSnapshot.blocks
  const replacementRanges = normalizeReplacementRanges(options?.replacementRanges)
  const expectedAfterBlockCount = baseBlocks.length + replacementRanges.reduce(
    (total, range) => total + range.replacementLength - (range.end - range.start),
    0,
  )

  // block 总数只允许按已知可编辑区域 replacement 发生变化
  if (afterBlocks.length !== expectedAfterBlockCount) {
    return {
      passed: false,
      checkedBlockCount: baseBlocks.length,
      violatedBlockIndices: [-1], // -1 表示 block 总数变化
      durationMs: Date.now() - startMs,
      errorCode: 'FT_SHELL_INTEGRITY_VIOLATED',
      errorMessage: `block 总数不一致: 基线 ${baseBlocks.length}, 预期写回后 ${expectedAfterBlockCount}, 实际写回后 ${afterBlocks.length}`,
    }
  }

  for (let i = 0; i < baseBlocks.length; i++) {
    if (editableIndices.has(i)) continue // 跳过可编辑区域

    const base = baseBlocks[i]
    const afterIndex = mapBaselineIndexToAfterIndex(i, replacementRanges)
    const after = afterBlocks[afterIndex]

    if (!after) {
      violations.push(i)
      continue
    }

    // 校验 kind
    if (base.kind !== after.kind) {
      violations.push(i)
      continue
    }

    // 校验文本内容（hash 比较）
    if (simpleHash(base.text) !== simpleHash(after.text)) {
      violations.push(i)
      continue
    }

    // 校验 sourceId（如果基线有）
    if (base.sourceId && base.sourceId !== after.sourceId) {
      violations.push(i)
    }
  }

  // 2. 包级校验：关键 zip 条目
  const criticalEntryPrefixes = ['word/header', 'word/footer', 'word/_rels/', 'word/media/', '_rels/']
  const baselineCritical = baselineSnapshot.entries.filter((e) => criticalEntryPrefixes.some((p) => e.startsWith(p))).sort()
  const afterCritical = afterSnapshot.entries.filter((e) => criticalEntryPrefixes.some((p) => e.startsWith(p))).sort()

  if (baselineCritical.length !== afterCritical.length || baselineCritical.some((e, i) => e !== afterCritical[i])) {
    return {
      passed: false,
      checkedBlockCount: baseBlocks.length,
      violatedBlockIndices: violations.length > 0 ? violations : [-2], // -2 表示包级条目变化
      durationMs: Date.now() - startMs,
      errorCode: 'FT_SHELL_INTEGRITY_VIOLATED',
      errorMessage: `关键 zip 条目不一致: 基线 ${baselineCritical.length} 项, 写回后 ${afterCritical.length} 项`,
    }
  }

  const durationMs = Date.now() - startMs

  if (violations.length > 0) {
    return {
      passed: false,
      checkedBlockCount: baseBlocks.length,
      violatedBlockIndices: violations,
      durationMs,
      errorCode: 'FT_SHELL_INTEGRITY_VIOLATED',
      errorMessage: `${violations.length} 个壳层 block 被意外修改 (下标: ${violations.slice(0, 5).join(', ')}${violations.length > 5 ? '...' : ''})`,
    }
  }

  return {
    passed: true,
    checkedBlockCount: baseBlocks.length,
    violatedBlockIndices: [],
    durationMs,
  }
}

// ---- 内部工具 ----

function simpleHash(text: string): string {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0
  }
  return hash.toString(36)
}

function normalizeReplacementRanges(
  ranges?: Array<{ start: number; end: number; replacementLength: number }>,
): Array<{ start: number; end: number; replacementLength: number }> {
  return (ranges || [])
    .filter((range) => (
      Number.isInteger(range.start)
      && Number.isInteger(range.end)
      && Number.isInteger(range.replacementLength)
      && range.start >= 0
      && range.end >= range.start
      && range.replacementLength >= 0
    ))
    .sort((left, right) => left.start - right.start)
}

function mapBaselineIndexToAfterIndex(
  baselineIndex: number,
  replacementRanges: Array<{ start: number; end: number; replacementLength: number }>,
): number {
  let delta = 0

  for (const range of replacementRanges) {
    if (range.end <= baselineIndex) {
      delta += range.replacementLength - (range.end - range.start)
      continue
    }
    break
  }

  return baselineIndex + delta
}
