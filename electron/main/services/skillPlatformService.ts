/**
 * skillPlatformService.ts
 *
 * Manages the lifecycle of skill_platform_next background services:
 *   - skill-library-backend  → port 4010
 *   - skill-store-web        → port 4030
 *
 * Only processes spawned by THIS module are tracked / killed on quit.
 * Processes the user started manually are left untouched.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import fs from 'node:fs/promises'
import { app } from 'electron'

const INTERNAL_TOKEN = process.env.SKILL_INTERNAL_API_TOKEN ?? 'change-this-token'

// Remote-first defaults — override with env vars for local dev:
//   SKILL_STORE_URL=http://localhost:4030
//   SKILL_LIBRARY_URL=http://localhost:4010
const REMOTE_STORE_DEFAULT   = 'http://10.20.5.62:4030'
const REMOTE_LIBRARY_DEFAULT = 'http://10.20.5.62:4010'
export const STORE_BASE   = process.env.SKILL_STORE_URL   ?? REMOTE_STORE_DEFAULT
const        LIBRARY_BASE = process.env.SKILL_LIBRARY_URL ?? REMOTE_LIBRARY_DEFAULT

// Demo credentials — defined once here, referenced everywhere
export const DEMO_ACCOUNT = 'demo@ai-office.local'
export const DEMO_PASSWORD = 'demo'

// ── process handles ───────────────────────────────────────────────────────────
let libraryProc: ChildProcess | null = null
let storeProc: ChildProcess | null = null
let engineProc: ChildProcess | null = null

// ── helpers ───────────────────────────────────────────────────────────────────

function getSkillPlatformDir(): string {
  return path.join(app.getAppPath(), 'skill_platform_next')
}

/** Returns true when a TCP connection to localhost:port succeeds within 1 s. */
export function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket()
    sock.setTimeout(1000)
    sock.once('connect', () => { sock.destroy(); resolve(true) })
    sock.once('error', () => { sock.destroy(); resolve(false) })
    sock.once('timeout', () => { sock.destroy(); resolve(false) })
    sock.connect(port, '127.0.0.1')
  })
}

/** Polls port every 500 ms until it's open or timeoutMs elapses. */
async function waitForPort(port: number, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await checkPort(port)) return true
    await new Promise<void>((r) => setTimeout(r, 500))
  }
  return false
}

/** Returns true when the URL responds to an HTTP request (any status counts as "up"). */
async function checkHttpAlive(url: string, timeoutMs = 4000): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return true
  } catch {
    return false
  }
}

/** Returns true when the URL's hostname is localhost / 127.0.0.1 / ::1. */
function isLocalUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  } catch {
    return false
  }
}

/** Spawns `node <scriptRelPath>` inside skill_platform_next directory. */
function spawnNodeScript(scriptRelPath: string, label: string): ChildProcess {
  const cwd = getSkillPlatformDir()
  const proc = spawn('node', [scriptRelPath], {
    cwd,
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  proc.stdout?.on('data', (d: Buffer) =>
    console.log(`[${label}]`, d.toString().trimEnd()))
  proc.stderr?.on('data', (d: Buffer) =>
    console.error(`[${label}]`, d.toString().trimEnd()))
  proc.on('exit', (code) =>
    console.log(`[${label}] exited (code=${code})`))
  return proc
}

// ── public API ────────────────────────────────────────────────────────────────

export async function ensureSkillLibraryRunning(): Promise<{ ok: boolean; error?: string }> {
  // Remote library: HTTP health check only — do not try to spawn a local process
  if (!isLocalUrl(LIBRARY_BASE)) {
    const alive = await checkHttpAlive(`${LIBRARY_BASE}/skills/entitlements`)
    if (alive) {
      console.log('[skillPlatform] library remote: reachable')
      return { ok: true }
    }
    return { ok: false, error: `Skill Library 远程服务不可达：${LIBRARY_BASE}（请检查网络或服务器状态）` }
  }

  // Local library: TCP check, spawn if needed
  if (await checkPort(4010)) {
    console.log('[skillPlatform] library:4010 already up')
    return { ok: true }
  }

  const skillDir = getSkillPlatformDir()
  try {
    await fs.access(skillDir)
  } catch {
    return { ok: false, error: `skill_platform_next 目录不存在：${skillDir}` }
  }

  console.log('[skillPlatform] Starting skill-library-backend...')
  libraryProc = spawnNodeScript('services/skill-library-backend/src/server.js', 'library:4010')

  const ready = await waitForPort(4010)
  if (!ready) {
    return { ok: false, error: 'skill-library-backend (port 4010) 启动超时，请检查 skill_platform_next 依赖是否已安装。' }
  }
  console.log('[skillPlatform] library:4010 ready')
  return { ok: true }
}

export async function ensureSkillStoreRunning(): Promise<{ ok: boolean; error?: string }> {
  // Remote store: HTTP health check only — do not try to spawn a local process
  if (!isLocalUrl(STORE_BASE)) {
    const alive = await checkHttpAlive(`${STORE_BASE}/api/store/skills`)
    if (alive) {
      console.log('[skillPlatform] store remote: reachable')
      return { ok: true }
    }
    return { ok: false, error: `Skill Store 远程服务不可达：${STORE_BASE}（请检查网络或服务器状态）` }
  }

  // Local store: TCP check, spawn if needed
  if (await checkPort(4030)) {
    console.log('[skillPlatform] store:4030 already up')
    return { ok: true }
  }

  const skillDir = getSkillPlatformDir()
  try {
    await fs.access(skillDir)
  } catch {
    return { ok: false, error: `skill_platform_next 目录不存在：${skillDir}` }
  }

  console.log('[skillPlatform] Starting skill-store-web...')
  storeProc = spawnNodeScript('apps/skill-store-web/server.js', 'store:4030')

  const ready = await waitForPort(4030)
  if (!ready) {
    return { ok: false, error: 'skill-store-web (port 4030) 启动超时，请检查 skill_platform_next/apps/skill-store-web/server.js 是否存在。' }
  }
  console.log('[skillPlatform] store:4030 ready')
  return { ok: true }
}

export async function ensureSkillEngineRunning(): Promise<{ ok: boolean; error?: string }> {
  if (await checkPort(4020)) {
    console.log('[skillPlatform] engine:4020 already up')
    return { ok: true }
  }

  const skillDir = getSkillPlatformDir()
  try {
    await fs.access(skillDir)
  } catch {
    return { ok: false, error: `skill_platform_next 目录不存在：${skillDir}` }
  }

  console.log('[skillPlatform] Starting skill-engine...')
  engineProc = spawnNodeScript('services/skill-engine/src/server.js', 'engine:4020')

  const ready = await waitForPort(4020)
  if (!ready) {
    return { ok: false, error: 'skill-engine (port 4020) 启动超时，请检查 skill_platform_next 依赖是否已安装。' }
  }
  console.log('[skillPlatform] engine:4020 ready')
  return { ok: true }
}

/** Ensures library (4010) then store (4030) are running. */
export async function ensureSkillPlatformRunning(): Promise<{ ok: boolean; error?: string }> {
  const lib = await ensureSkillLibraryRunning()
  if (!lib.ok) return lib

  const store = await ensureSkillStoreRunning()
  if (!store.ok) return store

  return { ok: true }
}

/** Login to the store web server and return a session token. */
export async function loginToStore(): Promise<{ ok: boolean; token?: string; user?: unknown; error?: string }> {
  try {
    const res = await fetch(`${STORE_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: DEMO_ACCOUNT, password: DEMO_PASSWORD }),
    })
    if (!res.ok) return { ok: false, error: `Store 登录失败：HTTP ${res.status}` }
    const data = await res.json() as { token?: string; user?: unknown }
    if (!data.token) return { ok: false, error: '登录响应中未包含 token' }
    return { ok: true, token: data.token, user: data.user }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Store 登录请求失败：${msg}` }
  }
}

/**
 * Builds a login URL for the Skill Store using account/password URL params.
 * The store SPA reads these params on load and auto-logs in without a form.
 */
export function buildStoreLoginUrl(account: string, password: string): string {
  const url = new URL('/login', STORE_BASE)
  url.searchParams.set('account', account)
  url.searchParams.set('password', password)
  return url.toString()
}

/**
 * Ensures the Skill Store is reachable and returns a login URL
 * using address-based auto-login (GET /login?account=&password=).
 * Only checks the store (4030) — does not require library (4010).
 * No token injection or localStorage manipulation needed.
 */
export async function getStoreEmbedUrl(): Promise<{ ok: boolean; url?: string; error?: string }> {
  const store = await ensureSkillStoreRunning()
  if (!store.ok) return { ok: false, error: store.error }
  return { ok: true, url: buildStoreLoginUrl(DEMO_ACCOUNT, DEMO_PASSWORD) }
}

export interface SkillSkinItem {
  skill_id: string
  name: string
  description?: string
  version: string
  package_id: string | null
  package_hash: string | null
  package_file: string | null
  size: number
  download_available: boolean
}

/**
 * List purchased/entitled Skill packages for a user.
 * Combines: entitlements (4010) + store skills list (4010) + sync-plan packages (4010) + per-package metadata.
 * Does NOT install anything.
 */
export async function listMySkins(userId = 'user_001'): Promise<{ ok: boolean; error?: string; skins?: SkillSkinItem[] }> {
  const lib = await ensureSkillLibraryRunning()
  if (!lib.ok) return { ok: false, error: lib.error }

  const internalHeaders = {
    Authorization: `Bearer ${INTERNAL_TOKEN}`,
    'Content-Type': 'application/json',
    'x-user-id': userId,
  }

  try {
    const [entRes, skillsRes, planRes] = await Promise.all([
      fetch(`${LIBRARY_BASE}/skills/entitlements`, { headers: internalHeaders }),
      fetch(`${LIBRARY_BASE}/store/skills`, { headers: { 'X-User-Id': userId } }),
      fetch(`${LIBRARY_BASE}/skills/sync-plan`, {
        method: 'POST',
        headers: internalHeaders,
        body: JSON.stringify({ device_id: 'device_001', installed_skills: [] }),
      }),
    ])

    type EntData    = { entitlements?: Array<{ skill_id: string; status?: string }> }
    type SkillEntry = { skill_id: string; name?: string; description?: string; purchased?: boolean; latest_version?: string }
    type PlanData   = { to_install?: Array<{ skill_id: string; package_id: string; version: string; size: number }> }

    const entData   = await entRes.json()   as EntData
    const allSkills = await skillsRes.json() as SkillEntry[]
    const planData  = await planRes.json()   as PlanData

    const entitledIds = new Set((entData.entitlements ?? []).map(e => e.skill_id))

    const skillMeta = new Map<string, { name?: string; description?: string; latest_version?: string }>()
    for (const s of (Array.isArray(allSkills) ? allSkills : [])) {
      skillMeta.set(s.skill_id, { name: s.name, description: s.description, latest_version: s.latest_version })
    }

    const purchasedSkills = Array.isArray(allSkills)
      ? allSkills.filter(s => s.purchased || entitledIds.has(s.skill_id))
      : []

    const pkgMap = new Map<string, { package_id: string; version: string; size: number }>()
    for (const item of (planData.to_install ?? [])) {
      pkgMap.set(item.skill_id, { package_id: item.package_id, version: item.version, size: item.size })
    }

    const skins = await Promise.all(
      purchasedSkills.map(async (skill): Promise<SkillSkinItem> => {
        const meta = skillMeta.get(skill.skill_id) ?? {}
        const pkgInfo = pkgMap.get(skill.skill_id)
        if (!pkgInfo) {
          return {
            skill_id: skill.skill_id,
            name: meta.name ?? skill.skill_id,
            description: meta.description,
            version: meta.latest_version ?? '?',
            package_id: null, package_hash: null, package_file: null,
            size: 0, download_available: false,
          }
        }
        try {
          const pkgRes = await fetch(`${LIBRARY_BASE}/skills/packages/${pkgInfo.package_id}`, { headers: internalHeaders })
          type PkgMeta = { package_hash?: string; package_file?: string; skin_path?: string; size?: number }
          const pkg: PkgMeta = pkgRes.ok ? await pkgRes.json() : {}
          return {
            skill_id: skill.skill_id,
            name: meta.name ?? skill.skill_id,
            description: meta.description,
            version: pkgInfo.version,
            package_id: pkgInfo.package_id,
            package_hash: pkg.package_hash ?? null,
            package_file: pkg.package_file ?? null,
            size: pkgInfo.size,
            download_available: !!(pkg.package_file || pkg.skin_path),
          }
        } catch {
          return {
            skill_id: skill.skill_id,
            name: meta.name ?? skill.skill_id,
            description: meta.description,
            version: pkgInfo.version,
            package_id: pkgInfo.package_id,
            package_hash: null, package_file: null,
            size: pkgInfo.size, download_available: false,
          }
        }
      }),
    )

    return { ok: true, skins }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `listMySkins 请求失败：${msg}` }
  }
}

export interface DownloadSkillResult {
  ok: true
  path: string
  filename: string
  sha256: string
  size: number
}

export interface DownloadSkillError {
  ok: false
  error: string
}

/**
 * Downloads a purchased .aoskin package to userData/skill-packages/<skillId>/.
 * Verifies SHA-256 when packageHash is provided.
 * Does NOT install — safe read-only operation.
 */
export async function downloadSkillPackage(payload: {
  skillId: string
  packageHash?: string
}): Promise<DownloadSkillResult | DownloadSkillError> {
  const { skillId, packageHash } = payload

  const platform = await ensureSkillPlatformRunning()
  if (!platform.ok) return { ok: false, error: platform.error ?? 'Skill Platform 未就绪' }

  // Get a fresh session token
  const login = await loginToStore()
  if (!login.ok || !login.token) return { ok: false, error: login.error ?? 'Store 登录失败' }

  try {
    const res = await fetch(`${STORE_BASE}/api/store/skills/${encodeURIComponent(skillId)}/aoskin`, {
      headers: { Authorization: `Bearer ${login.token}` },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, error: `下载失败：HTTP ${res.status} — ${body.slice(0, 200)}` }
    }

    // Derive filename from Content-Disposition or fallback
    const disposition = res.headers.get('content-disposition') ?? ''
    let filename = `${skillId}.aoskin`
    const match = disposition.match(/filename="([^"]+)"/)
    if (match?.[1]) filename = match[1]

    const buffer = Buffer.from(await res.arrayBuffer())

    // Compute SHA-256
    const { createHash } = await import('node:crypto')
    const sha256 = createHash('sha256').update(buffer).digest('hex')

    // Verify hash if provided
    if (packageHash) {
      const expected = packageHash.startsWith('sha256:') ? packageHash.slice(7) : packageHash
      if (sha256 !== expected) {
        return { ok: false, error: `Hash 校验失败：期望 ${expected}，实际 ${sha256}` }
      }
    }

    // Save to userData/skill-packages/<skillId>/<filename>
    const destDir = path.join(app.getPath('userData'), 'skill-packages', skillId)
    await fs.mkdir(destDir, { recursive: true })
    const destPath = path.join(destDir, filename)
    await fs.writeFile(destPath, buffer)

    return { ok: true, path: destPath, filename, sha256, size: buffer.length }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `downloadSkillPackage 异常：${msg}` }
  }
}

export interface RecognizeSkillResult {
  ok: boolean
  skill_type?: string
  name?: string
  templateId?: string
  error?: string
}

/**
 * Opens a downloaded .aoskin ZIP, reads manifest.json, and for ppt_template skills:
 *  - Extracts assets/template.pptx to userData/skill-templates/<skillId>/
 *  - Writes/updates userData/template-skills.json
 *  - Calls registerSkillTemplate() so it's available immediately without restart
 */
export async function recognizeSkillPackage(
  skillId: string,
  localPath: string,
  userDataPath: string,
): Promise<RecognizeSkillResult> {
  try {
    const JSZip = (await import('jszip')).default
    const rawBuffer = await fs.readFile(localPath)
    const zip = await JSZip.loadAsync(rawBuffer)

    const manifestFile = zip.file('manifest.json')
    if (!manifestFile) {
      return { ok: false, error: '.aoskin 中未找到 manifest.json' }
    }

    type SkillManifest = {
      skill_id?: string
      name?: string
      version?: string
      skill_type?: string
      capabilities?: string[]
      assets?: { template_pptx?: string }
    }
    const manifest: SkillManifest = JSON.parse(await manifestFile.async('string'))

    if (manifest.skill_type !== 'ppt_template') {
      return { ok: true, skill_type: manifest.skill_type, name: manifest.name }
    }

    if (!manifest.capabilities?.includes('ppt.generate.template')) {
      return { ok: false, error: 'PPT 模板 Skill 缺少 ppt.generate.template 能力声明' }
    }

    // Extract the template.pptx
    const pptxEntry = manifest.assets?.template_pptx ?? 'assets/template.pptx'
    const pptxFile = zip.file(pptxEntry)
    if (!pptxFile) {
      return { ok: false, error: `.aoskin 中未找到 ${pptxEntry}` }
    }

    const extractDir = path.join(userDataPath, 'skill-templates', skillId)
    await fs.mkdir(extractDir, { recursive: true })
    const extractedPptxPath = path.join(extractDir, 'template.pptx')
    const pptxBuffer = await pptxFile.async('nodebuffer')
    await fs.writeFile(extractedPptxPath, pptxBuffer)

    // Update template-skills.json
    const jsonPath = path.join(userDataPath, 'template-skills.json')
    let entries: import('./pptTemplateRegistry').SkillTemplateDef[] = []
    try {
      const raw = await fs.readFile(jsonPath, 'utf8')
      entries = JSON.parse(raw)
    } catch { /* first time */ }

    const idx = entries.findIndex((e) => e.skill_id === skillId)
    const def: import('./pptTemplateRegistry').SkillTemplateDef = {
      skill_id: skillId,
      name: manifest.name ?? skillId,
      version: manifest.version ?? '1.0.0',
      extracted_pptx_path: extractedPptxPath,
      enabled: true,
    }
    if (idx >= 0) entries[idx] = def
    else entries.push(def)
    await fs.writeFile(jsonPath, JSON.stringify(entries, null, 2), 'utf8')

    // Register immediately (no restart needed)
    const { registerSkillTemplate } = await import('./pptTemplateRegistry')
    registerSkillTemplate(def)

    return { ok: true, skill_type: 'ppt_template', name: def.name, templateId: skillId }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `recognizeSkillPackage 异常：${msg}` }
  }
}

export interface SkillSyncPlanResult {
  ok: boolean
  error?: string
  entitlements?: unknown[]
  plan?: {
    to_install: unknown[]
    to_update: unknown[]
    to_disable: unknown[]
    already_latest: unknown[]
  }
}

/**
 * Dry-run: fetch entitlements + sync-plan from library backend.
 * Does NOT call /engine/install — safe read-only check.
 */
export async function getSkillSyncPlan(
  userId = 'user_001',
  deviceId = 'device_001',
): Promise<SkillSyncPlanResult> {
  // ensure all three services are up
  const lib = await ensureSkillLibraryRunning()
  if (!lib.ok) return { ok: false, error: lib.error }

  const store = await ensureSkillStoreRunning()
  if (!store.ok) return { ok: false, error: store.error }

  const engine = await ensureSkillEngineRunning()
  if (!engine.ok) return { ok: false, error: engine.error }

  const headers = {
    Authorization: `Bearer ${INTERNAL_TOKEN}`,
    'Content-Type': 'application/json',
    'x-user-id': userId,
  }

  try {
    // 1. fetch entitlements
    const entRes = await fetch(`${LIBRARY_BASE}/skills/entitlements`, { headers })
    if (!entRes.ok) {
      return { ok: false, error: `entitlements 请求失败：HTTP ${entRes.status}` }
    }
    const entData = await entRes.json() as { skills?: unknown[] }
    const entitlements: unknown[] = entData.skills ?? (Array.isArray(entData) ? entData : [])

    // 2. create sync-plan (no locally installed skills yet)
    const planRes = await fetch(`${LIBRARY_BASE}/skills/sync-plan`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ device_id: deviceId, installed_skills: [] }),
    })
    if (!planRes.ok) {
      return { ok: false, error: `sync-plan 请求失败：HTTP ${planRes.status}` }
    }
    const plan = await planRes.json() as {
      to_install: unknown[]
      to_update: unknown[]
      to_disable: unknown[]
      already_latest: unknown[]
    }

    return { ok: true, entitlements, plan }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Skill 平台请求异常：${msg}` }
  }
}

/** Kill only the processes we spawned. Safe to call multiple times. */
export function stopSkillPlatform(): void {
  if (libraryProc && !libraryProc.killed) {
    console.log('[skillPlatform] Stopping skill-library-backend...')
    libraryProc.kill()
  }
  libraryProc = null

  if (storeProc && !storeProc.killed) {
    console.log('[skillPlatform] Stopping skill-store-web...')
    storeProc.kill()
  }
  storeProc = null

  if (engineProc && !engineProc.killed) {
    console.log('[skillPlatform] Stopping skill-engine...')
    engineProc.kill()
  }
  engineProc = null
}
