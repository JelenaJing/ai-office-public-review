/**
 * Excel / CSV 数据分析 — 四步流水线（与用户工作区解耦）：
 *
 * 1) 程序读表（无 LLM）：A1 顶格矩形校验；读表头；取前 5 行数据；按列粗推断 number/text/date 等。
 *
 * 1b) 若用户选择了数据模型、且未填写「分析需求」、且存在 temp/model_a 绘图脚本（优先 fit_table_beta4525.py），则只执行该脚本出图，跳过步骤 2/3 大模型。
 *
 * 2) 大模型 A（仅规划）：在结构 + 用户需求 + 内部默认策略说明上，输出 dimension_plan JSON
 *   （dimensions：每维 intent/列/aggregation/custom_expression；charts：类型、标题、绑定的维度 id）。
 *    本步结束即「维度与怎么算」已定，不生成代码。
 *
 * 3) 大模型 B（仅代码）：只接收第 1、2 步 JSON，写 Python；图表必须写入环境变量 AI_OFFICE_OUTPUT_DIR，
 *    且文件名固定为 excel_chart_01.png …（与 EXCEL_CHART_FILENAMES 一致）。
 *
 * 4) 主进程执行：脚本与 registry、dimension_plan.json 存于 app.getPath('userData')/excel-analysis-cache/ws-<hash>/…，
 *    打包后不会出现在用户项目目录；执行时 PYTHONPATH 可带上 userData 下 pip 安装的 python-site-packages。
 *    仅 PNG 输出到「当前工作区/excel-analysis-output」，供前端展示。
 *
 * 依赖：首次运行分析前自动 pip 预装 pandas / numpy / scipy / matplotlib 到 userData（有版本戳则跳过）；
 * 若执行脚本报 ModuleNotFoundError，则解析缺包名、自动 pip 安装并重试（限次数）。
 * 执行 LLM 生成代码仍有安全风险，请在受信环境使用。
 */
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import * as XLSX from 'xlsx'
import type { AppSettings } from './settingsStore'
import { completeText } from './llmClient'
import { exportExcelSheetToTempCsv, inspectExcelWorkbook } from './excelInspectService'
import { applyPlotDataModel, resolveBundledDataTableModelDir } from './plotDataModelService'

const OUTPUT_DIR_NAME = 'excel-analysis-output'
const REGISTRY_FILE = 'registry.json'
const SCRIPTS_SUB = 'scripts'
const PY_SITE_SUB = 'python-site-packages'
const PRESET_STAMP = '.excel-analysis-preset.stamp'

// ─── Python mode & executable resolution ──────────────────────────────────────
//
// EXCEL_ANALYSIS_PYTHON_MODE:
//   "external"  (default) – discover Python from the system (py -3 / python3 / python)
//   "bundled"             – use EXCEL_ANALYSIS_PYTHON_EXE pointing to a bundled interpreter
//
// TODO(bundled-python): When shipping a bundled Python interpreter:
//   1. Set env EXCEL_ANALYSIS_PYTHON_MODE=bundled
//   2. Set env EXCEL_ANALYSIS_PYTHON_EXE=<absolute path to bundled python.exe>
//   3. Ensure the bundled Python's DLLs and Lib directory are next to its executable.
//   No other code changes are required; all pip/run calls will use that executable.
//
const EXCEL_PYTHON_MODE = (process.env.EXCEL_ANALYSIS_PYTHON_MODE ?? 'external') as 'external' | 'bundled'
const EXCEL_PYTHON_EXE_OVERRIDE = (process.env.EXCEL_ANALYSIS_PYTHON_EXE ?? '').trim()

/** Python environment preparation state — broadcast to renderer via excel:envStatus. */
export type ExcelEnvStatus = 'idle' | 'checking' | 'installing' | 'rebuilding' | 'ready' | 'failed'

/** Which Python environment is in use for analysis. */
export type ExcelPythonMode = 'system' | 'app-cache'

/** Fully-resolved Python runtime used for spawning scripts. */
export interface PythonRuntime {
  mode: ExcelPythonMode
  /** Absolute path to python(.exe). Always use this for spawning. */
  executable: string
  version: string
  arch: string
  packages: Record<string, { ok: boolean; version?: string; file?: string; error?: string }>
}

// ─── IPC log sink (set once by main/index.ts after app ready) ─────────────────
type LogSink = (channel: string, payload: unknown) => void
let _logSink: LogSink | null = null

/** Call once from main/index.ts to wire up IPC broadcast to all renderer windows. */
export function setExcelAnalysisLogSink(sink: LogSink): void {
  _logSink = sink
}

function emitLog(message: string): void {
  _logSink?.('excel:envLog', { message, ts: new Date().toISOString() })
}

function emitEnvStatus(status: ExcelEnvStatus, message?: string): void {
  _logSink?.('excel:envStatus', { status, message })
}

/** Runtime-resolved Python interpreter information (cached for the process lifetime). */
interface ResolvedPython {
  /** Absolute path returned by sys.executable — stable, never a Windows launcher alias. */
  executable: string
  /** Full version string e.g. "3.11.9". */
  version: string
  /** "major.minor" e.g. "3.11" — used for ABI (.pyd) mismatch detection. */
  majorMinor: string
  /** "x64" | "x86" | "arm64" — derived from struct.calcsize('P')*8. */
  arch: string
}

/** JSON stamp persisted beside python-site-packages after a successful install. */
interface PresetStampJson {
  /** sys.executable of the Python used during install (absolute path). */
  pythonExecutable: string
  /** Full Python version e.g. "3.11.9". */
  pythonVersion: string
  /** "3.11" — for fast ABI mismatch detection without spawning Python. */
  pythonMajorMinor: string
  /** process.platform at install time. */
  platform: string
  /** "x64" | "x86" | "arm64" */
  arch: string
  /** Installed package names → actual versions, e.g. { numpy: "2.4.4" }. */
  packages: Record<string, string>
  createdAt: string
}

/** Module-level cache: resolved once per Electron main process lifecycle. */
let _cachedPython: ResolvedPython | null = null

const PYTHON_PROBE_CODE = [
  'import sys, struct, json',
  'bits = struct.calcsize("P") * 8',
  'arch = "arm64" if sys.platform == "darwin" and bits == 64 and "arm64" in sys.version.lower() else ("x64" if bits == 64 else "x86")',
  'print(json.dumps({"exe": sys.executable, "ver": sys.version.split()[0], "arch": arch}))',
].join('; ')

/**
 * Resolve and cache the Python executable for ALL Excel analysis operations.
 * pip install AND script execution always use the same resolved executable.
 */
async function resolvePythonExecutable(): Promise<ResolvedPython> {
  if (_cachedPython) return _cachedPython

  // Candidate commands in priority order.
  type Candidate = [string, string[]]
  const candidates: Candidate[] = EXCEL_PYTHON_EXE_OVERRIDE
    ? [[EXCEL_PYTHON_EXE_OVERRIDE, []]]
    : process.platform === 'win32'
      ? [['py', ['-3']], ['python', []]]
      : [['python3', []], ['python', []]]

  let lastErr: string = ''
  for (const [cmd, extraArgs] of candidates) {
    try {
      const out = await new Promise<string>((resolve, reject) => {
        const child = spawn(cmd, [...extraArgs, '-c', PYTHON_PROBE_CODE], {
          windowsHide: true,
          env: { ...process.env, PYTHONNOUSERSITE: '1' },
          cwd: os.tmpdir(),
        })
        let buf = ''
        child.stdout?.on('data', (c) => { buf += String(c) })
        child.stderr?.on('data', (c) => { lastErr += String(c) })
        child.on('error', (e) => reject(e))
        child.on('close', () => resolve(buf))
      })
      const jsonStart = out.indexOf('{')
      if (jsonStart >= 0) {
        const probe = JSON.parse(out.slice(jsonStart)) as { exe: string; ver: string; arch: string }
        if (probe.exe && probe.ver) {
          const majorMinor = probe.ver.split('.').slice(0, 2).join('.')
          _cachedPython = { executable: probe.exe, version: probe.ver, majorMinor, arch: probe.arch }
          return _cachedPython
        }
      }
    } catch (e) {
      lastErr += String(e)
    }
  }
  throw new Error(
    `未找到可用的 Python 3，请安装 Python 3.9+（https://www.python.org/downloads/）后重启应用。` +
    (EXCEL_PYTHON_EXE_OVERRIDE ? `\n已配置 EXCEL_ANALYSIS_PYTHON_EXE="${EXCEL_PYTHON_EXE_OVERRIDE}"` : '') +
    (lastErr ? `\n调试信息：${lastErr.slice(0, 400)}` : ''),
  )
}

/** 预装到 userData 的常用包（与第 3 步提示词约束一致；含 pandas 常用依赖） */
const PRESET_PIP_PACKAGES = ['pandas', 'numpy', 'openpyxl', 'scipy', 'matplotlib', 'python-dateutil'] as const

/** pip install timeout in ms — prevents pip from hanging indefinitely on network issues. */
const PIP_TIMEOUT_MS = Number(process.env.AI_OFFICE_PIP_TIMEOUT_MS || 300_000)

/** 仅允许自动 pip 补装与数据分析白名单一致的包（不扩展任意第三方） */
const PRESET_PIP_SET = new Set<string>(PRESET_PIP_PACKAGES)

function allowedAutoPipSpec(missingTop: string): string | null {
  const raw = String(missingTop || '').trim()
  if (!raw) return null
  const t = raw.toLowerCase()
  if (t === 'mpl_toolkits' || t === 'pylab') return 'matplotlib'
  if (t === 'dateutil') return 'python-dateutil'
  if (PRESET_PIP_SET.has(t)) return t
  return null
}

/** 自动 pip 补包后最多再跑 Python 的次数（不含首次运行） */
const MAX_AUTO_PIP_RETRIES = 5

// ─── System Python detection ───────────────────────────────────────────────────

/** Probe code: outputs JSON with executable, version, arch, and package availability. */
const SYSTEM_PYTHON_PROBE_CODE = [
  'import sys, platform, json',
  'pkgs = {}',
  "for name in ['numpy', 'pandas', 'matplotlib']:",
  '    try:',
  '        m = __import__(name)',
  "        pkgs[name] = {'ok': True, 'version': getattr(m, '__version__', ''), 'file': getattr(m, '__file__', '')}",
  '    except Exception as e:',
  "        pkgs[name] = {'ok': False, 'error': str(e)}",
  "print(json.dumps({'executable': sys.executable, 'version': sys.version.split()[0], 'arch': platform.architecture()[0], 'packages': pkgs}, ensure_ascii=False))",
].join('\n')

type SystemPkgInfo = { ok: boolean; version?: string; file?: string; error?: string }
type SystemProbeResult = { executable: string; version: string; arch: string; packages: Record<string, SystemPkgInfo> }

/** Spawn a single Python candidate and run the probe code with a hard timeout. */
function probeSystemPythonCandidate(
  cmd: string,
  extraArgs: string[],
  timeoutMs: number,
): Promise<SystemProbeResult | null> {
  return new Promise((resolve) => {
    let timedOut = false
    let stdout = ''
    let child: ReturnType<typeof spawn> | null = null

    try {
      child = spawn(cmd, [...extraArgs, '-c', SYSTEM_PYTHON_PROBE_CODE], {
        windowsHide: true,
        env: { ...process.env },
        cwd: os.tmpdir(),
      })
    } catch {
      resolve(null)
      return
    }

    const timer = setTimeout(() => {
      timedOut = true
      try { child?.kill('SIGTERM') } catch { /* ignore */ }
      resolve(null)
    }, timeoutMs)

    child.stdout?.on('data', (c: Buffer) => { stdout += String(c) })
    child.on('error', () => { clearTimeout(timer); resolve(null) })
    child.on('close', () => {
      clearTimeout(timer)
      if (timedOut) return
      try {
        const jsonStart = stdout.indexOf('{')
        if (jsonStart < 0) { resolve(null); return }
        const data = JSON.parse(stdout.slice(jsonStart)) as SystemProbeResult
        if (!data.executable || !data.version) { resolve(null); return }
        resolve(data)
      } catch {
        resolve(null)
      }
    })
  })
}

/** Cache of resolved system Python runtime: undefined = not yet probed; null = probed but not found. */
let _cachedSystemRuntime: PythonRuntime | null | undefined = undefined

/** Lock for ensureExcelPythonRuntime to prevent concurrent checks. */
let _runtimePromise: Promise<{ ok: boolean; runtime?: PythonRuntime; message: string }> | null = null

/**
 * Probe the system Python environment for numpy/pandas/matplotlib.
 * Returns a PythonRuntime if a suitable interpreter is found, null otherwise.
 * Uses an in-process cache: call with force=true to re-probe (used by rebuildExcelEnv).
 */
async function resolveSystemPythonRuntime(timeoutMs = 30_000, force = false): Promise<PythonRuntime | null> {
  if (!force && _cachedSystemRuntime !== undefined) return _cachedSystemRuntime

  type Candidate = [string, string[]]
  const candidates: Candidate[] = []

  const exeOverride = (
    process.env.EXCEL_ANALYSIS_PYTHON_EXE ||
    process.env.AI_OFFICE_PYTHON_EXE ||
    ''
  ).trim()

  if (exeOverride) {
    candidates.push([exeOverride, []])
  } else if (process.platform === 'win32') {
    candidates.push(['py', ['-3']])
    candidates.push(['python', []])
  } else {
    candidates.push(['python3', []])
    candidates.push(['python', []])
  }

  for (const [cmd, args] of candidates) {
    emitLog(`[excel-env] probing system Python: ${cmd} ${args.join(' ')}`)
    const info = await probeSystemPythonCandidate(cmd, args, timeoutMs)
    if (!info) {
      emitLog(`[excel-env] ${cmd}: no response or timeout`)
      continue
    }

    // Require Python >= 3.10
    const parts = info.version.split('.').map(Number)
    const major = parts[0] ?? 0
    const minor = parts[1] ?? 0
    if (major < 3 || (major === 3 && minor < 10)) {
      emitLog(`[excel-env] ${cmd}: Python ${info.version} < 3.10, skipping`)
      continue
    }

    // Require numpy, pandas, matplotlib (openpyxl is optional — scripts read CSV)
    const required = ['numpy', 'pandas', 'matplotlib'] as const
    const missingRequired = required.filter((name) => !info.packages[name]?.ok)
    if (missingRequired.length > 0) {
      emitLog(`[excel-env] ${cmd}: missing required packages: ${missingRequired.join(', ')}`)
      continue
    }

    const runtime: PythonRuntime = {
      mode: 'system',
      executable: info.executable,
      version: info.version,
      arch: info.arch,
      packages: info.packages,
    }
    emitLog(`[excel-env] System Python READY: ${info.executable} ${info.version} (${info.arch})`)
    for (const [name, pkg] of Object.entries(info.packages)) {
      emitLog(`[excel-env]   ${name}: ${pkg.ok ? `ok (${pkg.version})` : `MISSING — ${pkg.error}`}`)
    }
    _cachedSystemRuntime = runtime
    return runtime
  }

  emitLog('[excel-env] No suitable system Python found (numpy/pandas/matplotlib not all available)')
  _cachedSystemRuntime = null
  return null
}

/** Single shared promise for ensurePresetPythonDependencies — prevents concurrent pip runs. Declared in ensurePresetPythonDependencies section below. */

/** 固定图表文件名（与第 3 步提示词一致，便于前端与测试断言） */
export const EXCEL_CHART_FILENAMES = ['excel_chart_01.png', 'excel_chart_02.png', 'excel_chart_03.png', 'excel_chart_04.png'] as const

export interface ExcelAnalysisRegistryEntry {
  id: string
  signature: string
  headersSorted: string[]
  /** 生成该脚本时使用的预处理模型 ID；空字符串表示未套用模型（与旧缓存兼容） */
  dataModelId?: string
  slug: string
  purpose: string
  relFolder: string
  createdAt: string
  lastUsedAt?: string
}

export interface ExcelAnalysisRunInput {
  workspacePath: string
  sourcePath: string
  userRequirement: string
  /** 与绘图模块共用的预处理模型 ID，例如 model_a；空表示不套用 */
  dataModelId?: string
}

export interface ColumnProfile {
  name: string
  inferredKind: 'number' | 'text' | 'date' | 'boolean' | 'mixed' | 'mostly_empty'
  sampleValues: string[]
}

export interface Step1StructureResult {
  ok: boolean
  headers: string[]
  notes: string[]
  sampleRows: string[][]
  columns: ColumnProfile[]
}

export interface ExcelAnalysisRunResult {
  ok: boolean
  error?: string
  /** 第 1 步：结构快照 */
  structure?: Step1StructureResult
  /** 第 2 步：维度与运算规划（大模型 A） */
  dimensionPlan?: Record<string, unknown>
  /** 第 3 步：仅表示已生成脚本（不返回源码） */
  scriptRelFolder?: string
  reusedScript?: boolean
  stdout?: string
  stderr?: string
  /** 工作区内可见输出路径 */
  outputImages?: string[]
  /** 输出目录（绝对路径，供调试） */
  outputDir?: string
  analysis?: Record<string, unknown>
}

function workspaceCacheKey(workspacePath: string): string {
  const abs = path.resolve(String(workspacePath || ''))
  return `ws-${crypto.createHash('sha256').update(abs, 'utf8').digest('hex').slice(0, 20)}`
}

function cacheRootForWorkspace(workspacePath: string): string {
  return path.join(app.getPath('userData'), 'excel-analysis-cache', workspaceCacheKey(workspacePath))
}

function pythonSitePackagesDir(): string {
  return path.join(app.getPath('userData'), 'excel-analysis-cache', PY_SITE_SUB)
}

function scriptsRoot(workspacePath: string): string {
  return path.join(cacheRootForWorkspace(workspacePath), SCRIPTS_SUB)
}

function outputRoot(workspacePath: string): string {
  return path.join(workspacePath, OUTPUT_DIR_NAME)
}

function readRegistry(workspacePath: string): ExcelAnalysisRegistryEntry[] {
  const fp = path.join(cacheRootForWorkspace(workspacePath), REGISTRY_FILE)
  if (!fs.existsSync(fp)) return []
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf-8')) as { entries?: ExcelAnalysisRegistryEntry[] }
    return Array.isArray(raw.entries) ? raw.entries : []
  } catch {
    return []
  }
}

function writeRegistry(workspacePath: string, entries: ExcelAnalysisRegistryEntry[]): void {
  const root = cacheRootForWorkspace(workspacePath)
  fs.mkdirSync(root, { recursive: true })
  const fp = path.join(root, REGISTRY_FILE)
  fs.writeFileSync(fp, JSON.stringify({ entries }, null, 2), 'utf-8')
}

function sortedHeaderSignature(headers: string[]): { sorted: string[]; signature: string } {
  const sorted = headers.map((h) => String(h || '').trim()).filter(Boolean).sort((a, b) => a.localeCompare(b))
  const signature = crypto.createHash('sha256').update(sorted.join('|'), 'utf8').digest('hex').slice(0, 20)
  return { sorted, signature }
}

function normalizeDataModelKey(id: unknown): string {
  return String(id ?? '').trim()
}

function parseJsonFileSafe(filePath: string): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

/**
 * 模型可声明输出文件清单（manifest.outputFiles）或输出数量（manifest.outputCount）。
 * 若未声明则默认 1 张图：excel_chart_01.png
 */
function resolveModelExpectedChartFiles(modelId: string): string[] {
  const id = normalizeDataModelKey(modelId)
  if (!id) return []
  const root = resolveBundledDataTableModelDir(id)
  if (!root) return ['excel_chart_01.png']

  const manifestPath = path.join(root, 'manifest.json')
  const manifest = parseJsonFileSafe(manifestPath)
  if (!manifest) return ['excel_chart_01.png']

  const explicit = Array.isArray(manifest.outputFiles)
    ? (manifest.outputFiles as unknown[])
      .map((x) => String(x || '').trim())
      .filter(Boolean)
    : []
  if (explicit.length > 0) return explicit

  const outputCount = Number(manifest.outputCount)
  if (Number.isFinite(outputCount) && outputCount > 0) {
    const n = Math.min(16, Math.max(1, Math.floor(outputCount)))
    return Array.from({ length: n }, (_, i) => `excel_chart_${String(i + 1).padStart(2, '0')}.png`)
  }
  return ['excel_chart_01.png']
}

function removeExistingChartFiles(outputDir: string, names: string[]): void {
  for (const n of names) {
    const abs = path.join(outputDir, String(n || '').trim())
    try {
      if (fs.existsSync(abs)) fs.unlinkSync(abs)
    } catch {
      // ignore
    }
  }
}

/** 模型绘图脚本解析：优先 temp/model_a 原脚本（batch 入口），再回退适配入口 */
function resolveBuiltinPlotScript(modelId: string): string | null {
  const root = resolveBundledDataTableModelDir(modelId)
  if (!root) return null
  const candidates = [
    path.join(root, 'fit_table_beta4525.py'),
    path.join(root, 'fit_table_beta4525_adapter.py'),
    path.join(root, 'plot_builtin.py'),
    path.join(root, 'main.py'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function findReusableEntry(
  entries: ExcelAnalysisRegistryEntry[],
  sorted: string[],
  dataModelId: string,
): ExcelAnalysisRegistryEntry | null {
  const key = sorted.join('\u0001')
  const modelKey = normalizeDataModelKey(dataModelId)
  for (const e of entries) {
    if (e.headersSorted.join('\u0001') !== key) continue
    if (normalizeDataModelKey(e.dataModelId) !== modelKey) continue
    return e
  }
  return null
}

function isExcelPath(p: string): boolean {
  return /\.xlsx?$/i.test(p)
}

function isCsvPath(p: string): boolean {
  return /\.csv$/i.test(p)
}

/** 主进程打包后 xlsx.readFile 会报 Cannot access file；用 fs + buffer 解析 */
function readSpreadsheetWorkbook(absPath: string): XLSX.WorkBook {
  const buf = fs.readFileSync(absPath)
  return XLSX.read(buf, { type: 'buffer', cellDates: true, cellFormula: true })
}

/** 工作表必须为单一矩形且左上角为 A1 */
export function validateSingleTableFromA1(filePath: string, sheetName?: string): { ok: boolean; headers: string[]; notes: string[] } {
  const notes: string[] = []
  if (!fs.existsSync(filePath)) {
    return { ok: false, headers: [], notes: ['文件不存在'] }
  }
  const book = readSpreadsheetWorkbook(filePath)
  const names = book.SheetNames
  if (!names.length) return { ok: false, headers: [], notes: ['无法读取工作簿'] }
  const active = sheetName && names.includes(sheetName) ? sheetName : names[0]
  const ws = book.Sheets[active]
  const ref = ws?.['!ref']
  if (!ref) return { ok: false, headers: [], notes: ['工作表为空'] }
  const range = XLSX.utils.decode_range(ref)
  if (range.s.r !== 0 || range.s.c !== 0) {
    return {
      ok: false,
      headers: [],
      notes: ['数据必须从 A1 开始顶格放置（当前已用区域未从左上角开始）。'],
    }
  }
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][]
  const headerRow = Array.isArray(rows[0]) ? rows[0] : []
  const headers = headerRow.map((c) => String(c ?? '').trim())
  if (!headers.some(Boolean)) {
    return { ok: false, headers: [], notes: ['首行表头为空'] }
  }
  notes.push(`已校验：单表矩形区域自 A1 起，工作表「${active}」。`)
  return { ok: true, headers, notes }
}

function inferCellKind(value: unknown): 'number' | 'text' | 'date' | 'boolean' | 'empty' {
  if (value === null || value === undefined || value === '') return 'empty'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number' && Number.isFinite(value)) return 'number'
  if (value instanceof Date && !Number.isNaN(value.getTime())) return 'date'
  const s = String(value).trim()
  if (!s) return 'empty'
  if (/^(true|false)$/i.test(s)) return 'boolean'
  if (!Number.isNaN(Number(s)) && s !== '' && !/^0\d/.test(s)) {
    const n = Number(s)
    if (Number.isFinite(n)) return 'number'
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) return 'date'
  return 'text'
}

function mergeKinds(kinds: Array<'number' | 'text' | 'date' | 'boolean' | 'empty'>): ColumnProfile['inferredKind'] {
  const nonEmpty = kinds.filter((k) => k !== 'empty')
  if (nonEmpty.length === 0) return 'mostly_empty'
  const set = new Set(nonEmpty)
  if (set.size === 1) {
    const only = [...set][0]
    if (only === 'number') return 'number'
    if (only === 'date') return 'date'
    if (only === 'boolean') return 'boolean'
    return 'text'
  }
  return 'mixed'
}

/** 第 1 步：读表头 + 前 5 行数据 + 列粗推断（程序完成，不调大模型） */
export function buildStep1Structure(sourcePath: string): Step1StructureResult {
  const notes: string[] = []
  const v = validateSingleTableFromA1(sourcePath)
  notes.push(...v.notes)
  if (!v.ok) {
    return { ok: false, headers: v.headers, notes, sampleRows: [], columns: [] }
  }
  const book = readSpreadsheetWorkbook(sourcePath)
  const ws = book.Sheets[book.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][]
  const headers = (rows[0] as unknown[]).map((c) => String(c ?? '').trim())
  const dataRows = rows.slice(1, 6) as unknown[][]
  const sampleRows: string[][] = dataRows.map((row) =>
    headers.map((_, i) => {
      const cell = Array.isArray(row) ? row[i] : undefined
      if (cell instanceof Date) return cell.toISOString().slice(0, 10)
      return String(cell ?? '')
    }),
  )
  const columns: ColumnProfile[] = headers.map((name, colIndex) => {
    const kinds: Array<'number' | 'text' | 'date' | 'boolean' | 'empty'> = []
    const sampleValues: string[] = []
    for (const row of dataRows) {
      const cell = Array.isArray(row) ? row[colIndex] : undefined
      kinds.push(inferCellKind(cell))
      if (cell instanceof Date) sampleValues.push(cell.toISOString().slice(0, 10))
      else sampleValues.push(String(cell ?? ''))
    }
    return { name, inferredKind: mergeKinds(kinds), sampleValues }
  })
  notes.push('第 1 步：已读取前 5 行样本并完成列类型粗推断（程序侧，未调用大模型）。')
  return { ok: true, headers, notes, sampleRows, columns }
}

function materializeInputCsv(sourcePath: string): { csvPath: string; cleanup?: () => void } {
  if (isCsvPath(sourcePath)) {
    return { csvPath: sourcePath }
  }
  if (isExcelPath(sourcePath)) {
    const inspect = inspectExcelWorkbook(sourcePath)
    const { tempPath } = exportExcelSheetToTempCsv(sourcePath, inspect.activeSheet)
    return {
      csvPath: tempPath,
      cleanup: () => {
        try {
          fs.unlinkSync(tempPath)
        } catch {
          // ignore
        }
      },
    }
  }
  throw new Error('仅支持 .xlsx / .xls / .csv')
}

function extractPythonFromLlm(text: string): string {
  const fence = text.match(/```(?:python|py)?\s*([\s\S]*?)```/i)
  if (fence) return fence[1].trim()
  return text.trim()
}

function extractJsonFromStdout(stdout: string): Record<string, unknown> | null {
  const lines = stdout.split(/\r?\n/).reverse()
  for (const line of lines) {
    const idx = line.indexOf('EXCEL_ANALYSIS_RESULT_JSON:')
    if (idx >= 0) {
      try {
        return JSON.parse(line.slice(idx + 'EXCEL_ANALYSIS_RESULT_JSON:'.length).trim()) as Record<string, unknown>
      } catch {
        return null
      }
    }
  }
  return null
}

function parseJsonObjectFromLlm(text: string): Record<string, unknown> {
  const cleaned = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  return JSON.parse(cleaned) as Record<string, unknown>
}

/** Script execution timeout — configurable via env, default 90 s. */
const EXCEL_SCRIPT_TIMEOUT_MS = Number(process.env.AI_OFFICE_EXCEL_SCRIPT_TIMEOUT_MS || 90_000)

interface SpawnPythonOpts {
  /** Called with each stdout/stderr chunk as it arrives (real-time). */
  onData?: (chunk: string, stream: 'stdout' | 'stderr') => void
  /** If set, emits a heartbeat line via onData every N ms. */
  heartbeatMs?: number
}

/**
 * Low-level process launcher.
 * - Never rejects; always resolves.
 * - Kills with SIGTERM + taskkill (Windows) on timeout.
 * - Returns timedOut:true when killed by timer.
 */
function spawnPythonOnce(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  opts?: SpawnPythonOpts,
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, cwd, windowsHide: true })
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false

    const killChild = () => {
      try { child.kill('SIGTERM') } catch { /* ignore */ }
      // SIGTERM is a no-op on Windows; use taskkill to really kill the process tree
      if (process.platform === 'win32' && child.pid) {
        try {
          spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
          })
        } catch { /* ignore */ }
      }
    }

    const settle = (result: { code: number; stdout: string; stderr: string; timedOut: boolean }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (heartbeatInterval) clearInterval(heartbeatInterval)
      resolve(result)
    }

    const timer = setTimeout(() => {
      timedOut = true
      killChild()
      settle({ code: -1, stdout, stderr, timedOut: true })
    }, timeoutMs)

    const heartbeatInterval = opts?.heartbeatMs
      ? (() => {
          const start = Date.now()
          return setInterval(() => {
            opts.onData?.(
              `[heartbeat] still running... elapsed=${Math.round((Date.now() - start) / 1000)}s\n`,
              'stdout',
            )
          }, opts.heartbeatMs)
        })()
      : undefined

    child.stdout?.on('data', (c: Buffer) => {
      const chunk = String(c)
      stdout += chunk
      opts?.onData?.(chunk, 'stdout')
    })
    child.stderr?.on('data', (c: Buffer) => {
      const chunk = String(c)
      stderr += chunk
      opts?.onData?.(chunk, 'stderr')
    })
    child.on('error', (err) => {
      settle({ code: -2, stdout, stderr: `${stderr}\n[spawn error] ${err.message}`, timedOut: false })
    })
    child.on('close', (code) => {
      settle({ code: code ?? 1, stdout, stderr, timedOut })
    })
  })
}

async function runPythonFile(
  scriptPath: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  runtime: PythonRuntime,
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  const mergedEnv: NodeJS.ProcessEnv = { ...process.env, ...env }
  // Always set UTF-8 encoding so Chinese characters in stdout/stderr are correct
  mergedEnv.PYTHONIOENCODING = 'utf-8'
  mergedEnv.PYTHONUTF8 = '1'
  if (runtime.mode === 'app-cache') {
    const site = pythonSitePackagesDir()
    if (site && fs.existsSync(site)) {
      mergedEnv.PYTHONPATH = site
    } else {
      delete mergedEnv.PYTHONPATH
    }
    mergedEnv.PYTHONNOUSERSITE = '1'
  } else {
    // system mode: use the system Python as-is, never override PYTHONPATH
    delete mergedEnv.PYTHONPATH
  }

  const cwd = path.dirname(scriptPath)
  emitLog(`[excel-run] python script starting`)
  emitLog(`[excel-run] command=${runtime.executable}`)
  emitLog(`[excel-run] args=[${scriptPath}]`)
  emitLog(`[excel-run] cwd=${cwd}`)
  emitLog(`[excel-run] inputCsv=${env.AI_OFFICE_INPUT_CSV ?? '(none)'}`)
  emitLog(`[excel-run] outputDir=${env.AI_OFFICE_OUTPUT_DIR ?? '(none)'}`)
  emitLog(`[excel-run] timeoutMs=${timeoutMs}`)

  const result = await spawnPythonOnce(
    runtime.executable,
    [scriptPath],
    cwd,
    mergedEnv,
    timeoutMs,
    {
      onData: (chunk, stream) => {
        const prefix = stream === 'stdout' ? '[python stdout]' : '[python stderr]'
        chunk.split(/\r?\n/).forEach((line) => {
          const l = line.trim()
          if (l) emitLog(`${prefix} ${l}`)
        })
      },
      heartbeatMs: 5000,
    },
  )

  if (result.timedOut) {
    emitLog(`[excel-run] TIMEOUT after ${timeoutMs}ms — taskkill sent`)
    emitLog(`[excel-run] diagnostic: executable=${runtime.executable}`)
    emitLog(`[excel-run] diagnostic: scriptPath=${scriptPath}`)
    emitLog(`[excel-run] diagnostic: inputCsv=${env.AI_OFFICE_INPUT_CSV ?? '(none)'}`)
    emitLog(`[excel-run] diagnostic: outputDir=${env.AI_OFFICE_OUTPUT_DIR ?? '(none)'}`)
    emitLog(`[excel-run] diagnostic: runtime.mode=${runtime.mode}`)
  } else {
    emitLog(`[excel-run] python script closed, exitCode=${result.code}`)
    const stderrTail = result.stderr.split('\n').filter(Boolean).slice(-10).join('\n')
    if (stderrTail) emitLog(`[excel-run] stderr tail:\n${stderrTail}`)
  }

  return result
}

function presetStampPath(): string {
  return path.join(pythonSitePackagesDir(), PRESET_STAMP)
}

function readPresetStampJson(): PresetStampJson | null {
  try {
    const raw = fs.readFileSync(presetStampPath(), 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      typeof (parsed as Record<string, unknown>).pythonExecutable === 'string' &&
      typeof (parsed as Record<string, unknown>).pythonMajorMinor === 'string'
    ) {
      return parsed as PresetStampJson
    }
    return null
  } catch {
    return null
  }
}

function writePresetStampJson(stamp: PresetStampJson): void {
  const dir = pythonSitePackagesDir()
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(presetStampPath(), JSON.stringify(stamp, null, 2), 'utf-8')
}

/**
 * Fast (no subprocess) stamp validation.
 * Returns a human-readable reason string if the stamp is stale/invalid, null if valid.
 * Detects Python version changes (ABI mismatch), arch changes, executable path changes.
 */
function validateStampFast(stamp: PresetStampJson | null, resolved: ResolvedPython): string | null {
  if (!stamp) return 'no stamp file'
  if (stamp.pythonExecutable !== resolved.executable)
    return `Python executable changed: "${stamp.pythonExecutable}" → "${resolved.executable}"`
  if (stamp.pythonMajorMinor !== resolved.majorMinor)
    return `Python version changed: ${stamp.pythonMajorMinor} → ${resolved.majorMinor} (ABI mismatch — will reinstall)`
  if (stamp.arch !== resolved.arch)
    return `Python arch changed: ${stamp.arch} → ${resolved.arch}`
  if (stamp.platform !== process.platform)
    return `platform changed: ${stamp.platform} → ${process.platform}`
  for (const pkg of PRESET_PIP_PACKAGES) {
    const importName = pkg === 'python-dateutil' ? 'dateutil' : pkg
    if (!stamp.packages[importName] && !stamp.packages[pkg]) {
      return `package not recorded in stamp: ${pkg}`
    }
  }
  return null
}

function isSafePipPackageName(name: string): boolean {
  const s = String(name || '').trim()
  if (!s || s.length > 80) return false
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(s)
}

/** 从 Python stderr/stdout 解析顶层模块名（用于 pip） */
function parseMissingPythonModule(log: string): string | null {
  const s = String(log || '').replace(/\r/g, '')
  const patterns = [
    /ModuleNotFoundError:\s*No module named\s+['"]([^'"]+)['"]/i,
    /ImportError:\s*No module named\s+['"]([^'"]+)['"]/i,
    /ModuleNotFoundError:\s*No module named\s+(\S+)/i,
    /ImportError:\s*cannot import name\s+['"][^'"]+['"]\s+from\s+['"]([^'"]+)['"]/i,
  ]
  for (const re of patterns) {
    const m = s.match(re)
    if (m?.[1]) {
      const raw = m[1].trim()
      const top = raw.split(/[./\\]/)[0]
      if (top && isSafePipPackageName(top)) return top
    }
  }
  return null
}

/** Write a detailed pip-failure diagnostic log to excel-analysis-cache/ for support. */
async function writePipFailureLog(
  resolved: ResolvedPython,
  target: string,
  pipStderr: string,
  pipConfigOut: string,
): Promise<void> {
  try {
    const cacheDir = path.dirname(pythonSitePackagesDir())
    fs.mkdirSync(cacheDir, { recursive: true })
    const logPath = path.join(cacheDir, 'pip-failure.log')
    const lines = [
      `=== Excel Analysis pip failure log — ${new Date().toISOString()} ===`,
      `pythonExecutable : ${resolved.executable}`,
      `pythonVersion    : ${resolved.version}`,
      `arch             : ${resolved.arch}`,
      `platform         : ${process.platform}`,
      `target dir       : ${target}`,
      `PIP_USER env     : 0 (forced)`,
      `PYTHONNOUSERSITE : 1 (forced)`,
      `PYTHONPATH       : (cleared during pip)`,
      `--- pip config list ---`,
      pipConfigOut || '(failed to run pip config list)',
      `--- stderr ---`,
      pipStderr || '(empty)',
    ]
    fs.writeFileSync(logPath, lines.join('\n'), 'utf-8')
  } catch {
    // non-fatal
  }
}

async function getPipConfigList(resolved: ResolvedPython): Promise<string> {
  try {
    const out = await new Promise<string>((res) => {
      const child = spawn(resolved.executable, ['-m', 'pip', 'config', 'list'], {
        windowsHide: true,
        env: { ...process.env, PYTHONNOUSERSITE: '1' },
        cwd: os.tmpdir(),
      })
      let buf = ''
      child.stdout?.on('data', (c) => { buf += String(c) })
      child.stderr?.on('data', (c) => { buf += String(c) })
      child.on('error', () => res(buf))
      child.on('close', () => res(buf))
    })
    return out.trim()
  } catch {
    return ''
  }
}

async function pipInstallPackages(
  packages: string[],
  resolved: ResolvedPython,
): Promise<{ ok: boolean; message: string }> {
  const list = [...new Set(packages.map((p) => String(p || '').trim()).filter(Boolean))]
  if (!list.length) return { ok: true, message: 'noop' }
  for (const p of list) {
    if (!isSafePipPackageName(p)) {
      return { ok: false, message: `拒绝安装不安全的包名：${p}` }
    }
  }
  const target = pythonSitePackagesDir()
  fs.mkdirSync(target, { recursive: true })

  // Strict env: clear PYTHONPATH, proxies, force no user-install mode
  const pipEnv: NodeJS.ProcessEnv = { ...process.env }
  for (const key of [
    'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY',
    'http_proxy', 'https_proxy', 'all_proxy',
    'PYTHONPATH',
  ]) {
    delete pipEnv[key]
  }
  pipEnv.PIP_USER = '0'
  pipEnv.PYTHONNOUSERSITE = '1'
  pipEnv.PIP_DISABLE_PIP_VERSION_CHECK = '1'
  pipEnv.PIP_NO_INPUT = '1'

  emitLog(`[pip] installing: ${list.join(', ')}`)
  emitLog(`[pip] target: ${target}`)

  // Try mirror sources in order; return on first success
  const sources = [
    { url: 'https://pypi.tuna.tsinghua.edu.cn/simple/', trustedHost: 'pypi.tuna.tsinghua.edu.cn' },
    { url: 'https://mirrors.aliyun.com/pypi/simple/', trustedHost: 'mirrors.aliyun.com' },
    { url: 'https://pypi.org/simple/', trustedHost: undefined },
  ]

  let lastMessage = 'Excel 分析环境初始化失败，请打开调试输出查看详情。'

  for (const [sourceIdx, source] of sources.entries()) {
    const args = [
      '-m', 'pip', 'install',
      '--upgrade',
      '--disable-pip-version-check',
      '--no-input',
      '--no-user',
      '-t', target,
      '-i', source.url,
      ...(source.trustedHost ? ['--trusted-host', source.trustedHost] : []),
      ...list,
    ]

    emitLog(`[pip] source [${sourceIdx + 1}/${sources.length}]: ${source.url}`)

    let fullStderr = ''
    let timedOut = false

    const result = await new Promise<{ code: number; timedOut: boolean; stderr: string }>((res) => {
      let out = ''
      let killed = false
      const child = spawn(resolved.executable, args, {
        windowsHide: true, env: pipEnv, cwd: os.tmpdir(),
      })
      const timer = setTimeout(() => {
        timedOut = true
        if (!killed) { killed = true; try { child.kill('SIGTERM') } catch { /* ignore */ } }
        res({ code: -1, timedOut: true, stderr: fullStderr })
      }, PIP_TIMEOUT_MS)
      child.stdout?.on('data', (c) => {
        const s = String(c); out += s
        for (const line of s.split(/\r?\n/)) { if (line.trim()) emitLog(`[pip] ${line}`) }
      })
      child.stderr?.on('data', (c) => {
        const s = String(c); out += s; fullStderr += s
        for (const line of s.split(/\r?\n/)) { if (line.trim()) emitLog(`[pip stderr] ${line}`) }
      })
      child.on('error', (e) => { clearTimeout(timer); emitLog(`[pip] spawn error: ${String(e)}`); res({ code: -2, timedOut: false, stderr: String(e) }) })
      child.on('close', (code) => { clearTimeout(timer); res({ code: code ?? 1, timedOut, stderr: fullStderr }) })
    })

    if (result.timedOut) {
      emitLog(`[pip] TIMEOUT after ${PIP_TIMEOUT_MS / 1000}s on source ${source.url}`)
      lastMessage = `Python 依赖安装超时（${PIP_TIMEOUT_MS / 1000}s），请检查网络后重试。`
      await writePipFailureLog(resolved, target, `[timeout]\n${result.stderr}`, '')
      if (sourceIdx < sources.length - 1) {
        emitLog('[pip] Retrying with next mirror source...')
        continue
      }
      return { ok: false, message: lastMessage }
    }

    if (result.code === 0) {
      emitLog(`[pip] install succeeded (exit 0) via ${source.url}`)
      return { ok: true, message: `已安装：${list.join(', ')} → ${target}` }
    }

    emitLog(`[pip] install FAILED (exit ${result.code}) via ${source.url}`)
    if (sourceIdx < sources.length - 1) {
      emitLog('[pip] Retrying with next mirror source...')
      continue
    }
    const pipCfg = await getPipConfigList(resolved)
    await writePipFailureLog(resolved, target, result.stderr, pipCfg)
    return { ok: false, message: lastMessage }
  }

  return { ok: false, message: lastMessage }
}

/** Verify numpy/pandas are importable from siteDir using the same Python that pip used. */
async function verifyPythonImports(siteDir: string, resolved: ResolvedPython): Promise<boolean> {
  const safePath = siteDir.replace(/\\/g, '/')
  const code = `import sys; sys.path.insert(0, '${safePath}'); import numpy; import pandas; print('ok')`
  const checkEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PYTHONNOUSERSITE: '1',
    PYTHONPATH: siteDir,
  }
  try {
    const out = await new Promise<string>((resolve, reject) => {
      const child = spawn(resolved.executable, ['-c', code], { windowsHide: true, env: checkEnv, cwd: os.tmpdir() })
      let buf = ''
      child.stdout?.on('data', (c) => { buf += String(c) })
      child.stderr?.on('data', (c) => { buf += String(c) })
      child.on('error', reject)
      child.on('close', () => resolve(buf))
    })
    return out.includes('ok')
  } catch {
    return false
  }
}

/** Read actual installed package versions from siteDir using importlib.metadata. */
async function getInstalledPackageVersions(
  siteDir: string,
  resolved: ResolvedPython,
): Promise<Record<string, string>> {
  const safePath = siteDir.replace(/\\/g, '/')
  const pkgs = PRESET_PIP_PACKAGES.map((p) => (p === 'python-dateutil' ? 'python_dateutil' : p))
  const code = [
    `import sys; sys.path.insert(0, '${safePath}')`,
    'import json',
    'from importlib.metadata import version, PackageNotFoundError',
    `result = {}`,
    ...pkgs.map((p) => `
try:
  result["${p}"] = version("${p}")
except PackageNotFoundError:
  result["${p}"] = "unknown"`),
    'print(json.dumps(result))',
  ].join('\n')
  try {
    const out = await new Promise<string>((res) => {
      const child = spawn(resolved.executable, ['-c', code], {
        windowsHide: true,
        env: { ...process.env, PYTHONNOUSERSITE: '1', PYTHONPATH: siteDir },
        cwd: os.tmpdir(),
      })
      let buf = ''
      child.stdout?.on('data', (c) => { buf += String(c) })
      child.stderr?.on('data', () => { /* ignore */ })
      child.on('error', () => res(buf))
      child.on('close', () => res(buf))
    })
    const jsonStart = out.indexOf('{')
    if (jsonStart >= 0) return JSON.parse(out.slice(jsonStart)) as Record<string, string>
  } catch {
    // fall through
  }
  return {}
}

/** Pre-run lightweight self-check: verifies cwd, sys.path, numpy, pandas are all OK. */
async function runPythonEnvCheck(scriptDir: string, runtime: PythonRuntime): Promise<{ ok: boolean; output: string }> {
  const checkLines = [
    'import os, sys',
    'print("[excel-python-check] executable=", sys.executable)',
    'print("[excel-python-check] cwd=", os.getcwd())',
    'print("[excel-python-check] sys.path[:8]=", sys.path[:8])',
    'import numpy as np',
    'import pandas as pd',
    'print("[excel-python-check] numpy=", np.__version__, np.__file__)',
    'print("[excel-python-check] pandas=", pd.__version__, pd.__file__)',
    'print("[excel-python-check] OK")',
  ]
  const code = checkLines.join('\n')
  const checkEnv: NodeJS.ProcessEnv = { ...process.env }
  if (runtime.mode === 'app-cache') {
    const site = pythonSitePackagesDir()
    if (site) checkEnv.PYTHONPATH = site
    checkEnv.PYTHONNOUSERSITE = '1'
  } else {
    delete checkEnv.PYTHONPATH
  }
  try {
    const result = await new Promise<{ code: number; out: string }>((resolve) => {
      let settled = false
      const finish = (r: { code: number; out: string }) => {
        if (!settled) { settled = true; clearTimeout(timer); resolve(r) }
      }
      // 15 s hard timeout — avoids hang on import if Python is broken
      const timer = setTimeout(() => {
        try { child.kill('SIGTERM') } catch { /* ignore */ }
        if (process.platform === 'win32' && child.pid) {
          try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch { /* ignore */ }
        }
        finish({ code: -1, out: '[env-check timeout after 15s]' })
      }, 15_000)
      const child = spawn(runtime.executable, ['-c', code], { windowsHide: true, env: checkEnv, cwd: scriptDir })
      let out = ''
      child.stdout?.on('data', (c) => { out += String(c) })
      child.stderr?.on('data', (c) => { out += String(c) })
      child.on('error', (e) => finish({ code: -1, out: `${out}\n${e.message}` }))
      child.on('close', (exitCode) => finish({ code: exitCode ?? 1, out }))
    })
    if (result.out.includes('[excel-python-check] OK')) {
      return { ok: true, output: result.out }
    }
    return { ok: false, output: result.out }
  } catch (e) {
    return { ok: false, output: String(e) }
  }
}

/**
 * Core implementation of the app-cache fallback: pip-installs packages to userData,
 * verifies imports, writes stamp, and returns a PythonRuntime.
 * Emits excel:envStatus and excel:envLog events throughout.
 */
async function _doEnsureAppCachePythonRuntime(): Promise<{ ok: boolean; runtime?: PythonRuntime; message: string }> {
  emitEnvStatus('checking', '正在检查 Python 运行环境...')
  emitLog('[excel-env] checking app-cache Python environment')

  let resolved: ResolvedPython
  try {
    resolved = await resolvePythonExecutable()
    emitLog(`[excel-env] Python ${resolved.version} (${resolved.arch}) at ${resolved.executable}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    emitEnvStatus('failed', msg)
    emitLog(`[excel-env] ERROR resolving Python: ${msg}`)
    return { ok: false, message: msg }
  }

  const siteDir = pythonSitePackagesDir()
  const stamp = readPresetStampJson()
  const stampInvalid = validateStampFast(stamp, resolved)

  emitLog(`[excel-env] site-packages: ${siteDir}`)
  emitLog(`[excel-env] stamp: ${stampInvalid ?? 'valid'}`)

  if (!stampInvalid) {
    emitEnvStatus('checking', '正在验证 Python 包...')
    emitLog('[excel-env] stamp valid, verifying imports...')
    const healthy = await verifyPythonImports(siteDir, resolved)
    if (healthy) {
      emitLog('[excel-env] imports OK — app-cache environment ready')
      const runtime: PythonRuntime = {
        mode: 'app-cache',
        executable: resolved.executable,
        version: resolved.version,
        arch: resolved.arch,
        packages: Object.fromEntries(
          Object.entries(stamp!.packages).map(([k, v]) => [k, { ok: true, version: String(v) }]),
        ),
      }
      emitEnvStatus('ready', `app-cache Python ${resolved.version}`)
      return { ok: true, runtime, message: '常用依赖已就绪（缓存）' }
    }
    emitLog('[excel-env] imports FAILED despite valid stamp — rebuilding')
  }

  const isRebuild = fs.existsSync(siteDir) && fs.readdirSync(siteDir).length > 0
  if (isRebuild) {
    emitEnvStatus('rebuilding', 'Python 环境异常，正在重建缓存...')
    emitLog('[excel-env] wiping stale site-packages')
    try { fs.rmSync(siteDir, { recursive: true, force: true }) } catch { /* ignore */ }
  } else {
    emitEnvStatus('installing', '正在安装 Python 依赖，首次运行可能需要几分钟...')
  }
  fs.mkdirSync(siteDir, { recursive: true })

  emitLog(`[excel-env] pip install start: ${[...PRESET_PIP_PACKAGES].join(', ')}`)
  const r = await pipInstallPackages([...PRESET_PIP_PACKAGES], resolved)
  if (!r.ok) {
    emitEnvStatus('failed', r.message)
    emitLog('[excel-env] pip install FAILED')
    return { ok: false, message: r.message }
  }
  emitLog('[excel-env] pip install completed, verifying imports...')

  const healthy = await verifyPythonImports(siteDir, resolved)
  if (!healthy) {
    const msg = 'Excel 分析环境初始化失败，请打开调试输出查看详情。'
    emitEnvStatus('failed', msg)
    emitLog('[excel-env] post-install import check FAILED')
    return { ok: false, message: msg }
  }

  const pkgVersions = await getInstalledPackageVersions(siteDir, resolved)
  emitLog(`[excel-env] versions: ${JSON.stringify(pkgVersions)}`)

  writePresetStampJson({
    pythonExecutable: resolved.executable,
    pythonVersion: resolved.version,
    pythonMajorMinor: resolved.majorMinor,
    platform: process.platform,
    arch: resolved.arch,
    packages: pkgVersions,
    createdAt: new Date().toISOString(),
  })
  emitLog('[excel-env] stamp written')

  const runtime: PythonRuntime = {
    mode: 'app-cache',
    executable: resolved.executable,
    version: resolved.version,
    arch: resolved.arch,
    packages: Object.fromEntries(
      Object.entries(pkgVersions).map(([k, v]) => [k, { ok: true, version: String(v) }]),
    ),
  }
  emitEnvStatus('ready', `app-cache Python ${resolved.version}`)
  return { ok: true, runtime, message: r.message }
}

/** In-memory lock for ensurePresetPythonDependencies (legacy compat). */
let _ensurePromise: Promise<{ ok: boolean; message: string }> | null = null

/**
 * Ensure preset Python dependencies are installed and healthy (app-cache path only).
 * Kept for backward compatibility with rebuildExcelEnv.
 * In-memory lock: concurrent calls share the same Promise — no duplicate pip installs.
 */
export function ensurePresetPythonDependencies(): Promise<{ ok: boolean; message: string }> {
  if (_ensurePromise) return _ensurePromise
  const p = _doEnsureAppCachePythonRuntime().then((r) => ({ ok: r.ok, message: r.message }))
  _ensurePromise = p
  void p.finally(() => { _ensurePromise = null })
  return p
}

/**
 * Main runtime resolver: tries system Python first, falls back to app-cache.
 * In-memory lock prevents concurrent runs.
 */
export function ensureExcelPythonRuntime(): Promise<{ ok: boolean; runtime?: PythonRuntime; message: string }> {
  if (_runtimePromise) return _runtimePromise
  const p = _doEnsureExcelPythonRuntime()
  _runtimePromise = p
  void p.finally(() => { _runtimePromise = null })
  return p
}

async function _doEnsureExcelPythonRuntime(): Promise<{ ok: boolean; runtime?: PythonRuntime; message: string }> {
  emitEnvStatus('checking', '正在检测 Python 运行环境...')
  emitLog('[excel-env] resolving Python runtime (system-first strategy)')

  const sysRuntime = await resolveSystemPythonRuntime(30_000)
  if (sysRuntime) {
    const pkgSummary = ['numpy', 'pandas', 'matplotlib']
      .map((n) => { const p = sysRuntime.packages[n]; return p?.ok ? `${n}==${p.version}` : '' })
      .filter(Boolean).join(', ')
    const msg = `使用系统 Python ${sysRuntime.version} · ${pkgSummary}`
    emitLog(`[excel-env] Using system Python runtime: ${sysRuntime.executable}`)
    emitEnvStatus('ready', msg)
    return { ok: true, runtime: sysRuntime, message: msg }
  }

  emitLog('[excel-env] System Python not suitable, falling back to app-cache')
  return _doEnsureAppCachePythonRuntime()
}

/**
 * Lightweight check for the UI status banner.
 * Probes system Python first (short timeout), falls back to stamp if not found.
 */
export async function checkExcelEnvStatus(): Promise<{ status: ExcelEnvStatus; message: string }> {
  // Quick system Python probe (5 seconds — don't block startup too long)
  const sysRuntime = await resolveSystemPythonRuntime(5_000)
  if (sysRuntime) {
    const pkgSummary = ['numpy', 'pandas', 'matplotlib']
      .map((n) => { const p = sysRuntime.packages[n]; return p?.ok ? `${n}==${p.version}` : '' })
      .filter(Boolean).join(', ')
    return {
      status: 'ready',
      message: `系统 Python ${sysRuntime.version} (${sysRuntime.arch}) · ${pkgSummary}`,
    }
  }
  // Fall back to app-cache stamp
  const stamp = readPresetStampJson()
  if (!stamp) {
    return { status: 'idle', message: '未安装 Python 依赖，点击「开始分析」时将自动安装。' }
  }
  if (stamp.platform !== process.platform) {
    return { status: 'idle', message: `平台已变更（${stamp.platform} → ${process.platform}），将在下次分析时重建环境。` }
  }
  const pkgSummary = Object.entries(stamp.packages)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ')
  return {
    status: 'ready',
    message: `app-cache · Python ${stamp.pythonVersion} (${stamp.arch}) · ${pkgSummary}`,
  }
}


/**
 * Force-wipe python-site-packages and reinstall from scratch.
 * Resets both the Python resolver cache and the in-progress lock.
 */
export async function rebuildExcelEnv(): Promise<{ ok: boolean; message: string }> {
  _cachedPython = null
  _ensurePromise = null
  _cachedSystemRuntime = undefined
  _runtimePromise = null
  const siteDir = pythonSitePackagesDir()
  try { fs.rmSync(siteDir, { recursive: true, force: true }) } catch { /* ignore */ }
  try { fs.unlinkSync(presetStampPath()) } catch { /* ignore */ }
  return ensurePresetPythonDependencies()
}

const INTERNAL_PRESET_HINT = [
  '内部可参考的默认思路（若用户未指定则选用合理子集）：',
  '- 分类列常作行维度；时间/阶段列可作行或列；数值列作度量（sum/mean/count）。',
  '- 单图尽量不超过 2 个分类维度 + 1 个度量，避免维度过载。',
].join('\n')

/** 第 2 步：大模型 A — 只定维度与运算，不写代码 */
const DIMENSION_PLAN_SYSTEM = [
  '你是数据分析规划助手。输入包含：表头、每列粗类型、前 5 行样本、用户文字需求（可为空）、以及内部默认策略说明。',
  '你只输出一个 JSON 对象，不要 Markdown，不要代码块。',
  'JSON 字段要求：',
  '- table_summary: 字符串，一句话概括表格可能用途',
  '- dimensions: 数组。每项含：',
  '  - id: 字符串，如 "d1"',
  '  - intent: "row" | "column" | "value" | "facet" | "filter" 之一，表示该维度在可视化中的角色',
  '  - columns: 字符串数组，必须是输入表头中的列名（精确匹配）',
  '  - aggregation: "sum" | "mean" | "count" | "min" | "max" | "none" | "custom"',
  '  - custom_expression: 字符串或 null；仅当 aggregation 为 custom 时填写人类可读的运算说明（仍不要写代码）',
  '- charts: 数组，每项 { "type": "bar"|"line"|"scatter"|"pie"|"hist"|"other", "title": "图表标题（语言与表头一致）", "uses_dimensions": ["d1","d2"] }',
  '- notes: 字符串数组，规划说明或对用户需求的响应要点',
].join('\n')

/** 第 3 步：大模型 B — 只写代码 */
const CODE_STEP3_SYSTEM = [
  '你是 Python 工程师。只输出 markdown fenced 的 python 代码。',
  '硬性要求：',
  '1) 读取 os.environ["AI_OFFICE_INPUT_CSV"]，pandas read_csv(encoding="utf-8-sig")。',
  `2) 所有图表必须保存到 os.environ["AI_OFFICE_OUTPUT_DIR"]，且文件名必须且只能使用以下之一（按实际张数递增，不要改名字）：${EXCEL_CHART_FILENAMES.join(', ')}。`,
  '3) matplotlib: matplotlib.use("Agg"); 设置中文字体 SimHei/Microsoft YaHei/SimSun 与 axes.unicode_minus=False。',
  '4) 禁止网络、禁止 os.system/subprocess/popen、禁止 input。',
  '5) 最后一行 print 以 EXCEL_ANALYSIS_RESULT_JSON: 开头，输出 JSON：{ "summary": string, "chart_files": string[], "pivot_description": string }，chart_files 为相对文件名列表。',
  '6) 仅允许 import：pandas、numpy、scipy、matplotlib（及它们已安装的子模块）；禁止 import 其他任何第三方库；禁止动态 __import__ 加载未列出的包。',
  '7) 代码必须在本机仅有上述库时即可运行；仅用标准库即可完成的字符串/日期处理不要用额外包。',
].join('\n')

/**
 * Minimal local fallback script — used when the LLM-generated script times out.
 * Always sets matplotlib.use("Agg") to avoid GUI blocking on Windows.
 */
const FALLBACK_PLOT_SCRIPT = `# -*- coding: utf-8 -*-
# Auto-generated local fallback: reads CSV and draws a simple chart.
import os, sys, json
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import pandas as pd

csv_path = os.environ.get('AI_OFFICE_INPUT_CSV', '')
out_dir = os.environ.get('AI_OFFICE_OUTPUT_DIR', '')

if not csv_path or not os.path.isfile(csv_path):
    print('EXCEL_ANALYSIS_RESULT_JSON:' + json.dumps({'ok': False, 'summary': 'CSV not found', 'chart_files': [], 'pivot_description': ''}))
    sys.exit(1)

if not out_dir:
    print('EXCEL_ANALYSIS_RESULT_JSON:' + json.dumps({'ok': False, 'summary': 'output dir not set', 'chart_files': [], 'pivot_description': ''}))
    sys.exit(1)

try:
    df = pd.read_csv(csv_path, encoding='utf-8-sig')
except Exception:
    try:
        df = pd.read_csv(csv_path, encoding='gbk')
    except Exception as e:
        print('EXCEL_ANALYSIS_RESULT_JSON:' + json.dumps({'ok': False, 'summary': f'read error: {e}', 'chart_files': [], 'pivot_description': ''}))
        sys.exit(1)

plt.rcParams['font.sans-serif'] = ['SimHei', 'Microsoft YaHei', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

num_cols = df.select_dtypes(include='number').columns.tolist()
txt_cols = df.select_dtypes(exclude='number').columns.tolist()

if not num_cols:
    print('EXCEL_ANALYSIS_RESULT_JSON:' + json.dumps({'ok': False, 'summary': '未找到数值列', 'chart_files': [], 'pivot_description': ''}))
    sys.exit(1)

y_col = num_cols[0]
x_col = txt_cols[0] if txt_cols and df[txt_cols[0]].nunique() <= 50 else None

fig, ax = plt.subplots(figsize=(10, 6))
if x_col:
    ax.bar(df[x_col].astype(str), df[y_col])
    ax.set_xlabel(x_col)
    ax.tick_params(axis='x', rotation=45)
else:
    ax.plot(df[y_col].values)
    ax.set_xlabel('Index')
ax.set_ylabel(y_col)
ax.set_title(f'{y_col} — 自动分析图（本地 fallback 脚本）')
plt.tight_layout()

os.makedirs(out_dir, exist_ok=True)
out_file = os.path.join(out_dir, 'excel_chart_01.png')
plt.savefig(out_file, dpi=150, bbox_inches='tight')
plt.close()

print('EXCEL_ANALYSIS_RESULT_JSON:' + json.dumps({
    'ok': True,
    'summary': f'自动生成：{y_col} 分析图（本地 fallback 脚本）',
    'chart_files': ['excel_chart_01.png'],
    'pivot_description': '',
}))
`

function writeFallbackScript(workspacePath: string): string {
  const dir = cacheRootForWorkspace(workspacePath)
  fs.mkdirSync(dir, { recursive: true })
  const p = path.join(dir, '_fallback_plot.py')
  fs.writeFileSync(p, FALLBACK_PLOT_SCRIPT, 'utf-8')
  return p
}

function resolveScriptFolder(workspacePath: string, relFolder: string): string {
  return path.join(scriptsRoot(workspacePath), ...relFolder.split('/').filter(Boolean))
}

export async function runExcelAnalysis(
  settings: AppSettings,
  input: ExcelAnalysisRunInput,
  onProgress?: (phase: string) => void,
): Promise<ExcelAnalysisRunResult> {
  const workspacePath = String(input.workspacePath || '').trim()
  const sourcePath = String(input.sourcePath || '').trim()
  const userRequirement = String(input.userRequirement || '').trim()
  /** 用户填写了「分析需求」时禁止复用历史脚本，须按本次描述重新向大模型生成代码 */
  const preferReuse = userRequirement.length === 0

  const report = (phase: string) => {
    try {
      onProgress?.(phase)
    } catch {
      // ignore renderer / IPC edge cases
    }
  }

  if (!workspacePath || !fs.existsSync(workspacePath)) {
    return { ok: false, error: '请先打开工作区' }
  }
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return { ok: false, error: '数据文件不存在' }
  }
  if (!isCsvPath(sourcePath) && !isExcelPath(sourcePath)) {
    return { ok: false, error: '仅支持 .csv / .xlsx / .xls' }
  }

  emitLog(`[analysis] === Starting Excel Analysis ===`)
  emitLog(`[analysis] sourcePath: ${sourcePath}`)
  emitLog(`[analysis] workspacePath: ${workspacePath}`)
  const dataModelId = String(input.dataModelId || '').trim()
  emitLog(`[analysis] dataModelId: ${dataModelId || '(none)'}`)
  emitLog(`[analysis] userRequirement: ${userRequirement ? userRequirement.slice(0, 120) : '(empty)'}`)

  report('正在准备数据表…')

  let tempCleanup: (() => void) | undefined
  let modelCleanup: (() => void) | undefined
  let csvPath: string
  try {
    const mat = materializeInputCsv(sourcePath)
    csvPath = mat.csvPath
    tempCleanup = mat.cleanup
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }

  if (dataModelId) {
    report('正在应用数据预处理模型…')
    try {
      const { outputPath } = applyPlotDataModel(dataModelId, csvPath)
      tempCleanup?.()
      tempCleanup = undefined
      csvPath = outputPath
      modelCleanup = () => {
        try {
          fs.unlinkSync(outputPath)
        } catch {
          // ignore
        }
      }
    } catch (e) {
      tempCleanup?.()
      modelCleanup?.()
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  const releaseTempFiles = () => {
    tempCleanup?.()
    tempCleanup = undefined
    modelCleanup?.()
    modelCleanup = undefined
  }

  report('正在读取数据表…')
  const structureSourcePath = dataModelId ? csvPath : sourcePath
  const structure = buildStep1Structure(structureSourcePath)
  if (!structure.ok) {
    releaseTempFiles()
    return { ok: false, error: structure.notes.join('；'), structure }
  }
  emitLog(`[analysis] headers (${structure.headers.length}): ${structure.headers.slice(0, 20).join(', ')}`)

  report('正在准备 Python 运行环境…')
  const runtimeResult = await ensureExcelPythonRuntime()
  if (!runtimeResult.ok || !runtimeResult.runtime) {
    releaseTempFiles()
    return { ok: false, error: `Python 环境准备失败：${runtimeResult.message}`, structure }
  }
  const runtime = runtimeResult.runtime
  emitLog(`[analysis] Python runtime: ${runtime.mode} — ${runtime.executable} ${runtime.version}`)

  const { sorted, signature } = sortedHeaderSignature(structure.headers)
  const outDir = outputRoot(workspacePath)
  emitLog(`[analysis] outDir: ${outDir}`)
  fs.mkdirSync(outDir, { recursive: true })
  fs.mkdirSync(cacheRootForWorkspace(workspacePath), { recursive: true })
  fs.mkdirSync(scriptsRoot(workspacePath), { recursive: true })

  const registry = readRegistry(workspacePath)
  const builtinPlotPath = dataModelId ? resolveBuiltinPlotScript(dataModelId) : null
  emitLog(`[analysis] builtinPlotPath: ${builtinPlotPath ?? '(none)'}`)

  /** 选用数据模型、且用户未写自定义需求、且存在模型脚本 → 只跑脚本，不调大模型生成绘图程序 */
  let useModelBuiltinPlot = Boolean(dataModelId && builtinPlotPath && userRequirement.length === 0)

  // Model A schema check: if no cycle/capacity columns found, fallback to LLM generic analysis
  if (useModelBuiltinPlot && dataModelId === 'model_a') {
    const hasCapCol = structure.headers.some((h) =>
      /(容量|cap|mah|fcc|放电|dch|qd|电量|specific|容量保持|保持率|retention)/i.test(h),
    )
    const hasCycleCol = structure.headers.some((h) =>
      /(循环|周次|周数|圈数|次数|cycle|cyc)/i.test(h),
    )
    emitLog(`[analysis] model_a schema check — cycleCol:${hasCycleCol} capCol:${hasCapCol}`)
    if (!hasCapCol && !hasCycleCol) {
      emitLog('[analysis] model_a schema MISMATCH — falling back to generic LLM analysis')
      emitLog(`[analysis] Headers were: ${structure.headers.join(', ')}`)
      useModelBuiltinPlot = false
    }
  }

  const expectedModelChartFiles = useModelBuiltinPlot ? resolveModelExpectedChartFiles(dataModelId) : []
  emitLog(`[analysis] useModelBuiltinPlot: ${useModelBuiltinPlot}, expectedChartFiles: ${JSON.stringify(expectedModelChartFiles)}`)
  const reusable = preferReuse ? findReusableEntry(registry, sorted, dataModelId) : null

  let dimensionPlan: Record<string, unknown> | undefined
  let scriptPath: string
  let reusedScript = false
  let scriptRelFolder: string | undefined

  if (useModelBuiltinPlot && builtinPlotPath) {
    report('正在使用模型内置绘图…')
    scriptPath = builtinPlotPath
    dimensionPlan = {
      table_summary: '模型内置可视化',
      model_id: dataModelId,
      source: 'builtin_plot',
      note: '未调用大模型；使用模型脚本直接输出图表',
    }
    reusedScript = false
  } else if (reusable && preferReuse && fs.existsSync(path.join(resolveScriptFolder(workspacePath, reusable.relFolder), 'main.py'))) {
    report('正在复用已有分析方案…')
    scriptPath = path.join(resolveScriptFolder(workspacePath, reusable.relFolder), 'main.py')
    reusedScript = true
    scriptRelFolder = reusable.relFolder
    const planPath = path.join(resolveScriptFolder(workspacePath, reusable.relFolder), 'dimension_plan.json')
    if (fs.existsSync(planPath)) {
      try {
        dimensionPlan = JSON.parse(fs.readFileSync(planPath, 'utf-8')) as Record<string, unknown>
      } catch {
        dimensionPlan = { note: '复用脚本：未找到或无法解析 dimension_plan.json' }
      }
    }
    const next = registry.map((e) => (e.id === reusable.id ? { ...e, lastUsedAt: new Date().toISOString() } : e))
    writeRegistry(workspacePath, next)
  } else {
    report('正在规划图表与指标…')
    const step2User = [
      '【表头】', JSON.stringify(structure.headers),
      '【列 profile】', JSON.stringify(structure.columns),
      '【前 5 行样本】', JSON.stringify(structure.sampleRows),
      '【用户需求】', userRequirement || '（无）',
      '【内部默认策略】', INTERNAL_PRESET_HINT,
    ].join('\n')

    try {
      const rawDim = await completeText(settings, {
        systemPrompt: DIMENSION_PLAN_SYSTEM,
        userPrompt: step2User,
        temperature: 0.25,
        maxTokens: 2200,
      })
      dimensionPlan = parseJsonObjectFromLlm(rawDim)
    } catch (e) {
      releaseTempFiles()
      return { ok: false, error: `第 2 步（维度规划）失败：${e instanceof Error ? e.message : String(e)}`, structure }
    }

    const tableKind = typeof dimensionPlan['table_summary'] === 'string'
      ? String(dimensionPlan['table_summary']).slice(0, 40)
      : 'analysis'
    const slugBase = tableKind.replace(/[^\w\u4e00-\u9fa5]+/g, '_').slice(0, 36) || 'analysis'
    const slug = `${slugBase}_${Date.now().toString(36)}`
    const relFolder = `columns-${signature}/${slug}`
    const folderAbs = path.join(scriptsRoot(workspacePath), `columns-${signature}`, slug)
    fs.mkdirSync(folderAbs, { recursive: true })
    fs.writeFileSync(path.join(folderAbs, 'dimension_plan.json'), JSON.stringify(dimensionPlan, null, 2), 'utf-8')

    report('正在生成作图代码…')
    const codeUser = [
      '【第 1 步结构】', JSON.stringify(structure),
      '【第 2 步维度规划 JSON】', JSON.stringify(dimensionPlan),
      '【用户需求】', userRequirement || '（无）',
      '【输出目录环境变量】', 'AI_OFFICE_OUTPUT_DIR（已设置，请只写入固定文件名 PNG）',
    ].join('\n\n')

    let code: string
    try {
      const rawCode = await completeText(settings, {
        systemPrompt: CODE_STEP3_SYSTEM,
        userPrompt: `${codeUser}\n\n请严格按第 2 步规划实现；若规划与数据不符请在代码中做最小修正，并在最后一行 EXCEL_ANALYSIS_RESULT_JSON 的 summary 中说明。`,
        temperature: 0.15,
        maxTokens: 4500,
      })
      code = extractPythonFromLlm(rawCode)
    } catch (e) {
      releaseTempFiles()
      return { ok: false, error: `第 3 步（代码生成）失败：${e instanceof Error ? e.message : String(e)}`, structure, dimensionPlan }
    }

    scriptPath = path.join(folderAbs, 'main.py')
    fs.writeFileSync(scriptPath, code, 'utf-8')

    const entry: ExcelAnalysisRegistryEntry = {
      id: crypto.randomUUID(),
      signature,
      headersSorted: sorted,
      dataModelId: dataModelId || undefined,
      slug,
      purpose: String(tableKind),
      relFolder,
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
    }
    writeRegistry(
      workspacePath,
      [
        ...registry.filter((e) => {
          if (e.headersSorted.join('\u0001') !== sorted.join('\u0001')) return true
          return normalizeDataModelKey(e.dataModelId) !== normalizeDataModelKey(dataModelId)
        }),
        entry,
      ],
    )
    scriptRelFolder = entry.relFolder
  }

  const env: NodeJS.ProcessEnv = {
    AI_OFFICE_INPUT_CSV: csvPath,
    AI_OFFICE_OUTPUT_DIR: outDir,
    AI_OFFICE_USER_HINT: userRequirement,
  }
  emitLog(`[analysis] scriptPath: ${scriptPath}`)
  emitLog(`[analysis] AI_OFFICE_INPUT_CSV: ${csvPath}`)
  emitLog(`[analysis] AI_OFFICE_OUTPUT_DIR: ${outDir}`)
  emitLog(`[analysis] csvPath exists: ${fs.existsSync(csvPath)}`)

  try {
    report('正在运行计算并导出图表…')
    if (useModelBuiltinPlot && expectedModelChartFiles.length > 0) {
      // 避免上一次残留图片被当成本次模型输出返回。
      removeExistingChartFiles(outDir, expectedModelChartFiles)
    }

    // Env check: skip for system mode (already verified by runtime probe); only run for app-cache
    if (runtime.mode === 'app-cache') {
      report('正在校验 Python 运行环境…')
      emitLog('[analysis] running app-cache env check...')
      const envCheck = await runPythonEnvCheck(path.dirname(scriptPath), runtime)
      emitLog(`[analysis] env check: ${envCheck.ok ? 'OK' : 'FAILED'} — ${envCheck.output.slice(0, 300)}`)
      if (!envCheck.ok) {
        releaseTempFiles()
        return {
          ok: false,
          error: `Python 环境自检失败，请检查 numpy/pandas 安装是否完整：\n${envCheck.output.slice(0, 2000)}`,
          structure,
          dimensionPlan,
          reusedScript,
          scriptRelFolder,
          stderr: envCheck.output,
        }
      }
    } else {
      emitLog('[analysis] system Python — skipping redundant env check (already verified by probe)')
    }
    report('正在运行计算并导出图表…')

    let stdout = ''
    let stderr = ''
    let exitCode = 1
    let scriptTimedOut = false
    const scriptTimeout = EXCEL_SCRIPT_TIMEOUT_MS
    const maxPipRetries = runtime.mode === 'app-cache' ? MAX_AUTO_PIP_RETRIES : 0

    // Monitor outputDir every 5 s while the script runs
    const outDirMonitorInterval = setInterval(() => {
      try {
        if (!fs.existsSync(outDir)) return
        const files = fs.readdirSync(outDir)
        for (const f of files) {
          if (/\.png$/i.test(f)) {
            const abs = path.join(outDir, f)
            const sz = (() => { try { return fs.statSync(abs).size } catch { return 0 } })()
            if (sz > 0) emitLog(`[excel-run] chart detected: ${f} size=${sz}B`)
          }
        }
      } catch { /* ignore */ }
    }, 5000)

    try {
      for (let pipRound = 0; pipRound <= maxPipRetries; pipRound += 1) {
        const run = await runPythonFile(scriptPath, env, scriptTimeout, runtime)
        stdout = run.stdout
        stderr = run.stderr
        exitCode = run.code
        scriptTimedOut = run.timedOut

        if (scriptTimedOut) {
          emitLog(`[analysis] script timed out after ${scriptTimeout}ms`)
          // For LLM-generated scripts, try local fallback once
          if (!useModelBuiltinPlot) {
            emitLog('[analysis] LLM script timeout — trying local fallback script')
            report('脚本超时，正在尝试本地 fallback…')
            const fbPath = writeFallbackScript(workspacePath)
            emitLog(`[analysis] fallback scriptPath: ${fbPath}`)
            const fbRun = await runPythonFile(fbPath, env, 60_000, runtime)
            if (fbRun.code === 0 && !fbRun.timedOut) {
              emitLog('[analysis] local fallback succeeded')
              stdout = fbRun.stdout
              stderr = fbRun.stderr
              exitCode = 0
              scriptTimedOut = false
            } else {
              emitLog(`[analysis] local fallback also failed — exitCode=${fbRun.code}, timedOut=${fbRun.timedOut}`)
              stderr = `LLM 脚本超时；本地 fallback 也失败（exitCode=${fbRun.code}）。\nfallback stderr:\n${fbRun.stderr}`
              exitCode = -1
            }
          }
          break
        }

        if (exitCode === 0) break
        if (pipRound >= maxPipRetries) break
        const blob = `${stderr}\n${stdout}`
        const missing = parseMissingPythonModule(blob)
        if (!missing) break
        const pipSpec = allowedAutoPipSpec(missing)
        if (!pipSpec) {
          stderr = `${stderr}\n[auto-pip] 缺少模块「${missing}」不在允许范围；请仅使用 pandas / numpy / scipy / matplotlib 与标准库。`.trim()
          break
        }
        const inst = await pipInstallPackages([pipSpec], { executable: runtime.executable, version: runtime.version, arch: runtime.arch, majorMinor: '' })
        if (!inst.ok) {
          stderr = `${stderr}\n[auto-pip] ${pipSpec}: ${inst.message}`.trim()
          break
        }
      }
    } finally {
      clearInterval(outDirMonitorInterval)
    }

    releaseTempFiles()
    emitLog(`[analysis] exitCode: ${exitCode}, timedOut: ${scriptTimedOut}`)
    const stdoutTail = stdout.split('\n').filter(Boolean).slice(-30).join('\n')
    const stderrTail = stderr.split('\n').filter(Boolean).slice(-30).join('\n')
    if (stdoutTail) emitLog(`[analysis] stdout (last 30 lines):\n${stdoutTail}`)
    if (stderrTail) emitLog(`[analysis] stderr (last 30 lines):\n${stderrTail}`)

    // List actual files in outDir for debugging
    try {
      const outFiles = fs.existsSync(outDir) ? fs.readdirSync(outDir) : []
      const fileList = outFiles.map((f) => {
        try { const s = fs.statSync(path.join(outDir, f)); return `${f}(${s.size}B)` } catch { return f }
      }).join(', ')
      emitLog(`[analysis] outDir contents: ${fileList || '(empty)'}`)
    } catch { /* ignore */ }

    // Surface timeout before collecting images (no images will exist)
    if (scriptTimedOut && exitCode !== 0) {
      const timeoutMsg = [
        `分析脚本执行超时（>${EXCEL_SCRIPT_TIMEOUT_MS / 1000}s），已强制终止。`,
        `脚本路径：${scriptPath}`,
        `输入 CSV：${csvPath}`,
        `输出目录：${outDir}`,
        `Python 可执行文件：${runtime.executable}`,
        `运行模式：${runtime.mode}`,
        '如需手动调试，请复制以上信息。',
      ].join('\n')
      report('分析超时')
      emitLog(`[analysis] TIMEOUT: ${timeoutMsg}`)
      return {
        ok: false,
        error: timeoutMsg,
        structure,
        dimensionPlan,
        reusedScript,
        scriptRelFolder,
        stdout,
        stderr,
        outputImages: [],
        outputDir: outDir,
        analysis: undefined,
      }
    }

    const analysis = extractJsonFromStdout(stdout)
    const outputImages: string[] = []
    const named = useModelBuiltinPlot && expectedModelChartFiles.length > 0
      ? [...expectedModelChartFiles]
      : [...EXCEL_CHART_FILENAMES]
    for (const n of named) {
      const abs = path.join(outDir, n)
      if (fs.existsSync(abs)) {
        const sz = (() => { try { return fs.statSync(abs).size } catch { return 0 } })()
        if (sz > 0) {
          outputImages.push(abs)
        } else {
          emitLog(`[analysis] SKIP ${n}: exists but size=0`)
        }
      }
    }
    if (outputImages.length === 0 && analysis && Array.isArray(analysis.chart_files)) {
      for (const name of analysis.chart_files as unknown[]) {
        const n = String(name || '').trim()
        if (!n) continue
        const abs = path.join(outDir, n)
        if (fs.existsSync(abs)) {
          const sz = (() => { try { return fs.statSync(abs).size } catch { return 0 } })()
          if (sz > 0) outputImages.push(abs)
        }
      }
    }
    emitLog(`[analysis] outputImages found: ${outputImages.length} — ${outputImages.join(', ') || '(none)'}`)

    if (exitCode !== 0) {
      report('计算未完成')
      const errMsg = stderr.trim() || `Python 退出码 ${exitCode}`
      emitLog(`[analysis] FAILED: ${errMsg.slice(0, 200)}`)
      return {
        ok: false,
        error: errMsg,
        structure,
        dimensionPlan,
        reusedScript,
        scriptRelFolder,
        stdout,
        stderr,
        outputImages,
        outputDir: outDir,
        analysis: analysis ?? undefined,
      }
    }

    // Script exited 0 but produced no charts — surface this as an error
    if (outputImages.length === 0) {
      const msg = '分析脚本执行成功，但未生成图表文件。请打开调试日志查看详情，或切换为通用分析模式。'
      emitLog(`[analysis] exitCode=0 but no output images in ${outDir}`)
      report('无图表输出')
      return {
        ok: false,
        error: msg,
        structure,
        dimensionPlan,
        reusedScript,
        scriptRelFolder,
        stdout,
        stderr,
        outputImages: [],
        outputDir: outDir,
        analysis: analysis ?? undefined,
      }
    }

    report('分析完成')
    emitLog(`[analysis] SUCCESS — ${outputImages.length} chart(s)`)
    return {
      ok: true,
      structure,
      dimensionPlan,
      reusedScript,
      scriptRelFolder,
      stdout,
      stderr,
      outputImages,
      outputDir: outDir,
      analysis: analysis ?? undefined,
    }
  } catch (e) {
    releaseTempFiles()
    report('运行过程出错')
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      structure,
      dimensionPlan,
      reusedScript,
      scriptRelFolder,
    }
  }
}

/**
 * Run a full diagnostic probe of all candidate Python executables.
 * Returns a structured report for the diagnostics panel.
 */
export async function runExcelPythonDiagnostics(): Promise<Record<string, unknown>> {
  const candidates = [
    process.env.EXCEL_ANALYSIS_PYTHON_EXE,
    process.env.AI_OFFICE_PYTHON_EXE,
    'py',
    'python',
    'python3',
  ].filter((c): c is string => Boolean(c))

  const results: Record<string, unknown> = {}
  for (const cmd of candidates) {
    // Try with no extra args first (covers python/python3); for 'py' also try '-3'
    const probed = await probeSystemPythonCandidate(cmd, cmd === 'py' ? ['-3'] : [], 10_000)
    results[cmd] = probed ?? { ok: false, error: 'probe returned null (timeout or not found)' }
  }

  const siteDir = pythonSitePackagesDir()
  const stamp = readPresetStampJson()
  const cachedRuntime = _cachedSystemRuntime

  return {
    candidates: results,
    appCacheStamp: stamp ?? null,
    appCacheSiteDir: siteDir,
    appCacheSiteDirExists: fs.existsSync(siteDir),
    cachedSystemRuntime: cachedRuntime
      ? { executable: cachedRuntime.executable, version: cachedRuntime.version, arch: cachedRuntime.arch }
      : null,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    envOverrides: {
      EXCEL_ANALYSIS_PYTHON_EXE: process.env.EXCEL_ANALYSIS_PYTHON_EXE ?? null,
      AI_OFFICE_PYTHON_EXE: process.env.AI_OFFICE_PYTHON_EXE ?? null,
      AI_OFFICE_PIP_TIMEOUT_MS: process.env.AI_OFFICE_PIP_TIMEOUT_MS ?? null,
    },
  }
}

