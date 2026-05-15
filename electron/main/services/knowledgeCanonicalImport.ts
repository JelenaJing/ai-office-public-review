import fs from 'node:fs/promises'
import path from 'node:path'
import { XMLParser } from 'fast-xml-parser'
import JSZip from 'jszip'
import mammoth from 'mammoth'
import type {
  KnowledgeCanonicalBlock,
  KnowledgeCanonicalBbox,
  KnowledgeCanonicalDocument,
  KnowledgeCanonicalPresentAs,
  KnowledgeCanonicalSemantics,
  KnowledgeCanonicalSurface,
} from '../../../src/types/knowledgeCanonical'
import { KNOWLEDGE_CANONICAL_SCHEMA_VERSION } from '../../../src/types/knowledgeCanonical'

const PRIMARY_ASSET_ID = 'primary'

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: '#text',
  parseTagValue: false,
  trimValues: false,
})

function nowIso(): string {
  return new Date().toISOString()
}

function normalizeText(value: string): string {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/\u0000/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function findKey(obj: unknown, short: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined
  const record = obj as Record<string, unknown>
  const direct = record[short]
  if (direct !== undefined) return direct
  const match = Object.keys(record).find((key) => key === short || key.endsWith(`:${short}`))
  return match ? record[match] : undefined
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function emuToPx(emu: number, fallback = 0): number {
  if (!Number.isFinite(emu) || emu <= 0) return fallback
  return Math.round(emu / 9525)
}

function parseEmu(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

async function fileExistsDisk(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/** 从 pptx 包内解压媒体到 documentDir/ppt-assets，返回相对文档目录的 posix 路径（ppt-assets/…），失败返回 null。 */
async function extractPptxMediaToAssets(
  zip: JSZip,
  zipInternalPath: string,
  mediaOutDir: string,
  uniqueStem: string,
): Promise<string | null> {
  const normalized = zipInternalPath.replace(/\\/g, '/').replace(/^\/+/, '')
  const candidates = Array.from(new Set([
    normalized,
    normalized.startsWith('ppt/') ? normalized : `ppt/${normalized.replace(/^ppt\//, '')}`,
  ]))
  let entry: JSZip.JSZipObject | null = null
  let usedPath = ''
  for (const p of candidates) {
    const zf = zip.file(p)
    if (zf) {
      entry = zf
      usedPath = p
      break
    }
  }
  if (!entry) return null

  const buf = await entry.async('nodebuffer')
  if (!buf.length) return null

  const baseFromZip = path.posix.basename(usedPath) || 'image.bin'
  const ext = path.extname(baseFromZip) || '.bin'
  const stemRaw = path.basename(baseFromZip, ext).replace(/[^a-zA-Z0-9._-]/g, '_') || 'img'
  const stem = `${uniqueStem}_${stemRaw}`.slice(0, 120)

  await fs.mkdir(mediaOutDir, { recursive: true })

  let file = `${stem}${ext}`
  let disk = path.join(mediaOutDir, file)
  let n = 0
  while (await fileExistsDisk(disk)) {
    n += 1
    file = `${stem}_${n}${ext}`
    disk = path.join(mediaOutDir, file)
  }
  await fs.writeFile(disk, buf)
  return `ppt-assets/${file.replace(/\\/g, '/')}`
}

function heuristicSemantics(surfaces: KnowledgeCanonicalSurface[], docType: KnowledgeCanonicalDocument['doc_type']): KnowledgeCanonicalSemantics {
  const fullText = surfaces.flatMap((s) => s.blocks)
    .map((b) => b.content.text || (b.content.rows?.map((r) => r.join('\t')).join('\n')))
    .filter(Boolean)
    .join('\n')
  const len = fullText.length
  const slideOrPageCount = surfaces.length
  let templateConfidence = 0.35
  let materialConfidence = 0.35
  if (docType === 'presentation') {
    templateConfidence = slideOrPageCount <= 12 && len < 8000 ? 0.62 : 0.45
    materialConfidence = len > 12000 ? 0.55 : 0.4
  } else if (docType === 'image_doc') {
    templateConfidence = 0.25
    materialConfidence = 0.7
  } else {
    materialConfidence = len > 6000 ? 0.58 : 0.42
    templateConfidence = slideOrPageCount === 1 && len < 2500 ? 0.55 : 0.38
  }
  const tags: KnowledgeCanonicalSemantics['tags'] = [
    { name: docType, group: 'structure', source: 'system' },
  ]
  if (docType === 'presentation') {
    tags.push({ name: '演示稿', group: 'structure', source: 'system' })
  }
  return {
    summary: fullText ? normalizeText(fullText).slice(0, 400) : '',
    tags,
    template_confidence: Math.min(0.95, templateConfidence),
    material_confidence: Math.min(0.95, materialConfidence),
  }
}

export function canonicalDocumentToPlainText(doc: KnowledgeCanonicalDocument): string {
  const lines: string[] = []
  for (const surface of doc.surfaces) {
    const label = surface.surface_type === 'slide'
      ? `--- 幻灯片 ${surface.index} ---`
      : surface.surface_type === 'page'
        ? `--- 第 ${surface.index} 页 ---`
        : `--- 画布 ---`
    lines.push(label)
    for (const block of [...surface.blocks].sort((a, b) => a.order - b.order)) {
      if (block.content.text) {
        const prefix = block.block_type === 'heading' ? '# ' : block.block_type === 'list' ? '- ' : ''
        lines.push(`${prefix}${block.content.text}`)
      }
      if (block.content.rows?.length) {
        lines.push(block.content.rows.map((row) => row.join('\t')).join('\n'))
      }
      if (block.block_type === 'image' && block.content.asset_id) {
        lines.push(`[图片 asset:${block.content.asset_id}]`)
      }
    }
    lines.push('')
  }
  return normalizeText(lines.join('\n'))
}

function ooxmlLocalName(key: string): string {
  const i = key.lastIndexOf(':')
  return i >= 0 ? key.slice(i + 1) : key
}

/** Word w:t 片段（属性在兄弟节点，只取文本）。 */
function wordChunkToString(chunk: unknown): string {
  if (typeof chunk === 'string') return chunk
  if (typeof chunk === 'number') return String(chunk)
  if (chunk && typeof chunk === 'object') {
    const raw = (chunk as Record<string, unknown>)['#text']
    if (typeof raw === 'string' || typeof raw === 'number') return String(raw)
  }
  return ''
}

/** Word w:r 内可见字符：仅 w:t / w:delText / 制表与换行，忽略 rPr / instrText / fldChar / 绘图等。 */
function collectWordRunVisibleText(r: unknown): string {
  if (!r || typeof r !== 'object') return ''
  const parts: string[] = []
  const rec = r as Record<string, unknown>
  for (const [key, val] of Object.entries(rec)) {
    if (key === '#text' || key === 'rPr') continue
    const loc = ooxmlLocalName(key)
    if (loc === 't') {
      for (const chunk of asArray(val)) {
        parts.push(wordChunkToString(chunk))
      }
    } else if (loc === 'delText') {
      for (const chunk of asArray(val)) {
        parts.push(wordChunkToString(chunk))
      }
    } else if (loc === 'tab') {
      parts.push('\t')
    } else if (loc === 'br' || loc === 'cr') {
      parts.push('\n')
    }
  }
  return parts.join('')
}

/**
 * Word w:p 正文：只遍历 w:r / w:hyperlink / w:fldSimple / w:sdt / 修订等已知分支，
 * 绝不 Object.values 全表扫描（否则会拼进字体名、域代码、拼写标记等垃圾）。
 */
function collectWordParagraphText(p: unknown): string {
  if (!p || typeof p !== 'object') return ''
  const parts: string[] = []
  const rec = p as Record<string, unknown>
  for (const [key, val] of Object.entries(rec)) {
    if (key === '#text' || key === 'pPr') continue
    const loc = ooxmlLocalName(key)
    if (loc === 'r') {
      for (const r of asArray(val)) {
        parts.push(collectWordRunVisibleText(r))
      }
    } else if (loc === 'hyperlink' || loc === 'fldSimple' || loc === 'subDoc') {
      for (const item of asArray(val)) {
        parts.push(collectWordParagraphText(item))
      }
    } else if (loc === 'sdt') {
      for (const sdt of asArray(val)) {
        if (!sdt || typeof sdt !== 'object') continue
        const c = findKey(sdt as Record<string, unknown>, 'sdtContent')
        parts.push(collectWordParagraphText(c))
      }
    } else if (loc === 'ins' || loc === 'moveTo' || loc === 'smartTag') {
      for (const item of asArray(val)) {
        parts.push(collectWordParagraphText(item))
      }
    } else if (loc === 'AlternateContent') {
      for (const ac of asArray(val)) {
        if (!ac || typeof ac !== 'object') continue
        const choice = findKey(ac as Record<string, unknown>, 'Choice')
        parts.push(collectWordParagraphText(choice))
      }
    } else if (loc === 'br' || loc === 'cr') {
      parts.push('\n')
    } else if (loc === 'tab') {
      parts.push('\t')
    }
  }
  return parts.join('')
}

/** w:tc 内多块（段落 / 嵌套表 / 控件），不含 tcPr。 */
function collectWordCellText(tc: unknown): string {
  if (!tc || typeof tc !== 'object') return ''
  const lines: string[] = []
  for (const [key, val] of Object.entries(tc as Record<string, unknown>)) {
    if (key === '#text' || key === 'tcPr') continue
    const loc = ooxmlLocalName(key)
    if (loc === 'p') {
      for (const pInner of asArray(val)) {
        const t = normalizeText(collectWordParagraphText(pInner))
        if (t) lines.push(t)
      }
    } else if (loc === 'tbl') {
      for (const innerTbl of asArray(val)) {
        const nested = extractWordTableRowsFromTbl(innerTbl)
        if (nested.length) {
          lines.push(nested.map((row) => row.join('\t')).join('\n'))
        }
      }
    } else if (loc === 'sdt') {
      for (const sdt of asArray(val)) {
        if (!sdt || typeof sdt !== 'object') continue
        const c = findKey(sdt as Record<string, unknown>, 'sdtContent')
        if (c) lines.push(normalizeText(collectWordCellText(c)))
      }
    }
  }
  return lines.filter(Boolean).join('\n')
}

function extractWordTableRowsFromTbl(tbl: unknown): string[][] {
  const rows: string[][] = []
  const trs = asArray(findKey((tbl as Record<string, unknown>) || {}, 'tr'))
  for (const tr of trs) {
    if (!tr || typeof tr !== 'object') continue
    const tcs = asArray(findKey(tr as Record<string, unknown>, 'tc'))
    const cells = tcs.map((tc) => normalizeText(collectWordCellText(tc)))
    if (cells.length) rows.push(cells)
  }
  return rows
}

/** document.xml.rels：rId → zip 内路径（posix，如 word/media/image1.png）。 */
async function loadWordDocumentRelTargetMap(zip: JSZip): Promise<Map<string, string>> {
  const m = new Map<string, string>()
  const relsXml = await zip.file('word/_rels/document.xml.rels')?.async('string')
  if (!relsXml) return m
  const root = xmlParser.parse(relsXml) as Record<string, unknown>
  const relRoot = (findKey(root, 'Relationships') || root) as Record<string, unknown>
  const relItems = asArray(findKey(relRoot, 'Relationship'))
  for (const rel of relItems) {
    if (!rel || typeof rel !== 'object') continue
    const id = String((rel as { Id?: string }).Id || '')
    let target = String((rel as { Target?: string }).Target || '').replace(/\\/g, '/')
    if (!id || !target) continue
    if (target.startsWith('/')) target = target.replace(/^\/+/, '')
    const zipPath = target.startsWith('word/') ? target : `word/${target.replace(/^\.\//, '')}`
    m.set(id, zipPath)
  }
  return m
}

/** 从 docx 包解压图片等到 documentDir/word-assets，返回相对文档目录路径（word-assets/…）。 */
async function extractDocxMediaToAssets(
  zip: JSZip,
  zipInternalPath: string,
  mediaOutDir: string,
  uniqueStem: string,
): Promise<string | null> {
  const normalized = zipInternalPath.replace(/\\/g, '/').replace(/^\/+/, '')
  const candidates = Array.from(new Set([
    normalized,
    normalized.startsWith('word/') ? normalized : `word/${normalized.replace(/^word\//, '')}`,
  ]))
  let entry: JSZip.JSZipObject | null = null
  let usedPath = ''
  for (const p of candidates) {
    const zf = zip.file(p)
    if (zf) {
      entry = zf
      usedPath = p
      break
    }
  }
  if (!entry) return null
  const buf = await entry.async('nodebuffer')
  if (!buf.length) return null
  const baseFromZip = path.posix.basename(usedPath) || 'image.bin'
  const ext = path.extname(baseFromZip) || '.bin'
  const stemRaw = path.basename(baseFromZip, ext).replace(/[^a-zA-Z0-9._-]/g, '_') || 'img'
  const stem = `${uniqueStem}_${stemRaw}`.slice(0, 120)
  await fs.mkdir(mediaOutDir, { recursive: true })
  let file = `${stem}${ext}`
  let disk = path.join(mediaOutDir, file)
  let n = 0
  while (await fileExistsDisk(disk)) {
    n += 1
    file = `${stem}_${n}${ext}`
    disk = path.join(mediaOutDir, file)
  }
  await fs.writeFile(disk, buf)
  return `word-assets/${file.replace(/\\/g, '/')}`
}

function blipEmbedIdFromBlipNode(blip: unknown): string {
  if (!blip || typeof blip !== 'object') return ''
  const o = blip as Record<string, unknown>
  const rid = o.embed || o['r:embed'] || Object.entries(o).find(([k]) => k === 'embed' || k.endsWith(':embed'))?.[1]
  return rid ? String(rid) : ''
}

/** 收集段落子树内所有 a:blip / blip 的 r:embed（顺序为 DFS）。 */
function collectBlipEmbedRIds(node: unknown, acc: string[]): void {
  if (node === undefined || node === null) return
  if (Array.isArray(node)) {
    for (const x of node) collectBlipEmbedRIds(x, acc)
    return
  }
  if (typeof node !== 'object') return
  const rec = node as Record<string, unknown>
  for (const [key, val] of Object.entries(rec)) {
    if (key === '#text') continue
    const loc = ooxmlLocalName(key)
    if (loc === 'blip') {
      for (const b of asArray(val)) {
        const id = blipEmbedIdFromBlipNode(b)
        if (id) acc.push(id)
      }
    } else {
      collectBlipEmbedRIds(val, acc)
    }
  }
}

/** Office Math（m:oMath）内 m:t 纯文本，拼成可读片段（非 LaTeX）。 */
function extractWordMathPlainFromParagraph(p: unknown): string {
  const parts: string[] = []
  const walk = (n: unknown, inMath: boolean) => {
    if (n === undefined || n === null) return
    if (Array.isArray(n)) {
      for (const x of n) walk(x, inMath)
      return
    }
    if (typeof n !== 'object') return
    for (const [key, val] of Object.entries(n as Record<string, unknown>)) {
      if (key === '#text') continue
      const loc = ooxmlLocalName(key)
      const enterMath = inMath || loc === 'oMath' || loc === 'oMathPara'
      const isMathTextToken = enterMath && loc === 't' && (key.startsWith('m:') || key.includes(':m:'))
      if (isMathTextToken) {
        for (const ch of asArray(val)) {
          const s = wordChunkToString(ch)
          if (s) parts.push(s)
        }
      } else {
        walk(val, enterMath)
      }
    }
  }
  walk(p, false)
  const raw = parts.join(' ').replace(/\s+/g, ' ').trim()
  return raw ? `⟨${raw}⟩` : ''
}

interface DocxWalkContext {
  zip: JSZip
  relMap: Map<string, string>
  mediaOutDir?: string
}

/** 遍历 w:body / w:sdtContent 等，抽取 w:p、w:tbl、段落内嵌图（word-assets）。 */
async function walkDocxBlockTreeAsync(
  node: unknown,
  blocks: KnowledgeCanonicalBlock[],
  orderRef: { n: number },
  ctx: DocxWalkContext,
): Promise<void> {
  if (!node || typeof node !== 'object') return
  const rec = node as Record<string, unknown>
  for (const [key, val] of Object.entries(rec)) {
    if (key === '#text') continue
    const local = ooxmlLocalName(key)
    if (local === 'p') {
      for (const pInner of asArray(val)) {
        const mathSuffix = extractWordMathPlainFromParagraph(pInner)
        const baseText = normalizeText(collectWordParagraphText(pInner))
        const text = normalizeText(`${baseText}${mathSuffix ? ` ${mathSuffix}` : ''}`.trim())
        const pRec = pInner as Record<string, unknown>
        const pPr = findKey(pRec, 'pPr') as Record<string, unknown> | undefined
        const outlineLvl = pPr ? findKey(pPr, 'outlineLvl') : undefined
        const pStyle = pPr ? findKey(pPr, 'pStyle') : undefined
        const numPr = pPr ? findKey(pPr, 'numPr') : undefined
        const styleVal = typeof pStyle === 'object' && pStyle && 'val' in pStyle ? String((pStyle as { val?: string }).val || '') : ''
        const isHeading = Boolean(outlineLvl) || /heading/i.test(styleVal)
        const isList = Boolean(numPr)
        const rids: string[] = []
        collectBlipEmbedRIds(pInner, rids)
        const seen = new Set<string>()
        const uniqueRids = rids.filter((id) => {
          if (!id || seen.has(id)) return false
          seen.add(id)
          return true
        })
        if (text) {
          orderRef.n += 1
          blocks.push({
            block_id: `b-${orderRef.n}`,
            block_type: isList ? 'list' : isHeading ? 'heading' : 'paragraph',
            role: isList ? 'list_item' : isHeading ? 'heading' : 'body',
            order: orderRef.n,
            content: { text },
            source_anchor: { anchor_type: 'word_paragraph', order: orderRef.n },
          })
        }
        if (ctx.mediaOutDir && uniqueRids.length) {
          for (const rid of uniqueRids) {
            const target = ctx.relMap.get(rid)
            if (!target) continue
            orderRef.n += 1
            const imageRel = await extractDocxMediaToAssets(ctx.zip, target, ctx.mediaOutDir, `w${orderRef.n}`)
            const alt = imageRel ? path.posix.basename(target) : `嵌入图片 (${target})`
            blocks.push({
              block_id: `b-${orderRef.n}`,
              block_type: 'image',
              role: 'inline_image',
              order: orderRef.n,
              content: {
                asset_id: PRIMARY_ASSET_ID,
                text: alt,
                ...(imageRel ? { image_rel: imageRel } : {}),
              },
              source_anchor: { anchor_type: 'word_drawing', rid, target },
            })
          }
        }
      }
      continue
    }
    if (local === 'tbl') {
      for (const tbl of asArray(val)) {
        const rows = extractWordTableRowsFromTbl(tbl)
        if (rows.length) {
          orderRef.n += 1
          blocks.push({
            block_id: `b-${orderRef.n}`,
            block_type: 'table',
            order: orderRef.n,
            content: { rows },
            source_anchor: { anchor_type: 'word_table', order: orderRef.n },
          })
        }
      }
      continue
    }
    if (local === 'sdt') {
      for (const sdt of asArray(val)) {
        if (!sdt || typeof sdt !== 'object') continue
        const content = findKey(sdt as Record<string, unknown>, 'sdtContent')
        await walkDocxBlockTreeAsync(content, blocks, orderRef, ctx)
      }
      continue
    }
    if (local === 'sectPr' || local === 'bookmarkStart' || local === 'bookmarkEnd' || local === 'proofErr' || local === 'commentRangeStart' || local === 'commentRangeEnd') {
      continue
    }
  }
}

/** 只取 DrawingML 的 a:t 文本节点，不把 a:rPr / a:pPr / a:latin 等拼进正文（避免 zh-CN、square、乱码）。 */
function collectDrawingMlTextLeaf(node: unknown): string {
  if (node === undefined || node === null) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(collectDrawingMlTextLeaf).join('')
  if (typeof node === 'object') {
    const rec = node as Record<string, unknown>
    const raw = rec['#text']
    if (typeof raw === 'string') return raw
    if (typeof raw === 'number') return String(raw)
    const t = findKey(rec, 't')
    if (t !== undefined) return collectDrawingMlTextLeaf(t)
  }
  return ''
}

/** 从单个 a:p 取可见字符串（a:r / a:fld 内的 a:t，a:br 换行）。 */
function collectPptxParagraphText(p: unknown): string {
  if (!p || typeof p !== 'object') return ''
  const parts: string[] = []
  for (const [key, val] of Object.entries(p as Record<string, unknown>)) {
    if (key === '#text') continue
    const local = ooxmlLocalName(key)
    if (local === 'r') {
      for (const r of asArray(val)) {
        parts.push(collectDrawingMlTextLeaf(r))
      }
    } else if (local === 'fld') {
      for (const fld of asArray(val)) {
        parts.push(collectPptxParagraphText(fld))
      }
    } else if (local === 'br') {
      parts.push('\n')
    }
  }
  return parts.join('')
}

/** PPT txBody：按段落换行，仅文本内容（与 Word 的 collectWordParagraphText 分离）。 */
function collectPptxTxBodyText(txBody: unknown): string {
  if (!txBody || typeof txBody !== 'object') return ''
  const paras = asArray(findKey(txBody as Record<string, unknown>, 'p'))
  const lines: string[] = []
  for (const p of paras) {
    const raw = collectPptxParagraphText(p)
    const line = normalizeText(raw.replace(/\n+/g, ' '))
    if (line) lines.push(line)
  }
  return lines.join('\n')
}

interface ParseDocxOptions {
  /** 绝对路径：documents/<id>/word-assets */
  mediaOutDir?: string
}

async function parseDocxToSurfaces(filePath: string, options?: ParseDocxOptions): Promise<KnowledgeCanonicalSurface[]> {
  const buffer = await fs.readFile(filePath)
  const zip = await JSZip.loadAsync(buffer)
  const docXml = await zip.file('word/document.xml')?.async('string')
  if (!docXml) return []
  const root = xmlParser.parse(docXml) as Record<string, unknown>
  const document = findKey(root, 'document') as Record<string, unknown> | undefined
  const body = document ? findKey(document, 'body') as Record<string, unknown> | undefined : undefined
  if (!body) return []
  const blocks: KnowledgeCanonicalBlock[] = []
  const relMap = await loadWordDocumentRelTargetMap(zip)
  await walkDocxBlockTreeAsync(body, blocks, { n: 0 }, { zip, relMap, mediaOutDir: options?.mediaOutDir })
  return [{
    surface_id: 'page-1',
    surface_type: 'page',
    index: 1,
    size: { width: 595, height: 842 },
    blocks,
  }]
}

/** DrawingML 组合变换：子坐标系 (chOff/chExt) → 父（幻灯片或外层 grpSp）。 */
interface PptxAffine2D {
  tx: number
  ty: number
  sx: number
  sy: number
}

const PPTX_IDENTITY: PptxAffine2D = { tx: 0, ty: 0, sx: 1, sy: 1 }

function multiplyPptxAffine(outer: PptxAffine2D, inner: PptxAffine2D): PptxAffine2D {
  return {
    sx: outer.sx * inner.sx,
    sy: outer.sy * inner.sy,
    tx: outer.tx + outer.sx * inner.tx,
    ty: outer.ty + outer.sy * inner.ty,
  }
}

function pptxAffineFromGroupXfrm(xf: Record<string, unknown> | undefined): PptxAffine2D {
  if (!xf || typeof xf !== 'object') return PPTX_IDENTITY
  const off = findKey(xf, 'off') as { x?: string; y?: string } | undefined
  const ext = findKey(xf, 'ext') as { cx?: string; cy?: string } | undefined
  const chOff = findKey(xf, 'chOff') as { x?: string; y?: string } | undefined
  const chExt = findKey(xf, 'chExt') as { cx?: string; cy?: string } | undefined
  const offX = parseEmu(off?.x)
  const offY = parseEmu(off?.y)
  const extCx = Math.max(parseEmu(ext?.cx), 1)
  const extCy = Math.max(parseEmu(ext?.cy), 1)
  const chOffX = parseEmu(chOff?.x)
  const chOffY = parseEmu(chOff?.y)
  let chExtCx = parseEmu(chExt?.cx)
  let chExtCy = parseEmu(chExt?.cy)
  if (chExtCx <= 0) chExtCx = extCx
  if (chExtCy <= 0) chExtCy = extCy
  const sx = extCx / Math.max(chExtCx, 1)
  const sy = extCy / Math.max(chExtCy, 1)
  return {
    tx: offX - chOffX * sx,
    ty: offY - chOffY * sy,
    sx,
    sy,
  }
}

interface BboxEmu { x: number; y: number; w: number; h: number }

function bboxEmuFromShapeXfrm(xf: Record<string, unknown> | undefined): BboxEmu | null {
  if (!xf || typeof xf !== 'object') return null
  const off = findKey(xf, 'off') as { x?: string; y?: string } | undefined
  const ext = findKey(xf, 'ext') as { cx?: string; cy?: string } | undefined
  const x = parseEmu(off?.x)
  const y = parseEmu(off?.y)
  const w = parseEmu(ext?.cx)
  const h = parseEmu(ext?.cy)
  if (w <= 0 && h <= 0) return null
  return { x, y, w: w > 0 ? w : 1, h: h > 0 ? h : 1 }
}

function mapBBoxEmuToSlidePx(aff: PptxAffine2D, box: BboxEmu): KnowledgeCanonicalBbox {
  const x1 = aff.sx * box.x + aff.tx
  const y1 = aff.sy * box.y + aff.ty
  const x2 = aff.sx * (box.x + box.w) + aff.tx
  const y2 = aff.sy * (box.y + box.h) + aff.ty
  const minX = Math.min(x1, x2)
  const minY = Math.min(y1, y2)
  const maxX = Math.max(x1, x2)
  const maxY = Math.max(y1, y2)
  return {
    x: emuToPx(minX, 0),
    y: emuToPx(minY, 0),
    w: Math.max(emuToPx(maxX - minX, 1), 1),
    h: Math.max(emuToPx(maxY - minY, 1), 1),
  }
}

/** DrawingML a:xfrm：rot 为六万分一度；flipH/flipV 为布尔。 */
function parseShapeXfrmVisual(xf: Record<string, unknown> | undefined): { rot_deg?: number; flip_h?: boolean; flip_v?: boolean } | undefined {
  if (!xf || typeof xf !== 'object') return undefined
  const rawRot = xf.rot ?? (xf as { '@_rot'?: string })['@_rot']
  let rot_deg: number | undefined
  if (typeof rawRot === 'string' && rawRot.trim()) {
    const v = parseInt(rawRot, 10)
    if (!Number.isNaN(v) && v !== 0) rot_deg = v / 60000
  } else if (typeof rawRot === 'number' && rawRot !== 0) {
    rot_deg = rawRot / 60000
  }
  const fh = xf.flipH ?? (xf as { '@_flipH'?: string })['@_flipH']
  const fv = xf.flipV ?? (xf as { '@_flipV'?: string })['@_flipV']
  const flip_h = fh === true || fh === 'true' || fh === '1' || fh === 1
  const flip_v = fv === true || fv === 'true' || fv === '1' || fv === 1
  if (rot_deg == null && !flip_h && !flip_v) return undefined
  return {
    ...(rot_deg != null ? { rot_deg } : {}),
    ...(flip_h ? { flip_h: true } : {}),
    ...(flip_v ? { flip_v: true } : {}),
  }
}

function readLtrbRect(node: unknown): { l: number; t: number; r: number; b: number } | undefined {
  if (!node || typeof node !== 'object') return undefined
  const o = node as Record<string, unknown>
  const l = parseInt(String(o.l ?? o['@_l'] ?? 0), 10) || 0
  const t = parseInt(String(o.t ?? o['@_t'] ?? 0), 10) || 0
  const r = parseInt(String(o.r ?? o['@_r'] ?? 0), 10) || 0
  const b = parseInt(String(o.b ?? o['@_b'] ?? 0), 10) || 0
  if (l === 0 && t === 0 && r === 0 && b === 0) return undefined
  return { l, t, r, b }
}

/** a:stretch/a:fillRect 或 a:srcRect，l/t/r/b 为千分比（0–100000）。 */
function parseBlipFillCrop(blipFill: Record<string, unknown> | undefined): { l: number; t: number; r: number; b: number } | undefined {
  if (!blipFill || typeof blipFill !== 'object') return undefined
  const stretch = findKey(blipFill, 'stretch')
  if (stretch && typeof stretch === 'object') {
    const fillRect = findKey(stretch as Record<string, unknown>, 'fillRect')
    const rect = readLtrbRect(fillRect)
    if (rect) return rect
  }
  const srcRect = findKey(blipFill, 'srcRect')
  return readLtrbRect(srcRect)
}

function mergePptxImageTransform(
  xf: Record<string, unknown> | undefined,
  blipFill: Record<string, unknown> | undefined,
): { rot_deg?: number; flip_h?: boolean; flip_v?: boolean; crop_ltrb?: { l: number; t: number; r: number; b: number } } | undefined {
  const vis = parseShapeXfrmVisual(xf)
  const crop = parseBlipFillCrop(blipFill)
  if (!vis && !crop) return undefined
  return {
    ...vis,
    ...(crop ? { crop_ltrb: crop } : {}),
  }
}

function parsePptxTableToRows(tbl: unknown): string[][] {
  const rows: string[][] = []
  const trs = asArray(findKey(tbl as Record<string, unknown>, 'tr'))
  for (const tr of trs) {
    if (!tr || typeof tr !== 'object') continue
    const cells: string[] = []
    const tcs = asArray(findKey(tr as Record<string, unknown>, 'tc'))
    for (const tc of tcs) {
      if (!tc || typeof tc !== 'object') continue
      const txBody = findKey(tc as Record<string, unknown>, 'txBody')
      cells.push(normalizeText(collectPptxTxBodyText(txBody)))
    }
    if (cells.some(Boolean)) rows.push(cells)
  }
  return rows
}

interface ParsePptxOptions {
  /** 绝对路径：documents/<id>/ppt-assets，写入后 canonical 记 ppt-assets/… */
  mediaOutDir?: string
}

interface PptxSlideEmitContext {
  slideIndex: number
  blocks: KnowledgeCanonicalBlock[]
  order: { n: number }
  zip: JSZip
  mediaOutDir?: string
  slideRelMap: Map<string, string>
}

async function emitPptxShape(shRecord: Record<string, unknown>, affine: PptxAffine2D, ctx: PptxSlideEmitContext): Promise<void> {
  const spPr = findKey(shRecord, 'spPr') as Record<string, unknown> | undefined
  const xf = spPr ? findKey(spPr, 'xfrm') as Record<string, unknown> | undefined : undefined
  const emu = bboxEmuFromShapeXfrm(xf)
  const bbox = emu ? mapBBoxEmuToSlidePx(affine, emu) : { x: 0, y: 0, w: 0, h: 0 }

  const txBody = findKey(shRecord, 'txBody')
  if (txBody) {
    const text = normalizeText(collectPptxTxBodyText(txBody))
    if (!text) return
    ctx.order.n += 1
    const nvPr = findKey(shRecord, 'nvSpPr') || findKey(shRecord, 'nvPicPr')
    const cNvPr = nvPr && typeof nvPr === 'object' ? findKey(nvPr as Record<string, unknown>, 'cNvPr') : undefined
    const name = cNvPr && typeof cNvPr === 'object' ? String((cNvPr as { name?: string }).name || '') : ''
    const role = /title|标题/i.test(name) ? 'title' : /subtitle|副标题/i.test(name) ? 'subtitle' : 'body'
    ctx.blocks.push({
      block_id: `s${ctx.slideIndex}-t${ctx.order.n}`,
      block_type: role === 'title' ? 'heading' : 'text',
      role,
      order: ctx.order.n,
      layout: { bbox, z_index: ctx.order.n },
      content: { text },
      source_anchor: { anchor_type: 'slide_shape', slide_index: ctx.slideIndex, shape_name: name || undefined },
    })
    return
  }

  const blipFill = findKey(shRecord, 'blipFill')
  if (!blipFill) return
  const blipFillRec = blipFill as Record<string, unknown>
  const blip = findKey(blipFillRec, 'blip') as Record<string, unknown> | undefined
  const rid = blip
    ? String(
      blip.embed
        || blip['r:embed']
        || Object.entries(blip).find(([k]) => k.endsWith('embed'))?.[1],
    )
    : ''
  const imageTarget = rid ? ctx.slideRelMap.get(rid) : undefined
  ctx.order.n += 1
  let imageRel: string | undefined
  if (imageTarget && ctx.mediaOutDir) {
    const extracted = await extractPptxMediaToAssets(ctx.zip, imageTarget, ctx.mediaOutDir, `s${ctx.slideIndex}i${ctx.order.n}`)
    imageRel = extracted ?? undefined
  }
  const altText = imageTarget
    ? (imageRel ? path.posix.basename(imageTarget) : `嵌入图片 (${imageTarget})`)
    : '嵌入图片'
  const image_transform = mergePptxImageTransform(xf, blipFillRec)
  ctx.blocks.push({
    block_id: `s${ctx.slideIndex}-i${ctx.order.n}`,
    block_type: 'image',
    role: 'inline_image',
    order: ctx.order.n,
    layout: { bbox, z_index: ctx.order.n },
    content: {
      asset_id: PRIMARY_ASSET_ID,
      text: altText,
      ...(imageRel ? { image_rel: imageRel } : {}),
      ...(image_transform ? { image_transform } : {}),
    },
    source_anchor: { anchor_type: 'slide_picture', slide_index: ctx.slideIndex, part: imageTarget },
  })
}

async function emitPptxPic(picRecord: Record<string, unknown>, affine: PptxAffine2D, ctx: PptxSlideEmitContext): Promise<void> {
  const spPr = findKey(picRecord, 'spPr') as Record<string, unknown> | undefined
  const xf = spPr ? findKey(spPr, 'xfrm') as Record<string, unknown> | undefined : undefined
  const emu = bboxEmuFromShapeXfrm(xf)
  const bbox = emu ? mapBBoxEmuToSlidePx(affine, emu) : { x: 0, y: 0, w: 0, h: 0 }
  const blipFill = findKey(picRecord, 'blipFill')
  if (!blipFill) return
  const blip = findKey(blipFill as Record<string, unknown>, 'blip') as Record<string, unknown> | undefined
  const rid = blip
    ? String(
      blip.embed
        || blip['r:embed']
        || Object.entries(blip).find(([k]) => k.endsWith('embed'))?.[1],
    )
    : ''
  const imageTarget = rid ? ctx.slideRelMap.get(rid) : undefined
  ctx.order.n += 1
  let imageRel: string | undefined
  if (imageTarget && ctx.mediaOutDir) {
    const extracted = await extractPptxMediaToAssets(ctx.zip, imageTarget, ctx.mediaOutDir, `s${ctx.slideIndex}i${ctx.order.n}`)
    imageRel = extracted ?? undefined
  }
  const altText = imageTarget
    ? (imageRel ? path.posix.basename(imageTarget) : `嵌入图片 (${imageTarget})`)
    : '嵌入图片'
  const image_transform = mergePptxImageTransform(xf, blipFill as Record<string, unknown>)
  ctx.blocks.push({
    block_id: `s${ctx.slideIndex}-i${ctx.order.n}`,
    block_type: 'image',
    role: 'inline_image',
    order: ctx.order.n,
    layout: { bbox, z_index: ctx.order.n },
    content: {
      asset_id: PRIMARY_ASSET_ID,
      text: altText,
      ...(imageRel ? { image_rel: imageRel } : {}),
      ...(image_transform ? { image_transform } : {}),
    },
    source_anchor: { anchor_type: 'slide_picture', slide_index: ctx.slideIndex, part: imageTarget },
  })
}

async function emitPptxGraphicFrame(gf: Record<string, unknown>, affine: PptxAffine2D, ctx: PptxSlideEmitContext): Promise<void> {
  const xf = findKey(gf, 'xfrm') as Record<string, unknown> | undefined
  const emu = bboxEmuFromShapeXfrm(xf)
  const bbox = emu ? mapBBoxEmuToSlidePx(affine, emu) : { x: 0, y: 0, w: 0, h: 0 }
  const graphic = findKey(gf, 'graphic') as Record<string, unknown> | undefined
  const graphicData = graphic ? findKey(graphic, 'graphicData') as Record<string, unknown> | undefined : undefined
  const tbl = graphicData ? findKey(graphicData, 'tbl') : undefined
  if (!tbl) return
  const rows = parsePptxTableToRows(tbl)
  if (!rows.length) return
  ctx.order.n += 1
  ctx.blocks.push({
    block_id: `s${ctx.slideIndex}-tbl${ctx.order.n}`,
    block_type: 'table',
    role: 'body',
    order: ctx.order.n,
    layout: { bbox, z_index: ctx.order.n },
    content: { rows },
    source_anchor: { anchor_type: 'slide_table', slide_index: ctx.slideIndex },
  })
}

async function visitPptxSpTreeChildren(container: Record<string, unknown>, affine: PptxAffine2D, ctx: PptxSlideEmitContext): Promise<void> {
  for (const [key, val] of Object.entries(container)) {
    if (key === '#text') continue
    const loc = ooxmlLocalName(key)
    if (loc === 'sp') {
      for (const sp of asArray(val)) {
        if (sp && typeof sp === 'object') await emitPptxShape(sp as Record<string, unknown>, affine, ctx)
      }
    } else if (loc === 'pic') {
      for (const pic of asArray(val)) {
        if (pic && typeof pic === 'object') await emitPptxPic(pic as Record<string, unknown>, affine, ctx)
      }
    } else if (loc === 'graphicFrame') {
      for (const gf of asArray(val)) {
        if (gf && typeof gf === 'object') await emitPptxGraphicFrame(gf as Record<string, unknown>, affine, ctx)
      }
    } else if (loc === 'grpSp') {
      for (const grp of asArray(val)) {
        if (!grp || typeof grp !== 'object') continue
        const grec = grp as Record<string, unknown>
        const grpPr = findKey(grec, 'grpSpPr') as Record<string, unknown> | undefined
        const gxf = grpPr ? findKey(grpPr, 'xfrm') as Record<string, unknown> | undefined : undefined
        const G = pptxAffineFromGroupXfrm(gxf)
        const childAffine = multiplyPptxAffine(affine, G)
        await visitPptxSpTreeChildren(grec, childAffine, ctx)
      }
    }
  }
}

async function parsePptxToSurfaces(filePath: string, options?: ParsePptxOptions): Promise<KnowledgeCanonicalSurface[]> {
  const mediaOutDir = options?.mediaOutDir
  const buffer = await fs.readFile(filePath)
  const zip = await JSZip.loadAsync(buffer)
  const presXml = await zip.file('ppt/presentation.xml')?.async('string')
  if (!presXml) throw new Error('无效的 PPTX：缺少 presentation.xml')

  const pres = xmlParser.parse(presXml) as Record<string, unknown>
  const presentation = findKey(pres, 'presentation') as Record<string, unknown> | undefined
  const sldIdLst = presentation ? findKey(presentation, 'sldIdLst') : undefined
  const sldIds = asArray(sldIdLst ? findKey(sldIdLst as Record<string, unknown>, 'sldId') : undefined)

  const presRelsXml = await zip.file('ppt/_rels/presentation.xml.rels')?.async('string')
  const relRoot = presRelsXml ? xmlParser.parse(presRelsXml) as Record<string, unknown> : {}
  const relsContainer = findKey(relRoot, 'Relationships') as Record<string, unknown> | undefined
  const relItems = asArray(relsContainer ? findKey(relsContainer, 'Relationship') : undefined)
  const relMap = new Map<string, string>()
  for (const rel of relItems) {
    if (rel && typeof rel === 'object') {
      const id = String((rel as { Id?: string }).Id || '')
      const target = String((rel as { Target?: string }).Target || '')
      if (id && target) relMap.set(id, target.replace(/^\//, ''))
    }
  }

  const sldSz = presentation ? findKey(presentation, 'sldSz') : undefined
  const cx = sldSz && typeof sldSz === 'object' ? parseEmu((sldSz as { cx?: string }).cx) : 9144000
  const cy = sldSz && typeof sldSz === 'object' ? parseEmu((sldSz as { cy?: string }).cy) : 6858000
  const slideW = emuToPx(cx, 960)
  const slideH = emuToPx(cy, 540)

  const slidePaths: string[] = []
  for (const entry of sldIds) {
    if (!entry || typeof entry !== 'object') continue
    const rid = String((entry as { 'r:id'?: string; id?: string })['r:id'] || '')
    const target = relMap.get(rid)
    if (target) slidePaths.push(`ppt/${target}`)
  }
  if (slidePaths.length === 0) {
    const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n)).sort((a, b) => {
      const na = Number(a.match(/slide(\d+)/i)?.[1] || 0)
      const nb = Number(b.match(/slide(\d+)/i)?.[1] || 0)
      return na - nb
    })
    slidePaths.push(...names)
  }

  const surfaces: KnowledgeCanonicalSurface[] = []
  let slideIndex = 0
  for (const slidePath of slidePaths) {
    slideIndex += 1
    const slideXml = await zip.file(slidePath)?.async('string')
    if (!slideXml) continue
    const slideRoot = xmlParser.parse(slideXml) as Record<string, unknown>
    const sld = findKey(slideRoot, 'sld') as Record<string, unknown> | undefined
    const cSld = sld ? findKey(sld, 'cSld') as Record<string, unknown> | undefined : undefined
    const spTree = cSld ? findKey(cSld, 'spTree') as Record<string, unknown> | undefined : undefined
    if (!spTree) continue

    const blocks: KnowledgeCanonicalBlock[] = []

    const slideRelsPath = path.posix.join(path.posix.dirname(slidePath), '_rels', `${path.posix.basename(slidePath)}.rels`)
    const slideRelsXml = await zip.file(slideRelsPath)?.async('string')
    const slideRelRoot = slideRelsXml ? xmlParser.parse(slideRelsXml) as Record<string, unknown> : {}
    const slideRelsContainer = findKey(slideRelRoot, 'Relationships') as Record<string, unknown> | undefined
    const slideRelItems = asArray(slideRelsContainer ? findKey(slideRelsContainer, 'Relationship') : undefined)
    const slideRelMap = new Map<string, string>()
    for (const rel of slideRelItems) {
      if (rel && typeof rel === 'object') {
        const id = String((rel as { Id?: string }).Id || '')
        const target = String((rel as { Target?: string }).Target || '')
        if (id && target) slideRelMap.set(id, target.replace(/^\.\.\//, 'ppt/'))
      }
    }

    const ctx: PptxSlideEmitContext = {
      slideIndex,
      blocks,
      order: { n: 0 },
      zip,
      mediaOutDir,
      slideRelMap,
    }
    await visitPptxSpTreeChildren(spTree, PPTX_IDENTITY, ctx)

    surfaces.push({
      surface_id: `slide-${slideIndex}`,
      surface_type: 'slide',
      index: slideIndex,
      size: { width: slideW, height: slideH },
      blocks,
    })
  }

  return surfaces
}

function pdfPlainTextToSurfaces(text: string): KnowledgeCanonicalSurface[] {
  const raw = normalizeText(text)
  if (!raw) return []
  const pages = raw.split(/\n{3,}/)
  return pages.map((pageText, idx) => {
    const chunk = normalizeText(pageText)
    const paras = chunk
      ? chunk.split(/\n+/).map((p) => normalizeText(p)).filter(Boolean)
      : []
    const blocks: KnowledgeCanonicalBlock[] = []
    let order = 0
    for (const p of paras.length ? paras : (chunk ? [chunk] : [])) {
      order += 1
      blocks.push({
        block_id: `p${idx + 1}-${order}`,
        block_type: 'paragraph',
        role: 'body',
        order,
        content: { text: p },
        source_anchor: { anchor_type: 'pdf_page', page: idx + 1, paragraph: order },
      })
    }
    return {
      surface_id: `page-${idx + 1}`,
      surface_type: 'page' as const,
      index: idx + 1,
      blocks,
    }
  })
}

function plainTextToFlowSurface(text: string): KnowledgeCanonicalSurface[] {
  const t = normalizeText(text)
  const paras = t ? t.split(/\n{2,}/) : []
  const blocks: KnowledgeCanonicalBlock[] = []
  let order = 0
  for (const p of paras.length ? paras : (t ? [t] : [])) {
    order += 1
    blocks.push({
      block_id: `b-${order}`,
      block_type: 'paragraph',
      order,
      content: { text: normalizeText(p) },
    })
  }
  return [{
    surface_id: 'page-1',
    surface_type: 'page',
    index: 1,
    blocks,
  }]
}

function imageToSurfaces(originalName: string): KnowledgeCanonicalSurface[] {
  return [{
    surface_id: 'canvas-1',
    surface_type: 'canvas',
    index: 1,
    size: { width: 1920, height: 1080 },
    blocks: [{
      block_id: 'img-1',
      block_type: 'image',
      role: 'full_canvas',
      order: 1,
      layout: { bbox: { x: 0, y: 0, w: 1920, h: 1080 }, z_index: 1 },
      content: { asset_id: PRIMARY_ASSET_ID, text: originalName },
      regions: [
        {
          region_id: 'r-full',
          region_type: 'subject',
          bbox: { x: 0, y: 0, w: 1920, h: 1080 },
          caption: '整图区域（尺寸为占位，实际以源文件为准）',
        },
      ],
    }],
  }]
}

export interface BuildKnowledgeCanonicalInput {
  documentId: string
  title: string
  originalName: string
  /** 磁盘上用于解析的路径（DOC 可能已是转换后的临时 docx） */
  parseFilePath: string
  /** 用户原始扩展名，如 .pptx */
  format: string
  sourceKind: 'pdf' | 'docx' | 'doc' | 'txt' | 'md' | 'image' | 'pptx' | 'ppt'
  /** PDF 等已由调用方抽取的纯文本（勿对二进制 PDF 路径直接读 UTF-8） */
  preExtractedText?: string
  /** pptx 内嵌图解压目录（绝对路径，通常为 documents/<id>/ppt-assets） */
  pptxMediaOutDir?: string
  /** docx 内嵌图解压目录（绝对路径，通常为 documents/<id>/word-assets） */
  docxMediaOutDir?: string
}

export async function buildKnowledgeCanonicalDocument(input: BuildKnowledgeCanonicalInput): Promise<KnowledgeCanonicalDocument> {
  const { documentId, title, originalName, parseFilePath, format, sourceKind, preExtractedText, pptxMediaOutDir, docxMediaOutDir } = input
  const createdAt = nowIso()

  if (sourceKind === 'ppt') {
    throw new Error('暂不支持旧版 .ppt，请在 PowerPoint 中另存为 .pptx 后再导入')
  }

  let docType: KnowledgeCanonicalDocument['doc_type'] = 'text'
  let surfaces: KnowledgeCanonicalSurface[] = []
  let presentAs: KnowledgeCanonicalPresentAs = 'word'

  if (sourceKind === 'pptx') {
    docType = 'presentation'
    presentAs = 'ppt'
    surfaces = await parsePptxToSurfaces(parseFilePath, { mediaOutDir: pptxMediaOutDir })
  } else if (sourceKind === 'pdf') {
    docType = 'pdf_doc'
    presentAs = 'pdf'
    const raw = normalizeText(preExtractedText ?? '')
    surfaces = pdfPlainTextToSurfaces(raw)
    if (surfaces.length === 0) {
      surfaces = plainTextToFlowSurface(raw)
    }
  } else if (sourceKind === 'image') {
    docType = 'image_doc'
    surfaces = imageToSurfaces(originalName)
  } else if (sourceKind === 'docx' || sourceKind === 'doc') {
    docType = 'text'
    surfaces = await parseDocxToSurfaces(parseFilePath, { mediaOutDir: docxMediaOutDir })
    if (surfaces.every((s) => s.blocks.length === 0)) {
      const fallback = normalizeText((await mammoth.extractRawText({ path: parseFilePath })).value || '')
      surfaces = plainTextToFlowSurface(fallback)
    }
  } else {
    docType = 'text'
    const raw = normalizeText(await fs.readFile(parseFilePath, 'utf-8'))
    surfaces = plainTextToFlowSurface(raw)
  }

  const semantics = heuristicSemantics(surfaces, docType)

  return {
    schema_version: KNOWLEDGE_CANONICAL_SCHEMA_VERSION,
    document_id: documentId,
    doc_type: docType,
    present_as: presentAs,
    title,
    source_assets: [{
      asset_id: PRIMARY_ASSET_ID,
      format: format.replace(/^\./, ''),
      original_name: originalName,
    }],
    metadata: {
      created_at: createdAt,
      status: 'active',
      language: 'zh-CN',
    },
    semantics,
    surfaces,
  }
}
