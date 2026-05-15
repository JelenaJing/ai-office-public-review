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
} from '../../../src/types/workspaceActivity'
import type { DailyReportInput } from '../../../src/types/workActivityTypes'
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
const EXTRACTABLE_EXTS = new Set(['.docx', '.doc', '.pptx', '.txt', '.md', '.markdown', '.pdf'])

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
    topic: '（无法读取内容）',
    summary: '文件内容无法提取或为空',
    keyActions: [],
    outputValue: '',
    confidence: 0,
  }

  let text = ''
  try {
    text = await extractFileText(entry.path)
  } catch { /* leave blank */ }

  if (!text.trim()) return blank

  const excerpt = text.slice(0, LLM_TEXT_MAX_CHARS)

  const prompt = `你是一个工作内容分析助手。以下是用户在 AI Office 中修改的一个文件内容节选。

文件名：${entry.fileName}
变更类型：${changeTypeLabel(entry.changeType)}
文件类型：${entry.fileType}

内容节选：
${excerpt}

请分析用户在这个文件上做了什么，用 JSON 格式返回（只返回 JSON，不要任何说明）：
{
  "workType": "draft 草稿|formal 正式文稿|email 邮件|ppt 演示文稿|research 研究资料|notes 笔记|other 其他（选一个关键词）",
  "topic": "文件主题（一句话）",
  "summary": "用户在此文件上的主要内容（2-3句）",
  "keyActions": ["动作1", "动作2"],
  "outputValue": "产出价值（简短）",
  "confidence": 0.85
}
workType 只能是以下之一：draft, formal, email, ppt, research, notes, other`

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
    return {
      filePath: entry.path,
      fileName: entry.fileName,
      changeType: entry.changeType,
      workType: validateWorkType(parsed.workType) ?? 'other',
      topic: String(parsed.topic || '（未识别）'),
      summary: String(parsed.summary || ''),
      keyActions: Array.isArray(parsed.keyActions) ? parsed.keyActions.map(String) : [],
      outputValue: String(parsed.outputValue || ''),
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

const VALID_WORK_TYPES = new Set<WorkType>(['draft', 'formal', 'email', 'ppt', 'research', 'notes', 'other'])
function validateWorkType(v: unknown): WorkType | null {
  if (typeof v === 'string' && VALID_WORK_TYPES.has(v as WorkType)) return v as WorkType
  return null
}

// ── daily report generation ───────────────────────────────────────────────────

async function generateDailyReportText(
  settings: AppSettings,
  date: string,
  summaries: FileContentSummary[],
  yesterdayReport: DailyActivityReport | null,
  username?: string,
  activityContext?: DailyReportInput,
): Promise<DailyActivityReport> {
  const summaryLines = summaries
    .map((s) => `- [${changeTypeLabel(s.changeType)}] ${s.fileName}（${s.topic}）：${s.summary}`)
    .join('\n')

  const yesterdaySummary = yesterdayReport
    ? `昨日（${yesterdayReport.date}）日报概览：\n${yesterdayReport.overview}\n昨日主要工作：${yesterdayReport.mainWork}`
    : '无昨日日报可对比。'

  const userLabel = username ? `用户：${username}\n` : ''

  // Build activity context section from user-action-logs
  let activitySection = ''
  if (activityContext && activityContext.activityEvents.length > 0) {
    const lines: string[] = []

    // File events
    const fileEvts = activityContext.fileEvents
    if (fileEvts.length > 0) {
      lines.push('【文件操作】')
      for (const e of fileEvts) {
        const p = (e.payload ?? {}) as Record<string, unknown>
        const title = (e.targetTitle ?? p.fileName ?? p.title ?? '') as string
        const durationNote = e.durationMs ? `，耗时 ${Math.round(e.durationMs / 1000)}s` : ''
        lines.push(`  - [${e.eventType}] ${title}${durationNote}`)
      }
    }

    // AI events
    const aiEvts = activityContext.aiEvents
    if (aiEvts.length > 0) {
      lines.push('【AI 使用】')
      for (const e of aiEvts) {
        const p = (e.payload ?? {}) as Record<string, unknown>
        if (e.eventType === 'ai_prompt_submitted') {
          const feat = (p.featureName ?? '') as string
          const model = (p.model ?? '') as string
          const prompt = (p.promptSummary ?? '') as string
          lines.push(`  - [AI提交] 功能: ${feat}, 模型: ${model}`)
          if (prompt) lines.push(`    提示词摘要: ${String(prompt).slice(0, 100)}`)
        } else if (e.eventType === 'ai_task_completed') {
          const feat = (p.featureName ?? '') as string
          const output = (p.outputSummary ?? '') as string
          const durationNote = e.durationMs ? ` 耗时 ${Math.round(e.durationMs / 1000)}s` : ''
          lines.push(`  - [AI完成] ${feat}${durationNote}`)
          if (output) lines.push(`    输出摘要: ${String(output).slice(0, 100)}`)
        } else if (e.eventType === 'ai_task_failed') {
          lines.push(`  - [AI失败] ${e.errorMessage ?? '未知错误'}`)
        }
      }
    }

    // Email events
    const emailEvts = activityContext.activityEvents.filter((e) => e.eventType === 'email_sent')
    if (emailEvts.length > 0) {
      lines.push('【邮件】')
      for (const e of emailEvts) {
        const p = (e.payload ?? {}) as Record<string, unknown>
        const subj = (p.subjectSummary ?? '') as string
        const domains = (p.toDomains ?? []) as string[]
        lines.push(`  - [发送邮件] 主题: ${subj}，收件人域: ${domains.join(', ')}`)
      }
    }

    // Chat events
    const chatEvts = activityContext.activityEvents.filter((e) => e.eventType === 'chat_message_sent')
    if (chatEvts.length > 0) {
      lines.push('【内部通讯】')
      for (const e of chatEvts) {
        const p = (e.payload ?? {}) as Record<string, unknown>
        const msgType = (p.messageType ?? 'text') as string
        const summary = (p.messageSummary ?? '') as string
        lines.push(`  - [发送消息] 类型: ${msgType}${summary ? `，摘要: ${summary}` : ''}`)
      }
    }

    // Error events
    const errorEvts = activityContext.activityEvents.filter((e) => e.eventType === 'error_occurred')
    if (errorEvts.length > 0) {
      lines.push('【异常】')
      for (const e of errorEvts) {
        lines.push(`  - [${e.errorCode ?? 'ERROR'}] ${e.errorMessage ?? ''}`)
      }
    }

    if (lines.length > 0) {
      activitySection = `\n今日行为日志：\n${lines.join('\n')}`
    }
  } else if (activityContext && activityContext.activityEvents.length === 0 && summaries.length === 0) {
    // No activity at all
    activitySection = '\n今日无任何记录行为。'
  }

  const prompt = `你是一个工作日报生成助手。请根据以下工作日志，生成一份完整的每日工作日报，包含所有章节。

${userLabel}日期：${date}

今日文件活动摘要：
${summaryLines || '今日没有检测到文件变更。'}
${activitySection}
${yesterdaySummary}

要求：
1. 有日志才总结，没有日志时 overview 输出"今日无工作记录"，其余字段输出"无"。
2. 不要编造，不要夸大。
3. fileOutputs 列出今日修改/生成的每个文件及其用途，如无则输出"无"。
4. aiUsage 列出调用了哪些 AI 功能、输入了什么提示词、生成了什么，如无则输出"无"。
5. emailAndChat 列出发送的邮件主题、收件人域、内部消息摘要，如无则输出"无"。
6. timeStats 列出各主要任务的大致耗时，如无耗时数据则输出"无耗时数据"。
7. anomalies 列出失败任务和异常，如无则输出"无"。
8. 不要生成明日建议。

请用 JSON 格式返回（只返回 JSON，不要任何其他内容）：
{
  "overview": "今日概览（1-2句话）",
  "mainWork": "今日主要工作（按条列出，每条以 • 开头换行）",
  "fileOutputs": "文件与产出（逐条列出文件名和操作描述，每条以 • 开头换行，如无则填写无）",
  "aiUsage": "AI 使用情况（列出 AI 功能名称、提示词摘要、输出内容摘要，每条以 • 开头换行，如无则填写无）",
  "emailAndChat": "邮件与内部通讯（列出发送邮件和内部消息摘要，每条以 • 开头换行，如无则填写无）",
  "timeStats": "耗时统计（各任务大致耗时，每条以 • 开头换行，如无耗时数据则填写无耗时数据）",
  "anomalies": "异常情况（列出失败任务和错误，每条以 • 开头换行，如无则填写无）"
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
    fileOutputs: '',
    timeStats: '',
    summaries,
  }

  try {
    const raw = await completeText(settings, {
      systemPrompt: '你是工作日报生成助手，严格只输出 JSON，不输出任何说明或 markdown 代码块。',
      userPrompt: prompt,
      maxTokens: 1400,
      temperature: 0.4,
    })
    const jsonStart = raw.indexOf('{')
    const jsonEnd = raw.lastIndexOf('}')
    if (jsonStart === -1 || jsonEnd === -1) return blank
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>
    const overview = String(parsed.overview || '')
    const mainWork = String(parsed.mainWork || '')
    const fileOutputs = String(parsed.fileOutputs || '')
    const aiUsage = String(parsed.aiUsage || '')
    const emailAndChat = String(parsed.emailAndChat || '')
    const timeStats = String(parsed.timeStats || '')
    const anomalies = String(parsed.anomalies || '')
    // Build combined detailedMarkdown
    const mdParts: string[] = []
    if (username) mdParts.push(`**${username}** 工作日报 · ${date}\n`)
    if (overview) mdParts.push(`## 今日概览\n${overview}`)
    if (mainWork && mainWork !== '无') mdParts.push(`## 主要工作\n${mainWork}`)
    if (fileOutputs && fileOutputs !== '无') mdParts.push(`## 文件与产出\n${fileOutputs}`)
    if (aiUsage && aiUsage !== '无') mdParts.push(`## AI 使用情况\n${aiUsage}`)
    if (emailAndChat && emailAndChat !== '无') mdParts.push(`## 邮件与内部通讯\n${emailAndChat}`)
    if (timeStats && timeStats !== '无耗时数据' && timeStats !== '无') mdParts.push(`## 耗时统计\n${timeStats}`)
    if (anomalies && anomalies !== '无') mdParts.push(`## 异常情况\n${anomalies}`)
    const detailedMarkdown = mdParts.join('\n\n')
    return {
      date,
      workspacePath: '',
      username,
      generatedAt: new Date().toISOString(),
      overview,
      mainWork,
      keyOutputs: fileOutputs,
      comparison: '',
      workFocusChange: '',
      anomalies,
      suggestions: '',
      fileOutputs,
      timeStats,
      detailedMarkdown,
      summaries,
    }
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
