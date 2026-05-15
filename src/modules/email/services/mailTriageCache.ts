/**
 * Mail Triage Cache — persistent localStorage storage for AI triage results.
 *
 * Cache key: `${accountId}:${messageId}`
 * Hit condition: entry exists AND bodyHash matches AND status === 'success'
 *
 * Completely client-side. No server calls.
 *
 * ⚠️  MVP CACHE LAYER: uses localStorage for simplicity.
 *     Migrate to electron-store or SQLite (better-sqlite3) in production
 *     to support larger datasets, cross-window sync, and atomic writes.
 */
import type { AiMailTriageResult } from '../../../types/mailTriage'

const CACHE_KEY = 'ai:mail-triage:v1'
/** Prune to this many entries when storage grows large */
const MAX_CACHE_ENTRIES = 600

type CacheStore = Record<string, AiMailTriageResult>

/** djb2 variant hash — fast, deterministic, no async */
export function computeBodyHash(body: string): string {
  let h = 5381
  for (let i = 0; i < body.length; i++) {
    // eslint-disable-next-line no-bitwise
    h = (((h << 5) + h) ^ body.charCodeAt(i)) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

function loadStore(): CacheStore {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as CacheStore
  } catch {
    return {}
  }
}

function saveStore(store: CacheStore): void {
  try {
    const entries = Object.entries(store)
    if (entries.length > MAX_CACHE_ENTRIES) {
      // Evict oldest entries
      entries.sort((a, b) => a[1].updatedAt.localeCompare(b[1].updatedAt))
      const pruned = Object.fromEntries(entries.slice(entries.length - MAX_CACHE_ENTRIES))
      localStorage.setItem(CACHE_KEY, JSON.stringify(pruned))
    } else {
      localStorage.setItem(CACHE_KEY, JSON.stringify(store))
    }
  } catch {
    // Storage full — attempt to clear the oldest half
    try {
      const entries = Object.entries(loadStore())
      entries.sort((a, b) => a[1].updatedAt.localeCompare(b[1].updatedAt))
      const pruned = Object.fromEntries(entries.slice(Math.floor(entries.length / 2)))
      localStorage.setItem(CACHE_KEY, JSON.stringify(pruned))
    } catch { /* give up */ }
  }
}

function makeCacheKey(accountId: string, messageId: string): string {
  return `${accountId}:${messageId}`
}

/**
 * Return the cached triage result only if it is a successful hit
 * (status === 'success' AND bodyHash matches).
 */
export function getCachedTriage(
  accountId: string,
  messageId: string,
  bodyHash: string,
): AiMailTriageResult | null {
  const store = loadStore()
  const entry = store[makeCacheKey(accountId, messageId)]
  if (!entry) return null
  if (entry.status !== 'success') return null
  if (entry.bodyHash !== bodyHash) return null
  return entry
}

/** Persist a triage result to cache. */
export function setCachedTriage(result: AiMailTriageResult): void {
  const store = loadStore()
  store[makeCacheKey(result.accountId, result.messageId)] = result
  saveStore(store)
}

/**
 * Load all cached triage results for a given account.
 * Returns a map keyed by messageId.
 */
export function getAllCachedTriagesForAccount(
  accountId: string,
): Record<string, AiMailTriageResult> {
  const store = loadStore()
  const prefix = `${accountId}:`
  const result: Record<string, AiMailTriageResult> = {}
  for (const [key, value] of Object.entries(store)) {
    if (key.startsWith(prefix)) {
      result[value.messageId] = value
    }
  }
  return result
}

/** Remove a single entry from cache. */
export function evictCachedTriage(accountId: string, messageId: string): void {
  const store = loadStore()
  delete store[makeCacheKey(accountId, messageId)]
  saveStore(store)
}
