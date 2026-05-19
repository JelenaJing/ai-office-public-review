import fs from 'node:fs/promises'
import path from 'node:path'
import type { AppSettings } from './settingsStore'
import {
  DEFAULT_IMAGE_GENERATION_MODE,
  buildFinalImagePrompt,
  buildImageReferenceDebugItems,
  normalizeImageStyleOptions,
  normalizeImageReferenceSelections,
} from '../../../src/modules/image/services/imageGenerationPrompt'
import type {
  ImageGenerationDebugLog,
  ImageGenerationMode,
  ImageReferenceOrigin,
  ImageReferenceRole,
  ImageStyleOptions,
  ImageStyleProfile,
} from '../../../src/types/imageGeneration'

export interface ImageGenerationResult {
  localPath: string
  sourceUrl: string
  model: string
}

interface ReferenceImagePayload {
  id?: string
  documentId?: string
  order?: number
  role?: ImageReferenceRole
  weight?: number
  url?: string
  origin?: ImageReferenceOrigin
  isPrimary?: boolean
  filePath?: string
  fileName?: string
  contentType?: string
  dataUrl?: string
}

interface ImageGenerationParams {
  prompt: string
  aspectRatio: string
  flowType?: 'paper-generation' | string
  negativePrompt?: string
  primaryImageId?: string | null
  selectedStyleImageIds?: string[]
  references?: ReferenceImagePayload[]
  referenceImages?: ReferenceImagePayload[]
  styleOptions?: Partial<ImageStyleOptions>
  generationMode?: ImageGenerationMode
  styleProfile?: ImageStyleProfile | null
  debug?: {
    enabled?: boolean
    source?: string
  }
  traceId?: string
}

interface NormalizedReferenceImagePayload extends ReferenceImagePayload {
  id: string
  order: number
  role: ImageReferenceRole
  weight: number
  isPrimary: boolean
}

interface ResolvedImagePayload {
  url?: string
  base64?: string
}

type ProgressReporter = (message: string) => void

// Lightweight default guard — prevents common visual drift without imposing academic content
const IMAGE_DEFAULT_GUARD =
  'Generate an image based on the user description. ' +
  'Do not add figure captions, annotation text boxes, map insets, or dense infographic labels unless explicitly requested. ' +
  'Do not default to an academic paper figure style or scientific diagram layout.'

const MOJIBAKE_PROMPT_PATTERN = /(璇风敓|鎴|涓婚|銆|鈥)/

function assertPromptEncodingSafe(params: ImageGenerationParams, traceId: string): void {
  const rawPrompt = String(params.prompt || '')
  if (!MOJIBAKE_PROMPT_PATTERN.test(rawPrompt)) return
  const payload = {
    traceId,
    flowType: params.flowType || params.debug?.source || 'image-generation',
    rawUserPrompt: rawPrompt,
  }
  console.error('[image:prompt-encoding-abnormal]', JSON.stringify(payload))
  throw new Error('图片 prompt 编码异常')
}

// Academic figure prompt — only activated when user explicitly requests scientific/academic figures
const IMAGE_ACADEMIC_SYSTEM_PROMPT =
  'This is a specialized image generation for English scientific research papers. ' +
  'The image must only contain English text and maintain an academic style. ' +
  'No Chinese characters or other non-English text should appear in the image. ' +
  'The visual style should be professional, clean, and suitable for academic publication.'

const ACADEMIC_FIGURE_KEYWORDS = [
  'scientific figure', 'science figure', 'research paper figure', 'academic figure',
  'figure caption', 'figure label', 'academic illustration', 'journal figure',
  '论文配图', '学术插图', '科研图', '学术图表',
] as const

function isAcademicFigureRequest(prompt: string): boolean {
  const lower = prompt.toLowerCase()
  return ACADEMIC_FIGURE_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()))
}

const NANOBANANA_MAX_ATTEMPTS = 3
const MAX_REFERENCE_IMAGES = 4

function isRemoteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim())
}

function normalizeSelectedStyleImageIds(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean)))
}

function isImageReferenceRole(value: unknown): value is ImageReferenceRole {
  return value === 'primary-style' || value === 'style' || value === 'content'
}

function normalizeReferenceIdentifier(item: ReferenceImagePayload | undefined, index: number): string {
  const candidate = String(item?.id || item?.documentId || item?.filePath || item?.url || '').trim()
  return candidate || `reference-${index}`
}

function normalizeReferenceRole(
  item: ReferenceImagePayload | undefined,
  index: number,
  primaryImageId?: string | null,
): ImageReferenceRole {
  if (isImageReferenceRole(item?.role)) return item.role

  const normalizedPrimaryId = String(primaryImageId || '').trim()
  const currentId = normalizeReferenceIdentifier(item, index)
  const isPrimary = typeof item?.isPrimary === 'boolean'
    ? item.isPrimary
    : Boolean(normalizedPrimaryId ? currentId === normalizedPrimaryId : index === 0)

  return isPrimary ? 'primary-style' : 'style'
}

function normalizeReferenceWeight(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, value)
}

function referenceRoleSortValue(role: ImageReferenceRole): number {
  if (role === 'primary-style') return 0
  if (role === 'style') return 1
  return 2
}

function resolveOutboundImageSource(referenceImage: NormalizedReferenceImagePayload): string | undefined {
  if (referenceImage.dataUrl) return referenceImage.dataUrl
  if (referenceImage.url && (referenceImage.url.startsWith('data:') || isRemoteHttpUrl(referenceImage.url))) {
    return referenceImage.url
  }
  if (referenceImage.filePath && isRemoteHttpUrl(referenceImage.filePath)) {
    return referenceImage.filePath
  }
  return undefined
}

function sanitizeOutboundReferenceImages(referenceImages: NormalizedReferenceImagePayload[]): Array<Record<string, unknown>> {
  return referenceImages
    .map((item) => {
      const outboundSource = resolveOutboundImageSource(item)
      if (!outboundSource) return null

      return {
        id: item.id,
        ...(item.documentId ? { documentId: item.documentId } : {}),
        order: item.order,
        role: item.role,
        weight: item.weight,
        isPrimary: item.isPrimary,
        ...(item.origin ? { origin: item.origin } : {}),
        ...(item.fileName ? { fileName: item.fileName } : {}),
        ...(item.contentType ? { contentType: item.contentType } : {}),
        ...(outboundSource.startsWith('data:') ? { dataUrl: outboundSource } : { url: outboundSource }),
      }
    })
    .filter(Boolean) as Array<Record<string, unknown>>
}

function normalizeDebugPayload(debug: ImageGenerationParams['debug']): { enabled: boolean; source?: string } | undefined {
  if (!debug) return undefined
  return {
    enabled: Boolean(debug.enabled),
    ...(typeof debug.source === 'string' && debug.source.trim() ? { source: debug.source } : {}),
  }
}

function buildImageRequestSummary(
  settings: AppSettings,
  endpoint: string,
  params: ImageGenerationParams,
  sanitizedPrompt: string,
  finalPrompt: string,
  referenceImages: NormalizedReferenceImagePayload[],
  outboundImages: string[],
  requestBody: Record<string, unknown>,
  removedKeywords: string[],
  fallbackNotes: string[],
  attachedToRequest: boolean,
): Record<string, unknown> {
  const styleOptions = normalizeImageStyleOptions(params.styleOptions)
  const primaryReferenceId = referenceImages.find((item) => item.role === 'primary-style')?.id || null
  const selectedStyleImageIds = normalizeSelectedStyleImageIds(params.selectedStyleImageIds)
  return {
    provider: settings.image.provider,
    endpoint,
    model: settings.image.model,
    aspectRatio: params.aspectRatio,
    generationMode: params.generationMode || DEFAULT_IMAGE_GENERATION_MODE,
    styleOptions,
    primaryImageId: String(params.primaryImageId || '').trim() || primaryReferenceId,
    selectedStyleImageIds: selectedStyleImageIds.length > 0 ? selectedStyleImageIds : referenceImages.filter((item) => item.role !== 'content').map((item) => item.id),
    rawPrompt: params.prompt,
    sanitizedPrompt,
    finalPrompt,
    negativePrompt: typeof requestBody.negativePrompt === 'string' ? requestBody.negativePrompt : params.negativePrompt || null,
    requestKeys: Object.keys(requestBody),
    outboundImageField: 'images',
    referenceImageCount: referenceImages.length,
    outboundImageCount: outboundImages.length,
    attachedToRequest,
    styleProfileSummary: params.styleProfile?.summary || null,
    removedKeywords,
    fallbackNotes,
    referenceImages: referenceImages.map((item) => {
      const outboundSource = resolveOutboundImageSource(item)
      const localPathName = item.filePath && !isRemoteHttpUrl(item.filePath)
        ? path.basename(item.filePath)
        : null

      return {
        id: item.id,
        documentId: item.documentId || null,
        order: item.order,
        role: item.role,
        weight: item.weight,
        isPrimary: item.isPrimary,
        origin: item.origin || null,
        fileName: item.fileName || localPathName,
        contentType: item.contentType || null,
        localPathName,
        hasDataUrl: Boolean(item.dataUrl),
        hasUrl: Boolean(item.url),
        hasRemoteUrl: Boolean(item.filePath && isRemoteHttpUrl(item.filePath)),
        outboundIncluded: Boolean(outboundSource),
        outboundSourceType: outboundSource
          ? (outboundSource.startsWith('data:') ? 'data-url' : 'remote-url')
          : null,
      }
    }),
    outboundImages: outboundImages.map((item, index) => ({
      index,
      sourceType: item.startsWith('data:') ? 'data-url' : 'remote-url',
      preview: item.startsWith('data:') ? `${item.slice(0, 32)}...` : item,
    })),
  }
}

function buildStructuredDebugLog(
  settings: AppSettings,
  endpoint: string,
  params: ImageGenerationParams,
  sanitizedPrompt: string,
  finalPrompt: string,
  referenceImages: NormalizedReferenceImagePayload[],
  outboundImages: string[],
  requestBody: Record<string, unknown>,
  removedKeywords: string[],
  fallbackNotes: string[],
  attachedToRequest: boolean,
): ImageGenerationDebugLog {
  const styleOptions = normalizeImageStyleOptions(params.styleOptions)
  const references = buildImageReferenceDebugItems(referenceImages.map((item) => ({
    id: item.id,
    url: resolveOutboundImageSource(item) || item.url || item.filePath || '',
    role: item.role,
    weight: item.weight,
    name: item.fileName || item.documentId || item.id,
    origin: item.origin,
    order: item.order,
  })))
  const primaryReference = references.find((item) => item.role === 'primary-style') || null

  return {
    rawUserPrompt: params.prompt,
    sanitizedPrompt,
    finalPrompt,
    generationMode: params.generationMode || DEFAULT_IMAGE_GENERATION_MODE,
    styleStrength: styleOptions.styleStrength,
    strictStyleLock: styleOptions.strictStyleLock,
    preserveComposition: styleOptions.preserveComposition,
    creativity: styleOptions.creativity,
    references,
    primaryReference: primaryReference
      ? {
        id: primaryReference.id,
        name: primaryReference.name,
        role: primaryReference.role,
        weight: primaryReference.weight,
      }
      : null,
    styleProfile: params.styleProfile || null,
    attachedToRequest,
    requestPayloadSummary: buildImageRequestSummary(
      settings,
      endpoint,
      params,
      sanitizedPrompt,
      finalPrompt,
      referenceImages,
      outboundImages,
      requestBody,
      removedKeywords,
      fallbackNotes,
      attachedToRequest,
    ),
    removedKeywords,
    fallbackNotes,
  }
}

function logImageRequestSummary(
  settings: AppSettings,
  endpoint: string,
  params: ImageGenerationParams,
  sanitizedPrompt: string,
  finalPrompt: string,
  referenceImages: NormalizedReferenceImagePayload[],
  outboundImages: string[],
  requestBody: Record<string, unknown>,
  removedKeywords: string[],
  fallbackNotes: string[],
  attachedToRequest: boolean,
): void {
  const summary = buildImageRequestSummary(
    settings,
    endpoint,
    params,
    sanitizedPrompt,
    finalPrompt,
    referenceImages,
    outboundImages,
    requestBody,
    removedKeywords,
    fallbackNotes,
    attachedToRequest,
  )
  console.info('[ai:image][request-summary]', JSON.stringify(summary, null, 2))

  if (params.debug?.enabled) {
    const debugLog = buildStructuredDebugLog(
      settings,
      endpoint,
      params,
      sanitizedPrompt,
      finalPrompt,
      referenceImages,
      outboundImages,
      requestBody,
      removedKeywords,
      fallbackNotes,
      attachedToRequest,
    )
    console.info('[Image Generation Debug]', JSON.stringify(debugLog, null, 2))
  }
}

function ensureImageConfigured(settings: AppSettings): void {
  if (!settings.image.apiKey.trim()) {
    if (settings.image.useBuiltinKey) {
      throw new Error(`当前图片提供方 ${settings.image.provider} 没有可用的内置 API Key，请在设置中关闭内置 Key 或手动填写 API Key`)
    }
    throw new Error('请先在设置中配置图片模型 API Key')
  }
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true })
}

async function saveImageFromUrl(url: string, outputDir: string): Promise<string> {
  await ensureDir(outputDir)
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`图片下载失败: ${response.status}`)
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  const ext = path.extname(new URL(url).pathname) || '.png'
  const filePath = path.join(outputDir, `image-${Date.now()}${ext}`)
  await fs.writeFile(filePath, buffer)
  return filePath
}

async function saveBase64Image(base64Data: string, outputDir: string): Promise<string> {
  await ensureDir(outputDir)
  const filePath = path.join(outputDir, `image-${Date.now()}.png`)
  await fs.writeFile(filePath, Buffer.from(base64Data, 'base64'))
  return filePath
}

function getObjectCandidate(value: unknown): Record<string, any> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : undefined
}

function getFirstObjectCandidate(value: unknown): Record<string, any> | undefined {
  if (!Array.isArray(value)) return undefined
  return getObjectCandidate(value[0])
}

function normalizeBase64Payload(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined

  const dataUrlMatch = trimmed.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/)
  return (dataUrlMatch?.[1] ?? trimmed).trim() || undefined
}

function extractStringField(candidates: Array<unknown>, fields: string[]): string | undefined {
  for (const candidate of candidates) {
    const objectCandidate = getObjectCandidate(candidate)
    if (!objectCandidate) continue

    for (const field of fields) {
      const value = objectCandidate[field]
      if (typeof value === 'string' && value.trim()) {
        return value.trim()
      }
    }
  }

  return undefined
}

async function delay(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

function normalizeReferenceImages(params: ImageGenerationParams): NormalizedReferenceImagePayload[] {
  const sourceItems = Array.isArray(params.references) && params.references.length > 0
    ? params.references
    : params.referenceImages
  if (!Array.isArray(sourceItems)) return []

  const seenIds = new Set<string>()
  const provisional = sourceItems
    .map((item, index) => {
      const id = normalizeReferenceIdentifier(item, index)
      if (seenIds.has(id)) return null
      seenIds.add(id)

      const documentId = typeof item?.documentId === 'string' ? item.documentId.trim() : ''
      const order = typeof item?.order === 'number' && Number.isFinite(item.order)
        ? Math.max(0, Math.floor(item.order))
        : index
      const filePath = typeof item?.filePath === 'string' ? item.filePath.trim() : ''
      const fileName = typeof item?.fileName === 'string' ? item.fileName.trim() : ''
      const contentType = typeof item?.contentType === 'string' ? item.contentType.trim() : ''
      const dataUrl = typeof item?.dataUrl === 'string' ? item.dataUrl.trim() : ''
      const url = typeof item?.url === 'string' ? item.url.trim() : ''
      const role = normalizeReferenceRole(item, index, params.primaryImageId)
      const weight = normalizeReferenceWeight(item?.weight)

      if (!filePath && !dataUrl && !url) return null

      return {
        id,
        ...(documentId ? { documentId } : {}),
        order,
        role,
        weight,
        isPrimary: role === 'primary-style',
        ...(item?.origin ? { origin: item.origin } : {}),
        ...(url ? { url } : {}),
        ...(filePath ? { filePath } : {}),
        ...(fileName ? { fileName } : {}),
        ...(contentType ? { contentType } : {}),
        ...(dataUrl ? { dataUrl } : {}),
      }
    })
    .filter((item): item is NormalizedReferenceImagePayload => Boolean(item))

  if (provisional.length === 0) return []

  const normalizedSelections = normalizeImageReferenceSelections(
    provisional.map((item) => ({
      id: item.id,
      role: item.role,
      weight: item.weight,
    })),
    String(params.primaryImageId || '').trim() || provisional.find((item) => item.role === 'primary-style')?.id,
  )
  const selectionMap = new Map(normalizedSelections.map((item) => [item.id, item]))

  return provisional
    .map((item) => {
      const normalizedSelection = selectionMap.get(item.id)
      if (!normalizedSelection) return item
      return {
        ...item,
        role: normalizedSelection.role,
        weight: normalizedSelection.weight,
        isPrimary: normalizedSelection.role === 'primary-style',
      }
    })
    .sort((left, right) => {
      const roleDiff = referenceRoleSortValue(left.role) - referenceRoleSortValue(right.role)
      if (roleDiff !== 0) return roleDiff
      return left.order - right.order
    })
    .slice(0, MAX_REFERENCE_IMAGES)
    .map((item, index) => ({
      ...item,
      order: index,
    }))
}

function isRetriableNanobananaError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()

  if (message.includes('401') || message.includes('403') || message.includes('没有可用的内置 api key')) {
    return false
  }

  return (
    message.includes('408') ||
    message.includes('409') ||
    message.includes('425') ||
    message.includes('429') ||
    message.includes('500') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('fetch failed') ||
    message.includes('network') ||
    message.includes('socket') ||
    message.includes('empty response') ||
    message.includes('返回空响应') ||
    message.includes('未返回流式响应') ||
    message.includes('未返回最终图片地址') ||
    message.includes('未返回图片地址') ||
    message.includes('无法识别的响应') ||
    message.includes('服务端返回未知错误')
  )
}

async function generateNanobananaImage(
  settings: AppSettings,
  outputDir: string,
  params: ImageGenerationParams,
  onProgress?: ProgressReporter,
): Promise<ImageGenerationResult> {
  let lastError: unknown = undefined
  const referenceImages = normalizeReferenceImages(params)
  const styleOptions = normalizeImageStyleOptions(params.styleOptions)
  const generationMode = params.generationMode || DEFAULT_IMAGE_GENERATION_MODE
  const structuredReferences = referenceImages.map((item) => ({
    id: item.id,
    url: resolveOutboundImageSource(item) || item.url || item.filePath || '',
    role: item.role,
    weight: item.weight,
    name: item.fileName || item.documentId || item.id,
    origin: item.origin,
    filePath: item.filePath,
    fileName: item.fileName,
    contentType: item.contentType,
    dataUrl: item.dataUrl,
    order: item.order,
  }))

  for (let attempt = 1; attempt <= NANOBANANA_MAX_ATTEMPTS; attempt++) {
    try {
      if (attempt > 1) {
        onProgress?.(`图片生成重试中 (${attempt}/${NANOBANANA_MAX_ATTEMPTS})`)
      }

      const academicMode = isAcademicFigureRequest(params.prompt)
      const systemPrefix = academicMode ? IMAGE_ACADEMIC_SYSTEM_PROMPT : IMAGE_DEFAULT_GUARD
      const promptBuild = buildFinalImagePrompt({
        prompt: params.prompt,
        negativePrompt: params.negativePrompt,
        aspectRatio: params.aspectRatio,
        references: structuredReferences,
        styleOptions,
        generationMode,
        styleProfile: params.styleProfile || null,
        traceId: params.traceId,
        debug: normalizeDebugPayload(params.debug),
      })
      const finalPrompt = `${systemPrefix}\n\n${promptBuild.finalPrompt}`

      // ── traceId prompt-breakdown log ────────────────────────────────────────
      const traceId = typeof params.traceId === 'string'
        ? params.traceId
        : `img-main-${Date.now()}`
      console.info('[image:prompt-builder]', JSON.stringify({
        traceId,
        handlerName: 'generateNanobananaImage',
        serviceName: 'imageClient',
        academicMode,
        rawUserPrompt: params.prompt,
        sanitizedUserPrompt: promptBuild.sanitizedPrompt,
        systemPromptPrefix: systemPrefix,
        styleProfilePrompt: promptBuild.styleProfilePrompt || '(none — no style profile)',
        rolePrompt: promptBuild.rolePrompt || '(none — no structured references)',
        finalRequestPrompt: finalPrompt,
        referenceImageCount: referenceImages.length,
        removedKeywords: promptBuild.removedKeywords,
        fallbackNotes: promptBuild.fallbackNotes,
        styleInstructionEnabled: referenceImages.length > 0,
      }))
      const outboundImages = referenceImages
        .map((item) => resolveOutboundImageSource(item))
        .filter((item): item is string => Boolean(item))
      const outboundReferenceImages = sanitizeOutboundReferenceImages(referenceImages)
      const attachedToRequest = outboundImages.length > 0
      const fallbackNotes = [...promptBuild.fallbackNotes]
      if (referenceImages.length > 0 && !attachedToRequest) {
        fallbackNotes.push('Reference images exist but none could be serialized for provider upload; prompt-only guidance was used.')
      }

      const requestBody: Record<string, unknown> = {
        model: settings.image.model,
        prompt: finalPrompt,
        aspectRatio: params.aspectRatio,
        shutProgress: false,
      }

      if (promptBuild.negativePrompt) {
        requestBody.negativePrompt = promptBuild.negativePrompt
      }

      if (outboundImages.length > 0) {
        requestBody.referenceImages = outboundReferenceImages
        requestBody.images = outboundImages
      }

      logImageRequestSummary(
        settings,
        settings.image.endpoint.trim(),
        params,
        promptBuild.sanitizedPrompt,
        finalPrompt,
        referenceImages,
        outboundImages,
        requestBody,
        promptBuild.removedKeywords,
        fallbackNotes,
        attachedToRequest,
      )

      const response = await fetch(settings.image.endpoint.trim(), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${settings.image.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        throw new Error(`Nanobanana 调用失败: ${response.status} ${await response.text()}`)
      }

      const resolved = await parseNanobananaResponse(response, onProgress)
      if (resolved.base64) {
        const localPath = await saveBase64Image(resolved.base64, outputDir)
        return { localPath, sourceUrl: '', model: settings.image.model }
      }
      if (!resolved.url) {
        throw new Error('图片服务未返回图片地址')
      }

      const localPath = await saveImageFromUrl(resolved.url, outputDir)
      return { localPath, sourceUrl: resolved.url, model: settings.image.model }
    } catch (error) {
      lastError = error
      if (attempt >= NANOBANANA_MAX_ATTEMPTS || !isRetriableNanobananaError(error)) {
        throw error
      }

      const retryDelay = 1000 * attempt
      onProgress?.(`图片生成异常，${retryDelay / 1000} 秒后重试`)
      await delay(retryDelay)
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? '图片生成失败'))
}

async function parseNanobananaEventStream(
  response: Response,
  onProgress?: (message: string) => void,
): Promise<ResolvedImagePayload> {
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('Nanobanana 未返回流式响应')
  }
  const decoder = new TextDecoder()
  let buffer = ''
  let lastResolved: ResolvedImagePayload = {}

  const processPayload = (payload: string): ResolvedImagePayload | undefined => {
    try {
      const data = JSON.parse(payload) as Record<string, any>
      const status = data.status ?? data.type ?? 'processing'
      onProgress?.(`图片生成中: ${status}`)

      const resolved = extractResolvedImagePayload(data)
      if (resolved.url || resolved.base64) {
        lastResolved = resolved
      }

      if ((status === 'succeeded' || status === 'completed') && (resolved.url || resolved.base64)) {
        return resolved
      }

      if (status === 'failed') {
        const reason = data.failure_reason ?? data.error
        const msg = (!reason || reason === 'error') ? '图片生成失败（服务端返回未知错误，请稍后重试）' : reason
        throw new Error(msg)
      }
    } catch (error) {
      if (error instanceof Error && error.message !== payload) {
        throw error
      }
    }

    return undefined
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      const resolved = processPayload(payload)
      if (resolved) {
        return resolved
      }
    }
  }

  const trailingLine = buffer.trim()
  if (trailingLine.startsWith('data:')) {
    const payload = trailingLine.slice(5).trim()
    const resolved = processPayload(payload)
    if (resolved) {
      return resolved
    }
  }

  if (lastResolved.url || lastResolved.base64) {
    return lastResolved
  }

  throw new Error('图片服务未返回最终图片地址')
}

function extractResolvedImagePayload(data: Record<string, any> | null | undefined): ResolvedImagePayload {
  if (!data || typeof data !== 'object') return {}

  const firstData = getFirstObjectCandidate(data.data)
  const firstResult = getFirstObjectCandidate(data.results)
  const result = getObjectCandidate(data.result)
  const output = getObjectCandidate(data.output)
  const image = getObjectCandidate(data.image)
  const response = getObjectCandidate(data.response)
  const message = getObjectCandidate(data.message)
  const nestedOutputImage = getObjectCandidate(output?.image)
  const nestedOutputData = getFirstObjectCandidate(output?.data)
  const nestedResultImage = getObjectCandidate(result?.image)

  const candidates = [
    firstResult,
    result,
    output,
    firstData,
    image,
    response,
    message,
    nestedOutputImage,
    nestedOutputData,
    nestedResultImage,
    data,
  ]

  const url = extractStringField(candidates, [
    'url',
    'image_url',
    'imageUrl',
    'file_url',
    'fileUrl',
    'download_url',
    'downloadUrl',
    'source_url',
    'sourceUrl',
    'local_image_url',
  ])

  const base64 = normalizeBase64Payload(
    extractStringField(candidates, [
      'b64_json',
      'b64',
      'base64',
      'image_base64',
      'base64_data',
      'data',
    ]),
  )

  return {
    url,
    base64,
  }
}

async function parseNanobananaResponse(
  response: Response,
  onProgress?: (message: string) => void,
): Promise<ResolvedImagePayload> {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase()
  if (contentType.includes('text/event-stream')) {
    return parseNanobananaEventStream(response, onProgress)
  }

  if (contentType.includes('application/json')) {
    const data = await response.json() as Record<string, any>
    const status = data.status ?? data.type ?? 'completed'
    onProgress?.(`图片生成中: ${status}`)
    if (status === 'failed') {
      const reason = data.failure_reason ?? data.error
      throw new Error((!reason || reason === 'error') ? '图片生成失败（服务端返回未知错误，请稍后重试）' : reason)
    }
    const resolved = extractResolvedImagePayload(data)
    if (resolved.url || resolved.base64) {
      return resolved
    }
    throw new Error('图片服务未返回最终图片地址')
  }

  const rawText = await response.text()
  const trimmed = rawText.trim()
  if (!trimmed) {
    throw new Error('图片服务返回空响应')
  }

  if (trimmed.startsWith('data:')) {
    const events = trimmed.split('\n')
    let lastResolved: ResolvedImagePayload = {}
    for (const rawLine of events) {
      const line = rawLine.trim()
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6)
      const data = JSON.parse(payload) as Record<string, any>
      const status = data.status ?? data.type ?? 'processing'
      onProgress?.(`图片生成中: ${status}`)
      if (status === 'failed') {
        const reason = data.failure_reason ?? data.error
        throw new Error((!reason || reason === 'error') ? '图片生成失败（服务端返回未知错误，请稍后重试）' : reason)
      }
      const resolved = extractResolvedImagePayload(data)
      if (resolved.url || resolved.base64) {
        lastResolved = resolved
      }
    }
    if (lastResolved.url || lastResolved.base64) {
      return lastResolved
    }
  }

  try {
    const data = JSON.parse(trimmed) as Record<string, any>
    const resolved = extractResolvedImagePayload(data)
    if (resolved.url || resolved.base64) {
      return resolved
    }
  } catch {
    // ignore and fall through
  }

  throw new Error(`图片服务返回了无法识别的响应: ${trimmed.slice(0, 300)}`)
}

export async function generateImage(
  settings: AppSettings,
  outputDir: string,
  params: ImageGenerationParams,
  onProgress?: (message: string) => void,
): Promise<ImageGenerationResult> {
  ensureImageConfigured(settings)
  const traceId = typeof params.traceId === 'string'
    ? params.traceId
    : `img-main-${Date.now()}`
  assertPromptEncodingSafe(params, traceId)
  const referenceImages = normalizeReferenceImages(params)
  const styleOptions = normalizeImageStyleOptions(params.styleOptions)
  const generationMode = params.generationMode || DEFAULT_IMAGE_GENERATION_MODE
  const structuredReferences = referenceImages.map((item) => ({
    id: item.id,
    url: resolveOutboundImageSource(item) || item.url || item.filePath || '',
    role: item.role,
    weight: item.weight,
    name: item.fileName || item.documentId || item.id,
    origin: item.origin,
    filePath: item.filePath,
    fileName: item.fileName,
    contentType: item.contentType,
    dataUrl: item.dataUrl,
    order: item.order,
  }))

  if (settings.image.provider === 'nanobanana') {
    return generateNanobananaImage(settings, outputDir, { ...params, references: structuredReferences, referenceImages }, onProgress)
  }

  const isOpenAi = settings.image.provider === 'openai-image'
  const endpoint = isOpenAi
    ? 'https://api.openai.com/v1/images/generations'
    : settings.image.endpoint.trim()

  const academicMode = isAcademicFigureRequest(params.prompt)
  const systemPrefix = academicMode ? IMAGE_ACADEMIC_SYSTEM_PROMPT : IMAGE_DEFAULT_GUARD
  const promptBuild = buildFinalImagePrompt({
    prompt: params.prompt,
    negativePrompt: params.negativePrompt,
    aspectRatio: params.aspectRatio,
    references: structuredReferences,
    styleOptions,
    generationMode,
    styleProfile: params.styleProfile || null,
    traceId: params.traceId,
    debug: normalizeDebugPayload(params.debug),
  })
  const finalPrompt = `${systemPrefix}\n\n${promptBuild.finalPrompt}`
  const fallbackNotes = [...promptBuild.fallbackNotes]
  console.info('[image:prompt-builder][generic-path]', JSON.stringify({
    traceId,
    handlerName: 'generateImage (non-nanobanana)',
    provider: settings.image.provider,
    academicMode,
    rawUserPrompt: params.prompt,
    sanitizedUserPrompt: promptBuild.sanitizedPrompt,
    systemPromptPrefix: systemPrefix,
    styleProfilePrompt: promptBuild.styleProfilePrompt || '(none — no style profile)',
    rolePrompt: promptBuild.rolePrompt || '(none — no structured references)',
    finalRequestPrompt: finalPrompt,
    referenceImageCount: referenceImages.length,
    removedKeywords: promptBuild.removedKeywords,
    fallbackNotes,
    styleInstructionEnabled: referenceImages.length > 0,
  }))
  if (isOpenAi && referenceImages.length > 0) {
    fallbackNotes.push('Current provider does not support direct reference image upload; style inheritance is downgraded to prompt-only guidance.')
    onProgress?.('当前图片提供方不支持直接上传参考图，已退化为文本风格锁定')
  }

  const requestBody: Record<string, unknown> = {
    model: settings.image.model,
    prompt: finalPrompt,
    size: params.aspectRatio === '16:9' ? '1536x1024' : '1024x1024',
    quality: 'standard',
    response_format: 'b64_json',
  }

  if (!isOpenAi && promptBuild.negativePrompt) {
    requestBody.negativePrompt = promptBuild.negativePrompt
  }

  const outboundImages = referenceImages
    .map((item) => resolveOutboundImageSource(item))
    .filter((item): item is string => Boolean(item))
  const outboundReferenceImages = sanitizeOutboundReferenceImages(referenceImages)
  const attachedToRequest = !isOpenAi && outboundImages.length > 0

  if (!isOpenAi && outboundImages.length > 0) {
    requestBody.referenceImages = outboundReferenceImages
    requestBody.images = outboundImages
  } else if (!isOpenAi && referenceImages.length > 0) {
    fallbackNotes.push('Reference images were selected but none could be serialized; provider received prompt-only style guidance.')
  }

  logImageRequestSummary(
    settings,
    endpoint,
    params,
    promptBuild.sanitizedPrompt,
    finalPrompt,
    referenceImages,
    outboundImages,
    requestBody,
    promptBuild.removedKeywords,
    fallbackNotes,
    attachedToRequest,
  )

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${settings.image.apiKey}`,
    },
    body: JSON.stringify(requestBody),
  })

  if (!response.ok) {
    throw new Error(`图片接口调用失败: ${response.status} ${await response.text()}`)
  }

  const data = (await response.json()) as Record<string, any>
  const item = data.data?.[0]
  if (!item) {
    throw new Error('图片接口未返回结果')
  }

  if (item.b64_json) {
    const localPath = await saveBase64Image(item.b64_json, outputDir)
    return { localPath, sourceUrl: '', model: settings.image.model }
  }

  const localPath = await saveImageFromUrl(item.url, outputDir)
  return { localPath, sourceUrl: item.url, model: settings.image.model }
}

export async function testImageConnection(settings: AppSettings): Promise<string> {
  ensureImageConfigured(settings)
  return `${settings.image.provider}:${settings.image.model}`
}
