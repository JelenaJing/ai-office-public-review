import fs from 'node:fs/promises'
import path from 'node:path'
import { buildKnowledgeDocumentChunkIndex } from '../../../src/shared/knowledge/knowledgeDocumentJson'
import {
  type KnowledgeChunkMeta,
  type KnowledgeCitation,
  type KnowledgeDocumentChunkIndex,
  type KnowledgeDocumentDetail,
  type KnowledgeRetrievalHit,
  type KnowledgeRetrievalHitSource,
  type KnowledgeRetrievalMatchType,
  type KnowledgeRetrievalQuery,
  type KnowledgeRetrievalResult,
  type KnowledgeSourceType,
  type KnowledgeTaskConstraints,
  type PreviewKnowledgeTaskContextInput,
  type PreviewKnowledgeTaskContextResult,
  KnowledgeService,
} from './knowledgeService'

const CHUNK_TARGET_LENGTH = 900
const CHUNK_HARD_LIMIT = 1400

function nowIso(): string {
  return new Date().toISOString()
}

function normalizeText(value: string): string {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/\u0000/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true })
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function writeJsonAtomic(filePath: string, payload: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath))
  const tempPath = `${filePath}.tmp-${Date.now()}`
  await fs.writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf-8')
  await fs.rename(tempPath, filePath)
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(String(text || '').length / 4))
}

function summarizeText(text: string, maxLength = 140): string {
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

function isHeadingLine(line: string): boolean {
  const value = String(line || '').trim()
  if (!value || value.length > 40) return false
  if (/^(第[一二三四五六七八九十百]+[章节部分]|[0-9]{1,2}(\.[0-9]{1,2})*|[一二三四五六七八九十]+[、.])/.test(value)) return true
  if (/^(摘要|引言|背景|概述|方法|研究方法|结果|讨论|结论|建议|实施路径|风险分析|附录|Abstract|Introduction|Background|Method|Methods|Results|Discussion|Conclusion|Recommendations|Appendix)$/i.test(value)) return true
  return false
}

function splitParagraphs(text: string): Array<{ text: string; heading?: string }> {
  const lines = normalizeText(text).split(/\n/)
  const blocks: Array<{ text: string; heading?: string }> = []
  let currentHeading: string | undefined
  let paragraphBuffer: string[] = []

  const flushParagraph = () => {
    const joined = normalizeText(paragraphBuffer.join(' '))
    if (joined) {
      blocks.push({ text: joined, heading: currentHeading })
    }
    paragraphBuffer = []
  }

  for (const lineRaw of lines) {
    const line = String(lineRaw || '').trim()
    if (!line) {
      flushParagraph()
      continue
    }
    if (isHeadingLine(line)) {
      flushParagraph()
      currentHeading = line
      continue
    }
    paragraphBuffer.push(line)
  }

  flushParagraph()
  return blocks
}

function splitLongParagraph(text: string, maxLength: number): string[] {
  const normalized = normalizeText(text)
  if (normalized.length <= maxLength) return [normalized]

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
    if (!buffer) {
      buffer = part
      continue
    }
    if ((buffer + part).length <= maxLength) {
      buffer = `${buffer} ${part}`.trim()
      continue
    }
    chunks.push(buffer)
    buffer = part
  }
  if (buffer) chunks.push(buffer)
  return chunks
}

function createChunkId(documentId: string, versionId: string | undefined, order: number): string {
  return `${documentId}-${versionId || 'current'}-chunk-${order}`
}

function normalizeConstraints(input?: Partial<KnowledgeTaskConstraints> | null): KnowledgeTaskConstraints {
  const mode = input?.mode === 'selected-only' || input?.mode === 'selected-first' || input?.mode === 'auto'
    ? input.mode
    : 'selected-first'
  const requiredReferenceDocumentIds = Array.from(new Set((input?.requiredReferenceDocumentIds || []).map((item) => String(item || '').trim()).filter(Boolean)))
  const preferredReferenceDocumentIds = Array.from(new Set((input?.preferredReferenceDocumentIds || []).map((item) => String(item || '').trim()).filter(Boolean)))
    .filter((item) => !requiredReferenceDocumentIds.includes(item))

  return {
    mode,
    templateDocumentId: String(input?.templateDocumentId || '').trim() || undefined,
    requiredReferenceDocumentIds,
    preferredReferenceDocumentIds,
    allowAutoRetrieval: input?.allowAutoRetrieval === undefined ? mode !== 'selected-only' : Boolean(input.allowAutoRetrieval),
    autoRetrievalLimit: Math.max(1, Math.min(12, Number(input?.autoRetrievalLimit || 5))),
    templateInheritance: {
      structure: input?.templateInheritance?.structure !== false,
      tone: input?.templateInheritance?.tone !== false,
      terminology: input?.templateInheritance?.terminology !== false,
    },
  }
}

function normalizeQueryTokens(query: string): string[] {
  const normalized = normalizeText(query).toLowerCase()
  if (!normalized) return []
  const tokens = normalized.split(/\s+/).filter(Boolean)
  if (tokens.length > 1) return Array.from(new Set(tokens))
  return Array.from(new Set([normalized, ...(normalized.match(/[\u4e00-\u9fa5]{2,8}|[a-z0-9][a-z0-9_-]{2,}/g) || [])]))
}

function scoreChunk(chunk: KnowledgeChunkMeta, query: string): { score: number; matchedBy: KnowledgeRetrievalMatchType[] } {
  const tokens = normalizeQueryTokens(query)
  if (!tokens.length) {
    return { score: 1, matchedBy: ['heuristic'] }
  }

  const text = chunk.normalizedText.toLowerCase()
  const summary = chunk.summary.toLowerCase()
  const title = chunk.titlePath.join(' ').toLowerCase()
  let score = 0
  const matchedBy = new Set<KnowledgeRetrievalMatchType>()

  for (const token of tokens) {
    if (title.includes(token)) {
      score += 6
      matchedBy.add('title')
    }
    if (summary.includes(token)) {
      score += 4
      matchedBy.add('summary')
    }
    if (text.includes(token)) {
      score += 3
      matchedBy.add('keyword')
    }
  }

  if (!matchedBy.size && text.slice(0, 240)) {
    score += 1
    matchedBy.add('heuristic')
  }

  return { score, matchedBy: Array.from(matchedBy) }
}

function buildLocatorLabel(chunk: KnowledgeChunkMeta): string {
  if (chunk.pageStart && chunk.pageEnd && chunk.pageStart !== chunk.pageEnd) {
    return `第 ${chunk.pageStart}-${chunk.pageEnd} 页`
  }
  if (chunk.pageStart) {
    return `第 ${chunk.pageStart} 页`
  }
  if (chunk.paragraphStart && chunk.paragraphEnd && chunk.paragraphStart !== chunk.paragraphEnd) {
    return `段落 ${chunk.paragraphStart}-${chunk.paragraphEnd}`
  }
  if (chunk.paragraphStart) {
    return `段落 ${chunk.paragraphStart}`
  }
  if (chunk.sectionLabel) {
    return chunk.sectionLabel
  }
  return `片段 ${chunk.order + 1}`
}

function buildCitation(documentTitle: string, chunk: KnowledgeChunkMeta, sourceKind: KnowledgeCitation['sourceKind'], score?: number): KnowledgeCitation {
  return {
    id: `citation-${chunk.id}`,
    documentId: chunk.documentId,
    chunkId: chunk.id,
    sourceKind,
    documentTitle,
    locatorLabel: buildLocatorLabel(chunk),
    quote: summarizeText(chunk.text, 220),
    score,
  }
}

function buildTemplateSummary(detail: KnowledgeDocumentDetail, constraints: KnowledgeTaskConstraints): string {
  const parts: string[] = [
    `模板：${detail.meta.title}`,
    `继承范围：${[
      constraints.templateInheritance.structure ? '结构' : '',
      constraints.templateInheritance.tone ? '语气' : '',
      constraints.templateInheritance.terminology ? '术语' : '',
    ].filter(Boolean).join(' / ') || '未指定'}`,
  ]

  const excerpt = summarizeText(detail.extractedText || detail.originalExtractedText, 260)
  if (excerpt) parts.push(`节选：${excerpt}`)
  return parts.join('\n')
}

export class KnowledgeRetrievalService {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  private async getChunksDir(): Promise<string> {
    const info = await this.knowledgeService.getInfo()
    const chunksDir = path.join(info.rootPath, 'chunks')
    await ensureDir(chunksDir)
    return chunksDir
  }

  private async getChunkIndexPath(documentId: string, versionId?: string, useParsedSource = false): Promise<string> {
    if (useParsedSource) {
      const info = await this.knowledgeService.getInfo()
      return path.join(info.rootPath, 'documents', documentId, 'parsed', 'chunks.json')
    }
    const suffix = versionId ? `${documentId}.${versionId}.chunks.json` : `${documentId}.chunks.json`
    return path.join(await this.getChunksDir(), suffix)
  }

  private async buildChunksForDetail(detail: KnowledgeDocumentDetail, versionId?: string): Promise<KnowledgeDocumentChunkIndex> {
    const sourceVersionId = detail.versions.find((item) => item.kind === 'source')?.id || undefined
    const targetVersionId = versionId || detail.currentVersionId || sourceVersionId
    if (detail.parsedDocument && sourceVersionId && targetVersionId === sourceVersionId) {
      return {
        documentId: detail.meta.id,
        versionId: targetVersionId,
        updatedAt: detail.parsedDocument.updatedAt,
        chunks: buildKnowledgeDocumentChunkIndex(detail.parsedDocument).map((chunk) => ({
          id: chunk.id,
          documentId: detail.meta.id,
          versionId: targetVersionId,
          order: chunk.order,
          titlePath: chunk.titlePath,
          sectionLabel: chunk.titlePath[chunk.titlePath.length - 1] || undefined,
          text: chunk.text,
          normalizedText: chunk.text,
          summary: chunk.summary,
          keywords: chunk.keywords,
          tokenEstimate: chunk.tokenEstimate,
          sourceType: detail.meta.sourceType,
          createdAt: detail.meta.importedAt,
          updatedAt: detail.parsedDocument?.updatedAt || detail.meta.updatedAt,
        })),
      }
    }

    const sourceText = normalizeText(detail.extractedText || detail.originalExtractedText)
    const paragraphs = splitParagraphs(sourceText)
    const chunks: KnowledgeChunkMeta[] = []
    let currentOrder = 0
    let paragraphOffset = 1

    for (const paragraph of paragraphs) {
      const sectionLabel = paragraph.heading
      const titlePath = sectionLabel ? [sectionLabel] : []
      const paragraphParts = splitLongParagraph(paragraph.text, CHUNK_HARD_LIMIT)
      let buffer = ''
      let chunkParagraphStart = paragraphOffset

      for (let index = 0; index < paragraphParts.length; index += 1) {
        const part = paragraphParts[index]
        const candidate = buffer ? `${buffer}\n${part}` : part
        if (candidate.length <= CHUNK_TARGET_LENGTH || !buffer) {
          buffer = candidate
        } else {
          const normalized = normalizeText(buffer)
          chunks.push({
            id: createChunkId(detail.meta.id, versionId || detail.currentVersionId || undefined, currentOrder),
            documentId: detail.meta.id,
            versionId: versionId || detail.currentVersionId || undefined,
            order: currentOrder,
            titlePath,
            sectionLabel,
            paragraphStart: chunkParagraphStart,
            paragraphEnd: paragraphOffset - 1,
            text: normalized,
            normalizedText: normalized,
            summary: summarizeText(normalized),
            keywords: extractKeywords(normalized),
            tokenEstimate: estimateTokens(normalized),
            sourceType: detail.meta.sourceType,
            createdAt: detail.meta.importedAt,
            updatedAt: detail.meta.updatedAt,
          })
          currentOrder += 1
          buffer = part
          chunkParagraphStart = paragraphOffset
        }

        const isLastPart = index === paragraphParts.length - 1
        if (isLastPart && buffer) {
          const normalized = normalizeText(buffer)
          chunks.push({
            id: createChunkId(detail.meta.id, versionId || detail.currentVersionId || undefined, currentOrder),
            documentId: detail.meta.id,
            versionId: versionId || detail.currentVersionId || undefined,
            order: currentOrder,
            titlePath,
            sectionLabel,
            paragraphStart: chunkParagraphStart,
            paragraphEnd: paragraphOffset,
            text: normalized,
            normalizedText: normalized,
            summary: summarizeText(normalized),
            keywords: extractKeywords(normalized),
            tokenEstimate: estimateTokens(normalized),
            sourceType: detail.meta.sourceType,
            createdAt: detail.meta.importedAt,
            updatedAt: detail.meta.updatedAt,
          })
          currentOrder += 1
          buffer = ''
        }
      }

      paragraphOffset += 1
    }

    return {
      documentId: detail.meta.id,
      versionId: versionId || detail.currentVersionId || undefined,
      updatedAt: nowIso(),
      chunks,
    }
  }

  private async readChunkIndex(documentId: string, versionId?: string): Promise<KnowledgeDocumentChunkIndex> {
    const detail = await this.knowledgeService.getDocument(documentId)
    if (!detail) {
      throw new Error('未找到对应的知识库文档')
    }
    const sourceVersionId = detail.versions.find((item) => item.kind === 'source')?.id || undefined
    const targetVersionId = versionId || detail.currentVersionId || sourceVersionId
    if (detail.meta.sourceType === 'image') {
      return {
        documentId,
        versionId: targetVersionId || undefined,
        updatedAt: nowIso(),
        chunks: [],
      }
    }

    const useParsedSource = Boolean(detail.parsedDocument && sourceVersionId && targetVersionId === sourceVersionId)
    const indexPath = await this.getChunkIndexPath(documentId, targetVersionId, useParsedSource)
    if (await pathExists(indexPath)) {
      try {
        const parsed = JSON.parse(await fs.readFile(indexPath, 'utf-8')) as KnowledgeDocumentChunkIndex
        if (parsed && parsed.documentId === documentId && (!targetVersionId || parsed.versionId === targetVersionId || !parsed.versionId)) {
          return {
            documentId: parsed.documentId,
            versionId: parsed.versionId,
            updatedAt: parsed.updatedAt || nowIso(),
            chunks: Array.isArray(parsed.chunks) ? parsed.chunks : [],
          }
        }
      } catch {
        // fall through and rebuild index
      }
    }

    const built = await this.buildChunksForDetail(detail, targetVersionId)
    await writeJsonAtomic(indexPath, built)
    return built
  }

  async listDocumentChunks(payload: { documentId: string; versionId?: string }): Promise<KnowledgeChunkMeta[]> {
    const documentId = String(payload.documentId || '').trim()
    const versionId = String(payload.versionId || '').trim() || undefined
    if (!documentId) throw new Error('文档 ID 不能为空')
    const index = await this.readChunkIndex(documentId, versionId)
    return index.chunks
  }

  private async resolveDocumentsByIds(documentIds: string[]): Promise<Map<string, KnowledgeDocumentDetail>> {
    const results = await Promise.all(documentIds.map(async (documentId) => {
      const detail = await this.knowledgeService.getDocument(documentId).catch(() => null)
      return detail ? [documentId, detail] as const : null
    }))
    return new Map(results.filter(Boolean) as Array<readonly [string, KnowledgeDocumentDetail]>)
  }

  private async listCandidateDocuments(query: KnowledgeRetrievalQuery): Promise<KnowledgeDocumentDetail[]> {
    const includeIds = Array.from(new Set((query.includeDocumentIds || []).map((item) => String(item || '').trim()).filter(Boolean)))
    const excludeIds = new Set((query.excludeDocumentIds || []).map((item) => String(item || '').trim()).filter(Boolean))
    const sourceTypeSet = new Set((query.sourceTypes || []).map((item) => String(item || '').trim()).filter(Boolean))

    if (includeIds.length) {
      const included = await this.resolveDocumentsByIds(includeIds)
      return Array.from(included.values()).filter((detail) => !excludeIds.has(detail.meta.id) && (sourceTypeSet.size === 0 || sourceTypeSet.has(detail.meta.sourceType)))
    }

    const docs = await this.knowledgeService.listDocuments()
    const details = await Promise.all(docs.map((document) => this.knowledgeService.getDocument(document.id).catch(() => null)))
    return details.filter((detail): detail is KnowledgeDocumentDetail => {
      if (!detail) return false
      return !excludeIds.has(detail.meta.id)
        && (sourceTypeSet.size === 0 || sourceTypeSet.has(detail.meta.sourceType))
    })
  }

  async retrieveChunks(query: KnowledgeRetrievalQuery): Promise<KnowledgeRetrievalResult> {
    const normalizedMode = query.mode === 'selected-only' || query.mode === 'selected-first' || query.mode === 'auto'
      ? query.mode
      : 'selected-first'
    const limit = Math.max(1, Math.min(20, Number(query.maxChunks || 6)))
    const requiredIds = Array.from(new Set((query.requiredReferenceDocumentIds || []).map((item) => String(item || '').trim()).filter(Boolean)))
    const preferredIds = Array.from(new Set((query.preferredReferenceDocumentIds || []).map((item) => String(item || '').trim()).filter(Boolean))).filter((item) => !requiredIds.includes(item))

    const hits: KnowledgeRetrievalHit[] = []
    const citationMap = new Map<string, KnowledgeCitation>()

    const scoreAndSelect = async (details: KnowledgeDocumentDetail[], source: KnowledgeRetrievalHitSource, maxCount: number) => {
      const scored: Array<{ hit: KnowledgeRetrievalHit; title: string }> = []
      for (const detail of details) {
        const chunks = await this.listDocumentChunks({ documentId: detail.meta.id, versionId: detail.currentVersionId || undefined })
        for (const chunk of chunks) {
          const result = scoreChunk(chunk, query.query)
          if (result.score <= 0) continue
          scored.push({
            title: detail.meta.title,
            hit: {
              chunk,
              score: result.score,
              source,
              matchedBy: result.matchedBy,
              quote: summarizeText(chunk.text, 220),
            },
          })
        }
      }
      scored
        .sort((left, right) => right.hit.score - left.hit.score || left.hit.chunk.order - right.hit.chunk.order)
        .slice(0, maxCount)
        .forEach(({ hit, title }) => {
          hits.push(hit)
          citationMap.set(hit.chunk.id, buildCitation(title, hit.chunk, source, hit.score))
        })
    }

    const requiredMap = await this.resolveDocumentsByIds(requiredIds)
    const preferredMap = await this.resolveDocumentsByIds(preferredIds)
    const explicitIds = new Set([...requiredMap.keys(), ...preferredMap.keys()])

    if (requiredMap.size) {
      await scoreAndSelect(Array.from(requiredMap.values()), 'required-reference', Math.max(1, Math.min(limit, requiredMap.size * 3)))
    }
    if (preferredMap.size && hits.length < limit) {
      await scoreAndSelect(Array.from(preferredMap.values()), 'preferred-reference', Math.max(1, limit - hits.length))
    }

    if (normalizedMode !== 'selected-only' && hits.length < limit) {
      const autoCandidates = (await this.listCandidateDocuments({
        ...query,
        includeDocumentIds: undefined,
        excludeDocumentIds: [...(query.excludeDocumentIds || []), ...Array.from(explicitIds)],
      })).filter((detail) => detail.meta.sourceType !== 'image')
      await scoreAndSelect(autoCandidates, 'auto-retrieval', Math.max(1, limit - hits.length))
    }

    const uniqueHits = Array.from(new Map(hits.map((hit) => [hit.chunk.id, hit])).values())
      .sort((left, right) => right.score - left.score || left.chunk.order - right.chunk.order)
      .slice(0, limit)

    return {
      hits: uniqueHits,
      citations: uniqueHits.map((hit) => citationMap.get(hit.chunk.id)).filter(Boolean) as KnowledgeCitation[],
    }
  }

  async previewTaskContext(payload: PreviewKnowledgeTaskContextInput): Promise<PreviewKnowledgeTaskContextResult> {
    const constraints = normalizeConstraints(payload.constraints)
    const templateDocumentId = constraints.templateDocumentId
    const explicitIds = Array.from(new Set([...constraints.requiredReferenceDocumentIds, ...constraints.preferredReferenceDocumentIds]))
    const explicitReferences = await this.resolveDocumentsByIds(explicitIds)
    const retrieval = await this.retrieveChunks({
      query: String(payload.instruction || '').trim(),
      mode: constraints.mode,
      templateDocumentId,
      requiredReferenceDocumentIds: constraints.requiredReferenceDocumentIds,
      preferredReferenceDocumentIds: constraints.preferredReferenceDocumentIds,
      maxChunks: constraints.allowAutoRetrieval ? constraints.autoRetrievalLimit : explicitIds.length || 4,
    })

    let templateSummary: string | undefined
    if (templateDocumentId) {
      const templateDetail = await this.knowledgeService.getDocument(templateDocumentId).catch(() => null)
      if (templateDetail) {
        templateSummary = buildTemplateSummary(templateDetail, constraints)
      }
    }

    return {
      templateSummary,
      explicitReferenceSummaries: Array.from(explicitReferences.values()).map((detail) => ({
        documentId: detail.meta.id,
        title: detail.meta.title,
      })),
      retrievedHits: retrieval.hits,
      citations: retrieval.citations,
    }
  }
}