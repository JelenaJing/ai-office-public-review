// vNext freeze: EditorPanel remains the current authoring editor for freewrite flows.
// Docx-like fidelity and final delivery stay outside this component's architecture role.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import { NodeSelection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import Highlight from '@tiptap/extension-highlight'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import Typography from '@tiptap/extension-typography'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import TextStyle from '@tiptap/extension-text-style'
import FontFamily from '@tiptap/extension-font-family'
import FontSize from '../../../extensions/FontSize'
import Superscript from '../../../extensions/Superscript'
import Subscript from '../../../extensions/Subscript'
import TurndownService from 'turndown'
import styled from 'styled-components'
import katex from 'katex'
import { getAIToolSettings, getEffectiveGenerationProfile, subscribeToAIToolSettingsUpdates } from '../../../utils/aiToolSettings'
import { resetPresetModal } from '../../../components/GlobalPresetModal'
import { GhostText, setGhostLanguage } from '../../../extensions/GhostText'
import { useDocument } from '../../../contexts/DocumentContext'
import { useGenerationWorkbench } from '../../../contexts/GenerationWorkbenchContext'
import { useKnowledge } from '../../../contexts/KnowledgeContext'
import { useLanguage } from '../../../contexts/LanguageContext'
import { useWorkspaceMode } from '../../../contexts/WorkspaceModeContext'
import { useWorkspace } from '../../../contexts/WorkspaceContext'
import { markdownToHtml, hasMarkdownSyntax } from '../../../utils/markdownToHtml'
import { parseMarkdownWithTiptapBridge, serializeEditorToMarkdownWithBridge } from '../../../utils/tiptapMarkdownBridge'
import {
  resolvePaperStreamCompletionDecision,
  resolvePaperStreamSyncDecision,
  shouldAutoApplyPendingImageInsertion,
} from '../../../utils/crossTabWriteback'
import { runWritingAssistant } from '../services/WritingAssistantService'
import { buildExpandInstruction, buildExpandExtraContext } from '../../../services/ExpandService'
import { resolveArticleBlueprint } from '../../../services/ArticleClassificationService'
import { resolveStructuredRemakeContextFromArticle, type StructuredRemakeContext } from '../services/sectionAwareRemake'
import { findCitationForText, INLINE_CITATION_MAX_RESULTS, type CitationItem } from '../../../services/ReferenceService'
import { continueWriting } from '../services/ContinueWritingService'
import { isDirectMode, directContinueWriting } from '../../../services/AIClientFactory'
import { generateSelectionImage, getDefaultInsertedGeneratedImageWidthPx } from '../../image/services/ImageService'
import { saveImageIncrementallyToWorkspace } from '../../../utils/workspaceFiles'
import { buildCitationRenumberPlan, CitationReferenceItem, formatCitationNumbers, parseLeadingCitationNumber, stripLeadingCitationPrefix, updateCitationNumbersInText } from '../../../utils/citationGroups'
import { getBackendUrl } from '../../../config'
import DocumentPreviewPane from './DocumentPreviewPane'
import Toolbar from '../../../components/Toolbar'
import ExportJournalDialog from '../../../components/ExportJournalDialog'
import type { JournalExportConfig } from '../../../utils/journalExportPresets'
import GenerationComposer from '../../generation/components/GenerationComposer'
import { PaperStyle } from '../../../extensions/PaperStyle'
import { DocumentBreak } from '../../../extensions/DocumentBreak'
import { BlockFormula, InlineFormula } from '../../../extensions/Formula'
import RichImage from '../../../extensions/RichImage'
import { DEFAULT_PAPER_TEMPLATE_ID, getPaperTemplate, getRecommendedPaperTemplateId, pageMarginsToCSS, type PaperTemplateId } from '../../../utils/paperTemplates'
import { createEmbeddedOfficeRuntime } from '../../../engines/documentEngine/embeddedOfficeAdapter'
import { createLegacyTiptapRuntime } from '../../../engines/documentEngine/legacyTiptapAdapter'
import type { DocumentEngineLoadRequest, DocumentEngineSaveRequest, DocumentEngineSaveResult } from '../../../engines/documentEngine/contracts'
import {
  forEachTiptapDocNode,
  getTiptapDocumentSize,
  getTiptapNodeAt,
  getTiptapRawSelection,
  getTiptapSelectionEdgePosition,
  getTiptapSelectionRange,
  readTiptapDocumentSelection,
} from '../../../engines/documentEngine/tiptapSelectionQuery'
import { useBindDocumentEngineRuntime, useDocumentEngineRuntime } from '../../../engines/documentEngine/runtime'
import { useDocumentEngineHostCommands } from '../../../engines/documentEngine/hostCommands'
import type { DocumentEngineId } from '../../../engines/documentEngine/types'
import { useEditorSession } from '../../../contexts/EditorSessionContext'
import {
  createManuscriptCommand,
  routeManuscriptCommand,
  type RoutedManuscriptCommand,
} from '../../../document/commands'
import {
  executeRoutedManuscriptCommandWithExecutor,
  getManuscriptExecutorIdForProfile,
  type ManuscriptCompatExecutorDelegate,
} from '../../../document/executors'
import { resolveDocumentRewriteTargetInEditor } from '../../../document/rewriteTargeting'
import { resolveManuscriptSelectionAnchorToEditorRange } from '../../../document/selection'
import { createDocumentArtifact } from '../../../document/core'
import { buildDocumentSchemaFromHtml } from '../../../document/schema'
import { freewriteOrchestrator, paperOrchestrator } from '../../../document/profiles'
import { MANUSCRIPT_COMMAND_EVENT, isRoutedManuscriptCommand } from '../../../components/manuscript/manuscriptCommandEvents'
import type { ManuscriptProfileId } from '../../../components/manuscript/ManuscriptProfileSwitcher'
import {
  normalizeFileLikePath as normalizeSharedFileLikePath,
  toFileUrl as toSharedFileUrl,
} from '../../../shared/url/fileUrlHelper'
import type { KnowledgeTaskConstraints, PreviewKnowledgeTaskContextResult } from '../../../types/knowledge'
import { buildKnowledgeTaskConstraints, resolveKnowledgeTaskPreview } from '../../../shared/knowledge/knowledgeTaskHelper'
import { normalizeContinueDeltaAtStart, normalizeContinueLeadingText } from '../../../utils/continueStreamText'
import { createPptPrimarySourceState } from '../../../utils/pptPrimarySource'
import ReadonlyDocumentPreview from './ReadonlyDocumentPreview'
import { useDocumentPreview } from '../../../hooks/useDocumentPreview'
import { useDraggable } from '../../../hooks/useDraggable'

const EditorWrapper = styled.div`flex:1;display:flex;flex-direction:column;overflow:hidden;background:#f7f8fb;position:relative;`
const HeadlessEditorStage = styled.div<{ $headless?: boolean }>`
  display:flex;
  flex:1;
  min-width:0;
  min-height:0;
  flex-direction:column;
  ${({ $headless }) => ($headless ? `position:absolute;left:-200vw;top:0;width:960px;height:100%;overflow:hidden;pointer-events:none;opacity:0;` : 'position:relative;')}
`
const TabBarContainer = styled.div`display:flex;background:#ffffff;min-height:36px;overflow-x:auto;flex-shrink:0;border-bottom:1px solid #dde3ec;`
const TabItem = styled.div<{ $active: boolean }>`display:flex;align-items:center;gap:6px;padding:0 14px;height:36px;font-size:var(--font-size-sm);cursor:pointer;white-space:nowrap;border-right:1px solid #eef2f7;background:${p => p.$active ? '#ffffff' : '#f7f9fc'};color:${p => p.$active ? '#243447' : '#6c7b8a'};user-select:none;flex-shrink:0;border-top:${p => p.$active ? '2px solid #007acc' : '2px solid transparent'};`
const TabName = styled.span<{ $dirty?: boolean }>`max-width:160px;overflow:hidden;text-overflow:ellipsis;&::before{content:'${p => p.$dirty ? '● ' : ''}';color:#e8ab6a;}`
const TabClose = styled.span`font-size:14px;color:#7b8794;width:18px;height:18px;display:flex;align-items:center;justify-content:center;border-radius:3px;&:hover{background:#edf3fa;color:#243447;}`
const TabNewBtn = styled.button`display:flex;align-items:center;justify-content:center;width:32px;height:36px;border:none;background:transparent;color:#7b8794;font-size:18px;cursor:pointer;flex-shrink:0;&:hover{background:#edf3fa;color:#243447;}`
const WelcomeScreen = styled.div`flex:1;display:flex;align-items:center;justify-content:center;background:#f7f8fb;`
const WelcomeInner = styled.div`text-align:center;`
const WelcomeTitle = styled.div`font-size:22px;color:#4d6278;margin-bottom:12px;`
const WelcomeDesc = styled.div`font-size:var(--font-size-sm);color:#738396;margin-bottom:24px;`
const WelcomeBtn = styled.button`padding:8px 24px;border:1px solid #cdd8e4;border-radius:6px;background:#ffffff;color:#304255;font-size:14px;cursor:pointer;&:hover{background:#eef4fb;border-color:#007acc;}`
const WelcomeActionRow = styled.div`display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;`
const PreviewModeNotice = styled.div`
  margin: 0 auto 16px;
  width: min(794px, calc(100% - 32px));
  padding: 10px 14px;
  border: 1px solid #d7e3ef;
  border-radius: 10px;
  background: #f8fbff;
  color: #4c6176;
  font-size: var(--font-size-xs);
  line-height: 1.7;
`
const ContinueStreamBanner = styled.div`display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;background:linear-gradient(180deg,#f6faff 0%,#edf5ff 100%);border-bottom:1px solid #dbe7f3;flex-shrink:0;`
const DocxMigrationBanner = styled.div`display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 16px;background:#fffbeb;border-bottom:1px solid #f5e0a0;flex-shrink:0;`
const DocxMigrationText = styled.span`font-size:var(--font-size-xs);color:#7a5800;flex:1;min-width:0;`
const DocxMigrationBtn = styled.button`height:26px;border-radius:4px;border:1px solid #d9b550;background:#fff8d6;color:#7a5800;font-size:var(--font-size-xs);padding:0 12px;cursor:pointer;flex-shrink:0;&:hover{background:#fff0b3;}`
const DocxMigrationDismiss = styled.button`background:transparent;border:none;color:#a08040;cursor:pointer;font-size:16px;padding:0 4px;line-height:1;flex-shrink:0;&:hover{color:#7a5800;}`
const MailAttachmentSourceBanner = styled.div`
  display:flex;
  align-items:center;
  flex-wrap:wrap;
  gap:8px 14px;
  padding:8px 16px;
  border-bottom:1px solid #cfe1ff;
  background:#eef6ff;
  color:#244869;
  font-size:var(--font-size-xs);
  flex-shrink:0;
`
const MailAttachmentSourceBadge = styled.span`font-weight:700;color:#155ea8;`
const MailAttachmentSourceItem = styled.span`min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:360px;`
const ContinueStreamSummary = styled.div`display:flex;align-items:center;gap:10px;min-width:0;flex-wrap:wrap;`
const ContinueStreamBadge = styled.span<{ $phase: 'running' | 'completed' | 'stopped' | 'error' }>`display:inline-flex;align-items:center;padding:3px 10px;border-radius:999px;font-size:var(--font-size-xs);font-weight:700;letter-spacing:.2px;border:1px solid ${p => p.$phase === 'running' ? '#c9dcff' : p.$phase === 'completed' ? '#cde8d5' : p.$phase === 'error' ? '#f0caca' : '#e5d8b7'};background:${p => p.$phase === 'running' ? '#eaf2ff' : p.$phase === 'completed' ? '#eefbf2' : p.$phase === 'error' ? '#fff2f2' : '#fff8e8'};color:${p => p.$phase === 'running' ? '#295aa8' : p.$phase === 'completed' ? '#1f6c3f' : p.$phase === 'error' ? '#b33838' : '#8a5b00'};`
const ContinueStreamText = styled.span`min-width:0;font-size:var(--font-size-xs);color:#425466;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`
const ContinueStreamActions = styled.div`display:flex;align-items:center;gap:8px;flex-shrink:0;`
const ContinueStreamBtn = styled.button<{ $danger?: boolean }>`height:30px;border-radius:999px;border:1px solid ${p => p.$danger ? '#e7bcbc' : '#d0dae6'};background:${p => p.$danger ? '#fff4f4' : '#ffffff'};color:${p => p.$danger ? '#b33838' : '#304255'};font-size:var(--font-size-xs);padding:0 12px;cursor:pointer;`
const EditorDocumentMetricsBar = styled.div`
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 6px 12px;
  padding: 5px 14px 6px;
  border-bottom: 1px solid #e2e8f0;
  background: #fafbfd;
  font-size: var(--font-size-xs);
  color: #5a6b7d;
  line-height: 1.5;
  user-select: none;
`
const EditorScrollArea = styled.div`flex:1;overflow-y:auto;background:#e8eaed;padding:24px 0;`

const INLINE_REWRITE_SEMANTIC_GUARD = '【核心要求】只对当前选中段落做改写，必须严格保持原文核心语义、事实判断、结论、立场与信息边界不变；只优化表达方式、清晰度、连贯性和措辞，不得扩写新观点，不得删改关键信息，不得改变原段落想表达的整体意思。'

function buildInlineRewriteKnowledgeContext(
  preview: PreviewKnowledgeTaskContextResult | null,
  constraints: KnowledgeTaskConstraints,
): string | undefined {
  if (!preview) return undefined

  const parts: string[] = [
    '以下知识库材料仅用于帮助当前选中段落在不改变原意的前提下，贴近所选资料的术语、表达习惯和表述风格；不得改变原段落的核心语义。',
  ]

  if (preview.templateSummary) {
    parts.push([
      '任务级模板风格约束：以下内容只用于借鉴语气、术语和表达方式，不作为新的事实来源，也不要改写原段落的结构角色。',
      preview.templateSummary,
    ].join('\n\n'))
  }

  const explicitCitations = preview.citations.filter((item) => item.sourceKind === 'required-reference' || item.sourceKind === 'preferred-reference')
  if (explicitCitations.length) {
    parts.push([
      '任务级显式参考证据：以下片段来自你当前勾选的知识库资料，可用于校准术语、措辞和相关事实表述。',
      ...explicitCitations.map((item) => `- ${item.documentTitle}｜${item.locatorLabel}\n  ${item.quote}`),
    ].join('\n'))
  }

  if (!preview.templateSummary && explicitCitations.length === 0) {
    return undefined
  }

  return parts.join('\n\n') || undefined
}

const EditorPage = styled.div<{ $templateId: PaperTemplateId }>`
  ${({ $templateId }) => {
    const template = getPaperTemplate($templateId)
    const defaultFontSizePx = parseFloat(template.fontSize) || 15
    const m = template.pageMargins
    const pTop = Math.round(m.top * 3.7795)
    const pRight = Math.round(m.right * 3.7795)
    const pBottom = Math.round(m.bottom * 3.7795)
    const pLeft = Math.round(m.left * 3.7795)
    return `
      width: 794px;
      min-height: 1123px;
      margin: 0 auto 24px;
      background: #fff;
      padding: var(--editor-page-padding, ${pTop}px ${pRight}px ${pBottom}px ${pLeft}px);
      display: flex;
      flex-direction: column;
      position: relative;
      box-shadow: 0 1px 4px rgba(0,0,0,.12), 0 0 0 1px rgba(0,0,0,.04);
      border-radius: 2px;
      > div { display: flex; flex-direction: column; flex: 1; }
      .tiptap { outline: none; flex: 1; font-family: var(--editor-font-family, ${template.fontFamily}); font-size: var(--editor-font-size, ${template.fontSize}); line-height: var(--editor-line-height, ${template.lineHeight}); color: #222; letter-spacing: .02em; position: relative; z-index: 1; }
      .tiptap h1 { font-size: 22pt; font-weight: 700; margin: 36px 0 20px; text-align: center; letter-spacing: .04em; }
      .tiptap h2 { font-size: 16pt; font-weight: 700; margin: 24px 0 12px; padding-bottom: 6px; border-bottom: 1px solid #eee; text-align: var(--editor-heading-align, ${template.headingAlign === 'center' ? 'center' : 'left'}); }
      .tiptap h3 { font-size: 14pt; font-weight: 600; margin: 18px 0 8px; }
      .tiptap h4 { font-size: 12pt; font-weight: 600; margin: 14px 0 6px; }
      .tiptap p { margin: var(--editor-paragraph-spacing, ${template.paragraphSpacing}) 0; text-align: justify; text-indent: var(--editor-text-indent, ${template.textIndent}); line-height: var(--editor-line-height, ${template.lineHeight}); }
      .tiptap [data-semantic-role="paper-title"] { margin-top: ${$templateId === 'academic-en' ? '72px' : '48px'}; margin-bottom: 12px; font-size: 22pt; line-height: 1.4; text-align: center; }
      .tiptap [data-semantic-role="abstract-heading"] { margin-top: 28px; border-bottom: none; font-size: 14pt; font-weight: 700; color: #333; text-align: center; }
      .tiptap [data-semantic-role="abstract-body"] { text-indent: 0; font-size: calc(var(--editor-font-size-px, ${defaultFontSizePx}px) - 1px); color: #444; line-height: 1.75; margin-bottom: 4px; }
      .tiptap [data-semantic-role="keywords-heading"] { border-bottom: none; font-size: 12pt; font-weight: 700; color: #333; text-align: left; margin-top: 12px; margin-bottom: 8px; }
      .tiptap [data-semantic-role="keywords-body"] { text-indent: 0; font-size: calc(var(--editor-font-size-px, ${defaultFontSizePx}px) - 1px); color: #444; line-height: 1.75; margin-bottom: 8px; }
      .tiptap [data-semantic-role="section-heading"] { border-bottom: 1px solid #eee; font-size: 16pt; color: #222; }
      .tiptap [data-semantic-role="references-heading"] { border-bottom: 1px solid #eee; font-size: 16pt; color: #222; }
      .tiptap [data-semantic-role="reference-item"] { text-indent: 0; line-height: 1.8; }
      .tiptap blockquote { border-left: 2px solid #d9dee8; padding-left: 14px; color: #616975; margin: 14px 0; background: #fafbfe; padding: 8px 14px; border-radius: 0 4px 4px 0; font-size: 14px; line-height: 1.7; }
      .tiptap ul, .tiptap ol { padding-left: 24px; }
      .tiptap li { margin: 4px 0; }
      .tiptap li > p { text-indent: 0; }
      .tiptap .references-list { padding-left: 0; margin: 14px 0; list-style-position: inside; }
      .tiptap .references-list li { margin: 10px 0; padding-left: 2.2em; text-indent: -2.2em; line-height: 1.75; }
      .tiptap img { max-width: 100%; border-radius: 2px; margin: 12px 0; }
      .tiptap figure { margin: 16px 0; text-align: center; }
      .tiptap figcaption { font-size: 10pt; color: #666; margin-top: 6px; line-height: 1.6; }
      .tiptap .document-break { display: flex; align-items: center; gap: 10px; margin: 18px 0; color: #66788a; user-select: none; }
      .tiptap .document-break__line { flex: 1; height: 1px; background: linear-gradient(90deg, rgba(151,166,184,.15), rgba(151,166,184,.65), rgba(151,166,184,.15)); }
      .tiptap .document-break__label { flex: 0 0 auto; padding: 4px 10px; border: 1px solid #d8e3ef; border-radius: 999px; font-size: var(--font-size-xs); letter-spacing: .06em; text-transform: uppercase; background: #f8fbff; }
      .tiptap table { width: 100%; border-collapse: collapse; margin: 14px 0; }
      .tiptap th, .tiptap td { border: 1px solid #e0e0e0; padding: 8px 12px; text-align: left; }
      .tiptap th { background: #f0f2f8; font-weight: 600; color: #444; }
      .tiptap code { background: #f0f2f5; padding: 2px 6px; border-radius: 3px; font-family: 'JetBrains Mono', 'Consolas', monospace; font-size: var(--font-size-sm); color: #d63384; }
      .tiptap pre { background: #f7f8fa; padding: 16px; border-radius: 6px; overflow-x: auto; border: 1px solid #eee; }
      .tiptap pre code { background: none; padding: 0; color: #333; }
      .tiptap .ai-ghost-text { color: #9ca3af; font-style: italic; pointer-events: none; user-select: none; }
      .tiptap .is-empty::before { color: #adb5bd; content: attr(data-placeholder); float: left; height: 0; pointer-events: none; }
      .tiptap ul[data-type="taskList"] { list-style: none; padding-left: 0; }
      .tiptap ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 8px; }
      .tiptap .formula-node { cursor: pointer; user-select: none; }
      .tiptap .formula-inline {
        display: inline-block;
        padding: 0;
        margin: 0;
        border-radius: 2px;
        background: transparent;
        outline: 1px dashed transparent;
        outline-offset: 1px;
        vertical-align: baseline;
        line-height: 1;
        white-space: nowrap;
      }
      .tiptap:focus-within .formula-inline {
        outline-color: rgba(14, 99, 156, 0.32);
        background: rgba(14, 99, 156, 0.04);
      }
      .tiptap .formula-block {
        display: flex;
        justify-content: center;
        margin: 8px 0;
        padding: 4px 0;
        border-radius: 4px;
        background: transparent;
        outline: 1px dashed transparent;
        outline-offset: 1px;
        overflow-x: auto;
      }
      .tiptap:focus-within .formula-block {
        outline-color: rgba(14, 99, 156, 0.28);
        background: rgba(14, 99, 156, 0.02);
      }
      .tiptap .formula-inline .katex,
      .tiptap .formula-block .katex {
        font-size: 1em;
        line-height: 1;
        letter-spacing: normal;
        word-spacing: normal;
        text-indent: 0;
      }
    `
  }}
`
const PageHeaderPreview = styled.div`
  position: absolute;
  top: 18px;
  left: 40px;
  right: 40px;
  min-height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 16px 8px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.28);
  color: #64748b;
  font-size: var(--font-size-xs);
  line-height: 1.45;
  white-space: pre-wrap;
  text-align: center;
  pointer-events: none;
  z-index: 1;
`

const PageFooterPreview= styled.div`
  position: absolute;
  left: 40px;
  right: 40px;
  bottom: 14px;
  min-height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 16px 0;
  border-top: 1px solid rgba(148, 163, 184, 0.28);
  color: #64748b;
  font-size: var(--font-size-xs);
  line-height: 1.45;
  white-space: pre-wrap;
  text-align: center;
  pointer-events: none;
  z-index: 1;
`

const PageWatermarkPreview = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px;
  color: rgba(148, 163, 184, 0.22);
  font-size: clamp(56px, 9vw, 96px);
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  transform: rotate(-24deg);
  text-align: center;
  white-space: pre-wrap;
  pointer-events: none;
  user-select: none;
  z-index: 0;
`

const ShadowLayer = styled.pre`margin:14px 0 0;pointer-events:none;color:rgba(90,90,90,.58);font-style:italic;font-size:15px;line-height:1.85;white-space:pre-wrap;opacity:1;transition:opacity 140ms ease;`
const CtxMenuOverlay = styled.div`position:fixed;top:0;left:0;right:0;bottom:0;z-index:999;`
const CtxMenu = styled.div`position:fixed;z-index:1000;background:#ffffff;border:1px solid #d6e0ea;border-radius:6px;box-shadow:0 12px 32px rgba(19,41,61,.14);min-width:220px;padding:4px 0;font-size:var(--font-size-sm);`
const CtxMenuItem = styled.div`padding:6px 24px;cursor:pointer;display:flex;align-items:center;gap:8px;color:#304255;&:hover{background:#eef4fb;color:#1f3142;}`
const CtxMenuDivider = styled.div`height:1px;background:#e7edf4;margin:4px 0;`
const CtxMenuLabel = styled.div`padding:4px 24px;font-size:var(--font-size-xs);color:#7b8794;font-weight:500;letter-spacing:.3px;`

const PptDialogOverlay = styled.div`position:fixed;inset:0;background:rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;z-index:9999;`
const PptDialogBox = styled.div`background:#fff;border-radius:14px;padding:24px 28px;width:min(480px,90vw);box-shadow:0 20px 60px rgba(0,0,0,0.15);`
const PptDialogTitle = styled.div`font-size:15px;font-weight:700;color:#1a202c;margin-bottom:6px;`
const PptDialogHint = styled.div`font-size:var(--font-size-xs);color:#6b7d8e;margin-bottom:14px;line-height:1.5;`
const PptDialogTextarea = styled.textarea`width:100%;min-height:80px;max-height:200px;resize:vertical;border:1px solid #d6e0ea;border-radius:8px;padding:12px 14px;font-size:var(--font-size-sm);line-height:1.6;color:#304255;background:#fafbfc;outline:none;&:focus{border-color:#4ea1ff;background:#fff;}`
const PptDialogActions = styled.div`display:flex;justify-content:flex-end;gap:10px;margin-top:16px;`
const PptDialogBtn = styled.button<{ $primary?: boolean }>`height:34px;min-width:72px;border-radius:8px;border:1px solid ${p => p.$primary ? '#2f62d8' : '#d6e0ea'};background:${p => p.$primary ? '#2e68e6' : '#ffffff'};color:${p => p.$primary ? '#fff' : '#304255'};font-size:var(--font-size-sm);cursor:pointer;&:hover{opacity:0.88;}&:disabled{opacity:0.45;cursor:not-allowed;}`
const DiffOverlay = styled.div`position:fixed;z-index:1001;background:#fff;border:1px solid #d0d7ff;border-radius:8px;box-shadow:0 4px 24px rgba(102,126,234,.18);max-width:680px;min-width:320px;font-size:14px;line-height:1.7;`
const DiffHeader = styled.div`display:flex;align-items:center;justify-content:space-between;padding:8px 14px;background:#f4f5ff;border-bottom:1px solid #e0e4f5;border-radius:8px 8px 0 0;font-size:var(--font-size-xs);color:#555;font-weight:500;`
const DiffBody = styled.div`padding:12px 14px;max-height:320px;overflow-y:auto;`
const DiffOld = styled.div`background:#ffeef0;color:#86181d;padding:6px 10px;border-radius:4px;margin-bottom:8px;text-decoration:line-through;font-size:var(--font-size-sm);line-height:1.6;word-break:break-word;white-space:pre-wrap;`
const DiffNew = styled.div`background:#e6ffec;color:#14532d;padding:6px 10px;border-radius:4px;font-size:var(--font-size-sm);line-height:1.6;word-break:break-word;white-space:pre-wrap;`
const DiffActions = styled.div`display:flex;gap:8px;padding:8px 14px;border-top:1px solid #eee;justify-content:flex-end;`
const DiffBtn = styled.button<{ $accept?: boolean }>`padding:5px 16px;border:none;border-radius:5px;font-size:var(--font-size-sm);font-weight:500;cursor:pointer;background:${p => p.$accept ? '#38a169' : '#e2e8f0'};color:${p => p.$accept ? '#fff' : '#555'};`
const FormulaPopover = styled(DiffOverlay)`width:620px;max-width:calc(100vw - 32px);min-width:420px;`
const FormulaTextArea = styled.textarea`width:100%;min-height:108px;border:1px solid #d5dbea;border-radius:6px;padding:10px 12px;resize:vertical;font-family:'JetBrains Mono','Consolas',monospace;font-size:var(--font-size-sm);line-height:1.6;outline:none;`
const FormulaModeRow = styled.div`display:flex;gap:8px;margin-bottom:10px;`
const FormulaModeBtn = styled.button<{ $active?: boolean }>`padding:6px 12px;border:none;border-radius:6px;background:${p => p.$active ? '#0e639c' : '#e2e8f0'};color:${p => p.$active ? '#fff' : '#445'};cursor:pointer;`
const FormulaTip = styled.div`font-size:var(--font-size-xs);color:#6b7280;line-height:1.6;margin-top:10px;`
const FormulaSplitRow = styled.div`display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start;`
const FormulaFieldLabel = styled.div`font-size:var(--font-size-xs);font-weight:600;color:#445;line-height:1.5;margin-bottom:6px;`
const FormulaNaturalInput = styled.textarea`width:100%;min-height:70px;border:1px solid #d5dbea;border-radius:6px;padding:10px 12px;resize:vertical;font-size:var(--font-size-sm);line-height:1.6;outline:none;`
const FormulaActionsRow = styled.div`display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px;`
const FormulaTemplateGrid = styled.div`display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:8px;`
const FormulaTemplateBtn = styled.button`height:30px;padding:0 8px;border:1px solid #d7deea;border-radius:6px;background:#f8fbff;color:#304255;font-size:var(--font-size-xs);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;&:hover{background:#eef5ff;}`
const FormulaPreviewBox = styled.div`border:1px solid #e4e9f0;border-radius:8px;background:#f8fbfd;min-height:120px;padding:12px;display:flex;align-items:center;justify-content:center;overflow:auto;`
const FormulaPreviewError = styled.div`margin-top:8px;font-size:var(--font-size-xs);line-height:1.5;color:#b42318;background:#fff1f1;border:1px solid #f3c8c8;border-radius:6px;padding:6px 8px;`
const ImageToolPanel = styled.div`padding:10px 14px 12px;display:flex;flex-direction:column;gap:10px;min-width:320px;`
const ImageToolTitle = styled.div`font-size:var(--font-size-xs);font-weight:600;color:#5b6b7b;letter-spacing:.3px;`
const ImageToolRow = styled.div`display:flex;gap:8px;align-items:center;`
const ImageToolGrid = styled.div`display:grid;grid-template-columns:1fr 1fr;gap:10px;`
const ImageToolLabel = styled.label`display:flex;flex-direction:column;gap:6px;font-size:var(--font-size-xs);color:#516273;`
const ImageToolInput = styled.input`height:32px;border:1px solid #d6e0ea;border-radius:6px;padding:0 10px;font-size:var(--font-size-sm);outline:none;background:#fff;color:#22313f;`
const ImageToolSegment = styled.div`display:flex;gap:6px;`
const ImageToolSegmentBtn = styled.button<{ $active?: boolean }>`flex:1;height:32px;border:1px solid ${p => p.$active ? '#0e639c' : '#d6e0ea'};border-radius:6px;background:${p => p.$active ? '#eaf3ff' : '#fff'};color:${p => p.$active ? '#0e639c' : '#304255'};font-size:var(--font-size-xs);cursor:pointer;`
const ImageToolBtn = styled.button<{ $primary?: boolean; $danger?: boolean }>`height:32px;padding:0 12px;border:1px solid ${p => p.$danger ? '#f0b6b6' : p.$primary ? '#2f62d8' : '#d6e0ea'};border-radius:6px;background:${p => p.$danger ? '#fff4f4' : p.$primary ? '#2e68e6' : '#fff'};color:${p => p.$danger ? '#b42318' : p.$primary ? '#fff' : '#304255'};font-size:var(--font-size-xs);cursor:pointer;`
const ImageMetaText = styled.div`font-size:var(--font-size-xs);color:#7b8794;line-height:1.5;word-break:break-all;`
const StitchPanel = styled(FormulaPopover)`width:620px;max-width:calc(100vw - 32px);min-width:520px;`
const StitchColumns = styled.div`display:grid;grid-template-columns:240px 1fr;gap:14px;align-items:start;`
const StitchSidebar = styled.div`display:flex;flex-direction:column;gap:10px;`
const StitchPreview = styled.div`border:1px solid #d6e0ea;border-radius:8px;background:#f8fbff;min-height:260px;padding:12px;display:flex;align-items:center;justify-content:center;img{max-width:100%;max-height:320px;border-radius:6px;box-shadow:0 8px 24px rgba(19,41,61,.08);}`
const StitchImageList = styled.div`display:flex;flex-direction:column;gap:8px;max-height:280px;overflow:auto;border:1px solid #e7edf4;border-radius:8px;padding:8px;background:#fbfcfe;`
const StitchImageCard = styled.div<{ $selected?: boolean }>`display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid ${p => p.$selected ? '#92b4ff' : '#e2e8f0'};border-radius:8px;background:${p => p.$selected ? '#eef5ff' : '#fff'};`
const StitchHint = styled.div`font-size:var(--font-size-xs);color:#6b7280;line-height:1.6;`
const ImageResizeOverlay = styled.div`position:fixed;border:1px solid #2e68e6;box-shadow:0 0 0 1px rgba(46,104,230,.18);pointer-events:none;z-index:998;border-radius:4px;`
const ImageResizeHandle = styled.button<{ $position: 'nw' | 'ne' | 'sw' | 'se' | 'e' | 's' }>`position:fixed;width:12px;height:12px;border-radius:999px;border:2px solid #fff;background:#2e68e6;box-shadow:0 2px 6px rgba(19,41,61,.18);cursor:${p => {
  if (p.$position === 'e') return 'ew-resize'
  if (p.$position === 's') return 'ns-resize'
  return (p.$position === 'nw' || p.$position === 'se') ? 'nwse-resize' : 'nesw-resize'
}};z-index:999;padding:0;`
const ImageResizeHint = styled.div`position:fixed;z-index:999;padding:4px 8px;border-radius:999px;background:rgba(19,41,61,.82);color:#fff;font-size:var(--font-size-xs);line-height:1.4;pointer-events:none;white-space:nowrap;box-shadow:0 6px 20px rgba(19,41,61,.2);`
const CropDialogOverlay = styled.div`position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;`
const CropPanel = styled.div`background:#fff;border-radius:12px;box-shadow:0 8px 40px rgba(19,41,61,.22);display:flex;flex-direction:column;width:min(860px,96vw);max-height:92vh;overflow:hidden;`
const CropBody = styled.div`padding:16px 20px;overflow:auto;flex:1;display:flex;flex-direction:column;gap:14px;`
const CropImageWrapper = styled.div`position:relative;display:inline-block;overflow:hidden;cursor:crosshair;user-select:none;`
const CropSelection = styled.div`position:absolute;border:2px solid #fff;cursor:move;z-index:2;box-sizing:border-box;`
const CropHandle = styled.div<{$pos:string}>`position:absolute;width:10px;height:10px;background:#fff;border:1.5px solid #2e68e6;border-radius:2px;z-index:3;transform:translate(-50%,-50%);cursor:${p=>{const m:Record<string,string>={nw:'nwse-resize',ne:'nesw-resize',sw:'nesw-resize',se:'nwse-resize',n:'ns-resize',s:'ns-resize',w:'ew-resize',e:'ew-resize'};return m[p.$pos]||'pointer'}};`
const CropNumericRow = styled.div`display:grid;grid-template-columns:repeat(4,1fr);gap:10px;`
const CropNumericLabel = styled.label`display:flex;flex-direction:column;gap:4px;font-size:var(--font-size-xs);color:#516273;`

interface EditorPanelProps {
  ghostTextEnabled: boolean
  preferredEngineId?: DocumentEngineId
  manuscriptProfile?: ManuscriptProfileId
  headless?: boolean
  active?: boolean
}

type EditorSurfaceMode = 'edit' | 'preview'
interface InlineRewriteState { original: string; rewritten: string; from: number; to: number; posX: number; posY: number; streaming: boolean; anchorId?: string }
interface InlineExpandState { original: string; expanded: string; from: number; to: number; posX: number; posY: number; streaming: boolean; anchorId?: string }
interface InlineRefState { citations: CitationItem[]; selectedText: string; from: number; to: number; posX: number; posY: number; loading: boolean; selectedCitationKeys: string[]; anchorId?: string }
interface ComposerSelectionState { text: string; from: number; to: number; anchorId?: string }
interface FormulaDialogState { latex: string; naturalText: string; displayMode: 'inline' | 'block'; editPos: number | null; anchorX: number; anchorY: number; converting: boolean }
type ComposerMode = 'document'
type EditorCtxAction = 'generate' | 'rewrite' | 'expand' | 'reference' | 'continue' | 'image' | 'settings'
type ManuscriptSelectionAction = 'rewrite' | 'continue' | 'reference' | 'image'
type ImageCtxAction = 'replace-local' | 'stitch' | 'crop' | 'delete'
type ImageAlignment = 'left' | 'center' | 'right'
type StitchLayout = 'vertical' | 'horizontal' | 'grid'

const FORMULA_TEMPLATES: Array<{ label: string; latex: string }> = [
  { label: '分式', latex: '\\frac{a}{b}' },
  { label: '平方根', latex: '\\sqrt{x}' },
  { label: '上下标', latex: 'x_{i}^{2}' },
  { label: '求和', latex: '\\sum_{i=1}^{n} x_i' },
  { label: '积分', latex: '\\int_{a}^{b} f(x)\\,dx' },
  { label: '矩阵', latex: '\\begin{bmatrix}a & b \\\\ c & d\\end{bmatrix}' },
]

interface TextCtxMenuState {
  kind: 'text' | 'general'
  x: number
  y: number
  text: string
  from: number
  to: number
  anchorId?: string
}

interface ImageCtxMenuState {
  kind: 'image'
  x: number
  y: number
  image: {
    pos: number
    src: string
    alt: string
    title?: string
    caption?: string
    width?: number
    alignment: ImageAlignment
  }
}

type EditorCtxMenuState = TextCtxMenuState | ImageCtxMenuState

interface StitchFolderImageItem {
  name: string
  filePath: string
  previewUrl: string
  selected: boolean
}

interface StitchDialogState {
  imagePos: number
  folderPath: string
  images: StitchFolderImageItem[]
  layout: StitchLayout
  columns: number
  gap: number
  background: string
  fileName: string
  previewUrl: string
  building: boolean
  saving: boolean
}

interface CropDialogState {
  imagePos: number
  src: string
  fileName: string
  cropX: number
  cropY: number
  cropW: number
  cropH: number
  naturalWidth: number
  naturalHeight: number
  saving: boolean
}

type CropDragHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e' | 'create'
interface CropDragState {
  handle: CropDragHandle
  startClientX: number
  startClientY: number
  startCropX: number
  startCropY: number
  startCropW: number
  startCropH: number
}

interface ActiveImageOverlayState {
  pos: number
  left: number
  top: number
  width: number
  height: number
  aspectRatio: number
}

type ImageResizeHandlePosition = 'nw' | 'ne' | 'sw' | 'se' | 'e' | 's'

interface ImageResizeState {
  pos: number
  handle: ImageResizeHandlePosition
  startClientX: number
  startClientY: number
  startWidth: number
  startHeight: number
  aspectRatio: number
}

function computeImageResizeDimensions(
  state: ImageResizeState,
  deltaX: number,
  deltaY: number,
  freeResize: boolean,
): { width: number; height: number } {
  const widthSign = state.handle === 'nw' || state.handle === 'sw' ? -1 : 1
  const heightSign = state.handle === 'nw' || state.handle === 'ne' ? -1 : 1
  const widthEnabled = state.handle !== 's'
  const heightEnabled = state.handle !== 'e'
  const rawWidth = widthEnabled ? Math.max(40, Math.round(state.startWidth + deltaX * widthSign)) : Math.max(40, Math.round(state.startWidth))
  const rawHeight = heightEnabled ? Math.max(40, Math.round(state.startHeight + deltaY * heightSign)) : Math.max(40, Math.round(state.startHeight))

  if (freeResize) {
    return { width: rawWidth, height: rawHeight }
  }

  if (state.handle === 'e') {
    return {
      width: rawWidth,
      height: Math.max(40, Math.round(rawWidth / state.aspectRatio)),
    }
  }

  if (state.handle === 's') {
    return {
      width: Math.max(40, Math.round(rawHeight * state.aspectRatio)),
      height: rawHeight,
    }
  }

  const widthDriven = Math.abs(deltaX) >= Math.abs(deltaY)
  const nextWidth = widthDriven ? rawWidth : Math.max(40, Math.round(rawHeight * state.aspectRatio))
  return {
    width: nextWidth,
    height: Math.max(40, Math.round(nextWidth / state.aspectRatio)),
  }
}

function sanitizeImageFileName(value: string): string {
  return String(value || '').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || `image_${Date.now()}`
}

function stripDataUrlPrefix(value: string): string {
  const match = String(value || '').match(/^data:[^;]+;base64,(.*)$/)
  return match ? match[1] : String(value || '')
}

function fitImageSize(width: number, height: number, maxEdge = 1600): { width: number; height: number } {
  if (width <= maxEdge && height <= maxEdge) return { width, height }
  const scale = Math.min(maxEdge / width, maxEdge / height)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

async function loadBrowserImage(url: string): Promise<HTMLImageElement> {
  await new Promise<void>((resolve, reject) => {
    const probe = new window.Image()
    probe.onload = () => resolve()
    probe.onerror = () => reject(new Error(`图片加载失败: ${url}`))
    probe.src = url
  })
  const image = new window.Image()
  image.src = url
  await image.decode()
  return image
}

function htmlToPlainText(html: string): string {
  return html.replace(/<\/p>/gi, '\n\n').replace(/<br\s*\/?>/gi, '\n').replace(/<\/h[1-6]>/gi, '\n\n').replace(/<\/div>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim()
}

function extractFormulaLatexFromNode(node: Node): string {
  const element = node as HTMLElement
  const fromDataset = String((element as any)?.dataset?.latex || '').trim()
  if (fromDataset) return fromDataset
  const fromAttr = String(element?.getAttribute?.('data-latex') || '').trim()
  if (fromAttr) return fromAttr
  return String(element?.textContent || '').replace(/\s+/g, ' ').trim()
}

function isElementNode(node: Node): node is HTMLElement {
  return Boolean(node && (node as Node).nodeType === 1)
}

function readNodeData(node: HTMLElement, key: string): string {
  const fromDataset = (node as any)?.dataset?.[key]
  if (typeof fromDataset === 'string') return fromDataset
  const attrName = `data-${key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`
  const fromAttr = node.getAttribute?.(attrName)
  return typeof fromAttr === 'string' ? fromAttr : ''
}

function normalizeMarkdownFormulaOutput(markdown: string): string {
  return String(markdown || '')
    .replace(/\$\$\s*([\s\S]*?)\s*\$\$/g, (_match, latex) => {
      const normalizedLatex = String(latex || '').trim()
      if (!normalizedLatex) return ''
      return `$$\n${normalizedLatex}\n$$`
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function isMarkdownFilePath(filePath?: string | null, fileName?: string | null): boolean {
  const identity = String(filePath || fileName || '').trim().toLowerCase()
  return identity.endsWith('.md') || identity.endsWith('.markdown')
}

function shouldUseTiptapMarkdownBridge(): boolean {
  try {
    return window.localStorage.getItem('ai_writer_md_use_tiptap_markdown') !== 'false'
  } catch {
    return true
  }
}

function createEditorTurndownService(): TurndownService {
  const service = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' })
  service.addRule('preserveFileImages', {
    filter: 'img',
    replacement: (_content, node) => {
      const src = (node as HTMLImageElement).getAttribute('src') || ''
      const alt = (node as HTMLImageElement).getAttribute('alt') || ''
      return src ? `![${alt}](${src})` : ''
    },
  })
  service.addRule('preserveInlineFormula', {
    filter: (node) => isElementNode(node) && node.nodeName === 'SPAN' && readNodeData(node, 'formulaNode') === 'true' && readNodeData(node, 'formulaDisplay') === 'inline',
    replacement: (_content, node) => `$${extractFormulaLatexFromNode(node)}$`,
  })
  service.addRule('preserveBlockFormula', {
    filter: (node) => isElementNode(node) && node.nodeName === 'DIV' && readNodeData(node, 'formulaNode') === 'true' && readNodeData(node, 'formulaDisplay') === 'block',
    replacement: (_content, node) => {
      const latex = extractFormulaLatexFromNode(node)
      return `\n\n$$\n${latex}\n$$\n\n`
    },
  })
  service.addRule('preserveInlineOoxmlFormula', {
    filter: (node) => {
      if (!isElementNode(node) || node.nodeName !== 'SPAN') return false
      const element = node
      return readNodeData(element, 'ooxmlObject') === 'formula' && readNodeData(element, 'formulaDisplay') !== 'block'
    },
    replacement: (_content, node) => `$${extractFormulaLatexFromNode(node)}$`,
  })
  service.addRule('preserveBlockOoxmlFormula', {
    filter: (node) => {
      if (!isElementNode(node)) return false
      const element = node
      if (!element || readNodeData(element, 'ooxmlObject') !== 'formula') return false
      if (node.nodeName === 'DIV') return true
      return readNodeData(element, 'formulaDisplay') === 'block'
    },
    replacement: (_content, node) => {
      const latex = extractFormulaLatexFromNode(node)
      return `\n\n$$\n${latex}\n$$\n\n`
    },
  })
  return service
}

function normalizeSearchText(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function buildNormalizedPositionMap(text: string, positions: number[]): { text: string; positions: number[] } {
  let normalized = ''
  const normalizedPositions: number[] = []
  let pendingWhitespace = false
  let whitespacePosition: number | null = null

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    const position = positions[index]
    if (/\s/.test(character)) {
      if (normalized.length > 0) {
        pendingWhitespace = true
        if (whitespacePosition == null) whitespacePosition = position
      }
      continue
    }

    if (pendingWhitespace) {
      normalized += ' '
      normalizedPositions.push(whitespacePosition ?? position)
      pendingWhitespace = false
      whitespacePosition = null
    }

    normalized += character
    normalizedPositions.push(position)
  }

  return {
    text: normalized,
    positions: normalizedPositions,
  }
}

function findSelectionRangeInEditor(editor: Editor | null, targetText: string): { from: number; to: number } | null {
  const needle = String(targetText || '').trim()
  if (!editor || !needle) return null

  let serialized = ''
  const positions: number[] = []
  let hasContent = false

  forEachTiptapDocNode(editor, (node, pos) => {
    if (!node.isTextblock) return

    const blockTextParts: string[] = []
    const blockPositions: number[] = []

    node.descendants((child, childPos) => {
      if (child.isText) {
        const childText = child.text || ''
        for (let index = 0; index < childText.length; index += 1) {
          blockTextParts.push(childText[index])
          blockPositions.push(pos + 1 + childPos + index)
        }
        return
      }

      if (child.type.name === 'hardBreak') {
        blockTextParts.push('\n')
        blockPositions.push(pos + 1 + childPos)
      }
    })

    const blockText = blockTextParts.join('')
    if (!blockText) return

    if (hasContent) {
      const separatorPos = positions[positions.length - 1] ?? (pos + 1)
      serialized += '\n\n'
      positions.push(separatorPos, separatorPos)
    }

    serialized += blockText
    positions.push(...blockPositions)
    hasContent = true
  })

  if (!serialized || positions.length === 0) return null

  const exactIndex = serialized.indexOf(needle)
  if (exactIndex >= 0) {
    const from = positions[exactIndex]
    const to = positions[exactIndex + needle.length - 1]
    if (Number.isFinite(from) && Number.isFinite(to)) {
      return { from, to: to + 1 }
    }
  }

  const normalizedNeedle = normalizeSearchText(needle)
  if (!normalizedNeedle) return null
  const normalizedHaystack = buildNormalizedPositionMap(serialized, positions)
  const normalizedIndex = normalizedHaystack.text.indexOf(normalizedNeedle)
  if (normalizedIndex < 0) return null

  const from = normalizedHaystack.positions[normalizedIndex]
  const to = normalizedHaystack.positions[normalizedIndex + normalizedNeedle.length - 1]
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null
  return { from, to: to + 1 }
}

/** 与 EditorPage 样式 min-height 对齐，用于估算「约几页」 */
const EDITOR_PAGE_BASE_HEIGHT_PX = 1123
const EDITOR_PAGE_HEADER_RESERVE_PX = 36
const EDITOR_PAGE_FOOTER_RESERVE_PX = 36

type EditorDocumentTextStats = {
  totalChars: number
  nonSpaceChars: number
  latinWords: number
}

function computeEditorDocumentTextStats(editor: Editor | null): EditorDocumentTextStats {
  if (!editor?.state?.doc) return { totalChars: 0, nonSpaceChars: 0, latinWords: 0 }
  let totalChars = 0
  let nonSpaceChars = 0
  const wordChunks: string[] = []
  editor.state.doc.descendants((node) => {
    if (node.isText) {
      const t = node.text || ''
      totalChars += t.length
      nonSpaceChars += t.replace(/\s/g, '').length
      wordChunks.push(t)
      return
    }
    if (node.type.name === 'inlineFormula' || node.type.name === 'blockFormula') {
      const latex = String(node.attrs?.latex || '')
      totalChars += latex.length
      nonSpaceChars += latex.replace(/\s/g, '').length
      wordChunks.push(latex)
    }
  })
  const blob = wordChunks.join('\n').trim()
  const latinWords = blob ? blob.split(/\s+/).filter(Boolean).length : 0
  return { totalChars, nonSpaceChars, latinWords }
}

function estimateEditorPageUnitPx(showPageHeader: boolean, showPageFooter: boolean): number {
  let unit = EDITOR_PAGE_BASE_HEIGHT_PX
  if (showPageHeader) unit -= EDITOR_PAGE_HEADER_RESERVE_PX
  if (showPageFooter) unit -= EDITOR_PAGE_FOOTER_RESERVE_PX
  return Math.max(480, unit)
}

type EditorPageEstimate = { totalPages: number; currentPage: number }

function computeEditorPageEstimate(
  scrollEl: HTMLElement,
  pageEl: HTMLElement,
  showPageHeader: boolean,
  showPageFooter: boolean,
): EditorPageEstimate {
  const pageUnit = estimateEditorPageUnitPx(showPageHeader, showPageFooter)
  const totalHeight = Math.max(pageEl.offsetHeight, pageEl.scrollHeight)
  const totalPages = Math.max(1, Math.ceil(totalHeight / pageUnit))
  const viewportAnchor = scrollEl.scrollTop + scrollEl.clientHeight * 0.3
  const relativeY = viewportAnchor - pageEl.offsetTop
  const currentPage = Math.min(totalPages, Math.max(1, Math.floor(relativeY / pageUnit) + 1))
  return { totalPages, currentPage }
}

type EditorDocumentRenderBodyStyle = {
  pagePadding?: string
  fontFamily?: string
  fontSize?: string
  lineHeight?: string
  textIndent?: string
  paragraphSpacing?: string
  headingAlign?: 'left' | 'center'
}

type EditorDocumentRenderShell = {
  headerText?: string
  footerText?: string
  watermarkText?: string
  hasHeader?: boolean
  hasFooter?: boolean
  hasWatermark?: boolean
}

type EditorDocumentRenderState = {
  paperTemplateId?: PaperTemplateId
  bodyStyle?: EditorDocumentRenderBodyStyle
  shell?: EditorDocumentRenderShell
  templateLocked?: boolean
}

function normalizePaperTemplateId(value: string | null | undefined): PaperTemplateId | undefined {
  if (value === 'academic-cn' || value === 'academic-en' || value === 'thesis' || value === 'compact') {
    return value
  }
  return undefined
}

function parseEditorDocumentRenderState(source: string | null | undefined): EditorDocumentRenderState | undefined {
  if (!source) return undefined
  try {
    const parsed = JSON.parse(source) as EditorDocumentRenderState
    if (!parsed || typeof parsed !== 'object') return undefined
    return {
      paperTemplateId: normalizePaperTemplateId(parsed.paperTemplateId),
      bodyStyle: parsed.bodyStyle,
      shell: parsed.shell,
      templateLocked: false,
    }
  } catch {
    return undefined
  }
}

function parseCssBoxShorthand(value: string | undefined, fallback: string): [string, string, string, string] {
  const parts = String(value || fallback).trim().split(/\s+/).filter(Boolean)
  if (parts.length === 1) return [parts[0], parts[0], parts[0], parts[0]]
  if (parts.length === 2) return [parts[0], parts[1], parts[0], parts[1]]
  if (parts.length === 3) return [parts[0], parts[1], parts[2], parts[1]]
  if (parts.length >= 4) return [parts[0], parts[1], parts[2], parts[3]]
  return ['40px', '60px', '80px', '60px']
}

function buildEditorPagePadding(basePadding: string | undefined, hasHeader: boolean, hasFooter: boolean, fallback: string): string {
  const [top, right, bottom, left] = parseCssBoxShorthand(basePadding, fallback)
  return `${hasHeader ? `calc(${top} + 34px)` : top} ${right} ${hasFooter ? `calc(${bottom} + 30px)` : bottom} ${left}`
}

function unwrapEditorDocumentEnvelope(source: string): { contentHtml: string; renderState?: EditorDocumentRenderState } {
  const html = String(source || '')
  if (typeof document === 'undefined' || !html.trim().startsWith('<')) {
    return { contentHtml: html }
  }

  const host = document.createElement('div')
  host.innerHTML = html.trim()
  if (host.childElementCount !== 1) {
    return { contentHtml: html }
  }

  const root = host.firstElementChild as HTMLElement | null
  if (!root || root.tagName.toLowerCase() !== 'div') {
    return { contentHtml: html }
  }

  const parsedState = parseEditorDocumentRenderState(root.getAttribute('data-ai-writer-doc-meta'))
  const paperTemplateId = normalizePaperTemplateId(root.getAttribute('data-paper-template'))
  const hasEnvelope = root.getAttribute('data-ai-writer-doc-envelope') === 'true' || Boolean(parsedState) || Boolean(paperTemplateId)
  if (!hasEnvelope) {
    return { contentHtml: html }
  }

  return {
    contentHtml: root.innerHTML || '<p></p>',
    renderState: {
      ...(parsedState || {}),
      paperTemplateId: paperTemplateId || parsedState?.paperTemplateId,
      templateLocked: false,
    },
  }
}

function isSameRenderState(left: EditorDocumentRenderState | undefined, right: EditorDocumentRenderState | undefined): boolean {
  return JSON.stringify(left || null) === JSON.stringify(right || null)
}

function escapeStreamHtml(text: string): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function shouldRenderStreamChunkAsStructuredHtml(markdown: string, eventType?: 'references' | 'image'): boolean {
  const value = String(markdown || '')
  if (!value.trim()) return false
  if (eventType === 'references' || eventType === 'image') return true
  if (/^\s*</.test(value)) return true
  if (/\n\s*\n/.test(value)) return true
  return hasMarkdownSyntax(value)
}

function toStreamAppendHtml(markdown: string, eventType?: 'references' | 'image'): string {
  if (shouldRenderStreamChunkAsStructuredHtml(markdown, eventType)) {
    return markdownToHtml(markdown)
  }
  return escapeStreamHtml(markdown).replace(/\n/g, '<br>')
}

function splitStreamBufferAtStableBoundary(text: string): { flushText: string; remainder: string } {
  const value = String(text || '')
  if (!value) return { flushText: '', remainder: '' }

  const paragraphBreakMatch = /\n\s*\n(?!.*\n\s*\n)/.exec(value)
  if (paragraphBreakMatch && typeof paragraphBreakMatch.index === 'number') {
    const splitIndex = paragraphBreakMatch.index + paragraphBreakMatch[0].length
    return {
      flushText: value.slice(0, splitIndex),
      remainder: value.slice(splitIndex),
    }
  }

  let lastStrongBoundaryIndex = -1
  const strongBoundaryPattern = /[。！？；.!?;](?:["'”’）\]]+)?(?:\s+|$)|\n/g
  let match: RegExpExecArray | null
  while ((match = strongBoundaryPattern.exec(value)) !== null) {
    lastStrongBoundaryIndex = match.index + match[0].length
  }

  if (lastStrongBoundaryIndex > 0) {
    return {
      flushText: value.slice(0, lastStrongBoundaryIndex),
      remainder: value.slice(lastStrongBoundaryIndex),
    }
  }

  let lastSoftBoundaryIndex = -1
  const softBoundaryPattern = /[，、：,:](?:["'”’）\]]+)?(?:\s*|$)/g
  while ((match = softBoundaryPattern.exec(value)) !== null) {
    lastSoftBoundaryIndex = match.index + match[0].length
  }

  if (lastSoftBoundaryIndex >= STREAM_BUFFER_SOFT_FLUSH_CHARS) {
    return {
      flushText: value.slice(0, lastSoftBoundaryIndex),
      remainder: value.slice(lastSoftBoundaryIndex),
    }
  }

  return { flushText: '', remainder: value }
}

const STREAM_BUFFER_FLUSH_DELAY_MS = 80
const STREAM_BUFFER_FORCE_FLUSH_CHARS = 36
const STREAM_BUFFER_SOFT_FLUSH_CHARS = 10

function toFileUrl(localPath: string): string {
  return toSharedFileUrl(localPath)
}

function normalizeFileLikePath(rawPath: string): string {
  return normalizeSharedFileLikePath(rawPath)
}

function stripFileExtension(value: string): string {
  return String(value || '').replace(/\.[^.]+$/, '').trim()
}

function buildDefaultPptPrompt(title: string): string {
  const normalizedTitle = stripFileExtension(title) || '当前文稿'
  return `请基于《${normalizedTitle}》生成一份结构清晰、适合汇报展示的 PPT，突出核心信息、逻辑层次与可展示性。`
}

function normalizeReferenceContent(text: string): string {
  return String(text || '')
    .replace(/^(?:\[(\d+)\]|(\d+)[.)])\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function buildCitationSelectionKey(citation: CitationItem): string {
  return `${String(citation.doi || '').trim().toLowerCase()}|${normalizeReferenceContent(citation.citation)}|${Number(citation.number) || 0}`
}

function dedupeCitationItems(citations: CitationItem[]): CitationItem[] {
  const seen = new Set<string>()
  return citations.filter((citation) => {
    const key = buildCitationSelectionKey(citation)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function formatCitationMarker(citationNumbers: number[]): string {
  return formatCitationNumbers(citationNumbers)
}

function resolveLegacySelectionSemanticRole(editor: Editor | null): string | null {
  if (!editor) return null

  const selection = getTiptapSelectionRange(editor)
  if (!selection) return null

  const probePositions = [selection.from, Math.max(selection.to - 1, selection.from)]
  for (const position of probePositions) {
    try {
      const domNode = editor.view.domAtPos(position).node
      const element = domNode instanceof HTMLElement ? domNode : domNode.parentElement
      const semanticHost = element?.closest('[data-semantic-role]') as HTMLElement | null
      const semanticRole = semanticHost?.getAttribute('data-semantic-role') || null
      if (semanticRole) return semanticRole

      const block = element?.closest('h1, h2, h3, h4, h5, h6, p, li, div') as HTMLElement | null
      const blockText = String(block?.textContent || '').trim()
      if (/^(摘要|abstract)$/i.test(blockText)) return 'abstract-heading'
    } catch {
      continue
    }
  }

  return null
}

function isLegacySelectionInAbstractSection(editor: Editor | null): boolean {
  const semanticRole = resolveLegacySelectionSemanticRole(editor)
  return semanticRole === 'abstract-heading' || semanticRole === 'abstract-body'
}

function parseCitationNumber(text: string, fallbackNumber?: number): number | undefined {
  return parseLeadingCitationNumber(text, fallbackNumber)
}

function walkLegacyTextNodes(root: Node, visitor: (textNode: Text) => void) {
  const nodes = Array.from(root.childNodes)
  nodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      visitor(node as Text)
      return
    }
    walkLegacyTextNodes(node, visitor)
  })
}

function collectLegacyReferenceItems(editorHtml: string): CitationReferenceItem[] {
  if (typeof DOMParser === 'undefined') {
    return []
  }

  const doc = new DOMParser().parseFromString(`<div data-reference-root="true">${editorHtml}</div>`, 'text/html')
  const root = doc.querySelector('[data-reference-root="true"]') as HTMLDivElement | null
  if (!root) return []

  const headingMatcher = /^(参考文献|references)$/i
  const children = Array.from(root.children)
  const heading = children.find((element) => /^h[1-6]$/i.test(element.tagName) && headingMatcher.test(String(element.textContent || '').trim())) as HTMLElement | undefined
  if (!heading) return []

  const existingItems: CitationReferenceItem[] = []
  let cursor = heading.nextElementSibling as HTMLElement | null
  let listOrder = 1

  while (cursor) {
    if (/^h[1-6]$/i.test(cursor.tagName)) break

    if (cursor.tagName === 'P') {
      const paragraphText = String(cursor.textContent || '').trim()
      if (!paragraphText) {
        cursor = cursor.nextElementSibling as HTMLElement | null
        continue
      }
      const citationNumber = parseCitationNumber(paragraphText, listOrder)
      if (!citationNumber) break
      existingItems.push({ citationNumber, text: stripLeadingCitationPrefix(paragraphText) })
      listOrder += 1
      cursor = cursor.nextElementSibling as HTMLElement | null
      continue
    }

    if ((cursor.tagName === 'OL' || cursor.tagName === 'UL') && cursor.classList.contains('references-list')) {
      const items = Array.from(cursor.querySelectorAll('li'))
      items.forEach((item) => {
        const rawText = String(item.textContent || '').trim()
        if (!rawText) return
        const citationNumber = parseCitationNumber(rawText, listOrder)
        if (!citationNumber) return
        existingItems.push({ citationNumber, text: stripLeadingCitationPrefix(rawText) })
        listOrder += 1
      })
      cursor = cursor.nextElementSibling as HTMLElement | null
      continue
    }

    if (!String(cursor.textContent || '').trim()) {
      cursor = cursor.nextElementSibling as HTMLElement | null
      continue
    }

    break
  }

  return existingItems
}

function renumberLegacyCitationDocument(editorHtml: string): { html: string; changed: boolean; remap: Map<number, number>; orderedItems: CitationReferenceItem[] } {
  const emptyResult = { html: editorHtml, changed: false, remap: new Map<number, number>(), orderedItems: [] as CitationReferenceItem[] }
  if (typeof DOMParser === 'undefined') {
    return emptyResult
  }

  const doc = new DOMParser().parseFromString(`<div data-reference-root="true">${editorHtml}</div>`, 'text/html')
  const root = doc.querySelector('[data-reference-root="true"]') as HTMLDivElement | null
  if (!root) return emptyResult

  const headingMatcher = /^(参考文献|references)$/i
  const children = Array.from(root.children)
  const heading = children.find((element) => /^h[1-6]$/i.test(element.tagName) && headingMatcher.test(String(element.textContent || '').trim())) as HTMLElement | undefined
  if (!heading) return emptyResult

  const existingItems: Array<{ citationNumber: number; text: string }> = []
  const removableNodes: HTMLElement[] = []
  let cursor = heading.nextElementSibling as HTMLElement | null
  let listOrder = 1

  while (cursor) {
    if (/^h[1-6]$/i.test(cursor.tagName)) break

    if (cursor.tagName === 'P') {
      const paragraphText = String(cursor.textContent || '').trim()
      if (!paragraphText) {
        removableNodes.push(cursor)
        cursor = cursor.nextElementSibling as HTMLElement | null
        continue
      }
      const citationNumber = parseCitationNumber(paragraphText, listOrder)
      if (!citationNumber) break
      existingItems.push({ citationNumber, text: stripLeadingCitationPrefix(paragraphText) })
      removableNodes.push(cursor)
      listOrder += 1
      cursor = cursor.nextElementSibling as HTMLElement | null
      continue
    }

    if ((cursor.tagName === 'OL' || cursor.tagName === 'UL') && cursor.classList.contains('references-list')) {
      const items = Array.from(cursor.querySelectorAll('li'))
      items.forEach((item) => {
        const rawText = String(item.textContent || '').trim()
        if (!rawText) return
        const citationNumber = parseCitationNumber(rawText, listOrder)
        if (!citationNumber) return
        existingItems.push({ citationNumber, text: stripLeadingCitationPrefix(rawText) })
        listOrder += 1
      })
      removableNodes.push(cursor)
      cursor = cursor.nextElementSibling as HTMLElement | null
      continue
    }

    if (!String(cursor.textContent || '').trim()) {
      removableNodes.push(cursor)
      cursor = cursor.nextElementSibling as HTMLElement | null
      continue
    }

    break
  }

  if (!existingItems.length) return emptyResult

  const bodyClone = root.cloneNode(true) as HTMLDivElement
  const cloneHeading = bodyClone.querySelector('[data-semantic-role="references-heading"]')
    || Array.from(bodyClone.children).find((element) => /^h[1-6]$/i.test(element.tagName) && headingMatcher.test(String(element.textContent || '').trim()))
  if (cloneHeading instanceof HTMLElement) {
    let cloneCursor = cloneHeading.nextElementSibling as HTMLElement | null
    while (cloneCursor) {
      if (/^h[1-6]$/i.test(cloneCursor.tagName)) break
      const next = cloneCursor.nextElementSibling as HTMLElement | null
      cloneCursor.remove()
      cloneCursor = next
    }
    cloneHeading.remove()
  }

  const { remap, orderedItems } = buildCitationRenumberPlan(bodyClone.textContent || '', existingItems)
  if (!orderedItems.length) return emptyResult

  walkLegacyTextNodes(root, (textNode) => {
    if (heading.contains(textNode)) return
    textNode.textContent = updateCitationNumbersInText(textNode.textContent || '', remap)
  })

  removableNodes.forEach((node) => node.remove())
  const fragment = doc.createDocumentFragment()
  orderedItems.forEach((item) => {
    const paragraph = doc.createElement('p')
    paragraph.textContent = `[${item.citationNumber}] ${item.text}`
    paragraph.setAttribute('data-semantic-role', 'reference-item')
    paragraph.setAttribute('data-citation-number', String(item.citationNumber))
    fragment.appendChild(paragraph)
  })
  heading.after(fragment)

  const nextHtml = root.innerHTML
  return { html: nextHtml, changed: nextHtml !== editorHtml, remap, orderedItems }
}

function upsertCitationReferenceSection(editorHtml: string, citation: CitationItem): { html: string; changed: boolean; citationNumber: number } {
  if (typeof DOMParser === 'undefined') {
    return { html: editorHtml, changed: false, citationNumber: citation.number }
  }

  const doc = new DOMParser().parseFromString(`<div data-reference-root="true">${editorHtml}</div>`, 'text/html')
  const root = doc.querySelector('[data-reference-root="true"]') as HTMLDivElement | null
  if (!root) {
    return { html: editorHtml, changed: false, citationNumber: citation.number }
  }

  const headingMatcher = /^(参考文献|references)$/i
  const children = Array.from(root.children)
  let heading = children.find((element) => /^h[1-6]$/i.test(element.tagName) && headingMatcher.test(String(element.textContent || '').trim())) as HTMLElement | undefined

  if (!heading) {
    heading = doc.createElement('h2')
    heading.textContent = '参考文献'
    heading.setAttribute('data-semantic-role', 'references-heading')
    root.appendChild(heading)
  }

  const existingItems: Array<{ citationNumber?: number; text: string }> = []
  const removableNodes: HTMLElement[] = []
  let cursor = heading.nextElementSibling as HTMLElement | null
  let listOrder = 1

  while (cursor) {
    if (/^h[1-6]$/i.test(cursor.tagName)) break

    if (cursor.tagName === 'P') {
      const paragraphText = String(cursor.textContent || '').trim()
      if (!paragraphText) {
        removableNodes.push(cursor)
        cursor = cursor.nextElementSibling as HTMLElement | null
        continue
      }
      const citationNumber = parseCitationNumber(paragraphText)
      if (!citationNumber) break
      existingItems.push({ citationNumber, text: stripLeadingCitationPrefix(paragraphText) })
      removableNodes.push(cursor)
      cursor = cursor.nextElementSibling as HTMLElement | null
      continue
    }

    if ((cursor.tagName === 'OL' || cursor.tagName === 'UL') && cursor.classList.contains('references-list')) {
      const items = Array.from(cursor.querySelectorAll('li'))
      items.forEach((item) => {
        const rawText = String(item.textContent || '').trim()
        if (!rawText) return
        const citationNumber = parseCitationNumber(rawText, listOrder)
        existingItems.push({ citationNumber, text: stripLeadingCitationPrefix(rawText) })
        listOrder += 1
      })
      removableNodes.push(cursor)
      cursor = cursor.nextElementSibling as HTMLElement | null
      continue
    }

    if (!String(cursor.textContent || '').trim()) {
      removableNodes.push(cursor)
      cursor = cursor.nextElementSibling as HTMLElement | null
      continue
    }

    break
  }

  let assignedNumber: number | undefined
  const nextReferenceText = String(citation.citation || '').trim()
  const nextItem = {
    citationNumber: citation.number,
    text: String(citation.citation || '').trim(),
  }
  const nextNormalized = normalizeReferenceContent(nextReferenceText)
  let merged = false

  const mergedItems = existingItems.map((item, index) => {
    const sameText = normalizeReferenceContent(item.text) === nextNormalized
    if (sameText) {
      merged = true
      assignedNumber = item.citationNumber || index + 1
      return {
        citationNumber: assignedNumber,
        text: nextReferenceText,
      }
    }
    return item
  })

  if (!merged) {
    const currentMax = mergedItems.reduce((maxValue, item, index) => {
      const value = item.citationNumber || index + 1
      return Math.max(maxValue, value)
    }, 0)
    assignedNumber = currentMax + 1
    mergedItems.push({
      citationNumber: assignedNumber,
      text: nextReferenceText,
    })
  }

  const resolvedCitationNumber = assignedNumber || citation.number

  mergedItems.sort((left, right) => {
    const leftNumber = left.citationNumber ?? Number.MAX_SAFE_INTEGER
    const rightNumber = right.citationNumber ?? Number.MAX_SAFE_INTEGER
    if (leftNumber === rightNumber) {
      return left.text.localeCompare(right.text, 'zh-CN')
    }
    return leftNumber - rightNumber
  })

  removableNodes.forEach((node) => node.remove())

  const fragment = doc.createDocumentFragment()
  mergedItems.forEach((item, index) => {
    const paragraph = doc.createElement('p')
    const citationNumber = item.citationNumber || index + 1
    paragraph.textContent = `[${citationNumber}] ${item.text}`
    paragraph.setAttribute('data-semantic-role', 'reference-item')
    paragraph.setAttribute('data-citation-number', String(citationNumber))
    fragment.appendChild(paragraph)
  })
  heading.after(fragment)

  const nextHtml = root.innerHTML
  return { html: nextHtml, changed: nextHtml !== editorHtml, citationNumber: resolvedCitationNumber }
}

function formatImageSourceMeta(rawSource: string): string {
  const source = String(rawSource || '').trim()
  if (!source) return '当前图片未记录来源地址'

  const embeddedMatch = source.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/i)
  if (embeddedMatch) {
    const mediaSubtype = embeddedMatch[1].replace(/^image\//i, '').toUpperCase()
    const payloadLength = stripDataUrlPrefix(source).length
    const approxKilobytes = Math.max(1, Math.round((payloadLength * 3) / 4 / 1024))
    return `内嵌图片 · ${mediaSubtype} · 约 ${approxKilobytes} KB`
  }

  if (/^https?:\/\//i.test(source)) {
    try {
      const url = new URL(source)
      const fileName = decodeURIComponent(url.pathname.split('/').pop() || '')
      return fileName ? `远程图片 · ${fileName} · ${url.host}` : `远程图片 · ${url.host}`
    } catch {
      return source
    }
  }

  const normalizedPath = normalizeFileLikePath(source)
  const fileName = normalizedPath.split(/[\\/]/).pop() || normalizedPath
  if (fileName && normalizedPath && fileName !== normalizedPath) {
    return `本地图片 · ${fileName} · ${normalizedPath}`
  }
  return normalizedPath || source
}

function resolveFloatingPanelPosition(anchorX: number, anchorY: number, width = 460, estimatedHeight = 260): { left: number; top: number } {
  const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight
  const left = Math.min(Math.max(16, anchorX), viewportWidth - width - 16)
  const top = Math.min(Math.max(16, anchorY), viewportHeight - estimatedHeight - 16)
  return { left, top }
}

function sanitizeGeneratedLatex(raw: string): string {
  let next = String(raw || '').trim()
  next = next.replace(/^```(?:latex)?\s*/i, '').replace(/\s*```$/, '').trim()
  if (next.startsWith('$$') && next.endsWith('$$')) {
    next = next.slice(2, -2).trim()
  } else if (next.startsWith('$') && next.endsWith('$')) {
    next = next.slice(1, -1).trim()
  }
  return next
}

const EditorPanel: React.FC<EditorPanelProps> = ({
  ghostTextEnabled,
  preferredEngineId = 'legacy-tiptap-bridge',
  manuscriptProfile = 'freewrite',
  headless = false,
  active = true,
}) => {
  const { markdown, setMarkdown, filePath, dirty, setDirty, isGenerating, setIsGenerating, tabs, activeTabId, switchTab, closeTab, openTab, setStatusMessage, articleType, setArticleType, articleSections, setArticleSections, mainTabId, currentFileName, setTabShellContent, markTabShellSaved, ensureWritableManuscriptTarget, isTabDirty, registerSaveHandler } = useDocument()
  const workbench = useGenerationWorkbench()
  const compatDocumentArtifact = workbench.sessions.document.documentArtifact
  const setWorkbenchModeSession = workbench.setModeSession
  const knowledge = useKnowledge()
  const { language } = useLanguage()
  const { mode: workspaceMode, currentMode, enterPptGenerationMode } = useWorkspaceMode()
  const { activeWorkspacePath, createWorkspace, openWorkspace, refreshTree } = useWorkspace()
  const skipUpdateRef = useRef(false)
  const pendingTiptapRestoreRef = useRef<Map<string, { tiptapJson: Record<string, unknown>; paperTemplateId?: string }>>(new Map())
  const [showDocxMigrationBanner, setShowDocxMigrationBanner] = useState(false)
  const [generationSettings, setGenerationSettings] = useState(() => getAIToolSettings())
  const [ctxMenu, setCtxMenu] = useState<EditorCtxMenuState | null>(null)
  const closeCtxMenu = useCallback(() => setCtxMenu(null), [])
  const [imageToolDraft, setImageToolDraft] = useState<{ pos: number; width: string; alignment: ImageAlignment; title: string } | null>(null)
  const [stitchDialog, setStitchDialog] = useState<StitchDialogState | null>(null)
  const [cropDialog, setCropDialog] = useState<CropDialogState | null>(null)
  const [cropDragState, setCropDragState] = useState<CropDragState | null>(null)
  const cropContainerRef = useRef<HTMLDivElement | null>(null)
  const [activeImageOverlay, setActiveImageOverlay] = useState<ActiveImageOverlayState | null>(null)
  const [imageResizeState, setImageResizeState] = useState<ImageResizeState | null>(null)
  const [inlineRewrite, setInlineRewrite] = useState<InlineRewriteState | null>(null)
  const rewriteAbortRef = useRef<AbortController | null>(null)
  const [rewritePromptDialog, setRewritePromptDialog] = useState<{ text: string; from: number; to: number; posX: number; posY: number; anchorId?: string } | null>(null)
  const [rewriteCustomPrompt, setRewriteCustomPrompt] = useState('')
  const rewritePromptInputRef = useRef<HTMLTextAreaElement | null>(null)
  const [inlineExpand, setInlineExpand] = useState<InlineExpandState | null>(null)
  const expandAbortRef = useRef<AbortController | null>(null)
  const [expandPromptDialog, setExpandPromptDialog] = useState<{ text: string; from: number; to: number; posX: number; posY: number; anchorId?: string; contextBefore: string; contextAfter: string } | null>(null)
  const [expandCustomPrompt, setExpandCustomPrompt] = useState('')
  const expandPromptInputRef = useRef<HTMLTextAreaElement | null>(null)
  const expandDialogDrag = useDraggable()
  const expandOverlayDrag = useDraggable()
  useEffect(() => {
    if (expandPromptDialog) {
      expandDialogDrag.resetPos(
        Math.min(expandPromptDialog.posX, window.innerWidth - 480),
        Math.min(expandPromptDialog.posY, window.innerHeight - 280),
      )
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandPromptDialog?.posX, expandPromptDialog?.posY])
  useEffect(() => {
    if (inlineExpand) {
      expandOverlayDrag.resetPos(
        Math.min(inlineExpand.posX, window.innerWidth - 700),
        Math.min(inlineExpand.posY, window.innerHeight - 400),
      )
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inlineExpand?.posX, inlineExpand?.posY])
  const [inlineRef, setInlineRef] = useState<InlineRefState | null>(null)
  const continueAbortRef = useRef<AbortController | null>(null)
  const [continueStreamState, setContinueStreamState] = useState<{ phase: 'idle' | 'running' | 'completed' | 'stopped' | 'error'; message: string; insertedChars: number }>({ phase: 'idle', message: '', insertedChars: 0 })
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerTopic, setComposerTopic] = useState('')
  const [composerAutoStartNonce, setComposerAutoStartNonce] = useState(0)
  const [composerInitialMode, setComposerInitialMode] = useState<ComposerMode>('document')
  const [composerDocumentFlow, setComposerDocumentFlow] = useState<'auto' | 'paper-generation' | 'assistant' | 'rewrite'>('auto')
  const [composerAutoRunOnOpen, setComposerAutoRunOnOpen] = useState(false)
  const [composerTargetTabId, setComposerTargetTabId] = useState('')
  const [composerManualEditNonce, setComposerManualEditNonce] = useState(0)
  const [composerManualEditTabId, setComposerManualEditTabId] = useState('')
  const [composerSelection, setComposerSelection] = useState<ComposerSelectionState | null>(null)
  const [composerSelectionStructureContext, setComposerSelectionStructureContext] = useState<StructuredRemakeContext | null>(null)
  const [composerSilentMode, setComposerSilentMode] = useState(false)
  const [composerRunning, setComposerRunning] = useState(false)
  const [composerPaused, setComposerPaused] = useState(false)
  const [formulaDialog, setFormulaDialog] = useState<FormulaDialogState | null>(null)
  const [shadowText, setShadowText] = useState('')
  const [autoScrollPaused, setAutoScrollPaused] = useState(false)
  const [paperTemplateId, setPaperTemplateId] = useState<PaperTemplateId>(() => {
    const saved = localStorage.getItem('ai_writer_paper_template')
    return (saved as PaperTemplateId) || getRecommendedPaperTemplateId(language) || DEFAULT_PAPER_TEMPLATE_ID
  })
  const [renderStateByTabId, setRenderStateByTabId] = useState<Record<string, EditorDocumentRenderState>>({})
  const [surfaceModeByTabId, setSurfaceModeByTabId] = useState<Record<string, EditorSurfaceMode>>({})
  const [previewRefreshVersionByTabId, setPreviewRefreshVersionByTabId] = useState<Record<string, number>>({})
  const [previewDocumentActionBusy, setPreviewDocumentActionBusy] = useState<'knowledge' | 'ppt' | null>(null)
  const [pptPromptDialogOpen, setPptPromptDialogOpen] = useState(false)
  const [showJournalExportDialog, setShowJournalExportDialog] = useState(false)
  const [pptPromptDraft, setPptPromptDraft] = useState('')
  const [docTextStats, setDocTextStats] = useState<EditorDocumentTextStats>({ totalChars: 0, nonSpaceChars: 0, latinWords: 0 })
  const [pageEstimate, setPageEstimate] = useState<EditorPageEstimate>({ totalPages: 1, currentPage: 1 })
  const editorScrollRef = useRef<HTMLDivElement | null>(null)
  const editorPageShellRef = useRef<HTMLDivElement | null>(null)
  const layoutMetricsRafRef = useRef<number | null>(null)
  const formulaInputRef = useRef<HTMLTextAreaElement | null>(null)
  const formulaDialogOpenRef = useRef(false)
  const formulaAiAbortRef = useRef<AbortController | null>(null)
  const paperStreamSessionRef = useRef<{ tabId: string; manualModified: boolean; active: boolean }>({ tabId: '', manualModified: false, active: false })
  const composerRunningRef = useRef(false)
  const composerTargetTabIdRef = useRef('')
  const activeTabIdRef = useRef(activeTabId)
  const mainTabIdRef = useRef(mainTabId)
  const composerManualEditReportedRef = useRef<{ tabId: string; reported: boolean }>({ tabId: '', reported: false })
  const autoOpenedComposerTabIdsRef = useRef<Set<string>>(new Set())
  const dismissedComposerTabIdsRef = useRef<Set<string>>(new Set())

  const { requestOpenFromDialog, openDocumentPath, saveActiveDocument, saveActiveDocumentAs } = useDocumentEngineHostCommands()
  const { getSession, stopWritingForTab, ensureSession } = useEditorSession()

  const createAndOpenBlankWorkspaceDocument = useCallback(async (workspacePath: string, preferredName?: string) => {
    const normalizedName = String(preferredName || '').trim().replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_') || '未命名文档'
    const result = await window.electronAPI.createBlankDocument(workspacePath, `${normalizedName}.aidoc.json`)
    await openDocumentPath(result.path, { isInternalOpen: true })
    void refreshTree().catch(() => undefined)
    return result.path
  }, [openDocumentPath, refreshTree])

  const handleCreateArticle = useCallback(async () => {
    const articleName = window.prompt('输入新文章名称')?.trim()
    if (!articleName) return
    try {
      const wsPath = await createWorkspace(articleName)
      if (!wsPath) return
      await openWorkspace(wsPath)
      await createAndOpenBlankWorkspaceDocument(wsPath, articleName)
      setStatusMessage(`已创建工作区并打开新文档: ${articleName}`)
    } catch (error: any) {
      setStatusMessage(`创建文章失败: ${error?.message || '未知错误'}`)
    }
  }, [createAndOpenBlankWorkspaceDocument, createWorkspace, openWorkspace, setStatusMessage])

  const handleCreateWorkspaceDocument = useCallback(async () => {
    if (!activeWorkspacePath) return
    try {
      await createAndOpenBlankWorkspaceDocument(activeWorkspacePath)
      setStatusMessage('已创建并打开新文档')
    } catch (error: any) {
      setStatusMessage(`新建文档失败: ${error?.message || '未知错误'}`)
    }
  }, [activeWorkspacePath, createAndOpenBlankWorkspaceDocument, setStatusMessage])

  const paperStreamMutationRef = useRef(false)
  const paperStreamBufferRef = useRef<{ tabId: string; text: string }>({ tabId: '', text: '' })
  const paperStreamFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const paperStreamMutationClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeSurfaceRef = useRef(active)
  activeSurfaceRef.current = active
  const autoSavePathsRef = useRef<Record<string, string>>({})
  const imageWorkspaceMapRef = useRef<Record<string, string>>({})
  const templatePinnedRef = useRef(Boolean(localStorage.getItem('ai_writer_paper_template')))
  const turndownRef = useRef<TurndownService | null>(null)
  const activeTabIsMarkdownRef = useRef(false)
  const mdBridgeEnabledRef = useRef(shouldUseTiptapMarkdownBridge())
  const activeTab = tabs.find((tab) => tab.id === activeTabId) || null
  const activeTabPreview = activeTab?.preview || null
  const activeMailAttachmentSource = activeTab?.sourceContext?.source === 'mail-attachment' ? activeTab.sourceContext : null
  const isPdfPreviewTab = activeTabPreview?.kind === 'pdf'
  const isReadonlyPreviewTab = Boolean(activeTabPreview)
  const activeTabIsDocx = Boolean(activeTab?.filePath && activeTab.filePath.toLowerCase().endsWith('.docx'))
  const activeTabIsAidocJson = Boolean(activeTab?.filePath && activeTab.filePath.toLowerCase().endsWith('.aidoc.json'))

  // Show migration banner whenever the active tab is a legacy .docx file
  useEffect(() => {
    setShowDocxMigrationBanner(activeTabIsDocx)
  }, [activeTabId, activeTabIsDocx])
  const activeSurfaceMode = activeTabId ? (surfaceModeByTabId[activeTabId] || 'edit') : 'edit'
  const isReadonlyDocPreviewMode = Boolean(activeTab && !isReadonlyPreviewTab && activeTabIsDocx && activeSurfaceMode === 'preview')
  const canUsePreviewDocumentActions = Boolean((activeTabIsDocx || activeTabIsAidocJson) && activeTab?.filePath)
  const activePreviewRefreshVersion = activeTabId ? (previewRefreshVersionByTabId[activeTabId] || 0) : 0
  const documentPreview = useDocumentPreview(isReadonlyDocPreviewMode ? activeTab?.filePath : null, activePreviewRefreshVersion)
  const activeRenderState = activeTabId ? renderStateByTabId[activeTabId] : undefined
  const activeBodyStyle = activeRenderState?.bodyStyle
  const activeShell = activeRenderState?.shell
  const resolvedPaperTemplateId: PaperTemplateId = paperTemplateId
  const activeTemplateDefinition = getPaperTemplate(resolvedPaperTemplateId)
  const showPageHeader = Boolean(activeShell?.hasHeader || String(activeShell?.headerText || '').trim())
  const showPageFooter = Boolean(activeShell?.hasFooter || String(activeShell?.footerText || '').trim())
  const showPageWatermark = Boolean(String(activeShell?.watermarkText || '').trim())
  const activePagePadding = buildEditorPagePadding(activeBodyStyle?.pagePadding, showPageHeader, showPageFooter, pageMarginsToCSS(activeTemplateDefinition.pageMargins))
  const activeEditorFontSizePx = parseFloat(activeBodyStyle?.fontSize || activeTemplateDefinition.fontSize) || parseFloat(activeTemplateDefinition.fontSize) || 15
  const activeEditorPageStyle = {
    '--editor-page-padding': activePagePadding,
    '--editor-font-family': activeBodyStyle?.fontFamily || activeTemplateDefinition.fontFamily,
    '--editor-font-size': activeBodyStyle?.fontSize || activeTemplateDefinition.fontSize,
    '--editor-font-size-px': `${activeEditorFontSizePx}px`,
    '--editor-line-height': activeBodyStyle?.lineHeight || activeTemplateDefinition.lineHeight,
    '--editor-text-indent': activeBodyStyle?.textIndent || activeTemplateDefinition.textIndent,
    '--editor-paragraph-spacing': activeBodyStyle?.paragraphSpacing || activeTemplateDefinition.paragraphSpacing,
    '--editor-heading-align': activeBodyStyle?.headingAlign || (activeTemplateDefinition.headingAlign === 'center' ? 'center' : 'left'),
  } as React.CSSProperties
  const activeTabHasBoundTemplate = Boolean(activeRenderState?.paperTemplateId)
  const activeTabIsMarkdown = isMarkdownFilePath(activeTab?.filePath || null, activeTab?.fileName || null)
  activeTabIsMarkdownRef.current = activeTabIsMarkdown

  const flushLayoutMetrics = useCallback(() => {
    layoutMetricsRafRef.current = null
    if (isReadonlyDocPreviewMode) return
    const scrollEl = editorScrollRef.current
    const pageEl = editorPageShellRef.current
    if (!scrollEl || !pageEl) return
    const next = computeEditorPageEstimate(scrollEl, pageEl, showPageHeader, showPageFooter)
    setPageEstimate((prev) => (prev.totalPages === next.totalPages && prev.currentPage === next.currentPage ? prev : next))
  }, [isReadonlyDocPreviewMode, showPageFooter, showPageHeader])

  const scheduleLayoutMetrics = useCallback(() => {
    if (isReadonlyDocPreviewMode) return
    if (layoutMetricsRafRef.current != null) return
    layoutMetricsRafRef.current = window.requestAnimationFrame(() => {
      flushLayoutMetrics()
    })
  }, [flushLayoutMetrics, isReadonlyDocPreviewMode])

  const handleSurfaceModeChange = useCallback((mode: EditorSurfaceMode) => {
    if (!activeTabId) return
    if (mode === 'preview' && !activeTabIsDocx) return
    setSurfaceModeByTabId((current) => {
      if ((current[activeTabId] || 'edit') === mode) return current
      return { ...current, [activeTabId]: mode }
    })
  }, [activeTabId, activeTabIsDocx])

  const bumpPreviewRefreshVersion = useCallback((tabId: string) => {
    if (!tabId) return
    setPreviewRefreshVersionByTabId((current) => ({
      ...current,
      [tabId]: (current[tabId] || 0) + 1,
    }))
  }, [])

  useEffect(() => subscribeToAIToolSettingsUpdates(setGenerationSettings), [])

  useEffect(() => {
    composerRunningRef.current = composerRunning
  }, [composerRunning])

  useEffect(() => {
    composerTargetTabIdRef.current = composerTargetTabId
  }, [composerTargetTabId])

  useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId])

  useEffect(() => {
    mainTabIdRef.current = mainTabId
  }, [mainTabId])

  useEffect(() => {
    setSurfaceModeByTabId((current) => {
      const validTabIds = new Set(tabs.map((tab) => tab.id))
      let changed = false
      const nextState: Record<string, EditorSurfaceMode> = {}
      Object.entries(current).forEach(([tabId, mode]) => {
        if (validTabIds.has(tabId)) {
          nextState[tabId] = mode
        } else {
          changed = true
        }
      })
      return changed ? nextState : current
    })
    setPreviewRefreshVersionByTabId((current) => {
      const validTabIds = new Set(tabs.map((tab) => tab.id))
      let changed = false
      const nextState: Record<string, number> = {}
      Object.entries(current).forEach(([tabId, version]) => {
        if (validTabIds.has(tabId)) {
          nextState[tabId] = version
        } else {
          changed = true
        }
      })
      return changed ? nextState : current
    })
  }, [tabs])

  useEffect(() => {
    if (activeTabId && activeSurfaceMode === 'preview' && !activeTabIsDocx) {
      setSurfaceModeByTabId((current) => ({ ...current, [activeTabId]: 'edit' }))
    }
  }, [activeSurfaceMode, activeTabId, activeTabIsDocx])

  useEffect(() => {
    tabs.forEach((tab) => ensureSession(tab.id))
  }, [ensureSession, tabs])

  const handleCloseTabWithSessionGuard = useCallback(async (tabId: string) => {
    const session = getSession(tabId)
    if (session?.writingRunning || session?.activeTaskId) {
      const shouldStop = window.confirm('该标签页有进行中的写作任务，关闭前将先终止任务。是否继续？')
      if (!shouldStop) return
      await stopWritingForTab(tabId)
      setStatusMessage('已终止该标签页对应任务，正在关闭标签页')
    }
    await closeTab(tabId)
  }, [closeTab, getSession, setStatusMessage, stopWritingForTab])

  useEffect(() => {
    const normalizedMarkdown = String(markdown || '').trim()
    if (!normalizedMarkdown) {
      setArticleType(null)
      setArticleSections([])
      return
    }

    const profile = getEffectiveGenerationProfile(generationSettings)
    const blueprint = resolveArticleBlueprint({
      paperType: profile.paperType === 'thesis_research' ? 'research' : profile.paperType,
      language: profile.language,
      markdown: normalizedMarkdown,
    })

    setArticleType(blueprint.articleType)
    setArticleSections(blueprint.sections)
  }, [generationSettings, markdown, setArticleSections, setArticleType])

  const getAutoSaveTargetPath = useCallback((tabId: string, tabFilePath: string | null, tabName: string) => {
    if (tabFilePath) return tabFilePath
    if (!activeWorkspacePath) return null
    if (autoSavePathsRef.current[tabId]) return autoSavePathsRef.current[tabId]
    const safeBaseName = String(tabName || '未命名文档').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_') || '未命名文档'
    const shortId = tabId.replace(/[^a-zA-Z0-9_-]/g, '').slice(-8) || 'draft'
    // Use .aidoc.json for internal auto-save to avoid lossy OOXML round-trips
    const targetPath = `${activeWorkspacePath}/${safeBaseName}-${shortId}.aidoc.json`
    autoSavePathsRef.current[tabId] = targetPath
    return targetPath
  }, [activeWorkspacePath])

  const syncSavedTargetPath = useCallback((tabId: string, targetPath: string) => {
    autoSavePathsRef.current[tabId] = targetPath
  }, [])

  if (!turndownRef.current) {
    turndownRef.current = createEditorTurndownService()
  }

  const serializeForFilePath = useCallback((targetPath: string, exportHtml: string, editorInstance?: Editor | null) => {
    const ext = targetPath.toLowerCase()
    if (ext.endsWith('.aidoc.json')) {
      // Lossless internal format: serialize TipTap JSON + metadata
      const tiptapJson = editorInstance ? editorInstance.getJSON() : null
      const payload = JSON.stringify({
        version: 1,
        format: 'aidoc',
        paperTemplateId: resolvedPaperTemplateId,
        tiptapJson,
        // Keep HTML as fallback for compatibility
        html: exportHtml,
      })
      return { kind: 'text' as const, content: payload }
    }
    const fileExt = targetPath.split('.').pop()?.toLowerCase()
    if (fileExt === 'docx') return { kind: 'docx' as const, content: exportHtml }
    if (fileExt === 'html' || fileExt === 'htm') return { kind: 'text' as const, content: exportHtml }
    if (fileExt === 'txt') return { kind: 'text' as const, content: htmlToPlainText(exportHtml) }
    if (fileExt === 'md' || fileExt === 'markdown') {
      if (editorInstance && mdBridgeEnabledRef.current) {
        try {
          return { kind: 'text' as const, content: normalizeMarkdownFormulaOutput(serializeEditorToMarkdownWithBridge(editorInstance)) }
        } catch {
          // fall through to turndown fallback
        }
      }
      const service = turndownRef.current || createEditorTurndownService()
      const markdownContent = service.turndown(exportHtml)
      return { kind: 'text' as const, content: normalizeMarkdownFormulaOutput(markdownContent) }
    }
    return { kind: 'text' as const, content: exportHtml }
  }, [resolvedPaperTemplateId])

  const buildCompatDocumentArtifact = useCallback(() => {
    if (manuscriptProfile === 'templateDocument') return null
    if (!activeTabId || tabs.length === 0 || isReadonlyPreviewTab) return null

    const sourceId = String(filePath || activeTab?.filePath || activeTabId || '').trim() || activeTabId
    const rawTitle = String(currentFileName || '').replace(/\.[^.]+$/, '').trim()
    const title = rawTitle && rawTitle !== '未命名文档' ? rawTitle : undefined
    const envelope = unwrapEditorDocumentEnvelope(String(markdown || ''))
    const contentHtml = String(envelope.contentHtml || '').trim()
    const artifactId = `${manuscriptProfile}:${activeTabId}`
    const document = buildDocumentSchemaFromHtml({
      id: `document:${artifactId}`,
      profile: manuscriptProfile,
      title,
      html: contentHtml,
      sourceRefs: sourceId ? [sourceId] : undefined,
      metadata: {
        filePath: sourceId || undefined,
        fileName: currentFileName,
        source: 'editor-panel-compat-a4',
      },
    })

    if (manuscriptProfile === 'paper') {
      return createDocumentArtifact({
        id: artifactId,
        profile: manuscriptProfile,
        document,
        sourceRefs: sourceId ? [sourceId] : undefined,
        metadata: {
          artifactBoundary: 'compat-result',
          command: 'generate-body',
          session: paperOrchestrator.createSession({
            topic: title,
            referenceDocumentIds: knowledge.referenceDocumentIds,
          }),
          source: 'editor-panel-compat-a4',
        },
      })
    }

    return createDocumentArtifact({
      id: artifactId,
      profile: manuscriptProfile,
      document,
      sourceRefs: sourceId ? [sourceId] : undefined,
      metadata: {
        command: 'generate-into-document',
        session: freewriteOrchestrator.createSession({
          activeDocumentId: sourceId,
          rewriteMode: 'generate-into-document',
        }),
        source: 'editor-panel-compat-a4',
      },
    })
  }, [activeTab?.filePath, activeTabId, currentFileName, filePath, isReadonlyPreviewTab, knowledge.referenceDocumentIds, manuscriptProfile, markdown, tabs.length])

  useEffect(() => {
    if (manuscriptProfile === 'templateDocument') return
    // Only overwrite the workbench document artifact when there is no canonical
    // artifact already present (i.e. one that was produced by generation and is
    // not itself a compat-a4 echo). This prevents the legacy turndown
    // re-textification from clobbering a freshly normalised paper artifact.
    const nextArtifact = buildCompatDocumentArtifact()
    setWorkbenchModeSession('document', (session) => {
      const existingSource = String(session.documentArtifact?.metadata?.source ?? '')
      const isCompatOwned = !session.documentArtifact || existingSource === 'editor-panel-compat-a4'
      if (!isCompatOwned) return session
      return {
        ...session,
        documentArtifact: nextArtifact,
        lastUpdatedAt: new Date().toISOString(),
      }
    })
  }, [buildCompatDocumentArtifact, manuscriptProfile, setWorkbenchModeSession])

  const syncEditorImagesToWorkspace = useCallback(async (editorHtml: string) => {
    if (!activeWorkspacePath || !editorHtml.trim()) {
      return { html: editorHtml, changed: false }
    }

    const parser = new DOMParser()
    const doc = parser.parseFromString(`<div id="sync-root">${editorHtml}</div>`, 'text/html')
    const images = Array.from(doc.querySelectorAll('img'))
    let changed = false

    for (const image of images) {
      const src = String(image.getAttribute('src') || '').trim()
      if (!src) continue
      if (src.startsWith('data:')) continue

      if (/^file:/i.test(src) || /^https?:\/\//i.test(src) || src.startsWith('/')) {
        const normalizedSource = normalizeFileLikePath(src)
        if (normalizedSource.startsWith(activeWorkspacePath)) continue

        const cachedPath = imageWorkspaceMapRef.current[src]
        if (cachedPath) {
          image.setAttribute('src', toFileUrl(cachedPath))
          changed = true
          continue
        }

        const filename = normalizedSource.split(/[\\/]/).pop() || `image_${Date.now()}.png`
        const saved = await saveImageIncrementallyToWorkspace(activeWorkspacePath, normalizedSource, filename, undefined, getBackendUrl())
        if (!saved) continue
        imageWorkspaceMapRef.current[src] = saved.path
        image.setAttribute('src', toFileUrl(saved.path))
        changed = true
      }
    }

    return {
      html: doc.getElementById('sync-root')?.innerHTML || editorHtml,
      changed,
    }
  }, [activeWorkspacePath])

  const editor = useEditor({
      extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }), Placeholder.configure({ placeholder: '开始写作，或按 Ctrl+O 打开文件...' }), Underline, TextAlign.configure({ types: ['heading', 'paragraph'] }), Highlight, RichImage, Table.configure({ resizable: true }), TableRow, TableCell, TableHeader, Typography, TaskList, TaskItem.configure({ nested: true }), TextStyle, FontFamily.configure({ types: ['textStyle'] }), FontSize.configure({ types: ['textStyle'] }), Superscript, Subscript, InlineFormula, BlockFormula, PaperStyle, GhostText.configure({ enabled: ghostTextEnabled, debounceMs: 400, contextChars: 2000, language })],
    content: '',
    onUpdate: ({ editor }) => {
      if (!activeSurfaceRef.current) return
      if (skipUpdateRef.current) return
      const currentActiveTabId = activeTabIdRef.current
      const currentComposerTargetTabId = composerTargetTabIdRef.current || currentActiveTabId || mainTabIdRef.current
      if (
        paperStreamSessionRef.current.active
        && paperStreamSessionRef.current.tabId === currentActiveTabId
        && !paperStreamMutationRef.current
      ) {
        if (!paperStreamSessionRef.current.manualModified) {
          setStatusMessage('已检测到手动编辑，当前任务后续结果不会自动覆盖正文')
        }
        paperStreamSessionRef.current.manualModified = true
      }
      if (
        composerRunningRef.current
        && currentComposerTargetTabId
        && currentComposerTargetTabId === currentActiveTabId
        && !paperStreamMutationRef.current
        && !composerManualEditReportedRef.current.reported
      ) {
        composerManualEditReportedRef.current = { tabId: currentComposerTargetTabId, reported: true }
        setComposerManualEditTabId(currentComposerTargetTabId)
        setComposerManualEditNonce((value) => value + 1)
        setStatusMessage('已检测到手动编辑，当前任务后续结果不会自动覆盖正文')
      }
      const shouldSerializeAsMarkdown = mdBridgeEnabledRef.current && activeTabIsMarkdownRef.current
      if (shouldSerializeAsMarkdown) {
        try {
          setMarkdown(normalizeMarkdownFormulaOutput(serializeEditorToMarkdownWithBridge(editor)))
        } catch {
          setMarkdown(editor.getHTML())
        }
      } else {
        setMarkdown(editor.getHTML())
      }
      setDirty(true)
      setDocTextStats(computeEditorDocumentTextStats(editor))
      if (!isReadonlyDocPreviewMode) scheduleLayoutMetrics()
    },
  })

  useEffect(() => {
    if (!editor) return
    editor.setEditable(true)
  }, [editor])

  useEffect(() => {
    ;(window as any).__editorInstance = editor
    return () => {
      delete (window as any).__editorInstance
    }
  }, [editor])

  const resolveFormulaAnchor = useCallback((editPos: number | null = null, fallbackToSelection = true) => {
    if (!editor) {
      return { anchorX: 120, anchorY: 140 }
    }

    try {
      const selectionPos = typeof editPos === 'number'
        ? editPos
        : getTiptapSelectionEdgePosition(editor, fallbackToSelection ? 'from' : 'to')
      if (typeof selectionPos !== 'number') {
        throw new Error('Selection unavailable')
      }
      const coords = editor.view.coordsAtPos(selectionPos)
      return { anchorX: coords.left, anchorY: coords.bottom + 10 }
    } catch {
      const rect = editor.view.dom.getBoundingClientRect()
      return { anchorX: rect.left + 40, anchorY: rect.top + 48 }
    }
  }, [editor])

  const setEditorDocumentContent = useCallback((content: string | Record<string, any>) => {
    if (!editor) return
    editor.commands.setContent(content as any, false)
  }, [editor])

  const handleSaveCurrentAsDocx = useCallback(async (_request?: DocumentEngineSaveRequest): Promise<DocumentEngineSaveResult | null> => {
    const request = _request || {}
    const saveMode = request.mode || 'current'
    const safeBaseName = String(currentFileName || '未命名文档').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_') || '未命名文档'
    const rawEditorHtml = editor ? editor.getHTML() : markdown
    try {
      const { html: editorHtml, changed } = await syncEditorImagesToWorkspace(rawEditorHtml)
      if (changed && editor) {
        skipUpdateRef.current = true
        setEditorDocumentContent(editorHtml)
        setMarkdown(editorHtml)
        skipUpdateRef.current = false
      }
      const exportHtml = `<div data-paper-template="${resolvedPaperTemplateId}">${editorHtml}</div>`
      const exportPlainText = htmlToPlainText(editorHtml)

      /* ── auto-rename untitled documents from first heading ── */
      let effectiveFilePath = filePath
      if (saveMode !== 'save-as' && effectiveFilePath && activeWorkspacePath && editor) {
        const bareCurrentName = String(currentFileName || '').replace(/\.[^.]+$/, '').trim()
        if (/^未命名文档\s*\d*$/.test(bareCurrentName)) {
          try {
            const docJson = editor.getJSON()
            const firstHeading = (docJson.content || []).find((n: any) => n.type === 'heading')
            const titleText = (firstHeading?.content || []).map((c: any) => c.text || '').join('').trim()
            if (titleText.length >= 2) {
              const safeTitleName = titleText.slice(0, 60).replace(/[\\/:*?"<>|]/g, '_').trim() || bareCurrentName
              // Preserve original extension (may be .aidoc.json or .docx)
              const currentExt = effectiveFilePath.endsWith('.aidoc.json') ? '.aidoc.json' : `.${effectiveFilePath.split('.').pop() || 'aidoc.json'}`
              const newRelPath = `${safeTitleName}${currentExt}`
              const oldRelPath = effectiveFilePath.replace(activeWorkspacePath, '').replace(/^[\\/]/, '')
              if (newRelPath !== oldRelPath) {
                await window.electronAPI.renameWorkspacePath(activeWorkspacePath, oldRelPath, newRelPath)
                effectiveFilePath = `${activeWorkspacePath}/${newRelPath}`
                markTabShellSaved(activeTabId, { filePath: effectiveFilePath, fileName: newRelPath })
                void refreshTree().catch(() => undefined)
              }
            }
          } catch { /* rename failed — fall through with original path */ }
        }
      }

      if (saveMode !== 'save-as' && effectiveFilePath) {
        const serialized = serializeForFilePath(effectiveFilePath, exportHtml, editor)
        if (serialized.kind === 'docx') {
          const rewritten = await window.electronAPI.writeOoxmlPackage(effectiveFilePath, { html: serialized.content, plainText: exportPlainText })
          if (!rewritten.success) {
            await window.electronAPI.writeDocxFile(effectiveFilePath, serialized.content)
          }
        } else {
          await window.electronAPI.writeFile(effectiveFilePath, serialized.content)
        }
        syncSavedTargetPath(activeTabId, effectiveFilePath)
        markTabShellSaved(activeTabId, { filePath: effectiveFilePath, fileName: effectiveFilePath.split(/[\\/]/).pop() || currentFileName, content: editorHtml })
        if (effectiveFilePath.toLowerCase().endsWith('.docx')) {
          bumpPreviewRefreshVersion(activeTabId)
        }
        setStatusMessage(`已保存到当前文件: ${effectiveFilePath.split(/[\\/]/).pop()}`)
        // Activity log for daily report
        void import('../../../services/workActivityLog').then(({ getAmbientUserId }) => {
          const uid = getAmbientUserId()
          if (uid) {
            const fileName = effectiveFilePath.split(/[\\/]/).pop() ?? 'unknown'
            const fileType = fileName.endsWith('.docx') ? 'docx' : fileName.endsWith('.aidoc.json') ? 'aidoc' : 'doc'
            void (window as unknown as { electronAPI?: { activityLogUserAction?: (p: Record<string, unknown>) => Promise<unknown> } })
              .electronAPI?.activityLogUserAction?.({
                userId: uid, module: 'document', action: 'saveDocument',
                eventType: 'file_saved', targetTitle: fileName, targetType: fileType,
                details: { fileName, fileType, operation: 'save', sourceModule: 'editor' },
                summary: `保存了文稿 "${fileName}"`,
              })
          }
        })
        return { filePath: effectiveFilePath, fileName: effectiveFilePath.split(/[\\/]/).pop() || currentFileName, content: editorHtml }
      }
      if (saveMode !== 'save-as' && activeWorkspacePath) {
        const targetPath = getAutoSaveTargetPath(activeTabId, null, currentFileName) || `${activeWorkspacePath}/${safeBaseName}.aidoc.json`
        const serialized = serializeForFilePath(targetPath, exportHtml, editor)
        if (serialized.kind === 'docx') {
          const rewritten = await window.electronAPI.writeOoxmlPackage(targetPath, { html: serialized.content, plainText: exportPlainText })
          if (!rewritten.success) {
            await window.electronAPI.writeDocxFile(targetPath, serialized.content)
          }
        } else {
          await window.electronAPI.writeFile(targetPath, serialized.content)
        }
        syncSavedTargetPath(activeTabId, targetPath)
        markTabShellSaved(activeTabId, { filePath: targetPath, fileName: targetPath.split(/[\\/]/).pop() || `${safeBaseName}.aidoc.json`, content: editorHtml })
        if (targetPath.toLowerCase().endsWith('.docx')) {
          bumpPreviewRefreshVersion(activeTabId)
        }
        void refreshTree().catch(() => undefined)
        setStatusMessage(`已自动保存: ${targetPath.split(/[\\/]/).pop()}`)
        // Activity log for daily report
        void import('../../../services/workActivityLog').then(({ getAmbientUserId }) => {
          const uid = getAmbientUserId()
          if (uid) {
            const fileName = targetPath.split(/[\\/]/).pop() ?? 'unknown'
            const fileType = fileName.endsWith('.docx') ? 'docx' : fileName.endsWith('.aidoc.json') ? 'aidoc' : 'doc'
            void (window as unknown as { electronAPI?: { activityLogUserAction?: (p: Record<string, unknown>) => Promise<unknown> } })
              .electronAPI?.activityLogUserAction?.({
                userId: uid, module: 'document', action: 'saveDocument',
                eventType: 'file_saved', targetTitle: fileName, targetType: fileType,
                details: { fileName, fileType, operation: 'save', sourceModule: 'editor' },
                summary: `保存了文稿 "${fileName}"`,
              })
          }
        })
        return { filePath: targetPath, fileName: targetPath.split(/[\\/]/).pop() || `${safeBaseName}.aidoc.json`, content: editorHtml }
      }
      const chosenPath = await window.electronAPI.saveFileDialog(`${safeBaseName}.aidoc.json`)
      if (!chosenPath) return null
      const finalPath = chosenPath.toLowerCase().endsWith('.docx') ? chosenPath
        : chosenPath.toLowerCase().endsWith('.aidoc.json') ? chosenPath
        : `${chosenPath}.aidoc.json`
      const serialized = serializeForFilePath(finalPath, exportHtml, editor)
      if (serialized.kind === 'docx') {
        const rewritten = await window.electronAPI.writeOoxmlPackage(finalPath, { html: serialized.content, plainText: exportPlainText })
        if (!rewritten.success) {
          await window.electronAPI.writeDocxFile(finalPath, serialized.content)
        }
      } else {
        await window.electronAPI.writeFile(finalPath, serialized.content)
      }
      syncSavedTargetPath(activeTabId, finalPath)
      markTabShellSaved(activeTabId, { filePath: finalPath, fileName: finalPath.split(/[\\/]/).pop() || `${safeBaseName}.aidoc.json`, content: editorHtml })
      if (finalPath.toLowerCase().endsWith('.docx')) {
        bumpPreviewRefreshVersion(activeTabId)
      }
      setStatusMessage(`已保存到文件: ${finalPath.split(/[\\/]/).pop()}`)
      return { filePath: finalPath, fileName: finalPath.split(/[\\/]/).pop() || `${safeBaseName}.aidoc.json`, content: editorHtml }
    } catch (err: any) {
      setStatusMessage(`保存 DOCX 失败: ${err?.message || ''}`)
      return null
    }
  }, [activeTabId, activeWorkspacePath, bumpPreviewRefreshVersion, currentFileName, editor, filePath, getAutoSaveTargetPath, markTabShellSaved, markdown, refreshTree, resolvedPaperTemplateId, serializeForFilePath, setEditorDocumentContent, setMarkdown, setStatusMessage, syncEditorImagesToWorkspace, syncSavedTargetPath])

  useEffect(() => {
    return registerSaveHandler(async () => {
      const result = await handleSaveCurrentAsDocx()
      return result !== null
    })
  }, [registerSaveHandler, handleSaveCurrentAsDocx])

  const ensureKnowledgeDocumentImported = useCallback(async (options?: { announce?: boolean }) => {
    const targetPath = normalizeFileLikePath(activeTab?.filePath || '')
    if (!targetPath) {
      const message = '请先保存当前文稿，再存入知识库或生成 PPT。'
      setStatusMessage(message)
      return null
    }

    try {
      const result = await window.electronAPI.importKnowledgeDocumentFromPath(knowledge.departmentId, targetPath)
      const preferredDocument = result.imported[0] || result.duplicates[0] || null
      if (!preferredDocument?.id) {
        const failure = result.failed[0]
        const message = result.canceled
          ? '已取消导入知识库。'
          : failure
            ? `导入知识库失败：${failure.error}`
            : '导入知识库失败。'
        setStatusMessage(message)
        return null
      }

      await knowledge.refresh()

      if (options?.announce !== false) {
        const importedNow = result.imported.some((item) => item.id === preferredDocument.id)
        setStatusMessage(importedNow ? `已存入知识库：${preferredDocument.title}` : `知识库已存在该文稿：${preferredDocument.title}`)
      }

      return preferredDocument
    } catch (error) {
      const message = error instanceof Error ? `导入知识库失败：${error.message}` : '导入知识库失败。'
      setStatusMessage(message)
      return null
    }
  }, [activeTab?.filePath, knowledge, setStatusMessage])

  const handleSaveToKnowledge = useCallback(() => {
    void (async () => {
      if (previewDocumentActionBusy) return
      setPreviewDocumentActionBusy('knowledge')
      try {
        await ensureKnowledgeDocumentImported()
      } finally {
        setPreviewDocumentActionBusy(null)
      }
    })()
  }, [ensureKnowledgeDocumentImported, previewDocumentActionBusy])

  const handleOpenPptDialog = useCallback(() => {
    const promptTitle = activeTab?.fileName || currentFileName || '当前文稿'
    const defaultPrompt = workbench.sessions.ppt.generationPrompt.trim() || buildDefaultPptPrompt(promptTitle)
    setPptPromptDraft(defaultPrompt)
    setPptPromptDialogOpen(true)
  }, [activeTab?.fileName, currentFileName, workbench.sessions.ppt.generationPrompt])

  const handleToggleNoImageMode = useCallback(() => {
    const current = localStorage.getItem('ai_tool_gen_no_image_mode') === 'true'
    localStorage.setItem('ai_tool_gen_no_image_mode', String(!current))
    window.dispatchEvent(new Event('ai-settings-updated'))
  }, [])

  const handlePptPromptConfirm = useCallback(() => {
    setPptPromptDialogOpen(false)
    void (async () => {
      if (previewDocumentActionBusy) return
      setPreviewDocumentActionBusy('ppt')
      try {
        const now = new Date().toISOString()
        const promptTitle = activeTab?.fileName || currentFileName || '当前文稿'
        let previewText = htmlToPlainText(markdown)
        if (!previewText.trim() && activeTab?.filePath?.toLowerCase().endsWith('.docx')) {
          const snapshot = await window.electronAPI.readOoxmlPackage(activeTab.filePath).catch(() => null)
          previewText = String(snapshot?.plainText || '').trim()
        }
        let safeArtifact = compatDocumentArtifact
        if (!safeArtifact) {
          try { safeArtifact = buildCompatDocumentArtifact() } catch (e) { console.warn('[PPT-from-doc] buildCompatDocumentArtifact failed', e) }
        }
        const directSource = createPptPrimarySourceState({
          title: promptTitle,
          documentArtifact: safeArtifact,
          previewText,
          updatedAt: now,
        })
        if (!directSource) {
          console.warn('[PPT-from-doc] directSource is null', { compatDocumentArtifact: !!safeArtifact, previewText: previewText.slice(0, 80) })
          setStatusMessage('当前文稿暂无可用于生成 PPT 的正文内容。')
          return
        }

        const userPrompt = pptPromptDraft.trim() || buildDefaultPptPrompt(promptTitle)
        setWorkbenchModeSession('ppt', (session) => ({
          ...session,
          generationPrompt: userPrompt,
          generationStatus: {
            phase: 'idle',
            message: '已载入当前文稿，切换后将自动开始生成 PPT。',
            updatedAt: now,
          },
          pendingAutoSubmitToken: `${Date.now()}-ppt-direct-source`,
          pendingAutoSubmitTargetAssetId: null,
          pptPrimarySource: directSource,
          lastUpdatedAt: now,
        }))
        enterPptGenerationMode()
        setStatusMessage(`已切换到 PPT 模式，正在基于《${promptTitle}》准备生成。`)
      } catch (err) {
        console.error('[PPT-from-doc]', err)
        setStatusMessage(`生成 PPT 时出错：${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setPreviewDocumentActionBusy(null)
      }
    })()
  }, [activeTab?.fileName, activeTab?.filePath, buildCompatDocumentArtifact, compatDocumentArtifact, currentFileName, enterPptGenerationMode, markdown, pptPromptDraft, previewDocumentActionBusy, setStatusMessage, setWorkbenchModeSession])

  const handleTemplateChange = useCallback((templateId: PaperTemplateId) => {
    setPaperTemplateId(templateId)
    if (activeTabId) {
      setRenderStateByTabId((current) => {
        const previousState = current[activeTabId]
        const nextState: EditorDocumentRenderState = {
          ...previousState,
          paperTemplateId: templateId,
          bodyStyle: undefined,
          templateLocked: true,
        }
        if (isSameRenderState(previousState, nextState)) return current
        return { ...current, [activeTabId]: nextState }
      })
    }
    const template = getPaperTemplate(templateId)
    if (editor) {
      editor.chain().focus().setBlockStyle({
        textIndent: template.textIndent,
        lineHeight: template.lineHeight,
        marginTop: template.paragraphSpacing,
        marginBottom: template.paragraphSpacing,
      }, { all: true }).run()
    }
  }, [activeTabId, editor])

  const persistTemplate = useCallback(() => {
    templatePinnedRef.current = true
    localStorage.setItem('ai_writer_paper_template', paperTemplateId)
    setStatusMessage(`已将模板保存为默认: ${getPaperTemplate(paperTemplateId).label}`)
  }, [paperTemplateId, setStatusMessage])

  const openFormulaDialog = useCallback((displayMode: 'inline' | 'block', latex = '', editPos: number | null = null, anchor?: { anchorX: number; anchorY: number }) => {
    const nextAnchor = anchor || resolveFormulaAnchor(editPos)
    setFormulaDialog({ latex, naturalText: '', displayMode, editPos, converting: false, ...nextAnchor })
  }, [resolveFormulaAnchor])

  const legacyRuntime = React.useMemo(() => createLegacyTiptapRuntime({
    editor,
    loadDocument: async (request: DocumentEngineLoadRequest) => {
      const isAidoc = request.fileName.endsWith('.aidoc.json')
      // Store tiptapJson in the Map BEFORE openTab so the markdown→editor useEffect applies it reliably.
      // Key by canonicalDocumentId (preferred) or filePath so concurrent opens don't overwrite each other.
      if (request.tiptapJson) {
        const restoreKey = request.canonicalDocumentId ?? request.filePath ?? `anon:${Date.now()}`
        pendingTiptapRestoreRef.current.set(restoreKey, {
          tiptapJson: request.tiptapJson,
          paperTemplateId: request.paperTemplateId,
        })
      }
      await openTab(request.preserveOriginalOnSave ? null : request.filePath, request.fileName, request.tiptapJson ? '<p></p>' : request.content, {
        asManuscript: request.fileName.toLowerCase().endsWith('.docx') || isAidoc,
        sourceContext: request.sourceContext,
        canonicalDocumentId: request.canonicalDocumentId,
      })
      if (request.paperTemplateId) {
        handleTemplateChange(request.paperTemplateId as any)
      }
    },
    saveDocument: handleSaveCurrentAsDocx,
    setStatusMessage,
  }), [editor, handleSaveCurrentAsDocx, handleTemplateChange, openTab, setStatusMessage])

  const embeddedRuntime = React.useMemo(() => createEmbeddedOfficeRuntime({
    getSelection: () => readTiptapDocumentSelection(editor),
    setDocumentContent: (content) => {
      legacyRuntime.setDocumentContent(content)
    },
    insertTextAtSelection: (insertion: string) => {
      const selection = readTiptapDocumentSelection(editor)
      legacyRuntime.applyTextEdit({
        text: insertion,
        mode: selection ? 'append-after-range' : 'append-at-end',
        range: selection,
      })
    },
    applyTextEdit: (payload) => {
      legacyRuntime.applyTextEdit(payload)
    },
    insertCitationComment: (payload) => {
      legacyRuntime.insertComment(payload)
    },
    insertFormulaBlock: (payload) => {
      legacyRuntime.upsertFormula(payload)
    },
    insertImageBlock: (payload) => {
      legacyRuntime.insertAnchoredImage({
        src: payload.previewSrc || payload.src,
        alt: payload.altText || payload.alt,
        title: payload.title,
        placement: payload.placement,
        widthPx: payload.widthPx,
        heightPx: payload.heightPx,
      })
    },
    loadDocument: async (request: DocumentEngineLoadRequest) => {
      const isAidoc = request.fileName.endsWith('.aidoc.json')
      if (request.tiptapJson) {
        const restoreKey = request.canonicalDocumentId ?? request.filePath ?? `anon:${Date.now()}`
        pendingTiptapRestoreRef.current.set(restoreKey, {
          tiptapJson: request.tiptapJson,
          paperTemplateId: request.paperTemplateId,
        })
      }
      await openTab(request.preserveOriginalOnSave ? null : request.filePath, request.fileName, request.tiptapJson ? '<p></p>' : request.content, {
        asManuscript: request.fileName.toLowerCase().endsWith('.docx') || isAidoc,
        sourceContext: request.sourceContext,
        canonicalDocumentId: request.canonicalDocumentId,
      })
    },
    saveDocument: handleSaveCurrentAsDocx,
    setStatusMessage,
  }), [editor, handleSaveCurrentAsDocx, legacyRuntime, openTab, setStatusMessage])

  const runtimeForHost = preferredEngineId === 'embedded-office-engine' ? embeddedRuntime : legacyRuntime

  useBindDocumentEngineRuntime(active ? runtimeForHost : null)
  const { runtime: currentRuntimeContext } = useDocumentEngineRuntime()
  const currentRuntime = currentRuntimeContext ?? runtimeForHost

  const applyPendingImageInsertion = useCallback(async (payload: NonNullable<typeof workbench.sessions.image.pendingImageInsertion>) => {
    if (!editor || activeTabId !== payload.tabId) return false

    let resolvedPlacement = payload.placement
    if (payload.selection && payload.placement !== 'document-end') {
      const resolvedRange = resolveManuscriptSelectionAnchorToEditorRange(editor, compatDocumentArtifact, payload.selection)
      const from = resolvedRange?.from ?? payload.selection.from
      const to = resolvedRange?.to ?? payload.selection.to
      if (Number.isFinite(from) && Number.isFinite(to) && to >= from) {
        const collapsed = resolvedPlacement === 'cursor'
        editor.chain().focus().setTextSelection(collapsed ? { from: to, to } : { from, to }).run()
      } else {
        resolvedPlacement = 'document-end'
      }
    }

    try {
      await currentRuntime.insertAnchoredImage({
        src: payload.src,
        alt: payload.alt,
        title: payload.title,
        placement: resolvedPlacement,
        widthPx: payload.widthPx,
        heightPx: payload.heightPx,
      })
      setWorkbenchModeSession('image', (session) => {
        if (session.pendingImageInsertion?.requestId !== payload.requestId) return session
        return {
          ...session,
          pendingImageInsertion: null,
          lastUpdatedAt: new Date().toISOString(),
        }
      })
      if (payload.statusMessage) {
        setStatusMessage(payload.statusMessage)
      }
      return true
    } catch (error) {
      setStatusMessage(error instanceof Error ? `图片回写失败: ${error.message}` : '图片回写失败')
      return false
    }
  }, [activeTabId, compatDocumentArtifact, currentRuntime, editor, setStatusMessage, setWorkbenchModeSession, workbench.sessions.image.pendingImageInsertion])

  const emitManuscriptSelectionState = useCallback(() => {
    if (headless) return
    const selection = currentRuntime.getSelection()
    const text = String(selection?.text || '').trim()
    const hasSelection = Boolean(text)
    let anchorX: number | null = null
    let anchorY: number | null = null

    if (hasSelection && editor) {
      try {
        const coords = editor.view.coordsAtPos(selection?.to || 0)
        anchorX = coords.left + Math.max(0, Math.round((coords.right - coords.left) / 2))
        anchorY = coords.top
      } catch {
        const rect = editor.view.dom.getBoundingClientRect()
        anchorX = rect.left + Math.round(rect.width / 2)
        anchorY = rect.top + 72
      }
    }

    window.dispatchEvent(new CustomEvent('ai-writer-manuscript-selection-state', {
      detail: {
        hasSelection,
        text: hasSelection ? text : '',
        selectionRange: hasSelection && selection ? { from: selection.from, to: selection.to } : null,
        anchorX,
        anchorY,
      },
    }))
  }, [currentRuntime, editor, headless])

  const applyImageNodeAttributes = useCallback((pos: number, attrs: Record<string, unknown>) => {
    if (!editor) return false
    const commands = editor.commands as unknown as {
      setNodeSelection?: (pos: number) => boolean
      updateAttributes?: (typeOrName: string, attributes: Record<string, unknown>) => boolean
    }
    commands.setNodeSelection?.(pos)
    return commands.updateAttributes?.('image', attrs) ?? false
  }, [editor])

  const persistImageDataUrlToWorkspace = useCallback(async (fileName: string, dataUrl: string) => {
    if (!activeWorkspacePath) return dataUrl
    const base64Data = stripDataUrlPrefix(dataUrl)
    const structure = await window.electronAPI.detectProjectStructure(activeWorkspacePath)
    const saved = structure?.hasFigures
      ? await window.electronAPI.saveImageToFiguresBase64(activeWorkspacePath, fileName, base64Data)
      : await window.electronAPI.saveImageToWorkspace(activeWorkspacePath, fileName, base64Data)
    void refreshTree().catch(() => undefined)
    return toFileUrl(saved.path)
  }, [activeWorkspacePath, refreshTree])

  const persistImportedImageToWorkspace = useCallback(async (importedImage: { dataUrl: string; fileName: string }) => {
    if (!activeWorkspacePath) return importedImage.dataUrl
    return persistImageDataUrlToWorkspace(importedImage.fileName, importedImage.dataUrl)
  }, [activeWorkspacePath, persistImageDataUrlToWorkspace])

  const resolveImageOverlayByPos = useCallback((pos: number): ActiveImageOverlayState | null => {
    if (!editor) return null
    const domNode = editor.view.nodeDOM(pos)
    const host = domNode instanceof HTMLElement ? domNode : null
    const imageElement = (host?.matches('img') ? host : host?.querySelector('img')) as HTMLImageElement | null
    if (!imageElement) return null
    const rect = imageElement.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    const naturalWidth = imageElement.naturalWidth || rect.width
    const naturalHeight = imageElement.naturalHeight || rect.height
    return {
      pos,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      aspectRatio: naturalWidth > 0 && naturalHeight > 0 ? naturalWidth / naturalHeight : rect.width / rect.height,
    }
  }, [editor])

  const refreshActiveImageOverlay = useCallback((pos?: number | null) => {
    const targetPos = typeof pos === 'number' ? pos : activeImageOverlay?.pos
    if (typeof targetPos !== 'number') {
      setActiveImageOverlay(null)
      return
    }
    setActiveImageOverlay(resolveImageOverlayByPos(targetPos))
  }, [activeImageOverlay?.pos, resolveImageOverlayByPos])

  const resolveImageContextTarget = useCallback((target: EventTarget | null) => {
    if (!editor || !(target instanceof Element)) return null

    const imageElement = (target.closest('img') as HTMLImageElement | null)
    if (!imageElement) return null

    const candidatePositions: number[] = []
    try {
      candidatePositions.push(editor.view.posAtDOM(imageElement, 0))
    } catch {}

    const figureElement = imageElement.closest('figure')
    if (figureElement) {
      try {
        candidatePositions.push(editor.view.posAtDOM(figureElement, 0))
      } catch {}
    }

    for (const candidate of candidatePositions) {
      for (const pos of [candidate, candidate - 1, candidate + 1]) {
        if (pos < 0) continue
        const node = getTiptapNodeAt(editor, pos)
        if (!node || node.type.name !== 'image') continue
        return {
          pos,
          src: String(node.attrs.src || imageElement.getAttribute('src') || '').trim(),
          alt: String(node.attrs.alt || imageElement.getAttribute('alt') || '').trim(),
          title: String(node.attrs.title || imageElement.getAttribute('title') || '').trim() || undefined,
          caption: String(node.attrs.caption || '').trim() || undefined,
          width: Number(node.attrs.width || 0) || undefined,
          alignment: (String(node.attrs.alignment || 'center').trim() as ImageAlignment) || 'center',
        }
      }
    }

    return null
  }, [editor])

  const resolveSelectedImagePos = useCallback((): number | null => {
    if (!editor) return null
    const selection = getTiptapRawSelection(editor)
    if (!selection) return null

    if (selection instanceof NodeSelection && selection.node?.type?.name === 'image') {
      return selection.from
    }

    if (!selection.empty) return null

    for (const pos of [selection.from, selection.from - 1, selection.from + 1]) {
      if (pos < 0) continue
      const node = getTiptapNodeAt(editor, pos)
      if (node?.type?.name === 'image') return pos
    }

    return null
  }, [editor])

  useEffect(() => {
    if (!ctxMenu || ctxMenu.kind !== 'image') {
      setImageToolDraft(null)
      return
    }
    setImageToolDraft({
      pos: ctxMenu.image.pos,
      width: ctxMenu.image.width ? String(ctxMenu.image.width) : '',
      alignment: ctxMenu.image.alignment || 'center',
      title: ctxMenu.image.caption || ctxMenu.image.title || '',
    })
  }, [ctxMenu])

  useEffect(() => {
    if (!editor || headless) return

    const syncFromSelection = () => {
      const selectedImagePos = resolveSelectedImagePos()
      if (selectedImagePos == null) {
        if (!imageResizeState) setActiveImageOverlay(null)
        return
      }
      refreshActiveImageOverlay(selectedImagePos)
    }

    const handleClick = (event: MouseEvent) => {
      const imageTarget = resolveImageContextTarget(event.target)
      if (imageTarget) {
        const commands = editor.commands as unknown as { setNodeSelection?: (pos: number) => boolean }
        commands.setNodeSelection?.(imageTarget.pos)
        refreshActiveImageOverlay(imageTarget.pos)
        return
      }
      if (!imageResizeState) setActiveImageOverlay(null)
      emitManuscriptSelectionState()
    }

    editor.on('selectionUpdate', syncFromSelection)
    editor.view.dom.addEventListener('click', handleClick)
    syncFromSelection()
    return () => {
      editor.off('selectionUpdate', syncFromSelection)
      editor.view.dom.removeEventListener('click', handleClick)
      window.dispatchEvent(new CustomEvent('ai-writer-manuscript-selection-state', {
        detail: {
          hasSelection: false,
          text: '',
          selectionRange: null,
          anchorX: null,
          anchorY: null,
          selectionAnchor: null,
          documentId: null,
          sourceDocumentId: null,
          artifactId: null,
        },
      }))
    }
  }, [editor, emitManuscriptSelectionState, headless, imageResizeState, refreshActiveImageOverlay, resolveImageContextTarget, resolveSelectedImagePos])

  useEffect(() => {
    emitManuscriptSelectionState()
  }, [activeTabId, emitManuscriptSelectionState])

  useEffect(() => {
    if (!activeImageOverlay) return undefined
    const handleViewportChange = () => refreshActiveImageOverlay(activeImageOverlay.pos)
    const scrollEl = editorScrollRef.current
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)
    scrollEl?.addEventListener('scroll', handleViewportChange)
    return () => {
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
      scrollEl?.removeEventListener('scroll', handleViewportChange)
    }
  }, [activeImageOverlay, refreshActiveImageOverlay])

  const updateImageCtxState = useCallback((pos: number, updater: (current: ImageCtxMenuState['image']) => ImageCtxMenuState['image']) => {
    setCtxMenu((current) => {
      if (!current || current.kind !== 'image' || current.image.pos !== pos) return current
      return { ...current, image: updater(current.image) }
    })
  }, [])

  useEffect(() => {
    if (!imageResizeState) return undefined

    const handlePointerMove = (event: PointerEvent) => {
      const deltaX = event.clientX - imageResizeState.startClientX
      const deltaY = event.clientY - imageResizeState.startClientY
      const { width: nextWidth, height: nextHeight } = computeImageResizeDimensions(imageResizeState, deltaX, deltaY, event.shiftKey)
      const applied = applyImageNodeAttributes(imageResizeState.pos, { width: nextWidth, height: nextHeight })
      if (!applied) return
      setImageToolDraft((current) => current && current.pos === imageResizeState.pos ? { ...current, width: String(nextWidth) } : current)
      updateImageCtxState(imageResizeState.pos, (current) => ({ ...current, width: nextWidth }))
      refreshActiveImageOverlay(imageResizeState.pos)
    }

    const handlePointerUp = () => {
      setImageResizeState(null)
      setStatusMessage('已更新图片尺寸')
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [applyImageNodeAttributes, imageResizeState, refreshActiveImageOverlay, setStatusMessage, updateImageCtxState])

  const applyImageWidth = useCallback((pos: number, rawWidth: string) => {
    const numericWidth = Math.max(40, Number(rawWidth) || 0) || null
    const nextWidth = numericWidth || null
    const applied = applyImageNodeAttributes(pos, { width: nextWidth, height: null })
    if (!applied) {
      setStatusMessage('图片宽度更新失败')
      return
    }
    updateImageCtxState(pos, (current) => ({ ...current, width: nextWidth || undefined }))
    refreshActiveImageOverlay(pos)
    setStatusMessage(nextWidth ? `已将图片宽度设为 ${nextWidth}px` : '已恢复图片自适应宽度')
  }, [applyImageNodeAttributes, refreshActiveImageOverlay, setStatusMessage, updateImageCtxState])

  const applyImageAlignment = useCallback((pos: number, alignment: ImageAlignment) => {
    const applied = applyImageNodeAttributes(pos, { alignment })
    if (!applied) {
      setStatusMessage('图片对齐更新失败')
      return
    }
    setImageToolDraft((current) => current && current.pos === pos ? { ...current, alignment } : current)
    updateImageCtxState(pos, (current) => ({ ...current, alignment }))
    refreshActiveImageOverlay(pos)
    setStatusMessage(`已将图片设为${alignment === 'left' ? '左对齐' : alignment === 'right' ? '右对齐' : '居中'}`)
  }, [applyImageNodeAttributes, refreshActiveImageOverlay, setStatusMessage, updateImageCtxState])

  const applyImageTitle = useCallback((pos: number, rawTitle: string) => {
    const title = rawTitle.trim()
    const applied = applyImageNodeAttributes(pos, { title: title || null, caption: title || null })
    if (!applied) {
      setStatusMessage('图片标题更新失败')
      return
    }
    updateImageCtxState(pos, (current) => ({ ...current, title: title || undefined, caption: title || undefined }))
    setStatusMessage(title ? '已更新图片标题' : '已清空图片标题')
  }, [applyImageNodeAttributes, setStatusMessage, updateImageCtxState])

  const replaceImageNodeSource = useCallback(async (pos: number, payload: { src: string; alt?: string; title?: string }) => {
    const applied = applyImageNodeAttributes(pos, {
      src: payload.src,
      alt: payload.alt || undefined,
      title: payload.title || undefined,
    })
    if (!applied) throw new Error('图片节点更新失败')
    updateImageCtxState(pos, (current) => ({
      ...current,
      src: payload.src,
      alt: payload.alt || current.alt,
      title: payload.title || current.title,
      caption: current.caption,
    }))
    refreshActiveImageOverlay(pos)
  }, [applyImageNodeAttributes, refreshActiveImageOverlay, updateImageCtxState])

  const replaceImageFromLocalFile = useCallback(async (pos: number) => {
    const importedImage = await window.electronAPI.importImageFile()
    if (!importedImage) return
    try {
      const src = await persistImportedImageToWorkspace(importedImage)
      const fallbackTitle = importedImage.fileName.replace(/\.[^.]+$/, '')
      const title = imageToolDraft?.pos === pos ? imageToolDraft.title.trim() : ''
      await replaceImageNodeSource(pos, { src, alt: fallbackTitle, title: title || fallbackTitle })
      setStatusMessage(`已替换图片: ${importedImage.fileName}`)
    } catch (error) {
      setStatusMessage(`替换图片失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [imageToolDraft, persistImportedImageToWorkspace, replaceImageNodeSource, setStatusMessage])

  const openStitchDialog = useCallback((pos: number) => {
    const baseName = imageToolDraft?.pos === pos && imageToolDraft.title.trim()
      ? sanitizeImageFileName(imageToolDraft.title)
      : `collage_${Date.now()}`
    setStitchDialog({
      imagePos: pos,
      folderPath: '',
      images: [],
      layout: 'grid',
      columns: 2,
      gap: 12,
      background: '#ffffff',
      fileName: `${baseName}.png`,
      previewUrl: '',
      building: false,
      saving: false,
    })
  }, [imageToolDraft])

  const openCropDialog = useCallback((pos: number) => {
    setCtxMenu((current) => {
      if (!current || current.kind !== 'image') return current
      const { src } = current.image
      const baseName = `crop_${Date.now()}`
      setCropDialog({
        imagePos: pos,
        src,
        fileName: `${baseName}.png`,
        cropX: 10,
        cropY: 10,
        cropW: 80,
        cropH: 80,
        naturalWidth: 0,
        naturalHeight: 0,
        saving: false,
      })
      return null
    })
  }, [])

  const beginCropDrag = useCallback((handle: CropDragHandle, e: React.PointerEvent) => {
    if (!cropDialog) return
    e.preventDefault()
    e.stopPropagation()
    setCropDragState({
      handle,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startCropX: cropDialog.cropX,
      startCropY: cropDialog.cropY,
      startCropW: cropDialog.cropW,
      startCropH: cropDialog.cropH,
    })
  }, [cropDialog])

  const beginCropWrapperDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!cropContainerRef.current) return
    // Only start a new crop if clicking outside the existing selection
    e.preventDefault()
    const rect = cropContainerRef.current.getBoundingClientRect()
    const startX = (e.clientX - rect.left) / rect.width * 100
    const startY = (e.clientY - rect.top) / rect.height * 100
    setCropDragState({
      handle: 'create',
      startClientX: e.clientX,
      startClientY: e.clientY,
      startCropX: startX,
      startCropY: startY,
      startCropW: 0,
      startCropH: 0,
    })
    setCropDialog((current) => current ? { ...current, cropX: startX, cropY: startY, cropW: 0, cropH: 0 } : null)
  }, [])

  const handleCropImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    setCropDialog((current) => current ? { ...current, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight } : null)
  }, [])

  const applyCropToImage = useCallback(async () => {
    if (!cropDialog) return
    try {
      setCropDialog((current) => current ? { ...current, saving: true } : null)
      const nw = cropDialog.naturalWidth
      const nh = cropDialog.naturalHeight
      if (!nw || !nh) throw new Error('图片尚未加载完成，请稍候再试')
      const sx = Math.round(cropDialog.cropX / 100 * nw)
      const sy = Math.round(cropDialog.cropY / 100 * nh)
      const sw = Math.max(1, Math.round(cropDialog.cropW / 100 * nw))
      const sh = Math.max(1, Math.round(cropDialog.cropH / 100 * nh))
      const altTitle = cropDialog.fileName.replace(/\.[^.]+$/, '')

      let src: string

      // Primary path: main-process nativeImage crop (no canvas, no CORS issues).
      const canUseNativeCrop = typeof window.electronAPI.cropImageFile === 'function'
        && (cropDialog.src.startsWith('file://') || cropDialog.src.startsWith('data:'))

      if (canUseNativeCrop && activeWorkspacePath) {
        const result = await window.electronAPI.cropImageFile(
          activeWorkspacePath, cropDialog.src, sx, sy, sw, sh, cropDialog.fileName,
        )
        // Use the data URL returned by the handler for immediate display (avoids
        // file:// cross-origin issues when the renderer is served from localhost in dev).
        src = result.dataUrl || toFileUrl(result.path)
      } else if (cropDialog.src.startsWith('http://') || cropDialog.src.startsWith('https://')) {
        // Remote URL: CORS canvas
        const imgEl = new Image()
        imgEl.crossOrigin = 'anonymous'
        await new Promise<void>((res, rej) => {
          imgEl.onload = res
          imgEl.onerror = () => rej(new Error('图片加载失败，网络图片可能存在跨域限制'))
          imgEl.src = cropDialog.src
        })
        const cv = document.createElement('canvas')
        cv.width = sw; cv.height = sh
        cv.getContext('2d')!.drawImage(imgEl, sx, sy, sw, sh, 0, 0, sw, sh)
        src = await persistImageDataUrlToWorkspace(cropDialog.fileName, cv.toDataURL('image/png'))
      } else {
        // Fallback: read file via IPC to get a same-origin data URL, draw on canvas.
        // Works without restart because it uses the already-existing readImageAsDataUrl IPC.
        const imageData = await window.electronAPI.readImageAsDataUrl(cropDialog.src)
        if (!imageData?.dataUrl?.startsWith('data:')) {
          throw new Error(`图片读取失败，无法获取有效数据 (src=${cropDialog.src})`)
        }
        const img = new Image()
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve()
          img.onerror = () => reject(new Error('图片解码失败'))
          img.src = imageData.dataUrl
        })
        const canvas = document.createElement('canvas')
        canvas.width = sw
        canvas.height = sh
        canvas.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
        const dataUrl = canvas.toDataURL('image/png')
        if (dataUrl === 'data:,' || dataUrl.length < 100) {
          throw new Error('Canvas 裁剪失败，请重启应用后重试（canvas 安全限制）')
        }
        src = await persistImageDataUrlToWorkspace(cropDialog.fileName, dataUrl)
      }

      await replaceImageNodeSource(cropDialog.imagePos, { src, alt: altTitle, title: altTitle })
      setCropDialog(null)
      setStatusMessage(`已裁剪图片: ${sw}×${sh}px`)
    } catch (error) {
      setCropDialog((current) => current ? { ...current, saving: false } : null)
      setStatusMessage(`裁剪失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [cropDialog, activeWorkspacePath, persistImageDataUrlToWorkspace, replaceImageNodeSource, setStatusMessage])

  useEffect(() => {
    if (!cropDragState) return undefined
    const minSize = 3

    const handlePointerMove = (event: PointerEvent) => {
      if (!cropContainerRef.current) return
      const rect = cropContainerRef.current.getBoundingClientRect()
      const dx = (event.clientX - cropDragState.startClientX) / rect.width * 100
      const dy = (event.clientY - cropDragState.startClientY) / rect.height * 100
      const { startCropX, startCropY, startCropW, startCropH } = cropDragState
      let nx = startCropX, ny = startCropY, nw = startCropW, nh = startCropH

      switch (cropDragState.handle) {
        case 'move':
          nx = Math.max(0, Math.min(100 - nw, startCropX + dx))
          ny = Math.max(0, Math.min(100 - nh, startCropY + dy))
          break
        case 'nw':
          nx = Math.max(0, Math.min(startCropX + startCropW - minSize, startCropX + dx))
          ny = Math.max(0, Math.min(startCropY + startCropH - minSize, startCropY + dy))
          nw = startCropX + startCropW - nx
          nh = startCropY + startCropH - ny
          break
        case 'ne':
          ny = Math.max(0, Math.min(startCropY + startCropH - minSize, startCropY + dy))
          nw = Math.max(minSize, Math.min(100 - startCropX, startCropW + dx))
          nh = startCropY + startCropH - ny
          break
        case 'sw':
          nx = Math.max(0, Math.min(startCropX + startCropW - minSize, startCropX + dx))
          nw = startCropX + startCropW - nx
          nh = Math.max(minSize, Math.min(100 - startCropY, startCropH + dy))
          break
        case 'se':
          nw = Math.max(minSize, Math.min(100 - startCropX, startCropW + dx))
          nh = Math.max(minSize, Math.min(100 - startCropY, startCropH + dy))
          break
        case 'n':
          ny = Math.max(0, Math.min(startCropY + startCropH - minSize, startCropY + dy))
          nh = startCropY + startCropH - ny
          break
        case 's':
          nh = Math.max(minSize, Math.min(100 - startCropY, startCropH + dy))
          break
        case 'w':
          nx = Math.max(0, Math.min(startCropX + startCropW - minSize, startCropX + dx))
          nw = startCropX + startCropW - nx
          break
        case 'e':
          nw = Math.max(minSize, Math.min(100 - startCropX, startCropW + dx))
          break
        case 'create': {
          nx = dx >= 0 ? startCropX : Math.max(0, startCropX + dx)
          ny = dy >= 0 ? startCropY : Math.max(0, startCropY + dy)
          nw = Math.max(minSize, Math.min(100 - nx, Math.abs(dx)))
          nh = Math.max(minSize, Math.min(100 - ny, Math.abs(dy)))
          break
        }
      }
      setCropDialog((current) => current ? { ...current, cropX: nx, cropY: ny, cropW: nw, cropH: nh } : null)
    }

    const handlePointerUp = () => setCropDragState(null)

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [cropDragState])

  const beginImageResize = useCallback((handle: ImageResizeHandlePosition, event: React.PointerEvent<HTMLButtonElement>) => {
    if (!activeImageOverlay) return
    event.preventDefault()
    event.stopPropagation()
    setImageResizeState({
      pos: activeImageOverlay.pos,
      handle,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWidth: activeImageOverlay.width,
      startHeight: activeImageOverlay.height,
      aspectRatio: activeImageOverlay.aspectRatio || (activeImageOverlay.width / activeImageOverlay.height),
    })
  }, [activeImageOverlay])

  const pickStitchFolder = useCallback(async () => {
    const dirPath = await window.electronAPI.openDirectoryDialog()
    if (!dirPath) return
    const images = await window.electronAPI.listDirectoryImages(dirPath)
    setStitchDialog((current) => current ? {
      ...current,
      folderPath: dirPath,
      images: images.map((item) => ({
        name: item.name,
        filePath: item.filePath,
        previewUrl: toFileUrl(item.filePath),
        selected: true,
      })),
      previewUrl: '',
      fileName: `${sanitizeImageFileName(dirPath.split(/[\\/]/).pop() || 'collage')}_${Date.now()}.png`,
    } : current)
  }, [])

  const toggleStitchImage = useCallback((filePath: string) => {
    setStitchDialog((current) => current ? {
      ...current,
      images: current.images.map((item) => item.filePath === filePath ? { ...item, selected: !item.selected } : item),
    } : current)
  }, [])

  const moveStitchImage = useCallback((filePath: string, direction: -1 | 1) => {
    setStitchDialog((current) => {
      if (!current) return current
      const index = current.images.findIndex((item) => item.filePath === filePath)
      const targetIndex = index + direction
      if (index < 0 || targetIndex < 0 || targetIndex >= current.images.length) return current
      const nextImages = [...current.images]
      const [active] = nextImages.splice(index, 1)
      nextImages.splice(targetIndex, 0, active)
      return { ...current, images: nextImages }
    })
  }, [])

  const buildStitchPreview = useCallback(async () => {
    if (!stitchDialog) return
    const selectedImages = stitchDialog.images.filter((item) => item.selected)
    if (selectedImages.length === 0) {
      setStatusMessage('请先选择至少一张图片再拼接')
      return
    }
    setStitchDialog((current) => current ? { ...current, building: true } : current)
    try {
      const loaded = await Promise.all(selectedImages.map(async (item) => {
        const image = await loadBrowserImage(item.previewUrl)
        const fitted = fitImageSize(image.naturalWidth || image.width, image.naturalHeight || image.height)
        return { ...item, image, width: fitted.width, height: fitted.height }
      }))
      const gap = Math.max(0, stitchDialog.gap)
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('当前环境无法创建图片画布')

      if (stitchDialog.layout === 'vertical') {
        canvas.width = Math.max(...loaded.map((item) => item.width))
        canvas.height = loaded.reduce((sum, item, index) => sum + item.height + (index > 0 ? gap : 0), 0)
        let offsetY = 0
        ctx.fillStyle = stitchDialog.background
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        for (const item of loaded) {
          const offsetX = Math.round((canvas.width - item.width) / 2)
          ctx.drawImage(item.image, offsetX, offsetY, item.width, item.height)
          offsetY += item.height + gap
        }
      } else if (stitchDialog.layout === 'horizontal') {
        canvas.width = loaded.reduce((sum, item, index) => sum + item.width + (index > 0 ? gap : 0), 0)
        canvas.height = Math.max(...loaded.map((item) => item.height))
        let offsetX = 0
        ctx.fillStyle = stitchDialog.background
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        for (const item of loaded) {
          const offsetY = Math.round((canvas.height - item.height) / 2)
          ctx.drawImage(item.image, offsetX, offsetY, item.width, item.height)
          offsetX += item.width + gap
        }
      } else {
        const columns = Math.max(1, stitchDialog.columns)
        const rows = Math.ceil(loaded.length / columns)
        const cellWidth = Math.max(...loaded.map((item) => item.width))
        const cellHeight = Math.max(...loaded.map((item) => item.height))
        canvas.width = columns * cellWidth + Math.max(0, columns - 1) * gap
        canvas.height = rows * cellHeight + Math.max(0, rows - 1) * gap
        ctx.fillStyle = stitchDialog.background
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        loaded.forEach((item, index) => {
          const row = Math.floor(index / columns)
          const column = index % columns
          const baseX = column * (cellWidth + gap)
          const baseY = row * (cellHeight + gap)
          const offsetX = baseX + Math.round((cellWidth - item.width) / 2)
          const offsetY = baseY + Math.round((cellHeight - item.height) / 2)
          ctx.drawImage(item.image, offsetX, offsetY, item.width, item.height)
        })
      }

      const previewUrl = canvas.toDataURL('image/png')
      setStitchDialog((current) => current ? { ...current, previewUrl } : current)
      setStatusMessage(`拼接完成，共合成 ${selectedImages.length} 张图片`)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setStitchDialog((current) => current ? { ...current, building: false } : current)
    }
  }, [setStatusMessage, stitchDialog])

  const applyStitchReplacement = useCallback(async () => {
    if (!stitchDialog?.previewUrl) {
      setStatusMessage('请先生成拼接预览')
      return
    }
    setStitchDialog((current) => current ? { ...current, saving: true } : current)
    try {
      const title = imageToolDraft?.pos === stitchDialog.imagePos ? imageToolDraft.title.trim() : ''
      const src = await persistImageDataUrlToWorkspace(stitchDialog.fileName.trim() || `collage_${Date.now()}.png`, stitchDialog.previewUrl)
      await replaceImageNodeSource(stitchDialog.imagePos, { src, alt: title || 'collage', title: title || undefined })
      setStatusMessage('已用拼接图替换当前图片')
      setStitchDialog(null)
    } catch (error) {
      setStatusMessage(`拼接图替换失败: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setStitchDialog((current) => current ? { ...current, saving: false } : current)
    }
  }, [imageToolDraft, persistImageDataUrlToWorkspace, replaceImageNodeSource, setStatusMessage, stitchDialog])

  const getCurrentSelection = useCallback((): ComposerSelectionState | null => {
    const selection = currentRuntime.getSelection()
    if (!selection) return null
    const text = String(selection.text || '').trim()
    return text ? { text, from: selection.from, to: selection.to, anchorId: selection.anchorId } : null
  }, [currentRuntime])

  const buildSelectionStructureContext = useCallback((selection: ComposerSelectionState | null): StructuredRemakeContext | null => {
    if (!selection?.text.trim()) return null
    return resolveStructuredRemakeContextFromArticle({
      selectedText: selection.text,
      fullText: htmlToPlainText(markdown),
      articleSections,
      articleType,
    })
  }, [articleSections, articleType, markdown])

  const resolveDocumentComposerTargetTabId = useCallback(async (preferredTabId?: string | null) => {
    const ensuredTarget = await ensureWritableManuscriptTarget({
      actionLabel: '开始全文生成',
      preferredTabId,
      skipSourceSavePrompt: true,
    })
    return ensuredTarget?.id || ''
  }, [ensureWritableManuscriptTarget])

  const openComposerWithFlow = useCallback(({
    mode,
    autoTopic = '',
    autoRun = false,
    flow = 'auto',
    selection: providedSelection,
  }: {
    mode: ComposerMode
    autoTopic?: string
    autoRun?: boolean
    flow?: 'auto' | 'paper-generation' | 'assistant' | 'rewrite'
    selection?: ComposerSelectionState | null
  }) => {
    const selection = providedSelection === undefined ? getCurrentSelection() : providedSelection
    void (async () => {
      const targetTabId = await resolveDocumentComposerTargetTabId()
      if (!targetTabId) return

      setComposerInitialMode(mode)
      setComposerDocumentFlow(flow)
      setComposerSelection(selection)
      setComposerSelectionStructureContext(null)
      setComposerTopic(autoTopic)
      setComposerTargetTabId(targetTabId)
      setComposerAutoRunOnOpen(autoRun)
      setComposerAutoStartNonce((value) => value + 1)
      setComposerOpen(true)
    })()
  }, [getCurrentSelection, resolveDocumentComposerTargetTabId])

  const openComposer = useCallback((mode: ComposerMode, autoTopic = '', autoRun = false) => {
    openComposerWithFlow({ mode, autoTopic, autoRun })
  }, [openComposerWithFlow])

  const resolveCurrentSelectionActionContext = useCallback(() => {
    const selection = currentRuntime.getSelection()
    const text = String(selection?.text || '').trim()
    if (!selection || !text) {
      setStatusMessage('请先在编辑器中选中内容')
      return null
    }

    let posX = 200
    let posY = 200
    if (editor) {
      try {
        const coords = editor.view.coordsAtPos(selection.to)
        posX = coords.left
        posY = coords.bottom + 8
      } catch {
        const rect = editor.view.dom.getBoundingClientRect()
        posX = rect.left + 40
        posY = rect.top + 48
      }
    }

    return {
      text,
      from: selection.from,
      to: selection.to,
      posX,
      posY,
      anchorId: selection.anchorId,
    }
  }, [currentRuntime, editor, setStatusMessage])

  const resolveCommandSelectionActionContext = useCallback((command: RoutedManuscriptCommand) => {
    const payloadAnchor = command.payload.selectionAnchor
    const payloadRange = command.payload.selectionRange
    const payloadText = String(command.payload.selectionText || '').trim()

    if (payloadAnchor && editor) {
      const resolvedAnchorRange = resolveManuscriptSelectionAnchorToEditorRange(editor, compatDocumentArtifact, payloadAnchor)
      if (resolvedAnchorRange) {
        let posX = 200
        let posY = 200
        try {
          const coords = editor.view.coordsAtPos(resolvedAnchorRange.to)
          posX = coords.left
          posY = coords.bottom + 8
        } catch {
          const rect = editor.view.dom.getBoundingClientRect()
          posX = rect.left + 40
          posY = rect.top + 48
        }

        return {
          text: payloadText || resolvedAnchorRange.text,
          from: resolvedAnchorRange.from,
          to: resolvedAnchorRange.to,
          posX,
          posY,
          anchorId: resolvedAnchorRange.anchorId,
        }
      }
    }

    if (payloadRange && Number.isFinite(payloadRange.from) && Number.isFinite(payloadRange.to) && payloadText) {
      let posX = 200
      let posY = 200
      if (editor) {
        try {
          const coords = editor.view.coordsAtPos(payloadRange.to)
          posX = coords.left
          posY = coords.bottom + 8
        } catch {
          const rect = editor.view.dom.getBoundingClientRect()
          posX = rect.left + 40
          posY = rect.top + 48
        }
      }

      return {
        text: payloadText,
        from: payloadRange.from,
        to: payloadRange.to,
        posX,
        posY,
        anchorId: typeof payloadAnchor === 'object' && payloadAnchor && typeof (payloadAnchor as Record<string, unknown>).anchorId === 'string'
          ? String((payloadAnchor as Record<string, unknown>).anchorId)
          : undefined,
      }
    }

    if (payloadText && editor) {
      const fallbackRange = findSelectionRangeInEditor(editor, payloadText)
      if (fallbackRange) {
        let posX = 200
        let posY = 200
        try {
          const coords = editor.view.coordsAtPos(fallbackRange.to)
          posX = coords.left
          posY = coords.bottom + 8
        } catch {
          const rect = editor.view.dom.getBoundingClientRect()
          posX = rect.left + 40
          posY = rect.top + 48
        }

        return {
          text: payloadText,
          from: fallbackRange.from,
          to: fallbackRange.to,
          posX,
          posY,
          anchorId: typeof payloadAnchor === 'object' && payloadAnchor && typeof (payloadAnchor as Record<string, unknown>).anchorId === 'string'
            ? String((payloadAnchor as Record<string, unknown>).anchorId)
            : undefined,
        }
      }
    }

    return resolveCurrentSelectionActionContext()
  }, [compatDocumentArtifact, editor, resolveCurrentSelectionActionContext])

  useEffect(() => {
    const handleTriggerRewrite = (event: Event) => {
      const detail = (event as CustomEvent<any>).detail || {}
      const instruction = String(detail.instruction || '').trim()
      if (!instruction) return

      void (async () => {
        const targetTabId = await resolveDocumentComposerTargetTabId(String(detail.targetTabId || '').trim() || null)
        if (!targetTabId) return

        setComposerInitialMode('document')
        setComposerDocumentFlow('rewrite')
        setComposerSelection(null)
        setComposerSelectionStructureContext(null)
        setComposerTopic(instruction)
        setComposerTargetTabId(targetTabId)
        setComposerAutoRunOnOpen(Boolean(detail.autoRun ?? true))
        setComposerAutoStartNonce((value) => value + 1)
        setComposerOpen(true)
      })()
    }

    window.addEventListener('ai-writer-trigger-rewrite', handleTriggerRewrite as EventListener)
    return () => window.removeEventListener('ai-writer-trigger-rewrite', handleTriggerRewrite as EventListener)
  }, [resolveDocumentComposerTargetTabId])

  useEffect(() => {
    const handleGenerateDailyReport = (event: Event) => {
      if (manuscriptProfile !== 'paper') return
      const detail = (event as CustomEvent<Record<string, unknown>>).detail || {}
      const topic = String(detail.topic || '').trim()
      if (!topic) return
      setComposerInitialMode('document')
      setComposerDocumentFlow('paper-generation')
      setComposerTopic(topic)
      setComposerAutoRunOnOpen(true)
      setComposerSilentMode(true)
      setComposerAutoStartNonce((value) => value + 1)
      setComposerOpen(true)
    }

    window.addEventListener('ai-writer-generate-daily-report', handleGenerateDailyReport as EventListener)
    return () => window.removeEventListener('ai-writer-generate-daily-report', handleGenerateDailyReport as EventListener)
  }, [])

  const applyFormula = useCallback(() => {
    if (!formulaDialog) return
    const latex = formulaDialog.latex.trim()
    if (!latex) {
      setFormulaDialog(null)
      return
    }

    try {
      katex.renderToString(latex, { throwOnError: true, displayMode: formulaDialog.displayMode === 'block' })
      currentRuntime.upsertFormula({ latex, displayMode: formulaDialog.displayMode, editPos: formulaDialog.editPos })
      setStatusMessage(formulaDialog.editPos !== null ? '公式已更新' : '公式已插入')
    } catch (error) {
      setStatusMessage(`公式语法校验失败: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    formulaAiAbortRef.current?.abort()
    formulaAiAbortRef.current = null
    setFormulaDialog(null)
  }, [currentRuntime, formulaDialog, setStatusMessage])

  const handleUseFormulaTemplate = useCallback((templateLatex: string) => {
    setFormulaDialog((prev) => {
      if (!prev) return prev
      const current = prev.latex.trim()
      return { ...prev, latex: current ? `${current}\n${templateLatex}` : templateLatex }
    })
  }, [])

  const handleGenerateFormulaLatex = useCallback(async () => {
    if (!formulaDialog) return
    const naturalText = String(formulaDialog.naturalText || '').trim()
    if (!naturalText) {
      setStatusMessage('请先输入公式的自然语言描述')
      return
    }

    formulaAiAbortRef.current?.abort()
    const controller = new AbortController()
    formulaAiAbortRef.current = controller
    setFormulaDialog((prev) => prev ? { ...prev, converting: true } : prev)

    try {
      let generated = ''
      await runWritingAssistant(
        {
          instruction: `将下面的数学描述转换为标准 LaTeX 表达式。只输出 LaTeX 本体，不要解释，不要 markdown 代码块，不要美元符包裹。\n\n${naturalText}`,
          language,
        },
        {
          onStatus: () => undefined,
          onDelta: (_delta, accumulated) => {
            generated = accumulated
          },
          onComplete: ({ text }) => {
            generated = text
          },
          onError: (error) => {
            throw new Error(error)
          },
        },
        controller.signal,
      )

      const cleaned = sanitizeGeneratedLatex(generated)
      if (!cleaned) {
        setStatusMessage('未生成有效 LaTeX，请尝试换一种描述')
        return
      }
      setFormulaDialog((prev) => prev ? { ...prev, latex: cleaned } : prev)
      setStatusMessage('已生成 LaTeX，请确认后插入')
    } catch (error) {
      if (controller.signal.aborted) {
        setStatusMessage('已取消公式生成')
      } else {
        setStatusMessage(`生成公式失败: ${error instanceof Error ? error.message : String(error)}`)
      }
    } finally {
      if (formulaAiAbortRef.current === controller) {
        formulaAiAbortRef.current = null
      }
      setFormulaDialog((prev) => prev ? { ...prev, converting: false } : prev)
    }
  }, [formulaDialog, language, setStatusMessage])

  const formulaPreviewState = useMemo(() => {
    if (!formulaDialog) return { html: '', error: '' }
    const source = String(formulaDialog.latex || '').trim()
    if (!source) return { html: '', error: '' }
    let error = ''
    try {
      katex.renderToString(source, {
        throwOnError: true,
        displayMode: formulaDialog.displayMode === 'block',
      })
    } catch (previewError) {
      error = previewError instanceof Error ? previewError.message : String(previewError)
    }
    const html = katex.renderToString(source, {
      throwOnError: false,
      displayMode: formulaDialog.displayMode === 'block',
    })
    return { html, error }
  }, [formulaDialog])

  const schedulePaperStreamMutationClear = useCallback(() => {
    if (paperStreamMutationClearTimerRef.current) {
      clearTimeout(paperStreamMutationClearTimerRef.current)
    }
    paperStreamMutationClearTimerRef.current = setTimeout(() => {
      paperStreamMutationRef.current = false
      skipUpdateRef.current = false
      paperStreamMutationClearTimerRef.current = null
    }, 0)
  }, [])

  const runPaperStreamProgrammaticMutation = useCallback((operation: () => void) => {
    paperStreamMutationRef.current = true
    skipUpdateRef.current = true
    try {
      operation()
    } finally {
      schedulePaperStreamMutationClear()
    }
  }, [schedulePaperStreamMutationClear])

  const writePaperStreamHtmlToActiveEditor = useCallback((html: string) => {
    if (!editor) return false
    const normalizedHtml = String(html || '').trim() || '<p></p>'
    try {
      paperStreamMutationRef.current = true
      skipUpdateRef.current = true
      editor.commands.setContent(normalizedHtml as any, false)
      const committedHtml = editor.getHTML()
      setMarkdown(committedHtml)
      setDirty(true)
      if (paperStreamSessionRef.current.tabId === activeTabId) {
        paperStreamSessionRef.current.manualModified = false
      }
      return true
    } finally {
      schedulePaperStreamMutationClear()
    }
  }, [activeTabId, editor, schedulePaperStreamMutationClear, setDirty, setMarkdown])

  const flushPaperStreamBuffer = useCallback((mode: 'stable-only' | 'force' = 'stable-only', tabId?: string) => {
    if (!editor) return false
    const targetTabId = tabId || paperStreamBufferRef.current.tabId
    if (!targetTabId || activeTabId !== targetTabId) return false

    if (paperStreamFlushTimerRef.current) {
      clearTimeout(paperStreamFlushTimerRef.current)
      paperStreamFlushTimerRef.current = null
    }

    const buffered = paperStreamBufferRef.current.text
    if (!buffered) return false

    const next = mode === 'force'
      ? { flushText: buffered, remainder: '' }
      : splitStreamBufferAtStableBoundary(buffered)
    if (!next.flushText) return false

    if (!next.flushText.trim()) return false

    try {
      runPaperStreamProgrammaticMutation(() => {
        currentRuntime.applyTextEdit({ text: next.flushText, mode: 'append-inline-at-end' })
      })
      paperStreamBufferRef.current = { tabId: targetTabId, text: next.remainder }
      if (next.remainder) {
        paperStreamFlushTimerRef.current = setTimeout(() => {
          void flushPaperStreamBuffer('force', targetTabId)
        }, STREAM_BUFFER_FLUSH_DELAY_MS)
      }
      return true
    } catch {
      paperStreamMutationRef.current = false
      skipUpdateRef.current = false
      return false
    }
  }, [activeTabId, currentRuntime, editor, runPaperStreamProgrammaticMutation])

  const startPaperStreamAppend = useCallback((tabId: string) => {
    if (paperStreamFlushTimerRef.current) {
      clearTimeout(paperStreamFlushTimerRef.current)
      paperStreamFlushTimerRef.current = null
    }
    paperStreamBufferRef.current = { tabId, text: '' }
    paperStreamSessionRef.current = { tabId, manualModified: false, active: true }

    const canClearEditor = active && Boolean(editor) && activeTabId === tabId
    if (canClearEditor) {
      writePaperStreamHtmlToActiveEditor('<p></p>')
    }
    if (active && activeTabId === tabId) {
      setMarkdown('')
      setDirty(true)
    } else {
      setTabShellContent(tabId, '')
    }
    return canClearEditor
  }, [active, activeTabId, editor, setDirty, setMarkdown, setTabShellContent, writePaperStreamHtmlToActiveEditor])

  const appendPaperStreamChunk = useCallback((payload: { tabId: string; markdown: string; contentType?: string; eventType?: 'references' | 'image' }) => {
    if (!active || !editor || activeTabId !== payload.tabId) return false
    const rawMarkdown = String(payload.markdown || '')
    if (!rawMarkdown.trim()) return false

    if (shouldRenderStreamChunkAsStructuredHtml(rawMarkdown, payload.eventType)) {
      flushPaperStreamBuffer('force', payload.tabId)
      const html = toStreamAppendHtml(rawMarkdown, payload.eventType)
      if (!html.trim()) return false
      try {
        runPaperStreamProgrammaticMutation(() => {
          currentRuntime.applyTextEdit({ text: html, mode: 'append-at-end' })
        })
        return true
      } catch {
        paperStreamMutationRef.current = false
        skipUpdateRef.current = false
        return false
      }
    }

    const existingBuffer = paperStreamBufferRef.current.tabId === payload.tabId ? paperStreamBufferRef.current.text : ''
    const combined = `${existingBuffer}${rawMarkdown}`
    paperStreamBufferRef.current = { tabId: payload.tabId, text: combined }

    if (combined.length >= STREAM_BUFFER_FORCE_FLUSH_CHARS) {
      return flushPaperStreamBuffer('stable-only', payload.tabId) || flushPaperStreamBuffer('force', payload.tabId)
    }

    if (!flushPaperStreamBuffer('stable-only', payload.tabId) && !paperStreamFlushTimerRef.current) {
      paperStreamFlushTimerRef.current = setTimeout(() => {
        void flushPaperStreamBuffer('force', payload.tabId)
      }, STREAM_BUFFER_FLUSH_DELAY_MS)
    }
    return true
  }, [active, activeTabId, currentRuntime, editor, flushPaperStreamBuffer, runPaperStreamProgrammaticMutation])

  const syncPaperStreamPreview = useCallback((payload: { tabId: string; markdown: string; backendUrl: string }) => {
    const decision = resolvePaperStreamSyncDecision({
      activeTabId,
      targetTabId: payload.tabId,
      markdown: payload.markdown,
      manualModified: paperStreamSessionRef.current.manualModified && paperStreamSessionRef.current.tabId === payload.tabId,
    })
    if (decision.action === 'skip') return false
    if (decision.action === 'shell') {
      setTabShellContent(payload.tabId, decision.html)
      return true
    }
    // action === 'runtime': prefer live editor write, fall back to tab storage if editor not ready
    if (!active || !editor) {
      setTabShellContent(payload.tabId, decision.html)
      return true
    }
    return writePaperStreamHtmlToActiveEditor(decision.html)
  }, [active, activeTabId, editor, setTabShellContent, writePaperStreamHtmlToActiveEditor])

  const completePaperStreamAppend = useCallback((payload: { tabId: string; markdown: string; backendUrl: string }) => {
    const decision = resolvePaperStreamCompletionDecision({
      activeTabId,
      targetTabId: payload.tabId,
      markdown: payload.markdown,
    })
    if (decision.action === 'shell') {
      if (paperStreamSessionRef.current.tabId === payload.tabId) {
        paperStreamSessionRef.current.active = false
      }
      setTabShellContent(payload.tabId, decision.html)
      return true
    }
    if (editor) {
      flushPaperStreamBuffer('force', payload.tabId)
    }
    const session = paperStreamSessionRef.current
    session.active = false
    if (session.tabId !== payload.tabId) return false
    if (session.manualModified) return true

    if (!active || !editor) {
      setTabShellContent(payload.tabId, decision.html)
      return true
    }
    return writePaperStreamHtmlToActiveEditor(decision.html)
  }, [active, activeTabId, editor, flushPaperStreamBuffer, setTabShellContent, writePaperStreamHtmlToActiveEditor])

  useEffect(() => {
    const pendingImageInsertion = workbench.sessions.image.pendingImageInsertion
    if (!shouldAutoApplyPendingImageInsertion(pendingImageInsertion, activeTabId, Boolean(editor))) return
    if (!pendingImageInsertion) return
    void applyPendingImageInsertion(pendingImageInsertion)
  }, [activeTabId, applyPendingImageInsertion, editor, workbench.sessions.image.pendingImageInsertion])

  useEffect(() => {
    if (!editor) return

    const handlePaperPreviewSync = (event: Event) => {
      const detail = (event as CustomEvent<any>).detail || {}
      const tabId = String(detail.tabId || '')
      const html = String(detail.html || '')
      if (!tabId || tabId !== activeTabId || !html) return
      if (!active) {
        setTabShellContent(tabId, html)
        return
      }
      if (
        paperStreamSessionRef.current.active
        && paperStreamSessionRef.current.tabId === tabId
        && paperStreamSessionRef.current.manualModified
      ) return
      if (editor.getHTML() === html) return

      writePaperStreamHtmlToActiveEditor(html)
    }

    window.addEventListener('ai-writer-paper-preview-sync', handlePaperPreviewSync as EventListener)
    return () => window.removeEventListener('ai-writer-paper-preview-sync', handlePaperPreviewSync as EventListener)
  }, [active, activeTabId, editor, setTabShellContent, writePaperStreamHtmlToActiveEditor])

  useEffect(() => () => {
    if (paperStreamFlushTimerRef.current) {
      clearTimeout(paperStreamFlushTimerRef.current)
      paperStreamFlushTimerRef.current = null
    }
    if (paperStreamMutationClearTimerRef.current) {
      clearTimeout(paperStreamMutationClearTimerRef.current)
      paperStreamMutationClearTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (templatePinnedRef.current || activeTabHasBoundTemplate) return
    setPaperTemplateId(getRecommendedPaperTemplateId(language))
  }, [activeTabHasBoundTemplate, language])

  useEffect(() => {
    const handleTemplateRecommend = (event: Event) => {
      if (templatePinnedRef.current || activeTabHasBoundTemplate) return
      const detail = (event as CustomEvent<any>).detail || {}
      setPaperTemplateId(getRecommendedPaperTemplateId(detail.language))
    }
    window.addEventListener('ai-writer-recommend-template', handleTemplateRecommend as EventListener)
    return () => window.removeEventListener('ai-writer-recommend-template', handleTemplateRecommend as EventListener)
  }, [activeTabHasBoundTemplate])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (formulaDialog && event.key === 'Escape') {
        formulaAiAbortRef.current?.abort()
        formulaAiAbortRef.current = null
        setFormulaDialog(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [formulaDialog])

  useEffect(() => {
    if (!formulaDialog) {
      formulaDialogOpenRef.current = false
      return
    }
    // Only focus and move cursor to end when the dialog is first opened,
    // not on every state update (e.g. typing/deleting in the LaTeX textarea).
    if (!formulaDialogOpenRef.current) {
      formulaDialogOpenRef.current = true
      window.setTimeout(() => {
        formulaInputRef.current?.focus()
        formulaInputRef.current?.setSelectionRange(formulaInputRef.current.value.length, formulaInputRef.current.value.length)
      }, 0)
    }
  }, [formulaDialog])

  useEffect(() => {
    if (!editor) return
    const handleDoubleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const formulaEl = target?.closest('[data-formula-node="true"]') as HTMLElement | null
      if (!formulaEl) return
      const pos = editor.view.posAtDOM(formulaEl, 0)
      const rect = formulaEl.getBoundingClientRect()
      openFormulaDialog(
        formulaEl.dataset.formulaDisplay === 'block' ? 'block' : 'inline',
        formulaEl.dataset.latex || '',
        pos,
        { anchorX: rect.left, anchorY: rect.bottom + 8 },
      )
    }

    editor.view.dom.addEventListener('dblclick', handleDoubleClick)
    return () => editor.view.dom.removeEventListener('dblclick', handleDoubleClick)
  }, [editor, openFormulaDialog])

  const persistReferenceSectionToWorkspace = useCallback(async (references: CitationReferenceItem[]) => {
    const referenceTargetPath = getAutoSaveTargetPath(activeTabId, filePath, currentFileName)
    if (!activeWorkspacePath || !window.electronAPI || !references.length || !referenceTargetPath) return 0
    await window.electronAPI.saveReferences(
      activeWorkspacePath,
      references.map((item) => ({ reference_number: item.citationNumber, citation: item.text })),
      referenceTargetPath,
    )
    void refreshTree().catch(() => undefined)
    return references.length
  }, [activeTabId, activeWorkspacePath, currentFileName, filePath, getAutoSaveTargetPath, refreshTree])

  useEffect(() => {
    rewriteAbortRef.current?.abort()
    setInlineRewrite(null)
    expandAbortRef.current?.abort()
    setInlineExpand(null)
    setInlineRef(null)
  }, [activeTabId])

  useEffect(() => () => {
    rewriteAbortRef.current?.abort()
    expandAbortRef.current?.abort()
    continueAbortRef.current?.abort()
  }, [])

  const stopInlineContinue = useCallback((message = '已停止续写') => {
    if (!continueAbortRef.current) return false
    continueAbortRef.current.abort()
    continueAbortRef.current = null
    setIsGenerating(false)
    setStatusMessage(message)
    setContinueStreamState((prev) => ({ ...prev, phase: 'stopped', message }))
    window.dispatchEvent(new CustomEvent('ai-terminal-continue-state', { detail: { running: false } }))
    return true
  }, [setIsGenerating, setStatusMessage])

  useEffect(() => {
    const onTerminalAction = (event: Event) => {
      const detail = (event as CustomEvent<any>).detail || {}
      if (detail.action !== 'cancel-continue') return
      stopInlineContinue('已取消续写')
    }
    window.addEventListener('ai-terminal-action', onTerminalAction as EventListener)
    return () => window.removeEventListener('ai-terminal-action', onTerminalAction as EventListener)
  }, [stopInlineContinue])

  const executeInlineRewrite = useCallback((text: string, from: number, to: number, posX: number, posY: number, anchorId?: string, customPrompt?: string) => {
    const settings = getAIToolSettings()
    const autoLangReq = settings.rewriteLanguage === 'auto' ? '【重要】请保持原文语言不变，严禁将内容翻译成其他语言' : ''
    const userRequirements = [settings.rewriteRequirements, autoLangReq].filter(Boolean).join('；') || undefined
    const normalizedTemplateDocumentId = String(knowledge.templateDocumentId || '').trim() || null
    const normalizedReferenceDocumentIds = knowledge.referenceDocumentIds
      .map((item) => String(item || '').trim())
      .filter((item) => item && item !== normalizedTemplateDocumentId)
    const hasExplicitKnowledgeSelection = Boolean(normalizedTemplateDocumentId || normalizedReferenceDocumentIds.length > 0)
    const selectedText = text.trim()
    if (!selectedText) {
      setStatusMessage('请先选中要重写的文本')
      return
    }
    setInlineRewrite({ original: text, rewritten: '', from, to, posX, posY, streaming: true, anchorId })
    setStatusMessage(hasExplicitKnowledgeSelection ? '正在结合知识库重写选中文本...' : '正在重写选中文本...')
    const controller = new AbortController()
    rewriteAbortRef.current = controller
    void (async () => {
      try {
        let knowledgeContext: string | undefined

        if (hasExplicitKnowledgeSelection) {
          const constraints = buildKnowledgeTaskConstraints({
            mode: 'selected-only',
            templateDocumentId: normalizedTemplateDocumentId,
            requiredReferenceDocumentIds: normalizedReferenceDocumentIds,
            preferredReferenceDocumentIds: [],
            autoRetrievalLimit: 5,
            templateInheritance: {
              structure: false,
              tone: true,
              terminology: true,
            },
          })

          const preview = await resolveKnowledgeTaskPreview({
            instruction: selectedText,
            constraints,
            previewContext: (p: any) => window.electronAPI.previewKnowledgeTaskContext(knowledge.departmentId, p),
            fallbackInstruction: '请在不改变原意的前提下重写这段文字',
          })

          knowledgeContext = buildInlineRewriteKnowledgeContext(preview, constraints)
        }

        const instruction = [
          '请只重写当前选中的文本。',
          INLINE_REWRITE_SEMANTIC_GUARD,
          '输出要求：只返回改写后的最终文本，不要加解释、标题、引号或项目符号；除非原文本本身就是列表。',
          userRequirements ? `补充要求：${userRequirements}` : '',
          customPrompt ? `用户自定义要求：${customPrompt}` : '',
        ].filter(Boolean).join('\n')

        await runWritingAssistant({
          instruction,
          documentText: selectedText,
          language,
          extraContext: knowledgeContext,
        }, {
          onStatus: (message) => setStatusMessage(message),
          onDelta: (_delta, accumulated) => {
            setInlineRewrite((prev) => prev ? { ...prev, rewritten: accumulated } : null)
          },
          onComplete: ({ text: rewrittenText }) => {
            const rewritten = String(rewrittenText || '').trim()
            if (!rewritten) {
              throw new Error('智能改写未返回可用内容')
            }
            setInlineRewrite((prev) => prev ? { ...prev, rewritten, streaming: false } : null)
            setStatusMessage('改写完成，请选择接受或拒绝')
          },
          onError: (error) => {
            throw new Error(error)
          },
        }, controller.signal)
      } catch (error) {
        if (controller.signal.aborted) {
          setStatusMessage('已取消智能改写')
          setInlineRewrite(null)
          return
        }
        setStatusMessage(`智能改写失败: ${error instanceof Error ? error.message : String(error)}`)
        setInlineRewrite(null)
      } finally {
        if (rewriteAbortRef.current === controller) {
          rewriteAbortRef.current = null
        }
      }
    })()
  }, [knowledge.referenceDocumentIds, knowledge.templateDocumentId, language, setStatusMessage])

  const handleRewritePromptConfirm = useCallback(() => {
    if (!rewritePromptDialog) return
    const { text, from, to, posX, posY, anchorId } = rewritePromptDialog
    const prompt = rewriteCustomPrompt.trim()
    setRewritePromptDialog(null)
    executeInlineRewrite(text, from, to, posX, posY, anchorId, prompt || undefined)
  }, [rewritePromptDialog, rewriteCustomPrompt, executeInlineRewrite])

  const handleAcceptRewrite = useCallback(() => {
    if (!inlineRewrite || !inlineRewrite.rewritten) return
    try {
      currentRuntime.applyTextEdit({
        text: inlineRewrite.rewritten.trim(),
        mode: 'replace-range',
        range: {
          from: inlineRewrite.from,
          to: inlineRewrite.to,
          text: inlineRewrite.original,
          collapsed: inlineRewrite.from === inlineRewrite.to,
          anchorId: inlineRewrite.anchorId,
        },
      })
      setStatusMessage('已接受重写')
    } catch {
      setStatusMessage('替换失败')
    }
    setInlineRewrite(null)
  }, [currentRuntime, inlineRewrite, setStatusMessage])

  const executeInlineExpand = useCallback((text: string, from: number, to: number, posX: number, posY: number, anchorId?: string, contextBefore?: string, contextAfter?: string, customPrompt?: string) => {
    const selectedText = text.trim()
    if (!selectedText) {
      setStatusMessage('请先选中要扩写的文本')
      return
    }
    setInlineExpand({ original: text, expanded: '', from, to, posX, posY, streaming: true, anchorId })
    setStatusMessage('正在扩写选中文本...')
    const controller = new AbortController()
    expandAbortRef.current = controller
    void (async () => {
      try {
        const instruction = buildExpandInstruction({ customPrompt })
        const extraContext = buildExpandExtraContext({ contextBefore, contextAfter })

        await runWritingAssistant({
          instruction,
          documentText: selectedText,
          language,
          extraContext,
        }, {
          onStatus: (message) => setStatusMessage(message),
          onDelta: (_delta, accumulated) => {
            setInlineExpand((prev) => prev ? { ...prev, expanded: accumulated } : null)
          },
          onComplete: ({ text: expandedText }) => {
            const expanded = String(expandedText || '').trim()
            if (!expanded || expanded.length < 2) {
              throw new Error('AI 扩写未返回可用内容')
            }
            setInlineExpand((prev) => prev ? { ...prev, expanded, streaming: false } : null)
            setStatusMessage('扩写完成，请选择接受或拒绝')
          },
          onError: (error) => {
            throw new Error(error)
          },
        }, controller.signal)
      } catch (error) {
        if (controller.signal.aborted) {
          setStatusMessage('已取消扩写')
          setInlineExpand(null)
          return
        }
        setStatusMessage(`扩写失败: ${error instanceof Error ? error.message : String(error)}`)
        setInlineExpand(null)
      } finally {
        if (expandAbortRef.current === controller) {
          expandAbortRef.current = null
        }
      }
    })()
  }, [language, setStatusMessage])

  const handleExpandPromptConfirm = useCallback(() => {
    if (!expandPromptDialog) return
    const { text, from, to, posX, posY, anchorId, contextBefore, contextAfter } = expandPromptDialog
    const prompt = expandCustomPrompt.trim()
    setExpandPromptDialog(null)
    executeInlineExpand(text, from, to, posX, posY, anchorId, contextBefore, contextAfter, prompt || undefined)
  }, [expandPromptDialog, expandCustomPrompt, executeInlineExpand])

  const handleAcceptExpand = useCallback(() => {
    if (!inlineExpand || !inlineExpand.expanded) return
    const expandedText = inlineExpand.expanded.trim()
    // Safety guard: never apply if the AI returned only whitespace/newlines
    if (!expandedText || expandedText.length < 2) {
      setStatusMessage('扩写结果无效，已取消')
      setInlineExpand(null)
      return
    }
    try {
      currentRuntime.applyTextEdit({
        text: expandedText,
        mode: 'replace-range',
        range: {
          from: inlineExpand.from,
          to: inlineExpand.to,
          text: inlineExpand.original,
          collapsed: inlineExpand.from === inlineExpand.to,
          anchorId: inlineExpand.anchorId,
        },
      })
      setStatusMessage('已接受扩写')
    } catch {
      setStatusMessage('替换失败')
    }
    setInlineExpand(null)
  }, [currentRuntime, inlineExpand, setStatusMessage])

  const executeInlineReference = useCallback(async (text: string, from: number, to: number, posX: number, posY: number, anchorId?: string) => {
    if (isLegacySelectionInAbstractSection(editor)) {
      setStatusMessage('摘要/Abstract 区域不支持插入引用')
      return
    }
    const settings = getAIToolSettings()
    setInlineRef({ citations: [], selectedText: text, from, to, posX, posY, loading: true, selectedCitationKeys: [], anchorId })
    setStatusMessage(knowledge.departmentId ? '正在查找文献（含知识库）...' : '正在查找文献...')
    try {
      const [result, kbPreview] = await Promise.all([
        findCitationForText({
          selected_text: text.trim(),
          topic: settings.refTopic || undefined,
          max_results: INLINE_CITATION_MAX_RESULTS,
          yearFrom: settings.refYearFrom || settings.genYearFrom || undefined,
          yearTo: settings.refYearTo || settings.genYearTo || undefined,
        }),
        knowledge.departmentId
          ? window.electronAPI.previewKnowledgeTaskContext(
              knowledge.departmentId,
              { instruction: text.trim(), topK: 5 },
            ).catch(() => null)
          : Promise.resolve(null),
      ])
      const externalCitations = result.status === 'success' ? result.citations : []
      const kbCitations: CitationItem[] = (kbPreview?.citations || []).map((hit: any, idx: number) => ({
        number: externalCitations.length + idx + 1,
        citation: `[知识库] ${String(hit.documentTitle || '').trim()}：${String(hit.quote || '').trim().slice(0, 150)}`,
        abstract: String(hit.quote || '').trim(),
        doi: null,
      }))
      const allCitations = [...externalCitations, ...kbCitations]
      if (allCitations.length > 0) {
        setInlineRef((prev) => prev ? { ...prev, citations: allCitations, loading: false } : null)
        const kbNote = kbCitations.length > 0 ? `，其中 ${kbCitations.length} 条来自知识库` : ''
        setStatusMessage(`找到 ${allCitations.length} 条文献${kbNote}`)
      } else {
        setStatusMessage('未找到匹配文献')
        setInlineRef(null)
      }
    } catch (err: any) {
      setStatusMessage('文献查找失败: ' + (err?.message || ''))
      setInlineRef(null)
    }
  }, [editor, knowledge.departmentId, setStatusMessage])

  const applyReferenceHtmlToDocument = useCallback((nextHtml: string) => {
    if (!editor) return false
    const currentHtml = editor.getHTML()
    if (nextHtml === currentHtml) return false

    skipUpdateRef.current = true
    try {
      currentRuntime.setDocumentContent(nextHtml)
      // Use editor.getHTML() instead of nextHtml so the stored markdown doesn't contain
      // data-* attributes that TipTap strips — avoids a spurious useEffect re-apply.
      setMarkdown(editor.getHTML())
      setDirty(true)
      return true
    } finally {
      skipUpdateRef.current = false
    }
  }, [currentRuntime, editor, setDirty, setMarkdown])

  const handleInsertCitations = useCallback((citations: CitationItem[]) => {
    if (!inlineRef) return
    const normalizedCitations = dedupeCitationItems(citations)
    if (!normalizedCitations.length) {
      setStatusMessage('请至少勾选一篇文献')
      return
    }
    try {
      let nextHtml = editor ? editor.getHTML() : markdown
      const assignedNumbers: number[] = []
      normalizedCitations.forEach((citation) => {
        const updated = upsertCitationReferenceSection(nextHtml, citation)
        nextHtml = updated.html
        assignedNumbers.push(updated.citationNumber || citation.number)
      })
      const marker = formatCitationMarker(assignedNumbers)
      if (!marker) {
        setStatusMessage('插入引用失败')
        return
      }
      applyReferenceHtmlToDocument(nextHtml)
      currentRuntime.insertComment({
        kind: 'citation',
        range: {
          from: inlineRef.from,
          to: inlineRef.to,
          text: inlineRef.selectedText,
          collapsed: inlineRef.from === inlineRef.to,
          anchorId: inlineRef.anchorId,
        },
        body: marker,
        metadata: { citationNumbers: marker },
      })
      const normalizedHtml = editor ? editor.getHTML() : markdown
      const renumbered = renumberLegacyCitationDocument(normalizedHtml)
      const finalHtml = renumbered.changed ? renumbered.html : normalizedHtml
      if (renumbered.changed) {
        applyReferenceHtmlToDocument(finalHtml)
      }
      const finalNumbers = Array.from(new Set(assignedNumbers.map((number) => renumbered.remap.get(number) ?? number))).sort((left, right) => left - right)
      const finalReferences = renumbered.orderedItems.length ? renumbered.orderedItems : collectLegacyReferenceItems(finalHtml)
      void persistReferenceSectionToWorkspace(finalReferences).catch(() => undefined)
      setStatusMessage(`已插入引用 ${formatCitationMarker(finalNumbers)}，并自动校正正文编号与参考文献`)
    } catch {
      setStatusMessage('插入引用失败')
    }
    setInlineRef(null)
  }, [applyReferenceHtmlToDocument, currentRuntime, editor, inlineRef, markdown, persistReferenceSectionToWorkspace, setStatusMessage])

  const toggleInlineCitationSelection = useCallback((citation: CitationItem) => {
    const citationKey = buildCitationSelectionKey(citation)
    setInlineRef((prev) => prev ? {
      ...prev,
      selectedCitationKeys: prev.selectedCitationKeys.includes(citationKey)
        ? prev.selectedCitationKeys.filter((item) => item !== citationKey)
        : [...prev.selectedCitationKeys, citationKey],
    } : prev)
  }, [])

  const handleInsertSelectedCitations = useCallback(() => {
    if (!inlineRef) return
    const selectedCitations = inlineRef.citations.filter((citation) => inlineRef.selectedCitationKeys.includes(buildCitationSelectionKey(citation)))
    handleInsertCitations(selectedCitations)
  }, [handleInsertCitations, inlineRef])

  const executeInlineContinue = useCallback(async (selectedText: string, selectionOverride?: { text: string; from: number; to: number; anchorId?: string } | null) => {
    if (isGenerating) return
    const settings = getAIToolSettings()
    const plainText = htmlToPlainText(markdown)
    const goal = selectedText ? `基于以下内容续写：\n${selectedText.slice(0, 200)}` : (settings.continueGoal || '自动补全')
    const targetTab = activeTabId
    setIsGenerating(true)
    setStatusMessage('正在续写...')
    setContinueStreamState({ phase: 'running', message: '正在流式续写...', insertedChars: 0 })
    window.dispatchEvent(new CustomEvent('ai-terminal-continue-state', { detail: { running: true } }))
    const controller = new AbortController()
    continueAbortRef.current = controller
    const targetSelection = selectionOverride
      ? {
          from: selectionOverride.from,
          to: selectionOverride.to,
          text: selectionOverride.text,
          collapsed: selectionOverride.from === selectionOverride.to,
          anchorId: selectionOverride.anchorId,
        }
      : currentRuntime.getSelection()
    const hasExpandedSelection = Boolean(targetSelection && !targetSelection.collapsed && String(targetSelection.text || '').trim())
    const shouldAppendParagraphAtEnd = !hasExpandedSelection && (() => {
      if (!targetSelection) return true
      if (!targetSelection.collapsed) return false
      const documentEnd = getTiptapDocumentSize(editor)
      return targetSelection.to >= Math.max(0, documentEnd - 1)
    })()
    let insertionRange = shouldAppendParagraphAtEnd ? null : targetSelection
      ? {
          ...targetSelection,
          collapsed: true,
          from: targetSelection.to,
          to: targetSelection.to,
          text: '',
        }
      : null
    let streamedText = ''
    let insertedAnyText = false
    let targetSwitched = false

    const resolveNextInsertionRange = (previousRange: typeof insertionRange, insertedText: string) => {
      if (!previousRange) return null
      const runtimeSelection = currentRuntime.getSelection()
      if (
        runtimeSelection?.collapsed
        && (
          runtimeSelection.from !== previousRange.from
          || runtimeSelection.to !== previousRange.to
          || runtimeSelection.anchorId !== previousRange.anchorId
        )
      ) {
        return {
          ...runtimeSelection,
          text: '',
        }
      }

      const nextPosition = previousRange.to + insertedText.length
      return {
        ...previousRange,
        from: nextPosition,
        to: nextPosition,
        collapsed: true,
        text: '',
      }
    }

    const appendContinueText = (text: string) => {
      const insertionText = normalizeContinueDeltaAtStart(text, insertedAnyText)
      if (!insertionText) return
      if (activeTabIdRef.current !== targetTab) {
        if (!targetSwitched) {
          targetSwitched = true
          setStatusMessage('续写仍在生成，但目标标签页已切换，后续结果未自动应用')
        }
        return
      }

      currentRuntime.applyTextEdit({
        text: insertionText,
        mode: !insertedAnyText && shouldAppendParagraphAtEnd
          ? 'append-paragraph-at-end'
          : (insertionRange ? 'append-after-range' : 'append-inline-at-end'),
        range: insertionRange,
      })

      if (insertionRange) {
        insertionRange = resolveNextInsertionRange(insertionRange, insertionText)
      }

      insertedAnyText = true
      streamedText += text
      setContinueStreamState({ phase: 'running', message: '正在流式续写...', insertedChars: streamedText.length })
    }

    const appendContinueRemainder = (fullText: string) => {
      const normalizedFullText = normalizeContinueLeadingText(fullText)
      if (!normalizedFullText) return
      if (!streamedText) {
        appendContinueText(normalizedFullText)
        return
      }
      if (normalizedFullText.startsWith(streamedText)) {
        appendContinueText(normalizedFullText.slice(streamedText.length))
      }
    }

    try {
      let kbExtraContext: string | undefined
      if (knowledge.departmentId) {
        try {
          const kbQuery = (selectedText || plainText).slice(0, 300)
          const kbPreview = await window.electronAPI.previewKnowledgeTaskContext(
            knowledge.departmentId,
            { instruction: kbQuery, topK: 5 },
          ).catch(() => null)
          const kbCitations = kbPreview?.citations || []
          if (kbCitations.length) {
            kbExtraContext = [
              '以下是知识库中的相关参考材料，请在续写时参考这些材料的术语、风格和事实（不得改变写作方向）：',
              ...kbCitations.map((c: any) => `- ${String(c.documentTitle || '')}：${String(c.quote || '').trim().slice(0, 200)}`),
            ].join('\n')
          }
        } catch {
          // KB retrieval is optional, silently skip
        }
      }

      if (isDirectMode()) {
        await directContinueWriting(plainText, goal, {
          onDelta: (delta: string) => {
            appendContinueText(delta)
          },
          onComplete: (fullText: string) => {
            appendContinueRemainder(fullText)
            const completionMessage = targetSwitched ? '续写已完成，但目标标签页已切换，剩余结果未自动应用' : '续写完成，已流式插入'
            setStatusMessage(completionMessage)
            setContinueStreamState({ phase: 'completed', message: completionMessage, insertedChars: streamedText.length })
            setIsGenerating(false)
            window.dispatchEvent(new CustomEvent('ai-terminal-continue-state', { detail: { running: false } }))
          },
          onError: (err: string) => {
            if (controller.signal.aborted || err === '已停止') {
              const stopMessage = targetSwitched ? '已停止续写，目标标签页切换后未继续自动应用' : '已停止续写'
              setStatusMessage(stopMessage)
              setContinueStreamState({ phase: 'stopped', message: stopMessage, insertedChars: streamedText.length })
            } else {
              const errorMessage = '续写失败: ' + err
              setStatusMessage(errorMessage)
              setContinueStreamState({ phase: 'error', message: errorMessage, insertedChars: streamedText.length })
            }
            setIsGenerating(false)
            window.dispatchEvent(new CustomEvent('ai-terminal-continue-state', { detail: { running: false } }))
          },
        }, controller.signal, language, settings.continueWords)
      } else {
        await continueWriting(
          { draftText: plainText, writingGoal: goal, targetWords: settings.continueWords, language, extraContext: kbExtraContext },
          {
            onDelta: (delta) => {
              appendContinueText(delta)
            },
            onComplete: (result) => {
              appendContinueRemainder(result.continuedText)
              const completionMessage = targetSwitched ? '续写已完成，但目标标签页已切换，剩余结果未自动应用' : '续写完成，已流式插入'
              setStatusMessage(completionMessage)
              setContinueStreamState({ phase: 'completed', message: completionMessage, insertedChars: streamedText.length })
              setIsGenerating(false)
              window.dispatchEvent(new CustomEvent('ai-terminal-continue-state', { detail: { running: false } }))
            },
            onError: (err) => {
              if (controller.signal.aborted || err === '已停止') {
                const stopMessage = targetSwitched ? '已停止续写，目标标签页切换后未继续自动应用' : '已停止续写'
                setStatusMessage(stopMessage)
                setContinueStreamState({ phase: 'stopped', message: stopMessage, insertedChars: streamedText.length })
              } else {
                const errorMessage = '续写失败: ' + err
                setStatusMessage(errorMessage)
                setContinueStreamState({ phase: 'error', message: errorMessage, insertedChars: streamedText.length })
              }
              setIsGenerating(false)
              window.dispatchEvent(new CustomEvent('ai-terminal-continue-state', { detail: { running: false } }))
            },
            onStatus: (msg) => setStatusMessage(msg),
          },
          controller.signal,
        )
      }
    } finally {
      continueAbortRef.current = null
    }
  }, [activeTabId, currentRuntime, editor, isGenerating, knowledge.departmentId, language, setIsGenerating, setStatusMessage])

  const executeInlineImage = useCallback(async (prompt: string) => {
    if (!activeWorkspacePath) {
      setStatusMessage('请先打开工作区，图片会先保存到工作区后再插入编辑器')
      return
    }
    const settings = getAIToolSettings()
    window.dispatchEvent(new CustomEvent('ai-terminal-open'))
    setStatusMessage('正在分析选中内容并重建图片提示词，请稍候...')

    /* ── fetch KB text context to enrich image prompt ── */
    let knowledgeContext: string | undefined
    if (knowledge.departmentId) {
      try {
        const preview = await window.electronAPI.previewKnowledgeTaskContext(knowledge.departmentId, { instruction: prompt, topK: 3 })
        const hits = (preview?.retrievedHits || []).map((h: any) => String(h?.chunk?.text || h?.quote || '').trim()).filter(Boolean)
        if (hits.length > 0) knowledgeContext = hits.join('\n---\n')
      } catch { /* KB unavailable — proceed without */ }
    }

    try {
      const result = await generateSelectionImage(prompt, settings.imageAspectRatio, (attempt, total) => {
        if (attempt > 1) {
          setStatusMessage(`首次生图未完成，正在用更精简的关键词提示重试 (${attempt}/${total})...`)
        }
      }, knowledgeContext)
      if (result.status === 'success' && result.image_url) {
        const rawPath = String(result.file_path || result.image_url)
        try {
          const structure = await window.electronAPI.detectProjectStructure(activeWorkspacePath)
          const filename = result.filename || rawPath.split(/[\\/]/).pop() || `image_${Date.now()}.png`
          const saved = structure?.hasFigures ? await window.electronAPI.saveImageToFigures(activeWorkspacePath, rawPath, filename) : await window.electronAPI.saveImageFromUrl(activeWorkspacePath, rawPath, filename)
          void refreshTree().catch(() => undefined)
          const targetSelection = currentRuntime.getSelection()
          await currentRuntime.insertAnchoredImage({
            src: toFileUrl(saved.path),
            alt: result.alt,
            placement: targetSelection && !targetSelection.collapsed ? 'after-selection' : 'cursor',
            widthPx: getDefaultInsertedGeneratedImageWidthPx(),
          })
          setStatusMessage(result.fallbackUsed ? '图片生成完成，已自动缩短摘要重试并插入编辑器' : '图片生成完成，已插入编辑器并保存到工作区')
        } catch (err: any) {
          setStatusMessage('图片已生成，但保存到工作区失败，未插入编辑器: ' + (err?.message || '未知错误'))
        }
      } else {
        setStatusMessage('图片生成失败: ' + (result.error || '未知错误') + (result.fallbackUsed ? '，已自动尝试更短摘要。' : ''))
      }
    } catch (err: any) {
      setStatusMessage('图片生成失败: ' + (err?.message || ''))
    }
  }, [activeWorkspacePath, currentRuntime, knowledge.departmentId, refreshTree, setStatusMessage])

  const compatExecutorDelegate = useMemo<ManuscriptCompatExecutorDelegate>(() => ({
    openComposer: ({ mode, instruction, autoRun, flow, selection }) => {
      openComposerWithFlow({
        mode: 'document',
        autoTopic: instruction,
        autoRun,
        flow,
        selection,
      })
    },
    resolveSelection: resolveCommandSelectionActionContext,
    getCurrentSelectionText: () => String(getCurrentSelection()?.text || '').trim(),
    rewriteSelection: (selection) => {
      setRewritePromptDialog({ text: selection.text, from: selection.from, to: selection.to, posX: selection.posX, posY: selection.posY, anchorId: selection.anchorId })
      setRewriteCustomPrompt('')
      setTimeout(() => rewritePromptInputRef.current?.focus(), 60)
    },
    expandSelection: (selection) => {
      const doc = editor?.state.doc
      let contextBefore = ''
      let contextAfter = ''
      if (doc) {
        const docSize = doc.content.size
        const fullText = doc.textBetween(0, docSize, '\n')
        // selection.from/to are ProseMirror positions; approximate char offset
        const charFrom = Math.max(0, selection.from - 1)
        const charTo = Math.min(fullText.length, selection.to - 1)
        contextBefore = fullText.slice(Math.max(0, charFrom - 150), charFrom)
        contextAfter = fullText.slice(charTo, Math.min(fullText.length, charTo + 150))
      }
      setExpandPromptDialog({ text: selection.text, from: selection.from, to: selection.to, posX: selection.posX, posY: selection.posY, anchorId: selection.anchorId, contextBefore, contextAfter })
      setExpandCustomPrompt('')
      setTimeout(() => expandPromptInputRef.current?.focus(), 60)
    },
    insertCitation: async (selection) => {
      await executeInlineReference(selection.text, selection.from, selection.to, selection.posX, selection.posY, selection.anchorId)
    },
    continueWriting: async (selectionText, selection) => {
      await executeInlineContinue(selectionText, selection ?? null)
    },
    insertImage: async (prompt) => {
      await executeInlineImage(prompt)
    },
  }), [editor, executeInlineContinue, executeInlineImage, executeInlineReference, executeInlineRewrite, executeInlineExpand, getCurrentSelection, openComposerWithFlow, resolveCommandSelectionActionContext])

  const executeRoutedManuscriptCommand = useCallback(async (command: RoutedManuscriptCommand) => {
    const result = await executeRoutedManuscriptCommandWithExecutor(command, {
      compat: compatExecutorDelegate,
    })

    if (!result.ok) {
      setStatusMessage(result.error)
      return
    }

    if (result.message) {
      setStatusMessage(result.message)
    }
  }, [compatExecutorDelegate, setStatusMessage])

  const routeAndExecuteManuscriptCommand = useCallback((command: ReturnType<typeof createManuscriptCommand>) => {
    const routed = routeManuscriptCommand(command)
    if (!routed.ok) {
      setStatusMessage(routed.error)
      return
    }

    void executeRoutedManuscriptCommand(routed.command)
  }, [executeRoutedManuscriptCommand, setStatusMessage])

  const dispatchLegacySelectionAction = useCallback((action: ManuscriptSelectionAction) => {
    const selection = getCurrentSelection()
    const selectionRange = selection ? { from: selection.from, to: selection.to } : undefined
    const selectionText = String(selection?.text || '').trim()
    const selectionAnchor = selection ? {
      from: selection.from,
      to: selection.to,
      text: selectionText,
      anchorId: selection.anchorId,
    } : undefined

    const command = (() => {
      switch (action) {
        case 'rewrite':
          return createManuscriptCommand({
            id: 'rewrite_selection',
            profile: manuscriptProfile,
            targetScope: 'selection',
            trigger: 'selection_toolbar',
            payload: { selectionText, selectionRange, selectionAnchor },
          })
        case 'continue':
          return createManuscriptCommand({
            id: 'continue_writing',
            profile: manuscriptProfile,
            targetScope: selection ? 'selection' : 'whole_document',
            trigger: 'selection_toolbar',
            payload: { selectionText, selectionRange, selectionAnchor },
          })
        case 'reference':
          return createManuscriptCommand({
            id: 'insert_citation',
            profile: manuscriptProfile,
            targetScope: 'selection',
            trigger: 'selection_toolbar',
            payload: { selectionText, selectionRange, selectionAnchor },
          })
        case 'image':
          return createManuscriptCommand({
            id: 'insert_image',
            profile: manuscriptProfile,
            targetScope: selection ? 'selection' : 'whole_document',
            trigger: 'selection_toolbar',
            payload: { selectionText, selectionRange, selectionAnchor },
          })
        default:
          return null
      }
    })()

    if (!command) return
    routeAndExecuteManuscriptCommand(command)
  }, [getCurrentSelection, manuscriptProfile, routeAndExecuteManuscriptCommand])

  useEffect(() => {
    const handleManuscriptCommand = (event: Event) => {
      const detail = (event as CustomEvent<any>).detail
      if (!detail) return

      const routed = isRoutedManuscriptCommand(detail)
        ? { ok: true as const, command: detail as RoutedManuscriptCommand }
        : routeManuscriptCommand(detail)

      if (!routed.ok) {
        setStatusMessage(routed.error)
        return
      }

      if (routed.command.executorId !== getManuscriptExecutorIdForProfile(manuscriptProfile)) return
      void executeRoutedManuscriptCommand(routed.command)
    }

    const handleLegacyPromptSubmit = (event: Event) => {
      const detail = (event as CustomEvent<any>).detail || {}
      if (detail.profile && detail.profile !== manuscriptProfile) return

      routeAndExecuteManuscriptCommand(createManuscriptCommand({
        id: 'generate_full_body',
        profile: manuscriptProfile,
        trigger: 'prompt_bar',
        payload: {
          instruction: String(detail.instruction || '').trim(),
          autoRun: Boolean(detail.autoRun ?? true),
        },
      }))
    }

    const handleLegacySelectionAction = (event: Event) => {
      const detail = (event as CustomEvent<any>).detail || {}
      const action = String(detail.action || '').trim() as ManuscriptSelectionAction
      if (!action) return
      dispatchLegacySelectionAction(action)
    }

    window.addEventListener(MANUSCRIPT_COMMAND_EVENT, handleManuscriptCommand as EventListener)
    window.addEventListener('ai-writer-manuscript-prompt-submit', handleLegacyPromptSubmit as EventListener)
    window.addEventListener('ai-writer-manuscript-selection-action', handleLegacySelectionAction as EventListener)
    return () => {
      window.removeEventListener(MANUSCRIPT_COMMAND_EVENT, handleManuscriptCommand as EventListener)
      window.removeEventListener('ai-writer-manuscript-prompt-submit', handleLegacyPromptSubmit as EventListener)
      window.removeEventListener('ai-writer-manuscript-selection-action', handleLegacySelectionAction as EventListener)
    }
  }, [dispatchLegacySelectionAction, executeRoutedManuscriptCommand, manuscriptProfile, routeAndExecuteManuscriptCommand, setStatusMessage])

  const handleInsertLocalImage = useCallback(async () => {
    const importedImage = await window.electronAPI.importImageFile()
    if (!importedImage) return

    try {
      let insertSrc = importedImage.dataUrl
      if (activeWorkspacePath) {
        const structure = await window.electronAPI.detectProjectStructure(activeWorkspacePath)
        const base64Data = importedImage.dataUrl.replace(/^data:[^;]+;base64,/, '')
        const saved = structure?.hasFigures
          ? await window.electronAPI.saveImageToFiguresBase64(activeWorkspacePath, importedImage.fileName, base64Data)
          : await window.electronAPI.saveImageToWorkspace(activeWorkspacePath, importedImage.fileName, base64Data)
        if (saved?.path) {
          insertSrc = toFileUrl(saved.path)
          void refreshTree().catch(() => undefined)
        }
      }

      const targetSelection = currentRuntime.getSelection()
      await currentRuntime.insertAnchoredImage({
        src: insertSrc,
        alt: importedImage.fileName.replace(/\.[^.]+$/, ''),
        title: importedImage.fileName.replace(/\.[^.]+$/, ''),
        placement: targetSelection && !targetSelection.collapsed ? 'after-selection' : 'cursor',
      })
      setStatusMessage(`已插入本地图片: ${importedImage.fileName}`)
    } catch (error) {
      setStatusMessage(`插入本地图片失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [activeWorkspacePath, currentRuntime, refreshTree, setStatusMessage])

  const openSidebarTab = useCallback((tab: string, data?: any) => {
    window.dispatchEvent(new CustomEvent('open-sidebar-tab', { detail: { tab, ...data } }))
    window.dispatchEvent(new CustomEvent('ai-sidebar-action', { detail: { action: tab, ...data } }))
  }, [])

  const handleOpenFile = useCallback(async () => {
    await requestOpenFromDialog()
  }, [requestOpenFromDialog])

  const handleSaveFile = useCallback(async () => {
    await saveActiveDocument({ reason: 'manual' })
  }, [saveActiveDocument])

  const handleMigrateDocxToAidoc = useCallback(async () => {
    if (!editor || !activeTabId || !filePath) return
    const aidocPath = filePath.replace(/\.docx$/i, '.aidoc.json')
    const editorHtml = editor.getHTML()
    const serialized = serializeForFilePath(aidocPath, editorHtml, editor)
    try {
      await window.electronAPI.writeFile(aidocPath, serialized.content)
      syncSavedTargetPath(activeTabId, aidocPath)
      markTabShellSaved(activeTabId, { filePath: aidocPath, fileName: aidocPath.split(/[\\/]/).pop() || '', content: editorHtml })
      await refreshTree()
      setShowDocxMigrationBanner(false)
      setStatusMessage('已迁移为 .aidoc.json 格式，格式将完整保留')
    } catch (e) {
      setStatusMessage('迁移失败：' + String(e))
    }
  }, [activeTabId, editor, filePath, markTabShellSaved, refreshTree, serializeForFilePath, setStatusMessage, syncSavedTargetPath])

  const handleExportPdf = useCallback(async () => {
    if (!editor) {
      setStatusMessage('导出失败：编辑器未就绪')
      return
    }
    const html = editor.getHTML()
    const title = (activeTab?.fileName || '').replace(/\.[^.]+$/, '') || '文档'
    const tpl = activeTemplateDefinition
    const bodyStyle = activeBodyStyle
    const fontSizePx = parseFloat(bodyStyle?.fontSize || tpl.fontSize) || parseFloat(tpl.fontSize) || 15
    const styles = {
      templateId: resolvedPaperTemplateId,
      fontFamily: bodyStyle?.fontFamily || tpl.fontFamily,
      fontSize: bodyStyle?.fontSize || tpl.fontSize,
      fontSizePx,
      lineHeight: bodyStyle?.lineHeight || tpl.lineHeight,
      textIndent: bodyStyle?.textIndent || tpl.textIndent,
      paragraphSpacing: bodyStyle?.paragraphSpacing || tpl.paragraphSpacing,
      headingAlign: bodyStyle?.headingAlign || (tpl.headingAlign === 'center' ? 'center' : 'left'),
      pagePadding: activePagePadding,
    }
    setStatusMessage('正在导出 PDF…')
    try {
      const saved = await window.electronAPI.exportPdfFromEditor({ html, styles, title })
      setStatusMessage(saved ? `PDF 已导出：${saved}` : '已取消导出')
    } catch (err) {
      console.error('[exportPdf]', err)
      setStatusMessage(`导出 PDF 失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [editor, activeTab, resolvedPaperTemplateId, activeTemplateDefinition, activeBodyStyle, activePagePadding, setStatusMessage])

  const handleExportHtml = useCallback(async () => {
    if (!editor) {
      setStatusMessage('导出失败：编辑器未就绪')
      return
    }
    const title = (activeTab?.fileName || '').replace(/\.[^.]+$/, '') || '文档'
    const bodyHtml = editor.getHTML()
    const fullHtml = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
  body { max-width: 820px; margin: 40px auto; padding: 0 24px; font-family: "Microsoft YaHei", "PingFang SC", sans-serif; font-size: 15px; line-height: 1.9; color: #2f2f2f; }
  h1, h2, h3, h4 { margin-top: 1.4em; margin-bottom: 0.4em; }
  p { margin: 0.5em 0; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #ccc; padding: 6px 10px; }
  img { max-width: 100%; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`
    setStatusMessage('正在导出 HTML…')
    try {
      const chosenPath = await window.electronAPI.saveFileDialog(`${title}.html`)
      if (!chosenPath) { setStatusMessage('已取消导出'); return }
      const finalPath = chosenPath.endsWith('.html') || chosenPath.endsWith('.htm') ? chosenPath : `${chosenPath}.html`
      const result = await window.electronAPI.writeFile(finalPath, fullHtml)
      setStatusMessage(result.success ? `HTML 已导出：${finalPath.split(/[\\/]/).pop()}` : '导出 HTML 失败')
    } catch (err) {
      setStatusMessage(`导出 HTML 失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [editor, activeTab, setStatusMessage])

  const handleSaveAsFile = useCallback(async () => {
    await saveActiveDocumentAs()
  }, [saveActiveDocumentAs])

  const handleJournalExportConfirm = useCallback(async (config: JournalExportConfig) => {
    setShowJournalExportDialog(false)
    if (!editor) return
    const html = editor.getHTML()
    setStatusMessage('正在导出期刊格式 DOCX…')
    try {
      const result = await window.electronAPI.exportWithJournalFormat({
        html,
        config: {
          presetId: config.preset.id,
          runningTitle: config.runningTitle,
          authorLine: config.authorLine,
        },
      })
      if (result.success && result.filePath) {
        setStatusMessage(`导出成功：${result.filePath}`)
      } else {
        setStatusMessage('已取消导出')
      }
    } catch (err) {
      console.error('[journalExport]', err)
      setStatusMessage(`期刊导出失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [editor, setStatusMessage])

  const handleCtxAction = useCallback((action: EditorCtxAction) => {
    if (!ctxMenu || ctxMenu.kind === 'image') return
    const selectedText = ctxMenu?.text || ''
    const from = ctxMenu?.from
    const to = ctxMenu?.to
    const selectionRange = from != null && to != null ? { from, to } : undefined
    const selectionAnchor = from != null && to != null ? {
      from,
      to,
      text: selectedText,
      anchorId: ctxMenu.anchorId,
    } : undefined
    closeCtxMenu()

    const executeContextCommand = ({
      commandId,
      targetScope,
      payload,
    }: {
      commandId: 'generate_full_body' | 'rewrite_selection' | 'expand_selection' | 'continue_writing' | 'insert_citation' | 'insert_image'
      targetScope: 'whole_document' | 'selection'
      payload: Record<string, unknown>
    }) => {
      routeAndExecuteManuscriptCommand(createManuscriptCommand({
        id: commandId,
        profile: manuscriptProfile,
        targetScope,
        trigger: 'context_menu',
        payload,
      }))
    }

    switch (action) {
      case 'rewrite':
        executeContextCommand({
          commandId: 'rewrite_selection',
          targetScope: 'selection',
          payload: {
            selectionText: selectedText,
            selectionRange,
            selectionAnchor,
          },
        })
        break
      case 'expand':
        executeContextCommand({
          commandId: 'expand_selection',
          targetScope: 'selection',
          payload: {
            selectionText: selectedText,
            selectionRange,
            selectionAnchor,
          },
        })
        break
      case 'reference':
        executeContextCommand({
          commandId: 'insert_citation',
          targetScope: 'selection',
          payload: {
            selectionText: selectedText,
            selectionRange,
            selectionAnchor,
          },
        })
        break
      case 'continue':
        executeContextCommand({
          commandId: 'continue_writing',
          targetScope: selectedText ? 'selection' : 'whole_document',
          payload: {
            selectionText: selectedText,
            selectionRange,
            selectionAnchor,
          },
        })
        break
      case 'generate': {
        executeContextCommand({
          commandId: 'generate_full_body',
          targetScope: 'whole_document',
          payload: {
            instruction: selectedText,
            selectionText: selectedText,
            selectionRange,
            selectionAnchor,
            autoRun: true,
            flow: 'paper-generation',
          },
        })
        break
      }
      case 'image':
        if (selectedText) {
          executeContextCommand({
            commandId: 'insert_image',
            targetScope: 'selection',
            payload: {
              selectionText: selectedText,
              selectionRange,
              selectionAnchor,
            },
          })
        } else {
          openSidebarTab('image')
        }
        break
      case 'settings': openSidebarTab('settings'); setStatusMessage('已打开 AI 设置中心'); break
    }
  }, [ctxMenu, closeCtxMenu, manuscriptProfile, openSidebarTab, routeAndExecuteManuscriptCommand, setStatusMessage])

  const handleImageCtxAction = useCallback((action: ImageCtxAction) => {
    if (!ctxMenu || ctxMenu.kind !== 'image') return
    const imageTarget = ctxMenu.image

    switch (action) {
      case 'replace-local':
        closeCtxMenu()
        void replaceImageFromLocalFile(imageTarget.pos)
        break
      case 'stitch':
        closeCtxMenu()
        openStitchDialog(imageTarget.pos)
        break
      case 'crop':
        openCropDialog(imageTarget.pos)
        break
      case 'delete': {
        closeCtxMenu()
        if (!editor) return
        const node = getTiptapNodeAt(editor, imageTarget.pos)
        if (!node || node.type.name !== 'image') {
          setStatusMessage('未定位到图片节点，删除失败')
          return
        }
        editor.chain().focus().deleteRange({ from: imageTarget.pos, to: imageTarget.pos + node.nodeSize }).run()
        setStatusMessage('已删除图片')
        break
      }
    }
  }, [ctxMenu, closeCtxMenu, editor, openCropDialog, openStitchDialog, replaceImageFromLocalFile, setStatusMessage])

  const applyComposerSelectionRewrite = useCallback((payload: { tabId: string; from: number; to: number; anchorId?: string; text: string }) => {
    if (activeTabId !== payload.tabId) {
      setStatusMessage('局部改写前请保持目标标签页处于当前激活状态')
      return false
    }
    try {
      currentRuntime.applyTextEdit({
        text: payload.text,
        mode: 'replace-range',
        range: {
          from: payload.from,
          to: payload.to,
          text: '',
          collapsed: payload.from === payload.to,
          anchorId: payload.anchorId,
        },
      })
      setStatusMessage('已完成局部改写')
      return true
    } catch {
      setStatusMessage('局部改写应用失败')
      return false
    }
  }, [activeTabId, currentRuntime, setStatusMessage])

  const resolveComposerDocumentRewriteTarget = useCallback((payload: { tabId: string; instruction: string }) => {
    if (activeTabId !== payload.tabId) {
      return resolveDocumentRewriteTargetInEditor(null, payload.instruction)
    }
    return resolveDocumentRewriteTargetInEditor(editor, payload.instruction)
  }, [activeTabId, editor])

  useEffect(() => {
    if (isReadonlyPreviewTab) return
    if (!active) return
    if (!editor) return
    if (mdBridgeEnabledRef.current && activeTabIsMarkdown) {
      const incomingMarkdown = String(markdown || '')
      const currentMarkdown = normalizeMarkdownFormulaOutput(serializeEditorToMarkdownWithBridge(editor))
      if (normalizeMarkdownFormulaOutput(incomingMarkdown) === currentMarkdown) return
      skipUpdateRef.current = true
      try {
        const jsonDoc = parseMarkdownWithTiptapBridge(incomingMarkdown, editor)
        currentRuntime.setDocumentContent(jsonDoc as any)
      } catch {
        const fallbackHtml = incomingMarkdown === '' ? '<p></p>' : markdownToHtml(incomingMarkdown)
        currentRuntime.setDocumentContent(fallbackHtml as any)
      } finally {
        skipUpdateRef.current = false
      }
      return
    }
    const currentHTML = editor.getHTML()
    if (markdown !== currentHTML) {
      skipUpdateRef.current = true
      let content: string | object = markdown === '' ? '<p></p>' : (hasMarkdownSyntax(markdown) ? markdownToHtml(markdown) : markdown)
      let nextRenderState: EditorDocumentRenderState | undefined
      if (markdown !== '' && typeof content === 'string') {
        const unwrapped = unwrapEditorDocumentEnvelope(content)
        nextRenderState = unwrapped.renderState
        content = unwrapped.contentHtml || '<p></p>'
        try {
          const parsed = JSON.parse(content)
          if (parsed && typeof parsed === 'object' && parsed.type === 'doc') content = parsed
        } catch {}
      }
      if (activeTabId && nextRenderState) {
        const effectiveTemplateId = activeRenderState?.templateLocked && activeRenderState.paperTemplateId
          ? activeRenderState.paperTemplateId
          : nextRenderState.paperTemplateId
        setRenderStateByTabId((current) => {
          const previousState = current[activeTabId]
          const nextState: EditorDocumentRenderState = {
            paperTemplateId: previousState?.templateLocked && previousState.paperTemplateId ? previousState.paperTemplateId : nextRenderState?.paperTemplateId,
            bodyStyle: previousState?.templateLocked ? previousState.bodyStyle : nextRenderState?.bodyStyle,
            shell: nextRenderState?.shell,
            templateLocked: previousState?.templateLocked || false,
          }
          if (isSameRenderState(previousState, nextState)) return current
          return { ...current, [activeTabId]: nextState }
        })
        if (effectiveTemplateId && effectiveTemplateId !== paperTemplateId) {
          setPaperTemplateId(effectiveTemplateId)
        }
      }
      currentRuntime.setDocumentContent(content as any)
      skipUpdateRef.current = false
    }
    // Apply any pending TipTap JSON restore (from lossless .aidoc.json open).
    // Key must match what was set during loadDocument (canonicalDocumentId preferred, then filePath).
    const activeTab = tabs.find((t) => t.id === activeTabId)
    const restoreKey = activeTab?.canonicalDocumentId ?? activeTab?.filePath ?? activeTabId ?? ''
    const pendingRestore = restoreKey ? pendingTiptapRestoreRef.current.get(restoreKey) : undefined
    if (pendingRestore) {
      pendingTiptapRestoreRef.current.delete(restoreKey)
      skipUpdateRef.current = true
      try {
        editor.commands.setContent(pendingRestore.tiptapJson as any, false)
      } catch { /* ignore */ }
      skipUpdateRef.current = false
    }
  }, [active, activeRenderState?.paperTemplateId, activeRenderState?.templateLocked, activeTabId, activeTabIsMarkdown, currentRuntime, editor, isReadonlyPreviewTab, markdown, paperTemplateId])

  useEffect(() => {
    setRenderStateByTabId((current) => {
      const validTabIds = new Set(tabs.map((tab) => tab.id))
      let changed = false
      const nextState: Record<string, EditorDocumentRenderState> = {}
      Object.entries(current).forEach(([tabId, renderState]) => {
        if (validTabIds.has(tabId)) {
          nextState[tabId] = renderState
        } else {
          changed = true
        }
      })
      return changed ? nextState : current
    })
  }, [tabs])

  useEffect(() => {
    if (isReadonlyPreviewTab) return
    const cachedTemplateId = activeRenderState?.paperTemplateId
    if (cachedTemplateId && cachedTemplateId !== paperTemplateId) {
      setPaperTemplateId(cachedTemplateId)
    }
  }, [activeRenderState?.paperTemplateId, isReadonlyPreviewTab, paperTemplateId])

  useEffect(() => { setGhostLanguage(language) }, [language])

  useEffect(() => {
    if (!composerRunning) { setAutoScrollPaused(false); return }
    if (activeTabId !== composerTargetTabId || autoScrollPaused) return
    const el = editorScrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [composerRunning, autoScrollPaused, markdown, shadowText, activeTabId, composerTargetTabId])

  const handleEditorScroll = useCallback(() => {
    scheduleLayoutMetrics()
    if (!composerRunning || !autoScrollPaused) return
    const el = editorScrollRef.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 36) setAutoScrollPaused(false)
  }, [composerRunning, autoScrollPaused, scheduleLayoutMetrics])

  const handleEditorWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (!composerRunning) return
    if (activeTabId !== composerTargetTabId) return
    if (e.deltaY > 0) setAutoScrollPaused(true)
  }, [composerRunning, activeTabId, composerTargetTabId])

  useEffect(() => {
    if (!editor) return
    setDocTextStats(computeEditorDocumentTextStats(editor))
    scheduleLayoutMetrics()
  }, [editor, markdown, scheduleLayoutMetrics])

  useEffect(() => {
    if (!editor || isReadonlyDocPreviewMode) return
    const scrollEl = editorScrollRef.current
    const pageEl = editorPageShellRef.current
    if (!scrollEl || !pageEl) return
    const observer = new ResizeObserver(() => scheduleLayoutMetrics())
    observer.observe(scrollEl)
    observer.observe(pageEl)
    scheduleLayoutMetrics()
    return () => {
      observer.disconnect()
      const pending = layoutMetricsRafRef.current
      if (pending != null) {
        cancelAnimationFrame(pending)
        layoutMetricsRafRef.current = null
      }
    }
  }, [editor, isReadonlyDocPreviewMode, scheduleLayoutMetrics, showPageFooter, showPageHeader])

  useEffect(() => () => {
    const pending = layoutMetricsRafRef.current
    if (pending != null) cancelAnimationFrame(pending)
  }, [])

  useEffect(() => {
    if (!isReadonlyPreviewTab) return
    setActiveImageOverlay(null)
    setCtxMenu(null)
    setImageResizeState(null)
    setInlineRewrite(null)
    setInlineExpand(null)
    setInlineRef(null)
    setFormulaDialog(null)
    setStitchDialog(null)
    setCropDialog(null)
    setCropDragState(null)
  }, [isReadonlyPreviewTab])

  useEffect(() => {
    if (!isReadonlyDocPreviewMode) return
    setActiveImageOverlay(null)
    setCtxMenu(null)
    setImageResizeState(null)
    setInlineRewrite(null)
    setInlineExpand(null)
    setInlineRef(null)
    setFormulaDialog(null)
    setStitchDialog(null)
    setCropDialog(null)
    setCropDragState(null)
  }, [isReadonlyDocPreviewMode])

  // Auto-open composer removed: dialog should only open on explicit user action.

  const openPreviewExternally = useCallback(async () => {
    const targetPath = activeTabPreview?.externalFilePath || activeTab?.filePath
    if (!targetPath) return
    const opened = await window.electronAPI.openExternalFile(targetPath)
    if (!opened.success) {
      setStatusMessage(`无法打开预览原件: ${opened.error || '未知错误'}`)
      return
    }
    setStatusMessage(`已用系统默认程序打开: ${activeTab?.fileName || '当前文件'}`)
  }, [activeTab?.fileName, activeTab?.filePath, activeTabPreview?.externalFilePath, setStatusMessage])

  const generationComposerNode = (
    (() => {
      const defaultInlineComposerVisible = (workspaceMode === 'free' || (workspaceMode === 'generation' && currentMode === 'document')) && !isReadonlyPreviewTab && !isReadonlyDocPreviewMode
      const composerPresentation = composerSilentMode
        ? 'silent'
        : defaultInlineComposerVisible
          ? 'inline'
          : (composerInitialMode === 'document' && composerDocumentFlow !== 'paper-generation' ? 'inline' : 'modal')
      return (
    <GenerationComposer
      open={composerOpen || defaultInlineComposerVisible}
      presentation={composerPresentation}
      autoTopic={composerTopic}
      autoStartNonce={composerAutoStartNonce}
      manualEditNonce={composerManualEditNonce}
      manualEditTabId={composerManualEditTabId}
      initialMode={composerInitialMode}
      preferredDocumentFlow={composerOpen ? composerDocumentFlow : 'auto'}
      autoRunOnOpen={composerAutoRunOnOpen}
      targetTabId={composerTargetTabId || activeTabId || mainTabId}
      selectionText={composerSelection?.text}
      selectionRange={composerSelection ? { from: composerSelection.from, to: composerSelection.to, anchorId: composerSelection.anchorId } : null}
      selectionStructureContext={composerSelectionStructureContext}
      onApplySelectionRewrite={applyComposerSelectionRewrite}
      onResolveDocumentRewriteTarget={resolveComposerDocumentRewriteTarget}
      onClose={() => {
        const closedTabId = composerTargetTabId || activeTabId || mainTabId
        if (closedTabId) dismissedComposerTabIdsRef.current.add(closedTabId)
        setComposerOpen(false)
        setComposerSilentMode(false)
        setShadowText('')
        setComposerAutoRunOnOpen(false)
        setComposerSelectionStructureContext(null)
        flushPaperStreamBuffer('force', paperStreamSessionRef.current.tabId)
        paperStreamSessionRef.current.active = false
      }}
      onShadowTextChange={setShadowText}
      onRunningChange={(running) => {
        setComposerRunning(running)
        if (running) {
          setAutoScrollPaused(false)
          composerManualEditReportedRef.current = { tabId: composerTargetTabId || activeTabId || mainTabId, reported: false }
          setComposerManualEditTabId('')
        }
        if (!running) {
          setComposerPaused(false)
          if (composerSilentMode) setComposerOpen(false)
          setComposerSilentMode(false)
          composerManualEditReportedRef.current = { tabId: '', reported: false }
          setComposerManualEditTabId('')
          flushPaperStreamBuffer('force', paperStreamSessionRef.current.tabId)
          paperStreamSessionRef.current.active = false
        }
      }}
      onPauseChange={setComposerPaused}
      onPaperStreamStart={startPaperStreamAppend}
      onPaperStreamSync={syncPaperStreamPreview}
      onPaperStreamComplete={completePaperStreamAppend}
    />
      )
    })()
  )

  return (
    <EditorWrapper>
      {activeImageOverlay && <><ImageResizeOverlay style={{ left: activeImageOverlay.left, top: activeImageOverlay.top, width: activeImageOverlay.width, height: activeImageOverlay.height }} /><ImageResizeHandle $position="nw" style={{ left: activeImageOverlay.left - 6, top: activeImageOverlay.top - 6 }} onPointerDown={(event) => beginImageResize('nw', event)} /><ImageResizeHandle $position="ne" style={{ left: activeImageOverlay.left + activeImageOverlay.width - 6, top: activeImageOverlay.top - 6 }} onPointerDown={(event) => beginImageResize('ne', event)} /><ImageResizeHandle $position="sw" style={{ left: activeImageOverlay.left - 6, top: activeImageOverlay.top + activeImageOverlay.height - 6 }} onPointerDown={(event) => beginImageResize('sw', event)} /><ImageResizeHandle $position="se" style={{ left: activeImageOverlay.left + activeImageOverlay.width - 6, top: activeImageOverlay.top + activeImageOverlay.height - 6 }} onPointerDown={(event) => beginImageResize('se', event)} /><ImageResizeHandle $position="e" style={{ left: activeImageOverlay.left + activeImageOverlay.width - 6, top: activeImageOverlay.top + activeImageOverlay.height / 2 - 6 }} onPointerDown={(event) => beginImageResize('e', event)} /><ImageResizeHandle $position="s" style={{ left: activeImageOverlay.left + activeImageOverlay.width / 2 - 6, top: activeImageOverlay.top + activeImageOverlay.height - 6 }} onPointerDown={(event) => beginImageResize('s', event)} /><ImageResizeHint style={{ left: activeImageOverlay.left + activeImageOverlay.width / 2 - 96, top: Math.max(12, activeImageOverlay.top - 34) }}>默认锁定比例，按住 Shift 自由拉伸</ImageResizeHint></>}
      {ctxMenu && <><CtxMenuOverlay onClick={closeCtxMenu} onContextMenu={(e) => { e.preventDefault(); closeCtxMenu() }} /><CtxMenu style={{ left: ctxMenu.x, top: ctxMenu.y }}>{ctxMenu.kind === 'image' ? <ImageToolPanel><ImageToolTitle>图片工具</ImageToolTitle><ImageMetaText>{formatImageSourceMeta(ctxMenu.image.src)}</ImageMetaText><ImageToolGrid><ImageToolLabel>宽度(px)<ImageToolInput type="number" min={40} value={imageToolDraft?.width || ''} onChange={(event) => setImageToolDraft((current) => current ? { ...current, width: event.target.value } : current)} onBlur={() => imageToolDraft && applyImageWidth(imageToolDraft.pos, imageToolDraft.width)} placeholder="如 320" /></ImageToolLabel><ImageToolLabel>标题<ImageToolInput value={imageToolDraft?.title || ''} onChange={(event) => setImageToolDraft((current) => current ? { ...current, title: event.target.value } : current)} onBlur={() => imageToolDraft && applyImageTitle(imageToolDraft.pos, imageToolDraft.title)} placeholder="图标题/说明" /></ImageToolLabel></ImageToolGrid><ImageToolLabel>对齐<ImageToolSegment><ImageToolSegmentBtn $active={imageToolDraft?.alignment === 'left'} onClick={() => imageToolDraft && applyImageAlignment(imageToolDraft.pos, 'left')}>左对齐</ImageToolSegmentBtn><ImageToolSegmentBtn $active={imageToolDraft?.alignment === 'center'} onClick={() => imageToolDraft && applyImageAlignment(imageToolDraft.pos, 'center')}>居中</ImageToolSegmentBtn><ImageToolSegmentBtn $active={imageToolDraft?.alignment === 'right'} onClick={() => imageToolDraft && applyImageAlignment(imageToolDraft.pos, 'right')}>右对齐</ImageToolSegmentBtn></ImageToolSegment></ImageToolLabel><ImageToolRow><ImageToolBtn onClick={() => handleImageCtxAction('replace-local')}>替换图片</ImageToolBtn><ImageToolBtn onClick={() => handleImageCtxAction('stitch')}>拼接图片替换</ImageToolBtn><ImageToolBtn onClick={() => handleImageCtxAction('crop')}>✂️ 裁剪图片</ImageToolBtn><ImageToolBtn $danger onClick={() => handleImageCtxAction('delete')}>删除</ImageToolBtn></ImageToolRow></ImageToolPanel> : ctxMenu.kind === 'text' ? <><CtxMenuLabel>选中文本操作</CtxMenuLabel><CtxMenuItem onClick={() => handleCtxAction('generate')}>✨ 生成论文</CtxMenuItem><CtxMenuItem onClick={() => handleCtxAction('rewrite')}>✏️ 重写选中文本</CtxMenuItem><CtxMenuItem onClick={() => handleCtxAction('expand')}>🔍 扩写选中文本</CtxMenuItem><CtxMenuItem onClick={() => handleCtxAction('reference')}>📚 查找文献并插入</CtxMenuItem><CtxMenuItem onClick={() => handleCtxAction('continue')}>✍ AI 续写</CtxMenuItem><CtxMenuItem onClick={() => handleCtxAction('image')}>🎨 根据选中内容生成图片</CtxMenuItem><CtxMenuDivider /><CtxMenuItem onClick={() => handleCtxAction('settings')}>⚙ AI 设置</CtxMenuItem></> : <><CtxMenuItem onClick={() => handleCtxAction('generate')}>✨ 生成论文</CtxMenuItem><CtxMenuItem onClick={() => handleCtxAction('continue')}>✍ AI 续写</CtxMenuItem><CtxMenuItem onClick={() => handleCtxAction('image')}>🎨 图片生成</CtxMenuItem><CtxMenuDivider /><CtxMenuItem onClick={() => handleCtxAction('settings')}>⚙ AI 设置</CtxMenuItem></>}</CtxMenu></>}
      {stitchDialog && <><CtxMenuOverlay onClick={() => setStitchDialog(null)} /><StitchPanel style={{ left: Math.max(16, (window.innerWidth - 620) / 2), top: Math.max(16, (window.innerHeight - 560) / 2) }}><DiffHeader><span>🧩 拼接图片替换</span><DiffBtn onClick={() => setStitchDialog(null)}>✕ 关闭</DiffBtn></DiffHeader><DiffBody><StitchColumns><StitchSidebar><ImageToolBtn onClick={() => void pickStitchFolder()}>选择图片文件夹</ImageToolBtn><ImageToolLabel>拼接方式<select value={stitchDialog.layout} onChange={(event) => setStitchDialog((current) => current ? { ...current, layout: event.target.value as StitchLayout } : current)}><option value="grid">网格拼接</option><option value="vertical">纵向拼接</option><option value="horizontal">横向拼接</option></select></ImageToolLabel><ImageToolLabel>网格列数<ImageToolInput type="number" min={1} value={stitchDialog.columns} disabled={stitchDialog.layout !== 'grid'} onChange={(event) => setStitchDialog((current) => current ? { ...current, columns: Math.max(1, Number(event.target.value) || 1) } : current)} /></ImageToolLabel><ImageToolLabel>图片间距<ImageToolInput type="number" min={0} value={stitchDialog.gap} onChange={(event) => setStitchDialog((current) => current ? { ...current, gap: Math.max(0, Number(event.target.value) || 0) } : current)} /></ImageToolLabel><ImageToolLabel>背景颜色<ImageToolInput type="color" value={stitchDialog.background} onChange={(event) => setStitchDialog((current) => current ? { ...current, background: event.target.value } : current)} /></ImageToolLabel><ImageToolLabel>输出文件名<ImageToolInput value={stitchDialog.fileName} onChange={(event) => setStitchDialog((current) => current ? { ...current, fileName: event.target.value } : current)} /></ImageToolLabel><ImageToolBtn $primary onClick={() => void buildStitchPreview()}>{stitchDialog.building ? '拼接中...' : '生成拼接预览'}</ImageToolBtn></StitchSidebar><div><StitchHint>{stitchDialog.folderPath || '请选择图片文件夹后，再勾选要参与拼接的图片。'}</StitchHint><StitchImageList>{stitchDialog.images.length === 0 ? <StitchHint>这里会列出所选文件夹中的图片。</StitchHint> : stitchDialog.images.map((item, index) => <StitchImageCard key={item.filePath} $selected={item.selected}><label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, cursor: 'pointer' }}><input type="checkbox" checked={item.selected} onChange={() => toggleStitchImage(item.filePath)} /><span>{index + 1}. {item.name}</span></label><ImageToolRow><ImageToolBtn onClick={() => moveStitchImage(item.filePath, -1)}>上移</ImageToolBtn><ImageToolBtn onClick={() => moveStitchImage(item.filePath, 1)}>下移</ImageToolBtn></ImageToolRow></StitchImageCard>)}</StitchImageList><StitchPreview>{stitchDialog.previewUrl ? <img src={stitchDialog.previewUrl} alt="stitch preview" /> : <StitchHint>生成后会在这里预览拼接结果。</StitchHint>}</StitchPreview></div></StitchColumns></DiffBody><DiffActions><DiffBtn onClick={() => setStitchDialog(null)}>取消</DiffBtn><DiffBtn onClick={() => void applyStitchReplacement()} $accept>{stitchDialog.saving ? '替换中...' : '替换当前图片'}</DiffBtn></DiffActions></StitchPanel></>}
      {cropDialog && (
        <CropDialogOverlay onClick={() => !cropDialog.saving && setCropDialog(null)}>
          <CropPanel onClick={(e) => e.stopPropagation()}>
            <DiffHeader>
              <span>✂️ 裁剪图片</span>
              <DiffBtn onClick={() => !cropDialog.saving && setCropDialog(null)}>✕ 关闭</DiffBtn>
            </DiffHeader>
            <CropBody>
              <div style={{ fontSize: 14, color: '#64748b' }}>在图片上拖拽选择裁剪区域，或拖动边框/角点调整，也可在下方输入精确数值。</div>
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', background: '#f0f0f0', borderRadius: 8, padding: 8, overflow: 'auto' }}>
                <CropImageWrapper ref={cropContainerRef} onPointerDown={beginCropWrapperDrag}>
                  <img src={cropDialog.src} alt="crop source" onLoad={handleCropImageLoad} style={{ display: 'block', maxWidth: 'min(780px, 80vw)', maxHeight: 460, pointerEvents: 'none' }} draggable={false} />
                  <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                    <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: `${cropDialog.cropY}%`, background: 'rgba(0,0,0,0.52)' }} />
                    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${Math.max(0, 100 - cropDialog.cropY - cropDialog.cropH)}%`, background: 'rgba(0,0,0,0.52)' }} />
                    <div style={{ position: 'absolute', top: `${cropDialog.cropY}%`, bottom: `${Math.max(0, 100 - cropDialog.cropY - cropDialog.cropH)}%`, left: 0, width: `${cropDialog.cropX}%`, background: 'rgba(0,0,0,0.52)' }} />
                    <div style={{ position: 'absolute', top: `${cropDialog.cropY}%`, bottom: `${Math.max(0, 100 - cropDialog.cropY - cropDialog.cropH)}%`, right: 0, width: `${Math.max(0, 100 - cropDialog.cropX - cropDialog.cropW)}%`, background: 'rgba(0,0,0,0.52)' }} />
                  </div>
                  <CropSelection style={{ left: `${cropDialog.cropX}%`, top: `${cropDialog.cropY}%`, width: `${cropDialog.cropW}%`, height: `${cropDialog.cropH}%` }} onPointerDown={(e) => { e.stopPropagation(); beginCropDrag('move', e) }}>
                    <CropHandle $pos="nw" style={{ left: 0, top: 0 }} onPointerDown={(e) => { e.stopPropagation(); beginCropDrag('nw', e) }} />
                    <CropHandle $pos="ne" style={{ left: '100%', top: 0 }} onPointerDown={(e) => { e.stopPropagation(); beginCropDrag('ne', e) }} />
                    <CropHandle $pos="sw" style={{ left: 0, top: '100%' }} onPointerDown={(e) => { e.stopPropagation(); beginCropDrag('sw', e) }} />
                    <CropHandle $pos="se" style={{ left: '100%', top: '100%' }} onPointerDown={(e) => { e.stopPropagation(); beginCropDrag('se', e) }} />
                    <CropHandle $pos="n" style={{ left: '50%', top: 0 }} onPointerDown={(e) => { e.stopPropagation(); beginCropDrag('n', e) }} />
                    <CropHandle $pos="s" style={{ left: '50%', top: '100%' }} onPointerDown={(e) => { e.stopPropagation(); beginCropDrag('s', e) }} />
                    <CropHandle $pos="w" style={{ left: 0, top: '50%' }} onPointerDown={(e) => { e.stopPropagation(); beginCropDrag('w', e) }} />
                    <CropHandle $pos="e" style={{ left: '100%', top: '50%' }} onPointerDown={(e) => { e.stopPropagation(); beginCropDrag('e', e) }} />
                  </CropSelection>
                </CropImageWrapper>
              </div>
              {cropDialog.naturalWidth > 0 && (
                <CropNumericRow>
                  <CropNumericLabel>起始X (px)<ImageToolInput type="number" min={0} max={cropDialog.naturalWidth - 1} value={Math.round(cropDialog.cropX / 100 * cropDialog.naturalWidth)} onChange={(e) => { const px = Math.max(0, Math.min(cropDialog.naturalWidth - 1, Number(e.target.value) || 0)); setCropDialog((c) => c ? { ...c, cropX: px / c.naturalWidth * 100 } : null) }} /></CropNumericLabel>
                  <CropNumericLabel>起始Y (px)<ImageToolInput type="number" min={0} max={cropDialog.naturalHeight - 1} value={Math.round(cropDialog.cropY / 100 * cropDialog.naturalHeight)} onChange={(e) => { const py = Math.max(0, Math.min(cropDialog.naturalHeight - 1, Number(e.target.value) || 0)); setCropDialog((c) => c ? { ...c, cropY: py / c.naturalHeight * 100 } : null) }} /></CropNumericLabel>
                  <CropNumericLabel>宽度 (px)<ImageToolInput type="number" min={1} max={cropDialog.naturalWidth} value={Math.round(cropDialog.cropW / 100 * cropDialog.naturalWidth)} onChange={(e) => { const px = Math.max(1, Math.min(cropDialog.naturalWidth, Number(e.target.value) || 1)); setCropDialog((c) => c ? { ...c, cropW: px / c.naturalWidth * 100 } : null) }} /></CropNumericLabel>
                  <CropNumericLabel>高度 (px)<ImageToolInput type="number" min={1} max={cropDialog.naturalHeight} value={Math.round(cropDialog.cropH / 100 * cropDialog.naturalHeight)} onChange={(e) => { const ph = Math.max(1, Math.min(cropDialog.naturalHeight, Number(e.target.value) || 1)); setCropDialog((c) => c ? { ...c, cropH: ph / c.naturalHeight * 100 } : null) }} /></CropNumericLabel>
                </CropNumericRow>
              )}
              <CropNumericLabel>输出文件名<ImageToolInput value={cropDialog.fileName} onChange={(e) => setCropDialog((c) => c ? { ...c, fileName: e.target.value } : null)} /></CropNumericLabel>
            </CropBody>
            <DiffActions>
              <DiffBtn onClick={() => setCropDialog(null)}>取消</DiffBtn>
              <DiffBtn $accept onClick={() => void applyCropToImage()} disabled={cropDialog.saving || cropDialog.cropW < 1 || cropDialog.cropH < 1}>{cropDialog.saving ? '裁剪中...' : '确认裁剪'}</DiffBtn>
            </DiffActions>
          </CropPanel>
        </CropDialogOverlay>
      )}
      {rewritePromptDialog && <><CtxMenuOverlay onClick={() => setRewritePromptDialog(null)} /><FormulaPopover style={{ left: Math.min(rewritePromptDialog.posX, window.innerWidth - 480), top: Math.min(rewritePromptDialog.posY, window.innerHeight - 280) }}><DiffHeader><span>✏️ 重写选中文本</span><DiffBtn onClick={() => setRewritePromptDialog(null)}>✕ 关闭</DiffBtn></DiffHeader><DiffBody><div style={{ fontSize: 14, color: '#66788a', marginBottom: 8, maxHeight: 60, overflow: 'hidden', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{rewritePromptDialog.text.length > 120 ? rewritePromptDialog.text.slice(0, 120) + '...' : rewritePromptDialog.text}</div><FormulaTextArea ref={rewritePromptInputRef} value={rewriteCustomPrompt} onChange={(e) => setRewriteCustomPrompt(e.target.value)} placeholder={'输入重写提示词，例如：改为更正式的学术语气、精简为一句话概述...\n留空则使用默认重写规则'} style={{ minHeight: 80, fontFamily: 'inherit' }} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleRewritePromptConfirm() } }} /></DiffBody><DiffActions><DiffBtn onClick={() => setRewritePromptDialog(null)}>取消</DiffBtn><DiffBtn $accept onClick={handleRewritePromptConfirm}>开始重写</DiffBtn></DiffActions></FormulaPopover></> }
      {expandPromptDialog && <><CtxMenuOverlay onClick={() => setExpandPromptDialog(null)} /><FormulaPopover style={{ left: expandDialogDrag.pos.x, top: expandDialogDrag.pos.y }}><DiffHeader onMouseDown={expandDialogDrag.onHeaderMouseDown} style={{ cursor: 'move' }}><span>🔍 扩写选中文本</span><DiffBtn onClick={() => setExpandPromptDialog(null)}>✕ 关闭</DiffBtn></DiffHeader><DiffBody><div style={{ fontSize: 14, color: '#66788a', marginBottom: 8, maxHeight: 60, overflow: 'hidden', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{expandPromptDialog.text.length > 120 ? expandPromptDialog.text.slice(0, 120) + '...' : expandPromptDialog.text}</div><FormulaTextArea ref={expandPromptInputRef} value={expandCustomPrompt} onChange={(e) => setExpandCustomPrompt(e.target.value)} placeholder={'输入扩写提示词（可留空），例如：增加原理分析、补充实验数据、展开公式推导...\n留空则自动保留原文并丰富内容'} style={{ minHeight: 80, fontFamily: 'inherit' }} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleExpandPromptConfirm() } }} /></DiffBody><DiffActions><DiffBtn onClick={() => setExpandPromptDialog(null)}>取消</DiffBtn><DiffBtn $accept onClick={handleExpandPromptConfirm}>开始扩写</DiffBtn></DiffActions></FormulaPopover></> }
      {inlineRewrite && <><CtxMenuOverlay onClick={inlineRewrite.streaming ? undefined : () => setInlineRewrite(null)} /><DiffOverlay style={{ left: Math.min(inlineRewrite.posX, window.innerWidth - 700), top: Math.min(inlineRewrite.posY, window.innerHeight - 400) }}><DiffHeader><span>✏️ AI 重写 {inlineRewrite.streaming ? '— 生成中...' : '— 请选择'}</span>{inlineRewrite.streaming && <DiffBtn onClick={() => setInlineRewrite(null)}>⏹ 取消</DiffBtn>}</DiffHeader><DiffBody><DiffOld>{inlineRewrite.original}</DiffOld><DiffNew>{inlineRewrite.rewritten || '⏳ 正在生成...'}</DiffNew></DiffBody>{!inlineRewrite.streaming && inlineRewrite.rewritten && <DiffActions><DiffBtn onClick={() => setInlineRewrite(null)}>✕ 拒绝</DiffBtn><DiffBtn $accept onClick={handleAcceptRewrite}>✓ 接受</DiffBtn></DiffActions>}</DiffOverlay></>}
      {inlineExpand && <><CtxMenuOverlay onClick={inlineExpand.streaming ? undefined : () => setInlineExpand(null)} /><DiffOverlay style={{ left: expandOverlayDrag.pos.x, top: expandOverlayDrag.pos.y }}><DiffHeader onMouseDown={expandOverlayDrag.onHeaderMouseDown} style={{ cursor: 'move' }}><span>🔍 AI 扩写 {inlineExpand.streaming ? '— 生成中...' : '— 请选择'}</span>{inlineExpand.streaming && <DiffBtn onClick={() => setInlineExpand(null)}>⏹ 取消</DiffBtn>}</DiffHeader><DiffBody><DiffOld>{inlineExpand.original}</DiffOld><DiffNew>{inlineExpand.expanded || '⏳ 正在生成...'}</DiffNew></DiffBody>{!inlineExpand.streaming && inlineExpand.expanded && <DiffActions><DiffBtn onClick={() => setInlineExpand(null)}>✕ 拒绝</DiffBtn><DiffBtn $accept onClick={handleAcceptExpand}>✓ 接受</DiffBtn></DiffActions>}</DiffOverlay></>}
      {inlineRef && (
        <>
          <CtxMenuOverlay onClick={() => setInlineRef(null)} />
          <DiffOverlay style={{ left: Math.min(inlineRef.posX, window.innerWidth - 700), top: Math.min(inlineRef.posY, window.innerHeight - 400) }}>
            <DiffHeader>
              <span>📚 文献查找 {inlineRef.loading ? '— 搜索中...' : `— 找到 ${inlineRef.citations.length} 条`}</span>
              <DiffBtn onClick={() => setInlineRef(null)}>{inlineRef.loading ? '⏹ 取消' : '✕ 关闭'}</DiffBtn>
            </DiffHeader>
            <DiffBody>
              {inlineRef.loading ? <div style={{ textAlign: 'center', color: '#888', padding: 20 }}>⏳ 正在搜索文献...</div> : null}
              {!inlineRef.loading ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid #eef2f7' }}>
                    <div style={{ fontSize: 14, color: '#66788a' }}>已勾选 {inlineRef.selectedCitationKeys.length} / {inlineRef.citations.length} 篇</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <DiffBtn onClick={() => setInlineRef((prev) => prev ? { ...prev, selectedCitationKeys: prev.citations.map((citation) => buildCitationSelectionKey(citation)) } : prev)} style={{ padding: '4px 10px', fontSize: 14 }}>全选</DiffBtn>
                      <DiffBtn onClick={() => setInlineRef((prev) => prev ? { ...prev, selectedCitationKeys: [] } : prev)} style={{ padding: '4px 10px', fontSize: 14 }}>清空</DiffBtn>
                    </div>
                  </div>
                  {inlineRef.citations.map((citation, index) => {
                    const citationKey = buildCitationSelectionKey(citation)
                    const checked = inlineRef.selectedCitationKeys.includes(citationKey)
                    return (
                      <label
                        key={`${citationKey}-${index}`}
                        style={{ display: 'block', padding: '10px 0', borderBottom: index < inlineRef.citations.length - 1 ? '1px solid #eee' : 'none', cursor: 'pointer' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleInlineCitationSelection(citation)}
                            style={{ marginTop: 3 }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, color: '#333', marginBottom: 4 }}><strong>[{citation.number}]</strong> {citation.citation}</div>
                            {citation.abstract ? <div style={{ fontSize: 14, color: '#888', marginBottom: 4, maxHeight: 60, overflow: 'hidden' }}>{citation.abstract.slice(0, 200)}...</div> : null}
                          </div>
                        </div>
                      </label>
                    )
                  })}
                </>
              ) : null}
            </DiffBody>
            {!inlineRef.loading ? (
              <DiffActions>
                <DiffBtn onClick={() => setInlineRef(null)}>取消</DiffBtn>
                <DiffBtn $accept onClick={handleInsertSelectedCitations} disabled={inlineRef.selectedCitationKeys.length === 0}>插入已选引用</DiffBtn>
              </DiffActions>
            ) : null}
          </DiffOverlay>
        </>
      )}
      {formulaDialog && (
        <>
          <CtxMenuOverlay onClick={() => {
            formulaAiAbortRef.current?.abort()
            formulaAiAbortRef.current = null
            setFormulaDialog(null)
          }} />
          <FormulaPopover
            style={(() => {
              const position = resolveFloatingPanelPosition(formulaDialog.anchorX, formulaDialog.anchorY, 620, 520)
              return { left: position.left, top: position.top }
            })()}
          >
            <DiffHeader>
              <span>∑ {formulaDialog.editPos !== null ? '编辑公式' : '插入公式'}</span>
              <DiffBtn onClick={() => {
                formulaAiAbortRef.current?.abort()
                formulaAiAbortRef.current = null
                setFormulaDialog(null)
              }}
              >
                ✕ 关闭
              </DiffBtn>
            </DiffHeader>
            <DiffBody>
              <FormulaModeRow>
                <FormulaModeBtn
                  $active={formulaDialog.displayMode === 'inline'}
                  onClick={() => setFormulaDialog((prev) => prev ? { ...prev, displayMode: 'inline' } : prev)}
                >
                  行内公式
                </FormulaModeBtn>
                <FormulaModeBtn
                  $active={formulaDialog.displayMode === 'block'}
                  onClick={() => setFormulaDialog((prev) => prev ? { ...prev, displayMode: 'block' } : prev)}
                >
                  块公式
                </FormulaModeBtn>
              </FormulaModeRow>

              <FormulaSplitRow>
                <div>
                  <FormulaFieldLabel>自然语言转 LaTeX</FormulaFieldLabel>
                  <FormulaNaturalInput
                    value={formulaDialog.naturalText}
                    onChange={(e) => setFormulaDialog((prev) => prev ? { ...prev, naturalText: e.target.value } : prev)}
                    placeholder="例如：二次方程求根公式 / 高斯分布概率密度函数"
                    disabled={formulaDialog.converting}
                  />
                  <FormulaActionsRow>
                    <DiffBtn $accept onClick={() => void handleGenerateFormulaLatex()} disabled={formulaDialog.converting}>
                      {formulaDialog.converting ? '生成中...' : 'AI 转 LaTeX'}
                    </DiffBtn>
                    {formulaDialog.converting ? (
                      <DiffBtn
                        onClick={() => {
                          formulaAiAbortRef.current?.abort()
                          formulaAiAbortRef.current = null
                          setFormulaDialog((prev) => prev ? { ...prev, converting: false } : prev)
                        }}
                      >
                        取消生成
                      </DiffBtn>
                    ) : null}
                  </FormulaActionsRow>

                  <FormulaFieldLabel style={{ marginTop: 8 }}>常用模板</FormulaFieldLabel>
                  <FormulaTemplateGrid>
                    {FORMULA_TEMPLATES.map((item) => (
                      <FormulaTemplateBtn key={item.label} type="button" onClick={() => handleUseFormulaTemplate(item.latex)} title={item.latex}>
                        {item.label}
                      </FormulaTemplateBtn>
                    ))}
                  </FormulaTemplateGrid>
                </div>

                <div>
                  <FormulaFieldLabel>LaTeX 输入</FormulaFieldLabel>
                  <FormulaTextArea
                    ref={formulaInputRef}
                    value={formulaDialog.latex}
                    onChange={(e) => setFormulaDialog((prev) => prev ? { ...prev, latex: e.target.value } : prev)}
                    placeholder={'输入 LaTeX，例如：\\frac{a}{b} 或 E = mc^2'}
                  />
                  <FormulaFieldLabel style={{ marginTop: 8 }}>实时预览</FormulaFieldLabel>
                  <FormulaPreviewBox>
                    {formulaPreviewState.html
                      ? <div dangerouslySetInnerHTML={{ __html: formulaPreviewState.html }} />
                      : <FormulaTip style={{ marginTop: 0 }}>输入 LaTeX 后将在这里预览</FormulaTip>}
                  </FormulaPreviewBox>
                  {formulaPreviewState.error ? <FormulaPreviewError>语法提示：{formulaPreviewState.error}</FormulaPreviewError> : null}
                </div>
              </FormulaSplitRow>
              <FormulaTip>临时浮层会停靠在光标或公式附近。双击已有公式可就地编辑。</FormulaTip>
            </DiffBody>
            <DiffActions>
              <DiffBtn
                onClick={() => {
                  formulaAiAbortRef.current?.abort()
                  formulaAiAbortRef.current = null
                  setFormulaDialog(null)
                }}
              >
                取消
              </DiffBtn>
              <DiffBtn $accept onClick={applyFormula}>确定</DiffBtn>
            </DiffActions>
          </FormulaPopover>
        </>
      )}
      {headless ? generationComposerNode : null}
      <HeadlessEditorStage $headless={headless}>
        <TabBarContainer>
          {tabs.map((tab) => (
            <TabItem key={tab.id} $active={tab.id === activeTabId} onClick={() => switchTab(tab.id)}>
              <TabName $dirty={isTabDirty(tab.id)}>{tab.fileName.endsWith('.aidoc.json') ? tab.fileName.slice(0, -'.aidoc.json'.length) : tab.fileName}</TabName>
              <TabClose onClick={(event) => {
                event.stopPropagation()
                void handleCloseTabWithSessionGuard(tab.id)
              }}>
                ×
              </TabClose>
            </TabItem>
          ))}
          <TabNewBtn onClick={activeWorkspacePath ? () => void handleCreateWorkspaceDocument() : undefined} disabled={!activeWorkspacePath} title={activeWorkspacePath ? '新建文档' : '请先在左侧创建或打开工作区'}>+</TabNewBtn>
        </TabBarContainer>
        {tabs.length === 0 ? (
          <WelcomeScreen>
            <WelcomeInner>
              <WelcomeTitle>📄 AI-Office</WelcomeTitle>
              <WelcomeDesc>{activeWorkspacePath ? '新建一个文档，开始当前工作区的写作。' : '请在左侧创建工作区或打开已有工作区，开始写作。'}</WelcomeDesc>
              {activeWorkspacePath && (
                <WelcomeActionRow>
                  <WelcomeBtn onClick={() => void handleCreateWorkspaceDocument()}>+ 新建文档</WelcomeBtn>
                </WelcomeActionRow>
              )}
            </WelcomeInner>
          </WelcomeScreen>
        ) : activeTabPreview ? (
          <DocumentPreviewPane fileName={activeTab?.fileName || currentFileName} source={activeTabPreview.source} sourceDoc={activeTabPreview.kind === 'frame' ? activeTabPreview.sourceDoc : undefined} hint={activeTabPreview.hint} actionLabel={activeTabPreview.actionLabel} onOpenExternal={activeTabPreview.externalFilePath || activeTab?.filePath ? () => void openPreviewExternally() : undefined} />
        ) : (
          <>
            <Toolbar editor={editor} onSave={() => void handleSaveFile()} onExportPdf={() => void handleExportPdf()} onExportHtml={() => void handleExportHtml()} onExportWithJournalFormat={() => setShowJournalExportDialog(true)} onSaveToKnowledge={handleSaveToKnowledge} onGeneratePptFromDocument={handleOpenPptDialog} paperTemplateId={resolvedPaperTemplateId} onTemplateChange={handleTemplateChange} onPersistTemplate={persistTemplate} onInsertInlineFormula={() => openFormulaDialog('inline', '', null, resolveFormulaAnchor(null))} onInsertBlockFormula={() => openFormulaDialog('block', '', null, resolveFormulaAnchor(null))} onInsertLocalImage={() => void handleInsertLocalImage()} previewMode={activeSurfaceMode} onPreviewModeChange={handleSurfaceModeChange} canPreviewFinal={activeTabIsDocx} canUsePreviewDocumentActions={canUsePreviewDocumentActions} previewDocumentActionBusy={previewDocumentActionBusy} genNoImageMode={generationSettings.genNoImageMode} onToggleNoImageMode={handleToggleNoImageMode} isAidocFile={activeTabIsAidocJson} />
            {activeMailAttachmentSource ? (
              <MailAttachmentSourceBanner>
                <MailAttachmentSourceBadge>来自邮件附件</MailAttachmentSourceBadge>
                <MailAttachmentSourceItem title={activeMailAttachmentSource.subject}>原邮件：{activeMailAttachmentSource.subject}</MailAttachmentSourceItem>
                <MailAttachmentSourceItem title={`${activeMailAttachmentSource.fromName} <${activeMailAttachmentSource.fromEmail}>`}>发件人：{activeMailAttachmentSource.fromName}</MailAttachmentSourceItem>
                <MailAttachmentSourceItem title={activeMailAttachmentSource.originalAttachmentName}>附件：{activeMailAttachmentSource.originalAttachmentName}</MailAttachmentSourceItem>
              </MailAttachmentSourceBanner>
            ) : null}
            {!isReadonlyDocPreviewMode ? (
              <EditorDocumentMetricsBar title="字数含正文与公式 LaTeX。页数按编辑区 A4 高度估算，与 Word 实际分页可能略有差异。">
                <span>全文 {docTextStats.totalChars.toLocaleString('zh-CN')} 字</span>
                {docTextStats.latinWords > 0 ? <span>· 英文词约 {docTextStats.latinWords.toLocaleString('zh-CN')}</span> : null}
                <span>· 约 {pageEstimate.totalPages} 页</span>
                <span>· 当前约第 {pageEstimate.currentPage} 页</span>
              </EditorDocumentMetricsBar>
            ) : null}
            {continueStreamState.phase !== 'idle' ? (
              <ContinueStreamBanner>
                <ContinueStreamSummary>
                  <ContinueStreamBadge $phase={continueStreamState.phase}>
                    {continueStreamState.phase === 'running' ? '续写中' : continueStreamState.phase === 'completed' ? '已完成' : continueStreamState.phase === 'stopped' ? '已停止' : '失败'}
                  </ContinueStreamBadge>
                  <ContinueStreamText>
                    {continueStreamState.message || '续写任务状态'}
                    {continueStreamState.insertedChars > 0 ? ` · 已插入 ${continueStreamState.insertedChars} 字` : ''}
                  </ContinueStreamText>
                </ContinueStreamSummary>
                <ContinueStreamActions>
                  {continueStreamState.phase === 'running' ? (
                    <ContinueStreamBtn $danger onClick={() => stopInlineContinue('已手动停止续写')}>停止续写</ContinueStreamBtn>
                  ) : (
                    <ContinueStreamBtn onClick={() => setContinueStreamState({ phase: 'idle', message: '', insertedChars: 0 })}>关闭</ContinueStreamBtn>
                  )}
                </ContinueStreamActions>
              </ContinueStreamBanner>
            ) : null}
            {showDocxMigrationBanner ? (
              <DocxMigrationBanner>
                <DocxMigrationText>此文档为旧版 .docx 格式，每次保存可能丢失格式。建议转换为内部格式以完整保留格式。</DocxMigrationText>
                <DocxMigrationBtn onClick={() => void handleMigrateDocxToAidoc()}>一键转换</DocxMigrationBtn>
                <DocxMigrationDismiss onClick={() => setShowDocxMigrationBanner(false)} title="关闭提示">×</DocxMigrationDismiss>
              </DocxMigrationBanner>
            ) : null}
            <EditorScrollArea
              ref={editorScrollRef}
              onWheel={handleEditorWheel}
              onScroll={handleEditorScroll}
              onContextMenu={(event) => {
                if (isReadonlyDocPreviewMode) return
                if (!editor || composerRunning || isGenerating) return
                event.preventDefault()
                const imageTarget = resolveImageContextTarget(event.target)
                if (imageTarget) {
                  const commands = editor.commands as unknown as { setNodeSelection?: (pos: number) => boolean }
                  commands.setNodeSelection?.(imageTarget.pos)
                  refreshActiveImageOverlay(imageTarget.pos)
                  setCtxMenu({ kind: 'image', x: event.clientX, y: event.clientY, image: imageTarget })
                  return
                }
                const selection = currentRuntime.getSelection() || { from: 0, to: 0, text: '', collapsed: true }
                setCtxMenu({ kind: selection.text ? 'text' : 'general', x: event.clientX, y: event.clientY, text: selection.text, from: selection.from, to: selection.to, anchorId: selection.anchorId })
              }}
            >
              {isReadonlyDocPreviewMode ? (
                <>
                  <PreviewModeNotice>
                    {dirty ? '当前为成文预览模式，展示的是最近一次保存后的 DOCX 版式结果。若已修改正文，请先保存再刷新预览。' : '当前为成文预览模式，按 DOCX 的 section、页边距、页眉页脚和分页结果进行只读展示。'}
                  </PreviewModeNotice>
                  <ReadonlyDocumentPreview preview={documentPreview} idleMessage="当前标签页还没有可用于成文预览的 DOCX 文件。" loadingMessage="正在读取 DOCX 成文预览..." />
                </>
              ) : (
                <EditorPage ref={editorPageShellRef} $templateId={resolvedPaperTemplateId} style={activeEditorPageStyle}>
                  {showPageWatermark && activeShell?.watermarkText ? <PageWatermarkPreview>{activeShell.watermarkText}</PageWatermarkPreview> : null}
                  {showPageHeader ? <PageHeaderPreview>{activeShell?.headerText || ''}</PageHeaderPreview> : null}
                  <EditorContent editor={editor} />
                  {composerRunning && !composerPaused && shadowText && activeTabId === composerTargetTabId ? <ShadowLayer>{shadowText}</ShadowLayer> : null}
                  {showPageFooter ? <PageFooterPreview>{activeShell?.footerText || ''}</PageFooterPreview> : null}
                </EditorPage>
              )}
            </EditorScrollArea>
            {!headless ? generationComposerNode : null}
          </>
        )}
      </HeadlessEditorStage>
      {pptPromptDialogOpen && (
        <PptDialogOverlay onClick={() => setPptPromptDialogOpen(false)}>
          <PptDialogBox onClick={(e) => e.stopPropagation()}>
            <PptDialogTitle>基于当前文稿生成 PPT</PptDialogTitle>
            <PptDialogHint>请输入或修改提示词，描述你期望的 PPT 风格与内容重点。</PptDialogHint>
            <PptDialogTextarea
              value={pptPromptDraft}
              onChange={(e) => setPptPromptDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handlePptPromptConfirm() } }}
              placeholder="例如：请生成一份简洁的汇报型 PPT，突出数据和结论..."
              autoFocus
            />
            <PptDialogActions>
              <PptDialogBtn type="button" onClick={() => setPptPromptDialogOpen(false)}>取消</PptDialogBtn>
              <PptDialogBtn type="button" $primary disabled={!pptPromptDraft.trim()} onClick={handlePptPromptConfirm}>开始生成</PptDialogBtn>
            </PptDialogActions>
          </PptDialogBox>
        </PptDialogOverlay>
      )}
      {showJournalExportDialog && (
        <ExportJournalDialog
          onConfirm={(config) => void handleJournalExportConfirm(config)}
          onCancel={() => setShowJournalExportDialog(false)}
        />
      )}
    </EditorWrapper>
  )
}

export default EditorPanel
