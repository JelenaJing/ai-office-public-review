// ---------------------------------------------------------------------------
// regionGenerationService.ts — 区域候选正文生成服务
// ---------------------------------------------------------------------------
// 职责：只为 llmWritable && !shellLocked 的区域生成局部候选正文。
//
// 与自由写作模式的差异：
//   - 不输出完整文档，只输出指定区域的段落文本
//   - prompt 约束区域边界，禁止 LLM 生成 region 外内容
//   - 支持流式输出（通过 onChunk 回调）
//   - 不走 runKnowledgeTemplateWritingAssistant，不走 runWritingAssistant
//
// 现有复用：
//   - llmClient.streamText / completeText — LLM 调用
//   - knowledgeRetrievalService.retrieveChunks — 参考材料检索
// ---------------------------------------------------------------------------

import type { AppSettings } from '../settingsStore'
import type { TemplateRegion, FieldValue, RegionGenerationPlan, FieldSchema, RegionGenerationContract } from '../../../../src/types/templateGeneration'
import type { KnowledgeRetrievalResult } from '../../../../src/types/knowledge'
import { streamText, completeText, type PromptInput } from '../llmClient'

// ---- 公共类型 ----

export interface RegionGenerationInput {
  region: TemplateRegion
  plan: RegionGenerationPlan
  /** 模板标题（提供全局上下文） */
  templateTitle: string
  /** 用户主指令 */
  instruction: string
  /** 已确认的字段值（提供跨区域上下文） */
  fieldValues: FieldValue[]
  /** 字段定义（用于 label 查找） */
  fieldSchemas: FieldSchema[]
  /** 周边区域摘要（上一个 + 下一个 region 的 originalText 截断） */
  neighborContext?: string
  /** 参考材料检索结果 */
  retrievalResult?: KnowledgeRetrievalResult
  /** 样本文档中该区域的已有文本（few-shot） */
  sampleTexts?: string[]
}

export interface RegionGenerationOutput {
  regionId: string
  candidateText: string
  promptStrategy: string
  tokenEstimate?: number
}

// ---- 对外 API ----

/**
 * generateRegionCandidate — 为单个区域生成候选正文（流式）
 */
export async function generateRegionCandidate(
  settings: AppSettings,
  input: RegionGenerationInput,
  onChunk?: (chunk: string) => void,
): Promise<RegionGenerationOutput> {
  const prompt = buildRegionPrompt(input)

  let candidateText: string
  try {
    if (onChunk) {
      candidateText = await streamText(settings, prompt, onChunk)
    } else {
      candidateText = await completeText(settings, prompt)
    }
  } catch (error) {
    const fallbackText = String(input.plan.contract?.fallbackText || '').trim()
    if (!fallbackText) throw error
    candidateText = fallbackText
  }

  if (!candidateText.trim()) {
    const fallbackText = String(input.plan.contract?.fallbackText || '').trim()
    if (fallbackText) candidateText = fallbackText
  }

  return {
    regionId: input.region.regionId,
    candidateText: candidateText.trim(),
    promptStrategy: input.plan.promptStrategy,
  }
}

/**
 * buildRegionPrompt — 构建区域生成 prompt
 * 公开暴露以便单元测试
 */
export function buildRegionPrompt(input: RegionGenerationInput): PromptInput {
  const { region, plan, templateTitle, instruction, fieldValues, fieldSchemas, neighborContext, retrievalResult, sampleTexts } = input

  const fieldContext = fieldValues
    .filter((fv) => fv.confirmed && fv.value.trim())
    .map((fv) => {
      const schema = fieldSchemas.find((f) => f.fieldId === fv.fieldId)
      return `${schema?.label || fv.fieldId}: ${fv.value}`
    })
    .join('\n')

  const referenceContext = retrievalResult?.hits
    .slice(0, 8)
    .map((hit: any, i: number) => `[参考 ${i + 1}] ${hit.chunk.text.slice(0, 500)}`)
    .join('\n\n') || ''

  const sampleContext = (sampleTexts || [])
    .slice(0, 2)
    .map((text, i) => `[样本 ${i + 1}] ${text.slice(0, 800)}`)
    .join('\n\n') || ''

  const contractSections = buildContractPromptSections(plan.contract)

  const systemPrompt = [
    '你是一位正式文档区域填写助手。',
    '你只负责生成指定区域的内容，不要生成区域外的任何内容。',
    '不要输出标题行（标题已存在于模板中）。',
    '不要输出分析过程、解释或元信息。',
    '直接输出该区域应有的正文段落。',
    plan.promptStrategy === 'fill-field' ? '当前为字段填充模式，输出应简洁精准。' : '',
    plan.promptStrategy === 'rewrite-body' ? '当前为正文改写模式，请保持与原文相同的结构和语气，替换具体内容。' : '',
    contractSections.systemPrompt ? `补充约束：\n${contractSections.systemPrompt}` : '',
  ].filter(Boolean).join('\n')

  const userPrompt = [
    `文档标题: ${templateTitle}`,
    `区域名称: ${region.label}`,
    instruction ? `用户要求: ${instruction}` : '',
    fieldContext ? `已确认字段:\n${fieldContext}` : '',
    neighborContext ? `周边上下文:\n${neighborContext}` : '',
    region.originalText.trim() ? `区域原始内容:\n${region.originalText.slice(0, 1500)}` : '（该区域当前为空，请生成新内容）',
    contractSections.userPrompt ? `区域合同:\n${contractSections.userPrompt}` : '',
    referenceContext ? `参考材料:\n${referenceContext}` : '',
    sampleContext ? `样本参考:\n${sampleContext}` : '',
    '请输出该区域的完整正文内容:',
  ].filter(Boolean).join('\n\n')

  return {
    systemPrompt,
    userPrompt,
    temperature: plan.promptStrategy === 'fill-field' ? 0.2 : 0.4,
    maxTokens: plan.promptStrategy === 'fill-field' ? 500 : 2000,
  }
}

function buildContractPromptSections(contract?: RegionGenerationContract): { systemPrompt: string; userPrompt: string } {
  if (!contract) return { systemPrompt: '', userPrompt: '' }

  const systemLines = (contract.styleConstraints || [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .map((item) => `- ${item}`)

  const userLines: string[] = []
  if (contract.templateKind) userLines.push(`模板类型: ${contract.templateKind}`)
  if (contract.contextSummary) userLines.push(`结构化事实:\n${contract.contextSummary}`)
  if (typeof contract.paragraphTarget === 'number' && Number.isFinite(contract.paragraphTarget) && contract.paragraphTarget > 0) {
    userLines.push(`目标段落数: ${contract.paragraphTarget}`)
  }
  if (Array.isArray(contract.paragraphInstructions) && contract.paragraphInstructions.length > 0) {
    userLines.push(`建议段落职责:\n${contract.paragraphInstructions.map((item, index) => `${index + 1}. ${item}`).join('\n')}`)
  }
  if (Array.isArray(contract.mustInclude) && contract.mustInclude.length > 0) {
    userLines.push(`必须覆盖:\n${contract.mustInclude.map((item) => `- ${item}`).join('\n')}`)
  }
  if (Array.isArray(contract.avoidPhrases) && contract.avoidPhrases.length > 0) {
    userLines.push(`避免出现:\n${contract.avoidPhrases.map((item) => `- ${item}`).join('\n')}`)
  }

  return {
    systemPrompt: systemLines.join('\n'),
    userPrompt: userLines.join('\n\n'),
  }
}
