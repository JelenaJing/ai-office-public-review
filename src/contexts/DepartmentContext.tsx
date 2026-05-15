import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Department } from '../types/knowledge'

interface DepartmentState {
  departments: Department[]
  selectedDepartmentId: string
  loading: boolean
  error: string | null
  selectDepartment: (id: string) => void
  /** @deprecated Server-managed — kept for backward compat */
  createDepartment: (name: string, nameEn: string) => Promise<Department>
  /** @deprecated Server-managed — kept for backward compat */
  renameDepartment: (id: string, name: string, nameEn: string) => Promise<Department>
  /** @deprecated Server-managed — kept for backward compat */
  deleteDepartment: (id: string) => Promise<void>
  refresh: () => Promise<void>
}

const DepartmentContext = createContext<DepartmentState | null>(null)

const STORAGE_KEY = 'ai_writer3_selected_department_id'

export function useDepartment(): DepartmentState {
  const context = useContext(DepartmentContext)
  if (!context) throw new Error('useDepartment 必须在 DepartmentProvider 内使用')
  return context
}

export function DepartmentProvider({ children }: { children: ReactNode }) {
  const [departments, setDepartments] = useState<Department[]>([])
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list: Department[] = await window.electronAPI.listDepartments()
      setDepartments(list)

      // Restore from localStorage or use default
      const stored = localStorage.getItem(STORAGE_KEY)
      const validId = list.find((d) => d.id === stored)?.id ?? list[0]?.id ?? ''
      setSelectedDepartmentId(validId)
      if (validId) localStorage.setItem(STORAGE_KEY, validId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg.includes('timeout') || msg.includes('abort') ? '连接超时' : '连接失败')
      setDepartments([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const selectDepartment = useCallback((id: string) => {
    setSelectedDepartmentId(id)
    localStorage.setItem(STORAGE_KEY, id)
  }, [])

  // CRUD stubs — departments are now managed server-side
  const createDept = useCallback(async (_name: string, _nameEn: string): Promise<Department> => {
    throw new Error('Department creation is managed on the server')
  }, [])
  const renameDept = useCallback(async (_id: string, _name: string, _nameEn: string): Promise<Department> => {
    throw new Error('Department renaming is managed on the server')
  }, [])
  const deleteDept = useCallback(async (_id: string): Promise<void> => {
    throw new Error('Department deletion is managed on the server')
  }, [])

  const value = useMemo<DepartmentState>(() => ({
    departments,
    selectedDepartmentId,
    loading,
    error,
    selectDepartment,
    createDepartment: createDept,
    renameDepartment: renameDept,
    deleteDepartment: deleteDept,
    refresh,
  }), [departments, selectedDepartmentId, loading, error, selectDepartment, createDept, renameDept, deleteDept, refresh])

  return <DepartmentContext.Provider value={value}>{children}</DepartmentContext.Provider>
}
