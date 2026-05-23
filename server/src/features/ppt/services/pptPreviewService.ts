import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  getPptPreviewDir,
  sanitizePathSegment,
  type PptPreviewStatus,
} from './pptSessionStore'

const execFileAsync = promisify(execFile)

export interface PptPreviewResult {
  previewStatus: PptPreviewStatus
  previewImages: string[]
  message?: string
}

function isMissingCommand(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

async function resolveLibreOfficeCommand(): Promise<string | null> {
  for (const command of ['libreoffice', 'soffice']) {
    try {
      await execFileAsync(command, ['--version'], { timeout: 5_000, maxBuffer: 64 * 1024 })
      return command
    } catch (error) {
      if (!isMissingCommand(error)) {
        return command
      }
    }
  }
  return null
}

async function hasPdftoppm(): Promise<boolean> {
  try {
    await execFileAsync('pdftoppm', ['-v'], { timeout: 5_000, maxBuffer: 64 * 1024 })
    return true
  } catch (error) {
    return !isMissingCommand(error)
  }
}

function previewUrl(sessionId: string, fileName: string): string {
  return `/api/ppt/sessions/${encodeURIComponent(sessionId)}/slides/${encodeURIComponent(fileName)}`
}

export async function generatePptPreviewImages(options: {
  userId: string
  sessionId: string
  pptxPath: string
}): Promise<PptPreviewResult> {
  const userId = sanitizePathSegment(options.userId, 'web-user')
  const sessionId = sanitizePathSegment(options.sessionId, 'session')
  const previewDir = getPptPreviewDir(userId, sessionId)

  const libreOffice = await resolveLibreOfficeCommand()
  if (!libreOffice) {
    return {
      previewStatus: 'unavailable',
      previewImages: [],
      message: '当前服务器未安装 LibreOffice，无法生成 PPT 预览图。',
    }
  }

  if (!(await hasPdftoppm())) {
    return {
      previewStatus: 'unavailable',
      previewImages: [],
      message: '当前服务器未安装 pdftoppm，无法将 PDF 转为预览图。',
    }
  }

  await fs.rm(previewDir, { recursive: true, force: true })
  await fs.mkdir(previewDir, { recursive: true })

  try {
    await execFileAsync(
      libreOffice,
      ['--headless', '--convert-to', 'pdf', '--outdir', previewDir, options.pptxPath],
      { timeout: 60_000, maxBuffer: 1024 * 1024 },
    )

    const pdfPath = path.join(previewDir, `${path.basename(options.pptxPath, path.extname(options.pptxPath))}.pdf`)
    const pdfStat = await fs.stat(pdfPath).catch(() => null)
    if (!pdfStat || pdfStat.size <= 0) {
      return {
        previewStatus: 'failed',
        previewImages: [],
        message: 'LibreOffice 未输出有效 PDF，无法生成 PPT 预览图。',
      }
    }

    const prefix = path.join(previewDir, 'page')
    await execFileAsync('pdftoppm', ['-png', '-r', '144', pdfPath, prefix], {
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    })

    const generated = (await fs.readdir(previewDir))
      .filter((file) => /^page-\d+\.png$/i.test(file))
      .sort((left, right) => {
        const a = Number(left.match(/\d+/)?.[0] ?? '0')
        const b = Number(right.match(/\d+/)?.[0] ?? '0')
        return a - b
      })

    const renamed: string[] = []
    for (let index = 0; index < generated.length; index += 1) {
      const nextName = `page-${String(index + 1).padStart(3, '0')}.png`
      await fs.rename(path.join(previewDir, generated[index]), path.join(previewDir, nextName))
      renamed.push(nextName)
    }

    if (renamed.length === 0) {
      return {
        previewStatus: 'failed',
        previewImages: [],
        message: 'pdftoppm 未输出 PNG 预览图。',
      }
    }

    return {
      previewStatus: 'ready',
      previewImages: renamed.map((fileName) => previewUrl(sessionId, fileName)),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      previewStatus: 'failed',
      previewImages: [],
      message: `PPT 预览图生成失败：${message}`,
    }
  }
}
