import React from 'react'
import styled from 'styled-components'
import type { Department } from '../../types/knowledge'

// ─────────────────────────────────────────────────────────────────────────────
// Styled components
// ─────────────────────────────────────────────────────────────────────────────

const Wrap = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
`

const Label = styled.span`
  font-size: var(--font-size-xs);
  color: #6b84a0;
  white-space: nowrap;
  flex-shrink: 0;
`

const ChipsRow = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: nowrap;
  overflow: hidden;
  max-width: 280px;
`

const Chip = styled.span`
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 20px;
  background: #e8f0fe;
  color: #1a56db;
  font-size: var(--font-size-xs);
  font-weight: 500;
  white-space: nowrap;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
`

const OverflowChip = styled(Chip)`
  background: #f0f4fa;
  color: #6b84a0;
`

const EmptyHint = styled.span`
  font-size: var(--font-size-xs);
  color: #94a3b8;
  font-style: italic;
`

const ChangeBtn = styled.button`
  padding: 3px 10px;
  border: 1px solid #c8d6e6;
  border-radius: 6px;
  background: #ffffff;
  color: #304255;
  font-size: var(--font-size-xs);
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: background 0.12s, border-color 0.12s;

  &:hover { background: #f0f6ff; border-color: #90b0d8; }
  &:disabled { opacity: 0.45; cursor: not-allowed; }
`

const LoadingHint = styled.span`
  font-size: var(--font-size-xs);
  color: #94a3b8;
`

const ErrorHint = styled.span`
  font-size: var(--font-size-xs);
  color: #d97706;
`

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const MAX_VISIBLE_CHIPS = 2

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface KnowledgeChipBarProps {
  departments: Department[]
  selectedIds: string[]
  loading: boolean
  error: string | null
  onOpenPicker: () => void
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export const KnowledgeChipBar: React.FC<KnowledgeChipBarProps> = ({
  departments,
  selectedIds,
  loading,
  error,
  onOpenPicker,
}) => {
  if (loading) {
    return (
      <Wrap>
        <Label>知识库</Label>
        <LoadingHint>连接中…</LoadingHint>
      </Wrap>
    )
  }

  if (error) {
    return (
      <Wrap>
        <Label>知识库</Label>
        <ErrorHint title={error}>⚠ 连接失败</ErrorHint>
        <ChangeBtn type="button" onClick={onOpenPicker}>重试</ChangeBtn>
      </Wrap>
    )
  }

  if (departments.length === 0) return null

  // Resolve selected names, prefer leaf nodes
  const deptMap = new Map(departments.map((d) => [d.id, d]))
  const selectedNames = selectedIds
    .map((id) => deptMap.get(id)?.name ?? null)
    .filter((n): n is string => n !== null)

  const visible = selectedNames.slice(0, MAX_VISIBLE_CHIPS)
  const overflow = selectedNames.length - MAX_VISIBLE_CHIPS

  return (
    <Wrap>
      <Label>知识库</Label>
      <ChipsRow>
        {selectedNames.length === 0 ? (
          <EmptyHint>未选择</EmptyHint>
        ) : (
          <>
            {visible.map((name, i) => (
              <Chip key={i} title={name}>{name}</Chip>
            ))}
            {overflow > 0 && <OverflowChip>+{overflow}</OverflowChip>}
          </>
        )}
      </ChipsRow>
      <ChangeBtn
        type="button"
        onClick={onOpenPicker}
        disabled={departments.length === 0}
      >
        更改
      </ChangeBtn>
    </Wrap>
  )
}
