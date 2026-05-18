/**
 * Citations & DocumentBibliography smoke test
 *
 * 验证以下合约：
 *   1. bibliography 按正文首次出现顺序排序（markdown [2] 先出现 → bibliography.items[0].citationNumber=1）
 *   2. insertCitationIntoDocument 后原有引用编号自动后移
 *   3. 删除 citationMark 后 renumberDocumentCitations 自动重排
 *   4. images 数组中未被 markdown 引用的图片仍能生成 image blocks（unmatched fallback）
 *   5. renderDocumentCitationsForExport 替换旧 references-section 并根据 bibliography 生成新的参考文献区
 *
 * 运行: npm exec --yes --package tsx tsx build/run-citations-smoke.ts
 */

import {
  normalizePaperGenerationResultToDocumentSchema,
  type PaperGenerationResultLike,
  type PaperImageEntry,
} from '../electron/main/services/paperResultNormalizer'
import {
  collectCitationOrderFromDocument,
  renumberDocumentCitations,
  insertCitationIntoDocument,
  renderDocumentCitationsForPreview,
  renderDocumentCitationsForExport,
} from '../src/utils/documentCitations'
import type { DocumentCitationMark } from '../src/document/schema/index'

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

function assertEq<T>(actual: T, expected: T, label: string): void {
  assert(
    actual === expected,
    `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
  )
}

console.log('[smoke:citations] start\n')

// ── Fixtures ──────────────────────────────────────────────────────────────────

const refs = [
  { id: 'r1', title: 'Alpha Paper', year: 2021, journal: 'J1', doi: '10.1/a', authors: ['A'], abstract: '', url: '' },
  { id: 'r2', title: 'Beta Paper', year: 2022, journal: 'J2', doi: '10.1/b', authors: ['B'], abstract: '', url: '' },
  { id: 'r3', title: 'Gamma Paper', year: 2023, journal: 'J3', doi: '', authors: ['C'], abstract: '', url: 'https://example.com/gamma' },
]

// ── Case 1: bibliography ordered by first appearance ─────────────────────────

console.log('Case 1: bibliography ordered by first appearance in markdown')

// Markdown body mentions [2] FIRST, then [1] — so bibliography should reorder
const markdown1 = `# Introduction

This is well known [2] in the literature.

## Method

We follow prior work [1] and also extend [3].

## References

1. Alpha Paper
2. Beta Paper
3. Gamma Paper
`

const result1: PaperGenerationResultLike = {
  title: 'Test Paper',
  markdown: markdown1,
  references: refs,
  images: [],
}

const doc1 = normalizePaperGenerationResultToDocumentSchema(result1)

assertEq(doc1.bibliography?.items.length ?? 0, 3, 'bibliography has 3 items')
// [2] Beta Paper appears first → should be bibliography item 1
assertEq(doc1.bibliography?.items[0]?.label?.startsWith('[1]') ?? false, true, 'bibliography item 0 label starts with [1]')
assertEq(doc1.bibliography?.items[0]?.metadata?.title as string, 'Beta Paper', 'bibliography item 0 is Beta Paper (originally [2])')
assertEq(doc1.bibliography?.items[1]?.metadata?.title as string, 'Alpha Paper', 'bibliography item 1 is Alpha Paper (originally [1])')
assertEq(doc1.bibliography?.items[2]?.metadata?.title as string, 'Gamma Paper', 'bibliography item 2 is Gamma Paper (originally [3])')

// Verify inline text was renumbered: originally "[2]" → now "[1]"
const introBlock = doc1.blocks.find(
  (b) => b.type === 'paragraph' && b.text?.includes('well known'),
)
assert(!!introBlock, 'intro paragraph block found')
assert(
  !!introBlock && String((introBlock as { text?: string }).text || '').includes('[1]'),
  'intro paragraph text renumbered: originally [2] → now [1]',
)

// Verify citationMarks metadata
const introMarks = introBlock?.metadata?.citationMarks as DocumentCitationMark[] | undefined
assert(Array.isArray(introMarks) && introMarks.length > 0, 'intro block has citationMarks')
assertEq(introMarks?.[0]?.citationNumber ?? -1, 1, 'intro citationMark.citationNumber = 1')
assertEq(introMarks?.[0]?.citationId ?? '', 'citation-1', 'intro citationMark.citationId = citation-1')

// Verify references section is tagged
const refSectionBlocks = doc1.blocks.filter((b) => b.metadata?.role === 'references-section')
assert(refSectionBlocks.length > 0, 'references section blocks are tagged')

// citations array should also match bibliography order
assertEq(doc1.citations?.[0]?.metadata?.title as string, 'Beta Paper', 'citations[0] is Beta Paper')

console.log()

// ── Case 2: insertCitationIntoDocument shifts existing numbers ────────────────

console.log('Case 2: insertCitationIntoDocument shifts existing numbers')

// Start with doc1; insert a new citation at the intro block (before Beta Paper)
const introBlockId = introBlock?.id ?? ''
assert(!!introBlockId, 'intro block id is non-empty')

// offset: 0 inserts [1] at the start of the paragraph text,
// so it appears before the existing Beta citation and naturally becomes [1].
const doc2 = insertCitationIntoDocument(doc1, {
  blockId: introBlockId,
  offset: 0,
  reference: {
    title: 'Delta Paper',
    doi: '10.1/d',
    authors: ['D'],
    year: 2024,
  },
})

// Original citation [1] (Beta) in intro block should now be [2] (shifted by 1)
assertEq(doc2.bibliography?.items.length ?? 0, 4, 'bibliography now has 4 items after insert')

// The new citation should have citationNumber = 1 (inserted before existing [1])
const newItem = doc2.bibliography?.items.find((item) => item.metadata?.title === 'Delta Paper')
assert(!!newItem, 'new citation Delta Paper is in bibliography')
assertEq(newItem?.citationNumber ?? -1, 1, 'Delta Paper gets citationNumber = 1 (anchor=0, new=1)')

// Beta Paper should have shifted from 1 → 2
const betaItem = doc2.bibliography?.items.find((item) => item.metadata?.title === 'Beta Paper')
assertEq(betaItem?.citationNumber ?? -1, 2, 'Beta Paper shifted from 1 → 2')

// Intro block text should now contain [2] for the original Beta Paper citation
const introBlock2 = doc2.blocks.find((b) => b.id === introBlockId)
assert(
  !!introBlock2 && String((introBlock2 as { text?: string }).text || '').includes('[2]'),
  'intro block text now has [2] for Beta Paper after insert',
)

console.log()

// ── Case 3: renumberDocumentCitations after removing a citation mark ──────────

console.log('Case 3: renumber after removing a citation mark')

// Manually remove the citationMark for citation 2 from all blocks in doc2
// (simulate user deleting a reference)
const doc2WithRemoved = {
  ...doc2,
  blocks: doc2.blocks.map((block) => {
    if (block.type !== 'paragraph') return block
    const marks = block.metadata?.citationMarks as DocumentCitationMark[] | undefined
    if (!Array.isArray(marks)) return block
    // Remove any mark with citationNumber = 2 (Beta Paper)
    const filtered = marks.filter((m) => m.citationNumber !== 2)
    // Also strip [2] from text
    const newText = String((block as { text?: string }).text || '').replace(/\[2\]/g, '')
    return {
      ...block,
      text: newText,
      metadata: { ...(block.metadata || {}), citationMarks: filtered },
    }
  }),
  bibliography: {
    ...(doc2.bibliography || { items: [] }),
    items: (doc2.bibliography?.items || []).filter((item) => item.citationNumber !== 2),
  },
}

const doc3 = renumberDocumentCitations(doc2WithRemoved)

// After removing Beta Paper (was [2]) and renumbering:
// Delta [1], Alpha [2 → stays at 2? No — Beta was removed so now Alpha shifts to 2... wait]
// Original order (in doc2): Delta[1], Beta[2], Alpha[3], Gamma[4]
// After removing Beta[2]: Delta[1], Alpha[3], Gamma[4]
// After renumber: Delta[1], Alpha[2], Gamma[3]
assertEq(doc3.bibliography?.items.length ?? 0, 3, 'bibliography has 3 items after remove')
const deltaAfter = doc3.bibliography?.items.find((item) => item.metadata?.title === 'Delta Paper')
assertEq(deltaAfter?.citationNumber ?? -1, 1, 'Delta Paper still [1] after renumber')
const alphaAfter = doc3.bibliography?.items.find((item) => item.metadata?.title === 'Alpha Paper')
// Alpha was [3] in doc2, now shifts to [2] after Beta removal
assert((alphaAfter?.citationNumber ?? 0) > 0, 'Alpha Paper has a valid citation number after renumber')

const order3 = collectCitationOrderFromDocument(doc3)
assert(order3.length > 0, 'collectCitationOrderFromDocument returns non-empty after renumber')
// Numbers should be consecutive starting from 1
const maxNum = Math.max(...order3)
assertEq(maxNum, order3.length, 'citation numbers are consecutive 1..N after renumber')

console.log()

// ── Case 4: unmatched images fallback ────────────────────────────────────────

console.log('Case 4: unmatched images fallback (images array has entries not in markdown)')

// Markdown does NOT reference the second image (fig-2-1.png)
const markdown4 = `# Title

Some text [1].

![Figure 1.1](/workspace/images/fig-1-1.png)

**Figure 1.1 caption.**

Body paragraph [2].

## References

1. Alpha
2. Beta
`

const images4: PaperImageEntry[] = [
  {
    section: '1',
    sectionTitle: 'Introduction',
    path: '/workspace/images/fig-1-1.png',
    caption: 'Figure 1.1 intro diagram',
    markdown: '',
    url: 'file:///workspace/images/fig-1-1.png',
  },
  {
    section: '2',
    sectionTitle: 'Method',
    path: '/workspace/images/fig-2-1.png',
    caption: 'Figure 2.1 method diagram',
    markdown: '',
    url: 'file:///workspace/images/fig-2-1.png',
  },
]

const doc4 = normalizePaperGenerationResultToDocumentSchema({
  title: 'Test',
  markdown: markdown4,
  references: refs.slice(0, 2),
  images: images4,
})

const imageBlocks4 = doc4.blocks.filter((b) => b.type === 'image')
assertEq(imageBlocks4.length, 2, 'both images produce image blocks (unmatched fallback works)')

const resources4 = doc4.resources
assertEq(resources4.length, 2, 'both images produce resources')
assert(
  resources4.some((r) => String(r.path || '').includes('fig-1-1')),
  'fig-1-1 resource present (matched via markdown)',
)
assert(
  resources4.some((r) => String(r.path || '').includes('fig-2-1')),
  'fig-2-1 resource present (unmatched fallback)',
)

// Verify unmatched image resource has correct metadata
const fig2Resource = resources4.find((r) => String(r.path || '').includes('fig-2-1'))
assertEq(
  fig2Resource?.metadata?.source as string,
  'paper-generation',
  'fig-2-1 resource.metadata.source = paper-generation',
)
assertEq(
  fig2Resource?.metadata?.caption as string,
  'Figure 2.1 method diagram',
  'fig-2-1 resource.metadata.caption preserved',
)

console.log()

// ── Case 5: renderDocumentCitationsForExport builds DocumentSchema ────────────

console.log('Case 5: renderDocumentCitationsForExport returns DocumentSchema with references section')

const exportedDoc5 = renderDocumentCitationsForExport(doc1)
const previewText5 = renderDocumentCitationsForPreview(doc1)

// Must return a DocumentSchema object (not an array)
assert(exportedDoc5 !== null && typeof exportedDoc5 === 'object' && !Array.isArray(exportedDoc5), 'renderDocumentCitationsForExport returns a DocumentSchema object')
assert(Array.isArray(exportedDoc5.blocks), 'exported document has blocks array')

// Must have a references-section heading
const refHeading5 = exportedDoc5.blocks.find((b) => b.type === 'heading' && b.metadata?.role === 'references-section')
assert(refHeading5 !== undefined, 'exported document has references-section heading')

// Must have the right number of reference paragraphs (one per bib item)
const refParas5 = exportedDoc5.blocks.filter((b) => b.type === 'paragraph' && b.metadata?.role === 'references-section')
assertEq(refParas5.length, 3, 'exported document has 3 reference paragraphs (one per bib item)')

// Reference paragraphs must be sorted by citation number and labelled [1] [2] [3]
assert(String((refParas5[0] as any).text || '').includes('[1]'), 'first ref para is [1]')
assert(String((refParas5[1] as any).text || '').includes('[2]'), 'second ref para is [2]')
assert(String((refParas5[2] as any).text || '').includes('[3]'), 'third ref para is [3]')

// Body blocks must be preserved (non-references-section)
const bodyBlocks5 = exportedDoc5.blocks.filter((b) => b.metadata?.role !== 'references-section')
assert(bodyBlocks5.length > 0, 'body blocks preserved in exported document')

// Preview still works on original (un-mutated) document
assert(previewText5.includes('[1]'), 'preview text includes [1]')
assert(previewText5.includes('[2]'), 'preview text includes [2]')
assert(previewText5.includes('[3]'), 'preview text includes [3]')

// If the input document already had a references-section, calling renderDocumentCitationsForExport
// again on the output should be idempotent (still exactly one heading + 3 paras)
const exportedDoc5b = renderDocumentCitationsForExport(exportedDoc5)
const refHeadings5b = exportedDoc5b.blocks.filter((b) => b.type === 'heading' && b.metadata?.role === 'references-section')
assertEq(refHeadings5b.length, 1, 'idempotent: exactly one references-section heading after double-render')
const refParas5b = exportedDoc5b.blocks.filter((b) => b.type === 'paragraph' && b.metadata?.role === 'references-section')
assertEq(refParas5b.length, 3, 'idempotent: still 3 reference paragraphs after double-render')

// Verify citationId consistency: every citationMark.citationId should match a bibliography item
const allMarksInDoc = doc1.blocks
  .flatMap((b) => (b.metadata?.citationMarks as DocumentCitationMark[] || []))
const bibIds = new Set((doc1.bibliography?.items || []).map((item) => item.id))
for (const mark of allMarksInDoc) {
  assert(
    bibIds.has(mark.citationId),
    `citationMark.citationId "${mark.citationId}" matches a bibliography item`,
  )
}

console.log()

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`[smoke:citations] ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
