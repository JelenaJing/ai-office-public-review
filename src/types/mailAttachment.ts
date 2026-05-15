export type MailAttachmentOpenTarget = 'document' | 'spreadsheet' | 'presentation' | 'preview'

export interface MailAttachmentOpenRequest {
  messageId: string
  attachmentId?: string
  partId?: string
  fileName: string
  mimeType?: string
  source?: 'imap' | 'work-inbox'
  fixtureKey?: string
  subject?: string
  fromName?: string
  fromEmail?: string
  workspacePath?: string
}

export interface MailAttachmentSourceContext {
  source: 'mail-attachment'
  messageId: string
  subject: string
  fromName: string
  fromEmail: string
  originalAttachmentName: string
}

export type MailAttachmentOpenResult =
  | {
      ok: true
      filePath: string
      fileName: string
      mimeType: string
      openTarget: MailAttachmentOpenTarget
      sourceContext: MailAttachmentSourceContext
    }
  | {
      ok: false
      error: {
        message: string
        errorCode?: string
      }
    }
