import type { KnowledgeSourceType } from '../../types/knowledge'
import type { KnowledgeCanonicalDocument, KnowledgeCanonicalSurface } from '../../types/knowledgeCanonical'
import {
  KNOWLEDGE_DOCUMENT_JSON_SCHEMA_VERSION,
  type KnowledgeDocumentAsset,
  type KnowledgeDocumentBlock,
  type KnowledgeDocumentChunk,
  type KnowledgeDocumentJson,
  type KnowledgeDocumentSection,
} from '../../types/knowledgeDocumentJson'

function normalizeText(value: string): string {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/\u0000/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function summarizeText(text: string, maxLength = 160): string {
  return normalizeText(text).slice(0, maxLength)
}

function extractKeywords(text: string): string[] {
  const normalized = normalizeText(text).toLowerCase()
  if (!normalized) return []
  const latinTokens = normalized.match(/[a-z0-9][a-z0-9_-]{2,}/g) || []
  const cjkTokens = normalized.match(/[\u4e00-\u9fa5]{2,8}/g) || []
  const ranked = new Map<string, number>()
  for (const token of [...latinTokens, ...cjkTokens]) {
    ranked.set(token, (ranked.get(token) || 0) + 1)
  }
  return Array.from(ranked.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh-Hans-CN'))
    .slice(0, 12)
    .map(([token]) => token)
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(String(text || '').length / 4))
}

function isHeadingLine(line: string): boolean {
  const value = String(line || '').trim()
  if (!value || value.length > 40) return false
  if (/^(第[一二三四五六七八九十百]+[章节部分]|[0-9]{1,2}(\.[0-9]{1,2})*|[一二三四五六七八九十]+[、.])/.test(value)) return true
  if (/^(摘要|引言|背景|概述|方法|研究方法|结果|讨论|结论|建议|实施路径|风险分析|附录|Abstract|Introduction|Background|Method|Methods|Results|Discussion|Conclusion|Recommendations|Appendix)$/i.test(value)) return true
  return false
}

function splitLongText(text: string, maxLength = 1200): string[] {
  const normalized = normalizeText(text)
  if (normalized.length <= maxLength) return normalized ? [normalized] : []
  const parts = normalized.split(/(?<=[。！？；.!?;])\s*/).map((item) => item.trim()).filter(Boolean)
  if (parts.length <= 1) {
    const chunks: string[] = []
    for (let index = 0; index < normalized.length; index += maxLength) {
      chunks.push(normalized.slice(index, index + maxLength))
    }
    return chunks
  }
  const chunks: string[] = []
  let buffer = ''
  for (const part of parts) {
    const candidate = buffer ? `${buffer} ${part}`.trim() : part
    if (candidate.length <= maxLength || !buffer) {
      buffer = candidate
      continue
    }
    chunks.push(buffer)
    buffer = part
  }
  if (buffer) chunks.push(buffer)
  return chunks
}

export function buildKnowledgeDocumentChunkIndex(document: Pick<KnowledgeDocumentJson, 'id' | 'sections' | 'blocks' | 'extractedText'>): KnowledgeDocumentChunk[] {
  const blockMap = new Map(document.blocks.map((block) => [block.id, block]))
  const chunks: KnowledgeDocumentChunk[] = []
  let chunkOrder = 0

  const pushChunk = (input: { section?: KnowledgeDocumentSection; blockIds: string[]; text: string }) => {
    const normalized = normalizeText(input.text)
    if (!normalized) return
    for (const part of splitLongText(normalized)) {
      chunks.push({
        id: `${document.id}-chunk-${chunkOrder}`,
        order: chunkOrder,
        sectionId: input.section?.id,
        titlePath: input.section ? [input.section.title] : [],
        blockIds: [...input.blockIds],
        text: part,
        summary: summarizeText(part),
        keywords: extractKeywords(part),
        tokenEstimate: estimateTokens(part),
      })
      chunkOrder += 1
    }
  }

  for (const section of document.sections.sort((left, right) => left.order - right.order)) {
    const blockIds = section.blockIds.filter((blockId) => blockMap.has(blockId))
    const text = blockIds
      .map((blockId) => blockMap.get(blockId))
      .map((block) => {
        if (!block) return ''
        if (block.type === 'table') return (block.rows || []).map((row) => row.join('\t')).join('\n')
        if (block.type === 'list') return (block.items || []).join('\n') || block.text || ''
        return block.text || ''
      })
      .filter(Boolean)
      .join('\n')
    pushChunk({ section, blockIds, text })
  }

  if (chunks.length > 0) return chunks

  const looseText = document.blocks
    .sort((left, right) => left.order - right.order)
    .map((block) => {
      if (block.type === 'table') return (block.rows || []).map((row) => row.join('\t')).join('\n')
      if (block.type === 'list') return (block.items || []).join('\n') || block.text || ''
      return block.text || ''
    })
    .filter(Boolean)
    .join('\n')

  pushChunk({ blockIds: document.blocks.map((block) => block.id), text: looseText || document.extractedText })
  return chunks
}

function ensurePreviewText(document: KnowledgeDocumentJson): string {
  return summarizeText(document.extractedText || document.blocks.map((block) => block.text || '').join('\n'))
}

export function collectKnowledgeDocumentPreviewLines(document: KnowledgeDocumentJson, maxBlocks = 8): string[] {
  const lines: string[] = []
  for (const section of document.sections.sort((left, right) => left.order - right.order)) {
    lines.push(`# ${section.title}`)
    const sectionBlocks = document.blocks
      .filter((block) => block.sectionId === section.id)
      .sort((left, right) => left.order - right.order)
      .slice(0, maxBlocks)
    for (const block of sectionBlocks) {
      if (block.type === 'list') {
        const listText = (block.items || []).join('；') || block.text || ''
        if (listText) lines.push(`- ${listText}`)
        continue
      }
      if (block.type === 'table') {
        const tablePreview = (block.rows || []).slice(0, 2).map((row) => row.join(' | ')).join(' / ')
        if (tablePreview) lines.push(tablePreview)
        continue
      }
      if (block.type === 'image') {
        lines.push(block.text || '[图片]')
        continue
      }
      if (block.text) lines.push(block.text)
    }
    if (lines.length >= maxBlocks + 2) break
  }
  if (lines.length > 0) return lines.slice(0, maxBlocks + 2)
  return splitLongText(document.extractedText || '', 240).slice(0, 4)
}

export function buildKnowledgeDocumentJsonFromPlainText(input: {
  id: string
  title: string
  sourceType: KnowledgeSourceType
  originalFileName: string
  createdAt: string
  updatedAt: string
  mimeType?: string
  hash?: string
  sourceRelativePath?: string
  parsedRelativePath?: string
  chunkIndexRelativePath?: string
  assetDirRelativePath?: string
  extractionStatus?: string
  text: string
}): KnowledgeDocumentJson {
  const normalized = normalizeText(input.text)
  const blocks: KnowledgeDocumentBlock[] = []
  const sections: KnowledgeDocumentSection[] = []
  const assets: KnowledgeDocumentAsset[] = []
  let blockOrder = 0
  let sectionOrder = 0
  let currentSectionId = ''

  const ensureSection = (title: string, level = 1) => {
    const sectionId = `${input.id}-section-${sectionOrder}`
    sections.push({
      id: sectionId,
      title,
      order: sectionOrder,
      level,
      blockIds: [],
      summary: '',
    })
    currentSectionId = sectionId
    sectionOrder += 1
    return sectionId
  }

  const pushBlock = (block: Omit<KnowledgeDocumentBlock, 'order'>) => {
    const nextBlock: KnowledgeDocumentBlock = { ...block, order: blockOrder }
    blocks.push(nextBlock)
    blockOrder += 1
    if (nextBlock.sectionId) {
      const section = sections.find((item) => item.id === nextBlock.sectionId)
      if (section) section.blockIds.push(nextBlock.id)
    }
  }

  ensureSection('正文', 1)

  const lines = normalized.split('\n')
  let paragraphBuffer: string[] = []
  let inCode = false
  let codeBuffer: string[] = []
  let codeLang = ''
  let tableBuffer: string[][] = []
  let listBuffer: string[] = []

  const flushParagraph = () => {
    const text = normalizeText(paragraphBuffer.join(' '))
    if (text) {
      pushBlock({ id: `${input.id}-block-${blockOrder}`, type: 'paragraph', sectionId: currentSectionId, text })
    }
    paragraphBuffer = []
  }

  const flushCode = () => {
    const text = codeBuffer.join('\n').trim()
    if (text) {
      pushBlock({ id: `${input.id}-block-${blockOrder}`, type: 'code', sectionId: currentSectionId, text, language: codeLang || undefined })
    }
    codeBuffer = []
    codeLang = ''
  }

  const flushTable = () => {
    if (tableBuffer.length > 0) {
      pushBlock({ id: `${input.id}-block-${blockOrder}`, type: 'table', sectionId: currentSectionId, rows: tableBuffer.map((row) => [...row]), text: tableBuffer.map((row) => row.join(' | ')).join('\n') })
    }
    tableBuffer = []
  }

  const flushList = () => {
    const items = listBuffer.map((item) => normalizeText(item)).filter(Boolean)
    if (items.length > 0) {
      pushBlock({ id: `${input.id}-block-${blockOrder}`, type: 'list', sectionId: currentSectionId, items, text: items.join('\n') })
    }
    listBuffer = []
  }

  for (const rawLine of lines) {
    const line = String(rawLine || '')
    const trimmed = line.trim()
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/)
    const listMatch = trimmed.match(/^[-*+]\s+(.+)$/)
    const codeFenceMatch = trimmed.match(/^```(.*)$/)
    const tableLine = trimmed.includes('|') && trimmed.split('|').filter(Boolean).length >= 2
    const imageMatch = trimmed.match(/^!\[[^\]]*\]\(([^)]+)\)$/)

    if (codeFenceMatch) {
      flushParagraph()
      flushList()
      flushTable()
      if (inCode) {
        flushCode()
        inCode = false
      } else {
        inCode = true
        codeLang = codeFenceMatch[1].trim()
      }
      continue
    }

    if (inCode) {
      codeBuffer.push(line)
      continue
    }

    if (!trimmed) {
      flushParagraph()
      flushList()
      flushTable()
      continue
    }

    if (headingMatch || isHeadingLine(trimmed)) {
      flushParagraph()
      flushList()
      flushTable()
      const title = headingMatch ? headingMatch[2].trim() : trimmed
      const level = headingMatch ? Math.min(headingMatch[1].length, 6) : 2
      currentSectionId = ensureSection(title, level)
      pushBlock({ id: `${input.id}-block-${blockOrder}`, type: 'heading', sectionId: currentSectionId, level, text: title })
      continue
    }

    if (imageMatch) {
      flushParagraph()
      flushList()
      flushTable()
      const rel = imageMatch[1].trim()
      const assetId = `${input.id}-asset-${assets.length}`
      assets.push({ id: assetId, type: 'image', title: rel.split('/').pop() || rel, originalFileName: rel.split('/').pop() || rel, relativePath: rel })
      pushBlock({ id: `${input.id}-block-${blockOrder}`, type: 'image', sectionId: currentSectionId, assetId, text: rel.split('/').pop() || '图片' })
      continue
    }

    if (listMatch) {
      flushParagraph()
      flushTable()
      listBuffer.push(listMatch[1].trim())
      continue
    }

    if (tableLine) {
      flushParagraph()
      flushList()
      tableBuffer.push(trimmed.split('|').map((cell) => cell.trim()).filter(Boolean))
      continue
    }

    paragraphBuffer.push(trimmed)
  }

  flushParagraph()
  flushList()
  flushTable()
  flushCode()

  const document: KnowledgeDocumentJson = {
    schemaVersion: KNOWLEDGE_DOCUMENT_JSON_SCHEMA_VERSION,
    id: input.id,
    title: input.title,
    sourceType: input.sourceType,
    originalFileName: input.originalFileName,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    metadata: {
      mimeType: input.mimeType,
      hash: input.hash,
      sourceRelativePath: input.sourceRelativePath,
      parsedRelativePath: input.parsedRelativePath,
      chunkIndexRelativePath: input.chunkIndexRelativePath,
      assetDirRelativePath: input.assetDirRelativePath,
      extractionStatus: input.extractionStatus,
    },
    sections,
    blocks,
    extractedText: normalized,
    chunkIndex: [],
    assets,
  }

  document.chunkIndex = buildKnowledgeDocumentChunkIndex(document)
  document.metadata.previewText = ensurePreviewText(document)
  document.sections.forEach((section) => {
    section.summary = summarizeText(
      section.blockIds
        .map((blockId) => blocks.find((block) => block.id === blockId)?.text || '')
        .filter(Boolean)
        .join('\n'),
      120,
    ) || undefined
  })
  return document
}

function buildSectionTitle(surface: KnowledgeCanonicalSurface): string {
  if (surface.surface_type === 'slide') return `幻灯片 ${surface.index}`
  if (surface.surface_type === 'page') return `第 ${surface.index} 页`
  return `画布 ${surface.index}`
}

function normalizeCanonicalImagePath(value?: string): string | undefined {
  const normalized = String(value || '').trim().replace(/\\/g, '/')
  if (!normalized) return undefined
  if (normalized.startsWith('assets/')) return normalized
  const tail = normalized.split('/').filter(Boolean).pop() || normalized
  return `assets/${tail}`
}

export function buildKnowledgeDocumentJsonFromCanonical(input: {
  id: string
  title: string
  sourceType: KnowledgeSourceType
  originalFileName: string
  createdAt: string
  updatedAt: string
  mimeType?: string
  hash?: string
  sourceRelativePath?: string
  parsedRelativePath?: string
  chunkIndexRelativePath?: string
  assetDirRelativePath?: string
  extractionStatus?: string
  canonical: KnowledgeCanonicalDocument
}): KnowledgeDocumentJson {
  const sections: KnowledgeDocumentSection[] = []
  const blocks: KnowledgeDocumentBlock[] = []
  const assets: KnowledgeDocumentAsset[] = []
  let sectionOrder = 0
  let blockOrder = 0
  const assetIds = new Map<string, string>()

  for (const surface of input.canonical.surfaces) {
    const sectionId = `${input.id}-section-${sectionOrder}`
    sections.push({ id: sectionId, title: buildSectionTitle(surface), order: sectionOrder, level: 1, blockIds: [] })
    sectionOrder += 1

    for (const canonicalBlock of [...surface.blocks].sort((left, right) => left.order - right.order)) {
      const blockId = `${input.id}-block-${blockOrder}`
      const text = normalizeText(
        canonicalBlock.content.text || (canonicalBlock.content.rows || []).map((row) => row.join('\t')).join('\n'),
      )
      let nextBlock: KnowledgeDocumentBlock | null = null

      if (canonicalBlock.block_type === 'heading') {
        nextBlock = { id: blockId, type: 'heading', order: blockOrder, sectionId, level: 2, text }
      } else if (canonicalBlock.block_type === 'list') {
        nextBlock = { id: blockId, type: 'list', order: blockOrder, sectionId, items: text ? [text] : [], text }
      } else if (canonicalBlock.block_type === 'table') {
        nextBlock = { id: blockId, type: 'table', order: blockOrder, sectionId, rows: canonicalBlock.content.rows || [], text }
      } else if (canonicalBlock.block_type === 'image') {
        const imageRel = normalizeCanonicalImagePath(canonicalBlock.content.image_rel)
        const imageKey = imageRel || canonicalBlock.content.asset_id || `${input.id}-asset-${assets.length}`
        let assetId = assetIds.get(imageKey)
        if (!assetId) {
          assetId = `${input.id}-asset-${assets.length}`
          assetIds.set(imageKey, assetId)
          assets.push({
            id: assetId,
            type: 'image',
            title: text || canonicalBlock.content.asset_id || '图片',
            originalFileName: imageRel?.split('/').pop() || canonicalBlock.content.asset_id,
            relativePath: imageRel,
            metadata: canonicalBlock.content.image_transform ? { imageTransform: canonicalBlock.content.image_transform } : undefined,
          })
        }
        nextBlock = { id: blockId, type: 'image', order: blockOrder, sectionId, assetId, text: text || '图片' }
      } else if (canonicalBlock.block_type === 'note') {
        nextBlock = { id: blockId, type: 'code', order: blockOrder, sectionId, text }
      } else {
        nextBlock = { id: blockId, type: 'paragraph', order: blockOrder, sectionId, text }
      }

      if (!nextBlock) continue
      blocks.push(nextBlock)
      const section = sections.find((item) => item.id === sectionId)
      if (section) section.blockIds.push(nextBlock.id)
      blockOrder += 1
    }
  }

  const extractedText = normalizeText(
    blocks.map((block) => {
      if (block.type === 'table') return (block.rows || []).map((row) => row.join('\t')).join('\n')
      if (block.type === 'list') return (block.items || []).join('\n') || block.text || ''
      return block.text || ''
    }).filter(Boolean).join('\n\n'),
  )

  const document: KnowledgeDocumentJson = {
    schemaVersion: KNOWLEDGE_DOCUMENT_JSON_SCHEMA_VERSION,
    id: input.id,
    title: input.title,
    sourceType: input.sourceType,
    originalFileName: input.originalFileName,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    metadata: {
      mimeType: input.mimeType,
      hash: input.hash,
      sourceRelativePath: input.sourceRelativePath,
      parsedRelativePath: input.parsedRelativePath,
      chunkIndexRelativePath: input.chunkIndexRelativePath,
      assetDirRelativePath: input.assetDirRelativePath,
      extractionStatus: input.extractionStatus,
      canonicalDocType: input.canonical.doc_type,
      canonicalPresentAs: input.canonical.present_as,
    },
    sections,
    blocks,
    extractedText,
    chunkIndex: [],
    assets,
  }

  document.chunkIndex = buildKnowledgeDocumentChunkIndex(document)
  document.metadata.previewText = ensurePreviewText(document)
  document.sections.forEach((section) => {
    section.summary = summarizeText(
      section.blockIds
        .map((blockId) => blocks.find((block) => block.id === blockId)?.text || '')
        .filter(Boolean)
        .join('\n'),
      120,
    ) || undefined
  })
  return document
}