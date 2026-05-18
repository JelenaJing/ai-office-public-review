import fs from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import path from 'node:path'
import { DocumentEngineService, type OoxmlPackageSnapshot } from './documentEngineService'
import {
  compileDocumentSchemaToOoxmlBlocks,
  coerceLegacyDocxContentToDocumentSchema,
  importDocumentSchemaFromOoxmlSnapshot,
  resolveDocumentSchemaDocumentSectionPropertiesXml,
  resolveDocumentSchemaDocxTemplateMode,
  type DocumentSchemaDocxTemplateMode,
} from './documentSchemaDocxBoundary'
import { cleanupPreparedCompatibleDocxSource, prepareCompatibleDocxSource } from './wordDocumentCompatibility'
import {
  buildDocumentSchemaFromText,
  createDocumentSchema,
  createImageBlock,
  createParagraphBlock,
  normalizeDocumentSchema,
  serializeDocumentSchemaToHtml,
  type DocumentResource,
  type DocumentSchema,
} from '../../../src/document/schema'
import { renderDocumentCitationsForExport } from '../../../src/utils/documentCitations'

const docxDocumentEngineService = new DocumentEngineService()
const WORKSPACE_DOCUMENT_JSON_FILE = 'document.json'
const WORKSPACE_ASSETS_DIR = 'images'
const WORKSPACE_DOCUMENTS_DIR = 'documents'
const WORKSPACE_KNOWLEDGE_DIR = 'knowledge'
const WORKSPACE_PPT_DIR = 'ppt'
const WORKSPACE_DAILY_REPORTS_DIR = 'daily-reports'
const WORKSPACE_TASK_HISTORY_FILE = '.task-history.json'

export interface FileTreeNode {
  name: string
  path: string
  relativePath: string
  type: 'file' | 'folder'
  size?: number
  children?: FileTreeNode[]
}

export interface WorkspaceInfo {
  name: string
  path: string
  hasDocument: boolean
  modifiedAt: string
}

export interface WorkspaceDocumentReadResult {
  success: boolean
  source: 'document-json' | 'legacy-workspace' | 'empty'
  jsonPath: string
  legacySourcePath: string | null
  document: DocumentSchema
  compatHtml: string
  displayName: string
}

export interface WorkspaceDocumentSaveResult {
  success: boolean
  jsonPath: string
  document: DocumentSchema
  compatHtml: string
  displayName: string
  resourceCount: number
}

interface WorkspaceServiceOptions {
  legacyBaseDirs?: string[]
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true })
}

function nowIsoString(): string {
  return new Date().toISOString()
}

function sanitizeWorkspaceName(rawName: string, fallback = `workspace-${Date.now()}`): string {
  const normalized = String(rawName || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return normalized || fallback
}

function sanitizeAssetFileName(rawName: string, fallbackExtension = '.png'): string {
  const extension = path.extname(rawName || '').trim() || fallbackExtension
  const baseName = path.basename(String(rawName || '').trim(), extension)
  const normalizedBase = baseName
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  return `${normalizedBase || `image_${Date.now()}`}${extension}`
}

function guessExtensionFromMimeType(mimeType: string | undefined): string {
  switch (String(mimeType || '').toLowerCase()) {
    case 'image/jpeg':
      return '.jpg'
    case 'image/gif':
      return '.gif'
    case 'image/webp':
      return '.webp'
    case 'image/svg+xml':
      return '.svg'
    default:
      return '.png'
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

function normalizeRelativePath(relativePath: string): string {
  return String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '').trim()
}

function toWorkspaceDocumentJsonPath(wsPath: string): string {
  return path.join(wsPath, WORKSPACE_DOCUMENT_JSON_FILE)
}

function toWorkspaceAssetsDir(wsPath: string): string {
  return path.join(wsPath, WORKSPACE_ASSETS_DIR)
}

function toWorkspaceTaskHistoryPath(wsPath: string): string {
  return path.join(wsPath, WORKSPACE_TASK_HISTORY_FILE)
}

function toWorkspaceDocumentsDir(wsPath: string): string {
  return path.join(wsPath, WORKSPACE_DOCUMENTS_DIR)
}

function toWorkspaceKnowledgeDir(wsPath: string): string {
  return path.join(wsPath, WORKSPACE_KNOWLEDGE_DIR)
}

function toWorkspacePptDir(wsPath: string): string {
  return path.join(wsPath, WORKSPACE_PPT_DIR)
}

function buildWorkspaceDocumentId(wsPath: string): string {
  return `workspace:${path.basename(wsPath) || 'document'}`
}

function buildWorkspaceDisplayName(wsPath: string, document: DocumentSchema): string {
  const title = String(document.meta?.title || '').trim()
  return title || path.basename(wsPath) || '未命名文稿'
}

function isPathInsideWorkspace(wsPath: string, targetPath: string): boolean {
  const workspaceRoot = path.resolve(wsPath)
  const absoluteTarget = path.resolve(targetPath)
  return absoluteTarget === workspaceRoot || absoluteTarget.startsWith(`${workspaceRoot}${path.sep}`)
}

function toWorkspaceRelativePath(wsPath: string, targetPath: string): string {
  return path.relative(wsPath, targetPath).replace(/\\/g, '/')
}

function maybeResolveWorkspaceRelativePath(wsPath: string, resourcePath: string): string {
  const normalized = normalizeRelativePath(resourcePath)
  if (!normalized) return resourcePath
  const candidate = resolveWorkspacePath(wsPath, normalized)
  return candidate
}

function inferImageMimeType(value: string | undefined): string | undefined {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return undefined
  if (normalized.startsWith('data:image/')) {
    const match = normalized.match(/^data:(image\/[a-z0-9.+-]+);base64,/i)
    return match?.[1]
  }
  if (normalized.endsWith('.png')) return 'image/png'
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg'
  if (normalized.endsWith('.gif')) return 'image/gif'
  if (normalized.endsWith('.webp')) return 'image/webp'
  if (normalized.endsWith('.svg')) return 'image/svg+xml'
  return undefined
}

function normalizeImageAlign(value: unknown): 'left' | 'center' | 'right' | undefined {
  const normalized = String(value || '').trim()
  if (normalized === 'left' || normalized === 'center' || normalized === 'right') {
    return normalized
  }
  return undefined
}

function parseDataUrlPayload(dataUrl: string): { mimeType: string; base64: string } | null {
  const match = String(dataUrl || '').trim().match(/^data:([^;]+);base64,(.+)$/i)
  if (!match) return null
  return {
    mimeType: match[1],
    base64: match[2],
  }
}

function isUrlLike(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function buildEmptyWorkspaceDocument(wsPath: string): DocumentSchema {
  const workspaceName = path.basename(wsPath) || '未命名文稿'
  return createDocumentSchema({
    id: buildWorkspaceDocumentId(wsPath),
    profile: 'freewrite',
    title: workspaceName,
    sourceType: 'workspace-json',
    metadata: {
      workspacePath: wsPath,
    },
    blocks: [
      createParagraphBlock({
        id: 'block-1',
        text: '',
      }),
    ],
  })
}

function resolveWorkspacePath(wsPath: string, relativePath: string): string {
  const workspaceRoot = path.resolve(wsPath)
  const targetPath = path.resolve(workspaceRoot, normalizeRelativePath(relativePath))
  const workspacePrefix = `${workspaceRoot}${path.sep}`
  if (targetPath !== workspaceRoot && !targetPath.startsWith(workspacePrefix)) {
    throw new Error('工作区路径非法')
  }
  return targetPath
}

/**
 * isFormalTemplateWorkCopy — 跨平台判断路径是否属于正式模板工作副本目录。
 * 检查路径是否包含名为 '.formal-template' 的路径分量（而非子字符串），
 * 对 Unix（/a/.formal-template/b）和 Windows（C:\a\.formal-template\b）均正确。
 */
function isFormalTemplateWorkCopy(targetPath: string): boolean {
  const parts = path.normalize(targetPath).split(path.sep)
  return parts.includes('.formal-template')
}

function safeDecodeUriValue(value: string): string {
  try {
    return decodeURI(value)
  } catch {
    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }
}

function sanitizeImageFilename(value: string, fallback: string): string {
  const decoded = safeDecodeUriValue(String(value || '').trim().replace(/^['"]|['"]$/g, ''))
  const basename = path.basename(decoded.split(/[?#]/)[0] || '')
  const cleaned = basename
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || fallback
}

async function ensureUniqueTargetPath(targetPath: string): Promise<string> {
  if (!(await pathExists(targetPath))) return targetPath

  const directory = path.dirname(targetPath)
  const extension = path.extname(targetPath)
  const baseName = path.basename(targetPath, extension)
  let index = 1
  while (true) {
    const candidate = path.join(directory, `${baseName} copy${index > 1 ? ` ${index}` : ''}${extension}`)
    if (!(await pathExists(candidate))) return candidate
    index += 1
  }
}

async function listFilesRecursively(dirPath: string): Promise<string[]> {
  if (!(await pathExists(dirPath))) return []

  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolutePath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      return listFilesRecursively(absolutePath)
    }
    return [absolutePath]
  }))

  return nested.flat()
}

function normalizeTaskHistoryEntry(task: unknown): Record<string, unknown> | null {
  if (!task || typeof task !== 'object' || Array.isArray(task)) return null
  const record = { ...(task as Record<string, unknown>) }
  const taskId = String(record.task_id || record.taskId || '').trim()
  if (!taskId) return null

  if (!record.task_id) record.task_id = taskId
  if (!record.created_at) record.created_at = nowIsoString()
  record.updated_at = String(record.updated_at || nowIsoString())
  return record
}

async function readWorkspaceTaskHistoryCollection(filePath: string): Promise<Record<string, unknown>[]> {
  if (!(await pathExists(filePath))) return []
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => normalizeTaskHistoryEntry(item))
      .filter((item): item is Record<string, unknown> => Boolean(item))
  } catch {
    return []
  }
}

async function writeWorkspaceTaskHistoryCollection(filePath: string, tasks: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
  const merged = new Map<string, Record<string, unknown>>()
  for (const item of tasks) {
    const normalized = normalizeTaskHistoryEntry(item)
    if (!normalized) continue
    const taskId = String(normalized.task_id)
    merged.set(taskId, {
      ...(merged.get(taskId) || {}),
      ...normalized,
      updated_at: String(normalized.updated_at || nowIsoString()),
    })
  }

  const next = Array.from(merged.values())
    .sort((left, right) => String(right.updated_at || right.created_at || '').localeCompare(String(left.updated_at || left.created_at || '')))
  await ensureDir(path.dirname(filePath))
  await fs.writeFile(filePath, JSON.stringify(next, null, 2), 'utf-8')
  return next
}

async function moveFilesIntoDirectory(sourceDir: string, targetDir: string, shouldSkip?: (filePath: string) => boolean): Promise<void> {
  if (!(await pathExists(sourceDir))) return

  await ensureDir(targetDir)
  const files = await listFilesRecursively(sourceDir)
  for (const filePath of files) {
    if (shouldSkip?.(filePath)) continue
    const targetPath = await ensureUniqueTargetPath(path.join(targetDir, path.basename(filePath)))
    await ensureDir(path.dirname(targetPath))
    await fs.rename(filePath, targetPath)
  }
}

function isLegacyReferenceRootFile(fileName: string): boolean {
  return fileName === 'references.json' || fileName === 'References_List.txt'
}

function isReferenceSidecarFile(fileName: string): boolean {
  return /\.references\.(json|txt)$/i.test(fileName)
}

function isExperimentPlanFile(fileName: string): boolean {
  return /^实验思路(\.[^.]+)?$/i.test(fileName)
}

function isExperimentPlanArtifactFile(fileName: string): boolean {
  return /^实验思路(?:\.references)?(?:\.[^.]+)?$/i.test(fileName)
}

function isDocumentCandidateFile(fileName: string): boolean {
  if (isLegacyReferenceRootFile(fileName) || isReferenceSidecarFile(fileName) || isExperimentPlanFile(fileName)) {
    return false
  }
  // Native lossless format — check full suffix before falling back to single extension
  if (fileName.toLowerCase().endsWith('.aidoc.json')) return true
  const extension = path.extname(fileName).toLowerCase()
  return ['.docx', '.doc', '.md', '.markdown', '.txt', '.html', '.htm'].includes(extension)
}

async function buildTree(rootPath: string, currentPath = rootPath): Promise<FileTreeNode[]> {
  const entries = await fs.readdir(currentPath, { withFileTypes: true })
  const nodes = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith('.'))
      .map(async (entry) => {
        const absolutePath = path.join(currentPath, entry.name)
        const relativePath = path.relative(rootPath, absolutePath).replace(/\\/g, '/')
        if (entry.isDirectory()) {
          return {
            name: entry.name,
            path: absolutePath,
            relativePath,
            type: 'folder' as const,
            children: await buildTree(rootPath, absolutePath),
          }
        }

        return {
          name: entry.name,
          path: absolutePath,
          relativePath,
          type: 'file' as const,
          size: (await fs.stat(absolutePath)).size,
        }
      }),
  )

  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

async function copyLocalOrRemoteImage(source: string, targetPath: string): Promise<void> {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source)
    if (!response.ok) {
      throw new Error(`图片下载失败: ${response.status}`)
    }
    await fs.writeFile(targetPath, Buffer.from(await response.arrayBuffer()))
    return
  }

  const normalized = normalizeLocalImagePath(source)
  await fs.copyFile(normalized, targetPath)
}

async function materializeDataUrlAsset(wsPath: string, dataUrl: string, preferredName: string): Promise<{ absolutePath: string; relativePath: string; mimeType: string }> {
  const payload = parseDataUrlPayload(dataUrl)
  if (!payload) {
    throw new Error('无效的 data URL 图片资源')
  }
  const assetsDir = toWorkspaceAssetsDir(wsPath)
  await ensureDir(assetsDir)
  const extension = guessExtensionFromMimeType(payload.mimeType)
  const targetPath = await ensureUniqueTargetPath(path.join(assetsDir, sanitizeAssetFileName(preferredName, extension)))
  await fs.writeFile(targetPath, Buffer.from(payload.base64, 'base64'))
  return {
    absolutePath: targetPath,
    relativePath: toWorkspaceRelativePath(wsPath, targetPath),
    mimeType: payload.mimeType,
  }
}

async function materializeWorkspaceImageAsset(
  wsPath: string,
  source: string,
  preferredName: string,
): Promise<{ absolutePath: string; relativePath: string; mimeType?: string }> {
  const normalizedSource = String(source || '').trim()
  if (!normalizedSource) {
    throw new Error('图片资源为空')
  }

  if (normalizedSource.startsWith('data:image/')) {
    return materializeDataUrlAsset(wsPath, normalizedSource, preferredName)
  }

  const normalizedLocalPath = isUrlLike(normalizedSource)
    ? normalizedSource
    : normalizeLocalImagePath(normalizedSource)

  if (!isUrlLike(normalizedSource) && !path.isAbsolute(normalizedLocalPath)) {
    const workspaceRelativeCandidate = resolveWorkspacePath(wsPath, normalizedLocalPath)
    if (await pathExists(workspaceRelativeCandidate)) {
      return {
        absolutePath: workspaceRelativeCandidate,
        relativePath: toWorkspaceRelativePath(wsPath, workspaceRelativeCandidate),
        mimeType: inferImageMimeType(workspaceRelativeCandidate),
      }
    }
  }

  if (!isUrlLike(normalizedSource) && path.isAbsolute(normalizedLocalPath) && isPathInsideWorkspace(wsPath, normalizedLocalPath)) {
    return {
      absolutePath: normalizedLocalPath,
      relativePath: toWorkspaceRelativePath(wsPath, normalizedLocalPath),
      mimeType: inferImageMimeType(normalizedLocalPath),
    }
  }

  const assetsDir = toWorkspaceAssetsDir(wsPath)
  await ensureDir(assetsDir)
  const guessedExtension = guessExtensionFromMimeType(inferImageMimeType(normalizedSource))
  const targetPath = await ensureUniqueTargetPath(path.join(assetsDir, sanitizeAssetFileName(preferredName, guessedExtension)))
  await copyLocalOrRemoteImage(normalizedSource, targetPath)
  return {
    absolutePath: targetPath,
    relativePath: toWorkspaceRelativePath(wsPath, targetPath),
    mimeType: inferImageMimeType(targetPath) || inferImageMimeType(normalizedSource),
  }
}

async function buildSchemaFromOoxmlSnapshot(
  wsPath: string,
  sourcePath: string,
  snapshot: OoxmlPackageSnapshot,
): Promise<DocumentSchema> {
  return importDocumentSchemaFromOoxmlSnapshot(wsPath, sourcePath, snapshot, {
    resolveImageAsset: async ({ suggestedName, source, mimeType }) => {
      try {
        const materialized = await materializeWorkspaceImageAsset(wsPath, source, suggestedName)
        return {
          relativePath: materialized.relativePath,
          mimeType: mimeType || materialized.mimeType,
        }
      } catch {
        return null
      }
    },
  })
}

async function resolveLegacyWorkspaceDocumentPath(wsPath: string): Promise<string | null> {
  // Scan both workspace root and documents/ subdirectory
  const dirsToScan = [wsPath, toWorkspaceDocumentsDir(wsPath)]
  const allCandidates: Array<{ path: string; ext: string; mtimeMs: number }> = []
  for (const dir of dirsToScan) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [] as Dirent[])
    const dirCandidates = await Promise.all(entries
      .filter((entry) => entry.isFile() && isDocumentCandidateFile(entry.name))
      .map(async (entry) => {
        const absolutePath = path.join(dir, entry.name)
        const stat = await fs.stat(absolutePath)
        // .aidoc.json has compound suffix — path.extname returns .json, handle explicitly
        const ext = entry.name.toLowerCase().endsWith('.aidoc.json') ? '.aidoc.json' : path.extname(entry.name).toLowerCase()
        return {
          path: absolutePath,
          ext,
          mtimeMs: stat.mtimeMs,
        }
      }))
    allCandidates.push(...dirCandidates)
  }

  if (allCandidates.length === 0) return null

  const priorityByExt: Record<string, number> = {
    '.aidoc.json': 6, // native lossless format — highest priority
    '.docx': 5,
    '.doc': 4,
    '.md': 3,
    '.markdown': 3,
    '.html': 2,
    '.htm': 2,
    '.txt': 1,
  }

  allCandidates.sort((left, right) => {
    const priorityDiff = (priorityByExt[right.ext] || 0) - (priorityByExt[left.ext] || 0)
    if (priorityDiff !== 0) return priorityDiff
    return right.mtimeMs - left.mtimeMs
  })

  return allCandidates[0]?.path || null
}

async function buildLegacyWorkspaceDocument(wsPath: string, sourcePath: string): Promise<DocumentSchema> {
  const sourceTitle = path.basename(sourcePath).replace(/\.aidoc\.json$/i, '').replace(/\.[^.]+$/g, '')
  const sourceRelativePath = toWorkspaceRelativePath(wsPath, sourcePath)
  const ext = path.extname(sourcePath).toLowerCase()

  // Native lossless format: extract HTML from the aidoc envelope
  if (sourcePath.toLowerCase().endsWith('.aidoc.json')) {
    try {
      const raw = await fs.readFile(sourcePath, 'utf-8')
      const aidoc = JSON.parse(raw)
      return buildDocumentSchemaFromText({
        id: buildWorkspaceDocumentId(wsPath),
        profile: 'freewrite',
        title: sourceTitle,
        text: String(aidoc.html || '<p></p>'),
        sourceType: 'html-import',
        sourceRefs: [sourceRelativePath],
        metadata: { legacySourcePath: sourceRelativePath, workspacePath: wsPath },
      })
    } catch {
      // malformed aidoc — fall through to plain text path
    }
  }

  if (ext === '.docx') {
    const snapshot = await docxDocumentEngineService.readOoxmlPackage(sourcePath)
    return buildSchemaFromOoxmlSnapshot(wsPath, sourcePath, snapshot)
  }

  const raw = await fs.readFile(sourcePath, 'utf-8')
  return buildDocumentSchemaFromText({
    id: buildWorkspaceDocumentId(wsPath),
    profile: 'freewrite',
    title: sourceTitle,
    text: raw,
    sourceType: ext === '.md' || ext === '.markdown' ? 'markdown-import' : ext === '.txt' ? 'plaintext-import' : 'html-import',
    sourceRefs: [sourceRelativePath],
    metadata: {
      legacySourcePath: sourceRelativePath,
      workspacePath: wsPath,
    },
  })
}

function hydrateWorkspaceDocumentForRuntime(wsPath: string, document: DocumentSchema): DocumentSchema {
  const normalized = normalizeDocumentSchema(document)
  const resourcePathMap = new Map<string, string>()

  /** Remap legacy relative prefixes (assets/, pic/) to images/ before resolving. */
  const remapLegacyRelativePath = (relPath: string): string => {
    const normalized2 = relPath.replace(/\\/g, '/')
    if (normalized2.startsWith('assets/')) return `${WORKSPACE_ASSETS_DIR}/${normalized2.slice('assets/'.length)}`
    if (normalized2.startsWith('pic/')) return `${WORKSPACE_ASSETS_DIR}/${normalized2.slice('pic/'.length)}`
    return relPath
  }

  const runtimeResources = normalized.resources.map((resource) => {
    const rawPath = String(resource.path || '').trim()
    const effectivePath = rawPath ? remapLegacyRelativePath(rawPath) : rawPath
    const absolutePath = effectivePath
      ? (path.isAbsolute(effectivePath) || isUrlLike(effectivePath) || String(effectivePath).startsWith('data:')
        ? effectivePath
        : maybeResolveWorkspaceRelativePath(wsPath, effectivePath))
      : resource.path
    resourcePathMap.set(resource.id, absolutePath)
    return {
      ...resource,
      id: absolutePath,
      path: absolutePath,
    }
  })

  const runtimeBlocks = normalized.blocks.map((block) => {
    if (block.type !== 'image') return block
    const absoluteResourcePath = resourcePathMap.get(block.resourceRef)
      || (path.isAbsolute(block.resourceRef) || isUrlLike(block.resourceRef) || String(block.resourceRef).startsWith('data:')
        ? block.resourceRef
        : maybeResolveWorkspaceRelativePath(wsPath, block.resourceRef))
    return createImageBlock({
      ...block,
      resourceRef: absoluteResourcePath,
    })
  })

  return normalizeDocumentSchema({
    ...normalized,
    meta: {
      ...normalized.meta,
      workspacePath: wsPath,
      legacyDocumentPath: normalized.meta.legacySourcePath,
    },
    resources: runtimeResources,
    blocks: runtimeBlocks,
  })
}

async function persistWorkspaceDocumentForJson(wsPath: string, document: DocumentSchema): Promise<DocumentSchema> {
  const normalized = normalizeDocumentSchema(document)
  const persistedResources = new Map<string, DocumentResource>()
  const persistedBlocks = [] as DocumentSchema['blocks']

  for (let index = 0; index < normalized.blocks.length; index += 1) {
    const block = normalized.blocks[index]
    if (block.type !== 'image') {
      persistedBlocks.push(block)
      continue
    }

    const matchedResource = normalized.resources.find((resource) => resource.id === block.resourceRef || resource.path === block.resourceRef)
    const source = String(matchedResource?.path || block.resourceRef || '').trim()
    const preferredName = path.basename(source || `image-${index + 1}.png`) || `image-${index + 1}.png`
    const materialized = await materializeWorkspaceImageAsset(wsPath, source, preferredName)
    const relativePath = materialized.relativePath
    persistedResources.set(relativePath, {
      id: relativePath,
      kind: 'image',
      path: relativePath,
      mimeType: matchedResource?.mimeType || materialized.mimeType || inferImageMimeType(relativePath),
      width: matchedResource?.width ?? block.width,
      height: matchedResource?.height ?? block.height,
      metadata: matchedResource?.metadata,
    })
    persistedBlocks.push(createImageBlock({
      ...block,
      resourceRef: relativePath,
    }))
  }

  const updatedAt = nowIsoString()
  return createDocumentSchema({
    id: normalized.id,
    profile: normalized.profile,
    title: normalized.meta.title || path.basename(wsPath),
    createdAt: normalized.meta.createdAt || updatedAt,
    updatedAt,
    sourceType: 'workspace-json',
    templateId: String(normalized.meta.templateId || normalized.document.templateId || '').trim() || undefined,
    metadata: {
      ...(normalized.document.metadata || {}),
      ...(normalized.meta || {}),
      workspacePath: wsPath,
    },
    page: normalized.page,
    styles: normalized.styles,
    blocks: persistedBlocks,
    resources: Array.from(persistedResources.values()),
    citations: normalized.citations,
    sourceRefs: normalized.sourceRefs,
    bibliography: normalized.bibliography,
    exportHints: normalized.exportHints,
    templateHints: normalized.templateHints,
  })
}

function normalizeLocalImagePath(source: string): string {
  let value = safeDecodeUriValue(String(source || '').trim().replace(/^['"]|['"]$/g, ''))
  if (!value) return value

  if (value.startsWith('file://')) {
    try {
      const url = new URL(value)
      const pathname = decodeURI(url.pathname || '')
      if (/^\/[a-zA-Z]:\//.test(pathname)) {
        return pathname.slice(1)
      }
      if (/^[a-zA-Z]:\//.test(pathname)) {
        return pathname
      }
      return pathname || value.replace(/^file:\/\//, '')
    } catch {
      const stripped = value.replace(/^file:\/\//, '')
      if (/^\/[a-zA-Z]:\//.test(stripped)) {
        return stripped.slice(1)
      }
      return stripped
    }
  }

  value = value.replace(/^([a-zA-Z]:)[\\/]+(?=file:)/, '')

  const embeddedFilePrefixIndex = value.search(/file:(?:\\+|\/+)/i)
  if (embeddedFilePrefixIndex > 0) {
    value = value.slice(embeddedFilePrefixIndex)
  }

  if (/^file:/i.test(value)) {
    const stripped = safeDecodeUriValue(value.replace(/^file:/i, '').replace(/\\/g, '/'))
    if (/^\/[a-zA-Z]:\//.test(stripped)) {
      return stripped.slice(1)
    }
    if (/^[a-zA-Z]:\//.test(stripped)) {
      return stripped
    }
    return stripped.startsWith('/') ? stripped : `/${stripped.replace(/^\/+/, '')}`
  }

  if (/^\/[a-zA-Z]:\//.test(value)) {
    return value.slice(1)
  }

  return value
}

function referenceIdentity(reference: any): string {
  if (typeof reference === 'string') return reference.trim()
  const doi = String(reference?.doi || '').trim().toLowerCase()
  if (doi) return `doi:${doi}`
  const title = String(reference?.title || reference?.citation || '').trim().toLowerCase()
  const year = String(reference?.year || '').trim()
  return `title:${title}|year:${year}`
}

function extractReferenceOrder(reference: any): number | null {
  const value = Number(reference?.reference_number ?? reference?.citationNumber ?? reference?.number ?? NaN)
  return Number.isFinite(value) && value > 0 ? value : null
}

function formatReferenceLine(reference: any, index: number): string {
  const label = extractReferenceOrder(reference) ?? index + 1
  if (typeof reference === 'string') return `${label}. ${reference}`
  const authors = Array.isArray(reference?.authors) ? reference.authors.slice(0, 4).join(', ') : ''
  const year = reference?.year || 'n.d.'
  const title = reference?.title || reference?.citation || 'Untitled'
  const journal = reference?.journal ? ` ${reference.journal}.` : ''
  const doi = reference?.doi ? ` DOI: ${reference.doi}` : ''
  return `${label}. ${(authors || 'Unknown Authors')} (${year}). ${title}.${journal}${doi}`.trim()
}

function sortReferences(references: any[]): any[] {
  return [...references].sort((left, right) => {
    const leftOrder = extractReferenceOrder(left)
    const rightOrder = extractReferenceOrder(right)
    if (leftOrder !== null || rightOrder !== null) {
      if (leftOrder === null) return 1
      if (rightOrder === null) return -1
      return leftOrder - rightOrder
    }
    const leftYear = Number(left?.year || 0)
    const rightYear = Number(right?.year || 0)
    if (leftYear !== rightYear) return rightYear - leftYear
    const leftTitle = String(left?.title || left?.citation || left || '').toLowerCase()
    const rightTitle = String(right?.title || right?.citation || right || '').toLowerCase()
    return leftTitle.localeCompare(rightTitle, 'zh-Hans-CN')
  })
}

function resolveReferenceArtifactPaths(wsPath: string, documentPath?: string): { jsonPath: string } {
  const normalizedDocumentPath = String(documentPath || '').trim()
  if (!normalizedDocumentPath) {
    return {
      jsonPath: path.join(wsPath, 'references.json'),
    }
  }

  const absoluteDocumentPath = path.isAbsolute(normalizedDocumentPath)
    ? path.resolve(normalizedDocumentPath)
    : resolveWorkspacePath(wsPath, normalizedDocumentPath)
  const directory = path.dirname(absoluteDocumentPath)
  const fileName = path.basename(absoluteDocumentPath)
  // Strip compound .aidoc.json suffix before falling back to single extname
  const baseName = fileName.toLowerCase().endsWith('.aidoc.json')
    ? fileName.slice(0, -'.aidoc.json'.length)
    : path.basename(absoluteDocumentPath, path.extname(absoluteDocumentPath))

  return {
    jsonPath: path.join(directory, `${baseName}.references.json`),
  }
}

async function readReferenceCollection(filePath: string): Promise<any[]> {
  if (!(await pathExists(filePath))) {
    return []
  }

  const raw = await fs.readFile(filePath, 'utf-8')
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeReferenceArtifacts(wsPath: string, references: any[], documentPath?: string): Promise<any[]> {
  const artifacts = resolveReferenceArtifactPaths(wsPath, documentPath)
  const normalized = sortReferences(
    references.filter((item, index, arr) => {
      const key = referenceIdentity(item)
      return !!key && arr.findIndex((candidate) => referenceIdentity(candidate) === key) === index
    }),
  )
  await ensureDir(path.dirname(artifacts.jsonPath))
  await fs.writeFile(artifacts.jsonPath, JSON.stringify(normalized, null, 2), 'utf-8')

  return normalized
}

async function renameReferenceArtifactsForDocument(wsPath: string, oldDocumentPath: string, newDocumentPath: string): Promise<void> {
  const oldArtifacts = resolveReferenceArtifactPaths(wsPath, oldDocumentPath)
  const newArtifacts = resolveReferenceArtifactPaths(wsPath, newDocumentPath)
  const candidates: Array<{ from: string; to: string }> = [
    { from: oldArtifacts.jsonPath, to: newArtifacts.jsonPath },
  ]

  for (const candidate of candidates) {
    if (candidate.from === candidate.to) continue
    if (!(await pathExists(candidate.from))) continue
    await ensureDir(path.dirname(candidate.to))
    if (await pathExists(candidate.to)) {
      await fs.rm(candidate.from, { force: true })
      continue
    }
    await fs.rename(candidate.from, candidate.to)
  }
}

export class WorkspaceService {
  constructor(
    private readonly baseDir: string,
    private readonly options: WorkspaceServiceOptions = {},
  ) {}

  private get discoveryBaseDirs(): string[] {
    return Array.from(new Set([
      path.resolve(this.baseDir),
      ...(Array.isArray(this.options.legacyBaseDirs)
        ? this.options.legacyBaseDirs.map((dirPath) => path.resolve(String(dirPath || ''))).filter(Boolean)
        : []),
    ]))
  }

  async saveDocumentSchemaAsManuscript(
    wsPath: string,
    document: DocumentSchema,
    filename: string,
    templateSourcePath?: string,
  ): Promise<{ success: boolean; path: string; templateMode?: DocumentSchemaDocxTemplateMode }> {
    await this.normalizeWorkspaceLayout(wsPath)
    const targetPath = resolveWorkspacePath(wsPath, filename)
    await ensureDir(path.dirname(targetPath))

    if (isFormalTemplateWorkCopy(targetPath)) {
      throw new Error('Fail-closed: 正式模板工作副本只允许通过 formalTemplate:commit 写回，禁止 saveManuscript')
    }

    if (path.extname(targetPath).toLowerCase() !== '.docx') {
      await fs.writeFile(targetPath, serializeDocumentSchemaToHtml(document), 'utf-8')
      return { success: true, path: targetPath }
    }

    const normalizedTemplateSourcePath = String(templateSourcePath || '').trim()
    const templateMode = resolveDocumentSchemaDocxTemplateMode(document, normalizedTemplateSourcePath || undefined)
    let preparedTemplateSource = null

    try {
      if (templateMode === 'base-replace' && normalizedTemplateSourcePath && !(await pathExists(targetPath)) && await pathExists(normalizedTemplateSourcePath)) {
        preparedTemplateSource = await prepareCompatibleDocxSource(normalizedTemplateSourcePath)
        await fs.copyFile(preparedTemplateSource.filePath, targetPath)
      }

      // Pre-render citations so inline [N] and the bibliography section are
      // consistent before the OOXML boundary compiler processes the document.
      const exportDocument = renderDocumentCitationsForExport(document)
      const compiledBlocks = compileDocumentSchemaToOoxmlBlocks(exportDocument, {
        workspacePath: wsPath,
        resourceBasePath: wsPath,
      })
      const rewritten = await docxDocumentEngineService.writeOoxmlPackage(targetPath, {
        blocks: compiledBlocks,
        documentSectionPropertiesXml: resolveDocumentSchemaDocumentSectionPropertiesXml(exportDocument),
      })
      if (!rewritten.success) {
        throw new Error('DOCX boundary compiler 写回失败')
      }

      return { success: true, path: targetPath, templateMode }
    } finally {
      await cleanupPreparedCompatibleDocxSource(preparedTemplateSource)
    }
  }

  private async normalizeWorkspaceLayout(wsPath: string): Promise<void> {
    await ensureDir(wsPath)

    const imagesDir = path.join(wsPath, WORKSPACE_ASSETS_DIR)
    const documentsDir = toWorkspaceDocumentsDir(wsPath)
    const knowledgeDir = toWorkspaceKnowledgeDir(wsPath)
    const pptDir = toWorkspacePptDir(wsPath)
    const dailyReportsDir = path.join(wsPath, WORKSPACE_DAILY_REPORTS_DIR)

    await Promise.all([
      ensureDir(imagesDir),
      ensureDir(documentsDir),
      ensureDir(knowledgeDir),
      ensureDir(pptDir),
      ensureDir(dailyReportsDir),
    ])

    /* ── Phase 1: ancient legacy migration (01_Main_Manuscript, etc.) ── */
    const legacyManuscriptDir = path.join(wsPath, '01_Main_Manuscript')
    const legacyAnalysisDir = path.join(wsPath, '03_Data_and_Analysis')
    const legacyFiguresRoot = path.join(wsPath, '04_Figures_and_Tables')
    const legacyFiguresDir = path.join(legacyFiguresRoot, 'Final_Figures')
    const legacyReferenceJson = path.join(wsPath, 'references.json')
    const legacyReferenceText = path.join(wsPath, 'References_List.txt')
    const preferredReferenceTargetCandidates = (await listFilesRecursively(legacyManuscriptDir))
      .filter((filePath) => isDocumentCandidateFile(path.basename(filePath)))
      .map((filePath) => path.join(wsPath, path.basename(filePath)))

    const rootEntries = await fs.readdir(wsPath, { withFileTypes: true }).catch(() => [] as Dirent[])
    const hasExperimentPlanArtifacts = rootEntries.some((entry) => entry.isFile() && isExperimentPlanArtifactFile(entry.name))
    const hasAncientLegacy = (await Promise.all([
      pathExists(legacyManuscriptDir),
      pathExists(legacyAnalysisDir),
      pathExists(legacyFiguresRoot),
    ])).some(Boolean)

    if (hasAncientLegacy || hasExperimentPlanArtifacts) {
      // Flatten ancient directory structures into workspace root first
      await moveFilesIntoDirectory(legacyManuscriptDir, wsPath)
      await moveFilesIntoDirectory(legacyAnalysisDir, wsPath, (filePath) => isExperimentPlanArtifactFile(path.basename(filePath)))
      await moveFilesIntoDirectory(legacyFiguresDir, imagesDir)

      const refreshedEntries = await fs.readdir(wsPath, { withFileTypes: true })
      await Promise.all(
        refreshedEntries
          .filter((entry) => entry.isFile() && isExperimentPlanArtifactFile(entry.name))
          .map((entry) => fs.rm(path.join(wsPath, entry.name), { force: true })),
      )

      await fs.rm(legacyManuscriptDir, { recursive: true, force: true })
      await fs.rm(legacyAnalysisDir, { recursive: true, force: true })
      await fs.rm(legacyFiguresRoot, { recursive: true, force: true })
    }

    /* ── Phase 2: v2 directory migration (pic, assets, reference, source, 05_Presentation) ── */
    const legacyPicDir = path.join(wsPath, 'pic')
    const legacyAssetsDir = path.join(wsPath, 'assets')
    const legacyReferenceDir = path.join(wsPath, 'reference')
    const legacySourceDir = path.join(wsPath, 'source')
    const legacyPresentationDir = path.join(wsPath, '05_Presentation')

    const hasV2Legacy = (await Promise.all([
      pathExists(legacyPicDir),
      pathExists(legacyAssetsDir),
      pathExists(legacySourceDir),
      pathExists(legacyPresentationDir),
    ])).some(Boolean)

    if (hasV2Legacy) {
      // pic/* → images/
      await moveFilesIntoDirectory(legacyPicDir, imagesDir)
      // assets/* → images/
      await moveFilesIntoDirectory(legacyAssetsDir, imagesDir)
      // source/* → knowledge/
      await moveFilesIntoDirectory(legacySourceDir, knowledgeDir)
      // 05_Presentation/* → ppt/
      await moveFilesIntoDirectory(legacyPresentationDir, pptDir)

      await fs.rm(legacyPicDir, { recursive: true, force: true })
      await fs.rm(legacyAssetsDir, { recursive: true, force: true })
      await fs.rm(legacySourceDir, { recursive: true, force: true })
      await fs.rm(legacyPresentationDir, { recursive: true, force: true })
    }

    // Always clean up empty reference/ directory (was always an empty shell)
    await fs.rm(legacyReferenceDir, { recursive: true, force: true }).catch(() => undefined)

    /* ── Phase 3: move root-level docx + reference sidecar files into documents/ ── */
    const topLevelEntries = await fs.readdir(wsPath, { withFileTypes: true }).catch(() => [] as Dirent[])
    const rootDocxFiles = topLevelEntries.filter((entry) => entry.isFile() && isDocumentCandidateFile(entry.name))
    const rootReferenceSidecars = topLevelEntries.filter((entry) =>
      entry.isFile() && (entry.name.endsWith('.references.json') || entry.name.endsWith('.references.txt')),
    )

    // Migrate legacy root-level references.json / References_List.txt
    if ((await pathExists(legacyReferenceJson)) || (await pathExists(legacyReferenceText))) {
      const documentCandidates = rootDocxFiles.map((entry) => path.join(wsPath, entry.name))
      const preferredReferenceTarget = preferredReferenceTargetCandidates.length === 1 && (await pathExists(preferredReferenceTargetCandidates[0]))
        ? preferredReferenceTargetCandidates[0]
        : null
      const referenceTargetPath = preferredReferenceTarget || (documentCandidates.length === 1 ? documentCandidates[0] : null)
      if (referenceTargetPath) {
        const existing = await readReferenceCollection(resolveReferenceArtifactPaths(wsPath, referenceTargetPath).jsonPath)
        const legacy = await readReferenceCollection(legacyReferenceJson)
        if (existing.length > 0 || legacy.length > 0) {
          await writeReferenceArtifacts(wsPath, [...existing, ...legacy], referenceTargetPath)
        }
      }
      await fs.rm(legacyReferenceJson, { force: true })
      await fs.rm(legacyReferenceText, { force: true })
    }

    // Move root-level docx files into documents/
    for (const entry of rootDocxFiles) {
      const sourcePath = path.join(wsPath, entry.name)
      const targetPath = await ensureUniqueTargetPath(path.join(documentsDir, entry.name))
      await fs.rename(sourcePath, targetPath)
    }

    // Move root-level reference sidecar files into documents/
    for (const entry of rootReferenceSidecars) {
      const sourcePath = path.join(wsPath, entry.name)
      const targetPath = await ensureUniqueTargetPath(path.join(documentsDir, entry.name))
      await fs.rename(sourcePath, targetPath)
    }

    // Clean up legacy .references.txt files (only keep .json)
    const docsEntries = await fs.readdir(documentsDir, { withFileTypes: true }).catch(() => [] as Dirent[])
    await Promise.all(
      docsEntries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.references.txt'))
        .map((entry) => fs.rm(path.join(documentsDir, entry.name), { force: true })),
    )

    /* ── Phase 4: patch document.json image resource paths (assets/x → images/x, pic/x → images/x) ── */
    const docJsonPath = toWorkspaceDocumentJsonPath(wsPath)
    if (await pathExists(docJsonPath)) {
      try {
        const rawJson = await fs.readFile(docJsonPath, 'utf-8')
        let patched = false
        const updatedJson = rawJson.replace(/("(?:resourceRef|path|id)":\s*")(assets\/|pic\/)/g, (_match, prefix, oldDir) => {
          void oldDir
          patched = true
          return `${prefix}${WORKSPACE_ASSETS_DIR}/`
        })
        if (patched) {
          await fs.writeFile(docJsonPath, updatedJson, 'utf-8')
        }
      } catch { /* document.json patch failed — non-critical */ }
    }
  }

  private get registryPath(): string {
    return path.join(this.baseDir, '.workspace-registry.json')
  }

  private async readRegistryFrom(baseDir: string): Promise<string[]> {
    const normalizedBaseDir = path.resolve(baseDir)
    if (!(await pathExists(normalizedBaseDir))) {
      return []
    }

    const registryPath = path.join(normalizedBaseDir, '.workspace-registry.json')
    if (!(await pathExists(registryPath))) {
      return []
    }

    try {
      const raw = await fs.readFile(registryPath, 'utf-8')
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.map((item) => String(item || '')).filter(Boolean) : []
    } catch {
      return []
    }
  }

  private async readRegistry(): Promise<string[]> {
    await ensureDir(this.baseDir)
    const registryGroups = await Promise.all(this.discoveryBaseDirs.map((dirPath) => this.readRegistryFrom(dirPath)))
    return Array.from(new Set(registryGroups
      .flat()
      .map((item) => path.resolve(String(item || '')))
      .filter(Boolean)))
  }

  private async writeRegistry(paths: string[]): Promise<void> {
    await ensureDir(this.baseDir)
    const normalized = Array.from(new Set(paths.map((item) => path.resolve(String(item || ''))).filter(Boolean)))
    await fs.writeFile(this.registryPath, JSON.stringify(normalized, null, 2), 'utf-8')
  }

  private async rememberWorkspacePath(wsPath: string): Promise<void> {
    const existing = await this.readRegistry()
    await this.writeRegistry([path.resolve(wsPath), ...existing])
  }

  async listWorkspaces(): Promise<WorkspaceInfo[]> {
    await ensureDir(this.baseDir)
    const bundledPathGroups = await Promise.all(this.discoveryBaseDirs.map(async (dirPath) => {
      if (!(await pathExists(dirPath))) {
        return [] as string[]
      }
      const entries = await fs.readdir(dirPath, { withFileTypes: true })
      return entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => path.join(dirPath, entry.name))
    }))
    const bundledPaths = Array.from(new Set(bundledPathGroups.flat().map((item) => path.resolve(item))))
    const registeredPaths = await this.readRegistry()
    const candidates = Array.from(new Set([...bundledPaths, ...registeredPaths]))
    const workspaces = await Promise.all(
      candidates.map(async (wsPath) => {
        try {
          const stat = await fs.stat(wsPath)
          if (!stat.isDirectory()) return null
          return {
            name: path.basename(wsPath),
            path: wsPath,
            hasDocument: (await pathExists(toWorkspaceDocumentJsonPath(wsPath))) || Boolean(await resolveLegacyWorkspaceDocumentPath(wsPath)),
            modifiedAt: stat.mtime.toISOString(),
          }
        } catch {
          return null
        }
      }),
    )
    const filtered = workspaces.filter(Boolean) as WorkspaceInfo[]
    await this.writeRegistry(filtered.map((item) => item.path))
    return filtered.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
  }

  async createWorkspace(name: string, parentDir?: string): Promise<{ success: boolean; path: string; name: string }> {
    const targetRoot = parentDir ? path.resolve(parentDir) : this.baseDir
    await ensureDir(targetRoot)
    const safeName = sanitizeWorkspaceName(name)
    const wsPath = await ensureUniqueTargetPath(path.join(targetRoot, safeName))
    await ensureDir(wsPath)
    await Promise.all([
      ensureDir(path.join(wsPath, WORKSPACE_ASSETS_DIR)),
      ensureDir(path.join(wsPath, WORKSPACE_DOCUMENTS_DIR)),
      ensureDir(path.join(wsPath, WORKSPACE_KNOWLEDGE_DIR)),
      ensureDir(path.join(wsPath, WORKSPACE_PPT_DIR)),
      ensureDir(path.join(wsPath, WORKSPACE_DAILY_REPORTS_DIR)),
    ])
    await this.rememberWorkspacePath(wsPath)
    return { success: true, path: wsPath, name: path.basename(wsPath) }
  }

  async readWorkspaceDocumentSchema(wsPath: string): Promise<WorkspaceDocumentReadResult> {
    await this.normalizeWorkspaceLayout(wsPath)
    const jsonPath = toWorkspaceDocumentJsonPath(wsPath)

    if (await pathExists(jsonPath)) {
      try {
        const raw = await fs.readFile(jsonPath, 'utf-8')
        const parsed = normalizeDocumentSchema(JSON.parse(raw) as Partial<DocumentSchema>)
        const runtimeDocument = hydrateWorkspaceDocumentForRuntime(wsPath, parsed)
        return {
          success: true,
          source: 'document-json',
          jsonPath,
          legacySourcePath: null,
          compatHtml: serializeDocumentSchemaToHtml(runtimeDocument),
          displayName: buildWorkspaceDisplayName(wsPath, runtimeDocument),
          document: runtimeDocument,
        }
      } catch {
        await fs.rm(jsonPath, { force: true })
      }
    }

    const legacySourcePath = await resolveLegacyWorkspaceDocumentPath(wsPath)
    if (legacySourcePath) {
      const legacyDocument = await buildLegacyWorkspaceDocument(wsPath, legacySourcePath)
      const runtimeDocument = hydrateWorkspaceDocumentForRuntime(wsPath, legacyDocument)
      return {
        success: true,
        source: 'legacy-workspace',
        jsonPath,
        legacySourcePath,
        compatHtml: serializeDocumentSchemaToHtml(runtimeDocument),
        displayName: buildWorkspaceDisplayName(wsPath, runtimeDocument),
        document: runtimeDocument,
      }
    }

    const emptyDocument = hydrateWorkspaceDocumentForRuntime(wsPath, buildEmptyWorkspaceDocument(wsPath))
    return {
      success: true,
      source: 'empty',
      jsonPath,
      legacySourcePath: null,
      compatHtml: serializeDocumentSchemaToHtml(emptyDocument),
      displayName: buildWorkspaceDisplayName(wsPath, emptyDocument),
      document: emptyDocument,
    }
  }

  async saveWorkspaceDocumentSchema(wsPath: string, document: DocumentSchema): Promise<WorkspaceDocumentSaveResult> {
    await this.normalizeWorkspaceLayout(wsPath)
    const persistedDocument = await persistWorkspaceDocumentForJson(wsPath, document)
    const jsonPath = toWorkspaceDocumentJsonPath(wsPath)
    await ensureDir(path.dirname(jsonPath))
    await fs.writeFile(jsonPath, JSON.stringify(persistedDocument, null, 2), 'utf-8')

    const runtimeDocument = hydrateWorkspaceDocumentForRuntime(wsPath, persistedDocument)
    return {
      success: true,
      jsonPath,
      compatHtml: serializeDocumentSchemaToHtml(runtimeDocument),
      displayName: buildWorkspaceDisplayName(wsPath, runtimeDocument),
      resourceCount: runtimeDocument.resources.length,
      document: runtimeDocument,
    }
  }

  async renameWorkspace(wsPath: string, nextName: string): Promise<{ success: boolean; path: string; name: string }> {
    const resolvedPath = path.resolve(wsPath)
    const targetRoot = path.dirname(resolvedPath)
    const safeName = sanitizeWorkspaceName(nextName, path.basename(resolvedPath))
    const requestedPath = path.join(targetRoot, safeName)
    const targetPath = path.resolve(requestedPath) === resolvedPath
      ? resolvedPath
      : await ensureUniqueTargetPath(requestedPath)

    if (targetPath !== resolvedPath) {
      await fs.rename(resolvedPath, targetPath)
      const registry = await this.readRegistry()
      await this.writeRegistry(registry.map((item) => path.resolve(item) === resolvedPath ? targetPath : item))
    }

    return { success: true, path: targetPath, name: path.basename(targetPath) }
  }

  async registerWorkspace(wsPath: string): Promise<{ success: boolean; path: string; name: string }> {
    const resolved = path.resolve(wsPath)
    await ensureDir(resolved)
    await this.normalizeWorkspaceLayout(resolved)
    await this.rememberWorkspacePath(resolved)
    return { success: true, path: resolved, name: path.basename(resolved) }
  }

  async getWorkspaceTree(wsPath: string): Promise<FileTreeNode[]> {
    await ensureDir(wsPath)
    await this.normalizeWorkspaceLayout(wsPath)
    return buildTree(wsPath)
  }

  async detectProjectStructure(wsPath: string): Promise<{ isProject: boolean; hasFigures: boolean }> {
    await this.normalizeWorkspaceLayout(wsPath)
    const hasFigures = false
    const entries = await fs.readdir(wsPath, { withFileTypes: true })
    const hasManuscript = entries.some((entry) => entry.isFile() && isDocumentCandidateFile(entry.name))
    return {
      isProject: hasManuscript || entries.some((entry) => entry.isDirectory() || entry.isFile()),
      hasFigures,
    }
  }

  async saveReferences(wsPath: string, references: any[], documentPath?: string): Promise<{ success: boolean; total: number }> {
    await ensureDir(wsPath)
    await this.normalizeWorkspaceLayout(wsPath)
    const saved = await writeReferenceArtifacts(wsPath, Array.isArray(references) ? references : [], documentPath)
    return { success: true, total: saved.length }
  }

  async readReferences(wsPath: string, documentPath?: string): Promise<{ references: any[] }> {
    await ensureDir(wsPath)
    await this.normalizeWorkspaceLayout(wsPath)
    const filePath = resolveReferenceArtifactPaths(wsPath, documentPath).jsonPath
    const references = await readReferenceCollection(filePath)
    return { references }
  }

  async readTaskHistory(wsPath: string): Promise<{ tasks: Record<string, unknown>[] }> {
    await ensureDir(wsPath)
    await this.normalizeWorkspaceLayout(wsPath)
    const filePath = toWorkspaceTaskHistoryPath(wsPath)
    const tasks = await readWorkspaceTaskHistoryCollection(filePath)
    return { tasks }
  }

  async appendTaskHistory(wsPath: string, task: Record<string, unknown>): Promise<{ success: boolean; total: number }> {
    await ensureDir(wsPath)
    await this.normalizeWorkspaceLayout(wsPath)
    const filePath = toWorkspaceTaskHistoryPath(wsPath)
    const existing = await readWorkspaceTaskHistoryCollection(filePath)
    const next = await writeWorkspaceTaskHistoryCollection(filePath, [...existing, task])
    return { success: true, total: next.length }
  }

  async appendReferences(wsPath: string, references: any[], documentPath?: string): Promise<{ success: boolean; total: number }> {
    await ensureDir(wsPath)
    await this.normalizeWorkspaceLayout(wsPath)
    const existing = await this.readReferences(wsPath, documentPath)
    const merged = await writeReferenceArtifacts(
      wsPath,
      [...(Array.isArray(existing.references) ? existing.references : []), ...(Array.isArray(references) ? references : [])],
      documentPath,
    )
    return { success: true, total: merged.length }
  }

  private async saveBase64Image(wsPath: string, filename: string, base64Data: string, useFigures = false): Promise<{ success: boolean; path: string; relativePath: string; filename: string }> {
    void useFigures
    await this.normalizeWorkspaceLayout(wsPath)
    const targetDir = path.join(wsPath, WORKSPACE_ASSETS_DIR)
    await ensureDir(targetDir)
    const targetPath = await ensureUniqueTargetPath(path.join(targetDir, filename))
    await fs.writeFile(targetPath, Buffer.from(base64Data, 'base64'))
    const finalName = path.basename(targetPath)
    return { success: true, path: targetPath, relativePath: `${WORKSPACE_ASSETS_DIR}/${finalName}`, filename: finalName }
  }

  async saveImageToWorkspace(wsPath: string, filename: string, base64Data: string): Promise<{ success: boolean; path: string; relativePath: string; filename: string }> {
    return this.saveBase64Image(wsPath, filename, base64Data, false)
  }

  async saveImageToFiguresBase64(wsPath: string, filename: string, base64Data: string): Promise<{ success: boolean; path: string; relativePath: string; filename: string }> {
    return this.saveBase64Image(wsPath, filename, base64Data, true)
  }

  async saveImageFromUrl(wsPath: string, imageUrl: string, filename?: string, useFigures = false): Promise<{ success: boolean; path: string; relativePath: string; filename: string }> {
    void useFigures
    await this.normalizeWorkspaceLayout(wsPath)
    const targetDir = path.join(wsPath, WORKSPACE_ASSETS_DIR)
    await ensureDir(targetDir)
    const fallbackName = `image-${Date.now()}.png`
    const inferredName = filename || path.basename(normalizeLocalImagePath(imageUrl)) || path.basename(imageUrl)
    const finalName = sanitizeImageFilename(inferredName, fallbackName)
    const targetPath = await ensureUniqueTargetPath(path.join(targetDir, finalName))
    await copyLocalOrRemoteImage(imageUrl, targetPath)
    const savedName = path.basename(targetPath)
    return { success: true, path: targetPath, relativePath: `${WORKSPACE_ASSETS_DIR}/${savedName}`, filename: savedName }
  }

  async writeWorkspaceFile(wsPath: string, relativePath: string, content: string): Promise<{ success: boolean; path: string }> {
    const targetPath = resolveWorkspacePath(wsPath, relativePath)
    await ensureDir(path.dirname(targetPath))
    await fs.writeFile(targetPath, content, 'utf-8')
    return { success: true, path: targetPath }
  }

  async saveManuscript(wsPath: string, content: string, filename: string, templateSourcePath?: string): Promise<{ success: boolean; path: string }> {
    await this.normalizeWorkspaceLayout(wsPath)
    // Place manuscript inside documents/ if not already under a subdirectory
    const effectiveFilename = /[\\/]/.test(filename) ? filename : `${WORKSPACE_DOCUMENTS_DIR}/${filename}`
    const targetPath = resolveWorkspacePath(wsPath, effectiveFilename)
    await ensureDir(path.dirname(targetPath))

    // Fail-closed: 正式模板工作副本禁止通过 saveManuscript 写入
    // 使用路径分量判断而非字符串 includes，对 Unix 和 Windows 均正确
    if (isFormalTemplateWorkCopy(targetPath)) {
      throw new Error('Fail-closed: 正式模板工作副本只允许通过 formalTemplate:commit 写回，禁止 saveManuscript')
    }

    if (path.extname(targetPath).toLowerCase() === '.docx') {
      const boundaryDocument = coerceLegacyDocxContentToDocumentSchema(content, {
        filename,
        documentId: buildWorkspaceDocumentId(wsPath),
      })
      await this.saveDocumentSchemaAsManuscript(wsPath, boundaryDocument, filename, templateSourcePath)
    } else if (targetPath.toLowerCase().endsWith('.aidoc.json')) {
      // Wrap HTML content in lossless aidoc envelope (tiptapJson will be populated when user opens and saves)
      const aidocEnvelope = JSON.stringify({
        version: 1,
        format: 'aidoc',
        paperTemplateId: null,
        tiptapJson: null,
        html: content,
      })
      await fs.writeFile(targetPath, aidocEnvelope, 'utf-8')
    } else {
      await fs.writeFile(targetPath, content, 'utf-8')
    }
    return { success: true, path: targetPath }
  }

  async saveExperimentPlan(wsPath: string, content: string, filename: string): Promise<{ success: boolean; path: string }> {
    await this.normalizeWorkspaceLayout(wsPath)
    const targetPath = resolveWorkspacePath(wsPath, filename)
    await ensureDir(path.dirname(targetPath))
    await fs.writeFile(targetPath, content, 'utf-8')
    return { success: true, path: targetPath }
  }

  async deleteWorkspace(wsPath: string): Promise<{ success: boolean }> {
    await fs.rm(wsPath, { recursive: true, force: true })
    const registry = await this.readRegistry()
    await this.writeRegistry(registry.filter((item) => path.resolve(item) !== path.resolve(wsPath)))
    return { success: true }
  }

  async createWorkspaceFolder(wsPath: string, relativePath: string): Promise<{ success: boolean; path: string }> {
    const targetPath = resolveWorkspacePath(wsPath, relativePath)
    await ensureDir(targetPath)
    return { success: true, path: targetPath }
  }

  async createWorkspaceFile(wsPath: string, relativePath: string): Promise<{ success: boolean; path: string }> {
    const targetPath = resolveWorkspacePath(wsPath, relativePath)
    await ensureDir(path.dirname(targetPath))
    await fs.writeFile(targetPath, '', 'utf-8')
    return { success: true, path: targetPath }
  }

  async createBlankDocument(wsPath: string, relativePath: string): Promise<{ success: boolean; path: string }> {
    const isAidoc = /\.aidoc\.json$/i.test(relativePath)
    const normalizedRelativePath = normalizeRelativePath(relativePath)
      .replace(/\.aidoc\.json$/i, '')
      .replace(/\.docx$/i, '')
    // Place blank documents inside documents/ if not already under a subdirectory
    const effectiveRelativePath = /[\\/]/.test(normalizedRelativePath)
      ? normalizedRelativePath
      : `${WORKSPACE_DOCUMENTS_DIR}/${normalizedRelativePath}`
    const ext = isAidoc ? '.aidoc.json' : '.docx'
    const requestedTargetPath = resolveWorkspacePath(wsPath, `${effectiveRelativePath}${ext}`)
    const targetPath = await ensureUniqueTargetPath(requestedTargetPath)
    const finalRelativePath = toWorkspaceRelativePath(wsPath, targetPath)
    // Strip extension for display title
    const finalBaseName = path.basename(finalRelativePath).replace(/\.aidoc\.json$/i, '').replace(/\.docx$/i, '')
    await ensureDir(path.dirname(targetPath))
    if (isAidoc) {
      // Write lossless internal format — empty TipTap document
      const aidocContent = JSON.stringify({
        version: 1,
        format: 'aidoc',
        paperTemplateId: null,
        tiptapJson: { type: 'doc', content: [{ type: 'paragraph' }] },
        html: '<p></p>',
      })
      await fs.writeFile(targetPath, aidocContent, 'utf8')
    } else {
      await this.saveDocumentSchemaAsManuscript(wsPath, createDocumentSchema({
        id: buildWorkspaceDocumentId(wsPath),
        profile: 'freewrite',
        title: finalBaseName || '未命名文稿',
        sourceType: 'workspace-json',
        blocks: [createParagraphBlock({ id: 'block-1', text: '' })],
      }), finalRelativePath)
    }
    return { success: true, path: targetPath }
  }

  async renameWorkspacePath(wsPath: string, oldRelativePath: string, newRelativePath: string): Promise<{ success: boolean; path: string }> {
    const oldPath = resolveWorkspacePath(wsPath, oldRelativePath)
    const newPath = resolveWorkspacePath(wsPath, newRelativePath)
    await ensureDir(path.dirname(newPath))
    await fs.rename(oldPath, newPath)
    if (isDocumentCandidateFile(path.basename(newPath))) {
      await renameReferenceArtifactsForDocument(wsPath, oldPath, newPath)
    }
    return { success: true, path: newPath }
  }

  async copyWorkspacePath(wsPath: string, sourceRelativePath: string, targetRelativePath: string): Promise<{ success: boolean; path: string }> {
    const sourcePath = resolveWorkspacePath(wsPath, sourceRelativePath)
    const requestedTargetPath = resolveWorkspacePath(wsPath, targetRelativePath)
    const targetPath = await ensureUniqueTargetPath(requestedTargetPath)
    await ensureDir(path.dirname(targetPath))
    await fs.cp(sourcePath, targetPath, { recursive: true, force: false, errorOnExist: true })
    return { success: true, path: targetPath }
  }

  async moveWorkspacePath(wsPath: string, sourceRelativePath: string, targetRelativePath: string): Promise<{ success: boolean; path: string }> {
    const sourcePath = resolveWorkspacePath(wsPath, sourceRelativePath)
    const requestedTargetPath = resolveWorkspacePath(wsPath, targetRelativePath)
    const targetPath = await ensureUniqueTargetPath(requestedTargetPath)
    await ensureDir(path.dirname(targetPath))
    await fs.rename(sourcePath, targetPath)
    return { success: true, path: targetPath }
  }

  async deleteWorkspacePath(wsPath: string, relativePath: string): Promise<{ success: boolean }> {
    const targetPath = resolveWorkspacePath(wsPath, relativePath)
    await fs.rm(targetPath, { recursive: true, force: true })
    return { success: true }
  }
}
