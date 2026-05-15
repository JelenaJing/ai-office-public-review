import React, { useCallback, useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { Check, ChevronDown, ChevronRight, FileText, Image as ImageIcon } from 'lucide-react'
import { useDepartment } from '../contexts/DepartmentContext'
import type { Department, KnowledgeDocumentMeta } from '../types/knowledge'

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const ListWrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const DeptRow = styled.div<{ $selected?: boolean; $depth?: number }>`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  padding-left: ${(p) => 10 + (p.$depth ?? 0) * 18}px;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
  background: ${(p) => (p.$selected ? '#eef4ff' : 'transparent')};

  &:hover {
    background: ${(p) => (p.$selected ? '#e4edff' : '#f0f4fa')};
  }
`

const Checkbox = styled.div<{ $checked?: boolean }>`
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  border: 1.5px solid ${(p) => (p.$checked ? '#1a56db' : '#b0bec5')};
  border-radius: 3px;
  background: ${(p) => (p.$checked ? '#1a56db' : '#ffffff')};
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, border-color 0.15s;
`

const DeptName = styled.span`
  flex: 1;
  font-size: var(--font-size-sm);
  color: #1a1a1a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const FileCountBadge = styled.span`
  font-size: var(--font-size-xs);
  color: #708396;
  flex-shrink: 0;
`

const ExpandBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #708396;
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;

  &:hover {
    background: #e4ecf5;
    color: #304255;
  }
`

const FilePanel = styled.div<{ $depth?: number }>`
  margin-left: ${(p) => 24 + (p.$depth ?? 0) * 18}px;
  padding-left: 10px;
  border-left: 2px solid #e4ecf5;
  margin-bottom: 4px;
`

const FileRow = styled.div<{ $clickable?: boolean; $active?: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  font-size: var(--font-size-xs);
  color: ${(p) => (p.$active ? '#1a56db' : '#304255')};
  background: ${(p) => (p.$active ? '#eef4ff' : 'transparent')};
  cursor: ${(p) => (p.$clickable ? 'pointer' : 'default')};
  border-radius: 4px;

  &:hover {
    background: ${(p) => (p.$clickable ? (p.$active ? '#e4edff' : '#f0f4fa') : 'transparent')};
  }
`

const FileName = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
`

const FileHint = styled.div`
  padding: 4px 8px;
  font-size: var(--font-size-xs);
  color: #94a3b8;
`

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FilesCache {
  docs: KnowledgeDocumentMeta[]
  loading: boolean
}

function getFileIcon(title: string) {
  const ext = (title.split('.').pop() || '').toLowerCase()
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) {
    return <ImageIcon size={12} color="#708396" />
  }
  return <FileText size={12} color="#708396" />
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface DepartmentSelectorProps {
  /** Controlled departments list — when provided, bypasses useDepartment() */
  departments?: Department[]
  /** Controlled selected department ID */
  selectedDepartmentId?: string
  /** Controlled selection callback */
  onSelectDepartment?: (id: string) => void
  /** When provided, file rows become clickable and trigger this callback */
  onFileClick?: (deptId: string, docId: string) => void
  /** Highlight the file row matching this document ID */
  activeFileId?: string | null
}

export const DepartmentSelector: React.FC<DepartmentSelectorProps> = (props) => {
  const deptCtx = useDepartment()

  // Use controlled props when provided, falling back to DepartmentContext
  const departments = props.departments ?? deptCtx.departments
  const selectedDepartmentId = props.selectedDepartmentId ?? deptCtx.selectedDepartmentId
  const selectDepartment = props.onSelectDepartment ?? deptCtx.selectDepartment

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [filesMap, setFilesMap] = useState<Record<string, FilesCache>>({})
  const prevSelectedRef = useRef(selectedDepartmentId)

  // Auto-expand on checkbox select & auto-collapse on deselect (only in clickable / reading mode)
  useEffect(() => {
    if (!props.onFileClick) return
    const prev = prevSelectedRef.current
    prevSelectedRef.current = selectedDepartmentId

    if (selectedDepartmentId && selectedDepartmentId !== prev) {
      // auto-expand newly selected
      setExpandedIds((s) => {
        if (s.has(selectedDepartmentId)) return s
        const next = new Set(s)
        next.add(selectedDepartmentId)
        return next
      })
      // lazy-load files if not cached
      if (!filesMap[selectedDepartmentId]) {
        setFilesMap((p) => ({ ...p, [selectedDepartmentId]: { docs: [], loading: true } }))
        window.electronAPI.listKnowledgeDocuments(selectedDepartmentId)
          .then((docs: KnowledgeDocumentMeta[]) => setFilesMap((p) => ({ ...p, [selectedDepartmentId]: { docs, loading: false } })))
          .catch(() => setFilesMap((p) => ({ ...p, [selectedDepartmentId]: { docs: [], loading: false } })))
      }
    } else if (!selectedDepartmentId && prev) {
      // auto-collapse deselected
      setExpandedIds((s) => {
        if (!s.has(prev)) return s
        const next = new Set(s)
        next.delete(prev)
        return next
      })
    }
  }, [selectedDepartmentId, props.onFileClick, filesMap])

  const handleCheckboxClick = useCallback((id: string) => {
    selectDepartment(selectedDepartmentId === id ? '' : id)
  }, [selectDepartment, selectedDepartmentId])

  const handleToggleExpand = useCallback(async (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
    // Load files on first expand
    if (!filesMap[id] && !expandedIds.has(id)) {
      setFilesMap((prev) => ({ ...prev, [id]: { docs: [], loading: true } }))
      try {
        const docs: KnowledgeDocumentMeta[] = await window.electronAPI.listKnowledgeDocuments(id)
        setFilesMap((prev) => ({ ...prev, [id]: { docs, loading: false } }))
      } catch {
        setFilesMap((prev) => ({ ...prev, [id]: { docs: [], loading: false } }))
      }
    }
  }, [filesMap, expandedIds])

  // Build tree: group departments by parentId
  const childrenMap = React.useMemo(() => {
    const map = new Map<string, Department[]>()
    for (const dept of departments) {
      const parentKey = dept.parentId || ''
      const list = map.get(parentKey) || []
      list.push(dept)
      map.set(parentKey, list)
    }
    return map
  }, [departments])

  const hasChildren = useCallback((id: string) => {
    return (childrenMap.get(id) || []).length > 0
  }, [childrenMap])

  // Collapsed group headers (parent departments)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  const toggleGroupCollapse = useCallback((id: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
  }, [])

  const renderDeptNode = useCallback((dept: Department, depth: number): React.ReactNode => {
    const isSelected = dept.id === selectedDepartmentId
    const isExpanded = expandedIds.has(dept.id)
    const cache = filesMap[dept.id]
    const isGroup = hasChildren(dept.id)
    const isCollapsed = collapsedGroups.has(dept.id)
    const children = childrenMap.get(dept.id) || []

    return (
      <React.Fragment key={dept.id}>
        <DeptRow $selected={isSelected} $depth={depth}>
          {isGroup ? (
            /* Group header: chevron toggle, no checkbox */
            <>
              <ExpandBtn
                type="button"
                onClick={(e) => { e.stopPropagation(); toggleGroupCollapse(dept.id) }}
                title={isCollapsed ? '展开分组' : '收起分组'}
              >
                {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              </ExpandBtn>
              <DeptName onClick={() => toggleGroupCollapse(dept.id)} style={{ fontWeight: 600 }}>{dept.name}</DeptName>
            </>
          ) : (
            /* Leaf node: checkbox + file expand */
            <>
              <Checkbox $checked={isSelected} onClick={() => handleCheckboxClick(dept.id)}>
                {isSelected && <Check size={11} color="#ffffff" strokeWidth={3} />}
              </Checkbox>
              <DeptName onClick={() => handleCheckboxClick(dept.id)}>{dept.name}</DeptName>
              <ExpandBtn
                type="button"
                onClick={(e) => { e.stopPropagation(); void handleToggleExpand(dept.id) }}
                title={isExpanded ? '收起文件列表' : '展开文件列表'}
              >
                {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </ExpandBtn>
            </>
          )}
        </DeptRow>

        {/* Leaf node: file list */}
        {!isGroup && isExpanded && (
          <FilePanel $depth={depth}>
            {cache?.loading ? (
              <FileHint>加载中...</FileHint>
            ) : !cache || cache.docs.length === 0 ? (
              <FileHint>暂无文档</FileHint>
            ) : (
              cache.docs.map((doc) => (
                <FileRow
                  key={doc.id}
                  $clickable={!!props.onFileClick}
                  $active={props.activeFileId === doc.id}
                  onClick={props.onFileClick ? () => props.onFileClick!(dept.id, doc.id) : undefined}
                >
                  {getFileIcon(doc.title || doc.originalName || '')}
                  <FileName title={doc.title || doc.originalName}>
                    {doc.title || doc.originalName || doc.id}
                  </FileName>
                </FileRow>
              ))
            )}
          </FilePanel>
        )}

        {/* Group node: render children */}
        {isGroup && !isCollapsed && children.map((child) => renderDeptNode(child, depth + 1))}
      </React.Fragment>
    )
  }, [selectedDepartmentId, expandedIds, filesMap, hasChildren, collapsedGroups, childrenMap, toggleGroupCollapse, handleCheckboxClick, handleToggleExpand, props.onFileClick, props.activeFileId])

  // Render root nodes (those without parentId)
  const rootDepts = React.useMemo(() => {
    return departments.filter((d) => !d.parentId)
  }, [departments])

  return (
    <ListWrapper>
      {rootDepts.map((dept) => renderDeptNode(dept, 0))}
    </ListWrapper>
  )
}
