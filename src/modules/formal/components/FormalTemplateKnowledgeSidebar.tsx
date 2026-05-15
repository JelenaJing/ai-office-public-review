import React, { useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileStack,
  FileText,
  Folder,
  FolderOpen,
  PanelLeftClose,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react'
import { useKnowledge } from '../../../contexts/KnowledgeContext'
import { useWorkspace, type FileTreeNode } from '../../../contexts/WorkspaceContext'
import { useFormalTemplateSession } from '../contexts/FormalTemplateSessionContext'
import { useDocument } from '../../../contexts/DocumentContext'
import { useDocumentEngineHostCommands } from '../../../engines/documentEngine/hostCommands'
import type { KnowledgeDocumentCategory, KnowledgeDocumentMeta, KnowledgeSourceType } from '../../../types/knowledge'
import { KNOWLEDGE_DOCUMENT_CATEGORY_LABELS } from '../../../types/knowledge'

const Panel = styled.div<{ $width: number }>`
  width: ${p => p.$width}px;
  min-width: 240px;
  max-width: 420px;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, #fbfdff 0%, #f4f8fc 100%);
  border-right: 1px solid #dde3ec;
  position: relative;
  color: #304255;
`

const ResizeHandle = styled.div`
  position: absolute;
  top: 0;
  right: -2px;
  width: 4px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;

  &:hover {
    background: #007acc;
  }
`

const Header = styled.div`
  padding: 10px 12px 8px;
  display: grid;
  gap: 8px;
  border-bottom: 1px solid #e1e8f0;
  background: rgba(255, 255, 255, 0.88);
`

const HeaderTop = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
`

const HeaderTitleWrap = styled.div`
  min-width: 0;
  display: grid;
  gap: 4px;
`

const HeaderTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--font-size-sm);
  font-weight: 800;
  letter-spacing: 0.04em;
`

const HeaderDesc = styled.div`
  font-size: var(--font-size-xs);
  line-height: 1.5;
  color: #627385;
`

const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
`

const IconButton = styled.button`
  width: 28px;
  height: 28px;
  border: 1px solid #d6e1ec;
  border-radius: 8px;
  background: #ffffff;
  color: #5e7389;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: #eef4fb;
    color: #243447;
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`

const SearchWrap = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  border: 1px solid #d6e1ec;
  border-radius: 10px;
  background: #ffffff;
  padding: 0 10px;
`

const SearchInput = styled.input`
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: #243447;
  font-size: var(--font-size-xs);
  outline: none;

  &::placeholder {
    color: #93a2b1;
  }
`

const FilterRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`

const FilterChip = styled.button<{ $active?: boolean }>`
  min-height: 28px;
  border-radius: 999px;
  border: 1px solid ${({ $active }) => ($active ? '#aecaeb' : '#d7e2ed')};
  background: ${({ $active }) => ($active ? '#edf6ff' : '#ffffff')};
  color: ${({ $active }) => ($active ? '#16476f' : '#607487')};
  padding: 0 11px;
  font-size: var(--font-size-xs);
  font-weight: 700;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: ${({ $active }) => ($active ? '#e5f1fe' : '#f5f9fd')};
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`

const Content = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
`

const StatusCard = styled.div`
  border: 1px solid #dce6f1;
  border-radius: 14px;
  background: linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(243,248,255,0.92) 100%);
  padding: 12px;
  display: grid;
  gap: 8px;
`

const StatusCardTitle = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 800;
  letter-spacing: 0.06em;
  color: #6d8196;
`

const CurrentTemplateName = styled.div`
  font-size: 15px;
  font-weight: 800;
  line-height: 1.35;
  color: #173457;
  word-break: break-word;
`

const StatusRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`

const StatusToken = styled.span<{ $tone?: 'ready' | 'pending' | 'warning' }>`
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid ${({ $tone }) => ($tone === 'ready' ? '#c6e6d0' : $tone === 'warning' ? '#f2d7a2' : '#d7e3ef')};
  background: ${({ $tone }) => ($tone === 'ready' ? '#f2fbf5' : $tone === 'warning' ? '#fff8eb' : '#f5f9fd')};
  color: ${({ $tone }) => ($tone === 'ready' ? '#2f7a4a' : $tone === 'warning' ? '#95650e' : '#5c7287')};
  font-size: var(--font-size-xs);
  font-weight: 800;
`

const StatusGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
`

const StatusMetaCard = styled.div`
  border: 1px solid #e3ebf3;
  border-radius: 10px;
  background: #ffffff;
  padding: 8px;
  display: grid;
  gap: 4px;
`

const StatusMetaLabel = styled.div`
  font-size: var(--font-size-xs);
  color: #7d90a4;
`

const StatusMetaValue = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 700;
  color: #173457;
  word-break: break-word;
`

const Section = styled.section`
  border: 1px solid #e0e8f1;
  border-radius: 14px;
  background: rgba(255,255,255,0.94);
  padding: 10px;
  display: grid;
  gap: 8px;
`

const SectionHead = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`

const SectionTitle = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 800;
  letter-spacing: 0.06em;
  color: #6d8196;
`

const SectionMeta = styled.div`
  font-size: var(--font-size-xs);
  color: #8a9caf;
`

const EmptyState = styled.div`
  border: 1px dashed #d3ddeb;
  border-radius: 12px;
  background: #fbfdff;
  padding: 12px;
  font-size: var(--font-size-xs);
  line-height: 1.7;
  color: #6a7e90;
`

const SelectedSummary = styled.div`
  border: 1px solid #e3ebf3;
  border-radius: 12px;
  background: #fbfdff;
  padding: 10px;
  display: grid;
  gap: 8px;
`

const SelectedList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`

const SelectedPill = styled.button`
  min-height: 28px;
  border-radius: 999px;
  border: 1px solid #d8e2ed;
  background: #ffffff;
  color: #4b6278;
  padding: 0 10px;
  font-size: var(--font-size-xs);
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;

  &:hover {
    background: #f4f8fc;
  }
`

const SelectedHint = styled.div`
  font-size: var(--font-size-xs);
  line-height: 1.6;
  color: #708396;
`

const GroupWrap = styled.div`
  display: grid;
  gap: 10px;
`

const GroupBlock = styled.div`
  display: grid;
  gap: 8px;
`

const GroupTitle = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 700;
  color: #4e6478;
`

const CardList = styled.div`
  display: grid;
  gap: 8px;
`

const TemplateCard = styled.div<{ $selected?: boolean }>`
  border: 1px solid ${({ $selected }) => ($selected ? '#b7d4f0' : '#e0e8f1')};
  border-radius: 12px;
  background: ${({ $selected }) => ($selected ? 'linear-gradient(180deg, #f4f9ff 0%, #eaf3ff 100%)' : '#ffffff')};
  padding: 10px;
  display: grid;
  gap: 8px;
`

const TemplateMain = styled.button`
  width: 100%;
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  text-align: left;
  display: grid;
  gap: 6px;
`

const TemplateTitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
`

const TemplateTitle = styled.div`
  min-width: 0;
  flex: 1;
  font-size: var(--font-size-xs);
  font-weight: 800;
  color: #233648;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

const TemplateSummary = styled.div`
  font-size: var(--font-size-xs);
  line-height: 1.55;
  color: #617487;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
`

const MetaRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`

const MetaChip = styled.span<{ $accent?: boolean }>`
  min-height: 19px;
  display: inline-flex;
  align-items: center;
  padding: 0 7px;
  border-radius: 999px;
  border: 1px solid ${({ $accent }) => ($accent ? '#bcd7f3' : '#dde7f0')};
  background: ${({ $accent }) => ($accent ? '#eaf4ff' : '#f6f9fc')};
  color: ${({ $accent }) => ($accent ? '#17456d' : '#607487')};
  font-size: var(--font-size-xs);
  font-weight: 700;
`

const CardActions = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`

const InlineActions = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
`

const InlineButton = styled.button<{ $primary?: boolean }>`
  min-height: 28px;
  border-radius: 9px;
  border: 1px solid ${({ $primary }) => ($primary ? '#a7caeb' : '#d7e2ed')};
  background: ${({ $primary }) => ($primary ? '#edf6ff' : '#ffffff')};
  color: ${({ $primary }) => ($primary ? '#16476f' : '#607487')};
  padding: 0 10px;
  font-size: var(--font-size-xs);
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: ${({ $primary }) => ($primary ? '#e5f1fe' : '#f5f9fd')};
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`

const Footer = styled.div`
  padding: 10px;
  border-top: 1px solid #e1e8f0;
  background: rgba(255,255,255,0.92);
  display: grid;
  gap: 8px;
`

const FooterActions = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
`

const FooterButton = styled.button`
  min-height: 34px;
  border-radius: 10px;
  border: 1px solid #d8e2ed;
  background: #ffffff;
  color: #4b6278;
  font-size: var(--font-size-xs);
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: #f4f8fc;
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`

const Drawer = styled.div<{ $open: boolean }>`
  display: ${({ $open }) => ($open ? 'grid' : 'none')};
  gap: 8px;
  border-top: 1px solid #e1e8f0;
  background: #ffffff;
  padding: 10px;
`

const DrawerHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`

const DrawerTitle = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 800;
  letter-spacing: 0.06em;
  color: #6d8196;
`

const TreeScroll = styled.div`
  max-height: 260px;
  overflow: auto;
  border: 1px solid #e3ebf3;
  border-radius: 12px;
  background: #fbfdff;
`

const TreeRow = styled.div<{ $depth: number; $active?: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 10px 0 ${({ $depth }) => 10 + $depth * 16}px;
  background: ${({ $active }) => ($active ? '#eaf3ff' : 'transparent')};
  cursor: pointer;

  &:hover {
    background: ${({ $active }) => ($active ? '#eaf3ff' : '#f3f8fe')};
  }
`

const TreeName = styled.div`
  min-width: 0;
  flex: 1;
  font-size: var(--font-size-xs);
  color: #304255;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

const TreeHint = styled.div`
  font-size: var(--font-size-xs);
  color: #73879a;
  line-height: 1.6;
`

interface FormalTemplateKnowledgeSidebarProps {
  onCollapse?: () => void
}

type FormalTemplateDocumentFilter = 'all-documents' | 'all-templates' | KnowledgeSourceType

const FORMAL_TEMPLATE_FILTER_OPTIONS: Array<{ value: FormalTemplateDocumentFilter; label: string }> = [
  { value: 'all-documents', label: '全部文档' },
  { value: 'all-templates', label: '全部模板' },
  { value: 'pdf', label: 'PDF' },
  { value: 'docx', label: 'DOCX' },
  { value: 'doc', label: 'DOC' },
  { value: 'md', label: 'Markdown' },
  { value: 'txt', label: 'TXT' },
  { value: 'image', label: '图片' },
]

const SOURCE_TYPE_LABELS: Record<KnowledgeSourceType, string> = {
  pdf: 'PDF',
  docx: 'DOCX',
  doc: 'DOC',
  pptx: 'PPTX',
  txt: 'TXT',
  md: 'Markdown',
  image: '图片',
}

function formatTime(value?: string): string {
  const text = String(value || '').replace('T', ' ')
  return text ? text.slice(0, 16) : '暂无记录'
}

function normalizeTemplateType(document: KnowledgeDocumentMeta | null): string {
  if (!document) return '未指定'
  const category = document.documentCategory || 'other'
  if (category === 'contract') return 'table_form'
  if (category === 'letter') return 'letter_template'
  return `${category}_template`
}

function buildGroupLabel(category?: KnowledgeDocumentCategory): string {
  const label = KNOWLEDGE_DOCUMENT_CATEGORY_LABELS[category || 'other'] || '其他'
  return `${label}类`
}

function getTemplateStatus(
  document: KnowledgeDocumentMeta | null,
  profileDocumentId: string | undefined,
  requiredFieldCount: number,
  confirmedFieldCount: number,
): { label: string; tone: 'ready' | 'pending' | 'warning' } {
  if (!document) return { label: '未选择模板', tone: 'pending' }
  if (!isFormalTemplateCandidate(document)) return { label: '模板格式不支持', tone: 'warning' }
  if (document.extractionStatus === 'failed') return { label: '抽取失败', tone: 'warning' }
  if (document.extractionStatus === 'pending') return { label: '抽取中', tone: 'pending' }
  if (profileDocumentId !== document.id) return { label: '未分析', tone: 'pending' }
  if (requiredFieldCount > confirmedFieldCount) return { label: '缺少字段', tone: 'warning' }
  return { label: '可生成', tone: 'ready' }
}

function buildOutputDirectoryPath(activeWorkspacePath: string | null, outputPath: string | null): string {
  const normalizedOutput = String(outputPath || '').trim()
  if (normalizedOutput) {
    const segments = normalizedOutput.split(/[\\/]/)
    segments.pop()
    return segments.join('/')
  }
  return activeWorkspacePath || ''
}

function matchesTemplateSearch(document: KnowledgeDocumentMeta, query: string): boolean {
  const keyword = query.trim().toLowerCase()
  if (!keyword) return true
  const haystack = [
    document.title,
    document.originalName,
    document.previewText,
    document.categoryDetail,
    document.documentCategory ? KNOWLEDGE_DOCUMENT_CATEGORY_LABELS[document.documentCategory] : '',
  ].join(' ').toLowerCase()
  return haystack.includes(keyword)
}

function isFormalTemplateCandidate(document: KnowledgeDocumentMeta): boolean {
  return document.sourceType === 'doc' || document.sourceType === 'docx'
}

function isReferenceCandidate(document: KnowledgeDocumentMeta): boolean {
  return document.sourceType === 'pdf'
    || document.sourceType === 'docx'
    || document.sourceType === 'doc'
    || document.sourceType === 'md'
    || document.sourceType === 'txt'
}

function matchesDocumentFilter(
  document: KnowledgeDocumentMeta,
  filter: FormalTemplateDocumentFilter,
  listKind: 'template' | 'reference',
): boolean {
  const isAllowed = listKind === 'template'
    ? isFormalTemplateCandidate(document)
    : isReferenceCandidate(document)
  if (!isAllowed) return false
  if (filter === 'all-documents') return true
  if (filter === 'all-templates') return isFormalTemplateCandidate(document)
  return document.sourceType === filter
}

function compareTemplatePriority(left: KnowledgeDocumentMeta, right: KnowledgeDocumentMeta, templateDocumentId: string | null): number {
  const leftScore = (templateDocumentId === left.id ? 1000 : 0) + (left.lastUsedAsTemplateAt ? 100 : 0) + left.templateUsageCount
  const rightScore = (templateDocumentId === right.id ? 1000 : 0) + (right.lastUsedAsTemplateAt ? 100 : 0) + right.templateUsageCount
  if (leftScore !== rightScore) return rightScore - leftScore
  return String(right.importedAt || '').localeCompare(String(left.importedAt || ''))
}

function compareReferencePriority(
  left: KnowledgeDocumentMeta,
  right: KnowledgeDocumentMeta,
  selectedReferenceIds: Set<string>,
): number {
  const leftScore = (selectedReferenceIds.has(left.id) ? 1000 : 0) + (left.lastUsedAsTemplateAt ? 20 : 0)
  const rightScore = (selectedReferenceIds.has(right.id) ? 1000 : 0) + (right.lastUsedAsTemplateAt ? 20 : 0)
  if (leftScore !== rightScore) return rightScore - leftScore
  return String(right.importedAt || '').localeCompare(String(left.importedAt || ''))
}

function countFiles(nodes: FileTreeNode[]): number {
  return nodes.reduce((count, node) => count + (node.type === 'file' ? 1 : 0) + (node.children ? countFiles(node.children) : 0), 0)
}

function ReadonlyTreeNode({ node, depth, onOpenFile }: { node: FileTreeNode; depth: number; onOpenFile: (path: string) => void }) {
  const [expanded, setExpanded] = useState(depth === 0)

  if (node.type === 'folder') {
    return (
      <>
        <TreeRow $depth={depth} onClick={() => setExpanded((prev) => !prev)}>
          {expanded ? <ChevronDown size={14} color="#708396" /> : <ChevronRight size={14} color="#708396" />}
          {expanded ? <FolderOpen size={14} color="#d1a85f" /> : <Folder size={14} color="#d1a85f" />}
          <TreeName>{node.name}</TreeName>
        </TreeRow>
        {expanded ? (node.children || []).map((child) => (
          <ReadonlyTreeNode key={child.path} node={child} depth={depth + 1} onOpenFile={onOpenFile} />
        )) : null}
      </>
    )
  }

  return (
    <TreeRow $depth={depth} onClick={() => onOpenFile(node.path)}>
      <span style={{ width: 14, flexShrink: 0 }} />
      <FileText size={14} color="#5f7892" />
      <TreeName>{node.name}</TreeName>
    </TreeRow>
  )
}

export default function FormalTemplateKnowledgeSidebar({ onCollapse }: FormalTemplateKnowledgeSidebarProps) {
  const {
    documents,
    query,
    loading,
    templateDocumentId,
    referenceDocumentIds,
    setQuery,
    refresh,
    openDocument,
    selectReferenceDocuments,
    toggleReferenceDocument,
    unselectReferenceDocuments,
    setTemplateDocument,
  } = useKnowledge()
  const {
    activeWorkspacePath,
    activeWorkspaceName,
    fileTreeData,
    refreshTree,
    registerWorkspace,
    openWorkspace,
  } = useWorkspace()
  const { setStatusMessage } = useDocument()
  const { openDocumentPath, openKnowledgeDocumentPreview } = useDocumentEngineHostCommands()
  const { profile, fieldValues, commitResult, phase, statusMessage } = useFormalTemplateSession()
  const [panelWidth, setPanelWidth] = useState(300)
  const [workspaceDrawerOpen, setWorkspaceDrawerOpen] = useState(false)
  const [documentFilter, setDocumentFilter] = useState<FormalTemplateDocumentFilter>('all-documents')

  useEffect(() => {
    if (!templateDocumentId || !referenceDocumentIds.includes(templateDocumentId)) return
    unselectReferenceDocuments([templateDocumentId])
  }, [referenceDocumentIds, templateDocumentId, unselectReferenceDocuments])

  const effectiveReferenceDocumentIds = useMemo(
    () => referenceDocumentIds.filter((documentId) => documentId !== templateDocumentId),
    [referenceDocumentIds, templateDocumentId],
  )

  const selectedReferenceIdSet = useMemo(
    () => new Set(effectiveReferenceDocumentIds),
    [effectiveReferenceDocumentIds],
  )

  const templateDocuments = useMemo(() => {
    return documents
      .filter((item) => matchesTemplateSearch(item, query))
      .filter((item) => matchesDocumentFilter(item, documentFilter, 'template'))
      .sort((left, right) => compareTemplatePriority(left, right, templateDocumentId))
  }, [documentFilter, documents, query, templateDocumentId])

  const referenceDocuments = useMemo(() => {
    return documents
      .filter((item) => item.id !== templateDocumentId)
      .filter((item) => matchesTemplateSearch(item, query))
      .filter((item) => matchesDocumentFilter(item, documentFilter, 'reference'))
      .sort((left, right) => compareReferencePriority(left, right, selectedReferenceIdSet))
  }, [documentFilter, documents, query, selectedReferenceIdSet, templateDocumentId])

  const currentTemplate = useMemo(() => {
    return documents.find((item) => item.id === templateDocumentId)
      || null
  }, [documents, templateDocumentId])

  const selectedReferenceDocuments = useMemo(() => {
    return documents
      .filter((item) => selectedReferenceIdSet.has(item.id))
      .sort((left, right) => compareReferencePriority(left, right, selectedReferenceIdSet))
  }, [documents, selectedReferenceIdSet])

  const groupedTemplates = useMemo(() => {
    const groupMap = new Map<string, KnowledgeDocumentMeta[]>()
    for (const document of templateDocuments) {
      const key = buildGroupLabel(document.documentCategory)
      const current = groupMap.get(key) || []
      current.push(document)
      groupMap.set(key, current)
    }
    return Array.from(groupMap.entries()).sort((left, right) => left[0].localeCompare(right[0], 'zh-CN'))
  }, [templateDocuments])

  const requiredFieldCount = useMemo(() => {
    return profile?.fields.filter((field) => field.required).length || 0
  }, [profile])

  const confirmedFieldCount = useMemo(() => {
    if (!profile) return 0
    const valueMap = new Map(fieldValues.map((item) => [item.fieldId, item]))
    return profile.fields.filter((field) => field.required && Boolean(valueMap.get(field.fieldId)?.value?.trim())).length
  }, [fieldValues, profile])

  const currentTemplateStatus = useMemo(() => {
    return getTemplateStatus(currentTemplate, profile?.knowledgeDocumentId, requiredFieldCount, confirmedFieldCount)
  }, [confirmedFieldCount, currentTemplate, profile?.knowledgeDocumentId, requiredFieldCount])

  const outputDirectoryPath = useMemo(
    () => buildOutputDirectoryPath(activeWorkspacePath, commitResult?.outputPath || null),
    [activeWorkspacePath, commitResult?.outputPath],
  )
  const fileCount = useMemo(() => countFiles(fileTreeData), [fileTreeData])

  const handleResize = (event: React.MouseEvent) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = panelWidth
    const onMove = (moveEvent: MouseEvent) => {
      setPanelWidth(Math.max(240, Math.min(420, startWidth + moveEvent.clientX - startX)))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const handleSelectTemplate = (document: KnowledgeDocumentMeta) => {
    if (!isFormalTemplateCandidate(document)) {
      setStatusMessage(`“${document.title}”不是 DOC/DOCX，不能直接作为正式模板，但仍可加入本轮资料。`)
      return
    }
    setTemplateDocument(document.id)
    if (referenceDocumentIds.includes(document.id)) {
      unselectReferenceDocuments([document.id])
    }
    setStatusMessage(`已将“${document.title}”设为当前模板`)
  }

  const handleClearTemplate = () => {
    if (!templateDocumentId) {
      setStatusMessage('当前还没有指定模板')
      return
    }
    setTemplateDocument(null)
    setStatusMessage('已清空当前模板')
  }

  const handleToggleReference = (document: KnowledgeDocumentMeta) => {
    if (!isReferenceCandidate(document)) {
      setStatusMessage(`“${document.title}”当前不支持加入正式模板资料。`)
      return
    }
    if (document.id === templateDocumentId) {
      setStatusMessage('当前模板不计入本轮资料；如需作为资料，请先改选其他模板。')
      return
    }
    toggleReferenceDocument(document.id)
    setStatusMessage(selectedReferenceIdSet.has(document.id) ? `已将“${document.title}”移出本轮资料` : `已将“${document.title}”加入本轮资料`)
  }

  const handleOpenExternal = async (targetPath: string, successMessage: string, failurePrefix: string) => {
    const normalizedPath = String(targetPath || '').trim()
    if (!normalizedPath) {
      setStatusMessage(`${failurePrefix}：路径不存在`)
      return
    }
    const opened = await window.electronAPI.openExternalFile(normalizedPath)
    if (!opened.success) {
      setStatusMessage(`${failurePrefix}：${opened.error || '未知错误'}`)
      return
    }
    setStatusMessage(successMessage)
  }

  const handleOpenProject = async () => {
    const selectedPath = await window.electronAPI.openDirectoryDialog()
    if (!selectedPath) {
      setStatusMessage('已取消打开项目')
      return
    }
    const registeredPath = await registerWorkspace(selectedPath)
    if (!registeredPath) {
      setStatusMessage('打开项目失败：未能注册该目录')
      return
    }
    await openWorkspace(registeredPath)
    setWorkspaceDrawerOpen(true)
    setStatusMessage(`已打开项目：${registeredPath.split(/[\\/]/).pop() || registeredPath}`)
  }

  const handleOpenOutputDirectory = async () => {
    if (!activeWorkspacePath) {
      setStatusMessage('当前没有工作区，请先打开项目。')
      return
    }
    const successMessage = commitResult?.outputPath
      ? '已打开输出目录。'
      : '当前还没有生成结果，已打开项目目录。'
    await handleOpenExternal(outputDirectoryPath, successMessage, '打开输出目录失败')
  }

  const handleOpenLatestResult = async () => {
    if (!commitResult?.outputPath) {
      setStatusMessage('当前还没有历史生成结果，请先完成一次正式模板生成。')
      return
    }
    await handleOpenExternal(commitResult.outputPath, '已打开最近生成文稿。', '打开最近生成文稿失败')
  }

  const handleToggleWorkspaceDrawer = async () => {
    if (!activeWorkspacePath) {
      setStatusMessage('当前没有工作区，请先打开项目。')
      return
    }
    await refreshTree()
    setWorkspaceDrawerOpen((prev) => !prev)
    setStatusMessage(workspaceDrawerOpen ? '已收起工作区文件。' : '已展开工作区文件。')
  }

  const handleOpenWorkspaceFile = async (filePath: string) => {
    try {
      await openDocumentPath(filePath)
      setStatusMessage(`已打开工作区文件：${filePath.split(/[\\/]/).pop() || filePath}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      setStatusMessage(`打开工作区文件失败：${message}`)
    }
  }

  const handleOpenKnowledgePreview = async (document: KnowledgeDocumentMeta) => {
    try {
      await openDocument(document.id)
      await openKnowledgeDocumentPreview(document.id)
      setStatusMessage(`已只读打开资料：${document.title}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      setStatusMessage(`打开资料失败：${message}`)
    }
  }

  const templateEmptyMessage = documentFilter === 'all-documents' || documentFilter === 'all-templates'
    ? '当前没有可直接作为正式模板的 DOC / DOCX 文档。正式模板只接受 DOC / DOCX；PDF、Markdown、TXT 等仍可加入本轮资料。'
    : `当前筛选类型下没有可直接作为正式模板的文档。正式模板只接受 DOC / DOCX。`

  const referenceEmptyMessage = documentFilter === 'image'
    ? '图片筛选已生效，但正式模板本轮资料当前仅接收 PDF / DOCX / DOC / Markdown / TXT 文档。'
    : '当前筛选条件下没有可加入本轮的资料文件。可以切换类型筛选，或清空搜索词。'

  if (!activeWorkspacePath) {
    return (
      <Panel $width={panelWidth}>
        <ResizeHandle onMouseDown={handleResize} />
        <Header>
          <HeaderTop>
            <HeaderTitleWrap>
              <HeaderTitle><Sparkles size={14} /> 知识库模板区</HeaderTitle>
              <HeaderDesc>正式模板会把左侧主任务切到模板选择，但落地生成仍需要先进入一个工作区。</HeaderDesc>
            </HeaderTitleWrap>
            {onCollapse ? <HeaderActions><IconButton onClick={onCollapse} title="收起左栏"><PanelLeftClose size={14} /></IconButton></HeaderActions> : null}
          </HeaderTop>
        </Header>
        <Content>
          <EmptyState>当前还没有打开工作区。先返回上一步选择或创建工作区，再在这里把知识库文档设为正式模板。</EmptyState>
          <InlineButton type="button" onClick={() => void handleOpenProject()}>
            <FolderOpen size={12} /> 打开工作区
          </InlineButton>
        </Content>
      </Panel>
    )
  }

  return (
    <Panel $width={panelWidth} data-testid="formal-template-knowledge-sidebar">
      <ResizeHandle onMouseDown={handleResize} />
      <Header>
        <HeaderTop>
          <HeaderTitleWrap>
            <HeaderTitle><Sparkles size={14} /> 知识库模板区</HeaderTitle>
            <HeaderDesc>正式模板模式把左侧主任务切到模板选择；文件树改为辅助入口，避免和中右侧结果面板重复抢占空间。</HeaderDesc>
          </HeaderTitleWrap>
          <HeaderActions>
            <IconButton onClick={() => void refresh()} title="刷新模板列表" disabled={loading}>
              <RefreshCw size={14} />
            </IconButton>
            {onCollapse ? <IconButton onClick={onCollapse} title="收起左栏"><PanelLeftClose size={14} /></IconButton> : null}
          </HeaderActions>
        </HeaderTop>
        <SearchWrap>
          <Search size={14} color="#708396" />
          <SearchInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索模板名称、类别或说明..."
          />
        </SearchWrap>
        <FilterRow>
          {FORMAL_TEMPLATE_FILTER_OPTIONS.map((option) => (
            <FilterChip
              key={option.value}
              type="button"
              $active={documentFilter === option.value}
              onClick={() => setDocumentFilter(option.value)}
            >
              {option.label}
            </FilterChip>
          ))}
        </FilterRow>
      </Header>

      <Content>
        <StatusCard>
          <StatusCardTitle>当前模板信息</StatusCardTitle>
          <CurrentTemplateName>{currentTemplate?.title || '还没有指定模板'}</CurrentTemplateName>
          <StatusRow>
            <StatusToken $tone={currentTemplateStatus.tone}>状态：{currentTemplateStatus.label}</StatusToken>
            <StatusToken $tone={phase === 'completed' ? 'ready' : phase === 'error' ? 'warning' : 'pending'}>
              当前阶段：{phase}
            </StatusToken>
            <StatusToken $tone={selectedReferenceDocuments.length > 0 ? 'ready' : 'pending'}>
              本轮资料：{selectedReferenceDocuments.length} 份
            </StatusToken>
          </StatusRow>
          <StatusGrid>
            <StatusMetaCard>
              <StatusMetaLabel>模板类型</StatusMetaLabel>
              <StatusMetaValue>{normalizeTemplateType(currentTemplate)}</StatusMetaValue>
            </StatusMetaCard>
            <StatusMetaCard>
              <StatusMetaLabel>模板分组</StatusMetaLabel>
              <StatusMetaValue>{buildGroupLabel(currentTemplate?.documentCategory)}</StatusMetaValue>
            </StatusMetaCard>
            <StatusMetaCard>
              <StatusMetaLabel>项目</StatusMetaLabel>
              <StatusMetaValue>{activeWorkspaceName || '未打开'}</StatusMetaValue>
            </StatusMetaCard>
            <StatusMetaCard>
              <StatusMetaLabel>字段完成度</StatusMetaLabel>
              <StatusMetaValue>{requiredFieldCount > 0 ? `${confirmedFieldCount}/${requiredFieldCount}` : '自动推断'}</StatusMetaValue>
            </StatusMetaCard>
          </StatusGrid>
          <InlineActions>
            <InlineButton type="button" onClick={() => currentTemplate && void handleOpenKnowledgePreview(currentTemplate)} disabled={!currentTemplate}>
              只读打开
            </InlineButton>
            <InlineButton type="button" onClick={handleClearTemplate} disabled={!currentTemplate}>
              清空模板
            </InlineButton>
          </InlineActions>
          {statusMessage ? <TemplateSummary>{statusMessage}</TemplateSummary> : null}
        </StatusCard>

        <Section>
          <SectionHead>
            <SectionTitle>模板列表</SectionTitle>
            <SectionMeta>{templateDocuments.length} 个可直接设为模板</SectionMeta>
          </SectionHead>
          {groupedTemplates.length === 0 ? (
            <EmptyState>{templateEmptyMessage}</EmptyState>
          ) : (
            <GroupWrap>
              {groupedTemplates.map(([groupLabel, groupDocuments]) => (
                <GroupBlock key={groupLabel}>
                  <GroupTitle>{groupLabel}</GroupTitle>
                  <CardList>
                    {groupDocuments.map((document) => {
                      const selected = templateDocumentId === document.id
                      const includedAsReference = referenceDocumentIds.includes(document.id)
                      return (
                        <TemplateCard key={document.id} $selected={selected}>
                          <TemplateMain type="button" onClick={() => handleSelectTemplate(document)}>
                            <TemplateTitleRow>
                              <FileText size={14} color="#59728c" />
                              <TemplateTitle title={document.title}>{document.title}</TemplateTitle>
                              {selected ? <MetaChip $accent>当前模板</MetaChip> : null}
                            </TemplateTitleRow>
                            <MetaRow>
                              <MetaChip>{SOURCE_TYPE_LABELS[document.sourceType]}</MetaChip>
                              <MetaChip>{normalizeTemplateType(document)}</MetaChip>
                              <MetaChip>{document.categoryDetail || KNOWLEDGE_DOCUMENT_CATEGORY_LABELS[document.documentCategory || 'other']}</MetaChip>
                              <MetaChip>{formatTime(document.importedAt)}</MetaChip>
                            </MetaRow>
                            <TemplateSummary>{document.previewText?.trim() || document.originalName || '暂无模板摘要，点击可直接设为当前模板。'}</TemplateSummary>
                          </TemplateMain>
                          <CardActions>
                            <InlineActions>
                              <InlineButton type="button" $primary={!selected} onClick={() => handleSelectTemplate(document)}>
                                <Sparkles size={12} /> {selected ? '当前模板' : '设为模板'}
                              </InlineButton>
                              <InlineButton type="button" onClick={() => handleToggleReference(document)} disabled={selected}>
                                <BookOpen size={12} /> {selected ? '当前模板' : includedAsReference ? '移出本轮' : '加入本轮'}
                              </InlineButton>
                            </InlineActions>
                            <InlineButton type="button" onClick={() => void handleOpenKnowledgePreview(document)}>
                              只读打开
                            </InlineButton>
                          </CardActions>
                        </TemplateCard>
                      )
                    })}
                  </CardList>
                </GroupBlock>
              ))}
            </GroupWrap>
          )}
        </Section>

        <Section>
          <SectionHead>
            <SectionTitle>本轮资料</SectionTitle>
            <SectionMeta>{selectedReferenceDocuments.length} 已选 / {referenceDocuments.length} 可选</SectionMeta>
          </SectionHead>

          <SelectedSummary>
            <SelectedHint>当前模板由单独的 currentTemplate 状态管理；本轮资料由 selectedReferenceFiles 多选状态管理，两者不再混用。</SelectedHint>
            {selectedReferenceDocuments.length > 0 ? (
              <SelectedList>
                {selectedReferenceDocuments.map((document) => (
                  <SelectedPill key={document.id} type="button" onClick={() => handleToggleReference(document)}>
                    <BookOpen size={12} />
                    {document.title}
                    <MetaChip>{SOURCE_TYPE_LABELS[document.sourceType]}</MetaChip>
                  </SelectedPill>
                ))}
              </SelectedList>
            ) : (
              <EmptyState>当前还没有加入任何资料文件。你现在可以保留 1 个当前模板，同时勾选多个 PDF / DOCX / DOC / Markdown / TXT 资料。</EmptyState>
            )}
          </SelectedSummary>

          {referenceDocuments.length === 0 ? (
            <EmptyState>{referenceEmptyMessage}</EmptyState>
          ) : (
            <CardList>
              {referenceDocuments.map((document) => {
                const selected = selectedReferenceIdSet.has(document.id)
                return (
                  <TemplateCard key={document.id} $selected={selected}>
                    <TemplateMain type="button" onClick={() => void handleOpenKnowledgePreview(document)}>
                      <TemplateTitleRow>
                        <FileText size={14} color="#59728c" />
                        <TemplateTitle title={document.title}>{document.title}</TemplateTitle>
                        {selected ? <MetaChip $accent>已加入本轮</MetaChip> : null}
                      </TemplateTitleRow>
                      <MetaRow>
                        <MetaChip>{SOURCE_TYPE_LABELS[document.sourceType]}</MetaChip>
                        <MetaChip>{document.categoryDetail || KNOWLEDGE_DOCUMENT_CATEGORY_LABELS[document.documentCategory || 'other']}</MetaChip>
                        <MetaChip>{formatTime(document.importedAt)}</MetaChip>
                      </MetaRow>
                      <TemplateSummary>{document.previewText?.trim() || document.originalName || '暂无资料摘要。'}</TemplateSummary>
                    </TemplateMain>
                    <CardActions>
                      <InlineActions>
                        <InlineButton type="button" $primary={!selected} onClick={() => handleToggleReference(document)}>
                          <BookOpen size={12} /> {selected ? '移出本轮' : '加入本轮资料'}
                        </InlineButton>
                        {isFormalTemplateCandidate(document) ? (
                          <InlineButton type="button" onClick={() => handleSelectTemplate(document)}>
                            <Sparkles size={12} /> 设为模板
                          </InlineButton>
                        ) : null}
                      </InlineActions>
                      <InlineButton type="button" onClick={() => void handleOpenKnowledgePreview(document)}>
                        只读打开
                      </InlineButton>
                    </CardActions>
                  </TemplateCard>
                )
              })}
            </CardList>
          )}
        </Section>
      </Content>

      <Footer>
        <FooterActions>
          <FooterButton onClick={() => void handleOpenOutputDirectory()}>
            <FolderOpen size={14} /> 打开输出目录
          </FooterButton>
          <FooterButton onClick={() => void handleOpenLatestResult()}>
            <FileStack size={14} /> 查看历史生成结果
          </FooterButton>
          <FooterButton onClick={() => void handleOpenProject()}>
            <Folder size={14} /> 打开项目
          </FooterButton>
          <FooterButton onClick={() => void handleToggleWorkspaceDrawer()}>
            <Folder size={14} /> {workspaceDrawerOpen ? '收起工作区文件' : '查看工作区文件'}
          </FooterButton>
        </FooterActions>
      </Footer>

      <Drawer $open={workspaceDrawerOpen}>
        <DrawerHeader>
          <DrawerTitle>工作区文件（辅助入口）</DrawerTitle>
          <InlineActions>
            <InlineButton type="button" onClick={() => void refreshTree()}>
              <RefreshCw size={12} /> 刷新
            </InlineButton>
          </InlineActions>
        </DrawerHeader>
        <TreeHint>文件树在正式模板模式下被降级为辅助入口，避免与中右侧的预览、结果和导出操作重复争夺左侧主区域。</TreeHint>
        <TreeHint>当前工作区包含 {fileCount} 个文件，点击条目可直接打开。</TreeHint>
        <TreeScroll>
          {fileTreeData.length === 0 ? (
            <EmptyState>当前工作区还没有文件。正式模板生成完成后，文稿和中间产物会出现在输出目录或工作区内。</EmptyState>
          ) : fileTreeData.map((node) => (
            <ReadonlyTreeNode key={node.path} node={node} depth={0} onOpenFile={(filePath) => void handleOpenWorkspaceFile(filePath)} />
          ))}
        </TreeScroll>
      </Drawer>
    </Panel>
  )
}