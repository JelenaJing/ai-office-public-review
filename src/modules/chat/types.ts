export interface ChatConversation {
  id: string
  conversation_type: 'direct' | 'group'
  title: string | null
  created_by: string
  created_by_username?: string
  created_at: string
  updated_at: string
  message_count?: number | string
  /** Total member count returned by the server (preferred over members.length) */
  member_count?: number
  members?: Array<{ userId: string; username: string; role: string }>
  /** Conversation lifecycle status. 'dissolved' = group permanently dissolved; members can no longer send messages. */
  status?: 'active' | 'dissolved'
}

/** A user that can be contacted, returned by GET /api/chat/contacts or /api/contacts */
export interface ChatContact {
  id: string
  username: string
  displayName?: string
  email?: string
  departmentId?: string | null
  /** Department display name */
  departmentName?: string
  /** Job title / position */
  position?: string
  /** ID of this user's direct manager */
  managerId?: string | null
  /** Server-supplied: true if the current viewer can generate a daily report for this contact */
  canViewWorkReport?: boolean
  roles?: string[]
  status: 'active' | 'disabled'
  /** Avatar background color (hex or CSS color). If absent, a stable color is derived from the user id/username. */
  avatarColor?: string
  /** URL of a custom avatar image. If provided, shown instead of the initials circle. */
  avatarUrl?: string
  /** Human-readable role label (e.g. "高级工程师", "产品经理"). */
  roleLabel?: string
  /** Personal bio / about text. */
  bio?: string
}

/** Org relationship from the current viewer's perspective */
export type OrgRelation = 'self' | 'direct_report' | 'peer' | 'manager' | 'unrelated'

/** Returns the org relation of `target` relative to `viewerId`. */
export function getOrgRelation(target: ChatContact, viewerId: string): OrgRelation {
  if (target.id === viewerId) return 'self'
  if (target.managerId === viewerId) return 'direct_report'
  return 'unrelated'
}

/**
 * Returns true if the viewer can generate a daily report for this contact.
 *
 * Permission source: server-supplied fields on the contact object.
 * Accepts both camelCase and snake_case variants returned by different API endpoints.
 * The `allowAll` parameter is kept for backward compatibility but is no longer the
 * primary gate — real permission always comes from the backend fields.
 */
export function canGenerateDailyReport(
  contact: ChatContact & Record<string, unknown>,
  viewerId: string,
  allowAll = false,
): boolean {
  if (contact.id === viewerId) return false
  if (contact.status !== 'active') return false
  // Demo / dev mode: any active non-self user
  if (allowAll) return true
  // Check all backend-supplied permission field variants
  return Boolean(
    contact.canViewWorkReport ||
    contact.canGenerateDailyReport ||
    (contact as Record<string, unknown>).can_view_work_report ||
    (contact as Record<string, unknown>).can_generate_daily_report,
  )
}

export interface ChatAttachment {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
  /** URL for inline preview (images) */
  previewUrl?: string
  /** URL for downloading the file */
  downloadUrl: string
}

export interface ChatMessage {
  id: string
  /** Canonical camelCase fields — always populated after normalizeChatMessage() */
  conversationId: string
  senderId: string
  senderUsername: string
  senderDisplayName?: string
  messageType: 'text' | 'image' | 'file'
  body: string
  attachmentId: string | null
  createdAt: string
  /** Nested attachment object */
  attachment?: ChatAttachment
}

// ─── Work Activity Log ───────────────────────────────────────────────────────

export type WorkActivityModule =
  | 'document'
  | 'mail'
  | 'chat'
  | 'ppt'
  | 'image'
  | 'data'
  | 'knowledge'
  | 'delegation'
  | 'system'

export interface WorkActivityLog {
  /** Local unique ID (used as dedup key on server). Stable across retries. */
  localId: string
  /** Server-assigned ID, populated after successful sync. */
  id: string
  userId: string
  workspaceId?: string
  module: WorkActivityModule
  action: string
  title?: string
  summary?: string
  metadata?: Record<string, unknown>
  createdAt: string
  /** Sync lifecycle: pending → synced | failed */
  syncStatus?: 'pending' | 'synced' | 'failed'
  serverId?: string
  syncedAt?: string
  lastSyncError?: string
}

// ─── Daily Report ────────────────────────────────────────────────────────────

export interface GeneratedDailyReport {
  id: string
  targetUserId: string
  targetUsername: string
  generatedByUserId: string
  date: string
  sections: {
    mainWork: string[]
    communication: string[]
    artifacts: string[]
    followUps: string[]
    risks: string[]
  }
  rawSummary: string
  createdAt: string
}
