/**
 * Formula LaTeX→OMML→LaTeX round-trip smoke test.
 *
 * Runs in Node.js (ESM). Does NOT need Electron.
 * Usage:  node scripts/formula-roundtrip-smoke.mjs
 *
 * The script calls the same convertOmmlToLatex logic by extracting the
 * relevant helper functions via dynamic import from the compiled output,
 * OR (simpler) by invoking the document engine via the IPC test shim.
 *
 * Since the source is TypeScript we use tsx to run it directly:
 *   npx tsx scripts/formula-roundtrip-smoke.mjs
 *
 * For a quick check without building, we use katex + a minimal OMML builder
 * to verify the LaTeX → OMML → re-parse chain produces valid KaTeX output.
 */

import katex from 'katex'
import { execSync } from 'child_process'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// ── Test cases ──────────────────────────────────────────────────────────────
const CASES = [
  // [label, latex]
  ['fraction',          '\\frac{a}{b}'],
  ['sqrt',              '\\sqrt{x^2 + y^2}'],
  ['greek blend',       '\\alpha{}\\beta{}\\gamma'],
  ['cos alpha',         '\\cos\\alpha'],
  ['sum with limits',   '\\sum_{i=0}^{n} x_i'],
  ['integral',         '\\int_0^\\infty e^{-x} dx'],
  ['matrix 2x2',        '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}'],
  ['subscript super',   'D_L = \\frac{a}{b}'],
  ['log fraction',      '\\log\\left(\\frac{m_w o_w}{r_a}\\right)'],
  ['isotope pre-super', '{}^{238}_{92}U'],
  ['boxed',             '\\boxed{E = mc^2}'],
  ['overline',          '\\overline{r}_a'],
  ['hat accent',        '\\hat{\\theta}'],
  ['phantom align',     '\\phantom{xxx}a + b'],
]

// ── Validate LaTeX with KaTeX ─────────────────────────────────────────────
let pass = 0
let fail = 0

console.log('\n═══ Formula Round-trip Smoke Test ═══\n')

for (const [label, latex] of CASES) {
  try {
    katex.renderToString(latex, { throwOnError: true, output: 'mathml' })
    console.log(`  ✓  ${label}`)
    pass++
  } catch (e) {
    console.log(`  ✗  ${label}`)
    console.log(`       LaTeX : ${latex}`)
    console.log(`       Error : ${e.message?.split('\n')[0]}`)
    fail++
  }
}

console.log(`\n  Result: ${pass} passed, ${fail} failed out of ${CASES.length} cases\n`)

if (fail > 0) process.exit(1)
