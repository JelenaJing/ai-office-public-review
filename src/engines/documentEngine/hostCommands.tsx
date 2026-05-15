import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useDocument } from '../../contexts/DocumentContext'
import { useKnowledge } from '../../contexts/KnowledgeContext'
import { useDocumentEngineRuntime } from './runtime'
import type { DocumentEngineSaveRequest } from './contracts'
import { plainTextToHtml } from '../../utils/plainTextToHtml'
import type { KnowledgeDocumentBlock, KnowledgeDocumentJson } from '../../types/knowledgeDocumentJson'
import type { MailAttachmentSourceContext } from '../../types/mailAttachment'

interface OpenDocumentPathOptions {
  sourceContext?: MailAttachmentSourceContext
  /**
   * When true, bypasses the .aidoc.json → sibling-redirect logic and opens the
   * file directly in the TipTap engine.  Set this only for programmatic flows
   * that intentionally create/open a .aidoc.json (e.g. blank-doc creation,
   * draft-restore, AI generation saves).  User-facing file-tree clicks should
   * NEVER set this flag.
   */
  isInternalOpen?: boolean
}

interface DocumentEngineHostCommandsValue {
  requestOpenFromDialog: () => Promise<void>
  openDocumentPath: (filePath: string, options?: OpenDocumentPathOptions) => Promise<void>
  openKnowledgeDocumentPreview: (documentId: string) => Promise<boolean>
  saveActiveDocument: (request?: DocumentEngineSaveRequest) => Promise<void>
  saveActiveDocumentAs: () => Promise<void>
}

const DocumentEngineHostCommandsContext = createContext<DocumentEngineHostCommandsValue | null>(null)

function buildImagePreviewHtml(filePath: string, fileName: string): string {
  const src = encodeURI(filePath.replace(/\\/g, '/'))
  return `<div style="text-align:center;padding:20px;background:#1a1a2e;min-height:100vh;"><img src="file://${src.startsWith('/') ? src : `/${src}`}" alt="${fileName}" style="max-width:100%;max-height:90vh;border-radius:8px;box-shadow:0 4px 24px rgba(0,0,0,0.4);" /></div>`
}

function toFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const encoded = encodeURI(normalized).replace(/[?#]/g, (char) => encodeURIComponent(char))
  if (encoded.startsWith('/')) return `file://${encoded}`
  if (/^[a-zA-Z]:\//.test(encoded)) return `file:///${encoded}`
  return `file:///${encoded}`
}

function joinKnowledgePath(rootPath: string, relativePath: string | null | undefined): string {
  const root = String(rootPath || '').replace(/\\/g, '/').replace(/\/+$/g, '')
  const relative = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '')
  if (!root) return relative
  if (!relative) return root
  return `${root}/${relative}`
}

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderKnowledgeBlock(block: KnowledgeDocumentBlock, assetsById: Map<string, string>): string {
  if (block.type === 'heading') {
    const level = Math.max(1, Math.min(Number(block.level || 1), 6))
    return `<h${level}>${escapeHtml(block.text || '')}</h${level}>`
  }
  if (block.type === 'paragraph') {
    return `<p>${escapeHtml(block.text || '').replace(/\n/g, '<br />')}</p>`
  }
  if (block.type === 'list') {
    const items = Array.isArray(block.items) ? block.items : []
    return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
  }
  if (block.type === 'table') {
    const rows = Array.isArray(block.rows) ? block.rows : []
    return `<table><tbody>${rows.map((row) => `<tr>${Array.isArray(row) ? row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('') : ''}</tr>`).join('')}</tbody></table>`
  }
  if (block.type === 'code') {
    return `<pre><code>${escapeHtml(block.text || '')}</code></pre>`
  }
  if (block.type === 'image') {
    const assetUrl = block.assetId ? assetsById.get(block.assetId) || '' : ''
    if (assetUrl) {
      return `<figure><img src="${escapeHtml(assetUrl)}" alt="${escapeHtml(block.text || 'image')}" /><figcaption>${escapeHtml(block.text || '')}</figcaption></figure>`
    }
    return `<div class="image-placeholder">${escapeHtml(block.text || '图片')}</div>`
  }
  return block.text ? `<p>${escapeHtml(block.text)}</p>` : ''
}

function buildKnowledgePreviewDocumentHtml(title: string, document: KnowledgeDocumentJson | null, extractedText: string, assetsRootPath: string | null, bodyOverride?: string): string {
  const assetsById = new Map<string, string>()
  if (document && assetsRootPath) {
    document.assets.forEach((asset) => {
      if (!asset.id || !asset.relativePath) return
      assetsById.set(asset.id, toFileUrl(joinKnowledgePath(assetsRootPath, asset.relativePath)))
    })
  }

  const bodyHtml = bodyOverride || (document?.blocks?.length
    ? document.blocks.map((block) => renderKnowledgeBlock(block, assetsById)).join('')
    : `<pre>${escapeHtml(extractedText || '当前还没有可展示的解析结果。')}</pre>`)

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: light; }
      body {
        margin: 0;
        background: linear-gradient(180deg, #eef3f8 0%, #e7edf4 100%);
        color: #243447;
        font-family: 'Segoe UI', 'PingFang SC', 'Noto Sans SC', sans-serif;
      }
      .page {
        box-sizing: border-box;
        max-width: 920px;
        margin: 24px auto;
        padding: 32px 40px;
        background: #fff;
        border-radius: 18px;
        box-shadow: 0 18px 46px rgba(36, 52, 71, 0.12);
      }
      h1, h2, h3, h4, h5, h6 { color: #173457; line-height: 1.45; margin: 1.2em 0 0.55em; }
      p, li, td, th, pre, code { font-size: 14px; line-height: 1.8; }
      p { margin: 0.75em 0; white-space: pre-wrap; }
      ul, ol { padding-left: 1.4em; }
      table { width: 100%; border-collapse: collapse; margin: 1em 0; }
      td, th { border: 1px solid #dbe5ef; padding: 8px 10px; vertical-align: top; }
      th { background: #f5f8fc; }
      pre {
        white-space: pre-wrap;
        word-break: break-word;
        background: #f7f9fc;
        border: 1px solid #e1e8f0;
        border-radius: 12px;
        padding: 14px;
      }
      img { max-width: 100%; border-radius: 10px; box-shadow: 0 10px 22px rgba(36, 52, 71, 0.12); }
      figure { margin: 1.2em 0; }
      figcaption { margin-top: 8px; color: #617488; font-size: var(--font-size-xs); }
      .image-placeholder {
        padding: 18px;
        border: 1px dashed #c8d7e5;
        border-radius: 12px;
        background: #f7fbff;
        color: #5f7488;
        text-align: center;
      }
    </style>
  </head>
  <body>
    <main class="page">${bodyHtml || '<p>当前还没有可展示的解析结果。</p>'}</main>
  </body>
</html>`
}

export function DocumentEngineHostCommandsProvider({ children }: { children: ReactNode }) {
  const { runtime } = useDocumentEngineRuntime()
  const { openTab, tabs, activeTabId, setStatusMessage, ensureCurrentDocumentSaved, registerSaveHandler, runSaveHandler } = useDocument()
  const knowledge = useKnowledge()
  // Sequence counter for last-open-wins: each openDocumentPath call gets a unique seq; stale
  // async results are discarded if a newer call has already started.
  const openSeqRef = useRef(0)
  const activeTab = tabs.find((tab) => tab.id === activeTabId) || null
  const [pendingOpenDocument, setPendingOpenDocument] = useState<{
    filePath: string
    sourceContext?: MailAttachmentSourceContext
  } | null>(null)

  const openKnowledgeTextInEditor = useCallback(async (documentId: string, fallbackName: string) => {
    const detail = await window.electronAPI.getKnowledgeDocument(knowledge.departmentId, documentId)
    const extractedText = String(detail?.extractedText || detail?.originalExtractedText || '').trim()
    if (!detail || !extractedText) {
      setStatusMessage(`无法提取 ${fallbackName} 的结构化文本`)
      return false
    }

    const tabName = `${detail.meta.title || fallbackName}-提取文本.md`
    await openTab(null, tabName, plainTextToHtml(extractedText))
    setStatusMessage(`已将 ${fallbackName} 转为结构化文本并载入编辑器`)
    return true
  }, [openTab, setStatusMessage, knowledge.departmentId])

  const openDocumentPath = useCallback(async (filePath: string, options?: OpenDocumentPathOptions) => {
    if (!runtime) {
      setStatusMessage('文档引擎尚未就绪，请稍后再试')
      return
    }
    // Increment seq first so subsequent clicks immediately invalidate any in-flight request.
    const seq = ++openSeqRef.current

    if (!await ensureCurrentDocumentSaved('打开其他文件')) return
    if (seq !== openSeqRef.current) return

    const targetPath = String(filePath)
    const fileName = targetPath.split(/[\\/]/).pop() || 'document'
    const ext = fileName.split('.').pop()?.toLowerCase()

    // Build a stable canonical ID for dedup and tiptap-restore keying.
    const canonicalDocumentId = options?.sourceContext
      ? `mail:${options.sourceContext.messageId}:${options.sourceContext.originalAttachmentName}`
      : `local:${targetPath.replace(/\\/g, '/')}`

    try {
      if (ext && ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) {
        if (seq !== openSeqRef.current) return
        await openTab(targetPath, fileName, buildImagePreviewHtml(targetPath, fileName), { canonicalDocumentId })
        if (seq !== openSeqRef.current) return
        setStatusMessage(`已预览图片: ${fileName}`)
        return
      }

      if (ext === 'pdf') {
        const imported = await window.electronAPI.importKnowledgeDocumentFromPath(knowledge.departmentId, targetPath)
        if (seq !== openSeqRef.current) return
        const preferredDocument = imported.imported[0] || imported.duplicates[0] || null
        if (preferredDocument?.id) {
          await openKnowledgeTextInEditor(preferredDocument.id, fileName)
          return
        }
        const failure = imported.failed[0]
        setStatusMessage(failure ? `PDF 转文本失败: ${failure.error}` : `无法打开 PDF: ${fileName}`)
        return
      }

      if (ext === 'doc') {
        const opened = await window.electronAPI.openExternalFile(targetPath)
        if (seq !== openSeqRef.current) return
        if (!opened.success) {
          setStatusMessage(`无法打开 DOC: ${opened.error || '未知错误'}`)
          return
        }
        setStatusMessage(`DOC 文件已使用系统默认程序打开: ${fileName}`)
        return
      }

      // .aidoc.json is an AI Office internal auto-save/draft format.
      // It is NOT a user-facing document format.  When a user opens one (e.g. via
      // the file tree), we redirect to the corresponding canonical document file
      // (.docx → .html → .htm → .md → .txt).  Only programmatic internal flows
      // (blank-doc creation, generation saves, draft restore) may bypass this via
      // options.isInternalOpen = true.
      if (fileName.endsWith('.aidoc.json')) {
        if (!options?.isInternalOpen) {
          // Attempt to redirect to the canonical user document in the same directory.
          const sep = targetPath.includes('\\') ? '\\' : '/'
          const dir = targetPath.replace(/[/\\][^/\\]+$/, '')
          const baseName = fileName.slice(0, -'.aidoc.json'.length)

          const candidates = ['.docx', '.html', '.htm', '.md', '.txt']
          for (const ext of candidates) {
            const candidatePath = `${dir}${sep}${baseName}${ext}`
            try {
              // Use readOoxmlPackage for .docx (lighter than mammoth readFile),
              // and readFile for other text formats.
              if (ext === '.docx') {
                const snap = await window.electronAPI.readOoxmlPackage(candidatePath)
                if (seq !== openSeqRef.current) return
                if (!snap.exists) continue
              } else {
                await window.electronAPI.readFile(candidatePath)
                if (seq !== openSeqRef.current) return
              }
              // Sibling found — open it instead (inner call increments seq; outer exits cleanly).
              void openDocumentPath(candidatePath, { sourceContext: options?.sourceContext })
              return
            } catch {
              if (seq !== openSeqRef.current) return
              // Sibling not found — try next candidate.
            }
          }

          if (seq !== openSeqRef.current) return
          const displayName = fileName.endsWith('.aidoc.json') ? fileName.slice(0, -'.aidoc.json'.length) : fileName
          setStatusMessage(`"${displayName}" 是 AI Office 内部草稿状态文件，无法直接作为正式文稿打开。请打开对应的 Word 或 HTML 文件。`)
          return
        }

        // isInternalOpen = true: load the .aidoc.json directly into TipTap.
        const result = await window.electronAPI.readFile(targetPath)
        if (seq !== openSeqRef.current) return
        try {
          const payload = JSON.parse(result.content || '{}')
          if (payload.format === 'aidoc') {
            // tiptapJson may be null when saved via saveManuscript (HTML-only path);
            // fall back to html in that case so raw JSON is never shown in the editor.
            await runtime.loadDocument({
              filePath: targetPath,
              fileName,
              content: payload.html || '<p></p>',
              ...(payload.tiptapJson ? { tiptapJson: payload.tiptapJson } : {}),
              paperTemplateId: payload.paperTemplateId ?? null,
              sourceContext: options?.sourceContext,
              canonicalDocumentId,
            })
            if (seq !== openSeqRef.current) return
            setStatusMessage(`已打开: ${fileName}`)
            return
          }
        } catch {
          // malformed JSON — fall through to generic empty open
        }
        if (seq !== openSeqRef.current) return
        await runtime.loadDocument({ filePath: targetPath, fileName, content: '<p></p>', sourceContext: options?.sourceContext, canonicalDocumentId })
        if (seq !== openSeqRef.current) return
        setStatusMessage(`已打开: ${fileName}`)
        return
      }

      if (ext === 'docx' && runtime.engineId === 'embedded-office-engine') {
        const snapshot = await window.electronAPI.readOoxmlPackage(targetPath)
        if (seq !== openSeqRef.current) return
        if (snapshot.exists && snapshot.documentXml) {
          await runtime.loadDocument({
            filePath: targetPath,
            fileName,
            content: snapshot.html,
            sourceContext: options?.sourceContext,
            canonicalDocumentId,
          })
          if (seq !== openSeqRef.current) return
          setStatusMessage(`已通过 embedded engine 打开 DOCX: ${fileName}`)
          return
        }
      }

      const result = await window.electronAPI.readFile(targetPath)
      if (seq !== openSeqRef.current) return
      const safeImport = ext === 'docx' && result.preserveOriginalOnSave
      await runtime.loadDocument({
        filePath: safeImport ? null : targetPath,
        fileName,
        content: result.content || '<p></p>',
        preserveOriginalOnSave: safeImport,
        sourceContext: options?.sourceContext,
        canonicalDocumentId,
      })
      if (seq !== openSeqRef.current) return

      if (safeImport) {
        setStatusMessage(`已安全导入 DOCX（不会自动覆盖原文件）: ${fileName}`)
        return
      }

      setStatusMessage(ext === 'docx' ? `已打开 DOCX: ${fileName}` : `已打开: ${fileName}`)
    } catch (err) {
      if (seq !== openSeqRef.current) return
      const message = err instanceof Error ? err.message : String(err)
      setStatusMessage(`打开文件失败: ${fileName}${message ? ` (${message})` : ''}`)
    }
  }, [ensureCurrentDocumentSaved, openKnowledgeTextInEditor, openTab, runtime, setStatusMessage, knowledge.departmentId])

  useEffect(() => {
    const handleOpenDocumentRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ filePath?: string; sourceContext?: MailAttachmentSourceContext }>).detail
      const filePath = String(detail?.filePath || '').trim()
      if (!filePath) return
      setPendingOpenDocument({ filePath, sourceContext: detail?.sourceContext })
    }

    window.addEventListener('ai-office-open-document-request', handleOpenDocumentRequest)
    return () => window.removeEventListener('ai-office-open-document-request', handleOpenDocumentRequest)
  }, [])

  useEffect(() => {
    if (!pendingOpenDocument || !runtime) return
    const nextOpen = pendingOpenDocument
    setPendingOpenDocument(null)
    void openDocumentPath(nextOpen.filePath, { sourceContext: nextOpen.sourceContext })
  }, [openDocumentPath, pendingOpenDocument, runtime])

  const openKnowledgeDocumentPreview = useCallback(async (documentId: string) => {
    if (!runtime) {
      setStatusMessage('文档引擎尚未就绪，请稍后再试')
      return false
    }
    if (!await ensureCurrentDocumentSaved('打开知识库预览')) {
      return false
    }

    const normalizedId = String(documentId || '').trim()
    if (!normalizedId) {
      setStatusMessage('知识文档 ID 无效')
      return false
    }

    const [detail, info] = await Promise.all([
      window.electronAPI.getKnowledgeDocument(knowledge.departmentId, normalizedId),
      window.electronAPI.getKnowledgeBaseInfo(knowledge.departmentId),
    ])
    if (!detail) {
      setStatusMessage('知识文档不存在或已被删除')
      return false
    }

    const fileName = detail.meta.originalName || detail.meta.title || '知识文档'
    const rootPath = String(info?.rootPath || '')
    const storedPath = joinKnowledgePath(rootPath, detail.meta.storedRelativePath)
    const assetsRootPath = detail.assetDirRelativePath ? joinKnowledgePath(rootPath, detail.assetDirRelativePath) : null
    const sourceType = detail.meta.sourceType

    if (sourceType === 'pdf') {
      await openTab(null, fileName, '', {
        preview: {
          kind: 'pdf',
          source: toFileUrl(storedPath),
          hint: '当前知识文档以 PDF 只读模式内嵌预览。缩放、翻页与搜索由 Chromium 查看器提供。',
          actionLabel: '用系统程序打开原件',
          externalFilePath: storedPath,
        },
      })
      setStatusMessage(`已只读打开知识文档：${detail.meta.title}`)
      return true
    }

    if (sourceType === 'image') {
      await openTab(null, fileName, '', {
        preview: {
          kind: 'frame',
          sourceDoc: `<!doctype html><html><body style="margin:0;display:flex;align-items:center;justify-content:center;background:#111827;"><img src="${escapeHtml(toFileUrl(storedPath))}" alt="${escapeHtml(fileName)}" style="max-width:100vw;max-height:100vh;object-fit:contain;" /></body></html>`,
          hint: '当前知识图片以只读方式打开。',
          actionLabel: '用系统程序打开原图',
          externalFilePath: storedPath,
        },
      })
      setStatusMessage(`已只读打开知识图片：${detail.meta.title}`)
      return true
    }

    if (sourceType === 'docx') {
      const snapshot = await window.electronAPI.readOoxmlPackage(storedPath).catch(() => null)
      if (snapshot?.exists && snapshot.html) {
        await openTab(null, fileName, '', {
          preview: {
            kind: 'frame',
            sourceDoc: buildKnowledgePreviewDocumentHtml(detail.meta.title, null, '', null, snapshot.html),
            hint: '当前知识文档以只读方式打开。内容来自 DOCX 结构化快照，不会改写原文件。',
            actionLabel: '用系统程序打开原件',
            externalFilePath: storedPath,
          },
        })
        setStatusMessage(`已只读打开知识文档：${detail.meta.title}`)
        return true
      }
    }

    const previewHtml = buildKnowledgePreviewDocumentHtml(
      detail.meta.title,
      detail.parsedDocument,
      detail.extractedText || detail.originalExtractedText || '',
      assetsRootPath,
    )

    await openTab(null, fileName, '', {
      preview: {
        kind: 'frame',
        sourceDoc: previewHtml,
        hint: `当前知识文档以只读方式打开。内容来自 ${sourceType.toUpperCase()} 的解析结果，不会改写原文件。`,
        actionLabel: '用系统程序打开原件',
        externalFilePath: storedPath || null,
      },
    })
    setStatusMessage(`已只读打开知识文档：${detail.meta.title}`)
    return true
  }, [ensureCurrentDocumentSaved, openTab, runtime, setStatusMessage, knowledge.departmentId])

  const requestOpenFromDialog = useCallback(async () => {
    const selectedPath = await window.electronAPI.openFileDialog()
    if (!selectedPath) return
    await openDocumentPath(selectedPath)
  }, [openDocumentPath])

  const saveActiveDocument = useCallback(async (request?: DocumentEngineSaveRequest) => {
    if (activeTab?.preview) {
      setStatusMessage('当前预览标签为只读模式，不能直接保存')
      return
    }
    if (request?.mode !== 'save-as') {
      const handled = await runSaveHandler()
      if (handled) {
        return
      }
    }
    if (!runtime) {
      setStatusMessage('文档引擎尚未就绪，请稍后再试')
      return
    }
    await runtime.saveDocument(request)
  }, [activeTab?.preview, runSaveHandler, runtime, setStatusMessage])

  // P0 fix: removed save handler registration here to avoid overwriting
  // the workspace bridge save handler (WorkspaceSchemaRuntimeBridge).
  // saveActiveDocument already falls through to runtime.saveDocument()
  // when runSaveHandler() returns false (no workspace active).

  const saveActiveDocumentAs = useCallback(async () => {
    await saveActiveDocument({ reason: 'manual', mode: 'save-as' })
  }, [saveActiveDocument])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      if (key === 'o') {
        event.preventDefault()
        void requestOpenFromDialog()
        return
      }
      if (key === 's' && event.shiftKey) {
        event.preventDefault()
        void saveActiveDocumentAs()
        return
      }
      if (key === 's') {
        event.preventDefault()
        void saveActiveDocument({ reason: 'manual' })
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [requestOpenFromDialog, saveActiveDocument, saveActiveDocumentAs])

  const value = useMemo(() => ({ requestOpenFromDialog, openDocumentPath, openKnowledgeDocumentPreview, saveActiveDocument, saveActiveDocumentAs }), [openDocumentPath, openKnowledgeDocumentPreview, requestOpenFromDialog, saveActiveDocument, saveActiveDocumentAs])

  return (
    <DocumentEngineHostCommandsContext.Provider value={value}>
      {children}
    </DocumentEngineHostCommandsContext.Provider>
  )
}

export function useDocumentEngineHostCommands() {
  const ctx = useContext(DocumentEngineHostCommandsContext)
  if (!ctx) {
    throw new Error('useDocumentEngineHostCommands 必须在 DocumentEngineHostCommandsProvider 内使用')
  }
  return ctx
}
