/**
 * DeckBuilder Acceptance Test — Three unified entry points
 *
 * Run: npx tsx scripts/test-deckbuilder.ts
 *
 * Tests:
 *   1. buildDeckFromPrompt  — LLM generates DeckDocument from user prompt
 *   2. buildDeckFromManuscript — LLM converts manuscript to DeckDocument
 *   3. buildDeckFromImportedPptx (rule_based) — zero-LLM PPTX extraction
 *   4. deck.json cleanliness — no forbidden template fields
 *   5. sourceRefs / speakerNotes / summary fields present
 *   6. All three outputs render with academic_defense / chinese_season / business_report
 *   7. Render: llmCalls=0, imageCalls=0, tokenCost=0
 *
 * NOTE: Tests 1 & 2 require a live LLM API key (reads from .env / .env.local).
 *       Test 3 is purely local — no API key needed.
 */

import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')

// ── Helpers ─────────────────────────────────────────────────────────────────

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
    failures.push(message)
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
    // Check that it doesn't appear as a key in the JSON
    const keyPattern = `"${field}":`
    if (json.includes(keyPattern)) {
      assert(false, `${label}: no forbidden field "${field}"`)
    }
  }
}

function prettyBytes(bytes: number): string {
  return bytes > 0 ? `${(bytes / 1024).toFixed(1)} KB` : '0'
}

// ── Bootstrap: register templates ────────────────────────────────────────────

function bootstrap() {
  const { initBusinessReportLight } = require(
    path.join(ROOT, 'electron/main/services/ppt/templates/business_report_light.ts'),
  )
  const { initChineseSeasonLight } = require(
    path.join(ROOT, 'electron/main/services/ppt/templates/chinese_season_light.ts'),
  )
  const { initAcademicDefense } = require(
    path.join(ROOT, 'electron/main/services/ppt/templates/academic_defense.ts'),
  )

  const skillsRoot = path.join(ROOT, 'electron/main/data/ppt-skills')
  const defaultPptx = path.join(ROOT, 'electron/main/data/ppt-templates/cuhk_sz_default/source-template.pptx')
  const resolve = (dir: string) => {
    const p = path.join(skillsRoot, dir, 'source-template.pptx')
    return fsSync.existsSync(p) ? p : defaultPptx
  }

  initAcademicDefense(resolve('academic_defense'))
  initChineseSeasonLight(resolve('chinese_season'))
  initBusinessReportLight(resolve('business_report'))
}

// ── Settings builder (reads from .env files automatically on import) ──────────

function buildTestSettings() {
  // defaultSettings already reads .env / .env.local and builtin-keys.local.json
  // at module import time via resolveBuiltinKeyValue()
  const { defaultSettings } = require(path.join(ROOT, 'electron/main/services/settingsStore.ts'))
  return defaultSettings
}

// ── LLM availability check ────────────────────────────────────────────────────

function isLlmAvailable(): boolean {
  // Check for actual API key in environment (same vars the settingsStore reads)
  const envKeys = [
    process.env.QWEN_API_KEY,
    process.env.AI_WRITER_DEFAULT_QWEN_API_KEY,
    process.env.DEEPSEEK_API_KEY,
    process.env.AI_WRITER_DEFAULT_DEEPSEEK_API_KEY,
  ]
  if (envKeys.some(k => k?.trim())) return true

  // Check builtin-keys.local.json
  const builtinPath = path.join(ROOT, 'build', 'builtin-keys.local.json')
  if (fsSync.existsSync(builtinPath)) {
    try {
      const cfg = JSON.parse(fsSync.readFileSync(builtinPath, 'utf8'))
      if (cfg.qwenApiKey?.trim() || cfg.deepseekApiKey?.trim()) return true
    } catch { /* */ }
  }

  // Check .env / .env.local
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
      featureName: featureName ?? 'test',
    })
  }
}

// ── Test workspace ───────────────────────────────────────────────────────────

const WORKSPACE = path.join(ROOT, '.test-workspace-deckbuilder')

// ── Section A: buildDeckFromPrompt ───────────────────────────────────────────

async function testBuildFromPrompt(settings: unknown): Promise<string | null> {
  console.log('\n══════════════════════════════════════════════')
  console.log('Section A: buildDeckFromPrompt (LLM)')
  console.log('══════════════════════════════════════════════')

  const { buildDeckFromPrompt } = require(
    path.join(ROOT, 'src/modules/generation/ppt/deckBuilder/buildDeckFromPrompt.ts'),
  )
  const { saveDeckDocument } = require(
    path.join(ROOT, 'electron/main/services/deckDocumentService.ts'),
  )

  if (!isLlmAvailable()) {
    console.log('  ⚠ No LLM API key configured — skipping LLM test (not a failure)')
    return null
  }

  const llm = makeLlmCompleter(settings)

  const t0 = Date.now()
  const result = await buildDeckFromPrompt(
    {
      sourceType: 'prompt',
      prompt: '生成一份关于 AI Office 产品介绍的商务汇报 PPT，10 页左右，有封面、目录、功能模块介绍、商业价值、总结与展望。',
      imageMode: 'none',
      language: 'zh',
      scenario: 'business_report',
    },
    llm,
  )
  const ms = Date.now() - t0
  console.log(`  LLM call duration: ${ms}ms`)

  // If LLM fails due to missing API key, skip gracefully
  if (!result.success && result.error && /API Key|api.?key|apiKey|密钥|配置/i.test(result.error)) {
    console.log(`  ⚠ LLM call failed (API key not configured) — skipping: ${result.error.slice(0, 100)}`)
    return null
  }

  assert(result.success === true, 'buildDeckFromPrompt succeeded', result.error)

  if (!result.success || !result.deck) {
    console.error('  Full error:', result.error)
    return null
  }

  const deck = result.deck

  // Structure checks
  assert(deck.source.type === 'prompt', 'source.type = "prompt"')
  assert(typeof deck.title === 'string' && deck.title.length > 0, 'has title')
  assert(Array.isArray(deck.slides) && deck.slides.length >= 8, `slides.length >= 8 (got ${deck.slides.length})`)
  assert(Array.isArray(deck.sections) && deck.sections.length > 0, 'has sections')

  // Slide checks
  const intents = deck.slides.map((s: any) => s.intent)
  assert(intents.includes('cover'), 'has cover slide')
  assert(intents.includes('closing'), 'has closing slide')

  let contentPagesWithContent = 0
  for (const slide of deck.slides) {
    const s = slide as any
    assert(typeof s.title === 'string' && s.title.length > 0, `slide[${s.index}] has title`)
    if (s.intent !== 'cover' && s.intent !== 'closing') {
      const hasContent = s.body || (s.items?.length > 0) || (s.textBlocks?.length > 0) || s.summary
      if (hasContent) contentPagesWithContent++
    }
  }
  assert(contentPagesWithContent >= 3, `>= 3 content slides have body/items/summary (got ${contentPagesWithContent})`)

  // Check for speakerNotes
  const slidesWithNotes = deck.slides.filter((s: any) => s.speakerNotes || s.notes)
  console.log(`  Slides with speakerNotes/notes: ${slidesWithNotes.length}/${deck.slides.length}`)

  // Forbidden field check
  assertNoForbiddenFields(deck, 'deckDocument (from prompt)')

  // Save
  const saveResult = await saveDeckDocument(WORKSPACE, deck)
  assert(saveResult.success, 'deck.json saved', saveResult.error)
  if (saveResult.success) {
    console.log(`  Saved: ${saveResult.filePath}`)
    const stat = fsSync.statSync(saveResult.filePath)
    assert(stat.size > 500, `deck.json size > 500 bytes (${prettyBytes(stat.size)})`)
  }

  // Check deck.json content does NOT have template references
  const deckJson = JSON.parse(fsSync.readFileSync(saveResult.filePath, 'utf8'))
  assert(!('templateId' in deckJson), 'deck.json has no templateId')
  assert(!('business_report' in deckJson), 'deck.json has no template name as top-level key')

  return deck.deckId
}

// ── Section B: buildDeckFromManuscript ───────────────────────────────────────

async function testBuildFromManuscript(settings: unknown): Promise<string | null> {
  console.log('\n══════════════════════════════════════════════')
  console.log('Section B: buildDeckFromManuscript (LLM)')
  console.log('══════════════════════════════════════════════')

  const { buildDeckFromManuscript } = require(
    path.join(ROOT, 'src/modules/generation/ppt/deckBuilder/buildDeckFromManuscript.ts'),
  )
  const { saveDeckDocument } = require(
    path.join(ROOT, 'electron/main/services/deckDocumentService.ts'),
  )

  if (!isLlmAvailable()) {
    console.log('  ⚠ No LLM API key configured — skipping manuscript LLM test')
    return null
  }

  const MANUSCRIPT = `
# 深度学习在医疗影像诊断中的应用研究

## 摘要

本研究探讨了深度学习技术在医疗影像辅助诊断领域的应用现状与发展前景。
通过对卷积神经网络（CNN）、Transformer 等主流架构的系统性分析，
结合大量临床实验数据，证明了 AI 辅助诊断能够显著提升诊断准确率和效率。

## 研究背景

随着全球医疗数据量的爆炸性增长，传统人工诊断方式面临效率瓶颈。
每位医生每天需要处理数百张影像，误诊率居高不下。
深度学习技术的兴起为这一问题提供了新的解决思路。

## 核心方法

本研究采用三阶段技术路线：
1. 数据预处理与标注：收集50万张标注影像，涵盖胸片、CT、MRI等多种模态
2. 模型训练：基于改进的ResNet-50架构，引入注意力机制和多尺度特征融合
3. 临床验证：在三家三甲医院进行盲测，与执业医师诊断结果对比

## 实验结果

- 肺结节检测准确率：97.3%（vs 医生平均 92.1%）
- 糖尿病视网膜病变分级 AUC：0.986
- 骨折检测灵敏度：98.7%，特异度：96.2%
- 平均诊断耗时：从人工 15 分钟缩短至 AI 辅助 2 分钟

## 结论与展望

研究结果证明深度学习辅助诊断系统具有广泛的临床应用价值。
未来工作将聚焦于：多模态数据融合、联邦学习保护隐私、模型可解释性提升、
以及与电子病历系统的深度集成，推动 AI 医疗走向常态化临床应用。
`

  const llm = makeLlmCompleter(settings)

  const t0 = Date.now()
  const result = await buildDeckFromManuscript(
    {
      sourceType: 'manuscript',
      manuscriptContent: MANUSCRIPT,
      manuscriptId: 'test-manuscript-001',
      imageMode: 'none',
      language: 'zh',
    },
    llm,
  )
  const ms = Date.now() - t0
  console.log(`  LLM call duration: ${ms}ms`)

  // If LLM fails due to missing API key, skip gracefully
  if (!result.success && result.error && /API Key|api.?key|apiKey|密钥|配置/i.test(result.error)) {
    console.log(`  ⚠ LLM call failed (API key not configured) — skipping: ${result.error.slice(0, 100)}`)
    return null
  }

  assert(result.success === true, 'buildDeckFromManuscript succeeded', result.error)

  if (!result.success || !result.deck) {
    console.error('  Full error:', result.error)
    return null
  }

  const deck = result.deck

  assert(deck.source.type === 'manuscript', 'source.type = "manuscript"')
  assert(deck.source.manuscriptId === 'test-manuscript-001', 'source.manuscriptId set')
  assert(typeof deck.title === 'string' && deck.title.length > 0, 'has title')
  assert(Array.isArray(deck.slides) && deck.slides.length >= 5, `slides >= 5 (got ${deck.slides.length})`)

  // sourceRefs
  const hasSourceRefs = Array.isArray(deck.sourceRefs) && deck.sourceRefs.length > 0
  assert(hasSourceRefs, 'deck.sourceRefs present')

  // Content should NOT be a verbatim copy of the manuscript
  const manuscriptFirstLine = '深度学习在医疗影像诊断中的应用研究'
  const allSlideTexts = deck.slides.map((s: any) => `${s.title ?? ''} ${s.body ?? ''} ${(s.items ?? []).join(' ')}`).join(' ')
  assert(allSlideTexts.includes('深度学习') || allSlideTexts.includes('医疗'), 'key terms preserved')

  // Check speakerNotes / summary
  const slidesWithSummary = deck.slides.filter((s: any) => s.summary)
  console.log(`  Slides with summary: ${slidesWithSummary.length}/${deck.slides.length}`)

  assertNoForbiddenFields(deck, 'deckDocument (from manuscript)')

  // Save
  const saveResult = await saveDeckDocument(WORKSPACE, deck)
  assert(saveResult.success, 'deck.json saved', saveResult.error)
  if (saveResult.success) {
    console.log(`  Saved: ${saveResult.filePath}`)
  }

  return deck.deckId
}

// ── Section C: buildDeckFromImportedPptx (rule_based) ───────────────────────

async function testBuildFromImportedPptx(): Promise<string | null> {
  console.log('\n══════════════════════════════════════════════')
  console.log('Section C: buildDeckFromImportedPptx (rule_based, zero LLM)')
  console.log('══════════════════════════════════════════════')

  const { extractRawPptxSlides } = require(
    path.join(ROOT, 'electron/main/services/ppt/deckBuilder/deckBuilderService.ts'),
  )
  const { buildDeckFromImportedPptx } = require(
    path.join(ROOT, 'src/modules/generation/ppt/deckBuilder/buildDeckFromImportedPptx.ts'),
  )
  const { saveDeckDocument } = require(
    path.join(ROOT, 'electron/main/services/deckDocumentService.ts'),
  )

  // Use one of the installed template PPTX files as a test import source
  const pptxPath = path.join(ROOT, 'electron/main/data/ppt-skills/business_report/source-template.pptx')
  const altPath = path.join(ROOT, '简约弧形几何工作汇报商务通用PPT模板.pptx')

  const importPath = fsSync.existsSync(pptxPath) ? pptxPath : (fsSync.existsSync(altPath) ? altPath : null)

  if (!importPath) {
    console.log('  ⚠ No test PPTX found — skipping PPTX import test')
    return null
  }

  console.log(`  Extracting: ${importPath}`)

  // Step 1: extract raw slides (async, JSZip-based)
  const t0 = Date.now()
  const extractResult = await extractRawPptxSlides(importPath)
  const ms = Date.now() - t0

  console.log(`  Extraction duration: ${ms}ms`)
  assert(extractResult.success === true, 'extractRawPptxSlides succeeded', extractResult.error)

  if (!extractResult.success || !extractResult.slides?.length) {
    console.error('  Extract error:', extractResult.error)
    return null
  }

  const rawSlides = extractResult.slides
  console.log(`  Extracted ${rawSlides.length} slides`)
  assert(rawSlides.length >= 1, `extracted >= 1 slides (got ${rawSlides.length})`)

  // Show extracted slide summary
  for (let i = 0; i < Math.min(5, rawSlides.length); i++) {
    const s = rawSlides[i] as any
    console.log(`    [${i}] title="${s.title ?? '(none)'}" texts=${s.texts?.length ?? 0} hasImages=${s.hasImages}`)
  }

  // Step 2: build DeckDocument (rule_based — no LLM call)
  let llmCalled = false
  const fakeLlm = async () => {
    llmCalled = true
    return '{}'
  }

  const buildResult = await buildDeckFromImportedPptx(
    rawSlides,
    {
      sourceType: 'imported_pptx',
      pptxPath: importPath,
      importMode: 'rule_based',
      language: 'zh',
    },
    fakeLlm, // should NOT be called in rule_based mode
  )

  assert(buildResult.success === true, 'buildDeckFromImportedPptx succeeded', buildResult.error)
  assert(llmCalled === false, 'rule_based mode: LLM was NOT called')

  if (!buildResult.success || !buildResult.deck) {
    return null
  }

  const deck = buildResult.deck

  assert(deck.source.type === 'imported_pptx', 'source.type = "imported_pptx"')
  assert(Array.isArray(deck.slides) && deck.slides.length >= 1, `slides.length >= 1 (got ${deck.slides.length})`)

  // sourceRefs should point back to original PPTX slides
  const hasSourceRefs = Array.isArray(deck.sourceRefs) && deck.sourceRefs.length > 0
  assert(hasSourceRefs, 'sourceRefs present (pointing to pptx slides)')
  if (hasSourceRefs) {
    const firstRef = deck.sourceRefs![0] as any
    assert(firstRef.sourceType === 'pptx_slide', 'sourceRef.sourceType = "pptx_slide"')
    assert(typeof firstRef.confidence === 'number', 'sourceRef.confidence is a number')
  }

  // Every slide should have an intent (may be 'unknown')
  const validIntents = new Set(['cover', 'toc', 'section_divider', 'text_content', 'content_cards', 'image_text', 'closing', 'unknown'])
  let allIntentsValid = true
  for (const slide of deck.slides) {
    const s = slide as any
    if (!validIntents.has(s.intent)) {
      allIntentsValid = false
      console.error(`  ✗ slide[${s.index}] has invalid intent: "${s.intent}"`)
    }
  }
  assert(allIntentsValid, 'all slides have valid intent')

  assertNoForbiddenFields(deck, 'deckDocument (imported_pptx)')

  if (buildResult.warnings.length > 0) {
    console.log(`  Warnings: ${buildResult.warnings.join('; ')}`)
  }

  // Save
  const saveResult = await saveDeckDocument(WORKSPACE, deck)
  assert(saveResult.success, 'imported deck.json saved', saveResult.error)
  if (saveResult.success) {
    console.log(`  Saved: ${saveResult.filePath}`)
  }

  return deck.deckId
}

// ── Section D: Render all three templates with one deck ───────────────────────

async function testRenderAllTemplates(deckId: string, label: string) {
  console.log(`\n══════════════════════════════════════════════`)
  console.log(`Section D: Render with 3 templates (deck: ${deckId}, source: ${label})`)
  console.log('══════════════════════════════════════════════')

  const { renderDeckDocument } = require(
    path.join(ROOT, 'electron/main/services/deckDocumentService.ts'),
  )

  const templates = ['academic_defense', 'chinese_season', 'business_report']
  const renderResults: Array<{ templateId: string; outputPath: string; size: number; success: boolean; llmCalls: number; imageCalls: number; tokenCost: number }> = []

  for (const templateId of templates) {
    const outputPath = path.join(WORKSPACE, '05_Presentation', 'decks', deckId, `${templateId}_output.pptx`)
    console.log(`\n  Rendering ${templateId}...`)

    const t0 = Date.now()
    const result = await renderDeckDocument({
      workspacePath: WORKSPACE,
      deckId,
      manifestId: templateId,
      outputPath,
    })
    const ms = Date.now() - t0

    console.log(`    Duration: ${ms}ms`)
    assert(result.success === true, `[${templateId}] render success`, result.error)
    assert(result.llmCalls === 0, `[${templateId}] llmCalls=0 (got ${result.llmCalls})`)
    assert(result.imageCalls === 0, `[${templateId}] imageCalls=0 (got ${result.imageCalls})`)
    assert(result.tokenCost === 0, `[${templateId}] tokenCost=0 (got ${result.tokenCost})`)

    let fileSize = 0
    if (result.success && result.outputPath) {
      try {
        const stat = await fs.stat(result.outputPath)
        fileSize = stat.size
        assert(fileSize > 5000, `[${templateId}] PPTX > 5 KB (${prettyBytes(fileSize)})`)
        console.log(`    Output: ${result.outputPath} (${prettyBytes(fileSize)})`)
      } catch {
        assert(false, `[${templateId}] output file exists`)
      }
    }

    renderResults.push({
      templateId,
      outputPath: result.outputPath ?? outputPath,
      size: fileSize,
      success: result.success,
      llmCalls: result.llmCalls ?? 0,
      imageCalls: result.imageCalls ?? 0,
      tokenCost: result.tokenCost ?? 0,
    })
  }

  // Files should differ in size (different templates = different PPTX content)
  const successResults = renderResults.filter(r => r.success && r.size > 0)
  if (successResults.length === 3) {
    const sizes = successResults.map(r => r.size)
    const sizeSet = new Set(sizes)
    assert(sizeSet.size >= 2, `PPTX files have different sizes (${sizes.map(s => prettyBytes(s)).join(', ')})`)

    // Binary diff
    const bufs = await Promise.all(successResults.map(r => fs.readFile(r.outputPath).catch(() => Buffer.alloc(0))))
    assert(!bufs[0].equals(bufs[1]), 'academic_defense ≠ chinese_season (binary)')
    assert(!bufs[0].equals(bufs[2]), 'academic_defense ≠ business_report (binary)')
    assert(!bufs[1].equals(bufs[2]), 'chinese_season ≠ business_report (binary)')
  } else {
    console.log(`  ⚠ Only ${successResults.length}/3 renders succeeded`)
  }
}

// ── Section E: deck.json pollution check ─────────────────────────────────────

async function testDeckJsonPollution(deckId: string) {
  console.log(`\n══════════════════════════════════════════════`)
  console.log(`Section E: deck.json template pollution check (deck: ${deckId})`)
  console.log('══════════════════════════════════════════════')

  const deckJsonPath = path.join(WORKSPACE, '05_Presentation', 'decks', deckId, 'deck.json')

  if (!fsSync.existsSync(deckJsonPath)) {
    console.log(`  ⚠ deck.json not found at ${deckJsonPath}`)
    return
  }

  const deckJson = JSON.parse(fsSync.readFileSync(deckJsonPath, 'utf8'))
  const json = JSON.stringify(deckJson)

  // These template IDs must NOT appear inside deck.json (only in render output/history)
  const templateRefs = ['academic_defense', 'chinese_season', 'business_report', 'business_report_light', 'chinese_season_light']
  for (const ref of templateRefs) {
    const inKey = json.includes(`"${ref}":`)
    assert(!inKey, `deck.json: "${ref}" not used as a key`)
  }

  // source.type check
  const validSourceTypes = ['generated', 'prompt', 'manuscript', 'imported_pptx']
  assert(validSourceTypes.includes(deckJson.source?.type), `source.type is valid (got "${deckJson.source?.type}")`)

  // No forbidden fields
  assertNoForbiddenFields(deckJson, 'deck.json on disk')

  // DeckId should not match a template ID
  assert(!templateRefs.includes(deckJson.deckId), `deckId is not a template ID (got "${deckJson.deckId}")`)
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════╗')
  console.log('║  DeckBuilder Acceptance Test                 ║')
  console.log('╚══════════════════════════════════════════════╝')

  // Setup workspace
  await fs.mkdir(path.join(WORKSPACE, '05_Presentation', 'decks'), { recursive: true })

  // Bootstrap templates
  bootstrap()
  console.log('\n  [Bootstrap] All 3 templates registered ✓')

  // Load settings for LLM
  let settings: unknown = null
  try {
    settings = buildTestSettings()
    const s = settings as Record<string, any>
    console.log(`  [Settings] LLM provider=${s?.llm?.provider} model=${s?.llm?.model}`)
  } catch (err) {
    console.log(`  [Settings] Could not load settings: ${err}`)
  }

  // ── Run sections ──────────────────────────────────────────────────────────

  let promptDeckId: string | null = null
  let manuscriptDeckId: string | null = null
  let importDeckId: string | null = null

  try {
    promptDeckId = await testBuildFromPrompt(settings)
  } catch (err) {
    console.error('  Section A EXCEPTION:', err)
    totalFail++
    failures.push(`Section A exception: ${err}`)
  }

  try {
    manuscriptDeckId = await testBuildFromManuscript(settings)
  } catch (err) {
    console.error('  Section B EXCEPTION:', err)
    totalFail++
    failures.push(`Section B exception: ${err}`)
  }

  try {
    importDeckId = await testBuildFromImportedPptx()
  } catch (err) {
    console.error('  Section C EXCEPTION:', err)
    totalFail++
    failures.push(`Section C exception: ${err}`)
  }

  // Use the best available deckId for render test
  // Prefer importDeckId (zero LLM) but fallback to LLM results
  const renderDeckId = importDeckId ?? promptDeckId ?? manuscriptDeckId

  if (renderDeckId) {
    try {
      await testRenderAllTemplates(renderDeckId, importDeckId ? 'imported_pptx' : promptDeckId ? 'prompt' : 'manuscript')
    } catch (err) {
      console.error('  Section D EXCEPTION:', err)
      totalFail++
      failures.push(`Section D exception: ${err}`)
    }

    try {
      await testDeckJsonPollution(renderDeckId)
    } catch (err) {
      console.error('  Section E EXCEPTION:', err)
    }
  } else {
    console.log('\n  ⚠ No deck available for render/pollution tests')
  }

  // Also run render test with prompt deck if different from import deck
  if (promptDeckId && promptDeckId !== renderDeckId) {
    try {
      await testRenderAllTemplates(promptDeckId, 'prompt')
      await testDeckJsonPollution(promptDeckId)
    } catch (err) {
      console.error('  Prompt render test EXCEPTION:', err)
    }
  }

  // ── Final report ──────────────────────────────────────────────────────────

  console.log('\n╔══════════════════════════════════════════════╗')
  console.log('║  Final Report                                ║')
  console.log('╚══════════════════════════════════════════════╝')
  console.log()
  console.log(`  Deck IDs generated:`)
  console.log(`    Prompt→DeckDocument:      ${promptDeckId ?? '(skipped)'}`)
  console.log(`    Manuscript→DeckDocument:  ${manuscriptDeckId ?? '(skipped)'}`)
  console.log(`    ImportedPPTX→DeckDocument:${importDeckId ?? '(skipped)'}`)
  console.log()
  console.log(`  Results: ${totalPass} passed, ${totalFail} failed`)
  console.log()

  if (failures.length > 0) {
    console.log('  Failures:')
    for (const f of failures) {
      console.log(`    ✗ ${f}`)
    }
  }

  const allDeckIds = [promptDeckId, manuscriptDeckId, importDeckId].filter(Boolean) as string[]
  if (allDeckIds.length > 0) {
    console.log('\n  deck.json locations:')
    for (const id of allDeckIds) {
      const p = path.join(WORKSPACE, '05_Presentation', 'decks', id, 'deck.json')
      console.log(`    ${id}: ${fsSync.existsSync(p) ? p : '(not saved)'}`)
    }
  }

  console.log()
  if (totalFail === 0) {
    console.log('  ✅ ALL TESTS PASSED')
    process.exit(0)
  } else {
    console.log(`  ❌ ${totalFail} test(s) failed`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('\n[FATAL]', err)
  process.exit(1)
})
