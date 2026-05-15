import React, { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { DocumentEngineRuntime } from './contracts'

interface DocumentEngineRuntimeContextValue {
  runtime: DocumentEngineRuntime | null
  setRuntime: (runtime: DocumentEngineRuntime | null) => void
}

const DocumentEngineRuntimeContext = createContext<DocumentEngineRuntimeContextValue | null>(null)

export function DocumentEngineRuntimeProvider({ children }: { children: ReactNode }) {
  const [runtime, setRuntime] = useState<DocumentEngineRuntime | null>(null)
  const value = useMemo(() => ({ runtime, setRuntime }), [runtime])

  return (
    <DocumentEngineRuntimeContext.Provider value={value}>
      {children}
    </DocumentEngineRuntimeContext.Provider>
  )
}

export function useDocumentEngineRuntime() {
  const ctx = useContext(DocumentEngineRuntimeContext)
  if (!ctx) throw new Error('useDocumentEngineRuntime 必须在 DocumentEngineRuntimeProvider 内使用')
  return ctx
}

export function useBindDocumentEngineRuntime(runtime: DocumentEngineRuntime | null) {
  const { setRuntime } = useDocumentEngineRuntime()

  useEffect(() => {
    setRuntime(runtime)
    return () => setRuntime(null)
  }, [runtime, setRuntime])
}