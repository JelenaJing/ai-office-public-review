import type { AppSettings } from './settingsStore'
import { completeText, streamText } from './llmClient'
import { formatReferenceList, searchReferencesWithNftcoreStrategy, type ReferenceItem } from './openAlexClient'
import { generateImage } from './imageClient'
import { organizeReferencesStream } from './referenceManager'
import { parsePaperMarkdownToEmbeddedBlocks, type EmbeddedPayloadBlock } from '../../../src/engines/documentEngine/embeddedPaperDocument'
import { resolveArticleBlueprint } from '../../../src/services/ArticleClassificationService'
import { buildGeneratedOoxmlSnapshot } from './generatedOoxmlSnapshot'
import { generatePaperNFTCORE } from './paperGeneratorNFTCORE'
import type { DocumentSchema } from '../../../src/document/schema/index'

export interface PaperGenerationParams {
  topic: string
  language: 'zh' | 'en'
  paperType: 'review' | 'research' | 'thesis_research'
  citationMode?: 'deferred' | 'inline'
  referenceTargetMode?: 'soft' | 'hard'
  yearFrom?: string
  yearTo?: string
  extraContext?: string
  withImages?: boolean
  skipSectionThinking?: boolean
  incrementalReferencePassInterval?: number
  incrementalReferencePassMode?: 'off' | 'weak' | 'strong'
  finalReferencePassMode?: 'off' | 'weak' | 'strong'
  finalReferenceVerification?: boolean
  enableKnowledgeTreeCheck?: boolean
  enableFullReview?: boolean
  workspacePath?: string
}

export interface PaperGenerationResult {
  title: string
  markdown: string
  structuredBlocks: EmbeddedPayloadBlock[]
  ooxmlSnapshot?: Record<string, unknown>
  references: ReferenceItem[]
  images: Array<{ section: string; path: string; sectionTitle?: string; caption?: string; markdown?: string; url?: string }>
  steps: Array<{ step: number; message: string }>
  /** 规范化后的 DocumentSchema（权威文档结构，包含 blocks/resources/citations） */
  documentSchema?: DocumentSchema
}

export interface WritingAssistantParams {
  instruction: string
  documentText?: string
  language?: 'zh' | 'en'
  outputLanguage?: 'zh-CN' | 'en-US'
  extraContext?: string
  generationMode?: 'default' | 'knowledge-template-document'
  templateDocument?: {
    title?: string
    sourceType?: string
    extractedText?: string
    outline?: string[]
  }
}

interface GenerationEvent {
  step: number
  message: string
  eventType?: 'references' | 'image'
  referenceAction?: 'status' | 'paragraph_analyzed' | 'reference_inserted' | 'complete'
  content?: string
  contentType?: 'thinking' | 'outline' | 'body' | 'final'
  cumulativeMarkdown?: string
  structuredBlocks?: EmbeddedPayloadBlock[]
  references?: ReferenceItem[]
  image?: { section: string; path: string; placeholder?: boolean }
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

function toFileUrl(localPath: string): string {
  const normalized = String(localPath || '').replace(/\\/g, '/')
  const encoded = encodeURI(normalized)
  if (!normalized) return normalized
  if (encoded.startsWith('/')) return `file://${encoded}`
  if (/^[a-zA-Z]:\//.test(encoded)) return `file:///${encoded}`
  return `file:///${encoded}`
}

function encodeInlineSvg(svg: string): string {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}

function normalizeTemplateOutline(lines: string[] | undefined): string[] {
  if (!Array.isArray(lines)) return []
  return lines
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .slice(0, 10)
}

function normalizeTemplateDocument(templateDocument: WritingAssistantParams['templateDocument']) {
  if (!templateDocument) return null

  const extractedText = String(templateDocument.extractedText || '').trim()
  if (!extractedText) return null

  return {
    title: String(templateDocument.title || '未命名模板').trim() || '未命名模板',
    sourceType: String(templateDocument.sourceType || '').trim().toUpperCase(),
    extractedText: extractedText.slice(0, 16000),
    outline: normalizeTemplateOutline(templateDocument.outline),
  }
}

function resolveOutputLanguage(params: Pick<WritingAssistantParams, 'outputLanguage' | 'language'>): 'zh-CN' | 'en-US' {
  if (params.outputLanguage === 'en-US') return 'en-US'
  if (params.outputLanguage === 'zh-CN') return 'zh-CN'
  return params.language === 'en' ? 'en-US' : 'zh-CN'
}

function getLanguagePreferenceLabel(outputLanguage: 'zh-CN' | 'en-US'): string {
  return outputLanguage === 'en-US' ? 'English' : '简体中文'
}

function buildOutputLanguageRequirement(outputLanguage: 'zh-CN' | 'en-US'): string {
  if (outputLanguage === 'en-US') {
    return [
      '输出语言要求：',
      '- 用户已明确要求英文输出，请使用英文完成全文生成。',
      '- 不要在正文中出现 English:、Chinese: 等语言标签。',
    ].join('\n')
  }

  return [
    '输出语言要求：',
    '- 默认使用简体中文。',
    '- 如果用户没有明确要求英文，请不要输出英文。',
    '- 如果用户输入的是中文，请使用中文完成全文生成。',
    '- 标题、正文、段落、小节、总结都必须使用中文。',
    '- 不要在正文中出现 English:、Chinese: 等语言标签。',
  ].join('\n')
}

async function analyzeKnowledgeTemplate(
  settings: AppSettings,
  templateDocument: NonNullable<ReturnType<typeof normalizeTemplateDocument>>,
  instruction: string,
  outputLanguage: 'zh-CN' | 'en-US',
  onStatus?: (message: string) => void,
): Promise<string> {
  onStatus?.('正在分析知识库模板的结构与风格...')

  return completeText(settings, {
    systemPrompt: '你是一位资深文档模板分析师。你的任务是从给定模板中提炼可复用的结构、语气、格式和表达约束，用于指导另一篇新文档写作。只输出模板分析结果，不要代写正文，不要复述无关原文。',
    userPrompt: [
      '请分析下面这份知识库模板文档，并输出一份可直接用于全文写作的模板分析报告。',
      `语言偏好: ${getLanguagePreferenceLabel(outputLanguage)}`,
      buildOutputLanguageRequirement(outputLanguage),
      instruction ? `新任务要求: ${instruction}` : '',
      `模板标题: ${templateDocument.title}`,
      templateDocument.sourceType ? `模板来源: ${templateDocument.sourceType}` : '',
      templateDocument.outline.length
        ? `模板章节线索:\n${templateDocument.outline.map((line, index) => `${index + 1}. ${line}`).join('\n')}`
        : '',
      '请按下面格式输出，且每一节都要结合模板内容给出具体结论：',
      '## 篇章骨架\n说明模板常见的章节顺序、层级深度、每章承担的任务。',
      '## 行文风格\n说明语气、句式长度、信息密度、常见过渡方式、偏好的表达习惯。',
      '## 格式与呈现约束\n说明标题风格、段落组织、列表/表格/小结的使用习惯、是否偏好先总后分。',
      '## 生成时应保留的写法\n列出 5-8 条应继承的写法原则。',
      '## 生成时必须替换的旧信息\n列出必须避免照抄的主题、事实、数据、时间、机构、结论等旧内容类别。',
      `模板正文:\n${templateDocument.extractedText}`,
    ].filter(Boolean).join('\n\n'),
    temperature: 0.3,
    maxTokens: 2200,
  })
}

async function runKnowledgeTemplateWritingAssistant(
  settings: AppSettings,
  params: WritingAssistantParams,
  onChunk: (chunk: string) => void,
  onStatus?: (message: string) => void,
): Promise<string> {
  const documentText = String(params.documentText || '').trim()
  const instruction = String(params.instruction || '').trim()
  const extraContext = String(params.extraContext || '').trim()
  const outputLanguage = resolveOutputLanguage(params)
  const templateDocument = normalizeTemplateDocument(params.templateDocument)

  if (!templateDocument) {
    throw new Error('知识库模板缺少可分析的正文内容')
  }

  const templateAnalysis = await analyzeKnowledgeTemplate(settings, templateDocument, instruction, outputLanguage, onStatus)
  onStatus?.('正在结合模板分析结果生成全文...')
  const languageRequirement = buildOutputLanguageRequirement(outputLanguage)

  return streamText(
    settings,
    {
      systemPrompt:
        `你是一位专业全文写作助手。你必须先严格遵循提供的模板分析结果，再结合用户要求和已有文稿生成一篇全新的完整正文。输出只能是最终正文，不要解释，不要输出分析过程，不要复述模板原文。若原文为空，则直接起草完整新文，正文第一行必须是一级标题（Markdown 格式：\`# 文章标题\`）；若原文不为空，则将其重写为符合模板风格的新全文。\n\n${languageRequirement}`,
      userPrompt: [
        '请基于知识库模板分析结果生成全文。',
        `语言偏好: ${getLanguagePreferenceLabel(outputLanguage)}`,
        languageRequirement,
        `用户要求:\n${instruction}`,
        extraContext ? `补充上下文:\n${extraContext}` : '',
        `模板分析结果:\n${templateAnalysis}`,
        documentText
          ? `当前文档全文:\n${documentText}\n\n请输出一篇参考模板格式与风格、但内容围绕当前要求重新生成的完整正文。`
          : '当前文档为空，请直接围绕用户要求输出一篇参考模板格式与风格的完整正文。',
      ].filter(Boolean).join('\n\n'),
      temperature: 0.5,
      maxTokens: 4200,
    },
    onChunk,
  )
}

function buildImagePlaceholderMarkdown(section: string, index: number): { id: string; markdown: string } {
  const safeSection = String(section || '').trim() || `Section ${index + 1}`
  const id = `ai-office-image-placeholder-${index + 1}`
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="680" viewBox="0 0 1200 680">
      <rect width="1200" height="680" rx="28" fill="#f6f7fb"/>
      <rect x="28" y="28" width="1144" height="624" rx="22" fill="#eef2ff" stroke="#c7d2fe" stroke-width="4" stroke-dasharray="18 14"/>
      <circle cx="148" cy="140" r="34" fill="#c7d2fe"/>
      <path d="M234 450l132-148 118 104 152-168 182 212H234z" fill="#c7d2fe" opacity="0.8"/>
      <text x="600" y="250" text-anchor="middle" font-family="Arial, sans-serif" font-size="40" font-weight="700" fill="#334155">Image generating</text>
      <text x="600" y="310" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" fill="#475569">${escapeXml(safeSection)}</text>
      <text x="600" y="356" text-anchor="middle" font-family="Arial, sans-serif" font-size="20" fill="#64748b">The final figure will replace this placeholder in place.</text>
    </svg>
  `.replace(/\n\s+/g, ' ').trim()
  const src = encodeInlineSvg(svg)
  return {
    id,
    markdown: `![${safeSection} image generating](${src} "${id}")`,
  }
}

function replaceExactSegment(source: string, target: string, replacement: string): string {
  if (!target) return source
  const index = source.indexOf(target)
  if (index === -1) return source
  return `${source.slice(0, index)}${replacement}${source.slice(index + target.length)}`
}

function escapeXml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildOutlinePrompt(params: PaperGenerationParams): { systemPrompt: string; userPrompt: string } {
  const articleBlueprint = resolveArticleBlueprint({ paperType: params.paperType, language: params.language })
  const preferredSections = articleBlueprint.standardSections
  return {
    systemPrompt: articleBlueprint.prompts.outlineSystemPrompt,
    userPrompt: `为主题“${params.topic}”生成一份学术论文大纲。\n文章类别: ${articleBlueprint.articleTypeLabel}\n语言: ${params.language}\n要求：\n1. 输出 Markdown\n2. 必须遵循这套既定章节结构顺序：${preferredSections.join(' / ')}\n3. 可以细化每节标题，但不要改变章节语义\n4. 还要满足以下写作要求：\n${articleBlueprint.prompts.outlineRules.map((rule, index) => `${index + 1}. ${rule}`).join('\n')}\n5. 不要输出解释，只输出大纲${params.extraContext ? `\n补充上下文: ${params.extraContext}` : ''}`,
  }
}

function buildDefaultSections(paperType: PaperGenerationParams['paperType'], language: PaperGenerationParams['language']): string[] {
  return resolveArticleBlueprint({ paperType, language }).standardSections
}

function parseSectionsFromOutline(outline: string): string[] {
  const sections = outline
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^#{1,3}\s+/.test(line))
    .map((line) => line.replace(/^#{1,3}\s+/, '').trim())

  return sections.length > 0 ? sections : []
}

function buildReferenceContext(references: ReferenceItem[], limit = 8): string {
  return references
    .slice(0, limit)
    .map((item, index) => `[${index + 1}] ${item.title} (${item.year ?? 'n.d.'}) ${item.abstract}`)
    .join('\n')
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

function inferRole(sectionName: string, paperType: PaperGenerationParams['paperType']): string {
  const normalized = sectionName.toLowerCase()
  if (normalized.includes('摘要') || normalized.includes('abstract')) return SECTION_ROLES.abstract
  if (normalized.includes('引言') || normalized.includes('introduction')) return SECTION_ROLES.introduction
  if (normalized.includes('方法') || normalized.includes('method')) return SECTION_ROLES.methodology
  if (normalized.includes('结果') || normalized.includes('result')) return SECTION_ROLES.results
  if (normalized.includes('讨论') || normalized.includes('discussion')) return SECTION_ROLES.discussion
  if (normalized.includes('结论') || normalized.includes('conclusion')) return SECTION_ROLES.conclusion
  if (paperType === 'review') return SECTION_ROLES.review
  return SECTION_ROLES.methodology
}

function stripMarkdownHeading(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^#{1,6}\s+/.test(line.trim()))
    .join('\n')
    .trim()
}

function normalizeGeneratedTitle(rawText: string, fallback: string): string {
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
    .replace(/^['"“”‘’]+|['"“”‘’]+$/g, '')
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

async function generateSectionThinking(
  settings: AppSettings,
  params: PaperGenerationParams,
  section: string,
  referenceContext: string,
  existingMarkdown: string,
): Promise<string> {
  const articleBlueprint = resolveArticleBlueprint({ paperType: params.paperType, language: params.language })
  const sectionSpecificRules = /讨论|discussion/i.test(section)
    ? articleBlueprint.prompts.discussionRules
    : /结论|conclusion/i.test(section)
      ? articleBlueprint.prompts.conclusionRules
      : []
  return completeText(settings, {
    systemPrompt: 'You are an academic writing strategist. Think explicitly about how to write the next section. Output concise planning notes only.',
    userPrompt: `请为论文主题“${params.topic}”的章节“${section}”生成写作思路。\n文章类别: ${articleBlueprint.articleTypeLabel}\n语言: ${params.language}\n已有正文:\n${existingMarkdown.slice(-2200)}\n\n可用参考文献:\n${referenceContext}\n\n写作要求聚焦：\n${articleBlueprint.prompts.sectionPlanningFocus.map((rule, index) => `${index + 1}. ${rule}`).join('\n')}${sectionSpecificRules.length ? `\n${section}\n附加要求：\n${sectionSpecificRules.map((rule, index) => `${index + 1}. ${rule}`).join('\n')}` : ''}\n\n只输出以下内容：\n1. 本节目标\n2. 本节关键论点\n3. 推荐引用编号\n4. 与前文衔接策略`,
    temperature: 0.4,
    maxTokens: 1200,
  })
}

async function generateSectionBody(
  settings: AppSettings,
  params: PaperGenerationParams,
  section: string,
  thinking: string,
  referenceContext: string,
  existingMarkdown: string,
  onChunk?: (chunk: string, accumulated: string) => void | Promise<void>,
): Promise<string> {
  const articleBlueprint = resolveArticleBlueprint({ paperType: params.paperType, language: params.language })
  const sectionSpecificRules = /讨论|discussion/i.test(section)
    ? articleBlueprint.prompts.discussionRules
    : /结论|conclusion/i.test(section)
      ? articleBlueprint.prompts.conclusionRules
      : []
  return streamPromptText(settings, {
    systemPrompt: inferRole(section, params.paperType),
    userPrompt: `请撰写章节“${section}”。\n论文主题: ${params.topic}\n文章类别: ${articleBlueprint.articleTypeLabel}\n语言: ${params.language}\n补充上下文: ${params.extraContext ?? '无'}\n章节写作思路:\n${thinking}\n\n参考文献上下文:\n${referenceContext}\n\n已有正文末尾:\n${existingMarkdown.slice(-2200)}\n\n要求:\n1. 输出 Markdown 正文，不要重复章节标题\n2. 700-1100 字\n3. 合理插入引用标记 [1] [2]\n4. 内容与前文自然衔接\n5. 学术表达准确严谨\n6. 还要满足以下文章类别约束：\n${articleBlueprint.prompts.sectionWritingFocus.map((rule, index) => `${index + 1}. ${rule}`).join('\n')}${sectionSpecificRules.length ? `\n${section}\n附加要求：\n${sectionSpecificRules.map((rule, index) => `${index + 1}. ${rule}`).join('\n')}` : ''}`,
    temperature: 0.55,
    maxTokens: 2400,
  }, onChunk)
}

async function streamPromptText(
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

async function reviseBridgeParagraph(
  settings: AppSettings,
  params: PaperGenerationParams,
  existingMarkdown: string,
  nextSection: string,
): Promise<string> {
  const articleBlueprint = resolveArticleBlueprint({ paperType: params.paperType, language: params.language })
  return completeText(settings, {
    systemPrompt: 'You are an academic editor. Improve transitions between sections while preserving the original meaning.',
    userPrompt: `请为当前论文补一个承上启下的过渡段，准备引入章节“${nextSection}”。\n文章类别: ${articleBlueprint.articleTypeLabel}\n语言: ${params.language}\n现有论文末尾:\n${existingMarkdown.slice(-1800)}\n\n过渡要求：\n${articleBlueprint.prompts.transitionRules.map((rule, index) => `${index + 1}. ${rule}`).join('\n')}\n\n只输出 1 段过渡文字。`,
    temperature: 0.45,
    maxTokens: 600,
  })
}

function appendEvent(target: Array<{ step: number; message: string }>, event: GenerationEvent): void {
  const last = target[target.length - 1]
  if (last && last.step === event.step && last.message === event.message) return
  target.push({ step: event.step, message: event.message })
}

export async function continueWriting(
  settings: AppSettings,
  params: { draftText: string; writingGoal?: string; targetWords?: number; language?: 'zh' | 'en'; extraContext?: string },
  onChunk: (chunk: string) => void,
): Promise<string> {
  const extraContext = String(params.extraContext || '').trim()
  return streamText(
    settings,
    {
      systemPrompt:
        '你是一位学术论文写作助手。你只输出续写的新内容，不重复原文，不做解释，不输出标题。',
      userPrompt: `请基于下面的论文草稿继续写作。\n语言: ${params.language ?? settings.defaults.language}\n目标字数: ${params.targetWords ?? settings.defaults.targetWords}\n写作目标: ${params.writingGoal ?? '保持学术风格自然续写'}${extraContext ? `\n\n参考材料（来自知识库，仅用于参考术语与风格，不得改变写作方向）：\n${extraContext}` : ''}\n\n已有内容:\n${params.draftText}`,
      temperature: 0.6,
      maxTokens: 2200,
    },
    onChunk,
  )
}

export async function rewriteParagraph(
  settings: AppSettings,
  params: { paragraph: string; instruction?: string; sectionType?: string; language?: 'zh' | 'en' },
  onChunk: (chunk: string) => void,
): Promise<string> {
  return streamText(
    settings,
    {
      systemPrompt: inferRole(params.sectionType ?? '', 'review'),
      userPrompt: `请重写以下学术段落，使其更规范、严谨、流畅。\n语言: ${params.language ?? settings.defaults.language}\n额外要求: ${params.instruction ?? '保持原意，增强学术表达'}\n\n段落:\n${params.paragraph}`,
      temperature: 0.5,
      maxTokens: 1800,
    },
    onChunk,
  )
}

export async function runWritingAssistant(
  settings: AppSettings,
  params: WritingAssistantParams,
  onChunk: (chunk: string) => void,
  onStatus?: (message: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (params.generationMode === 'knowledge-template-document') {
    return runKnowledgeTemplateWritingAssistant(settings, params, onChunk, onStatus)
  }

  const documentText = String(params.documentText || '').trim()
  const instruction = String(params.instruction || '').trim()
  const extraContext = String(params.extraContext || '').trim()
  const outputLanguage = resolveOutputLanguage(params)
  const languageRequirement = buildOutputLanguageRequirement(outputLanguage)

  return streamText(
    settings,
    {
      systemPrompt:
        `你是一位专业 AI 写作助手。你的任务是根据用户的自然语言要求直接改写、重组、润色或重写整篇文稿。若提供了原文，就输出处理后的完整新正文；若未提供原文，就直接根据要求起草完整内容，正文第一行必须是一级标题（Markdown 格式：\`# 文章标题\`）。不要解释你的操作，不要输出分析过程，不要输出"已改写如下"之类的前言。\n\n${languageRequirement}`,
      userPrompt: `请作为 AI 写作助手处理当前文档。\n语言偏好: ${getLanguagePreferenceLabel(outputLanguage)}\n${languageRequirement}\n\n用户要求:\n${instruction}\n${extraContext ? `\n补充上下文:\n${extraContext}\n` : ''}\n${documentText ? `\n当前文档全文:\n${documentText}\n\n请直接输出处理后的完整正文。` : '\n当前文档为空，请直接根据用户要求生成完整正文。'}`,
      temperature: 0.55,
      maxTokens: 3600,
    },
    onChunk,
    signal,
  )
}

export async function generateOutline(settings: AppSettings, params: PaperGenerationParams): Promise<string> {
  return completeText(settings, buildOutlinePrompt(params))
}

export async function analyzeTopic(
  settings: AppSettings,
  params: { topic: string; paperType: string; language: string },
): Promise<string> {
  return completeText(settings, {
    systemPrompt:
      'You are a senior academic research advisor with expertise across multiple disciplines. Return concise but actionable analysis.',
    userPrompt: `请从学术论文选题角度分析主题“${params.topic}”。\n论文类型: ${params.paperType}\n语言: ${params.language}\n输出格式:\n1. 研究价值\n2. 关键问题\n3. 创新点建议\n4. 可能的章节结构\n5. 检索关键词建议`,
    temperature: 0.4,
    maxTokens: 1800,
  })
}

export async function generateExperimentPlan(
  settings: AppSettings,
  params: { topic: string; language: string; yearFrom?: string; yearTo?: string },
): Promise<string> {
  const references = await searchReferencesWithNftcoreStrategy(settings, {
    topic: params.topic,
    yearFrom: params.yearFrom,
    yearTo: params.yearTo,
    maxResults: 8,
  })

  return completeText(settings, {
    systemPrompt: 'You are an academic experiment design advisor. Produce a rigorous, structured experimental plan in markdown.',
    userPrompt: `请围绕主题“${params.topic}”生成实验方案。\n语言: ${params.language}\n请参考这些真实文献：\n${buildReferenceContext(references)}\n\n输出必须包含：研究目标、变量设计、数据来源、评价指标、风险与局限。`,
    temperature: 0.4,
    maxTokens: 2200,
  })
}

export async function generatePaper(
  settings: AppSettings,
  outputDir: string,
  params: PaperGenerationParams,
  onProgress: (event: GenerationEvent) => void | Promise<void>,
): Promise<PaperGenerationResult> {
  return generatePaperNFTCORE(settings, outputDir, params, onProgress as Parameters<typeof generatePaperNFTCORE>[3]) as Promise<PaperGenerationResult>
}

export async function generatePaperSmart(
  settings: AppSettings,
  outputDir: string,
  params: PaperGenerationParams,
  onProgress: (event: GenerationEvent) => void | Promise<void>,
): Promise<PaperGenerationResult> {
  return generatePaper(settings, outputDir, params, onProgress)
}
