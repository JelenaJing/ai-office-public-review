/**
 * Paper Result Normalizer 冒烟测试
 *
 * 验证 paperResultNormalizer 的核心契约：
 *   1. generatePaperNFTCORE 模拟：正文/图片/引用都进入 DocumentSchema
 *   2. paperProjectRunner 分步链路：图片失败时能构造正确的 image_error 事件形态
 *   3. localTaskService.buildCompatTaskResult 等效逻辑：caption/markdown/url 不丢失
 *   4. DocumentSchema.citations 条目与参考文献数量一致
 *   5. scanMarkdownCitations 能正确解析 [1][2,3][4-6] 格式
 *
 * 运行: npm exec --yes --package tsx tsx build/run-paper-normalizer-smoke.ts
 */

import {
  normalizePaperGenerationResultToDocumentSchema,
  normalizeFigureToDocumentResource,
  scanMarkdownCitations,
  buildBibliographySourceRefs,
  type PaperGenerationResultLike,
  type PaperImageEntry,
} from '../electron/main/services/paperResultNormalizer'

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
  assert(actual === expected, `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`)
}

console.log('[smoke:paper-normalizer] start\n')

// ── Fixtures ─────────────────────────────────────────────────────────────────

const fakeReferences = [
  { id: 'r1', title: 'Deep Learning for NLP', year: 2023, journal: 'Nature', doi: '10.1000/test1', authors: ['A', 'B'], abstract: 'Abstract 1', url: '' },
  { id: 'r2', title: 'Transformer Architecture', year: 2022, journal: 'Science', doi: '10.1000/test2', authors: ['C'], abstract: 'Abstract 2', url: '' },
  { id: 'r3', title: 'Attention Mechanism Survey', year: 2021, journal: 'AI Review', doi: '', authors: ['D', 'E'], abstract: 'Abstract 3', url: 'https://example.com/paper3' },
]

const fakeImages: PaperImageEntry[] = [
  {
    section: '2',
    sectionTitle: '实验方法',
    path: '/workspace/images/fig-2-1.png',
    caption: 'Figure 2.1 实验流程示意图.',
    markdown: '\n\n![Figure 2.1](/workspace/images/fig-2-1.png)\n\n**Figure 2.1 实验流程示意图.**\n\n',
    url: 'file:///workspace/images/fig-2-1.png',
  },
]

const fakeMarkdown = `# 深度学习在自然语言处理中的应用

## 摘要

本文研究了深度学习技术在 NLP 领域的最新进展 [1]。

## 引言

近年来，Transformer 架构 [2] 已成为 NLP 的主流方法。注意力机制 [3] 是其核心组件。

## 实验方法

本文采用以下实验设计方法 [1, 2]。

![Figure 2.1](file:///workspace/images/fig-2-1.png)

**Figure 2.1 实验流程示意图.**

## 结论

综上所述，本研究验证了深度学习在 NLP 中的有效性 [1][3]。

## 参考文献

[1] Deep Learning for NLP (2023)
[2] Transformer Architecture (2022)
[3] Attention Mechanism Survey (2021)
`

const fakePaperResult: PaperGenerationResultLike = {
  title: '深度学习在自然语言处理中的应用',
  markdown: fakeMarkdown,
  references: fakeReferences,
  images: fakeImages,
}

// ── Case 1: normalizePaperGenerationResultToDocumentSchema ───────────────────

console.log('Case 1: normalizePaperGenerationResultToDocumentSchema')

const schema = normalizePaperGenerationResultToDocumentSchema(fakePaperResult, {
  documentId: 'smoke-test-doc-1',
  blockIdPrefix: 'smoke-block',
})

assert(schema.id === 'smoke-test-doc-1', 'documentSchema.id preserved from options')
assertEq(schema.profile, 'paper', 'documentSchema.profile = paper')
assert(schema.meta.title === '深度学习在自然语言处理中的应用', 'documentSchema.meta.title matches result.title')
assert(Array.isArray(schema.blocks), 'documentSchema.blocks is array')
assert(schema.blocks.length > 0, 'documentSchema.blocks is non-empty')
assert(Array.isArray(schema.resources), 'documentSchema.resources is array')
assert(Array.isArray(schema.citations), 'documentSchema.citations is array')
assert((schema.citations?.length ?? 0) === 3, `documentSchema.citations has 3 entries (got ${schema.citations?.length})`)

// Check that bibliography entries have proper kind and label
const cit0 = schema.citations?.[0]
assert(cit0?.kind === 'citation', 'citations[0].kind = citation')
assert(cit0?.id === 'citation-1', 'citations[0].id = citation-1')
assert(typeof cit0?.label === 'string' && cit0.label.startsWith('[1]'), 'citations[0].label starts with [1]')
assert(cit0?.uri === 'https://doi.org/10.1000/test1', 'citations[0].uri uses doi')
assert((cit0?.metadata as Record<string, unknown>)?.citationNumber === 1, 'citations[0].metadata.citationNumber = 1')

// Ref without DOI should fall back to url
const cit2 = schema.citations?.[2]
assert(cit2?.uri === 'https://example.com/paper3', 'citations[2].uri falls back to ref.url when no doi')

// Check that blocks contain headings
const headingBlocks = schema.blocks.filter((b) => b.type === 'heading')
assert(headingBlocks.length >= 4, `at least 4 heading blocks (got ${headingBlocks.length})`)

// Check that there is at least one image block (matched from markdown)
const imageBlocks = schema.blocks.filter((b) => b.type === 'image')
assert(imageBlocks.length >= 1, `at least 1 image block (got ${imageBlocks.length})`)

// Check that resources matches image count
assertEq(schema.resources.length, imageBlocks.length, 'resources.length = imageBlocks.length')

// Check DocumentResource metadata fields
const res0 = schema.resources[0]
assert(res0 !== undefined, 'resources[0] exists')
if (res0) {
  assertEq(res0.kind, 'image', 'resources[0].kind = image')
  assert(typeof res0.path === 'string' && res0.path.length > 0, 'resources[0].path is non-empty')
  assert(res0.metadata?.['source'] === 'paper-generation', 'resources[0].metadata.source = paper-generation')
  assert(typeof res0.metadata?.['caption'] === 'string', 'resources[0].metadata.caption is string')
  assert(typeof res0.metadata?.['sectionTitle'] === 'string', 'resources[0].metadata.sectionTitle is string')
  assert(typeof res0.metadata?.['figureIndex'] === 'number', 'resources[0].metadata.figureIndex is number')
  assert(typeof res0.metadata?.['alt'] === 'string', 'resources[0].metadata.alt is string')
}

console.log()

// ── Case 2: normalizeFigureToDocumentResource (FigureInfo) ───────────────────

console.log('Case 2: normalizeFigureToDocumentResource')

const fig = {
  sectionNum: 3,
  sectionTitle: '理论分析',
  figureIndex: 1,
  localPath: '/workspace/images/fig-3-1.png',
  url: 'file:///workspace/images/fig-3-1.png',
  caption: 'Figure 3.1 理论机制示意图.',
  markdown: '![Figure 3.1](file:///workspace/images/fig-3-1.png)\n\n**Figure 3.1 理论机制示意图.**',
}

const { resource, block } = normalizeFigureToDocumentResource(fig, { blockIdPrefix: 'test-block', blockIndex: 5 })

assertEq(resource.id, 'resource-image-s3-f1', 'resource.id = resource-image-s3-f1')
assertEq(resource.kind, 'image', 'resource.kind = image')
assertEq(resource.path, '/workspace/images/fig-3-1.png', 'resource.path = localPath')
assertEq(resource.metadata?.['source'] as string, 'paper-generation', 'resource.metadata.source = paper-generation')
assertEq(resource.metadata?.['caption'] as string, 'Figure 3.1 理论机制示意图.', 'resource.metadata.caption preserved')
assertEq(resource.metadata?.['sectionTitle'] as string, '理论分析', 'resource.metadata.sectionTitle preserved')
assertEq(resource.metadata?.['figureIndex'] as number, 1, 'resource.metadata.figureIndex = 1')
assertEq(resource.metadata?.['sectionNum'] as number, 3, 'resource.metadata.sectionNum = 3')

assertEq(block.type, 'image', 'block.type = image')
assert('resourceRef' in block && (block as { resourceRef: string }).resourceRef === 'resource-image-s3-f1', 'block.resourceRef matches resource.id')
const imgBlock = block as { value?: { caption?: string; alt?: string } }
assert(imgBlock.value?.caption === 'Figure 3.1 理论机制示意图.', 'block.value.caption preserved')
assert(imgBlock.value?.alt === 'Figure 3.1 理论机制示意图.', 'block.value.alt preserved')

console.log()

// ── Case 3: scanMarkdownCitations ────────────────────────────────────────────

console.log('Case 3: scanMarkdownCitations')

const citations3a = scanMarkdownCitations('研究表明 [1] 方法有效。另见 [2, 3] 综述。')
assert(citations3a.length === 3, `[1][2,3] → 3 numbers (got ${citations3a.length})`)
assert(citations3a[0] === 1 && citations3a[1] === 2 && citations3a[2] === 3, '[1,2,3] sorted')

const citations3b = scanMarkdownCitations('见 [4-6] 和 [10] 章节。')
assert(citations3b.includes(4) && citations3b.includes(5) && citations3b.includes(6) && citations3b.includes(10), '[4-6][10] parsed')

const citations3c = scanMarkdownCitations('无引用文本。')
assertEq(citations3c.length, 0, 'no citations → empty array')

const citations3d = scanMarkdownCitations('')
assertEq(citations3d.length, 0, 'empty markdown → empty array')

// Deduplication
const citations3e = scanMarkdownCitations('[1] and [1] again [2]')
assertEq(citations3e.length, 2, 'duplicates deduplicated')

console.log()

// ── Case 4: buildBibliographySourceRefs ──────────────────────────────────────

console.log('Case 4: buildBibliographySourceRefs')

const refs4 = buildBibliographySourceRefs(fakeReferences)
assertEq(refs4.length, 3, 'refs4.length = 3')
assertEq(refs4[0].id, 'citation-1', 'refs4[0].id = citation-1')
assertEq(refs4[0].kind, 'citation', 'refs4[0].kind = citation')
assert(refs4[0].label?.startsWith('[1]'), 'refs4[0].label starts with [1]')
assertEq(refs4[2].uri, 'https://example.com/paper3', 'refs4[2].uri uses url fallback for no-doi ref')
assert((refs4[0].metadata?.['authors'] as string[])?.length === 2, 'refs4[0].metadata.authors preserved')
assertEq(refs4[0].metadata?.['year'] as number, 2023, 'refs4[0].metadata.year = 2023')

// Empty input
const refs4empty = buildBibliographySourceRefs([])
assertEq(refs4empty.length, 0, 'empty refs → empty array')

console.log()

// ── Case 5: paperProjectRunner image_error event shape ───────────────────────

console.log('Case 5: image_error event shape (paperProjectRunner catch block contract)')

// Simulate what the fixed catch block produces
function simulateImageErrorEvent(
  projectId: string,
  sectionIndex: number,
  sectionTitle: string,
  error: Error,
): Record<string, unknown> {
  const errMsg = error instanceof Error ? error.message : String(error)
  return {
    scope: 'paper-section',
    type: 'image_error',
    projectId,
    sectionIndex,
    sectionTitle,
    message: errMsg,
  }
}

const errorEvent = simulateImageErrorEvent('proj-123', 2, '实验方法', new Error('API timeout'))
assertEq(errorEvent['scope'] as string, 'paper-section', 'image_error.scope = paper-section')
assertEq(errorEvent['type'] as string, 'image_error', 'image_error.type = image_error')
assertEq(errorEvent['sectionTitle'] as string, '实验方法', 'image_error.sectionTitle preserved')
assertEq(errorEvent['message'] as string, 'API timeout', 'image_error.message = error.message')
assert('sectionIndex' in errorEvent, 'image_error contains sectionIndex')

console.log()

// ── Case 6: localTaskService buildCompatTaskResult equivalent ─────────────────

console.log('Case 6: buildCompatTaskResult figures mapping (localTaskService bug fixes)')

type CompatImageItem = {
  path?: string
  url?: string
  caption?: string
  section?: string
  markdown?: string
}

function buildCompatFigures(images: CompatImageItem[]) {
  return images.map((item) => ({
    url: item.url || item.path,
    image_url: item.url || item.path,
    path: item.path,
    caption: item.caption || '',
    markdown: item.markdown || (item.url || item.path
      ? `![${item.caption || 'figure'}](${item.url || item.path})`
      : ''),
    filename: String(item.path || item.url || '').split(/[\\/]/).pop(),
  }))
}

// Full data
const img1 = buildCompatFigures([{
  path: '/workspace/images/fig-1-1.png',
  url: 'file:///workspace/images/fig-1-1.png',
  caption: 'Figure 1.1 实验装置示意图.',
  markdown: '![Figure 1.1](file:///workspace/images/fig-1-1.png)\n\n**Figure 1.1**',
  section: '实验装置',
}])[0]

assertEq(img1.caption, 'Figure 1.1 实验装置示意图.', 'caption uses item.caption when present')
assertEq(img1.url, 'file:///workspace/images/fig-1-1.png', 'url uses item.url first (not item.path)')
assert(img1.markdown.includes('file:///workspace'), 'markdown uses item.markdown directly')
assertEq(img1.filename, 'fig-1-1.png', 'filename extracted from path')

// Falls back: no caption → empty caption (section is placement metadata, not caption)
const img2 = buildCompatFigures([{
  path: '/workspace/images/fig-2-1.png',
  section: '实验方法',
}])[0]

assertEq(img2.caption, '', 'caption does not fall back to item.section')
assertEq(img2.url, '/workspace/images/fig-2-1.png', 'url falls back to path when no url')
assert(img2.markdown.includes('/workspace/images/fig-2-1.png'), 'markdown built from path when no explicit markdown')

// No path, no url
const img3 = buildCompatFigures([{ caption: 'Orphan' }])[0]
assertEq(img3.markdown, '', 'empty markdown when no path/url')

console.log()

// ── Case 7: section-anchored unmatched paper images + caption dedupe ───────────

console.log('Case 7: section-anchored images and caption dedupe')

const sectionImageResult = normalizePaperGenerationResultToDocumentSchema({
  title: '三章节论文',
  markdown: `# 三章节论文

## 第一章 绪论

第一章正文 [1]。

## 第二章 方法

第二章第一段。

第二章第二段。

## 第三章 结果

第三章正文。

## 参考文献

[1] Ref One`,
  references: [{ id: 'r1', title: 'Ref One', year: 2024, journal: '', doi: '', authors: [], abstract: '', url: '' }],
  images: [
    { section: '1', sectionTitle: '绪论', path: '/tmp/paper/fig-1.png', caption: 'Figure 1.1 Intro.' },
    { section: '2', sectionTitle: '方法', path: '/tmp/paper/fig-2.png', caption: 'Figure 2.1 Method.' },
    { section: '3', sectionTitle: '结果', path: '/tmp/paper/fig-3.png', caption: 'Figure 3.1 Result.' },
  ],
}, { documentId: 'section-images', blockIdPrefix: 'section-img' })

const sectionImageBlocks = sectionImageResult.blocks.filter((block) => block.type === 'image')
assertEq(sectionImageBlocks.length, 3, 'three unmatched images are still represented as image blocks')
assert(sectionImageBlocks.every((block) => block.metadata?.placementFallback !== true), 'all section images placed by section anchors, not fallback')
assertEq(sectionImageResult.document.metadata?.imagePlacementMode as string, 'section-anchor', 'imagePlacementMode = section-anchor')
assertEq(sectionImageResult.document.metadata?.unmatchedImageCount as number, 3, 'unmatchedImageCount = 3')
assertEq(sectionImageResult.document.metadata?.fallbackImageCount as number, 0, 'fallbackImageCount = 0')

const firstRefsIndex = sectionImageResult.blocks.findIndex((block) => block.metadata?.role === 'references-section')
const lastImageIndex = Math.max(...sectionImageResult.blocks.map((block, index) => block.type === 'image' ? index : -1))
assert(firstRefsIndex < 0 || lastImageIndex < firstRefsIndex, 'section images are not appended after references section')

const captionDeduped = normalizePaperGenerationResultToDocumentSchema({
  title: 'Caption Dedupe',
  markdown: `# Caption Dedupe

## 方法

正文。

![Figure 5.1](/tmp/paper/fig-5.png)

**Figure 5.1 Repeated caption.**

**Figure 5.1 Repeated caption.**`,
  references: [],
  images: [{ section: '5', sectionTitle: '方法', path: '/tmp/paper/fig-5.png', caption: 'Figure 5.1 Repeated caption.' }],
}, { documentId: 'caption-dedupe', blockIdPrefix: 'caption-dedupe' })

const captionParagraphs = captionDeduped.blocks.filter((block) => block.type === 'paragraph' && block.metadata?.role === 'figure-caption')
assertEq(captionParagraphs.length, 0, 'markdown Figure caption after image is merged into image block, not duplicated as paragraph')
const captionImage = captionDeduped.blocks.find((block) => block.type === 'image') as any
assertEq(captionImage?.value?.caption, 'Figure 5.1 Repeated caption.', 'image block keeps the single authoritative caption')

console.log()

// ── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n[smoke:paper-normalizer] ${passed} passed, ${failed} failed`)

if (failed > 0) {
  process.exit(1)
}
