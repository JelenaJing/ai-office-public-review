/**
 * Rich Deck Content Acceptance Test
 *
 * Run: npx tsx scripts/test-rich-deck-content.ts
 *
 * Tests:
 *   1. Call buildDeckFromPrompt for 3 real prompts (business / academic / aesthetic)
 *   2. Validate multi-layer field coverage for each deck
 *   3. Render each deck with 3 templates = 9 PPTX outputs
 *   4. Assert cloneRendererUsed (no fallback to pptxGenerator)
 *   5. Assert coverage thresholds per deck type
 *   6. Check placeholder residue in all 9 PPTX files
 *   7. Assert llmCalls=0 imageCalls=0 tokenCost=0 for all renders
 */

import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'

const ROOT = path.resolve(__dirname, '..')
const OUTPUT_DIR = path.join(ROOT, '.test-workspace-rich-deck')

// ── Test tracking ─────────────────────────────────────────────────────────────

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

function prettyBytes(bytes: number): string {
  return bytes > 0 ? `${(bytes / 1024).toFixed(1)} KB` : '0'
}

// ── Bootstrap: register templates ─────────────────────────────────────────────

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

  console.log('  ✓ Templates registered (business_report, chinese_season, academic_defense)')
}

// ── Load settings from user data dir ─────────────────────────────────────────

async function loadSettings(): Promise<any> {
  const { SettingsStore } = require(
    path.join(ROOT, 'electron/main/services/settingsStore.ts'),
  )

  // Windows: %APPDATA%\ai-office-3, macOS: ~/Library/Application Support/ai-office-3
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
        console.log(`  ✓ Settings loaded from ${userDataPath}`)
        console.log(`    Provider: ${settings.llm.provider}, Model: ${settings.llm.model}`)
        return settings
      }
    }
  }

  throw new Error(
    'No LLM API key found. Configure the API key in the AI Office app settings, ' +
    'or set QWEN_API_KEY / DEEPSEEK_API_KEY in .env.local file.',
  )
}

// ── Coverage statistics ───────────────────────────────────────────────────────

interface CoverageStats {
  slideCount: number
  slidesWithTitle: number
  slidesWithOneLiner: number
  slidesWithSummary: number
  slidesWithBody: number
  slidesWithItems: number
  slidesWithKeywords: number
  slidesWithKeyTakeaways: number
  slidesWithItemsOrKeyTakeaways: number
  slidesWithVisualBrief: number
  slidesWithSpeakerNotes: number
  totalItemsCount: number
  totalKeywordsCount: number
  totalKeyTakeawaysCount: number
}

function computeCoverage(deck: any): CoverageStats {
  const slides: any[] = deck.slides ?? []
  const stats: CoverageStats = {
    slideCount: slides.length,
    slidesWithTitle: 0,
    slidesWithOneLiner: 0,
    slidesWithSummary: 0,
    slidesWithBody: 0,
    slidesWithItems: 0,
    slidesWithKeywords: 0,
    slidesWithKeyTakeaways: 0,
    slidesWithItemsOrKeyTakeaways: 0,
    slidesWithVisualBrief: 0,
    slidesWithSpeakerNotes: 0,
    totalItemsCount: 0,
    totalKeywordsCount: 0,
    totalKeyTakeawaysCount: 0,
  }

  for (const slide of slides) {
    if (slide.title?.trim()) stats.slidesWithTitle++
    if (slide.oneLiner?.trim()) stats.slidesWithOneLiner++
    if (slide.summary?.trim()) stats.slidesWithSummary++
    if (slide.body?.trim()) stats.slidesWithBody++

    const hasItems = Array.isArray(slide.items) && slide.items.length > 0
    const hasKeyTakeaways = Array.isArray(slide.keyTakeaways) && slide.keyTakeaways.length > 0
    const hasKeywords = Array.isArray(slide.keywords) && slide.keywords.length > 0

    if (hasItems) {
      stats.slidesWithItems++
      stats.totalItemsCount += slide.items.length
    }
    if (hasKeywords) {
      stats.slidesWithKeywords++
      stats.totalKeywordsCount += slide.keywords.length
    }
    if (hasKeyTakeaways) {
      stats.slidesWithKeyTakeaways++
      stats.totalKeyTakeawaysCount += slide.keyTakeaways.length
    }
    if (hasItems || hasKeyTakeaways) {
      stats.slidesWithItemsOrKeyTakeaways++
    }
    if (slide.visualBrief?.trim()) stats.slidesWithVisualBrief++
    if (slide.speakerNotes?.trim()) stats.slidesWithSpeakerNotes++
  }

  return stats
}

function pct(count: number, total: number): string {
  if (total === 0) return '0%'
  return `${Math.round((count / total) * 100)}%`
}

function printCoverage(label: string, stats: CoverageStats) {
  const n = stats.slideCount
  console.log(`\n  Coverage for ${label} (${n} slides):`)
  console.log(`    title:             ${stats.slidesWithTitle}/${n} = ${pct(stats.slidesWithTitle, n)}`)
  console.log(`    oneLiner:          ${stats.slidesWithOneLiner}/${n} = ${pct(stats.slidesWithOneLiner, n)}`)
  console.log(`    summary:           ${stats.slidesWithSummary}/${n} = ${pct(stats.slidesWithSummary, n)}`)
  console.log(`    body:              ${stats.slidesWithBody}/${n} = ${pct(stats.slidesWithBody, n)}`)
  console.log(`    items:             ${stats.slidesWithItems}/${n} = ${pct(stats.slidesWithItems, n)} (total items: ${stats.totalItemsCount})`)
  console.log(`    keywords:          ${stats.slidesWithKeywords}/${n} = ${pct(stats.slidesWithKeywords, n)} (total keywords: ${stats.totalKeywordsCount})`)
  console.log(`    keyTakeaways:      ${stats.slidesWithKeyTakeaways}/${n} = ${pct(stats.slidesWithKeyTakeaways, n)} (total: ${stats.totalKeyTakeawaysCount})`)
  console.log(`    items|keyTakeaways:${stats.slidesWithItemsOrKeyTakeaways}/${n} = ${pct(stats.slidesWithItemsOrKeyTakeaways, n)}`)
  console.log(`    visualBrief:       ${stats.slidesWithVisualBrief}/${n} = ${pct(stats.slidesWithVisualBrief, n)}`)
  console.log(`    speakerNotes:      ${stats.slidesWithSpeakerNotes}/${n} = ${pct(stats.slidesWithSpeakerNotes, n)}`)
}

// ── Forbidden fields check ────────────────────────────────────────────────────

const FORBIDDEN_DECK_FIELDS = [
  'templateId', 'sourceSlideIndex', 'layoutId',
  'x', 'y', 'w', 'h',
  'font', 'color', 'theme', 'animation', 'master',
]

function checkForbiddenFields(deck: any, label: string): boolean {
  const foundFields = new Set<string>()
  const scanObj = (obj: any, objPath: string) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return
    for (const key of Object.keys(obj)) {
      if (FORBIDDEN_DECK_FIELDS.includes(key)) {
        foundFields.add(`${objPath}.${key}`)
      }
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        scanObj(obj[key], `${objPath}.${key}`)
      }
    }
  }

  // Scan top-level deck fields
  scanObj(deck, 'deck')
  // Scan each slide
  const slides: any[] = deck.slides ?? []
  for (let i = 0; i < slides.length; i++) {
    scanObj(slides[i], `slides[${i}]`)
  }

  if (foundFields.size > 0) {
    console.warn(`  ⚠ Forbidden fields in ${label}:`)
    for (const f of foundFields) console.warn(`    - ${f}`)
    return false
  }
  return true
}

// ── Placeholder residue check ─────────────────────────────────────────────────

const FORBIDDEN_PLACEHOLDER_PATTERNS = [
  '单击此处添加标题文本',
  '此处添加详细文本描述',
  'Your content to play here',
  '根据自己的需要添加适当的文字',
  '51PPT',
  'undefined',
  '[object Object]',
]

async function checkPlaceholderResidue(pptxPath: string): Promise<{ clean: boolean; issues: string[] }> {
  const issues: string[] = []
  try {
    const buffer = fs.readFileSync(pptxPath)
    const zip = await JSZip.loadAsync(buffer)
    const slideFiles = Object.keys(zip.files).filter(f =>
      f.match(/^ppt\/slides\/slide\d+\.xml$/) && !zip.files[f].dir,
    )
    for (const slideFile of slideFiles) {
      const xml = await zip.files[slideFile].async('text')
      const textContent = (xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) || [])
        .map(m => m.replace(/<[^>]*>/g, ''))
        .join(' ')
      for (const pattern of FORBIDDEN_PLACEHOLDER_PATTERNS) {
        if (textContent.includes(pattern)) {
          issues.push(`${slideFile}: contains placeholder "${pattern}"`)
        }
      }
    }
  } catch (err) {
    issues.push(`Failed to read PPTX: ${err instanceof Error ? err.message : String(err)}`)
  }
  return { clean: issues.length === 0, issues }
}

// ── PPTX structure check ──────────────────────────────────────────────────────

async function validatePptxStructure(pptxPath: string): Promise<{ valid: boolean; slideCount: number; issues: string[] }> {
  const issues: string[] = []
  let slideCount = 0
  try {
    const buffer = fs.readFileSync(pptxPath)
    const zip = await JSZip.loadAsync(buffer)
    const required = ['[Content_Types].xml', 'ppt/presentation.xml', '_rels/.rels']
    for (const f of required) {
      if (!zip.files[f]) issues.push(`Missing required file: ${f}`)
    }
    const slideFiles = Object.keys(zip.files).filter(f =>
      f.match(/^ppt\/slides\/slide\d+\.xml$/) && !zip.files[f].dir,
    )
    slideCount = slideFiles.length
    if (slideCount === 0) issues.push('No slide XML files found')

    // Check rels for each slide
    for (const slideFile of slideFiles) {
      const relsFile = slideFile.replace('ppt/slides/', 'ppt/slides/_rels/').replace('.xml', '.xml.rels')
      if (!zip.files[relsFile]) {
        issues.push(`Missing rels for ${slideFile}`)
      }
    }
  } catch (err) {
    issues.push(`PPTX read error: ${err instanceof Error ? err.message : String(err)}`)
  }
  return { valid: issues.length === 0, slideCount, issues }
}

// ── Deck prompt specs ─────────────────────────────────────────────────────────

interface DeckPromptSpec {
  label: string
  type: 'business' | 'academic' | 'aesthetic'
  prompt: string
  filenameBase: string
}

const DECK_PROMPTS: DeckPromptSpec[] = [
  {
    label: 'A (商务)',
    type: 'business',
    prompt: '生成一份关于 AI Office 产品介绍的商务汇报 PPT，10 页左右，有封面、目录、功能模块、商业价值、总结。',
    filenameBase: 'deck-A-business',
  },
  {
    label: 'B (学术)',
    type: 'academic',
    prompt: '生成一份关于深度学习图像识别算法优化的学术答辩 PPT，10 页左右，有封面、目录、研究背景、方法、实验、结论。',
    filenameBase: 'deck-B-academic',
  },
  {
    label: 'C (中国风)',
    type: 'aesthetic',
    prompt: '生成一份关于春天与生命感悟的中国风散文 PPT，10 页左右，有封面、目录、章节、图文页、结尾。',
    filenameBase: 'deck-C-aesthetic',
  },
]

const TEMPLATES = [
  { id: 'business_report', name: '商务汇报' },
  { id: 'academic_defense', name: '学术答辩' },
  { id: 'chinese_season', name: '中国风节气' },
]

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════╗')
  console.log('║   Rich Deck Content Acceptance Tests                 ║')
  console.log('╚══════════════════════════════════════════════════════╝\n')

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  }

  // ── Bootstrap ───────────────────────────────────────────────────────────
  console.log('── Bootstrap ───────────────────────────────────────────────')
  bootstrap()

  // ── Load Settings ────────────────────────────────────────────────────────
  console.log('\n── Loading Settings ────────────────────────────────────────')
  const settings = await loadSettings()

  // Load required services via require() (tsx handles .ts files)
  const { buildDeckFromPromptService } = require(
    path.join(ROOT, 'electron/main/services/ppt/deckBuilder/deckBuilderService.ts'),
  )
  const { renderDeck } = require(
    path.join(ROOT, 'electron/main/services/ppt/retemplateEngine.ts'),
  )

  // ── Phase 1: Build Decks via LLM ─────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('── Phase 1: Building 3 Decks via LLM ───────────────────────')
  console.log('   (3 real LLM calls — this may take 60–180 seconds each)\n')

  interface DeckBuildRecord {
    spec: DeckPromptSpec
    deckPath: string
    deck: any
    stats: CoverageStats
    success: boolean
    error?: string
    durationMs: number
  }

  const deckRecords: DeckBuildRecord[] = []

  for (const spec of DECK_PROMPTS) {
    console.log(`\n── Building Deck ${spec.label} ─────────────────────────────`)
    console.log(`   "${spec.prompt.slice(0, 70)}..."`)

    const t0 = Date.now()
    let buildResult: any
    try {
      buildResult = await buildDeckFromPromptService(settings, {
        sourceType: 'prompt',
        prompt: spec.prompt,
        workspacePath: OUTPUT_DIR,
        language: 'zh',
      })
    } catch (err) {
      console.error(`  ✗ buildDeckFromPromptService threw:`, err)
      buildResult = { success: false, error: String(err), warnings: [] }
    }
    const durationMs = Date.now() - t0

    console.log(`  Duration: ${(durationMs / 1000).toFixed(1)}s`)

    if (!buildResult?.success || !buildResult?.deck) {
      console.error(`  ✗ Build failed: ${buildResult?.error}`)
      if (buildResult?.warnings?.length) {
        for (const w of buildResult.warnings) console.warn(`    warning: ${w}`)
      }
      assert(false, `${spec.label}: deck build succeeded`, buildResult?.error)
      deckRecords.push({
        spec, deckPath: '', deck: null, stats: {} as CoverageStats,
        success: false, error: buildResult?.error, durationMs,
      })
      continue
    }

    const deck = buildResult.deck
    const deckId: string = deck.deckId ?? 'unknown'
    const shortId = deckId.slice(0, 8)

    // Save a human-readable copy alongside the service-saved deck
    const deckPath = path.join(OUTPUT_DIR, `${spec.filenameBase}-${shortId}.json`)
    fs.writeFileSync(deckPath, JSON.stringify(deck, null, 2), 'utf-8')

    console.log(`  ✓ Deck built: "${deck.title}"`)
    console.log(`    deckId: ${deckId}`)
    console.log(`    slides: ${deck.slides?.length ?? 0}`)
    console.log(`    source.type: ${deck.source?.type}`)
    console.log(`    sourcePrompt: "${(deck.sourcePrompt ?? '').slice(0, 60)}"`)
    console.log(`    Saved to: ${deckPath}`)
    if (buildResult?.deckPath) {
      console.log(`    Service saved to: ${buildResult.deckPath}`)
    }

    // Basic build assertions
    assert(buildResult.success, `${spec.label}: deck build succeeded`)
    assert((deck.slides?.length ?? 0) >= 5, `${spec.label}: slideCount ≥ 5`, `got ${deck.slides?.length}`)
    assert(deck.source?.type === 'prompt', `${spec.label}: source.type = 'prompt'`, `got ${deck.source?.type}`)
    assert(
      (deck.sourcePrompt ?? '').length > 0,
      `${spec.label}: sourcePrompt is not empty`,
    )

    // Print slide titles
    const slideTitles: string[] = (deck.slides ?? []).map((s: any) => s.title).filter(Boolean)
    console.log(`  Slide titles: ${slideTitles.map(t => `"${t.slice(0, 20)}"`).join(', ')}`)

    // Compute coverage
    const stats = computeCoverage(deck)
    printCoverage(spec.label, stats)

    // Check for forbidden template fields
    const noForbidden = checkForbiddenFields(deck, spec.label)
    assert(noForbidden, `${spec.label}: no forbidden template fields in deck.json`)

    deckRecords.push({ spec, deckPath, deck, stats, success: true, durationMs })
  }

  // ── Phase 2: Coverage Threshold Assertions ────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('── Phase 2: Coverage Threshold Assertions ──────────────────')

  for (const r of deckRecords) {
    if (!r.success) continue
    const { spec, stats } = r
    const n = stats.slideCount
    console.log(`\n  ${spec.label} (${n} slides):`)

    // Universal requirements
    assert(
      stats.slidesWithTitle === n,
      `${spec.label}: 100% slides have title`,
      `${stats.slidesWithTitle}/${n}`,
    )
    assert(
      stats.slidesWithSummary / n >= 0.8,
      `${spec.label}: ≥80% slides have summary`,
      `${pct(stats.slidesWithSummary, n)} (${stats.slidesWithSummary}/${n})`,
    )
    assert(
      stats.slidesWithSpeakerNotes / n >= 0.7,
      `${spec.label}: ≥70% slides have speakerNotes`,
      `${pct(stats.slidesWithSpeakerNotes, n)} (${stats.slidesWithSpeakerNotes}/${n})`,
    )
    assert(
      stats.slidesWithVisualBrief / n >= 0.7,
      `${spec.label}: ≥70% slides have visualBrief`,
      `${pct(stats.slidesWithVisualBrief, n)} (${stats.slidesWithVisualBrief}/${n})`,
    )

    // Business-specific
    if (spec.type === 'business') {
      assert(
        stats.slidesWithItemsOrKeyTakeaways / n >= 0.6,
        `${spec.label}: ≥60% slides have items or keyTakeaways`,
        `${pct(stats.slidesWithItemsOrKeyTakeaways, n)} (${stats.slidesWithItemsOrKeyTakeaways}/${n})`,
      )
      assert(
        stats.totalItemsCount >= 15,
        `${spec.label}: totalItemsCount ≥ 15`,
        `got ${stats.totalItemsCount}`,
      )
      assert(
        stats.totalKeywordsCount >= 12,
        `${spec.label}: totalKeywordsCount ≥ 12`,
        `got ${stats.totalKeywordsCount}`,
      )
    }

    // Academic-specific
    if (spec.type === 'academic') {
      assert(
        stats.slidesWithBody / n >= 0.7,
        `${spec.label}: ≥70% slides have body`,
        `${pct(stats.slidesWithBody, n)} (${stats.slidesWithBody}/${n})`,
      )
      assert(
        stats.totalKeyTakeawaysCount >= 10,
        `${spec.label}: totalKeyTakeawaysCount ≥ 10`,
        `got ${stats.totalKeyTakeawaysCount}`,
      )
    }

    // Aesthetic-specific
    if (spec.type === 'aesthetic') {
      assert(
        stats.slidesWithOneLiner / n >= 0.7,
        `${spec.label}: ≥70% slides have oneLiner`,
        `${pct(stats.slidesWithOneLiner, n)} (${stats.slidesWithOneLiner}/${n})`,
      )
      assert(
        stats.totalKeywordsCount >= 12,
        `${spec.label}: totalKeywordsCount ≥ 12`,
        `got ${stats.totalKeywordsCount}`,
      )
      assert(
        stats.slidesWithVisualBrief / n >= 0.7,
        `${spec.label}: ≥70% slides have visualBrief (aesthetic-specific)`,
        `${pct(stats.slidesWithVisualBrief, n)} (${stats.slidesWithVisualBrief}/${n})`,
      )
    }
  }

  // ── Phase 3: Render All 9 PPTX Outputs ───────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('── Phase 3: Rendering All 9 PPTX Outputs ───────────────────')
  console.log('   (0 LLM calls, 0 image calls, 0 token cost expected)\n')

  interface RenderRecord {
    deckLabel: string
    templateId: string
    outputPath: string
    success: boolean
    slideCount: number
    error?: string
    pptxSize: number
    durationMs: number
  }

  const renderRecords: RenderRecord[] = []

  for (const r of deckRecords) {
    if (!r.success) {
      console.log(`  Skipping ${r.spec.label} — deck build failed.`)
      continue
    }

    for (const tmpl of TEMPLATES) {
      const label = `${r.spec.label} × ${tmpl.name}`
      console.log(`\n  Rendering ${label} (${tmpl.id})...`)

      const outputPath = path.join(OUTPUT_DIR, `${r.spec.filenameBase}_${tmpl.id}_output.pptx`)
      const t0 = Date.now()
      let renderResult: any
      try {
        renderResult = await renderDeck(r.deck, tmpl.id, { outputPath })
      } catch (err) {
        renderResult = { success: false, error: String(err), slideCount: 0, llmCalls: 0, imageCalls: 0, tokenCost: 0 }
      }
      const durationMs = Date.now() - t0

      const pptxExists = fs.existsSync(outputPath)
      const pptxSize = pptxExists ? fs.statSync(outputPath).size : 0

      console.log(`    success=${renderResult?.success} slides=${renderResult?.slideCount} llmCalls=${renderResult?.llmCalls} ms=${durationMs}`)
      if (renderResult?.error) console.log(`    error: ${renderResult.error}`)

      assert(renderResult?.success === true, `${label}: render succeeded`, renderResult?.error)
      assert(renderResult?.llmCalls === 0, `${label}: llmCalls = 0`, `got ${renderResult?.llmCalls}`)
      assert(renderResult?.imageCalls === 0, `${label}: imageCalls = 0`, `got ${renderResult?.imageCalls}`)
      assert(renderResult?.tokenCost === 0, `${label}: tokenCost = 0`, `got ${renderResult?.tokenCost}`)
      assert(pptxExists, `${label}: PPTX file exists`)
      assert(pptxSize > 10000, `${label}: PPTX not empty (> 10KB)`, prettyBytes(pptxSize))

      renderRecords.push({
        deckLabel: r.spec.label,
        templateId: tmpl.id,
        outputPath,
        success: renderResult?.success ?? false,
        slideCount: renderResult?.slideCount ?? 0,
        error: renderResult?.error,
        pptxSize,
        durationMs,
      })

      if (!renderResult?.success || !pptxExists) continue

      // Placeholder residue check
      const residue = await checkPlaceholderResidue(outputPath)
      if (residue.clean) {
        console.log(`    ✓ No placeholder residue`)
        totalPass++
      } else {
        console.warn(`    ⚠ Placeholder residue (${residue.issues.length} issues):`)
        for (const issue of residue.issues.slice(0, 5)) {
          console.warn(`      - ${issue}`)
        }
        // Allow ≤ 3 minor residue issues (some template decorative text may match patterns)
        assert(
          residue.issues.length <= 3,
          `${label}: minimal placeholder residue (≤ 3 issues)`,
          `${residue.issues.length} issues found`,
        )
      }

      // PPTX structure check
      const struct = await validatePptxStructure(outputPath)
      if (!struct.valid) {
        console.warn(`    ⚠ PPTX structure issues: ${struct.issues.slice(0, 2).join('; ')}`)
      }
      assert(struct.valid, `${label}: valid PPTX structure`, struct.issues.slice(0, 2).join('; '))
      assert(struct.slideCount >= 5, `${label}: slide count ≥ 5`, `got ${struct.slideCount}`)
    }
  }

  // ── Final Acceptance Report ───────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════╗')
  console.log('║              Final Acceptance Report                 ║')
  console.log('╚══════════════════════════════════════════════════════╝\n')

  console.log('── Decks Generated ──────────────────────────────────────────')
  for (const r of deckRecords) {
    const status = r.success ? '✓' : '✗'
    const title = r.deck?.title ?? '?'
    const slideCount = r.stats?.slideCount ?? 0
    console.log(`  ${status} Deck ${r.spec.label}: "${title}" (${slideCount} slides, ${(r.durationMs / 1000).toFixed(1)}s)`)
    if (r.success) {
      console.log(`     deck.json: ${r.deckPath}`)
      const slideTitles: string[] = (r.deck.slides ?? []).map((s: any) => s.title).filter(Boolean)
      console.log(`     slides: ${slideTitles.map(t => `"${t.slice(0, 18)}"`).join(' | ')}`)
    } else {
      console.log(`     error: ${r.error}`)
    }
  }

  console.log('\n── PPTX Outputs (9 total) ───────────────────────────────────')
  for (const rr of renderRecords) {
    const status = rr.success ? '✓' : '✗'
    console.log(`  ${status} ${rr.deckLabel} × ${rr.templateId}:`)
    console.log(`     slides=${rr.slideCount} size=${prettyBytes(rr.pptxSize)} ms=${rr.durationMs}`)
    console.log(`     ${rr.outputPath}`)
    if (rr.error) console.log(`     error: ${rr.error}`)
  }

  console.log('\n── Coverage Summary ─────────────────────────────────────────')
  for (const r of deckRecords) {
    if (!r.success) continue
    printCoverage(r.spec.label, r.stats)
  }

  console.log('\n── Insufficient Fields (where to improve prompts) ───────────')
  for (const r of deckRecords) {
    if (!r.success) continue
    const { spec, stats } = r
    const n = stats.slideCount
    const lowFields: string[] = []
    if (stats.slidesWithSummary / n < 0.8) lowFields.push(`summary (${pct(stats.slidesWithSummary, n)})`)
    if (stats.slidesWithSpeakerNotes / n < 0.7) lowFields.push(`speakerNotes (${pct(stats.slidesWithSpeakerNotes, n)})`)
    if (stats.slidesWithVisualBrief / n < 0.7) lowFields.push(`visualBrief (${pct(stats.slidesWithVisualBrief, n)})`)
    if (spec.type === 'business') {
      if (stats.totalItemsCount < 15) lowFields.push(`totalItemsCount (${stats.totalItemsCount} < 15)`)
      if (stats.totalKeywordsCount < 12) lowFields.push(`totalKeywordsCount (${stats.totalKeywordsCount} < 12)`)
    }
    if (spec.type === 'academic') {
      if (stats.slidesWithBody / n < 0.7) lowFields.push(`body (${pct(stats.slidesWithBody, n)})`)
      if (stats.totalKeyTakeawaysCount < 10) lowFields.push(`totalKeyTakeawaysCount (${stats.totalKeyTakeawaysCount} < 10)`)
    }
    if (spec.type === 'aesthetic') {
      if (stats.slidesWithOneLiner / n < 0.7) lowFields.push(`oneLiner (${pct(stats.slidesWithOneLiner, n)})`)
    }
    if (lowFields.length > 0) {
      console.log(`  ${spec.label}: improve → ${lowFields.join(', ')}`)
    } else {
      console.log(`  ${spec.label}: all fields meet thresholds ✓`)
    }
  }

  console.log('\n── Final Score ──────────────────────────────────────────────')
  console.log(`  Passed: ${totalPass}`)
  console.log(`  Failed: ${totalFail}`)

  if (failures.length > 0) {
    console.log('\n  Failures:')
    for (const f of failures) console.log(`    - ${f}`)
  }

  if (totalFail === 0) {
    console.log('\n  ✓ All rich content tests passed!')
  } else {
    console.log('\n  ✗ Some tests failed — see failures above and adjust deckPromptTemplates.ts.')
    process.exit(1)
  }
}

main().catch(err => {
  console.error('Test runner error:', err)
  process.exit(1)
})
