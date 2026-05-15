/**
 * Unified Communication Workbench — shared type definitions.
 *
 * These types are intentionally separate from the email-specific types in
 * src/types/email.ts to avoid naming conflicts (e.g. ReplyDraft).
 */

/* ------------------------------------------------------------------ */
/*  Core enumerations                                                  */
/* ------------------------------------------------------------------ */

export type ProviderType = 'email' | 'chat'

export type CommFilter =
  | 'all'
  | 'email'
  | 'sent'
  | 'trash'
  | 'chat'
  | 'unread'
  | 'has-attachment'

export type CommDraftStatus =
  | 'not_generated'
  | 'generating'
  | 'generated'
  | 'edited'
  | 'saving'
  | 'saved'
  | 'sending'
  | 'sent'
  | 'error'

export type CommTone = 'formal' | 'friendly' | 'concise' | 'professional'

/* ------------------------------------------------------------------ */
/*  Data models                                                        */
/* ------------------------------------------------------------------ */

export interface CommunicationAttachment {
  id: string
  filename: string
  contentType: string
  size: number
  /** Absolute path to a cached local copy (if available) */
  tempPath?: string
}

export interface CommunicationMessage {
  id: string
  threadId: string
  from: string
  fromName: string
  /** Primary recipient email address (populated for email threads) */
  to?: string
  /** Primary recipient display name (populated for email threads) */
  toName?: string
  body: string
  htmlBody?: string
  timestamp: string
  /** true = received from the other party; false = sent by current user */
  isIncoming: boolean
  attachments: CommunicationAttachment[]
  providerType: ProviderType
  /* ---- Chat / Matrix media fields ---- */
  /** msgtype from Matrix (m.text | m.image | m.file | …) */
  chatMsgtype?: string
  /** mxc:// URI for Matrix media messages */
  mxcUrl?: string
  /** MIME type (for image/file messages) */
  mimetype?: string
  /** File size in bytes */
  fileSize?: number
  /** Image pixel width */
  imageWidth?: number
  /** Image pixel height */
  imageHeight?: number
}

export interface CommunicationThread {
  id: string
  providerType: ProviderType
  /** Email subject line OR the chat partner's display name */
  subject: string
  participants: string[]
  participantNames: string[]
  lastMessage: CommunicationMessage | null
  unread: boolean
  hasAttachments: boolean
  replied: boolean
  messages: CommunicationMessage[]
  /** Which IMAP folder this email came from (email threads only) */
  folder?: 'inbox' | 'sent' | 'trash' | 'spam'
  /** Email address of the account that owns this thread — used for user-isolation validation */
  sourceAccount?: string
}

export interface CommunicationReplyDraft {
  threadId: string
  content: string
  status: CommDraftStatus
  dirty: boolean
  userEdited: boolean
  attachments: Array<{
    filename: string
    path: string
    size: number
    contentType: string
  }>
  generatedAt?: string
  updatedAt?: string
  errorMessage?: string
}

/* ------------------------------------------------------------------ */
/*  Provider interface (for future real providers)                     */
/* ------------------------------------------------------------------ */

export interface SendMessagePayload {
  threadId: string
  content: string
  attachments?: Array<{ filename: string; path: string }>
}

export interface CommunicationProvider {
  readonly providerType: ProviderType
  listThreads(): CommunicationThread[]
  getThread(threadId: string): CommunicationThread | null
  sendMessage(payload: SendMessagePayload): Promise<void>
  markAsRead(threadId: string): void
  downloadAttachment?(messageId: string, attachmentId: string): Promise<void>
}

/* ------------------------------------------------------------------ */
/*  AI Reply Service input                                             */
/* ------------------------------------------------------------------ */

export interface AIReplyInput {
  providerType: ProviderType
  thread: CommunicationThread
  targetMessage: CommunicationMessage
  responderName?: string
  responderAddress?: string
  knowledgeContext?: string
  tone?: CommTone
}
