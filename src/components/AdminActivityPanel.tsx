/**
 * AdminActivityPanel
 * Server-side cross-user work log viewer (admin only).
 * Fetches data from AccountCenter /api/admin/activity/* endpoints via IPC.
 * Admin can view managed users' daily activity status and trigger server-side report generation.
 */

import React, { useState, useEffect, useCallback } from 'react'
import { useInternalSession } from '../contexts/InternalAccountContext'
import { adminGetConversations, adminGetMessages } from '../modules/chat/chatApiClient'
import type { ChatConversation, ChatMessage } from '../modules/chat/types'

// ── Types ─────────────────────────────────────────────────────────────────────

/** Status of a managed user's daily activity/report */
type ReportStatus = 'no_activity' | 'missing' | 'generated' | 'failed'

interface ManagedUserRow {
  id: string
  username: string
  display_name: string
  /** Server may return these directly */
  hasActivity?: boolean
  hasReport?: boolean
  reportStatus?: ReportStatus
  fileSummaryCount?: number
  lastUploadAt?: string | null
  failedReason?: string | null
  /** Legacy fields from /api/admin/activity/users */
  report_count?: string | number
  summary_count?: string | number
  diff_count?: string | number
  status?: string
  department_id?: string | null
}

interface OverviewData {
  dateKey: string
  activeUsers: number
  reportCount: number
  changedFiles: number
  errorCount: number
  topWorkTypes: Array<{ work_type: string; cnt: string }>
}

interface DailyDetail {
  report: ReportRow | null
  diffs: DiffRow[]
  summaries: SummaryRow[]
  jobs: JobRow[]
}

interface ReportRow {
  id: string
  username: string
  display_name: string
  date_key: string
  summary_text: string
  structured_json: {
    overview?: string
    mainWork?: string
    keyOutputs?: string
    yesterdayComparison?: string
    errors?: string
    tomorrowSuggestions?: string
  }
  generated_at: string
}

interface DiffRow {
  id: string
  date_key: string
  created_files: unknown[]
  modified_files: unknown[]
  deleted_files: unknown[]
  exported_files: unknown[]
}

interface SummaryRow {
  id: string
  file_name: string
  file_type: string
  change_type: string
  work_type: string
  topic: string
  summary: string
  output_value: string
  confidence: number
}

interface JobRow {
  id: string
  job_type: string
  status: string
  error_message: string | null
  retry_count: number
  started_at: string
}

type View = 'subordinates' | 'reports' | 'chat_audit' | 'detail' | 'delegation'

// ── Helpers ───────────────────────────────────────────────────────────────────

async function adminFetch<T>(endpoint: string): Promise<T> {
  const api = window.electronAPI?.activityAdminFetch
  if (!api) throw new Error('adminFetch API not available')
  const res = await api(endpoint)
  if (!res.ok) {
    if (res.httpStatus === 403) throw new Error('403')
    throw new Error(String(res.error ?? `HTTP ${res.httpStatus}`))
  }
  return res.data as T
}

async function adminPost<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  const api = window.electronAPI?.activityAdminPost
  if (!api) throw new Error('activityAdminPost API not available')
  const res = await api(endpoint, body)
  if (!res.ok) {
    if (res.httpStatus === 403) throw new Error('403')
    throw new Error(String(res.error ?? `HTTP ${res.httpStatus}`))
  }
  return res.data as T
}

function dateStr(d?: Date): string {
  return (d ?? new Date()).toISOString().slice(0, 10)
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('zh-CN', { hour12: false })
}

/** Derive activity/report status from legacy UserRow fields */
function deriveManagedUserRow(raw: ManagedUserRow): ManagedUserRow & {
  hasActivity: boolean
  hasReport: boolean
  reportStatus: ReportStatus
  fileSummaryCount: number
} {
  // If server already provided the new fields, use them directly
  if (raw.hasActivity !== undefined && raw.hasReport !== undefined && raw.reportStatus !== undefined) {
    return {
      ...raw,
      hasActivity: raw.hasActivity,
      hasReport: raw.hasReport,
      reportStatus: raw.reportStatus,
      fileSummaryCount: raw.fileSummaryCount ?? 0,
    }
  }
  // Legacy fallback: derive from counts
  const diffCount = Number(raw.diff_count ?? 0)
  const summaryCount = Number(raw.summary_count ?? 0)
  const reportCount = Number(raw.report_count ?? 0)
  const hasActivity = diffCount > 0 || summaryCount > 0
  const hasReport = reportCount > 0
  let reportStatus: ReportStatus
  if (!hasActivity) reportStatus = 'no_activity'
  else if (!hasReport) reportStatus = 'missing'
  else reportStatus = 'generated'
  return {
    ...raw,
    hasActivity,
    hasReport,
    reportStatus,
    fileSummaryCount: summaryCount,
  }
}

function reportStatusLabel(status: ReportStatus): { text: string; color: string; bg: string } {
  switch (status) {
    case 'no_activity': return { text: '今日暂无上传记录', color: '#9ca3af', bg: '#f3f4f6' }
    case 'missing':     return { text: '未生成日报', color: '#d97706', bg: '#fef3c7' }
    case 'generated':   return { text: '已生成', color: '#16a34a', bg: '#dcfce7' }
    case 'failed':      return { text: '生成失败', color: '#dc2626', bg: '#fee2e2' }
  }
}

// ── Shared inline styles ──────────────────────────────────────────────────────

const s = {
  btn: (active = false, color?: string): React.CSSProperties => ({
    padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 14,
    background: color ?? (active ? '#2563eb' : '#F3F4F6'),
    color: (color || active) ? '#fff' : '#374151',
    whiteSpace: 'nowrap' as const,
  }),
  smallBtn: (color?: string): React.CSSProperties => ({
    padding: '3px 8px', borderRadius: 5, border: 'none', cursor: 'pointer', fontSize: 14,
    background: color ?? '#F3F4F6', color: color ? '#fff' : '#374151', whiteSpace: 'nowrap' as const,
  }),
  card: (): React.CSSProperties => ({
    background: '#FFFFFF', borderRadius: 8, padding: 16, marginBottom: 12, border: '1px solid #E5E7EB',
  }),
  label: (): React.CSSProperties => ({
    fontSize: 14, color: '#6B7280', textTransform: 'uppercase' as const, letterSpacing: 1,
  }),
  badge: (color: string, bg: string): React.CSSProperties => ({
    display: 'inline-block', padding: '1px 7px', borderRadius: 999,
    fontSize: 14, fontWeight: 600, color, background: bg, whiteSpace: 'nowrap' as const,
  }),
}

// ── StatusBadge ───────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  active: '#22c55e', synced: '#3b82f6', inactive: '#6b7280',
  success: '#22c55e', failed: '#ef4444', pending: '#f59e0b', running: '#3b82f6',
}

const StatusBadge: React.FC<{ status: string }> = ({ status }) => (
  <span style={{
    background: STATUS_COLORS[status] ?? '#6b7280',
    color: '#fff', borderRadius: 4, padding: '1px 6px', fontSize: 14, fontWeight: 600,
  }}>
    {status}
  </span>
)

// ── Main component ────────────────────────────────────────────────────────────

export const AdminActivityPanel: React.FC<{ onClose: () => void; title?: string }> = ({ onClose, title }) => {
  const session = useInternalSession()
  const chatToken = session?.token ?? ''
  const [view, setView] = useState<View>('subordinates')
  const [dateKey, setDateKey] = useState(dateStr())

  // Subordinates view state
  const [managedUsers, setManagedUsers] = useState<ReturnType<typeof deriveManagedUserRow>[]>([])
  const [overview, setOverview] = useState<OverviewData | null>(null)

  // Reports list state
  const [reports, setReports] = useState<ReportRow[]>([])
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null)

  // Detail view state
  const [selectedUser, setSelectedUser] = useState<ManagedUserRow | null>(null)
  const [detail, setDetail] = useState<DailyDetail | null>(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generatingUserId, setGeneratingUserId] = useState<string | null>(null)
  const [bulkGenerating, setBulkGenerating] = useState(false)
  const [bulkResult, setBulkResult] = useState<string | null>(null)

  // Chat audit state
  const [chatConvs, setChatConvs] = useState<ChatConversation[]>([])
  const [chatActiveId, setChatActiveId] = useState<string | null>(null)
  const [chatMsgs, setChatMsgs] = useState<ChatMessage[]>([])
  const [chatUserFilter, setChatUserFilter] = useState('')
  const [chatDateFrom, setChatDateFrom] = useState('')
  const [chatLoading, setChatLoading] = useState(false)

  // Delegation view state
  const [delegationUsers, setDelegationUsers] = useState<Array<{
    id: string; username: string; display_name: string
    delegationStatus: string; reportStatus: string; lastSyncAt: string | null
  }>>([])
  const [delegationLoading, setDelegationLoading] = useState(false)
  const [delegationError, setDelegationError] = useState<string | null>(null)

  const [syncStatus, setSyncStatus] = useState<{
    lastSyncAt: number | null; pendingCount: number; lastSyncError: string | null
  } | null>(null)

  // ── Loaders ────────────────────────────────────────────────────────────────

  const loadSubordinates = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Try the new overview endpoint first (returns managed users with statuses)
      let rows: ManagedUserRow[] = []
      try {
        const res = await adminFetch<{ data: unknown }>(`/api/admin/activity/overview?dateKey=${dateKey}`)
        const data = res.data as Record<string, unknown>
        // New API: data.users is the managed users list
        if (Array.isArray(data?.users)) {
          rows = data.users as ManagedUserRow[]
        } else {
          // Old API returns global stats; fall through to users endpoint
          setOverview(data as unknown as OverviewData)
        }
      } catch (e) {
        if (String(e) === 'Error: 403') { setError('403'); return }
      }
      // If new API didn't return users, load from users endpoint
      if (rows.length === 0) {
        const res2 = await adminFetch<{ data: ManagedUserRow[] }>(`/api/admin/activity/users?dateKey=${dateKey}`)
        rows = Array.isArray(res2.data) ? res2.data : []
      }
      setManagedUsers(rows.map(deriveManagedUserRow))
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e)
      setError(msg === '403' ? '无权限' : msg)
    } finally {
      setLoading(false)
    }
  }, [dateKey])

  const loadReports = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await adminFetch<{ data: ReportRow[] }>(`/api/admin/activity/reports?dateFrom=${dateKey}&dateTo=${dateKey}&pageSize=100`)
      setReports(Array.isArray(res.data) ? res.data : [])
      setExpandedReportId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [dateKey])

  const loadDetail = useCallback(async (user: ManagedUserRow) => {
    setLoading(true)
    setError(null)
    setSelectedUser(user)
    setDetail(null)
    setView('detail')
    try {
      const res = await adminFetch<{ data: DailyDetail }>(`/api/admin/activity/users/${user.id}/daily/${dateKey}`)
      setDetail(res.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [dateKey])

  const loadChatConvs = useCallback(async () => {
    if (!chatToken) return
    setChatLoading(true)
    try {
      const data = await adminGetConversations(chatToken, {
        userId: chatUserFilter || undefined,
        dateFrom: chatDateFrom || undefined,
      })
      setChatConvs(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法加载聊天记录')
    } finally {
      setChatLoading(false)
    }
  }, [chatToken, chatUserFilter, chatDateFrom])

  const loadChatMsgs = useCallback(async (convId: string) => {
    if (!chatToken) return
    setChatActiveId(convId)
    try {
      const data = await adminGetMessages(chatToken, convId)
      setChatMsgs(data)
    } catch {
      setChatMsgs([])
    }
  }, [chatToken])

  // ── Report generation ──────────────────────────────────────────────────────

  const generateForUser = useCallback(async (user: ManagedUserRow, force = false) => {
    setGeneratingUserId(user.id)
    try {
      await adminPost('/api/admin/activity/reports/generate', {
        dateKey,
        scope: 'user',
        userId: user.id,
        force,
      })
      // Refresh the list to reflect new status
      await loadSubordinates()
    } catch (e) {
      setError(`生成日报失败（${user.display_name || user.username}）：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setGeneratingUserId(null)
    }
  }, [dateKey, loadSubordinates])

  const bulkGenerate = useCallback(async () => {
    setBulkGenerating(true)
    setBulkResult(null)
    setError(null)
    try {
      await adminPost('/api/admin/activity/reports/generate', {
        dateKey,
        scope: 'managed_users',
        force: false,
      })
      setBulkResult('✅ 一键生成指令已发送，服务端正在为下属生成日报…')
      await loadSubordinates()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg === '403' ? '无权限' : `生成失败：${msg}`)
    } finally {
      setBulkGenerating(false)
    }
  }, [dateKey, loadSubordinates])

  // ── Effects ────────────────────────────────────────────────────────────────

  useEffect(() => {
    void loadSubordinates()
    window.electronAPI?.activitySyncStatus?.().then((r) => {
      if (r.ok && r.status) setSyncStatus(r.status)
    }).catch(() => {})
    setBulkResult(null)
  }, [loadSubordinates])

  useEffect(() => {
    if (view === 'reports') void loadReports()
    if (view === 'chat_audit') void loadChatConvs()
  }, [view, loadReports, loadChatConvs])

  // ── Layout ─────────────────────────────────────────────────────────────────

  const panelStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 9999,
    background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
  }
  const boxStyle: React.CSSProperties = {
    background: '#FFFFFF', color: '#111827', borderRadius: 12,
    width: '92vw', maxWidth: 1140, height: '87vh', display: 'flex', flexDirection: 'column',
    boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
  }
  const headerStyle: React.CSSProperties = {
    padding: '12px 20px', borderBottom: '1px solid #E5E7EB', background: '#FFFFFF',
    display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap',
  }
  const bodyStyle: React.CSSProperties = { flex: 1, overflow: 'auto', padding: 20, background: '#F5F7FB' }

  const TAB_LABELS: Record<Exclude<View, 'detail'>, string> = {
    subordinates: '下属日报',
    reports: '日报列表',
    chat_audit: '聊天审计',
    delegation: '🤖 AI 托管',
  }

  return (
    <div style={panelStyle} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={boxStyle}>
        {/* ── Header ── */}
        <div style={headerStyle}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>{title ?? '🔧 工作日志管理后台'}</span>

          {/* Tab buttons */}
          <div style={{ display: 'flex', gap: 6 }}>
            {(Object.keys(TAB_LABELS) as Exclude<View, 'detail'>[]).map((v) => (
              <button key={v} style={s.btn(view === v)} onClick={() => setView(v)}>
                {TAB_LABELS[v]}
              </button>
            ))}
          </div>

          {/* Date + controls */}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="date"
              value={dateKey}
              onChange={(e) => setDateKey(e.target.value)}
              style={{ background: '#FFFFFF', border: '1px solid #D1D5DB', color: '#111827', borderRadius: 6, padding: '4px 8px', fontSize: 14 }}
            />
            <button style={s.btn(false, '#16a34a')}
              onClick={() => {
                void loadSubordinates()
                if (view === 'reports') void loadReports()
              }}>
              刷新
            </button>
            <button
              style={s.btn(false, '#7c3aed')}
              disabled={bulkGenerating}
              onClick={() => { void bulkGenerate() }}
            >
              {bulkGenerating ? '生成中…' : '⚡ 一键生成今日下属日报'}
            </button>
            <button style={{ ...s.btn(false), background: '#F3F4F6', color: '#374151' }} onClick={onClose}>✕</button>
          </div>
        </div>

        {/* ── Bulk-generate result ── */}
        {bulkResult && (
          <div style={{ padding: '6px 20px', background: '#f0fdf4', fontSize: 14, color: '#15803d', borderBottom: '1px solid #bbf7d0' }}>
            {bulkResult}
          </div>
        )}

        {/* ── Sync status bar ── */}
        {syncStatus && (
          <div style={{ padding: '5px 20px', background: '#F8FAFC', fontSize: 14, color: '#6B7280', borderBottom: '1px solid #E5E7EB' }}>
            本机同步：待上传 {syncStatus.pendingCount} 条
            {syncStatus.lastSyncAt && ` · 最后同步 ${fmt(new Date(syncStatus.lastSyncAt).toISOString())}`}
            {syncStatus.lastSyncError && <span style={{ color: '#dc2626' }}> · {syncStatus.lastSyncError}</span>}
          </div>
        )}

        {/* ── Body ── */}
        <div style={bodyStyle}>
          {loading && <div style={{ textAlign: 'center', color: '#6B7280', paddingTop: 40 }}>加载中…</div>}
          {error && (
            <div style={{ background: '#fef2f2', borderRadius: 8, padding: 12, marginBottom: 12, color: '#dc2626', border: '1px solid #fecaca' }}>
              ⚠ {error === '403' ? '无权限访问此功能，请检查账号权限。' : error}
            </div>
          )}

          {/* ── Subordinates view ── */}
          {view === 'subordinates' && !loading && (
            <div>
              {/* Stats row from overview if available */}
              {overview && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
                  {[
                    { label: '活跃用户', val: overview.activeUsers },
                    { label: '生成日报', val: overview.reportCount },
                    { label: '文件变更', val: overview.changedFiles },
                    { label: '异常任务', val: overview.errorCount },
                  ].map(({ label, val }) => (
                    <div key={label} style={s.card()}>
                      <div style={s.label()}>{label}</div>
                      <div style={{ fontSize: 24, fontWeight: 700, color: '#111827' }}>{val}</div>
                    </div>
                  ))}
                </div>
              )}

              {managedUsers.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#6b7280', marginTop: 40, fontSize: 14 }}>
                  今日暂无下属数据<br />
                  <span style={{ fontSize: 14 }}>员工使用 AI Office 后数据会自动同步到服务器</span>
                </div>
              ) : (
                <div style={{ background: '#FFFFFF', borderRadius: 8, border: '1px solid #E5E7EB', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                    <thead>
                      <tr style={{ color: '#6B7280', borderBottom: '1px solid #E5E7EB', background: '#F8FAFC' }}>
                        {['员工', '活动状态', '文件摘要', '日报状态', '最近上传', '操作'].map((h) => (
                          <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {managedUsers.map((u) => {
                        const statusInfo = reportStatusLabel(u.reportStatus)
                        const isGenerating = generatingUserId === u.id
                        return (
                          <tr key={u.id} style={{ borderBottom: '1px solid #EEF1F5', background: '#FFFFFF' }}>
                            <td style={{ padding: '9px 12px' }}>
                              <div style={{ fontWeight: 600, color: '#111827' }}>{u.display_name || u.username}</div>
                              <div style={{ fontSize: 14, color: '#9CA3AF' }}>@{u.username}</div>
                            </td>
                            <td style={{ padding: '9px 12px' }}>
                              {u.hasActivity
                                ? <span style={s.badge('#15803d', '#dcfce7')}>有活动</span>
                                : <span style={s.badge('#9ca3af', '#f3f4f6')}>无活动</span>}
                            </td>
                            <td style={{ padding: '9px 12px', color: '#2563eb', fontWeight: 600 }}>
                              {u.fileSummaryCount ?? 0}
                            </td>
                            <td style={{ padding: '9px 12px' }}>
                              <span style={s.badge(statusInfo.color, statusInfo.bg)}>{statusInfo.text}</span>
                              {u.reportStatus === 'failed' && u.failedReason && (
                                <div style={{ fontSize: 14, color: '#dc2626', marginTop: 2 }}>{u.failedReason}</div>
                              )}
                            </td>
                            <td style={{ padding: '9px 12px', color: '#6B7280', fontSize: 14 }}>
                              {fmt(u.lastUploadAt)}
                            </td>
                            <td style={{ padding: '9px 12px' }}>
                              <div style={{ display: 'flex', gap: 5 }}>
                                <button style={s.smallBtn()} onClick={() => void loadDetail(u)}>查看</button>
                                {u.hasActivity && !u.hasReport && (
                                  <button
                                    style={s.smallBtn('#2563eb')}
                                    disabled={isGenerating}
                                    onClick={() => void generateForUser(u)}
                                  >
                                    {isGenerating ? '生成中…' : '生成'}
                                  </button>
                                )}
                                {u.hasReport && (
                                  <button
                                    style={s.smallBtn('#6b7280')}
                                    disabled={isGenerating}
                                    onClick={() => void generateForUser(u, true)}
                                  >
                                    {isGenerating ? '生成中…' : '重新生成'}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── Reports list view ── */}
          {view === 'reports' && !loading && (
            <div>
              {reports.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#6b7280', marginTop: 40, fontSize: 14 }}>
                  {dateKey} 暂无 AI 日报<br />
                  <span style={{ fontSize: 14 }}>点击「一键生成今日下属日报」触发服务端生成</span>
                </div>
              ) : reports.map((r) => {
                const expanded = expandedReportId === r.id
                return (
                  <div key={r.id} style={{ ...s.card(), marginBottom: 8 }}>
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                      onClick={() => setExpandedReportId(expanded ? null : r.id)}
                    >
                      <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>
                        {r.display_name || r.username}
                        <span style={{ color: '#6B7280', fontWeight: 400, marginLeft: 8 }}>@{r.username}</span>
                      </span>
                      <span style={{ fontSize: 14, color: '#6B7280' }}>生成于 {fmt(r.generated_at)}</span>
                      <span style={{ fontSize: 14, color: '#2563eb' }}>{expanded ? '▲ 收起' : '▼ 展开'}</span>
                    </div>
                    {expanded && (
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #E5E7EB', fontSize: 14, lineHeight: 1.7, color: '#374151' }}>
                        {r.structured_json?.overview && <p style={{ marginBottom: 8 }}><strong>📋 今日概览</strong><br />{r.structured_json.overview}</p>}
                        {r.structured_json?.mainWork && <p style={{ marginBottom: 8 }}><strong>💼 主要工作</strong><br />{r.structured_json.mainWork}</p>}
                        {r.structured_json?.keyOutputs && <p style={{ marginBottom: 8 }}><strong>🎯 关键产出</strong><br />{r.structured_json.keyOutputs}</p>}
                        {r.structured_json?.yesterdayComparison && <p style={{ marginBottom: 8 }}><strong>📊 与昨日对比</strong><br />{r.structured_json.yesterdayComparison}</p>}
                        {r.structured_json?.errors && <p style={{ marginBottom: 8 }}><strong>⚠️ 异常</strong><br />{r.structured_json.errors}</p>}
                        {r.structured_json?.tomorrowSuggestions && <p style={{ marginBottom: 8 }}><strong>🔮 明日建议</strong><br />{r.structured_json.tomorrowSuggestions}</p>}
                        {!r.structured_json?.overview && r.summary_text && (
                          <p style={{ whiteSpace: 'pre-wrap', color: '#374151' }}>{r.summary_text}</p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* ── Detail view ── */}
          {view === 'detail' && !loading && selectedUser && (
            <div>
              <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <button style={s.btn(false)} onClick={() => setView('subordinates')}>← 返回</button>
                <span style={{ fontWeight: 700 }}>
                  {selectedUser.display_name || selectedUser.username} · {dateKey}
                </span>
                {detail?.report && (
                  <button
                    style={s.smallBtn('#6b7280')}
                    disabled={generatingUserId === selectedUser.id}
                    onClick={() => void generateForUser(selectedUser, true)}
                  >
                    重新生成
                  </button>
                )}
                {!detail?.report && detail && (detail.summaries.length > 0 || detail.diffs.length > 0) && (
                  <button
                    style={s.smallBtn('#2563eb')}
                    disabled={generatingUserId === selectedUser.id}
                    onClick={() => void generateForUser(selectedUser)}
                  >
                    {generatingUserId === selectedUser.id ? '生成中…' : '生成日报'}
                  </button>
                )}
              </div>

              {!detail && !loading && <div style={{ color: '#6B7280' }}>暂无数据</div>}
              {detail && (
                <>
                  {/* Report */}
                  {detail.report ? (
                    <div style={s.card()}>
                      <div style={{ ...s.label(), marginBottom: 8 }}>AI 日报</div>
                      <div style={{ fontSize: 14, lineHeight: 1.75, color: '#111827' }}>
                        {detail.report.structured_json?.overview && (
                          <div style={{ marginBottom: 12 }}>
                            <div style={{ fontWeight: 700, color: '#374151', marginBottom: 3 }}>📋 今日概览</div>
                            <div style={{ whiteSpace: 'pre-wrap' }}>{detail.report.structured_json.overview}</div>
                          </div>
                        )}
                        {detail.report.structured_json?.mainWork && (
                          <div style={{ marginBottom: 12 }}>
                            <div style={{ fontWeight: 700, color: '#374151', marginBottom: 3 }}>💼 主要工作</div>
                            <div style={{ whiteSpace: 'pre-wrap' }}>{detail.report.structured_json.mainWork}</div>
                          </div>
                        )}
                        {detail.report.structured_json?.keyOutputs && (
                          <div style={{ marginBottom: 12 }}>
                            <div style={{ fontWeight: 700, color: '#374151', marginBottom: 3 }}>🎯 关键产出</div>
                            <div style={{ whiteSpace: 'pre-wrap' }}>{detail.report.structured_json.keyOutputs}</div>
                          </div>
                        )}
                        {detail.report.structured_json?.yesterdayComparison && (
                          <div style={{ marginBottom: 12 }}>
                            <div style={{ fontWeight: 700, color: '#374151', marginBottom: 3 }}>📊 与昨日对比</div>
                            <div style={{ whiteSpace: 'pre-wrap' }}>{detail.report.structured_json.yesterdayComparison}</div>
                          </div>
                        )}
                        {detail.report.structured_json?.errors && (
                          <div style={{ marginBottom: 12 }}>
                            <div style={{ fontWeight: 700, color: '#dc2626', marginBottom: 3 }}>⚠️ 异常任务</div>
                            <div style={{ whiteSpace: 'pre-wrap', color: '#dc2626' }}>{detail.report.structured_json.errors}</div>
                          </div>
                        )}
                        {detail.report.structured_json?.tomorrowSuggestions && (
                          <div style={{ marginBottom: 12 }}>
                            <div style={{ fontWeight: 700, color: '#374151', marginBottom: 3 }}>🔮 明日建议</div>
                            <div style={{ whiteSpace: 'pre-wrap' }}>{detail.report.structured_json.tomorrowSuggestions}</div>
                          </div>
                        )}
                        {!detail.report.structured_json?.overview && detail.report.summary_text && (
                          <div style={{ whiteSpace: 'pre-wrap' }}>{detail.report.summary_text}</div>
                        )}
                      </div>
                      <div style={{ fontSize: 14, color: '#9CA3AF', marginTop: 8 }}>生成于 {fmt(detail.report.generated_at)}</div>
                    </div>
                  ) : (
                    <div style={{ ...s.card(), color: '#6B7280', fontSize: 14 }}>
                      {detail.summaries.length > 0 || detail.diffs.length > 0
                        ? '当日已有活动记录，尚未生成 AI 日报。点击「生成日报」按钮由服务端生成。'
                        : '当日暂无活动记录（今日暂无上传记录）。'}
                    </div>
                  )}

                  {/* File change diffs */}
                  {detail.diffs.length > 0 && (
                    <div style={s.card()}>
                      <div style={{ ...s.label(), marginBottom: 8 }}>文件变更记录（{detail.diffs.length}）</div>
                      {detail.diffs.map((d) => {
                        const allFiles = [
                          ...(Array.isArray(d.created_files) ? d.created_files : []).map((f) => ({ ...(f as object), _type: 'created' })),
                          ...(Array.isArray(d.modified_files) ? d.modified_files : []).map((f) => ({ ...(f as object), _type: 'modified' })),
                          ...(Array.isArray(d.deleted_files) ? d.deleted_files : []).map((f) => ({ ...(f as object), _type: 'deleted' })),
                          ...(Array.isArray(d.exported_files) ? d.exported_files : []).map((f) => ({ ...(f as object), _type: 'exported' })),
                        ] as Array<Record<string, unknown>>
                        if (allFiles.length === 0) return null
                        return (
                          <div key={d.id} style={{ borderBottom: '1px solid #EEF1F5', paddingBottom: 6, marginBottom: 6 }}>
                            {allFiles.map((f, i) => (
                              <div key={i} style={{ display: 'flex', gap: 6, padding: '3px 0', fontSize: 14, alignItems: 'center' }}>
                                <StatusBadge status={String(f._type)} />
                                <span style={{ color: '#374151' }}>{String(f.fileName ?? f.relativePath ?? '—')}</span>
                              </div>
                            ))}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* File summaries */}
                  {detail.summaries.length > 0 && (
                    <div style={s.card()}>
                      <div style={{ ...s.label(), marginBottom: 8 }}>文件摘要（{detail.summaries.length}）</div>
                      {detail.summaries.map((sm) => (
                        <div key={sm.id} style={{ borderBottom: '1px solid #EEF1F5', padding: '8px 0', fontSize: 14 }}>
                          <div style={{ display: 'flex', gap: 6, marginBottom: 4, alignItems: 'center' }}>
                            <span style={{ fontWeight: 600, color: '#111827' }}>{sm.file_name}</span>
                            <StatusBadge status={sm.change_type} />
                            <StatusBadge status={sm.work_type || 'other'} />
                          </div>
                          {sm.topic && <div style={{ color: '#6B7280', marginBottom: 2 }}>主题：{sm.topic}</div>}
                          {sm.summary && <div style={{ color: '#374151' }}>{sm.summary}</div>}
                          {sm.output_value && <div style={{ color: '#16a34a', marginTop: 2 }}>产出：{sm.output_value}</div>}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Failed jobs */}
                  {detail.jobs.filter((j) => j.status === 'failed').length > 0 && (
                    <div style={s.card()}>
                      <div style={{ ...s.label(), marginBottom: 8 }}>异常任务</div>
                      {detail.jobs.filter((j) => j.status === 'failed').map((j) => (
                        <div key={j.id} style={{ padding: '6px 0', borderBottom: '1px solid #EEF1F5', fontSize: 14 }}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <StatusBadge status={j.status} />
                            <span style={{ color: '#111827' }}>{j.job_type}</span>
                            <span style={{ color: '#6B7280' }}>重试 {j.retry_count} 次</span>
                          </div>
                          {j.error_message && <div style={{ color: '#dc2626', marginTop: 2 }}>{j.error_message}</div>}
                        </div>
                      ))}
                    </div>
                  )}

                  {detail.summaries.length === 0 && detail.diffs.length === 0 && detail.jobs.length === 0 && !detail.report && (
                    <div style={{ color: '#9CA3AF', fontSize: 14 }}>该用户当日暂无数据上传</div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Chat audit view ── */}
          {view === 'chat_audit' && (
            <div style={{ display: 'flex', height: '100%', gap: 0 }}>
              <div style={{ width: 280, borderRight: '1px solid #E5E7EB', display: 'flex', flexDirection: 'column', flexShrink: 0, background: '#FFFFFF' }}>
                <div style={{ padding: '10px 12px', borderBottom: '1px solid #E5E7EB', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <input
                    placeholder="按用户名筛选"
                    value={chatUserFilter}
                    onChange={(e) => setChatUserFilter(e.target.value)}
                    style={{ background: '#FFFFFF', border: '1px solid #D1D5DB', color: '#111827', borderRadius: 6, padding: '5px 8px', fontSize: 14, outline: 'none' }}
                  />
                  <input
                    type="date"
                    value={chatDateFrom}
                    onChange={(e) => setChatDateFrom(e.target.value)}
                    style={{ background: '#FFFFFF', border: '1px solid #D1D5DB', color: '#111827', borderRadius: 6, padding: '5px 8px', fontSize: 14, outline: 'none' }}
                  />
                  <button style={{ ...s.btn(false, '#2563eb'), fontSize: 14, padding: '4px 8px' }} onClick={() => { void loadChatConvs() }}>
                    查询
                  </button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto' as const }}>
                  {chatLoading && <div style={{ padding: 16, color: '#6B7280', fontSize: 14, textAlign: 'center' }}>加载中…</div>}
                  {!chatLoading && chatConvs.length === 0 && (
                    <div style={{ padding: 20, color: '#9CA3AF', fontSize: 14, textAlign: 'center' }}>暂无聊天记录</div>
                  )}
                  {chatConvs.map((c) => {
                    const label = c.title || (c.members ?? []).map((m) => m.username).join(', ') || c.id.slice(0, 8)
                    return (
                      <div
                        key={c.id}
                        onClick={() => { void loadChatMsgs(c.id) }}
                        style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #EEF1F5',
                          background: chatActiveId === c.id ? '#EAF2FF' : 'transparent' }}
                      >
                        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2, color: '#111827' }}>{label}</div>
                        <div style={{ fontSize: 14, color: '#6B7280' }}>
                          {c.conversation_type === 'group' ? '群聊' : '私信'}
                          {c.message_count !== undefined ? ` · ${c.message_count} 条` : ''}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#F5F7FB' }}>
                {!chatActiveId ? (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF', fontSize: 14 }}>
                    选择一个会话查看消息（只读）
                  </div>
                ) : (
                  <div style={{ flex: 1, overflowY: 'auto' as const, padding: 16 }}>
                    {chatMsgs.length === 0 && <div style={{ color: '#9CA3AF', fontSize: 14 }}>暂无消息</div>}
                    {chatMsgs.map((m) => (
                      <div key={m.id} style={{ marginBottom: 10, fontSize: 14 }}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', marginBottom: 2 }}>
                          <span style={{ fontWeight: 600, color: '#2563eb' }}>{m.senderUsername}</span>
                          <span style={{ color: '#9CA3AF', fontSize: 14 }}>{fmt(m.createdAt)}</span>
                        </div>
                        <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 8, padding: '8px 12px', lineHeight: 1.6, color: '#374151' }}>
                          {m.body}
                          {m.attachment?.fileName && (
                            <div style={{ fontSize: 14, color: '#9CA3AF', marginTop: 4 }}>📎 {m.attachment.fileName} ({m.attachment.mimeType})</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ padding: '8px 16px', borderTop: '1px solid #E5E7EB', fontSize: 14, color: '#9CA3AF', background: '#FFFFFF' }}>
                  📋 审计只读模式 · 不可发送消息
                </div>
              </div>
            </div>
          )}
          {/* ── AI 托管日报 view ── */}
          {view === 'delegation' && (
            <div>
              <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#1b2d42' }}>🤖 AI 托管状态 — 下属列表</span>
                <button
                  style={{ ...s.btn(false, '#1a6fc4'), fontSize: 14 }}
                  disabled={delegationLoading}
                  onClick={async () => {
                    setDelegationLoading(true)
                    setDelegationError(null)
                    try {
                      const res = await adminFetch<{ data: unknown }>(`/api/admin/activity/users?dateKey=${dateKey}`)
                      const rawUsers = Array.isArray((res as any).data) ? (res as any).data : []
                      setDelegationUsers(rawUsers.map((u: any) => ({
                        id: u.id,
                        username: u.username,
                        display_name: u.display_name,
                        delegationStatus: u.delegation_status ?? 'unknown',
                        reportStatus: u.reportStatus ?? (u.report_count > 0 ? 'generated' : 'missing'),
                        lastSyncAt: u.lastUploadAt ?? u.last_sync_at ?? null,
                      })))
                    } catch (e) {
                      setDelegationError(e instanceof Error ? e.message : String(e))
                    } finally {
                      setDelegationLoading(false)
                    }
                  }}
                >
                  {delegationLoading ? '加载中…' : '刷新'}
                </button>
              </div>

              {delegationError && (
                <div style={{ background: '#fef2f2', borderRadius: 8, padding: 12, marginBottom: 12, color: '#dc2626', border: '1px solid #fecaca', fontSize: 14 }}>
                  ⚠ {delegationError}
                </div>
              )}

              {delegationLoading && (
                <div style={{ textAlign: 'center', color: '#6B7280', paddingTop: 40 }}>加载中…</div>
              )}

              {!delegationLoading && delegationUsers.length === 0 && (
                <div style={{ textAlign: 'center', color: '#9ca3af', marginTop: 40, fontSize: 14 }}>
                  暂无下属 AI 托管数据<br />
                  <span style={{ fontSize: 14 }}>员工开启 AI 下班托管后，数据将显示在这里</span>
                </div>
              )}

              {delegationUsers.length > 0 && (
                <div style={{ background: '#FFFFFF', borderRadius: 8, border: '1px solid #E5E7EB', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                    <thead>
                      <tr style={{ color: '#6B7280', borderBottom: '1px solid #E5E7EB', background: '#F8FAFC' }}>
                        {['员工', '托管状态', '今日记录', '日报状态', '最后同步', '操作'].map((h) => (
                          <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {delegationUsers.map((u) => {
                        const isDelegated = u.delegationStatus === 'ai_delegated'
                        const hasReport = u.reportStatus === 'generated'
                        return (
                          <tr key={u.id} style={{ borderBottom: '1px solid #EEF1F5', background: '#FFFFFF' }}>
                            <td style={{ padding: '9px 12px' }}>
                              <div style={{ fontWeight: 600, color: '#111827' }}>{u.display_name || u.username}</div>
                              <div style={{ fontSize: 14, color: '#9CA3AF' }}>@{u.username}</div>
                            </td>
                            <td style={{ padding: '9px 12px' }}>
                              {isDelegated
                                ? <span style={s.badge('#c46a00', '#fff3e0')}>🤖 AI 托管中</span>
                                : <span style={s.badge('#6b7280', '#f3f4f6')}>不在托管</span>}
                            </td>
                            <td style={{ padding: '9px 12px' }}>
                              {u.lastSyncAt
                                ? <span style={s.badge('#2563eb', '#eff6ff')}>已上传</span>
                                : <span style={s.badge('#9ca3af', '#f3f4f6')}>未上传</span>}
                            </td>
                            <td style={{ padding: '9px 12px' }}>
                              {hasReport
                                ? <span style={s.badge('#16a34a', '#dcfce7')}>已生成</span>
                                : <span style={s.badge('#d97706', '#fef3c7')}>未生成</span>}
                            </td>
                            <td style={{ padding: '9px 12px', color: '#6B7280', fontSize: 14 }}>
                              {fmt(u.lastSyncAt)}
                            </td>
                            <td style={{ padding: '9px 12px', display: 'flex', gap: 6 }}>
                              <button
                                style={{ ...s.smallBtn('#2563eb'), fontSize: 14 }}
                                onClick={() => {
                                  void loadDetail({
                                    id: u.id,
                                    username: u.username,
                                    display_name: u.display_name,
                                    hasActivity: !!u.lastSyncAt,
                                    hasReport,
                                    reportStatus: hasReport ? 'generated' : 'missing',
                                    fileSummaryCount: 0,
                                    lastUploadAt: u.lastSyncAt,
                                  })
                                }}
                              >
                                查看日报
                              </button>
                              <button
                                style={{ ...s.smallBtn('#7c3aed'), fontSize: 14 }}
                                disabled={generatingUserId === u.id}
                                onClick={() => {
                                  void generateForUser({
                                    id: u.id, username: u.username, display_name: u.display_name,
                                    hasActivity: !!u.lastSyncAt, hasReport: false,
                                    reportStatus: 'missing', fileSummaryCount: 0,
                                  }, true)
                                }}
                              >
                                {generatingUserId === u.id ? '生成中…' : '重新生成'}
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <div style={{ marginTop: 20, padding: 14, background: '#f0f7ff', border: '1px solid #c0d9f5', borderRadius: 10, fontSize: 14, color: '#1a4a7a', lineHeight: 1.7 }}>
                <strong>说明：</strong>AI 托管日报由员工开启"下班托管"时客户端自动上传，仅包含已上传的文件变更、邮件统计和 AI 使用记录。
                管理员只能查看自己直属下属的日报，不能查看跨部门员工数据。
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default AdminActivityPanel
