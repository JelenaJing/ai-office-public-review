import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import styled from 'styled-components'
import { AlertTriangle, X } from 'lucide-react'
import type { ArticleSection } from '../services/ArticleClassificationService'
import type { UnsavedDialogDecision } from '../services/UnsavedCloseFlow'
import {
  createLegacyEditorTab,
  createManuscriptEditorTab,
  getEditorTabResolvedContent,
  getEditorTabResolvedDirty,
  getEditorTabResolvedSavedContent,
  isLegacyEditorTab,
  isManuscriptEditorTab,
  isReusableEmptyManuscriptDraftTab,
  isWritableManuscriptEditorTab,
  markEditorTabShellSaved,
  setEditorTabShellContent,
  updateEditorTabShellProjection,
  updateManuscriptEditorTab,
  type EditorTab,
  type EditorTabPreview,
  type ManuscriptEditorTab,
  type UpdateManuscriptEditorTabInput,
} from '../document/editorTabs'
import type { MailAttachmentSourceContext } from '../types/mailAttachment'
import {
  type UpdateManuscriptTabStateInput,
} from '../document/manuscriptTabState'

interface OpenTabOptions {
  preview?: EditorTabPreview
  asManuscript?: boolean
  sourceContext?: MailAttachmentSourceContext
  /** Stable unique ID used for dedup. See EditorTabBase.canonicalDocumentId. */
  canonicalDocumentId?: string
}

interface EnsureWritableManuscriptTargetOptions {
  actionLabel?: string
  preferredTabId?: string | null
  fileName?: string
  skipSourceSavePrompt?: boolean
}

interface SyncManuscriptTabStateOptions extends UpdateManuscriptEditorTabInput {
  filePath?: string | null
  fileName?: string
}

interface EnsureManuscriptTabOptions extends EnsureWritableManuscriptTargetOptions, SyncManuscriptTabStateOptions {
  requireDraft?: boolean
}

interface EnsureActiveDraftTabOptions extends EnsureWritableManuscriptTargetOptions, UpdateManuscriptTabStateInput {
  filePath?: string | null
  fileName?: string
}

interface DocumentState {
  markdown: string
  setMarkdown: (value: string) => void
  filePath: string | null
  setFilePath: (value: string | null) => void
  currentFileName: string
  dirty: boolean
  setDirty: (value: boolean) => void
  isGenerating: boolean
  setIsGenerating: (value: boolean) => void
  statusMessage: string
  setStatusMessage: (value: string) => void
  continueWritingDocId: string | null
  setContinueWritingDocId: (value: string | null) => void
  clearDocument: () => void
  tabs: EditorTab[]
  activeTabId: string
  ensureCurrentDocumentSaved: (actionLabel?: string) => Promise<boolean>
  registerSaveHandler: (handler: () => Promise<boolean>) => () => void
  registerDiscardHandler: (handler: () => Promise<boolean>) => () => void
  runSaveHandler: () => Promise<boolean>
  syncManuscriptTabState: (tabId: string, nextState: SyncManuscriptTabStateOptions) => void
  isTabDirty: (tabId: string) => boolean
  ensureManuscriptTab: (options?: EnsureManuscriptTabOptions) => Promise<ManuscriptEditorTab | null>
  openTab: (filePath: string | null, fileName: string, content: string, options?: OpenTabOptions) => Promise<void>
  closeTab: (tabId: string) => Promise<void>
  switchTab: (tabId: string) => Promise<void>
  newTab: () => Promise<void>
  mainTabId: string
  switchToMainTab: () => Promise<void>
  ensureActiveDraftTab: (options?: EnsureActiveDraftTabOptions) => Promise<ManuscriptEditorTab | null>
  ensureWritableManuscriptTarget: (options?: EnsureWritableManuscriptTargetOptions) => Promise<ManuscriptEditorTab | null>
  setTabShellContent: (tabId: string, content: string) => void
  markTabShellSaved: (tabId: string, nextState?: { filePath?: string | null; fileName?: string; content?: string }) => void
  /** @deprecated Compat alias only. Use setTabShellContent for shell projection updates. */
  setTabContent: (tabId: string, content: string) => void
  /** @deprecated Compat alias only. Use markTabShellSaved for shell projection save mirrors. */
  markTabSaved: (tabId: string, nextState?: { filePath?: string | null; fileName?: string; content?: string }) => void
  articleType: string | null
  setArticleType: (value: string | null) => void
  articleSections: ArticleSection[]
  setArticleSections: (value: ArticleSection[]) => void
}

const MAIN_TAB_ID = 'main'
const DEFAULT_DRAFT_TAB_NAME = '未保存草稿'
const DocumentContext = createContext<DocumentState | null>(null)

function buildNextDraftTabName(tabs: EditorTab[], requestedName?: string | null): string {
  const normalizedRequestedName = String(requestedName || '').trim()
  if (normalizedRequestedName) return normalizedRequestedName

  const existingDraftCount = tabs.filter((tab) => !tab.filePath && tab.fileName.startsWith(DEFAULT_DRAFT_TAB_NAME)).length
  return existingDraftCount > 0 ? `${DEFAULT_DRAFT_TAB_NAME} ${existingDraftCount + 1}` : DEFAULT_DRAFT_TAB_NAME
}

const UnsavedDialogOverlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 3000;
  background: rgba(15, 23, 42, 0.22);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
`

const UnsavedDialogCard = styled.div`
  width: min(420px, calc(100vw - 32px));
  border-radius: 16px;
  border: 1px solid #d9e2ec;
  background: #ffffff;
  box-shadow: 0 18px 44px rgba(19, 41, 61, 0.18);
  overflow: hidden;
`

const UnsavedDialogHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 20px 10px;
`

const UnsavedDialogTitleWrap = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
`

const UnsavedDialogTitle = styled.div`
  font-size: 16px;
  font-weight: 700;
  color: #1f3142;
`

const UnsavedDialogIcon = styled(AlertTriangle)`
  flex-shrink: 0;
  color: #ef6c21;
`

const UnsavedDialogCloseButton = styled.button`
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: #7a8794;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;

  &:hover {
    background: #f2f5f8;
    color: #4f5f70;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`

const UnsavedDialogBody = styled.div`
  padding: 6px 20px 18px;
  font-size: var(--font-size-xs);
  line-height: 1.7;
  color: #44576a;
`

const UnsavedDialogFileName = styled.div`
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 700;
  color: #1f3142;
  word-break: break-word;
`

const UnsavedDialogDescription = styled.div`
  color: #506272;
`

const UnsavedDialogActions = styled.div`
  display: flex;
  justify-content: flex-start;
  gap: 10px;
  padding: 0 20px 20px;
`

const UnsavedDialogButton = styled.button<{ $primary?: boolean }>`
  min-width: 92px;
  height: 36px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid ${p => p.$primary ? '#2f62d8' : '#d6e0ea'};
  background: ${p => p.$primary ? '#2e68e6' : '#ffffff'};
  color: ${p => p.$primary ? '#ffffff' : '#304255'};
  font-size: var(--font-size-xs);
  font-weight: 600;
  cursor: pointer;
  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`

interface UnsavedDialogState {
  fileName: string
  title: string
  description: string
  actionLabel: string
  closeAfterSaveAttempt?: boolean
  isSaving: boolean
}

export function useDocument(): DocumentState {
  const ctx = useContext(DocumentContext)
  if (!ctx) throw new Error('useDocument 必须在 DocumentProvider 内使用')
  return ctx
}

export function DocumentProvider({ children }: { children: ReactNode }) {
  const [markdown, setMarkdownRaw] = useState('')
  const [filePath, setFilePath] = useState<string | null>(null)
  const [dirty, setDirtyState] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [continueWritingDocId, setContinueWritingDocId] = useState<string | null>(null)
  const [articleType, setArticleType] = useState<string | null>(null)
  const [articleSections, setArticleSections] = useState<ArticleSection[]>([])
  const [tabs, setTabs] = useState<EditorTab[]>([])
  const [activeTabId, setActiveTabId] = useState('')
  const [unsavedDialog, setUnsavedDialog] = useState<UnsavedDialogState | null>(null)
  const activeTabIdRef = useRef('')
  const tabsRef = useRef<EditorTab[]>([])
  const dirtyRef = useRef(false)
  const unsavedDialogResolverRef = useRef<((decision: UnsavedDialogDecision) => void) | null>(null)
  const saveHandlerRef = useRef<(() => Promise<boolean>) | null>(null)
  const discardHandlerRef = useRef<(() => Promise<boolean>) | null>(null)
  const appCloseInProgressRef = useRef(false)
  activeTabIdRef.current = activeTabId
  tabsRef.current = tabs
  dirtyRef.current = dirty
  const currentFileName = tabs.find((tab) => tab.id === activeTabId)?.fileName || '未命名文档'

  const isTabDirty = useCallback((tabId: string) => {
    return getEditorTabResolvedDirty(tabsRef.current.find((tab) => tab.id === tabId) || null)
  }, [])

  const setDirty = useCallback((value: boolean) => {
    const activeTab = tabsRef.current.find((tab) => tab.id === activeTabIdRef.current) || null
    if (isManuscriptEditorTab(activeTab)) {
      setDirtyState(getEditorTabResolvedDirty(activeTab))
      return
    }
    setDirtyState(value)
  }, [])

  const openUnsavedDialog = useCallback((payload: Omit<UnsavedDialogState, 'isSaving'>) => {
    return new Promise<UnsavedDialogDecision>((resolve) => {
      unsavedDialogResolverRef.current = resolve
      setUnsavedDialog({
        ...payload,
        closeAfterSaveAttempt: payload.closeAfterSaveAttempt ?? false,
        isSaving: false,
      })
    })
  }, [])

  const discardTabChanges = useCallback((tabId: string) => {
      const activeSnapshot = activeTabIdRef.current === tabId
        ? tabsRef.current.find((tab) => tab.id === tabId) || null
        : null
      const activeNextTab = activeSnapshot && !isManuscriptEditorTab(activeSnapshot)
        ? markEditorTabShellSaved(activeSnapshot, {
            content: getEditorTabResolvedSavedContent(activeSnapshot),
          })
        : null

      setTabs((prev) => prev.map((tab) => {
        if (tab.id !== tabId) return tab
        if (isManuscriptEditorTab(tab)) return tab
        return markEditorTabShellSaved(tab, {
          content: getEditorTabResolvedSavedContent(tab),
        })
      }))

      if (activeTabIdRef.current === tabId && activeNextTab) {
        setMarkdownRaw(getEditorTabResolvedContent(activeNextTab))
        setDirty(false)
      }
  }, [])

  const closeUnsavedDialog = useCallback((decision: UnsavedDialogDecision) => {
    const resolver = unsavedDialogResolverRef.current
    unsavedDialogResolverRef.current = null
    setUnsavedDialog(null)
    resolver?.(decision)
  }, [])

  const registerSaveHandler = useCallback((handler: () => Promise<boolean>) => {
    saveHandlerRef.current = handler
    return () => {
      if (saveHandlerRef.current === handler) {
        saveHandlerRef.current = null
      }
    }
  }, [])

  const registerDiscardHandler = useCallback((handler: () => Promise<boolean>) => {
    discardHandlerRef.current = handler
    return () => {
      if (discardHandlerRef.current === handler) {
        discardHandlerRef.current = null
      }
    }
  }, [])

  const runSaveHandler = useCallback(async () => {
    if (!saveHandlerRef.current) {
      return false
    }
    return saveHandlerRef.current()
  }, [])

  const syncManuscriptTabState = useCallback((tabId: string, nextState: SyncManuscriptTabStateOptions) => {
    const activeSnapshot = activeTabIdRef.current === tabId
      ? tabsRef.current.find((tab) => tab.id === tabId) || null
      : null
    const activeNextTab = isManuscriptEditorTab(activeSnapshot)
      ? updateManuscriptEditorTab(activeSnapshot, nextState)
      : null

    setTabs((prev) => prev.map((tab) => {
      if (tab.id !== tabId) return tab
      if (!isManuscriptEditorTab(tab)) return tab
      return updateManuscriptEditorTab(tab, nextState)
    }))

    if (activeTabIdRef.current === tabId && activeNextTab) {
      if (activeNextTab.filePath !== undefined) setFilePath(activeNextTab.filePath)
      setMarkdownRaw(getEditorTabResolvedContent(activeNextTab))
      setDirtyState(getEditorTabResolvedDirty(activeNextTab))
    }
  }, [])

  const ensureCurrentDocumentSaved = useCallback(async (actionLabel = '继续当前操作') => {
    const activeId = activeTabIdRef.current
    if (!activeId) return true
    const activeTab = tabsRef.current.find((tab) => tab.id === activeId)
    if (!getEditorTabResolvedDirty(activeTab)) return true
    // Try silent auto-save first, skip dialog if successful
    if (saveHandlerRef.current) {
      try {
        const saved = await saveHandlerRef.current()
        if (saved) return true
      } catch { /* fall through to dialog */ }
    }
    const label = activeTab?.fileName || '当前文档'

    const decision = await openUnsavedDialog({
      title: '是否保存文档？',
      fileName: label,
      description: `是否先保存对“${label}”的更改，再${actionLabel}？`,
      actionLabel,
    })

    if (decision === 'discard') {
      if (discardHandlerRef.current) {
        const discarded = await discardHandlerRef.current()
        return discarded
      }
      if (isManuscriptEditorTab(activeTab)) {
        setStatusMessage('当前 manuscript 文稿未接入可用的 discard 回退处理，已取消切换操作')
        return false
      }
      discardTabChanges(activeId)
      return true
    }

    return decision === 'save'
  }, [discardTabChanges, openUnsavedDialog, setStatusMessage])

  const setMarkdown = useCallback((value: string) => {
    setMarkdownRaw(value)
    setTabs((prev) => prev.map((tab) => {
      if (tab.id !== activeTabIdRef.current) return tab
      return setEditorTabShellContent(tab, value)
    }))
  }, [])

  const syncCurrentTabSnapshot = useCallback((collection: EditorTab[]) => {
    return collection.map((tab) => (
      tab.id === activeTabIdRef.current
        ? updateEditorTabShellProjection(tab, { content: markdown, dirty })
        : tab
    ))
  }, [dirty, markdown])

  const activateTabState = useCallback((tab: EditorTab) => {
    setActiveTabId(tab.id)
    setMarkdownRaw(getEditorTabResolvedContent(tab))
    setFilePath(tab.filePath)
    setDirtyState(getEditorTabResolvedDirty(tab))
  }, [])

  const setTabShellContent = useCallback((tabId: string, content: string) => {
    const activeSnapshot = activeTabIdRef.current === tabId
      ? tabsRef.current.find((tab) => tab.id === tabId) || null
      : null
    const activeNextTab = activeSnapshot
      ? setEditorTabShellContent(activeSnapshot, content)
      : null

    setTabs((prev) => prev.map((tab) => {
      if (tab.id !== tabId) return tab
      return setEditorTabShellContent(tab, content)
    }))

    if (activeTabIdRef.current === tabId) {
      setMarkdownRaw(content)
      setDirtyState(activeNextTab ? getEditorTabResolvedDirty(activeNextTab) : true)
    }
  }, [])

  const markTabShellSaved = useCallback((tabId: string, nextState?: { filePath?: string | null; fileName?: string; content?: string }) => {
    const activeSnapshot = activeTabIdRef.current === tabId
      ? tabsRef.current.find((tab) => tab.id === tabId) || null
      : null
    const activeNextTab = activeSnapshot
      ? markEditorTabShellSaved(activeSnapshot, nextState)
      : null

    setTabs((prev) => prev.map((tab) => {
      if (tab.id !== tabId) return tab
      return markEditorTabShellSaved(tab, nextState)
    }))

    if (activeTabIdRef.current === tabId && activeNextTab) {
      if (nextState?.filePath !== undefined) setFilePath(nextState.filePath)
      setMarkdownRaw(getEditorTabResolvedContent(activeNextTab))
      setDirtyState(getEditorTabResolvedDirty(activeNextTab))
    }
  }, [])

  const setTabContentCompat = useCallback((tabId: string, content: string) => {
    setTabShellContent(tabId, content)
  }, [setTabShellContent])

  const markTabSavedCompat = useCallback((tabId: string, nextState?: { filePath?: string | null; fileName?: string; content?: string }) => {
    markTabShellSaved(tabId, nextState)
  }, [markTabShellSaved])

  const clearDocument = () => {
    setMarkdownRaw('')
    setFilePath(null)
    setDirty(false)
    setIsGenerating(false)
    setStatusMessage('')
    setContinueWritingDocId(null)
    setArticleType(null)
    setArticleSections([])
  }

  const openTab = useCallback(async (nextFilePath: string | null, fileName: string, content: string, options?: OpenTabOptions) => {
    if (!await ensureCurrentDocumentSaved('打开其他文件')) return
    const openAsManuscript = Boolean(options?.asManuscript && !options?.preview)
    const nextCanonicalId = options?.canonicalDocumentId ?? null
    const buildOpenedTab = (id: string): EditorTab => {
      if (openAsManuscript) {
        const artifactKey = nextFilePath || `opened:${fileName}:${id}`
        return createManuscriptEditorTab({
          id,
          filePath: nextFilePath,
          fileName,
          preview: options?.preview,
          sourceContext: options?.sourceContext,
          canonicalDocumentId: nextCanonicalId ?? undefined,
          currentArtifactKey: artifactKey,
          acceptedArtifactKey: artifactKey,
          currentCompatHtml: content,
          acceptedCompatHtml: content,
        })
      }
      return createLegacyEditorTab({ id, filePath: nextFilePath, fileName, content, savedContent: content, dirty: false, preview: options?.preview, sourceContext: options?.sourceContext, canonicalDocumentId: nextCanonicalId ?? undefined })
    }
    setTabs((prev) => {
      const updated = syncCurrentTabSnapshot(prev)
      // Dedup priority: canonicalDocumentId > filePath > sourceContext (mail attachment)
      let existing: EditorTab | null = null
      if (nextCanonicalId) {
        existing = updated.find((tab) => tab.canonicalDocumentId === nextCanonicalId) ?? null
      }
      if (!existing && nextFilePath) {
        existing = updated.find((tab) => tab.filePath === nextFilePath) ?? null
      }
      if (!existing && options?.sourceContext) {
        existing = updated.find((tab) =>
          tab.sourceContext?.messageId === options.sourceContext!.messageId &&
          tab.sourceContext?.originalAttachmentName === options.sourceContext!.originalAttachmentName
        ) ?? null
      }
      if (existing) {
        const nextExisting = openAsManuscript
          ? isManuscriptEditorTab(existing)
            ? updateManuscriptEditorTab(existing, {
                filePath: nextFilePath,
                fileName,
                preview: options?.preview,
                sourceContext: options?.sourceContext,
                currentArtifactKey: nextFilePath || `opened:${fileName}:${existing.id}`,
                acceptedArtifactKey: nextFilePath || `opened:${fileName}:${existing.id}`,
                currentCompatHtml: content,
                acceptedCompatHtml: content,
              })
            : buildOpenedTab(existing.id)
           : createLegacyEditorTab({ id: existing.id, filePath: nextFilePath, fileName, content, savedContent: content, dirty: false, preview: options?.preview, sourceContext: options?.sourceContext, canonicalDocumentId: nextCanonicalId ?? existing.canonicalDocumentId ?? undefined })
        setActiveTabId(nextExisting.id)
        setMarkdownRaw(getEditorTabResolvedContent(nextExisting))
        setFilePath(nextExisting.filePath)
        setDirtyState(getEditorTabResolvedDirty(nextExisting))
        return updated.map((tab) => tab.id === nextExisting.id ? nextExisting : tab)
      }
      const singleEmpty = updated.length === 1 && !updated[0].filePath && !getEditorTabResolvedContent(updated[0]).trim() && !getEditorTabResolvedDirty(updated[0])
      if (singleEmpty) {
        const id = updated[0].id
        const nextTab = buildOpenedTab(id)
        setActiveTabId(id)
        setMarkdownRaw(getEditorTabResolvedContent(nextTab))
        setFilePath(nextTab.filePath)
        setDirtyState(getEditorTabResolvedDirty(nextTab))
        return [nextTab]
      }
      const id = `tab_${Date.now()}`
      const nextTab = buildOpenedTab(id)
      setActiveTabId(id)
      setMarkdownRaw(getEditorTabResolvedContent(nextTab))
      setFilePath(nextTab.filePath)
      setDirtyState(getEditorTabResolvedDirty(nextTab))
      return [...updated, nextTab]
    })
  }, [ensureCurrentDocumentSaved, syncCurrentTabSnapshot])

  const closeTab = useCallback(async (tabId: string) => {
    const targetTab = tabsRef.current.find((tab) => tab.id === tabId)
    if (getEditorTabResolvedDirty(targetTab)) {
      if (activeTabIdRef.current !== tabId) {
        // Non-active dirty tab: saveHandlerRef is wired to the currently-active editor,
        // so calling ensureCurrentDocumentSaved here would operate on the wrong document.
        // Switch to the target tab first; the user can then save and close again.
        activateTabState(targetTab!)
        setStatusMessage(`"${targetTab!.fileName || '文档'}"有未保存修改，已切换到该标签页，请确认后再关闭。`)
        return
      }
      if (!await ensureCurrentDocumentSaved('关闭标签页')) return
    }
    setTabs((prev) => {
      const idx = prev.findIndex((tab) => tab.id === tabId)
      if (idx === -1) return prev
      const next = prev.filter((tab) => tab.id !== tabId)
      if (activeTabIdRef.current === tabId) {
        if (next.length > 0) {
          const fallback = next[Math.min(idx, next.length - 1)]
          setActiveTabId(fallback.id)
          setMarkdownRaw(getEditorTabResolvedContent(fallback))
          setFilePath(fallback.filePath)
          setDirtyState(getEditorTabResolvedDirty(fallback))
        } else {
          setActiveTabId('')
          setMarkdownRaw('')
          setFilePath(null)
          setDirty(false)
        }
      }
      return next
    })
  }, [ensureCurrentDocumentSaved, activateTabState, setStatusMessage])

  const switchTab = useCallback(async (tabId: string) => {
    if (tabId !== activeTabIdRef.current && !await ensureCurrentDocumentSaved('切换标签页')) return
    setTabs((prev) => {
      const target = prev.find((tab) => tab.id === tabId)
      if (target) {
        setActiveTabId(tabId)
        setMarkdownRaw(getEditorTabResolvedContent(target))
        setFilePath(target.filePath)
        setDirtyState(getEditorTabResolvedDirty(target))
      }
      return prev
    })
  }, [ensureCurrentDocumentSaved])

  const ensureManuscriptTab = useCallback(async (options?: EnsureManuscriptTabOptions) => {
    const preferredDraftTab = options?.preferredTabId
      ? tabsRef.current.find((tab) => tab.id === options.preferredTabId) || null
      : null
    const requireDraft = Boolean(options?.requireDraft)

    if (isWritableManuscriptEditorTab(preferredDraftTab) && (!requireDraft || !preferredDraftTab.filePath)) {
      const nextTab = options ? updateManuscriptEditorTab(preferredDraftTab, options) : preferredDraftTab
      setTabs((prev) => syncCurrentTabSnapshot(prev).map((tab) => tab.id === nextTab.id ? nextTab : tab))
      activateTabState(nextTab)
      return nextTab
    }

    const activeTab = tabsRef.current.find((tab) => tab.id === activeTabIdRef.current) || null
    if (isWritableManuscriptEditorTab(activeTab) && (!requireDraft || !activeTab.filePath)) {
      if (!options) return activeTab
      const nextTab = updateManuscriptEditorTab(activeTab, options)
      setTabs((prev) => syncCurrentTabSnapshot(prev).map((tab) => tab.id === nextTab.id ? nextTab : tab))
      if (activeTabIdRef.current === nextTab.id) {
        activateTabState(nextTab)
      }
      return nextTab
    }

    const actionLabel = options?.actionLabel || '开始全文生成'
    if (!options?.skipSourceSavePrompt && !await ensureCurrentDocumentSaved(actionLabel)) return null

    const syncedTabs = syncCurrentTabSnapshot(tabsRef.current)
    const draftName = buildNextDraftTabName(syncedTabs, options?.fileName)
    const reusableEmptyTab = syncedTabs.length === 1 && isReusableEmptyManuscriptDraftTab(syncedTabs[0])
      ? { ...syncedTabs[0], fileName: draftName }
      : null
    const nextDraftTab = reusableEmptyTab
      ? updateManuscriptEditorTab(reusableEmptyTab, options || {})
      : createManuscriptEditorTab({
          id: `tab_${Date.now()}`,
          filePath: options?.filePath ?? null,
          fileName: draftName,
          ownerLabel: options?.ownerLabel,
          currentArtifactKey: options?.currentArtifactKey,
          acceptedArtifactKey: options?.acceptedArtifactKey,
          currentCompatHtml: options?.currentCompatHtml,
          acceptedCompatHtml: options?.acceptedCompatHtml,
        })

    setTabs((prev) => {
      const updated = syncCurrentTabSnapshot(prev)
      if (updated.length === 1 && isReusableEmptyManuscriptDraftTab(updated[0])) {
        return [nextDraftTab]
      }
      return [...updated, nextDraftTab]
    })
    activateTabState(nextDraftTab)
    return nextDraftTab
  }, [activateTabState, ensureCurrentDocumentSaved, syncCurrentTabSnapshot])

  const ensureActiveDraftTab = useCallback(async (options?: EnsureActiveDraftTabOptions) => {
    return ensureManuscriptTab({
      ...options,
      requireDraft: true,
      filePath: null,
    })
  }, [ensureManuscriptTab])

  const ensureWritableManuscriptTarget = useCallback(async (options?: EnsureWritableManuscriptTargetOptions) => {
    return ensureManuscriptTab(options)
  }, [ensureManuscriptTab])

  const newTab = useCallback(async () => {
    if (!await ensureCurrentDocumentSaved('新建标签页')) return
    const id = `tab_${Date.now()}`
    setTabs((prev) => [...syncCurrentTabSnapshot(prev), createLegacyEditorTab({ id, filePath: null, fileName: '未命名文档', content: '', savedContent: '', dirty: false })])
    setActiveTabId(id)
    setMarkdownRaw('')
    setFilePath(null)
    setDirty(false)
  }, [ensureCurrentDocumentSaved, setDirty, syncCurrentTabSnapshot])

  const switchToMainTab = useCallback(async () => {
    if (activeTabIdRef.current !== MAIN_TAB_ID && !await ensureCurrentDocumentSaved('切换到 AI 生成标签')) return
    setTabs((prev) => {
      const updated = syncCurrentTabSnapshot(prev)
      const mainTab = updated.find((tab) => tab.id === MAIN_TAB_ID)
      if (mainTab) {
        setActiveTabId(MAIN_TAB_ID)
        setMarkdownRaw(getEditorTabResolvedContent(mainTab))
        setFilePath(mainTab.filePath)
        setDirtyState(getEditorTabResolvedDirty(mainTab))
        return updated
      }
      const aiTab = createLegacyEditorTab({ id: MAIN_TAB_ID, filePath: null, fileName: 'AI 生成', content: '', savedContent: '', dirty: false })
      setActiveTabId(MAIN_TAB_ID)
      setMarkdownRaw('')
      setFilePath(null)
      setDirty(false)
      return [...updated, aiTab]
    })
  }, [ensureCurrentDocumentSaved, syncCurrentTabSnapshot])

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (appCloseInProgressRef.current) return
      const activeId = activeTabIdRef.current
      const activeTab = tabsRef.current.find((tab) => tab.id === activeId)
      if (!getEditorTabResolvedDirty(activeTab)) return
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  useEffect(() => {
    const electronApi = window.electronAPI
    if (!electronApi?.onAppCloseRequest || !electronApi?.resolveAppCloseRequest) return

    const dispose = electronApi.onAppCloseRequest(() => {
      appCloseInProgressRef.current = true
      unsavedDialogResolverRef.current = null
      setUnsavedDialog(null)
      void electronApi.resolveAppCloseRequest('close')
    })

    return dispose
  }, [])

  const documentContextValue = useMemo(() => ({
    markdown,
    setMarkdown,
    filePath,
    setFilePath,
    currentFileName,
    dirty,
    setDirty,
    isGenerating,
    setIsGenerating,
    statusMessage,
    setStatusMessage,
    continueWritingDocId,
    setContinueWritingDocId,
    clearDocument,
    tabs,
    activeTabId,
    ensureCurrentDocumentSaved,
    registerSaveHandler,
    registerDiscardHandler,
    runSaveHandler,
    syncManuscriptTabState,
    isTabDirty,
    ensureManuscriptTab,
    openTab,
    closeTab,
    switchTab,
    newTab,
    mainTabId: MAIN_TAB_ID,
    switchToMainTab,
    ensureActiveDraftTab,
    ensureWritableManuscriptTarget,
    setTabShellContent,
    markTabShellSaved,
    setTabContent: setTabContentCompat,
    markTabSaved: markTabSavedCompat,
    articleType,
    setArticleType,
    articleSections,
    setArticleSections,
  }), [
    markdown,
    filePath,
    currentFileName,
    dirty,
    isGenerating,
    statusMessage,
    continueWritingDocId,
    tabs,
    activeTabId,
    articleType,
    articleSections,
    setMarkdown,
    setFilePath,
    setDirty,
    setIsGenerating,
    setStatusMessage,
    setContinueWritingDocId,
    clearDocument,
    ensureCurrentDocumentSaved,
    registerSaveHandler,
    registerDiscardHandler,
    runSaveHandler,
    syncManuscriptTabState,
    isTabDirty,
    ensureManuscriptTab,
    openTab,
    closeTab,
    switchTab,
    newTab,
    switchToMainTab,
    ensureActiveDraftTab,
    ensureWritableManuscriptTarget,
    setTabShellContent,
    markTabShellSaved,
    setTabContentCompat,
    markTabSavedCompat,
    setArticleType,
    setArticleSections,
  ])

  return (
    <>
      <DocumentContext.Provider value={documentContextValue}>
        {children}
      </DocumentContext.Provider>
      {unsavedDialog && (
        <UnsavedDialogOverlay onMouseDown={() => !unsavedDialog.isSaving && closeUnsavedDialog('cancel')}>
          <UnsavedDialogCard onMouseDown={(event) => event.stopPropagation()}>
            <UnsavedDialogHeader>
              <UnsavedDialogTitleWrap>
                <UnsavedDialogIcon size={18} strokeWidth={2.2} />
                <UnsavedDialogTitle>{unsavedDialog.title}</UnsavedDialogTitle>
              </UnsavedDialogTitleWrap>
              <UnsavedDialogCloseButton type="button" onClick={() => closeUnsavedDialog('cancel')} disabled={unsavedDialog.isSaving} aria-label="关闭弹窗">
                <X size={16} />
              </UnsavedDialogCloseButton>
            </UnsavedDialogHeader>
            <UnsavedDialogBody>
              <UnsavedDialogFileName>{unsavedDialog.fileName}</UnsavedDialogFileName>
              <UnsavedDialogDescription>{unsavedDialog.description}</UnsavedDialogDescription>
            </UnsavedDialogBody>
            <UnsavedDialogActions>
              <UnsavedDialogButton
                $primary
                onClick={async () => {
                  const shouldCloseAfterSaveAttempt = Boolean(unsavedDialog.closeAfterSaveAttempt)
                  if (!saveHandlerRef.current) {
                    setStatusMessage(shouldCloseAfterSaveAttempt ? '当前文档尚未接入保存能力，将继续退出应用' : '当前文档尚未接入保存能力')
                    closeUnsavedDialog(shouldCloseAfterSaveAttempt ? 'save' : 'cancel')
                    return
                  }
                  setUnsavedDialog((current) => current ? { ...current, isSaving: true } : current)
                  try {
                    const saved = await saveHandlerRef.current()
                    if (saved || shouldCloseAfterSaveAttempt) {
                      if (!saved && shouldCloseAfterSaveAttempt) {
                        setStatusMessage('保存未完成，将按当前选择继续退出应用')
                      }
                      closeUnsavedDialog('save')
                      return
                    }
                    setUnsavedDialog((current) => current ? { ...current, isSaving: false } : current)
                  } catch (error: any) {
                    setStatusMessage(shouldCloseAfterSaveAttempt
                      ? `保存失败: ${error?.message || '未知错误'}；将继续退出应用`
                      : `保存失败: ${error?.message || '未知错误'}`)
                    if (shouldCloseAfterSaveAttempt) {
                      closeUnsavedDialog('save')
                      return
                    }
                    setUnsavedDialog((current) => current ? { ...current, isSaving: false } : current)
                  }
                }}
                disabled={unsavedDialog.isSaving}
              >
                {unsavedDialog.isSaving ? '保存中...' : '保存(S)'}
              </UnsavedDialogButton>
              <UnsavedDialogButton onClick={() => closeUnsavedDialog('discard')} disabled={unsavedDialog.isSaving}>不保存(N)</UnsavedDialogButton>
              <UnsavedDialogButton onClick={() => closeUnsavedDialog('cancel')} disabled={unsavedDialog.isSaving}>取消</UnsavedDialogButton>
            </UnsavedDialogActions>
          </UnsavedDialogCard>
        </UnsavedDialogOverlay>
      )}
    </>
  )
}
