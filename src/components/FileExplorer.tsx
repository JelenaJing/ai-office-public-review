import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'
import {
  ChevronDown,
  ChevronRight,
  File,
  FileImage,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  PanelLeftClose,
  RefreshCw,
  Search,
  Trash2,
  Edit3,
  Copy,
  Upload,
  X,
} from 'lucide-react'
import { useWorkspace, type FileTreeNode } from '../contexts/WorkspaceContext'
import { useDocument } from '../contexts/DocumentContext'
import { useWorkspaceMode } from '../contexts/WorkspaceModeContext'
import KnowledgeSelectionDock from '../modules/knowledge/components/KnowledgeSelectionDock'
import GenerationKnowledgeSidebar from '../modules/generation/components/GenerationKnowledgeSidebar'
import { toRelativeWorkspacePath, joinRelativePath } from '../utils/workspacePath'
import { useDocumentEngineHostCommands } from '../engines/documentEngine/hostCommands'

const Panel = styled.div<{ $width: number; $embedded?: boolean }>`
  width: ${p => p.$embedded ? '100%' : `${p.$width}px`};
  min-width: ${p => p.$embedded ? '0' : '200px'};
  max-width: ${p => p.$embedded ? 'none' : '420px'};
  background: #ffffff;
  color: #304255;
  display: flex;
  flex-direction: column;
  border-right: ${p => p.$embedded ? 'none' : '1px solid #dde3ec'};
  height: 100%;
  position: relative;
`
const ResizeHandle = styled.div`position:absolute;top:0;right:-2px;width:4px;height:100%;cursor:col-resize;z-index:10;&:hover{background:#007acc;}`
const Header = styled.div`padding:8px 10px 6px;font-size:var(--font-size-xs);font-weight:600;text-transform:uppercase;letter-spacing:.8px;color:#627385;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e7edf4;min-height:32px;background:#f8fbff;`
const HeaderTitle = styled.span`overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;`
const HeaderActions = styled.div`display:flex;gap:1px;flex-shrink:0;`
const IconBtn = styled.button<{ $danger?: boolean }>`background:transparent;border:none;color:#6c7b8a;cursor:pointer;padding:3px 4px;border-radius:4px;display:flex;align-items:center;justify-content:center;&:hover{background:${p => p.$danger ? '#fdecec' : '#edf3fa'};color:${p => p.$danger ? '#c64b4b' : '#1f3142'};}`
const WorkspacePickerBar = styled.div`padding:6px 10px;border-bottom:1px solid #e7edf4;background:#f8fbff;display:flex;align-items:center;justify-content:space-between;gap:8px;`
const WorkspacePickerHint = styled.span`font-size:var(--font-size-xs);color:#6c7b8a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`
const WorkspacePickerBtn = styled.button`border:1px solid #d8e1ea;background:#fff;color:#304255;border-radius:4px;padding:4px 10px;font-size:var(--font-size-xs);cursor:pointer;white-space:nowrap;&:hover{background:#edf3fa;color:#1f3142;}`
const SearchBar = styled.div`padding:4px 8px;border-bottom:1px solid #e7edf4;background:#ffffff;`
const SearchInput = styled.div`display:flex;align-items:center;background:#f7f9fc;border:1px solid #d8e1ea;border-radius:4px;padding:0 8px;gap:6px;`
const SearchField = styled.input`flex:1;background:transparent;border:none;color:#304255;font-size:var(--font-size-xs);padding:5px 0;outline:none;&::placeholder{color:#95a1ad;}`
const TreeContainer = styled.div`flex:1;overflow:auto;`
const ExplorerBody = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`
const TreeItemRow = styled.div<{ $depth: number; $active?: boolean; $highlight?: boolean }>`display:flex;align-items:center;height:22px;padding-left:${p => 8 + p.$depth * 16}px;padding-right:8px;cursor:pointer;white-space:nowrap;position:relative;background:${p => p.$active ? '#eaf3ff' : p.$highlight ? '#f3f8fe' : 'transparent'};&:hover{background:${p => p.$active ? '#eaf3ff' : '#f5f8fc'};}`
const ChevronWrap = styled.span<{ $visible: boolean }>`display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;visibility:${p => p.$visible ? 'visible' : 'hidden'};color:#7b8794;flex-shrink:0;`
const NodeIconWrap = styled.span<{ $color?: string }>`display:inline-flex;align-items:center;justify-content:center;margin-right:5px;width:16px;height:16px;color:${p => p.$color || '#627385'};flex-shrink:0;`
const NodeName = styled.span<{ $active?: boolean; $dim?: boolean }>`font-size:var(--font-size-sm);color:${p => p.$dim ? '#95a1ad' : p.$active ? '#1f3142' : '#304255'};overflow:hidden;text-overflow:ellipsis;line-height:22px;flex:1;`
const InlineInput = styled.input`background:#ffffff;border:1px solid #007acc;border-radius:2px;color:#304255;font-size:var(--font-size-sm);padding:0 4px;height:20px;outline:none;flex:1;min-width:0;`
const WelcomePanel = styled.div`flex:1;display:flex;flex-direction:column;padding:16px;overflow:auto;`
const WelcomeTitle = styled.div`font-size:var(--font-size-sm);font-weight:600;color:#304255;margin-bottom:10px;display:flex;align-items:center;gap:6px;`
const WsInput = styled.input`width:100%;padding:7px 10px;border:1px solid #d8e1ea;border-radius:4px;background:#ffffff;color:#304255;font-size:var(--font-size-sm);outline:none;margin-bottom:8px;`
const ActionBtn = styled.button<{ $primary?: boolean }>`width:100%;padding:7px 12px;border:${p => p.$primary ? 'none' : '1px solid #d8e1ea'};border-radius:4px;background:${p => p.$primary ? '#007acc' : '#ffffff'};color:${p => p.$primary ? '#fff' : '#304255'};font-size:var(--font-size-sm);cursor:pointer;margin-bottom:6px;display:flex;align-items:center;justify-content:center;gap:6px;`
const ActionRow = styled.div`display:grid;grid-template-columns:1fr;gap:8px;margin-bottom:6px;`
const WsList = styled.div`margin-top:8px;flex:1;overflow:auto;`
const WsItem = styled.div`padding:6px 8px;border-radius:4px;cursor:pointer;display:flex;align-items:center;gap:6px;&:hover{background:#f5f8fc;}`
const WsInfo = styled.div`flex:1;overflow:hidden;`
const WsName = styled.div`font-size:var(--font-size-sm);color:#304255;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`
const WsPath = styled.div`font-size:var(--font-size-xs);color:#95a1ad;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px;`
const Breadcrumbs = styled.div`padding:4px 10px;font-size:var(--font-size-xs);color:#7b8794;border-bottom:1px solid #e7edf4;display:flex;align-items:center;gap:2px;overflow:hidden;white-space:nowrap;background:#fafcff;`
const BreadcrumbSeg = styled.span<{ $clickable?: boolean }>`color:${p => p.$clickable ? '#0e639c' : '#7b8794'};cursor:${p => p.$clickable ? 'pointer' : 'default'};overflow:hidden;text-overflow:ellipsis;`
const StatusBar = styled.div`padding:4px 10px;font-size:var(--font-size-xs);color:#7b8794;border-top:1px solid #e7edf4;display:flex;align-items:center;gap:6px;min-height:24px;background:#ffffff;`
const CtxMenu = styled.div`position:fixed;z-index:9999;background:#ffffff;border:1px solid #d6e0ea;border-radius:6px;padding:4px 0;min-width:180px;box-shadow:0 12px 32px rgba(19,41,61,.14);`
const CtxItem = styled.div<{ $danger?: boolean }>`padding:6px 16px;font-size:var(--font-size-xs);color:${p => p.$danger ? '#c64b4b' : '#304255'};cursor:pointer;display:flex;align-items:center;gap:8px;&:hover{background:#eef4fb;color:${p => p.$danger ? '#b33838' : '#1f3142'};}`
const CtxSep = styled.div`height:1px;background:#e7edf4;margin:4px 0;`

/** Strip .aidoc.json suffix for display — internal format should be transparent to user */
function getDisplayName(name: string): string {
  if (name.endsWith('.aidoc.json')) return name.slice(0, -'.aidoc.json'.length)
  return name
}

/**
 * .aidoc.json files are AI Office internal auto-save/draft files, not user documents.
 * Hide them from the file tree by default.  Set to true only in development/debug builds.
 */
const SHOW_INTERNAL_AIDOC_FILES = false

function filterInternalFiles(nodes: FileTreeNode[]): FileTreeNode[] {
  if (SHOW_INTERNAL_AIDOC_FILES) return nodes
  return nodes
    .filter(n => n.type === 'folder' || !n.name.endsWith('.aidoc.json'))
    .map(n => n.type === 'folder' ? { ...n, children: filterInternalFiles(n.children ?? []) } : n)
}

function getFileIcon(name: string) {
  if (name.endsWith('.aidoc.json')) return { icon: <FileText size={15} />, color: '#519aba' }
  const ext = name.split('.').pop()?.toLowerCase()
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext || '')) return { icon: <FileImage size={15} />, color: '#a074c4' }
  if (['md', 'txt', 'docx', 'doc', 'html', 'htm'].includes(ext || '')) return { icon: <FileText size={15} />, color: '#519aba' }
  return { icon: <File size={15} />, color: '#999' }
}

function sortNodes(nodes: FileTreeNode[]): FileTreeNode[] {
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name, 'zh')
  })
}

function nodeMatchesFilter(node: FileTreeNode, filter: string): boolean {
  if (!filter) return true
  const lower = filter.toLowerCase()
  if (node.name.toLowerCase().includes(lower)) return true
  if (node.type === 'folder' && node.children) return node.children.some((child) => nodeMatchesFilter(child, filter))
  return false
}

interface TreeNodeProps {
  node: FileTreeNode
  depth: number
  onFileClick: (node: FileTreeNode) => void
  onContextMenu: (e: React.MouseEvent, node: FileTreeNode) => void
  activeFile: string | null
  filterText: string
  renamingPath: string | null
  renameValue: string
  creatingIn: { parentPath: string; type: 'file' | 'folder' | 'blank-doc' } | null
  newItemName: string
  onRenameChange: (v: string) => void
  onNewItemNameChange: (v: string) => void
  onRenameSubmit: () => void
  onCreateSubmit: () => void
  onRenameCancel: () => void
  onCreateCancel: () => void
}

const TreeNodeItem: React.FC<TreeNodeProps> = ({ node, depth, onFileClick, onContextMenu, activeFile, filterText, renamingPath, renameValue, creatingIn, newItemName, onRenameChange, onNewItemNameChange, onRenameSubmit, onCreateSubmit, onRenameCancel, onCreateCancel }) => {
  const [expanded, setExpanded] = useState(depth === 0 || !!filterText)
  const isRenaming = renamingPath === node.path
  const isCreatingHere = creatingIn?.parentPath === node.path
  useEffect(() => { if (filterText) setExpanded(true) }, [filterText])
  if (!nodeMatchesFilter(node, filterText)) return null
  if (node.type === 'folder') {
    const children = sortNodes(node.children || [])
    return (
      <>
        <TreeItemRow $depth={depth} onClick={() => setExpanded((v) => !v)} onContextMenu={(e) => onContextMenu(e, node)}>
          <ChevronWrap $visible>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</ChevronWrap>
          <NodeIconWrap $color="#dcb67a">{expanded ? <FolderOpen size={15} /> : <Folder size={15} />}</NodeIconWrap>
          {isRenaming ? <InlineInput autoFocus value={renameValue} onChange={(e) => onRenameChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onRenameSubmit(); if (e.key === 'Escape') onRenameCancel() }} onBlur={onRenameSubmit} onClick={(e) => e.stopPropagation()} /> : <NodeName>{getDisplayName(node.name)}</NodeName>}
        </TreeItemRow>
        {expanded && children.map((child) => <TreeNodeItem key={child.path} node={child} depth={depth + 1} onFileClick={onFileClick} onContextMenu={onContextMenu} activeFile={activeFile} filterText={filterText} renamingPath={renamingPath} renameValue={renameValue} creatingIn={creatingIn} newItemName={newItemName} onRenameChange={onRenameChange} onNewItemNameChange={onNewItemNameChange} onRenameSubmit={onRenameSubmit} onCreateSubmit={onCreateSubmit} onRenameCancel={onRenameCancel} onCreateCancel={onCreateCancel} />)}
        {expanded && isCreatingHere && <TreeItemRow $depth={depth + 1}><ChevronWrap $visible={false}><ChevronRight size={14} /></ChevronWrap><NodeIconWrap $color={creatingIn?.type === 'folder' ? '#dcb67a' : creatingIn?.type === 'blank-doc' ? '#519aba' : '#999'}>{creatingIn?.type === 'folder' ? <Folder size={15} /> : creatingIn?.type === 'blank-doc' ? <FileText size={15} /> : <File size={15} />}</NodeIconWrap><InlineInput autoFocus placeholder={creatingIn?.type === 'folder' ? '文件夹名称...' : creatingIn?.type === 'blank-doc' ? '文档名称...' : '文件名称...'} value={newItemName} onChange={(e) => onNewItemNameChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onCreateSubmit(); if (e.key === 'Escape') onCreateCancel() }} onBlur={onCreateCancel} onClick={(e) => e.stopPropagation()} /></TreeItemRow>}
      </>
    )
  }
  const isActive = activeFile === node.path
  const { icon, color } = getFileIcon(node.name)
  return <TreeItemRow $depth={depth} $active={isActive} $highlight={!!(filterText && node.name.toLowerCase().includes(filterText.toLowerCase()))} onClick={() => onFileClick(node)} onContextMenu={(e) => onContextMenu(e, node)}><ChevronWrap $visible={false}><ChevronRight size={14} /></ChevronWrap><NodeIconWrap $color={color}>{icon}</NodeIconWrap>{isRenaming ? <InlineInput autoFocus value={renameValue} onChange={(e) => onRenameChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onRenameSubmit(); if (e.key === 'Escape') onRenameCancel() }} onBlur={onRenameSubmit} onClick={(e) => e.stopPropagation()} /> : <NodeName $active={isActive}>{getDisplayName(node.name)}</NodeName>}</TreeItemRow>
}

function countFiles(nodes: FileTreeNode[]): number {
  return nodes.reduce((count, node) => count + (node.type === 'file' ? 1 : 0) + (node.children ? countFiles(node.children) : 0), 0)
}

interface FileExplorerProps {
  onCollapse?: () => void
  embedded?: boolean
  panelMode?: 'auto' | 'documents'
  showKnowledgeDock?: boolean
  /** Called after a document is successfully opened — e.g. navigate to workspace view */
  onFileOpen?: () => void
  /** Hide the "返回选择工作区" picker bar — for use inside resource center embedded mode */
  hideWorkspaceManagement?: boolean
}

interface ExplorerClipboardState {
  mode: 'copy' | 'cut'
  node: FileTreeNode
}

interface ExplorerContextMenuState {
  x: number
  y: number
  node: FileTreeNode | null
  parentPath: string
}

const FileExplorer: React.FC<FileExplorerProps> = ({
  onCollapse,
  embedded = false,
  panelMode = 'auto',
  showKnowledgeDock = true,
  onFileOpen,
  hideWorkspaceManagement = false,
}) => {
  const { mode, generationMode } = useWorkspaceMode()
  const { projectRoot, fileTreeData, activeWorkspacePath, activeWorkspaceName, workspaces, loading, createWorkspace, registerWorkspace, openWorkspace, closeWorkspace, refreshTree, refreshWorkspaces, deleteWorkspace } = useWorkspace()
  const { setMarkdown, setStatusMessage, setFilePath, filePath, openTab } = useDocument()
  const { openDocumentPath } = useDocumentEngineHostCommands()
  const [newWsName, setNewWsName] = useState('')
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [filterText, setFilterText] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<ExplorerContextMenuState | null>(null)
  const [explorerClipboard, setExplorerClipboard] = useState<ExplorerClipboardState | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [panelWidth, setPanelWidth] = useState(260)
  const [creatingIn, setCreatingIn] = useState<{ parentPath: string; type: 'file' | 'folder' | 'blank-doc' } | null>(null)
  const [newItemName, setNewItemName] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { void refreshWorkspaces() }, [refreshWorkspaces])
  useEffect(() => { if (activeWorkspacePath) void refreshTree() }, [activeWorkspacePath, refreshTree])
  useEffect(() => {
    const close = () => setCtxMenu(null)
    if (!ctxMenu) return
    document.addEventListener('click', close)
    document.addEventListener('contextmenu', close)
    return () => { document.removeEventListener('click', close); document.removeEventListener('contextmenu', close) }
  }, [ctxMenu])

  const handleResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = panelWidth
    const onMove = (ev: MouseEvent) => setPanelWidth(Math.max(180, Math.min(420, startW + ev.clientX - startX)))
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [panelWidth])

  const handleCreateWorkspace = useCallback(async () => {
    if (!newWsName.trim()) return
    try {
      const wsPath = await createWorkspace(newWsName.trim())
      if (wsPath) {
        await openWorkspace(wsPath)
        setMarkdown('')
        setFilePath(null)
        setStatusMessage(`工作区 "${newWsName.trim()}" 已创建`)
      }
      setNewWsName('')
    } catch (err: any) {
      setStatusMessage(`创建失败: ${err?.message || ''}`)
    }
  }, [createWorkspace, newWsName, openWorkspace, setFilePath, setMarkdown, setStatusMessage])

  const handleOpenWorkspace = useCallback(async (wsPath: string) => {
    try {
      await openWorkspace(wsPath)
      setMarkdown('')
      setFilePath(null)
      setStatusMessage(`已打开工作区: ${wsPath.split(/[/\\]/).pop()}`)
    } catch (err: any) {
      setStatusMessage(`打开失败: ${err?.message || ''}`)
    }
  }, [openWorkspace, setFilePath, setMarkdown, setStatusMessage])

  const handleOpenWorkspaceDirectory = useCallback(async () => {
    try {
      const wsPath = await window.electronAPI.openDirectoryDialog()
      if (!wsPath) {
        setStatusMessage('已取消选择已有工作区')
        return
      }
      const registeredPath = await registerWorkspace(wsPath)
      if (registeredPath) {
        await openWorkspace(registeredPath)
        setMarkdown('')
        setFilePath(null)
        setStatusMessage(`已打开工作区: ${registeredPath.split(/[/\\]/).pop()}`)
      }
    } catch (err: any) {
      setStatusMessage(`打开失败: ${err?.message || ''}`)
    }
  }, [openWorkspace, registerWorkspace, setFilePath, setMarkdown, setStatusMessage])

  const handleReturnToWorkspacePicker = useCallback(() => {
    closeWorkspace()
    setActiveFile(null)
    setFilterText('')
    setShowSearch(false)
    setCtxMenu(null)
    setCreatingIn(null)
    setNewItemName('')
    setRenamingPath(null)
    setStatusMessage('已返回工作区选择，可创建工作区或打开已有工作区')
  }, [closeWorkspace, setStatusMessage])

  const handleDeleteWorkspace = useCallback(async (wsPath: string) => {
    try {
      await deleteWorkspace(wsPath)
      setConfirmDelete(null)
      setStatusMessage('工作区已删除')
    } catch (err: any) {
      setStatusMessage(`删除失败: ${err?.message || ''}`)
    }
  }, [deleteWorkspace, setStatusMessage])

  const handleFileClick = useCallback(async (node: FileTreeNode) => {
    setActiveFile(node.path)
    try {
      await openDocumentPath(node.path)
      onFileOpen?.()
    } catch (err: any) {
      setStatusMessage(`无法读取文件: ${err?.message || '未知错误'}`)
    }
  }, [onFileOpen, openDocumentPath, setStatusMessage])

  const startRename = useCallback((node: FileTreeNode) => {
    setRenamingPath(node.path)
    setRenameValue(node.name)
    setCtxMenu(null)
  }, [])

  const submitRename = useCallback(async () => {
    if (!renamingPath || !renameValue.trim() || !activeWorkspacePath) { setRenamingPath(null); return }
    const oldRel = toRelativeWorkspacePath(activeWorkspacePath, renamingPath)
    if (oldRel == null) { setRenamingPath(null); return }
    const oldParts = oldRel.split(/[/\\]/).filter(Boolean)
    const parentRel = oldParts.slice(0, -1).join('/')
    const newRel = joinRelativePath(parentRel, renameValue.trim())
    try {
      await window.electronAPI.renameWorkspacePath(activeWorkspacePath, oldRel, newRel)
      await refreshTree()
      setStatusMessage(`已重命名为: ${renameValue.trim()}`)
    } catch (err: any) {
      setStatusMessage(`重命名失败: ${err?.message || ''}`)
    }
    setRenamingPath(null)
  }, [activeWorkspacePath, refreshTree, renameValue, renamingPath, setStatusMessage])

  const handleDeleteNode = useCallback(async (node: FileTreeNode) => {
    setCtxMenu(null)
    if (!activeWorkspacePath) return
    const rel = toRelativeWorkspacePath(activeWorkspacePath, node.path)
    if (rel == null) return
    try {
      await window.electronAPI.deleteWorkspacePath(activeWorkspacePath, rel)
      await refreshTree()
      setStatusMessage(`已删除: ${node.name}`)
    } catch (err: any) {
      setStatusMessage(`删除失败: ${err?.message || ''}`)
    }
  }, [activeWorkspacePath, refreshTree, setStatusMessage])

  const resolveNodeParentPath = useCallback((node: FileTreeNode | null) => {
    if (!node) return activeWorkspacePath
    return node.type === 'folder' ? node.path : node.path.split(/[/\\]/).slice(0, -1).join('/')
  }, [activeWorkspacePath])

  const handleOpenContainingFolder = useCallback(async (node: FileTreeNode) => {
    const targetPath = node.type === 'folder'
      ? node.path
      : resolveNodeParentPath(node)

    if (!targetPath) {
      setStatusMessage('未找到可打开的目录')
      setCtxMenu(null)
      return
    }

    try {
      const opened = await window.electronAPI.openExternalFile(targetPath)
      if (!opened?.success) {
        setStatusMessage(`打开目录失败: ${opened?.error || '未知错误'}`)
      } else {
        setStatusMessage(node.type === 'folder' ? `已打开目录: ${node.name}` : `已打开所在目录: ${node.name}`)
      }
    } catch (err: any) {
      setStatusMessage(`打开目录失败: ${err?.message || ''}`)
    }

    setCtxMenu(null)
  }, [resolveNodeParentPath, setStatusMessage])

  const handleImportFiles = useCallback(async (targetParentPath?: string) => {
    if (!activeWorkspacePath) return
    const relDir = targetParentPath ? toRelativeWorkspacePath(activeWorkspacePath, targetParentPath) ?? '' : ''
    try {
      const result = await window.electronAPI.importFilesToWorkspace(activeWorkspacePath, relDir)
      if (result?.imported?.length) {
        await refreshTree()
        setStatusMessage(`已导入 ${result.imported.length} 个文件`)
      }
    } catch (err: any) {
      setStatusMessage(`导入失败: ${err?.message || ''}`)
    }
    setCtxMenu(null)
  }, [activeWorkspacePath, refreshTree, setStatusMessage])

  const handleNewItem = useCallback((type: 'file' | 'folder' | 'blank-doc', parentPath?: string) => {
    const parent = parentPath || activeWorkspacePath
    if (!parent) return
    setCreatingIn({ parentPath: parent, type })
    setNewItemName('')
    setCtxMenu(null)
  }, [activeWorkspacePath])

  const submitNewItem = useCallback(async () => {
    if (!creatingIn || !newItemName.trim() || !activeWorkspacePath) { setCreatingIn(null); setNewItemName(''); return }
    const parentRel = toRelativeWorkspacePath(activeWorkspacePath, creatingIn.parentPath)
    if (parentRel == null) { setCreatingIn(null); setNewItemName(''); return }
    const newRel = joinRelativePath(parentRel, newItemName.trim())
    try {
      if (creatingIn.type === 'folder') {
        await window.electronAPI.createWorkspaceFolder(activeWorkspacePath, newRel)
      } else if (creatingIn.type === 'blank-doc') {
        const docName = /\.aidoc\.json$/i.test(newItemName.trim()) ? newItemName.trim() : `${newItemName.trim()}.aidoc.json`
        const docRel = joinRelativePath(parentRel, docName)
        const result = await window.electronAPI.createBlankDocument(activeWorkspacePath, docRel)
        await openDocumentPath(result.path, { isInternalOpen: true })
      } else {
        const result = await window.electronAPI.createWorkspaceFile(activeWorkspacePath, newRel)
        await openTab(result.path, newItemName.trim(), '')
        setFilePath(result.path)
      }
      await refreshTree()
      setStatusMessage(`已创建: ${newItemName.trim()}`)
    } catch (err: any) {
      setStatusMessage(`创建失败: ${err?.message || ''}`)
    }
    setCreatingIn(null)
    setNewItemName('')
  }, [activeWorkspacePath, creatingIn, newItemName, openDocumentPath, openTab, refreshTree, setFilePath, setStatusMessage])

  const handleClipboardAction = useCallback((mode: 'copy' | 'cut', node: FileTreeNode) => {
    setExplorerClipboard({ mode, node })
    setCtxMenu(null)
    setStatusMessage(mode === 'copy' ? `已复制: ${node.name}` : `已剪切: ${node.name}`)
  }, [setStatusMessage])

  const handlePasteInto = useCallback(async (targetParentPath: string) => {
    if (!explorerClipboard || !activeWorkspacePath) return
    const sourceRel = toRelativeWorkspacePath(activeWorkspacePath, explorerClipboard.node.path)
    const targetParentRel = toRelativeWorkspacePath(activeWorkspacePath, targetParentPath)
    if (sourceRel == null || targetParentRel == null) return
    const targetRel = joinRelativePath(targetParentRel, explorerClipboard.node.name)
    try {
      if (explorerClipboard.mode === 'copy') {
        await window.electronAPI.copyWorkspacePath(activeWorkspacePath, sourceRel, targetRel)
        setStatusMessage(`已复制到: ${targetParentRel || activeWorkspaceName || '工作区根目录'}`)
      } else {
        await window.electronAPI.moveWorkspacePath(activeWorkspacePath, sourceRel, targetRel)
        setExplorerClipboard(null)
        setStatusMessage(`已移动到: ${targetParentRel || activeWorkspaceName || '工作区根目录'}`)
      }
      await refreshTree()
    } catch (err: any) {
      setStatusMessage(`粘贴失败: ${err?.message || ''}`)
    }
    setCtxMenu(null)
  }, [activeWorkspaceName, activeWorkspacePath, explorerClipboard, refreshTree, setStatusMessage])

  const sortedTree = useMemo(() => sortNodes(filterInternalFiles(fileTreeData)), [fileTreeData])
  const fileCount = useMemo(() => countFiles(filterInternalFiles(fileTreeData)), [fileTreeData])
  const breadcrumbs = activeWorkspacePath && activeFile ? activeFile.replace(activeWorkspacePath, '').split(/[/\\]/).filter(Boolean) : []
  const contextNode = ctxMenu?.node ?? null
  const shouldShowGenerationKnowledgeSidebar = panelMode === 'auto' && mode === 'generation' && generationMode !== 'document'

  if (shouldShowGenerationKnowledgeSidebar) {
    return <GenerationKnowledgeSidebar onCollapse={onCollapse} />
  }

  if (!activeWorkspacePath) {
    return (
      <Panel $width={panelWidth} $embedded={embedded} ref={panelRef}>
        {!embedded ? <ResizeHandle onMouseDown={handleResize} /> : null}
        <Header><HeaderTitle>文件管理器</HeaderTitle>{onCollapse && <HeaderActions><IconBtn onClick={onCollapse} title="收起文件管理器"><PanelLeftClose size={14} /></IconBtn></HeaderActions>}</Header>
        <WelcomePanel>
          <WelcomeTitle><FolderPlus size={14} /> 新建文章</WelcomeTitle>
          <div style={{ fontSize: 14, lineHeight: 1.7, color: '#6c7b8a', marginBottom: 10 }}>输入名称后会自动创建对应目录。正文、图片和引用文献会一起保存在当前工作区里。</div>
          <WsInput value={newWsName} onChange={(e) => setNewWsName(e.target.value)} placeholder="输入新文章名称..." onKeyDown={(e) => e.key === 'Enter' && void handleCreateWorkspace()} />
          <ActionRow>
            <ActionBtn $primary onClick={() => void handleCreateWorkspace()} disabled={!newWsName.trim() || loading}><FolderPlus size={14} /> 创建工作区</ActionBtn>
          </ActionRow>
          <ActionBtn onClick={() => void handleOpenWorkspaceDirectory()} disabled={loading}><FolderOpen size={14} /> 打开已有工作区</ActionBtn>
          {workspaces.length > 0 && <WsList>{workspaces.map((ws) => <WsItem key={ws.path} onClick={() => void handleOpenWorkspace(ws.path)}><Folder size={14} style={{ flexShrink: 0, color: '#dcb67a' }} /><WsInfo><WsName title={ws.path}>{ws.name}</WsName><WsPath>{ws.path}</WsPath></WsInfo>{confirmDelete === ws.path ? <><IconBtn $danger onClick={(e) => { e.stopPropagation(); void handleDeleteWorkspace(ws.path) }} title="确认删除">✓</IconBtn><IconBtn onClick={(e) => { e.stopPropagation(); setConfirmDelete(null) }} title="取消">✕</IconBtn></> : <IconBtn $danger onClick={(e) => { e.stopPropagation(); setConfirmDelete(ws.path) }} title="删除"><X size={12} /></IconBtn>}</WsItem>)}</WsList>}
        </WelcomePanel>
      </Panel>
    )
  }

  return (
    <Panel $width={panelWidth} $embedded={embedded} ref={panelRef}>
      {!embedded ? <ResizeHandle onMouseDown={handleResize} /> : null}
      <Header>
        <HeaderTitle title={projectRoot || activeWorkspacePath}>{activeWorkspaceName}</HeaderTitle>
        <HeaderActions>
          <IconBtn onClick={() => { setShowSearch((v) => !v); if (!showSearch) setTimeout(() => searchInputRef.current?.focus(), 50) }} title="搜索文件"><Search size={14} /></IconBtn>
          <IconBtn onClick={() => void handleImportFiles()} title="导入文件"><Upload size={13} /></IconBtn>
          <IconBtn onClick={() => void refreshTree()} title="刷新"><RefreshCw size={13} /></IconBtn>
          <IconBtn $danger onClick={closeWorkspace} title="关闭工作区"><X size={14} /></IconBtn>
          {onCollapse && <IconBtn onClick={onCollapse} title="收起文件管理器"><PanelLeftClose size={14} /></IconBtn>}
        </HeaderActions>
      </Header>
      {!hideWorkspaceManagement && (
        <WorkspacePickerBar>
          <WorkspacePickerHint>当前已进入工作区；需要切换时可返回工作区选择。</WorkspacePickerHint>
          <WorkspacePickerBtn onClick={handleReturnToWorkspacePicker}>返回选择工作区</WorkspacePickerBtn>
        </WorkspacePickerBar>
      )}
      {showSearch && <SearchBar><SearchInput><Search size={13} color="#777" /><SearchField ref={searchInputRef} value={filterText} onChange={(e) => setFilterText(e.target.value)} placeholder="搜索文件..." />{filterText && <IconBtn onClick={() => setFilterText('')}><X size={12} /></IconBtn>}</SearchInput></SearchBar>}
      {breadcrumbs.length > 0 && <Breadcrumbs><BreadcrumbSeg $clickable onClick={() => setActiveFile(null)}>{activeWorkspaceName}</BreadcrumbSeg>{breadcrumbs.map((seg, i) => <React.Fragment key={i}><span style={{ color: '#555' }}>/</span><BreadcrumbSeg $clickable={i === breadcrumbs.length - 1}>{seg}</BreadcrumbSeg></React.Fragment>)}</Breadcrumbs>}
      <ExplorerBody>
        <TreeContainer onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (!activeWorkspacePath) return; setCtxMenu({ x: e.clientX, y: e.clientY, node: null, parentPath: activeWorkspacePath }) }}>
          {sortedTree.length === 0 && <TreeItemRow $depth={0}><NodeName $dim>当前工作区为空，可右键新建空白文档、文件或文件夹</NodeName></TreeItemRow>}
          {sortedTree.map((node) => <TreeNodeItem key={node.path} node={node} depth={0} onFileClick={handleFileClick} onContextMenu={(e, item) => { e.preventDefault(); e.stopPropagation(); const parentPath = item.type === 'folder' ? item.path : resolveNodeParentPath(item) || activeWorkspacePath || item.path; setCtxMenu({ x: e.clientX, y: e.clientY, node: item, parentPath }) }} activeFile={activeFile || filePath} filterText={filterText} renamingPath={renamingPath} renameValue={renameValue} creatingIn={creatingIn} newItemName={newItemName} onRenameChange={setRenameValue} onNewItemNameChange={setNewItemName} onRenameSubmit={() => void submitRename()} onCreateSubmit={() => void submitNewItem()} onRenameCancel={() => setRenamingPath(null)} onCreateCancel={() => { setCreatingIn(null); setNewItemName('') }} />)}
          {creatingIn && creatingIn.parentPath === activeWorkspacePath && <TreeItemRow $depth={0}><ChevronWrap $visible={false}><ChevronRight size={14} /></ChevronWrap><NodeIconWrap $color={creatingIn.type === 'folder' ? '#dcb67a' : creatingIn.type === 'blank-doc' ? '#519aba' : '#999'}>{creatingIn.type === 'folder' ? <Folder size={15} /> : creatingIn.type === 'blank-doc' ? <FileText size={15} /> : <File size={15} />}</NodeIconWrap><InlineInput autoFocus placeholder={creatingIn.type === 'folder' ? '文件夹名称...' : creatingIn.type === 'blank-doc' ? '文档名称...' : '文件名称...'} value={newItemName} onChange={(e) => setNewItemName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void submitNewItem(); if (e.key === 'Escape') { setCreatingIn(null); setNewItemName('') } }} onBlur={() => { setCreatingIn(null); setNewItemName('') }} onClick={(e) => e.stopPropagation()} /></TreeItemRow>}
        </TreeContainer>
        {showKnowledgeDock ? <KnowledgeSelectionDock /> : null}
      </ExplorerBody>
      <StatusBar><Folder size={12} style={{ color: '#dcb67a' }} /><span>{fileCount} 个文件</span>{explorerClipboard && <span style={{ color: '#007acc' }}>{explorerClipboard.mode === 'copy' ? '复制中' : '剪切中'}: {explorerClipboard.node.name}</span>}{activeFile && <span style={{ marginLeft: 'auto', color: '#007acc', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>{activeFile.split(/[/\\]/).pop()}</span>}</StatusBar>
      {ctxMenu && <CtxMenu style={{ left: ctxMenu.x, top: ctxMenu.y }}>
        <CtxItem onClick={() => handleNewItem('blank-doc', ctxMenu.parentPath)}><FileText size={13} /> 新建空白文档</CtxItem>
        <CtxItem onClick={() => handleNewItem('file', ctxMenu.parentPath)}><FilePlus size={13} /> 新建文件</CtxItem>
        <CtxItem onClick={() => handleNewItem('folder', ctxMenu.parentPath)}><FolderPlus size={13} /> 新建文件夹</CtxItem>
        <CtxItem onClick={() => void handleImportFiles(ctxMenu.parentPath)}><Upload size={13} /> 导入文件</CtxItem>
        {explorerClipboard && <CtxItem onClick={() => void handlePasteInto(ctxMenu.parentPath)}><span style={{ width: 13, display: 'inline-flex', justifyContent: 'center' }}>📋</span> 粘贴</CtxItem>}
        {contextNode && <>
          <CtxSep />
          <CtxItem onClick={() => handleClipboardAction('copy', contextNode)}><Copy size={13} /> 复制</CtxItem>
          <CtxItem onClick={() => handleClipboardAction('cut', contextNode)}><span style={{ width: 13, display: 'inline-flex', justifyContent: 'center' }}>✂</span> 剪切</CtxItem>
          <CtxItem onClick={() => { setCtxMenu(null); void navigator.clipboard.writeText(contextNode.path); setStatusMessage('已复制路径') }}><span style={{ width: 13, display: 'inline-flex', justifyContent: 'center' }}>⎘</span> 复制路径</CtxItem>
          <CtxItem onClick={() => startRename(contextNode)}><Edit3 size={13} /> 重命名</CtxItem>
          {contextNode.type === 'file' ? <CtxItem onClick={() => { setCtxMenu(null); void handleFileClick(contextNode) }}><FileText size={13} /> 打开</CtxItem> : null}
          <CtxItem onClick={() => void handleOpenContainingFolder(contextNode)}><FolderOpen size={13} /> {contextNode.type === 'folder' ? '打开此目录' : '打开所在目录'}</CtxItem>
          <CtxSep />
          <CtxItem $danger onClick={() => void handleDeleteNode(contextNode)}><Trash2 size={13} /> 删除</CtxItem>
        </>}
      </CtxMenu>}
    </Panel>
  )
}

export default FileExplorer