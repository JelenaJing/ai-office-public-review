/**
 * PersonalLibraryService
 *
 * Completely independent from KnowledgeService / DepartmentService.
 * Manages user-uploaded files in userData/personal-library/.
 * No retrieval, no chunking, no remote API — just:
 *   upload → extract text → store → return full text on demand.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dialog } from 'electron'
import mammoth from 'mammoth'
import JSZip from 'jszip'
import { XMLParser } from 'fast-xml-parser'
import type {
  PersonalFolder,
  PersonalFile,
  PersonalFileSourceType,
  PersonalLibraryRegistry,
  PersonalImportResult,
} from '../../../src/types/personalLibrary'

const execFileAsync = promisify(execFile)

// ---------- constants ----------

const REGISTRY_VERSION = 1 as const
const MAX_PREVIEW_LEN = 200
const TEXT_TRUNCATE_CHARS = 80_000   // stored extracted.txt is full; getFileContent truncates to this

const PDF_PYTHON_SCRIPT = String.raw`
import sys

path = sys.argv[1]
reader = None
for module_name in ('pypdf', 'PyPDF2'):
    try:
        if module_name == 'pypdf':
            from pypdf import PdfReader
        else:
            from PyPDF2 import PdfReader
        reader = PdfReader(path)
        break
    except Exception:
        pass

if reader is None:
    sys.exit(2)

parts = []
for page in reader.pages:
    try:
        parts.append(page.extract_text() or '')
    except Exception:
        parts.append('')

sys.stdout.write('\n\n'.join(parts))
`

// ---------- XML parser (shared, stateless) ----------

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  isArray: () => false,
})

// ---------- helpers ----------

function nowIso(): string {
  return new Date().toISOString()
}

function normalizeText(raw: string): string {
  return (raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function previewText(text: string): string {
  return (text || '').slice(0, MAX_PREVIEW_LEN).replace(/\n+/g, ' ').trim()
}

async function hashFile(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath)
  return crypto.createHash('sha256').update(buf).digest('hex')
}

function resolveSourceType(filePath: string): PersonalFileSourceType {
  const ext = path.extname(String(filePath || '')).toLowerCase()
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'].includes(ext)) return 'image'
  if (ext === '.pdf') return 'pdf'
  if (ext === '.docx') return 'docx'
  if (ext === '.doc') return 'doc'
  if (ext === '.pptx') return 'pptx'
  if (ext === '.md' || ext === '.markdown') return 'md'
  return 'txt'
}

function detectMime(sourceType: PersonalFileSourceType): string {
  const map: Record<PersonalFileSourceType, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    md: 'text/markdown',
    txt: 'text/plain',
    image: 'image/*',
  }
  return map[sourceType] ?? 'application/octet-stream'
}

// ---------- text extraction ----------

async function extractPdfText(filePath: string): Promise<string> {
  for (const cmd of ['python3', 'python']) {
    try {
      const { stdout } = await execFileAsync(cmd, ['-c', PDF_PYTHON_SCRIPT, filePath], {
        timeout: 120_000,
        maxBuffer: 20 * 1024 * 1024,
      })
      const text = normalizeText(stdout)
      if (text) return text
    } catch {
      // try next
    }
  }
  try {
    const { stdout } = await execFileAsync('pdftotext', ['-layout', filePath, '-'], {
      timeout: 120_000,
      maxBuffer: 20 * 1024 * 1024,
    })
    const text = normalizeText(stdout)
    if (text) return text
  } catch {
    // fallthrough
  }
  throw new Error('当前环境缺少可用的 PDF 文本提取能力（pypdf/PyPDF2 或 pdftotext）')
}

async function extractDocxText(filePath: string): Promise<string> {
  const result = await mammoth.extractRawText({ path: filePath })
  return normalizeText(result.value || '')
}

/** Extract all visible text from a PPTX using JSZip + DrawingML parsing. */
async function extractPptxText(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath)
  const zip = await JSZip.loadAsync(buffer)

  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const na = parseInt(a.match(/(\d+)/)?.[1] ?? '0', 10)
      const nb = parseInt(b.match(/(\d+)/)?.[1] ?? '0', 10)
      return na - nb
    })

  const slideTexts: string[] = []
  for (const slideName of slideFiles) {
    const xml = await zip.file(slideName)?.async('string')
    if (!xml) continue
    const root = xmlParser.parse(xml) as Record<string, unknown>
    slideTexts.push(extractDrawingMlText(root))
  }
  return slideTexts.filter(Boolean).join('\n\n')
}

function extractDrawingMlText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const parts: string[] = []
  for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
    const local = key.includes(':') ? key.split(':')[1] : key
    if (local === 't') {
      if (typeof val === 'string') parts.push(val)
      else if (typeof val === 'number') parts.push(String(val))
      else if (val && typeof val === 'object') {
        const text = (val as Record<string, unknown>)['#text']
        if (text !== undefined) parts.push(String(text))
      }
    } else if (local !== '#text' && local !== '@_' && !key.startsWith('@_')) {
      parts.push(extractDrawingMlText(val))
    }
  }
  return parts.join('')
}

async function extractText(filePath: string, sourceType: PersonalFileSourceType): Promise<string> {
  if (sourceType === 'image') return ''
  if (sourceType === 'txt' || sourceType === 'md') {
    return normalizeText(await fs.readFile(filePath, 'utf-8'))
  }
  if (sourceType === 'docx' || sourceType === 'doc') {
    return extractDocxText(filePath)
  }
  if (sourceType === 'pptx') {
    return extractPptxText(filePath)
  }
  return extractPdfText(filePath)
}

// ---------- PersonalLibraryService ----------

export class PersonalLibraryService {
  private registry: PersonalLibraryRegistry | null = null

  constructor(private readonly rootPath: string) {}

  private get registryPath(): string {
    return path.join(this.rootPath, 'registry.json')
  }

  private fileDir(fileId: string): string {
    return path.join(this.rootPath, 'files', fileId)
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.rootPath, { recursive: true })
    await fs.mkdir(path.join(this.rootPath, 'files'), { recursive: true })
    this.registry = await this.readRegistry()
  }

  // ---- registry ----

  private async readRegistry(): Promise<PersonalLibraryRegistry> {
    try {
      const raw = await fs.readFile(this.registryPath, 'utf-8')
      const parsed = JSON.parse(raw) as PersonalLibraryRegistry
      if (parsed.version === 1 && Array.isArray(parsed.folders) && Array.isArray(parsed.files)) {
        return parsed
      }
    } catch {
      // file missing or corrupt — create fresh
    }
    const fresh: PersonalLibraryRegistry = { version: 1, folders: [], files: [] }
    await this.writeRegistry(fresh)
    return fresh
  }

  private async writeRegistry(reg: PersonalLibraryRegistry): Promise<void> {
    const tmp = this.registryPath + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(reg, null, 2), 'utf-8')
    await fs.rename(tmp, this.registryPath)
    this.registry = reg
  }

  private getRegistry(): PersonalLibraryRegistry {
    if (!this.registry) throw new Error('PersonalLibraryService not initialized')
    return this.registry
  }

  // ---- folders ----

  listFolders(): PersonalFolder[] {
    return [...this.getRegistry().folders]
  }

  async createFolder(name: string): Promise<PersonalFolder> {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('文件夹名称不能为空')
    const reg = this.getRegistry()
    const folder: PersonalFolder = {
      id: crypto.randomBytes(8).toString('hex'),
      name: trimmed,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    await this.writeRegistry({ ...reg, folders: [...reg.folders, folder] })
    return folder
  }

  async renameFolder(id: string, name: string): Promise<PersonalFolder> {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('文件夹名称不能为空')
    const reg = this.getRegistry()
    const idx = reg.folders.findIndex((f) => f.id === id)
    if (idx < 0) throw new Error(`文件夹不存在: ${id}`)
    const updated: PersonalFolder = { ...reg.folders[idx], name: trimmed, updatedAt: nowIso() }
    const folders = reg.folders.map((f, i) => (i === idx ? updated : f))
    await this.writeRegistry({ ...reg, folders })
    return updated
  }

  async deleteFolder(id: string): Promise<void> {
    const reg = this.getRegistry()
    // Move files in this folder to "unfiled" (folderId = null)
    const files = reg.files.map((f) => f.folderId === id ? { ...f, folderId: null, updatedAt: nowIso() } : f)
    const folders = reg.folders.filter((f) => f.id !== id)
    await this.writeRegistry({ ...reg, folders, files })
  }

  // ---- files ----

  listFiles(folderId?: string | null): PersonalFile[] {
    const reg = this.getRegistry()
    if (folderId === undefined || folderId === null) {
      return [...reg.files]
    }
    return reg.files.filter((f) => f.folderId === folderId)
  }

  getFile(fileId: string): PersonalFile | null {
    return this.getRegistry().files.find((f) => f.id === fileId) ?? null
  }

  async getFileContent(fileId: string): Promise<{ text: string; truncated: boolean; sourceType: PersonalFileSourceType }> {
    const file = this.getFile(fileId)
    if (!file) throw new Error(`文件不存在: ${fileId}`)
    if (file.extractionStatus === 'image-only') {
      return { text: '', truncated: false, sourceType: file.sourceType }
    }
    const extractedPath = path.join(this.rootPath, file.extractedRelativePath)
    let raw = ''
    try {
      raw = await fs.readFile(extractedPath, 'utf-8')
    } catch {
      return { text: '', truncated: false, sourceType: file.sourceType }
    }
    const truncated = raw.length > TEXT_TRUNCATE_CHARS
    return {
      text: truncated ? raw.slice(0, TEXT_TRUNCATE_CHARS) : raw,
      truncated,
      sourceType: file.sourceType,
    }
  }

  async moveFile(fileId: string, targetFolderId: string | null): Promise<PersonalFile> {
    const reg = this.getRegistry()
    const idx = reg.files.findIndex((f) => f.id === fileId)
    if (idx < 0) throw new Error(`文件不存在: ${fileId}`)
    if (targetFolderId !== null && !reg.folders.find((f) => f.id === targetFolderId)) {
      throw new Error(`目标文件夹不存在: ${targetFolderId}`)
    }
    const updated: PersonalFile = { ...reg.files[idx], folderId: targetFolderId, updatedAt: nowIso() }
    const files = reg.files.map((f, i) => (i === idx ? updated : f))
    await this.writeRegistry({ ...reg, files })
    return updated
  }

  async deleteFile(fileId: string): Promise<void> {
    const reg = this.getRegistry()
    const file = reg.files.find((f) => f.id === fileId)
    if (!file) return
    // Remove stored files (best-effort)
    try {
      await fs.rm(this.fileDir(fileId), { recursive: true, force: true })
    } catch {
      // ignore
    }
    await this.writeRegistry({ ...reg, files: reg.files.filter((f) => f.id !== fileId) })
  }

  // ---- import ----

  async importFiles(ownerWindow: Electron.BrowserWindow | null, folderId?: string | null): Promise<PersonalImportResult> {
    const result = await dialog.showOpenDialog(ownerWindow ?? undefined as any, {
      title: '选择要导入到个人文件库的文件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '支持的文件', extensions: ['pdf', 'docx', 'doc', 'pptx', 'txt', 'md', 'markdown', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })

    if (result.canceled || !result.filePaths.length) {
      return { imported: [], duplicates: [], failed: [], canceled: true }
    }

    return this.importFilesFromPaths(result.filePaths, folderId ?? null)
  }

  async importFilesFromPaths(filePaths: string[], folderId: string | null): Promise<PersonalImportResult> {
    const reg = this.getRegistry()
    const existingHashes = new Set(reg.files.map((f) => f.hash))

    const imported: PersonalFile[] = []
    const duplicates: PersonalFile[] = []
    const failed: Array<{ filePath: string; fileName: string; error: string }> = []

    for (const filePath of filePaths) {
      const fileName = path.basename(filePath)
      try {
        const hash = await hashFile(filePath)
        const existing = reg.files.find((f) => f.hash === hash)
        if (existing && existingHashes.has(hash)) {
          duplicates.push(existing)
          continue
        }

        const sourceType = resolveSourceType(filePath)
        const stat = await fs.stat(filePath)
        const fileId = crypto.randomBytes(10).toString('hex')
        const ext = path.extname(fileName).toLowerCase()
        const storedName = `source${ext}`

        // Create file directory and copy source
        const dir = this.fileDir(fileId)
        await fs.mkdir(dir, { recursive: true })
        const storedAbsPath = path.join(dir, storedName)
        await fs.copyFile(filePath, storedAbsPath)

        // Extract text
        let extractedText = ''
        let extractionStatus: PersonalFile['extractionStatus'] = 'pending'
        let errorMessage: string | undefined

        if (sourceType === 'image') {
          extractionStatus = 'image-only'
        } else {
          try {
            extractedText = await extractText(storedAbsPath, sourceType)
            extractionStatus = 'ready'
          } catch (err) {
            errorMessage = err instanceof Error ? err.message : String(err)
            extractionStatus = 'failed'
          }
        }

        // Save extracted text
        const extractedRelativePath = `files/${fileId}/extracted.txt`
        await fs.writeFile(path.join(dir, 'extracted.txt'), extractedText, 'utf-8')

        const now = nowIso()
        const fileRecord: PersonalFile = {
          id: fileId,
          name: fileName.replace(/\.[^.]+$/, ''),  // name without extension
          originalName: fileName,
          folderId: folderId,
          sourceType,
          mimeType: detectMime(sourceType),
          size: stat.size,
          hash,
          importedAt: now,
          updatedAt: now,
          storedRelativePath: `files/${fileId}/${storedName}`,
          extractedRelativePath,
          extractionStatus,
          extractedTextLength: extractedText.length,
          previewText: previewText(extractedText),
          errorMessage,
        }

        imported.push(fileRecord)
        existingHashes.add(hash)
      } catch (err) {
        failed.push({
          filePath,
          fileName,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    if (imported.length > 0) {
      const updated = this.getRegistry()
      await this.writeRegistry({ ...updated, files: [...updated.files, ...imported] })
    }

    return { imported, duplicates, failed, canceled: false }
  }
}
