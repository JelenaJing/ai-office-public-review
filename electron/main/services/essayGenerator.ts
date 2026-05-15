import { completeText, streamText } from './llmClient'
import { generateEssayIllustrations, type EssayIllustrationImage, type EssayIllustrationStyleSelection } from './essayIllustrationGenerator'
import type { AppSettings } from './settingsStore'

export interface EssayGenerationParams {
  topic: string
  language?: string
  withImages?: boolean
  noImageMode?: boolean
  workspacePath?: string
  scope?: 'essay-writing'
}

export interface EssayTaskResult {
  scope: 'essay-writing'
  topic: string
  normalized_topic?: string
  planned_title?: string
  markdown: string
  paper_markdown: string
  images?: EssayIllustrationImage[]
  illustration_style?: EssayIllustrationStyleSelection
}

interface EssayPlan {
  title: string
  theme: string
  emotional_tone: string
  core_scene: string
  narrative_perspective: string
  structure_hint: string
  length_hint: string
  style_constraints: string[]
}

interface EssayCallbacks {
  onProgress?: (payload: { step: number; message: string }) => void
  onContent?: (payload: {
    step: number
    content?: string
    contentType: 'body'
    cumulativeMarkdown: string
    eventType?: 'image'
    image?: EssayIllustrationImage
  }) => void
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

function sanitizeEssayTopic(value: string): string {
  const raw = String(value || '').trim()
  const simplified = raw
    .replace(/^(请|帮我|麻烦)?(写|生成|创作|写一篇|写一段|做一篇)(一篇|一段|一则)?/u, '')
    .replace(/(的)?(散文|文章|随笔|短文)$/u, '')
    .replace(/^[：:，,\s]+|[：:，,\s]+$/gu, '')
    .trim()
  return simplified || raw || '散文'
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

function buildEssayPlanPrompt(instruction: string, topic: string): string {
  return [
    '请把下面的散文写作需求整理成一个严格的写作计划。',
    '输出必须是 JSON，不要输出任何解释。',
    '',
    `原始需求：${instruction}`,
    `归一化主题：${topic}`,
    '',
    'JSON 字段要求：',
    '{',
    '  "title": "建议标题，8-20字，中文",',
    '  "theme": "中心主题，1句话",',
    '  "emotional_tone": "情绪基调，如克制、温润、清朗、怀想",',
    '  "core_scene": "建议聚焦的核心场景或意象，1句话",',
    '  "narrative_perspective": "建议叙述视角，如第一人称/观察者视角",',
    '  "structure_hint": "建议行文结构，1句话",',
    '  "length_hint": "建议长度，默认900-1400字",',
    '  "style_constraints": ["3-6条必须遵守的风格约束"]',
    '}',
    '',
    '约束：',
    '1. 这是纯文本散文，不是新闻、报告、议论文提纲，也不是学术评论。',
    '2. 如果用户明确指定了语气、篇幅、题材、叙述视角或结构，必须体现在 JSON 中。',
    '3. 如果用户没有给足事实细节，不要编造具体真实人物、机构、历史事件，只提炼可安全发挥的主题和意象。',
    '4. style_constraints 必须覆盖：纯文本、无小标题、无列表、无图片提示、避免空泛套话。',
  ].join('\n')
}

function buildEssayPrompt(instruction: string, topic: string, plan: EssayPlan): string {
  const constraints = plan.style_constraints.length > 0
    ? plan.style_constraints.map((item, index) => `${index + 1}. ${item}`).join('\n')
    : '1. 使用纯文本散文笔法，不使用小标题、列表、图示说明或图片占位。'

  return [
    '你是一名中文散文作者。你的任务是根据用户需求，写出一篇完整、自然、可直接进入文档编辑器的散文成稿。',
    '',
    `用户原始需求：${instruction}`,
    `归一化主题：${topic}`,
    `建议标题：${plan.title}`,
    `中心主题：${plan.theme}`,
    `情绪基调：${plan.emotional_tone}`,
    `核心场景：${plan.core_scene}`,
    `叙述视角：${plan.narrative_perspective}`,
    `结构提示：${plan.structure_hint}`,
    `篇幅提示：${plan.length_hint}`,
    '',
    '写作要求：',
    '1. 输出一篇完整散文，不要输出提纲、创作说明、摘要、分点列表或写作分析。',
    '2. 全文必须是纯文本散文格式，只允许一级标题加正文自然段；正文中不要出现二级标题、小标题或编号。',
    '3. 正文应以具体场景、动作、细节和感受推进，不要写成口号、鸡汤、新闻稿、工作汇报或议论文模板。',
    '4. 语言要有节制，尽量避免堆砌华丽辞藻和陈词滥调，保持画面感与节奏感。',
    '5. 如果用户没有给出足够现实细节，可在日常经验层面展开，但不得虚构明确可核验的现实事实。',
    '6. 优先服从用户明确提出的长度、语气、视角、对象和主题要求；没有明确要求时，再参考上面的计划。',
    '7. 第一版严格纯文本：不要插图、不要图片提示词、不要 Markdown 列表、不要引用来源、不要表格。',
    '',
    '风格硬约束：',
    constraints,
    '',
    '输出格式：',
    '1. 第一行使用一级标题格式：# 标题',
    '2. 后面直接写正文自然段',
    '3. 正文建议 4-6 段，整篇默认 900-1400 字；若用户明确要求更短或更长，以用户要求为准',
    '4. 除标题外，不得再出现任何 Markdown 标题或列表符号',
  ].join('\n')
}

async function buildEssayPlan(settings: AppSettings, instruction: string, topic: string, signal?: AbortSignal): Promise<EssayPlan> {
  throwIfAborted(signal)
  const raw = await completeText(settings, {
    systemPrompt: '你是一名中文文学编辑，擅长把开放的写作需求整理成稳定、明确、可执行的散文写作计划。你只输出有效 JSON。',
    userPrompt: buildEssayPlanPrompt(instruction, topic),
    temperature: 0.3,
    maxTokens: 1200,
  })
  throwIfAborted(signal)

  const parsed = parseJsonObject(raw)
  const styleConstraints = Array.isArray(parsed?.style_constraints)
    ? parsed!.style_constraints.map((item) => String(item || '').trim()).filter(Boolean)
    : []

  return {
    title: String(parsed?.title || `${topic}`).trim() || topic,
    theme: String(parsed?.theme || `${topic}`).trim() || topic,
    emotional_tone: String(parsed?.emotional_tone || '克制而有余味').trim() || '克制而有余味',
    core_scene: String(parsed?.core_scene || `围绕“${topic}”展开一个可感知的生活场景`).trim() || `围绕“${topic}”展开一个可感知的生活场景`,
    narrative_perspective: String(parsed?.narrative_perspective || '观察者视角').trim() || '观察者视角',
    structure_hint: String(parsed?.structure_hint || '从具体场景进入，逐步推进情绪与思考，最后自然收束').trim() || '从具体场景进入，逐步推进情绪与思考，最后自然收束',
    length_hint: String(parsed?.length_hint || '900-1400字').trim() || '900-1400字',
    style_constraints: styleConstraints.length > 0
      ? styleConstraints
      : [
        '全文保持散文笔法，不写成报告、新闻或议论文提纲。',
        '只输出一级标题和正文自然段，不要小标题、列表或表格。',
        '多写具体细节和场景，少写空泛判断。',
        '不要加入图片提示、插图说明或引用来源。',
      ],
  }
}

export async function generateEssay(
  settings: AppSettings,
  params: EssayGenerationParams,
  callbacks: EssayCallbacks = {},
  signal?: AbortSignal,
): Promise<EssayTaskResult> {
  const rawTopic = String(params.topic || '').trim()
  if (!rawTopic) {
    throw new Error('散文主题不能为空')
  }

  const normalizedTopic = sanitizeEssayTopic(rawTopic)
  callbacks.onProgress?.({ step: 1, message: '正在整理散文写作需求...' })
  const plan = await buildEssayPlan(settings, rawTopic, normalizedTopic, signal)
  throwIfAborted(signal)

  callbacks.onProgress?.({ step: 2, message: `已生成写作计划，准备创作《${plan.title}》` })
  const prompt = buildEssayPrompt(rawTopic, normalizedTopic, plan)

  callbacks.onProgress?.({ step: 3, message: '正在生成散文正文...' })
  let accumulatedMarkdown = ''
  await streamText(settings, {
    systemPrompt: '你是一名成熟的中文散文作者，擅长写有画面感、节奏感和情绪层次的文章。你遵守用户要求，输出可直接成文的纯文本散文。',
    userPrompt: prompt,
    temperature: 0.8,
    maxTokens: 3200,
  }, async (chunk) => {
    throwIfAborted(signal)
    accumulatedMarkdown += chunk
    callbacks.onContent?.({
      step: 3,
      content: chunk,
      contentType: 'body',
      cumulativeMarkdown: accumulatedMarkdown,
    })
  })
  throwIfAborted(signal)

  const finalMarkdown = String(accumulatedMarkdown || '').trim()
  if (!finalMarkdown) {
    throw new Error('散文正文为空')
  }

  let illustratedMarkdown = finalMarkdown
  let images: EssayIllustrationImage[] | undefined
  let illustrationStyle: EssayIllustrationStyleSelection | undefined

  if (params.withImages !== false && !params.noImageMode) {
    callbacks.onProgress?.({ step: 4, message: '正在为散文挑选段落并生成插图...' })
    try {
      const illustrationResult = await generateEssayIllustrations(settings, {
        topic: normalizedTopic,
        markdown: finalMarkdown,
        workspacePath: params.workspacePath,
      }, {
        onProgress: (message) => {
          callbacks.onProgress?.({ step: 4, message })
        },
        onImage: ({ image, cumulativeMarkdown }) => {
          callbacks.onContent?.({
            step: 4,
            contentType: 'body',
            cumulativeMarkdown,
            eventType: 'image',
            image,
          })
        },
      }, signal)
      throwIfAborted(signal)
      illustratedMarkdown = illustrationResult.markdown
      images = illustrationResult.images
      illustrationStyle = illustrationResult.style
    } catch (error) {
      callbacks.onProgress?.({
        step: 4,
        message: `散文插图生成已跳过：${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  return {
    scope: 'essay-writing',
    topic: rawTopic,
    normalized_topic: normalizeOptionalString(normalizedTopic),
    planned_title: normalizeOptionalString(plan.title),
    markdown: illustratedMarkdown,
    paper_markdown: illustratedMarkdown,
    images,
    illustration_style: illustrationStyle,
  }
}