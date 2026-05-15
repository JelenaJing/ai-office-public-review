import type { ReferenceItem } from './openAlexClient'

const CROSSREF_TIMEOUT_MS = 12000
const CROSSREF_MAX_RETRIES = 3
const CROSSREF_MAILTO = 'ai-office@research.local'

function extractFetchReason(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error ?? 'Unknown error')
}

function isRetryableNetworkError(error: unknown): boolean {
  const message = extractFetchReason(error).toLowerCase()
  return message.includes('timeout') || message.includes('timed out') || message.includes('econnreset') || message.includes('socket hang up')
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function decodeHtmlEntities(text: string): string {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, '')
    .trim()
}

function extractDoi(item: Record<string, any>): string {
  const doi = String(item.DOI || '').trim()
  return doi || ''
}

function extractAuthors(item: Record<string, any>): string[] {
  const authors = item.author
  if (!Array.isArray(authors)) return []
  return authors
    .map((author: Record<string, any>) => {
      const given = String(author.given || '').trim()
      const family = String(author.family || '').trim()
      if (given && family) return `${given} ${family}`
      if (family) return family
      return given || ''
    })
    .filter(Boolean)
}

function extractYear(item: Record<string, any>): number | null {
  const published = item.published || item['published-print'] || item['published-online']
  if (published?.['date-parts']?.[0]?.[0]) {
    const year = Number(published['date-parts'][0][0])
    return Number.isFinite(year) ? year : null
  }
  return null
}

function extractAbstract(item: Record<string, any>): string {
  const abstract = String(item.abstract || '').trim()
  return decodeHtmlEntities(abstract)
}

function extractTitle(item: Record<string, any>): string {
  if (Array.isArray(item.title) && item.title.length > 0) {
    return decodeHtmlEntities(String(item.title[0] || ''))
  }
  return decodeHtmlEntities(String(item.title || ''))
}

function extractJournal(item: Record<string, any>): string {
  if (Array.isArray(item['container-title']) && item['container-title'].length > 0) {
    return decodeHtmlEntities(String(item['container-title'][0] || ''))
  }
  return decodeHtmlEntities(String(item['container-title'] || ''))
}

function extractUrl(item: Record<string, any>): string {
  const url = String(item.URL || '').trim()
  if (url) return url
  const doi = extractDoi(item)
  return doi ? `https://doi.org/${doi}` : ''
}

function mapCrossrefResult(item: Record<string, any>): ReferenceItem {
  const doi = extractDoi(item)
  return {
    id: doi ? `https://doi.org/${doi}` : '',
    title: extractTitle(item) || 'Untitled',
    year: extractYear(item),
    journal: extractJournal(item),
    doi,
    authors: extractAuthors(item),
    abstract: extractAbstract(item),
    url: extractUrl(item),
  }
}

async function fetchCrossref(url: URL): Promise<Response> {
  let lastError: unknown
  for (let attempt = 1; attempt <= CROSSREF_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error(`Connect Timeout Error (${CROSSREF_TIMEOUT_MS}ms)`)), CROSSREF_TIMEOUT_MS)
    try {
      return await fetch(url, {
        headers: {
          'user-agent': `AI-Office-3.0/1.0 (mailto:${CROSSREF_MAILTO})`,
        },
        signal: controller.signal,
      })
    } catch (error) {
      lastError = error
      if (attempt >= CROSSREF_MAX_RETRIES || !isRetryableNetworkError(error)) {
        break
      }
      await sleep(600 * attempt)
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(`Crossref 网络请求失败: ${extractFetchReason(lastError)}`)
}

export async function searchCrossrefByTopic(topic: string, maxResults = 12): Promise<ReferenceItem[]> {
  const trimmedTopic = String(topic || '').trim()
  if (!trimmedTopic) return []

  const rows = Math.min(maxResults, 50)
  const url = new URL('https://api.crossref.org/works')
  url.searchParams.set('query', trimmedTopic)
  url.searchParams.set('rows', String(rows))
  url.searchParams.set('sort', 'relevance')
  url.searchParams.set('filter', 'type:journal-article')
  url.searchParams.set('select', 'DOI,title,author,published,container-title,URL,abstract')
  url.searchParams.set('mailto', CROSSREF_MAILTO)

  const response = await fetchCrossref(url)
  if (!response.ok) {
    throw new Error(`Crossref 请求失败: ${response.status}`)
  }

  const data = (await response.json()) as Record<string, any>
  const items = data?.message?.items
  if (!Array.isArray(items)) return []

  const seen = new Set<string>()
  const results: ReferenceItem[] = []

  for (const item of items) {
    const mapped = mapCrossrefResult(item)
    const key = mapped.doi || mapped.title.toLowerCase().replace(/\s+/g, ' ')
    if (seen.has(key)) continue
    seen.add(key)
    results.push(mapped)
    if (results.length >= maxResults) break
  }

  return results
}
