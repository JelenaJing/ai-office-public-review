/**
 * clear-mail-triage-seed-yifeichen — dev-only clear script.
 *
 * This script prints the localStorage keys that hold yifeichen seed mail
 * triage cache entries and provides a ready-to-paste browser DevTools
 * console snippet to clear them.
 *
 * Usage:
 *   npm run clear:mail-triage-seed:yifeichen
 *
 * Note: The actual clear must happen inside the Electron renderer (browser
 * context) because localStorage is only accessible there. This script
 * generates the JS snippet — paste it into the DevTools console while
 * the app is running.
 *
 * What gets cleared:
 *  • The AI triage cache entries for all 50 seed messageIds
 *    (localStorage key: ai:mail-triage:v1)
 *  • The seed mails themselves disappear automatically when the app
 *    is opened without a yifeichen email account configured.
 *
 * What is NOT affected:
 *  • Real (non-seed) mails for yifeichen's real inbox
 *  • AI triage results for real mails
 *  • Any other user's email data
 */

import { YIFEICHEN_SEED_MAILS, SEED_BATCH_ID } from '../src/modules/email/seeds/mailTriageSeedData.js'

const seedMessageIds = YIFEICHEN_SEED_MAILS.map((m) => m.messageId)

console.log('\n┌──────────────────────────────────────────────────────────────┐')
console.log('│       AI Mail Triage Seed Clear — yifeichen Account          │')
console.log('└──────────────────────────────────────────────────────────────┘\n')

console.log(`Seed Batch ID    : ${SEED_BATCH_ID}`)
console.log(`Seed Mail Count  : ${seedMessageIds.length}`)
console.log('')
console.log('The following seed messageIds will be cleared from triage cache:')
for (const id of seedMessageIds) {
  console.log(`  • ${id}`)
}

console.log('')
console.log('─'.repeat(66))
console.log('INSTRUCTIONS:')
console.log('')
console.log('  1. Open the app (Electron) and navigate to any page.')
console.log('  2. Open DevTools (Ctrl+Shift+I or Cmd+Option+I).')
console.log('  3. Go to the Console tab.')
console.log('  4. Paste the snippet below and press Enter.')
console.log('')
console.log('─'.repeat(66))
console.log('')
console.log('// ── PASTE IN DEVTOOLS CONSOLE ──────────────────────────────')
console.log('(function clearYifeiChenSeedTriageCache() {')
console.log('  const CACHE_KEY = "ai:mail-triage:v1";')
console.log('  const seedIds = ' + JSON.stringify(seedMessageIds, null, 2).replace(/\n/g, '\n  ') + ';')
console.log('  let store = {};')
console.log('  try { store = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); } catch(e) {}')
console.log('  let removed = 0;')
console.log('  for (const key of Object.keys(store)) {')
console.log('    const msgId = key.split(":").slice(1).join(":");')
console.log('    if (seedIds.some(id => key.endsWith(":" + id) || key.includes(id))) {')
console.log('      delete store[key];')
console.log('      removed++;')
console.log('    }')
console.log('  }')
console.log('  localStorage.setItem(CACHE_KEY, JSON.stringify(store));')
console.log('  console.log("[SeedClear] Removed", removed, "triage cache entries.");')
console.log('  console.log("[SeedClear] Reload the app to see seed mails re-trigger AI analysis.");')
console.log('})();')
console.log('// ── END SNIPPET ─────────────────────────────────────────────')
console.log('')
console.log('─'.repeat(66))
console.log('')
console.log('After clearing:')
console.log('  • The 50 seed mails remain in the inbox (they are always injected')
console.log('    at startup when yifeichen account is active).')
console.log('  • The AI triage cache is cleared, so all 50 mails will be')
console.log('    re-analyzed by the LLM on next page load (costs tokens).')
console.log('  • To fully hide the seed mails, switch to a non-yifeichen account.')
console.log('')
