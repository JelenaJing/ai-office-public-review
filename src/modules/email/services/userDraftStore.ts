/**
 * userDraftStore — localStorage persistence for user-edited reply drafts.
 *
 * Separate from mailDraftStore (which holds AI-generated drafts).
 * Keyed by `${accountId}:${messageId}:${bodyHash}` so drafts are
 * automatically invalidated if the email body changes.
 *
 * Security: local-only. Nothing is sent automatically.
 */
import type { UserMailReplyDraft } from '../../../types/mailTriage'

const STORE_KEY = 'ai:user-draft:v1'
const MAX_DRAFTS = 200

type UserDraftStore = Record<string, UserMailReplyDraft>

function load(): UserDraftStore {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function save(store: UserDraftStore): void {
  try {
    const keys = Object.keys(store)
    if (keys.length > MAX_DRAFTS) {
      // Evict oldest entries by updatedAt
      const sorted = keys.sort((a, b) => {
        const da = store[a]?.updatedAt ?? ''
        const db = store[b]?.updatedAt ?? ''
        return da < db ? -1 : da > db ? 1 : 0
      })
      const trimmed: UserDraftStore = {}
      for (const k of sorted.slice(-MAX_DRAFTS)) trimmed[k] = store[k]
      localStorage.setItem(STORE_KEY, JSON.stringify(trimmed))
    } else {
      localStorage.setItem(STORE_KEY, JSON.stringify(store))
    }
  } catch { /* quota exceeded — silently ignore */ }
}

function key(accountId: string, messageId: string, bodyHash: string): string {
  return `${accountId}:${messageId}:${bodyHash}`
}

/**
 * Get a user draft. Returns null if missing, sent, or discarded.
 */
export function getUserDraft(
  accountId: string,
  messageId: string,
  bodyHash: string,
): UserMailReplyDraft | null {
  const draft = load()[key(accountId, messageId, bodyHash)] ?? null
  if (!draft) return null
  if (draft.status === 'sent' || draft.status === 'discarded') return null
  return draft
}

/**
 * Save or update a user draft.
 */
export function setUserDraft(draft: UserMailReplyDraft): void {
  const store = load()
  store[key(draft.accountId, draft.messageId, draft.bodyHash)] = draft
  save(store)
}

/**
 * Update only the status of an existing user draft.
 */
export function updateUserDraftStatus(
  accountId: string,
  messageId: string,
  bodyHash: string,
  status: UserMailReplyDraft['status'],
): void {
  const store = load()
  const k = key(accountId, messageId, bodyHash)
  if (store[k]) {
    store[k] = { ...store[k], status, updatedAt: new Date().toISOString() }
    save(store)
  }
}

/**
 * Remove all user drafts for a specific mail (across all bodyHash variants).
 */
export function evictUserDraft(accountId: string, messageId: string): void {
  const store = load()
  const prefix = `${accountId}:${messageId}:`
  let changed = false
  for (const k of Object.keys(store)) {
    if (k.startsWith(prefix)) { delete store[k]; changed = true }
  }
  if (changed) save(store)
}
