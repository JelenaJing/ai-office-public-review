/**
 * Matrix Client-Server REST API client (Phase 6-A MVP)
 *
 * Rules:
 * - Never log access_token or passwords
 * - All errors become user-friendly messages
 * - Uses fetch() directly from renderer (Synapse has CORS * by default)
 */

import { INTERNAL_MATRIX_HOMESERVER } from '../accountCenterConfig'

const HOMESERVER = INTERNAL_MATRIX_HOMESERVER

function hostLabel(): string {
  try { return new URL(HOMESERVER).host } catch { return HOMESERVER }
}

/* ---- Fetch helper ---- */

interface MxFetchOptions extends RequestInit {
  accessToken?: string
}

async function mxFetch<T>(
  path: string,
  options: MxFetchOptions = {},
  timeoutMs = 12000,
): Promise<T> {
  const { accessToken, headers: extraHeaders, ...rest } = options
  const url = `${HOMESERVER}${path}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...((extraHeaders as Record<string, string>) ?? {}),
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, { ...rest, headers, signal: controller.signal })

    if (!res.ok) {
      let body: { errcode?: string; error?: string } = {}
      try { body = await res.json() } catch { /* ignore */ }

      if (res.status === 401) {
        throw Object.assign(
          new Error('即时通讯登录已失效，请重新登录'),
          { code: 'M_UNKNOWN_TOKEN' },
        )
      }
      if (res.status === 403) throw new Error(body.error ?? '操作被拒绝（403）')
      if (res.status === 429) throw new Error('请求频率过高，请稍候再试')
      throw new Error(body.error ?? `Matrix API 错误 (${res.status})`)
    }

    return res.json() as Promise<T>
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw Object.assign(
        new Error(`无法连接内部通讯服务器：${hostLabel()}`),
        { code: 'TIMEOUT' },
      )
    }
    const msg = (err as Error).message ?? ''
    // Re-throw known structured errors
    if (msg.includes('登录已失效') || msg.includes('已被禁用') || msg.includes('Matrix')) throw err
    // Network-level errors
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('fetch')) {
      throw new Error(`无法连接内部通讯服务器：${hostLabel()}`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/* ---- Public API ---- */

export interface MxLoginResult {
  user_id: string
  access_token: string
  home_server: string
  device_id?: string
}

/** Login with m.login.password */
export async function matrixLogin(username: string, password: string): Promise<MxLoginResult> {
  try {
    return await mxFetch<MxLoginResult>('/_matrix/client/r0/login', {
      method: 'POST',
      body: JSON.stringify({
        type: 'm.login.password',
        identifier: { type: 'm.id.user', user: username },
        password,
      }),
    })
  } catch (err) {
    const msg = (err as Error).message ?? ''
    if (msg.includes('403') || msg.includes('Invalid') || msg.includes('Forbidden')) {
      throw new Error('即时通讯账号或密码错误')
    }
    throw err
  }
}

export interface MxWhoami {
  user_id: string
  device_id?: string
}

export async function matrixWhoami(accessToken: string): Promise<MxWhoami> {
  return mxFetch<MxWhoami>('/_matrix/client/v3/account/whoami', { accessToken })
}

/* ---- Sync types ---- */

export interface MxRoomEvent {
  event_id: string
  type: string
  sender: string
  content: Record<string, unknown>
  origin_server_ts: number
  state_key?: string
}

export interface MxJoinedRoomData {
  state: { events: MxRoomEvent[] }
  timeline: { events: MxRoomEvent[]; limited?: boolean; prev_batch?: string }
  account_data?: { events: MxRoomEvent[] }
}

/**
 * "Stripped" state events in an invite room.
 * Unlike full events, these don't have event_id or origin_server_ts.
 */
export interface MxInviteStrippedEvent {
  type: string
  sender: string
  content: Record<string, unknown>
  state_key?: string
}

export interface MxInviteRoomData {
  invite_state: { events: MxInviteStrippedEvent[] }
}

export interface MxSyncResponse {
  next_batch: string
  rooms?: {
    join?: Record<string, MxJoinedRoomData>
    leave?: Record<string, unknown>
    invite?: Record<string, MxInviteRoomData>
  }
  account_data?: {
    events?: Array<{ type: string; content: Record<string, unknown> }>
  }
}

/**
 * Sync with the homeserver.
 * @param since   pass `undefined` for the first sync (immediate); pass next_batch for polling
 * @param timeout server-side wait ms (0 = immediate, 5000 = long-poll 5s)
 */
export async function matrixSync(
  accessToken: string,
  since?: string,
  timeout = 0,
): Promise<MxSyncResponse> {
  const params = new URLSearchParams()
  if (since) params.set('since', since)
  params.set('timeout', String(timeout))
  // Limit timeline for initial sync to avoid huge payloads
  if (!since) {
    params.set('filter', JSON.stringify({ room: { timeline: { limit: 30 } } }))
  }

  const qs = `?${params.toString()}`
  // For long-poll (timeout=5000), allow up to 30s fetch timeout
  const fetchTimeout = timeout > 0 ? timeout + 10000 : 15000

  return mxFetch<MxSyncResponse>(
    `/_matrix/client/v3/sync${qs}`,
    { accessToken },
    fetchTimeout,
  )
}

export interface MxMessagesResponse {
  start: string
  end?: string
  chunk: MxRoomEvent[]
}

export async function matrixGetMessages(
  accessToken: string,
  roomId: string,
  limit = 30,
): Promise<MxMessagesResponse> {
  const params = new URLSearchParams({ dir: 'b', limit: String(limit) })
  return mxFetch<MxMessagesResponse>(
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages?${params}`,
    { accessToken },
  )
}

/** Send a text message. Returns the new event_id. */
export async function matrixSendText(
  accessToken: string,
  roomId: string,
  body: string,
  txnId: string,
): Promise<{ event_id: string }> {
  return mxFetch<{ event_id: string }>(
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(txnId)}`,
    {
      method: 'PUT',
      accessToken,
      body: JSON.stringify({ msgtype: 'm.text', body }),
    },
  )
}

/**
 * Send any m.room.message event (used for m.image / m.file media).
 */
export async function matrixSendMedia(
  accessToken: string,
  roomId: string,
  txnId: string,
  content: Record<string, unknown>,
): Promise<{ event_id: string }> {
  return mxFetch<{ event_id: string }>(
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(txnId)}`,
    {
      method: 'PUT',
      accessToken,
      body: JSON.stringify(content),
    },
  )
}

/**
 * Upload a file to the Matrix media repository.
 * Returns the mxc:// content_uri.
 */
export async function matrixUploadMedia(
  accessToken: string,
  file: File,
): Promise<{ contentUri: string }> {
  const uploadUrl = `${HOMESERVER}/_matrix/media/v3/upload?filename=${encodeURIComponent(file.name)}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 120_000) // 2-min timeout for large files
  try {
    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': file.type || 'application/octet-stream',
      },
      body: file,
      signal: controller.signal,
    })
    if (!res.ok) {
      let body: { errcode?: string; error?: string } = {}
      try { body = await res.json() } catch { /* ignore */ }
      throw new Error(body.error ?? `媒体上传失败 (${res.status})`)
    }
    const data = await res.json() as { content_uri: string }
    return { contentUri: data.content_uri }
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new Error('媒体上传超时')
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Parse a mxc:// URI into its component parts.
 * mxc://aioffice.cuhksz/abcdef → { serverName: "aioffice.cuhksz", mediaId: "abcdef" }
 */
export function parseMxcUrl(mxcUrl: string): { serverName: string; mediaId: string } {
  if (!mxcUrl?.startsWith('mxc://')) {
    throw new Error(`无效的 mxc 地址: ${mxcUrl}`)
  }
  const withoutScheme = mxcUrl.slice(6) // remove "mxc://"
  const slashIdx = withoutScheme.indexOf('/')
  if (slashIdx < 1) throw new Error(`mxc 地址格式错误 (缺少 mediaId): ${mxcUrl}`)
  return {
    serverName: withoutScheme.slice(0, slashIdx),
    mediaId: withoutScheme.slice(slashIdx + 1),
  }
}

/**
 * Build an authenticated media download URL.
 * Prefers the Matrix 1.11 client-authenticated endpoint:
 *   /_matrix/client/v1/media/download/{serverName}/{mediaId}
 * This endpoint requires Bearer token.
 */
export function getAuthenticatedMediaUrl(mxcUrl: string): string {
  const { serverName, mediaId } = parseMxcUrl(mxcUrl)
  return `${HOMESERVER}/_matrix/client/v1/media/download/${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}`
}

/**
 * Legacy unauthenticated URL (kept for fallback / uploads check).
 * Newer Synapse instances may reject these without auth.
 */
export function getMediaDownloadUrl(mxcUrl: string): string {
  const { serverName, mediaId } = parseMxcUrl(mxcUrl)
  return `${HOMESERVER}/_matrix/media/v3/download/${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}`
}

/**
 * Fetch a Matrix media file as a Blob, using authenticated endpoint.
 * Falls back to legacy /_matrix/media/v3/download if the v1 endpoint returns 404.
 * Never logs the accessToken.
 */
export async function fetchMatrixMediaBlob(
  accessToken: string,
  mxcUrl: string,
): Promise<Blob> {
  const { serverName, mediaId } = parseMxcUrl(mxcUrl)

  const tryFetch = async (url: string): Promise<Response> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30_000)
    try {
      return await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  }

  // Try authenticated client/v1 endpoint first
  const v1Url = `${HOMESERVER}/_matrix/client/v1/media/download/${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}`
  let res = await tryFetch(v1Url)

  // If v1 endpoint doesn't exist (404/405), fall back to legacy media endpoint
  if (res.status === 404 || res.status === 405) {
    const legacyUrl = `${HOMESERVER}/_matrix/media/v3/download/${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}`
    res = await tryFetch(legacyUrl)
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error('媒体访问被拒绝，请重新登录内部通讯账号')
  }
  if (res.status === 404) {
    throw new Error('媒体不存在或链接已失效')
  }
  if (!res.ok) {
    throw new Error(`媒体下载失败 (${res.status})`)
  }

  const blob = await res.blob()
  console.debug('[Matrix media] download ok:', { serverName, mediaId, size: blob.size, type: blob.type })
  return blob
}

/** Create a direct (1:1) room with targetUserId and return the room_id. */
export async function matrixCreateDirectRoom(
  accessToken: string,
  targetUserId: string,
): Promise<{ room_id: string }> {
  try {
    return await mxFetch<{ room_id: string }>('/_matrix/client/v3/createRoom', {
      method: 'POST',
      accessToken,
      body: JSON.stringify({
        visibility: 'private',
        is_direct: true,
        invite: [targetUserId],
        preset: 'trusted_private_chat',
      }),
    })
  } catch (err) {
    const msg = (err as Error).message ?? ''
    if (msg.includes('403') || msg.includes('not found') || msg.includes('unknown')) {
      throw new Error(`无法创建私聊，请检查对方 Matrix ID：${targetUserId}`)
    }
    throw err
  }
}

/** Join a room by roomId (used for auto-accepting invites). */
export async function matrixJoinRoom(
  accessToken: string,
  roomId: string,
): Promise<{ room_id: string }> {
  try {
    return await mxFetch<{ room_id: string }>(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/join`,
      { method: 'POST', accessToken, body: JSON.stringify({}) },
    )
  } catch (err) {
    const msg = (err as Error).message ?? ''
    throw new Error(`加入房间失败：${msg}`)
  }
}
