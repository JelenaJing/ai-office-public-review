import React, { createContext, useCallback, useContext, useEffect, useReducer, useRef } from 'react'
import type { PersonalFile, PersonalFolder, PersonalImportResult } from '../types/personalLibrary'

// ---------- state ----------

interface PersonalLibraryState {
  folders: PersonalFolder[]
  files: PersonalFile[]
  activeFolder: string | null   // null = show all
  selectedFileIds: Set<string>  // files checked for injection into next generation
  loading: boolean
  importInProgress: boolean
}

const initialState: PersonalLibraryState = {
  folders: [],
  files: [],
  activeFolder: null,
  selectedFileIds: new Set(),
  loading: false,
  importInProgress: false,
}

// ---------- actions ----------

type Action =
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_IMPORT_IN_PROGRESS'; value: boolean }
  | { type: 'SET_FOLDERS'; folders: PersonalFolder[] }
  | { type: 'SET_FILES'; files: PersonalFile[] }
  | { type: 'UPSERT_FOLDER'; folder: PersonalFolder }
  | { type: 'REMOVE_FOLDER'; id: string }
  | { type: 'UPSERT_FILES'; files: PersonalFile[] }
  | { type: 'REMOVE_FILE'; id: string }
  | { type: 'SET_ACTIVE_FOLDER'; folderId: string | null }
  | { type: 'TOGGLE_FILE_SELECTED'; fileId: string }
  | { type: 'SET_FILES_SELECTED'; fileIds: string[] }
  | { type: 'CLEAR_SELECTION' }

function reducer(state: PersonalLibraryState, action: Action): PersonalLibraryState {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: action.loading }
    case 'SET_IMPORT_IN_PROGRESS':
      return { ...state, importInProgress: action.value }
    case 'SET_FOLDERS':
      return { ...state, folders: action.folders }
    case 'SET_FILES':
      return { ...state, files: action.files }
    case 'UPSERT_FOLDER': {
      const idx = state.folders.findIndex((f) => f.id === action.folder.id)
      if (idx >= 0) {
        const folders = state.folders.map((f, i) => (i === idx ? action.folder : f))
        return { ...state, folders }
      }
      return { ...state, folders: [...state.folders, action.folder] }
    }
    case 'REMOVE_FOLDER': {
      const folders = state.folders.filter((f) => f.id !== action.id)
      // un-select removed folder
      const activeFolder = state.activeFolder === action.id ? null : state.activeFolder
      return { ...state, folders, activeFolder }
    }
    case 'UPSERT_FILES': {
      const upsertMap = new Map(action.files.map((f) => [f.id, f]))
      const existing = state.files.map((f) => upsertMap.has(f.id) ? upsertMap.get(f.id)! : f)
      const existingIds = new Set(state.files.map((f) => f.id))
      const newFiles = action.files.filter((f) => !existingIds.has(f.id))
      return { ...state, files: [...existing, ...newFiles] }
    }
    case 'REMOVE_FILE': {
      const files = state.files.filter((f) => f.id !== action.id)
      const selectedFileIds = new Set(state.selectedFileIds)
      selectedFileIds.delete(action.id)
      return { ...state, files, selectedFileIds }
    }
    case 'SET_ACTIVE_FOLDER':
      return { ...state, activeFolder: action.folderId }
    case 'TOGGLE_FILE_SELECTED': {
      const selectedFileIds = new Set(state.selectedFileIds)
      if (selectedFileIds.has(action.fileId)) {
        selectedFileIds.delete(action.fileId)
      } else {
        selectedFileIds.add(action.fileId)
      }
      return { ...state, selectedFileIds }
    }
    case 'SET_FILES_SELECTED': {
      const selectedFileIds = new Set(action.fileIds)
      return { ...state, selectedFileIds }
    }
    case 'CLEAR_SELECTION':
      return { ...state, selectedFileIds: new Set() }
    default:
      return state
  }
}

// ---------- context value ----------

interface PersonalLibraryContextValue {
  state: PersonalLibraryState

  // Derived helpers
  visibleFiles: PersonalFile[]
  selectedFiles: PersonalFile[]

  // Folder actions
  createFolder: (name: string) => Promise<void>
  renameFolder: (id: string, name: string) => Promise<void>
  deleteFolder: (id: string) => Promise<void>
  setActiveFolder: (folderId: string | null) => void

  // File actions
  importFiles: () => Promise<PersonalImportResult | null>
  deleteFile: (fileId: string) => Promise<void>
  moveFile: (fileId: string, targetFolderId: string | null) => Promise<void>

  // Selection
  toggleFileSelected: (fileId: string) => void
  setFilesSelected: (fileIds: string[]) => void
  clearSelection: () => void

  // Refresh
  refresh: () => Promise<void>
}

const PersonalLibraryContext = createContext<PersonalLibraryContextValue | null>(null)

// ---------- provider ----------

export function PersonalLibraryProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const api = typeof window !== 'undefined' ? (window as any).personalLibraryAPI : null
  const loadedRef = useRef(false)

  const refresh = useCallback(async () => {
    if (!api) return
    dispatch({ type: 'SET_LOADING', loading: true })
    try {
      const [folders, files] = await Promise.all([
        api.listFolders() as Promise<PersonalFolder[]>,
        api.listFiles(null) as Promise<PersonalFile[]>,
      ])
      dispatch({ type: 'SET_FOLDERS', folders })
      dispatch({ type: 'SET_FILES', files })
    } finally {
      dispatch({ type: 'SET_LOADING', loading: false })
    }
  }, [api])

  useEffect(() => {
    if (!loadedRef.current) {
      loadedRef.current = true
      void refresh()
    }
  }, [refresh])

  // ---------- folder actions ----------

  const createFolder = useCallback(async (name: string) => {
    if (!api) return
    const folder: PersonalFolder = await api.createFolder(name)
    dispatch({ type: 'UPSERT_FOLDER', folder })
  }, [api])

  const renameFolder = useCallback(async (id: string, name: string) => {
    if (!api) return
    const folder: PersonalFolder = await api.renameFolder(id, name)
    dispatch({ type: 'UPSERT_FOLDER', folder })
  }, [api])

  const deleteFolder = useCallback(async (id: string) => {
    if (!api) return
    await api.deleteFolder(id)
    dispatch({ type: 'REMOVE_FOLDER', id })
    // Refresh files since some may have moved to unfiled
    const files: PersonalFile[] = await api.listFiles(null)
    dispatch({ type: 'SET_FILES', files })
  }, [api])

  const setActiveFolder = useCallback((folderId: string | null) => {
    dispatch({ type: 'SET_ACTIVE_FOLDER', folderId })
  }, [])

  // ---------- file actions ----------

  const importFiles = useCallback(async (): Promise<PersonalImportResult | null> => {
    if (!api) return null
    dispatch({ type: 'SET_IMPORT_IN_PROGRESS', value: true })
    try {
      const result: PersonalImportResult = await api.importFiles(state.activeFolder)
      if (!result.canceled && result.imported.length > 0) {
        dispatch({ type: 'UPSERT_FILES', files: result.imported })
      }
      return result
    } finally {
      dispatch({ type: 'SET_IMPORT_IN_PROGRESS', value: false })
    }
  }, [api, state.activeFolder])

  const deleteFile = useCallback(async (fileId: string) => {
    if (!api) return
    await api.deleteFile(fileId)
    dispatch({ type: 'REMOVE_FILE', id: fileId })
  }, [api])

  const moveFile = useCallback(async (fileId: string, targetFolderId: string | null) => {
    if (!api) return
    const updated: PersonalFile = await api.moveFile(fileId, targetFolderId)
    dispatch({ type: 'UPSERT_FILES', files: [updated] })
  }, [api])

  // ---------- selection ----------

  const toggleFileSelected = useCallback((fileId: string) => {
    dispatch({ type: 'TOGGLE_FILE_SELECTED', fileId })
  }, [])

  const setFilesSelected = useCallback((fileIds: string[]) => {
    dispatch({ type: 'SET_FILES_SELECTED', fileIds })
  }, [])

  const clearSelection = useCallback(() => {
    dispatch({ type: 'CLEAR_SELECTION' })
  }, [])

  // ---------- derived ----------

  const visibleFiles = state.activeFolder === null
    ? state.files
    : state.files.filter((f) => f.folderId === state.activeFolder)

  const selectedFiles = state.files.filter((f) => state.selectedFileIds.has(f.id))

  const value: PersonalLibraryContextValue = {
    state,
    visibleFiles,
    selectedFiles,
    createFolder,
    renameFolder,
    deleteFolder,
    setActiveFolder,
    importFiles,
    deleteFile,
    moveFile,
    toggleFileSelected,
    setFilesSelected,
    clearSelection,
    refresh,
  }

  return (
    <PersonalLibraryContext.Provider value={value}>
      {children}
    </PersonalLibraryContext.Provider>
  )
}

// ---------- hook ----------

export function usePersonalLibrary(): PersonalLibraryContextValue {
  const ctx = useContext(PersonalLibraryContext)
  if (!ctx) throw new Error('usePersonalLibrary must be used within PersonalLibraryProvider')
  return ctx
}
