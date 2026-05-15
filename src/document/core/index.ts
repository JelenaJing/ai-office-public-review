import { cloneDocumentSchema, createDocumentSchema, normalizeDocumentSchema, type DocumentBlock, type DocumentImageCrop, type DocumentImageValue, type DocumentProfile, type DocumentSchema, type DocumentSlotValue, type DocumentSourceRef } from '../schema'

export interface DocumentArtifactRef extends DocumentSourceRef {
  role?: 'source' | 'export'
}

export type UpdateBlockTextPatch = {
  type: 'update_block_text'
  blockId: string
  text: string
}

export type ReplaceBlockPatch = {
  type: 'replace_block'
  targetId: string
  block: DocumentBlock
}

export type InsertBlockAfterPatch = {
  type: 'insert_block_after'
  targetId?: string
  afterBlockId?: string | null
  block: DocumentBlock
}

export type DeleteBlockPatch = {
  type: 'delete_block'
  targetId: string
}

export type RemoveBlockPatch = {
  type: 'remove_block'
  blockId: string
}

export type ReplaceImagePatch = {
  type: 'replace_image'
  targetId: string
  resourceRef: string
  text?: string
  styleRef?: string
  value?: Partial<DocumentImageValue>
}

export type UpdateImageCaptionPatch = {
  type: 'update_image_caption'
  blockId: string
  caption: string
}

export type UpdateImageResourceRefPatch = {
  type: 'update_image_resource_ref'
  blockId: string
  resourceRef: string
}

export type FillSlotPatch = (
  {
    type: 'fill_slot'
    targetId: string
    value: DocumentSlotValue | string
    text?: string
    styleRef?: string
  }
  | {
    type: 'fill_slot'
    slotKey: string
    value: DocumentSlotValue | string
    text?: string
    styleRef?: string
  }
)

export type ApplyStylePatch = {
  type: 'apply_style'
  targetId: string
  styleRef: string
}

export type CropImagePatch = {
  type: 'crop_image'
  targetId: string
  crop: DocumentImageCrop
}

export type ReorderBlocksPatch = {
  type: 'reorder_blocks'
  orderedBlockIds: string[]
}

export type SetDocumentMetaPatch = {
  type: 'set_document_meta'
  meta: Record<string, unknown>
}

export type DocumentPatch =
  | UpdateBlockTextPatch
  | ReplaceBlockPatch
  | InsertBlockAfterPatch
  | DeleteBlockPatch
  | RemoveBlockPatch
  | ReplaceImagePatch
  | UpdateImageCaptionPatch
  | UpdateImageResourceRefPatch
  | FillSlotPatch
  | ApplyStylePatch
  | CropImagePatch
  | ReorderBlocksPatch
  | SetDocumentMetaPatch

export interface DocumentArtifact {
  id: string
  artifactId?: string
  profile: DocumentProfile
  command?: string
  session?: Record<string, unknown>
  document: DocumentSchema
  sourceRefs: DocumentArtifactRef[]
  patches: DocumentPatch[]
  profileMetadata?: Record<string, unknown>
  metadata?: Record<string, unknown>
  exportRefs?: DocumentArtifactRef[]
}

export interface CreateDocumentArtifactInput {
  id: string
  profile: DocumentProfile
  document?: DocumentSchema
  templateId?: string
  sourceRefs?: Array<string | (DocumentArtifactRef & { id?: string })>
  patches?: DocumentPatch[]
  exportRefs?: Array<string | (DocumentArtifactRef & { id?: string })>
  metadata?: Record<string, unknown>
  profileMetadata?: Record<string, unknown>
}

export interface DocumentPatchError {
  code: 'invalid_patch_target' | 'unsupported_patch'
  message: string
  patch: DocumentPatch
}

export interface ApplyDocumentPatchSuccess<T extends { blocks: DocumentBlock[] }> {
  ok: true
  snapshot: T
  applied: DocumentPatch[]
}

export interface ApplyDocumentPatchFailure<T extends { blocks: DocumentBlock[] }> {
  ok: false
  snapshot: T
  applied: DocumentPatch[]
  error: DocumentPatchError
}

export type DocumentPatchResult<T extends { blocks: DocumentBlock[] }> = ApplyDocumentPatchSuccess<T> | ApplyDocumentPatchFailure<T>

export interface ApplyArtifactPatchesSuccess {
  ok: true
  artifact: DocumentArtifact
  applied: DocumentPatch[]
}

export interface ApplyArtifactPatchesFailure {
  ok: false
  artifact: DocumentArtifact
  applied: DocumentPatch[]
  error: DocumentPatchError
}

export type ApplyArtifactPatchesResult = ApplyArtifactPatchesSuccess | ApplyArtifactPatchesFailure

function normalizeArtifactRefs(
  refs: Array<string | (DocumentArtifactRef & { id?: string })> | undefined,
  role: DocumentArtifactRef['role'],
): DocumentArtifactRef[] {
  return (refs || []).map((ref, index) => {
    if (typeof ref === 'string') {
      const normalized = ref.trim()
      return {
        id: normalized || `${role || 'ref'}-${index + 1}`,
        label: normalized || `${role || 'ref'}-${index + 1}`,
        uri: normalized || undefined,
        kind: role === 'export' ? 'skill-input' : 'document',
        role,
      }
    }
    return {
      ...ref,
      id: String(ref.id || ref.uri || ref.label || `${role || 'ref'}-${index + 1}`),
      role,
    }
  })
}

export function createDocumentArtifact(input: CreateDocumentArtifactInput): DocumentArtifact {
  const document = input.document
    ? normalizeDocumentSchema(cloneDocumentSchema(input.document))
    : createDocumentSchema({
        id: `document:${input.id}`,
        profile: input.profile,
        templateId: input.templateId,
        metadata: input.metadata,
      })

  return {
    id: input.id,
    artifactId: input.id,
    profile: input.profile,
    document: {
      ...document,
      document: {
        ...document.document,
        profile: input.profile,
        templateId: document.document.templateId ?? input.templateId,
      },
    },
    sourceRefs: normalizeArtifactRefs(input.sourceRefs, 'source'),
    patches: [...(input.patches || [])],
    profileMetadata: input.profileMetadata ? { ...input.profileMetadata } : undefined,
    metadata: input.metadata ? { ...input.metadata } : undefined,
    exportRefs: input.exportRefs && input.exportRefs.length > 0 ? normalizeArtifactRefs(input.exportRefs, 'export') : undefined,
  }
}

function createPatchError(patch: DocumentPatch, message: string): DocumentPatchError {
  return {
    code: 'invalid_patch_target',
    message,
    patch,
  }
}

function findBlockIndex(blocks: DocumentBlock[], predicate: (block: DocumentBlock) => boolean): number {
  return blocks.findIndex(predicate)
}

function resolveSlotValue(value: DocumentSlotValue | string, text?: string): DocumentSlotValue {
  if (typeof value === 'string') {
    return { text: text || value }
  }
  return {
    ...value,
    text: text || value.text || '',
  }
}

export function applyPatch<T extends DocumentSchema>(snapshot: T, patch: DocumentPatch): DocumentPatchResult<T> {
  const next = cloneDocumentSchema(snapshot) as T
  const blocks = [...next.blocks]

  switch (patch.type) {
    case 'update_block_text': {
      const index = findBlockIndex(blocks, (block) => block.id === patch.blockId)
      if (index < 0) return { ok: false, snapshot: next, applied: [], error: createPatchError(patch, '未找到目标块。') }
      blocks[index] = { ...blocks[index], text: patch.text }
      break
    }
    case 'replace_block': {
      const index = findBlockIndex(blocks, (block) => block.id === patch.targetId)
      if (index < 0) return { ok: false, snapshot: next, applied: [], error: createPatchError(patch, '未找到需要替换的块。') }
      blocks[index] = cloneDocumentSchema({ ...next, blocks: [patch.block] }).blocks[0]
      break
    }
    case 'insert_block_after': {
      const targetId = patch.afterBlockId ?? patch.targetId
      const index = targetId ? findBlockIndex(blocks, (block) => block.id === targetId) : blocks.length - 1
      if (targetId && index < 0) return { ok: false, snapshot: next, applied: [], error: createPatchError(patch, '未找到插入参照块。') }
      blocks.splice(index + 1, 0, patch.block)
      break
    }
    case 'delete_block': {
      const index = findBlockIndex(blocks, (block) => block.id === patch.targetId)
      if (index < 0) return { ok: false, snapshot: next, applied: [], error: createPatchError(patch, '未找到需要删除的块。') }
      blocks.splice(index, 1)
      break
    }
    case 'remove_block': {
      const index = findBlockIndex(blocks, (block) => block.id === patch.blockId)
      if (index < 0) return { ok: false, snapshot: next, applied: [], error: createPatchError(patch, '未找到需要移除的块。') }
      blocks.splice(index, 1)
      break
    }
    case 'replace_image': {
      const index = findBlockIndex(blocks, (block) => block.id === patch.targetId && block.type === 'image')
      if (index < 0) return { ok: false, snapshot: next, applied: [], error: createPatchError(patch, '未找到需要替换的图片块。') }
      const current = blocks[index]
      if (current.type !== 'image') return { ok: false, snapshot: next, applied: [], error: createPatchError(patch, '目标块不是图片。') }
      blocks[index] = {
        ...current,
        resourceRef: patch.resourceRef,
        text: patch.text ?? current.text,
        styleRef: patch.styleRef ?? current.styleRef,
        value: {
          ...(current.value || {}),
          ...(patch.value || {}),
        },
      }
      break
    }
    case 'update_image_caption': {
      const index = findBlockIndex(blocks, (block) => block.id === patch.blockId && block.type === 'image')
      if (index < 0) return { ok: false, snapshot: next, applied: [], error: createPatchError(patch, '未找到图片块。') }
      const current = blocks[index]
      if (current.type !== 'image') return { ok: false, snapshot: next, applied: [], error: createPatchError(patch, '目标块不是图片。') }
      blocks[index] = {
        ...current,
        text: patch.caption,
        value: {
          ...(current.value || {}),
          caption: patch.caption,
        },
      }
      break
    }
    case 'update_image_resource_ref': {
      const index = findBlockIndex(blocks, (block) => block.id === patch.blockId && block.type === 'image')
      if (index < 0) return { ok: false, snapshot: next, applied: [], error: createPatchError(patch, '未找到图片块。') }
      const current = blocks[index]
      if (current.type !== 'image') return { ok: false, snapshot: next, applied: [], error: createPatchError(patch, '目标块不是图片。') }
      blocks[index] = { ...current, resourceRef: patch.resourceRef }
      break
    }
    case 'fill_slot': {
      const index = 'targetId' in patch
        ? findBlockIndex(blocks, (block) => block.id === patch.targetId && block.type === 'slot')
        : findBlockIndex(blocks, (block) => block.type === 'slot' && block.slotKey === patch.slotKey)
      if (index < 0) return { ok: false, snapshot: next, applied: [], error: createPatchError(patch, '未找到待补内容块。') }
      const current = blocks[index]
      if (current.type !== 'slot') return { ok: false, snapshot: next, applied: [], error: createPatchError(patch, '目标块不是待补内容。') }
      blocks[index] = {
        ...current,
        text: patch.text ?? (typeof patch.value === 'string' ? patch.value : patch.value.text || current.text),
        styleRef: patch.styleRef ?? current.styleRef,
        value: resolveSlotValue(patch.value, patch.text),
      }
      break
    }
    case 'apply_style': {
      const index = findBlockIndex(blocks, (block) => block.id === patch.targetId)
      if (index < 0) return { ok: false, snapshot: next, applied: [], error: createPatchError(patch, '未找到目标块。') }
      blocks[index] = { ...blocks[index], styleRef: patch.styleRef }
      break
    }
    case 'crop_image': {
      const index = findBlockIndex(blocks, (block) => block.id === patch.targetId && block.type === 'image')
      if (index < 0) return { ok: false, snapshot: next, applied: [], error: createPatchError(patch, '未找到图片块。') }
      const current = blocks[index]
      if (current.type !== 'image') return { ok: false, snapshot: next, applied: [], error: createPatchError(patch, '目标块不是图片。') }
      blocks[index] = {
        ...current,
        value: {
          ...(current.value || {}),
          crop: patch.crop,
        },
      }
      break
    }
    case 'reorder_blocks': {
      const mapped = patch.orderedBlockIds.map((id) => blocks.find((block) => block.id === id)).filter(Boolean) as DocumentBlock[]
      if (mapped.length !== blocks.length) return { ok: false, snapshot: next, applied: [], error: createPatchError(patch, '重排块数量不匹配。') }
      next.blocks = mapped
      next.html = createDocumentSchema({ ...next, blocks: mapped }).html
      return { ok: true, snapshot: next, applied: [patch] }
    }
    case 'set_document_meta': {
      next.meta = {
        ...next.meta,
        ...patch.meta,
      }
      next.document.metadata = {
        ...(next.document.metadata || {}),
        ...patch.meta,
      }
      next.html = createDocumentSchema({ ...next, blocks: next.blocks }).html
      return { ok: true, snapshot: next, applied: [patch] }
    }
    default:
      return { ok: false, snapshot: next, applied: [], error: { code: 'unsupported_patch', message: '不支持的 patch 类型。', patch } }
  }

  next.blocks = blocks
  next.html = createDocumentSchema({ ...next, blocks }).html
  return { ok: true, snapshot: next, applied: [patch] }
}

export function applyPatches<T extends DocumentSchema>(snapshot: T, patches: DocumentPatch[]): DocumentPatchResult<T> {
  let current = cloneDocumentSchema(snapshot) as T
  const applied: DocumentPatch[] = []
  for (const patch of patches) {
    const result = applyPatch(current, patch)
    if (result.ok === false) {
      return {
        ok: false,
        snapshot: result.snapshot,
        applied,
        error: result.error,
      }
    }
    current = result.snapshot
    applied.push(...result.applied)
  }
  return {
    ok: true,
    snapshot: current,
    applied,
  }
}

export function applyArtifactPatches(artifact: DocumentArtifact, patches: DocumentPatch[] = artifact.patches): ApplyArtifactPatchesResult {
  const result = applyPatches(artifact.document, patches)
  const nextArtifact: DocumentArtifact = {
    ...artifact,
    document: result.snapshot,
    patches: patches === artifact.patches ? [...artifact.patches] : [...artifact.patches, ...patches],
  }

  if (result.ok === false) {
    return {
      ok: false,
      artifact: nextArtifact,
      applied: result.applied,
      error: result.error,
    }
  }

  return {
    ok: true,
    artifact: nextArtifact,
    applied: result.applied,
  }
}