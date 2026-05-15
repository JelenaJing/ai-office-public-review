import React, { useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'
import {
  BookOpen,
  Check,
  FileStack,
  FileText,
  Image as ImageIcon,
  RefreshCw,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { useKnowledge } from '../../../contexts/KnowledgeContext'
import { useGenerationWorkbench } from '../../../contexts/GenerationWorkbenchContext'
import { useFormalTemplateSession } from '../../formal/contexts/FormalTemplateSessionContext'
import { useWorkspace } from '../../../contexts/WorkspaceContext'
import { useDocument } from '../../../contexts/DocumentContext'
import { useDocumentEngineHostCommands } from '../../../engines/documentEngine/hostCommands'
import { openKnowledgeWorkspaceDraft } from '../services/knowledgeWorkspace'
import { DepartmentSelector } from '../../../components/DepartmentSelector'
import { toDisplayUrl as toSharedDisplayUrl } from '../../../shared/url/fileUrlHelper'
import type { KnowledgeDocumentMeta, KnowledgeSourceType } from '../../../types/knowledge'
import { KNOWLEDGE_DOCUMENT_CATEGORY_LABELS } from '../../../types/knowledge'

const DockWrap = styled.div<{ $embedded?: boolean }>`
  flex: ${p => p.$embedded ? '1 1 auto' : '0 0 320px'};
  width: ${p => p.$embedded ? '100%' : 'auto'};
  height: ${p => p.$embedded ? '100%' : 'auto'};
  min-height: 0;
  border-top: ${p => p.$embedded ? 'none' : '1px solid #dce5ef'};
  background: linear-gradient(180deg, #fbfdff 0%, #f3f8fd 100%);
  color: #233648;
  display: flex;
  flex-direction: column;
  overflow-x: hidden;
  overflow-y: ${p => p.$embedded ? 'hidden' : 'auto'};
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: rgba(110, 135, 164, 0.45) rgba(148, 167, 190, 0.12);

  &::-webkit-scrollbar {
    width: 8px;
  }

  &::-webkit-scrollbar-track {
    background: rgba(148, 167, 190, 0.1);
    border-radius: 999px;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(110, 135, 164, 0.35);
    border-radius: 999px;
    border: 2px solid rgba(248, 251, 255, 0.9);
  }
`

const DockHeader = styled.div`
  padding: 8px 12px 6px;
  display: grid;
  gap: 6px;
  border-bottom: 1px solid #e3ebf3;
  background: rgba(255, 255, 255, 0.88);
`

const HeaderTop = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
`

const TitleWrap = styled.div`
  min-width: 0;
  display: grid;
  gap: 4px;
`

const Title = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--font-size-sm);
  font-weight: 700;
  letter-spacing: 0.04em;
`

const Desc = styled.div`
  font-size: var(--font-size-xs);
  line-height: 1.45;
  color: #607487;
`

const SearchInput = styled.input`
  width: 100%;
  height: 34px;
  border-radius: 10px;
  border: 1px solid #d7e2ed;
  background: #ffffff;
  color: #213346;
  padding: 0 12px;
  outline: none;
  font-size: var(--font-size-xs);

  &::placeholder {
    color: #8b9caf;
  }

  &:focus {
    border-color: #98b7d6;
    box-shadow: 0 0 0 3px rgba(62, 126, 197, 0.1);
  }
`

const ToolbarRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`

const ToolbarCluster = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
`

const ToolbarButton = styled.button<{ $accent?: boolean }>`
  min-height: 28px;
  border-radius: 9px;
  border: 1px solid ${({ $accent }) => ($accent ? '#a8c8ea' : '#dbe5ef')};
  background: ${({ $accent }) => ($accent ? '#edf6ff' : '#ffffff')};
  color: ${({ $accent }) => ($accent ? '#16476f' : '#607487')};
  padding: 0 10px;
  font-size: var(--font-size-xs);
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: ${({ $accent }) => ($accent ? '#e5f1fe' : '#f5f9fd')};
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`

const SortSelect = styled.select`
  min-height: 28px;
  border-radius: 9px;
  border: 1px solid #dbe5ef;
  background: #ffffff;
  color: #35516d;
  padding: 0 10px;
  font-size: var(--font-size-xs);
  font-weight: 700;
  outline: none;
  cursor: pointer;
`

const TypeSelect = styled(SortSelect)`
  min-width: 124px;
`

const ToolbarToggle = styled.button<{ $active?: boolean }>`
  min-height: 28px;
  border-radius: 9px;
  border: 1px solid ${({ $active }) => ($active ? '#9fc5e8' : '#dbe5ef')};
  background: ${({ $active }) => ($active ? '#eaf4ff' : '#ffffff')};
  color: ${({ $active }) => ($active ? '#17456d' : '#607487')};
  padding: 0 10px;
  font-size: var(--font-size-xs);
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: ${({ $active }) => ($active ? '#e3f0ff' : '#f5f9fd')};
  }
  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`

const BannerChipRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`

const BannerChip = styled.span<{ $accent?: boolean }>`
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid ${({ $accent }) => ($accent ? '#bcd7f3' : '#dfe8f1')};
  background: ${({ $accent }) => ($accent ? '#e9f4ff' : '#ffffff')};
  color: ${({ $accent }) => ($accent ? '#17456d' : '#607487')};
  font-size: var(--font-size-xs);
  font-weight: 700;
`

const ScrollList = styled.div`
  flex: 1 1 auto;
  min-height: 140px;
  overflow: auto;
  padding: 8px 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;

  scrollbar-width: thin;
  scrollbar-color: rgba(110, 135, 164, 0.45) rgba(148, 167, 190, 0.12);
`

const Section = styled.div`
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

const DocumentList = styled.div`
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(auto-fill, minmax(182px, 1fr));
  align-items: stretch;
`

const EmptyState = styled.div`
  border-radius: 14px;
  border: 1px dashed #cfdbea;
  background: #ffffff;
  padding: 14px;
  font-size: var(--font-size-xs);
  line-height: 1.75;
  color: #667b8f;
`

const DocumentCard = styled.div<{ $selected?: boolean; $active?: boolean }>`
  border-radius: 12px;
  border: 1px solid ${({ $selected, $active }) => ($selected ? '#bed9f3' : $active ? '#d9e6f4' : '#e2eaf2')};
  background: ${({ $selected, $active }) => ($selected ? 'linear-gradient(180deg, #f4f9ff 0%, #edf5ff 100%)' : $active ? 'linear-gradient(180deg, #fbfdff 0%, #f3f8fd 100%)' : '#ffffff')};
  box-shadow: ${({ $selected }) => ($selected ? '0 4px 12px rgba(33, 90, 148, 0.06)' : 'none')};
  padding: 8px;
  display: grid;
  gap: 8px;
  grid-template-rows: auto auto auto 1fr auto;
  transition: box-shadow 0.15s, border-color 0.15s;
  height: 100%;
`

const DocumentMain = styled.button`
  width: 100%;
  border: none;
  background: transparent;
  padding: 0;
  display: grid;
  gap: 6px;
  cursor: pointer;

  text-align: left;
`

const PreviewSurface = styled.div`
  position: relative;
  min-height: 112px;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid #dde8f2;
  background: linear-gradient(180deg, #f9fcff 0%, #edf4fb 100%);
`

const PreviewSelectionWrap = styled.div`
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 2;
`

const DocumentPreviewPlaceholder = styled.div`
  width: 100%;
  height: 112px;
  display: grid;
  place-items: center;
  gap: 6px;
  color: #6a7f94;
  background: linear-gradient(180deg, #f7fafe 0%, #edf3f9 100%);
`

const PlaceholderLabel = styled.span`
  font-size: var(--font-size-xs);
  font-weight: 800;
  letter-spacing: 0.06em;
`

const SelectToggle = styled.button<{ $selected?: boolean }>`
  width: 22px;
  height: 22px;
  border-radius: 7px;
  border: 1px solid ${({ $selected }) => ($selected ? '#2f6fb0' : '#bfd0e0')};
  background: ${({ $selected }) => ($selected ? '#2f6fb0' : '#ffffff')};
  color: #ffffff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;

  &:hover {
    background: ${({ $selected }) => ($selected ? '#2b679f' : '#f4f8fc')};
  }
`

const DocumentInfo = styled.div`
  min-width: 0;
  display: grid;
  gap: 6px;
`

const DocumentTitleRow = styled.div`
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
`

const DocumentTitle = styled.div`
  min-width: 0;
  font-size: var(--font-size-xs);
  font-weight: 700;
  color: #233648;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

const MetaRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`

const MetaToken = styled.span<{ $tone?: 'ready' | 'pending' | 'failed' }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 18px;
  padding: 0 7px;
  border-radius: 999px;
  border: 1px solid ${({ $tone }) => ($tone === 'ready' ? '#cae6d3' : $tone === 'pending' ? '#e8d8b0' : $tone === 'failed' ? '#efcece' : '#dfe7f0')};
  background: ${({ $tone }) => ($tone === 'ready' ? '#f3fbf6' : $tone === 'pending' ? '#fff9ee' : $tone === 'failed' ? '#fff5f5' : '#f7fafc')};
  color: ${({ $tone }) => ($tone === 'ready' ? '#2e7a48' : $tone === 'pending' ? '#9a6a08' : $tone === 'failed' ? '#b14545' : '#6d8196')};
  font-size: var(--font-size-xs);
  font-weight: 700;
`

const PreviewText = styled.div`
  font-size: var(--font-size-xs);
  line-height: 1.55;
  color: #607487;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
`

const ImagePreviewWrap = styled.div`
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid #dde8f2;
  background: linear-gradient(180deg, #f9fcff 0%, #edf4fb 100%);
`

const ImagePreview = styled.img`
  width: 100%;
  height: 112px;
  object-fit: cover;
  display: block;
`

const Tag = styled.span<{ $accent?: boolean }>`
  display: inline-flex;
  align-items: center;
  min-height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  font-size: var(--font-size-xs);
  font-weight: 700;
  letter-spacing: 0.04em;
  color: ${p => p.$accent ? '#173457' : '#607487'};
  background: ${p => p.$accent ? '#dff0ff' : '#f5f8fb'};
  border: 1px solid ${p => p.$accent ? '#c5e0f8' : '#dfe7f0'};
`

const CategoryTag = styled.span`
  display: inline-flex;
  align-items: center;
  min-height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  color: #5e4b08;
  background: #fef9e7;
  border: 1px solid #f5e6a3;
`

const StatusDot = styled.span<{ $tone: 'ready' | 'pending' | 'failed' }>`
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: ${({ $tone }) => ($tone === 'ready' ? '#3b9f62' : $tone === 'pending' ? '#d09a2d' : '#d06262')};
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.95);
  flex-shrink: 0;
`

const DocumentActions = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
`

const TextActionButton = styled.button<{ $active?: boolean; $danger?: boolean }>`
  min-height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid ${p => p.$danger ? '#efc4c4' : p.$active ? '#9fc8ef' : '#d7e2ed'};
  background: ${p => p.$danger ? '#fff5f5' : p.$active ? '#ebf5ff' : '#ffffff'};
  color: ${p => p.$danger ? '#b14545' : p.$active ? '#1d5b92' : '#607487'};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-xs);
  font-weight: 700;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: ${p => p.$danger ? '#ffeaea' : p.$active ? '#e5f1fe' : '#f4f8fc'};
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`

const Footer = styled.div`
  padding: 10px 12px;
  border-top: 1px solid #e3ebf3;
  background: rgba(255, 255, 255, 0.88);
`

const FooterActions = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
`

const FooterButton = styled.button`
  width: 100%;
  min-height: 34px;
  border-radius: 8px;
  border: 1px solid #d7e2ed;
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

const ContextMenu = styled.div`
  position: fixed;
  z-index: 3000;
  min-width: 180px;
  border-radius: 12px;
  border: 1px solid rgba(222, 234, 248, 0.9);
  background: rgba(10, 27, 59, 0.96);
  box-shadow: 0 16px 44px rgba(4, 11, 24, 0.32);
  padding: 6px;
  display: grid;
  gap: 4px;
`

const ContextItem = styled.button<{ $danger?: boolean }>`
  min-height: 34px;
  border-radius: 8px;
  border: none;
  background: ${({ $danger }) => ($danger ? 'rgba(125, 18, 18, 0.18)' : 'transparent')};
  color: ${({ $danger }) => ($danger ? '#ffd6d6' : '#f4f8ff')};
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  font-size: var(--font-size-xs);
  font-weight: 700;
  cursor: pointer;
  text-align: left;

  &:hover:not(:disabled) {
    background: ${({ $danger }) => ($danger ? 'rgba(160, 27, 27, 0.3)' : 'rgba(255,255,255,0.12)')};
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`

const ContextDivider = styled.div`
  height: 1px;
  background: rgba(255,255,255,0.12);
  margin: 4px 0;
`

interface ContextMenuState {
  x: number
  y: number
  documentId: string
}

type ViewMode = 'all' | 'selected'
type SourceFilter = 'all' | KnowledgeSourceType
type SortMode = 'recent' | 'oldest' | 'name'

function formatImportedTime(value?: string): string {
  const text = String(value || '').replace('T', ' ')
  return text ? text.slice(0, 16) : '未知时间'
}

function sourceTypeLabel(type: KnowledgeSourceType): string {
  if (type === 'image') return '图片'
  if (type === 'pdf') return 'PDF'
  if (type === 'pptx') return 'PPTX'
  if (type === 'doc' || type === 'docx') return 'Word'
  if (type === 'md') return 'Markdown'
  return '文本'
}

function extractionStatusLabel(status: KnowledgeDocumentMeta['extractionStatus'], sourceType?: KnowledgeSourceType): string {
  if (sourceType === 'image') return '已入库'
  if (status === 'ready') return '已抽取'
  if (status === 'pending') return '抽取中'
  return '抽取失败'
}

function resolveStoredFilePath(rootPath?: string, relativePath?: string): string {
  const base = String(rootPath || '').replace(/[\\/]+$/, '')
  const relative = String(relativePath || '').replace(/^[\\/]+/, '')
  if (!base) return relative
  if (!relative) return base
  return `${base}/${relative}`
}

function toDisplayUrl(rawPath?: string): string {
  return rawPath ? toSharedDisplayUrl(rawPath) : ''
}

function compareDocuments(left: KnowledgeDocumentMeta, right: KnowledgeDocumentMeta, sortMode: SortMode): number {
  if (sortMode === 'name') {
    const nameResult = left.title.localeCompare(right.title, 'zh-CN')
    if (nameResult !== 0) return nameResult
    return String(right.importedAt || '').localeCompare(String(left.importedAt || ''))
  }

  const dateResult = String(left.importedAt || '').localeCompare(String(right.importedAt || ''))
  if (sortMode === 'oldest') {
    if (dateResult !== 0) return dateResult
    return left.title.localeCompare(right.title, 'zh-CN')
  }

  if (dateResult !== 0) return -dateResult
  return left.title.localeCompare(right.title, 'zh-CN')
}

interface KnowledgeSelectionDockProps {
  embedded?: boolean
  clearDocumentResultOnReset?: boolean
}

const KnowledgeSelectionDock: React.FC<KnowledgeSelectionDockProps> = ({
  embedded = false,
  clearDocumentResultOnReset = false,
}) => {
  const {
    info,
    documents,
    query,
    loading,
    importing,
    activeDocumentId,
    referenceDocumentIds,
    styleImageDocumentIds,
    templateDocumentId,
    departmentId,
    setQuery,
    refresh,
    importDocuments,
    openDocument,
    toggleReferenceDocument,
    selectReferenceDocuments,
    selectStyleImageDocuments,
    unselectReferenceDocuments,
    toggleStyleImageDocument,
    unselectStyleImageDocuments,
    setTemplateDocument,
    clearSelections,
    deleteDocument,
  } = useKnowledge()
  const { clearCurrentResult, removeDocumentFromSessions } = useGenerationWorkbench()
  const { setCommitResult } = useFormalTemplateSession()
  const { openWorkspace, refreshTree } = useWorkspace()
  const { setStatusMessage } = useDocument()
  const { openDocumentPath, openKnowledgeDocumentPreview } = useDocumentEngineHostCommands()
  const [materializingId, setMaterializingId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('all')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [sortMode, setSortMode] = useState<SortMode>('recent')

  const selectedKnowledgeDocumentIds = useMemo(() => {
    const ids = new Set(referenceDocumentIds)
    if (templateDocumentId) ids.add(templateDocumentId)
    return ids
  }, [referenceDocumentIds, templateDocumentId])

  const selectedDocumentIds = useMemo(() => {
    const ids = new Set(selectedKnowledgeDocumentIds)
    styleImageDocumentIds.forEach((id) => ids.add(id))
    return ids
  }, [selectedKnowledgeDocumentIds, styleImageDocumentIds])

  const templateLabel = useMemo(() => {
    if (!templateDocumentId) return '未指定，生成时将使用首个勾选文档作为模板'
    const matched = documents.find((item) => item.id === templateDocumentId)
    return matched?.title || '当前模板已不在筛选结果中'
  }, [documents, templateDocumentId])

  const visibleDocuments = useMemo(() => {
    const filtered = documents.filter((item) => {
      if (viewMode === 'selected' && !selectedDocumentIds.has(item.id)) return false
      if (sourceFilter !== 'all' && item.sourceType !== sourceFilter) return false
      return true
    })

    return filtered.sort((left, right) => compareDocuments(left, right, sortMode))
  }, [documents, selectedDocumentIds, sortMode, sourceFilter, viewMode])

  const visibleReferenceIds = useMemo(() => visibleDocuments.map((item) => item.id), [visibleDocuments])

  const visibleTextReferenceIds = useMemo(() => visibleDocuments.filter((item) => item.sourceType !== 'image').map((item) => item.id), [visibleDocuments])

  const visibleStyleReferenceIds = useMemo(() => visibleDocuments.filter((item) => item.sourceType === 'image').map((item) => item.id), [visibleDocuments])

  const allVisibleSelected = useMemo(() => {
    if (visibleReferenceIds.length === 0) return false
    return visibleDocuments.every((item) => item.sourceType === 'image'
      ? styleImageDocumentIds.includes(item.id)
      : referenceDocumentIds.includes(item.id))
  }, [referenceDocumentIds, styleImageDocumentIds, visibleDocuments, visibleReferenceIds.length])

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
    }
  }, [contextMenu])

  const handleImport = async () => {
    const result = await importDocuments().catch(() => null)
    if (!result || result.canceled) return
    if (result.imported.length === 1 && result.imported[0].sourceType === 'pdf') {
      setMaterializingId(result.imported[0].id)
      try {
        await openKnowledgeWorkspaceDraft({
          departmentId,
          documentId: result.imported[0].id,
          workspaceName: result.imported[0].title,
          fileName: result.imported[0].title,
          sourceDocumentIds: [result.imported[0].id],
          openWorkspace,
          openDocumentPath,
          refreshTree,
          setStatusMessage,
        })
      } finally {
        setMaterializingId(null)
      }
    }
  }

  const handleCreateWorkspace = async (documentId: string) => {
    const matched = documents.find((item) => item.id === documentId)
    if (!matched) return
    setMaterializingId(documentId)
    try {
      await openKnowledgeWorkspaceDraft({
        departmentId,
        documentId,
        workspaceName: matched.title,
        fileName: matched.title,
        sourceDocumentIds: [documentId],
        openWorkspace,
        openDocumentPath,
        refreshTree,
        setStatusMessage,
      })
    } finally {
      setMaterializingId(null)
    }
  }

  const handleDeleteDocument = async (documentId: string) => {
    const matched = documents.find((item) => item.id === documentId)
    if (!matched) return
    const confirmed = window.confirm(`确认从知识库移除“${matched.title}”吗？`)
    if (!confirmed) return
    try {
      await deleteDocument(documentId)
      removeDocumentFromSessions(documentId)
      setStatusMessage(`已从知识库移除：${matched.title}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      setStatusMessage(`删除失败：${message}`)
      window.alert(`删除“${matched.title}”失败：${message}`)
    }
  }

  const handleOpenKnowledgePreview = async (document: KnowledgeDocumentMeta) => {
    try {
      await openDocument(document.id)
      await openKnowledgeDocumentPreview(document.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      setStatusMessage(`打开资料预览失败：${message}`)
    }
  }

  const handleTemplateToggle = (documentId: string, selected: boolean) => {
    if (!selected) {
      toggleReferenceDocument(documentId)
    }
    setTemplateDocument(templateDocumentId === documentId ? null : documentId)
  }

  const handleSelectionToggle = (documentId: string) => {
    if (templateDocumentId === documentId && selectedDocumentIds.has(documentId)) {
      setTemplateDocument(null)
    }
    toggleReferenceDocument(documentId)
  }

  const handleToggleVisibleSelection = () => {
    if (visibleReferenceIds.length === 0) return
    if (allVisibleSelected) {
      unselectReferenceDocuments(visibleTextReferenceIds)
      unselectStyleImageDocuments(visibleStyleReferenceIds)
      if (templateDocumentId && visibleTextReferenceIds.includes(templateDocumentId)) {
        setTemplateDocument(null)
      }
      setStatusMessage(`已取消当前结果中的 ${visibleReferenceIds.length} 项选择`)
      return
    }
    selectReferenceDocuments(visibleTextReferenceIds)
    selectStyleImageDocuments(visibleStyleReferenceIds)
    setStatusMessage(`已勾选当前结果中的 ${visibleReferenceIds.length} 项资料 / 风格图`)
  }

  const handleResetFilters = () => {
    setQuery('')
    setViewMode('all')
    setSourceFilter('all')
    setSortMode('recent')
  }

  const handleClearSelections = () => {
    clearSelections()
    if (clearDocumentResultOnReset) {
      setCommitResult(null)
      clearCurrentResult()
    }
    setStatusMessage('已清空本轮模板、资料与风格图选择')
  }

  const renderDocumentCard = (document: KnowledgeDocumentMeta) => {
    const isImage = document.sourceType === 'image'
    const selected = isImage ? styleImageDocumentIds.includes(document.id) : selectedKnowledgeDocumentIds.has(document.id)
    const isTemplate = templateDocumentId === document.id
    const statusTone = document.extractionStatus === 'ready' ? 'ready' : document.extractionStatus === 'pending' ? 'pending' : 'failed'
    const previewText = document.extractionStatus === 'failed' && document.errorMessage
      ? `抽取失败：${document.errorMessage}`
      : document.previewText?.trim() || document.originalName || '当前还没有可展示摘要，点击可打开详情。'
    const imagePreviewUrl = isImage ? toDisplayUrl(resolveStoredFilePath(info?.rootPath, document.storedRelativePath)) : ''

    return (
      <DocumentCard
        key={document.id}
        $selected={selected}
        $active={activeDocumentId === document.id}
        data-knowledge-document-id={document.id}
        data-testid={`knowledge-document-card-${document.id}`}
        onContextMenu={(event) => {
          event.preventDefault()
          setContextMenu({ x: event.clientX, y: event.clientY, documentId: document.id })
        }}
      >
        <PreviewSurface>
          <PreviewSelectionWrap>
            <SelectToggle
              type="button"
              $selected={selected}
              title={isImage ? (selected ? '取消风格参考' : '勾选为风格参考') : (selected ? '取消勾选参考资料' : '勾选为参考资料')}
              onClick={(event) => {
                event.stopPropagation()
                if (isImage) {
                  toggleStyleImageDocument(document.id)
                  return
                }
                handleSelectionToggle(document.id)
              }}
            >
              {selected ? <Check size={14} /> : null}
            </SelectToggle>
          </PreviewSelectionWrap>
          {isImage && imagePreviewUrl ? (
            <ImagePreviewWrap>
              <ImagePreview src={imagePreviewUrl} alt={document.title} loading="lazy" />
            </ImagePreviewWrap>
          ) : (
            <DocumentPreviewPlaceholder>
              <FileText size={24} />
              <PlaceholderLabel>{sourceTypeLabel(document.sourceType)}</PlaceholderLabel>
            </DocumentPreviewPlaceholder>
          )}
        </PreviewSurface>
        <DocumentMain type="button" onClick={() => void handleOpenKnowledgePreview(document)}>
          <DocumentInfo>
            <DocumentTitleRow>
              {isImage ? <ImageIcon size={14} style={{ flexShrink: 0, color: '#5e7892' }} /> : <FileText size={14} style={{ flexShrink: 0, color: '#5e7892' }} />}
              <DocumentTitle title={document.title}>{document.title}</DocumentTitle>
              {isTemplate ? <Tag $accent>模板</Tag> : null}
              {isImage ? <Tag $accent>风格图</Tag> : null}
              {document.documentCategory && document.documentCategory !== 'other' ? (
                <CategoryTag title={document.categoryDetail || KNOWLEDGE_DOCUMENT_CATEGORY_LABELS[document.documentCategory]}>
                  {document.categoryDetail || KNOWLEDGE_DOCUMENT_CATEGORY_LABELS[document.documentCategory]}
                </CategoryTag>
              ) : null}
            </DocumentTitleRow>
            <MetaRow>
              <MetaToken>{sourceTypeLabel(document.sourceType)}</MetaToken>
              <MetaToken $tone={statusTone}>
                <StatusDot $tone={statusTone} />
                {extractionStatusLabel(document.extractionStatus, document.sourceType)}
              </MetaToken>
              {document.extractedTextLength > 0 ? <MetaToken>{document.extractedTextLength.toLocaleString()} 字</MetaToken> : null}
              <MetaToken>{formatImportedTime(document.importedAt)}</MetaToken>
            </MetaRow>
            <PreviewText>{previewText}</PreviewText>
          </DocumentInfo>
        </DocumentMain>
        <DocumentActions>
          <BannerChipRow>
            {isImage
              ? (selected ? <BannerChip $accent>已加入本轮参考</BannerChip> : <BannerChip>默认勾选动作为加入参考</BannerChip>)
              : (selected ? <BannerChip $accent>已加入本轮参考</BannerChip> : <BannerChip>默认勾选动作为加入参考</BannerChip>)}
          </BannerChipRow>
          {isImage ? (
            <>
              <TextActionButton
                type="button"
                $active={selected}
                title={selected ? '取消参考' : '加入参考'}
                onClick={(event) => {
                  event.stopPropagation()
                  toggleStyleImageDocument(document.id)
                }}
              >
                加入参考
              </TextActionButton>
              <TextActionButton
                type="button"
                $danger
                title="删除当前文档"
                onClick={(event) => {
                  event.stopPropagation()
                  void handleDeleteDocument(document.id)
                }}
              >
                删除
              </TextActionButton>
            </>
          ) : (
            <>
              <TextActionButton
                type="button"
                $active={isTemplate}
                title={isTemplate ? '取消模板' : '设为模板'}
                aria-label={`${isTemplate ? '取消模板' : '设为模板'}：${document.title}`}
                data-testid={`knowledge-template-toggle-${document.id}`}
                onClick={(event) => {
                  event.stopPropagation()
                  handleTemplateToggle(document.id, selected)
                }}
              >
                设为模板
              </TextActionButton>
              <TextActionButton
                type="button"
                $active={selected}
                title={selected ? '取消参考' : '加入参考'}
                onClick={(event) => {
                  event.stopPropagation()
                  handleSelectionToggle(document.id)
                }}
              >
                加入参考
              </TextActionButton>
              <TextActionButton
                type="button"
                $danger
                title="删除当前文档"
                onClick={(event) => {
                  event.stopPropagation()
                  void handleDeleteDocument(document.id)
                }}
              >
                删除
              </TextActionButton>
            </>
          )}
        </DocumentActions>
      </DocumentCard>
    )
  }

  const noDataText = useMemo(() => {
    if ((info?.documentCount || 0) === 0) {
      return '这里还没有知识文档。点击底部导入按钮，把 PDF、Word、Markdown 或图片加入知识库后，就可以把它们作为写作模板、参考资料或风格参考。'
    }
    if (viewMode === 'selected') {
      return '当前还没有勾选任何资料或风格图。切回“全部文档”后，点击每行左侧方框即可加入本轮选择。'
    }
    return '没有找到匹配的知识文档。可以清空搜索词，或切换来源筛选查看全部资料和风格图。'
  }, [info?.documentCount, viewMode])

  return (
    <DockWrap $embedded={embedded}>
      <DepartmentSelector />
      <DockHeader>
        <HeaderTop>
          <TitleWrap>
            <Title><BookOpen size={14} /> 知识库</Title>
            <Desc>统一浏览文档与图片素材。默认勾选动作是加入参考，需要时可把任意文档直接设为本轮模板。</Desc>
          </TitleWrap>
        </HeaderTop>
        <SearchInput
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索知识文档、参考资料或风格图..."
        />
        <ToolbarRow>
          <ToolbarCluster>
            <ToolbarToggle $active={viewMode === 'all'} onClick={() => setViewMode('all')}>全部文档</ToolbarToggle>
            <ToolbarToggle $active={viewMode === 'selected'} onClick={() => setViewMode('selected')}>仅看已选</ToolbarToggle>
            <ToolbarButton $accent onClick={handleToggleVisibleSelection} disabled={visibleReferenceIds.length === 0}>
              <Check size={13} /> {allVisibleSelected ? '取消当前结果' : '全选当前结果'}
            </ToolbarButton>
            <ToolbarButton onClick={handleResetFilters} disabled={!query && viewMode === 'all' && sourceFilter === 'all' && sortMode === 'recent'}>
              <RotateCcw size={13} /> 清空筛选
            </ToolbarButton>
          </ToolbarCluster>
          <ToolbarCluster>
            <SectionMeta>类型</SectionMeta>
            <TypeSelect value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as KnowledgeSourceType | 'all')}>
              <option value="all">全部类型</option>
              <option value="pdf">PDF</option>
              <option value="docx">DOCX</option>
              <option value="doc">DOC</option>
              <option value="pptx">PPTX</option>
              <option value="md">Markdown</option>
              <option value="txt">TXT</option>
              <option value="image">图片</option>
            </TypeSelect>
            <SectionMeta>排序</SectionMeta>
            <SortSelect value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
              <option value="recent">最近导入</option>
              <option value="oldest">最早导入</option>
              <option value="name">按名称</option>
            </SortSelect>
          </ToolbarCluster>
        </ToolbarRow>
      </DockHeader>

      <ScrollList aria-label="知识库资料列表，可滚动浏览">
        <Section>
          <SectionHead>
            <SectionTitle>{viewMode === 'selected' ? '本轮已选资料 / 风格图' : '资料与图片列表'}</SectionTitle>
            <SectionMeta>
              {templateDocumentId ? `模板：${templateLabel}` : '未设置模板'}
            </SectionMeta>
          </SectionHead>
          {visibleDocuments.length === 0 ? (
            <EmptyState>{noDataText}</EmptyState>
          ) : (
            <DocumentList>{visibleDocuments.map((item) => renderDocumentCard(item))}</DocumentList>
          )}
        </Section>
      </ScrollList>

      <Footer>
        <FooterActions>
          <FooterButton onClick={() => void handleImport()} disabled={importing}>
            <FileStack size={14} /> {importing ? '导入中' : '导入资料'}
          </FooterButton>
          <FooterButton onClick={() => void refresh()} disabled={loading || importing}>
            <RefreshCw size={14} /> 刷新
          </FooterButton>
          <FooterButton onClick={handleClearSelections} disabled={selectedDocumentIds.size === 0 && !templateDocumentId}>
            <BookOpen size={14} /> 清空本轮
          </FooterButton>
        </FooterActions>
      </Footer>

      {contextMenu ? (() => {
        const matched = documents.find((item) => item.id === contextMenu.documentId)
        if (!matched) return null
        const isImage = matched.sourceType === 'image'
        const selected = isImage ? styleImageDocumentIds.includes(matched.id) : selectedKnowledgeDocumentIds.has(matched.id)
        const isTemplate = templateDocumentId === matched.id
        return (
          <ContextMenu style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}>
            <ContextItem onClick={() => { void handleOpenKnowledgePreview(matched); setContextMenu(null) }}>只读打开</ContextItem>
            <ContextItem onClick={() => {
              if (isImage) {
                toggleStyleImageDocument(matched.id)
              } else {
                handleSelectionToggle(matched.id)
              }
              setContextMenu(null)
            }}>{isImage ? (selected ? '取消风格参考' : '勾选为风格参考') : (selected ? '取消勾选参考' : '勾选为参考')}</ContextItem>
            {!isImage ? <ContextItem onClick={() => { handleTemplateToggle(matched.id, selected); setContextMenu(null) }}>{isTemplate ? '取消模板' : '设为模板'}</ContextItem> : null}
            {!isImage ? <ContextItem disabled={materializingId === matched.id || matched.extractionStatus !== 'ready'} onClick={() => { void handleCreateWorkspace(matched.id); setContextMenu(null) }}>新建文章</ContextItem> : null}
            <ContextDivider />
            <ContextItem $danger onClick={() => { void handleDeleteDocument(matched.id); setContextMenu(null) }}><Trash2 size={14} /> 删除文档</ContextItem>
          </ContextMenu>
        )
      })() : null}
    </DockWrap>
  )
}

export default KnowledgeSelectionDock
