/**
 * UserActionLogService — AI Office 用户行为日志服务（单例）
 *
 * 写入路径：userData/user-action-logs/{userId}/{YYYY-MM-DD}.json（JSON 数组格式）
 *
 * 保留旧字段（id, localId, userId, module, action, title, summary, createdAt, syncStatus）
 * 以确保 UI 兼容性，同时新增 eventType, startedAt/endedAt, durationMs, status, details 等字段。
 *
 * 注意：不记录键盘监听、鼠标监听、屏幕录制。只记录 AI Office 内部业务行为。
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { app } from 'electron'
import type { DailyReportInput, WorkSession, TaskDurationSummary, WorkActivityEventType } from '../../../src/types/workActivityTypes'

// ─── Types ────────────────────────────────────────────────────────────────────

export type UserActionSyncStatus = 'pending' | 'synced' | 'failed'

export interface UserActionLogEntry {
  // ── Existing fields (backward compat / UI display) ──
  id: string
  localId: string
  userId: string
  module: string
  action: string
  title?: string
  summary: string
  createdAt: string
  syncStatus: UserActionSyncStatus
  retryCount?: number
  lastSyncError?: string

  // ── New fields ──
  eventType: string
  sessionId?: string
  startedAt?: string
  endedAt?: string
  durationMs?: number
  status: 'success' | 'failed' | 'cancelled'
  targetType?: string
  targetId?: string
  targetTitle?: string
  details?: Record<string, unknown>
  errorCode?: string
  errorMessage?: string
}

export interface AppendActionInput {
  module: string
  action: string
  eventType: string
  title?: string
  summary?: string
  status?: 'success' | 'failed' | 'cancelled'
  targetType?: string
  targetId?: string
  targetTitle?: string
  startedAt?: string
  endedAt?: string
  durationMs?: number
  details?: Record<string, unknown>
  errorCode?: string
  errorMessage?: string
}

// ─── Summary auto-generation ─────────────────────────────────────────────────

const EVENT_SUMMARY_MAP: Record<string, (input: AppendActionInput) => string> = {
  file_opened: (i) => `打开了文件${i.targetTitle ? ` "${i.targetTitle}"` : ''}`,
  file_saved: (i) => `保存了${i.targetType === 'aidoc' ? '文档' : '文件'}${i.targetTitle ? ` "${i.targetTitle}"` : ''}`,
  file_exported: (i) => `导出了 ${(i.targetType ?? '文件').toUpperCase()}${i.targetTitle ? ` "${i.targetTitle}"` : ''}`,
  ppt_generated: (i) => `生成了 PPT${i.targetTitle ? ` "${i.targetTitle}"` : ''}`,
  ppt_exported: (i) => `导出了 PPT${i.targetTitle ? ` "${i.targetTitle}"` : ''}`,
  ai_prompt_submitted: (i) => `提交了 AI 任务${i.details?.featureName ? ` (${i.details.featureName})` : ''}`,
  ai_task_completed: (i) => `AI 任务完成${i.details?.featureName ? ` (${i.details.featureName})` : ''}${i.durationMs != null ? `，耗时 ${i.durationMs}ms` : ''}`,
  ai_task_failed: (i) => `AI 任务失败${i.details?.featureName ? ` (${i.details.featureName})` : ''}`,
  email_sent: (i) => `发送了邮件${i.details?.subjectSummary ? ` "${i.details.subjectSummary}"` : ''}`,
  chat_message_sent: () => '发送了内部通讯消息',
  attachment_sent: (i) => `发送了附件${i.details?.fileName ? ` "${i.details.fileName}"` : ''}`,
  error_occurred: (i) => `发生错误${i.errorMessage ? `：${i.errorMessage.slice(0, 50)}` : ''}`,
  session_started: () => '开始工作会话',
  session_ended: () => '结束工作会话',
}

function autoSummary(input: AppendActionInput): string {
  const fn = EVENT_SUMMARY_MAP[input.eventType]
  return fn ? fn(input) : input.eventType.replace(/_/g, ' ')
}

// ─── Utility functions ────────────────────────────────────────────────────────

/** Compute a short, non-reversible hash of an absolute path for safe logging. */
export function createPathHash(absPath: string): string {
  return createHash('sha256').update(absPath).digest('hex').slice(0, 16)
}

/** Infer a canonical file type string from a file name. */
export function inferFileType(fileName: string): string {
  if (fileName.endsWith('.aidoc.json') || fileName.endsWith('.aidoc')) return 'aidoc'
  const ext = path.extname(fileName).slice(1).toLowerCase()
  const known = ['docx', 'pptx', 'pdf', 'md', 'txt', 'xlsx', 'csv']
  return known.includes(ext) ? ext : 'unknown'
}

function nowIso(): string {
  return new Date().toISOString()
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function generateUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

function generateLocalId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

// ─── UserActionLogService ─────────────────────────────────────────────────────

const FLUSH_INTERVAL_MS = 30_000
const MAX_PENDING_IN_MEMORY = 2_000

export class UserActionLogService {
  private static instance: UserActionLogService | null = null

  private userId = ''
  private username = ''
  private sessionId = ''
  private pending: UserActionLogEntry[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private isFlushing = false

  private constructor() {}

  static getInstance(): UserActionLogService {
    if (!UserActionLogService.instance) {
      UserActionLogService.instance = new UserActionLogService()
    }
    return UserActionLogService.instance
  }

  // ── Identity ──────────────────────────────────────────────────────────────

  setIdentity(userId: string, username?: string): void {
    const changed = userId && userId !== this.userId
    this.userId = userId
    this.username = username ?? ''
    if (changed) {
      // Backfill buffered pending entries with the real userId
      for (const entry of this.pending) {
        if (!entry.userId) entry.userId = userId
      }
      // Flush immediately to write to the correct path
      void this.flush().catch(() => undefined)
    }
  }

  // ── Session ───────────────────────────────────────────────────────────────

  startSession(): void {
    this.sessionId = generateUuid()
    this.appendAction({
      module: 'app',
      action: 'startSession',
      eventType: 'session_started',
      status: 'success',
      details: { sessionId: this.sessionId },
    })
    if (!this.flushTimer) {
      this.flushTimer = setInterval(() => {
        void this.flush().catch(() => undefined)
      }, FLUSH_INTERVAL_MS)
      if (this.flushTimer.unref) {
        this.flushTimer.unref()
      }
    }
  }

  endSession(): void {
    if (!this.sessionId) return
    const sid = this.sessionId
    this.appendAction({
      module: 'app',
      action: 'endSession',
      eventType: 'session_ended',
      status: 'success',
      details: { sessionId: sid },
    })
  }

  getCurrentSessionId(): string {
    return this.sessionId
  }

  // ── Append ────────────────────────────────────────────────────────────────

  appendAction(input: AppendActionInput): void {
    try {
      const now = nowIso()
      const entry: UserActionLogEntry = {
        id: generateUuid(),
        localId: generateLocalId(),
        userId: this.userId,
        module: input.module,
        action: input.action,
        title: input.title ?? input.targetTitle,
        summary: input.summary ?? autoSummary(input),
        createdAt: now,
        syncStatus: 'pending',
        eventType: input.eventType,
        sessionId: this.sessionId || undefined,
        startedAt: input.startedAt,
        endedAt: input.endedAt ?? (input.durationMs != null ? now : undefined),
        durationMs: input.durationMs,
        status: input.status ?? 'success',
        targetType: input.targetType,
        targetId: input.targetId,
        targetTitle: input.targetTitle,
        details: input.details,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
      }

      this.pending.push(entry)

      if (this.pending.length > MAX_PENDING_IN_MEMORY) {
        this.pending = this.pending.slice(-MAX_PENDING_IN_MEMORY)
      }
    } catch {
      // Never crash the main business logic
    }
  }

  // ── File paths ────────────────────────────────────────────────────────────

  private getLogDir(userId: string): string {
    return path.join(app.getPath('userData'), 'user-action-logs', userId)
  }

  private getLogPath(userId: string, dateKey: string): string {
    return path.join(this.getLogDir(userId), `${dateKey}.json`)
  }

  // ── Flush ─────────────────────────────────────────────────────────────────

  async flush(): Promise<void> {
    if (this.isFlushing || this.pending.length === 0 || !this.userId) return
    this.isFlushing = true

    const toWrite = [...this.pending]
    this.pending = []

    try {
      // Group by (userId, dateKey)
      const groups = new Map<string, UserActionLogEntry[]>()
      for (const entry of toWrite) {
        const uid = entry.userId || this.userId
        const dateKey = entry.createdAt.slice(0, 10)
        const key = `${uid}::${dateKey}`
        const arr = groups.get(key) ?? []
        arr.push(entry)
        groups.set(key, arr)
      }

      for (const [key, entries] of groups) {
        const [uid, dateKey] = key.split('::') as [string, string]
        const logPath = this.getLogPath(uid, dateKey)
        await fs.mkdir(this.getLogDir(uid), { recursive: true })

        let existing: UserActionLogEntry[] = []
        try {
          const raw = await fs.readFile(logPath, 'utf-8')
          const parsed = JSON.parse(raw)
          existing = Array.isArray(parsed) ? (parsed as UserActionLogEntry[]) : []
        } catch {
          existing = []
        }

        const merged = [...existing, ...entries]
        const tempPath = `${logPath}.tmp-${Date.now()}`
        await fs.writeFile(tempPath, JSON.stringify(merged, null, 2), 'utf-8')
        await fs.rename(tempPath, logPath)
      }
    } catch {
      // Restore so events aren't lost on flush failure
      if (this.pending.length < MAX_PENDING_IN_MEMORY) {
        this.pending = [...toWrite, ...this.pending]
      }
    } finally {
      this.isFlushing = false
    }
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  async getEntriesForDate(dateKey: string, userId?: string): Promise<UserActionLogEntry[]> {
    const uid = userId ?? this.userId
    if (!uid) return []

    let onDisk: UserActionLogEntry[] = []
    try {
      const raw = await fs.readFile(this.getLogPath(uid, dateKey), 'utf-8')
      const parsed = JSON.parse(raw)
      onDisk = Array.isArray(parsed) ? (parsed as UserActionLogEntry[]) : []
    } catch {
      onDisk = []
    }

    if (dateKey === todayKey()) {
      const inMemory = this.pending.filter((e) => e.createdAt.slice(0, 10) === dateKey)
      return [...onDisk, ...inMemory]
    }
    return onDisk
  }

  async getTodayEntries(): Promise<UserActionLogEntry[]> {
    return this.getEntriesForDate(todayKey())
  }

  // ── Sync status ───────────────────────────────────────────────────────────

  /** Mark specific entries as synced in both memory and on disk. */
  async markSynced(entryIds: string[], dateKey?: string, userId?: string): Promise<void> {
    const key = dateKey ?? todayKey()
    const uid = userId ?? this.userId
    const idSet = new Set(entryIds)

    // Update in-memory pending entries first
    for (const entry of this.pending) {
      if (idSet.has(entry.id)) {
        entry.syncStatus = 'synced'
      }
    }

    if (!uid) return
    const logPath = this.getLogPath(uid, key)
    try {
      const raw = await fs.readFile(logPath, 'utf-8')
      const entries = JSON.parse(raw) as UserActionLogEntry[]
      if (!Array.isArray(entries)) return

      const updated = entries.map((e) =>
        idSet.has(e.id) ? { ...e, syncStatus: 'synced' as const } : e,
      )

      const tempPath = `${logPath}.tmp-${Date.now()}`
      await fs.writeFile(tempPath, JSON.stringify(updated, null, 2), 'utf-8')
      await fs.rename(tempPath, logPath)
    } catch {
      // Best-effort; don't crash
    }
  }

  getSyncStatus(): { pendingCount: number; userId: string; sessionId: string } {
    const pendingInMemory = this.pending.filter((e) => e.syncStatus === 'pending').length
    return { pendingCount: pendingInMemory, userId: this.userId, sessionId: this.sessionId }
  }

  // ── Build daily report input ──────────────────────────────────────────────

  async buildDailyReportInput(dateKey?: string, userId?: string): Promise<DailyReportInput> {
    const key = dateKey ?? todayKey()
    const uid = userId ?? this.userId
    const entries = await this.getEntriesForDate(key, uid)

    const aiEvents = entries.filter((e) =>
      e.eventType === 'ai_prompt_submitted' ||
      e.eventType === 'ai_task_completed' ||
      e.eventType === 'ai_task_failed',
    )

    const fileEvents = entries.filter((e) =>
      e.eventType === 'file_opened' ||
      e.eventType === 'file_saved' ||
      e.eventType === 'file_exported' ||
      e.eventType === 'ppt_generated' ||
      e.eventType === 'ppt_exported',
    )

    // Reconstruct sessions from session_started events
    const sessions: WorkSession[] = entries
      .filter((e) => e.eventType === 'session_started')
      .map((e) => {
        const sid = (e.details?.sessionId as string | undefined) ?? e.sessionId ?? ''
        const endEvent = entries.find(
          (end) =>
            end.eventType === 'session_ended' &&
            ((end.details?.sessionId as string | undefined) ?? end.sessionId) === sid,
        )
        return {
          sessionId: sid,
          date: key,
          userId: e.userId,
          username: this.username,
          startedAt: e.createdAt,
          endedAt: endEvent?.createdAt,
        }
      })

    // Duration summary per module+eventType
    const durationMap = new Map<string, { totalMs: number; count: number }>()
    for (const e of entries) {
      if (e.durationMs != null) {
        const k = `${e.module}::${e.eventType}`
        const existing = durationMap.get(k) ?? { totalMs: 0, count: 0 }
        durationMap.set(k, {
          totalMs: existing.totalMs + e.durationMs,
          count: existing.count + 1,
        })
      }
    }

    const taskDurations: TaskDurationSummary[] = Array.from(durationMap.entries()).map(([k, v]) => {
      const [module, action] = k.split('::')
      return {
        module: module ?? k,
        action: action ?? '',
        avgMs: Math.round(v.totalMs / v.count),
        totalMs: v.totalMs,
        count: v.count,
      }
    })

    // Map entries to WorkActivityEvent format for delegation service compatibility
    const mapEntry = (e: UserActionLogEntry) => ({
      id: e.id,
      ts: e.createdAt,
      dateKey: key,
      sessionId: e.sessionId ?? '',
      userId: e.userId,
      username: this.username,
      module: e.module,
      eventType: e.eventType as WorkActivityEventType,
      action: e.action,
      targetType: e.targetType,
      targetId: e.targetId,
      targetTitle: e.targetTitle,
      durationMs: e.durationMs,
      status: e.status,
      payload: e.details,
      errorCode: e.errorCode,
      errorMessage: e.errorMessage,
    })

    return {
      date: key,
      userId: uid ?? this.userId,
      username: this.username,
      activityEvents: entries.map(mapEntry),
      sessions,
      aiEvents: aiEvents.map(mapEntry),
      fileEvents: fileEvents.map(mapEntry),
      taskDurations,
    }
  }

  // ── Teardown ──────────────────────────────────────────────────────────────

  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    this.endSession()
    await this.flush()
  }
}

export const userActionLogService = UserActionLogService.getInstance()
