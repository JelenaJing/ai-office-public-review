import fs from 'node:fs/promises'
import path from 'node:path'
import { generatePaper } from '../electron/main/services/paperGenerator'
import type { EmbeddedPayloadBlock, EmbeddedPayloadTextBlock } from '../src/engines/documentEngine/embeddedPaperDocument'
import { hydrateQwenEnv, QWEN_DEFAULT_BASE_URL, QWEN_DEFAULT_MODEL, QWEN_DEFAULT_PROVIDER } from './qwenDefaults'

type Snapshot = {
  step: number
  message: string
  mainHeadingCount: number
  prefixBlocks: Array<Record<string, unknown>>
  blockCount: number
  markdownLength: number
}

function isSpecialHeading(text: string): boolean {
  return /^(摘要|abstract|关键词|关键字|keywords?|参考文献|references|脚注|footnotes?|结论|conclusion|讨论|discussion)$/i.test(text.trim())
}

function isTextBlock(block: EmbeddedPayloadBlock): block is EmbeddedPayloadTextBlock {
  return block.type === 'paragraph' || block.type === 'heading'
}

function getMainHeadingCount(blocks: EmbeddedPayloadBlock[]): number {
  return blocks.filter((block) => block.type === 'heading' && !isSpecialHeading(String(block.text || ''))).length
}

function summarizeBlock(block: EmbeddedPayloadBlock): Record<string, unknown> {
  if (isTextBlock(block)) {
    return {
      type: block.type,
      text: block.text,
      level: block.level,
      paragraphStyle: block.paragraphStyle,
      alignment: block.alignment,
      semanticRole: block.semanticRole,
    }
  }
  if (block.type === 'table') {
    return { type: block.type, rows: block.rows, cols: block.cols, caption: block.caption || '' }
  }
  if (block.type === 'image') {
    return { type: block.type, alt: block.alt, caption: block.caption || '' }
  }
  if (block.type === 'formula') {
    return { type: block.type, display: block.display, latex: block.latex }
  }
  if (block.type === 'reference-list' || block.type === 'footnote-list') {
    return { type: block.type, heading: block.heading || '', count: block.items.length }
  }
  return { type: block.type, text: 'text' in block ? block.text : '' }
}

function summarizeStyle(block: Record<string, unknown>): Record<string, unknown> {
  return {
    type: block.type,
    level: block.level,
    paragraphStyle: block.paragraphStyle,
    alignment: block.alignment,
    semanticRole: block.semanticRole,
    rows: block.rows,
    cols: block.cols,
    heading: block.heading,
    count: block.count,
  }
}

function extractStablePrefix(blocks: EmbeddedPayloadBlock[]): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = []
  let firstMainHeadingSeen = false

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (!isTextBlock(block)) {
      if (firstMainHeadingSeen) {
        result.push(summarizeBlock(block))
      }
      continue
    }

    const text = String(block.text || '').trim()
    const isMainHeading = block.type === 'heading' && !isSpecialHeading(text)
    if (isMainHeading && !firstMainHeadingSeen) {
      firstMainHeadingSeen = true
      result.push(summarizeBlock(block))
      continue
    }

    if (isMainHeading && firstMainHeadingSeen) {
      break
    }

    const shouldKeep = !firstMainHeadingSeen
      || block.type === 'paragraph'
      || /^(caption|footnote)$/i.test(String(block.paragraphStyle || ''))

    if (shouldKeep) {
      result.push(summarizeBlock(block))
    }
  }

  return result
}

async function main(): Promise<void> {
  const rootDir = process.cwd()
  const topic = process.env.AI_WRITER_TEST_TOPIC || '多模态大语言模型在学术写作辅助中的应用进展'
  const language = process.env.AI_WRITER_TEST_LANGUAGE === 'en' ? 'en' : 'zh'
  const builtin = hydrateQwenEnv(rootDir)

  const settings = {
    llm: {
      provider: QWEN_DEFAULT_PROVIDER,
      apiKey: String(builtin.qwenApiKey || '').trim(),
      useBuiltinKey: false,
      builtinKeyAvailable: true,
      model: QWEN_DEFAULT_MODEL,
      baseUrl: QWEN_DEFAULT_BASE_URL,
    },
    image: {
      provider: 'nanobanana',
      apiKey: String(builtin.nanobananaApiKey || '').trim(),
      useBuiltinKey: false,
      builtinKeyAvailable: true,
      model: 'nano-banana-pro',
      endpoint: 'https://grsai.dakka.com.cn/v1/draw/nano-banana',
    },
    defaults: {
      language: 'zh',
      paperType: 'review',
      yearFrom: '2021',
      yearTo: String(new Date().getFullYear()),
      extraContext: '',
      continueGoal: '保持学术风格自然续写',
      targetWords: 500,
      rewriteRequirements: '保持原意，增强学术表达与论证严谨性',
      referenceTopic: '',
      referenceYearFrom: '',
      referenceYearTo: '',
      referenceCount: 24,
      referenceCandidatePoolSize: 80,
      referenceAnalysisWindow: 24,
      livePreview: true,
      imageAspectRatio: '16:9',
    },
  }

  const snapshots: Snapshot[] = []

  const result = await generatePaper(
    settings as any,
    rootDir,
    {
      topic,
      language,
      paperType: 'review',
      yearFrom: '2022',
      yearTo: '2025',
      extraContext: '回归测试：重点观察第二部分开始与完成后，标题、摘要和第一部分的样式语义是否保持稳定。',
      withImages: false,
    },
    (event) => {
      if (event.contentType !== 'body' && event.contentType !== 'final') return
      if (!Array.isArray(event.structuredBlocks) || event.structuredBlocks.length === 0) return
      const blocks = event.structuredBlocks as EmbeddedPayloadBlock[]
      snapshots.push({
        step: event.step,
        message: event.message,
        mainHeadingCount: getMainHeadingCount(blocks),
        prefixBlocks: extractStablePrefix(blocks),
        blockCount: blocks.length,
        markdownLength: String(event.cumulativeMarkdown || '').length,
      })
      console.log(`[${event.step}] ${event.message} | mainHeadings=${getMainHeadingCount(blocks)} | blocks=${blocks.length}`)
    },
  )

  const firstSectionSnapshot = snapshots.find((item) => item.mainHeadingCount >= 1)
  const secondSectionSnapshot = snapshots.find((item) => item.mainHeadingCount >= 2)
  const finalSnapshot = snapshots[snapshots.length - 1]

  if (!firstSectionSnapshot || !secondSectionSnapshot || !finalSnapshot) {
    throw new Error('未捕获到足够的章节快照，无法完成样式稳定性回归')
  }

  const baseline = JSON.stringify(firstSectionSnapshot.prefixBlocks)
  const afterSecond = JSON.stringify(secondSectionSnapshot.prefixBlocks.slice(0, firstSectionSnapshot.prefixBlocks.length))
  const finalPrefix = JSON.stringify(finalSnapshot.prefixBlocks.slice(0, firstSectionSnapshot.prefixBlocks.length))
  const baselineStyle = JSON.stringify(firstSectionSnapshot.prefixBlocks.map(summarizeStyle))
  const afterSecondStyle = JSON.stringify(secondSectionSnapshot.prefixBlocks.slice(0, firstSectionSnapshot.prefixBlocks.length).map(summarizeStyle))
  const finalStyle = JSON.stringify(finalSnapshot.prefixBlocks.slice(0, firstSectionSnapshot.prefixBlocks.length).map(summarizeStyle))

  const stableAfterSecond = baseline === afterSecond
  const stableAtFinal = baseline === finalPrefix
  const styleStableAfterSecond = baselineStyle === afterSecondStyle
  const styleStableAtFinal = baselineStyle === finalStyle

  console.log('=== STYLE REGRESSION SUMMARY ===')
  console.log(JSON.stringify({
    topic,
    title: result.title,
    markdownLength: result.markdown.length,
    snapshotCount: snapshots.length,
    firstSectionStep: firstSectionSnapshot.step,
    firstSectionMessage: firstSectionSnapshot.message,
    secondSectionStep: secondSectionSnapshot.step,
    secondSectionMessage: secondSectionSnapshot.message,
    finalStep: finalSnapshot.step,
    finalMessage: finalSnapshot.message,
    stableAfterSecond,
    stableAtFinal,
    styleStableAfterSecond,
    styleStableAtFinal,
    baselinePrefixLength: firstSectionSnapshot.prefixBlocks.length,
  }, null, 2))

  console.log('=== BASELINE PREFIX ===')
  console.log(JSON.stringify(firstSectionSnapshot.prefixBlocks, null, 2))
  console.log('=== AFTER SECOND SECTION PREFIX ===')
  console.log(JSON.stringify(secondSectionSnapshot.prefixBlocks.slice(0, firstSectionSnapshot.prefixBlocks.length), null, 2))
  console.log('=== FINAL PREFIX ===')
  console.log(JSON.stringify(finalSnapshot.prefixBlocks.slice(0, firstSectionSnapshot.prefixBlocks.length), null, 2))

  if (!styleStableAfterSecond || !styleStableAtFinal) {
    process.exitCode = 2
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})