/**
 * Salutation builder smoke test.
 * Run with:  npm exec --yes --package tsx -- tsx build/run-salutation-smoke.ts
 */
import assert from 'assert/strict'
import { normalizeHonorific, buildRecipientSalutation } from '../src/communication/services/emailSalutationBuilder'

console.log('🧪 Salutation Builder — smoke tests')

interface Case {
  label: string
  name: string
  position: string
  enName?: string
  expectSalutation: string
  expectSalutationName: string
}

const cases: Case[] = [
  // English name with leadership title (main bug fix)
  {
    label: 'JIANHUA HUANG + 副院长 → 黄院长您好',
    name: 'JIANHUA HUANG',
    position: '副院长',
    enName: 'JIANHUA HUANG',
    expectSalutation: '黄院长您好',
    expectSalutationName: '院长',
  },
  // normalizeHonorific assertions
  {
    label: '副教授 → 教授',
    name: '朱熹',
    position: '副教授',
    expectSalutation: '朱教授您好',
    expectSalutationName: '教授',
  },
  {
    label: '助理教授 → 教授',
    name: '杜梦楠',
    position: '助理教授',
    expectSalutation: '杜教授您好',
    expectSalutationName: '教授',
  },
  {
    label: '院务副主任 → 主任',
    name: '李媚',
    position: '院务副主任',
    expectSalutation: '李主任您好',
    expectSalutationName: '主任',
  },
  {
    label: '行政助理 → 老师',
    name: '曾钰捷',
    position: '行政助理',
    expectSalutation: '曾老师您好',
    expectSalutationName: '老师',
  },
  {
    label: '主管 → 主管',
    name: '彭小川',
    position: '主管',
    expectSalutation: '彭主管您好',
    expectSalutationName: '主管',
  },
  // English name English surname map fallback
  {
    label: 'JIANHUA ZHANG + 教授 → 张教授您好',
    name: 'JIANHUA ZHANG',
    position: '教授',
    enName: 'JIANHUA ZHANG',
    expectSalutation: '张教授您好',
    expectSalutationName: '教授',
  },
  // English name, no Chinese map match → fallback to English surname with correct honorific
  {
    label: 'JIANHUA SMITH + 院长 → Smith院长您好 (no Chinese map for Smith)',
    name: 'JIANHUA SMITH',
    position: '院长',
    enName: 'JIANHUA SMITH',
    expectSalutation: 'Jianhua院长您好',
    expectSalutationName: '院长',
  },
]

let pass = 0
let fail = 0

for (const c of cases) {
  // Verify normalizeHonorific first
  const norm = normalizeHonorific(c.position)
  const { salutation, salutationName } = buildRecipientSalutation({
    name: c.name,
    position: c.position,
    enName: c.enName,
  })

  let ok = true
  try {
    assert.equal(salutation, c.expectSalutation, `salutation mismatch for [${c.label}]`)
    assert.equal(salutationName, c.expectSalutationName, `salutationName mismatch for [${c.label}]`)
  } catch (e: unknown) {
    ok = false
    console.error(`  ❌ ${c.label}`)
    console.error(`     got salutation="${salutation}" salutationName="${salutationName}"`)
    console.error(`     expected salutation="${c.expectSalutation}" salutationName="${c.expectSalutationName}"`)
    console.error(`     normalizeHonorific("${c.position}") = "${norm.honorific}" (${norm.reason})`)
    fail++
  }
  if (ok) {
    console.log(`  ✅ ${c.label}`)
    pass++
  }
}

console.log()
console.log(`${pass}/${pass + fail} passed${fail > 0 ? ', ' + fail + ' FAILED' : ''}`)
if (fail > 0) process.exit(1)
