/**
 * Smoke test for communicationIntentParser.
 * Run with: npm exec --yes --package tsx tsx build/run-communication-intent-parser-smoke.ts
 */

import assert from 'node:assert/strict'
import { parseIntent } from '../src/communication/services/communicationIntentParser'

// ─── Test framework ───────────────────────────────────────────────────────────

let passed = 0
let failed = 0

function check(label: string, fn: () => void): void {
  try {
    fn()
    console.log(`  ✅ ${label}`)
    passed++
  } catch (err: unknown) {
    console.log(`  ❌ ${label}`)
    console.log(`     ${err instanceof Error ? err.message : String(err)}`)
    failed++
  }
}

// ─── Test cases ───────────────────────────────────────────────────────────────

console.log('\n📬 Communication Intent Parser — smoke tests\n')

// Case 1: Primary acceptance case — "发一封...的通知" without explicit "邮件"
check('帮我给人工智能学院的所有人发一封开展aioffice宣讲会的通知', () => {
  const r = parseIntent('帮我给人工智能学院的所有人发一封开展aioffice宣讲会的通知')
  assert.equal(r.intent, 'send_bulk_email', `intent should be send_bulk_email, got ${r.intent}`)
  assert.equal(r.targetOrgUnit, '人工智能学院', `targetOrgUnit should be 人工智能学院, got ${r.targetOrgUnit}`)
  assert.equal(r.recipientScope, 'all', `recipientScope should be all, got ${r.recipientScope}`)
  assert.equal(r.messageType, 'notice', `messageType should be notice, got ${r.messageType}`)
  assert.ok(r.messagePurpose?.includes('AI Office'), `messagePurpose should include "AI Office", got "${r.messagePurpose}"`)
  assert.equal(r.subjectHint, '关于开展AI Office宣讲会的通知', `subjectHint mismatch: got "${r.subjectHint}"`)
  assert.equal(r.requiresReview, true)
})

// Case 1b: "发送一封...的通知" + personalization modifier (the primary bug case)
check('帮我给人工智能学院的所有人发送一封开展AI Office宣讲会的通知，每个人都生成一封不同内容的邮件', () => {
  const r = parseIntent('帮我给人工智能学院的所有人发送一封开展AI Office宣讲会的通知，每个人都生成一封不同内容的邮件')
  assert.equal(r.intent, 'send_bulk_email', `intent should be send_bulk_email, got ${r.intent}`)
  assert.equal(r.targetOrgUnit, '人工智能学院', `targetOrgUnit should be 人工智能学院, got ${r.targetOrgUnit}`)
  assert.equal(r.recipientScope, 'all', `recipientScope should be all, got ${r.recipientScope}`)
  assert.equal(r.messageType, 'notice', `messageType should be notice, got ${r.messageType}`)
  assert.ok(r.messagePurpose?.includes('AI Office'), `messagePurpose should include "AI Office", got "${r.messagePurpose}"`)
  assert.equal(r.personalizationLevel, 'personalized_body', `personalizationLevel should be personalized_body, got ${r.personalizationLevel}`)
  assert.ok(r.subjectHint?.includes('AI Office'), `subjectHint should include AI Office, got "${r.subjectHint}"`)
  assert.ok(!r.messagePurpose?.includes('每个人'), `messagePurpose must not contain "每个人", got "${r.messagePurpose}"`)
  assert.ok(!r.subjectHint?.includes('每个人'), `subjectHint must not contain "每个人", got "${r.subjectHint}"`)
})

// Case 1c: "发送一封...的通知" without personalization modifier
check('帮我给人工智能学院的所有人发送一封开展AI Office宣讲会的通知', () => {
  const r = parseIntent('帮我给人工智能学院的所有人发送一封开展AI Office宣讲会的通知')
  assert.equal(r.intent, 'send_bulk_email', `intent should be send_bulk_email, got ${r.intent}`)
  assert.equal(r.targetOrgUnit, '人工智能学院', `targetOrgUnit mismatch: ${r.targetOrgUnit}`)
  assert.ok(r.messagePurpose?.includes('AI Office'), `messagePurpose should include "AI Office", got "${r.messagePurpose}"`)
})

// Case 2: Greeting with explicit "邮件" keyword + personalization modifier
check('帮我给招生办的所有人发一份新年祝福的邮件，每个人都不一样', () => {
  const r = parseIntent('帮我给招生办的所有人发一份新年祝福的邮件，每个人都不一样')
  assert.equal(r.intent, 'send_bulk_email')
  assert.equal(r.targetOrgUnit, '招生办')
  assert.equal(r.messageType, 'greeting')
  assert.equal(r.messagePurpose, '新年祝福')
  assert.equal(r.personalizationLevel, 'personalized_body', `personalizationLevel should be personalized_body, got ${r.personalizationLevel}`)
  assert.ok(!r.messagePurpose?.includes('每个人'), `messagePurpose must not contain "每个人"`)
})

// Case 3: Verb=通知 pattern — no "发邮件" / "发一封" in the sentence
check('帮我通知人工智能学院全体老师明天下午参加宣讲会', () => {
  const r = parseIntent('帮我通知人工智能学院全体老师明天下午参加宣讲会')
  assert.equal(r.intent, 'send_bulk_email', `intent should be send_bulk_email, got ${r.intent}`)
  assert.equal(r.targetOrgUnit, '人工智能学院', `targetOrgUnit mismatch: ${r.targetOrgUnit}`)
  assert.equal(r.recipientScope, 'all_teachers', `recipientScope should be all_teachers, got ${r.recipientScope}`)
  assert.equal(r.messageType, 'notice')
  assert.ok(r.messagePurpose?.includes('参加宣讲会'), `messagePurpose should include 参加宣讲会, got "${r.messagePurpose}"`)
})

// Case 4: "发通知" pattern (no "邮件" keyword)
check('给技术部所有人发通知关于系统升级', () => {
  const r = parseIntent('给技术部所有人发通知关于系统升级')
  assert.equal(r.intent, 'send_bulk_email', `intent should be send_bulk_email, got ${r.intent}`)
  assert.equal(r.targetOrgUnit, '技术部')
  assert.equal(r.recipientScope, 'all')
  assert.equal(r.messageType, 'notice')
})

// Case 5: "全体成员" scope + "发送" action
check('给教务处全体成员发送培训通知', () => {
  const r = parseIntent('给教务处全体成员发送培训通知')
  assert.equal(r.intent, 'send_bulk_email')
  assert.equal(r.targetOrgUnit, '教务处')
  assert.equal(r.recipientScope, 'all')
  assert.equal(r.messageType, 'notice')
})

// Case 6: All-students scope
check('给软件学院所有同学发一份关于实习报名的通知', () => {
  const r = parseIntent('给软件学院所有同学发一份关于实习报名的通知')
  assert.equal(r.intent, 'send_bulk_email')
  assert.equal(r.targetOrgUnit, '软件学院')
  assert.equal(r.recipientScope, 'all_students')
  assert.equal(r.messageType, 'notice')
})

// Case 7: Meeting type
check('给管理层全体人员发一封关于年度总结会议的邮件', () => {
  const r = parseIntent('给管理层全体人员发一封关于年度总结会议的邮件')
  assert.equal(r.intent, 'send_bulk_email')
  assert.equal(r.messageType, 'meeting')
})

// Case 8: Gibberish should remain unknown
check('随机不相关输入 xyzabc', () => {
  const r = parseIntent('随机不相关输入 xyzabc')
  assert.equal(r.intent, 'unknown')
})

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n结果：${passed} 通过，${failed} 失败\n`)
if (failed > 0) process.exit(1)

