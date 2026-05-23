import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  getPptSessionDir,
  savePptSession,
  sanitizePathSegment,
  type PptSession,
} from './pptSessionStore'

const execFileAsync = promisify(execFile)
const SERVER_ROOT = path.resolve(__dirname, '../../../..')
const TEMP_ROOT = path.join(SERVER_ROOT, 'tmp', 'minimax-pptx')
const NODE_COMPILE_TIMEOUT_MS = 60_000

type SlideKind = 'cover' | 'agenda' | 'content' | 'comparison' | 'timeline' | 'summary'

interface SlidePlanItem {
  kind: SlideKind
  title: string
  subtitle?: string
  body?: string
  bullets: string[]
}

interface SlidePlan {
  title: string
  slides: SlidePlanItem[]
}

interface GenerateMinimaxPptxOptions {
  taskId: string
  userId: string
  prompt: string
  title?: string
  onProgress?: (progress: number, message: string) => void
}

export interface GenerateMinimaxPptxResult {
  sessionId: string
  pptxPath: string
  slideCount: number
}

function cleanText(value: string, fallback: string): string {
  const normalized = String(value || '')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return normalized || fallback
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value
}

function inferTitle(prompt: string, title?: string): string {
  if (title?.trim()) return truncateText(cleanText(title, '演示文稿'), 60)
  const firstLine = prompt.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
  return truncateText(cleanText(firstLine ?? prompt, '演示文稿'), 60)
}

function splitPromptIdeas(prompt: string): string[] {
  const normalized = cleanText(prompt, '')
  const roughParts = normalized
    .split(/[\n。！？；;.!?]+/)
    .map((part) => cleanText(part, ''))
    .filter(Boolean)

  if (roughParts.length >= 4) return roughParts.slice(0, 8)

  const words = normalized.split(/[，,、\s]+/).map((part) => cleanText(part, '')).filter(Boolean)
  if (words.length >= 4) return words.slice(0, 8)

  return [
    normalized,
    '明确目标受众与演示场景',
    '梳理核心观点和支撑材料',
    '形成可落地的行动建议',
  ].filter(Boolean)
}

function createSlidePlan(prompt: string, title?: string): SlidePlan {
  const deckTitle = inferTitle(prompt, title)
  const ideas = splitPromptIdeas(prompt)
  const agendaItems = ['背景与目标', '核心洞察', '方案设计', '实施路径', '总结建议']
  const contentSeeds = ideas.length >= 4 ? ideas.slice(0, 4) : agendaItems.slice(0, 4)

  const contentSlides = contentSeeds.map((seed, index): SlidePlanItem => ({
    kind: index === 2 ? 'comparison' : 'content',
    title: truncateText(seed, 34),
    body: `围绕“${deckTitle}”展开第 ${index + 1} 个关键部分，突出结论、依据和执行重点。`,
    bullets: [
      `关键观点：${truncateText(seed, 42)}`,
      '结合目标受众，保留可汇报、可讨论、可执行的信息',
      '用清晰层次组织内容，减少口头补充成本',
      '输出下一步建议，便于后续完善与编辑',
    ],
  }))

  return {
    title: deckTitle,
    slides: [
      {
        kind: 'cover',
        title: deckTitle,
        subtitle: 'AI-Office Web · MiniMax Direct PPTX',
        bullets: [],
      },
      {
        kind: 'agenda',
        title: '目录',
        bullets: agendaItems,
      },
      ...contentSlides,
      {
        kind: 'timeline',
        title: '推进节奏',
        body: '从需求澄清到成果交付，建议按阶段推进并持续校准。',
        bullets: ['需求确认', '资料整理', '内容生成', '预览校对', '下载交付'],
      },
      {
        kind: 'summary',
        title: '总结',
        body: `本演示围绕“${deckTitle}”形成初版 PPTX，可继续下载后在 PowerPoint 中精修。`,
        bullets: ['已生成可下载 PPTX', '已保留清晰页面结构', '后续可扩展在线编辑能力'],
      },
    ],
  }
}

function slideFileName(index: number): string {
  return `slide-${String(index + 1).padStart(2, '0')}.js`
}

function createSlideModule(slide: SlidePlanItem, index: number): string {
  const data = JSON.stringify({ ...slide, index }, null, 2)
  return `'use strict'

function splitBullets(items) {
  return Array.isArray(items) ? items.map((item) => String(item || '').trim()).filter(Boolean) : []
}

function addBulletList(slide, bullets, x, y, w, fontSize, color) {
  splitBullets(bullets).slice(0, 6).forEach((item, index) => {
    slide.addText('• ' + item, {
      x,
      y: y + index * 0.43,
      w,
      h: 0.34,
      fontFace: 'Microsoft YaHei',
      fontSize,
      color,
      breakLine: false,
      fit: 'shrink',
    })
  })
}

function createSlide(pres, theme) {
  const data = ${data}
  const slide = pres.addSlide()
  slide.background = { color: theme.background }
  slide.addText(String(data.index + 1).padStart(2, '0'), {
    x: 12.05,
    y: 6.85,
    w: 0.7,
    h: 0.22,
    fontFace: 'Aptos',
    fontSize: 8,
    color: theme.muted,
    align: 'right',
  })

  if (data.kind === 'cover') {
    slide.addText(data.title, {
      x: 0.85,
      y: 1.8,
      w: 11.5,
      h: 0.95,
      fontFace: 'Microsoft YaHei',
      fontSize: 34,
      bold: true,
      color: theme.accent,
      fit: 'shrink',
      breakLine: false,
    })
    slide.addText(data.subtitle || '', {
      x: 0.9,
      y: 2.95,
      w: 10.8,
      h: 0.4,
      fontFace: 'Microsoft YaHei',
      fontSize: 15,
      color: theme.text,
    })
    slide.addText('Generated by AI-Office Web', {
      x: 0.92,
      y: 5.9,
      w: 4.2,
      h: 0.28,
      fontFace: 'Aptos',
      fontSize: 10,
      color: theme.muted,
    })
    return
  }

  slide.addText(data.title, {
    x: 0.65,
    y: 0.52,
    w: 11.3,
    h: 0.55,
    fontFace: 'Microsoft YaHei',
    fontSize: 24,
    bold: true,
    color: theme.accent,
    fit: 'shrink',
    breakLine: false,
  })

  if (data.body) {
    slide.addText(data.body, {
      x: 0.7,
      y: 1.28,
      w: 11.2,
      h: 0.56,
      fontFace: 'Microsoft YaHei',
      fontSize: 12,
      color: theme.text,
      fit: 'shrink',
    })
  }

  if (data.kind === 'comparison') {
    slide.addText('当前重点', { x: 0.9, y: 2.15, w: 4.8, h: 0.32, fontFace: 'Microsoft YaHei', fontSize: 15, bold: true, color: theme.text })
    slide.addText('优化方向', { x: 6.65, y: 2.15, w: 4.8, h: 0.32, fontFace: 'Microsoft YaHei', fontSize: 15, bold: true, color: theme.text })
    addBulletList(slide, data.bullets.slice(0, 2), 0.95, 2.75, 4.75, 12, theme.text)
    addBulletList(slide, data.bullets.slice(2), 6.7, 2.75, 4.75, 12, theme.text)
    return
  }

  if (data.kind === 'timeline') {
    splitBullets(data.bullets).slice(0, 5).forEach((item, step) => {
      slide.addText(String(step + 1), { x: 1.0 + step * 2.15, y: 2.45, w: 0.34, h: 0.28, fontFace: 'Aptos', fontSize: 11, bold: true, color: theme.accent, align: 'center' })
      slide.addText(item, { x: 0.62 + step * 2.15, y: 2.92, w: 1.45, h: 0.52, fontFace: 'Microsoft YaHei', fontSize: 11, color: theme.text, align: 'center', fit: 'shrink' })
    })
    return
  }

  addBulletList(slide, data.bullets, 0.95, 2.15, 10.8, data.kind === 'agenda' ? 15 : 13, theme.text)
}

module.exports = { createSlide }
`
}

function createCompileScript(slideFiles: string[]): string {
  return `'use strict'

const fs = require('fs')
const path = require('path')
const pptxgen = require('pptxgenjs')

async function main() {
  const pres = new pptxgen()
  pres.layout = 'LAYOUT_WIDE'
  pres.author = 'AI-Office Web'
  pres.subject = 'MiniMax Direct PPTX'
  pres.title = 'AI-Office Presentation'
  pres.company = 'AI-Office'
  pres.lang = 'zh-CN'
  pres.theme = {
    headFontFace: 'Microsoft YaHei',
    bodyFontFace: 'Microsoft YaHei',
    lang: 'zh-CN',
  }

  const theme = {
    background: 'F8FAFC',
    accent: '2563EB',
    text: '1E293B',
    muted: '64748B',
  }

  for (const file of ${JSON.stringify(slideFiles)}) {
    const mod = require(path.join(__dirname, file))
    if (!mod || typeof mod.createSlide !== 'function') {
      throw new Error('Invalid slide module: ' + file)
    }
    mod.createSlide(pres, theme)
  }

  const outputDir = path.join(__dirname, 'output')
  fs.mkdirSync(outputDir, { recursive: true })
  await pres.writeFile({ fileName: path.join(outputDir, 'presentation.pptx') })
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error))
  process.exit(1)
})
`
}

async function runOptionalMarkitdownQa(pptxPath: string): Promise<void> {
  if (process.env.MINIMAX_PPTX_MARKITDOWN_QA !== '1') return

  try {
    await execFileAsync('python', ['-m', 'markitdown', pptxPath], {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    })
  } catch {
    // Optional QA must not block a valid PPTX download.
  }
}

export async function generateMinimaxPptx(
  options: GenerateMinimaxPptxOptions,
): Promise<GenerateMinimaxPptxResult> {
  const { taskId, prompt, title, onProgress } = options
  const userId = sanitizePathSegment(options.userId, 'web-user')
  const sessionId = sanitizePathSegment(`ppt-${crypto.randomUUID()}`, 'ppt-session')
  const taskRoot = path.join(TEMP_ROOT, sanitizePathSegment(taskId, 'task'))
  const slidesDir = path.join(taskRoot, 'slides')
  const imgsDir = path.join(slidesDir, 'imgs')
  const outputDir = path.join(slidesDir, 'output')

  try {
    onProgress?.(10, '正在创建 MiniMax PPTX 临时目录')
    await fs.mkdir(imgsDir, { recursive: true })
    await fs.mkdir(outputDir, { recursive: true })

    onProgress?.(20, '正在根据主题生成 slidePlan')
    const plan = createSlidePlan(prompt, title)
    const slideFiles = plan.slides.map((slide, index) => slideFileName(index))

    onProgress?.(35, '正在生成 slide-XX.js 页面文件')
    await Promise.all(plan.slides.map((slide, index) => (
      fs.writeFile(path.join(slidesDir, slideFileName(index)), createSlideModule(slide, index), 'utf-8')
    )))

    onProgress?.(50, '正在生成 compile.js')
    await fs.writeFile(path.join(slidesDir, 'compile.js'), createCompileScript(slideFiles), 'utf-8')

    onProgress?.(65, '正在执行 node compile.js 生成 PPTX')
    try {
      await execFileAsync(process.execPath, ['compile.js'], {
        cwd: slidesDir,
        timeout: NODE_COMPILE_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
      })
    } catch (error) {
      const failure = error as { message?: string; stderr?: string }
      const detail = failure.stderr?.trim() || failure.message || 'compile.js 执行失败'
      throw new Error(`MiniMax PPTX 编译失败：${detail}`)
    }

    const generatedPath = path.join(outputDir, 'presentation.pptx')
    const stat = await fs.stat(generatedPath).catch(() => null)
    if (!stat || stat.size <= 0) {
      throw new Error('MiniMax PPTX 生成失败：presentation.pptx 不存在或为空')
    }

    onProgress?.(80, '正在执行可选 PPTX 文本 QA')
    await runOptionalMarkitdownQa(generatedPath)

    onProgress?.(88, '正在保存 PPT 会话')
    const sessionDir = getPptSessionDir(userId, sessionId)
    await fs.mkdir(sessionDir, { recursive: true })
    const pptxPath = path.join(sessionDir, 'presentation.pptx')
    await fs.copyFile(generatedPath, pptxPath)

    const now = new Date().toISOString()
    const session: PptSession = {
      id: sessionId,
      userId,
      title: plan.title,
      prompt,
      pptxPath,
      previewImages: [],
      previewStatus: 'pending',
      slideCount: plan.slides.length,
      createdAt: now,
      updatedAt: now,
    }
    await savePptSession(session)

    return {
      sessionId,
      pptxPath,
      slideCount: plan.slides.length,
    }
  } finally {
    await fs.rm(taskRoot, { recursive: true, force: true })
  }
}
