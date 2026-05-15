import { useState } from 'react'
import styled, { keyframes } from 'styled-components'
import { Folder, FolderOpen, FolderPlus } from 'lucide-react'
import { useWorkspace } from '../contexts/WorkspaceContext'

// ──────────────────────────────────────────────────────────────────────────────
// Styled components
// ──────────────────────────────────────────────────────────────────────────────

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
`

const Screen = styled.div`
  position: fixed;
  inset: 0;
  background: linear-gradient(135deg, #eef2f8 0%, #f5f8fc 60%, #e8eef7 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', sans-serif;
  overflow: hidden;
`

const Card = styled.div`
  background: #ffffff;
  border: 1px solid #dde3ec;
  border-radius: 18px;
  box-shadow: 0 6px 32px rgba(30, 50, 90, 0.10), 0 1px 4px rgba(30, 50, 90, 0.06);
  padding: 44px 44px 36px;
  width: 480px;
  max-width: calc(100vw - 40px);
  animation: ${fadeIn} 0.25s ease;
`

const Brand = styled.div`
  text-align: center;
  margin-bottom: 32px;
`

const BrandIcon = styled.div`
  font-size: 40px;
  margin-bottom: 12px;
`

const BrandTitle = styled.div`
  font-size: 26px;
  font-weight: 800;
  color: #1a3150;
  letter-spacing: -0.5px;
  margin-bottom: 10px;
`

const BrandSubtitle = styled.div`
  font-size: var(--font-size-sm);
  color: #627385;
  line-height: 1.7;
`

const ActionRow = styled.div`
  display: flex;
  gap: 10px;
  margin-bottom: 24px;
`

const PrimaryBtn = styled.button`
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 12px 16px;
  border: none;
  border-radius: 10px;
  background: #1f6fd6;
  color: #ffffff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s;
  &:hover:not(:disabled) { background: #1760bc; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`

const SecondaryBtn = styled.button`
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 12px 16px;
  border: 1px solid #c8d6e8;
  border-radius: 10px;
  background: #ffffff;
  color: #304255;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  &:hover:not(:disabled) { background: #f0f6ff; border-color: #a8c4e0; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`

const CreateRow = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 24px;
`

const InlineInput = styled.input`
  flex: 1;
  padding: 10px 14px;
  border: 1px solid #b8ccdf;
  border-radius: 8px;
  font-size: var(--font-size-sm);
  color: #213346;
  outline: none;
  &:focus { border-color: #1f6fd6; box-shadow: 0 0 0 3px rgba(31,111,214,0.10); }
`

const RecentSection = styled.div`
  margin-top: 4px;
`

const RecentLabel = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: #8094a8;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 8px;
`

const RecentItem = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 10px;
  border: 1px solid #e2eaf4;
  background: #f7fafd;
  cursor: pointer;
  text-align: left;
  margin-bottom: 6px;
  transition: background 0.12s, border-color 0.12s;
  &:hover { background: #eaf2ff; border-color: #b0cce8; }
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
  color: #8094a8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 1px;
`

const ErrorText = styled.div`
  font-size: var(--font-size-xs);
  color: #c0392b;
  margin-bottom: 12px;
  text-align: center;
`

// ──────────────────────────────────────────────────────────────────────────────

export default function WorkspaceGate() {
  const { workspaces, openWorkspace, createWorkspace, loading } = useWorkspace()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleOpenDir = async () => {
    setError(null)
    try {
      const wsPath = await window.electronAPI.openDirectoryDialog?.()
      if (!wsPath) return
      await openWorkspace(wsPath)
    } catch {
      setError('打开工作区失败，请重试。')
    }
  }

  const handleCreate = async () => {
    if (!newName.trim()) return
    setBusy(true)
    setError(null)
    try {
      const wsPath = await createWorkspace(newName.trim())
      if (wsPath) {
        await openWorkspace(wsPath)
        setCreating(false)
        setNewName('')
      } else {
        setError('创建工作区失败，请重试。')
      }
    } catch {
      setError('创建工作区失败，请重试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Card>
        <Brand>
          <BrandIcon>📁</BrandIcon>
          <BrandTitle>选择工作区</BrandTitle>
          <BrandSubtitle>
            工作区用于保存你生成的文稿、PPT、图片和分析结果。<br />
            请新建或打开一个工作区以继续使用 AI-Office。
          </BrandSubtitle>
        </Brand>

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
            <PrimaryBtn
              onClick={() => void handleCreate()}
              disabled={!newName.trim() || busy}
              style={{ flex: 'none', padding: '10px 18px' }}
            >
              <FolderPlus size={14} />
              创建
            </PrimaryBtn>
            <SecondaryBtn
              onClick={() => { setCreating(false); setNewName('') }}
              style={{ flex: 'none', padding: '10px 14px' }}
            >
              取消
            </SecondaryBtn>
          </CreateRow>
        ) : (
          <ActionRow>
            <PrimaryBtn onClick={() => setCreating(true)}>
              <FolderPlus size={15} />
              新建工作区
            </PrimaryBtn>
            <SecondaryBtn onClick={() => void handleOpenDir()} disabled={loading}>
              <FolderOpen size={15} />
              打开已有工作区
            </SecondaryBtn>
          </ActionRow>
        )}

        {error && <ErrorText>{error}</ErrorText>}

        {workspaces.length > 0 && (
          <RecentSection>
            <RecentLabel>最近使用</RecentLabel>
            {workspaces.slice(0, 5).map(ws => (
              <RecentItem key={ws.path} onClick={() => void openWorkspace(ws.path)}>
                <Folder size={15} style={{ color: '#dcb67a', flexShrink: 0 }} />
                <div style={{ overflow: 'hidden', flex: 1 }}>
                  <RecentName>{ws.name}</RecentName>
                  <RecentPath>{ws.path}</RecentPath>
                </div>
              </RecentItem>
            ))}
          </RecentSection>
        )}
      </Card>
    </Screen>
  )
}
