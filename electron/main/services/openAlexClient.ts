import fs from 'node:fs/promises'
import path from 'node:path'
import { completeText } from './llmClient'
import type { AppSettings } from './settingsStore'

export interface ReferenceItem {
  id: string
  title: string
  year: number | null
  journal: string
  doi: string
  authors: string[]
  abstract: string
  url: string
}

const OPENALEX_TIMEOUT_MS = 12000
const OPENALEX_MAX_RETRIES = 3
const OPENALEX_MAX_PAGES_PER_ROUTE = 10
const NFTCORE_VALID_CATEGORIES = [
  'Biological sciences',
  'Chemistry',
  'Earth & environmental sciences',
  'Health sciences',
  'Physical sciences',
] as const

type JournalCategory = typeof NFTCORE_VALID_CATEGORIES[number]

interface JournalCategoryItem {
  id?: string
  categories?: string[]
}

interface SearchTopicMeta {
  searchTopic: string
  persons: string[]
  category: JournalCategory | null
}

interface SearchRouteParams {
  topic: string
  yearFrom?: string
  yearTo?: string
  maxResults: number
  sortBy?: 'relevance' | 'cited_by_count:desc' | 'publication_date:desc'
  journalIds?: string[]
  persons?: string[]
}

let journalCategoryCachePromise: Promise<Record<string, JournalCategoryItem>> | null = null

function extractFetchReason(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause
    if (cause instanceof Error && cause.message) {
      return cause.message
    }
    return error.message
  }
  return String(error)
}

function escapeHtml(input: string): string {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function decodeHtmlEntities(input: string): string {
  return String(input || '')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
}

function sanitizeReferenceRichText(input: string): string {
  const decoded = decodeHtmlEntities(input)
  const preservedTags: string[] = []
  const withPlaceholders = decoded.replace(/<\/?(?:sub|sup|i|b|em|strong)>/gi, (tag) => {
    const normalized = tag.toLowerCase()
    preservedTags.push(normalized)
    return `__REF_HTML_TAG_${preservedTags.length - 1}__`
  })

  const escaped = escapeHtml(withPlaceholders)
  return preservedTags.reduce((result, tag, index) => result.replace(`__REF_HTML_TAG_${index}__`, tag), escaped)
}

function stripReferenceMarkup(input: string): string {
  return decodeHtmlEntities(String(input || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function reconstructAbstract(index?: Record<string, number[]>): string {
  if (!index) return ''
  const words: string[] = []
  for (const [token, positions] of Object.entries(index)) {
    for (const position of positions) {
      words[position] = token
    }
  }
  return words.filter(Boolean).join(' ')
}

function buildFilters(yearFrom?: string, yearTo?: string): string {
  const filters: string[] = []
  if (yearFrom) filters.push(`from_publication_date:${yearFrom}-01-01`)
  if (yearTo) filters.push(`to_publication_date:${yearTo}-12-31`)
  return filters.join(',')
}

function buildRouteFilters(yearFrom?: string, yearTo?: string, journalIds?: string[]): string {
  const filters: string[] = []
  const dateFilter = buildFilters(yearFrom, yearTo)
  if (dateFilter) filters.push(dateFilter)
  if (Array.isArray(journalIds) && journalIds.length > 0) {
    filters.push(`primary_location.source.id:${journalIds.join('|')}`)
  }
  return filters.join(',')
}

function parseJsonObject(raw: string): Record<string, any> | null {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return null
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = codeBlockMatch ? codeBlockMatch[1].trim() : trimmed
  const objectMatch = candidate.match(/\{[\s\S]*\}/)
  const objectText = objectMatch ? objectMatch[0] : candidate
  try {
    return JSON.parse(objectText) as Record<string, any>
  } catch {
    return null
  }
}

function isValidJournalCategory(value: string): value is JournalCategory {
  return NFTCORE_VALID_CATEGORIES.includes(value as JournalCategory)
}

function makeReferenceKey(reference: ReferenceItem): string {
  return `${String(reference.doi || '').trim().toLowerCase()}|${String(reference.title || '').trim().toLowerCase()}`
}

function mergeUniqueReferences(...groups: ReferenceItem[][]): ReferenceItem[] {
  const seen = new Set<string>()
  const merged: ReferenceItem[] = []
  for (const group of groups) {
    for (const item of group) {
      const key = makeReferenceKey(item)
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(item)
    }
  }
  return merged
}

function isReferenceStructurallyValid(reference: ReferenceItem): boolean {
  return Boolean(
    String(reference.title || '').trim()
    && String(reference.journal || '').trim()
    && Array.isArray(reference.authors)
    && reference.authors.some((author) => String(author || '').trim())
    && Number.isFinite(reference.year ?? NaN),
  )
}

async function loadBundledJournalCategories(): Promise<Record<string, JournalCategoryItem>> {
  if (!journalCategoryCachePromise) {
    journalCategoryCachePromise = (async () => {
      const candidatePaths = [
        path.join(process.resourcesPath || '', 'data', 'journals_with_categories.json'),
        path.join(process.cwd(), 'electron', 'main', 'data', 'journals_with_categories.json'),
        path.join(__dirname, '..', '..', '..', 'electron', 'main', 'data', 'journals_with_categories.json'),
        path.join(__dirname, '..', 'data', 'journals_with_categories.json'),
      ].filter(Boolean)

      for (const filePath of candidatePaths) {
        try {
          const raw = await fs.readFile(filePath, 'utf-8')
          return JSON.parse(raw) as Record<string, JournalCategoryItem>
        } catch {
          continue
        }
      }

      return {}
    })()
  }

  return journalCategoryCachePromise
}

function resolveJournalIdsForCategory(journals: Record<string, JournalCategoryItem>, category: JournalCategory | null): string[] {
  if (!category) return []
  const journalIds: string[] = []
  for (const info of Object.values(journals)) {
    const categories = Array.isArray(info?.categories) ? info.categories : []
    if (!categories.includes(category)) continue
    const rawId = String(info?.id || '').trim()
    if (!rawId) continue
    journalIds.push(rawId.replace('https://openalex.org/', ''))
  }
  return journalIds
}

export async function extractSearchTopicMeta(settings: AppSettings, topic: string): Promise<SearchTopicMeta> {
  const trimmedTopic = String(topic || '').trim()
  if (!trimmedTopic || !String(settings.llm.apiKey || '').trim()) {
    return { searchTopic: trimmedTopic, persons: [], category: null }
  }

  try {
    const response = await completeText(settings, {
      systemPrompt: 'You analyze academic topics for OpenAlex retrieval. Output valid JSON only.',
      userPrompt: `给定一个学术主题，请提取：\n1. 适合 OpenAlex 检索的英文核心主题词（1-6个英文单词）\n2. 相关人物姓名列表（如果没有则为空数组）\n3. 最主要的学科分类，必须且只能从以下 5 个值中选择一个：${NFTCORE_VALID_CATEGORIES.join(' / ')}\n\n请严格输出 JSON：\n{\n  "topic": "english search topic",\n  "persons": ["Person Name"],\n  "category": "Chemistry"\n}\n\n如果无法稳定判断学科，就将 category 设为空字符串。\n主题：${trimmedTopic}`,
      temperature: 0.1,
      maxTokens: 220,
    })

    const parsed = parseJsonObject(response)
    const searchTopic = String(parsed?.topic || '').trim() || trimmedTopic
    const persons = Array.isArray(parsed?.persons)
      ? parsed.persons.map((item) => String(item || '').trim()).filter(Boolean)
      : []
    const categoryRaw = String(parsed?.category || '').trim()
    const category = isValidJournalCategory(categoryRaw) ? categoryRaw : null
    return { searchTopic, persons, category }
  } catch {
    return { searchTopic: trimmedTopic, persons: [], category: null }
  }
}

function isRetryableNetworkError(error: unknown): boolean {
  const message = extractFetchReason(error).toLowerCase()
  return message.includes('timeout') || message.includes('timed out') || message.includes('econnreset') || message.includes('socket hang up')
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchOpenAlex(url: URL): Promise<Response> {
  let lastError: unknown
  for (let attempt = 1; attempt <= OPENALEX_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error(`Connect Timeout Error (${OPENALEX_TIMEOUT_MS}ms)`)), OPENALEX_TIMEOUT_MS)
    try {
      return await fetch(url, {
        headers: {
          'user-agent': 'AI-Office-3.0/1.0',
        },
        signal: controller.signal,
      })
    } catch (error) {
      lastError = error
      if (attempt >= OPENALEX_MAX_RETRIES || !isRetryableNetworkError(error)) {
        break
      }
      await sleep(600 * attempt)
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(`OpenAlex 网络请求失败: ${url.origin}，${extractFetchReason(lastError)}`)
}

function mapOpenAlexResult(item: Record<string, any>): ReferenceItem {
  return {
    id: item.id ?? '',
    title: decodeHtmlEntities(item.title ?? 'Untitled'),
    year: item.publication_year ?? null,
    journal: decodeHtmlEntities(item.primary_location?.source?.display_name ?? ''),
    doi: item.doi ?? '',
    authors: (item.authorships ?? []).map((author: Record<string, any>) => decodeHtmlEntities(author.author?.display_name ?? '')),
    abstract: decodeHtmlEntities(reconstructAbstract(item.abstract_inverted_index)),
    url: item.primary_location?.landing_page_url ?? item.id ?? '',
  }
}

async function searchReferencesByRoute(params: SearchRouteParams): Promise<ReferenceItem[]> {
  const requestedTotal = Math.max(1, Math.min(1000, Math.round(params.maxResults || 8)))
  const perPage = Math.min(200, requestedTotal)
  const filter = buildRouteFilters(params.yearFrom, params.yearTo, params.journalIds)
  const collected: ReferenceItem[] = []
  const seen = new Set<string>()

  for (let page = 1; collected.length < requestedTotal && page <= OPENALEX_MAX_PAGES_PER_ROUTE; page += 1) {
    const url = new URL('https://api.openalex.org/works')
    const combinedTopic = [String(params.topic || '').trim(), ...(params.persons || []).map((item) => String(item || '').trim())]
      .filter(Boolean)
      .join(' ')
      .trim()

    url.searchParams.set('search', combinedTopic || String(params.topic || '').trim())
    url.searchParams.set('page', String(page))
    url.searchParams.set('per-page', String(Math.min(perPage, requestedTotal - collected.length)))

    if (params.sortBy && params.sortBy !== 'relevance') {
      url.searchParams.set('sort', params.sortBy)
    }
    if (filter) {
      url.searchParams.set('filter', filter)
    }

    const response = await fetchOpenAlex(url)
    if (!response.ok) {
      throw new Error(`OpenAlex 请求失败: ${response.status} ${await response.text()}`)
    }

    const data = (await response.json()) as Record<string, any>
    const results = Array.isArray(data.results) ? data.results : []
    if (results.length === 0) break

    for (const item of results) {
      const mapped = mapOpenAlexResult(item)
      const key = makeReferenceKey(mapped)
      if (seen.has(key)) continue
      seen.add(key)
      collected.push(mapped)
      if (collected.length >= requestedTotal) break
    }

    if (results.length < perPage) break
  }

  return collected
}

export async function loadJournalCategories(dataDir: string): Promise<Record<string, unknown>> {
  const filePath = path.join(dataDir, 'journals_with_categories.json')
  const raw = await fs.readFile(filePath, 'utf-8')
  return JSON.parse(raw) as Record<string, unknown>
}

export async function searchReferences(params: {
  topic: string
  yearFrom?: string
  yearTo?: string
  maxResults?: number
}): Promise<ReferenceItem[]> {
  return searchReferencesByRoute({
    topic: params.topic,
    yearFrom: params.yearFrom,
    yearTo: params.yearTo,
    maxResults: params.maxResults ?? 8,
    sortBy: 'relevance',
  })
}

export async function searchReferencesWithNftcoreStrategy(
  settings: AppSettings,
  params: {
    topic: string
    yearFrom?: string
    yearTo?: string
    maxResults?: number
  },
): Promise<ReferenceItem[]> {
  const requestedTotal = Math.max(1, Math.min(1000, Math.round(params.maxResults ?? 8)))

  try {
    const meta = await extractSearchTopicMeta(settings, params.topic)
    const journals = await loadBundledJournalCategories()
    const journalIds = resolveJournalIdsForCategory(journals, meta.category)

    const qualityPapers = await searchReferencesByRoute({
      topic: meta.searchTopic || params.topic,
      persons: meta.persons,
      yearFrom: params.yearFrom,
      yearTo: params.yearTo,
      maxResults: requestedTotal,
      sortBy: 'cited_by_count:desc',
      journalIds,
    })

    const recentPapers = await searchReferencesByRoute({
      topic: meta.searchTopic || params.topic,
      persons: meta.persons,
      yearFrom: params.yearFrom,
      yearTo: params.yearTo,
      maxResults: requestedTotal,
      sortBy: 'publication_date:desc',
      journalIds,
    })

    const structuredMerged = mergeUniqueReferences(
      qualityPapers.filter(isReferenceStructurallyValid),
      recentPapers.filter(isReferenceStructurallyValid),
    )

    if (structuredMerged.length >= requestedTotal) {
      return structuredMerged.slice(0, requestedTotal)
    }

    const fallbackOriginal = await searchReferences({
      topic: params.topic,
      yearFrom: params.yearFrom,
      yearTo: params.yearTo,
      maxResults: requestedTotal,
    })

    const fallbackSearchTopic = meta.searchTopic && meta.searchTopic.trim().toLowerCase() !== String(params.topic || '').trim().toLowerCase()
      ? await searchReferences({
        topic: meta.searchTopic,
        yearFrom: params.yearFrom,
        yearTo: params.yearTo,
        maxResults: requestedTotal,
      })
      : []

    return mergeUniqueReferences(structuredMerged, fallbackSearchTopic, fallbackOriginal).slice(0, requestedTotal)
  } catch {
    return searchReferences(params)
  }
}

export function formatReferenceList(references: ReferenceItem[]): string {
  return references
    .map((item, index) => {
      const authors = stripReferenceMarkup(item.authors.slice(0, 4).join(', ') || 'Unknown Authors')
      const year = String(item.year ?? 'n.d.')
      const title = stripReferenceMarkup(item.title)
      const journal = item.journal ? ` ${stripReferenceMarkup(item.journal)}.` : ''
      const doi = item.doi ? ` DOI: ${stripReferenceMarkup(item.doi)}` : ''
      return `[${index + 1}] ${authors} (${year}). ${title}.${journal}${doi}`.replace(/\s+/g, ' ').trim()
    })
    .join('\n\n')
}