/**
 * emailMatterBuilder.ts
 *
 * Builds structured WorkflowMatter objects from AI triage results.
 * Handles scenario detection (with research_progress_submission taking priority)
 * and WorkItem generation for each scenario type.
 */

import type { AiMailTriageResult } from '../../types/mailTriage'
import type {
  WorkflowMatter,
  WorkflowWorkItem,
  MatterScenarioType,
} from '../types/workflowMatter'

// ── Keyword detection ─────────────────────────────────────────────────────────

const RESEARCH_PROGRESS_EN = [
  'research progress',
  'progress report',
  'progress review',
  'annual progress',
  'thesis progress',
  'research progress report',
  'phd progress',
  'postgraduate progress',
  'mid-term review',
  'milestone review',
]

const RESEARCH_PROGRESS_ZH = [
  '导师审批',
  '研究进展',
  '进展报告',
  '年度进展',
  '中期检查',
  '开题进展',
  '研究生进展',
  '博士进展',
  '硕士进展',
  '中期报告',
  '阶段汇报',
]

function matchesResearchProgress(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    RESEARCH_PROGRESS_EN.some((k) => lower.includes(k)) ||
    RESEARCH_PROGRESS_ZH.some((k) => text.includes(k))
  )
}

// ── Scenario detection ────────────────────────────────────────────────────────

/**
 * Detect the workflow scenario type from triage data and subject/body text.
 * research_progress_submission is checked first and takes priority over
 * generic material_collection and approval_request.
 */
export function detectMatterScenario(
  triage: AiMailTriageResult,
  subject: string,
  bodySnippet = '',
): MatterScenarioType {
  const combined = [
    subject,
    bodySnippet,
    triage.summary ?? '',
    triage.actionPlan?.brief ?? '',
    triage.actionPlan?.title ?? '',
  ].join(' ')

  // Higher-priority specific scenarios first
  if (matchesResearchProgress(combined)) return 'research_progress_submission'

  const intentType = triage.actionPlan?.intentType
  const emailCategory = triage.emailCategory

  if (intentType === 'approval' || emailCategory === 'approval_request') return 'approval_request'
  if (intentType === 'meeting' || emailCategory === 'meeting_invitation') return 'meeting_invitation'
  if (intentType === 'attachment_review' || emailCategory === 'document_review') return 'document_review'
  if (intentType === 'task' || emailCategory === 'task_assignment') return 'task_assignment'
  if (intentType === 'request' || emailCategory === 'data_report_request') return 'material_collection'
  if (intentType === 'notice') return 'information_summary'

  return 'unknown'
}

// ── WorkItem factory for research_progress_submission ─────────────────────────

function buildResearchProgressWorkItems(): WorkflowWorkItem[] {
  return [
    {
      id: 'step-1-read-requirements',
      title: '阅读学校提交要求',
      description: '仔细阅读学校邮件中的 research progress 提交说明和截止日期',
      actionType: 'confirm',
      assigneeRole: 'student',
      outputType: 'none',
      requiredHumanSignature: false,
      status: 'pending',
    },
    {
      id: 'step-2-prepare-material',
      title: '准备 research progress 材料',
      description: '按学校要求整理研究进展报告、成果清单和相关文档',
      actionType: 'prepare_material',
      assigneeRole: 'student',
      outputType: 'document',
      requiredHumanSignature: false,
      evidenceRequired: true,
      status: 'pending',
      dependsOn: ['step-1-read-requirements'],
    },
    {
      id: 'step-3-submit-form',
      title: '提交 research progress 表格/材料',
      description: '将准备好的材料填写并提交到学校指定系统或通过邮件发送',
      actionType: 'submit_form',
      assigneeRole: 'student',
      outputType: 'form_submission',
      requiredHumanSignature: true,
      status: 'pending',
      dependsOn: ['step-2-prepare-material'],
    },
    {
      id: 'step-4-notify-advisor',
      title: '通知导师审批',
      description: '提交后通知导师进行审核并确认签字',
      actionType: 'handoff',
      assigneeRole: 'student',
      handoffToRole: 'advisor',
      outputType: 'email_reply',
      requiredHumanSignature: false,
      status: 'pending',
      dependsOn: ['step-3-submit-form'],
    },
    {
      id: 'step-5-advisor-review',
      title: '导师审批',
      description: '导师审阅研究进展材料并做出批准或提出补充意见',
      actionType: 'advisor_review',
      assigneeRole: 'advisor',
      requiredHumanSignature: true,
      status: 'waiting',
      dependsOn: ['step-4-notify-advisor'],
    },
    {
      id: 'step-6-archive-result',
      title: '回传结果并归档',
      description: '将导师批准结果回传学校，并在系统中存档本次进展记录',
      actionType: 'archive_result',
      assigneeRole: 'system',
      outputType: 'record',
      requiredHumanSignature: false,
      status: 'waiting',
      dependsOn: ['step-5-advisor-review'],
    },
  ]
}

// ── Matter builder ────────────────────────────────────────────────────────────

/**
 * Build a WorkflowMatter for an email.
 * Currently only produces a full matter for research_progress_submission;
 * returns null for all other scenarios so existing behaviour is unchanged.
 */
export function buildEmailMatter(
  mailId: string,
  threadId: string,
  triage: AiMailTriageResult,
  subject: string,
  sender: string,
  scenario: MatterScenarioType,
): WorkflowMatter | null {
  if (scenario === 'research_progress_submission') {
    return buildResearchProgressMatter(mailId, threadId, triage, subject, sender)
  }
  return null
}

function buildResearchProgressMatter(
  mailId: string,
  threadId: string,
  triage: AiMailTriageResult,
  subject: string,
  sender: string,
): WorkflowMatter {
  const workItems = buildResearchProgressWorkItems()
  return {
    matterId: `matter-${mailId}-research-progress`,
    title: 'Research Progress 提交与导师审批',
    summary: [
      `学校（${sender}）要求提交 research progress 材料。`,
      '当前用户需先准备并提交相关材料，随后通知导师进行审批。',
      '最终由导师确认/签字后结果归档。',
      triage.summary ? `AI 摘要：${triage.summary}` : '',
    ]
      .filter(Boolean)
      .join(' '),
    scenarioType: 'research_progress_submission',
    workflowPattern: 'linear_handoff',
    source: 'email',
    emailId: mailId,
    threadId: threadId || mailId,
    subject: subject || '(无主题)',
    sender,
    riskLevel: 'medium',
    status: 'in_progress',
    currentStepId: 'step-1-read-requirements',
    currentAssigneeRole: 'student',
    finalApproverRole: 'advisor',
    suggestedNextAction:
      '请先准备并提交 research progress 材料，随后系统将协助通知导师进行审批。',
    workItems,
    createdAt: new Date().toISOString(),
  }
}

// ── Summary serializer ────────────────────────────────────────────────────────

/**
 * Serialize a WorkflowMatter into a concise aiSummary string for the
 * Flowable workflow payload. Kept under ~500 chars for readability in the UI.
 */
export function serializeMatterToSummary(matter: WorkflowMatter): string {
  const stepsList = matter.workItems
    .map((w, i) => `${i + 1}.${w.title}(${w.assigneeRole})`)
    .join(' → ')
  return [
    `[${matter.title}]`,
    `模式:${matter.workflowPattern}`,
    `当前步骤:${matter.currentStepId ?? '-'}`,
    `下一步:${matter.suggestedNextAction}`,
    `流程:${stepsList}`,
  ].join(' | ')
}
