import { useState } from 'react'
import styled from 'styled-components'
import { BookOpen, RefreshCw, Upload } from 'lucide-react'
import { useKnowledge } from '../../contexts/KnowledgeContext'
import { useDepartment } from '../../contexts/DepartmentContext'
import { DepartmentSelector } from '../DepartmentSelector'

// ──────────────────────────────────────────────────────────────────────────────
// Styled components
// ──────────────────────────────────────────────────────────────────────────────

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

const LoadingWrap = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #8094a8;
  font-size: var(--font-size-sm);
  gap: 8px;
`

// ──────────────────────────────────────────────────────────────────────────────

export default function KnowledgePanel() {
  const { importing, importDocuments } = useKnowledge()
  const { departments, selectedDepartmentId, loading, error, refresh } = useDepartment()
  const [retrying, setRetrying] = useState(false)

  const handleRetry = async () => {
    setRetrying(true)
    try {
      await refresh()
    } finally {
      setRetrying(false)
    }
  }

  const isAvailable = !loading && !error && departments.length > 0

  return (
    <Wrap>
      <Header>
        <HeaderTop>
          <HeaderTitle>
            <BookOpen size={15} />
            知识库
          </HeaderTitle>
        </HeaderTop>
        <SubTitle>来自服务器的学校/企业知识库，可作为 AI 生成时的参考资料。</SubTitle>
      </Header>

      {loading ? (
        <LoadingWrap>
          <RefreshCw size={16} style={{ opacity: 0.5 }} />
          正在连接知识库…
        </LoadingWrap>
      ) : error ? (
        <UnconfiguredWrap>
          <UnconfiguredIcon>⚠️</UnconfiguredIcon>
          <UnconfiguredTitle>知识库连接失败</UnconfiguredTitle>
          <UnconfiguredDesc>
            {error === '连接超时'
              ? '连接知识库服务器超时，请检查网络连接或联系管理员。'
              : '无法连接到知识库服务器，请检查网络连接或联系管理员。'}
          </UnconfiguredDesc>
          <RetryButton onClick={() => void handleRetry()} disabled={retrying}>
            <RefreshCw size={13} />
            {retrying ? '重试中...' : '重新连接'}
          </RetryButton>
        </UnconfiguredWrap>
      ) : !isAvailable ? (
        <UnconfiguredWrap>
          <UnconfiguredIcon>📚</UnconfiguredIcon>
          <UnconfiguredTitle>知识库未配置</UnconfiguredTitle>
          <UnconfiguredDesc>
            当前未连接到知识库服务器。如需使用学校或企业知识库，请联系管理员配置服务地址。
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
              disabled={importing || !selectedDepartmentId}
              onClick={() => void importDocuments()}
            >
              <Upload size={13} />
              {importing ? '上传中...' : '上传文件到知识库'}
            </UploadButton>
            <UploadNote>文件将上传到服务器知识库</UploadNote>
          </Footer>
        </>
      )}
    </Wrap>
  )
}
