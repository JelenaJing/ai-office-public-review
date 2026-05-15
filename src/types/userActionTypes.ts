/**
 * Renderer-side types for user action activity logging.
 * These mirror the types in electron/main/services/userActionLogService.ts
 * but are usable from the renderer process.
 */

export type UserActionSyncStatus = 'pending' | 'synced' | 'failed'

export interface UserActionLogEntry {
  id: string
  localId: string
  userId: string
  module: string
  action: string
  title?: string
  summary: string
  createdAt: string
  syncStatus: UserActionSyncStatus
  retryCount?: number
  lastSyncError?: string
  eventType: string
  sessionId?: string
  startedAt?: string
  endedAt?: string
  durationMs?: number
  status: 'success' | 'failed' | 'cancelled'
  targetType?: string
  targetId?: string
  targetTitle?: string
  details?: Record<string, unknown>
  errorCode?: string
  errorMessage?: string
}

export interface LogUserActionPayload {
  userId: string
  module: string
  action: string
  title?: string
  summary?: string
  eventType?: string
  sessionId?: string
  startedAt?: string
  endedAt?: string
  durationMs?: number
  status?: 'success' | 'failed' | 'cancelled'
  targetType?: string
  targetId?: string
  targetTitle?: string
  details?: Record<string, unknown>
  errorCode?: string
  errorMessage?: string
  localId?: string
}
