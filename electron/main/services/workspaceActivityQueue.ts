/**
 * WorkspaceActivityQueue
 * Persists activity upload records locally so they survive app restarts.
 * Storage: {userData}/activity-upload-queue.json
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export type QueueRecordType =
  | 'snapshot'
  | 'diff'
  | 'file_summary'
  | 'daily_report'
  | 'job_status'

export type QueueStatus = 'pending' | 'uploading' | 'uploaded' | 'failed'

export interface QueueRecord {
  queueId: string
  recordType: QueueRecordType
  status: QueueStatus
  retryCount: number
  nextRetryAt: number   // epoch ms; 0 = immediate
  enqueuedAt: number
  lastAttemptAt?: number
  errorMessage?: string
  payload: Record<string, unknown>
}

interface QueueFile {
  version: 1
  records: QueueRecord[]
}

const MAX_RETRIES = 5
const BACKOFF_BASE_MS = 30_000   // 30 s

export class WorkspaceActivityQueue {
  private readonly queuePath: string
  private records: QueueRecord[] = []
  private loaded = false

  constructor(userDataPath: string) {
    this.queuePath = path.join(userDataPath, 'activity-upload-queue.json')
  }

  private async load(): Promise<void> {
    if (this.loaded) return
    try {
      const raw = await fs.readFile(this.queuePath, 'utf-8')
      const data = JSON.parse(raw) as QueueFile
      this.records = Array.isArray(data.records) ? data.records : []
    } catch {
      this.records = []
    }
    this.loaded = true
  }

  private async save(): Promise<void> {
    const data: QueueFile = { version: 1, records: this.records }
    await fs.writeFile(this.queuePath, JSON.stringify(data, null, 2), 'utf-8')
  }

  async enqueue(
    recordType: QueueRecordType,
    payload: Record<string, unknown>,
  ): Promise<string> {
    await this.load()
    const queueId = randomUUID()
    this.records.push({
      queueId,
      recordType,
      status: 'pending',
      retryCount: 0,
      nextRetryAt: 0,
      enqueuedAt: Date.now(),
      payload,
    })
    await this.save()
    return queueId
  }

  async listPending(): Promise<QueueRecord[]> {
    await this.load()
    const now = Date.now()
    return this.records.filter(
      (r) =>
        (r.status === 'pending' || r.status === 'failed') &&
        r.retryCount < MAX_RETRIES &&
        r.nextRetryAt <= now,
    )
  }

  async markUploading(queueId: string): Promise<void> {
    await this.load()
    const rec = this.records.find((r) => r.queueId === queueId)
    if (rec) {
      rec.status = 'uploading'
      rec.lastAttemptAt = Date.now()
    }
    await this.save()
  }

  async markUploaded(queueId: string): Promise<void> {
    await this.load()
    const rec = this.records.find((r) => r.queueId === queueId)
    if (rec) rec.status = 'uploaded'
    await this.save()
  }

  async markFailed(queueId: string, errorMessage: string): Promise<void> {
    await this.load()
    const rec = this.records.find((r) => r.queueId === queueId)
    if (rec) {
      rec.status = 'failed'
      rec.retryCount += 1
      rec.errorMessage = errorMessage
      // Exponential backoff
      rec.nextRetryAt = Date.now() + BACKOFF_BASE_MS * Math.pow(2, rec.retryCount - 1)
    }
    await this.save()
  }

  /** Remove uploaded records older than 7 days to keep file small */
  async compact(): Promise<void> {
    await this.load()
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
    this.records = this.records.filter(
      (r) => r.status !== 'uploaded' || r.enqueuedAt > cutoff,
    )
    await this.save()
  }

  async pendingCount(): Promise<number> {
    const pending = await this.listPending()
    return pending.length
  }

  async getStats(): Promise<{ pending: number; uploaded: number; failed: number }> {
    await this.load()
    const now = Date.now()
    return {
      pending: this.records.filter(
        (r) =>
          (r.status === 'pending' || r.status === 'uploading' || r.status === 'failed') &&
          r.retryCount < MAX_RETRIES &&
          r.nextRetryAt <= now,
      ).length,
      uploaded: this.records.filter((r) => r.status === 'uploaded').length,
      failed: this.records.filter(
        (r) => r.status === 'failed' && r.retryCount >= MAX_RETRIES,
      ).length,
    }
  }
}
