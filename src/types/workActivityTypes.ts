/**
 * AI Office 工作行为日志类型定义
 *
 * 只记录 AI Office 内部业务行为。
 * 不包含键盘监听、鼠标监听、屏幕录制等行为。
 */

export type WorkActivityEventType =
  | 'file_opened'
  | 'file_saved'
  | 'file_exported'
  | 'ppt_generated'
  | 'ppt_exported'
  | 'ai_prompt_submitted'
  | 'ai_task_completed'
  | 'ai_task_failed'
  | 'email_sent'
  | 'chat_message_sent'
  | 'attachment_sent'
  | 'error_occurred'
  | 'session_started'
  | 'session_ended'

export interface WorkActivityEvent {
  /** 唯一事件 ID */
  id: string
  /** ISO 时间戳 */
  ts: string
  /** YYYY-MM-DD */
  dateKey: string
  /** 所属会话 ID */
  sessionId: string
  userId?: string
  username?: string
  /** 产生事件的模块，如 'llmClient', 'emailService', 'pptxGenerator' */
  module: string
  eventType: WorkActivityEventType
  /** 动作细节，如 'save', 'export', 'generate' */
  action?: string
  /** 操作对象类型，如 'docx', 'pptx', 'pdf', 'email', 'chat' */
  targetType?: string
  /** 对象标识（路径 hash 或文档 ID） */
  targetId?: string
  /** 对象标题或文件名 */
  targetTitle?: string
  /** 操作耗时（毫秒） */
  durationMs?: number
  status: 'success' | 'failed' | 'cancelled'
  /** 事件具体数据 */
  payload?: Record<string, unknown>
  errorCode?: string
  errorMessage?: string
}

export interface WorkSession {
  sessionId: string
  /** YYYY-MM-DD */
  date: string
  userId?: string
  username?: string
  workspacePath?: string
  /** ISO 时间戳 */
  startedAt: string
  /** ISO 时间戳 */
  endedAt?: string
}

/** 任务耗时汇总 */
export interface TaskDurationSummary {
  module: string
  action: string
  avgMs: number
  totalMs: number
  count: number
}

/** 每日日报所需的完整行为日志输入 */
export interface DailyReportInput {
  /** YYYY-MM-DD */
  date: string
  userId?: string
  username?: string
  workspacePath?: string
  /** 本日所有行为事件 */
  activityEvents: WorkActivityEvent[]
  /** 本日会话列表 */
  sessions: WorkSession[]
  /** AI 调用明细（从 activityEvents 中筛选） */
  aiEvents: WorkActivityEvent[]
  /** 文件操作明细（从 activityEvents 中筛选） */
  fileEvents: WorkActivityEvent[]
  /** 任务耗时汇总 */
  taskDurations: TaskDurationSummary[]
}
