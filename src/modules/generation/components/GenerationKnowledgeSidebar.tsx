import styled from 'styled-components'
import { BookOpen, PanelLeftClose, Upload } from 'lucide-react'
import { useKnowledge } from '../../../contexts/KnowledgeContext'
import { useDepartment } from '../../../contexts/DepartmentContext'
import { DepartmentSelector } from '../../../components/DepartmentSelector'

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const Panel = styled.div<{ $embedded?: boolean }>`
  width: ${(p) => (p.$embedded ? '100%' : '336px')};
  min-width: ${(p) => (p.$embedded ? '0' : '300px')};
  max-width: ${(p) => (p.$embedded ? 'none' : '340px')};
  height: 100%;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, #fafdff 0%, #f3f7fb 100%);
  border-right: ${(p) => (p.$embedded ? 'none' : '1px solid #dbe4ee')};
  color: #304255;
`

const Header = styled.div`
  padding: 12px 14px 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #e4ecf5;
`

const HeaderTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: #1f3044;
`

const IconButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #708396;
  cursor: pointer;

  &:hover {
    background: #e8eef6;
    color: #1f3044;
  }
`

const Body = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px;
`

const UploadFooter = styled.div`
  padding: 10px 14px;
  border-top: 1px solid #e4ecf5;
`

const UploadButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 7px 0;
  border: none;
  border-radius: 6px;
  background: #e8f0fe;
  color: #1a56db;
  font-size: var(--font-size-xs);
  font-weight: 500;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: #d4e4fd;
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
`

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface GenerationKnowledgeSidebarProps {
  onCollapse?: () => void
  embedded?: boolean
}

export default function GenerationKnowledgeSidebar({ onCollapse, embedded = false }: GenerationKnowledgeSidebarProps) {
  const { importing, importDocuments } = useKnowledge()
  const { selectedDepartmentId } = useDepartment()

  return (
    <Panel $embedded={embedded} data-testid="generation-knowledge-sidebar">
      <Header>
        <HeaderTitle><BookOpen size={14} /> 知识库</HeaderTitle>
        {onCollapse ? (
          <IconButton type="button" onClick={onCollapse} title="收起左栏">
            <PanelLeftClose size={14} />
          </IconButton>
        ) : null}
      </Header>

      <Body>
        <DepartmentSelector />
      </Body>

      <UploadFooter>
        <UploadButton
          type="button"
          disabled={importing || !selectedDepartmentId}
          onClick={() => void importDocuments()}
        >
          <Upload size={13} />
          {importing ? '导入中...' : '上传文件'}
        </UploadButton>
      </UploadFooter>
    </Panel>
  )
}
