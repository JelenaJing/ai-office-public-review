import { useEffect, useState } from 'react'

type OoxmlPackageSnapshot = Awaited<ReturnType<Window['electronAPI']['readOoxmlPackage']>>
type PaperTemplateId = 'academic-cn' | 'academic-en' | 'thesis' | 'compact'

export interface DocumentPreviewRenderBodyStyle {
  pagePadding?: string
  fontFamily?: string
  fontSize?: string
  lineHeight?: string
  textIndent?: string
  paragraphSpacing?: string
  headingAlign?: 'left' | 'center'
}

export interface DocumentPreviewRenderShell {
  headerText?: string
  footerText?: string
  watermarkText?: string
  hasHeader?: boolean
  hasFooter?: boolean
  hasWatermark?: boolean
}

export interface DocumentPreviewRenderState {
  paperTemplateId?: PaperTemplateId
  bodyStyle?: DocumentPreviewRenderBodyStyle
  shell?: DocumentPreviewRenderShell
}

type DocumentPreviewErrorKind = Exclude<OoxmlPackageSnapshot['status'], 'ok' | 'empty-document'>

export type DocumentPreviewState =
  | {
      kind: 'idle'
      filePath: string | null
    }
  | {
      kind: 'loading'
      filePath: string
    }
  | {
      kind: 'error'
      filePath: string
      status: DocumentPreviewErrorKind
      message: string
      detail?: string
      diagnostics?: OoxmlPackageSnapshot['diagnostics']
      snapshot: OoxmlPackageSnapshot
    }
  | {
      kind: 'empty'
      filePath: string
      message: string
      renderState?: DocumentPreviewRenderState
      diagnostics?: OoxmlPackageSnapshot['diagnostics']
      snapshot: OoxmlPackageSnapshot
    }
  | {
      kind: 'ready'
      filePath: string
      contentType: 'html' | 'plain-text'
      contentHtml?: string
      plainText?: string
      renderState?: DocumentPreviewRenderState
      diagnostics?: OoxmlPackageSnapshot['diagnostics']
      snapshot: OoxmlPackageSnapshot
    }

function normalizePaperTemplateId(value: string | null | undefined): PaperTemplateId | undefined {
  if (value === 'academic-cn' || value === 'academic-en' || value === 'thesis' || value === 'compact') {
    return value
  }
  return undefined
}

function normalizeRenderState(renderMeta?: OoxmlPackageSnapshot['renderMeta'] | null): DocumentPreviewRenderState | undefined {
  if (!renderMeta) return undefined
  return {
    paperTemplateId: normalizePaperTemplateId(renderMeta.paperTemplateId),
    bodyStyle: renderMeta.bodyStyle,
    shell: renderMeta.shell,
  }
}

function parseEnvelopeRenderState(source: string | null | undefined): DocumentPreviewRenderState | undefined {
  if (!source) return undefined
  try {
    const parsed = JSON.parse(source) as DocumentPreviewRenderState
    if (!parsed || typeof parsed !== 'object') return undefined
    return {
      paperTemplateId: normalizePaperTemplateId(parsed.paperTemplateId),
      bodyStyle: parsed.bodyStyle,
      shell: parsed.shell,
    }
  } catch {
    return undefined
  }
}

function unwrapDocumentPreviewEnvelope(
  source: string,
  fallbackRenderState?: DocumentPreviewRenderState,
): { contentHtml: string; renderState?: DocumentPreviewRenderState } {
  const html = String(source || '')
  if (typeof document === 'undefined' || !html.trim().startsWith('<')) {
    return { contentHtml: html, renderState: fallbackRenderState }
  }

  const host = document.createElement('div')
  host.innerHTML = html.trim()
  if (host.childElementCount !== 1) {
    return { contentHtml: html, renderState: fallbackRenderState }
  }

  const root = host.firstElementChild as HTMLElement | null
  if (!root || root.tagName.toLowerCase() !== 'div') {
    return { contentHtml: html, renderState: fallbackRenderState }
  }

  const envelopeRenderState = parseEnvelopeRenderState(root.getAttribute('data-ai-writer-doc-meta'))
  const paperTemplateId = normalizePaperTemplateId(root.getAttribute('data-paper-template'))
  const hasEnvelope = root.getAttribute('data-ai-writer-doc-envelope') === 'true' || Boolean(envelopeRenderState) || Boolean(paperTemplateId)

  if (!hasEnvelope) {
    return { contentHtml: html, renderState: fallbackRenderState }
  }

  return {
    contentHtml: root.innerHTML || '<p></p>',
    renderState: {
      ...(fallbackRenderState || {}),
      ...(envelopeRenderState || {}),
      paperTemplateId: paperTemplateId || envelopeRenderState?.paperTemplateId || fallbackRenderState?.paperTemplateId,
    },
  }
}

function buildErrorMessage(snapshot: OoxmlPackageSnapshot): string {
  return snapshot.diagnostics?.message?.trim() || '文稿预览读取失败。'
}

function buildEmptyMessage(snapshot: OoxmlPackageSnapshot): string {
  return snapshot.diagnostics?.message?.trim() || '文稿为空，当前没有可展示内容。'
}

export function useDocumentPreview(filePath: string | null | undefined, refreshKey?: string | number): DocumentPreviewState {
  const normalizedFilePath = String(filePath || '').trim()
  const [state, setState] = useState<DocumentPreviewState>(() => (
    normalizedFilePath
      ? { kind: 'loading', filePath: normalizedFilePath }
      : { kind: 'idle', filePath: null }
  ))

  useEffect(() => {
    if (!normalizedFilePath) {
      setState({ kind: 'idle', filePath: null })
      return
    }

    let cancelled = false
    setState({ kind: 'loading', filePath: normalizedFilePath })

    void window.electronAPI.readOoxmlPackage(normalizedFilePath)
      .then((snapshot) => {
        if (cancelled) return

        const fallbackRenderState = normalizeRenderState(snapshot.renderMeta)

        if (snapshot.status === 'empty-document') {
          setState({
            kind: 'empty',
            filePath: normalizedFilePath,
            message: buildEmptyMessage(snapshot),
            renderState: fallbackRenderState,
            diagnostics: snapshot.diagnostics,
            snapshot,
          })
          return
        }

        if (snapshot.status !== 'ok') {
          setState({
            kind: 'error',
            filePath: normalizedFilePath,
            status: snapshot.status,
            message: buildErrorMessage(snapshot),
            detail: snapshot.diagnostics?.detail,
            diagnostics: snapshot.diagnostics,
            snapshot,
          })
          return
        }

        const html = String(snapshot.html || '').trim()
        if (html) {
          const unwrapped = unwrapDocumentPreviewEnvelope(html, fallbackRenderState)
          setState({
            kind: 'ready',
            filePath: normalizedFilePath,
            contentType: 'html',
            contentHtml: unwrapped.contentHtml || '<p></p>',
            plainText: snapshot.plainText,
            renderState: unwrapped.renderState,
            diagnostics: snapshot.diagnostics,
            snapshot,
          })
          return
        }

        const plainText = String(snapshot.plainText || '').trim()
        if (plainText) {
          setState({
            kind: 'ready',
            filePath: normalizedFilePath,
            contentType: 'plain-text',
            plainText,
            renderState: fallbackRenderState,
            diagnostics: snapshot.diagnostics,
            snapshot,
          })
          return
        }

        setState({
          kind: 'empty',
          filePath: normalizedFilePath,
          message: '文档已读取成功，但未提取到可展示内容。',
          renderState: fallbackRenderState,
          diagnostics: snapshot.diagnostics,
          snapshot,
        })
      })
      .catch((error) => {
        if (cancelled) return
        setState({
          kind: 'error',
          filePath: normalizedFilePath,
          status: 'parse-failed',
          message: error instanceof Error ? error.message : '文稿预览读取失败。',
          detail: error instanceof Error ? error.stack : undefined,
          snapshot: {
            filePath: normalizedFilePath,
            status: 'parse-failed',
            exists: false,
            entryCount: 0,
            entries: [],
            contentTypesXml: null,
            documentXml: null,
            paragraphCount: 0,
            paragraphs: [],
            blockCount: 0,
            blocks: [],
            bibliographySources: [],
            plainText: '',
            html: '<p></p>',
            diagnostics: {
              code: 'parse-failed',
              message: error instanceof Error ? error.message : '文稿预览读取失败。',
            },
          },
        })
      })

    return () => {
      cancelled = true
    }
  }, [normalizedFilePath, refreshKey])

  return state
}