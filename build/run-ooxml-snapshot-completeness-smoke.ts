import assert from 'node:assert/strict'
import { buildGeneratedOoxmlSnapshot } from '../electron/main/services/generatedOoxmlSnapshot'
import { parsePaperMarkdownToEmbeddedBlocks, serializeEmbeddedBlocksToMarkdown, extractPaperTextFromOoxmlSnapshot, extractPaperHtmlFromOoxmlSnapshot } from '../src/engines/documentEngine/embeddedPaperDocument'

function extractAttributeValues(html: string, attributeName: string): string[] {
  const pattern = new RegExp(`${attributeName}="([^"]*)"`, 'g')
  return Array.from(String(html || '').matchAll(pattern)).map((match) => match[1])
}

async function main(): Promise<void> {
  const sourceMarkdown = `# 测试标题

## 摘要 这是测试摘要内容，用于验证 OOXML 快照的完整性。

## 关键词：测试；OOXML；快照

# 引言

这是引言段落，包含**加粗**和*斜体*文本。

# 方法

这是方法段落。

## 实验设计

这是实验设计段落。

# 结论

这是结论段落。

## 参考文献

[1] Alice Smith, Bob Lee (2024). Example Reference One. Journal of Testing. DOI: https://doi.org/10.1000/example-1
[2] Carol Wang (2023). Example Reference Two. Journal of Snapshots. DOI: https://doi.org/10.1000/example-2`

  // 1. 从 markdown 生成 structuredBlocks
  const structuredBlocks = parsePaperMarkdownToEmbeddedBlocks(sourceMarkdown, { references: [] })
  assert.ok(Array.isArray(structuredBlocks) && structuredBlocks.length > 0, '应能从 markdown 生成 structuredBlocks')

  // 2. 从 structuredBlocks 生成 OOXML 快照
  const ooxmlSnapshot = await buildGeneratedOoxmlSnapshot(structuredBlocks as never)
  assert.ok(ooxmlSnapshot, '应能生成 OOXML 快照')
  assert.ok(typeof ooxmlSnapshot === 'object', 'OOXML 快照应为对象')

  // 3. 验证 OOXML 快照包含必要字段
  const snapshotKeys = Object.keys(ooxmlSnapshot)
  assert.ok(snapshotKeys.includes('documentXml'), 'OOXML 快照应包含 documentXml')
  assert.ok(snapshotKeys.includes('plainText'), 'OOXML 快照应包含 plainText')
  assert.ok(snapshotKeys.includes('html'), 'OOXML 快照应包含 html')

  // 4. 验证 plainText 提取
  const plainText = extractPaperTextFromOoxmlSnapshot(ooxmlSnapshot as unknown as Record<string, unknown>)
  assert.ok(typeof plainText === 'string' && plainText.length > 0, '应能从 OOXML 快照提取 plainText')
  assert.match(plainText, /测试标题/, 'plainText 应包含标题')
  assert.match(plainText, /测试摘要/, 'plainText 应包含摘要')
  assert.match(plainText, /引言段落/, 'plainText 应包含正文')

  // 5. 验证 HTML 提取
  const html = extractPaperHtmlFromOoxmlSnapshot(ooxmlSnapshot as unknown as Record<string, unknown>)
  assert.ok(typeof html === 'string' && html.length > 0, '应能从 OOXML 快照提取 HTML')
  assert.match(html, /测试标题/, 'HTML 应包含标题内容')
  assert.match(html, /测试摘要/, 'HTML 应包含摘要内容')

  // 6. 多次往返稳定性测试：structuredBlocks -> markdown -> structuredBlocks -> markdown
  const markdown1 = serializeEmbeddedBlocksToMarkdown(structuredBlocks)
  const blocks2 = parsePaperMarkdownToEmbeddedBlocks(markdown1, { references: [] })
  const markdown2 = serializeEmbeddedBlocksToMarkdown(blocks2)

  assert.equal(markdown1, markdown2, '经过一次往返后 markdown 应保持一致')

  // 7. 验证多次 OOXML 快照生成的稳定性
  const snapshot1 = await buildGeneratedOoxmlSnapshot(structuredBlocks as never)
  const snapshot2 = await buildGeneratedOoxmlSnapshot(blocks2 as never)

  const text1 = extractPaperTextFromOoxmlSnapshot(snapshot1 as unknown as Record<string, unknown>)
  const text2 = extractPaperTextFromOoxmlSnapshot(snapshot2 as unknown as Record<string, unknown>)
  const html1 = extractPaperHtmlFromOoxmlSnapshot(snapshot1 as unknown as Record<string, unknown>)
  const html2 = extractPaperHtmlFromOoxmlSnapshot(snapshot2 as unknown as Record<string, unknown>)

  // 比较文本内容应该在语义上保持一致；忽略空白与 markdown heading 标记差异。
  const normalizeWhitespace = (s: string) => s.replace(/\s+/g, ' ').trim()
  const normalizeSnapshotText = (s: string) => normalizeWhitespace(s).replace(/(^|\s)#{1,6}\s+/g, '$1').trim()
  assert.equal(
    normalizeSnapshotText(text1),
    normalizeSnapshotText(text2),
    '多次生成的 OOXML 快照 plainText 应保持一致'
  )

  // HTML 也应该在主要内容上保持一致
  assert.ok(
    html1.includes('测试标题') && html2.includes('测试标题'),
    '多次生成的 HTML 应包含相同内容'
  )
  assert.match(text1, /参考文献/, '首次生成的 plainText 应包含参考文献标题')
  assert.match(text2, /参考文献/, '往返后的 plainText 应包含参考文献标题')
  assert.match(text1, /Alice Smith/, '首次生成的 plainText 应包含参考文献条目')
  assert.match(text2, /Alice Smith/, '往返后的 plainText 应包含参考文献条目')
  assert.match(markdown2, /## 参考文献/, '往返后的 markdown 应保留参考文献标题')
  assert.match(markdown2, /\[1\] Alice Smith/, '往返后的 markdown 应保留参考文献条目')

  // 8. 验证 OOXML 快照可序列化
  let serialized: string
  try {
    serialized = JSON.stringify(ooxmlSnapshot)
    assert.ok(serialized.length > 0, 'OOXML 快照应可序列化为 JSON')
  } catch (error) {
    assert.fail('OOXML 快照序列化失败')
  }

  // 9. 验证反序列化后仍可正常提取内容
  const deserialized = JSON.parse(serialized)
  const deserializedText = extractPaperTextFromOoxmlSnapshot(deserialized)
  const deserializedHtml = extractPaperHtmlFromOoxmlSnapshot(deserialized)

  assert.ok(deserializedText.length > 0, '反序列化后应仍能提取 plainText')
  assert.ok(deserializedHtml.length > 0, '反序列化后应仍能提取 HTML')
  assert.match(deserializedText, /测试标题/, '反序列化后 plainText 应包含正确内容')

  // 10. 验证空内容处理
  const emptyBlocks = parsePaperMarkdownToEmbeddedBlocks('', { references: [] })
  const emptySnapshot = await buildGeneratedOoxmlSnapshot(emptyBlocks as never)
  const emptyText = extractPaperTextFromOoxmlSnapshot(emptySnapshot as unknown as Record<string, unknown>)

  assert.equal(typeof emptyText, 'string', '空内容应返回空字符串而非 undefined')

  // 11. 验证多图片 roundtrip 不会把不同图片压成同一个 sourceId
  const imageBlocks = [
    {
      type: 'image',
      alt: 'Figure 1',
      title: 'Figure 1',
      sourceId: '/tmp/generated_20260314_183613_1127d575.png',
      previewSrc: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mP8z8BQDwAFgwJ/l7h7WQAAAABJRU5ErkJggg==',
    },
    {
      type: 'image',
      alt: 'Figure 2',
      title: 'Figure 2',
      sourceId: '/tmp/generated_20260314_184102_f312b389.png',
      previewSrc: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mNkYPj/HwADAgH/5ncLrgAAAABJRU5ErkJggg==',
    },
  ]
  const imageSnapshot = await buildGeneratedOoxmlSnapshot(imageBlocks as never)
  assert.ok(imageSnapshot, '多图片场景应能生成 OOXML 快照')
  const imageHtml = extractPaperHtmlFromOoxmlSnapshot(imageSnapshot as unknown as Record<string, unknown>)
  const sourceIds = extractAttributeValues(imageHtml, 'data-source-id')
  const previewSrcs = extractAttributeValues(imageHtml, 'data-preview-src')
  assert.equal(sourceIds.length, 2, '多图片快照应包含两个图片 sourceId')
  assert.equal(previewSrcs.length, 2, '多图片快照应包含两个图片 previewSrc')
  assert.equal(new Set(sourceIds).size, 2, '多图片 roundtrip 后每张图都应保留独立 sourceId')
  assert.equal(new Set(previewSrcs).size, 2, '多图片 roundtrip 后每张图都应保留独立 previewSrc')

  console.log(
    JSON.stringify(
      {
        ok: true,
        ooxmlSnapshotFields: snapshotKeys,
        plainTextLength: plainText.length,
        htmlLength: html.length,
        roundtripMarkdownConsistent: markdown1 === markdown2,
        roundtripTextConsistent: normalizeWhitespace(text1) === normalizeWhitespace(text2),
        serializableSnapshot: true,
        emptyContentHandled: typeof emptyText === 'string',
        imageRoundtripDistinct: true,
      },
      null,
      2
    )
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
