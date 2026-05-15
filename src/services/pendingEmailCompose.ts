/**
 * pendingEmailCompose — module-level singleton for cross-section compose handoff.
 *
 * When a user clicks "发邮件" in the address book (ChatWindow, which has no EmailProvider),
 * the contact is stored here. App.tsx then navigates to the workspace email section
 * (CommunicationWorkbench, which wraps EmailProvider), and CommunicationWorkbench
 * consumes the pending contact and opens ComposeModal with the pre-filled recipient.
 */

export interface PendingComposeRecipient {
  email: string
  displayName?: string
  personId?: string
  mailboxStatus?: string
  fromDirectory?: boolean
}

let _pending: PendingComposeRecipient | null = null

export function setPendingCompose(recipient: PendingComposeRecipient): void {
  _pending = recipient
}

/** Consume (read and clear) the pending compose recipient. Returns null if none. */
export function consumePendingCompose(): PendingComposeRecipient | null {
  const data = _pending
  _pending = null
  return data
}
