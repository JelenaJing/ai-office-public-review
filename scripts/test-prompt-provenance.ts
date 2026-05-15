/**
 * Dual-Prompt Provenance Acceptance Test
 *
 * Validates that two different prompts produce two completely different DeckDocuments.
 *
 * Run: npx tsx scripts/test-prompt-provenance.ts
 *
 * Requires a live LLM API key (reads builtin-keys.local.json or .env.local).
 */

import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')

// ── Helpers ──────────────────────────────────────────────────────────────────

let totalPass = 0
let totalFail = 0
const failures: string[] = []

function assert(condition: boolean, message: string, detail?: string) {
  if (condition) {
    console.log('  ✓', message)
    totalPass++
  } else {
    console.error('  ✗ FAIL:', message, detail ? `(${detail})` : '')
    totalFail++
    failures.push(message + (detail ? ` (${detail})` : ''))
  }
}

function assertNoForbiddenFields(obj: unknown, label: string): void {
  const FORBIDDEN = [
    'templateId', 'theme', 'color', 'font', 'background', 'backgroundImage',
    'layout', 'x', 'y', 'w', 'h', 'master', 'animation', 'style', 'pptxConfig',
    'sourceSlideIndex', 'transition',
  ]
  const json = JSON.stringify(obj)
  for (const field of FORBIDDEN) {
    const keyPattern = `"${field}":`
    if (json.includes(keyPattern)) {
      assert(false, `${label}: no forbidden field "${field}"`)
    }
  }
  assert(true, `${label}: no forbidden template fields`)
}

function isLlmAvailable(): boolean {
  const envKeys = [
    process.env.QWEN_API_KEY,
    process.env.AI_WRITER_DEFAULT_QWEN_API_KEY,
    process.env.DEEPSEEK_API_KEY,
    process.env.AI_WRITER_DEFAULT_DEEPSEEK_API_KEY,
  ]
  if (envKeys.some(k => k?.trim())) return true

  const builtinPath = path.join(ROOT, 'build', 'builtin-keys.local.json')
  if (fsSync.existsSync(builtinPath)) {
    try {
      const cfg = JSON.parse(fsSync.readFileSync(builtinPath, 'utf8'))
      if (cfg.qwenApiKey?.trim() || cfg.deepseekApiKey?.trim()) return true
    } catch { /* */ }
  }

  for (const envFile of ['.env', '.env.local']) {
    const p = path.join(ROOT, envFile)
    if (fsSync.existsSync(p)) {
      const content = fsSync.readFileSync(p, 'utf8')
      if (/QWEN_API_KEY\s*=\s*.+/.test(content) || /DEEPSEEK_API_KEY\s*=\s*.+/.test(content)) return true
    }
  }

  return false
}

function makeLlmCompleter(settings: unknown) {
  const { completeText } = require(path.join(ROOT, 'electron/main/services/llmClient.ts'))
  return async (systemPrompt: string, userPrompt: string, featureName?: string) => {
    return completeText(settings, {
      systemPrompt,
      userPrompt,
      temperature: 0.7,
      maxTokens: 8192,
      featureName: featureName ?? 'test-provenance',
    })
  }
}

// ── Prompt definitions ────────────────────────────────────────────────────────

const PROMPT_A = '生成一份关于 AI Office 产品介绍的商务汇报 PPT，10 页左右，有封面、目录、功能模块、商业价值、总结。'
const PROMPT_B = '生成一份关于深度学习图像识别算法优化的学术答辩 PPT，10 页左右，有封面、目录、研究背景、方法、实验、结论。'

// Keywords that MUST appear in deck A but not typically in deck B, and vice-versa
const KEYWORDS_A = ['AI Office', 'Office', '产品', '商务', '功能']
const KEYWORDS_B = ['深度学习', '图像识别', '算法', '学术', '答辩', '实验']

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════')
  console.log(' Dual-Prompt Provenance Acceptance Test')
  console.log('═══════════════════════════════════════════════════════')

  if (!isLlmAvailable()) {
    console.error('\n✗ No LLM API key found. This test requires a live LLM.')
    console.error('  Set QWEN_API_KEY in .env.local or build/builtin-keys.local.json')
    process.exit(1)
  }

  // Use resolveEffectiveSettings so builtin keys from builtin-keys.local.json are applied
  const { SettingsStore } = require(path.join(ROOT, 'electron/main/services/settingsStore.ts'))
  const userDataPath = path.join(ROOT, '.test-workspace-provenance', 'user-data')
  const store = new SettingsStore(userDataPath)
  const settings = await store.resolveEffectiveSettings()
  const llm = makeLlmCompleter(settings)

  const { buildDeckFromPrompt } = require(
    path.join(ROOT, 'src/modules/generation/ppt/deckBuilder/buildDeckFromPrompt.ts'),
  )

  // ── Test A ───────────────────────────────────────────────────────────────

  console.log('\n──────────────────────────────────────────────────────')
  console.log('Generation A: AI Office 商务汇报')
  console.log(`Prompt: "${PROMPT_A.slice(0, 60)}..."`)
  console.log('──────────────────────────────────────────────────────')

  const t0A = Date.now()
  const resultA = await buildDeckFromPrompt(
    { sourceType: 'prompt', prompt: PROMPT_A, imageMode: 'none', language: 'zh' },
    llm,
  )
  const msA = Date.now() - t0A
  console.log(`  Duration: ${msA}ms`)

  if (!resultA.success || !resultA.deck) {
    console.error('  ✗ Generation A FAILED:', resultA.error)
    process.exit(1)
  }

  const deckA = resultA.deck as Record<string, unknown>
  const deckIdA: string = (deckA.deckId as string) ?? '(none)'
  const titleA: string = (deckA.title as string) ?? '(no title)'
  const slidesA = (deckA.slides as Array<Record<string, unknown>>) ?? []
  const slideTitlesA = slidesA.map(s => (s.title as string) ?? (s.heading as string) ?? '(no title)')
  const sourceA = (deckA.source as Record<string, unknown>) ?? {}
  const sourcePromptA: string = (deckA.sourcePrompt as string) ?? ''

  console.log(`  deckId A : ${deckIdA}`)
  console.log(`  title A  : ${titleA}`)
  console.log(`  slides A : ${slidesA.length}`)
  console.log(`  source.type: ${sourceA.type}`)
  console.log(`  sourcePrompt preview: ${sourcePromptA.slice(0, 60)}...`)
  console.log(`  Slide titles:`)
  slideTitlesA.forEach((t, i) => console.log(`    [${i}] ${t}`))

  // Assertions for A
  assert(resultA.success === true, 'A: buildDeckFromPrompt succeeded')
  assert(sourceA.type === 'prompt', 'A: source.type = "prompt"')
  assert(titleA.length > 0, 'A: has title')
  assert(slidesA.length >= 6, `A: slides >= 6 (got ${slidesA.length})`)
  assert(sourcePromptA.includes('AI Office') || sourcePromptA.includes('Office'), 'A: sourcePrompt contains AI Office')
  assert(
    KEYWORDS_A.some(kw => (titleA + slideTitlesA.join(' ')).includes(kw)),
    'A: slide content mentions AI Office / 产品 / 商务 keywords',
    `titles: ${slideTitlesA.slice(0, 3).join(' | ')}`
  )
  assertNoForbiddenFields(deckA, 'A: deck.json')

  // ── Test B ───────────────────────────────────────────────────────────────

  console.log('\n──────────────────────────────────────────────────────')
  console.log('Generation B: 深度学习图像识别 学术答辩')
  console.log(`Prompt: "${PROMPT_B.slice(0, 60)}..."`)
  console.log('──────────────────────────────────────────────────────')

  const t0B = Date.now()
  const resultB = await buildDeckFromPrompt(
    { sourceType: 'prompt', prompt: PROMPT_B, imageMode: 'none', language: 'zh' },
    llm,
  )
  const msB = Date.now() - t0B
  console.log(`  Duration: ${msB}ms`)

  if (!resultB.success || !resultB.deck) {
    console.error('  ✗ Generation B FAILED:', resultB.error)
    process.exit(1)
  }

  const deckB = resultB.deck as Record<string, unknown>
  const deckIdB: string = (deckB.deckId as string) ?? '(none)'
  const titleB: string = (deckB.title as string) ?? '(no title)'
  const slidesB = (deckB.slides as Array<Record<string, unknown>>) ?? []
  const slideTitlesB = slidesB.map(s => (s.title as string) ?? (s.heading as string) ?? '(no title)')
  const sourceB = (deckB.source as Record<string, unknown>) ?? {}
  const sourcePromptB: string = (deckB.sourcePrompt as string) ?? ''

  console.log(`  deckId B : ${deckIdB}`)
  console.log(`  title B  : ${titleB}`)
  console.log(`  slides B : ${slidesB.length}`)
  console.log(`  source.type: ${sourceB.type}`)
  console.log(`  sourcePrompt preview: ${sourcePromptB.slice(0, 60)}...`)
  console.log(`  Slide titles:`)
  slideTitlesB.forEach((t, i) => console.log(`    [${i}] ${t}`))

  // Assertions for B
  assert(resultB.success === true, 'B: buildDeckFromPrompt succeeded')
  assert(sourceB.type === 'prompt', 'B: source.type = "prompt"')
  assert(titleB.length > 0, 'B: has title')
  assert(slidesB.length >= 6, `B: slides >= 6 (got ${slidesB.length})`)
  assert(
    sourcePromptB.includes('深度学习') || sourcePromptB.includes('图像识别') || sourcePromptB.includes('算法'),
    'B: sourcePrompt contains 深度学习/图像识别/算法',
  )
  assert(
    KEYWORDS_B.some(kw => (titleB + slideTitlesB.join(' ')).includes(kw)),
    'B: slide content mentions 深度学习/图像识别/算法/学术 keywords',
    `titles: ${slideTitlesB.slice(0, 3).join(' | ')}`
  )
  assertNoForbiddenFields(deckB, 'B: deck.json')

  // ── Cross-check A vs B ────────────────────────────────────────────────────

  console.log('\n──────────────────────────────────────────────────────')
  console.log('Cross-check: A vs B must be different')
  console.log('──────────────────────────────────────────────────────')

  assert(deckIdA !== deckIdB, 'deckId A != deckId B', `A=${deckIdA} B=${deckIdB}`)
  assert(titleA !== titleB, 'title A != title B', `A="${titleA}" B="${titleB}"`)

  // A should NOT contain B keywords predominantly
  const aTitlesStr = slideTitlesA.join(' ')
  const bTitlesStr = slideTitlesB.join(' ')
  assert(
    !KEYWORDS_B.every(kw => aTitlesStr.includes(kw)),
    'A: does not look like a 深度学习 PPT',
    `A titles: ${aTitlesStr.slice(0, 80)}`
  )
  assert(
    !KEYWORDS_A.every(kw => bTitlesStr.includes(kw)),
    'B: does not look like an AI Office PPT',
    `B titles: ${bTitlesStr.slice(0, 80)}`
  )

  // Slide title overlap check — less than 50% should be identical
  const overlapCount = slideTitlesA.filter(t => slideTitlesB.includes(t)).length
  const overlapRatio = slideTitlesA.length > 0 ? overlapCount / slideTitlesA.length : 1
  assert(overlapRatio < 0.5, `Slide title overlap < 50% (${(overlapRatio * 100).toFixed(0)}% overlap, ${overlapCount}/${slideTitlesA.length} identical)`)

  // ── Save deck JSONs for inspection ────────────────────────────────────────

  const outDir = path.join(ROOT, '.test-workspace-provenance')
  await fs.mkdir(outDir, { recursive: true })

  const deckAPath = path.join(outDir, `deck-A-${deckIdA}.json`)
  const deckBPath = path.join(outDir, `deck-B-${deckIdB}.json`)
  await fs.writeFile(deckAPath, JSON.stringify(deckA, null, 2), 'utf8')
  await fs.writeFile(deckBPath, JSON.stringify(deckB, null, 2), 'utf8')

  console.log('\n──────────────────────────────────────────────────────')
  console.log('Saved deck JSONs:')
  console.log(`  A: ${deckAPath}`)
  console.log(`  B: ${deckBPath}`)

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log('\n═══════════════════════════════════════════════════════')
  console.log(` RESULT: ${totalPass} passed, ${totalFail} failed`)
  if (failures.length > 0) {
    console.error('\nFailed assertions:')
    failures.forEach(f => console.error('  ✗', f))
  } else {
    console.log('\n✅ All assertions passed — prompt provenance is isolated')
  }

  // ── Comparison table ──────────────────────────────────────────────────────

  console.log('\n─── Comparison Report ──────────────────────────────────')
  console.log(`${'Field'.padEnd(22)} ${'Prompt A'.padEnd(36)} ${'Prompt B'.padEnd(36)}`)
  console.log(`${'─'.repeat(22)} ${'─'.repeat(36)} ${'─'.repeat(36)}`)
  const rows: [string, string, string][] = [
    ['deckId', deckIdA.slice(0, 34), deckIdB.slice(0, 34)],
    ['title', titleA.slice(0, 34), titleB.slice(0, 34)],
    ['source.type', String(sourceA.type), String(sourceB.type)],
    ['slides', String(slidesA.length), String(slidesB.length)],
    ['sourcePrompt[0:30]', sourcePromptA.slice(0, 30), sourcePromptB.slice(0, 30)],
  ]
  rows.forEach(([f, a, b]) => console.log(`${f.padEnd(22)} ${a.padEnd(36)} ${b.padEnd(36)}`))

  console.log('\nSlide Titles A:')
  slideTitlesA.forEach((t, i) => console.log(`  [${i}] ${t}`))
  console.log('\nSlide Titles B:')
  slideTitlesB.forEach((t, i) => console.log(`  [${i}] ${t}`))

  process.exit(totalFail > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('\n✗ Unhandled error:', err)
  process.exit(1)
})
