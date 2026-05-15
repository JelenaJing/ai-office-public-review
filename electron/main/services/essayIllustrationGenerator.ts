import { app } from 'electron'
import { randomInt } from 'node:crypto'
import path from 'node:path'
import { completeText } from './llmClient'
import { generateImage } from './imageClient'
import type { AppSettings } from './settingsStore'
import {
  getEssayStylePreset,
  listEssayStylePresets,
  resolveEssayStyleReferenceImages,
  type EssayStylePreset,
  type EssayStylePresetId,
} from './essayStylePresets'

export interface EssayIllustrationStyleSelection {
  preset_id: EssayStylePresetId
  label: string
  artist_name: string
  reason?: string
  reference_count: number
}

export interface EssayIllustrationImage {
  path: string
  url: string
  markdown: string
  caption: string
  preset_id: EssayStylePresetId
  preset_label: string
  paragraph_index: number
  paragraph_excerpt: string
}

export interface EssayIllustrationResult {
  markdown: string
  style: EssayIllustrationStyleSelection
  images: EssayIllustrationImage[]
}

interface IllustrationTarget {
  blockIndex: number
  paragraphIndex: number
  text: string
  score: number
}

const ESSAY_IMAGE_NEGATIVE_PROMPT = [
  'text',
  'letters',
  'numbers',
  'typography',
  'watermark',
  'logo',
  'chart',
  'diagram',
  'infographic',
  'scientific figure',
  'table',
  'poster layout',
  'caption box',
].join(', ')

const SCENIC_KEYWORDS = ['风', '雨', '雪', '月', '夜', '晨', '暮', '光', '影', '云', '山', '海', '河', '湖', '树', '花', '叶', '窗', '街', '桥', '路', '灯', '院', '门', '水']

function abortError(): Error {
  return new Error('任务已停止')
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortError()
  }
}

function toFileUrl(localPath: string): string {
  const normalized = String(localPath || '').replace(/\\/g, '/')
  const encoded = encodeURI(normalized)
  if (!normalized) return normalized
  if (encoded.startsWith('/')) return `file://${encoded}`
  if (/^[a-zA-Z]:\//.test(encoded)) return `file:///${encoded}`
  return `file://${encoded}`
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

function resolveIllustrationOutputDir(workspacePath?: string): string {
  const normalizedWorkspacePath = String(workspacePath || '').trim()
  if (normalizedWorkspacePath) {
    return path.join(normalizedWorkspacePath, 'pic')
  }
  return path.join(app.getPath('userData'), 'generated-images', 'essay')
}

function summarizeEssayForStyleSelection(markdown: string): string {
  return String(markdown || '')
    .replace(/^#\s+/m, '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2200)
}

function buildStyleSelectionPrompt(topic: string, markdown: string, presets: EssayStylePreset[]): string {
  const presetDescriptions = presets.map((preset) => [
    `- preset_id: ${preset.id}`,
    `  label: ${preset.label}`,
    `  artist_name: ${preset.artistName}`,
    `  description: ${preset.description}`,
    `  keywords: ${preset.promptKeywords.join('、')}`,
  ].join('\n')).join('\n')

  return [
    '你是散文配图风格选择器。',
    '请从给定的 8 个固定 style preset 中严格选择 1 个，不能自造新风格，不能返回列表。',
    '选择标准：优先看散文的情绪、场景、节奏、想象程度与空间气质。',
    '输出必须是 JSON，不要输出任何解释。',
    '',
    `散文主题：${topic}`,
    `散文摘要：${summarizeEssayForStyleSelection(markdown)}`,
    '',
    '可选 preset：',
    presetDescriptions,
    '',
    'JSON 格式：',
    '{',
    '  "preset_id": "必须是上面 8 个 preset_id 之一",',
    '  "reason": "一句话解释为什么这个 preset 更适合当前散文"',
    '}',
  ].join('\n')
}

function fallbackPresetId(topic: string, presets: EssayStylePreset[]): EssayStylePresetId {
  const normalized = String(topic || '').trim() || '散文'
  const hash = Array.from(normalized).reduce((total, character) => total + character.charCodeAt(0), 0)
  return presets[hash % presets.length].id
}

async function selectEssayStylePreset(
  settings: AppSettings,
  topic: string,
  markdown: string,
  signal?: AbortSignal,
): Promise<{ preset: EssayStylePreset; reason?: string }> {
  const presets = listEssayStylePresets()
  throwIfAborted(signal)

  try {
    const response = await completeText(settings, {
      systemPrompt: '你是一名只会从固定枚举中做选择的风格路由器。你只能返回合法 JSON。',
      userPrompt: buildStyleSelectionPrompt(topic, markdown, presets),
      temperature: 0.2,
      maxTokens: 500,
    })
    throwIfAborted(signal)

    const parsed = parseJsonObject(response)
    const preset = getEssayStylePreset(String(parsed?.preset_id || '').trim())
    if (preset) {
      return {
        preset,
        reason: normalizeOptionalString(parsed?.reason),
      }
    }
  } catch {
    // Fall through to deterministic preset selection.
  }

  const preset = getEssayStylePreset(fallbackPresetId(topic, presets))
  if (!preset) {
    throw new Error('无法选定散文配图风格')
  }
  return {
    preset,
    reason: '已回退到系统内置 preset 路由策略。',
  }
}

function normalizeParagraphText(value: string): string {
  return String(value || '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function scoreParagraph(text: string): number {
  const normalized = normalizeParagraphText(text)
  if (!normalized) return -999
  if (normalized.startsWith('#')) return -999
  if (normalized.length < 45 || normalized.length > 260) return -999

  const scenicHits = SCENIC_KEYWORDS.reduce((total, keyword) => total + (normalized.includes(keyword) ? 1 : 0), 0)
  const punctuationHits = (normalized.match(/[，。、“”？！；：]/g) || []).length
  const balancedLengthScore = 120 - Math.abs(120 - normalized.length)
  return balancedLengthScore + scenicHits * 12 + Math.min(18, punctuationHits)
}

function pickIllustrationTargets(markdown: string, desiredCount = 2): IllustrationTarget[] {
  const blocks = String(markdown || '').trim().split(/\n{2,}/)
  const candidates = blocks
    .map((block, index) => ({
      blockIndex: index,
      paragraphIndex: index,
      text: normalizeParagraphText(block),
      score: scoreParagraph(block),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)

  if (candidates.length <= desiredCount) {
    return candidates.slice(0, desiredCount).sort((left, right) => left.blockIndex - right.blockIndex)
  }

  const selected: IllustrationTarget[] = []
  let remaining = candidates.slice(0, Math.min(6, candidates.length))

  while (selected.length < desiredCount && remaining.length > 0) {
    const pickWindow = Math.min(3, remaining.length)
    const picked = remaining[randomInt(pickWindow)]
    selected.push(picked)
    remaining = remaining.filter((item) => Math.abs(item.blockIndex - picked.blockIndex) >= 2)
  }

  if (selected.length < desiredCount) {
    for (const candidate of candidates) {
      if (selected.some((item) => item.blockIndex === candidate.blockIndex)) continue
      if (selected.some((item) => Math.abs(item.blockIndex - candidate.blockIndex) < 2)) continue
      selected.push(candidate)
      if (selected.length >= desiredCount) break
    }
  }

  return selected
    .slice(0, desiredCount)
    .sort((left, right) => left.blockIndex - right.blockIndex)
}

function buildIllustrationPrompt(topic: string, target: IllustrationTarget, preset: EssayStylePreset): string {
  return [
    '请为中文散文正文生成一张插图。',
    `散文主题：${topic}`,
    `目标段落：${target.text.slice(0, 220)}`,
    `强制风格 preset：${preset.label}`,
    `风格说明：${preset.description}`,
    `必须保留的视觉线索：${preset.promptKeywords.join('、')}`,
    `必须避免的视觉偏移：${preset.forbiddenKeywords.join('、')}`,
    '要求：画面只服务这一段的情绪与场景，不要画成论文插图、信息图、流程图、海报或摄影棚照片。',
    '要求：不出现文字、数字、Logo、水印、图表边框、标题条、字幕框。',
    '要求：适合作为文档正文中的内嵌配图，构图完整，主体清楚，情绪稳定。',
  ].join('\n')
}

function buildImageMarkdown(imageUrl: string, caption: string): string {
  return `![${caption}](${imageUrl})`
}

function injectImagesIntoMarkdown(markdown: string, images: EssayIllustrationImage[]): string {
  const blocks = String(markdown || '').trim().split(/\n{2,}/)
  const orderedImages = images.slice().sort((left, right) => right.paragraph_index - left.paragraph_index)
  for (const image of orderedImages) {
    const insertionIndex = Math.max(0, Math.min(blocks.length, image.paragraph_index + 1))
    blocks.splice(insertionIndex, 0, image.markdown)
  }
  return blocks.join('\n\n')
}

export async function generateEssayIllustrations(
  settings: AppSettings,
  params: {
    topic: string
    markdown: string
    workspacePath?: string
  },
  callbacks?: {
    onProgress?: (message: string) => void
    onImage?: (payload: { image: EssayIllustrationImage; cumulativeMarkdown: string }) => void
  },
  signal?: AbortSignal,
): Promise<EssayIllustrationResult> {
  const topic = String(params.topic || '').trim() || '散文'
  const baseMarkdown = String(params.markdown || '').trim()
  if (!baseMarkdown) {
    throw new Error('散文正文为空，无法生成配图')
  }

  const targets = pickIllustrationTargets(baseMarkdown, 2)
  if (targets.length === 0) {
    throw new Error('未找到适合插图的散文段落')
  }

  callbacks?.onProgress?.('正在为散文选择固定风格 preset...')
  const styleSelection = await selectEssayStylePreset(settings, topic, baseMarkdown, signal)
  throwIfAborted(signal)

  callbacks?.onProgress?.(`已选定配图风格：${styleSelection.preset.label}`)
  const references = await resolveEssayStyleReferenceImages(styleSelection.preset.id, 4)
  throwIfAborted(signal)

  const style: EssayIllustrationStyleSelection = {
    preset_id: styleSelection.preset.id,
    label: styleSelection.preset.label,
    artist_name: styleSelection.preset.artistName,
    reason: styleSelection.reason,
    reference_count: references.length,
  }

  const images: EssayIllustrationImage[] = []
  let cumulativeMarkdown = baseMarkdown
  const outputDir = resolveIllustrationOutputDir(params.workspacePath)

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index]
    throwIfAborted(signal)
    callbacks?.onProgress?.(`正在生成第 ${index + 1} 张散文插图...`)

    const caption = `${styleSelection.preset.artistName} 风格散文插图 ${index + 1}`
    const imageResult = await generateImage(settings, outputDir, {
      prompt: buildIllustrationPrompt(topic, target, styleSelection.preset),
      aspectRatio: settings.defaults.imageAspectRatio,
      negativePrompt: ESSAY_IMAGE_NEGATIVE_PROMPT,
      references,
      styleOptions: {
        styleStrength: 92,
        strictStyleLock: true,
        preserveComposition: false,
        creativity: 28,
      },
      generationMode: 'style-continuation',
      traceId: `essay-illustration-${Date.now()}-${index + 1}`,
      debug: {
        enabled: true,
        source: 'essay-writing',
      },
    }, (message) => {
      callbacks?.onProgress?.(message)
    })
    throwIfAborted(signal)

    const imageUrl = toFileUrl(imageResult.localPath)
    const image: EssayIllustrationImage = {
      path: imageResult.localPath,
      url: imageUrl,
      markdown: buildImageMarkdown(imageUrl, caption),
      caption,
      preset_id: styleSelection.preset.id,
      preset_label: styleSelection.preset.label,
      paragraph_index: target.blockIndex,
      paragraph_excerpt: target.text.slice(0, 120),
    }

    images.push(image)
    cumulativeMarkdown = injectImagesIntoMarkdown(baseMarkdown, images)
    callbacks?.onImage?.({ image, cumulativeMarkdown })
  }

  return {
    markdown: cumulativeMarkdown,
    style,
    images,
  }
}