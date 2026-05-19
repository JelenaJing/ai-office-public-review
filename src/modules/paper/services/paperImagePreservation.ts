import type { DocumentBlock, DocumentResource, DocumentSchema, ImageBlock } from '../../../document/schema'

type PreservedImage = {
  block: ImageBlock
  resource: DocumentResource
  identityKeys: Set<string>
}

function cloneBlock<T extends DocumentBlock>(block: T): T {
  return JSON.parse(JSON.stringify(block)) as T
}

function cloneResource(resource: DocumentResource): DocumentResource {
  return JSON.parse(JSON.stringify(resource)) as DocumentResource
}

function normalizeTextKey(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\s*\[?\d+\]?[.、\s-]*/, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim()
}

function normalizePathKey(value: unknown): string {
  const raw = String(value || '').trim().replace(/^file:\/\/\/?/i, '').replace(/\\/g, '/')
  if (!raw) return ''
  try {
    return decodeURI(raw).toLowerCase()
  } catch {
    return raw.toLowerCase()
  }
}

function basenameKey(value: unknown): string {
  const normalized = normalizePathKey(value)
  return normalized.split('/').pop() || ''
}

function figureKeyFromText(value: unknown): string {
  const text = String(value || '')
  const match = text.match(/(?:Figure|Fig\.?|图|图表)\s*(\d+(?:\.\d+)*)/i)
  return match ? `figure:${match[1]}` : ''
}

function getImageCaption(block: ImageBlock, resource?: DocumentResource): string {
  return String(block.value?.caption || block.value?.text || block.metadata?.caption || resource?.metadata?.caption || '').trim()
}

function isValidImageResource(resource: DocumentResource | undefined): resource is DocumentResource {
  if (!resource || resource.kind !== 'image') return false
  const path = normalizePathKey(resource.path || resource.metadata?.localPath || resource.metadata?.url)
  if (!path) return false
  return !/^data:/i.test(path)
}

function buildImageIdentityKeys(block: ImageBlock, resource?: DocumentResource): Set<string> {
  const keys = new Set<string>()
  const fullPath = normalizePathKey(resource?.path || resource?.metadata?.localPath || resource?.metadata?.url)
  const base = basenameKey(fullPath)
  const caption = getImageCaption(block, resource)
  const figure = figureKeyFromText(caption || block.value?.alt || block.metadata?.alt || resource?.metadata?.alt)
  if (fullPath) keys.add(`path:${fullPath}`)
  if (base) keys.add(`basename:${base}`)
  if (figure) keys.add(figure)
  const sectionTitle = normalizeTextKey(block.metadata?.sectionTitle || resource?.metadata?.sectionTitle)
  const figureIndex = String(block.metadata?.figureIndex || resource?.metadata?.figureIndex || '').trim()
  const sectionNum = String(block.metadata?.sectionNum || resource?.metadata?.sectionNum || '').trim()
  if (sectionTitle && figureIndex) keys.add(`section-title:${sectionTitle}:figure:${figureIndex}`)
  if (sectionNum && figureIndex) keys.add(`section-num:${sectionNum}:figure:${figureIndex}`)
  if (caption) keys.add(`caption:${normalizeTextKey(caption)}`)
  return keys
}

function hasSharedIdentity(left: Set<string>, right: Set<string>): boolean {
  for (const key of left) {
    if (right.has(key)) return true
  }
  return false
}

function resourceMap(document: DocumentSchema): Map<string, DocumentResource> {
  return new Map((document.resources || []).map((resource) => [resource.id, resource]))
}

function collectDocumentImages(document: DocumentSchema | null | undefined, includeInvalidResources: boolean): PreservedImage[] {
  if (!document || !Array.isArray(document.blocks)) return []
  const resources = resourceMap(document)
  const images: PreservedImage[] = []
  for (const block of document.blocks) {
    if (block.type !== 'image') continue
    const resource = resources.get(block.resourceRef) || {
      id: block.resourceRef,
      kind: 'image' as const,
      path: '',
      metadata: {},
    }
    if (!includeInvalidResources && !isValidImageResource(resource)) continue
    const imageBlock = cloneBlock(block)
    const imageResource = cloneResource(resource)
    images.push({
      block: imageBlock,
      resource: imageResource,
      identityKeys: buildImageIdentityKeys(imageBlock, imageResource),
    })
  }
  return images
}

export function snapshotExistingPaperImages(document: DocumentSchema | null | undefined): PreservedImage[] {
  return collectDocumentImages(document, false)
}

function findMatchingImageIndex(images: PreservedImage[], target: PreservedImage): number {
  return images.findIndex((candidate) => hasSharedIdentity(candidate.identityKeys, target.identityKeys))
}

function mergeImageMetadata(nextBlock: ImageBlock, nextResource: DocumentResource, current: PreservedImage): { block: ImageBlock; resource: DocumentResource } {
  const caption = getImageCaption(nextBlock, nextResource) || getImageCaption(current.block, current.resource)
  const block: ImageBlock = {
    ...nextBlock,
    value: {
      ...(nextBlock.value || {}),
      ...(caption ? { caption, text: caption } : {}),
      alt: nextBlock.value?.alt || current.block.value?.alt || current.block.metadata?.alt as string | undefined,
    },
    metadata: {
      ...(current.block.metadata || {}),
      ...(nextBlock.metadata || {}),
      ...(caption ? { caption } : {}),
      source: nextBlock.metadata?.source || current.block.metadata?.source || 'paper-generation',
      preservedFromFinalizeMerge: current.block.id !== nextBlock.id || undefined,
    },
  }
  const resource: DocumentResource = {
    ...nextResource,
    path: nextResource.path || current.resource.path,
    mimeType: nextResource.mimeType || current.resource.mimeType,
    width: nextResource.width || current.resource.width,
    height: nextResource.height || current.resource.height,
    metadata: {
      ...(current.resource.metadata || {}),
      ...(nextResource.metadata || {}),
      ...(caption ? { caption } : {}),
      localPath: nextResource.metadata?.localPath || current.resource.metadata?.localPath || current.resource.path,
      source: nextResource.metadata?.source || current.resource.metadata?.source || 'paper-generation',
    },
  }
  return { block, resource }
}

export function resolveImageAnchorForReinsert(blocks: DocumentBlock[], imageBlock: ImageBlock): number {
  const afterBlockId = String(imageBlock.metadata?.afterBlockId || '').trim()
  if (afterBlockId) {
    const index = blocks.findIndex((block) => block.id === afterBlockId)
    if (index >= 0) return index
  }

  const headingText = normalizeTextKey(imageBlock.metadata?.afterHeadingText || imageBlock.metadata?.sectionTitle)
  const sectionNum = String(imageBlock.metadata?.sectionNum || '').trim()
  let headingIndex = -1
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (block.metadata?.role === 'references-section') break
    if (block.type !== 'heading') continue
    const normalizedHeading = normalizeTextKey(block.text)
    if (headingText && (normalizedHeading.includes(headingText) || headingText.includes(normalizedHeading))) {
      headingIndex = i
      break
    }
    if (sectionNum && new RegExp(`^\\s*(?:第\\s*)?${sectionNum.replace(/\./g, '\\.')}[\\.、\\s-]`).test(block.text)) {
      headingIndex = i
      break
    }
  }

  if (headingIndex < 0) {
    const refsIndex = blocks.findIndex((block) => block.metadata?.role === 'references-section')
    return refsIndex >= 0 ? Math.max(0, refsIndex - 1) : blocks.length - 1
  }

  let insertAfterIndex = headingIndex
  for (let i = headingIndex + 1; i < blocks.length; i++) {
    const block = blocks[i]
    if (block.metadata?.role === 'references-section' || block.type === 'heading') break
    insertAfterIndex = i
  }
  return insertAfterIndex
}

export function reinsertMissingPaperImages(blocks: DocumentBlock[], missingImages: PreservedImage[]): DocumentBlock[] {
  const next = blocks.slice()
  for (const image of missingImages) {
    const anchorIndex = resolveImageAnchorForReinsert(next, image.block)
    next.splice(Math.max(0, anchorIndex + 1), 0, {
      ...cloneBlock(image.block),
      metadata: {
        ...(image.block.metadata || {}),
        source: image.block.metadata?.source || 'paper-generation',
        preservedFromFinalizeMerge: true,
      },
    })
  }
  return next
}

export function mergeExistingImageBlocksIntoFinalDocument(
  currentDocument: DocumentSchema | null | undefined,
  nextDocument: DocumentSchema,
): DocumentSchema {
  const isPaperDocument = nextDocument.profile === 'paper' || nextDocument.document?.metadata?.generatedBy === 'paper-generation'
  if (!isPaperDocument) return nextDocument

  const currentImages = snapshotExistingPaperImages(currentDocument)
  if (currentImages.length === 0) return nextDocument

  const nextImages = collectDocumentImages(nextDocument, true)
  const mergedBlocks = nextDocument.blocks.map((block) => cloneBlock(block))
  const mergedResources = nextDocument.resources.map((resource) => cloneResource(resource))
  const mergedResourceMap = new Map(mergedResources.map((resource) => [resource.id, resource]))
  const preservedCurrent = new Set<number>()
  let mergedImageCount = 0

  for (const nextImage of nextImages) {
    const currentIndex = findMatchingImageIndex(currentImages, nextImage)
    if (currentIndex < 0) continue
    preservedCurrent.add(currentIndex)
    const blockIndex = mergedBlocks.findIndex((block) => block.id === nextImage.block.id)
    const resourceIndex = mergedResources.findIndex((resource) => resource.id === nextImage.resource.id)
    if (blockIndex < 0) continue
    if (resourceIndex < 0) {
      mergedResources.push({
        ...cloneResource(currentImages[currentIndex].resource),
        id: nextImage.block.resourceRef,
      })
      mergedResourceMap.set(nextImage.block.resourceRef, mergedResources[mergedResources.length - 1])
    }
    const effectiveResourceIndex = resourceIndex >= 0 ? resourceIndex : mergedResources.length - 1
    const merged = mergeImageMetadata(mergedBlocks[blockIndex] as ImageBlock, mergedResources[effectiveResourceIndex], currentImages[currentIndex])
    mergedBlocks[blockIndex] = merged.block
    mergedResources[effectiveResourceIndex] = merged.resource
    mergedResourceMap.set(merged.resource.id, merged.resource)
    mergedImageCount += 1
  }

  const missingImages = currentImages.filter((_, index) => !preservedCurrent.has(index))
  const droppedImageReasons: string[] = []
  for (const image of missingImages) {
    let resourceId = image.resource.id
    if (mergedResourceMap.has(resourceId)) {
      resourceId = `${resourceId}-preserved-${mergedResources.length + 1}`
    }
    const resource = { ...cloneResource(image.resource), id: resourceId }
    const block = { ...cloneBlock(image.block), resourceRef: resourceId }
    image.resource = resource
    image.block = block
    mergedResources.push(resource)
    mergedResourceMap.set(resource.id, resource)
  }

  if (missingImages.length > 0) {
    console.warn('[paper:image_preserve_warning]', {
      missingImageCount: missingImages.length,
      preservedImageCount: currentImages.length,
    })
    console.info('[paper:image_preserved]', {
      count: missingImages.length,
      images: missingImages.map((image) => ({
        blockId: image.block.id,
        resourceId: image.resource.id,
        path: image.resource.path,
        caption: getImageCaption(image.block, image.resource),
      })),
    })
  }

  if (droppedImageReasons.length > 0) {
    console.warn('[paper:image_dropped]', {
      count: droppedImageReasons.length,
      reasons: droppedImageReasons,
    })
  }

  const finalBlocks = reinsertMissingPaperImages(mergedBlocks, missingImages)
  const preservedImageCount = currentImages.length
  return {
    ...nextDocument,
    blocks: finalBlocks,
    resources: mergedResources,
    document: {
      ...nextDocument.document,
      metadata: {
        ...(nextDocument.document?.metadata || {}),
        preservedImageCount,
        mergedImageCount,
        droppedImageCount: droppedImageReasons.length,
        droppedImageReasons,
      },
    },
  }
}
