import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styled, { css, keyframes } from 'styled-components'
import { EmailProvider } from '../modules/email/contexts/EmailContext'
import ComposeModal from '../modules/email/components/ComposeModal'
import { consumePendingCompose } from '../services/pendingEmailCompose'
import { MailTriageProvider, useMailTriage } from '../modules/email/contexts/MailTriageContext'
import { fromEmailThreadId, toEmailThreadId } from './providers/ImapEmailProvider'
import { CommunicationProvider, useCommunication } from './CommunicationContext'
import { useInternalAccount } from '../contexts/InternalAccountContext'
import { useMatrixChat } from '../contexts/MatrixChatContext'
import { useWorkspace } from '../contexts/WorkspaceContext'
import { useWorkspaceMode } from '../contexts/WorkspaceModeContext'
import { useGenerationWorkbench, type PptSlidePreview } from '../contexts/GenerationWorkbenchContext'
import { useDepartment } from '../contexts/DepartmentContext'
import { logActivity } from '../services/workActivityLog'
import { fetchMatrixMediaBlob } from '../services/matrixClient'
import type { MailAttachmentOpenResult } from '../types/mailAttachment'
import type { AiEmailActionPlan, AiMailTriageResult, EmailActionType, EmailAnalysisBatchSummary, EmailContentTopicSummary } from '../types/mailTriage'
import type {
  CommunicationAttachment,
  CommunicationMessage,
  CommunicationThread,
  CommFilter,
} from './types'
import type { EmailAccountConfig, EmailConnectionCheckResult, EmailReplyGenerationOptions, EmailReplyKnowledgeSelection, EmailReplyKnowledgeSnippet, EmailReplyKnowledgeTrace } from '../types/email'
import { EMAIL_ACCOUNT_PRESETS } from '../types/email'
import type { CustomEmailPreset } from '../types/email'
import type { MailItem } from '../types/email'
import { buildEmailReplyKnowledgeTrace } from './services/emailReplyKnowledgeTrace'
import type { Department } from '../types/knowledge'
import type { CalendarConflict } from '../calendar/calendarConflict'
import { detectCalendarConflicts } from '../calendar/calendarConflict'
import { createCalendarEventFromEmail } from '../calendar/emailCalendarBridge'
import { listCalendarEvents } from '../calendar/calendarService'
import type { CalendarEventType } from '../calendar/types'
import {
  startEmailWorkflow,
  getMyWorkflowTasks,
  completeWorkflowTask,
  type WorkflowTask,
} from '../services/workflowClient'
import WorkflowTasksPanel from './components/WorkflowTasksPanel'
import { shouldAutoStartWorkflow, buildAutoWorkflowInput } from './services/emailWorkflowAutoStart'
import { detectMatterScenario, buildEmailMatter, serializeMatterToSummary } from './services/emailMatterBuilder'
import { handleCampusCardReplacementMatter, type AgentWorkflowResult } from './services/cuhkszAgentWorkflow'

type ImportedDeckSlide = {
  index?: number
  intent?: string
  title?: string
  subtitle?: string
  heading?: string
  body?: string
  items?: string[]
  summary?: string
  speakerNotes?: string
  notes?: string
  visualBrief?: string
}

function deckToPptSlidePreviews(deck: unknown, previewSlides: Array<{ index: number; imagePath: string; title?: string }>): PptSlidePreview[] {
  const raw = deck && typeof deck === 'object' && Array.isArray((deck as { slides?: unknown[] }).slides)
    ? (deck as { slides: ImportedDeckSlide[] }).slides
    : []
  const previewByIndex = new Map(previewSlides.map((slide) => [slide.index, slide]))
  return raw.map((slide, fallbackIndex) => {
    const index = typeof slide.index === 'number' ? slide.index : fallbackIndex
    const preview = previewByIndex.get(index)
    return {
      index,
      type: slide.intent || 'content',
      title: slide.title,
      subtitle: slide.subtitle,
      heading: slide.heading,
      body: slide.body,
      items: Array.isArray(slide.items) ? slide.items : undefined,
      summary: slide.summary,
      speakerNotes: slide.speakerNotes || slide.notes,
      notes: slide.notes || slide.speakerNotes,
      visualBrief: slide.visualBrief,
      imagePath: preview?.imagePath || null,
      imageLoading: false,
      isGenerating: false,
    }
  })
}


/* ================================================================== */
/*  Animations                                                        */
/* ================================================================== */

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.45; }
`

/* ================================================================== */
/*  Layout shell                                                      */
/* ================================================================== */

const Shell = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: #f4f7fa;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
`

const MainPanels = styled.div`
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
`

/* ================================================================== */
/*  Left panel                                                        */
/* ================================================================== */

const LeftPanel = styled.div`
  width: 340px;
  min-width: 320px;
  max-width: 380px;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #dde4ec;
  background: #ffffff;
  overflow-x: hidden;
`

const LeftHeader = styled.div`
  padding: 10px 14px 8px;
  border-bottom: 1px solid #eaeff5;
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const LeftHeaderTitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`

const LeftTitle = styled.div`
  font-size: 15px;
  font-weight: 700;
  color: #1a202c;
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  writing-mode: horizontal-tb;
  flex-shrink: 0;
`

const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`

const HeaderActionRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`

const IconBtn = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  color: #718096;
  padding: 4px 6px;
  border-radius: 6px;
  font-size: 15px;
  display: flex;
  align-items: center;
  &:hover { color: #3182ce; background: #ebf3fd; }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
`

const UnreadBadge = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 10px;
  font-size: var(--font-size-xs);
  font-weight: 700;
  background: #3182ce;
  color: #fff;
`

/* ---- Main nav (segmented control) ---- */

const NavBar = styled.div`
  display: flex;
  padding: 10px 12px 0;
  gap: 2px;
  border-bottom: 1px solid #dde4ec;
  background: #ffffff;
`

const NavTab = styled.button<{ $active: boolean }>`
  flex: 1;
  padding: 7px 4px;
  border: none;
  border-bottom: 2.5px solid ${({ $active }) => ($active ? '#3182ce' : 'transparent')};
  background: transparent;
  color: ${({ $active }) => ($active ? '#2b6cb0' : '#718096')};
  font-size: var(--font-size-sm);
  font-weight: ${({ $active }) => ($active ? 700 : 500)};
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.12s;
  &:hover { color: #3182ce; border-bottom-color: #90cdf4; }
`

/* ---- Compose button (prominent text btn) ---- */

const ComposeBtn = styled.button`
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border-radius: 7px;
  border: 1.5px solid #3182ce;
  background: #3182ce;
  color: #ffffff;
  font-size: var(--font-size-xs);
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  min-width: fit-content;
  transition: all 0.12s;
  &:hover { background: #2b6cb0; border-color: #2b6cb0; }
  &:disabled { opacity: 0.55; cursor: not-allowed; }
`

const AiComposeBtn = styled.button`
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border-radius: 7px;
  border: 1.5px solid #553c9a;
  background: #553c9a;
  color: #ffffff;
  font-size: var(--font-size-xs);
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  min-width: fit-content;
  transition: all 0.12s;
  &:hover { background: #44337a; border-color: #44337a; }
  &:disabled { opacity: 0.55; cursor: not-allowed; }
`

/* ---- Sort control bar ---- */

const SortBar = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-bottom: 1px solid #eaeff5;
  background: #f8fafc;
  font-size: var(--font-size-xs);
  color: #718096;
  flex-shrink: 0;
`

const SortLabel= styled.span`
  flex-shrink: 0;
`

const SortBtn = styled.button<{ $active: boolean }>`
  padding: 2px 8px;
  border-radius: 8px;
  border: 1px solid ${({ $active }) => ($active ? '#553c9a' : '#dde4ec')};
  background: ${({ $active }) => ($active ? '#f5f0ff' : 'transparent')};
  color: ${({ $active }) => ($active ? '#553c9a' : '#a0aec0')};
  font-size: var(--font-size-xs);
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.12s;
  &:hover { border-color: #9f7aea; color: #553c9a; background: #f5f0ff; }
`

/* ---- Sub-filter chips (secondary, below nav) ---- */

const SubFilterBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid #eaeff5;
  background: #fafcff;
`

const SubFilterChip = styled.button<{ $active: boolean }>`
  padding: 2px 9px;
  border-radius: 10px;
  border: 1px solid ${({ $active }) => ($active ? '#3182ce' : '#dde4ec')};
  background: ${({ $active }) => ($active ? '#ebf3fd' : 'transparent')};
  color: ${({ $active }) => ($active ? '#2b6cb0' : '#a0aec0')};
  font-size: var(--font-size-xs);
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  max-width: none;
  transition: all 0.12s;
  &:hover { border-color: #90cdf4; color: #2b6cb0; background: #f0f7ff; }
`

/* ---- Thread list ---- */

const ThreadList = styled.div`
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px 6px;
`

const ThreadCard = styled.div<{ $active?: boolean; $unread?: boolean; $highlighted?: boolean }>`
  position: relative;
  padding: 11px 12px;
  border-radius: 8px;
  margin-bottom: 2px;
  cursor: pointer;
  transition: background 0.1s, border-color 0.1s;
  background: ${({ $active, $highlighted }) => ($active ? '#ebf3fd' : $highlighted ? '#fffbeb' : '#fff')};
  border: 1px solid ${({ $active, $highlighted }) => ($active ? '#b3d1f0' : $highlighted ? '#f6ad55' : 'transparent')};
  &:hover {
    background: ${({ $active, $highlighted }) => ($active ? '#ebf3fd' : $highlighted ? '#fff7d6' : '#f7fafc')};
    border-color: ${({ $active, $highlighted }) => ($active ? '#b3d1f0' : $highlighted ? '#f6ad55' : '#e2e8f0')};
  }
  &:hover .thread-delete-btn {
    opacity: 1;
  }
`

const ThreadDeleteBtn = styled.button`
  position: absolute;
  top: 8px;
  right: 8px;
  opacity: 0;
  transition: opacity 0.15s, background 0.1s;
  background: none;
  border: none;
  padding: 3px 5px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  color: #a0aec0;
  line-height: 1;
  &:hover {
    background: #fed7d7;
    color: #c53030;
  }
`

const ThreadSubject = styled.div<{ $unread?: boolean }>`
  font-size: var(--font-size-sm);
  font-weight: ${({ $unread }) => ($unread ? 700 : 500)};
  color: #1a202c;
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  overflow: hidden;
`

const ThreadSubjectText = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
`

const ThreadMeta = styled.div`
  font-size: var(--font-size-xs);
  color: #718096;
  margin-top: 2px;
  display: flex;
  align-items: center;
  gap: 6px;
`

const ThreadSnippet = styled.div`
  font-size: var(--font-size-xs);
  color: #a0aec0;
  margin-top: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

/* ---- AI Triage UI components ---- */

const AiTriageRow = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 4px;
  flex-wrap: wrap;
`

const AiStatusBadge = styled.span<{ $status: 'pending' | 'running' | 'success' | 'failed' | 'none' | 'skipped' }>`
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  border-radius: 8px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  white-space: nowrap;
  ${({ $status }) => {
    if ($status === 'running' || $status === 'pending') return css`
      background: #ebf4ff; color: #3182ce; border: 1px solid #bee3f8;
      animation: ${pulse} 1.5s ease-in-out infinite;
    `
    if ($status === 'success') return 'background: #f0fff4; color: #276749; border: 1px solid #9ae6b4;'
    if ($status === 'failed') return 'background: #fff5f5; color: #c53030; border: 1px solid #fc8181;'
    if ($status === 'skipped') return 'background: #f0fff4; color: #276749; border: 1px solid #9ae6b4;'
    return 'background: #f7fafc; color: #a0aec0; border: 1px solid #e2e8f0;'
  }}
`

const AiCategoryTag = styled.span<{ $cat: string }>`
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 8px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  white-space: nowrap;
  ${({ $cat }) => {
    if ($cat === 'action_required') return 'background: #fff5eb; color: #c05621; border: 1px solid #fbd38d;'
    if ($cat === 'reply_required') return 'background: #ebf4ff; color: #2b6cb0; border: 1px solid #90cdf4;'
    if ($cat === 'risk') return 'background: #fff5f5; color: #c53030; border: 1px solid #fc8181;'
    if ($cat === 'promotion') return 'background: #faf5ff; color: #6b46c1; border: 1px solid #d6bcfa;'
    if ($cat === 'archive_candidate') return 'background: #f7fafc; color: #718096; border: 1px solid #e2e8f0;'
    if ($cat === 'read_only') return 'background: #f0fff4; color: #276749; border: 1px solid #9ae6b4;'
    return 'background: #f7fafc; color: #a0aec0; border: 1px solid #e2e8f0;'
  }}
`

/* ---- AI recommendation card in detail pane ---- */

const AiRecommendCard = styled.div<{ $risk?: boolean }>`
  margin: 10px 16px;
  padding: 10px 14px;
  border-radius: 10px;
  background: ${({ $risk }) => ($risk ? '#fff5f5' : '#f0f7ff')};
  border: 1px solid ${({ $risk }) => ($risk ? '#fc8181' : '#bee3f8')};
`

/* ---- Workflow UI components ---- */

const WorkflowInlineBtn = styled.button<{ $variant?: 'start' | 'approve' | 'reject' | 'neutral' }>`
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 12px; border-radius: 6px; border: none;
  font-size: var(--font-size-xs); font-weight: 600; cursor: pointer;
  transition: all 0.13s;
  &:disabled { opacity: 0.5; cursor: not-allowed; }
  ${({ $variant }) => {
    if ($variant === 'approve') return 'background:#c6f6d5;color:#276749;&:hover:not(:disabled){background:#9ae6b4;}'
    if ($variant === 'reject') return 'background:#fed7d7;color:#c53030;&:hover:not(:disabled){background:#feb2b2;}'
    if ($variant === 'neutral') return 'background:#edf2f7;color:#4a5568;&:hover:not(:disabled){background:#e2e8f0;}'
    return 'background:#ebf4ff;color:#2b6cb0;&:hover:not(:disabled){background:#bee3f8;}'
  }}
`

const WorkflowStatusMsg = styled.div<{ $variant?: 'error' | 'info' | 'success' }>`
  font-size: var(--font-size-xs); margin-top: 6px;
  color: ${({ $variant }) => $variant === 'error' ? '#c53030' : $variant === 'success' ? '#276749' : '#4a5568'};
`

const AiRecommendTitle = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 700;
  color: #2d3748;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
`

const AiRecommendValue = styled.span`
  color: #2d3748;
  word-break: break-word;
`

const AiInfoBlock = styled.div`
  margin-top: 8px;
`

const AiInfoHead = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 700;
  color: #4a5568;
  margin-bottom: 3px;
`

const AiInfoBody = styled.div`
  font-size: var(--font-size-xs);
  color: #2d3748;
  line-height: 1.6;
  word-break: break-word;
`

const UnreadDot = styled.span`
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #3182ce;
  flex-shrink: 0;
`

const EmptyThreadList = styled.div`
  padding: 32px 16px;
  text-align: center;
  color: #a0aec0;
  font-size: var(--font-size-sm);
`

/* ---- Connection status strip ---- */

const StatusStrip = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 5px 10px;
  border-bottom: 1px solid #eaeff5;
  background: #fafcff;
`

const StatusDot = styled.span<{ $ok?: boolean; $warn?: boolean }>`
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: ${({ $ok, $warn }) => ($ok ? '#38a169' : $warn ? '#dd6b20' : '#a0aec0')};
  margin-right: 4px;
  vertical-align: middle;
`

const StatusLabel = styled.span`
  font-size: var(--font-size-xs);
  color: #718096;
`

/* ---- New DM section ---- */

const NewDmBar = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 6px;
  border-bottom: 1px solid #eaeff5;
  background: #fafcff;
`

const DmInput = styled.input`
  flex: 1;
  border: 1px solid #dde4ec;
  border-radius: 6px;
  padding: 4px 8px;
  font-size: var(--font-size-xs);
  color: #2d3748;
  background: #fff;
  outline: none;
  &:focus { border-color: #63b3ed; }
  &::placeholder { color: #a0aec0; }
`

const DmBtn= styled.button`
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid #3182ce;
  background: #ebf3fd;
  color: #2b6cb0;
  font-size: var(--font-size-xs);
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  &:hover { background: #bee3f8; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`

/* ================================================================== */
/*  Detail pane(right side — replaces CenterPanel)                  */
/* ================================================================== */

const DetailPane = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: #ffffff;
`

const MessagePane = styled.div`
  flex: 1;
  overflow-y: auto;
  min-height: 0;
`

const ThreadHeader = styled.div`
  padding: 18px 24px 14px;
  border-bottom: 1px solid #eaeff5;
  background: #fff;
  flex-shrink: 0;
`

const ThreadHeaderTop = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
`

const ThreadHeaderSubject = styled.h2`
  margin: 0 0 6px;
  font-size: 17px;
  font-weight: 700;
  color: #1a202c;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`

const ThreadHeaderMeta = styled.div`
  font-size: var(--font-size-xs);
  color: #718096;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
`

const ThreadHeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
`

const EmptyCenterState = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #a0aec0;
  font-size: 14px;
`

/* ---- Email body ---- */

const DetailSection = styled.div`
  padding: 18px 24px 14px;
  border-bottom: 1px solid #eaeff5;
`

const DetailMetaGrid = styled.div`
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  font-size: var(--font-size-xs);
  color: #4a5568;
`

const MetaLabel = styled.span`
  color: #a0aec0;
  font-weight: 600;
  text-align: right;
`

const DetailBodyToolbar = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 24px;
  background: #f7fafc;
  border-bottom: 1px solid #eaeff5;
  flex-wrap: wrap;
`

const BodyToggleBtn = styled.button<{ $active?: boolean }>`
  padding: 3px 12px;
  border-radius: 12px;
  border: 1.5px solid ${({ $active }) => ($active ? '#3182ce' : '#cbd5e0')};
  background: ${({ $active }) => ($active ? '#ebf3fd' : 'transparent')};
  color: ${({ $active }) => ($active ? '#2b6cb0' : '#718096')};
  font-size: var(--font-size-xs); font-weight: 600; cursor: pointer;
  &:hover { border-color: #3182ce; color: #2b6cb0; background: #ebf3fd; }
`

const ExternalImgWarning= styled.div`
  font-size: var(--font-size-xs); color: #975a16;
  display: flex; align-items: center; gap: 8px; flex: 1;
`

const HtmlIframe = styled.iframe`
  width: 100%;
  min-height: 280px;
  border: none;
  display: block;
  border-bottom: 1px solid #eaeff5;
`

const PlainBody = styled.div`
  padding: 18px 24px 22px;
  font-size: 14px;
  line-height: 1.75;
  color: #2d3748;
  white-space: pre-wrap;
  word-break: break-word;
  border-bottom: 1px solid #eaeff5;
`

/* ---- Incoming attachment section ---- */

const AttachmentSection = styled.div`
  padding: 12px 24px 14px;
  border-bottom: 1px solid #eaeff5;
  background: #fafcff;
`

const AttachmentTitle = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 700;
  color: #718096;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 8px;
`

const AttachmentList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const AttachmentCard = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border: 1px solid #dde4ec;
  border-radius: 8px;
  background: #fff;
  flex-wrap: wrap;
  justify-content: space-between;
`

const AttachmentBtnRow = styled.div`
  display: flex;
  flex-shrink: 0;
  gap: 6px;
  flex-wrap: wrap;
`

const AttachmentIcon = styled.span`
  font-size: 20px;
  flex-shrink: 0;
`

const AttachmentInfo = styled.div`
  flex: 1;
  min-width: 0;
`

const AttachmentFilename = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: #2d3748;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

const AttachmentMeta = styled.div`
  font-size: var(--font-size-xs);
  color: #a0aec0;
  margin-top: 2px;
`

const DownloadBtn = styled.button`
  flex-shrink: 0;
  padding: 4px 10px;
  border: 1.5px solid #b7d6f5;
  border-radius: 6px;
  background: #ebf3fd;
  color: #2b6cb0;
  font-size: var(--font-size-xs);
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  &:hover:not(:disabled) { background: #bee3f8; border-color: #90cdf4; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`

/* ================================================================== */
/*  Mail detail styled components                                      */
/* ================================================================== */

const WorkTagBadge = styled.span<{ $variant?: 'spam' | 'internal' | 'important' | 'low_priority' | 'edit' | 'attach' | 'reply' | 'trash' | 'calendar' | 'calendar_warning' | 'default' }>`
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 8px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  white-space: nowrap;
  ${({ $variant }) => {
    if ($variant === 'spam') return 'background:#fff5f5;color:#c53030;border:1px solid #fc8181;'
    if ($variant === 'trash') return 'background:#fff5f5;color:#c53030;border:1px solid #fc8181;'
    if ($variant === 'internal') return 'background:#f0fff4;color:#276749;border:1px solid #9ae6b4;'
    if ($variant === 'important') return 'background:#ebf4ff;color:#2b6cb0;border:1px solid #90cdf4;'
    if ($variant === 'low_priority') return 'background:#f7fafc;color:#718096;border:1px solid #e2e8f0;'
    if ($variant === 'edit') return 'background:#fffbeb;color:#b7791f;border:1px solid #fcd34d;'
    if ($variant === 'attach') return 'background:#f0fff4;color:#276749;border:1px solid #9ae6b4;'
    if ($variant === 'reply') return 'background:#ebf8ff;color:#2b6cb0;border:1px solid #bee3f8;'
    if ($variant === 'calendar') return 'background:#eef2ff;color:#4338ca;border:1px solid #c7d2fe;'
    if ($variant === 'calendar_warning') return 'background:#fffbeb;color:#b7791f;border:1px solid #fcd34d;'
    return 'background:#f7fafc;color:#a0aec0;border:1px solid #e2e8f0;'
  }}
`

const AnalysisBanner = styled.div`
  padding: 8px 12px;
  background: #ebf8ff;
  border-bottom: 1px solid #bee3f8;
  font-size: 13px;
  color: #2b6cb0;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
`

const AnalysisSpinner = styled.span`
  display: inline-block;
  animation: ${pulse} 1.2s ease-in-out infinite;
`

const SummaryPanel = styled.div<{ $collapsed: boolean }>`
  margin: ${({ $collapsed }) => ($collapsed ? '10px 16px' : '0')};
  border: 1px solid #bee3f8;
  border-radius: ${({ $collapsed }) => ($collapsed ? '12px' : '0')};
  background: #f7fbff;
  overflow: hidden;
  flex-shrink: 0;
  ${({ $collapsed }) => !$collapsed && css`
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  `}
`

const SummaryPanelHeader = styled.button`
  width: 100%;
  border: none;
  background: #ebf8ff;
  color: #1a365d;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: var(--font-size-sm);
  font-weight: 800;
  cursor: pointer;
`

const SummaryPanelBody = styled.div`
  padding: 12px 14px 14px;
  display: grid;
  gap: 12px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
`

const SummaryStatGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(92px, 1fr));
  gap: 8px;
`

const SummaryStatCard = styled.div`
  padding: 8px 10px;
  border-radius: 9px;
  background: #fff;
  border: 1px solid #e2e8f0;
`

const SummaryStatValue = styled.div`
  font-size: 18px;
  font-weight: 800;
  color: #2b6cb0;
`

const SummaryStatLabel = styled.div`
  font-size: var(--font-size-xs);
  color: #718096;
  margin-top: 2px;
`

const SummarySection = styled.div`
  display: grid;
  gap: 6px;
`

const SummarySectionTitle = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 800;
  color: #2d3748;
`

const SummaryText = styled.div`
  padding: 9px 10px;
  border-radius: 8px;
  background: #fff;
  border: 1px solid #e2e8f0;
  color: #2d3748;
  font-size: var(--font-size-xs);
  line-height: 1.65;
  white-space: pre-wrap;
`

const SummaryList = styled.div`
  display: grid;
  gap: 6px;
`

const SummaryListItem = styled.button<{ $clickable?: boolean }>`
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  padding: 8px 10px;
  text-align: left;
  color: #2d3748;
  font-size: var(--font-size-xs);
  line-height: 1.5;
  cursor: ${({ $clickable }) => ($clickable ? 'pointer' : 'default')};
  &:hover {
    border-color: ${({ $clickable }) => ($clickable ? '#90cdf4' : '#e2e8f0')};
    background: ${({ $clickable }) => ($clickable ? '#f0f7ff' : '#fff')};
  }
`

const TopicGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
`

const TopicCard = styled.button<{ $important?: boolean }>`
  border: 1px solid ${({ $important }) => ($important ? '#fbd38d' : '#e2e8f0')};
  border-radius: 9px;
  background: ${({ $important }) => ($important ? '#fffbeb' : '#fff')};
  padding: 9px 10px;
  text-align: left;
  cursor: pointer;
  color: #2d3748;
  font-size: var(--font-size-xs);
  line-height: 1.5;
  &:hover { border-color: #90cdf4; background: #f0f7ff; }
`

const TopicTitle = styled.div`
  font-weight: 800;
  color: #2d3748;
  margin-bottom: 3px;
`

const RecoverableMailBanner = styled.div`
  margin: 10px 16px;
  padding: 10px 14px;
  border-radius: 10px;
  background: #fff5f5;
  border: 1px solid #fc8181;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #c53030;
  font-weight: 600;
`

const WorkAiPanel = styled.div`
  margin: 10px 16px;
  padding: 12px 14px;
  border-radius: 10px;
  background: #f7faff;
  border: 1px solid #bee3f8;
`

const WorkAiPanelTitle = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 700;
  color: #2d3748;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
`

const WorkDraftBox = styled.div`
  margin: 6px 16px 10px;
  padding: 10px 14px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.7;
  color: #2d3748;
  white-space: pre-wrap;
  max-height: 200px;
  overflow-y: auto;
`

const WorkDraftTitle = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 700;
  color: #4a5568;
  margin: 10px 16px 4px;
  display: flex;
  align-items: center;
  gap: 6px;
`

const AttachOpenBanner = styled.div`
  margin: 6px 16px 8px;
  padding: 8px 12px;
  background: #f0fff4;
  border: 1px solid #9ae6b4;
  border-radius: 7px;
  font-size: 13px;
  color: #276749;
  display: flex;
  align-items: center;
  gap: 6px;
`

/* ---- Chat bubbles ---- */

const ChatStream = styled.div`
  padding: 16px 24px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const BubbleRow = styled.div<{ $incoming: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: ${({ $incoming }) => ($incoming ? 'flex-start' : 'flex-end')};
`

const BubbleMeta = styled.div`
  font-size: var(--font-size-xs);
  color: #a0aec0;
  margin-bottom: 3px;
  padding: 0 4px;
`

const Bubble = styled.div<{ $incoming: boolean }>`
  max-width: 72%;
  padding: 10px 14px;
  border-radius: ${({ $incoming }) => ($incoming ? '4px 14px 14px 14px' : '14px 4px 14px 14px')};
  font-size: var(--font-size-base);
  line-height: 1.65;
  background: ${({ $incoming }) => ($incoming ? '#f0f4f8' : '#3182ce')};
  color: ${({ $incoming }) => ($incoming ? '#2d3748' : '#fff')};
  white-space: pre-wrap;
  word-break: break-word;
`

const BubbleAttachment = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  padding: 6px 10px;
  background: rgba(255,255,255,0.2);
  border-radius: 6px;
  font-size: var(--font-size-xs);
`

/** Rendered image inside a chat bubble */
const ChatImage = styled.img`
  max-width: 280px;
  max-height: 280px;
  border-radius: 8px;
  display: block;
  cursor: pointer;
  object-fit: contain;
`

const MediaLoading = styled.span`
  font-size: var(--font-size-xs);
  opacity: 0.65;
  font-style: italic;
`

const MediaError = styled.span`
  font-size: var(--font-size-xs);
  color: #e53e3e;
`

/** File card for m.file messages */
const FileCard = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  background: rgba(255,255,255,0.2);
  border-radius: 8px;
  min-width: 180px;
  max-width: 300px;
`

const FileCardInfo = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
`

const FileCardName = styled.span`
  font-size: var(--font-size-sm);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
`

const FileCardSize = styled.span`
  font-size: var(--font-size-xs);
  opacity: 0.7;
  flex-shrink: 0;
`

/* ================================================================== */
/*  Composer (bottom of DetailPane)                                   */
/* ================================================================== */

const ComposerShell = styled.div`
  border-top: 2px solid #eaeff5;
  background: #ffffff;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
`

const ComposerBody = styled.div`
  padding: 10px 16px 6px;
`

const ComposerTextarea = styled.textarea`
  width: 100%;
  min-height: 160px;
  max-height: 360px;
  padding: 12px 14px;
  border: 1px solid #d1dce8;
  border-radius: 8px;
  font-size: var(--font-size-base);
  line-height: 1.75;
  color: #2d3748;
  resize: vertical;
  outline: none;
  font-family: inherit;
  background: #fafcfe;
  box-sizing: border-box;
  transition: border-color 0.15s;
  &:focus { border-color: #4299e1; box-shadow: 0 0 0 2px rgba(66,153,225,0.12); }
  &::placeholder { color: #a0aec0; }
  &:disabled { background: #f7fafc; color: #a0aec0; cursor: not-allowed; }
`

const StreamingPreview = styled.div`
  min-height: 160px;
  padding: 12px 14px;
  border: 1px dashed #b3d1f0;
  border-radius: 8px;
  font-size: var(--font-size-base);
  line-height: 1.75;
  color: #4a5568;
  background: #f0f7ff;
  white-space: pre-wrap;
  word-break: break-word;
  animation: ${pulse} 1.5s ease-in-out infinite;
`

const ComposerError = styled.div`
  margin-bottom: 6px;
  padding: 7px 10px;
  background: #fff5f5;
  border: 1px solid #fc8181;
  border-radius: 7px;
  font-size: var(--font-size-xs);
  color: #c53030;
`

const GenerationStatusBar = styled.div<{ $variant: 'info' | 'success' | 'error' }>`
  margin-bottom: 6px;
  padding: 6px 10px;
  border-radius: 7px;
  font-size: var(--font-size-xs);
  display: flex;
  align-items: center;
  gap: 6px;
  ${({ $variant }) => $variant === 'info' && css`
    background: #ebf8ff; border: 1px solid #90cdf4; color: #2b6cb0;
  `}
  ${({ $variant }) => $variant === 'success' && css`
    background: #f0fff4; border: 1px solid #9ae6b4; color: #276749;
  `}
  ${({ $variant }) => $variant === 'error' && css`
    background: #fff5f5; border: 1px solid #fc8181; color: #c53030;
  `}
`

const AttachChips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 16px 0;
`

const ComposerActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px 10px;
  flex-wrap: wrap;
`

const OutgoingTag = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: #edf2ff;
  border: 1px solid #c3d7fa;
  border-radius: 20px;
  font-size: var(--font-size-xs);
  color: #2d3748;
  max-width: 210px;
`

const OutgoingTagName = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const OutgoingRemoveBtn = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  color: #718096;
  font-size: 14px;
  flex-shrink: 0;
  &:hover { color: #e53e3e; }
`

const AddAttachBtn = styled.button`
  height: 30px;
  padding: 0 12px;
  border: 1.5px dashed #b3d1f0;
  border-radius: 20px;
  background: transparent;
  font-size: var(--font-size-xs);
  color: #4a90d9;
  cursor: pointer;
  white-space: nowrap;
  &:hover { background: #edf2ff; border-color: #4a90d9; }
`


const Btn = styled.button<{ $variant?: 'primary' | 'send' | 'muted' | 'danger' }>`
  height: 36px;
  padding: 0 16px;
  border: none;
  border-radius: 8px;
  font-size: var(--font-size-sm);
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;

  ${({ $variant }) => {
    if ($variant === 'send') return css`
      background: linear-gradient(135deg, #38a169, #2f855a);
      color: #fff;
      &:hover:not(:disabled) { background: linear-gradient(135deg, #2f855a, #276749); }
    `
    if ($variant === 'danger') return css`
      background: #fed7d7; color: #c53030;
      &:hover:not(:disabled) { background: #feb2b2; }
    `
    if ($variant === 'muted') return css`
      background: #edf2f7; color: #4a5568;
      &:hover:not(:disabled) { background: #e2e8f0; }
    `
    return css`
      background: linear-gradient(135deg, #4299e1, #3182ce);
      color: #fff;
      &:hover:not(:disabled) { background: linear-gradient(135deg, #3182ce, #2b6cb0); }
    `
  }}

  &:disabled { opacity: 0.5; cursor: not-allowed; }
`

const KnowledgeBtn = styled(Btn)<{ $active?: boolean }>`
  ${({ $active }) => $active && css`
    background: #eef4ff;
    color: #1a56db;
    border: 1.5px solid #3b7ded;
    &:hover:not(:disabled) { background: #e4edff; }
  `}
`

const KnowledgeSearchInput = styled.input`
  width: 100%;
  box-sizing: border-box;
  border: 1.5px solid #d1dce8;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: var(--font-size-sm);
  color: #2d3748;
  outline: none;
  margin-bottom: 10px;
  &:focus { border-color: #4299e1; box-shadow: 0 0 0 2px rgba(66,153,225,0.12); }
`

const KnowledgeList = styled.div`
  max-height: 320px;
  overflow-y: auto;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #fafcff;
`

const KnowledgeOption = styled.label<{ $selected?: boolean; $depth: number }>`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  padding-left: ${({ $depth }) => 12 + $depth * 16}px;
  border-bottom: 1px solid #edf2f7;
  background: ${({ $selected }) => ($selected ? '#eef4ff' : '#fff')};
  cursor: pointer;
  &:hover { background: ${({ $selected }) => ($selected ? '#e4edff' : '#f7fafc')}; }
  &:last-child { border-bottom: none; }
`

const KnowledgeOptionName = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #2d3748;
  font-size: var(--font-size-sm);
  font-weight: 600;
`

const KnowledgeEmpty = styled.div`
  padding: 24px 12px;
  text-align: center;
  color: #a0aec0;
  font-size: var(--font-size-sm);
`

/* ================================================================== */
/*  Account settings modal*/
/* ================================================================== */

const ModalOverlay = styled.div`
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(0,0,0,0.45);
  display: flex; align-items: center; justify-content: center;
`

const ModalCard = styled.div`
  background: #fff; border-radius: 12px; padding: 28px 32px;
  width: 520px; max-width: 95vw; max-height: 90vh; overflow-y: auto;
  box-shadow: 0 8px 40px rgba(0,0,0,0.18);
`

const KnowledgeModalCard = styled(ModalCard)`
  width: 560px;
  padding: 22px 24px;
`

const ModalTitle = styled.div`
  font-size: 17px; font-weight: 700; color: #1a202c; margin-bottom: 18px;
  display: flex; align-items: center; gap: 8px;
`

const PresetRow = styled.div`
  display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 18px;
`

const PresetButton = styled.button<{ $active?: boolean }>`
  padding: 5px 14px; border-radius: 20px;
  border: 1.5px solid ${({ $active }) => ($active ? '#3182ce' : '#cbd5e0')};
  background: ${({ $active }) => ($active ? '#ebf3fd' : '#f7fafc')};
  color: ${({ $active }) => ($active ? '#2b6cb0' : '#4a5568')};
  font-size: var(--font-size-sm); cursor: pointer;
  &:hover { border-color: #3182ce; background: #ebf3fd; color: #2b6cb0; }
`

const CustomPresetButtonWrap = styled.span`
  display: inline-flex; align-items: center; gap: 0;
`

const CustomPresetDeleteBtn = styled.button`
  padding: 2px 6px; border: none; background: transparent; color: #a0aec0;
  cursor: pointer; font-size: 12px; line-height: 1;
  &:hover { color: #e53e3e; }
`

const SavePresetRow = styled.div`
  display: flex; gap: 8px; align-items: center; margin-bottom: 14px; flex-wrap: wrap;
`

const SavePresetInput = styled.input`
  padding: 4px 10px; border: 1.5px solid #cbd5e0; border-radius: 6px;
  font-size: var(--font-size-sm); width: 160px;
  &:focus { outline: none; border-color: #3182ce; }
`

const ProbeStatus = styled.div`
  font-size: var(--font-size-xs); color: #718096; margin-bottom: 8px;
`

const FormGrid = styled.div`
  display: grid; grid-template-columns: 110px 1fr; gap: 10px 12px; align-items: center;
  margin-bottom: 14px;
`

const FormLabel = styled.label`font-size: var(--font-size-sm); color: #4a5568; text-align: right; padding-right: 4px;`

const FormInput = styled.input`
  padding: 6px 10px; border: 1.5px solid #cbd5e0; border-radius: 6px;
  font-size: var(--font-size-sm); width: 100%; box-sizing: border-box;
  &:focus { outline: none; border-color: #3182ce; box-shadow: 0 0 0 3px rgba(49,130,206,0.15); }
`

const ModalActions= styled.div`
  display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px;
`

const StatusLine = styled.div<{ $tone?: 'ok' | 'err' | 'loading' }>`
  font-size: var(--font-size-sm); margin-bottom: 10px;
  color: ${({ $tone }) => $tone === 'ok' ? '#38a169' : $tone === 'err' ? '#e53e3e' : '#718096'};
  white-space: pre-wrap;
`

const OutlookHint = styled.div`
  background: #ebf8ff; border: 1px solid #90cdf4; border-radius: 6px;
  padding: 10px 12px; font-size: var(--font-size-xs); color: #2b6cb0; margin-bottom: 12px; line-height: 1.65;
`

const InternalHint = styled.div`
  background: #f0fff4; border: 1px solid #9ae6b4; border-radius: 6px;
  padding: 8px 12px; font-size: var(--font-size-xs); color: #276749; margin-bottom: 12px;
`

const FormSelect = styled.select`
  padding: 6px 10px; border: 1.5px solid #cbd5e0; border-radius: 6px;
  font-size: var(--font-size-sm); width: 100%; box-sizing: border-box; background: #fff; color: #2d3748;
  &:focus { outline: none; border-color: #3182ce; box-shadow: 0 0 0 3px rgba(49,130,206,0.15); }
`

const FormSectionLabel = styled.div`
  grid-column: 1 / -1;
  font-size: var(--font-size-xs); font-weight: 700; color: #718096; text-transform: uppercase;
  letter-spacing: 0.05em; padding: 6px 0 2px; border-bottom: 1px solid #eaeff5; margin-top: 2px;
`

const CheckboxRow = styled.div`
  display: flex; align-items: center; gap: 8px; font-size: var(--font-size-sm); color: #4a5568;
  input[type="checkbox"] { width: 15px; height: 15px; cursor: pointer; }
`

const SelfSignedNote = styled.span`
  font-size: var(--font-size-xs); font-weight: 600; color: #e67e22; margin-left: 4px;
`

/* ================================================================== */
/*  Utility helpers                                                   */
/* ================================================================== */

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    })
  } catch { return '' }
}

function formatForwardSubject(subject: string): string {
  const trimmed = subject.trim() || '（无主题）'
  return /^(fwd?|转发)\s*[:：]/i.test(trimmed) ? trimmed : `Fwd: ${trimmed}`
}

function stripHtmlForForward(html: string): string {
  if (typeof DOMParser === 'undefined') return html.replace(/<[^>]+>/g, ' ')
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return doc.body.textContent || ''
}

function buildForwardBody(thread: CommunicationThread, message: CommunicationMessage): string {
  const originalBody = (message.body || (message.htmlBody ? stripHtmlForForward(message.htmlBody) : '')).trim()
  return [
    '',
    '',
    '---------- 转发邮件 ----------',
    `发件人：${message.fromName || message.from || '未知发件人'}${message.from ? ` <${message.from}>` : ''}`,
    `收件人：${message.toName || message.to || ''}${message.to ? ` <${message.to}>` : ''}`,
    `时间：${formatTime(message.timestamp) || message.timestamp}`,
    `主题：${thread.subject || '（无主题）'}`,
    '',
    originalBody || '（原邮件无正文）',
  ].join('\n')
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1_048_576).toFixed(1)} MB`
}

function attachmentIcon(contentType: string): string {
  if (/pdf/i.test(contentType)) return '📄'
  if (/image/i.test(contentType)) return '🖼️'
  if (/word|docx/i.test(contentType)) return '📝'
  if (/excel|xlsx|spreadsheet/i.test(contentType)) return '📊'
  if (/zip|rar|7z|tar|gz/i.test(contentType)) return '📦'
  if (/text/i.test(contentType)) return '📃'
  return '📎'
}

function triageCategoryLabel(category?: string): string {
  const labels: Record<string, string> = {
    spam: '垃圾邮件',
    promotion: '推广邮件',
    system_notice: '系统通知',
    internal_notice: '内部通知',
    student_request: '学生咨询',
    colleague_collaboration: '同事协作',
    task_assignment: '任务分配',
    approval_request: '审批确认',
    meeting_invitation: '会议邀请',
    document_review: '文档审阅',
    data_report_request: '数据报表',
    project_update: '项目进展',
    urgent_issue: '紧急事项',
    ordinary: '普通邮件',
    action_required: '任务',
    reply_required: '询问',
    read_only: '仅阅读',
    archive_candidate: '可归档',
    risk: '风险邮件',
    unknown: '未知',
  }
  return labels[category || ''] || '未分析'
}

function intentTypeLabel(intentType?: string): string {
  const labels: Record<string, string> = {
    task: '任务',
    request: '需求',
    question: '询问',
    notice: '通知',
    attachment_review: '附件处理',
    meeting: '会议',
    approval: '审批',
    spam: '垃圾',
    ordinary: '普通',
  }
  return labels[intentType || ''] || '普通'
}

function emailActionTypeLabel(actionType: EmailActionType): string {
  const labels: Record<EmailActionType, string> = {
    need_reply: '需要回复',
    need_review: '需要审阅',
    need_schedule: '需要安排',
    need_forward: '需要转发',
    notification: '通知',
    spam_or_noise: '低价值/风险',
    no_action: '无需处理',
  }
  return labels[actionType] || actionType
}

function calendarEventTypeFromTimeIntent(type: NonNullable<AiMailTriageResult['timeIntent']>['type']): CalendarEventType {
  if (type === 'interview') return 'interview'
  if (type === 'deadline') return 'deadline'
  if (type === 'reminder') return 'reminder'
  return 'meeting'
}

function calendarTagForTriage(triage?: AiMailTriageResult): { label: string; variant: 'calendar' | 'calendar_warning' } | null {
  const intent = triage?.timeIntent
  if (!intent?.hasTimeRequirement) return null
  if ((triage?.calendarConflictCount ?? 0) > 0) return { label: '时间冲突', variant: 'calendar_warning' }
  const hasConcreteTime = Boolean(intent.startTime || intent.deadlineTime || intent.candidateTimes?.length)
  if ((triage?.calendarEventId || intent.startTime || intent.deadlineTime) && intent.needsUserConfirmation) return { label: '待确认日程', variant: 'calendar' }
  if (intent.type === 'deadline' && intent.deadlineTime) return { label: '截止事项', variant: 'calendar_warning' }
  if (intent.type === 'candidate_times' && intent.candidateTimes?.length) return { label: '候选时间', variant: 'calendar' }
  if (!hasConcreteTime) return { label: '需确认时间', variant: 'calendar_warning' }
  return { label: '日程', variant: 'calendar' }
}

function timeIntentTitle(triage: AiMailTriageResult): string {
  return triage.timeIntent?.title || triage.summary || '日程安排'
}

function formatCalendarTime(value: string | undefined): string {
  if (!value) return '时间待确认'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '时间待确认'
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function truncateForQuery(value: string | undefined, maxLength: number): string {
  const normalized = String(value || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim()
  if (normalized.length <= maxLength) return normalized
  return normalized.slice(0, maxLength).trim()
}

function buildReplyKnowledgeQuery(mail: MailItem, triage?: AiMailTriageResult): string {
  return [
    mail.subject,
    mail.fromName,
    mail.from,
    truncateForQuery(mail.body, 1800),
    triage?.summary,
    triage?.category,
    triage?.emailCategory,
    triage?.actionPlan?.intentType,
    triage?.suggestedAction,
    triage?.reason,
    triage?.timeIntent?.title,
    triage?.timeIntent?.sourceText,
  ].filter(Boolean).join('\n')
}

function flattenDepartments(departments: Department[]): Array<{ department: Department; depth: number }> {
  const byId = new Map(departments.map((department) => [department.id, department]))
  return departments.map((department) => {
    let depth = 0
    let parentId = department.parentId
    const seen = new Set<string>()
    while (parentId && byId.has(parentId) && !seen.has(parentId)) {
      seen.add(parentId)
      depth += 1
      parentId = byId.get(parentId)?.parentId
    }
    return { department, depth }
  })
}

async function retrieveEmailReplyKnowledgeSnippets(
  knowledgeIds: string[],
  departments: Department[],
  query: string,
): Promise<EmailReplyKnowledgeSnippet[]> {
  const trimmedQuery = query.trim()
  if (!trimmedQuery || knowledgeIds.length === 0) return []
  if (!window.electronAPI?.retrieveKnowledgeChunks) {
    console.warn('[CommunicationWorkbench] knowledge retrieval API unavailable')
    return []
  }

  const departmentNameById = new Map(departments.map((department) => [department.id, department.name]))
  const perKnowledgeLimit = Math.max(2, Math.ceil(8 / Math.max(1, knowledgeIds.length)))
  const snippets: EmailReplyKnowledgeSnippet[] = []

  for (const knowledgeId of knowledgeIds) {
    try {
      const result = await window.electronAPI.retrieveKnowledgeChunks(knowledgeId, {
        query: trimmedQuery,
        mode: 'auto',
        maxChunks: perKnowledgeLimit,
      })
      const citationByChunkId = new Map(result.citations.map((citation) => [citation.chunkId, citation]))
      for (const hit of result.hits) {
        const matchedBy = new Set(hit.matchedBy)
        const highlyRelevant = hit.score > 1 || matchedBy.has('title') || matchedBy.has('summary') || matchedBy.has('keyword')
        if (!highlyRelevant) continue
        const citation = citationByChunkId.get(hit.chunk.id)
        snippets.push({
          knowledgeId,
          knowledgeName: departmentNameById.get(knowledgeId),
          sourceId: hit.chunk.documentId,
          sourceTitle: citation?.documentTitle || hit.chunk.titlePath[0],
          text: hit.chunk.text,
          score: hit.score,
        })
      }
    } catch (err) {
      console.warn('[CommunicationWorkbench] knowledge retrieval failed:', err)
    }
  }

  return Array.from(new Map(snippets.map((snippet) => [`${snippet.knowledgeId}:${snippet.sourceId}:${snippet.text.slice(0, 80)}`, snippet])).values())
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
    .slice(0, 8)
}

function buildConflictTarget(
  triage: AiMailTriageResult,
  candidateTime?: NonNullable<NonNullable<AiMailTriageResult['timeIntent']>['candidateTimes']>[number],
): Pick<import('../calendar/types').CalendarEvent, 'id' | 'startTime' | 'endTime' | 'allDay' | 'eventType'> | null {
  const intent = triage.timeIntent
  if (!intent?.hasTimeRequirement) return null
  const startTime = candidateTime?.startTime || (intent.type === 'deadline' ? intent.deadlineTime : intent.startTime)
  if (!startTime) return null
  return {
    id: triage.calendarEventId || '',
    startTime,
    endTime: candidateTime?.endTime || intent.endTime,
    eventType: calendarEventTypeFromTimeIntent(intent.type),
  }
}

function buildMailItemFromMessage(thread: CommunicationThread, message: CommunicationMessage): MailItem {
  return {
    id: fromEmailThreadId(thread.id),
    from: message.from,
    fromName: message.fromName || '',
    to: message.to || '',
    toName: message.toName || '',
    subject: thread.subject,
    body: message.body,
    htmlBody: message.htmlBody,
    timestamp: message.timestamp,
    unread: thread.unread,
    replied: thread.replied,
    threadId: thread.id,
    attachments: [],
    folder: thread.folder === 'sent' ? 'sent' : thread.folder === 'trash' ? 'trash' : 'inbox',
  }
}

function buildCalendarAwareReply(
  triage: AiMailTriageResult,
  conflicts: CalendarConflict[],
  recommendedTime?: string,
): string {
  const title = timeIntentTitle(triage)
  const intent = triage.timeIntent
  const timeText = recommendedTime || intent?.startTime || intent?.deadlineTime
  if (intent?.type === 'candidate_times' && recommendedTime) {
    const formatted = formatCalendarTime(recommendedTime)
    return `English:\n\nThank you for sharing the available time options. The time that works best for me is ${formatted}. Please let me know if this works for you.\n\nBest regards\n\n中文：\n\n您好：\n\n感谢您提供候选时间。我更方便的时间是 ${formatted}，请您确认是否合适。\n\n祝好！`
  }
  if (conflicts.length > 0) {
    return `English:\n\nThank you for the arrangement regarding "${title}". I am sorry, but I already have a commitment during that time. Would it be possible to adjust to another suitable time?\n\nBest regards\n\n中文：\n\n您好：\n\n感谢您关于“${title}”的安排。抱歉，我该时间段已有安排，是否可以调整到其他合适时间？\n\n祝好！`
  }
  return `English:\n\nThank you for the arrangement regarding "${title}". I am available at ${formatCalendarTime(timeText)} and can attend as scheduled.\n\nBest regards\n\n中文：\n\n您好：\n\n感谢您关于“${title}”的安排。可以，我这个时间有空参加。\n\n祝好！`
}

function attachmentActionLabel(action: NonNullable<AiEmailActionPlan['attachmentActions']>[number]['action']): string {
  const labels: Record<string, string> = {
    read: '阅读',
    edit: '编辑',
    review: '审阅',
    sign: '签署',
    return: '回传',
    archive: '归档',
  }
  return labels[action] || action
}

function targetWorkspaceLabel(target?: NonNullable<AiEmailActionPlan['attachmentActions']>[number]['targetWorkspace']): string {
  const labels: Record<string, string> = {
    document: '文稿工作台',
    ppt: 'PPT 工作台',
    excel: '数据工作台',
    preview: '预览',
    none: '无需打开工作台',
  }
  return labels[target || 'none'] || '无需打开工作台'
}

const NAV_TABS: Array<{ key: CommFilter; label: string }> = [
  { key: 'email', label: '收件箱' },
  { key: 'sent',  label: '已发送' },
  { key: 'trash', label: '回收站' },
]

const SUB_FILTERS: Array<{ key: CommFilter; label: string }> = [
  { key: 'all',            label: '全部' },
  { key: 'unread',         label: '未读' },
  { key: 'has-attachment', label: '有附件' },
]

/* ================================================================== */
/*  Mail sort mode                                                    */
/* ================================================================== */

type MailSortMode = 'smart' | 'time'

const MAIL_SORT_KEY = 'ai:mail-sort-mode'

function loadSortMode(): MailSortMode {
  try {
    const saved = localStorage.getItem(MAIL_SORT_KEY)
    if (saved === 'smart') return 'smart'
    if (saved === 'time') return 'time'
  } catch { /* ignore */ }
  return 'time'
}

function saveSortMode(mode: MailSortMode) {
  try { localStorage.setItem(MAIL_SORT_KEY, mode) } catch { /* ignore */ }
}

/**
 * Safely extracts a unix-ms timestamp from a thread for time-based sorting.
 * Falls back to 0 (sorted to end) when no date is available.
 */
function getThreadTime(thread: CommunicationThread): number {
  const raw = thread.lastMessage?.timestamp ?? ''
  if (!raw) return 0
  const t = typeof raw === 'number' ? raw : new Date(raw).getTime()
  return Number.isFinite(t) ? t : 0
}

/**
 * Returns a numeric importance score for smart-sorting.
 * Higher score = more important → appears first.
 */
function getMailImportanceScore(
  thread: CommunicationThread,
  triage: AiMailTriageResult | undefined,
  hasDraft: boolean,
): number {
  // Non-email threads go to the bottom
  if (thread.providerType !== 'email') return -1

  let score = 0

  if (triage?.status === 'skipped') {
    // attachment-only mails — show below unclassified
    score = 25
  } else if (!triage || triage.status !== 'success') {
    // Unclassified
    score = 50
  } else {
    const { category, priority, riskLevel, deadline, detectedIntent } = triage

    // Base category + priority score
    if (category === 'risk' || riskLevel === 'high') {
      score = 1000
    } else if (riskLevel === 'medium') {
      score = 950
    } else if (category === 'reply_required' && priority === 'high') {
      score = 900
    } else if (category === 'action_required' && priority === 'high') {
      score = 850
    } else if (category === 'reply_required' && priority === 'medium') {
      score = 750
    } else if (category === 'action_required' && priority === 'medium') {
      score = 700
    } else if (category === 'reply_required' && priority === 'low') {
      score = 600
    } else if (category === 'action_required' && priority === 'low') {
      score = 550
    } else if (category === 'read_only') {
      score = 300
    } else if (category === 'archive_candidate') {
      score = 150
    } else if (category === 'promotion') {
      score = 100
    } else {
      // unknown
      score = 80
    }

    // Bonus: deadline or strong-action intent
    if (deadline) score += 80
    else if (detectedIntent && /deadline|meeting|approval|confirmation|urgent/i.test(detectedIntent)) {
      score += 40
    }
  }

  // Bonus: unread
  if (thread.unread) score += 20
  // Bonus: local AI draft ready
  if (hasDraft) score += 30
  // Bonus: has actionable attachment + category
  if (thread.hasAttachments && triage?.status === 'success' &&
      (triage.category === 'action_required' || triage.category === 'reply_required')) {
    score += 20
  }

  return score
}

/* ================================================================== */
/*  IncomingAttachments sub-component                                 */
/* ================================================================== */

function IncomingAttachments({
  attachments,
  messageId,
  subject,
  fromName,
  fromEmail,
  activeWorkspacePath,
  onSavedToWorkspace,
}: {
  attachments: CommunicationAttachment[]
  messageId?: string
  subject?: string
  fromName?: string
  fromEmail?: string
  activeWorkspacePath?: string | null
  onSavedToWorkspace?: (result: MailAttachmentOpenResult) => void
}) {
  const [downloading, setDownloading] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const { setGenerationMode } = useWorkspaceMode()
  const workbench = useGenerationWorkbench()

  const handleDownload = useCallback(async (att: CommunicationAttachment) => {
    if (!att.tempPath) { alert('暂无可下载的缓存文件'); return }
    const key = att.id
    setDownloading((prev) => ({ ...prev, [key]: true }))
    try {
      const result = await window.electronAPI?.emailDownloadAttachment?.({ tempPath: att.tempPath, filename: att.filename })
      if (result?.ok === false) {
        alert(`下载失败：${result.error.message}`)
      }
    } catch (err) {
      alert(`下载失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setDownloading((prev) => ({ ...prev, [key]: false }))
    }
  }, [])

  const handleSaveToWorkspace = useCallback(async (att: CommunicationAttachment, openAfterSave: boolean) => {
    if (!activeWorkspacePath) { alert('请先打开一个工作区'); return }
    if (!messageId) { alert('缺少邮件信息，无法保存附件'); return }
    const key = att.id
    setSaving((prev) => ({ ...prev, [key]: true }))
    try {
      const result = await window.electronAPI?.mailOpenAttachmentInWorkspace?.({
        messageId,
        attachmentId: att.id,
        fileName: att.filename,
        mimeType: att.contentType,
        source: 'imap',
        subject,
        fromName,
        fromEmail,
        workspacePath: activeWorkspacePath,
      })
      if (!result) {
        alert('当前环境未提供邮件附件保存能力')
        return
      }
      if (result.ok === false) {
        alert(`保存失败：${result.error.message}`)
        return
      }
      onSavedToWorkspace?.(result)
      if (openAfterSave) {
        if (result.openTarget === 'document' || result.openTarget === 'preview') {
          window.dispatchEvent(new CustomEvent('ai-office-open-document-request', {
            detail: {
              filePath: result.filePath,
              sourceContext: result.sourceContext,
            },
          }))
          setGenerationMode('document')
        } else if (result.openTarget === 'presentation') {
          const now = new Date().toISOString()
          const originalName = result.sourceContext.originalAttachmentName || result.fileName
          workbench.setModeSession('ppt', (session) => ({
            ...session,
            generationStatus: { phase: 'running', message: `正在导入邮件附件 ${originalName}…`, updatedAt: now },
            resultTitle: originalName,
            resultPath: null,
            resultAssetId: null,
            resultType: 'pptx',
            resultPreviewText: '',
            pptSourceType: 'email_attachment',
            pptOriginalFilePath: result.filePath,
            pptOriginalFileName: originalName,
            pptImportStatus: 'importing',
            pptTaskStatus: 'importing',
            pptLiveSlides: [],
            pptPreviewSlides: [],
            pptTotalSlides: 0,
            pptActiveSlideIndex: 0,
            pptDeckDocumentId: null,
            pptDeckPath: null,
            pptActiveSkillId: null,
            pptActiveTemplateManifestId: null,
            pptImportWarnings: [],
            lastUpdatedAt: now,
          }))
          setGenerationMode('ppt')
          if (result.fileName.toLowerCase().endsWith('.ppt')) {
            const message = '旧版 .ppt 暂不支持导入为可编辑 DeckDocument，请先另存为 .pptx 后重试。'
            workbench.setModeSession('ppt', (session) => ({
              ...session,
              generationStatus: { phase: 'error', message, updatedAt: new Date().toISOString() },
              pptImportStatus: 'failed',
              pptTaskStatus: 'failed',
              pptImportWarnings: [message],
            }))
            alert(message)
            return
          }

          workbench.setModeSession('ppt', (session) => ({
            ...session,
            generationStatus: { phase: 'running', message: '正在提取 PPTX 内容…', updatedAt: new Date().toISOString() },
            pptImportStatus: 'extracting',
            pptTaskStatus: 'extracting',
          }))
          const imported = await window.electronAPI.pptxImportFromFile({
            workspacePath: activeWorkspacePath,
            pptxPath: result.filePath,
            source: {
              type: 'email_attachment',
              messageId,
              attachmentId: att.id,
              filename: originalName,
            },
            importMode: 'rule_based',
            language: 'zh',
          })
          if (!imported.success || !imported.deckDocumentId || !imported.deckPath) {
            const message = imported.error || 'PPTX 导入失败'
            workbench.setModeSession('ppt', (session) => ({
              ...session,
              generationStatus: { phase: 'error', message, updatedAt: new Date().toISOString() },
              pptImportStatus: 'failed',
              pptTaskStatus: 'failed',
              pptImportWarnings: imported.extractionWarnings || [],
            }))
            alert(`导入 PPT 失败：${message}`)
            return
          }
          const liveSlides = deckToPptSlidePreviews(imported.deck, imported.previewSlides || [])
          workbench.setModeSession('ppt', (session) => ({
            ...session,
            generationStatus: {
              phase: 'completed',
              message: '已导入为 AI Office 可编辑内容结构，导出时会生成新的 PPTX 文件。',
              updatedAt: new Date().toISOString(),
            },
            pptImportStatus: 'ready',
            pptTaskStatus: 'completed',
            pptDeckDocumentId: imported.deckDocumentId || null,
            pptDeckPath: imported.deckPath || null,
            pptOriginalFilePath: imported.originalPptxPath || result.filePath,
            pptPreviewSlides: imported.previewSlides || [],
            pptLiveSlides: liveSlides,
            pptTotalSlides: liveSlides.length || (imported.previewSlides?.length ?? 0),
            pptActiveSlideIndex: 0,
            pptImportWarnings: imported.extractionWarnings || [],
            pptActiveTemplateManifestId: null,
            resultTitle: originalName,
            resultPreviewText: '已导入为 AI Office 可编辑内容结构，导出时会生成新的 PPTX 文件。',
            lastUpdatedAt: new Date().toISOString(),
          }))
        } else if (result.openTarget === 'spreadsheet') {
          setGenerationMode('data')
        }
      }
    } catch (err) {
      alert(`保存失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving((prev) => ({ ...prev, [key]: false }))
    }
  }, [activeWorkspacePath, fromEmail, fromName, messageId, onSavedToWorkspace, setGenerationMode, subject, workbench])

  if (attachments.length === 0) return null

  return (
    <AttachmentSection>
      <AttachmentTitle>📎 附件（{attachments.length}）</AttachmentTitle>
      <AttachmentList>
        {attachments.map((att) => (
          <AttachmentCard key={att.id}>
            <AttachmentIcon>{attachmentIcon(att.contentType)}</AttachmentIcon>
            <AttachmentInfo>
              <AttachmentFilename title={att.filename}>{att.filename}</AttachmentFilename>
              <AttachmentMeta>{formatFileSize(att.size)}</AttachmentMeta>
            </AttachmentInfo>
            <AttachmentBtnRow>
              <DownloadBtn
                onClick={() => handleDownload(att)}
                disabled={downloading[att.id] || !att.tempPath}
              >
                {downloading[att.id] ? '...' : '⬇ 下载'}
              </DownloadBtn>
              <DownloadBtn
                onClick={() => void handleSaveToWorkspace(att, false)}
                disabled={saving[att.id] || !activeWorkspacePath}
              >
                保存到工作区
              </DownloadBtn>
              <DownloadBtn
                onClick={() => void handleSaveToWorkspace(att, true)}
                disabled={saving[att.id] || !activeWorkspacePath}
              >
                打开到工作台
              </DownloadBtn>
            </AttachmentBtnRow>
          </AttachmentCard>
        ))}
      </AttachmentList>
    </AttachmentSection>
  )
}

/* ================================================================== */
/*  EmailBodyView sub-component (reuses iframe logic from original)   */
/*                                                                    */
/*  SECURITY: HTML email bodies are rendered inside an <iframe> with  */
/*  sandbox="allow-same-origin" but WITHOUT allow-scripts.            */
/*  This ensures:                                                     */
/*  - JavaScript execution is fully blocked (no <script>, no onclick) */
/*  - Inline event handlers (onerror, onload, etc.) are suppressed    */
/*  - allow-same-origin is needed only so we can read scrollHeight    */
/*    for auto-height — it does NOT grant cross-origin access         */
/*  - External images are blocked by default (data-external-src swap) */
/*  - dangerouslySetInnerHTML is intentionally NOT used               */
/* ================================================================== */

function EmailBodyView({ message }: { message: CommunicationMessage }) {
  const [mode, setMode] = useState<'html' | 'text'>(message.htmlBody ? 'html' : 'text')
  const [showExternal, setShowExternal] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [iframeHeight, setIframeHeight] = useState(320)

  useEffect(() => {
    setMode(message.htmlBody ? 'html' : 'text')
    setShowExternal(false)
    setIframeHeight(320)
  }, [message.id, message.htmlBody])

  const srcDoc = useMemo(() => {
    if (!message.htmlBody) return ''
    if (showExternal) return message.htmlBody
    return message.htmlBody.replace(/src="(https?:\/\/[^"]+)"/gi, 'src="" data-external-src="$1"')
  }, [message.htmlBody, showExternal])

  const handleIframeLoad = useCallback(() => {
    const doc = iframeRef.current?.contentDocument
    if (doc?.body) setIframeHeight(Math.max(200, doc.body.scrollHeight + 32))
  }, [])

  const hasHtml = Boolean(message.htmlBody)
  const hasExternalImages = hasHtml && /data-external-src=/.test(srcDoc)

  return (
    <>
      {hasHtml && (
        <DetailBodyToolbar>
          <BodyToggleBtn $active={mode === 'html'} onClick={() => setMode('html')}>HTML</BodyToggleBtn>
          <BodyToggleBtn $active={mode === 'text'} onClick={() => setMode('text')}>纯文本</BodyToggleBtn>
          {mode === 'html' && !showExternal && hasExternalImages && (
            <ExternalImgWarning>
              ⚠ 已屏蔽外部图片
              <BodyToggleBtn onClick={() => setShowExternal(true)}>显示外部图片</BodyToggleBtn>
            </ExternalImgWarning>
          )}
        </DetailBodyToolbar>
      )}
      {mode === 'html' && hasHtml ? (
        <HtmlIframe
          ref={iframeRef}
          srcDoc={srcDoc}
          sandbox="allow-same-origin"
          style={{ height: iframeHeight }}
          onLoad={handleIframeLoad}
          title="邮件正文"
        />
      ) : (
        <PlainBody>{message.body}</PlainBody>
      )}
    </>
  )
}

/* ================================================================== */
/*  MatrixMediaImage — authenticated blob-based image renderer        */
/* ================================================================== */

interface MatrixMediaImageProps {
  mxcUrl: string
  alt?: string
  accessToken: string | null
  onClick?: () => void
}

function MatrixMediaImage({ mxcUrl, alt, accessToken, onClick }: MatrixMediaImageProps) {
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!mxcUrl || !accessToken) {
      setError(mxcUrl ? '未登录内部通讯，无法加载图片' : '图片消息缺少媒体地址')
      return
    }
    let objectUrl: string | null = null
    let cancelled = false
    fetchMatrixMediaBlob(accessToken, mxcUrl)
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setSrc(objectUrl)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message ?? '图片加载失败')
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [mxcUrl, accessToken])

  if (error) return <MediaError>🖼 {error}</MediaError>
  if (!src) return <MediaLoading>图片加载中…</MediaLoading>
  return <ChatImage src={src} alt={alt || '图片'} onClick={onClick} />
}

/**
 * Download a Matrix media file by fetching it as a blob then triggering an <a> click.
 * Never opens a bare mxc:// URL or a token-bearing URL in a new tab.
 */
async function downloadMatrixFile(
  accessToken: string | null,
  mxcUrl: string,
  filename: string,
  setError: (msg: string) => void,
): Promise<void> {
  if (!accessToken) { setError('未登录内部通讯，无法下载文件'); return }
  try {
    const blob = await fetchMatrixMediaBlob(accessToken, mxcUrl)
    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = filename || 'attachment'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5000)
  } catch (err) {
    setError((err as Error).message ?? '下载失败')
  }
}

/* ================================================================== */
/*  ChatStreamView sub-component                                      */
/* ================================================================== */

function ChatStreamView({ thread, accessToken }: { thread: CommunicationThread; accessToken: string | null }) {
  const bottomRef = useRef<HTMLDivElement>(null)
  // Per-message download error map  (fileEventId → errorText)
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [thread.messages.length])

  const setFileError = useCallback((msgId: string, msg: string) => {
    setFileErrors((prev) => ({ ...prev, [msgId]: msg }))
  }, [])

  const renderBubbleContent = (msg: CommunicationMessage) => {
    const msgtype = msg.chatMsgtype ?? 'm.text'

    if (msgtype === 'm.image') {
      if (!msg.mxcUrl) return <MediaError>图片消息缺少媒体地址</MediaError>
      return (
        <MatrixMediaImage
          mxcUrl={msg.mxcUrl}
          alt={msg.body || '图片'}
          accessToken={accessToken}
          onClick={() => {
            // Open via blob: we let the component handle that separately by inspecting src
            // For simplicity, open authenticated URL in new tab (triggers download on auth-required servers)
            if (accessToken && msg.mxcUrl) {
              // Fetch and open in new window as object URL
              fetchMatrixMediaBlob(accessToken, msg.mxcUrl)
                .then((blob) => {
                  const url = URL.createObjectURL(blob)
                  window.open(url, '_blank')
                  // Can't revoke immediately since tab is opening
                  setTimeout(() => URL.revokeObjectURL(url), 60_000)
                })
                .catch(() => { /* ignore click errors */ })
            }
          }}
        />
      )
    }

    if (msgtype === 'm.file') {
      if (!msg.mxcUrl) return <MediaError>附件消息缺少媒体地址</MediaError>
      return (
        <FileCard>
          <FileCardInfo>
            <span>📎</span>
            <FileCardName title={msg.body}>{msg.body || '附件'}</FileCardName>
            {msg.fileSize != null && <FileCardSize>{formatFileSize(msg.fileSize)}</FileCardSize>}
          </FileCardInfo>
          <DownloadBtn
            onClick={() => downloadMatrixFile(accessToken, msg.mxcUrl!, msg.body || 'attachment', (e) => setFileError(msg.id, e))}
            title="下载"
          >
            下载
          </DownloadBtn>
          {fileErrors[msg.id] && <MediaError>{fileErrors[msg.id]}</MediaError>}
        </FileCard>
      )
    }

    // m.text or unsupported
    if (msgtype !== 'm.text' && !msg.body) return <em>不支持的消息类型</em>
    return <>{msg.body}</>
  }

  return (
    <ChatStream>
      {thread.messages.map((msg) => (
        <BubbleRow key={msg.id} $incoming={msg.isIncoming}>
          <BubbleMeta>
            {msg.isIncoming ? (msg.fromName || '对方') : '我'} · {formatTime(msg.timestamp)}
          </BubbleMeta>
          <Bubble $incoming={msg.isIncoming}>
            {renderBubbleContent(msg)}
            {msg.attachments.length > 0 && (
              <BubbleAttachment>
                📎 {msg.attachments[0].filename}
                {msg.attachments.length > 1 && ` 等 ${msg.attachments.length} 个附件`}
              </BubbleAttachment>
            )}
          </Bubble>
        </BubbleRow>
      ))}
      <div ref={bottomRef} />
    </ChatStream>
  )
}

/* ================================================================== */
/*  AccountSettingsModal                                              */
/* ================================================================== */

function AccountSettingsModal({ onClose }: { onClose: () => void }) {
  const { emailAccountConfig, saveEmailAccount, clearEmailAccount, isRealEmailMode } = useCommunication()

  const KNOWN_PUBLIC_IMAP_HOSTS = new Set(['imap.qq.com', 'imap.163.com', 'imap.gmail.com', 'outlook.office365.com'])

  const blankForm = (): EmailAccountConfig => ({
    user: '', password: '', displayName: '',
    imapHost: 'imap.qq.com', imapPort: 993, imapSecure: true,
    smtpHost: 'smtp.qq.com', smtpPort: 465, smtpSecure: true,
    username: '', providerType: '', allowSelfSignedCerts: false,
  })

  const [form, setForm] = useState<EmailAccountConfig>(emailAccountConfig ?? blankForm())
  const [testStatus, setTestStatus] = useState<{ tone: 'ok' | 'err' | 'loading'; msg: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [schoolProbeResults, setSchoolProbeResults] = useState<Array<{ protocol: 'imap' | 'smtp'; mode: 'starttls' | 'none' | 'ssl'; ok: boolean; message: string }>>([])
  const [customPresets, setCustomPresets] = useState<CustomEmailPreset[]>([])
  const [probeStatus, setProbeStatus] = useState<string | null>(null)
  const [probing, setProbing] = useState(false)
  const [showSavePreset, setShowSavePreset] = useState(false)
  const [savePresetName, setSavePresetName] = useState('')
  const domainProbeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastProbedDomain = useRef('')

  useEffect(() => {
    void window.electronAPI?.emailLoadCustomPresets?.().then((presets) => {
      if (Array.isArray(presets)) setCustomPresets(presets)
    })
  }, [])

  const matchesHostPair = useCallback((draft: Pick<EmailAccountConfig, 'imapHost' | 'smtpHost'>, imapHost: string, smtpHost: string) => (
    draft.imapHost.trim().toLowerCase() === imapHost && draft.smtpHost.trim().toLowerCase() === smtpHost
  ), [])
  const requiresFullEmailUsername = useCallback((draft: Pick<EmailAccountConfig, 'imapHost' | 'smtpHost'>) => (
    matchesHostPair(draft, 'imap.163.com', 'smtp.163.com')
    || matchesHostPair(draft, 'imap.qq.com', 'smtp.qq.com')
    || matchesHostPair(draft, 'imap.exmail.qq.com', 'smtp.exmail.qq.com')
  ), [matchesHostPair])

  const isInternal = form.providerType === 'internal-imap'
  const isSchoolExchange = form.provider === 'school_cuhk_exchange_imap_smtp'
  const isLinkAccount = form.user.endsWith('@link.cuhk.edu.cn')
  const isOutlook = !isInternal && !isSchoolExchange && /outlook|office365/i.test(form.imapHost)
  const is163 = !isInternal && !isSchoolExchange && matchesHostPair(form, 'imap.163.com', 'smtp.163.com')
  const isQqMail = !isInternal && !isSchoolExchange && matchesHostPair(form, 'imap.qq.com', 'smtp.qq.com')
  const isTencentExmail = !isInternal && !isSchoolExchange && matchesHostPair(form, 'imap.exmail.qq.com', 'smtp.exmail.qq.com')

  const normalizeManualForm = useCallback((draft: EmailAccountConfig): EmailAccountConfig => {
    const user = draft.user.trim()
    return {
      ...draft,
      user,
      email: user,
      username: requiresFullEmailUsername(draft) ? user : (draft.username?.trim() || ''),
      smtpIgnoreTls: draft.smtpPort === 587 ? false : (draft.smtpIgnoreTls ?? false),
      smtpEncryption:
        draft.smtpPort === 465 ? 'ssl'
          : draft.smtpPort === 587 ? 'starttls'
            : draft.smtpEncryption,
    }
  }, [requiresFullEmailUsername])

  const formatConnectionStatusLine = useCallback((result: EmailConnectionCheckResult) => {
    if (result.ok) return `${result.protocol.toUpperCase()}: 连接成功`
    return `${result.error?.errorCode || `${result.protocol.toUpperCase()}_FAILED`}: ${result.message}`
  }, [])

  const applyPreset = (preset: typeof EMAIL_ACCOUNT_PRESETS[0]) => {
    setForm((f) => ({
      ...f,
      imapHost: preset.imapHost, imapPort: preset.imapPort, imapSecure: preset.imapSecure,
      smtpHost: preset.smtpHost, smtpPort: preset.smtpPort, smtpSecure: preset.smtpSecure,
      username: requiresFullEmailUsername(preset) ? f.user.trim() : '',
      email: f.user.trim(),
      providerType: '',
      provider: undefined,
      fromPolicy: undefined,
      smtpIgnoreTls: false,
      imapEncryption: undefined,
      smtpEncryption: preset.smtpPort === 465 ? 'ssl' : preset.smtpPort === 587 ? 'starttls' : undefined,
    }))
    setTestStatus(null)
    setSchoolProbeResults([])
  }

  const applyInternalPreset = () => {
    setForm((f) => {
      const useDefaults = !f.imapHost || KNOWN_PUBLIC_IMAP_HOSTS.has(f.imapHost)
      return {
        ...f,
        providerType: 'internal-imap',
        provider: undefined,
        ...(useDefaults ? {
          imapHost: 'mail.ai.cuhk.edu.cn',
          imapPort: 993,
          imapSecure: true,
          smtpHost: 'mail.ai.cuhk.edu.cn',
          smtpPort: 465,
          smtpSecure: true,
        } : {}),
        username: f.username || f.user || '',
      }
    })
    setTestStatus(null)
    setSchoolProbeResults([])
  }

  const applySchoolExchangePreset = (email?: string) => {
    setForm((f) => ({
      ...f,
      provider: 'school_cuhk_exchange_imap_smtp',
      providerType: '',
      imapHost: 'mail.cuhk.edu.cn',
      imapPort: 143,
      imapSecure: false,
      smtpHost: 'mail.cuhk.edu.cn',
      smtpPort: 587,
      smtpSecure: false,
      username: email || f.user || '',
      fromPolicy: 'same_as_login',
    }))
    setTestStatus(null)
    setSchoolProbeResults([])
  }

  const handleEmailChange = (value: string) => {
    if (value.endsWith('@cuhk.edu.cn')) {
      setForm((f) => ({
        ...f,
        user: value,
        email: value,
        provider: 'school_cuhk_exchange_imap_smtp',
        providerType: '',
        imapHost: 'mail.cuhk.edu.cn',
        imapPort: 143,
        imapSecure: false,
        smtpHost: 'mail.cuhk.edu.cn',
        smtpPort: 587,
        smtpSecure: false,
        username: value,
        fromPolicy: 'same_as_login',
      }))
      return
    }
    setForm((f) => ({
      ...f,
      user: value,
      email: value,
      username: requiresFullEmailUsername(f) ? value : f.username,
    }))
    // Auto-probe the domain when email is typed
    const atIdx = value.lastIndexOf('@')
    const domain = atIdx >= 0 ? value.slice(atIdx + 1).trim().toLowerCase() : ''
    if (domain && domain.includes('.') && domain !== lastProbedDomain.current) {
      if (domainProbeTimer.current) clearTimeout(domainProbeTimer.current)
      domainProbeTimer.current = setTimeout(() => {
        void triggerDomainProbe(domain)
      }, 800)
    }
  }

  const triggerDomainProbe = async (domain: string) => {
    // Skip well-known providers already handled by built-in presets
    const knownDomains = ['qq.com', '163.com', '126.com', 'yeah.net', 'gmail.com', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'cuhk.edu.cn']
    if (knownDomains.includes(domain)) return
    lastProbedDomain.current = domain
    setProbing(true)
    setProbeStatus('🔍 正在自动探测邮件服务器...')
    try {
      const result = await window.electronAPI?.emailAutoProbeEmailDomain?.(domain)
      if (result?.ok && result.imapHost && result.smtpHost) {
        setForm((f) => ({
          ...f,
          imapHost: result.imapHost!,
          imapPort: result.imapPort!,
          imapSecure: result.imapSecure!,
          smtpHost: result.smtpHost!,
          smtpPort: result.smtpPort!,
          smtpSecure: result.smtpSecure!,
          imapEncryption: undefined,
          smtpEncryption: result.smtpPort === 465 ? 'ssl' : result.smtpPort === 587 ? 'starttls' : undefined,
          provider: undefined,
          providerType: '',
          fromPolicy: undefined,
        }))
        setProbeStatus(`✅ 已自动探测到 ${domain} 服务器配置（IMAP: ${result.imapHost}:${result.imapPort}, SMTP: ${result.smtpHost}:${result.smtpPort}）`)
        setTimeout(() => setProbeStatus(null), 8000)
      } else {
        setProbeStatus(null)
      }
    } catch {
      setProbeStatus(null)
    } finally {
      setProbing(false)
    }
  }

  const handleSaveAsPreset = async () => {
    if (!savePresetName.trim()) return
    const preset = {
      label: savePresetName.trim(),
      imapHost: form.imapHost, imapPort: form.imapPort, imapSecure: form.imapSecure,
      smtpHost: form.smtpHost, smtpPort: form.smtpPort, smtpSecure: form.smtpSecure,
    }
    await window.electronAPI?.emailSaveCustomPreset?.(preset)
    const saved: CustomEmailPreset = { ...preset, isCustom: true, createdAt: new Date().toISOString() }
    setCustomPresets((prev) => [...prev.filter((p) => p.label !== saved.label), saved])
    setShowSavePreset(false)
    setSavePresetName('')
  }

  const handleDeleteCustomPreset = async (label: string) => {
    await window.electronAPI?.emailRemoveCustomPreset?.(label)
    setCustomPresets((prev) => prev.filter((p) => p.label !== label))
  }

  const testConnection = async () => {
    if (isSchoolExchange) {
      await testSchoolConnection()
      return
    }
    setTestStatus({ tone: 'loading', msg: '正在分别验证 IMAP 和 SMTP...' })
    try {
      const config = normalizeManualForm(form)
      const [imapResult, smtpResult] = await Promise.all([
        window.electronAPI?.emailTestConnection?.(config),
        window.electronAPI?.emailTestSmtp?.(config),
      ])
      if (!imapResult || !smtpResult) {
        setTestStatus({ tone: 'err', msg: '连接测试不可用，请重试。' })
        return
      }
      const statusMsg = [
        formatConnectionStatusLine(imapResult),
        formatConnectionStatusLine(smtpResult),
      ].join('\n')
      setTestStatus({
        tone: imapResult.ok && smtpResult.ok ? 'ok' : 'err',
        msg: statusMsg,
      })
    } catch (err) {
      setTestStatus({ tone: 'err', msg: err instanceof Error ? err.message : String(err) })
    }
  }

  const testSchoolConnection = async () => {
    setTestStatus({ tone: 'loading', msg: '正在自动探测 IMAP/SMTP 加密方式（最多 3×3 次）...' })
    setSchoolProbeResults([])
    try {
      const result = await window.electronAPI?.emailTestSchoolAccount?.({
        email: form.user,
        password: form.password,
        imapHost: form.imapHost || 'mail.cuhk.edu.cn',
        imapPort: form.imapPort || 143,
        smtpHost: form.smtpHost || 'mail.cuhk.edu.cn',
        smtpPort: form.smtpPort || 587,
      })
      if (result) {
        setSchoolProbeResults(result.probeResults ?? [])
        if (result.ok && result.imapEncryption && result.smtpEncryption) {
          setForm((f) => ({
            ...f,
            imapSecure: result.imapEncryption === 'ssl',
            smtpSecure: result.smtpEncryption === 'ssl',
            smtpIgnoreTls: result.smtpEncryption === 'none',
            imapEncryption: result.imapEncryption,
            smtpEncryption: result.smtpEncryption,
          }))
          setTestStatus({ tone: 'ok', msg: `连接成功！IMAP: ${result.imapEncryption.toUpperCase()}  SMTP: ${result.smtpEncryption.toUpperCase()}` })
        } else {
          setTestStatus({ tone: 'err', msg: '自动探测未找到可用的加密组合，请查看下方详细结果。' })
        }
      }
    } catch (err) {
      setTestStatus({ tone: 'err', msg: err instanceof Error ? err.message : String(err) })
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      // Keep email alias in sync with user (primary field) before saving
      const normalizedForm: typeof form = normalizeManualForm(form)
      if (isSchoolExchange) {
        const result = await window.electronAPI?.emailSaveSchoolAccount?.({
          ...normalizedForm,
          provider: 'school_cuhk_exchange_imap_smtp',
          fromPolicy: 'same_as_login',
          username: normalizedForm.user,
        })
        if (result && !result.ok) {
          setTestStatus({ tone: 'err', msg: result.error?.message ?? '保存失败' })
          setSaving(false)
          return
        }
        // Reload the saved config (without plaintext password) and update
        // EmailContext state, which also triggers fetchRealMails so the inbox
        // refreshes immediately after saving the school Exchange account.
        const savedConfig = await window.electronAPI?.emailGetAccount?.()
        if (savedConfig) {
          await saveEmailAccount({ ...savedConfig, email: savedConfig.user || savedConfig.email })
        }
      } else {
        await saveEmailAccount(normalizedForm)
      }
      onClose()
    } catch (err) {
      setTestStatus({ tone: 'err', msg: err instanceof Error ? err.message : '保存失败，请重试' })
      setSaving(false)
    }
  }

  const handleClear = async () => {
    if (isSchoolExchange) {
      await window.electronAPI?.emailRemoveSchoolAccount?.()
    } else {
      await clearEmailAccount()
    }
    onClose()
  }

  const field = (key: keyof EmailAccountConfig, label: string, type = 'text', placeholder = '') => (
    <>
      <FormLabel>{label}</FormLabel>
      <FormInput
        type={type}
        placeholder={placeholder}
        value={String(form[key] ?? '')}
        onChange={(e) => {
          const val = type === 'number' ? Number(e.target.value) : e.target.value
          if (key === 'user' && type === 'email') {
            handleEmailChange(e.target.value)
          } else {
            setForm((f) => ({ ...f, [key]: val }))
          }
        }}
      />
    </>
  )

  return (
    <ModalOverlay onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <ModalCard>
        <ModalTitle>📧 邮件账号设置</ModalTitle>
        <PresetRow>
          {EMAIL_ACCOUNT_PRESETS.map((p) => (
            <PresetButton
              key={p.label}
              $active={!isInternal && !isSchoolExchange && form.imapHost === p.imapHost}
              onClick={() => applyPreset(p)}
            >
              {p.label}
            </PresetButton>
          ))}
          {customPresets.map((p) => (
            <CustomPresetButtonWrap key={p.label}>
              <PresetButton
                $active={!isInternal && !isSchoolExchange && form.imapHost === p.imapHost && form.smtpHost === p.smtpHost}
                onClick={() => applyPreset(p)}
                title={`IMAP: ${p.imapHost}:${p.imapPort}  SMTP: ${p.smtpHost}:${p.smtpPort}`}
              >
                📌 {p.label}
              </PresetButton>
              <CustomPresetDeleteBtn
                onClick={() => void handleDeleteCustomPreset(p.label)}
                title="删除此预设"
              >✕</CustomPresetDeleteBtn>
            </CustomPresetButtonWrap>
          ))}
          <PresetButton $active={isInternal} onClick={applyInternalPreset}>
            🏢 内部邮箱
          </PresetButton>
          <PresetButton $active={isSchoolExchange} onClick={() => applySchoolExchangePreset()}>
            🎓 CUHK 学校邮箱
          </PresetButton>
        </PresetRow>

        {/* Save-as-preset row */}
        {!isInternal && !isSchoolExchange && form.imapHost && form.smtpHost && (
          showSavePreset ? (
            <SavePresetRow>
              <SavePresetInput
                type="text"
                placeholder="预设名称（如：公司邮箱）"
                value={savePresetName}
                onChange={(e) => setSavePresetName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveAsPreset() }}
                autoFocus
              />
              <PresetButton onClick={() => void handleSaveAsPreset()}>保存</PresetButton>
              <PresetButton onClick={() => { setShowSavePreset(false); setSavePresetName('') }}>取消</PresetButton>
            </SavePresetRow>
          ) : (
            <SavePresetRow>
              <PresetButton onClick={() => setShowSavePreset(true)} title="将当前 IMAP/SMTP 配置保存为自定义预设">
                📌 保存为预设
              </PresetButton>
            </SavePresetRow>
          )
        )}

        {/* Domain auto-probe status */}
        {(probing || probeStatus) && (
          <ProbeStatus>{probing ? '🔍 正在自动探测邮件服务器...' : probeStatus}</ProbeStatus>
        )}

        {isInternal && (
          <InternalHint>
            适用于自建 mailcow、iRedMail、校园/企业内网邮件服务器
          </InternalHint>
        )}
        {isSchoolExchange && (
          <InternalHint>
            🎓 <strong>CUHK 教职工邮箱 (@cuhk.edu.cn)</strong><br />
            IMAP: mail.cuhk.edu.cn:143 &nbsp;·&nbsp; SMTP: mail.cuhk.edu.cn:587<br />
            加密方式将在"自动探测"时自动选择。点击"验证连接"开始探测。<br />
            当前学校 Exchange 证书链不完整，客户端会按学校服务器配置放宽证书校验。<br />
            ⚠️ 仅适用于 @cuhk.edu.cn；@link.cuhk.edu.cn 学生邮箱请见下方提示。
          </InternalHint>
        )}
        {isLinkAccount && (
          <OutlookHint>
            ⚠️ <strong>@link.cuhk.edu.cn 学生邮箱属于另一套 Microsoft 365 体系</strong><br />
            学校 ITSO 提供的 mail.cuhk.edu.cn 参数不适用于学生邮箱，本阶段暂不支持。<br />
            请等待单独配置或联系 ITSO 确认学生邮箱 IMAP/SMTP 参数。
          </OutlookHint>
        )}
        {isOutlook && (
          <OutlookHint>
            ⚠️ <strong>Outlook / Office 365 需要应用密码</strong><br />
            请在 account.microsoft.com → 安全 → 高级安全选项中创建应用密码，填入下方密码栏。
          </OutlookHint>
        )}
        {is163 && (
          <OutlookHint>
            ⚠️ <strong>163 邮箱必须开启 IMAP/SMTP，并使用客户端授权码</strong><br />
            用户名必须填写完整邮箱地址，不能只填 @ 前面的账号，也不要使用网页登录密码。
          </OutlookHint>
        )}
        {isQqMail && (
          <OutlookHint>
            ⚠️ <strong>QQ 邮箱必须开启 IMAP/SMTP，并使用授权码</strong><br />
            用户名必须填写完整邮箱地址，不能使用 QQ 登录密码。
          </OutlookHint>
        )}
        {isTencentExmail && (
          <OutlookHint>
            ⚠️ <strong>腾讯企业邮请使用完整邮箱地址登录</strong><br />
            常用参数：IMAP `imap.exmail.qq.com:993`、SMTP `smtp.exmail.qq.com:465`。<br />
            用户名必须填写完整邮箱地址；通常使用邮箱登录密码，如管理员启用了客户端专用密码请改填专用密码。
          </OutlookHint>
        )}

        <FormGrid>
          {field('displayName', '显示名称', 'text', isInternal ? '例：王老师' : isSchoolExchange ? '例：王教授' : '例：王明')}
          <FormLabel>邮箱地址</FormLabel>
          <FormInput
            type="email"
            placeholder={isSchoolExchange ? 'user@cuhk.edu.cn' : isInternal ? 'teacher@ai.cuhk.edu.cn' : '例：wang@qq.com'}
            value={form.user}
            onChange={(e) => handleEmailChange(e.target.value)}
          />
          {(isInternal || isSchoolExchange) && (
            <>
              <FormLabel>用户名</FormLabel>
              <FormInput
                type="text"
                placeholder={isSchoolExchange ? '默认为完整邮箱地址' : '默认同邮箱地址'}
                value={form.username ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              />
            </>
          )}
          <FormLabel>
            {is163
              ? '客户端授权码'
              : isQqMail
                ? '授权码'
                : isTencentExmail
                  ? '邮箱密码/客户端专用密码'
                  : `密码${isSchoolExchange ? '（安全存储，不写入配置文件）' : '/授权码'}`}
          </FormLabel>
          <FormInput
            type="password"
            placeholder={
              is163
                ? '请输入 163 客户端授权码'
                : isQqMail
                  ? '请输入 QQ 邮箱授权码'
                  : isTencentExmail
                    ? '请输入腾讯企业邮密码或客户端专用密码'
                : isSchoolExchange
                  ? '邮箱登录密码'
                  : '邮箱密码或授权码'
            }
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          />

          {(isInternal || isSchoolExchange) && <FormSectionLabel>IMAP 接收服务器</FormSectionLabel>}
          {field('imapHost', 'IMAP 服务器', 'text')}
          {field('imapPort', 'IMAP 端口', 'number')}
          {(isInternal || isSchoolExchange) && (
            <>
              <FormLabel>IMAP 加密</FormLabel>
              {isSchoolExchange ? (
                <FormInput
                  type="text"
                  readOnly
                  value={form.imapEncryption ? `已探测：${form.imapEncryption.toUpperCase()}` : '点击"验证连接"自动探测'}
                  style={{ color: form.imapEncryption ? 'var(--green, #38a169)' : undefined }}
                />
              ) : (
                <FormSelect
                  value={form.imapSecure ? 'ssl' : 'starttls'}
                  onChange={(e) => setForm((f) => ({ ...f, imapSecure: e.target.value === 'ssl' }))}
                >
                  <option value="ssl">SSL/TLS（推荐，端口 993）</option>
                  <option value="starttls">STARTTLS（端口 143）</option>
                  <option value="none">None（不加密）</option>
                </FormSelect>
              )}
            </>
          )}

          {(isInternal || isSchoolExchange) && <FormSectionLabel>SMTP 发送服务器</FormSectionLabel>}
          {field('smtpHost', 'SMTP 服务器', 'text')}
          {field('smtpPort', 'SMTP 端口', 'number')}
          {(isInternal || isSchoolExchange) && (
            <>
              <FormLabel>SMTP 加密</FormLabel>
              {isSchoolExchange ? (
                <FormInput
                  type="text"
                  readOnly
                  value={form.smtpEncryption ? `已探测：${form.smtpEncryption.toUpperCase()}` : '点击"验证连接"自动探测'}
                  style={{ color: form.smtpEncryption ? 'var(--green, #38a169)' : undefined }}
                />
              ) : (
                <FormSelect
                  value={form.smtpSecure ? 'ssl' : 'starttls'}
                  onChange={(e) => setForm((f) => ({ ...f, smtpSecure: e.target.value === 'ssl' }))}
                >
                  <option value="ssl">SSL/TLS（推荐，端口 465）</option>
                  <option value="starttls">STARTTLS（端口 587）</option>
                  <option value="none">None（不加密）</option>
                </FormSelect>
              )}
            </>
          )}

          {isInternal && (
            <>
              <FormLabel></FormLabel>
              <CheckboxRow>
                <input
                  type="checkbox"
                  id="allowSelfSigned"
                  checked={form.allowSelfSignedCerts ?? false}
                  onChange={(e) => setForm((f) => ({ ...f, allowSelfSignedCerts: e.target.checked }))}
                />
                <label htmlFor="allowSelfSigned">
                  允许自签名证书<SelfSignedNote>仅在可信内网服务器使用</SelfSignedNote>
                </label>
              </CheckboxRow>
            </>
          )}

          {isSchoolExchange && (
            <>
              <FormLabel></FormLabel>
              <div style={{ fontSize: 12, color: 'var(--text-secondary, #718096)' }}>
                🔒 发件人固定为登录账号，不允许修改发件人地址。
              </div>
            </>
          )}
        </FormGrid>

        {/* Probe results table for school Exchange */}
        {isSchoolExchange && schoolProbeResults.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 12, borderTop: '1px solid var(--border, #e2e8f0)', paddingTop: 8 }}>
            <strong>自动探测详情：</strong>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 4 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '2px 6px', color: 'var(--text-secondary, #718096)' }}>协议</th>
                  <th style={{ textAlign: 'left', padding: '2px 6px', color: 'var(--text-secondary, #718096)' }}>加密</th>
                  <th style={{ textAlign: 'left', padding: '2px 6px', color: 'var(--text-secondary, #718096)' }}>结果</th>
                  <th style={{ textAlign: 'left', padding: '2px 6px', color: 'var(--text-secondary, #718096)' }}>详情</th>
                </tr>
              </thead>
              <tbody>
                {schoolProbeResults.map((r, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border, #e2e8f0)' }}>
                    <td style={{ padding: '2px 6px' }}>{r.protocol.toUpperCase()}</td>
                    <td style={{ padding: '2px 6px' }}>{r.mode.toUpperCase()}</td>
                    <td style={{ padding: '2px 6px', color: r.ok ? 'var(--green, #38a169)' : 'var(--red, #e53e3e)' }}>
                      {r.ok ? '✓ 成功' : '✗ 失败'}
                    </td>
                    <td style={{ padding: '2px 6px', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.message}>
                      {r.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {testStatus && <StatusLine $tone={testStatus.tone}>{testStatus.msg}</StatusLine>}
        <ModalActions>
          {isRealEmailMode && (
            <Btn $variant="danger" onClick={handleClear} style={{ marginRight: 'auto' }}>
              清除账号
            </Btn>
          )}
          <Btn
            $variant="muted"
            onClick={testConnection}
            disabled={isLinkAccount}
            title={isLinkAccount ? '@link.cuhk.edu.cn 不适用 mail.cuhk.edu.cn，无法测试' : undefined}
          >
            {isSchoolExchange ? '自动探测连接' : '验证连接'}
          </Btn>
          <Btn $variant="muted" onClick={onClose}>取消</Btn>
          <Btn
            onClick={handleSave}
            disabled={saving || isLinkAccount}
            title={isLinkAccount ? '@link.cuhk.edu.cn 暂不支持保存' : undefined}
          >
            {saving ? '保存中...' : '保存并连接'}
          </Btn>
        </ModalActions>
      </ModalCard>
    </ModalOverlay>
  )
}

/* ================================================================== */
/*  AI analysis rendering                                              */
/* ================================================================== */

function resolveActionPlan(triage: AiMailTriageResult): AiEmailActionPlan {
  return triage.actionPlan ?? {
    intentType: triage.emailCategory === 'promotion' || triage.emailCategory === 'spam' || triage.category === 'risk'
      ? 'spam'
      : triage.requiresOpenAttachment
        ? 'attachment_review'
        : triage.requiresAction
          ? 'task'
          : triage.requiresReply
            ? 'question'
            : 'ordinary',
    title: triage.summary || '邮件处理建议',
    brief: triage.suggestedAction || '人工确认后处理',
    replyStrategy: {
      shouldReply: Boolean(triage.requiresReply ?? triage.needsReply),
      tone: 'neutral',
      reason: triage.suggestedAction || 'AI 自动判断回复策略',
    },
  }
}

/** Renders the "关键信息" section for the AI analysis panel (type-specific). */
function renderKeyInfo(plan: AiEmailActionPlan, triage: AiMailTriageResult) {
  if (plan.intentType === 'task') {
    const items = plan.taskChecklist?.length
      ? plan.taskChecklist.map((item) => `${item.text}${item.deadline ? `（截止：${item.deadline}）` : ''}`)
      : triage.todos?.map((todo) => `${todo.title}${todo.deadline ? `（截止：${todo.deadline}）` : ''}`) ?? []
    if (!items.length) return null
    return (
      <AiInfoBlock>
        <AiInfoHead>关键任务</AiInfoHead>
        <AiInfoBody>
          {items.map((text, i) => <div key={i}>• {text}</div>)}
        </AiInfoBody>
      </AiInfoBlock>
    )
  }

  if (plan.intentType === 'request') {
    const items = plan.requestItems?.length ? plan.requestItems : [{ id: 'default', text: plan.brief, required: true }]
    return (
      <AiInfoBlock>
        <AiInfoHead>对方需求</AiInfoHead>
        <AiInfoBody>
          {items.map((item) => <div key={item.id}>• {item.text}{item.required ? '（必需）' : ''}</div>)}
          {triage.requiresAttachment && <div>• 可能需要随回复发送附件</div>}
        </AiInfoBody>
      </AiInfoBlock>
    )
  }

  if (plan.intentType === 'question') {
    return (
      <AiInfoBlock>
        <AiInfoHead>问题要点</AiInfoHead>
        <AiInfoBody>
          <div>{plan.questionAnswer?.question || triage.summary}</div>
          {(plan.questionAnswer?.answerDraft || triage.suggestedAction) && (
            <div>回复要点：{plan.questionAnswer?.answerDraft || triage.suggestedAction}</div>
          )}
        </AiInfoBody>
      </AiInfoBlock>
    )
  }

  if (plan.intentType === 'notice' || plan.intentType === 'meeting') {
    const points = plan.noticeSummary?.keyPoints?.length ? plan.noticeSummary.keyPoints : [triage.summary]
    return (
      <AiInfoBlock>
        <AiInfoHead>关键信息</AiInfoHead>
        <AiInfoBody>
          {points.map((point, i) => <div key={`kp-${i}`}>• {point}</div>)}
        </AiInfoBody>
      </AiInfoBlock>
    )
  }

  if (plan.intentType === 'attachment_review') {
    const actions = plan.attachmentActions?.length
      ? plan.attachmentActions
      : [{ action: 'review' as const, targetWorkspace: 'preview' as const, note: plan.brief, fileName: undefined }]
    return (
      <AiInfoBlock>
        <AiInfoHead>附件处理建议</AiInfoHead>
        <AiInfoBody>
          {actions.map((item, i) => (
            <div key={`att-${i}`}>
              • {item.fileName || '附件'}：{attachmentActionLabel(item.action)}，推荐{targetWorkspaceLabel(item.targetWorkspace)}。{item.note}
            </div>
          ))}
        </AiInfoBody>
      </AiInfoBlock>
    )
  }

  if (plan.intentType === 'approval') {
    return (
      <AiInfoBlock>
        <AiInfoHead>待决事项</AiInfoHead>
        <AiInfoBody>
          <div>• {plan.brief || triage.suggestedAction || '确认是否批准或拒绝'}</div>
          <div>• 建议正式、谨慎回复，关键结论需人工确认</div>
        </AiInfoBody>
      </AiInfoBlock>
    )
  }

  return null
}

/** Returns a prose-style strategy sentence for the AI analysis panel. */
function buildStrategyText(plan: AiEmailActionPlan, triage: AiMailTriageResult): string {
  if (plan.intentType === 'spam') {
    return plan.brief || '建议移入可恢复区域，不生成正式回复草稿'
  }
  const prefix = plan.replyStrategy.shouldReply ? '需要回复。' : '不需要回复。'
  const reason = plan.replyStrategy.reason || triage.suggestedAction || plan.brief || ''
  return reason ? `${prefix}${reason}` : prefix.slice(0, -1)
}

function ContentTopicOverview({
  topics,
  onTopicClick,
}: {
  topics: EmailContentTopicSummary[]
  onTopicClick: (topic: EmailContentTopicSummary) => void
}) {
  if (topics.length === 0) return <SummaryText>暂无足够的成功分析结果用于归纳内容主题。</SummaryText>
  return (
    <TopicGrid>
      {topics.map((topic) => {
        const hasImportant = topic.importanceLevel === 'important' || topic.importanceLevel === 'mixed'
        return (
          <TopicCard
            key={`${topic.topic}-${topic.relatedMessageIds.join('|')}`}
            $important={hasImportant}
            onClick={() => onTopicClick(topic)}
            title="点击高亮相关邮件"
          >
            <TopicTitle>
              {topic.topic} · {topic.count} 封
              {hasImportant ? ' · 含重要邮件' : ''}
            </TopicTitle>
            <div>{topic.description}</div>
            {topic.representativeSubjects.length > 0 && (
              <div style={{ marginTop: 5, color: '#718096' }}>
                代表邮件：{topic.representativeSubjects.join('；')}
              </div>
            )}
          </TopicCard>
        )
      })}
    </TopicGrid>
  )
}

function EmailAnalysisSummaryPanel({
  summary,
  collapsed,
  onCollapsedChange,
  onMailClick,
  onTopicClick,
}: {
  summary: EmailAnalysisBatchSummary
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  onMailClick: (messageId: string) => void
  onTopicClick: (topic: EmailContentTopicSummary) => void
}) {
  return (
    <SummaryPanel $collapsed={collapsed}>
      <SummaryPanelHeader type="button" onClick={() => onCollapsedChange(!collapsed)}>
        <span>AI邮件分析报告</span>
        <span>{collapsed ? '展开' : '收起'}</span>
      </SummaryPanelHeader>
      {!collapsed && (
        <SummaryPanelBody>
          <SummaryStatGrid>
            <SummaryStatCard>
              <SummaryStatValue>{summary.totalEmails}</SummaryStatValue>
              <SummaryStatLabel>本次分析</SummaryStatLabel>
            </SummaryStatCard>
            <SummaryStatCard>
              <SummaryStatValue>{summary.importantCount}</SummaryStatValue>
              <SummaryStatLabel>重要邮件</SummaryStatLabel>
            </SummaryStatCard>
            <SummaryStatCard>
              <SummaryStatValue>{summary.normalCount}</SummaryStatValue>
              <SummaryStatLabel>普通邮件</SummaryStatLabel>
            </SummaryStatCard>
            <SummaryStatCard>
              <SummaryStatValue>{summary.lowCount}</SummaryStatValue>
              <SummaryStatLabel>低优先级</SummaryStatLabel>
            </SummaryStatCard>
            <SummaryStatCard>
              <SummaryStatValue>{summary.needReplyCount}</SummaryStatValue>
              <SummaryStatLabel>需要回复</SummaryStatLabel>
            </SummaryStatCard>
            <SummaryStatCard>
              <SummaryStatValue>{summary.draftReplyCount}</SummaryStatValue>
              <SummaryStatLabel>已生成草稿</SummaryStatLabel>
            </SummaryStatCard>
            {summary.failedCount > 0 && (
              <SummaryStatCard>
                <SummaryStatValue>{summary.failedCount}</SummaryStatValue>
                <SummaryStatLabel>分析失败</SummaryStatLabel>
              </SummaryStatCard>
            )}
          </SummaryStatGrid>

          {summary.failedItems.length > 0 && (
            <SummarySection>
              <SummarySectionTitle>失败原因</SummarySectionTitle>
              <SummaryList>
                {summary.failedItems.slice(0, 6).map((item) => (
                  <SummaryListItem
                    key={item.messageId}
                    type="button"
                    $clickable
                    onClick={() => onMailClick(item.messageId)}
                    title={item.error}
                  >
                    <strong>{item.subject || '无主题'}</strong>
                    <div style={{ color: '#c53030', marginTop: 2 }}>
                      {(item.fromName || item.fromEmail || '未知发件人')} · {item.error}
                    </div>
                  </SummaryListItem>
                ))}
              </SummaryList>
            </SummarySection>
          )}

          <SummarySection>
            <SummarySectionTitle>主要发件人排行</SummarySectionTitle>
            <SummaryList>
              {summary.senderStats.slice(0, 6).map((sender) => (
                <SummaryListItem key={sender.fromEmail} type="button">
                  <strong>{sender.fromName || sender.fromEmail}</strong>：{sender.count} 封
                  {sender.importantCount > 0 ? `，其中 ${sender.importantCount} 封重要` : ''}
                </SummaryListItem>
              ))}
            </SummaryList>
          </SummarySection>

          <SummarySection>
            <SummarySectionTitle>需要优先处理的邮件</SummarySectionTitle>
            <SummaryList>
              {(summary.actionItems.length ? summary.actionItems : summary.topImportantEmails).slice(0, 8).map((item) => (
                <SummaryListItem
                  key={item.messageId}
                  type="button"
                  $clickable
                  onClick={() => onMailClick(item.messageId)}
                  title="点击定位到邮件详情"
                >
                  <strong>{item.subject}</strong>
                  <div style={{ color: '#718096', marginTop: 2 }}>
                    {item.fromName || item.fromEmail || '未知发件人'} · {emailActionTypeLabel(item.actionType)}
                    {'suggestedNextStep' in item ? ` · ${item.suggestedNextStep}` : item.reason ? ` · ${item.reason}` : ''}
                  </div>
                </SummaryListItem>
              ))}
            </SummaryList>
          </SummarySection>

          <SummarySection>
            <SummarySectionTitle>日程发现</SummarySectionTitle>
            <SummaryText>
              本次分析发现：会议/面试安排 {summary.calendarStats.meetingOrInterviewCount} 封，截止事项 {summary.calendarStats.deadlineCount} 封，多候选时间 {summary.calendarStats.candidateTimesCount} 封，时间冲突 {summary.calendarStats.conflictCount} 封，已加入待确认日程 {summary.calendarStats.tentativeEventCount} 个。
            </SummaryText>
            {(summary.calendarItems.pending.length > 0 || summary.calendarItems.conflicts.length > 0 || summary.calendarItems.deadlines.length > 0) && (
              <SummaryList>
                {summary.calendarItems.pending.slice(0, 4).map((item) => (
                  <SummaryListItem key={`pending-${item.messageId}`} type="button" $clickable onClick={() => onMailClick(item.messageId)}>
                    <strong>需要确认的日程：</strong>{item.title} · {item.startTime || item.deadlineTime || item.subject}
                  </SummaryListItem>
                ))}
                {summary.calendarItems.conflicts.slice(0, 4).map((item) => (
                  <SummaryListItem key={`conflict-${item.messageId}`} type="button" $clickable onClick={() => onMailClick(item.messageId)}>
                    <strong>存在冲突的日程：</strong>{item.title} · 与 {item.conflictCount} 个日程冲突
                  </SummaryListItem>
                ))}
                {summary.calendarItems.deadlines.slice(0, 4).map((item) => (
                  <SummaryListItem key={`deadline-${item.messageId}`} type="button" $clickable onClick={() => onMailClick(item.messageId)}>
                    <strong>截止事项：</strong>{item.title} · {item.deadlineTime || item.subject}
                  </SummaryListItem>
                ))}
              </SummaryList>
            )}
          </SummarySection>

          <SummarySection>
            <SummarySectionTitle>邮件内容概览</SummarySectionTitle>
            <SummaryText>{summary.contentOverviewText}</SummaryText>
          </SummarySection>

          <SummarySection>
            <SummarySectionTitle>主题分布</SummarySectionTitle>
            <ContentTopicOverview topics={summary.contentTopics} onTopicClick={onTopicClick} />
          </SummarySection>

          <SummarySection>
            <SummarySectionTitle>中文总结</SummarySectionTitle>
            <SummaryText>{summary.reportText}</SummaryText>
          </SummarySection>
        </SummaryPanelBody>
      )}
    </SummaryPanel>
  )
}

function EmailReplyKnowledgePicker({
  departments,
  selectedIds,
  onCancel,
  onConfirm,
  onClear,
}: {
  departments: Department[]
  selectedIds: string[]
  onCancel: () => void
  onConfirm: (ids: string[]) => void
  onClear: () => void
}) {
  const [query, setQuery] = useState('')
  const [draftIds, setDraftIds] = useState<string[]>(selectedIds)

  useEffect(() => {
    setDraftIds(selectedIds)
  }, [selectedIds])

  const flatDepartments = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const flat = flattenDepartments(departments)
    if (!normalizedQuery) return flat
    return flat.filter(({ department }) =>
      department.name.toLowerCase().includes(normalizedQuery) ||
      department.nameEn.toLowerCase().includes(normalizedQuery) ||
      department.id.toLowerCase().includes(normalizedQuery),
    )
  }, [departments, query])

  const toggle = useCallback((id: string) => {
    setDraftIds((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id])
  }, [])

  const clearDraft = useCallback(() => {
    setDraftIds([])
    onClear()
  }, [onClear])

  return (
    <ModalOverlay onClick={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <KnowledgeModalCard>
        <ModalTitle>选择知识库</ModalTitle>
        <KnowledgeSearchInput
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索知识库名称"
        />
        <KnowledgeList>
          {flatDepartments.length === 0 ? (
            <KnowledgeEmpty>暂无可选择的知识库</KnowledgeEmpty>
          ) : (
            flatDepartments.map(({ department, depth }) => {
              const checked = draftIds.includes(department.id)
              return (
                <KnowledgeOption key={department.id} $selected={checked} $depth={depth}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(department.id)}
                  />
                  <KnowledgeOptionName title={department.name}>{department.name}</KnowledgeOptionName>
                </KnowledgeOption>
              )
            })
          )}
        </KnowledgeList>
        <ModalActions>
          <Btn $variant="muted" onClick={onCancel}>取消</Btn>
          <Btn $variant="muted" onClick={clearDraft} disabled={draftIds.length === 0}>清空</Btn>
          <Btn onClick={() => onConfirm(draftIds)}>确认</Btn>
        </ModalActions>
      </KnowledgeModalCard>
    </ModalOverlay>
  )
}

interface MailCalendarCheckState {
  conflicts: CalendarConflict[]
  candidateConflicts: Array<{
    startTime: string
    endTime?: string
    conflicts: CalendarConflict[]
  }>
  recommendedCandidate?: {
    startTime: string
    endTime?: string
  }
}

function buildEmailReplyGenerationOptions(
  snippets: EmailReplyKnowledgeSnippet[],
  triage: AiMailTriageResult | undefined,
  calendarCheck: MailCalendarCheckState | null,
  selectedCalendarCandidateStart: string | null,
): EmailReplyGenerationOptions {
  const actionPlan = triage?.status === 'success' ? resolveActionPlan(triage) : undefined
  const timeIntent = triage?.timeIntent
  const hasConflict = Boolean((calendarCheck?.conflicts.length ?? triage?.calendarConflictCount ?? 0) > 0)
  const selectedCandidate = selectedCalendarCandidateStart
    ? timeIntent?.candidateTimes?.find((candidate) => candidate.startTime === selectedCalendarCandidateStart)
    : undefined

  return {
    knowledgeSnippets: snippets,
    triageContext: triage ? {
      summary: triage.summary,
      category: triage.emailCategory || triage.category,
      actionType: actionPlan?.intentType || triage.detectedIntent,
      reason: triage.reason,
      suggestedAction: triage.suggestedAction,
      timeIntentTitle: timeIntent?.title,
      timeIntentSourceText: timeIntent?.sourceText,
    } : undefined,
    calendarContext: timeIntent?.hasTimeRequirement ? {
      hasTimeRequirement: true,
      intentType: timeIntent.type,
      title: timeIntent.title || triage?.summary,
      startTime: selectedCandidate?.startTime || timeIntent.startTime,
      endTime: selectedCandidate?.endTime || timeIntent.endTime,
      deadlineTime: timeIntent.deadlineTime,
      location: timeIntent.location,
      candidateTimes: (timeIntent.candidateTimes ?? []).map((candidate) => {
        const checked = calendarCheck?.candidateConflicts.find((item) => item.startTime === candidate.startTime)
        return {
          startTime: candidate.startTime,
          endTime: candidate.endTime,
          hasConflict: checked ? checked.conflicts.length > 0 : undefined,
        }
      }),
      recommendedTime: selectedCalendarCandidateStart ?? calendarCheck?.recommendedCandidate?.startTime,
      conflictCount: calendarCheck?.conflicts.length ?? triage?.calendarConflictCount,
      hasConflict,
    } : undefined,
  }
}

/* ================================================================== */
/* ================================================================== */
/*  Inner workbench                                                   */
/* ================================================================== */

function CommunicationWorkbenchInner() {
  const {
    filteredThreads,
    selectedThreadId,
    selectedThread,
    activeFilter,
    setActiveFilter,
    selectThread,
    currentDraft,
    streamingPreview,
    regenerateDraft,
    updateDraftContent,
    saveDraft,
    addDraftAttachment,
    removeDraftAttachment,
    sendReply,
    isRealEmailMode,
    isFetchingMails,
    fetchError,
    refreshMails,
    refreshSent,
    threads,
    matrixPhase,
    createMatrixDirect,
    deleteMail,
    restoreMail,
    refreshTrash,
    emailAccountConfig,
  } = useCommunication()

  const {
    triageResults,
    aiDrafts,
    mailTodos,
    triggerAnalysis,
    analysisStatus,
    analysisProgress,
    currentBatchSummary,
    isAnalyzingEmails,
    isWorkerRunning,
    enqueueMail,
    regenerateDraft: triageRegenerateDraft,
    discardDraft: triageDiscardDraft,
  } = useMailTriage()
  const { activeWorkspacePath, refreshTree } = useWorkspace()
  const { departments } = useDepartment()

  const { state: internalAccountState } = useInternalAccount()
  const isInternalLoggedIn = internalAccountState.phase === 'logged_in'
  const currentUsername = internalAccountState.phase === 'logged_in' ? internalAccountState.session.user.username : null
  const { session: matrixSession, sendImageMessage: matrixSendImage, sendFileMessage: matrixSendFile } = useMatrixChat()
  const matrixIdentity = matrixSession?.userId ?? (currentUsername ? `@${currentUsername}:aioffice.cuhksz` : null)
  const currentUserId = internalAccountState.phase === 'logged_in' ? internalAccountState.session.user.id : null

  const [showAccountModal, setShowAccountModal] = useState(false)
  const [showCompose, setShowCompose] = useState(false)
  const [pendingComposeTo, setPendingComposeTo] = useState<
    { email: string; displayName?: string; personId?: string; mailboxStatus?: string; fromDirectory?: boolean }[] | undefined
  >(undefined)
  const [pendingComposeDraft, setPendingComposeDraft] = useState<{
    subject: string
    body: string
    attachments: Array<{ fileName: string; filePath: string; mimeType: string; sizeBytes: number }>
    variant: 'compose' | 'forward'
  } | undefined>(undefined)

  // Consume pending compose recipient on first mount (CommunicationWorkbench not yet alive).
  useEffect(() => {
    const pending = consumePendingCompose()
    if (pending) {
      setPendingComposeTo([pending])
      setPendingComposeDraft(undefined)
      setShowCompose(true)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Consume pending compose recipient when already mounted (keep-alive panel re-activated).
  useEffect(() => {
    const handler = () => {
      const pending = consumePendingCompose()
      if (pending) {
        setPendingComposeTo([pending])
        setPendingComposeDraft(undefined)
        setShowCompose(true)
      }
    }
    window.addEventListener('open-communication-workbench', handler)
    return () => window.removeEventListener('open-communication-workbench', handler)
  }, [])
  const [newDmInput, setNewDmInput] = useState('')
  const [dmError, setDmError] = useState<string | null>(null)
  const [creatingDm, setCreatingDm] = useState(false)
  const [deleteConfirmThreadId, setDeleteConfirmThreadId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [sortMode, setSortMode] = useState<MailSortMode>(loadSortMode)
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null)
  const [pendingSourceMail, setPendingSourceMail] = useState<{ messageId: string; subject?: string } | null>(() => {
    try {
      const raw = sessionStorage.getItem('aioffice.pendingSourceMailId')
      if (!raw) return null
      const parsed = JSON.parse(raw) as { messageId?: string; subject?: string }
      return parsed.messageId ? { messageId: parsed.messageId, subject: parsed.subject } : null
    } catch {
      return null
    }
  })
  const [calendarNotice, setCalendarNotice] = useState<string | null>(null)
  const [ignoredCalendarMailIds, setIgnoredCalendarMailIds] = useState<Set<string>>(new Set())
  const [mailCalendarCheck, setMailCalendarCheck] = useState<MailCalendarCheckState | null>(null)
  const [selectedCalendarCandidateStart, setSelectedCalendarCandidateStart] = useState<string | null>(null)
  const [showSuccessHint, setShowSuccessHint] = useState(false)
  const [selectedReplyKnowledgeByMailId, setSelectedReplyKnowledgeByMailId] = useState<Record<string, EmailReplyKnowledgeSelection>>({})
  const [knowledgePickerMailId, setKnowledgePickerMailId] = useState<string | null>(null)
  const [replyKnowledgeNoticeByMailId, setReplyKnowledgeNoticeByMailId] = useState<Record<string, { variant: 'info' | 'success' | 'error'; text: string }>>({})
  const [replyKnowledgeTracesByMailId, setReplyKnowledgeTracesByMailId] = useState<Record<string, EmailReplyKnowledgeTrace>>({})
  const [emailAnalysisSummaryCollapsed, setEmailAnalysisSummaryCollapsed] = useState(false)
  /** Holds partial trace data gathered during handleGenerate; finalized by the draft-status effect. */
  const pendingKnowledgeTraceRef = useRef<{
    mailId: string
    selectedKnowledgeIds: string[]
    snippets: EmailReplyKnowledgeSnippet[]
    knowledgeContextLength: number
    promptHasKnowledgeContext: boolean
    promptHasKnowledgeRequirement: boolean
  } | null>(null)
  const prevDraftStatusRef = useRef<string | undefined>(undefined)
  /** Upload progress for Matrix media messages */
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef= useRef<HTMLInputElement>(null)
  const chatImageInputRef = useRef<HTMLInputElement>(null)
  const chatFileInputRef = useRef<HTMLInputElement>(null)
  const messagePaneRef = useRef<HTMLDivElement>(null)
  const [highlightedBatchMailIds, setHighlightedBatchMailIds] = useState<Set<string>>(new Set())

  // ── Workflow state ───────────────────────────────────────────────────────────
  const [workflowProcessIds, setWorkflowProcessIds] = useState<Record<string, string>>({})
  const [workflowStartStates, setWorkflowStartStates] = useState<Record<string, 'idle' | 'loading' | 'done' | 'error'>>({})
  const [workflowStartErrors, setWorkflowStartErrors] = useState<Record<string, string>>({})
  const [showWorkflowPanel, setShowWorkflowPanel] = useState(false)
  const [workflowTasks, setWorkflowTasks] = useState<WorkflowTask[]>([])
  const [workflowTasksLoading, setWorkflowTasksLoading] = useState(false)
  const [workflowTasksError, setWorkflowTasksError] = useState<string | null>(null)
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null)
  // Tracks which mailIds were auto-started by AI (vs manually triggered) for UI display
  const [autoStartedByAi, setAutoStartedByAi] = useState<Record<string, boolean>>({})
  // Tracks agent workflow results for agent_autonomous pattern (campus card etc.)
  const [agentResults, setAgentResults] = useState<Record<string, AgentWorkflowResult>>({})
  // Ref used as synchronous guard to prevent duplicate auto-start calls between renders
  const autoStartInitiatedRef = useRef<Set<string>>(new Set())

  const unreadCount = useMemo(() => threads.filter((t) => t.unread).length, [threads])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ messageId?: string; subject?: string }>).detail
      if (detail?.messageId) {
        setPendingSourceMail({ messageId: detail.messageId, subject: detail.subject })
      }
    }
    window.addEventListener('open-calendar-source-mail-select', handler)
    return () => window.removeEventListener('open-calendar-source-mail-select', handler)
  }, [])

  useEffect(() => {
    if (!pendingSourceMail) return
    setActiveFilter('email')
    setHighlightedBatchMailIds(new Set([pendingSourceMail.messageId]))
    const targetThreadId = toEmailThreadId(pendingSourceMail.messageId)
    const targetThread = threads.find((thread) => thread.id === targetThreadId)
    if (targetThread) {
      selectThread(targetThreadId)
      setAttachmentNotice(null)
      setPendingSourceMail(null)
      sessionStorage.removeItem('aioffice.pendingSourceMailId')
      return
    }
    setAttachmentNotice(`请在邮件列表中查看来源邮件：${pendingSourceMail.subject || pendingSourceMail.messageId}`)
  }, [pendingSourceMail, selectThread, setActiveFilter, threads])

  /** Apply AI-based post-filtering + smart/time sorting on top of context filteredThreads */
  const displayedThreads = useMemo(() => {
    // Apply sort — both modes use getThreadTime for stable tie-breaking
    return [...filteredThreads].sort((a, b) => {
      const mailA = fromEmailThreadId(a.id)
      const mailB = fromEmailThreadId(b.id)
      if (sortMode === 'smart') {
        const scoreA = getMailImportanceScore(a, triageResults[mailA], Boolean(aiDrafts[mailA]))
        const scoreB = getMailImportanceScore(b, triageResults[mailB], Boolean(aiDrafts[mailB]))
        if (scoreB !== scoreA) return scoreB - scoreA
      }
      // time mode (or same score): explicit timestamp descending
      return getThreadTime(b) - getThreadTime(a)
    })
  }, [filteredThreads, triageResults, aiDrafts, sortMode])

  // Scroll to bottom when a new chat message is appended (after send or on thread load)
  const chatMsgCount = selectedThread?.providerType === 'chat' ? selectedThread.messages.length : 0
  useEffect(() => {
    const pane = messagePaneRef.current
    if (pane && chatMsgCount > 0) {
      pane.scrollTo({ top: pane.scrollHeight, behavior: 'smooth' })
    }
  }, [chatMsgCount])

  // Listen for AI draft insert events from the draft card buttons
  useEffect(() => {
    const handler = (e: Event) => {
      const { mailId, content } = (e as CustomEvent<{ mailId: string; content: string }>).detail
      const currentMailId = selectedThread?.providerType === 'email' ? fromEmailThreadId(selectedThread.id) : null
      if (currentMailId === mailId) {
        updateDraftContent(content)
      }
    }
    document.addEventListener('ai-draft-insert', handler)
    return () => document.removeEventListener('ai-draft-insert', handler)
  }, [selectedThread, updateDraftContent])

  const handleAttachFiles = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? [])
      files.forEach((file) => {
        const f = file as File & { path?: string }
        addDraftAttachment({
          filename: f.name,
          path: f.path ?? '',
          size: f.size,
          contentType: f.type || 'application/octet-stream',
        })
      })
      e.target.value = ''
    },
    [addDraftAttachment],
  )

  /** Handle image picked for Matrix chat (max 10 MB) */
  const handleChatImageFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file || !selectedThread?.id) return
      if (file.size > 10 * 1024 * 1024) {
        setUploadError('图片不能超过 10 MB')
        return
      }
      const roomId = selectedThread.id.replace(/^matrix:/, '')
      setIsUploading(true)
      setUploadError(null)
      try {
        await matrixSendImage(roomId, file)
      } catch (err) {
        setUploadError((err as Error).message ?? '图片上传失败')
      } finally {
        setIsUploading(false)
      }
    },
    [selectedThread, matrixSendImage],
  )

  /** Handle file picked for Matrix chat (max 25 MB) */
  const handleChatAttachFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file || !selectedThread?.id) return
      if (file.size > 25 * 1024 * 1024) {
        setUploadError('附件不能超过 25 MB')
        return
      }
      const roomId = selectedThread.id.replace(/^matrix:/, '')
      setIsUploading(true)
      setUploadError(null)
      try {
        await matrixSendFile(roomId, file)
      } catch (err) {
        setUploadError((err as Error).message ?? '附件上传失败')
      } finally {
        setIsUploading(false)
      }
    },
    [selectedThread, matrixSendFile],
  )

  const handleCreateDm = useCallback(async () => {
    const target = newDmInput.trim()
    if (!target) return
    setDmError(null)
    setCreatingDm(true)
    try {
      await createMatrixDirect(target)
      setNewDmInput('')
    } catch (err) {
      setDmError((err as Error).message ?? '无法创建私聊')
    } finally {
      setCreatingDm(false)
    }
  }, [newDmInput, createMatrixDirect])

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteConfirmThreadId) return
    const thread = filteredThreads.find((t) => t.id === deleteConfirmThreadId) ??
      (selectedThread?.id === deleteConfirmThreadId ? selectedThread : null)
    if (!thread) return
    const mailId = thread.id.replace(/^email:/, '')
    const folder: 'inbox' | 'sent' | 'trash' = thread.folder === 'trash' ? 'trash' : (thread.folder === 'sent') ? 'sent' : 'inbox'
    setIsDeleting(true)
    setDeleteError(null)
    try {
      await deleteMail(mailId, folder)
      setDeleteConfirmThreadId(null)
      selectThread(null)
    } catch (err) {
      setDeleteError((err as Error).message || '删除邮件失败')
    } finally {
      setIsDeleting(false)
    }
  }, [deleteConfirmThreadId, filteredThreads, selectedThread, deleteMail, selectThread])

  /* ---- Draft state helpers ---- */
  const isGenerating = currentDraft?.status === 'generating'
  const hasDraft = Boolean(currentDraft && currentDraft.status !== 'not_generated')
  const isSent = currentDraft?.status === 'sent'
  const isSending = currentDraft?.status === 'sending'
  const canSend = Boolean(selectedThread) && hasDraft && !isGenerating && !isSent && !isSending && Boolean(currentDraft?.content?.trim())

  /* ---- Main message to display in center ---- */
  const targetMessage: CommunicationMessage | null = selectedThread?.lastMessage ?? null

  const isSentFolderThread = selectedThread?.providerType === 'email' && selectedThread?.folder === 'sent'
  const isTrashFolderThread = selectedThread?.providerType === 'email' && selectedThread?.folder === 'trash'
  const selectedMailId = selectedThread?.providerType === 'email' ? fromEmailThreadId(selectedThread.id) : null
  const selectedTriage = selectedMailId ? triageResults[selectedMailId] : undefined
  const selectedTodos = selectedMailId ? mailTodos.filter((todo) => todo.sourceEmailId === selectedMailId) : []
  const isSystemNotice = selectedTriage?.skipReason === 'system_delivery_notice'
  const currentReplyKnowledgeIds = selectedMailId ? selectedReplyKnowledgeByMailId[selectedMailId]?.knowledgeIds ?? [] : []
  const currentReplyKnowledgeNotice = selectedMailId ? replyKnowledgeNoticeByMailId[selectedMailId] : undefined
  /** Available for developer inspection in DevTools; not surfaced in UI. */
  const _currentReplyKnowledgeTrace = selectedMailId ? replyKnowledgeTracesByMailId[selectedMailId] : undefined
  void _currentReplyKnowledgeTrace
  const currentReplyKnowledgeLabel = currentReplyKnowledgeIds.length === 0
    ? '知识库'
    : currentReplyKnowledgeIds.length === 1
      ? `知识库 · 1`
      : `知识库 · ${currentReplyKnowledgeIds.length}`
  const failedAnalysisPreview = currentBatchSummary?.failedItems
    .slice(0, 2)
    .map((item) => item.error)
    .filter(Boolean)
    .join('；')

  const handleForwardSelectedMail = useCallback(() => {
    if (!selectedThread || !targetMessage) return
    const forwardAttachments = targetMessage.attachments.flatMap((attachment) => {
      if (!attachment.tempPath) return []
      return [{
        fileName: attachment.filename,
        filePath: attachment.tempPath,
        mimeType: attachment.contentType,
        sizeBytes: attachment.size,
      }]
    })
    if (targetMessage.attachments.length > forwardAttachments.length) {
      setAttachmentNotice('部分原邮件附件没有本地缓存，未自动加入转发邮件。')
    }
    setPendingComposeTo(undefined)
    setPendingComposeDraft({
      subject: formatForwardSubject(selectedThread.subject),
      body: buildForwardBody(selectedThread, targetMessage),
      attachments: forwardAttachments,
      variant: 'forward',
    })
    setShowCompose(true)
  }, [selectedThread, targetMessage])

  const handleConfirmKnowledgeSelection = useCallback((mailId: string, knowledgeIds: string[]) => {
    const normalized = Array.from(new Set(knowledgeIds.map((id) => id.trim()).filter(Boolean)))
    setSelectedReplyKnowledgeByMailId((prev) => {
      if (normalized.length === 0) {
        const { [mailId]: _removed, ...rest } = prev
        return rest
      }
      return {
        ...prev,
        [mailId]: {
          mailId,
          knowledgeIds: normalized,
          updatedAt: new Date().toISOString(),
        },
      }
    })
    setReplyKnowledgeNoticeByMailId((prev) => {
      const { [mailId]: _removed, ...rest } = prev
      return rest
    })
    setKnowledgePickerMailId(null)
  }, [])

  const handleClearKnowledgeSelection = useCallback((mailId: string) => {
    setSelectedReplyKnowledgeByMailId((prev) => {
      const { [mailId]: _removed, ...rest } = prev
      return rest
    })
    setReplyKnowledgeNoticeByMailId((prev) => {
      const { [mailId]: _removed, ...rest } = prev
      return rest
    })
  }, [])

  const handleGenerate = useCallback(async () => {
    if (currentDraft?.userEdited) {
      const confirmed = window.confirm('当前草稿已被编辑，重新生成会覆盖现有内容，是否继续？')
      if (!confirmed) return
    }
    const selectedKnowledgeIds = selectedMailId ? selectedReplyKnowledgeByMailId[selectedMailId]?.knowledgeIds ?? [] : []
    const knowledgeQuery = selectedThread && targetMessage
      ? buildReplyKnowledgeQuery(buildMailItemFromMessage(selectedThread, targetMessage), selectedTriage)
      : ''

    if (selectedKnowledgeIds.length > 0 && selectedThread && targetMessage && selectedMailId) {
      setReplyKnowledgeNoticeByMailId((prev) => ({
        ...prev,
        [selectedMailId]: { variant: 'info', text: '正在检索所选知识库的相关内容...' },
      }))
      const snippets = await retrieveEmailReplyKnowledgeSnippets(
        selectedKnowledgeIds,
        departments,
        knowledgeQuery,
      )

      /* Set up pending trace context; prompt metadata is filled via callback */
      const traceContext = {
        mailId: selectedMailId,
        selectedKnowledgeIds,
        snippets,
        knowledgeContextLength: 0,
        promptHasKnowledgeContext: false,
        promptHasKnowledgeRequirement: false,
      }
      pendingKnowledgeTraceRef.current = traceContext

      if (snippets.length > 0) {
        const generationOptions = buildEmailReplyGenerationOptions(
          snippets,
          selectedTriage,
          mailCalendarCheck,
          selectedCalendarCandidateStart,
        )
        generationOptions.onPromptBuilt = (meta) => {
          if (pendingKnowledgeTraceRef.current?.mailId === selectedMailId) {
            pendingKnowledgeTraceRef.current = { ...pendingKnowledgeTraceRef.current, ...meta }
          }
        }
        regenerateDraft(true, generationOptions)
        setReplyKnowledgeNoticeByMailId((prev) => ({
          ...prev,
          [selectedMailId]: { variant: 'success', text: '已参考知识库内容生成回复。' },
        }))
        return
      }
      /* Snippets empty: fall through to normal generation */
      setReplyKnowledgeNoticeByMailId((prev) => ({
        ...prev,
        [selectedMailId]: { variant: 'info', text: '未找到高度相关的知识库内容，已按邮件正文生成回复。' },
      }))
    }

    if (selectedTriage?.timeIntent?.hasTimeRequirement) {
      const content = buildCalendarAwareReply(
        selectedTriage,
        mailCalendarCheck?.conflicts ?? [],
        mailCalendarCheck?.recommendedCandidate?.startTime,
      )
      updateDraftContent(content)
      setShowSuccessHint(true)
      return
    }
    regenerateDraft(true)
  }, [
    currentDraft?.userEdited,
    selectedMailId,
    selectedReplyKnowledgeByMailId,
    selectedThread,
    targetMessage,
    departments,
    selectedTriage,
    mailCalendarCheck,
    selectedCalendarCandidateStart,
    updateDraftContent,
    regenerateDraft,
  ])

  // Show brief success hint when draft transitions from generating → generated
  useEffect(() => {
    const newStatus = currentDraft?.status
    if (prevDraftStatusRef.current === 'generating' && newStatus === 'generated') {
      setShowSuccessHint(true)
      const t = setTimeout(() => setShowSuccessHint(false), 3000)
      prevDraftStatusRef.current = newStatus

      /* Finalize knowledge trace when draft generation completes */
      const pending = pendingKnowledgeTraceRef.current
      if (pending) {
        const draft = currentDraft?.content ?? ''
        const trace = buildEmailReplyKnowledgeTrace({
          mailId: pending.mailId,
          selectedKnowledgeIds: pending.selectedKnowledgeIds,
          snippets: pending.snippets,
          knowledgeContextLength: pending.knowledgeContextLength,
          promptHasKnowledgeContext: pending.promptHasKnowledgeContext,
          promptHasKnowledgeRequirement: pending.promptHasKnowledgeRequirement,
          draft,
        })
        setReplyKnowledgeTracesByMailId((prev) => ({ ...prev, [pending.mailId]: trace }))
        pendingKnowledgeTraceRef.current = null

        if (import.meta.env.DEV) {
          if (trace.status === 'retrieved_but_not_in_prompt' || trace.status === 'error') {
            console.warn('[email-reply-knowledge:trace-warning]', trace)
          } else {
            console.debug('[email-reply-knowledge:trace]', trace)
          }
        }

        /* Update notice based on definitive trace outcome for knowledge paths */
        if (trace.selectedKnowledgeIds.length > 0) {
          const noticeText =
            trace.status === 'likely_used' || trace.status === 'in_prompt_but_unclear_usage'
              ? '已参考所选知识库生成回复。'
              : trace.status === 'fallback_no_relevant_snippets'
              ? '未找到高度相关的知识库内容，已按邮件正文生成回复。'
              : trace.status === 'retrieved_but_not_in_prompt'
              ? '知识库参考未生效，已按邮件正文生成回复。'
              : null
          if (noticeText) {
            setReplyKnowledgeNoticeByMailId((prev) => ({
              ...prev,
              [pending.mailId]: { variant: trace.likelyUsedKnowledge ? 'success' : 'info', text: noticeText },
            }))
          }
        }
      }

      return () => clearTimeout(t)
    }
    prevDraftStatusRef.current = newStatus
  }, [currentDraft?.status, currentDraft?.content])

  // Reset per-email calendar state when switching emails
  useEffect(() => {
    setShowSuccessHint(false)
    setCalendarNotice(null)
  }, [selectedMailId])

  useEffect(() => {
    let cancelled = false
    async function runCalendarCheck() {
      if (!selectedTriage?.timeIntent?.hasTimeRequirement) {
        setMailCalendarCheck(null)
        return
      }
      const events = await listCalendarEvents()
      const target = buildConflictTarget(selectedTriage)
      const conflicts = target ? detectCalendarConflicts(target, events) : []
      const candidates = selectedTriage.timeIntent.candidateTimes ?? []
      const candidateConflicts = candidates.map((candidate) => {
        const candidateTarget = buildConflictTarget(selectedTriage, candidate)
        return {
          startTime: candidate.startTime,
          endTime: candidate.endTime,
          conflicts: candidateTarget ? detectCalendarConflicts(candidateTarget, events) : [],
        }
      })
      const recommendedCandidate = candidateConflicts.find((candidate) => candidate.conflicts.length === 0) ?? candidateConflicts[0]
      if (!cancelled) {
        setMailCalendarCheck({
          conflicts,
          candidateConflicts,
          recommendedCandidate: recommendedCandidate
            ? { startTime: recommendedCandidate.startTime, endTime: recommendedCandidate.endTime }
            : undefined,
        })
        setSelectedCalendarCandidateStart(recommendedCandidate?.startTime ?? null)
      }
    }
    void runCalendarCheck()
    return () => { cancelled = true }
  }, [selectedTriage, selectedMailId])

  /* ---- All incoming attachments from the selected thread ---- */
  const allIncomingAttachments = useMemo(() => {
    if (!selectedThread) return []
    return selectedThread.messages.flatMap((m) => (m.isIncoming ? m.attachments : []))
  }, [selectedThread])

  /* ---- Isolation guard: only show detail if selectedThread is in current displayedThreads ---- */
  const isSelectedThreadValid = !selectedThread || displayedThreads.some((t) => t.id === selectedThread.id)

  const handleSummaryMailClick = useCallback((messageId: string) => {
    setEmailAnalysisSummaryCollapsed(true)
    setActiveFilter('email')
    setHighlightedBatchMailIds(new Set([messageId]))
    selectThread(toEmailThreadId(messageId))
  }, [selectThread, setActiveFilter])

  const handleSummaryTopicClick = useCallback((topic: EmailContentTopicSummary) => {
    setEmailAnalysisSummaryCollapsed(true)
    setActiveFilter('email')
    setHighlightedBatchMailIds(new Set(topic.relatedMessageIds))
    const firstMessageId = topic.relatedMessageIds[0]
    if (firstMessageId) selectThread(toEmailThreadId(firstMessageId))
  }, [selectThread, setActiveFilter])

  const handleJoinCalendar = useCallback(async () => {
    if (!selectedThread || !targetMessage || !selectedTriage?.timeIntent) return
    const mail = buildMailItemFromMessage(selectedThread, targetMessage)
    // Prevent duplicate: if an active event for this message already exists, skip creation
    const existingEvents = await listCalendarEvents()
    const duplicate = existingEvents.find((event) =>
      event.sourceMessageId === mail.id &&
      event.status !== 'ignored' &&
      event.status !== 'cancelled',
    )
    if (duplicate) {
      setCalendarNotice('该邮件已有对应日程，请在日程管理中查看。')
      return
    }
    const candidate = selectedCalendarCandidateStart
      ? selectedTriage.timeIntent.candidateTimes?.find((item) => item.startTime === selectedCalendarCandidateStart)
      : mailCalendarCheck?.recommendedCandidate
    const created = await createCalendarEventFromEmail(mail, selectedTriage.timeIntent, {
      source: 'email_user_confirmed',
      status: 'confirmed',
      needsUserConfirmation: false,
      candidateTime: candidate,
    })
    setCalendarNotice(created
      ? created.conflictEventIds?.length
        ? `已加入日程，并检测到 ${created.conflictEventIds.length} 个时间冲突。`
        : '已加入日程。'
      : '当前时间信息不完整，请手动创建日程。')
  }, [selectedThread, targetMessage, selectedTriage, mailCalendarCheck, selectedCalendarCandidateStart])

  const handleUseCalendarReply = useCallback((forceConflictReply = false) => {
    if (!selectedTriage?.timeIntent) return
    const conflicts = forceConflictReply && (mailCalendarCheck?.conflicts.length ?? 0) === 0
      ? [{ eventId: 'reserved', title: '', startTime: selectedTriage.timeIntent.startTime || '', status: 'confirmed' as const, conflictLevel: 'hard' as const }]
      : mailCalendarCheck?.conflicts ?? []
    updateDraftContent(buildCalendarAwareReply(selectedTriage, conflicts, selectedCalendarCandidateStart ?? mailCalendarCheck?.recommendedCandidate?.startTime))
    setShowSuccessHint(true)
  }, [selectedTriage, mailCalendarCheck, selectedCalendarCandidateStart, updateDraftContent])

  const handleIgnoreCalendarIntent = useCallback(() => {
    if (selectedMailId) {
      setIgnoredCalendarMailIds((prev) => new Set([...prev, selectedMailId]))
    }
    setCalendarNotice(null)
  }, [selectedMailId])

  // ── Auto-start workflow ───────────────────────────────────────────────────────

  // Restore already-initiated mail IDs from localStorage so page refresh won't re-trigger
  useEffect(() => {
    try {
      const stored = JSON.parse(
        localStorage.getItem('aioffice.autoWorkflowStarted') ?? '[]',
      ) as string[]
      stored.forEach((id) => autoStartInitiatedRef.current.add(id))
    } catch {
      // ignore parse errors
    }
  }, [])

  // Watch triageResults: whenever a new successful triage appears for an eligible mail, fire auto-start
  useEffect(() => {
    for (const [mailId, triage] of Object.entries(triageResults)) {
      if (!triage || triage.status !== 'success') continue
      if (workflowProcessIds[mailId]) continue                  // already started
      if (autoStartInitiatedRef.current.has(mailId)) continue   // already initiated (ref is sync-safe)

      const thread = threads.find((t) => {
        const tid = t.providerType === 'email' ? fromEmailThreadId(t.id) : t.id
        return tid === mailId
      })
      if (!shouldAutoStartWorkflow(triage, thread?.folder)) continue

      // Mark as initiated synchronously (ref) before the async call to prevent double-fire
      autoStartInitiatedRef.current.add(mailId)
      try {
        const stored = JSON.parse(
          localStorage.getItem('aioffice.autoWorkflowStarted') ?? '[]',
        ) as string[]
        localStorage.setItem(
          'aioffice.autoWorkflowStarted',
          JSON.stringify([...new Set([...stored, mailId])]),
        )
      } catch {
        // ignore storage errors
      }

      const msg = thread?.messages?.find((m) => m.isIncoming) ?? thread?.lastMessage
      const scenario = detectMatterScenario(triage, thread?.subject ?? '', '')
      const matter = buildEmailMatter(
        mailId,
        thread?.id ?? mailId,
        triage,
        thread?.subject ?? '',
        msg?.from ?? msg?.fromName ?? 'unknown',
        scenario,
      )

      // ── Agent-autonomous path (e.g. campus card replacement) ─────────────────
      if (matter?.workflowPattern === 'agent_autonomous') {
        const senderEmail = msg?.from ?? msg?.fromName ?? ''
        handleCampusCardReplacementMatter({
          matter,
          senderEmail,
          emailBody: thread?.messages?.map((m) => m.text ?? '').join(' ') ?? '',
          attachmentNames: [],
        })
          .then((agentResult) => {
            setAgentResults((prev) => ({ ...prev, [mailId]: agentResult }))
            setAutoStartedByAi((prev) => ({ ...prev, [mailId]: true }))
            // Only escalate to Flowable when agent says human review is needed
            if (agentResult.status === 'human_review_required') {
              const input = buildAutoWorkflowInput(
                mailId,
                thread?.id ?? mailId,
                triage,
                thread?.subject ?? '(无主题)',
                senderEmail || 'unknown',
                currentUserId ?? 'demo-user',
                activeWorkspacePath ?? 'default',
                matter,
              )
              setWorkflowStartStates((prev) => ({ ...prev, [mailId]: 'loading' }))
              startEmailWorkflow(input)
                .then((result) => {
                  setWorkflowProcessIds((prev) => ({ ...prev, [mailId]: result.processInstanceId }))
                  setWorkflowStartStates((prev) => ({ ...prev, [mailId]: 'done' }))
                })
                .catch((err) => {
                  setWorkflowStartStates((prev) => ({ ...prev, [mailId]: 'error' }))
                  setWorkflowStartErrors((prev) => ({
                    ...prev,
                    [mailId]: err instanceof Error ? err.message : String(err),
                  }))
                })
            }
          })
          .catch((err) => {
            setAgentResults((prev) => ({
              ...prev,
              [mailId]: {
                status: 'human_review_required',
                message: `Agent 异常：${err instanceof Error ? err.message : String(err)}，转人工复核。`,
              },
            }))
          })
        continue
      }

      // ── Standard Flowable path ────────────────────────────────────────────────
      const input = buildAutoWorkflowInput(
        mailId,
        thread?.id ?? mailId,
        triage,
        thread?.subject ?? '(无主题)',
        msg?.from ?? msg?.fromName ?? 'unknown',
        currentUserId ?? 'demo-user',
        activeWorkspacePath ?? 'default',
        matter,
      )

      setWorkflowStartStates((prev) => ({ ...prev, [mailId]: 'loading' }))
      setWorkflowStartErrors((prev) => { const n = { ...prev }; delete n[mailId]; return n })

      startEmailWorkflow(input)
        .then((result) => {
          setWorkflowProcessIds((prev) => ({ ...prev, [mailId]: result.processInstanceId }))
          setWorkflowStartStates((prev) => ({ ...prev, [mailId]: 'done' }))
          setAutoStartedByAi((prev) => ({ ...prev, [mailId]: true }))
        })
        .catch((err) => {
          setWorkflowStartStates((prev) => ({ ...prev, [mailId]: 'error' }))
          setWorkflowStartErrors((prev) => ({
            ...prev,
            [mailId]: err instanceof Error ? err.message : String(err),
          }))
        })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triageResults, threads])

  const handleStartWorkflow = useCallback(async () => {
    if (!selectedThread || !selectedMailId) return
    const msg = targetMessage
    const triage = selectedTriage

    const priority: 'urgent' | 'important' | 'normal' =
      triage?.urgency === 'urgent' ? 'urgent'
      : (triage?.urgency === 'soon' || triage?.priority === 'high') ? 'important'
      : 'normal'

    const scenario = triage
      ? detectMatterScenario(triage, selectedThread.subject || '', msg?.body?.slice(0, 300) ?? '')
      : 'unknown' as const
    const matter = triage
      ? buildEmailMatter(selectedMailId, selectedThread.id, triage, selectedThread.subject || '', msg?.from || msg?.fromName || 'unknown', scenario)
      : null

    const input = {
      sourceType: 'email' as const,
      emailId: selectedMailId,
      threadId: selectedThread.id,
      subject: selectedThread.subject || '(无主题)',
      sender: msg?.from || msg?.fromName || 'unknown',
      requesterId: currentUserId || 'demo-user',
      assignee: 'approver-001',
      priority,
      category: matter ? matter.scenarioType : (triage?.emailCategory || triage?.category || 'email_approval'),
      aiSummary: matter ? serializeMatterToSummary(matter) : (triage?.summary || (msg?.body?.slice(0, 200) ?? '')),
      attachmentIds: (msg?.attachments ?? []).map((a) => a.id),
      workspaceId: activeWorkspacePath || 'default',
    }

    setWorkflowStartStates((prev) => ({ ...prev, [selectedMailId]: 'loading' }))
    setWorkflowStartErrors((prev) => { const n = { ...prev }; delete n[selectedMailId]; return n })

    try {
      const result = await startEmailWorkflow(input)
      setWorkflowProcessIds((prev) => ({ ...prev, [selectedMailId]: result.processInstanceId }))
      setWorkflowStartStates((prev) => ({ ...prev, [selectedMailId]: 'done' }))
    } catch (err) {
      setWorkflowStartStates((prev) => ({ ...prev, [selectedMailId]: 'error' }))
      setWorkflowStartErrors((prev) => ({
        ...prev,
        [selectedMailId]: err instanceof Error ? err.message : String(err),
      }))
    }
  }, [selectedThread, selectedMailId, targetMessage, selectedTriage, currentUserId, activeWorkspacePath])

  const handleLoadWorkflowTasks = useCallback(async () => {
    setWorkflowTasksLoading(true)
    setWorkflowTasksError(null)
    try {
      const tasks = await getMyWorkflowTasks('approver-001')
      setWorkflowTasks(tasks)
    } catch (err) {
      setWorkflowTasksError(err instanceof Error ? err.message : String(err))
    } finally {
      setWorkflowTasksLoading(false)
    }
  }, [])

  const handleOpenWorkflowPanel = useCallback(() => {
    setShowWorkflowPanel(true)
    void handleLoadWorkflowTasks()
  }, [handleLoadWorkflowTasks])

  const handleCompleteTask = useCallback(async (taskId: string, decision: 'approve' | 'reject') => {
    setCompletingTaskId(taskId)
    try {
      await completeWorkflowTask(taskId, {
        decision,
        comment: decision === 'approve' ? '同意' : '不同意，请补充材料',
        operatorId: 'approver-001',
      })
      await handleLoadWorkflowTasks()
    } catch (err) {
      setWorkflowTasksError(err instanceof Error ? err.message : String(err))
    } finally {
      setCompletingTaskId(null)
    }
  }, [handleLoadWorkflowTasks])

  const emailAnalysisSummaryExpanded = Boolean(currentBatchSummary && !emailAnalysisSummaryCollapsed)
  const completedAnalysisCount = analysisProgress.done + analysisProgress.cached + analysisProgress.failed
  const analysisCompleteByProgress = analysisProgress.total > 0 && completedAnalysisCount >= analysisProgress.total && analysisProgress.running === 0
  const analysisCompletedWhileBusy = analysisCompleteByProgress && (isAnalyzingEmails || isWorkerRunning || analysisStatus === 'running')
  const analysisButtonBusy = (isAnalyzingEmails || isWorkerRunning) && !analysisCompleteByProgress

  return (
    <Shell>
      {/* ---- LEFT PANEL ---- */}
      <MainPanels>
      <LeftPanel>
        <LeftHeader>
          {/* Row 1: Title + icon buttons */}
          <LeftHeaderTitleRow>
            <LeftTitle>
              邮件工作台
              {unreadCount > 0 && <UnreadBadge>{unreadCount}</UnreadBadge>}
            </LeftTitle>
            <HeaderActions>
              <IconBtn
                title="刷新"
                onClick={activeFilter === 'sent' ? refreshSent : activeFilter === 'trash' ? refreshTrash : refreshMails}
                disabled={isFetchingMails}
              >
                {isFetchingMails ? '⟳' : '🔄'}
              </IconBtn>
              <IconBtn title="邮箱设置" onClick={() => setShowAccountModal(true)}>
                ⚙️
              </IconBtn>
            </HeaderActions>
          </LeftHeaderTitleRow>

          {/* Row 2: Action buttons */}
          <HeaderActionRow>
            {isRealEmailMode && (
              <ComposeBtn type="button" onClick={() => { setPendingComposeTo(undefined); setPendingComposeDraft(undefined); setShowCompose(true) }}>
                ✉ 新建邮件
              </ComposeBtn>
            )}
            <AiComposeBtn
              type="button"
              title="分析收件箱邮件，自动分类并为重要邮件生成预回复草稿"
              onClick={triggerAnalysis}
              disabled={analysisButtonBusy}
            >
              {analysisButtonBusy
                ? `🤖 正在分析 ${completedAnalysisCount}/${analysisProgress.total}`
                : analysisStatus === 'done'
                  || analysisCompletedWhileBusy
                ? '✅ 分析完成'
                : analysisStatus === 'failed'
                ? '⚠ 分析失败'
                : '✨ AI邮件分析'}
            </AiComposeBtn>
            <WorkflowInlineBtn $variant="neutral" onClick={handleOpenWorkflowPanel} title="查看流程待办">
              📋 流程待办
            </WorkflowInlineBtn>
          </HeaderActionRow>
        </LeftHeader>

        <NavBar>
          {NAV_TABS.map(({ key, label }) => (
            <NavTab key={key} $active={activeFilter === key} onClick={() => setActiveFilter(key)}>
              {label}
            </NavTab>
          ))}
        </NavBar>

        <SubFilterBar>
          {SUB_FILTERS.map(({ key, label }) => (
            <SubFilterChip key={key} $active={activeFilter === key} onClick={() => setActiveFilter(key)}>
              {label}
            </SubFilterChip>
          ))}
        </SubFilterBar>

        <StatusStrip>
          <StatusLabel>
            <StatusDot $ok={isRealEmailMode} $warn={!isRealEmailMode} />
            {isRealEmailMode ? `邮箱: ${emailAccountConfig?.user || emailAccountConfig?.email || '已连接'}` : '未连接邮箱'}
          </StatusLabel>
        </StatusStrip>

        {isAnalyzingEmails && (
          <AnalysisBanner>
            <AnalysisSpinner>🤖</AnalysisSpinner>
            正在分析 {analysisProgress.done + analysisProgress.cached + analysisProgress.failed}/{analysisProgress.total}
          </AnalysisBanner>
        )}
        {analysisStatus === 'failed' && analysisProgress.failed > 0 && (
          <AnalysisBanner style={{ background: '#fff5f5', color: '#c53030', borderColor: '#feb2b2' }}>
            <div>⚠ 邮件分析部分失败（{analysisProgress.failed} 封），已完成 {analysisProgress.done + analysisProgress.cached} 封</div>
            {failedAnalysisPreview && <div style={{ fontSize: 12, marginTop: 4 }}>原因：{failedAnalysisPreview}</div>}
          </AnalysisBanner>
        )}

        <ThreadList>
          {fetchError && activeFilter !== 'sent' && activeFilter !== 'trash' && (
            <EmptyThreadList style={{ color: '#c53030' }}>⚠ 收件箱加载失败：{fetchError}</EmptyThreadList>
          )}
          {displayedThreads.length === 0 ? (
            <EmptyThreadList>
              {activeFilter === 'trash' ? '回收站为空' : activeFilter === 'sent' ? '暂无已发送邮件' : '暂无邮件'}
            </EmptyThreadList>
          ) : (
            displayedThreads.map((thread) => {
              const mailId = fromEmailThreadId(thread.id)
              const triage = triageResults[mailId]
              const actionPlan = triage?.status === 'success' ? resolveActionPlan(triage) : null
              const calendarTag = calendarTagForTriage(triage)
              return (
                <ThreadCard
                  key={thread.id}
                  $active={thread.id === selectedThreadId}
                  $unread={thread.unread}
                  $highlighted={highlightedBatchMailIds.has(mailId)}
                  onClick={() => { selectThread(thread.id); setAttachmentNotice(null); setEmailAnalysisSummaryCollapsed(true) }}
                >
                  <ThreadSubject $unread={thread.unread}>
                    {thread.unread && <UnreadDot />}
                    <ThreadSubjectText title={thread.subject}>
                      {thread.folder === 'trash' ? '🗑 ' : thread.folder === 'sent' ? '↗ ' : '📧 '}
                      {thread.subject}
                    </ThreadSubjectText>
                    {thread.hasAttachments && <span title="含附件" style={{ fontSize: 12 }}>📎</span>}
                  </ThreadSubject>
                  <ThreadMeta>
                    <span>{thread.participantNames[0] || thread.participants[0]}</span>
                    <span style={{ marginLeft: 'auto' }}>{thread.lastMessage ? formatTime(thread.lastMessage.timestamp) : ''}</span>
                  </ThreadMeta>
                  <ThreadSnippet>{thread.lastMessage?.body.slice(0, 72).replace(/\n/g, ' ')}</ThreadSnippet>
                  {thread.providerType === 'email' && (
                    <ThreadDeleteBtn
                      className="thread-delete-btn"
                      title="删除邮件"
                      onClick={(e) => {
                        e.stopPropagation()
                        selectThread(thread.id)
                        setAttachmentNotice(null)
                        setEmailAnalysisSummaryCollapsed(true)
                        setDeleteConfirmThreadId(thread.id)
                      }}
                    >
                      🗑
                    </ThreadDeleteBtn>
                  )}
                  <AiTriageRow>
                    {thread.folder === 'trash' && <WorkTagBadge $variant="trash">可恢复</WorkTagBadge>}
                    {triage?.status === 'skipped' ? (
                      <WorkTagBadge $variant="attach">📎 附件</WorkTagBadge>
                    ) : triage?.status === 'success' ? (
                      <>
                        <AiCategoryTag $cat={actionPlan?.intentType || triage.emailCategory || triage.category}>
                          {intentTypeLabel(actionPlan?.intentType)}
                        </AiCategoryTag>
                        {(triage.importance || triage.priority) === 'high' && <WorkTagBadge $variant="important">重要</WorkTagBadge>}
                        {(triage.urgency === 'urgent' || triage.urgency === 'soon') && (
                          <WorkTagBadge $variant="edit">{triage.urgency === 'urgent' ? '紧急' : '尽快'}</WorkTagBadge>
                        )}
                        {calendarTag && <WorkTagBadge $variant={calendarTag.variant}>{calendarTag.label}</WorkTagBadge>}
                      </>
                    ) : (
                      <AiStatusBadge
                        $status={triage?.status || 'none'}
                        title={triage?.status === 'failed' ? (triage.errorMessage || '分析失败') : undefined}
                      >
                        {triage?.status === 'running'
                          ? '分析中'
                          : triage?.status === 'failed'
                            ? '分析失败'
                            : triage?.status === 'pending'
                              ? '待分析'
                              : '未分析'}
                      </AiStatusBadge>
                    )}
                  </AiTriageRow>
                </ThreadCard>
              )
            })
          )}
        </ThreadList>
      </LeftPanel>

      {/* ---- DETAIL PANE ---- */}
      <DetailPane>
        {currentBatchSummary && (
          <EmailAnalysisSummaryPanel
            summary={currentBatchSummary}
            collapsed={emailAnalysisSummaryCollapsed}
            onCollapsedChange={setEmailAnalysisSummaryCollapsed}
            onMailClick={handleSummaryMailClick}
            onTopicClick={handleSummaryTopicClick}
          />
        )}
        {!emailAnalysisSummaryExpanded && (selectedThread && targetMessage && isSelectedThreadValid ? (
          <>
            <MessagePane ref={messagePaneRef}>
              {isTrashFolderThread && <RecoverableMailBanner>🗑 此邮件位于可恢复区域</RecoverableMailBanner>}
              {attachmentNotice && <AttachOpenBanner>{attachmentNotice}</AttachOpenBanner>}
              <ThreadHeader>
                <ThreadHeaderTop>
                  <div style={{ minWidth: 0 }}>
                    <ThreadHeaderSubject>
                      {selectedThread.subject}
                    </ThreadHeaderSubject>
                    <ThreadHeaderMeta>
                      <span>发件人：{targetMessage.fromName || targetMessage.from}</span>
                      <span>收件人：{targetMessage.toName || targetMessage.to || ''}</span>
                      <span>{formatTime(targetMessage.timestamp)}</span>
                    </ThreadHeaderMeta>
                  </div>
                  <ThreadHeaderActions>
                    <Btn $variant="muted" onClick={handleForwardSelectedMail}>转发</Btn>
                    {!isTrashFolderThread && selectedThread.providerType === 'email' && (
                      <Btn $variant="danger" onClick={() => setDeleteConfirmThreadId(selectedThread.id)}>
                        移入回收站
                      </Btn>
                    )}
                  </ThreadHeaderActions>
                </ThreadHeaderTop>
              </ThreadHeader>

              <EmailBodyView message={targetMessage} />

              {selectedTriage?.status === 'failed' && (
                <AiRecommendCard $risk>
                  <AiRecommendTitle>⚠ AI 分析失败</AiRecommendTitle>
                  <AiRecommendValue>{selectedTriage.errorMessage || '分析失败，请稍后重试。'}</AiRecommendValue>
                  {selectedMailId && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <Btn onClick={() => enqueueMail(selectedMailId)}>重新分析</Btn>
                    </div>
                  )}
                </AiRecommendCard>
              )}

              <IncomingAttachments
                attachments={allIncomingAttachments}
                messageId={selectedMailId || undefined}
                subject={selectedThread.subject}
                fromName={targetMessage.fromName}
                fromEmail={targetMessage.from}
                activeWorkspacePath={activeWorkspacePath}
                onSavedToWorkspace={(result) => {
                  if (!result.ok) {
                    setAttachmentNotice(result.error.message)
                    return
                  }
                  void refreshTree().catch(() => undefined)
                  setAttachmentNotice(result.openTarget === 'document'
                    ? `附件已保存并可在文稿工作台打开：${result.fileName}`
                    : `附件已保存到工作区：${result.fileName}`)
                  if (currentUserId) {
                    logActivity(currentUserId, 'mail', 'incoming_attachment_saved', {
                      workspaceId: activeWorkspacePath ?? undefined,
                      title: result.fileName,
                      summary: `保存邮件附件到工作区：${result.fileName}`,
                      metadata: { messageId: selectedMailId, openTarget: result.openTarget },
                    })
                  }
                }}
              />

              {selectedTriage?.status === 'success' && (() => {
                const actionPlan = resolveActionPlan(selectedTriage)
                return (
                  <AiRecommendCard $risk={actionPlan.intentType === 'spam' || selectedTriage.category === 'risk'}>
                    <AiRecommendTitle>🤖 AI 分析与处理方案</AiRecommendTitle>
                    <AiInfoBlock>
                      <AiInfoHead>邮件摘要</AiInfoHead>
                      <AiInfoBody>{selectedTriage.summary || actionPlan.brief || '（无摘要）'}</AiInfoBody>
                    </AiInfoBlock>
                    {renderKeyInfo(actionPlan, selectedTriage)}
                    <AiInfoBlock>
                      <AiInfoHead>处理策略</AiInfoHead>
                      <AiInfoBody>{buildStrategyText(actionPlan, selectedTriage)}</AiInfoBody>
                    </AiInfoBlock>
                    {selectedTriage.riskFlags?.length ? (
                      <AiInfoBlock>
                        <AiInfoHead>⚠ 风险提示</AiInfoHead>
                        <AiInfoBody>{selectedTriage.riskFlags.join('；')}</AiInfoBody>
                      </AiInfoBlock>
                    ) : null}
                    {(selectedTriage.emailCategory === 'spam' || selectedTriage.emailCategory === 'promotion') && !isTrashFolderThread && (
                      <Btn $variant="danger" style={{ marginTop: 10 }} onClick={() => setDeleteConfirmThreadId(selectedThread.id)}>
                        移入可恢复区域
                      </Btn>
                    )}
                    {/* ── 发起流程 / AI 自动发起状态 / Agent 自动办理状态 ── */}
                    {selectedMailId && (() => {
                      const wfState = workflowStartStates[selectedMailId] ?? 'idle'
                      const wfError = workflowStartErrors[selectedMailId]
                      const processId = workflowProcessIds[selectedMailId]
                      const isAutoStarted = autoStartedByAi[selectedMailId]
                      const autoInitiated = autoStartInitiatedRef.current.has(selectedMailId)
                      const agentResult = agentResults[selectedMailId]

                      // Agent-autonomous result display
                      if (agentResult) {
                        const ev = agentResult.evaluation
                        const decisionLabel = ev?.decision === 'auto_complete'
                          ? '✅ 自动办理'
                          : ev?.decision === 'request_missing_material'
                            ? '📋 需要补材料'
                            : '⚠ 需要人工复核'
                        const decisionColor = ev?.decision === 'auto_complete'
                          ? '#276749'
                          : ev?.decision === 'request_missing_material'
                            ? '#c05621'
                            : '#c53030'
                        return (
                          <div style={{ marginTop: 10 }}>
                            {agentResult.status === 'auto_completed' && (
                              <WorkflowStatusMsg $variant="success">
                                🤖 {agentResult.message}
                              </WorkflowStatusMsg>
                            )}
                            {agentResult.status === 'waiting_material' && (
                              <WorkflowStatusMsg $variant="error">
                                📋 {agentResult.message}
                              </WorkflowStatusMsg>
                            )}
                            {agentResult.status === 'human_review_required' && (
                              <>
                                <WorkflowStatusMsg $variant="error">
                                  ⚠ {agentResult.message}
                                </WorkflowStatusMsg>
                                {/* Flowable status for escalated human review */}
                                {wfState === 'loading' && (
                                  <WorkflowStatusMsg $variant="success" style={{ marginTop: 4 }}>
                                    ⏳ 已提交人工复核流程…
                                  </WorkflowStatusMsg>
                                )}
                                {wfState === 'done' && processId && (
                                  <WorkflowStatusMsg $variant="success" style={{ marginTop: 4 }}>
                                    🔄 人工复核流程已创建：{processId}
                                  </WorkflowStatusMsg>
                                )}
                              </>
                            )}
                            {/* ── CUHKSZ Agent 判断报告 ── */}
                            {ev && (
                              <div style={{
                                marginTop: 10,
                                border: '1px solid #e2e8f0',
                                borderRadius: 8,
                                padding: '10px 14px',
                                background: '#fafafa',
                                fontSize: 12,
                              }}>
                                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: '#1a202c' }}>
                                  🏫 CUHKSZ Agent 判断报告
                                </div>
                                {/* Decision + confidence */}
                                <div style={{ display: 'flex', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                                  <span style={{ fontWeight: 700, color: decisionColor }}>{decisionLabel}</span>
                                  <span style={{ color: '#718096' }}>置信度：{Math.round((ev.confidence ?? 0) * 100)}%</span>
                                </div>
                                {/* Extracted fields */}
                                {ev.extractedFields && (
                                  <div style={{ marginBottom: 8 }}>
                                    <div style={{ fontWeight: 600, color: '#4a5568', marginBottom: 3 }}>已识别信息</div>
                                    <div style={{ paddingLeft: 10, color: '#4a5568', lineHeight: 1.7 }}>
                                      <div>姓名：{ev.extractedFields.applicantName ?? <span style={{ color: '#a0aec0' }}>未识别</span>}</div>
                                      <div>学号：{ev.extractedFields.studentId ?? <span style={{ color: '#a0aec0' }}>未识别</span>}</div>
                                      <div>学校邮箱：{ev.extractedFields.schoolEmail ?? <span style={{ color: '#a0aec0' }}>未识别</span>}</div>
                                      <div>补办原因：{ev.extractedFields.reason ?? <span style={{ color: '#a0aec0' }}>未识别</span>}</div>
                                    </div>
                                  </div>
                                )}
                                {/* Material check */}
                                <div style={{ marginBottom: 8 }}>
                                  <div style={{ fontWeight: 600, color: '#4a5568', marginBottom: 3 }}>材料检查</div>
                                  <div style={{ paddingLeft: 10, lineHeight: 1.7 }}>
                                    <div style={{ color: '#276749' }}>
                                      已提供：{ev.policyChecks.providedMaterials.length > 0 ? ev.policyChecks.providedMaterials.join('、') : <span style={{ color: '#a0aec0' }}>无</span>}
                                    </div>
                                    <div style={{ color: ev.policyChecks.missingMaterials.length > 0 ? '#c53030' : '#276749' }}>
                                      缺失：{ev.policyChecks.missingMaterials.length > 0 ? ev.policyChecks.missingMaterials.join('、') : '无'}
                                    </div>
                                  </div>
                                </div>
                                {/* System checks */}
                                {ev.systemCheckDetails && ev.systemCheckDetails.length > 0 && (
                                  <div style={{ marginBottom: 8 }}>
                                    <div style={{ fontWeight: 600, color: '#4a5568', marginBottom: 3 }}>系统检查</div>
                                    <div style={{ paddingLeft: 10 }}>
                                      {ev.systemCheckDetails.map((chk, i) => (
                                        <div key={i} style={{ display: 'flex', gap: 6, lineHeight: 1.7, alignItems: 'flex-start' }}>
                                          <span style={{ color: chk.status === 'passed' ? '#276749' : chk.status === 'failed' ? '#c53030' : '#a0aec0', flexShrink: 0 }}>
                                            {chk.status === 'passed' ? '✅' : chk.status === 'failed' ? '❌' : '⚪'}
                                          </span>
                                          <span style={{ color: '#4a5568' }}><strong>{chk.name}</strong>：{chk.detail}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {/* Explanation */}
                                <div style={{ marginBottom: 6 }}>
                                  <span style={{ fontWeight: 600, color: '#4a5568' }}>判断依据：</span>
                                  <span style={{ color: '#4a5568' }}>{ev.explanation}</span>
                                </div>
                                {/* Next action */}
                                <div>
                                  <span style={{ fontWeight: 600, color: '#4a5568' }}>下一步：</span>
                                  <span style={{ color: '#2b6cb0' }}>{ev.nextAction}</span>
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      }

                      return (
                        <div style={{ marginTop: 10 }}>
                          {/* Loading: AI auto-start in progress */}
                          {wfState === 'loading' && (
                            <WorkflowStatusMsg $variant="success">
                              ⏳ AI 正在自动发起流程…
                            </WorkflowStatusMsg>
                          )}
                          {/* Done: show different message for AI vs manual */}
                          {wfState === 'done' && (
                            <WorkflowStatusMsg $variant="success">
                              {isAutoStarted
                                ? `🤖 已由 AI 自动发起流程：${processId}`
                                : `✅ 已发起流程：${processId}`}
                            </WorkflowStatusMsg>
                          )}
                          {/* Error: show message and keep manual button as fallback */}
                          {wfState === 'error' && (
                            <>
                              <WorkflowStatusMsg $variant="error">
                                ⚠ {autoInitiated ? `自动发起流程失败：${wfError}` : wfError}
                              </WorkflowStatusMsg>
                              <WorkflowInlineBtn
                                onClick={handleStartWorkflow}
                                style={{ marginTop: 6 }}
                              >
                                📋 手动发起流程
                              </WorkflowInlineBtn>
                            </>
                          )}
                          {/* Idle + not auto-initiated → show manual button */}
                          {wfState === 'idle' && !autoInitiated && (
                            <WorkflowInlineBtn onClick={handleStartWorkflow}>
                              📋 发起流程
                            </WorkflowInlineBtn>
                          )}
                        </div>
                      )
                    })()}
                  </AiRecommendCard>
                )
              })()}

              {selectedTriage?.timeIntent?.hasTimeRequirement && !ignoredCalendarMailIds.has(selectedMailId ?? '') && (
                <AiRecommendCard $risk={(mailCalendarCheck?.conflicts.length ?? 0) > 0 || (selectedTriage.calendarConflictCount ?? 0) > 0}>
                  <AiRecommendTitle>
                    {(mailCalendarCheck?.conflicts.length ?? 0) > 0 || (selectedTriage.calendarConflictCount ?? 0) > 0
                      ? '📅 检测到时间冲突'
                      : selectedTriage.timeIntent.type === 'candidate_times'
                        ? '📅 检测到多个候选时间'
                        : selectedTriage.timeIntent.type === 'deadline'
                          ? '📅 检测到截止事项'
                          : selectedTriage.timeIntent.type === 'follow_up'
                            ? '📅 检测到日程意图，但时间不完整'
                            : '📅 检测到日程安排'}
                  </AiRecommendTitle>
                  <AiInfoBlock>
                    <AiInfoHead>事项</AiInfoHead>
                    <AiInfoBody>{timeIntentTitle(selectedTriage)}</AiInfoBody>
                  </AiInfoBlock>
                  {selectedTriage.timeIntent.type === 'candidate_times' ? (
                    <AiInfoBlock>
                      <AiInfoHead>候选时间</AiInfoHead>
                      <AiInfoBody>
                        {mailCalendarCheck
                          ? mailCalendarCheck.candidateConflicts.map((candidate) => {
                              const recommended = candidate.startTime === mailCalendarCheck.recommendedCandidate?.startTime
                              return (
                                <label key={candidate.startTime} style={{ display: 'block', cursor: 'pointer', marginBottom: 4 }}>
                                  <input
                                    type="radio"
                                    name="calendar-candidate-time"
                                    checked={selectedCalendarCandidateStart === candidate.startTime}
                                    onChange={() => setSelectedCalendarCandidateStart(candidate.startTime)}
                                  />{' '}
                                  {formatCalendarTime(candidate.startTime)}
                                  {candidate.conflicts.length > 0 ? ' · 有冲突' : recommended ? ' · 推荐 · 无冲突' : ' · 无冲突'}
                                </label>
                              )
                            })
                          : (selectedTriage.timeIntent.candidateTimes ?? []).map((candidate) => (
                              <label key={candidate.startTime} style={{ display: 'block', cursor: 'pointer', marginBottom: 4 }}>
                                <input
                                  type="radio"
                                  name="calendar-candidate-time"
                                  checked={selectedCalendarCandidateStart === candidate.startTime}
                                  onChange={() => setSelectedCalendarCandidateStart(candidate.startTime)}
                                />{' '}
                                {formatCalendarTime(candidate.startTime)}
                              </label>
                            ))
                        }
                      </AiInfoBody>
                    </AiInfoBlock>
                  ) : selectedTriage.timeIntent.type === 'follow_up' ? (
                    <AiInfoBlock>
                      <AiInfoHead>提示</AiInfoHead>
                      <AiInfoBody>AI 无法确定具体时间。</AiInfoBody>
                    </AiInfoBlock>
                  ) : (
                    <>
                      <AiInfoBlock>
                        <AiInfoHead>{selectedTriage.timeIntent.type === 'deadline' ? '截止时间' : '时间'}</AiInfoHead>
                        <AiInfoBody>{formatCalendarTime(selectedTriage.timeIntent.deadlineTime || selectedTriage.timeIntent.startTime)}</AiInfoBody>
                      </AiInfoBlock>
                      <AiInfoBlock>
                        <AiInfoHead>地点</AiInfoHead>
                        <AiInfoBody>{selectedTriage.timeIntent.location || '未提供'}</AiInfoBody>
                      </AiInfoBlock>
                      <AiInfoBlock>
                        <AiInfoHead>冲突</AiInfoHead>
                        <AiInfoBody>{(mailCalendarCheck?.conflicts.length ?? selectedTriage.calendarConflictCount ?? 0) > 0 ? `与 ${mailCalendarCheck?.conflicts.length ?? selectedTriage.calendarConflictCount} 个已有日程冲突` : '无冲突'}</AiInfoBody>
                      </AiInfoBlock>
                    </>
                  )}
                  {calendarNotice && <AiInfoBody style={{ marginTop: 8, color: '#2b6cb0' }}>{calendarNotice}</AiInfoBody>}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                    {selectedTriage.timeIntent.type === 'follow_up' ? (
                      <>
                        <Btn onClick={() => handleUseCalendarReply(false)}>生成约时间回复</Btn>
                        <Btn $variant="muted" onClick={() => window.dispatchEvent(new CustomEvent('open-calendar-workspace'))}>手动创建日程</Btn>
                      </>
                    ) : selectedTriage.timeIntent.type === 'candidate_times' ? (
                      <>
                        <Btn onClick={() => { void handleJoinCalendar(); handleUseCalendarReply(false) }}>加入日程并生成回复</Btn>
                        <Btn $variant="muted" onClick={() => handleUseCalendarReply(false)}>只生成回复</Btn>
                      </>
                    ) : (mailCalendarCheck?.conflicts.length ?? selectedTriage.calendarConflictCount ?? 0) > 0 ? (
                      <>
                        <Btn onClick={() => handleUseCalendarReply(true)}>生成改期回复</Btn>
                        <Btn $variant="muted" onClick={() => setCalendarNotice('该时间段已有安排，默认不展示具体冲突日程名称。')}>查看冲突</Btn>
                        <Btn $variant="muted" onClick={() => window.dispatchEvent(new CustomEvent('open-calendar-workspace'))}>修改时间</Btn>
                      </>
                    ) : selectedTriage.timeIntent.type === 'deadline' ? (
                      <>
                        <Btn onClick={() => void handleJoinCalendar()}>加入截止提醒</Btn>
                        <Btn $variant="muted" onClick={() => handleUseCalendarReply(false)}>生成确认回复</Btn>
                      </>
                    ) : (
                      <>
                        <Btn onClick={() => void handleJoinCalendar()}>加入日程</Btn>
                        <Btn $variant="muted" onClick={() => handleUseCalendarReply(false)}>生成确认回复</Btn>
                        <Btn $variant="muted" onClick={() => window.dispatchEvent(new CustomEvent('open-calendar-workspace'))}>修改时间</Btn>
                      </>
                    )}
                    <Btn $variant="muted" onClick={handleIgnoreCalendarIntent}>忽略</Btn>
                  </div>
                </AiRecommendCard>
              )}

              {selectedTodos.length > 0 && (
                <WorkAiPanel>
                  <WorkAiPanelTitle>📋 任务清单</WorkAiPanelTitle>
                  <div style={{ display: 'grid', gap: 6 }}>
                    {selectedTodos.map((todo, index) => {
                      const visibleDesc = todo.description && !todo.description.startsWith('来源邮件：') ? todo.description : undefined
                      return (
                        <div key={todo.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px', background: '#fff' }}>
                          <div style={{ fontWeight: 600, color: '#2d3748', fontSize: 13 }}>{index + 1}. {todo.title}</div>
                          {(visibleDesc || todo.deadline) && (
                            <div style={{ color: '#718096', fontSize: 12, marginTop: 2 }}>
                              {visibleDesc && <span>{visibleDesc}</span>}
                              {todo.deadline && <span>{visibleDesc ? ' · ' : ''}截止 {todo.deadline}</span>}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </WorkAiPanel>
              )}

              {deleteConfirmThreadId === selectedThread.id && (
                <AiRecommendCard $risk>
                  <AiRecommendTitle>确认移入可恢复区域</AiRecommendTitle>
                  <AiRecommendValue>该操作不会永久删除邮件，可在回收站中恢复。</AiRecommendValue>
                  {deleteError && <ComposerError>{deleteError}</ComposerError>}
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <Btn $variant="danger" disabled={isDeleting} onClick={() => void handleDeleteConfirm()}>{isDeleting ? '处理中...' : '确认移入'}</Btn>
                    <Btn $variant="muted" onClick={() => setDeleteConfirmThreadId(null)}>取消</Btn>
                  </div>
                </AiRecommendCard>
              )}
            </MessagePane>

            {!isSentFolderThread && !isTrashFolderThread && (
              isSystemNotice ? (
                <ComposerShell>
                  <ComposerBody>
                    <ComposerError style={{ background: '#fffbeb', borderColor: '#f6e05e', color: '#744210' }}>
                      ⚠ 这是系统退信通知，通常不需要回复。请检查收件人地址或发件域名 SPF/DKIM 配置。
                    </ComposerError>
                  </ComposerBody>
                </ComposerShell>
              ) : (
              <ComposerShell>
                <ComposerBody>
                  {isGenerating && (
                    <GenerationStatusBar $variant="info">⏳ AI 正在生成预回复，请稍候...</GenerationStatusBar>
                  )}
                  {!isGenerating && showSuccessHint && (
                    <GenerationStatusBar $variant="success">✓ 预回复已生成，可编辑后发送。</GenerationStatusBar>
                  )}
                  {!isGenerating && currentDraft?.errorMessage && (
                    <GenerationStatusBar $variant="error">
                      ❌ {currentDraft.content?.trim() ? '发送失败：' : '预回复生成失败：'}{currentDraft.errorMessage}
                    </GenerationStatusBar>
                  )}
                  {!isGenerating && selectedTriage?.timeIntent?.hasTimeRequirement && (
                    <GenerationStatusBar $variant={(mailCalendarCheck?.conflicts.length ?? selectedTriage.calendarConflictCount ?? 0) > 0 ? 'error' : 'success'}>
                      {selectedTriage.timeIntent.type === 'candidate_times'
                        ? `已检查日历：推荐 ${formatCalendarTime(selectedCalendarCandidateStart ?? mailCalendarCheck?.recommendedCandidate?.startTime)}`
                        : (mailCalendarCheck?.conflicts.length ?? selectedTriage.calendarConflictCount ?? 0) > 0
                          ? '已检查日历：该时间段已有安排。AI建议：回复对方请求改期。'
                          : '已检查日历：该时间段无冲突。AI建议：可以确认参加。'}
                      {' '}
                      <button type="button" onClick={() => handleUseCalendarReply((mailCalendarCheck?.conflicts.length ?? selectedTriage.calendarConflictCount ?? 0) > 0)}>
                        {(mailCalendarCheck?.conflicts.length ?? selectedTriage.calendarConflictCount ?? 0) > 0 ? '生成改期回复' : selectedTriage.timeIntent.type === 'candidate_times' ? '使用推荐时间回复' : '使用确认回复'}
                      </button>
                    </GenerationStatusBar>
                  )}
                  {currentReplyKnowledgeNotice ? (
                    <GenerationStatusBar $variant={currentReplyKnowledgeNotice.variant}>
                      {currentReplyKnowledgeNotice.text}
                    </GenerationStatusBar>
                  ) : currentReplyKnowledgeIds.length > 0 ? (
                    <GenerationStatusBar $variant="info">
                      已选择 {currentReplyKnowledgeIds.length} 个知识库，生成预回复时将自动参考相关内容。
                    </GenerationStatusBar>
                  ) : null}
                  {streamingPreview ? (
                    <StreamingPreview>{streamingPreview}</StreamingPreview>
                  ) : (
                    <ComposerTextarea
                      value={currentDraft?.content ?? ''}
                      onChange={(event) => updateDraftContent(event.target.value)}
                      placeholder="点击生成预回复，或直接输入回复内容。AI 不会自动发送邮件。"
                    />
                  )}
                </ComposerBody>
                {currentDraft?.attachments?.length ? (
                  <AttachChips>
                    {currentDraft.attachments.map((att) => (
                      <OutgoingTag key={att.path || att.filename}>
                        <OutgoingTagName>{att.filename}</OutgoingTagName>
                        <OutgoingRemoveBtn onClick={() => removeDraftAttachment(att.path)}>×</OutgoingRemoveBtn>
                      </OutgoingTag>
                    ))}
                  </AttachChips>
                ) : null}
                <ComposerActions>
                  <Btn onClick={handleGenerate} disabled={isGenerating}>{isGenerating ? '正在生成...' : '生成预回复'}</Btn>
                  <Btn $variant="muted" onClick={saveDraft} disabled={!currentDraft}>保存草稿</Btn>
                  <AddAttachBtn onClick={() => fileInputRef.current?.click()}>添加附件</AddAttachBtn>
                  <KnowledgeBtn
                    $variant="muted"
                    $active={currentReplyKnowledgeIds.length > 0}
                    onClick={() => selectedMailId && setKnowledgePickerMailId(selectedMailId)}
                    disabled={!selectedMailId || isGenerating}
                    title={currentReplyKnowledgeIds.length > 0 ? `已选择 ${currentReplyKnowledgeIds.length} 个知识库` : '选择生成预回复时参考的知识库'}
                  >
                    {currentReplyKnowledgeLabel}
                  </KnowledgeBtn>
                  <Btn $variant="send" onClick={sendReply} disabled={!canSend}>确认发送</Btn>
                  <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleAttachFiles} />
                </ComposerActions>
              </ComposerShell>
              )
            )}

            {isTrashFolderThread && (
              <ComposerShell>
                {restoreError && <ComposerError>{restoreError}</ComposerError>}
                <ComposerActions>
                  <Btn onClick={() => {
                    if (!selectedMailId) return
                    setRestoreError(null)
                    void restoreMail(selectedMailId).catch((err: unknown) => {
                      setRestoreError((err instanceof Error ? err.message : String(err)) || '恢复邮件失败')
                    })
                  }}>恢复到收件箱</Btn>
                </ComposerActions>
              </ComposerShell>
            )}
          </>
        ) : (
          <EmptyCenterState>← 选择一封邮件查看详情</EmptyCenterState>
        ))}
      </DetailPane>
      </MainPanels>

      {knowledgePickerMailId && (
        <EmailReplyKnowledgePicker
          departments={departments}
          selectedIds={selectedReplyKnowledgeByMailId[knowledgePickerMailId]?.knowledgeIds ?? []}
          onCancel={() => setKnowledgePickerMailId(null)}
          onClear={() => handleClearKnowledgeSelection(knowledgePickerMailId)}
          onConfirm={(ids) => handleConfirmKnowledgeSelection(knowledgePickerMailId, ids)}
        />
      )}
      {showAccountModal && (
        <AccountSettingsModal onClose={() => setShowAccountModal(false)} />
      )}
      {showCompose && (
        <ComposeModal
          initialTo={pendingComposeTo}
          initialSubject={pendingComposeDraft?.subject}
          initialBody={pendingComposeDraft?.body}
          initialAttachments={pendingComposeDraft?.attachments}
          variant={pendingComposeDraft?.variant}
          onClose={() => { setShowCompose(false); setPendingComposeTo(undefined); setPendingComposeDraft(undefined) }}
        />
      )}
      {showWorkflowPanel && (
        <WorkflowTasksPanel
          tasks={workflowTasks}
          loading={workflowTasksLoading}
          error={workflowTasksError}
          completingTaskId={completingTaskId}
          onClose={() => setShowWorkflowPanel(false)}
          onRefresh={handleLoadWorkflowTasks}
          onApprove={(taskId) => { void handleCompleteTask(taskId, 'approve') }}
          onReject={(taskId) => { void handleCompleteTask(taskId, 'reject') }}
        />
      )}
    </Shell>
  )
}

/* ================================================================== */
/*  Root export — wraps EmailProvider + CommunicationProvider        */
/* ================================================================== */

export default function CommunicationWorkbench() {
  return (
    <EmailProvider>
      <MailTriageProvider>
        <CommunicationProvider mode="email">
          <CommunicationWorkbenchInner />
        </CommunicationProvider>
      </MailTriageProvider>
    </EmailProvider>
  )
}
