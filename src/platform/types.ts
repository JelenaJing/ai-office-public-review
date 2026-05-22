export interface UserInfo {
  id: string
  email: string
  name: string
}

export interface AuthResult {
  token: string
  user: UserInfo
}

/**
 * Unified platform API — business components must use this instead of
 * calling window.electronAPI directly.
 *
 * Phase 1 surface: auth only.
 * Future phases will extend this interface with file I/O, AI generation, etc.
 */
export interface PlatformApi {
  /** Identifies the current runtime environment. */
  readonly platform: 'electron' | 'web'

  auth: {
    login(email: string, password: string): Promise<AuthResult>
    register(email: string, password: string, name: string): Promise<AuthResult>
    logout(): Promise<void>
    /** Returns the currently cached user, or null if not signed in. */
    getCurrentUser(): UserInfo | null
    /** Returns the JWT / session token, or null. */
    getToken(): string | null
  }
}
