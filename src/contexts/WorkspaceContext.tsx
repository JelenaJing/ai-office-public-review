import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export interface FileTreeNode {
  name: string
  path: string
  relativePath: string
  type: 'file' | 'folder'
  size?: number
  children?: FileTreeNode[]
}

interface WorkspaceInfo {
  name: string
  path: string
  hasDocument: boolean
  modifiedAt: string
}

interface WorkspaceState {
  workspaceRoot: string | null
  projectRoot: string | null
  activeWorkspacePath: string | null
  activeWorkspaceName: string | null
  initialized: boolean
  fileTree: FileTreeNode[]
  fileTreeData: FileTreeNode[]
  workspaces: WorkspaceInfo[]
  loading: boolean
  createWorkspace: (name: string, parentDir?: string) => Promise<string | null>
  renameWorkspace: (wsPath: string, nextName: string) => Promise<string | null>
  registerWorkspace: (wsPath: string) => Promise<string | null>
  openWorkspace: (wsPath: string) => Promise<void>
  closeWorkspace: () => void
  refreshTree: () => Promise<void>
  refreshWorkspaces: () => Promise<void>
  deleteWorkspace: (wsPath: string) => Promise<void>
}

const WorkspaceContext = createContext<WorkspaceState | null>(null)

export function useWorkspace(): WorkspaceState {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace 必须在 WorkspaceProvider 内使用')
  return ctx
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null)
  const [projectRoot, setProjectRoot] = useState<string | null>(null)
  const [activeWorkspacePath, setActiveWorkspacePath] = useState<string | null>(null)
  const [activeWorkspaceName, setActiveWorkspaceName] = useState<string | null>(null)
  const [initialized, setInitialized] = useState(false)
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([])
  const [loading, setLoading] = useState(false)

  const refreshWorkspaces = useCallback(async () => {
    const list = await window.electronAPI.listWorkspaces()
    setWorkspaces(list as WorkspaceInfo[])
    setInitialized(true)
  }, [])

  const refreshTree = useCallback(async () => {
    if (!activeWorkspacePath) return
    const tree = await window.electronAPI.getWorkspaceTree(activeWorkspacePath)
    setFileTree(tree as FileTreeNode[])
  }, [activeWorkspacePath])

  const createWorkspace = useCallback(async (name: string, parentDir?: string) => {
    setLoading(true)
    try {
      const result = await window.electronAPI.createWorkspace(name, parentDir)
      await refreshWorkspaces()
      return result.path
    } finally {
      setLoading(false)
    }
  }, [refreshWorkspaces])

  const renameWorkspace = useCallback(async (wsPath: string, nextName: string) => {
    setLoading(true)
    try {
      const result = await window.electronAPI.renameWorkspace(wsPath, nextName)
      await refreshWorkspaces()
      if (activeWorkspacePath === wsPath) {
        const tree = await window.electronAPI.getWorkspaceTree(result.path)
        setWorkspaceRoot(result.path)
        setProjectRoot(result.path)
        setActiveWorkspacePath(result.path)
        setActiveWorkspaceName(result.name)
        setFileTree(tree as FileTreeNode[])
      }
      return result.path
    } finally {
      setLoading(false)
    }
  }, [activeWorkspacePath, refreshWorkspaces])

  const registerWorkspace = useCallback(async (wsPath: string) => {
    setLoading(true)
    try {
      const result = await window.electronAPI.registerWorkspace(wsPath)
      await refreshWorkspaces()
      return result.path
    } finally {
      setLoading(false)
    }
  }, [refreshWorkspaces])

  const openWorkspace = useCallback(async (wsPath: string) => {
    setLoading(true)
    try {
      const tree = await window.electronAPI.getWorkspaceTree(wsPath)
      setWorkspaceRoot(wsPath)
      setProjectRoot(wsPath)
      setActiveWorkspacePath(wsPath)
      setActiveWorkspaceName(wsPath.split(/[/\\]/).pop() || wsPath)
      setFileTree(tree as FileTreeNode[])
    } finally {
      setLoading(false)
    }
  }, [])

  const closeWorkspace = useCallback(() => {
    setWorkspaceRoot(null)
    setProjectRoot(null)
    setActiveWorkspacePath(null)
    setActiveWorkspaceName(null)
    setFileTree([])
  }, [])

  const deleteWorkspace = useCallback(async (wsPath: string) => {
    await window.electronAPI.deleteWorkspace(wsPath)
    if (activeWorkspacePath === wsPath) {
      closeWorkspace()
    }
    await refreshWorkspaces()
  }, [activeWorkspacePath, closeWorkspace, refreshWorkspaces])

  useEffect(() => {
    void refreshWorkspaces()
  }, [refreshWorkspaces])

  const contextValue = useMemo<WorkspaceState>(() => ({
    workspaceRoot,
    projectRoot,
    activeWorkspacePath,
    activeWorkspaceName,
    initialized,
    fileTree,
    fileTreeData: fileTree,
    workspaces,
    loading,
    createWorkspace,
    renameWorkspace,
    registerWorkspace,
    openWorkspace,
    closeWorkspace,
    refreshTree,
    refreshWorkspaces,
    deleteWorkspace,
  }), [
    workspaceRoot,
    projectRoot,
    activeWorkspacePath,
    activeWorkspaceName,
    initialized,
    fileTree,
    workspaces,
    loading,
    createWorkspace,
    renameWorkspace,
    registerWorkspace,
    openWorkspace,
    closeWorkspace,
    refreshTree,
    refreshWorkspaces,
    deleteWorkspace,
  ])

  return (
    <WorkspaceContext.Provider value={contextValue}>
      {children}
    </WorkspaceContext.Provider>
  )
}