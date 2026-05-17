/**
 * 混合文献检索测试脚本（独立运行，不影响主链路）
 *
 * 测试流程：
 *   1. 用 LLM 从用户主题中提取 OpenAlex 检索词 + KB 短关键词
 *   2. 并行调用：KB /qa  +  OpenAlex
 *   3. KB 命中项用 Crossref 按标题补全 DOI/作者/年份
 *   4. 合并去重，打印最终文献列表
 *
 * 运行：
 *   npm run test:hybrid-references
 *
 * 可选环境变量：
 *   TOPIC          研究主题（默认：锂离子电池电极材料）
 *   YEAR_FROM      起始年份（默认：2018）
 *   YEAR_TO        结束年份（默认：2024）
 *   MAX_RESULTS    每路最多返回条数（默认：8）
 *   KB_BASE_URL    知识库地址（默认：http://10.26.1.25:8010）
 *   KB_PARTITION   知识库分区（默认：paper_kb）
 *   LLM_API_KEY    LLM API Key（也可直接写在代码里用于测试）
 *   LLM_BASE_URL   LLM Base URL（默认：https://api.openai.com/v1）
 *   LLM_MODEL      模型名（默认：gpt-4o-mini）
 *   SKIP_LLM       =1 时跳过 LLM 预处理，直接用原始 TOPIC 作为检索词
 */

// ─── 配置 ─────────────────────────────────────────────────────────────────────

const TOPIC = process.env.TOPIC || '锂离子电池电极材料'
const YEAR_FROM = process.env.YEAR_FROM || '2018'
const YEAR_TO = process.env.YEAR_TO || '2024'
const MAX_RESULTS = parseInt(process.env.MAX_RESULTS || '8', 10)
const KB_BASE_URL = process.env.KB_BASE_URL || 'http://10.26.1.25:8010'
const KB_PARTITION = process.env.KB_PARTITION || 'paper_kb'
const LLM_API_KEY = process.env.LLM_API_KEY || ''
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'https://api.openai.com/v1'
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini'
const SKIP_LLM = process.env.SKIP_LLM === '1'

const CROSSREF_MAILTO = 'ai-office@research.local'
const TIMEOUT_MS = 12000

// ─── 类型 ─────────────────────────────────────────────────────────────────────

interface RefItem {
  id: string
  title: string
  year: number | null
  journal: string
  doi: string
  authors: string[]
  abstract: string
  url: string
  source: 'kb' | 'openalex' | 'crossref'
  doiResolved?: boolean  // KB 命中后通过 Crossref 补全的
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function truncate(text: string, max = 120): string {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  return s.length <= max ? s : `${s.slice(0, max)}…`
}

function log(symbol: string, label: string, value = ''): void {
  console.log(`  ${symbol}  ${label}${value ? `：${value}` : ''}`)
}

function section(title: string): void {
  console.log(`\n${'─'.repeat(65)}`)
  console.log(`  ${title}`)
  console.log('─'.repeat(65))
}

function decodeHtml(s: string): string {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function normalizeTitle(t: string): string {
  return decodeHtml(t).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
}

/** 简单标题相似度（词重叠比例） */
function titleSimilarity(a: string, b: string): number {
  const wa = new Set(normalizeTitle(a).split(' ').filter(w => w.length > 3))
  const wb = new Set(normalizeTitle(b).split(' ').filter(w => w.length > 3))
  if (wa.size === 0 || wb.size === 0) return 0
  let overlap = 0
  for (const w of wa) if (wb.has(w)) overlap++
  return overlap / Math.max(wa.size, wb.size)
}

async function fetchWithTimeout(url: string | URL, opts: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

// ─── 步骤 1：LLM 关键词预处理 ─────────────────────────────────────────────────

interface TopicMeta {
  openalexTopic: string   // 给 OpenAlex 的检索词（1-6 个英文词）
  kbKeywords: string[]    // 给 KB 的短关键词列表（每个 1-2 词，分开检索）
  category: string        // 学科分类（OpenAlex 五分类之一或空）
}

async function extractTopicMeta(topic: string): Promise<TopicMeta> {
  const fallback: TopicMeta = {
    openalexTopic: topic,
    kbKeywords: [topic],
    category: '',
  }

  if (SKIP_LLM || !LLM_API_KEY) {
    log('⚠️', 'SKIP_LLM=1 或无 LLM_API_KEY，跳过预处理，使用原始主题作为检索词')
    return fallback
  }

  const systemPrompt = 'You are an academic retrieval assistant. Output valid JSON only.'
  const userPrompt = `分析以下学术研究主题，输出 JSON：
{
  "openalex_topic": "1-6个英文词，适合 OpenAlex 语义检索",
  "kb_keywords": ["词1", "词2", "词3"],  // 2-4 个独立的短英文词（每个1-2词），适合 MySQL 全文匹配，应出现在论文标题/摘要中
  "category": "从以下选一个或留空：Biological sciences / Chemistry / Earth & environmental sciences / Health sciences / Physical sciences"
}

主题：${topic}`

  try {
    const res = await fetchWithTimeout(`${LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 250,
      }),
    })

    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`)
    const data = await res.json() as Record<string, any>
    const raw = String(data?.choices?.[0]?.message?.content || '').trim()

    // 提取 JSON
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('LLM 返回中未找到 JSON')
    const parsed = JSON.parse(match[0]) as Record<string, any>

    return {
      openalexTopic: String(parsed.openalex_topic || topic).trim() || topic,
      kbKeywords: Array.isArray(parsed.kb_keywords)
        ? parsed.kb_keywords.map((k: unknown) => String(k).trim()).filter(Boolean).slice(0, 4)
        : [topic],
      category: String(parsed.category || '').trim(),
    }
  } catch (e) {
    log('⚠️', `LLM 预处理失败（${String(e)}），使用原始主题`)
    return fallback
  }
}

// ─── 步骤 2a：KB 检索 ──────────────────────────────────────────────────────────

interface KbHit {
  title: string
  abstract: string
  score: number
}

async function searchKb(keywords: string[]): Promise<KbHit[]> {
  const allHits: KbHit[] = []
  const seenTitles = new Set<string>()

  for (const kw of keywords) {
    try {
      const res = await fetchWithTimeout(`${KB_BASE_URL}/qa`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-KB-Partition': KB_PARTITION,
        },
        body: JSON.stringify({
          query: kw,
          top_k: MAX_RESULTS,
          partition: KB_PARTITION,
          llm: false,
        }),
      })
      if (!res.ok) continue
      const data = await res.json() as Record<string, any>
      const results = Array.isArray(data.results) ? data.results : []
      for (const r of results) {
        const title = decodeHtml(String(r.display_name || r.text || ''))
        const norm = normalizeTitle(title)
        if (!norm || seenTitles.has(norm)) continue
        seenTitles.add(norm)
        allHits.push({
          title,
          abstract: decodeHtml(String(r.page_context || r.text || '')),
          score: Number(r.score) || 0,
        })
      }
    } catch {
      // 单个关键词失败不影响其他词
    }
  }

  return allHits.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS * 2)
}

// ─── 步骤 2b：OpenAlex 检索 ───────────────────────────────────────────────────

function reconstructAbstract(index?: Record<string, number[]>): string {
  if (!index) return ''
  const words: string[] = []
  for (const [token, positions] of Object.entries(index)) {
    for (const pos of positions) words[pos] = token
  }
  return words.filter(Boolean).join(' ')
}

async function searchOpenAlex(topic: string): Promise<RefItem[]> {
  const url = new URL('https://api.openalex.org/works')
  url.searchParams.set('search', topic)
  url.searchParams.set('per-page', String(MAX_RESULTS))
  url.searchParams.set('filter', [
    `from_publication_date:${YEAR_FROM}-01-01`,
    `to_publication_date:${YEAR_TO}-12-31`,
  ].join(','))
  url.searchParams.set('sort', 'cited_by_count:desc')

  try {
    const res = await fetchWithTimeout(url.toString(), {
      headers: { 'user-agent': 'AI-Office-Test/1.0' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as Record<string, any>
    return (data.results || []).map((item: Record<string, any>): RefItem => ({
      id: item.id ?? '',
      title: decodeHtml(item.title ?? 'Untitled'),
      year: item.publication_year ?? null,
      journal: decodeHtml(item.primary_location?.source?.display_name ?? ''),
      doi: item.doi ?? '',
      authors: (item.authorships ?? []).map((a: Record<string, any>) => decodeHtml(a.author?.display_name ?? '')),
      abstract: decodeHtml(reconstructAbstract(item.abstract_inverted_index)),
      url: item.primary_location?.landing_page_url ?? item.id ?? '',
      source: 'openalex',
    }))
  } catch (e) {
    log('⚠️', `OpenAlex 检索失败：${String(e)}`)
    return []
  }
}

// ─── 步骤 3：Crossref DOI 补全 ────────────────────────────────────────────────

async function resolveDoiByTitle(title: string): Promise<Partial<RefItem> | null> {
  const url = new URL('https://api.crossref.org/works')
  url.searchParams.set('query.bibliographic', title)
  url.searchParams.set('rows', '1')
  url.searchParams.set('select', 'DOI,title,author,published,container-title,URL,abstract')
  url.searchParams.set('mailto', CROSSREF_MAILTO)

  try {
    const res = await fetchWithTimeout(url.toString(), {
      headers: { 'user-agent': `AI-Office-Test/1.0 (mailto:${CROSSREF_MAILTO})` },
    })
    if (!res.ok) return null
    const data = await res.json() as Record<string, any>
    const item = data?.message?.items?.[0]
    if (!item) return null

    const returnedTitle = Array.isArray(item.title) ? String(item.title[0] || '') : String(item.title || '')
    // 标题相似度不够高则认为不是同一篇
    if (titleSimilarity(title, returnedTitle) < 0.7) return null

    const doi = String(item.DOI || '').trim()
    const authors = (item.author || []).map((a: Record<string, any>) => {
      const g = String(a.given || '').trim()
      const f = String(a.family || '').trim()
      return g && f ? `${g} ${f}` : (f || g)
    }).filter(Boolean)
    const year = item.published?.['date-parts']?.[0]?.[0] ?? null
    const journal = Array.isArray(item['container-title']) ? String(item['container-title'][0] || '') : ''

    return { doi, authors, year, journal, url: doi ? `https://doi.org/${doi}` : '' }
  } catch {
    return null
  }
}

// ─── 步骤 4：合并去重 ─────────────────────────────────────────────────────────

function mergeResults(kbItems: RefItem[], openAlexItems: RefItem[]): RefItem[] {
  const final: RefItem[] = []
  const seenDoi = new Set<string>()
  const seenTitle = new Set<string>()

  function addItem(item: RefItem): void {
    const doiKey = String(item.doi || '').toLowerCase().trim()
    const titleKey = normalizeTitle(item.title)

    if (doiKey && seenDoi.has(doiKey)) return
    // 对于无 DOI 的条目，用标题模糊去重
    if (!doiKey) {
      for (const t of seenTitle) {
        if (titleSimilarity(item.title, t) > 0.85) return
      }
    }

    if (doiKey) seenDoi.add(doiKey)
    seenTitle.add(titleKey)
    final.push(item)
  }

  // KB 结果优先
  for (const item of kbItems) addItem(item)
  for (const item of openAlexItems) addItem(item)

  return final
}

// ─── 打印结果 ──────────────────────────────────────────────────────────────────

function printResults(refs: RefItem[]): void {
  section(`最终文献列表（共 ${refs.length} 条）`)

  for (let i = 0; i < refs.length; i++) {
    const r = refs[i]
    const sourceLabel = r.source === 'kb'
      ? (r.doiResolved ? '🔬KB+DOI补全' : '🔬KB(无DOI)')
      : r.source === 'openalex' ? '🌐OpenAlex' : '📄Crossref'
    const doiStr = r.doi ? `https://doi.org/${r.doi}` : '（无 DOI）'
    const authorsStr = r.authors.length > 0
      ? r.authors.slice(0, 3).join(', ') + (r.authors.length > 3 ? ' 等' : '')
      : '作者未知'

    console.log(`\n  [${i + 1}] ${sourceLabel}`)
    console.log(`      标题：${truncate(r.title, 100)}`)
    console.log(`      作者：${authorsStr}`)
    console.log(`      年份：${r.year ?? '未知'}  期刊：${truncate(r.journal, 60) || '未知'}`)
    console.log(`      DOI：${doiStr}`)
    if (r.abstract) console.log(`      摘要：${truncate(r.abstract, 150)}`)
  }

  // 统计
  const kbCount = refs.filter(r => r.source === 'kb').length
  const kbWithDoi = refs.filter(r => r.source === 'kb' && r.doiResolved).length
  const oaCount = refs.filter(r => r.source === 'openalex').length
  const withDoi = refs.filter(r => r.doi).length

  section('统计摘要')
  console.log(`  来源：🔬 KB ${kbCount} 条（其中 ${kbWithDoi} 条补全了 DOI）  🌐 OpenAlex ${oaCount} 条`)
  console.log(`  DOI 覆盖率：${withDoi}/${refs.length}（${Math.round(withDoi / refs.length * 100)}%）`)
  if (refs.length - withDoi > 0) {
    console.log(`  ⚠️  ${refs.length - withDoi} 条无 DOI，引用列表中需特殊处理`)
  }
}

// ─── 主流程 ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n🔬  混合文献检索测试')
  console.log(`    主题：${TOPIC}`)
  console.log(`    年份：${YEAR_FROM} ~ ${YEAR_TO}  每路最多：${MAX_RESULTS} 条`)
  console.log(`    KB：${KB_BASE_URL}/${KB_PARTITION}`)

  // 步骤 1：LLM 预处理
  section('步骤 1 / 4 — LLM 关键词预处理')
  const meta = await extractTopicMeta(TOPIC)
  log('✅', 'OpenAlex 检索词', meta.openalexTopic)
  log('✅', 'KB 关键词', meta.kbKeywords.join(' | '))
  log('✅', '学科分类', meta.category || '（未识别）')

  // 步骤 2：并行检索
  section('步骤 2 / 4 — 并行检索（KB + OpenAlex）')
  const [rawKbHits, openAlexItems] = await Promise.all([
    searchKb(meta.kbKeywords),
    searchOpenAlex(meta.openalexTopic),
  ])
  log('✅', `KB 命中`, `${rawKbHits.length} 条`)
  log('✅', `OpenAlex 命中`, `${openAlexItems.length} 条`)

  // 步骤 3：KB 结果补全 DOI（并行）
  section('步骤 3 / 4 — Crossref DOI 补全（仅 KB 结果）')
  const kbItems: RefItem[] = await Promise.all(
    rawKbHits.map(async (hit): Promise<RefItem> => {
      const base: RefItem = {
        id: '',
        title: hit.title,
        year: null,
        journal: '',
        doi: '',
        authors: [],
        abstract: hit.abstract,
        url: '',
        source: 'kb',
        doiResolved: false,
      }
      const resolved = await resolveDoiByTitle(hit.title)
      if (resolved?.doi) {
        log('✅', `补全 DOI`, `${resolved.doi} ← ${truncate(hit.title, 60)}`)
        return { ...base, ...resolved, source: 'kb', doiResolved: true }
      } else {
        log('⚠️', `无法补全 DOI`, truncate(hit.title, 70))
        return base
      }
    }),
  )

  // 步骤 4：合并去重
  section('步骤 4 / 4 — 合并去重')
  const finalRefs = mergeResults(kbItems, openAlexItems)
  log('✅', `合并后共`, `${finalRefs.length} 条（去掉 ${kbItems.length + openAlexItems.length - finalRefs.length} 条重复）`)

  printResults(finalRefs)
  console.log()
}

main().catch((e) => {
  console.error('\n❌  脚本异常：', e)
  process.exit(1)
})
