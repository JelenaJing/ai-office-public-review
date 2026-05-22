/**
 * Email workbench data types.
 *
 * Extension points for real mail integration are marked with `// EXT:`.
 */

/* ------------------------------------------------------------------ */
/*  Core models                                                       */
/* ------------------------------------------------------------------ */

export interface MailAttachment {
  /** Original filename from the MIME message */
  filename: string
  /** MIME content type, e.g. "application/pdf" */
  contentType: string
  /** File size in bytes */
  size: number
  /** Absolute path to the cached copy on disk; valid for the session */
  tempPath: string
}

/** A file the user has chosen to attach to an outgoing reply */
export interface OutgoingAttachment {
  filename: string
  /** Absolute local file path (Electron renderer exposes File.path) */
  path: string
  size: number
  contentType: string
}

export interface MailItem {
  id: string
  from: string
  fromName: string
  to: string
  toName: string
  subject: string
  body: string
  /** Fully-resolved HTML version of the email body (inline CID images as data URIs) */
  htmlBody?: string
  timestamp: string
  unread: boolean
  replied: boolean
  threadId?: string
  isLoopback?: boolean
  /** Non-inline (regular) attachments extracted from the MIME message */
  attachments?: MailAttachment[]
  /** Which folder this mail came from */
  folder?: 'inbox' | 'sent' | 'trash' | 'spam'
  /** RFC 2822 Message-ID header value — used for In-Reply-To threading */
  messageId?: string
}

export type DraftStatus =
  | 'not_generated'
  | 'generating'
  | 'generated'
  | 'edited'
  | 'saved'
  | 'sending'
  | 'sent'
  | 'error'

export interface ReplyDraft {
  mailId: string
  content: string
  status: DraftStatus
  dirty: boolean
  /** Whether the user has ever touched the draft content manually. */
  userEdited: boolean
  generatedAt?: string
  savedAt?: string
  updatedAt?: string
  errorMessage?: string
  /** Files the user has attached to this outgoing reply */
  attachments?: OutgoingAttachment[]
}

export interface EmailReplyKnowledgeSelection {
  mailId: string
  knowledgeIds: string[]
  updatedAt: string
}

export interface EmailReplyKnowledgeSnippet {
  knowledgeId: string
  knowledgeName?: string
  sourceId?: string
  sourceTitle?: string
  text: string
  score?: number
}

export interface EmailReplyCalendarContext {
  hasTimeRequirement: boolean
  intentType?: string
  title?: string
  startTime?: string
  endTime?: string
  deadlineTime?: string
  location?: string
  candidateTimes?: Array<{
    startTime: string
    endTime?: string
    hasConflict?: boolean
  }>
  recommendedTime?: string
  conflictCount?: number
  hasConflict?: boolean
}

export interface EmailReplyTriageContext {
  summary?: string
  category?: string
  actionType?: string
  reason?: string
  suggestedAction?: string
  timeIntentTitle?: string
  timeIntentSourceText?: string
}

export interface EmailReplyGenerationOptions {
  knowledgeSnippets?: EmailReplyKnowledgeSnippet[]
  triageContext?: EmailReplyTriageContext
  calendarContext?: EmailReplyCalendarContext
  /** Internal callback fired by EmailContext after prompt is built, for trace instrumentation. */
  onPromptBuilt?: (meta: {
    knowledgeContextLength: number
    promptHasKnowledgeContext: boolean
    promptHasKnowledgeRequirement: boolean
  }) => void
}

export interface EmailReplyKnowledgeTrace {
  mailId: string
  createdAt: string

  selectedKnowledgeIds: string[]

  retrievalAttempted: boolean
  retrievedSnippetCount: number
  retrievedSnippetsPreview: Array<{
    knowledgeId: string
    sourceTitle?: string
    textPreview: string
    score?: number
  }>

  knowledgeContextLength: number
  promptHasKnowledgeContext: boolean
  promptHasKnowledgeRequirement: boolean

  draftGenerated: boolean
  draftLength: number

  likelyUsedKnowledge: boolean
  status:
    | 'not_selected'
    | 'selected_but_not_retrieved'
    | 'retrieved_but_not_in_prompt'
    | 'in_prompt_but_unclear_usage'
    | 'likely_used'
    | 'fallback_no_relevant_snippets'
    | 'error'

  reason: string
}

export interface SentMailRecord {
  id: string
  sourceMailId: string
  to: string
  toName: string
  subject: string
  body: string
  timestamp: string
}

/* ------------------------------------------------------------------ */
/*  Error classification (mirrored from Electron main for renderer)   */
/* ------------------------------------------------------------------ */

export type EmailErrorCode =
  | 'IMAP_CONNECT_FAILED'
  | 'IMAP_AUTH_FAILED'
  | 'SMTP_CONNECT_FAILED'
  | 'SMTP_AUTH_FAILED'
  | 'TLS_HANDSHAKE_FAILED'
  | 'AUTH_FAILED'
  | 'NETWORK_TIMEOUT'
  | 'TLS_CERT_ERROR'
  | 'IMAP_FETCH_FAILED'
  | 'SMTP_SEND_FAILED'
  | 'MIME_PARSE_ERROR'
  | 'UNKNOWN_ERROR'

export interface EmailConnectionCheckResult {
  ok: boolean
  protocol: 'imap' | 'smtp'
  message: string
  error?: {
    message: string
    code?: string
    command?: string
    responseCode?: number | string
    errorCode?: EmailErrorCode
  }
}

/* ------------------------------------------------------------------ */
/*  Email reply draft types                                           */
/* ------------------------------------------------------------------ */

export type EmailReplyTone = 'formal' | 'concise' | 'approval'

export interface ParsedEmailDraftContext {
  sender: string
  subject: string
  intent: string
  requested_points: string[]
  tone: string
  deadline: string | null
}

export interface EmailReplyDraft {
  subject: string
  to: string
  cc: string[]
  body: string
  signature: string
  toneVariant: EmailReplyTone
  generatedAt: string
  sourceMailId: string
  templateId: string
  templateTitle: string
  referenceTitles: string[]
  parsed: ParsedEmailDraftContext
}

/* ------------------------------------------------------------------ */
/*  Bulk email types                                                  */
/* ------------------------------------------------------------------ */

export interface BulkEmailRecipient {
  id: string
  name: string
  email: string
  department?: string
  position?: string
}

export type BulkEmailDraftStatus = 'draft' | 'ready' | 'sending' | 'sent' | 'failed'

export interface BulkEmailDraft {
  id: string
  recipient: BulkEmailRecipient
  subject: string
  body: string
  status: BulkEmailDraftStatus
  error?: string
}

/* ------------------------------------------------------------------ */
/*  Real email account config                                         */
/* ------------------------------------------------------------------ */

/** Provider type discriminant for the email account. */
export type EmailProviderType =
  | 'local_mailcow'
  | 'school_cuhk_exchange_imap_smtp'
  | 'student_link_m365'

export interface EmailAccountConfig {
  user: string
  password: string
  displayName: string
  imapHost: string
  imapPort: number
  imapSecure: boolean
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  /** IMAP/SMTP auth username when different from email address (e.g. internal servers) */
  username?: string
  /** Convenience alias for user (email address) */
  email?: string
  /** 'internal-imap' for self-hosted mailcow/iRedMail; omitted for public providers */
  providerType?: string
  /** Structured provider type — used for school/student account routing */
  provider?: EmailProviderType
  /**
   * Reference key for credential stored in safeStorage (e.g. the email address).
   * When set, the actual password is NOT in this config; it is retrieved at runtime
   * from the OS keychain via CredentialService.
   */
  credentialRef?: string
  /**
   * 'same_as_login' → From address must equal the authenticated account.
   * Prevents sender spoofing for school Exchange accounts.
   */
  fromPolicy?: 'same_as_login'
  /** Successful IMAP encryption mode detected during auto-probe */
  imapEncryption?: 'none' | 'starttls' | 'ssl'
  /** Successful SMTP encryption mode detected during auto-probe */
  smtpEncryption?: 'none' | 'starttls' | 'ssl'
  /** When true, SMTP STARTTLS negotiation is disabled (nodemailer ignoreTLS) */
  smtpIgnoreTls?: boolean
  /** Disable TLS certificate verification — dev/test environments only */
  allowSelfSignedCerts?: boolean
  /** AccountCenter user ID — used for user isolation; only present on internal-imap configs */
  ownerUserId?: string
  /** AccountCenter username — used for debug display */
  ownerUsername?: string
  /** SMTP STARTTLS */
  smtpStartTls?: boolean
  /** Webmail URL */
  webmailUrl?: string
  /** Human-readable label */
  label?: string
}

export interface EmailAccountPreset {
  label: string
  imapHost: string
  imapPort: number
  imapSecure: boolean
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
}

export interface CustomEmailPreset extends EmailAccountPreset {
  isCustom: true
  createdAt: string
}

export interface EmailDomainProbeResult {
  ok: boolean
  imapHost?: string
  imapPort?: number
  imapSecure?: boolean
  smtpHost?: string
  smtpPort?: number
  smtpSecure?: boolean
  message?: string
}

export const EMAIL_ACCOUNT_PRESETS: EmailAccountPreset[] = [
  {
    label: 'Gmail',
    imapHost: 'imap.gmail.com', imapPort: 993, imapSecure: true,
    smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpSecure: true,
  },
  {
    label: 'QQ邮箱',
    imapHost: 'imap.qq.com', imapPort: 993, imapSecure: true,
    smtpHost: 'smtp.qq.com', smtpPort: 465, smtpSecure: true,
  },
  {
    label: '腾讯企业邮',
    imapHost: 'imap.exmail.qq.com', imapPort: 993, imapSecure: true,
    smtpHost: 'smtp.exmail.qq.com', smtpPort: 465, smtpSecure: true,
  },
  {
    label: '163邮箱',
    imapHost: 'imap.163.com', imapPort: 993, imapSecure: true,
    smtpHost: 'smtp.163.com', smtpPort: 465, smtpSecure: true,
  },
  {
    label: 'Outlook',
    imapHost: 'outlook.office365.com', imapPort: 993, imapSecure: true,
    smtpHost: 'smtp-mail.outlook.com', smtpPort: 587, smtpSecure: false,
  },
]

let _seq = Date.now()
export const uid = () => `mail-${(++_seq).toString(36)}-${Math.random().toString(36).slice(2, 6)}`
