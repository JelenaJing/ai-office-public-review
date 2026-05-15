/**
 * MailTriageContext — user-triggered AI email classification.
 *
 * Responsibilities:
 *  • Loads cached triage results from localStorage on mount / account change
 *  • triggerAnalysis() — user-facing "AI邮件分析" action:
 *    1. Scans current inbox unread mails
 *    2. Applies local rules (no LLM) for obvious low-priority mail
 *    3. Skips mails with a cached success result (accountId+messageId+bodyHash)
 *    4. Batch-classifies remaining mails via LLM (max 5 per batch)
 *    5. After classification, generates local AI pre-reply drafts for qualifying mails
 *  • Exposes triage results, analysis status, and progress counters to consumers
 *
 * Does NOT touch mailcow / IMAP / SMTP in any way.
 * AI cannot auto-send, auto-delete, or auto-move emails.
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
import type { MailItem } from '../../../types/email'
import type {
  AiEmailTodo,
  AiMailTriageResult,
  AiMailReplyDraft,
  AiMailSkipReason,
  EmailActionType,
  EmailAnalysisBatchSummary,
  EmailAnalysisResult,
  EmailImportance,
  MailAnalysisProgress,
  MailTriageJob,
} from '../../../types/mailTriage'
import { useWorkspace } from '../../../contexts/WorkspaceContext'
import { useInternalAccount } from '../../../contexts/InternalAccountContext'
import { logActivity } from '../../../services/workActivityLog'
import {
  computeBodyHash,
  getAllCachedTriagesForAccount,
  getCachedTriage,
  setCachedTriage,
} from '../services/mailTriageCache'
import {
  applyLocalRules,
  BATCH_SIZE,
  classifyMailsBatch,
  isAttachmentOnlyMail,
  isSystemDeliveryNotice,
  normalizeEmailTimeIntent,
  stripThinkTags,
} from '../services/mailTriageClassifier'
import { getAiDraft, hasAiDraft, setAiDraft, updateAiDraftStatus } from '../services/mailDraftStore'
import { getMailTodos, mergeAnalysisTodos } from '../services/mailTodoStore'
import { buildEmailAnalysisBatchSummary } from '../services/emailAnalysisBatchSummary'
import { useEmail } from './EmailContext'
import { ensureTentativeCalendarEventFromEmail } from '../../../calendar/emailCalendarBridge'
import { listCalendarEvents } from '../../../calendar/calendarService'
import { detectCalendarConflicts } from '../../../calendar/calendarConflict'
import type { CalendarEventType } from '../../../calendar/types'

/* ------------------------------------------------------------------ */
/*  Context shape                                                      */
/* ------------------------------------------------------------------ */

/** Status driven by the user-initiated "AI邮件分析" button */
export type AnalysisStatus = 'idle' | 'running' | 'done' | 'failed'

interface MailTriageContextValue {
  /** Triage results keyed by mail.id */
  triageResults: Record<string, AiMailTriageResult>
  /** AI pre-reply drafts keyed by mail.id */
  aiDrafts: Record<string, AiMailReplyDraft>
  mailTodos: AiEmailTodo[]
  /**
   * User-facing "AI邮件分析" action.
   * Scans unread inbox mails, classifies those without cached success results,
   * and generates local AI pre-reply drafts for qualifying mails.
   * Only unread mails of the current account are processed.
   */
  triggerAnalysis: () => void
  /** Re-classify a single mail (regardless of current state) */
  enqueueMail: (mailId: string) => void
  /** Re-generate AI draft for a specific mail */
  regenerateDraft: (mailId: string) => Promise<void>
  /** Discard an AI draft */
  discardDraft: (mailId: string) => void
  /** Status for the "AI邮件分析" button */
  analysisStatus: AnalysisStatus
  /** Detailed progress counters for the current/last run */
  analysisProgress: MailAnalysisProgress
  currentAnalysisBatchId: string | null
  currentBatchResults: EmailAnalysisResult[]
  currentBatchSummary: EmailAnalysisBatchSummary | null
  isAnalyzingEmails: boolean
  isWorkerRunning: boolean
}

const MailTriageContext = createContext<MailTriageContextValue | null>(null)

export function useMailTriage(): MailTriageContextValue {
  const ctx = useContext(MailTriageContext)
  if (!ctx) throw new Error('useMailTriage must be used inside MailTriageProvider')
  return ctx
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const now = () => new Date().toISOString()
const ACTIVE_POLL_MS = 500
const MAX_RETRIES = 2

/** Build a lightweight triage result for mails that should bypass LLM analysis. */
function buildSkippedResult(mail: MailItem, accountId: string, reason: AiMailSkipReason): AiMailTriageResult {
  const isSystemNotice = reason === 'system_delivery_notice'
  return {
    messageId: mail.id,
    threadId: mail.threadId,
    accountId,
    bodyHash: computeBodyHash(mail.body),
    category: isSystemNotice ? 'read_only' : 'read_only',
    priority: 'low',
    needsReply: false,
    needsUserAction: false,
    canAutoArchive: true,
    riskLevel: 'none',
    summary: isSystemNotice
      ? (mail.subject.trim() || '系统退信通知').slice(0, 30)
      : (mail.subject.trim() || '附件邮件').slice(0, 20),
    reason: isSystemNotice ? '系统退信通知，无需 AI 分析' : '单纯附件邮件，无需 AI 分析',
    suggestedAction: isSystemNotice ? '检查收件人地址或域名 SPF/DKIM 配置' : '查看附件',
    status: 'skipped',
    skipReason: reason,
    createdAt: now(),
    updatedAt: now(),
  }
}

function resolveAccountId(accountConfig: ReturnType<typeof useEmail>['accountConfig']): string {
  if (!accountConfig) return 'local-account'
  return accountConfig.user || accountConfig.email || 'local-account'
}

function resolveWorkspaceId(activeWorkspacePath: string | null): string {
  if (!activeWorkspacePath) return 'no-workspace'
  return `ws-${computeBodyHash(activeWorkspacePath)}`
}

/**
 * Whether a triage result qualifies for AI pre-reply draft generation.
 * Security: risk mails and non-reply-intent mails never get a draft.
 */
function qualifiesForDraft(result: AiMailTriageResult): boolean {
  if (result.status !== 'success') return false
  if (result.riskLevel === 'medium' || result.riskLevel === 'high') return false
  if (result.category === 'risk') return false
  if (result.category === 'promotion') return false
  if (result.category === 'archive_candidate') return false
  if (result.category === 'read_only') return false
  if (result.category === 'unknown') return false
  // reply_required always qualifies
  if (result.category === 'reply_required') return result.priority !== 'low'
  // action_required qualifies only if needsReply=true
  if (result.category === 'action_required') return result.needsReply && result.priority !== 'low'
  return false
}

function mapImportance(result: AiMailTriageResult): EmailImportance {
  if ((result.importance || result.priority) === 'high') return 'important'
  if ((result.importance || result.priority) === 'low') return 'low'
  return 'normal'
}

function mapActionType(result: AiMailTriageResult): EmailActionType {
  const intentType = result.actionPlan?.intentType
  if (result.needsReply || result.requiresReply || result.category === 'reply_required') return 'need_reply'
  if (result.replyIntent === 'forward_to_others') return 'need_forward'
  if (intentType === 'meeting' || result.emailCategory === 'meeting_invitation') return 'need_schedule'
  if (intentType === 'attachment_review' || result.emailCategory === 'document_review') return 'need_review'
  if (result.category === 'risk' || result.emailCategory === 'spam' || result.emailCategory === 'promotion') return 'spam_or_noise'
  if (result.needsUserAction || result.requiresAction || result.category === 'action_required') return 'need_review'
  if (result.category === 'read_only' || result.emailCategory === 'system_notice' || result.emailCategory === 'internal_notice') return 'notification'
  return 'no_action'
}

function calendarEventTypeFromIntent(type: NonNullable<AiMailTriageResult['timeIntent']>['type']): CalendarEventType {
  if (type === 'interview') return 'interview'
  if (type === 'deadline') return 'deadline'
  if (type === 'reminder') return 'reminder'
  return 'meeting'
}

async function buildCalendarAwareDraftBody(mail: MailItem, responder: string, sender: string, triage: AiMailTriageResult): Promise<string | null> {
  const intent = triage.timeIntent
  if (!intent?.hasTimeRequirement) return null

  const events = await listCalendarEvents()
  const candidates = intent.candidateTimes ?? []
  if (intent.type === 'candidate_times' && candidates.length > 0) {
    const checked = candidates.map((candidate) => {
      const conflicts = detectCalendarConflicts({
        id: '',
        startTime: candidate.startTime,
        endTime: candidate.endTime,
        eventType: 'meeting',
      }, events)
      return { candidate, conflicts }
    })
    const recommended = checked.find((item) => item.conflicts.length === 0) ?? checked[0]
    const timeText = new Date(recommended.candidate.startTime).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    return `English:\n\nDear ${sender},\n\nThank you for sharing the available time options. The time that works best for me is ${timeText}. Please let me know if this works for you.\n\nBest regards,\n${responder}\n\n中文：\n\n${sender}您好：\n\n感谢您提供候选时间。我更方便的时间是 ${timeText}，请您确认是否合适。\n\n祝好！\n${responder}`
  }

  const startTime = intent.type === 'deadline' ? intent.deadlineTime : intent.startTime
  if (!startTime || intent.type === 'follow_up') {
    return `English:\n\nDear ${sender},\n\nThank you for your email. Could you please share a specific time or a few available time options so that I can confirm the arrangement?\n\nBest regards,\n${responder}\n\n中文：\n\n${sender}您好：\n\n感谢您的来信。能否请您提供一个具体时间或几个候选时间，以便我确认安排？\n\n祝好！\n${responder}`
  }

  const conflicts = detectCalendarConflicts({
    id: '',
    startTime,
    endTime: intent.endTime,
    eventType: calendarEventTypeFromIntent(intent.type),
  }, events)
  if (conflicts.length > 0) {
    return `English:\n\nDear ${sender},\n\nThank you for the arrangement regarding "${intent.title || mail.subject}". I am sorry, but I already have a commitment during that time. Would it be possible to adjust to another suitable time?\n\nBest regards,\n${responder}\n\n中文：\n\n${sender}您好：\n\n感谢您关于“${intent.title || mail.subject}”的安排。抱歉，我该时间段已有安排，是否可以调整到其他合适时间？\n\n祝好！\n${responder}`
  }

  return `English:\n\nDear ${sender},\n\nThank you for the arrangement regarding "${intent.title || mail.subject}". I am available at that time and can attend as scheduled.\n\nBest regards,\n${responder}\n\n中文：\n\n${sender}您好：\n\n感谢您关于“${intent.title || mail.subject}”的安排。可以，我这个时间有空参加。\n\n祝好！\n${responder}`
}

function buildStructuredAnalysisResult(
  mail: MailItem,
  triage: AiMailTriageResult,
  batchId: string,
  draft?: AiMailReplyDraft | null,
): EmailAnalysisResult {
  const failed = triage.status === 'failed'
  return {
    messageId: mail.id,
    threadId: mail.threadId,
    fromName: mail.fromName,
    fromEmail: mail.from,
    subject: mail.subject,
    receivedAt: mail.timestamp,
    importance: mapImportance(triage),
    category: triage.emailCategory || triage.category,
    actionType: mapActionType(triage),
    summary: triage.summary || mail.subject || '（无摘要）',
    reason: triage.reason || triage.suggestedAction || '',
    suggestedReply: triage.draftReply,
    hasDraftReply: Boolean(draft),
    draftId: draft?.id,
    deadlineText: triage.deadline,
    timeIntent: triage.timeIntent,
    calendarEventId: triage.calendarEventId,
    calendarConflictCount: triage.calendarConflictCount,
    relatedPeople: [mail.fromName, mail.toName].filter((name): name is string => Boolean(name?.trim())),
    batchId,
    error: failed ? (triage.errorMessage || '分析失败') : undefined,
  }
}

function buildFallbackFailedAnalysisResult(
  mail: MailItem,
  batchId: string,
  error: string,
): EmailAnalysisResult {
  return {
    messageId: mail.id,
    threadId: mail.threadId,
    fromName: mail.fromName,
    fromEmail: mail.from,
    subject: mail.subject,
    receivedAt: mail.timestamp,
    importance: 'normal',
    category: 'unknown',
    actionType: 'no_action',
    summary: mail.subject || '（无摘要）',
    reason: '',
    hasDraftReply: false,
    batchId,
    error,
  }
}

/** Generate an AI pre-reply draft (non-streaming LLM call). */
async function generateDraftForMail(
  mail: MailItem,
  accountId: string,
  bodyHash: string,
  triage: AiMailTriageResult,
): Promise<AiMailReplyDraft | null> {
  if (!window.electronAPI?.writingAssistant) return null
  const responder = (mail.toName || mail.to || '收件人').trim()
  const sender = (mail.fromName || mail.from || '发件人').trim()
  const bodySnippet = mail.body.slice(0, 800)
  const calendarAwareDraftBody = await buildCalendarAwareDraftBody(mail, responder, sender, triage)
  if (calendarAwareDraftBody) {
    const draft: AiMailReplyDraft = {
      id: `draft-${accountId}-${mail.id}-${Date.now()}`,
      accountId,
      messageId: mail.id,
      bodyHash,
      triageResultId: `${accountId}:${mail.id}:${bodyHash}`,
      subject: `Re: ${mail.subject}`,
      to: [mail.from || ''],
      draftBody: calendarAwareDraftBody + '\n\n（本条回复由 AI 自动生成，请确认后再发送。）',
      tone: 'polite',
      status: 'generated',
      createdAt: now(),
      updatedAt: now(),
    }
    setAiDraft(draft)
    return draft
  }
  const actionPlan = triage.actionPlan
  const externalBasisGuard = triage.requiresKnowledgeBase
    ? '\nThis email may require external policy or procedural basis. If no clear basis is available in the email or analysis result, do NOT fabricate policies, deadlines, procedures, or approval requirements — state "pending further confirmation" in both languages.'
    : ''
  const intentType = actionPlan?.intentType || triage.detectedIntent || triage.emailCategory || triage.category
  const prompt = [
    `You are a professional email reply expert. Write an editable pre-reply draft from the perspective of the recipient "${responder}".`,
    `Requirements:\n1. Output the reply body directly — do NOT include a subject line.\n2. Automatically determine tone and structure from the email and AI analysis result.\n3. Task: confirm todos and deadlines; Request: respond to each item; Inquiry: answer step by step; Notification: brief acknowledgment only if needed; Attachment review: state the attachment handling plan; Approval: be formal, cautious, and flag items needing manual confirmation.\n4. Sign with "${responder}" at the end of the Chinese section.\n5. IMPORTANT — You MUST generate the reply in bilingual format. Use EXACTLY these two section headings:\n\nEnglish:\n\n<English reply body here>\n\n中文：\n\n<Chinese reply body here>\n\nThe English version must appear first. The Chinese version must follow. Do NOT omit either section.${externalBasisGuard}`,
    `AI-detected type: ${intentType}`,
    `Action plan: ${actionPlan?.brief || triage.suggestedAction || ''}`,
    `Reply strategy: ${actionPlan?.replyStrategy.reason || triage.reason || ''}`,
    `\nTo: ${responder} (${mail.to || ''})\nFrom: ${sender} (${mail.from || ''})\nSubject: ${mail.subject}\nBody:\n${bodySnippet}`,
  ].join('\n\n')

  try {
    const raw = await window.electronAPI.writingAssistant({ instruction: prompt, language: 'zh' })
    const draftBody = stripThinkTags(raw).trim()
    if (!draftBody) return null
    const draft: AiMailReplyDraft = {
      id: `draft-${accountId}-${mail.id}-${Date.now()}`,
      accountId,
      messageId: mail.id,
      bodyHash,
      triageResultId: `${accountId}:${mail.id}:${bodyHash}`,
      subject: `Re: ${mail.subject}`,
      to: [mail.from || ''],
      draftBody: draftBody + '\n\n（本条回复由 AI 自动生成，请确认后再发送。）',
      tone: 'polite',
      status: 'generated',
      createdAt: now(),
      updatedAt: now(),
    }
    setAiDraft(draft)
    return draft
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export function MailTriageProvider({ children }: { children: ReactNode }) {
  const { mails, accountConfig } = useEmail()
  const { activeWorkspacePath } = useWorkspace()
  const { state: internalAccountState } = useInternalAccount()
  const accountId = resolveAccountId(accountConfig)
  const workspaceId = resolveWorkspaceId(activeWorkspacePath)
  const currentUserId = internalAccountState.phase === 'logged_in' ? internalAccountState.session.user.id : null

  /* Reactive state: triage results shown to UI */
  const [triageResults, setTriageResults] = useState<Record<string, AiMailTriageResult>>(() =>
    getAllCachedTriagesForAccount(accountId),
  )

  /* Reactive state: AI pre-reply drafts shown to UI, keyed by mail.id */
  const [aiDrafts, setAiDrafts] = useState<Record<string, AiMailReplyDraft>>({})
  const [mailTodos, setMailTodos] = useState<AiEmailTodo[]>(() => getMailTodos(accountId, workspaceId))

  /* In-memory job queue */
  const queueRef = useRef<MailTriageJob[]>([])
  const workerActiveRef = useRef(false)
  const workerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [isWorkerRunning, setIsWorkerRunning] = useState(false)
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>('idle')
  const [analysisProgress, setAnalysisProgress] = useState<MailAnalysisProgress>({
    total: 0, cached: 0, enqueued: 0, running: 0, done: 0, drafts: 0, failed: 0,
  })
  const [currentAnalysisBatchId, setCurrentAnalysisBatchId] = useState<string | null>(null)
  const [currentBatchResults, setCurrentBatchResults] = useState<EmailAnalysisResult[]>([])
  const [currentBatchSummary, setCurrentBatchSummary] = useState<EmailAnalysisBatchSummary | null>(null)
  const [isAnalyzingEmails, setIsAnalyzingEmails] = useState(false)

  const currentBatchIdRef = useRef<string | null>(null)
  const batchMailIdsRef = useRef<Set<string>>(new Set())
  const batchResultsRef = useRef<Record<string, EmailAnalysisResult>>({})
  const batchTriageResultsRef = useRef<Record<string, AiMailTriageResult>>({})
  const latestTriageResultsRef = useRef(triageResults)
  const latestAiDraftsRef = useRef(aiDrafts)

  useEffect(() => { latestTriageResultsRef.current = triageResults }, [triageResults])
  useEffect(() => { latestAiDraftsRef.current = aiDrafts }, [aiDrafts])

  /* ---- Reload cached results when accountId changes ---- */
  useEffect(() => {
    setTriageResults(getAllCachedTriagesForAccount(accountId))
    setAiDrafts({})
    setMailTodos(getMailTodos(accountId, workspaceId))
    queueRef.current = []
    currentBatchIdRef.current = null
    batchMailIdsRef.current = new Set()
    batchResultsRef.current = {}
    batchTriageResultsRef.current = {}
    setCurrentAnalysisBatchId(null)
    setCurrentBatchResults([])
    setCurrentBatchSummary(null)
    setIsAnalyzingEmails(false)
  }, [accountId, workspaceId])

  /* ---- Publish a result to reactive state + cache ---- */
  const publishResult = useCallback((result: AiMailTriageResult) => {
    const mergedTodos = mergeAnalysisTodos(accountId, workspaceId, result.todos ?? [])
    const nextResult = { ...result, todos: mergedTodos, updatedAt: now() }
    setCachedTriage(nextResult)
    setTriageResults((prev) => ({ ...prev, [nextResult.messageId]: nextResult }))
    setMailTodos(getMailTodos(accountId, workspaceId))
  }, [accountId, workspaceId])

  const enrichWithCalendarEvent = useCallback(async (mail: MailItem, result: AiMailTriageResult): Promise<AiMailTriageResult> => {
    const linked = await ensureTentativeCalendarEventFromEmail(mail, result)
    if (!linked) return result
    return {
      ...result,
      calendarEventId: linked.event.id,
      calendarConflictCount: linked.conflictCount,
    }
  }, [])

  const refreshCachedResult = useCallback(async (mail: MailItem, cachedResult: AiMailTriageResult): Promise<AiMailTriageResult> => {
    const normalizedTimeIntent = normalizeEmailTimeIntent(
      cachedResult.timeIntent,
      `${mail.subject}\n${mail.body}`,
      new Date(),
      mail.subject,
    )
    const normalizedResult: AiMailTriageResult = normalizedTimeIntent
      ? { ...cachedResult, timeIntent: normalizedTimeIntent }
      : cachedResult
    const linked = await enrichWithCalendarEvent(mail, normalizedResult)
    publishResult(linked)
    return linked
  }, [enrichWithCalendarEvent, publishResult])

  const recordBatchResult = useCallback((mail: MailItem, result: AiMailTriageResult, draft?: AiMailReplyDraft | null) => {
    const batchId = currentBatchIdRef.current
    if (!batchId || !batchMailIdsRef.current.has(mail.id)) return
    const existingDraft = draft ?? getAiDraft(accountId, mail.id, computeBodyHash(mail.body))
    const structured = buildStructuredAnalysisResult(mail, result, batchId, existingDraft)
    batchTriageResultsRef.current = { ...batchTriageResultsRef.current, [mail.id]: result }
    batchResultsRef.current = { ...batchResultsRef.current, [mail.id]: structured }
    setCurrentBatchResults(Object.values(batchResultsRef.current))
  }, [accountId])

  const finalizeCurrentBatch = useCallback((generatedDrafts: Record<string, AiMailReplyDraft> = {}) => {
    const batchId = currentBatchIdRef.current
    if (!batchId) {
      setIsAnalyzingEmails(false)
      return
    }

    const mailMap = new Map(mails.map((mail) => [mail.id, mail]))
    const allDrafts = { ...latestAiDraftsRef.current, ...generatedDrafts }
    const nextResults: EmailAnalysisResult[] = []

    for (const mailId of batchMailIdsRef.current) {
      const mail = mailMap.get(mailId)
      if (!mail) continue
      const triage = batchTriageResultsRef.current[mailId] ?? latestTriageResultsRef.current[mailId]
      if (!triage) {
        nextResults.push(buildFallbackFailedAnalysisResult(mail, batchId, '未获得分析结果'))
        continue
      }
      const draft = allDrafts[mailId] ?? getAiDraft(accountId, mailId, computeBodyHash(mail.body))
      nextResults.push(buildStructuredAnalysisResult(mail, triage, batchId, draft))
    }

    batchResultsRef.current = Object.fromEntries(nextResults.map((result) => [result.messageId, result]))
    setCurrentBatchResults(nextResults)
    setCurrentBatchSummary(buildEmailAnalysisBatchSummary(batchId, nextResults))
    setIsAnalyzingEmails(false)
  }, [accountId, mails])

  /* ---- Background worker: processes one batch per tick ---- */
  const scheduleWorker = useCallback(
    (delay: number) => {
      if (workerTimerRef.current !== null) clearTimeout(workerTimerRef.current)
      workerTimerRef.current = setTimeout(async () => {
        workerTimerRef.current = null

        const pendingJobs = queueRef.current.filter((j) => j.status === 'pending')
        if (pendingJobs.length === 0) {
          workerActiveRef.current = false
          setIsWorkerRunning(false)
          return // Stop — no idle polling; worker only runs when triggered
        }

        workerActiveRef.current = true
        setIsWorkerRunning(true)

        const batch = pendingJobs.slice(0, BATCH_SIZE)
        const mailMap = new Map(mails.map((m) => [m.id, m]))

        // Mark batch as running
        for (const job of batch) {
          job.status = 'running'
          job.updatedAt = now()
          setTriageResults((prev) => ({
            ...prev,
            [job.messageId]: { ...buildPendingResult(job, mailMap.get(job.messageId)), status: 'running' },
          }))
        }
        setAnalysisProgress((p) => ({ ...p, running: p.running + batch.length }))

        const mailsToClassify = batch
          .map((job) => mailMap.get(job.messageId))
          .filter((m): m is MailItem => m !== undefined)

        try {
          const results = await classifyMailsBatch(mailsToClassify, accountId)

          for (const result of results) {
            const job = batch.find((j) => j.messageId === result.messageId)
            if (job) { job.status = 'success'; job.updatedAt = now() }
            const mail = mailMap.get(result.messageId)
            const linkedResult = mail ? await enrichWithCalendarEvent(mail, result) : result
            publishResult(linkedResult)
            if (mail) recordBatchResult(mail, linkedResult)
          }
          // Mark jobs with no result as failed
          for (const job of batch) {
            if (job.status === 'running') {
              job.status = 'failed'; job.errorMessage = '无匹配结果'; job.updatedAt = now()
              const mail = mailMap.get(job.messageId)
              if (mail) {
                setTriageResults((prev) => ({
                  ...prev, [job.messageId]: buildFailedResult(job, mail, '无匹配结果'),
                }))
                recordBatchResult(mail, buildFailedResult(job, mail, '无匹配结果'))
              }
            }
          }
          const successCount = batch.filter((j) => j.status === 'success').length
          const failCount = batch.filter((j) => j.status === 'failed').length
          setAnalysisProgress((p) => ({
            ...p,
            running: Math.max(0, p.running - batch.length),
            done: p.done + successCount,
            failed: p.failed + failCount,
          }))
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          for (const job of batch) {
            if (job.status === 'running') {
              job.retryCount++
              if (job.retryCount >= MAX_RETRIES) {
                job.status = 'failed'; job.errorMessage = msg
                const mail = mailMap.get(job.messageId)
                if (mail) {
                  const failedResult = buildFailedResult(job, mail, msg)
                  setTriageResults((prev) => ({ ...prev, [job.messageId]: failedResult }))
                  recordBatchResult(mail, failedResult)
                }
              } else {
                job.status = 'pending'
              }
              job.updatedAt = now()
            }
          }
          const failCount = batch.filter((j) => j.status === 'failed').length
          setAnalysisProgress((p) => ({
            ...p,
            running: Math.max(0, p.running - batch.length),
            failed: p.failed + failCount,
          }))
        }

        scheduleWorker(ACTIVE_POLL_MS)
      }, delay)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accountId, publishResult, recordBatchResult, enrichWithCalendarEvent],
  )

  /* ---- Cleanup worker on unmount ---- */
  useEffect(() => {
    return () => { if (workerTimerRef.current !== null) clearTimeout(workerTimerRef.current) }
  }, [])

  /* ---- Watch for worker finishing; generate drafts when done ---- */
  useEffect(() => {
    if (isWorkerRunning) return
    if (analysisStatus !== 'running') return

    // Worker just stopped — generate pre-reply drafts for qualifying results
    const mailMap = new Map(mails.map((m) => [m.id, m]))
    const qualified: Array<{ mail: MailItem; result: AiMailTriageResult; bodyHash: string }> = []

    for (const mailId of batchMailIdsRef.current) {
      const result = batchTriageResultsRef.current[mailId] ?? triageResults[mailId]
      if (!result) continue
      if (!qualifiesForDraft(result)) continue
      const mail = mailMap.get(mailId)
      if (!mail) continue
      const bodyHash = computeBodyHash(mail.body)
      if (hasAiDraft(accountId, mailId, bodyHash)) continue // already generated
      qualified.push({ mail, result, bodyHash })
    }

    const hasFailed = queueRef.current.some((j) => j.status === 'failed')

    if (qualified.length > 0) {
      // Generate drafts async (fire-and-forget, sequential to avoid LLM overload)
      void (async () => {
        let draftsGenerated = 0
        const generatedDrafts: Record<string, AiMailReplyDraft> = {}
        for (const { mail, result, bodyHash } of qualified) {
          const draft = await generateDraftForMail(mail, accountId, bodyHash, result)
          if (draft) {
            draftsGenerated++
            generatedDrafts[mail.id] = draft
            setAiDrafts((prev) => ({ ...prev, [mail.id]: draft }))
            recordBatchResult(mail, result, draft)
          }
        }
        setAnalysisProgress((p) => ({ ...p, drafts: p.drafts + draftsGenerated }))
        finalizeCurrentBatch(generatedDrafts)
        if (currentUserId && draftsGenerated > 0) {
          logActivity(currentUserId, 'mail', 'ai_reply_draft_generated', {
            workspaceId,
            summary: `生成了 ${draftsGenerated} 封邮件预回复`,
            metadata: { draftCount: draftsGenerated },
          })
        }
        setAnalysisStatus(hasFailed ? 'failed' : 'done')
      })()
    } else {
      finalizeCurrentBatch()
      setAnalysisStatus(hasFailed ? 'failed' : 'done')
    }

    // Auto-reset "done/failed" status after 8 s
    const timer = setTimeout(() => setAnalysisStatus((s) => (s === 'done' || s === 'failed' ? 'idle' : s)), 8_000)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWorkerRunning])

  /* ---- Public API: user-initiated "AI邮件分析" ---- */
  const triggerAnalysis = useCallback(async () => {
    // Clear previous queue
    queueRef.current = []
    workerActiveRef.current = false
    batchMailIdsRef.current = new Set()
    batchResultsRef.current = {}
    batchTriageResultsRef.current = {}
    setCurrentBatchResults([])
    setCurrentBatchSummary(null)

    const unreadMails = mails.filter((mail) => mail.unread && mail.folder !== 'sent' && mail.folder !== 'trash')
    if (unreadMails.length === 0) {
      setAnalysisProgress({ total: 0, cached: 0, enqueued: 0, running: 0, done: 0, drafts: 0, failed: 0 })
      setAnalysisStatus('idle')
      setIsWorkerRunning(false)
      setIsAnalyzingEmails(false)
      setCurrentAnalysisBatchId(null)
      currentBatchIdRef.current = null
      window.alert?.('当前没有需要分析的未读邮件。')
      return
    }

    const batchId = `mail-analysis-${Date.now()}`
    currentBatchIdRef.current = batchId
    batchMailIdsRef.current = new Set(unreadMails.map((mail) => mail.id))
    setCurrentAnalysisBatchId(batchId)
    setIsAnalyzingEmails(true)

    let cached = 0
    let enqueued = 0

    for (const mail of unreadMails) {
      const bodyHash = computeBodyHash(mail.body)

      // attachment-only mails: skip LLM entirely, mark as 'skipped'
      if (isAttachmentOnlyMail(mail)) {
        const existingCached = getCachedTriage(accountId, mail.id, bodyHash)
        if (existingCached?.status === 'success') {
          const linkedCached = await refreshCachedResult(mail, existingCached)
          // Respect a previous explicit analysis — don't downgrade to skipped
          recordBatchResult(mail, linkedCached)
        } else {
          const skippedResult = buildSkippedResult(mail, accountId, 'attachment_only')
          publishResult(skippedResult)
          recordBatchResult(mail, skippedResult)
        }
        cached++
        continue
      }

      // system delivery notices: skip LLM entirely
      if (isSystemDeliveryNotice(mail)) {
        const existingCached = getCachedTriage(accountId, mail.id, bodyHash)
        if (existingCached?.status === 'success') {
          const linkedCached = await refreshCachedResult(mail, existingCached)
          recordBatchResult(mail, linkedCached)
        } else {
          const skippedResult = buildSkippedResult(mail, accountId, 'system_delivery_notice')
          publishResult(skippedResult)
          recordBatchResult(mail, skippedResult)
        }
        cached++
        continue
      }

      // Try local rules first — instant classification, no LLM needed
      const localResult = applyLocalRules(mail, accountId)
      if (localResult) {
        const existingCached = getCachedTriage(accountId, mail.id, bodyHash)
        if (existingCached) {
          const linkedCached = await refreshCachedResult(mail, existingCached)
          recordBatchResult(mail, linkedCached)
        } else {
          const linkedLocal = await enrichWithCalendarEvent(mail, localResult)
          publishResult(linkedLocal)
          recordBatchResult(mail, linkedLocal)
        }
        cached++
        continue
      }

      // Check cache hit
      const cachedResult = getCachedTriage(accountId, mail.id, bodyHash)
      if (cachedResult) {
        const linkedCached = await refreshCachedResult(mail, cachedResult)
        recordBatchResult(mail, linkedCached)
        cached++
        continue
      }

      // Needs LLM — add to queue
      const job: MailTriageJob = {
        id: `${mail.id}-${Date.now()}`,
        accountId,
        messageId: mail.id,
        bodyHash,
        status: 'pending',
        retryCount: 0,
        createdAt: now(),
        updatedAt: now(),
      }
      queueRef.current.push(job)
      enqueued++
    }

    setAnalysisProgress({ total: unreadMails.length, cached, enqueued, running: 0, done: 0, drafts: 0, failed: 0 })
    setAnalysisStatus('running')
    setIsWorkerRunning(enqueued > 0)
    if (currentUserId) {
      logActivity(currentUserId, 'mail', 'ai_mail_analysis_started', {
        workspaceId,
        summary: `开始 AI 邮件分析：${unreadMails.length} 封邮件`,
        metadata: { total: unreadMails.length, cached, enqueued, batchId },
      })
    }

    if (enqueued > 0) {
      scheduleWorker(ACTIVE_POLL_MS)
    } else {
      // All from cache — immediately transition to done
      workerActiveRef.current = false
      // Trigger draft generation for qualifying cached results
      const mailMap = new Map(mails.map((m) => [m.id, m]))
      void (async () => {
        let draftsGenerated = 0
        const generatedDrafts: Record<string, AiMailReplyDraft> = {}
        for (const mailId of batchMailIdsRef.current) {
          const result = batchTriageResultsRef.current[mailId] ?? triageResults[mailId]
          if (!result) continue
          if (!qualifiesForDraft(result)) continue
          const mail = mailMap.get(mailId)
          if (!mail) continue
          const bodyHash = computeBodyHash(mail.body)
          if (hasAiDraft(accountId, mailId, bodyHash)) {
            const existing = getAiDraft(accountId, mailId, bodyHash)
            if (existing) {
              setAiDrafts((prev) => ({ ...prev, [mailId]: existing }))
              recordBatchResult(mail, result, existing)
            }
            continue
          }
          const draft = await generateDraftForMail(mail, result.accountId, bodyHash, result)
          if (draft) {
            draftsGenerated++
            generatedDrafts[mailId] = draft
            setAiDrafts((prev) => ({ ...prev, [mailId]: draft }))
            recordBatchResult(mail, result, draft)
          }
        }
        setAnalysisProgress((p) => ({ ...p, drafts: p.drafts + draftsGenerated }))
        finalizeCurrentBatch(generatedDrafts)
        if (currentUserId) {
          logActivity(currentUserId, 'mail', 'ai_mail_analysis_completed', {
            workspaceId,
            summary: `完成 AI 邮件分析：${unreadMails.length} 封邮件，生成 ${getMailTodos(accountId, workspaceId).length} 条待办`,
            metadata: { total: unreadMails.length, cached, enqueued, draftsGenerated, batchId },
          })
        }
        setAnalysisStatus('done')
        setTimeout(() => setAnalysisStatus((s) => (s === 'done' ? 'idle' : s)), 8_000)
      })()
    }
  }, [mails, triageResults, accountId, publishResult, recordBatchResult, finalizeCurrentBatch, scheduleWorker, currentUserId, workspaceId, enrichWithCalendarEvent, refreshCachedResult])

  /* ---- Public API: force-reclassify a single mail ---- */
  const enqueueMail = useCallback(
    (mailId: string) => {
      const mail = mails.find((m) => m.id === mailId)
      if (!mail) return
      const bodyHash = computeBodyHash(mail.body)
      // Remove existing job if any
      queueRef.current = queueRef.current.filter((j) => j.messageId !== mailId)
      const job: MailTriageJob = {
        id: `${mail.id}-${Date.now()}`,
        accountId,
        messageId: mailId,
        bodyHash,
        status: 'pending',
        retryCount: 0,
        createdAt: now(),
        updatedAt: now(),
      }
      queueRef.current.push(job)
      setAnalysisStatus('running')
      setIsWorkerRunning(true)
      scheduleWorker(ACTIVE_POLL_MS)
    },
    [mails, accountId, scheduleWorker],
  )

  /* ---- Public API: re-generate draft for a mail ---- */
  const regenerateDraft = useCallback(
    async (mailId: string) => {
      const mail = mails.find((m) => m.id === mailId)
      if (!mail) return
      const bodyHash = computeBodyHash(mail.body)
      const triage = triageResults[mailId]
      if (!triage) return
      const draft = await generateDraftForMail(mail, accountId, bodyHash, triage)
      if (draft) setAiDrafts((prev) => ({ ...prev, [mailId]: draft }))
    },
    [mails, triageResults, accountId],
  )

  /* ---- Public API: discard draft ---- */
  const discardDraft = useCallback(
    (mailId: string) => {
      setAiDrafts((prev) => {
        if (!prev[mailId]) return prev
        updateAiDraftStatus(accountId, mailId, prev[mailId].bodyHash, 'discarded')
        const next = { ...prev }
        delete next[mailId]
        return next
      })
    },
    [accountId],
  )

  const value = useMemo<MailTriageContextValue>(
    () => ({
      triageResults,
      aiDrafts,
      mailTodos,
      triggerAnalysis,
      enqueueMail,
      regenerateDraft,
      discardDraft,
      analysisStatus,
      analysisProgress,
      currentAnalysisBatchId,
      currentBatchResults,
      currentBatchSummary,
      isAnalyzingEmails,
      isWorkerRunning,
    }),
    [triageResults, aiDrafts, mailTodos, triggerAnalysis, enqueueMail, regenerateDraft, discardDraft, analysisStatus, analysisProgress, currentAnalysisBatchId, currentBatchResults, currentBatchSummary, isAnalyzingEmails, isWorkerRunning],
  )

  return <MailTriageContext.Provider value={value}>{children}</MailTriageContext.Provider>
}

/* ------------------------------------------------------------------ */
/*  Internal placeholder result builders                              */
/* ------------------------------------------------------------------ */

function buildPendingResult(
  job: MailTriageJob,
  mail: MailItem | undefined,
): AiMailTriageResult {
  return {
    messageId: job.messageId,
    accountId: job.accountId,
    bodyHash: job.bodyHash,
    category: 'unknown',
    priority: 'medium',
    needsReply: false,
    needsUserAction: false,
    canAutoArchive: false,
    riskLevel: 'none',
    summary: mail?.subject?.slice(0, 20) ?? '',
    reason: '',
    suggestedAction: '',
    status: 'pending',
    createdAt: job.createdAt,
    updatedAt: now(),
  }
}

function buildFailedResult(
  job: MailTriageJob,
  mail: MailItem,
  errorMessage: string,
): AiMailTriageResult {
  return {
    messageId: job.messageId,
    accountId: job.accountId,
    bodyHash: job.bodyHash,
    category: 'unknown',
    priority: 'medium',
    needsReply: false,
    needsUserAction: false,
    canAutoArchive: false,
    riskLevel: 'none',
    summary: mail.subject.slice(0, 20),
    reason: '',
    suggestedAction: '',
    status: 'failed',
    errorMessage,
    createdAt: job.createdAt,
    updatedAt: now(),
  }
}
