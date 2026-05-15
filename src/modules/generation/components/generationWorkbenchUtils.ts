import { getBackendUrl } from '../../../config'
import {
  normalizeFileLikePath as normalizeSharedFileLikePath,
  toDisplayUrl as toSharedDisplayUrl,
} from '../../../shared/url/fileUrlHelper'

export function getFileName(value: string): string {
  const normalized = String(value || '').replace(/\\/g, '/').trim()
  const lastSlashIndex = normalized.lastIndexOf('/')
  return lastSlashIndex >= 0 ? normalized.slice(lastSlashIndex + 1) : normalized
}

export function getParentPath(value: string): string {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/\/+$/g, '').trim()
  const lastSlashIndex = normalized.lastIndexOf('/')
  return lastSlashIndex > 0 ? normalized.slice(0, lastSlashIndex) : normalized
}

export function normalizePreviewText(value: string): string {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 18)
    .join('\n\n')
}

export function toDisplayUrl(rawPath: string): string {
  return toSharedDisplayUrl(rawPath, { backendUrl: getBackendUrl() })
}

export function normalizeFileLikePath(rawPath: string): string {
  return normalizeSharedFileLikePath(rawPath)
}

export function buildTimestampStamp(): string {
  const now = new Date()
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
}

export function sanitizeFileStem(value: string, fallback = '生成结果'): string {
  const normalized = String(value || '')
    .replace(/\.[^.]+$/g, '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return (normalized || fallback).slice(0, 42)
}