/**
 * AI Mail Triage — type definitions.
 *
 * All AI classification of emails happens on the client side using the
 * existing LLM infrastructure. The mail server (mailcow / IMAP / SMTP)
 * is never involved in LLM calls.
 */

export type AiMailTriageCategory =
  | 'action_required'   // 待我处理
  | 'reply_required'    // 待我回复
  | 'read_only'         // 仅需阅读
  | 'archive_candidate' // 可归档
  | 'promotion'         // 营销/广告
  | 'risk'              // 风险邮件
  | 'unknown'           // 无法判断

export type AiMailTriagePriority = 'high' | 'medium' | 'low'
export type AiMailTriageRiskLevel = 'none' | 'low' | 'medium' | 'high'
export type AiMailTriageStatus = 'none' | 'pending' | 'running' | 'success' | 'failed' | 'skipped'

/**
 * Why a mail's AI analysis was skipped without calling the LLM.
 * 'attachment_only' — mail has attachments but no actionable text body
 * 'empty_mail'      — mail has neither subject, body, nor attachments
 * 'system_delivery_notice' — automated delivery receipt
 */
export type AiMailSkipReason =
  | 'attachment_only'
  | 'empty_mail'
  | 'system_delivery_notice'

export type AiEmailIntentType =
  | 'task'
  | 'request'
  | 'question'
  | 'notice'
  | 'attachment_review'
  | 'meeting'
  | 'approval'
  | 'spam'
  | 'ordinary'

export interface AiEmailActionPlan {
  intentType: AiEmailIntentType
  title: string
  brief: string

  taskChecklist?: Array<{
    id: string
    text: string
    done: boolean
    deadline?: string | null
  }>

  requestItems?: Array<{
    id: string
    text: string
    required: boolean
  }>

  questionAnswer?: {
    question: string
    answerDraft: string
    usedKnowledgeBase: boolean
    knowledgeMissing: boolean
  }

  noticeSummary?: {
    keyPoints: string[]
    needFollowUp: boolean
    followUpReason?: string
  }

  attachmentActions?: Array<{
    fileName?: string
    action: 'read' | 'edit' | 'review' | 'sign' | 'return' | 'archive'
    targetWorkspace?: 'document' | 'ppt' | 'excel' | 'preview' | 'none'
    note: string
  }>

  replyStrategy: {
    shouldReply: boolean
    tone: 'formal' | 'concise' | 'friendly' | 'neutral'
    reason: string
  }
}

export type AiEmailCategory =
  | 'spam'
  | 'promotion'
  | 'system_notice'
  | 'internal_notice'
  | 'student_request'
  | 'colleague_collaboration'
  | 'task_assignment'
  | 'approval_request'
  | 'meeting_invitation'
  | 'document_review'
  | 'data_report_request'
  | 'project_update'
  | 'urgent_issue'
  | 'ordinary'

export type AiEmailImportance = 'high' | 'medium' | 'low'
export type AiEmailUrgency = 'urgent' | 'soon' | 'normal' | 'none'

export type AiEmailTodoType =
  | 'reply_email'
  | 'edit_document'
  | 'review_attachment'
  | 'prepare_material'
  | 'upload_file'
  | 'confirm_information'
  | 'schedule_meeting'
  | 'approve_or_reject'
  | 'analyze_data'
  | 'forward_to_others'

export type AiEmailTargetWorkspace =
  | 'document'
  | 'ppt'
  | 'excel'
  | 'mail'
  | 'none'

export type AiEmailTodoStatus = 'pending' | 'done'

export interface AiEmailTodo {
  id: string
  title: string
  description?: string
  type: AiEmailTodoType
  priority: AiEmailImportance
  deadline?: string | null
  sourceEmailId: string
  targetWorkspace?: AiEmailTargetWorkspace
  status: AiEmailTodoStatus
  createdAt: string
  updatedAt?: string
  accountId?: string
  workspaceId?: string
}

export type AiEmailReplyIntent =
  | 'direct_answer'
  | 'ask_for_more_information'
  | 'acknowledge_received'
  | 'promise_later'
  | 'reject_or_decline'
  | 'forward_to_others'
  | 'send_attachment'
  | 'submit_revision'
  | 'explain_policy'
  | 'none'

export interface EmailTimeIntent {
  hasTimeRequirement: boolean

  type:
    | 'meeting'
    | 'interview'
    | 'deadline'
    | 'reminder'
    | 'appointment'
    | 'candidate_times'
    | 'follow_up'
    | 'none'

  title?: string
  description?: string

  startTime?: string
  endTime?: string
  timezone?: string

  location?: string
  meetingLink?: string

  attendees?: Array<{
    name?: string
    email?: string
  }>

  candidateTimes?: Array<{
    startTime: string
    endTime?: string
    timezone?: string
  }>

  deadlineTime?: string

  confidence: number
  needsUserConfirmation: boolean

  sourceText?: string
}

export interface AiEmailAnalysisResult {
  emailId: string
  summary: string
  category: AiEmailCategory
  importance: AiEmailImportance
  urgency: AiEmailUrgency
  requiresReply: boolean
  requiresAction: boolean
  requiresKnowledgeBase: boolean
  requiresAttachment: boolean
  requiresOpenAttachment: boolean
  suggestedAction: string
  suggestedKnowledgeQueries: string[]
  todos: AiEmailTodo[]
  replyIntent: AiEmailReplyIntent
  draftReply?: string
  timeIntent?: EmailTimeIntent
  riskFlags: string[]
  actionPlan?: AiEmailActionPlan
  analyzedAt: string
  updatedAt?: string
}

export type EmailImportance = 'important' | 'normal' | 'low'

export type EmailActionType =
  | 'need_reply'
  | 'need_review'
  | 'need_schedule'
  | 'need_forward'
  | 'notification'
  | 'spam_or_noise'
  | 'no_action'

export interface EmailAnalysisResult {
  messageId: string
  threadId?: string

  fromName?: string
  fromEmail?: string
  subject: string
  receivedAt?: string

  importance: EmailImportance
  category: string
  actionType: EmailActionType

  summary: string
  reason: string

  suggestedReply?: string
  hasDraftReply: boolean
  draftId?: string

  deadlineText?: string
  timeIntent?: EmailTimeIntent
  calendarEventId?: string
  calendarConflictCount?: number
  relatedPeople?: string[]
  relatedDepartment?: string

  batchId?: string
  error?: string
}

export interface EmailContentTopicSummary {
  topic: string
  count: number
  importanceLevel: 'important' | 'normal' | 'low' | 'mixed'
  description: string
  relatedMessageIds: string[]
  representativeSubjects: string[]
}

export interface EmailAnalysisBatchSummary {
  batchId: string
  createdAt: string

  totalEmails: number
  analyzedCount: number
  failedCount: number

  importantCount: number
  normalCount: number
  lowCount: number

  needReplyCount: number
  noActionCount: number
  draftReplyCount: number

  senderStats: Array<{
    fromName?: string
    fromEmail: string
    count: number
    importantCount: number
    subjects: string[]
  }>

  categoryStats: Array<{
    category: string
    count: number
  }>

  calendarStats: {
    meetingOrInterviewCount: number
    deadlineCount: number
    candidateTimesCount: number
    conflictCount: number
    tentativeEventCount: number
  }

  calendarItems: {
    pending: Array<{
      messageId: string
      subject: string
      title: string
      startTime?: string
      deadlineTime?: string
    }>
    conflicts: Array<{
      messageId: string
      subject: string
      title: string
      conflictCount: number
    }>
    deadlines: Array<{
      messageId: string
      subject: string
      title: string
      deadlineTime?: string
    }>
  }

  contentTopics: EmailContentTopicSummary[]

  topImportantEmails: Array<{
    messageId: string
    fromName?: string
    fromEmail?: string
    subject: string
    reason: string
    actionType: EmailActionType
  }>

  actionItems: Array<{
    messageId: string
    subject: string
    fromName?: string
    fromEmail?: string
    actionType: EmailActionType
    suggestedNextStep: string
    deadlineText?: string
    timeIntent?: EmailTimeIntent
  }>

  reportText: string
  contentOverviewText: string
}

export type AiMailTriageResult = {
  messageId: string
  threadId?: string
  accountId: string
  /** SHA-like hash of the email body text; used to detect body changes */
  bodyHash: string
  category: AiMailTriageCategory
  priority: AiMailTriagePriority
  needsReply: boolean
  needsUserAction: boolean
  canAutoArchive: boolean
  riskLevel: AiMailTriageRiskLevel
  /** Short summary ≤ 20 chars */
  summary: string
  /** Classification rationale ≤ 30 chars */
  reason: string
  /** Suggested next action ≤ 20 chars */
  suggestedAction: string
  deadline?: string
  timeIntent?: EmailTimeIntent
  calendarEventId?: string
  calendarConflictCount?: number
  senderRole?: string
  detectedIntent?: string
  suggestedReplyPrompt?: string
  /**
   * Ordered list of concrete subtasks AI recommends for action_required emails.
   * Generated by LLM or by keyword-based local templates. Max 5 items.
   * Each item is a short actionable sentence (≤ 30 chars).
   */
  suggestedTasks?: string[]
  emailCategory?: AiEmailCategory
  importance?: AiEmailImportance
  urgency?: AiEmailUrgency
  requiresReply?: boolean
  requiresAction?: boolean
  requiresKnowledgeBase?: boolean
  requiresAttachment?: boolean
  requiresOpenAttachment?: boolean
  suggestedKnowledgeQueries?: string[]
  todos?: AiEmailTodo[]
  replyIntent?: AiEmailReplyIntent
  draftReply?: string
  riskFlags?: string[]
  analyzedAt?: string
  actionPlan?: AiEmailActionPlan
  status: AiMailTriageStatus
  /** Set when status === 'skipped' to explain why LLM analysis was bypassed */
  skipReason?: AiMailSkipReason
  errorMessage?: string
  /** Model used for this classification */
  modelName?: string
  createdAt: string
  updatedAt: string
}

export type MailTriageJob = {
  id: string
  accountId: string
  messageId: string
  bodyHash: string
  status: 'pending' | 'running' | 'success' | 'failed'
  retryCount: number
  errorMessage?: string
  createdAt: string
  updatedAt: string
}

/** Progress counters for the user-initiated "AI邮件分析" run. */
export type MailAnalysisProgress = {
  /** Total mails considered in this run (unread inbox + selected-if-unanalysed) */
  total: number
  /** Mails that already had a cached success result (skipped LLM call) */
  cached: number
  /** Mails queued for LLM classification */
  enqueued: number
  /** Mails currently being classified */
  running: number
  /** Mails successfully classified */
  done: number
  /** Mails for which an AI pre-reply draft was generated */
  drafts: number
  /** Mails that failed classification */
  failed: number
  /**
   * true when the currently-selected mail was already read (not in unread scan)
   * but was included in this run because it had no cached analysis result.
   */
  selectedMailAdded?: boolean
}

export type AiMailReplyDraftStatus = 'generated' | 'inserted' | 'sent' | 'discarded'
export type AiMailReplyDraftTone = 'formal' | 'polite' | 'concise'

/**
 * A locally-stored AI pre-reply draft, bound to accountId + messageId + bodyHash.
 * Security: drafts are local-only. Nothing is sent automatically.
 * Users must explicitly confirm before sending.
 */
export type AiMailReplyDraft = {
  id: string
  accountId: string
  messageId: string
  bodyHash: string
  triageResultId?: string
  subject: string
  /** Reply-to addresses */
  to: string[]
  cc?: string[]
  /** Draft body text generated by AI */
  draftBody: string
  tone: AiMailReplyDraftTone
  status: AiMailReplyDraftStatus
  createdAt: string
  updatedAt: string
}

/**
 * A locally-stored user-edited reply draft.
 * Created/updated whenever the user types in the reply box.
 * Survives navigation and app restarts.
 * Security: local-only, never sent automatically.
 */
export type UserMailReplyDraft = {
  accountId: string
  messageId: string
  bodyHash: string
  replyBody: string
  status: 'editing' | 'sent' | 'discarded'
  createdAt: string
  updatedAt: string
}
