import React, { useCallback, useEffect, useState } from 'react'
import styled, { keyframes } from 'styled-components'
import type { PptPreviewStatus, PptSlidePreview, PptSourceType, PptTaskStatus } from '../../../contexts/GenerationWorkbenchContext'
import PptSlideNavigator from './PptSlideNavigator'
import PptSkillDrawer from './PptSkillDrawer'

// ---- Types -------------------------------------------------------

interface SkillInfo {
  id: string
  name: string
  description?: string
  previewColor?: string
  source?: 'built-in' | 'skill'
  slideCount?: number
  widthInches?: number
  heightInches?: number
}

interface PackageInfo {
  packageId: string
  title: string
  createdAt: string
}

// ---- Animations ----

const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`

// ---- Styled components — Light Office Theme ---------------------

const Workbench = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #F6F8FB;
  color: #1e293b;
  overflow: hidden;
  font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
`

// ---- Top Toolbar ------------------------------------------------

const Toolbar = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
  flex-shrink: 0;
  flex-wrap: wrap;
`

const ToolbarTitle = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 700;
  color: #1e293b;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
`

const StatusBadge = styled.div<{ $status: string }>`
  font-size: var(--font-size-xs);
  padding: 3px 9px;
  border-radius: 12px;
  font-weight: 600;
  flex-shrink: 0;
  ${({ $status }) => {
    if (['generating_outline','generating_slide','generating_image','generating_content','generating_deck','validating_deck','saving_deck'].includes($status))
      return 'background: #fef9c3; color: #854d0e; border: 1px solid #fde047;'
    if ($status === 'rendering' || $status === 'rendering_pptx' || $status === 'rendering_preview')
      return 'background: #dbeafe; color: #1d4ed8; border: 1px solid #bfdbfe;'
    if ($status === 'applying')
      return 'background: #ede9fe; color: #5b21b6; border: 1px solid #ddd6fe;'
    if ($status === 'completed')
      return 'background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0;'
    if ($status === 'stopped' || $status === 'failed')
      return 'background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca;'
    return 'background: #f3f4f6; color: #6b7280; border: 1px solid #e5e7eb;'
  }}
`

const StatusText = styled.div`
  font-size: var(--font-size-xs);
  color: #6b7280;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const Spacer = styled.div`
  flex: 1;
`

const TemplateSummary = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 7px;
  max-width: 260px;
  padding: 5px 10px;
  border: 1px solid #dbe4ef;
  border-radius: 999px;
  background: #f8fafc;
  color: #334155;
  font-size: var(--font-size-xs);
  font-weight: 700;
  cursor: pointer;
  overflow: hidden;
`

const TemplateDot = styled.span<{ $color: string }>`
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: ${({ $color }) => $color.startsWith('#') ? $color : `#${$color}`};
  flex-shrink: 0;
`

const TemplateName = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const ToolbarSelect = styled.select`
  height: 30px;
  max-width: 170px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  color: #374151;
  font-size: var(--font-size-xs);
  font-weight: 600;
  padding: 0 8px;
`

const ToolBtn = styled.button<{ $variant?: 'primary' | 'danger' | 'ghost' }>`
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid transparent;
  font-size: var(--font-size-sm);
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
  flex-shrink: 0;

  ${({ $variant }) => {
    switch ($variant) {
      case 'primary':
        return `background: #3b82f6; color: #fff; border-color: #3b82f6;
          &:hover:not(:disabled) { background: #2563eb; }
          &:disabled { opacity: 0.45; cursor: not-allowed; }`
      case 'danger':
        return `background: #fff1f2; color: #e11d48; border-color: #fecdd3;
          &:hover:not(:disabled) { background: #ffe4e6; }
          &:disabled { opacity: 0.45; cursor: not-allowed; }`
      default:
        return `background: #fff; color: #374151; border-color: #d1d5db;
          &:hover:not(:disabled) { background: #f9fafb; border-color: #9ca3af; }
          &:disabled { opacity: 0.4; cursor: not-allowed; }`
    }
  }}
`

// ---- Body -------------------------------------------------------

const Body = styled.div`
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
`

// ---- Center preview area ----------------------------------------

const CenterArea = styled.div`
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: #eef2f7;
  overflow: auto;
  gap: 10px;
`

const PageBadge = styled.div`
  position: absolute;
  right: 18px;
  bottom: 14px;
  padding: 5px 10px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.78);
  color: #fff;
  font-size: var(--font-size-xs);
  font-weight: 700;
  box-shadow: 0 6px 16px rgba(15, 23, 42, 0.18);
`

const PageControlGroup = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px;
  border: 1px solid #dbe4ef;
  border-radius: 999px;
  background: #f8fafc;
`

const PageText = styled.span`
  min-width: 58px;
  text-align: center;
  color: #334155;
  font-size: var(--font-size-xs);
  font-weight: 700;
`

const EmptyCard = styled.div`
  max-width: 400px;
  width: 100%;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 16px;
  padding: 40px 32px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
`

const EmptyIcon = styled.div`
  font-size: 40px;
  line-height: 1;
`

const EmptyTitle = styled.div`
  font-size: 16px;
  font-weight: 700;
  color: #1e293b;
`

const EmptyDesc = styled.div`
  font-size: var(--font-size-sm);
  color: #6b7280;
  line-height: 1.7;
`

const WaitingCard = styled.div`
  max-width: 400px;
  width: 100%;
  background: #fff;
  border: 1px solid #fde68a;
  border-radius: 16px;
  padding: 36px 32px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
`

const SpinnerIcon = styled.div`
  font-size: 28px;
  animation: ${spin} 1.5s linear infinite;
  line-height: 1;
`

const WaitingTitle = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: #92400e;
`

const WaitingDesc = styled.div`
  font-size: var(--font-size-sm);
  color: #78716c;
  line-height: 1.7;
  white-space: pre-line;
`

const RenderingCard = styled.div`
  max-width: 400px;
  width: 100%;
  background: #fff;
  border: 1px solid #bfdbfe;
  border-radius: 16px;
  padding: 36px 32px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
`

const RenderingTitle = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: #1d4ed8;
`

// ---- DeckBuild progress card ------------------------------------

const DeckBuildCard = styled.div`
  max-width: 440px;
  width: 100%;
  background: #fff;
  border: 1px solid #bfdbfe;
  border-radius: 16px;
  padding: 36px 32px;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
`

const DeckBuildTitle = styled.div`
  font-size: 15px;
  font-weight: 700;
  color: #1d4ed8;
  text-align: center;
`

const DeckBuildDesc = styled.div`
  font-size: var(--font-size-sm);
  color: #6b7280;
  line-height: 1.7;
  text-align: center;
  white-space: pre-line;
`

const DeckBuildSteps = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`

const DeckBuildStep = styled.div<{ $state: 'done' | 'active' | 'pending' }>`
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: var(--font-size-sm);
  font-weight: ${({ $state }) => $state === 'active' ? '700' : '500'};
  color: ${({ $state }) => $state === 'done' ? '#15803d' : $state === 'active' ? '#1d4ed8' : '#9ca3af'};
`

const StepDot = styled.div<{ $state: 'done' | 'active' | 'pending' }>`
  width: 20px;
  height: 20px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-xs);
  font-weight: 700;
  ${({ $state }) => {
    if ($state === 'done') return 'background: #dcfce7; color: #15803d; border: 1.5px solid #86efac;'
    if ($state === 'active') return 'background: #dbeafe; color: #1d4ed8; border: 1.5px solid #93c5fd;'
    return 'background: #f3f4f6; color: #d1d5db; border: 1.5px solid #e5e7eb;'
  }}
`

// ---- Left nav empty states ----------------------------------------

const NavEmptyMsg = styled.div`
  padding: 16px 10px;
  font-size: var(--font-size-xs);
  color: #9ca3af;
  text-align: center;
  line-height: 1.7;
`

const NavWrapper = styled.div`
  display: flex;
  flex-direction: column;
  overflow: hidden;
`

// ---- Slide editor modal ----------------------------------------

const EditorOverlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.42);
`

const EditorDialog = styled.div`
  width: min(720px, calc(100vw - 48px));
  max-height: calc(100vh - 56px);
  overflow: auto;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.28);
  padding: 18px;
  display: grid;
  gap: 12px;
`

const EditorHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`

const EditorTitle = styled.div`
  font-size: 15px;
  font-weight: 800;
  color: #1e293b;
`

const EditorGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
`

const EditorField = styled.div<{ $wide?: boolean }>`
  display: grid;
  gap: 5px;
  ${({ $wide }) => $wide ? 'grid-column: 1 / -1;' : ''}
`

const EditorStatus = styled.div`
  min-height: 18px;
  font-size: var(--font-size-xs);
  color: #64748b;
`

const FieldLabel = styled.label`
  font-size: var(--font-size-xs);
  font-weight: 700;
  color: #64748b;
`

const FieldInput = styled.input`
  width: 100%;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 6px 8px;
  font-size: var(--font-size-xs);
  color: #1f2937;
`

const FieldTextarea = styled.textarea`
  width: 100%;
  min-height: 54px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 6px 8px;
  font-size: var(--font-size-xs);
  color: #1f2937;
  resize: vertical;
  line-height: 1.5;
`

// ---- Helpers ----------------------------------------------------

type UiState = 'idle' | 'generating' | 'rendering' | 'stopped' | 'completed' | 'failed'

function getUiState(taskStatus: PptTaskStatus): UiState {
  if (['importing', 'extracting', 'building_deck', 'generating_outline', 'generating_slide', 'generating_image', 'generating_content', 'generating_deck', 'validating_deck', 'saving_deck'].includes(taskStatus)) return 'generating'
  if (['rendering_preview', 'rendering_pptx'].includes(taskStatus)) return 'rendering'
  if (taskStatus === 'stopped') return 'stopped'
  if (taskStatus === 'completed' || taskStatus === 'ready') return 'completed'
  if (taskStatus === 'failed') return 'failed'
  return 'idle'
}

function getStatusLabel(
  taskStatus: PptTaskStatus,
  isApplying: boolean,
  isResuming: boolean,
  liveCount: number,
  total: number,
): string {
  if (isApplying) return '应用模板中 · 不消耗 token'
  switch (taskStatus) {
    case 'importing': return '正在导入邮件附件…'
    case 'extracting': return '正在提取 PPTX 文本、备注与预览…'
    case 'building_deck': return '正在构建可编辑 DeckDocument…'
    case 'ready': return `已导入 · 共 ${total || liveCount} 页`
    case 'generating_outline': return '生成内容中 · 正在规划大纲…'
    case 'generating_slide':
      if (total > 0 && liveCount >= total) return `内容已完成 · 正在保存…`
      return isResuming
        ? `生成内容中 · 继续生成 ${liveCount} / ${total || '?'} 页`
        : `生成内容中 · 第 ${liveCount} / ${total || '?'} 页`
    case 'generating_image': return `生成内容中 · 正在生成配图…`
    case 'rendering_preview':
    case 'rendering_pptx': return '正在渲染 PPTX…'
    case 'completed': return `已完成 · 共 ${total || liveCount} 页`
    case 'stopped': return `已停止 · 已保留 ${liveCount}${total ? ` / ${total}` : ''} 页`
    case 'generating_deck': return '生成内容中 · 正在生成 DeckDocument…'
    case 'validating_deck': return '生成内容中 · 校验内容结构…'
    case 'saving_deck': return '生成内容中 · 保存 DeckDocument…'
    case 'generating_content': return '生成内容中 · 正在生成演示内容…'
    case 'failed': return '生成失败'
    default: return 'PPT 工作台'
  }
}

function toImageSrc(imagePath: string): string {
  if (/^(https?:|data:|blob:)/i.test(imagePath) || imagePath.startsWith('/')) return imagePath
  return `file://${imagePath}`
}

// ---- Props ------------------------------------------------------

interface PptWorkbenchPanelProps {
  title: string
  taskStatus: PptTaskStatus
  liveSlides: PptSlidePreview[]
  totalSlides: number
  activeSlideIndex: number
  activeSkillId: string | null
  contentPackageId: string | null
  resultPath: string | null
  workspacePath: string | null
  availableSkills: SkillInfo[]
  packageHistory: PackageInfo[]
  isApplyingSkill?: boolean
  isResuming?: boolean
  /** DeckDocument ID — when set, template switching uses deckRender (zero LLM/token). */
  deckDocumentId?: string | null
  /** Active TemplateManifest ID (e.g. 'business_report_light') */
  activeTemplateManifestId?: string | null
  templateStatusMessage?: string | null
  sourceType?: PptSourceType
  originalFilePath?: string | null
  originalFileName?: string | null
  importStatus?: 'importing' | 'extracting' | 'building_deck' | 'ready' | 'failed' | null
  importWarnings?: string[]
  previewStatus?: PptPreviewStatus
  previewMessage?: string | null

  onStop: () => void
  onResume?: () => void
  onExportPartial?: () => void
  onRerender: () => void
  onOpenPpt: () => void
  onDownloadPpt: () => void
  onOpenFolder: () => void
  onUploadTemplate: () => void  // kept for compatibility; triggers "导入 PPT" flow
  onSelectSlide: (index: number) => void
  onSelectPackage: (packageId: string) => void
  onSkillApplied: (skillId: string, outputPath: string) => void
  onOpenOriginalFile?: () => void
  onUpdateSlide?: (slideIndex: number, updates: Record<string, unknown>) => Promise<boolean>
  onAiOptimizeStructure?: () => void
}

// ---- Main component ---------------------------------------------

export default function PptWorkbenchPanel({
  title,
  taskStatus,
  liveSlides,
  totalSlides,
  activeSlideIndex,
  activeSkillId,
  contentPackageId,
  resultPath,
  workspacePath,
  availableSkills,
  packageHistory,
  isApplyingSkill,
  isResuming,
  deckDocumentId,
  activeTemplateManifestId,
  templateStatusMessage,
  sourceType = 'generated',
  originalFilePath,
  originalFileName,
  importStatus,
  importWarnings = [],
  previewStatus = null,
  previewMessage,
  onStop,
  onResume,
  onExportPartial,
  onRerender,
  onOpenPpt,
  onDownloadPpt,
  onOpenFolder,
  onUploadTemplate,
  onSelectSlide,
  onSelectPackage,
  onSkillApplied,
  onOpenOriginalFile,
  onUpdateSlide,
  onAiOptimizeStructure,
}: PptWorkbenchPanelProps) {
  const [skillDrawerOpen, setSkillDrawerOpen] = useState(false)
  const [templateEntryMessage, setTemplateEntryMessage] = useState('')
  const [editorExpanded, setEditorExpanded] = useState(false)
  const [slideDraft, setSlideDraft] = useState({
    title: '',
    subtitle: '',
    summary: '',
    body: '',
    items: '',
    speakerNotes: '',
    visualBrief: '',
  })
  const [slideSaveStatus, setSlideSaveStatus] = useState('')

  const uiState = getUiState(taskStatus)
  const isDeckBuildPhase = ['generating_deck', 'generating_content', 'validating_deck', 'saving_deck'].includes(taskStatus)
  const isGenerating = uiState === 'generating'
  const activeSlide = liveSlides[activeSlideIndex] ?? null
  const isImportedSource = sourceType === 'imported_pptx' || sourceType === 'email_attachment'
  const isSourcePreview = isImportedSource && !!deckDocumentId && !activeTemplateManifestId
  const activeTemplateId = isImportedSource ? activeTemplateManifestId : (activeTemplateManifestId || activeSkillId)
  const activeSkill = availableSkills.find(s => s.id === activeTemplateId || s.id === activeSkillId) ?? null
  const activeTemplate = availableSkills.find(s => s.id === activeTemplateId) ?? activeSkill
  const activeTemplateName = isSourcePreview
    ? '原版 PPT'
    : activeTemplate?.name || activeTemplateId || '未应用模板'
  const templateButtonText = isSourcePreview
    ? '替换模板：原版 PPT'
    : `替换模板：${activeTemplateName}`
  const previewMode: 'source' | 'retemplated' | 'structure' = isSourcePreview ? 'source' : activeTemplateId ? 'retemplated' : 'structure'

  const generatingSlideIndex = isGenerating && liveSlides.length > 0
    ? liveSlides.findIndex(s => s.isGenerating || s.imageLoading)
    : undefined

  const statusLabel = getStatusLabel(taskStatus, !!isApplyingSkill, !!isResuming, liveSlides.length, totalSlides)

  useEffect(() => {
    setSlideDraft({
      title: activeSlide?.title || '',
      subtitle: activeSlide?.subtitle || '',
      summary: activeSlide?.summary || '',
      body: activeSlide?.body || '',
      items: (activeSlide?.items || []).join('\n'),
      speakerNotes: activeSlide?.speakerNotes || activeSlide?.notes || '',
      visualBrief: activeSlide?.visualBrief || '',
    })
    setSlideSaveStatus('')
  }, [activeSlideIndex, activeSlide])

  const handleSkillApplied = useCallback((skillId: string, outputPath: string) => {
    setSkillDrawerOpen(false)
    setTemplateEntryMessage('')
    onSkillApplied(skillId, outputPath)
  }, [onSkillApplied])

  // ---- Button enabled states ----
  const hasTemplateContent = !!contentPackageId || !!deckDocumentId
  const isTemplateActionBusy = isGenerating || uiState === 'rendering' || !!isApplyingSkill
  const canOpenTemplateDrawer = !isTemplateActionBusy
  const canRerender = (!!contentPackageId || !!deckDocumentId) && uiState === 'completed'
  const canOpenPpt = !!resultPath && (uiState === 'completed' || uiState === 'stopped')
  const canDownloadPpt = canOpenPpt
  const canImportPpt = !!workspacePath && !isGenerating && uiState !== 'rendering' && !isApplyingSkill

  const handleOpenTemplateDrawer = useCallback(() => {
    if (!hasTemplateContent) {
      setTemplateEntryMessage('请先导入或生成 PPT 内容后再替换模板。')
      return
    }
    setTemplateEntryMessage('')
    setSkillDrawerOpen(true)
  }, [hasTemplateContent])

  // ---- Toolbar buttons per state ----
  const renderToolbarButtons = () => {
    if (uiState === 'idle') {
      return <ToolBtn onClick={onOpenFolder}>📁 打开目录</ToolBtn>
    }

    if (uiState === 'generating') {
      return (
        <>
          <ToolBtn $variant="danger" onClick={onStop}>⏹ 停止</ToolBtn>
          <ToolBtn onClick={onOpenFolder}>📁 打开目录</ToolBtn>
        </>
      )
    }

    if (uiState === 'rendering') {
      return <ToolBtn onClick={onOpenFolder}>📁 打开目录</ToolBtn>
    }

    if (uiState === 'stopped') {
      return (
        <>
          {onResume && <ToolBtn $variant="primary" onClick={onResume}>▶ 继续生成</ToolBtn>}
          <ToolBtn onClick={onExportPartial ?? onRerender} disabled={!contentPackageId || !!isApplyingSkill}>
            ⬇ 导出已生成
          </ToolBtn>
          <ToolBtn onClick={onOpenPpt} disabled={!canOpenPpt}>▶ 打开</ToolBtn>
          <ToolBtn onClick={onOpenFolder}>📁 目录</ToolBtn>
        </>
      )
    }

    // completed
    return (
      <>
        {sourceType === 'email_attachment' && (
          <ToolBtn onClick={onOpenOriginalFile} disabled={!onOpenOriginalFile}>
            打开源文件
          </ToolBtn>
        )}
        <ToolBtn onClick={() => setEditorExpanded(true)} disabled={!deckDocumentId}>
          编辑内容
        </ToolBtn>
        <ToolBtn onClick={onAiOptimizeStructure} disabled={!onAiOptimizeStructure || !deckDocumentId || !!isApplyingSkill}>
          AI 优化结构
        </ToolBtn>
        <ToolBtn onClick={onRerender} disabled={!canRerender} title="用当前内容包重新渲染">
          ↺ 重渲染
        </ToolBtn>
        <ToolBtn onClick={onOpenPpt} disabled={!canOpenPpt}>▶ 打开 PPT</ToolBtn>
        <ToolBtn onClick={onDownloadPpt} disabled={!canDownloadPpt}>导出 PPT</ToolBtn>
        <ToolBtn onClick={onOpenFolder}>📁 目录</ToolBtn>
      </>
    )
  }

  const handleSaveSlide = async () => {
    if (!onUpdateSlide || !activeSlide) return
    setSlideSaveStatus('正在保存…')
    const ok = await onUpdateSlide(activeSlideIndex, {
      title: slideDraft.title,
      subtitle: slideDraft.subtitle,
      summary: slideDraft.summary,
      body: slideDraft.body,
      items: slideDraft.items.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
      speakerNotes: slideDraft.speakerNotes,
      visualBrief: slideDraft.visualBrief,
    })
    setSlideSaveStatus(ok ? '已保存并刷新预览' : '保存失败')
  }

  // ---- Center area content per state ----
  const renderCenter = () => {
    // 1. Deck-build progress phase (DeckDocument-first new path)
    if (isDeckBuildPhase) {
      const steps: Array<{ label: string; stage: string }> = [
        { label: '理解需求', stage: 'generating_deck' },
        { label: '生成内容结构', stage: 'generating_deck' },
        { label: '保存 deck.json', stage: 'saving_deck' },
        { label: '应用模板', stage: 'rendering_pptx' },
        { label: '输出 PPTX', stage: 'completed' },
      ]
      const stageOrder = ['generating_deck','validating_deck','saving_deck','rendering_pptx','completed']
      const currentStageIdx = stageOrder.indexOf(taskStatus ?? '')
      const stageLabel = getStatusLabel(taskStatus ?? 'idle', !!isApplyingSkill, !!isResuming, liveSlides.length, totalSlides)
      return (
        <CenterArea>
          <DeckBuildCard>
            <DeckBuildTitle>正在生成 PPT</DeckBuildTitle>
            <DeckBuildDesc>DeckDocument 是模板无关的内容结构<br/>生成完成后可自由切换模板</DeckBuildDesc>
            <DeckBuildSteps>
              {steps.map((step, i) => {
                const stepStageIdx = stageOrder.indexOf(step.stage)
                const state: 'done' | 'active' | 'pending' =
                  currentStageIdx > stepStageIdx ? 'done' :
                  currentStageIdx === stepStageIdx ? 'active' : 'pending'
                return (
                  <DeckBuildStep key={i} $state={state}>
                    <StepDot $state={state}>{state === 'done' ? '✓' : String(i + 1)}</StepDot>
                    {step.label}
                    {state === 'active' && <span style={{ marginLeft: 'auto', fontSize: 'var(--font-size-xs)', color: '#1d4ed8' }}>{stageLabel}</span>}
                  </DeckBuildStep>
                )
              })}
            </DeckBuildSteps>
          </DeckBuildCard>
        </CenterArea>
      )
    }

    // 2. PPTX rendering phase (no active slide yet)
    if (uiState === 'rendering' && !activeSlide) {
      return (
        <CenterArea>
          <RenderingCard>
            <RenderingTitle>正在应用模板并渲染 PPTX</RenderingTitle>
            <WaitingDesc>不消耗 token · 纯本地渲染</WaitingDesc>
          </RenderingCard>
        </CenterArea>
      )
    }

    // 3. Active slide preview
    if (activeSlide) {
      // If we have a real PPTX screenshot, show it full-width
      if (activeSlide.imagePath) {
        return (
          <CenterArea style={{ padding: 18, background: '#f3f6fa', justifyContent: 'center', alignItems: 'center' }}>
            <img
              src={toImageSrc(activeSlide.imagePath)}
              alt={`Slide ${activeSlideIndex + 1}`}
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain',
                display: 'block',
                borderRadius: 4,
                boxShadow: '0 10px 30px rgba(15,23,42,0.14)',
              }}
            />
            <PageBadge>{activeSlideIndex + 1} / {totalSlides || liveSlides.length}</PageBadge>
          </CenterArea>
        )
      }
      // Text-based fallback (no real screenshot yet)
      return (
        <CenterArea>
          <EmptyCard style={{ alignItems: 'flex-start', textAlign: 'left', maxWidth: 560 }}>
            <EmptyTitle style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
              {activeSlide.heading || activeSlide.title}
            </EmptyTitle>
            {activeSlide.body && (
              <EmptyDesc style={{ whiteSpace: 'pre-line', lineHeight: 1.7 }}>{activeSlide.body}</EmptyDesc>
            )}
            {activeSlide.items && activeSlide.items.length > 0 && (
              <ul style={{ paddingLeft: 18, margin: '8px 0 0', fontSize: 14, color: '#374151' }}>
                {activeSlide.items.map((item: string, idx: number) => (
                  <li key={idx} style={{ marginBottom: 4 }}>{item}</li>
                ))}
              </ul>
            )}
          </EmptyCard>
        </CenterArea>
      )
    }

    // 4. Generating — legacy path waiting for first slide
    if (uiState === 'generating') {
      return (
        <CenterArea>
          <WaitingCard>
            <SpinnerIcon />
            <WaitingTitle>正在生成 PPT</WaitingTitle>
            <WaitingDesc>等待第一页生成…</WaitingDesc>
          </WaitingCard>
        </CenterArea>
      )
    }

    // 5. Completed — DeckDocument path (no live slides, PPTX file ready)
    if (uiState === 'completed' && liveSlides.length === 0) {
      const previewUnavailable = previewStatus === 'unavailable' || previewStatus === 'failed'
      return (
        <CenterArea>
          <EmptyCard style={{ borderColor: '#86efac' }}>
            <EmptyIcon style={{ color: '#16a34a', fontSize: 32 }}>&#10003;</EmptyIcon>
            <EmptyTitle style={{ color: '#15803d' }}>PPT 已生成</EmptyTitle>
            <EmptyDesc>
              {previewUnavailable
                ? (previewMessage || 'PPT 已生成，可下载；当前服务器未安装预览组件。')
                : totalSlides > 0 ? `共 ${totalSlides} 页 · 请点击下载` : '请点击右侧下载'}
            </EmptyDesc>
          </EmptyCard>
        </CenterArea>
      )
    }

    // 6. Stopped — no slides
    if (uiState === 'stopped' && liveSlides.length === 0) {
      return (
        <CenterArea>
          <EmptyCard style={{ borderColor: '#fca5a5' }}>
            <EmptyIcon style={{ color: '#991b1b', fontSize: 24 }}>&#9632;</EmptyIcon>
            <EmptyTitle style={{ color: '#991b1b' }}>已停止</EmptyTitle>
            <EmptyDesc>生成已被取消</EmptyDesc>
          </EmptyCard>
        </CenterArea>
      )
    }

    // 7. Idle / default
    return (
      <CenterArea>
        <EmptyCard>
          <EmptyIcon>&#128196;</EmptyIcon>
          <EmptyTitle>准备生成 PPT</EmptyTitle>
          <EmptyDesc>填写需求后点击生成</EmptyDesc>
        </EmptyCard>
      </CenterArea>
    )
  
  }

  // ---- Left nav ----
  const renderNav = () => {
    if (liveSlides.length > 0) {
      return (
        <PptSlideNavigator
          slides={liveSlides}
          activeIndex={activeSlideIndex}
          skillColor={activeSkill?.previewColor}
          generatingIndex={generatingSlideIndex !== undefined && generatingSlideIndex >= 0 ? generatingSlideIndex : undefined}
          previewMode={previewMode}
          onSelectSlide={onSelectSlide}
        />
      )
    }
    return (
      <NavWrapper style={{ width: 180, minWidth: 160, background: '#fff', borderRight: '1px solid #e5e7eb' }}>
        <NavEmptyMsg>
          {isGenerating ? '正在生成大纲…\n等待第一页' : '暂无幻灯片'}
        </NavEmptyMsg>
      </NavWrapper>
    )
  }

  const renderEditorModal = () => {
    if (!editorExpanded || !activeSlide || !deckDocumentId) return null
    return (
      <EditorOverlay onClick={(e) => { if (e.target === e.currentTarget) setEditorExpanded(false) }}>
        <EditorDialog onClick={(e) => e.stopPropagation()}>
          <EditorHeader>
            <EditorTitle>编辑当前页 · 第 {activeSlideIndex + 1} 页</EditorTitle>
            <ToolBtn type="button" onClick={() => setEditorExpanded(false)}>关闭</ToolBtn>
          </EditorHeader>
          <EditorGrid>
            <EditorField>
              <FieldLabel>标题</FieldLabel>
              <FieldInput value={slideDraft.title} onChange={(e) => setSlideDraft((s) => ({ ...s, title: e.target.value }))} />
            </EditorField>
            <EditorField>
              <FieldLabel>副标题</FieldLabel>
              <FieldInput value={slideDraft.subtitle} onChange={(e) => setSlideDraft((s) => ({ ...s, subtitle: e.target.value }))} />
            </EditorField>
            <EditorField $wide>
              <FieldLabel>摘要</FieldLabel>
              <FieldTextarea value={slideDraft.summary} onChange={(e) => setSlideDraft((s) => ({ ...s, summary: e.target.value }))} />
            </EditorField>
            <EditorField $wide>
              <FieldLabel>正文</FieldLabel>
              <FieldTextarea value={slideDraft.body} onChange={(e) => setSlideDraft((s) => ({ ...s, body: e.target.value }))} />
            </EditorField>
            <EditorField $wide>
              <FieldLabel>要点（每行一个）</FieldLabel>
              <FieldTextarea value={slideDraft.items} onChange={(e) => setSlideDraft((s) => ({ ...s, items: e.target.value }))} />
            </EditorField>
            <EditorField>
              <FieldLabel>演讲备注</FieldLabel>
              <FieldTextarea value={slideDraft.speakerNotes} onChange={(e) => setSlideDraft((s) => ({ ...s, speakerNotes: e.target.value }))} />
            </EditorField>
            <EditorField>
              <FieldLabel>视觉说明</FieldLabel>
              <FieldTextarea value={slideDraft.visualBrief} onChange={(e) => setSlideDraft((s) => ({ ...s, visualBrief: e.target.value }))} />
            </EditorField>
          </EditorGrid>
          <EditorHeader>
            <EditorStatus>{slideSaveStatus}</EditorStatus>
            <ToolBtn type="button" $variant="primary" onClick={() => void handleSaveSlide()} disabled={!onUpdateSlide}>
              保存到 deck.json
            </ToolBtn>
          </EditorHeader>
        </EditorDialog>
      </EditorOverlay>
    )
  }

  return (
    <Workbench>
      {/* ── TOP TOOLBAR ─────────────────────────── */}
      <Toolbar>
        <ToolbarTitle title={title}>{title}</ToolbarTitle>
        {isApplyingSkill && <StatusBadge $status="applying">应用模板中</StatusBadge>}
        {!isApplyingSkill && isGenerating && (
          <StatusBadge $status={taskStatus}>
            {taskStatus === 'generating_outline' ? '生成大纲' : `${liveSlides.length}${totalSlides > 0 ? ` / ${totalSlides}` : ''} 页`}
          </StatusBadge>
        )}
        {!isApplyingSkill && uiState === 'rendering' && (
          <StatusBadge $status="rendering">渲染中</StatusBadge>
        )}
        {uiState === 'completed' && <StatusBadge $status="completed">已完成</StatusBadge>}
        {uiState === 'failed' && <StatusBadge $status="failed">失败</StatusBadge>}
        {uiState === 'stopped' && <StatusBadge $status="stopped">已停止</StatusBadge>}
        {sourceType === 'email_attachment' && originalFileName && (
          <StatusBadge $status={importStatus || 'ready'} title={originalFileName}>
            附件：{originalFileName}
          </StatusBadge>
        )}
        {isSourcePreview && <StatusBadge $status="original">当前查看：原始 PPT</StatusBadge>}
        <StatusText title={templateEntryMessage || templateStatusMessage || importWarnings[0] || statusLabel}>
          {templateEntryMessage || templateStatusMessage || importWarnings[0] || statusLabel}
        </StatusText>
        <PageControlGroup>
          <ToolBtn
            type="button"
            onClick={() => onSelectSlide(Math.max(0, activeSlideIndex - 1))}
            disabled={activeSlideIndex <= 0 || liveSlides.length === 0}
          >
            上一页
          </ToolBtn>
          <PageText>{liveSlides.length > 0 ? `${activeSlideIndex + 1} / ${liveSlides.length}` : '0 / 0'}</PageText>
          <ToolBtn
            type="button"
            onClick={() => onSelectSlide(Math.min(liveSlides.length - 1, activeSlideIndex + 1))}
            disabled={activeSlideIndex >= liveSlides.length - 1 || liveSlides.length === 0}
          >
            下一页
          </ToolBtn>
          <ToolBtn type="button" disabled title="即将支持">插入页</ToolBtn>
          <ToolBtn type="button" disabled title="即将支持">删除</ToolBtn>
        </PageControlGroup>
        <TemplateSummary
          type="button"
          onClick={handleOpenTemplateDrawer}
          disabled={!canOpenTemplateDrawer}
          title={hasTemplateContent ? (isSourcePreview ? '当前查看：原始 PPT，尚未应用软件模板。' : `当前模板：${activeTemplateName}`) : '请先导入或生成 PPT 内容后再替换模板。'}
        >
          <TemplateDot $color={isSourcePreview ? '94a3b8' : activeTemplate?.previewColor || '3b82f6'} />
          <TemplateName>{templateButtonText}</TemplateName>
        </TemplateSummary>
        {packageHistory.length > 1 && (
          <ToolbarSelect
            value={contentPackageId || ''}
            onChange={(e) => onSelectPackage(e.target.value)}
            title="历史内容包"
          >
            {packageHistory.slice(0, 5).map((pkg) => (
              <option key={pkg.packageId} value={pkg.packageId}>
                {pkg.title || '未命名'}
              </option>
            ))}
          </ToolbarSelect>
        )}
        <ToolBtn onClick={onUploadTemplate} disabled={!canImportPpt}>
          导入 PPT
        </ToolBtn>
        <Spacer />
        {renderToolbarButtons()}
      </Toolbar>

      {/* ── BODY ────────────────────────────────── */}
      <Body>
        {renderNav()}
        {renderCenter()}
      </Body>

      {/* Skill Drawer (overlay) */}
      <PptSkillDrawer
        open={skillDrawerOpen}
        skills={availableSkills}
        activeSkillId={activeTemplateId ?? null}
        contentPackageId={contentPackageId}
        workspacePath={workspacePath}
        deckDocumentId={deckDocumentId}
        onClose={() => setSkillDrawerOpen(false)}
        onApplied={handleSkillApplied}
      />
      {renderEditorModal()}
    </Workbench>
  )
}
