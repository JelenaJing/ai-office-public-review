// vNext freeze: this component is the editor-side orchestration adapter for document actions.
// It is not the unified document kernel and should not absorb delivery-engine concerns.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'
import { useDepartment } from '../../../contexts/DepartmentContext'
import { useDocument } from '../../../contexts/DocumentContext'
import { useGenerationWorkbench } from '../../../contexts/GenerationWorkbenchContext'
import { useKnowledge } from '../../../contexts/KnowledgeContext'
import { usePersonalLibrary } from '../../../contexts/PersonalLibraryContext'
import { useWorkspace } from '../../../contexts/WorkspaceContext'
import { useWorkspaceMode } from '../../../contexts/WorkspaceModeContext'
import { useDocumentEngineRuntime } from '../../../engines/documentEngine/runtime'
import { MAX_CONCURRENT_WRITING_TASKS, useEditorSession, EDITOR_SESSION_STOP_WRITING_EVENT } from '../../../contexts/EditorSessionContext'
import { useDocumentWorkspaceKnowledge } from '../../../contexts/DocumentWorkspaceContext'
import { getAIToolSettings, subscribeToAIToolSettingsUpdates } from '../../../utils/aiToolSettings'
import { buildMinimalWritingRuleText } from '../../../utils/writingRulePrompt'
import { generateSelectionImage, getDefaultInsertedGeneratedImageWidthPx } from '../../image/services/ImageService'
import { getPrimaryStyleReferenceId } from '../../image/services/imageGenerationPrompt'
import {
  isExplicitImageGenerationRequest,
  orderSelectedKnowledgeDocuments,
  resolveActiveImageStyleProfile,
  runSharedImageGeneration,
} from '../../image/services/sharedImageGeneration'
import type { StructuredRemakeContext } from '../../writing/services/sectionAwareRemake'
import { runWritingAssistant } from '../../writing/services/WritingAssistantService'
import {
  buildPaperArtifact,
  getEssayTaskResult,
  getEssayTaskStatus,
  getActiveTasks,
  getDailyReportTaskResult,
  getDailyReportTaskStatus,
  getTaskBackendUrl,
  getTaskResult,
  getTaskStatus,
  pauseTask,
  resolvePaperText,
  resumeTask,
  stopEssayTask,
  stopDailyReportTask,
  stopTask,
  submitEssayTask,
  submitDailyReportTask,
  submitTask,
  subscribeToEssayTaskEvents,
  subscribeToDailyReportEvents,
} from '../../paper/services/PaperService'
import { resolveStreamingPreviewMarkdown } from '../../paper/services/paperStreaming'
import { stripPreamble, stripThinkTags } from '../../../utils/StreamThinkFilter'
import { normalizeDocumentResultMarkdown } from '../../../utils/documentResultNormalization'
import { getEditorTabResolvedContent } from '../../../document/editorTabs'
import type { DocumentRewriteTargetResolution } from '../../../document/rewriteTargeting'
import { createDocumentArtifact } from '../../../document/core'
import { buildDocumentSchemaFromHtml, normalizeDocumentSchema, serializeDocumentSchemaToHtml, type DocumentSchema } from '../../../document/schema'
import { markdownToHtml } from '../../../utils/markdownToHtml'
import {
  fixRelativeImageUrls,
  replaceImageUrls,
  saveImageIncrementallyToWorkspace,
  saveResultReferencesToWorkspace,
  saveResultToWorkspace,
} from '../../../utils/workspaceFiles'
import { buildPaperGenerationPreviewContent, type PaperOoxmlSnapshot, type EmbeddedPayloadBlock } from '../../../engines/documentEngine/embeddedPaperDocument'
import {
  getFileName,
  normalizeFileLikePath,
  toDisplayUrl,
} from './generationWorkbenchUtils'
import { toFileUrl as toSharedFileUrl } from '../../../shared/url/fileUrlHelper'
import { plainTextToHtml } from '../../../utils/plainTextToHtml'
import { createPendingImageInsertionState } from '../../../utils/crossTabWriteback'
import type { KnowledgeGenerationTrace, KnowledgeTaskConstraints, PreviewKnowledgeTaskContextResult } from '../../../types/knowledge'
import { KnowledgeTreePicker } from '../../../components/knowledge/KnowledgeTreePicker'
import {
  buildKnowledgeGenerationTrace,
  buildKnowledgeReferenceMarkdown,
  markdownHasReferencesSection,
  buildKnowledgeTaskConstraints,
  persistKnowledgeTaskRecord,
} from '../../../shared/knowledge/knowledgeTaskHelper'
import {
  type UnifiedComposerCapabilities,
  UnifiedComposerActionRow,
  UnifiedComposerShell,
  UnifiedComposerStatusPill,
  UnifiedComposerStatusRow,
  UnifiedComposerStatusText,
  UnifiedComposerTextarea,
  UnifiedDockExpandAction,
  UnifiedDockExpandLabel,
  UnifiedDockExpandStrip,
  UnifiedGenerationDockWrap,
  UnifiedGhostButton,
} from './generationDockPrimitives'

const ComposerBackdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1400;
  background: rgba(15, 23, 42, 0.38);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
`

const InlineComposerStack = styled.div`
  display: grid;
  gap: 10px;
`

const InlineComposerTopRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
`

const InlineComposerTag = styled.span<{ $accent?: boolean }>`
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid ${p => p.$accent ? '#b8cdfd' : '#d7e0ea'};
  background: ${p => p.$accent ? '#eef4ff' : '#f7fafc'};
  color: ${p => p.$accent ? '#2455c3' : '#5f7387'};
  font-size: var(--font-size-xs);
  font-weight: 600;
  white-space: nowrap;
`

const InlineComposerSummary = styled.div`
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-xs);
  line-height: 1.5;
  color: #5f7387;
`

const InlineComposerActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
`

const InlineComposerInputRow = styled.div`
  display: flex;
  align-items: flex-end;
  gap: 10px;
`

const InlineComposerInput = styled(UnifiedComposerTextarea)`
  flex: 1;
  min-height: 56px;
  max-height: 144px;
`

const InlineComposerButton = styled.button<{ $danger?: boolean; $ghost?: boolean }>`
  height: 42px;
  min-width: 74px;
  border-radius: 12px;
  flex-shrink: 0;
  border: 1px solid ${p => p.$danger ? '#e5b7b7' : p.$ghost ? '#d6e0ea' : '#2f62d8'};
  background: ${p => p.$danger ? '#fff5f5' : p.$ghost ? '#ffffff' : '#2e68e6'};
  color: ${p => p.$danger ? '#b33838' : p.$ghost ? '#304255' : '#fff'};
  font-size: var(--font-size-xs);
  cursor: pointer;
  &:disabled { opacity: 0.55; cursor: not-allowed; }
`

const KnowledgeSelectButton = styled.button<{ $active?: boolean }>`
  height: 32px;
  max-width: 180px;
  border-radius: 999px;
  border: 1px solid ${p => p.$active ? '#8fb2f5' : '#d6e0ea'};
  background: ${p => p.$active ? '#eef4ff' : '#ffffff'};
  color: ${p => p.$active ? '#234c9b' : '#52687d'};
  font-size: var(--font-size-xs);
  font-weight: 700;
  padding: 0 12px;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  &:hover { border-color: #7da6ef; background: #f4f8ff; }
  &:disabled { opacity: 0.55; cursor: not-allowed; }
`

const InlineComposerFooter = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 18px;
`

const ComposerDialog = styled.div<{ $inline?: boolean }>`
  width: ${({ $inline }) => ($inline ? '100%' : 'min(960px, calc(100vw - 32px))')};
  max-height: ${({ $inline }) => ($inline ? 'none' : 'calc(100vh - 40px)')};
  overflow: ${({ $inline }) => ($inline ? 'visible' : 'auto')};
  border: 1px solid #d9e2ec;
  border-radius: 18px;
  background: linear-gradient(180deg, #ffffff 0%, #f7fbff 100%);
  box-shadow: ${({ $inline }) => ($inline ? '0 18px 44px rgba(15, 23, 42, 0.12)' : '0 28px 80px rgba(15, 23, 42, 0.24)')};
`

const ComposerWrap = styled.div`
  padding: 0 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
`

const ComposerHeader = styled.div`
  padding: 16px 18px 12px;
  border-bottom: 1px solid #e4ebf2;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
`

const ComposerHeaderCopy = styled.div`
  min-width: 0;
  display: grid;
  gap: 6px;
`

const ComposerTitle = styled.div`
  font-size: 18px;
  font-weight: 800;
  color: #173457;
`

const ComposerDesc = styled.div`
  font-size: var(--font-size-xs);
  line-height: 1.65;
  color: #607487;
`

const ComposerHeaderActions = styled.div`
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
`

const DropZone = styled.div<{ $dragging: boolean }>`
  border: 1px dashed ${p => p.$dragging ? '#50c7ff' : '#d6e0ea'};
  border-radius: 8px;
  padding: 8px;
  background: ${p => p.$dragging ? 'rgba(80, 199, 255, 0.08)' : '#f8fbff'};
`

const InputRow = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
`

const Input = styled.textarea`
  flex: 1;
  min-height: 40px;
  max-height: 72px;
  resize: vertical;
  border-radius: 8px;
  border: 1px solid #d6e0ea;
  background: #ffffff;
  color: #304255;
  padding: 10px;
  font-size: var(--font-size-xs);
  line-height: 1.35;
  outline: none;
  &:focus { border-color: #4ea1ff; }
`

const Btn = styled.button<{ $danger?: boolean; $ghost?: boolean }>`
  height: 36px;
  min-width: 86px;
  border-radius: 8px;
  border: 1px solid ${p => p.$danger ? '#e5b7b7' : p.$ghost ? '#d6e0ea' : '#2f62d8'};
  background: ${p => p.$danger ? '#fff5f5' : p.$ghost ? '#ffffff' : '#2e68e6'};
  color: ${p => p.$danger ? '#b33838' : p.$ghost ? '#304255' : '#fff'};
  font-size: var(--font-size-xs);
  cursor: pointer;
  &:disabled { opacity: 0.55; cursor: not-allowed; }
`

const MetaRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 18px;
`

const Status = styled.span`
  color: #627385;
  font-size: var(--font-size-xs);
`

function sanitizeGeneratedName(value: string, fallback: string, maxLength = 60): string {
  const normalized = String(value || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
  return normalized || fallback
}

function extractFinalPaperTitle(markdown: string, payload: Record<string, any> | null | undefined, fallback: string): string {
  const directTitle = [payload?.paper_title, payload?.paperTitle, payload?.title]
    .map((value) => String(value || '').trim())
    .find(Boolean)
  if (directTitle) {
    return directTitle
  }

  const lines = normalizeDocumentResultMarkdown(markdown)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  for (const line of lines) {
    const heading = line.replace(/^#{1,6}\s+/, '').trim()
    if (heading && heading !== line) {
      return heading
    }
  }

  const firstLine = lines.find((line) => line.length > 0 && !/^(!\[|\[|摘要[:：]?|abstract[:：]?)/i.test(line))
  return firstLine || fallback
}

function buildManuscriptFileName(title: string): string {
  return `${sanitizeGeneratedName(title, '论文', 60)}.aidoc.json`
}

const POST_GENERATION_ILLUSTRATION_WIDTH_PX = getDefaultInsertedGeneratedImageWidthPx()

function toFileUrl(localPath: string): string {
  return toSharedFileUrl(localPath)
}

async function waitForDocumentPaint(): Promise<void> {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    await Promise.resolve()
    return
  }

  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve())
    })
  })
}

const AttachList = styled.div`
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
`

const AttachItem = styled.button`
  border: 1px solid #d6e0ea;
  border-radius: 999px;
  background: #ffffff;
  color: #304255;
  font-size: var(--font-size-xs);
  padding: 3px 10px;
  cursor: pointer;
`

interface AttachmentItem {
  id: string
  name: string
  size: number
  type: string
  textPreview?: string
}

interface Props {
  open: boolean
  presentation?: 'modal' | 'inline' | 'silent'
  autoTopic?: string
  autoStartNonce?: number
  manualEditNonce?: number
  manualEditTabId?: string
  initialMode?: AssistantTargetMode
  preferredDocumentFlow?: 'auto' | 'paper-generation' | 'assistant' | 'rewrite'
  autoRunOnOpen?: boolean
  targetTabId: string
  selectionText?: string
  selectionRange?: { from: number; to: number; anchorId?: string } | null
  selectionStructureContext?: StructuredRemakeContext | null
  onClose: () => void
  onApplySelectionRewrite: (payload: { tabId: string; from: number; to: number; anchorId?: string; text: string }) => boolean
  onResolveDocumentRewriteTarget?: (payload: { tabId: string; instruction: string }) => DocumentRewriteTargetResolution
  onShadowTextChange: (text: string) => void
  onRunningChange: (running: boolean) => void
  onPauseChange?: (paused: boolean) => void
  onPaperStreamStart?: (tabId: string) => boolean
  onPaperStreamAppend?: (payload: { tabId: string; markdown: string; contentType?: string; eventType?: 'references' | 'image' }) => boolean
  onPaperStreamSync?: (payload: { tabId: string; markdown: string; backendUrl: string; paragraphIndex?: number; updatedParagraph?: string; citationNumber?: number }) => boolean
  onPaperStreamComplete?: (payload: { tabId: string; markdown: string; backendUrl: string; documentSchema?: DocumentSchema }) => boolean
}

type AssistantTargetMode = 'document'
type DocumentFlow = 'paper-generation' | 'assistant' | 'rewrite' | 'template-driven'

type KnowledgeTemplatePayload = {
  title: string
  sourceType?: string
  extractedText: string
  outline?: string[]
}

function buildPaperEditorPreviewHtml(markdown: string, structuredBlocks?: EmbeddedPayloadBlock[], ooxmlSnapshot?: PaperOoxmlSnapshot): string {
  const cleanedMarkdown = normalizeDocumentResultMarkdown(markdown)
  return buildPaperGenerationPreviewContent(cleanedMarkdown, structuredBlocks, ooxmlSnapshot)
}

const ModeRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
`

const ModeGroup = styled.div`
  display: inline-flex;
  gap: 6px;
`

const ModeBtn = styled.button<{ $active: boolean }>`
  height: 28px;
  border-radius: 999px;
  border: 1px solid ${p => p.$active ? '#2f62d8' : '#d6e0ea'};
  background: ${p => p.$active ? '#eaf3ff' : '#ffffff'};
  color: ${p => p.$active ? '#0e639c' : '#627385'};
  font-size: var(--font-size-xs);
  padding: 0 12px;
  cursor: pointer;
  &:disabled { opacity: 0.45; cursor: not-allowed; }
`

const ScopeHint = styled.div`
  color: #627385;
  font-size: var(--font-size-xs);
`

const DialogHintStrip = styled.div`
  border: 1px solid #dbe6f1;
  border-radius: 12px;
  background: linear-gradient(180deg, #f8fbff 0%, #eef5fd 100%);
  padding: 10px 12px;
  color: #35516d;
  font-size: var(--font-size-xs);
  line-height: 1.65;
`

const SelectionPreview = styled.div`
  border: 1px solid #dce5ef;
  border-radius: 8px;
  background: #f8fbff;
  padding: 8px 10px;
`

const SelectionLabel = styled.div`
  color: #3d5b78;
  font-size: var(--font-size-xs);
  margin-bottom: 4px;
`

const SelectionText = styled.div`
  color: #304255;
  font-size: var(--font-size-xs);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
`

const KnowledgeHintRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`

const KnowledgeSelectorRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
`

const KnowledgeSelectorSummary = styled.div`
  color: #3d5b78;
  font-size: var(--font-size-xs);
  line-height: 1.4;
`

const KnowledgeSelectorPanel = styled.div`
  border: 1px solid #dce5ef;
  border-radius: 10px;
  background: #f8fbff;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
`

const KnowledgeSelectorHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
`

const KnowledgeSelectorTitle = styled.div`
  color: #304255;
  font-size: var(--font-size-sm);
  font-weight: 600;
`

const KnowledgeSelectorSubtext = styled.div`
  color: #627385;
  font-size: var(--font-size-xs);
  line-height: 1.5;
`

const KnowledgeSelectorTools = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`

const KnowledgeSelectorSearch = styled.input`
  flex: 1;
  min-width: 220px;
  height: 34px;
  border-radius: 8px;
  border: 1px solid #d6e0ea;
  background: #ffffff;
  color: #304255;
  padding: 0 10px;
  font-size: var(--font-size-xs);
  outline: none;
  &:focus { border-color: #4ea1ff; }
`

const KnowledgeSelectorList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 240px;
  overflow-y: auto;
`

const KnowledgeSelectorItem = styled.div<{ $template?: boolean; $reference?: boolean }>`
  border: 1px solid ${p => p.$template ? '#9bbcf7' : p.$reference ? '#c9d9f6' : '#dce5ef'};
  border-radius: 10px;
  background: ${p => p.$template ? '#eef4ff' : p.$reference ? '#f4f8ff' : '#ffffff'};
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const KnowledgeSelectorItemTop = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
`

const KnowledgeSelectorItemMain = styled.div`
  min-width: 0;
`

const KnowledgeSelectorItemTitle = styled.div`
  color: #304255;
  font-size: var(--font-size-sm);
  font-weight: 600;
  line-height: 1.4;
`

const KnowledgeSelectorItemMeta = styled.div`
  color: #627385;
  font-size: var(--font-size-xs);
  line-height: 1.4;
  margin-top: 2px;
`

const KnowledgeSelectorItemPreview = styled.div`
  color: #4f647a;
  font-size: var(--font-size-xs);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
`

const KnowledgeSelectorControls = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
`

const KnowledgeSelectorToggle = styled.label<{ $disabled?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: ${p => p.$disabled ? '#9aa8b6' : '#304255'};
  font-size: var(--font-size-xs);
  cursor: ${p => p.$disabled ? 'not-allowed' : 'pointer'};
`

const KnowledgeSelectorEmpty = styled.div`
  color: #627385;
  font-size: var(--font-size-xs);
  line-height: 1.6;
  border: 1px dashed #d6e0ea;
  border-radius: 8px;
  background: #ffffff;
  padding: 12px;
`

const KnowledgeHintTag = styled.span<{ $accent?: boolean }>`
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid ${p => p.$accent ? '#9bbcf7' : '#d6e0ea'};
  background: ${p => p.$accent ? '#eef4ff' : '#f8fbff'};
  color: ${p => p.$accent ? '#254f9b' : '#627385'};
  font-size: var(--font-size-xs);
  font-weight: 600;
`

const KnowledgePreviewPanel = styled.div`
  border: 1px solid #dce5ef;
  border-radius: 10px;
  background: #f8fbff;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const KnowledgePreviewTitle = styled.div`
  color: #304255;
  font-size: var(--font-size-xs);
  font-weight: 600;
`

const KnowledgePreviewBody = styled.div`
  color: #627385;
  font-size: var(--font-size-xs);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
`

const TemplatePresetRow = styled.div`
  border: 1px solid #dce5ef;
  border-radius: 10px;
  background: linear-gradient(180deg, #f8fbff 0%, #ffffff 100%);
  padding: 10px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
`

const TemplatePresetCopy = styled.div`
  min-width: 0;
  flex: 1;
`

const TemplatePresetTitle = styled.div`
  color: #304255;
  font-size: var(--font-size-sm);
  font-weight: 600;
`

const TemplatePresetDesc = styled.div`
  margin-top: 4px;
  color: #627385;
  font-size: var(--font-size-xs);
  line-height: 1.5;
`

const TemplatePresetActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`

const TemplatePresetButton = styled.button<{ $primary?: boolean }>`
  height: 32px;
  border-radius: 999px;
  border: 1px solid ${p => p.$primary ? '#2f62d8' : '#d6e0ea'};
  background: ${p => p.$primary ? '#2e68e6' : '#ffffff'};
  color: ${p => p.$primary ? '#ffffff' : '#304255'};
  font-size: var(--font-size-xs);
  font-weight: 600;
  padding: 0 12px;
  cursor: pointer;
  &:disabled { opacity: 0.55; cursor: not-allowed; }
`

function htmlToPlainText(html: string): string {
  return String(html || '')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const FULL_DOCUMENT_REWRITE_SEMANTIC_GUARD = '【核心要求】本次任务是基于当前全文进行定向改写，必须严格以当前文档已有内容为基础；优先执行用户明确提出的修改要求；对于用户未要求变更的内容，必须尽量保持原文核心语义、事实判断、结论、立场与信息边界不变；可以重组结构、改写措辞、增删细节以满足要求，但不得凭空编造事实，不得脱离原文另起一篇新文章。'

function buildFullDocumentRewriteInstruction(userInstruction: string): string {
  const trimmedInstruction = String(userInstruction || '').trim()
  return [
    '你正在处理一篇已有正文的文稿。',
    FULL_DOCUMENT_REWRITE_SEMANTIC_GUARD,
    '请根据用户要求直接输出修改后的完整全文，不要解释修改过程，不要附加摘要、说明、标题注释或清单。',
    `用户改写要求：${trimmedInstruction}`,
  ].join('\n')
}

function buildTargetedDocumentRewriteInstruction(userInstruction: string, targetLabel: string): string {
  const trimmedInstruction = String(userInstruction || '').trim()
  return [
    `你正在处理文稿中的局部片段，命中目标：${targetLabel}。`,
    '【核心要求】只允许修改当前命中的目标片段，不得扩写到其他段落；用户未要求变更的内容必须尽量保持原意、事实和表达边界稳定。',
    '如果用户要求是修改日期、数字、称谓、字段值或某个局部表述，必须直接在当前片段内完成替换。',
    '请只输出修改后的目标片段全文，不要输出整篇文稿，不要解释修改过程。',
    `用户改写要求：${trimmedInstruction}`,
  ].join('\n')
}

function hasExplicitDocumentRewriteIntent(instruction: string): boolean {
  const normalized = String(instruction || '').trim().toLowerCase()
  if (!normalized) return false

  return [
    /改写/u,
    /重写/u,
    /改成/u,
    /改为/u,
    /修改/u,
    /润色/u,
    /优化/u,
    /调整/u,
    /精简/u,
    /压缩/u,
    /扩写/u,
    /补充/u,
    /删掉/u,
    /删除/u,
    /改得/u,
    /重组/u,
    /rewrite/,
    /revise/,
    /edit\b/,
    /polish/,
    /refine/,
  ].some((pattern) => pattern.test(normalized))
}

function hasExplicitPaperGenerationIntent(instruction: string): boolean {
  const normalized = String(instruction || '').trim().toLowerCase()
  if (!normalized) return false
  if (normalized.length < 4) return false

  const strongPatterns: RegExp[] = [
    /生成.{0,12}论文/u,
    /写.{0,12}论文/u,
    /主题.{0,16}论文/u,
    /论文题目/u,
    /研究论文/u,
    /综述论文/u,
    /学位论文/u,
    /毕业论文/u,
    /开题报告/u,
    /\breview paper\b/i,
    /\bthesis\b/i,
  ]
  if (strongPatterns.some((pattern) => pattern.test(normalized))) return true

  // Fallback: contains论文 and generation-ish verb together.
  const hasPaperNoun = /论文/u.test(normalized) || /\bpaper\b/i.test(normalized)
  const hasGenerationVerb = /(生成|撰写|写作|写一篇|起草|输出|完成)/u.test(normalized)
  return hasPaperNoun && hasGenerationVerb
}

function buildIllustrationPromptSource(text: string): string {
  return stripPreamble(stripThinkTags(String(text || '')))
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[[^\]]+\]\([^)]+\)/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractTemplateOutline(text: string): string[] {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const headingCandidates = lines.filter((line) => {
    if (line.length > 36) return false
    if (/^(第[一二三四五六七八九十百]+[章节部分]|[0-9]{1,2}(\.[0-9]{1,2})*|[一二三四五六七八九十]+[、.])/.test(line)) return true
    if (/^(摘要|引言|背景|概述|方法|研究方法|结果|讨论|结论|建议|实施路径|风险分析|附录|Abstract|Introduction|Background|Method|Methods|Results|Discussion|Conclusion|Recommendations|Appendix)$/i.test(line)) return true
    return false
  })

  if (headingCandidates.length >= 3) return headingCandidates.slice(0, 8)

  return lines
    .filter((line) => line.length >= 4 && line.length <= 24)
    .slice(0, 6)
}

function matchKnowledgeDocument(item: { title: string; originalName: string; previewText: string }, query: string): boolean {
  const needle = String(query || '').trim().toLowerCase()
  if (!needle) return true
  const haystack = `${item.title}\n${item.originalName}\n${item.previewText}`.toLowerCase()
  return haystack.includes(needle)
}

function isWordKnowledgeDocument(item: { sourceType?: string } | null | undefined): boolean {
  const sourceType = String(item?.sourceType || '').trim().toLowerCase()
  return sourceType === 'doc' || sourceType === 'docx'
}

function normalizeTemplateIdentity(value: string | undefined): string {
  return String(value || '')
    .replace(/\.docx?$/i, '')
    .replace(/\s+/g, '')
    .trim()
}

function isDailyReportKnowledgeDocument(item: { title?: string; originalName?: string } | null | undefined): boolean {
  if (!item) return false
  const identities = [
    item.title,
    item.originalName,
  ].map(normalizeTemplateIdentity)
  return identities.some((value) => value === '日报模板' || value === '日报写作')
}

function isEssayKnowledgeDocument(item: { title?: string; originalName?: string } | null | undefined): boolean {
  if (!item) return false
  const identities = [
    item.title,
    item.originalName,
  ].map(normalizeTemplateIdentity)
  return identities.some((value) => value === '散文模板')
}

function extractDailyReportTopic(instruction: string): string {
  const raw = String(instruction || '').trim()
  const simplified = raw
    .replace(/^(请|帮我|麻烦)?(生成|写|做|整理|产出)(一篇|一份|一个)?/u, '')
    .replace(/(的)?(日报|专题稿|推送|文章|报告)$/u, '')
    .replace(/^[：:，,\s]+|[：:，,\s]+$/gu, '')
    .trim()
  return simplified || raw || '日报'
}

function extractEssayTopic(instruction: string): string {
  const raw = String(instruction || '').trim()
  const simplified = raw
    .replace(/^(请|帮我|麻烦)?(写|生成|创作|写一篇|写一段|做一篇)(一篇|一段|一则)?/u, '')
    .replace(/(的)?(散文|文章|随笔|短文)$/u, '')
    .replace(/^[：:，,\s]+|[：:，,\s]+$/gu, '')
    .trim()
  return simplified || raw || '散文'
}

function sanitizeFileSegment(value: string): string {
  const normalized = String(value || '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return (normalized || '日报').slice(0, 28)
}

function buildDraftFileName(seed: string): string {
  const now = new Date()
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
  return `${sanitizeFileSegment(seed)}-${stamp}.aidoc.json`
}

function normalizeDraftFileName(value: string, fallbackSeed: string): string {
  const raw = String(value || '').trim()
  if (!raw) return buildDraftFileName(fallbackSeed)
  const normalized = sanitizeFileSegment(raw.replace(/\.aidoc\.json$/i, '').replace(/\.docx$/i, ''))
  return `${normalized || sanitizeFileSegment(fallbackSeed)}.aidoc.json`
}

async function waitForUnsavedTabId(
  getTabs: () => Array<{ id: string; filePath: string | null; fileName: string }>,
  getActiveTabId: () => string,
  fileName: string,
  knownTabIds: Set<string>,
  reusableTabId?: string | null,
): Promise<string | null> {
  // Only return when the tab is both created AND is the active tab — this ensures
  // setTabShellContent will call setMarkdownRaw so TipTap receives the content.
  for (let index = 0; index < 40; index += 1) {
    const currentTabs = getTabs()
    const activeTab = currentTabs.find((tab) => tab.id === getActiveTabId()) || null
    if (activeTab && !activeTab.filePath && activeTab.fileName === fileName && (!knownTabIds.has(activeTab.id) || activeTab.id === reusableTabId)) {
      return activeTab.id
    }
    await new Promise((resolve) => window.setTimeout(resolve, 40))
  }
  return null
}

type DocumentKnowledgeSnippet = {
  knowledgeBaseId: string
  knowledgeName: string
  sourceTitle: string
  content: string
  score: number
  hit: PreviewKnowledgeTaskContextResult['retrievedHits'][number]
  citation?: PreviewKnowledgeTaskContextResult['citations'][number]
}

function truncateKnowledgeSnippet(value: string, maxLength = 900): string {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim()
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized
}

function isRelevantKnowledgeHit(hit: PreviewKnowledgeTaskContextResult['retrievedHits'][number]): boolean {
  const matchedBy = Array.isArray(hit.matchedBy) ? hit.matchedBy : []
  if (matchedBy.some((item) => item === 'keyword' || item === 'summary' || item === 'title')) return true
  return Number(hit.score || 0) > 1
}

function buildDocumentKnowledgeContext(snippets: DocumentKnowledgeSnippet[]): string | undefined {
  if (!snippets.length) return undefined
  const blocks = snippets.slice(0, 8).map((snippet, index) => [
    `[资料 ${index + 1}]`,
    `来源：${snippet.knowledgeName} / ${snippet.sourceTitle || '未命名资料'}`,
    `内容：${snippet.content}`,
  ].join('\n'))

  return [
    '以下是用户选择的知识库中检索到的相关资料。请只在相关时使用，不要编造资料中没有的信息。',
    '',
    ...blocks,
    '',
    '生成要求：',
    '1. 默认使用简体中文。',
    '2. 结合用户指令和知识库资料生成完整文稿。',
    '3. 如果知识库资料与用户指令相关，请优先使用资料中的事实、流程、政策、名称、时间、地点、材料要求等。',
    '4. 如果知识库资料不足，不要编造。',
    '5. 文稿要自然、完整、结构清晰。',
    '6. 不要在正文中出现“根据知识库片段”“根据检索结果”“系统上下文”等内部字样。',
  ].join('\n')
}

function buildKnowledgeQuery(parts: {
  userPrompt: string
  currentDocumentTitle?: string
  currentDocumentText?: string
  selectedTemplateName?: string
  documentMode?: string
}): string {
  return [
    parts.userPrompt,
    parts.currentDocumentTitle,
    parts.currentDocumentText ? parts.currentDocumentText.slice(0, 3000) : '',
    parts.selectedTemplateName,
    parts.documentMode,
  ].filter(Boolean).join('\n')
}

function userExplicitlyRequestsEnglish(text: string): boolean {
  const value = String(text || '')
  const lower = value.toLowerCase()
  if (/不要英文|无需英文|不用英文|非英文|不是英文|no english|not in english|do not (?:use|write|output).*english/.test(lower)) {
    return false
  }
  return /用英文|使用英文|输出英文|生成英文|写成英文|英文版|英语版|英文输出/i.test(value)
    || /\b(?:in|write|written|generate|output|respond)\s+(?:in\s+)?english\b/i.test(value)
    || /\benglish\s+(?:version|output|article|document)\b/i.test(value)
}

function resolveDocumentOutputLanguage(instruction: string): 'zh-CN' | 'en-US' {
  return userExplicitlyRequestsEnglish(instruction) ? 'en-US' : 'zh-CN'
}

const GenerationComposer: React.FC<Props> = ({
  open,
  presentation = 'modal',
  autoTopic,
  autoStartNonce,
  manualEditNonce = 0,
  manualEditTabId,
  initialMode = 'document',
  preferredDocumentFlow = 'auto',
  autoRunOnOpen = false,
  targetTabId,
  selectionText,
  selectionRange,
  selectionStructureContext,
  onClose,
  onApplySelectionRewrite,
  onResolveDocumentRewriteTarget,
  onShadowTextChange,
  onRunningChange,
  onPauseChange,
  onPaperStreamStart,
  onPaperStreamAppend,
  onPaperStreamSync,
  onPaperStreamComplete,
}) => {
  const { activeTabId, openTab, switchTab, setStatusMessage, setTabShellContent, tabs, mainTabId, markTabShellSaved, ensureWritableManuscriptTarget } = useDocument()
  const workbench = useGenerationWorkbench()
  const { generationMode } = useWorkspaceMode()
  const {
    info: knowledgeInfo,
    documents,
    departmentId: knowledgeDepartmentId,
  } = useKnowledge()
  const { departments: knowledgeDepartments } = useDepartment()
  const { selectedFiles: personalLibrarySelectedFiles } = usePersonalLibrary()
  const { activeWorkspacePath, refreshTree } = useWorkspace()
  const { runtime } = useDocumentEngineRuntime()
  const { sessions: editorSessions, ensureSession, getSession, patchSession, canStartWritingTask } = useEditorSession()
  const { workspaceKbIds } = useDocumentWorkspaceKnowledge()
  const [input, setInput] = useState('')
  const [status, setStatus] = useState('')
  const [dragging, setDragging] = useState(false)
  const [attachments, setAttachments] = useState<AttachmentItem[]>([])
  const [running, setRunning] = useState(false)
  const [paused, setPaused] = useState(false)
  const [knowledgePickerOpen, setKnowledgePickerOpen] = useState(false)
  const assistantMode: AssistantTargetMode = 'document'
  const abortRef = useRef<AbortController | null>(null)
  const autoStartRef = useRef<number | undefined>(undefined)
  const originalContentRef = useRef('')
  const stopRequestedRef = useRef(false)
  const taskIdRef = useRef<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const paperEventDisposeRef = useRef<(() => void) | null>(null)
  const essayTaskIdRef = useRef<string | null>(null)
  const essayPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const essayEventDisposeRef = useRef<(() => void) | null>(null)
  const dailyReportTaskIdRef = useRef<string | null>(null)
  const dailyReportPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const dailyReportEventDisposeRef = useRef<(() => void) | null>(null)
  const suppressTerminalOverlayRef = useRef(false)
  const typewriterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const typewriterRenderedRef = useRef('')
  const typewriterTargetRef = useRef('')
  const typewriterTabRef = useRef('')
  const typewriterBackendUrlRef = useRef('local://electron-main')
  const imagePathMapRef = useRef<Record<string, string>>({})
  const pendingImagePersistRef = useRef<Set<string>>(new Set())
  const latestPaperMarkdownRef = useRef('')
  const latestStreamAppendedMarkdownRef = useRef('')
  const lastSyncedContentRef = useRef('')
  const paperGenerationTabIdRef = useRef<string | null>(null)
  const tabsRef = useRef(tabs)
  const activeEditorTabIdRef = useRef(activeTabId)
  const manualEditGuardRef = useRef<{ tabId: string; blocked: boolean; lastNonce: number }>({ tabId: '', blocked: false, lastNonce: 0 })
  const [settings, setSettings] = useState(() => getAIToolSettings())
  const taskTemplateDocument: { title?: string; originalName?: string } | null = null
  const taskTemplateDocumentId: string | null = null
  const effectiveTaskReferenceDocumentIds: string[] = []
  const imageSession = workbench.sessions.image
  const imageSessionDocumentIds = useMemo(
    () => imageSession.imageReferences.map((item) => item.id),
    [imageSession.imageReferences],
  )
  const imageSessionDocuments = useMemo(
    () => orderSelectedKnowledgeDocuments(documents, imageSessionDocumentIds, imageSession.primaryAssetId),
    [documents, imageSession.primaryAssetId, imageSessionDocumentIds],
  )
  const imageSessionPrimaryReferenceId = useMemo(
    () => getPrimaryStyleReferenceId(imageSession.imageReferences),
    [imageSession.imageReferences],
  )
  const imageSessionActiveStyleProfile = useMemo(
    () => resolveActiveImageStyleProfile(imageSession.lastImageStyleProfile, imageSessionPrimaryReferenceId),
    [imageSession.lastImageStyleProfile, imageSessionPrimaryReferenceId],
  )
  useEffect(() => subscribeToAIToolSettingsUpdates(setSettings), [])

  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

  useEffect(() => {
    activeEditorTabIdRef.current = activeTabId
  }, [activeTabId])

  const buildTaskConstraints = useCallback((): KnowledgeTaskConstraints => buildKnowledgeTaskConstraints({
    mode: 'auto',
    templateDocumentId: null,
    requiredReferenceDocumentIds: [],
    preferredReferenceDocumentIds: [],
    autoRetrievalLimit: 10,
    templateInheritance: { structure: true, tone: true, terminology: true },
  }), [])

  const readTaskIds = useCallback((): string[] => {
    try {
      const raw = localStorage.getItem('ai_writer_my_task_ids')
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.map((value) => String(value)).filter(Boolean) : []
    } catch {
      return []
    }
  }, [])

  const writeTaskIds = useCallback((ids: string[]) => {
    localStorage.setItem('ai_writer_my_task_ids', JSON.stringify(Array.from(new Set(ids.map((value) => String(value)).filter(Boolean))).slice(-100)))
  }, [])

  const stopPolling = useCallback(() => {
    if (!pollRef.current) return
    clearInterval(pollRef.current)
    pollRef.current = null
  }, [])

  const stopPaperEventStream = useCallback(() => {
    paperEventDisposeRef.current?.()
    paperEventDisposeRef.current = null
  }, [])

  const stopEssayRuntime = useCallback(() => {
    if (essayPollTimerRef.current) {
      clearInterval(essayPollTimerRef.current)
      essayPollTimerRef.current = null
    }
    essayEventDisposeRef.current?.()
    essayEventDisposeRef.current = null
    essayTaskIdRef.current = null
  }, [])

  useEffect(() => () => {
    stopEssayRuntime()
  }, [stopEssayRuntime])

  const stopDailyReportRuntime = useCallback(() => {
    if (dailyReportPollTimerRef.current) {
      clearInterval(dailyReportPollTimerRef.current)
      dailyReportPollTimerRef.current = null
    }
    dailyReportEventDisposeRef.current?.()
    dailyReportEventDisposeRef.current = null
    dailyReportTaskIdRef.current = null
  }, [])

  useEffect(() => () => {
    stopDailyReportRuntime()
  }, [stopDailyReportRuntime])

  const syncTypewriterPreview = useCallback((markdown: string, tabId: string, structuredBlocks?: EmbeddedPayloadBlock[], ooxmlSnapshot?: PaperOoxmlSnapshot) => {
    if (!markdown || !tabId) return
    if (onPaperStreamSync) {
      const handled = onPaperStreamSync({ tabId, markdown, backendUrl: typewriterBackendUrlRef.current })
      // If handled (true or undefined), we're done. Only fall through if explicitly returned false.
      if (handled !== false) return
    }
    const html = buildPaperEditorPreviewHtml(markdown, structuredBlocks, ooxmlSnapshot)
    setTabShellContent(tabId, html)
    window.dispatchEvent(new CustomEvent('ai-writer-paper-preview-sync', {
      detail: {
        tabId,
        html,
        markdown,
        backendUrl: typewriterBackendUrlRef.current,
      },
    }))
  }, [onPaperStreamSync, setTabShellContent])

  /**
   * P0-1 bridge: commit generated HTML content into the workbench document
   * artifact so the canonical A4 surface picks it up.  Called only on final
   * completion, NOT during streaming deltas.
   */
  const commitGeneratedHtmlToWorkbench = useCallback((html: string, title?: string) => {
    if (!html.trim()) return
    const id = `freewrite-generated:${Date.now()}`
    const schema = normalizeDocumentSchema(buildDocumentSchemaFromHtml({
      id,
      profile: 'freewrite',
      title: title || '生成文稿',
      sourceType: 'generation',
      html,
    }))
    const artifact = createDocumentArtifact({
      id,
      profile: 'freewrite',
      document: schema,
      metadata: { source: 'generation-composer' },
    })
    workbench.setModeSession('document', (session) => ({
      ...session,
      documentArtifact: artifact,
      resultPreviewText: schema.blocks.map((b) => String(b.text || '').trim()).filter(Boolean).join('\n\n'),
      lastUpdatedAt: new Date().toISOString(),
    }))
  }, [workbench])

  const resolveStreamAppendDelta = useCallback((previousMarkdown: string, nextMarkdown: string) => {
    if (!nextMarkdown) return ''
    if (!previousMarkdown) return nextMarkdown
    if (nextMarkdown.startsWith(previousMarkdown)) {
      return nextMarkdown.slice(previousMarkdown.length)
    }
    const normalizedPrevious = previousMarkdown.replace(/\s+$/g, '')
    const normalizedNext = nextMarkdown.replace(/\s+$/g, '')
    if (normalizedPrevious && normalizedNext.startsWith(normalizedPrevious)) {
      return normalizedNext.slice(normalizedPrevious.length)
    }
    return ''
  }, [])

  const resolveTargetTab = useCallback(() => {
    if (tabs.some((t) => t.id === targetTabId)) return targetTabId
    return mainTabId
  }, [tabs, targetTabId, mainTabId])

  const effectiveSessionTabId = useMemo(() => {
    // Inline composer should follow the currently active editor tab.
    if (presentation === 'inline' && activeTabId && tabs.some((tab) => tab.id === activeTabId)) {
      return activeTabId
    }
    const resolved = resolveTargetTab()
    if (resolved && tabs.some((tab) => tab.id === resolved)) return resolved
    if (activeTabId && tabs.some((tab) => tab.id === activeTabId)) return activeTabId
    return mainTabId
  }, [activeTabId, mainTabId, presentation, resolveTargetTab, tabs])

  const selectedDocumentKnowledgeIds = useMemo(() => {
    // Per-tab selection takes precedence; fall back to workspace-level selection
    const tabKbIds = effectiveSessionTabId
      ? Array.from(new Set((editorSessions[effectiveSessionTabId]?.selectedKnowledgeBaseIds || []).map((id) => String(id || '').trim()).filter(Boolean)))
      : []
    if (tabKbIds.length > 0) return tabKbIds
    return Array.from(new Set(workspaceKbIds.map((id) => String(id || '').trim()).filter(Boolean)))
  }, [editorSessions, effectiveSessionTabId, workspaceKbIds])

  const shouldUseKnowledgeForCurrentTask = selectedDocumentKnowledgeIds.length > 0

  const selectedKnowledgeNameMap = useMemo(() => new Map(knowledgeDepartments.map((department) => [department.id, department.name])), [knowledgeDepartments])

  const selectedKnowledgeLabel = useMemo(() => {
    const count = selectedDocumentKnowledgeIds.length
    if (count === 0) return '知识库'
    if (count === 1) {
      const name = selectedKnowledgeNameMap.get(selectedDocumentKnowledgeIds[0])
      return name ? `知识库：${name.slice(0, 10)}${name.length > 10 ? '…' : ''}` : '知识库 · 1'
    }
    return `知识库 · ${count}`
  }, [selectedDocumentKnowledgeIds, selectedKnowledgeNameMap])

  const knowledgeSelectionHint = selectedDocumentKnowledgeIds.length > 0
    ? `已选择 ${selectedDocumentKnowledgeIds.length} 个知识库，生成时将自动检索相关资料。`
    : '未选择知识库，将仅根据当前指令生成。'

  const handleApplyDocumentKnowledge = useCallback((ids: string[]) => {
    if (!effectiveSessionTabId) return
    const normalized = Array.from(new Set(ids.map((id) => String(id || '').trim()).filter(Boolean)))
    patchSession(effectiveSessionTabId, { selectedKnowledgeBaseIds: normalized })
    setKnowledgePickerOpen(false)
  }, [effectiveSessionTabId, patchSession])

  const resolveDocumentTargetTab = useCallback(async () => {
    return ensureWritableManuscriptTarget({
      actionLabel: '开始全文生成',
      preferredTabId: targetTabId,
      skipSourceSavePrompt: true,
    })
  }, [ensureWritableManuscriptTarget, targetTabId])

  const setRunningState = useCallback((next: boolean) => {
    setRunning(next)
    if (effectiveSessionTabId) {
      patchSession(effectiveSessionTabId, {
        writingRunning: next,
        mode: next ? 'writing' : 'idle',
        taskPhase: next ? (paused ? 'paused' : 'running') : 'idle',
      })
    }
    onRunningChange(next)
  }, [effectiveSessionTabId, onRunningChange, patchSession, paused])

  useEffect(() => {
    if (!effectiveSessionTabId) return
    ensureSession(effectiveSessionTabId)
    const session = getSession(effectiveSessionTabId)
    if (!session) {
      // First time entering a brand-new tab: reset to a clean composer shell
      // so it won't leak previous tab's draft/status while session state is being created.
      setInput('')
      setStatus('')
      setRunning(false)
      setPaused(false)
      taskIdRef.current = null
      return
    }
    setInput(session.writingComposerDraft || '')
    setStatus(session.writingStatus || '')
    setRunning(session.writingRunning)
    setPaused(session.writingPaused)
    taskIdRef.current = session.activeTaskId
  }, [effectiveSessionTabId, ensureSession, getSession])

  useEffect(() => {
    if (!effectiveSessionTabId) return
    patchSession(effectiveSessionTabId, {
      writingComposerDraft: input,
      writingStatus: status,
      writingRunning: running,
      writingPaused: paused,
      mode: running ? 'writing' : 'idle',
      taskPhase: running ? (paused ? 'paused' : 'running') : 'idle',
      taskStatusMessage: status,
      activeTaskId: taskIdRef.current,
    })
  }, [effectiveSessionTabId, input, patchSession, paused, running, status])

  useEffect(() => {
    const onStopByTab = (event: Event) => {
      const custom = event as CustomEvent<{ tabId?: string }>
      const tabId = String(custom.detail?.tabId || '')
      if (!tabId || tabId !== effectiveSessionTabId) return
      if (!running) return
      stopRequestedRef.current = true
      setPaused(false)
      setStatus('已停止')
      setStatusMessage('已停止论文生成')
      setRunningState(false)
      stopPolling()
      stopPaperEventStream()
      const currentEssayTaskId = essayTaskIdRef.current
      if (currentEssayTaskId) void stopEssayTask(currentEssayTaskId).catch(() => undefined)
      const currentDailyTaskId = dailyReportTaskIdRef.current
      if (currentDailyTaskId) void stopDailyReportTask(currentDailyTaskId).catch(() => undefined)
      const currentTaskId = taskIdRef.current
      if (currentTaskId) void stopTask(currentTaskId).catch(() => undefined)
      abortRef.current?.abort()
    }
    window.addEventListener(EDITOR_SESSION_STOP_WRITING_EVENT, onStopByTab as EventListener)
    return () => window.removeEventListener(EDITOR_SESSION_STOP_WRITING_EVENT, onStopByTab as EventListener)
  }, [effectiveSessionTabId, running, setRunningState, setStatusMessage, stopPaperEventStream, stopPolling])

  const resetManualEditGuard = useCallback((tabId: string) => {
    manualEditGuardRef.current = {
      tabId,
      blocked: false,
      lastNonce: manualEditNonce,
    }
  }, [manualEditNonce])

  const isDocumentOverwriteBlocked = useCallback((tabId: string) => {
    return Boolean(tabId)
      && manualEditGuardRef.current.blocked
      && manualEditGuardRef.current.tabId === tabId
  }, [])

  const setDocumentContentIfAllowed = useCallback((tabId: string, html: string) => {
    if (isDocumentOverwriteBlocked(tabId)) {
      return false
    }
    setTabShellContent(tabId, html)
    return true
  }, [isDocumentOverwriteBlocked, setTabShellContent])

  const applyDocumentOnDelta = useCallback((tabId: string, cumulativeMarkdown: string) => {
    const normalized = normalizeDocumentResultMarkdown(String(cumulativeMarkdown || ''))
    if (!normalized) return false
    const html = markdownToHtml(normalized)
    return setDocumentContentIfAllowed(tabId, html)
  }, [setDocumentContentIfAllowed])

  const restoreOriginalDocumentIfAllowed = useCallback((tabId: string) => {
    if (isDocumentOverwriteBlocked(tabId)) return false
    setTabShellContent(tabId, originalContentRef.current)
    return true
  }, [isDocumentOverwriteBlocked, setTabShellContent])

  const freezeImageTargetBinding = useCallback((tabId: string) => {
    const nextSelection = selectionRange
      ? {
          from: selectionRange.from,
          to: selectionRange.to,
          anchorId: selectionRange.anchorId,
          text: String(selectionText || '').trim(),
        }
      : null
    const now = new Date().toISOString()
    workbench.setModeSession('image', (session) => ({
      ...session,
      sourceTabId: tabId,
      targetTabId: tabId,
      targetSelection: nextSelection,
      pendingImageInsertion: null,
      lastUpdatedAt: now,
    }))
    return nextSelection
  }, [selectionRange, selectionText, workbench])

  const queuePendingImageInsertion = useCallback((payload: {
    tabId: string
    src: string
    alt?: string
    title?: string
    placement: 'cursor' | 'after-selection' | 'document-end'
    widthPx?: number
    heightPx?: number
    selection: { from: number; to: number; anchorId?: string; text?: string } | null
    statusMessage?: string
  }) => {
    const now = new Date().toISOString()
    workbench.setModeSession('image', (session) => ({
      ...session,
      sourceTabId: payload.tabId,
      targetTabId: payload.tabId,
      targetSelection: payload.selection,
      pendingImageInsertion: createPendingImageInsertionState({
        tabId: payload.tabId,
        src: payload.src,
        alt: payload.alt,
        title: payload.title,
        placement: payload.placement,
        widthPx: payload.widthPx,
        heightPx: payload.heightPx,
        selection: payload.selection,
        statusMessage: payload.statusMessage,
        createdAt: now,
      }),
      lastUpdatedAt: now,
    }))
  }, [workbench])

  useEffect(() => {
    if (!running) return
    if (manualEditNonce <= manualEditGuardRef.current.lastNonce) return
    manualEditGuardRef.current.lastNonce = manualEditNonce
    if (!manualEditTabId) return
    if (manualEditGuardRef.current.tabId !== manualEditTabId) return
    manualEditGuardRef.current.blocked = true
  }, [manualEditNonce, manualEditTabId, running])

  useEffect(() => {
    onPauseChange?.(running && paused)
  }, [onPauseChange, paused, running])

  const handlePauseComposer = useCallback(async () => {
    if (!running || paused || !taskIdRef.current) return
    try {
      await pauseTask(taskIdRef.current)
      setPaused(true)
      setStatus('任务已暂停，可直接编辑当前内容')
      setStatusMessage('论文生成已暂停，当前编辑器已解锁')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatus(`暂停失败: ${message}`)
      setStatusMessage(`暂停失败: ${message}`)
    }
  }, [paused, running, setStatusMessage])

  const handleResumeComposer = useCallback(async () => {
    if (!running || !paused || !taskIdRef.current) return
    try {
      await resumeTask(taskIdRef.current)
      setPaused(false)
      setStatus('任务已继续生成')
      setStatusMessage('论文生成已继续')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatus(`继续失败: ${message}`)
      setStatusMessage(`继续失败: ${message}`)
    }
  }, [paused, running, setStatusMessage])

  const dispatchTerminalComposerHidden = useCallback(() => {
    window.dispatchEvent(new CustomEvent('ai-terminal-composer-state', {
      detail: {
        mode: 'document',
        visible: false,
        running: false,
        paused: false,
        capabilities: { canSend: true, canStop: false, canPause: false, canResume: false },
        canClose: false,
        canStop: false,
        canPause: false,
        canResume: false,
      },
    }))
  }, [])

  useEffect(() => {
    if (suppressTerminalOverlayRef.current) {
      dispatchTerminalComposerHidden()
      return
    }
    window.dispatchEvent(new CustomEvent('ai-terminal-composer-state', {
      detail: {
        mode: 'document',
        visible: open,
        running,
        paused,
        capabilities: {
          canSend: true,
          canStop: running,
          canPause: running && !paused && Boolean(taskIdRef.current),
          canResume: running && paused && Boolean(taskIdRef.current),
        },
        canClose: open,
        canStop: running,
        canPause: running && !paused && Boolean(taskIdRef.current),
        canResume: running && paused && Boolean(taskIdRef.current),
      },
    }))

    return () => {
      dispatchTerminalComposerHidden()
    }
  }, [dispatchTerminalComposerHidden, open, paused, running])

  const stopTypewriter = useCallback((flush = false) => {
    if (typewriterTimerRef.current) {
      clearTimeout(typewriterTimerRef.current)
      typewriterTimerRef.current = null
    }
    if (flush && typewriterTabRef.current) {
      typewriterRenderedRef.current = typewriterTargetRef.current
      syncTypewriterPreview(typewriterTargetRef.current, typewriterTabRef.current)
    }
  }, [syncTypewriterPreview])

  const preservePaperPreviewOnStop = useCallback((targetTab: string) => {
    const preservedMarkdown = normalizeDocumentResultMarkdown(
      typewriterTargetRef.current
      || latestPaperMarkdownRef.current
      || lastSyncedContentRef.current
      || typewriterRenderedRef.current,
    ).trim()

    if (!preservedMarkdown || !targetTab) {
      return false
    }

    stopTypewriter(false)
    typewriterTargetRef.current = preservedMarkdown
    typewriterRenderedRef.current = preservedMarkdown
    typewriterTabRef.current = targetTab
    syncTypewriterPreview(preservedMarkdown, targetTab)
    return true
  }, [stopTypewriter, syncTypewriterPreview])

  useEffect(() => {
    const handleTerminalAction = (event: Event) => {
      const detail = (event as CustomEvent<any>).detail || {}
      if (detail.action === 'pause-composer') {
        void handlePauseComposer()
        return
      }
      if (detail.action === 'resume-composer') {
        void handleResumeComposer()
        return
      }
      if (detail.action === 'stop-composer') {
        if (running) {
          stopRequestedRef.current = true
          setPaused(false)
          setStatus('已停止')
          setStatusMessage('已停止论文生成')
          setRunningState(false)
          const currentEssayTaskId = essayTaskIdRef.current
          if (currentEssayTaskId) {
            void stopEssayTask(currentEssayTaskId).catch(() => undefined)
          }
          const currentDailyTaskId = dailyReportTaskIdRef.current
          if (currentDailyTaskId) {
            void stopDailyReportTask(currentDailyTaskId).catch(() => undefined)
          }
          stopTypewriter(false)
          abortRef.current?.abort()
        }
        return
      }
      if (detail.action === 'close-composer') {
        onClose()
      }
    }

    window.addEventListener('ai-terminal-action', handleTerminalAction as EventListener)
    return () => window.removeEventListener('ai-terminal-action', handleTerminalAction as EventListener)
  }, [handlePauseComposer, handleResumeComposer, onClose, running, setRunningState, setStatusMessage, stopTypewriter])

  const pumpTypewriter = useCallback(() => {
    typewriterTimerRef.current = null
    const target = typewriterTargetRef.current
    const rendered = typewriterRenderedRef.current
    const tabId = typewriterTabRef.current
    if (!tabId || !target || rendered === target) return

    let next = target
    if (target.startsWith(rendered)) {
      const remaining = target.length - rendered.length
      const step = remaining > 2000 ? 140 : remaining > 1000 ? 96 : remaining > 400 ? 56 : 20
      next = target.slice(0, rendered.length + step)
    }

    typewriterRenderedRef.current = next
    syncTypewriterPreview(next, tabId)
    if (next !== target) {
      typewriterTimerRef.current = setTimeout(pumpTypewriter, 24)
    }
  }, [syncTypewriterPreview])

  const queueTypewriterMarkdown = useCallback((rawMarkdown: string, targetTabId: string, backendUrl: string, flush = false) => {
    const normalized = normalizeDocumentResultMarkdown(rawMarkdown)
    typewriterTargetRef.current = normalized
    typewriterTabRef.current = targetTabId
    typewriterBackendUrlRef.current = backendUrl

    if (flush || !typewriterRenderedRef.current) {
      typewriterRenderedRef.current = normalized
      stopTypewriter(false)
      syncTypewriterPreview(normalized, targetTabId)
      return
    }

    if (!normalized.startsWith(typewriterRenderedRef.current)) {
      typewriterRenderedRef.current = normalized
      stopTypewriter(false)
      syncTypewriterPreview(normalized, targetTabId)
      return
    }

    if (!typewriterTimerRef.current) {
      typewriterTimerRef.current = setTimeout(pumpTypewriter, 24)
    }
  }, [pumpTypewriter, stopTypewriter, syncTypewriterPreview])

  const normalizePaperPreviewMarkdown = useCallback((rawMarkdown: string, backendUrl: string) => {
    let normalized = normalizeDocumentResultMarkdown(rawMarkdown)
    normalized = replaceImageUrls(normalized, imagePathMapRef.current)
    normalized = fixRelativeImageUrls(normalized, backendUrl)
    latestPaperMarkdownRef.current = normalized
    return normalized
  }, [])

  const renderStablePaperPreview = useCallback((rawMarkdown: string, targetTabId: string, backendUrl: string, flush = false) => {
    const normalized = normalizePaperPreviewMarkdown(rawMarkdown, backendUrl)
    if (!normalized) return
    if (flush || !typewriterRenderedRef.current || normalized.startsWith(typewriterRenderedRef.current)) {
      queueTypewriterMarkdown(normalized, targetTabId, backendUrl, flush)
      return
    }
    typewriterTargetRef.current = normalized
    typewriterTabRef.current = targetTabId
    typewriterBackendUrlRef.current = backendUrl
  }, [normalizePaperPreviewMarkdown, queueTypewriterMarkdown])

  const buildExtraContext = useCallback(() => {
    if (attachments.length === 0) return undefined
    const parts: string[] = ['附件信息：']
    for (const file of attachments) {
      const sizeKb = Math.max(1, Math.round(file.size / 1024))
      parts.push(`- ${file.name} (${sizeKb}KB)`)
      if (file.textPreview) parts.push(`  摘要: ${file.textPreview.slice(0, 180)}`)
    }
    return parts.join('\n')
  }, [attachments])

  const buildGenerationExtraContext = useCallback(() => {
    return [
      settings.genExtraContext || '',
      buildExtraContext() || '',
    ].filter(Boolean).join('\n\n') || undefined
  }, [buildExtraContext, settings.genExtraContext])

  const buildPersonalFilesContext = useCallback(async (): Promise<string | undefined> => {
    if (!personalLibrarySelectedFiles.length) return undefined
    const api = typeof window !== 'undefined' ? (window as any).personalLibraryAPI : null
    if (!api) return undefined
    const parts: string[] = []
    for (const file of personalLibrarySelectedFiles) {
      try {
        const result = await (api.getFileContent(file.id) as Promise<{ text: string; truncated: boolean }>)
        if (result.text) {
          parts.push(`【参考文件：${file.originalName}】\n${result.text}`)
        }
      } catch {
        // best-effort: skip failed file
      }
    }
    if (parts.length === 0) return undefined
    return `以下是用户选定的参考文件内容，请在写作时参考：\n\n${parts.join('\n\n---\n\n')}`
  }, [personalLibrarySelectedFiles])

  const buildKnowledgeTemplatePayload = useCallback(async (): Promise<KnowledgeTemplatePayload | undefined> => {
    if (!taskTemplateDocumentId) return undefined
    const detail = await window.electronAPI.getKnowledgeDocument(knowledgeDepartmentId, taskTemplateDocumentId).catch(() => null)
    if (!detail) return undefined

    const extractedText = String(detail.extractedText || detail.meta.previewText || '').trim()
    if (!extractedText) return undefined

    return {
      title: String(detail.meta.title || '').trim() || '未命名模板',
      sourceType: String(detail.meta.sourceType || '').trim(),
      extractedText: extractedText.slice(0, 16000),
      outline: extractTemplateOutline(extractedText).slice(0, 10),
    }
  }, [knowledgeDepartmentId, taskTemplateDocumentId])

  const buildKnowledgeGenerationContext = useCallback(async (
    topicInstruction: string,
    documentFlow: DocumentFlow,
    currentDocumentText: string,
    currentDocumentTitle: string,
  ): Promise<{ context?: string; trace?: KnowledgeGenerationTrace; preview: PreviewKnowledgeTaskContextResult | null; snippetCount: number }> => {
    if (!shouldUseKnowledgeForCurrentTask || documentFlow === 'rewrite') {
      if (!shouldUseKnowledgeForCurrentTask) {
        setStatusMessage('未选择知识库，将仅根据当前指令生成。')
      }
      return { context: undefined, trace: undefined, preview: null, snippetCount: 0 }
    }

    const constraints = buildTaskConstraints()
    const query = buildKnowledgeQuery({
      userPrompt: topicInstruction,
      currentDocumentTitle,
      currentDocumentText,
      selectedTemplateName: taskTemplateDocument?.title,
      documentMode: documentFlow,
    })
    setStatusMessage(`正在从 ${selectedDocumentKnowledgeIds.length} 个知识库检索相关资料...`)

    const previews = await Promise.all(selectedDocumentKnowledgeIds.map(async (knowledgeBaseId) => {
      try {
        return {
          knowledgeBaseId,
          preview: await window.electronAPI.previewKnowledgeTaskContext(knowledgeBaseId, {
            instruction: query,
            query,
            constraints,
            topK: 8,
          }) as PreviewKnowledgeTaskContextResult,
        }
      } catch (error) {
        if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
          console.warn('[document-generation-knowledge] retrieval failed', {
            knowledgeBaseId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
        return { knowledgeBaseId, preview: null }
      }
    }))

    const snippets = previews.flatMap<DocumentKnowledgeSnippet>(({ knowledgeBaseId, preview }) => {
      if (!preview) return []
      const citationByChunkId = new Map(preview.citations.map((citation) => [citation.chunkId, citation]))
      return preview.retrievedHits
        .filter(isRelevantKnowledgeHit)
        .map((hit) => {
          const citation = citationByChunkId.get(hit.chunk.id)
          const sourceTitle = citation?.documentTitle
            || hit.chunk.titlePath?.[0]
            || hit.chunk.documentId
            || '未命名资料'
          return {
            knowledgeBaseId,
            knowledgeName: selectedKnowledgeNameMap.get(knowledgeBaseId) || knowledgeBaseId,
            sourceTitle,
            content: truncateKnowledgeSnippet(hit.chunk.text || hit.quote || citation?.quote || ''),
            score: Number(hit.score || 0),
            hit,
            citation,
          }
        })
        .filter((snippet) => snippet.content)
    })
      .sort((left, right) => right.score - left.score)
      .slice(0, 8)

    if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
      console.debug('[document-generation-knowledge]', {
        docId: currentDocumentTitle || effectiveSessionTabId,
        selectedKnowledgeIds: selectedDocumentKnowledgeIds,
        queryPreview: query.slice(0, 120),
        snippetCount: snippets.length,
      })
    }

    if (!snippets.length) {
      setStatusMessage('未找到高度相关的知识库内容，将按当前指令生成文稿。')
      return { context: undefined, trace: undefined, preview: null, snippetCount: 0 }
    }

    const preview: PreviewKnowledgeTaskContextResult = {
      templateSummary: undefined,
      explicitReferenceSummaries: [],
      retrievedHits: snippets.map((snippet) => snippet.hit),
      citations: snippets.map((snippet) => snippet.citation).filter(Boolean) as PreviewKnowledgeTaskContextResult['citations'],
    }

    return {
      context: buildDocumentKnowledgeContext(snippets),
      trace: buildKnowledgeGenerationTrace(preview, constraints),
      preview,
      snippetCount: snippets.length,
    }
  }, [buildTaskConstraints, effectiveSessionTabId, selectedDocumentKnowledgeIds, selectedKnowledgeNameMap, setStatusMessage, shouldUseKnowledgeForCurrentTask, taskTemplateDocument])

  const saveKnowledgeGenerationTaskRecord = useCallback(async (params: {
    taskId: string
    title: string
    status: 'submitted' | 'completed' | 'failed' | 'stopped'
    errorMessage?: string
    generationTrace?: KnowledgeGenerationTrace
  }) => {
    const constraints = buildTaskConstraints()
    const recordKnowledgeDepartmentId = selectedDocumentKnowledgeIds[0] || knowledgeDepartmentId
    if (!recordKnowledgeDepartmentId) return
    await persistKnowledgeTaskRecord({
      saveRecord: (p: any) => window.electronAPI.saveKnowledgeTaskRecord(recordKnowledgeDepartmentId, p),
      taskId: params.taskId,
      title: params.title,
      status: params.status,
      constraints,
      generationTrace: params.generationTrace,
      errorMessage: params.errorMessage,
    })
  }, [buildTaskConstraints, knowledgeDepartmentId, selectedDocumentKnowledgeIds])

  const startDailyReportGeneration = useCallback(async ({
    instruction,
    targetTabId,
    signal,
    onDelta,
  }: {
    instruction: string
    targetTabId: string
    signal: AbortSignal
    onDelta: (cumulativeMarkdown: string) => void
  }) => {
    const dailyTopic = extractDailyReportTopic(instruction)

    if (signal.aborted || stopRequestedRef.current) {
      const error = new Error('任务已停止') as Error & { uiHandled?: boolean; stopped?: boolean }
      error.uiHandled = true
      error.stopped = true
      throw error
    }

    const applyMarkdown = (markdown: string) => {
      const normalized = String(markdown || '').trim()
      if (!normalized) return
      onDelta(normalized)
    }

    const effectiveSettings = await window.electronAPI.getSettings().catch(() => null)
    const noImageMode = Boolean(effectiveSettings?.defaults?.noImageMode)

    await new Promise<void>((resolve, reject) => {
      let settled = false

      const rejectHandled = (message: string, stopped = false) => {
        if (settled) return
        settled = true
        stopDailyReportRuntime()
        const error = new Error(message) as Error & { uiHandled?: boolean; stopped?: boolean }
        error.uiHandled = true
        error.stopped = stopped
        reject(error)
      }

      const finishSuccess = async (markdown: string) => {
        if (settled) return
        settled = true
        stopDailyReportRuntime()
        applyMarkdown(markdown)
        setStatus('日报已生成到未保存草稿，请手动保存')
        setStatusMessage('日报已写入编辑器')
        resolve()
      }

      const syncTaskStatus = async () => {
        if (signal.aborted || stopRequestedRef.current) {
          rejectHandled('任务已停止', true)
          return
        }

        const taskId = dailyReportTaskIdRef.current
        if (!taskId || settled) return
        const result = await getDailyReportTaskStatus(taskId)
        const task = (result as any)?.task
        if (!task) return

        const statusMessage = String(task.status_message || '').trim()
        if (statusMessage) {
          setStatus(statusMessage)
          setStatusMessage(statusMessage)
        }

        const markdown = String(task.paper_markdown || '').trim()
        if (markdown) {
          applyMarkdown(markdown)
        }

        if (task.status === 'completed') {
          const taskResult = await getDailyReportTaskResult(taskId)
          const finalMarkdown = String((taskResult as any)?.result?.paper_markdown || (taskResult as any)?.result?.markdown || markdown).trim()
          if (!finalMarkdown) {
            rejectHandled('日报正文为空')
            return
          }
          await finishSuccess(finalMarkdown)
          return
        }

        if (task.status === 'failed') {
          rejectHandled(String(task.error || task.status_message || '日报生成失败'))
          return
        }

        if (task.status === 'interrupted') {
          setStatus('已停止当前日报生成任务')
          setStatusMessage('已停止当前日报生成任务')
          rejectHandled(String(task.error || task.status_message || '任务已停止'), true)
        }
      }

      signal.addEventListener('abort', () => {
        const currentTaskId = dailyReportTaskIdRef.current
        if (currentTaskId) {
          void stopDailyReportTask(currentTaskId).catch(() => undefined)
        }
      }, { once: true })

      void (async () => {
        try {
          const taskId = await submitDailyReportTask({
            topic: dailyTopic,
            language: 'zh',
            noImageMode,
            workspacePath: activeWorkspacePath || undefined,
          })

          if (signal.aborted || stopRequestedRef.current) {
            void stopDailyReportTask(taskId).catch(() => undefined)
          }

          dailyReportTaskIdRef.current = taskId
          setStatus(`日报任务已提交：${dailyTopic}`)
          setStatusMessage('日报任务已提交，正在生成正文')

          dailyReportEventDisposeRef.current = subscribeToDailyReportEvents(taskId, (event) => {
            if (settled) return

            if (event.type === 'progress') {
              const message = String(event.message || '').trim()
              if (message) {
                setStatus(message)
                setStatusMessage(message)
              }
              return
            }

            if (event.type === 'content') {
              const markdown = String(event.cumulativeMarkdown || event.content || '').trim()
              if (markdown) {
                applyMarkdown(markdown)
              }
              return
            }

            if (event.type === 'done') {
              void syncTaskStatus()
            }
          })

          await syncTaskStatus()
          if (!settled) {
            dailyReportPollTimerRef.current = setInterval(() => {
              void syncTaskStatus()
            }, 3000)
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          rejectHandled(message, signal.aborted || stopRequestedRef.current)
        }
      })()
    })
  }, [activeWorkspacePath, setStatusMessage, stopDailyReportRuntime])

  const startEssayGeneration = useCallback(async ({
    instruction,
    fileName,
    signal,
  }: {
    instruction: string
    fileName: string
    signal: AbortSignal
  }) => {
    const essayTopic = extractEssayTopic(instruction)
    const knownTabIds = new Set(tabsRef.current.map((tab) => tab.id))
    const reusableTabId = tabsRef.current.length === 1
      && !tabsRef.current[0].filePath
      && !String(tabsRef.current[0].content || '').trim()
      && !tabsRef.current[0].dirty
      ? tabsRef.current[0].id
      : null

    if (signal.aborted || stopRequestedRef.current) {
      const error = new Error('任务已停止') as Error & { uiHandled?: boolean; stopped?: boolean }
      error.uiHandled = true
      error.stopped = true
      throw error
    }

    await openTab(null, fileName, '')
    const targetTabId = await waitForUnsavedTabId(
      () => tabsRef.current,
      () => activeEditorTabIdRef.current,
      fileName,
      knownTabIds,
      reusableTabId,
    )

    if (!targetTabId) {
      setStatus('已取消散文生成')
      setStatusMessage('未能创建散文未保存草稿')
      const error = new Error('未能创建散文未保存草稿') as Error & { uiHandled?: boolean; stopped?: boolean }
      error.uiHandled = true
      error.stopped = true
      throw error
    }

    resetManualEditGuard(targetTabId)
    originalContentRef.current = ''

    const applyMarkdown = (markdown: string) => {
      const normalized = String(markdown || '').trim()
      if (!normalized) return false
      return setDocumentContentIfAllowed(targetTabId, markdownToHtml(normalized))
    }

    const effectiveSettings = await window.electronAPI.getSettings().catch(() => null)
    const noImageMode = Boolean(effectiveSettings?.defaults?.noImageMode)

    await new Promise<void>((resolve, reject) => {
      let settled = false

      const rejectHandled = (message: string, stopped = false) => {
        if (settled) return
        settled = true
        stopEssayRuntime()
        const error = new Error(message) as Error & { uiHandled?: boolean; stopped?: boolean }
        error.uiHandled = true
        error.stopped = stopped
        reject(error)
      }

      const finishSuccess = async (markdown: string) => {
        if (settled) return
        settled = true
        stopEssayRuntime()
        const applied = applyMarkdown(markdown)
        setStatus('散文已生成到未保存草稿，请手动保存')
        setStatusMessage(
          applied
            ? `散文已写入编辑器未保存草稿：${fileName}`
            : `散文已生成完成，但检测到你已手动编辑，未自动覆盖未保存草稿：${fileName}`,
        )
        resolve()
      }

      const syncTaskStatus = async () => {
        if (signal.aborted || stopRequestedRef.current) {
          rejectHandled('任务已停止', true)
          return
        }

        const taskId = essayTaskIdRef.current
        if (!taskId || settled) return
        const result = await getEssayTaskStatus(taskId)
        const task = (result as any)?.task
        if (!task) return

        const statusMessage = String(task.status_message || '').trim()
        if (statusMessage) {
          setStatus(statusMessage)
          setStatusMessage(statusMessage)
        }

        const markdown = String(task.paper_markdown || '').trim()
        if (markdown) {
          applyMarkdown(markdown)
        }

        if (task.status === 'completed') {
          const taskResult = await getEssayTaskResult(taskId)
          const finalMarkdown = String((taskResult as any)?.result?.paper_markdown || (taskResult as any)?.result?.markdown || markdown).trim()
          if (!finalMarkdown) {
            rejectHandled('散文正文为空')
            return
          }
          await finishSuccess(finalMarkdown)
          return
        }

        if (task.status === 'failed') {
          rejectHandled(String(task.error || task.status_message || '散文生成失败'))
          return
        }

        if (task.status === 'interrupted') {
          setStatus('已停止当前散文生成任务')
          setStatusMessage('已停止当前散文生成任务')
          rejectHandled(String(task.error || task.status_message || '任务已停止'), true)
        }
      }

      signal.addEventListener('abort', () => {
        const currentTaskId = essayTaskIdRef.current
        if (currentTaskId) {
          void stopEssayTask(currentTaskId).catch(() => undefined)
        }
      }, { once: true })

      void (async () => {
        try {
          const taskId = await submitEssayTask({
            topic: instruction,
            language: 'zh',
            noImageMode,
            workspacePath: activeWorkspacePath || undefined,
          })

          if (signal.aborted || stopRequestedRef.current) {
            void stopEssayTask(taskId).catch(() => undefined)
          }

          essayTaskIdRef.current = taskId
          setStatus(`散文任务已提交：${essayTopic}`)
          setStatusMessage('散文任务已提交，正在生成正文')

          essayEventDisposeRef.current = subscribeToEssayTaskEvents(taskId, (event) => {
            if (settled) return

            if (event.type === 'progress') {
              const message = String(event.message || '').trim()
              if (message) {
                setStatus(message)
                setStatusMessage(message)
              }
              return
            }

            if (event.type === 'content') {
              const markdown = String(event.cumulativeMarkdown || event.content || '').trim()
              if (markdown) {
                applyMarkdown(markdown)
              }
              return
            }

            if (event.type === 'done') {
              void syncTaskStatus()
            }
          })

          await syncTaskStatus()
          if (!settled) {
            essayPollTimerRef.current = setInterval(() => {
              void syncTaskStatus()
            }, 3000)
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          rejectHandled(message, signal.aborted || stopRequestedRef.current)
        }
      })()
    })
  }, [activeWorkspacePath, openTab, resetManualEditGuard, setDocumentContentIfAllowed, setStatusMessage, stopEssayRuntime])

  const resolveDocumentFlow = useCallback((sourceText: string, instruction: string): {
    flow: DocumentFlow
    reason: 'preferred' | 'rewrite-intent' | 'paper-intent' | 'default-assistant'
  } => {
    if (preferredDocumentFlow === 'paper-generation') return { flow: 'paper-generation', reason: 'preferred' }
    if (preferredDocumentFlow === 'assistant') return { flow: 'assistant', reason: 'preferred' }
    if (preferredDocumentFlow === 'rewrite') return { flow: 'rewrite', reason: 'preferred' }

    const normalizedSource = sourceText.trim()
    if (normalizedSource.length >= 40 && hasExplicitDocumentRewriteIntent(instruction)) {
      return { flow: 'rewrite', reason: 'rewrite-intent' }
    }
    if (hasExplicitPaperGenerationIntent(instruction)) {
      return { flow: 'paper-generation', reason: 'paper-intent' }
    }
    return { flow: 'assistant', reason: 'default-assistant' }
  }, [preferredDocumentFlow])

  const appendGeneratedDocumentIllustration = useCallback(async ({
    targetTab,
    generatedText,
    completedStatus,
    completedMessage,
    signal,
  }: {
    targetTab: string
    generatedText: string
    completedStatus: string
    completedMessage: string
    signal: AbortSignal
  }) => {
    if (autoRunOnOpen || settings.genNoImageMode) return
    if (!activeWorkspacePath) return

    const promptSource = buildIllustrationPromptSource(generatedText)
    if (!promptSource) return

    setStatus(`${completedStatus}，正在补充主题配图...`)
    setStatusMessage(`${completedMessage}，正在补充主题配图...`)

    try {
      /* ── try to reuse an existing KB image before generating ── */
      let kbImageUsed = false
      if (knowledgeDepartmentId) {
        try {
          const preview = await window.electronAPI.previewKnowledgeTaskContext(knowledgeDepartmentId, { instruction: promptSource.slice(0, 200), topK: 4 })
          const imageHits = (preview?.retrievedHits || []).filter((h: any) => {
            const meta = documents.find((d) => d.id === h?.chunk?.documentId)
            return meta?.sourceType === 'image' && (h.score ?? 0) > 0.7
          })
          if (imageHits.length > 0 && knowledgeInfo?.rootPath) {
            const bestHit = imageHits[0]
            const meta = documents.find((d) => d.id === bestHit?.chunk?.documentId)
            if (meta?.storedRelativePath) {
              const absPath = `${String(knowledgeInfo.rootPath).replace(/[\\/]+$/g, '')}/${String(meta.storedRelativePath).replace(/^[\\/]+/g, '')}`
              const imageData = await window.electronAPI.readImageAsDataUrl(absPath).catch(() => null)
              if (imageData?.dataUrl) {
                const filename = meta.originalName || meta.title || `kb_image_${Date.now()}.png`
                const structure = await window.electronAPI.detectProjectStructure(activeWorkspacePath)
                const saved = structure?.hasFigures
                  ? await window.electronAPI.saveImageToFiguresBase64(activeWorkspacePath, filename, imageData.dataUrl)
                  : await window.electronAPI.saveImageToWorkspace(activeWorkspacePath, filename, imageData.dataUrl)
                void refreshTree().catch(() => undefined)
                if (!signal.aborted && !stopRequestedRef.current) {
                  const imageAlt = meta.title || '知识库配图'
                  const savedImageUrl = toFileUrl(saved.path)
                  if (runtime && activeTabId === targetTab) {
                    await waitForDocumentPaint()
                    await runtime.insertAnchoredImage({ src: savedImageUrl, alt: imageAlt, title: imageAlt, placement: 'document-end', widthPx: POST_GENERATION_ILLUSTRATION_WIDTH_PX })
                  } else {
                    queuePendingImageInsertion({ tabId: targetTab, src: savedImageUrl, alt: imageAlt, title: imageAlt, placement: 'document-end', widthPx: POST_GENERATION_ILLUSTRATION_WIDTH_PX, selection: null, statusMessage: '已从知识库匹配到主题配图，回到原文稿标签后会自动插入正文末尾' })
                  }
                  setStatus(completedStatus)
                  setStatusMessage(`${completedMessage}，已从知识库匹配到主题配图并插入正文末尾`)
                  kbImageUsed = true
                }
              }
            }
          }
        } catch { /* KB search failed — fall through to AI generation */ }
      }
      if (kbImageUsed) return

      /* ── fetch KB text context to enrich image prompt ── */
      let knowledgeContext: string | undefined
      if (knowledgeDepartmentId) {
        try {
          const textPreview = await window.electronAPI.previewKnowledgeTaskContext(knowledgeDepartmentId, { instruction: promptSource.slice(0, 200), topK: 3 })
          const textHits = (textPreview?.retrievedHits || []).map((h: any) => String(h?.chunk?.text || h?.quote || '').trim()).filter(Boolean)
          if (textHits.length > 0) knowledgeContext = textHits.join('\n---\n')
        } catch { /* ignore */ }
      }

      const result = await generateSelectionImage(promptSource, settings.imageAspectRatio || '16:9', (attempt, total) => {
        if (attempt > 1) {
          setStatusMessage(`${completedMessage}，首次生图未完成，正在使用更短摘要重试 (${attempt}/${total})...`)
        }
      }, knowledgeContext)

      if (signal.aborted || stopRequestedRef.current) {
        setStatus(completedStatus)
        setStatusMessage(completedMessage)
        return
      }

      if (result.status !== 'success' || !result.image_url) {
        setStatus(completedStatus)
        setStatusMessage(`${completedMessage}；主题配图生成失败: ${result.error || '未知错误'}${result.fallbackUsed ? '，已自动尝试更短摘要。' : ''}`)
        return
      }

      const rawPath = String(result.file_path || result.image_url)
      const structure = await window.electronAPI.detectProjectStructure(activeWorkspacePath)
      const fallbackBaseName = sanitizeGeneratedName(result.alt || 'topic-illustration', 'topic-illustration', 24)
      const filename = result.filename || `${fallbackBaseName}_${Date.now()}.png`
      const saved = structure?.hasFigures
        ? await window.electronAPI.saveImageToFigures(activeWorkspacePath, rawPath, filename)
        : await window.electronAPI.saveImageFromUrl(activeWorkspacePath, rawPath, filename)
      void refreshTree().catch(() => undefined)

      if (signal.aborted || stopRequestedRef.current) {
        setStatus(completedStatus)
        setStatusMessage(completedMessage)
        return
      }

      const imageAlt = result.alt || promptSource.slice(0, 80) || '主题配图'
      const savedImageUrl = toFileUrl(saved.path)

      if (runtime && activeTabId === targetTab) {
        await waitForDocumentPaint()
        if (signal.aborted || stopRequestedRef.current || activeTabId !== targetTab) {
          setStatus(completedStatus)
          setStatusMessage(completedMessage)
          return
        }

        await runtime.insertAnchoredImage({
          src: savedImageUrl,
          alt: imageAlt,
          title: imageAlt,
          placement: 'document-end',
          widthPx: POST_GENERATION_ILLUSTRATION_WIDTH_PX,
        })

        setStatus(completedStatus)
        setStatusMessage(result.fallbackUsed
          ? `${completedMessage}，主题配图已插入正文末尾（已自动缩短摘要重试）`
          : `${completedMessage}，主题配图已插入正文末尾`)
        return
      }

      queuePendingImageInsertion({
        tabId: targetTab,
        src: savedImageUrl,
        alt: imageAlt,
        title: imageAlt,
        placement: 'document-end',
        widthPx: POST_GENERATION_ILLUSTRATION_WIDTH_PX,
        selection: null,
        statusMessage: '主题配图已生成，回到原文稿标签后会自动插入正文末尾',
      })

      setStatus(completedStatus)
      setStatusMessage(result.fallbackUsed
        ? `${completedMessage}，主题配图已生成，回到原文稿标签后会自动插入正文末尾（已自动缩短摘要重试）`
        : `${completedMessage}，主题配图已生成，回到原文稿标签后会自动插入正文末尾`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatus(completedStatus)
      setStatusMessage(`${completedMessage}；主题配图插入失败: ${message}`)
    }
  }, [activeTabId, activeWorkspacePath, autoRunOnOpen, documents, knowledgeDepartmentId, knowledgeInfo?.rootPath, queuePendingImageInsertion, refreshTree, runtime, settings.genNoImageMode, settings.imageAspectRatio, setStatusMessage])

  const runDialogImageTask = useCallback(async ({
    prompt,
    targetTab,
    signal,
  }: {
    prompt: string
    targetTab: string
    signal: AbortSignal
  }) => {
    const normalizedPrompt = String(prompt || '').trim()
    if (!normalizedPrompt) return
    const frozenSelection = freezeImageTargetBinding(targetTab)

    const setImageSessionState = (updater: Parameters<typeof workbench.setModeSession>[1]) => {
      workbench.setModeSession('image', updater)
    }

    const runningMessage = imageSession.imageReferences.length > 0
      ? `正在按图片工作区链路生成图片，并带入 ${imageSession.imageReferences.length} 张参考图...`
      : '正在按图片工作区链路生成图片...'

    setStatus(runningMessage)
    setStatusMessage(runningMessage)
    setImageSessionState((session) => ({
      ...session,
      generationPrompt: normalizedPrompt,
      generationStatus: {
        phase: 'running',
        message: runningMessage,
        updatedAt: new Date().toISOString(),
      },
      resultAssetId: null,
      resultType: null,
      resultPath: null,
      resultTitle: '',
      resultPreviewText: '',
      resultPreviewUrl: null,
      lastUpdatedAt: new Date().toISOString(),
    }))

    try {
      const { result, references, roleSummary } = await runSharedImageGeneration({
        prompt: normalizedPrompt,
        knowledgeRootPath: knowledgeInfo?.rootPath,
        documents: imageSessionDocuments,
        imageReferences: imageSession.imageReferences,
        styleOptions: imageSession.imageStyleOptions,
        generationMode: imageSession.imageGenerationMode,
        activeStyleProfile: imageSessionActiveStyleProfile,
        aspectRatio: settings.imageAspectRatio || '16:9',
        source: 'GenerationComposer.runDialogImageTask',
        debugContext: {
          targetTab,
          note: 'Free-writing dialog image request routed through shared image pipeline',
        },
        onStatus: (message) => {
          setStatus(message)
          setStatusMessage(message)
          setImageSessionState((session) => ({
            ...session,
            generationStatus: {
              phase: 'running',
              message,
              updatedAt: new Date().toISOString(),
            },
            lastUpdatedAt: new Date().toISOString(),
          }))
        },
        onStyleProfileChange: (profile) => {
          setImageSessionState((session) => ({
            ...session,
            lastImageStyleProfile: profile,
            lastUpdatedAt: new Date().toISOString(),
          }))
        },
      })

      if (signal.aborted || stopRequestedRef.current) {
        setStatus('已停止图片生成')
        setStatusMessage('已停止图片生成')
        return
      }

      if (result.status !== 'success' || !result.image_url) {
        const errorMessage = result.error || '图片生成失败'
        setStatus(`图片生成失败: ${errorMessage}`)
        setStatusMessage(`图片生成失败: ${errorMessage}`)
        setImageSessionState((session) => ({
          ...session,
          generationStatus: {
            phase: 'error',
            message: errorMessage,
            updatedAt: new Date().toISOString(),
          },
          lastUpdatedAt: new Date().toISOString(),
        }))
        return
      }

      let outputPath = String(result.file_path || result.image_url || '')
      let previewUrl = toDisplayUrl(result.image_url)
      let resultTitle = result.filename || getFileName(outputPath) || 'generated.png'

      if (activeWorkspacePath) {
        try {
          const structure = await window.electronAPI.detectProjectStructure(activeWorkspacePath)
          const sourcePath = normalizeFileLikePath(String(result.file_path || result.image_url || ''))
          const saved = structure?.hasFigures
            ? await window.electronAPI.saveImageToFigures(activeWorkspacePath, sourcePath, resultTitle)
            : await window.electronAPI.saveImageFromUrl(activeWorkspacePath, sourcePath, resultTitle)
          outputPath = saved.path
          previewUrl = toFileUrl(saved.path)
          resultTitle = saved.filename || resultTitle
          void refreshTree().catch(() => undefined)
        } catch {
          previewUrl = toDisplayUrl(result.image_url)
        }
      }

      setImageSessionState((session) => ({
        ...session,
        generationPrompt: normalizedPrompt,
        generationStatus: {
          phase: 'completed',
          message: '图片已生成，可在右侧图片工作区继续处理。',
          updatedAt: new Date().toISOString(),
        },
        resultType: 'image',
        resultAssetId: outputPath || null,
        resultPath: outputPath || null,
        resultTitle,
        resultPreviewUrl: previewUrl,
        sourceTabId: targetTab,
        targetTabId: targetTab,
        targetSelection: frozenSelection,
        lastUpdatedAt: new Date().toISOString(),
      }))

      if (activeWorkspacePath && runtime && activeTabId === targetTab) {
        await waitForDocumentPaint()
        if (!signal.aborted && !stopRequestedRef.current && activeTabId === targetTab) {
          const imageAlt = result.alt || normalizedPrompt.slice(0, 80) || '对话框生成图片'
          const imagePlacement = frozenSelection && frozenSelection.from !== frozenSelection.to ? 'after-selection' : 'cursor'
          await runtime.insertAnchoredImage({
            src: previewUrl,
            alt: imageAlt,
            title: imageAlt,
            placement: imagePlacement,
          })
          setStatus('图片已生成并插入编辑器')
          setStatusMessage(references.length > 0 ? `图片已生成并插入编辑器，参考链路：${roleSummary.join(' / ')}` : '图片已生成并插入编辑器')
          return
        }
      }

      if (activeWorkspacePath) {
        const imageAlt = result.alt || normalizedPrompt.slice(0, 80) || '对话框生成图片'
        const imagePlacement = frozenSelection && frozenSelection.from !== frozenSelection.to ? 'after-selection' : 'cursor'
        queuePendingImageInsertion({
          tabId: targetTab,
          src: previewUrl,
          alt: imageAlt,
          title: imageAlt,
          placement: imagePlacement,
          selection: frozenSelection,
          statusMessage: '图片已生成，回到原文稿标签后会自动插入',
        })
        setStatus('图片已生成，等待回写原文稿')
        setStatusMessage(references.length > 0 ? `图片已生成，回到原文稿标签后会自动插入，参考链路：${roleSummary.join(' / ')}` : '图片已生成，回到原文稿标签后会自动插入')
        return
      }

      setStatus('图片已生成，可在右侧图片工作区查看')
      setStatusMessage(references.length > 0 ? `图片已生成，可在右侧图片工作区查看，参考链路：${roleSummary.join(' / ')}` : '图片已生成，可在右侧图片工作区查看')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatus(`图片生成失败: ${message}`)
      setStatusMessage(`图片生成失败: ${message}`)
      setImageSessionState((session) => ({
        ...session,
        generationStatus: {
          phase: 'error',
          message,
          updatedAt: new Date().toISOString(),
        },
        lastUpdatedAt: new Date().toISOString(),
      }))
    }
  }, [activeTabId, activeWorkspacePath, freezeImageTargetBinding, imageSession, imageSessionActiveStyleProfile, imageSessionDocuments, knowledgeInfo?.rootPath, queuePendingImageInsertion, refreshTree, runtime, settings.imageAspectRatio, setStatusMessage, workbench])

  const runAssistantTask = useCallback(async (instruction: string) => {
    const normalizedInstruction = instruction.trim()
    if (!normalizedInstruction || running) return
    const outputLanguage = resolveDocumentOutputLanguage(normalizedInstruction)
    const generationLanguage = outputLanguage === 'en-US' ? 'en' : 'zh'

    const essayTemplateActive = isEssayKnowledgeDocument(taskTemplateDocument)
    const dailyReportTemplateActive = isDailyReportKnowledgeDocument(taskTemplateDocument) || generationMode === 'daily-report'

    let targetTab = resolveTargetTab()
    let targetContent = getEditorTabResolvedContent(tabs.find((tab) => tab.id === targetTab) || null)
    let sourceText = htmlToPlainText(targetContent)
    let routeDecision = resolveDocumentFlow(sourceText, normalizedInstruction)
    let documentFlow = routeDecision.flow
    if (!dailyReportTemplateActive && !essayTemplateActive && documentFlow !== 'paper-generation') {
      const resolvedDocumentTarget = await resolveDocumentTargetTab()
      if (!resolvedDocumentTarget) return
      targetTab = resolvedDocumentTarget.id
      targetContent = getEditorTabResolvedContent(resolvedDocumentTarget)
      sourceText = htmlToPlainText(targetContent)
      routeDecision = resolveDocumentFlow(sourceText, normalizedInstruction)
      documentFlow = routeDecision.flow
    } else if (documentFlow === 'paper-generation') {
      const existingPaperTabId = paperGenerationTabIdRef.current
      const existingPaperTab = existingPaperTabId ? tabsRef.current.find((tab) => tab.id === existingPaperTabId) : null
      if (existingPaperTab) {
        targetTab = existingPaperTab.id
        targetContent = getEditorTabResolvedContent(existingPaperTab)
        sourceText = htmlToPlainText(targetContent)
        console.info('[paper:duplicate_tab_prevented]', { targetTab, reason: 'reuse-bound-paper-generation-tab' })
        if (activeEditorTabIdRef.current !== targetTab) {
          await switchTab(targetTab)
        }
      } else {
        paperGenerationTabIdRef.current = targetTab
        console.info('[paper:tab_create]', { tabId: targetTab, reason: 'bind-current-tab-as-paper-generation' })
      }
    }
    if (!canStartWritingTask(targetTab, running)) {
      const limitMessage = `当前最多并行 ${MAX_CONCURRENT_WRITING_TASKS} 个写作任务，请先停止其他标签页任务`
      setStatus(limitMessage)
      setStatusMessage(limitMessage)
      return
    }
    resetManualEditGuard(targetTab)
    if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
      console.debug(`[flow-route] assistant -> ${documentFlow} (${routeDecision.reason})`)
    }
    const rewriteTargetResolution = documentFlow === 'rewrite' && onResolveDocumentRewriteTarget
      ? onResolveDocumentRewriteTarget({ tabId: targetTab, instruction: normalizedInstruction })
      : null
    const rewriteTarget = rewriteTargetResolution?.target || null

    if (documentFlow === 'rewrite' && rewriteTargetResolution?.mentioned && !rewriteTarget) {
      const failureMessage = rewriteTargetResolution.failureReason || '未能定位提示词中指定的改写目标。'
      setStatus(failureMessage)
      setStatusMessage(failureMessage)
      return
    }

    stopRequestedRef.current = false
    setPaused(false)
    originalContentRef.current = targetContent
    onShadowTextChange('')
    const suppressTerminalOverlay = dailyReportTemplateActive || documentFlow === 'paper-generation'
    suppressTerminalOverlayRef.current = suppressTerminalOverlay
    setRunningState(true)
    if (!suppressTerminalOverlay) {
      window.dispatchEvent(new CustomEvent('ai-terminal-open'))
    } else {
      dispatchTerminalComposerHidden()
    }

    if (isExplicitImageGenerationRequest(normalizedInstruction)) {
      const controller = new AbortController()
      abortRef.current = controller
      try {
        await runDialogImageTask({
          prompt: normalizedInstruction,
          targetTab,
          signal: controller.signal,
        })
      } finally {
        abortRef.current = null
        setPaused(false)
        setRunningState(false)
      }
      return
    }

    setStatus(
      documentFlow === 'rewrite'
        ? (rewriteTarget ? `正在按提示改写${rewriteTarget.label}...` : '正在按提示改写当前全文...')
        : essayTemplateActive
          ? '正在分析散文模板并生成散文...'
          : dailyReportTemplateActive
            ? '正在分析日报模板并生成日报...'
            : documentFlow === 'template-driven'
              ? '正在分析知识模板并生成全文...'
              : documentFlow === 'paper-generation'
                ? '正在按论文模式生成论文...'
                : '正在生成全文内容...'
    )
    setStatusMessage(
      documentFlow === 'rewrite'
        ? (rewriteTarget ? `已定位到${rewriteTarget.label}，正在执行定点改写...` : '正在根据你的要求改写当前全文...')
        : essayTemplateActive
          ? '正在分析散文模板，并按散文专用链路生成内容...'
          : dailyReportTemplateActive
            ? '正在分析日报模板，并按日报专用链路生成内容...'
            : documentFlow === 'template-driven'
              ? '正在分析知识模板，并按模板风格生成全文...'
              : documentFlow === 'paper-generation'
                ? '正在按论文类型设定生成论文...'
                : 'AI 写作助手正在生成全文内容...'
    )

    const controller = new AbortController()
    abortRef.current = controller

    try {
      if (rewriteTarget?.batchReplacementEdits?.length) {
        const edits = rewriteTarget.batchReplacementEdits
          .slice()
          .sort((left, right) => right.from - left.from)

        for (const edit of edits) {
          const applied = onApplySelectionRewrite({
            tabId: targetTab,
            from: edit.from,
            to: edit.to,
            anchorId: edit.anchorId,
            text: edit.text,
          })
          if (!applied) {
            setStatus(`${rewriteTarget.label}批量替换失败`)
            setStatusMessage(`${rewriteTarget.label}批量替换失败，未能完整写回编辑器`)
            return
          }
        }

        setStatus(`${rewriteTarget.label}已批量替换`)
        setStatusMessage(`已将${rewriteTarget.label}共 ${edits.length} 处直接替换为“${rewriteTarget.directReplacementText || edits[0]?.text || ''}”`)
        return
      }

      if (rewriteTarget?.directReplacementText !== undefined) {
        const applied = onApplySelectionRewrite({
          tabId: targetTab,
          from: rewriteTarget.from,
          to: rewriteTarget.to,
          anchorId: rewriteTarget.anchorId,
          text: rewriteTarget.directReplacementText,
        })
        if (!applied) {
          setStatus(`${rewriteTarget.label}替换失败`)
          setStatusMessage(`${rewriteTarget.label}替换失败，未能自动写回编辑器`)
          return
        }
        setStatus(`${rewriteTarget.label}已规则化替换`)
        setStatusMessage(`已将${rewriteTarget.label}直接替换为“${rewriteTarget.directReplacementText}”`)
        return
      }

      const targetTabTitle = tabs.find((tab) => tab.id === targetTab)?.fileName || ''
      const [knowledgeBundle, personalFilesContext] = await Promise.all([
        buildKnowledgeGenerationContext(normalizedInstruction, documentFlow, sourceText, targetTabTitle),
        buildPersonalFilesContext(),
      ])
      const knowledgeContext = knowledgeBundle.context
      const knowledgeTrace = knowledgeBundle.trace
      const knowledgeSnippetCount = knowledgeBundle.snippetCount
      const inlineKnowledgeTaskId = documentFlow !== 'paper-generation' && shouldUseKnowledgeForCurrentTask
        ? `knowledge-inline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        : null

      if (inlineKnowledgeTaskId) {
        void saveKnowledgeGenerationTaskRecord({ taskId: inlineKnowledgeTaskId, title: normalizedInstruction, status: 'submitted', generationTrace: knowledgeTrace }).catch(() => undefined)
      }

      if (dailyReportTemplateActive) {
        const dailyReportFileName = normalizeDraftFileName('', `${extractDailyReportTopic(normalizedInstruction)}_日报`)
        const knownDailyTabIds = new Set(tabsRef.current.map((tab) => tab.id))
        const reusableDailyTabId = tabsRef.current.length === 1
          && !tabsRef.current[0].filePath
          && !String(tabsRef.current[0].content || '').trim()
          && !tabsRef.current[0].dirty
          ? tabsRef.current[0].id
          : null
        await openTab(null, dailyReportFileName, '')
        const dailyTabId = await waitForUnsavedTabId(
          () => tabsRef.current,
          () => activeEditorTabIdRef.current,
          dailyReportFileName,
          knownDailyTabIds,
          reusableDailyTabId,
        )
        if (!dailyTabId) {
          setStatus('已取消日报生成')
          setStatusMessage('未能创建日报未保存草稿')
          return
        }
        resetManualEditGuard(dailyTabId)
        originalContentRef.current = ''
        try {
          await startDailyReportGeneration({
            instruction: normalizedInstruction,
            targetTabId: dailyTabId,
            signal: controller.signal,
            onDelta: (cumulativeMarkdown) => {
              applyDocumentOnDelta(dailyTabId, cumulativeMarkdown)
            },
          })
          if (inlineKnowledgeTaskId) {
            void saveKnowledgeGenerationTaskRecord({ taskId: inlineKnowledgeTaskId, title: normalizedInstruction, status: 'completed', generationTrace: knowledgeTrace }).catch(() => undefined)
          }
        } catch (error) {
          const handledError = error as Error & { uiHandled?: boolean; stopped?: boolean }
          const message = error instanceof Error ? error.message : String(error)
          if (!handledError.uiHandled) {
            setStatus(`日报生成失败: ${message}`)
            setStatusMessage(`日报生成失败: ${message}`)
          }
          if (inlineKnowledgeTaskId) {
            void saveKnowledgeGenerationTaskRecord({
              taskId: inlineKnowledgeTaskId,
              title: normalizedInstruction,
              status: handledError.stopped ? 'stopped' : 'failed',
              errorMessage: message,
              generationTrace: knowledgeTrace,
            }).catch(() => undefined)
          }
        }
        return
      }

      if (essayTemplateActive) {
        try {
          await startEssayGeneration({
            instruction: normalizedInstruction,
            fileName: normalizeDraftFileName('', `${extractEssayTopic(normalizedInstruction)}_散文`),
            signal: controller.signal,
          })
          if (inlineKnowledgeTaskId) {
            void saveKnowledgeGenerationTaskRecord({ taskId: inlineKnowledgeTaskId, title: normalizedInstruction, status: 'completed', generationTrace: knowledgeTrace }).catch(() => undefined)
          }
        } catch (error) {
          const handledError = error as Error & { uiHandled?: boolean; stopped?: boolean }
          const message = error instanceof Error ? error.message : String(error)
          if (!handledError.uiHandled) {
            setStatus(`散文生成失败: ${message}`)
            setStatusMessage(`散文生成失败: ${message}`)
          }
          if (inlineKnowledgeTaskId) {
            void saveKnowledgeGenerationTaskRecord({
              taskId: inlineKnowledgeTaskId,
              title: normalizedInstruction,
              status: handledError.stopped ? 'stopped' : 'failed',
              errorMessage: message,
              generationTrace: knowledgeTrace,
            }).catch(() => undefined)
          }
        }
        return
      }

      if (documentFlow === 'template-driven') {
        const templateDocument = await buildKnowledgeTemplatePayload()
        if (!templateDocument) {
          throw new Error('所选知识库 Word 模板无法读取有效正文')
        }
        const minimalRules = buildMinimalWritingRuleText('document-generate')

        await runWritingAssistant(
          {
            instruction: normalizedInstruction,
            documentText: sourceText,
            language: generationLanguage,
            outputLanguage,
            extraContext: [buildGenerationExtraContext(), knowledgeContext || '', personalFilesContext || '', minimalRules].filter(Boolean).join('\n\n') || undefined,
            generationMode: 'knowledge-template-document',
            templateDocument,
          },
          {
            onStatus: (message) => {
              setStatus(message)
              setStatusMessage(message)
            },
            onDelta: (_delta, accumulated) => {
              setDocumentContentIfAllowed(targetTab, markdownToHtml(accumulated))
            },
            onComplete: async ({ text }) => {
              const completedStatus = '模板驱动全文已生成完成'
              const normalizedText = normalizeDocumentResultMarkdown(text)
              const knowledgeRefSection = !markdownHasReferencesSection(normalizedText) ? buildKnowledgeReferenceMarkdown(knowledgeTrace) : ''
              const finalText = knowledgeRefSection ? normalizedText.trimEnd() + '\n' + knowledgeRefSection : normalizedText
              const normalizedHtml = markdownToHtml(finalText)
              const applied = setDocumentContentIfAllowed(targetTab, normalizedHtml)
              const completedMessage = applied ? '已完成基于知识模板的全文生成' : '已完成基于知识模板的全文生成；检测到你已手动编辑，结果未自动覆盖正文'
              const userFacingCompletedMessage = knowledgeSnippetCount > 0
                ? '已参考知识库内容生成文稿。'
                : (shouldUseKnowledgeForCurrentTask ? '未找到高度相关的知识库内容，已按当前指令生成文稿。' : completedMessage)
              if (applied) {
                commitGeneratedHtmlToWorkbench(normalizedHtml)
              }
              setStatus(completedStatus)
              setStatusMessage(userFacingCompletedMessage)
              if (applied) {
                await appendGeneratedDocumentIllustration({
                  targetTab,
                  generatedText: text,
                  completedStatus,
                  completedMessage,
                  signal: controller.signal,
                })
              }
              if (inlineKnowledgeTaskId) {
                void saveKnowledgeGenerationTaskRecord({ taskId: inlineKnowledgeTaskId, title: normalizedInstruction, status: 'completed', generationTrace: knowledgeTrace }).catch(() => undefined)
              }
            },
            onError: (error) => {
              if (stopRequestedRef.current || controller.signal.aborted) {
                const restored = restoreOriginalDocumentIfAllowed(targetTab)
                setStatus(restored ? '已停止，原文已恢复' : '已停止，保留当前手动编辑内容')
                setStatusMessage(restored ? '已停止模板驱动全文生成，原文已恢复' : '已停止模板驱动全文生成，保留当前手动编辑内容')
                if (inlineKnowledgeTaskId) {
                  void saveKnowledgeGenerationTaskRecord({ taskId: inlineKnowledgeTaskId, title: normalizedInstruction, status: 'stopped', generationTrace: knowledgeTrace }).catch(() => undefined)
                }
                return
              }

              const restored = restoreOriginalDocumentIfAllowed(targetTab)
              setStatus(`模板生成失败: ${error}`)
              setStatusMessage(restored ? `模板驱动全文生成失败: ${error}` : `模板驱动全文生成失败，但已保留你的手动编辑内容: ${error}`)
              if (inlineKnowledgeTaskId) {
                void saveKnowledgeGenerationTaskRecord({ taskId: inlineKnowledgeTaskId, title: normalizedInstruction, status: 'failed', errorMessage: error, generationTrace: knowledgeTrace }).catch(() => undefined)
              }
            },
          },
          controller.signal,
        )
        return
      }

      if (documentFlow === 'paper-generation') {
        const backendUrl = 'local://electron-main'
        if (activeWorkspacePath) {
          await Promise.all([
            window.electronAPI.createWorkspaceFolder(activeWorkspacePath, 'pic'),
            window.electronAPI.createWorkspaceFolder(activeWorkspacePath, 'reference'),
          ])
          await refreshTree().catch(() => undefined)
        }
        typewriterRenderedRef.current = ''
        typewriterTargetRef.current = ''
        typewriterTabRef.current = targetTab
        imagePathMapRef.current = {}
        latestPaperMarkdownRef.current = ''
        latestStreamAppendedMarkdownRef.current = ''
        lastSyncedContentRef.current = ''
        taskIdRef.current = null
        patchSession(targetTab, { activeTaskId: null })
        stopPolling()
        stopPaperEventStream()
        stopTypewriter(false)
        console.info('[paper:tab_update]', { tabId: targetTab, phase: 'stream-start' })
        setTabShellContent(targetTab, '')
        onPaperStreamStart?.(targetTab)

        await new Promise<void>(async (resolve) => {
          let settled = false

          const finish = () => {
            if (settled) return
            settled = true
            stopPolling()
            stopPaperEventStream()
            taskIdRef.current = null
            patchSession(targetTab, { activeTaskId: null })
            resolve()
          }

          const syncPreview = (
            rawMarkdown: string,
            flush = false,
            _eventType?: string,
            _structuredBlocks?: EmbeddedPayloadBlock[],
            _ooxmlSnapshot?: PaperOoxmlSnapshot,
            delta?: { paragraphIndex?: number; updatedParagraph?: string; citationNumber?: number },
          ) => {
            if (!rawMarkdown) return
            if (rawMarkdown === lastSyncedContentRef.current && !flush) return
            lastSyncedContentRef.current = rawMarkdown
            stopTypewriter(false)
            if (onPaperStreamSync) {
              const handled = onPaperStreamSync({ tabId: targetTab, markdown: rawMarkdown, backendUrl, ...delta })
              if (handled !== false) return
            }
            let displayMarkdown = replaceImageUrls(rawMarkdown, imagePathMapRef.current)
            displayMarkdown = fixRelativeImageUrls(displayMarkdown, backendUrl)
            applyDocumentOnDelta(targetTab, displayMarkdown)
          }

          const pollTaskProgress = (taskId: string) => {
            const poll = async () => {
              try {
                if (settled || controller.signal.aborted) {
                  finish()
                  return
                }
                const res = await getTaskStatus(taskId)
                const task = (res as any)?.task
                if (!task) return

                const progressTail = Array.isArray(task.progress_updates) ? task.progress_updates[task.progress_updates.length - 1] : null
                const statusMsgRaw = task.status_message
                  ?? task.statusMessage
                  ?? progressTail?.status_message
                  ?? progressTail?.message
                if (statusMsgRaw) {
                  const statusMsg = String(statusMsgRaw)
                  setStatus(statusMsg)
                  setStatusMessage(statusMsg)
                  patchSession(targetTab, {
                    writingStatus: statusMsg,
                    taskStatusMessage: statusMsg,
                    taskPhase: task.status === 'paused' ? 'paused' : 'running',
                  })
                }

                if (task.status === 'paused') {
                  setPaused(true)
                } else if (task.status === 'running' || task.status === 'pending') {
                  setPaused(false)
                }

                const taskStructuredBlocks = Array.isArray(task.current_structured_blocks) ? task.current_structured_blocks as EmbeddedPayloadBlock[] : undefined
                const taskOoxmlSnapshot = task.current_ooxml_snapshot as PaperOoxmlSnapshot | undefined
                let currentMarkdown = resolvePaperText(task)
                if (currentMarkdown.trim()) {
                  syncPreview(currentMarkdown, false, undefined, taskStructuredBlocks, taskOoxmlSnapshot)
                }

                if (task.status === 'completed') {
                  setPaused(false)
                  try {
                    const result = await getTaskResult(taskId, {
                      topic: normalizedInstruction,
                      referenceDocumentIds: effectiveTaskReferenceDocumentIds,
                      command: 'generate-body',
                    })
                    const response = (result as any)?.result || {}
                    if ((result as any)?.status === 'success') {
                      let finalUrlMap: Record<string, string> = {}
                      let savedManuscriptPath: string | null = null
                      const responseStructuredBlocks = Array.isArray(response.structured_blocks) ? response.structured_blocks as EmbeddedPayloadBlock[] : undefined
                      const responseOoxmlSnapshot = (response.ooxml_snapshot || response.ooxmlSnapshot) as PaperOoxmlSnapshot | undefined
                      const responseMarkdown = resolvePaperText(response, currentMarkdown || latestPaperMarkdownRef.current || lastSyncedContentRef.current)
                      const normalizedResponseMarkdown = normalizeDocumentResultMarkdown(responseMarkdown)
                      const normalizedResponse = normalizedResponseMarkdown && normalizedResponseMarkdown !== responseMarkdown
                        ? {
                            ...response,
                            paper_markdown: normalizedResponseMarkdown,
                            markdown: normalizedResponseMarkdown,
                            current_content: normalizedResponseMarkdown,
                          }
                        : response
                      let persistedMarkdown = normalizedResponseMarkdown
                      if (activeWorkspacePath) {
                        try {
                          const urlMap = await saveResultToWorkspace(activeWorkspacePath, normalizedResponse, setStatusMessage, backendUrl)
                          imagePathMapRef.current = { ...imagePathMapRef.current, ...urlMap }
                          finalUrlMap = { ...urlMap }
                          if (persistedMarkdown.trim()) {
                            persistedMarkdown = replaceImageUrls(persistedMarkdown, finalUrlMap)
                            persistedMarkdown = fixRelativeImageUrls(persistedMarkdown, backendUrl)
                          }
                          if (normalizedResponseMarkdown.trim()) {
                            const finalPaperTitle = extractFinalPaperTitle(persistedMarkdown, normalizedResponse, normalizedInstruction)
                            const savedManuscript = await window.electronAPI.saveManuscript(activeWorkspacePath, persistedMarkdown, buildManuscriptFileName(finalPaperTitle))
                            savedManuscriptPath = savedManuscript.path
                            await saveResultReferencesToWorkspace(activeWorkspacePath, normalizedResponse, savedManuscript.path, setStatusMessage)
                          }
                          // Persist DocumentSchema as the canonical document.json.
                          // The backend may have already saved it via document_saved event;
                          // this is a secondary guarantee that ensures the file is on disk
                          // even if the backend save was skipped (e.g. no workspacePath in params).
                          if (response.documentSchema) {
                            try {
                              await window.electronAPI.saveWorkspaceDocumentSchema(activeWorkspacePath, response.documentSchema as import('../../../document/schema').DocumentSchema)
                              setStatusMessage('已保存到工作区')
                            } catch (docSaveError) {
                              const dsMsg = docSaveError instanceof Error ? docSaveError.message : String(docSaveError)
                              setStatusMessage(`论文已生成，但 document.json 保存失败: ${dsMsg}`)
                            }
                          }
                          void refreshTree().catch(() => undefined)
                        } catch (workspaceError) {
                          const message = workspaceError instanceof Error ? workspaceError.message : String(workspaceError)
                          setStatusMessage(`论文已完成，但工作区写入失败: ${message}`)
                        }
                      }
                      const documentArtifact = buildPaperArtifact(normalizedResponse, {
                        topic: normalizedInstruction,
                        referenceDocumentIds: effectiveTaskReferenceDocumentIds,
                        taskId,
                        manuscriptPath: savedManuscriptPath || undefined,
                        command: 'generate-body',
                      })
                      if (documentArtifact) {
                        normalizedResponse.documentArtifact = documentArtifact
                        // Commit the clean, normalised artifact to the workbench session
                        // immediately so that the canonical A4 surface shows the
                        // normalised content. The EditorPanel compat re-textification
                        // is now guarded to skip non-compat artifacts, so this write
                        // will not be overwritten by it.
                        workbench.setModeSession('document', (session) => ({
                          ...session,
                          documentArtifact,
                          lastUpdatedAt: new Date().toISOString(),
                        }))
                      }
                      let finalMarkdown = persistedMarkdown
                      const knowledgeRefSection = !markdownHasReferencesSection(finalMarkdown) ? buildKnowledgeReferenceMarkdown(knowledgeTrace) : ''
                      if (knowledgeRefSection) {
                        finalMarkdown = finalMarkdown.trimEnd() + '\n' + knowledgeRefSection
                      }
                      // DocumentSchema-first: when a structured schema is available, use it
                      // to drive the final editor state instead of the markdown string.
                      const completionDocumentSchema = (response.documentSchema ?? response.document_schema) as DocumentSchema | undefined
                      if (completionDocumentSchema) {
                        const schemaHtml = serializeDocumentSchemaToHtml(completionDocumentSchema)
                        if (schemaHtml.trim()) {
                          setDocumentContentIfAllowed(targetTab, schemaHtml)
                          const finalPaperTabTitle = sanitizeGeneratedName(completionDocumentSchema.meta?.title || normalizedResponse.title || normalizedInstruction, '论文', 80)
                          markTabShellSaved(targetTab, {
                            filePath: savedManuscriptPath || undefined,
                            fileName: savedManuscriptPath ? (savedManuscriptPath.split(/[\\/]/).pop() || `${finalPaperTabTitle}.docx`) : `${finalPaperTabTitle}.docx`,
                            content: schemaHtml,
                          })
                          paperGenerationTabIdRef.current = targetTab
                          console.info('[paper:tab_update]', { tabId: targetTab, title: finalPaperTabTitle, phase: 'finalize' })
                          onPaperStreamComplete?.({ tabId: targetTab, markdown: finalMarkdown || normalizedResponseMarkdown, backendUrl, documentSchema: completionDocumentSchema })
                          window.dispatchEvent(new CustomEvent('ai-writer-paper-preview-sync', {
                            detail: { tabId: targetTab, html: schemaHtml, markdown: finalMarkdown || normalizedResponseMarkdown, backendUrl, documentSchema: completionDocumentSchema },
                          }))
                        }
                      } else if (finalMarkdown.trim()) {
                        // Fallback: markdown-based editor sync when no documentSchema
                        finalMarkdown = replaceImageUrls(finalMarkdown, finalUrlMap)
                        finalMarkdown = fixRelativeImageUrls(finalMarkdown, backendUrl)
                        syncPreview(finalMarkdown, true, undefined, responseStructuredBlocks, responseOoxmlSnapshot)
                        if (savedManuscriptPath) {
                          markTabShellSaved(targetTab, {
                            filePath: savedManuscriptPath,
                            fileName: savedManuscriptPath.split(/[\\/]/).pop() || '论文.aidoc.json',
                            content: buildPaperEditorPreviewHtml(finalMarkdown, responseStructuredBlocks, responseOoxmlSnapshot),
                          })
                        }
                        onPaperStreamComplete?.({ tabId: targetTab, markdown: finalMarkdown, backendUrl })
                        // Defensive write-back: dispatch window event so handlePaperPreviewSync in
                        // EditorPanel (re-registered on every activeTabId change) can write the final
                        // content to the editor, bypassing any stale closure / activeTabIdRef timing
                        // issues in the polling completion path.
                        const completionHtml = buildPaperEditorPreviewHtml(finalMarkdown, responseStructuredBlocks, responseOoxmlSnapshot)
                        if (completionHtml) {
                          window.dispatchEvent(new CustomEvent('ai-writer-paper-preview-sync', {
                            detail: { tabId: targetTab, html: completionHtml, markdown: finalMarkdown, backendUrl },
                          }))
                        }
                      }
                      // Paper-generation persistence is handled by document.json/docx artifacts;
                      // do not depend on a knowledge department such as paper_kb.
                      const completedStatus = '全文内容已生成完成'
                      const imageFallbackCount = Number((completionDocumentSchema?.document?.metadata as Record<string, any> | undefined)?.fallbackImageCount || 0)
                      const savedArtifacts = Array.isArray((normalizedResponse as any).savedArtifacts) ? (normalizedResponse as any).savedArtifacts : []
                      const savedDocx = String((normalizedResponse as any).docxPath || savedArtifacts.find((item: any) => item?.type === 'docx' && item?.success)?.path || '').trim()
                      const pdfArtifact = savedArtifacts.find((item: any) => item?.type === 'pdf')
                      const saveMessage = savedDocx
                        ? `已保存到工作区：document.json / ${savedDocx.split(/[\\/]/).pop()}${pdfArtifact?.path ? ` / ${String(pdfArtifact.path).split(/[\\/]/).pop()}` : pdfArtifact?.skippedReason ? `；PDF 导出暂不可用：${pdfArtifact.skippedReason}` : ''}`
                        : ''
                      const placementMessage = imageFallbackCount > 0 ? '部分图片未匹配到章节，已放入文末。' : ''
                      const completedMessageBase = knowledgeSnippetCount > 0
                        ? '已参考知识库内容生成文稿。'
                        : (shouldUseKnowledgeForCurrentTask ? '未找到高度相关的知识库内容，已按当前指令生成文稿。' : '论文生成已完成')
                      const completedMessage = [completedMessageBase, saveMessage, placementMessage].filter(Boolean).join(' ')
                      setStatus(completedStatus)
                      setStatusMessage(completedMessage)
                    } else {
                      // Paper-generation task-record failures must not affect document saving.
                      setStatus('处理失败')
                      setStatusMessage(`论文生成失败: ${String((result as any)?.error || '未知错误')}`)
                    }
                  } catch (resultError) {
                    const message = resultError instanceof Error ? resultError.message : String(resultError)
                    const fallbackMarkdown = resolvePaperText(task, currentMarkdown || latestPaperMarkdownRef.current)
                    if (fallbackMarkdown.trim()) {
                      syncPreview(fallbackMarkdown, true, undefined, taskStructuredBlocks, taskOoxmlSnapshot)
                      onPaperStreamComplete?.({ tabId: targetTab, markdown: fallbackMarkdown, backendUrl })
                    }
                    // Paper-generation task-record failures must not affect document saving.
                    setStatus('全文内容已生成完成')
                    setStatusMessage(`论文已完成，但读取结果时出现异常: ${message}`)
                  }
                  finish()
                  return
                }

                if (task.status === 'failed' || task.status === 'interrupted') {
                  setPaused(false)
                  const message = String(task.error || task.status_message || '任务失败')
                  // Paper-generation task-record failures must not affect document saving.
                  setStatus(`处理失败: ${message}`)
                  setStatusMessage(`论文生成失败: ${message}`)
                  finish()
                }
              } catch (pollError) {
                const message = pollError instanceof Error ? pollError.message : String(pollError)
                if (!controller.signal.aborted) {
                  setStatus(`处理异常: ${message}`)
                  setStatusMessage(`任务轮询异常: ${message}`)
                }
              }
            }

            void poll()
            pollRef.current = setInterval(() => {
              void poll()
            }, 3000)
          }

          controller.signal.addEventListener('abort', () => {
            stopRequestedRef.current = true
            setPaused(false)
            const currentTaskId = taskIdRef.current
            if (currentTaskId) {
              void stopTask(currentTaskId).catch(() => undefined)
              // Paper-generation task-record failures must not affect document saving.
            }
            const preserved = preservePaperPreviewOnStop(targetTab)
            if (preserved) {
              setStatus('已停止，保留当前已生成内容')
              setStatusMessage('已停止论文生成，已保留当前已生成内容')
            } else {
              setStatus('已停止，未生成可保留内容，原文已恢复')
              setStatusMessage('已停止论文生成，未生成可保留内容，原文已恢复')
              setTabShellContent(targetTab, originalContentRef.current)
            }
            finish()
          }, { once: true })

          try {
            const tid = await submitTask({
              topic: normalizedInstruction,
              yearFrom: settings.genYearFrom || undefined,
              yearTo: settings.genYearTo || undefined,
              noImageMode: settings.genNoImageMode,
              paperType: settings.genPaperType as 'research' | 'review' | 'thesis_research',
              citationMode: settings.genCitationMode === 'inline' ? 'inline' : 'deferred',
              skipSectionThinking: true,
              incrementalReferencePassMode: 'off',
              incrementalReferencePassInterval: 0,
              finalReferencePassMode: 'weak',
              finalReferenceVerification: false,
              enableFullReview: false,
              language: generationLanguage,
              extraContext: [buildGenerationExtraContext(), knowledgeContext || '', personalFilesContext || ''].filter(Boolean).join('\n\n') || undefined,
              workspacePath: activeWorkspacePath || undefined,
            })
            taskIdRef.current = tid
            patchSession(targetTab, { activeTaskId: tid, taskPhase: 'submitted', mode: 'writing' })
            setPaused(false)
            writeTaskIds([...readTaskIds(), tid])
            window.dispatchEvent(new CustomEvent('ai-writer-task-submitted', { detail: { taskId: tid } }))
            setStatus(`任务已提交: ${tid}`)
            setStatusMessage(`任务已提交: ${tid}`)
            // Paper-generation task-record failures must not affect document saving.

            stopPaperEventStream()
            const electronApi = window.electronAPI
            const activePaperTaskId = String(taskIdRef.current || tid).trim()
            paperEventDisposeRef.current = electronApi?.onAiEvent
              ? electronApi.onAiEvent((payload) => {
              const event = payload as Record<string, any>
              if (event.scope !== 'paper') return
              const eventTaskId = String(event.taskId ?? event.task_id ?? '').trim()
              if (eventTaskId !== activePaperTaskId) return

              if ((event.type === 'progress' || event.type === 'status') && event.message) {
                const message = String(event.message)
                if (/任务已暂停/.test(message)) setPaused(true)
                if (/任务已继续/.test(message)) setPaused(false)
                setStatus(message)
                setStatusMessage(message)
                patchSession(targetTab, {
                  writingStatus: message,
                  taskStatusMessage: message,
                  taskPhase: /任务已暂停/.test(message) ? 'paused' : 'running',
                })
                return
              }

              const contentTypeNorm = String(event.contentType ?? event.content_type ?? '').trim()
              const isBodyContent = contentTypeNorm === 'body' || contentTypeNorm === 'final'
              const hasCumulativePreview = Boolean(
                event.cumulativeMarkdown
                || event.cumulative_markdown
                || (Array.isArray(event.structuredBlocks) && event.structuredBlocks.length > 0)
                || (Array.isArray(event.structured_blocks) && event.structured_blocks.length > 0),
              )
              const hasStreamPayload = Boolean(
                hasCumulativePreview
                || (typeof event.content === 'string' && event.content.trim())
                || (typeof event.updatedParagraph === 'string' && event.updatedParagraph.trim())
              )
              if (event.type === 'content' && (isBodyContent || hasCumulativePreview || (!contentTypeNorm && hasStreamPayload))) {
                const contentStatusMessage = String(event.message || '').trim()
                if (contentStatusMessage) {
                  setStatus(contentStatusMessage)
                  setStatusMessage(contentStatusMessage)
                  patchSession(targetTab, {
                    writingStatus: contentStatusMessage,
                    taskStatusMessage: contentStatusMessage,
                    taskPhase: 'running',
                  })
                }
                const eventStructuredBlocks = Array.isArray(event.structuredBlocks)
                  ? event.structuredBlocks as EmbeddedPayloadBlock[]
                  : Array.isArray(event.structured_blocks)
                    ? event.structured_blocks as EmbeddedPayloadBlock[]
                    : undefined
                let cumulative = resolveStreamingPreviewMarkdown(event, latestPaperMarkdownRef.current)
                if (!cumulative.trim() && typeof event.updatedParagraph === 'string' && event.updatedParagraph.trim()) {
                  const paragraphIndex = typeof event.paragraphIndex === 'number' ? event.paragraphIndex : -1
                  const paragraphs = String(latestPaperMarkdownRef.current || '').split(/\n{2,}/)
                  if (paragraphIndex >= 0 && paragraphIndex < paragraphs.length) {
                    paragraphs[paragraphIndex] = event.updatedParagraph
                    cumulative = paragraphs.join('\n\n')
                  } else {
                    cumulative = [latestPaperMarkdownRef.current, event.updatedParagraph].filter(Boolean).join('\n\n')
                  }
                }
                if (!cumulative.trim()) return
                syncPreview(cumulative, false, String(event.eventType || event.event_type || ''), eventStructuredBlocks, undefined, {
                  paragraphIndex: typeof event.paragraphIndex === 'number' ? event.paragraphIndex : undefined,
                  updatedParagraph: typeof event.updatedParagraph === 'string' ? event.updatedParagraph : undefined,
                  citationNumber: typeof event.citationNumber === 'number' ? event.citationNumber : undefined,
                })
                latestPaperMarkdownRef.current = cumulative
                const eventType = String(event.eventType || event.event_type || '').trim()
                const rawImagePath = String(
                  event?.image?.path
                  || event?.image?.url
                  || event?.image?.image_url
                  || '',
                ).trim()
                if (eventType === 'image' && rawImagePath && activeWorkspacePath) {
                  const knownMappedPath = imagePathMapRef.current[rawImagePath]
                  if (!knownMappedPath && !pendingImagePersistRef.current.has(rawImagePath)) {
                    pendingImagePersistRef.current.add(rawImagePath)
                    void (async () => {
                      try {
                        const saved = await saveImageIncrementallyToWorkspace(
                          activeWorkspacePath,
                          rawImagePath,
                          undefined,
                          undefined,
                          backendUrl,
                        )
                        if (!saved?.path) return
                        imagePathMapRef.current = {
                          ...imagePathMapRef.current,
                          [rawImagePath]: saved.path,
                        }
                        const latestMarkdown = latestPaperMarkdownRef.current
                        if (latestMarkdown.trim()) {
                          syncPreview(latestMarkdown, true, 'image', eventStructuredBlocks)
                        }
                      } finally {
                        pendingImagePersistRef.current.delete(rawImagePath)
                      }
                    })()
                  }
                }
                return
              }

              if (event.type === 'document_saved') {
                const artifacts = Array.isArray(event.savedArtifacts) ? event.savedArtifacts : []
                const docx = String(event.docxPath || artifacts.find((item: any) => item?.type === 'docx' && item?.success)?.path || '').trim()
                const pdfArtifact = artifacts.find((item: any) => item?.type === 'pdf')
                const pdfMessage = pdfArtifact?.path
                  ? ` / ${String(pdfArtifact.path).split(/[\\/]/).pop()}`
                  : pdfArtifact?.skippedReason
                    ? `；PDF 导出暂不可用：${pdfArtifact.skippedReason}`
                    : ''
                const docxName = docx ? ` / ${docx.split(/[\\/]/).pop()}` : ''
                setStatusMessage(`已保存到工作区：document.json${docxName}${pdfMessage}`)
                return
              }

              if (event.type === 'document_save_failed') {
                const errMsg = String(event.error || 'document.json 保存失败')
                setStatusMessage(`论文已生成，但 document.json 保存失败: ${errMsg}`)
                return
              }

              if (event.type === 'done') {
                stopPaperEventStream()
              }
              })
              : null

            void getActiveTasks().catch(() => undefined)
            pollTaskProgress(tid)
          } catch (error) {
            setTabShellContent(targetTab, originalContentRef.current)
            const message = error instanceof Error ? error.message : String(error)
            if (taskIdRef.current) {
              void saveKnowledgeGenerationTaskRecord({
                taskId: taskIdRef.current,
                title: normalizedInstruction,
                status: 'failed',
                errorMessage: message,
                generationTrace: knowledgeTrace,
              }).catch(() => undefined)
            }
            setStatus(`处理失败: ${message}`)
            setStatusMessage(`论文生成失败: ${message}`)
            finish()
          }
        })
        return
      }

      const minimalRules = buildMinimalWritingRuleText(documentFlow === 'rewrite' ? 'document-rewrite' : 'document-generate')
      await runWritingAssistant(
        {
          instruction: documentFlow === 'rewrite'
            ? (rewriteTarget
              ? buildTargetedDocumentRewriteInstruction(normalizedInstruction, rewriteTarget.label)
              : buildFullDocumentRewriteInstruction(normalizedInstruction))
            : normalizedInstruction,
          documentText: rewriteTarget?.text || sourceText,
          language: generationLanguage,
          outputLanguage,
          extraContext: [buildGenerationExtraContext(), knowledgeContext || '', personalFilesContext || '', minimalRules].filter(Boolean).join('\n\n') || undefined,
        },
        {
          onStatus: (message) => {
            setStatus(message)
            setStatusMessage(message)
          },
          onDelta: (_delta, accumulated) => {
            if (rewriteTarget) {
              return
            }
            setDocumentContentIfAllowed(targetTab, markdownToHtml(accumulated))
          },
          onComplete: async ({ text }) => {
            if (rewriteTarget) {
              const applied = onApplySelectionRewrite({
                tabId: targetTab,
                from: rewriteTarget.from,
                to: rewriteTarget.to,
                anchorId: rewriteTarget.anchorId,
                text: text.trim(),
              })
              if (!applied) {
                setStatus(`${rewriteTarget.label}改写完成，但未能自动应用`)
                setStatusMessage(`${rewriteTarget.label}改写完成，但未能自动写回编辑器`)
                return
              }
              setStatus(`${rewriteTarget.label}改写完成`)
              setStatusMessage(`已完成${rewriteTarget.label}的定点改写`)
              return
            }

            const completedStatus = documentFlow === 'rewrite' ? '当前全文已按提示改写完成' : '全文内容已生成完成'
            const _normalizedText = normalizeDocumentResultMarkdown(text)
            const knowledgeRefSection = documentFlow !== 'rewrite' && !markdownHasReferencesSection(_normalizedText) ? buildKnowledgeReferenceMarkdown(knowledgeTrace) : ''
            const finalText = knowledgeRefSection ? _normalizedText.trimEnd() + '\n' + knowledgeRefSection : _normalizedText
            const normalizedHtml = markdownToHtml(finalText)
            const applied = setDocumentContentIfAllowed(targetTab, normalizedHtml)
            const completedMessage = documentFlow === 'rewrite'
              ? (applied ? '已按你的要求完成当前全文改写' : '已按你的要求完成当前全文改写；检测到你已手动编辑，结果未自动覆盖正文')
              : (applied ? 'AI 写作助手已完成全文生成' : 'AI 写作助手已完成全文生成；检测到你已手动编辑，结果未自动覆盖正文')
            const userFacingCompletedMessage = documentFlow !== 'rewrite' && knowledgeSnippetCount > 0
              ? '已参考知识库内容生成文稿。'
              : (documentFlow !== 'rewrite' && shouldUseKnowledgeForCurrentTask ? '未找到高度相关的知识库内容，已按当前指令生成文稿。' : completedMessage)
            if (applied) {
              commitGeneratedHtmlToWorkbench(normalizedHtml)
            }
            setStatus(completedStatus)
            setStatusMessage(userFacingCompletedMessage)
            if (applied && documentFlow !== 'rewrite') {
              await appendGeneratedDocumentIllustration({
                targetTab,
                generatedText: text,
                completedStatus,
                completedMessage,
                signal: controller.signal,
              })
            }
          },
          onError: (error) => {
            const restored = restoreOriginalDocumentIfAllowed(targetTab)
            if (stopRequestedRef.current) {
              setStatus(restored ? '已停止，原文已恢复' : '已停止，保留当前手动编辑内容')
              setStatusMessage(
                documentFlow === 'rewrite'
                  ? (restored ? '已停止全文改写，原文已恢复' : '已停止全文改写，保留当前手动编辑内容')
                  : (restored ? '已停止 AI 写作助手，原文已恢复' : '已停止 AI 写作助手，保留当前手动编辑内容'),
              )
              return
            }
            setStatus(`处理失败: ${error}`)
            setStatusMessage(
              documentFlow === 'rewrite'
                ? (restored ? `全文改写失败: ${error}` : `全文改写失败，但已保留你的手动编辑内容: ${error}`)
                : (restored ? `AI 写作助手失败: ${error}` : `AI 写作助手失败，但已保留你的手动编辑内容: ${error}`),
            )
          },
        },
        controller.signal,
      )
    } finally {
      suppressTerminalOverlayRef.current = false
      stopTypewriter(false)
      onShadowTextChange('')
      setPaused(false)
      setRunningState(false)
      abortRef.current = null
    }
  }, [activeWorkspacePath, appendGeneratedDocumentIllustration, applyDocumentOnDelta, buildGenerationExtraContext, buildKnowledgeGenerationContext, buildKnowledgeTemplatePayload, commitGeneratedHtmlToWorkbench, dispatchTerminalComposerHidden, effectiveTaskReferenceDocumentIds, generationMode, isDocumentOverwriteBlocked, manualEditNonce, markTabShellSaved, onApplySelectionRewrite, onPaperStreamComplete, onPaperStreamStart, onResolveDocumentRewriteTarget, onShadowTextChange, preservePaperPreviewOnStop, readTaskIds, refreshTree, renderStablePaperPreview, resetManualEditGuard, resolveDocumentFlow, resolveDocumentTargetTab, resolveTargetTab, restoreOriginalDocumentIfAllowed, runDialogImageTask, running, saveKnowledgeGenerationTaskRecord, setRunningState, setStatus, setStatusMessage, setTabShellContent, settings.genNoImageMode, settings.genPaperType, settings.genYearFrom, settings.genYearTo, shouldUseKnowledgeForCurrentTask, startDailyReportGeneration, startEssayGeneration, stopPaperEventStream, stopPolling, stopTypewriter, switchTab, syncTypewriterPreview, tabs, taskTemplateDocument, taskTemplateDocumentId, writeTaskIds])

  const handleSend = useCallback(async () => {
    const instruction = input.trim() || autoTopic?.trim() || ''
    if (!instruction || running) return
    await runAssistantTask(instruction)
  }, [autoTopic, input, runAssistantTask, running])

  const handleStop = useCallback(() => {
    stopRequestedRef.current = true
    setPaused(false)
    setStatus('已停止')
    setStatusMessage('已停止论文生成')
    setRunningState(false)
    stopPolling()
    stopPaperEventStream()
    const currentEssayTaskId = essayTaskIdRef.current
    if (currentEssayTaskId) {
      void stopEssayTask(currentEssayTaskId).catch(() => undefined)
    }
    const currentDailyTaskId = dailyReportTaskIdRef.current
    if (currentDailyTaskId) {
      void stopDailyReportTask(currentDailyTaskId).catch(() => undefined)
    }
    stopTypewriter(false)
    const currentTaskId = taskIdRef.current
    if (currentTaskId) {
      void stopTask(currentTaskId).catch(() => undefined)
    }
    if (effectiveSessionTabId) {
      patchSession(effectiveSessionTabId, { activeTaskId: null, taskPhase: 'stopped', writingPaused: false, writingRunning: false, mode: 'idle' })
    }
    abortRef.current?.abort()
  }, [effectiveSessionTabId, patchSession, setRunningState, setStatusMessage, stopPaperEventStream, stopPolling, stopTypewriter])

  const handleDrop = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const list = Array.from(files).slice(0, 6)
    const mapped: AttachmentItem[] = []
    for (const file of list) {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      let textPreview = ''
      if (file.type.includes('text') || file.name.endsWith('.md') || file.name.endsWith('.txt')) {
        try {
          textPreview = (await file.text()).slice(0, 600)
        } catch {
          textPreview = ''
        }
      }
      mapped.push({ id, name: file.name, size: file.size, type: file.type, textPreview })
    }
    setAttachments((prev) => [...prev, ...mapped])
  }, [])

  useEffect(() => {
    if (!open) {
      onShadowTextChange('')
      return
    }
    if (autoStartNonce === undefined || autoStartRef.current === autoStartNonce) return
    autoStartRef.current = autoStartNonce
    setInput(autoTopic || '')
    if (autoRunOnOpen && String(autoTopic || '').trim()) {
      window.setTimeout(() => {
        void runAssistantTask(String(autoTopic || '').trim())
      }, 0)
    }
  }, [autoRunOnOpen, autoStartNonce, autoTopic, initialMode, onShadowTextChange, open, runAssistantTask])

  useEffect(() => () => {
    stopPolling()
    stopPaperEventStream()
    stopTypewriter(false)
  }, [stopPaperEventStream, stopPolling, stopTypewriter])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || running) return
      event.preventDefault()
      setCollapsed(true)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, running])

  const canPause = running && !paused && Boolean(taskIdRef.current)
  const canResume = running && paused && Boolean(taskIdRef.current)
  const composerCapabilities: UnifiedComposerCapabilities = useMemo(() => ({
    canSend: true,
    canStop: true,
    canPause: canPause,
    canResume: canResume,
  }), [canPause, canResume])
  const isKnowledgeConstrainedDocument = shouldUseKnowledgeForCurrentTask
  const isInlinePresentation = presentation === 'inline'
  const documentDialogHint = knowledgeSelectionHint

  const [collapsed, setCollapsed] = React.useState(isInlinePresentation)

  if (!open) return null

  // Silent mode: run generation in background with no visible UI
  if (presentation === 'silent') return null

  if (collapsed && isInlinePresentation) {
    const pillLabel = running
      ? (paused ? '✨ 全文生成 · 已暂停' : '✨ 全文生成 · 生成中…')
      : '✨ 全文生成'
    return (
      <UnifiedDockExpandStrip onClick={() => setCollapsed(false)}>
        <UnifiedDockExpandLabel>{pillLabel}</UnifiedDockExpandLabel>
        <UnifiedDockExpandAction>展开 ↑</UnifiedDockExpandAction>
      </UnifiedDockExpandStrip>
    )
  }

  const inputPlaceholder = '输入全文生成指令，例如：基于当前主题生成一篇完整综述'
  const knowledgePickerNode = knowledgePickerOpen ? (
    <KnowledgeTreePicker
      departments={knowledgeDepartments}
      selectedIds={selectedDocumentKnowledgeIds}
      onApply={handleApplyDocumentKnowledge}
      onClose={() => setKnowledgePickerOpen(false)}
      title="选择文稿知识库"
    />
  ) : null

  const inlineSummary = isKnowledgeConstrainedDocument
    ? knowledgeSelectionHint
    : '未选择知识库，将仅根据当前指令生成。'

  const inlineStatusText = running
    ? (paused ? '已暂停，可继续任务' : (status || '正在生成...'))
    : (status || 'Ctrl+Enter 发送，Esc 关闭')
  const inlineStatusTone: 'idle' | 'running' | 'paused' = running ? (paused ? 'paused' : 'running') : 'idle'

  if (isInlinePresentation) {
    return (
      <>
        <UnifiedGenerationDockWrap>
          <UnifiedComposerShell
            $dragging={dragging}
            onClick={(event) => event.stopPropagation()}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
            onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
            onDragLeave={(event) => { event.preventDefault(); setDragging(false) }}
            onDrop={(event) => { event.preventDefault(); setDragging(false); void handleDrop(event.dataTransfer.files) }}
          >
          <InlineComposerStack>
            <InlineComposerTopRow>
              <InlineComposerTag $accent={running}>全文生成</InlineComposerTag>
              <InlineComposerSummary>{inlineSummary}</InlineComposerSummary>
              <InlineComposerActions>
                <KnowledgeSelectButton
                  type="button"
                  $active={isKnowledgeConstrainedDocument}
                  disabled={running}
                  onClick={() => setKnowledgePickerOpen(true)}
                  title={knowledgeSelectionHint}
                >
                  {selectedKnowledgeLabel}
                </KnowledgeSelectButton>
                <InlineComposerButton $ghost onClick={() => setCollapsed(true)}>收起</InlineComposerButton>
              </InlineComposerActions>
            </InlineComposerTopRow>

            <InlineComposerInputRow>
              <InlineComposerInput
                value={input}
                placeholder={inputPlaceholder}
                disabled={running}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                    event.preventDefault()
                    if (running) handleStop()
                    else void handleSend()
                  }
                }}
              />
            </InlineComposerInputRow>
            <UnifiedComposerActionRow
              capabilities={composerCapabilities}
              running={running}
              sendLabel="发送"
              sendDisabled={!input.trim() && !autoTopic}
              onSend={() => void handleSend()}
              onPause={() => void handlePauseComposer()}
              onResume={() => void handleResumeComposer()}
              onStop={handleStop}
            />

            {attachments.length > 0 && (
              <AttachList>
                {attachments.map((item) => (
                  <AttachItem key={item.id} title="点击移除" onClick={() => setAttachments((prev) => prev.filter((entry) => entry.id !== item.id))}>
                    {item.name} ×
                  </AttachItem>
                ))}
              </AttachList>
            )}

            <UnifiedComposerStatusRow>
              <UnifiedComposerStatusPill $tone={inlineStatusTone}>文稿生成</UnifiedComposerStatusPill>
              <UnifiedComposerStatusText>{inlineStatusText}</UnifiedComposerStatusText>
              <UnifiedComposerStatusText>{dragging ? '松开鼠标即可附加文件' : (attachments.length > 0 ? `已附加 ${attachments.length} 个文件` : '可直接将文件拖入输入框')}</UnifiedComposerStatusText>
            </UnifiedComposerStatusRow>
          </InlineComposerStack>
          </UnifiedComposerShell>
        </UnifiedGenerationDockWrap>
        {knowledgePickerNode}
      </>
    )
  }

  const dialogNode = (
    <ComposerDialog $inline={isInlinePresentation} onClick={(event) => event.stopPropagation()}>
      <ComposerHeader>
        <ComposerHeaderCopy>
          <ComposerTitle>全文生成</ComposerTitle>
          <ComposerDesc>
            输入指令即可生成全文。{isKnowledgeConstrainedDocument ? '知识库将自动检索相关资料辅助生成。' : ''}
          </ComposerDesc>
        </ComposerHeaderCopy>
        <ComposerHeaderActions>
          <KnowledgeSelectButton
            type="button"
            $active={isKnowledgeConstrainedDocument}
            disabled={running}
            onClick={() => setKnowledgePickerOpen(true)}
            title={knowledgeSelectionHint}
          >
            {selectedKnowledgeLabel}
          </KnowledgeSelectButton>
          <Btn $ghost onClick={onClose} disabled={running}>{running ? '生成中' : '关闭'}</Btn>
        </ComposerHeaderActions>
      </ComposerHeader>
      <ComposerWrap>
        <DialogHintStrip>{documentDialogHint}</DialogHintStrip>
        <DropZone
          $dragging={dragging}
          onDragEnter={(e) => { e.preventDefault(); setDragging(true) }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={(e) => { e.preventDefault(); setDragging(false) }}
          onDrop={(e) => { e.preventDefault(); setDragging(false); void handleDrop(e.dataTransfer.files) }}
        >
          <KnowledgeHintRow>
            <KnowledgeHintTag $accent={isKnowledgeConstrainedDocument}>{knowledgeSelectionHint}</KnowledgeHintTag>
          </KnowledgeHintRow>

          <InputRow>
            <Input
              value={input}
              placeholder={inputPlaceholder}
              disabled={running}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault()
                  if (running) handleStop()
                  else void handleSend()
                }
              }}
            />
          </InputRow>
          <UnifiedComposerActionRow
            capabilities={composerCapabilities}
            running={running}
            sendLabel="开始生成"
            sendDisabled={!input.trim() && !autoTopic}
            onSend={() => void handleSend()}
            onPause={() => void handlePauseComposer()}
            onResume={() => void handleResumeComposer()}
            onStop={handleStop}
            leftActions={(
              <UnifiedGhostButton type="button" onClick={onClose}>
                {running ? '隐藏' : '关闭'}
              </UnifiedGhostButton>
            )}
          />

          {attachments.length > 0 && (
            <AttachList>
              {attachments.map((item) => (
                <AttachItem key={item.id} title="点击移除" onClick={() => setAttachments((prev) => prev.filter((entry) => entry.id !== item.id))}>
                  {item.name} ×
                </AttachItem>
              ))}
            </AttachList>
          )}

          <UnifiedComposerStatusRow>
            <UnifiedComposerStatusPill $tone={running ? (paused ? 'paused' : 'running') : 'idle'}>文稿生成</UnifiedComposerStatusPill>
            <UnifiedComposerStatusText>{status || '就绪'}</UnifiedComposerStatusText>
            <UnifiedComposerStatusText>{running ? (paused ? 'paused' : 'document') : 'idle'}</UnifiedComposerStatusText>
          </UnifiedComposerStatusRow>
        </DropZone>
      </ComposerWrap>
    </ComposerDialog>
  )

  return (
    <>
      <ComposerBackdrop onClick={running ? undefined : onClose}>{dialogNode}</ComposerBackdrop>
      {knowledgePickerNode}
    </>
  )
}

export default GenerationComposer
