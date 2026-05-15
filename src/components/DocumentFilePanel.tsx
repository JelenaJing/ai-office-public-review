import React, { useCallback, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'
import {
  ChevronDown,
  ChevronRight,
  File,
  FileText,
  Folder,
  FolderOpen,
  Plus,
  RefreshCw,
  Search,
  Upload,
  X,
} from 'lucide-react'
import { useWorkspace, type FileTreeNode } from '../contexts/WorkspaceContext'
import { useDocument } from '../contexts/DocumentContext'
import { useDocumentEngineHostCommands } from '../engines/documentEngine/hostCommands'

// ─── Document-file filter ─────────────────────────────────────────────────

/**
 * .aidoc.json files are AI Office internal auto-save/draft files, not user documents.
 * Hide them from the document panel by default.  Set to true only in debug builds.
 */
const SHOW_INTERNAL_AIDOC_FILES = false

const DOCUMENT_EXTS = new Set(['.docx', '.doc', '.md', '.txt', '.pdf'])
/** Folders whose contents are exclusively non-document assets */
const IMAGE_FOLDER_NAMES = new Set([
  'images', 'imgs', 'assets', 'pictures', 'image', 'figures', 'fig', 'media',
])

function isDocumentFile(name: string): boolean {
  // .aidoc.json is internal-only; only show if debug flag is on
  if (name.endsWith('.aidoc.json')) return SHOW_INTERNAL_AIDOC_FILES
  if (name.endsWith('.references.json') || name.endsWith('.out')) return false
  const lower = name.toLowerCase()
  const dot = lower.lastIndexOf('.')
  if (dot < 0) return false
  return DOCUMENT_EXTS.has(lower.slice(dot))
}

function filterDocumentTree(nodes: FileTreeNode[]): FileTreeNode[] {
  const result: FileTreeNode[] = []
  for (const node of nodes) {
    if (node.type === 'file') {
      if (isDocumentFile(node.name)) result.push(node)
    } else {
      if (IMAGE_FOLDER_NAMES.has(node.name.toLowerCase())) continue
      const children = filterDocumentTree(node.children ?? [])
      if (children.length > 0) result.push({ ...node, children })
    }
  }
  return result
}

function filterBySearch(nodes: FileTreeNode[], lower: string): FileTreeNode[] {
  if (!lower) return nodes
  const result: FileTreeNode[] = []
  for (const node of nodes) {
    if (node.type === 'file') {
      if (node.name.toLowerCase().includes(lower)) result.push(node)
    } else {
      const children = filterBySearch(node.children ?? [], lower)
      if (children.length > 0) result.push({ ...node, children })
    }
  }
  return result
}

function getDisplayName(name: string): string {
  if (name.endsWith('.aidoc.json')) return name.slice(0, -'.aidoc.json'.length)
  return name
}

function getFileIconColor(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('.aidoc.json') || lower.endsWith('.docx') || lower.endsWith('.doc')) return '#519aba'
  if (lower.endsWith('.pdf')) return '#e44d26'
  if (lower.endsWith('.md')) return '#42a86c'
  return '#8094a8'
}

// ─── Styled components ────────────────────────────────────────────────────

const PanelWrap = styled.div`
  width: 252px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border-right: 1px solid #e2e8f2;
  overflow: hidden;
  min-height: 0;
`

const PanelHeader = styled.div`
  height: 36px;
  display: flex;
  align-items: center;
  padding: 0 8px 0 12px;
  gap: 4px;
  border-bottom: 1px solid #e2e8f2;
  background: #f8fafd;
  flex-shrink: 0;
`

const PanelTitle = styled.span`
  flex: 1;
  font-size: var(--font-size-xs);
  font-weight: 700;
  color: #2c3e52;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const IconBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #6b7f94;
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;
  &:hover { background: #e8edf5; color: #1a2f47; }
`

const SearchBox = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-bottom: 1px solid #e8edf5;
  background: #f8fafd;
  flex-shrink: 0;
`

const SearchInput = styled.input`
  flex: 1;
  border: none;
  background: transparent;
  font-size: var(--font-size-xs);
  color: #1a2f47;
  outline: none;
  &::placeholder { color: #a0aebb; }
`

const NewNameRow = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 8px;
  border-bottom: 1px solid #e2e8f2;
  background: #f8fafd;
  flex-shrink: 0;
`

const NewNameInput = styled.input`
  flex: 1;
  height: 26px;
  border: 1px solid #1f6fd6;
  border-radius: 4px;
  padding: 0 6px;
  font-size: var(--font-size-xs);
  outline: none;
  color: #1a2f47;
  background: #fff;
`

const NewNameConfirm = styled.button`
  height: 26px;
  padding: 0 8px;
  border: 1px solid #1f6fd6;
  border-radius: 4px;
  background: #1f6fd6;
  color: #fff;
  font-size: var(--font-size-xs);
  font-weight: 600;
  cursor: pointer;
  &:disabled { opacity: 0.5; cursor: default; }
`

const TreeScroll = styled.div`
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding: 4px 0;
`

const TreeItem = styled.div<{ $depth: number }>`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px 4px ${p => 8 + p.$depth * 14}px;
  font-size: var(--font-size-xs);
  color: #2c3e52;
  cursor: pointer;
  user-select: none;
  &:hover { background: #f0f5fb; }
  &:active { background: #e5eef8; }
`

const TreeIcon = styled.span<{ $color?: string }>`
  display: inline-flex;
  flex-shrink: 0;
  color: ${p => p.$color || '#888'};
`

const TreeLabel = styled.span`
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const EmptyWrap = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  gap: 8px;
  color: #8094a8;
  text-align: center;
`

const EmptyTitle = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: #304255;
`

const EmptyDesc = styled.p`
  margin: 0;
  font-size: var(--font-size-xs);
  color: #8094a8;
  line-height: 1.6;
`

// ─── Recursive tree node component ────────────────────────────────────────

interface TreeNodeProps {
  node: FileTreeNode
  depth: number
  expandedFolders: Set<string>
  toggleFolder: (path: string) => void
  onFileOpen: (node: FileTreeNode) => void
}

function TreeNode({ node, depth, expandedFolders, toggleFolder, onFileOpen }: TreeNodeProps) {
  if (node.type === 'folder') {
    const expanded = expandedFolders.has(node.path)
    return (
      <>
        <TreeItem $depth={depth} onClick={() => toggleFolder(node.path)}>
          <TreeIcon>
            {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </TreeIcon>
          <TreeIcon $color="#dcb67a">
            {expanded ? <FolderOpen size={13} /> : <Folder size={13} />}
          </TreeIcon>
          <TreeLabel title={node.name}>{node.name}</TreeLabel>
        </TreeItem>
        {expanded && (node.children ?? []).map(child => (
          <TreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            expandedFolders={expandedFolders}
            toggleFolder={toggleFolder}
            onFileOpen={onFileOpen}
          />
        ))}
      </>
    )
  }

  const iconColor = getFileIconColor(node.name)
  return (
    <TreeItem $depth={depth} onClick={() => onFileOpen(node)}>
      <TreeIcon style={{ width: 10 }} />
      <TreeIcon $color={iconColor}>
        <FileText size={13} />
      </TreeIcon>
      <TreeLabel title={node.name}>{getDisplayName(node.name)}</TreeLabel>
    </TreeItem>
  )
}

// ─── Main component ───────────────────────────────────────────────────────

export default function DocumentFilePanel() {
  const { fileTreeData, activeWorkspacePath, activeWorkspaceName, refreshTree } = useWorkspace()
  const { openDocumentPath } = useDocumentEngineHostCommands()
  const { setStatusMessage } = useDocument()

  const [showSearch, setShowSearch] = useState(false)
  const [search, setSearch] = useState('')
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [newDocName, setNewDocName] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  const filteredTree = useMemo(() => {
    const docTree = filterDocumentTree(fileTreeData)
    return search.trim()
      ? filterBySearch(docTree, search.trim().toLowerCase())
      : docTree
  }, [fileTreeData, search])

  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const handleFileOpen = useCallback(async (node: FileTreeNode) => {
    if (node.type === 'folder') return
    try {
      await openDocumentPath(node.path)
    } catch (err: any) {
      setStatusMessage(`打开失败: ${err?.message || ''}`)
    }
  }, [openDocumentPath, setStatusMessage])

  const handleCreateDoc = useCallback(async () => {
    if (!activeWorkspacePath || !newDocName.trim()) return
    const safeName = newDocName.trim()
    const docName = safeName.endsWith('.aidoc.json') ? safeName : `${safeName}.aidoc.json`
    const relPath = `documents/${docName}`
    try {
      const result = await window.electronAPI.createBlankDocument(activeWorkspacePath, relPath)
      await refreshTree()
      await openDocumentPath(result.path, { isInternalOpen: true })
      setStatusMessage(`已创建: ${safeName}`)
    } catch (err: any) {
      setStatusMessage(`创建失败: ${err?.message || ''}`)
    }
    setCreating(false)
    setNewDocName('')
  }, [activeWorkspacePath, newDocName, openDocumentPath, refreshTree, setStatusMessage])

  const handleImport = useCallback(async () => {
    if (!activeWorkspacePath) return
    try {
      const result = await window.electronAPI.importFilesToWorkspace(activeWorkspacePath, 'documents')
      if (result?.imported?.length) {
        await refreshTree()
        setStatusMessage(`已导入 ${result.imported.length} 个文件`)
      }
    } catch (err: any) {
      setStatusMessage(`导入失败: ${err?.message || ''}`)
    }
  }, [activeWorkspacePath, refreshTree, setStatusMessage])

  const toggleSearch = useCallback(() => {
    setShowSearch(v => !v)
    if (!showSearch) {
      setSearch('')
      setTimeout(() => searchInputRef.current?.focus(), 50)
    }
  }, [showSearch])

  const startCreating = useCallback(() => {
    setCreating(true)
    setNewDocName('')
  }, [])

  const cancelCreating = useCallback(() => {
    setCreating(false)
    setNewDocName('')
  }, [])

  if (!activeWorkspacePath) {
    return (
      <PanelWrap>
        <PanelHeader>
          <PanelTitle>文稿</PanelTitle>
        </PanelHeader>
        <EmptyWrap>
          <TreeIcon $color="#c8d6e6"><File size={28} /></TreeIcon>
          <EmptyTitle>未打开工作区</EmptyTitle>
          <EmptyDesc>请先在资源中心选择工作区，以管理文稿文件。</EmptyDesc>
        </EmptyWrap>
      </PanelWrap>
    )
  }

  return (
    <PanelWrap>
      <PanelHeader>
        <PanelTitle title={activeWorkspacePath}>{activeWorkspaceName ?? '文稿'}</PanelTitle>
        <IconBtn title="新建文稿" onClick={startCreating}>
          <Plus size={13} />
        </IconBtn>
        <IconBtn title="导入文件" onClick={() => void handleImport()}>
          <Upload size={12} />
        </IconBtn>
        <IconBtn title="搜索" onClick={toggleSearch}>
          <Search size={12} />
        </IconBtn>
        <IconBtn title="刷新" onClick={() => void refreshTree()}>
          <RefreshCw size={12} />
        </IconBtn>
      </PanelHeader>

      {creating && (
        <NewNameRow>
          <NewNameInput
            autoFocus
            value={newDocName}
            onChange={e => setNewDocName(e.target.value)}
            placeholder="新文稿名称..."
            onKeyDown={e => {
              if (e.key === 'Enter') void handleCreateDoc()
              if (e.key === 'Escape') cancelCreating()
            }}
          />
          <NewNameConfirm
            disabled={!newDocName.trim()}
            onClick={() => void handleCreateDoc()}
          >
            创建
          </NewNameConfirm>
          <IconBtn onClick={cancelCreating} title="取消">
            <X size={11} />
          </IconBtn>
        </NewNameRow>
      )}

      {showSearch && (
        <SearchBox>
          <Search size={12} color="#8094a8" />
          <SearchInput
            ref={searchInputRef}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索文稿..."
            onKeyDown={e => {
              if (e.key === 'Escape') { setShowSearch(false); setSearch('') }
            }}
          />
          {search && (
            <IconBtn onClick={() => setSearch('')} title="清除">
              <X size={10} />
            </IconBtn>
          )}
        </SearchBox>
      )}

      <TreeScroll>
        {filteredTree.length === 0 ? (
          <EmptyWrap>
            <TreeIcon $color="#c8d6e6"><FileText size={28} /></TreeIcon>
            <EmptyTitle>{search ? '未找到匹配文稿' : '暂无文稿'}</EmptyTitle>
            <EmptyDesc>
              {search
                ? '请尝试其他关键词。'
                : '点击上方 + 新建文稿，或点击 ↑ 导入已有文件。'}
            </EmptyDesc>
          </EmptyWrap>
        ) : (
          filteredTree.map(node => (
            <TreeNode
              key={node.path}
              node={node}
              depth={0}
              expandedFolders={expandedFolders}
              toggleFolder={toggleFolder}
              onFileOpen={handleFileOpen}
            />
          ))
        )}
      </TreeScroll>
    </PanelWrap>
  )
}
