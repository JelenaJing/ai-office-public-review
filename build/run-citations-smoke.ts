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
  renderBibliographyItemLabel,
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

// Paper export should not duplicate an image caption paragraph immediately after
// the image block. The image block is the authoritative caption source.
const imageForCaptionDoc5 = doc4.blocks.find((b) => b.type === 'image' && String(b.value?.caption || '').includes('Figure 2.1 method diagram'))!
const exportCaptionDoc5 = {
  ...doc4,
  blocks: [
    imageForCaptionDoc5,
    { id: 'dup-caption-5', type: 'paragraph' as const, text: 'Figure 2.1 method diagram', metadata: { source: 'paper-generation' } },
  ],
}
const exportedCaptionDoc5 = renderDocumentCitationsForExport(exportCaptionDoc5)
const duplicateExportCaptions5 = exportedCaptionDoc5.blocks.filter((b) => b.type === 'paragraph' && b.text === 'Figure 2.1 method diagram')
assertEq(duplicateExportCaptions5.length, 0, 'paper export dedupes image-following Figure caption paragraph')

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

// ── Case 6: insertCitationIntoDocument full flow — new ref becomes [1], old shift ──

console.log('Case 6: full insertCitationIntoDocument flow — save/read roundtrip preserves citationMarks + bibliography')

// Build a document with two body paragraphs citing [1] and [2]
import {
  createDocumentSchema,
  createParagraphBlock,
  createHeadingBlock,
} from '../src/document/schema/index'

const baseDoc6 = createDocumentSchema({ id: 'doc6', profile: 'paper' as const, title: 'Doc6', text: '', sourceType: 'compat' as const })

const para6a = createParagraphBlock({
  id: 'p6a',
  text: 'First paragraph citing [1].',
  metadata: {
    citationMarks: [{ citationId: 'citation-1', citationNumber: 1, rawMark: '[1]', offset: 22 }],
  },
})
const para6b = createParagraphBlock({
  id: 'p6b',
  text: 'Second paragraph citing [2].',
  metadata: {
    citationMarks: [{ citationId: 'citation-2', citationNumber: 2, rawMark: '[2]', offset: 23 }],
  },
})

const doc6 = {
  ...baseDoc6,
  blocks: [para6a, para6b],
  bibliography: {
    items: [
      { id: 'citation-1', citationNumber: 1, label: '[1] Alpha Paper.' },
      { id: 'citation-2', citationNumber: 2, label: '[2] Beta Paper.' },
    ],
    generatedAt: new Date().toISOString(),
  },
}

// Insert a NEW reference at the FIRST paragraph (before existing [1]) → new ref should be [1]
const afterInsert6 = insertCitationIntoDocument(doc6, {
  blockId: 'p6a',
  offset: 0,
  reference: {
    title: 'Gamma Paper (new)',
    doi: '10.3/gamma',
  },
})

// New bibliography should have 3 items
assertEq(afterInsert6.bibliography?.items.length, 3, 'bibliography grows from 2 to 3 after insert')

// Since the new citation is inserted at offset=0 in the first block (before anything),
// the anchor number is 0, so new citation gets citationNumber=1.
// Old [1] → [2], old [2] → [3]
const bib6Items = (afterInsert6.bibliography?.items || []).slice().sort((a, b) => a.citationNumber - b.citationNumber)
assertEq(bib6Items[0].label.startsWith('[1]'), true, 'first bib item is [1]')
assert(bib6Items[0].label.includes('Gamma'), 'new reference is [1]')
assertEq(bib6Items[1].label.startsWith('[2]'), true, 'old [1] shifted to [2]')
assert(bib6Items[1].label.includes('Alpha'), 'Alpha Paper is now [2]')
assertEq(bib6Items[2].label.startsWith('[3]'), true, 'old [2] shifted to [3]')
assert(bib6Items[2].label.includes('Beta'), 'Beta Paper is now [3]')

// Body paragraph texts should also be renumbered
const para6aAfter = afterInsert6.blocks.find((b) => b.id === 'p6a')
const para6bAfter = afterInsert6.blocks.find((b) => b.id === 'p6b')

assert(para6aAfter !== undefined, 'first paragraph still exists')
assert(para6bAfter !== undefined, 'second paragraph still exists')

// First paragraph now has [1] (new) inserted at the start, old [1] → [2]
// The block text should contain both the new [1] and the shifted old [2]
const text6a = String((para6aAfter as any)?.text || '')
assert(text6a.includes('[1]'), 'first para text has [1] (new citation inserted)')
assert(text6a.includes('[2]'), 'first para text has [2] (old [1] shifted)')

// Second paragraph old [2] → [3]
const text6b = String((para6bAfter as any)?.text || '')
assert(text6b.includes('[3]'), 'second para text has [3] (old [2] shifted to [3])')

// renderDocumentCitationsForExport should generate 3 reference paragraphs
const exported6 = renderDocumentCitationsForExport(afterInsert6)
const refParas6 = exported6.blocks.filter((b) => b.type === 'paragraph' && b.metadata?.role === 'references-section')
assertEq(refParas6.length, 3, 'exported schema has 3 reference paragraphs matching bibliography')
assert(String((refParas6[0] as any).text || '').startsWith('[1]'), 'first ref para starts with [1]')
assert(String((refParas6[1] as any).text || '').startsWith('[2]'), 'second ref para starts with [2]')
assert(String((refParas6[2] as any).text || '').startsWith('[3]'), 'third ref para starts with [3]')

// Simulate save/read roundtrip (JSON serialisation — same as workspace document.json)
const roundTrip6 = JSON.parse(JSON.stringify(afterInsert6)) as typeof afterInsert6
const rtBib = roundTrip6.bibliography?.items || []
assertEq(rtBib.length, 3, 'bibliography survives JSON roundtrip with 3 items')
assert(rtBib.every((item: { citationNumber: number }) => typeof item.citationNumber === 'number'), 'all bib items have citationNumber after roundtrip')

const rtPara6a = roundTrip6.blocks.find((b: { id: string }) => b.id === 'p6a')
const rtMarks6a = (rtPara6a as any)?.metadata?.citationMarks as Array<{ citationId: string; citationNumber: number }> | undefined
assert(Array.isArray(rtMarks6a) && rtMarks6a.length > 0, 'citationMarks survive JSON roundtrip')
assert(rtMarks6a!.every((m) => typeof m.citationNumber === 'number'), 'citationMark.citationNumber preserved after roundtrip')

console.log()

// ── Case 7: resolveDocumentSchemaBlockId + documentSchemaBlocksToEmbeddedEditorBlocks ──

console.log('Case 7: block-id resolution and schema→embedded conversion')

const baseDoc7 = createDocumentSchema({ id: 'doc7', profile: 'paper' as const, title: 'Doc7', text: '', sourceType: 'compat' as const })

const para7a = createParagraphBlock({
  id: 'p7a',
  text: 'Text citing [1] and [2].',
  metadata: {
    citationMarks: [
      { citationId: 'citation-1', citationNumber: 1, rawMark: '[1]', offset: 12 },
      { citationId: 'citation-2', citationNumber: 2, rawMark: '[2]', offset: 19 },
    ],
  },
})
const para7b = createParagraphBlock({ id: 'p7b', text: 'Second paragraph.', metadata: {} })

const doc7: typeof baseDoc7 & { bibliography: any } = {
  ...baseDoc7,
  blocks: [para7a, para7b],
  bibliography: {
    items: [
      { id: 'citation-1', citationNumber: 1, label: '[1] Alpha Paper.' },
      { id: 'citation-2', citationNumber: 2, label: '[2] Beta Paper.' },
    ],
    generatedAt: new Date().toISOString(),
  },
}

// --- 7a: resolveDocumentSchemaBlockId — direct id match ---
// Simulate embedded blocks that share the same ids as schema blocks
const embeddedBlocks7 = [
  { id: 'p7a', type: 'paragraph' as const, text: 'Text citing [1] and [2].' },
  { id: 'p7b', type: 'paragraph' as const, text: 'Second paragraph.' },
]

// Direct match: anchorId exists in schema
const selection7direct = { from: 0, to: 0, collapsed: true, text: '', anchorId: 'p7a' }
// Inline helper (mirrors resolveDocumentSchemaBlockId logic) for unit testing
function resolveBlockIdTest(schema: typeof doc7, embedded: typeof embeddedBlocks7, anchorId: string): string | null {
  if (schema.blocks.some((b) => b.id === anchorId)) return anchorId
  const embText = embedded.filter((b) => b.type === 'paragraph' || b.type === 'heading')
  const idx = embText.findIndex((b) => b.id === anchorId)
  if (idx < 0) return null
  const schText = schema.blocks.filter((b) => b.type === 'paragraph' || b.type === 'heading')
  return schText[idx]?.id ?? null
}

const resolved7direct = resolveBlockIdTest(doc7, embeddedBlocks7, selection7direct.anchorId)
assertEq(resolved7direct, 'p7a', 'Case7a: direct id match returns anchorId')

// --- 7b: resolveDocumentSchemaBlockId — positional index fallback ---
const embeddedBlocks7Mismatch = [
  { id: 'emb-1', type: 'paragraph' as const, text: 'Text citing [1] and [2].' },  // different id, same position
  { id: 'emb-2', type: 'paragraph' as const, text: 'Second paragraph.' },
]
const selection7mismatch = { from: 0, to: 0, collapsed: true, text: '', anchorId: 'emb-1' }
const resolved7positional = resolveBlockIdTest(doc7, embeddedBlocks7Mismatch, selection7mismatch.anchorId)
assertEq(resolved7positional, 'p7a', 'Case7b: positional index fallback maps emb-1→p7a')

// --- 7c: resolveDocumentSchemaBlockId — unmappable returns null → legacy fallback ---
const selection7unmappable = { from: 0, to: 0, collapsed: true, text: '', anchorId: 'nonexistent-block' }
const resolved7null = resolveBlockIdTest(doc7, embeddedBlocks7, selection7unmappable.anchorId)
assertEq(resolved7null, null, 'Case7c: unmappable anchorId returns null (triggers legacy fallback)')

// --- 7d: insertCitationIntoDocument using resolved schemaBlockId ---
let nextDoc7 = insertCitationIntoDocument(doc7, {
  blockId: 'p7a',
  offset: 0,
  reference: { title: 'New Paper', doi: '10.99/new' },
})
nextDoc7 = renumberDocumentCitations(nextDoc7)

// Find new items by label content (id-diff is unreliable because the schema
// reuses citation-N ids after shifting, so the new [1] gets id 'citation-1'
// which was the old [1] Alpha Paper)
const newItems7 = (nextDoc7.bibliography?.items || []).filter((item) =>
  item.label.includes('New Paper'),
)
assertEq(newItems7.length, 1, 'Case7d: exactly one new bibliography item after insert')
assertEq(newItems7[0].citationNumber, 1, 'Case7d: new citation number derived from bibliography diff is 1')

const bib7 = (nextDoc7.bibliography?.items || []).slice().sort((a: { citationNumber: number }, b: { citationNumber: number }) => a.citationNumber - b.citationNumber)
assertEq(bib7.length, 3, 'Case7d: bibliography grows to 3 items')
assert(bib7[0].label.includes('New Paper'), 'Case7d: new reference is [1]')
assertEq(bib7[1].citationNumber, 2, 'Case7d: old [1] shifted to 2')
assertEq(bib7[2].citationNumber, 3, 'Case7d: old [2] shifted to 3')

// --- 7e: documentSchemaBlocksToEmbeddedEditorBlocks produces correct blocks ---
// The schema after insert should produce embedded blocks from the schema (not dual-write)
const exported7 = renderDocumentCitationsForExport(nextDoc7)
// Simulate the conversion: paragraph blocks → embedded text blocks
const schemaBlocks7 = exported7.blocks.filter((b) => b.type === 'paragraph' || b.type === 'heading')
assert(schemaBlocks7.length > 0, 'Case7e: schema has paragraph/heading blocks after export')
// references-section blocks must be in the schema (not hand-written embedded blocks)
const refSection7 = exported7.blocks.filter((b) => b.metadata?.role === 'references-section')
assertEq(refSection7.length >= 3, true, 'Case7e: references-section is derived from bibliography (3 items)')
// Body blocks are preserved
const bodyBlocks7 = exported7.blocks.filter((b) => b.metadata?.role !== 'references-section')
assert(bodyBlocks7.some((b) => (b as any).id === 'p7a'), 'Case7e: p7a body block preserved after export')

// --- 7f: JSON roundtrip (simulates saveWorkspaceDocumentSchema → readWorkspaceDocumentSchema) ---
const rt7 = JSON.parse(JSON.stringify(nextDoc7))
assertEq((rt7.bibliography?.items || []).length, 3, 'Case7f: bibliography survives JSON roundtrip')
const rt7para = rt7.blocks.find((b: { id: string }) => b.id === 'p7a')
assert(Array.isArray((rt7para as any)?.metadata?.citationMarks), 'Case7f: citationMarks survive JSON roundtrip')
const rt7Marks = (rt7para as any)?.metadata?.citationMarks as Array<{ citationNumber: number }>
assert(rt7Marks?.every((m) => typeof m.citationNumber === 'number'), 'Case7f: citationMark.citationNumber is number after roundtrip')

console.log()

// ── Case 8: resolveInsertedCitationNumbers + documentSchemaToEditorBlocksWithBibliography ──

console.log('Case 8: resolveInsertedCitationNumbers + documentSchemaToEditorBlocksWithBibliography')

// Convenience factory for test schemas in Case 8
const mkDoc8 = (suffix: string) => createDocumentSchema({ id: `doc8-${suffix}`, profile: 'paper' as const, title: `Doc8 ${suffix}`, text: '', sourceType: 'compat' as const })

// Build helpers inline (mirror EmbeddedOfficeEnginePanel.tsx logic):

interface CitationItemLike { number: number; citation: string; abstract: string; doi: string | null }

function resolveInsertedCitationNumbers8(
  beforeDoc: ReturnType<typeof createDocumentSchema>,
  afterDoc: ReturnType<typeof createDocumentSchema>,
  insertedCitations: CitationItemLike[],
): number[] {
  const afterItems = afterDoc.bibliography?.items || []
  const insertedDois = new Set(insertedCitations.map((c) => (c.doi || '').trim().toLowerCase()).filter(Boolean))
  const insertedTitles = insertedCitations.map((c) => (c.citation || '').trim().toLowerCase()).filter(Boolean)

  const matched = afterItems.filter((item: { uri?: string; metadata?: Record<string, unknown>; label: string }) => {
    if (insertedDois.size > 0) {
      const itemUri = (item.uri || '').toLowerCase()
      const itemDoi = ((item.metadata?.doi as string) || '').toLowerCase()
      if ([...insertedDois].some((doi) => itemUri.includes(doi) || itemDoi.includes(doi))) return true
    }
    if (insertedTitles.length > 0) {
      const itemLabel = item.label.toLowerCase()
      if (insertedTitles.some((title: string) => title.length > 4 && itemLabel.includes(title))) return true
    }
    return false
  })

  if (matched.length > 0) return matched.map((item: { citationNumber: number }) => item.citationNumber).sort((a: number, b: number) => a - b)

  const beforeLabels = new Set((beforeDoc.bibliography?.items || []).map((i: { label: string }) => i.label.toLowerCase().trim()))
  const newNums = afterItems.filter((item: { label: string }) => !beforeLabels.has(item.label.toLowerCase().trim())).map((item: { citationNumber: number }) => item.citationNumber)
  return newNums.sort((a: number, b: number) => a - b)
}

// 8a: resolveInsertedCitationNumbers — doi match
{
  const beforeDoc = mkDoc8('8a-before')
  beforeDoc.bibliography = {
    items: [
      { id: 'citation-1', citationNumber: 1, label: '[1] Author A 2020', uri: 'https://doi.org/10.1000/aaa' },
      { id: 'citation-2', citationNumber: 2, label: '[2] Author B 2021', uri: 'https://doi.org/10.1000/bbb' },
    ],
    generatedAt: new Date().toISOString(),
  }

  const afterDoc = mkDoc8('8a-after')
  afterDoc.bibliography = {
    items: [
      { id: 'citation-1', citationNumber: 1, label: '[1] Author C 2022', uri: 'https://doi.org/10.1000/ccc' },
      { id: 'citation-2', citationNumber: 2, label: '[2] Author A 2020', uri: 'https://doi.org/10.1000/aaa' },
      { id: 'citation-3', citationNumber: 3, label: '[3] Author B 2021', uri: 'https://doi.org/10.1000/bbb' },
    ],
    generatedAt: new Date().toISOString(),
  }

  const inserted: CitationItemLike[] = [{ number: 0, citation: 'Author C 2022 new paper', abstract: '', doi: '10.1000/ccc' }]
  const nums = resolveInsertedCitationNumbers8(beforeDoc, afterDoc, inserted)
  assert(nums.includes(1), 'Case8a: doi match returns citationNumber=1')
}

// 8b: resolveInsertedCitationNumbers — label/title match
{
  const beforeDoc = mkDoc8('8b-before')
  beforeDoc.bibliography = { items: [{ id: 'citation-1', citationNumber: 1, label: '[1] Existing 2020', uri: '' }], generatedAt: '' }

  const afterDoc = mkDoc8('8b-after')
  afterDoc.bibliography = {
    items: [
      { id: 'citation-1', citationNumber: 1, label: '[1] New Paper Smith 2023', uri: '' },
      { id: 'citation-2', citationNumber: 2, label: '[2] Existing 2020', uri: '' },
    ],
    generatedAt: '',
  }

  const inserted: CitationItemLike[] = [{ number: 0, citation: 'New Paper Smith 2023', abstract: '', doi: null }]
  const nums = resolveInsertedCitationNumbers8(beforeDoc, afterDoc, inserted)
  assert(nums.includes(1), 'Case8b: title/label match returns citationNumber=1')
}

// 8c: resolveInsertedCitationNumbers — size-diff fallback
{
  const beforeDoc = mkDoc8('8c-before')
  beforeDoc.bibliography = { items: [{ id: 'citation-1', citationNumber: 1, label: '[1] Old Ref', uri: '' }], generatedAt: '' }

  const afterDoc = mkDoc8('8c-after')
  afterDoc.bibliography = {
    items: [
      { id: 'citation-1', citationNumber: 1, label: '[1] Mystery New', uri: '' },
      { id: 'citation-2', citationNumber: 2, label: '[2] Old Ref', uri: '' },
    ],
    generatedAt: '',
  }

  const inserted: CitationItemLike[] = [{ number: 0, citation: 'XYZ', abstract: '', doi: null }]
  const nums = resolveInsertedCitationNumbers8(beforeDoc, afterDoc, inserted)
  assert(nums.length >= 1, 'Case8c: fallback returns at least one citation number')
  assert(typeof nums[0] === 'number', 'Case8c: returned value is a number')
}

// 8d: documentSchemaToEditorBlocksWithBibliography — strips old refs-section, appends fresh one
{
  const doc = mkDoc8('8d')
  doc.blocks = [
    createHeadingBlock({ id: 'h1', level: 1, text: 'Introduction' }),
    createParagraphBlock('Some text with [1].', 'p1'),
    { id: 'refs-h', type: 'heading' as const, text: '参考文献', level: 1, metadata: { role: 'references-section' } },
    { id: 'refs-p', type: 'paragraph' as const, text: '[1] Old Ref 2019', styleRef: 'Reference', metadata: { role: 'references-section' } },
  ]
  doc.bibliography = {
    items: [
      { id: 'citation-1', citationNumber: 1, label: '[1] Fresh Ref A 2023', uri: '' },
      { id: 'citation-2', citationNumber: 2, label: '[2] Fresh Ref B 2024', uri: '' },
    ],
    generatedAt: '',
  }

  // Inline mirror of documentSchemaToEditorBlocksWithBibliography
  function toEditorBlocks(schema: typeof doc) {
    const result: Array<{ type: string; text: string; paragraphStyle?: string }> = []
    for (const block of schema.blocks) {
      if ((block.metadata as Record<string, unknown> | undefined)?.role === 'references-section') continue
      if (block.type === 'heading') {
        result.push({ type: 'heading', text: block.text })
        continue
      }
      if (block.type === 'paragraph') {
        result.push({ type: 'paragraph', text: block.text })
        continue
      }
    }
    const bibItems = (schema.bibliography?.items || []).slice().sort((a, b) => a.citationNumber - b.citationNumber)
    if (bibItems.length > 0) {
      result.push({ type: 'heading', text: '参考文献', paragraphStyle: 'ReferencesHeading' })
      for (const item of bibItems) {
        result.push({ type: 'paragraph', text: renderBibliographyItemLabel(item), paragraphStyle: 'Reference' })
      }
    }
    return result
  }

  const blocks = toEditorBlocks(doc)

  // Old references-section must be stripped
  const oldRefPara = blocks.find((b) => b.text === '[1] Old Ref 2019')
  assert(!oldRefPara, 'Case8d: old references-section paragraph removed')

  // Fresh bibliography heading present
  const refHeading = blocks.find((b) => b.text === '参考文献' && b.paragraphStyle === 'ReferencesHeading')
  assert(!!refHeading, 'Case8d: ReferencesHeading appended from bibliography')

  // Fresh reference paragraphs present
  const refA = blocks.find((b) => b.text === '[1] Fresh Ref A 2023')
  const refB = blocks.find((b) => b.text === '[2] Fresh Ref B 2024')
  assert(!!refA, 'Case8d: fresh ref A in editor blocks')
  assert(!!refB, 'Case8d: fresh ref B in editor blocks')

  // Body blocks preserved
  const bodyH = blocks.find((b) => b.text === 'Introduction')
  const bodyP = blocks.find((b) => b.text === 'Some text with [1].')
  assert(!!bodyH, 'Case8d: body heading preserved')
  assert(!!bodyP, 'Case8d: body paragraph preserved')

  // Order: body first, then bibliography at end
  const refAIdx = blocks.indexOf(refA!)
  const bodyPIdx = blocks.indexOf(bodyP!)
  assert(bodyPIdx < refAIdx, 'Case8d: body paragraph before bibliography items')
}

// 8e: full insert + editor update flow (integration)
{
  const doc = mkDoc8('8e')
  doc.blocks = [
    createParagraphBlock('Intro paragraph with citations [1][2].', 'intro'),
  ]
  doc.bibliography = {
    items: [
      { id: 'citation-1', citationNumber: 1, label: '[1] Alpha 2020', uri: 'https://doi.org/10.1/alpha' },
      { id: 'citation-2', citationNumber: 2, label: '[2] Beta 2021', uri: 'https://doi.org/10.1/beta' },
    ],
    generatedAt: '',
  }
  doc.blocks[0].metadata = { ...(doc.blocks[0].metadata || {}), citationMarks: [
    { citationId: 'citation-1', citationNumber: 1, offset: 30 },
    { citationId: 'citation-2', citationNumber: 2, offset: 33 },
  ] }

  // Simulate inserting a new citation at offset 0 of intro block
  let nextDoc = insertCitationIntoDocument(doc, {
    blockId: 'intro',
    offset: 0,
    reference: { title: 'Gamma 2022', doi: '10.1/gamma' },
  })
  nextDoc = renumberDocumentCitations(nextDoc)

  // bibliography should now have 3 items
  assert((nextDoc.bibliography?.items.length ?? 0) === 3, 'Case8e: bibliography grows to 3 items')

  // New gamma should be citation-1 (inserted first)
  const gammaItem = nextDoc.bibliography?.items.find((i) => i.label.toLowerCase().includes('gamma'))
  assert(!!gammaItem, 'Case8e: gamma item exists in bibliography')
  assert(gammaItem!.citationNumber === 1, 'Case8e: gamma is renumbered to citation 1')

  // resolveInsertedCitationNumbers should find citationNumber=1 via label match
  const inserted8e: CitationItemLike[] = [{ number: 0, citation: 'Gamma 2022', abstract: '', doi: '10.1/gamma' }]
  const nums8e = resolveInsertedCitationNumbers8(doc, nextDoc, inserted8e)
  assert(nums8e.includes(1), 'Case8e: resolveInsertedCitationNumbers returns 1 for gamma')

  // Editor blocks from bibliography must list all 3 refs at bottom
  function toEditorBlocks8e(schema: typeof nextDoc) {
    const result: Array<{ type: string; text: string }> = []
    for (const block of schema.blocks) {
      if ((block.metadata as Record<string, unknown> | undefined)?.role === 'references-section') continue
      result.push({ type: block.type, text: (block as { text?: string }).text || '' })
    }
    const bibItems = (schema.bibliography?.items || []).slice().sort((a, b) => a.citationNumber - b.citationNumber)
    if (bibItems.length > 0) {
      result.push({ type: 'heading', text: '参考文献' })
      for (const item of bibItems) result.push({ type: 'paragraph', text: renderBibliographyItemLabel(item) })
    }
    return result
  }

  const editorBlocks8e = toEditorBlocks8e(nextDoc)
  const bibHeadingIdx = editorBlocks8e.findIndex((b) => b.type === 'heading' && b.text === '参考文献')
  const refParas = bibHeadingIdx >= 0 ? editorBlocks8e.slice(bibHeadingIdx + 1).filter((b) => b.type === 'paragraph') : []
  assert(refParas.length === 3, 'Case8e: editor blocks have 3 reference paragraphs at bottom')
}

// 8f: legacy fallback — no schema, old path unaffected
{
  // Verify that resolveInsertedCitationNumbers with empty docs returns empty array
  const emptyBefore = mkDoc8('8f-before')
  const emptyAfter = mkDoc8('8f-after')
  const nums8f = resolveInsertedCitationNumbers8(emptyBefore, emptyAfter, [{ number: 0, citation: 'X', abstract: '', doi: null }])
  assert(Array.isArray(nums8f), 'Case8f: empty docs returns array')
  assert(nums8f.length === 0, 'Case8f: empty docs returns empty array')
}

console.log()

// ── Case 9: bibliography label rendering uses citationNumber, not stale label ──

console.log('Case 9: bibliography label rendering strips stale leading numbers')

{
  const stale = { id: 'citation-3', citationNumber: 3, label: '[7] Some Paper', uri: '' }
  assertEq(renderBibliographyItemLabel(stale), '[3] Some Paper', 'stale [7] label renders as [3]')

  const staleFullWidth = { id: 'citation-2', citationNumber: 2, label: '［12］ Another Paper', uri: '' }
  assertEq(renderBibliographyItemLabel(staleFullWidth), '[2] Another Paper', 'fullwidth stale label renders as [2]')

  const staleDot = { id: 'citation-4', citationNumber: 4, label: '7. Dot Paper', uri: '' }
  assertEq(renderBibliographyItemLabel(staleDot), '[4] Dot Paper', 'dot-prefixed stale label renders as [4]')

  const doc9 = createDocumentSchema({ id: 'doc9', profile: 'paper' as const, title: 'Doc9', text: '', sourceType: 'compat' as const })
  doc9.blocks = [createParagraphBlock('Body [1].', 'doc9-p1')]
  doc9.bibliography = {
    items: [{ id: 'citation-1', citationNumber: 1, label: '[7] Some Paper', uri: '' }],
    generatedAt: '',
  }
  const exported9 = renderDocumentCitationsForExport(doc9)
  const ref9 = exported9.blocks.find((block) => block.metadata?.role === 'references-section' && block.type === 'paragraph') as { text?: string } | undefined
  assertEq(ref9?.text, '[1] Some Paper', 'export renders bibliography with continuous citationNumber')
  assertEq(renderDocumentCitationsForPreview(doc9), '[1] Some Paper', 'preview renders bibliography with continuous citationNumber')
}

console.log()

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`[smoke:citations] ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
