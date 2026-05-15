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

/** 预装到 userData 的常用包（与第 3 步提示词约束一致；含 pandas 常用依赖） */
const PRESET_PIP_PACKAGES = ['pandas', 'numpy', 'scipy', 'matplotlib', 'python-dateutil'] as const

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

function spawnPythonOnce(command: string, args: string[], scriptPath: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      cwd: path.dirname(scriptPath),
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM')
      } catch {
        // ignore
      }
      reject(new Error(`Python 执行超时（>${timeoutMs}ms）`))
    }, timeoutMs)
    child.stdout?.on('data', (c) => { stdout += String(c) })
    child.stderr?.on('data', (c) => { stderr += String(c) })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

async function runPythonFile(scriptPath: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  const site = pythonSitePackagesDir()
  const extraPythonPath = fs.existsSync(site) ? site : ''
  const mergedEnv = {
    ...process.env,
    ...env,
    ...(extraPythonPath ? { PYTHONPATH: [extraPythonPath, process.env.PYTHONPATH || ''].filter(Boolean).join(path.delimiter) } : {}),
  }
  const isWin = process.platform === 'win32'
  const attempts: Array<[string, string[]]> = isWin
    ? [['py', ['-3', scriptPath]], ['python', [scriptPath]]]
    : [['python3', [scriptPath]], ['python', [scriptPath]]]
  let lastError: unknown = null
  for (const [cmd, args] of attempts) {
    try {
      return await spawnPythonOnce(cmd, args, scriptPath, mergedEnv, timeoutMs)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || '无法启动 Python，请安装 Python 3'))
}

function presetStampPath(): string {
  return path.join(pythonSitePackagesDir(), PRESET_STAMP)
}

function readPresetStamp(): string {
  try {
    return fs.readFileSync(presetStampPath(), 'utf-8').trim()
  } catch {
    return ''
  }
}

function writePresetStamp(content: string): void {
  const dir = pythonSitePackagesDir()
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(presetStampPath(), content, 'utf-8')
}

function desiredPresetStamp(): string {
  return [...PRESET_PIP_PACKAGES].sort().join('\n')
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

async function pipInstallPackages(packages: string[]): Promise<{ ok: boolean; message: string }> {
  const list = [...new Set(packages.map((p) => String(p || '').trim()).filter(Boolean))]
  if (!list.length) return { ok: true, message: 'noop' }
  for (const p of list) {
    if (!isSafePipPackageName(p)) {
      return { ok: false, message: `拒绝安装不安全的包名：${p}` }
    }
  }
  const target = pythonSitePackagesDir()
  fs.mkdirSync(target, { recursive: true })
  const isWin = process.platform === 'win32'
  const commonArgs = ['-m', 'pip', 'install', '--upgrade', '--quiet', '--disable-pip-version-check', '-t', target, ...list]
  const attempts: Array<[string, string[]]> = isWin
    ? [['py', ['-3', ...commonArgs]], ['python', commonArgs]]
    : [['python3', commonArgs], ['python', commonArgs]]

  let lastErr: unknown
  for (const [cmd, args] of attempts) {
    try {
      const result = await new Promise<{ code: number; out: string }>((resolve, reject) => {
        const child = spawn(cmd, args, { windowsHide: true })
        let out = ''
        child.stdout?.on('data', (c) => { out += String(c) })
        child.stderr?.on('data', (c) => { out += String(c) })
        child.on('error', reject)
        child.on('close', (code) => resolve({ code: code ?? 1, out }))
      })
      if (result.code === 0) {
        return { ok: true, message: `已安装：${list.join(', ')} → ${target}` }
      }
      lastErr = new Error(result.out.trim() || `pip 退出码 ${result.code}`)
    } catch (e) {
      lastErr = e
    }
  }
  return {
    ok: false,
    message: lastErr instanceof Error ? lastErr.message : String(lastErr || 'pip 安装失败，请检查 Python/pip 是否可用'),
  }
}

/** 预装 pandas/numpy/scipy/matplotlib；版本列表变更会重新安装 */
export async function ensurePresetPythonDependencies(): Promise<{ ok: boolean; message: string }> {
  const desired = desiredPresetStamp()
  if (readPresetStamp() === desired) {
    return { ok: true, message: '常用依赖已就绪（缓存）' }
  }
  const r = await pipInstallPackages([...PRESET_PIP_PACKAGES])
  if (!r.ok) return r
  writePresetStamp(desired)
  return { ok: true, message: r.message }
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

  report('正在准备数据表…')
  const dataModelId = String(input.dataModelId || '').trim()

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

  report('正在准备 Python 运行环境…')
  const preset = await ensurePresetPythonDependencies()
  if (!preset.ok) {
    releaseTempFiles()
    return { ok: false, error: `Python 环境准备失败：${preset.message}`, structure }
  }

  const { sorted, signature } = sortedHeaderSignature(structure.headers)
  const outDir = outputRoot(workspacePath)
  fs.mkdirSync(outDir, { recursive: true })
  fs.mkdirSync(cacheRootForWorkspace(workspacePath), { recursive: true })
  fs.mkdirSync(scriptsRoot(workspacePath), { recursive: true })

  const registry = readRegistry(workspacePath)
  const builtinPlotPath = dataModelId ? resolveBuiltinPlotScript(dataModelId) : null
  /** 选用数据模型、且用户未写自定义需求、且存在模型脚本 → 只跑脚本，不调大模型生成绘图程序 */
  const useModelBuiltinPlot = Boolean(dataModelId && builtinPlotPath && userRequirement.length === 0)
  const expectedModelChartFiles = useModelBuiltinPlot ? resolveModelExpectedChartFiles(dataModelId) : []
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

  try {
    report('正在运行计算并导出图表…')
    if (useModelBuiltinPlot && expectedModelChartFiles.length > 0) {
      // 避免上一次残留图片被当成本次模型输出返回。
      removeExistingChartFiles(outDir, expectedModelChartFiles)
    }
    let stdout = ''
    let stderr = ''
    let exitCode = 1
    for (let pipRound = 0; pipRound <= MAX_AUTO_PIP_RETRIES; pipRound += 1) {
      const run = await runPythonFile(scriptPath, env, 120_000)
      stdout = run.stdout
      stderr = run.stderr
      exitCode = run.code
      if (exitCode === 0) break
      if (pipRound >= MAX_AUTO_PIP_RETRIES) break
      const blob = `${stderr}\n${stdout}`
      const missing = parseMissingPythonModule(blob)
      if (!missing) break
      const pipSpec = allowedAutoPipSpec(missing)
      if (!pipSpec) {
        stderr = `${stderr}\n[auto-pip] 缺少模块「${missing}」不在允许范围；请仅使用 pandas / numpy / scipy / matplotlib 与标准库。`.trim()
        break
      }
      const inst = await pipInstallPackages([pipSpec])
      if (!inst.ok) {
        stderr = `${stderr}\n[auto-pip] ${pipSpec}: ${inst.message}`.trim()
        break
      }
    }

    releaseTempFiles()
    const analysis = extractJsonFromStdout(stdout)
    const outputImages: string[] = []
    const named = useModelBuiltinPlot && expectedModelChartFiles.length > 0
      ? [...expectedModelChartFiles]
      : [...EXCEL_CHART_FILENAMES]
    for (const n of named) {
      const abs = path.join(outDir, n)
      if (fs.existsSync(abs)) outputImages.push(abs)
    }
    if (outputImages.length === 0 && analysis && Array.isArray(analysis.chart_files)) {
      for (const name of analysis.chart_files as unknown[]) {
        const n = String(name || '').trim()
        if (!n) continue
        const abs = path.join(outDir, n)
        if (fs.existsSync(abs)) outputImages.push(abs)
      }
    }
    if (exitCode !== 0) {
      report('计算未完成')
      return {
        ok: false,
        error: stderr.trim() || `Python 退出码 ${exitCode}`,
        structure,
        dimensionPlan,
        reusedScript,
        scriptRelFolder,
        stdout,
        stderr,
        outputImages,
        analysis: analysis ?? undefined,
      }
    }
    report('分析完成')
    return {
      ok: true,
      structure,
      dimensionPlan,
      reusedScript,
      scriptRelFolder,
      stdout,
      stderr,
      outputImages,
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
