/**
 * ImapEmailProvider — pure adapter that converts MailItem[] (from EmailContext)
 * into the unified CommunicationThread[] shape.
 *
 * All thread/message IDs are prefixed with "email:" to prevent collisions with
 * chat threads in CommunicationContext.
 *
 * No React hooks, no side-effects: this is just type conversion.
 */
import type { MailItem } from '../../types/email'
import type { CommunicationThread, CommunicationMessage } from '../types'

/** Prefix used for all email thread/message IDs. */
export const EMAIL_THREAD_PREFIX = 'email:'

/** Returns the full prefixed thread ID for a raw mail ID. */
export function toEmailThreadId(mailId: string): string {
  return mailId.startsWith(EMAIL_THREAD_PREFIX) ? mailId : `${EMAIL_THREAD_PREFIX}${mailId}`
}

/** Strips the "email:" prefix to recover the raw mail ID used by EmailContext. */
export function fromEmailThreadId(threadId: string): string {
  return threadId.startsWith(EMAIL_THREAD_PREFIX) ? threadId.slice(EMAIL_THREAD_PREFIX.length) : threadId
}

function mailToMessage(mail: MailItem): CommunicationMessage {
  const prefixedId = toEmailThreadId(mail.id)
  const isSent = mail.folder === 'sent'
  return {
    id: prefixedId,
    threadId: prefixedId,
    from: mail.from,
    fromName: mail.fromName,
    to: mail.to,
    toName: mail.toName,
    body: mail.body,
    htmlBody: mail.htmlBody,
    timestamp: mail.timestamp,
    isIncoming: !isSent,
    attachments: (mail.attachments ?? []).map((a) => ({
      id: `${prefixedId}::${a.filename}`,
      filename: a.filename,
      contentType: a.contentType,
      size: a.size,
      tempPath: a.tempPath,
    })),
    providerType: 'email',
  }
}

export function adaptMailsToThreads(mails: MailItem[], sourceAccount?: string): CommunicationThread[] {
  return mails.map((mail) => {
    const msg = mailToMessage(mail)
    const isSent = mail.folder === 'sent'
    const thread: CommunicationThread = {
      id: toEmailThreadId(mail.id),
      providerType: 'email' as const,
      subject: mail.subject,
      // For sent: participants[0] = recipient (the "other party" shown in list)
      participants: isSent ? [mail.to, mail.from] : [mail.from, mail.to],
      participantNames: isSent ? [mail.toName, mail.fromName] : [mail.fromName, mail.toName],
      lastMessage: msg,
      unread: mail.unread,
      hasAttachments: (mail.attachments?.length ?? 0) > 0,
      replied: mail.replied,
      messages: [msg],
      folder: mail.folder ?? 'inbox',
    }
    if (sourceAccount) thread.sourceAccount = sourceAccount
    return thread
  })
}
