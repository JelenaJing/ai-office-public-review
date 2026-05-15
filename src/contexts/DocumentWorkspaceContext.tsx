import React, { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

const STORAGE_KEY = 'aioffice.kbSelection.free'

interface DocumentWorkspaceKnowledgeState {
  workspaceKbIds: string[]
  setWorkspaceKbIds: (ids: string[]) => void
}

const DocumentWorkspaceKnowledgeContext = createContext<DocumentWorkspaceKnowledgeState | null>(null)

export function DocumentWorkspaceKnowledgeProvider({ children }: { children: ReactNode }) {
  const [workspaceKbIds, setWorkspaceKbIdsState] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) return JSON.parse(stored) as string[]
    } catch {}
    return []
  })

  const setWorkspaceKbIds = useCallback((ids: string[]) => {
    const normalized = Array.from(new Set(ids.map((id) => String(id || '').trim()).filter(Boolean)))
    setWorkspaceKbIdsState(normalized)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
    } catch {}
  }, [])

  const value = useMemo<DocumentWorkspaceKnowledgeState>(() => ({
    workspaceKbIds,
    setWorkspaceKbIds,
  }), [workspaceKbIds, setWorkspaceKbIds])

  return (
    <DocumentWorkspaceKnowledgeContext.Provider value={value}>
      {children}
    </DocumentWorkspaceKnowledgeContext.Provider>
  )
}

export function useDocumentWorkspaceKnowledge(): DocumentWorkspaceKnowledgeState {
  const context = useContext(DocumentWorkspaceKnowledgeContext)
  if (!context) throw new Error('useDocumentWorkspaceKnowledge 必须在 DocumentWorkspaceKnowledgeProvider 内使用')
  return context
}
