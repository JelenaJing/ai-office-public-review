/**
 * 论文生成器 - NFTCORE 完整流程版本
 * 
 * 核心改进：
 * 1. ✅ 动态结构规划（LLM 生成 4-8 个章节）
 * 2. ✅ 生成阶段直接带引用 → 后续增量调整与校验
 * 3. ✅ 每个 section 最多一张图片
 * 4. ✅ LLM 生成详细 caption
 * 5. ✅ 知识树检查（可选）
 * 6. ✅ 全文审查
 */

import type { AppSettings } from './settingsStore'
import { completeText, streamText } from './llmClient'
import { formatReferenceList, searchReferencesWithNftcoreStrategy, type ReferenceItem } from './openAlexClient'
import { parsePaperMarkdownToEmbeddedBlocks, type EmbeddedPayloadBlock } from '../../../src/engines/documentEngine/embeddedPaperDocument'
import { buildGeneratedOoxmlSnapshot } from './generatedOoxmlSnapshot'
import {
  buildConclusionPrompt,
  type CitationMode,
  buildSectionContentPrompt,
  buildSectionThinkingPrompt,
  buildStructureThinkingPrompt,
  buildTitleAbstractPrompt,
  parseTitleAndAbstract,
  shouldDeferReferenceInsertion,
} from './nftcorePromptFactory'

// 导入新模块
import { buildPaperPlanDynamic, type PaperPlan, type SectionPlan } from './paperStructurePlanner'
import { organizeReferencesStream } from './referenceManager'
import { generateSectionFigures, type FigureInfo } from './advancedFigureGenerator'
import { checkKnowledgeTree, reviewFullPaper } from './paperQualityControl'

type ReferenceTargetMode = 'soft' | 'hard'
type ReferencePassMode = 'off' | 'weak' | 'strong'

export interface PaperGenerationParams {
  topic: string
  language: 'zh' | 'en'
  paperType: 'review' | 'research' | 'thesis_research'
  citationMode?: CitationMode
  referenceTargetMode?: ReferenceTargetMode
  yearFrom?: string
  yearTo?: string
  extraContext?: string
  withImages?: boolean
  skipSectionThinking?: boolean
  incrementalReferencePassInterval?: number
  incrementalReferencePassMode?: ReferencePassMode
  finalReferencePassMode?: ReferencePassMode
  finalReferenceVerification?: boolean
  /** 是否启用知识树检查（默认 false） */
  enableKnowledgeTreeCheck?: boolean
  /** 是否启用全文审查（默认 true） */
  enableFullReview?: boolean
}

export interface PaperGenerationResult {
  title: string
  markdown: string
  structuredBlocks: EmbeddedPayloadBlock[]
  ooxmlSnapshot?: Record<string, unknown>
  references: ReferenceItem[]
  images: Array<{ section: string; sectionTitle: string; path: string; caption: string; markdown: string; url: string }>
  steps: Array<{ step: number; message: string }>
  /** 论文计划（动态生成的章节结构） */
  paperPlan?: PaperPlan
  /** 全文审查结果（如果启用） */
  reviewResult?: ReturnType<typeof reviewFullPaper> extends Promise<infer T> ? T : never
}

interface GenerationEvent {
  step: number
  message: string
  eventType?: 'references' | 'image' | 'quality_check' | 'review'
  referenceAction?: 'status' | 'paragraph_analyzed' | 'reference_inserted' | 'complete'
  content?: string
  contentType?: 'thinking' | 'outline' | 'body' | 'final' | 'quality_feedback' | 'review_result'
  cumulativeMarkdown?: string
  structuredBlocks?: EmbeddedPayloadBlock[]
  references?: ReferenceItem[]
  image?: { section: string; path: string; caption?: string }
  paragraphIndex?: number
  citationNumber?: number
  citation?: string
  sentenceText?: string
  updatedParagraph?: string
}

const SECTION_ROLES: Record<string, string> = {
  abstract: '你是一位学术论文摘要写作助手，输出高度凝练、正式、信息密度高的摘要。',
  introduction: '你是一位学术论文引言写作助手，擅长建立研究背景、问题定义与文献缺口。',
  methodology: '你是一位学术论文方法部分写作助手，强调步骤清晰、变量明确、逻辑可复现。',
  results: '你是一位学术论文结果分析助手，强调证据、观察与趋势，不夸大结论。',
  discussion: '你是一位学术论文讨论部分写作助手，强调对比、解释、边界与未来方向。',
  conclusion: '你是一位学术论文结论写作助手，强调简洁总结与贡献收束。',
  review: '你是一位综述论文写作助手，擅长梳理研究脉络、分类框架与趋势判断。',
}

const PAPER_TYPE_EXPERT_ROLES: Record<string, string> = {
  research: 'scientific research paper writing expert',
  review: 'professional academic literature review expert',
  thesis_research: 'academic thesis paper writing expert',
}

function inferRole(sectionName: string, paperType: PaperGenerationParams['paperType']): string {
  const normalized = sectionName.toLowerCase()
  if (normalized.includes('摘要') || normalized.includes('abstract')) return SECTION_ROLES.abstract
  if (normalized.includes('引言') || normalized.includes('introduction')) return SECTION_ROLES.introduction
  if (normalized.includes('实验设备') || normalized.includes('equipment')) return SECTION_ROLES.methodology
  if (normalized.includes('方法') || normalized.includes('method')) return SECTION_ROLES.methodology
  if (normalized.includes('理论') || normalized.includes('theoretical')) return SECTION_ROLES.discussion
  if (normalized.includes('结果') || normalized.includes('result')) return SECTION_ROLES.results
  if (normalized.includes('讨论') || normalized.includes('discussion')) return SECTION_ROLES.discussion
  if (normalized.includes('结论') || normalized.includes('conclusion')) return SECTION_ROLES.conclusion
  if (paperType === 'review') return SECTION_ROLES.review
  return SECTION_ROLES.methodology
}

export function stripMarkdownHeading(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^#{1,6}\s+/.test(line.trim()))
    .join('\n')
    .trim()
}

function stripInlineCitationMarks(text: string): string {
  return String(text || '')
    .split('\n')
    .map((line) => line.replace(/\s*\[(\d+(?:\s*[,-]\s*\d+)*)\]/g, '').replace(/\s{2,}/g, ' ').replace(/[ \t]+([,.;:!?。！？])/g, '$1').trimEnd())
    .join('\n')
    .trim()
}

export function stripAbstractCitationMarks(markdown: string): string {
  return String(markdown || '').replace(/(^|\n)(##\s*(摘要|Abstract)\s*\n)([\s\S]*?)(?=\n##\s+|\n#\s+|$)/i, (_match, prefix, heading, _title, body) => {
    const cleanedBody = stripInlineCitationMarks(String(body || '')).trim()
    return `${prefix}${heading}${cleanedBody}${cleanedBody ? '\n' : ''}`
  })
}

export function normalizeGeneratedTitle(rawText: string, fallback: string): string {
  const cleaned = stripMarkdownHeading(String(rawText || ''))
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^[\s>*-]+/, '')
    .replace(/^(title|标题)\s*[:：-]\s*/i, '')
    .replace(/[\r\t]+/g, ' ')
    .trim()

  const firstMeaningfulLine = cleaned
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean) || String(fallback || '').trim()

  let normalized = firstMeaningfulLine
    .replace(/^['"""'']+|['"""'']+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

  const explanationCue = /(the following|this paper|this review|this study|本文|下文|以下|接下来|introduction will|will outline)/i
  if (explanationCue.test(normalized)) {
    const sentenceSplit = normalized.match(/^(.+?[.!?。！？:：])\s+/)
    if (sentenceSplit?.[1]) {
      normalized = sentenceSplit[1].trim()
    }
  }

  if (!normalized) return String(fallback || '').trim()
  if (normalized.length > 220) {
    const shorter = normalized.split(/[.!?。！？]/)[0]?.trim()
    if (shorter) normalized = shorter
  }

  return normalized || String(fallback || '').trim()
}

export function buildReferenceContext(references: ReferenceItem[], limit = 8): string {
  return references
    .slice(0, limit)
    .map((item, index) => {
      const abstract = String(item.abstract || '').replace(/\s+/g, ' ').trim()
      const abstractSnippet = abstract.length > 220 ? `${abstract.slice(0, 220).trim()}...` : abstract
      return `[${index + 1}] ${item.title} (${item.year ?? 'n.d.'}) ${abstractSnippet}`.trim()
    })
    .join('\n')
}

export function appendMarkdown(current: string, next: string): string {
  return [current, next].filter(Boolean).join('\n\n')
}

function isAbstractSection(sectionTitle: string): boolean {
  const normalized = String(sectionTitle || '').trim().toLowerCase()
  return normalized === '摘要' || normalized === 'abstract'
}

function isTransientGenerationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  const reason = message.toLowerCase()
  return (
    reason.includes('terminated')
    || reason.includes('socket')
    || reason.includes('econnreset')
    || reason.includes('aborted')
    || reason.includes('连接中断')
    || reason.includes('network')
    || reason.includes('fetch failed')
    || reason.includes('timeout')
  )
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export async function retryTransientOperation<T>(operation: () => Promise<T>, attempts = 2): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (attempt >= attempts || !isTransientGenerationError(error)) {
        throw error
      }
      await sleep(1200 * attempt)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'generation failed'))
}

function appendEvent(target: Array<{ step: number; message: string }>, event: GenerationEvent): void {
  const last = target[target.length - 1]
  if (last && last.step === event.step && last.message === event.message) return
  target.push({ step: event.step, message: event.message })
}

function mergeUniqueReferences(...groups: ReferenceItem[][]): ReferenceItem[] {
  const seen = new Set<string>()
  const merged: ReferenceItem[] = []
  for (const group of groups) {
    for (const item of group) {
      const key = `${String(item.doi || '').trim().toLowerCase()}|${String(item.title || '').trim().toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(item)
    }
  }
  return merged
}

function containsCjk(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(String(text || ''))
}

async function buildEnglishReferenceSearchQuery(settings: AppSettings, topic: string): Promise<string | null> {
  if (!containsCjk(topic)) return null
  try {
    const response = await completeText(settings, {
      systemPrompt: 'You rewrite Chinese academic topics into concise English literature search queries. Output one line only.',
      userPrompt: `请将以下中文学术主题改写为适合 OpenAlex 检索的简洁英文 query，保留核心研究对象与任务，不超过 14 个英文单词，不要解释，不要加引号。\n主题：${topic}`,
      temperature: 0.2,
      maxTokens: 60,
    })
    return String(response || '').trim().replace(/[\r\n]+/g, ' ').replace(/^['"]+|['"]+$/g, '').trim() || null
  } catch {
    return null
  }
}

export async function streamPromptText(
  settings: AppSettings,
  input: {
    systemPrompt: string
    userPrompt: string
    temperature?: number
    maxTokens?: number
  },
  onChunk?: (chunk: string, accumulated: string) => void | Promise<void>,
): Promise<string> {
  if (!onChunk) {
    return completeText(settings, input)
  }

  let accumulated = ''
  await streamText(settings, input, async (chunk) => {
    accumulated += chunk
    await onChunk(chunk, accumulated)
  })
  return accumulated
}

/**
 * 生成章节的写作思路
 * 
 * 注意：移植 NFTCORE 后，thinking 更加强调「上下文连贯性」
 */
export async function generateSectionThinking(
  settings: AppSettings,
  params: PaperGenerationParams,
  sectionPlan: SectionPlan,
  existingMarkdown: string,
): Promise<string> {
  const prompt = buildSectionThinkingPrompt({
    topic: params.topic,
    language: params.language,
    paperType: params.paperType,
    extraContext: params.extraContext,
    sectionPlan,
    previousMarkdown: existingMarkdown,
  })

  return completeText(settings, {
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
    temperature: 0.4,
    maxTokens: 1200,
  })
}

function buildSectionLengthInstruction(
  language: PaperGenerationParams['language'],
  wordRange?: { min: number; max: number },
): string {
  if (!wordRange) {
    return language === 'zh' ? '750-1100 字' : '750-1100 words'
  }

  const min = Math.max(60, Math.round(wordRange.min))
  const max = Math.max(min + 20, Math.round(wordRange.max))
  return language === 'zh' ? `${min}-${max} 字` : `${min}-${max} words`
}

/**
 * 生成章节正文（直接带引用）
 * 
 * 当前策略：
 * - 在生成阶段直接要求模型插入 [1] [2] 形式引用
 * - 参考文献整理阶段只做增量修正、补充和编号校验
 */
export async function generateSectionBodyWithCitations(
  settings: AppSettings,
  params: PaperGenerationParams,
  sectionPlan: SectionPlan,
  thinking: string,
  existingMarkdown: string,
  title: string,
  referenceContext: string,
  onChunk?: (chunk: string, accumulated: string) => void,
): Promise<string> {
  const prompt = buildSectionContentPrompt({
    topic: params.topic,
    language: params.language,
    paperType: params.paperType,
    extraContext: params.extraContext,
    sectionPlan,
    previousMarkdown: existingMarkdown,
    title,
    citationMode: params.citationMode,
    referenceContext,
  })

  const userPrompt = thinking.trim()
    ? `${prompt.userPrompt}\n\nPlanning notes for this section:\n${thinking.trim()}`
    : prompt.userPrompt

  return retryTransientOperation(() => streamPromptText(
    settings,
    {
      systemPrompt: prompt.systemPrompt,
      userPrompt,
      temperature: 0.55,
      maxTokens: 2400,
    },
    onChunk,
  ))
}

/**
 * 生成论文 - NFTCORE 完整流程版本
 * 
 * 流程：
 * 1-3. 文献检索
 * 4-5. 动态结构规划（用 LLM 生成 4-8 个 section）
 * 6. 生成 Title
 * 7. 生成 Abstract
 * 8-N. For each section:
 *      - Section Thinking
 *      - Section Text（直接带引用）
 *      - Knowledge Tree Check（可选）
 *      - Generate Figures（单图）
 *      - Incremental Reference Adjustment（每 2 章一次）
 * N+1. 生成 Conclusion（直接带引用）
 * N+2. 最终引用校验与增量调整
 * N+3. 全文审查（可选）
 * N+4. 参考文献落盘
 * N+5. 封装结果
 */
export async function generatePaperNFTCORE(
  settings: AppSettings,
  outputDir: string,
  params: PaperGenerationParams,
  onProgress: (event: GenerationEvent) => void | Promise<void>,
): Promise<PaperGenerationResult> {
  const progressLog: Array<{ step: number; message: string }> = []
  let structuredReferences: ReferenceItem[] = []
  let currentStep = 1

  const emit = async (event: GenerationEvent): Promise<void> => {
    if (event.cumulativeMarkdown && !event.structuredBlocks) {
      event.structuredBlocks = parsePaperMarkdownToEmbeddedBlocks(event.cumulativeMarkdown, { references: structuredReferences })
    }
    appendEvent(progressLog, event)
    await onProgress(event)
  }

  const emitStreamingMarkdownBlock = async (
    step: number,
    baseMarkdown: string,
    blockMarkdown: string,
    previousBody: string,
  ): Promise<string> => {
    if (!blockMarkdown.trim()) return previousBody
    if (!previousBody) {
      await emit({
        step,
        message: '正文生成中',
        content: blockMarkdown,
        contentType: 'body',
        cumulativeMarkdown: appendMarkdown(baseMarkdown, blockMarkdown),
      })
      return blockMarkdown
    }

    if (blockMarkdown.startsWith(previousBody)) {
      const delta = blockMarkdown.slice(previousBody.length)
      if (delta) {
        await emit({
          step,
          message: '正文生成中',
          content: delta,
          contentType: 'body',
          cumulativeMarkdown: appendMarkdown(baseMarkdown, blockMarkdown),
        })
      }
      return blockMarkdown
    }

    await emit({
      step,
      message: '正文生成中',
      content: blockMarkdown,
      contentType: 'body',
      cumulativeMarkdown: appendMarkdown(baseMarkdown, blockMarkdown),
    })
    return blockMarkdown
  }

  // ========== Step 1-3: 文献检索 ==========
  await emit({ step: currentStep++, message: '校验输入并初始化生成会话' })
  await emit({ step: currentStep++, message: '准备文献检索查询' })

  let references: ReferenceItem[] = []
  try {
    references = await searchReferencesWithNftcoreStrategy(settings, {
      topic: params.topic,
      yearFrom: params.yearFrom,
      yearTo: params.yearTo,
      maxResults: settings.defaults.referenceCandidatePoolSize || 100,
    })
    const minimumReferencePool = Math.min(12, Math.max(4, Math.floor((settings.defaults.referenceCandidatePoolSize || 100) / 4)))
    if (references.length < minimumReferencePool) {
      const englishQuery = await buildEnglishReferenceSearchQuery(settings, params.topic)
      if (englishQuery && englishQuery.toLowerCase() !== params.topic.toLowerCase()) {
        const expandedReferences = await searchReferencesWithNftcoreStrategy(settings, {
          topic: englishQuery,
          yearFrom: params.yearFrom,
          yearTo: params.yearTo,
          maxResults: settings.defaults.referenceCandidatePoolSize || 100,
        })
        references = mergeUniqueReferences(references, expandedReferences)
      }
    }
    await emit({ step: currentStep, message: `已检索到 ${references.length} 篇候选文献` })
    await emit({ step: currentStep++, message: `已保存 ${references.length} 篇候选文献到生成上下文`, eventType: 'references', references })
  } catch (error) {
    references = []
    emit({
      step: currentStep++,
      message: `文献检索失败，已跳过并继续生成: ${error instanceof Error ? error.message : String(error)}`,
      eventType: 'references',
      references: [],
    })
  }
  structuredReferences = references
  let organizedReferences = references
  const referenceAnalysisWindow = Math.max(5, settings.defaults.referenceAnalysisWindow || 8)
  const targetReferenceCount = Math.max(1, settings.defaults.referenceCount || 50)
  const referenceSoftFloorPercent = Math.max(0, Math.min(100, settings.defaults.referenceSoftFloorPercent ?? 80))
  const minimumSoftReferenceCount = Math.min(targetReferenceCount, Math.ceil(targetReferenceCount * (referenceSoftFloorPercent / 100)))
  const citationMode: CitationMode = params.citationMode || (shouldDeferReferenceInsertion(params.paperType) ? 'deferred' : 'inline')
  const referenceTargetMode: ReferenceTargetMode = params.referenceTargetMode === 'hard' ? 'hard' : 'soft'
  const incrementalReferencePassMode: ReferencePassMode = params.incrementalReferencePassMode
    || 'off'
  const finalReferencePassMode: ReferencePassMode = params.finalReferencePassMode
    || 'weak'

  const referenceContextLimit = Math.max(8, Math.min(referenceAnalysisWindow, 40, references.length || referenceAnalysisWindow))
  const referenceContext = buildReferenceContext(references, referenceContextLimit)

  const buildReferenceCandidates = (): ReferenceItem[] => {
    const seen = new Set<string>()
    const merged: ReferenceItem[] = []
    for (const item of [...references, ...organizedReferences]) {
      const key = `${String(item.doi || '').trim().toLowerCase()}|${String(item.title || '').trim().toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(item)
    }
    return merged
  }

  const organizeCurrentReferences = async (
    step: number,
    enableVerification = false,
    supplementalMode: ReferencePassMode = 'weak',
  ): Promise<void> => {
    const candidateReferences = buildReferenceCandidates()
    if (candidateReferences.length === 0) {
      emit({
        step,
        message: '当前没有可用文献，跳过引用整理',
        eventType: 'references',
        referenceAction: 'status',
        cumulativeMarkdown: assembledMarkdown,
        references: organizedReferences,
      })
      return
    }

    emit({
      step,
      message: enableVerification
        ? `正在执行最终引用校验与${supplementalMode === 'off' ? '编号整理' : supplementalMode === 'weak' ? '轻量补引' : '增量调整'}`
        : `正在执行阶段性引用${supplementalMode === 'off' ? '编号整理' : supplementalMode === 'weak' ? '轻量调整' : '增量调整'}`,
      eventType: 'references',
      referenceAction: 'status',
      cumulativeMarkdown: assembledMarkdown,
      references: organizedReferences,
    })

    const result = await organizeReferencesStream(
      settings,
      {
        topic: params.topic,
        paperMarkdown: assembledMarkdown,
        references: candidateReferences,
        enableVerification,
        analysisWindowSize: referenceAnalysisWindow,
        targetReferenceCount,
        referenceSoftFloorPercent,
        referenceTargetMode,
        supplementalMode,
      },
      (update) => {
        if (update.type === 'status') {
          emit({
            step,
            message: update.message,
            eventType: 'references',
            referenceAction: 'status',
            cumulativeMarkdown: assembledMarkdown,
            references: organizedReferences,
          })
          return
        }
        if (update.type === 'paragraph_analyzed') {
          emit({
            step,
            message: update.message,
            eventType: 'references',
            referenceAction: 'paragraph_analyzed',
            paragraphIndex: update.paragraphIndex,
            cumulativeMarkdown: assembledMarkdown,
            references: organizedReferences,
          })
          return
        }
        if (update.type === 'reference_inserted') {
          assembledMarkdown = update.currentMarkdown
          organizedReferences = update.references
          structuredReferences = organizedReferences
          emit({
            step,
            message: `已增量调整引用 [${update.citationNumber}]`,
            eventType: 'references',
            referenceAction: 'reference_inserted',
            paragraphIndex: update.paragraphIndex,
            citationNumber: update.citationNumber,
            citation: update.citation,
            sentenceText: update.sentenceText,
            updatedParagraph: update.updatedParagraph,
            references: update.references,
            content: update.currentMarkdown,
            contentType: 'body',
            cumulativeMarkdown: update.currentMarkdown,
          })
          return
        }
        if (update.type === 'complete') {
          assembledMarkdown = update.updatedMarkdown
          organizedReferences = update.referenceList
          structuredReferences = organizedReferences
          emit({
            step,
            message: `引用增量调整完成，共保留 ${update.referenceList.length} 条引用`,
            eventType: 'references',
            referenceAction: 'complete',
            references: update.referenceList,
            cumulativeMarkdown: update.updatedMarkdown,
          })
        }
      },
    )

    assembledMarkdown = result.updatedMarkdown
    // Never allow reference organization to wipe out an existing pool.
    // If organizer returns an empty list, keep the previous references.
    organizedReferences = Array.isArray(result.referenceList) && result.referenceList.length > 0
      ? result.referenceList
      : organizedReferences
    structuredReferences = organizedReferences
  }

  // ========== Step 4-5: 章节结构规划 ==========
  emit({ step: currentStep++, message: params.paperType === 'research' ? '正在应用研究论文固定章节结构' : '正在用 LLM 动态生成论文章节结构' })

  let paperPlan: PaperPlan
  try {
    paperPlan = await buildPaperPlanDynamic(settings, params, references)
    emit({
      step: currentStep++,
      message: `${paperPlan.planMode === 'fixed' ? '章节结构已按固定骨架生成' : '章节结构已动态生成'}，共 ${paperPlan.sections.length} 个章节：${paperPlan.sections.map((s) => s.title).join(' / ')}`,
      content: `**章节结构**:\n${paperPlan.sections.map((s, idx) => `${idx + 1}. ${s.title} (重要性: ${s.importance}/5, 图片: ${s.plannedFigureCount} 张)\n   ${s.description}`).join('\n')}`,
      contentType: 'outline',
    })
  } catch (error) {
    emit({ step: currentStep++, message: `动态结构规划失败，使用固定模板: ${error instanceof Error ? error.message : String(error)}` })
    // 回退到固定模板（已在 buildPaperPlanDynamic 内部处理）
    paperPlan = await buildPaperPlanDynamic(settings, params, references)
  }

  // ========== NFTCORE 风格：全文架构思考 ==========
  const structureThinkingStep = currentStep++
  emit({ step: structureThinkingStep, message: '正在推理全文架构' })
  const structureThinkingPrompt = buildStructureThinkingPrompt({
    topic: params.topic,
    language: params.language,
    paperType: params.paperType,
    extraContext: params.extraContext,
    sections: paperPlan.sections,
  })
  const structureThinking = await completeText(settings, {
    systemPrompt: structureThinkingPrompt.systemPrompt,
    userPrompt: structureThinkingPrompt.userPrompt,
    temperature: 0.4,
    maxTokens: 900,
  })
  emit({
    step: structureThinkingStep,
    message: '全文架构思考已生成',
    content: `\n<thinking section="paper-architecture">\n${structureThinking.trim()}\n</thinking>\n`,
    contentType: 'thinking',
  })

  // ========== Step 6-7: 按 NFTCORE 模板联合生成标题与摘要 ==========
  emit({ step: currentStep++, message: '正在按 NFTCORE 模板生成标题和摘要' })
  const titleAbstractPrompt = buildTitleAbstractPrompt({
    topic: params.topic,
    language: params.language,
    paperType: params.paperType,
    extraContext: params.extraContext,
    sections: paperPlan.sections,
  })
  const titleAbstractMarkdown = await completeText(settings, {
    systemPrompt: titleAbstractPrompt.systemPrompt,
    userPrompt: titleAbstractPrompt.userPrompt,
    temperature: 0.45,
    maxTokens: 1400,
  })
  const parsedTitleAbstract = parseTitleAndAbstract(titleAbstractMarkdown, params.topic, params.language)
  const title = normalizeGeneratedTitle(parsedTitleAbstract.title, params.topic) || params.topic
  const abstract = stripInlineCitationMarks(stripMarkdownHeading(parsedTitleAbstract.abstract))

  let assembledMarkdown = `# ${title}`
  emit({ step: currentStep++, message: '标题已生成', content: `# ${title}`, contentType: 'body', cumulativeMarkdown: assembledMarkdown })

  // ========== Step 7: 写入 Abstract ==========
  emit({ step: currentStep++, message: '摘要已按 NFTCORE 模板生成' })
  const abstractHeading = `## ${params.language === 'zh' ? '摘要' : 'Abstract'}`

  assembledMarkdown = appendMarkdown(assembledMarkdown, `${abstractHeading}\n\n${abstract}`)
  assembledMarkdown = stripAbstractCitationMarks(assembledMarkdown)
  emit({ step: currentStep++, message: '摘要已写入正文', contentType: 'body', cumulativeMarkdown: assembledMarkdown })

  // ========== Step 8-N: 生成各章节（直接带引用） ==========
  const allFigures: FigureInfo[] = []
  const incrementalReferencePassInterval = Math.max(0, params.incrementalReferencePassInterval ?? 0)
  const effectiveIncrementalReferencePassInterval = incrementalReferencePassMode === 'off'
    ? 0
    : incrementalReferencePassInterval
  const totalTargetWords = Math.max(120, settings.defaults.targetWords || 500)
  const estimatedNarrativeSectionCount = Math.max(1, paperPlan.sections.length + 1)
  const sectionWordTarget = Math.max(60, Math.round(totalTargetWords / estimatedNarrativeSectionCount))
  const sectionWordRange = {
    min: Math.max(60, Math.round(sectionWordTarget * 0.75)),
    max: Math.max(90, Math.round(sectionWordTarget * 1.2)),
  }

  for (let sectionIndex = 0; sectionIndex < paperPlan.sections.length; sectionIndex++) {
    const sectionPlan = paperPlan.sections[sectionIndex]
    const sectionNum = sectionIndex + 1

    // 生成章节 Thinking
    const thinkingStep = currentStep++
    let thinking = ''
    if (params.skipSectionThinking) {
      await emit({ step: thinkingStep, message: `章节 ${sectionPlan.title} 跳过写作思路生成（fast smoke）` })
    } else {
      await emit({ step: thinkingStep, message: `正在推理章节：${sectionPlan.title}` })
      thinking = await retryTransientOperation(() => generateSectionThinking(settings, params, sectionPlan, assembledMarkdown))
      await emit({
        step: thinkingStep,
        message: `章节 ${sectionPlan.title} 的写作思路已生成`,
        content: `\n<thinking section="${sectionPlan.title}">\n${thinking}\n</thinking>\n`,
        contentType: 'thinking',
        cumulativeMarkdown: assembledMarkdown,
      })
    }

    // 生成章节文字（直接带引用）
    const writingStep = currentStep++
  await emit({ step: writingStep, message: `正在生成章节正文：${sectionPlan.title}${citationMode === 'inline' ? '（边写边引）' : '（先写后引）'}` })
    const sectionBaseMarkdown = assembledMarkdown
    let streamedSectionBlock = ''
    const content = await generateSectionBodyWithCitations(
      settings,
      params,
      sectionPlan,
      thinking,
      sectionBaseMarkdown,
      title,
      referenceContext,
      async (_chunk, accumulated) => {
        const blockMarkdown = `## ${sectionPlan.title}\n\n${stripMarkdownHeading(accumulated)}`.trim()
        streamedSectionBlock = await emitStreamingMarkdownBlock(writingStep, sectionBaseMarkdown, blockMarkdown, streamedSectionBlock)
      },
    )
    const normalized = `## ${sectionPlan.title}\n\n${stripMarkdownHeading(content)}`
    assembledMarkdown = appendMarkdown(sectionBaseMarkdown, normalized)
    await emit({ step: writingStep, message: `章节 ${sectionPlan.title} 已完成`, contentType: 'body', cumulativeMarkdown: assembledMarkdown })

    // 知识树检查（可选）
    if (params.enableKnowledgeTreeCheck) {
      const checkStep = currentStep++
      await emit({ step: checkStep, message: `正在验证章节 ${sectionPlan.title} 的内容准确性` })
      try {
        const checkResult = await checkKnowledgeTree(settings, content, sectionPlan.title, params.topic, params.language)
        await emit({
          step: checkStep,
          message: checkResult.passed ? `章节 ${sectionPlan.title} 通过知识树检查` : `章节 ${sectionPlan.title} 知识树检查有建议`,
          eventType: 'quality_check',
          content: `**检查结果**: ${checkResult.feedback}\n**建议**: ${checkResult.suggestions.join('; ')}`,
          contentType: 'quality_feedback',
        })
      } catch (error) {
        await emit({ step: checkStep, message: `章节 ${sectionPlan.title} 知识树检查失败，已跳过` })
      }
    }

    // 生成图片（每节最多一张）
    if (params.withImages && sectionPlan.plannedFigureCount > 0 && !isAbstractSection(sectionPlan.title)) {
      const imageStep = currentStep++
      await emit({ step: imageStep, message: `正在为章节 ${sectionPlan.title} 生成图片` })

      try {
        const figures = await generateSectionFigures(
          settings,
          outputDir,
          {
            topic: params.topic,
            sectionNum,
            sectionTitle: sectionPlan.title,
            sectionText: content,
            plannedFigureCount: 1,
            language: params.language,
          },
          (message) => emit({ step: imageStep, message }),
        )

        // 将图片 markdown 添加到论文中
        for (const figure of figures) {
          assembledMarkdown = appendMarkdown(assembledMarkdown, figure.markdown)
          allFigures.push(figure)
          await emit({
            step: imageStep,
            message: `章节 ${sectionPlan.title} 图片已生成`,
            eventType: 'image',
            image: { section: sectionPlan.title, path: figure.localPath, caption: figure.caption },
            content: figure.markdown,
            contentType: 'body',
            cumulativeMarkdown: assembledMarkdown,
          })
        }

        await emit({ step: imageStep, message: `章节 ${sectionPlan.title} 图片生成完成（${figures.length} 张）` })
      } catch (error) {
        await emit({ step: imageStep, message: `章节 ${sectionPlan.title} 图片生成失败: ${error instanceof Error ? error.message : String(error)}` })
      }
    }

    const shouldRunIncrementalReferencePass =
      effectiveIncrementalReferencePassInterval > 0
      && sectionIndex < paperPlan.sections.length - 1
      && (sectionIndex + 1) % effectiveIncrementalReferencePassInterval === 0
    if (shouldRunIncrementalReferencePass) {
      await organizeCurrentReferences(writingStep, false, incrementalReferencePassMode)
    } else {
      await emit({
        step: writingStep,
        message: `章节 ${sectionPlan.title} 已完成，${citationMode === 'inline' ? '保留正文流式输出，不做章节后强制补引' : '引用整理延后到后续阶段'}`,
        eventType: 'references',
        referenceAction: 'status',
        cumulativeMarkdown: assembledMarkdown,
        references: organizedReferences,
      })
    }
  }

  // ========== Step N+1: 生成 Conclusion（直接带引用） ==========
  const conclusionStep = currentStep++
  await emit({ step: conclusionStep, message: params.skipSectionThinking ? '结论章节跳过写作思路生成（fast smoke）' : '正在推理结论章节' })
  const conclusionTitle = params.language === 'zh' ? '结论' : 'Conclusion'

  const conclusionThinking = params.skipSectionThinking
    ? ''
    : await retryTransientOperation(() => generateSectionThinking(
      settings,
      params,
      { title: conclusionTitle, description: 'Summarize the paper and provide future directions', importance: 4, plannedFigureCount: 0 },
      assembledMarkdown,
    ))
  if (!params.skipSectionThinking) {
    await emit({
      step: conclusionStep,
      message: '结论写作思路已生成',
      content: `\n<thinking section="${conclusionTitle}">\n${conclusionThinking}\n</thinking>\n`,
      contentType: 'thinking',
      cumulativeMarkdown: assembledMarkdown,
    })
  }

  const conclusionWritingStep = currentStep++
  await emit({ step: conclusionWritingStep, message: `正在生成结论章节${citationMode === 'inline' ? '（边写边引）' : '（先写后引）'}` })
  const conclusionBaseMarkdown = assembledMarkdown
  const conclusionPrompt = buildConclusionPrompt({
    topic: params.topic,
    language: params.language,
    paperType: params.paperType,
    extraContext: params.extraContext,
    previousMarkdown: conclusionBaseMarkdown,
    title,
    citationMode,
    referenceContext,
  })
  const conclusionUserPrompt = conclusionThinking.trim()
    ? `${conclusionPrompt.userPrompt}\n\nPlanning notes for this conclusion:\n${conclusionThinking.trim()}`
    : conclusionPrompt.userPrompt
  let streamedConclusionBlock = ''
  const conclusionBody = await retryTransientOperation(() => streamPromptText(
    settings,
    {
      systemPrompt: conclusionPrompt.systemPrompt,
      userPrompt: conclusionUserPrompt,
      temperature: 0.5,
      maxTokens: 1200,
    },
    async (_chunk, accumulated) => {
      const blockMarkdown = `## ${conclusionTitle}\n\n${stripMarkdownHeading(accumulated)}`.trim()
      streamedConclusionBlock = await emitStreamingMarkdownBlock(conclusionWritingStep, conclusionBaseMarkdown, blockMarkdown, streamedConclusionBlock)
    },
  ))
  const normalizedConclusion = `## ${conclusionTitle}\n\n${stripMarkdownHeading(conclusionBody)}`
  assembledMarkdown = appendMarkdown(conclusionBaseMarkdown, normalizedConclusion)
  await emit({ step: conclusionWritingStep, message: '结论章节已完成', contentType: 'body', cumulativeMarkdown: assembledMarkdown })

  // ========== Step N+2: 最终引用校验与增量调整 ==========
  const referenceAdjustmentStep = currentStep++
  const finalReferencePassModeEffective: ReferencePassMode = finalReferencePassMode === 'off'
    && referenceTargetMode === 'soft'
    && minimumSoftReferenceCount > 0
    ? 'weak'
    : finalReferencePassMode
  await organizeCurrentReferences(
    referenceAdjustmentStep,
    params.finalReferenceVerification !== false,
    finalReferencePassModeEffective,
  )
  assembledMarkdown = stripAbstractCitationMarks(assembledMarkdown)
  if (
    referenceTargetMode === 'hard'
    && minimumSoftReferenceCount > 0
    && organizedReferences.length < minimumSoftReferenceCount
    && finalReferencePassModeEffective !== 'strong'
  ) {
    await emit({
      step: referenceAdjustmentStep,
      message: `最终引用数 ${organizedReferences.length} 仍低于 soft 下限 ${minimumSoftReferenceCount}，正在执行一次增强补引`,
      eventType: 'references',
      referenceAction: 'status',
      cumulativeMarkdown: assembledMarkdown,
      references: organizedReferences,
    })
    await organizeCurrentReferences(
      referenceAdjustmentStep,
      params.finalReferenceVerification !== false,
      'strong',
    )
    assembledMarkdown = stripAbstractCitationMarks(assembledMarkdown)
  }

  // ========== Step N+3: 全文审查 ==========
  let reviewResult: Awaited<ReturnType<typeof reviewFullPaper>> | undefined
  if (params.enableFullReview !== false) {
    const reviewStep = currentStep++
    await emit({ step: reviewStep, message: '正在进行全文审查' })
    try {
      reviewResult = await reviewFullPaper(settings, assembledMarkdown, params.topic, params.paperType, params.language)
      await emit({
        step: reviewStep,
        message: `全文审查完成，总体评分：${reviewResult.overallScore}/5`,
        eventType: 'review',
        content: `**评分**: ${reviewResult.overallScore}/5\n**反馈**: ${reviewResult.feedback}\n**强项**: ${reviewResult.strengths.join('; ')}\n**弱项**: ${reviewResult.weaknesses.join('; ')}\n**建议**: ${reviewResult.suggestions.join('; ')}`,
        contentType: 'review_result',
      })
    } catch (error) {
      await emit({ step: reviewStep, message: `全文审查失败: ${error instanceof Error ? error.message : String(error)}` })
    }
  }

  // ========== Step N+4: 参考文献落盘 ==========
  const referencesStep = currentStep++
  const referencesTitle = params.language === 'zh' ? '参考文献' : 'References'
  const referencesMarkdown = formatReferenceList(organizedReferences)
  assembledMarkdown = stripAbstractCitationMarks(assembledMarkdown)
  assembledMarkdown = appendMarkdown(assembledMarkdown, `## ${referencesTitle}\n\n${referencesMarkdown}`)
  structuredReferences = organizedReferences
  await emit({
    step: referencesStep,
    message: '参考文献已整理完成',
    content: `## ${referencesTitle}\n\n${referencesMarkdown}`,
    contentType: 'body',
    eventType: 'references',
    referenceAction: 'complete',
    references: organizedReferences,
    cumulativeMarkdown: assembledMarkdown,
  })

  // ========== Step N+5: 封装结果 ==========
  const finalizationStep = currentStep++
  await emit({ step: finalizationStep, message: '正在封装最终论文产物', content: assembledMarkdown, contentType: 'final', cumulativeMarkdown: assembledMarkdown })

  const finalStructuredBlocks = parsePaperMarkdownToEmbeddedBlocks(assembledMarkdown, { references: structuredReferences })
  const ooxmlSnapshot = await buildGeneratedOoxmlSnapshot(finalStructuredBlocks as never)

  return {
    title,
    markdown: assembledMarkdown,
    structuredBlocks: finalStructuredBlocks,
    ooxmlSnapshot: ooxmlSnapshot as unknown as Record<string, unknown>,
    references: organizedReferences,
    images: allFigures.map((fig) => ({
      section: fig.sectionNum.toString(),
      sectionTitle: fig.sectionTitle,
      path: fig.localPath,
      caption: fig.caption,
      markdown: fig.markdown,
      url: fig.url,
    })),
    steps: progressLog,
    paperPlan,
    reviewResult,
  }
}
