import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'
import { ArrowUp, MessageSquare, Mic, Paperclip, Square } from 'lucide-react'
import GenerationPromptComposer from '../../generation/components/GenerationPromptComposer'
import PlotWorkspace from '../../plot/components/PlotWorkspace'
import { useGenerationWorkbench } from '../../../contexts/GenerationWorkbenchContext'
import { useKnowledge } from '../../../contexts/KnowledgeContext'
import { DepartmentSelector } from '../../../components/DepartmentSelector'
import { useDocument } from '../../../contexts/DocumentContext'
import { useWorkspace } from '../../../contexts/WorkspaceContext'
import { useWorkspaceMode, type GenerationMode } from '../../../contexts/WorkspaceModeContext'
import { useDocumentEngineHostCommands } from '../../../engines/documentEngine/hostCommands'
import { runWritingAssistant } from '../../writing/services/WritingAssistantService'
import { openKnowledgeWorkspaceDraft, stripDocxExtension } from '../services/knowledgeWorkspace'
import { startChineseVoskVoiceInput, supportsVoskVoiceInput, type VoskVoiceInputSession } from '../../../services/voskVoiceInput'
import { markdownToHtml } from '../../../utils/markdownToHtml'
import { buildMinimalWritingRuleText } from '../../../utils/writingRulePrompt'
import type { KnowledgeDocumentDetail, KnowledgeGenerationTrace, KnowledgeRetrievalMode, KnowledgeTaskConstraints, KnowledgeTemplateInheritanceOptions, PreviewKnowledgeTaskContextResult } from '../../../types/knowledge'
import {
  buildKnowledgeGenerationTrace,
  buildKnowledgeReferenceMarkdown,
  buildKnowledgeTaskConstraints,
  createDefaultTemplateInheritance,
  getRetrievalModeLabel,
  persistKnowledgeTaskRecord,
  resolveKnowledgeTaskPreview,
  shouldRequestKnowledgePreview,
} from '../../../shared/knowledge/knowledgeTaskHelper'
import {
  type UnifiedComposerCapabilities,
  UnifiedComposerActionRow,
  UnifiedComposerFooter,
  UnifiedComposerShell,
  UnifiedComposerStatusPill,
  UnifiedComposerStatusRow,
  UnifiedComposerStatusText,
  UnifiedComposerTextarea,
  UnifiedDockCollapseBar,
  UnifiedDockCollapseBtn,
  UnifiedDockCollapseLabel,
  UnifiedDockExpandAction,
  UnifiedDockExpandLabel,
  UnifiedDockExpandStrip,
  UnifiedGenerationDockWrap,
  UnifiedGhostButton,
  UnifiedModeHintBody,
  UnifiedModeHintTitle,
  UnifiedSendButton,
} from '../../generation/components/generationDockPrimitives'
import { getGenerationModeOption } from '../../generation/components/generationWorkbenchConfig'

type ChatRole = 'user' | 'assistant' | 'system'
type KnowledgeTemplateMode = 'balanced' | 'structure-first' | 'style-first' | 'reference-synthesis'

interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  pending?: boolean
}

function mergeVoiceTranscript(base: string, transcript: string): string {
  const cleanedTranscript = String(transcript || '').trim()
  if (!cleanedTranscript) return base
  const cleanedBase = String(base || '')
  if (!cleanedBase.trim()) return cleanedTranscript
  if (/\s$/.test(cleanedBase)) return `${cleanedBase}${cleanedTranscript}`
  return `${cleanedBase}\n${cleanedTranscript}`
}

const TEMPLATE_MODE_OPTIONS: Array<{ value: KnowledgeTemplateMode; label: string; hint: string }> = [
  { value: 'balanced', label: '综合模板', hint: '同时继承模板的结构、文风和表达节奏。' },
  { value: 'structure-first', label: '结构优先', hint: '优先保留模板的章节骨架与段落组织。' },
  { value: 'style-first', label: '文风优先', hint: '优先保留模板的语气、信息密度和表达方式。' },
  { value: 'reference-synthesis', label: '资料融合', hint: '不严格复刻单篇结构，综合勾选资料重新组织。' },
]

function buildKnowledgeEvidenceContext(
  preview: PreviewKnowledgeTaskContextResult | null,
  constraints: KnowledgeTaskConstraints,
  includeTemplateSection: boolean,
): string | undefined {
  if (!preview) return undefined
  const parts: string[] = []
  if (includeTemplateSection && preview.templateSummary) {
    parts.push([
      '任务级模板继承约束：以下内容只用于继承结构、语气与术语风格，不作为新的事实来源。',
      preview.templateSummary,
    ].join('\n\n'))
  }

  const explicitCitations = preview.citations.filter((item) => item.sourceKind === 'required-reference' || item.sourceKind === 'preferred-reference')
  if (explicitCitations.length) {
    parts.push([
      '任务级显式参考证据：以下片段来自当前明确勾选的资料，优先级高于自动补充检索。',
      ...explicitCitations.map((item) => `- ${item.documentTitle}｜${item.locatorLabel}\n  ${item.quote}`),
    ].join('\n'))
  }

  const autoCitations = preview.citations.filter((item) => item.sourceKind === 'auto-retrieval')
  if (constraints.allowAutoRetrieval && autoCitations.length) {
    parts.push([
      '任务级自动补充证据：以下片段来自知识库自动检索，仅用于补足显式资料未覆盖的信息。',
      ...autoCitations.map((item) => `- ${item.documentTitle}｜${item.locatorLabel}\n  ${item.quote}`),
    ].join('\n'))
  }

  return parts.join('\n\n') || undefined
}

const DockWrap = styled.div<{ $expanded?: boolean }>`
  height: ${({ $expanded }) => ($expanded ? '460px' : '148px')};
  flex-shrink: 0;
  border-top: 1px solid #dce5ef;
  background: linear-gradient(180deg, #f9fbfe 0%, #f3f7fc 100%);
  display: flex;
  flex-direction: column;
  min-height: 0;
  transition: height 0.22s cubic-bezier(0.4, 0, 0.2, 1);
`

const Header = styled.div`
  padding: 10px 16px 8px;
  border-bottom: 1px solid #dce5ef;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  background: rgba(255, 255, 255, 0.7);
`

const HeaderMain = styled.div`
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
  color: #1e3a5f;
`

const Desc = styled.div`
  font-size: var(--font-size-xs);
  line-height: 1.5;
  color: #607487;
`

const HeaderMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: flex-end;
`

const MetaTag = styled.span<{ $tone?: 'accent' | 'muted' | 'warn' }>`
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: var(--font-size-xs);
  font-weight: 700;
  background: ${({ $tone }) => {
    if ($tone === 'accent') return '#eaf4ff'
    if ($tone === 'warn') return '#fff7e5'
    return '#f5f8fb'
  }};
  border: 1px solid ${({ $tone }) => {
    if ($tone === 'accent') return '#b9d4f0'
    if ($tone === 'warn') return '#edd4a6'
    return '#dce5ef'
  }};
  color: ${({ $tone }) => {
    if ($tone === 'accent') return '#1e5a92'
    if ($tone === 'warn') return '#8a5f1f'
    return '#607487'
  }};
`

const ClearButton = styled.button`
  min-width: 72px;
  height: 28px;
  border-radius: 8px;
  border: 1px solid #d6e0ea;
  background: #ffffff;
  color: #4b6278;
  font-size: var(--font-size-xs);
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;

  &:hover {
    background: #f4f8fc;
  }
`

const HeaderButtonRow = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
`

const ModeTabs = styled.div`
  padding: 0 16px 8px;
  display: flex;
  gap: 8px;
  border-bottom: 1px solid #dce5ef;
`

const ModeTab = styled.button<{ $active?: boolean }>`
  min-height: 28px;
  border-radius: 999px;
  border: 1px solid ${({ $active }) => ($active ? '#7aa8dc' : '#d6e0ea')};
  background: ${({ $active }) => ($active ? '#eaf3ff' : '#ffffff')};
  color: ${({ $active }) => ($active ? '#1e5a92' : '#607487')};
  font-size: var(--font-size-xs);
  font-weight: 700;
  padding: 0 12px;
  cursor: pointer;
  transition: all 0.15s;
`

const Body = styled.div`
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;

  @media (max-width: 1320px) {
    grid-template-columns: 1fr 300px;
  }
`

const MessagesPane = styled.div`
  min-width: 0;
  min-height: 0;
  border-right: 1px solid #dce5ef;
  display: flex;
  flex-direction: column;
`

const MessagesScroll = styled.div`
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 16px;
  display: grid;
  gap: 8px;

  &::-webkit-scrollbar {
    width: 7px;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(110, 140, 175, 0.4);
    border-radius: 999px;
  }
`

const MessageBubble = styled.div<{ $role: ChatRole }>`
  max-width: min(760px, 90%);
  justify-self: ${({ $role }) => ($role === 'user' ? 'end' : 'start')};
  border-radius: 14px;
  padding: 10px 14px;
  background: ${({ $role }) => {
    if ($role === 'user') return 'linear-gradient(180deg, #4a8cd6 0%, #3570b8 100%)'
    if ($role === 'assistant') return '#ffffff'
    return '#fff8ed'
  }};
  color: ${({ $role }) => ($role === 'user' ? '#ffffff' : $role === 'assistant' ? '#2c3e50' : '#8a5f1f')};
  border: 1px solid ${({ $role }) => ($role === 'assistant' ? '#dce5ef' : $role === 'system' ? '#edd4a6' : 'transparent')};
  box-shadow: ${({ $role }) => ($role === 'assistant' ? '0 4px 16px rgba(30, 58, 95, 0.06)' : 'none')};
  font-size: var(--font-size-xs);
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
`

const ComposerPane = styled.div`
  min-width: 0;
  min-height: 0;
  padding: 10px 14px;
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  gap: 8px;
  overflow-y: auto;
`

const CompactComposer = styled.div`
  padding: 12px 20px 14px;
  display: grid;
  gap: 8px;
  background: linear-gradient(180deg, rgba(250, 252, 255, 0.96) 0%, rgba(240, 246, 253, 0.94) 100%);
`

const MinimalComposerRow = styled.div`
  position: relative;
  min-width: 0;
`

const MinimalInputShell = styled.div`
  position: relative;
  min-width: 0;
  border: 1px solid #d6e0ea;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 4px 16px rgba(30, 58, 95, 0.06);
  padding: 12px 16px 10px;
  transition: border-color 0.15s, box-shadow 0.15s;

  &:focus-within {
    border-color: #7aa8dc;
    box-shadow: 0 4px 20px rgba(74, 140, 214, 0.12);
  }
`

const MinimalInput = styled.textarea`
  width: 100%;
  min-height: 44px;
  max-height: 80px;
  resize: none;
  border: none;
  background: transparent;
  color: #304255;
  padding: 0;
  font-size: 14px;
  line-height: 1.55;
  outline: none;

  &::placeholder {
    color: #a0aebc;
  }

  &:focus {
    box-shadow: none;
  }
`

const MinimalFooter = styled.div`
  margin-top: 8px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
`

const FloatingActions = styled.div`
  display: flex;
  gap: 10px;
  align-items: center;
`

const VoiceButton = styled.button<{ $active?: boolean }>`
  width: 32px;
  height: 32px;
  border-radius: 999px;
  border: 1px solid ${({ $active }) => ($active ? '#d98b52' : '#d6e0ea')};
  background: ${({ $active }) => ($active ? '#fff1e7' : '#ffffff')};
  color: ${({ $active }) => ($active ? '#b85b18' : '#607487')};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: ${({ $active }) => ($active ? '0 0 0 4px rgba(217, 139, 82, 0.12)' : 'none')};
  transition: all 0.15s ease;

  &:hover:not(:disabled) {
    background: ${({ $active }) => ($active ? '#ffe7d7' : '#f4f8fc')};
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`

const ExpandButton = styled.button`
  width: 32px;
  height: 32px;
  border-radius: 999px;
  border: none;
  background: transparent;
  color: #30343d;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: #f0f2f6;
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`

const FloatingSendButton = styled.button<{ $stop?: boolean }>`
  width: 36px;
  height: 36px;
  border-radius: 999px;
  border: 1px solid ${({ $stop }) => ($stop ? '#d9ba77' : '#7aa8dc')};
  background: ${({ $stop }) => ($stop ? '#fff7e5' : 'linear-gradient(180deg, #6ba3e0 0%, #4a8cd6 100%)')};
  color: ${({ $stop }) => ($stop ? '#8a601f' : '#ffffff')};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: ${({ $stop }) => ($stop ? 'none' : '0 4px 12px rgba(74, 140, 214, 0.2)')};
  cursor: pointer;
  transition: all 0.15s;

  &:hover:not(:disabled) {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`

const StatusCard = styled.div`
  border-radius: 10px;
  border: 1px solid #dce5ef;
  background: rgba(255, 255, 255, 0.88);
  padding: 8px 12px;
  font-size: var(--font-size-xs);
  line-height: 1.6;
  color: #4b6278;
`

const SelectionSummary = styled.div`
  border-radius: 10px;
  border: 1px solid #dce5ef;
  background: rgba(255, 255, 255, 0.74);
  padding: 8px 12px;
  display: grid;
  gap: 4px;
`

const SummaryTitle = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 700;
  color: #1e3a5f;
`

const SummaryText = styled.div`
  font-size: var(--font-size-xs);
  line-height: 1.6;
  color: #607487;
`

const QuickForm = styled.div`
  border-radius: 10px;
  border: 1px solid #dce5ef;
  background: rgba(255, 255, 255, 0.82);
  padding: 10px;
  display: grid;
  gap: 8px;
`

const FieldGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
`

const FieldRow = styled.div`
  display: grid;
  gap: 6px;
`

const FieldLabel = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #3d5b78;
`

const FieldSelect = styled.select`
  width: 100%;
  height: 34px;
  border-radius: 8px;
  border: 1px solid #d6e0ea;
  background: #ffffff;
  color: #304255;
  padding: 0 10px;
  font-size: var(--font-size-xs);
  outline: none;
  transition: border-color 0.15s;

  &:focus {
    border-color: #7aa8dc;
    box-shadow: 0 0 0 3px rgba(74, 140, 214, 0.1);
  }
`

const FieldInputRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
`

const FieldInput = styled.input`
  width: 100%;
  height: 34px;
  border-radius: 8px;
  border: 1px solid #d6e0ea;
  background: #ffffff;
  color: #304255;
  padding: 0 10px;
  font-size: var(--font-size-xs);
  outline: none;
  transition: border-color 0.15s;

  &:focus {
    border-color: #7aa8dc;
    box-shadow: 0 0 0 3px rgba(74, 140, 214, 0.1);
  }
`

const SecondaryButton = styled.button`
  min-width: 72px;
  height: 34px;
  border-radius: 8px;
  border: 1px solid #d6e0ea;
  background: #ffffff;
  color: #4b6278;
  font-size: var(--font-size-xs);
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s;

  &:hover:not(:disabled) {
    background: #f4f8fc;
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`

const FieldHint = styled.div`
  font-size: var(--font-size-xs);
  line-height: 1.5;
  color: #8a9caf;
`

const SegmentedControl = styled.div`
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
`

const SegmentButton = styled.button<{ $active?: boolean }>`
  min-height: 32px;
  border-radius: 8px;
  padding: 0 10px;
  border: 1px solid ${({ $active }) => ($active ? '#7aa8dc' : '#d6e0ea')};
  background: ${({ $active }) => ($active ? '#eaf3ff' : '#ffffff')};
  color: ${({ $active }) => ($active ? '#1e5a92' : '#607487')};
  font-size: var(--font-size-xs);
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;

  &:hover:not(:disabled) {
    background: ${({ $active }) => ($active ? '#e0edff' : '#f4f8fc')};
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`

const TextArea = styled.textarea`
  width: 100%;
  min-height: 80px;
  resize: none;
  border-radius: 10px;
  border: 1px solid #d6e0ea;
  background: #ffffff;
  color: #304255;
  padding: 10px 12px;
  font-size: var(--font-size-sm);
  line-height: 1.65;
  outline: none;
  transition: border-color 0.15s;

  &:focus {
    border-color: #7aa8dc;
    box-shadow: 0 0 0 3px rgba(74, 140, 214, 0.1);
  }
`

const Actions = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
`

const ActionButton = styled.button<{ $primary?: boolean; $warn?: boolean }>`
  min-width: 100px;
  height: 36px;
  border-radius: 8px;
  padding: 0 14px;
  border: 1px solid ${p => p.$primary ? '#2f6fb0' : p.$warn ? '#e3b55f' : '#d6e0ea'};
  background: ${p => p.$primary ? 'linear-gradient(180deg, #4a8cd6 0%, #3570b8 100%)' : p.$warn ? '#fff7e5' : '#ffffff'};
  color: ${p => p.$primary ? '#ffffff' : p.$warn ? '#8a601f' : '#4b6278'};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: var(--font-size-xs);
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s;

  &:hover:not(:disabled) {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`

function buildMessageId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function extractOutline(text: string): string[] {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(#{1,6}\s+|\d+[.)、]\s+|第[一二三四五六七八九十0-9]+[章节部分篇]\s*)/.test(line))
    .slice(0, 10)
}

function sanitizeFileSegment(value: string): string {
  const normalized = String(value || '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return (normalized || '知识库生成').slice(0, 28)
}

function buildDraftFileName(seed: string): string {
  const now = new Date()
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
  return `${sanitizeFileSegment(seed)}-${stamp}.docx`
}

function normalizeDraftFileName(value: string, fallbackSeed: string): string {
  const raw = String(value || '').trim()
  if (!raw) return buildDraftFileName(fallbackSeed)
  const normalized = sanitizeFileSegment(raw.replace(/\.docx$/i, ''))
  return `${normalized || sanitizeFileSegment(fallbackSeed)}.docx`
}

function buildUniqueDraftFileName(fileName: string, existingNames: string[]): string {
  const normalized = String(fileName || '').trim() || buildDraftFileName('知识库生成')
  const lowerCaseExisting = new Set(existingNames.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean))
  if (!lowerCaseExisting.has(normalized.toLowerCase())) return normalized

  const extensionMatch = normalized.match(/(\.[^.]+)$/)
  const extension = extensionMatch?.[1] || '.docx'
  const baseName = normalized.slice(0, normalized.length - extension.length) || '知识库生成'

  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${baseName}-${index}${extension}`
    if (!lowerCaseExisting.has(candidate.toLowerCase())) return candidate
  }

  return `${baseName}-${Date.now()}${extension}`
}

function inferDraftTitleFromMessages(messages: ChatMessage[]): string {
  const latestUser = [...messages].reverse().find((message) => message.role === 'user')?.content || ''
  return sanitizeFileSegment(latestUser) || '知识库生成'
}

function buildTemplateModeInstruction(mode: KnowledgeTemplateMode): string {
  if (mode === 'structure-first') {
    return '模板类型：结构优先。优先继承模板文档的章节骨架、段落推进顺序和版式组织，但具体事实与结论必须围绕当前任务重写。'
  }
  if (mode === 'style-first') {
    return '模板类型：文风优先。优先继承模板文档的语气、句法密度、措辞偏好和叙述节奏，但不强制沿用原章节结构。'
  }
  if (mode === 'reference-synthesis') {
    return '模板类型：资料融合。把勾选文档视作资料池，综合提炼结构与观点，允许重新组织章节，不要求严格复刻单篇模板。'
  }
  return '模板类型：综合模板。综合继承模板文档的篇章骨架、文风和表达方式，同时结合勾选资料完成新文稿。'
}

function buildConversationTranscript(messages: ChatMessage[]): string {
  return messages
    .filter((message) => message.role !== 'system')
    .slice(-8)
    .map((message) => `${message.role === 'user' ? '用户' : '助手'}：${message.content}`)
    .join('\n')
}

function buildTemplateDiscussionPrompt(latestUserInput: string, transcript: string, template: KnowledgeDocumentDetail, evidenceContext?: string) {
  return {
    instruction: [
      '你现在不是直接起草全文，而是作为知识库写作助手和用户对话。',
      '只回复一轮简短中文对话，长度控制在 120 到 220 字。',
      '你的任务是结合模板结构、文风和已勾选资料，帮助用户明确目标、补足约束、指出你将如何生成。',
      '不要输出完整报告，不要输出 Markdown 标题，不要进入 NFTCORE 固定综述/研究论文流程。',
      `用户最新消息：${latestUserInput}`,
    ].join('\n'),
    extraContext: [
      transcript ? `最近对话记录：\n${transcript}` : '',
      `模板文档：${template.meta.title}`,
      evidenceContext ? `任务级知识证据：\n${evidenceContext}` : '',
    ].filter(Boolean).join('\n\n'),
  }
}

function buildFreeformDiscussionPrompt(latestUserInput: string, transcript: string, evidenceContext?: string) {
  return {
    instruction: [
      '你现在作为办公写作助手与用户进行一轮中文对话。',
      '只回复一轮简短中文对话，长度控制在 120 到 220 字。',
      '你的任务是帮助用户明确文种、受众、用途、口径、篇幅与关键要点，并说明你接下来会如何起草。',
      '不要直接输出完整报告、通知或纪要，不要输出 Markdown 标题，不要进入 NFTCORE 固定综述/研究论文流程。',
      '如果用户目标已经足够明确，就直接确认理解并提示可以开始生成。',
      `用户最新消息：${latestUserInput}`,
    ].join('\n'),
    extraContext: [
      transcript ? `最近对话记录：\n${transcript}` : '',
      evidenceContext ? `任务级知识证据：\n${evidenceContext}` : '当前未指定模板文档，按自由办公写作方式处理。',
    ].filter(Boolean).join('\n\n'),
  }
}

function buildFreeformGenerationInstruction(latestDemand: string, fileName: string): string {
  return [
    latestDemand,
    '这是一次自由办公写作任务。请直接生成完整新文稿。',
    '文稿类型可以是报告、通知、纪要、方案、请示、总结或其他常见办公文种，请根据需求自行判断并生成合适结构。',
    '不要套用 NFTCORE 默认的综述论文或研究论文固定章节路线。',
    '如果需求没有明确文种，请优先输出适合办公场景、可以直接编辑和继续修改的正式文稿。',
    '如果提供了知识资料，只把它们作为背景事实、表达参考和素材来源，不要强行模仿单篇模板，不要编造未提供的数据。',
    `目标文件名：${fileName}`,
  ].join('\n')
}

async function waitForTabIdByPath(getTabs: () => Array<{ id: string; filePath: string | null }>, filePath: string): Promise<string | null> {
  for (let index = 0; index < 24; index += 1) {
    const matched = getTabs().find((tab) => tab.filePath === filePath)
    if (matched) return matched.id
    await new Promise((resolve) => window.setTimeout(resolve, 40))
  }
  return null
}

const LegacyKnowledgeConversationDock: React.FC = () => {
  const knowledge = useKnowledge()
  const { openWorkspace, refreshTree, activeWorkspacePath, activeWorkspaceName, fileTree } = useWorkspace()
  const { tabs, setTabShellContent, markTabShellSaved, setStatusMessage } = useDocument()
  const { openDocumentPath } = useDocumentEngineHostCommands()
  const [input, setInput] = useState('')
  const [voiceSupported] = useState(() => supportsVoskVoiceInput())
  const [voiceListening, setVoiceListening] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([{
    id: buildMessageId('system'),
    role: 'system',
    content: '可以先在这里和助手说清楚你要写什么。即使不选模板，也可以直接起草报告、通知、纪要等办公文稿；如果指定了模板，系统会优先沿用该模板的结构和文风。',
  }])
  const [status, setStatus] = useState('等待你描述新的办公写作任务')
  const [sending, setSending] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [currentDraftPath, setCurrentDraftPath] = useState<string | null>(null)
  const [templateMode, setTemplateMode] = useState<KnowledgeTemplateMode>('balanced')
  const [targetFileName, setTargetFileName] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [taskRetrievalMode, setTaskRetrievalMode] = useState<KnowledgeRetrievalMode>(() => (knowledge.templateDocumentId || knowledge.referenceDocumentIds.length ? 'selected-first' : 'auto'))
  const [taskAutoRetrievalLimit, setTaskAutoRetrievalLimit] = useState(5)
  const [taskTemplateInheritance, setTaskTemplateInheritance] = useState<KnowledgeTemplateInheritanceOptions>(createDefaultTemplateInheritance)
  const [taskContextPreview, setTaskContextPreview] = useState<PreviewKnowledgeTaskContextResult | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const voiceSessionRef = useRef<VoskVoiceInputSession | null>(null)
  const stopRequestedRef = useRef(false)
  const voiceBaseInputRef = useRef('')
  const voiceStopRequestedRef = useRef(false)
  const generationTaskIdRef = useRef<string | null>(null)
  const generationTaskTitleRef = useRef('')
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const tabsRef = useRef(tabs)
  const effectiveBusy = sending || generating
  const composerInputDisabled = effectiveBusy

  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [messages])

  useEffect(() => () => {
    voiceStopRequestedRef.current = true
    void voiceSessionRef.current?.stop().catch(() => undefined)
    voiceSessionRef.current = null
  }, [])

  useEffect(() => {
    setTaskRetrievalMode((knowledge.templateDocumentId || knowledge.referenceDocumentIds.length) ? 'selected-first' : 'auto')
    setTaskAutoRetrievalLimit(5)
    setTaskTemplateInheritance(createDefaultTemplateInheritance())
    setTaskContextPreview(null)
  }, [knowledge.referenceDocumentIds, knowledge.templateDocumentId])

  const effectiveSelectedIds = useMemo(() => {
    const ids = new Set(knowledge.referenceDocumentIds)
    if (knowledge.templateDocumentId) ids.add(knowledge.templateDocumentId)
    return Array.from(ids)
  }, [knowledge.referenceDocumentIds, knowledge.templateDocumentId])

  const selectedDocuments = useMemo(() => knowledge.documents.filter((item) => effectiveSelectedIds.includes(item.id)), [effectiveSelectedIds, knowledge.documents])

  const effectiveTemplateMeta = useMemo(() => {
    if (!knowledge.templateDocumentId) return null
    return knowledge.documents.find((item) => item.id === knowledge.templateDocumentId) || null
  }, [knowledge.documents, knowledge.templateDocumentId])

  const summaryText = useMemo(() => {
    if (effectiveTemplateMeta) {
      const refCount = selectedDocuments.filter((item) => item.id !== effectiveTemplateMeta.id).length
      return `模板文档：${effectiveTemplateMeta.title}${refCount > 0 ? `；附加参考资料：${refCount} 篇` : '；当前没有附加参考资料，系统主要按模板文风与结构生成。'}`
    }
    if (selectedDocuments.length > 0) {
      return `当前未指定模板；已勾选 ${selectedDocuments.length} 篇资料。系统会按自由办公写作方式综合这些资料来起草文稿。`
    }
    return '当前未指定模板，也未勾选资料。你可以直接描述报告、通知、纪要等需求，系统会按自由办公写作方式直接生成。'
  }, [effectiveTemplateMeta, selectedDocuments])

  const templateModeHint = useMemo(() => {
    if (!effectiveTemplateMeta) {
      return '未指定模板时，此选项不生效；系统会按自由办公写作方式自行组织结构和语气。'
    }
    return TEMPLATE_MODE_OPTIONS.find((item) => item.value === templateMode)?.hint || ''
  }, [effectiveTemplateMeta, templateMode])
  const compactStatus = useMemo(() => {
    const text = status || '等待你描述新的办公写作任务'
    return text.length > 42 ? `${text.slice(0, 42)}...` : text
  }, [status])

  const previewInstruction = useMemo(() => {
    const liveInput = input.trim()
    if (liveInput) return liveInput
    return [...messages].reverse().find((message) => message.role === 'user')?.content?.trim() || ''
  }, [input, messages])

  const buildTaskConstraints = useCallback((): KnowledgeTaskConstraints => buildKnowledgeTaskConstraints({
    mode: taskRetrievalMode,
    templateDocumentId: effectiveTemplateMeta?.id,
    requiredReferenceDocumentIds: selectedDocuments.filter((item) => item.id !== effectiveTemplateMeta?.id).map((item) => item.id),
    preferredReferenceDocumentIds: [],
    autoRetrievalLimit: taskAutoRetrievalLimit,
    templateInheritance: taskTemplateInheritance,
  }), [effectiveTemplateMeta?.id, selectedDocuments, taskAutoRetrievalLimit, taskRetrievalMode, taskTemplateInheritance])

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter') return
    if (event.shiftKey) return
    event.preventDefault()
    if (!effectiveBusy) {
      void handleGenerate()
    }
  }

  const stopVoiceInput = useCallback(async (reason?: string) => {
    voiceStopRequestedRef.current = true
    const activeSession = voiceSessionRef.current
    voiceSessionRef.current = null
    setVoiceListening(false)
    if (reason) {
      setStatus(reason)
      setStatusMessage(reason)
    }
    await activeSession?.stop().catch(() => undefined)
  }, [setStatusMessage])

  const handleVoiceInputToggle = useCallback(async () => {
    if (sending || generating) return
    if (voiceListening) {
      await stopVoiceInput('已停止语音输入')
      return
    }

    if (!voiceSupported) {
      const message = '当前环境不支持语音输入，请改用键盘输入'
      setStatus(message)
      setStatusMessage(message)
      return
    }

    try {
      voiceStopRequestedRef.current = false
      voiceBaseInputRef.current = input
      setStatus('正在启动语音输入...')
      setStatusMessage('正在启动语音输入')

      const session = await startChineseVoskVoiceInput({
        onPartialText: (partialText) => {
          const nextBase = voiceBaseInputRef.current
          setInput(partialText ? mergeVoiceTranscript(nextBase, partialText) : nextBase)
        },
        onFinalText: (finalText) => {
          const nextBase = finalText ? mergeVoiceTranscript(voiceBaseInputRef.current, finalText) : voiceBaseInputRef.current
          if (finalText) {
            voiceBaseInputRef.current = nextBase
          }
          setInput(nextBase)
        },
        onError: (message) => {
          void stopVoiceInput(message || '语音输入失败，请稍后重试')
        },
        onStatusChange: (message) => {
          setStatus(message)
          setStatusMessage(message)
        },
      })

      voiceSessionRef.current = session
      setVoiceListening(true)
      setStatus('语音输入中，请直接说出文稿需求')
      setStatusMessage('语音输入已开启')
    } catch (error) {
      const message = error instanceof Error && error.message.trim()
        ? error.message.trim()
        : '启动语音输入失败，请稍后重试'
      setStatus(message)
      setStatusMessage(message)
      setVoiceListening(false)
      voiceSessionRef.current = null
    }
  }, [generating, input, sending, setStatusMessage, stopVoiceInput, voiceListening, voiceSupported])

  const appendMessage = (message: ChatMessage) => {
    setMessages((prev) => [...prev, message])
  }

  const updateMessage = (messageId: string, content: string, pending = false) => {
    setMessages((prev) => prev.map((message) => message.id === messageId ? { ...message, content, pending } : message))
  }

  const resolveSelectedDetails = async (): Promise<{ template: KnowledgeDocumentDetail | null; references: KnowledgeDocumentDetail[] }> => {
    const candidateIds = new Set<string>(effectiveSelectedIds)
    if (effectiveTemplateMeta?.id) candidateIds.add(effectiveTemplateMeta.id)
    const details = (await Promise.all(Array.from(candidateIds).map((documentId) => window.electronAPI.getKnowledgeDocument(knowledge.departmentId, documentId).catch(() => null)))).filter(Boolean) as KnowledgeDocumentDetail[]
    const template = effectiveTemplateMeta?.id ? details.find((detail) => detail.meta.id === effectiveTemplateMeta.id) || null : null
    const references = details.filter((detail) => detail.meta.id !== template?.meta.id)
    return { template, references }
  }

  const buildKnowledgeTaskPreview = useCallback(async (instruction: string, includeTemplateSection: boolean): Promise<{ constraints: KnowledgeTaskConstraints; preview: PreviewKnowledgeTaskContextResult | null; trace?: KnowledgeGenerationTrace; context?: string }> => {
    const constraints = buildTaskConstraints()
    const hasKnowledgeConfig = shouldRequestKnowledgePreview(instruction, constraints)
    if (!hasKnowledgeConfig) {
      return { constraints, preview: null, trace: undefined, context: undefined }
    }

    const preview = await resolveKnowledgeTaskPreview({
      instruction,
      constraints,
      previewContext: (p: any) => window.electronAPI.previewKnowledgeTaskContext(knowledge.departmentId, p),
      cachedInstruction: previewInstruction,
      cachedPreview: taskContextPreview,
    })

    return {
      constraints,
      preview,
      trace: buildKnowledgeGenerationTrace(preview, constraints),
      context: buildKnowledgeEvidenceContext(preview, constraints, includeTemplateSection),
    }
  }, [buildTaskConstraints, previewInstruction, taskContextPreview])

  const saveKnowledgeGenerationTaskRecord = useCallback(async (params: {
    taskId: string
    title: string
    status: 'submitted' | 'completed' | 'failed' | 'stopped'
    errorMessage?: string
    generationTrace?: KnowledgeGenerationTrace
  }) => {
    const constraints = buildTaskConstraints()
    await persistKnowledgeTaskRecord({
      saveRecord: (p: any) => window.electronAPI.saveKnowledgeTaskRecord(knowledge.departmentId, p),
      taskId: params.taskId,
      title: params.title,
      status: params.status,
      constraints,
      generationTrace: params.generationTrace,
      instruction: params.title,
      errorMessage: params.errorMessage,
    })
  }, [buildTaskConstraints])

  const prepareDraftTarget = useCallback(async (params: {
    templateDocumentId?: string
    workspaceName: string
    fileName: string
    sourceDocumentIds: string[]
  }) => {
    if (activeWorkspacePath) {
      const resolvedFileName = buildUniqueDraftFileName(
        params.fileName,
        fileTree.filter((item) => item.type === 'file').map((item) => item.name),
      )
      const savedDraft = await window.electronAPI.saveManuscript(
        activeWorkspacePath,
        '<p></p>',
        resolvedFileName,
        params.templateDocumentId ? { templateDocumentId: params.templateDocumentId } : undefined,
      )
      await refreshTree()
      await openDocumentPath(savedDraft.path, { isInternalOpen: true })
      setStatusMessage(`已在当前工作区创建草稿：${resolvedFileName}`)
      return {
        success: true,
        workspacePath: activeWorkspacePath,
        name: activeWorkspaceName || activeWorkspacePath.split(/[/\\]/).pop() || activeWorkspacePath,
        documentPath: savedDraft.path,
        fileName: resolvedFileName,
        sourceCount: params.sourceDocumentIds.length,
      }
    }

    return openKnowledgeWorkspaceDraft({
      departmentId: knowledge.departmentId,
      documentId: params.templateDocumentId,
      workspaceName: params.workspaceName,
      fileName: params.fileName,
      sourceDocumentIds: params.sourceDocumentIds,
      content: '<p></p>',
      openWorkspace,
      openDocumentPath,
      refreshTree,
      setStatusMessage,
    })
  }, [activeWorkspaceName, activeWorkspacePath, fileTree, openDocumentPath, openWorkspace, refreshTree, setStatusMessage])

  useEffect(() => {
    const constraints = buildTaskConstraints()
    const hasKnowledgeConfig = shouldRequestKnowledgePreview(previewInstruction, constraints)
    if (!hasKnowledgeConfig) {
      setTaskContextPreview(null)
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      void resolveKnowledgeTaskPreview({
        instruction: previewInstruction,
        constraints,
        previewContext: (p: any) => window.electronAPI.previewKnowledgeTaskContext(knowledge.departmentId, p),
      }).then((result) => {
        if (cancelled) return
        setTaskContextPreview(result)
      })
    }, 220)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [buildTaskConstraints, previewInstruction])

  const handleDiscuss = async () => {
    const userText = input.trim()
    if (!userText || sending || generating) return
    const selection = await resolveSelectedDetails()
    const previewBundle = await buildKnowledgeTaskPreview(userText, Boolean(selection.template))

    const nextUserMessage: ChatMessage = { id: buildMessageId('user'), role: 'user', content: userText }
    const assistantMessageId = buildMessageId('assistant')
    const pendingAssistantMessage: ChatMessage = { id: assistantMessageId, role: 'assistant', content: '', pending: true }
    setInput('')
    setSending(true)
    setStatus(selection.template ? '正在读取模板与资料并生成对话回复...' : '正在整理你的办公写作需求...')
    setStatusMessage(selection.template ? '知识库对话助手正在整理你的需求' : '办公写作助手正在整理你的需求')
    setMessages((prev) => [...prev, nextUserMessage, pendingAssistantMessage])

    const transcript = buildConversationTranscript([...messages, nextUserMessage])
    const prompt = selection.template
      ? buildTemplateDiscussionPrompt(userText, transcript, selection.template, previewBundle.context)
      : buildFreeformDiscussionPrompt(userText, transcript, previewBundle.context)
    const controller = new AbortController()
    stopRequestedRef.current = false
    abortRef.current = controller
    const minimalRules = buildMinimalWritingRuleText('knowledge-discuss')
    window.dispatchEvent(new CustomEvent('ai-terminal-open'))

    try {
      await runWritingAssistant(
        {
          instruction: prompt.instruction,
          language: 'zh',
          extraContext: [prompt.extraContext || '', minimalRules].filter(Boolean).join('\n\n') || undefined,
        },
        {
          onStatus: (message) => {
            setStatus(message)
            setStatusMessage(message)
          },
          onDelta: (_delta, accumulated) => {
            updateMessage(assistantMessageId, accumulated, true)
          },
          onComplete: ({ text }) => {
            updateMessage(assistantMessageId, text.trim() || '我已经理解你的目标，可以直接开始生成。', false)
            setStatus('你可以继续补充需求，或直接生成新文稿')
            setStatusMessage(selection.template ? '知识库对话助手已完成本轮回复' : '办公写作助手已完成本轮回复')
          },
          onError: (error) => {
            if (stopRequestedRef.current || controller.signal.aborted) {
              updateMessage(assistantMessageId, '已停止当前对话。你可以继续补充需求，或直接开始生成。', false)
              setStatus('已停止当前办公写作/知识库任务')
              setStatusMessage('已停止当前办公写作/知识库任务')
              setCurrentDraftPath(null)
              return
            }
            updateMessage(assistantMessageId, `对话失败：${error}`, false)
            setStatus(`对话失败：${error}`)
            setStatusMessage(`${selection.template ? '知识库对话助手' : '办公写作助手'}失败：${error}`)
            setCurrentDraftPath(null)
          },
        },
        controller.signal,
      )
    } finally {
      abortRef.current = null
      setSending(false)
    }
  }

  const handleGenerate = async () => {
    if (generating || sending) return
    if (voiceListening) {
      await stopVoiceInput()
    }

    const latestInput = input.trim()
    const existingMessages = [...messages]
    const latestUserMessage: ChatMessage | null = latestInput
      ? { id: buildMessageId('user'), role: 'user', content: latestInput }
      : null
    const generationMessages: ChatMessage[] = latestUserMessage
      ? [...existingMessages, latestUserMessage]
      : existingMessages
    if (latestInput) setInput('')

    const selection = await resolveSelectedDetails()
    const latestDemand = [...generationMessages].reverse().find((message) => message.role === 'user')?.content || '请基于所选知识库文档生成新文稿'
    const fileName = normalizeDraftFileName(targetFileName, latestDemand)
    const workspaceName = stripDocxExtension(fileName) || stripDocxExtension(latestDemand) || '知识库新文章'
    const generationLabel = selection.template ? '知识库模板生成' : '自由办公写作'
    const sourceDocumentIds = selection.template
      ? [selection.template.meta.id, ...selection.references.map((item) => item.meta.id)]
      : selection.references.map((item) => item.meta.id)
    const previewBundle = await buildKnowledgeTaskPreview(latestDemand, true)
    const knowledgeTrace = previewBundle.trace
    const generationTaskId = buildMessageId('knowledge-task')
    generationTaskIdRef.current = generationTaskId
    generationTaskTitleRef.current = latestDemand
    const creatingMessageId = buildMessageId('system')
    const creatingMessage: ChatMessage = {
      id: creatingMessageId,
      role: 'system',
      content: `开始生成：${fileName}`,
    }
    setGenerating(true)
    setStatus(selection.template ? '正在创建新的知识库生成文稿...' : '正在创建新的办公写作文稿...')
    setStatusMessage(selection.template ? '正在创建知识库生成文稿' : '正在创建办公写作文稿')
    setMessages((prev) => {
      const latestGeneratedMessage = generationMessages[generationMessages.length - 1]
      return latestInput && latestGeneratedMessage
        ? [...prev, latestGeneratedMessage, creatingMessage]
        : [...prev, creatingMessage]
    })

    const controller = new AbortController()
    stopRequestedRef.current = false
    abortRef.current = controller
    window.dispatchEvent(new CustomEvent('ai-terminal-open'))

    try {
      if (knowledgeTrace) {
        void saveKnowledgeGenerationTaskRecord({ taskId: generationTaskId, title: latestDemand, status: 'submitted', generationTrace: knowledgeTrace }).catch(() => undefined)
      }

      const draftTarget = await prepareDraftTarget({
        templateDocumentId: selection.template?.meta.id,
        workspaceName,
        fileName,
        sourceDocumentIds,
      })
      const targetTabId = await waitForTabIdByPath(() => tabsRef.current, draftTarget.documentPath)
      setCurrentDraftPath(draftTarget.documentPath)

      const transcript = buildConversationTranscript(generationMessages)
      const minimalRules = buildMinimalWritingRuleText('document-generate')
      const assistantMessageId = buildMessageId('assistant')
      const assistantMessage: ChatMessage = { id: assistantMessageId, role: 'assistant', content: '', pending: true }
      appendMessage(assistantMessage)

      await runWritingAssistant(
        selection.template
          ? {
              instruction: [
                latestDemand,
                '这是一次知识库模板驱动生成任务。请直接生成完整新文稿。',
                buildTemplateModeInstruction(templateMode),
                '不要套用 NFTCORE 默认的综述论文或研究论文固定章节路线，而是以模板文档的篇章骨架、行文节奏和呈现方式为主。',
                '所有时间、事实、机构、结论都必须围绕当前需求重新生成，不能照抄模板旧内容。',
                `目标文件名：${fileName}`,
              ].join('\n'),
              language: 'zh' as const,
              extraContext: [
                transcript ? `需求对话记录：\n${transcript}` : '',
                previewBundle.context ? `任务级知识证据：\n${previewBundle.context}` : '',
                minimalRules,
              ].filter(Boolean).join('\n\n') || undefined,
              generationMode: 'knowledge-template-document' as const,
              templateDocument: {
                title: selection.template.meta.title,
                sourceType: selection.template.meta.sourceType,
                extractedText: selection.template.extractedText,
                outline: extractOutline(selection.template.extractedText),
              },
            }
          : {
              instruction: buildFreeformGenerationInstruction(latestDemand, fileName),
              language: 'zh' as const,
              extraContext: [
                transcript ? `需求对话记录：\n${transcript}` : '',
                previewBundle.context ? `任务级知识证据：\n${previewBundle.context}` : '',
                minimalRules,
              ].filter(Boolean).join('\n\n') || undefined,
              generationMode: 'default' as const,
            },
        {
          onStatus: (message) => {
            setStatus(message)
            setStatusMessage(message)
            updateMessage(creatingMessageId, `${fileName}\n${message}`)
          },
          onDelta: (_delta, accumulated) => {
            updateMessage(assistantMessageId, accumulated, true)
            if (targetTabId) {
              setTabShellContent(targetTabId, markdownToHtml(accumulated))
            }
          },
          onComplete: async ({ text }) => {
            // Append knowledge reference bibliography if available
            const knowledgeRefSection = buildKnowledgeReferenceMarkdown(knowledgeTrace)
            const finalText = knowledgeRefSection ? text.trimEnd() + '\n' + knowledgeRefSection : text
            updateMessage(assistantMessageId, finalText, false)
            if (targetTabId) {
              setTabShellContent(targetTabId, markdownToHtml(finalText))
            }
            await window.electronAPI.writeDocxFile(draftTarget.documentPath, finalText)
            if (targetTabId) {
              markTabShellSaved(targetTabId, { filePath: draftTarget.documentPath, fileName, content: markdownToHtml(finalText) })
            }
            await refreshTree()
            setStatus(`已生成并保存到 ${draftTarget.fileName}`)
            setStatusMessage(`${generationLabel}完成：${draftTarget.fileName}`)
            setCurrentDraftPath(null)
            setTargetFileName(draftTarget.fileName.replace(/\.docx$/i, ''))
            if (knowledgeTrace) {
              void saveKnowledgeGenerationTaskRecord({ taskId: generationTaskId, title: latestDemand, status: 'completed', generationTrace: knowledgeTrace }).catch(() => undefined)
            }
          },
          onError: (error) => {
            if (stopRequestedRef.current || controller.signal.aborted) {
              updateMessage(assistantMessageId, '已停止当前生成任务。你可以继续补充需求，或重新生成。', false)
              setStatus('已停止当前办公写作/知识库任务')
              setStatusMessage('已停止当前办公写作/知识库任务')
              setCurrentDraftPath(null)
              if (knowledgeTrace) {
                void saveKnowledgeGenerationTaskRecord({ taskId: generationTaskId, title: latestDemand, status: 'stopped', generationTrace: knowledgeTrace }).catch(() => undefined)
              }
              return
            }
            updateMessage(assistantMessageId, `生成失败：${error}`, false)
            setStatus(`生成失败：${error}`)
            setStatusMessage(`${generationLabel}失败：${error}`)
            setCurrentDraftPath(null)
            if (knowledgeTrace) {
              void saveKnowledgeGenerationTaskRecord({ taskId: generationTaskId, title: latestDemand, status: 'failed', errorMessage: error, generationTrace: knowledgeTrace }).catch(() => undefined)
            }
          },
        },
        controller.signal,
      )
    } catch (error) {
      const handledError = error as Error & { uiHandled?: boolean; stopped?: boolean }
      const message = error instanceof Error ? error.message : String(error)
      if (!handledError.uiHandled) {
        appendMessage({ id: buildMessageId('system'), role: 'system', content: `生成失败：${message}` })
        setStatus(`生成失败：${message}`)
        setStatusMessage(`知识库模板生成失败：${message}`)
        setCurrentDraftPath(null)
      }
      if (knowledgeTrace) {
        void saveKnowledgeGenerationTaskRecord({
          taskId: generationTaskId,
          title: latestDemand,
          status: handledError.stopped ? 'stopped' : 'failed',
          errorMessage: message,
          generationTrace: knowledgeTrace,
        }).catch(() => undefined)
      }
    } finally {
      generationTaskIdRef.current = null
      generationTaskTitleRef.current = ''
      abortRef.current = null
      setGenerating(false)
    }
  }

  const handleStop = () => {
    if (voiceListening) {
      void stopVoiceInput()
    }
    stopRequestedRef.current = true
    abortRef.current?.abort()
    abortRef.current = null
    setSending(false)
    setGenerating(false)
    setCurrentDraftPath(null)
    setStatus('已停止当前办公写作/知识库任务')
    setStatusMessage('已停止当前办公写作/知识库任务')
    appendMessage({ id: buildMessageId('system'), role: 'system', content: '已手动停止当前任务。你可以继续补充需求，或重新发起生成。' })
  }

  const handleCompactSubmit = () => {
    if (effectiveBusy) return
    void handleGenerate()
  }

  return (
    <DockWrap $expanded={historyOpen}>
      <DepartmentSelector />
      {historyOpen ? <>
        <Header>
          <HeaderMain>
            <Title><MessageSquare size={15} /> 知识库对话生成区</Title>
            <Desc>默认收纳为一个紧凑聊天栏，像常见 AI 助手一样直接输入需求；不选模板也能直接起草报告、通知、纪要，指定模板后则按模板结构与文风生成。</Desc>
          </HeaderMain>
          <HeaderMeta>
            <MetaTag $tone="accent">模板 {effectiveTemplateMeta ? 1 : 0}</MetaTag>
            <MetaTag>{`${selectedDocuments.length} 篇已勾选`}</MetaTag>
            {currentDraftPath ? <MetaTag $tone="warn">输出中</MetaTag> : null}
            <HeaderButtonRow>
              <ClearButton onClick={() => setHistoryOpen((value) => !value)} disabled={effectiveBusy}>{historyOpen ? '收起记录' : '展开记录'}</ClearButton>
              <ClearButton onClick={() => { setMessages([{ id: buildMessageId('system'), role: 'system', content: '对话已清空。你可以继续基于左侧勾选文档描述新的写作任务。' }]); setCurrentDraftPath(null) }} disabled={effectiveBusy}>清空对话</ClearButton>
            </HeaderButtonRow>
          </HeaderMeta>
        </Header>
      </> : null}

      {historyOpen ? <Body>
          <MessagesPane>
            <MessagesScroll>
              {messages.map((message) => (
                <MessageBubble key={message.id} $role={message.role}>
                  {message.pending && !message.content ? '...' : message.content}
                </MessageBubble>
              ))}
              <div ref={messagesEndRef} />
            </MessagesScroll>
          </MessagesPane>

          <ComposerPane>
            <StatusCard>{status}</StatusCard>
            <SelectionSummary>
              <SummaryTitle>本轮生成将使用的资料</SummaryTitle>
              <SummaryText>{summaryText}</SummaryText>
            </SelectionSummary>
            <QuickForm>
              <FieldGrid>
                <FieldRow>
                  <FieldLabel>模板策略</FieldLabel>
                  <FieldSelect value={templateMode} onChange={(event) => setTemplateMode(event.target.value as KnowledgeTemplateMode)} disabled={sending || generating || !effectiveTemplateMeta}>
                    {TEMPLATE_MODE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</FieldSelect>
                  <FieldHint>{templateModeHint}</FieldHint>
                </FieldRow>
                <FieldRow>
                  <FieldLabel>资料使用模式</FieldLabel>
                  <SegmentedControl>
                    <SegmentButton type="button" $active={taskRetrievalMode === 'selected-only'} onClick={() => setTaskRetrievalMode('selected-only')} disabled={sending || generating}>仅使用已选资料</SegmentButton>
                    <SegmentButton type="button" $active={taskRetrievalMode === 'selected-first'} onClick={() => setTaskRetrievalMode('selected-first')} disabled={sending || generating}>已选资料优先，允许自动补充</SegmentButton>
                    <SegmentButton type="button" $active={taskRetrievalMode === 'auto'} onClick={() => setTaskRetrievalMode('auto')} disabled={sending || generating}>完全自动检索</SegmentButton>
                  </SegmentedControl>
                  <FieldHint>{getRetrievalModeLabel(taskRetrievalMode)}</FieldHint>
                </FieldRow>
                <FieldRow>
                  <FieldLabel>目标文件名</FieldLabel>
                  <FieldInputRow>
                    <FieldInput
                      value={targetFileName}
                      onChange={(event) => setTargetFileName(event.target.value)}
                      placeholder="例如：2026年行业报告-管理层版"
                      disabled={sending || generating}
                    />
                    <SecondaryButton onClick={() => setTargetFileName(inferDraftTitleFromMessages(messages))} disabled={sending || generating}>带入标题</SecondaryButton>
                  </FieldInputRow>
                  <FieldHint>生成时会自动补全为 .docx。留空则按最新需求自动命名。</FieldHint>
                </FieldRow>
              </FieldGrid>
            </QuickForm>
          </ComposerPane>
        </Body> : null}

      <CompactComposer>
        <MinimalComposerRow>
          <MinimalInputShell>
            <MinimalInput
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder="直接描述你要写的报告、通知、纪要或其他文稿需求"
              disabled={composerInputDisabled}
            />
            <MinimalFooter>
              <FloatingActions>
                <ExpandButton type="button" onClick={() => setHistoryOpen(true)} title="展开更多设置和历史记录" disabled={effectiveBusy}>
                  <Paperclip size={18} />
                </ExpandButton>
                <VoiceButton
                  type="button"
                  onClick={() => { void handleVoiceInputToggle() }}
                  title={voiceSupported ? (voiceListening ? '停止语音输入' : '开启语音输入') : '当前环境不支持语音输入'}
                  aria-label={voiceSupported ? (voiceListening ? '停止语音输入' : '开启语音输入') : '当前环境不支持语音输入'}
                  disabled={!voiceSupported || effectiveBusy}
                  $active={voiceListening}
                >
                  <Mic size={16} />
                </VoiceButton>
                {(sending || generating) ? (
                  <FloatingSendButton type="button" $stop onClick={handleStop} title="停止当前任务">
                    <Square size={13} />
                  </FloatingSendButton>
                ) : (
                  <FloatingSendButton type="button" onClick={handleCompactSubmit} disabled={!input.trim() || effectiveBusy} title="直接生成文章">
                    <ArrowUp size={16} />
                  </FloatingSendButton>
                )}
              </FloatingActions>
            </MinimalFooter>
          </MinimalInputShell>
        </MinimalComposerRow>
      </CompactComposer>
    </DockWrap>
  )
}

function WorkbenchHintDock({ mode, testId }: { mode: 'email' | 'homework'; testId: string }) {
  const opt = getGenerationModeOption(mode)
  const extra = mode === 'email'
    ? '草稿生成、预回复与发送请在上方面板中完成；此处不提供独立提交，避免与文稿写作通道混淆。'
    : '题目提取与逐题解答请在上传区与主列表中完成；此处不提供独立提交，避免与文稿写作通道混淆。'
  return (
    <UnifiedGenerationDockWrap data-testid={testId}>
      <UnifiedComposerShell>
        <UnifiedModeHintTitle>{opt.label}</UnifiedModeHintTitle>
        <UnifiedModeHintBody>
          {opt.description}
          {' '}
          {extra}
        </UnifiedModeHintBody>
      </UnifiedComposerShell>
    </UnifiedGenerationDockWrap>
  )
}

function ImageModeDock() {
  const [activeTab, setActiveTab] = useState<'ai-image' | 'data-plot'>('ai-image')
  return (
    <>
      <ModeTabs>
        <ModeTab $active={activeTab === 'ai-image'} onClick={() => setActiveTab('ai-image')}>AI 生图</ModeTab>
        <ModeTab $active={activeTab === 'data-plot'} onClick={() => setActiveTab('data-plot')}>数据绘图</ModeTab>
      </ModeTabs>
      {activeTab === 'ai-image' ? <GenerationPromptComposer /> : <PlotWorkspace />}
    </>
  )
}

const KnowledgeConversationDock: React.FC = () => {
  const { mode, generationMode } = useWorkspaceMode()
  const [collapsedByMode, setCollapsedByMode] = useState<Partial<Record<GenerationMode, boolean>>>({})

  if (mode !== 'generation' || generationMode === 'document' || generationMode === 'daily-report' || generationMode === 'data' || generationMode === 'model' || generationMode === 'email') return null

  const collapsed = collapsedByMode[generationMode] ?? false
  const setCollapsed = (next: boolean) => {
    setCollapsedByMode((prev) => ({ ...prev, [generationMode]: next }))
  }

  const modeLabel = generationMode === 'image' ? '图片生成'
    : generationMode === 'ppt' ? 'PPT 生成'
    : generationMode === 'homework' ? '作业解答'
    : '生成'

  if (collapsed) {
    return (
      <UnifiedDockExpandStrip onClick={() => setCollapsed(false)}>
        <UnifiedDockExpandLabel>✨ {modeLabel}</UnifiedDockExpandLabel>
        <UnifiedDockExpandAction>展开 ↑</UnifiedDockExpandAction>
      </UnifiedDockExpandStrip>
    )
  }

  const dockBody = generationMode === 'homework'
      ? <WorkbenchHintDock mode="homework" testId="homework-hint-dock" />
      : generationMode === 'image'
        ? <ImageModeDock />
        : <GenerationPromptComposer />

  return (
    <div>
      <UnifiedDockCollapseBar>
        <UnifiedDockCollapseLabel>{modeLabel}</UnifiedDockCollapseLabel>
        <UnifiedDockCollapseBtn type="button" onClick={() => setCollapsed(true)}>收起 ↓</UnifiedDockCollapseBtn>
      </UnifiedDockCollapseBar>
      {dockBody}
    </div>
  )
}

export default KnowledgeConversationDock