import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  EmailAccountConfig,
  EmailReplyGenerationOptions,
  EmailReplyKnowledgeSnippet,
  MailItem,
  ReplyDraft,
  SentMailRecord,
  DraftStatus,
  OutgoingAttachment,
} from '../../../types/email'
import { uid } from '../../../types/email'
import { runWritingAssistant } from '../../writing/services/WritingAssistantService'
import { useInternalAccount } from '../../../contexts/InternalAccountContext'
import { resolveEmailAccountId } from '../utils/emailAccountUtils'
import { computeBodyHash } from '../services/mailTriageCache'
import { getAiDraft, updateAiDraftStatus } from '../services/mailDraftStore'
import { getUserDraft, setUserDraft, updateUserDraftStatus } from '../services/userDraftStore'

/* ------------------------------------------------------------------ */
/*  helpers                                                           */
/* ------------------------------------------------------------------ */

const now = () => new Date().toISOString()

function resolveReplyPerspective(mail: MailItem): {
  responderName: string
  responderAddress: string
  counterpartyName: string
  counterpartyAddress: string
} {
  return {
    responderName: String(mail.toName || '').trim() || '当前用户',
    responderAddress: String(mail.to || '').trim() || 'current-user@example.com',
    counterpartyName: String(mail.fromName || '').trim() || '对方',
    counterpartyAddress: String(mail.from || '').trim() || 'unknown@example.com',
  }
}

function buildReplySubject(subject: string): string {
  const trimmed = subject.trim()
  if (!trimmed) return 'Re: （无主题）'
  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`
}

function limitText(value: string, maxLength: number): string {
  const normalized = String(value || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength).trim()}…`
}

function formatKnowledgeContext(snippets: EmailReplyKnowledgeSnippet[] | undefined): string {
  const safeSnippets = (snippets ?? [])
    .map((snippet) => ({
      ...snippet,
      text: limitText(snippet.text, 900),
    }))
    .filter((snippet) => snippet.text)
    .slice(0, 8)

  if (safeSnippets.length === 0) return ''

  const blocks = safeSnippets.map((snippet, index) => {
    const source = [snippet.knowledgeName, snippet.sourceTitle].filter(Boolean).join(' / ') || '用户选择的知识库'
    return `[知识库片段 ${index + 1}]\n来源：${source}\n内容：${snippet.text}`
  })

  return `以下是用户选择的知识库中检索到的相关内容，请只在相关时使用：\n\n${blocks.join('\n\n')}\n\n知识库使用要求：\n1. 只能基于邮件正文和知识库片段回答。\n2. 不要编造知识库没有的信息。\n3. 如果知识库内容与邮件无关，不要强行使用。\n4. 如果需要引用流程、政策、材料、时间安排、联系人等，请优先使用知识库内容。\n5. 回复应自然、简洁、可直接发送。\n6. 回复正文不要出现“知识库片段”“检索结果”“系统提供的上下文”等内部过程表述。`
}

function formatTriageContext(options?: EmailReplyGenerationOptions): string {
  const triage = options?.triageContext
  if (!triage) return ''
  const lines = [
    triage.summary ? `摘要：${triage.summary}` : '',
    triage.category ? `分类：${triage.category}` : '',
    triage.actionType ? `处理类型：${triage.actionType}` : '',
    triage.reason ? `判断依据：${triage.reason}` : '',
    triage.suggestedAction ? `建议动作：${triage.suggestedAction}` : '',
    triage.timeIntentTitle ? `日程事项：${triage.timeIntentTitle}` : '',
    triage.timeIntentSourceText ? `日程来源文本：${triage.timeIntentSourceText}` : '',
  ].filter(Boolean)
  return lines.length ? `AI 邮件分析结果：\n${lines.join('\n')}` : ''
}

function formatCalendarContext(options?: EmailReplyGenerationOptions): string {
  const calendar = options?.calendarContext
  if (!calendar?.hasTimeRequirement) return ''
  const candidateLines = (calendar.candidateTimes ?? [])
    .slice(0, 6)
    .map((candidate) => `- ${candidate.startTime}${candidate.endTime ? ` 至 ${candidate.endTime}` : ''}${candidate.hasConflict ? '（有冲突）' : '（无冲突）'}`)

  return [
    '日历检查事实（优先级高于知识库补充信息）：',
    calendar.intentType ? `类型：${calendar.intentType}` : '',
    calendar.title ? `事项：${calendar.title}` : '',
    calendar.startTime ? `开始时间：${calendar.startTime}` : '',
    calendar.endTime ? `结束时间：${calendar.endTime}` : '',
    calendar.deadlineTime ? `截止时间：${calendar.deadlineTime}` : '',
    calendar.location ? `地点：${calendar.location}` : '',
    calendar.recommendedTime ? `推荐回复时间：${calendar.recommendedTime}` : '',
    `冲突状态：${calendar.hasConflict ? `有冲突（${calendar.conflictCount ?? 1} 个）` : '无冲突'}`,
    candidateLines.length ? `候选时间：\n${candidateLines.join('\n')}` : '',
    '回复必须遵守：日历冲突事实 > 邮件原文要求 > 知识库补充信息 > 通用礼貌表达。若存在冲突，不能确认参加或承诺该时间可用，也不要暴露具体冲突日程标题。',
  ].filter(Boolean).join('\n')
}

/* ------------------------------------------------------------------ */
/*  AI reply generator                                                 */
/* ------------------------------------------------------------------ */

/**
 * Generate an AI reply draft for a given mail.
 * Optional knowledge snippets are retrieved before this function and passed in explicitly.
 */
async function generateReplyDraft(
  mail: MailItem,
  callbacks: { onDelta: (text: string) => void; onComplete: (text: string) => void; onError: (msg: string) => void },
  signal?: AbortSignal,
  options?: EmailReplyGenerationOptions,
): Promise<void> {
  const perspective = resolveReplyPerspective(mail)
  const knowledgeContext = formatKnowledgeContext(options?.knowledgeSnippets)
  const triageContext = formatTriageContext(options)
  const calendarContext = formatCalendarContext(options)
  const contextBlocks = [triageContext, calendarContext, knowledgeContext].filter(Boolean)
  const contextBlock = contextBlocks.length
    ? `\n\nAdditional context for this reply:\n${contextBlocks.join('\n\n')}`
    : ''
  const prompt = `You are a professional email reply expert. Write a well-crafted reply email from the perspective of the recipient.

Requirements:
1. Output the reply body directly — do NOT include a subject line.
2. You are replying on behalf of "${perspective.responderName} (${perspective.responderAddress})" to "${perspective.counterpartyName} (${perspective.counterpartyAddress})".
3. Automatically determine the appropriate tone and structure based on the email type — do NOT ask the user to choose:
   - Task: confirm todos and deadlines
   - Request: respond to each item
   - Inquiry: answer step by step; if no clear basis, state "pending further confirmation"
   - Notification: brief acknowledgment only if a reply is needed
   - Attachment review: state the attachment handling plan
   - Approval: be formal and cautious; flag items requiring manual confirmation
4. If the email involves policy, procedures, deadlines, or approval criteria not clearly stated in the body, do NOT fabricate facts — state "pending further confirmation".
5. When knowledge snippets are provided, use them only when relevant; do not fabricate information absent from both the email and snippets.
6. If calendar facts are provided, follow them strictly and prioritize conflict facts over any supplemental information.
7. Keep the current email's language style and make the reply natural rather than a mechanical list of references.
8. Sign with "${perspective.responderName}" at the end of the Chinese section.
9. IMPORTANT — You MUST generate the reply in bilingual format. Use EXACTLY these two section headings with no variation:

English:

<English reply body here>

中文：

<Chinese reply body here>

The English version must appear first. The Chinese version must follow. Do NOT omit either section. The Chinese version should be a natural, formal Chinese expression of the same content — not a word-for-word translation.

Received email:
From: ${perspective.counterpartyName} (${perspective.counterpartyAddress})
To: ${perspective.responderName} (${perspective.responderAddress})
Subject: ${mail.subject}
Body:
${mail.body}${contextBlock}`

  options?.onPromptBuilt?.({
    knowledgeContextLength: knowledgeContext.length,
    promptHasKnowledgeContext: prompt.includes('以下是用户选择的知识库中检索到的相关内容'),
    promptHasKnowledgeRequirement: prompt.includes('When knowledge snippets are provided'),
  })

  let useLocalFallback = false
  try {
    let completedText = ''
    await runWritingAssistant(
      { instruction: prompt, language: 'zh' },
      {
        onDelta: (_delta, acc) => { callbacks.onDelta(acc) },
        onComplete: ({ text }) => { completedText = text.trim() },
        onError: (err) => {
          console.warn('[EmailContext] LLM generation failed, using local fallback:', err)
          useLocalFallback = true
        },
      },
      signal,
    )
    if (!useLocalFallback && completedText) {
      callbacks.onComplete(completedText)
      return
    }
    useLocalFallback = true
  } catch {
    useLocalFallback = true
  }

  if (useLocalFallback) {
    const fallbackReply = `English:\n\nDear ${perspective.counterpartyName},\n\nThank you for your email regarding "${mail.subject || 'related matters'}". I have carefully reviewed your message and will address the relevant matters as soon as possible.\n\nPlease feel free to contact me if you need anything further.\n\nBest regards,\n${perspective.responderName}\n\n中文：\n\n${perspective.counterpartyName}您好：\n\n感谢您的来信。关于“${mail.subject || '相关事项'}”，我已仔细阅读您的邮件内容，会尽快处理相关事宜。\n\n如有需要进一步讨论的问题，请随时与我联系。\n\n祝好！\n${perspective.responderName}`
    await new Promise<void>((resolve) => {
      let i = 0
      const step = () => {
        if (signal?.aborted) { callbacks.onError('已取消'); resolve(); return }
        i += Math.floor(Math.random() * 6) + 4
        if (i >= fallbackReply.length) {
          callbacks.onDelta(fallbackReply)
          callbacks.onComplete(fallbackReply)
          resolve()
        } else {
          callbacks.onDelta(fallbackReply.slice(0, i))
          setTimeout(step, 25)
        }
      }
      setTimeout(step, 300)
    })
  }
}


/* ------------------------------------------------------------------ */
/*  Context shape                                                     */
/* ------------------------------------------------------------------ */

/** Compose payload used by the ComposeModal */
export interface ComposePayload {
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  body: string
  attachments?: Array<{ fileName: string; filePath: string; mimeType: string; sizeBytes: number }>
}

interface EmailContextValue {
  /* Mail list */
  mails: MailItem[]
  selectedMailId: string | null
  selectMail: (id: string | null) => void

  /* Draft for the currently selected mail */
  currentDraft: ReplyDraft | null
  /** Manually trigger AI draft generation for the selected mail */
  generateDraft: (options?: EmailReplyGenerationOptions) => void
  updateDraftContent: (content: string) => void
  saveDraft: () => void
  regenerateDraft: (force?: boolean, options?: EmailReplyGenerationOptions) => void
  sendReply: () => void
  /** Append a file to the current draft's outgoing attachments */
  addReplyAttachment: (att: OutgoingAttachment) => void
  /** Remove a file from the current draft's outgoing attachments by path */
  removeReplyAttachment: (filePath: string) => void
  /** Whether regenerate needs confirmation (user has edited) */
  needsRegenerateConfirm: boolean

  /* Sent records */
  sentRecords: SentMailRecord[]
  sentMails: MailItem[]
  trashMails: MailItem[]
  fetchSentMails: () => void
  fetchTrashMails: () => void
  deleteMail: (id: string, folder: 'inbox' | 'sent' | 'trash') => Promise<void>
  restoreMail: (id: string) => Promise<void>
  sendBlank: (payload: ComposePayload) => Promise<void>

  /* Streaming preview text during generation */
  streamingPreview: string

  /* Real email account */
  accountConfig: EmailAccountConfig | null
  isRealMode: boolean
  isFetchingMails: boolean
  fetchError: string | null
  saveAccount: (config: EmailAccountConfig) => Promise<void>
  clearAccount: () => Promise<void>
  refreshMails: () => void
}

const EmailContext = createContext<EmailContextValue | null>(null)

export function useEmail(): EmailContextValue {
  const ctx = useContext(EmailContext)
  if (!ctx) throw new Error('useEmail must be used inside EmailProvider')
  return ctx
}

/* ------------------------------------------------------------------ */
/*  Provider                                                          */
/* ------------------------------------------------------------------ */

export function EmailProvider({ children }: { children: ReactNode }) {
  const { state: accountState } = useInternalAccount()
  const [mails, setMails] = useState<MailItem[]>([])
  const [selectedMailId, setSelectedMailId] = useState<string | null>(null)

  // All drafts keyed by mail id
  const [drafts, setDrafts] = useState<Record<string, ReplyDraft>>({})
  const [sentRecords, setSentRecords] = useState<SentMailRecord[]>([])
  const [sentMails, setSentMails] = useState<MailItem[]>([])
  const [trashMails, setTrashMails] = useState<MailItem[]>([])
  const [streamingPreview, setStreamingPreview] = useState('')

  // Real email account
  const [accountConfig, setAccountConfig] = useState<EmailAccountConfig | null>(null)
  const [isFetchingMails, setIsFetchingMails] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const generatingForRef = useRef<string | null>(null)
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* ---- load account config on mount ---- */
  useEffect(() => {
    if (!window.electronAPI?.emailGetAccount) return
    window.electronAPI.emailGetAccount().then((config) => {
      setAccountConfig(config)
      if (config) fetchRealMails(config)
    }).catch(() => { /* no config */ })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---- User isolation: clear email state when account logs out ---- */
  useEffect(() => {
    if (accountState.phase === 'idle' || accountState.phase === 'error') {
      setMails([])
      setSentMails([])
      setTrashMails([])
      setSelectedMailId(null)
      setDrafts({})
      setSentRecords([])
      setAccountConfig(null)
      setFetchError(null)
    }
  }, [accountState.phase])

  /* ---- User isolation: reload email config after internal account applies email config ---- */
  const emailAutoStatus = accountState.phase === 'logged_in' ? accountState.session.emailAutoStatus : undefined
  const currentUserId = accountState.phase === 'logged_in' ? accountState.session.user?.id : undefined
  const currentUserEmail = accountState.phase === 'logged_in' ? accountState.session.user?.email : undefined

  useEffect(() => {
    if (emailAutoStatus !== 'applied') return
    if (!window.electronAPI?.emailGetAccount) return

    window.electronAPI.emailGetAccount().then((config) => {
      if (!config) return
      // Validate config belongs to the current user
      const configEmail = config.email || config.user || ''
      if (currentUserEmail && configEmail && configEmail !== currentUserEmail) {
        console.debug('[Email] Config email mismatch — skipping stale config:', configEmail, '≠', currentUserEmail)
        return
      }
      if (config.ownerUserId && currentUserId && config.ownerUserId !== currentUserId) {
        console.debug('[Email] Config ownerUserId mismatch — skipping stale config:', config.ownerUserId, '≠', currentUserId)
        return
      }
      // Config is valid for current user — reload
      setMails([])
      setSentMails([])
      setTrashMails([])
      setSelectedMailId(null)
      setAccountConfig(config)
      fetchRealMails(config)
    }).catch(() => { /* no config */ })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailAutoStatus])

  const isRealMode = Boolean(accountConfig)

  /* ---- fetch real mails ---- */
  const fetchRealMails = useCallback(async (config: EmailAccountConfig) => {
    setIsFetchingMails(true)
    setFetchError(null)
    try {
      const response = await window.electronAPI.emailFetchInbox()
      const inbox = Array.isArray(response)
        ? response
        : response.ok
          ? response.mails
          : (() => { throw new Error(response.error.message) })()

      const baseMails = inbox as MailItem[]

      setMails(baseMails)
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsFetchingMails(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refreshMails = useCallback(() => {
    if (accountConfig) fetchRealMails(accountConfig)
  }, [accountConfig, fetchRealMails])

  /* ---- debounce-persist user reply edits to localStorage ---- */
  useEffect(() => {
    if (!selectedMailId || !accountConfig) return
    const draft = drafts[selectedMailId]
    if (!draft || !draft.userEdited || draft.status === 'sent' || draft.status === 'sending') return
    const mail = mails.find((m) => m.id === selectedMailId)
    if (!mail) return

    const acctId = resolveEmailAccountId(accountConfig) || accountConfig.user || accountConfig.email || 'local-account'
    const bodyHash = computeBodyHash(mail.body)
    const replyBody = draft.content

    if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    persistTimerRef.current = setTimeout(() => {
      setUserDraft({
        accountId: acctId,
        messageId: selectedMailId,
        bodyHash,
        replyBody,
        status: 'editing',
        createdAt: draft.generatedAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    }, 800)

    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts, selectedMailId, mails, accountConfig])

  /* ---- fetch sent mails ---- */
  const fetchSentMails = useCallback(async () => {
    if (!window.electronAPI?.emailFetchSent) return
    try {
      const response = await window.electronAPI.emailFetchSent()
      const items = Array.isArray(response)
        ? response
        : response?.ok
          ? response.mails
          : []
      setSentMails(items as MailItem[])
    } catch {
      setSentMails([])
    }
  }, [])

  const fetchTrashMails = useCallback(async () => {
    if (!window.electronAPI?.emailFetchTrash) return
    try {
      const response = await window.electronAPI.emailFetchTrash()
      const items = Array.isArray(response)
        ? response
        : response?.ok
          ? response.mails
          : []
      setTrashMails(items as MailItem[])
    } catch {
      setTrashMails([])
    }
  }, [])

  /* ---- delete mail (move to trash) ---- */
  const deleteMail = useCallback(async (id: string, folder: 'inbox' | 'sent' | 'trash') => {
    if (window.electronAPI?.emailDeleteMessage) {
      const res = await window.electronAPI.emailDeleteMessage({ mailId: id, folder: folder === 'trash' ? 'inbox' : folder })
      if (res && typeof res === 'object' && 'ok' in res && !res.ok) {
        const errObj = res as { ok: false; error: { message: string } }
        throw new Error(errObj.error?.message || '删除邮件失败')
      }
    }
    if (folder === 'inbox') {
      const deleted = mails.find((m) => m.id === id)
      if (deleted) setTrashMails((prev) => [{ ...deleted, folder: 'trash' }, ...prev])
      setMails((prev) => prev.filter((m) => m.id !== id))
    } else {
      setSentMails((prev) => prev.filter((m) => m.id !== id))
    }
  }, [mails])

  const restoreMail = useCallback(async (id: string) => {
    if (window.electronAPI?.emailRestoreMessage) {
      const res = await window.electronAPI.emailRestoreMessage({ mailId: id, folder: 'trash' })
      if (res && typeof res === 'object' && 'ok' in res && !res.ok) {
        const errObj = res as { ok: false; error: { message: string } }
        throw new Error(errObj.error?.message || '恢复邮件失败')
      }
    }
    const restored = trashMails.find((m) => m.id === id)
    if (restored) setMails((prev) => [{ ...restored, folder: 'inbox' }, ...prev])
    setTrashMails((prev) => prev.filter((m) => m.id !== id))
  }, [trashMails])

  /* ---- send blank mail ---- */
  const sendBlank = useCallback(async (payload: ComposePayload) => {
    if (!accountConfig) throw new Error('请先登录内部账号并连接邮箱')
    const from = accountConfig.email || accountConfig.user || ''
    const fromName = (accountConfig as EmailAccountConfig & { displayName?: string }).displayName || from
    const toStr = payload.to.join(', ')
    const ccStr = (payload.cc ?? []).join(', ')
    const bccStr = (payload.bcc ?? []).join(', ')
    const sendOptions: Parameters<typeof window.electronAPI.emailSend>[0] = {
      from,
      fromName,
      to: toStr,
      subject: payload.subject,
      body: payload.body,
    }
    if (ccStr) (sendOptions as Record<string, unknown>).cc = ccStr
    if (bccStr) (sendOptions as Record<string, unknown>).bcc = bccStr
    if (payload.attachments?.length) {
      sendOptions.attachments = payload.attachments.map((a) => ({ filename: a.fileName, path: a.filePath }))
    }
    const res = await window.electronAPI.emailSend(sendOptions)
    if (res && typeof res === 'object' && 'ok' in res && !res.ok) {
      const errObj = res as { ok: false; error: { message: string } }
      throw new Error(errObj.error?.message || '邮件发送失败')
    }
    // Surface non-fatal append warning if present
    if (res && typeof res === 'object' && 'appendWarning' in res && res.appendWarning) {
      console.warn('[Email] sendBlank append warning:', res.appendWarning)
    }
    // Record activity for daily report generation
    if (currentUserId) {
      void import('../../../services/workActivityLog').then(({ logActivity }) => {
        logActivity(currentUserId, 'mail', 'send_mail', { title: payload.subject, summary: `发送了邮件：${payload.subject}` })
      })
    }
    // Refresh sent list asynchronously
    fetchSentMails().catch(() => {})
  }, [accountConfig, fetchSentMails, currentUserId])

  /* ---- save / clear account ---- */
  const saveAccount = useCallback(async (config: EmailAccountConfig) => {
    await window.electronAPI.emailSaveAccount(config)
    setAccountConfig(config)
    fetchRealMails(config)
  }, [fetchRealMails])

  const clearAccount = useCallback(async () => {
    await window.electronAPI.emailClearAccount()
    setAccountConfig(null)
    setMails([])
  }, [])

  /* ---- select mail ---- */
  const selectMail = useCallback((id: string | null) => {
    setSelectedMailId(id)
    if (!id) return

    // Mark as read
    setMails((prev) => prev.map((m) => (m.id === id && m.unread ? { ...m, unread: false } : m)))

    // Pre-populate draft from persisted user edits, then AI draft, then nothing
    setDrafts((prev) => {
      if (prev[id]?.status !== undefined && prev[id]?.status !== 'not_generated') return prev // in-session draft exists
      const mail = mails.find((m) => m.id === id)
      if (!mail || !accountConfig) return prev
      const acctId = resolveEmailAccountId(accountConfig) || accountConfig.user || accountConfig.email || 'local-account'
      const bodyHash = computeBodyHash(mail.body)

      // 1. User-edited draft takes priority
      const userDraft = getUserDraft(acctId, id, bodyHash)
      if (userDraft) {
        return {
          ...prev,
          [id]: {
            mailId: id,
            content: userDraft.replyBody,
            status: 'edited' as DraftStatus,
            dirty: false,
            userEdited: true,
            attachments: [],
            generatedAt: userDraft.createdAt,
            updatedAt: userDraft.updatedAt,
          },
        }
      }

      // 2. AI draft fallback
      const aiDraft = getAiDraft(acctId, id, bodyHash)
      if (!aiDraft) return prev
      return {
        ...prev,
        [id]: {
          mailId: id,
          content: aiDraft.draftBody,
          status: 'generated' as DraftStatus,
          dirty: false,
          userEdited: false,
          attachments: [],
          generatedAt: aiDraft.createdAt,
          updatedAt: new Date().toISOString(),
        },
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mails, accountConfig])

  const startGeneration = useCallback((mailId: string, mail: MailItem, options?: EmailReplyGenerationOptions) => {
    // Abort any in-flight generation
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    generatingForRef.current = mailId

    setDrafts((prev) => ({
      ...prev,
      [mailId]: { ...prev[mailId], mailId, content: '', status: 'generating' as DraftStatus, dirty: false, userEdited: false, errorMessage: undefined },
    }))
    setStreamingPreview('')

    generateReplyDraft(
      mail,
      {
        onDelta: (text) => {
          if (controller.signal.aborted) return
          setStreamingPreview(text)
        },
        onComplete: (text) => {
          if (controller.signal.aborted) return
          generatingForRef.current = null
          setStreamingPreview('')
          const AI_SIGNATURE = '\n\n本条回复由 AI 自动生成'
          setDrafts((prev) => ({
            ...prev,
            [mailId]: { ...prev[mailId], content: text + AI_SIGNATURE, status: 'generated', dirty: false, userEdited: false, generatedAt: now(), updatedAt: now() },
          }))
        },
        onError: (msg) => {
          if (controller.signal.aborted) return
          generatingForRef.current = null
          setStreamingPreview('')
          setDrafts((prev) => ({
            ...prev,
            [mailId]: { ...prev[mailId], status: 'error', errorMessage: msg, updatedAt: now() },
          }))
        },
      },
      controller.signal,
      options,
    )
  }, [])

  /* ---- manually trigger draft generation ---- */
  const generateDraft = useCallback((options?: EmailReplyGenerationOptions) => {
    if (!selectedMailId) return
    const mail = mails.find((m) => m.id === selectedMailId)
    if (!mail) return
    if (generatingForRef.current === selectedMailId) return
    startGeneration(selectedMailId, mail, options)
  }, [selectedMailId, mails, startGeneration])

  /* ---- draft mutations ---- */
  const currentDraft = selectedMailId ? drafts[selectedMailId] ?? null : null

  const updateDraftContent = useCallback((content: string) => {
    if (!selectedMailId) return
    setDrafts((prev) => {
      const d = prev[selectedMailId]
      if (!d) {
        // User typed directly before generating AI draft — create a blank draft
        return { ...prev, [selectedMailId]: { mailId: selectedMailId, content, status: 'edited', dirty: true, userEdited: true, attachments: [], updatedAt: now() } }
      }
      return { ...prev, [selectedMailId]: { ...d, content, status: (d.status === 'generated' || d.status === 'saved') ? 'edited' : d.status, dirty: true, userEdited: true, updatedAt: now() } }
    })
  }, [selectedMailId])

  const saveDraft = useCallback(() => {
    if (!selectedMailId) return
    setDrafts((prev) => {
      const d = prev[selectedMailId]
      if (!d) return prev
      return { ...prev, [selectedMailId]: { ...d, status: 'saved', dirty: false, savedAt: now(), updatedAt: now() } }
    })
  }, [selectedMailId])

  const addReplyAttachment = useCallback((att: OutgoingAttachment) => {
    if (!selectedMailId) return
    setDrafts((prev) => {
      const d = prev[selectedMailId]
      const existing = d?.attachments ?? []
      if (existing.some((a) => a.path === att.path)) return prev
      // Create blank draft if none exists yet (user picking file before typing/generating)
      const base: ReplyDraft = d ?? { mailId: selectedMailId, content: '', status: 'edited', dirty: true, userEdited: false, attachments: [] }
      return { ...prev, [selectedMailId]: { ...base, attachments: [...existing, att], dirty: true, updatedAt: now() } }
    })
  }, [selectedMailId])

  const removeReplyAttachment = useCallback((filePath: string) => {
    if (!selectedMailId) return
    setDrafts((prev) => {
      const d = prev[selectedMailId]
      if (!d) return prev
      return { ...prev, [selectedMailId]: { ...d, attachments: (d.attachments ?? []).filter((a) => a.path !== filePath), dirty: true, updatedAt: now() } }
    })
  }, [selectedMailId])

  const needsRegenerateConfirm = Boolean(currentDraft && currentDraft.userEdited && currentDraft.status !== 'sent')

  const regenerateDraft = useCallback((force = false, options?: EmailReplyGenerationOptions) => {
    if (!selectedMailId) return
    const mail = mails.find((m) => m.id === selectedMailId)
    if (!mail) return
    // If force is false and user has edited, caller should confirm first
    if (!force && needsRegenerateConfirm) return
    startGeneration(selectedMailId, mail, options)
  }, [selectedMailId, mails, needsRegenerateConfirm, startGeneration])

  /* ---- send ---- */
  const sendReply = useCallback(() => {
    if (!selectedMailId) return
    const draft = drafts[selectedMailId]
    if (!draft || !draft.content.trim()) return
    const mail = mails.find((m) => m.id === selectedMailId)
    if (!mail) return
    const perspective = resolveReplyPerspective(mail)
    const replySubject = buildReplySubject(mail.subject)

    // Mark as sending
    setDrafts((prev) => ({
      ...prev,
      [selectedMailId]: { ...prev[selectedMailId], status: 'sending', dirty: false, updatedAt: now() },
    }))

    const finalizeSend = (sentAt: string) => {
      setDrafts((prev) => ({
        ...prev,
        [selectedMailId]: { ...prev[selectedMailId], status: 'sent', dirty: false, updatedAt: sentAt },
      }))
      setMails((prev) => prev.map((m) => (m.id === selectedMailId ? { ...m, replied: true } : m)))
      setSentRecords((prev) => [{
        id: uid(),
        sourceMailId: mail.id,
        to: mail.from,
        toName: mail.fromName,
        subject: replySubject,
        body: draft.content,
        timestamp: sentAt,
      }, ...prev])

      // Persist sent status to local stores
      if (accountConfig) {
        const acctId = resolveEmailAccountId(accountConfig) || accountConfig.user || accountConfig.email || 'local-account'
        const bodyHash = computeBodyHash(mail.body)
        updateUserDraftStatus(acctId, selectedMailId, bodyHash, 'sent')
        updateAiDraftStatus(acctId, selectedMailId, bodyHash, 'sent')
      }
    }

    const handleSendError = (errMsg: string) => {
      setDrafts((prev) => ({
        ...prev,
        [selectedMailId]: { ...prev[selectedMailId], status: 'error', errorMessage: errMsg, updatedAt: now() },
      }))
    }

    if (isRealMode) {
      // Always send from the authenticated account's address, not from mail.to
      const accountEmail = accountConfig?.email || accountConfig?.user || accountConfig?.username || perspective.responderAddress
      // Send via real SMTP
      window.electronAPI.emailSend({
        from: accountEmail,
        fromName: accountConfig?.label || accountEmail,
        to: perspective.counterpartyAddress,
        subject: replySubject,
        body: draft.content,
        attachments: draft.attachments?.map((a) => ({ filename: a.filename, path: a.path })),
        inReplyTo: mail.messageId,
        references: mail.messageId,
      }).then((response) => {
        if (response && typeof response === 'object' && 'ok' in response && !response.ok) {
          throw new Error((response as { ok: false; error: { message: string } }).error?.message || '发送失败')
        }
        const sentAt = now()
        finalizeSend(sentAt)
        // Refresh Sent list — works whether server auto-saved or we appended via IMAP
        fetchSentMails().catch(() => {})
        // Surface non-fatal append warning if present
        const appendWarning = response && typeof response === 'object' && 'appendWarning' in response
          ? (response as { appendWarning?: string }).appendWarning
          : undefined
        if (appendWarning) {
          console.warn('[Email] sendReply append warning:', appendWarning)
        }
        if (currentUserId) {
          void import('../../../services/workActivityLog').then(({ logActivity }) => {
            logActivity(currentUserId, 'mail', 'send_reply', {
              title: replySubject,
              summary: `发送邮件回复：${replySubject}`,
              metadata: {
                sourceMailId: selectedMailId,
                hasAttachments: Boolean(draft.attachments?.length),
                attachmentCount: draft.attachments?.length ?? 0,
              },
            })
          })
        }
      }).catch((err) => {
        handleSendError(err instanceof Error ? err.message : String(err))
      })
    } else {
      // Local send fallback with simulated round-trip loopback
      setTimeout(() => {
        const sentAt = now()
        finalizeSend(sentAt)
        // Inject loopback mail for the local session
        setMails((prev) => {
          const loopbackMail: MailItem = {
            id: uid(),
            from: perspective.responderAddress,
            fromName: perspective.responderName,
            to: perspective.counterpartyAddress,
            toName: perspective.counterpartyName,
            subject: replySubject,
            body: draft.content,
            timestamp: sentAt,
            unread: true,
            replied: false,
            threadId: mail.threadId ?? mail.id,
            isLoopback: true,
          }
          return [loopbackMail, ...prev]
        })
      }, 800)
    }
  }, [selectedMailId, drafts, mails, isRealMode, fetchSentMails, currentUserId])

  const value = useMemo<EmailContextValue>(() => ({
    mails,
    selectedMailId,
    selectMail,
    currentDraft,
    generateDraft,
    updateDraftContent,
    saveDraft,
    regenerateDraft,
    sendReply,
    addReplyAttachment,
    removeReplyAttachment,
    needsRegenerateConfirm,
    sentRecords,
    sentMails,
    fetchSentMails,
    trashMails,
    fetchTrashMails,
    deleteMail,
    restoreMail,
    sendBlank,
    streamingPreview,
    accountConfig,
    isRealMode,
    isFetchingMails,
    fetchError,
    saveAccount,
    clearAccount,
    refreshMails,
  }), [mails, selectedMailId, selectMail, currentDraft, generateDraft, updateDraftContent, saveDraft, regenerateDraft, sendReply, addReplyAttachment, removeReplyAttachment, needsRegenerateConfirm, sentRecords, sentMails, fetchSentMails, trashMails, fetchTrashMails, deleteMail, restoreMail, sendBlank, streamingPreview, accountConfig, isRealMode, isFetchingMails, fetchError, saveAccount, clearAccount, refreshMails])

  return <EmailContext.Provider value={value}>{children}</EmailContext.Provider>
}
