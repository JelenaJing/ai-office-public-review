import React, { useState } from 'react'
import styled from 'styled-components'
import {
  BookUser,
  CheckSquare,
  ChevronDown,
  FolderPlus,
  Image,
  Loader,
  MoreVertical,
  Square,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react'
import { usePersonalLibrary } from '../../../contexts/PersonalLibraryContext'
import type { PersonalFile, PersonalFolder } from '../../../types/personalLibrary'

// ---------- styled components ----------

const Container = styled.div`
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`

const Header = styled.div`
  padding: 10px 14px 6px;
  flex-shrink: 0;
  border-bottom: 1px solid #e0e8f1;
`

const HeaderTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: #17456d;
`

const FolderTabs = styled.div`
  display: flex;
  flex-wrap: nowrap;
  gap: 4px;
  overflow-x: auto;
  padding: 8px 14px 6px;
  flex-shrink: 0;
  border-bottom: 1px solid #e8f0fa;
  scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
`

const FolderTab = styled.button<{ $active?: boolean }>`
  white-space: nowrap;
  padding: 3px 10px;
  border-radius: 12px;
  font-size: var(--font-size-xs);
  border: 1px solid ${({ $active }) => ($active ? '#a8cdee' : '#d0dce8')};
  background: ${({ $active }) => ($active ? '#deeeff' : 'transparent')};
  color: ${({ $active }) => ($active ? '#17456d' : '#5a7490')};
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  &:hover { background: #e8f4ff; color: #17456d; }
`

const FolderTabAdd = styled.button`
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border-radius: 8px;
  border: 1px dashed #b0c4d8;
  background: transparent;
  color: #7a9db8;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  margin-left: 2px;
  &:hover { background: #edf4ff; color: #17456d; }
`

const FileList = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 6px 0;
`

const EmptyHint = styled.div`
  text-align: center;
  color: #9eb5c8;
  font-size: var(--font-size-xs);
  padding: 28px 16px;
`

const FileRow = styled.div<{ $selected?: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  cursor: pointer;
  background: ${({ $selected }) => ($selected ? '#edf6ff' : 'transparent')};
  border-left: 3px solid ${({ $selected }) => ($selected ? '#4ba0e0' : 'transparent')};
  transition: background 0.1s;
  &:hover { background: ${({ $selected }) => ($selected ? '#e4f2ff' : '#f4f8fd')}; }
`

const FileCheckbox = styled.span<{ $checked?: boolean }>`
  flex-shrink: 0;
  color: ${({ $checked }) => ($checked ? '#3a8cd9' : '#b0c4d8')};
  display: flex;
  align-items: center;
`

const FileInfo = styled.div`
  flex: 1;
  min-width: 0;
`

const FileName = styled.div`
  font-size: var(--font-size-xs);
  color: #1e3548;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const FileMeta = styled.div`
  font-size: var(--font-size-xs);
  color: #8aaabf;
  margin-top: 1px;
  display: flex;
  align-items: center;
  gap: 4px;
`

const StatusBadge = styled.span<{ $status: string }>`
  font-size: var(--font-size-xs);
  padding: 1px 5px;
  border-radius: 6px;
  background: ${({ $status }) =>
    $status === 'ready' ? '#e4f7ec' :
    $status === 'failed' ? '#fdeaea' :
    $status === 'image-only' ? '#f3f1fe' : '#fff9e0'};
  color: ${({ $status }) =>
    $status === 'ready' ? '#2a7a48' :
    $status === 'failed' ? '#b92b2b' :
    $status === 'image-only' ? '#6045a8' : '#7a6200'};
`

const FileAction = styled.button`
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: #8aaabf;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.1s, background 0.1s;
  ${FileRow}:hover & { opacity: 1; }
  &:hover { background: #f0eeee; color: #c0392b; }
`

const Footer = styled.div`
  flex-shrink: 0;
  padding: 10px 14px;
  border-top: 1px solid #e0e8f1;
  display: flex;
  gap: 6px;
`

const FooterBtn = styled.button<{ $primary?: boolean }>`
  flex: 1;
  height: 32px;
  border-radius: 10px;
  font-size: var(--font-size-xs);
  font-weight: 500;
  border: 1px solid ${({ $primary }) => ($primary ? '#4ba0e0' : '#c8d8e8')};
  background: ${({ $primary }) => ($primary ? '#4ba0e0' : 'transparent')};
  color: ${({ $primary }) => ($primary ? '#fff' : '#4a6a84')};
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  transition: background 0.12s, border-color 0.12s;
  &:hover {
    background: ${({ $primary }) => ($primary ? '#3990d4' : '#e8f4ff')};
    border-color: ${({ $primary }) => ($primary ? '#3990d4' : '#a4c4de')};
  }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`

const SelectionBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 14px;
  background: #edf6ff;
  font-size: var(--font-size-xs);
  color: #2e6fa0;
  border-bottom: 1px solid #d2e8f8;
  flex-shrink: 0;
`

const SelectionBarBtn = styled.button`
  font-size: var(--font-size-xs);
  color: #3a8cd9;
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  &:hover { background: #ddeefb; }
`

// ---------- inline input (new folder) ----------

const InlineInput = styled.input`
  border: 1px solid #a8cdee;
  border-radius: 8px;
  font-size: var(--font-size-xs);
  padding: 2px 8px;
  height: 24px;
  outline: none;
  color: #17456d;
  background: #f8fdff;
  width: 100px;
  &:focus { border-color: #4ba0e0; }
`

// ---------- helpers ----------

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function statusLabel(s: PersonalFile['extractionStatus']): string {
  if (s === 'ready') return '已提取'
  if (s === 'failed') return '提取失败'
  if (s === 'image-only') return '图片'
  return '提取中'
}

// ---------- component ----------

export default function PersonalLibrarySidebar() {
  const {
    state,
    visibleFiles,
    createFolder,
    renameFolder: _renameFolder,
    deleteFolder,
    setActiveFolder,
    importFiles,
    deleteFile,
    toggleFileSelected,
    setFilesSelected,
    clearSelection,
  } = usePersonalLibrary()

  const [newFolderInput, setNewFolderInput] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)

  const handleAddFolderConfirm = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && newFolderInput.trim()) {
      await createFolder(newFolderInput.trim())
      setNewFolderInput('')
      setCreatingFolder(false)
    } else if (e.key === 'Escape') {
      setNewFolderInput('')
      setCreatingFolder(false)
    }
  }

  const handleImport = async () => {
    await importFiles()
  }

  const handleDeleteFile = async (e: React.MouseEvent, fileId: string) => {
    e.stopPropagation()
    if (!window.confirm('确认删除此文件吗？删除后无法恢复。')) return
    await deleteFile(fileId)
  }

  const handleDeleteFolder = async (e: React.MouseEvent, folder: PersonalFolder) => {
    e.stopPropagation()
    if (!window.confirm(`确认删除文件夹"${folder.name}"？文件夹内的文件将移至未分类。`)) return
    await deleteFolder(folder.id)
  }

  const selectedCount = state.selectedFileIds.size
  const allVisibleSelected = visibleFiles.length > 0 && visibleFiles.every((f) => state.selectedFileIds.has(f.id))

  const handleToggleAllVisible = () => {
    if (allVisibleSelected) {
      const toDeselect = new Set(visibleFiles.map((f) => f.id))
      const remaining = [...state.selectedFileIds].filter((id) => !toDeselect.has(id))
      setFilesSelected(remaining)
    } else {
      const toAdd = visibleFiles.map((f) => f.id)
      setFilesSelected([...new Set([...state.selectedFileIds, ...toAdd])])
    }
  }

  return (
    <Container>
      <Header>
        <HeaderTitle>
          <BookUser size={14} />
          个人文件库
        </HeaderTitle>
      </Header>

      {/* Folder tabs */}
      <FolderTabs>
        <FolderTab
          $active={state.activeFolder === null}
          onClick={() => setActiveFolder(null)}
        >
          全部
        </FolderTab>
        {state.folders.map((folder) => (
          <FolderTab
            key={folder.id}
            $active={state.activeFolder === folder.id}
            onClick={() => setActiveFolder(folder.id)}
            title={folder.name}
            style={{ position: 'relative', paddingRight: 24 }}
          >
            {folder.name}
            <span
              style={{ position: 'absolute', right: 5, top: '50%', transform: 'translateY(-50%)', color: '#9eb5c8', cursor: 'pointer' }}
              onClick={(e) => handleDeleteFolder(e, folder)}
              title="删除文件夹"
            >
              <X size={10} />
            </span>
          </FolderTab>
        ))}

        {creatingFolder ? (
          <InlineInput
            autoFocus
            value={newFolderInput}
            placeholder="文件夹名…"
            onChange={(e) => setNewFolderInput(e.target.value)}
            onKeyDown={handleAddFolderConfirm}
            onBlur={() => { setCreatingFolder(false); setNewFolderInput('') }}
          />
        ) : (
          <FolderTabAdd type="button" title="新建文件夹" onClick={() => setCreatingFolder(true)}>
            <FolderPlus size={12} />
          </FolderTabAdd>
        )}
      </FolderTabs>

      {/* Selection bar */}
      {selectedCount > 0 && (
        <SelectionBar>
          <span>已选 {selectedCount} 个文件</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <SelectionBarBtn onClick={handleToggleAllVisible}>
              {allVisibleSelected ? '取消全选' : '全选当前'}
            </SelectionBarBtn>
            <SelectionBarBtn onClick={clearSelection}>清空</SelectionBarBtn>
          </div>
        </SelectionBar>
      )}

      {/* File list */}
      <FileList>
        {state.loading && visibleFiles.length === 0 && (
          <EmptyHint><Loader size={14} style={{ display: 'inline', marginRight: 4 }} />加载中…</EmptyHint>
        )}
        {!state.loading && visibleFiles.length === 0 && (
          <EmptyHint>
            暂无文件<br />
          <span style={{ fontSize: 14, marginTop: 4, display: 'block' }}>点击下方"导入文件"添加 PDF/Word/PPT/TXT 等文档</span>
          </EmptyHint>
        )}
        {visibleFiles.map((file) => {
          const isSelected = state.selectedFileIds.has(file.id)
          return (
            <FileRow
              key={file.id}
              $selected={isSelected}
              onClick={() => toggleFileSelected(file.id)}
            >
              <FileCheckbox $checked={isSelected}>
                {isSelected ? <CheckSquare size={15} /> : <Square size={15} />}
              </FileCheckbox>
              <FileInfo>
                <FileName title={file.originalName}>{file.originalName}</FileName>
                <FileMeta>
                  <span>{formatSize(file.size)}</span>
                  {file.extractionStatus !== 'ready' && (
                    <StatusBadge $status={file.extractionStatus}>
                      {statusLabel(file.extractionStatus)}
                    </StatusBadge>
                  )}
                  {file.extractionStatus === 'ready' && file.extractedTextLength > 0 && (
                    <span>{(file.extractedTextLength / 1000).toFixed(0)} K字</span>
                  )}
                </FileMeta>
              </FileInfo>
              <FileAction
                type="button"
                title="删除"
                onClick={(e) => handleDeleteFile(e, file.id)}
              >
                <Trash2 size={12} />
              </FileAction>
            </FileRow>
          )
        })}
      </FileList>

      {/* Footer */}
      <Footer>
        <FooterBtn
          $primary
          disabled={state.importInProgress}
          onClick={handleImport}
          title="选择文件导入到个人文件库"
        >
          {state.importInProgress ? <Loader size={13} /> : <Upload size={13} />}
          导入文件
        </FooterBtn>
        {selectedCount > 0 && (
          <FooterBtn onClick={clearSelection} title="清空本次文件选择（不删除文件）">
            <XCircle size={13} />
            清空选择
          </FooterBtn>
        )}
      </Footer>
    </Container>
  )
}
