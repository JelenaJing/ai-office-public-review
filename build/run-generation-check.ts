import { generatePaper } from '../electron/main/services/paperGenerator'
import { hydrateQwenEnv, QWEN_DEFAULT_BASE_URL, QWEN_DEFAULT_MODEL, QWEN_DEFAULT_PROVIDER } from './qwenDefaults'

async function main(): Promise<void> {
  const rootDir = process.cwd()
  const topic = process.env.AI_WRITER_TEST_TOPIC || '多模态大语言模型在学术写作辅助中的应用进展'
  const language = process.env.AI_WRITER_TEST_LANGUAGE === 'en' ? 'en' : 'zh'
  const quiet = process.env.AI_WRITER_TEST_QUIET === '1'
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
      referenceCount: 36,
      referenceCandidatePoolSize: 300,
      referenceAnalysisWindow: 40,
      livePreview: true,
      imageAspectRatio: '16:9',
    },
  }

  const referenceInsertedEvents: Array<{ step: number; citationNumber?: number; paragraphIndex?: number }> = []
  const referenceStatusEvents: Array<{ step: number; message: string }> = []

  const result = await generatePaper(
    settings as any,
    rootDir,
    {
      topic,
      language,
      paperType: 'review',
      yearFrom: '2022',
      yearTo: '2025',
      extraContext: '重点关注文献检索、引用组织、图文协同和写作流程自动化。',
      withImages: false,
    },
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
      if (!quiet && event.step && event.message) {
        console.log(`[${event.step}] ${event.message}`)
      }
    },
  )

  console.log('=== RESULT SUMMARY ===')
  console.log(
    JSON.stringify(
      {
        title: result.title,
        markdownLength: result.markdown.length,
        referenceCount: result.references.length,
        referenceInsertedEventCount: referenceInsertedEvents.length,
        referenceInsertedEvents: referenceInsertedEvents.slice(0, 10),
        referenceStatusCount: referenceStatusEvents.length,
        hasReferencesSection: /##\s*(参考文献|References)/.test(result.markdown),
        citationMarks: (result.markdown.match(/\[(\d+(?:\s*[,-]\s*\d+)*)\]/g) || []).length,
      },
      null,
      2,
    ),
  )
  console.log('=== MARKDOWN HEAD ===')
  console.log(result.markdown.slice(0, 1200))
  console.log('=== MARKDOWN TAIL ===')
  console.log(result.markdown.slice(-1200))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})