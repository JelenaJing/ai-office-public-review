import fs from 'node:fs/promises'
import path from 'node:path'
import { completeText, streamText } from './llmClient'
import { formatReferenceList, searchReferencesWithNftcoreStrategy, type ReferenceItem } from './openAlexClient'
import { generateSectionFigures, type FigureInfo } from './advancedFigureGenerator'
import type { AppSettings } from './settingsStore'

export interface DailyReportGenerationParams {
  topic: string
  language?: string
  noImageMode?: boolean
  workspacePath?: string
  scope?: 'daily-report'
}

export interface DailyReportTaskResult {
  scope: 'daily-report'
  topic: string
  normalized_topic?: string
  search_topic?: string
  markdown: string
  paper_markdown: string
  images?: Array<{
    path: string
    url: string
    caption: string
    markdown: string
  }>
  figures?: Array<{
    url: string
    image_url: string
    path: string
    caption: string
    markdown: string
    filename?: string
  }>
  reference_list?: Array<Record<string, unknown>>
  selected_paper?: Record<string, unknown>
}

interface DailyReportAnalysisResult {
  title: string
  journal: string
  doi: string
  authors: string
  abstract: string
  keywords: string[]
  main_content: string
  methodology: string
  results: string
  conclusions: string
  full_analysis: string
}

interface DailyReportCallbacks {
  onProgress?: (payload: { step: number; message: string; selectedPaper?: Record<string, unknown> }) => void
  onContent?: (payload: { step: number; content?: string; contentType: 'body'; cumulativeMarkdown: string; eventType?: string; image?: Record<string, unknown> }) => void
}

function sanitizeTopic(value: string): string {
  const text = String(value || '').trim()
    .replace(/^(请|帮我|麻烦)?(生成|写|做|整理|产出)(一篇|一份|一个)?/u, '')
    .replace(/(的)?(日报|专题稿|推送|文章|报告)$/u, '')
    .replace(/^[：:，,\s]+|[：:，,\s]+$/gu, '')
    .trim()
  return text || String(value || '').trim()
}

function abortError(): Error {
  return new Error('任务已停止')
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortError()
  }
}

function normalizeOptionalString(value: unknown): string | undefined {
  const normalized = String(value || '').trim()
  return normalized || undefined
}

function parseJsonObject(raw: string): Record<string, any> | null {
  const cleaned = String(raw || '')
    .replace(/```json\s*/gi, '')
    .replace(/```/g, '')
    .trim()

  if (!cleaned) return null

  try {
    return JSON.parse(cleaned) as Record<string, any>
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0]) as Record<string, any>
    } catch {
      return null
    }
  }
}

function buildAnalysisSourceText(reference: ReferenceItem): string {
  return [
    `Title: ${reference.title || '未提供'}`,
    `Journal: ${reference.journal || '未提供'}`,
    `Date: ${reference.year || '未提供'}`,
    `DOI: ${reference.doi || '未提供'}`,
    `Authors: ${reference.authors.join(', ') || '未提供'}`,
    `Abstract: ${reference.abstract || 'No abstract available.'}`,
    `Full Text URL: ${reference.url || 'N/A'}`,
  ].join('\n')
}

function scoreReference(reference: ReferenceItem): number {
  let score = 0
  if (String(reference.title || '').trim()) score += 3
  if (String(reference.journal || '').trim()) score += 2
  if (String(reference.abstract || '').trim()) score += 4
  if (String(reference.doi || '').trim()) score += 1
  if (typeof reference.year === 'number' && Number.isFinite(reference.year)) {
    const age = Math.max(0, new Date().getFullYear() - reference.year)
    score += Math.max(0, 4 - Math.min(age, 4))
  }
  return score
}

async function pickBestReference(settings: AppSettings, topic: string, signal?: AbortSignal): Promise<{ reference: ReferenceItem; searchTopic: string }> {
  throwIfAborted(signal)
  const references = await searchReferencesWithNftcoreStrategy(settings, {
    topic,
    maxResults: 12,
  })
  throwIfAborted(signal)

  if (!references.length) {
    throw new Error('未检索到与主题相关的论文')
  }

  const bestReference = references
    .slice()
    .sort((left, right) => scoreReference(right) - scoreReference(left))[0]

  if (!bestReference) {
    throw new Error('未找到可用于生成日报的论文')
  }

  return {
    reference: bestReference,
    searchTopic: sanitizeTopic(topic),
  }
}

async function analyzeReference(settings: AppSettings, sourceText: string, signal?: AbortSignal): Promise<DailyReportAnalysisResult> {
  throwIfAborted(signal)
  const raw = await completeText(settings, {
    systemPrompt: '你是一个专业的学术论文分析专家。你擅长从论文中提取关键信息，包括标题、摘要、关键词、主要内容、研究方法、研究结果和结论。你总是返回有效的JSON格式。',
    userPrompt: `请仔细分析以下学术论文内容，提取关键信息并生成结构化分析报告。\n\n论文内容：\n${sourceText}\n\n请按照以下要求进行分析：\n\n1. **论文标题**：提取论文的标题\n2. **期刊名称**：提取论文发表的期刊名称（如果有）\n3. **DOI**：提取论文的DOI（如果有）\n4. **作者信息**：提取论文的主要作者及其所属机构（简要信息）\n5. **摘要**：提取或总结论文的摘要\n6. **关键词**：提取3-8个关键词\n7. **主要内容**：总结论文的主要研究内容和贡献（200-500字）\n8. **研究方法**：总结论文使用的研究方法和技术路线（200-400字）\n9. **研究结果**：总结论文的主要研究结果和发现（200-400字）\n10. **结论**：总结论文的结论和意义（150-300字）\n\n请以JSON格式返回分析结果，格式如下：\n{\n  "title": "论文标题",\n  "journal": "期刊名称（如果未找到则使用'未提供'）",\n  "doi": "DOI（如果未找到则使用'未提供'）",\n  "authors": "主要作者及其机构信息（简要）",\n  "abstract": "摘要内容",\n  "keywords": ["关键词1", "关键词2", "关键词3"],\n  "main_content": "主要内容总结",\n  "methodology": "研究方法描述",\n  "results": "研究结果描述",\n  "conclusions": "结论描述",\n  "full_analysis": "完整的分析文本（包含以上所有内容的详细描述）"\n}\n\n重要：只返回JSON格式，不要添加任何其他文字说明。如果某些信息无法从论文中提取，请使用"未提供"或"无法确定"等表述。`,
    temperature: 0.3,
    maxTokens: 3000,
  })
  throwIfAborted(signal)

  const parsed = parseJsonObject(raw)
  if (!parsed) {
    return {
      title: '无法提取',
      journal: '未提供',
      doi: '未提供',
      authors: '未提供',
      abstract: '无法提取',
      keywords: [],
      main_content: String(raw || '').slice(0, 1000) || '分析失败',
      methodology: '无法提取',
      results: '无法提取',
      conclusions: '无法提取',
      full_analysis: String(raw || '').trim() || '分析失败',
    }
  }

  return {
    title: String(parsed.title || '无法提取').trim(),
    journal: String(parsed.journal || '未提供').trim(),
    doi: String(parsed.doi || '未提供').trim(),
    authors: String(parsed.authors || '未提供').trim(),
    abstract: String(parsed.abstract || '无法提取').trim(),
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map((item) => String(item || '').trim()).filter(Boolean) : [],
    main_content: String(parsed.main_content || '').trim(),
    methodology: String(parsed.methodology || '').trim(),
    results: String(parsed.results || '').trim(),
    conclusions: String(parsed.conclusions || '').trim(),
    full_analysis: String(parsed.full_analysis || '').trim(),
  }
}

function buildTitleInstruction(analysisResult: DailyReportAnalysisResult, category = '', dateStr = ''): string {
  let titleInstruction = '**标题**：直接生成一个吸引人的评论标题（20-30字）。'
  if (category && dateStr) {
    const journal = String(analysisResult.journal || '').trim()
    if (journal) {
      const exampleTitle = `${dateStr}${category}推送|${journal}，新材料让电池寿命延长一倍`
      titleInstruction = `**标题**：必须严格按照格式 \`${dateStr}${category}推送|期刊名，标题内容\` 生成。期刊名固定使用\`${journal}\`。例如 \`${exampleTitle}\`。标题内容要通俗易懂，能概括论文核心价值。`
    } else {
      titleInstruction = `**标题**：必须严格按照格式 \`${dateStr}${category}推送|标题内容\` 生成。例如 \`${dateStr}${category}推送|新材料让电池寿命延长一倍\`。标题内容要通俗易懂，能概括论文核心价值。`
    }
  }
  return titleInstruction
}

function buildReviewPrompt(analysisResult: DailyReportAnalysisResult, category = '', dateStr = ''): string {
  const titleInstruction = buildTitleInstruction(analysisResult, category, dateStr)
  return `你是一名科技评论作者，擅长将学术论文转化为中学生也能理解的科普文章。

【论文信息】
标题：${analysisResult.title || '未提供'}
期刊：${analysisResult.journal || '未提供'}
DOI：${analysisResult.doi || '未提供'}
作者：${analysisResult.authors || '未提供'}
摘要：${analysisResult.abstract || '未提供'}
关键词：${analysisResult.keywords.join(', ')}
主要内容：${analysisResult.main_content || '未提供'}
研究方法：${analysisResult.methodology || '未提供'}
研究结果：${analysisResult.results || '未提供'}
结论：${analysisResult.conclusions || '未提供'}

【文章结构】
请按以下结构输出（使用 Markdown 格式）：

${titleInstruction}

**论文信息**（普通段落格式）：
- 论文题目：${analysisResult.title || '未提供'}
- 期刊：${analysisResult.journal || '未提供'}
- DOI：${analysisResult.doi || '未提供'}

**正文内容**（使用二级标题 ##，按顺序输出）：
## 背景
## 突破
## 方法
## 结果
## 意义
## 一句话总结
## 思考问题
## 思考问题答案

【写作风格】
1. 用词简单，短句为主，每句不超过 20 字。
2. 采用"我们/你"视角，少用被动句和长从句。
3. 遇到专业名词，立即用一句话加生活类比解释（如"就像……一样"）。
4. 避免学术用语：不写"本文/本研究/该论文指出/参考文献/图号/公式编号"等。

【段落格式 - 核心要求】
正文部分（背景、突破、方法、结果、意义、一句话总结）必须使用自然段落格式：

✓ **正确写法**（多个短句合并成段落）：
你有没有想过，为什么铁会生锈？那是因为金属和氧气发生了反应。在化学里，金属和氧结合形成的"金属氧物种"常常能推动其他反应发生，就像催化剂一样。钴是一种常见金属，比黄金便宜很多。

✗ **错误写法**（禁止每句话单独一行）：
你有没有想过，为什么铁会生锈？
那是因为金属和氧气发生了反应。
在化学里，金属和氧结合形成的"金属氧物种"常常能推动其他反应发生。

**关键规则**：
- 必须将多个短句合并成段落，绝对禁止每句话单独一行
- 段落内不换行，只在段落结束时换行（段落之间用空行分隔）
- 禁止使用列表符号（•、-、*）或编号列表
- 即使使用短句，也要合并成段落，不要一句话一行

【信息表达】
5. 保留关键数字和对比，并用生活化方式解释（如"提升 25% ≈ 每 4 次多成功 1 次"）。
6. 将抽象概念转化为日常场景（尺寸→硬币大小，时间→公交车程，能量→操场面积等）。
7. 每个小节 2–4 个自然段，段落之间自然过渡，避免堆砌术语。

【内容要求】
8. 总字数 900–1200 字，只写一篇，不合并多篇。
9. 不罗列实验条件或设备参数，只讲核心做法。
10. 若信息不足，如实说明"能确认的要点"和"不足之处"，不编造内容。

【思考问题】
11. 提供 2–3 条思考问题，贴近生活或未来应用，能引发讨论（可使用序号列表）。

【思考问题答案】
12. 为每个思考问题提供答案，每个答案 50–100 字，基于论文内容，通俗易懂，使用中学生能理解的语言。

【事实准确性】
13. 严格依据提供内容，不虚构、不夸大，不给出未被支持的结论。

【字数分配】
- 评论标题：20-30 字，通俗易懂，概括核心价值
- 论文信息：直接列出，格式清晰
- 背景：180–240 字，先交代论文信息，再说明研究背景，不要单独写作者团队介绍
- 突破：140–170 字，一句话点题 + 1–2 句例子
- 方法：180–220 字，用日常比喻讲清"怎么做"，只讲核心思路
- 结果：180–220 字，写 1–2 个最重要结果，保留关键数字并给出直观翻译
- 意义：160–200 字，分别点出近期应用和中期影响各 1 点，避免夸大
- 一句话总结：30–50 字，用通俗话说清核心价值
- 思考问题：3 条，共 90–120 字，贴近生活或后续研究
- 思考问题答案：每个答案 50–100 字，共 150–300 字，通俗易懂

【输出格式】
- 标题：一级标题格式（# 标题）
- 论文信息：普通段落格式
- 正文各小节：二级标题格式（## 背景、## 突破等），不使用编号
- **再次强调**：正文内容必须是自然段落格式，绝对禁止每句话单独一行，必须将多个短句合并成段落
- 思考问题答案：使用 ## 思考问题答案 作为二级标题，按问题顺序逐一回答

- 禁止出现任何"改写说明/写作要求/参考文献/图号/公式编号"等额外内容

全文目标长度：1200–1600 字（含标题、论文信息、正文和思考问题答案），少于 1200 字需继续扩写。`
}

function removeFigurePlaceholders(markdown: string): string {
  return String(markdown || '').replace(/\[FIGURE:.*?\]/g, '')
}

function smartJoinSeparator(before: string, after: string): string {
  if (!before && !after) return ''
  if (!before) return after.trimStart()
  if (!after) return before.trimEnd()

  const beforeTrimmed = before.trimEnd()
  const afterTrimmed = after.trimStart()
  const beforeNewlines = (before.match(/(\n+)$/)?.[1].length) || 0
  const afterNewlines = (after.match(/^(\n+)/)?.[1].length) || 0

  if (beforeNewlines >= 2 || afterNewlines >= 2) {
    return `${beforeTrimmed}\n${afterTrimmed}`
  }
  if (beforeNewlines === 1 || afterNewlines === 1) {
    return `${beforeTrimmed}\n${afterTrimmed}`
  }
  return `${beforeTrimmed}\n\n${afterTrimmed}`
}

function insertImageMarkdown(markdown: string, index: number, imageMarkdown: string): string {
  if (index === 1 && markdown.includes('## 方法')) {
    const parts = markdown.split('## 方法', 2)
    return `${parts[0]}${imageMarkdown}## 方法${parts[1] || ''}`
  }
  if (index === 2 && markdown.includes('## 一句话总结')) {
    const parts = markdown.split('## 一句话总结', 2)
    return `${parts[0]}${imageMarkdown}## 一句话总结${parts[1] || ''}`
  }
  return smartJoinSeparator(markdown, imageMarkdown)
}

function extractMarkdownSection(markdown: string, heading: string): string {
  const normalized = String(markdown || '')
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`^##\\s+${escapedHeading}\\s*$([\\s\\S]*?)(?=^##\\s+|$)`, 'm')
  const match = normalized.match(pattern)
  return String(match?.[1] || '').trim()
}

function buildImageMarkdown(figure: FigureInfo): string {
  return `\n\n![${figure.caption}](${figure.url})\n*${figure.caption}*\n\n`
}

async function ensureOutputDir(outputDir: string): Promise<void> {
  await fs.mkdir(outputDir, { recursive: true })
}

async function generateDailyReportImages(
  settings: AppSettings,
  outputDir: string,
  topic: string,
  markdown: string,
  language: 'zh' | 'en',
  callbacks: DailyReportCallbacks,
  signal?: AbortSignal,
): Promise<{ markdown: string; figures: FigureInfo[] }> {
  const figures: FigureInfo[] = []
  let nextMarkdown = markdown

  const methodText = extractMarkdownSection(markdown, '方法') || extractMarkdownSection(markdown, '结果') || markdown
  const summaryText = extractMarkdownSection(markdown, '一句话总结') || extractMarkdownSection(markdown, '意义') || markdown
  const plans = [
    { step: 7, sectionNum: 1, sectionTitle: '方法', sectionText: methodText },
    { step: 8, sectionNum: 2, sectionTitle: '一句话总结', sectionText: summaryText },
  ]

  for (const plan of plans) {
    throwIfAborted(signal)
    callbacks.onProgress?.({ step: plan.step, message: `正在生成第 ${plan.sectionNum} 张配图...` })
    const generated = await generateSectionFigures(
      settings,
      outputDir,
      {
        topic,
        sectionNum: plan.sectionNum,
        sectionTitle: plan.sectionTitle,
        sectionText: plan.sectionText,
        plannedFigureCount: 1,
        language,
      },
      (message) => {
        throwIfAborted(signal)
        callbacks.onProgress?.({ step: plan.step, message })
      },
    )
    throwIfAborted(signal)
    const figure = generated[0]
    if (!figure) continue
    figures.push(figure)
    const imagePayload = {
      index: plan.sectionNum,
      caption: figure.caption,
      path: figure.localPath,
      url: figure.url,
      markdown: buildImageMarkdown(figure),
    }
    nextMarkdown = insertImageMarkdown(nextMarkdown, plan.sectionNum, imagePayload.markdown)
    callbacks.onContent?.({
      step: plan.step,
      contentType: 'body',
      cumulativeMarkdown: nextMarkdown,
      eventType: 'image',
      image: imagePayload,
    })
  }

  return { markdown: nextMarkdown, figures }
}

function buildSelectedPaper(reference: ReferenceItem): Record<string, unknown> {
  return {
    title: reference.title,
    journal: reference.journal,
    doi: reference.doi,
    date: reference.year ? String(reference.year) : undefined,
    authors: reference.authors,
    full_text_url: reference.url,
    citation: formatReferenceList([reference]),
  }
}

function buildReferenceList(reference: ReferenceItem): Array<Record<string, unknown>> {
  return [{
    title: reference.title,
    journal: reference.journal,
    doi: reference.doi,
    authors: reference.authors,
    year: reference.year,
    url: reference.url,
    citation: formatReferenceList([reference]),
  }]
}

export async function generateDailyReport(
  settings: AppSettings,
  outputDir: string,
  params: DailyReportGenerationParams,
  callbacks: DailyReportCallbacks = {},
  signal?: AbortSignal,
): Promise<DailyReportTaskResult> {
  const rawTopic = String(params.topic || '').trim()
  if (!rawTopic) {
    throw new Error('日报主题不能为空')
  }

  await ensureOutputDir(outputDir)
  throwIfAborted(signal)
  callbacks.onProgress?.({ step: 1, message: '正在解析日报主题...' })
  const normalizedTopic = sanitizeTopic(rawTopic)
  const category = normalizedTopic || rawTopic
  const language = params.language === 'en' ? 'en' : 'zh'

  callbacks.onProgress?.({ step: 2, message: `正在检索主题相关论文：${normalizedTopic || rawTopic}` })
  const { reference, searchTopic } = await pickBestReference(settings, normalizedTopic || rawTopic, signal)
  throwIfAborted(signal)

  const selectedPaper = buildSelectedPaper(reference)
  callbacks.onProgress?.({
    step: 3,
    message: `已锁定论文：${reference.title}`,
    selectedPaper,
  })

  callbacks.onProgress?.({ step: 4, message: '正在分析论文内容...' })
  const analysisResult = await analyzeReference(settings, buildAnalysisSourceText(reference), signal)
  throwIfAborted(signal)

  callbacks.onProgress?.({ step: 5, message: '正在生成日报正文...' })
  const todayLabel = `${new Date().getMonth() + 1}月${new Date().getDate()}日`
  const reviewPrompt = buildReviewPrompt(analysisResult, category, todayLabel)

  let accumulatedMarkdown = ''
  await streamText(settings, {
    systemPrompt: '你是一名科技评论作者，擅长将复杂的学术论文转化为中学生也能理解的科普文章。你使用简单易懂的语言、生活化的类比，让科学知识变得生动有趣。你严格遵守写作规范，确保内容准确、通俗、有启发性。',
    userPrompt: reviewPrompt,
    temperature: 0.7,
    maxTokens: 3000,
  }, async (chunk) => {
    throwIfAborted(signal)
    accumulatedMarkdown += chunk
    callbacks.onContent?.({
      step: 5,
      content: chunk,
      contentType: 'body',
      cumulativeMarkdown: accumulatedMarkdown,
    })
  })
  throwIfAborted(signal)

  let finalMarkdown = removeFigurePlaceholders(accumulatedMarkdown).trim()
  let figures: FigureInfo[] = []
  if (!params.noImageMode) {
    const imageResult = await generateDailyReportImages(settings, outputDir, category, finalMarkdown, language, callbacks, signal)
    finalMarkdown = imageResult.markdown.trim()
    figures = imageResult.figures
  }

  return {
    scope: 'daily-report',
    topic: rawTopic,
    normalized_topic: normalizeOptionalString(normalizedTopic),
    search_topic: normalizeOptionalString(searchTopic),
    markdown: finalMarkdown,
    paper_markdown: finalMarkdown,
    images: figures.map((figure) => ({
      path: figure.localPath,
      url: figure.url,
      caption: figure.caption,
      markdown: buildImageMarkdown(figure),
    })),
    figures: figures.map((figure) => ({
      url: figure.url,
      image_url: figure.url,
      path: figure.localPath,
      caption: figure.caption,
      markdown: buildImageMarkdown(figure),
      filename: path.basename(figure.localPath),
    })),
    reference_list: buildReferenceList(reference),
    selected_paper: selectedPaper,
  }
}