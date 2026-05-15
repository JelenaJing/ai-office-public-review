/**
 * workActivitySyncClient — AccountCenter activity API client.
 *
 * Endpoints (server-side, no frontend changes needed):
 *   POST /api/activity/log/batch   — write activity entries; user_id from JWT
 *   GET  /api/activity/user/:id    — read activities for a user (permission-gated)
 *
 * All requests carry Authorization: Bearer <token>.
 */

import { ACCOUNT_CENTER_URL } from '../accountCenterConfig'
import type { WorkActivityLog } from '../modules/chat/types'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BatchActivityEntry {
  localId: string
  workspaceId?: string
  module: string
  action: string
  title?: string
  summary?: string
  metadata?: Record<string, unknown>
  createdAt: string
}

export interface BatchSyncResultItem {
  localId: string
  serverId: string
  updated?: boolean
}

export interface BatchSyncResponse {
  synced: BatchSyncResultItem[]
}

export type GetActivitiesResult =
  | { ok: true; activities: WorkActivityLog[]; source: 'server' }
  | { ok: false; status: 403 | 400 | 'network'; error: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function accountFetch<T>(
  endpoint: string,
  token: string,
  options?: RequestInit,
): Promise<{ response: Response; data: T }> {
  const url = `${ACCOUNT_CENTER_URL}${endpoint}`
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options?.headers ?? {}),
    },
  })
  const data = await response.json().catch(() => ({})) as T
  return { response, data }
}

// ─── Batch write ──────────────────────────────────────────────────────────────

/**
 * Write a batch of activity entries to the server.
 * user_id is derived from the JWT token on the server; do NOT include userId in the body.
 *
 * @returns array of { localId, serverId } for successfully written entries
 */
export async function activityLogBatch(
  activities: BatchActivityEntry[],
  token: string,
): Promise<BatchSyncResultItem[]> {
  if (activities.length === 0) return []

  // Chunk into max 100 per request
  const chunks: BatchActivityEntry[][] = []
  for (let i = 0; i < activities.length; i += 100) {
    chunks.push(activities.slice(i, i + 100))
  }

  const results: BatchSyncResultItem[] = []
  for (const chunk of chunks) {
    const { response, data } = await accountFetch<BatchSyncResponse>(
      '/api/activity/log/batch',
      token,
      { method: 'POST', body: JSON.stringify({ activities: chunk }) },
    )
    if (!response.ok) {
      const errData = data as unknown as { error?: string; message?: string }
      throw new Error(`activity batch sync failed ${response.status}: ${errData?.error ?? errData?.message ?? 'unknown'}`)
    }
    const synced = (data as BatchSyncResponse).synced ?? []
    results.push(...synced)
  }
  return results
}

// ─── Read user activities ──────────────────────────────────────────────────────

/**
 * Fetch activity entries for a specific user on a specific date.
 *
 * Permission rules (enforced server-side):
 *   - User can read their own activities
 *   - Direct manager can read subordinate's activities
 *   - Others → 403
 *   - date must be today/yesterday/day-before-yesterday → else 400
 *
 * Returns:
 *   { ok: true, activities, source: 'server' }          — success
 *   { ok: false, status: 403, error }                   — no permission (do not fall back locally)
 *   { ok: false, status: 400, error }                   — invalid date (do not fall back locally)
 *   { ok: false, status: 'network', error }             — network error (caller may fall back locally)
 */
export async function activityGetUserActivities(
  userId: string,
  date: string,
  token: string,
): Promise<GetActivitiesResult> {
  try {
    const endpoint = `/api/activity/user/${encodeURIComponent(userId)}?date=${encodeURIComponent(date)}`
    const { response, data } = await accountFetch<unknown>(endpoint, token)

    if (response.status === 403) {
      const errData = data as { error?: string; message?: string }
      return { ok: false, status: 403, error: errData?.error ?? errData?.message ?? '无权查看该用户的工作活动' }
    }
    if (response.status === 400) {
      const errData = data as { error?: string; message?: string }
      return { ok: false, status: 400, error: errData?.error ?? errData?.message ?? '日期不在允许范围内（今天/昨天/前天）' }
    }
    if (!response.ok) {
      const errData = data as { error?: string; message?: string }
      return { ok: false, status: 'network', error: `服务器错误 ${response.status}: ${errData?.error ?? ''}` }
    }

    // Normalise server response — server may return { activities: [...] } or [...]
    const rawList: unknown[] = Array.isArray(data)
      ? data
      : Array.isArray((data as { activities?: unknown[] }).activities)
        ? (data as { activities: unknown[] }).activities
        : []

    const activities = rawList.map((item) => {
      const r = item as Record<string, unknown>
      return {
        localId: String(r.localId ?? r.local_id ?? r.id ?? ''),
        id: String(r.id ?? r.serverId ?? r.server_id ?? ''),
        userId: String(r.userId ?? r.user_id ?? userId),
        workspaceId: r.workspaceId as string | undefined ?? r.workspace_id as string | undefined,
        module: String(r.module ?? 'system') as WorkActivityLog['module'],
        action: String(r.action ?? ''),
        title: r.title as string | undefined,
        summary: r.summary as string | undefined,
        metadata: r.metadata as Record<string, unknown> | undefined,
        createdAt: String(r.createdAt ?? r.created_at ?? new Date().toISOString()),
        syncStatus: 'synced' as const,
        serverId: String(r.id ?? r.serverId ?? r.server_id ?? ''),
      } satisfies WorkActivityLog
    })

    return { ok: true, activities, source: 'server' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, status: 'network', error: msg }
  }
}
