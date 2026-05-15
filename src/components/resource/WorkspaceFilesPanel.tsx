import { useState } from 'react'
import styled from 'styled-components'
import { Folder, FolderOpen, FolderPlus } from 'lucide-react'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import FileExplorer from '../FileExplorer'

// ---------------------------------------------------------------------------
// Styled components – compact empty state only
// ---------------------------------------------------------------------------

const EmptyWrap = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
  gap: 14px;
  color: #7a91a8;
  text-align: center;
`

const EmptyIcon = styled.div`
  font-size: 40px;
  opacity: 0.45;
`

const EmptyTitle = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: #304255;
`

const EmptyDesc = styled.p`
  margin: 0;
  font-size: var(--font-size-xs);
  color: #7a91a8;
  line-height: 1.6;
  max-width: 260px;
`

const ButtonRow = styled.div`
  display: flex;
  gap: 10px;
  margin-top: 4px;
`

const Btn = styled.button<{ $primary?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: var(--font-size-sm);
  font-weight: 600;
  cursor: pointer;
  border: ${p => p.$primary ? 'none' : '1px solid #c8d6e6'};
  background: ${p => p.$primary ? '#1f6fd6' : '#ffffff'};
  color: ${p => p.$primary ? '#ffffff' : '#304255'};
  transition: background 0.15s, opacity 0.15s;
  &:hover:not(:disabled) { opacity: 0.85; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`

const InlineInput = styled.input`
  width: 220px;
  padding: 8px 12px;
  border: 1px solid #b8ccdf;
  border-radius: 8px;
  font-size: var(--font-size-sm);
  color: #213346;
  outline: none;
  &:focus { border-color: #1f6fd6; box-shadow: 0 0 0 3px rgba(31,111,214,0.10); }
`

const CreateRow = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
`

const Wrap = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`

// ---------------------------------------------------------------------------

interface WorkspaceFilesPanelProps {
  onFileOpen?: () => void
}

export default function WorkspaceFilesPanel({ onFileOpen }: WorkspaceFilesPanelProps) {
  const {
    activeWorkspacePath,
    activeWorkspaceName,
    createWorkspace,
    openWorkspace,
    loading,
  } = useWorkspace()

  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  const handleOpenDir = async () => {
    try {
      const wsPath = await window.electronAPI.openDirectoryDialog?.()
      if (!wsPath) return
      await openWorkspace(wsPath)
    } catch {
      /* ignore */
    }
  }

  const handleCreate = async () => {
    if (!newName.trim()) return
    setBusy(true)
    try {
      const wsPath = await createWorkspace(newName.trim())
      if (wsPath) {
        await openWorkspace(wsPath)
        setCreating(false)
        setNewName('')
      }
    } finally {
      setBusy(false)
    }
  }

  if (!activeWorkspacePath) {
    return (
      <EmptyWrap>
        <EmptyIcon>📁</EmptyIcon>
        <EmptyTitle>未打开工作区</EmptyTitle>
        <EmptyDesc>工作区是保存文档、图片和生成结果的项目容器，请打开或新建一个工作区。</EmptyDesc>

        {creating ? (
          <CreateRow>
            <InlineInput
              autoFocus
              placeholder="输入工作区名称..."
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') void handleCreate()
                if (e.key === 'Escape') { setCreating(false); setNewName('') }
              }}
            />
            <Btn $primary onClick={() => void handleCreate()} disabled={!newName.trim() || busy}>
              <FolderPlus size={14} />创建
            </Btn>
            <Btn onClick={() => { setCreating(false); setNewName('') }}>取消</Btn>
          </CreateRow>
        ) : (
          <ButtonRow>
            <Btn $primary onClick={() => void handleOpenDir()} disabled={loading}>
              <FolderOpen size={14} />打开工作区
            </Btn>
            <Btn onClick={() => setCreating(true)}>
              <FolderPlus size={14} />新建工作区
            </Btn>
          </ButtonRow>
        )}

        {/* Show recently used workspaces if available */}
        <RecentWorkspaces onOpen={openWorkspace} />
      </EmptyWrap>
    )
  }

  return (
    <Wrap>
      <FileExplorer
        embedded
        panelMode="documents"
        showKnowledgeDock={false}
        hideWorkspaceManagement
        onFileOpen={onFileOpen}
      />
    </Wrap>
  )
}

// ---------------------------------------------------------------------------
// Small sub-component: recent workspaces list (no workspace active state only)
// ---------------------------------------------------------------------------

const RecentList = styled.div`
  width: 100%;
  max-width: 320px;
  margin-top: 8px;
`

const RecentLabel = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: #8094a8;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 6px;
`

const RecentItem = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid #e2eaf4;
  background: #ffffff;
  cursor: pointer;
  text-align: left;
  margin-bottom: 5px;
  transition: background 0.12s;
  &:hover { background: #f0f6ff; border-color: #b8d0ef; }
`

const RecentName = styled.div`
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: #213346;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const RecentPath = styled.div`
  font-size: var(--font-size-xs);
  color: #95a1ad;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

function RecentWorkspaces({ onOpen }: { onOpen: (path: string) => Promise<void> }) {
  const { workspaces } = useWorkspace()
  if (!workspaces.length) return null
  const recent = workspaces.slice(0, 5)
  return (
    <RecentList>
      <RecentLabel>最近使用</RecentLabel>
      {recent.map(ws => (
        <RecentItem key={ws.path} onClick={() => void onOpen(ws.path)}>
          <Folder size={14} style={{ color: '#dcb67a', flexShrink: 0 }} />
          <div style={{ overflow: 'hidden' }}>
            <RecentName>{ws.name}</RecentName>
            <RecentPath>{ws.path}</RecentPath>
          </div>
        </RecentItem>
      ))}
    </RecentList>
  )
}
