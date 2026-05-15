import { app } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { ImageReferenceItem } from '../../../src/types/imageGeneration'

export type EssayStylePresetId =
  | 'Andhika_Ramadhian'
  | 'Cuno_Amiet'
  | 'Erin_Hanson'
  | 'Felix_Vallotton'
  | 'Joan_Miro'
  | 'Kawase_Hasui'
  | 'Reiji_Hiramatsu'
  | 'Sergiu_Ciochina'

export interface EssayStylePreset {
  id: EssayStylePresetId
  folderName: string
  artistName: string
  label: string
  description: string
  promptKeywords: string[]
  forbiddenKeywords: string[]
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])

const ESSAY_STYLE_PRESETS: EssayStylePreset[] = [
  {
    id: 'Andhika_Ramadhian',
    folderName: 'Andhika_Ramadhian',
    artistName: 'Andhika Ramadhian',
    label: 'Andhika Ramadhian 风格',
    description: '偏现代抒情插画，色彩清亮，画面通透，适合温暖、青春、轻盈的散文场景。',
    promptKeywords: ['清亮色面', '现代抒情插画', '通透空气感', '温暖光线'],
    forbiddenKeywords: ['摄影写实', '学术图表', '厚重油画肌理'],
  },
  {
    id: 'Cuno_Amiet',
    folderName: 'Cuno_Amiet',
    artistName: 'Cuno Amiet',
    label: 'Cuno Amiet 风格',
    description: '色块鲜明，装饰性较强，带有明快而带韵律的绘画感，适合节庆、明朗、热烈氛围。',
    promptKeywords: ['鲜明色块', '装饰性构图', '明快节奏', '高饱和绘画感'],
    forbiddenKeywords: ['黑白素描', '冷峻纪实摄影', '技术信息图'],
  },
  {
    id: 'Erin_Hanson',
    folderName: 'Erin_Hanson',
    artistName: 'Erin Hanson',
    label: 'Erin Hanson 风格',
    description: '笔触开阔，风景感强，色彩热烈，适合自然、行旅、广阔空间与抒情景致。',
    promptKeywords: ['开阔笔触', '风景绘画', '热烈自然光', '流动色彩'],
    forbiddenKeywords: ['扁平卡通', '实验图解', '灰暗单色摄影'],
  },
  {
    id: 'Felix_Vallotton',
    folderName: 'Felix_Vallotton',
    artistName: 'Felix Vallotton',
    label: 'Felix Vallotton 风格',
    description: '轮廓硬朗，平面化强，黑色分割感明显，适合克制、静观、带一点戏剧张力的段落。',
    promptKeywords: ['硬朗轮廓', '平面化色面', '克制戏剧性', '强分割'],
    forbiddenKeywords: ['柔焦摄影', '软萌卡通', '科技蓝信息界面'],
  },
  {
    id: 'Joan_Miro',
    folderName: 'Joan_Miro',
    artistName: 'Joan Miro',
    label: 'Joan Miro 风格',
    description: '抽象符号化、轻盈童趣、色点与线条关系强，适合梦境、想象、意识流或童真片段。',
    promptKeywords: ['抽象符号', '轻盈线条', '童趣想象', '自由构成'],
    forbiddenKeywords: ['写实人物肖像', '学术插图', '沉重厚涂写实'],
  },
  {
    id: 'Kawase_Hasui',
    folderName: 'Kawase_Hasui',
    artistName: 'Kawase Hasui',
    label: 'Kawase Hasui 风格',
    description: '木版画气质明显，安静、清冷、留白好，适合夜色、雨雪、孤寂、远景和东方诗性段落。',
    promptKeywords: ['木版画气质', '静谧留白', '清冷夜色', '东方诗意'],
    forbiddenKeywords: ['欧美卡通', '照片级高光', '数据图表'],
  },
  {
    id: 'Reiji_Hiramatsu',
    folderName: 'Reiji_Hiramatsu',
    artistName: 'Reiji Hiramatsu',
    label: 'Reiji Hiramatsu 风格',
    description: '东方工笔与装饰绘画结合，色调雅致，适合花木、水波、安静室内外的精致抒情片段。',
    promptKeywords: ['雅致装饰绘画', '东方细腻感', '花木水波', '静谧层次'],
    forbiddenKeywords: ['粗粝街头摄影', '论文图表', '卡通立绘'],
  },
  {
    id: 'Sergiu_Ciochina',
    folderName: 'Sergiu_Ciochina',
    artistName: 'Sergiu Ciochina',
    label: 'Sergiu Ciochina 风格',
    description: '画面更偏氛围化与电影感，适合回忆、沉思、城市或戏剧化情绪较强的散文场景。',
    promptKeywords: ['氛围化光影', '电影感', '情绪层次', '沉思场景'],
    forbiddenKeywords: ['卡通平涂', '实验示意图', '商品海报感'],
  },
]

function inferContentType(filePath: string): string {
  const extension = path.extname(String(filePath || '')).toLowerCase()
  if (extension === '.png') return 'image/png'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.gif') return 'image/gif'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.bmp') return 'image/bmp'
  return 'application/octet-stream'
}

function resolveEssayStylePresetBaseDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath || '', 'data', 'essay-style-presets')
    : path.join(app.getAppPath(), 'docs', 'photoes')
}

export function listEssayStylePresets(): EssayStylePreset[] {
  return ESSAY_STYLE_PRESETS.slice()
}

export function getEssayStylePreset(presetId: string): EssayStylePreset | null {
  return ESSAY_STYLE_PRESETS.find((item) => item.id === presetId) || null
}

export async function listEssayStylePresetImagePaths(presetId: EssayStylePresetId): Promise<string[]> {
  const preset = getEssayStylePreset(presetId)
  if (!preset) {
    throw new Error(`未知散文风格 preset: ${presetId}`)
  }

  const presetDir = path.join(resolveEssayStylePresetBaseDir(), preset.folderName)
  const entries = await fs.readdir(presetDir, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(presetDir, entry.name))
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right), 'zh-Hans-CN'))
}

export async function resolveEssayStyleReferenceImages(
  presetId: EssayStylePresetId,
  maxCount = 4,
): Promise<ImageReferenceItem[]> {
  const preset = getEssayStylePreset(presetId)
  if (!preset) {
    throw new Error(`未知散文风格 preset: ${presetId}`)
  }

  const imagePaths = (await listEssayStylePresetImagePaths(presetId)).slice(0, Math.max(1, maxCount))
  const references = await Promise.all(imagePaths.map(async (filePath, index) => {
    const fileBuffer = await fs.readFile(filePath)
    const contentType = inferContentType(filePath)
    const dataUrl = `data:${contentType};base64,${fileBuffer.toString('base64')}`
    return {
      id: `${preset.id}:${path.basename(filePath)}`,
      url: dataUrl,
      role: index === 0 ? 'primary-style' : 'style',
      weight: 0,
      name: `${preset.artistName} 参考 ${index + 1}`,
      origin: 'local' as const,
      filePath,
      fileName: path.basename(filePath),
      contentType,
      dataUrl,
      order: index,
    } satisfies ImageReferenceItem
  }))

  if (references.length === 0) {
    throw new Error(`散文风格 preset ${preset.label} 缺少可用参考图`)
  }

  return references
}