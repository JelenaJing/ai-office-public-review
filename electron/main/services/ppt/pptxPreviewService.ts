/**
 * pptxPreviewService — converts a PPTX file into per-slide PNG thumbnails.
 *
 * Strategy (in priority order):
 *  1. PowerShell COM automation — works on Windows with PowerPoint installed.
 *  2. (Extensible) LibreOffice headless — future, not implemented.
 *  3. Graceful fallback — returns { success: false, warning } so the UI
 *     can show "PPT 已生成，请打开 PPT 查看" rather than crashing.
 *
 * Call site: deck:preview IPC handler in electron/main/index.ts
 */

import * as fs from 'fs'
import * as path from 'path'
import { spawn } from 'child_process'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PptxPreviewRequest {
  pptxPath: string
  previewDir: string          // where to write slide-001.png, slide-002.png, …
}

export interface PptxPreviewSlide {
  index: number               // 0-based
  imagePath: string           // absolute path to the PNG file
  title?: string
}

export interface PptxPreviewResult {
  success: boolean
  previewDir?: string
  slides?: PptxPreviewSlide[]
  warning?: string
  error?: string
}

// ---------------------------------------------------------------------------
// PowerShell COM renderer
// ---------------------------------------------------------------------------

/**
 * Exports each slide as a 1280×720 PNG via PowerPoint COM automation.
 * Returns paths to the generated images sorted by slide order.
 */
async function renderViaCom(pptxPath: string, previewDir: string): Promise<string[]> {
  // Escape paths for embedding in a here-string (single-quote-safe substitution).
  const safePptxPath = pptxPath.replace(/'/g, "''")
  const safePreviewDir = previewDir.replace(/'/g, "''")

  // msoTrue = -1, msoFalse = 0  (numeric to avoid namespace imports)
  const psScript = `
$ErrorActionPreference = 'Stop'
$pptApp = $null
$prs = $null
try {
  $pptApp = New-Object -ComObject 'PowerPoint.Application'
  $prs = $pptApp.Presentations.Open('${safePptxPath}', -1, 0, 0)
  $i = 1
  foreach ($slide in $prs.Slides) {
    $imgPath = '${safePreviewDir}' + '\\slide-' + ('{0:D3}' -f $i) + '.png'
    $slide.Export($imgPath, 'PNG', 1280, 720)
    $i++
  }
  Write-Output ('OK:' + $prs.Slides.Count)
} catch {
  Write-Error $_.Exception.Message
  exit 1
} finally {
  if ($prs) { try { $prs.Close() } catch {} }
  if ($pptApp) { try { $pptApp.Quit() } catch {} }
  [System.GC]::Collect()
  [System.GC]::WaitForPendingFinalizers()
}
`.trim()

  return new Promise((resolve, reject) => {
    const proc = spawn('powershell', [
      '-NonInteractive', '-NoProfile', '-NoLogo',
      '-Command', psScript,
    ], { windowsHide: true })

    let stdout = ''
    let stderr = ''
    proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })

    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code !== 0) {
        const msg = stderr.trim() || stdout.trim() || `exit code ${code}`
        return reject(new Error(`PowerPoint COM 导出失败: ${msg.slice(0, 400)}`))
      }

      // Collect PNG files written to previewDir
      let files: string[] = []
      try {
        files = fs.readdirSync(previewDir)
          .filter(f => f.toLowerCase().endsWith('.png'))
          .sort()
          .map(f => path.join(previewDir, f))
      } catch { /* dir might be empty */ }

      if (files.length === 0) {
        return reject(new Error('PowerPoint COM 导出完成但未找到 PNG 文件'))
      }
      resolve(files)
    })
  })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Renders a PPTX file to per-slide PNG thumbnails.
 * Never throws — always returns a PptxPreviewResult.
 */
export async function renderPptxPreview(req: PptxPreviewRequest): Promise<PptxPreviewResult> {
  const { pptxPath, previewDir } = req

  if (!fs.existsSync(pptxPath)) {
    return { success: false, error: `PPTX 文件不存在: ${pptxPath}` }
  }

  // Ensure preview directory exists
  try {
    fs.mkdirSync(previewDir, { recursive: true })
  } catch (mkErr) {
    return { success: false, error: `无法创建预览目录: ${mkErr instanceof Error ? mkErr.message : String(mkErr)}` }
  }

  // Attempt PowerShell COM
  let imagePaths: string[]
  try {
    imagePaths = await renderViaCom(pptxPath, previewDir)
  } catch (comErr) {
    const errMsg = comErr instanceof Error ? comErr.message : String(comErr)
    console.warn('[pptxPreview] COM rendering failed, returning warning:', errMsg)
    return {
      success: false,
      warning: `暂时无法生成 PPT 预览（${errMsg.slice(0, 120)}）。PPTX 文件已生成，请点击下载查看。`,
    }
  }

  const slides: PptxPreviewSlide[] = imagePaths.map((imgPath, i) => ({
    index: i,
    imagePath: imgPath,
  }))

  return {
    success: true,
    previewDir,
    slides,
  }
}
