export interface DisplayUrlOptions {
  backendUrl?: string
}

function isRemoteUrl(value: string): boolean {
  return /^(https?:)?\/\//i.test(value)
}

function isDataUrl(value: string): boolean {
  return value.startsWith('data:')
}

function isFileUrl(value: string): boolean {
  return value.startsWith('file:///')
}

function isWindowsDrivePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value)
}

export function normalizeFileLikePath(rawPath: string): string {
  const trimmed = String(rawPath || '').trim().replace(/^['"]|['"]$/g, '')
  if (!trimmed) return ''
  if (isDataUrl(trimmed) || isRemoteUrl(trimmed)) return trimmed
  if (isFileUrl(trimmed)) {
    // file:///path or file:///E:/path  →  /path or /E:/path or E:/path
    try {
      const stripped = decodeURIComponent(trimmed.replace(/^file:\/\//, ''))
      if (/^\/[a-zA-Z]:\//.test(stripped)) return stripped.slice(1)  // /E:/path → E:/path
      return stripped
    } catch {
      const stripped = trimmed.replace(/^file:\/\//, '')
      if (/^\/[a-zA-Z]:\//.test(stripped)) return stripped.slice(1)
      return stripped
    }
  }
  // Handle legacy Windows 2-slash file URLs: file://E:/path → E:/path
  if (/^file:\/\/[a-zA-Z]:[\\/]/.test(trimmed)) {
    try {
      return decodeURIComponent(trimmed.replace(/^file:\/\//, ''))
    } catch {
      return trimmed.replace(/^file:\/\//, '')
    }
  }
  return trimmed.replace(/\\/g, '/')
}

export function toFileUrl(rawPath: string): string {
  const normalized = normalizeFileLikePath(rawPath)
  if (!normalized) return ''
  if (isDataUrl(normalized) || isRemoteUrl(normalized) || isFileUrl(normalized)) return normalized

  const absolutePath = isWindowsDrivePath(normalized)
    ? normalized.replace(/\\/g, '/')
    : normalized.startsWith('/')
      ? normalized
      : `/${normalized}`

  // Windows drive paths (E:/...) need three slashes: file:///E:/...
  // Unix absolute paths (/path/...) already start with /, so two slashes is enough: file:///path/...
  // Both cases need exactly three slashes total.
  const sep = isWindowsDrivePath(absolutePath) ? '///' : '//'
  return `file:${sep}${encodeURI(absolutePath)}`
}

export function toDisplayUrl(rawPath: string, options?: DisplayUrlOptions): string {
  const normalized = normalizeFileLikePath(rawPath)
  if (!normalized) return ''
  if (isDataUrl(normalized) || isRemoteUrl(normalized) || isFileUrl(normalized)) return normalized

  const backendUrl = String(options?.backendUrl || '').trim().replace(/\/$/, '')
  if (backendUrl && !backendUrl.startsWith('local://')) {
    if (normalized.startsWith('/')) return `${backendUrl}${normalized}`
    return `${backendUrl}/${normalized.replace(/^\/+/, '')}`
  }

  return toFileUrl(normalized)
}