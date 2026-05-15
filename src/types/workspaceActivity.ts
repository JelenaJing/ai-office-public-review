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

export type WorkType = 'draft' | 'formal' | 'email' | 'ppt' | 'research' | 'notes' | 'other'

export interface FileContentSummary {
  filePath: string
  fileName: string
  changeType: FileChangeType
  workType: WorkType
  topic: string
  summary: string
  keyActions: string[]
  outputValue: string
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
