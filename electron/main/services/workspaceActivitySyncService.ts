/**
 * WorkspaceActivitySyncService
 * Reads the local upload queue and sends records to AccountCenter activity API.
 * Never logs tokens or passwords.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { WorkspaceActivityQueue, type QueueRecord } from './workspaceActivityQueue'

const ACCOUNT_CENTER_URL = 'http://10.20.5.61:13100'

/** Endpoint for each record type */
const BATCH_ENDPOINTS: Record<string, string> = {
  snapshot:     `${ACCOUNT_CENTER_URL}/api/activity/snapshots/batch`,
  diff:         `${ACCOUNT_CENTER_URL}/api/activity/diffs/batch`,
  file_summary: `${ACCOUNT_CENTER_URL}/api/activity/file-summaries/batch`,
  daily_report: `${ACCOUNT_CENTER_URL}/api/activity/reports/batch`,
  job_status:   `${ACCOUNT_CENTER_URL}/api/activity/job-status/batch`,
}

export interface SyncStatus {
  lastSyncAt: number | null     // epoch ms
  lastSyncError: string | null
  pendingCount: number
}

export class WorkspaceActivitySyncService {
  private readonly userDataPath: string
  private readonly queue: WorkspaceActivityQueue
  private readonly tokenPath: string
  private readonly deviceIdPath: string
  private _deviceId: string | null = null
  private lastSyncAt: number | null = null
  private lastSyncError: string | null = null

  constructor(userDataPath: string) {
    this.userDataPath = userDataPath
    this.queue = new WorkspaceActivityQueue(userDataPath)
    this.tokenPath = path.join(userDataPath, 'internal-account-token.json')
    this.deviceIdPath = path.join(userDataPath, 'device-id.json')
  }

  private async getToken(): Promise<string | null> {
    try {
      const raw = await fs.readFile(this.tokenPath, 'utf-8')
      const data = JSON.parse(raw) as { token?: string }
      return typeof data.token === 'string' && data.token ? data.token : null
    } catch {
      return null
    }
  }

  async getDeviceId(): Promise<string> {
    if (this._deviceId) return this._deviceId
    try {
      const raw = await fs.readFile(this.deviceIdPath, 'utf-8')
      const data = JSON.parse(raw) as { deviceId?: string }
      if (typeof data.deviceId === 'string' && data.deviceId) {
        this._deviceId = data.deviceId
        return this._deviceId
      }
    } catch {
      // file doesn't exist — generate new
    }
    const id = randomUUID()
    await fs.writeFile(this.deviceIdPath, JSON.stringify({ deviceId: id }), 'utf-8')
    this._deviceId = id
    return id
  }

  getQueue(): WorkspaceActivityQueue {
    return this.queue
  }

  async enqueue(
    type: QueueRecord['recordType'],
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.queue.enqueue(type, payload)
    } catch {
      // Queue failures must never break the user's workflow
    }
  }

  async flush(timeoutMs = 10_000): Promise<{ sent: number; failed: number }> {
    const token = await this.getToken()
    if (!token) {
      this.lastSyncError = '未登录内部账号，跳过上传'
      return { sent: 0, failed: 0 }
    }

    const deviceId = await this.getDeviceId()
    const pending = await this.queue.listPending()
    if (pending.length === 0) {
      this.lastSyncAt = Date.now()
      this.lastSyncError = null
      return { sent: 0, failed: 0 }
    }

    // Group by type for batch upload
    const groups = new Map<string, QueueRecord[]>()
    for (const rec of pending) {
      const arr = groups.get(rec.recordType) ?? []
      arr.push(rec)
      groups.set(rec.recordType, arr)
    }

    let sent = 0
    let failed = 0

    for (const [type, recs] of groups) {
      const endpoint = BATCH_ENDPOINTS[type]
      if (!endpoint) continue

      // Mark all as uploading
      for (const r of recs) await this.queue.markUploading(r.queueId)

      // Enrich payloads with deviceId
      const records = recs.map((r) => ({ ...r.payload, deviceId }))

      try {
        const controller = new AbortController()
        const tid = setTimeout(() => controller.abort(), timeoutMs)
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ records }),
          signal: controller.signal,
        })
        clearTimeout(tid)

        if (resp.ok) {
          for (const r of recs) await this.queue.markUploaded(r.queueId)
          sent += recs.length
        } else {
          const msg = `HTTP ${resp.status}`
          for (const r of recs) await this.queue.markFailed(r.queueId, msg)
          failed += recs.length
          this.lastSyncError = msg
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        for (const r of recs) await this.queue.markFailed(r.queueId, msg)
        failed += recs.length
        this.lastSyncError = msg
      }
    }

    this.lastSyncAt = Date.now()
    if (failed === 0) this.lastSyncError = null
    await this.queue.compact()

    return { sent, failed }
  }

  async getStatus(): Promise<SyncStatus> {
    const stats = await this.queue.getStats()
    return {
      lastSyncAt: this.lastSyncAt,
      lastSyncError: this.lastSyncError,
      pendingCount: stats.pending,
    }
  }
}
