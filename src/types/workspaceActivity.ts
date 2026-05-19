// Workspace Activity Analysis — shared types between main and renderer.

export interface FileSnapshotEntry {
  /** Absolute path on disk */
  path: string
  /** Path relative to workspace root */
  relativePath: string
  fileName: string
  /** Lower-case extension without dot: docx | pdf | pptx | txt | md | other */
  fileType: string
  size: number
  modifiedAt: string
  hash: string
}

export interface WorkspaceSnapshot {
  date: string            // YYYY-MM-DD
  workspacePath: string
  createdAt: string       // ISO
  files: FileSnapshotEntry[]
}

export type FileChangeType = 'created' | 'modified' | 'deleted' | 'exported'

export interface FileChangeRecord extends FileSnapshotEntry {
  changeType: FileChangeType
}

export interface FileDiff {
  date: string
  baseDate: string | null
  created: FileChangeRecord[]
  modified: FileChangeRecord[]
  deleted: FileChangeRecord[]
  exported: FileChangeRecord[]
}

export type WorkType = 'draft' | 'formal' | 'email' | 'ppt' | 'research' | 'notes' | 'debugging' | 'communication' | 'other'
export type ProgressStage = 'planning' | 'drafting' | 'editing' | 'reviewing' | 'finalizing' | 'exporting' | 'debugging' | 'communicating' | 'blocked' | 'completed'
export type OutcomeLevel = 'none' | 'partial' | 'substantial' | 'completed'

export interface FileContentSummary {
  filePath: string
  fileName: string
  changeType: FileChangeType
  workType: WorkType
  /** 归并后的任务名称；不是文件名直译 */
  taskName?: string
  topic: string
  /** 文件所反映的当前工作阶段 */
  progressStage?: ProgressStage
  /** 相对之前推进了什么 */
  progressDelta?: string
  summary: string
  keyActions: string[]
  outputValue: string
  /** 仍未解决的问题 */
  remainingIssues?: string[]
  /** 支撑判断的文件名、变更类型、文本片段或日志事件 */
  evidence?: string[]
  /** 阶段性产出程度 */
  outcomeLevel?: OutcomeLevel
  confidence: number
}

export interface DailyActivityReport {
  date: string
  workspacePath: string
  username?: string
  generatedAt: string
  overview: string
  mainWork: string
  keyOutputs: string
  comparison: string
  workFocusChange: string
  anomalies: string
  suggestions: string
  /** 今日整体进展，强调推进结果 */
  progressSummary?: string
  /** 阶段性成果 */
  keyMilestones?: string
  /** 证据型说明 */
  evidenceBasedDetails?: string
  /** 阻塞、异常、失败、未完成事项 */
  blockersAndRisks?: string
  /** AI 实际贡献 */
  aiContribution?: string
  /** 沟通推进 */
  communicationProgress?: string
  /** 耗时和投入估计 */
  timeAndEffort?: string
  /** 下一步工作焦点 */
  nextFocus?: string
  summaries: FileContentSummary[]
  /** 今日收发邮件统计（托管模式下附加） */
  emailActivity?: {
    received: number
    sent: number
    drafts: number
    threadSummaries: string[]
  }
  /** 今日内部通讯统计（托管模式下附加） */
  chatActivity?: {
    messagesSent: number
    messagesReceived: number
    conversationCount: number
  }
  /** AI 使用情况（托管模式下附加） */
  aiUsage?: {
    totalRequests: number
    modes: string[]
    tasksCompleted: number
  }
  /** AI 托管开启时间（如果当日开启了托管） */
  delegationEnabledAt?: string
  /** 文件与产出汇总（文本，含文件名和操作描述） */
  fileOutputs?: string
  /** 耗时统计汇总（文本）*/
  timeStats?: string
  /** 完整 Markdown 日报（含全部 7 个章节，由 LLM 生成后组装） */
  detailedMarkdown?: string
}

// IPC request/response shapes

export interface ActivityTakeSnapshotInput {
  workspacePath: string
}
export type ActivityTakeSnapshotResult =
  | { ok: true; snapshot: WorkspaceSnapshot }
  | { ok: false; error: string }

export interface ActivityGetActivityInput {
  workspacePath: string
  date?: string       // YYYY-MM-DD, defaults to today
  baseDate?: string   // YYYY-MM-DD, defaults to yesterday
}
export type ActivityGetActivityResult =
  | { ok: true; diff: FileDiff }
  | { ok: false; error: string }

export interface ActivityAnalyzeFilesInput {
  workspacePath: string
  date?: string
}
export type ActivityAnalyzeFilesResult =
  | { ok: true; summaries: FileContentSummary[] }
  | { ok: false; error: string }

export interface ActivityGenerateReportInput {
  workspacePath: string
  date?: string
  username?: string
}
export type ActivityGenerateReportResult =
  | { ok: true; report: DailyActivityReport }
  | { ok: false; error: string }

export interface ActivityGetReportInput {
  workspacePath: string
  date?: string
}
export type ActivityGetReportResult =
  | { ok: true; report: DailyActivityReport | null }
  | { ok: false; error: string }
