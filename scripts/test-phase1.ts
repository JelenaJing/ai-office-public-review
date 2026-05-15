/**
 * Phase 1 Acceptance Test — DeckDocument → TemplateManifest → PPTX
 *
 * Run: npx tsx scripts/test-phase1.ts
 *
 * Verifies:
 *  1. Renders sample-deck-001 with business_report_light
 *  2. Renders sample-deck-001 with chinese_season_light
 *  3. llmCalls = 0, imageCalls = 0, tokenCost = 0 for both
 *  4. Both PPTX files are non-empty
 *  5. Both files are different (different templates)
 *  6. All expected slide titles appear in the output slide defs
 *  7. No "[object Object]" / "undefined" strings in slide content
 */

/* eslint-disable @typescript-eslint/no-var-requires */
import fs from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')

// ─── helpers ──────────────────────────────────────────────────────────────

let pass = true
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log('  ✓', message)
  } else {
    console.error('  ✗ FAIL:', message)
    pass = false
  }
}

// ─── main ─────────────────────────────────────────────────────────────────

async function main() {
  // ── Bootstrap: register both template manifests ─────────────────────────

  const { initBusinessReportLight } = require(
    path.join(ROOT, 'electron/main/services/ppt/templates/business_report_light.ts'),
  )
  const { initChineseSeasonLight } = require(
    path.join(ROOT, 'electron/main/services/ppt/templates/chinese_season_light.ts'),
  )

  const sourceTemplatePath = path.join(
    ROOT,
    'electron/main/data/ppt-templates/cuhk_sz_default/source-template.pptx',
  )

  console.log('\n[test-phase1] ─── Bootstrap ────────────────────────────────────')
  console.log('[test-phase1] sourceTemplatePath =', sourceTemplatePath)

  const sourceExists = await fs.access(sourceTemplatePath).then(() => true).catch(() => false)
  if (!sourceExists) {
    console.error('[FAIL] source-template.pptx not found:', sourceTemplatePath)
    process.exit(1)
  }
  console.log('[test-phase1] source-template.pptx ✓ exists')

  initBusinessReportLight(sourceTemplatePath)
  initChineseSeasonLight(sourceTemplatePath)
  console.log('[test-phase1] Manifests registered: business_report_light, chinese_season_light')

  // ── Set up test workspace ────────────────────────────────────────────────

  const WORKSPACE = path.join(ROOT, '.test-workspace')
  const DECK_ID = 'sample-deck-001'
  const deckDir = path.join(WORKSPACE, '05_Presentation', 'decks', DECK_ID)

  await fs.mkdir(deckDir, { recursive: true })

  const sampleSrc = path.join(ROOT, 'electron/main/data/deck-samples/sample-deck-001.json')
  const deckJsonDest = path.join(deckDir, 'deck.json')
  await fs.copyFile(sampleSrc, deckJsonDest)

  console.log('\n[test-phase1] ─── Workspace ─────────────────────────────────────')
  console.log('[test-phase1] workspace =', WORKSPACE)
  console.log('[test-phase1] deck.json copied ✓')

  // ── Import service ───────────────────────────────────────────────────────

  const {
    renderDeckDocument,
    loadDeckDocument,
  } = require(path.join(ROOT, 'electron/main/services/deckDocumentService.ts'))

  // ── Test 1: business_report_light ────────────────────────────────────────

  console.log('\n[test-phase1] ─── Test 1: business_report_light ────────────────')
  console.log('[deck_render_started] deckId=sample-deck-001 manifestId=business_report_light')

  const t1Start = Date.now()
  const result1 = await renderDeckDocument({
    workspacePath: WORKSPACE,
    deckId: DECK_ID,
    manifestId: 'business_report_light',
  })
  const t1ms = Date.now() - t1Start

  console.log('[layout_match_completed] (computed inside engine)')
  console.log('[slot_bind_completed]    (computed inside engine)')
  console.log('[deck_render_completed]  in', t1ms, 'ms')
  console.log('[test-phase1] result1 =', JSON.stringify(result1, null, 2))

  assert(result1.success === true, `result1.success=true (error: ${result1.error ?? 'none'})`)
  assert(result1.llmCalls === 0, 'result1.llmCalls === 0')
  assert(result1.imageCalls === 0, 'result1.imageCalls === 0')
  assert(result1.tokenCost === 0, 'result1.tokenCost === 0')
  assert(result1.slideCount >= 8, `result1.slideCount >= 8 (got ${result1.slideCount})`)
  assert(result1.manifestId === 'business_report_light', 'result1.manifestId correct')
  assert(result1.templateId === 'business_report_light', 'result1.templateId correct')

  let stat1: { size: number } | null = null
  if (result1.outputPath) {
    stat1 = await fs.stat(result1.outputPath).catch(() => null)
    assert(stat1 !== null, `PPTX file exists at ${result1.outputPath}`)
    assert((stat1?.size ?? 0) > 10_000, `PPTX file size > 10KB (got ${stat1?.size ?? 0} bytes)`)
    console.log('  ↳ PPTX path:', result1.outputPath)
    console.log('  ↳ PPTX size:', stat1?.size?.toLocaleString(), 'bytes')
  }

  // ── Test 2: chinese_season_light ─────────────────────────────────────────

  console.log('\n[test-phase1] ─── Test 2: chinese_season_light ─────────────────')
  console.log('[deck_render_started] deckId=sample-deck-001 manifestId=chinese_season_light')

  const t2Start = Date.now()
  const result2 = await renderDeckDocument({
    workspacePath: WORKSPACE,
    deckId: DECK_ID,
    manifestId: 'chinese_season_light',
  })
  const t2ms = Date.now() - t2Start

  console.log('[layout_match_completed] (computed inside engine)')
  console.log('[slot_bind_completed]    (computed inside engine)')
  console.log('[deck_render_completed]  in', t2ms, 'ms')
  console.log('[test-phase1] result2 =', JSON.stringify(result2, null, 2))

  assert(result2.success === true, `result2.success=true (error: ${result2.error ?? 'none'})`)
  assert(result2.llmCalls === 0, 'result2.llmCalls === 0')
  assert(result2.imageCalls === 0, 'result2.imageCalls === 0')
  assert(result2.tokenCost === 0, 'result2.tokenCost === 0')
  assert(result2.slideCount >= 8, `result2.slideCount >= 8 (got ${result2.slideCount})`)
  assert(result2.manifestId === 'chinese_season_light', 'result2.manifestId correct')
  assert(result2.templateId === 'chinese_season_light', 'result2.templateId correct')

  let stat2: { size: number } | null = null
  if (result2.outputPath) {
    stat2 = await fs.stat(result2.outputPath).catch(() => null)
    assert(stat2 !== null, `PPTX file exists at ${result2.outputPath}`)
    assert((stat2?.size ?? 0) > 10_000, `PPTX file size > 10KB (got ${stat2?.size ?? 0} bytes)`)
    console.log('  ↳ PPTX path:', result2.outputPath)
    console.log('  ↳ PPTX size:', stat2?.size?.toLocaleString(), 'bytes')
  }

  // ── Test 3: Files differ ─────────────────────────────────────────────────

  console.log('\n[test-phase1] ─── Test 3: Template Diff Check ──────────────────')
  if (result1.outputPath && result2.outputPath && result1.success && result2.success) {
    const pptx1 = await fs.readFile(result1.outputPath)
    const pptx2 = await fs.readFile(result2.outputPath)
    assert(!pptx1.equals(pptx2), 'Two PPTXs are different (different visual themes)')
    console.log('  ↳ File 1 size:', pptx1.length.toLocaleString(), 'bytes')
    console.log('  ↳ File 2 size:', pptx2.length.toLocaleString(), 'bytes')
  } else {
    console.log('  ⚠ Skipped (one or both renders failed)')
  }

  // ── Test 4: Content integrity ────────────────────────────────────────────

  console.log('\n[test-phase1] ─── Test 4: Content Integrity ────────────────────')

  const { getTemplateManifest } = require(path.join(ROOT, 'src/types/pptTemplateManifest.ts'))
  const { matchLayouts }        = require(path.join(ROOT, 'src/modules/generation/ppt/retemplate/layoutMatcher.ts'))
  const { paginateAll }         = require(path.join(ROOT, 'src/modules/generation/ppt/retemplate/contentPaginator.ts'))
  const { bindSlots }           = require(path.join(ROOT, 'src/modules/generation/ppt/retemplate/slotBinder.ts'))
  const { adaptToPptxSlides }   = require(path.join(ROOT, 'src/modules/generation/ppt/retemplate/deckToPptxAdapter.ts'))

  const loaded = await loadDeckDocument(WORKSPACE, DECK_ID)
  assert(loaded.success && !!loaded.deck, 'DeckDocument loads and validates')

  if (loaded.deck) {
    const deck = loaded.deck
    const manifest = getTemplateManifest('business_report_light')
    assert(!!manifest, 'business_report_light manifest registered')

    if (manifest) {
      const matchResults = matchLayouts(deck.slides, manifest.layouts)
      const paginated    = paginateAll(deck.slides, manifest.layouts, matchResults)
      const plan         = bindSlots(paginated, matchResults, 'business_report_light')
      const defs         = adaptToPptxSlides(plan)

      assert(defs.length >= 8, `Adapter output has >= 8 slides (got ${defs.length})`)

      // Check for bad strings
      const contentIssues: string[] = []
      for (const [i, def] of defs.entries()) {
        const s = JSON.stringify(def)
        if (s.includes('[object Object]')) contentIssues.push(`slide[${i}]: [object Object]`)
        if (def.heading === 'undefined') contentIssues.push(`slide[${i}].heading = literal "undefined"`)
        if (def.title === 'undefined')   contentIssues.push(`slide[${i}].title = literal "undefined"`)
        if (def.body === 'undefined')    contentIssues.push(`slide[${i}].body = literal "undefined"`)
      }
      assert(
        contentIssues.length === 0,
        `No bad strings in slide defs (found: ${contentIssues.join('; ') || 'none'})`,
      )

      // Check all source content appears in output
      const allText = defs.map((d: Record<string, unknown>) => JSON.stringify(d)).join('\n')
      const expectedContent = [
        '2024年度商务报告',
        '目录',
        '公司简介',
        '核心业绩指标',
        '市场竞争分析',
        '总结与展望',
      ]
      for (const token of expectedContent) {
        assert(allText.includes(token), `Content "${token}" present in slide defs`)
      }

      // Print slide table
      console.log('\n  Slide-by-slide output (business_report_light):')
      for (const [i, def] of defs.entries()) {
        const label = (def as Record<string, unknown>).heading ?? (def as Record<string, unknown>).title ?? '(no title)'
        const items = ((def as Record<string, unknown>).items as string[] | undefined)?.length ?? 0
        console.log(`  [${i}] type=${(def as Record<string, unknown>).type} label="${label}" items=${items}`)
      }
    }
  }

  // ── Final summary ────────────────────────────────────────────────────────

  console.log('\n[test-phase1] ─── Summary ───────────────────────────────────────')
  console.log('  PPTX 1 (business_report_light):', result1.outputPath)
  console.log('  PPTX 2 (chinese_season_light): ', result2.outputPath)
  console.log('  Slides in PPTX 1:', result1.slideCount, '  (source had 8 slides)')
  console.log('  Slides in PPTX 2:', result2.slideCount, '  (source had 8 slides)')
  console.log('  LLM calls (both):  0')
  console.log('  Image calls (both): 0')
  console.log('  Token cost (both):  0')
  console.log()

  if (pass) {
    console.log('  ✅ ALL TESTS PASSED — Phase 1 acceptance complete.')
    process.exit(0)
  } else {
    console.error('  ❌ SOME TESTS FAILED — see above for details.')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('\n[test-phase1] Uncaught error:', err)
  process.exit(1)
})
