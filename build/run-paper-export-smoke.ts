/**
 * Paper export smoke test
 *
 * 验证以下合约：
 *   1. renderDocumentCitationsForExport 替换旧 references-section 并根据 bibliography 生成新的参考文献区
 *   2. renderDocumentCitationsForExport 在无 bibliography 时只移除 references-section blocks
 *   3. annotateCitationMarks 跳过 references-section blocks (通过 normalizer 间接测试)
 *   4. annotateCitationMarks 在 citationMarks 中包含 offset 字段
 *   5. normalizePaperGenerationResultToDocumentSchema 生成包含 bibliography 的 documentSchema
 *
 * 运行: npm exec --yes --package tsx tsx build/run-paper-export-smoke.ts
 */

import {
  normalizePaperGenerationResultToDocumentSchema,
  type PaperGenerationResultLike,
} from '../electron/main/services/paperResultNormalizer'
import {
  renderDocumentCitationsForExport,
  renderDocumentCitationsForPreview,
} from '../src/utils/documentCitations'
import {
  createDocumentSchema,
  createParagraphBlock,
  createHeadingBlock,
  type DocumentCitationMark,
} from '../src/document/schema/index'

// ── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0
let failed = 0

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${label}`)
  } else {
    failed += 1
    console.error(`  ✗ ${label}`)
  }
}

function assertEq(actual: unknown, expected: unknown, label: string): void {
  if (actual === expected) {
    passed += 1
    console.log(`  ✓ ${label} (${JSON.stringify(actual)})`)
  } else {
    failed += 1
    console.error(`  ✗ ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

// ── Case 1: renderDocumentCitationsForExport replaces references-section ─────

console.log('Case 1: renderDocumentCitationsForExport replaces old references-section')

const docWithOldRefs = createDocumentSchema({
  id: 'test-export-doc',
  profile: 'paper',
  title: 'Test Paper',
  text: '',
  sourceType: 'compat',
})

// Manually build a document with body blocks + old references-section blocks + bibliography
const bodyBlock1 = createParagraphBlock({ id: 'body-1', text: 'Introduction text with [2] citation.' })
const bodyBlock2 = createParagraphBlock({ id: 'body-2', text: 'Method text with [1] citation.' })
const oldRefsHeading = createHeadingBlock({ id: 'old-refs-h', level: 1, text: '参考文献', metadata: { role: 'references-section' } })
const oldRefPara = createParagraphBlock({ id: 'old-refs-p1', text: '[1] Old Author. Old Title.', metadata: { role: 'references-section' } })

const docWithBib = {
  ...docWithOldRefs,
  blocks: [bodyBlock1, bodyBlock2, oldRefsHeading, oldRefPara],
  bibliography: {
    items: [
      { id: 'citation-1', citationNumber: 1, label: '[1] Smith et al., 2023. Title A.' },
      { id: 'citation-2', citationNumber: 2, label: '[2] Jones et al., 2022. Title B.' },
    ],
    generatedAt: new Date().toISOString(),
  },
}

const exported1 = renderDocumentCitationsForExport(docWithBib)

// Returns a DocumentSchema
assert(typeof exported1 === 'object' && !Array.isArray(exported1), 'renderDocumentCitationsForExport returns an object (DocumentSchema)')
assert(Array.isArray(exported1.blocks), 'exported document has blocks array')

// Old references-section blocks should be gone and replaced
const refHeadings1 = exported1.blocks.filter((b) => b.type === 'heading' && b.metadata?.role === 'references-section')
assertEq(refHeadings1.length, 1, 'exactly one new references-section heading')
assert(String((refHeadings1[0] as any).text || '').includes('参考文献'), 'heading text is 参考文献')

const refParas1 = exported1.blocks.filter((b) => b.type === 'paragraph' && b.metadata?.role === 'references-section')
assertEq(refParas1.length, 2, 'two new reference paragraphs (one per bib item)')
assert(String((refParas1[0] as any).text || '').includes('[1]'), 'first ref para is [1]')
assert(String((refParas1[1] as any).text || '').includes('[2]'), 'second ref para is [2]')

// Old ref blocks should NOT be present by their IDs
const allBlockIds1 = exported1.blocks.map((b) => b.id)
assert(!allBlockIds1.includes('old-refs-h'), 'old references-section heading is gone')
assert(!allBlockIds1.includes('old-refs-p1'), 'old references-section paragraph is gone')

// Body blocks preserved
assert(allBlockIds1.includes('body-1'), 'body-1 block preserved')
assert(allBlockIds1.includes('body-2'), 'body-2 block preserved')

// Idempotent: calling again should not duplicate
const exported1b = renderDocumentCitationsForExport(exported1)
const refHeadings1b = exported1b.blocks.filter((b) => b.type === 'heading' && b.metadata?.role === 'references-section')
assertEq(refHeadings1b.length, 1, 'idempotent: still one heading after double-render')
const refParas1b = exported1b.blocks.filter((b) => b.type === 'paragraph' && b.metadata?.role === 'references-section')
assertEq(refParas1b.length, 2, 'idempotent: still 2 ref paras after double-render')

console.log()

// ── Case 2: renderDocumentCitationsForExport — no bibliography ────────────────

console.log('Case 2: renderDocumentCitationsForExport with no bibliography removes old refs-section')

const docNoBib = {
  ...docWithOldRefs,
  blocks: [bodyBlock1, oldRefsHeading, oldRefPara],
  bibliography: undefined,
}

const exported2 = renderDocumentCitationsForExport(docNoBib)

assert(Array.isArray(exported2.blocks), 'exported document has blocks')
const refsBlocks2 = exported2.blocks.filter((b) => b.metadata?.role === 'references-section')
assertEq(refsBlocks2.length, 0, 'no references-section blocks when bibliography is absent')
assert(exported2.blocks.some((b) => b.id === 'body-1'), 'body-1 still present when no bibliography')

console.log()

// ── Case 3: annotateCitationMarks skips references-section blocks ─────────────

console.log('Case 3: normalizePaperGenerationResultToDocumentSchema — annotateCitationMarks skips references-section')

const sampleRefs = [
  { title: 'Alpha Paper', doi: '10.1/alpha', authors: ['A. Smith'], year: 2020, journal: 'J1' },
  { title: 'Beta Paper', doi: '10.2/beta', authors: ['B. Jones'], year: 2021, journal: 'J2' },
]

const sampleMarkdown = `# Introduction

Some text citing [1] and [2] here.

## Method

More text with [2] reference.

## 参考文献

[1] Alpha Paper. A. Smith. 2020.
[2] Beta Paper. B. Jones. 2021.
`

const normalizedResult3: PaperGenerationResultLike = {
  title: 'Test Paper 3',
  markdown: sampleMarkdown,
  references: sampleRefs as any[],
}

const schema3 = normalizePaperGenerationResultToDocumentSchema(normalizedResult3)

assert(schema3 !== null, 'normalizer returns a DocumentSchema')
assert(Array.isArray(schema3.blocks), 'schema has blocks')

// Body paragraph blocks should have citationMarks
const bodyParas3 = schema3.blocks.filter(
  (b) => b.type === 'paragraph' && b.metadata?.role !== 'references-section',
)
const paraThatHasMarks = bodyParas3.find(
  (b) => Array.isArray(b.metadata?.citationMarks) && (b.metadata.citationMarks as DocumentCitationMark[]).length > 0,
)
assert(paraThatHasMarks !== undefined, 'at least one body paragraph has citationMarks')

// citationMarks must have offset field
if (paraThatHasMarks) {
  const marks = paraThatHasMarks.metadata?.citationMarks as DocumentCitationMark[]
  assert(marks.every((m) => typeof m.offset === 'number'), 'all citationMarks have numeric offset field')
}

// references-section blocks must NOT have citationMarks
const refsBlocks3 = schema3.blocks.filter((b) => b.metadata?.role === 'references-section')
assert(refsBlocks3.length > 0, 'references-section blocks exist in normalized schema')
const refsBlocksWithMarks = refsBlocks3.filter(
  (b) => Array.isArray(b.metadata?.citationMarks) && (b.metadata.citationMarks as DocumentCitationMark[]).length > 0,
)
assertEq(refsBlocksWithMarks.length, 0, 'references-section blocks have NO citationMarks')

console.log()

// ── Case 4: citationMarks offset is character index in block.text ─────────────

console.log('Case 4: citationMarks offset matches character index of [N] in block.text')

const markdownWithKnownOffset = `# Test

See paper [1] for details.
`

const result4: PaperGenerationResultLike = {
  title: 'Offset Test',
  markdown: markdownWithKnownOffset,
  references: [{ title: 'Ref One', doi: '10.1/x', authors: ['X'], year: 2022, journal: 'J' }] as any[],
}

const schema4 = normalizePaperGenerationResultToDocumentSchema(result4)
const para4 = schema4.blocks.find(
  (b) => b.type === 'paragraph' && String((b as any).text || '').includes('[1]'),
)
assert(para4 !== undefined, 'paragraph with [1] citation exists')

if (para4) {
  const marks4 = para4.metadata?.citationMarks as DocumentCitationMark[] | undefined
  assert(Array.isArray(marks4) && marks4.length > 0, 'citationMarks present on paragraph with [1]')
  if (marks4 && marks4.length > 0) {
    const mark4 = marks4[0]
    assert(typeof mark4.offset === 'number', 'citationMark has offset field')
    const text4 = String((para4 as any).text || '')
    // The text has [1] — find where [1] actually is in the (possibly renumbered) text
    const actualIdx4 = text4.indexOf('[')
    assert(mark4.offset === actualIdx4, `citationMark.offset (${mark4.offset}) matches [N] position in text (${actualIdx4})`)
  }
}

console.log()

// ── Case 5: bibliography present in schema5 after normalization ───────────────

console.log('Case 5: normalizePaperGenerationResultToDocumentSchema produces bibliography in documentSchema')

const schema5 = normalizePaperGenerationResultToDocumentSchema({
  title: 'Bib Test',
  markdown: 'Body text [1] and [2].',
  references: sampleRefs as any[],
})

assert(schema5.bibliography !== undefined, 'documentSchema has bibliography')
assert(Array.isArray(schema5.bibliography?.items), 'bibliography has items array')
assertEq(schema5.bibliography?.items.length, 2, 'bibliography has 2 items (one per reference)')

// Items must have citationNumber
const bib5 = schema5.bibliography!.items
assert(bib5.every((item) => typeof item.citationNumber === 'number'), 'all bib items have citationNumber')
assert(bib5.every((item) => typeof item.label === 'string' && item.label.length > 0), 'all bib items have label')

// renderDocumentCitationsForExport on normalized schema produces matching refs section
const exported5 = renderDocumentCitationsForExport(schema5)
const refParas5 = exported5.blocks.filter((b) => b.type === 'paragraph' && b.metadata?.role === 'references-section')
assertEq(refParas5.length, 2, 'exported schema has 2 ref paras matching bibliography')

console.log()

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`[smoke:paper-export] ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
