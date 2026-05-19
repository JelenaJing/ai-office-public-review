import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'
import katex from 'katex'
import { useDocument } from '../contexts/DocumentContext'
import { useKnowledge } from '../contexts/KnowledgeContext'
import { useWorkspace } from '../contexts/WorkspaceContext'
import { useLanguage } from '../contexts/LanguageContext'
import { createEmbeddedOfficeRuntime } from '../engines/documentEngine/embeddedOfficeAdapter'
import type { DocumentEngineLoadRequest, DocumentEngineSaveRequest, DocumentEngineSaveResult, DocumentEngineSelection, DocumentEngineTextEditPayload } from '../engines/documentEngine/contracts'
import { useBindDocumentEngineRuntime } from '../engines/documentEngine/runtime'
import { useDocumentEngineHostCommands } from '../engines/documentEngine/hostCommands'
import { decodeEmbeddedDocumentPayload, type EmbeddedFootnoteItem, type EmbeddedPayloadBlock, type EmbeddedReferenceListItem } from '../engines/documentEngine/embeddedPaperDocument'
import { getAIToolSettings } from '../utils/aiToolSettings'
import DocumentPreviewPane from '../modules/writing/components/DocumentPreviewPane'
import GenerationComposer from '../modules/generation/components/GenerationComposer'
import { runWritingAssistant } from '../modules/writing/services/WritingAssistantService'
import { resolveStructuredRemakeContextFromBlocks, type StructuredRemakeContext } from '../modules/writing/services/sectionAwareRemake'
import { findCitationForText, INLINE_CITATION_MAX_RESULTS, type CitationItem } from '../services/ReferenceService'
import { continueWriting } from '../modules/writing/services/ContinueWritingService'
import { isDirectMode, directContinueWriting } from '../services/AIClientFactory'
import { generateSelectionImage, getDefaultInsertedGeneratedImageWidthPx } from '../modules/image/services/ImageService'
import { buildCitationRenumberPlan, CitationReferenceItem, formatCitationNumbers, insertCitationMarkerAtSelection, parseLeadingCitationNumber, stripLeadingCitationPrefix, updateCitationNumbersInText } from '../utils/citationGroups'
import { insertCitationIntoDocument, renumberDocumentCitations, renderBibliographyItemLabel } from '../utils/documentCitations'
import type { DocumentSchema, DocumentResource, DocumentBibliographyItem } from '../document/schema/index'
import { normalizeContinueDeltaAtStart, normalizeContinueLeadingText } from '../utils/continueStreamText'
import type { KnowledgeTaskConstraints, PreviewKnowledgeTaskContextResult } from '../types/knowledge'
import { buildKnowledgeTaskConstraints, resolveKnowledgeTaskPreview } from '../shared/knowledge/knowledgeTaskHelper'

const Root = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #1e1e1e;
  overflow: hidden;
`

const INLINE_REWRITE_SEMANTIC_GUARD = '【核心要求】只对当前选中段落做改写，必须严格保持原文核心语义、事实判断、结论、立场与信息边界不变；只优化表达方式、清晰度、连贯性和措辞，不得扩写新观点，不得删改关键信息，不得改变原段落想表达的整体意思。'

function buildInlineRewriteKnowledgeContext(
  preview: PreviewKnowledgeTaskContextResult | null,
  _constraints: KnowledgeTaskConstraints,
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

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  background: #252526;
  border-bottom: 1px solid #333;
`

const HeaderInfo = styled.div`
  min-width: 0;
`

const Title = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: #f3f4f6;
`

const Meta = styled.div`
  margin-top: 4px;
  font-size: var(--font-size-xs);
  color: #9ca3af;
`

const Actions = styled.div`
  display: flex;
  gap: 8px;
`

const ActionButton = styled.button`
  border: 1px solid #3f3f46;
  background: #2f3136;
  color: #e5e7eb;
  border-radius: 6px;
  padding: 7px 14px;
  font-size: var(--font-size-xs);
  cursor: pointer;

  &:hover {
    background: #3a3d42;
  }
`

const AiToolbar = styled.div`
  margin-top: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`
const ContinueStatusBar = styled.div`
  margin-top: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid #d8e4ef;
  border-radius: 12px;
  background: linear-gradient(180deg, #f8fbff 0%, #eef5ff 100%);
`
const ContinueStatusSummary = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex-wrap: wrap;
`
const ContinueStatusBadge = styled.span<{ $phase: 'running' | 'completed' | 'stopped' | 'error' }>`
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: var(--font-size-xs);
  font-weight: 700;
  border: 1px solid ${({ $phase }) => ($phase === 'running' ? '#c9dcff' : $phase === 'completed' ? '#cde8d5' : $phase === 'error' ? '#f0caca' : '#e5d8b7')};
  background: ${({ $phase }) => ($phase === 'running' ? '#eaf2ff' : $phase === 'completed' ? '#eefbf2' : $phase === 'error' ? '#fff2f2' : '#fff8e8')};
  color: ${({ $phase }) => ($phase === 'running' ? '#295aa8' : $phase === 'completed' ? '#1f6c3f' : $phase === 'error' ? '#b33838' : '#8a5b00')};
`
const ContinueStatusText = styled.span`
  min-width: 0;
  font-size: var(--font-size-xs);
  color: #4b5563;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`
const ContinueStatusBtn = styled.button<{ $danger?: boolean }>`
  border: 1px solid ${({ $danger }) => ($danger ? '#e7bcbc' : '#cbd5e1')};
  background: ${({ $danger }) => ($danger ? '#fff4f4' : '#ffffff')};
  color: ${({ $danger }) => ($danger ? '#b33838' : '#334155')};
  border-radius: 999px;
  padding: 6px 12px;
  font-size: var(--font-size-xs);
  cursor: pointer;
`

const AiActionButton = styled.button<{ $primary?: boolean }>`
  border: 1px solid ${({ $primary }) => ($primary ? '#4f46e5' : '#cbd5e1')};
  background: ${({ $primary }) => ($primary ? '#eef2ff' : '#ffffff')};
  color: ${({ $primary }) => ($primary ? '#3730a3' : '#334155')};
  border-radius: 999px;
  padding: 6px 12px;
  font-size: var(--font-size-xs);
  cursor: pointer;

  &:hover {
    background: ${({ $primary }) => ($primary ? '#e0e7ff' : '#f8fafc')};
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`

const CtxMenuOverlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 998;
`

const CtxMenu = styled.div`
  position: fixed;
  z-index: 999;
  min-width: 220px;
  padding: 4px 0;
  border-radius: 8px;
  background: #252526;
  border: 1px solid #3f3f46;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.32);
`

const CtxMenuItem = styled.div`
  padding: 7px 16px;
  font-size: var(--font-size-sm);
  color: #d1d5db;
  cursor: pointer;

  &:hover {
    background: #094771;
    color: #ffffff;
  }
`

const CtxMenuDivider = styled.div`
  height: 1px;
  margin: 4px 0;
  background: #3f3f46;
`

const CtxMenuLabel = styled.div`
  padding: 5px 16px;
  font-size: var(--font-size-xs);
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.06em;
`

const Body = styled.div`
  flex: 1;
  overflow: auto;
  padding: 24px;
  background: linear-gradient(180deg, #1e1e1e 0%, #161616 100%);
`

const Page = styled.div`
  width: min(920px, 100%);
  min-height: 100%;
  margin: 0 auto;
  padding: 56px 72px;
  background: #fff;
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.28);
  border-radius: 8px;
`

const PageTopChrome = styled.div`
  margin: -36px -36px 28px;
  padding: 0 8px 14px;
  border-bottom: 1px solid #e2e8f0;
`

const HorizontalRuler = styled.div`
  position: relative;
  height: 22px;
  border-radius: 999px;
  background: linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%);
  border: 1px solid #dbe4ee;
  overflow: hidden;
`

const RulerTick = styled.div<{ $left: number; $major?: boolean }>`
  position: absolute;
  left: ${({ $left }) => `${$left}%`};
  top: 0;
  width: 1px;
  height: ${({ $major }) => ($major ? '100%' : '55%')};
  background: ${({ $major }) => ($major ? '#64748b' : '#94a3b8')};
`

const RulerLabel = styled.div<{ $left: number }>`
  position: absolute;
  left: ${({ $left }) => `${$left}%`};
  top: 2px;
  transform: translateX(-50%);
  font-size: var(--font-size-xs);
  color: #64748b;
`

const PageStatusStrip = styled.div`
  margin-top: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  font-size: var(--font-size-xs);
  color: #64748b;
`

const DocumentFormatBar = styled.div`
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
`

const DocumentFormatMeta = styled.div`
  margin-right: 4px;
  font-size: var(--font-size-xs);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #64748b;
`

const BlockList = styled.div`
  display: block;
`

const TextBlockCard = styled.div<{ $active: boolean }>`
  position: relative;
  margin: 0;
  padding: 0;

  &::before {
    content: '';
    position: absolute;
    left: -18px;
    top: 8px;
    bottom: 8px;
    width: 3px;
    border-radius: 999px;
    background: ${({ $active }) => ($active ? '#93c5fd' : 'transparent')};
    transition: background 120ms ease;
  }
`

const TextBlockHeader = styled.div<{ $active: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: ${({ $active }) => ($active ? '6px 2px 4px' : '0 2px')};
  max-height: ${({ $active }) => ($active ? '24px' : '0')};
  opacity: ${({ $active }) => ($active ? 1 : 0)};
  overflow: hidden;
  transition: max-height 120ms ease, opacity 120ms ease, padding 120ms ease;
`

const TextBlockLabel = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #64748b;
  text-transform: uppercase;
`

const TextBlockMeta = styled.div`
  font-size: var(--font-size-xs);
  color: #94a3b8;
`

const TextBlockControls = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`

const CompactSelect = styled.select`
  height: 28px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 0 8px;
  font-size: var(--font-size-xs);
  color: #334155;
  background: #ffffff;
`

const CompactButton = styled.button`
  height: 28px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 0 9px;
  font-size: var(--font-size-xs);
  background: #ffffff;
  color: #334155;
  cursor: pointer;

  &:hover {
    background: #f8fafc;
  }
`

const TextBlockEditor = styled.textarea`
  width: 100%;
  min-height: 44px;
  border: none;
  outline: none;
  resize: none;
  overflow: hidden;
  padding: 6px 0;
  font-size: 15px;
  line-height: 1.9;
  color: #111827;
  background: transparent;
  font-family: 'Noto Serif SC', 'Source Han Serif SC', 'STSong', serif;
`

const Hint = styled.div`
  margin-top: 12px;
  font-size: var(--font-size-xs);
  color: #6b7280;
  line-height: 1.7;
`

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.18);
  z-index: 999;
`

const FloatingPanel = styled.div`
  position: fixed;
  z-index: 1000;
  background: #ffffff;
  border: 1px solid #dbe4ee;
  border-radius: 10px;
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.22);
  width: min(720px, calc(100vw - 48px));
`

const FloatingHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid #e2e8f0;
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: #334155;
  background: #f8fafc;
`

const FloatingBody = styled.div`
  padding: 14px;
  max-height: min(420px, 60vh);
  overflow-y: auto;
`

const FloatingActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 14px;
  border-top: 1px solid #e2e8f0;
  background: #f8fafc;
`

const FloatingButton = styled.button<{ $primary?: boolean }>`
  border: 1px solid ${({ $primary }) => ($primary ? '#2563eb' : '#cbd5e1')};
  background: ${({ $primary }) => ($primary ? '#2563eb' : '#ffffff')};
  color: ${({ $primary }) => ($primary ? '#ffffff' : '#334155')};
  border-radius: 8px;
  padding: 7px 14px;
  font-size: var(--font-size-xs);
  cursor: pointer;
`

const RewriteOld = styled.div`
  background: #fff1f2;
  color: #9f1239;
  padding: 8px 10px;
  border-radius: 8px;
  white-space: pre-wrap;
  word-break: break-word;
  text-decoration: line-through;
`

const RewriteNew = styled.div`
  margin-top: 10px;
  background: #f0fdf4;
  color: #166534;
  padding: 8px 10px;
  border-radius: 8px;
  white-space: pre-wrap;
  word-break: break-word;
`

const CitationRow = styled.div`
  padding: 10px 0;
  border-bottom: 1px solid #e2e8f0;
`

const CitationTitle = styled.div`
  font-size: var(--font-size-sm);
  color: #0f172a;
  line-height: 1.6;
`

const CitationAbstract = styled.div`
  margin-top: 4px;
  font-size: var(--font-size-xs);
  color: #64748b;
  line-height: 1.6;
`

type ComposerMode = 'document'

interface ComposerSelectionState {
  text: string
  from: number
  to: number
  anchorId?: string
}

interface EmbeddedCtxMenuState {
  x: number
  y: number
  selection: ComposerSelectionState | null
}

const ObjectCardList = styled.div`
  display: grid;
  gap: 12px;
`

const ObjectCard = styled.div<{ $active: boolean }>`
  position: relative;
  border: 1px solid ${({ $active }) => ($active ? '#bfdbfe' : '#e5e7eb')};
  border-radius: 12px;
  padding: 14px 16px;
  background: ${({ $active }) => ($active ? '#f8fbff' : '#fcfdff')};
  box-shadow: ${({ $active }) => ($active ? '0 0 0 3px rgba(191, 219, 254, 0.45)' : 'none')};
  transition: border-color 120ms ease, background 120ms ease, box-shadow 120ms ease;
`

const ObjectCardActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
`

const SecondaryButton = styled.button`
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #0f172a;
  border-radius: 8px;
  padding: 7px 12px;
  font-size: var(--font-size-xs);
  cursor: pointer;

  &:hover {
    background: #f8fafc;
  }
`

const PreviewLabel = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #64748b;
  text-transform: uppercase;
`

const ObjectToolbar = styled.div<{ $active: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: ${({ $active }) => ($active ? '10px' : '0')};
  max-height: ${({ $active }) => ($active ? '32px' : '0')};
  opacity: ${({ $active }) => ($active ? 1 : 0)};
  overflow: hidden;
  transition: max-height 120ms ease, opacity 120ms ease, margin-bottom 120ms ease;
`

const FlowDivider = styled.div`
  margin: 10px 0 0;
  height: 1px;
  background: linear-gradient(90deg, transparent 0%, #e2e8f0 18%, #e2e8f0 82%, transparent 100%);
`

const PreviewTitle = styled.div`
  margin-top: 6px;
  font-size: 14px;
  color: #0f172a;
  font-weight: 600;
`

const PreviewMeta = styled.div`
  margin-top: 6px;
  font-size: var(--font-size-xs);
  color: #475569;
  line-height: 1.6;
`

const PreviewImage = styled.img`
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 10px;
  border: 1px solid #cbd5e1;
  background: #fff;
  object-fit: contain;
`

const ImageStage = styled.div`
  position: relative;
  margin-top: 10px;
  display: inline-flex;
  max-width: min(420px, 100%);
  max-height: 320px;
  border-radius: 12px;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  overflow: visible;
`

const ResizeHandle = styled.button<{ $position: 'nw' | 'ne' | 'sw' | 'se' }>`
  position: absolute;
  width: 14px;
  height: 14px;
  border: 2px solid #ffffff;
  border-radius: 999px;
  background: #2563eb;
  box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.35);
  cursor: ${({ $position }) => ($position === 'nw' || $position === 'se' ? 'nwse-resize' : 'nesw-resize')};
  z-index: 2;

  ${({ $position }) => $position === 'nw' ? 'top: -7px; left: -7px;' : ''}
  ${({ $position }) => $position === 'ne' ? 'top: -7px; right: -7px;' : ''}
  ${({ $position }) => $position === 'sw' ? 'bottom: -7px; left: -7px;' : ''}
  ${({ $position }) => $position === 'se' ? 'bottom: -7px; right: -7px;' : ''}
`

const ImageDropZone = styled.div<{ $active: boolean }>`
  margin-top: 12px;
  border: 1px dashed ${({ $active }) => ($active ? '#2563eb' : '#94a3b8')};
  background: ${({ $active }) => ($active ? '#eff6ff' : '#ffffff')};
  color: #334155;
  border-radius: 10px;
  padding: 12px;
  font-size: var(--font-size-xs);
  line-height: 1.6;
  transition: border-color 120ms ease, background 120ms ease;
`

const FormulaPreview = styled.div`
  margin-top: 10px;
  overflow-x: auto;
  padding: 10px 12px;
  border-radius: 10px;
  background: #fff;
  border: 1px solid #cbd5e1;
`

const FieldGrid = styled.div`
  margin-top: 12px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 12px;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`

const InspectorSection = styled.div<{ $active: boolean }>`
  max-height: ${({ $active }) => ($active ? '2400px' : '0')};
  opacity: ${({ $active }) => ($active ? 1 : 0)};
  overflow: hidden;
  transition: max-height 160ms ease, opacity 120ms ease;
`

const Field = styled.label`
  display: grid;
  gap: 6px;
`

const FieldLabel = styled.span`
  font-size: var(--font-size-xs);
  font-weight: 700;
  letter-spacing: 0.06em;
  color: #64748b;
  text-transform: uppercase;
`

const FieldInput = styled.input`
  height: 36px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 0 10px;
  font-size: var(--font-size-sm);
  color: #0f172a;
  background: #ffffff;
`

const FieldSelect = styled.select`
  height: 36px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 0 10px;
  font-size: var(--font-size-sm);
  color: #0f172a;
  background: #ffffff;
`

const FieldTextArea = styled.textarea`
  min-height: 96px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 10px;
  font-size: var(--font-size-sm);
  line-height: 1.6;
  color: #0f172a;
  background: #ffffff;
  resize: vertical;
`

const TablePreview = styled.div`
  margin-top: 12px;
  overflow: auto;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  background: #ffffff;

  table {
    width: 100%;
    border-collapse: collapse;
  }

  td,
  th {
    border: 1px solid #cbd5e1;
    padding: 8px 10px;
    font-size: var(--font-size-sm);
    color: #0f172a;
  }
`

const TableEditor = styled.div`
  margin-top: 12px;
  display: grid;
  gap: 12px;
`

const TableRowCard = styled.div`
  border: 1px solid #dbe4ee;
  border-radius: 10px;
  background: #ffffff;
  padding: 12px;
`

const TableRowHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
`

const TableRowTitle = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 700;
  letter-spacing: 0.06em;
  color: #64748b;
  text-transform: uppercase;
`

const TableCellList = styled.div`
  display: grid;
  gap: 10px;
`

const TableCellCard = styled.div`
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 10px;
  background: #f8fafc;
`

const TableCellMeta = styled.div`
  font-size: var(--font-size-xs);
  color: #475569;
`

const TableSelectionPanel = styled.div`
  margin-top: 12px;
  border: 1px solid #dbe4ee;
  border-radius: 12px;
  background: #ffffff;
  padding: 12px;
`

const SelectionGrid = styled.table`
  width: 100%;
  border-collapse: collapse;

  td,
  th {
    border: 1px solid #cbd5e1;
    padding: 0;
    vertical-align: top;
  }
`

const SelectionCellButton = styled.button<{ $selected: boolean; $anchor: boolean }>`
  display: block;
  width: 100%;
  min-height: 64px;
  padding: 8px 10px;
  border: none;
  background: ${({ $selected, $anchor }) => ($selected ? '#dbeafe' : ($anchor ? '#f8fafc' : '#ffffff'))};
  color: #0f172a;
  text-align: left;
  cursor: pointer;

  &:hover {
    background: ${({ $selected }) => ($selected ? '#bfdbfe' : '#f1f5f9')};
  }
`

const SelectionCellText = styled.div`
  font-size: var(--font-size-xs);
  line-height: 1.5;
  color: #334155;
`

const SelectionCellMeta = styled.div`
  margin-top: 4px;
  font-size: var(--font-size-xs);
  color: #64748b;
`

type TableGridSlot = {
  anchorRow: number
  anchorCol: number
  cell: EmbeddedTableCell
  isAnchor: boolean
}

type TableAnchorCell = EmbeddedTableCell & {
  anchorRow: number
  anchorCol: number
}

type TableSelection = {
  startRow: number
  startCol: number
  endRow: number
  endCol: number
}

type ImageResizeHandlePosition = 'nw' | 'ne' | 'sw' | 'se'

type ImageResizeState = {
  blockId: string
  handle: ImageResizeHandlePosition
  startClientX: number
  startClientY: number
  startWidth: number
  startHeight: number
  aspectRatio: number | null
  keepAspect: boolean
}

type EmbeddedImageBlock = {
  id: string
  type: 'image'
  alt: string
  title?: string
  caption?: string
  paperGenerated?: boolean
  sourceId?: string
  sourceXml?: string
  relationshipId?: string
  mediaPath?: string
  mediaContentType?: string
  previewSrc?: string
  drawingLayout?: 'inline' | 'anchor'
  imageWidthPx?: number
  imageHeightPx?: number
  anchorHorizontal?: string
  anchorVertical?: string
  wrapType?: string
}

type EmbeddedFormulaBlock = {
  id: string
  type: 'formula'
  latex: string
  display: 'inline' | 'block'
  sourceId?: string
  sourceXml?: string
  mathml?: string
}

type EmbeddedTextBlock = {
  id: string
  type: 'paragraph' | 'heading'
  text: string
  level?: number
  paragraphStyle?: string
  paperStyle?: string
  alignment?: 'left' | 'center' | 'right' | 'justify'
  indentLevel?: number
  listType?: 'bullet' | 'number'
  listLevel?: number
  sourceXml?: string
}

type EmbeddedTableParagraph = {
  text: string
  level?: number
  style?: string
}

type EmbeddedTableCell = {
  text: string
  paragraphs: EmbeddedTableParagraph[]
  colspan: number
  rowspan: number
  header?: boolean
  width?: string
  column: number
}

type EmbeddedTableBlock = {
  id: string
  type: 'table'
  rows: number
  cols: number
  tableRows: EmbeddedTableCell[][]
}

type EmbeddedEditorBlock = EmbeddedTextBlock | EmbeddedImageBlock | EmbeddedFormulaBlock | EmbeddedTableBlock
type WriteOoxmlBlock = NonNullable<Parameters<Window['electronAPI']['writeOoxmlPackage']>[1]['blocks']>[number]

function isEmbeddedTextBlock(block: EmbeddedEditorBlock): block is EmbeddedTextBlock {
  return block.type === 'paragraph' || block.type === 'heading'
}

function isEmbeddedTableBlock(block: EmbeddedEditorBlock): block is EmbeddedTableBlock {
  return block.type === 'table'
}

let blockSequence = 0

function createBlockId(prefix: string): string {
  blockSequence += 1
  return `${prefix}-${blockSequence}`
}

function decodeHtmlText(value: string): string {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function getAttr(source: string, name: string): string | null {
  const doubleQuoted = source.match(new RegExp(`${name}="([^"]*)"`, 'i'))?.[1]
  if (doubleQuoted != null) return decodeHtmlText(doubleQuoted)
  const singleQuoted = source.match(new RegExp(`${name}='([^']*)'`, 'i'))?.[1]
  if (singleQuoted != null) return decodeHtmlText(singleQuoted)
  return null
}

function parsePaperStyle(style: string | null | undefined): Record<string, string> {
  const styleMap: Record<string, string> = {}
  for (const chunk of String(style || '').split(';')) {
    const [rawKey, ...rawValueParts] = chunk.split(':')
    const key = String(rawKey || '').trim().toLowerCase()
    const value = rawValueParts.join(':').trim()
    if (key && value) styleMap[key] = value
  }
  return styleMap
}

function stringifyPaperStyle(styleMap: Record<string, string>): string | undefined {
  const entries = Object.entries(styleMap)
    .map(([key, value]) => [key.trim().toLowerCase(), String(value || '').trim()] as const)
    .filter(([, value]) => Boolean(value))
  if (!entries.length) return undefined
  return entries.map(([key, value]) => `${key}: ${value}`).join('; ')
}

function readPaperStyle(fragment: string): string | undefined {
  return stringifyPaperStyle(parsePaperStyle(getAttr(fragment, 'data-paper-style') || getAttr(fragment, 'style')))
}

function updatePaperStyle(style: string | undefined, updates: Record<string, string | null | undefined>): string | undefined {
  const nextStyleMap = parsePaperStyle(style)
  Object.entries(updates).forEach(([key, value]) => {
    const normalizedKey = key.trim().toLowerCase()
    const normalizedValue = String(value || '').trim()
    if (!normalizedValue) {
      delete nextStyleMap[normalizedKey]
      return
    }
    nextStyleMap[normalizedKey] = normalizedValue
  })
  return stringifyPaperStyle(nextStyleMap)
}

function getPaperStyleValue(block: EmbeddedTextBlock | null | undefined, key: string): string {
  if (!block?.paperStyle) return ''
  return parsePaperStyle(block.paperStyle)[key.trim().toLowerCase()] || ''
}

function buildPaperStyleAttributes(paperStyle?: string): string {
  if (!paperStyle) return ''
  return ` data-paper-style="${escapeAttr(paperStyle)}" style="${escapeAttr(paperStyle)}"`
}

function stripHtml(source: string): string {
  return decodeHtmlText(
    String(source || '')
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' '),
  ).replace(/\r/g, '')
}

function normalizeWrapTypeForEditor(value: string | null): string | undefined {
  const mapping: Record<string, string> = {
    wrapSquare: 'square',
    wrapTight: 'tight',
    wrapTopAndBottom: 'topAndBottom',
    wrapThrough: 'through',
    wrapNone: 'none',
  }
  if (!value) return undefined
  return mapping[value] || value
}

function buildTableCellText(paragraphs: EmbeddedTableParagraph[]): string {
  return paragraphs.map((paragraph) => paragraph.text).filter(Boolean).join('\n').trim()
}

function tableParagraphsToEditorText(paragraphs: EmbeddedTableParagraph[] | undefined): string {
  const normalizedParagraphs = paragraphs?.length ? paragraphs : [{ text: '' }]
  return normalizedParagraphs.map((paragraph) => {
    if (paragraph.level) {
      return `${'#'.repeat(Math.max(1, Math.min(paragraph.level, 6)))} ${paragraph.text}`.trim()
    }
    return paragraph.text
  }).join('\n\n')
}

function parseEditorTextToTableParagraphs(value: string): EmbeddedTableParagraph[] {
  const chunks = String(value || '')
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter((chunk, index, list) => chunk.length > 0 || (list.length === 1 && index === 0))

  if (!chunks.length) return [{ text: '' }]
  return chunks.map((chunk) => {
    const headingMatch = chunk.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      return {
        text: headingMatch[2].trim(),
        level: headingMatch[1].length,
        style: `Heading${headingMatch[1].length}`,
      }
    }
    return { text: chunk }
  })
}

function decodeStructuredData<T>(source: string | null): T | null {
  if (!source) return null
  try {
    return JSON.parse(decodeHtmlText(source)) as T
  } catch {
    return null
  }
}

function encodeStructuredData(value: unknown): string {
  return escapeAttr(JSON.stringify(value))
}

function normalizeTableRowsForEditor(tableRows: EmbeddedTableCell[][] | undefined, fallbackRows = 1, fallbackCols = 1): EmbeddedTableCell[][] {
  if (tableRows?.length) {
    return tableRows.map((row) => {
      let column = 0
      return row.map((cell) => {
        const paragraphs = cell.paragraphs?.length ? cell.paragraphs : [{ text: cell.text || '' }]
        const normalizedCell: EmbeddedTableCell = {
          ...cell,
          text: cell.text || buildTableCellText(paragraphs),
          paragraphs,
          colspan: Math.max(1, cell.colspan || 1),
          rowspan: Math.max(1, cell.rowspan || 1),
          column,
        }
        column += normalizedCell.colspan
        return normalizedCell
      })
    })
  }

  return Array.from({ length: Math.max(1, fallbackRows) }, () => {
    let column = 0
    return Array.from({ length: Math.max(1, fallbackCols) }, () => {
      const cell: EmbeddedTableCell = {
        text: '',
        paragraphs: [{ text: '' }],
        colspan: 1,
        rowspan: 1,
        column,
      }
      column += 1
      return cell
    })
  })
}

function parseHtmlCellParagraphs(innerHtml: string): EmbeddedTableParagraph[] {
  const tokens = Array.from(String(innerHtml || '').matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>|<p\b[^>]*>([\s\S]*?)<\/p>/gi))
  if (!tokens.length) {
    return [{ text: stripHtml(innerHtml).trim() }]
  }

  return tokens.map((token) => {
    if (token[1]) {
      return { text: stripHtml(token[2]).trim(), level: Number(token[1]), style: `Heading${token[1]}` }
    }
    return { text: stripHtml(token[3]).trim() }
  })
}

function parseHtmlTableToRows(fragment: string): { rows: number; cols: number; tableRows: EmbeddedTableCell[][] } {
  const rowMatches = Array.from(String(fragment || '').matchAll(/<tr\b[\s\S]*?<\/tr>/gi))
  const activeRowSpans: number[] = []
  const tableRows = rowMatches.length ? rowMatches.map((rowMatch) => {
    const row: EmbeddedTableCell[] = []
    const cellMatches = Array.from(rowMatch[0].matchAll(/<(t[hd])\b([^>]*)>([\s\S]*?)<\/t[hd]>/gi))
    const newSpanColumns = new Set<number>()
    let column = 0

    for (const cellMatch of cellMatches) {
      while ((activeRowSpans[column] || 0) > 0) {
        column += 1
      }

      const tag = String(cellMatch[1] || 'td').toLowerCase()
      const attrs = cellMatch[2] || ''
      const paragraphs = decodeStructuredData<EmbeddedTableParagraph[]>(getAttr(attrs, 'data-paragraphs')) || parseHtmlCellParagraphs(cellMatch[3] || '')
      const colspan = Math.max(1, Number(getAttr(attrs, 'colspan') || 1))
      const rowspan = Math.max(1, Number(getAttr(attrs, 'rowspan') || 1))
      const cell: EmbeddedTableCell = {
        text: buildTableCellText(paragraphs),
        paragraphs,
        colspan,
        rowspan,
        header: tag === 'th',
        width: getAttr(attrs, 'data-width') || undefined,
        column,
      }
      row.push(cell)
      for (let offset = 0; offset < colspan; offset += 1) {
        activeRowSpans[column + offset] = Math.max(activeRowSpans[column + offset] || 0, rowspan - 1)
        if (rowspan > 1) {
          newSpanColumns.add(column + offset)
        }
      }
      column += colspan
    }

    for (let index = 0; index < activeRowSpans.length; index += 1) {
      if (activeRowSpans[index] > 0 && !newSpanColumns.has(index)) activeRowSpans[index] -= 1
    }

    return row
  }) : normalizeTableRowsForEditor(undefined)

  const cols = Math.max(1, ...tableRows.map((row) => row.reduce((total, cell) => Math.max(total, cell.column + Math.max(1, cell.colspan || 1)), 0)))
  return {
    rows: tableRows.length,
    cols,
    tableRows: normalizeTableRowsForEditor(tableRows, tableRows.length, cols),
  }
}

function normalizeTableBlock(block: EmbeddedTableBlock): EmbeddedTableBlock {
  const tableRows = normalizeTableRowsForEditor(block.tableRows, block.rows, block.cols)
  const cols = Math.max(1, ...tableRows.map((row) => row.reduce((total, cell) => Math.max(total, cell.column + Math.max(1, cell.colspan || 1)), 0)))
  return {
    ...block,
    rows: Math.max(1, tableRows.length),
    cols,
    tableRows,
  }
}

function buildImportedMediaPath(fileName: string, contentType: string, blockId: string): string {
  const extensionByType: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
  }
  const sanitizedBase = String(fileName || 'image')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'image'
  const fallbackExtension = String(fileName || '').toLowerCase().split('.').pop() || 'png'
  const extension = extensionByType[String(contentType || '').toLowerCase()] || fallbackExtension
  return `word/media/${sanitizedBase}-${blockId}.${extension}`
}

function createEmptyTableCell(column: number): EmbeddedTableCell {
  return {
    text: '',
    paragraphs: [{ text: '' }],
    colspan: 1,
    rowspan: 1,
    column,
  }
}

function cloneTableCell(cell: EmbeddedTableCell): EmbeddedTableCell {
  return {
    ...cell,
    paragraphs: (cell.paragraphs?.length ? cell.paragraphs : [{ text: cell.text || '' }]).map((paragraph) => ({ ...paragraph })),
  }
}

function getImageAspectRatio(block: EmbeddedImageBlock): number | null {
  if (block.imageWidthPx && block.imageHeightPx && block.imageWidthPx > 0 && block.imageHeightPx > 0) {
    return block.imageWidthPx / block.imageHeightPx
  }
  return null
}

function buildTableGrid(block: EmbeddedTableBlock): TableGridSlot[][] {
  const normalized = normalizeTableBlock(block)
  const grid: Array<Array<TableGridSlot | null>> = Array.from({ length: normalized.rows }, () => Array.from({ length: normalized.cols }, () => null))

  normalized.tableRows.forEach((row, rowIndex) => {
    row.forEach((cell) => {
      const startCol = cell.column
      for (let rowOffset = 0; rowOffset < Math.max(1, cell.rowspan); rowOffset += 1) {
        for (let colOffset = 0; colOffset < Math.max(1, cell.colspan); colOffset += 1) {
          const targetRow = rowIndex + rowOffset
          const targetCol = startCol + colOffset
          if (!grid[targetRow] || targetCol >= normalized.cols) continue
          grid[targetRow][targetCol] = {
            anchorRow: rowIndex,
            anchorCol: startCol,
            cell,
            isAnchor: rowOffset === 0 && colOffset === 0,
          }
        }
      }
    })
  })

  return grid.map((row) => row.map((slot, colIndex) => slot || {
    anchorRow: -1,
    anchorCol: colIndex,
    cell: createEmptyTableCell(colIndex),
    isAnchor: false,
  }))
}

function getTableAnchors(block: EmbeddedTableBlock): TableAnchorCell[] {
  return normalizeTableBlock(block).tableRows.flatMap((row, rowIndex) => row.map((cell) => ({
    ...cloneTableCell(cell),
    anchorRow: rowIndex,
    anchorCol: cell.column,
  })))
}

function rebuildTableBlockFromAnchors(block: EmbeddedTableBlock, nextRows: number, nextCols: number, anchors: TableAnchorCell[]): EmbeddedTableBlock {
  const safeRows = Math.max(1, nextRows)
  const safeCols = Math.max(1, nextCols)
  const tableRows: EmbeddedTableCell[][] = Array.from({ length: safeRows }, () => [])

  anchors
    .map((anchor) => ({
      ...anchor,
      anchorRow: Math.max(0, Math.min(safeRows - 1, anchor.anchorRow)),
      anchorCol: Math.max(0, Math.min(safeCols - 1, anchor.anchorCol)),
      colspan: Math.max(1, Math.min(anchor.colspan, safeCols - Math.max(0, Math.min(safeCols - 1, anchor.anchorCol)))),
      rowspan: Math.max(1, Math.min(anchor.rowspan, safeRows - Math.max(0, Math.min(safeRows - 1, anchor.anchorRow)))),
    }))
    .sort((left, right) => left.anchorRow - right.anchorRow || left.anchorCol - right.anchorCol)
    .forEach((anchor) => {
      if (!tableRows[anchor.anchorRow]) return
      tableRows[anchor.anchorRow].push({
        ...cloneTableCell(anchor),
        column: anchor.anchorCol,
      })
    })

  for (let rowIndex = 0; rowIndex < safeRows; rowIndex += 1) {
    if (tableRows[rowIndex].length) continue
    tableRows[rowIndex] = Array.from({ length: safeCols }, (_item, colIndex) => createEmptyTableCell(colIndex))
  }

  return normalizeTableBlock({
    ...block,
    rows: safeRows,
    cols: safeCols,
    tableRows,
  })
}

function deleteTableRow(block: EmbeddedTableBlock, rowIndex: number): EmbeddedTableBlock {
  if (block.rows <= 1) return block
  const anchors = getTableAnchors(block)
  const nextAnchors: TableAnchorCell[] = []

  anchors.forEach((anchor) => {
    const rowStart = anchor.anchorRow
    const rowEnd = anchor.anchorRow + anchor.rowspan - 1

    if (rowStart === rowIndex) {
      if (anchor.rowspan > 1) {
        nextAnchors.push({
          ...anchor,
          anchorRow: rowStart,
          rowspan: anchor.rowspan - 1,
        })
      }
      return
    }

    if (rowStart < rowIndex && rowEnd >= rowIndex) {
      nextAnchors.push({
        ...anchor,
        rowspan: anchor.rowspan - 1,
      })
      return
    }

    nextAnchors.push({
      ...anchor,
      anchorRow: rowStart > rowIndex ? rowStart - 1 : rowStart,
    })
  })

  return rebuildTableBlockFromAnchors(block, block.rows - 1, block.cols, nextAnchors)
}

function deleteTableColumn(block: EmbeddedTableBlock, colIndex: number): EmbeddedTableBlock {
  if (block.cols <= 1) return block
  const anchors = getTableAnchors(block)
  const nextAnchors: TableAnchorCell[] = []

  anchors.forEach((anchor) => {
    const colStart = anchor.anchorCol
    const colEnd = anchor.anchorCol + anchor.colspan - 1

    if (colStart === colIndex) {
      if (anchor.colspan > 1) {
        nextAnchors.push({
          ...anchor,
          anchorCol: colStart,
          colspan: anchor.colspan - 1,
        })
      }
      return
    }

    if (colStart < colIndex && colEnd >= colIndex) {
      nextAnchors.push({
        ...anchor,
        colspan: anchor.colspan - 1,
      })
      return
    }

    nextAnchors.push({
      ...anchor,
      anchorCol: colStart > colIndex ? colStart - 1 : colStart,
    })
  })

  return rebuildTableBlockFromAnchors(block, block.rows, block.cols - 1, nextAnchors)
}

function mergeTableCellRight(block: EmbeddedTableBlock, rowIndex: number, cellIndex: number): EmbeddedTableBlock {
  const grid = buildTableGrid(block)
  const currentRow = grid[rowIndex]
  const sourceSlot = currentRow?.find((slot) => slot.isAnchor && slot.anchorCol === block.tableRows[rowIndex]?.[cellIndex]?.column)
  if (!sourceSlot?.isAnchor) return block
  const targetCol = sourceSlot.anchorCol + sourceSlot.cell.colspan
  const targetSlot = currentRow?.[targetCol]
  if (!targetSlot?.isAnchor) return block
  if (targetSlot.anchorRow !== rowIndex) return block
  if (targetSlot.cell.rowspan !== sourceSlot.cell.rowspan) return block

  const anchors = getTableAnchors(block).filter((anchor) => !(anchor.anchorRow === targetSlot.anchorRow && anchor.anchorCol === targetSlot.anchorCol))
  const sourceAnchor = anchors.find((anchor) => anchor.anchorRow === sourceSlot.anchorRow && anchor.anchorCol === sourceSlot.anchorCol)
  if (!sourceAnchor) return block
  sourceAnchor.colspan += targetSlot.cell.colspan
  if (targetSlot.cell.paragraphs?.length) {
    sourceAnchor.paragraphs = [...sourceAnchor.paragraphs, { text: '' }, ...targetSlot.cell.paragraphs.map((paragraph) => ({ ...paragraph }))]
    sourceAnchor.text = buildTableCellText(sourceAnchor.paragraphs)
  }
  sourceAnchor.header = sourceAnchor.header || targetSlot.cell.header
  return rebuildTableBlockFromAnchors(block, block.rows, block.cols, anchors)
}

function mergeTableCellDown(block: EmbeddedTableBlock, rowIndex: number, cellIndex: number): EmbeddedTableBlock {
  const grid = buildTableGrid(block)
  const currentRow = grid[rowIndex]
  const sourceSlot = currentRow?.find((slot) => slot.isAnchor && slot.anchorCol === block.tableRows[rowIndex]?.[cellIndex]?.column)
  if (!sourceSlot?.isAnchor) return block
  const targetRow = sourceSlot.anchorRow + sourceSlot.cell.rowspan
  const targetSlot = grid[targetRow]?.[sourceSlot.anchorCol]
  if (!targetSlot?.isAnchor) return block
  if (targetSlot.anchorCol !== sourceSlot.anchorCol) return block
  if (targetSlot.cell.colspan !== sourceSlot.cell.colspan) return block

  const anchors = getTableAnchors(block).filter((anchor) => !(anchor.anchorRow === targetSlot.anchorRow && anchor.anchorCol === targetSlot.anchorCol))
  const sourceAnchor = anchors.find((anchor) => anchor.anchorRow === sourceSlot.anchorRow && anchor.anchorCol === sourceSlot.anchorCol)
  if (!sourceAnchor) return block
  sourceAnchor.rowspan += targetSlot.cell.rowspan
  if (targetSlot.cell.paragraphs?.length) {
    sourceAnchor.paragraphs = [...sourceAnchor.paragraphs, { text: '' }, ...targetSlot.cell.paragraphs.map((paragraph) => ({ ...paragraph }))]
    sourceAnchor.text = buildTableCellText(sourceAnchor.paragraphs)
  }
  sourceAnchor.header = sourceAnchor.header || targetSlot.cell.header
  return rebuildTableBlockFromAnchors(block, block.rows, block.cols, anchors)
}

function splitTableCell(block: EmbeddedTableBlock, rowIndex: number, cellIndex: number): EmbeddedTableBlock {
  const sourceRow = block.tableRows[rowIndex]
  const sourceCell = sourceRow?.[cellIndex]
  if (!sourceCell || (sourceCell.colspan === 1 && sourceCell.rowspan === 1)) return block

  const anchors = getTableAnchors(block).filter((anchor) => !(anchor.anchorRow === rowIndex && anchor.anchorCol === sourceCell.column))
  anchors.push({
    ...cloneTableCell(sourceCell),
    anchorRow: rowIndex,
    anchorCol: sourceCell.column,
    colspan: 1,
    rowspan: 1,
  })

  for (let rowOffset = 0; rowOffset < sourceCell.rowspan; rowOffset += 1) {
    for (let colOffset = 0; colOffset < sourceCell.colspan; colOffset += 1) {
      if (rowOffset === 0 && colOffset === 0) continue
      anchors.push({
        ...createEmptyTableCell(sourceCell.column + colOffset),
        anchorRow: rowIndex + rowOffset,
        anchorCol: sourceCell.column + colOffset,
      })
    }
  }

  return rebuildTableBlockFromAnchors(block, block.rows, block.cols, anchors)
}

function normalizeTableSelection(selection: TableSelection): TableSelection {
  return {
    startRow: Math.min(selection.startRow, selection.endRow),
    startCol: Math.min(selection.startCol, selection.endCol),
    endRow: Math.max(selection.startRow, selection.endRow),
    endCol: Math.max(selection.startCol, selection.endCol),
  }
}

function isGridSlotWithinSelection(selection: TableSelection, rowIndex: number, colIndex: number): boolean {
  const normalized = normalizeTableSelection(selection)
  return rowIndex >= normalized.startRow && rowIndex <= normalized.endRow && colIndex >= normalized.startCol && colIndex <= normalized.endCol
}

function canMergeSelectedTableCells(block: EmbeddedTableBlock, selection: TableSelection | null): boolean {
  if (!selection) return false
  const normalized = normalizeTableSelection(selection)
  if (normalized.startRow === normalized.endRow && normalized.startCol === normalized.endCol) return false
  const grid = buildTableGrid(block)
  const anchors = new Map<string, TableAnchorCell>()

  for (let rowIndex = normalized.startRow; rowIndex <= normalized.endRow; rowIndex += 1) {
    for (let colIndex = normalized.startCol; colIndex <= normalized.endCol; colIndex += 1) {
      const slot = grid[rowIndex]?.[colIndex]
      if (!slot || slot.anchorRow < 0) return false
      const key = `${slot.anchorRow}:${slot.anchorCol}`
      if (!anchors.has(key)) {
        anchors.set(key, {
          ...cloneTableCell(slot.cell),
          anchorRow: slot.anchorRow,
          anchorCol: slot.anchorCol,
        })
      }
    }
  }

  return Array.from(anchors.values()).every((anchor) => {
    const rowEnd = anchor.anchorRow + Math.max(1, anchor.rowspan) - 1
    const colEnd = anchor.anchorCol + Math.max(1, anchor.colspan) - 1
    return anchor.anchorRow >= normalized.startRow
      && anchor.anchorCol >= normalized.startCol
      && rowEnd <= normalized.endRow
      && colEnd <= normalized.endCol
  })
}

function mergeSelectedTableCells(block: EmbeddedTableBlock, selection: TableSelection | null): EmbeddedTableBlock {
  if (!selection || !canMergeSelectedTableCells(block, selection)) return block
  const normalized = normalizeTableSelection(selection)
  const grid = buildTableGrid(block)
  const anchors = getTableAnchors(block)
  const keysInSelection = new Set<string>()

  for (let rowIndex = normalized.startRow; rowIndex <= normalized.endRow; rowIndex += 1) {
    for (let colIndex = normalized.startCol; colIndex <= normalized.endCol; colIndex += 1) {
      const slot = grid[rowIndex]?.[colIndex]
      if (slot && slot.anchorRow >= 0) {
        keysInSelection.add(`${slot.anchorRow}:${slot.anchorCol}`)
      }
    }
  }

  const selectedAnchors = anchors.filter((anchor) => keysInSelection.has(`${anchor.anchorRow}:${anchor.anchorCol}`))
    .sort((left, right) => left.anchorRow - right.anchorRow || left.anchorCol - right.anchorCol)
  if (!selectedAnchors.length) return block

  const mergedAnchor = {
    ...cloneTableCell(selectedAnchors[0]),
    anchorRow: normalized.startRow,
    anchorCol: normalized.startCol,
    colspan: normalized.endCol - normalized.startCol + 1,
    rowspan: normalized.endRow - normalized.startRow + 1,
  }
  const mergedParagraphs = selectedAnchors.flatMap((anchor, index) => {
    const paragraphs = anchor.paragraphs?.length ? anchor.paragraphs.map((paragraph) => ({ ...paragraph })) : [{ text: anchor.text || '' }]
    return index === 0 ? paragraphs : [{ text: '' }, ...paragraphs]
  })
  mergedAnchor.paragraphs = mergedParagraphs.length ? mergedParagraphs : [{ text: '' }]
  mergedAnchor.text = buildTableCellText(mergedAnchor.paragraphs)
  mergedAnchor.header = selectedAnchors.every((anchor) => anchor.header)

  const nextAnchors = anchors.filter((anchor) => !keysInSelection.has(`${anchor.anchorRow}:${anchor.anchorCol}`))
  nextAnchors.push(mergedAnchor)
  return rebuildTableBlockFromAnchors(block, block.rows, block.cols, nextAnchors)
}

async function readBrowserFileAsDataUrl(file: File): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('仅支持图片文件'))
      return
    }
    resolve()
  })

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }
      reject(new Error('读取图片失败'))
    }
    reader.readAsDataURL(file)
  })
}

function parseHtmlToBlocks(html: string): EmbeddedEditorBlock[] {
  const source = String(html || '')
  const structuredPayload = decodeEmbeddedDocumentPayload(source)
  if (structuredPayload?.blocks?.length) {
    return normalizeStructuredTextBlocks(structuredPayloadBlocksToEditorBlocks(structuredPayload.blocks))
  }
  const tokenPattern = /<h([1-6])\b[^>]*>[\s\S]*?<\/h\1>|<div\b[^>]*data-ooxml-object="image"[^>]*>[\s\S]*?<\/div>|<(div|span)\b[^>]*data-ooxml-object="formula"[^>]*>[\s\S]*?<\/\2>|<table\b[^>]*data-ooxml-object="table"[^>]*>[\s\S]*?<\/table>|<div\b[^>]*data-ooxml-object="table"[^>]*>[\s\S]*?<\/div>|<p\b[^>]*>[\s\S]*?<\/p>/gi
  const fragments: string[] = []
  if (typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(`<div data-aiw-block-root="true">${source}</div>`, 'text/html')
      const root = doc.querySelector('[data-aiw-block-root="true"]')
      if (root) {
        for (const child of Array.from(root.children)) {
          const tag = child.tagName.toLowerCase()
          const ooxmlObject = String(child.getAttribute('data-ooxml-object') || '').toLowerCase()
          const isHeading = /^h[1-6]$/.test(tag)
          const isParagraph = tag === 'p'
          const isImage = tag === 'div' && ooxmlObject === 'image'
          const isFormula = (tag === 'div' || tag === 'span') && ooxmlObject === 'formula'
          const isTable = (tag === 'table' || tag === 'div') && ooxmlObject === 'table'
          if (isHeading || isParagraph || isImage || isFormula || isTable) {
            fragments.push(child.outerHTML)
          }
        }
      }
    } catch {
      // Fall back to regex-based tokenization when HTML parsing fails.
    }
  }
  if (!fragments.length) {
    for (const match of source.matchAll(tokenPattern)) {
      fragments.push(match[0])
    }
  }
  const blocks: EmbeddedEditorBlock[] = []

  for (const fragment of fragments) {
    if (/^<h[1-6]\b/i.test(fragment)) {
      const level = Number(fragment.match(/^<h([1-6])\b/i)?.[1] || 1)
      blocks.push({
        id: createBlockId('heading'),
        type: 'heading',
        level,
        text: stripHtml(fragment).trim(),
        paragraphStyle: normalizeParagraphStyleId(getAttr(fragment, 'data-paragraph-style') || `Heading${level}`),
        paperStyle: readPaperStyle(fragment),
        alignment: (getAttr(fragment, 'data-alignment') as 'left' | 'center' | 'right' | 'justify' | null) || undefined,
        indentLevel: Number(getAttr(fragment, 'data-indent-level') || 0) || undefined,
        listType: (getAttr(fragment, 'data-list-type') as 'bullet' | 'number' | null) || undefined,
        listLevel: Number(getAttr(fragment, 'data-list-level') || 0) || undefined,
        sourceXml: decodeStructuredData<string>(getAttr(fragment, 'data-source-xml')) || getAttr(fragment, 'data-source-xml') || undefined,
      })
      continue
    }

    if (/data-ooxml-object="image"/i.test(fragment)) {
      blocks.push({
        id: createBlockId('image'),
        type: 'image',
        alt: getAttr(fragment, 'data-alt') || 'image',
        title: getAttr(fragment, 'data-title') || undefined,
        sourceId: getAttr(fragment, 'data-source-id') || undefined,
        sourceXml: decodeStructuredData<string>(getAttr(fragment, 'data-source-xml')) || getAttr(fragment, 'data-source-xml') || undefined,
        relationshipId: getAttr(fragment, 'data-relationship-id') || undefined,
        mediaPath: getAttr(fragment, 'data-media-path') || undefined,
        mediaContentType: getAttr(fragment, 'data-media-content-type') || undefined,
        previewSrc: getAttr(fragment, 'data-preview-src') || undefined,
        drawingLayout: (getAttr(fragment, 'data-drawing-layout') as 'inline' | 'anchor' | null) || undefined,
        imageWidthPx: Number(getAttr(fragment, 'data-image-width-px') || 0) || undefined,
        imageHeightPx: Number(getAttr(fragment, 'data-image-height-px') || 0) || undefined,
        anchorHorizontal: getAttr(fragment, 'data-anchor-horizontal') || undefined,
        anchorVertical: getAttr(fragment, 'data-anchor-vertical') || undefined,
        wrapType: normalizeWrapTypeForEditor(getAttr(fragment, 'data-wrap-type')),
      })
      continue
    }

    if (/data-ooxml-object="formula"/i.test(fragment)) {
      blocks.push({
        id: createBlockId('formula'),
        type: 'formula',
        latex: getAttr(fragment, 'data-latex') || stripHtml(fragment).trim() || '公式',
        display: (getAttr(fragment, 'data-formula-display') as 'inline' | 'block' | null) || 'block',
        sourceId: getAttr(fragment, 'data-source-id') || undefined,
        sourceXml: decodeStructuredData<string>(getAttr(fragment, 'data-source-xml')) || getAttr(fragment, 'data-source-xml') || undefined,
        mathml: decodeStructuredData<string>(getAttr(fragment, 'data-mathml')) || getAttr(fragment, 'data-mathml') || undefined,
      })
      continue
    }

    if (/data-ooxml-object="table"/i.test(fragment)) {
      const parsedTable = parseHtmlTableToRows(fragment)
      blocks.push({
        id: createBlockId('table'),
        type: 'table',
        rows: Math.max(1, Number(getAttr(fragment, 'data-rows') || parsedTable.rows) || parsedTable.rows),
        cols: Math.max(1, Number(getAttr(fragment, 'data-cols') || parsedTable.cols) || parsedTable.cols),
        tableRows: parsedTable.tableRows,
      })
      continue
    }

    blocks.push({
      id: createBlockId('paragraph'),
      type: 'paragraph',
      text: stripHtml(fragment),
      paragraphStyle: normalizeParagraphStyleId(getAttr(fragment, 'data-paragraph-style') || undefined),
      paperStyle: readPaperStyle(fragment),
      alignment: (getAttr(fragment, 'data-alignment') as 'left' | 'center' | 'right' | 'justify' | null) || undefined,
      indentLevel: Number(getAttr(fragment, 'data-indent-level') || 0) || undefined,
      listType: (getAttr(fragment, 'data-list-type') as 'bullet' | 'number' | null) || undefined,
      listLevel: Number(getAttr(fragment, 'data-list-level') || 0) || undefined,
      sourceXml: decodeStructuredData<string>(getAttr(fragment, 'data-source-xml')) || getAttr(fragment, 'data-source-xml') || undefined,
    })
  }

  if (blocks.length > 0) return normalizeStructuredTextBlocks(blocks)
  const fallback = stripHtml(source).trim()
  return normalizeStructuredTextBlocks([{ id: createBlockId('paragraph'), type: 'paragraph', text: fallback }])
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function renderTextBlockText(text: string): string {
  return escapeHtml(text || '').replace(/\n/g, '<br />')
}

function serializeBlocksToHtml(blocks: EmbeddedEditorBlock[]): string {
  const normalizedBlocks = blocks.length > 0 ? blocks : [{ id: createBlockId('paragraph'), type: 'paragraph', text: '' } satisfies EmbeddedTextBlock]
  return normalizedBlocks.map((block) => {
    if (block.type === 'heading') {
      const level = Math.min(Math.max(block.level || 1, 1), 6)
      return `<h${level} data-ooxml-block="heading" data-level="${level}" data-paragraph-style="${escapeAttr(block.paragraphStyle || `Heading${level}`)}"${buildPaperStyleAttributes(block.paperStyle)} data-alignment="${escapeAttr(block.alignment || '')}" data-indent-level="${escapeAttr(String(block.indentLevel || ''))}" data-list-type="${escapeAttr(block.listType || '')}" data-list-level="${escapeAttr(String(block.listLevel || ''))}" data-source-xml="${encodeStructuredData(block.sourceXml || '')}">${renderTextBlockText(block.text)}</h${level}>`
    }

    if (block.type === 'paragraph') {
      return `<p data-paragraph-style="${escapeAttr(block.paragraphStyle || '')}"${buildPaperStyleAttributes(block.paperStyle)} data-alignment="${escapeAttr(block.alignment || '')}" data-indent-level="${escapeAttr(String(block.indentLevel || ''))}" data-list-type="${escapeAttr(block.listType || '')}" data-list-level="${escapeAttr(String(block.listLevel || ''))}" data-source-xml="${encodeStructuredData(block.sourceXml || '')}">${renderTextBlockText(block.text)}</p>`
    }

    if (block.type === 'image') {
      return `<div data-ooxml-object="image" data-alt="${escapeAttr(block.alt || 'image')}" data-title="${escapeAttr(block.title || '')}" data-source-id="${escapeAttr(block.sourceId || '')}" data-source-xml="${encodeStructuredData(block.sourceXml || '')}" data-relationship-id="${escapeAttr(block.relationshipId || '')}" data-media-path="${escapeAttr(block.mediaPath || '')}" data-media-content-type="${escapeAttr(block.mediaContentType || '')}" data-preview-src="${escapeAttr(block.previewSrc || '')}" data-drawing-layout="${escapeAttr(block.drawingLayout || '')}" data-image-width-px="${escapeAttr(String(block.imageWidthPx || ''))}" data-image-height-px="${escapeAttr(String(block.imageHeightPx || ''))}" data-anchor-horizontal="${escapeAttr(block.anchorHorizontal || '')}" data-anchor-vertical="${escapeAttr(block.anchorVertical || '')}" data-wrap-type="${escapeAttr(block.wrapType || '')}"><span>${escapeHtml(block.alt || block.title || 'image')}</span></div>`
    }

    if (block.type === 'formula') {
      return `<div data-ooxml-object="formula" data-latex="${escapeAttr(block.latex || '公式')}" data-formula-display="${escapeAttr(block.display || 'block')}" data-source-id="${escapeAttr(block.sourceId || '')}" data-source-xml="${encodeStructuredData(block.sourceXml || '')}" data-mathml="${encodeStructuredData(block.mathml || '')}">${escapeHtml(block.latex || '公式')}</div>`
    }

    if (!isEmbeddedTableBlock(block)) return ''
    const normalizedTable = normalizeTableBlock(block)
    return `<table data-ooxml-object="table" data-rows="${normalizedTable.rows}" data-cols="${normalizedTable.cols}"><tbody>${normalizedTable.tableRows.map((row) => `<tr>${row.map((cell) => {
      const tag = cell.header ? 'th' : 'td'
      const attrs = [
        cell.colspan > 1 ? ` colspan="${cell.colspan}"` : '',
        cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : '',
        ` data-column="${cell.column}"`,
        cell.width ? ` data-width="${escapeAttr(cell.width)}"` : '',
        ` data-paragraphs="${escapeAttr(JSON.stringify(cell.paragraphs))}"`,
      ].join('')
      const inner = (cell.paragraphs?.length ? cell.paragraphs : [{ text: cell.text }]).map((paragraph) => {
        if (paragraph.level) {
          const level = Math.max(1, Math.min(paragraph.level, 6))
          return `<h${level}>${escapeHtml(paragraph.text)}</h${level}>`
        }
        return `<p>${renderTextBlockText(paragraph.text)}</p>`
      }).join('') || '<p></p>'
      return `<${tag}${attrs}>${inner}</${tag}>`
    }).join('')}</tr>`).join('')}</tbody></table>`
  }).join('')
}

function blocksToPlainText(blocks: EmbeddedEditorBlock[]): string {
  return blocks.map((block) => {
    if (block.type === 'heading') {
      return `${'#'.repeat(Math.min(Math.max(block.level || 1, 1), 6))} ${block.text}`
    }
    if (block.type === 'paragraph') {
      return block.text
    }
    if (block.type === 'image') {
      return `[图片对象: ${block.alt || block.title || 'image'}]`
    }
    if (block.type === 'formula') {
      return `[公式对象: ${block.latex || '公式'}]`
    }
    if (isEmbeddedTableBlock(block)) {
      return `[表格对象: ${block.rows}x${block.cols}]`
    }
    return ''
  }).join('\n\n').trim()
}

function serializeBlocksToOoxmlBlocks(blocks: EmbeddedEditorBlock[]): WriteOoxmlBlock[] {
  return blocks.map((block, index) => {
    if (block.type === 'heading') {
      const level = Math.min(Math.max(block.level || 1, 1), 6)
      return {
        index,
        kind: 'heading',
        text: block.text,
        level,
        paragraphStyle: block.paragraphStyle || `Heading${level}`,
        paperStyle: block.paperStyle,
        alignment: block.alignment,
        indentLevel: block.indentLevel,
        listType: block.listType,
        listLevel: block.listLevel,
        sourceXml: block.sourceXml,
      }
    }

    if (block.type === 'paragraph') {
      return {
        index,
        kind: 'paragraph',
        text: block.text,
        paragraphStyle: block.paragraphStyle,
        paperStyle: block.paperStyle,
        alignment: block.alignment,
        indentLevel: block.indentLevel,
        listType: block.listType,
        listLevel: block.listLevel,
        sourceXml: block.sourceXml,
      }
    }

    if (block.type === 'image') {
      return {
        index,
        kind: 'image-placeholder',
        text: block.alt || block.title || 'image',
        alt: block.alt,
        title: block.title,
        sourceId: block.sourceId,
        sourceXml: block.sourceXml,
        relationshipId: block.relationshipId,
        mediaPath: block.mediaPath,
        mediaContentType: block.mediaContentType,
        previewSrc: block.previewSrc,
        drawingLayout: block.drawingLayout,
        imageWidthPx: block.imageWidthPx,
        imageHeightPx: block.imageHeightPx,
        anchorHorizontal: block.anchorHorizontal,
        anchorVertical: block.anchorVertical,
        wrapType: block.wrapType,
      }
    }

    if (block.type === 'formula') {
      return {
        index,
        kind: 'formula-placeholder',
        text: block.latex || '公式',
        latex: block.latex || '公式',
        formulaDisplay: block.display,
        sourceId: block.sourceId,
        sourceXml: block.sourceXml,
        mathml: block.mathml,
      }
    }

    if (!isEmbeddedTableBlock(block)) {
      return {
        index,
        kind: 'paragraph',
        text: '',
      }
    }
    const normalizedTable = normalizeTableBlock(block)
    const cells = normalizedTable.tableRows.map((row) => {
      const grid = Array.from({ length: normalizedTable.cols }, () => '')
      row.forEach((cell) => {
        grid[cell.column] = cell.text
      })
      return grid
    })

    return {
      index,
      kind: 'table-placeholder',
      text: `表格占位 ${normalizedTable.rows}x${normalizedTable.cols}`,
      rows: normalizedTable.rows,
      columns: normalizedTable.cols,
      cells,
      tableRows: normalizedTable.tableRows.map((row) => row.map((cell) => ({
        ...cell,
        paragraphs: (cell.paragraphs?.length ? cell.paragraphs : [{ text: cell.text || '' }]).map((paragraph) => ({ ...paragraph })),
      }))),
    }
  })
}

function toFileUrl(localPath: string): string {
  const normalized = String(localPath || '').replace(/\\/g, '/')
  if (!normalized) return normalized
  const encoded = encodeURI(normalized)
  if (encoded.startsWith('/')) return `file://${encoded}`
  if (/^[a-zA-Z]:\//.test(encoded)) return `file:///${encoded}`
  return `file:///${encoded}`
}

function isFigureCaptionText(text: string): boolean {
  const normalized = String(text || '').trim()
  return /^(?:Figure|Fig\.?|图|图表)\s*\d+(?:\.\d+)*[\s:：.．-]/i.test(normalized)
}

function derivePaperFigurePreviewTitle(block: EmbeddedImageBlock, index: number): string {
  const title = String(block.title || '').trim()
  const alt = String(block.alt || '').trim()
  const figureLike = [title, alt, block.caption || ''].find((value) => isFigureCaptionText(value))
  const figureNo = figureLike?.match(/^(?:Figure|Fig\.?|图|图表)\s*(\d+(?:\.\d+)*)/i)?.[1]
  if (block.paperGenerated || figureNo || isFigureCaptionText(title) || isFigureCaptionText(alt)) {
    return figureNo ? `Figure ${figureNo}` : '图片'
  }
  return alt || title || `图片 ${index + 1}`
}

function normalizeLocalImagePath(source: string): string {
  const value = decodeURI(String(source || '').trim())
  if (!value) return value

  if (value.startsWith('file://')) {
    try {
      const url = new URL(value)
      const pathname = decodeURI(url.pathname || '')
      if (/^\/[a-zA-Z]:\//.test(pathname)) return pathname.slice(1)
      if (/^[a-zA-Z]:\//.test(pathname)) return pathname
      return pathname || value.replace(/^file:\/\//, '')
    } catch {
      const stripped = value.replace(/^file:\/\//, '')
      if (/^\/[a-zA-Z]:\//.test(stripped)) return stripped.slice(1)
      return stripped
    }
  }

  if (/^\/[a-zA-Z]:\//.test(value)) return value.slice(1)
  return value
}

function isWorkspaceLocalImage(source: string, workspacePath: string): boolean {
  const normalizedSource = normalizeLocalImagePath(source).replace(/\\/g, '/').toLowerCase()
  const normalizedWorkspacePath = String(workspacePath || '').replace(/\\/g, '/').toLowerCase()
  return Boolean(normalizedSource && normalizedWorkspacePath && normalizedSource.startsWith(normalizedWorkspacePath))
}

function serializeForTextFile(targetPath: string, plainText: string, html: string): string {
  const lowerPath = targetPath.toLowerCase()
  if (lowerPath.endsWith('.txt')) return plainText
  if (lowerPath.endsWith('.md') || lowerPath.endsWith('.markdown')) return plainText
  return html
}

function sanitizeBaseName(fileName: string): string {
  return String(fileName || '未命名文档').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_') || '未命名文档'
}

function normalizeParagraphStyleId(style: string | undefined): string | undefined {
  if (!style) return undefined
  const normalized = String(style).trim()
  if (/^title$/i.test(normalized)) return 'Title'
  if (/^abstractheading$/i.test(normalized)) return 'AbstractHeading'
  if (/^abstract$/i.test(normalized)) return 'Abstract'
  if (/^keywordsheading$/i.test(normalized)) return 'KeywordsHeading'
  if (/^keywords$/i.test(normalized)) return 'Keywords'
  if (/^caption$/i.test(normalized)) return 'Caption'
  if (/^reference$/i.test(normalized)) return 'Reference'
  if (/^footnote$/i.test(normalized)) return 'Footnote'
  if (/^referencesheading$/i.test(normalized)) return 'ReferencesHeading'
  if (/^footnotesheading$/i.test(normalized)) return 'FootnotesHeading'
  if (/^heading([1-6])$/i.test(normalized)) return `Heading${RegExp.$1}`
  return normalized
}

function buildStructuredReferenceText(item: EmbeddedReferenceListItem, fallbackIndex: number): string {
  const label = item.citationNumber || fallbackIndex + 1
  const text = String(item.text || '').trim()
  return text ? `[${label}] ${text}` : `[${label}]`
}

function buildStructuredFootnoteText(item: EmbeddedFootnoteItem, fallbackIndex: number): string {
  const label = String(item.id || fallbackIndex + 1).trim() || String(fallbackIndex + 1)
  const text = String(item.text || '').trim()
  return text ? `[${label}] ${text}` : `[${label}]`
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

function parseCitationNumber(text: string, fallbackNumber?: number): number | undefined {
  return parseLeadingCitationNumber(text, fallbackNumber)
}

function stripCitationPrefix(text: string): string {
  return stripLeadingCitationPrefix(text)
}

function isReferencesHeadingText(text: string): boolean {
  return /^(参考文献|references)$/i.test(String(text || '').trim())
}

function upsertCitationIntoEmbeddedBlocks(
  blocks: EmbeddedEditorBlock[],
  selection: DocumentEngineSelection,
  citation: CitationItem,
  options: { insertMarker?: boolean } = {},
): { blocks: EmbeddedEditorBlock[]; citationNumber: number } | null {
  const targetBlockId = selection.anchorId
  if (!targetBlockId) return null

  const targetIndex = blocks.findIndex((block) => block.id === targetBlockId)
  const targetBlock = targetIndex >= 0 ? blocks[targetIndex] : null
  if (!targetBlock || (targetBlock.type !== 'paragraph' && targetBlock.type !== 'heading')) {
    return null
  }

  let headingIndex = -1
  let headingBlock: EmbeddedTextBlock | null = null
  const referenceIndexes: number[] = []
  const existingItems: Array<{ citationNumber?: number; text: string }> = []

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (block.type !== 'paragraph' && block.type !== 'heading') continue
    if (block.paragraphStyle !== 'ReferencesHeading' && !isReferencesHeadingText(block.text)) continue

    headingIndex = index
    headingBlock = block
    let cursor = index + 1
    let listOrder = 1

    while (cursor < blocks.length) {
      const candidate = blocks[cursor]
      if (candidate.type !== 'paragraph' && candidate.type !== 'heading') break

      const rawText = String(candidate.text || '').trim()
      if (!rawText) {
        if (candidate.type === 'paragraph' && candidate.paragraphStyle === 'Reference') {
          referenceIndexes.push(cursor)
          cursor += 1
          continue
        }
        break
      }

      if (candidate.type === 'paragraph' && candidate.paragraphStyle === 'Reference') {
        existingItems.push({
          citationNumber: parseCitationNumber(rawText, listOrder),
          text: stripCitationPrefix(rawText),
        })
        referenceIndexes.push(cursor)
        listOrder += 1
        cursor += 1
        continue
      }

      const parsedNumber = parseCitationNumber(rawText, listOrder)
      if (!parsedNumber) break

      existingItems.push({ citationNumber: parsedNumber, text: stripCitationPrefix(rawText) })
      referenceIndexes.push(cursor)
      listOrder += 1
      cursor += 1
    }

    break
  }

  const nextReferenceText = String(citation.citation || '').trim()
  const normalizedNextReference = normalizeReferenceContent(nextReferenceText)
  let assignedNumber: number | undefined

  const mergedItems = existingItems.map((item, index) => {
    if (normalizeReferenceContent(item.text) !== normalizedNextReference) return item
    assignedNumber = item.citationNumber || index + 1
    return {
      citationNumber: assignedNumber,
      text: nextReferenceText,
    }
  })

  if (!assignedNumber) {
    const currentMax = mergedItems.reduce((maxValue, item, index) => {
      const value = item.citationNumber || index + 1
      return Math.max(maxValue, value)
    }, 0)
    assignedNumber = currentMax + 1
    mergedItems.push({ citationNumber: assignedNumber, text: nextReferenceText })
  }

  const nextBlocks = options.insertMarker === false
    ? blocks
    : blocks.map((block, index) => {
      if (index !== targetIndex || (block.type !== 'paragraph' && block.type !== 'heading')) return block

      const blockText = String(block.text || '')
      const safeFrom = Math.max(0, Math.min(selection.from, blockText.length))
      const safeTo = Math.max(safeFrom, Math.min(selection.to, blockText.length))
      const marker = ` [${assignedNumber}]`
      const nextText = selection.collapsed
        ? `${blockText.slice(0, safeFrom)}${marker}${blockText.slice(safeTo)}`
        : `${blockText.slice(0, safeFrom)}${blockText.slice(safeFrom, safeTo)}${marker}${blockText.slice(safeTo)}`

      return {
        ...block,
        text: nextText,
      }
    })

  const orderedItems = [...mergedItems].sort((left, right) => {
    const leftNumber = left.citationNumber ?? Number.MAX_SAFE_INTEGER
    const rightNumber = right.citationNumber ?? Number.MAX_SAFE_INTEGER
    if (leftNumber === rightNumber) {
      return left.text.localeCompare(right.text, 'zh-CN')
    }
    return leftNumber - rightNumber
  })

  const removeIndexes = new Set<number>(headingIndex >= 0 ? [headingIndex, ...referenceIndexes] : [])
  const contentBlocks = nextBlocks.filter((_block, index) => !removeIndexes.has(index))
  const insertIndex = headingIndex >= 0 ? Math.min(headingIndex, contentBlocks.length) : contentBlocks.length
  const headingText = String(headingBlock?.text || '').trim() || '参考文献'
  const rebuiltReferenceBlocks: EmbeddedEditorBlock[] = [
    {
      id: headingBlock?.id || createBlockId('references-heading'),
      type: 'heading',
      text: headingText,
      level: headingBlock?.type === 'heading' ? Math.max(1, Math.min(headingBlock.level || 1, 6)) : 1,
      paragraphStyle: 'ReferencesHeading',
      alignment: 'left',
    },
    ...orderedItems.map((item, index) => ({
      id: createBlockId('reference'),
      type: 'paragraph' as const,
      text: buildStructuredReferenceText({ text: item.text, citationNumber: item.citationNumber }, index),
      paragraphStyle: 'Reference',
      alignment: 'left' as const,
    })),
  ]

  contentBlocks.splice(insertIndex, 0, ...rebuiltReferenceBlocks)
  return {
    blocks: contentBlocks,
    citationNumber: assignedNumber,
  }
}

function renumberEmbeddedCitationBlocks(blocks: EmbeddedEditorBlock[]): { blocks: EmbeddedEditorBlock[]; remap: Map<number, number>; orderedItems: CitationReferenceItem[] } {
  let headingIndex = -1
  let headingBlock: EmbeddedTextBlock | null = null
  const referenceIndexes: number[] = []
  const existingItems: Array<{ citationNumber: number; text: string }> = []

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (block.type !== 'paragraph' && block.type !== 'heading') continue
    if (block.paragraphStyle !== 'ReferencesHeading' && !isReferencesHeadingText(block.text)) continue

    headingIndex = index
    headingBlock = block
    let cursor = index + 1
    let listOrder = 1

    while (cursor < blocks.length) {
      const candidate = blocks[cursor]
      if (candidate.type !== 'paragraph' && candidate.type !== 'heading') break
      const rawText = String(candidate.text || '').trim()
      if (!rawText) {
        if (candidate.type === 'paragraph' && candidate.paragraphStyle === 'Reference') {
          referenceIndexes.push(cursor)
          cursor += 1
          continue
        }
        break
      }

      if (candidate.type === 'paragraph' && candidate.paragraphStyle === 'Reference') {
        const citationNumber = parseCitationNumber(rawText, listOrder)
        if (citationNumber) {
          existingItems.push({ citationNumber, text: stripCitationPrefix(rawText) })
        }
        referenceIndexes.push(cursor)
        listOrder += 1
        cursor += 1
        continue
      }

      const citationNumber = parseCitationNumber(rawText, listOrder)
      if (!citationNumber) break
      existingItems.push({ citationNumber, text: stripCitationPrefix(rawText) })
      referenceIndexes.push(cursor)
      listOrder += 1
      cursor += 1
    }

    break
  }

  if (headingIndex < 0 || !existingItems.length) {
    return { blocks, remap: new Map<number, number>(), orderedItems: [] }
  }

  const bodyText = blocks
    .filter((_block, index) => index !== headingIndex && !referenceIndexes.includes(index))
    .filter(isEmbeddedTextBlock)
    .map((block) => block.text)
    .join('\n')

  const { remap, orderedItems } = buildCitationRenumberPlan(bodyText, existingItems)
  if (!orderedItems.length) {
    return { blocks, remap: new Map<number, number>(), orderedItems: [] }
  }

  const contentBlocks = blocks
    .filter((_block, index) => index !== headingIndex && !referenceIndexes.includes(index))
    .map((block) => {
      if (block.type !== 'paragraph' && block.type !== 'heading') return block
      return {
        ...block,
        text: updateCitationNumbersInText(block.text, remap),
      }
    })

  const rebuiltReferenceBlocks: EmbeddedEditorBlock[] = [
    {
      id: headingBlock?.id || createBlockId('references-heading'),
      type: 'heading',
      text: String(headingBlock?.text || '').trim() || '参考文献',
      level: headingBlock?.type === 'heading' ? Math.max(1, Math.min(headingBlock.level || 1, 6)) : 1,
      paragraphStyle: 'ReferencesHeading',
      alignment: headingBlock?.alignment || 'left',
      sourceXml: headingBlock?.sourceXml,
    },
    ...orderedItems.map((item, index) => ({
      id: createBlockId('reference'),
      type: 'paragraph' as const,
      text: buildStructuredReferenceText(item, index),
      paragraphStyle: 'Reference',
      alignment: 'left' as const,
    })),
  ]

  contentBlocks.splice(Math.min(headingIndex, contentBlocks.length), 0, ...rebuiltReferenceBlocks)
  return { blocks: contentBlocks, remap, orderedItems }
}

function insertCitationMarkerIntoEmbeddedBlocks(
  blocks: EmbeddedEditorBlock[],
  selection: DocumentEngineSelection,
  marker: string,
): EmbeddedEditorBlock[] | null {
  const targetBlockId = selection.anchorId
  if (!targetBlockId || !marker.trim()) return null

  return blocks.map((block) => {
    if (block.id !== targetBlockId || (block.type !== 'paragraph' && block.type !== 'heading')) return block
    return {
      ...block,
      text: insertCitationMarkerAtSelection(block.text, selection.from, selection.to, marker).text,
    }
  })
}

function upsertMultipleCitationsIntoEmbeddedBlocks(
  blocks: EmbeddedEditorBlock[],
  selection: DocumentEngineSelection,
  citations: CitationItem[],
): { blocks: EmbeddedEditorBlock[]; citationNumbers: number[]; orderedItems: CitationReferenceItem[] } | null {
  const normalizedCitations = dedupeCitationItems(citations)
  if (!normalizedCitations.length) return null

  let nextBlocks = blocks
  const citationNumbers: number[] = []
  for (const citation of normalizedCitations) {
    const updated = upsertCitationIntoEmbeddedBlocks(nextBlocks, selection, citation, { insertMarker: false })
    if (!updated) return null
    nextBlocks = updated.blocks
    citationNumbers.push(updated.citationNumber)
  }

  const marker = formatCitationMarker(citationNumbers)
  const blocksWithMarker = insertCitationMarkerIntoEmbeddedBlocks(nextBlocks, selection, marker)
  if (!blocksWithMarker) return null
  const renumbered = renumberEmbeddedCitationBlocks(blocksWithMarker)
  return {
    blocks: renumbered.blocks,
    citationNumbers: Array.from(new Set(citationNumbers.map((number) => renumbered.remap.get(number) ?? number))).sort((left, right) => left - right),
    orderedItems: renumbered.orderedItems,
  }
}

/**
 * Map an EmbeddedEditorBlock selection (anchorId) to a DocumentSchema block id.
 *
 * Priority:
 *   1. If schema has a block whose id === anchorId, return anchorId directly.
 *   2. Otherwise find the anchorId's positional index in embeddedBlocks, then
 *      return the DocumentSchema paragraph/heading block at that same index.
 *   3. Returns null if the mapping cannot be resolved.
 */
function resolveDocumentSchemaBlockId(
  schema: DocumentSchema,
  embeddedBlocks: EmbeddedEditorBlock[],
  selection: DocumentEngineSelection,
): string | null {
  const anchorId = selection.anchorId
  if (!anchorId) return null

  // Strategy 1: direct id match (happy-path when ids are kept in sync)
  if (schema.blocks.some((b) => b.id === anchorId)) return anchorId

  // Strategy 2: positional index mapping
  // Only text blocks (paragraph/heading) in embeddedBlocks correspond to
  // paragraph/heading blocks in DocumentSchema.
  const embeddedTextBlocks = embeddedBlocks.filter((b) => b.type === 'paragraph' || b.type === 'heading')
  const embeddedIndex = embeddedTextBlocks.findIndex((b) => b.id === anchorId)
  if (embeddedIndex < 0) return null

  const schemaTextBlocks = schema.blocks.filter((b) => b.type === 'paragraph' || b.type === 'heading')
  const schemaBlock = schemaTextBlocks[embeddedIndex]
  return schemaBlock?.id ?? null
}

/**
 * Identify which bibliography items were newly inserted by comparing before/after
 * snapshots of the document.  Returns their `citationNumber` values sorted ascending.
 *
 * Matching strategy (in order of reliability):
 *   1. DOI match: `item.uri` contains the inserted citation's doi.
 *   2. Title match: `item.label` contains the inserted citation's title text.
 *   3. Size-diff fallback: if neither matches, return all items whose
 *      citationNumber is ≤ the number of insertedCitations that were added
 *      (these will be the lowest-numbered fresh items after renumber).
 *
 * This function avoids the id-collision problem: after shifting, a new item
 * may receive the same `citation-N` id that an old item had, so id-diff is
 * not reliable.
 */
function resolveInsertedCitationNumbers(
  beforeDoc: DocumentSchema,
  afterDoc: DocumentSchema,
  insertedCitations: CitationItem[],
): number[] {
  const beforeIds = new Set((beforeDoc.bibliography?.items || []).map((item) => item.id))
  const afterItems = afterDoc.bibliography?.items || []
  const insertedCount = insertedCitations.length

  // Build lookup keys for inserted citations
  const insertedDois = new Set(insertedCitations.map((c) => (c.doi || '').trim().toLowerCase()).filter(Boolean))
  const insertedTitles = insertedCitations.map((c) => (c.citation || '').trim().toLowerCase()).filter(Boolean)

  // Attempt doi/title matching first
  const matched = afterItems.filter((item) => {
    // DOI match
    if (insertedDois.size > 0) {
      const itemUri = (item.uri || '').toLowerCase()
      const itemDoi = (item.metadata?.doi as string || '').toLowerCase()
      if ([...insertedDois].some((doi) => itemUri.includes(doi) || itemDoi.includes(doi))) return true
    }
    // Title match
    if (insertedTitles.length > 0) {
      const itemLabel = item.label.toLowerCase()
      if (insertedTitles.some((title) => title.length > 4 && itemLabel.includes(title))) return true
    }
    return false
  })

  if (matched.length > 0) {
    return matched.map((item) => item.citationNumber).sort((a, b) => a - b)
  }

  // Fallback: the newly inserted items appear as the N items with ids not present before
  // (After renumbering the ids are reassigned, so we use a count-based heuristic:
  //  the bibliography grew by `insertedCount` items; pick the lowest `insertedCount`
  //  citationNumbers among items that didn't exist before — which would be the
  //  freshly-created ones that were pushed to the front.)
  const sizeGrowth = afterItems.length - (beforeDoc.bibliography?.items || []).length
  if (sizeGrowth > 0) {
    const growth = Math.min(sizeGrowth, insertedCount)
    // After renumbering, the anchor block's new citations are the lowest numbered ones
    // in the target block.  Simply return the `growth` smallest citation numbers as
    // a best-effort hint for the status message.
    const sorted = afterItems.slice().sort((a, b) => a.citationNumber - b.citationNumber)
    return sorted.slice(0, growth).map((item) => item.citationNumber)
  }

  // No reliable signal — return empty (status message will omit the number)
  return []
}

/**
 * Convert a DocumentSchema to EmbeddedEditorBlock[] for live editor display,
 * always rebuilding the bottom references-section from `document.bibliography`.
 *
 * Differences from `documentSchemaBlocksToEmbeddedEditorBlocks`:
 * - Old `references-section` blocks in `document.blocks` are stripped.
 * - A fresh heading + paragraph list is appended from `bibliography.items`
 *   so the editor immediately reflects the latest citation state.
 */
function documentSchemaToEditorBlocksWithBibliography(schema: DocumentSchema): EmbeddedEditorBlock[] {
  const resourceMap = new Map<string, DocumentResource>()
  for (const res of (schema.resources || [])) resourceMap.set(res.id, res)

  const result: EmbeddedEditorBlock[] = []

  for (const block of schema.blocks) {
    // Strip old references-section blocks — will be rebuilt from bibliography
    if (block.metadata?.role === 'references-section') continue

    if (block.type === 'heading') {
      result.push({
        id: block.id,
        type: 'heading',
        text: block.text,
        level: (block.level as 1 | 2 | 3 | 4 | 5 | 6 | undefined) ?? 1,
        paragraphStyle: `Heading${block.level ?? 1}`,
        alignment: 'left',
      } satisfies EmbeddedTextBlock)
      continue
    }

    if (block.type === 'paragraph') {
      result.push({
        id: block.id,
        type: 'paragraph',
        text: block.text,
        paragraphStyle: block.styleRef || 'Normal',
        alignment: 'left',
      } satisfies EmbeddedTextBlock)
      continue
    }

    if (block.type === 'image') {
      const resource = resourceMap.get(block.resourceRef)
      const previewSrc = resource?.path || (resource?.metadata?.url as string | undefined)
      const displaySrc = previewSrc && /^(?:[a-z]+:|data:)/i.test(previewSrc) ? previewSrc : (previewSrc ? toFileUrl(previewSrc) : undefined)
      const caption = String(block.value?.caption || block.metadata?.caption || resource?.metadata?.caption || '')
      const figureIndex = block.metadata?.figureIndex ?? resource?.metadata?.figureIndex
      const sectionNum = block.metadata?.sectionNum ?? resource?.metadata?.sectionNum
      const figureTitle = sectionNum && figureIndex ? `Figure ${sectionNum}.${figureIndex}` : '图片'
      result.push({
        id: block.id,
        type: 'image',
        alt: figureTitle,
        title: figureTitle,
        caption,
        paperGenerated: block.metadata?.source === 'paper-generation' || resource?.metadata?.source === 'paper-generation',
        previewSrc: displaySrc,
        mediaPath: resource?.path || undefined,
      } satisfies EmbeddedImageBlock)
      continue
    }

    if (block.type === 'table') {
      const tableValue = block.value
      if (tableValue?.rows && Array.isArray(tableValue.rows)) {
        const rows: EmbeddedTableCell[][] = tableValue.rows.map((row, _ri) =>
          (row as (string | number | boolean | null)[]).map((cell, ci) => ({
            text: String(cell ?? ''),
            paragraphs: [{ text: String(cell ?? '') }],
            colspan: 1,
            rowspan: 1,
            header: _ri === 0,
            column: ci,
          })),
        )
        result.push({
          id: block.id,
          type: 'table',
          rows: rows.length,
          cols: rows[0]?.length ?? 0,
          tableRows: rows,
        } satisfies EmbeddedTableBlock)
      }
      continue
    }
    // slot / unknown — skip
  }

  // Append live bibliography section derived from document.bibliography
  const bibItems: DocumentBibliographyItem[] = (schema.bibliography?.items?.length
    ? schema.bibliography.items
    : (schema.citations || schema.sourceRefs || [])
      .filter((item) => item.kind === 'citation')
      .map((item, index) => ({
        id: item.id || `citation-${index + 1}`,
        citationNumber: Number((item.metadata as Record<string, unknown> | undefined)?.citationNumber || index + 1),
        label: item.label || String((item.metadata as Record<string, unknown> | undefined)?.title || ''),
        uri: item.uri,
        metadata: item.metadata,
      }))).slice().sort((a, b) => a.citationNumber - b.citationNumber)
  if (bibItems.length > 0) {
    const bodyText = schema.blocks
      .filter((block) => block.metadata?.role !== 'references-section' && (block.type === 'heading' || block.type === 'paragraph'))
      .map((block) => String((block as { text?: string }).text || ''))
      .join('\n')
    const referencesHeading = /[\u4e00-\u9fff]/.test(bodyText) ? '参考文献' : 'References'
    result.push({
      id: createBlockId('references-heading'),
      type: 'heading',
      text: referencesHeading,
      level: 1,
      paragraphStyle: 'ReferencesHeading',
      alignment: 'left',
    } satisfies EmbeddedTextBlock)
    for (const item of bibItems) {
      result.push({
        id: createBlockId('reference'),
        type: 'paragraph',
        text: renderBibliographyItemLabel(item),
        paragraphStyle: 'Reference',
        alignment: 'left',
      } satisfies EmbeddedTextBlock)
    }
  }

  return result.length > 0 ? result : [{ id: createBlockId('paragraph'), type: 'paragraph', text: '' } satisfies EmbeddedTextBlock]
}

function structuredPayloadBlocksToEditorBlocks(blocks: EmbeddedPayloadBlock[]): EmbeddedEditorBlock[] {
  const editorBlocks: EmbeddedEditorBlock[] = []

  const pushTextBlock = (block: EmbeddedTextBlock) => {
    editorBlocks.push({
      ...block,
      id: block.id || createBlockId(block.type),
      paragraphStyle: normalizeParagraphStyleId(block.paragraphStyle),
    })
  }

  const pushFootnotes = (items: EmbeddedFootnoteItem[] | undefined) => {
    if (!Array.isArray(items) || items.length === 0) return
    items.forEach((item, index) => {
      pushTextBlock({
        id: createBlockId('footnote'),
        type: 'paragraph',
        text: buildStructuredFootnoteText(item, index),
        paragraphStyle: 'Footnote',
        alignment: 'left',
      })
    })
  }

  blocks.forEach((block) => {
    if (block.type === 'paragraph' || block.type === 'heading') {
      pushTextBlock({
        id: block.id || createBlockId(block.type),
        type: block.type,
        text: block.text,
        level: block.level,
        paragraphStyle: block.paragraphStyle,
        paperStyle: block.paperStyle,
        alignment: block.alignment,
        indentLevel: block.indentLevel,
        listType: block.listType,
        listLevel: block.listLevel,
      })
      return
    }

    if (block.type === 'image') {
      editorBlocks.push({
        id: block.id || createBlockId('image'),
        type: 'image',
        alt: block.alt,
        title: block.title,
        sourceId: block.sourceId,
        mediaPath: block.mediaPath,
        mediaContentType: block.mediaContentType,
        previewSrc: block.previewSrc,
      })
      pushFootnotes(block.footnotes)
      return
    }

    if (block.type === 'formula') {
      editorBlocks.push({
        id: block.id || createBlockId('formula'),
        type: 'formula',
        latex: block.latex,
        display: block.display,
      })
      return
    }

    if (block.type === 'table') {
      editorBlocks.push({
        id: block.id || createBlockId('table'),
        type: 'table',
        rows: block.rows,
        cols: block.cols,
        tableRows: block.tableRows,
      })
      pushFootnotes(block.footnotes)
      return
    }

    if (block.type === 'caption') {
      pushTextBlock({
        id: block.id || createBlockId('caption'),
        type: 'paragraph',
        text: block.text,
        paragraphStyle: 'Caption',
        alignment: 'center',
      })
      return
    }

    if (block.type === 'reference-list') {
      if (block.heading) {
        pushTextBlock({
          id: createBlockId('references-heading'),
          type: 'heading',
          text: block.heading,
          level: 1,
          paragraphStyle: 'ReferencesHeading',
          alignment: 'left',
        })
      }
      block.items.forEach((item, index) => {
        pushTextBlock({
          id: createBlockId('reference'),
          type: 'paragraph',
          text: buildStructuredReferenceText(item, index),
          paragraphStyle: 'Reference',
          alignment: 'left',
        })
      })
      return
    }

    if (block.type === 'footnote-list') {
      if (block.heading) {
        pushTextBlock({
          id: createBlockId('footnotes-heading'),
          type: 'heading',
          text: block.heading,
          level: 1,
          paragraphStyle: 'FootnotesHeading',
          alignment: 'left',
        })
      }
      block.items.forEach((item, index) => {
        pushTextBlock({
          id: createBlockId('footnote'),
          type: 'paragraph',
          text: buildStructuredFootnoteText(item, index),
          paragraphStyle: 'Footnote',
          alignment: 'left',
        })
      })
    }
  })

  return editorBlocks
}

function looksLikeDocumentTitle(text: string): boolean {
  const normalized = String(text || '').trim()
  if (!normalized || normalized.length > 140) return false
  if (/^[#*\-]/.test(normalized)) return false
  if (/^(摘要|关键词|关键字|abstract|keywords?)[:：]?$/i.test(normalized)) return false
  return !/[。！？.!?；;:]$/.test(normalized)
}

function looksLikeLevelOneHeading(text: string): boolean {
  const normalized = String(text || '').trim()
  if (!normalized) return false
  if (/^#\s+/.test(normalized)) return true
  if (/^(第[一二三四五六七八九十百]+[章节部分]|[一二三四五六七八九十]+[、.．]|\d+[、.．])\s*/.test(normalized)) return true
  return false
}

function hasStructuredTextMarkers(text: string): boolean {
  return /\n/.test(text)
    || /^(#{1,6})\s+/m.test(text)
    || /^(摘要|abstract|关键词|关键字|keywords?)(?:[:：]|\s|$)/im.test(text)
}

function normalizeStructuredTextBlocks(blocks: EmbeddedEditorBlock[]): EmbeddedEditorBlock[] {
  const normalizedBlocks: EmbeddedEditorBlock[] = []

  const pushParagraph = (text: string, paragraphStyle?: string, alignment?: EmbeddedTextBlock['alignment']) => {
    const trimmed = String(text || '').trim()
    if (!trimmed) return
    normalizedBlocks.push({
      id: createBlockId('paragraph'),
      type: 'paragraph',
      text: trimmed,
      paragraphStyle,
      alignment,
    })
  }

  blocks.forEach((block, index) => {
    if (block.type !== 'paragraph' && block.type !== 'heading') {
      normalizedBlocks.push(block)
      return
    }

    const normalizedBlock: EmbeddedTextBlock = {
      ...block,
      paragraphStyle: normalizeParagraphStyleId(block.paragraphStyle),
    }
    const sourceText = String(normalizedBlock.text || '').replace(/\r/g, '').trim()
    if (!sourceText || !hasStructuredTextMarkers(sourceText)) {
      normalizedBlocks.push(normalizedBlock)
      return
    }

    const lines = sourceText.split('\n').map((line) => line.trim()).filter(Boolean)
    if (!lines.length) {
      normalizedBlocks.push(normalizedBlock)
      return
    }

    let cursor = 0
    const paragraphBuffer: string[] = []
    const flushParagraphBuffer = (style?: string, alignment?: EmbeddedTextBlock['alignment']) => {
      if (!paragraphBuffer.length) return
      pushParagraph(paragraphBuffer.join('\n'), style, alignment)
      paragraphBuffer.length = 0
    }

    if (index === 0 && normalizedBlock.type === 'paragraph' && !normalizedBlock.paragraphStyle && looksLikeDocumentTitle(lines[0])) {
      normalizedBlocks.push({
        id: createBlockId('paragraph'),
        type: 'paragraph',
        text: lines[0],
        paragraphStyle: 'Title',
        alignment: 'center',
      })
      cursor = 1
    }

    for (; cursor < lines.length; cursor += 1) {
      const line = lines[cursor]
      const markdownHeadingMatch = line.match(/^(#{1,6})\s+(.+)$/)
      if (markdownHeadingMatch) {
        flushParagraphBuffer()
        const level = Math.max(1, Math.min(markdownHeadingMatch[1].length, 6))
        const headingText = markdownHeadingMatch[2].trim()
        const abstractInline = headingText.match(/^(摘要|abstract)(?:[:：]\s*|\s+)(.+)$/i)
        if (abstractInline) {
          normalizedBlocks.push({ id: createBlockId('heading'), type: 'heading', text: abstractInline[1], level, paragraphStyle: 'AbstractHeading', alignment: 'center' })
          pushParagraph(abstractInline[2], 'Abstract', 'justify')
          continue
        }
        const keywordsInline = headingText.match(/^(关键词|关键字|keywords?)(?:[:：]\s*|\s+)(.+)$/i)
        if (keywordsInline) {
          normalizedBlocks.push({ id: createBlockId('heading'), type: 'heading', text: keywordsInline[1], level, paragraphStyle: 'KeywordsHeading', alignment: 'left' })
          pushParagraph(keywordsInline[2], 'Keywords', 'left')
          continue
        }
        normalizedBlocks.push({ id: createBlockId('heading'), type: 'heading', text: headingText, level, paragraphStyle: `Heading${level}` })
        continue
      }

      const abstractInline = line.match(/^(摘要|abstract)(?:[:：]\s*|\s+)(.+)$/i)
      if (abstractInline) {
        flushParagraphBuffer()
        normalizedBlocks.push({ id: createBlockId('heading'), type: 'heading', text: abstractInline[1], level: 1, paragraphStyle: 'AbstractHeading', alignment: 'center' })
        pushParagraph(abstractInline[2], 'Abstract', 'justify')
        continue
      }

      if (/^(摘要|abstract)$/i.test(line)) {
        flushParagraphBuffer()
        normalizedBlocks.push({ id: createBlockId('heading'), type: 'heading', text: line, level: 1, paragraphStyle: 'AbstractHeading', alignment: 'center' })
        const abstractBody: string[] = []
        while (cursor + 1 < lines.length) {
          const nextLine = lines[cursor + 1]
          if (/^(#{1,6})\s+/.test(nextLine) || /^(关键词|关键字|keywords?)(?:[:：]|\s|$)/i.test(nextLine) || looksLikeLevelOneHeading(nextLine)) {
            break
          }
          cursor += 1
          abstractBody.push(lines[cursor])
        }
        if (abstractBody.length) {
          pushParagraph(abstractBody.join('\n'), 'Abstract', 'justify')
        }
        continue
      }

      const keywordInline = line.match(/^(关键词|关键字|keywords?)(?:[:：]\s*|\s+)(.+)$/i)
      if (keywordInline) {
        flushParagraphBuffer()
        normalizedBlocks.push({ id: createBlockId('heading'), type: 'heading', text: keywordInline[1], level: 1, paragraphStyle: 'KeywordsHeading', alignment: 'left' })
        pushParagraph(keywordInline[2], 'Keywords', 'left')
        continue
      }

      if (/^(关键词|关键字|keywords?)$/i.test(line)) {
        flushParagraphBuffer()
        normalizedBlocks.push({ id: createBlockId('heading'), type: 'heading', text: line, level: 1, paragraphStyle: 'KeywordsHeading', alignment: 'left' })
        continue
      }

      if (looksLikeLevelOneHeading(line) && normalizedBlock.type === 'paragraph') {
        flushParagraphBuffer()
        const headingText = line.replace(/^(第[一二三四五六七八九十百]+[章节部分]\s*|[一二三四五六七八九十]+[、.．]\s*|\d+[、.．]\s*)/, '').trim() || line
        normalizedBlocks.push({ id: createBlockId('heading'), type: 'heading', text: headingText, level: 1, paragraphStyle: 'Heading1' })
        continue
      }

      paragraphBuffer.push(line)
    }

    flushParagraphBuffer(normalizedBlock.paragraphStyle, normalizedBlock.alignment)
  })

  return promoteSemanticPaperTextStyles(normalizedBlocks.length ? normalizedBlocks : blocks)
}

function promoteSemanticPaperTextStyles(blocks: EmbeddedEditorBlock[]): EmbeddedEditorBlock[] {
  let titleAssigned = false
  let currentSection: 'abstract' | 'keywords' | null = null

  return blocks.map((block) => {
    if (block.type !== 'paragraph' && block.type !== 'heading') {
      return block
    }

    let nextBlock: EmbeddedTextBlock = {
      ...block,
      paragraphStyle: normalizeParagraphStyleId(block.paragraphStyle),
    }
    const text = String(nextBlock.text || '').trim()

    if (!titleAssigned && nextBlock.paragraphStyle === 'Title') {
      titleAssigned = true
      currentSection = null
      if (!nextBlock.alignment) {
        nextBlock = { ...nextBlock, alignment: 'center' }
      }
      return nextBlock
    }

    if (!text) {
      return nextBlock
    }

    if (!titleAssigned && nextBlock.type === 'heading' && (nextBlock.level || 1) === 1 && !/^(摘要|abstract|关键词|关键字|keywords?)$/i.test(text)) {
      titleAssigned = true
      currentSection = null
      return {
        ...nextBlock,
        paragraphStyle: 'Title',
        alignment: nextBlock.alignment || 'center',
      }
    }

    if (!titleAssigned && nextBlock.type === 'paragraph' && !nextBlock.paragraphStyle && looksLikeDocumentTitle(text)) {
      titleAssigned = true
      currentSection = null
      return {
        ...nextBlock,
        paragraphStyle: 'Title',
        alignment: nextBlock.alignment || 'center',
      }
    }

    if (nextBlock.paragraphStyle === 'AbstractHeading' || /^(摘要|abstract)$/i.test(text)) {
      currentSection = 'abstract'
      return {
        ...nextBlock,
        paragraphStyle: 'AbstractHeading',
        alignment: 'center',
      }
    }

    if (nextBlock.paragraphStyle === 'KeywordsHeading' || /^(关键词|关键字|keywords?)$/i.test(text)) {
      currentSection = 'keywords'
      return {
        ...nextBlock,
        paragraphStyle: 'KeywordsHeading',
        alignment: 'left',
      }
    }

    if (nextBlock.type === 'heading') {
      currentSection = null
      return nextBlock
    }

    if (currentSection === 'abstract') {
      return {
        ...nextBlock,
        paragraphStyle: 'Abstract',
        alignment: nextBlock.alignment || 'justify',
      }
    }

    if (currentSection === 'keywords') {
      return {
        ...nextBlock,
        paragraphStyle: 'Keywords',
        alignment: nextBlock.alignment || 'left',
      }
    }

    return nextBlock
  })
}

function getTextBlockStyleValue(block: EmbeddedTextBlock): string {
  if (block.type === 'heading') {
    if (block.paragraphStyle === 'AbstractHeading') return 'abstract-heading'
    if (block.paragraphStyle === 'KeywordsHeading') return 'keywords-heading'
    return `heading-${Math.min(Math.max(block.level || 1, 1), 6)}`
  }
  if (block.paragraphStyle === 'Abstract') return 'abstract'
  if (block.paragraphStyle === 'Keywords') return 'keywords'
  if (block.paragraphStyle === 'Caption') return 'caption'
  if (block.paragraphStyle === 'Reference') return 'reference'
  if (block.paragraphStyle === 'Footnote') return 'footnote'
  return block.paragraphStyle === 'Title' ? 'title' : 'paragraph'
}

function isAbstractTextBlock(block: EmbeddedTextBlock): boolean {
  const text = String(block.text || '').trim()
  return block.paragraphStyle === 'Abstract' || block.paragraphStyle === 'AbstractHeading' || /^(摘要|abstract)(?:[:：]|\s|$)/i.test(text)
}

function isKeywordsTextBlock(block: EmbeddedTextBlock): boolean {
  const text = String(block.text || '').trim()
  return block.paragraphStyle === 'Keywords' || block.paragraphStyle === 'KeywordsHeading' || /^(关键词|关键字|keywords?)(?:[:：]|\s|$)/i.test(text)
}

function getTextBlockLabel(block: EmbeddedTextBlock): string {
  if (block.paragraphStyle === 'Title') return 'Title'
  if (block.paragraphStyle === 'AbstractHeading') return 'Abstract Heading'
  if (isAbstractTextBlock(block)) return 'Abstract'
  if (block.paragraphStyle === 'KeywordsHeading') return 'Keywords Heading'
  if (isKeywordsTextBlock(block)) return 'Keywords'
  if (block.paragraphStyle === 'ReferencesHeading') return 'References Heading'
  if (block.paragraphStyle === 'FootnotesHeading') return 'Footnotes Heading'
  if (block.paragraphStyle === 'Caption') return 'Caption'
  if (block.paragraphStyle === 'Reference') return 'Reference'
  if (block.paragraphStyle === 'Footnote') return 'Footnote'
  if (block.type === 'heading') return `Heading ${Math.min(Math.max(block.level || 1, 1), 6)}`
  return 'Paragraph'
}

function getTextBlockEditorStyle(block: EmbeddedTextBlock): React.CSSProperties {
  const basePaddingLeft = `${10 + (block.indentLevel || 0) * 18}px`
  const serifFont = `'Times New Roman', 'Noto Serif SC', 'Source Han Serif SC', 'STSong', serif`
  const paperStyle = parsePaperStyle(block.paperStyle)
  const applyPaperStyle = (style: React.CSSProperties): React.CSSProperties => ({
    ...style,
    fontFamily: paperStyle['font-family'] || style.fontFamily,
    fontSize: paperStyle['font-size'] || style.fontSize,
    lineHeight: paperStyle['line-height'] || style.lineHeight,
    textIndent: paperStyle['text-indent'] || style.textIndent,
    marginTop: paperStyle['margin-top'] || style.marginTop,
    marginBottom: paperStyle['margin-bottom'] || style.marginBottom,
  })
  if (block.paragraphStyle === 'Title') {
    return applyPaperStyle({
      fontSize: '30px',
      fontWeight: 800,
      lineHeight: 1.35,
      textAlign: block.alignment || 'center',
      paddingLeft: '10px',
      letterSpacing: '0.02em',
      fontFamily: serifFont,
    })
  }
  if (block.paragraphStyle === 'AbstractHeading') {
    return applyPaperStyle({
      fontSize: '18px',
      fontWeight: 700,
      lineHeight: 1.6,
      textAlign: 'center',
      paddingLeft: '10px',
      letterSpacing: '0.08em',
      fontFamily: serifFont,
    })
  }
  if (isAbstractTextBlock(block)) {
    return applyPaperStyle({
      fontSize: '16px',
      fontWeight: 400,
      lineHeight: 1.9,
      textAlign: block.alignment || 'justify',
      paddingLeft: basePaddingLeft,
      fontFamily: serifFont,
    })
  }
  if (block.paragraphStyle === 'KeywordsHeading') {
    return applyPaperStyle({
      fontSize: '16px',
      fontWeight: 700,
      lineHeight: 1.6,
      textAlign: 'left',
      paddingLeft: '10px',
      letterSpacing: '0.04em',
      fontFamily: serifFont,
    })
  }
  if (isKeywordsTextBlock(block)) {
    return applyPaperStyle({
      fontSize: '15px',
      fontWeight: 600,
      lineHeight: 1.8,
      textAlign: block.alignment || 'left',
      paddingLeft: basePaddingLeft,
      fontFamily: serifFont,
    })
  }
  if (block.paragraphStyle === 'Caption') {
    return applyPaperStyle({
      fontSize: '13px',
      fontWeight: 400,
      lineHeight: 1.7,
      textAlign: 'center',
      paddingLeft: '10px',
      color: '#6b7280',
      fontFamily: serifFont,
    })
  }
  if (block.paragraphStyle === 'Reference') {
    return applyPaperStyle({
      fontSize: '14px',
      fontWeight: 400,
      lineHeight: 1.85,
      textAlign: 'left',
      paddingLeft: '10px',
      fontFamily: serifFont,
    })
  }
  if (block.paragraphStyle === 'Footnote') {
    return applyPaperStyle({
      fontSize: '13px',
      fontWeight: 400,
      lineHeight: 1.7,
      textAlign: 'left',
      paddingLeft: '10px',
      color: '#4b5563',
      fontFamily: serifFont,
    })
  }
  if (block.type === 'heading') {
    const headingLevel = Math.min(Math.max(block.level || 1, 1), 6)
    return applyPaperStyle({
      fontSize: `${Math.max(20, 34 - headingLevel * 2)}px`,
      fontWeight: 700,
      lineHeight: 1.5,
      textAlign: block.alignment || 'left',
      paddingLeft: basePaddingLeft,
      fontFamily: serifFont,
    })
  }
  return applyPaperStyle({
    fontSize: '15px',
    textAlign: block.alignment || 'left',
    paddingLeft: basePaddingLeft,
    lineHeight: 1.9,
    fontFamily: serifFont,
  })
}

export default function EmbeddedOfficeEnginePanel() {
  const {
    markdown,
    setMarkdown,
    filePath,
    dirty,
    isGenerating,
    currentFileName,
    activeTabId,
    tabs,
    articleType,
    openTab,
    markTabSaved,
    setStatusMessage,
  } = useDocument()
  const knowledge = useKnowledge()
  const { activeWorkspacePath, refreshTree } = useWorkspace()
  const { language } = useLanguage()
  const { requestOpenFromDialog, saveActiveDocument, saveActiveDocumentAs } = useDocumentEngineHostCommands()
  const [blocks, setBlocks] = useState<EmbeddedEditorBlock[]>(() => parseHtmlToBlocks(markdown))
  const [packageSummary, setPackageSummary] = useState<{ paragraphCount: number; entryCount: number } | null>(null)
  const [draggingImageBlockId, setDraggingImageBlockId] = useState<string | null>(null)
  const [lockedAspectRatios, setLockedAspectRatios] = useState<Record<string, boolean>>({})
  const [tableSelections, setTableSelections] = useState<Record<string, TableSelection | null>>({})
  const [imageResizeState, setImageResizeState] = useState<ImageResizeState | null>(null)
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null)
  const [inlineRewrite, setInlineRewrite] = useState<null | { original: string; rewritten: string; range: DocumentEngineSelection; streaming: boolean }>(null)
  const [inlineRef, setInlineRef] = useState<null | { selectedText: string; range: DocumentEngineSelection; citations: CitationItem[]; loading: boolean; selectedCitationKeys: string[] }>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [continueStatus, setContinueStatus] = useState<{ phase: 'idle' | 'running' | 'completed' | 'stopped' | 'error'; message: string; insertedChars: number }>({ phase: 'idle', message: '', insertedChars: 0 })
  const [ctxMenu, setCtxMenu] = useState<EmbeddedCtxMenuState | null>(null)
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerTopic, setComposerTopic] = useState('')
  const [composerAutoStartNonce, setComposerAutoStartNonce] = useState(0)
  const [composerInitialMode, setComposerInitialMode] = useState<ComposerMode>('document')
  const [composerDocumentFlow, setComposerDocumentFlow] = useState<'auto' | 'paper-generation' | 'assistant'>('auto')
  const [composerAutoRunOnOpen, setComposerAutoRunOnOpen] = useState(false)
  const [composerSelection, setComposerSelection] = useState<ComposerSelectionState | null>(null)
  const [composerSelectionStructureContext, setComposerSelectionStructureContext] = useState<StructuredRemakeContext | null>(null)
  const [composerRunning, setComposerRunning] = useState(false)
  const activeTab = tabs.find((tab) => tab.id === activeTabId) || null
  const activeTabPreview = activeTab?.preview || null
  const isReadonlyPreviewTab = Boolean(activeTabPreview)
  const isPdfPreviewTab = activeTabPreview?.kind === 'pdf'
  const blocksRef = useRef<EmbeddedEditorBlock[]>(parseHtmlToBlocks(markdown))
  const markdownRef = useRef(markdown)
  const serializedHtmlRef = useRef(markdown)
  const blockEditorRefs = useRef<Record<string, HTMLTextAreaElement | null>>({})
  const activeTextBlockIdRef = useRef<string | null>(null)
  const continueAbortRef = useRef<AbortController | null>(null)
  const rewriteAbortRef = useRef<AbortController | null>(null)
  // DocumentSchema authority: updated when workspace document.json is loaded or paper generation completes
  const currentDocumentSchemaRef = useRef<DocumentSchema | null>(null)
  const syncSnapshot = useCallback(async (targetPath: string | null) => {
    if (!targetPath || !targetPath.toLowerCase().endsWith('.docx')) {
      setPackageSummary(null)
      return
    }

    try {
      const snapshot = await window.electronAPI.readOoxmlPackage(targetPath)
      if (!snapshot.exists) {
        setPackageSummary(null)
        return
      }
      setPackageSummary({ paragraphCount: snapshot.paragraphCount, entryCount: snapshot.entryCount })
    } catch {
      setPackageSummary(null)
    }
  }, [])

  const commitBlocks = useCallback((nextBlocks: EmbeddedEditorBlock[]) => {
    const normalizedBlocks: EmbeddedEditorBlock[] = nextBlocks.length > 0
      ? nextBlocks
      : [{ id: createBlockId('paragraph'), type: 'paragraph', text: '' }]
    blocksRef.current = normalizedBlocks
    setBlocks(normalizedBlocks)
    const nextHtml = serializeBlocksToHtml(normalizedBlocks)
    serializedHtmlRef.current = nextHtml
    markdownRef.current = nextHtml
    setMarkdown(nextHtml)
  }, [setMarkdown])

  const setDocumentContent = useCallback((content: string | Record<string, any>) => {
    const nextSource = typeof content === 'string' ? content : ''
    const nextBlocks = parseHtmlToBlocks(nextSource)
    commitBlocks(nextBlocks)
  }, [commitBlocks])

  useEffect(() => {
    if (isReadonlyPreviewTab) {
      blocksRef.current = []
      markdownRef.current = ''
      serializedHtmlRef.current = ''
      setBlocks([])
      return
    }
    const structuredPayload = decodeEmbeddedDocumentPayload(markdown)
    if (structuredPayload?.blocks?.length) {
      const nextBlocks = parseHtmlToBlocks(markdown)
      const nextHtml = serializeBlocksToHtml(nextBlocks)
      blocksRef.current = nextBlocks
      serializedHtmlRef.current = nextHtml
      markdownRef.current = nextHtml
      setBlocks(nextBlocks)
      return
    }

    markdownRef.current = markdown
    if (markdown === serializedHtmlRef.current) return
    const nextBlocks = parseHtmlToBlocks(markdown)
    blocksRef.current = nextBlocks
    setBlocks(nextBlocks)
  }, [isReadonlyPreviewTab, markdown])

  useEffect(() => {
    if (!isReadonlyPreviewTab) return
    setActiveBlockId(null)
    setCtxMenu(null)
    setInlineRewrite(null)
    setInlineRef(null)
    setComposerOpen(false)
    setImageResizeState(null)
  }, [isReadonlyPreviewTab])

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

  useEffect(() => {
    void syncSnapshot(filePath)
  }, [filePath, syncSnapshot])

  // Keep currentDocumentSchemaRef up-to-date whenever a workspace document is loaded
  // (workspace-document-loaded) or saved (ai-event with document_saved/documentSchema).
  useEffect(() => {
    const onWorkspaceDocumentLoaded = (event: Event) => {
      const detail = (event as CustomEvent<any>).detail || {}
      const documentSchema = detail.documentSchema as DocumentSchema | undefined
      if (documentSchema && Array.isArray(documentSchema.blocks) && (documentSchema.profile === 'paper' || documentSchema.document?.metadata?.generatedBy === 'paper-generation')) {
        currentDocumentSchemaRef.current = documentSchema
      }
    }
    const onAiEvent = (event: Event) => {
      const detail = (event as CustomEvent<any>).detail || {}
      // paper generation done event carries documentSchema
      const documentSchema = detail.documentSchema as DocumentSchema | undefined
      if (documentSchema && Array.isArray(documentSchema.blocks) && (documentSchema.profile === 'paper' || documentSchema.document?.metadata?.generatedBy === 'paper-generation')) {
        currentDocumentSchemaRef.current = documentSchema
      }
    }
    window.addEventListener('workspace-document-loaded', onWorkspaceDocumentLoaded as EventListener)
    window.addEventListener('ai-event', onAiEvent as EventListener)
    return () => {
      window.removeEventListener('workspace-document-loaded', onWorkspaceDocumentLoaded as EventListener)
      window.removeEventListener('ai-event', onAiEvent as EventListener)
    }
  }, [])

  // Eagerly load DocumentSchema from workspace when workspace path changes
  useEffect(() => {
    if (!activeWorkspacePath || !window.electronAPI?.readWorkspaceDocumentSchema) return
    void window.electronAPI.readWorkspaceDocumentSchema(activeWorkspacePath)
      .then((result: any) => {
        if (result?.document && Array.isArray(result.document.blocks)) {
          const loadedDocument = result.document as DocumentSchema
          if (loadedDocument.profile === 'paper' || loadedDocument.document?.metadata?.generatedBy === 'paper-generation') {
            currentDocumentSchemaRef.current = loadedDocument
            commitBlocks(documentSchemaToEditorBlocksWithBibliography(loadedDocument))
          }
        }
      })
      .catch(() => undefined)
  }, [activeWorkspacePath, commitBlocks])

  useEffect(() => {
    const onPaperPreviewSync = (event: Event) => {
      const detail = (event as CustomEvent<any>).detail || {}
      if (detail.tabId && detail.tabId !== activeTabId) return
      const documentSchema = detail.documentSchema as DocumentSchema | undefined
      if (!documentSchema || !Array.isArray(documentSchema.blocks)) return
      if (documentSchema.profile !== 'paper' && documentSchema.document?.metadata?.generatedBy !== 'paper-generation') return
      currentDocumentSchemaRef.current = documentSchema
      const nextBlocks = documentSchemaToEditorBlocksWithBibliography(documentSchema)
      commitBlocks(nextBlocks)
      const hasBibliography = (documentSchema.bibliography?.items?.length || 0) > 0
      const hasReferenceSection = nextBlocks.some((block) => block.type === 'heading' && block.paragraphStyle === 'ReferencesHeading')
      if (hasBibliography && !hasReferenceSection) {
        console.warn('[paper-generation] bibliography exists but editor references-section was not rendered')
      }
      const fallbackImageCount = Number(documentSchema.document?.metadata?.fallbackImageCount || 0)
      if (fallbackImageCount > 0) {
        setStatusMessage('部分图片未匹配到章节，已放入文末')
      }
    }
    window.addEventListener('ai-writer-paper-preview-sync', onPaperPreviewSync as EventListener)
    return () => window.removeEventListener('ai-writer-paper-preview-sync', onPaperPreviewSync as EventListener)
  }, [activeTabId, commitBlocks, setStatusMessage])

  const getSelection = useCallback((): DocumentEngineSelection | null => {
    const activeBlockId = activeTextBlockIdRef.current
    if (!activeBlockId) return null
    const element = blockEditorRefs.current[activeBlockId]
    if (!element) return null

    const from = element.selectionStart || 0
    const to = element.selectionEnd || 0
    const activeBlock = blocksRef.current.find((block) => block.id === activeBlockId)
    if (!activeBlock || (activeBlock.type !== 'paragraph' && activeBlock.type !== 'heading')) {
      return null
    }
    return {
      from,
      to,
      text: activeBlock.text.slice(from, to),
      collapsed: from === to,
      anchorId: activeBlockId,
    }
  }, [])

  const updateTextBlock = useCallback((blockId: string, nextText: string) => {
    commitBlocks(blocksRef.current.map((block) => {
      if (block.id !== blockId || (block.type !== 'paragraph' && block.type !== 'heading')) return block
      return { ...block, text: nextText }
    }))
  }, [commitBlocks])

  const updateTextBlockFormatting = useCallback((blockId: string, updater: (block: EmbeddedTextBlock) => EmbeddedTextBlock) => {
    commitBlocks(blocksRef.current.map((block) => {
      if (block.id !== blockId || (block.type !== 'paragraph' && block.type !== 'heading')) return block
      return updater(block)
    }))
  }, [commitBlocks])

  const updateBlock = useCallback((blockId: string, updater: (block: EmbeddedEditorBlock) => EmbeddedEditorBlock) => {
    commitBlocks(blocksRef.current.map((block) => {
      if (block.id !== blockId) return block
      const nextBlock = updater(block)
      return nextBlock.type === 'table' ? normalizeTableBlock(nextBlock) : nextBlock
    }))
  }, [commitBlocks])

  const insertBlockAfterSelection = useCallback((nextBlock: EmbeddedEditorBlock) => {
    const currentBlocks = [...blocksRef.current]
    const activeBlockId = activeTextBlockIdRef.current
    const insertIndex = activeBlockId ? currentBlocks.findIndex((block) => block.id === activeBlockId) : -1
    if (insertIndex >= 0) {
      currentBlocks.splice(insertIndex + 1, 0, nextBlock)
    } else {
      currentBlocks.push(nextBlock)
    }
    commitBlocks(currentBlocks)
  }, [commitBlocks])

  const insertTextAtSelection = useCallback((text: string) => {
    const activeBlockId = activeTextBlockIdRef.current
    if (!activeBlockId) {
      insertBlockAfterSelection({ id: createBlockId('paragraph'), type: 'paragraph', text })
      return
    }

    const element = blockEditorRefs.current[activeBlockId]
    const activeBlock = blocksRef.current.find((block) => block.id === activeBlockId)
    if (!element || !activeBlock || (activeBlock.type !== 'paragraph' && activeBlock.type !== 'heading')) {
      insertBlockAfterSelection({ id: createBlockId('paragraph'), type: 'paragraph', text })
      return
    }

    const from = element.selectionStart || 0
    const to = element.selectionEnd || 0
    const nextText = `${activeBlock.text.slice(0, from)}${text}${activeBlock.text.slice(to)}`
    updateTextBlock(activeBlockId, nextText)
    requestAnimationFrame(() => {
      const editor = blockEditorRefs.current[activeBlockId]
      if (!editor) return
      const nextCursor = from + text.length
      editor.focus()
      editor.setSelectionRange(nextCursor, nextCursor)
    })
  }, [insertBlockAfterSelection, updateTextBlock])

  const applyTextEdit = useCallback((payload: DocumentEngineTextEditPayload) => {
    const normalizedText = String(payload.text || '')
    if (!normalizedText) return

    if (payload.mode === 'append-paragraph-at-end') {
      const paragraphTexts = normalizedText
        .replace(/\r\n/g, '\n')
        .split(/\n{2,}/)
      const appendedBlocks = (paragraphTexts.length > 0 ? paragraphTexts : [normalizedText]).map((text) => ({
        id: createBlockId('paragraph'),
        type: 'paragraph' as const,
        text,
      }))
      commitBlocks([...blocksRef.current, ...appendedBlocks])
      requestAnimationFrame(() => {
        const lastBlock = appendedBlocks[appendedBlocks.length - 1]
        if (!lastBlock) return
        const editor = blockEditorRefs.current[lastBlock.id]
        if (!editor) return
        editor.focus()
        editor.setSelectionRange(lastBlock.text.length, lastBlock.text.length)
      })
      return
    }

    if (payload.mode === 'append-inline-at-end') {
      const textBlocks = [...blocksRef.current].filter(isEmbeddedTextBlock)
      const lastTextBlock = textBlocks[textBlocks.length - 1]
      if (!lastTextBlock) {
        insertBlockAfterSelection({ id: createBlockId('paragraph'), type: 'paragraph', text: normalizedText })
        return
      }

      updateTextBlock(lastTextBlock.id, `${lastTextBlock.text}${normalizedText}`)
      requestAnimationFrame(() => {
        const editor = blockEditorRefs.current[lastTextBlock.id]
        if (!editor) return
        const nextCursor = `${lastTextBlock.text}${normalizedText}`.length
        editor.focus()
        editor.setSelectionRange(nextCursor, nextCursor)
      })
      return
    }

    if (payload.mode === 'append-at-end') {
      const textBlocks = [...blocksRef.current].filter(isEmbeddedTextBlock)
      const lastTextBlock = textBlocks[textBlocks.length - 1]
      if (!lastTextBlock) {
        insertBlockAfterSelection({ id: createBlockId('paragraph'), type: 'paragraph', text: normalizedText })
        return
      }

      const separator = lastTextBlock.text && !lastTextBlock.text.endsWith('\n') && !normalizedText.startsWith('\n') ? '\n' : ''
      updateTextBlock(lastTextBlock.id, `${lastTextBlock.text}${separator}${normalizedText}`)
      requestAnimationFrame(() => {
        const editor = blockEditorRefs.current[lastTextBlock.id]
        if (!editor) return
        const nextCursor = `${lastTextBlock.text}${separator}${normalizedText}`.length
        editor.focus()
        editor.setSelectionRange(nextCursor, nextCursor)
      })
      return
    }

    const targetBlockId = payload.range?.anchorId || activeTextBlockIdRef.current
    if (!targetBlockId) {
      insertBlockAfterSelection({ id: createBlockId('paragraph'), type: 'paragraph', text: normalizedText })
      return
    }

    const activeBlock = blocksRef.current.find((block) => block.id === targetBlockId)
    if (!activeBlock || (activeBlock.type !== 'paragraph' && activeBlock.type !== 'heading')) {
      insertBlockAfterSelection({ id: createBlockId('paragraph'), type: 'paragraph', text: normalizedText })
      return
    }

    const start = payload.mode === 'replace-range'
      ? Math.max(0, payload.range?.from ?? 0)
      : Math.max(0, payload.range?.to ?? activeBlock.text.length)
    const end = payload.mode === 'replace-range'
      ? Math.max(start, payload.range?.to ?? start)
      : start
    const nextText = `${activeBlock.text.slice(0, start)}${normalizedText}${activeBlock.text.slice(end)}`

    updateTextBlock(targetBlockId, nextText)
    requestAnimationFrame(() => {
      const editor = blockEditorRefs.current[targetBlockId]
      if (!editor) return
      const nextCursor = start + normalizedText.length
      editor.focus()
      editor.setSelectionRange(nextCursor, nextCursor)
    })
  }, [insertBlockAfterSelection, updateTextBlock])

  const insertFormulaBlock = useCallback((payload: {
    latex: string
    display?: 'inline' | 'block'
    sourceXml?: string
    sourceId?: string
    mathml?: string
  }) => {
    insertBlockAfterSelection({
      id: createBlockId('formula'),
      type: 'formula',
      latex: payload.latex || '公式',
      display: payload.display || 'block',
      sourceId: payload.sourceId,
      sourceXml: payload.sourceXml,
      mathml: payload.mathml,
    })
  }, [insertBlockAfterSelection])

  const insertImageBlock = useCallback(async (payload: {
    altText?: string
    title?: string
    sourceXml?: string
    sourceId?: string
    relationshipId?: string
    mediaPath?: string
    mediaContentType?: string
    previewSrc?: string
    widthPx?: number
    heightPx?: number
    drawingLayout?: 'inline' | 'anchor'
    anchorHorizontal?: string
    anchorVertical?: string
    wrapType?: string
    placement?: 'cursor' | 'after-selection' | 'block' | 'document-end'
  }) => {
    const blockId = createBlockId('image')
    let previewSrc = payload.previewSrc
    let mediaPath = payload.mediaPath
    let mediaContentType = payload.mediaContentType
    let sourceId = payload.sourceId
    let title = payload.title
    const stableSource = ((!previewSrc || /^data:/i.test(previewSrc)) && sourceId && !/^data:/i.test(sourceId)) ? sourceId : previewSrc

    if (stableSource && !/^data:/i.test(stableSource) && window.electronAPI?.readImageAsDataUrl) {
      try {
        let stablePath = stableSource
        if (activeWorkspacePath) {
          if (!isWorkspaceLocalImage(stablePath, activeWorkspacePath)) {
            const structure = await window.electronAPI.detectProjectStructure(activeWorkspacePath)
            const fileName = (payload.title || payload.altText || stablePath.split(/[\\/]/).pop() || `image_${Date.now()}.png`).replace(/[\\/:*?"<>|]/g, '_')
            const saved = structure.hasFigures
              ? await window.electronAPI.saveImageToFigures(activeWorkspacePath, stablePath, fileName)
              : await window.electronAPI.saveImageFromUrl(activeWorkspacePath, stablePath, fileName)
            stablePath = saved.path
            void refreshTree().catch(() => undefined)
          }
          sourceId = sourceId || stablePath
        }

        const imported = await window.electronAPI.readImageAsDataUrl(stablePath)
        previewSrc = imported.dataUrl
        mediaContentType = imported.contentType || mediaContentType
        title = title || imported.fileName.replace(/\.[^.]+$/, '')
        mediaPath = mediaPath || buildImportedMediaPath(imported.fileName, imported.contentType, blockId)
      } catch {
        previewSrc = payload.previewSrc
      }
    }

    const nextBlock: EmbeddedEditorBlock = {
      id: blockId,
      type: 'image',
      alt: payload.altText || 'image',
      title,
      sourceId,
      sourceXml: payload.sourceXml,
      relationshipId: payload.relationshipId,
      mediaPath,
      mediaContentType,
      previewSrc,
      drawingLayout: payload.drawingLayout,
      imageWidthPx: payload.widthPx,
      imageHeightPx: payload.heightPx,
      anchorHorizontal: payload.anchorHorizontal,
      anchorVertical: payload.anchorVertical,
      wrapType: payload.wrapType,
    }

    if (payload.placement === 'document-end') {
      commitBlocks([...blocksRef.current, nextBlock])
      return
    }

    insertBlockAfterSelection(nextBlock)
  }, [activeWorkspacePath, commitBlocks, insertBlockAfterSelection, refreshTree])

  const loadDocument = useCallback(async (request: DocumentEngineLoadRequest) => {
    await openTab(request.filePath, request.fileName, request.content || '<p></p>')
    setStatusMessage(`已通过 embedded runtime 打开: ${request.fileName}`)
  }, [openTab, setStatusMessage])

  const saveDocument = useCallback(async (_request?: DocumentEngineSaveRequest): Promise<DocumentEngineSaveResult | null> => {
    const request = _request || {}
    const saveMode = request.mode || 'current'
    const nextHtml = markdownRef.current
    const nextPlainText = blocksToPlainText(blocksRef.current)
    const nextOoxmlBlocks = serializeBlocksToOoxmlBlocks(blocksRef.current)
    const baseName = sanitizeBaseName(currentFileName)

    const writeTarget = async (targetPath: string) => {
      if (targetPath.toLowerCase().endsWith('.docx')) {
        const rewritten = await window.electronAPI.writeOoxmlPackage(targetPath, { html: nextHtml, plainText: nextPlainText, blocks: nextOoxmlBlocks })
        if (!rewritten.success) {
          await window.electronAPI.writeDocxFile(targetPath, nextHtml)
        }
      } else {
        await window.electronAPI.writeFile(targetPath, serializeForTextFile(targetPath, nextPlainText, nextHtml))
      }

      markTabSaved(activeTabId, {
        filePath: targetPath,
        fileName: targetPath.split(/[\\/]/).pop() || currentFileName,
        content: nextHtml,
      })
      await syncSnapshot(targetPath)
      if (activeWorkspacePath) {
        void refreshTree().catch(() => undefined)
      }
      setStatusMessage(`已通过 embedded runtime 保存: ${targetPath.split(/[\\/]/).pop() || currentFileName}`)
      return {
        filePath: targetPath,
        fileName: targetPath.split(/[\\/]/).pop() || currentFileName,
        content: nextHtml,
      }
    }

    if (saveMode !== 'save-as' && filePath) {
      return writeTarget(filePath)
    }

    if (saveMode !== 'save-as' && activeWorkspacePath) {
      return writeTarget(`${activeWorkspacePath}/${baseName}.docx`)
    }

    const chosenPath = await window.electronAPI.saveFileDialog(`${baseName}.docx`)
    if (!chosenPath) return null
    const finalPath = /\.[^.]+$/.test(chosenPath) ? chosenPath : `${chosenPath}.docx`
    return writeTarget(finalPath)
  }, [activeTabId, activeWorkspacePath, currentFileName, filePath, markTabSaved, refreshTree, setStatusMessage, syncSnapshot])

  const runtime = useMemo(() => createEmbeddedOfficeRuntime({
    getSelection,
    setDocumentContent,
    insertTextAtSelection,
    applyTextEdit,
    insertFormulaBlock,
    insertImageBlock,
    loadDocument,
    saveDocument,
    setStatusMessage,
  }), [applyTextEdit, getSelection, insertFormulaBlock, insertImageBlock, insertTextAtSelection, loadDocument, saveDocument, setDocumentContent, setStatusMessage])

  useBindDocumentEngineRuntime(runtime)

  const openSidebarTab = useCallback((tab: string, data?: any) => {
    window.dispatchEvent(new CustomEvent('open-sidebar-tab', { detail: { tab, ...data } }))
    window.dispatchEvent(new CustomEvent('ai-sidebar-action', { detail: { action: tab, ...data } }))
  }, [])

  const closeCtxMenu = useCallback(() => {
    setCtxMenu(null)
  }, [])

  const persistReferenceSectionToWorkspace = useCallback(async (references: CitationReferenceItem[]) => {
    const referenceTargetPath = filePath || (activeWorkspacePath ? `${activeWorkspacePath}/${sanitizeBaseName(currentFileName)}.docx` : null)
    if (!activeWorkspacePath || !references.length || !referenceTargetPath) return 0
    await window.electronAPI.saveReferences(
      activeWorkspacePath,
      references.map((item) => ({ reference_number: item.citationNumber, citation: item.text })),
      referenceTargetPath,
    )
    void refreshTree().catch(() => undefined)
    return references.length
  }, [activeWorkspacePath, currentFileName, filePath, refreshTree])

  const getCurrentSelection = useCallback((): DocumentEngineSelection | null => {
    const selection = runtime.getSelection()
    if (!selection) return null
    const text = String(selection.text || '').trim()
    return text ? { ...selection, text } : null
  }, [runtime])

  const isContinueAtDocumentEnd = useCallback((selection: DocumentEngineSelection | null): boolean => {
    if (!selection) return true
    if (!selection.collapsed) return false
    const anchorId = selection.anchorId || activeTextBlockIdRef.current
    if (!anchorId) return true
    const targetIndex = blocksRef.current.findIndex((block) => block.id === anchorId)
    if (targetIndex < 0) return true
    const targetBlock = blocksRef.current[targetIndex]
    if (!targetBlock || !isEmbeddedTextBlock(targetBlock)) return false
    if (selection.to < targetBlock.text.length) return false
    return targetIndex === blocksRef.current.length - 1
  }, [])

  const getComposerSelection = useCallback((): ComposerSelectionState | null => {
    const selection = getCurrentSelection()
    if (!selection) return null
    return {
      text: selection.text,
      from: selection.from,
      to: selection.to,
      anchorId: selection.anchorId,
    }
  }, [getCurrentSelection])

  const buildSelectionStructureContext = useCallback((selection: ComposerSelectionState | null): StructuredRemakeContext | null => {
    if (!selection?.text.trim()) return null
    return resolveStructuredRemakeContextFromBlocks({
      selectedText: selection.text,
      anchorId: selection.anchorId,
      blocks: blocksRef.current
        .filter((block): block is EmbeddedTextBlock => block.type === 'paragraph' || block.type === 'heading')
        .map((block) => ({
          id: block.id,
          type: block.type,
          text: block.text,
          level: block.type === 'heading' ? block.level : undefined,
          paragraphStyle: block.paragraphStyle,
        })),
      articleType,
    })
  }, [articleType])

  const openComposer = useCallback((
    mode: ComposerMode,
    autoTopic = '',
    autoRun = false,
    flow: 'auto' | 'paper-generation' | 'assistant' = 'auto',
  ) => {
    const selection = getComposerSelection()
    setComposerInitialMode(mode)
    setComposerDocumentFlow(flow)
    setComposerSelection(selection)
    setComposerSelectionStructureContext(null)
    setComposerTopic(autoTopic)
    setComposerAutoRunOnOpen(autoRun)
    setComposerAutoStartNonce((value) => value + 1)
    setComposerOpen(true)
  }, [getComposerSelection])

  const applyComposerSelectionRewrite = useCallback((payload: { tabId: string; from: number; to: number; anchorId?: string; text: string }) => {
    if (payload.tabId !== activeTabId) {
      setStatusMessage('局部改写前请保持目标标签页处于当前激活状态')
      return false
    }
    try {
      runtime.applyTextEdit({
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
      setStatusMessage('局部改写写回失败')
      return false
    }
  }, [activeTabId, runtime, setStatusMessage])

  const startPaperStreamIntoEditor = useCallback((tabId: string) => {
    if (tabId !== activeTabId || isReadonlyPreviewTab) return false
    setDocumentContent('')
    setStatusMessage('正在生成论文，内容将持续写入当前编辑器')
    return true
  }, [activeTabId, isReadonlyPreviewTab, setDocumentContent, setStatusMessage])

  const syncPaperStreamIntoEditor = useCallback((payload: { tabId: string; markdown: string; backendUrl: string; paragraphIndex?: number; updatedParagraph?: string; citationNumber?: number }) => {
    if (payload.tabId !== activeTabId || isReadonlyPreviewTab) return false
    if (typeof payload.updatedParagraph === 'string' && payload.updatedParagraph.trim()) {
      const paragraphBlocks = blocksRef.current.filter((block): block is EmbeddedTextBlock => block.type === 'paragraph')
      const targetBlock = typeof payload.paragraphIndex === 'number' ? paragraphBlocks[payload.paragraphIndex] : null
      const updatedText = payload.citationNumber && !payload.updatedParagraph.includes(`[${payload.citationNumber}]`)
        ? `${payload.updatedParagraph} [${payload.citationNumber}]`
        : payload.updatedParagraph
      if (targetBlock) {
        commitBlocks(blocksRef.current.map((block) => block.id === targetBlock.id ? { ...block, text: updatedText } : block))
        return true
      }
    }
    const markdown = String(payload.markdown || '').trim()
    if (!markdown) return false
    setDocumentContent(markdown)
    return true
  }, [activeTabId, isReadonlyPreviewTab, setDocumentContent])

  const completePaperStreamIntoEditor = useCallback((payload: { tabId: string; markdown: string; backendUrl: string; documentSchema?: DocumentSchema }) => {
    if (payload.tabId !== activeTabId || isReadonlyPreviewTab) return false
    if (payload.documentSchema && Array.isArray(payload.documentSchema.blocks)) {
      currentDocumentSchemaRef.current = payload.documentSchema
      commitBlocks(documentSchemaToEditorBlocksWithBibliography(payload.documentSchema))
      setStatusMessage('论文已生成并写入编辑器')
      return true
    }
    const markdown = String(payload.markdown || '').trim()
    if (!markdown) return false
    setDocumentContent(markdown)
    setStatusMessage('论文已生成并写入编辑器')
    return true
  }, [activeTabId, isReadonlyPreviewTab, setDocumentContent, setStatusMessage])

  const generationComposerNode = (
    <GenerationComposer
      open={composerOpen}
      presentation={composerInitialMode === 'document' && composerDocumentFlow !== 'paper-generation' ? 'inline' : 'modal'}
      autoTopic={composerTopic}
      autoStartNonce={composerAutoStartNonce}
      initialMode={composerInitialMode}
      preferredDocumentFlow={composerDocumentFlow}
      autoRunOnOpen={composerAutoRunOnOpen}
      targetTabId={activeTabId}
      selectionText={composerSelection?.text}
      selectionRange={composerSelection ? { from: composerSelection.from, to: composerSelection.to, anchorId: composerSelection.anchorId } : null}
      selectionStructureContext={composerSelectionStructureContext}
      onApplySelectionRewrite={applyComposerSelectionRewrite}
      onClose={() => {
        setComposerOpen(false)
        setComposerAutoRunOnOpen(false)
        setComposerSelectionStructureContext(null)
      }}
      onShadowTextChange={() => undefined}
      onRunningChange={(running) => setComposerRunning(running)}
      onPaperStreamStart={startPaperStreamIntoEditor}
      onPaperStreamSync={syncPaperStreamIntoEditor}
      onPaperStreamComplete={completePaperStreamIntoEditor}
    />
  )

  const executeInlineRewrite = useCallback(() => {
    const selection = getCurrentSelection()
    if (!selection) {
      setStatusMessage('请先在当前文本块中选中要重写的内容')
      return
    }
    const settings = getAIToolSettings()
    const autoLangReq = settings.rewriteLanguage === 'auto' ? '【重要】请保持原文语言不变，严禁将内容翻译成其他语言' : ''
    const userRequirements = [settings.rewriteRequirements, autoLangReq].filter(Boolean).join('；') || undefined
    const normalizedTemplateDocumentId = String(knowledge.templateDocumentId || '').trim() || null
    const normalizedReferenceDocumentIds = knowledge.referenceDocumentIds
      .map((item) => String(item || '').trim())
      .filter((item) => item && item !== normalizedTemplateDocumentId)
    const hasExplicitKnowledgeSelection = Boolean(normalizedTemplateDocumentId || normalizedReferenceDocumentIds.length > 0)
    setInlineRewrite({ original: selection.text, rewritten: '', range: selection, streaming: true })
    setAiBusy(true)
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
            instruction: selection.text,
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
        ].filter(Boolean).join('\n')

        await runWritingAssistant({
          instruction,
          documentText: selection.text,
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
            setStatusMessage('改写完成，请选择接受或取消')
          },
          onError: (error) => {
            throw new Error(error)
          },
        }, controller.signal)
      } catch (error) {
        setInlineRewrite(null)
        if (controller.signal.aborted) {
          setStatusMessage('已取消语义保持重写')
          return
        }
        setStatusMessage(`智能改写失败: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        setAiBusy(false)
        if (rewriteAbortRef.current === controller) {
          rewriteAbortRef.current = null
        }
      }
    })()
  }, [getCurrentSelection, knowledge.referenceDocumentIds, knowledge.templateDocumentId, language, setStatusMessage])

  const handleAcceptRewrite = useCallback(() => {
    if (!inlineRewrite?.rewritten.trim()) return
    runtime.applyTextEdit({ text: inlineRewrite.rewritten.trim(), mode: 'replace-range', range: inlineRewrite.range })
    setInlineRewrite(null)
    setStatusMessage('已接受重写')
  }, [inlineRewrite, runtime, setStatusMessage])

  const executeInlineReference = useCallback(async () => {
    const selection = getCurrentSelection()
    if (!selection) {
      setStatusMessage('请先选中要检索文献的文本')
      return
    }
    const anchorBlock = selection.anchorId ? blocksRef.current.find((block) => block.id === selection.anchorId) : null
    if (anchorBlock && (anchorBlock.type === 'paragraph' || anchorBlock.type === 'heading') && isAbstractTextBlock(anchorBlock)) {
      setStatusMessage('摘要/Abstract 区域不支持插入引用')
      return
    }
    const settings = getAIToolSettings()
    setInlineRef({ selectedText: selection.text, range: selection, citations: [], loading: true, selectedCitationKeys: [] })
    setAiBusy(true)
    setStatusMessage('正在查找文献...')
    try {
      const result = await findCitationForText({
        selected_text: selection.text,
        topic: settings.refTopic || undefined,
        max_results: INLINE_CITATION_MAX_RESULTS,
        yearFrom: settings.refYearFrom || settings.genYearFrom || undefined,
        yearTo: settings.refYearTo || settings.genYearTo || undefined,
      })
      if (result.status === 'success' && result.citations.length > 0) {
        setInlineRef((prev) => prev ? { ...prev, citations: result.citations, loading: false } : null)
        setStatusMessage(`找到 ${result.citations.length} 条文献`)
      } else {
        setInlineRef(null)
        setStatusMessage('未找到匹配文献')
      }
    } catch (error) {
      setInlineRef(null)
      setStatusMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setAiBusy(false)
    }
  }, [getCurrentSelection, setStatusMessage])

  const handleInsertCitations = useCallback(async (citations: CitationItem[]) => {
    if (!inlineRef) return
    const normalizedCitations = dedupeCitationItems(citations)
    if (!normalizedCitations.length) {
      setStatusMessage('请至少勾选一篇文献')
      return
    }

    // --- DocumentSchema-first path ---
    const currentSchema = currentDocumentSchemaRef.current
    const schemaBlockId = currentSchema && Array.isArray(currentSchema.blocks) && currentSchema.blocks.length > 0
      ? resolveDocumentSchemaBlockId(currentSchema, blocksRef.current, inlineRef.range)
      : null

    if (currentSchema && schemaBlockId) {
      const offset = inlineRef.range.from ?? 0

      let nextDoc = currentSchema
      for (const citation of normalizedCitations) {
        nextDoc = insertCitationIntoDocument(nextDoc, {
          blockId: schemaBlockId,
          offset,
          reference: {
            title: citation.citation || '',
            doi: citation.doi || undefined,
            abstract: citation.abstract || undefined,
          },
        })
      }
      nextDoc = renumberDocumentCitations(nextDoc)
      currentDocumentSchemaRef.current = nextDoc

      // Reliable citation number lookup via before/after snapshot diff
      const newCitationNumbers = resolveInsertedCitationNumbers(currentSchema, nextDoc, normalizedCitations)

      // Sync editor blocks from DocumentSchema + rebuild bibliography section
      // (no dual-write — no upsertMultipleCitations / renumberEmbedded / persistReferenceSection)
      const nextEmbeddedBlocks = documentSchemaToEditorBlocksWithBibliography(nextDoc)
      commitBlocks(nextEmbeddedBlocks)

      setInlineRef(null)

      // Await save so we can report success/failure
      if (activeWorkspacePath && window.electronAPI?.saveWorkspaceDocumentSchema) {
        try {
          const res = await window.electronAPI.saveWorkspaceDocumentSchema(activeWorkspacePath, nextDoc)
          if (res?.success) {
            const marker = newCitationNumbers.length ? ` ${formatCitationMarker(newCitationNumbers)}` : ''
            setStatusMessage(`已插入引用${marker}，并自动更新参考文献列表（已保存到工作区）`)
          } else {
            setStatusMessage('引用已插入，但保存到 document.json 失败')
          }
        } catch (err: unknown) {
          setStatusMessage(`引用已插入，保存失败：${err instanceof Error ? err.message : String(err)}`)
        }
      } else {
        const marker = newCitationNumbers.length ? ` ${formatCitationMarker(newCitationNumbers)}` : ''
        setStatusMessage(`已插入引用${marker}，并自动更新参考文献列表`)
      }
      return
    }

    if (currentSchema && !schemaBlockId) {
      setStatusMessage('插入引用失败：未能将当前选区映射到 DocumentSchema block，未进入 legacy 模式')
      return
    }

    // --- Legacy fallback ---
    // Triggered only when no paper DocumentSchema is available.
    const updated = upsertMultipleCitationsIntoEmbeddedBlocks(blocksRef.current, inlineRef.range, normalizedCitations)
    if (!updated) {
      setStatusMessage('插入引用失败')
      return
    }

    commitBlocks(updated.blocks)
    void persistReferenceSectionToWorkspace(updated.orderedItems).catch(() => undefined)
    setInlineRef(null)
    setStatusMessage(`已插入引用 ${formatCitationMarker(updated.citationNumbers)}（legacy 模式，未关联 DocumentSchema）`)
  }, [activeWorkspacePath, commitBlocks, inlineRef, persistReferenceSectionToWorkspace, setStatusMessage])

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

  const executeInlineContinue = useCallback(async () => {
    if (aiBusy) return
    const settings = getAIToolSettings()
    const plainText = blocksToPlainText(blocksRef.current)
    if (!plainText.trim()) {
      setStatusMessage('当前文档为空，无法续写')
      return
    }
    const selection = getSelection()
    const selectedText = String(selection?.text || '').trim()
    const goal = selectedText ? `基于以下内容续写：\n${selectedText.slice(0, 200)}` : (settings.continueGoal || '自动补全')
    setAiBusy(true)
    setStatusMessage('正在续写...')
    setContinueStatus({ phase: 'running', message: '正在流式续写...', insertedChars: 0 })
    const controller = new AbortController()
    continueAbortRef.current = controller
    const hasExpandedSelection = Boolean(selection && !selection.collapsed && selectedText)
    const shouldAppendParagraphAtEnd = !hasExpandedSelection && isContinueAtDocumentEnd(selection)
    let insertionRange = shouldAppendParagraphAtEnd ? null : selection
      ? {
          ...selection,
          collapsed: true,
          from: selection.to,
          to: selection.to,
          text: '',
        }
      : null
    let streamedText = ''
    let insertedAnyText = false

    const resolveNextInsertionRange = (previousRange: typeof insertionRange, insertedText: string) => {
      if (!previousRange) return null
      const runtimeSelection = runtime.getSelection()
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
      runtime.applyTextEdit({
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
      setContinueStatus({ phase: 'running', message: '正在流式续写...', insertedChars: streamedText.length })
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
      if (isDirectMode()) {
        await directContinueWriting(plainText, goal, {
          onDelta: (delta: string) => {
            appendContinueText(delta)
          },
          onComplete: (fullText: string) => {
            appendContinueRemainder(fullText)
            setStatusMessage('续写完成，已流式插入')
            setContinueStatus({ phase: 'completed', message: '续写完成，已流式插入', insertedChars: streamedText.length })
            setAiBusy(false)
          },
          onError: (err: string) => {
            const nextMessage = controller.signal.aborted || err === '已停止' ? '已停止续写' : `续写失败: ${err}`
            setStatusMessage(nextMessage)
            setContinueStatus({ phase: controller.signal.aborted || err === '已停止' ? 'stopped' : 'error', message: nextMessage, insertedChars: streamedText.length })
            setAiBusy(false)
          },
        }, controller.signal, language, settings.continueWords)
      } else {
        await continueWriting({ draftText: plainText, writingGoal: goal, targetWords: settings.continueWords, language }, {
          onDelta: (delta) => {
            appendContinueText(delta)
          },
          onComplete: (result) => {
            appendContinueRemainder(result.continuedText)
            setStatusMessage('续写完成，已流式插入')
            setContinueStatus({ phase: 'completed', message: '续写完成，已流式插入', insertedChars: streamedText.length })
            setAiBusy(false)
          },
          onError: (err) => {
            const nextMessage = controller.signal.aborted || err === '已停止' ? '已停止续写' : `续写失败: ${err}`
            setStatusMessage(nextMessage)
            setContinueStatus({ phase: controller.signal.aborted || err === '已停止' ? 'stopped' : 'error', message: nextMessage, insertedChars: streamedText.length })
            setAiBusy(false)
          },
          onStatus: (msg) => setStatusMessage(msg),
        }, controller.signal)
      }
    } finally {
      continueAbortRef.current = null
    }
  }, [aiBusy, getSelection, isContinueAtDocumentEnd, language, runtime, setStatusMessage])

  const stopInlineContinue = useCallback(() => {
    if (!continueAbortRef.current) return
    continueAbortRef.current.abort()
    continueAbortRef.current = null
    setAiBusy(false)
    setStatusMessage('已手动停止续写')
    setContinueStatus((prev) => ({ ...prev, phase: 'stopped', message: '已手动停止续写' }))
  }, [setStatusMessage])

  const executeInlineImage = useCallback(async () => {
    if (aiBusy) return
    const selection = getCurrentSelection()
    if (!selection?.text) {
      openSidebarTab('image')
      setStatusMessage('未检测到选中文本，已打开图片工具')
      return
    }
    if (!activeWorkspacePath) {
      setStatusMessage('请先打开工作区，图片会先保存到工作区后再插入编辑器')
      return
    }
    const settings = getAIToolSettings()
    setAiBusy(true)
    setStatusMessage('正在生成图片，running 仅表示供应商处理中，请等待最终结果...')
    try {
      const result = await generateSelectionImage(selection.text, settings.imageAspectRatio, (attempt, total) => {
        if (attempt > 1) {
          setStatusMessage(`首次生图未完成，正在使用更短摘要重试 (${attempt}/${total})...`)
        }
      })
      if (result.status === 'success' && result.image_url) {
        const rawPath = String(result.file_path || result.image_url)
        try {
          const structure = await window.electronAPI.detectProjectStructure(activeWorkspacePath)
          const filename = result.filename || rawPath.split(/[\\/]/).pop() || `image_${Date.now()}.png`
          const saved = structure?.hasFigures
            ? await window.electronAPI.saveImageToFigures(activeWorkspacePath, rawPath, filename)
            : await window.electronAPI.saveImageFromUrl(activeWorkspacePath, rawPath, filename)
          void refreshTree().catch(() => undefined)
          await runtime.insertAnchoredImage({
            src: toFileUrl(saved.path),
            alt: result.alt,
            placement: 'cursor',
            widthPx: getDefaultInsertedGeneratedImageWidthPx(),
          })
          setStatusMessage(result.fallbackUsed ? '图片生成完成，已自动缩短摘要重试并插入编辑器' : '图片生成完成，已插入编辑器并保存到工作区')
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          setStatusMessage(`图片已生成，但保存到工作区失败，未插入编辑器: ${reason}`)
        }
      } else {
        setStatusMessage(`图片生成失败: ${result.error || '未知错误'}${result.fallbackUsed ? '，已自动尝试更短摘要。' : ''}`)
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setAiBusy(false)
    }
  }, [activeWorkspacePath, aiBusy, getCurrentSelection, openSidebarTab, refreshTree, runtime, setStatusMessage])

  useEffect(() => () => {
    continueAbortRef.current?.abort()
    rewriteAbortRef.current?.abort()
  }, [])

  const handleOpenFile = useCallback(async () => {
    await requestOpenFromDialog()
  }, [requestOpenFromDialog])

  const handleSaveFile = useCallback(async () => {
    await saveActiveDocument({ reason: 'manual' })
  }, [saveActiveDocument])

  const handleSaveAsFile = useCallback(async () => {
    await saveActiveDocumentAs()
  }, [saveActiveDocumentAs])

  const handleRefreshPackage = useCallback(async () => {
    await syncSnapshot(filePath)
    setStatusMessage(filePath ? '已重新读取 OOXML 包摘要' : '当前标签页没有可读取的 DOCX 文件')
  }, [filePath, setStatusMessage, syncSnapshot])

  const handleCtxAction = useCallback((action: 'generate' | 'rewrite' | 'reference' | 'continue' | 'image' | 'tools' | 'settings' | 'open' | 'save') => {
    const selectedText = ctxMenu?.selection?.text || ''
    closeCtxMenu()
    switch (action) {
      case 'generate':
        openComposer('document', selectedText, true, 'paper-generation')
        break
      case 'rewrite':
        executeInlineRewrite()
        break
      case 'reference':
        void executeInlineReference()
        break
      case 'continue':
        void executeInlineContinue()
        break
      case 'image':
        void executeInlineImage()
        break
      case 'tools':
        openSidebarTab('tools')
        break
      case 'settings':
        openSidebarTab('settings')
        break
      case 'open':
        void handleOpenFile()
        break
      case 'save':
        void handleSaveFile()
        break
    }
  }, [closeCtxMenu, ctxMenu, executeInlineContinue, executeInlineImage, executeInlineReference, executeInlineRewrite, handleOpenFile, handleSaveFile, openComposer, openSidebarTab])

  const handleTextBlockStyleChange = useCallback((blockId: string, value: string) => {
    updateTextBlockFormatting(blockId, (block) => {
      if (value === 'paragraph') {
        return {
          ...block,
          type: 'paragraph',
          level: undefined,
          paragraphStyle: undefined,
        }
      }
      if (value === 'title') {
        return {
          ...block,
          type: 'paragraph',
          level: undefined,
          paragraphStyle: 'Title',
        }
      }
      if (value === 'abstract') {
        return {
          ...block,
          type: 'paragraph',
          level: undefined,
          paragraphStyle: 'Abstract',
          alignment: block.alignment || 'justify',
        }
      }
      if (value === 'abstract-heading') {
        return {
          ...block,
          type: 'heading',
          level: 1,
          paragraphStyle: 'AbstractHeading',
          alignment: 'center',
        }
      }
      if (value === 'keywords') {
        return {
          ...block,
          type: 'paragraph',
          level: undefined,
          paragraphStyle: 'Keywords',
          alignment: block.alignment || 'left',
        }
      }
      if (value === 'keywords-heading') {
        return {
          ...block,
          type: 'heading',
          level: 1,
          paragraphStyle: 'KeywordsHeading',
          alignment: 'left',
        }
      }
      const headingLevel = Number(value.replace('heading-', ''))
      return {
        ...block,
        type: 'heading',
        level: Math.max(1, Math.min(headingLevel || 1, 6)),
        paragraphStyle: `Heading${Math.max(1, Math.min(headingLevel || 1, 6))}`,
      }
    })
  }, [updateTextBlockFormatting])

  const handleTextBlockAlignmentChange = useCallback((blockId: string, value: string) => {
    updateTextBlockFormatting(blockId, (block) => ({
      ...block,
      alignment: (value as 'left' | 'center' | 'right' | 'justify') || undefined,
    }))
  }, [updateTextBlockFormatting])

  const handleTextBlockListChange = useCallback((blockId: string, value: string) => {
    updateTextBlockFormatting(blockId, (block) => ({
      ...block,
      listType: (value as 'bullet' | 'number' | '') || undefined,
      listLevel: value ? (block.listLevel || 0) : undefined,
    }))
  }, [updateTextBlockFormatting])

  const handleTextBlockIndent = useCallback((blockId: string, delta: number) => {
    updateTextBlockFormatting(blockId, (block) => {
      const nextIndentLevel = Math.max(0, Math.min(8, (block.indentLevel || 0) + delta))
      const nextListLevel = block.listType ? Math.max(0, Math.min(8, (block.listLevel || 0) + delta)) : block.listLevel
      return {
        ...block,
        indentLevel: nextIndentLevel || undefined,
        listLevel: typeof nextListLevel === 'number' && nextListLevel > 0 ? nextListLevel : (block.listType ? 0 : undefined),
      }
    })
  }, [updateTextBlockFormatting])

  const handleTextBlockPaperStyleChange = useCallback((blockId: string, key: string, value: string) => {
    updateTextBlockFormatting(blockId, (block) => ({
      ...block,
      paperStyle: updatePaperStyle(block.paperStyle, { [key]: value || null }),
    }))
  }, [updateTextBlockFormatting])

  const handleReplaceImageFromLocalFile = useCallback(async (blockId: string) => {
    const importedImage = await window.electronAPI.importImageFile()
    if (!importedImage) return

    updateBlock(blockId, (current) => {
      if (current.type !== 'image') return current
      const nextAlt = current.alt && current.alt !== 'image'
        ? current.alt
        : importedImage.fileName.replace(/\.[^.]+$/, '')
      return {
        ...current,
        alt: nextAlt,
        title: current.title || importedImage.fileName.replace(/\.[^.]+$/, ''),
        mediaPath: buildImportedMediaPath(importedImage.fileName, importedImage.contentType, current.id),
        mediaContentType: importedImage.contentType,
        previewSrc: importedImage.dataUrl,
      }
    })
    setStatusMessage(`已导入本地图片: ${importedImage.fileName}`)
  }, [setStatusMessage, updateBlock])

  const handleInsertImageFromLocalFile = useCallback(async () => {
    const importedImage = await window.electronAPI.importImageFile()
    if (!importedImage) return

    const blockId = createBlockId('image')
    const title = importedImage.fileName.replace(/\.[^.]+$/, '')

    insertBlockAfterSelection({
      id: blockId,
      type: 'image',
      alt: title || 'image',
      title,
      mediaPath: buildImportedMediaPath(importedImage.fileName, importedImage.contentType, blockId),
      mediaContentType: importedImage.contentType,
      previewSrc: importedImage.dataUrl,
      drawingLayout: 'inline',
      wrapType: 'square',
      imageWidthPx: 240,
    })
    setStatusMessage(`已插入本地图片: ${importedImage.fileName}`)
  }, [insertBlockAfterSelection, setStatusMessage])

  const replaceImageWithBrowserFile = useCallback(async (blockId: string, file: File) => {
    const dataUrl = await readBrowserFileAsDataUrl(file)
    updateBlock(blockId, (current) => {
      if (current.type !== 'image') return current
      const nextTitle = current.title || file.name.replace(/\.[^.]+$/, '')
      return {
        ...current,
        alt: current.alt && current.alt !== 'image' ? current.alt : file.name.replace(/\.[^.]+$/, ''),
        title: nextTitle,
        mediaPath: buildImportedMediaPath(file.name, file.type || 'image/png', current.id),
        mediaContentType: file.type || 'image/png',
        previewSrc: dataUrl,
      }
    })
    setStatusMessage(`已拖拽替换图片: ${file.name}`)
  }, [setStatusMessage, updateBlock])

  const handleImageDrop = useCallback(async (blockId: string, event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDraggingImageBlockId((current) => current === blockId ? null : current)
    const file = Array.from(event.dataTransfer.files || []).find((item) => item.type.startsWith('image/'))
    if (!file) {
      setStatusMessage('拖拽内容里没有可用图片文件')
      return
    }
    try {
      await replaceImageWithBrowserFile(blockId, file)
    } catch {
      setStatusMessage('拖拽图片替换失败')
    }
  }, [replaceImageWithBrowserFile, setStatusMessage])

  const updateImageDimension = useCallback((blockId: string, dimension: 'width' | 'height', rawValue: string) => {
    updateBlock(blockId, (current) => {
      if (current.type !== 'image') return current
      const numericValue = Number(rawValue) || undefined
      const isLocked = lockedAspectRatios[blockId] !== false
      const aspectRatio = getImageAspectRatio(current)
      if (!isLocked || !numericValue || !aspectRatio) {
        return dimension === 'width'
          ? { ...current, imageWidthPx: numericValue }
          : { ...current, imageHeightPx: numericValue }
      }

      if (dimension === 'width') {
        return {
          ...current,
          imageWidthPx: numericValue,
          imageHeightPx: Math.max(1, Math.round(numericValue / aspectRatio)),
        }
      }

      return {
        ...current,
        imageHeightPx: numericValue,
        imageWidthPx: Math.max(1, Math.round(numericValue * aspectRatio)),
      }
    })
  }, [lockedAspectRatios, updateBlock])

  const beginImageResize = useCallback((block: EmbeddedImageBlock, handle: ImageResizeHandlePosition, event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const startWidth = Math.max(40, block.imageWidthPx || 240)
    const startHeight = Math.max(40, block.imageHeightPx || 160)
    setImageResizeState({
      blockId: block.id,
      handle,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWidth,
      startHeight,
      aspectRatio: getImageAspectRatio(block),
      keepAspect: lockedAspectRatios[block.id] !== false,
    })
  }, [lockedAspectRatios])

  const updateTableCell = useCallback((blockId: string, rowIndex: number, cellIndex: number, updater: (cell: EmbeddedTableCell) => EmbeddedTableCell) => {
    updateBlock(blockId, (current) => {
      if (current.type !== 'table') return current
      const nextRows = current.tableRows.map((row, currentRowIndex) => {
        if (currentRowIndex !== rowIndex) return row
        return row.map((cell, currentCellIndex) => currentCellIndex === cellIndex ? updater(cell) : cell)
      })
      return {
        ...current,
        tableRows: nextRows,
      }
    })
  }, [updateBlock])

  const handleAddTableRow = useCallback((blockId: string) => {
    updateBlock(blockId, (current) => {
      if (current.type !== 'table') return current
      const nextCols = Math.max(1, current.cols)
      const nextRow = Array.from({ length: nextCols }, (_item, index) => ({
        text: '',
        paragraphs: [{ text: '' }],
        colspan: 1,
        rowspan: 1,
        column: index,
      }))
      return {
        ...current,
        tableRows: [...current.tableRows, nextRow],
      }
    })
  }, [updateBlock])

  const handleAddTableColumn = useCallback((blockId: string) => {
    updateBlock(blockId, (current) => {
      if (current.type !== 'table') return current
      const nextRows = current.tableRows.map((row) => ([
        ...row,
        {
          text: '',
          paragraphs: [{ text: '' }],
          colspan: 1,
          rowspan: 1,
          column: row.reduce((total, cell) => total + Math.max(1, cell.colspan || 1), 0),
        },
      ]))
      return {
        ...current,
        tableRows: nextRows,
        cols: current.cols + 1,
      }
    })
  }, [updateBlock])

  const handleDeleteTableRow = useCallback((blockId: string, rowIndex: number) => {
    updateBlock(blockId, (current) => current.type === 'table' ? deleteTableRow(current, rowIndex) : current)
  }, [updateBlock])

  const handleDeleteTableColumn = useCallback((blockId: string, colIndex: number) => {
    updateBlock(blockId, (current) => current.type === 'table' ? deleteTableColumn(current, colIndex) : current)
  }, [updateBlock])

  const handleMergeTableCellRight = useCallback((blockId: string, rowIndex: number, cellIndex: number) => {
    updateBlock(blockId, (current) => current.type === 'table' ? mergeTableCellRight(current, rowIndex, cellIndex) : current)
  }, [updateBlock])

  const handleMergeTableCellDown = useCallback((blockId: string, rowIndex: number, cellIndex: number) => {
    updateBlock(blockId, (current) => current.type === 'table' ? mergeTableCellDown(current, rowIndex, cellIndex) : current)
  }, [updateBlock])

  const handleSplitTableCell = useCallback((blockId: string, rowIndex: number, cellIndex: number) => {
    updateBlock(blockId, (current) => current.type === 'table' ? splitTableCell(current, rowIndex, cellIndex) : current)
  }, [updateBlock])

  const handleTableGridCellClick = useCallback((blockId: string, rowIndex: number, colIndex: number) => {
    setTableSelections((current) => {
      const existing = current[blockId]
      if (!existing) {
        return {
          ...current,
          [blockId]: { startRow: rowIndex, startCol: colIndex, endRow: rowIndex, endCol: colIndex },
        }
      }
      return {
        ...current,
        [blockId]: { ...existing, endRow: rowIndex, endCol: colIndex },
      }
    })
  }, [])

  const clearTableSelection = useCallback((blockId: string) => {
    setTableSelections((current) => ({ ...current, [blockId]: null }))
  }, [])

  const handleMergeTableSelection = useCallback((blockId: string) => {
    const selection = tableSelections[blockId] || null
    updateBlock(blockId, (current) => current.type === 'table' ? mergeSelectedTableCells(current, selection) : current)
    setTableSelections((current) => ({ ...current, [blockId]: null }))
  }, [tableSelections, updateBlock])

  useEffect(() => {
    if (!imageResizeState) return undefined

    const handlePointerMove = (event: PointerEvent) => {
      const deltaX = event.clientX - imageResizeState.startClientX
      const deltaY = event.clientY - imageResizeState.startClientY
      const widthSign = imageResizeState.handle === 'nw' || imageResizeState.handle === 'sw' ? -1 : 1
      const heightSign = imageResizeState.handle === 'nw' || imageResizeState.handle === 'ne' ? -1 : 1
      const rawWidth = Math.max(40, Math.round(imageResizeState.startWidth + deltaX * widthSign))
      const rawHeight = Math.max(40, Math.round(imageResizeState.startHeight + deltaY * heightSign))

      updateBlock(imageResizeState.blockId, (current) => {
        if (current.type !== 'image') return current
        if (imageResizeState.keepAspect && imageResizeState.aspectRatio) {
          const widthDriven = Math.abs(deltaX) >= Math.abs(deltaY)
          if (widthDriven) {
            return {
              ...current,
              imageWidthPx: rawWidth,
              imageHeightPx: Math.max(40, Math.round(rawWidth / imageResizeState.aspectRatio)),
            }
          }
          return {
            ...current,
            imageHeightPx: rawHeight,
            imageWidthPx: Math.max(40, Math.round(rawHeight * imageResizeState.aspectRatio)),
          }
        }

        return {
          ...current,
          imageWidthPx: rawWidth,
          imageHeightPx: rawHeight,
        }
      })
    }

    const handlePointerUp = () => {
      setImageResizeState(null)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [imageResizeState, updateBlock])

  const totalWords = useMemo(() => blocksToPlainText(blocks).replace(/\s+/g, '').length, [blocks])
  const objectCount = useMemo(() => blocks.filter((block) => block.type === 'image' || block.type === 'formula' || block.type === 'table').length, [blocks])
  const activeTextBlock = useMemo(() => {
    const current = blocks.find((block) => block.id === activeBlockId && (block.type === 'paragraph' || block.type === 'heading'))
    if (current && (current.type === 'paragraph' || current.type === 'heading')) return current
    const fallback = blocks.find((block) => block.type === 'paragraph' || block.type === 'heading')
    return fallback && (fallback.type === 'paragraph' || fallback.type === 'heading') ? fallback : null
  }, [activeBlockId, blocks])

  const openContextMenu = useCallback((event: React.MouseEvent, selection?: ComposerSelectionState | null) => {
    event.preventDefault()
    setCtxMenu({
      x: event.clientX,
      y: event.clientY,
      selection: selection ?? getComposerSelection(),
    })
  }, [getComposerSelection])

  return (
    <Root>
      {ctxMenu ? (
        <>
          <CtxMenuOverlay onClick={closeCtxMenu} onContextMenu={(event) => { event.preventDefault(); closeCtxMenu() }} />
          <CtxMenu style={{ left: ctxMenu.x, top: ctxMenu.y }}>
            {ctxMenu.selection?.text ? (
              <>
                <CtxMenuLabel>选中文本操作</CtxMenuLabel>
                <CtxMenuItem onClick={() => handleCtxAction('generate')}>✨ 生成论文</CtxMenuItem>
                <CtxMenuItem onClick={() => handleCtxAction('rewrite')}>✏️ 重写选中文本</CtxMenuItem>
                <CtxMenuItem onClick={() => handleCtxAction('reference')}>📚 查找文献并插入</CtxMenuItem>
                <CtxMenuItem onClick={() => handleCtxAction('continue')}>✍ AI 续写</CtxMenuItem>
                <CtxMenuItem onClick={() => handleCtxAction('image')}>🎨 根据选中内容生成图片</CtxMenuItem>
                <CtxMenuDivider />
              </>
            ) : (
              <>
                <CtxMenuItem onClick={() => handleCtxAction('generate')}>✨ 生成论文</CtxMenuItem>
                <CtxMenuItem onClick={() => handleCtxAction('continue')}>✍ AI 续写</CtxMenuItem>
                <CtxMenuItem onClick={() => handleCtxAction('image')}>🎨 图片生成</CtxMenuItem>
                <CtxMenuDivider />
              </>
            )}
            <CtxMenuItem onClick={() => handleCtxAction('tools')}>🔧 工具箱</CtxMenuItem>
            <CtxMenuDivider />
            <CtxMenuItem onClick={() => handleCtxAction('open')}>📂 打开文件</CtxMenuItem>
            <CtxMenuItem onClick={() => handleCtxAction('save')}>💾 保存文件</CtxMenuItem>
            <CtxMenuDivider />
            <CtxMenuItem onClick={() => handleCtxAction('settings')}>⚙ AI 设置</CtxMenuItem>
          </CtxMenu>
        </>
      ) : null}
      <Header>
        <HeaderInfo>
          <Title>Embedded Office Runtime v0</Title>
          <Meta>
            当前文件: {currentFileName}
            {isReadonlyPreviewTab ? ' · 只读预览模式' : packageSummary ? ` · 段落 ${packageSummary.paragraphCount} · 包条目 ${packageSummary.entryCount}` : ' · 当前标签页尚未绑定 OOXML 包'}
          </Meta>
        </HeaderInfo>
        <Actions>
          <ActionButton onClick={() => void handleOpenFile()}>打开 DOCX</ActionButton>
          <ActionButton onClick={() => void handleInsertImageFromLocalFile()} disabled={isReadonlyPreviewTab}>插入本地图片</ActionButton>
          <ActionButton onClick={() => void handleSaveFile()} disabled={isReadonlyPreviewTab}>保存回写</ActionButton>
          <ActionButton onClick={() => void handleSaveAsFile()} disabled={isReadonlyPreviewTab}>另存为</ActionButton>
          <ActionButton onClick={() => void handleRefreshPackage()} disabled={isReadonlyPreviewTab || !filePath || !filePath.toLowerCase().endsWith('.docx')}>刷新摘要</ActionButton>
        </Actions>
      </Header>
      <Body onContextMenu={(event) => {
        if (isReadonlyPreviewTab) return
        openContextMenu(event)
      }}>
        <Page>
          <PageTopChrome>
            <HorizontalRuler>
              {Array.from({ length: 17 }, (_item, index) => {
                const left = index * 6.25
                return (
                  <React.Fragment key={`ruler-${index}`}>
                    <RulerTick $left={left} $major />
                    {index < 16 ? <RulerLabel $left={left + 3.125}>{index + 1}</RulerLabel> : null}
                  </React.Fragment>
                )
              })}
            </HorizontalRuler>
            <PageStatusStrip>
              <span>连续文档视图 · A4 近似版式 · 左右边距 72px</span>
              <span>{isReadonlyPreviewTab ? '内嵌只读预览 · 当前不可编辑' : `${blocks.length} 个结构块 · ${objectCount} 个对象 · 约 ${totalWords} 字`}</span>
            </PageStatusStrip>
            <AiToolbar>
              <AiActionButton $primary onClick={() => openComposer('document')} disabled={isReadonlyPreviewTab || aiBusy || isGenerating || composerRunning}>全文生成</AiActionButton>
              <AiActionButton $primary onClick={() => void executeInlineContinue()} disabled={isReadonlyPreviewTab || aiBusy || isGenerating}>AI 续写</AiActionButton>
              <AiActionButton onClick={() => executeInlineRewrite()} disabled={isReadonlyPreviewTab || aiBusy || isGenerating}>重写选中</AiActionButton>
              <AiActionButton onClick={() => void executeInlineReference()} disabled={isReadonlyPreviewTab || aiBusy || isGenerating}>查文献并插入</AiActionButton>
              <AiActionButton onClick={() => void executeInlineImage()} disabled={isReadonlyPreviewTab || aiBusy || isGenerating}>生成图片并插入</AiActionButton>
              <AiActionButton onClick={() => void handleInsertImageFromLocalFile()} disabled={isReadonlyPreviewTab || aiBusy || isGenerating}>插入本地图片</AiActionButton>
              <AiActionButton onClick={() => openSidebarTab('tools')}>工具箱</AiActionButton>
              <AiActionButton onClick={() => openSidebarTab('settings')}>AI 设置</AiActionButton>
            </AiToolbar>
            {generationComposerNode}
            {continueStatus.phase !== 'idle' ? (
              <ContinueStatusBar>
                <ContinueStatusSummary>
                  <ContinueStatusBadge $phase={continueStatus.phase}>
                    {continueStatus.phase === 'running' ? '续写中' : continueStatus.phase === 'completed' ? '已完成' : continueStatus.phase === 'stopped' ? '已停止' : '失败'}
                  </ContinueStatusBadge>
                  <ContinueStatusText>
                    {continueStatus.message || '续写任务状态'}
                    {continueStatus.insertedChars > 0 ? ` · 已插入 ${continueStatus.insertedChars} 字` : ''}
                  </ContinueStatusText>
                </ContinueStatusSummary>
                {continueStatus.phase === 'running' ? (
                  <ContinueStatusBtn $danger onClick={stopInlineContinue}>停止续写</ContinueStatusBtn>
                ) : (
                  <ContinueStatusBtn onClick={() => setContinueStatus({ phase: 'idle', message: '', insertedChars: 0 })}>关闭</ContinueStatusBtn>
                )}
              </ContinueStatusBar>
            ) : null}
            <DocumentFormatBar>
              <DocumentFormatMeta>{activeTextBlock ? `当前段落 · ${getTextBlockLabel(activeTextBlock)}` : '当前段落'}</DocumentFormatMeta>
              <CompactSelect
                value={activeTextBlock ? getTextBlockStyleValue(activeTextBlock) : 'paragraph'}
                onChange={(event) => activeTextBlock && handleTextBlockStyleChange(activeTextBlock.id, event.target.value)}
                disabled={isReadonlyPreviewTab || !activeTextBlock}
              >
                <option value="paragraph">正文</option>
                <option value="title">标题</option>
                <option value="abstract-heading">摘要标题</option>
                <option value="abstract">摘要</option>
                <option value="keywords-heading">关键词标题</option>
                <option value="keywords">关键词</option>
                <option value="heading-1">标题 1</option>
                <option value="heading-2">标题 2</option>
                <option value="heading-3">标题 3</option>
              </CompactSelect>
              <CompactSelect
                value={activeTextBlock?.listType || ''}
                onChange={(event) => activeTextBlock && handleTextBlockListChange(activeTextBlock.id, event.target.value)}
                disabled={isReadonlyPreviewTab || !activeTextBlock}
              >
                <option value="">无列表</option>
                <option value="bullet">项目符号</option>
                <option value="number">编号列表</option>
              </CompactSelect>
              <CompactSelect
                value={activeTextBlock?.alignment || 'left'}
                onChange={(event) => activeTextBlock && handleTextBlockAlignmentChange(activeTextBlock.id, event.target.value)}
                disabled={isReadonlyPreviewTab || !activeTextBlock}
              >
                <option value="left">左对齐</option>
                <option value="center">居中</option>
                <option value="right">右对齐</option>
                <option value="justify">两端对齐</option>
              </CompactSelect>
              <CompactSelect
                value={getPaperStyleValue(activeTextBlock, 'font-family')}
                onChange={(event) => activeTextBlock && handleTextBlockPaperStyleChange(activeTextBlock.id, 'font-family', event.target.value)}
                disabled={isReadonlyPreviewTab || !activeTextBlock}
              >
                <option value="">默认字体</option>
                <option value="SimSun, serif">宋体</option>
                <option value="KaiTi, serif">楷体</option>
                <option value="SimHei, sans-serif">黑体</option>
                <option value="'Times New Roman', serif">Times New Roman</option>
              </CompactSelect>
              <CompactSelect
                value={getPaperStyleValue(activeTextBlock, 'font-size')}
                onChange={(event) => activeTextBlock && handleTextBlockPaperStyleChange(activeTextBlock.id, 'font-size', event.target.value)}
                disabled={isReadonlyPreviewTab || !activeTextBlock}
              >
                <option value="">默认字号</option>
                <option value="12px">12 px</option>
                <option value="14px">14 px</option>
                <option value="15px">15 px</option>
                <option value="16px">16 px</option>
                <option value="18px">18 px</option>
              </CompactSelect>
              <CompactSelect
                value={getPaperStyleValue(activeTextBlock, 'line-height')}
                onChange={(event) => activeTextBlock && handleTextBlockPaperStyleChange(activeTextBlock.id, 'line-height', event.target.value)}
                disabled={isReadonlyPreviewTab || !activeTextBlock}
              >
                <option value="">默认行距</option>
                <option value="1.6">行距 1.6</option>
                <option value="1.8">行距 1.8</option>
                <option value="1.9">行距 1.9</option>
                <option value="2">行距 2.0</option>
              </CompactSelect>
              <CompactButton onClick={() => activeTextBlock && handleTextBlockIndent(activeTextBlock.id, -1)} disabled={isReadonlyPreviewTab || !activeTextBlock}>减少缩进</CompactButton>
              <CompactButton onClick={() => activeTextBlock && handleTextBlockIndent(activeTextBlock.id, 1)} disabled={isReadonlyPreviewTab || !activeTextBlock}>增加缩进</CompactButton>
            </DocumentFormatBar>
          </PageTopChrome>
          {activeTabPreview ? <DocumentPreviewPane fileName={activeTab?.fileName || currentFileName} source={activeTabPreview.source} sourceDoc={activeTabPreview.kind === 'frame' ? activeTabPreview.sourceDoc : undefined} hint={activeTabPreview.hint} actionLabel={activeTabPreview.actionLabel} onOpenExternal={activeTabPreview.externalFilePath || activeTab?.filePath ? () => void openPreviewExternally() : undefined} /> : <BlockList>
            {blocks.map((block, index) => {
              if (block.type === 'paragraph' || block.type === 'heading') {
                const isHeading = block.type === 'heading'
                const headingLevel = Math.min(Math.max(block.level || 1, 1), 6)
                const isActive = activeBlockId === block.id
                return (
                  <TextBlockCard key={block.id} $active={isActive} onClick={() => setActiveBlockId(block.id)}>
                    <TextBlockEditor
                      ref={(element) => {
                        blockEditorRefs.current[block.id] = element
                        if (element) {
                          element.style.height = '0px'
                          element.style.height = `${Math.max(44, element.scrollHeight)}px`
                        }
                      }}
                      value={block.text}
                      onFocus={() => {
                        activeTextBlockIdRef.current = block.id
                        setActiveBlockId(block.id)
                      }}
                      onClick={() => {
                        activeTextBlockIdRef.current = block.id
                        setActiveBlockId(block.id)
                      }}
                      onContextMenu={(event) => {
                        event.stopPropagation()
                        activeTextBlockIdRef.current = block.id
                        setActiveBlockId(block.id)
                        openContextMenu(event, {
                          text: event.currentTarget.value.slice(event.currentTarget.selectionStart || 0, event.currentTarget.selectionEnd || 0).trim(),
                          from: event.currentTarget.selectionStart || 0,
                          to: event.currentTarget.selectionEnd || 0,
                          anchorId: block.id,
                        })
                      }}
                      onKeyUp={() => {
                        activeTextBlockIdRef.current = block.id
                      }}
                      onChange={(event) => {
                        updateTextBlock(block.id, event.target.value)
                        event.currentTarget.style.height = '0px'
                        event.currentTarget.style.height = `${Math.max(44, event.currentTarget.scrollHeight)}px`
                      }}
                      spellCheck={false}
                      style={getTextBlockEditorStyle(block)}
                    />
                  </TextBlockCard>
                )
              }

              if (block.type === 'image') {
                const previewWidth = Math.max(80, Math.min(block.imageWidthPx || 240, 420))
                const previewHeight = Math.max(80, Math.min(block.imageHeightPx || 160, 320))
                const isActive = activeBlockId === block.id
                const previewTitle = derivePaperFigurePreviewTitle(block, index)
                return (
                  <ObjectCardList key={block.id}>
                    <ObjectCard $active={isActive} onClick={() => setActiveBlockId(block.id)}>
                      <ObjectToolbar $active={isActive}>
                        <PreviewLabel>Embedded Media</PreviewLabel>
                        <TextBlockMeta>对象 {index + 1}</TextBlockMeta>
                      </ObjectToolbar>
                      <PreviewTitle>{previewTitle}</PreviewTitle>
                      <PreviewMeta>
                        {block.mediaPath || '当前图片尚未解析出 media 路径'}
                        {(block.imageWidthPx || block.imageHeightPx) ? ` · ${block.imageWidthPx || '?'} x ${block.imageHeightPx || '?'} px` : ''}
                        {block.drawingLayout ? ` · ${block.drawingLayout}` : ''}
                        {block.wrapType ? ` · ${block.wrapType}` : ''}
                        {block.anchorHorizontal || block.anchorVertical ? ` · anchor(${block.anchorHorizontal || '-'}, ${block.anchorVertical || '-'})` : ''}
                      </PreviewMeta>
                      {block.previewSrc ? (
                        <ImageStage style={{ width: `${previewWidth}px`, height: `${previewHeight}px` }}>
                          <PreviewImage src={block.previewSrc} alt={block.alt || block.title || `图片 ${index + 1}`} />
                          <ResizeHandle $position="nw" onPointerDown={(event) => beginImageResize(block, 'nw', event)} />
                          <ResizeHandle $position="ne" onPointerDown={(event) => beginImageResize(block, 'ne', event)} />
                          <ResizeHandle $position="sw" onPointerDown={(event) => beginImageResize(block, 'sw', event)} />
                          <ResizeHandle $position="se" onPointerDown={(event) => beginImageResize(block, 'se', event)} />
                        </ImageStage>
                      ) : null}
                      <InspectorSection $active={isActive}>
                        <FlowDivider />
                        <ImageDropZone
                          $active={draggingImageBlockId === block.id}
                          onDragOver={(event) => {
                            event.preventDefault()
                            if (draggingImageBlockId !== block.id) setDraggingImageBlockId(block.id)
                          }}
                          onDragLeave={() => {
                            if (draggingImageBlockId === block.id) setDraggingImageBlockId(null)
                          }}
                          onDrop={(event) => void handleImageDrop(block.id, event)}
                        >
                          拖拽本地图片到这里即可直接替换当前对象；也可以继续使用下方按钮选择文件。
                        </ImageDropZone>
                        <ObjectCardActions>
                          <SecondaryButton onClick={() => void handleReplaceImageFromLocalFile(block.id)}>从本地文件替换</SecondaryButton>
                          <SecondaryButton onClick={() => setLockedAspectRatios((current) => ({ ...current, [block.id]: current[block.id] === false }))}>
                            {(lockedAspectRatios[block.id] !== false) ? '已锁定比例' : '比例未锁定'}
                          </SecondaryButton>
                        </ObjectCardActions>
                        <FieldGrid>
                        <Field>
                          <FieldLabel>Alt Text</FieldLabel>
                          <FieldInput value={block.alt} onChange={(event) => updateBlock(block.id, (current) => current.type === 'image' ? { ...current, alt: event.target.value } : current)} />
                        </Field>
                        <Field>
                          <FieldLabel>Title</FieldLabel>
                          <FieldInput value={block.title || ''} onChange={(event) => updateBlock(block.id, (current) => current.type === 'image' ? { ...current, title: event.target.value || undefined } : current)} />
                        </Field>
                        <Field>
                          <FieldLabel>Relationship Target</FieldLabel>
                          <FieldInput value={block.mediaPath || ''} onChange={(event) => updateBlock(block.id, (current) => current.type === 'image' ? { ...current, mediaPath: event.target.value || undefined } : current)} />
                        </Field>
                        <Field>
                          <FieldLabel>Relationship Id</FieldLabel>
                          <FieldInput value={block.relationshipId || ''} onChange={(event) => updateBlock(block.id, (current) => current.type === 'image' ? { ...current, relationshipId: event.target.value || undefined } : current)} />
                        </Field>
                        <Field>
                          <FieldLabel>Width Px</FieldLabel>
                          <FieldInput type="number" value={block.imageWidthPx || ''} onChange={(event) => updateImageDimension(block.id, 'width', event.target.value)} />
                        </Field>
                        <Field>
                          <FieldLabel>Height Px</FieldLabel>
                          <FieldInput type="number" value={block.imageHeightPx || ''} onChange={(event) => updateImageDimension(block.id, 'height', event.target.value)} />
                        </Field>
                        <Field>
                          <FieldLabel>Layout</FieldLabel>
                          <FieldSelect value={block.drawingLayout || 'inline'} onChange={(event) => updateBlock(block.id, (current) => current.type === 'image' ? { ...current, drawingLayout: event.target.value as 'inline' | 'anchor' } : current)}>
                            <option value="inline">inline</option>
                            <option value="anchor">anchor</option>
                          </FieldSelect>
                        </Field>
                        <Field>
                          <FieldLabel>Wrap Type</FieldLabel>
                          <FieldSelect value={block.wrapType || 'square'} onChange={(event) => updateBlock(block.id, (current) => current.type === 'image' ? { ...current, wrapType: event.target.value || undefined } : current)}>
                            <option value="square">square</option>
                            <option value="tight">tight</option>
                            <option value="topAndBottom">topAndBottom</option>
                            <option value="none">none</option>
                          </FieldSelect>
                        </Field>
                        <Field>
                          <FieldLabel>Anchor Horizontal</FieldLabel>
                          <FieldSelect value={block.anchorHorizontal || 'margin'} onChange={(event) => updateBlock(block.id, (current) => current.type === 'image' ? { ...current, anchorHorizontal: event.target.value || undefined } : current)}>
                            <option value="margin">margin</option>
                            <option value="page">page</option>
                            <option value="column">column</option>
                            <option value="character">character</option>
                          </FieldSelect>
                        </Field>
                        <Field>
                          <FieldLabel>Anchor Vertical</FieldLabel>
                          <FieldSelect value={block.anchorVertical || 'paragraph'} onChange={(event) => updateBlock(block.id, (current) => current.type === 'image' ? { ...current, anchorVertical: event.target.value || undefined } : current)}>
                            <option value="paragraph">paragraph</option>
                            <option value="page">page</option>
                            <option value="margin">margin</option>
                            <option value="line">line</option>
                          </FieldSelect>
                        </Field>
                        </FieldGrid>
                      </InspectorSection>
                    </ObjectCard>
                  </ObjectCardList>
                )
              }

              if (block.type === 'formula') {
                const isActive = activeBlockId === block.id
                return (
                  <ObjectCardList key={block.id}>
                    <ObjectCard $active={isActive} onClick={() => setActiveBlockId(block.id)}>
                      <ObjectToolbar $active={isActive}>
                        <PreviewLabel>Embedded Formula</PreviewLabel>
                        <TextBlockMeta>对象 {index + 1}</TextBlockMeta>
                      </ObjectToolbar>
                      <PreviewTitle>{block.display === 'inline' ? '行内公式' : '块级公式'}</PreviewTitle>
                      <PreviewMeta>{block.latex}</PreviewMeta>
                      <FormulaPreview dangerouslySetInnerHTML={{ __html: katex.renderToString(block.latex || ' ', { throwOnError: false, displayMode: block.display === 'block' }) }} />
                      <InspectorSection $active={isActive}>
                      <FieldGrid>
                        <Field style={{ gridColumn: '1 / -1' }}>
                          <FieldLabel>LaTeX</FieldLabel>
                          <FieldTextArea value={block.latex} onChange={(event) => updateBlock(block.id, (current) => current.type === 'formula' ? { ...current, latex: event.target.value } : current)} spellCheck={false} />
                        </Field>
                        <Field>
                          <FieldLabel>Display</FieldLabel>
                          <FieldSelect value={block.display} onChange={(event) => updateBlock(block.id, (current) => current.type === 'formula' ? { ...current, display: event.target.value as 'inline' | 'block' } : current)}>
                            <option value="inline">inline</option>
                            <option value="block">block</option>
                          </FieldSelect>
                        </Field>
                      </FieldGrid>
                      </InspectorSection>
                    </ObjectCard>
                  </ObjectCardList>
                )
              }

              const isActive = activeBlockId === block.id
              if (!isEmbeddedTableBlock(block)) return null
              return (
                <ObjectCardList key={block.id}>
                  <ObjectCard $active={isActive} onClick={() => setActiveBlockId(block.id)}>
                    {(() => {
                      const selection = tableSelections[block.id] || null
                      const normalizedSelection = selection ? normalizeTableSelection(selection) : null
                      const grid = buildTableGrid(block)
                      const canMergeSelection = canMergeSelectedTableCells(block, selection)
                      return (
                        <>
                    <ObjectToolbar $active={isActive}>
                      <PreviewLabel>Embedded Table</PreviewLabel>
                      <TextBlockMeta>对象 {index + 1}</TextBlockMeta>
                    </ObjectToolbar>
                    <PreviewTitle>{block.rows} x {block.cols} 表格</PreviewTitle>
                    <PreviewMeta>表格单元格现在可直接编辑，保存时继续走现有 OOXML 表格结构回写链路。</PreviewMeta>
                    <TablePreview dangerouslySetInnerHTML={{ __html: serializeBlocksToHtml([block]) }} />
                    <InspectorSection $active={isActive}>
                    <ObjectCardActions>
                      <SecondaryButton onClick={() => handleAddTableRow(block.id)}>新增一行</SecondaryButton>
                      <SecondaryButton onClick={() => handleAddTableColumn(block.id)}>新增一列</SecondaryButton>
                      <SecondaryButton onClick={() => handleMergeTableSelection(block.id)} disabled={!canMergeSelection}>合并选区</SecondaryButton>
                      <SecondaryButton onClick={() => clearTableSelection(block.id)} disabled={!selection}>清空选区</SecondaryButton>
                    </ObjectCardActions>
                    <TableSelectionPanel>
                      <PreviewMeta>先在下方表格里点选左上角和右下角，形成矩形选区后再执行“合并选区”。</PreviewMeta>
                      <SelectionGrid>
                        <tbody>
                          {grid.map((row, rowIndex) => (
                            <tr key={`${block.id}-selection-row-${rowIndex}`}>
                              {row.map((slot, colIndex) => {
                                if (!slot.isAnchor) return null
                                const selected = normalizedSelection ? isGridSlotWithinSelection(normalizedSelection, rowIndex, colIndex) : false
                                return (
                                  <td key={`${block.id}-selection-cell-${rowIndex}-${colIndex}`} rowSpan={slot.cell.rowspan} colSpan={slot.cell.colspan}>
                                    <SelectionCellButton
                                      type="button"
                                      $selected={selected}
                                      $anchor={slot.isAnchor}
                                      onClick={() => handleTableGridCellClick(block.id, rowIndex, colIndex)}
                                    >
                                      <SelectionCellText>{slot.cell.text || '空单元格'}</SelectionCellText>
                                      <SelectionCellMeta>
                                        {rowIndex + 1}, {colIndex + 1}
                                        {slot.cell.colspan > 1 ? ` · colspan ${slot.cell.colspan}` : ''}
                                        {slot.cell.rowspan > 1 ? ` · rowspan ${slot.cell.rowspan}` : ''}
                                      </SelectionCellMeta>
                                    </SelectionCellButton>
                                  </td>
                                )
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </SelectionGrid>
                    </TableSelectionPanel>
                    <TableEditor>
                      {block.tableRows.map((row, rowIndex) => (
                        <TableRowCard key={`${block.id}-row-${rowIndex}`}>
                          <TableRowHeader>
                            <TableRowTitle>Row {rowIndex + 1}</TableRowTitle>
                            <ObjectCardActions style={{ marginTop: 0 }}>
                              <TableCellMeta>{row.length} 个逻辑单元格</TableCellMeta>
                              <SecondaryButton onClick={() => handleDeleteTableRow(block.id, rowIndex)}>删除本行</SecondaryButton>
                            </ObjectCardActions>
                          </TableRowHeader>
                          <TableCellList>
                            {row.map((cell, cellIndex) => (
                              <TableCellCard key={`${block.id}-row-${rowIndex}-cell-${cellIndex}`}>
                                <PreviewMeta>
                                  列 {cell.column + 1}
                                  {cell.colspan > 1 ? ` · colspan ${cell.colspan}` : ''}
                                  {cell.rowspan > 1 ? ` · rowspan ${cell.rowspan}` : ''}
                                  {cell.header ? ' · header' : ''}
                                </PreviewMeta>
                                <ObjectCardActions>
                                  <SecondaryButton onClick={() => handleDeleteTableColumn(block.id, cell.column)}>删除所在列</SecondaryButton>
                                  <SecondaryButton onClick={() => handleMergeTableCellRight(block.id, rowIndex, cellIndex)}>向右合并</SecondaryButton>
                                  <SecondaryButton onClick={() => handleMergeTableCellDown(block.id, rowIndex, cellIndex)}>向下合并</SecondaryButton>
                                  <SecondaryButton onClick={() => handleSplitTableCell(block.id, rowIndex, cellIndex)} disabled={cell.colspan === 1 && cell.rowspan === 1}>拆分单元格</SecondaryButton>
                                </ObjectCardActions>
                                <FieldGrid>
                                  <Field style={{ gridColumn: '1 / -1' }}>
                                    <FieldLabel>Cell Content</FieldLabel>
                                    <FieldTextArea
                                      value={tableParagraphsToEditorText(cell.paragraphs)}
                                      onChange={(event) => {
                                        const paragraphs = parseEditorTextToTableParagraphs(event.target.value)
                                        updateTableCell(block.id, rowIndex, cellIndex, (currentCell) => ({
                                          ...currentCell,
                                          paragraphs,
                                          text: buildTableCellText(paragraphs),
                                        }))
                                      }}
                                      spellCheck={false}
                                    />
                                  </Field>
                                  <Field>
                                    <FieldLabel>Header Cell</FieldLabel>
                                    <FieldSelect
                                      value={cell.header ? 'true' : 'false'}
                                      onChange={(event) => updateTableCell(block.id, rowIndex, cellIndex, (currentCell) => ({
                                        ...currentCell,
                                        header: event.target.value === 'true',
                                      }))}
                                    >
                                      <option value="false">td</option>
                                      <option value="true">th</option>
                                    </FieldSelect>
                                  </Field>
                                  <Field>
                                    <FieldLabel>Column Width</FieldLabel>
                                    <FieldInput
                                      value={cell.width || ''}
                                      onChange={(event) => updateTableCell(block.id, rowIndex, cellIndex, (currentCell) => ({
                                        ...currentCell,
                                        width: event.target.value || undefined,
                                      }))}
                                    />
                                  </Field>
                                  <Field>
                                    <FieldLabel>Colspan</FieldLabel>
                                    <FieldInput
                                      type="number"
                                      min={1}
                                      value={cell.colspan}
                                      onChange={(event) => updateTableCell(block.id, rowIndex, cellIndex, (currentCell) => ({
                                        ...currentCell,
                                        colspan: Math.max(1, Number(event.target.value) || 1),
                                      }))}
                                    />
                                  </Field>
                                  <Field>
                                    <FieldLabel>Rowspan</FieldLabel>
                                    <FieldInput
                                      type="number"
                                      min={1}
                                      value={cell.rowspan}
                                      onChange={(event) => updateTableCell(block.id, rowIndex, cellIndex, (currentCell) => ({
                                        ...currentCell,
                                        rowspan: Math.max(1, Number(event.target.value) || 1),
                                      }))}
                                    />
                                  </Field>
                                </FieldGrid>
                              </TableCellCard>
                            ))}
                          </TableCellList>
                        </TableRowCard>
                      ))}
                    </TableEditor>
                    </InspectorSection>
                        </>
                      )
                    })()}
                  </ObjectCard>
                </ObjectCardList>
              )
            })}
          </BlockList>}
          <Hint>
            当前版本已经切到 block/object renderer：段落和标题按块编辑，图片与公式直接保留对象属性；DOCX 保存时优先回写原始 OOXML 包，非可回写目标才退回通用导出。
          </Hint>
        </Page>
      </Body>
      {inlineRewrite ? (
        <>
          <Overlay onClick={inlineRewrite.streaming ? undefined : () => setInlineRewrite(null)} />
          <FloatingPanel style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
            <FloatingHeader>
              <span>AI 重写 {inlineRewrite.streaming ? '生成中...' : '结果确认'}</span>
              <FloatingButton onClick={() => setInlineRewrite(null)}>关闭</FloatingButton>
            </FloatingHeader>
            <FloatingBody>
              <RewriteOld>{inlineRewrite.original}</RewriteOld>
              <RewriteNew>{inlineRewrite.rewritten || '正在生成...'}</RewriteNew>
            </FloatingBody>
            {!inlineRewrite.streaming ? (
              <FloatingActions>
                <FloatingButton onClick={() => setInlineRewrite(null)}>取消</FloatingButton>
                <FloatingButton $primary onClick={handleAcceptRewrite}>接受</FloatingButton>
              </FloatingActions>
            ) : null}
          </FloatingPanel>
        </>
      ) : null}
      {inlineRef ? (
        <>
          <Overlay onClick={inlineRef.loading ? undefined : () => setInlineRef(null)} />
          <FloatingPanel style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
            <FloatingHeader>
              <span>文献检索 {inlineRef.loading ? '搜索中...' : `找到 ${inlineRef.citations.length} 条`}</span>
              {!inlineRef.loading ? <FloatingButton onClick={() => setInlineRef(null)}>关闭</FloatingButton> : null}
            </FloatingHeader>
            <FloatingBody>
              {inlineRef.loading ? <Hint>正在搜索文献...</Hint> : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid #e2e8f0' }}>
                    <Hint>已勾选 {inlineRef.selectedCitationKeys.length} / {inlineRef.citations.length} 篇</Hint>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <FloatingButton onClick={() => setInlineRef((prev) => prev ? { ...prev, selectedCitationKeys: prev.citations.map((citation) => buildCitationSelectionKey(citation)) } : prev)}>全选</FloatingButton>
                      <FloatingButton onClick={() => setInlineRef((prev) => prev ? { ...prev, selectedCitationKeys: [] } : prev)}>清空</FloatingButton>
                    </div>
                  </div>
                  {inlineRef.citations.map((citation, index) => {
                    const citationKey = buildCitationSelectionKey(citation)
                    const checked = inlineRef.selectedCitationKeys.includes(citationKey)
                    return (
                      <CitationRow key={`${citationKey}-${index}`}>
                        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                          <input type="checkbox" checked={checked} onChange={() => toggleInlineCitationSelection(citation)} style={{ marginTop: 3 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <CitationTitle><strong>[{citation.number}]</strong> {citation.citation}</CitationTitle>
                            {citation.abstract ? <CitationAbstract>{citation.abstract.slice(0, 220)}...</CitationAbstract> : null}
                          </div>
                        </label>
                      </CitationRow>
                    )
                  })}
                </>
              )}
            </FloatingBody>
            {!inlineRef.loading ? (
              <FloatingActions>
                <FloatingButton onClick={() => setInlineRef(null)}>取消</FloatingButton>
                <FloatingButton $primary onClick={handleInsertSelectedCitations} disabled={inlineRef.selectedCitationKeys.length === 0}>插入已选引用</FloatingButton>
              </FloatingActions>
            ) : null}
          </FloatingPanel>
        </>
      ) : null}
    </Root>
  )
}
