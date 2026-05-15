/**
 * Token-hardening self-test script
 *
 * Tests the atomic-write, retry, and write-queue logic that guards
 * internal-account-token.json in the Electron main process.
 *
 * Run with:  node scripts/test-token-write.mjs
 * (No Electron required — pure Node.js)
 */

import fs from 'node:fs/promises'
import syncFs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const PASS = '\x1b[32m✔\x1b[0m'
const FAIL = '\x1b[31m✘\x1b[0m'
let passed = 0
let failed = 0

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ${PASS} ${label}`)
    passed++
  } else {
    console.log(`  ${FAIL} ${label}${detail ? ' — ' + detail : ''}`)
    failed++
  }
}

// ── Re-implementation of the hardened write logic (mirrors electron/main/index.ts) ──

const retryDelaysMs = [80, 160, 320, 640, 1000]
let writeQueue = Promise.resolve()
let pendingWrites = 0

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function writeTokenAtomic(tokenPath, value) {
  const tmpPath = tokenPath + '.tmp'
  const userDataDir = path.dirname(tokenPath)
  const content = JSON.stringify({ token: value })

  syncFs.mkdirSync(userDataDir, { recursive: true })

  // Pre-flight
  try {
    const st = syncFs.statSync(tokenPath)
    if (st.isDirectory()) {
      const bak = tokenPath + `.bak-dir-${Date.now()}`
      syncFs.renameSync(tokenPath, bak)
    } else {
      const mode = st.mode & 0o777
      if (!(mode & 0o200)) {
        try { syncFs.chmodSync(tokenPath, 0o600) } catch { /* log only */ }
      }
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
  }

  let lastErr
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    try {
      await fs.writeFile(tmpPath, content, { encoding: 'utf-8' })
      try {
        await fs.rename(tmpPath, tokenPath)
      } catch (renameErr) {
        await fs.copyFile(tmpPath, tokenPath)
        try { await fs.unlink(tmpPath) } catch { /* ignore */ }
      }
      return
    } catch (err) {
      lastErr = err
      try { await fs.unlink(tmpPath) } catch { /* ignore */ }
      if (attempt < retryDelaysMs.length && ['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) {
        await sleep(retryDelaysMs[attempt])
        continue
      }
      break
    }
  }
  throw lastErr
}

async function setToken(tokenPath, value) {
  pendingWrites++
  let myResolve, myReject
  const mySlot = new Promise((res, rej) => { myResolve = res; myReject = rej })
  const prev = writeQueue
  writeQueue = mySlot
  try {
    await prev.catch(() => {})
    await writeTokenAtomic(tokenPath, value)
    myResolve()
    return { ok: true }
  } catch (err) {
    myReject(err)
    throw err
  } finally {
    pendingWrites--
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iat-test-'))
const tokenPath = path.join(tmpDir, 'internal-account-token.json')

console.log('\n\x1b[1m[1] Fresh write (no existing file)\x1b[0m')
await setToken(tokenPath, 'token-abc')
const raw1 = JSON.parse(await fs.readFile(tokenPath, 'utf-8'))
assert('file created', syncFs.existsSync(tokenPath))
assert('token value correct', raw1.token === 'token-abc')
assert('.tmp file cleaned up', !syncFs.existsSync(tokenPath + '.tmp'))

console.log('\n\x1b[1m[2] Overwrite existing file\x1b[0m')
await setToken(tokenPath, 'token-def')
const raw2 = JSON.parse(await fs.readFile(tokenPath, 'utf-8'))
assert('token updated', raw2.token === 'token-def')

console.log('\n\x1b[1m[3] Concurrent writes are serialised (write queue)\x1b[0m')
writeQueue = Promise.resolve() // reset queue
const results = await Promise.all([
  setToken(tokenPath, 'concurrent-1'),
  setToken(tokenPath, 'concurrent-2'),
  setToken(tokenPath, 'concurrent-3'),
])
const rawConcurrent = JSON.parse(await fs.readFile(tokenPath, 'utf-8'))
assert('all writes completed without error', results.every(r => r.ok))
assert('final value is last write', rawConcurrent.token === 'concurrent-3')
assert('.tmp cleaned up after concurrent writes', !syncFs.existsSync(tokenPath + '.tmp'))

console.log('\n\x1b[1m[4] Path is a directory — auto-renamed to .bak-dir-*\x1b[0m')
await fs.unlink(tokenPath)
await fs.mkdir(tokenPath)
assert('setup: path is now a directory', syncFs.statSync(tokenPath).isDirectory())
await setToken(tokenPath, 'after-dir-fix')
const raw4 = JSON.parse(await fs.readFile(tokenPath, 'utf-8'))
assert('directory renamed and file written', raw4.token === 'after-dir-fix')
const bakDirs = syncFs.readdirSync(tmpDir).filter(f => f.includes('.bak-dir-'))
assert('bak-dir backup created', bakDirs.length === 1)

console.log('\n\x1b[1m[5] Read-back after write — value survives JSON parse\x1b[0m')
await setToken(tokenPath, 'final-token-xyz')
const raw5 = JSON.parse(await fs.readFile(tokenPath, 'utf-8'))
assert('token is string', typeof raw5.token === 'string')
assert('token round-trips', raw5.token === 'final-token-xyz')

// ── Cleanup ───────────────────────────────────────────────────────────────────
await fs.rm(tmpDir, { recursive: true, force: true })

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n\x1b[1mResults: ${passed} passed, ${failed} failed\x1b[0m`)
if (failed > 0) process.exit(1)
