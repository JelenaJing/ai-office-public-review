import { ACCOUNT_CENTER_URL } from '../../accountCenterConfig'
import type { ChatConversation, ChatContact, ChatMessage, ChatAttachment } from './types'

function chatUrl(endpoint: string): string {
  return `${ACCOUNT_CENTER_URL}${endpoint}`
}

function methodOf(options?: RequestInit): string {
  return String(options?.method ?? 'GET').toUpperCase()
}

function payloadOf(options?: RequestInit): unknown {
  if (typeof options?.body !== 'string') return undefined
  try {
    return JSON.parse(options.body)
  } catch {
    return options.body
  }
}

async function apiFetch<T>(endpoint: string, token: string, options?: RequestInit): Promise<T> {
  const url = chatUrl(endpoint)
  const method = methodOf(options)
  const payload = payloadOf(options)
  let res: Response
  try {
    res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options?.headers ?? {}),
      },
    })
  } catch (error) {
    console.error('[chat] fetch error', error)
    console.error('[chat] start conversation failed', {
      url,
      method,
      payload,
      status: undefined,
      error,
    })
    throw new Error('无法连接聊天服务，请检查 AccountCenter Chat 服务是否已启动')
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, string>
    const error = body.error ?? body.message ?? `HTTP ${res.status}`
    console.error('[chat] start conversation failed', {
      url,
      method,
      payload,
      status: res.status,
      error,
    })
    throw new Error(error)
  }
  return res.json() as Promise<T>
}

/** Ensure a URL is absolute. Prepends ACCOUNT_CENTER_URL if the URL starts with '/'. */
function ensureAbsoluteUrl(url: string | null | undefined): string {
  if (!url || url.trim() === '') return ''
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  if (url.startsWith('/')) return `${ACCOUNT_CENTER_URL}${url}`
  return url
}

// ─── User chat APIs ──────────────────────────────────────────────────────────

export function getConversations(token: string): Promise<ChatConversation[]> {
  return apiFetch<ChatConversation[]>('/api/chat/conversations', token)
}

export function createConversation(token: string, data: { conversationType: 'direct' | 'group'; title?: string; memberIds: string[] }): Promise<ChatConversation> {
  return apiFetch<ChatConversation>('/api/chat/conversations', token, { method: 'POST', body: JSON.stringify(data) })
}

/**
 * Remove a conversation from the current user's recent list (hide it).
 * Does NOT delete history or affect other members.
 * POST /api/chat/conversations/:conversationId/hide
 */
export async function hideConversation(token: string, conversationId: string): Promise<void> {
  await apiFetch<unknown>(`/api/chat/conversations/${conversationId}/hide`, token, { method: 'POST' })
}

/**
 * Dissolve a group conversation (group owner/admin only).
 * All members can no longer send messages; history is preserved.
 * POST /api/chat/conversations/:conversationId/dissolve
 */
export function dissolveConversation(token: string, conversationId: string): Promise<ChatConversation> {
  return apiFetch<ChatConversation>(`/api/chat/conversations/${conversationId}/dissolve`, token, { method: 'POST' })
}

function findDirectConversation(
  conversations: ChatConversation[],
  target: { targetUserId?: string; targetUsername?: string },
): ChatConversation | null {
  return conversations.find((conversation) => {
    if (conversation.conversation_type !== 'direct') return false
    return (conversation.members ?? []).some((member) => {
      if (target.targetUserId && member.userId === target.targetUserId) return true
      return Boolean(target.targetUsername && member.username === target.targetUsername)
    })
  }) ?? null
}

export async function ensureDirectConversation(
  token: string,
  target: { targetUserId: string; targetUsername?: string },
): Promise<ChatConversation> {
  const conversations = await getConversations(token)
  const existing = findDirectConversation(conversations, target)
  if (existing) return existing

  return createConversation(token, {
    conversationType: 'direct',
    memberIds: [target.targetUserId],
  })
}

export function getMessages(token: string, conversationId: string, before?: string): Promise<ChatMessage[]> {
  const q = before ? `?before=${encodeURIComponent(before)}` : ''
  return apiFetch<unknown[]>(`/api/chat/conversations/${conversationId}/messages${q}`, token)
    .then((list) => list.map(normalizeChatMessage))
}

export function sendMessage(token: string, conversationId: string, body: string, messageType: 'text' | 'image' | 'file' = 'text'): Promise<ChatMessage> {
  return apiFetch<unknown>(`/api/chat/conversations/${conversationId}/messages`, token, {
    method: 'POST',
    body: JSON.stringify({ body, message_type: messageType }),
  }).then(normalizeChatMessage)
}

/** Normalise a raw server message object (snake_case OR camelCase) into canonical ChatMessage. */
export function normalizeChatMessage(raw: unknown): ChatMessage {
  const r = (raw ?? {}) as Record<string, unknown>

  // Resolve createdAt from any known field, guarding against undefined/null/invalid
  const rawTime = r.createdAt ?? r.created_at ?? r.timestamp ?? r.time ?? r.date
  const createdAt = rawTime != null && String(rawTime).trim() !== '' ? String(rawTime) : ''

  // Resolve attachment, handling both nested object and flat fields
  let attachment: ChatAttachment | undefined
  if (r.attachment && typeof r.attachment === 'object') {
    const a = r.attachment as Record<string, unknown>
    const attId = String(a.id ?? '')
    const rawPreview = a.previewUrl ?? a.preview_url
    const rawDownload = a.downloadUrl ?? a.download_url
    // Generate fallback URLs from attachment ID if server didn't include them
    const previewUrl = rawPreview != null && String(rawPreview).trim() !== ''
      ? ensureAbsoluteUrl(String(rawPreview))
      : attId ? `${ACCOUNT_CENTER_URL}/api/chat/attachments/${attId}/preview` : undefined
    const downloadUrl = rawDownload != null && String(rawDownload).trim() !== ''
      ? ensureAbsoluteUrl(String(rawDownload))
      : attId ? `${ACCOUNT_CENTER_URL}/api/chat/attachments/${attId}/download` : ''
    attachment = {
      id: attId,
      fileName: String(a.fileName ?? a.file_name ?? ''),
      mimeType: String(a.mimeType ?? a.mime_type ?? 'application/octet-stream'),
      sizeBytes: Number(a.sizeBytes ?? a.size_bytes ?? 0),
      previewUrl,
      downloadUrl,
    }
  } else if (r.file_name || r.fileName) {
    const attId = String(r.attachment_id ?? r.attachmentId ?? r.id ?? '')
    const rawPreview = r.previewUrl ?? r.preview_url
    const rawDownload = r.downloadUrl ?? r.download_url
    const previewUrl = rawPreview != null && String(rawPreview).trim() !== ''
      ? ensureAbsoluteUrl(String(rawPreview))
      : attId ? `${ACCOUNT_CENTER_URL}/api/chat/attachments/${attId}/preview` : undefined
    const downloadUrl = rawDownload != null && String(rawDownload).trim() !== ''
      ? ensureAbsoluteUrl(String(rawDownload))
      : attId ? `${ACCOUNT_CENTER_URL}/api/chat/attachments/${attId}/download` : ''
    attachment = {
      id: attId,
      fileName: String(r.file_name ?? r.fileName ?? ''),
      mimeType: String(r.mime_type ?? r.mimeType ?? 'application/octet-stream'),
      sizeBytes: Number(r.size_bytes ?? r.sizeBytes ?? 0),
      previewUrl,
      downloadUrl,
    }
  }

  const rawType = String(r.messageType ?? r.message_type ?? 'text')
  const messageType: ChatMessage['messageType'] =
    rawType === 'image' ? 'image' : rawType === 'file' ? 'file' : 'text'

  return {
    id: String(r.id ?? ''),
    conversationId: String(r.conversationId ?? r.conversation_id ?? ''),
    senderId: String(r.senderId ?? r.sender_id ?? ''),
    senderUsername: String(r.senderUsername ?? r.sender_username ?? r.username ?? ''),
    senderDisplayName: r.senderDisplayName != null
      ? String(r.senderDisplayName)
      : r.sender_display_name != null
        ? String(r.sender_display_name)
        : undefined,
    messageType,
    body: String(r.body ?? r.content ?? r.text ?? ''),
    attachmentId: r.attachment_id != null ? String(r.attachment_id) : r.attachmentId != null ? String(r.attachmentId) : null,
    createdAt,
    attachment,
  }
}

/**
 * Upload a file/image attachment to a conversation.
 * Uses XHR so upload progress events are available.
 * Returns the new ChatMessage created by the server.
 */
export function uploadChatAttachment(
  token: string,
  conversationId: string,
  file: File,
  messageType: 'image' | 'file',
  optionalText?: string,
  onProgress?: (pct: number) => void,
): Promise<ChatMessage> {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('file', file)
    form.append('messageType', messageType)
    if (optionalText?.trim()) form.append('optionalText', optionalText.trim())

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${ACCOUNT_CENTER_URL}/api/chat/conversations/${conversationId}/attachments`)
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)

    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(normalizeChatMessage(JSON.parse(xhr.responseText))) }
        catch { reject(new Error('响应解析失败')) }
      } else {
        let msg = `HTTP ${xhr.status}`
        try {
          const b = JSON.parse(xhr.responseText) as Record<string, string>
          msg = b.error ?? b.message ?? msg
        } catch { /* ignore */ }
        reject(new Error(msg))
      }
    }
    xhr.onerror = () => reject(new Error('网络错误，上传失败'))
    xhr.onabort = () => reject(new Error('上传已取消'))
    xhr.send(form)
  })
}

/**
 * Fetch the list of users the current user can chat with.
 * Calls GET /api/chat/contacts; handles array or wrapped-object responses.
 * Throws with a clear message on 401/403/network errors.
 * Does NOT fall back to conversation history.
 */
export async function getChatContacts(token: string): Promise<ChatContact[]> {
  let res: Response
  try {
    res = await fetch(`${ACCOUNT_CENTER_URL}/api/chat/contacts`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    })
  } catch (e) {
    throw new Error(`网络错误：${e instanceof Error ? e.message : String(e)}`)
  }

  if (res.status === 401) throw new Error('未授权，请重新登录')
  if (res.status === 403) throw new Error('无权限访问联系人目录')
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, string>
    throw new Error(body.error ?? body.message ?? `HTTP ${res.status}`)
  }

  const raw: unknown = await res.json()

  // Normalise: server may return [] or {contacts:[]} or {users:[]} or {data:[]}
  let list: Record<string, unknown>[]
  if (Array.isArray(raw)) {
    list = raw as Record<string, unknown>[]
  } else if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    const arr = obj.contacts ?? obj.users ?? obj.data ?? obj.items
    list = Array.isArray(arr) ? (arr as Record<string, unknown>[]) : []
  } else {
    list = []
  }

  return list
    .map((u): ChatContact => ({
      id: String(u.id ?? u.userId ?? u.user_id ?? ''),
      username: String(u.username ?? ''),
      displayName: u.display_name != null
        ? String(u.display_name)
        : u.displayName != null
          ? String(u.displayName)
          : undefined,
      email: u.email != null ? String(u.email) : undefined,
      departmentId: u.department_id != null
        ? String(u.department_id)
        : u.departmentId != null
          ? String(u.departmentId)
          : null,
      departmentName: u.department_name != null
        ? String(u.department_name)
        : u.departmentName != null
          ? String(u.departmentName)
          : u.department != null && typeof u.department === 'object'
            ? String((u.department as Record<string, unknown>).name ?? '')
            : undefined,
      position: u.position != null
        ? String(u.position)
        : u.job_title != null
          ? String(u.job_title)
          : u.jobTitle != null
            ? String(u.jobTitle)
            : undefined,
      managerId: u.manager_id != null
        ? String(u.manager_id)
        : u.managerId != null
          ? String(u.managerId)
          : u.supervisor_id != null
            ? String(u.supervisor_id)
            : u.supervisorId != null
              ? String(u.supervisorId)
              : null,
      // Server-authoritative: whether the current viewer can generate a daily report for this contact.
      canViewWorkReport: typeof u.canViewWorkReport === 'boolean'
        ? u.canViewWorkReport
        : typeof u.can_view_work_report === 'boolean'
          ? u.can_view_work_report
          : undefined,
      roles: Array.isArray(u.roles) ? (u.roles as string[]) : undefined,
      status: u.status === 'disabled' ? 'disabled' : 'active',
      avatarColor: u.avatar_color != null
        ? String(u.avatar_color)
        : u.avatarColor != null
          ? String(u.avatarColor)
          : undefined,
      avatarUrl: u.avatar_url != null
        ? String(u.avatar_url)
        : u.avatarUrl != null
          ? String(u.avatarUrl)
          : undefined,
      roleLabel: u.role_label != null
        ? String(u.role_label)
        : u.roleLabel != null
          ? String(u.roleLabel)
          : undefined,
      bio: u.bio != null ? String(u.bio) : undefined,
    }))
    .filter((c) => c.id !== '')
}

// ─── Legacy contact helpers (kept for compatibility) ─────────────────────────

export interface Contact {
  id: string
  username: string
  display_name: string
  department_id?: string
  roles?: string[]
  status: string
}

export interface ContactsResult {
  contacts: Contact[]
  fallback: boolean
}

/**
 * @deprecated Use getChatContacts() instead.
 */
export async function getContactsRich(token: string, currentUserId?: string): Promise<ContactsResult> {
  try {
    const list = await getChatContacts(token)
    const contacts: Contact[] = list.map((c) => ({
      id: c.id,
      username: c.username,
      display_name: c.displayName ?? c.username,
      department_id: c.departmentId ?? undefined,
      roles: c.roles,
      status: c.status,
    }))
    return { contacts, fallback: false }
  } catch {
    // Fallback: extract unique non-self members from existing conversations
    let selfId = currentUserId ?? ''
    if (!selfId) {
      try {
        const parts = token.split('.')
        if (parts.length >= 2) {
          const pad = parts[1].replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - parts[1].length % 4) % 4)
          const payload = JSON.parse(atob(pad)) as Record<string, unknown>
          selfId = String(payload.userId ?? payload.sub ?? payload.id ?? '')
        }
      } catch { /* ignore */ }
    }
    let conversations: ChatConversation[] = []
    try { conversations = await getConversations(token) } catch { /* ignore */ }
    const seen = new Set<string>()
    const contacts: Contact[] = []
    for (const conv of conversations) {
      if (!Array.isArray(conv.members)) continue
      for (const m of conv.members) {
        if (m.userId === selfId || seen.has(m.userId)) continue
        seen.add(m.userId)
        contacts.push({ id: m.userId, username: m.username, display_name: m.username, status: 'active' })
      }
    }
    return { contacts, fallback: true }
  }
}

/** @deprecated Use getChatContacts() instead. */
export async function getContacts(token: string): Promise<Contact[]> {
  const { contacts } = await getContactsRich(token)
  return contacts
}

// ─── Admin chat audit APIs ───────────────────────────────────────────────────

export function adminGetConversations(token: string, params?: { userId?: string; dateFrom?: string; dateTo?: string; page?: number; pageSize?: number }): Promise<ChatConversation[]> {
  const q = new URLSearchParams()
  if (params?.userId) q.set('userId', params.userId)
  if (params?.dateFrom) q.set('dateFrom', params.dateFrom)
  if (params?.dateTo) q.set('dateTo', params.dateTo)
  if (params?.page) q.set('page', String(params.page))
  if (params?.pageSize) q.set('pageSize', String(params.pageSize))
  return apiFetch<ChatConversation[]>(`/api/admin/chat/conversations?${q}`, token)
}

export function adminGetMessages(token: string, conversationId: string): Promise<ChatMessage[]> {
  return apiFetch<unknown[]>(`/api/admin/chat/conversations/${conversationId}/messages`, token)
    .then((list) => list.map(normalizeChatMessage))
}

export function adminSearchMessages(token: string, q: string, params?: { userId?: string; dateFrom?: string; dateTo?: string }): Promise<ChatMessage[]> {
  const qs = new URLSearchParams({ q })
  if (params?.userId) qs.set('userId', params.userId)
  if (params?.dateFrom) qs.set('dateFrom', params.dateFrom)
  if (params?.dateTo) qs.set('dateTo', params.dateTo)
  return apiFetch<unknown[]>(`/api/admin/chat/search?${qs}`, token)
    .then((list) => list.map(normalizeChatMessage))
}
