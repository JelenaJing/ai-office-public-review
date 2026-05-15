import { useState } from 'react'
import styled from 'styled-components'
import { FolderOpen, FolderPlus, ChevronDown } from 'lucide-react'
import { useWorkspace } from '../../contexts/WorkspaceContext'

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const Bar = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border-radius: 8px;
  background: #ffffff;
  border: 1px solid #dde8f4;
  font-size: var(--font-size-xs);
  flex-shrink: 0;
`

const Label = styled.span`
  color: #7a91a8;
  flex-shrink: 0;
`

const WorkspaceName = styled.span`
  font-weight: 700;
  color: #213346;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 160px;
`

const WorkspacePath = styled.span`
  font-size: var(--font-size-xs);
  color: #9aafbf;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
`

const Sep = styled.span`
  color: #ccd7e6;
  flex-shrink: 0;
`

const SmallBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border-radius: 6px;
  border: 1px solid #c8d6e6;
  background: #f5f9ff;
  color: #304255;
  font-size: var(--font-size-xs);
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  &:hover:not(:disabled) { background: #e8f2ff; border-color: #a0bfdf; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`

const Spacer = styled.span`
  flex: 1;
`

// ---------------------------------------------------------------------------

interface SaveLocationSelectorProps {
  /** Optional callback after workspace is changed */
  onWorkspaceChanged?: () => void
  /** Navigate to resource center (for "选择工作区" flow) */
  onNavigateToResource?: () => void
}

export default function SaveLocationSelector({
  onWorkspaceChanged,
  onNavigateToResource,
}: SaveLocationSelectorProps) {
  const {
    activeWorkspacePath,
    activeWorkspaceName,
    openWorkspace,
    createWorkspace,
  } = useWorkspace()

  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  const handleChangeWorkspace = async () => {
    try {
      const wsPath = await window.electronAPI.openDirectoryDialog?.()
      if (!wsPath) return
      await openWorkspace(wsPath)
      onWorkspaceChanged?.()
    } catch {
      /* ignore */
    }
  }

  const handleCreate = async () => {
    if (!newName.trim()) return
    try {
      const wsPath = await createWorkspace(newName.trim())
      if (wsPath) {
        await openWorkspace(wsPath)
        onWorkspaceChanged?.()
      }
    } finally {
      setCreating(false)
      setNewName('')
    }
  }

  if (!activeWorkspacePath) {
    return (
      <Bar>
        <Label>保存到：</Label>
        <WorkspaceName style={{ color: '#aab8c6', fontWeight: 400 }}>未选择</WorkspaceName>
        <Spacer />
        <SmallBtn onClick={() => onNavigateToResource ? onNavigateToResource() : void handleChangeWorkspace()}>
          <FolderOpen size={11} />
          选择工作区
        </SmallBtn>
        <SmallBtn onClick={() => setCreating(v => !v)}>
          <FolderPlus size={11} />
          新建
        </SmallBtn>
        {creating && (
          <>
            <input
              autoFocus
              style={{
                padding: '3px 8px',
                border: '1px solid #b8ccdf',
                borderRadius: 6,
                fontSize: 14,
                color: '#213346',
                outline: 'none',
                width: 130,
              }}
              placeholder="工作区名称..."
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') void handleCreate()
                if (e.key === 'Escape') { setCreating(false); setNewName('') }
              }}
            />
            <SmallBtn onClick={() => void handleCreate()} disabled={!newName.trim()}>创建</SmallBtn>
          </>
        )}
      </Bar>
    )
  }

  return (
    <Bar>
      <Label>保存到：</Label>
      <WorkspaceName title={activeWorkspacePath}>{activeWorkspaceName}</WorkspaceName>
      <Sep>·</Sep>
      <WorkspacePath title={activeWorkspacePath}>{activeWorkspacePath}</WorkspacePath>
      <Spacer />
      <SmallBtn onClick={() => void handleChangeWorkspace()}>
        <ChevronDown size={11} />
        更改
      </SmallBtn>
    </Bar>
  )
}
