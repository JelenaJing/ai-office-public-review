/**
 * WorkActivityLog — work activity recorder with server sync.
 *
 * Data flow:
 *   1. logActivity() writes entry to localStorage (syncStatus: 'pending')
 *      AND to the Electron IPC file store (offline / cross-user fallback).
 *   2. flushPendingActivities(token) batches all pending entries to the server
 *      via POST /api/activity/log/batch, then updates syncStatus in localStorage.
 *   3. getActivitiesForUser(userId, date, token) queries the server first:
 *        - 403 → hard permission error, no local fallback
 *        - 400 → invalid date error, no local fallback
 *        - network failure → fallback to local Electron IPC file store
 *
 * The server is the authoritative cross-user store for daily report generation.
 * localStorage / IPC files serve as a sync queue and offline fallback.
 */

import type { WorkActivityLog, WorkActivityModule } from '../modules/chat/types'
import { activityLogBatch, activityGetUserActivities } from './workActivitySyncClient'

const STORAGE_KEY = 'aioffice.workActivityLog'
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000 // 3 days

// ─── Detect Electron ─────────────────────────────────────────────────────────

function getElectronAPI() {
  return typeof window !== 'undefined'
    ? (window as unknown as { electronAPI?: {
        activityLogUserAction?: (p: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>
        activityGetUserActions?: (p: { userId: string; date: string }) => Promise<{ ok: boolean; actions: unknown[]; error?: string }>
      } }).electronAPI
    : undefined
}

// ─── Ambient session state ────────────────────────────────────────────────────

let _ambientUserId: string | null = null
let _ambientToken: string | null = null
let _syncInProgress = false

export function setAmbientUserId(userId: string | null): void {
  _ambientUserId = userId
}
export function getAmbientUserId(): string | null {
  return _ambientUserId
}

/** Set the current user's auth token so flush can call the server without prop drilling. */
export function setAmbientToken(token: string | null): void {
  _ambientToken = token
}
export function getAmbientToken(): string | null {
  return _ambientToken
}

// ─── localStorage helpers ─────────────────────────────────────────────────────

function readAll(): WorkActivityLog[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as WorkActivityLog[]
  } catch {
    return []
  }
}

function pruneOld(entries: WorkActivityLog[]): WorkActivityLog[] {
  const cutoff = Date.now() - MAX_AGE_MS
  return entries.filter((e) => new Date(e.createdAt).getTime() > cutoff)
}

function writeAll(entries: WorkActivityLog[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    try {
      const half = entries.slice(Math.floor(entries.length / 2))
      localStorage.setItem(STORAGE_KEY, JSON.stringify(half))
    } catch { /* give up */ }
  }
}

function makeLocalId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

// ─── Sync: flush pending entries to server ────────────────────────────────────

/**
 * Upload all pending activity entries for the current user to the server.
 * Safe to call multiple times — concurrent calls are debounced via `_syncInProgress`.
 */
export async function flushPendingActivities(token?: string): Promise<void> {
  const effectiveToken = token ?? _ambientToken
  if (!effectiveToken || _syncInProgress) return

  const all = pruneOld(readAll())
  const pending = all.filter(
    (e) => e.userId === _ambientUserId && (!e.syncStatus || e.syncStatus === 'pending' || e.syncStatus === 'failed'),
  )
  if (pending.length === 0) return

  _syncInProgress = true
  console.debug('[activity-sync-post]', {
    count: pending.length,
    endpoint: '/api/activity/log/batch',
  })

  try {
    const batchEntries = pending.map((e) => ({
      localId: e.localId,
      workspaceId: e.workspaceId,
      module: e.module,
      action: e.action,
      title: e.title,
      summary: e.summary,
      metadata: e.metadata,
      createdAt: e.createdAt,
    }))

    const results = await activityLogBatch(batchEntries, effectiveToken)
    const syncedMap = new Map(results.map((r) => [r.localId, r.serverId]))

    const updated = pruneOld(readAll()).map((e) => {
      if (!syncedMap.has(e.localId)) return e
      return { ...e, syncStatus: 'synced' as const, serverId: syncedMap.get(e.localId), syncedAt: new Date().toISOString() }
    })
    writeAll(updated)

    console.debug('[activity-sync-success]', {
      syncedCount: results.length,
      results,
    })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.debug('[activity-sync-failed]', { error })
    // Mark as failed so they retry on the next flush
    const updated = pruneOld(readAll()).map((e) =>
      pending.some((p) => p.localId === e.localId)
        ? { ...e, syncStatus: 'failed' as const, lastSyncError: error }
        : e,
    )
    writeAll(updated)
  } finally {
    _syncInProgress = false
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Record a work activity for the current user. */
export function logActivity(
  userId: string,
  module: WorkActivityModule,
  action: string,
  opts?: {
    workspaceId?: string
    title?: string
    summary?: string
    metadata?: Record<string, unknown>
  },
): void {
  if (!userId) return
  const createdAt = new Date().toISOString()
  const localId = makeLocalId()

  const entry: WorkActivityLog = {
    localId,
    id: localId,
    userId,
    workspaceId: opts?.workspaceId,
    module,
    action,
    title: opts?.title,
    summary: opts?.summary,
    metadata: opts?.metadata,
    createdAt,
    syncStatus: 'pending',
  }

  // Write to localStorage (primary sync queue)
  const all = pruneOld(readAll())
  all.push(entry)
  writeAll(all)

  console.debug('[activity-log-local-written]', {
    localId,
    userId,
    module,
    action,
    createdAt,
  })

  // Write to Electron IPC file store (offline cross-user fallback)
  const api = getElectronAPI()
  if (api?.activityLogUserAction) {
    void api.activityLogUserAction({
      localId,
      userId,
      module,
      action,
      title: opts?.title,
      summary: opts?.summary,
      workspaceId: opts?.workspaceId,
      metadata: opts?.metadata,
      createdAt,
    }).catch(() => { /* IPC errors must not break user workflow */ })
  }

  // Async sync to server (fire-and-forget)
  if (_ambientToken) {
    void flushPendingActivities(_ambientToken)
  }
}

/**
 * Get all activity entries for a user on a specific local date.
 *
 * Priority:
 *   1. Server query (authoritative, cross-user)
 *   2. Electron IPC file store (local fallback on network failure)
 *   3. localStorage (last resort, only contains current user's own entries)
 *
 * Permission errors (403) and date errors (400) from the server are returned
 * as hard errors — they are NOT silently bypassed with a local fallback.
 *
 * @param userId  Target user ID
 * @param date    ISO date string (YYYY-MM-DD) in local time
 * @param token   Auth token for the current viewer
 */
export async function getActivitiesForUser(
  userId: string,
  date: string,
  token?: string,
): Promise<WorkActivityLog[]> {
  const effectiveToken = token ?? _ambientToken

  // ── 1. Server query ──────────────────────────────────────────────────────
  if (effectiveToken) {
    const serverResult = await activityGetUserActivities(userId, date, effectiveToken)

    if (serverResult.ok) {
      console.debug('[daily-report-activity-query]', {
        source: 'server',
        targetUserId: userId,
        date,
        activityCount: serverResult.activities.length,
        status: 'ok',
      })
      return serverResult.activities
    }

    if (serverResult.status === 403) {
      console.debug('[daily-report-activity-query]', {
        source: 'server',
        targetUserId: userId,
        date,
        activityCount: 0,
        status: 403,
        error: serverResult.error,
      })
      // Permission error — throw so caller can surface it to the user
      throw Object.assign(new Error(serverResult.error), { code: 'FORBIDDEN' })
    }

    if (serverResult.status === 400) {
      console.debug('[daily-report-activity-query]', {
        source: 'server',
        targetUserId: userId,
        date,
        activityCount: 0,
        status: 400,
        error: serverResult.error,
      })
      throw Object.assign(new Error(serverResult.error), { code: 'BAD_DATE' })
    }

    // Network failure — fall through to local fallback
    console.debug('[daily-report-activity-query]', {
      source: 'server-unreachable',
      targetUserId: userId,
      date,
      error: serverResult.error,
    })
  }

  // ── 2. Electron IPC file store (local fallback) ──────────────────────────
  const api = getElectronAPI()
  if (api?.activityGetUserActions) {
    try {
      const result = await api.activityGetUserActions({ userId, date })
      if (result.ok && Array.isArray(result.actions) && result.actions.length > 0) {
        console.debug('[daily-report-activity-query]', {
          source: 'local-fallback',
          targetUserId: userId,
          date,
          activityCount: result.actions.length,
          status: 'ipc-file',
        })
        return (result.actions ?? []) as WorkActivityLog[]
      }
    } catch { /* fall through */ }
  }

  // ── 3. localStorage last resort ──────────────────────────────────────────
  const all = pruneOld(readAll())
  const filtered = all.filter((e) => {
    if (e.userId !== userId) return false
    const d = new Date(e.createdAt)
    if (isNaN(d.getTime())) return false
    const localDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return localDate === date
  })
  console.debug('[daily-report-activity-query]', {
    source: 'local-fallback',
    targetUserId: userId,
    date,
    activityCount: filtered.length,
    status: 'localStorage',
  })
  return filtered
}

/** Get all entries for a user within the last 3 days (used for "has any recent activity"). */
export function getRecentActivities(userId: string): WorkActivityLog[] {
  const all = pruneOld(readAll())
  return all.filter((e) => e.userId === userId)
}

// ─── Report helpers ───────────────────────────────────────────────────────────

/** Human-readable label for a module. */
export function moduleLabel(module: WorkActivityModule): string {
  const labels: Record<WorkActivityModule, string> = {
    document: '文稿',
    mail: '邮件',
    chat: '通讯',
    ppt: 'PPT',
    image: '图片',
    data: '数据分析',
    knowledge: '知识库',
    delegation: '下班托管',
    system: '系统',
  }
  return labels[module] ?? module
}

/**
 * Summarise activity logs for a given date into a structured daily report.
 * Pure client-side aggregation — no AI call.
 */
export function buildDailyReportFromLogs(
  logs: WorkActivityLog[],
  opts: { targetUserId: string; targetUsername: string; viewerUserId: string; date: string },
): import('../modules/chat/types').GeneratedDailyReport {
  const mainWork: string[] = []
  const communication: string[] = []
  const artifacts: string[] = []
  const followUps: string[] = []
  const risks: string[] = []

  const groups: Record<string, WorkActivityLog[]> = {}
  for (const log of logs) {
    const key = `${log.module}::${log.action}`
    if (!groups[key]) groups[key] = []
    groups[key].push(log)
  }

  for (const [key, entries] of Object.entries(groups)) {
    const [mod, action] = key.split('::') as [WorkActivityModule, string]
    const count = entries.length
    const titles = [...new Set(entries.map((e) => e.title).filter(Boolean))].slice(0, 3)
    const titleSuffix = titles.length > 0 ? `（${titles.join('、')}）` : ''

    if (mod === 'chat') {
      communication.push(count === 1 ? `发送了 1 条消息${titleSuffix}` : `发送了 ${count} 条消息${titleSuffix}`)
    } else if (mod === 'mail') {
      if (action.includes('send') || action === 'sent' || action === 'send_mail') {
        communication.push(count > 1 ? `发送了 ${count} 封邮件${titleSuffix}` : `发送了邮件${titleSuffix}`)
      } else if (action.includes('receive') || action === 'received') {
        communication.push(count > 1 ? `收到了 ${count} 封邮件` : '收到了邮件')
      } else {
        communication.push(`邮件操作：${action}${titleSuffix}`)
      }
    } else if (mod === 'document') {
      if (action === 'saved' || action === 'edited' || action === 'save_document') {
        mainWork.push(`编辑并保存了文稿${titleSuffix}`)
        if (titles.length > 0) artifacts.push(`文稿：${titles.join('、')}`)
      } else if (action === 'created' || action === 'new_document') {
        mainWork.push(`新建了文稿${titleSuffix}`)
      } else if (action === 'exported') {
        artifacts.push(`导出了文稿${titleSuffix}`)
      } else if (action === 'ai_generated') {
        mainWork.push(`通过 AI 生成了文稿${titleSuffix}`)
      } else {
        mainWork.push(`文稿操作：${action}${titleSuffix}`)
      }
    } else if (mod === 'ppt') {
      mainWork.push(`生成了 PPT${titleSuffix}`)
      if (titles.length > 0) artifacts.push(`PPT：${titles.join('、')}`)
    } else if (mod === 'image') {
      mainWork.push(`生成了 ${count > 1 ? count + ' 张' : ''}图片${titleSuffix}`)
    } else if (mod === 'data') {
      mainWork.push(`进行了数据分析${titleSuffix}`)
    } else if (mod === 'knowledge') {
      mainWork.push(`使用了知识库${titleSuffix}`)
    } else if (mod === 'delegation') {
      mainWork.push(`${action === 'enabled' ? '开启' : '操作了'}下班托管`)
    } else {
      mainWork.push(`${moduleLabel(mod)}：${action}${titleSuffix}`)
    }
  }

  if (mainWork.length === 0 && communication.length === 0) {
    mainWork.push('当日无记录到 AI-Office 内工作活动')
  }

  const rawSummary = [
    mainWork.length > 0 ? `主要工作：${mainWork.join('；')}` : '',
    communication.length > 0 ? `沟通事项：${communication.join('；')}` : '',
    artifacts.length > 0 ? `产出文件：${artifacts.join('；')}` : '',
  ].filter(Boolean).join('\n')

  return {
    id: `report-${Date.now()}`,
    targetUserId: opts.targetUserId,
    targetUsername: opts.targetUsername,
    generatedByUserId: opts.viewerUserId,
    date: opts.date,
    sections: { mainWork, communication, artifacts, followUps, risks },
    rawSummary,
    createdAt: new Date().toISOString(),
  }
}

/**
 * Get the three selectable dates for daily report: today, yesterday, day-before-yesterday.
 * Returns ISO date strings (YYYY-MM-DD) in local time.
 */
export function getReportDateOptions(): { label: string; value: string }[] {
  const options: { label: string; value: string }[] = []
  for (let i = 0; i < 3; i++) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const label = i === 0 ? '今天' : i === 1 ? '昨天' : '前天'
    options.push({ label, value })
  }
  return options
}
