// ---------------------------------------------------------------------------
// regionLocatorService.ts — 区域定位服务
// ---------------------------------------------------------------------------
// 职责：将 OOXML blocks 划分为 TemplateRegion[]。
//
// V1 检测策略（优先级从高到低）：
//   1. heading-section：按 heading 层级自动划分
//      每个 heading block 开始一个新 region，直到下一个同级或更高级 heading
//   2. placeholder-block：整个 block 只包含 {{...}} 的独立占位区域
//
// V1.1 预留：
//   3. content-control：w:sdt 包裹区域
//   4. bookmark：w:bookmarkStart / End 标记区域
//
// 输入：OoxmlBlockSnapshot[]
// 输出：TemplateRegion[]
// ---------------------------------------------------------------------------

import type { OoxmlBlockSnapshot } from '../documentEngineService'
import type { TemplateRegion, OoxmlBlockRef, RegionDetectionKind } from '../../../../src/types/templateGeneration'

// ---- 配置 ----

const PLACEHOLDER_ONLY_PATTERN = /^\s*\{\{[^}]+\}\}\s*$/

// ---- 对外 API ----

/**
 * locateRegions — 从 blocks 中定位所有区域
 *
 * 算法：
 *   1. 扫描所有 heading blocks，建立 section 边界
 *   2. 每个 section = 连续 blockRange
 *   3. section 内检测是否为空/纯占位 → llmWritable=true
 *   4. 非 heading 覆盖的 blocks 合并为默认 "前言区" 或尾部区
 */
export function locateRegions(blocks: OoxmlBlockSnapshot[]): TemplateRegion[] {
  if (blocks.length === 0) return []

  const regions: TemplateRegion[] = []

  // 找所有 heading 位置
  const headingIndices: number[] = []
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].kind === 'heading') {
      headingIndices.push(i)
    }
  }

  // 如果没有 heading，整个文档作为一个区域
  if (headingIndices.length === 0) {
    regions.push(buildRegion(
      blocks,
      0,
      blocks.length,
      '全文区域',
      'heading-section',
      true,   // llmWritable
      false,  // shellLocked
    ))
    return regions
  }

  // heading 之前的前导区（如果有内容）
  if (headingIndices[0] > 0) {
    const preambleHasContent = blocks.slice(0, headingIndices[0]).some((b) => b.text.trim().length > 0)
    regions.push(buildRegion(
      blocks,
      0,
      headingIndices[0],
      '文档前言',
      'heading-section',
      preambleHasContent,    // 有内容时可写
      !preambleHasContent,   // 空前言不锁定（允许填入）
    ))
  }

  // 按 heading 划分 sections
  for (let hi = 0; hi < headingIndices.length; hi++) {
    const start = headingIndices[hi]
    const end = hi + 1 < headingIndices.length ? headingIndices[hi + 1] : blocks.length
    const headingBlock = blocks[start]
    const label = headingBlock.text.trim() || `区域 ${hi + 1}`

    // 判断 section 内正文是否为空或纯占位
    const bodyBlocks = blocks.slice(start + 1, end)
    const bodyIsEmpty = bodyBlocks.every((b) => !b.text.trim())
    const bodyIsPlaceholderOnly = bodyBlocks.length > 0 && bodyBlocks.every((b) => PLACEHOLDER_ONLY_PATTERN.test(b.text))

    regions.push(buildRegion(
      blocks,
      start,
      end,
      label,
      'heading-section',
      true,                     // heading sections 默认 llmWritable
      bodyIsEmpty && !bodyIsPlaceholderOnly,  // 空的纯标题壳 → shellLocked
    ))
  }

  return regions
}

/**
 * classifyBlockEditability — 给出每个 block 的可编辑性分类
 * 返回 Set<number>，包含所有属于 llmWritable region 的 block 下标
 */
export function collectEditableBlockIndices(regions: TemplateRegion[]): Set<number> {
  const indices = new Set<number>()
  for (const region of regions) {
    if (region.llmWritable && !region.shellLocked) {
      for (let i = region.blockRange.start; i < region.blockRange.end; i++) {
        indices.add(i)
      }
    }
  }
  return indices
}

// ---- 内部工具 ----

function buildRegion(
  blocks: OoxmlBlockSnapshot[],
  start: number,
  end: number,
  label: string,
  detectionKind: RegionDetectionKind,
  llmWritable: boolean,
  shellLocked: boolean,
): TemplateRegion {
  const regionBlocks = blocks.slice(start, end)
  return {
    regionId: `region-${start}-${end}`,
    label,
    detectionKind,
    blockRange: { start, end },
    originalText: regionBlocks.map((b) => b.text).join('\n'),
    blockRefs: regionBlocks.map((b) => toBlockRef(b)),
    llmWritable,
    shellLocked,
  }
}

function toBlockRef(block: OoxmlBlockSnapshot): OoxmlBlockRef {
  return {
    index: block.index,
    kind: block.kind,
    text: block.text,
    level: block.level,
    sourceId: block.sourceId,
  }
}
