import type { DocumentEngineId } from './types'
import type { MailAttachmentSourceContext } from '../../types/mailAttachment'

export interface DocumentEngineSelection {
  from: number
  to: number
  text: string
  collapsed: boolean
  anchorId?: string
}

export interface DocumentEngineTextEditPayload {
  text: string
  mode: 'replace-range' | 'append-after-range' | 'append-at-end' | 'append-inline-at-end' | 'append-paragraph-at-end'
  range?: DocumentEngineSelection | null
}

export interface DocumentEngineLoadRequest {
  filePath: string | null
  fileName: string
  content: string
  preserveOriginalOnSave?: boolean
  /** TipTap JSON document node — when present, editor restores state directly without HTML parsing */
  tiptapJson?: Record<string, unknown>
  /** Paper template ID stored in .aidoc.json */
  paperTemplateId?: string
  sourceContext?: MailAttachmentSourceContext
  /** Stable unique identifier for dedup and pending-restore keying.
   *  Format: `local:<absolutePath>` | `mail:<msgId>:<attachmentName>` */
  canonicalDocumentId?: string
}

export interface DocumentEngineSaveRequest {
  reason?: 'manual' | 'autosave' | 'export'
  preferredPath?: string | null
  mode?: 'current' | 'save-as'
}

export interface DocumentEngineSaveResult {
  filePath: string | null
  fileName: string
  content: string
}

export interface DocumentEngineCommentPayload {
  kind: 'citation' | 'note'
  range: DocumentEngineSelection
  body: string
  metadata?: Record<string, string | number | boolean | null | undefined>
}

export interface DocumentEngineFormulaPayload {
  latex: string
  displayMode: 'inline' | 'block'
  editPos: number | null
}

export interface DocumentEngineImageAnchorPayload {
  src: string
  alt?: string
  title?: string
  placement: 'cursor' | 'after-selection' | 'block' | 'document-end'
  widthPx?: number
  heightPx?: number
}

export type DocumentEngineContentPayload = string | Record<string, any>

export interface DocumentEngineRuntime {
  engineId: DocumentEngineId
  getSelection: () => DocumentEngineSelection | null
  loadDocument: (request: DocumentEngineLoadRequest) => Promise<void>
  saveDocument: (request?: DocumentEngineSaveRequest) => Promise<DocumentEngineSaveResult | null>
  setDocumentContent: (content: DocumentEngineContentPayload) => Promise<void> | void
  applyTextEdit: (payload: DocumentEngineTextEditPayload) => Promise<void> | void
  insertComment: (payload: DocumentEngineCommentPayload) => Promise<void> | void
  upsertFormula: (payload: DocumentEngineFormulaPayload) => Promise<void> | void
  insertAnchoredImage: (payload: DocumentEngineImageAnchorPayload) => Promise<void> | void
}
