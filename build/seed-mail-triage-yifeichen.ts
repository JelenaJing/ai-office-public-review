/**
 * seed-mail-triage-yifeichen — dev-only validation script.
 *
 * This script validates the 50 yifeichen seed mail fixtures and prints a
 * test report. The actual seed mail injection is automatic — no manual step
 * is needed. When the app detects an email account belonging to yifeichen,
 * EmailContext automatically prepends the seed mails to the inbox.
 *
 * Usage:
 *   npm run seed:mail-triage:yifeichen
 *
 * What this script does:
 *  1. Validates that all 50 seed mails are structurally correct.
 *  2. Verifies the distribution of expectedCategory / expectedPriority.
 *  3. Prints a summary report.
 *  4. Prints a reminder that seeding is automatic in the app.
 */

import { YIFEICHEN_SEED_MAILS, SEED_BATCH_ID } from '../src/modules/email/seeds/mailTriageSeedData.js'

/* ------------------------------------------------------------------ */
/*  Validation                                                         */
/* ------------------------------------------------------------------ */

const VALID_CATEGORIES = new Set([
  'action_required',
  'reply_required',
  'read_only',
  'archive_candidate',
  'promotion',
  'risk',
  'unknown',
])

const VALID_PRIORITIES = new Set(['high', 'medium', 'low'])

const errors: string[] = []

// Required field checks
for (const mail of YIFEICHEN_SEED_MAILS) {
  if (!mail.messageId?.startsWith('seed:yifeichen:')) {
    errors.push(`Invalid messageId: "${mail.messageId}"`)
  }
  if (!mail.from?.includes('<')) {
    errors.push(`[${mail.messageId}] from should be "Name <email>" format`)
  }
  if (!mail.subject) {
    errors.push(`[${mail.messageId}] Missing subject`)
  }
  if (!mail.plainTextBody || mail.plainTextBody.length < 20) {
    errors.push(`[${mail.messageId}] Body too short`)
  }
  if (!VALID_CATEGORIES.has(mail.expectedCategory)) {
    errors.push(`[${mail.messageId}] Invalid category: "${mail.expectedCategory}"`)
  }
  if (!VALID_PRIORITIES.has(mail.expectedPriority)) {
    errors.push(`[${mail.messageId}] Invalid priority: "${mail.expectedPriority}"`)
  }
}

// Uniqueness check
const ids = YIFEICHEN_SEED_MAILS.map((m) => m.messageId)
const uniqueIds = new Set(ids)
if (uniqueIds.size !== ids.length) {
  errors.push(`Duplicate messageIds detected`)
}

/* ------------------------------------------------------------------ */
/*  Distribution count                                                 */
/* ------------------------------------------------------------------ */

const catCounts: Record<string, number> = {}
const priCounts: Record<string, number> = {}
let withAttachments = 0
let noreplyCount = 0

for (const mail of YIFEICHEN_SEED_MAILS) {
  catCounts[mail.expectedCategory] = (catCounts[mail.expectedCategory] ?? 0) + 1
  priCounts[mail.expectedPriority] = (priCounts[mail.expectedPriority] ?? 0) + 1
  if (mail.attachments?.length) withAttachments++
  if (/noreply|no-reply|newsletter|unsubscribe|system\./i.test(mail.from)) {
    noreplyCount++
  }
}

/* ------------------------------------------------------------------ */
/*  Print report                                                       */
/* ------------------------------------------------------------------ */

console.log('\n┌──────────────────────────────────────────────────────────────┐')
console.log('│           AI Mail Triage Seed Validation Report              │')
console.log('│              (yifeichen account fixtures)                    │')
console.log('└──────────────────────────────────────────────────────────────┘\n')

console.log(`Seed Batch ID    : ${SEED_BATCH_ID}`)
console.log(`Total Mails      : ${YIFEICHEN_SEED_MAILS.length}  (expected: 50)`)
console.log(`With Attachments : ${withAttachments}  (required: ≥10)`)
console.log(`Noreply/System   : ${noreplyCount}  (required: ≥5)`)
console.log('')

console.log('Category Distribution:')
const expectedDist: Record<string, number> = {
  reply_required: 10, action_required: 8, read_only: 10,
  archive_candidate: 8, promotion: 6, risk: 5, unknown: 3,
}
for (const [cat, expected] of Object.entries(expectedDist)) {
  const actual = catCounts[cat] ?? 0
  const ok = actual === expected ? '✓' : '✗'
  console.log(`  ${ok}  ${cat.padEnd(20)}: ${actual} (expected: ${expected})`)
}

console.log('')
console.log('Priority Distribution:')
for (const pri of ['high', 'medium', 'low']) {
  console.log(`  ${pri.padEnd(10)}: ${priCounts[pri] ?? 0}`)
}

console.log('')
if (errors.length === 0) {
  console.log('✅ All validations passed!\n')
} else {
  console.log(`❌ ${errors.length} validation error(s):`)
  for (const e of errors) console.log(`   • ${e}`)
  console.log('')
  process.exit(1)
}

console.log('─'.repeat(66))
console.log('HOW SEEDING WORKS:')
console.log('')
console.log('  Seeding is automatic — no manual step needed.')
console.log('  When the app detects an email account belonging to yifeichen,')
console.log('  EmailContext automatically injects these 50 seed mails into')
console.log('  the inbox, and MailTriageContext begins AI analysis in the')
console.log('  background.')
console.log('')
console.log('  Detection criteria (any of):')
console.log('    • emailAccountConfig.ownerUsername === "yifeichen"')
console.log('    • emailAccountConfig.username === "yifeichen"')
console.log('    • emailAddress.startsWith("yifeichen@")')
console.log('')
console.log('  Seed mails are NOT shown to other email accounts.')
console.log('─'.repeat(66))
console.log('')
console.log('TO ACTIVATE:')
console.log('  1. Open the app and log in as the yifeichen internal account.')
console.log('  2. Configure the yifeichen email account (IMAP settings).')
console.log('  3. Open the Mail module — 50 seed mails appear automatically.')
console.log('  4. AI triage starts in the background (no click needed).')
console.log('')
console.log('TO CLEAR (via browser devtools):')
console.log('  Run: npm run clear:mail-triage-seed:yifeichen')
console.log('  (This prints a localStorage snippet to paste in DevTools)')
console.log('')
