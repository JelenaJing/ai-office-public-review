import styled from 'styled-components'
import { Layers } from 'lucide-react'
import { useKnowledge } from '../../contexts/KnowledgeContext'
import { usePersonalLibrary } from '../../contexts/PersonalLibraryContext'

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

const CountBadge = styled.span<{ $hasItems?: boolean }>`
  font-size: var(--font-size-xs);
  font-weight: 700;
  color: ${p => p.$hasItems ? '#1f6fd6' : '#aab8c6'};
`

const Spacer = styled.span`
  flex: 1;
`

const ManageBtn = styled.button`
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
  &:hover { background: #e8f2ff; border-color: #a0bfdf; }
`

// ---------------------------------------------------------------------------

interface ContextSourceSelectorProps {
  /** Navigate to resource center to manage references */
  onManage?: () => void
}

export default function ContextSourceSelector({ onManage }: ContextSourceSelectorProps) {
  const { referenceDocumentIds, styleImageDocumentIds } = useKnowledge()
  const { selectedFiles } = usePersonalLibrary()

  const kbCount = referenceDocumentIds.length + styleImageDocumentIds.length
  const personalCount = selectedFiles.length
  const totalCount = kbCount + personalCount

  return (
    <Bar>
      <Layers size={13} style={{ color: '#7a91a8', flexShrink: 0 }} />
      <Label>参考资料：</Label>
      <CountBadge $hasItems={totalCount > 0}>
        {totalCount > 0 ? `已选 ${totalCount} 项` : '未选择'}
      </CountBadge>
      {totalCount > 0 && (
        <span style={{ fontSize: 14, color: '#9aafbf' }}>
          (知识库 {kbCount} · 个人文件 {personalCount})
        </span>
      )}
      <Spacer />
      <ManageBtn onClick={onManage}>
        管理
      </ManageBtn>
    </Bar>
  )
}
