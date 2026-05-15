import type { DocumentArtifact } from '../document/core'
import type { DocumentBlock } from '../document/schema'

export type PptPrimarySourceKind = 'document-artifact' | 'preview-text'

export interface PptPrimarySourceState {
  kind: PptPrimarySourceKind
  title: string
  documentArtifact: DocumentArtifact | null
  previewText: string
  updatedAt: string | null
}

function normalizeSourceText(value: string): string {
  return String(value || '')
    .replace(/\r/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function normalizeTitle(value: string): string {
  return String(value || '').replace(/\.[^.]+$/, '').trim() || '当前文稿'
}

function serializeTableBlock(block: Extract<DocumentBlock, { type: 'table' }>): string[] {
  const headers = Array.isArray(block.value?.headers)
    ? block.value.headers.map((item) => String(item ?? '').trim()).filter(Boolean)
    : []
  const rows = Array.isArray(block.value?.rows)
    ? block.value.rows
        .map((row) => Array.isArray(row) ? row.map((item) => String(item ?? '').trim()).filter(Boolean).join(' | ') : '')
        .filter(Boolean)
    : []
  const lines = [headers.join(' | '), ...rows].filter(Boolean)
  return lines.length > 0 ? [`表格：${lines.join('；')}`] : []
}

function serializeSlotBlock(block: Extract<DocumentBlock, { type: 'slot' }>): string[] {
  const richText = typeof block.value?.richText === 'string' ? block.value.richText.trim() : ''
  const text = typeof block.value?.text === 'string' ? block.value.text.trim() : ''
  const fallback = String(block.text || '').trim()
  const content = richText || text || fallback
  if (!content) return []
  return [content]
}

function serializeImageBlock(block: Extract<DocumentBlock, { type: 'image' }>): string[] {
  const alt = String(block.value?.alt || '').trim()
  const caption = String(block.value?.caption || '').trim()
  const text = String(block.text || '').trim()
  const content = alt || caption || text
  return content ? [`图片：${content}`] : ['图片内容']
}

function collectBlockText(block: DocumentBlock, segments: string[]): void {
  if (block.type === 'heading') {
    const text = String(block.text || '').trim()
    if (text) segments.push(text)
  } else if (block.type === 'paragraph' || block.type === 'html' || block.type === 'citation') {
    const text = String(block.text || '').trim()
    if (text) segments.push(text)
  } else if (block.type === 'slot') {
    segments.push(...serializeSlotBlock(block))
  } else if (block.type === 'table') {
    segments.push(...serializeTableBlock(block))
  } else if (block.type === 'image') {
    segments.push(...serializeImageBlock(block))
  }

  for (const child of block.children || []) {
    collectBlockText(child, segments)
  }
}

export function createPptPrimarySourceState(input: {
  title?: string | null
  documentArtifact?: DocumentArtifact | null
  previewText?: string | null
  updatedAt?: string | null
}): PptPrimarySourceState | null {
  const documentArtifact = input.documentArtifact || null
  const previewText = normalizeSourceText(String(input.previewText || ''))
  if (!documentArtifact && !previewText) return null
  return {
    kind: documentArtifact ? 'document-artifact' : 'preview-text',
    title: normalizeTitle(String(input.title || '')),
    documentArtifact,
    previewText,
    updatedAt: input.updatedAt || null,
  }
}

export function extractPptPrimarySourceParagraphs(source: PptPrimarySourceState | null): {
  title: string | null
  sourceKind: PptPrimarySourceKind | null
  paragraphs: string[]
  sourceTextLength: number
} {
  if (!source) {
    return {
      title: null,
      sourceKind: null,
      paragraphs: [],
      sourceTextLength: 0,
    }
  }

  const artifactSegments: string[] = []
  if (source.documentArtifact?.document?.blocks?.length) {
    for (const block of source.documentArtifact.document.blocks) {
      collectBlockText(block, artifactSegments)
    }
  }

  const artifactParagraphs = artifactSegments
    .map((item) => normalizeSourceText(item))
    .filter(Boolean)
  const artifactTextLength = artifactParagraphs.join('\n\n').length
  const previewParagraphs = normalizeSourceText(source.previewText)
    .split(/\n+/)
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const previewTextLength = normalizeSourceText(source.previewText).length
  const shouldPreferPreviewText = previewTextLength > artifactTextLength + 80

  if (artifactParagraphs.length > 0 && !shouldPreferPreviewText) {
    return {
      title: source.title,
      sourceKind: source.kind,
      paragraphs: artifactParagraphs,
      sourceTextLength: artifactTextLength,
    }
  }

  return {
    title: source.title,
    sourceKind: source.kind,
    paragraphs: previewParagraphs,
    sourceTextLength: previewTextLength,
  }
}