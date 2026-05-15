import type {
  DocumentEngineCommentPayload,
  DocumentEngineContentPayload,
  DocumentEngineFormulaPayload,
  DocumentEngineImageAnchorPayload,
  DocumentEngineLoadRequest,
  DocumentEngineRuntime,
  DocumentEngineSaveRequest,
  DocumentEngineSaveResult,
  DocumentEngineSelection,
  DocumentEngineTextEditPayload,
} from './contracts'

interface EmbeddedOfficeAdapterDeps {
  getSelection: () => DocumentEngineSelection | null
  setDocumentContent: (content: DocumentEngineContentPayload) => void
  insertTextAtSelection: (insertion: string) => void
  applyTextEdit: (payload: DocumentEngineTextEditPayload) => void
  insertCitationComment: (payload: DocumentEngineCommentPayload) => void
  insertFormulaBlock: (payload: DocumentEngineFormulaPayload) => void
  insertImageBlock: (payload: DocumentEngineImageAnchorPayload & {
    altText?: string
    previewSrc?: string
    mediaContentType?: string
    mediaPath?: string
    sourceId?: string
  }) => void
  loadDocument: (request: DocumentEngineLoadRequest) => Promise<void>
  saveDocument: (request?: DocumentEngineSaveRequest) => Promise<DocumentEngineSaveResult | null>
  setStatusMessage: (message: string) => void
}

function inferImageContentType(src: string): string | undefined {
  const normalized = String(src || '').trim()
  const dataUrlMatch = normalized.match(/^data:([^;,]+)[;,]/i)
  if (dataUrlMatch?.[1]) return dataUrlMatch[1].toLowerCase()

  const extension = normalized.match(/\.([a-zA-Z0-9]+)(?:[?#].*)?$/)?.[1]?.toLowerCase()
  if (extension === 'png') return 'image/png'
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'gif') return 'image/gif'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'svg') return 'image/svg+xml'
  if (extension === 'bmp') return 'image/bmp'
  return undefined
}

function sanitizeImageBaseName(value: string): string {
  return String(value || 'image')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'image'
}

function buildInsertedImageMediaPath(src: string, title?: string, alt?: string): string {
  const contentType = inferImageContentType(src)
  const extensionByType: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
  }
  const fallbackExtension = String(src || '').match(/\.([a-zA-Z0-9]+)(?:[?#].*)?$/)?.[1]?.toLowerCase() || 'png'
  const extension = (contentType && extensionByType[contentType]) || fallbackExtension
  const baseName = sanitizeImageBaseName(title || alt || String(src || '').split('/').pop() || 'image')
  return `word/media/${baseName}-${Date.now()}.${extension}`
}

export function createEmbeddedOfficeRuntime({
  getSelection,
  setDocumentContent,
  insertTextAtSelection,
  applyTextEdit,
  insertCitationComment,
  insertFormulaBlock,
  insertImageBlock,
  loadDocument,
  saveDocument,
  setStatusMessage,
}: EmbeddedOfficeAdapterDeps): DocumentEngineRuntime {
  return {
    engineId: 'embedded-office-engine',
    getSelection,
    loadDocument,
    saveDocument,
    setDocumentContent,
    applyTextEdit,
    insertComment: (payload: DocumentEngineCommentPayload) => {
      if (payload.kind === 'citation') {
        // Delegate to the legacy TipTap runtime so the marker is inserted with
        // proper superscript mark and sentence-end position resolution.
        insertCitationComment(payload)
      } else {
        insertTextAtSelection(` [批注: ${payload.body.trim()}]`)
      }
      setStatusMessage(payload.kind === 'citation' ? '已通过 embedded runtime 插入引用标记' : '已通过 embedded runtime 插入批注标记')
    },
    upsertFormula: (payload: DocumentEngineFormulaPayload) => {
      insertFormulaBlock(payload)
      setStatusMessage('已通过 embedded runtime 插入公式对象')
    },
    insertAnchoredImage: async (payload: DocumentEngineImageAnchorPayload) => {
      const normalizedSrc = payload.src.trim()
      let previewSrc = normalizedSrc
      let mediaContentType = inferImageContentType(normalizedSrc)

      if (!/^data:/i.test(normalizedSrc) && window.electronAPI?.readImageAsDataUrl) {
        try {
          const imported = await window.electronAPI.readImageAsDataUrl(normalizedSrc)
          previewSrc = imported.dataUrl
          mediaContentType = imported.contentType || mediaContentType
        } catch {
          previewSrc = normalizedSrc
        }
      }

      insertImageBlock({
        ...payload,
        altText: payload.alt,
        sourceId: normalizedSrc,
        previewSrc,
        mediaContentType,
        mediaPath: buildInsertedImageMediaPath(previewSrc, payload.title, payload.alt),
      })
      setStatusMessage('已通过 embedded runtime 插入图片对象')
    },
  }
}
