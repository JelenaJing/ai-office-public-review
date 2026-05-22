/**
 * AccountCenter 内部账号类型定义
 */

export interface ServiceBinding {
  service: string
  externalId?: string
  status: 'active' | 'suspended' | 'not_created' | string
  syncStatus?: 'synced' | 'pending' | 'failed' | string
  metadata?: Record<string, unknown>
  createdAt?: string
  updatedAt?: string
}

export type InternalAccountSessionSource = 'account-center' | 'mailbox-fallback'

export interface InternalAccountUser {
  id: string
  username: string
  displayName: string
  email: string
  roles: string[]
  permissions?: string[]
  status: 'active' | 'disabled' | string
  mustChangePassword: boolean
}

export interface InternalAccountSession {
  token: string
  source: InternalAccountSessionSource
  user: InternalAccountUser
  bindings?: {
    mail?: ServiceBinding
    matrix?: ServiceBinding
    office?: ServiceBinding
  }
  /** Explicit bindings loading state — prevents infinite "loading" when fetch fails */
  bindingsPhase?: 'loading' | 'success' | 'error'
  bindingsError?: string
  /** Auto email initialization status after AccountCenter login */
  emailAutoStatus?: 'applying' | 'applied' | 'error'
  emailAutoError?: string
}

export type InternalAccountState =
  | { phase: 'restoring' }  // startup: validating stored token
  | { phase: 'idle' }       // no session, show login gate
  | { phase: 'loading' }    // login form submitting
  | { phase: 'logged_in'; session: InternalAccountSession }
  | { phase: 'must_change_password'; session: InternalAccountSession }  // first login: force password change
  | { phase: 'error'; message: string }
