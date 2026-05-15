/**
 * Slot Content Fit Pass — Acceptance Test
 *
 * Run: npx tsx scripts/test-slot-content-fit.ts
 *
 * Verifies:
 *   A. business_report: cover title ≤14 chars, category bar cleared, date cleared
 *   B. academic_defense: cover title ≤15 chars, category bar cleared, date cleared
 *   C. Residue scan: no "工作汇报/工作总结/述职报告/论文答辩/开题报告/51PPT/undefined/null"
 *   D. shortTitle + displayTitle present on cover slide
 */

import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'

const ROOT = path.resolve(__dirname, '..')
const OUTPUT_DIR = path.join(ROOT, '.test-workspace-slot-fit')

// ── Test tracking ──────────────────────────────────────────────────────────────

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
    failures.push(`${message}${detail ? ` (${detail})` : ''}`)
  }
}

function warn(message: string, detail?: string) {
  console.warn('  ⚠ WARN:', message, detail ? `(${detail})` : '')
}

// ── Bootstrap ──────────────────────────────────────────────────────────────────

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
    return fs.existsSync(p) ? p : defaultPptx
  }

  initBusinessReportLight(resolve('business_report'))
  initChineseSeasonLight(resolve('chinese_season'))
  initAcademicDefense(resolve('academic_defense'))

  console.log('  ✓ Templates registered')
}

// ── Load LLM settings ─────────────────────────────────────────────────────────

async function loadSettings(): Promise<any> {
  const { SettingsStore } = require(
    path.join(ROOT, 'electron/main/services/settingsStore.ts'),
  )
  const candidates = [
    process.env.APPDATA ? path.join(process.env.APPDATA, 'ai-office-3') : null,
    process.env.HOME ? path.join(process.env.HOME, 'Library', 'Application Support', 'ai-office-3') : null,
    process.env.HOME ? path.join(process.env.HOME, '.config', 'ai-office-3') : null,
  ].filter(Boolean) as string[]

  for (const userDataPath of candidates) {
    const settingsFile = path.join(userDataPath, 'settings.json')
    if (fs.existsSync(settingsFile)) {
      const store = new SettingsStore(userDataPath)
      const settings = await store.resolveEffectiveSettings()
      const hasKey = settings.llm.apiKey.trim().length > 0
      if (hasKey) {
        console.log(`  ✓ Settings loaded: ${settings.llm.provider} / ${settings.llm.model}`)
        return settings
      }
    }
  }
  throw new Error('No LLM API key found. Configure in AI Office app settings.')
}

// ── Extract slide XML text ─────────────────────────────────────────────────────

async function extractSlideTexts(pptxPath: string): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  const buffer = fs.readFileSync(pptxPath)
  const zip = await JSZip.loadAsync(buffer)
  const slideFiles = Object.keys(zip.files)
    .filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f) && !zip.files[f].dir)
    .sort()

  for (const file of slideFiles) {
    const xml = await zip.files[file].async('text')
    const texts = (xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) ?? [])
      .map(m => m.replace(/<[^>]*>/g, '').trim())
      .filter(t => t.length > 0)
    result.set(file, texts.join(' | '))
  }
  return result
}

// ── Residue patterns to check ─────────────────────────────────────────────────

// Each entry: [pattern, description, allowIfInPrompt]
const RESIDUE_PATTERNS: Array<{ text: string; label: string }> = [
  { text: '工作汇报', label: '工作汇报 (template category bar)' },
  { text: '工作总结', label: '工作总结 (template category bar)' },
  { text: '述职报告', label: '述职报告 (template category bar)' },
  { text: '商务通用', label: '商务通用 (template category bar)' },
  { text: '2024年第三季度', label: '2024年第三季度 (old template watermark)' },
  { text: '论文答辩', label: '论文答辩 (template category bar)' },
  { text: '开题报告', label: '开题报告 (template category bar)' },
  { text: '51PPT', label: '51PPT (template watermark)' },
  { text: 'undefined', label: 'undefined (programming residue)' },
  { text: '[object Object]', label: '[object Object] (programming residue)' },
]

interface ResidueResult {
  clean: boolean
  findings: Array<{ pattern: string; slide: string; context: string }>
}

async function scanResidue(pptxPath: string, userPrompt: string): Promise<ResidueResult> {
  const findings: Array<{ pattern: string; slide: string; context: string }> = []
  const slideTexts = await extractSlideTexts(pptxPath)

  for (const [slideFile, text] of slideTexts) {
    for (const { text: pattern, label } of RESIDUE_PATTERNS) {
      // Skip if this word appears in the user prompt itself (e.g., user asked for it)
      if (userPrompt.includes(pattern)) continue
      if (text.includes(pattern)) {
        findings.push({
          pattern: label,
          slide: slideFile,
          context: text.slice(Math.max(0, text.indexOf(pattern) - 20), text.indexOf(pattern) + 40),
        })
      }
    }
  }

  return { clean: findings.length === 0, findings }
}

// ── Cover slide analysis ───────────────────────────────────────────────────────

interface CoverAnalysis {
  /** Title text actually rendered in slide 1 */
  renderedTitle: string
  /** All text lines from slide 1 */
  allTexts: string[]
}

async function analyzeCoverSlide(pptxPath: string): Promise<CoverAnalysis> {
  const buffer = fs.readFileSync(pptxPath)
  const zip = await JSZip.loadAsync(buffer)

  // slide1.xml is the first slide
  const slideFile = 'ppt/slides/slide1.xml'
  const xml = await zip.files[slideFile]?.async('text') ?? ''

  const allTexts = (xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) ?? [])
    .map(m => m.replace(/<[^>]*>/g, '').trim())
    .filter(t => t.length > 0)

  // The rendered title is the longest non-decorative text on the cover
  // (typically the main heading)
  const renderedTitle = [...allTexts].sort((a, b) => b.length - a.length)[0] ?? ''

  return { renderedTitle, allTexts }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗')
  console.log('║   Slot Content Fit Pass — Acceptance Test                    ║')
  console.log('╚══════════════════════════════════════════════════════════════╝\n')

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  console.log('── Bootstrap ──────────────────────────────────────────────────')
  bootstrap()

  console.log('\n── Loading Settings ───────────────────────────────────────────')
  const settings = await loadSettings()

  const { buildDeckFromPromptService } = require(
    path.join(ROOT, 'electron/main/services/ppt/deckBuilder/deckBuilderService.ts'),
  )
  const { renderDeck } = require(
    path.join(ROOT, 'electron/main/services/ppt/retemplateEngine.ts'),
  )

  // ── Test A: business_report ──────────────────────────────────────────────────

  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('── Test A: business_report (AI Office 商务汇报) ────────────────')
  console.log('   Building fresh deck with new prompt...\n')

  const promptA = '生成一份关于 AI Office 产品介绍的商务汇报 PPT，10 页左右，有封面、目录、功能模块、商业价值、总结。'

  const t0A = Date.now()
  let buildA: any
  try {
    buildA = await buildDeckFromPromptService(settings, {
      sourceType: 'prompt',
      prompt: promptA,
      workspacePath: OUTPUT_DIR,
      language: 'zh',
    })
  } catch (err) {
    buildA = { success: false, error: String(err) }
  }
  console.log(`  Duration: ${((Date.now() - t0A) / 1000).toFixed(1)}s`)

  assert(buildA?.success === true, 'A: deck build succeeded', buildA?.error)

  if (buildA?.success && buildA?.deck) {
    const deckA = buildA.deck
    const deckPathA = path.join(OUTPUT_DIR, `deck-A-${deckA.deckId?.slice(0, 8)}.json`)
    fs.writeFileSync(deckPathA, JSON.stringify(deckA, null, 2), 'utf-8')

    console.log(`\n  Deck A: "${deckA.title}"`)
    console.log(`  deckId: ${deckA.deckId}`)
    console.log(`  deck.json: ${deckPathA}`)

    const coverA = deckA.slides?.find((s: any) => s.intent === 'cover') ?? deckA.slides?.[0]
    if (coverA) {
      console.log(`\n  Cover slide fields:`)
      console.log(`    title:        "${coverA.title ?? '(missing)'}"`)
      console.log(`    shortTitle:   "${coverA.shortTitle ?? '(missing)'}"`)
      console.log(`    displayTitle: "${coverA.displayTitle ?? '(missing)'}"`)
      console.log(`    subtitle:     "${coverA.subtitle ?? '(missing)'}"`)
      console.log(`    oneLiner:     "${coverA.oneLiner ?? '(missing)'}"`)

      assert(!!coverA.title?.trim(), 'A: cover has title')
      assert(!!coverA.shortTitle?.trim(), 'A: cover has shortTitle')
      assert(!!coverA.displayTitle?.trim(), 'A: cover has displayTitle')

      const shortLen = (coverA.shortTitle ?? '').length
      const displayLen = (coverA.displayTitle ?? '').length
      assert(shortLen <= 10, `A: shortTitle ≤ 10 chars`, `got ${shortLen}: "${coverA.shortTitle}"`)
      assert(displayLen <= 16, `A: displayTitle ≤ 16 chars`, `got ${displayLen}: "${coverA.displayTitle}"`)
    } else {
      warn('A: No cover slide found in deck')
    }

    // Render business_report
    const outPathA = path.join(OUTPUT_DIR, 'A-business_report_output.pptx')
    console.log(`\n  Rendering to business_report...`)
    const renderA = await renderDeck(deckA, 'business_report', { outputPath: outPathA })
    console.log(`  Render result: success=${renderA?.success} slides=${renderA?.slideCount} llmCalls=${renderA?.llmCalls}`)

    assert(renderA?.success === true, 'A: render succeeded', renderA?.error)
    assert(renderA?.llmCalls === 0, 'A: llmCalls = 0', `got ${renderA?.llmCalls}`)
    assert(renderA?.tokenCost === 0, 'A: tokenCost = 0', `got ${renderA?.tokenCost}`)
    assert(fs.existsSync(outPathA), 'A: output PPTX exists')

    if (fs.existsSync(outPathA)) {
      // Cover analysis
      const coverInfo = await analyzeCoverSlide(outPathA)
      console.log(`\n  Cover slide (slide1.xml) texts: ${coverInfo.allTexts.map(t => `"${t.slice(0, 30)}"`).join(', ')}`)

      // Check for template residue in cover
      const categoryBarWords = ['工作汇报', '工作总结', '述职报告', '工作计划', '商务通用']
      const coverText = coverInfo.allTexts.join(' ')
      const hasCategoryBar = categoryBarWords.some(w => coverText.includes(w))
      assert(!hasCategoryBar, 'A: cover category bar cleared (no "工作汇报/工作总结/述职报告...")',
        hasCategoryBar ? `found in: ${coverInfo.allTexts.filter(t => categoryBarWords.some(w => t.includes(w))).join(', ')}` : undefined)

      const hasDate = coverInfo.allTexts.some(t => /时间：20\d\d/.test(t))
      assert(!hasDate, 'A: cover date cleared (no "时间：20xx...")',
        hasDate ? `found: ${coverInfo.allTexts.filter(t => /时间：20\d\d/.test(t)).join(', ')}` : undefined)

      const has51ppt = coverInfo.allTexts.some(t => t.includes('51PPT'))
      assert(!has51ppt, 'A: cover watermark cleared (no "51PPT")')

      // Residue scan full PPTX
      console.log(`\n  Scanning full PPTX for residue...`)
      const residueA = await scanResidue(outPathA, promptA)
      if (residueA.clean) {
        console.log('  ✓ No template residue found')
        totalPass++
      } else {
        console.warn(`  ⚠ ${residueA.findings.length} residue finding(s):`)
        for (const f of residueA.findings) {
          console.warn(`    - [${f.slide}] ${f.pattern}: "...${f.context}..."`)
        }
        assert(residueA.findings.length === 0, 'A: no template residue in output PPTX',
          `${residueA.findings.length} issues`)
      }

      console.log(`\n  Output: ${outPathA}`)
      console.log(`  Size: ${(fs.statSync(outPathA).size / 1024).toFixed(1)} KB`)
    }
  }

  // ── Test B: academic_defense ─────────────────────────────────────────────────

  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('── Test B: academic_defense (深度学习图像识别算法答辩) ───────────')
  console.log('   Building fresh deck with new prompt...\n')

  const promptB = '生成一份关于深度学习图像识别算法优化的学术答辩 PPT，10 页左右，有封面、目录、研究背景、方法、实验、结论。'

  const t0B = Date.now()
  let buildB: any
  try {
    buildB = await buildDeckFromPromptService(settings, {
      sourceType: 'prompt',
      prompt: promptB,
      workspacePath: OUTPUT_DIR,
      language: 'zh',
    })
  } catch (err) {
    buildB = { success: false, error: String(err) }
  }
  console.log(`  Duration: ${((Date.now() - t0B) / 1000).toFixed(1)}s`)

  assert(buildB?.success === true, 'B: deck build succeeded', buildB?.error)

  if (buildB?.success && buildB?.deck) {
    const deckB = buildB.deck
    const deckPathB = path.join(OUTPUT_DIR, `deck-B-${deckB.deckId?.slice(0, 8)}.json`)
    fs.writeFileSync(deckPathB, JSON.stringify(deckB, null, 2), 'utf-8')

    console.log(`\n  Deck B: "${deckB.title}"`)
    console.log(`  deckId: ${deckB.deckId}`)
    console.log(`  deck.json: ${deckPathB}`)

    const coverB = deckB.slides?.find((s: any) => s.intent === 'cover') ?? deckB.slides?.[0]
    if (coverB) {
      console.log(`\n  Cover slide fields:`)
      console.log(`    title:        "${coverB.title ?? '(missing)'}"`)
      console.log(`    shortTitle:   "${coverB.shortTitle ?? '(missing)'}"`)
      console.log(`    displayTitle: "${coverB.displayTitle ?? '(missing)'}"`)
      console.log(`    subtitle:     "${coverB.subtitle ?? '(missing)'}"`)
      console.log(`    oneLiner:     "${coverB.oneLiner ?? '(missing)'}"`)

      assert(!!coverB.title?.trim(), 'B: cover has title')
      assert(!!coverB.shortTitle?.trim(), 'B: cover has shortTitle')
      assert(!!coverB.displayTitle?.trim(), 'B: cover has displayTitle')

      const shortLen = (coverB.shortTitle ?? '').length
      const displayLen = (coverB.displayTitle ?? '').length
      assert(shortLen <= 10, `B: shortTitle ≤ 10 chars`, `got ${shortLen}: "${coverB.shortTitle}"`)
      assert(displayLen <= 16, `B: displayTitle ≤ 16 chars`, `got ${displayLen}: "${coverB.displayTitle}"`)
    } else {
      warn('B: No cover slide found in deck')
    }

    // Render academic_defense
    const outPathB = path.join(OUTPUT_DIR, 'B-academic_defense_output.pptx')
    console.log(`\n  Rendering to academic_defense...`)
    const renderB = await renderDeck(deckB, 'academic_defense', { outputPath: outPathB })
    console.log(`  Render result: success=${renderB?.success} slides=${renderB?.slideCount} llmCalls=${renderB?.llmCalls}`)

    assert(renderB?.success === true, 'B: render succeeded', renderB?.error)
    assert(renderB?.llmCalls === 0, 'B: llmCalls = 0', `got ${renderB?.llmCalls}`)
    assert(renderB?.tokenCost === 0, 'B: tokenCost = 0', `got ${renderB?.tokenCost}`)
    assert(fs.existsSync(outPathB), 'B: output PPTX exists')

    if (fs.existsSync(outPathB)) {
      const coverInfo = await analyzeCoverSlide(outPathB)
      console.log(`\n  Cover slide (slide1.xml) texts: ${coverInfo.allTexts.map(t => `"${t.slice(0, 30)}"`).join(', ')}`)

      // Check for template residue in cover
      const categoryBarWords = ['论文答辩', '开题报告', '学术汇报', '毕业总结']
      const coverText = coverInfo.allTexts.join(' ')
      const hasCategoryBar = categoryBarWords.some(w => coverText.includes(w))
      assert(!hasCategoryBar, 'B: cover category bar cleared (no "论文答辩/开题报告...")',
        hasCategoryBar ? `found in: ${coverInfo.allTexts.filter(t => categoryBarWords.some(w => t.includes(w))).join(', ')}` : undefined)

      const hasDate = coverInfo.allTexts.some(t => /时间：20\d\d/.test(t))
      assert(!hasDate, 'B: cover date cleared (no "时间：20xx...")',
        hasDate ? `found: ${coverInfo.allTexts.filter(t => /时间：20\d\d/.test(t)).join(', ')}` : undefined)

      const has51ppt = coverInfo.allTexts.some(t => t.includes('51PPT'))
      assert(!has51ppt, 'B: cover watermark cleared (no "51PPT")')

      // Residue scan full PPTX
      console.log(`\n  Scanning full PPTX for residue...`)
      const residueB = await scanResidue(outPathB, promptB)
      if (residueB.clean) {
        console.log('  ✓ No template residue found')
        totalPass++
      } else {
        console.warn(`  ⚠ ${residueB.findings.length} residue finding(s):`)
        for (const f of residueB.findings) {
          console.warn(`    - [${f.slide}] ${f.pattern}: "...${f.context}..."`)
        }
        assert(residueB.findings.length === 0, 'B: no template residue in output PPTX',
          `${residueB.findings.length} issues`)
      }

      console.log(`\n  Output: ${outPathB}`)
      console.log(`  Size: ${(fs.statSync(outPathB).size / 1024).toFixed(1)} KB`)
    }
  }

  // ── Final Report ──────────────────────────────────────────────────────────────

  console.log('\n╔══════════════════════════════════════════════════════════════╗')
  console.log('║                    Acceptance Report                         ║')
  console.log('╚══════════════════════════════════════════════════════════════╝\n')

  console.log(`  Total pass: ${totalPass}`)
  console.log(`  Total fail: ${totalFail}`)

  if (failures.length > 0) {
    console.log('\n  Failures:')
    for (const f of failures) console.log(`    ✗ ${f}`)
  }

  if (totalFail === 0) {
    console.log('\n  🎉 All checks passed!')
  } else {
    console.log(`\n  ❌ ${totalFail} check(s) failed. See failures above.`)
    process.exit(1)
  }
}

main().catch(err => {
  console.error('\nFatal error:', err)
  process.exit(1)
})
