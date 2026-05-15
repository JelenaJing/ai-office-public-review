import { useState } from 'react'
import styled from 'styled-components'
import { BookOpen, Cloud, RefreshCw, Upload } from 'lucide-react'
import { useKnowledge } from '../../contexts/KnowledgeContext'
import { useDepartment } from '../../contexts/DepartmentContext'
import { DepartmentSelector } from '../DepartmentSelector'

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const Wrap = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: linear-gradient(180deg, #fafeff 0%, #f3f7fb 100%);
`

const Header = styled.div`
  padding: 14px 16px 10px;
  border-bottom: 1px solid #e4ecf5;
  flex-shrink: 0;
`

const HeaderTop = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
`

const HeaderTitle = styled.div`
  font-size: 15px;
  font-weight: 700;
  color: #1f3044;
  display: flex;
  align-items: center;
  gap: 7px;
`

const Badge = styled.span<{ $ok?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  background: ${p => p.$ok ? '#e6f4ea' : '#fff3cd'};
  color: ${p => p.$ok ? '#1a7a4a' : '#856404'};
  flex-shrink: 0;
`

const StatusDot = styled.span<{ $ok?: boolean }>`
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: ${p => p.$ok ? '#2d9e6b' : '#e8a020'};
  flex-shrink: 0;
`

const SubTitle = styled.div`
  font-size: var(--font-size-xs);
  color: #6b84a0;
  line-height: 1.5;
`

const Body = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px;
`

const Footer = styled.div`
  padding: 10px 14px;
  border-top: 1px solid #e4ecf5;
  flex-shrink: 0;
`

const UploadButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 8px 0;
  border: none;
  border-radius: 6px;
  background: #e8f0fe;
  color: #1a56db;
  font-size: var(--font-size-xs);
  font-weight: 500;
  cursor: pointer;

  &:hover:not(:disabled) { background: #d4e4fd; }
  &:disabled { opacity: 0.45; cursor: not-allowed; }
`

const UploadNote = styled.div`
  margin-top: 6px;
  font-size: var(--font-size-xs);
  color: #8094a8;
  text-align: center;
`

const UnconfiguredWrap = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 32px 24px;
  text-align: center;
`

const UnconfiguredIcon = styled.div`
  font-size: 36px;
  opacity: 0.4;
`

const UnconfiguredTitle = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: #304255;
`

const UnconfiguredDesc = styled.p`
  margin: 0;
  font-size: var(--font-size-xs);
  color: #7a91a8;
  line-height: 1.6;
  max-width: 260px;
`

const RetryButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 7px;
  border: 1px solid #c8d6e6;
  background: #ffffff;
  color: #304255;
  font-size: var(--font-size-xs);
  font-weight: 600;
  cursor: pointer;
  &:hover { background: #f0f6ff; }
`

// ---------------------------------------------------------------------------

export default function RemoteKnowledgePanel() {
  const { importing, importDocuments } = useKnowledge()
  const { departments, selectedDepartmentId, loading, refresh } = useDepartment()
  const [retrying, setRetrying] = useState(false)

  const handleRetry = async () => {
    setRetrying(true)
    try {
      await refresh()
    } finally {
      setRetrying(false)
    }
  }

  const isAvailable = !loading && departments.length > 0

  return (
    <Wrap>
      <Header>
        <HeaderTop>
          <HeaderTitle>
            <BookOpen size={15} />
            远程知识库
          </HeaderTitle>
          {loading ? (
            <Badge>
              <StatusDot />
              检测中…
            </Badge>
          ) : isAvailable ? (
            <Badge $ok>
              <StatusDot $ok />
              已连接
            </Badge>
          ) : (
            <Badge>
              <StatusDot />
              未配置
            </Badge>
          )}
        </HeaderTop>
        <SubTitle>来自服务器的部门共享知识库，可供团队协作使用。</SubTitle>
      </Header>

      {!loading && !isAvailable ? (
        <UnconfiguredWrap>
          <UnconfiguredIcon>☁️</UnconfiguredIcon>
          <UnconfiguredTitle>远程知识库未配置</UnconfiguredTitle>
          <UnconfiguredDesc>
            当前未连接到远程知识库服务器。如需使用部门共享知识库，请联系管理员配置服务地址。
          </UnconfiguredDesc>
          <RetryButton onClick={() => void handleRetry()} disabled={retrying}>
            <RefreshCw size={13} />
            {retrying ? '重试中...' : '重新连接'}
          </RetryButton>
        </UnconfiguredWrap>
      ) : (
        <>
          <Body>
            <DepartmentSelector />
          </Body>

          <Footer>
            <UploadButton
              type="button"
              disabled={importing || !selectedDepartmentId || !isAvailable}
              onClick={() => void importDocuments()}
            >
              <Upload size={13} />
              <Cloud size={11} />
              {importing ? '上传中...' : '上传文件'}
            </UploadButton>
            <UploadNote>文件将上传到远程知识库（如不可用则导入本地）</UploadNote>
          </Footer>
        </>
      )}
    </Wrap>
  )
}
