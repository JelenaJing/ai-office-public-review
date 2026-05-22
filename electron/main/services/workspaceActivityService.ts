/**
 * WorkspaceActivityService
 *
 * Records daily file snapshots of a workspace, diffs them to find changes,
 * extracts text from changed files, and generates per-file summaries and a
 * daily work report via LLM.
 *
 * Storage layout inside workspace:
 *   {workspace}/.activity-snapshots/YYYY-MM-DD.json
 *   {workspace}/.activity-reports/YYYY-MM-DD.json
 *
 * Only scans workspace-managed directories:
 *   document.json  (main manuscript)
 *   documents/     (exported manuscripts)
 *   ppt/           (generated PPTs)
 *   knowledge/     (knowledge-base imports)
 *
 * Does NOT scan: images/, node_modules, hidden dirs (except .activity-*)
 * Does NOT export full file text to renderer — only summaries.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import mammoth from 'mammoth'
import JSZip from 'jszip'
import { XMLParser } from 'fast-xml-parser'
import { completeText } from './llmClient'
import type { AppSettings } from './settingsStore'
import type {
  FileSnapshotEntry,
  WorkspaceSnapshot,
  FileChangeRecord,
  FileDiff,
  FileContentSummary,
  DailyActivityReport,
  WorkType,
  ProgressStage,
  OutcomeLevel,
} from '../../../src/types/workspaceActivity'
import type { DailyReportInput, WorkActivityEvent } from '../../../src/types/workActivityTypes'
import { userActionLogService } from './userActionLogService'

const execFileAsync = promisify(execFile)

// ── constants ────────────────────────────────────────────────────────────────

const SNAPSHOTS_DIR = '.activity-snapshots'
const REPORTS_DIR = '.activity-reports'

/** Directories to scan relative to workspace root */
const SCAN_RELATIVE_DIRS = ['documents', 'ppt', 'knowledge']
/** Extra individual files to track (relative to workspace root) */
const SCAN_RELATIVE_FILES = ['document.json']

/** Extensions we can extract text from */
const EXTRACTABLE_EXTS = new Set(['.docx', '.doc', '.pptx', '.txt', '.md', '.markdown', '.pdf', '.json'])

/** Max characters of file text sent to LLM per file */
const LLM_TEXT_MAX_CHARS = 3000

/** Max number of files analysed per day (to control LLM cost) */
const MAX_FILES_PER_DAY = 10

// ── XML helper for PPTX ──────────────────────────────────────────────────────

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  isArray: () => false,
})

function extractDrawingMlText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const parts: string[] = []
  for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
    const local = key.includes(':') ? key.split(':')[1] : key
    if (local === 't') {
      if (typeof val === 'string') parts.push(val)
      else if (typeof val === 'number') parts.push(String(val))
      else if (val && typeof val === 'object') {
        const text = (val as Record<string, unknown>)['#text']
        if (text !== undefined) parts.push(String(text))
      }
    } else if (local !== '#text' && local !== '@_' && !key.startsWith('@_')) {
      parts.push(extractDrawingMlText(val))
    }
  }
  return parts.join('')
}

// ── text extraction ───────────────────────────────────────────────────────────

const PDF_PYTHON_SCRIPT = `
import sys
path = sys.argv[1]
reader = None
for module_name in ('pypdf', 'PyPDF2'):
    try:
        if module_name == 'pypdf':
            from pypdf import PdfReader
        else:
            from PyPDF2 import PdfReader
        reader = PdfReader(path)
        break
    except Exception:
        pass
if reader is None:
    sys.exit(2)
parts = []
for page in reader.pages:
    try:
        parts.append(page.extract_text() or '')
    except Exception:
        parts.append('')
sys.stdout.write('\\n\\n'.join(parts))
`

async function extractPdfText(filePath: string): Promise<string> {
  for (const cmd of ['python3', 'python']) {
    try {
      const { stdout } = await execFileAsync(cmd, ['-c', PDF_PYTHON_SCRIPT, filePath], {
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
      })
      const text = normalizeText(stdout)
      if (text) return text
    } catch { /* try next */ }
  }
  return ''
}

async function extractDocxText(filePath: string): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ path: filePath })
    return normalizeText(result.value || '')
  } catch { return '' }
}

async function extractPptxText(filePath: string): Promise<string> {
  try {
    const buffer = await fs.readFile(filePath)
    const zip = await JSZip.loadAsync(buffer)
    const slideFiles = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
      .sort((a, b) => {
        const na = parseInt(a.match(/(\d+)/)?.[1] ?? '0', 10)
        const nb = parseInt(b.match(/(\d+)/)?.[1] ?? '0', 10)
        return na - nb
      })
    const texts: string[] = []
    for (const name of slideFiles) {
      const xml = await zip.file(name)?.async('string')
      if (!xml) continue
      const root = xmlParser.parse(xml) as Record<string, unknown>
      texts.push(extractDrawingMlText(root))
    }
    return texts.filter(Boolean).join('\n\n')
  } catch { return '' }
}

async function extractFileText(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.pdf') return extractPdfText(filePath)
  if (ext === '.docx' || ext === '.doc') return extractDocxText(filePath)
  if (ext === '.pptx') return extractPptxText(filePath)
  if (ext === '.txt' || ext === '.md' || ext === '.markdown') {
    try { return normalizeText(await fs.readFile(filePath, 'utf-8')) } catch { return '' }
  }
  // For .json (document.json): read and trim to avoid noise
  if (ext === '.json') {
    try {
      const raw = await fs.readFile(filePath, 'utf-8')
      // Extract only text-like content from schema (blocks[].text)
      return extractJsonDocumentText(raw)
    } catch { return '' }
  }
  return ''
}

function extractJsonDocumentText(raw: string): string {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    const texts: string[] = []
    const collect = (node: unknown) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) { node.forEach(collect); return }
      const record = node as Record<string, unknown>
      if (typeof record.text === 'string' && record.text.trim()) texts.push(record.text.trim())
      for (const val of Object.values(record)) collect(val)
    }
    collect(obj)
    return texts.join(' ').slice(0, 8000)
  } catch { return '' }
}

function normalizeText(raw: string): string {
  return (raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function getNestedStringValue(obj: unknown, pathParts: string[]): string {
  let current = obj
  for (const part of pathParts) {
    if (!current || typeof current !== 'object') return ''
    current = (current as Record<string, unknown>)[part]
  }
  return typeof current === 'string' ? current : ''
}

function isPaperDocumentJsonName(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return lower === 'document.json' || lower.endsWith('.aidoc.json') || lower.endsWith('.paper.json')
}

function isReferencesJsonName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.references.json')
}

function isConfigOrCacheJsonName(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return lower === 'package.json'
    || lower === 'package-lock.json'
    || lower === 'tsconfig.json'
    || lower.endsWith('.config.json')
    || lower.includes('cache')
}

function isAuxiliaryJsonEvidenceName(fileName: string): boolean {
  return isReferencesJsonName(fileName)
}

function isIgnoredJsonWorkArtifactName(fileName: string): boolean {
  return isConfigOrCacheJsonName(fileName)
}

function stripWorkspaceJsonSuffix(fileName: string): string {
  return fileName
    .replace(/\.aidoc\.json$/i, '')
    .replace(/\.paper\.json$/i, '')
    .replace(/\.references\.json$/i, '')
    .replace(/\.json$/i, '')
}

async function readJsonGeneratedBy(filePath: string): Promise<string> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    const obj = JSON.parse(raw) as Record<string, unknown>
    return getNestedStringValue(obj, ['metadata', 'generatedBy'])
  } catch {
    return ''
  }
}

async function isPaperGenerationJsonFile(absPath: string): Promise<boolean> {
  return (await readJsonGeneratedBy(absPath)) === 'paper-generation'
}

async function shouldScanWorkspaceJson(absPath: string, relPath: string, fileName: string): Promise<boolean> {
  const relParts = relPath.split('/')
  const inDocuments = relParts[0] === 'documents'
  if (!inDocuments) return false
  if (isPaperDocumentJsonName(fileName)) return true
  if (isReferencesJsonName(fileName) || isConfigOrCacheJsonName(fileName)) return false
  return isPaperGenerationJsonFile(absPath)
}

// ── hashing ───────────────────────────────────────────────────────────────────

async function hashFile(filePath: string): Promise<string> {
  try {
    const buf = await fs.readFile(filePath)
    return crypto.createHash('sha256').update(buf).digest('hex')
  } catch { return '' }
}

// ── date helpers ──────────────────────────────────────────────────────────────

function todayString(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function prevDayString(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── snapshot storage ──────────────────────────────────────────────────────────

function snapshotPath(workspacePath: string, dateStr: string): string {
  return path.join(workspacePath, SNAPSHOTS_DIR, `${dateStr}.json`)
}

function reportPath(workspacePath: string, dateStr: string): string {
  return path.join(workspacePath, REPORTS_DIR, `${dateStr}.json`)
}

async function readSnapshot(workspacePath: string, dateStr: string): Promise<WorkspaceSnapshot | null> {
  try {
    const raw = await fs.readFile(snapshotPath(workspacePath, dateStr), 'utf-8')
    return JSON.parse(raw) as WorkspaceSnapshot
  } catch { return null }
}

async function writeSnapshot(snapshot: WorkspaceSnapshot): Promise<void> {
  const dir = path.join(snapshot.workspacePath, SNAPSHOTS_DIR)
  await fs.mkdir(dir, { recursive: true })
  const p = snapshotPath(snapshot.workspacePath, snapshot.date)
  await fs.writeFile(p, JSON.stringify(snapshot, null, 2), 'utf-8')
}

async function writeReport(report: DailyActivityReport): Promise<void> {
  const dir = path.join(report.workspacePath, REPORTS_DIR)
  await fs.mkdir(dir, { recursive: true })
  const p = reportPath(report.workspacePath, report.date)
  await fs.writeFile(p, JSON.stringify(report, null, 2), 'utf-8')
}

// ── workspace scanning ────────────────────────────────────────────────────────

async function scanWorkspaceFiles(workspacePath: string): Promise<FileSnapshotEntry[]> {
  const entries: FileSnapshotEntry[] = []

  // Individual files (e.g. document.json)
  for (const relFile of SCAN_RELATIVE_FILES) {
    const absPath = path.join(workspacePath, relFile)
    try {
      const stat = await fs.stat(absPath)
      if (stat.isFile()) {
        const hash = await hashFile(absPath)
        entries.push({
          path: absPath,
          relativePath: relFile,
          fileName: path.basename(relFile),
          fileType: path.extname(relFile).replace('.', '').toLowerCase() || 'other',
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          hash,
        })
      }
    } catch { /* file doesn't exist, skip */ }
  }

  // Subdirectories
  for (const relDir of SCAN_RELATIVE_DIRS) {
    const absDir = path.join(workspacePath, relDir)
    try {
      await scanDir(absDir, relDir, workspacePath, entries)
    } catch { /* directory missing, skip */ }
  }

  return entries
}

async function scanDir(
  absDir: string,
  relDir: string,
  workspacePath: string,
  out: FileSnapshotEntry[],
): Promise<void> {
  let dirEntries: import('fs').Dirent[]
  try {
    dirEntries = (await fs.readdir(absDir, { withFileTypes: true })) as import('fs').Dirent[]
  } catch { return }

  for (const dirent of dirEntries) {
    const name = String(dirent.name)
    if (name.startsWith('.')) continue  // skip hidden
    const absPath = path.join(absDir, name)
    const relPath = path.posix.join(relDir, name)
    if (dirent.isDirectory()) {
      await scanDir(absPath, relPath, workspacePath, out)
    } else if (dirent.isFile()) {
      const ext = path.extname(name).toLowerCase()
      if (!EXTRACTABLE_EXTS.has(ext)) continue  // only track extractable types
      if (ext === '.json' && !(await shouldScanWorkspaceJson(absPath, relPath, name))) continue
      try {
        const stat = await fs.stat(absPath)
        const hash = await hashFile(absPath)
        out.push({
          path: absPath,
          relativePath: relPath,
          fileName: name,
          fileType: ext.replace('.', '') || 'other',
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          hash,
        })
      } catch { /* can't stat, skip */ }
    }
  }
}

// ── snapshot diff ─────────────────────────────────────────────────────────────

function diffSnapshots(
  today: FileSnapshotEntry[],
  base: FileSnapshotEntry[] | null,
  date: string,
  baseDate: string | null,
): FileDiff {
  const exportDirs = new Set(['documents', 'ppt'])

  if (!base) {
    // No baseline — all current files are "created"
    const created: FileChangeRecord[] = today.map((f) => ({ ...f, changeType: 'created' as const }))
    return { date, baseDate, created, modified: [], deleted: [], exported: [] }
  }

  const baseMap = new Map(base.map((f) => [f.relativePath, f]))
  const todayMap = new Map(today.map((f) => [f.relativePath, f]))

  const created: FileChangeRecord[] = []
  const modified: FileChangeRecord[] = []
  const deleted: FileChangeRecord[] = []
  const exported: FileChangeRecord[] = []

  for (const [relPath, entry] of todayMap) {
    const inExportDir = exportDirs.has(relPath.split('/')[0])
    const baseEntry = baseMap.get(relPath)
    if (!baseEntry) {
      const changeType: FileChangeRecord['changeType'] = inExportDir ? 'exported' : 'created'
      if (inExportDir) exported.push({ ...entry, changeType })
      else created.push({ ...entry, changeType })
    } else if (baseEntry.hash !== entry.hash) {
      const changeType: FileChangeRecord['changeType'] = inExportDir ? 'exported' : 'modified'
      if (inExportDir) exported.push({ ...entry, changeType })
      else modified.push({ ...entry, changeType })
    }
  }

  for (const [relPath, entry] of baseMap) {
    if (!todayMap.has(relPath)) {
      deleted.push({ ...entry, changeType: 'deleted' })
    }
  }

  return { date, baseDate, created, modified, deleted, exported }
}

// ── LLM analysis ──────────────────────────────────────────────────────────────

async function analyzeFileWithLlm(
  settings: AppSettings,
  entry: FileChangeRecord,
): Promise<FileContentSummary> {
  const blank: FileContentSummary = {
    filePath: entry.path,
    fileName: entry.fileName,
    changeType: entry.changeType,
    workType: 'other',
    taskName: isPaperDocumentJsonName(entry.fileName) ? stripWorkspaceJsonSuffix(entry.fileName) : stripFileExtension(entry.fileName),
    topic: '（无法读取内容）',
    progressStage: 'blocked',
    progressDelta: '',
    summary: '文件内容无法提取或为空',
    keyActions: [],
    outputValue: '',
    remainingIssues: ['文件内容无法提取或为空'],
    evidence: [`文件名：${entry.fileName}`, `变更类型：${changeTypeLabel(entry.changeType)}`],
    outcomeLevel: 'none',
    confidence: 0,
  }

  let text = ''
  try {
    text = await extractFileText(entry.path)
  } catch { /* leave blank */ }

  if (!text.trim()) return blank

  const excerpt = text.slice(0, LLM_TEXT_MAX_CHARS)
  const hasPaperGenerationMetadata = entry.fileType === 'json' && await isPaperGenerationJsonFile(entry.path)
  const isPaperJsonDocument = entry.fileType === 'json'
    && (isPaperDocumentJsonName(entry.fileName) || hasPaperGenerationMetadata)
  const paperJsonHint = isPaperJsonDocument
    ? '这是 AI Office 论文/正式文稿主文档 JSON，应优先按 formal、research 或 draft 判断 workType，不要归为 other。'
    : ''

  const prompt = `你是一个工作进展分析助手。以下是用户在 AI Office 中修改的一个文件内容节选。

文件名：${entry.fileName}
变更类型：${changeTypeLabel(entry.changeType)}
文件类型：${entry.fileType}
${paperJsonHint}

内容节选：
${excerpt}

请根据文件名、变更类型和内容节选，分析这个文件反映的“工作进展”，不是简单描述“修改了文件”。
用 JSON 格式返回（只返回 JSON，不要任何说明）：
{
  "workType": "draft|formal|email|ppt|research|notes|debugging|communication|other",
  "taskName": "归并后的任务名称，不要直接用文件名",
  "topic": "文件主题（一句话）",
  "progressStage": "planning|drafting|editing|reviewing|finalizing|exporting|debugging|communicating|blocked|completed",
  "progressDelta": "今天相对之前推进了什么，1-2句，例如从初稿生成推进到插图和引用修复",
  "summary": "文件内容变化摘要，2句以内，必须写推进了什么，不要只写修改了文件",
  "keyActions": ["关键动作1", "关键动作2"],
  "outputValue": "形成的阶段性成果或业务价值",
  "remainingIssues": ["仍未解决的问题"],
  "evidence": ["来自文件名、变更类型、文本片段的证据1", "证据2"],
  "outcomeLevel": "none|partial|substantial|completed",
  "confidence": 0.85
}
要求：
1. workType 只能是 draft, formal, email, ppt, research, notes, debugging, communication, other。
2. progressStage 只能是 planning, drafting, editing, reviewing, finalizing, exporting, debugging, communicating, blocked, completed。
3. outcomeLevel 只能是 none, partial, substantial, completed。
4. progressDelta 必须体现变化；如果看不出实质变化，说明“仅有保存/导出证据，实质推进不足”。
5. evidence 必须来自输入内容，不允许编造；导出产物只能作为佐证，不要夸大为核心工作。
6. 只有打开/保存且无实质内容变化时，outcomeLevel = none 或 partial。`

  try {
    const raw = await completeText(settings, {
      systemPrompt: '你是工作分析助手，只输出 JSON，不输出其他内容。',
      userPrompt: prompt,
      maxTokens: 500,
      temperature: 0.3,
    })
    const jsonStart = raw.indexOf('{')
    const jsonEnd = raw.lastIndexOf('}')
    if (jsonStart === -1 || jsonEnd === -1) return blank
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as Partial<FileContentSummary>
    const parsedWorkType = validateWorkType(parsed.workType)
    const evidence = Array.isArray(parsed.evidence) ? parsed.evidence.map(String) : []
    if (hasPaperGenerationMetadata && !evidence.includes('metadata.generatedBy=paper-generation')) {
      evidence.push('metadata.generatedBy=paper-generation')
    }
    return {
      filePath: entry.path,
      fileName: entry.fileName,
      changeType: entry.changeType,
      workType: parsedWorkType && (!isPaperJsonDocument || parsedWorkType !== 'other') ? parsedWorkType : 'formal',
      taskName: String(parsed.taskName || (isPaperJsonDocument ? stripWorkspaceJsonSuffix(entry.fileName) : stripFileExtension(entry.fileName))),
      topic: String(parsed.topic || '（未识别）'),
      progressStage: validateProgressStage(parsed.progressStage) ?? 'editing',
      progressDelta: String(parsed.progressDelta || ''),
      summary: String(parsed.summary || ''),
      keyActions: Array.isArray(parsed.keyActions) ? parsed.keyActions.map(String) : [],
      outputValue: String(parsed.outputValue || ''),
      remainingIssues: Array.isArray(parsed.remainingIssues) ? parsed.remainingIssues.map(String) : [],
      evidence,
      outcomeLevel: validateOutcomeLevel(parsed.outcomeLevel) ?? 'partial',
      confidence: typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5,
    }
  } catch {
    return blank
  }
}

function changeTypeLabel(ct: string): string {
  if (ct === 'created') return '新建'
  if (ct === 'modified') return '修改'
  if (ct === 'deleted') return '删除'
  if (ct === 'exported') return '导出'
  return ct
}

function stripFileExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '')
}

const VALID_WORK_TYPES = new Set<WorkType>(['draft', 'formal', 'email', 'ppt', 'research', 'notes', 'debugging', 'communication', 'other'])
function validateWorkType(v: unknown): WorkType | null {
  if (typeof v === 'string' && VALID_WORK_TYPES.has(v as WorkType)) return v as WorkType
  return null
}

const VALID_PROGRESS_STAGES = new Set<ProgressStage>(['planning', 'drafting', 'editing', 'reviewing', 'finalizing', 'exporting', 'debugging', 'communicating', 'blocked', 'completed'])
function validateProgressStage(v: unknown): ProgressStage | null {
  if (typeof v === 'string' && VALID_PROGRESS_STAGES.has(v as ProgressStage)) return v as ProgressStage
  return null
}

const VALID_OUTCOME_LEVELS = new Set<OutcomeLevel>(['none', 'partial', 'substantial', 'completed'])
function validateOutcomeLevel(v: unknown): OutcomeLevel | null {
  if (typeof v === 'string' && VALID_OUTCOME_LEVELS.has(v as OutcomeLevel)) return v as OutcomeLevel
  return null
}

// ── daily report generation ───────────────────────────────────────────────────

export interface ProgressTaskEvidence {
  taskName: string
  evidence: string[]
  files: string[]
  aiPrompts: string[]
  aiOutputs: string[]
  errors: string[]
  communications: string[]
  durationMs: number
  eventCount: number
  hasPrompt: boolean
  hasCompletion: boolean
  hasFailure: boolean
  inferredProgress: string
}

export interface ProgressEvidenceBundle {
  tasks: ProgressTaskEvidence[]
  text: string
  hasEffectiveActivity: boolean
}

interface MutableProgressTaskEvidence extends ProgressTaskEvidence {
  tokenSet: Set<string>
  rawSignals: string[]
  lastTsMs: number
}

const HIGH_VALUE_EVENT_TYPES = new Set<string>([
  'file_saved',
  'file_exported',
  'ppt_generated',
  'ppt_exported',
  'ai_prompt_submitted',
  'ai_task_completed',
  'ai_task_failed',
  'email_sent',
  'chat_message_sent',
  'attachment_sent',
  'error_occurred',
])

const LOW_VALUE_ACTIONS = new Set(['open', 'opened', 'view', 'viewed', 'focus', 'focused', 'navigate', 'navigation', 'switch', 'select'])

function getPayload(e: WorkActivityEvent): Record<string, unknown> {
  return (e.payload ?? {}) as Record<string, unknown>
}

function getPayloadString(payload: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number') return String(value)
  }
  return ''
}

function getPayloadStringArray(payload: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = payload[key]
    if (Array.isArray(value)) return value.map(String).filter(Boolean)
  }
  return []
}

function isMeaningfulActivityEvent(e: WorkActivityEvent): boolean {
  if (e.eventType === 'session_started' || e.eventType === 'session_ended') return false
  const action = (e.action ?? '').toLowerCase()
  if (e.eventType === 'file_opened') return false
  if (action && LOW_VALUE_ACTIONS.has(action)) return false
  return HIGH_VALUE_EVENT_TYPES.has(e.eventType) || action === 'save_document'
}

function eventTsMs(e: WorkActivityEvent): number {
  const ms = Date.parse(e.ts)
  return Number.isFinite(ms) ? ms : 0
}

function normalizeEvidenceText(text: string, maxLength = 120): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function collectEventSignals(e: WorkActivityEvent): string[] {
  const p = getPayload(e)
  return [
    e.targetTitle,
    e.targetId,
    e.module,
    e.action,
    e.errorMessage,
    getPayloadString(p, ['fileName']),
    getPayloadString(p, ['title']),
    getPayloadString(p, ['featureName']),
    getPayloadString(p, ['promptSummary']),
    getPayloadString(p, ['outputSummary']),
    getPayloadString(p, ['messageSummary']),
    getPayloadString(p, ['subjectSummary']),
    getPayloadString(p, ['conversationId']),
    ...getPayloadStringArray(p, ['changedFiles', 'files', 'fileNames']),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
}

function collectSummarySignals(summary: FileContentSummary): string[] {
  return [
    summary.taskName,
    summary.fileName,
    summary.topic,
    summary.progressDelta,
    summary.summary,
    summary.outputValue,
    ...(summary.keyActions ?? []),
    ...(summary.remainingIssues ?? []),
    ...(summary.evidence ?? []),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
}

function extractSemanticTokens(signals: string[]): Set<string> {
  const joined = signals.join(' ').toLowerCase()
  const tokens = new Set<string>()
  const addIf = (token: string, pattern: RegExp) => {
    if (pattern.test(joined)) tokens.add(token)
  }

  addIf('paper', /论文|paper|manuscript/)
  addIf('generation', /生成|generation|generate/)
  addIf('paper-doc-json', /\.aidoc\.json|\.paper\.json|generatedby.*paper-generation|paper-generation/)
  addIf('image', /图片|插图|图像|figure|image|img/)
  addIf('preservation', /保留|保存|preserv|retain/)
  addIf('reference', /引用|参考文献|reference|citation/)
  addIf('daily-report', /日报|daily report|工作进展|进展报告/)
  addIf('progress', /进展|推进|progress/)
  addIf('email', /邮件|email/)
  addIf('chat', /聊天|沟通|message|chat/)
  addIf('debugging', /修复|排查|异常|失败|错误|bug|debug|fix|error/)
  addIf('finalize', /finalize|定稿|收尾/)
  addIf('export', /导出|export/)

  for (const signal of signals) {
    const asciiMatches = signal.match(/[A-Za-z][A-Za-z0-9_]{2,}/g) ?? []
    for (const match of asciiMatches.slice(0, 6)) {
      const normalized = match.toLowerCase()
      if (!['the', 'and', 'for', 'with', 'file', 'save', 'task', 'completed'].includes(normalized)) {
        tokens.add(normalized)
      }
    }
  }
  return tokens
}

function tokenSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let overlap = 0
  for (const token of a) {
    if (b.has(token)) overlap += 1
  }
  return overlap / Math.min(a.size, b.size)
}

function inferPaperDocumentTaskName(signals: string[]): string | null {
  const joined = signals.join(' ')
  const match = joined.match(/([^\\/\s，。；:：]+?)\.(?:aidoc|paper|references)\.json/i)
  if (match?.[1]) return `${stripWorkspaceJsonSuffix(match[1])}文稿任务`
  if (/\.aidoc\.json|\.paper\.json|generatedBy.*paper-generation|paper-generation/i.test(joined)) return '论文生成链路'
  return null
}

function inferTaskNameFromSignals(signals: string[]): string {
  const joined = signals.join(' ')
  if (/(论文|paper|manuscript)/i.test(joined) && /(图片|插图|图像|figure|image|preserv|保留)/i.test(joined)) {
    return '论文生成链路图片保留问题'
  }
  const paperDocumentTask = inferPaperDocumentTaskName(signals)
  if (paperDocumentTask) return paperDocumentTask
  if (/(日报|daily report|工作进展|进展报告)/i.test(joined)) {
    return '工作日报进展报告优化'
  }
  if (/(邮件|email)/i.test(joined)) return '邮件沟通推进'
  if (/(聊天|沟通|message|chat)/i.test(joined)) return '沟通事项推进'

  const p = signals.map((s) => normalizeEvidenceText(s, 40)).find((s) => s && !/\.(tsx?|jsx?|json|docx?|pptx?|pdf|md)$/i.test(s))
  return p || '未命名工作任务'
}

function createMutableTask(signals: string[], tsMs: number): MutableProgressTaskEvidence {
  const tokenSet = extractSemanticTokens(signals)
  return {
    taskName: inferTaskNameFromSignals(signals),
    evidence: [],
    files: [],
    aiPrompts: [],
    aiOutputs: [],
    errors: [],
    communications: [],
    durationMs: 0,
    eventCount: 0,
    hasPrompt: false,
    hasCompletion: false,
    hasFailure: false,
    inferredProgress: '',
    tokenSet,
    rawSignals: signals,
    lastTsMs: tsMs,
  }
}

function findMatchingTask(tasks: MutableProgressTaskEvidence[], signals: string[], tsMs: number, eventType?: string): MutableProgressTaskEvidence | null {
  const tokens = extractSemanticTokens(signals)
  let best: MutableProgressTaskEvidence | null = null
  let bestScore = 0
  for (const task of tasks) {
    const score = tokenSimilarity(tokens, task.tokenSet)
    if (score > bestScore) {
      bestScore = score
      best = task
    }
  }
  if (best && bestScore >= 0.34) return best

  const lastTask = tasks[tasks.length - 1]
  const isWeakEvidence = eventType === 'file_saved' || eventType === 'file_exported' || eventType === 'error_occurred'
  if (lastTask && isWeakEvidence && tsMs > 0 && tsMs - lastTask.lastTsMs <= 30 * 60 * 1000) {
    return lastTask
  }
  return null
}

function addUnique(target: string[], value: string): void {
  const normalized = normalizeEvidenceText(value)
  if (normalized && !target.includes(normalized)) target.push(normalized)
}

function addSignalsToTask(task: MutableProgressTaskEvidence, signals: string[], tsMs: number): void {
  task.rawSignals.push(...signals)
  task.taskName = inferTaskNameFromSignals(task.rawSignals)
  for (const token of extractSemanticTokens(signals)) task.tokenSet.add(token)
  if (tsMs > 0) task.lastTsMs = tsMs
}

function getEventFileName(e: WorkActivityEvent): string {
  const p = getPayload(e)
  return e.targetTitle || getPayloadString(p, ['fileName', 'title'])
}

function isAuxiliaryJsonEvidenceEvent(e: WorkActivityEvent): boolean {
  const fileName = getEventFileName(e)
  return Boolean(fileName && isAuxiliaryJsonEvidenceName(path.basename(fileName)))
}

function isIgnoredJsonWorkArtifactEvent(e: WorkActivityEvent): boolean {
  const fileName = getEventFileName(e)
  return Boolean(fileName && isIgnoredJsonWorkArtifactName(path.basename(fileName)))
}

function eventEvidenceLine(e: WorkActivityEvent): string {
  const p = getPayload(e)
  const title = getEventFileName(e)
  const feature = getPayloadString(p, ['featureName'])
  const prompt = getPayloadString(p, ['promptSummary'])
  const output = getPayloadString(p, ['outputSummary'])
  const subject = getPayloadString(p, ['subjectSummary'])
  const message = getPayloadString(p, ['messageSummary'])

  if (title && isAuxiliaryJsonEvidenceName(path.basename(title))) return `辅助证据：${normalizeEvidenceText(title)}`
  if (e.eventType === 'ai_prompt_submitted') return `AI 提示词：${normalizeEvidenceText(prompt || feature || '已提交 AI 任务')}`
  if (e.eventType === 'ai_task_completed') return `完成事件：${normalizeEvidenceText(output || feature || 'AI 任务完成')}`
  if (e.eventType === 'ai_task_failed') return `异常：${normalizeEvidenceText(e.errorMessage || output || 'AI 任务失败')}`
  if (e.eventType === 'file_saved' || e.action === 'save_document') return `文件变更：${normalizeEvidenceText(title || '未命名文件')}（保存）`
  if (e.eventType === 'file_exported' || e.eventType === 'ppt_exported') return `文件产物：${normalizeEvidenceText(title || '未命名文件')}（导出）`
  if (e.eventType === 'ppt_generated') return `文件产物：${normalizeEvidenceText(title || '演示文稿')}（生成）`
  if (e.eventType === 'email_sent') return `邮件：${normalizeEvidenceText(subject || title || '已发送邮件')}`
  if (e.eventType === 'chat_message_sent') return `沟通：${normalizeEvidenceText(message || title || '已发送消息')}`
  if (e.eventType === 'attachment_sent') return `附件：${normalizeEvidenceText(title || '已发送附件')}`
  if (e.eventType === 'error_occurred') return `异常：${normalizeEvidenceText(e.errorMessage || '发生异常')}`
  return `${e.eventType}：${normalizeEvidenceText(title || feature || e.action || '')}`
}

function addEventToTask(task: MutableProgressTaskEvidence, e: WorkActivityEvent): void {
  const p = getPayload(e)
  const evidence = eventEvidenceLine(e)
  addUnique(task.evidence, evidence)
  task.eventCount += 1
  task.durationMs += e.durationMs ?? 0
  if (e.durationMs) addUnique(task.evidence, `耗时：约 ${Math.round(e.durationMs / 1000)} 秒`)

  const title = getEventFileName(e)
  const isAuxiliaryJson = title ? isAuxiliaryJsonEvidenceName(path.basename(title)) : false
  if (title && !isAuxiliaryJson && (e.eventType.startsWith('file_') || e.action === 'save_document')) addUnique(task.files, title)

  if (e.eventType === 'ai_prompt_submitted') {
    task.hasPrompt = true
    addUnique(task.aiPrompts, getPayloadString(p, ['promptSummary']) || getPayloadString(p, ['featureName']) || '已提交 AI 任务')
  }
  if (e.eventType === 'ai_task_completed') {
    task.hasCompletion = true
    addUnique(task.aiOutputs, getPayloadString(p, ['outputSummary']) || getPayloadString(p, ['featureName']) || 'AI 任务完成')
  }
  if (e.eventType === 'ai_task_failed') {
    task.hasFailure = true
    addUnique(task.errors, e.errorMessage || 'AI 任务失败')
  }
  if (e.eventType === 'error_occurred') {
    task.hasFailure = true
    addUnique(task.errors, e.errorMessage || '发生异常')
  }
  if (e.eventType === 'email_sent' || e.eventType === 'chat_message_sent') {
    addUnique(task.communications, evidence.replace(/^(邮件|沟通)：/, ''))
  }
}

function addSummaryToTask(tasks: MutableProgressTaskEvidence[], summary: FileContentSummary): void {
  if (isIgnoredJsonWorkArtifactName(summary.fileName)) return
  if (summary.outcomeLevel === 'none' && !summary.progressDelta && !summary.outputValue) return
  const signals = collectSummarySignals(summary)
  const matchedTask = findMatchingTask(tasks, signals, 0)
  const isAuxiliaryJson = isAuxiliaryJsonEvidenceName(summary.fileName)
  if (isAuxiliaryJson && !matchedTask) return
  const task = matchedTask ?? createMutableTask(signals, 0)
  if (!tasks.includes(task)) tasks.push(task)
  addSignalsToTask(task, signals, 0)

  const fileLabel = `${summary.fileName}（${changeTypeLabel(summary.changeType)}）`
  if (isAuxiliaryJson) {
    addUnique(task.evidence, `辅助证据：${fileLabel}`)
  } else {
    addUnique(task.files, summary.fileName)
    addUnique(task.evidence, summary.changeType === 'exported' ? `文件产物：${fileLabel}` : `文件分析：${fileLabel}`)
  }
  if (summary.progressDelta) addUnique(task.evidence, `进展变化：${summary.progressDelta}`)
  if (summary.outputValue) addUnique(task.aiOutputs, summary.outputValue)
  for (const issue of summary.remainingIssues ?? []) addUnique(task.errors, issue)
  if (summary.outcomeLevel === 'completed' || summary.outcomeLevel === 'substantial') task.hasCompletion = true
}

function normalizeRiskMessage(message: string): string {
  const normalized = normalizeEvidenceText(message, 60)
  if (/finalize/i.test(normalized) && /图片|image|图/.test(normalized) && /消失|丢失|missing|lost/i.test(normalized)) {
    return 'finalize 后图片消失'
  }
  return normalized
}

function inferTaskProgress(task: ProgressTaskEvidence): string {
  const firstRisk = task.errors[0] ? normalizeRiskMessage(task.errors[0]) : ''
  if (task.hasCompletion && firstRisk) return `${task.taskName}继续推进，但 ${firstRisk}仍是风险。`
  if (task.hasPrompt && !task.hasCompletion) return `${task.taskName}已发起/尝试处理，尚未看到结果事件。`
  if (task.hasCompletion) {
    const output = task.aiOutputs[0] ? `，阶段性成果是${task.aiOutputs[0]}` : ''
    return `${task.taskName}形成阶段性成果${output}。`
  }
  if (firstRisk) return `${task.taskName}出现异常，${firstRisk}需要继续处理。`
  if (task.files.length > 0) return `${task.taskName}有文件变更记录，但实质进展需结合内容确认。`
  return `${task.taskName}有工作线索，但日志证据不足。`
}

function finalizeProgressTasks(tasks: MutableProgressTaskEvidence[]): ProgressTaskEvidence[] {
  return tasks.map((task) => {
    const plain: ProgressTaskEvidence = {
      taskName: task.taskName,
      evidence: task.evidence,
      files: task.files,
      aiPrompts: task.aiPrompts,
      aiOutputs: task.aiOutputs,
      errors: task.errors,
      communications: task.communications,
      durationMs: task.durationMs,
      eventCount: task.eventCount,
      hasPrompt: task.hasPrompt,
      hasCompletion: task.hasCompletion,
      hasFailure: task.hasFailure,
      inferredProgress: '',
    }
    plain.inferredProgress = inferTaskProgress(plain)
    return plain
  })
}

function formatProgressEvidence(tasks: ProgressTaskEvidence[]): string {
  if (tasks.length === 0) return '【任务进展证据】\n无有效工作记录。'
  const lines = ['【任务进展证据】']
  for (const task of tasks) {
    lines.push(`- 任务：${task.taskName}`)
    lines.push('  证据：')
    const evidence = task.evidence.length > 0 ? task.evidence : ['日志证据不足']
    for (const item of evidence.slice(0, 8)) lines.push(`  - ${item}`)
    if (task.files.length > 0) lines.push(`  文件产物：${task.files.slice(0, 6).join('、')}`)
    if (task.aiOutputs.length > 0) lines.push(`  AI 输出摘要：${task.aiOutputs.slice(0, 3).join('；')}`)
    if (task.errors.length > 0) lines.push(`  异常/失败：${task.errors.slice(0, 3).join('；')}`)
    if (task.eventCount > 0) lines.push(`  事件数：${task.eventCount}`)
    if (task.durationMs > 0) lines.push(`  耗时：约 ${Math.round(task.durationMs / 1000)} 秒`)
    lines.push(`  推断：${task.inferredProgress}`)
  }
  return lines.join('\n')
}

export function buildProgressEvidence(
  activityContext: DailyReportInput | undefined,
  summaries: FileContentSummary[],
): ProgressEvidenceBundle {
  const tasks: MutableProgressTaskEvidence[] = []
  const events = (activityContext?.activityEvents ?? [])
    .filter(isMeaningfulActivityEvent)
    .sort((a, b) => eventTsMs(a) - eventTsMs(b))

  for (const summary of summaries) addSummaryToTask(tasks, summary)

  for (const event of events) {
    if (isIgnoredJsonWorkArtifactEvent(event)) continue
    const tsMs = eventTsMs(event)
    const signals = collectEventSignals(event)
    const matchedTask = findMatchingTask(tasks, signals, tsMs, event.eventType)
    if (isAuxiliaryJsonEvidenceEvent(event) && !matchedTask) continue
    const task = matchedTask ?? createMutableTask(signals, tsMs)
    if (!tasks.includes(task)) tasks.push(task)
    addSignalsToTask(task, signals, tsMs)
    addEventToTask(task, event)
  }

  const finalized = finalizeProgressTasks(tasks)
  return {
    tasks: finalized,
    text: formatProgressEvidence(finalized),
    hasEffectiveActivity: finalized.length > 0,
  }
}

export function buildDailyActivityReportFromProgressJson(
  date: string,
  username: string | undefined,
  summaries: FileContentSummary[],
  parsed: Record<string, unknown>,
): DailyActivityReport {
  const overview = String(parsed.overview || '')
  const progressSummary = String(parsed.progressSummary || parsed.mainWork || '')
  const keyMilestones = String(parsed.keyMilestones || parsed.keyOutputs || '')
  const evidenceBasedDetails = String(parsed.evidenceBasedDetails || parsed.fileOutputs || '')
  const blockersAndRisks = String(parsed.blockersAndRisks || parsed.anomalies || '')
  const aiContribution = String(parsed.aiContribution || parsed.aiUsage || '')
  const communicationProgress = String(parsed.communicationProgress || parsed.emailAndChat || '')
  const timeAndEffort = String(parsed.timeAndEffort || parsed.timeStats || '')
  const nextFocus = String(parsed.nextFocus || parsed.suggestions || '')
  const mdParts: string[] = []
  if (username) mdParts.push(`**${username}** 工作日报 · ${date}\n`)
  mdParts.push(`## 今日概览\n${overview || '无'}`)
  mdParts.push(`## 工作进展\n${progressSummary || '无'}`)
  mdParts.push(`## 阶段性成果\n${keyMilestones || '无'}`)
  mdParts.push(`## 证据依据\n${evidenceBasedDetails || '无'}`)
  mdParts.push(`## 阻塞与风险\n${blockersAndRisks || '无'}`)
  mdParts.push(`## AI 贡献\n${aiContribution || '无'}`)
  mdParts.push(`## 沟通推进\n${communicationProgress || '无'}`)
  mdParts.push(`## 时间投入\n${timeAndEffort || '无'}`)
  mdParts.push(`## 下一步焦点\n${nextFocus || '无'}`)

  return {
    date,
    workspacePath: '',
    username,
    generatedAt: new Date().toISOString(),
    overview,
    mainWork: progressSummary,
    keyOutputs: keyMilestones,
    comparison: '',
    workFocusChange: '',
    anomalies: blockersAndRisks,
    suggestions: nextFocus,
    progressSummary,
    keyMilestones,
    evidenceBasedDetails,
    blockersAndRisks,
    aiContribution,
    communicationProgress,
    timeAndEffort,
    nextFocus,
    fileOutputs: evidenceBasedDetails,
    timeStats: timeAndEffort,
    detailedMarkdown: mdParts.join('\n\n'),
    summaries,
  }
}

export function createNoEffectiveActivityReport(date: string, username: string | undefined, summaries: FileContentSummary[]): DailyActivityReport {
  const detailedMarkdown = [
    username ? `**${username}** 工作日报 · ${date}\n` : '',
    '## 今日概览\n今日无有效工作记录',
    '## 工作进展\n无',
    '## 阶段性成果\n无',
    '## 证据依据\n无',
    '## 阻塞与风险\n无',
    '## AI 贡献\n无',
    '## 沟通推进\n无',
    '## 时间投入\n无',
    '## 下一步焦点\n无',
  ].filter(Boolean).join('\n\n')

  return {
    date,
    workspacePath: '',
    username,
    generatedAt: new Date().toISOString(),
    overview: '今日无有效工作记录',
    mainWork: '无',
    keyOutputs: '无',
    comparison: '',
    workFocusChange: '',
    anomalies: '无',
    suggestions: '无',
    progressSummary: '无',
    keyMilestones: '无',
    evidenceBasedDetails: '无',
    blockersAndRisks: '无',
    aiContribution: '无',
    communicationProgress: '无',
    timeAndEffort: '无',
    nextFocus: '无',
    fileOutputs: '无',
    timeStats: '无',
    detailedMarkdown,
    summaries,
  }
}

async function generateDailyReportText(
  settings: AppSettings,
  date: string,
  summaries: FileContentSummary[],
  yesterdayReport: DailyActivityReport | null,
  username?: string,
  activityContext?: DailyReportInput,
): Promise<DailyActivityReport> {
  const progressEvidence = buildProgressEvidence(activityContext, summaries)
  if (!progressEvidence.hasEffectiveActivity && summaries.length === 0) {
    return createNoEffectiveActivityReport(date, username, summaries)
  }

  const summaryLines = summaries
    .map((s) => [
      `- 任务：${s.taskName || stripFileExtension(s.fileName)}`,
      `  文件：${s.fileName}（${changeTypeLabel(s.changeType)}，${s.topic}）`,
      `  阶段：${s.progressStage || '未识别'}；推进：${s.progressDelta || s.summary}`,
      `  成果：${s.outputValue || '无明确产出'}；未完成：${(s.remainingIssues ?? []).join('；') || '无明确记录'}`,
      `  证据：${(s.evidence ?? []).slice(0, 4).join('；') || '文件内容摘要'}`,
    ].join('\n'))
    .join('\n')

  const yesterdaySummary = yesterdayReport
    ? `昨日（${yesterdayReport.date}）日报概览：\n${yesterdayReport.overview}\n昨日主要工作：${yesterdayReport.mainWork}`
    : '无昨日日报可对比。'

  const userLabel = username ? `用户：${username}\n` : ''

  const prompt = `你是一个工作进展报告生成助手。请根据已归并的任务证据，生成一份管理者想看的每日工作进展报告。

${userLabel}日期：${date}

今日文件活动摘要：
${summaryLines || '今日没有检测到有效文件变更。'}

${progressEvidence.text}

${yesterdaySummary}

要求：
1. 主要写“推进了哪些工作、进展到什么阶段、产出了什么、还有什么风险”，不要罗列打开文件/保存文件/点击按钮。
2. 每条主工作必须包含“动作 + 结果 + 当前状态”。
3. 有证据才说完成；只有 ai_prompt_submitted 而没有 ai_task_completed 时，只能写“发起/尝试/推进”，不能写“完成”。
4. 如果有失败或异常，必须写入 blockersAndRisks，并说明影响和下一步处理方向。
5. nextFocus 是“下一步工作焦点”，必须来自今天日志中的未完成项或异常，最多 3 条；不要写泛泛建议。
6. AI 调用要按任务合并，说明实际辅助完成了什么；不要把所有调用列成流水账。
7. 如果日志证据不足，要明确写“日志证据不足”，不要编造。
8. 导出产物只作为佐证，不要夸大为核心工作成果。
9. 语言简洁，不要官话，不要夸大。

请用 JSON 格式返回（只返回 JSON，不要任何其他内容）：
{
  "overview": "今日整体进展，1-2句话，强调推进结果，不是事件列表",
  "progressSummary": "按任务归纳的进展，每条以 • 开头",
  "keyMilestones": "阶段性成果，每条以 • 开头，无则填无",
  "evidenceBasedDetails": "证据型说明：引用日志、文件变更、AI调用、通讯等证据，每条以 • 开头，无则填无",
  "blockersAndRisks": "阻塞、异常、失败、未完成事项，每条以 • 开头，无则填无",
  "aiContribution": "AI 实际贡献：辅助完成了什么、输出了什么、节省了什么，每条以 • 开头，无则填无",
  "communicationProgress": "沟通推进：通过邮件/聊天推进了什么事项，每条以 • 开头，无则填无",
  "timeAndEffort": "耗时和投入估计，基于日志 durationMs 和事件数量，不要编造，无则填无耗时数据",
  "nextFocus": "基于未完成事项推断下一步重点，最多3条，不要写泛泛建议"
}`

  const blank: DailyActivityReport = {
    date,
    workspacePath: '',
    username,
    generatedAt: new Date().toISOString(),
    overview: '日报生成失败，请检查 LLM 配置。',
    mainWork: '',
    keyOutputs: '',
    comparison: '',
    workFocusChange: '',
    anomalies: '',
    suggestions: '',
    progressSummary: '',
    keyMilestones: '',
    evidenceBasedDetails: '',
    blockersAndRisks: '',
    aiContribution: '',
    communicationProgress: '',
    timeAndEffort: '',
    nextFocus: '',
    fileOutputs: '',
    timeStats: '',
    summaries,
  }

  try {
    const raw = await completeText(settings, {
      systemPrompt: '你是工作日报生成助手，严格只输出 JSON，不输出任何说明或 markdown 代码块。',
      userPrompt: prompt,
      maxTokens: 1800,
      temperature: 0.4,
      featureName: 'workspaceActivity.dailyProgressReport',
    })
    const jsonStart = raw.indexOf('{')
    const jsonEnd = raw.lastIndexOf('}')
    if (jsonStart === -1 || jsonEnd === -1) return blank
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>
    return buildDailyActivityReportFromProgressJson(date, username, summaries, parsed)
  } catch {
    return blank
  }
}

// ── public API ────────────────────────────────────────────────────────────────

/** Take a snapshot of the workspace right now and persist it. */
export async function takeSnapshot(workspacePath: string): Promise<WorkspaceSnapshot> {
  const date = todayString()
  const files = await scanWorkspaceFiles(workspacePath)
  const snapshot: WorkspaceSnapshot = {
    date,
    workspacePath,
    createdAt: new Date().toISOString(),
    files,
  }
  await writeSnapshot(snapshot)
  return snapshot
}

/** Diff today vs a base date (default: yesterday). */
export async function getFileDiff(
  workspacePath: string,
  date?: string,
  baseDate?: string,
): Promise<FileDiff> {
  const targetDate = date || todayString()
  const baseDateStr = baseDate || prevDayString(targetDate)

  // Try reading existing snapshot for targetDate, or take a fresh one
  let todaySnap = await readSnapshot(workspacePath, targetDate)
  if (!todaySnap) {
    todaySnap = await takeSnapshot(workspacePath)
  }

  const baseSnap = await readSnapshot(workspacePath, baseDateStr)
  return diffSnapshots(todaySnap.files, baseSnap ? baseSnap.files : null, targetDate, baseSnap ? baseDateStr : null)
}

/** Analyse changed files with LLM and return per-file summaries. */
export async function analyzeChangedFiles(
  workspacePath: string,
  settings: AppSettings,
  date?: string,
): Promise<FileContentSummary[]> {
  const diff = await getFileDiff(workspacePath, date)
  const toAnalyze = [
    ...diff.created,
    ...diff.modified,
    ...diff.exported,
  ].slice(0, MAX_FILES_PER_DAY)

  const summaries: FileContentSummary[] = []
  for (const entry of toAnalyze) {
    const summary = await analyzeFileWithLlm(settings, entry)
    summaries.push(summary)
  }
  return summaries
}

/** Generate (or regenerate) a daily report and persist it. */
export async function generateDailyReport(
  workspacePath: string,
  settings: AppSettings,
  date?: string,
  username?: string,
): Promise<DailyActivityReport> {
  const targetDate = date || todayString()
  const prevDate = prevDayString(targetDate)

  const summaries = await analyzeChangedFiles(workspacePath, settings, targetDate)
  const yesterdayReport = await readReport(workspacePath, prevDate)

  // Load activity events from user-action-logs to enrich the LLM prompt
  let activityContext: DailyReportInput | undefined
  try {
    activityContext = await userActionLogService.buildDailyReportInput(targetDate)
  } catch {
    // Non-critical; proceed without activity context
  }

  const report = await generateDailyReportText(settings, targetDate, summaries, yesterdayReport, username, activityContext)
  report.workspacePath = workspacePath
  await writeReport(report)
  return report
}

/** Read a previously generated report without re-running LLM. */
export async function readReport(
  workspacePath: string,
  date?: string,
): Promise<DailyActivityReport | null> {
  const targetDate = date || todayString()
  try {
    const raw = await fs.readFile(reportPath(workspacePath, targetDate), 'utf-8')
    return JSON.parse(raw) as DailyActivityReport
  } catch { return null }
}
