/**
 * FeatureSessionStore
 * Lightweight localStorage-backed store for per-feature workspace state.
 * This is NOT a "task center" — it's state persistence so each feature area
 * retains its current work when the user navigates away and comes back.
 */

/** Maps to the internal GenerationMode / workspace panel key. */
export type FeatureKey =
  | 'document'
  | 'ppt'
  | 'image'
  | 'mail'
  | 'daily-report'
  | 'homework'
  | 'ai-class'
  | 'ai-forum'
  | 'paper'

/** Serialisable snapshot of one feature area's working session. */
export interface FeatureSession {
  id: string
  feature: FeatureKey
  workspaceId: string

  title: string
  /** 'editing' | 'generating' | 'completed' | 'failed' */
  status: 'editing' | 'generating' | 'completed' | 'failed'

  inputSnapshot: unknown
  outputSnapshot?: unknown

  createdAt: string
  updatedAt: string
  completedAt?: string

  errorMessage?: string
}

/** Which session is currently active in a feature area for a given workspace. */
export interface FeatureWorkspaceState {
  workspaceId: string
  feature: FeatureKey
  activeSessionId?: string
  recentSessionIds: string[]
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Storage key helpers
// ---------------------------------------------------------------------------

function workspaceId(workspacePath: string): string {
  // Use the last path segment as a short stable key.
  return workspacePath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? workspacePath
}

function featureStateKey(workspacePath: string, feature: FeatureKey): string {
  return `aioffice.feature.${workspaceId(workspacePath)}.${feature}`
}

function sessionKey(workspacePath: string, feature: FeatureKey, sessionId: string): string {
  return `aioffice.session.${workspaceId(workspacePath)}.${feature}.${sessionId}`
}

// ---------------------------------------------------------------------------
// FeatureWorkspaceState helpers
// ---------------------------------------------------------------------------

export function loadFeatureWorkspaceState(
  workspacePath: string,
  feature: FeatureKey,
): FeatureWorkspaceState | null {
  try {
    const raw = localStorage.getItem(featureStateKey(workspacePath, feature))
    if (!raw) return null
    return JSON.parse(raw) as FeatureWorkspaceState
  } catch {
    return null
  }
}

export function saveFeatureWorkspaceState(
  workspacePath: string,
  state: FeatureWorkspaceState,
): void {
  try {
    localStorage.setItem(featureStateKey(workspacePath, state.feature), JSON.stringify(state))
  } catch {
    // Ignore quota errors silently.
  }
}

// ---------------------------------------------------------------------------
// FeatureSession helpers
// ---------------------------------------------------------------------------

export function loadFeatureSession(
  workspacePath: string,
  feature: FeatureKey,
  sessionId: string,
): FeatureSession | null {
  try {
    const raw = localStorage.getItem(sessionKey(workspacePath, feature, sessionId))
    if (!raw) return null
    return JSON.parse(raw) as FeatureSession
  } catch {
    return null
  }
}

export function saveFeatureSession(workspacePath: string, session: FeatureSession): void {
  try {
    localStorage.setItem(
      sessionKey(workspacePath, session.feature, session.id),
      JSON.stringify(session),
    )
  } catch {
    // Ignore quota errors silently.
  }
}

// ---------------------------------------------------------------------------
// Generic key/value store scoped to workspace (used by context-level persistence)
// ---------------------------------------------------------------------------

export function loadWorkspaceData<T>(workspacePath: string, subKey: string): T | null {
  try {
    const raw = localStorage.getItem(`aioffice.ws.${workspaceId(workspacePath)}.${subKey}`)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function saveWorkspaceData(workspacePath: string, subKey: string, data: unknown): void {
  try {
    localStorage.setItem(
      `aioffice.ws.${workspaceId(workspacePath)}.${subKey}`,
      JSON.stringify(data),
    )
  } catch {
    // Ignore quota errors silently.
  }
}
