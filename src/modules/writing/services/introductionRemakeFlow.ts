type TopicCategory = 'Biological sciences' | 'Chemistry' | 'Earth & environmental sciences' | 'Health sciences' | 'Physical sciences' | ''

export interface IntroductionRemakeTopicMeta {
  openalexSearch: string
  persons: string[]
  paperPublicationYear: number
  category: TopicCategory
}

export interface IntroductionRemakePoolItem {
  pool_index: number
  title?: string
  authors?: string
  year?: string | number | null
  publication_year?: number | null
  doi?: string
  venue?: string
  abstract?: string
  citation?: string
  openalex_id?: string
  source_id?: string
  has_abstract?: boolean
}

export interface IntroductionRemakePoolMeta {
  topic_queries: string[]
  min_publication_year: number
  max_papers_for_llm: number
  raw_scanned: number
  allowlisted_hits: number
  quality_ratio_target: number
  quality_slot_target: number
  recent_slot_target: number
  per_topic_stats: Array<{
    topic: string
    raw_quality_arm: number
    raw_recent_arm: number
    merged_candidates: number
  }>
}

export interface IntroductionRemakeReferenceItem {
  reference_number: number
  pool_index: number
  citation?: string
  title?: string
  authors?: string
  year?: number | null
  doi?: string
  venue?: string
  openalex_id?: string
}

export interface IntroductionRemakeAuditItem {
  issue: string
  action: string
  detail: string
}

export interface IntroductionRemakeGenerationResult {
  remadeIntroduction: string
  sequentialIntroduction: string
  citationPoolOrder: number[]
  references: IntroductionRemakeReferenceItem[]
  continuityNotes: string
  originalReferenceAudit: IntroductionRemakeAuditItem[]
  provider: string
  model: string
}

export interface IntroductionRemakeFlowParams {
  sourceText: string
  sourceLabel?: string
  context?: string
  maxPapersForLlm?: number
  secondPassTopic?: string
}

export interface IntroductionRemakeFlowCallbacks {
  onStatus?: (message: string) => void
  onPreview?: (payload: { text: string }) => void
}

export interface IntroductionRemakeFlowResult {
  topicMeta: IntroductionRemakeTopicMeta
  pool: IntroductionRemakePoolItem[]
  poolMeta: IntroductionRemakePoolMeta | null
  allowedJournals: Array<Record<string, unknown>>
  result: IntroductionRemakeGenerationResult
}

type StreamEvent = {
  streamId?: string
  type?: string
  accumulated?: string
  result?: Record<string, unknown>
  error?: string
}

function abortError(): Error {
  return new Error('已停止')
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortError()
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : []
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeTopicMeta(value: unknown): IntroductionRemakeTopicMeta {
  const record = toRecord(value)
  return {
    openalexSearch: String(record.openalexSearch || '').trim(),
    persons: toStringArray(record.persons),
    paperPublicationYear: Math.max(1990, Math.min(2035, toNumber(record.paperPublicationYear, 2015))),
    category: String(record.category || '').trim() as TopicCategory,
  }
}

function normalizePoolItem(value: unknown): IntroductionRemakePoolItem | null {
  const record = toRecord(value)
  const poolIndex = toNumber(record.pool_index, NaN)
  if (!Number.isFinite(poolIndex) || poolIndex <= 0) return null
  return {
    pool_index: poolIndex,
    title: record.title ? String(record.title) : undefined,
    authors: record.authors ? String(record.authors) : undefined,
    year: record.year == null ? undefined : record.year as string | number | null,
    publication_year: record.publication_year == null ? undefined : toNumber(record.publication_year),
    doi: record.doi ? String(record.doi) : undefined,
    venue: record.venue ? String(record.venue) : undefined,
    abstract: record.abstract ? String(record.abstract) : undefined,
    citation: record.citation ? String(record.citation) : undefined,
    openalex_id: record.openalex_id ? String(record.openalex_id) : undefined,
    source_id: record.source_id ? String(record.source_id) : undefined,
    has_abstract: typeof record.has_abstract === 'boolean' ? record.has_abstract : undefined,
  }
}

function normalizePoolMeta(value: unknown): IntroductionRemakePoolMeta | null {
  const record = toRecord(value)
  if (!Object.keys(record).length) return null
  const perTopicStats = Array.isArray(record.per_topic_stats)
    ? record.per_topic_stats.map((item) => {
        const entry = toRecord(item)
        return {
          topic: String(entry.topic || '').trim(),
          raw_quality_arm: toNumber(entry.raw_quality_arm),
          raw_recent_arm: toNumber(entry.raw_recent_arm),
          merged_candidates: toNumber(entry.merged_candidates),
        }
      })
    : []
  return {
    topic_queries: toStringArray(record.topic_queries),
    min_publication_year: toNumber(record.min_publication_year, 2015),
    max_papers_for_llm: toNumber(record.max_papers_for_llm, 60),
    raw_scanned: toNumber(record.raw_scanned),
    allowlisted_hits: toNumber(record.allowlisted_hits),
    quality_ratio_target: toNumber(record.quality_ratio_target),
    quality_slot_target: toNumber(record.quality_slot_target),
    recent_slot_target: toNumber(record.recent_slot_target),
    per_topic_stats: perTopicStats,
  }
}

function normalizeReference(value: unknown): IntroductionRemakeReferenceItem | null {
  const record = toRecord(value)
  const referenceNumber = toNumber(record.reference_number, NaN)
  const poolIndex = toNumber(record.pool_index, NaN)
  if (!Number.isFinite(referenceNumber) || !Number.isFinite(poolIndex)) return null
  return {
    reference_number: referenceNumber,
    pool_index: poolIndex,
    citation: record.citation ? String(record.citation) : undefined,
    title: record.title ? String(record.title) : undefined,
    authors: record.authors ? String(record.authors) : undefined,
    year: record.year == null ? undefined : toNumber(record.year),
    doi: record.doi ? String(record.doi) : undefined,
    venue: record.venue ? String(record.venue) : undefined,
    openalex_id: record.openalex_id ? String(record.openalex_id) : undefined,
  }
}

function normalizeAuditItem(value: unknown): IntroductionRemakeAuditItem | null {
  const record = toRecord(value)
  const issue = String(record.issue || '').trim()
  const action = String(record.action || '').trim()
  const detail = String(record.detail || '').trim()
  if (!issue && !action && !detail) return null
  return {
    issue: issue || '未说明问题',
    action: action || 'kept',
    detail: detail || '未提供细节',
  }
}

function normalizeGenerationResult(value: unknown): IntroductionRemakeGenerationResult {
  const record = toRecord(value)
  return {
    remadeIntroduction: String(record.remadeIntroduction || '').trim(),
    sequentialIntroduction: String(record.sequentialIntroduction || '').trim(),
    citationPoolOrder: Array.isArray(record.citationPoolOrder)
      ? record.citationPoolOrder.map((item) => toNumber(item)).filter((item) => Number.isFinite(item) && item > 0)
      : [],
    references: Array.isArray(record.references)
      ? record.references.map(normalizeReference).filter((item): item is IntroductionRemakeReferenceItem => Boolean(item))
      : [],
    continuityNotes: String(record.continuityNotes || '').trim(),
    originalReferenceAudit: Array.isArray(record.originalReferenceAudit)
      ? record.originalReferenceAudit.map(normalizeAuditItem).filter((item): item is IntroductionRemakeAuditItem => Boolean(item))
      : [],
    provider: String(record.provider || '').trim(),
    model: String(record.model || '').trim(),
  }
}

async function streamDraft(
  params: IntroductionRemakeFlowParams,
  callbacks: IntroductionRemakeFlowCallbacks,
  pool: IntroductionRemakePoolItem[],
  signal?: AbortSignal,
): Promise<IntroductionRemakeGenerationResult> {
  return new Promise<IntroductionRemakeGenerationResult>((resolve, reject) => {
    let activeStreamId = ''
    let settled = false
    let abortRequested = Boolean(signal?.aborted)

    const cleanup = () => {
      signal?.removeEventListener('abort', handleAbort)
      unsubscribe?.()
    }

    const finishError = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }

    const finishSuccess = (result: IntroductionRemakeGenerationResult) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }

    const handleAbort = () => {
      abortRequested = true
      if (!activeStreamId) return
      void window.electronAPI.cancelGenerateIntroductionDraftStream(activeStreamId).catch(() => undefined)
      finishError(abortError())
    }

    const unsubscribe = window.electronAPI.onGenerateIntroductionDraftStreamEvent((payload) => {
      const event = payload as StreamEvent
      if (!event?.streamId || event.streamId !== activeStreamId) return

      if (event.type === 'start') {
        callbacks.onStatus?.('已连接真实 remake 流式通道，开始生成正文...')
        return
      }

      if (event.type === 'delta') {
        const previewText = String(event.accumulated || '')
        callbacks.onPreview?.({ text: previewText })
        callbacks.onStatus?.(`正在执行真实 remake：${previewText.length} 字`)
        return
      }

      if (event.type === 'complete' && event.result) {
        finishSuccess(normalizeGenerationResult(event.result))
        return
      }

      if (event.type === 'error') {
        finishError(new Error(String(event.error || '真实 remake 失败')))
      }
    })

    signal?.addEventListener('abort', handleAbort, { once: true })

    void window.electronAPI.startGenerateIntroductionDraftStream({
      originalIntroduction: params.sourceText,
      sourceLabel: params.sourceLabel,
      pool,
      context: params.context,
    }).then((response) => {
      activeStreamId = String(response.streamId || '')
      if (!activeStreamId) {
        finishError(new Error('真实 remake 流启动失败'))
        return
      }
      if (abortRequested) {
        void window.electronAPI.cancelGenerateIntroductionDraftStream(activeStreamId).catch(() => undefined)
        finishError(abortError())
      }
    }).catch((error) => {
      finishError(error instanceof Error ? error : new Error(String(error)))
    })
  })
}

export async function runIntroductionRemakeFlow(
  params: IntroductionRemakeFlowParams,
  callbacks: IntroductionRemakeFlowCallbacks = {},
  signal?: AbortSignal,
): Promise<IntroductionRemakeFlowResult> {
  const sourceText = String(params.sourceText || '').trim()
  if (sourceText.length < 40) {
    throw new Error('原文内容过短，无法执行真实 remake。')
  }

  callbacks.onStatus?.('正在根据原文推断检索主题与年份...')
  const inferredRaw = await window.electronAPI.inferIntroductionTopicMeta(sourceText)
  throwIfAborted(signal)
  const topicMeta = normalizeTopicMeta(inferredRaw)
  if (!topicMeta.openalexSearch) {
    throw new Error('未能根据当前原文推断出有效检索主题。')
  }

  callbacks.onStatus?.('正在构建顶刊白名单文献池...')
  const poolResponseRaw = await window.electronAPI.buildIntroductionAllowlistedPool({
    topic: topicMeta.openalexSearch,
    minPublicationYear: topicMeta.paperPublicationYear || 2015,
    maxPapersForLlm: Math.max(1, Math.min(200, Number(params.maxPapersForLlm) || 60)),
    secondPassTopic: String(params.secondPassTopic || '').trim() || undefined,
  })
  throwIfAborted(signal)

  const poolResponse = toRecord(poolResponseRaw)
  const pool = Array.isArray(poolResponse.pool)
    ? poolResponse.pool.map(normalizePoolItem).filter((item): item is IntroductionRemakePoolItem => Boolean(item))
    : []
  if (!pool.length) {
    throw new Error('未能构建出可用的顶刊白名单文献池。')
  }

  const result = await streamDraft(params, callbacks, pool, signal)
  throwIfAborted(signal)

  return {
    topicMeta,
    pool,
    poolMeta: normalizePoolMeta(poolResponse.meta),
    allowedJournals: Array.isArray(poolResponse.allowedJournals)
      ? poolResponse.allowedJournals.map((item) => toRecord(item))
      : [],
    result,
  }
}