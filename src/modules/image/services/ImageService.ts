import {
  DEFAULT_IMAGE_GENERATION_MODE,
  buildImageReferenceDebugItems,
  normalizeImageStyleOptions,
  summarizeImageReferenceRoles,
} from './imageGenerationPrompt'
import type {
  GenerateImagePayload,
  ImageGenerationMode,
  ImageReferenceItem,
  ImageStyleOptions,
  ImageStyleProfile,
} from '../../../types/imageGeneration'

export interface GenerateImageParams {
  prompt: string
  aspect_ratio?: string
  aspectRatio?: string
  filename?: string
  workspacePath?: string
  negativePrompt?: string
  traceId?: string
  references?: ImageReferenceItem[]
  styleOptions?: Partial<ImageStyleOptions>
  generationMode?: ImageGenerationMode
  styleProfile?: ImageStyleProfile | null
  debug?: GenerateImagePayload['debug']
}

export interface GenerateImageResult {
  status: string
  image_url?: string
  file_path?: string
  filename?: string
  alt?: string
  error?: string
}

const MAX_SELECTION_IMAGE_ANALYSIS_CHARS = 1800
const MAX_SELECTION_IMAGE_SUBJECT_CHARS = 72
const MAX_SELECTION_IMAGE_SCENE_CHARS = 120
const FALLBACK_SELECTION_IMAGE_KEYWORD_COUNTS = [8, 5, 3]
const DEFAULT_INSERTED_GENERATED_IMAGE_WIDTH_PX = 560
const SELECTION_IMAGE_NO_TEXT_NEGATIVE_PROMPT = [
  'text',
  'words',
  'letters',
  'alphabet',
  'typography',
  'caption',
  'subtitle',
  'label',
  'watermark',
  'logo',
  'signature',
  'numbers',
  'symbols',
  'Chinese characters',
  'English text',
  'annotations',
].join(', ')

interface SelectionImagePromptVariant {
  prompt: string
  alt: string
}

interface SelectionImageSemanticAnalysis {
  subject: string
  scene: string
  composition: string
  keywords: string[]
  avoid: string[]
  alt: string
}

export interface GenerateSelectionImageResult extends GenerateImageResult {
  alt: string
  attemptCount: number
  fallbackUsed: boolean
}

function normalizeSelectionText(selectionText: string): string {
  return String(selectionText || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[#>*_~\-]{1,3}/g, ' ')
    .replace(/\[[^\]]+\]\(([^)]+)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractJsonPayload(text: string): string {
  const trimmed = String(text || '').trim()
  if (!trimmed) return ''
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1].trim() : trimmed
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start >= 0 && end > start) return candidate.slice(start, end + 1)
  return candidate
}

function normalizePromptField(value: unknown, maxLength: number): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function normalizePromptKeywords(value: unknown, maxCount = 8): string[] {
  const items = Array.isArray(value)
    ? value
    : String(value || '')
      .split(/[、,，;；\n]/)
      .map((item) => item.trim())

  const deduped = new Set<string>()
  for (const item of items) {
    const normalized = String(item || '').replace(/\s+/g, ' ').trim()
    if (!normalized) continue
    if (normalized.length > 24) continue
    deduped.add(normalized)
    if (deduped.size >= maxCount) break
  }
  return Array.from(deduped)
}

function extractHeuristicKeywords(text: string, maxCount = 8): string[] {
  const normalized = String(text || '').toLowerCase()
  if (!normalized) return []
  const latinTokens = normalized.match(/[a-z0-9][a-z0-9_-]{2,}/g) || []
  const cjkTokens = normalized.match(/[\u4e00-\u9fa5]{2,8}/g) || []
  const scoreMap = new Map<string, number>()
  for (const token of [...latinTokens, ...cjkTokens]) {
    scoreMap.set(token, (scoreMap.get(token) || 0) + 1)
  }
  return Array.from(scoreMap.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh-Hans-CN'))
    .slice(0, maxCount)
    .map(([token]) => token)
}

function buildFallbackSelectionImageAnalysis(selectionText: string): SelectionImageSemanticAnalysis {
  const normalized = normalizeSelectionText(selectionText)
  const firstSentence = String(normalized.split(/(?<=[。！？.!?；;])/)[0] || normalized)
    .trim()
    .slice(0, MAX_SELECTION_IMAGE_SCENE_CHARS)
  const keywords = extractHeuristicKeywords(normalized, 8)
  const subject = normalizePromptField(keywords[0] || firstSentence || '文档主题', MAX_SELECTION_IMAGE_SUBJECT_CHARS)

  return {
    subject,
    scene: normalizePromptField(firstSentence || subject, MAX_SELECTION_IMAGE_SCENE_CHARS),
    composition: '突出单一主体与关键关系，保持结构清晰，适合作为文档配图。',
    keywords,
    avoid: ['大段文字', '字母数字', '公式', '表格', '标题', '水印'],
    alt: normalizePromptField(subject || firstSentence, 80),
  }
}

function parseSelectionImageAnalysis(rawText: string, fallbackText: string): SelectionImageSemanticAnalysis {
  try {
    const parsed = JSON.parse(extractJsonPayload(rawText)) as Record<string, unknown>
    const keywords = normalizePromptKeywords(parsed.keywords, 8)
    const subject = normalizePromptField(parsed.subject || keywords[0], MAX_SELECTION_IMAGE_SUBJECT_CHARS)
    const scene = normalizePromptField(parsed.scene || parsed.summary || subject, MAX_SELECTION_IMAGE_SCENE_CHARS)
    const composition = normalizePromptField(parsed.composition || parsed.layout || '突出主体，结构清楚，适合作为文档配图。', MAX_SELECTION_IMAGE_SCENE_CHARS)
    const avoid = normalizePromptKeywords(parsed.avoid, 8)
    const alt = normalizePromptField(parsed.alt || subject || scene, 80)

    if (!subject && keywords.length === 0 && !scene) {
      return buildFallbackSelectionImageAnalysis(fallbackText)
    }

    return {
      subject: subject || normalizePromptField(keywords[0] || '文档主题', MAX_SELECTION_IMAGE_SUBJECT_CHARS),
      scene: scene || subject,
      composition,
      keywords,
      avoid,
      alt: alt || subject || scene,
    }
  } catch {
    return buildFallbackSelectionImageAnalysis(fallbackText)
  }
}

async function analyzeSelectionForImagePrompt(selectionText: string, knowledgeContext?: string): Promise<SelectionImageSemanticAnalysis> {
  const normalized = normalizeSelectionText(selectionText).slice(0, MAX_SELECTION_IMAGE_ANALYSIS_CHARS)
  if (!normalized) {
    return buildFallbackSelectionImageAnalysis(selectionText)
  }

  const knowledgeHint = knowledgeContext
    ? `\n以下是来自知识库的相关背景资料，可帮助你提取更贴合真实场景的视觉信息：\n${knowledgeContext.slice(0, 1200)}`
    : ''

  try {
    const response = await window.electronAPI.writingAssistant({
      language: 'zh',
      instruction: [
        '你是文档配图分析器。',
        '请从给定文本中提取适合用于生成配图的核心视觉信息。',
        '不要复述原文，不要加入任何画风、媒介、摄影或艺术风格描述。',
        '不要输出解释，只返回一个 JSON 对象。',
        'JSON 字段必须包含：subject(string), scene(string), composition(string), keywords(string[]), avoid(string[]), alt(string)。',
        'subject 表示最核心的配图主题；scene 表示一句画面摘要；composition 表示构图重点；keywords 保留 4 到 8 个关键词短语；avoid 写不该画入的元素。',
        'keywords 应优先提取对象、结构、过程、关系、环境，而不是整句原文。',
      ].join('\n'),
      extraContext: '这是图片生成前的语义提炼任务，不是写作任务。输出必须是 JSON。' + knowledgeHint,
      documentText: normalized,
    })
    return parseSelectionImageAnalysis(response, normalized)
  } catch (error) {
    console.warn('[image:selection-analysis:fallback]', error)
    return buildFallbackSelectionImageAnalysis(normalized)
  }
}

function createSelectionImagePrompt(analysis: SelectionImageSemanticAnalysis, keywordCount: number): SelectionImagePromptVariant {
  const keywords = analysis.keywords.slice(0, Math.max(1, keywordCount))
  const avoid = [...analysis.avoid, '任何可读文字', '字母', '数字', '标签', '坐标轴标题', '水印']
  const prompt = [
    '请生成一张适合插入文档正文的信息型配图。',
    `主题：${analysis.subject}`,
    keywords.length > 0 ? `核心关键词：${keywords.join('、')}` : '',
    analysis.scene ? `画面摘要：${analysis.scene}` : '',
    analysis.composition ? `构图要求：${analysis.composition}` : '',
    `避免内容：${Array.from(new Set(avoid)).join('、')}`,
    '要求：只表现与主题直接相关的主体、结构或过程，不要把原文整段塞进图片，不要出现任何文字、字母、数字、符号、公式、表格、标题、图例或水印；主体明确，层次清楚，适合作为学术或技术文档中的辅助插图。',
  ].filter(Boolean).join('\n')

  return {
    prompt,
    alt: normalizePromptField(analysis.alt || analysis.subject || keywords.join('、'), 80),
  }
}

export function buildSelectionImagePrompt(selectionText: string): SelectionImagePromptVariant {
  return createSelectionImagePrompt(buildFallbackSelectionImageAnalysis(selectionText), FALLBACK_SELECTION_IMAGE_KEYWORD_COUNTS[0])
}

export async function buildSelectionImagePromptVariants(selectionText: string, knowledgeContext?: string): Promise<SelectionImagePromptVariant[]> {
  const analysis = await analyzeSelectionForImagePrompt(selectionText, knowledgeContext)
  return FALLBACK_SELECTION_IMAGE_KEYWORD_COUNTS.map((count) => createSelectionImagePrompt(analysis, count))
}

export async function generateSelectionImage(
  selectionText: string,
  aspectRatio = '16:9',
  onAttempt?: (attempt: number, total: number) => void,
  knowledgeContext?: string,
): Promise<GenerateSelectionImageResult> {
  const variants = await buildSelectionImagePromptVariants(selectionText, knowledgeContext)
  let lastError = '图片生成失败'

  for (let index = 0; index < variants.length; index += 1) {
    const variant = variants[index]
    onAttempt?.(index + 1, variants.length)

    try {
      const result = await generateImage({
        prompt: variant.prompt,
        aspect_ratio: aspectRatio,
        negativePrompt: SELECTION_IMAGE_NO_TEXT_NEGATIVE_PROMPT,
      })
      if (result.status === 'success') {
        return {
          ...result,
          alt: variant.alt,
          attemptCount: index + 1,
          fallbackUsed: index > 0,
        }
      }

      lastError = result.error || lastError
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  return {
    status: 'failed',
    error: lastError,
    alt: variants[0]?.alt || '',
    attemptCount: variants.length,
    fallbackUsed: variants.length > 1,
  }
}

export function getDefaultInsertedGeneratedImageWidthPx(): number {
  return DEFAULT_INSERTED_GENERATED_IMAGE_WIDTH_PX
}

export async function generateImage(params: GenerateImageParams): Promise<GenerateImageResult> {
  const traceId = params.traceId || `img-svc-${Date.now()}`
  const references = Array.isArray(params.references) ? params.references : []
  const primaryReference = references.find((item) => item.role === 'primary-style') || null
  const styleOptions = normalizeImageStyleOptions(params.styleOptions)
  const generationMode = params.generationMode || DEFAULT_IMAGE_GENERATION_MODE
  const aspectRatio = params.aspectRatio || params.aspect_ratio || '16:9'

  console.info('[image:renderer-service]', JSON.stringify({
    traceId,
    handlerName: 'generateImage',
    serviceName: 'ImageService',
    rawUserPrompt: params.prompt,
    generationMode,
    aspectRatio,
    referenceImageCount: references.length,
    primaryReferenceId: primaryReference?.id || null,
    roleSummary: summarizeImageReferenceRoles(references),
    references: buildImageReferenceDebugItems(references),
    styleOptions,
    styleProfileSummary: params.styleProfile?.summary || null,
    debugEnabled: params.debug?.enabled === true,
    note: 'Structured image payload is forwarded to IPC at this layer without prompt rewriting',
  }))

  const result = (await window.electronAPI.generateImage({
    prompt: params.prompt,
    negativePrompt: params.negativePrompt,
    aspectRatio,
    filename: params.filename,
    workspacePath: params.workspacePath,
    references,
    referenceImages: references.map((item, index) => ({
      documentId: item.id,
      order: item.order ?? index,
      isPrimary: item.role === 'primary-style',
      role: item.role,
      weight: item.weight,
      filePath: item.filePath,
      fileName: item.fileName || item.name,
      contentType: item.contentType,
      dataUrl: item.dataUrl,
      url: item.url,
      origin: item.origin,
    })),
    primaryImageId: primaryReference?.id || null,
    selectedStyleImageIds: references.filter((item) => item.role !== 'content').map((item) => item.id),
    styleOptions,
    generationMode,
    styleProfile: params.styleProfile || null,
    traceId,
    debug: params.debug,
  })) as Record<string, any>

  if (result.localPath || result.path) {
    return {
      status: 'success',
      image_url: result.localPath || result.path,
      file_path: result.localPath || result.path,
      filename: (result.localPath || result.path || '').split(/[\\/]/).pop(),
    }
  }

  return {
    status: 'failed',
    error: result.error || '图片生成失败',
  }
}