/**
 * MatrixChatContext – Phase 6-A MVP
 *
 * Manages Matrix login, session restore, sync polling, rooms, messages.
 *
 * Rules:
 * - Never log access_token or passwords
 * - Session stored in main process (userData/matrix-session.json)
 * - Sync polls every ~5 seconds (server long-poll timeout)
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  matrixLogin,
  matrixWhoami,
  matrixSync,
  matrixSendText,
  matrixSendMedia,
  matrixUploadMedia,
  matrixCreateDirectRoom,
  matrixJoinRoom,
} from '../services/matrixClient'
import type {
  MatrixSession,
  MatrixRoom,
  MatrixMsgEvent,
  MatrixRoomMember,
  MatrixChatPhase,
} from '../types/matrix'
import type { MxSyncResponse } from '../services/matrixClient'
import { useInternalAccount } from './InternalAccountContext'

/* ---- Types ---- */

interface MatrixChatState {
  phase: MatrixChatPhase
  error: string | null
  session: MatrixSession | null
  rooms: MatrixRoom[]
  currentRoomId: string | null
  messagesByRoom: Record<string, MatrixMsgEvent[]>
  syncing: boolean
  syncError: string | null
}

interface MatrixChatActions {
  login: (password: string) => Promise<void>
  logout: () => Promise<void>
  selectRoom: (roomId: string | null) => void
  sendMessage: (text: string) => Promise<void>
  /** Send a message to an explicit room (for CommunicationWorkbench integration) */
  sendMessageToRoom: (roomId: string, text: string) => Promise<void>
  /** Upload an image file and send as m.image */
  sendImageMessage: (roomId: string, file: File) => Promise<void>
  /** Upload any file and send as m.file */
  sendFileMessage: (roomId: string, file: File) => Promise<void>
  /** Returns the new room_id */
  createDirectRoom: (targetUserId: string) => Promise<string>
  retrySync: () => void
}

type MatrixChatContextValue = MatrixChatState & MatrixChatActions

/* ---- Context ---- */

const MatrixChatContext = createContext<MatrixChatContextValue | null>(null)

export function useMatrixChat(): MatrixChatContextValue {
  const ctx = useContext(MatrixChatContext)
  if (!ctx) throw new Error('useMatrixChat must be used inside MatrixChatProvider')
  return ctx
}

/* ---- Sync processing ---- */

function buildDirectMap(syncData: MxSyncResponse): Map<string, string> {
  // Maps roomId → other user's ID
  const directMap = new Map<string, string>()
  for (const evt of syncData.account_data?.events ?? []) {
    if (evt.type === 'm.direct') {
      for (const [otherUser, roomIds] of Object.entries(evt.content)) {
        for (const rid of roomIds as string[]) {
          directMap.set(rid, otherUser)
        }
      }
    }
  }
  return directMap
}

function displayNameForDmUser(userId: string): string {
  // Turn "@testuser2:aioffice.cuhksz" → "testuser2"
  const match = /^@([^:]+):/.exec(userId)
  return match ? match[1] : userId
}

interface PendingInvite {
  roomId: string
  inviterUserId: string
}

function processSync(
  syncData: MxSyncResponse,
  prevRooms: MatrixRoom[],
  prevMessages: Record<string, MatrixMsgEvent[]>,
  myUserId: string,
): { rooms: MatrixRoom[]; messagesByRoom: Record<string, MatrixMsgEvent[]>; pendingInvites: PendingInvite[] } {
  const directMap = buildDirectMap(syncData)

  // Start from prev state
  const roomMap = new Map<string, MatrixRoom>(prevRooms.map(r => [r.roomId, r]))
  const msgMap: Record<string, MatrixMsgEvent[]> = { ...prevMessages }

  for (const [roomId, roomData] of Object.entries(syncData.rooms?.join ?? {})) {
    const prev = roomMap.get(roomId)
    const allEvents = [...roomData.state.events, ...roomData.timeline.events]

    // --- Room name
    let name = prev?.name ?? ''
    for (const evt of allEvents) {
      if (evt.type === 'm.room.name' && typeof evt.content.name === 'string') {
        name = evt.content.name
      }
    }

    // --- Members: merge prev members with new state events
    const memberMap = new Map<string, MatrixRoomMember>(
      (prev?.members ?? []).map(m => [m.userId, m])
    )
    for (const evt of allEvents) {
      if (evt.type === 'm.room.member' && typeof evt.state_key === 'string') {
        const membership = evt.content.membership as string
        const displayName = evt.content.displayname as string | undefined
        if (membership === 'join' || membership === 'invite' || membership === 'leave' || membership === 'ban') {
          memberMap.set(evt.state_key, {
            userId: evt.state_key,
            displayName: displayName || undefined,
            membership: membership as MatrixRoomMember['membership'],
          })
        }
      }
    }
    const members = Array.from(memberMap.values())

    // --- Direct room: carry forward prev value unless explicitly in directMap
    const isDirect = directMap.has(roomId) || (prev?.isDirect ?? false)
    const directUserId = directMap.get(roomId) ?? prev?.directUserId

    // Fallback name for DMs: use the other user's local part
    if (!name && isDirect && directUserId) {
      name = displayNameForDmUser(directUserId)
    }
    // If still no name, try to derive from members
    if (!name && members.length > 0) {
      const peer = members.find(m => m.userId !== myUserId && (m.membership === 'join' || m.membership === 'invite'))
      if (peer) {
        name = peer.displayName ?? displayNameForDmUser(peer.userId)
      }
    }
    // NOTE: leave name='' rather than slicing roomId; resolvePeer in CommunicationContext handles the rest

    // --- Messages
    const existing = msgMap[roomId] ?? []
    const existingIds = new Set(existing.map(m => m.eventId))

    const newMsgs: MatrixMsgEvent[] = []
    for (const evt of roomData.timeline.events) {
      if (evt.type !== 'm.room.message') continue
      if (existingIds.has(evt.event_id)) continue
      const msgtype = String(evt.content.msgtype ?? 'm.text')
      // Skip unsupported types that aren't text/image/file
      if (msgtype !== 'm.text' && msgtype !== 'm.image' && msgtype !== 'm.file') continue
      const info = evt.content.info as { mimetype?: string; size?: number; w?: number; h?: number } | undefined
      newMsgs.push({
        eventId: evt.event_id,
        sender: evt.sender,
        body: String(evt.content.body ?? ''),
        msgtype,
        timestamp: evt.origin_server_ts,
        url: typeof evt.content.url === 'string' ? evt.content.url : undefined,
        mimetype: info?.mimetype,
        size: info?.size,
        width: info?.w,
        height: info?.h,
      })
    }

    const merged = [...existing, ...newMsgs].sort((a, b) => a.timestamp - b.timestamp)
    // Keep last 200 messages per room
    msgMap[roomId] = merged.slice(-200)

    const lastMsg = msgMap[roomId][msgMap[roomId].length - 1]

    roomMap.set(roomId, {
      roomId,
      name,
      isDirect,
      directUserId,
      members,
      lastTs: lastMsg?.timestamp ?? prev?.lastTs ?? Date.now(),
      lastMessage: lastMsg,
    })
  }

  // --- Parse pending invites from rooms.invite
  const pendingInvites: PendingInvite[] = []
  for (const [roomId, inviteData] of Object.entries(syncData.rooms?.invite ?? {})) {
    const inviteEvents = inviteData.invite_state?.events ?? []
    // Find the m.room.member event addressed to us with membership=invite
    const myInviteEvt = inviteEvents.find(
      e => e.type === 'm.room.member'
        && e.state_key === myUserId
        && e.content.membership === 'invite'
    )
    if (myInviteEvt) {
      console.debug('[Matrix] Invite detected:', { roomId, inviterUserId: myInviteEvt.sender })
      pendingInvites.push({ roomId, inviterUserId: myInviteEvt.sender })
    }
  }

  const rooms = Array.from(roomMap.values()).sort((a, b) => b.lastTs - a.lastTs)
  return { rooms, messagesByRoom: msgMap, pendingInvites }
}

/* ---- Provider ---- */

export function MatrixChatProvider({ children }: { children: React.ReactNode }) {
  const { state: accountState, getSessionPassword } = useInternalAccount()

  const [phase, setPhase] = useState<MatrixChatPhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [session, setSession] = useState<MatrixSession | null>(null)
  const [rooms, setRooms] = useState<MatrixRoom[]>([])
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null)
  const [messagesByRoom, setMessagesByRoom] = useState<Record<string, MatrixMsgEvent[]>>({})
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncRetryTick, setSyncRetryTick] = useState(0)

  const syncTokenRef = useRef<string | undefined>(undefined)
  const sessionRef = useRef<MatrixSession | null>(null)
  const roomsRef = useRef<MatrixRoom[]>([])
  const messagesRef = useRef<Record<string, MatrixMsgEvent[]>>({})
  // Track which AccountCenter username the current Matrix session belongs to
  const matrixOwnerRef = useRef<string | null>(null)

  // Keep refs in sync with state
  useEffect(() => { sessionRef.current = session }, [session])
  useEffect(() => { roomsRef.current = rooms }, [rooms])
  useEffect(() => { messagesRef.current = messagesByRoom }, [messagesByRoom])

  /** Fully reset all Matrix state (call before switching users) */
  function clearMatrixState() {
    setSession(null)
    setRooms([])
    setMessagesByRoom({})
    setCurrentRoomId(null)
    setError(null)
    setSyncError(null)
    syncTokenRef.current = undefined
    sessionRef.current = null
    roomsRef.current = []
    messagesRef.current = {}
    matrixOwnerRef.current = null
  }

  /* ---- Session restore: runs whenever AccountCenter phase → 'logged_in' ---- */
  useEffect(() => {
    if (accountState.phase !== 'logged_in') return

    let cancelled = false

    const tryRestore = async () => {
      const acc = accountState
      if (acc.phase !== 'logged_in') { setPhase('needs_login'); return }
      const username = acc.session.user.username
      // The Matrix user ID we EXPECT for this AccountCenter user
      const expectedUserId = `@${username}:aioffice.cuhksz`

      // If already logged in as the correct user — nothing to do
      if (phase === 'logged_in' && sessionRef.current?.userId === expectedUserId) return

      // Switching to a different user (or re-initialising after idle) — wipe stale state
      if (sessionRef.current && sessionRef.current.userId !== expectedUserId) {
        console.debug('[Matrix] Clearing stale session (owner mismatch):', sessionRef.current.userId, '→', expectedUserId)
        clearMatrixState()
        await window.electronAPI.matrixClearSession().catch(() => {/* ignore */})
      }

      setPhase('restoring')

      try {
        const { session: stored } = await window.electronAPI.matrixGetSession()
        if (cancelled) return

        if (stored?.accessToken) {
          // Owner check: stored session must belong to the current user
          if (stored.userId !== expectedUserId) {
            console.debug('[Matrix] Stored session userId mismatch — clearing:', stored.userId, '≠', expectedUserId)
            await window.electronAPI.matrixClearSession().catch(() => {/* ignore */})
          } else {
            try {
              const whoami = await matrixWhoami(stored.accessToken)
              // Double-check whoami confirms the same user
              if (whoami.user_id !== expectedUserId) {
                throw new Error(`whoami user_id mismatch: ${whoami.user_id} ≠ ${expectedUserId}`)
              }
              if (!cancelled) {
                matrixOwnerRef.current = username
                setSession(stored)
                setPhase('logged_in')
                syncTokenRef.current = undefined
              }
              return
            } catch {
              // Token invalid or userId mismatch — clear and fall through to auto-login
              await window.electronAPI.matrixClearSession().catch(() => {/* ignore */})
            }
          }
        }

        if (cancelled) return

        // No valid stored session — try auto-login with in-memory password
        const pw = getSessionPassword()
        if (pw) {
          try {
            const result = await matrixLogin(username, pw)
            const newSess: MatrixSession = {
              userId: result.user_id,
              accessToken: result.access_token,
              homeserver: result.home_server,
              deviceId: result.device_id,
            }
            // Validate the login returned the expected user
            if (newSess.userId !== expectedUserId) {
              console.warn('[Matrix] Login returned unexpected userId:', newSess.userId, '≠', expectedUserId)
              if (!cancelled) setPhase('needs_login')
              return
            }
            await window.electronAPI.matrixSetSession(newSess)
            if (!cancelled) {
              matrixOwnerRef.current = username
              setSession(newSess)
              setPhase('logged_in')
              syncTokenRef.current = undefined
            }
          } catch {
            if (!cancelled) setPhase('needs_login')
          }
        } else {
          // Password not in memory (e.g. app restarted) — user must login manually
          if (!cancelled) setPhase('needs_login')
        }
      } catch {
        if (!cancelled) setPhase('needs_login')
      }
    }

    void tryRestore()
    return () => { cancelled = true }
  }, [accountState.phase]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- Sync loop ---- */
  useEffect(() => {
    if (phase !== 'logged_in' || !session) return

    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout>

    const poll = async () => {
      if (cancelled) return

      setSyncing(true)
      setSyncError(null)

      try {
        const since = syncTokenRef.current
        // Long-poll: 5000ms server timeout after first sync
        const serverTimeout = since ? 5000 : 0
        const result = await matrixSync(session.accessToken, since, serverTimeout)

        if (cancelled) return

        syncTokenRef.current = result.next_batch

        const { rooms: updatedRooms, messagesByRoom: updatedMsgs, pendingInvites } =
          processSync(result, roomsRef.current, messagesRef.current, session.userId)
        roomsRef.current = updatedRooms
        messagesRef.current = updatedMsgs
        setRooms(updatedRooms)
        setMessagesByRoom(updatedMsgs)

        // Debug logging (dev only)
        if (process.env.NODE_ENV !== 'production') {
          const joinedIds = Object.keys(result.rooms?.join ?? {})
          const inviteIds = Object.keys(result.rooms?.invite ?? {})
          if (joinedIds.length > 0 || inviteIds.length > 0 || pendingInvites.length > 0) {
            console.debug('[Matrix] Sync:', {
              myUserId: session.userId,
              joinedRooms: joinedIds.length,
              inviteRooms: inviteIds.length,
              pendingInvites: pendingInvites.map(i => ({
                roomId: i.roomId,
                inviterUserId: i.inviterUserId,
              })),
              msgCounts: Object.fromEntries(
                Object.entries(updatedMsgs)
                  .filter(([, msgs]) => msgs.length > 0)
                  .map(([rid, msgs]) => [rid.slice(1, 12), msgs.length])
              ),
            })
          }
        }

        // Auto-join pending invites
        if (!cancelled && pendingInvites.length > 0) {
          for (const { roomId, inviterUserId } of pendingInvites) {
            if (cancelled) break
            // Skip if already in roomMap as joined
            if (roomsRef.current.some(r => r.roomId === roomId)) continue
            try {
              await matrixJoinRoom(session.accessToken, roomId)
              console.debug('[Matrix] Auto-joined:', roomId, 'invited by', inviterUserId)
              // Optimistic room so it shows immediately
              const optimistic: MatrixRoom = {
                roomId,
                name: displayNameForDmUser(inviterUserId),
                isDirect: true,
                directUserId: inviterUserId,
                members: [
                  { userId: session.userId, membership: 'join' },
                  { userId: inviterUserId, membership: 'join' },
                ],
                lastTs: Date.now(),
                lastMessage: undefined,
              }
              roomsRef.current = [optimistic, ...roomsRef.current.filter(r => r.roomId !== roomId)]
              if (!cancelled) setRooms([...roomsRef.current])
            } catch (err) {
              console.warn('[Matrix] Auto-join failed for', roomId, ':', (err as Error).message)
            }
          }
        }

        if (!cancelled) timeoutId = setTimeout(poll, 500)
      } catch (err) {
        if (cancelled) return
        const msg = (err as Error).message ?? '消息同步失败'
        const code = (err as { code?: string }).code

        // Token expired → force re-login
        if (code === 'M_UNKNOWN_TOKEN') {
          await window.electronAPI.matrixClearSession()
          setSession(null)
          setPhase('needs_login')
          setError('即时通讯登录已失效，请重新登录')
          return
        }

        setSyncError(msg)
        if (!cancelled) timeoutId = setTimeout(poll, 5000)
      } finally {
        if (!cancelled) setSyncing(false)
      }
    }

    void poll()

    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [phase, session, syncRetryTick]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- Reset when InternalAccount logs out or switches user ---- */
  useEffect(() => {
    if (accountState.phase === 'idle' || accountState.phase === 'error') {
      setPhase('idle')
      clearMatrixState()
    }
  }, [accountState.phase]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- Actions ---- */

  const login = useCallback(async (password: string) => {
    if (accountState.phase !== 'logged_in') throw new Error('请先登录内部账号')
    const username = accountState.session.user.username

    setPhase('logging_in')
    setError(null)

    try {
      const result = await matrixLogin(username, password)
      const newSession: MatrixSession = {
        userId: result.user_id,
        accessToken: result.access_token,
        homeserver: result.home_server,
        deviceId: result.device_id,
      }

      await window.electronAPI.matrixSetSession(newSession)
      syncTokenRef.current = undefined
      setSession(newSession)
      setPhase('logged_in')
    } catch (err) {
      setPhase('needs_login')
      setError((err as Error).message ?? '登录失败')
      throw err
    }
  }, [accountState])

  const logout = useCallback(async () => {
    await window.electronAPI.matrixClearSession()
    clearMatrixState()
    setPhase('needs_login')
    setSyncError(null)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const selectRoom = useCallback((roomId: string | null) => {
    setCurrentRoomId(roomId)
  }, [])

  const sendMessage = useCallback(async (text: string) => {
    if (!sessionRef.current || !currentRoomId) return
    const txnId = `ai-office-${Date.now()}-${Math.random().toString(36).slice(2)}`
    await matrixSendText(sessionRef.current.accessToken, currentRoomId, text, txnId)
  }, [currentRoomId])

  const sendMessageToRoom = useCallback(async (roomId: string, text: string): Promise<void> => {
    if (!sessionRef.current) throw new Error('Matrix 未登录')
    const txnId = `ai-office-${Date.now()}-${Math.random().toString(36).slice(2)}`
    console.debug('[Matrix] Sending message:', { from: sessionRef.current.userId, roomId })
    const result = await matrixSendText(sessionRef.current.accessToken, roomId, text, txnId)
    console.debug('[Matrix] Message sent:', { eventId: result.event_id, roomId })
  }, [])

  const createDirectRoom = useCallback(async (targetUserId: string): Promise<string> => {
    if (!sessionRef.current) throw new Error('未登录即时通讯')

    // Deduplicate: reuse an existing DM room with the same target
    const existing = roomsRef.current.find(
      r => r.isDirect && (
        r.directUserId === targetUserId ||
        r.members?.some(m => m.userId === targetUserId)
      )
    )
    if (existing) {
      console.debug('[Matrix] Reusing existing DM room:', existing.roomId, 'with', targetUserId)
      setCurrentRoomId(existing.roomId)
      return existing.roomId
    }

    console.debug('[Matrix] Creating DM room with:', targetUserId)
    const { room_id } = await matrixCreateDirectRoom(sessionRef.current.accessToken, targetUserId)
    console.debug('[Matrix] DM room created:', room_id)

    // Optimistic room add so the thread appears immediately before next sync
    const localPart = targetUserId.match(/^@([^:]+):/)?.[1] ?? targetUserId
    const myUserId = sessionRef.current.userId
    const optimisticRoom: MatrixRoom = {
      roomId: room_id,
      name: localPart,
      isDirect: true,
      directUserId: targetUserId,
      members: [
        { userId: myUserId, membership: 'join' },
        { userId: targetUserId, membership: 'invite' },
      ],
      lastTs: Date.now(),
      lastMessage: undefined,
    }
    roomsRef.current = [optimisticRoom, ...roomsRef.current.filter(r => r.roomId !== room_id)]
    setRooms([...roomsRef.current])
    setCurrentRoomId(room_id)
    return room_id
  }, [])

  const sendImageMessage = useCallback(async (roomId: string, file: File): Promise<void> => {
    if (!sessionRef.current) throw new Error('Matrix 未登录')
    // Read image dimensions
    let w: number | undefined
    let h: number | undefined
    try {
      const objectUrl = URL.createObjectURL(file)
      const img = new window.Image()
      await new Promise<void>((resolve) => {
        img.onload = () => resolve()
        img.onerror = () => resolve()
        img.src = objectUrl
      })
      if (img.naturalWidth) w = img.naturalWidth
      if (img.naturalHeight) h = img.naturalHeight
      URL.revokeObjectURL(objectUrl)
    } catch { /* ignore dimension errors */ }

    const { contentUri } = await matrixUploadMedia(sessionRef.current.accessToken, file)
    const txnId = `ai-office-${Date.now()}-${Math.random().toString(36).slice(2)}`
    await matrixSendMedia(sessionRef.current.accessToken, roomId, txnId, {
      msgtype: 'm.image',
      body: file.name,
      url: contentUri,
      info: {
        mimetype: file.type || 'image/jpeg',
        size: file.size,
        ...(w && h ? { w, h } : {}),
      },
    })
    console.debug('[Matrix] Image sent:', { roomId, filename: file.name })
  }, [])

  const sendFileMessage = useCallback(async (roomId: string, file: File): Promise<void> => {
    if (!sessionRef.current) throw new Error('Matrix 未登录')
    const { contentUri } = await matrixUploadMedia(sessionRef.current.accessToken, file)
    const txnId = `ai-office-${Date.now()}-${Math.random().toString(36).slice(2)}`
    await matrixSendMedia(sessionRef.current.accessToken, roomId, txnId, {
      msgtype: 'm.file',
      body: file.name,
      url: contentUri,
      info: {
        mimetype: file.type || 'application/octet-stream',
        size: file.size,
      },
    })
    console.debug('[Matrix] File sent:', { roomId, filename: file.name })
  }, [])

  const retrySync = useCallback(() => {
    setSyncError(null)
    setSyncRetryTick(t => t + 1)
  }, [])

  const value: MatrixChatContextValue = {
    phase,
    error,
    session,
    rooms,
    currentRoomId,
    messagesByRoom,
    syncing,
    syncError,
    login,
    logout,
    selectRoom,
    sendMessage,
    sendMessageToRoom,
    sendImageMessage,
    sendFileMessage,
    createDirectRoom,
    retrySync,
  }

  return (
    <MatrixChatContext.Provider value={value}>
      {children}
    </MatrixChatContext.Provider>
  )
}
