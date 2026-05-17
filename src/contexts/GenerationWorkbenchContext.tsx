import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useKnowledge } from './KnowledgeContext'
import { type GenerationMode, useWorkspaceMode } from './WorkspaceModeContext'
import type { DocumentArtifact } from '../document/core'
import type { EmailReplyDraft, EmailReplyTone } from '../types/email'
import type { PptPrimarySourceState } from '../utils/pptPrimarySource'
import { useWorkspace } from './WorkspaceContext'
import { loadWorkspaceData, saveWorkspaceData } from '../stores/featureSessionStore'
import {
  DEFAULT_IMAGE_GENERATION_MODE,
  DEFAULT_IMAGE_STYLE_OPTIONS,
  getPrimaryStyleReferenceId,
  getSelectedImageReferenceIds,
  imageReferenceSelectionsEqual,
  normalizeImageReferenceSelections,
  normalizeImageStyleOptions,
  removeImageReferenceSelection,
  upsertImageReferenceRole,
} from '../modules/image/services/imageGenerationPrompt'
import type {
  ImageGenerationMode,
  ImageReferenceRole,
  ImageReferenceSelection,
  ImageStyleOptions,
  ImageStyleProfile,
} from '../types/imageGeneration'

export type GenerationStatusPhase = 'idle' | 'running' | 'completed' | 'error'
export type GenerationResultType = 'docx' | 'image' | 'ppt-outline' | 'pptx' | 'email-draft' | null

export type PptTaskStatus = 'idle' | 'importing' | 'extracting' | 'building_deck' | 'ready' | 'generating_outline' | 'generating_plan' | 'generating_slide' | 'generating_content' | 'generating_deck' | 'validating_deck' | 'saving_deck' | 'generating_image' | 'generating_assets' | 'rendering_preview' | 'rendering_pptx' | 'applying_template' | 'stopped' | 'completed' | 'failed'
export type PptSourceType = 'generated' | 'imported_pptx' | 'email_attachment'

export interface PptSlidePreview {
  index: number
  type: string
  title?: string
  subtitle?: string
  heading?: string
  body?: string
  items?: string[]
  summary?: string
  speakerNotes?: string
  visualBrief?: string
  metrics?: Array<{ value: string; label: string; detail?: string }>
  timeline?: Array<{ title: string; detail?: string }>
  imagePath: string | null
  imageLoading: boolean
  isGenerating: boolean
  leftTitle?: string
  leftItems?: string[]
  rightTitle?: string
  rightItems?: string[]
  notes?: string
}

export interface GenerationStatusState {
  phase: GenerationStatusPhase
  message: string
  updatedAt: string | null
}

export interface GenerationTargetSelectionState {
  from: number
  to: number
  text?: string
  anchorId?: string
}

export interface PendingImageInsertionState {
  requestId: string
  tabId: string
  src: string
  alt?: string
  title?: string
  placement: 'cursor' | 'after-selection' | 'document-end'
  widthPx?: number
  heightPx?: number
  selection: GenerationTargetSelectionState | null
  statusMessage?: string
  createdAt: string
}

type EmailReplyStatusState = GenerationStatusState

export interface GenerationModeSession {
  selectedAssetIds: string[]
  primaryAssetId: string | null
  imageReferences: ImageReferenceSelection[]
  imageStyleOptions: ImageStyleOptions
  imageGenerationMode: ImageGenerationMode
  lastImageStyleProfile: ImageStyleProfile | null
  currentTemplateId: string | null
  generationPrompt: string
  generationStatus: GenerationStatusState
  // document 模式下这些结果字段只是兼容镜像；真实 owner 在 FormalTemplateSessionContext.commitResult。
  resultAssetId: string | null
  resultType: GenerationResultType
  resultPath: string | null
  resultTitle: string
  resultPreviewText: string
  resultPreviewUrl: string | null
  documentArtifact: DocumentArtifact | null
  currentMailId: string | null
  replyDraft: EmailReplyDraft | null
  replyTone: EmailReplyTone
  replyStatus: EmailReplyStatusState
  sourceTabId: string | null
  targetTabId: string | null
  targetSelection: GenerationTargetSelectionState | null
  activeTaskId: string | null
  pendingImageInsertion: PendingImageInsertionState | null
  pendingAutoSubmitToken: string | null
  pendingAutoSubmitTargetAssetId: string | null
  pptPrimarySource: PptPrimarySourceState | null
  pptSourceType: PptSourceType
  pptOriginalFilePath: string | null
  pptOriginalFileName: string | null
  pptImportStatus: 'importing' | 'extracting' | 'building_deck' | 'ready' | 'failed' | null
  pptImportWarnings: string[]
  pptPreviewSlides: Array<{ index: number; imagePath: string; title?: string }>
  resultChartPaths: string[] | null
  pptContentPackageId: string | null
  pptActiveSkillId: string | null
  pptTaskStatus: PptTaskStatus
  pptLiveSlides: PptSlidePreview[]
  pptTotalSlides: number
  pptActiveSlideIndex: number
  pptStopRequested: boolean
  pptResumeRequested: boolean
  pptIsResuming: boolean
  lastUpdatedAt: string | null
  pptDeckDocumentId: string | null
  pptDeckPath?: string | null
  pptActiveTemplateManifestId?: string | null
  /** Current image generation mode for this deck (none/cover_only/section/per_slide) */
  pptImageMode?: string | null
  /** Knowledge base (department) IDs selected for this mode's generation context. Empty = use current department default. */
  selectedKnowledgeBaseIds: string[]
}

interface GenerationWorkbenchState {
  currentMode: GenerationMode
  currentSession: GenerationModeSession
  sessions: Record<GenerationMode, GenerationModeSession>
  selectedAssetIds: string[]
  primaryAssetId: string | null
  imageReferences: ImageReferenceSelection[]
  imageStyleOptions: ImageStyleOptions
  imageGenerationMode: ImageGenerationMode
  lastImageStyleProfile: ImageStyleProfile | null
  currentTemplateId: string | null
  generationPrompt: string
  generationStatus: GenerationStatusState
  resultAssetId: string | null
  resultType: GenerationResultType
  resultPath: string | null
  resultTitle: string
  resultPreviewText: string
  resultPreviewUrl: string | null
  resultChartPaths: string[] | null
  documentArtifact: DocumentArtifact | null
  currentMailId: string | null
  currentReplyTemplateId: string | null
  selectedReferenceAssetIds: string[]
  replyDraft: EmailReplyDraft | null
  replyTone: EmailReplyTone
  replyStatus: EmailReplyStatusState
  setGenerationPrompt: (value: string) => void
  setGenerationStatus: (phase: GenerationStatusPhase, message: string) => void
  setGenerationResult: (payload: Partial<Omit<GenerationModeSession, 'selectedAssetIds' | 'primaryAssetId' | 'imageReferences' | 'imageStyleOptions' | 'imageGenerationMode' | 'lastImageStyleProfile' | 'currentTemplateId' | 'generationPrompt' | 'generationStatus'>>) => void
  clearCurrentResult: () => void
  clearCurrentSelections: () => void
  resetCurrentModeSession: (options?: { preserveSelections?: boolean; preservePrompt?: boolean }) => void
  setSelectedAssetIds: (documentIds: string[], mode?: GenerationMode) => void
  setSelectedReferenceAssetIds: (documentIds: string[]) => void
  toggleSelectedAsset: (documentId: string, mode?: GenerationMode) => void
  toggleSelectedReferenceAsset: (documentId: string) => void
  setPrimaryAssetId: (documentId: string | null, mode?: GenerationMode) => void
  setImageReferenceRole: (documentId: string, role: ImageReferenceRole | null, mode?: GenerationMode) => void
  setImageStyleOptions: (input: Partial<ImageStyleOptions>, mode?: GenerationMode) => void
  setImageGenerationMode: (modeValue: ImageGenerationMode, mode?: GenerationMode) => void
  setLastImageStyleProfile: (profile: ImageStyleProfile | null, mode?: GenerationMode) => void
  setCurrentTemplateId: (documentId: string | null, mode?: GenerationMode) => void
  setCurrentMailId: (documentId: string | null) => void
  setCurrentReplyTemplateId: (documentId: string | null) => void
  setReplyDraft: (draft: EmailReplyDraft | null) => void
  setReplyTone: (tone: EmailReplyTone) => void
  setReplyStatus: (phase: GenerationStatusPhase, message: string) => void
  removeDocumentFromSessions: (documentId: string) => void
  setModeSession: (mode: GenerationMode, updater: Partial<GenerationModeSession> | ((session: GenerationModeSession) => GenerationModeSession)) => void
  /** Knowledge base IDs selected for current mode. Empty = fall back to active department. */
  selectedKnowledgeBaseIds: string[]
  setSelectedKnowledgeBaseIds: (ids: string[], mode?: GenerationMode) => void
}

const EMPTY_STATUS: GenerationStatusState = {
  phase: 'idle',
  message: '等待新的生成任务',
  updatedAt: null,
}

function createEmptySession(): GenerationModeSession {
  return {
    selectedAssetIds: [],
    primaryAssetId: null,
    imageReferences: [],
    imageStyleOptions: DEFAULT_IMAGE_STYLE_OPTIONS,
    imageGenerationMode: DEFAULT_IMAGE_GENERATION_MODE,
    lastImageStyleProfile: null,
    currentTemplateId: null,
    generationPrompt: '',
    generationStatus: EMPTY_STATUS,
    resultAssetId: null,
    resultType: null,
    resultPath: null,
    resultTitle: '',
    resultPreviewText: '',
    resultPreviewUrl: null,
    documentArtifact: null,
    currentMailId: null,
    replyDraft: null,
    replyTone: 'formal',
    replyStatus: EMPTY_STATUS,
    sourceTabId: null,
    targetTabId: null,
    targetSelection: null,
    activeTaskId: null,
    pendingImageInsertion: null,
    pendingAutoSubmitToken: null,
    pendingAutoSubmitTargetAssetId: null,
    pptPrimarySource: null,
    pptSourceType: 'generated',
    pptOriginalFilePath: null,
    pptOriginalFileName: null,
    pptImportStatus: null,
    pptImportWarnings: [],
    pptPreviewSlides: [],
    resultChartPaths: null,
    pptContentPackageId: null,
    pptActiveSkillId: null,
    pptTaskStatus: 'idle' as PptTaskStatus,
    pptLiveSlides: [],
    pptTotalSlides: 0,
    pptActiveSlideIndex: 0,
    pptStopRequested: false,
    pptResumeRequested: false,
    pptIsResuming: false,
    lastUpdatedAt: null,
    pptDeckDocumentId: null,
    pptDeckPath: null,
    pptActiveTemplateManifestId: null,
    pptImageMode: null,
    selectedKnowledgeBaseIds: [],
  }
}

function normalizeIds(documentIds: string[]): string[] {
  return Array.from(new Set(documentIds.map((item) => String(item || '').trim()).filter(Boolean)))
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((item, index) => item === right[index])
}

const GenerationWorkbenchContext = createContext<GenerationWorkbenchState | null>(null)

export function useGenerationWorkbench(): GenerationWorkbenchState {
  const context = useContext(GenerationWorkbenchContext)
  if (!context) throw new Error('useGenerationWorkbench 必须在 GenerationWorkbenchProvider 内使用')
  return context
}

export function GenerationWorkbenchProvider({ children }: { children: ReactNode }) {
  const { currentMode } = useWorkspaceMode()
  const { referenceDocumentIds, styleImageDocumentIds, templateDocumentId } = useKnowledge()
  const { activeWorkspacePath } = useWorkspace()
  const [sessions, setSessions] = useState<Record<GenerationMode, GenerationModeSession>>(() => ({
    document: createEmptySession(),
    image: createEmptySession(),
    ppt: createEmptySession(),
    email: createEmptySession(),
    'daily-report': createEmptySession(),
    homework: createEmptySession(),
    'ai-class': createEmptySession(),
    'ai-forum': createEmptySession(),
    paper: createEmptySession(),
    data: createEmptySession(),
    model: createEmptySession(),
    'daily-feed': createEmptySession(),
  }))

  const setModeSession = useCallback((mode: GenerationMode, updater: Partial<GenerationModeSession> | ((session: GenerationModeSession) => GenerationModeSession)) => {
    setSessions((prev) => {
      const current = prev[mode] || createEmptySession()
      const next = typeof updater === 'function'
        ? updater(current)
        : { ...current, ...updater }
      return { ...prev, [mode]: next }
    })
  }, [])

  // Restore sessions from localStorage when the workspace first becomes available.
  const loadedWorkspaceRef = useRef<string | null>(null)
  useEffect(() => {
    if (!activeWorkspacePath || loadedWorkspaceRef.current === activeWorkspacePath) return
    loadedWorkspaceRef.current = activeWorkspacePath
    const persisted = loadWorkspaceData<Partial<Record<GenerationMode, Partial<GenerationModeSession>>>>(
      activeWorkspacePath, 'generationSessions',
    )
    if (!persisted) return
    setSessions((prev) => {
      const next = { ...prev }
      const modes: GenerationMode[] = ['document', 'image', 'ppt', 'email', 'daily-report', 'homework', 'ai-class', 'ai-forum', 'paper']
      for (const m of modes) {
        const saved = persisted[m]
        if (!saved) continue
        next[m] = {
          ...createEmptySession(),
          ...saved,
          // Reset transient/unsafe fields on restore
          generationStatus: { phase: 'idle', message: '等待新的生成任务', updatedAt: null },
          replyStatus: { phase: 'idle', message: '等待新的生成任务', updatedAt: null },
          pendingImageInsertion: null,
          pendingAutoSubmitToken: null,
          pendingAutoSubmitTargetAssetId: null,
          documentArtifact: null,
          resultPreviewUrl: null,
          targetTabId: null,
          sourceTabId: null,
          targetSelection: null,
          activeTaskId: null,
          pptStopRequested: false,
          pptResumeRequested: false,
          pptIsResuming: false,
          // Keep terminal/safe statuses; reset any in-flight generating state to idle
          pptTaskStatus: (['idle', 'ready', 'stopped', 'completed', 'failed'] as PptTaskStatus[]).includes(
            (saved as Partial<GenerationModeSession>)?.pptTaskStatus as PptTaskStatus,
          )
            ? (saved as Partial<GenerationModeSession>).pptTaskStatus as PptTaskStatus
            : 'idle',
        }
      }
      return next
    })
  }, [activeWorkspacePath])

  // Persist sessions to localStorage (debounced) whenever they change.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!activeWorkspacePath) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      // Only persist the safe/serialisable subset of each session.
      const toSave: Partial<Record<GenerationMode, Partial<GenerationModeSession>>> = {}
      const modes: GenerationMode[] = ['document', 'image', 'ppt', 'email', 'daily-report', 'homework', 'ai-class', 'ai-forum', 'paper']
      for (const m of modes) {
        const s = sessions[m]
        if (!s) continue
        toSave[m] = {
          selectedAssetIds: s.selectedAssetIds,
          primaryAssetId: s.primaryAssetId,
          imageReferences: s.imageReferences,
          imageStyleOptions: s.imageStyleOptions,
          imageGenerationMode: s.imageGenerationMode,
          lastImageStyleProfile: s.lastImageStyleProfile,
          currentTemplateId: s.currentTemplateId,
          generationPrompt: s.generationPrompt,
          resultAssetId: s.resultAssetId,
          resultType: s.resultType,
          resultPath: s.resultPath,
          resultTitle: s.resultTitle,
          resultPreviewText: s.resultPreviewText,
          currentMailId: s.currentMailId,
          replyTone: s.replyTone,
          pptPrimarySource: s.pptPrimarySource,
          pptDeckDocumentId: s.pptDeckDocumentId,
          pptDeckPath: s.pptDeckPath ?? null,
          pptActiveTemplateManifestId: s.pptActiveTemplateManifestId ?? null,
          pptSourceType: s.pptSourceType,
          pptOriginalFilePath: s.pptOriginalFilePath,
          pptOriginalFileName: s.pptOriginalFileName,
          pptImportStatus: s.pptImportStatus,
          pptImportWarnings: s.pptImportWarnings,
          pptPreviewSlides: s.pptPreviewSlides,
          pptLiveSlides: s.pptLiveSlides,
          pptTotalSlides: s.pptTotalSlides,
          pptActiveSlideIndex: s.pptActiveSlideIndex,
          pptContentPackageId: s.pptContentPackageId,
          pptActiveSkillId: s.pptActiveSkillId,
          lastUpdatedAt: s.lastUpdatedAt,
          selectedKnowledgeBaseIds: s.selectedKnowledgeBaseIds,
        }
      }
      saveWorkspaceData(activeWorkspacePath, 'generationSessions', toSave)
    }, 1500)
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [activeWorkspacePath, sessions])

  useEffect(() => {
    const nextSelected = normalizeIds(referenceDocumentIds.filter((documentId) => documentId !== templateDocumentId))
    const nextTemplateId = templateDocumentId || null
    setSessions((prev) => {
      const current = prev.document
      const nextPrimary = nextTemplateId
        || (current.primaryAssetId && nextSelected.includes(current.primaryAssetId) ? current.primaryAssetId : nextSelected[0] || null)
      if (
        arraysEqual(current.selectedAssetIds, nextSelected)
        && current.currentTemplateId === nextTemplateId
        && current.primaryAssetId === nextPrimary
      ) {
        return prev
      }
      return {
        ...prev,
        document: {
          ...current,
          selectedAssetIds: nextSelected,
          currentTemplateId: nextTemplateId,
          primaryAssetId: nextPrimary,
        },
      }
    })
  }, [referenceDocumentIds, templateDocumentId])

  useEffect(() => {
    const nextSelected = normalizeIds(styleImageDocumentIds)
    setSessions((prev) => {
      const current = prev.image
      const nextReferences = normalizeImageReferenceSelections(
        nextSelected.map((documentId, index) => {
          const existing = current.imageReferences.find((item) => item.id === documentId)
          if (existing) return existing
          return {
            id: documentId,
            role: current.primaryAssetId === documentId || (!current.primaryAssetId && index === 0) ? 'primary-style' : 'style',
            weight: 0,
          }
        }),
        current.primaryAssetId && nextSelected.includes(current.primaryAssetId) ? current.primaryAssetId : undefined,
      )
      const nextPrimary = getPrimaryStyleReferenceId(nextReferences)
      const nextSelectedIds = getSelectedImageReferenceIds(nextReferences)
      if (
        arraysEqual(current.selectedAssetIds, nextSelectedIds)
        && current.currentTemplateId === null
        && current.primaryAssetId === nextPrimary
        && imageReferenceSelectionsEqual(current.imageReferences, nextReferences)
      ) {
        return prev
      }
      return {
        ...prev,
        image: {
          ...current,
          selectedAssetIds: nextSelectedIds,
          currentTemplateId: null,
          primaryAssetId: nextPrimary,
          imageReferences: nextReferences,
          lastImageStyleProfile: null,
        },
      }
    })
  }, [styleImageDocumentIds])

  const setSelectedAssetIds = useCallback((documentIds: string[], mode?: GenerationMode) => {
    const targetMode = mode || currentMode
    if (targetMode === 'image') {
      setModeSession(targetMode, (session) => {
        const nextReferences = normalizeImageReferenceSelections(
          normalizeIds(documentIds).map((documentId, index) => {
            const existing = session.imageReferences.find((item) => item.id === documentId)
            if (existing) return existing
            return {
              id: documentId,
              role: session.primaryAssetId === documentId || (!session.primaryAssetId && index === 0) ? 'primary-style' : 'style',
              weight: 0,
            }
          }),
          session.primaryAssetId,
        )
        return {
          ...session,
          imageReferences: nextReferences,
          selectedAssetIds: getSelectedImageReferenceIds(nextReferences),
          primaryAssetId: getPrimaryStyleReferenceId(nextReferences),
          lastImageStyleProfile: null,
        }
      })
      return
    }
    setModeSession(targetMode, (session) => ({
      ...session,
      selectedAssetIds: normalizeIds(documentIds),
    }))
  }, [currentMode, setModeSession])

  const toggleSelectedAsset = useCallback((documentId: string, mode?: GenerationMode) => {
    const targetMode = mode || currentMode
    const normalizedId = String(documentId || '').trim()
    if (!normalizedId) return
    if (targetMode === 'image') {
      setModeSession(targetMode, (session) => {
        const nextReferences = session.imageReferences.some((item) => item.id === normalizedId)
          ? removeImageReferenceSelection(session.imageReferences, normalizedId)
          : normalizeImageReferenceSelections([
            ...session.imageReferences,
            { id: normalizedId, role: session.primaryAssetId ? 'style' : 'primary-style', weight: 0 },
          ], session.primaryAssetId || (!session.imageReferences.length ? normalizedId : undefined))
        return {
          ...session,
          imageReferences: nextReferences,
          selectedAssetIds: getSelectedImageReferenceIds(nextReferences),
          primaryAssetId: getPrimaryStyleReferenceId(nextReferences),
          lastImageStyleProfile: null,
        }
      })
      return
    }
    setModeSession(targetMode, (session) => ({
      ...session,
      selectedAssetIds: session.selectedAssetIds.includes(normalizedId)
        ? session.selectedAssetIds.filter((item) => item !== normalizedId)
        : [...session.selectedAssetIds, normalizedId],
    }))
  }, [currentMode, setModeSession])

  const setPrimaryAssetId = useCallback((documentId: string | null, mode?: GenerationMode) => {
    const targetMode = mode || currentMode
    if (targetMode === 'image') {
      const normalizedId = String(documentId || '').trim()
      setModeSession(targetMode, (session) => {
        const nextReferences = normalizedId
          ? upsertImageReferenceRole(session.imageReferences, normalizedId, 'primary-style')
          : normalizeImageReferenceSelections(session.imageReferences.filter((item) => item.role !== 'primary-style'))
        return {
          ...session,
          imageReferences: nextReferences,
          selectedAssetIds: getSelectedImageReferenceIds(nextReferences),
          primaryAssetId: getPrimaryStyleReferenceId(nextReferences),
          lastImageStyleProfile: null,
        }
      })
      return
    }
    setModeSession(targetMode, (session) => ({
      ...session,
      primaryAssetId: documentId,
    }))
  }, [currentMode, setModeSession])

  const setImageReferenceRole = useCallback((documentId: string, role: ImageReferenceRole | null, mode?: GenerationMode) => {
    const targetMode = mode || currentMode
    if (targetMode !== 'image') return
    const normalizedId = String(documentId || '').trim()
    if (!normalizedId) return
    setModeSession(targetMode, (session) => {
      const nextReferences = role
        ? upsertImageReferenceRole(session.imageReferences, normalizedId, role)
        : removeImageReferenceSelection(session.imageReferences, normalizedId)
      return {
        ...session,
        imageReferences: nextReferences,
        selectedAssetIds: getSelectedImageReferenceIds(nextReferences),
        primaryAssetId: getPrimaryStyleReferenceId(nextReferences),
        lastImageStyleProfile: null,
      }
    })
  }, [currentMode, setModeSession])

  const setImageStyleOptions = useCallback((input: Partial<ImageStyleOptions>, mode?: GenerationMode) => {
    const targetMode = mode || currentMode
    if (targetMode !== 'image') return
    setModeSession(targetMode, (session) => ({
      ...session,
      imageStyleOptions: normalizeImageStyleOptions({ ...session.imageStyleOptions, ...input }),
    }))
  }, [currentMode, setModeSession])

  const setImageGenerationMode = useCallback((modeValue: ImageGenerationMode, mode?: GenerationMode) => {
    const targetMode = mode || currentMode
    if (targetMode !== 'image') return
    setModeSession(targetMode, (session) => ({
      ...session,
      imageGenerationMode: modeValue,
    }))
  }, [currentMode, setModeSession])

  const setLastImageStyleProfile = useCallback((profile: ImageStyleProfile | null, mode?: GenerationMode) => {
    const targetMode = mode || currentMode
    if (targetMode !== 'image') return
    setModeSession(targetMode, (session) => ({
      ...session,
      lastImageStyleProfile: profile,
    }))
  }, [currentMode, setModeSession])

  const setCurrentTemplateId = useCallback((documentId: string | null, mode?: GenerationMode) => {
    const targetMode = mode || currentMode
    setModeSession(targetMode, (session) => ({
      ...session,
      currentTemplateId: documentId,
    }))
  }, [currentMode, setModeSession])

  const setCurrentMailId = useCallback((documentId: string | null) => {
    setModeSession('email', (session) => ({
      ...session,
      currentMailId: documentId,
    }))
  }, [setModeSession])

  const setCurrentReplyTemplateId = useCallback((documentId: string | null) => {
    setCurrentTemplateId(documentId, 'email')
  }, [setCurrentTemplateId])

  const setSelectedReferenceAssetIds = useCallback((documentIds: string[]) => {
    setSelectedAssetIds(documentIds, 'email')
  }, [setSelectedAssetIds])

  const setSelectedKnowledgeBaseIds = useCallback((ids: string[], mode?: GenerationMode) => {
    const targetMode = mode || currentMode
    const normalized = Array.from(new Set(ids.map((id) => String(id || '').trim()).filter(Boolean)))
    setModeSession(targetMode, (session) => ({
      ...session,
      selectedKnowledgeBaseIds: normalized,
    }))
  }, [currentMode, setModeSession])

  const toggleSelectedReferenceAsset = useCallback((documentId: string) => {
    toggleSelectedAsset(documentId, 'email')
  }, [toggleSelectedAsset])

  const setReplyDraft = useCallback((draft: EmailReplyDraft | null) => {
    const now = new Date().toISOString()
    setModeSession('email', (session) => ({
      ...session,
      replyDraft: draft,
      lastUpdatedAt: now,
    }))
  }, [setModeSession])

  const setReplyTone = useCallback((tone: EmailReplyTone) => {
    const now = new Date().toISOString()
    setModeSession('email', (session) => ({
      ...session,
      replyTone: tone,
      lastUpdatedAt: now,
    }))
  }, [setModeSession])

  const setReplyStatus = useCallback((phase: GenerationStatusPhase, message: string) => {
    const now = new Date().toISOString()
    setModeSession('email', (session) => ({
      ...session,
      replyStatus: {
        phase,
        message,
        updatedAt: now,
      },
      lastUpdatedAt: now,
    }))
  }, [setModeSession])

  const setGenerationPrompt = useCallback((value: string) => {
    const now = new Date().toISOString()
    setModeSession(currentMode, (session) => ({
      ...session,
      generationPrompt: value,
      lastUpdatedAt: now,
    }))
  }, [currentMode, setModeSession])

  const setGenerationStatus = useCallback((phase: GenerationStatusPhase, message: string) => {
    const now = new Date().toISOString()
    setModeSession(currentMode, (session) => ({
      ...session,
      generationStatus: {
        phase,
        message,
        updatedAt: now,
      },
      lastUpdatedAt: now,
    }))
  }, [currentMode, setModeSession])

  const setGenerationResult = useCallback((payload: Partial<Omit<GenerationModeSession, 'selectedAssetIds' | 'primaryAssetId' | 'imageReferences' | 'imageStyleOptions' | 'imageGenerationMode' | 'lastImageStyleProfile' | 'currentTemplateId' | 'generationPrompt' | 'generationStatus'>>) => {
    const now = new Date().toISOString()
    setModeSession(currentMode, (session) => ({
      ...session,
      ...payload,
      lastUpdatedAt: now,
    }))
  }, [currentMode, setModeSession])

  const clearCurrentResult = useCallback(() => {
    setModeSession(currentMode, (session) => ({
      ...session,
      resultAssetId: null,
      resultType: null,
      resultPath: null,
      resultTitle: '',
      resultPreviewText: '',
      resultPreviewUrl: null,
      resultChartPaths: null,
      documentArtifact: null,
    }))
  }, [currentMode, setModeSession])

  const clearCurrentSelections = useCallback(() => {
    setModeSession(currentMode, (session) => ({
      ...session,
      selectedAssetIds: [],
      primaryAssetId: null,
      imageReferences: currentMode === 'image' ? [] : session.imageReferences,
      lastImageStyleProfile: currentMode === 'image' ? null : session.lastImageStyleProfile,
      currentTemplateId: null,
    }))
  }, [currentMode, setModeSession])

  const removeDocumentFromSessions = useCallback((documentId: string) => {
    const normalizedId = String(documentId || '').trim()
    if (!normalizedId) return

    setSessions((prev) => {
      let changed = false
      const now = new Date().toISOString()
      const nextSessions = { ...prev }

      ;(Object.keys(prev) as GenerationMode[]).forEach((mode) => {
        const session = prev[mode]
        const nextImageReferences = mode === 'image'
          ? removeImageReferenceSelection(session.imageReferences, normalizedId)
          : session.imageReferences
        const nextSelectedAssetIds = mode === 'image'
          ? getSelectedImageReferenceIds(nextImageReferences)
          : session.selectedAssetIds.filter((item) => item !== normalizedId)
        const nextCurrentTemplateId = session.currentTemplateId === normalizedId ? null : session.currentTemplateId
        const nextPrimaryAssetId = mode === 'image'
          ? getPrimaryStyleReferenceId(nextImageReferences)
          : session.primaryAssetId === normalizedId
            ? (mode === 'document' ? (nextCurrentTemplateId || nextSelectedAssetIds[0] || null) : (nextSelectedAssetIds[0] || null))
            : session.primaryAssetId
        const shouldClearResult = session.resultAssetId === normalizedId

        if (
          arraysEqual(session.selectedAssetIds, nextSelectedAssetIds)
          && session.currentTemplateId === nextCurrentTemplateId
          && session.primaryAssetId === nextPrimaryAssetId
          && imageReferenceSelectionsEqual(session.imageReferences, nextImageReferences)
          && !shouldClearResult
        ) {
          return
        }

        changed = true
        nextSessions[mode] = {
          ...session,
          selectedAssetIds: nextSelectedAssetIds,
          currentTemplateId: nextCurrentTemplateId,
          primaryAssetId: nextPrimaryAssetId,
          imageReferences: nextImageReferences,
          resultAssetId: shouldClearResult ? null : session.resultAssetId,
          resultType: shouldClearResult ? null : session.resultType,
          resultPath: shouldClearResult ? null : session.resultPath,
          resultTitle: shouldClearResult ? '' : session.resultTitle,
          resultPreviewText: shouldClearResult ? '' : session.resultPreviewText,
          resultPreviewUrl: shouldClearResult ? null : session.resultPreviewUrl,
          resultChartPaths: shouldClearResult ? null : session.resultChartPaths,
          documentArtifact: shouldClearResult ? null : session.documentArtifact,
          lastImageStyleProfile: mode === 'image' ? null : session.lastImageStyleProfile,
          lastUpdatedAt: now,
        }
      })

      return changed ? nextSessions : prev
    })
  }, [])

  const resetCurrentModeSession = useCallback((options?: { preserveSelections?: boolean; preservePrompt?: boolean }) => {
    const preserveSelections = options?.preserveSelections ?? true
    const preservePrompt = options?.preservePrompt ?? false
    setModeSession(currentMode, (session) => ({
      ...createEmptySession(),
      selectedAssetIds: preserveSelections ? session.selectedAssetIds : [],
      primaryAssetId: preserveSelections ? session.primaryAssetId : null,
      imageReferences: preserveSelections && currentMode === 'image' ? session.imageReferences : [],
      imageStyleOptions: currentMode === 'image' ? session.imageStyleOptions : DEFAULT_IMAGE_STYLE_OPTIONS,
      imageGenerationMode: currentMode === 'image' ? session.imageGenerationMode : DEFAULT_IMAGE_GENERATION_MODE,
      currentTemplateId: preserveSelections ? session.currentTemplateId : null,
      generationPrompt: preservePrompt ? session.generationPrompt : '',
    }))
  }, [currentMode, setModeSession])

  const currentSession = sessions[currentMode] || createEmptySession()

  const value = useMemo<GenerationWorkbenchState>(() => ({
    currentMode,
    currentSession,
    sessions,
    selectedAssetIds: currentSession.selectedAssetIds,
    primaryAssetId: currentSession.primaryAssetId,
    imageReferences: currentSession.imageReferences,
    imageStyleOptions: currentSession.imageStyleOptions,
    imageGenerationMode: currentSession.imageGenerationMode,
    lastImageStyleProfile: currentSession.lastImageStyleProfile,
    currentTemplateId: currentSession.currentTemplateId,
    generationPrompt: currentSession.generationPrompt,
    generationStatus: currentSession.generationStatus,
    resultAssetId: currentSession.resultAssetId,
    resultType: currentSession.resultType,
    resultPath: currentSession.resultPath,
    resultTitle: currentSession.resultTitle,
    resultPreviewText: currentSession.resultPreviewText,
    resultPreviewUrl: currentSession.resultPreviewUrl,
    resultChartPaths: currentSession.resultChartPaths,
    documentArtifact: currentSession.documentArtifact,
    currentMailId: currentSession.currentMailId,
    currentReplyTemplateId: currentSession.currentTemplateId,
    selectedReferenceAssetIds: currentSession.selectedAssetIds,
    replyDraft: currentSession.replyDraft,
    replyTone: currentSession.replyTone,
    replyStatus: currentSession.replyStatus,
    selectedKnowledgeBaseIds: currentSession.selectedKnowledgeBaseIds,
    setGenerationPrompt,
    setGenerationStatus,
    setGenerationResult,
    clearCurrentResult,
    clearCurrentSelections,
    resetCurrentModeSession,
    setSelectedAssetIds,
    setSelectedReferenceAssetIds,
    toggleSelectedAsset,
    toggleSelectedReferenceAsset,
    setPrimaryAssetId,
    setImageReferenceRole,
    setImageStyleOptions,
    setImageGenerationMode,
    setLastImageStyleProfile,
    setCurrentTemplateId,
    setCurrentMailId,
    setCurrentReplyTemplateId,
    setReplyDraft,
    setReplyTone,
    setReplyStatus,
    removeDocumentFromSessions,
    setModeSession,
    setSelectedKnowledgeBaseIds,
  }), [clearCurrentResult, clearCurrentSelections, currentMode, currentSession, removeDocumentFromSessions, resetCurrentModeSession, sessions, setCurrentMailId, setCurrentReplyTemplateId, setCurrentTemplateId, setGenerationPrompt, setGenerationResult, setGenerationStatus, setImageGenerationMode, setImageReferenceRole, setImageStyleOptions, setLastImageStyleProfile, setModeSession, setPrimaryAssetId, setReplyDraft, setReplyStatus, setReplyTone, setSelectedAssetIds, setSelectedKnowledgeBaseIds, setSelectedReferenceAssetIds, toggleSelectedAsset, toggleSelectedReferenceAsset])

  return <GenerationWorkbenchContext.Provider value={value}>{children}</GenerationWorkbenchContext.Provider>
}
