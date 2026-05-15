import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import * as XLSX from 'xlsx'

function ensureModelDir(root: string): string | null {
  if (!root) return null
  try {
    const stat = fs.statSync(root)
    return stat.isDirectory() ? root : null
  } catch {
    return null
  }
}

/** 优先使用项目 temp/<id>（用户提供脚本）；其次回退到随包 resources/data-table-models/<id> */
export function resolveBundledDataTableModelDir(modelId: string): string | null {
  const id = String(modelId || '').trim()
  if (!id) return null
  const roots = [
    path.join(process.cwd(), 'temp', id),
    path.join(path.dirname(app.getPath('exe')), 'temp', id),
    path.join(process.resourcesPath || '', 'data-table-models', id),
    path.join(process.cwd(), 'resources', 'data-table-models', id),
    path.join(path.dirname(app.getPath('exe')), 'resources', 'data-table-models', id),
  ]
  for (const root of roots) {
    const dir = ensureModelDir(root)
    if (!dir) continue
    const hasManifest = fs.existsSync(path.join(dir, 'manifest.json'))
    const hasKnownScript = fs.existsSync(path.join(dir, 'fit_table_beta4525.py')) || fs.existsSync(path.join(dir, 'plot_builtin.py'))
    if (hasManifest || hasKnownScript) return dir
  }
  return null
}

export interface PlotDataModelMeta {
  id: string
  label: string
  description: string
}

/** 与前端 `PlotService` 中选项保持一致，便于扩展更多模型 */
export const PLOT_DATA_MODEL_REGISTRY: PlotDataModelMeta[] = [
  {
    id: 'model_a',
    label: '模型 A · 循环寿命',
    description:
      '面向循环/容量类表格：识别「循环、周次、Cycle」与「容量、Cap、mAh」等列，去掉关键列为空的行，并追加 SoH_%（相对本列最大实测容量的百分比），便于寿命与容量衰减类曲线绘图。',
  },
]

/** 返回所有已注册的内置数据模型列表 */
export function listBundledPlotDataModels(): PlotDataModelMeta[] {
  return PLOT_DATA_MODEL_REGISTRY
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value).trim()
}

function readMatrixFromFile(filePath: string): string[][] {
  const buf = fs.readFileSync(filePath)
  const book = XLSX.read(buf, { type: 'buffer', raw: false, cellDates: true })
  const first = book.SheetNames[0]
  if (!first) return []
  const ws = book.Sheets[first]
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' }) as unknown[][]
  let maxCols = 0
  for (const row of raw) {
    if (Array.isArray(row)) maxCols = Math.max(maxCols, row.length)
  }
  return raw.map((row) => {
    const r = Array.isArray(row) ? row : []
    return Array.from({ length: maxCols }, (_, i) => cellToString(r[i]))
  })
}

function parseNumberLoose(s: string): number | null {
  const t = String(s || '').trim().replace(/,/g, '')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function matchCycleColumnIndex(header: string[]): number {
  const re = /(循环|周次|周数|圈数|次数|cycle|cyc|^n$)/i
  for (let i = 0; i < header.length; i++) {
    const h = String(header[i] || '').trim()
    if (h && re.test(h)) return i
  }
  return -1
}

function matchCapacityColumnIndex(header: string[]): number {
  const re = /(容量|cap|mah|fcc|放电|dch|qd|电量|specific|容量保持|保持率|retention)/i
  for (let i = 0; i < header.length; i++) {
    const h = String(header[i] || '').trim()
    if (h && re.test(h)) return i
  }
  return -1
}

function findHeaderRowIndex(matrix: string[][]): number {
  for (let r = 0; r < Math.min(matrix.length, 30); r++) {
    const row = matrix[r]
    const nonEmpty = row.filter((c) => String(c || '').trim().length > 0).length
    if (nonEmpty >= 2) return r
  }
  return 0
}

function copyToTempCsv(inputPath: string): string {
  const dir = path.join(os.tmpdir(), 'ai-office-excel-cache')
  fs.mkdirSync(dir, { recursive: true })
  const out = path.join(dir, `plot-model-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.csv`)
  fs.copyFileSync(inputPath, out)
  return out
}

function writeMatrixToTempCsv(rows: string[][]): string {
  const dir = path.join(os.tmpdir(), 'ai-office-excel-cache')
  fs.mkdirSync(dir, { recursive: true })
  const out = path.join(dir, `plot-model-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.csv`)
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const csv = XLSX.utils.sheet_to_csv(ws, { FS: ',', RS: '\n' })
  fs.writeFileSync(out, `\ufeff${csv}`, 'utf-8')
  return out
}

function applyModelA(inputPath: string): { outputPath: string; message: string } {
  const matrix = readMatrixFromFile(inputPath)
  if (!matrix.length) {
    const outputPath = copyToTempCsv(inputPath)
    return { outputPath, message: '表格为空，已原样复制供绘图使用。' }
  }

  const headerRow = findHeaderRowIndex(matrix)
  const header = matrix[headerRow].map((h) => String(h || '').trim())
  const cycleIdx = matchCycleColumnIndex(header)
  const capIdx = matchCapacityColumnIndex(header)

  if (capIdx < 0) {
    const outputPath = copyToTempCsv(inputPath)
    return {
      outputPath,
      message: '未识别到容量相关列（如「容量」「Cap」「mAh」等），已跳过计算并原样输出。',
    }
  }

  const bodyStart = headerRow + 1
  const outHeader = [...header, 'SoH_%']
  const numericCaps: number[] = []

  for (let r = bodyStart; r < matrix.length; r++) {
    const row = matrix[r]
    const cap = parseNumberLoose(row[capIdx] ?? '')
    if (cap === null) continue
    numericCaps.push(cap)
  }

  if (!numericCaps.length) {
    const outputPath = copyToTempCsv(inputPath)
    return { outputPath, message: '容量列无有效数值行，已原样输出。' }
  }

  const maxCap = Math.max(...numericCaps)
  const outRows: string[][] = [outHeader]
  let kept = 0
  for (let r = bodyStart; r < matrix.length; r++) {
    const row = matrix[r]
    const cap = parseNumberLoose(row[capIdx] ?? '')
    if (cap === null) continue
    const soh = maxCap > 0 ? (cap / maxCap) * 100 : 0
    const extended = [...row]
    while (extended.length < header.length) extended.push('')
    extended.push(soh.toFixed(4))
    outRows.push(extended)
    kept++
  }

  const outputPath = writeMatrixToTempCsv(outRows)
  const parts = [`已在 ${kept} 行数据上追加 SoH_%（以最大容量 ${maxCap} 为 100%）。`]
  if (cycleIdx >= 0) parts.push(`已关联循环列「${header[cycleIdx]}」。`)
  else parts.push('未识别循环列，仅按容量列计算 SoH_%。')
  let message = parts.join('')
  const bundle = resolveBundledDataTableModelDir('model_a')
  if (bundle) {
    try {
      const raw = fs.readFileSync(path.join(bundle, 'manifest.json'), 'utf-8')
      const m = JSON.parse(raw) as { version?: string }
      if (m?.version) message += ` [内置模型资源 v${m.version}]`
    } catch {
      // ignore
    }
  }
  return { outputPath, message }
}

export function applyPlotDataModel(modelId: string, inputPath: string): { outputPath: string; message: string } {
  const trimmed = String(inputPath || '').trim()
  if (!trimmed) throw new Error('数据文件路径不能为空')
  if (!fs.existsSync(trimmed)) throw new Error('数据文件不存在')

  const id = String(modelId || '').trim()
  if (!id) throw new Error('模型 ID 不能为空')

  if (id === 'model_a') {
    return applyModelA(trimmed)
  }

  throw new Error(`未知的数据预处理模型: ${id}`)
}
