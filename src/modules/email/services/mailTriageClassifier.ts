/**
 * Mail Triage Classifier — classifies emails using local rules first,
 * then falls back to batch LLM calls for the remainder.
 *
 * Rules:
 * 1. Local-rule pass: noreply / newsletter / promotion → instant classification
 * 2. Remaining unread mails → batch LLM call (≤ BATCH_SIZE per call)
 * 3. LLM must return strict JSON array, no Markdown
 *
 * Uses window.electronAPI.writingAssistant (the same IPC channel as the
 * existing AI pre-reply feature) — no new LLM client created.
 */
import type { MailItem } from '../../../types/email'
import type {
  AiEmailActionPlan,
  AiEmailCategory,
  AiEmailImportance,
  AiEmailIntentType,
  AiEmailReplyIntent,
  AiEmailTargetWorkspace,
  AiEmailTodo,
  AiEmailTodoType,
  AiEmailUrgency,
  AiMailTriageResult,
  EmailTimeIntent,
} from '../../../types/mailTriage'
import { computeBodyHash } from './mailTriageCache'
import { stripThinkTags } from '../../../utils/StreamThinkFilter'
import { inferRelativeChineseDateTimeFromText } from '../../../calendar/chineseDateTimeParser'
export { stripThinkTags }

export const BATCH_SIZE = 5
const MAX_BODY_LENGTH = 800
type AiEmailAttachmentAction = NonNullable<AiEmailActionPlan['attachmentActions']>[number]

/* ------------------------------------------------------------------ */
/*  Local-rule patterns                                                */
/* ------------------------------------------------------------------ */

const LOW_PRIORITY_SENDER = [
  /noreply/i, /no-reply/i, /donotreply/i, /do-not-reply/i,
  /newsletter/i, /automated/i, /mailer-daemon/i,
  /postmaster/i, /bounce/i, /notification@/i, /alert@/i,
  /support@/i,
]

const PROMOTION_SUBJECT = [
  /unsubscribe/i, /newsletter/i, /promotional/i,
  /marketing/i, /advertisement/i, /special.?offer/i,
  /取消订阅/i, /退订/i, /营销/i, /广告/i, /促销/i,
]

const SYSTEM_LOGIN = [
  /login.alert/i, /security.alert/i, /sign.in.alert/i,
  /登录提醒/i, /登录通知/i, /账号登录/i, /安全提醒/i, /登录验证/i,
]

const RISK_SIGNALS = [
  /phishing/i, /your.account.*suspended/i, /verify.*immediately/i,
  /账户被封/i, /立即验证/i, /钓鱼/i, /密码泄露/i,
]

/**
 * Action verbs that indicate the recipient is expected to perform a task.
 * Used both in local fast-path classification and injected into the LLM prompt
 * to prevent short task sentences from being mis-classified as `unknown`.
 */
export const ACTION_VERB_PATTERNS: RegExp[] = [
  /\b(organize|arrange|prepare|coordinate|confirm|submit|handle|process|follow.?up|push|complete|lead|liaise|notify|invite|convene)\b/i,
  /组织|安排|准备|整理|跟进|协调|确认|提交|补充|处理|推进|完成|负责|对接|通知|邀请|召开/,
]

/** Task-related nouns that strengthen action-required classification. */
const TASK_NOUN_PATTERNS: RegExp[] = [
  /宣讲会|会议|研讨会|活动|汇报|审批|报销|合同|材料|方案|计划|报告|培训|讲座/,
  /meeting|workshop|seminar|event|presentation|approval|reimbursement|contract|material|plan|report|training/i,
]

/**
 * Keywords that prevent a mail from being treated as attachment-only,
 * even when it has attachments and a short body.
 * Any of these signals that the attachment needs specific action.
 */
const ATTACHMENT_ACTION_BLOCKERS: RegExp[] = [
  /请查看|请修改|请反馈|请签署|请确认|请回传|请处理|请审阅|请审批|修改后发回/,
  /截止|尽快|今天|明天/,
  /please\s+(review|revise|sign|confirm|send\s+back|handle|process)/i,
  /\b(feedback|deadline|urgent)\b/i,
  /by\s+(friday|tomorrow|monday|eod|cob|tonight|end\s+of\s+day)/i,
]

/* ------------------------------------------------------------------ */
/*  System delivery notice detection                                  */
/* ------------------------------------------------------------------ */

const SYSTEM_FROM_PATTERNS: RegExp[] = [
  /mailer-daemon/i,
  /postmaster@/i,
  /mail-daemon/i,
  /no-?reply@.*mailer/i,
  /delivery.status/i,
  /bounce\+|noreply\+bounce/i,
]

const SYSTEM_SUBJECT_PATTERNS: RegExp[] = [
  /undelivered\s+mail/i,
  /delivery\s+status\s+notification/i,
  /mail\s+delivery\s+(failed|error|subsystem)/i,
  /returned\s+to\s+sender/i,
  /non.?deliverable/i,
  /permanent\s+failure/i,
  /failure\s+notice/i,
  /delivery\s+failure/i,
  /bounce\s+message/i,
  /未送达|邮件退回|无法投递|退信通知/i,
]

const SYSTEM_BODY_PATTERNS: RegExp[] = [
  /could not be delivered|failed permanently|user unknown|no such user/i,
  /sender is unauthenticated|sender not authorized/i,
  /spf\s+(fail|reject|softfail)/i,
  /dkim\s+(fail|invalid)/i,
  /dmarc\s+policy/i,
  /the following addresses had permanent delivery errors/i,
  /your message to .* was automatically rejected/i,
  /this\s+message\s+was\s+created\s+automatically\s+by\s+mail\s+delivery\s+software/i,
]

/**
 * Returns true when a mail is a system-generated delivery notification (bounce,
 * SPF/DKIM failure, MAILER-DAEMON, etc.) that the user should not reply to.
 *
 * These mails should skip LLM analysis and suppress the pre-reply composer.
 */
export function isSystemDeliveryNotice(mail: MailItem): boolean {
  const from = (mail.from + ' ' + (mail.fromName || '')).toLowerCase()
  if (SYSTEM_FROM_PATTERNS.some((p) => p.test(from))) return true

  const subject = mail.subject
  if (SYSTEM_SUBJECT_PATTERNS.some((p) => p.test(subject))) return true

  // Only check body keywords if from/subject are suggestive (avoid false positives)
  const subjectLower = subject.toLowerCase()
  const mightBeSystem =
    /delivery|undelivered|bounce|daemon|postmaster|mailer/i.test(subjectLower) ||
    /delivery|undelivered|bounce|daemon|postmaster|mailer/i.test(from)
  if (mightBeSystem) {
    const body = mail.body
    if (SYSTEM_BODY_PATTERNS.some((p) => p.test(body))) return true
  }

  return false
}

/**
 * Returns true when a mail is purely a file-transfer with no actionable content.
 *
 * Conditions for attachment-only:
 *  1. Mail has at least one attachment.
 *  2. Body is empty or very short (≤ 80 chars after trimming).
 *  3. Neither subject nor body contains any action keyword that would require
 *     the recipient to review / approve / respond with a deadline.
 *
 * Mails that fail any condition are NOT attachment-only and should proceed
 * through the normal AI triage pipeline as 'attachment_review'.
 */
export function isAttachmentOnlyMail(mail: MailItem): boolean {
  if (!mail.attachments?.length) return false

  const body = mail.body.trim()
  // A body longer than 80 chars likely contains content worth analysing
  if (body.length > 80) return false

  const text = `${mail.subject}\n${body}`.toLowerCase()
  if (ATTACHMENT_ACTION_BLOCKERS.some((p) => p.test(text))) return false

  return true
}

/* ------------------------------------------------------------------ */
/*  Local keyword → task plan templates                                */
/* ------------------------------------------------------------------ */

interface TaskTemplate {
  match: RegExp
  tasks: string[]
}

/**
 * Ordered list: first matching template wins.
 * Keys should be specific before generic (e.g. 宣讲会 before 会议).
 */
const TASK_PLAN_TEMPLATES: TaskTemplate[] = [
  {
    match: /宣讲会|宣讲/,
    tasks: [
      '撰写宣讲内容稿',
      '制作宣讲 PPT',
      '联系相关人员确认参会',
      '确认宣讲时间与场地',
      '回复对方并同步进展',
    ],
  },
  {
    match: /研讨会|论坛/,
    tasks: [
      '确定研讨主题与议程',
      '邀请参会嘉宾或同事',
      '预订会议室 / 在线会议链接',
      '准备研讨材料',
      '回复对方确认安排',
    ],
  },
  {
    match: /复盘|回顾|总结会/,
    tasks: [
      '收集各方反馈与数据',
      '整理项目复盘提纲',
      '召集相关人员确认时间',
      '准备复盘文档',
    ],
  },
  {
    match: /汇报|汇报材料/,
    tasks: [
      '整理汇报所需数据',
      '撰写汇报文档 / PPT',
      '内部评审草稿',
      '确认汇报时间与受众',
    ],
  },
  {
    match: /报销/,
    tasks: [
      '整理报销凭证和发票',
      '填写报销申请表',
      '获取主管签字',
      '提交财务审批',
    ],
  },
  {
    match: /审批|合同/,
    tasks: [
      '整理待审批文件',
      '提交审批流程',
      '跟进审批进度',
      '回复对方确认结果',
    ],
  },
  {
    match: /会议|开会/,
    tasks: [
      '确认会议时间和地点',
      '准备会议议程',
      '通知参会人员',
      '会后整理会议纪要',
    ],
  },
  {
    match: /活动|培训/,
    tasks: [
      '制定活动方案',
      '联系场地和参与人员',
      '准备活动材料',
      '确认时间并通知相关方',
    ],
  },
  {
    match: /数据|统计|整理/,
    tasks: [
      '收集原始数据',
      '整理并核对数据',
      '生成数据报告',
      '发送给相关方审阅',
    ],
  },
]

/**
 * Generate a local task plan based on keyword matching.
 * Returns null if no template matches (LLM will fill in).
 */
function buildLocalTaskPlan(text: string): string[] | undefined {
  for (const t of TASK_PLAN_TEMPLATES) {
    if (t.match.test(text)) return t.tasks
  }
  return undefined
}

/**
 * Local fast-path for short task sentences.
 * Called AFTER all negative filters (spam/system/promo/risk).
 * Returns action_required if the email body/subject contains a clear task verb
 * targeting a concrete object. Falls back to null (→ LLM) when ambiguous.
 */
function detectLocalTaskIntent(
  mail: MailItem,
  accountId: string,
): AiMailTriageResult | null {
  const text = `${mail.subject}\n${mail.body.slice(0, 600)}`
  const hasActionVerb = ACTION_VERB_PATTERNS.some((p) => p.test(text))
  if (!hasActionVerb) return null
  const hasTaskNoun = TASK_NOUN_PATTERNS.some((p) => p.test(text))
  // Only classify locally when verb + noun both appear (clearer signal).
  // Without a task noun, let LLM decide for a more nuanced result.
  if (!hasTaskNoun) return null
  // Use body snippet as summary when subject is empty
  const summary = (mail.subject.trim() || mail.body.trim()).slice(0, 20)
  const suggestedTasks = buildLocalTaskPlan(text)
  return baseResult(mail, accountId, {
    category: 'action_required',
    priority: 'medium',
    needsReply: true,
    needsUserAction: true,
    canAutoArchive: false,
    summary,
    reason: '包含明确任务动词和任务对象',
    suggestedAction: '确认任务细节并跟进处理',
    suggestedTasks,
  })
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const now = () => new Date().toISOString()

function normalizeText(mail: MailItem): string {
  return `${mail.subject}\n${mail.body}`.toLowerCase()
}

function inferUrgency(mail: MailItem, deadline?: string): AiEmailUrgency {
  const text = normalizeText(mail)
  if (deadline || /urgent|asap|today|tonight|马上|立刻|紧急|今天|截止/.test(text)) return 'urgent'
  if (/tomorrow|by friday|尽快|明天|本周|周五|下周一/.test(text)) return 'soon'
  if (/会议|安排|确认|回复|submit|confirm|meeting/.test(text)) return 'normal'
  return 'none'
}

function inferEmailCategory(mail: MailItem, triage: Pick<AiMailTriageResult, 'category' | 'riskLevel' | 'needsUserAction' | 'needsReply' | 'priority'>): AiEmailCategory {
  const text = normalizeText(mail)
  const from = mail.from.toLowerCase()
  if (triage.category === 'promotion') return 'promotion'
  if (triage.category === 'risk' || triage.riskLevel === 'high') return 'spam'
  if (/meeting|会议|seminar|研讨会|邀请/.test(text)) return 'meeting_invitation'
  if (/审批|批准|确认|approve|approval/.test(text)) return 'approval_request'
  if (/docx|word|文档|修改|审阅|review|附件/.test(text) && (mail.attachments?.length ?? 0) > 0) return 'document_review'
  if (/xlsx|csv|数据|报表|统计|excel|report/.test(text)) return 'data_report_request'
  if (/学生|同学|选课|退课|申请|导师|研究生|student|course|late drop|deadline/.test(text)) return 'student_request'
  if (/项目|进展|同步|update|progress/.test(text)) return 'project_update'
  if (triage.needsUserAction) return 'task_assignment'
  if (/教务|学院|学校|通知|admin|office/.test(text) || /\.edu(\.cn)?$/.test(from)) return 'internal_notice'
  if (triage.category === 'read_only' || triage.category === 'archive_candidate') return 'system_notice'
  if (triage.needsReply) return 'colleague_collaboration'
  return 'ordinary'
}

function noTimeIntent(): EmailTimeIntent {
  return {
    hasTimeRequirement: false,
    type: 'none',
    confidence: 0,
    needsUserConfirmation: false,
  }
}

function defaultEndTime(startTime: string, minutes: number): string | undefined {
  const start = new Date(startTime)
  if (!Number.isFinite(start.getTime())) return undefined
  const end = new Date(start)
  end.setMinutes(end.getMinutes() + minutes)
  return end.toISOString()
}

function isIsoLike(value: string | undefined): boolean {
  if (!value) return false
  return Number.isFinite(new Date(value).getTime())
}

function optString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function hasConcreteTime(intent: EmailTimeIntent | undefined): boolean {
  if (!intent?.hasTimeRequirement) return false
  return Boolean(intent.startTime || intent.deadlineTime || intent.candidateTimes?.length)
}

function inferLocationFromText(text: string): string | undefined {
  const explicit = text.match(/(?:地点|会议地点)[：:\s]*([^。\n；;,，]+)/)
  if (explicit?.[1]?.trim()) return explicit[1].trim().replace(/^在\s*/, '')

  const inLocation = text.match(/在([^。\n；;,，]+?(?:会议室|办公室|报告厅|教室|Zoom|线上会议|腾讯会议|飞书会议))/i)
  if (inLocation?.[1]?.trim()) return inLocation[1].trim()

  return undefined
}

function inferMeetingLinkFromText(text: string): string | undefined {
  return text.match(/https?:\/\/\S+/i)?.[0]
}

function cleanupSubjectTitle(subject: string): string {
  return subject
    .replace(/^关于/, '')
    .replace(/的?(通知|邀请|安排|确认|提醒|请求)$/u, '')
    .replace(/^(明天|后天|本周[一二三四五六日天]|下周[一二三四五六日天])/, '')
    .trim()
}

function inferTitleFromText(text: string, fallbackTitle?: string): string | undefined {
  const bodyTitle =
    text.match(/召开([^。\n；;,，]*(?:筹备会议|协调会|同步会|宣讲会|沟通会议|会议|面试|沟通))/)?.[1] ||
    text.match(/参加([^。\n；;,，]*(?:筹备会议|协调会|同步会|宣讲会|沟通会议|会议|面试|沟通))/)?.[1]
  if (bodyTitle?.trim()) return bodyTitle.trim()

  const cleaned = fallbackTitle ? cleanupSubjectTitle(fallbackTitle) : ''
  return cleaned || fallbackTitle
}

function inferIntentTypeFromText(text: string, input?: EmailTimeIntent): EmailTimeIntent['type'] {
  if (/截止|请在|需在|前提交|提交|反馈|回传|报销材料/.test(text)) return 'deadline'
  if (/面试|interview/i.test(text)) return 'interview'
  if (/候选时间|哪个时间|哪个.*方便|周[一二三四五六日天].*周[一二三四五六日天]|available|availability/i.test(text)) return 'candidate_times'
  if (/会议|筹备会|协调会|宣讲会|沟通会议|线上同步|约谈|appointment|meeting/i.test(text)) return 'meeting'
  return input?.type && input.type !== 'none' ? input.type : 'appointment'
}

export function normalizeEmailTimeIntent(
  input: EmailTimeIntent | undefined,
  mailText: string,
  nowValue = new Date(),
  fallbackTitle?: string,
): EmailTimeIntent | undefined {
  const text = mailText.trim()
  const inferred = inferRelativeChineseDateTimeFromText(text, nowValue)
  const localType = inferIntentTypeFromText(text, input)
  const shouldTreatAsDeadline = localType === 'deadline' && Boolean(inferred.deadlineTime || inferred.startTime)
  const startTime = input?.startTime || (!shouldTreatAsDeadline ? inferred.startTime : undefined)
  const deadlineTime = input?.deadlineTime || (shouldTreatAsDeadline ? inferred.deadlineTime || inferred.startTime : undefined)
  const type: EmailTimeIntent['type'] = shouldTreatAsDeadline
    ? 'deadline'
    : startTime
      ? (localType === 'deadline' ? 'meeting' : localType)
      : input?.type && input.type !== 'none'
        ? input.type
        : /找个时间|约个时间|安排时间|方便的时候|约时间/.test(text)
          ? 'follow_up'
          : 'none'

  const hasLocalTime = Boolean(startTime || deadlineTime || input?.candidateTimes?.length)
  if (!hasLocalTime && /找个时间|约个时间|安排时间|方便的时候|约时间|下周.*聊/.test(text)) {
    return {
      hasTimeRequirement: true,
      type: 'follow_up',
      title: inferTitleFromText(text, fallbackTitle),
      confidence: Math.max(input?.confidence ?? 0, 0.55),
      needsUserConfirmation: true,
      sourceText: input?.sourceText,
    }
  }

  if (!input?.hasTimeRequirement && !hasLocalTime && type === 'none') {
    return undefined
  }

  if (!hasLocalTime && (type === 'none' || !input?.hasTimeRequirement)) {
    return undefined
  }

  if (!hasLocalTime && input?.hasTimeRequirement) {
    return {
      ...input,
      type: input.type === 'follow_up' || input.type === 'appointment' ? input.type : 'follow_up',
      needsUserConfirmation: true,
    }
  }

  const durationMinutes = type === 'interview' ? 30 : 60
  const normalizedStart = type === 'deadline' ? undefined : startTime
  const normalizedEnd =
    type === 'deadline'
      ? undefined
      : input?.endTime || inferred.endTime || (normalizedStart ? defaultEndTime(normalizedStart, durationMinutes) : undefined)

  return {
    ...input,
    hasTimeRequirement: true,
    type,
    title: input?.title || inferTitleFromText(text, fallbackTitle),
    description: input?.description,
    startTime: normalizedStart,
    endTime: normalizedEnd,
    timezone: input?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
    location: input?.location || inferLocationFromText(text),
    meetingLink: input?.meetingLink || inferMeetingLinkFromText(text),
    attendees: input?.attendees,
    candidateTimes: input?.candidateTimes,
    deadlineTime,
    confidence: Math.max(input?.confidence ?? 0, inferred.matchedText ? 0.75 : 0.55),
    needsUserConfirmation: true,
    sourceText: input?.sourceText || inferred.matchedText,
  }
}

function normalizeTimeIntent(raw: unknown, mail: MailItem): EmailTimeIntent {
  const mailText = `${mail.subject}\n${mail.body}`
  if (!raw || typeof raw !== 'object') {
    return normalizeEmailTimeIntent(undefined, mailText, new Date(), mail.subject) ?? noTimeIntent()
  }
  const item = raw as Record<string, unknown>
  const allowedTypes: EmailTimeIntent['type'][] = [
    'meeting',
    'interview',
    'deadline',
    'reminder',
    'appointment',
    'candidate_times',
    'follow_up',
    'none',
  ]
  const type = allowedTypes.includes(item.type as EmailTimeIntent['type'])
    ? (item.type as EmailTimeIntent['type'])
    : 'none'
  const hasTimeRequirement = Boolean(item.hasTimeRequirement) && type !== 'none'
  if (!hasTimeRequirement) {
    return normalizeEmailTimeIntent(undefined, mailText, new Date(), mail.subject) ?? noTimeIntent()
  }

  const startTime = optString(item.startTime)
  const endTime = optString(item.endTime)
  const deadlineTime = optString(item.deadlineTime)
  const candidateTimes = Array.isArray(item.candidateTimes)
    ? item.candidateTimes
        .map((candidate) => {
          if (!candidate || typeof candidate !== 'object') return null
          const c = candidate as Record<string, unknown>
          const candidateStart = optString(c.startTime)
          if (!isIsoLike(candidateStart)) return null
          return {
            startTime: candidateStart,
            endTime: isIsoLike(optString(c.endTime)) ? optString(c.endTime) : undefined,
            timezone: optString(c.timezone),
          }
        })
        .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
        .slice(0, 6)
    : undefined

  const attendees = Array.isArray(item.attendees)
    ? item.attendees
        .map((attendee) => {
          if (!attendee || typeof attendee !== 'object') return null
          const a = attendee as Record<string, unknown>
          const name = optString(a.name)
          const email = optString(a.email)
          if (!name && !email) return null
          return { name, email }
        })
        .filter((attendee): attendee is NonNullable<typeof attendee> => Boolean(attendee))
        .slice(0, 20)
    : undefined

  const hasStructuredConcreteTime =
    (type === 'deadline' && isIsoLike(deadlineTime)) ||
    (type === 'candidate_times' && Boolean(candidateTimes?.length)) ||
    (type !== 'deadline' && type !== 'candidate_times' && type !== 'follow_up' && isIsoLike(startTime))
  const isFollowUp = type === 'follow_up'

  const confidenceRaw = typeof item.confidence === 'number' ? item.confidence : 0.7
  const normalized = normalizeEmailTimeIntent({
    hasTimeRequirement: true,
    type,
    title: optString(item.title) || mail.subject || undefined,
    description: optString(item.description),
    startTime: isIsoLike(startTime) ? startTime : undefined,
    endTime: isIsoLike(endTime) ? endTime : undefined,
    timezone: optString(item.timezone),
    location: optString(item.location),
    meetingLink: optString(item.meetingLink),
    attendees,
    candidateTimes,
    deadlineTime: isIsoLike(deadlineTime) ? deadlineTime : undefined,
    confidence: Math.max(0, Math.min(1, confidenceRaw)),
    needsUserConfirmation: item.needsUserConfirmation !== false || !hasStructuredConcreteTime,
    sourceText: optString(item.sourceText),
  }, mailText, new Date(), mail.subject)

  if (!normalized) return noTimeIntent()
  if (!hasConcreteTime(normalized) && !isFollowUp && normalized.type !== 'follow_up') return noTimeIntent()
  return normalized
}

function inferTimeIntent(mail: MailItem, result: Pick<AiMailTriageResult, 'timeIntent' | 'deadline' | 'emailCategory' | 'needsReply' | 'needsUserAction'>): EmailTimeIntent {
  const normalized = normalizeTimeIntent(result.timeIntent, mail)
  if (normalized.hasTimeRequirement) return normalized

  const text = `${mail.subject}\n${mail.body}`
  const localNormalized = normalizeEmailTimeIntent(undefined, text, new Date(), mail.subject)
  if (localNormalized?.hasTimeRequirement) return localNormalized

  if (result.deadline && isIsoLike(result.deadline)) {
    return {
      hasTimeRequirement: true,
      type: 'deadline',
      title: mail.subject || '截止事项',
      deadlineTime: result.deadline,
      confidence: 0.65,
      needsUserConfirmation: true,
      sourceText: result.deadline,
    }
  }
  if (/面试|interview/i.test(text) && /时间|安排|schedule|slot/i.test(text)) {
    return {
      hasTimeRequirement: true,
      type: 'follow_up',
      title: mail.subject || '面试安排',
      confidence: 0.55,
      needsUserConfirmation: true,
    }
  }
  if ((result.emailCategory === 'meeting_invitation' || /会议|meeting|appointment|约时间|候选时间|available|availability/i.test(text)) && (result.needsReply || result.needsUserAction)) {
    return {
      hasTimeRequirement: true,
      type: 'follow_up',
      title: mail.subject || '日程安排',
      confidence: 0.5,
      needsUserConfirmation: true,
    }
  }
  return noTimeIntent()
}

function inferTodoType(mail: MailItem, task: string, category: AiEmailCategory): AiEmailTodoType {
  const text = `${task}\n${mail.subject}\n${mail.body}`.toLowerCase()
  if (/回复|回信|reply/.test(text)) return 'reply_email'
  if (/附件|修改|文档|docx|word|审阅/.test(text) || category === 'document_review') return 'edit_document'
  if (/上传|提交|材料|upload|submit/.test(text)) return 'upload_file'
  if (/确认|确认信息|confirm/.test(text)) return 'confirm_information'
  if (/会议|日程|安排|meeting|schedule/.test(text)) return 'schedule_meeting'
  if (/审批|批准|拒绝|approve|reject/.test(text)) return 'approve_or_reject'
  if (/数据|报表|统计|excel|xlsx|csv/.test(text)) return 'analyze_data'
  if (/转发|forward/.test(text)) return 'forward_to_others'
  if ((mail.attachments?.length ?? 0) > 0) return 'review_attachment'
  return 'prepare_material'
}

function inferTargetWorkspace(todoType: AiEmailTodoType, mail: MailItem): AiEmailTargetWorkspace {
  const text = `${mail.subject}\n${mail.body}`.toLowerCase()
  if (todoType === 'edit_document' || /\.docx?/.test(text)) return 'document'
  if (/pptx|ppt|演示|presentation/.test(text)) return 'ppt'
  if (todoType === 'analyze_data' || /xlsx|csv|excel|数据|报表/.test(text)) return 'excel'
  if (todoType === 'reply_email') return 'mail'
  return 'none'
}

function inferReplyIntent(mail: MailItem, category: AiEmailCategory, needsReply: boolean): AiEmailReplyIntent {
  const text = normalizeText(mail)
  if (!needsReply) return 'none'
  if (/附件|材料|上传|提交|attach|file/.test(text)) return 'send_attachment'
  if (category === 'document_review') return 'submit_revision'
  if (category === 'approval_request') return 'direct_answer'
  if (/无法|不能|拒绝|decline|reject/.test(text)) return 'reject_or_decline'
  if (/补充|不清楚|更多信息|more information/.test(text)) return 'ask_for_more_information'
  if (/收到|确认收到|received/.test(text)) return 'acknowledge_received'
  if (/政策|流程|申请|deadline|规定/.test(text)) return 'explain_policy'
  return 'direct_answer'
}

function buildKnowledgeQueries(mail: MailItem, category: AiEmailCategory): string[] {
  const queries = new Set<string>()
  const compactSubject = mail.subject.replace(/\s+/g, ' ').trim()
  if (compactSubject) queries.add(compactSubject.slice(0, 80))
  const text = `${mail.subject}\n${mail.body}`
  const patterns: Array<[RegExp, string]> = [
    [/late drop|退课|选课|课程/i, '课程退课申请流程 截止时间'],
    [/报销|发票|合同|验收/i, '报销材料 审批流程'],
    [/中期考核|研究生|导师/i, '研究生中期考核材料要求'],
    [/政策|流程|申请|审批/i, '政策流程申请审批要求'],
    [/deadline|截止/i, '截止时间 办理要求'],
  ]
  for (const [regex, query] of patterns) {
    if (regex.test(text)) queries.add(query)
  }
  if ((category === 'student_request' || category === 'approval_request') && queries.size < 2) {
    queries.add(`${mail.subject} 办理流程`)
  }
  return [...queries].slice(0, 4)
}

function buildAnalysisTodos(
  mail: MailItem,
  triage: Pick<AiMailTriageResult, 'priority' | 'deadline' | 'suggestedTasks' | 'needsReply' | 'needsUserAction'>,
  category: AiEmailCategory,
): AiEmailTodo[] {
  const tasks = triage.suggestedTasks?.length
    ? triage.suggestedTasks
    : [
        ...(triage.needsReply ? ['回复来信'] : []),
        ...(triage.needsUserAction ? [triage.suggestedTasks?.[0] || triage.deadline ? '处理邮件事项' : '跟进邮件事项'] : []),
      ].filter(Boolean)

  const unique = [...new Set(tasks.map((task) => String(task).trim()).filter(Boolean))].slice(0, 5)
  return unique.map((title, index) => {
    const type = inferTodoType(mail, title, category)
    return {
      id: `${mail.id}:${computeBodyHash(`${title}:${index}`).slice(0, 8)}`,
      title,
      description: undefined,
      type,
      priority: triage.priority as AiEmailImportance,
      deadline: triage.deadline ?? null,
      sourceEmailId: mail.id,
      targetWorkspace: inferTargetWorkspace(type, mail),
      status: 'pending',
      createdAt: now(),
      updatedAt: now(),
    }
  })
}

function deriveIntentType(
  mail: MailItem,
  emailCategory: AiEmailCategory,
  result: Pick<AiMailTriageResult, 'needsReply' | 'needsUserAction' | 'requiresOpenAttachment'>,
): AiEmailIntentType {
  const text = `${mail.subject}\n${mail.body}`.toLowerCase()
  if (emailCategory === 'spam' || emailCategory === 'promotion') return 'spam'
  if (emailCategory === 'meeting_invitation') return 'meeting'
  if (emailCategory === 'approval_request') return 'approval'
  if (emailCategory === 'document_review' || result.requiresOpenAttachment) return 'attachment_review'
  if (/批准|审批|同意|拒绝|确认是否|approve|approval|reject/i.test(text)) return 'approval'
  if (/请提供|请发送|需要.*(材料|文件|数据|信息|确认)|协助|provide|send.*(file|data|material)|need.*(file|data|info)/i.test(text)) return 'request'
  if (/请问|如何|是否|能否|为什么|what|how|could you explain|question/i.test(text)) return 'question'
  if (/通知|公告|提醒|安排说明|notice|notification|announcement/i.test(text)) return 'notice'
  if (emailCategory === 'student_request') return 'question'
  if (emailCategory === 'task_assignment' || (result.needsUserAction && !result.needsReply)) return 'task'
  if (emailCategory === 'data_report_request') return 'request'
  if (emailCategory === 'internal_notice' || emailCategory === 'system_notice') return 'notice'
  if (result.needsUserAction) return 'task'
  if (result.needsReply) return 'question'
  return 'ordinary'
}

function deriveReplyTone(emailCategory: AiEmailCategory): AiEmailActionPlan['replyStrategy']['tone'] {
  if (emailCategory === 'student_request' || emailCategory === 'approval_request') return 'formal'
  if (emailCategory === 'colleague_collaboration' || emailCategory === 'project_update') return 'concise'
  if (emailCategory === 'meeting_invitation') return 'friendly'
  if (emailCategory === 'spam' || emailCategory === 'promotion') return 'neutral'
  return 'formal'
}

function buildActionPlan(
  mail: MailItem,
  opts: {
    emailCategory: AiEmailCategory
    requiresOpenAttachment: boolean
    requiresKnowledgeBase: boolean
    needsReply: boolean
    needsUserAction: boolean
    suggestedTasks?: string[]
    deadline?: string
    suggestedReplyPrompt?: string
    suggestedAction: string
    summary: string
  },
): AiEmailActionPlan {
  const intentType = deriveIntentType(mail, opts.emailCategory, {
    needsReply: opts.needsReply,
    needsUserAction: opts.needsUserAction,
    requiresOpenAttachment: opts.requiresOpenAttachment,
  })
  const tone = deriveReplyTone(opts.emailCategory)
  const hashSlice = (s: string) => computeBodyHash(s).slice(0, 8)

  const plan: AiEmailActionPlan = {
    intentType,
    title: opts.summary || mail.subject.slice(0, 40),
    brief: opts.suggestedAction || '',
    replyStrategy: {
      shouldReply: opts.needsReply,
      tone,
      reason: opts.suggestedAction || (opts.needsReply ? '对方需要回复' : '无需回复'),
    },
  }

  if (intentType === 'task') {
    const tasks = opts.suggestedTasks?.length ? opts.suggestedTasks : [opts.suggestedAction || '处理邮件事项']
    plan.taskChecklist = tasks.map((text, i) => ({
      id: hashSlice(`task:${i}:${text}`),
      text,
      done: false,
      deadline: i === 0 ? (opts.deadline ?? null) : null,
    }))
  }

  if (intentType === 'attachment_review' && mail.attachments?.length) {
    plan.attachmentActions = mail.attachments.map((att) => {
      const fn = att.filename.toLowerCase()
      const action: AiEmailAttachmentAction['action'] =
        /\.(docx?|xlsx?|pptx?)$/.test(fn) ? 'review' : 'read'
      const targetWorkspace: AiEmailAttachmentAction['targetWorkspace'] =
        /\.docx?$/.test(fn)
          ? 'document'
          : /\.pptx?$/.test(fn)
            ? 'ppt'
            : /\.xlsx?|\.csv$/.test(fn)
              ? 'excel'
              : 'preview'
      return { fileName: att.filename, action, targetWorkspace, note: '请查看并处理附件' }
    })
  }

  if (intentType === 'notice') {
    plan.noticeSummary = {
      keyPoints: opts.suggestedTasks?.slice(0, 4) ?? [opts.summary],
      needFollowUp: opts.needsReply || opts.needsUserAction,
      followUpReason: opts.needsReply ? opts.suggestedAction : undefined,
    }
  }

  if (intentType === 'question') {
    plan.questionAnswer = {
      question: mail.subject,
      answerDraft: opts.suggestedReplyPrompt || '',
      usedKnowledgeBase: false,
      knowledgeMissing: opts.requiresKnowledgeBase,
    }
  }

  if (intentType === 'request') {
    const items = opts.suggestedTasks?.length ? opts.suggestedTasks : [opts.suggestedAction].filter(Boolean)
    plan.requestItems = items.map((text, i) => ({
      id: hashSlice(`req:${i}:${text}`),
      text: text || '',
      required: true,
    }))
  }

  return plan
}

function enrichResult(mail: MailItem, result: AiMailTriageResult): AiMailTriageResult {
  const emailCategory = inferEmailCategory(mail, result)
  const urgency = inferUrgency(mail, result.deadline)
  const requiresAttachment = /附件|材料|上传|提交|attach|file/i.test(`${mail.subject}\n${mail.body}`) || Boolean(mail.attachments?.length)
  const requiresOpenAttachment = Boolean(mail.attachments?.some((att) =>
    /\.(docx|pptx|xlsx|csv|pdf|md|txt)$/i.test(att.filename),
  )) || emailCategory === 'document_review' || emailCategory === 'data_report_request'
  const requiresKnowledgeBase =
    emailCategory === 'student_request' ||
    emailCategory === 'approval_request' ||
    /政策|流程|申请|规定|deadline|late drop|退课|报销|中期考核/i.test(`${mail.subject}\n${mail.body}`)
  const suggestedKnowledgeQueries = requiresKnowledgeBase ? buildKnowledgeQueries(mail, emailCategory) : []
  const riskFlags = [
    ...(result.riskLevel !== 'none' ? [`风险等级：${result.riskLevel}`] : []),
    ...(emailCategory === 'spam' ? ['疑似垃圾或风险邮件'] : []),
  ]
  const requiresReply = result.needsReply
  const requiresAction = result.needsUserAction || requiresAttachment || requiresOpenAttachment
  const timeIntent = inferTimeIntent(mail, { ...result, emailCategory })

  return {
    ...result,
    emailCategory,
    importance: result.priority,
    urgency,
    requiresReply,
    requiresAction,
    requiresKnowledgeBase,
    requiresAttachment,
    requiresOpenAttachment,
    suggestedKnowledgeQueries,
    todos: buildAnalysisTodos(mail, result, emailCategory),
    replyIntent: inferReplyIntent(mail, emailCategory, requiresReply),
    timeIntent,
    riskFlags,
    analyzedAt: result.updatedAt || now(),
    actionPlan: buildActionPlan(mail, {
      emailCategory,
      requiresOpenAttachment,
      requiresKnowledgeBase,
      needsReply: requiresReply,
      needsUserAction: result.needsUserAction,
      suggestedTasks: result.suggestedTasks,
      deadline: result.deadline,
      suggestedReplyPrompt: result.suggestedReplyPrompt,
      suggestedAction: result.suggestedAction,
      summary: result.summary,
    }),
  }
}

function baseResult(
  mail: MailItem,
  accountId: string,
  overrides: Partial<AiMailTriageResult>,
): AiMailTriageResult {
  const result: AiMailTriageResult = {
    messageId: mail.id,
    threadId: mail.threadId,
    accountId,
    bodyHash: computeBodyHash(mail.body),
    category: 'unknown',
    priority: 'medium',
    needsReply: false,
    needsUserAction: false,
    canAutoArchive: true,
    riskLevel: 'none',
    summary: mail.subject.slice(0, 20),
    reason: '',
    suggestedAction: '无需处理',
    status: 'success',
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  }
  return enrichResult(mail, result)
}

/**
 * Apply local heuristic rules.
 * Returns a complete AiMailTriageResult if the mail can be classified
 * without LLM, or null if the mail should be queued for LLM analysis.
 */
export function applyLocalRules(
  mail: MailItem,
  accountId: string,
): AiMailTriageResult | null {
  const from = mail.from.toLowerCase()
  const subject = mail.subject
  const bodySnippet = mail.body.slice(0, 500)

  // Risk signals take priority
  if (RISK_SIGNALS.some((p) => p.test(subject) || p.test(bodySnippet))) {
    return baseResult(mail, accountId, {
      category: 'risk',
      priority: 'high',
      riskLevel: 'high',
      needsUserAction: true,
      canAutoArchive: false,
      reason: '包含风险特征',
      suggestedAction: '谨慎查看，勿点击链接',
    })
  }

  // Low-priority senders (noreply / bots)
  if (LOW_PRIORITY_SENDER.some((p) => p.test(from))) {
    const isPromo = PROMOTION_SUBJECT.some((p) => p.test(subject) || p.test(bodySnippet))
    return baseResult(mail, accountId, {
      category: isPromo ? 'promotion' : 'archive_candidate',
      priority: 'low',
      reason: '系统/自动化邮件',
      suggestedAction: '可直接归档',
    })
  }

  // Promotion subject lines
  if (PROMOTION_SUBJECT.some((p) => p.test(subject))) {
    return baseResult(mail, accountId, {
      category: 'promotion',
      priority: 'low',
      reason: '广告/营销内容',
      suggestedAction: '可归档或退订',
    })
  }

  // System login alerts
  if (SYSTEM_LOGIN.some((p) => p.test(subject) || p.test(bodySnippet))) {
    return baseResult(mail, accountId, {
      category: 'read_only',
      priority: 'low',
      reason: '系统登录提醒',
      suggestedAction: '确认后归档',
    })
  }

  // Fast-path: local task intent detection (verb + noun both present)
  // This handles cases where LLM is unavailable or as a safety net.
  const taskResult = detectLocalTaskIntent(mail, accountId)
  if (taskResult) return taskResult

  return null // Needs LLM
}

/* ------------------------------------------------------------------ */
/*  LLM batch classification                                           */
/* ------------------------------------------------------------------ */

function buildMailSnippet(mail: MailItem): string {
  const body =
    mail.body.length > MAX_BODY_LENGTH
      ? mail.body.slice(0, MAX_BODY_LENGTH) + '...[截断]'
      : mail.body
  const attachments =
    mail.attachments?.length
      ? `附件: ${mail.attachments.map((a) => a.filename).join(', ')}`
      : ''
  return [
    `主题: ${mail.subject}`,
    `发件人: ${mail.fromName || ''} <${mail.from}>`,
    `收件人: ${mail.toName || ''} <${mail.to}>`,
    `时间: ${mail.timestamp}`,
    attachments,
    `正文:\n${body}`,
  ]
    .filter(Boolean)
    .join('\n')
}

function buildBatchPrompt(mails: MailItem[]): string {
  const currentDateTimeIso = new Date().toISOString()
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
  const blocks = mails
    .map((mail, i) => `[邮件${i + 1}]\n${buildMailSnippet(mail)}`)
    .join('\n\n---\n\n')
  return `你是邮件分类专家。请对以下${mails.length}封邮件进行批量分类分析。

当前日期时间：${currentDateTimeIso}
当前时区：${timezone}

请结合当前日期和当前时区解析邮件中的相对时间表达。
如果邮件中出现“明天、后天、本周五、下周一、下周三、明天下午 3 点、明天下午 3 点到 4 点、下周三下午 3 点、下周三下午 3 点到 4 点、本周五下午 5 点前”等表达，必须尽量转换成 ISO 8601 时间字符串。
如果邮件中存在明确日期/星期/时间组合，不允许只输出 follow_up；必须输出 hasTimeRequirement=true，并根据语义输出 meeting / interview / deadline / appointment / candidate_times，以及 startTime 或 deadlineTime。没有结束时间时：meeting 默认 60 分钟，interview 默认 30 分钟，appointment 默认 60 分钟。
模糊约时间（如“下周找个时间聊一下”）可以输出 follow_up 或 appointment，needsUserConfirmation=true，但不要伪造具体 startTime。

严格返回一个 JSON 数组，长度必须等于邮件数量（${mails.length}），顺序与输入一致。
不要输出任何 Markdown、代码块标记或解释文字，只输出纯 JSON 数组。

【关键规则 — 短句任务识别】
你必须识别短句任务。即使邮件没有正式标题、没有截止日期、没有问号，只要正文中包含明显任务动词，
例如"组织、安排、准备、整理、跟进、协调、确认、提交、处理、推进、完成、负责、对接、通知、邀请、召开"等，
并且对象明确（如宣讲会、会议、活动、材料、审批、报销、合同等），就必须判断为 action_required，
而不是 unknown 或 read_only。对于此类邮件，needsReply 和 needsUserAction 均应为 true。

【分类指导】
- action_required：对方要求收件人执行某项任务（含上述任务动词）
- reply_required：对方提出问题或请求，等待收件人回复
- read_only：仅为通知，无需收件人操作或回复
- archive_candidate：可直接归档，无实质内容
- promotion：营销/广告/订阅类
- risk：疑似钓鱼/诈骗
- unknown：完全无法判断意图（仅在内容极度模糊时使用，不得滥用）

【自动判断要求】
- 自动判断是否需要知识库、回复语气和回复结构，不要把这些选择交给用户。
- 任务型输出可执行任务；需求型输出对方要的材料/信息/确认项；询问型提示是否涉及政策/流程依据；通知型不要强行生成长回复；附件处理型说明附件应阅读、审阅、修改、签署或回传；审批型必须谨慎提示人工确认。

每个元素的字段（全部必填，无值的字符串字段用空字符串 ""）：
{
  "category": "action_required" | "reply_required" | "read_only" | "archive_candidate" | "promotion" | "risk" | "unknown",
  "priority": "high" | "medium" | "low",
  "needsReply": boolean,
  "needsUserAction": boolean,
  "canAutoArchive": boolean,
  "riskLevel": "none" | "low" | "medium" | "high",
  "summary": "摘要（20字以内）",
  "reason": "分类理由（30字以内）",
  "suggestedAction": "建议操作（20字以内）",
  "deadline": "截止日期YYYY-MM-DD或空字符串",
  "timeIntent": {
    "hasTimeRequirement": boolean,
    "type": "meeting" | "interview" | "deadline" | "reminder" | "appointment" | "candidate_times" | "follow_up" | "none",
    "title": "日程标题或空字符串",
    "description": "补充说明或空字符串",
    "startTime": "明确开始时间ISO字符串或空字符串",
    "endTime": "明确结束时间ISO字符串或空字符串",
    "timezone": "时区或空字符串",
    "location": "地点或空字符串",
    "meetingLink": "会议链接或空字符串",
    "attendees": [{"name":"姓名或空字符串","email":"邮箱或空字符串"}],
    "candidateTimes": [{"startTime":"ISO字符串","endTime":"ISO字符串或空字符串","timezone":"时区或空字符串"}],
    "deadlineTime": "截止时间ISO字符串或空字符串",
    "confidence": 0到1之间数字,
    "needsUserConfirmation": boolean,
    "sourceText": "触发时间判断的原文片段或空字符串"
  },
  "senderRole": "发件人角色（10字以内）",
  "detectedIntent": "邮件意图（15字以内）",
  "suggestedReplyPrompt": "回复提示（30字以内）",
  "suggestedTasks": ["子任务1（≤20字）", "子任务2", "..."]
}

suggestedTasks 规则：
- category = "action_required" 时必须提供，列出 2-5 个具体可执行的子任务步骤
- 对方索要材料、数据、文件、信息或确认时，也可列出 1-5 个需求项
- 其他 category 时返回空数组 []
- 每项子任务应为简洁的动宾短语，例如：
  "撰写宣讲内容稿"、"制作宣讲 PPT"、"联系相关人员确认参会"、"确认时间与场地"

timeIntent 规则：
- 普通邮件必须返回 {"hasTimeRequirement": false, "type": "none", "confidence": 0, "needsUserConfirmation": false}。
- 明确会议提取 title、startTime、endTime、location、attendees；面试安排 type = "interview"。
- 截止事项 type = "deadline"，提取 deadlineTime；不要把截止事项当会议。
- 多候选时间 type = "candidate_times"，提取 candidateTimes。
- 模糊约时间但无具体时间 type = "follow_up"，needsUserConfirmation = true。
- 时间尽量输出 ISO 字符串；不确定具体时间时不要编造 startTime、endTime 或 deadlineTime。

邮件列表：

${blocks}`
}

function extractTopLevelJsonArray(raw: string): string | null {
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = 0; index < raw.length; index += 1) {
    const ch = raw[index]

    if (escaped) {
      escaped = false
      continue
    }

    if (ch === '\\') {
      escaped = inString
      continue
    }

    if (ch === '"') {
      inString = !inString
      continue
    }

    if (inString) continue

    if (ch === '[') {
      if (depth === 0) start = index
      depth += 1
      continue
    }

    if (ch === ']') {
      if (depth === 0) continue
      depth -= 1
      if (depth === 0 && start >= 0) {
        return raw.slice(start, index + 1)
      }
    }
  }

  return null
}

function parseJsonArrayCandidate(raw: string): unknown {
  const parsed = JSON.parse(raw) as unknown
  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>
    const wrapped = record.results ?? record.items ?? record.data ?? record.output
    if (Array.isArray(wrapped)) return wrapped
  }
  return parsed
}

function parseLLMResponse(
  raw: string,
  mails: MailItem[],
  accountId: string,
): AiMailTriageResult[] {
  const cleaned = stripThinkTags(raw).trim()
  // Strip markdown code fences if present
  const jsonText = cleaned
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/m, '')
    .trim()

  let parsed: unknown
  const candidates = [jsonText]
  const extractedJsonArray = extractTopLevelJsonArray(jsonText)
  if (extractedJsonArray && extractedJsonArray !== jsonText) {
    candidates.push(extractedJsonArray)
  }

  let lastError: unknown = null
  for (const candidate of candidates) {
    try {
      parsed = parseJsonArrayCandidate(candidate)
      lastError = null
      break
    } catch (error) {
      lastError = error
    }
  }

  if (lastError !== null) {
    throw new Error(`LLM 返回无效 JSON: ${jsonText.slice(0, 120)}`)
  }

  if (!Array.isArray(parsed)) {
    throw new Error('LLM 未返回数组')
  }

  const ts = now()
  return mails.map((mail, i) => {
    const item = (parsed[i] ?? {}) as Record<string, unknown>
    const bodyHash = computeBodyHash(mail.body)

    const validCategory = (v: unknown): AiMailTriageResult['category'] => {
      const allowed: AiMailTriageResult['category'][] = [
        'action_required', 'reply_required', 'read_only',
        'archive_candidate', 'promotion', 'risk', 'unknown',
      ]
      return allowed.includes(v as AiMailTriageResult['category'])
        ? (v as AiMailTriageResult['category'])
        : 'unknown'
    }
    const validPriority = (v: unknown): AiMailTriageResult['priority'] => {
      const allowed: AiMailTriageResult['priority'][] = ['high', 'medium', 'low']
      return allowed.includes(v as AiMailTriageResult['priority'])
        ? (v as AiMailTriageResult['priority'])
        : 'medium'
    }
    const validRisk = (v: unknown): AiMailTriageResult['riskLevel'] => {
      const allowed: AiMailTriageResult['riskLevel'][] = ['none', 'low', 'medium', 'high']
      return allowed.includes(v as AiMailTriageResult['riskLevel'])
        ? (v as AiMailTriageResult['riskLevel'])
        : 'none'
    }
    const optStr = (v: unknown): string | undefined =>
      typeof v === 'string' && v.trim() ? v.trim() : undefined

    // Parse suggestedTasks: only meaningful for action_required
    const parsedTasks = item.suggestedTasks
    const suggestedTasks: string[] | undefined =
      Array.isArray(parsedTasks) && parsedTasks.length > 0
        ? (parsedTasks as unknown[])
            .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
            .slice(0, 5)
        : undefined

    return enrichResult(mail, {
      messageId: mail.id,
      threadId: mail.threadId,
      accountId,
      bodyHash,
      category: validCategory(item.category),
      priority: validPriority(item.priority),
      needsReply: Boolean(item.needsReply),
      needsUserAction: Boolean(item.needsUserAction),
      canAutoArchive: Boolean(item.canAutoArchive),
      riskLevel: validRisk(item.riskLevel),
      summary: typeof item.summary === 'string' ? item.summary.slice(0, 30) : mail.subject.slice(0, 20),
      reason: typeof item.reason === 'string' ? item.reason.slice(0, 50) : '',
      suggestedAction: typeof item.suggestedAction === 'string' ? item.suggestedAction.slice(0, 30) : '',
      deadline: optStr(item.deadline),
      timeIntent: normalizeTimeIntent(item.timeIntent, mail),
      senderRole: optStr(item.senderRole),
      detectedIntent: optStr(item.detectedIntent),
      suggestedReplyPrompt: optStr(item.suggestedReplyPrompt),
      suggestedTasks,
      status: 'success' as const,
      createdAt: ts,
      updatedAt: ts,
    })
  })
}

/**
 * Classify a batch of mails using the existing LLM IPC channel.
 * Throws on failure — caller is responsible for error handling.
 */
export async function classifyMailsBatch(
  mails: MailItem[],
  accountId: string,
  signal?: AbortSignal,
): Promise<AiMailTriageResult[]> {
  if (mails.length === 0) return []

  const prompt = buildBatchPrompt(mails)

  // Use writingAssistant IPC directly for a synchronous JSON response.
  // This is the same underlying call as runWritingAssistant — no new LLM client.
  const text = await new Promise<string>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const ipc = window.electronAPI.writingAssistant({
      instruction: prompt,
      language: 'zh',
    } as Record<string, unknown>)

    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'))
    signal?.addEventListener('abort', onAbort, { once: true })
    ipc
      .then((res) => { signal?.removeEventListener('abort', onAbort); resolve(res) })
      .catch((err) => { signal?.removeEventListener('abort', onAbort); reject(err) })
  })

  return parseLLMResponse(text, mails, accountId)
}
