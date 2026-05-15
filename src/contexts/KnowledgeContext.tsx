import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { KnowledgeDocumentDetail, KnowledgeDocumentMeta, KnowledgeImportResult, KnowledgeLibraryInfo } from '../types/knowledge'
import { useDepartment } from './DepartmentContext'

interface KnowledgeState {
  info: KnowledgeLibraryInfo | null
  documents: KnowledgeDocumentMeta[]
  query: string
  loading: boolean
  importing: boolean
  activeDocumentId: string | null
  activeDocument: KnowledgeDocumentDetail | null
  referenceDocumentIds: string[]
  styleImageDocumentIds: string[]
  templateDocumentId: string | null
  departmentId: string
  setQuery: (value: string) => void
  refresh: () => Promise<void>
  importDocuments: () => Promise<KnowledgeImportResult>
  openDocument: (documentId: string | null) => Promise<void>
  toggleReferenceDocument: (documentId: string) => void
  selectReferenceDocuments: (documentIds: string[]) => void
  unselectReferenceDocuments: (documentIds: string[]) => void
  toggleStyleImageDocument: (documentId: string) => void
  selectStyleImageDocuments: (documentIds: string[]) => void
  unselectStyleImageDocuments: (documentIds: string[]) => void
  setTemplateDocument: (documentId: string | null) => void
  clearSelections: () => void
  deleteDocument: (documentId: string) => Promise<void>
}

const KnowledgeContext = createContext<KnowledgeState | null>(null)

export function useKnowledge(): KnowledgeState {
  const context = useContext(KnowledgeContext)
  if (!context) throw new Error('useKnowledge 必须在 KnowledgeProvider 内使用')
  return context
}

export function KnowledgeProvider({ children }: { children: ReactNode }) {
  const { selectedDepartmentId } = useDepartment()
  const [info, setInfo] = useState<KnowledgeLibraryInfo | null>(null)
  const [documents, setDocuments] = useState<KnowledgeDocumentMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)

  const refresh = useCallback(async () => {
    if (!selectedDepartmentId) return
    setLoading(true)
    try {
      const [nextInfo, nextDocuments] = await Promise.all([
        window.electronAPI.getKnowledgeBaseInfo(selectedDepartmentId),
        window.electronAPI.listKnowledgeDocuments(selectedDepartmentId),
      ])
      setInfo(nextInfo)
      setDocuments(nextDocuments)
    } finally {
      setLoading(false)
    }
  }, [selectedDepartmentId])

  // Refresh when department changes
  useEffect(() => { void refresh() }, [refresh])

  const importDocuments = useCallback(async (): Promise<KnowledgeImportResult> => {
    setImporting(true)
    try {
      const result = await window.electronAPI.importKnowledgeDocuments(selectedDepartmentId)
      await refresh()
      return result
    } finally {
      setImporting(false)
    }
  }, [refresh, selectedDepartmentId])

  // Selection stubs — remote API uses auto full-library retrieval, no manual selection needed
  const noop = useCallback(() => {}, [])
  const noopAsync = useCallback(async (_id: string | null) => {}, [])

  const deleteDocument = useCallback(async (documentId: string) => {
    const normalizedId = String(documentId || '').trim()
    if (!normalizedId) return
    await window.electronAPI.deleteKnowledgeDocument(selectedDepartmentId, normalizedId)
    await refresh()
  }, [refresh, selectedDepartmentId])

  const value = useMemo<KnowledgeState>(() => ({
    info,
    documents,
    query: '',
    loading,
    importing,
    activeDocumentId: null,
    activeDocument: null,
    referenceDocumentIds: [],
    styleImageDocumentIds: [],
    templateDocumentId: null,
    departmentId: selectedDepartmentId,
    setQuery: noop as (v: string) => void,
    refresh,
    importDocuments,
    openDocument: noopAsync,
    toggleReferenceDocument: noop as (id: string) => void,
    selectReferenceDocuments: noop as (ids: string[]) => void,
    unselectReferenceDocuments: noop as (ids: string[]) => void,
    toggleStyleImageDocument: noop as (id: string) => void,
    selectStyleImageDocuments: noop as (ids: string[]) => void,
    unselectStyleImageDocuments: noop as (ids: string[]) => void,
    setTemplateDocument: noop as (id: string | null) => void,
    clearSelections: noop,
    deleteDocument,
  }), [deleteDocument, documents, importing, importDocuments, info, loading, noop, noopAsync, refresh, selectedDepartmentId])

  return <KnowledgeContext.Provider value={value}>{children}</KnowledgeContext.Provider>
}