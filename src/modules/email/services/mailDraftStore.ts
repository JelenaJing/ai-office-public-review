/**
 * mailDraftStore — localStorage store for AI pre-reply drafts.
 *
 * Drafts are keyed by `${accountId}:${messageId}:${bodyHash}` so they are
 * automatically invalidated if the email body changes.
 *
 * Security: drafts are local-only. Nothing is sent automatically.
 * Users must explicitly click "Send" to dispatch any message.
 */
import type { AiMailReplyDraft } from '../../../types/mailTriage'

const STORE_KEY = 'ai:mail-draft:v2'
const MAX_DRAFTS = 200

type DraftStore = Record<string, AiMailReplyDraft>

function load(): DraftStore {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function save(store: DraftStore): void {
  try {
    const keys = Object.keys(store)
    if (keys.length > MAX_DRAFTS) {
      // Evict oldest entries by createdAt
      const sorted = keys.sort((a, b) => {
        const da = store[a]?.createdAt ?? ''
        const db = store[b]?.createdAt ?? ''
        return da < db ? -1 : da > db ? 1 : 0
      })
      const trimmed: DraftStore = {}
      for (const k of sorted.slice(-MAX_DRAFTS)) trimmed[k] = store[k]
      localStorage.setItem(STORE_KEY, JSON.stringify(trimmed))
    } else {
      localStorage.setItem(STORE_KEY, JSON.stringify(store))
    }
  } catch {}
}

/** Get the AI draft for a specific mail. Returns null if not present or discarded. */
export function getAiDraft(accountId: string, messageId: string, bodyHash: string): AiMailReplyDraft | null {
  const draft = load()[`${accountId}:${messageId}:${bodyHash}`] ?? null
  if (!draft) return null
  // Don't return discarded drafts
  if (draft.status === 'discarded') return null
  return draft
}

/** Check if a non-discarded AI draft exists for a specific mail + bodyHash. */
export function hasAiDraft(accountId: string, messageId: string, bodyHash: string): boolean {
  return getAiDraft(accountId, messageId, bodyHash) !== null
}

/** Store an AI draft. */
export function setAiDraft(draft: AiMailReplyDraft): void {
  const store = load()
  store[`${draft.accountId}:${draft.messageId}:${draft.bodyHash}`] = draft
  save(store)
}

/** Update the status of an existing draft. */
export function updateAiDraftStatus(
  accountId: string,
  messageId: string,
  bodyHash: string,
  status: AiMailReplyDraft['status'],
): void {
  const store = load()
  const key = `${accountId}:${messageId}:${bodyHash}`
  if (store[key]) {
    store[key] = { ...store[key], status, updatedAt: new Date().toISOString() }
    save(store)
  }
}

/** Remove all AI drafts for a specific mail (across all bodyHash variants). */
export function evictAiDraft(accountId: string, messageId: string): void {
  const store = load()
  const prefix = `${accountId}:${messageId}:`
  let changed = false
  for (const key of Object.keys(store)) {
    if (key.startsWith(prefix)) {
      delete store[key]
      changed = true
    }
  }
  if (changed) save(store)
}

/** Remove all AI drafts for an account (used when clearing seed data). */
export function evictAllAiDraftsForAccount(accountId: string): void {
  const store = load()
  const prefix = `${accountId}:`
  let changed = false
  for (const key of Object.keys(store)) {
    if (key.startsWith(prefix)) {
      delete store[key]
      changed = true
    }
  }
  if (changed) save(store)
}
