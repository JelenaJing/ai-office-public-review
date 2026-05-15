import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import JSZip from 'jszip'

const execFileAsync = promisify(execFile)
const LIBREOFFICE_COMMANDS = ['soffice', 'libreoffice', 'lowriter']

export const WORD_COMPATIBILITY_ERROR_MESSAGE = '当前环境缺少老式 Word 自动转换能力（需要 soffice/libreoffice，或 Windows 上已安装 Microsoft Word）'

export interface PreparedCompatibleDocxSource {
  filePath: string
  converted: boolean
  tempDir?: string
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

export async function isStandardDocxPackage(filePath: string): Promise<boolean> {
  try {
    const zip = await JSZip.loadAsync(await fs.readFile(filePath))
    return Boolean(zip.file('word/document.xml'))
  } catch {
    return false
  }
}

async function stageLegacyWordSource(sourcePath: string, tempDir: string): Promise<string> {
  const stagedInputPath = path.join(tempDir, 'legacy-input.doc')
  await fs.copyFile(sourcePath, stagedInputPath)
  return stagedInputPath
}

async function tryLibreOfficeConversion(sourcePath: string, tempDir: string): Promise<string | null> {
  const stagedInputPath = await stageLegacyWordSource(sourcePath, tempDir)
  const convertedPath = path.join(tempDir, 'legacy-input.docx')

  for (const command of LIBREOFFICE_COMMANDS) {
    try {
      await fs.rm(convertedPath, { force: true })
      await execFileAsync(command, ['--headless', '--convert-to', 'docx', '--outdir', tempDir, stagedInputPath], {
        timeout: 120000,
        maxBuffer: 8 * 1024 * 1024,
      })
      if (await pathExists(convertedPath) && await isStandardDocxPackage(convertedPath)) {
        return convertedPath
      }
    } catch {
      continue
    }
  }

  return null
}

async function tryWindowsWordConversion(sourcePath: string, tempDir: string): Promise<string | null> {
  if (process.platform !== 'win32') return null

  const stagedInputPath = await stageLegacyWordSource(sourcePath, tempDir)
  const convertedPath = path.join(tempDir, 'legacy-input.docx')
  const scriptPath = path.join(tempDir, 'convert-word-to-docx.ps1')
  const script = [
    "$ErrorActionPreference = 'Stop'",
    'param([string]$InputPath, [string]$OutputPath)',
    '$word = $null',
    '$document = $null',
    'try {',
    '  $word = New-Object -ComObject Word.Application',
    '  $word.Visible = $false',
    '  $word.DisplayAlerts = 0',
    '  $document = $word.Documents.Open($InputPath, $false, $true)',
    '  $format = 16',
    "  if ($document -and $document.PSObject.Methods.Name -contains 'SaveAs2') {",
    '    $document.SaveAs2($OutputPath, $format)',
    '  } else {',
    '    $document.SaveAs([ref]$OutputPath, [ref]$format)',
    '  }',
    '} finally {',
    '  if ($document) { $document.Close($false) | Out-Null }',
    '  if ($word) { $word.Quit() | Out-Null }',
    '}',
  ].join('\n')

  try {
    await fs.writeFile(scriptPath, script, 'utf-8')
    await fs.rm(convertedPath, { force: true })
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, stagedInputPath, convertedPath], {
      timeout: 120000,
      maxBuffer: 8 * 1024 * 1024,
    })
    if (await pathExists(convertedPath) && await isStandardDocxPackage(convertedPath)) {
      return convertedPath
    }
  } catch {
    return null
  }

  return null
}

export async function prepareCompatibleDocxSource(sourcePath: string): Promise<PreparedCompatibleDocxSource> {
  const normalizedSourcePath = path.resolve(String(sourcePath || '').trim())
  if (!normalizedSourcePath) {
    throw new Error('模板路径不能为空')
  }

  const extension = path.extname(normalizedSourcePath).toLowerCase()
  if (extension === '.docx' && await isStandardDocxPackage(normalizedSourcePath)) {
    return { filePath: normalizedSourcePath, converted: false }
  }

  if (extension !== '.doc' && extension !== '.docx') {
    throw new Error('当前仅支持对 doc/docx 模板做自动兼容转换')
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-office-word-template-'))

  try {
    const convertedPath = process.platform === 'win32'
      ? await tryWindowsWordConversion(normalizedSourcePath, tempDir) || await tryLibreOfficeConversion(normalizedSourcePath, tempDir)
      : await tryLibreOfficeConversion(normalizedSourcePath, tempDir)

    if (!convertedPath) {
      throw new Error(WORD_COMPATIBILITY_ERROR_MESSAGE)
    }

    return {
      filePath: convertedPath,
      converted: true,
      tempDir,
    }
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

export async function cleanupPreparedCompatibleDocxSource(prepared?: PreparedCompatibleDocxSource | null): Promise<void> {
  if (!prepared?.tempDir) return
  await fs.rm(prepared.tempDir, { recursive: true, force: true }).catch(() => undefined)
}