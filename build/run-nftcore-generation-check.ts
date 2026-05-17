import fs from 'node:fs/promises'
import path from 'node:path'
import { generatePaperNFTCORE } from '../electron/main/services/paperGeneratorNFTCORE'
import { hydrateQwenEnv, QWEN_DEFAULT_BASE_URL, QWEN_DEFAULT_MODEL, QWEN_DEFAULT_PROVIDER } from './qwenDefaults'

function sanitizeSlug(input: string): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'paper'
}

function extractCitationNumbers(text: string): number[] {
  const matches = Array.from(String(text || '').matchAll(/\[(\d+(?:\s*[,-]\s*\d+)*)\]/g))
  const numbers: number[] = []
  for (const match of matches) {
    const content = String(match[1] || '').trim()
    const parts = content.split(',').map((item) => item.trim()).filter(Boolean)
    for (const part of parts) {
      if (part.includes('-')) {
        const [startRaw, endRaw] = part.split('-').map((item) => Number(item.trim()))
        if (Number.isFinite(startRaw) && Number.isFinite(endRaw) && endRaw >= startRaw) {
          for (let value = startRaw; value <= endRaw; value += 1) numbers.push(value)
        }
        continue
      }
      const value = Number(part)
      if (Number.isFinite(value)) numbers.push(value)
    }
  }
  return numbers
}

async function main(): Promise<void> {
  const rootDir = process.cwd()
  const topic = process.env.AI_WRITER_TEST_TOPIC || '多模态大语言模型在学术写作辅助中的应用进展'
  const language = process.env.AI_WRITER_TEST_LANGUAGE === 'en' ? 'en' : 'zh'
  const profile = process.env.AI_WRITER_TEST_PROFILE === 'fast' ? 'fast' : 'full'
  const paperType = process.env.AI_WRITER_TEST_PAPER_TYPE === 'research'
    ? 'research'
    : process.env.AI_WRITER_TEST_PAPER_TYPE === 'thesis_research'
      ? 'thesis_research'
      : 'review'
  const withImages = process.env.AI_WRITER_TEST_WITH_IMAGES === '1' || (profile === 'full' && process.env.AI_WRITER_TEST_WITH_IMAGES !== '0')
  const quiet = process.env.AI_WRITER_TEST_QUIET === '1'
  const artifactRoot = process.env.AI_WRITER_TEST_OUTPUT_DIR || path.join('/tmp', 'nftcore-generation-check')
  const skipSectionThinking = process.env.AI_WRITER_TEST_SKIP_THINKING === '1' || profile === 'fast'
  const incrementalReferencePassInterval = Number.parseInt(process.env.AI_WRITER_TEST_INCREMENTAL_REFERENCE_INTERVAL || '', 10)
  const finalReferenceVerification = process.env.AI_WRITER_TEST_FINAL_REFERENCE_VERIFICATION === '1'
    ? true
    : process.env.AI_WRITER_TEST_FINAL_REFERENCE_VERIFICATION === '0'
      ? false
      : profile !== 'fast'
  const targetWords = Number.parseInt(process.env.AI_WRITER_TEST_TARGET_WORDS || '', 10)
  const referenceCount = Number.parseInt(process.env.AI_WRITER_TEST_REFERENCE_COUNT || '', 10)
  const referenceCandidatePoolSize = Number.parseInt(process.env.AI_WRITER_TEST_REFERENCE_POOL || '', 10)
  const referenceAnalysisWindow = Number.parseInt(process.env.AI_WRITER_TEST_REFERENCE_WINDOW || '', 10)
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
      paperType,
      yearFrom: '2021',
      yearTo: String(new Date().getFullYear()),
      extraContext: '',
      continueGoal: '保持学术风格自然续写',
      targetWords: Number.isFinite(targetWords) ? Math.max(120, targetWords) : 500,
      rewriteRequirements: '保持原意，增强学术表达与论证严谨性',
      referenceTopic: '',
      referenceYearFrom: '',
      referenceYearTo: '',
      referenceCount: Number.isFinite(referenceCount) ? Math.max(1, referenceCount) : profile === 'fast' ? 8 : 24,
      referenceCandidatePoolSize: Number.isFinite(referenceCandidatePoolSize) ? Math.max(5, referenceCandidatePoolSize) : profile === 'fast' ? 20 : 80,
      referenceAnalysisWindow: Number.isFinite(referenceAnalysisWindow) ? Math.max(5, referenceAnalysisWindow) : profile === 'fast' ? 8 : 24,
      livePreview: true,
      imageAspectRatio: '16:9',
    },
  }

  const referenceInsertedEvents: Array<{ step: number; citationNumber?: number; paragraphIndex?: number }> = []
  const referenceStatusEvents: Array<{ step: number; message: string }> = []
  const imageEvents: Array<{ step: number; message: string; section?: string; path?: string; caption?: string }> = []

  const result = await generatePaperNFTCORE(
    settings as any,
    rootDir,
    {
      topic,
      language,
      paperType,
      yearFrom: '2022',
      yearTo: '2025',
      extraContext: `测试 NFTCORE ${paperType} 链路：要求正文生成时直接包含引用，并在后处理中做增量引用调整。`,
      withImages,
      skipSectionThinking,
      incrementalReferencePassInterval: Number.isFinite(incrementalReferencePassInterval)
        ? Math.max(0, incrementalReferencePassInterval)
        : profile === 'fast'
          ? 0
          : 2,
      finalReferenceVerification,
      enableKnowledgeTreeCheck: false,
      enableFullReview: false,
    } as any,
    (event) => {
      if (event.eventType === 'references' && event.referenceAction === 'reference_inserted') {
        referenceInsertedEvents.push({
          step: event.step,
          citationNumber: event.citationNumber,
          paragraphIndex: event.paragraphIndex,
        })
      }
      if (event.eventType === 'references' && event.referenceAction === 'status') {
        referenceStatusEvents.push({ step: event.step, message: event.message })
      }
      if (event.eventType === 'image') {
        imageEvents.push({
          step: event.step,
          message: event.message,
          section: event.image?.section,
          path: event.image?.path,
          caption: event.image?.caption,
        })
      }
      if (!quiet && event.step && event.message) {
        console.log(`[${event.step}] ${event.message}`)
      }
    },
  )

  const nftcoreResult = result as any
  const citations = result.markdown.match(/\[(\d+(?:\s*[,-]\s*\d+)*)\]/g) || []
  const referencesSectionMatch = result.markdown.match(/##\s*(参考文献|References)[\s\S]*$/)
  const referencesSection = referencesSectionMatch?.[0] || ''
  const bodyMarkdown = result.markdown.replace(/\n##\s*(参考文献|References)[\s\S]*$/i, '').trim()
  const figuresPerSection = result.images.reduce<Record<string, number>>((acc, item) => {
    acc[item.section] = (acc[item.section] || 0) + 1
    return acc
  }, {})
  const headings = Array.from(result.markdown.matchAll(/^##\s+(.+)$/gm)).map((match) => String(match[1] || '').trim())
  const citationUsageByReference = extractCitationNumbers(bodyMarkdown).reduce<Record<string, number>>((acc, number) => {
    const key = String(number)
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
  const runDir = path.join(
    artifactRoot,
    `${new Date().toISOString().replace(/[:.]/g, '-')}-${paperType}-${sanitizeSlug(topic)}`,
  )
  await fs.mkdir(runDir, { recursive: true })

  const imageArtifacts = result.images.map((image, index) => ({
    index: index + 1,
    section: image.section,
    sectionTitle: image.sectionTitle,
    path: image.path,
    url: image.url,
    caption: image.caption,
    markdown: image.markdown,
  }))

  const summary = {
    profile,
    paperType,
    title: result.title,
    markdownLength: result.markdown.length,
    headings,
    paperPlanSections: nftcoreResult.paperPlan?.sections.map((section: any) => ({
      title: section.title,
      plannedFigureCount: section.plannedFigureCount,
    })),
    referenceCount: result.references.length,
    referenceInsertedEventCount: referenceInsertedEvents.length,
    referenceInsertedEvents: referenceInsertedEvents.slice(0, 10),
    referenceStatusCount: referenceStatusEvents.length,
    imageEventCount: imageEvents.length,
    imageCount: result.images.length,
    figuresPerSection,
    hasReferencesSection: /##\s*(参考文献|References)/.test(result.markdown),
    citationMarkCount: citations.length,
    citationsOutsideReferences: citations.filter((mark) => !referencesSection.includes(mark)).length,
    uniqueCitationReferenceCount: Object.keys(citationUsageByReference).length,
    citationUsageByReference,
    artifacts: {
      runDir,
      markdown: path.join(runDir, 'paper.md'),
      summary: path.join(runDir, 'summary.json'),
      references: path.join(runDir, 'references.json'),
      images: path.join(runDir, 'images.json'),
      imageEvents: path.join(runDir, 'image-events.json'),
    },
    runtimeConfig: {
      withImages,
      skipSectionThinking,
      incrementalReferencePassInterval: Number.isFinite(incrementalReferencePassInterval)
        ? Math.max(0, incrementalReferencePassInterval)
        : profile === 'fast'
          ? 0
          : 2,
      finalReferenceVerification,
      targetWords: settings.defaults.targetWords,
      referenceCount: settings.defaults.referenceCount,
      referenceCandidatePoolSize: settings.defaults.referenceCandidatePoolSize,
      referenceAnalysisWindow: settings.defaults.referenceAnalysisWindow,
    },
  }

  await Promise.all([
    fs.writeFile(path.join(runDir, 'paper.md'), result.markdown, 'utf-8'),
    fs.writeFile(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8'),
    fs.writeFile(path.join(runDir, 'references.json'), JSON.stringify(result.references, null, 2), 'utf-8'),
    fs.writeFile(path.join(runDir, 'images.json'), JSON.stringify(imageArtifacts, null, 2), 'utf-8'),
    fs.writeFile(path.join(runDir, 'image-events.json'), JSON.stringify(imageEvents, null, 2), 'utf-8'),
  ])

  console.log('=== NFTCORE RESULT SUMMARY ===')
  console.log(JSON.stringify(summary, null, 2))
  console.log('=== NFTCORE MARKDOWN HEAD ===')
  console.log(result.markdown.slice(0, 1600))
  console.log('=== NFTCORE MARKDOWN TAIL ===')
  console.log(result.markdown.slice(-1600))
  console.log('=== NFTCORE IMAGE CAPTIONS ===')
  console.log(
    JSON.stringify(
      imageArtifacts.map((item) => ({
        index: item.index,
        section: item.section,
        sectionTitle: item.sectionTitle,
        path: item.path,
        caption: item.caption,
      })),
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})