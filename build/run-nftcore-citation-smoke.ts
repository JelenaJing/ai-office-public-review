import path from 'node:path'
import { generatePaperSmart, type PaperGenerationParams } from '../electron/main/services/paperGenerator'
import { SettingsStore, type AppSettings } from '../electron/main/services/settingsStore'
import { hydrateQwenEnv, QWEN_DEFAULT_BASE_URL, QWEN_DEFAULT_MODEL, QWEN_DEFAULT_PROVIDER } from './qwenDefaults'

type BuiltinKeyConfig = {
  qwenApiKey?: string
  nanobananaApiKey?: string
}

type SmokeCase = {
  name: 'review' | 'research'
  topic: string
  paperType: 'review' | 'research'
}

type ProgressEvent = {
  step: number
  message: string
  eventType?: 'references' | 'image' | 'quality_check' | 'review'
  referenceAction?: 'status' | 'paragraph_analyzed' | 'reference_inserted' | 'complete'
  content?: string
  contentType?: 'thinking' | 'outline' | 'body' | 'final' | 'quality_feedback' | 'review_result'
  cumulativeMarkdown?: string
}

type SmokeSummary = {
  caseName: string
  topic: string
  finalReferenceCount: number
  bodyCitationCount: number
  paragraphsWithCitation: number
  firstCitationStep: number | null
  firstCitationMessage: string | null
  firstReferenceInsertedStep: number | null
  referenceInsertedEvents: number
  finalReferenceAdjustmentStep: number | null
  citationAppearedBeforeFinalReferencePass: boolean
  citationExamples: string[]
  referenceMessages: string[]
  completedFullRun: boolean
  stoppedAfterCapture: boolean
  lastObservedStep: number | null
  errorMessage?: string
}

const SMOKE_CAPTURED_ERROR = '__SMOKE_CAPTURED__'

function stripReferencesSection(markdown: string): string {
  return String(markdown || '').replace(/\n##\s*(References|参考文献)[\s\S]*$/i, '').trim()
}

function extractCitationMatches(markdown: string): string[] {
  return Array.from(stripReferencesSection(markdown).matchAll(/\[(\d+(?:\s*[,-]\s*\d+)*)\]/g)).map((match) => match[0])
}

function extractParagraphsWithCitation(markdown: string): string[] {
  return stripReferencesSection(markdown)
    .split(/\n\s*\n/)
    .map((item) => item.trim())
    .filter((item) => /\[(\d+(?:\s*[,-]\s*\d+)*)\]/.test(item) && !/^##\s+/m.test(item.replace(/\n+/g, ' ')))
}

function summarizeParagraph(paragraph: string): string {
  return paragraph.replace(/\s+/g, ' ').trim().slice(0, 220)
}

async function loadBuiltinKeyConfig(rootDir: string): Promise<BuiltinKeyConfig> {
  return hydrateQwenEnv(rootDir)
}

async function resolveSmokeSettings(rootDir: string, userDataDir: string): Promise<AppSettings> {
  const builtin = await loadBuiltinKeyConfig(rootDir)
  const store = new SettingsStore(userDataDir)

  await store.save({
    llm: builtin.qwenApiKey
      ? {
          provider: QWEN_DEFAULT_PROVIDER,
          apiKey: builtin.qwenApiKey,
          useBuiltinKey: false,
          builtinKeyAvailable: true,
          model: QWEN_DEFAULT_MODEL,
          baseUrl: QWEN_DEFAULT_BASE_URL,
        }
      : undefined,
    image: builtin.nanobananaApiKey
      ? {
          provider: 'nanobanana',
          apiKey: builtin.nanobananaApiKey,
          useBuiltinKey: false,
          builtinKeyAvailable: true,
          model: 'nano-banana-pro',
          endpoint: 'https://grsai.dakka.com.cn/v1/draw/nano-banana',
        }
      : undefined,
    defaults: {
      language: 'en',
      paperType: 'review',
      noImageMode: true,
      yearFrom: '2021',
      yearTo: String(new Date().getFullYear()),
      extraContext: '',
      continueGoal: 'Keep academic style natural',
      targetWords: 550,
      rewriteRequirements: 'Keep academic rigor',
      referenceTopic: '',
      referenceYearFrom: '',
      referenceYearTo: '',
      referenceCount: 8,
      referenceCandidatePoolSize: 32,
      referenceAnalysisWindow: 12,
      livePreview: false,
      imageAspectRatio: '16:9',
    },
  })

  return store.resolveEffectiveSettings()
}

async function runOneCase(settings: AppSettings, baseDir: string, params: PaperGenerationParams, topic: string, caseName: string): Promise<SmokeSummary> {
  const outputDir = path.join(baseDir, caseName)
  await fs.mkdir(outputDir, { recursive: true })

  let firstCitationStep: number | null = null
  let firstCitationMessage: string | null = null
  let firstReferenceInsertedStep: number | null = null
  let finalReferenceAdjustmentStep: number | null = null
  let referenceInsertedEvents = 0
  const referenceMessages: string[] = []
  const seenCitationExamples = new Set<string>()
  let latestMarkdown = ''
  let lastObservedStep: number | null = null
  let captureSatisfied = false

  try {
    const result = await generatePaperSmart(
      settings,
      outputDir,
      params,
      (event) => {
        const progressEvent = event as ProgressEvent
        lastObservedStep = progressEvent.step
        console.log(`[${caseName}] step=${progressEvent.step} ${progressEvent.message}`)
        if (progressEvent.cumulativeMarkdown) {
          latestMarkdown = progressEvent.cumulativeMarkdown
        } else if ((progressEvent.contentType === 'body' || progressEvent.contentType === 'final') && progressEvent.content) {
          latestMarkdown += `\n\n${progressEvent.content}`
        }

        const candidateMarkdown = progressEvent.cumulativeMarkdown || latestMarkdown
        const citations = extractCitationMatches(candidateMarkdown)
        if (citations.length > 0 && firstCitationStep == null) {
          firstCitationStep = progressEvent.step
          firstCitationMessage = progressEvent.message
        }

        if (progressEvent.referenceAction === 'reference_inserted') {
          referenceInsertedEvents += 1
          if (firstReferenceInsertedStep == null) {
            firstReferenceInsertedStep = progressEvent.step
          }
        }

        if (progressEvent.eventType === 'references') {
          referenceMessages.push(`step=${progressEvent.step} action=${progressEvent.referenceAction || 'status'} message=${progressEvent.message}`)
          if (/最终引用校验与增量调整/.test(progressEvent.message)) {
            finalReferenceAdjustmentStep = progressEvent.step
          }
        }

        const paragraphs = extractParagraphsWithCitation(candidateMarkdown)
        for (const paragraph of paragraphs) {
          if (seenCitationExamples.size >= 4) break
          seenCitationExamples.add(summarizeParagraph(paragraph))
        }

        if (!captureSatisfied && firstCitationStep != null && seenCitationExamples.size > 0) {
          captureSatisfied = true
          throw new Error(SMOKE_CAPTURED_ERROR)
        }
      },
    )

    const finalMarkdown = result.markdown || latestMarkdown
    const finalBodyCitations = extractCitationMatches(finalMarkdown)
    const paragraphsWithCitation = extractParagraphsWithCitation(finalMarkdown)

    return {
      caseName,
      topic,
      finalReferenceCount: result.references.length,
      bodyCitationCount: finalBodyCitations.length,
      paragraphsWithCitation: paragraphsWithCitation.length,
      firstCitationStep,
      firstCitationMessage,
      firstReferenceInsertedStep,
      referenceInsertedEvents,
      finalReferenceAdjustmentStep,
      citationAppearedBeforeFinalReferencePass:
        firstCitationStep != null && finalReferenceAdjustmentStep != null ? firstCitationStep < finalReferenceAdjustmentStep : firstCitationStep != null,
      citationExamples: Array.from(seenCitationExamples),
      referenceMessages: referenceMessages.slice(0, 16),
      completedFullRun: true,
      stoppedAfterCapture: false,
      lastObservedStep,
    }
  } catch (error) {
    if (!(error instanceof Error) || error.message !== SMOKE_CAPTURED_ERROR) {
      const finalMarkdown = latestMarkdown
      const finalBodyCitations = extractCitationMatches(finalMarkdown)
      const paragraphsWithCitation = extractParagraphsWithCitation(finalMarkdown)
      return {
        caseName,
        topic,
        finalReferenceCount: 0,
        bodyCitationCount: finalBodyCitations.length,
        paragraphsWithCitation: paragraphsWithCitation.length,
        firstCitationStep,
        firstCitationMessage,
        firstReferenceInsertedStep,
        referenceInsertedEvents,
        finalReferenceAdjustmentStep,
        citationAppearedBeforeFinalReferencePass:
          firstCitationStep != null && finalReferenceAdjustmentStep != null ? firstCitationStep < finalReferenceAdjustmentStep : firstCitationStep != null,
        citationExamples: Array.from(seenCitationExamples),
        referenceMessages: referenceMessages.slice(0, 16),
        completedFullRun: false,
        stoppedAfterCapture: false,
        lastObservedStep,
        errorMessage: error.message,
      }
    }
  }

  const finalMarkdown = latestMarkdown
  const finalBodyCitations = extractCitationMatches(finalMarkdown)
  const paragraphsWithCitation = extractParagraphsWithCitation(finalMarkdown)

  return {
    caseName,
    topic,
    finalReferenceCount: 0,
    bodyCitationCount: finalBodyCitations.length,
    paragraphsWithCitation: paragraphsWithCitation.length,
    firstCitationStep,
    firstCitationMessage,
    firstReferenceInsertedStep,
    referenceInsertedEvents,
    finalReferenceAdjustmentStep,
    citationAppearedBeforeFinalReferencePass:
      firstCitationStep != null && finalReferenceAdjustmentStep != null ? firstCitationStep < finalReferenceAdjustmentStep : firstCitationStep != null,
    citationExamples: Array.from(seenCitationExamples),
    referenceMessages: referenceMessages.slice(0, 16),
    completedFullRun: false,
    stoppedAfterCapture: true,
    lastObservedStep,
  }
}

async function main(): Promise<void> {
  const workspaceRoot = process.cwd()
  const userDataDir = path.join(workspaceRoot, '.tmp-smoke-userdata')
  const smokeOutputDir = path.join(workspaceRoot, '.tmp-nftcore-citation-smoke')
  const settings = await resolveSmokeSettings(workspaceRoot, userDataDir)
  if (!settings.llm.apiKey.trim()) {
    throw new Error('Smoke blocked: no effective LLM API key available from build/builtin-keys.local.json or SettingsStore.')
  }

  const smokeCases: SmokeCase[] = [
    {
      name: 'review',
      topic: 'Recent advances in perovskite solar cells and stability improvement strategies',
      paperType: 'review',
    },
    {
      name: 'research',
      topic: 'Electrochemical performance analysis of silicon anodes in lithium-ion batteries',
      paperType: 'research',
    },
  ]

  const summaries: SmokeSummary[] = []

  for (const smokeCase of smokeCases) {
    const params: PaperGenerationParams = {
      topic: smokeCase.topic,
      language: 'en',
      paperType: smokeCase.paperType,
      citationMode: 'inline',
      yearFrom: '2021',
      yearTo: String(new Date().getFullYear()),
      extraContext: 'Smoke test for inline citation behavior. Let the model decide where citations are needed while keeping citation numbering grounded in retrieved references.',
      withImages: false,
      skipSectionThinking: true,
      incrementalReferencePassInterval: 1,
      finalReferenceVerification: true,
      enableKnowledgeTreeCheck: false,
      enableFullReview: false,
    }

    console.log(`\n===== Running ${smokeCase.name} smoke =====`)
    console.log(`Topic: ${smokeCase.topic}`)
    const summary = await runOneCase(settings, smokeOutputDir, params, smokeCase.topic, smokeCase.name)
    summaries.push(summary)
    console.log(JSON.stringify(summary, null, 2))
  }

  const reportPath = path.join(smokeOutputDir, 'summary.json')
  await fs.writeFile(reportPath, JSON.stringify(summaries, null, 2), 'utf-8')
  console.log(`\nSummary saved to ${reportPath}`)
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})