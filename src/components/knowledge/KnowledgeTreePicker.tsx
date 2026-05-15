import React, { useCallback, useMemo, useState } from 'react'
import styled, { keyframes } from 'styled-components'
import { Check, ChevronDown, ChevronRight, Minus, Search, X } from 'lucide-react'
import type { Department } from '../../types/knowledge'

// ─────────────────────────────────────────────────────────────────────────────
// Styled components
// ─────────────────────────────────────────────────────────────────────────────

const fadeIn = keyframes`
  from { opacity: 0; }
  to   { opacity: 1; }
`

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  animation: ${fadeIn} 0.12s ease;
`

const Card = styled.div`
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.18);
  width: 480px;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 96px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
`

const CardHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px 12px;
  border-bottom: 1px solid #e8edf4;
  flex-shrink: 0;
`

const CardTitle = styled.h3`
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: #1a2a3a;
`

const CloseBtn = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #7a91a8;
  cursor: pointer;
  padding: 0;
  &:hover { background: #f0f4fa; color: #304255; }
`

const SearchWrap = styled.div`
  padding: 10px 14px;
  border-bottom: 1px solid #e8edf4;
  flex-shrink: 0;
  position: relative;
`

const SearchIcon = styled.div`
  position: absolute;
  left: 24px;
  top: 50%;
  transform: translateY(-50%);
  color: #94a3b8;
  display: flex;
  align-items: center;
`

const SearchInput = styled.input`
  width: 100%;
  box-sizing: border-box;
  padding: 7px 12px 7px 32px;
  border: 1px solid #dce6f0;
  border-radius: 7px;
  font-size: var(--font-size-sm);
  color: #1a2a3a;
  outline: none;
  background: #f8fafc;

  &:focus {
    border-color: #4a90d9;
    background: #ffffff;
  }

  &::placeholder { color: #b0bec5; }
`

const TreeList = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 8px 10px;
`

const NodeRow = styled.div<{ $depth: number; $highlight?: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  padding-left: ${(p) => 8 + p.$depth * 20}px;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
  background: ${(p) => (p.$highlight ? '#f0f6ff' : 'transparent')};

  &:hover { background: ${(p) => (p.$highlight ? '#e8f1ff' : '#f5f8fc')}; }
`

const CheckBox = styled.div<{ $state: 'checked' | 'half' | 'unchecked' }>`
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  border-radius: 3px;
  border: 1.5px solid ${(p) =>
    p.$state !== 'unchecked' ? '#1a56db' : '#b0bec5'};
  background: ${(p) =>
    p.$state === 'checked' ? '#1a56db' : p.$state === 'half' ? '#dbeafe' : '#ffffff'};
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s, border-color 0.12s;
`

const ExpandBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  padding: 0;

  &:hover { background: #e8edf4; color: #304255; }
`

const NodeName = styled.span<{ $isGroup?: boolean }>`
  flex: 1;
  font-size: var(--font-size-sm);
  font-weight: ${(p) => (p.$isGroup ? 600 : 400)};
  color: ${(p) => (p.$isGroup ? '#1a2a3a' : '#304255')};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const EmptyHint = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  font-size: var(--font-size-sm);
  color: #94a3b8;
`

const CardFooter = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-top: 1px solid #e8edf4;
  flex-shrink: 0;
  gap: 8px;
`

const FooterLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`

const FooterRight = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const ClearBtn = styled.button`
  padding: 6px 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #7a91a8;
  font-size: var(--font-size-xs);
  cursor: pointer;
  &:hover { background: #f0f4fa; color: #304255; }
`

const CancelBtn = styled.button`
  padding: 6px 14px;
  border: 1px solid #dce6f0;
  border-radius: 7px;
  background: #ffffff;
  color: #304255;
  font-size: var(--font-size-sm);
  font-weight: 500;
  cursor: pointer;
  &:hover { background: #f0f4fa; }
`

const ApplyBtn = styled.button`
  padding: 6px 18px;
  border: none;
  border-radius: 7px;
  background: #1a56db;
  color: #ffffff;
  font-size: var(--font-size-sm);
  font-weight: 600;
  cursor: pointer;
  &:hover { background: #1649c7; }
`

const SelectedCount = styled.span`
  font-size: var(--font-size-xs);
  color: #6b84a0;
`

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildChildrenMap(departments: Department[]): Map<string, Department[]> {
  const map = new Map<string, Department[]>()
  for (const dept of departments) {
    const key = dept.parentId ?? ''
    const list = map.get(key) ?? []
    list.push(dept)
    map.set(key, list)
  }
  return map
}

function getLeafDescendants(id: string, childrenMap: Map<string, Department[]>): string[] {
  const children = childrenMap.get(id) ?? []
  if (children.length === 0) return [id]
  return children.flatMap((c) => getLeafDescendants(c.id, childrenMap))
}

type CheckState = 'checked' | 'half' | 'unchecked'

function computeCheckState(
  id: string,
  selectedSet: Set<string>,
  childrenMap: Map<string, Department[]>,
): CheckState {
  const leaves = getLeafDescendants(id, childrenMap)
  const selectedLeaves = leaves.filter((l) => selectedSet.has(l))
  if (selectedLeaves.length === 0) return 'unchecked'
  if (selectedLeaves.length === leaves.length) return 'checked'
  return 'half'
}

function matchesSearch(name: string, query: string): boolean {
  return name.toLowerCase().includes(query.toLowerCase())
}

// Returns ids of nodes visible after search filter (including ancestors to show tree path)
function getVisibleIds(
  departments: Department[],
  childrenMap: Map<string, Department[]>,
  query: string,
): Set<string> | null {
  if (!query.trim()) return null // null = show all
  const visible = new Set<string>()

  function visit(dept: Department): boolean {
    const children = childrenMap.get(dept.id) ?? []
    let childMatches = false
    for (const c of children) {
      if (visit(c)) childMatches = true
    }
    const selfMatch = matchesSearch(dept.name, query)
    if (selfMatch || childMatches) {
      visible.add(dept.id)
      return true
    }
    return false
  }

  const roots = departments.filter((d) => !d.parentId)
  for (const r of roots) visit(r)
  return visible
}

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface KnowledgeTreePickerProps {
  departments: Department[]
  selectedIds: string[]
  onApply: (ids: string[]) => void
  onClose: () => void
  title?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export const KnowledgeTreePicker: React.FC<KnowledgeTreePickerProps> = ({
  departments,
  selectedIds,
  onApply,
  onClose,
  title = '选择参考知识库',
}) => {
  const [draft, setDraft] = useState<Set<string>>(() => new Set(selectedIds))
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // Auto-expand parents of currently selected items
    const exp = new Set<string>()
    const parentMap = new Map(departments.map((d) => [d.id, d.parentId]))
    for (const id of selectedIds) {
      let pid = parentMap.get(id)
      while (pid) {
        exp.add(pid)
        pid = parentMap.get(pid)
      }
    }
    return exp
  })
  const [search, setSearch] = useState('')

  const childrenMap = useMemo(() => buildChildrenMap(departments), [departments])
  const rootDepts = useMemo(() => departments.filter((d) => !d.parentId), [departments])
  const visibleIds = useMemo(() => getVisibleIds(departments, childrenMap, search), [departments, childrenMap, search])
  const isSearching = !!search.trim()

  const toggleExpand = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleNode = useCallback(
    (id: string) => {
      const children = childrenMap.get(id) ?? []
      const isGroup = children.length > 0
      const leaves = getLeafDescendants(id, childrenMap)
      const allSelected = leaves.every((l) => draft.has(l))

      setDraft((prev) => {
        const next = new Set(prev)
        if (isGroup) {
          // Toggle all leaves
          if (allSelected) {
            for (const l of leaves) next.delete(l)
          } else {
            for (const l of leaves) next.add(l)
          }
        } else {
          // Leaf toggle
          if (next.has(id)) next.delete(id)
          else next.add(id)
        }
        return next
      })
    },
    [childrenMap, draft],
  )

  const renderNode = useCallback(
    (dept: Department, depth: number): React.ReactNode => {
      if (visibleIds && !visibleIds.has(dept.id)) return null

      const children = childrenMap.get(dept.id) ?? []
      const isGroup = children.length > 0
      const isExpanded = isSearching || expanded.has(dept.id)
      const checkState = computeCheckState(dept.id, draft, childrenMap)
      const isHighlight = checkState !== 'unchecked'

      return (
        <React.Fragment key={dept.id}>
          <NodeRow $depth={depth} $highlight={isHighlight} onClick={() => toggleNode(dept.id)}>
            {isGroup ? (
              <ExpandBtn
                type="button"
                onClick={(e) => toggleExpand(dept.id, e)}
                title={isExpanded ? '收起' : '展开'}
              >
                {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </ExpandBtn>
            ) : (
              <CheckBox $state={checkState}>
                {checkState === 'checked' && <Check size={10} color="#fff" strokeWidth={3} />}
                {checkState === 'half' && <Minus size={10} color="#1a56db" strokeWidth={3} />}
              </CheckBox>
            )}
            {isGroup && (
              <CheckBox $state={checkState} onClick={(e) => { e.stopPropagation(); toggleNode(dept.id) }}>
                {checkState === 'checked' && <Check size={10} color="#fff" strokeWidth={3} />}
                {checkState === 'half' && <Minus size={10} color="#1a56db" strokeWidth={3} />}
              </CheckBox>
            )}
            <NodeName $isGroup={isGroup}>{dept.name}</NodeName>
          </NodeRow>

          {isExpanded && isGroup && children.map((c) => renderNode(c, depth + 1))}
        </React.Fragment>
      )
    },
    [visibleIds, childrenMap, isSearching, expanded, draft, toggleNode, toggleExpand],
  )

  const handleApply = () => onApply([...draft])
  const handleClear = () => setDraft(new Set())

  const selectedLeafCount = useMemo(() => {
    // Count only leaf nodes in selection (exclude implicit parents)
    return [...draft].filter((id) => (childrenMap.get(id) ?? []).length === 0).length
  }, [draft, childrenMap])

  return (
    <Overlay onClick={onClose}>
      <Card onClick={(e) => e.stopPropagation()}>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CloseBtn type="button" onClick={onClose} title="关闭">
            <X size={16} />
          </CloseBtn>
        </CardHeader>

        <SearchWrap>
          <SearchIcon><Search size={13} /></SearchIcon>
          <SearchInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索知识库…"
            autoFocus
          />
        </SearchWrap>

        <TreeList>
          {rootDepts.length === 0 ? (
            <EmptyHint>暂无知识库</EmptyHint>
          ) : (
            <>
              {rootDepts.map((d) => renderNode(d, 0))}
              {visibleIds?.size === 0 && <EmptyHint>无匹配结果</EmptyHint>}
            </>
          )}
        </TreeList>

        <CardFooter>
          <FooterLeft>
            <ClearBtn type="button" onClick={handleClear}>清空</ClearBtn>
            <SelectedCount>
              {selectedLeafCount > 0 ? `已选 ${selectedLeafCount} 项` : ''}
            </SelectedCount>
          </FooterLeft>
          <FooterRight>
            <CancelBtn type="button" onClick={onClose}>取消</CancelBtn>
            <ApplyBtn type="button" onClick={handleApply}>确认</ApplyBtn>
          </FooterRight>
        </CardFooter>
      </Card>
    </Overlay>
  )
}
