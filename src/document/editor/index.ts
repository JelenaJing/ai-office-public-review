import { applyPatch, applyPatches, type DocumentPatch } from '../core'
import { createParagraphBlock, type DocumentImageValue, type DocumentSchema } from '../schema'

export interface ReplaceBlockEditAction {
  type: 'replace_block'
  targetId: string
  text: string
}

export interface FillSlotEditAction {
  type: 'fill_slot'
  targetId?: string
  slotKey?: string
  value: string
}

export interface ReplaceImageEditAction {
  type: 'replace_image'
  targetId: string
  resourceRef: string
  text?: string
  alt?: string
  caption?: string
}

export type DocumentEditAction = ReplaceBlockEditAction | FillSlotEditAction | ReplaceImageEditAction

export interface DocumentEditState {
  baseDocument: DocumentSchema
  previewDocument: DocumentSchema
  patches: DocumentPatch[]
  lastError: string | null
}

export interface DocumentEditControllerError {
  code: 'target-not-found' | 'invalid-action'
  message: string
}

export interface ApplyDocumentEditActionSuccess {
  ok: true
  message: string
  state: DocumentEditState
}

export interface ApplyDocumentEditActionFailure {
  ok: false
  error: DocumentEditControllerError
  state: DocumentEditState
}

export type ApplyDocumentEditActionResult = ApplyDocumentEditActionSuccess | ApplyDocumentEditActionFailure

export function createDocumentEditState(document: DocumentSchema): DocumentEditState {
  return {
    baseDocument: document,
    previewDocument: document,
    patches: [],
    lastError: null,
  }
}

export function resetDocumentEditState(state: DocumentEditState): DocumentEditState {
  return createDocumentEditState(state.baseDocument)
}

export function rebaseDocumentEditState(document: DocumentSchema, patches: DocumentPatch[] = []): DocumentEditState {
  const baseState = createDocumentEditState(document)
  if (patches.length === 0) return baseState
  const patchResult = applyPatches(baseState.previewDocument, patches)
  return {
    baseDocument: document,
    previewDocument: patchResult.snapshot,
    patches: patchResult.ok ? [...patches] : [...patchResult.applied],
    lastError: patchResult.ok ? null : patchResult.error.message,
  }
}

function buildPatchFromAction(document: DocumentSchema, action: DocumentEditAction): DocumentPatch | DocumentEditControllerError {
  if (action.type === 'replace_block') {
    const target = document.blocks.find((block) => block.id === action.targetId)
    if (!target) return { code: 'target-not-found', message: '未找到待改写的块。' }
    return {
      type: 'replace_block',
      targetId: action.targetId,
      block: target.type === 'heading'
        ? { ...target, text: action.text }
        : target.type === 'slot'
          ? { ...target, text: action.text, value: { ...(target.value || {}), text: action.text } }
          : target.type === 'image'
            ? { ...target, text: action.text, value: { ...(target.value || {}), caption: action.text } }
            : createParagraphBlock({ ...target, text: action.text, type: 'paragraph' }),
    }
  }

  if (action.type === 'fill_slot') {
    if (!action.targetId && !action.slotKey) {
      return { code: 'invalid-action', message: '缺少 slot 定位信息。' }
    }
    return action.targetId
      ? { type: 'fill_slot', targetId: action.targetId, value: action.value, text: action.value }
      : { type: 'fill_slot', slotKey: String(action.slotKey), value: action.value, text: action.value }
  }

  const image = document.blocks.find((block) => block.id === action.targetId && block.type === 'image')
  if (!image || image.type !== 'image') {
    return { code: 'target-not-found', message: '未找到待替换的图片块。' }
  }
  const nextValue: Partial<DocumentImageValue> = {
    ...(action.alt ? { alt: action.alt } : {}),
    ...(action.caption ? { caption: action.caption } : {}),
  }
  return {
    type: 'replace_image',
    targetId: action.targetId,
    resourceRef: action.resourceRef,
    text: action.text,
    value: nextValue,
  }
}

function buildSuccessMessage(action: DocumentEditAction): string {
  if (action.type === 'replace_block') return '段落预览已更新。'
  if (action.type === 'fill_slot') return '字段预览已更新。'
  return '图片预览已更新。'
}

export function applyDocumentEditAction(state: DocumentEditState, action: DocumentEditAction): ApplyDocumentEditActionResult {
  const builtPatch = buildPatchFromAction(state.previewDocument, action)
  if ('code' in builtPatch) {
    return {
      ok: false,
      error: builtPatch,
      state: {
        ...state,
        lastError: builtPatch.message,
      },
    }
  }

  const patchResult = applyPatch(state.previewDocument, builtPatch)
  if (!patchResult.ok) {
    return {
      ok: false,
      error: {
        code: 'invalid-action',
        message: patchResult.error.message,
      },
      state: {
        ...state,
        previewDocument: patchResult.snapshot,
        lastError: patchResult.error.message,
      },
    }
  }

  return {
    ok: true,
    message: buildSuccessMessage(action),
    state: {
      ...state,
      previewDocument: patchResult.snapshot,
      patches: [...state.patches, builtPatch],
      lastError: null,
    },
  }
}