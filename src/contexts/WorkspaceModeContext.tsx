import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type WorkspaceMode = 'free' | 'generation'
export type GenerationMode = 'document' | 'image' | 'ppt' | 'email' | 'daily-report' | 'homework' | 'ai-class' | 'ai-forum' | 'paper' | 'data' | 'model' | 'daily-feed'

type WorkspaceModeDebugValue = WorkspaceMode | 'formal-template' | `generate-${GenerationMode}`

interface WorkspaceModeDebugBridge {
  setWorkspaceMode?: (mode: WorkspaceModeDebugValue) => void
  getWorkspaceMode?: () => WorkspaceModeDebugValue
}

interface WorkspaceModeState {
  mode: WorkspaceMode
  generationMode: GenerationMode
  currentMode: GenerationMode
  isGenerationMode: boolean
  setMode: (mode: WorkspaceMode) => void
  setGenerationMode: (mode: GenerationMode) => void
  enterFreeMode: () => void
  enterGenerationMode: (mode: GenerationMode) => void
  enterFormalTemplateMode: () => void
  enterDocumentGenerationMode: () => void
  enterImageGenerationMode: () => void
  enterPptGenerationMode: () => void
  enterEmailMode: () => void
  enterDailyReportMode: () => void
  enterHomeworkMode: () => void
  enterAiClassMode: () => void
  enterAiForumMode: () => void
  enterPaperGenerationMode: () => void
  enterDataMode: () => void
  enterModelMode: () => void
  enterDailyFeedMode: () => void
}

const WorkspaceModeContext = createContext<WorkspaceModeState | null>(null)

export function useWorkspaceMode(): WorkspaceModeState {
  const context = useContext(WorkspaceModeContext)
  if (!context) throw new Error('useWorkspaceMode 必须在 WorkspaceModeProvider 内使用')
  return context
}

export function WorkspaceModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<WorkspaceMode>(() => {
    try {
      const saved = localStorage.getItem('aioffice.workspaceMode')
      if (saved === 'free' || saved === 'generation') return saved
    } catch { /* ignore */ }
    return 'free'
  })
  const [generationMode, setGenerationModeState] = useState<GenerationMode>(() => {
    try {
      const saved = localStorage.getItem('aioffice.generationMode')
      const valid: GenerationMode[] = ['document', 'image', 'ppt', 'email', 'homework', 'ai-class', 'ai-forum', 'paper', 'data', 'model', 'daily-feed']
      if (saved && valid.includes(saved as GenerationMode)) return saved as GenerationMode
    } catch { /* ignore */ }
    return 'document'
  })

  const setMode = useCallback((nextMode: WorkspaceMode) => {
    setModeState(nextMode)
    try { localStorage.setItem('aioffice.workspaceMode', nextMode) } catch { /* ignore */ }
  }, [])

  const setGenerationMode = useCallback((nextMode: GenerationMode) => {
    setGenerationModeState(nextMode)
    setModeState('generation')
    try {
      localStorage.setItem('aioffice.generationMode', nextMode)
      localStorage.setItem('aioffice.workspaceMode', 'generation')
    } catch { /* ignore */ }
  }, [])

  const enterFreeMode = useCallback(() => {
    setModeState('free')
    try { localStorage.setItem('aioffice.workspaceMode', 'free') } catch { /* ignore */ }
  }, [])

  const enterGenerationMode = useCallback((nextMode: GenerationMode) => {
    setGenerationModeState(nextMode)
    setModeState('generation')
    try {
      localStorage.setItem('aioffice.generationMode', nextMode)
      localStorage.setItem('aioffice.workspaceMode', 'generation')
    } catch { /* ignore */ }
  }, [])

  const enterFormalTemplateMode = useCallback(() => {
    setGenerationModeState('document')
    setModeState('generation')
    try { localStorage.setItem('aioffice.generationMode', 'document'); localStorage.setItem('aioffice.workspaceMode', 'generation') } catch { /* ignore */ }
  }, [])

  const enterDocumentGenerationMode = useCallback(() => {
    setGenerationModeState('document')
    setModeState('generation')
    try { localStorage.setItem('aioffice.generationMode', 'document'); localStorage.setItem('aioffice.workspaceMode', 'generation') } catch { /* ignore */ }
  }, [])

  const enterImageGenerationMode = useCallback(() => {
    setGenerationModeState('image')
    setModeState('generation')
    try { localStorage.setItem('aioffice.generationMode', 'image'); localStorage.setItem('aioffice.workspaceMode', 'generation') } catch { /* ignore */ }
  }, [])

  const enterPptGenerationMode = useCallback(() => {
    setGenerationModeState('ppt')
    setModeState('generation')
    try { localStorage.setItem('aioffice.generationMode', 'ppt'); localStorage.setItem('aioffice.workspaceMode', 'generation') } catch { /* ignore */ }
  }, [])

  const enterEmailMode = useCallback(() => {
    setGenerationModeState('email')
    setModeState('generation')
    try { localStorage.setItem('aioffice.generationMode', 'email'); localStorage.setItem('aioffice.workspaceMode', 'generation') } catch { /* ignore */ }
  }, [])

  const enterDailyReportMode = useCallback(() => {
    // Daily report entry removed — redirect to free (document) mode
    setModeState('free')
    try { localStorage.setItem('aioffice.workspaceMode', 'free') } catch { /* ignore */ }
  }, [])

  const enterHomeworkMode = useCallback(() => {
    setGenerationModeState('homework')
    setModeState('generation')
    try { localStorage.setItem('aioffice.generationMode', 'homework'); localStorage.setItem('aioffice.workspaceMode', 'generation') } catch { /* ignore */ }
  }, [])

  const enterAiClassMode = useCallback(() => {
    setGenerationModeState('ai-class')
    setModeState('generation')
    try { localStorage.setItem('aioffice.generationMode', 'ai-class'); localStorage.setItem('aioffice.workspaceMode', 'generation') } catch { /* ignore */ }
  }, [])

  const enterAiForumMode = useCallback(() => {
    setGenerationModeState('ai-forum')
    setModeState('generation')
    try { localStorage.setItem('aioffice.generationMode', 'ai-forum'); localStorage.setItem('aioffice.workspaceMode', 'generation') } catch { /* ignore */ }
  }, [])

  const enterPaperGenerationMode = useCallback(() => {
    setGenerationModeState('paper')
    setModeState('generation')
    try { localStorage.setItem('aioffice.generationMode', 'paper'); localStorage.setItem('aioffice.workspaceMode', 'generation') } catch { /* ignore */ }
  }, [])

  const enterDataMode = useCallback(() => {
    setGenerationModeState('data')
    setModeState('generation')
    try { localStorage.setItem('aioffice.generationMode', 'data'); localStorage.setItem('aioffice.workspaceMode', 'generation') } catch { /* ignore */ }
  }, [])

  const enterModelMode = useCallback(() => {
    setGenerationModeState('model')
    setModeState('generation')
    try { localStorage.setItem('aioffice.generationMode', 'model'); localStorage.setItem('aioffice.workspaceMode', 'generation') } catch { /* ignore */ }
  }, [])

  const enterDailyFeedMode = useCallback(() => {
    setGenerationModeState('daily-feed')
    setModeState('generation')
    try { localStorage.setItem('aioffice.generationMode', 'daily-feed'); localStorage.setItem('aioffice.workspaceMode', 'generation') } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (!(import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV) return

    const debugWindow = window as Window & typeof globalThis & {
      __AI_WRITER_DEBUG__?: WorkspaceModeDebugBridge & Record<string, unknown>
    }

    debugWindow.__AI_WRITER_DEBUG__ = {
      ...(debugWindow.__AI_WRITER_DEBUG__ || {}),
      setWorkspaceMode: (nextMode: WorkspaceModeDebugValue) => {
        if (nextMode === 'free' || nextMode === 'generation') {
          setMode(nextMode)
          return
        }
        if (nextMode === 'formal-template' || nextMode === 'generate-document') {
          enterGenerationMode('document')
          return
        }
        if (nextMode === 'generate-image') {
          enterGenerationMode('image')
          return
        }
        if (nextMode === 'generate-ppt') {
          enterGenerationMode('ppt')
          return
        }
        if (nextMode === 'generate-email') {
          enterGenerationMode('email')
          return
        }
        if (nextMode === 'generate-daily-report') {
          enterGenerationMode('daily-report')
          return
        }
        if (nextMode === 'generate-homework') {
          enterGenerationMode('homework')
          return
        }
        if (nextMode === 'generate-ai-class') {
          enterGenerationMode('ai-class')
          return
        }
        if (nextMode === 'generate-ai-forum') {
          enterGenerationMode('ai-forum')
          return
        }
        if (nextMode === 'generate-paper') {
          enterGenerationMode('paper')
          return
        }
      },
      getWorkspaceMode: () => (mode === 'generation' ? `generate-${generationMode}` : mode),
    }

    return () => {
      const currentDebugBridge = debugWindow.__AI_WRITER_DEBUG__
      if (!currentDebugBridge) return
      const { setWorkspaceMode: _setWorkspaceMode, getWorkspaceMode: _getWorkspaceMode, ...rest } = currentDebugBridge
      debugWindow.__AI_WRITER_DEBUG__ = Object.keys(rest).length > 0 ? rest : undefined
    }
  }, [enterGenerationMode, generationMode, mode, setMode])

  const contextValue = useMemo(() => ({
    mode,
    generationMode,
    currentMode: generationMode,
    isGenerationMode: mode === 'generation',
    setMode,
    setGenerationMode,
    enterFreeMode,
    enterGenerationMode,
    enterFormalTemplateMode,
    enterDocumentGenerationMode,
    enterImageGenerationMode,
    enterPptGenerationMode,
    enterEmailMode,
    enterDailyReportMode,
    enterHomeworkMode,
    enterAiClassMode,
    enterAiForumMode,
    enterPaperGenerationMode,
    enterDataMode,
    enterModelMode,
    enterDailyFeedMode,
  }), [
    mode, generationMode, setMode, setGenerationMode,
    enterFreeMode, enterGenerationMode, enterFormalTemplateMode,
    enterDocumentGenerationMode, enterImageGenerationMode,
    enterPptGenerationMode, enterEmailMode, enterDailyReportMode,
    enterHomeworkMode, enterAiClassMode, enterAiForumMode, enterPaperGenerationMode,
    enterDataMode, enterModelMode, enterDailyFeedMode,
  ])

  return (
    <WorkspaceModeContext.Provider value={contextValue}>
      {children}
    </WorkspaceModeContext.Provider>
  )
}