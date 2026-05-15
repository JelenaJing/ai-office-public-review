/**
 * Remote Knowledge Base API client.
 * Wraps the REST API at the configured base URL and maps responses
 * to the shapes already expected by the preload / renderer layer.
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = 'http://10.26.1.25:8010'

function getBaseUrl(): string {
  return process.env.KNOWLEDGE_API_BASE_URL || DEFAULT_BASE_URL
}

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

/** Default connect/read timeout for all KB API calls (ms). */
const API_TIMEOUT_MS = 8000

function makeSignal(): AbortSignal {
  // AbortSignal.timeout is available in Node 17.3+ / Electron 20+
  return AbortSignal.timeout(API_TIMEOUT_MS)
}

async function apiGet<T = unknown>(path: string, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${path}`, { headers, signal: makeSignal() })
  if (!res.ok) throw new Error(`KB API GET ${path} → ${res.status}`)
  return res.json() as Promise<T>
}

async function apiPost<T = unknown>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body != null ? JSON.stringify(body) : undefined,
    signal: makeSignal(),
  })
  if (!res.ok) throw new Error(`KB API POST ${path} → ${res.status}`)
  return res.json() as Promise<T>
}

async function apiPostForm<T = unknown>(path: string, form: FormData, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${path}`, {
    method: 'POST',
    headers: { ...headers },
    body: form,
    signal: makeSignal(),
  })
  if (!res.ok) throw new Error(`KB API POST(form) ${path} → ${res.status}`)
  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Types – raw API shapes (only the fields we consume)
// ---------------------------------------------------------------------------

interface RawKnowledgeBase {
  kb_id: string
  display_name: string
  description?: string
  parent_kb_id?: string | null
  file_count: number
  created_at?: string
  updated_at?: string
}

interface RawFile {
  file_id: string
  partition: string
  display_name: string
  rel_path?: string
  path_category?: string
  status: string
  page_count?: number
  created_at?: string
  parser_used?: string
}

interface RawQaSource {
  score: number
  file_id: string
  chunk_id?: string
  page_no?: number
  text: string
  page_context?: string
  display_name?: string
}

interface RawQaSourceFile {
  file_id: string
  display_name?: string
  score?: number
  full_text?: string
}

interface RawQaResponse {
  ok: boolean
  results?: RawQaSource[]
  sources?: RawQaSource[]
  source_files?: RawQaSourceFile[]
}

interface RawChatResponse {
  ok: boolean
  kb_id: string
  answer: string | null
  sources: RawQaSource[]
  llm?: { used_llm: boolean; model?: string }
}

interface RawIngestResult {
  file_id: string
  partition: string
  status: string
  parser_used?: string
  chunks?: number
  doc_id?: string
}

// ---------------------------------------------------------------------------
// Mapped types – match existing renderer expectations
// ---------------------------------------------------------------------------

export interface RemoteDepartment {
  id: string
  name: string
  nameEn: string
  preset: boolean
  createdAt: string
  fileCount: number
  parentId?: string
}

export interface RemoteDocumentMeta {
  id: string
  title: string
  sourceType: 'pdf' | 'docx' | 'doc' | 'txt' | 'md' | 'image' | 'pptx'
  originalName: string
  mimeType: string
  hash: string
  importedAt: string
  updatedAt: string
  size: number
  storedRelativePath: string
  extractedRelativePath: string
  extractionStatus: 'ready' | 'failed' | 'pending'
  extractedTextLength: number
  previewText: string
  versionCount: number
  templateUsageCount: number
  documentCategory?: 'academic' | 'other'
}

export interface RemoteRetrievalHit {
  documentId: string
  documentTitle: string
  chunkId: string
  text: string
  score: number
  pageNo?: number
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function mapKbToDepartment(kb: RawKnowledgeBase): RemoteDepartment {
  return {
    id: kb.kb_id,
    name: kb.display_name || kb.kb_id,
    nameEn: kb.kb_id,
    preset: true,
    createdAt: kb.created_at || new Date().toISOString(),
    fileCount: kb.file_count ?? 0,
    parentId: kb.parent_kb_id || undefined,
  }
}

function inferSourceType(name: string): 'pdf' | 'docx' | 'doc' | 'txt' | 'md' | 'image' | 'pptx' {
  const ext = (name.split('.').pop() || '').toLowerCase()
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  if (ext === 'doc') return 'doc'
  if (ext === 'md' || ext === 'markdown') return 'md'
  if (ext === 'pptx') return 'pptx'
  return 'txt'
}

function inferMimeType(name: string): string {
  const ext = (name.split('.').pop() || '').toLowerCase()
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (ext === 'doc') return 'application/msword'
  if (ext === 'pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  if (ext === 'md' || ext === 'markdown') return 'text/markdown'
  if (ext === 'txt') return 'text/plain'
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'svg') return 'image/svg+xml'
  if (ext === 'bmp') return 'image/bmp'
  return 'application/octet-stream'
}

function inferDocumentCategory(name: string): 'academic' | 'other' {
  const normalized = name.toLowerCase()
  return /论文|paper|study|research|实验|analysis/.test(normalized) ? 'academic' : 'other'
}

function mapFileToDocument(f: RawFile): RemoteDocumentMeta {
  const displayName = f.display_name || f.rel_path || f.file_id
  return {
    id: f.file_id,
    title: displayName,
    sourceType: inferSourceType(displayName),
    originalName: displayName,
    mimeType: inferMimeType(displayName),
    hash: '',
    importedAt: f.created_at || new Date().toISOString(),
    updatedAt: f.created_at || new Date().toISOString(),
    size: 0,
    storedRelativePath: '',
    extractedRelativePath: '',
    extractionStatus: f.status === 'ready' ? 'ready' : f.status === 'failed' ? 'failed' : 'pending',
    extractedTextLength: 0,
    previewText: '',
    versionCount: 1,
    templateUsageCount: 0,
    documentCategory: inferDocumentCategory(displayName),
  }
}

function mapSourceToHit(s: RawQaSource): RemoteRetrievalHit {
  return {
    documentId: s.file_id,
    documentTitle: s.display_name || s.file_id,
    chunkId: s.chunk_id || '',
    text: s.page_context || s.text,
    score: s.score,
    pageNo: s.page_no,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** List all knowledge bases (departments). */
export async function listKnowledgeBases(): Promise<RemoteDepartment[]> {
  const data = await apiGet<{ ok: boolean; knowledge_bases: RawKnowledgeBase[] }>('/knowledge-bases')
  return (data.knowledge_bases || []).map(mapKbToDepartment)
}

/** Get a single knowledge base metadata. */
export async function getKnowledgeBase(kbId: string): Promise<RemoteDepartment | null> {
  try {
    const data = await apiGet<{ ok: boolean; knowledge_base: RawKnowledgeBase }>(`/knowledge-bases/${encodeURIComponent(kbId)}`)
    return data.knowledge_base ? mapKbToDepartment(data.knowledge_base) : null
  } catch {
    return null
  }
}

export async function ensureKnowledgeBase(kbId: string, displayName: string, description = ''): Promise<RemoteDepartment> {
  const existing = await getKnowledgeBase(kbId)
  if (existing) return existing
  const data = await apiPost<{ ok: boolean; knowledge_base: RawKnowledgeBase }>('/knowledge-bases', {
    kb_id: kbId,
    display_name: displayName,
    description,
  })
  return mapKbToDepartment(data.knowledge_base)
}

/** List files inside a knowledge base. */
export async function listFiles(kbId: string): Promise<RemoteDocumentMeta[]> {
  const data = await apiGet<{ ok: boolean; files: RawFile[] }>(`/knowledge-bases/${encodeURIComponent(kbId)}/files`)
  return (data.files || []).map(mapFileToDocument)
}

/**
 * Vector search (no LLM generation).
 * `fileIds = null` → search entire KB.
 */
export async function qaSearch(
  kbId: string,
  query: string,
  fileIds: string[] | null = null,
  topK = 8,
): Promise<RemoteRetrievalHit[]> {
  const data = await apiPost<RawQaResponse>(
    '/qa',
    { query, file_ids: fileIds, top_k: topK, partition: kbId },
    { 'X-KB-Partition': kbId },
  )
  const sources = data.results || data.sources || []
  return sources.map(mapSourceToHit)
}

/**
 * Chat-style retrieval (retrieval + optional LLM answer).
 * `fileIds = null` → search entire KB.
 */
export async function chat(
  kbId: string,
  query: string,
  fileIds: string[] | null = null,
  topK = 8,
): Promise<{ answer: string | null; sources: RemoteRetrievalHit[] }> {
  const data = await apiPost<RawChatResponse>(
    `/knowledge-bases/${encodeURIComponent(kbId)}/chat`,
    { query, file_ids: fileIds, top_k: topK },
  )
  return {
    answer: data.answer ?? null,
    sources: (data.sources || []).map(mapSourceToHit),
  }
}

async function getRemoteFileText(kbId: string, fileId: string, titleHint?: string): Promise<string> {
  const candidateQueries = [
    titleHint,
    titleHint?.split(/[\\/]/).pop(),
    '全文内容',
    '文档内容',
  ]
    .map((item) => String(item || '').trim())
    .filter(Boolean)

  for (const query of candidateQueries) {
    try {
      const data = await apiPost<RawQaResponse>(
        '/qa',
        { query, file_ids: [fileId], top_k: 8, llm: false, partition: kbId },
        { 'X-KB-Partition': kbId },
      )
      const fullText = String(data.source_files?.[0]?.full_text || '').trim()
      if (fullText) return fullText

      const pageContextText = Array.from(
        new Set(
          (data.results || data.sources || [])
            .map((item) => String(item.page_context || item.text || '').trim())
            .filter(Boolean),
        ),
      ).join('\n\n')
      if (pageContextText) return pageContextText
    } catch {
      continue
    }
  }

  return ''
}

export async function getDocumentDetail(kbId: string, fileId: string): Promise<{
  meta: RemoteDocumentMeta
  extractedText: string
  originalExtractedText: string
  currentVersionId: string | null
  versions: Array<Record<string, unknown>>
  tasks: Array<Record<string, unknown>>
  chunkCount?: number
  parsedDocument: null
}> {
  const docs = await listFiles(kbId)
  const meta = docs.find((item) => item.id === fileId)
  if (!meta) {
    throw new Error(`Remote document not found: ${kbId}/${fileId}`)
  }

  const extractedText = await getRemoteFileText(kbId, fileId, meta.title || meta.originalName)
  const previewText = extractedText.slice(0, 280)

  return {
    meta: {
      ...meta,
      extractedTextLength: extractedText.length,
      previewText,
    },
    extractedText,
    originalExtractedText: extractedText,
    currentVersionId: null,
    versions: [],
    tasks: [],
    chunkCount: undefined,
    parsedDocument: null,
  }
}

/**
 * Upload files to a knowledge base via multipart form.
 * `filePaths` are absolute local paths – we read them and send as form uploads.
 */
export async function ingestFiles(
  kbId: string,
  filePaths: string[],
): Promise<{ imported: RemoteDocumentMeta[]; failed: string[] }> {
  const fsSync = await import('node:fs')
  const pathMod = await import('node:path')

  const form = new FormData()
  form.append('partition', kbId)

  for (const fp of filePaths) {
    const buf = fsSync.readFileSync(fp)
    const name = pathMod.basename(fp)
    form.append('files', new Blob([buf]), name)
  }

  const data = await apiPostForm<{ ok: boolean; results: RawIngestResult[]; errors: unknown[] }>(
    '/ingest',
    form as any,
    { 'X-KB-Partition': kbId },
  )

  const imported: RemoteDocumentMeta[] = (data.results || []).map((r) => {
    const originalName = String(r.file_id || '')
    return {
      id: r.file_id,
      title: originalName,
      sourceType: inferSourceType(originalName),
      originalName,
      mimeType: inferMimeType(originalName),
      hash: '',
      importedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      size: 0,
      storedRelativePath: '',
      extractedRelativePath: '',
      extractionStatus: r.status === 'ready' ? 'ready' : r.status === 'failed' ? 'failed' : 'pending',
      extractedTextLength: 0,
      previewText: '',
      versionCount: 1,
      templateUsageCount: 0,
      documentCategory: inferDocumentCategory(originalName),
    }
  })

  const failed = (data.errors || []).map((e: any) => String(e?.file || e))

  return { imported, failed }
}

// ---------------------------------------------------------------------------
// Query expansion via LLM + deduplication
// ---------------------------------------------------------------------------

import { completeText } from './llmClient'
import type { AppSettings } from './settingsStore'

const QUERY_EXPAND_SYSTEM_PROMPT =
  '你是检索关键词提取器。用户给你一段任务指令，你需要提取 2-4 条最适合用于向量检索的中文短语（每条 5-20 字），每条一行输出，不要编号，不要解释。'

/**
 * Use LLM to expand a raw user instruction into 2-4 concise search queries
 * optimised for vector retrieval. Falls back to the original instruction on error.
 */
export async function expandQueryWithLlm(
  settings: AppSettings,
  rawInstruction: string,
): Promise<string[]> {
  const trimmed = rawInstruction.trim()
  if (!trimmed) return [trimmed || '请根据当前资料生成新文稿']

  try {
    const response = await completeText(settings, {
      systemPrompt: QUERY_EXPAND_SYSTEM_PROMPT,
      userPrompt: trimmed,
      temperature: 0.2,
      maxTokens: 200,
    })
    const lines = response
      .split(/\r?\n/)
      .map((l) => l.replace(/^\d+[.、)\]]\s*/, '').trim())
      .filter((l) => l.length >= 2 && l.length <= 60)
      .slice(0, 4)
    return lines.length > 0 ? lines : [trimmed]
  } catch {
    return [trimmed]
  }
}

/**
 * Merge multiple retrieval hit arrays, keeping the highest-scoring hit
 * per (documentId + pageNo) combination, sorted by score descending.
 */
export function deduplicateHits(
  hits: RemoteRetrievalHit[],
  limit: number,
): RemoteRetrievalHit[] {
  const map = new Map<string, RemoteRetrievalHit>()
  for (const h of hits) {
    const key = `${h.documentId}:${h.pageNo ?? 'x'}`
    const existing = map.get(key)
    if (!existing || h.score > existing.score) {
      map.set(key, h)
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
