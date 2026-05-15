/**
 * AI 托管（下班托管）功能的共享类型定义
 *
 * AI 托管只涉及 AI Office 内部的邮件、内部通讯、知识库问答和工作日报，
 * 不控制员工电脑的其他操作。
 */

// ─── 用户在线状态 ───────────────────────────────────────────────────────────

export type UserPresenceStatus =
  | 'online'          // 在线
  | 'away'            // 离开
  | 'ai_delegated'    // AI 托管中
  | 'do_not_disturb'  // 请勿打扰
  | 'offline'         // 离线

// ─── 自动回复策略 ───────────────────────────────────────────────────────────

/** 自动回复策略类型 */
export type AutoReplyPolicyType =
  | 'draft_only'      // 只生成草稿，不自动发送
  | 'auto_low_risk'   // 低风险自动回复，中高风险转待审核
  | 'review_all'      // 全部进入待审核

/** 风险等级 */
export type RiskLevel = 'low' | 'medium' | 'high'

/** 高风险问题类别（这些必须进入人工审核） */
export type HighRiskCategory =
  | 'approval_decision'     // 审批决定
  | 'financial_commitment'  // 财务承诺
  | 'personnel_action'      // 人事处分
  | 'complaint_handling'    // 投诉处理
  | 'legal_liability'       // 法律责任
  | 'sensitive_personal'    // 敏感个人信息
  | 'no_kb_basis'           // 无知识库依据
  | 'low_confidence'        // 置信度低

// ─── 托管策略 ───────────────────────────────────────────────────────────────

export interface DelegationPolicy {
  id: string
  name: string
  autoReplyType: AutoReplyPolicyType
  /** 低风险置信度阈值（0-1），低于此值升级为中风险 */
  lowRiskConfidenceThreshold: number
  /** 中风险置信度阈值（0-1），低于此值升级为高风险 */
  mediumRiskConfidenceThreshold: number
  /** 是否允许回复外部邮件 */
  allowExternalEmailReply: boolean
  /** 是否允许回复内部通讯 */
  allowChatReply: boolean
  /** 自定义离开消息（可选） */
  awayMessage?: string
}

/** 默认托管策略 */
export const DEFAULT_DELEGATION_POLICY: DelegationPolicy = {
  id: 'default',
  name: '默认策略',
  autoReplyType: 'auto_low_risk',
  lowRiskConfidenceThreshold: 0.75,
  mediumRiskConfidenceThreshold: 0.5,
  allowExternalEmailReply: true,
  allowChatReply: true,
}

// ─── 托管状态 ───────────────────────────────────────────────────────────────

export interface DelegationState {
  userId: string
  tenantId?: string
  status: UserPresenceStatus
  enabledAt?: string   // ISO 时间戳
  disabledAt?: string  // ISO 时间戳
  policyId: string
  /** 是否已完成工作快照上传 */
  snapshotUploaded: boolean
  /** 是否已生成日报 */
  reportGenerated: boolean
}

// ─── 自动回复 ───────────────────────────────────────────────────────────────

/** 自动回复候选内容 */
export interface AutoReplyResult {
  /** 生成的回复文本（带 AI 托管标识） */
  content: string
  /** 风险等级 */
  riskLevel: RiskLevel
  /** 高风险原因（如果是高风险） */
  highRiskReasons?: HighRiskCategory[]
  /** 置信度（0-1） */
  confidence: number
  /** 是否自动发送（取决于策略和风险等级） */
  autoSent: boolean
  /** 引用的知识库文档 */
  knowledgeCitations: Array<{
    documentId: string
    documentTitle: string
    chunkId?: string
    quote?: string
  }>
  generatedAt: string
}

/** 自动回复待审核队列项 */
export interface PendingAutoReply {
  id: string
  userId: string
  /** 消息来源：email | chat */
  sourceType: 'email' | 'chat'
  /** 原消息 ID */
  sourceMessageId: string
  /** 原消息线程 ID */
  sourceThreadId: string
  /** 发件人 */
  senderName: string
  senderAddress: string
  /** 原消息摘要 */
  messageSummary: string
  /** AI 生成的回复 */
  replyContent: string
  riskLevel: RiskLevel
  highRiskReasons?: HighRiskCategory[]
  confidence: number
  knowledgeCitations: Array<{
    documentId: string
    documentTitle: string
    quote?: string
  }>
  status: 'pending_review' | 'approved' | 'rejected' | 'sent'
  createdAt: string
  reviewedAt?: string
  reviewedBy?: string
}

// ─── 工作日报托管 ───────────────────────────────────────────────────────────

/** 员工客户端上传的今日活动数据 */
export interface WorkReportUploadPayload {
  userId: string
  date: string  // YYYY-MM-DD
  /** 文件变更摘要（来自 workspaceActivityService） */
  fileSummaries: Array<{
    fileName: string
    changeType: 'created' | 'modified' | 'deleted'
    topic: string
    summary: string
    workType: string
  }>
  /** 今日收发邮件统计 */
  emailActivity: {
    received: number
    sent: number
    drafts: number
    /** 邮件主题摘要（脱敏） */
    threadSummaries: string[]
  }
  /** 今日内部通讯统计 */
  chatActivity: {
    messagesSent: number
    messagesReceived: number
    conversationCount: number
  }
  /** AI 使用记录 */
  aiUsage: {
    totalRequests: number
    modes: string[]
    tasksCompleted: number
  }
  /** 异常任务（可选） */
  anomalies?: string[]
  workspacePath: string

  // ── 新增：完整行为日志（来自 userActionLogService） ──
  /** 全部行为事件（含 eventType / details / durationMs） */
  activityEvents?: unknown[]
  /** AI 调用事件 */
  aiEvents?: unknown[]
  /** 文件操作事件 */
  fileEvents?: unknown[]
  /** 工作会话列表 */
  sessions?: unknown[]
  /** 各任务耗时汇总 */
  taskDurations?: unknown[]
}

/** 服务端生成的含托管信息的增强日报 */
export interface DelegationWorkReport {
  userId: string
  username: string
  displayName: string
  date: string
  delegationEnabledAt?: string
  /** 今日概览 */
  overview: string
  /** 主要工作 */
  mainWork: string
  /** 关键产出 */
  keyOutputs: string
  /** 文件变更摘要 */
  fileChanges: string
  /** 邮件处理情况 */
  emailSummary: string
  /** 内部通讯摘要 */
  chatSummary: string
  /** AI 使用情况 */
  aiUsageSummary: string
  /** 异常任务 */
  anomalies: string
  /** 与昨日对比 */
  comparison: string
  /** 明日建议 */
  suggestions: string
  generatedAt: string
  /** 数据来源（员工端上传时间） */
  dataUploadedAt?: string
  status: 'generating' | 'ready' | 'error'
}

// ─── 审计日志 ───────────────────────────────────────────────────────────────

export type DelegationAuditAction =
  | 'delegation_enabled'          // 开启托管
  | 'delegation_disabled'         // 关闭托管
  | 'snapshot_uploaded'           // 快照上传
  | 'work_report_generated'       // 日报已生成
  | 'work_report_viewed'          // 日报被查看
  | 'work_report_regenerated'     // 日报被重新生成
  | 'auto_reply_generated'        // AI 自动回复已生成
  | 'auto_reply_sent'             // AI 自动回复已发送
  | 'auto_reply_queued_review'    // AI 回复进入待审核
  | 'auto_reply_approved'         // 待审核回复已批准
  | 'auto_reply_rejected'         // 待审核回复已拒绝

export interface DelegationAuditEvent {
  id: string
  action: DelegationAuditAction
  /** 执行该操作的用户 ID */
  actorId: string
  actorUsername: string
  /** 被操作的用户 ID（如管理员查看下属日报时，targetUserId 是下属） */
  targetUserId?: string
  /** 相关实体 ID（如消息 ID、日报 ID） */
  entityId?: string
  /** 操作详情 */
  detail?: Record<string, unknown>
  timestamp: string
}

// ─── IPC 请求/响应类型 ──────────────────────────────────────────────────────

export interface DelegationEnableInput {
  userId: string
  workspacePath: string
  policyId?: string
}
export type DelegationEnableResult =
  | { ok: true; state: DelegationState }
  | { ok: false; error: string }

export interface DelegationDisableInput {
  userId: string
}
export type DelegationDisableResult =
  | { ok: true; state: DelegationState }
  | { ok: false; error: string }

export type DelegationGetStatusResult =
  | { ok: true; state: DelegationState | null }
  | { ok: false; error: string }

export interface AutoReplyGenerateInput {
  /** 接收消息的用户 ID（托管中的用户） */
  recipientUserId: string
  sourceType: 'email' | 'chat'
  sourceMessageId: string
  sourceThreadId: string
  senderName: string
  senderAddress: string
  messageBody: string
  messageSubject?: string
  /** 可用知识库 ID 列表（departmentId） */
  knowledgeBases: string[]
  policyId?: string
}
export type AutoReplyGenerateResult =
  | { ok: true; result: AutoReplyResult; pendingReply?: PendingAutoReply }
  | { ok: false; error: string }

export interface WorkReportUploadInput {
  payload: WorkReportUploadPayload
}
export type WorkReportUploadResult =
  | { ok: true; reportId: string }
  | { ok: false; error: string }

export type DelegationGetAuditLogResult =
  | { ok: true; events: DelegationAuditEvent[] }
  | { ok: false; error: string }

export interface DelegationGetPendingRepliesResult {
  ok: true
  replies: PendingAutoReply[]
}

export interface DelegationReviewReplyInput {
  replyId: string
  action: 'approve' | 'reject'
  reviewerUserId: string
}
export type DelegationReviewReplyResult =
  | { ok: true }
  | { ok: false; error: string }
