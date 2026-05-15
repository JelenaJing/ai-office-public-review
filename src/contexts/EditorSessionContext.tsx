import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useDocument } from './DocumentContext'
import { stopTask } from '../modules/paper/services/PaperService'

export type EditorTabAiMode = 'idle' | 'writing' | 'qa'
export type EditorTabTaskPhase = 'idle' | 'submitted' | 'running' | 'paused' | 'completed' | 'stopped' | 'error'

export interface EditorTabSessionState {
  tabId: string
  mode: EditorTabAiMode
  writingComposerDraft: string
  writingStatus: string
  writingRunning: boolean
  writingPaused: boolean
  taskPhase: EditorTabTaskPhase
  activeTaskId: string | null
  taskStatusMessage: string
  selectedKnowledgeBaseIds: string[]
  replyPaneCollapsed: boolean
  replyPaneTemporaryExpand: boolean
  lastActiveAt: number
}

export const MAX_CONCURRENT_WRITING_TASKS = 3
export const EDITOR_SESSION_STOP_WRITING_EVENT = 'ai-writer-stop-writing-for-tab'

function createEmptySession(tabId: string): EditorTabSessionState {
  return {
    tabId,
    mode: 'idle',
    writingComposerDraft: '',
    writingStatus: '',
    writingRunning: false,
    writingPaused: false,
    taskPhase: 'idle',
    activeTaskId: null,
    taskStatusMessage: '',
    selectedKnowledgeBaseIds: [],
    replyPaneCollapsed: true,
    replyPaneTemporaryExpand: false,
    lastActiveAt: Date.now(),
  }
}

interface EditorSessionContextValue {
  sessions: Record<string, EditorTabSessionState>
  ensureSession: (tabId: string) => void
  getSession: (tabId: string) => EditorTabSessionState | undefined
  patchSession: (tabId: string, partial: Partial<EditorTabSessionState>) => void
  countPeerRunningWritingTasks: (excludeTabId: string) => number
  canStartWritingTask: (tabId: string, tabAlreadyRunning: boolean) => boolean
  stopWritingForTab: (tabId: string) => Promise<void>
}

const EditorSessionContext = createContext<EditorSessionContextValue | null>(null)

export function EditorSessionProvider({ children }: { children: ReactNode }) {
  const { tabs } = useDocument()
  const [sessions, setSessions] = useState<Record<string, EditorTabSessionState>>({})
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions

  const ensureSession = useCallback((tabId: string) => {
    if (!tabId) return
    setSessions((prev) => {
      if (prev[tabId]) return prev
      return { ...prev, [tabId]: createEmptySession(tabId) }
    })
  }, [])

  const getSession = useCallback((tabId: string) => sessionsRef.current[tabId], [])

  const patchSession = useCallback((tabId: string, partial: Partial<EditorTabSessionState>) => {
    if (!tabId) return
    setSessions((prev) => {
      const base = prev[tabId] || createEmptySession(tabId)
      return {
        ...prev,
        [tabId]: {
          ...base,
          ...partial,
          tabId,
          lastActiveAt: Date.now(),
        },
      }
    })
  }, [])

  const countPeerRunningWritingTasks = useCallback((excludeTabId: string) => {
    return Object.values(sessionsRef.current)
      .filter((session) => session.writingRunning && session.tabId !== excludeTabId)
      .length
  }, [])

  const canStartWritingTask = useCallback((tabId: string, tabAlreadyRunning: boolean) => {
    if (!tabId) return false
    if (tabAlreadyRunning) return true
    return countPeerRunningWritingTasks(tabId) < MAX_CONCURRENT_WRITING_TASKS
  }, [countPeerRunningWritingTasks])

  const stopWritingForTab = useCallback(async (tabId: string) => {
    if (!tabId) return
    const taskId = sessionsRef.current[tabId]?.activeTaskId
    if (taskId) {
      await stopTask(taskId).catch(() => undefined)
    }
    patchSession(tabId, {
      mode: 'idle',
      writingRunning: false,
      writingPaused: false,
      activeTaskId: null,
      taskPhase: 'stopped',
    })
    window.dispatchEvent(new CustomEvent(EDITOR_SESSION_STOP_WRITING_EVENT, { detail: { tabId } }))
  }, [patchSession])

  useEffect(() => {
    const validTabIds = new Set(tabs.map((tab) => tab.id))
    setSessions((prev) => {
      let changed = false
      const next: Record<string, EditorTabSessionState> = {}
      Object.entries(prev).forEach(([tabId, session]) => {
        if (validTabIds.has(tabId)) {
          next[tabId] = session
        } else {
          changed = true
        }
      })
      return changed ? next : prev
    })
  }, [tabs])

  const value = useMemo<EditorSessionContextValue>(() => ({
    sessions,
    ensureSession,
    getSession,
    patchSession,
    countPeerRunningWritingTasks,
    canStartWritingTask,
    stopWritingForTab,
  }), [canStartWritingTask, countPeerRunningWritingTasks, ensureSession, getSession, patchSession, sessions, stopWritingForTab])

  return <EditorSessionContext.Provider value={value}>{children}</EditorSessionContext.Provider>
}

export function useEditorSession(): EditorSessionContextValue {
  const context = useContext(EditorSessionContext)
  if (!context) {
    throw new Error('useEditorSession 必须在 EditorSessionProvider 内使用')
  }
  return context
}
