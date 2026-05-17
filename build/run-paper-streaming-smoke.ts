import assert from 'node:assert/strict'
import { buildPaperGenerationPreviewContent } from '../src/engines/documentEngine/embeddedPaperDocument'
import { resolvePaperText } from '../src/services/PaperService'
import { resolveStreamingPreviewMarkdown } from '../src/services/paperStreaming'
import { normalizeDocumentResultMarkdown } from '../src/utils/documentResultNormalization'

function main(): void {
  const firstChunk = resolveStreamingPreviewMarkdown({ content: '第一段' })
  assert.equal(firstChunk, '第一段', '首个正文 chunk 应直接成为预览正文')

  const appendedChunk = resolveStreamingPreviewMarkdown({ content: '第二段' }, firstChunk)
  assert.equal(appendedChunk, '第一段第二段', '纯增量正文 chunk 应持续追加到上一版预览')

  const cumulativeChunk = resolveStreamingPreviewMarkdown({ cumulativeMarkdown: '第一段\n\n第二段\n\n第三段' }, appendedChunk)
  assert.equal(cumulativeChunk, '第一段\n\n第二段\n\n第三段', '当事件携带 cumulativeMarkdown 时，应优先使用累计正文')

  const structuredChunk = resolveStreamingPreviewMarkdown({
    structuredBlocks: [
      { type: 'heading', level: 1, text: '标题' },
      { type: 'paragraph', text: '结构化正文' },
    ],
  }, cumulativeChunk)
  assert.match(structuredChunk, /标题/, '结构化 block 应能还原出标题')
  assert.match(structuredChunk, /结构化正文/, '结构化 block 应能还原出正文')

  const resolvedFromSnapshot = resolvePaperText({
    ooxml_snapshot: {
      plainText: '来自 OOXML snapshot 的正文',
      html: '<p>不应优先取 HTML</p>',
    },
    paper_markdown: '旧 markdown',
    current_content: '旧回退文本',
  })
  assert.equal(resolvedFromSnapshot, '旧 markdown', '统一正文 helper 应优先保留 markdown，避免被 snapshot 降级')

  const resolvedFromStructuredBlocks = resolvePaperText({
    ooxml_snapshot: {
      plainText: '[图片占位: 方法分类与比较]',
      html: '<p><img src="file:///tmp/test.png" alt="方法分类与比较" /></p>',
    },
    structured_blocks: [
      { type: 'heading', level: 2, text: '插图章节' },
      { type: 'image', sourceId: 'file:///tmp/test.png', previewSrc: 'file:///tmp/test.png', alt: '方法分类与比较' },
    ],
  })
  assert.match(resolvedFromStructuredBlocks, /!\[方法分类与比较\]\(file:\/\/\/tmp\/test\.png\)/, '结构化 block 应优先还原真实图片 markdown')

  const previewContent = buildPaperGenerationPreviewContent('兼容 markdown', undefined, {
    html: '<p>来自流式 smoke test 的 OOXML HTML</p>',
    plainText: '来自流式 smoke test 的 OOXML 文本',
  })
  assert.equal(previewContent, '<p>来自流式 smoke test 的 OOXML HTML</p>', '预览构造应优先消费 OOXML snapshot HTML')

  const normalizedDocument = normalizeDocumentResultMarkdown(`
<think>内部推理</think>
任务要求：
1. 保留标题
2. 输出正文

# 合法标题

1. 合法编号
[1] 合法引用前缀
Figure 1. 合法图片 caption

第一段正文。

如需我继续修改，请告诉我。
`)
  assert.match(normalizedDocument, /^# 合法标题/m, '归一化后必须保留合法标题')
  assert.match(normalizedDocument, /^1\. 合法编号/m, '归一化后必须保留合法编号')
  assert.match(normalizedDocument, /^\[1\] 合法引用前缀/m, '归一化后必须保留合法引用前缀')
  assert.match(normalizedDocument, /^Figure 1\. 合法图片 caption/m, '归一化后必须保留图片 caption')
  assert.match(normalizedDocument, /第一段正文。/, '归一化后必须保留正文段落')
  assert.ok(!normalizedDocument.includes('任务要求'), '归一化后应去掉任务说明')
  assert.ok(!normalizedDocument.includes('如需我继续修改'), '归一化后应去掉尾部提示语')

  console.log('paper streaming smoke passed')
}

main()
