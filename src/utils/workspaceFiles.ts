import {
  normalizeFileLikePath as normalizeSharedFileLikePath,
  toFileUrl as toSharedFileUrl,
} from '../shared/url/fileUrlHelper'

function toFileUrl(localPath: string): string {
  return toSharedFileUrl(localPath)
}

function normalizeLocalImagePath(source: string): string {
  return normalizeSharedFileLikePath(source)
}

function isWorkspaceLocalImage(source: string, workspacePath: string): boolean {
  const normalizedSource = normalizeLocalImagePath(source).replace(/\\/g, '/').toLowerCase()
  const normalizedWorkspacePath = String(workspacePath || '').replace(/\\/g, '/').toLowerCase()
  return Boolean(normalizedSource && normalizedWorkspacePath && normalizedSource.startsWith(normalizedWorkspacePath))
}

function referenceIdentity(reference: any): string {
  if (typeof reference === 'string') return reference.trim()
  const doi = String(reference?.doi || '').trim().toLowerCase()
  if (doi) return `doi:${doi}`
  const title = String(reference?.title || reference?.citation || '').trim().toLowerCase()
  const year = String(reference?.year || '').trim()
  return `title:${title}|year:${year}`
}

function mergeReferences(existing: any[], incoming: any[]): any[] {
  const map = new Map<string, any>()
  for (const item of [...existing, ...incoming]) {
    const key = referenceIdentity(item)
    if (!key) continue
    if (!map.has(key)) {
      map.set(key, item)
    }
  }
  return Array.from(map.values())
}

function sortReferences(references: any[]): any[] {
  return [...references].sort((left, right) => {
    const leftYear = Number(left?.year || 0)
    const rightYear = Number(right?.year || 0)
    if (leftYear !== rightYear) return rightYear - leftYear
    const leftTitle = String(left?.title || left?.citation || left || '').toLowerCase()
    const rightTitle = String(right?.title || right?.citation || right || '').toLowerCase()
    return leftTitle.localeCompare(rightTitle, 'zh-Hans-CN')
  })
}

function formatReferenceLine(reference: any, index: number): string {
  if (typeof reference === 'string') return `${index + 1}. ${reference}`
  const authors = Array.isArray(reference?.authors) ? reference.authors.slice(0, 4).join(', ') : ''
  const year = reference?.year || 'n.d.'
  const title = reference?.title || reference?.citation || 'Untitled'
  const journal = reference?.journal ? ` ${reference.journal}.` : ''
  const doi = reference?.doi ? ` DOI: ${reference.doi}` : ''
  return `${index + 1}. ${(authors || 'Unknown Authors')} (${year}). ${title}.${journal}${doi}`.trim()
}

function buildReferenceListContent(references: any[]): string {
  return references.map((item, index) => formatReferenceLine(item, index)).join('\n\n')
}

function isLocalBackend(backendUrl?: string): boolean {
  return String(backendUrl || '').startsWith('local://')
}

function normalizeRemoteImageUrl(rawUrl: string, backendUrl: string): string {
  const url = String(rawUrl || '').trim().replace(/^<|>$/g, '').replace(/^['"]|['"]$/g, '').replace(/\\/g, '/')
  if (!url) return url
  if (/^(https?:)?\/\//i.test(url) || url.startsWith('data:') || /^file:/i.test(url)) return url
  if (isLocalBackend(backendUrl)) {
    return toFileUrl(url)
  }
  const normalized = url.startsWith('/') ? url : `/${url}`
  return `${backendUrl}${normalized}`
}

function deriveImageFilename(source: string, fallbackPrefix = 'figure'): string {
  const normalized = normalizeLocalImagePath(source).split(/[?#]/)[0] || ''
  const candidate = normalized.split(/[\\/]/).pop() || ''
  const trimmed = String(candidate || '').trim().replace(/^['"]|['"]$/g, '')
  if (!trimmed) return `${fallbackPrefix}_${Date.now()}.png`
  try {
    return decodeURIComponent(trimmed)
  } catch {
    return trimmed
  }
}

export async function saveResultToWorkspace(activeWorkspacePath: string | null, result: any, onStatus?: (msg: string) => void, backendBaseUrl?: string): Promise<Record<string, string>> {
  const urlMap: Record<string, string> = {}
  if (!activeWorkspacePath) return urlMap
  const api = window.electronAPI
  const backendUrl = String(backendBaseUrl || 'local://electron-main').replace(/\/$/, '')
  const structure = await api.detectProjectStructure(activeWorkspacePath)

  const saveImage = async (imageUrl: string, filename?: string) => {
    if (structure.hasFigures) {
      return api.saveImageToFigures(activeWorkspacePath, imageUrl, filename)
    }
    return api.saveImageFromUrl(activeWorkspacePath, imageUrl, filename)
  }

  const figures = Array.isArray(result.figures)
    ? result.figures
    : Array.isArray(result.images)
      ? result.images.map((item: Record<string, any>) => ({
          url: item.url || item.image_url || item.path || '',
          image_url: item.image_url || item.url || item.path || '',
          path: item.path || item.url || item.image_url || '',
          filename: item.filename || String(item.path || item.url || item.image_url || '').split(/[\\/]/).pop(),
        }))
      : []
  for (const fig of figures) {
    const rawUrl = fig.url || fig.image_url || fig.path || ''
    if (!rawUrl) continue
    const normalized = normalizeRemoteImageUrl(rawUrl, backendUrl)
    if (isWorkspaceLocalImage(normalized, activeWorkspacePath)) {
      const existingPath = normalizeLocalImagePath(normalized)
      urlMap[rawUrl] = existingPath
      urlMap[normalized] = existingPath
      continue
    }
    const filename = fig.filename || deriveImageFilename(normalized)
    try {
      const saved = await saveImage(normalizeLocalImagePath(normalized), filename)
      urlMap[rawUrl] = saved.path
      urlMap[normalized] = saved.path
    } catch {
      continue
    }
  }

  if (Object.keys(urlMap).length > 0) {
    onStatus?.(`已提取并保存 ${Object.keys(urlMap).length} 张图片到工作区`)
  }
  return urlMap
}

export async function saveResultReferencesToWorkspace(activeWorkspacePath: string | null, result: any, referenceTargetPath: string | null, onStatus?: (msg: string) => void): Promise<{ total: number; added: number; titles: string[] }> {
  const refs = Array.isArray(result?.reference_list)
    ? result.reference_list
    : Array.isArray(result?.references)
      ? result.references
      : []
  if (!activeWorkspacePath || !referenceTargetPath || refs.length === 0) {
    return { total: 0, added: 0, titles: [] }
  }

  const api = window.electronAPI
  const existing = await api.readReferences(activeWorkspacePath, referenceTargetPath)
  const existingRefs = Array.isArray(existing.references) ? existing.references : []
  const existingKeys = new Set(existingRefs.map((item) => referenceIdentity(item)))
  const merged = sortReferences(mergeReferences(existingRefs, refs))
  const addedItems = merged.filter((item) => !existingKeys.has(referenceIdentity(item)))

  await api.saveReferences(activeWorkspacePath, merged, referenceTargetPath)
  onStatus?.(`已保存 ${merged.length} 条参考文献到当前文档引用文件`)

  return {
    total: merged.length,
    added: addedItems.length,
    titles: addedItems.slice(0, 5).map((item) => String(item?.title || item?.citation || item || '').trim()).filter(Boolean),
  }
}

export async function saveReferencesIncrementallyToWorkspace(activeWorkspacePath: string | null, references: any[], referenceTargetPath: string | null, onStatus?: (msg: string) => void): Promise<{ total: number; added: number; titles: string[] }> {
  if (!activeWorkspacePath || !referenceTargetPath || references.length === 0) return { total: 0, added: 0, titles: [] }
  const api = window.electronAPI
  const existing = await api.readReferences(activeWorkspacePath, referenceTargetPath)
  const existingRefs = Array.isArray(existing.references) ? existing.references : []
  const merged = sortReferences(mergeReferences(existingRefs, references))
  const existingKeys = new Set(existingRefs.map((item) => referenceIdentity(item)))
  const addedItems = merged.filter((item) => !existingKeys.has(referenceIdentity(item)))
  await api.saveReferences(activeWorkspacePath, merged, referenceTargetPath)

  onStatus?.(`已实时保存 ${addedItems.length} 条参考文献到当前文档引用文件，当前共 ${merged.length} 条`)
  return {
    total: merged.length,
    added: addedItems.length,
    titles: addedItems.slice(0, 5).map((item) => String(item?.title || item?.citation || item || '').trim()).filter(Boolean),
  }
}

export async function saveImageIncrementallyToWorkspace(activeWorkspacePath: string | null, imageUrl: string, filename?: string, onStatus?: (msg: string) => void, backendBaseUrl?: string): Promise<{ path: string; relativePath: string; filename: string } | null> {
  if (!activeWorkspacePath || !imageUrl) return null
  const api = window.electronAPI
  const backendUrl = String(backendBaseUrl || 'local://electron-main').replace(/\/$/, '')
  const structure = await api.detectProjectStructure(activeWorkspacePath)
  const normalized = normalizeRemoteImageUrl(imageUrl, backendUrl)
  if (isWorkspaceLocalImage(normalized, activeWorkspacePath)) {
    const existingPath = normalizeLocalImagePath(normalized)
    const relativePath = existingPath.replace(String(activeWorkspacePath).replace(/\\/g, '/'), '').replace(/^\/+/, '')
    onStatus?.(`图片已位于工作区: ${relativePath || existingPath}`)
    return {
      path: existingPath,
      relativePath: relativePath || existingPath,
      filename: filename || existingPath.split(/[\\/]/).pop() || `figure_${Date.now()}.png`,
    }
  }
  const safeFilename = filename || deriveImageFilename(normalized)

  const saved = structure.hasFigures
    ? await api.saveImageToFigures(activeWorkspacePath, normalizeLocalImagePath(normalized), safeFilename)
    : await api.saveImageFromUrl(activeWorkspacePath, normalizeLocalImagePath(normalized), safeFilename)

  onStatus?.(`已实时保存图片到工作区: ${saved.relativePath}`)
  return { path: saved.path, relativePath: saved.relativePath, filename: saved.filename }
}

export function replaceImageUrls(md: string, urlMap: Record<string, string>): string {
  let result = md
  for (const [from, to] of Object.entries(urlMap)) {
    result = result.split(from).join(toFileUrl(to))
  }
  return result
}

export function fixRelativeImageUrls(md: string, backendUrl: string): string {
  if (!backendUrl) return md
  return md.replace(/!\[([^\]]*)\]\((?!https?:\/\/|file:\/\/\/|data:)([^)]+)\)/g, (_, alt, rawUrl) => `![${alt}](${normalizeRemoteImageUrl(rawUrl, backendUrl)})`)
}