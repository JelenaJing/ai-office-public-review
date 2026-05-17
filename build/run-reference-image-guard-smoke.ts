import assert from 'node:assert/strict'
import { extractReferenceParagraphs } from '../electron/main/services/referenceManager'

function main(): void {
  const markdown = [
    '# Sample Paper',
    '',
    '这一段是正常正文，用于说明图像识别模型在复杂场景下的鲁棒性提升，并且包含足够长度，应该继续参与引用分析流程而不是被过滤掉。',
    '',
    '![Figure 1.1](file:///C:/Users/test/AppData/Local/Temp/generated/image-123.png)',
    '',
    '**Figure 1.1 Multimodal generation workflow for the experimental pipeline and output verification path.**',
    '',
    '| Model | Accuracy |',
    '| --- | --- |',
    '| A | 91% |',
    '',
    'The second narrative paragraph discusses evaluation stability across repeated runs and should remain eligible for citation insertion after structured blocks are removed.',
  ].join('\n')

  const paragraphs = extractReferenceParagraphs(markdown)

  assert.equal(paragraphs.length, 2, '结构化图片或表格段落未被正确过滤')
  assert.ok(
    paragraphs.every((item) => !item.original.includes('file:///') && !item.original.includes('Figure 1.1') && !item.original.includes('| Model |')),
    '图片 markdown、图注或表格仍进入了引用整理候选段落',
  )
  assert.match(paragraphs[0]?.original || '', /正常正文/)
  assert.match(paragraphs[1]?.original || '', /second narrative paragraph/i)

  console.log('reference image guard smoke passed')
}

main()