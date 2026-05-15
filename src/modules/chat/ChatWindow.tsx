/**
 * ChatWindow — Internal REST-based chat UI.
 * Uses AccountCenter /api/chat/* endpoints directly from the renderer.
 * Only shown to users with chat.view_own permission.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useInternalSession } from '../../contexts/InternalAccountContext'
import { useHasPermission } from '../../utils/permissions'
import { ACCOUNT_CENTER_URL } from '../../accountCenterConfig'
import {
  getConversations,
  createConversation,
  ensureDirectConversation,
  getMessages,
  sendMessage,
  uploadChatAttachment,
  getChatContacts,
  hideConversation,
  dissolveConversation,
} from './chatApiClient'
import type { ChatConversation, ChatContact, ChatMessage, ChatAttachment } from './types'
import { canGenerateDailyReport } from './types'
import { ALLOW_ALL_WORK_REPORTS } from '../../config'
import { getChatContactsAC, getOrgUnits, getOrgUnitMembers, getPeople, getPersonDetail } from '../../services/accountCenterClient'
import type { ChatContactAC, OrgUnit, OrgUnitMember, PersonProfile } from '../../types/personDirectory'
import { setPendingCompose } from '../../services/pendingEmailCompose'

const IS_DEV = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV ?? false

/** Safely format a time string; returns "" on invalid/missing input (never "Invalid Date"). */
function fmtTime(iso: string | undefined | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

/** Safely format a date divider label; returns null on invalid/missing input. */
function safeFmtDate(iso: string | undefined | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return '今天'
  const yest = new Date(today); yest.setDate(today.getDate() - 1)
  if (d.toDateString() === yest.toDateString()) return '昨天'
  return d.toLocaleDateString('zh-CN')
}

const S = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 9998,
    background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center',
  } as React.CSSProperties,
  window: {
    background: '#F5F7FB', color: '#111827', borderRadius: 14,
    width: '90vw', maxWidth: 1060, height: '84vh', display: 'flex', flexDirection: 'column',
    boxShadow: '0 8px 32px rgba(0,0,0,0.12)', overflow: 'hidden',
    border: '1px solid #E5E7EB',
  } as React.CSSProperties,
  header: {
    padding: '12px 18px', borderBottom: '1px solid #E5E7EB',
    display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
    background: '#FFFFFF',
  } as React.CSSProperties,
  body: { flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 } as React.CSSProperties,
  sidebar: {
    width: 280, borderRight: '1px solid #E5E7EB', display: 'flex',
    flexDirection: 'column', flexShrink: 0, background: '#FFFFFF',
  } as React.CSSProperties,
  sidebarTop: {
    padding: '10px 12px', borderBottom: '1px solid #EEF1F5', display: 'flex', gap: 6,
  } as React.CSSProperties,
  convList: { flex: 1, overflowY: 'auto' as const, background: '#FFFFFF' } as React.CSSProperties,
  convItem: (active: boolean): React.CSSProperties => ({
    padding: '11px 14px', cursor: 'pointer', borderBottom: '1px solid #EEF1F5',
    background: active ? '#EAF2FF' : 'transparent',
    transition: 'background 0.12s',
  }),
  msgArea: {
    flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0,
    background: '#F5F7FB',
  } as React.CSSProperties,
  msgHeader: {
    padding: '11px 18px', borderBottom: '1px solid #E5E7EB', flexShrink: 0,
    display: 'flex', alignItems: 'center', gap: 8, background: '#FFFFFF',
  } as React.CSSProperties,
  msgList: { flex: 1, overflowY: 'auto' as const, padding: '16px 20px', minHeight: 0 } as React.CSSProperties,
  msgBubble: (mine: boolean): React.CSSProperties => ({
    maxWidth: '68%', background: mine ? '#2563eb' : '#FFFFFF',
    color: mine ? '#fff' : '#111827',
    borderRadius: mine ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
    padding: '9px 14px', marginBottom: 6,
    alignSelf: mine ? 'flex-end' : 'flex-start',
    fontSize: 16, lineHeight: 1.55, wordBreak: 'break-word' as const,
    boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
    border: mine ? 'none' : '1px solid #E5E7EB',
  }),
  inputRow: {
    padding: '10px 16px', borderTop: '1px solid #E5E7EB',
    display: 'flex', gap: 8, alignItems: 'flex-end', flexShrink: 0,
    background: '#FFFFFF',
  } as React.CSSProperties,
  input: {
    flex: 1, background: '#FFFFFF', border: '1px solid #D1D5DB', color: '#111827',
    borderRadius: 10, padding: '9px 13px', fontSize: 16, resize: 'none' as const, outline: 'none',
    fontFamily: 'inherit',
  } as React.CSSProperties,
  searchInput: {
    width: '100%', background: '#FFFFFF', border: '1px solid #D1D5DB', color: '#111827',
    borderRadius: 8, padding: '7px 10px', fontSize: 14, outline: 'none',
    boxSizing: 'border-box' as const,
  } as React.CSSProperties,
  btn: (primary?: boolean, small?: boolean): React.CSSProperties => ({
    padding: small ? '5px 11px' : '8px 15px',
    borderRadius: 8, border: 'none', cursor: 'pointer',
    fontSize: 14, fontWeight: 600,
    background: primary ? '#2563eb' : '#F3F4F6',
    color: primary ? '#fff' : '#374151',
    whiteSpace: 'nowrap' as const, flexShrink: 0,
  }),
  chip: {
    background: '#EAF2FF', color: '#1d4ed8', borderRadius: 20, padding: '3px 10px',
    fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 5, margin: '2px',
    border: '1px solid #bfdbfe',
  } as React.CSSProperties,
  iconBtn: (disabled?: boolean): React.CSSProperties => ({
    width: 32, height: 32, borderRadius: 8, border: '1px solid #D1D5DB',
    background: disabled ? '#F9FAFB' : '#FFFFFF', cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0,
    color: disabled ? '#D1D5DB' : '#6B7280', transition: 'background 0.12s',
    padding: 0,
  }),
  fileCard: (mine: boolean): React.CSSProperties => ({
    background: mine ? '#1d4ed8' : '#FFFFFF',
    border: mine ? 'none' : '1px solid #E5E7EB',
    borderRadius: 10, padding: '10px 13px', maxWidth: 260,
    display: 'flex', alignItems: 'center', gap: 10,
  }),
  previewBar: {
    padding: '8px 14px', background: '#F0F9FF', borderTop: '1px solid #BAE6FD',
    display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
  } as React.CSSProperties,
  imgThumb: {
    maxWidth: 220, maxHeight: 160, borderRadius: 8, display: 'block',
    border: '1px solid #E5E7EB', cursor: 'pointer',
    objectFit: 'contain' as const,
  } as React.CSSProperties,
  tab: (active: boolean): React.CSSProperties => ({
    flex: 1, padding: '7px 0', border: 'none', cursor: 'pointer', fontSize: 14,
    fontWeight: active ? 700 : 500,
    background: active ? '#EAF2FF' : 'transparent',
    color: active ? '#2563eb' : '#6B7280',
    borderBottom: active ? '2px solid #2563eb' : '2px solid transparent',
    transition: 'all 0.12s',
  }),
  rightPanel: {
    width: 260, borderLeft: '1px solid #E5E7EB', display: 'flex',
    flexDirection: 'column', flexShrink: 0, background: '#FFFFFF', overflowY: 'auto' as const,
  } as React.CSSProperties,
}

type DirectoryChatPerson = Pick<ChatContactAC, 'personId' | 'name' | 'enName' | 'aiEmail' | 'accountUserId' | 'username'>

interface ResolvedChatTarget {
  targetUserId: string
  targetUsername?: string
  displayName?: string
}

function extractUsernameFromEmail(email: string | undefined): string | undefined {
  const trimmed = email?.trim()
  if (!trimmed || !trimmed.includes('@')) return undefined
  return trimmed.split('@')[0] || undefined
}

function readableChatStartError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/Failed to fetch|NetworkError|无法连接聊天服务|Empty reply/i.test(message)) {
    return '无法创建会话，请检查聊天服务是否已启动'
  }
  if (/登录已过期|未授权|401/.test(message)) return '登录已过期，请重新登录后再发消息'
  if (/Forbidden|403|无权限/i.test(message)) return '当前账号无权限创建该会话'
  return message || '创建会话失败'
}

async function resolveDirectoryChatTarget(token: string, person: DirectoryChatPerson): Promise<ResolvedChatTarget> {
  const detail = await getPersonDetail(token, person.personId)
  const targetUserId = person.accountUserId ?? detail.accountIdentity?.userId
  const targetUsername =
    person.username ??
    detail.accountIdentity?.username ??
    extractUsernameFromEmail(detail.mailIdentity?.aiEmail ?? detail.aiEmail ?? person.aiEmail)

  if (!targetUserId) {
    throw new Error('无法创建会话：该联系人缺少内部账号用户 ID')
  }

  return {
    targetUserId,
    targetUsername,
    displayName: detail.name || person.name || person.enName || targetUsername,
  }
}

/* ─── ProtectedChatImage ────────────────────────────────────────────────────
 * Loads a server-protected image using fetch + Authorization token,
 * creates a local blob URL for <img src>. Bare <img src> would fail because
 * the preview endpoint requires Bearer token and can't receive it via src attr.
 */
const ProtectedChatImage: React.FC<{
  previewUrl: string
  fileName: string
  token: string
  style?: React.CSSProperties
  /** Called with the already-fetched blob URL so the lightbox can reuse it. */
  onOpen?: (blobUrl: string) => void
}> = ({ previewUrl, fileName, token, style, onOpen }) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!previewUrl) { setLoading(false); setError('无预览地址'); return }
    let cancelled = false
    let createdUrl: string | null = null
    setLoading(true); setError(null); setBlobUrl(null)
    fetch(previewUrl, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.blob()
      })
      .then((blob) => {
        if (cancelled) return
        createdUrl = URL.createObjectURL(blob)
        setBlobUrl(createdUrl)
        setLoading(false)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : '加载失败')
        setLoading(false)
      })
    return () => {
      cancelled = true
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
  }, [previewUrl, token])

  if (loading) {
    return (
      <div style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F3F4F6', minWidth: 80, minHeight: 60, fontSize: 14, color: '#9CA3AF', borderRadius: 8 }}>
        图片加载中…
      </div>
    )
  }
  if (error || !blobUrl) {
    return (
      <div style={{ ...style, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#FEF2F2', minWidth: 80, minHeight: 60, padding: '8px 12px', borderRadius: 8 }}>
        <div style={{ fontSize: 14, color: '#EF4444' }}>图片加载失败</div>
        {error && <div style={{ fontSize: 14, color: '#9CA3AF', marginTop: 2 }}>{error}</div>}
      </div>
    )
  }
  return (
    <img
      src={blobUrl}
      alt={fileName}
      style={{ ...style, cursor: 'pointer' }}
      onClick={() => onOpen?.(blobUrl)}
    />
  )
}

/* ─── New conversation modal ───────────────────────────────────────────────── */
function NewConvModal({
  token, currentUserId, onCreated, onClose,
}: {
  token: string; currentUserId: string
  onCreated: (c: ChatConversation) => void; onClose: () => void
}) {
  const [contacts, setContacts] = useState<ChatContactAC[]>([])
  const [contactsError, setContactsError] = useState('')
  const [contactsLoading, setContactsLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [type, setType] = useState<'direct' | 'group'>('direct')
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setContactsLoading(true)
    setContactsError('')
    getChatContactsAC(token)
      .then((list) => {
        // Exclude current user from picker
        setContacts(list.filter((x) => x.personId !== currentUserId))
      })
      .catch((e: unknown) => {
        setContactsError(e instanceof Error ? e.message : '联系人加载失败')
      })
      .finally(() => setContactsLoading(false))
  }, [token, currentUserId])

  const toggle = (id: string, disabled: boolean) => {
    if (disabled) return
    if (type === 'direct') {
      setSelectedIds((p) => (p[0] === id ? [] : [id]))
    } else {
      setSelectedIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id])
    }
  }

  const submit = async () => {
    if (selectedIds.length === 0) { setError('请至少选择一个成员'); return }
    if (type === 'direct' && selectedIds.length !== 1) { setError('私信只能选择一个用户'); return }
    setLoading(true); setError('')
    try {
      const selectedTargets = await Promise.all(
        contacts
          .filter((contact) => selectedIds.includes(contact.personId))
          .map((contact) => resolveDirectoryChatTarget(token, contact)),
      )
      const memberIds = selectedTargets.map((target) => target.targetUserId)
      const conv = type === 'direct'
        ? await ensureDirectConversation(token, selectedTargets[0])
        : await createConversation(token, {
            conversationType: type,
            title: title.trim() || undefined,
            memberIds,
          })
      onCreated(conv)
    } catch (e) {
      setError(readableChatStartError(e))
    } finally {
      setLoading(false)
    }
  }

  const filtered = contacts.filter((u) =>
    !search ||
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    (u.enName ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (u.department ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (u.position ?? '').toLowerCase().includes(search.toLowerCase())
  )

  const selectedContacts = contacts.filter((c) => selectedIds.includes(c.personId))

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 12, padding: '22px 24px', width: 420, color: '#111827', boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>新建会话</div>

        {/* Type switcher */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {(['direct', 'group'] as const).map((t) => (
            <button key={t} onClick={() => { setType(t); setSelectedIds([]) }}
              style={{ ...S.btn(type === t, true), flex: 1 }}>
              {t === 'direct' ? '🧑 私信' : '👥 群聊'}
            </button>
          ))}
        </div>

        {/* Group title */}
        {type === 'group' && (
          <input
            placeholder="群聊名称（可选，不填则自动生成）"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ ...S.searchInput, marginBottom: 10 }}
          />
        )}

        {/* Selected chips */}
        {selectedContacts.length > 0 && (
          <div style={{ marginBottom: 10, minHeight: 28 }}>
            {selectedContacts.map((c) => (
              <span key={c.personId} style={S.chip}>
                {c.name}
                <span style={{ cursor: 'pointer', fontSize: 14 }} onClick={() => toggle(c.personId, false)}>✕</span>
              </span>
            ))}
          </div>
        )}

        {/* Search */}
        <input
          placeholder="搜索姓名 / 部门 / 职位…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...S.searchInput, marginBottom: 8 }}
        />

        {/* Contact list */}
        <div style={{ maxHeight: 220, overflowY: 'auto', marginBottom: 12, borderRadius: 8, border: '1px solid #E5E7EB' }}>
          {contactsLoading && (
            <div style={{ padding: '20px', textAlign: 'center', color: '#6B7280', fontSize: 14 }}>加载联系人中…</div>
          )}
          {!contactsLoading && contactsError && (
            <div style={{ padding: '14px', color: '#dc2626', fontSize: 14 }}>
              ⚠️ 无法连接账号中心，请检查 AccountCenter 服务状态
            </div>
          )}
          {!contactsLoading && !contactsError && filtered.length === 0 && (
            <div style={{ padding: '20px', textAlign: 'center', color: '#6B7280', fontSize: 14 }}>
              {contacts.length === 0
                ? '暂无通讯录数据，请先在 AccountCenter 导入人员。'
                : `没有匹配"${search}"的用户`}
            </div>
          )}
          {!contactsLoading && !contactsError && filtered.map((u) => {
            const isNotCreated = u.chatStatus === 'not_created'
            const isDisabled = u.chatStatus === 'disabled'
            const cannotSelect = isNotCreated || isDisabled
            return (
              <div key={u.personId}
                onClick={() => toggle(u.personId, cannotSelect)}
                title={isNotCreated ? '内部通讯账号未开通。' : isDisabled ? '内部通讯账号已禁用' : undefined}
                style={{
                  padding: '9px 14px', cursor: cannotSelect ? 'not-allowed' : 'pointer', fontSize: 14,
                  borderBottom: '1px solid #EEF1F5',
                  opacity: cannotSelect ? 0.5 : 1,
                  background: selectedIds.includes(u.personId) ? '#EAF2FF' : 'transparent',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#E5E7EB', color: '#374151', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0, fontWeight: 600 }}>
                  {u.name.charAt(0)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, color: '#111827', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {u.name}
                    {u.enName && <span style={{ fontWeight: 400, color: '#9faebd', fontSize: 12 }}>{u.enName}</span>}
                    {isNotCreated && (
                      <span style={{ fontSize: 10, color: '#856404', background: '#fff3cd', padding: '1px 5px', borderRadius: 4, fontWeight: 700 }}>未开通</span>
                    )}
                  </div>
                  {(u.department || u.position) && (
                    <div style={{ fontSize: 12, color: '#6B7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {[u.department, u.position].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
                {selectedIds.includes(u.personId) && <span style={{ color: '#2563eb', fontSize: 16, flexShrink: 0 }}>✓</span>}
              </div>
            )
          })}
        </div>

        {error && <div style={{ color: '#dc2626', fontSize: 14, marginBottom: 10 }}>⚠️ {error}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button style={S.btn()} onClick={onClose}>取消</button>
          <button style={{ ...S.btn(true), opacity: selectedIds.length === 0 ? 0.5 : 1 }}
            disabled={loading || selectedIds.length === 0} onClick={() => { void submit() }}>
            {loading ? '创建中…' : '创建'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Helpers ───────────────────────────────────────────────────────────────── */

/** Returns date options for the last 3 days (today, yesterday, day before). */
function getLocalDateOptions(): { label: string; value: string }[] {
  const opts: { label: string; value: string }[] = []
  for (let i = 0; i < 3; i++) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    opts.push({ label: i === 0 ? '今天' : i === 1 ? '昨天' : '前天', value })
  }
  return opts
}

async function chatAdminFetch<T>(endpoint: string): Promise<T> {
  const api = window.electronAPI?.activityAdminFetch
  if (!api) throw new Error('activityAdminFetch API not available — 请确保在 Electron 环境中运行')
  const res = await api(endpoint)
  if (!res.ok) {
    if (res.httpStatus === 403) throw new Error('无权限查看该用户日报（403）')
    throw new Error(String(res.error ?? `HTTP ${res.httpStatus}`))
  }
  return res.data as T
}

async function chatAdminPost<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  const api = window.electronAPI?.activityAdminPost
  if (!api) throw new Error('activityAdminPost API not available — 请确保在 Electron 环境中运行')
  const res = await api(endpoint, body)
  if (!res.ok) {
    if (res.httpStatus === 403) throw new Error('无权限（403）')
    throw new Error(String(res.error ?? `HTTP ${res.httpStatus}`))
  }
  return res.data as T
}

interface ServerDailyDetail {
  report: {
    id: string
    username: string
    display_name: string
    date_key: string
    summary_text: string
    detailedMarkdown?: string
    structured_json: {
      detailedMarkdown?: string
      overview?: string
      mainWork?: string | string[]
      fileOutputs?: string
      fileOperationSummary?: string
      aiUsage?: string
      aiUsageSummary?: string
      emailAndChat?: string
      communicationSummary?: string
      timeStats?: string
      durationSummary?: string
      anomalies?: string
      failedTasks?: string | string[]
      keyOutputs?: string
      errors?: string
    }
    generated_at: string
  } | null
  diffs: Array<{
    created_files: unknown[]
    modified_files: unknown[]
    deleted_files: unknown[]
    exported_files: unknown[]
  }>
  summaries: Array<{
    id?: string
    file_name: string
    change_type: string
    work_type: string
    summary: string
  }>
  jobs: Array<{
    id: string
    job_type: string
    status: string
    error_message: string | null
  }>
}

/** Date-aware no-activity message. Uses local timezone, not UTC. */
function getNoActivityText(dateKey: string): string {
  const now = new Date()
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const yd = new Date(now); yd.setDate(now.getDate() - 1)
  const ydKey = `${yd.getFullYear()}-${String(yd.getMonth() + 1).padStart(2, '0')}-${String(yd.getDate()).padStart(2, '0')}`
  if (dateKey === todayKey) return '该用户今日暂无具体操作记录。'
  if (dateKey === ydKey) return '该用户昨日没有具体操作记录。'
  return '该用户在该日期暂无具体操作记录。'
}

/* ─── DailyReportModal ─────────────────────────────────────────────────────── */

type ModalPhase = 'pick' | 'loading' | 'result' | 'no_activity' | 'error'

function DailyReportModal({
  contact, viewerUserId, onClose,
}: {
  contact: ChatContact
  viewerUserId: string
  onClose: () => void
}) {
  const dateOptions = getLocalDateOptions()
  const [selectedDate, setSelectedDate] = useState(dateOptions[0].value)
  const [phase, setPhase] = useState<ModalPhase>('pick')
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<ServerDailyDetail | null>(null)
  const [showDebug, setShowDebug] = useState(false)

  const generate = async () => {
    if (!canGenerateDailyReport(contact, viewerUserId, ALLOW_ALL_WORK_REPORTS)) {
      setError('无权生成该用户日报'); setPhase('error'); return
    }
    setPhase('loading'); setError(null)
    try {
      // Step 1: trigger report generation
      await chatAdminPost('/api/admin/activity/reports/generate', {
        dateKey: selectedDate,
        scope: 'user',
        userId: contact.id,
        force: true,
      })
      // Step 2: fetch the resulting detail
      const res = await chatAdminFetch<{ data: ServerDailyDetail }>(`/api/admin/activity/users/${contact.id}/daily/${selectedDate}`)
      const d: ServerDailyDetail = (res as unknown as { data: ServerDailyDetail }).data ?? (res as unknown as ServerDailyDetail)
      if (!d.report) {
        setDetail(d)
        setPhase('no_activity')
      } else {
        setDetail(d)
        setPhase('result')
      }
    } catch (e) {
      console.error('[daily-report] generate failed', {
        currentUserId: viewerUserId,
        targetUser: { id: contact.id, username: contact.username },
        dateKey: selectedDate,
        error: e,
      })
      setError(e instanceof Error ? e.message : '无法生成日报，请检查权限或日志服务状态')
      setPhase('error')
    }
  }

  const isResult = phase === 'result'
  const displayName = contact.displayName || contact.username

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10002, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#FFFFFF', borderRadius: 12, padding: '24px 28px', width: isResult ? 520 : 340, maxHeight: '82vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.14)', border: '1px solid #E5E7EB', color: '#111827' }}>

        {/* Header */}
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
          {isResult ? `${displayName} · 工作日报` : '生成工作日报'}
        </div>
        <div style={{ fontSize: 14, color: '#6B7280', marginBottom: 16 }}>
          {isResult ? selectedDate : `对象：${displayName}`}
        </div>

        {/* Phase: pick / error (re-pick) */}
        {(phase === 'pick' || phase === 'error') && (
          <>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 8 }}>选择日期</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {dateOptions.map((opt) => (
                  <button key={opt.value} onClick={() => setSelectedDate(opt.value)}
                    style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
                      background: selectedDate === opt.value ? '#2563eb' : '#F3F4F6',
                      color: selectedDate === opt.value ? '#fff' : '#374151',
                      fontWeight: selectedDate === opt.value ? 700 : 500, fontSize: 14 }}>
                    {opt.label}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 14, color: '#9CA3AF', marginTop: 6 }}>{selectedDate}</div>
            </div>
            {error && (
              <div style={{ color: '#dc2626', fontSize: 14, marginBottom: 12, background: '#fef2f2', padding: '8px 10px', borderRadius: 6 }}>
                ⚠️ {error}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={onClose}
                style={{ padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', background: '#F3F4F6', color: '#374151', fontSize: 14, fontWeight: 600 }}>
                取消
              </button>
              <button onClick={() => { void generate() }}
                style={{ padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', background: '#2563eb', color: '#fff', fontSize: 14, fontWeight: 600 }}>
                生成日报
              </button>
            </div>
          </>
        )}

        {/* Phase: loading */}
        {phase === 'loading' && (
          <div style={{ textAlign: 'center', padding: '28px 0', color: '#6B7280', fontSize: 14 }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>⏳</div>
            生成中，请稍候…
          </div>
        )}

        {/* Phase: no_activity */}
        {phase === 'no_activity' && (
          <>
            <div style={{ textAlign: 'center', padding: '12px 0 8px' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#374151', marginBottom: 6 }}>暂无工作记录</div>
              <div style={{ fontSize: 14, color: '#6B7280', marginBottom: 4 }}>{getNoActivityText(selectedDate)}</div>
              <div style={{ fontSize: 13, color: '#9CA3AF' }}>系统未检测到文档编辑、AI 调用、邮件处理或内部通讯等有效工作事件。</div>
            </div>
            {IS_DEV && (
              <div style={{ marginTop: 8 }}>
                <button onClick={() => setShowDebug((v) => !v)}
                  style={{ fontSize: 12, color: '#9CA3AF', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0' }}>
                  {showDebug ? '收起调试信息' : '查看调试信息'}
                </button>
                {showDebug && (
                  <div style={{ marginTop: 4, padding: '10px 12px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 6, fontSize: 12, color: '#166534', fontFamily: 'monospace' }}>
                    <div>targetUserId: {contact.id}</div>
                    <div>targetUsername: {contact.username}</div>
                    <div>dateKey: {selectedDate}</div>
                    <div>serverReportNull: {String(!detail?.report)}</div>
                    <div>serverSummaries: {detail?.summaries?.length ?? 0}</div>
                    <div>serverJobs: {detail?.jobs?.length ?? 0}</div>
                  </div>
                )}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={() => { setPhase('pick'); setShowDebug(false) }}
                style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #D1D5DB', cursor: 'pointer', background: '#F9FAFB', color: '#374151', fontSize: 14 }}>
                换个日期
              </button>
              <button onClick={onClose}
                style={{ padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: '#F3F4F6', color: '#374151', fontSize: 14 }}>
                关闭
              </button>
            </div>
          </>
        )}

                {/* Phase: result */}
        {phase === 'result' && detail?.report && (() => {
          const rep = detail.report!
          const sj = rep.structured_json ?? {}
          const dm = (sj.detailedMarkdown as string | undefined) ?? rep.detailedMarkdown
          const mainWorkText = Array.isArray(sj.mainWork) ? sj.mainWork.join('\n') : sj.mainWork
          const fileOutputsText = sj.fileOutputs ?? sj.fileOperationSummary
          const aiUsageText = sj.aiUsage ?? sj.aiUsageSummary
          const emailAndChatText = sj.emailAndChat ?? sj.communicationSummary
          const timeStatsText = sj.timeStats ?? sj.durationSummary
          const anomaliesText = Array.isArray(sj.failedTasks)
            ? sj.failedTasks.join('\n')
            : (sj.anomalies ?? (typeof sj.failedTasks === 'string' ? sj.failedTasks : undefined))
          const copyText = dm
            ? dm
            : [
                (sj.overview ?? rep.summary_text) ? `【今日概览】\n${sj.overview ?? rep.summary_text}` : '',
                mainWorkText && mainWorkText !== '无' ? `【主要工作】\n${mainWorkText}` : '',
                fileOutputsText && fileOutputsText !== '无' ? `【文件与产出】\n${fileOutputsText}` : '',
                aiUsageText && aiUsageText !== '无' ? `【AI 使用情况】\n${aiUsageText}` : '',
                emailAndChatText && emailAndChatText !== '无' ? `【邮件与内部通讯】\n${emailAndChatText}` : '',
                timeStatsText && timeStatsText !== '无耗时数据' && timeStatsText !== '无' ? `【耗时统计】\n${timeStatsText}` : '',
                anomaliesText && anomaliesText !== '无' ? `【异常情况】\n${anomaliesText}` : '',
              ].filter(Boolean).join('\n\n')
          return (
            <>
              {dm ? (
                <div style={{ marginBottom: 8 }}>
                  {dm.split('\n').map((ln, idx) => {
                    if (ln.startsWith('## ')) {
                      return <div key={idx} style={{ fontWeight: 700, fontSize: 14, color: '#374151', marginTop: 14, marginBottom: 4, borderBottom: '1px solid #E5E7EB', paddingBottom: 3 }}>{ln.slice(3)}</div>
                    }
                    if (ln.startsWith('**') && ln.endsWith('**') && ln.length > 4) {
                      return <div key={idx} style={{ fontWeight: 700, fontSize: 14, color: '#111827', marginBottom: 4 }}>{ln.slice(2, -2)}</div>
                    }
                    if (!ln.trim()) return <div key={idx} style={{ height: 5 }} />
                    return <div key={idx} style={{ fontSize: 14, color: '#374151', lineHeight: 1.7 }}>{ln}</div>
                  })}
                </div>
              ) : (
                <>
                  {(sj.overview ?? rep.summary_text) && (
                    <div style={{ marginBottom: 12, background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 8, padding: '10px 14px' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#9CA3AF', marginBottom: 4 }}>今日概览</div>
                      <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{sj.overview ?? rep.summary_text}</div>
                    </div>
                  )}
                  {mainWorkText && mainWorkText !== '无' && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#374151', marginBottom: 4 }}>主要工作</div>
                      <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{mainWorkText}</div>
                    </div>
                  )}
                  {fileOutputsText && fileOutputsText !== '无' && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#374151', marginBottom: 4 }}>文件与产出</div>
                      <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{fileOutputsText}</div>
                    </div>
                  )}
                  {aiUsageText && aiUsageText !== '无' && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#374151', marginBottom: 4 }}>AI 使用情况</div>
                      <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{aiUsageText}</div>
                    </div>
                  )}
                  {emailAndChatText && emailAndChatText !== '无' && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#374151', marginBottom: 4 }}>邮件与内部通讯</div>
                      <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{emailAndChatText}</div>
                    </div>
                  )}
                  {timeStatsText && timeStatsText !== '无耗时数据' && timeStatsText !== '无' && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#374151', marginBottom: 4 }}>耗时统计</div>
                      <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{timeStatsText}</div>
                    </div>
                  )}
                  {anomaliesText && anomaliesText !== '无' && (
                    <div style={{ marginBottom: 10, background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '10px 12px' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#92400E', marginBottom: 4 }}>异常情况</div>
                      <div style={{ fontSize: 14, color: '#78350F', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{anomaliesText}</div>
                    </div>
                  )}
                  {detail.summaries.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#374151', marginBottom: 4 }}>文件记录（{detail.summaries.length}）</div>
                      {detail.summaries.slice(0, 8).map((s, i) => (
                        <div key={s.id ?? i} style={{ fontSize: 14, color: '#4B5563', lineHeight: 1.6 }}>
                          • {s.file_name}{s.summary ? `：${s.summary}` : ''}
                        </div>
                      ))}
                      {detail.summaries.length > 8 && (
                        <div style={{ fontSize: 14, color: '#9CA3AF' }}>…等共 {detail.summaries.length} 个文件</div>
                      )}
                    </div>
                  )}
                </>
              )}
              {detail.jobs.filter((j) => j.status === 'failed').length > 0 && (
                <div style={{ marginBottom: 10, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#DC2626', marginBottom: 4 }}>异常任务</div>
                  {detail.jobs.filter((j) => j.status === 'failed').map((j) => (
                    <div key={j.id} style={{ fontSize: 14, color: '#7F1D1D', lineHeight: 1.6 }}>• {j.job_type}{j.error_message ? `：${j.error_message}` : ''}</div>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                <button onClick={() => { void navigator.clipboard?.writeText(copyText) }}
                  style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid #D1D5DB', cursor: 'pointer', fontSize: 14, background: '#fff', color: '#374151', fontWeight: 600 }}>
                  复制
                </button>
                <button onClick={() => { setPhase('pick'); setDetail(null) }}
                  style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid #D1D5DB', cursor: 'pointer', fontSize: 14, background: '#fff', color: '#374151', fontWeight: 600 }}>
                  重新生成
                </button>
                <button onClick={onClose}
                  style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid #D1D5DB', cursor: 'pointer', fontSize: 14, background: '#fff', color: '#374151', fontWeight: 600, marginLeft: 'auto' }}>
                  关闭
                </button>
              </div>
            </>
          )
        })()}
      </div>
    </div>
  )
}

/* ─── ContactProfilePanel ──────────────────────────────────────────────────── */

function ContactProfilePanel({
  contact, viewerUserId, onSendMessage, onClose,
}: {
  contact: ChatContact
  viewerUserId: string
  onSendMessage: (c: ChatContact) => void
  onClose: () => void
}) {
  const [showModal, setShowModal] = useState(false)
  const canReport = canGenerateDailyReport(contact, viewerUserId, ALLOW_ALL_WORK_REPORTS)
  const displayName = contact.displayName || contact.username
  const initials = displayName.slice(0, 2).toUpperCase()

  return (
    <div style={S.rightPanel}>
      {/* Panel header */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#374151' }}>联系人资料</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', fontSize: 18, lineHeight: 1, padding: '0 2px' }}>✕</button>
      </div>

      {/* Avatar + name */}
      <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, borderBottom: '1px solid #EEF1F5', flexShrink: 0 }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#DBEAFE', color: '#1d4ed8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700 }}>
          {initials}
        </div>
        <div style={{ fontWeight: 700, fontSize: 15, color: '#111827', textAlign: 'center' }}>{displayName}</div>
        {contact.displayName && contact.displayName !== contact.username && (
          <div style={{ fontSize: 14, color: '#6B7280' }}>@{contact.username}</div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: contact.status === 'active' ? '#10b981' : '#9CA3AF' }} />
          <span style={{ fontSize: 14, color: contact.status === 'active' ? '#10b981' : '#9CA3AF' }}>
            {contact.status === 'active' ? '在线' : '离线'}
          </span>
        </div>
      </div>

      {/* Info rows */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #EEF1F5', display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
        {contact.departmentName && (
          <div>
            <div style={{ fontSize: 14, color: '#9CA3AF', marginBottom: 2 }}>部门</div>
            <div style={{ fontSize: 14, color: '#374151' }}>{contact.departmentName}</div>
          </div>
        )}
        {contact.position && (
          <div>
            <div style={{ fontSize: 14, color: '#9CA3AF', marginBottom: 2 }}>职位</div>
            <div style={{ fontSize: 14, color: '#374151' }}>{contact.position}</div>
          </div>
        )}
        {contact.email && (
          <div>
            <div style={{ fontSize: 14, color: '#9CA3AF', marginBottom: 2 }}>邮箱</div>
            <div style={{ fontSize: 14, color: '#374151', wordBreak: 'break-all' }}>{contact.email}</div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
        <button onClick={() => onSendMessage(contact)}
          style={{ padding: '9px 0', borderRadius: 8, border: 'none', cursor: 'pointer', background: '#2563eb', color: '#fff', fontSize: 14, fontWeight: 600 }}>
          💬 发消息
        </button>
        {canReport && (
          <button onClick={() => setShowModal(true)}
            style={{ padding: '9px 0', borderRadius: 8, border: 'none', cursor: 'pointer', background: '#F3F4F6', color: '#374151', fontSize: 14, fontWeight: 600 }}>
            📋 生成日报
          </button>
        )}
      </div>

      {showModal && (
        <DailyReportModal contact={contact} viewerUserId={viewerUserId} onClose={() => setShowModal(false)} />
      )}
    </div>
  )
}

/* ─── Main ChatWindow ───────────────────────────────────────────────────────── */
export const ChatWindow: React.FC<{ onClose: () => void; inline?: boolean }> = ({ onClose, inline }) => {
  const session = useInternalSession()
  const canChat = useHasPermission('chat.view_own')
  const token = session?.token ?? ''
  const currentUserId = session?.user?.id ?? ''
  const currentUsername = session?.user?.username ?? ''

  // ── Conversations state ────────────────────────────────────────────────────
  const [convs, setConvs] = useState<ChatConversation[]>([])
  const [convError, setConvError] = useState<string | null>(null)
  const [activeConvId, setActiveConvId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [msgError, setMsgError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [search, setSearch] = useState('')
  const [showNewModal, setShowNewModal] = useState(false)
  const msgEndRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Left panel tabs ────────────────────────────────────────────────────────
  const [leftTab, setLeftTab] = useState<'conversations' | 'contacts'>('conversations')

  // ── Contacts state ─────────────────────────────────────────────────────────
  const [contactList, setContactList] = useState<ChatContact[]>([])
  const [contactsLoading, setContactsLoading] = useState(false)
  const [contactsError, setContactsError] = useState<string | null>(null)
  const [contactSearch, setContactSearch] = useState('')
  const [selectedContact, setSelectedContact] = useState<ChatContact | null>(null)

  // ── Org directory (通讯录 tab) state ──────────────────────────────────────
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([])
  const [orgUnitsLoading, setOrgUnitsLoading] = useState(false)
  const [orgUnitsError, setOrgUnitsError] = useState<string | null>(null)
  const [selectedDept, setSelectedDept] = useState<OrgUnit | null>(null)
  const [deptMembers, setDeptMembers] = useState<OrgUnitMember[]>([])
  const [deptMembersLoading, setDeptMembersLoading] = useState(false)
  const [searchResults, setSearchResults] = useState<PersonProfile[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [selectedDirPerson, setSelectedDirPerson] = useState<OrgUnitMember | PersonProfile | null>(null)
  const [dirSearch, setDirSearch] = useState('')
  const [dirSendError, setDirSendError] = useState<string | null>(null)

  const dirSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Daily report modal target(can be triggered from header, conv list, or profile panel) ──
  const [dailyReportTarget, setDailyReportTarget] = useState<ChatContact | null>(null)

  // ── Attachment state ───────────────────────────────────────────────────────
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pendingFileType, setPendingFileType] = useState<'image' | 'file' | null>(null)
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const imgInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Conversation action menu & confirmation state ─────────────────────────
  const [hoveredConvId, setHoveredConvId] = useState<string | null>(null)
  const [convMenuId, setConvMenuId] = useState<string | null>(null)
  const [convMenuPos, setConvMenuPos] = useState<{ top: number; right: number } | null>(null)
  const [hideConfirmId, setHideConfirmId] = useState<string | null>(null)
  const [hideError, setHideError] = useState<string | null>(null)
  const [dissolveConfirmId, setDissolveConfirmId] = useState<string | null>(null)
  const [dissolveError, setDissolveError] = useState<string | null>(null)

  const loadConvs = useCallback(async () => {
    if (!token) return
    try {
      const data = await getConversations(token)
      setConvs(data)
      setConvError(null)
    } catch (e) {
      setConvError(e instanceof Error ? e.message : '无法加载会话列表')
    }
  }, [token])

  const loadMessages = useCallback(async (convId: string) => {
    if (!token) return
    setLoadingMsgs(true)
    setMsgError(null)
    try {
      const data = await getMessages(token, convId)
      setMessages(data)
      setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '消息加载失败'
      if (msg.includes('403') || msg.toLowerCase().includes('forbidden')) {
        setMsgError('无权限查看该会话')
      } else {
        setMsgError('消息加载失败，请稍后重试')
      }
    } finally {
      setLoadingMsgs(false)
    }
  }, [token])

  useEffect(() => { void loadConvs() }, [loadConvs])

  useEffect(() => {
    if (!activeConvId) return
    setMessages([])
    setMsgError(null)
    void loadMessages(activeConvId)
    pollRef.current = setInterval(() => { void loadMessages(activeConvId) }, 5000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [activeConvId, loadMessages])

  // Load contacts eagerly on mount so canViewWorkReport data is available for daily-report button
  const loadContacts = useCallback(async () => {
    if (!token) return
    setContactsLoading(true); setContactsError(null)
    try {
      let list = await getChatContacts(token)
      list = list.filter((c) => c.id !== currentUserId)

      // Supplement from conversation members when contacts API returns empty list.
      // Ensures daily-report buttons show even when /api/chat/contacts returns [].
      if (list.length === 0) {
        const seen = new Set<string>()
        for (const conv of convs) {
          if (!Array.isArray(conv.members)) continue
          for (const m of conv.members) {
            const rawMid = (m as Record<string, unknown>)['userId'] ?? (m as Record<string, unknown>)['user_id']
            const mid = String(rawMid ?? '')
            if (!mid || mid === '0' || mid === currentUserId || seen.has(mid)) continue
            seen.add(mid)
            list.push({ id: mid, username: m.username, status: 'active' })
          }
        }
      }

      // Dev mock: inject canViewWorkReport=true for test users when server doesn't supply it.
      // In production canViewWorkReport must come from the server (GET /api/chat/contacts).
      if (IS_DEV) {
        list = list.map((c) => {
          if ((c.username === 'wentaoyang' || c.displayName === 'wentaoyang') && c.canViewWorkReport == null) {
            console.debug('[daily-report-button] DEV: injecting canViewWorkReport for wentaoyang')
            return { ...c, canViewWorkReport: true }
          }
          return c
        })
      }

      setContactList(list)

      if (IS_DEV) {
        console.debug('[daily-report-contacts-loaded]', {
          currentUserId,
          currentUsername,
          count: list.length,
          contacts: list.map((c) => ({
            id: c.id,
            username: c.username,
            canViewWorkReport: c.canViewWorkReport,
          })),
        })
      }
    } catch (e) {
      setContactsError(e instanceof Error ? e.message : '联系人加载失败')
    } finally {
      setContactsLoading(false)
    }
  }, [token, currentUserId])

  // Load contacts on mount and when contacts tab is first opened
  useEffect(() => {
    if (token && contactList.length === 0 && !contactsLoading) {
      void loadContacts()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  // ── Org directory load callbacks ──────────────────────────────────────────
  const loadOrgUnits = useCallback(async () => {
    if (!token) return
    setOrgUnitsLoading(true); setOrgUnitsError(null)
    try { setOrgUnits(await getOrgUnits(token)) }
    catch (e) { setOrgUnitsError(e instanceof Error ? e.message : '无法连接账号中心，请检查 AccountCenter 服务状态。') }
    finally { setOrgUnitsLoading(false) }
  }, [token])

  const loadDeptMembers = useCallback(async (orgUnitId: string) => {
    if (!token) return
    setDeptMembersLoading(true)
    try { setDeptMembers(await getOrgUnitMembers(token, orgUnitId)) }
    catch { setDeptMembers([]) }
    finally { setDeptMembersLoading(false) }
  }, [token])

  const searchPeople = useCallback(async (q: string) => {
    if (!token || !q.trim()) { setSearchResults([]); setSearchLoading(false); return }
    setSearchLoading(true)
    try { setSearchResults(await getPeople(token, { q })) }
    catch { setSearchResults([]) }
    finally { setSearchLoading(false) }
  }, [token])

  // Load org units when contacts tab is first opened
  useEffect(() => {
    if (leftTab !== 'contacts') return
    if (orgUnits.length === 0 && !orgUnitsLoading) void loadOrgUnits()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftTab])

  // Unified: open (or create) a direct conversation with a directory person.
  // Also sets selectedDirPerson so the right panel switches immediately.
  const openDirectConversation = useCallback(async (person: PersonProfile | OrgUnitMember) => {
    setSelectedDirPerson(person)
    // Only attempt to open a chat if the person has an active chat account.
    if (!token || !person.personId || person.chatStatus !== 'active') return
    setDirSendError(null)
    try {
      const target = await resolveDirectoryChatTarget(token, person)
      const conv = await ensureDirectConversation(token, target)
      setConvs((p) => [conv, ...p.filter((c) => c.id !== conv.id)])
      selectConv(conv.id)
      void loadConvs()
    } catch (e) {
      setDirSendError(readableChatStartError(e))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, loadConvs])

  const selectConv = (id: string) => {
    if (pollRef.current) clearInterval(pollRef.current)
    setActiveConvId(id)
  }

  // Open or create a direct conversation with a contact
  const handleSendToContact = useCallback(async (contact: ChatContact) => {
    const existing = convs.find((c) => {
      if (c.conversation_type === 'group') return false
      const others = (c.members ?? []).filter((m) => m.userId !== currentUserId)
      return others.some((m) => m.userId === contact.id)
    })
    if (existing) {
      selectConv(existing.id)
      setLeftTab('conversations')
      return
    }
    try {
      const conv = await ensureDirectConversation(token, { targetUserId: contact.id, targetUsername: contact.username })
      setConvs((p) => [conv, ...p.filter((c) => c.id !== conv.id)])
      selectConv(conv.id)
      setLeftTab('conversations')
      void loadConvs()
    } catch (e) {
      setConvError(readableChatStartError(e))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convs, currentUserId, token, loadConvs])

  // ── Attachment helpers ──────────────────────────────────────────────────────

  const clearPending = useCallback(() => {
    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl)
    setPendingFile(null)
    setPendingFileType(null)
    setPendingPreviewUrl(null)
    setUploadProgress(0)
    setUploadError(null)
  }, [pendingPreviewUrl])

  const selectFile = (file: File, type: 'image' | 'file') => {
    clearPending()
    setPendingFile(file)
    setPendingFileType(type)
    setUploadError(null)
    if (type === 'image') {
      setPendingPreviewUrl(URL.createObjectURL(file))
    }
  }

  // Fetch attachment with auth token and open in Electron / browser
  const downloadAttachment = useCallback(async (att: ChatAttachment) => {
    const url = att.downloadUrl.startsWith('http')
      ? att.downloadUrl
      : `${ACCOUNT_CENTER_URL}${att.downloadUrl}`
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = att.fileName
      a.click()
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000)
    } catch (e) {
      alert(`下载失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }, [token])

  /** After normalizeChatMessage(), attachment is already resolved. This is just a passthrough. */
  function resolveAttachment(m: ChatMessage): ChatAttachment | null {
    if (m.attachment) return m.attachment
    // Fallback: build from attachmentId if the attachment block is missing
    if (m.attachmentId) {
      const base = `${ACCOUNT_CENTER_URL}/api/chat/attachments/${m.attachmentId}`
      return { id: m.attachmentId, fileName: '附件', mimeType: 'application/octet-stream', sizeBytes: 0, downloadUrl: base }
    }
    return null
  }

  function fmtBytes(n: number): string {
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    return `${(n / (1024 * 1024)).toFixed(1)} MB`
  }

  // ── Send ────────────────────────────────────────────────────────────────────

  const handleSend = async () => {
    if (!activeConvId || sending || uploading) return

    const sendingConv = convs.find((c) => c.id === activeConvId)
    if (sendingConv?.status === 'dissolved') {
      setMsgError('该群聊已解散，无法发送消息')
      return
    }

    if (pendingFile && pendingFileType) {
      setUploading(true)
      setUploadError(null)
      setUploadProgress(0)
      try {
        const msg = await uploadChatAttachment(
          token, activeConvId, pendingFile, pendingFileType,
          text.trim() || undefined,
          (pct) => setUploadProgress(pct),
        )
        setMessages((p) => [...p, msg])
        setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
        clearPending()
        setText('')
        void loadConvs()
      } catch (e) {
        setUploadError(e instanceof Error ? e.message : '上传失败')
      } finally {
        setUploading(false)
      }
      return
    }

    if (!text.trim()) return
    setSending(true)
    const body = text.trim()
    setText('')
    try {
      const msg = await sendMessage(token, activeConvId, body)
      setMessages((p) => [...p, msg])
      setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
      void loadConvs()
      // Record activity for daily report generation
      if (currentUserId) {
        void window.electronAPI?.activityLogUserAction?.({
            userId: currentUserId,
            module: 'chat',
            action: 'sendMessage',
            eventType: 'chat_message_sent',
            summary: '发送了一条内部通讯消息',
            details: {
              conversationId: activeConvId,
              messageType: 'text',
              messageSummary: body.slice(0, 30),
              hasAttachment: false,
              attachmentCount: 0,
            },
          })
      }
    } catch (e) {
      setMsgError(e instanceof Error ? e.message : '发送失败')
      setText(body)
    } finally {
      setSending(false)
    }
  }

  // ── Paste / drag-and-drop ───────────────────────────────────────────────────

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (!activeConvId) return
    const items = Array.from(e.clipboardData.items)
    const imgItem = items.find((i) => i.type.startsWith('image/'))
    if (imgItem) {
      const file = imgItem.getAsFile()
      if (file) { e.preventDefault(); selectFile(file, 'image') }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConvId, clearPending])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    if (!activeConvId) return
    const file = e.dataTransfer.files[0]
    if (!file) return
    selectFile(file, file.type.startsWith('image/') ? 'image' : 'file')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConvId, clearPending])

  const handleHideConversation = async (convId: string) => {
    setHideError(null)
    try {
      await hideConversation(token, convId)
      setConvs((prev) => prev.filter((c) => c.id !== convId))
      if (activeConvId === convId) setActiveConvId(null)
      setHideConfirmId(null)
    } catch (e) {
      console.error('[chat] hide conversation failed', e)
      setHideError('无法移除会话，请检查网络或服务状态')
    }
  }

  const handleDissolveConversation = async (convId: string) => {
    setDissolveError(null)
    try {
      await dissolveConversation(token, convId)
      setConvs((prev) => prev.map((c) => c.id === convId ? { ...c, status: 'dissolved' as const } : c))
      setDissolveConfirmId(null)
    } catch (e) {
      console.error('[chat] dissolve conversation failed', e)
      const msg = e instanceof Error ? e.message : String(e)
      if (/403|forbidden|无权限/i.test(msg)) {
        setDissolveError('无权限解散该群聊')
      } else if (/dissolved|已解散/i.test(msg)) {
        setDissolveError('该群聊已经解散')
      } else {
        setDissolveError('解散群聊失败，请检查网络或服务状态')
      }
    }
  }

  const activeConv = convs.find((c) => c.id === activeConvId) ?? null
  const isDissolvedGroup = activeConv?.status === 'dissolved'
  const filtered = convs.filter((c) => {
    if (!search) return true
    const label = convLabel(c)
    return label.toLowerCase().includes(search.toLowerCase())
  })

  function convLabel(c: ChatConversation): string {
    if (c.conversation_type === 'group' && c.title) return c.title
    const others = (c.members ?? []).filter((m) => m.userId !== currentUserId)
    if (others.length > 0) return others.map((m) => m.username).join(', ')
    return c.title ?? `会话 ${c.id.slice(0, 8)}`
  }

  function convAvatar(c: ChatConversation): string {
    if (c.conversation_type === 'group') return '👥'
    const others = (c.members ?? []).filter((m) => m.userId !== currentUserId)
    if (others.length > 0) return others[0].username.charAt(0).toUpperCase()
    return '?'
  }

  /**
   * Normalize a username/email for fuzzy matching:
   * lowercase, trim whitespace, strip @domain suffix.
   */
  function normalizeUsername(value: string | null | undefined): string {
    return String(value ?? '').trim().toLowerCase().split('@')[0]
  }

  /**
   * For a direct conversation, returns the ChatContact of the other party
   * (looked up by userId from the contactList), or null for groups / unknown.
   */
  function getConvContact(c: ChatConversation): ChatContact | null {
    if (c.conversation_type === 'group') return null
    const members = c.members ?? []
    // Normalize userId: server may use userId or user_id; fall back to username comparison
    const getMid = (m: Record<string, unknown>): string =>
      String((m['userId'] || m['user_id'] || '') as string)
    const other = members.find((m) => {
      const mid = getMid(m as Record<string, unknown>)
      if (mid && mid !== '0') return String(mid) !== String(currentUserId)
      return normalizeUsername(m.username) !== normalizeUsername(currentUsername)
    })
    if (!other) return null

    // Primary: match by ID (normalised); secondary: exact username; tertiary: normalised username
    const mid = getMid(other as Record<string, unknown>)
    const normalOther = normalizeUsername(other.username)
    const contact =
      (mid ? contactList.find((ct) => String(ct.id) === mid) : null) ??
      contactList.find((ct) => ct.username === other.username) ??
      contactList.find((ct) => normalizeUsername(ct.username) === normalOther) ??
      null

    if (IS_DEV) {
      const canGenerate = contact ? canGenerateDailyReport(contact, currentUserId) : false
      console.debug('[daily-report-permission-check]', {
        currentUserId,
        currentUsername,
        contactId: contact?.id,
        contactUsername: contact?.username ?? other.username,
        canViewWorkReport: contact?.canViewWorkReport,
        canGenerate,
        otherUserId: other.userId,
        normalOther,
        idMatchFound: contactList.some((ct) => ct.id === other.userId),
        usernameMatchFound: contactList.some((ct) => normalizeUsername(ct.username) === normalOther),
        contactListSize: contactList.length,
      })
    }
    return contact
  }

  /**
   * Like getConvContact, but when the contact is not found in contactList,
   * returns a minimal synthetic ChatContact built from the conversation member data.
   * Always tries to return a full contact (with permission fields) from contactList first.
   */
  function getConvContactOrFallback(c: ChatConversation): ChatContact | null {
    const found = getConvContact(c)
    if (found) return found
    if (c.conversation_type === 'group') return null

    // Build synthetic contact from members (normalise userId / user_id)
    const members = c.members ?? []
    const getMid = (m: Record<string, unknown>): string =>
      String((m['userId'] || m['user_id'] || '') as string)
    const other = members.find((m) => {
      const mid = getMid(m as Record<string, unknown>)
      if (mid && mid !== '0') return String(mid) !== String(currentUserId)
      return normalizeUsername(m.username) !== normalizeUsername(currentUsername)
    })
    if (other) {
      const mid = getMid(other as Record<string, unknown>)
      const normalOther = normalizeUsername(other.username)
      // Prefer real contact from contactList
      const ct =
        (mid ? contactList.find((x) => String(x.id) === mid) : null) ??
        contactList.find((x) => x.username === other.username) ??
        contactList.find((x) => normalizeUsername(x.username) === normalOther) ??
        null
      if (ct) return ct
      // Synthetic fallback — no canViewWorkReport so permission check will use ALLOW_ALL_WORK_REPORTS
      if (mid) return { id: mid, username: other.username ?? normalOther, status: 'active' }
    }

    // Last resort: match conv title to a contact username / displayName
    if (c.title) {
      const normalTitle = normalizeUsername(c.title)
      const ct = contactList.find(
        (x) => x.username === c.title ||
          (x.displayName && x.displayName === c.title) ||
          normalizeUsername(x.username) === normalTitle,
      )
      if (ct) return ct
      // Absolute last resort: synthetic contact from title
      if (c.title !== currentUsername && c.title !== String(currentUserId)) {
        return { id: c.title, username: c.title, status: 'active' as const }
      }
    }

    return null
  }

  // ── No session guard ───────────────────────────────────────────────────────
  const noSessionContent = (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 16, background: '#FFFFFF', position: 'relative',
    }}>
      {!inline && (
        <button
          onClick={onClose}
          style={{ position: 'absolute', top: 14, right: 18, background: 'transparent', border: 'none', color: '#9CA3AF', fontSize: 22, cursor: 'pointer', padding: '2px 8px', lineHeight: 1 }}>
          ✕
        </button>
      )}
      <div style={{ fontSize: 40, marginBottom: 4 }}>💬</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: '#1f2937' }}>内部通讯</div>
      <div style={{ fontSize: 14, color: '#6B7280', textAlign: 'center', maxWidth: 320 }}>
        请先登录内部账号才能使用内部通讯功能。
      </div>
      <button
        style={{ ...S.btn(true), marginTop: 4, padding: '10px 24px', fontSize: 14 }}
        onClick={() => {
          onClose()
          window.dispatchEvent(new CustomEvent('open-account-center'))
        }}>
        去账号中心登录
      </button>
    </div>
  )
  if (!session || !token) {
    if (inline) return noSessionContent
    return (
      <div style={S.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div style={{ ...S.window, alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, background: '#FFFFFF' }}>
          <button
            onClick={onClose}
            style={{ position: 'absolute', top: 14, right: 18, background: 'transparent', border: 'none', color: '#9CA3AF', fontSize: 22, cursor: 'pointer', padding: '2px 8px', lineHeight: 1 }}>
            ✕
          </button>
          {noSessionContent}
        </div>
      </div>
    )
  }

  // ── No chat permission guard ────────────────────────────────────────────────
  if (!canChat) {
    const noPermContent = (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, background: '#FFFFFF' }}>
        <div style={{ fontSize: 40, marginBottom: 4 }}>🔒</div>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#1f2937' }}>内部通讯</div>
        <div style={{ fontSize: 14, color: '#6B7280', textAlign: 'center', maxWidth: 320 }}>
          当前账号无内部通讯权限，请联系管理员开通。
        </div>
      </div>
    )
    if (inline) return noPermContent
    return (
      <div style={S.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div style={{ ...S.window, alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, background: '#FFFFFF' }}>
          <button
            onClick={onClose}
            style={{ position: 'absolute', top: 14, right: 18, background: 'transparent', border: 'none', color: '#9CA3AF', fontSize: 22, cursor: 'pointer', padding: '2px 8px', lineHeight: 1 }}>
            ✕
          </button>
          {noPermContent}
        </div>
      </div>
    )
  }

  // ── Shared inner content ────────────────────────────────────────────────────
  const innerContent = (
    <>
      {/* Header */}
      <div style={S.header}>
        <span style={{ fontSize: 18 }}>💬</span>
        <span style={{ fontWeight: 700, fontSize: 15 }}>内部通讯</span>
        <span style={{ fontSize: 14, color: '#6B7280' }}>@{currentUsername}</span>
        <button style={{ ...S.btn(true, true), marginLeft: 'auto' }} onClick={() => setShowNewModal(true)}>
          + 新建会话
        </button>
        {!inline && (
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#9CA3AF', fontSize: 20, cursor: 'pointer', padding: '2px 6px', lineHeight: 1 }}>
            ✕
          </button>
        )}
      </div>

      <div style={S.body}>
        {/* ── Left panel ─────────────────────────────────────────────────── */}
        <div style={S.sidebar}>
          {/* Tab bar */}
          <div style={{ display: 'flex', borderBottom: '1px solid #EEF1F5', flexShrink: 0 }}>
            <button style={S.tab(leftTab === 'conversations')} onClick={() => setLeftTab('conversations')}>最近会话</button>
            <button style={S.tab(leftTab === 'contacts')} onClick={() => setLeftTab('contacts')}>通讯录</button>
          </div>

          {leftTab === 'conversations' ? (
            <>
              <div style={S.sidebarTop}>
                <input placeholder="搜索会话…" value={search} onChange={(e) => setSearch(e.target.value)} style={S.searchInput} />
              </div>
              {convError && (
                <div style={{ padding: '10px 14px', color: '#dc2626', fontSize: 14, background: '#fef2f2', borderBottom: '1px solid #fecaca' }}>
                  ⚠️ {convError}
                  <span style={{ cursor: 'pointer', marginLeft: 8, color: '#2563eb' }} onClick={() => { void loadConvs() }}>重试</span>
                </div>
              )}
              <div style={S.convList}>
                {filtered.length === 0 && !convError && (
                  <div style={{ padding: '28px 16px', textAlign: 'center', color: '#9CA3AF', fontSize: 14 }}>
                    {convs.length === 0
                      ? <><div style={{ fontSize: 28, marginBottom: 8 }}>💬</div><div style={{ color: '#6B7280' }}>暂无会话</div><div style={{ marginTop: 6, fontSize: 14 }}>点击"新建会话"开始聊天</div></>
                      : <div>没有匹配的会话</div>}
                  </div>
                )}
                {filtered.map((c) => {
                  // Show daily report button for ALL direct (private) conversations — server enforces permissions.
                  const getDirectContact = (): ChatContact | null => {
                    if (c.conversation_type === 'group') return null
                    // Try from members array first
                    const members = c.members ?? []
                    const other = members.find((m) => {
                      const mid = String((m as Record<string,unknown>)['userId'] || (m as Record<string,unknown>)['user_id'] || '')
                      return mid ? mid !== String(currentUserId) : normalizeUsername(m.username) !== normalizeUsername(currentUsername)
                    })
                    if (other) {
                      const mid = String((other as Record<string,unknown>)['userId'] || (other as Record<string,unknown>)['user_id'] || '')
                      const full = (mid ? contactList.find((x) => String(x.id) === mid) : null)
                        ?? contactList.find((x) => normalizeUsername(x.username) === normalizeUsername(other.username))
                      if (full) return full
                      return { id: mid || other.username, username: other.username, status: 'active' }
                    }
                    // Fallback: use c.title (server often omits members from conversation list)
                    if (!c.title || normalizeUsername(c.title) === normalizeUsername(currentUsername)) return null
                    const byTitle = contactList.find((x) =>
                      normalizeUsername(x.username) === normalizeUsername(c.title ?? '') ||
                      (x.displayName && normalizeUsername(x.displayName) === normalizeUsername(c.title ?? '')),
                    )
                    return byTitle ?? { id: c.title, username: c.title, status: 'active' }
                  }
                  const convContact = getDirectContact()
                  const showDailyBtn = !!convContact
                  const isMenuOpen = convMenuId === c.id
                  return (
                    <div key={c.id} style={{ ...S.convItem(c.id === activeConvId), position: 'relative' }}
                      onClick={() => { if (!isMenuOpen) selectConv(c.id) }}
                      onMouseEnter={() => setHoveredConvId(c.id)}
                      onMouseLeave={() => setHoveredConvId((prev) => prev === c.id ? null : prev)}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: c.conversation_type === 'group' ? '#E5E7EB' : '#DBEAFE', color: c.conversation_type === 'group' ? '#374151' : '#1d4ed8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0, fontWeight: 600 }}>
                          {convAvatar(c)}
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#111827' }}>
                            {convLabel(c)}
                            {c.status === 'dissolved' && (
                              <span style={{ marginLeft: 6, fontSize: 11, padding: '1px 5px', borderRadius: 4, background: '#F3F4F6', color: '#9CA3AF', fontWeight: 500, verticalAlign: 'middle' }}>已解散</span>
                            )}
                          </div>
                          <div style={{ fontSize: 14, color: '#6B7280', marginTop: 2 }}>
                            {c.conversation_type === 'group' ? `群聊 · ${c.member_count ?? (c.members ?? []).length} 人` : '私信'}
                          </div>
                        </div>
                        {showDailyBtn && (
                          <button
                            title="生成工作日报"
                            onClick={(e) => { e.stopPropagation(); setDailyReportTarget(convContact) }}
                            style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid #bfdbfe', background: '#EAF2FF', color: '#1d4ed8', fontSize: 14, fontWeight: 600, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}>
                            📋 日报
                          </button>
                        )}
                        {/* ··· more menu – shown on hover or when menu is open */}
                        {(hoveredConvId === c.id || isMenuOpen) && (
                          <button
                            title="更多操作"
                            onClick={(e) => {
                              e.stopPropagation()
                              if (isMenuOpen) {
                                setConvMenuId(null); setConvMenuPos(null)
                              } else {
                                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                                setConvMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
                                setConvMenuId(c.id)
                              }
                            }}
                            style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid #E5E7EB', background: isMenuOpen ? '#F3F4F6' : '#FFFFFF', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#6B7280', padding: 0, flexShrink: 0 }}>
                            ···
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          ) : (
            /* ── 通讯录 tab — 部门目录 ────────────────────────────────────── */
            <>
              {/* Search bar */}
              <div style={S.sidebarTop}>
                <input
                  placeholder="搜索姓名 / 工号 / 部门 / 职位 / 邮箱"
                  value={dirSearch}
                  onChange={(e) => {
                    const q = e.target.value
                    setDirSearch(q)
                    setSelectedDept(null)
                    setSelectedDirPerson(null)
                    if (dirSearchTimerRef.current) clearTimeout(dirSearchTimerRef.current)
                    if (q.trim()) {
                      dirSearchTimerRef.current = setTimeout(() => void searchPeople(q), 400)
                    } else {
                      setSearchResults([])
                    }
                  }}
                  style={S.searchInput}
                />
              </div>

              <div style={{ flex: 1, overflowY: 'auto' }}>
                {dirSearch.trim() ? (() => {
                  /* ── Search results ──────────────────────────────────────── */
                  if (searchLoading) return <div style={{ padding: '24px 16px', textAlign: 'center', color: '#6B7280', fontSize: 14 }}>搜索中…</div>
                  if (searchResults.length === 0) return <div style={{ padding: '24px 16px', textAlign: 'center', color: '#9CA3AF', fontSize: 14 }}>没有匹配"{dirSearch}"的人员</div>
                  return (
                    <>
                      <div style={{ padding: '5px 14px 4px', fontSize: 12, color: '#9CA3AF', background: '#F9FAFB', borderBottom: '1px solid #EEF1F5' }}>
                        搜索结果（{searchResults.length}）
                      </div>
                      {searchResults.map((p) => {
                        const displayName = p.name || p.enName || p.aiEmail || '未命名成员'
                        const isSelected = selectedDirPerson?.personId === p.personId
                        return (
                          <div key={p.personId} onClick={() => isSelected ? setSelectedDirPerson(null) : void openDirectConversation(p)}
                            style={{ padding: '9px 14px', cursor: 'pointer', borderBottom: '1px solid #EEF1F5', background: isSelected ? '#EAF2FF' : 'transparent', display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#DBEAFE', color: '#1d4ed8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0, fontWeight: 700 }}>
                              {(displayName).slice(0, 1) || '?'}
                            </div>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {displayName}
                                {p.enName && p.enName !== p.name && <span style={{ color: '#9CA3AF', fontWeight: 400, marginLeft: 4, fontSize: 13 }}>{p.enName}</span>}
                              </div>
                              <div style={{ fontSize: 13, color: '#6B7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {[p.position, p.aiEmail || p.sourceEmail].filter(Boolean).join(' · ')}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                              {p.mailboxStatus && <span style={{ fontSize: 11, padding: '1px 5px', borderRadius: 4, background: p.mailboxStatus === 'active' ? '#DCFCE7' : '#FEF9C3', color: p.mailboxStatus === 'active' ? '#166534' : '#92400e' }}>邮</span>}
                              {p.chatStatus && <span style={{ fontSize: 11, padding: '1px 5px', borderRadius: 4, background: p.chatStatus === 'active' ? '#DBEAFE' : '#F3F4F6', color: p.chatStatus === 'active' ? '#1d4ed8' : '#6B7280' }}>聊</span>}
                            </div>
                          </div>
                        )
                      })}
                    </>
                  )
                })() : (() => {
                  /* ── Dept list / members ─────────────────────────────────── */
                  if (orgUnitsLoading) return <div style={{ padding: '24px 16px', textAlign: 'center', color: '#6B7280', fontSize: 14 }}>加载部门目录…</div>
                  if (orgUnitsError) return (
                    <div style={{ padding: '12px 14px', color: '#dc2626', fontSize: 14, background: '#fef2f2' }}>
                      ⚠️ {orgUnitsError}
                      <span style={{ cursor: 'pointer', marginLeft: 8, color: '#2563eb' }} onClick={() => void loadOrgUnits()}>重试</span>
                    </div>
                  )
                  if (orgUnits.length === 0) return <div style={{ padding: '24px 16px', textAlign: 'center', color: '#9CA3AF', fontSize: 14 }}>暂无部门数据，请先在 AccountCenter 导入人员。</div>

                  if (selectedDept) {
                    const deptName = selectedDept.name || selectedDept.enName || '未命名部门'
                    return (
                      <>
                        <div style={{ padding: '8px 14px', borderBottom: '1px solid #EEF1F5', display: 'flex', alignItems: 'center', gap: 8, background: '#F9FAFB', flexShrink: 0 }}>
                          <button onClick={() => { setSelectedDept(null); setDeptMembers([]); setSelectedDirPerson(null) }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2563eb', fontSize: 14, padding: 0, fontWeight: 500 }}>← 返回</button>
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>{deptName}</span>
                          {deptMembers.length > 0 && <span style={{ fontSize: 12, color: '#9CA3AF' }}>（{deptMembers.length} 人）</span>}
                        </div>
                        {deptMembersLoading
                          ? <div style={{ padding: '20px 16px', textAlign: 'center', color: '#6B7280', fontSize: 14 }}>加载成员…</div>
                          : deptMembers.length === 0
                            ? <div style={{ padding: '20px 16px', textAlign: 'center', color: '#9CA3AF', fontSize: 14 }}>该部门暂无成员</div>
                            : deptMembers.map((m) => {
                              const memberName = m.name || m.enName || m.aiEmail || '未命名成员'
                              const isSelected = selectedDirPerson?.personId === m.personId
                              return (
                                <div key={m.personId} onClick={() => isSelected ? setSelectedDirPerson(null) : void openDirectConversation(m)}
                                  style={{ padding: '9px 14px', cursor: 'pointer', borderBottom: '1px solid #EEF1F5', background: isSelected ? '#EAF2FF' : 'transparent', display: 'flex', alignItems: 'center', gap: 10 }}>
                                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#DBEAFE', color: '#1d4ed8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0, fontWeight: 700 }}>
                                    {memberName.slice(0, 1) || '?'}
                                  </div>
                                  <div style={{ minWidth: 0, flex: 1 }}>
                                    <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {memberName}
                                      {m.enName && m.enName !== m.name && <span style={{ color: '#9CA3AF', fontWeight: 400, marginLeft: 4, fontSize: 13 }}>{m.enName}</span>}
                                    </div>
                                    <div style={{ fontSize: 13, color: '#6B7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {[m.position, m.aiEmail].filter(Boolean).join(' · ')}
                                    </div>
                                  </div>
                                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                    <span style={{ fontSize: 11, padding: '1px 5px', borderRadius: 4, background: m.mailboxStatus === 'active' ? '#DCFCE7' : '#FEF9C3', color: m.mailboxStatus === 'active' ? '#166534' : '#92400e' }}>邮</span>
                                    <span style={{ fontSize: 11, padding: '1px 5px', borderRadius: 4, background: m.chatStatus === 'active' ? '#DBEAFE' : '#F3F4F6', color: m.chatStatus === 'active' ? '#1d4ed8' : '#6B7280' }}>聊</span>
                                  </div>
                                </div>
                              )
                            })
                        }
                      </>
                    )
                  }

                  return (
                    <>
                      {orgUnits.map((u) => {
                        const unitName = u.name || u.enName || '未命名部门'
                        return (
                          <div key={u.orgUnitId}
                            onClick={() => { setSelectedDept(u); setDeptMembers([]); setSelectedDirPerson(null); void loadDeptMembers(u.orgUnitId) }}
                            style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #EEF1F5', display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ width: 32, height: 32, borderRadius: 8, background: '#E0E7FF', color: '#4338ca', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>🏢</div>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{unitName}</div>
                              {u.enName && u.enName !== u.name && <div style={{ fontSize: 12, color: '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.enName}</div>}
                            </div>
                            {u.memberCount != null && <span style={{ fontSize: 13, color: '#6B7280', flexShrink: 0 }}>{u.memberCount} 人</span>}
                            <span style={{ color: '#D1D5DB', fontSize: 16, flexShrink: 0 }}>›</span>
                          </div>
                        )
                      })}
                    </>
                  )
                })()}
              </div>
            </>
          )}
        </div>

        {/* ── Message area ───────────────────────────────────────────────── */}
        <div style={S.msgArea}>
          {!activeConvId ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF' }}>
              <div style={{ fontSize: 44, marginBottom: 12 }}>💬</div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, color: '#6B7280' }}>选择一个会话</div>
              <div style={{ fontSize: 14 }}>或点击"新建会话"开始聊天</div>
            </div>
          ) : (
            <>
              {/* Conv title bar */}
              <div style={S.msgHeader}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: activeConv?.conversation_type === 'group' ? '#E5E7EB' : '#DBEAFE', color: activeConv?.conversation_type === 'group' ? '#374151' : '#1d4ed8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0, fontWeight: 600 }}>
                  {activeConv ? convAvatar(activeConv) : '?'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{activeConv ? convLabel(activeConv) : ''}</div>
                  {activeConv?.members && (
                    <div style={{ fontSize: 14, color: '#6B7280' }}>
                      {activeConv.members.map((m) => m.username).join(', ')}
                    </div>
                  )}
                </div>
                {/* "生成日报" button in chat header — always shown for direct conversations */}
                {activeConv && activeConv.conversation_type !== 'group' && (() => {
                  // Try members first, fall back to conv title (server often omits members in list)
                  const members = activeConv.members ?? []
                  let headerContact: ChatContact | null = null
                  const other = members.find((m) => {
                    const mid = String((m as Record<string,unknown>)['userId'] || (m as Record<string,unknown>)['user_id'] || '')
                    return mid ? mid !== String(currentUserId) : normalizeUsername(m.username) !== normalizeUsername(currentUsername)
                  })
                  if (other) {
                    const mid = String((other as Record<string,unknown>)['userId'] || (other as Record<string,unknown>)['user_id'] || '')
                    headerContact =
                      (mid ? contactList.find((x) => String(x.id) === mid) : null) ??
                      contactList.find((x) => normalizeUsername(x.username) === normalizeUsername(other.username)) ??
                      { id: mid || other.username, username: other.username, status: 'active' }
                  } else if (activeConv.title && normalizeUsername(activeConv.title) !== normalizeUsername(currentUsername)) {
                    headerContact =
                      contactList.find((x) =>
                        normalizeUsername(x.username) === normalizeUsername(activeConv.title ?? '') ||
                        (x.displayName && normalizeUsername(x.displayName) === normalizeUsername(activeConv.title ?? '')),
                      ) ?? { id: activeConv.title, username: activeConv.title, status: 'active' }
                  }
                  if (!headerContact) return null
                  return (
                    <button
                      title="生成工作日报"
                      onClick={() => setDailyReportTarget(headerContact!)}
                      style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid #bfdbfe', background: '#EAF2FF', color: '#1d4ed8', fontSize: 14, fontWeight: 600, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                      📋 生成日报
                    </button>
                  )
                })()}
                {/* "解散群聊" button — only for group owner, only when not dissolved */}
                {activeConv?.conversation_type === 'group'
                  && activeConv.status !== 'dissolved'
                  && activeConv.created_by === currentUserId && (
                  <button
                    title="解散群聊"
                    onClick={() => { setDissolveConfirmId(activeConv.id); setDissolveError(null) }}
                    style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid #fecaca', background: '#FEF2F2', color: '#dc2626', fontSize: 14, fontWeight: 600, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                    🗑️ 解散群聊
                  </button>
                )}
              </div>

              {/* Messages */}
              <div
                style={{ ...S.msgList, outline: dragOver ? '2px dashed #2563eb' : 'none', background: dragOver ? '#EFF6FF' : '#F5F7FB', transition: 'background 0.1s' }}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onPaste={handlePaste}
              >
                {loadingMsgs && !messages.length && (
                  <div style={{ textAlign: 'center', color: '#6B7280', fontSize: 14, paddingTop: 40 }}>加载中…</div>
                )}
                {msgError && (
                  <div style={{ textAlign: 'center', color: '#dc2626', fontSize: 14, paddingTop: 40 }}>
                    ⚠️ {msgError}
                    <br />
                    <span style={{ color: '#2563eb', cursor: 'pointer', fontSize: 14 }} onClick={() => { void loadMessages(activeConvId) }}>重试</span>
                  </div>
                )}
                {!msgError && messages.length === 0 && !loadingMsgs && (
                  <div style={{ textAlign: 'center', color: '#6B7280', fontSize: 14, paddingTop: 40 }}>
                    <div style={{ fontSize: 28, marginBottom: 8 }}>🗨️</div>
                    暂无消息，发送第一条消息开始聊天
                  </div>
                )}
                {messages.map((m, i) => {
                  const mine = m.senderId === currentUserId
                  const prevMsg = messages[i - 1]
                  const curDateLabel = safeFmtDate(m.createdAt)
                  const prevDateLabel = prevMsg ? safeFmtDate(prevMsg.createdAt) : null
                  const showDate = curDateLabel !== null && curDateLabel !== prevDateLabel
                  const showSender = !mine && (!prevMsg || prevMsg.senderId !== m.senderId || showDate)
                  const att = resolveAttachment(m)
                  const displayName = m.senderDisplayName || m.senderUsername || m.senderId.slice(0, 8) || '未知用户'
                  return (
                    <React.Fragment key={m.id}>
                      {showDate && curDateLabel && (
                        <div style={{ textAlign: 'center', color: '#9CA3AF', fontSize: 14, margin: '14px 0 10px' }}>
                          — {curDateLabel} —
                        </div>
                      )}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start', marginBottom: 2 }}>
                        {showSender && (
                          <div style={{ fontSize: 14, color: '#6B7280', marginBottom: 3, marginLeft: 4 }}>
                            {displayName}
                          </div>
                        )}
                        {/* Image message */}
                        {m.messageType === 'image' && att ? (
                          <div style={{ maxWidth: 240 }}>
                            <ProtectedChatImage
                              previewUrl={att.previewUrl ?? att.downloadUrl}
                              fileName={att.fileName}
                              token={token}
                              style={S.imgThumb}
                              onOpen={(blobUrl) => setLightboxUrl(blobUrl)}
                            />
                            {m.body && <div style={{ fontSize: 14, color: mine ? '#1e40af' : '#374151', marginTop: 4 }}>{m.body}</div>}
                            {fmtTime(m.createdAt) && <div style={{ fontSize: 14, color: '#9CA3AF', marginTop: 3, textAlign: 'right' }}>{fmtTime(m.createdAt)}</div>}
                          </div>
                        ) : m.messageType === 'file' && att ? (
                          /* File card */
                          <div style={S.fileCard(mine)}>
                            <div style={{ fontSize: 22, flexShrink: 0 }}>📎</div>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontSize: 14, fontWeight: 600, color: mine ? '#fff' : '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {att.fileName}
                              </div>
                              <div style={{ fontSize: 14, color: mine ? '#93c5fd' : '#6B7280' }}>{fmtBytes(att.sizeBytes)}</div>
                              {m.body && <div style={{ fontSize: 14, color: mine ? '#e0f2fe' : '#374151', marginTop: 2 }}>{m.body}</div>}
                              {fmtTime(m.createdAt) && <div style={{ fontSize: 14, color: mine ? '#93c5fd' : '#9CA3AF', marginTop: 3 }}>{fmtTime(m.createdAt)}</div>}
                            </div>
                            <button
                              onClick={() => { void downloadAttachment(att) }}
                              style={{ ...S.iconBtn(), border: mine ? '1px solid rgba(255,255,255,0.3)' : '1px solid #D1D5DB', color: mine ? '#fff' : '#374151', background: mine ? 'rgba(255,255,255,0.15)' : '#FFFFFF', fontSize: 16 }}
                              title="下载">
                              ⬇
                            </button>
                          </div>
                        ) : (
                          /* Text bubble */
                          <div style={S.msgBubble(mine)}>
                            <div>{m.body}</div>
                            {fmtTime(m.createdAt) && (
                              <div style={{ fontSize: 14, color: mine ? '#93c5fd' : '#9CA3AF', marginTop: 4, textAlign: 'right' }}>
                                {fmtTime(m.createdAt)}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </React.Fragment>
                  )
                })}
                <div ref={msgEndRef} />
              </div>

              {/* Pending attachment preview bar */}
              {pendingFile && (
                <div style={S.previewBar}>
                  {pendingFileType === 'image' && pendingPreviewUrl ? (
                    <img src={pendingPreviewUrl} alt="预览" style={{ height: 48, width: 48, objectFit: 'cover', borderRadius: 6, border: '1px solid #BAE6FD' }} />
                  ) : (
                    <span style={{ fontSize: 22 }}>📎</span>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#0369a1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {pendingFile.name}
                    </div>
                    <div style={{ fontSize: 14, color: '#0284c7' }}>{fmtBytes(pendingFile.size)}</div>
                  </div>
                  {uploading ? (
                    <div style={{ fontSize: 14, color: '#0284c7', flexShrink: 0 }}>
                      上传中… {uploadProgress}%
                    </div>
                  ) : (
                    <button onClick={clearPending} style={{ ...S.iconBtn(), fontSize: 14, color: '#6B7280' }} title="取消">✕</button>
                  )}
                </div>
              )}
              {uploadError && (
                <div style={{ padding: '6px 14px', background: '#fef2f2', borderTop: '1px solid #fecaca', fontSize: 14, color: '#dc2626', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>⚠️ {uploadError}</span>
                  <button onClick={() => setUploadError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', fontSize: 14, padding: '0 4px' }}>✕</button>
                </div>
              )}

              {/* Dissolved group banner */}
              {isDissolvedGroup && (
                <div style={{ padding: '10px 20px', background: '#FEF9C3', borderTop: '1px solid #FDE68A', textAlign: 'center', fontSize: 14, color: '#92400E', flexShrink: 0 }}>
                  该群聊已解散
                </div>
              )}

              {/* Input row */}
              <div style={{ ...S.inputRow, gap: 6 }}>
                {isDissolvedGroup ? (
                  <>
                    <button disabled style={S.iconBtn(true)}>🖼️</button>
                    <button disabled style={S.iconBtn(true)}>📎</button>
                    <textarea
                      rows={2}
                      disabled
                      placeholder="该群聊已解散，无法继续发送消息"
                      value=""
                      onChange={() => { /* disabled */ }}
                      style={{ ...S.input, background: '#F9FAFB', color: '#9CA3AF', cursor: 'not-allowed' }}
                    />
                    <button disabled style={{ ...S.btn(true), opacity: 0.4 }}>发送</button>
                  </>
                ) : (
                  <>
                    {/* Image button */}
                    <button
                      title="发送图片"
                      disabled={!activeConvId || uploading}
                      onClick={() => imgInputRef.current?.click()}
                      style={S.iconBtn(!activeConvId || uploading)}>
                      🖼️
                    </button>
                    {/* File button */}
                    <button
                      title="发送附件"
                      disabled={!activeConvId || uploading}
                      onClick={() => fileInputRef.current?.click()}
                      style={S.iconBtn(!activeConvId || uploading)}>
                      📎
                    </button>
                    <textarea
                      rows={2}
                      placeholder={pendingFile ? '可添加说明文字… (Enter 发送)' : '输入消息… (Enter 发送，Shift+Enter 换行)'}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          void handleSend()
                        }
                      }}
                      style={S.input}
                    />
                    <button
                      style={{ ...S.btn(true), opacity: ((!text.trim() && !pendingFile) || sending || uploading) ? 0.5 : 1 }}
                      disabled={sending || uploading || (!text.trim() && !pendingFile)}
                      onClick={() => { void handleSend() }}>
                      {uploading ? `${uploadProgress}%` : sending ? '…' : '发送'}
                    </button>
                  </>
                )}
              </div>
              {/* Hidden file inputs */}
              <input
                ref={imgInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) selectFile(f, 'image'); e.target.value = '' }}
              />
              <input
                ref={fileInputRef} type="file" style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) selectFile(f, 'file'); e.target.value = '' }}
              />
            </>
          )}
        </div>

        {/* ── Right panel: contact profile (from conversations tab) ─────── */}
        {selectedContact && !selectedDirPerson && (
          <ContactProfilePanel
            contact={selectedContact}
            viewerUserId={currentUserId}
            onSendMessage={(c) => { void handleSendToContact(c) }}
            onClose={() => setSelectedContact(null)}
          />
        )}

        {/* ── Right panel: directory person profile ──────────────────────── */}
        {selectedDirPerson && (
          <div style={S.rightPanel}>
            <div style={{ padding: '12px 14px', borderBottom: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#374151' }}>联系人资料</span>
              <button onClick={() => setSelectedDirPerson(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', fontSize: 18, lineHeight: 1, padding: '0 2px' }}>✕</button>
            </div>
            {/* Avatar + name */}
            <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, borderBottom: '1px solid #EEF1F5', flexShrink: 0 }}>
              <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#DBEAFE', color: '#1d4ed8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700 }}>
                {(selectedDirPerson.name || selectedDirPerson.enName || '?').slice(0, 1)}
              </div>
              <div style={{ fontWeight: 700, fontSize: 15, color: '#111827', textAlign: 'center' }}>{selectedDirPerson.name || selectedDirPerson.enName || selectedDirPerson.aiEmail || '未命名成员'}</div>
              {selectedDirPerson.enName && <div style={{ fontSize: 14, color: '#6B7280' }}>{selectedDirPerson.enName}</div>}
            </div>
            {/* Info rows */}
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #EEF1F5', display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
              {selectedDirPerson.position && (
                <div>
                  <div style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 2 }}>职位</div>
                  <div style={{ fontSize: 14, color: '#374151' }}>{selectedDirPerson.position}</div>
                </div>
              )}
              {'department' in selectedDirPerson && selectedDirPerson.department && (
                <div>
                  <div style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 2 }}>部门</div>
                  <div style={{ fontSize: 14, color: '#374151' }}>{selectedDirPerson.department}</div>
                </div>
              )}
              {'employeeId' in selectedDirPerson && selectedDirPerson.employeeId && (
                <div>
                  <div style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 2 }}>工号</div>
                  <div style={{ fontSize: 14, color: '#374151' }}>{selectedDirPerson.employeeId}</div>
                </div>
              )}
              {selectedDirPerson.aiEmail && (
                <div>
                  <div style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 2 }}>AI Office 邮箱</div>
                  <div style={{ fontSize: 14, color: '#374151', wordBreak: 'break-all' }}>{selectedDirPerson.aiEmail}</div>
                </div>
              )}
              {'sourceEmail' in selectedDirPerson && selectedDirPerson.sourceEmail && (
                <div>
                  <div style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 2 }}>原办公邮箱</div>
                  <div style={{ fontSize: 14, color: '#6B7280', wordBreak: 'break-all' }}>{selectedDirPerson.sourceEmail}</div>
                </div>
              )}
              {selectedDirPerson.mailboxStatus && (
                <div>
                  <div style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 4 }}>邮箱状态</div>
                  <span style={{ fontSize: 12, padding: '2px 7px', borderRadius: 4, background: selectedDirPerson.mailboxStatus === 'active' ? '#DCFCE7' : '#FEF9C3', color: selectedDirPerson.mailboxStatus === 'active' ? '#166534' : '#92400e' }}>
                    {selectedDirPerson.mailboxStatus === 'active' ? '已开通' : selectedDirPerson.mailboxStatus === 'not_created' ? 'AI 邮箱尚未创建' : selectedDirPerson.mailboxStatus}
                  </span>
                </div>
              )}
              {selectedDirPerson.chatStatus && (
                <div>
                  <div style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 4 }}>内部通讯状态</div>
                  <span style={{ fontSize: 12, padding: '2px 7px', borderRadius: 4, background: selectedDirPerson.chatStatus === 'active' ? '#DBEAFE' : '#F3F4F6', color: selectedDirPerson.chatStatus === 'active' ? '#1d4ed8' : '#6B7280' }}>
                    {selectedDirPerson.chatStatus === 'active' ? '已开通' : selectedDirPerson.chatStatus === 'not_created' ? '内部通讯账号未开通' : selectedDirPerson.chatStatus}
                  </span>
                </div>
              )}
            </div>
            {/* Send message button */}
            <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
              {dirSendError && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 4 }}>⚠️ {dirSendError}</div>}
              {(() => {
                const chatSt = selectedDirPerson.chatStatus
                const canMsg = chatSt === 'active'
                const notCreated = chatSt === 'not_created'
                return (
                  <button
                    disabled={!canMsg}
                    title={notCreated ? '内部通讯账号未开通' : !chatSt ? '内部通讯不可用' : '发送内部消息'}
                    onClick={() => void openDirectConversation(selectedDirPerson)}
                    style={{ padding: '9px 0', borderRadius: 8, border: 'none', cursor: canMsg ? 'pointer' : 'not-allowed', background: canMsg ? '#2563eb' : '#E5E7EB', color: canMsg ? '#fff' : '#9CA3AF', fontSize: 14, fontWeight: 600 }}>
                    {notCreated ? '💬 内部通讯账号未开通' : '💬 发消息'}
                  </button>
                )
              })()}
              {/* 发邮件按钮 */}
              {(() => {
                const mailSt = selectedDirPerson.mailboxStatus
                const canMail = mailSt === 'active' && !!selectedDirPerson.aiEmail
                const mailLabel = mailSt === 'not_created' ? '✉️ AI 邮箱尚未创建'
                  : mailSt === 'failed' ? '✉️ AI 邮箱创建失败'
                  : mailSt === 'disabled' ? '✉️ AI 邮箱已禁用'
                  : !selectedDirPerson.aiEmail ? '✉️ 无 AI 邮箱'
                  : '✉️ 发邮件'
                return (
                  <button
                    disabled={!canMail}
                    title={!canMail ? (mailSt === 'not_created' ? 'AI 邮箱尚未创建' : mailSt === 'failed' ? 'AI 邮箱创建失败' : mailSt === 'disabled' ? 'AI 邮箱已禁用' : '无 AI 邮箱') : '发送邮件'}
                    onClick={() => {
                      if (!canMail || !selectedDirPerson.aiEmail) return
                      setPendingCompose({
                        email: selectedDirPerson.aiEmail,
                        displayName: selectedDirPerson.name || selectedDirPerson.enName,
                        personId: selectedDirPerson.personId,
                        mailboxStatus: 'active',
                        fromDirectory: true,
                      })
                      window.dispatchEvent(new CustomEvent('open-email-compose'))
                    }}
                    style={{ padding: '9px 0', borderRadius: 8, border: 'none', cursor: canMail ? 'pointer' : 'not-allowed', background: canMail ? '#059669' : '#E5E7EB', color: canMail ? '#fff' : '#9CA3AF', fontSize: 14, fontWeight: 600 }}>
                    {mailLabel}
                  </button>
                )
              })()}
              {/* 生成日报按钮 — always shown for non-self active chat users */}
              {selectedDirPerson.chatStatus === 'active' && (
                <button
                  title="生成工作日报"
                  onClick={async () => {
                    try {
                      const target = await resolveDirectoryChatTarget(token, selectedDirPerson)
                      if (target.targetUserId && target.targetUserId !== currentUserId) {
                        setDailyReportTarget({
                          id: target.targetUserId,
                          username: target.targetUsername ?? target.displayName ?? '',
                          displayName: target.displayName,
                          status: 'active',
                        })
                      }
                    } catch { /* silently ignore — button will simply not open modal */ }
                  }}
                  style={{ padding: '9px 0', borderRadius: 8, border: 'none', cursor: 'pointer', background: '#EAF2FF', color: '#1d4ed8', fontSize: 14, fontWeight: 600 }}>
                  📋 生成日报
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {showNewModal && (
        <NewConvModal
          token={token}
          currentUserId={currentUserId}
          onCreated={(conv) => {
            setConvs((p) => [conv, ...p.filter((c) => c.id !== conv.id)])
            setShowNewModal(false)
            selectConv(conv.id)
            void loadConvs()
          }}
          onClose={() => setShowNewModal(false)}
        />
      )}

      {/* Top-level daily report modal — triggered from conv list or chat header */}
      {dailyReportTarget && (
        <DailyReportModal
          contact={dailyReportTarget}
          viewerUserId={currentUserId}
          onClose={() => setDailyReportTarget(null)}
        />
      )}

      {/* Image lightbox */}
      {lightboxUrl && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 10001, background: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setLightboxUrl(null)}>
          <img
            src={lightboxUrl}
            alt="大图预览"
            style={{ maxWidth: '92vw', maxHeight: '88vh', borderRadius: 8, boxShadow: '0 8px 48px rgba(0,0,0,0.5)', objectFit: 'contain' }}
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setLightboxUrl(null)}
            style={{ position: 'absolute', top: 18, right: 22, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer', borderRadius: 8, padding: '4px 10px', lineHeight: 1 }}>
            ✕
          </button>
        </div>
      )}

      {/* ── Conversation more-menu (fixed dropdown) ──────────────────────── */}
      {convMenuId && convMenuPos && (
        <>
          {/* Backdrop */}
          <div style={{ position: 'fixed', inset: 0, zIndex: 10010 }} onClick={() => { setConvMenuId(null); setConvMenuPos(null) }} />
          <div style={{ position: 'fixed', top: convMenuPos.top, right: convMenuPos.right, zIndex: 10011, background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', minWidth: 128, overflow: 'hidden' }}>
            <button
              onClick={() => { setConvMenuId(null); setConvMenuPos(null); setHideConfirmId(convMenuId); setHideError(null) }}
              style={{ display: 'block', width: '100%', padding: '10px 16px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14, color: '#374151', textAlign: 'left', lineHeight: 1.4 }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#F3F4F6' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
              移除会话
            </button>
          </div>
        </>
      )}

      {/* ── Hide conversation confirmation modal ─────────────────────────── */}
      {hideConfirmId && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 10020, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={(e) => { if (e.target === e.currentTarget) { setHideConfirmId(null); setHideError(null) } }}>
          <div style={{ background: '#FFFFFF', borderRadius: 12, padding: '24px 28px', maxWidth: 400, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.16)' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 12 }}>移除会话</div>
            <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.6, marginBottom: 20 }}>
              确定从最近会话中移除该会话吗？历史消息不会被删除。
            </div>
            {hideError && (
              <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>⚠️ {hideError}</div>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setHideConfirmId(null); setHideError(null) }}
                style={{ ...S.btn(false), padding: '7px 18px' }}>
                取消
              </button>
              <button
                onClick={() => { void handleHideConversation(hideConfirmId) }}
                style={{ ...S.btn(true), padding: '7px 18px', background: '#dc2626' }}>
                移除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Dissolve group confirmation modal ────────────────────────────── */}
      {dissolveConfirmId && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 10020, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={(e) => { if (e.target === e.currentTarget) { setDissolveConfirmId(null); setDissolveError(null) } }}>
          <div style={{ background: '#FFFFFF', borderRadius: 12, padding: '24px 28px', maxWidth: 420, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.16)' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 12 }}>解散群聊</div>
            <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.6, marginBottom: 20 }}>
              确定解散该群聊吗？解散后所有成员都无法继续发送消息，历史消息仍会保留。
            </div>
            {dissolveError && (
              <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>⚠️ {dissolveError}</div>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setDissolveConfirmId(null); setDissolveError(null) }}
                style={{ ...S.btn(false), padding: '7px 18px' }}>
                取消
              </button>
              <button
                onClick={() => { void handleDissolveConversation(dissolveConfirmId) }}
                style={{ ...S.btn(true), padding: '7px 18px', background: '#dc2626' }}>
                解散
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )

  if (inline) {
    return (
      <div style={{ ...S.window, width: '100%', maxWidth: '100%', height: '100%', borderRadius: 0, boxShadow: 'none', border: 'none' }}>
        {innerContent}
      </div>
    )
  }

  return (
    <div style={S.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={S.window}>
        {innerContent}
      </div>
    </div>
  )
}

export default ChatWindow
