import { serializeEmbeddedBlocksToMarkdown } from '../../../engines/documentEngine/embeddedPaperDocument'

export interface PaperContentEventLike {
  cumulativeMarkdown?: unknown
  cumulative_markdown?: unknown
  content?: unknown
  structuredBlocks?: unknown[]
  structured_blocks?: unknown[]
}

function pickStructuredBlocks(event: PaperContentEventLike | Record<string, unknown>): unknown[] {
  const e = event as Record<string, unknown>
  if (Array.isArray(e.structuredBlocks)) return e.structuredBlocks
  if (Array.isArray(e.structured_blocks)) return e.structured_blocks
  return []
}

function pickCumulativeMarkdown(event: PaperContentEventLike | Record<string, unknown>): string {
  const e = event as Record<string, unknown>
  const a = e.cumulativeMarkdown
  const b = e.cumulative_markdown
  const s = typeof a === 'string' ? a : typeof b === 'string' ? b : ''
  return s.trim()
}

export function resolveStreamingPreviewMarkdown(event: PaperContentEventLike | Record<string, unknown> | null | undefined, previousMarkdown = ''): string {
  if (!event) return ''

  const structuredBlocks = pickStructuredBlocks(event)
  if (structuredBlocks.length > 0) {
    return serializeEmbeddedBlocksToMarkdown(structuredBlocks as Parameters<typeof serializeEmbeddedBlocksToMarkdown>[0])
  }

  const cumulativeMarkdown = pickCumulativeMarkdown(event)
  if (cumulativeMarkdown) return cumulativeMarkdown

  const content = typeof (event as PaperContentEventLike).content === 'string' ? (event as PaperContentEventLike).content as string : ''
  if (!content.trim()) return ''
  if (!previousMarkdown) return content
  if (content.startsWith(previousMarkdown)) return content
  return `${previousMarkdown}${content}`
}
