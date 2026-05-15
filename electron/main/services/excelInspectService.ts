import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as XLSX from 'xlsx'

const EXCEL_EXT = /\.xlsx?$/i

export type ExcelColumnInferredType = 'number' | 'date' | 'boolean' | 'string' | 'mixed' | 'empty'

export interface ExcelColumnInfo {
  index: number
  name: string
  inferredType: ExcelColumnInferredType
  formulaCellsInSample: number
  nonEmptyCount: number
}

export interface ExcelInspectSheetSummary {
  name: string
  rowCount: number
  columnCount: number
}

export interface ExcelInspectResult {
  ok: true
  filePath: string
  sheetNames: string[]
  activeSheet: string
  sheets: ExcelInspectSheetSummary[]
  headerRowIndex: number
  columns: ExcelColumnInfo[]
  previewRows: string[][]
  formulaColumnNames: string[]
  notes: string[]
}

function assertExcelPath(filePath: string): void {
  const trimmed = String(filePath || '').trim()
  if (!trimmed) throw new Error('Excel 路径不能为空')
  if (!fs.existsSync(trimmed)) throw new Error('Excel 文件不存在')
  if (!EXCEL_EXT.test(trimmed)) throw new Error('仅支持 .xlsx / .xls')
}

/** 打包后主进程内 xlsx 的 readFile 会缺少 fs 回退并报 Cannot access file；统一 buffer 解析 */
function readExcelWorkbookFromDisk(filePath: string, cellFormula: boolean): XLSX.WorkBook {
  const buf = fs.readFileSync(filePath)
  return XLSX.read(buf, { type: 'buffer', cellDates: true, cellFormula })
}

function inferCellType(value: unknown): ExcelColumnInferredType {
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
  return 'string'
}

function mergeTypes(a: ExcelColumnInferredType, b: ExcelColumnInferredType): ExcelColumnInferredType {
  if (a === b) return a
  if (a === 'empty') return b
  if (b === 'empty') return a
  return 'mixed'
}

export function inspectExcelWorkbook(filePath: string, sheetName?: string): ExcelInspectResult {
  assertExcelPath(filePath)
  const book = readExcelWorkbookFromDisk(filePath, true)
  const sheetNames = book.SheetNames
  if (!sheetNames.length) throw new Error('工作簿中没有工作表')

  const activeSheet = sheetName && sheetNames.includes(sheetName) ? sheetName : sheetNames[0]
  const ws = book.Sheets[activeSheet]
  if (!ws) throw new Error('无法读取工作表')

  const sheets: ExcelInspectSheetSummary[] = sheetNames.map((name) => {
    const s = book.Sheets[name]
    const ref = s?.['!ref']
    if (!ref) return { name, rowCount: 0, columnCount: 0 }
    const range = XLSX.utils.decode_range(ref)
    return {
      name,
      rowCount: range.e.r - range.s.r + 1,
      columnCount: range.e.c - range.s.c + 1,
    }
  })

  const ref = ws['!ref']
  if (!ref) {
    return {
      ok: true,
      filePath,
      sheetNames,
      activeSheet,
      sheets,
      headerRowIndex: 0,
      columns: [],
      previewRows: [],
      formulaColumnNames: [],
      notes: ['该工作表为空。'],
    }
  }

  const range = XLSX.utils.decode_range(ref)
  const maxR = Math.min(range.e.r, range.s.r + 500)
  const maxC = range.e.c

  const matrix: unknown[][] = []
  for (let R = range.s.r; R <= maxR; R++) {
    const row: unknown[] = []
    for (let C = range.s.c; C <= maxC; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C })
      const cell = ws[addr]
      if (!cell) {
        row.push('')
        continue
      }
      if (cell.f) {
        row.push(cell.v !== undefined && cell.v !== null ? cell.v : '')
      } else {
        row.push(cell.v ?? '')
      }
    }
    matrix.push(row)
  }

  if (!matrix.length) {
    return {
      ok: true,
      filePath,
      sheetNames,
      activeSheet,
      sheets,
      headerRowIndex: 0,
      columns: [],
      previewRows: [],
      formulaColumnNames: [],
      notes: ['该工作表为空。'],
    }
  }

  const headers = matrix[0].map((h, i) => {
    const name = String(h ?? '').trim() || `列${i + 1}`
    return name
  })

  const dataRows = matrix.slice(1)
  const sampleRows = Math.min(dataRows.length, 200)
  const columns: ExcelColumnInfo[] = headers.map((name, colIndex) => {
    let inferred: ExcelColumnInferredType = 'empty'
    let formulaCellsInSample = 0
    let nonEmptyCount = 0
    for (let r = 0; r < sampleRows; r++) {
      const R = range.s.r + 1 + r
      const addr = XLSX.utils.encode_cell({ r: R, c: range.s.c + colIndex })
      const cell = ws[addr]
      if (cell?.f) formulaCellsInSample++
      const val = dataRows[r]?.[colIndex]
      const t = inferCellType(val)
      if (t !== 'empty') nonEmptyCount++
      inferred = inferred === 'empty' && t === 'empty' ? 'empty' : inferred === 'empty' ? t : mergeTypes(inferred, t)
    }
    return {
      index: colIndex,
      name,
      inferredType: inferred,
      formulaCellsInSample,
      nonEmptyCount,
    }
  })

  const formulaColumnNames = columns.filter((c) => c.formulaCellsInSample > 0).map((c) => c.name)

  const previewRows = dataRows.slice(0, 4).map((row) =>
    headers.map((_, i) => {
      const v = row[i]
      if (v instanceof Date) return v.toISOString().slice(0, 10)
      if (v && typeof v === 'object') return JSON.stringify(v)
      return String(v ?? '')
    }),
  )

  const notes: string[] = []
  if (formulaColumnNames.length) {
    notes.push(
      `以下列在抽样行中包含公式：${formulaColumnNames.join('、')}。社区版 xlsx 可能无法计算全部公式；若绘图数据异常，请在 Excel 中将关键列「选择性粘贴为数值」后重试。`,
    )
  }
  if (sheetNames.length > 1) {
    notes.push('含多个工作表时，请在界面选择目标表；绘图前会导出为临时 CSV 供 Python 引擎读取。')
  }

  return {
    ok: true,
    filePath,
    sheetNames,
    activeSheet,
    sheets,
    headerRowIndex: 0,
    columns,
    previewRows,
    formulaColumnNames,
    notes,
  }
}

export function exportExcelSheetToTempCsv(filePath: string, sheetName: string): { tempPath: string } {
  assertExcelPath(filePath)
  const book = readExcelWorkbookFromDisk(filePath, false)
  const name = String(sheetName || '').trim()
  if (!book.SheetNames.includes(name)) throw new Error('工作表不存在')
  const ws = book.Sheets[name]
  const csv = XLSX.utils.sheet_to_csv(ws, { FS: ',', RS: '\n' })
  const dir = path.join(os.tmpdir(), 'ai-office-excel-cache')
  fs.mkdirSync(dir, { recursive: true })
  const tempPath = path.join(dir, `plot-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.csv`)
  fs.writeFileSync(tempPath, `\ufeff${csv}`, 'utf-8')
  return { tempPath }
}
