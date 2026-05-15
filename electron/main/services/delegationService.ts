/**
 * DelegationService — AI 托管状态管理与审计日志服务
 *
 * 负责：
 * - 持久化用户托管状态 (userData/delegation-state.json)
 * - 记录审计日志 (userData/delegation-audit.jsonl)
 * - 与 AccountCenter 同步 presence 状态（如配置了 backendUrl）
 * - 管理待审核自动回复队列 (userData/delegation-pending-replies.json)
 * - 存储上传的工作快照数据 (userData/delegation-work-reports/*.json)
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type {
  DelegationState,
  DelegationAuditEvent,
  DelegationAuditAction,
  PendingAutoReply,
  WorkReportUploadPayload,
  UserPresenceStatus,
} from '../../../src/types/delegation'
import type { AppSettings } from './settingsStore'
import { userActionLogService } from './userActionLogService'

const ACCOUNT_CENTER_URL = 'http://10.20.5.61:13100'

// Concurrency guard — prevents parallel upload calls from racing on the same log file
let activityLogUploadInFlight = false

// Full shape of a disk entry in user-action-logs/{userId}/{dateKey}.json
interface FullDiskEntry {
  id?: string
  localId?: string
  userId?: string
  module?: string
  action?: string
  eventType?: string
  title?: string
  summary?: string
  createdAt?: string
  startedAt?: string
  endedAt?: string
  durationMs?: number
  status?: string
  sessionId?: string
  details?: unknown
  errorCode?: string
  errorMessage?: string
  syncStatus?: string
  retryCount?: number
  lastSyncError?: string
}

// ─── Storage paths ────────────────────────────────────────────────────────────

function getUserDataPath(): string {
  return app.getPath('userData')
}

function getDelegationStatePath(): string {
  return path.join(getUserDataPath(), 'delegation-state.json')
}

function getDelegationAuditPath(): string {
  return path.join(getUserDataPath(), 'delegation-audit.jsonl')
}

function getPendingRepliesPath(): string {
  return path.join(getUserDataPath(), 'delegation-pending-replies.json')
}

function getWorkReportDir(): string {
  return path.join(getUserDataPath(), 'delegation-work-reports')
}

function getWorkReportPath(userId: string, date: string): string {
  return path.join(getWorkReportDir(), `${userId}-${date}.json`)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString()
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true })
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

async function writeJsonAtomic(filePath: string, payload: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath))
  const tempPath = `${filePath}.tmp-${Date.now()}`
  await fs.writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf-8')
  await fs.rename(tempPath, filePath)
}

// ─── DelegationService ────────────────────────────────────────────────────────

export class DelegationService {
  // ── State management ──

  async getState(): Promise<DelegationState | null> {
    return readJsonFile<DelegationState>(getDelegationStatePath())
  }

  async saveState(state: DelegationState): Promise<void> {
    await writeJsonAtomic(getDelegationStatePath(), state)
  }

  async enableDelegation(
    userId: string,
    settings: AppSettings,
    policyId = 'default',
  ): Promise<DelegationState> {
    const state: DelegationState = {
      userId,
      status: 'ai_delegated',
      enabledAt: nowIso(),
      policyId,
      snapshotUploaded: false,
      reportGenerated: false,
    }
    await this.saveState(state)
    await this.appendAuditEvent({
      action: 'delegation_enabled',
      actorId: userId,
      actorUsername: userId,
      detail: { policyId },
    })
    // Try to sync presence to AccountCenter (best-effort)
    void this.syncPresenceToServer(userId, 'ai_delegated', settings).catch(() => undefined)
    return state
  }

  async disableDelegation(
    userId: string,
    settings: AppSettings,
  ): Promise<DelegationState> {
    const existing = await this.getState()
    const state: DelegationState = {
      ...(existing ?? {
        userId,
        policyId: 'default',
        snapshotUploaded: false,
        reportGenerated: false,
      }),
      userId,
      status: 'online',
      disabledAt: nowIso(),
    }
    await this.saveState(state)
    await this.appendAuditEvent({
      action: 'delegation_disabled',
      actorId: userId,
      actorUsername: userId,
    })
    void this.syncPresenceToServer(userId, 'online', settings).catch(() => undefined)
    return state
  }

  // ── Presence sync ──

  private async syncPresenceToServer(
    userId: string,
    status: UserPresenceStatus,
    _settings: AppSettings,
  ): Promise<void> {
    const token = await this.getStoredToken()
    if (!token) return

    await fetch(`${ACCOUNT_CENTER_URL}/api/delegation/presence`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ userId, status }),
    })
  }

  private async getStoredToken(): Promise<string | null> {
    try {
      const tokenPath = path.join(getUserDataPath(), 'internal-account-token.json')
      const raw = await fs.readFile(tokenPath, 'utf-8')
      const parsed = JSON.parse(raw) as { token?: string }
      return parsed.token ?? null
    } catch {
      return null
    }
  }

  // ── Work report upload ──

  async saveWorkReportData(
    payload: WorkReportUploadPayload,
    settings: AppSettings,
  ): Promise<string> {
    const reportId = `${payload.userId}-${payload.date}`
    const reportPath = getWorkReportPath(payload.userId, payload.date)
    await ensureDir(getWorkReportDir())
    await writeJsonAtomic(reportPath, { ...payload, savedAt: nowIso() })

    await this.appendAuditEvent({
      action: 'snapshot_uploaded',
      actorId: payload.userId,
      actorUsername: payload.userId,
      entityId: reportId,
      detail: {
        date: payload.date,
        fileCount: payload.fileSummaries.length,
      },
    })

    // Update delegation state to mark snapshot as uploaded
    const existing = await this.getState()
    if (existing && existing.userId === payload.userId) {
      await this.saveState({ ...existing, snapshotUploaded: true })
    }

    // Try to upload to AccountCenter server as well
    void this.uploadWorkReportToServer(payload, settings).catch(() => undefined)

    return reportId
  }

  async getWorkReportData(
    userId: string,
    date: string,
  ): Promise<(WorkReportUploadPayload & { savedAt?: string }) | null> {
    return readJsonFile(getWorkReportPath(userId, date))
  }

  private async uploadWorkReportToServer(
    payload: WorkReportUploadPayload,
    _settings: AppSettings,
  ): Promise<void> {
    const token = await this.getStoredToken()
    if (!token) return

    // Merge user-action-logs into payload
    let enrichedPayload = payload
    let uploadedEntryIds: string[] = []
    try {
      const activityInput = await userActionLogService.buildDailyReportInput(payload.date)
      uploadedEntryIds = activityInput.activityEvents.map((e) => (e as { id: string }).id).filter(Boolean)
      enrichedPayload = {
        ...payload,
        activityEvents: activityInput.activityEvents,
        aiEvents: activityInput.aiEvents,
        fileEvents: activityInput.fileEvents,
        sessions: activityInput.sessions,
        taskDurations: activityInput.taskDurations,
      }
    } catch {
      // Best-effort enrichment; continue with original payload if it fails
    }

    const res = await fetch(`${ACCOUNT_CENTER_URL}/api/work-report/delegation/upload`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(enrichedPayload),
    })

    if (res.ok && uploadedEntryIds.length > 0) {
      // Mark uploaded entries as synced (best-effort)
      void userActionLogService.markSynced(uploadedEntryIds, payload.date).catch(() => undefined)
    }
  }

  // ── Standalone activity log upload ───────────────────────────────────────

  /**
   * Upload pending user-action-log entries to the server.
   * Safe to call frequently — skips upload if no pending entries.
   * On success marks entries as synced; on failure records retryCount/lastSyncError.
   */
  async uploadActivityLogs(opts?: { userId?: string; dateKey?: string }): Promise<{ ok: boolean; syncedCount: number; skipped?: boolean; error?: string }> {
    if (activityLogUploadInFlight) {
      console.log('[uploadActivityLogs] skipped: upload already in flight')
      return { ok: true, syncedCount: 0, skipped: true }
    }
    activityLogUploadInFlight = true
    try {
      return await this._uploadActivityLogsImpl(opts)
    } finally {
      activityLogUploadInFlight = false
    }
  }

  private async _uploadActivityLogsImpl(opts?: { userId?: string; dateKey?: string }): Promise<{ ok: boolean; syncedCount: number; error?: string }> {
    const token = await this.getStoredToken()
    if (!token) return { ok: false, syncedCount: 0, error: 'no_token' }

    // Flush in-memory pending entries to disk first
    try { await userActionLogService.flush() } catch { /* best-effort */ }

    const today = new Date()
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const dateKey = opts?.dateKey ?? todayStr
    const userId = opts?.userId ?? userActionLogService.getSyncStatus().userId
    if (!userId) return { ok: false, syncedCount: 0, error: 'no_user' }

    // Check if there are any pending entries on disk before building the payload
    const logDir = path.join(getUserDataPath(), 'user-action-logs', userId)
    const logFile = path.join(logDir, `${dateKey}.json`)
    let diskEntries: FullDiskEntry[] = []
    try {
      const raw = await fs.readFile(logFile, 'utf-8')
      const parsed = JSON.parse(raw) as unknown[]
      diskEntries = Array.isArray(parsed) ? parsed as FullDiskEntry[] : []
    } catch {
      return { ok: true, syncedCount: 0 } // No file → nothing to upload
    }

    // Build the complete daily report input
    let activityInput: import('../../../src/types/workActivityTypes').DailyReportInput
    try {
      activityInput = await userActionLogService.buildDailyReportInput(dateKey, userId)
    } catch (err) {
      return { ok: false, syncedCount: 0, error: err instanceof Error ? err.message : String(err) }
    }

    // Include: pending, failed with retryCount < 10, OR failed due to known schema bugs (retry unconditionally)
    const KNOWN_SCHEMA_ERRORS = ['"events" must be an array', '"dateKey" is required']
    const retryableEntries = diskEntries.filter((e) => {
      if (!e.id) return false
      if (!e.syncStatus || e.syncStatus === 'pending') return true
      if (e.syncStatus === 'failed') {
        const schemaError = KNOWN_SCHEMA_ERRORS.some((msg) => e.lastSyncError?.includes(msg))
        if (schemaError) return true
        return (e.retryCount ?? 0) < 10
      }
      return false
    })
    if (retryableEntries.length === 0) return { ok: true, syncedCount: 0 }
    // Only mark the retryable entries as synced — not already-synced ones
    const allIds = retryableEntries.map((e) => e.id).filter((id): id is string => !!id)

    // events = ALL entries for the day (server builds daily stats from this full picture)
    // This is intentionally NOT limited to retryableEntries — the server needs every event
    // to compute totalDurationMs, aiEventCount, fileEventCount, lastActivityAt, etc.
    const normalizeEntry = (e: FullDiskEntry) => ({
      id: e.id,
      localId: e.localId,
      userId: e.userId ?? userId,
      dateKey,
      module: e.module,
      action: e.action,
      eventType: e.eventType,
      title: e.title,
      summary: e.summary,
      createdAt: e.createdAt,
      startedAt: e.startedAt,
      endedAt: e.endedAt,
      durationMs: e.durationMs,
      status: e.status,
      sessionId: e.sessionId,
      details: e.details,
      errorCode: e.errorCode,
      errorMessage: e.errorMessage,
    })
    const events = diskEntries.filter((e) => !!e.id).map(normalizeEntry)

    // Build the HTTP body — server requires both `events` (primary) and sub-arrays (optional enrichment)
    const httpBody = {
      userId,
      date: dateKey,
      dateKey,
      events,
      fileSummaries: [] as unknown[],
      emailActivity: { sent: 0, received: 0, drafts: 0, threadSummaries: [] as string[] },
      chatActivity: { messagesSent: 0, messagesReceived: 0, conversationCount: 0 },
      aiUsage: { totalRequests: 0, modes: [] as string[], tasksCompleted: 0 },
      workspacePath: '',
      activityEvents: activityInput.activityEvents,
      aiEvents: activityInput.aiEvents,
      fileEvents: activityInput.fileEvents,
      sessions: activityInput.sessions,
      taskDurations: activityInput.taskDurations,
      anomalies: [] as string[],
    }

    console.log('[uploadActivityLogs] request body summary:', {
      userId,
      dateKey,
      retryableCount: retryableEntries.length,
      eventsCount: events.length,
      activityEventsCount: activityInput.activityEvents.length,
      aiEventsCount: activityInput.aiEvents.length,
      fileEventsCount: activityInput.fileEvents.length,
      hasEventsArray: Array.isArray(events),
      firstEventType: events[0]?.eventType,
      firstEventId: events[0]?.id,
    })

    try {
      const res = await fetch(`${ACCOUNT_CENTER_URL}/api/work-report/delegation/upload`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(httpBody),
      })

      let responseText = ''
      try { responseText = await res.text() } catch { responseText = `HTTP ${res.status}` }

      console.log('[uploadActivityLogs] server response', {
        status: res.status,
        ok: res.ok,
        body: responseText.slice(0, 300),
      })

      if (!res.ok) {
        throw new Error(responseText || `HTTP ${res.status}`)
      }

      // Mark all retryable entries (pending + failed) as synced on success
      await userActionLogService.markSynced(allIds, dateKey, userId).catch(() => undefined)
      return { ok: true, syncedCount: allIds.length }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      console.warn('[uploadActivityLogs] upload failed:', error)
      await this.markUploadFailed(logFile, allIds, error).catch(() => undefined)
      return { ok: false, syncedCount: 0, error }
    }
  }

  private async markUploadFailed(logFile: string, ids: string[], error: string): Promise<void> {
    try {
      const raw = await fs.readFile(logFile, 'utf-8')
      const entries = JSON.parse(raw) as Array<{ id?: string; retryCount?: number; lastSyncError?: string; syncStatus?: string }>
      if (!Array.isArray(entries)) return
      const idSet = new Set(ids)
      const updated = entries.map((e) =>
        e.id && idSet.has(e.id)
          ? { ...e, syncStatus: 'failed', retryCount: (e.retryCount ?? 0) + 1, lastSyncError: error }
          : e,
      )
      const tempPath = `${logFile}.tmp-${Date.now()}`
      await fs.writeFile(tempPath, JSON.stringify(updated, null, 2), 'utf-8')
      await fs.rename(tempPath, logFile)
    } catch { /* best-effort */ }
  }

  // ── Pending replies ──

  async getPendingReplies(): Promise<PendingAutoReply[]> {
    const data = await readJsonFile<PendingAutoReply[]>(getPendingRepliesPath())
    return data ?? []
  }

  async savePendingReply(reply: PendingAutoReply): Promise<void> {
    const existing = await this.getPendingReplies()
    const updated = [reply, ...existing.filter((r) => r.id !== reply.id)]
    await writeJsonAtomic(getPendingRepliesPath(), updated)
  }

  async updatePendingReplyStatus(
    replyId: string,
    status: PendingAutoReply['status'],
    reviewedBy?: string,
  ): Promise<void> {
    const existing = await this.getPendingReplies()
    const updated = existing.map((r) =>
      r.id === replyId
        ? { ...r, status, reviewedAt: nowIso(), reviewedBy }
        : r,
    )
    await writeJsonAtomic(getPendingRepliesPath(), updated)
  }

  // ── Audit log ──

  async appendAuditEvent(
    event: Omit<DelegationAuditEvent, 'id' | 'timestamp'>,
  ): Promise<DelegationAuditEvent> {
    const fullEvent: DelegationAuditEvent = {
      ...event,
      id: generateId(),
      timestamp: nowIso(),
    }
    await ensureDir(getUserDataPath())
    await fs.appendFile(
      getDelegationAuditPath(),
      `${JSON.stringify(fullEvent)}\n`,
      'utf-8',
    )
    return fullEvent
  }

  async getAuditLog(limit = 200): Promise<DelegationAuditEvent[]> {
    try {
      const raw = await fs.readFile(getDelegationAuditPath(), 'utf-8')
      const lines = raw
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line) as DelegationAuditEvent
          } catch {
            return null
          }
        })
        .filter((e): e is DelegationAuditEvent => e !== null)
      return lines.slice(-limit).reverse()
    } catch {
      return []
    }
  }
}

export const delegationService = new DelegationService()
