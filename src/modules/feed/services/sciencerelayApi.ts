/**
 * ScienceRelay 远程 API（见 temp/sciencerelay-remote-api.md）
 */

const DEFAULT_API_BASE = 'http://10.26.1.25:19080/api/sciencerelay'

export function getSciencerelayApiBase(): string {
  const fromEnv = String(
    (import.meta as ImportMeta & { env?: { VITE_SCIENCERELAY_API_BASE?: string } }).env?.VITE_SCIENCERELAY_API_BASE
      || '',
  ).trim().replace(/\/$/, '')
  return fromEnv || DEFAULT_API_BASE
}

export interface SciencerelayTopicItem {
  key: string
  label: string
  count?: number
}

export interface SciencerelayListItem {
  id: string
  title?: string
  commentaryTitle?: string
  oneLineSummary?: string
  articleType?: string
  journal?: string
  publishedDate?: string
  doi?: string
  topic?: string
  topicI18n?: Partial<Record<string, string>>
  subjects?: string[]
  subjectsI18n?: Partial<Record<string, string[]>>
  sourceUrl?: string
  citation?: string
  coverImages?: Array<{ imageUrl?: string; caption?: string }>
}

export interface SciencerelayListResponse {
  ok?: boolean
  total?: number
  offset?: number
  limit?: number
  hasMore?: boolean
  items?: SciencerelayListItem[]
}

export type SciencerelayEdition = 'middle' | 'primary' | 'university' | 'research'

export interface SciencerelayDetailPayload {
  meta?: SciencerelayListItem & Record<string, unknown>
  commentary?: {
    title?: unknown
    oneLineSummary?: string
    markdown?: Partial<Record<SciencerelayEdition, string>>
    middleQuestion?: string
    primaryQuestion?: string
    universityQuestion?: string
    researchQuestion?: string
  }
  source?: { url?: string; abstractHtml?: string; fullTextHtml?: string }
  figures?: unknown[]
  journalMeta?: unknown
  raw?: unknown
}

export interface SciencerelayDetailResponse {
  ok?: boolean
  item?: SciencerelayDetailPayload
}

function buildUrl(subPath: string, params: Record<string, string | undefined>): string {
  const base = getSciencerelayApiBase().replace(/\/$/, '')
  const path = subPath.startsWith('/') ? subPath.slice(1) : subPath
  const u = new URL(`${base}/${path}`)
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '') u.searchParams.set(k, v)
  })
  return u.toString()
}

export async function fetchSciencerelayTopics(lang = 'zh'): Promise<SciencerelayTopicItem[]> {
  const res = await fetch(buildUrl('topics', { lang }))
  if (!res.ok) throw new Error(`topics ${res.status}`)
  const data = (await res.json()) as { ok?: boolean; items?: SciencerelayTopicItem[] }
  if (data?.ok === false) throw new Error('topics 响应异常')
  return Array.isArray(data.items) ? data.items : []
}

export async function fetchSciencerelayArticles(options: {
  offset?: number
  limit?: number
  lang?: string
  topic?: string
  edition?: SciencerelayEdition
}): Promise<SciencerelayListResponse> {
  const {
    offset = 0,
    limit = 20,
    lang = 'zh',
    topic,
    edition = 'middle',
  } = options
  const res = await fetch(buildUrl('articles', {
    lang,
    offset: String(offset),
    limit: String(Math.min(limit, 200)),
    edition,
    topic: topic || undefined,
  }))
  if (!res.ok) throw new Error(`articles ${res.status}`)
  return (await res.json()) as SciencerelayListResponse
}

export async function fetchSciencerelayArticleDetail(
  id: string,
  options: { lang?: string; edition?: SciencerelayEdition } = {},
): Promise<SciencerelayDetailResponse> {
  const { lang = 'zh', edition = 'middle' } = options
  const sub = `articles/${encodeURIComponent(id)}`
  const res = await fetch(buildUrl(sub, { lang, edition }))
  if (!res.ok) throw new Error(`article ${res.status}`)
  return (await res.json()) as SciencerelayDetailResponse
}

/** 列表卡片主标题：优先中文解读标题 */
export function pickListTitle(item: SciencerelayListItem): string {
  const c = String(item.commentaryTitle || '').trim()
  if (c) return c
  return String(item.title || item.id || '').trim() || '未命名'
}

/** 列表副文：一行摘要 */
export function pickListSummary(item: SciencerelayListItem): string {
  return String(item.oneLineSummary || '').trim()
}

/** 主题展示：优先 zh */
export function pickTopicLabel(item: SciencerelayListItem): string {
  const zh = item.topicI18n?.zh
  if (zh && String(zh).trim()) return String(zh).trim()
  return String(item.topic || '').trim() || '综合'
}

export function pickCoverUrl(item: SciencerelayListItem): string | null {
  const url = item.coverImages?.[0]?.imageUrl
  return url && String(url).trim() ? String(url).trim() : null
}

/** 封面图注（多为中文解读），与标题一起作为列表/详情的可读说明 */
export function pickCoverCaption(item: SciencerelayListItem): string {
  const c = item.coverImages?.[0]?.caption
  return c && String(c).trim() ? String(c).trim() : ''
}

const EDITION_LABELS: Record<SciencerelayEdition, string> = {
  primary: '小学',
  middle: '中学',
  university: '大学',
  research: '研究',
}

export function editionLabel(ed: SciencerelayEdition): string {
  return EDITION_LABELS[ed] || ed
}

export function markdownForEdition(
  commentary: SciencerelayDetailPayload['commentary'],
  edition: SciencerelayEdition,
): string {
  const md = commentary?.markdown
  if (!md) return ''
  const raw = md[edition]
  return String(raw || '').trim()
}
