import styled from 'styled-components'
import { BookOpen, HardDrive, Upload } from 'lucide-react'
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
  background: linear-gradient(180deg, #fafdff 0%, #f3f7fb 100%);
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

const Badge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  background: #e7f3fe;
  color: #1a56db;
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

// ---------------------------------------------------------------------------

export default function LocalKnowledgePanel() {
  const { importing, importDocuments } = useKnowledge()
  const { selectedDepartmentId } = useDepartment()

  return (
    <Wrap>
      <Header>
        <HeaderTop>
          <HeaderTitle>
            <BookOpen size={15} />
            本地知识库
          </HeaderTitle>
          <Badge><HardDrive size={10} />本机存储</Badge>
        </HeaderTop>
        <SubTitle>文档保存在本机，支持离线使用。上传文件后可在生成任务中作为参考资料。</SubTitle>
      </Header>

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
          {importing ? '导入中...' : '上传文件'}
        </UploadButton>
        <UploadNote>文件将导入本地知识库</UploadNote>
      </Footer>
    </Wrap>
  )
}
