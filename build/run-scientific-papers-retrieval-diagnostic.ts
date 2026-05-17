/**
 * 远程知识库「论文库」(paper_kb) 问答测试
 *
 * 直接调用 POST /qa 向知识库提问，打印检索结果。
 *
 * 运行：
 *   npm run diagnostic:scientific-papers
 *
 * 可选环境变量：
 *   KB_BASE_URL      远程 API 地址（默认 http://10.26.1.25:8010）
 *   KB_PARTITION     知识库 partition ID（默认 paper_kb）
 *   RETRIEVAL_QUERY  提问内容（默认：machine learning neural network）
 *   TOP_K            返回命中数（默认：6）
 */

const BASE_URL = process.env.KB_BASE_URL || 'http://10.26.1.25:8010'
const PARTITION = process.env.KB_PARTITION || 'paper_kb'
const QUERY = process.env.RETRIEVAL_QUERY || 'machine learning neural network'
const TOP_K = parseInt(process.env.TOP_K || '6', 10)

function truncate(text: string, max = 200): string {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  return s.length <= max ? s : `${s.slice(0, max)}…`
}

interface QaResult {
  score: number
  file_id: string
  chunk_id?: string
  page_no?: number
  text: string
  page_context?: string
  display_name?: string
  doi?: string
  title?: string
  abstract?: string
  [key: string]: unknown
}

interface QaResponse {
  ok: boolean
  retrieval_mode?: string
  answer?: string
  llm?: { used_llm: boolean; reason?: string; model?: string }
  source_files?: Array<{ file_id: string; display_name?: string; score: number; full_text?: string }>
  results?: QaResult[]
}

async function main(): Promise<void> {
  console.log('\n🔬  论文库问答测试')
  console.log(`    API：${BASE_URL}`)
  console.log(`    知识库：${PARTITION}`)
  console.log(`    问题："${QUERY}"`)
  console.log(`    top_k：${TOP_K}\n`)

  // 连通性检查
  try {
    await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(6000) })
  } catch {
    try {
      await fetch(`${BASE_URL}/knowledge-bases`, { signal: AbortSignal.timeout(6000) })
    } catch (e) {
      console.error(`❌  无法连接服务器 ${BASE_URL}`)
      console.error(`    ${String(e)}`)
      process.exit(1)
    }
  }

  // 调用 /qa
  const start = Date.now()
  let data: QaResponse
  try {
    const res = await fetch(`${BASE_URL}/qa`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-KB-Partition': PARTITION,
      },
      body: JSON.stringify({
        query: QUERY,
        top_k: TOP_K,
        partition: PARTITION,
        llm: false,
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status} ${res.statusText}  ${body}`)
    }
    data = await res.json() as QaResponse
  } catch (e) {
    console.error(`❌  POST /qa 失败：${String(e)}`)
    process.exit(1)
  }

  const elapsed = Date.now() - start
  const hits = data.results ?? []

  console.log(`⏱   耗时 ${elapsed} ms  |  检索模式：${data.retrieval_mode ?? '-'}`)

  if (data.answer) {
    console.log(`\n📝  摘要回答：\n    ${truncate(data.answer, 400)}\n`)
  }

  if (hits.length === 0) {
    console.log('⚠️   未命中任何结果')
    console.log('    可能原因：知识库为空 / 文件未解析完成 / 检索词与内容语言不匹配')
    console.log(`    换个词试试：RETRIEVAL_QUERY="深度学习" npm run diagnostic:scientific-papers`)
  } else {
    console.log(`✅  命中 ${hits.length} 条：\n`)
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i]
      const title = h.title || h.display_name || h.file_id
      const doi = h.doi as string | undefined
      const abstract = h.abstract as string | undefined
      console.log(`  [${i + 1}] score=${h.score.toFixed(4)}`)
      console.log(`      标题：${truncate(title, 120)}`)
      if (doi) console.log(`      DOI：${doi}`)
      console.log(`      摘要：${truncate(abstract || h.page_context || h.text, 200)}`)
      // 打印其余未知字段，方便排查
      const known = new Set(['score','file_id','chunk_id','page_no','text','page_context','display_name','doi','title','abstract'])
      const extras = Object.entries(h).filter(([k]) => !known.has(k) && h[k] != null)
      if (extras.length > 0) {
        console.log(`      其他字段：${extras.map(([k,v]) => `${k}=${JSON.stringify(v)}`).join('  ')}`)
      }
      console.log()
    }
  }

  if (data.source_files && data.source_files.length > 0) {
    console.log(`📚  Top${data.source_files.length} 来源文件：`)
    for (const sf of data.source_files) {
      console.log(`    • [${sf.score.toFixed(4)}] ${sf.display_name || sf.file_id}`)
    }
  }

  console.log()
}

main().catch((e) => {
  console.error('❌  脚本异常：', e)
  process.exit(1)
})
