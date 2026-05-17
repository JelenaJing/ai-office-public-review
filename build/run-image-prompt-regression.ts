import fs from 'node:fs/promises'
import path from 'node:path'
import { generateImage } from '../electron/main/services/imageClient'
import { hydrateQwenEnv } from './qwenDefaults'

interface ReferenceImagePayload {
  documentId: string
  filePath: string
  fileName: string
  contentType: string
  dataUrl: string
  isPrimary: boolean
  order: number
}

interface PromptBreakdown {
  traceId?: string
  academicMode?: boolean
  rawUserPrompt?: string
  systemPromptPrefix?: string
  styleInstruction?: string
  finalRequestPrompt?: string
  referenceImageCount?: number
  styleInstructionEnabled?: boolean
}

interface ValidationCase {
  key: string
  label: string
  prompt: string
  referenceImages: ReferenceImagePayload[]
  primaryImageId: string | null
  selectedStyleImageIds: string[]
}

const MOCK_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WIqmXkAAAAASUVORK5CYII='

function toContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'image/png'
}

async function readReferenceImage(filePath: string, documentId: string, order: number, isPrimary: boolean): Promise<ReferenceImagePayload> {
  const contentType = toContentType(filePath)
  const buffer = await fs.readFile(filePath)
  return {
    documentId,
    filePath,
    fileName: path.basename(filePath),
    contentType,
    dataUrl: `data:${contentType};base64,${buffer.toString('base64')}`,
    isPrimary,
    order,
  }
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase()
}

async function main(): Promise<void> {
  const rootDir = process.cwd()
  const captureOnly = process.env.AI_WRITER_IMAGE_PROMPT_CAPTURE_ONLY === '1'
  const caseFilter = String(process.env.AI_WRITER_IMAGE_PROMPT_CASE_FILTER || '').trim()
  const builtinKeyConfig = hydrateQwenEnv(rootDir)

  process.env.AI_WRITER_DEFAULT_QWEN_API_KEY = String(builtinKeyConfig.qwenApiKey || '').trim()
  process.env.AI_WRITER_DEFAULT_NANOBANANA_API_KEY = String(builtinKeyConfig.nanobananaApiKey || '').trim()

  const { SettingsStore } = await import('../electron/main/services/settingsStore')
  const settingsStore = new SettingsStore(path.join(process.env.HOME || '', '.config', '文枢AI'))
  const settings = await settingsStore.resolveEffectiveSettings()
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
  const outputDir = path.join(rootDir, '.tmp-image-prompt-regression', timestamp)
  await fs.mkdir(outputDir, { recursive: true })

  const primaryReference = await readReferenceImage(
    '/data/AI_writer/nftcore-data/cache_fig/合成量子点_20260313_130158_fig1_fig1.png',
    'flat-primary',
    0,
    true,
  )
  const secondaryReferenceA = await readReferenceImage(
    '/data/AI_writer/nftcore-data/cache_fig/合成量子点_20260313_130158_fig3_fig1.png',
    'flat-secondary-1',
    1,
    false,
  )
  const secondaryReferenceB = await readReferenceImage(
    '/data/AI_writer/nftcore-data/cache_fig/aiwork_20260313_172247_fig1_fig1.png',
    'flat-secondary-2',
    2,
    false,
  )

  const normalPrompt = 'Create a clean illustration of an orange cat resting on a lawn in afternoon light, with a calm mood, simple composition, and no caption or extra labels.'
  const academicPrompt = 'Create a scientific figure for a research paper showing alloy quantum dot synthesis, with concise English labels and a clear publication-style layout.'

  const cases: ValidationCase[] = [
    {
      key: '1-no-ref',
      label: 'normal-prompt-no-reference',
      prompt: normalPrompt,
      referenceImages: [],
      primaryImageId: null,
      selectedStyleImageIds: [],
    },
    {
      key: '2-primary-only',
      label: 'normal-prompt-primary-reference',
      prompt: normalPrompt,
      referenceImages: [primaryReference],
      primaryImageId: primaryReference.documentId,
      selectedStyleImageIds: [primaryReference.documentId],
    },
    {
      key: '3-primary-plus-two',
      label: 'normal-prompt-primary-plus-two-secondary',
      prompt: normalPrompt,
      referenceImages: [primaryReference, secondaryReferenceA, secondaryReferenceB],
      primaryImageId: primaryReference.documentId,
      selectedStyleImageIds: [primaryReference.documentId, secondaryReferenceA.documentId, secondaryReferenceB.documentId],
    },
    {
      key: '4-academic-explicit',
      label: 'explicit-academic-figure-request',
      prompt: academicPrompt,
      referenceImages: [],
      primaryImageId: null,
      selectedStyleImageIds: [],
    },
  ].filter((item) => !caseFilter || item.key === caseFilter)

  const originalFetch = globalThis.fetch
  const originalInfo = console.info
  const summaries: Array<Record<string, unknown>> = []

  try {
    for (const testCase of cases) {
      const traceId = `reg-${sanitizeFileName(testCase.key)}-${Date.now()}`
      const caseOutputDir = path.join(outputDir, testCase.key)
      await fs.mkdir(caseOutputDir, { recursive: true })

      const capturedRequests: Array<Record<string, unknown>> = []
      const capturedPromptBreakdowns: PromptBreakdown[] = []

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url

        const imageEndpoint = settings.image.provider === 'openai-image'
          ? 'https://api.openai.com/v1/images/generations'
          : settings.image.endpoint.trim()

        if (url === imageEndpoint && init?.body && typeof init.body === 'string') {
          capturedRequests.push(JSON.parse(init.body) as Record<string, unknown>)
          if (captureOnly) {
            return new Response(JSON.stringify({
              status: 'completed',
              b64_json: MOCK_IMAGE_BASE64,
            }), {
              status: 200,
              headers: {
                'content-type': 'application/json',
              },
            })
          }
        }

        return originalFetch(input as never, init)
      }) as typeof fetch

      console.info = ((...args: unknown[]) => {
        if (typeof args[0] === 'string' && String(args[0]).startsWith('[image:prompt-builder]')) {
          const payload = args[1]
          if (typeof payload === 'string') {
            try {
              capturedPromptBreakdowns.push(JSON.parse(payload) as PromptBreakdown)
            } catch {
              // ignore malformed JSON logs
            }
          }
        }
        originalInfo(...args)
      }) as typeof console.info

      let resultLocalPath: string | null = null
      let errorMessage: string | null = null

      try {
        const result = await generateImage(
          settings,
          caseOutputDir,
          {
            prompt: testCase.prompt,
            aspectRatio: '16:9',
            primaryImageId: testCase.primaryImageId,
            selectedStyleImageIds: testCase.selectedStyleImageIds,
            referenceImages: testCase.referenceImages,
            traceId,
          },
          (message) => {
            console.log(`[${testCase.key}] ${message}`)
          },
        )
        resultLocalPath = result.localPath
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error)
      } finally {
        globalThis.fetch = originalFetch
        console.info = originalInfo
      }

      const promptBreakdown = capturedPromptBreakdowns.find((item) => item.traceId === traceId) || capturedPromptBreakdowns[0] || {}
      const requestBody = capturedRequests[0] || {}

      const summary = {
        caseKey: testCase.key,
        caseLabel: testCase.label,
        academicMode: Boolean(promptBreakdown.academicMode),
        rawUserPrompt: String(promptBreakdown.rawUserPrompt || testCase.prompt),
        systemPromptPrefix: String(promptBreakdown.systemPromptPrefix || ''),
        styleInstruction: String(promptBreakdown.styleInstruction || ''),
        finalRequestPrompt: String(promptBreakdown.finalRequestPrompt || requestBody.prompt || ''),
        requestImageCount: Array.isArray(requestBody.images) ? requestBody.images.length : 0,
        requestReferenceImageCount: Array.isArray(requestBody.referenceImages) ? requestBody.referenceImages.length : 0,
        resultLocalPath,
        errorMessage,
      }

      summaries.push(summary)
      await fs.writeFile(path.join(caseOutputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf-8')
      console.log(`CASE ${testCase.key}: ${JSON.stringify(summary, null, 2)}`)
    }
  } finally {
    globalThis.fetch = originalFetch
    console.info = originalInfo
  }

  const summaryPath = path.join(outputDir, 'summary.json')
  await fs.writeFile(summaryPath, `${JSON.stringify({ outputDir, summaries }, null, 2)}\n`, 'utf-8')
  console.log(JSON.stringify({ outputDir, summaryPath, summaries }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})