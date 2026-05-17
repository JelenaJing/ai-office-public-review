import fs from 'node:fs/promises'
import path from 'node:path'
import { generateImage } from '../electron/main/services/imageClient'
import type { AppSettings } from '../electron/main/services/settingsStore'
import type { ImageGenerationMode, ImageReferenceItem, ImageStyleOptions, ImageStyleProfile } from '../src/types/imageGeneration'

interface CapturedRequestSummary {
  url: string
  body: Record<string, unknown>
}

interface SmokeCase {
  key: 'A' | 'B' | 'C' | 'D' | 'E'
  label: string
  provider: 'nanobanana' | 'openai-image'
  prompt: string
  references: ImageReferenceItem[]
  styleOptions: ImageStyleOptions
  generationMode: ImageGenerationMode
  styleProfile?: ImageStyleProfile | null
}

const STUB_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9p0xSukAAAAASUVORK5CYII='

function toContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'image/png'
}

async function ensureStubImage(filePath: string): Promise<void> {
  await fs.writeFile(filePath, Buffer.from(STUB_PNG_BASE64, 'base64'))
}

async function readReferenceImage(
  filePath: string,
  id: string,
  role: ImageReferenceItem['role'],
  weight: number,
  order: number,
): Promise<ImageReferenceItem> {
  const contentType = toContentType(filePath)
  const buffer = await fs.readFile(filePath)
  const dataUrl = `data:${contentType};base64,${buffer.toString('base64')}`
  return {
    id,
    url: dataUrl,
    role,
    weight,
    order,
    name: path.basename(filePath),
    origin: 'local',
    filePath,
    fileName: path.basename(filePath),
    contentType,
    dataUrl,
  }
}

function buildStubResponse(): Response {
  return new Response(JSON.stringify({
    status: 'completed',
    data: [{ b64_json: STUB_PNG_BASE64 }],
  }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
    },
  })
}

function buildCaseSettings(baseSettings: AppSettings, provider: SmokeCase['provider']): AppSettings {
  return {
    ...baseSettings,
    image: {
      ...baseSettings.image,
      provider,
      apiKey: 'smoke-test-key',
      endpoint: provider === 'openai-image' ? 'https://api.openai.com/v1/images/generations' : 'https://smoke.local/nanobanana',
      model: provider === 'openai-image' ? 'gpt-image-1' : 'nanobanana-stub',
    },
  }
}

async function main(): Promise<void> {
  const rootDir = process.cwd()
  const { SettingsStore } = await import('../electron/main/services/settingsStore')
  const settingsStore = new SettingsStore(path.join(process.env.HOME || '', '.config', '文枢AI'))
  const baseSettings = await settingsStore.resolveEffectiveSettings()
  const outputDir = path.join(rootDir, '.tmp-image-reference-chain-smoke')
  await fs.rm(outputDir, { recursive: true, force: true })
  await fs.mkdir(outputDir, { recursive: true })

  const referencePrimaryPath = path.join(outputDir, 'reference-primary.png')
  const referenceStylePath = path.join(outputDir, 'reference-style.png')
  const referenceContentPath = path.join(outputDir, 'reference-content.png')
  await Promise.all([
    ensureStubImage(referencePrimaryPath),
    ensureStubImage(referenceStylePath),
    ensureStubImage(referenceContentPath),
  ])

  const primaryReference = await readReferenceImage(referencePrimaryPath, 'sample-primary', 'primary-style', 0.65, 0)
  const styleReference = await readReferenceImage(referenceStylePath, 'sample-style', 'style', 0.25, 1)
  const contentReference = await readReferenceImage(referenceContentPath, 'sample-content', 'content', 0.1, 2)

  const flatIllustrationProfile: ImageStyleProfile = {
    medium: 'flat editorial illustration',
    palette: ['#d8ecff', '#7fb1e3', '#1f4b77'],
    lighting: 'balanced and evenly lit',
    linework: 'clean, crisp contour lines',
    texture: 'smooth flat surfaces with little visible grain',
    composition: 'horizontal composition with balanced focal rhythm',
    mood: 'clear, composed, and professional',
    forbidden: ['photorealistic studio photography', 'octane 3D render', 'hyper-real material realism'],
    summary: 'flat editorial illustration; palette #d8ecff, #7fb1e3, #1f4b77; balanced light; crisp contour lines; smooth flat surfaces; horizontal balanced composition; mood clear and professional',
    extractedAt: new Date().toISOString(),
    sourceImageId: primaryReference.id,
  }

  const cases: SmokeCase[] = [
    {
      key: 'A',
      label: 'prompt-only-no-references',
      provider: 'nanobanana',
      prompt: 'Create a clean editorial illustration of a research workflow with restrained blue accents and concise English labels.',
      references: [],
      styleOptions: { styleStrength: 30, strictStyleLock: false, preserveComposition: false, creativity: 55 },
      generationMode: 'style-continuation',
      styleProfile: null,
    },
    {
      key: 'B',
      label: 'primary-style-only',
      provider: 'nanobanana',
      prompt: 'Create a new figure for nanoparticle synthesis using the same visual language as the primary reference.',
      references: [primaryReference],
      styleOptions: { styleStrength: 88, strictStyleLock: true, preserveComposition: false, creativity: 28 },
      generationMode: 'style-continuation',
      styleProfile: flatIllustrationProfile,
    },
    {
      key: 'C',
      label: 'primary-style-plus-style-plus-content',
      provider: 'nanobanana',
      prompt: 'Use the reference set to create a publication-ready pipeline graphic for catalyst screening, but avoid changing the dominant illustration language.',
      references: [primaryReference, styleReference, contentReference],
      styleOptions: { styleStrength: 82, strictStyleLock: true, preserveComposition: true, creativity: 34 },
      generationMode: 'style-continuation',
      styleProfile: flatIllustrationProfile,
    },
    {
      key: 'D',
      label: 'style-and-content-without-primary',
      provider: 'nanobanana',
      prompt: 'Redraw the workflow as a tighter process board, using the content cues and auxiliary style references without assuming a locked master style.',
      references: [
        { ...styleReference, order: 0, weight: 0.7 },
        { ...contentReference, order: 1, weight: 0.3 },
      ],
      styleOptions: { styleStrength: 48, strictStyleLock: false, preserveComposition: true, creativity: 46 },
      generationMode: 'reference-redraw',
      styleProfile: null,
    },
    {
      key: 'E',
      label: 'openai-fallback-prompt-only-style-lock',
      provider: 'openai-image',
      prompt: 'Make it photorealistic and cinematic, but still keep the same flat editorial illustration series as the references.',
      references: [primaryReference, styleReference],
      styleOptions: { styleStrength: 90, strictStyleLock: true, preserveComposition: false, creativity: 22 },
      generationMode: 'style-continuation',
      styleProfile: flatIllustrationProfile,
    },
  ]

  const originalFetch = globalThis.fetch
  const summaries: Array<Record<string, unknown>> = []

  try {
    for (const testCase of cases) {
      const settings = buildCaseSettings(baseSettings, testCase.provider)
      const capturedRequests: CapturedRequestSummary[] = []
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url

        if (url === settings.image.endpoint.trim() && init?.body && typeof init.body === 'string') {
          capturedRequests.push({
            url,
            body: JSON.parse(init.body) as Record<string, unknown>,
          })
          return buildStubResponse()
        }

        return originalFetch(input as never, init)
      }) as typeof fetch

      const caseOutputDir = path.join(outputDir, testCase.key)
      await fs.mkdir(caseOutputDir, { recursive: true })

      let resultLocalPath: string | null = null
      let resultSourceUrlPresent = false
      let errorMessage: string | null = null

      try {
        const result = await generateImage(
          settings,
          caseOutputDir,
          {
            prompt: testCase.prompt,
            aspectRatio: '16:9',
            primaryImageId: testCase.references.find((item) => item.role === 'primary-style')?.id || null,
            selectedStyleImageIds: testCase.references.filter((item) => item.role !== 'content').map((item) => item.id),
            references: testCase.references,
            referenceImages: testCase.references,
            styleOptions: testCase.styleOptions,
            generationMode: testCase.generationMode,
            styleProfile: testCase.styleProfile || null,
            debug: { enabled: true, source: 'build/run-image-reference-chain-smoke.ts' },
            traceId: `smoke-${testCase.key}`,
          },
          (message) => {
            console.log(`[${testCase.key}] ${message}`)
          },
        )
        resultLocalPath = result.localPath
        resultSourceUrlPresent = Boolean(String(result.sourceUrl || '').trim())
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error)
        console.error(`[${testCase.key}] ${errorMessage}`)
      }

      const requestBody = capturedRequests[0]?.body || {}
      const requestImages = Array.isArray(requestBody.images) ? requestBody.images : []
      const requestReferenceImages = Array.isArray(requestBody.referenceImages) ? requestBody.referenceImages : []

      summaries.push({
        caseKey: testCase.key,
        caseLabel: testCase.label,
        provider: testCase.provider,
        generationMode: testCase.generationMode,
        styleOptions: testCase.styleOptions,
        rawPrompt: testCase.prompt,
        referenceRoles: testCase.references.map((item) => ({ id: item.id, role: item.role, weight: item.weight })),
        requestPrompt: typeof requestBody.prompt === 'string' ? requestBody.prompt : null,
        requestNegativePrompt: typeof requestBody.negativePrompt === 'string' ? requestBody.negativePrompt : null,
        requestImageCount: requestImages.length,
        requestReferenceImageCount: requestReferenceImages.length,
        attachedToRequest: requestImages.length > 0 && requestReferenceImages.length > 0,
        requestReferenceSummary: requestReferenceImages.map((item, index) => {
          const image = typeof item === 'object' && item !== null ? item as Record<string, unknown> : {}
          return {
            index,
            id: typeof image.id === 'string' ? image.id : null,
            documentId: typeof image.documentId === 'string' ? image.documentId : null,
            order: typeof image.order === 'number' ? image.order : null,
            role: typeof image.role === 'string' ? image.role : null,
            weight: typeof image.weight === 'number' ? image.weight : null,
            isPrimary: typeof image.isPrimary === 'boolean' ? image.isPrimary : null,
          }
        }),
        resultLocalPath,
        resultSourceUrlPresent,
        errorMessage,
      })
    }
  } finally {
    globalThis.fetch = originalFetch
  }

  const summaryPath = path.join(outputDir, 'request-summaries.json')
  await fs.writeFile(summaryPath, `${JSON.stringify(summaries, null, 2)}\n`, 'utf-8')

  console.log('=== IMAGE REFERENCE CHAIN SUMMARY ===')
  console.log(JSON.stringify({
    summaryPath,
    cases: summaries,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})