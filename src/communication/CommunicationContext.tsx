/**
 * CommunicationContext — unified context for the AI Communication Workbench.
 *
 * Must be rendered inside <EmailProvider> because it delegates email operations
 * to useEmail().
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { CommunicationThread, CommunicationMessage, CommunicationReplyDraft, CommFilter, CommTone } from './types'
import type { EmailReplyGenerationOptions } from '../types/email'
import { adaptMailsToThreads, toEmailThreadId, fromEmailThreadId } from './providers/ImapEmailProvider'
import { generateCommReply } from './services/AIReplyService'
import { useEmail } from '../modules/email/contexts/EmailContext'
import { useMatrixChat } from '../contexts/MatrixChatContext'
import { useInternalAccount } from '../contexts/InternalAccountContext'
import type { MatrixRoom, MatrixMsgEvent, MatrixChatPhase } from '../types/matrix'

const now = () => new Date().toISOString()

/* ------------------------------------------------------------------ */
/*  Context shape                                                      */
/* ------------------------------------------------------------------ */

interface CommunicationContextValue {
  /* Thread list */
  threads: CommunicationThread[]
  filteredThreads: CommunicationThread[]
  selectedThreadId: string | null
  selectedThread: CommunicationThread | null
  activeFilter: CommFilter
  setActiveFilter: (f: CommFilter) => void
  selectThread: (id: string | null) => void

  /* Reply draft (unified) */
  currentDraft: CommunicationReplyDraft | null
  streamingPreview: string
  generateDraft: (options?: EmailReplyGenerationOptions) => void
  regenerateDraft: (force?: boolean, options?: EmailReplyGenerationOptions) => void
  updateDraftContent: (content: string) => void
  saveDraft: () => void
  addDraftAttachment: (att: { filename: string; path: string; size: number; contentType: string }) => void
  removeDraftAttachment: (filePath: string) => void
  sendReply: () => void

  /* Email-specific pass-throughs */
  isRealEmailMode: boolean
  isFetchingMails: boolean
  fetchError: string | null
  refreshMails: () => void
  emailAccountConfig: ReturnType<typeof useEmail>['accountConfig']
  saveEmailAccount: ReturnType<typeof useEmail>['saveAccount']
  clearEmailAccount: ReturnType<typeof useEmail>['clearAccount']
  /* Email compose / delete */
  sendBlank: (payload: import('../modules/email/contexts/EmailContext').ComposePayload) => Promise<void>
  deleteMail: (id: string, folder: 'inbox' | 'sent' | 'trash') => Promise<void>
  restoreMail: (id: string) => Promise<void>
  refreshSent: () => void
  refreshTrash: () => void
  /* Matrix-specific */
  matrixPhase: MatrixChatPhase
  createMatrixDirect: (targetUserId: string) => Promise<void>
}

const CommunicationContext = createContext<CommunicationContextValue | null>(null)

export function useCommunication(): CommunicationContextValue {
  const ctx = useContext(CommunicationContext)
  if (!ctx) throw new Error('useCommunication must be used inside CommunicationProvider')
  return ctx
}

function localPartOfUserId(userId: string): string {
  return userId.match(/^@([^:]+):/)?.[1] ?? userId
}

/**
 * Derive the peer user ID and display name from a room.
 * Priority:
 * 1. directUserId (from m.direct or optimistic)
 * 2. members who are not myUserId
 * 3. null (group room or no info available)
 */
function resolvePeer(
  room: MatrixRoom,
  myUserId: string | undefined,
): { peerUserId: string | null; peerDisplayName: string | null } {
  // 1. directUserId is the most reliable for DM rooms
  if (room.directUserId) {
    return {
      peerUserId: room.directUserId,
      peerDisplayName: null, // displayName resolved from members below
    }
  }

  // 2. Parse from member list
  if (room.members && myUserId) {
    const peer = room.members.find(
      m => m.userId !== myUserId && (m.membership === 'join' || m.membership === 'invite')
    )
    if (peer) {
      return {
        peerUserId: peer.userId,
        peerDisplayName: peer.displayName ?? null,
      }
    }
  }

  return { peerUserId: null, peerDisplayName: null }
}

/** Convert live Matrix rooms + messages into CommunicationThread[] */
function matrixRoomsToThreads(
  rooms: MatrixRoom[],
  messagesByRoom: Record<string, MatrixMsgEvent[]>,
  myUserId: string | undefined,
): CommunicationThread[] {
  return rooms.map((room) => {
    const { peerUserId, peerDisplayName: peerDNFromMembers } = resolvePeer(room, myUserId)

    // Resolve display name for peer: member displayName > localPart of userId > unknown
    const peerDisplayName = peerDNFromMembers
      ?? (peerUserId ? localPartOfUserId(peerUserId) : null)

    // Room title: explicit name > peer display name > peer userId > "未知联系人"
    const subject = room.name || peerDisplayName || peerUserId || '未知联系人'

    // Also check members for directUserId's display name if not already found
    const resolvedPeerDisplayName = (() => {
      if (peerDNFromMembers) return peerDNFromMembers
      if (!peerUserId || !room.members) return peerDisplayName
      const memberEntry = room.members.find(m => m.userId === peerUserId)
      return memberEntry?.displayName ?? peerDisplayName
    })()

    const roomMsgs = messagesByRoom[room.roomId] ?? []
    const messages: CommunicationMessage[] = roomMsgs.map((m) => ({
      id: `matrix:${m.eventId}`,
      threadId: `matrix:${room.roomId}`,
      from: m.sender,
      fromName: localPartOfUserId(m.sender),
      body: m.body,
      timestamp: new Date(m.timestamp).toISOString(),
      isIncoming: myUserId ? m.sender !== myUserId : true,
      attachments: [],
      providerType: 'chat' as const,
      chatMsgtype: m.msgtype,
      mxcUrl: m.url,
      mimetype: m.mimetype,
      fileSize: m.size,
      imageWidth: m.width,
      imageHeight: m.height,
    }))
    const lastMsg = messages[messages.length - 1] ?? null

    // participants[0] = the peer (displayed in thread card and detail header)
    // Never leave it undefined — fallback to empty string if truly unknown
    const peerForParticipants = peerUserId ?? ''
    const peerNameForParticipants = resolvedPeerDisplayName ?? peerUserId ?? '未知联系人'

    return {
      id: `matrix:${room.roomId}`,
      providerType: 'chat' as const,
      subject,
      participants: [peerForParticipants],
      participantNames: [peerNameForParticipants],
      lastMessage: lastMsg,
      unread: false,
      hasAttachments: false,
      replied: false,
      messages,
    }
  })
}

/* ------------------------------------------------------------------ */
/*  Provider                                                          */
/* ------------------------------------------------------------------ */

/** Extract bare email address from "Display Name <addr@host>" or "addr@host" */
function extractEmailAddress(display: string): string {
  const m = display.match(/<([^>]+)>/)
  return (m ? m[1] : display).trim().toLowerCase()
}

export function CommunicationProvider({
  children,
  mode = 'all',
}: {
  children: ReactNode
  /** Scope this provider to a specific communication type.
   * - 'email'  — only email threads; default filter is 'email'
   * - 'chat'   — only chat threads; default filter is 'chat'
   * - 'all'    — unified view (email + chat); default filter is 'all'
   */
  mode?: 'email' | 'chat' | 'all'
}) {
  const emailCtx = useEmail()
  const matrixCtx = useMatrixChat()
  const { state: accountState } = useInternalAccount()

  const defaultFilter: CommFilter = mode === 'email' ? 'email' : mode === 'chat' ? 'chat' : 'all'

  // Chat-specific draft state; email draft lives inside EmailContext
  const [chatDrafts, setChatDrafts] = useState<Record<string, CommunicationReplyDraft>>({})
  const [chatStreamingPreview, setChatStreamingPreview] = useState('')

  const [activeFilter, setActiveFilter] = useState<CommFilter>(defaultFilter)
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const generatingForRef = useRef<string | null>(null)

  /** Current user's email address — used for sent-mail isolation */
  const currentUserEmail = accountState.phase === 'logged_in' ? (accountState.session.user.email ?? null) : null

  /* ---- User isolation: reset selection/filter when account logs out or switches ---- */
  useEffect(() => {
    if (accountState.phase === 'idle' || accountState.phase === 'error') {
      setSelectedThreadId(null)
      setActiveFilter(defaultFilter)
      setChatDrafts({})
    }
  }, [accountState.phase])

  /* ---- All threads: email first, then Matrix chat ---- */
  const emailThreads = useMemo(
    () => adaptMailsToThreads(emailCtx.mails, currentUserEmail ?? undefined),
    [emailCtx.mails, currentUserEmail],
  )

  const sentEmailThreads = useMemo(() => {
    const raw = adaptMailsToThreads(emailCtx.sentMails, currentUserEmail ?? undefined)
    // Defense: only show sent emails FROM the current user (guards against stale/wrong IMAP data)
    if (!currentUserEmail) return []
    return raw.filter((t) => {
      const fromRaw = t.lastMessage?.from ?? ''
      if (!fromRaw) return true // no from — let it through
      const fromEmail = extractEmailAddress(fromRaw)
      if (fromEmail && fromEmail !== currentUserEmail.toLowerCase()) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[CommunicationContext] sent item sender mismatch — skipping', {
            folder: t.folder,
            subject: t.subject,
            fromEmail,
            currentUserEmail,
          })
        }
        return false
      }
      return true
    })
  }, [emailCtx.sentMails, currentUserEmail])

  const trashEmailThreads = useMemo(
    () => adaptMailsToThreads(emailCtx.trashMails, currentUserEmail ?? undefined),
    [emailCtx.trashMails, currentUserEmail],
  )

  const matrixThreads = useMemo(
    () =>
      matrixCtx.phase === 'logged_in'
        ? matrixRoomsToThreads(matrixCtx.rooms, matrixCtx.messagesByRoom, matrixCtx.session?.userId)
        : [],
    [matrixCtx.phase, matrixCtx.rooms, matrixCtx.messagesByRoom, matrixCtx.session?.userId],
  )
  const threads = useMemo(
    () => [...emailThreads, ...matrixThreads],
    [emailThreads, matrixThreads],
  )
  // allThreads includes sent mails — used for selectedThread lookup across all filters
  const allThreads = useMemo(
    () => [...emailThreads, ...sentEmailThreads, ...trashEmailThreads, ...matrixThreads],
    [emailThreads, sentEmailThreads, trashEmailThreads, matrixThreads],
  )

  /* Lazy-fetch sent mails when filter switches to 'sent' */
  useEffect(() => {
    if (activeFilter === 'sent') emailCtx.fetchSentMails()
    if (activeFilter === 'trash') emailCtx.fetchTrashMails()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilter])

  /* ---- Filter ---- */
  const filteredThreads = useMemo(() => {
    switch (activeFilter) {
      case 'email':           return threads.filter((t) => t.providerType === 'email')
      case 'chat':            return threads.filter((t) => t.providerType === 'chat')
      case 'sent':            return sentEmailThreads
      case 'trash':           return trashEmailThreads
      case 'unread':          return threads.filter((t) => t.unread)
      case 'has-attachment':  return threads.filter((t) => t.hasAttachments)
      // 'all' respects the mode scope; for unified mode it shows everything
      default:                return mode === 'email'
                               ? threads.filter((t) => t.providerType === 'email')
                               : mode === 'chat'
                               ? threads.filter((t) => t.providerType === 'chat')
                               : threads
    }
  }, [threads, sentEmailThreads, trashEmailThreads, activeFilter])

  /* ---- User isolation: clear selection when filter changes and selected not in visible list ---- */
  useEffect(() => {
    if (!selectedThreadId) return
    const stillVisible = filteredThreads.some((t) => t.id === selectedThreadId)
    if (!stillVisible) {
      setSelectedThreadId(null)
      emailCtx.selectMail(null)
      matrixCtx.selectRoom(null)
    }
    // Intentionally only [activeFilter] — we want this to fire on filter switch,
    // not on every filteredThreads update (e.g. new mail arriving).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilter])

  /* ---- User isolation: clear selection when selected thread disappears from allThreads ---- */
  useEffect(() => {
    if (!selectedThreadId) return
    const exists = allThreads.some((t) => t.id === selectedThreadId)
    if (!exists) {
      setSelectedThreadId(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allThreads])

  const selectedThread = useMemo(
    () => (selectedThreadId ? allThreads.find((t) => t.id === selectedThreadId) ?? null : null),
    [allThreads, selectedThreadId],
  )

  /* ---- selectThread ---- */
  const selectThread = useCallback(
    (id: string | null) => {
      setSelectedThreadId(id)
      const thread = id ? allThreads.find((t) => t.id === id) : null
      if (thread?.providerType === 'email') {
        emailCtx.selectMail(fromEmailThreadId(id!))
      } else if (id?.startsWith('matrix:')) {
        matrixCtx.selectRoom(id.slice('matrix:'.length))
      } else if (!id) {
        emailCtx.selectMail(null)
        matrixCtx.selectRoom(null)
      }
    },
    [allThreads, emailCtx, matrixCtx],
  )

  // Sync: if EmailContext drives mail selection externally, reflect the prefixed ID here
  useEffect(() => {
    if (!emailCtx.selectedMailId) return
    const prefixed = toEmailThreadId(emailCtx.selectedMailId)
    if (prefixed !== selectedThreadId) {
      setSelectedThreadId(prefixed)
    }
    // We intentionally only react to emailCtx.selectedMailId to avoid loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailCtx.selectedMailId])

  /* ---- Unified draft (email = from emailCtx, chat = local) ---- */
  const currentDraft = useMemo((): CommunicationReplyDraft | null => {
    if (!selectedThreadId || !selectedThread) return null
    if (selectedThread.providerType === 'email') {
      const ed = emailCtx.currentDraft
      if (!ed) return null
      return {
        threadId: selectedThreadId,
        content: ed.content,
        status: ed.status,
        dirty: ed.dirty,
        userEdited: ed.userEdited,
        attachments: (ed.attachments ?? []).map((a) => ({
          filename: a.filename,
          path: a.path,
          size: a.size,
          contentType: a.contentType,
        })),
        generatedAt: ed.generatedAt,
        updatedAt: ed.updatedAt,
        errorMessage: ed.errorMessage,
      }
    }
    return chatDrafts[selectedThreadId] ?? null
  }, [selectedThreadId, selectedThread, emailCtx.currentDraft, chatDrafts])

  /* ---- Chat generation helper ---- */
  const startChatGeneration = useCallback(
    (thread: CommunicationThread, tone: CommTone = 'friendly', previousContent = '') => {
      const lastIncoming = [...thread.messages].reverse().find((m) => m.isIncoming)
      if (!lastIncoming) return

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      generatingForRef.current = thread.id
      const threadId = thread.id

      setChatDrafts((prev) => ({
        ...prev,
        [threadId]: {
          threadId,
          content: '',
          status: 'generating',
          dirty: false,
          userEdited: false,
          attachments: [],
        },
      }))
      setChatStreamingPreview('')

      generateCommReply(
        {
          providerType: 'chat',
          thread,
          targetMessage: lastIncoming,
          responderName: '王明',
          tone,
        },
        {
          onDelta: (text) => {
            if (!controller.signal.aborted) setChatStreamingPreview(text)
          },
          onComplete: (text) => {
            if (controller.signal.aborted) return
            generatingForRef.current = null
            setChatStreamingPreview('')
            setChatDrafts((prev) => ({
              ...prev,
              [threadId]: {
                ...prev[threadId],
                content: text,
                status: 'generated',
                dirty: false,
                userEdited: false,
                generatedAt: now(),
                updatedAt: now(),
              },
            }))
          },
          onError: (msg) => {
            if (controller.signal.aborted) return
            generatingForRef.current = null
            setChatStreamingPreview('')
            // Restore the content that existed before generation started
            setChatDrafts((prev) => ({
              ...prev,
              [threadId]: {
                ...(prev[threadId] ?? { threadId, attachments: [] }),
                content: previousContent,
                status: 'error',
                errorMessage: msg,
                updatedAt: now(),
              },
            }))
          },
        },
        controller.signal,
      )
    },
    [],
  )

  /* ---- generateDraft ---- */
  const generateDraft = useCallback(
    (options?: EmailReplyGenerationOptions) => {
      if (!selectedThread) return
      if (selectedThread.providerType === 'email') {
        emailCtx.generateDraft(options)
        return
      }
      if (chatDrafts[selectedThread.id]) return
      if (generatingForRef.current === selectedThread.id) return
      startChatGeneration(selectedThread)
    },
    [selectedThread, chatDrafts, emailCtx, startChatGeneration],
  )

  /* ---- regenerateDraft ---- */
  const regenerateDraft = useCallback(
    (force = false, options?: EmailReplyGenerationOptions) => {
      if (!selectedThread) return
      if (selectedThread.providerType === 'email') {
        emailCtx.regenerateDraft(force, options)
        return
      }
      const threadId = selectedThread.id
      // Capture current content so onError can restore it (don't pre-clear the draft)
      const previousContent = chatDrafts[threadId]?.content ?? ''
      abortRef.current?.abort()
      generatingForRef.current = null
      const snapshotThread = selectedThread
      setTimeout(() => startChatGeneration(snapshotThread, 'friendly', previousContent), 50)
    },
    [selectedThread, chatDrafts, emailCtx, startChatGeneration],
  )

  /* ---- updateDraftContent ---- */
  const updateDraftContent = useCallback(
    (content: string) => {
      if (!selectedThread) return
      if (selectedThread.providerType === 'email') {
        emailCtx.updateDraftContent(content)
        return
      }
      const threadId = selectedThread.id
      setChatDrafts((prev) => {
        const d = prev[threadId]
        // Create draft if none exists (user typing directly without generating AI first)
        const base: CommunicationReplyDraft = d ?? {
          threadId,
          content: '',
          status: 'edited' as const,
          dirty: false,
          userEdited: false,
          attachments: [],
        }
        return {
          ...prev,
          [threadId]: {
            ...base,
            content,
            status: 'edited' as const,
            dirty: true,
            userEdited: true,
            updatedAt: now(),
          },
        }
      })
    },
    [selectedThread, emailCtx],
  )

  const saveDraft = useCallback(() => {
    if (!selectedThread) return
    if (selectedThread.providerType === 'email') {
      emailCtx.saveDraft()
    }
  }, [selectedThread, emailCtx])

  /* ---- addDraftAttachment ---- */
  const addDraftAttachment = useCallback(
    (att: { filename: string; path: string; size: number; contentType: string }) => {
      if (!selectedThread) return
      if (selectedThread.providerType === 'email') {
        emailCtx.addReplyAttachment(att)
        return
      }
      setChatDrafts((prev) => {
        const d = prev[selectedThread.id]
        if (!d) return prev
        const existing = d.attachments ?? []
        if (existing.some((a) => a.path === att.path)) return prev
        return {
          ...prev,
          [selectedThread.id]: {
            ...d,
            attachments: [...existing, att],
            dirty: true,
            updatedAt: now(),
          },
        }
      })
    },
    [selectedThread, emailCtx],
  )

  /* ---- removeDraftAttachment ---- */
  const removeDraftAttachment = useCallback(
    (filePath: string) => {
      if (!selectedThread) return
      if (selectedThread.providerType === 'email') {
        emailCtx.removeReplyAttachment(filePath)
        return
      }
      setChatDrafts((prev) => {
        const d = prev[selectedThread.id]
        if (!d) return prev
        return {
          ...prev,
          [selectedThread.id]: {
            ...d,
            attachments: d.attachments.filter((a) => a.path !== filePath),
            dirty: true,
            updatedAt: now(),
          },
        }
      })
    },
    [selectedThread, emailCtx],
  )

  /* ---- sendReply ---- */
  const sendReply = useCallback(() => {
    if (!selectedThread) return
    if (selectedThread.providerType === 'email') {
      emailCtx.sendReply()
      return
    }
    // Matrix chat path
    const threadId = selectedThread.id
    const draft = chatDrafts[threadId]
    if (!draft?.content) return

    if (threadId.startsWith('matrix:')) {
      const roomId = threadId.slice('matrix:'.length)
      setChatDrafts((prev) => ({
        ...prev,
        [threadId]: { ...prev[threadId], status: 'sending' as const },
      }))
      ;(async () => {
        try {
          await matrixCtx.sendMessageToRoom(roomId, draft.content)
          setChatDrafts((prev) => {
            const { [threadId]: _sent, ...rest } = prev
            return rest
          })
        } catch (err) {
          setChatDrafts((prev) => ({
            ...prev,
            [threadId]: {
              ...prev[threadId],
              status: 'error' as const,
              errorMessage: (err as Error).message ?? '发送失败',
            },
          }))
        }
      })()
      return
    }

    // Fallback: clear draft (legacy mock path no longer used)
    setChatDrafts((prev) => {
      const { [threadId]: _sent, ...rest } = prev
      return rest
    })
  }, [selectedThread, chatDrafts, emailCtx, matrixCtx])

  const streamingPreview =
    selectedThread?.providerType === 'chat'
      ? chatStreamingPreview
      : emailCtx.streamingPreview

  const createMatrixDirect = useCallback(async (targetUserId: string) => {
    const roomId = await matrixCtx.createDirectRoom(targetUserId)
    setSelectedThreadId(`matrix:${roomId}`)
  }, [matrixCtx])

  const value = useMemo<CommunicationContextValue>(
    () => ({
      threads,
      filteredThreads,
      selectedThreadId,
      selectedThread,
      activeFilter,
      setActiveFilter,
      selectThread,
      currentDraft,
      streamingPreview,
      generateDraft,
      regenerateDraft,
      updateDraftContent,
      saveDraft,
      addDraftAttachment,
      removeDraftAttachment,
      sendReply,
      isRealEmailMode: emailCtx.isRealMode,
      isFetchingMails: emailCtx.isFetchingMails,
      fetchError: emailCtx.fetchError,
      refreshMails: emailCtx.refreshMails,
      emailAccountConfig: emailCtx.accountConfig,
      saveEmailAccount: emailCtx.saveAccount,
      clearEmailAccount: emailCtx.clearAccount,
      sendBlank: emailCtx.sendBlank,
      deleteMail: emailCtx.deleteMail,
      restoreMail: emailCtx.restoreMail,
      refreshSent: emailCtx.fetchSentMails,
      refreshTrash: emailCtx.fetchTrashMails,
      matrixPhase: matrixCtx.phase,
      createMatrixDirect,
    }),
    [
      threads, filteredThreads, selectedThreadId, selectedThread,
      activeFilter, selectThread, currentDraft, streamingPreview,
      generateDraft, regenerateDraft, updateDraftContent, saveDraft,
      addDraftAttachment, removeDraftAttachment, sendReply,
      emailCtx.isRealMode, emailCtx.isFetchingMails, emailCtx.fetchError,
      emailCtx.refreshMails, emailCtx.accountConfig,
      emailCtx.saveAccount, emailCtx.clearAccount,
      emailCtx.sendBlank, emailCtx.deleteMail, emailCtx.restoreMail, emailCtx.fetchSentMails, emailCtx.fetchTrashMails,
      matrixCtx.phase, createMatrixDirect,
    ],
  )

  return (
    <CommunicationContext.Provider value={value}>
      {children}
    </CommunicationContext.Provider>
  )
}
