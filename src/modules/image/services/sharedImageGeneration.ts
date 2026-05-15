import { generateImage } from './ImageService'
import {
  buildImageReferenceDebugItems,
  summarizeImageReferenceRoles,
} from './imageGenerationPrompt'
import { getBackendUrl } from '../../../config'
import type { KnowledgeDocumentMeta } from '../../../types/knowledge'
import type {
  GenerateImagePayload,
  ImageGenerationMode,
  ImageReferenceItem,
  ImageReferenceSelection,
  ImageStyleOptions,
  ImageStyleProfile,
} from '../../../types/imageGeneration'

const IMAGE_ACTION_FRAGMENT = '(?:生成|创建|制作|输出|做|画|绘制|出图|create|generate|make|draw|illustrate)'
const IMAGE_TARGET_FRAGMENT = '(?:图片|图像|配图|插图|海报|插画|封面图|示意图|效果图|banner|poster|cover(?:\\s+image)?|image|illustration|visual)'
const IMAGE_INTENT_PATTERNS = [
  new RegExp(`${IMAGE_ACTION_FRAGMENT}[\\s\\S]{0,18}${IMAGE_TARGET_FRAGMENT}`, 'i'),
  new RegExp(`${IMAGE_TARGET_FRAGMENT}[\\s\\S]{0,8}${IMAGE_ACTION_FRAGMENT}`, 'i'),
]

export interface RunSharedImageGenerationParams {
  prompt: string
  knowledgeRootPath?: string
  documents: KnowledgeDocumentMeta[]
  imageReferences: ImageReferenceSelection[]
  styleOptions: ImageStyleOptions
  generationMode: ImageGenerationMode
  activeStyleProfile?: ImageStyleProfile | null
  aspectRatio?: string
  source: string
  knowledgeTextContext?: string
  documentContext?: string
  debugContext?: Record<string, unknown>
  onStatus?: (message: string) => void | Promise<void>
  onStyleProfileChange?: (profile: ImageStyleProfile | null) => void | Promise<void>
}

export interface RunSharedImageGenerationResult {
  traceId: string
  payload: GenerateImagePayload & { aspectRatio: string }
  references: ImageReferenceItem[]
  primaryReference: ImageReferenceItem | null
  styleProfile: ImageStyleProfile | null
  roleSummary: string[]
  result: Awaited<ReturnType<typeof generateImage>>
}

function resolveKnowledgeAbsolutePath(rootPath: string | undefined, document: KnowledgeDocumentMeta): string {
  const basePath = String(rootPath || '').replace(/[\\/]+$/g, '')
  const relativePath = String(document.storedRelativePath || '').replace(/^[\\/]+/g, '')
  return basePath && relativePath ? `${basePath}/${relativePath}` : relativePath
}

function toDisplayUrl(rawPath: string): string {
  const value = String(rawPath || '').trim()
  if (!value) return value
  if (/^(https?:)?\/\//i.test(value) || value.startsWith('data:') || value.startsWith('file:///')) {
    return value
  }
  if (value.startsWith('/')) {
    return `file://${encodeURI(value)}`
  }
  if (/^[a-zA-Z]:[\\/]/.test(value)) {
    return `file:///${encodeURI(value.replace(/\\/g, '/'))}`
  }
  return `${getBackendUrl()}${value.startsWith('/') ? value : `/${value}`}`
}

export function isExplicitImageGenerationRequest(value: string): boolean {
  const normalized = String(value || '').trim()
  if (!normalized) return false
  return IMAGE_INTENT_PATTERNS.some((pattern) => pattern.test(normalized))
}

export function orderSelectedKnowledgeDocuments(documents: KnowledgeDocumentMeta[], selectedDocumentIds: string[], primaryDocumentId: string | null): KnowledgeDocumentMeta[] {
  const documentMap = new Map(documents.map((item) => [item.id, item]))
  const orderedIds = Array.from(new Set([
    primaryDocumentId,
    ...selectedDocumentIds,
  ].map((item) => String(item || '').trim()).filter(Boolean)))

  return orderedIds
    .map((documentId) => documentMap.get(documentId) || null)
    .filter((item): item is KnowledgeDocumentMeta => Boolean(item))
}

export function resolveActiveImageStyleProfile(profile: ImageStyleProfile | null | undefined, primaryReferenceId: string | null | undefined): ImageStyleProfile | null {
  if (!profile) return null
  if (primaryReferenceId && profile.sourceImageId !== primaryReferenceId) {
    return null
  }
  return profile
}

export async function resolveStructuredImageReferences(
  knowledgeRootPath: string | undefined,
  selectedDocuments: KnowledgeDocumentMeta[],
  imageReferences: Array<Pick<ImageReferenceItem, 'id' | 'role' | 'weight' | 'order'>>,
): Promise<ImageReferenceItem[]> {
  if (!knowledgeRootPath || selectedDocuments.length === 0 || imageReferences.length === 0) return []

  const referenceOrder = new Map(imageReferences.map((item, index) => [item.id, index]))
  const limitedDocuments = selectedDocuments
    .filter((item) => item.sourceType === 'image' && referenceOrder.has(item.id))
    .sort((left, right) => (referenceOrder.get(left.id) ?? 999) - (referenceOrder.get(right.id) ?? 999))
    .slice(0, 4)
  const imageReferenceMap = new Map(imageReferences.map((item) => [item.id, item]))

  const results = await Promise.all(limitedDocuments.map(async (item, index) => {
    const absolutePath = resolveKnowledgeAbsolutePath(knowledgeRootPath, item)
    const reference = imageReferenceMap.get(item.id)
    const fallbackUrl = toDisplayUrl(absolutePath)
    try {
      const imageData = await window.electronAPI.readImageAsDataUrl(absolutePath)
      return {
        id: item.id,
        url: imageData.dataUrl || fallbackUrl,
        role: reference?.role || 'style',
        weight: reference?.weight || 0,
        name: item.title,
        thumbnailUrl: fallbackUrl,
        origin: 'knowledge-base' as const,
        order: reference?.order ?? index,
        filePath: absolutePath,
        fileName: imageData.fileName || item.originalName || item.title,
        contentType: imageData.contentType,
        dataUrl: imageData.dataUrl,
      }
    } catch {
      return {
        id: item.id,
        url: fallbackUrl,
        role: reference?.role || 'style',
        weight: reference?.weight || 0,
        name: item.title,
        thumbnailUrl: fallbackUrl,
        origin: 'knowledge-base' as const,
        order: reference?.order ?? index,
        filePath: absolutePath,
        fileName: item.originalName || item.title,
      }
    }
  }))

  const resolvedReferences = results.filter(Boolean) as ImageReferenceItem[]
  return resolvedReferences.sort((left, right) => (left.order ?? 999) - (right.order ?? 999))
}

export async function runSharedImageGeneration(params: RunSharedImageGenerationParams): Promise<RunSharedImageGenerationResult> {
  const normalizedPrompt = String(params.prompt || '').trim()
  if (!normalizedPrompt) {
    throw new Error('请先输入图片需求')
  }

  const traceId = `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const orderedSelections = params.imageReferences.map((item, index) => ({ ...item, order: index }))
  const references = await resolveStructuredImageReferences(params.knowledgeRootPath, params.documents, orderedSelections)
  const primaryReference = references.find((item) => item.role === 'primary-style') || null
  const styleProfile = null
  if (params.activeStyleProfile) {
    await params.onStyleProfileChange?.(null)
  }

  const contextSuffix = [
    params.documentContext ? `\n\nDocument context: ${params.documentContext}` : '',
    params.knowledgeTextContext ? `\n\nKnowledge base reference: ${params.knowledgeTextContext}` : '',
  ].join('')

  const payload: GenerateImagePayload & { aspectRatio: string } = {
    prompt: normalizedPrompt + contextSuffix,
    aspectRatio: params.aspectRatio || '16:9',
    references,
    styleOptions: params.styleOptions,
    generationMode: params.generationMode,
    styleProfile,
    traceId,
    debug: {
      enabled: true,
      source: params.source,
    },
  }

  console.info('[image:ui-submit]', JSON.stringify({
    traceId,
    source: params.source,
    rawUserPrompt: payload.prompt,
    generationMode: payload.generationMode,
    styleOptions: payload.styleOptions,
    referenceImageCount: references.length,
    primaryReferenceId: primaryReference?.id || null,
    references: buildImageReferenceDebugItems(references),
    roleSummary: summarizeImageReferenceRoles(references),
    styleProfileSummary: null,
    styleProfileMode: 'disabled-local-analysis',
    ...params.debugContext,
  }))

  await params.onStatus?.(
    references.length > 0
      ? `正在生成图片，并带入 ${references.length} 张结构化参考图...`
      : '正在生成图片，请稍候...',
  )

  const result = await generateImage(payload)
  return {
    traceId,
    payload,
    references,
    primaryReference,
    styleProfile,
    roleSummary: summarizeImageReferenceRoles(references),
    result,
  }
}