import React, { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { FieldValue, GenerationPlan, PreviewRegionCandidate, RenderResult, TemplateProfile } from '../../../types/templateGeneration'

export type FormalTemplateSessionPhase = 'idle' | 'analyzing' | 'confirming' | 'previewing' | 'committing' | 'completed' | 'error'

interface FormalTemplateSessionState {
  phase: FormalTemplateSessionPhase
  profile: TemplateProfile | null
  fieldValues: FieldValue[]
  previewPlan: GenerationPlan | null
  previewCandidate: PreviewRegionCandidate | null
  // templateDocument 的提交结果与模板流程状态保留在这里；manuscript runtime owner 在 workbench document session。
  commitResult: RenderResult | null
  errorMessage: string | null
  statusMessage: string
  lastInstruction: string
  setPhase: (phase: FormalTemplateSessionPhase) => void
  setProfile: (profile: TemplateProfile | null) => void
  setFieldValues: (fieldValues: FieldValue[]) => void
  setPreviewPlan: (plan: GenerationPlan | null) => void
  setPreviewCandidate: (candidate: PreviewRegionCandidate | null) => void
  setCommitResult: (result: RenderResult | null) => void
  setErrorMessage: (message: string | null) => void
  setStatusMessage: (message: string) => void
  setLastInstruction: (instruction: string) => void
  resetSession: () => void
}

const FormalTemplateSessionContext = createContext<FormalTemplateSessionState | null>(null)

export function useFormalTemplateSession(): FormalTemplateSessionState {
  const context = useContext(FormalTemplateSessionContext)
  if (!context) throw new Error('useFormalTemplateSession 必须在 FormalTemplateSessionProvider 内使用')
  return context
}

export function FormalTemplateSessionProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<FormalTemplateSessionPhase>('idle')
  const [profile, setProfile] = useState<TemplateProfile | null>(null)
  const [fieldValues, setFieldValues] = useState<FieldValue[]>([])
  const [previewPlan, setPreviewPlan] = useState<GenerationPlan | null>(null)
  const [previewCandidate, setPreviewCandidate] = useState<PreviewRegionCandidate | null>(null)
  const [commitResult, setCommitResult] = useState<RenderResult | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState('')
  const [lastInstruction, setLastInstruction] = useState('')

  const resetSession = useCallback(() => {
    setPhase('idle')
    setProfile(null)
    setFieldValues([])
    setPreviewPlan(null)
    setPreviewCandidate(null)
    setCommitResult(null)
    setErrorMessage(null)
    setStatusMessage('')
    setLastInstruction('')
  }, [])

  const contextValue = useMemo(() => ({
    phase,
    profile,
    fieldValues,
    previewPlan,
    previewCandidate,
    commitResult,
    errorMessage,
    statusMessage,
    lastInstruction,
    setPhase,
    setProfile,
    setFieldValues,
    setPreviewPlan,
    setPreviewCandidate,
    setCommitResult,
    setErrorMessage,
    setStatusMessage,
    setLastInstruction,
    resetSession,
  }), [
    phase, profile, fieldValues, previewPlan, previewCandidate,
    commitResult, errorMessage, statusMessage, lastInstruction, resetSession,
  ])

  return (
    <FormalTemplateSessionContext.Provider value={contextValue}>
      {children}
    </FormalTemplateSessionContext.Provider>
  )
}