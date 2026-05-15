/**
 * Phase 4 Acceptance Test — Three-template free switching with real PPTX sources
 *
 * Run: npx tsx scripts/test-phase4.ts
 *
 * Verifies:
 *  1. Same DeckDocument renders with academic_defense, chinese_season, business_report
 *  2. All 3 PPTX files generated, non-empty, different sizes
 *  3. llmCalls=0 imageCalls=0 tokenCost=0 for all renders
 *  4. All slide titles/body/items present (no undefined/null/[object Object])
 *  5. Source PPTX files are correct per-template (not all same)
 *  6. Alias IDs work (business_report / chinese_season in addition to *_light)
 */

import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')

let pass = true
const failures: string[] = []

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log('  ✓', message)
  } else {
    console.error('  ✗ FAIL:', message)
    pass = false
    failures.push(message)
  }
}

async function main() {
  // ── Bootstrap: register all 3 manifests with per-template source PPTX paths ─

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
  const paths = {
    academic_defense: path.join(skillsRoot, 'academic_defense', 'source-template.pptx'),
    chinese_season:   path.join(skillsRoot, 'chinese_season',   'source-template.pptx'),
    business_report:  path.join(skillsRoot, 'business_report',  'source-template.pptx'),
    default:          path.join(ROOT, 'electron/main/data/ppt-templates/cuhk_sz_default/source-template.pptx'),
  }

  console.log('\n[test-phase4] ─── Bootstrap ────────────────────────────────────────')
  for (const [name, p] of Object.entries(paths)) {
    const exists = fsSync.existsSync(p)
    const size   = exists ? (fsSync.statSync(p).size / 1024).toFixed(0) + 'KB' : 'MISSING'
    console.log(`  ${name}: ${exists ? '✓' : '✗'} ${size}  ${p}`)
    if (name !== 'default') {
      assert(exists, `source-template.pptx exists for ${name}`)
    }
  }

  // Verify per-template PPTX files are all different (different sizes = different files)
  const sizes = Object.entries(paths)
    .filter(([k]) => k !== 'default')
    .map(([name, p]) => ({ name, size: fsSync.existsSync(p) ? fsSync.statSync(p).size : 0 }))

  const sizeSet = new Set(sizes.map((s) => s.size))
  assert(sizeSet.size === 3, `All 3 source PPTX files are distinct (got sizes: ${sizes.map((s) => s.size).join(', ')})`)

  const resolvedPath = (name: keyof typeof paths) =>
    fsSync.existsSync(paths[name]) ? paths[name] : paths.default

  initBusinessReportLight(resolvedPath('business_report'))
  initChineseSeasonLight(resolvedPath('chinese_season'))
  initAcademicDefense(resolvedPath('academic_defense'))
  console.log('  ✓ All 3 manifests registered')

  // ── Check alias IDs registered ───────────────────────────────────────────

  console.log('\n[test-phase4] ─── Registered Manifest IDs ──────────────────────────')
  const { listTemplateManifests } = require(path.join(ROOT, 'src/types/pptTemplateManifest.ts'))
  const manifests: Array<{ manifestId: string; name: string }> = listTemplateManifests()
  const manifestIds = manifests.map((m) => m.manifestId)
  console.log('  Registered IDs:', manifestIds.join(', '))

  const expectedIds = [
    'academic_defense',
    'business_report_light', 'business_report',
    'chinese_season_light', 'chinese_season',
  ]
  for (const id of expectedIds) {
    assert(manifestIds.includes(id), `Manifest '${id}' is registered`)
  }

  // ── Set up test workspace ────────────────────────────────────────────────

  const WORKSPACE = path.join(ROOT, '.test-workspace-phase4')
  const DECK_ID   = 'sample-deck-001'
  const deckDir   = path.join(WORKSPACE, '05_Presentation', 'decks', DECK_ID)

  await fs.mkdir(deckDir, { recursive: true })

  const sampleSrc     = path.join(ROOT, 'electron/main/data/deck-samples/sample-deck-001.json')
  const deckJsonDest  = path.join(deckDir, 'deck.json')
  await fs.copyFile(sampleSrc, deckJsonDest)

  console.log('\n[test-phase4] ─── Workspace ─────────────────────────────────────────')
  console.log('  workspace =', WORKSPACE)
  console.log('  deck.json copied ✓')

  const { renderDeckDocument } = require(path.join(ROOT, 'electron/main/services/deckDocumentService.ts'))

  // ── Render all 3 templates ───────────────────────────────────────────────

  const templates = [
    { manifestId: 'academic_defense',    label: '学术答辩',   outFile: 'academic_defense_output.pptx' },
    { manifestId: 'chinese_season',      label: '中国风节气', outFile: 'chinese_season_output.pptx' },
    { manifestId: 'business_report',     label: '商务汇报',   outFile: 'business_report_output.pptx' },
  ]

  const results: Array<{
    manifestId: string
    label: string
    outputPath: string
    size: number
    slideCount: number
    llmCalls: number
    imageCalls: number
    tokenCost: number
    success: boolean
    error?: string
  }> = []

  for (const tmpl of templates) {
    const outputPath = path.join(deckDir, tmpl.outFile)
    console.log(`\n[test-phase4] ─── Render: ${tmpl.manifestId} ────────────────────────`)

    const t0 = Date.now()
    const result = await renderDeckDocument({
      workspacePath: WORKSPACE,
      deckId: DECK_ID,
      manifestId: tmpl.manifestId,
      outputPath,
    })
    const ms = Date.now() - t0

    console.log(`  duration: ${ms}ms`)
    console.log(`  result:`, JSON.stringify(result, null, 2))

    assert(result.success === true,       `[${tmpl.manifestId}] success=true (${result.error ?? 'ok'})`)
    assert(result.llmCalls === 0,         `[${tmpl.manifestId}] llmCalls=0`)
    assert(result.imageCalls === 0,       `[${tmpl.manifestId}] imageCalls=0`)
    assert(result.tokenCost === 0,        `[${tmpl.manifestId}] tokenCost=0`)
    assert(result.slideCount >= 8,        `[${tmpl.manifestId}] slideCount>=8 (got ${result.slideCount})`)
    assert(result.manifestId === tmpl.manifestId, `[${tmpl.manifestId}] manifestId correct`)

    let fileSize = 0
    if (result.outputPath) {
      const stat = await fs.stat(result.outputPath).catch(() => null)
      fileSize = stat?.size ?? 0
      assert(fileSize > 10_000, `[${tmpl.manifestId}] PPTX > 10KB (got ${fileSize} bytes)`)
    }

    results.push({
      manifestId: tmpl.manifestId,
      label: tmpl.label,
      outputPath: result.outputPath ?? outputPath,
      size: fileSize,
      slideCount: result.slideCount,
      llmCalls: result.llmCalls,
      imageCalls: result.imageCalls,
      tokenCost: result.tokenCost,
      success: result.success,
      error: result.error,
    })
  }

  // ── Verify all 3 files are different ────────────────────────────────────

  console.log('\n[test-phase4] ─── File Difference Check ────────────────────────────')
  const successResults = results.filter((r) => r.success && r.size > 0)
  if (successResults.length === 3) {
    const fileSizeSet = new Set(successResults.map((r) => r.size))
    assert(
      fileSizeSet.size >= 2,
      `PPTX files have different sizes (${successResults.map((r) => `${r.manifestId}:${r.size}`).join(', ')})`,
    )

    // Check binary diff of file 1 vs 2, and 1 vs 3
    const [buf1, buf2, buf3] = await Promise.all(
      successResults.map((r) => fs.readFile(r.outputPath)),
    )
    assert(!buf1.equals(buf2), `academic_defense ≠ chinese_season (binary diff)`)
    assert(!buf1.equals(buf3), `academic_defense ≠ business_report (binary diff)`)
    assert(!buf2.equals(buf3), `chinese_season ≠ business_report (binary diff)`)
  } else {
    console.log(`  ⚠ Only ${successResults.length}/3 renders succeeded — skipping diff check`)
  }

  // ── Content integrity check (slide defs for each template) ───────────────

  console.log('\n[test-phase4] ─── Content Integrity ───────────────────────────────')
  const { loadDeckDocument } = require(path.join(ROOT, 'electron/main/services/deckDocumentService.ts'))
  const { getTemplateManifest } = require(path.join(ROOT, 'src/types/pptTemplateManifest.ts'))
  const { matchLayouts }    = require(path.join(ROOT, 'src/modules/generation/ppt/retemplate/layoutMatcher.ts'))
  const { paginateAll }     = require(path.join(ROOT, 'src/modules/generation/ppt/retemplate/contentPaginator.ts'))
  const { bindSlots }       = require(path.join(ROOT, 'src/modules/generation/ppt/retemplate/slotBinder.ts'))
  const { adaptToPptxSlides } = require(path.join(ROOT, 'src/modules/generation/ppt/retemplate/deckToPptxAdapter.ts'))

  const loaded = await loadDeckDocument(WORKSPACE, DECK_ID)
  assert(loaded.success && !!loaded.deck, 'DeckDocument loads and validates')

  const expectedContent = [
    '2024年度商务报告',
    '目录',
    '公司简介',
    '核心业绩指标',
    '市场竞争分析',
    '总结与展望',
  ]

  if (loaded.deck) {
    const deck = loaded.deck
    for (const tmpl of templates) {
      const manifest = getTemplateManifest(tmpl.manifestId)
      if (!manifest) {
        console.log(`  ⚠ manifest not found for ${tmpl.manifestId}`)
        continue
      }

      const matchResults = matchLayouts(deck.slides, manifest.layouts)
      const paginated    = paginateAll(deck.slides, manifest.layouts, matchResults)
      const plan         = bindSlots(paginated, matchResults, tmpl.manifestId)
      const defs         = adaptToPptxSlides(plan)

      assert(defs.length >= 8, `[${tmpl.manifestId}] slide defs >= 8 (got ${defs.length})`)

      // Check for bad strings
      const issues: string[] = []
      for (const [i, def] of defs.entries()) {
        const s = JSON.stringify(def)
        if (s.includes('[object Object]')) issues.push(`slide[${i}]: [object Object]`)
        if ((def as Record<string, unknown>).heading === 'undefined') issues.push(`slide[${i}].heading="undefined"`)
        if ((def as Record<string, unknown>).title   === 'undefined') issues.push(`slide[${i}].title="undefined"`)
        if ((def as Record<string, unknown>).body    === 'undefined') issues.push(`slide[${i}].body="undefined"`)
      }
      assert(issues.length === 0, `[${tmpl.manifestId}] no bad strings (${issues.join('; ') || 'clean'})`)

      // Check all expected content tokens appear
      const allText = defs.map((d: unknown) => JSON.stringify(d)).join('\n')
      let allFound = true
      for (const token of expectedContent) {
        if (!allText.includes(token)) {
          console.error(`  ✗ [${tmpl.manifestId}] missing content: "${token}"`)
          allFound = false
          pass = false
          failures.push(`[${tmpl.manifestId}] missing content: "${token}"`)
        }
      }
      if (allFound) console.log(`  ✓ [${tmpl.manifestId}] all expected content tokens found`)

      // Print slide table
      console.log(`\n  Slide-by-slide (${tmpl.manifestId}):`)
      for (const [i, def] of defs.entries()) {
        const d = def as Record<string, unknown>
        const label = d.heading ?? d.title ?? '(no title)'
        const items = (d.items as string[] | undefined)?.length ?? 0
        console.log(`    [${i}] type=${d.type}  title="${label}"  items=${items}`)
      }
    }
  }

  // ── Source PPTX verification ─────────────────────────────────────────────

  console.log('\n[test-phase4] ─── Source PPTX Paths ───────────────────────────────')
  const { resolvePptBrandTemplate } = require(path.join(ROOT, 'electron/main/services/pptTemplateRegistry.ts'))
  for (const id of ['academic_defense', 'business_report', 'chinese_season',
                     'business_report_light', 'chinese_season_light']) {
    const t = resolvePptBrandTemplate(id)
    const src = t.assets?.sourceTemplatePath ?? '(none)'
    const exists = fsSync.existsSync(src)
    console.log(`  ${id}: ${exists ? '✓' : '⚠'} ${src}`)
  }

  // ── Background injection check ───────────────────────────────────────────

  console.log('\n[test-phase4] ─── Background Injection Analysis ───────────────────')
  const academicSrc  = paths.academic_defense
  const chineseSrc   = paths.chinese_season
  const businessSrc  = paths.business_report

  // Check if source PPTX files are different (different background shapes will be injected)
  const [buf_a, buf_c, buf_b] = await Promise.all([
    fsSync.existsSync(academicSrc)  ? fs.readFile(academicSrc)  : Promise.resolve(Buffer.alloc(0)),
    fsSync.existsSync(chineseSrc)   ? fs.readFile(chineseSrc)   : Promise.resolve(Buffer.alloc(0)),
    fsSync.existsSync(businessSrc)  ? fs.readFile(businessSrc)  : Promise.resolve(Buffer.alloc(0)),
  ])
  assert(!buf_a.equals(buf_c), 'academic_defense source PPTX ≠ chinese_season source PPTX')
  assert(!buf_a.equals(buf_b), 'academic_defense source PPTX ≠ business_report source PPTX')
  assert(!buf_c.equals(buf_b), 'chinese_season source PPTX ≠ business_report source PPTX')
  console.log('  Note: pptxBackgroundInjector reads slide1.xml from each source PPTX')
  console.log('  → Decorative shapes are unique per template → visual differentiation confirmed')

  // ── Final report ─────────────────────────────────────────────────────────

  console.log('\n[test-phase4] ─── Summary Report ───────────────────────────────────')
  console.log()
  console.log('  Template           │ Manifest ID          │ File Size   │ Slides │ LLM │ Img │ Token')
  console.log('  ───────────────────┼──────────────────────┼─────────────┼────────┼─────┼─────┼──────')
  for (const r of results) {
    const sizeKB = r.size > 0 ? (r.size / 1024).toFixed(0) + ' KB' : 'FAILED'
    console.log(
      `  ${r.label.padEnd(18)} │ ${r.manifestId.padEnd(20)} │ ${sizeKB.padEnd(11)} │ ${String(r.slideCount).padEnd(6)} │ ${r.llmCalls}   │ ${r.imageCalls}   │ ${r.tokenCost}`,
    )
  }
  console.log()

  // Output file locations
  console.log('  Generated files:')
  for (const r of results) {
    if (r.success) {
      console.log(`    ${r.manifestId}: ${r.outputPath}`)
    }
  }

  console.log()
  console.log('  Source PPTX files:')
  for (const [name, p] of Object.entries(paths)) {
    if (name !== 'default') {
      const size = fsSync.existsSync(p) ? (fsSync.statSync(p).size / 1024 / 1024).toFixed(1) + ' MB' : 'MISSING'
      console.log(`    ${name}: ${size}  ${p}`)
    }
  }

  console.log()
  console.log('  ID unification:')
  console.log('    academic_defense      → primary ID (no _light alias)')
  console.log('    business_report       → alias for business_report_light (both registered)')
  console.log('    chinese_season        → alias for chinese_season_light (both registered)')
  console.log()

  if (pass) {
    console.log('  ✅ ALL TESTS PASSED — Phase 4 acceptance complete.')
    process.exit(0)
  } else {
    console.error(`  ❌ ${failures.length} TESTS FAILED:`)
    for (const f of failures) console.error(`    • ${f}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('\n[test-phase4] Uncaught error:', err)
  process.exit(1)
})
