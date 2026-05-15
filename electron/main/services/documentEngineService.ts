import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import katex from 'katex'
import { XMLParser } from 'fast-xml-parser'
import { getPaperTemplate, type PaperTemplateId } from '../../../src/utils/paperTemplates'
import { extractCitationNumbers, formatCitationNumbers, parseLeadingCitationNumber, stripLeadingCitationPrefix } from '../../../src/utils/citationGroups'
import { completeText } from './llmClient'
import type { AppSettings } from './settingsStore'

/**
 * Module-level LLM settings provider — injected by the caller (index.ts) after startup.
 * Allows documentEngineService to call the LLM without making AppSettings a constructor param.
 */
let _llmSettingsProvider: (() => Promise<AppSettings>) | null = null
export function setDocumentEngineLlmProvider(provider: () => Promise<AppSettings>): void {
  _llmSettingsProvider = provider
}

/**
 * LRU-style in-memory cache for LLM-enhanced OMML→LaTeX results.
 * Key: SHA-256 of the raw OMML XML.  Value: improved LaTeX string.
 * Capped at 200 entries to avoid unbounded memory growth.
 */
const llmFormulaCache = new Map<string, string>()
const LLM_FORMULA_CACHE_MAX = 200

export type OoxmlBlockKind = 'heading' | 'paragraph' | 'image-placeholder' | 'formula-placeholder' | 'table-placeholder' | 'page-break' | 'section-break'

export interface OoxmlParagraphSnapshot {
  index: number
  text: string
}

export interface OoxmlInlineRunSnapshot {
  text: string
  style?: string
  /** LaTeX for inline math runs extracted from OMML; triggers formula span rendering */
  formulaLatex?: string
}

export interface OoxmlBlockSnapshot {
  index: number
  kind: OoxmlBlockKind
  text: string
  level?: number
  paragraphStyle?: string
  paperStyle?: string
  inlineRuns?: OoxmlInlineRunSnapshot[]
  pageTemplateId?: PaperTemplateId
  sectionType?: 'nextPage' | 'continuous' | 'evenPage' | 'oddPage'
  sectionPropertiesXml?: string
  sectionBreakXml?: string
  hasManualPageBreak?: boolean
  alignment?: 'left' | 'center' | 'right' | 'justify'
  indentLevel?: number
  listType?: 'bullet' | 'number'
  listLevel?: number
  rows?: number
  columns?: number
  cells?: string[][]
  tableRows?: OoxmlTableCellSnapshot[][]
  alt?: string
  title?: string
  latex?: string
  mathml?: string
  formulaDisplay?: 'inline' | 'block'
  relationshipId?: string
  mediaPath?: string
  mediaContentType?: string
  previewSrc?: string
  drawingLayout?: 'inline' | 'anchor'
  imageWidthEmu?: number
  imageHeightEmu?: number
  imageWidthPx?: number
  imageHeightPx?: number
  anchorHorizontal?: string
  anchorVertical?: string
  wrapType?: string
  imageCropRect?: { l: number; t: number; r: number; b: number }
  sourceId?: string
  sourceXml?: string
  disableSourceSkeletonRewrite?: boolean
  fieldInstructions?: string[]
  citationSourceTags?: string[]
}

export interface OoxmlBibliographySourceSnapshot {
  tag: string
  title: string
  rawCitation: string
  sourceType: string
  guid: string
  year?: string
  author?: string
}

export interface OoxmlTableParagraphSnapshot {
  text: string
  style?: string
  level?: number
  sourceXml?: string
}

export interface OoxmlTableCellSnapshot {
  text: string
  paragraphs?: OoxmlTableParagraphSnapshot[]
  colspan?: number
  rowspan?: number
  header?: boolean
  width?: string
  column?: number
}

export type OoxmlReadStatus = 'ok' | 'missing-file' | 'parse-failed' | 'missing-document-xml' | 'empty-document'

export interface OoxmlReadDiagnostic {
  code: OoxmlReadStatus
  message: string
  detail?: string
}

export interface OoxmlPackageSnapshot {
  filePath: string
  status: OoxmlReadStatus
  exists: boolean
  entryCount: number
  entries: string[]
  contentTypesXml: string | null
  documentXml: string | null
  paragraphCount: number
  paragraphs: OoxmlParagraphSnapshot[]
  blockCount: number
  blocks: OoxmlBlockSnapshot[]
  bibliographySources: OoxmlBibliographySourceSnapshot[]
  plainText: string
  html: string
  renderMeta?: OoxmlRenderMetaSnapshot
  diagnostics?: OoxmlReadDiagnostic
}

export interface OoxmlRenderBodyStyleSnapshot {
  pagePadding?: string
  fontFamily?: string
  fontSize?: string
  lineHeight?: string
  textIndent?: string
  paragraphSpacing?: string
  headingAlign?: 'left' | 'center'
}

export interface OoxmlRenderShellSnapshot {
  headerText?: string
  footerText?: string
  watermarkText?: string
  hasHeader?: boolean
  hasFooter?: boolean
  hasWatermark?: boolean
}

export interface OoxmlRenderMetaSnapshot {
  paperTemplateId: PaperTemplateId
  bodyStyle?: OoxmlRenderBodyStyleSnapshot
  shell?: OoxmlRenderShellSnapshot
}

export interface OoxmlWritePayload {
  html?: string
  plainText?: string
  paragraphs?: string[]
  blocks?: OoxmlBlockSnapshot[]
  documentSectionPropertiesXml?: string
}

export interface OoxmlWriteResult {
  success: boolean
  filePath: string
  paragraphCount: number
  entryCount: number
  created: boolean
}

interface BodyElementSnapshot {
  type: 'paragraph' | 'table' | 'section'
  xml: string
}

interface DocumentTemplates {
  paragraphXml: string | null
  headingByLevel: Record<number, string | null>
  imageParagraphXml: string | null
  formulaParagraphXml: string | null
  tableXml: string | null
}

interface OoxmlRelationshipInfo {
  id: string
  target: string
  type?: string
}

interface OoxmlReadContext {
  zip: JSZip
  contentTypesXml: string | null
  relationships: Map<string, OoxmlRelationshipInfo>
  numberingFormats: Map<string, 'bullet' | 'number'>
}

interface OoxmlBibliographyPartInfo {
  itemPath: string
  itemPropsPath: string
  itemRelsPath: string
  rootRelationshipId?: string
  sources: OoxmlBibliographySourceSnapshot[]
}

interface FormulaMetadataSnapshot {
  latex: string
  plainText: string
  displayMode?: 'inline' | 'block'
}

const STRUCTURE_HEADING_LABELS = ['摘要', '关键词', '关键字', 'abstract', 'keywords']
const FORMULA_METADATA_PREFIX = '__AI_WRITER_FORMULA__'
const DEFAULT_FONT_SIZE_PX = 16
const TWIPS_PER_PX = 15

const WORD_FONT_FAMILY_MAP: Record<string, { latin: string; eastAsia?: string }> = {
  'source serif 4': { latin: 'Times New Roman', eastAsia: '宋体' },
  'noto serif sc': { latin: 'Times New Roman', eastAsia: '宋体' },
  simsun: { latin: 'Times New Roman', eastAsia: '宋体' },
  'songti sc': { latin: 'Times New Roman', eastAsia: '宋体' },
  kaiti: { latin: 'KaiTi', eastAsia: '楷体' },
  stkaiti: { latin: 'KaiTi', eastAsia: '楷体' },
  simhei: { latin: 'SimHei', eastAsia: '黑体' },
  'heiti sc': { latin: 'SimHei', eastAsia: '黑体' },
  'times new roman': { latin: 'Times New Roman', eastAsia: '宋体' },
  georgia: { latin: 'Georgia', eastAsia: '宋体' },
  arial: { latin: 'Arial', eastAsia: '宋体' },
  calibri: { latin: 'Calibri', eastAsia: '宋体' },
  'microsoft yahei': { latin: 'Arial', eastAsia: '微软雅黑' },
  '微软雅黑': { latin: 'Arial', eastAsia: '微软雅黑' },
  fangsong: { latin: 'FangSong', eastAsia: '仿宋' },
  '仿宋': { latin: 'FangSong', eastAsia: '仿宋' },
  stfangsong: { latin: 'FangSong', eastAsia: '仿宋' },
}

const STYLE_RUN_PROPERTIES: Record<string, string> = {
  /* Title = 22pt → 44 half-pt (与 EditorPanel h1 / paper-title 对齐) */
  Title: '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman"/><w:b/><w:bCs/><w:sz w:val="44"/><w:szCs w:val="44"/>',
  /* AbstractHeading = 14pt → 28 half-pt */
  AbstractHeading: '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman"/><w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/>',
  Abstract: '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman"/><w:sz w:val="22"/><w:szCs w:val="22"/>',
  /* KeywordsHeading = 12pt → 24 half-pt */
  KeywordsHeading: '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman"/><w:b/><w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/>',
  Keywords: '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman"/><w:b/><w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/>',
  /* Heading1 = 22pt → 44 half-pt */
  Heading1: '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman"/><w:b/><w:bCs/><w:sz w:val="44"/><w:szCs w:val="44"/>',
  /* Heading2 = 16pt → 32 half-pt */
  Heading2: '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman"/><w:b/><w:bCs/><w:sz w:val="32"/><w:szCs w:val="32"/>',
  /* Heading3 = 14pt → 28 half-pt */
  Heading3: '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman"/><w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/>',
}

const STYLE_DEFINITIONS: Record<string, string> = {
  Title: '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:spacing w:before="240" w:after="200"/></w:pPr><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman"/><w:b/><w:bCs/><w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr></w:style>',
  AbstractHeading: '<w:style w:type="paragraph" w:styleId="AbstractHeading"><w:name w:val="Abstract Heading"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:spacing w:before="160" w:after="80"/><w:outlineLvl w:val="9"/></w:pPr><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman"/><w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>',
  Abstract: '<w:style w:type="paragraph" w:styleId="Abstract"><w:name w:val="Abstract"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="both"/><w:spacing w:before="0" w:after="120" w:line="360" w:lineRule="auto"/><w:ind w:firstLine="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>',
  KeywordsHeading: '<w:style w:type="paragraph" w:styleId="KeywordsHeading"><w:name w:val="Keywords Heading"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="left"/><w:spacing w:before="80" w:after="40"/><w:outlineLvl w:val="9"/></w:pPr><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman"/><w:b/><w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>',
  Keywords: '<w:style w:type="paragraph" w:styleId="Keywords"><w:name w:val="Keywords"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="left"/><w:spacing w:before="0" w:after="120" w:line="360" w:lineRule="auto"/><w:ind w:firstLine="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman"/><w:b/><w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>',
  Heading1: '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman"/><w:b/><w:bCs/><w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr></w:style>',
  Heading2: '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="1"/><w:spacing w:before="180" w:after="100"/></w:pPr><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman"/><w:b/><w:bCs/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>',
  Heading3: '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="2"/><w:spacing w:before="120" w:after="80"/></w:pPr><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman"/><w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>',
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: '#text',
  parseTagValue: false,
  trimValues: false,
})

// Dedicated parser for OMML — always returns arrays so repeated sibling elements
// (e.g. multiple <m:r> runs at the same level) are preserved correctly.
const ommlXmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: '#text',
  parseTagValue: false,
  trimValues: false,
  isArray: () => true,
})

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(
    String(value || '')
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\r/g, '')
  ).replace(/\u00a0/g, ' ')
}

function getAttr(source: string, name: string): string | null {
  const doubleQuoted = source.match(new RegExp(`${name}="([^"]*)"`, 'i'))?.[1]
  if (doubleQuoted != null) return decodeHtmlEntities(doubleQuoted)
  const singleQuoted = source.match(new RegExp(`${name}='([^']*)'`, 'i'))?.[1]
  if (singleQuoted != null) return decodeHtmlEntities(singleQuoted)
  return null
}

function encodeStructuredData(value: unknown): string {
  // Use base64 so that OOXML fragments (containing <, >, ") survive the HTML
  // attribute round-trip through TipTap/Chrome without Chrome's innerHTML
  // failing to re-escape bare > characters in attribute values.
  return Buffer.from(JSON.stringify(value)).toString('base64')
}

function decodeStructuredData<T>(source: string | null): T | null {
  if (!source) return null
  // New format: base64-encoded JSON
  try {
    const decoded = Buffer.from(source, 'base64').toString('utf-8')
    return JSON.parse(decoded) as T
  } catch { /* fall through */ }
  // Legacy format: HTML-entity-escaped JSON (pre-base64)
  try {
    return JSON.parse(decodeHtmlEntities(source)) as T
  } catch {
    return null
  }
}

function decodeBase64ToUtf8(value: string): string {
  try {
    return Buffer.from(value, 'base64').toString('utf-8')
  } catch {
    return ''
  }
}

function encodeUtf8ToBase64(value: string): string {
  try {
    return Buffer.from(value, 'utf-8').toString('base64')
  } catch {
    return ''
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parseCssStyleMap(style: string | null | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  for (const chunk of String(style || '').split(';')) {
    const separatorIndex = chunk.indexOf(':')
    if (separatorIndex < 0) continue
    const key = chunk.slice(0, separatorIndex).trim().toLowerCase()
    const value = chunk.slice(separatorIndex + 1).trim()
    if (key && value) result[key] = value
  }
  return result
}

function stringifyCssStyleMap(styleMap: Record<string, string | null | undefined>): string | undefined {
  const entries = Object.entries(styleMap).filter(([, value]) => String(value || '').trim())
  if (!entries.length) return undefined
  return entries.map(([key, value]) => `${key}: ${String(value).trim()}`).join('; ')
}

function mergeCssStyles(...styleStrings: Array<string | null | undefined>): string | undefined {
  const merged: Record<string, string> = {}
  for (const styleString of styleStrings) {
    Object.assign(merged, parseCssStyleMap(styleString))
  }
  return stringifyCssStyleMap(merged)
}

function getLastRegexMatch(source: string, pattern: RegExp): string | undefined {
  let result: string | undefined
  for (const match of String(source || '').matchAll(pattern)) {
    const value = String(match[1] || '').trim()
    if (value) result = value
  }
  return result
}

function extractDocumentSectionPropertiesXml(documentXml: string | null): string | undefined {
  return getLastRegexMatch(String(documentXml || ''), /(<w:sectPr\b[\s\S]*?<\/w:sectPr>)/gi)
}

function twipsToPxString(value: string | number | null | undefined): string | undefined {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined
  return `${Math.round(numeric / TWIPS_PER_PX)}px`
}

function extractStyleBlockXml(stylesXml: string | null, styleId: string): string | undefined {
  if (!stylesXml || !styleId) return undefined
  return stylesXml.match(new RegExp(`<w:style\\b[^>]*w:styleId="${escapeRegExp(styleId)}"[\\s\\S]*?<\\/w:style>`, 'i'))?.[0]
}

function extractDocumentDefaultsStyleXml(stylesXml: string | null): string[] {
  if (!stylesXml) return []
  const docDefaultsXml = stylesXml.match(/<w:docDefaults\b[\s\S]*?<\/w:docDefaults>/i)?.[0]
  if (!docDefaultsXml) return []
  const paragraphDefaults = docDefaultsXml.match(/<w:pPrDefault\b[\s\S]*?<w:pPr\b[\s\S]*?<\/w:pPr>[\s\S]*?<\/w:pPrDefault>/i)?.[0] || ''
  const runDefaults = docDefaultsXml.match(/<w:rPrDefault\b[\s\S]*?<w:rPr\b[\s\S]*?<\/w:rPr>[\s\S]*?<\/w:rPrDefault>/i)?.[0] || ''
  return [paragraphDefaults, runDefaults].filter(Boolean)
}

function resolveStyleInheritanceXml(stylesXml: string | null, styleId: string): string[] {
  const resolved: string[] = [...extractDocumentDefaultsStyleXml(stylesXml)]
  if (!stylesXml || !styleId) return resolved

  const visited = new Set<string>()
  const chain: string[] = []
  let currentStyleId: string | undefined = styleId
  let depth = 0
  while (currentStyleId && !visited.has(currentStyleId) && depth < 12) {
    visited.add(currentStyleId)
    const styleXml = extractStyleBlockXml(stylesXml, currentStyleId)
    if (!styleXml) break
    chain.unshift(styleXml)
    currentStyleId = styleXml.match(/<w:basedOn\b[^>]*w:val="([^"]+)"/i)?.[1]
    depth += 1
  }

  return [...resolved, ...chain]
}

function buildPaperStyleFromStyleSources(styleSources: string[]): string | undefined {
  const combined = styleSources.filter(Boolean).join('\n')
  if (!combined.trim()) return undefined

  const styleMap: Record<string, string | undefined> = {}
  const alignment = normalizeCssAlignment(getLastRegexMatch(combined, /<w:jc\b[^>]*w:val="([^"]+)"/gi))
  if (alignment) styleMap['text-align'] = alignment

  const firstLineTwips = getLastRegexMatch(combined, /<w:ind\b[^>]*w:firstLine="(\d+)"/gi)
  if (firstLineTwips) styleMap['text-indent'] = twipsToPxString(firstLineTwips)

  const spacingBefore = getLastRegexMatch(combined, /<w:spacing\b[^>]*w:before="(\d+)"/gi)
  if (spacingBefore) styleMap['margin-top'] = twipsToPxString(spacingBefore)
  const spacingAfter = getLastRegexMatch(combined, /<w:spacing\b[^>]*w:after="(\d+)"/gi)
  if (spacingAfter) styleMap['margin-bottom'] = twipsToPxString(spacingAfter)

  const line = getLastRegexMatch(combined, /<w:spacing\b[^>]*w:line="(\d+)"/gi)
  const lineRule = getLastRegexMatch(combined, /<w:spacing\b[^>]*w:lineRule="([^"]+)"/gi)?.toLowerCase()
  if (line) {
    styleMap['line-height'] = lineRule === 'auto'
      ? `${(Number(line) / 240).toFixed(2).replace(/\.00$/, '').replace(/0$/, '')}`
      : twipsToPxString(line)
  }

  const fontConfig = normalizeWordFontConfig([
    getLastRegexMatch(combined, /<w:rFonts\b[^>]*w:ascii="([^"]+)"/gi) || '',
    getLastRegexMatch(combined, /<w:rFonts\b[^>]*w:eastAsia="([^"]+)"/gi) || '',
  ].filter(Boolean).join(', '))
  if (fontConfig) {
    styleMap['font-family'] = `${fontConfig.latin}, ${fontConfig.eastAsia}`
  }

  const fontSize = getLastRegexMatch(combined, /<w:sz\b[^>]*w:val="(\d+)"/gi)
  if (fontSize) {
    styleMap['font-size'] = `${(Number(fontSize) / 1.5).toFixed(2).replace(/\.00$/, '').replace(/0$/, '')}px`
  }

  return stringifyCssStyleMap(styleMap)
}

function buildRenderBodyStyleSnapshot(
  stylesXml: string | null,
  documentXml: string | null,
  blocks: OoxmlBlockSnapshot[],
): OoxmlRenderBodyStyleSnapshot | undefined {
  const defaultBodyPaperStyle = buildPaperStyleFromStyleSources(resolveStyleInheritanceXml(stylesXml, 'Normal'))
  const firstParagraphPaperStyle = blocks.find((block) => block.kind === 'paragraph' && block.paperStyle)?.paperStyle
  const mergedBodyStyle = parseCssStyleMap(mergeCssStyles(defaultBodyPaperStyle, firstParagraphPaperStyle))
  const headingPaperStyle = parseCssStyleMap(buildPaperStyleFromStyleSources(resolveStyleInheritanceXml(stylesXml, 'Heading1')))
  const sectionXml = extractDocumentSectionPropertiesXml(documentXml)
  const pageMarginsXml = sectionXml?.match(/<w:pgMar\b([^>]*)\/>/i)?.[1] || ''

  const snapshot: OoxmlRenderBodyStyleSnapshot = {
    pagePadding: pageMarginsXml
      ? [
          twipsToPxString(pageMarginsXml.match(/w:top="(\d+)"/i)?.[1]) || '48px',
          twipsToPxString(pageMarginsXml.match(/w:right="(\d+)"/i)?.[1]) || '72px',
          twipsToPxString(pageMarginsXml.match(/w:bottom="(\d+)"/i)?.[1]) || '72px',
          twipsToPxString(pageMarginsXml.match(/w:left="(\d+)"/i)?.[1]) || '72px',
        ].join(' ')
      : undefined,
    fontFamily: mergedBodyStyle['font-family'],
    fontSize: mergedBodyStyle['font-size'],
    lineHeight: mergedBodyStyle['line-height'],
    textIndent: mergedBodyStyle['text-indent'],
    paragraphSpacing: mergedBodyStyle['margin-bottom'] || mergedBodyStyle['margin-top'],
    headingAlign: normalizeCssAlignment(headingPaperStyle['text-align']) === 'center' ? 'center' : undefined,
  }

  return Object.values(snapshot).some(Boolean) ? snapshot : undefined
}

function extractPartPreviewLines(sourceXml: string): string[] {
  return Array.from(String(sourceXml || '').matchAll(/<w:p\b[\s\S]*?<\/w:p>/g))
    .map((match) => extractTextFromParagraphXml(match[0]).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function extractPartFieldInstructions(sourceXml: string): string[] {
  return Array.from(String(sourceXml || '').matchAll(/<w:p\b[\s\S]*?<\/w:p>/g))
    .flatMap((match) => extractWordFieldInstructions(match[0]))
    .map((instruction) => normalizeWordFieldInstruction(instruction))
    .filter(Boolean)
}

function buildHeaderFooterPreviewText(sourceXml: string, partType: 'header' | 'footer'): string | undefined {
  const uniqueLines = Array.from(new Set(extractPartPreviewLines(sourceXml)))
  if (uniqueLines.length) return uniqueLines.join('\n')

  const instructions = extractPartFieldInstructions(sourceXml)
  if (partType === 'footer' && instructions.some((instruction) => /\bPAGE\b/i.test(instruction))) {
    return instructions.some((instruction) => /\bNUMPAGES\b/i.test(instruction)) ? '第 1 页 / 共 N 页' : '第 1 页'
  }

  return undefined
}

function extractWatermarkPreview(sourceXml: string): { text?: string; hasWatermark: boolean } {
  const textMatches = Array.from(String(sourceXml || '').matchAll(/<v:textpath\b[^>]*string="([^"]+)"/gi))
    .map((match) => decodeXmlEntities(match[1]).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  if (textMatches.length) {
    return { text: Array.from(new Set(textMatches)).join(' / '), hasWatermark: true }
  }
  const hasWatermark = /PowerPlusWaterMarkObject|WaterMarkObject|<v:shape\b[^>]*(?:id="[^"]*WaterMark|style="[^"]*rotation:)/i.test(String(sourceXml || ''))
  return hasWatermark ? { text: '水印', hasWatermark: true } : { hasWatermark: false }
}

function pickSectionRelationshipId(sectionXml: string | undefined, relationshipType: 'header' | 'footer'): string[] {
  if (!sectionXml) return []
  const matches = Array.from(sectionXml.matchAll(new RegExp(`<w:${relationshipType}Reference\\b[^>]*w:type="([^"]+)"[^>]*r:id="([^"]+)"`, 'gi')))
  const grouped = new Map<string, string>()
  matches.forEach((match) => {
    const refType = String(match[1] || '').trim().toLowerCase() || 'default'
    const relationshipId = String(match[2] || '').trim()
    if (relationshipId && !grouped.has(refType)) grouped.set(refType, relationshipId)
  })
  return ['first', 'default', 'even'].map((type) => grouped.get(type) || '').filter(Boolean)
}

async function buildRenderShellSnapshot(
  documentXml: string | null,
  relationships: Map<string, OoxmlRelationshipInfo>,
  zip: JSZip,
): Promise<OoxmlRenderShellSnapshot | undefined> {
  const sectionXml = extractDocumentSectionPropertiesXml(documentXml)
  const headerIds = pickSectionRelationshipId(sectionXml, 'header')
  const footerIds = pickSectionRelationshipId(sectionXml, 'footer')

  const readPartXml = async (relationshipId: string): Promise<string | undefined> => {
    const relationship = relationships.get(relationshipId)
    if (!relationship?.target) return undefined
    const targetPath = resolveRelationshipTarget(relationship.target)
    return zip.file(targetPath)?.async('text') || undefined
  }

  const headerParts = (await Promise.all(headerIds.map((relationshipId) => readPartXml(relationshipId)))).filter(Boolean) as string[]
  const footerParts = (await Promise.all(footerIds.map((relationshipId) => readPartXml(relationshipId)))).filter(Boolean) as string[]

  let headerText: string | undefined
  let footerText: string | undefined
  let watermarkText: string | undefined
  let hasWatermark = false

  for (const headerPart of headerParts) {
    const watermark = extractWatermarkPreview(headerPart)
    if (!watermarkText && watermark.text) watermarkText = watermark.text
    hasWatermark = hasWatermark || watermark.hasWatermark
    if (!headerText) headerText = buildHeaderFooterPreviewText(headerPart, 'header')
  }

  for (const footerPart of footerParts) {
    if (!footerText) footerText = buildHeaderFooterPreviewText(footerPart, 'footer')
  }

  const snapshot: OoxmlRenderShellSnapshot = {
    headerText,
    footerText,
    watermarkText,
    hasHeader: headerParts.length > 0,
    hasFooter: footerParts.length > 0,
    hasWatermark,
  }

  return Object.values(snapshot).some(Boolean) ? snapshot : undefined
}

function inferPaperTemplateIdFromRenderBodyStyle(bodyStyle: OoxmlRenderBodyStyleSnapshot | undefined): PaperTemplateId {
  const fontFamily = String(bodyStyle?.fontFamily || '').toLowerCase()
  const textIndent = String(bodyStyle?.textIndent || '').trim().toLowerCase()
  const lineHeight = Number(String(bodyStyle?.lineHeight || '').replace(/[^\d.]/g, ''))

  if (fontFamily.includes('times new roman') && !/(宋体|楷体|黑体|仿宋|simsun|simhei|kaiti|fangsong|noto serif sc)/i.test(fontFamily) && (!textIndent || textIndent === '0' || textIndent === '0px')) {
    return 'academic-en'
  }
  if (Number.isFinite(lineHeight) && lineHeight >= 1.95) {
    return 'thesis'
  }
  if ((!textIndent || textIndent === '0' || textIndent === '0px') && Number.isFinite(lineHeight) && lineHeight <= 1.7) {
    return 'compact'
  }
  return 'academic-cn'
}

async function buildRenderMetaSnapshot(
  stylesXml: string | null,
  documentXml: string | null,
  relationships: Map<string, OoxmlRelationshipInfo>,
  zip: JSZip,
  blocks: OoxmlBlockSnapshot[],
): Promise<OoxmlRenderMetaSnapshot> {
  const bodyStyle = buildRenderBodyStyleSnapshot(stylesXml, documentXml, blocks)
  const shell = await buildRenderShellSnapshot(documentXml, relationships, zip)
  return {
    paperTemplateId: inferPaperTemplateIdFromRenderBodyStyle(bodyStyle),
    bodyStyle,
    shell,
  }
}

function wrapBlocksHtmlWithRenderMeta(html: string, renderMeta: OoxmlRenderMetaSnapshot): string {
  return `<div data-ai-writer-doc-envelope="true" data-paper-template="${escapeHtmlText(renderMeta.paperTemplateId)}" data-ai-writer-doc-meta="${encodeStructuredData(renderMeta)}">${html}</div>`
}

function stripCssQuotes(value: string): string {
  return String(value || '').trim().replace(/^['"]|['"]$/g, '')
}

function parseCssLength(value: string | null | undefined): { amount: number; unit: string } | null {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return null
  if (/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    return { amount: Number(normalized), unit: 'number' }
  }
  const match = normalized.match(/^(-?\d+(?:\.\d+)?)(px|pt|em|rem|%)$/)
  if (!match) return null
  return { amount: Number(match[1]), unit: match[2] }
}

function resolveCssLengthPx(value: string | null | undefined, baseFontSizePx = DEFAULT_FONT_SIZE_PX): number | undefined {
  const parsed = parseCssLength(value)
  if (!parsed) return undefined
  if (parsed.unit === 'px') return parsed.amount
  if (parsed.unit === 'pt') return parsed.amount / 0.75
  if (parsed.unit === 'em' || parsed.unit === 'rem') return parsed.amount * baseFontSizePx
  if (parsed.unit === '%') return (parsed.amount / 100) * baseFontSizePx
  if (parsed.unit === 'number') return parsed.amount
  return undefined
}

function resolveCssLengthTwips(value: string | null | undefined, baseFontSizePx = DEFAULT_FONT_SIZE_PX): number | undefined {
  const pixels = resolveCssLengthPx(value, baseFontSizePx)
  if (typeof pixels !== 'number' || !Number.isFinite(pixels)) return undefined
  return Math.max(0, Math.round(pixels * TWIPS_PER_PX))
}

function resolveCssFontSizeHalfPoints(value: string | null | undefined, baseFontSizePx = DEFAULT_FONT_SIZE_PX): number | undefined {
  const pixels = resolveCssLengthPx(value, baseFontSizePx)
  if (typeof pixels !== 'number' || !Number.isFinite(pixels)) return undefined
  return Math.max(2, Math.round(pixels * 1.5))
}

function resolveCssLineHeightSpec(value: string | null | undefined, fontSizePx = DEFAULT_FONT_SIZE_PX): { line: number; lineRule: 'auto' | 'exact' | 'atLeast' } | null {
  const parsed = parseCssLength(value)
  if (!parsed) return null
  if (parsed.unit === 'number') {
    return { line: Math.max(1, Math.round(parsed.amount * 240)), lineRule: 'auto' }
  }
  if (parsed.unit === '%') {
    return { line: Math.max(1, Math.round((parsed.amount / 100) * 240)), lineRule: 'auto' }
  }
  if (parsed.unit === 'em' || parsed.unit === 'rem') {
    return { line: Math.max(1, Math.round(parsed.amount * 240)), lineRule: 'auto' }
  }
  const twips = resolveCssLengthTwips(value, fontSizePx)
  if (!twips) return null
  return { line: twips, lineRule: 'exact' }
}

function normalizeWordFontConfig(value: string | null | undefined): { latin: string; eastAsia: string; cs: string } | null {
  const fontCandidates = String(value || '')
    .split(',')
    .map((item) => stripCssQuotes(item))
    .map((item) => item.trim())
    .filter(Boolean)
  if (!fontCandidates.length) return null

  let latin = 'Times New Roman'
  let eastAsia = '宋体'

  for (const candidate of fontCandidates) {
    const mapped = WORD_FONT_FAMILY_MAP[candidate.toLowerCase()]
    if (!mapped) continue
    latin = mapped.latin || latin
    eastAsia = mapped.eastAsia || eastAsia
    break
  }

  const eastAsiaCandidate = fontCandidates.find((candidate) => /[ -\u007f]/.test(candidate) === false || /(song|simsun|kai|hei|fang|noto serif sc)/i.test(candidate))
  if (eastAsiaCandidate) {
    eastAsia = WORD_FONT_FAMILY_MAP[eastAsiaCandidate.toLowerCase()]?.eastAsia || eastAsiaCandidate
  }

  const latinCandidate = fontCandidates.find((candidate) => /[a-z]/i.test(candidate))
  if (latinCandidate) {
    latin = WORD_FONT_FAMILY_MAP[latinCandidate.toLowerCase()]?.latin || latinCandidate
  }

  return { latin, eastAsia, cs: latin }
}

function buildRunFontsXml(value: string | null | undefined): string | null {
  const config = normalizeWordFontConfig(value)
  if (!config) return null
  return `<w:rFonts w:ascii="${escapeXmlText(config.latin)}" w:hAnsi="${escapeXmlText(config.latin)}" w:eastAsia="${escapeXmlText(config.eastAsia)}" w:cs="${escapeXmlText(config.cs)}"/>`
}

function extractPaperTemplateIdFromHtml(source: string): PaperTemplateId | undefined {
  const templateId = getAttr(source, 'data-paper-template')
  if (templateId === 'academic-cn' || templateId === 'academic-en' || templateId === 'thesis' || templateId === 'compact') {
    return templateId
  }
  return undefined
}

function buildTemplateBlockStyle(templateId: PaperTemplateId | undefined, kind: 'paragraph' | 'heading', level?: number, semanticRole?: string | null): string | undefined {
  if (!templateId) return undefined
  const template = getPaperTemplate(templateId)
  const base: Record<string, string> = {
    'font-family': template.fontFamily,
    'font-size': `${template.fontSizePt}pt`,
    'line-height': String(template.lineSpacingMultiple),
  }

  if (kind === 'heading') {
    if (semanticRole === 'paper-title') {
      return stringifyCssStyleMap({ ...base, 'font-size': '22pt', 'line-height': '1.4', 'text-align': 'center', 'margin-top': templateId === 'academic-en' ? '72px' : '48px', 'margin-bottom': '12px' })
    }
    if (semanticRole === 'abstract-heading') {
      return stringifyCssStyleMap({ ...base, 'font-size': '14pt', 'text-align': 'center', 'margin-top': '28px', 'margin-bottom': '8px' })
    }
    if (semanticRole === 'keywords-heading') {
      return stringifyCssStyleMap({ ...base, 'font-size': '12pt', 'text-align': 'left', 'margin-top': '12px', 'margin-bottom': '8px' })
    }
    if (semanticRole === 'section-heading' || semanticRole === 'references-heading' || level === 2) {
      return stringifyCssStyleMap({ ...base, 'font-size': '16pt', 'margin-top': '24px', 'margin-bottom': '12px', 'text-align': template.headingAlign })
    }
    if (level === 1) {
      return stringifyCssStyleMap({ ...base, 'font-size': '22pt', 'margin-top': '36px', 'margin-bottom': '20px', 'text-align': 'center', 'line-height': '1.4' })
    }
    if (level === 3) {
      return stringifyCssStyleMap({ ...base, 'font-size': '14pt', 'margin-top': '18px', 'margin-bottom': '8px' })
    }
    if (level === 4) {
      return stringifyCssStyleMap({ ...base, 'font-size': '12pt', 'margin-top': '14px', 'margin-bottom': '6px' })
    }
    return stringifyCssStyleMap(base)
  }

  if (semanticRole === 'abstract-body') {
    return stringifyCssStyleMap({ ...base, 'font-size': `${Math.max(9, template.fontSizePt - 1)}pt`, 'line-height': '1.75', 'text-indent': '0', 'margin-bottom': '4px', 'text-align': 'justify' })
  }
  if (semanticRole === 'keywords-body') {
    return stringifyCssStyleMap({ ...base, 'font-size': `${Math.max(9, template.fontSizePt - 1)}pt`, 'line-height': '1.75', 'text-indent': '0', 'margin-bottom': '8px', 'text-align': 'left' })
  }
  if (semanticRole === 'reference-item') {
    return stringifyCssStyleMap({ ...base, 'line-height': '1.8', 'text-indent': '0' })
  }

  return stringifyCssStyleMap({
    ...base,
    'text-indent': template.textIndent,
    'margin-top': template.paragraphSpacing,
    'margin-bottom': template.paragraphSpacing,
    'text-align': 'justify',
  })
}

function extractDominantInlineTextStyle(source: string): string | undefined {
  const inlineStyleMatches = Array.from(String(source || '').matchAll(/style=(?:"([^"]*)"|'([^']*)')/gi))
  const fontFamilies = new Set<string>()
  const fontSizes = new Set<string>()
  for (const match of inlineStyleMatches) {
    const styleMap = parseCssStyleMap(match[1] || match[2] || '')
    if (styleMap['font-family']) fontFamilies.add(styleMap['font-family'])
    if (styleMap['font-size']) fontSizes.add(styleMap['font-size'])
  }
  return stringifyCssStyleMap({
    'font-family': fontFamilies.size === 1 ? Array.from(fontFamilies)[0] : undefined,
    'font-size': fontSizes.size === 1 ? Array.from(fontSizes)[0] : undefined,
  })
}

function extractParagraphStyleId(paragraphXml: string): string | undefined {
  const style = paragraphXml.match(/<w:pStyle\b[^>]*w:val="([^"]+)"/i)?.[1]
  return style || undefined
}

function extractParagraphAlignment(paragraphXml: string): 'left' | 'center' | 'right' | 'justify' | undefined {
  const value = paragraphXml.match(/<w:jc\b[^>]*w:val="([^"]+)"/i)?.[1]?.toLowerCase()
  if (!value) return undefined
  if (value === 'center') return 'center'
  if (value === 'right' || value === 'end') return 'right'
  if (value === 'both' || value === 'distribute' || value === 'justify') return 'justify'
  return 'left'
}

function extractParagraphIndentLevel(paragraphXml: string): number | undefined {
  const left = Number(paragraphXml.match(/<w:ind\b[^>]*w:left="(\d+)"/i)?.[1] || 0)
  if (!left) return undefined
  return Math.max(0, Math.round(left / 360))
}

function parseNumberingFormats(numberingXml: string | null): Map<string, 'bullet' | 'number'> {
  const formats = new Map<string, 'bullet' | 'number'>()
  if (!numberingXml) return formats

  const abstractFormats = new Map<string, 'bullet' | 'number'>()
  for (const match of numberingXml.matchAll(/<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[\s\S]*?<w:numFmt\b[^>]*w:val="([^"]+)"[\s\S]*?<\/w:abstractNum>/gi)) {
    const abstractNumId = match[1]
    const formatValue = String(match[2] || '').toLowerCase()
    abstractFormats.set(abstractNumId, formatValue === 'bullet' ? 'bullet' : 'number')
  }
  for (const match of numberingXml.matchAll(/<w:num\b[^>]*w:numId="(\d+)"[\s\S]*?<w:abstractNumId\b[^>]*w:val="(\d+)"/gi)) {
    const numId = match[1]
    const abstractNumId = match[2]
    formats.set(numId, abstractFormats.get(abstractNumId) || 'number')
  }
  return formats
}

function extractParagraphListInfo(paragraphXml: string, numberingFormats: Map<string, 'bullet' | 'number'>): { listType?: 'bullet' | 'number'; listLevel?: number } {
  const numId = paragraphXml.match(/<w:numId\b[^>]*w:val="(\d+)"/i)?.[1]
  if (!numId) return {}
  const listLevel = Number(paragraphXml.match(/<w:ilvl\b[^>]*w:val="(\d+)"/i)?.[1] || 0)
  return {
    listType: numberingFormats.get(numId) || 'number',
    listLevel: listLevel || 0,
  }
}

function normalizeParagraphStyleForBlock(styleId: string | undefined, headingLevel: number | null): string | undefined {
  if (headingLevel) return `Heading${headingLevel}`
  return styleId || undefined
}

function normalizeKnownStyleId(styleId: string | undefined): string | undefined {
  if (!styleId) return undefined
  const normalized = String(styleId).trim()
  if (/^title$/i.test(normalized)) return 'Title'
  if (/^abstractheading$/i.test(normalized)) return 'AbstractHeading'
  if (/^abstract$/i.test(normalized)) return 'Abstract'
  if (/^keywordsheading$/i.test(normalized)) return 'KeywordsHeading'
  if (/^keywords$/i.test(normalized)) return 'Keywords'
  if (/^heading([1-3])$/i.test(normalized)) return `Heading${RegExp.$1}`
  return normalized
}

function inferSemanticRoleFromBlock(block: OoxmlBlockSnapshot): string | undefined {
  const normalizedStyle = normalizeKnownStyleId(block.paragraphStyle)
  if (normalizedStyle === 'Title') return 'paper-title'
  if (normalizedStyle === 'AbstractHeading') return 'abstract-heading'
  if (normalizedStyle === 'Abstract') return 'abstract-body'
  if (normalizedStyle === 'KeywordsHeading') return 'keywords-heading'
  if (normalizedStyle === 'Keywords') return 'keywords-body'
  if (normalizedStyle === 'ReferencesHeading') return 'references-heading'
  if (normalizedStyle === 'Reference') return 'reference-item'
  if (block.kind === 'heading' && block.level === 2) return 'section-heading'
  return undefined
}

function extractParagraphPaperStyle(paragraphXml: string): string | undefined {
  const styleMap: Record<string, string | undefined> = {}
  const alignment = extractParagraphAlignment(paragraphXml)
  if (alignment) styleMap['text-align'] = alignment
  if (/<w:pageBreakBefore\b/i.test(paragraphXml)) {
    styleMap['break-before'] = 'page'
  }

  const firstLineTwips = paragraphXml.match(/<w:ind\b[^>]*w:firstLine="(\d+)"/i)?.[1]
  if (firstLineTwips != null) {
    styleMap['text-indent'] = `${Math.round(Number(firstLineTwips) / TWIPS_PER_PX)}px`
  }

  const spacingMatch = paragraphXml.match(/<w:spacing\b([^>]*)\/>/i)?.[1] || ''
  const before = spacingMatch.match(/w:before="(\d+)"/i)?.[1]
  const after = spacingMatch.match(/w:after="(\d+)"/i)?.[1]
  const line = spacingMatch.match(/w:line="(\d+)"/i)?.[1]
  const lineRule = spacingMatch.match(/w:lineRule="([^"]+)"/i)?.[1]?.toLowerCase()
  if (before != null) styleMap['margin-top'] = `${Math.round(Number(before) / TWIPS_PER_PX)}px`
  if (after != null) styleMap['margin-bottom'] = `${Math.round(Number(after) / TWIPS_PER_PX)}px`
  if (line != null) {
    styleMap['line-height'] = lineRule === 'auto'
      ? `${(Number(line) / 240).toFixed(2).replace(/\.00$/, '').replace(/0$/, '')}`
      : `${Math.round(Number(line) / TWIPS_PER_PX)}px`
  }

  const fontConfig = normalizeWordFontConfig([
    paragraphXml.match(/<w:rFonts\b[^>]*w:ascii="([^"]+)"/i)?.[1] || '',
    paragraphXml.match(/<w:rFonts\b[^>]*w:eastAsia="([^"]+)"/i)?.[1] || '',
  ].filter(Boolean).join(', '))
  if (fontConfig) {
    styleMap['font-family'] = `${fontConfig.latin}, ${fontConfig.eastAsia}`
  }
  const fontSize = paragraphXml.match(/<w:sz\b[^>]*w:val="(\d+)"/i)?.[1]
  if (fontSize) {
    styleMap['font-size'] = `${(Number(fontSize) / 1.5).toFixed(2).replace(/\.00$/, '').replace(/0$/, '')}px`
  }

  return stringifyCssStyleMap(styleMap)
}

function extractSectionPropertiesXml(paragraphXml: string): string | undefined {
  return paragraphXml.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/i)?.[0] || undefined
}

function extractSectionType(sectionPropertiesXml: string | undefined): 'nextPage' | 'continuous' | 'evenPage' | 'oddPage' | undefined {
  const value = String(sectionPropertiesXml || '').match(/<w:type\b[^>]*w:val="([^"]+)"/i)?.[1]
  if (value === 'continuous' || value === 'evenPage' || value === 'oddPage' || value === 'nextPage') {
    return value
  }
  if (sectionPropertiesXml) return 'nextPage'
  return undefined
}

function paragraphContainsManualPageBreak(paragraphXml: string): boolean {
  return /<w:br\b[^>]*w:type="page"[^>]*\/>/i.test(paragraphXml)
}

function paragraphIsPureManualPageBreak(paragraphXml: string): boolean {
  return paragraphContainsManualPageBreak(paragraphXml) && !extractTextFromParagraphXml(paragraphXml).trim() && !/<w:sectPr\b/i.test(paragraphXml)
}

function looksLikeDocumentTitle(text: string): boolean {
  const normalized = String(text || '').trim()
  if (!normalized || normalized.length > 120) return false
  if (/^[#*\-]/.test(normalized)) return false
  if (/^(摘要|关键词|关键字|abstract|keywords?)[:：]?$/i.test(normalized)) return false
  return !/[。！？.!?；;:]$/.test(normalized)
}

function looksLikeLevelOneHeading(text: string): boolean {
  const normalized = String(text || '').trim()
  if (!normalized) return false
  if (/^#\s+/.test(normalized)) return true
  if (/^(第[一二三四五六七八九十百]+[章节部分]|[一二三四五六七八九十]+[、.．]|\d+[、.．])\s*/.test(normalized)) return true
  return false
}

function splitTextIntoStructuredBlocks(block: OoxmlBlockSnapshot, isLeadingBlock: boolean): OoxmlBlockSnapshot[] {
  if (block.kind !== 'paragraph' && block.kind !== 'heading') return [block]
  const sourceText = String(block.text || '').replace(/\r/g, '')
  const rawLines = sourceText.split('\n').map((line) => line.trim()).filter(Boolean)
  if (!rawLines.length) return [block]

  const lines = rawLines.flatMap((line) => line.split(/(?=\s*#{1,6}\s+)/g).map((part) => part.trim()).filter(Boolean))
  if (lines.length === 1 && !/#{1,6}\s+/.test(lines[0]) && !STRUCTURE_HEADING_LABELS.some((label) => lines[0].toLowerCase().startsWith(label))) {
    if (isLeadingBlock && block.kind === 'paragraph' && !block.paragraphStyle && looksLikeDocumentTitle(lines[0])) {
      return [{ ...block, kind: 'paragraph', text: lines[0], paragraphStyle: 'Title', alignment: block.alignment || 'center', indentLevel: undefined }]
    }
    return [block]
  }

  const nextBlocks: OoxmlBlockSnapshot[] = []
  let cursor = 0

  if (isLeadingBlock && block.kind === 'paragraph' && !block.paragraphStyle && looksLikeDocumentTitle(lines[0])) {
    nextBlocks.push({ ...block, kind: 'paragraph', text: lines[0], paragraphStyle: 'Title', alignment: block.alignment || 'center', indentLevel: undefined })
    cursor = 1
  }

  for (; cursor < lines.length; cursor += 1) {
    const line = lines[cursor]
    const markdownHeading = line.match(/^(#{1,6})\s+(.+)$/)
    if (markdownHeading) {
      nextBlocks.push({ ...block, kind: 'heading', text: markdownHeading[2].trim(), level: markdownHeading[1].length, paragraphStyle: `Heading${Math.min(markdownHeading[1].length, 6)}`, alignment: undefined, indentLevel: undefined, listType: undefined, listLevel: undefined })
      continue
    }

    const abstractInline = line.match(/^(摘要|abstract)(?:[:：]\s*|\s+)(.+)$/i)
    if (abstractInline) {
      nextBlocks.push({ ...block, kind: 'heading', text: abstractInline[1], level: 1, paragraphStyle: 'AbstractHeading', alignment: 'center', indentLevel: undefined, listType: undefined, listLevel: undefined })
      nextBlocks.push({ ...block, kind: 'paragraph', text: abstractInline[2].trim(), paragraphStyle: 'Abstract', alignment: 'justify', indentLevel: undefined, listType: undefined, listLevel: undefined })
      continue
    }

    if (/^(摘要|abstract)$/i.test(line)) {
      nextBlocks.push({ ...block, kind: 'heading', text: line, level: 1, paragraphStyle: 'AbstractHeading', alignment: 'center', indentLevel: undefined, listType: undefined, listLevel: undefined })
      const body: string[] = []
      while (cursor + 1 < lines.length && !/^(#{1,6})\s+/.test(lines[cursor + 1]) && !/^(关键词|关键字|keywords?|摘要|abstract)(?:[:：]|\s|$)/i.test(lines[cursor + 1]) && !looksLikeLevelOneHeading(lines[cursor + 1])) {
        body.push(lines[cursor + 1])
        cursor += 1
      }
      if (body.length) {
        body.forEach((paragraphText) => {
          nextBlocks.push({ ...block, kind: 'paragraph', text: paragraphText, paragraphStyle: 'Abstract', alignment: 'justify', indentLevel: undefined, listType: undefined, listLevel: undefined })
        })
      }
      continue
    }

    const keywordInline = line.match(/^(关键词|关键字|keywords?)(?:[:：]\s*|\s+)(.+)$/i)
    if (keywordInline) {
      nextBlocks.push({ ...block, kind: 'heading', text: keywordInline[1], level: 1, paragraphStyle: 'KeywordsHeading', alignment: 'left', indentLevel: undefined, listType: undefined, listLevel: undefined })
      nextBlocks.push({ ...block, kind: 'paragraph', text: keywordInline[2].trim(), paragraphStyle: 'Keywords', alignment: 'left', indentLevel: undefined, listType: undefined, listLevel: undefined })
      continue
    }

    if (/^(关键词|关键字|keywords?)$/i.test(line)) {
      nextBlocks.push({ ...block, kind: 'heading', text: line, level: 1, paragraphStyle: 'KeywordsHeading', alignment: 'left', indentLevel: undefined, listType: undefined, listLevel: undefined })
      continue
    }

    if (looksLikeLevelOneHeading(line) && block.kind !== 'heading') {
      const nextText = line.replace(/^#\s+/, '').trim()
      nextBlocks.push({ ...block, kind: 'heading', text: nextText, level: 1, paragraphStyle: 'Heading1', alignment: undefined, indentLevel: undefined, listType: undefined, listLevel: undefined })
      continue
    }

    nextBlocks.push({ ...block, kind: block.kind === 'heading' ? 'heading' : 'paragraph', text: line })
  }

  return nextBlocks.length ? nextBlocks : [block]
}

function normalizeDocumentStructure(blocks: OoxmlBlockSnapshot[]): OoxmlBlockSnapshot[] {
  const flattened = blocks.flatMap((block, index) => splitTextIntoStructuredBlocks(block, index === 0))
  return flattened.map((block, index) => ({
    ...block,
    index,
    paragraphStyle: normalizeKnownStyleId(block.paragraphStyle) || (block.kind === 'heading' && block.level && block.level <= 3 ? `Heading${block.level}` : block.paragraphStyle),
  }))
}

function ensureParagraphStyleDefinition(stylesXml: string, styleId: string): string {
  if (!STYLE_DEFINITIONS[styleId]) return stylesXml
  const stylePattern = new RegExp(`<w:style\b[^>]*w:styleId="${escapeRegExp(styleId)}"[\s\S]*?<\/w:style>`, 'i')
  if (stylePattern.test(stylesXml)) return stylesXml
  return stylesXml.replace(/<\/w:styles>\s*$/i, `  ${STYLE_DEFINITIONS[styleId]}\n</w:styles>`)
}

async function ensureStylesResources(zip: JSZip, blocks: OoxmlBlockSnapshot[], relationshipsXml: string | null, contentTypesXml: string | null): Promise<{ relationshipsXml: string | null; contentTypesXml: string | null }> {
  const requiredStyles = Array.from(new Set(blocks
    .map((block) => normalizeKnownStyleId(block.paragraphStyle || (block.kind === 'heading' && block.level && block.level <= 3 ? `Heading${block.level}` : undefined)))
    .filter((styleId): styleId is keyof typeof STYLE_DEFINITIONS => typeof styleId === 'string' && styleId in STYLE_DEFINITIONS)))

  if (!requiredStyles.length) {
    return { relationshipsXml, contentTypesXml }
  }

  const existingStylesXml = await zip.file('word/styles.xml')?.async('text')
  let nextStylesXml = existingStylesXml && existingStylesXml.trim()
    ? existingStylesXml
    : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:styles>'

  requiredStyles.forEach((styleId) => {
    nextStylesXml = ensureParagraphStyleDefinition(nextStylesXml, styleId)
  })

  zip.file('word/styles.xml', nextStylesXml)
  return {
    relationshipsXml: ensureRelationshipEntry(relationshipsXml, 'rStylesEmbedded', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles', 'styles.xml'),
    contentTypesXml: ensureContentTypeOverride(contentTypesXml, 'word/styles.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml'),
  }
}

function ensureContentTypeOverride(contentTypesXml: string | null, partName: string, contentType: string): string {
  const normalizedPart = `/${String(partName || '').replace(/^\/+/, '')}`
  const overridePattern = new RegExp(`<Override[^>]*PartName="${escapeRegExp(normalizedPart)}"[^>]*ContentType="([^"]+)"`, 'i')
  if (!contentTypesXml || !contentTypesXml.trim()) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n  <Default Extension="xml" ContentType="application/xml"/>\n  <Override PartName="${escapeXmlText(normalizedPart)}" ContentType="${escapeXmlText(contentType)}"/>\n</Types>`
  }
  if (overridePattern.test(contentTypesXml)) {
    return contentTypesXml.replace(overridePattern, `<Override PartName="${normalizedPart}" ContentType="${escapeXmlText(contentType)}"`)
  }
  return contentTypesXml.replace(/<\/Types>\s*$/i, `  <Override PartName="${escapeXmlText(normalizedPart)}" ContentType="${escapeXmlText(contentType)}"/>\n</Types>`)
}

function ensureRelationshipEntry(relationshipsXml: string | null, id: string, type: string, target: string): string {
  const baseXml = relationshipsXml && relationshipsXml.trim()
    ? relationshipsXml
    : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
  const entryXml = `<Relationship Id="${escapeXmlText(id)}" Type="${escapeXmlText(type)}" Target="${escapeXmlText(target)}"/>`
  const relationshipPattern = new RegExp(`\s*<Relationship\\b[^>]*Id="${escapeRegExp(id)}"[^>]*\/?>`, 'gi')
  const withoutExisting = baseXml.replace(relationshipPattern, '')
  return withoutExisting.replace(/<\/Relationships>\s*$/i, `  ${entryXml}\n</Relationships>`)
}

function ensureDefaultNumberingXml(numberingXml: string | null): string {
  const baseXml = numberingXml && numberingXml.trim()
    ? numberingXml
    : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:numbering>'
  let nextXml = baseXml
  if (!/w:abstractNumId="900"/i.test(nextXml)) {
    nextXml = nextXml.replace(/<\/w:numbering>\s*$/i, `  <w:abstractNum w:abstractNumId="900"><w:nsid w:val="77777777"/><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>\n</w:numbering>`)
  }
  if (!/w:abstractNumId="901"/i.test(nextXml)) {
    nextXml = nextXml.replace(/<\/w:numbering>\s*$/i, `  <w:abstractNum w:abstractNumId="901"><w:nsid w:val="88888888"/><w:multiLevelType w:val="multilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>\n</w:numbering>`)
  }
  if (!/w:numId="900"/i.test(nextXml)) {
    nextXml = nextXml.replace(/<\/w:numbering>\s*$/i, `  <w:num w:numId="900"><w:abstractNumId w:val="900"/></w:num>\n</w:numbering>`)
  }
  if (!/w:numId="901"/i.test(nextXml)) {
    nextXml = nextXml.replace(/<\/w:numbering>\s*$/i, `  <w:num w:numId="901"><w:abstractNumId w:val="901"/></w:num>\n</w:numbering>`)
  }
  return nextXml
}

async function ensureNumberingResources(zip: JSZip, blocks: OoxmlBlockSnapshot[], relationshipsXml: string | null, contentTypesXml: string | null): Promise<{ relationshipsXml: string | null; contentTypesXml: string | null }> {
  const needsNumbering = blocks.some((block) => (block.kind === 'paragraph' || block.kind === 'heading') && block.listType)
  if (!needsNumbering) {
    return { relationshipsXml, contentTypesXml }
  }
  const existingNumbering = zip.file('word/numbering.xml')
  const existingNumberingXml = existingNumbering ? await existingNumbering.async('text') : null
  zip.file('word/numbering.xml', ensureDefaultNumberingXml(existingNumberingXml))
  const nextRelationshipsXml = ensureRelationshipEntry(
    relationshipsXml,
    'rNumberingEmbedded',
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering',
    'numbering.xml',
  )
  const nextContentTypesXml = ensureContentTypeOverride(
    contentTypesXml,
    'word/numbering.xml',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml',
  )
  return { relationshipsXml: nextRelationshipsXml, contentTypesXml: nextContentTypesXml }
}

function getExtensionContentType(contentTypesXml: string | null, entryPath: string): string | null {
  const lowerPath = entryPath.toLowerCase()
  const override = contentTypesXml?.match(new RegExp(`<Override[^>]*PartName="/${escapeRegExp(entryPath.replace(/^\/+/, ''))}"[^>]*ContentType="([^"]+)"`, 'i'))?.[1]
  if (override) return override

  const extension = lowerPath.split('.').pop()
  if (!extension) return null
  const defaultType = contentTypesXml?.match(new RegExp(`<Default[^>]*Extension="${escapeRegExp(extension)}"[^>]*ContentType="([^"]+)"`, 'i'))?.[1]
  if (defaultType) return defaultType

  if (extension === 'png') return 'image/png'
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'gif') return 'image/gif'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'svg') return 'image/svg+xml'
  return null
}

function getExtensionFromEntryPath(entryPath: string): string | null {
  const extension = String(entryPath || '').toLowerCase().split('.').pop()
  return extension && extension !== entryPath.toLowerCase() ? extension : null
}

function getExtensionForContentType(contentType: string | undefined): string | null {
  const mapping: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
  }
  return contentType ? (mapping[contentType.toLowerCase()] || null) : null
}

function ensureContentTypeDefault(contentTypesXml: string | null, extension: string, contentType: string): string {
  const normalizedExtension = extension.replace(/^\./, '').toLowerCase()
  const defaultPattern = new RegExp(`<Default[^>]*Extension="${escapeRegExp(normalizedExtension)}"[^>]*ContentType="([^"]+)"`, 'i')
  if (!contentTypesXml || !contentTypesXml.trim()) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n  <Default Extension="xml" ContentType="application/xml"/>\n  <Default Extension="${escapeXmlText(normalizedExtension)}" ContentType="${escapeXmlText(contentType)}"/>\n</Types>`
  }
  if (defaultPattern.test(contentTypesXml)) {
    return contentTypesXml.replace(defaultPattern, `<Default Extension="${normalizedExtension}" ContentType="${escapeXmlText(contentType)}"`)
  }
  return contentTypesXml.replace(/<\/Types>\s*$/i, `  <Default Extension="${escapeXmlText(normalizedExtension)}" ContentType="${escapeXmlText(contentType)}"/>\n</Types>`)
}

function normalizeMediaEntryPath(mediaPath: string | undefined, fallbackContentType?: string): string | null {
  const rawPath = String(mediaPath || '').trim().replace(/\\/g, '/').replace(/^\/+/, '')
  if (!rawPath) return null
  const basePath = rawPath.startsWith('word/') ? rawPath : path.posix.normalize(path.posix.join('word', rawPath))
  if (getExtensionFromEntryPath(basePath)) return basePath
  const inferredExtension = getExtensionForContentType(fallbackContentType)
  return inferredExtension ? `${basePath}.${inferredExtension}` : basePath
}

function parseDataUrl(dataUrl: string): { contentType: string; buffer: Buffer } | null {
  const match = String(dataUrl || '').match(/^data:([^;,]+)(;base64)?,(.*)$/i)
  if (!match) return null
  const contentType = match[1] || 'application/octet-stream'
  const isBase64 = Boolean(match[2])
  try {
    const buffer = isBase64 ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]), 'utf-8')
    return { contentType, buffer }
  } catch {
    return null
  }
}

function inferImageContentTypeFromPath(sourcePath: string): string | null {
  const extension = String(sourcePath || '').toLowerCase().match(/\.([a-z0-9]+)(?:[?#].*)?$/)?.[1]
  if (!extension) return null
  if (extension === 'png') return 'image/png'
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'gif') return 'image/gif'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'svg') return 'image/svg+xml'
  if (extension === 'bmp') return 'image/bmp'
  return null
}

function resolveLocalImagePath(source: string | undefined): string | null {
  const raw = String(source || '').trim()
  if (!raw || /^data:/i.test(raw)) return null

  if (/^file:\/\//i.test(raw)) {
    const normalized = raw.replace(/^file:\/\//i, '')
    const decoded = decodeURI(normalized)
    if (/^\/[a-zA-Z]:\//.test(decoded)) {
      return decoded.slice(1)
    }
    return decoded
  }

  if (path.isAbsolute(raw)) {
    return raw
  }

  if (/^[a-zA-Z]:[\\/]/.test(raw)) {
    return raw
  }

  return null
}

async function readLocalImageAsBuffer(source: string | undefined): Promise<{ buffer: Buffer; contentType: string | null } | null> {
  const localPath = resolveLocalImagePath(source)
  if (!localPath) return null
  try {
    const buffer = await fs.readFile(localPath)
    return {
      buffer,
      contentType: inferImageContentTypeFromPath(localPath),
    }
  } catch {
    return null
  }
}

function parseDocumentRelationships(relationshipsXml: string | null): Map<string, OoxmlRelationshipInfo> {
  const relationships = new Map<string, OoxmlRelationshipInfo>()
  if (!relationshipsXml) return relationships

  const parsed = xmlParser.parse(relationshipsXml) as { Relationships?: { Relationship?: Array<Record<string, string>> | Record<string, string> } }
  const rawRelationships = parsed?.Relationships?.Relationship
  const list = Array.isArray(rawRelationships) ? rawRelationships : rawRelationships ? [rawRelationships] : []
  list.forEach((entry) => {
    const id = String(entry?.Id || '').trim()
    const target = String(entry?.Target || '').trim()
    if (!id || !target) return
    relationships.set(id, { id, target, type: String(entry?.Type || '').trim() || undefined })
  })
  return relationships
}

function resolveRelationshipTarget(target: string): string {
  const normalized = String(target || '').replace(/\\/g, '/')
  if (normalized.startsWith('/')) return normalized.replace(/^\/+/, '')
  return path.posix.normalize(path.posix.join('word', normalized))
}

async function readZipEntryAsDataUrl(zip: JSZip, entryPath: string, contentType: string | null): Promise<string | undefined> {
  const entry = zip.file(entryPath)
  if (!entry || !contentType || !contentType.startsWith('image/')) return undefined
  const base64 = await entry.async('base64')
  return `data:${contentType};base64,${base64}`
}

function extractRelationshipId(paragraphXml: string): string | undefined {
  return paragraphXml.match(/r:embed="([^"]+)"/i)?.[1] || paragraphXml.match(/r:id="([^"]+)"/i)?.[1] || undefined
}

function emuToPx(value: number | undefined): number | undefined {
  if (!value || !Number.isFinite(value)) return undefined
  return Math.round(value / 9525)
}

function extractDrawingInfo(paragraphXml: string) {
  const layout = /<wp:anchor\b/i.test(paragraphXml) ? 'anchor' : 'inline'
  const extentCx = Number(paragraphXml.match(/<wp:extent\b[^>]*cx="(\d+)"/i)?.[1] || paragraphXml.match(/<a:ext\b[^>]*cx="(\d+)"/i)?.[1] || 0) || undefined
  const extentCy = Number(paragraphXml.match(/<wp:extent\b[^>]*cy="(\d+)"/i)?.[1] || paragraphXml.match(/<a:ext\b[^>]*cy="(\d+)"/i)?.[1] || 0) || undefined
  const anchorHorizontal = paragraphXml.match(/<wp:positionH\b[^>]*relativeFrom="([^"]+)"/i)?.[1]
    || paragraphXml.match(/<wp:simplePos\b[^>]*x="([^"]+)"/i)?.[1]
    || undefined
  const anchorVertical = paragraphXml.match(/<wp:positionV\b[^>]*relativeFrom="([^"]+)"/i)?.[1]
    || paragraphXml.match(/<wp:simplePos\b[^>]*y="([^"]+)"/i)?.[1]
    || undefined
  const wrapType = paragraphXml.match(/<wp:(wrapSquare|wrapTight|wrapTopAndBottom|wrapThrough|wrapNone)\b/i)?.[1]
  const srcRectMatch = paragraphXml.match(/<a:srcRect\b([^>]*)\/?>/i)
  const imageCropRect = srcRectMatch ? (() => {
    const attrs = srcRectMatch[1] || ''
    return {
      l: Number(attrs.match(/\bl="(\d+)"/i)?.[1] || 0),
      t: Number(attrs.match(/\bt="(\d+)"/i)?.[1] || 0),
      r: Number(attrs.match(/\br="(\d+)"/i)?.[1] || 0),
      b: Number(attrs.match(/\bb="(\d+)"/i)?.[1] || 0),
    }
  })() : undefined
  return {
    drawingLayout: layout as 'inline' | 'anchor',
    imageWidthEmu: extentCx,
    imageHeightEmu: extentCy,
    imageWidthPx: emuToPx(extentCx),
    imageHeightPx: emuToPx(extentCy),
    anchorHorizontal,
    anchorVertical,
    wrapType,
    imageCropRect,
  }
}

function extractTableParagraphSnapshots(sourceXml: string): OoxmlTableParagraphSnapshot[] {
  const paragraphMatches = Array.from(sourceXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g))
  if (!paragraphMatches.length) return [{ text: '' }]

  return paragraphMatches.map((match) => {
    const paragraphXml = match[0]
    const hasSpecialContent = paragraphXml.includes('<m:oMath') || paragraphXml.includes('<w:drawing')
    return {
      text: extractTextFromParagraphXml(paragraphXml).trim(),
      style: extractParagraphStyleId(paragraphXml),
      level: extractHeadingLevel(paragraphXml) || undefined,
      sourceXml: hasSpecialContent ? paragraphXml : undefined,
    }
  })
}

function buildTableCellText(paragraphs: OoxmlTableParagraphSnapshot[]): string {
  return paragraphs.map((paragraph) => paragraph.text).filter(Boolean).join('\n').trim()
}

function normalizeTableRows(tableRows: OoxmlTableCellSnapshot[][] | undefined, fallbackCells?: string[][]): OoxmlTableCellSnapshot[][] {
  if (tableRows?.length) {
    return tableRows.map((row) => row.map((cell) => ({
      ...cell,
      text: cell.text || buildTableCellText(cell.paragraphs || [{ text: '' }]),
      paragraphs: cell.paragraphs?.length ? cell.paragraphs : [{ text: cell.text || '' }],
      colspan: Math.max(1, cell.colspan || 1),
      rowspan: Math.max(1, cell.rowspan || 1),
      column: cell.column ?? 0,
    })))
  }

  const cells = fallbackCells?.length ? fallbackCells : [['']]
  return cells.map((row) => row.map((cell, column) => ({
    text: cell,
    paragraphs: [{ text: cell }],
    colspan: 1,
    rowspan: 1,
    column,
  })))
}

function extractTextFromParagraphXml(paragraphXml: string): string {
  const normalized = paragraphXml
    .replace(/<w:tab\s*\/>/g, '\t')
    .replace(/<w:(br|cr)\b[^>]*\/>/g, '\n')

  const chunks = Array.from(normalized.matchAll(/<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t>/g)).map((match) => decodeXmlEntities(match[1]))
  return chunks.join('').replace(/\u00a0/g, ' ')
}

function parseInlineStyleFromRunXml(runXml: string): string | undefined {
  const styleMap: Record<string, string | undefined> = {}
  if (/<w:b(?:\b|\s|\/)/i.test(runXml) && !/<w:b\b[^>]*w:val="0"/i.test(runXml)) {
    styleMap['font-weight'] = '700'
  }
  if (/<w:i(?:\b|\s|\/)/i.test(runXml) && !/<w:i\b[^>]*w:val="0"/i.test(runXml)) {
    styleMap['font-style'] = 'italic'
  }
  if (/<w:u\b[^>]*w:val="(?!none)/i.test(runXml) || /<w:u\s*\/>/i.test(runXml)) {
    styleMap['text-decoration'] = styleMap['text-decoration'] ? `${styleMap['text-decoration']} underline` : 'underline'
  }
  if (/<w:strike(?:\b|\s|\/)/i.test(runXml) && !/<w:strike\b[^>]*w:val="0"/i.test(runXml)) {
    styleMap['text-decoration'] = styleMap['text-decoration'] ? `${styleMap['text-decoration']} line-through` : 'line-through'
  }
  const fontConfig = normalizeWordFontConfig([
    runXml.match(/<w:rFonts\b[^>]*w:ascii="([^"]+)"/i)?.[1] || '',
    runXml.match(/<w:rFonts\b[^>]*w:eastAsia="([^"]+)"/i)?.[1] || '',
  ].filter(Boolean).join(', '))
  if (fontConfig) {
    styleMap['font-family'] = `${fontConfig.latin}, ${fontConfig.eastAsia}`
  }
  const fontSize = runXml.match(/<w:sz\b[^>]*w:val="(\d+)"/i)?.[1]
  if (fontSize) {
    styleMap['font-size'] = `${(Number(fontSize) / 1.5).toFixed(2).replace(/\.00$/, '').replace(/0$/, '')}px`
  }
  const highlight = runXml.match(/<w:highlight\b[^>]*w:val="([^"]+)"/i)?.[1]
  if (highlight && highlight.toLowerCase() !== 'none') {
    styleMap['background-color'] = highlight.toLowerCase()
  }
  const shd = runXml.match(/<w:shd\b[^>]*w:fill="([^"]+)"/i)?.[1]
  if (shd && shd.toLowerCase() !== 'auto' && !/^0+$/.test(shd) && !styleMap['background-color']) {
    styleMap['background-color'] = `#${shd}`
  }
  const vertAlign = runXml.match(/<w:vertAlign\b[^>]*w:val="([^"]+)"/i)?.[1]
  if (vertAlign === 'superscript') { styleMap['vertical-align'] = 'super'; styleMap['font-size'] = 'smaller' }
  else if (vertAlign === 'subscript') { styleMap['vertical-align'] = 'sub'; styleMap['font-size'] = 'smaller' }
  const color = runXml.match(/<w:color\b[^>]*w:val="([^"]+)"/i)?.[1]
  if (color && color.toLowerCase() !== 'auto') styleMap['color'] = `#${color}`
  return stringifyCssStyleMap(styleMap)
}

function extractInlineRunsFromParagraphXml(paragraphXml: string): OoxmlInlineRunSnapshot[] | undefined {
  // Match both text runs AND inline OMML math in document order so that mixed
  // paragraphs (e.g. "Here, α, β, γ are…") preserve formula variables inline.
  const tokenMatches = Array.from(String(paragraphXml || '').matchAll(/<w:r\b[\s\S]*?<\/w:r>|<m:oMath\b[\s\S]*?<\/m:oMath>/g))
  if (!tokenMatches.length) return undefined
  const runs: OoxmlInlineRunSnapshot[] = []

  tokenMatches.forEach((match) => {
    const tokenXml = match[0]
    // Inline OMML — convert to LaTeX and emit as a formula run
    if (/^<m:oMath\b/i.test(tokenXml)) {
      const latex = convertOmmlToLatex(tokenXml) || extractFormulaPlainText(tokenXml)
      if (latex) runs.push({ text: latex, formulaLatex: latex })
      return
    }
    const runXml = tokenXml
    if (runXml.includes(FORMULA_METADATA_PREFIX)) return
    if (/<w:drawing\b/i.test(runXml)) return
    const normalized = runXml
      .replace(/<w:tab\s*\/>/g, '\t')
      .replace(/<w:(br|cr)\b[^>]*\/>/g, '\n')
    const text = Array.from(normalized.matchAll(/<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t>/g)).map((entry) => decodeXmlEntities(entry[1])).join('').replace(/\u00a0/g, ' ')
    if (!text && !normalized.includes('\n')) return
    const style = parseInlineStyleFromRunXml(runXml)
    const previous = runs[runs.length - 1]
    // Don't merge a text run into a formula run
    if (previous && !previous.formulaLatex && (previous.style || '') === (style || '')) {
      previous.text += text || '\n'
    } else {
      runs.push({ text: text || '\n', style })
    }
  })

  if (!runs.length) return undefined
  if (runs.length === 1 && !runs[0].style && !runs[0].formulaLatex) return undefined
  return runs
}

function stripFormulaMetadataRuns(paragraphXml: string): string {
  return String(paragraphXml || '').replace(
    new RegExp(`<w:r\\b[\\s\\S]*?<w:t(?:\\s+[^>]*)?>${FORMULA_METADATA_PREFIX}[A-Za-z0-9+/=_-]+<\\/w:t>[\\s\\S]*?<\\/w:r>`, 'gi'),
    '',
  )
}

function extractParagraphsFromDocumentXml(documentXml: string): OoxmlParagraphSnapshot[] {
  return Array.from(documentXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)).map((match, index) => ({
    index,
    text: extractTextFromParagraphXml(match[0]),
  }))
}

function extractHeadingLevel(paragraphXml: string): number | null {
  const styleValue = paragraphXml.match(/<w:pStyle\b[^>]*w:val="([^"]+)"/i)?.[1] || ''
  const directHeading = styleValue.match(/Heading([1-6])/i)?.[1]
  if (directHeading) return Number(directHeading)
  return null
}

function extractExplicitImageObjectNumericId(rawValue: string | undefined): number | null {
  const raw = String(rawValue || '').trim()
  if (!raw) return null

  const directMatch = raw.match(/^(?:image-|img-|figure-|object-)?(\d+)$/i)?.[1]
  if (directMatch) {
    const numeric = Number(directMatch)
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null
  }

  const relationshipMatch = raw.match(/^rId(\d+)$/i)?.[1]
  if (relationshipMatch) {
    const numeric = Number(relationshipMatch)
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null
  }

  return null
}

function deriveImageObjectNumericId(block: OoxmlBlockSnapshot, fallback = 1): number {
  const numeric = extractExplicitImageObjectNumericId(block.sourceId)
    || extractExplicitImageObjectNumericId(block.relationshipId)
    || (Number.isFinite(block.index) ? block.index + 1 : 0)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback
}

function getNextRelationshipId(relationshipsXml: string | null): string {
  let maxId = 0
  for (const match of String(relationshipsXml || '').matchAll(/Id="rId(\d+)"/gi)) {
    maxId = Math.max(maxId, Number(match[1]) || 0)
  }
  return `rId${maxId + 1}`
}

function buildGeneratedImageMediaPath(block: OoxmlBlockSnapshot): string {
  const parsedPreview = block.previewSrc ? parseDataUrl(block.previewSrc) : null
  const extension = getExtensionForContentType(parsedPreview?.contentType || block.mediaContentType) || 'png'
  const baseName = String(block.title || block.alt || block.text || block.sourceId || `image-${block.index + 1}`)
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || `image-${block.index + 1}`
  // Use a short content hash for uniqueness — prevents collision when two blocks share the same index or name
  const hashSource = block.previewSrc || block.sourceId || String(block.index)
  const uniqueSuffix = createHash('sha1').update(hashSource).digest('hex').slice(0, 8)
  return `word/media/${baseName}-${uniqueSuffix}.${extension}`
}

function ensureImageRelationshipResources(
  blocks: OoxmlBlockSnapshot[],
  relationshipsXml: string | null,
): { blocks: OoxmlBlockSnapshot[]; relationshipsXml: string } {
  let nextRelationshipsXml = relationshipsXml && relationshipsXml.trim()
    ? relationshipsXml
    : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'

  const allocatedPaths = new Set<string>()
  const nextBlocks = blocks.map((block) => {
    if (block.kind !== 'image-placeholder') return block

    const parsedPreview = block.previewSrc ? parseDataUrl(block.previewSrc) : null
    const nextMediaContentType = parsedPreview?.contentType || block.mediaContentType
    let candidatePath = normalizeMediaEntryPath(block.mediaPath || buildGeneratedImageMediaPath(block), nextMediaContentType) || buildGeneratedImageMediaPath(block)
    // Deduplicate media paths across blocks — if two different blocks would write to the same path,
    // bump the second one with a counter suffix so they don't overwrite each other.
    if (allocatedPaths.has(candidatePath)) {
      const dotIndex = candidatePath.lastIndexOf('.')
      const base = dotIndex >= 0 ? candidatePath.slice(0, dotIndex) : candidatePath
      const ext = dotIndex >= 0 ? candidatePath.slice(dotIndex) : ''
      let counter = 2
      while (allocatedPaths.has(`${base}-${counter}${ext}`)) counter += 1
      candidatePath = `${base}-${counter}${ext}`
    }
    allocatedPaths.add(candidatePath)
    const nextMediaPath = candidatePath
    const nextRelationshipId = block.relationshipId || getNextRelationshipId(nextRelationshipsXml)

    nextRelationshipsXml = ensureRelationshipEntry(
      nextRelationshipsXml,
      nextRelationshipId,
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
      normalizeMediaRelationshipTarget(nextMediaPath) || 'media/image.png',
    )

    return {
      ...block,
      relationshipId: nextRelationshipId,
      mediaPath: nextMediaPath,
      mediaContentType: nextMediaContentType || block.mediaContentType,
    }
  })

  return { blocks: nextBlocks, relationshipsXml: nextRelationshipsXml }
}

function extractImageInfo(paragraphXml: string) {
  const docPr = paragraphXml.match(/<wp:docPr\b([^>]*)\/>/i)?.[1] || ''
  const alt = getAttr(docPr, 'descr') || getAttr(docPr, 'title') || null
  const title = getAttr(docPr, 'name') || null
  const objectId = getAttr(docPr, 'id') || null
  return { alt, title, objectId }
}

function extractFormulaObjectId(paragraphXml: string) {
  return paragraphXml.match(/<m:oMath(?:Para)?\b[^>]*>/i)?.[0] ? `formula-${Buffer.from(paragraphXml).toString('base64').slice(0, 16)}` : null
}

function extractTableDimensions(tableXml: string) {
  const tableRows = extractStructuredTableRows(tableXml)
  const rows = Math.max(1, tableRows.length)
  const columns = Math.max(1, ...tableRows.map((row) => row.reduce((total, cell) => Math.max(total, (cell.column || 0) + Math.max(1, cell.colspan || 1)), 0)))
  return { rows, columns }
}

function extractStructuredTableRows(tableXml: string): OoxmlTableCellSnapshot[][] {
  const rowMatches = Array.from(tableXml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g))
  if (!rowMatches.length) return [[{ text: '', paragraphs: [{ text: '' }], colspan: 1, rowspan: 1, column: 0 }]]

  const previousGrid: Array<OoxmlTableCellSnapshot | null> = []
  return rowMatches.map((rowMatch) => {
    const cellMatches = Array.from(rowMatch[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g))
    const currentGrid: Array<OoxmlTableCellSnapshot | null> = []
    const row: OoxmlTableCellSnapshot[] = []
    let column = 0

    for (const cellMatch of cellMatches) {
      const cellXml = cellMatch[0]
      const colspan = Math.max(1, Number(cellXml.match(/<w:gridSpan\b[^>]*w:val="(\d+)"/i)?.[1] || 1))
      const width = cellXml.match(/<w:tcW\b[^>]*w:w="([^"]+)"/i)?.[1]
      const vMerge = cellXml.match(/<w:vMerge\b([^>]*)\/?>(?:<\/w:vMerge>)?/i)?.[1] || null
      const isContinue = vMerge != null && !/w:val="restart"/i.test(vMerge)

      if (isContinue) {
        const anchors = new Set<OoxmlTableCellSnapshot>()
        for (let offset = 0; offset < colspan; offset += 1) {
          const anchor = previousGrid[column + offset]
          if (anchor) {
            currentGrid[column + offset] = anchor
            if (!anchors.has(anchor)) {
              anchor.rowspan = Math.max(1, anchor.rowspan || 1) + 1
              anchors.add(anchor)
            }
          }
        }
        column += colspan
        continue
      }

      const paragraphs = extractTableParagraphSnapshots(cellXml)
      const cell: OoxmlTableCellSnapshot = {
        text: buildTableCellText(paragraphs),
        paragraphs,
        colspan,
        rowspan: 1,
        width,
        column,
      }
      row.push(cell)
      for (let offset = 0; offset < colspan; offset += 1) {
        currentGrid[column + offset] = cell
      }
      column += colspan
    }

    previousGrid.length = Math.max(previousGrid.length, currentGrid.length)
    for (let index = 0; index < previousGrid.length; index += 1) {
      previousGrid[index] = currentGrid[index] || null
    }
    return row
  })
}

function extractTableCells(tableXml: string): string[][] {
  const tableRows = extractStructuredTableRows(tableXml)
  if (!tableRows.length) return [['']]

  const columns = Math.max(1, ...tableRows.map((row) => row.reduce((total, cell) => Math.max(total, (cell.column || 0) + Math.max(1, cell.colspan || 1)), 0)))
  return tableRows.map((row) => {
    const cells = Array.from({ length: columns }, () => '')
    row.forEach((cell) => {
      cells[cell.column || 0] = cell.text
    })
    return cells
  })
}

function extractFormulaMetadata(paragraphXml: string): FormulaMetadataSnapshot | null {
  const match = String(paragraphXml || '').match(new RegExp(`${FORMULA_METADATA_PREFIX}([A-Za-z0-9+/=_-]+)`))
  if (!match?.[1]) return null
  try {
    const parsed = JSON.parse(decodeBase64ToUtf8(match[1])) as FormulaMetadataSnapshot
    if (!parsed || typeof parsed.latex !== 'string' || typeof parsed.plainText !== 'string') return null
    return {
      latex: parsed.latex,
      plainText: parsed.plainText,
      displayMode: parsed.displayMode === 'inline' || parsed.displayMode === 'block' ? parsed.displayMode : undefined,
    }
  } catch {
    return null
  }
}

function extractFormulaPlainText(paragraphXml: string): string {
  const sanitizedXml = stripFormulaMetadataRuns(paragraphXml)
  const mathText = Array.from(sanitizedXml.matchAll(/<m:t\b[^>]*>([\s\S]*?)<\/m:t>/g)).map((match) => decodeXmlEntities(match[1])).join('')
  const text = (mathText || extractTextFromParagraphXml(sanitizedXml)).trim()
  return text || '公式对象'
}

function normalizeFormulaPlainText(t: string): string {
  return t.replace(/\s+/g, '').toLowerCase()
}

function extractFormulaText(paragraphXml: string): string {
  const plainText = extractFormulaPlainText(paragraphXml)
  const metadata = extractFormulaMetadata(paragraphXml)
  const displayMode = extractFormulaDisplayMode(paragraphXml)

  // Check LLM-enhanced cache first (keyed by OMML hash)
  const ommlHash = createHash('sha256').update(paragraphXml).digest('hex').slice(0, 16)
  const cached = llmFormulaCache.get(ommlHash)
  if (cached) return cached

  if (metadata && metadata.latex.trim() && normalizeFormulaPlainText(metadata.plainText) === normalizeFormulaPlainText(plainText) && (!metadata.displayMode || metadata.displayMode === displayMode)) {
    const storedLatex = metadata.latex.trim()
    // Validate stored LaTeX: if it fails KaTeX (e.g. \alphacos from a past conversion bug),
    // skip the cached value and re-derive from the raw OMML instead.
    try {
      katex.renderToString(storedLatex, { throwOnError: true, output: 'mathml' })
      return storedLatex
    } catch {
      // fall through to fresh OMML conversion below
    }
  }
  // Fallback: convert OMML to LaTeX for native Word formulas (no metadata run)
  const converted = convertOmmlToLatex(paragraphXml)
  const best = converted || plainText

  // Validate; if KaTeX still rejects, trigger async LLM enhancement
  try {
    katex.renderToString(best, { throwOnError: true, output: 'mathml' })
  } catch {
    // Fire-and-forget: enhance via LLM and cache result for next load
    void enhanceFormulaWithLlm(ommlHash, paragraphXml, best)
  }

  return best
}

/**
 * Asynchronously calls the LLM to convert raw OMML XML to a valid LaTeX string.
 * Result is stored in llmFormulaCache so the next document load uses the improved value.
 * Silently no-ops if no LLM provider is configured.
 */
async function enhanceFormulaWithLlm(cacheKey: string, paragraphXml: string, fallbackLatex: string): Promise<void> {
  if (!_llmSettingsProvider) return
  try {
    const settings = await _llmSettingsProvider()
    const oMathMatch = paragraphXml.match(/<m:oMath\b[\s\S]*?<\/m:oMath>/i)
    if (!oMathMatch) return
    const ommlXml = oMathMatch[0]
    const result = await completeText(settings, {
      systemPrompt: 'You are a LaTeX math expert. Convert the given Office Math Markup Language (OMML) XML to a valid LaTeX math expression. Reply with ONLY the LaTeX expression, no explanation, no surrounding $ signs, no markdown.',
      userPrompt: `Convert this OMML to LaTeX:\n\n${ommlXml}`,
      temperature: 0.1,
      maxTokens: 400,
    })
    const latex = result.trim().replace(/^\$+|\$+$/g, '').trim()
    if (!latex) return
    // Validate the LLM output before caching
    katex.renderToString(latex, { throwOnError: true, output: 'mathml' })
    // Evict oldest entry if cache is full
    if (llmFormulaCache.size >= LLM_FORMULA_CACHE_MAX) {
      const firstKey = llmFormulaCache.keys().next().value
      if (firstKey !== undefined) llmFormulaCache.delete(firstKey)
    }
    llmFormulaCache.set(cacheKey, latex)
  } catch {
    // LLM failed or produced invalid LaTeX — silently ignore
  }
}

function extractFormulaDisplayMode(paragraphXml: string): 'inline' | 'block' {
  return /<m:oMathPara\b/i.test(paragraphXml) ? 'block' : 'inline'
}

function renderFormulaMathMl(latex: string, displayMode: boolean): string | undefined {
  try {
    const rendered = katex.renderToString(latex, { throwOnError: false, output: 'mathml', displayMode })
    const mathMatch = rendered.match(/<math[\s\S]*?<\/math>/i)
    return mathMatch?.[0]
  } catch {
    return undefined
  }
}

function renderFormulaPreviewHtml(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex || '', {
      throwOnError: false,
      strict: 'ignore',
      displayMode,
      output: 'html',
    })
  } catch {
    return escapeHtmlText(latex || '')
  }
}

function parseInlineHtmlToRuns(innerHtml: string): OoxmlInlineRunSnapshot[] | undefined {
  const tokens = Array.from(String(innerHtml || '').matchAll(/<[^>]+>|[^<]+/g)).map((match) => match[0])
  if (!tokens.length) return undefined

  const stack: Record<string, string>[] = [{}]
  const runs: OoxmlInlineRunSnapshot[] = []
  // Tracks nesting depth inside a formula span so inner KaTeX HTML is skipped
  let formulaSkipDepth = 0

  const pushText = (text: string) => {
    if (!text) return
    const decoded = decodeHtmlEntities(text).replace(/\u00a0/g, ' ')
    if (!decoded) return
    const style = stringifyCssStyleMap(stack[stack.length - 1])
    const previous = runs[runs.length - 1]
    if (previous && !previous.formulaLatex && (previous.style || '') === (style || '')) {
      previous.text += decoded
    } else {
      runs.push({ text: decoded, style })
    }
  }

  tokens.forEach((token) => {
    // Inside a formula span — track nesting depth, skip all inner content
    if (formulaSkipDepth > 0) {
      if (/^<(?!\/)(?:span|div)\b/i.test(token)) formulaSkipDepth++
      else if (/^<\/(?:span|div)\b/i.test(token)) {
        formulaSkipDepth--
        if (formulaSkipDepth === 0 && stack.length > 1) stack.pop()
      }
      return
    }

    if (!token.startsWith('<')) {
      pushText(token)
      return
    }

    if (/^<br\b/i.test(token)) {
      pushText('\n')
      return
    }

    if (/^<\//.test(token)) {
      if (stack.length > 1) stack.pop()
      return
    }

    // Formula span — extract LaTeX, then skip inner KaTeX HTML via formulaSkipDepth
    if (/^<(?:span|div)\b[^>]*\bdata-formula-node="true"/i.test(token)) {
      const latex = getAttr(token, 'data-latex') || ''
      if (latex) runs.push({ text: latex, formulaLatex: latex })
      formulaSkipDepth = 1
      stack.push({ ...stack[stack.length - 1] }) // balance the upcoming closing tag
      return
    }

    const parent = stack[stack.length - 1]
    const next = { ...parent }
    const styleAttr = getAttr(token, 'style')
    if (styleAttr) {
      Object.assign(next, parseCssStyleMap(styleAttr))
    }
    if (/^<(strong|b)\b/i.test(token)) next['font-weight'] = '700'
    if (/^<(em|i)\b/i.test(token)) next['font-style'] = 'italic'
    if (/^<u\b/i.test(token)) next['text-decoration'] = next['text-decoration'] ? `${next['text-decoration']} underline` : 'underline'
    if (/^<(s|strike)\b/i.test(token)) next['text-decoration'] = next['text-decoration'] ? `${next['text-decoration']} line-through` : 'line-through'
    if (/^<mark\b/i.test(token)) next['background-color'] = next['background-color'] || 'yellow'
    if (/^<code\b/i.test(token)) next['font-family'] = next['font-family'] || 'Consolas, monospace'
    if (/^<sup\b/i.test(token)) { next['vertical-align'] = 'super'; next['font-size'] = 'smaller' }
    if (/^<sub\b/i.test(token)) { next['vertical-align'] = 'sub'; next['font-size'] = 'smaller' }
    stack.push(next)
  })

  if (!runs.length) return undefined
  if (runs.length === 1 && !runs[0].style && !runs[0].formulaLatex) return undefined
  return runs
}

function renderInlineRunsHtml(runs: OoxmlInlineRunSnapshot[] | undefined, fallbackText: string): string {
  if (!runs?.length) {
    return escapeHtmlText(fallbackText).replace(/\n/g, '<br />')
  }
  return runs.map((run) => {
    if (run.formulaLatex) {
      const preview = renderFormulaPreviewHtml(run.formulaLatex, false)
      return `<span data-formula-node="true" data-formula-display="inline" data-latex="${escapeHtmlText(run.formulaLatex)}" class="formula-node formula-inline">${preview || escapeHtmlText(run.formulaLatex)}</span>`
    }
    const content = escapeHtmlText(run.text || '').replace(/\n/g, '<br />')
    if (!run.style) return content
    return `<span style="${escapeHtmlText(run.style)}">${content}</span>`
  }).join('')
}

function paragraphSupportsCitationFieldWrite(paragraphStyle: string | undefined): boolean {
  const normalized = String(paragraphStyle || '').trim().toLowerCase()
  return normalized !== 'reference' && normalized !== 'referencesheading'
}

function containsWordFieldCode(paragraphXml: string | undefined): boolean {
  const source = String(paragraphXml || '')
  if (!source) return false
  return /<w:fldSimple\b[^>]*w:instr="[^"]*(?:CITATION|BIBLIOGRAPHY|ADDIN)[^"]*"/i.test(source)
    || /<w:instrText\b[^>]*>[^<]*(?:CITATION|BIBLIOGRAPHY|ADDIN)[^<]*<\/w:instrText>/i.test(source)
}

function normalizeWordFieldInstruction(instruction: string): string {
  return decodeXmlEntities(String(instruction || '')).replace(/\s+/g, ' ').trim()
}

function extractWordFieldInstructions(paragraphXml: string | undefined): string[] {
  const source = String(paragraphXml || '')
  if (!source) return []

  const instructions: string[] = []
  const complexFieldStack: string[] = []
  const tokenPattern = /<w:fldSimple\b[^>]*w:instr="([^"]*)"[^>]*>|<w:fldChar\b[^>]*w:fldCharType="(begin|separate|end)"[^>]*\/?>|<w:instrText(?:\s+[^>]*)?>([\s\S]*?)<\/w:instrText>/gi

  for (const match of source.matchAll(tokenPattern)) {
    const simpleInstruction = match[1]
    const fieldBoundary = match[2]
    const complexInstructionChunk = match[3]

    if (typeof simpleInstruction === 'string' && simpleInstruction) {
      const normalized = normalizeWordFieldInstruction(simpleInstruction)
      if (normalized) instructions.push(normalized)
      continue
    }

    if (fieldBoundary === 'begin') {
      complexFieldStack.push('')
      continue
    }

    if (typeof complexInstructionChunk === 'string' && complexFieldStack.length) {
      complexFieldStack[complexFieldStack.length - 1] += decodeXmlEntities(complexInstructionChunk)
      continue
    }

    if (fieldBoundary === 'end' && complexFieldStack.length) {
      const normalized = normalizeWordFieldInstruction(complexFieldStack.pop() || '')
      if (normalized) instructions.push(normalized)
    }
  }

  return instructions
}

function extractCitationSourceTagsFromInstruction(instruction: string): string[] {
  const normalized = normalizeWordFieldInstruction(instruction)
  if (!/^CITATION\b/i.test(normalized)) return []
  const primaryTag = normalized.match(/^CITATION\s+([^\s\\]+)/i)?.[1]
  const mergedTags = Array.from(normalized.matchAll(/\\m\s+([^\s\\]+)/gi)).map((match) => String(match[1] || '').trim())
  return Array.from(new Set([primaryTag, ...mergedTags].filter((value): value is string => Boolean(value))))
}

function buildDeterministicGuid(seed: string): string {
  const digest = createHash('md5').update(String(seed || 'ai-writer-bibliography')).digest('hex')
  return `{${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}}`
}

function buildBibliographySourceTag(referenceText: string, fallbackNumber?: number): string {
  const normalized = stripLeadingCitationPrefix(referenceText).replace(/\s+/g, ' ').trim().toLowerCase() || `reference-${fallbackNumber || 0}`
  const digest = createHash('sha1').update(normalized).digest('hex').slice(0, 12).toUpperCase()
  return `AIWRITER_SRC_${fallbackNumber || 0}_${digest}`.replace(/[^A-Z0-9_]/g, '')
}

function parseBibliographySourceMetadata(referenceText: string): OoxmlBibliographySourceSnapshot {
  const rawCitation = stripLeadingCitationPrefix(referenceText).replace(/\s+/g, ' ').trim() || String(referenceText || '').trim()
  const citationNumber = parseLeadingCitationNumber(referenceText)
  const author = rawCitation.split(/\(\s*(?:19|20)\d{2}[a-z]?\s*\)/i)[0]?.trim().replace(/[.,;:\s]+$/g, '') || undefined
  const year = rawCitation.match(/\b((?:19|20)\d{2})[a-z]?\b/)?.[1]
  const titleFromYear = rawCitation.match(/\(\s*(?:19|20)\d{2}[a-z]?\s*\)\.?\s*([^.;]+(?:\.[^.;]+)*)/i)?.[1]?.trim()
  const title = (titleFromYear || rawCitation.split(/\.(?:\s|$)/)[0] || rawCitation).replace(/\s+/g, ' ').trim() || 'Imported Reference'
  const tag = buildBibliographySourceTag(rawCitation, citationNumber)
  return {
    tag,
    title,
    rawCitation,
    sourceType: 'Misc',
    guid: buildDeterministicGuid(`${tag}:${rawCitation}`),
    year,
    author,
  }
}

function buildBibliographySourcesFromBlocks(blocks: OoxmlBlockSnapshot[]): { sources: OoxmlBibliographySourceSnapshot[]; sourceTagMap: Map<number, string> } {
  const sources: OoxmlBibliographySourceSnapshot[] = []
  const sourceTagMap = new Map<number, string>()
  let inReferences = false

  for (const block of blocks) {
    const normalizedStyle = normalizeKnownStyleId(block.paragraphStyle)
    const normalizedText = String(block.text || '').trim()
    const isReferencesHeading = normalizedStyle === 'ReferencesHeading' || /^(参考文献|references)$/i.test(normalizedText)

    if (isReferencesHeading) {
      inReferences = true
      continue
    }

    if (!inReferences) continue
    if (block.kind === 'heading') break
    if (block.kind !== 'paragraph') continue

    const citationNumber = parseLeadingCitationNumber(normalizedText)
    if (!citationNumber) continue

    const source = parseBibliographySourceMetadata(normalizedText)
    sources.push(source)
    sourceTagMap.set(citationNumber, source.tag)
  }

  return { sources, sourceTagMap }
}

function normalizeImportedBibliographyBlocks(
  blocks: OoxmlBlockSnapshot[],
  bibliographySources: OoxmlBibliographySourceSnapshot[],
): OoxmlBlockSnapshot[] {
  const normalizedBlocks: OoxmlBlockSnapshot[] = []
  let inReferences = false
  let expectedReferenceIndex = 0

  const toReferenceHeadingBlock = (block: OoxmlBlockSnapshot): OoxmlBlockSnapshot => ({
    ...block,
    kind: 'heading',
    level: block.kind === 'heading' ? Math.max(1, Math.min(block.level || 2, 6)) : 2,
    text: String(block.text || '').trim() || '参考文献',
    paragraphStyle: 'ReferencesHeading',
    alignment: block.alignment || 'left',
    listType: undefined,
    listLevel: undefined,
  })

  const formatReferenceText = (text: string, citationNumber: number): string => {
    const stripped = stripLeadingCitationPrefix(text).trim() || text.trim()
    return stripped ? `[${citationNumber}] ${stripped}` : `[${citationNumber}]`
  }

  for (const block of blocks) {
    const normalizedText = String(block.text || '').trim()
    const normalizedStyle = normalizeKnownStyleId(block.paragraphStyle)
    const isReferencesHeading = normalizedStyle === 'ReferencesHeading' || /^(参考文献|references)$/i.test(normalizedText)

    if (isReferencesHeading) {
      normalizedBlocks.push(toReferenceHeadingBlock(block))
      inReferences = true
      expectedReferenceIndex = 0
      continue
    }

    if (!inReferences) {
      normalizedBlocks.push(block)
      continue
    }

    if (block.kind === 'heading') {
      inReferences = false
      normalizedBlocks.push(block)
      continue
    }

    if (block.kind !== 'paragraph') {
      inReferences = false
      normalizedBlocks.push(block)
      continue
    }

    if (!normalizedText) {
      normalizedBlocks.push(block)
      continue
    }

    const referenceOrdinal = expectedReferenceIndex + 1
    const parsedCitationNumber = parseLeadingCitationNumber(normalizedText)
    const shouldTreatAsReference = normalizedStyle === 'Reference'
      || typeof parsedCitationNumber === 'number'
      || block.listType === 'number'
      || referenceOrdinal <= bibliographySources.length

    if (!shouldTreatAsReference) {
      inReferences = false
      normalizedBlocks.push(block)
      continue
    }

    expectedReferenceIndex += 1
    const citationNumber = parsedCitationNumber || referenceOrdinal
    normalizedBlocks.push({
      ...block,
      text: formatReferenceText(normalizedText, citationNumber),
      paragraphStyle: 'Reference',
      alignment: block.alignment || 'left',
      listType: undefined,
      listLevel: undefined,
    })
  }

  return normalizedBlocks
}

function buildCitationNumberBySourceTag(
  blocks: OoxmlBlockSnapshot[],
  bibliographySources: OoxmlBibliographySourceSnapshot[],
): Map<string, number> {
  const citationNumberBySourceTag = new Map<string, number>()

  bibliographySources.forEach((source, index) => {
    if (source.tag) {
      citationNumberBySourceTag.set(source.tag, index + 1)
    }
  })

  let inReferences = false
  let sourceIndex = 0

  for (const block of blocks) {
    const normalizedText = String(block.text || '').trim()
    const normalizedStyle = normalizeKnownStyleId(block.paragraphStyle)
    const isReferencesHeading = normalizedStyle === 'ReferencesHeading' || /^(参考文献|references)$/i.test(normalizedText)

    if (isReferencesHeading) {
      inReferences = true
      sourceIndex = 0
      continue
    }

    if (!inReferences) continue
    if (block.kind === 'heading') break
    if (block.kind !== 'paragraph') {
      inReferences = false
      continue
    }
    if (!normalizedText) continue

    const source = bibliographySources[sourceIndex]
    const citationNumber = parseLeadingCitationNumber(normalizedText, sourceIndex + 1)
    if (source?.tag && citationNumber) {
      citationNumberBySourceTag.set(source.tag, citationNumber)
    }
    sourceIndex += 1
  }

  return citationNumberBySourceTag
}

function buildCitationMarkerFromInstruction(
  instruction: string,
  citationNumberBySourceTag: Map<string, number>,
): string | null {
  const numbers = Array.from(new Set(
    extractCitationSourceTagsFromInstruction(instruction)
      .map((tag) => citationNumberBySourceTag.get(tag))
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0),
  )).sort((left, right) => left - right)

  const marker = formatCitationNumbers(numbers)
  return marker || null
}

function appendInlineRun(
  target: OoxmlInlineRunSnapshot[],
  nextRun: OoxmlInlineRunSnapshot | null | undefined,
): void {
  if (!nextRun?.text && !nextRun?.formulaLatex) return
  const previous = target[target.length - 1]
  if (
    previous
    && !previous.formulaLatex
    && !nextRun.formulaLatex
    && (previous.style || '') === (nextRun.style || '')
  ) {
    previous.text += nextRun.text || ''
    return
  }
  target.push({ ...nextRun })
}

function appendInlineRuns(
  target: OoxmlInlineRunSnapshot[],
  nextRuns: OoxmlInlineRunSnapshot[] | undefined,
): void {
  nextRuns?.forEach((run) => appendInlineRun(target, run))
}

function trimTrailingInlineBreaks(target: OoxmlInlineRunSnapshot[]): void {
  while (target.length) {
    const lastRun = target[target.length - 1]
    if (lastRun.formulaLatex) return
    const nextText = String(lastRun.text || '').replace(/[ \t\n\r]+$/g, '')
    if (nextText === lastRun.text) return
    if (nextText) {
      lastRun.text = nextText
      return
    }
    target.pop()
  }
}

function buildNormalizedCitationInlineRuns(
  paragraphXml: string,
  citationNumberBySourceTag: Map<string, number>,
): OoxmlInlineRunSnapshot[] | undefined {
  const source = String(paragraphXml || '')
  if (!source) return undefined

  const runs: OoxmlInlineRunSnapshot[] = []
  const fieldStack: Array<{
    instruction: string
    displayRuns: OoxmlInlineRunSnapshot[]
    inDisplay: boolean
  }> = []

  const appendTextWithStyle = (text: string, style?: string) => {
    if (!text) return
    appendInlineRun(runs, { text, style })
  }

  const appendCitationMarkerRun = (marker: string, style?: string) => {
    if (!marker) return
    trimTrailingInlineBreaks(runs)
    appendInlineRun(runs, {
      text: marker,
      style: mergeCssStyles(style, 'vertical-align: super; font-size: smaller'),
    })
  }

  const buildFallbackDisplayRuns = (displayText: string, style?: string): OoxmlInlineRunSnapshot[] | undefined => {
    if (!displayText) return undefined
    return [{ text: displayText, style }]
  }

  const resolveCitationDisplayStyle = (displayRuns: OoxmlInlineRunSnapshot[]): string | undefined => {
    return mergeCssStyles(...displayRuns.map((run) => run.style))
  }

  const tokenPattern = /<w:fldSimple\b[^>]*w:instr="([^"]*)"[^>]*>([\s\S]*?)<\/w:fldSimple>|<w:fldChar\b[^>]*w:fldCharType="(begin|separate|end)"[^>]*\/?>|<w:instrText(?:\s+[^>]*)?>([\s\S]*?)<\/w:instrText>|<w:r\b[\s\S]*?<\/w:r>|<w:tab\s*\/>|<w:(br|cr)\b[^>]*\/>/gi

  for (const match of source.matchAll(tokenPattern)) {
    const simpleInstruction = match[1]
    const simpleFieldXml = match[2]
    const fieldBoundary = match[3]
    const instructionChunk = match[4]
    const breakToken = match[5]
    const fullToken = match[0] || ''

    if (typeof simpleInstruction === 'string' && typeof simpleFieldXml === 'string') {
      const marker = buildCitationMarkerFromInstruction(simpleInstruction, citationNumberBySourceTag)
      const simpleFieldRuns = extractInlineRunsFromParagraphXml(simpleFieldXml)
      if (marker) {
        appendCitationMarkerRun(marker, resolveCitationDisplayStyle(simpleFieldRuns || []))
      } else {
        appendInlineRuns(runs, simpleFieldRuns)
      }
      continue
    }

    if (fieldBoundary === 'begin') {
      fieldStack.push({ instruction: '', displayRuns: [], inDisplay: false })
      continue
    }

    if (typeof instructionChunk === 'string' && fieldStack.length) {
      fieldStack[fieldStack.length - 1].instruction += decodeXmlEntities(instructionChunk)
      continue
    }

    if (fieldBoundary === 'separate' && fieldStack.length) {
      fieldStack[fieldStack.length - 1].inDisplay = true
      continue
    }

    if (fieldBoundary === 'end' && fieldStack.length) {
      const completedField = fieldStack.pop()!
      const marker = buildCitationMarkerFromInstruction(completedField.instruction, citationNumberBySourceTag)
      if (marker) {
        appendCitationMarkerRun(marker, resolveCitationDisplayStyle(completedField.displayRuns))
      } else {
        appendInlineRuns(runs, completedField.displayRuns)
      }
      continue
    }

    if (/^<w:r\b/i.test(fullToken)) {
      const extractedRuns = extractInlineRunsFromParagraphXml(fullToken)
      const activeField = fieldStack[fieldStack.length - 1]
      if (activeField) {
        if (activeField.inDisplay) appendInlineRuns(activeField.displayRuns, extractedRuns)
        continue
      }
      appendInlineRuns(runs, extractedRuns)
      continue
    }

    const segment = /^<w:tab/i.test(fullToken)
      ? '\t'
      : breakToken
        ? '\n'
        : ''
    if (!segment) continue

    const activeField = fieldStack[fieldStack.length - 1]
    if (activeField) {
      if (activeField.inDisplay) {
        appendInlineRuns(activeField.displayRuns, buildFallbackDisplayRuns(segment))
      }
      continue
    }

    appendTextWithStyle(segment)
  }

  if (!runs.length) return undefined
  if (runs.length === 1 && !runs[0].style && !runs[0].formulaLatex) return undefined
  return runs
}

function extractTextFromParagraphXmlWithNormalizedCitations(
  paragraphXml: string,
  citationNumberBySourceTag: Map<string, number>,
): string {
  const source = String(paragraphXml || '')
  if (!source) return ''

  const fieldStack: Array<{ instruction: string; displayText: string; inDisplay: boolean }> = []
  let output = ''
  const appendRenderedText = (value: string) => {
    if (!value) return
    const activeField = fieldStack[fieldStack.length - 1]
    if (activeField?.inDisplay) {
      activeField.displayText += value
      return
    }
    output += value
  }

  const tokenPattern = /<w:fldSimple\b[^>]*w:instr="([^"]*)"[^>]*>([\s\S]*?)<\/w:fldSimple>|<w:fldChar\b[^>]*w:fldCharType="(begin|separate|end)"[^>]*\/?>|<w:instrText(?:\s+[^>]*)?>([\s\S]*?)<\/w:instrText>|<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:(br|cr)\b[^>]*\/>/gi

  for (const match of source.matchAll(tokenPattern)) {
    const simpleInstruction = match[1]
    const simpleFieldXml = match[2]
    const fieldBoundary = match[3]
    const instructionChunk = match[4]
    const textChunk = match[5]
    const breakToken = match[6]

    if (typeof simpleInstruction === 'string' && typeof simpleFieldXml === 'string') {
      appendRenderedText(
        buildCitationMarkerFromInstruction(simpleInstruction, citationNumberBySourceTag)
        || extractTextFromParagraphXml(simpleFieldXml),
      )
      continue
    }

    if (fieldBoundary === 'begin') {
      fieldStack.push({ instruction: '', displayText: '', inDisplay: false })
      continue
    }

    if (typeof instructionChunk === 'string' && fieldStack.length) {
      fieldStack[fieldStack.length - 1].instruction += decodeXmlEntities(instructionChunk)
      continue
    }

    if (fieldBoundary === 'separate' && fieldStack.length) {
      fieldStack[fieldStack.length - 1].inDisplay = true
      continue
    }

    if (fieldBoundary === 'end' && fieldStack.length) {
      const completedField = fieldStack.pop()!
      appendRenderedText(
        buildCitationMarkerFromInstruction(completedField.instruction, citationNumberBySourceTag)
        || completedField.displayText,
      )
      continue
    }

    const segment = typeof textChunk === 'string'
      ? decodeXmlEntities(textChunk).replace(/\u00a0/g, ' ')
      : breakToken
        ? '\n'
        : match[0] === '<w:tab/>' || match[0] === '<w:tab />'
          ? '\t'
          : ''

    if (!segment) continue

    const activeField = fieldStack[fieldStack.length - 1]
    if (activeField) {
      if (activeField.inDisplay) {
        activeField.displayText += segment
      }
      continue
    }

    output += segment
  }

  return output.trim()
}

function normalizeImportedCitationFieldBlocks(
  blocks: OoxmlBlockSnapshot[],
  bibliographySources: OoxmlBibliographySourceSnapshot[],
): OoxmlBlockSnapshot[] {
  const citationNumberBySourceTag = buildCitationNumberBySourceTag(blocks, bibliographySources)
  if (!citationNumberBySourceTag.size) return blocks

  return blocks.map((block) => {
    if ((block.kind !== 'paragraph' && block.kind !== 'heading') || !block.sourceXml || !block.fieldInstructions?.length) {
      return block
    }

    const hasCitationField = block.fieldInstructions.some((instruction) => /^CITATION\b/i.test(normalizeWordFieldInstruction(instruction)))
    if (!hasCitationField) return block

    const normalizedText = extractTextFromParagraphXmlWithNormalizedCitations(block.sourceXml, citationNumberBySourceTag)
    const normalizedInlineRuns = buildNormalizedCitationInlineRuns(block.sourceXml, citationNumberBySourceTag)
    const previousInlineRunsJson = JSON.stringify(block.inlineRuns || [])
    const nextInlineRunsJson = JSON.stringify(normalizedInlineRuns || [])
    const textChanged = Boolean(normalizedText) && normalizedText !== String(block.text || '').trim()
    const inlineRunsChanged = previousInlineRunsJson !== nextInlineRunsJson

    if (!textChanged && !inlineRunsChanged) {
      return block
    }

    return {
      ...block,
      text: normalizedText || block.text,
      inlineRuns: normalizedInlineRuns,
    }
  })
}

function buildBibliographySourceXml(source: OoxmlBibliographySourceSnapshot): string {
  const authorXml = source.author
    ? `<b:Author><b:Author><b:Corporate>${escapeXmlText(source.author)}</b:Corporate></b:Author></b:Author>`
    : ''
  const yearXml = source.year ? `<b:Year>${escapeXmlText(source.year)}</b:Year>` : ''
  return `<b:Source><b:Tag>${escapeXmlText(source.tag)}</b:Tag><b:SourceType>${escapeXmlText(source.sourceType || 'Misc')}</b:SourceType><b:Guid>${escapeXmlText(source.guid)}</b:Guid>${authorXml}<b:Title>${escapeXmlText(source.title || source.rawCitation || 'Imported Reference')}</b:Title>${yearXml}<b:Comments>${escapeXmlText(source.rawCitation || source.title || '')}</b:Comments></b:Source>`
}

function buildBibliographySourcesXml(sources: OoxmlBibliographySourceSnapshot[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<b:Sources xmlns:b="http://schemas.openxmlformats.org/officeDocument/2006/bibliography" SelectedStyle="/IEEE2006.XSL" StyleName="IEEE">${sources.map((source) => buildBibliographySourceXml(source)).join('')}</b:Sources>`
}

function buildBibliographyItemPropsXml(itemId: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<ds:datastoreItem ds:itemID="${escapeXmlText(itemId)}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs><ds:schemaRef ds:uri="http://schemas.openxmlformats.org/officeDocument/2006/bibliography"/></ds:schemaRefs></ds:datastoreItem>`
}

function buildBibliographyItemRelationshipsXml(itemPropsPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="${escapeXmlText(path.posix.basename(itemPropsPath))}"/></Relationships>`
}

function parseBibliographySourcesXml(sourceXml: string): OoxmlBibliographySourceSnapshot[] {
  return Array.from(String(sourceXml || '').matchAll(/<b:Source\b[\s\S]*?<\/b:Source>/gi)).map((match) => {
    const sourceBlock = match[0]
    const rawCitation = decodeXmlEntities(sourceBlock.match(/<b:Comments>([\s\S]*?)<\/b:Comments>/i)?.[1] || '').trim()
    return {
      tag: decodeXmlEntities(sourceBlock.match(/<b:Tag>([\s\S]*?)<\/b:Tag>/i)?.[1] || '').trim(),
      title: decodeXmlEntities(sourceBlock.match(/<b:Title>([\s\S]*?)<\/b:Title>/i)?.[1] || '').trim(),
      rawCitation,
      sourceType: decodeXmlEntities(sourceBlock.match(/<b:SourceType>([\s\S]*?)<\/b:SourceType>/i)?.[1] || 'Misc').trim() || 'Misc',
      guid: decodeXmlEntities(sourceBlock.match(/<b:Guid>([\s\S]*?)<\/b:Guid>/i)?.[1] || '').trim(),
      year: decodeXmlEntities(sourceBlock.match(/<b:Year>([\s\S]*?)<\/b:Year>/i)?.[1] || '').trim() || undefined,
      author: decodeXmlEntities(sourceBlock.match(/<b:Corporate>([\s\S]*?)<\/b:Corporate>/i)?.[1] || '').trim() || undefined,
    }
  }).filter((source) => source.tag)
}

async function findBibliographyCustomXmlPart(zip: JSZip, rootRelationshipsXml: string | null): Promise<OoxmlBibliographyPartInfo | null> {
  const entries = Object.keys(zip.files).sort()
  const rootRelationships = parseDocumentRelationships(rootRelationshipsXml)

  for (const entryPath of entries) {
    if (!/^customXml\/item\d+\.xml$/i.test(entryPath)) continue
    const sourceXml = await zip.file(entryPath)?.async('text') || ''
    if (!/<b:Sources\b/i.test(sourceXml)) continue
    const index = entryPath.match(/item(\d+)\.xml$/i)?.[1] || '1'
    const itemRelsPath = `customXml/_rels/item${index}.xml.rels`
    const itemRelsXml = await zip.file(itemRelsPath)?.async('text') || ''
    const itemPropsTarget = itemRelsXml.match(/<Relationship\b[^>]*Target="([^"]+)"/i)?.[1] || `itemProps${index}.xml`
    const itemPropsPath = path.posix.join('customXml', itemPropsTarget.replace(/^\/+/, ''))
    const rootRelationshipId = Array.from(rootRelationships.values()).find((relationship) => String(relationship.target || '').replace(/^\/+/, '') === entryPath)?.id
    return {
      itemPath: entryPath,
      itemPropsPath,
      itemRelsPath,
      rootRelationshipId,
      sources: parseBibliographySourcesXml(sourceXml),
    }
  }

  return null
}

async function ensureBibliographyResources(
  zip: JSZip,
  blocks: OoxmlBlockSnapshot[],
  rootRelationshipsXml: string | null,
  contentTypesXml: string | null,
): Promise<{ rootRelationshipsXml: string | null; contentTypesXml: string | null; sourceTagMap: Map<number, string>; bibliographySources: OoxmlBibliographySourceSnapshot[] }> {
  const existingPart = await findBibliographyCustomXmlPart(zip, rootRelationshipsXml)
  const { sources, sourceTagMap } = buildBibliographySourcesFromBlocks(blocks)
  if (!sources.length) {
    return {
      rootRelationshipsXml,
      contentTypesXml,
      sourceTagMap,
      bibliographySources: existingPart?.sources || [],
    }
  }

  const entries = Object.keys(zip.files)
  const maxExistingIndex = entries.reduce((maxValue, entryPath) => {
    const match = entryPath.match(/^customXml\/item(?:Props)?(\d+)\.xml$/i)
    return match ? Math.max(maxValue, Number(match[1]) || 0) : maxValue
  }, 0)
  const targetIndex = existingPart?.itemPath.match(/item(\d+)\.xml$/i)?.[1] || String(maxExistingIndex + 1 || 1)
  const itemPath = existingPart?.itemPath || `customXml/item${targetIndex}.xml`
  const itemPropsPath = existingPart?.itemPropsPath || `customXml/itemProps${targetIndex}.xml`
  const itemRelsPath = existingPart?.itemRelsPath || `customXml/_rels/item${targetIndex}.xml.rels`
  const itemId = buildDeterministicGuid(`${itemPath}:${sources.map((source) => source.tag).join('|')}`)

  zip.file(itemPath, buildBibliographySourcesXml(sources))
  zip.file(itemPropsPath, buildBibliographyItemPropsXml(itemId))
  zip.file(itemRelsPath, buildBibliographyItemRelationshipsXml(itemPropsPath))

  const nextRootRelationshipId = existingPart?.rootRelationshipId || getNextRelationshipId(rootRelationshipsXml)
  const nextRootRelationshipsXml = ensureRelationshipEntry(
    rootRelationshipsXml,
    nextRootRelationshipId,
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml',
    itemPath,
  )
  const nextContentTypesXml = ensureContentTypeOverride(
    contentTypesXml,
    itemPropsPath,
    'application/vnd.openxmlformats-officedocument.customXmlProperties+xml',
  )

  return {
    rootRelationshipsXml: nextRootRelationshipsXml,
    contentTypesXml: nextContentTypesXml,
    sourceTagMap,
    bibliographySources: sources,
  }
}

function buildCitationFieldInstruction(displayText: string, citationSourceTagMap?: Map<number, string>): string {
  const numbers = extractCitationNumbers(displayText)
  if (citationSourceTagMap && numbers.length) {
    const tags = Array.from(new Set(numbers.map((number) => citationSourceTagMap.get(number)).filter((value): value is string => Boolean(value))))
    if (tags.length === numbers.length && tags.length) {
      const [primaryTag, ...mergedTags] = tags
      return ` CITATION ${primaryTag}${mergedTags.map((tag) => ` \\m ${tag}`).join('')} \\* MERGEFORMAT `
    }
  }
  const token = numbers.length ? numbers.join('_') : Buffer.from(displayText || 'citation').toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 16) || 'AIWRITER'
  return ` CITATION AIWRITER_${token} \\* MERGEFORMAT `
}

function buildCitationFieldXml(displayText: string, runProperties: string, citationSourceTagMap?: Map<number, string>): string {
  return `<w:fldSimple w:instr="${escapeXmlText(buildCitationFieldInstruction(displayText, citationSourceTagMap))}">${buildRunXml(displayText, runProperties)}</w:fldSimple>`
}

function buildRunXmlWithCitationFields(text: string, runProperties: string, paragraphStyle?: string, citationSourceTagMap?: Map<number, string>): string {
  if (!paragraphSupportsCitationFieldWrite(paragraphStyle)) {
    return buildRunXml(text, runProperties)
  }

  const source = String(text || '')
  const citationPattern = /\[(\s*\d+(?:(?:\s*[,，]\s*\d+)|(?:\s*[-–—]\s*\d+))*)\s*\]/g
  let cursor = 0
  const chunks: string[] = []

  for (const match of source.matchAll(citationPattern)) {
    const marker = match[0] || ''
    const start = match.index || 0
    if (start > cursor) {
      chunks.push(buildRunXml(source.slice(cursor, start), runProperties))
    }
    chunks.push(extractCitationNumbers(marker).length ? buildCitationFieldXml(marker, runProperties, citationSourceTagMap) : buildRunXml(marker, runProperties))
    cursor = start + marker.length
  }

  if (!chunks.length) {
    return buildRunXml(source, runProperties)
  }
  if (cursor < source.length) {
    chunks.push(buildRunXml(source.slice(cursor), runProperties))
  }
  return chunks.join('')
}

function shouldPreserveSourceParagraphXml(block: OoxmlBlockSnapshot, paragraphStyle?: string): boolean {
  if (!block.sourceXml) return false
  // Preserve source XML verbatim for content that cannot be reliably round-tripped through
  // plain text + inlineRuns: citation field codes and inline drawings.
  // NOTE: inline math (<m:oMath>) is intentionally excluded so formulas are written as
  // plaintext [LaTeX]...[/LaTeX] markers via buildRunsXml (see user-facing requirement).
  const hasUnroundtrippableContent = containsWordFieldCode(block.sourceXml)
    || /<w:drawing\b/i.test(block.sourceXml)
  if (!hasUnroundtrippableContent) return false
  if (extractTextFromParagraphXml(block.sourceXml).trim() !== String(block.text || '').trim()) return false
  const sourceStyle = normalizeKnownStyleId(extractParagraphStyleId(block.sourceXml)) || extractParagraphStyleId(block.sourceXml)
  const targetStyle = normalizeKnownStyleId(paragraphStyle) || paragraphStyle
  return String(sourceStyle || '') === String(targetStyle || '')
}

function getNodeChildren(node: Record<string, unknown>): Array<{ name: string; value: unknown }> {
  return Object.entries(node)
    .filter(([, value]) => value != null && (typeof value === 'object' || Array.isArray(value)))
    .filter(([key]) => key !== '#text' && !key.startsWith('@_'))
    .flatMap(([key, value]) => Array.isArray(value) ? value.map((item) => ({ name: key, value: item })) : [{ name: key, value }])
}

function getNodeText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value !== 'object') return String(value)
  const node = value as Record<string, unknown>
  const ownText = typeof node['#text'] === 'string' ? node['#text'] : ''
  const childText = getNodeChildren(node).map((child) => getNodeText(child.value)).join('')
  return decodeHtmlEntities(`${ownText}${childText}`)
}

function wrapMathRun(text: string): string {
  return `<m:r><m:t>${escapeXmlText(text)}</m:t></m:r>`
}

function getMathMlAttribute(value: unknown, name: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const node = value as Record<string, unknown>
  const direct = node[name]
  if (typeof direct === 'string') return direct
  const prefixed = node[`@_${name}`]
  if (typeof prefixed === 'string') return prefixed
  return undefined
}

function isNaryOperator(symbol: string): boolean {
  return ['∑', '∏', '∐', '∫', '∬', '∭', '⋂', '⋃', '⋁', '⋀'].includes(symbol)
}

function buildNaryOmml(operator: string, base: string, sub: string, sup: string): string {
  return `<m:nary><m:naryPr><m:chr m:val="${escapeXmlText(operator)}"/></m:naryPr><m:sub>${sub}</m:sub><m:sup>${sup}</m:sup><m:e>${base}</m:e></m:nary>`
}

function buildAccentOmml(base: string, accent: string): string {
  return `<m:acc><m:accPr><m:chr m:val="${escapeXmlText(accent)}"/></m:accPr><m:e>${base}</m:e></m:acc>`
}

function buildDelimiterOmml(begin: string, end: string, body: string): string {
  return `<m:d><m:dPr><m:begChr m:val="${escapeXmlText(begin)}"/><m:endChr m:val="${escapeXmlText(end)}"/></m:dPr><m:e>${body}</m:e></m:d>`
}

function buildEquationArrayOmml(rows: string[]): string {
  return `<m:eqArr><m:eqArrPr/>${rows.map((row) => `<m:e>${row}</m:e>`).join('')}</m:eqArr>`
}

function isDelimiterSymbol(symbol: string): boolean {
  return ['(', ')', '[', ']', '{', '}', '|', '‖', '⟨', '⟩'].includes(symbol)
}

function normalizeLatex(latex: string): string {
  return String(latex || '').replace(/\s+/g, ' ').trim()
}

function unwrapLatexBraces(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

function latexCommandToSymbol(command: string): string {
  const mapping: Record<string, string> = {
    sum: '∑',
    prod: '∏',
    coprod: '∐',
    int: '∫',
    iint: '∬',
    iiint: '∭',
    oint: '∮',
  }
  return mapping[command] || command
}

function latexAccentToSymbol(command: string): string {
  const mapping: Record<string, string> = {
    hat: '^',
    widehat: '^',
    bar: '¯',
    overline: '¯',
    tilde: '~',
    widetilde: '~',
    vec: '→',
    dot: '˙',
    ddot: '¨',
  }
  return mapping[command] || '^'
}

function splitLatexAlignedRows(body: string): string[] {
  return body
    .split(/\\\\/)
    .map((row) => row.replace(/&/g, ' ').trim())
    .filter(Boolean)
}

// ─── OMML → LaTeX conversion ───────────────────────────────────────────────

const OMML_UNICODE_TO_LATEX: Record<string, string> = {
  // Greek lowercase
  α: '\\alpha', β: '\\beta', γ: '\\gamma', δ: '\\delta',
  ε: '\\varepsilon', ζ: '\\zeta', η: '\\eta', θ: '\\theta',
  ι: '\\iota', κ: '\\kappa', λ: '\\lambda', μ: '\\mu',
  ν: '\\nu', ξ: '\\xi', π: '\\pi', ρ: '\\rho',
  σ: '\\sigma', τ: '\\tau', υ: '\\upsilon', φ: '\\varphi',
  χ: '\\chi', ψ: '\\psi', ω: '\\omega',
  // Greek uppercase
  Γ: '\\Gamma', Δ: '\\Delta', Θ: '\\Theta', Λ: '\\Lambda',
  Ξ: '\\Xi', Π: '\\Pi', Σ: '\\Sigma', Υ: '\\Upsilon',
  Φ: '\\Phi', Ψ: '\\Psi', Ω: '\\Omega',
  // N-ary operators
  '∑': '\\sum', '∏': '\\prod', '∐': '\\coprod',
  '∫': '\\int', '∬': '\\iint', '∭': '\\iiint', '∮': '\\oint',
  // Math constants
  '∞': '\\infty', '∂': '\\partial', '∇': '\\nabla',
  // Relations
  '≤': '\\leq', '≥': '\\geq', '≠': '\\neq', '≈': '\\approx',
  '≡': '\\equiv', '≪': '\\ll', '≫': '\\gg', '∝': '\\propto',
  '∼': '\\sim', '≅': '\\cong',
  // Arrows
  '→': '\\rightarrow', '←': '\\leftarrow', '↔': '\\leftrightarrow',
  '⇒': '\\Rightarrow', '⇐': '\\Leftarrow', '⇔': '\\Leftrightarrow',
  '↑': '\\uparrow', '↓': '\\downarrow',
  // Arithmetic
  '×': '\\times', '÷': '\\div', '±': '\\pm', '∓': '\\mp',
  '·': '\\cdot', '∘': '\\circ',
  // Sets
  '∈': '\\in', '∉': '\\notin', '⊂': '\\subset', '⊃': '\\supset',
  '⊆': '\\subseteq', '⊇': '\\supseteq', '∪': '\\cup', '∩': '\\cap',
  '∅': '\\emptyset',
  // Logic
  '∀': '\\forall', '∃': '\\exists', '¬': '\\neg', '∧': '\\wedge', '∨': '\\vee',
  // Misc
  '…': '\\ldots', '⋯': '\\cdots', '⋮': '\\vdots', '⋱': '\\ddots',
  // Primes and special
  '′': "'", '″': "''", '‴': "'''",
  'ℏ': '\\hbar', 'ℓ': '\\ell', '℘': '\\wp', 'ℜ': '\\Re', 'ℑ': '\\Im',
  // Degree / angle
  '°': '^{\\circ}',
  // Superscript digits (common in chemistry/physics notation from Word)
  '⁰': '^{0}', '¹': '^{1}', '²': '^{2}', '³': '^{3}',
  '⁴': '^{4}', '⁵': '^{5}', '⁶': '^{6}', '⁷': '^{7}', '⁸': '^{8}', '⁹': '^{9}',
  // Subscript digits
  '₀': '_{0}', '₁': '_{1}', '₂': '_{2}', '₃': '_{3}',
  '₄': '_{4}', '₅': '_{5}', '₆': '_{6}', '₇': '_{7}', '₈': '_{8}', '₉': '_{9}',
  // Invisible operators (Word OMML uses these between function name and argument)
  '\u2061': '', // U+2061 invisible function application (cos⁡α)
  '\u2062': '', // U+2062 invisible times
  '\u2063': '', // U+2063 invisible separator
  '\u2064': '', // U+2064 invisible plus
}

function ommlTextToLatex(text: string): string {
  const parts: string[] = []
  let prevWasLatexCommand = false
  for (const char of Array.from(text)) {
    if (char === '#') { prevWasLatexCommand = false; continue } // stray eqArr column separator
    const mapped = OMML_UNICODE_TO_LATEX[char] ?? char
    const isLatexCommand = mapped.startsWith('\\') && /^\\[a-zA-Z]/.test(mapped)
    // Prevent command bleeding: \alpha immediately followed by 'c' would produce \alphac.
    // Insert {} between a \command and a following alphabetic character.
    if (prevWasLatexCommand && /^[a-zA-Z]/.test(mapped)) parts.push('{}')
    parts.push(mapped)
    prevWasLatexCommand = isLatexCommand
  }
  return parts.join('')
}

function ommlOperatorToLatexCommand(symbol: string): string {
  const commands: Record<string, string> = {
    '∑': '\\sum', '∏': '\\prod', '∐': '\\coprod',
    '∫': '\\int', '∬': '\\iint', '∭': '\\iiint', '∮': '\\oint',
    '⋂': '\\bigcap', '⋃': '\\bigcup', '⋁': '\\bigvee', '⋀': '\\bigwedge',
  }
  return commands[symbol] || '\\sum'
}

function ommlAccentToLatexCommand(symbol: string): string {
  const commands: Record<string, string> = {
    '^': '\\hat', ˆ: '\\hat', ˇ: '\\check',
    '¯': '\\bar', ˉ: '\\overline', '‾': '\\overline',
    '~': '\\tilde', '˜': '\\widetilde',
    '→': '\\vec',
    '˙': '\\dot', '¨': '\\ddot',
    '`': '\\grave', '´': '\\acute',
  }
  return commands[symbol] || '\\hat'
}

function isOmmlRadDegHidden(radNode: Record<string, unknown>): boolean {
  const prNode = getNodeChildren(radNode).find((c) => c.name === 'm:radPr')
  if (!prNode?.value || typeof prNode.value !== 'object') return false
  const prChildren = getNodeChildren(prNode.value as Record<string, unknown>)
  const degHideNode = prChildren.find((c) => c.name === 'm:degHide')
  if (!degHideNode?.value || typeof degHideNode.value !== 'object') return false
  const val = ((degHideNode.value as Record<string, unknown>)['m:val'] as string) || ''
  return val === '1' || val === 'true' || val === 'on'
}

function getOmmlPrAttr(prChildren: Array<{ name: string; value: unknown }>, elemName: string, attrName: string): string {
  const node = prChildren.find((c) => c.name === elemName)
  if (!node?.value || typeof node.value !== 'object') return ''
  return ((node.value as Record<string, unknown>)[attrName] as string) || ''
}

/**
 * Join LaTeX token parts, inserting {} at boundaries where a \command token
 * is directly followed by a letter-starting token (command bleeding prevention).
 * This handles the case where two OMML runs convert to e.g. \alpha and cos and
 * are naively joined into \alphacos (undefined KaTeX command).
 */
function latexJoinParts(parts: string[]): string {
  let result = ''
  for (const part of parts) {
    if (result && /\\[a-zA-Z]+$/.test(result) && /^[a-zA-Z]/.test(part)) {
      result += '{}'
    }
    result += part
  }
  return result
}

function convertOmmlNodeToLatex(name: string, value: unknown): string {
  if (typeof value === 'string') return ommlTextToLatex(value)
  const node = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const children = getNodeChildren(node)
  // Exclude property/control elements when looking for content
  const contentChildren = children.filter((c) => !c.name.endsWith('Pr') && c.name !== 'm:ctrlPr')

  switch (name) {
    // Transparent wrappers — just recurse into content children
    case 'm:oMath':
    case 'm:oMathPara':
    case 'm:e':
    case 'm:num':
    case 'm:den':
    case 'm:deg':
    case 'm:lim':
    case 'm:fName':
    case 'm:sub':
    case 'm:sup':
    case 'm:mr':
      return latexJoinParts(contentChildren.map((c) => convertOmmlNodeToLatex(c.name, c.value)))

    // Text run
    case 'm:r': {
      const tNode = children.find((c) => c.name === 'm:t')
      return ommlTextToLatex(tNode ? getNodeText(tNode.value) : getNodeText(node))
    }
    case 'm:t':
      return ommlTextToLatex(getNodeText(node))

    // Fraction
    case 'm:f': {
      const numNode = contentChildren.find((c) => c.name === 'm:num')
      const denNode = contentChildren.find((c) => c.name === 'm:den')
      return `\\frac{${numNode ? convertOmmlNodeToLatex(numNode.name, numNode.value) : ''}}{${denNode ? convertOmmlNodeToLatex(denNode.name, denNode.value) : ''}}`
    }

    // Radical
    case 'm:rad': {
      const degHide = isOmmlRadDegHidden(node)
      const degNode = contentChildren.find((c) => c.name === 'm:deg')
      const bodyNode = contentChildren.find((c) => c.name === 'm:e')
      const bodyLatex = bodyNode ? convertOmmlNodeToLatex(bodyNode.name, bodyNode.value) : ''
      if (degHide || !degNode) return `\\sqrt{${bodyLatex}}`
      const degLatex = convertOmmlNodeToLatex(degNode.name, degNode.value).trim()
      return degLatex ? `\\sqrt[${degLatex}]{${bodyLatex}}` : `\\sqrt{${bodyLatex}}`
    }

    // Superscript
    case 'm:sSup': {
      const baseNode = contentChildren.find((c) => c.name === 'm:e')
      const supNode = contentChildren.find((c) => c.name === 'm:sup')
      return `{${baseNode ? convertOmmlNodeToLatex(baseNode.name, baseNode.value) : ''}}^{${supNode ? convertOmmlNodeToLatex(supNode.name, supNode.value) : ''}}`
    }

    // Subscript
    case 'm:sSub': {
      const baseNode = contentChildren.find((c) => c.name === 'm:e')
      const subNode = contentChildren.find((c) => c.name === 'm:sub')
      return `{${baseNode ? convertOmmlNodeToLatex(baseNode.name, baseNode.value) : ''}}_{${subNode ? convertOmmlNodeToLatex(subNode.name, subNode.value) : ''}}`
    }

    // Sub+Superscript
    case 'm:sSubSup': {
      const baseNode = contentChildren.find((c) => c.name === 'm:e')
      const subNode = contentChildren.find((c) => c.name === 'm:sub')
      const supNode = contentChildren.find((c) => c.name === 'm:sup')
      const b = baseNode ? convertOmmlNodeToLatex(baseNode.name, baseNode.value) : ''
      const sub = subNode ? convertOmmlNodeToLatex(subNode.name, subNode.value) : ''
      const sup = supNode ? convertOmmlNodeToLatex(supNode.name, supNode.value) : ''
      return `{${b}}_{${sub}}^{${sup}}`
    }

    // N-ary operator (sum, int, prod, …)
    case 'm:nary': {
      const naryPrNode = children.find((c) => c.name === 'm:naryPr')
      const subNode = contentChildren.find((c) => c.name === 'm:sub')
      const supNode = contentChildren.find((c) => c.name === 'm:sup')
      const bodyNode = contentChildren.find((c) => c.name === 'm:e')
      let operator = '\\sum'
      if (naryPrNode?.value && typeof naryPrNode.value === 'object') {
        const prChildren = getNodeChildren(naryPrNode.value as Record<string, unknown>)
        const chrVal = getOmmlPrAttr(prChildren, 'm:chr', 'm:val')
        if (chrVal) operator = ommlOperatorToLatexCommand(chrVal)
      }
      let result = operator
      if (subNode) result += `_{${convertOmmlNodeToLatex(subNode.name, subNode.value)}}`
      if (supNode) result += `^{${convertOmmlNodeToLatex(supNode.name, supNode.value)}}`
      if (bodyNode) result += ` ${convertOmmlNodeToLatex(bodyNode.name, bodyNode.value)}`
      return result
    }

    // Delimiter (parentheses, brackets, …)
    case 'm:d': {
      const dPrNode = children.find((c) => c.name === 'm:dPr')
      let begChr = '(', endChr = ')'
      if (dPrNode?.value && typeof dPrNode.value === 'object') {
        const prChildren = getNodeChildren(dPrNode.value as Record<string, unknown>)
        begChr = getOmmlPrAttr(prChildren, 'm:begChr', 'm:val') || '('
        endChr = getOmmlPrAttr(prChildren, 'm:endChr', 'm:val') || ')'
      }
      const body = contentChildren.filter((c) => c.name === 'm:e').map((c) => convertOmmlNodeToLatex(c.name, c.value)).join(' ')
      // \left and \right require exactly one delimiter symbol; empty string becomes '.'
      const safeBegin = begChr || '.'
      const safeEnd = endChr || '.'
      const needsEscape = (ch: string) => ['\\', '{', '}', '|'].includes(ch)
      const wrapDelim = (ch: string) => needsEscape(ch) ? `\\${ch}` : ch
      return `\\left${wrapDelim(safeBegin)}${body}\\right${wrapDelim(safeEnd)}`
    }

    // Accent (hat, bar, tilde, vec, …)
    case 'm:acc': {
      const accPrNode = children.find((c) => c.name === 'm:accPr')
      const baseNode = contentChildren.find((c) => c.name === 'm:e')
      let accent = '^'
      if (accPrNode?.value && typeof accPrNode.value === 'object') {
        const prChildren = getNodeChildren(accPrNode.value as Record<string, unknown>)
        accent = getOmmlPrAttr(prChildren, 'm:chr', 'm:val') || '^'
      }
      return `${ommlAccentToLatexCommand(accent)}{${baseNode ? convertOmmlNodeToLatex(baseNode.name, baseNode.value) : ''}}`
    }

    // Bar (overline / underline)
    case 'm:bar': {
      const barPrNode = children.find((c) => c.name === 'm:barPr')
      const baseNode = contentChildren.find((c) => c.name === 'm:e')
      const baseLatex = baseNode ? convertOmmlNodeToLatex(baseNode.name, baseNode.value) : ''
      let isTop = true
      if (barPrNode?.value && typeof barPrNode.value === 'object') {
        const prChildren = getNodeChildren(barPrNode.value as Record<string, unknown>)
        isTop = getOmmlPrAttr(prChildren, 'm:pos', 'm:val') !== 'bot'
      }
      return isTop ? `\\overline{${baseLatex}}` : `\\underline{${baseLatex}}`
    }

    // Grouping character (overbrace / underbrace)
    case 'm:groupChr': {
      const grPrNode = children.find((c) => c.name === 'm:groupChrPr')
      const baseNode = contentChildren.find((c) => c.name === 'm:e')
      const baseLatex = baseNode ? convertOmmlNodeToLatex(baseNode.name, baseNode.value) : ''
      let pos = 'top'
      if (grPrNode?.value && typeof grPrNode.value === 'object') {
        const prChildren = getNodeChildren(grPrNode.value as Record<string, unknown>)
        pos = getOmmlPrAttr(prChildren, 'm:pos', 'm:val') || 'top'
      }
      return pos === 'top' ? `\\overbrace{${baseLatex}}` : `\\underbrace{${baseLatex}}`
    }

    // Box around formula
    case 'm:borderBox': {
      const baseNode = contentChildren.find((c) => c.name === 'm:e')
      return `\\boxed{${baseNode ? convertOmmlNodeToLatex(baseNode.name, baseNode.value) : ''}}`
    }

    // Limit below (lim_{x→∞})
    case 'm:limLow': {
      const baseNode = contentChildren.find((c) => c.name === 'm:e')
      const limNode = contentChildren.find((c) => c.name === 'm:lim')
      const baseLatex = baseNode ? convertOmmlNodeToLatex(baseNode.name, baseNode.value).trim() : ''
      const limLatex = limNode ? convertOmmlNodeToLatex(limNode.name, limNode.value) : ''
      const underFuncs = ['lim', 'max', 'min', 'inf', 'sup', 'limsup', 'liminf']
      if (underFuncs.includes(baseLatex)) return `\\${baseLatex}_{${limLatex}}`
      return `{${baseLatex}}_{${limLatex}}`
    }

    // Limit above
    case 'm:limUpp': {
      const baseNode = contentChildren.find((c) => c.name === 'm:e')
      const limNode = contentChildren.find((c) => c.name === 'm:lim')
      return `{${baseNode ? convertOmmlNodeToLatex(baseNode.name, baseNode.value) : ''}}^{${limNode ? convertOmmlNodeToLatex(limNode.name, limNode.value) : ''}}`
    }

    // Equation array (aligned)
    case 'm:eqArr': {
      const rows = contentChildren.filter((c) => c.name === 'm:e').map((c) => {
        // OMML uses '#' as column-alignment separator in eqArr rows; LaTeX aligned uses '&'
        return convertOmmlNodeToLatex(c.name, c.value).replace(/#/g, ' & ')
      })
      return `\\begin{aligned}${rows.join(' \\\\ ')}\\end{aligned}`
    }

    // Matrix
    case 'm:m': {
      const rows = contentChildren.filter((c) => c.name === 'm:mr').map((rowNode) => {
        const rowObj = (rowNode.value && typeof rowNode.value === 'object' ? rowNode.value : {}) as Record<string, unknown>
        const cells = getNodeChildren(rowObj)
          .filter((c) => c.name === 'm:e')
          .map((c) => convertOmmlNodeToLatex(c.name, c.value))
        return cells.join(' & ')
      })
      return `\\begin{matrix}${rows.join(' \\\\ ')}\\end{matrix}`
    }

    // Function application (sin, cos, …)
    case 'm:func': {
      const fNameNode = contentChildren.find((c) => c.name === 'm:fName')
      const bodyNode = contentChildren.find((c) => c.name === 'm:e')
      const funcName = fNameNode ? convertOmmlNodeToLatex(fNameNode.name, fNameNode.value).trim() : ''
      const bodyLatex = bodyNode ? convertOmmlNodeToLatex(bodyNode.name, bodyNode.value) : ''
      const knownFuncs = ['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'arccot', 'arcsec', 'arccsc', 'sinh', 'cosh', 'tanh', 'coth', 'exp', 'ln', 'log', 'det', 'arg', 'dim', 'ker', 'deg', 'lim', 'liminf', 'limsup', 'max', 'min', 'inf', 'sup', 'gcd', 'lcm', 'Pr']
      return knownFuncs.includes(funcName) ? `\\${funcName} ${bodyLatex}` : `${funcName} ${bodyLatex}`
    }

    // Pre-superscript / pre-subscript (isotope notation: ²³⁸₉₂U → {}^{238}_{92}U)
    case 'm:sPre': {
      const subNode = contentChildren.find((c) => c.name === 'm:sub')
      const supNode = contentChildren.find((c) => c.name === 'm:sup')
      const baseNode = contentChildren.find((c) => c.name === 'm:e')
      const pre = [
        supNode ? `^{${convertOmmlNodeToLatex(supNode.name, supNode.value)}}` : '',
        subNode ? `_{${convertOmmlNodeToLatex(subNode.name, subNode.value)}}` : '',
      ].filter(Boolean).join('')
      return `{}${pre}${baseNode ? convertOmmlNodeToLatex(baseNode.name, baseNode.value) : ''}`
    }

    // Phantom (invisible spacing placeholder)
    case 'm:phant': {
      const baseNode = contentChildren.find((c) => c.name === 'm:e')
      return baseNode ? `\\phantom{${convertOmmlNodeToLatex(baseNode.name, baseNode.value)}}` : ''
    }

    // Pure control/attribute nodes — emit nothing
    case 'm:pos':
    case 'm:subHide':
    case 'm:supHide':
      return ''

    // Unknown / generic — recurse into content children
    default:
      return contentChildren.map((c) => convertOmmlNodeToLatex(c.name, c.value)).join('')
  }
}

/**
 * Convert OMML (Office Math Markup Language) in a paragraph XML snippet to LaTeX.
 * Returns null if no formula is found or conversion fails.
 */
function convertOmmlToLatex(paragraphXml: string): string | null {
  try {
    const oMathMatch = (paragraphXml || '').match(/<m:oMath\b[^>]*>([\s\S]*?)<\/m:oMath>/i)
    if (!oMathMatch) return null
    // Use ommlXmlParser (isArray:()=>true) so that repeated sibling elements
    // (e.g. multiple <m:r> or <m:f> at the same level) are all preserved.
    const parsed = ommlXmlParser.parse(`<m:oMath>${oMathMatch[1]}</m:oMath>`) as Record<string, unknown>
    const oMathRaw = parsed?.['m:oMath']
    // With isArray:()=>true the root element is always wrapped in an array – unwrap.
    const oMathNode = Array.isArray(oMathRaw) ? oMathRaw[0] : oMathRaw
    if (!oMathNode || typeof oMathNode !== 'object') return null
    const latex = convertOmmlNodeToLatex('m:oMath', oMathNode)
    const trimmed = latex.trim()
    if (!trimmed) return null
    // Post-process step 1: insert {} between a \command and a following bare letter,
    // to prevent command bleeding when multiple m:r runs are joined (e.g. \alpha + cos).
    // \alpha\beta is fine because \ is not [a-zA-Z].
    // CRITICAL: the regex backtracks inside long commands — e.g. for \begin{ it matches
    // \begi (lookahead n), not \begin (lookahead {). We re-derive the GREEDY (full)
    // command from the match offset and skip splitting if it's in the NOSPLIT set.
    const NOSPLIT = new Set([
      'operatorname', 'mathrm', 'mathbf', 'mathit', 'mathsf', 'mathtt', 'mathbb',
      'mathcal', 'mathfrak', 'mathscr', 'boldsymbol', 'text', 'mbox',
      'begin', 'end', 'left', 'right', 'bigl', 'bigr', 'Bigl', 'Bigr', 'biggl', 'biggr',
      'overline', 'underline', 'widehat', 'widetilde', 'overbrace', 'underbrace',
      'sqrt', 'frac', 'tfrac', 'dfrac', 'cfrac', 'binom', 'tbinom', 'dbinom',
      'hat', 'check', 'breve', 'acute', 'grave', 'tilde', 'bar', 'vec', 'dot', 'ddot',
      'phantom', 'vphantom', 'hphantom', 'smash', 'boxed',
      'quad', 'qquad', 'hspace', 'vspace',
    ])
    const debled = trimmed.replace(/\\([a-zA-Z]+)(?=[a-zA-Z])/g, (match, _cmd, offset: number, str: string) => {
      // Re-derive the FULL greedy command to avoid splitting inside \begin, \frac etc.
      const greedyCmd = str.slice(offset + 1).match(/^[a-zA-Z]+/)?.[0] ?? _cmd
      return NOSPLIT.has(greedyCmd) ? match : `\\${_cmd}{}`
    })
    // Post-process step 2: normalize bare math function names to their \command form.
    // Word sometimes writes cos⁡α as plain m:r text rather than inside m:func.
    // Longer names first to prevent partial matches (arccos before cos).
    // Lookbehind (?<![\\a-zA-Z]) prevents re-converting already-converted \cos.
    // Lookahead  (?![a-zA-Z])    prevents partial matches inside longer words.
    const funcRe = /(?<![\\a-zA-Z])(arcsin|arccos|arctan|arccot|arcsec|arccsc|sinh|cosh|tanh|coth|sin|cos|tan|cot|sec|csc|exp|ln|log|det|arg|dim|ker|deg|lim|liminf|limsup|max|min|inf|sup|gcd|lcm|Pr)(?![a-zA-Z])/g
    const normalized = debled.replace(funcRe, '\\$1')
    return normalized || null
  } catch {
    return null
  }
}

// ─── End OMML → LaTeX conversion ───────────────────────────────────────────

function buildOmmlFromLatexHeuristics(latex: string): string | null {
  const normalized = normalizeLatex(latex)
  if (!normalized) return null

  const alignedMatch = normalized.match(/^\\left(?<open>.?)\\begin\{aligned\}(?<body>[\s\S]+)\\end\{aligned\}\\right(?<close>.?)$/)
  if (alignedMatch?.groups) {
    const rows = splitLatexAlignedRows(alignedMatch.groups.body).map((row) => buildOmmlFromLatexHeuristics(row) || wrapMathRun(row))
    return buildDelimiterOmml(alignedMatch.groups.open || '(', alignedMatch.groups.close || ')', buildEquationArrayOmml(rows))
  }

  const delimiterMatch = normalized.match(/^\\left(?<open>.)(?<body>[\s\S]+)\\right(?<close>.)$/)
  if (delimiterMatch?.groups) {
    const inner = buildOmmlFromLatexHeuristics(delimiterMatch.groups.body) || wrapMathRun(unwrapLatexBraces(delimiterMatch.groups.body))
    return buildDelimiterOmml(delimiterMatch.groups.open, delimiterMatch.groups.close, inner)
  }

  const naryMatch = normalized.match(/^\\(?<op>sum|prod|coprod|int|iint|iiint|oint)(?:_\{(?<sub>[^}]*)\}|_(?<subInline>\S+))?(?:\^\{(?<sup>[^}]*)\}|\^(?<supInline>\S+))?\s*(?<body>[\s\S]+)$/)
  if (naryMatch?.groups) {
    const sub = naryMatch.groups.sub || naryMatch.groups.subInline || ''
    const sup = naryMatch.groups.sup || naryMatch.groups.supInline || ''
    const body = naryMatch.groups.body || ''
    const bodyOmml = buildOmmlFromLatexHeuristics(body) || wrapMathRun(unwrapLatexBraces(body))
    const subOmml = sub ? (buildOmmlFromLatexHeuristics(sub) || wrapMathRun(unwrapLatexBraces(sub))) : ''
    const supOmml = sup ? (buildOmmlFromLatexHeuristics(sup) || wrapMathRun(unwrapLatexBraces(sup))) : ''
    return buildNaryOmml(latexCommandToSymbol(naryMatch.groups.op), bodyOmml, subOmml, supOmml)
  }

  const accentSubMatch = normalized.match(/^\\(?<accent>hat|widehat|bar|overline|tilde|widetilde|vec|dot|ddot)\{(?<base>[^}]*)\}(?:_\{(?<sub>[^}]*)\}|_(?<subInline>\S+))?$/)
  if (accentSubMatch?.groups) {
    const base = buildAccentOmml(wrapMathRun(accentSubMatch.groups.base), latexAccentToSymbol(accentSubMatch.groups.accent))
    const sub = accentSubMatch.groups.sub || accentSubMatch.groups.subInline || ''
    return sub ? `<m:sSub><m:e>${base}</m:e><m:sub>${wrapMathRun(unwrapLatexBraces(sub))}</m:sub></m:sSub>` : base
  }

  const accentMatch = normalized.match(/^\\(?<accent>hat|widehat|bar|overline|tilde|widetilde|vec|dot|ddot)\{(?<base>[^}]*)\}$/)
  if (accentMatch?.groups) {
    return buildAccentOmml(wrapMathRun(accentMatch.groups.base), latexAccentToSymbol(accentMatch.groups.accent))
  }

  return null
}

function convertMathMlNodeToOmml(name: string, value: unknown): string {
  if (typeof value === 'string') {
    return wrapMathRun(value)
  }
  const node = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const children = getNodeChildren(node)

  switch (name) {
    case 'math':
    case 'mrow':
    case 'semantics':
    case 'annotation':
    case 'annotation-xml':
    case 'mstyle':
      if (name === 'mrow' && children.length >= 2) {
        const first = children[0]
        const last = children[children.length - 1]
        const firstText = first ? getNodeText(first.value).trim() : ''
        const lastText = last ? getNodeText(last.value).trim() : ''
        if (first?.name === 'mo' && last?.name === 'mo' && isDelimiterSymbol(firstText) && isDelimiterSymbol(lastText)) {
          const inner = children.slice(1, -1).map((child) => convertMathMlNodeToOmml(child.name, child.value)).join('')
          return buildDelimiterOmml(firstText, lastText, inner)
        }
      }
      return children.map((child) => convertMathMlNodeToOmml(child.name, child.value)).join('')
    case 'mi':
    case 'mn':
    case 'mo':
    case 'mtext':
      return wrapMathRun(getNodeText(node))
    case 'msup': {
      const [base, sup] = children
      return `<m:sSup><m:e>${base ? convertMathMlNodeToOmml(base.name, base.value) : ''}</m:e><m:sup>${sup ? convertMathMlNodeToOmml(sup.name, sup.value) : ''}</m:sup></m:sSup>`
    }
    case 'msub': {
      const [base, sub] = children
      return `<m:sSub><m:e>${base ? convertMathMlNodeToOmml(base.name, base.value) : ''}</m:e><m:sub>${sub ? convertMathMlNodeToOmml(sub.name, sub.value) : ''}</m:sub></m:sSub>`
    }
    case 'msubsup': {
      const [base, sub, sup] = children
      return `<m:sSubSup><m:e>${base ? convertMathMlNodeToOmml(base.name, base.value) : ''}</m:e><m:sub>${sub ? convertMathMlNodeToOmml(sub.name, sub.value) : ''}</m:sub><m:sup>${sup ? convertMathMlNodeToOmml(sup.name, sup.value) : ''}</m:sup></m:sSubSup>`
    }
    case 'mfrac': {
      const [num, den] = children
      return `<m:f><m:num>${num ? convertMathMlNodeToOmml(num.name, num.value) : ''}</m:num><m:den>${den ? convertMathMlNodeToOmml(den.name, den.value) : ''}</m:den></m:f>`
    }
    case 'msqrt': {
      const body = children.map((child) => convertMathMlNodeToOmml(child.name, child.value)).join('')
      return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:e>${body}</m:e></m:rad>`
    }
    case 'mroot': {
      const [body, degree] = children
      return `<m:rad><m:deg>${degree ? convertMathMlNodeToOmml(degree.name, degree.value) : ''}</m:deg><m:e>${body ? convertMathMlNodeToOmml(body.name, body.value) : ''}</m:e></m:rad>`
    }
    case 'mover': {
      const [base, over] = children
      const overText = over ? getNodeText(over.value).trim() : ''
      if (overText && ['^', 'ˆ', 'ˇ', '¯', 'ˉ', '~', '˜', '˙', '¨', '→', '←'].includes(overText)) {
        return buildAccentOmml(base ? convertMathMlNodeToOmml(base.name, base.value) : '', overText)
      }
      return `<m:limUpp><m:e>${base ? convertMathMlNodeToOmml(base.name, base.value) : ''}</m:e><m:lim>${over ? convertMathMlNodeToOmml(over.name, over.value) : ''}</m:lim></m:limUpp>`
    }
    case 'munder': {
      const [base, under] = children
      const baseText = base ? getNodeText(base.value).trim() : ''
      if (baseText && isNaryOperator(baseText)) {
        return buildNaryOmml(baseText, '', under ? convertMathMlNodeToOmml(under.name, under.value) : '', '')
      }
      return `<m:limLow><m:e>${base ? convertMathMlNodeToOmml(base.name, base.value) : ''}</m:e><m:lim>${under ? convertMathMlNodeToOmml(under.name, under.value) : ''}</m:lim></m:limLow>`
    }
    case 'munderover': {
      const [base, under, over] = children
      const baseText = base ? getNodeText(base.value).trim() : ''
      if (baseText && isNaryOperator(baseText)) {
        return buildNaryOmml(baseText, '', under ? convertMathMlNodeToOmml(under.name, under.value) : '', over ? convertMathMlNodeToOmml(over.name, over.value) : '')
      }
      const lower = `<m:limLow><m:e>${base ? convertMathMlNodeToOmml(base.name, base.value) : ''}</m:e><m:lim>${under ? convertMathMlNodeToOmml(under.name, under.value) : ''}</m:lim></m:limLow>`
      return `<m:limUpp><m:e>${lower}</m:e><m:lim>${over ? convertMathMlNodeToOmml(over.name, over.value) : ''}</m:lim></m:limUpp>`
    }
    case 'mfenced': {
      const open = String(node.open || '(')
      const close = String(node.close || ')')
      const body = children.map((child) => convertMathMlNodeToOmml(child.name, child.value)).join('')
      return buildDelimiterOmml(open, close, body)
    }
    case 'mtable': {
      const rows = children.filter((child) => child.name === 'mtr')
      const rowCells = rows.map((child) => getNodeChildren((child.value && typeof child.value === 'object' ? child.value : {}) as Record<string, unknown>).filter((entry) => entry.name === 'mtd'))
      const isAligned = rowCells.some((cells) => cells.length > 1) && rowCells.some((cells) => cells.some((cell) => /[=<>≤≥≈]/.test(getNodeText(cell.value))))
      if (isAligned) {
        const eqRows = rowCells.map((cells) => cells.map((cell) => convertMathMlNodeToOmml(cell.name, cell.value)).join(wrapMathRun(' ')))
        return buildEquationArrayOmml(eqRows)
      }
      const matrixRows = rows.map((child) => convertMathMlNodeToOmml(child.name, child.value)).join('')
      return `<m:m><m:mPr/>${matrixRows}</m:m>`
    }
    case 'mtr': {
      const cells = children.filter((child) => child.name === 'mtd').map((child) => `<m:e>${convertMathMlNodeToOmml(child.name, child.value)}</m:e>`).join('')
      return `<m:mr>${cells}</m:mr>`
    }
    case 'mtd':
      return children.map((child) => convertMathMlNodeToOmml(child.name, child.value)).join('')
    case 'mspace':
      return wrapMathRun(' ')
    default: {
      const text = getNodeText(node).trim()
      if (text) return wrapMathRun(text)
      return children.map((child) => convertMathMlNodeToOmml(child.name, child.value)).join('')
    }
  }
}

function buildOmmlFromLatex(latex: string, displayMode: 'inline' | 'block'): string {
  const heuristicOmml = buildOmmlFromLatexHeuristics(latex)
  if (heuristicOmml) {
    return displayMode === 'block' ? `<m:oMathPara><m:oMath>${heuristicOmml}</m:oMath></m:oMathPara>` : `<m:oMath>${heuristicOmml}</m:oMath>`
  }

  const mathMl = renderFormulaMathMl(latex, displayMode === 'block')
  if (!mathMl) {
    const fallbackRun = wrapMathRun(latex)
    return displayMode === 'block' ? `<m:oMathPara><m:oMath>${fallbackRun}</m:oMath></m:oMathPara>` : `<m:oMath>${fallbackRun}</m:oMath>`
  }

  try {
    const parsed = xmlParser.parse(mathMl) as { math?: Record<string, unknown> }
    const inner = parsed?.math ? convertMathMlNodeToOmml('math', parsed.math) : wrapMathRun(latex)
    return displayMode === 'block' ? `<m:oMathPara><m:oMath>${inner}</m:oMath></m:oMathPara>` : `<m:oMath>${inner}</m:oMath>`
  } catch {
    const fallbackRun = wrapMathRun(latex)
    return displayMode === 'block' ? `<m:oMathPara><m:oMath>${fallbackRun}</m:oMath></m:oMathPara>` : `<m:oMath>${fallbackRun}</m:oMath>`
  }
}

function buildBlockMarker(block: OoxmlBlockSnapshot): string {
  switch (block.kind) {
    case 'heading':
      return `${'#'.repeat(Math.max(1, Math.min(block.level || 1, 6)))} ${block.text}`.trim()
    case 'page-break':
      return '[分页符]'
    case 'section-break':
      return `[分节符: ${block.sectionType || 'nextPage'}]`
    case 'image-placeholder':
      return `[图片占位: ${block.alt || block.title || block.text || 'image'}]`
    case 'formula-placeholder':
      return `[公式占位: ${block.latex || block.text || '公式'}]`
    case 'table-placeholder':
      return `[表格占位: ${Math.max(1, block.rows || block.cells?.length || 1)}x${Math.max(1, block.columns || Math.max(...(block.cells || [['']]).map((row) => row.length || 1)) || 1)}]`
    default:
      return block.text
  }
}

function blocksToPlainText(blocks: OoxmlBlockSnapshot[]): string {
  return blocks.map((block) => buildBlockMarker(block)).filter(Boolean).join('\n\n').trim()
}

function blocksToHtml(blocks: OoxmlBlockSnapshot[]): string {
  if (!blocks.length) return '<p></p>'

  return blocks.map((block) => {
    const marker = escapeHtmlText(buildBlockMarker(block))
    switch (block.kind) {
      case 'heading': {
        const level = Math.max(1, Math.min(block.level || 1, 6))
        const semanticRole = inferSemanticRoleFromBlock(block)
        const paperStyle = block.paperStyle || undefined
        return `<h${level} data-ooxml-block="heading" data-level="${level}" data-paragraph-style="${escapeHtmlText(block.paragraphStyle || `Heading${level}`)}" data-paper-style="${escapeHtmlText(paperStyle || '')}"${semanticRole ? ` data-semantic-role="${escapeHtmlText(semanticRole)}"` : ''} data-alignment="${escapeHtmlText(block.alignment || '')}" data-indent-level="${escapeHtmlText(String(block.indentLevel ?? ''))}" data-list-type="${escapeHtmlText(block.listType || '')}" data-list-level="${escapeHtmlText(String(block.listLevel ?? ''))}" data-source-xml="${encodeStructuredData(block.sourceXml || '')}"${paperStyle ? ` style="${escapeHtmlText(paperStyle)}"` : ''}>${renderInlineRunsHtml(block.inlineRuns, block.text)}</h${level}>`
      }
      case 'image-placeholder':
        return `<div data-ooxml-object="image" data-alt="${escapeHtmlText(block.alt || '')}" data-title="${escapeHtmlText(block.title || '')}" data-source-id="${escapeHtmlText(block.sourceId || '')}" data-source-xml="${encodeStructuredData(block.sourceXml || '')}" data-relationship-id="${escapeHtmlText(block.relationshipId || '')}" data-media-path="${escapeHtmlText(block.mediaPath || '')}" data-media-content-type="${escapeHtmlText(block.mediaContentType || '')}" data-preview-src="${escapeHtmlText(block.previewSrc || '')}" data-drawing-layout="${escapeHtmlText(block.drawingLayout || '')}" data-image-width-emu="${escapeHtmlText(String(block.imageWidthEmu || ''))}" data-image-height-emu="${escapeHtmlText(String(block.imageHeightEmu || ''))}" data-image-width-px="${escapeHtmlText(String(block.imageWidthPx || ''))}" data-image-height-px="${escapeHtmlText(String(block.imageHeightPx || ''))}" data-alignment="${escapeHtmlText(block.alignment || '')}" data-anchor-horizontal="${escapeHtmlText(block.anchorHorizontal || '')}" data-anchor-vertical="${escapeHtmlText(block.anchorVertical || '')}" data-wrap-type="${escapeHtmlText(block.wrapType || '')}">${block.previewSrc ? `<img src="${escapeHtmlText(block.previewSrc)}" alt="${escapeHtmlText(block.alt || block.title || 'image')}" />` : marker}</div>`
      case 'formula-placeholder':
        return (() => {
          const latex = block.latex || block.text || ''
          const displayMode = block.formulaDisplay || 'block'
          const tag = displayMode === 'inline' ? 'span' : 'div'
          const className = displayMode === 'inline' ? 'formula-node formula-inline' : 'formula-node formula-block'
          const preview = renderFormulaPreviewHtml(latex, displayMode === 'block')
          return `<${tag} data-ooxml-object="formula" data-formula-node="true" data-formula-display="${escapeHtmlText(displayMode)}" data-latex="${escapeHtmlText(latex)}" data-mathml="${encodeStructuredData(block.mathml || '')}" data-source-id="${escapeHtmlText(block.sourceId || '')}" data-source-xml="${encodeStructuredData(block.sourceXml || '')}" class="${className}">${preview || marker}</${tag}>`
        })()
      case 'table-placeholder':
        return `<table data-ooxml-object="table" data-rows="${Math.max(1, block.rows || block.tableRows?.length || block.cells?.length || 1)}" data-cols="${Math.max(1, block.columns || Math.max(...normalizeTableRows(block.tableRows, block.cells).map((row) => row.reduce((total, cell) => Math.max(total, (cell.column || 0) + Math.max(1, cell.colspan || 1)), 0))) || 1)}"><tbody>${normalizeTableRows(block.tableRows, block.cells).map((row) => `<tr>${row.map((cell) => {
          const tag = cell.header ? 'th' : 'td'
          const attrs = [
            cell.colspan && cell.colspan > 1 ? ` colspan="${cell.colspan}"` : '',
            cell.rowspan && cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : '',
            ` data-column="${cell.column || 0}"`,
            cell.width ? ` data-width="${escapeHtmlText(cell.width)}"` : '',
            cell.paragraphs?.length ? ` data-paragraphs="${encodeStructuredData(cell.paragraphs)}"` : '',
          ].join('')
          const inner = (cell.paragraphs?.length ? cell.paragraphs : [{ text: cell.text }]).map((paragraph) => {
            if (paragraph.level) {
              const level = Math.max(1, Math.min(paragraph.level, 6))
              return `<h${level}>${escapeHtmlText(paragraph.text)}</h${level}>`
            }
            if (paragraph.sourceXml && (paragraph.sourceXml.includes('<m:oMath') || paragraph.sourceXml.includes('<m:oMathPara'))) {
              const fLatex = extractFormulaText(paragraph.sourceXml)
              const fDisplay = extractFormulaDisplayMode(paragraph.sourceXml)
              const fMathml = renderFormulaMathMl(fLatex, fDisplay === 'block')
              const fPreview = renderFormulaPreviewHtml(fLatex, fDisplay === 'block')
              return `<div data-formula-node="true" data-ooxml-object="formula" data-formula-display="${escapeHtmlText(fDisplay)}" data-latex="${escapeHtmlText(fLatex)}" data-mathml="${encodeStructuredData(fMathml || '')}" data-source-xml="${encodeStructuredData(paragraph.sourceXml)}">${fPreview || escapeHtmlText(fLatex)}</div>`
            }
            return `<p>${escapeHtmlText(paragraph.text).replace(/\n/g, '<br />')}</p>`
          }).join('') || '<p></p>'
          return `<${tag}${attrs}>${inner}</${tag}>`
        }).join('')}</tr>`).join('')}</tbody></table>`
      case 'page-break':
        return `<div data-ooxml-object="page-break" data-source-xml="${encodeStructuredData(block.sourceXml || '')}" data-has-manual-page-break="true">分页符</div>`
      case 'section-break':
        return `<div data-ooxml-object="section-break" data-section-type="${escapeHtmlText(block.sectionType || 'nextPage')}" data-section-properties-xml="${encodeStructuredData(block.sectionPropertiesXml || '')}" data-section-break-xml="${encodeStructuredData(block.sectionBreakXml || block.sourceXml || '')}" data-has-manual-page-break="${block.hasManualPageBreak ? 'true' : 'false'}">${escapeHtmlText(block.text || '分节符')}</div>`
      default:
        return (() => {
          const semanticRole = inferSemanticRoleFromBlock(block)
          const paperStyle = block.paperStyle || undefined
          return `<p data-ooxml-block="paragraph" data-paragraph-style="${escapeHtmlText(block.paragraphStyle || '')}" data-paper-style="${escapeHtmlText(paperStyle || '')}"${semanticRole ? ` data-semantic-role="${escapeHtmlText(semanticRole)}"` : ''} data-alignment="${escapeHtmlText(block.alignment || '')}" data-indent-level="${escapeHtmlText(String(block.indentLevel ?? ''))}" data-list-type="${escapeHtmlText(block.listType || '')}" data-list-level="${escapeHtmlText(String(block.listLevel ?? ''))}" data-source-xml="${encodeStructuredData(block.sourceXml || '')}"${paperStyle ? ` style="${escapeHtmlText(paperStyle)}"` : ''}>${renderInlineRunsHtml(block.inlineRuns, block.text)}</p>`
        })()
    }
  }).join('')
}

function findMatchingTableEnd(source: string, startIndex: number): number {
  const tagRegex = /<\/?w:tbl\b[^>]*>/g
  tagRegex.lastIndex = startIndex
  let depth = 0
  for (let match = tagRegex.exec(source); match; match = tagRegex.exec(source)) {
    const isClosing = match[0].startsWith('</')
    depth += isClosing ? -1 : 1
    if (depth === 0) {
      return match.index + match[0].length
    }
  }
  return source.length
}

function splitBodyElements(documentXml: string): { prefix: string; elements: BodyElementSnapshot[]; suffix: string } {
  const bodyMatch = documentXml.match(/([\s\S]*?<w:body[^>]*>)([\s\S]*?)(<\/w:body>[\s\S]*)/)
  if (!bodyMatch) {
    return { prefix: '', elements: [], suffix: documentXml }
  }

  const prefix = bodyMatch[1]
  const bodyContent = bodyMatch[2]
  const suffix = bodyMatch[3]
  const elements: BodyElementSnapshot[] = []
  let cursor = 0

  while (cursor < bodyContent.length) {
    const paragraphIndex = bodyContent.indexOf('<w:p', cursor)
    const tableIndex = bodyContent.indexOf('<w:tbl', cursor)
    const sectionIndex = bodyContent.indexOf('<w:sectPr', cursor)
    const candidates = [paragraphIndex, tableIndex, sectionIndex].filter((value) => value >= 0)
    if (!candidates.length) break

    const nextIndex = Math.min(...candidates)
    if (bodyContent.startsWith('<w:tbl', nextIndex)) {
      const endIndex = findMatchingTableEnd(bodyContent, nextIndex)
      elements.push({ type: 'table', xml: bodyContent.slice(nextIndex, endIndex) })
      cursor = endIndex
      continue
    }

    if (bodyContent.startsWith('<w:sectPr', nextIndex)) {
      const endIndex = bodyContent.indexOf('</w:sectPr>', nextIndex)
      const stop = endIndex >= 0 ? endIndex + '</w:sectPr>'.length : bodyContent.length
      elements.push({ type: 'section', xml: bodyContent.slice(nextIndex, stop) })
      cursor = stop
      continue
    }

    const endIndex = bodyContent.indexOf('</w:p>', nextIndex)
    const stop = endIndex >= 0 ? endIndex + '</w:p>'.length : bodyContent.length
    elements.push({ type: 'paragraph', xml: bodyContent.slice(nextIndex, stop) })
    cursor = stop
  }

  return { prefix, elements, suffix }
}

// 识别 AI Writer 自己写回的明文公式标记（用户可能直接反导入这种 docx）。
const BLOCK_LATEX_PATTERN = /^\s*\[LaTeX-BLOCK\]([\s\S]+?)\[\/LaTeX-BLOCK\]\s*$/
const INLINE_LATEX_PATTERN = /\[LaTeX\]([\s\S]+?)\[\/LaTeX\]/g

function splitPlaintextLatexMarkers(text: string): OoxmlInlineRunSnapshot[] | undefined {
  if (!text || !/\[LaTeX\]/.test(text)) return undefined
  const runs: OoxmlInlineRunSnapshot[] = []
  let cursor = 0
  INLINE_LATEX_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = INLINE_LATEX_PATTERN.exec(text)) !== null) {
    if (match.index > cursor) runs.push({ text: text.slice(cursor, match.index) })
    const latex = match[1].trim()
    runs.push({ text: latex, formulaLatex: latex })
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) runs.push({ text: text.slice(cursor) })
  return runs.length ? runs : undefined
}

function expandInlineLatexInRuns(runs: OoxmlInlineRunSnapshot[] | undefined, paragraphText: string): OoxmlInlineRunSnapshot[] | undefined {
  if (!runs?.length) return splitPlaintextLatexMarkers(paragraphText)
  let hasMarker = false
  const expanded: OoxmlInlineRunSnapshot[] = []
  for (const run of runs) {
    if (run.formulaLatex || !run.text || !/\[LaTeX\]/.test(run.text)) {
      expanded.push(run)
      continue
    }
    const segments = splitPlaintextLatexMarkers(run.text)
    if (!segments) { expanded.push(run); continue }
    hasMarker = true
    segments.forEach((segment) => {
      if (segment.formulaLatex) {
        expanded.push({ text: segment.text, formulaLatex: segment.formulaLatex, style: run.style })
      } else if (segment.text) {
        expanded.push({ text: segment.text, style: run.style })
      }
    })
  }
  return hasMarker ? expanded : runs
}

async function paragraphToBlock(paragraphXml: string, index: number, context: OoxmlReadContext): Promise<OoxmlBlockSnapshot> {
  const rawText = extractTextFromParagraphXml(paragraphXml).trim()
  // 如果整段就是一个 [LaTeX-BLOCK]...[/LaTeX-BLOCK]，直接识别为公式块。
  const blockLatexMatch = rawText.match(BLOCK_LATEX_PATTERN)
  if (blockLatexMatch) {
    const latex = blockLatexMatch[1].trim()
    return {
      index,
      kind: 'formula-placeholder',
      text: latex,
      latex,
      formulaDisplay: 'block',
      mathml: renderFormulaMathMl(latex, true),
      sourceId: `formula-${index}`,
      sourceXml: paragraphXml,
    }
  }
  const text = rawText
  const fieldInstructions = extractWordFieldInstructions(paragraphXml)
  const citationSourceTags = Array.from(new Set(fieldInstructions.flatMap((instruction) => extractCitationSourceTagsFromInstruction(instruction))))
  const headingLevel = extractHeadingLevel(paragraphXml)
  const paragraphStyle = normalizeParagraphStyleForBlock(extractParagraphStyleId(paragraphXml), headingLevel)
  const paperStyle = extractParagraphPaperStyle(paragraphXml)
  const inlineRuns = expandInlineLatexInRuns(extractInlineRunsFromParagraphXml(paragraphXml), text)
  const sectionPropertiesXml = extractSectionPropertiesXml(paragraphXml)
  const sectionType = extractSectionType(sectionPropertiesXml)
  const hasManualPageBreak = paragraphContainsManualPageBreak(paragraphXml)
  const alignment = extractParagraphAlignment(paragraphXml)
  const indentLevel = extractParagraphIndentLevel(paragraphXml)
  const listInfo = extractParagraphListInfo(paragraphXml, context.numberingFormats)
  if (sectionPropertiesXml) {
    return {
      index,
      kind: 'section-break',
      text: sectionType === 'continuous' ? '分节符 · 连续' : sectionType === 'evenPage' ? '分节符 · 偶数页' : sectionType === 'oddPage' ? '分节符 · 奇数页' : '分节符 · 下一页',
      sectionType,
      sectionPropertiesXml,
      sectionBreakXml: paragraphXml,
      hasManualPageBreak,
      sourceXml: paragraphXml,
      fieldInstructions: fieldInstructions.length ? fieldInstructions : undefined,
      citationSourceTags: citationSourceTags.length ? citationSourceTags : undefined,
    }
  }
  if (paragraphIsPureManualPageBreak(paragraphXml)) {
    return {
      index,
      kind: 'page-break',
      text: '分页符',
      hasManualPageBreak: true,
      sourceXml: paragraphXml,
    }
  }
  if (paragraphXml.includes('<w:drawing') || paragraphXml.includes('<pic:pic')) {
    const image = extractImageInfo(paragraphXml)
    const drawing = extractDrawingInfo(paragraphXml)
    const relationshipId = extractRelationshipId(paragraphXml)
    const relationship = relationshipId ? context.relationships.get(relationshipId) : undefined
    const mediaPath = relationship ? resolveRelationshipTarget(relationship.target) : undefined
    const mediaContentType = mediaPath ? getExtensionContentType(context.contentTypesXml, mediaPath) || undefined : undefined
    const previewSrc = mediaPath ? await readZipEntryAsDataUrl(context.zip, mediaPath, mediaContentType || null) : undefined
    return {
      index,
      kind: 'image-placeholder',
      text,
      alt: image.alt || undefined,
      title: image.title || undefined,
      relationshipId,
      mediaPath,
      mediaContentType,
      previewSrc,
      drawingLayout: drawing.drawingLayout,
      imageWidthEmu: drawing.imageWidthEmu,
      imageHeightEmu: drawing.imageHeightEmu,
      imageWidthPx: drawing.imageWidthPx,
      imageHeightPx: drawing.imageHeightPx,
      anchorHorizontal: drawing.anchorHorizontal,
      anchorVertical: drawing.anchorVertical,
      wrapType: drawing.wrapType,
      imageCropRect: drawing.imageCropRect,
      sourceId: image.objectId || `image-${index}`,
      sourceXml: paragraphXml,
      fieldInstructions: fieldInstructions.length ? fieldInstructions : undefined,
      citationSourceTags: citationSourceTags.length ? citationSourceTags : undefined,
    }
  }
  if (paragraphXml.includes('<m:oMath') || paragraphXml.includes('<m:oMathPara')) {
    // Only classify as pure formula-placeholder when the paragraph contains NO non-formula text runs.
    // Mixed paragraphs (formula embedded in a sentence) are preserved as paragraph blocks with sourceXml.
    const hasNonFormulaText = (() => {
      // Strip formula and metadata runs, then check if any w:t remains
      const stripped = paragraphXml
        .replace(/<m:oMathPara\b[\s\S]*?<\/m:oMathPara>/gi, '')
        .replace(/<m:oMath\b[\s\S]*?<\/m:oMath>/gi, '')
        .replace(new RegExp(`<w:r\\b[^>]*>[\\s\\S]*?${FORMULA_METADATA_PREFIX}[\\s\\S]*?<\\/w:r>`, 'gi'), '')
      return /<w:t(?:\s+[^>]*)?>[\s\S]*?<\/w:t>/i.test(stripped)
    })()
    if (!hasNonFormulaText) {
      const formulaText = extractFormulaText(paragraphXml)
      const formulaDisplay = extractFormulaDisplayMode(paragraphXml)
      return {
        index,
        kind: 'formula-placeholder',
        text: formulaText,
        latex: formulaText,
        formulaDisplay,
        mathml: renderFormulaMathMl(formulaText, formulaDisplay === 'block'),
        sourceId: extractFormulaObjectId(paragraphXml) || `formula-${index}`,
        sourceXml: paragraphXml,
        fieldInstructions: fieldInstructions.length ? fieldInstructions : undefined,
        citationSourceTags: citationSourceTags.length ? citationSourceTags : undefined,
      }
    }
    // Mixed formula+text paragraph — preserve as paragraph block with sourceXml intact
  }
  if (headingLevel) {
    return {
      index,
      kind: 'heading',
      text,
      level: headingLevel,
      paragraphStyle,
      paperStyle,
      inlineRuns,
      alignment,
      indentLevel,
      listType: listInfo.listType,
      listLevel: listInfo.listLevel,
      sourceXml: paragraphXml,
      fieldInstructions: fieldInstructions.length ? fieldInstructions : undefined,
      citationSourceTags: citationSourceTags.length ? citationSourceTags : undefined,
    }
  }
  return {
    index,
    kind: 'paragraph',
    text,
    paragraphStyle,
    paperStyle,
    inlineRuns,
    alignment,
    indentLevel,
    listType: listInfo.listType,
    listLevel: listInfo.listLevel,
    sourceXml: paragraphXml,
    fieldInstructions: fieldInstructions.length ? fieldInstructions : undefined,
    citationSourceTags: citationSourceTags.length ? citationSourceTags : undefined,
  }
}

function tableToBlock(tableXml: string, index: number): OoxmlBlockSnapshot {
  const dimensions = extractTableDimensions(tableXml)
  const cells = extractTableCells(tableXml)
  const tableRows = extractStructuredTableRows(tableXml)
  return {
    index,
    kind: 'table-placeholder',
    text: `表格占位 ${dimensions.rows}x${dimensions.columns}`,
    rows: dimensions.rows,
    columns: dimensions.columns,
    cells,
    tableRows,
  }
}

async function deriveBlocksFromDocumentXml(documentXml: string, context: OoxmlReadContext): Promise<OoxmlBlockSnapshot[]> {
  const { elements } = splitBodyElements(documentXml)
  const blocks: OoxmlBlockSnapshot[] = []
  for (const element of elements) {
    if (element.type === 'section') continue
    blocks.push(element.type === 'table' ? tableToBlock(element.xml, blocks.length) : await paragraphToBlock(element.xml, blocks.length, context))
  }
  return blocks
}

function classifyParagraphKind(paragraphXml: string): OoxmlBlockKind | 'unknown' {
  if (paragraphXml.includes('<w:drawing') || paragraphXml.includes('<pic:pic')) return 'image-placeholder'
  if (paragraphXml.includes('<m:oMath') || paragraphXml.includes('<m:oMathPara')) return 'formula-placeholder'
  if (extractHeadingLevel(paragraphXml)) return 'heading'
  return 'paragraph'
}

function toParagraphSnapshots(blocks: OoxmlBlockSnapshot[]): OoxmlParagraphSnapshot[] {
  return blocks
    .filter((block) => block.kind === 'heading' || block.kind === 'paragraph')
    .map((block, index) => ({ index, text: block.text }))
}

function convertSpecialHtmlBlocks(html: string): string {
  const protectedBlocks: string[] = []
  const protectedSource = String(html || '').replace(/<(div|span|table)\b[^>]*data-ooxml-object="(?:image|formula|table)"[^>]*>[\s\S]*?<\/\1>/gi, (match) => {
    const token = `__AI_WRITER_OOXML_BLOCK_${protectedBlocks.length}__`
    protectedBlocks.push(match)
    return token
  })

  const parsePixelValue = (value: string | null | undefined): number | undefined => {
    const normalized = String(value || '').trim()
    if (!normalized) return undefined
    const match = normalized.match(/(\d+(?:\.\d+)?)\s*px/i) || normalized.match(/^(\d+(?:\.\d+)?)$/)
    if (!match) return undefined
    const parsed = Number(match[1])
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined
  }

  const readStyleValue = (styleText: string | null | undefined, propertyName: string): string | undefined => {
    const normalized = String(styleText || '')
    if (!normalized) return undefined
    const match = normalized.match(new RegExp(`${propertyName}\\s*:\\s*([^;]+)`, 'i'))
    return match?.[1]?.trim() || undefined
  }

  const normalizeImageAlignment = (value: string | null | undefined): 'left' | 'center' | 'right' | undefined => {
    const normalized = String(value || '').trim().toLowerCase()
    if (normalized === 'left' || normalized === 'center' || normalized === 'right') return normalized
    return undefined
  }

  const convertHtmlListBlock = (tagName: string, attrs: string, innerHtml: string): string => {
    const listType = String(tagName || '').toLowerCase() === 'ol' ? 'number' : 'bullet'
    const className = String(getAttr(attrs, 'class') || '')
    const listLevel = Math.max(0, Number(getAttr(attrs, 'data-list-level') || 0) || 0)
    const isReferenceList = /(^|\s)references-list(\s|$)/i.test(className)
    const itemMatches = Array.from(String(innerHtml || '').matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/gi))
    if (!itemMatches.length) return ''

    return itemMatches.map((itemMatch) => {
      const itemAttrs = itemMatch[1] || ''
      const rawItemHtml = String(itemMatch[2] || '').trim()
      const normalizedItemHtml = isReferenceList
        ? rawItemHtml.replace(/^\s*(?:\[\d+\]|\d+[.)])\s+/, '')
        : rawItemHtml
      const itemLevel = Math.max(0, listLevel + (Number(getAttr(itemAttrs, 'data-list-level') || 0) || 0))
      const itemText = stripHtml(normalizedItemHtml).trim()
      if (!itemText) return ''

      const paragraphAttrs = [
        'data-ooxml-block="paragraph"',
        `data-list-type="${escapeHtmlText(listType)}"`,
        `data-list-level="${itemLevel}"`,
        isReferenceList ? 'data-paragraph-style="Reference"' : '',
        isReferenceList ? 'data-semantic-role="reference-item"' : '',
      ].filter(Boolean).join(' ')

      return `<p ${paragraphAttrs}>${normalizedItemHtml}</p>`
    }).join('')
  }

  const buildGenericImageBlock = (attrs: string, fallbackAlt?: string, options?: { alignment?: 'left' | 'center' | 'right'; caption?: string }) => {
    const src = getAttr(attrs, 'src') || ''
    const alt = getAttr(attrs, 'alt') || getAttr(attrs, 'title') || fallbackAlt || 'image'
    const title = getAttr(attrs, 'title') || options?.caption || ''
    const styleText = getAttr(attrs, 'style') || ''
    const width = parsePixelValue(getAttr(attrs, 'data-width-px')) || parsePixelValue(getAttr(attrs, 'width')) || parsePixelValue(readStyleValue(styleText, 'width'))
    const height = parsePixelValue(getAttr(attrs, 'data-height-px')) || parsePixelValue(getAttr(attrs, 'height')) || parsePixelValue(readStyleValue(styleText, 'height'))
    const alignment = options?.alignment || normalizeImageAlignment(getAttr(attrs, 'data-alignment'))
    // Propagate OOXML pass-through attributes that TipTap's RichImage preserves through round-trip.
    const ooxmlSourceXml = getAttr(attrs, 'data-source-xml') || ''
    const ooxmlSourceId = getAttr(attrs, 'data-source-id') || src
    const ooxmlRelId = getAttr(attrs, 'data-relationship-id') || ''
    const ooxmlMediaPath = (() => {
      const explicit = getAttr(attrs, 'data-media-path')
      if (explicit) return explicit
      // Auto-derive word/media path from local file URL so syncImageMediaEntries can embed the image
      if (!src || src.startsWith('data:') || /^https?:\/\//i.test(src)) return ''
      const raw = src.replace(/^file:\/+/i, '').replace(/[?#].*$/, '').replace(/\\/g, '/')
      const filename = decodeURIComponent(raw).split('/').pop()
      const derived = filename ? `word/media/${filename}` : ''
      console.log('[documentEngine] buildGenericImageBlock derived mediaPath:', { src, derived })
      return derived
    })()
    const ooxmlMediaType = getAttr(attrs, 'data-media-content-type') || ''
    const ooxmlPreviewSrc = getAttr(attrs, 'data-preview-src') || src
    const ooxmlDrawingLayout = getAttr(attrs, 'data-drawing-layout') || ''
    const ooxmlWidthEmu = getAttr(attrs, 'data-image-width-emu') || ''
    const ooxmlHeightEmu = getAttr(attrs, 'data-image-height-emu') || ''
    const ooxmlAnchorH = getAttr(attrs, 'data-anchor-horizontal') || ''
    const ooxmlAnchorV = getAttr(attrs, 'data-anchor-vertical') || ''
    const ooxmlWrapType = getAttr(attrs, 'data-wrap-type') || ''
    const ooxmlSrcRect = getAttr(attrs, 'data-src-rect') || ''
    const ooxmlSha1 = getAttr(attrs, 'data-sha1') || ''
    const imageBlock = `<div data-ooxml-object="image" data-alt="${escapeHtmlText(alt)}" data-title="${escapeHtmlText(title)}" data-source-id="${escapeHtmlText(ooxmlSourceId)}" data-source-xml="${escapeHtmlText(ooxmlSourceXml)}" data-relationship-id="${escapeHtmlText(ooxmlRelId)}" data-media-path="${escapeHtmlText(ooxmlMediaPath)}" data-media-content-type="${escapeHtmlText(ooxmlMediaType)}" data-preview-src="${escapeHtmlText(ooxmlPreviewSrc)}" data-drawing-layout="${escapeHtmlText(ooxmlDrawingLayout)}" data-image-width-emu="${escapeHtmlText(ooxmlWidthEmu)}" data-image-height-emu="${escapeHtmlText(ooxmlHeightEmu)}" data-image-width-px="${escapeHtmlText(String(width || ''))}" data-image-height-px="${escapeHtmlText(String(height || ''))}" data-anchor-horizontal="${escapeHtmlText(ooxmlAnchorH)}" data-anchor-vertical="${escapeHtmlText(ooxmlAnchorV)}" data-wrap-type="${escapeHtmlText(ooxmlWrapType)}" data-src-rect="${escapeHtmlText(ooxmlSrcRect)}" data-sha1="${escapeHtmlText(ooxmlSha1)}" data-alignment="${escapeHtmlText(alignment || '')}">[图片占位: ${escapeHtmlText(alt)}]</div>`
    const caption = String(options?.caption || '').trim()
    if (!caption) return imageBlock
    return `${imageBlock}<p data-paragraph-style="Caption" data-alignment="center">${escapeHtmlText(caption)}</p>`
  }

  const converted = protectedSource
    .replace(/<figure\b([^>]*)>([\s\S]*?)<\/figure>/gi, (fullMatch, figureAttrs, inner) => {
      const imgMatch = inner.match(/<img\b([^>]*)\/?>(?:<\/img>)?/i)
      if (!imgMatch) return stripHtml(fullMatch)
      const captionMatch = inner.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i)
      const figureStyle = getAttr(figureAttrs || '', 'style') || ''
      const alignment = normalizeImageAlignment(getAttr(figureAttrs || '', 'data-alignment') || getAttr(figureAttrs || '', 'data-align') || readStyleValue(figureStyle, 'text-align'))
      const caption = captionMatch ? stripHtml(captionMatch[1]).trim() : ''
      return buildGenericImageBlock(imgMatch[1] || '', caption || undefined, { alignment, caption })
    })
    .replace(/<(span|div)\b([^>]*data-formula-node="true"[^>]*)>([\s\S]*?)<\/\1>/gi, (_match, _tag, attrs, inner) => {
      const latex = getAttr(attrs, 'data-latex') || stripHtml(inner) || '公式'
      const display = getAttr(attrs, 'data-formula-display') || (_tag === 'span' ? 'inline' : 'block')
      const sourceId = getAttr(attrs, 'data-source-id') || ''
      const sourceXml = getAttr(attrs, 'data-source-xml') || ''
      const mathml = getAttr(attrs, 'data-mathml') || ''
      return `<div data-ooxml-object="formula" data-latex="${escapeHtmlText(latex)}" data-formula-display="${escapeHtmlText(display)}" data-source-id="${escapeHtmlText(sourceId)}" data-source-xml="${escapeHtmlText(sourceXml)}" data-mathml="${escapeHtmlText(mathml)}">[公式占位: ${escapeHtmlText(latex)}]</div>`
    })
    .replace(/<(ol|ul)\b([^>]*)>([\s\S]*?)<\/\1>/gi, (_match, tagName, attrs, inner) => convertHtmlListBlock(tagName, attrs || '', inner || ''))
    .replace(/<img\b([^>]*)\/?>(?:<\/img>)?/gi, (_match, attrs) => {
      return buildGenericImageBlock(attrs || '')
    })

  return converted.replace(/__AI_WRITER_OOXML_BLOCK_(\d+)__/g, (_match, index) => protectedBlocks[Number(index)] || '')
}

function parseHtmlCellParagraphs(innerHtml: string): OoxmlTableParagraphSnapshot[] {
  // Match formula divs, headings, and paragraphs in order
  const tokens = Array.from(String(innerHtml || '').matchAll(/<div\b([^>]*)data-formula-node="true"([^>]*)>[\s\S]*?<\/div>|<h([1-6])\b[^>]*>([\s\S]*?)<\/h\3>|<p\b[^>]*>([\s\S]*?)<\/p>/gi))
  if (!tokens.length) {
    return [{ text: stripHtml(innerHtml).trim() }]
  }

  return tokens.map((token) => {
    if (token[1] !== undefined && token[2] !== undefined && !token[3]) {
      // formula div: token[1] = attrs before data-formula-node, token[2] = attrs after
      const attrs = `${token[1] || ''} ${token[2] || ''}`
      const latex = getAttr(attrs, 'data-latex') || ''
      const rawSourceXml = getAttr(attrs, 'data-source-xml') || ''
      const sourceXml = decodeStructuredData<string>(rawSourceXml) || rawSourceXml || undefined
      return { text: latex, sourceXml }
    }
    if (token[3]) {
      return { text: stripHtml(token[4]).trim(), level: Number(token[3]), style: `Heading${token[3]}` }
    }
    return { text: stripHtml(token[5]).trim() }
  })
}

function parseHtmlTable(innerHtml: string): { rows: number; columns: number; cells: string[][]; tableRows: OoxmlTableCellSnapshot[][] } {
  const rowMatches = Array.from(String(innerHtml || '').matchAll(/<tr\b[\s\S]*?<\/tr>/gi))
  const activeRowSpans: number[] = []
  const tableRows = rowMatches.length ? rowMatches.map((rowMatch) => {
    const row: OoxmlTableCellSnapshot[] = []
    const cellMatches = Array.from(rowMatch[0].matchAll(/<(t[hd])\b([^>]*)>([\s\S]*?)<\/t[hd]>/gi))
    const newSpanColumns = new Set<number>()
    let column = 0

    for (const cellMatch of cellMatches) {
      while ((activeRowSpans[column] || 0) > 0) {
        column += 1
      }

      const tag = String(cellMatch[1] || 'td').toLowerCase()
      const attrs = cellMatch[2] || ''
      const paragraphs = decodeStructuredData<OoxmlTableParagraphSnapshot[]>(getAttr(attrs, 'data-paragraphs')) || parseHtmlCellParagraphs(cellMatch[3] || '')
      const colspan = Math.max(1, Number(getAttr(attrs, 'colspan') || 1))
      const rowspan = Math.max(1, Number(getAttr(attrs, 'rowspan') || 1))
      const cell: OoxmlTableCellSnapshot = {
        text: buildTableCellText(paragraphs),
        paragraphs,
        colspan,
        rowspan,
        header: tag === 'th',
        width: getAttr(attrs, 'data-width') || undefined,
        column,
      }
      row.push(cell)
      for (let offset = 0; offset < colspan; offset += 1) {
        activeRowSpans[column + offset] = Math.max(activeRowSpans[column + offset] || 0, rowspan - 1)
        if (rowspan > 1) {
          newSpanColumns.add(column + offset)
        }
      }
      column += colspan
    }

    for (let index = 0; index < activeRowSpans.length; index += 1) {
      if (activeRowSpans[index] > 0 && !newSpanColumns.has(index)) activeRowSpans[index] -= 1
    }

    return row
  }) : [[{ text: '', paragraphs: [{ text: '' }], colspan: 1, rowspan: 1, column: 0 }]]
  const columns = Math.max(1, ...tableRows.map((row) => row.reduce((total, cell) => Math.max(total, (cell.column || 0) + Math.max(1, cell.colspan || 1)), 0)))
  const cells = tableRows.map((row) => {
    const grid = Array.from({ length: columns }, () => '')
    row.forEach((cell) => {
      grid[cell.column || 0] = cell.text
    })
    return grid
  })
  return {
    rows: tableRows.length,
    columns,
    cells,
    tableRows,
  }
}

function plainTextToBlocks(plainText: string): OoxmlBlockSnapshot[] {
  const chunks = String(plainText || '')
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)

  const blocks: OoxmlBlockSnapshot[] = []

  chunks.forEach((chunk) => {
    const index = blocks.length
    const headingMatch = chunk.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      const headingText = headingMatch[2].trim()
      const abstractMatch = headingText.match(/^(摘要|abstract)(?:[:：]\s*|\s+)(.+)$/i)
      if (abstractMatch) {
        blocks.push({ index: blocks.length, kind: 'heading', text: abstractMatch[1], level: headingMatch[1].length, paragraphStyle: 'AbstractHeading', alignment: 'center' })
        blocks.push({ index: blocks.length, kind: 'paragraph', text: abstractMatch[2].trim(), paragraphStyle: 'Abstract' })
        return
      }
      const keywordMatch = headingText.match(/^(关键词|关键字|keywords?)(?:[:：]\s*|\s+)(.+)$/i)
      if (keywordMatch) {
        blocks.push({ index: blocks.length, kind: 'heading', text: keywordMatch[1], level: headingMatch[1].length, paragraphStyle: 'KeywordsHeading', alignment: 'left' })
        blocks.push({ index: blocks.length, kind: 'paragraph', text: keywordMatch[2].trim(), paragraphStyle: 'Keywords' })
        return
      }
      blocks.push({ index, kind: 'heading', text: headingText, level: headingMatch[1].length })
      return
    }
    const imageMatch = chunk.match(/^\[图片占位:\s*(.*?)\]$/)
    if (imageMatch) {
      blocks.push({ index, kind: 'image-placeholder', text: imageMatch[1].trim(), alt: imageMatch[1].trim() })
      return
    }
    const formulaMatch = chunk.match(/^\[公式占位:\s*(.*?)\]$/)
    if (formulaMatch) {
      blocks.push({ index, kind: 'formula-placeholder', text: formulaMatch[1].trim(), latex: formulaMatch[1].trim() })
      return
    }
    const tableMatch = chunk.match(/^\[表格占位:\s*(\d+)x(\d+)\]$/)
    if (tableMatch) {
      const rows = Number(tableMatch[1])
      const columns = Number(tableMatch[2])
      blocks.push({
        index,
        kind: 'table-placeholder',
        text: `表格占位 ${rows}x${columns}`,
        rows,
        columns,
        cells: Array.from({ length: rows }, () => Array.from({ length: columns }, () => '')),
      })
      return
    }
    blocks.push({ index, kind: 'paragraph', text: chunk })
  })

  return blocks
}

function htmlToBlocks(html: string): OoxmlBlockSnapshot[] {
  let source = convertSpecialHtmlBlocks(String(html || '')).trim()
  const hasTemplateWrapper = /^<div\b[^>]*data-paper-template[^>]*>/i.test(source)
  const paperTemplateId = hasTemplateWrapper ? extractPaperTemplateIdFromHtml(source) : undefined
  source = source.replace(/^<div\b[^>]*data-paper-template[^>]*>/i, '')
  if (hasTemplateWrapper) {
    source = source.replace(/<\/div>\s*$/i, '')
  }

  const tokenRegex = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>|<(div|span)\b([^>]*)data-ooxml-object="([^"]+)"([^>]*)>([\s\S]*?)<\/\3>|<table\b([^>]*)>([\s\S]*?)<\/table>|<p\b[^>]*>([\s\S]*?)<\/p>/gi
  const blocks: OoxmlBlockSnapshot[] = []

  for (let match = tokenRegex.exec(source); match; match = tokenRegex.exec(source)) {
    if (match[1]) {
      blocks.push({
        index: blocks.length,
        kind: 'heading',
        text: stripHtml(match[2]).trim(),
        level: Number(match[1]),
        paragraphStyle: getAttr(match[0], 'data-paragraph-style') || `Heading${match[1]}`,
        paperStyle: mergeCssStyles(
          buildTemplateBlockStyle(paperTemplateId, 'heading', Number(match[1]), getAttr(match[0], 'data-semantic-role')),
          extractDominantInlineTextStyle(match[2]),
          getAttr(match[0], 'data-paper-style') || getAttr(match[0], 'style'),
        ),
        inlineRuns: parseInlineHtmlToRuns(match[2]),
        pageTemplateId: paperTemplateId,
        alignment: (getAttr(match[0], 'data-alignment') as 'left' | 'center' | 'right' | 'justify' | null) || undefined,
        indentLevel: Number(getAttr(match[0], 'data-indent-level') || 0) || undefined,
        listType: (getAttr(match[0], 'data-list-type') as 'bullet' | 'number' | null) || undefined,
        listLevel: Number(getAttr(match[0], 'data-list-level') || 0) || undefined,
        sourceXml: decodeStructuredData<string>(getAttr(match[0], 'data-source-xml')) || getAttr(match[0], 'data-source-xml') || undefined,
      })
      continue
    }

    if (match[5]) {
      const attrs = `${match[4] || ''} ${match[6] || ''}`
      const kind = String(match[5])
      if (kind === 'image') {
        const alt = getAttr(attrs, 'data-alt') || stripHtml(match[7]).trim() || 'image'
        blocks.push({ index: blocks.length, kind: 'image-placeholder', text: alt, alt, title: getAttr(attrs, 'data-title') || undefined, alignment: (getAttr(attrs, 'data-alignment') as 'left' | 'center' | 'right' | 'justify' | null) || undefined, relationshipId: getAttr(attrs, 'data-relationship-id') || undefined, mediaPath: getAttr(attrs, 'data-media-path') || undefined, mediaContentType: getAttr(attrs, 'data-media-content-type') || undefined, previewSrc: getAttr(attrs, 'data-preview-src') || undefined, drawingLayout: (getAttr(attrs, 'data-drawing-layout') as 'inline' | 'anchor' | null) || undefined, imageWidthEmu: Number(getAttr(attrs, 'data-image-width-emu') || 0) || undefined, imageHeightEmu: Number(getAttr(attrs, 'data-image-height-emu') || 0) || undefined, imageWidthPx: Number(getAttr(attrs, 'data-image-width-px') || 0) || undefined, imageHeightPx: Number(getAttr(attrs, 'data-image-height-px') || 0) || undefined, anchorHorizontal: getAttr(attrs, 'data-anchor-horizontal') || undefined, anchorVertical: getAttr(attrs, 'data-anchor-vertical') || undefined, wrapType: getAttr(attrs, 'data-wrap-type') || undefined, sourceId: getAttr(attrs, 'data-source-id') || undefined, sourceXml: decodeStructuredData<string>(getAttr(attrs, 'data-source-xml')) || undefined })
        continue
      }
      if (kind === 'formula') {
        const latex = getAttr(attrs, 'data-latex') || stripHtml(match[7]).trim() || '公式'
        blocks.push({ index: blocks.length, kind: 'formula-placeholder', text: latex, latex, formulaDisplay: (getAttr(attrs, 'data-formula-display') as 'inline' | 'block' | null) || 'block', mathml: decodeStructuredData<string>(getAttr(attrs, 'data-mathml')) || renderFormulaMathMl(latex, ((getAttr(attrs, 'data-formula-display') as 'inline' | 'block' | null) || 'block') === 'block'), sourceId: getAttr(attrs, 'data-source-id') || undefined, sourceXml: decodeStructuredData<string>(getAttr(attrs, 'data-source-xml')) || undefined })
        continue
      }
      if (kind === 'table') {
        const tableRows = decodeStructuredData<OoxmlTableCellSnapshot[][]>(getAttr(attrs, 'data-table-rows'))
        const cells = decodeStructuredData<string[][]>(getAttr(attrs, 'data-cells'))
        const rows = Math.max(1, Number(getAttr(attrs, 'data-rows') || cells?.length || 1))
        const columns = Math.max(1, Number(getAttr(attrs, 'data-cols') || Math.max(...(cells || [['']]).map((row) => row.length || 1)) || 1))
        blocks.push({
          index: blocks.length,
          kind: 'table-placeholder',
          text: `表格占位 ${rows}x${columns}`,
          rows,
          columns,
          cells: cells || Array.from({ length: rows }, () => Array.from({ length: columns }, () => '')),
          tableRows: normalizeTableRows(tableRows ?? undefined, cells ?? undefined),
        })
        continue
      }
      if (kind === 'page-break') {
        blocks.push({
          index: blocks.length,
          kind: 'page-break',
          text: '分页符',
          hasManualPageBreak: true,
          sourceXml: decodeStructuredData<string>(getAttr(attrs, 'data-source-xml')) || undefined,
          pageTemplateId: paperTemplateId,
        })
        continue
      }
      if (kind === 'section-break') {
        blocks.push({
          index: blocks.length,
          kind: 'section-break',
          text: stripHtml(match[7]).trim() || '分节符',
          sectionType: (getAttr(attrs, 'data-section-type') as 'nextPage' | 'continuous' | 'evenPage' | 'oddPage' | null) || 'nextPage',
          sectionPropertiesXml: decodeStructuredData<string>(getAttr(attrs, 'data-section-properties-xml')) || undefined,
          sectionBreakXml: decodeStructuredData<string>(getAttr(attrs, 'data-section-break-xml')) || undefined,
          hasManualPageBreak: getAttr(attrs, 'data-has-manual-page-break') === 'true',
          sourceXml: decodeStructuredData<string>(getAttr(attrs, 'data-section-break-xml')) || undefined,
          pageTemplateId: paperTemplateId,
        })
        continue
      }
      const text = stripHtml(match[7]).trim()
      if (text) {
        blocks.push({
          index: blocks.length,
          kind: 'paragraph',
          text,
          paragraphStyle: getAttr(match[0], 'data-paragraph-style') || undefined,
          paperStyle: mergeCssStyles(
            buildTemplateBlockStyle(paperTemplateId, 'paragraph', undefined, getAttr(match[0], 'data-semantic-role')),
            extractDominantInlineTextStyle(match[7]),
            getAttr(match[0], 'data-paper-style') || getAttr(match[0], 'style'),
          ),
          inlineRuns: parseInlineHtmlToRuns(match[7]),
          pageTemplateId: paperTemplateId,
          alignment: (getAttr(match[0], 'data-alignment') as 'left' | 'center' | 'right' | 'justify' | null) || undefined,
          indentLevel: Number(getAttr(match[0], 'data-indent-level') || 0) || undefined,
          listType: (getAttr(match[0], 'data-list-type') as 'bullet' | 'number' | null) || undefined,
          listLevel: Number(getAttr(match[0], 'data-list-level') || 0) || undefined,
          sourceXml: decodeStructuredData<string>(getAttr(match[0], 'data-source-xml')) || getAttr(match[0], 'data-source-xml') || undefined,
        })
      }
      continue
    }

    if (match[8] != null) {
      const attrs = match[8] || ''
      const parsedTable = parseHtmlTable(match[9] || '')
      blocks.push({
        index: blocks.length,
        kind: 'table-placeholder',
        text: `表格占位 ${parsedTable.rows}x${parsedTable.columns}`,
        rows: Math.max(1, Number(getAttr(attrs, 'data-rows') || parsedTable.rows)),
        columns: Math.max(1, Number(getAttr(attrs, 'data-cols') || parsedTable.columns)),
        cells: parsedTable.cells,
        tableRows: parsedTable.tableRows,
      })
      continue
    }

    const text = stripHtml(match[10]).trim()
    if (text) {
      blocks.push({
        index: blocks.length,
        kind: 'paragraph',
        text,
        paragraphStyle: getAttr(match[0], 'data-paragraph-style') || undefined,
        paperStyle: mergeCssStyles(
          buildTemplateBlockStyle(paperTemplateId, 'paragraph', undefined, getAttr(match[0], 'data-semantic-role')),
          extractDominantInlineTextStyle(match[10]),
          getAttr(match[0], 'data-paper-style') || getAttr(match[0], 'style'),
        ),
        inlineRuns: parseInlineHtmlToRuns(match[10]),
        pageTemplateId: paperTemplateId,
        alignment: (getAttr(match[0], 'data-alignment') as 'left' | 'center' | 'right' | 'justify' | null) || undefined,
        indentLevel: Number(getAttr(match[0], 'data-indent-level') || 0) || undefined,
        listType: (getAttr(match[0], 'data-list-type') as 'bullet' | 'number' | null) || undefined,
        listLevel: Number(getAttr(match[0], 'data-list-level') || 0) || undefined,
        sourceXml: decodeStructuredData<string>(getAttr(match[0], 'data-source-xml')) || getAttr(match[0], 'data-source-xml') || undefined,
      })
    }
  }

  if (blocks.length) return blocks
  return plainTextToBlocks(stripHtml(source))
}

function extractParagraphStyles(paragraphXml: string) {
  const paragraphProperties = paragraphXml.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/)?.[0] || ''
  const firstTextRunXml = paragraphXml.match(/<w:r\b[\s\S]*?<w:t(?:\s+[^>]*)?>[\s\S]*?<\/w:t>[\s\S]*?<\/w:r>/i)?.[0] || ''
  const paragraphMarkRunProperties = paragraphProperties.match(/<w:rPr\b[\s\S]*?<\/w:rPr>/i)?.[0] || ''
  const runProperties = firstTextRunXml.match(/<w:rPr\b[\s\S]*?<\/w:rPr>/i)?.[0]
    || paragraphMarkRunProperties
    || paragraphXml.match(/<w:rPr\b[\s\S]*?<\/w:rPr>/)?.[0]
    || ''
  return { paragraphProperties, runProperties }
}

function upsertRunPropertyXml(runProperties: string, propertyName: string, propertyXml: string): string {
  if (!runProperties) {
    return `<w:rPr>${propertyXml}</w:rPr>`
  }
  const propertyPattern = new RegExp(`<w:${propertyName}\\b[\\s\\S]*?(?:\\/>|<\\/w:${propertyName}>)`, 'i')
  if (propertyPattern.test(runProperties)) {
    return runProperties.replace(propertyPattern, propertyXml)
  }
  return runProperties.replace(/<w:rPr([^>]*)>/i, `<w:rPr$1>${propertyXml}`)
}

function resolveRunProperties(templateXml: string | null, runProperties: string, paragraphStyle?: string, block?: OoxmlBlockSnapshot): string {
  const normalizedStyle = normalizeKnownStyleId(paragraphStyle)
  let nextProperties = runProperties
  if (normalizedStyle && STYLE_RUN_PROPERTIES[normalizedStyle]) {
    const templateStyle = normalizeKnownStyleId(templateXml ? extractParagraphStyleId(templateXml) : undefined)
    if (!(templateStyle === normalizedStyle && runProperties)) {
      // Use style preset as base, but if the original run already has inline-specific properties
      // (bold-off, italic-off, vertAlign, color, shd) preserve them over the style defaults.
      const styleBase = `<w:rPr>${STYLE_RUN_PROPERTIES[normalizedStyle]}</w:rPr>`
      if (runProperties) {
        // Merge: start from style base, then re-apply any inline property from original that
        // would explicitly deviate (e.g. w:b w:val="0", w:color, w:vertAlign, w:shd, w:highlight)
        let merged = styleBase
        const PRESERVE_PROPS = ['b', 'bCs', 'i', 'iCs', 'u', 'strike', 'vertAlign', 'color', 'shd', 'highlight']
        for (const prop of PRESERVE_PROPS) {
          const re = new RegExp(`<w:${prop}\\b[\\s\\S]*?(?:\\/>|<\\/w:${prop}>)`, 'i')
          const original = runProperties.match(re)?.[0]
          if (original) {
            merged = upsertRunPropertyXml(merged, prop, original)
          }
        }
        nextProperties = merged
      } else {
        nextProperties = styleBase
      }
    }
  }

  const styleMap = parseCssStyleMap(block?.paperStyle)
  const fontSizePx = resolveCssLengthPx(styleMap['font-size']) || DEFAULT_FONT_SIZE_PX
  const fontsXml = buildRunFontsXml(styleMap['font-family'])
  if (fontsXml) {
    nextProperties = upsertRunPropertyXml(nextProperties, 'rFonts', fontsXml)
  }
  const halfPoints = resolveCssFontSizeHalfPoints(styleMap['font-size'], fontSizePx)
  if (halfPoints) {
    nextProperties = upsertRunPropertyXml(nextProperties, 'sz', `<w:sz w:val="${halfPoints}"/>`)
    nextProperties = upsertRunPropertyXml(nextProperties, 'szCs', `<w:szCs w:val="${halfPoints}"/>`)
  }
  return nextProperties
}

function buildRunXml(text: string, runProperties: string): string {
  const segments = String(text || '').replace(/\r/g, '').split('\n')
  if (!segments.length || (segments.length === 1 && !segments[0])) {
    return `<w:r>${runProperties}<w:t xml:space="preserve"></w:t></w:r>`
  }

  return segments
    .map((segment, index) => {
      const textNode = `<w:t${/^\s|\s$/.test(segment) ? ' xml:space="preserve"' : ''}>${escapeXmlText(segment)}</w:t>`
      const breakNode = index < segments.length - 1 ? '<w:br/>' : ''
      return `<w:r>${runProperties}${textNode}${breakNode}</w:r>`
    })
    .join('')
}

function canRewriteSourceParagraphTextPreservingSkeleton(
  templateXml: string | null,
  block: OoxmlBlockSnapshot,
  paragraphStyle?: string,
  citationSourceTagMap?: Map<number, string>,
): boolean {
  if (templateXml !== block.sourceXml || !templateXml) return false
  if (block.kind !== 'paragraph' || paragraphStyle) return false
  if (block.disableSourceSkeletonRewrite) return false
  if (typeof block.indentLevel === 'number' || block.listType || typeof block.listLevel === 'number') return false
  if (block.inlineRuns?.length) return false
  if (citationSourceTagMap && citationSourceTagMap.size > 0) return false
  if (containsWordFieldCode(templateXml)) return false
  if (/[\r\n]/.test(String(block.text || ''))) return false
  if (/<w:(?:br|cr|tab)\b/i.test(templateXml)) return false
  return /<w:t(?:\s+[^>]*)?>[\s\S]*?<\/w:t>/i.test(templateXml)
}

function splitTextAcrossSourceTextNodes(paragraphXml: string, nextText: string): string[] {
  const textNodeMatches = Array.from(String(paragraphXml || '').matchAll(/<w:t(\s+[^>]*)?>([\s\S]*?)<\/w:t>/gi))
  if (!textNodeMatches.length) return []

  const originalSegments = textNodeMatches.map((match) => decodeXmlEntities(match[2] || ''))
  if (!originalSegments.some((segment) => segment.length > 0)) {
    return [nextText, ...Array.from({ length: Math.max(0, textNodeMatches.length - 1) }, () => '')]
  }

  let cursor = 0
  return originalSegments.map((segment, index) => {
    if (index === originalSegments.length - 1) {
      return nextText.slice(cursor)
    }
    const segmentLength = Math.max(0, Math.min(segment.length, nextText.length - cursor))
    const replacement = nextText.slice(cursor, cursor + segmentLength)
    cursor += segmentLength
    return replacement
  })
}

function rewriteSourceParagraphTextPreservingSkeleton(paragraphXml: string, nextText: string): string | null {
  const normalizedText = String(nextText || '').replace(/\r/g, '')
  const replacements = splitTextAcrossSourceTextNodes(paragraphXml, normalizedText)
  if (!replacements.length) return null

  let textNodeIndex = 0
  return String(paragraphXml || '').replace(/<w:t(\s+[^>]*)?>([\s\S]*?)<\/w:t>/gi, (_match, attrs = '') => {
    const replacement = replacements[textNodeIndex] ?? ''
    textNodeIndex += 1
    let nextAttrs = String(attrs || '')
    if (/^\s|\s$/.test(replacement) && !/\bxml:space=/.test(nextAttrs)) {
      nextAttrs = `${nextAttrs} xml:space="preserve"`
    }
    return `<w:t${nextAttrs}>${escapeXmlText(replacement)}</w:t>`
  })
}

function resolveInlineRunProperties(baseRunProperties: string, run: OoxmlInlineRunSnapshot): string {
  let nextProperties = baseRunProperties || ''
  const styleMap = parseCssStyleMap(run.style)
  const fontsXml = buildRunFontsXml(styleMap['font-family'])
  if (fontsXml) nextProperties = upsertRunPropertyXml(nextProperties, 'rFonts', fontsXml)
  const halfPoints = resolveCssFontSizeHalfPoints(styleMap['font-size'])
  if (halfPoints) {
    nextProperties = upsertRunPropertyXml(nextProperties, 'sz', `<w:sz w:val="${halfPoints}"/>`)
    nextProperties = upsertRunPropertyXml(nextProperties, 'szCs', `<w:szCs w:val="${halfPoints}"/>`)
  }
  if (String(styleMap['font-weight'] || '').trim()) {
    nextProperties = upsertRunPropertyXml(nextProperties, 'b', '<w:b/>')
    nextProperties = upsertRunPropertyXml(nextProperties, 'bCs', '<w:bCs/>')
  }
  if (String(styleMap['font-style'] || '').trim() === 'italic') {
    nextProperties = upsertRunPropertyXml(nextProperties, 'i', '<w:i/>')
    nextProperties = upsertRunPropertyXml(nextProperties, 'iCs', '<w:iCs/>')
  }
  const decoration = String(styleMap['text-decoration'] || '').toLowerCase()
  if (decoration.includes('underline')) {
    nextProperties = upsertRunPropertyXml(nextProperties, 'u', '<w:u w:val="single"/>')
  }
  if (decoration.includes('line-through')) {
    nextProperties = upsertRunPropertyXml(nextProperties, 'strike', '<w:strike/>')
  }
  const vertAlign = styleMap['vertical-align']
  if (vertAlign === 'super') {
    nextProperties = upsertRunPropertyXml(nextProperties, 'vertAlign', '<w:vertAlign w:val="superscript"/>')
  } else if (vertAlign === 'sub') {
    nextProperties = upsertRunPropertyXml(nextProperties, 'vertAlign', '<w:vertAlign w:val="subscript"/>')
  }
  const runColor = styleMap['color']
  if (runColor) {
    const colorHex = runColor.replace(/^#/, '').toUpperCase()
    nextProperties = upsertRunPropertyXml(nextProperties, 'color', `<w:color w:val="${colorHex}"/>`)
  }
  const bgColor = styleMap['background-color']
  if (bgColor) {
    const WORD_NAMED_HIGHLIGHTS = new Set(['black', 'blue', 'cyan', 'darkBlue', 'darkCyan', 'darkGray', 'darkGreen', 'darkMagenta', 'darkRed', 'darkYellow', 'green', 'lightGray', 'magenta', 'red', 'white', 'yellow'])
    if (WORD_NAMED_HIGHLIGHTS.has(bgColor)) {
      nextProperties = upsertRunPropertyXml(nextProperties, 'highlight', `<w:highlight w:val="${bgColor}"/>`)
    } else {
      const shdHex = bgColor.replace(/^#/, '').toUpperCase()
      if (/^[0-9A-F]{6}$/i.test(shdHex)) {
        nextProperties = upsertRunPropertyXml(nextProperties, 'shd', `<w:shd w:val="clear" w:color="auto" w:fill="${shdHex}"/>`)
      }
    }
  }
  return nextProperties
}

function wrapInlineFormulaForPlaintext(latex: string): string {
  const source = String(latex || '').trim()
  return `[LaTeX]${source}[/LaTeX]`
}

function buildRunsXml(text: string, runProperties: string, inlineRuns?: OoxmlInlineRunSnapshot[], paragraphStyle?: string, citationSourceTagMap?: Map<number, string>): string {
  if (!inlineRuns?.length) {
    return buildRunXmlWithCitationFields(text, runProperties, paragraphStyle, citationSourceTagMap)
  }
  return inlineRuns
    .map((run) => {
      const resolvedProperties = resolveInlineRunProperties(runProperties, run)
      if (run.formulaLatex) {
        // 公式以明文形式写回：[LaTeX]...[/LaTeX]，供用户在 Word 中手动粘贴到公式编辑器。
        return buildRunXml(wrapInlineFormulaForPlaintext(run.formulaLatex), resolvedProperties)
      }
      return buildRunXmlWithCitationFields(run.text, resolvedProperties, paragraphStyle, citationSourceTagMap)
    })
    .join('')
}

function upsertParagraphPropertyXml(paragraphProperties: string, propertyName: string, propertyXml: string): string {
  if (!paragraphProperties) {
    return `<w:pPr>${propertyXml}</w:pPr>`
  }
  const propertyPattern = new RegExp(`<w:${propertyName}\\b[\\s\\S]*?(?:\\/>|<\\/w:${propertyName}>)`, 'i')
  if (propertyPattern.test(paragraphProperties)) {
    return paragraphProperties.replace(propertyPattern, propertyXml)
  }
  return paragraphProperties.replace(/<w:pPr([^>]*)>/i, `<w:pPr$1>${propertyXml}`)
}

function removeParagraphPropertyXml(paragraphProperties: string, propertyName: string): string {
  return paragraphProperties.replace(new RegExp(`<w:${propertyName}\\b[\\s\\S]*?(?:\\/>|<\\/w:${propertyName}>)`, 'gi'), '')
}

function getDefaultParagraphLayout(block: OoxmlBlockSnapshot, paragraphStyle?: string): {
  alignment?: 'left' | 'center' | 'right' | 'justify'
  leftTwips?: number
  firstLineTwips?: number
  spacingBefore?: number
  spacingAfter?: number
  line?: number
  lineRule?: 'auto' | 'exact' | 'atLeast'
} {
  const normalizedStyle = normalizeKnownStyleId(paragraphStyle)
  if (normalizedStyle === 'Title') {
    return { alignment: 'center', spacingBefore: 240, spacingAfter: 200, line: 360, lineRule: 'auto' }
  }
  if (normalizedStyle === 'AbstractHeading') {
    return { alignment: 'center', spacingBefore: 160, spacingAfter: 80, line: 360, lineRule: 'auto' }
  }
  if (normalizedStyle === 'Abstract') {
    return { alignment: 'justify', firstLineTwips: 0, spacingBefore: 0, spacingAfter: 120, line: 360, lineRule: 'auto' }
  }
  if (normalizedStyle === 'KeywordsHeading') {
    return { alignment: 'left', firstLineTwips: 0, spacingBefore: 80, spacingAfter: 40, line: 360, lineRule: 'auto' }
  }
  if (normalizedStyle === 'Keywords') {
    return { alignment: 'left', firstLineTwips: 0, spacingBefore: 0, spacingAfter: 120, line: 360, lineRule: 'auto' }
  }
  if (normalizedStyle === 'Heading1') {
    return { alignment: 'left', firstLineTwips: 0, spacingBefore: 240, spacingAfter: 120, line: 360, lineRule: 'auto' }
  }
  if (normalizedStyle === 'Heading2') {
    return { alignment: 'left', firstLineTwips: 0, spacingBefore: 180, spacingAfter: 100, line: 360, lineRule: 'auto' }
  }
  if (normalizedStyle === 'Heading3') {
    return { alignment: 'left', firstLineTwips: 0, spacingBefore: 120, spacingAfter: 80, line: 360, lineRule: 'auto' }
  }
  if (block.kind === 'paragraph') {
    return { alignment: 'justify', firstLineTwips: 420, spacingBefore: 0, spacingAfter: 0, line: 360, lineRule: 'auto' }
  }
  return {}
}

function buildIndentXml(leftTwips?: number, firstLineTwips?: number): string | null {
  const attrs: string[] = []
  if (typeof leftTwips === 'number') attrs.push(`w:left="${Math.max(0, leftTwips)}"`)
  if (typeof firstLineTwips === 'number') attrs.push(`w:firstLine="${Math.max(0, firstLineTwips)}"`)
  return attrs.length ? `<w:ind ${attrs.join(' ')}/>` : null
}

function buildSpacingXml(before?: number, after?: number, line?: number, lineRule?: 'auto' | 'exact' | 'atLeast'): string | null {
  const attrs: string[] = []
  if (typeof before === 'number') attrs.push(`w:before="${Math.max(0, before)}"`)
  if (typeof after === 'number') attrs.push(`w:after="${Math.max(0, after)}"`)
  if (typeof line === 'number') attrs.push(`w:line="${Math.max(0, line)}"`)
  if (lineRule) attrs.push(`w:lineRule="${lineRule}"`)
  return attrs.length ? `<w:spacing ${attrs.join(' ')}/>` : null
}

function normalizeCssAlignment(value: string | null | undefined): 'left' | 'center' | 'right' | 'justify' | undefined {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return undefined
  if (normalized === 'center') return 'center'
  if (normalized === 'right' || normalized === 'end') return 'right'
  if (normalized === 'justify') return 'justify'
  return 'left'
}

function resolvePaperStyleLayout(block: OoxmlBlockSnapshot): Partial<ReturnType<typeof getDefaultParagraphLayout>> & { textIndentTwips?: number; breakBefore?: string } {
  const styleMap = parseCssStyleMap(block.paperStyle)
  const fontSizePx = resolveCssLengthPx(styleMap['font-size']) || DEFAULT_FONT_SIZE_PX
  const lineHeight = resolveCssLineHeightSpec(styleMap['line-height'], fontSizePx)
  return {
    alignment: normalizeCssAlignment(styleMap['text-align']),
    breakBefore: styleMap['break-before'],
    textIndentTwips: resolveCssLengthTwips(styleMap['text-indent'], fontSizePx),
    spacingBefore: resolveCssLengthTwips(styleMap['margin-top'], fontSizePx),
    spacingAfter: resolveCssLengthTwips(styleMap['margin-bottom'], fontSizePx),
    line: lineHeight?.line,
    lineRule: lineHeight?.lineRule,
  }
}

function applyParagraphFormatting(paragraphProperties: string, block: OoxmlBlockSnapshot, paragraphStyle?: string): string {
  let nextProperties = paragraphProperties || '<w:pPr></w:pPr>'
  const layoutDefaults = getDefaultParagraphLayout(block, paragraphStyle)
  const styleLayout = resolvePaperStyleLayout(block)
  if (paragraphStyle) {
    nextProperties = upsertParagraphPropertyXml(nextProperties, 'pStyle', `<w:pStyle w:val="${escapeXmlText(paragraphStyle)}"/>`)
  }
  const effectiveAlignment = block.alignment || styleLayout.alignment || layoutDefaults.alignment
  if (effectiveAlignment) {
    const jcValue = effectiveAlignment === 'justify' ? 'both' : effectiveAlignment
    nextProperties = upsertParagraphPropertyXml(nextProperties, 'jc', `<w:jc w:val="${escapeXmlText(jcValue)}"/>`)
  } else {
    nextProperties = removeParagraphPropertyXml(nextProperties, 'jc')
  }
  const effectiveFirstLineTwips = typeof styleLayout.textIndentTwips === 'number' ? styleLayout.textIndentTwips : layoutDefaults.firstLineTwips
  const indentXml = typeof block.indentLevel === 'number'
    ? buildIndentXml(Math.max(0, block.indentLevel) * 360, effectiveFirstLineTwips)
    : buildIndentXml(layoutDefaults.leftTwips, effectiveFirstLineTwips)
  if (indentXml) {
    nextProperties = upsertParagraphPropertyXml(nextProperties, 'ind', indentXml)
  } else {
    nextProperties = removeParagraphPropertyXml(nextProperties, 'ind')
  }
  const spacingXml = buildSpacingXml(
    typeof styleLayout.spacingBefore === 'number' ? styleLayout.spacingBefore : layoutDefaults.spacingBefore,
    typeof styleLayout.spacingAfter === 'number' ? styleLayout.spacingAfter : layoutDefaults.spacingAfter,
    typeof styleLayout.line === 'number' ? styleLayout.line : layoutDefaults.line,
    styleLayout.lineRule || layoutDefaults.lineRule,
  )
  if (spacingXml) {
    nextProperties = upsertParagraphPropertyXml(nextProperties, 'spacing', spacingXml)
  } else {
    nextProperties = removeParagraphPropertyXml(nextProperties, 'spacing')
  }
  if (styleLayout.breakBefore === 'page') {
    nextProperties = upsertParagraphPropertyXml(nextProperties, 'pageBreakBefore', '<w:pageBreakBefore/>')
  } else {
    nextProperties = removeParagraphPropertyXml(nextProperties, 'pageBreakBefore')
  }
  if (block.listType) {
    const numId = block.listType === 'bullet' ? 900 : 901
    const ilvl = Math.max(0, block.listLevel || 0)
    nextProperties = upsertParagraphPropertyXml(nextProperties, 'numPr', `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>`)
  } else {
    nextProperties = removeParagraphPropertyXml(nextProperties, 'numPr')
  }
  return nextProperties
}

function rewriteParagraphXml(templateParagraphXml: string, text: string): string {
  const { paragraphProperties, runProperties } = extractParagraphStyles(templateParagraphXml)
  return `<w:p>${paragraphProperties}${buildRunXml(text, runProperties)}</w:p>`
}

function rewriteParagraphWithStyle(templateParagraphXml: string, text: string, paragraphStyle?: string): string {
  const { paragraphProperties, runProperties } = extractParagraphStyles(templateParagraphXml)
  const block: OoxmlBlockSnapshot = { index: 0, kind: 'paragraph', text }
  const resolvedRunProperties = resolveRunProperties(templateParagraphXml, runProperties, paragraphStyle, block)
  return `<w:p>${applyParagraphFormatting(paragraphProperties, block, paragraphStyle)}${buildRunsXml(text, resolvedRunProperties, block.inlineRuns, paragraphStyle)}</w:p>`
}

function buildParagraphXml(text: string, templateXml: string | null, paragraphStyle?: string, block?: OoxmlBlockSnapshot, citationSourceTagMap?: Map<number, string>): string {
  const effectiveBlock = block || { index: 0, kind: 'paragraph', text }
  const resolvedTemplateXml = resolveParagraphTemplateXml(templateXml, effectiveBlock)
  if (shouldPreserveSourceParagraphXml(effectiveBlock, paragraphStyle)) {
    return effectiveBlock.sourceXml || ''
  }
  if (resolvedTemplateXml) {
    const { paragraphProperties, runProperties } = extractParagraphStyles(resolvedTemplateXml)
    const preserveSourceFormatting = shouldPreserveSourceParagraphFormatting(resolvedTemplateXml, effectiveBlock, paragraphStyle)
    if (preserveSourceFormatting && canRewriteSourceParagraphTextPreservingSkeleton(resolvedTemplateXml, effectiveBlock, paragraphStyle, citationSourceTagMap)) {
      const rewrittenSourceXml = rewriteSourceParagraphTextPreservingSkeleton(resolvedTemplateXml, text)
      if (rewrittenSourceXml) return rewrittenSourceXml
    }
    const resolvedParagraphProperties = preserveSourceFormatting
      ? (paragraphProperties || '<w:pPr></w:pPr>')
      : applyParagraphFormatting(paragraphProperties, effectiveBlock, paragraphStyle)
    const resolvedRunProperties = preserveSourceFormatting
      ? runProperties
      : resolveRunProperties(resolvedTemplateXml, runProperties, paragraphStyle, effectiveBlock)
    return `<w:p>${resolvedParagraphProperties}${buildRunsXml(text, resolvedRunProperties, effectiveBlock.inlineRuns, paragraphStyle, citationSourceTagMap)}</w:p>`
  }
  if (paragraphStyle) {
    const resolvedRunProperties = resolveRunProperties(null, '', paragraphStyle, effectiveBlock)
    return `<w:p>${applyParagraphFormatting('', effectiveBlock, paragraphStyle)}${buildRunsXml(text, resolvedRunProperties, effectiveBlock.inlineRuns, paragraphStyle, citationSourceTagMap)}</w:p>`
  }
  const resolvedRunProperties = resolveRunProperties(null, '', undefined, effectiveBlock)
  return `<w:p>${applyParagraphFormatting('', effectiveBlock)}${buildRunsXml(text, resolvedRunProperties, effectiveBlock.inlineRuns, paragraphStyle, citationSourceTagMap)}</w:p>`
}

function replaceParagraphProperties(paragraphXml: string, paragraphProperties: string): string {
  if (/<w:pPr\b/i.test(paragraphXml)) {
    return paragraphXml.replace(/<w:pPr\b[\s\S]*?<\/w:pPr>/i, paragraphProperties)
  }
  return paragraphXml.replace(/<w:p\b([^>]*)>/i, `<w:p$1>${paragraphProperties}`)
}

function ensureSectionTypeXml(sectionXml: string, sectionType?: 'nextPage' | 'continuous' | 'evenPage' | 'oddPage'): string {
  if (!sectionType) return sectionXml
  const typeXml = `<w:type w:val="${escapeXmlText(sectionType)}"/>`
  if (/<w:type\b/i.test(sectionXml)) {
    return sectionXml.replace(/<w:type\b[^>]*\/>/i, typeXml)
  }
  if (/<w:sectPr\b[^>]*\/>/i.test(sectionXml)) {
    return sectionXml.replace(/<w:sectPr\b([^>]*)\/>/i, `<w:sectPr$1>${typeXml}</w:sectPr>`)
  }
  return sectionXml.replace(/<w:sectPr\b([^>]*)>/i, `<w:sectPr$1>${typeXml}`)
}

function buildPageBreakParagraphXml(block: OoxmlBlockSnapshot, templateXml: string | null): string {
  if (block.sourceXml && paragraphContainsManualPageBreak(block.sourceXml)) {
    return block.sourceXml
  }
  const paragraphProperties = templateXml ? extractParagraphStyles(templateXml).paragraphProperties : ''
  return `<w:p>${paragraphProperties || '<w:pPr></w:pPr>'}<w:r><w:br w:type="page"/></w:r></w:p>`
}

function buildSectionBreakParagraphXml(block: OoxmlBlockSnapshot, templateXml: string | null): string {
  const sourceParagraphXml = block.sectionBreakXml || block.sourceXml || ''
  const baseSectionXml = block.sectionPropertiesXml
    || extractSectionPropertiesXml(sourceParagraphXml)
    || '<w:sectPr/>'
  const nextSectionXml = ensureSectionTypeXml(
    rewriteSectionXml(baseSectionXml, [block]),
    block.sectionType || extractSectionType(baseSectionXml),
  )

  if (sourceParagraphXml) {
    const { paragraphProperties } = extractParagraphStyles(sourceParagraphXml)
    const nextParagraphProperties = upsertParagraphPropertyXml(paragraphProperties || '<w:pPr></w:pPr>', 'sectPr', nextSectionXml)
    let nextParagraphXml = replaceParagraphProperties(sourceParagraphXml, nextParagraphProperties)
    if (block.hasManualPageBreak && !paragraphContainsManualPageBreak(nextParagraphXml)) {
      nextParagraphXml = nextParagraphXml.replace(/<\/w:p>$/i, '<w:r><w:br w:type="page"/></w:r></w:p>')
    }
    return nextParagraphXml
  }

  const paragraphProperties = templateXml ? extractParagraphStyles(templateXml).paragraphProperties : ''
  const nextParagraphProperties = upsertParagraphPropertyXml(paragraphProperties || '<w:pPr></w:pPr>', 'sectPr', nextSectionXml)
  const breakRunXml = block.hasManualPageBreak ? '<w:r><w:br w:type="page"/></w:r>' : ''
  return `<w:p>${nextParagraphProperties}${breakRunXml}</w:p>`
}

function setXmlAttribute(source: string, name: string, value: string): string {
  const sanitized = String(source || '').replace(new RegExp(`\s*${escapeRegExp(name)}="[^"]*"`, 'gi'), '')
  return `${sanitized} ${name}="${escapeXmlText(value)}"`.trim()
}

function pxToEmu(value: number | undefined): number | undefined {
  if (!value || !Number.isFinite(value)) return undefined
  return Math.max(1, Math.round(value * 9525))
}

function normalizeWrapTypeForXml(value: string | undefined): string | undefined {
  if (!value) return undefined
  const mapping: Record<string, string> = {
    square: 'wrapSquare',
    wrapSquare: 'wrapSquare',
    tight: 'wrapTight',
    wrapTight: 'wrapTight',
    topAndBottom: 'wrapTopAndBottom',
    wrapTopAndBottom: 'wrapTopAndBottom',
    through: 'wrapThrough',
    wrapThrough: 'wrapThrough',
    none: 'wrapNone',
    wrapNone: 'wrapNone',
  }
  return mapping[value] || value
}

function normalizeMediaRelationshipTarget(mediaPath: string | undefined): string | undefined {
  const normalized = String(mediaPath || '').trim().replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized) return undefined
  if (normalized.startsWith('word/')) return normalized.slice('word/'.length)
  const relative = path.posix.relative('word', normalized)
  return relative && relative !== '' ? relative : normalized
}

function updateExtentTag(xml: string, tagName: 'wp:extent' | 'a:ext', cx: number | undefined, cy: number | undefined): string {
  if (!cx && !cy) return xml
  const pattern = new RegExp(`<${tagName}\\b([^>]*)\\/>`, 'i')
  return xml.replace(pattern, (_match, attrs) => {
    let nextAttrs = String(attrs || '').trim()
    if (cx) nextAttrs = setXmlAttribute(nextAttrs, 'cx', String(cx))
    if (cy) nextAttrs = setXmlAttribute(nextAttrs, 'cy', String(cy))
    return `<${tagName} ${nextAttrs}/>`
  })
}

function removeAnchorPositioning(xml: string): string {
  return xml
    .replace(/<wp:simplePos\b[^>]*\/>/gi, '')
    .replace(/<wp:positionH\b[\s\S]*?<\/wp:positionH>/gi, '')
    .replace(/<wp:positionV\b[\s\S]*?<\/wp:positionV>/gi, '')
    .replace(/<wp:(wrapSquare|wrapTight|wrapTopAndBottom|wrapThrough|wrapNone)\b[^>]*\/>/gi, '')
}

function ensureAnchorPosition(xml: string, axis: 'H' | 'V', relativeFrom: string | undefined): string {
  if (!relativeFrom) return xml
  const tagName = axis === 'H' ? 'positionH' : 'positionV'
  const pattern = new RegExp(`<wp:${tagName}\\b([^>]*)>[\\s\\S]*?<\\/wp:${tagName}>`, 'i')
  if (pattern.test(xml)) {
    return xml.replace(pattern, (_match, attrs) => `<wp:${tagName} ${setXmlAttribute(String(attrs || '').trim(), 'relativeFrom', relativeFrom)}><wp:posOffset>0</wp:posOffset></wp:${tagName}>`)
  }
  return xml.replace(/(<wp:extent\b[^>]*\/>)/i, `<wp:${tagName} relativeFrom="${escapeXmlText(relativeFrom)}"><wp:posOffset>0</wp:posOffset></wp:${tagName}>$1`)
}

function ensureAnchorWrap(xml: string, wrapType: string | undefined): string {
  const normalized = normalizeWrapTypeForXml(wrapType)
  const cleared = xml.replace(/<wp:(wrapSquare|wrapTight|wrapTopAndBottom|wrapThrough|wrapNone)\b[^>]*\/>/gi, '')
  if (!normalized) return cleared
  if (new RegExp(`<wp:${normalized}\\b`, 'i').test(cleared)) return cleared
  return cleared.replace(/(<wp:extent\b[^>]*\/>)/i, `<wp:${normalized} wrapText="bothSides"/>$1`)
}

function applyImageDrawingEdits(sourceXml: string, block: OoxmlBlockSnapshot): string {
  let nextXml = sourceXml
  const widthEmu = pxToEmu(block.imageWidthPx) || block.imageWidthEmu
  const heightEmu = pxToEmu(block.imageHeightPx) || block.imageHeightEmu
  nextXml = updateExtentTag(nextXml, 'wp:extent', widthEmu, heightEmu)
  nextXml = updateExtentTag(nextXml, 'a:ext', widthEmu, heightEmu)

  const desiredLayout = block.drawingLayout || (/<wp:anchor\b/i.test(nextXml) ? 'anchor' : 'inline')
  if (desiredLayout === 'anchor') {
    nextXml = nextXml.replace(/<wp:inline\b([^>]*)>/i, (_match, attrs) => {
      let nextAttrs = String(attrs || '').trim()
      nextAttrs = setXmlAttribute(nextAttrs, 'behindDoc', '0')
      nextAttrs = setXmlAttribute(nextAttrs, 'locked', '0')
      nextAttrs = setXmlAttribute(nextAttrs, 'layoutInCell', '1')
      nextAttrs = setXmlAttribute(nextAttrs, 'allowOverlap', '1')
      nextAttrs = setXmlAttribute(nextAttrs, 'distT', '0')
      nextAttrs = setXmlAttribute(nextAttrs, 'distB', '0')
      nextAttrs = setXmlAttribute(nextAttrs, 'distL', '0')
      nextAttrs = setXmlAttribute(nextAttrs, 'distR', '0')
      return `<wp:anchor ${nextAttrs}>`
    }).replace(/<\/wp:inline>/i, '</wp:anchor>')

    if (!/<wp:simplePos\b/i.test(nextXml)) {
      nextXml = nextXml.replace(/<wp:anchor\b([^>]*)>/i, '<wp:anchor$1><wp:simplePos x="0" y="0"/>')
    }
    nextXml = ensureAnchorPosition(nextXml, 'H', block.anchorHorizontal || 'margin')
    nextXml = ensureAnchorPosition(nextXml, 'V', block.anchorVertical || 'paragraph')
    nextXml = ensureAnchorWrap(nextXml, block.wrapType || 'square')
  } else {
    nextXml = nextXml.replace(/<wp:anchor\b[^>]*>/i, '<wp:inline>').replace(/<\/wp:anchor>/i, '</wp:inline>')
    nextXml = removeAnchorPositioning(nextXml)
  }

  // Preserve / write-back image crop rect (<a:srcRect>)
  if (block.imageCropRect) {
    const { l, t, r, b } = block.imageCropRect
    const srcRectXml = `<a:srcRect l="${l}" t="${t}" r="${r}" b="${b}"/>`
    if (/<a:srcRect\b/i.test(nextXml)) {
      nextXml = nextXml.replace(/<a:srcRect\b[^>]*\/>/i, srcRectXml)
    } else {
      nextXml = nextXml.replace(/(<a:blip\b[^>]*\/?>)/i, `$1${srcRectXml}`)
    }
  } else {
    nextXml = nextXml.replace(/<a:srcRect\b[^>]*\/>/gi, '')
  }

  return nextXml.replace(/<wp:docPr\b([^>]*)\/>/i, (_match, attrs) => {
    const nextName = block.title || block.alt || block.text || 'image'
    let nextAttrs = String(attrs || '').trim()
    nextAttrs = setXmlAttribute(nextAttrs, 'descr', block.alt || block.text || 'image')
    nextAttrs = setXmlAttribute(nextAttrs, 'title', block.alt || block.text || 'image')
    nextAttrs = setXmlAttribute(nextAttrs, 'name', nextName)
    return `<wp:docPr ${nextAttrs}/>`
  })
}

function rewriteDocumentRelationshipsXml(relationshipsXml: string, blocks: OoxmlBlockSnapshot[]): string {
  let nextXml = relationshipsXml
  for (const block of blocks) {
    if (block.kind !== 'image-placeholder' || !block.relationshipId || !block.mediaPath) continue
    const target = normalizeMediaRelationshipTarget(block.mediaPath)
    if (!target) continue
    const relationshipPattern = new RegExp(`(<Relationship\\b[^>]*Id="${escapeRegExp(block.relationshipId)}"[^>]*Target=")([^"]*)("[^>]*\/?>)`, 'i')
    nextXml = nextXml.replace(relationshipPattern, `$1${escapeXmlText(target)}$3`)
  }
  return nextXml
}

async function syncImageMediaEntries(
  zip: JSZip,
  blocks: OoxmlBlockSnapshot[],
  relationshipsXml: string | null,
  contentTypesXml: string | null,
): Promise<string | null> {
  const relationships = parseDocumentRelationships(relationshipsXml)
  let nextContentTypesXml = contentTypesXml

  for (const block of blocks) {
    if (block.kind !== 'image-placeholder' || !block.mediaPath) continue

    const parsedPreview = block.previewSrc ? parseDataUrl(block.previewSrc) : null
    const normalizedEntryPath = normalizeMediaEntryPath(block.mediaPath, parsedPreview?.contentType || block.mediaContentType)
    if (!normalizedEntryPath) continue

    let mediaBuffer: Buffer | null = parsedPreview?.buffer || null
    let mediaContentType = parsedPreview?.contentType || block.mediaContentType || getExtensionContentType(nextContentTypesXml, normalizedEntryPath)

    if (!mediaBuffer) {
      const localPreview = await readLocalImageAsBuffer(block.previewSrc)
      console.log('[documentEngine] syncImageMediaEntries readLocalImageAsBuffer previewSrc:', { previewSrc: block.previewSrc, ok: !!localPreview })
      if (localPreview) {
        mediaBuffer = localPreview.buffer
        mediaContentType ||= localPreview.contentType
      }
    }

    if (!mediaBuffer) {
      const localSource = await readLocalImageAsBuffer(block.sourceId)
      if (localSource) {
        mediaBuffer = localSource.buffer
        mediaContentType ||= localSource.contentType
      }
    }

    if (!mediaBuffer && block.relationshipId) {
      const currentRelationship = relationships.get(block.relationshipId)
      const currentEntryPath = currentRelationship ? resolveRelationshipTarget(currentRelationship.target) : null
      if (currentEntryPath) {
        const currentEntry = zip.file(currentEntryPath)
        if (currentEntry) {
          mediaBuffer = await currentEntry.async('nodebuffer')
          mediaContentType ||= getExtensionContentType(nextContentTypesXml, currentEntryPath)
        }
      }
    }

    if (!mediaBuffer) continue

    zip.file(normalizedEntryPath, mediaBuffer)
    const extension = getExtensionFromEntryPath(normalizedEntryPath) || getExtensionForContentType(mediaContentType || undefined)
    if (extension && mediaContentType) {
      nextContentTypesXml = ensureContentTypeDefault(nextContentTypesXml, extension, mediaContentType)
    }
  }

  return nextContentTypesXml
}

function buildGeneratedImageParagraphXml(block: OoxmlBlockSnapshot, fallbackTemplateXml: string | null): string {
  const widthEmu = pxToEmu(block.imageWidthPx) || block.imageWidthEmu || pxToEmu(240) || 2286000
  const heightEmu = pxToEmu(block.imageHeightPx) || block.imageHeightEmu || pxToEmu(160) || 1524000
  const relationshipId = block.relationshipId || 'rId1'
  const objectId = deriveImageObjectNumericId(block, 1)
  const name = block.title || block.alt || block.text || 'image'
  const descr = block.alt || block.text || name
  const { paragraphProperties } = extractParagraphStyles(fallbackTemplateXml || '')
  const srcRectXml = block.imageCropRect
    ? `<a:srcRect l="${block.imageCropRect.l}" t="${block.imageCropRect.t}" r="${block.imageCropRect.r}" b="${block.imageCropRect.b}"/>`
    : ''
  const pictureXml = `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${objectId}" name="${escapeXmlText(name)}" descr="${escapeXmlText(descr)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${escapeXmlText(relationshipId)}">${srcRectXml}</a:blip><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${widthEmu}" cy="${heightEmu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`
  const wrapTag = normalizeWrapTypeForXml(block.wrapType || 'square') || 'wrapSquare'
  const drawingXml = (block.drawingLayout || 'inline') === 'anchor'
    ? `<wp:anchor distT="0" distB="0" distL="0" distR="0" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="${escapeXmlText(block.anchorHorizontal || 'margin')}"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="${escapeXmlText(block.anchorVertical || 'paragraph')}"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:${wrapTag} wrapText="bothSides"/><wp:extent cx="${widthEmu}" cy="${heightEmu}"/><wp:docPr id="${objectId}" name="${escapeXmlText(name)}" descr="${escapeXmlText(descr)}" title="${escapeXmlText(descr)}"/><wp:cNvGraphicFramePr/>${pictureXml}</wp:anchor>`
    : `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${widthEmu}" cy="${heightEmu}"/><wp:docPr id="${objectId}" name="${escapeXmlText(name)}" descr="${escapeXmlText(descr)}" title="${escapeXmlText(descr)}"/><wp:cNvGraphicFramePr/>${pictureXml}</wp:inline>`

  return `<w:p>${applyParagraphFormatting(paragraphProperties, block)}<w:r><w:drawing>${drawingXml}</w:drawing></w:r></w:p>`
}

function rewriteImageParagraphXml(sourceXml: string, block: OoxmlBlockSnapshot, fallbackTemplateXml: string | null): string {
  if (!sourceXml || !/<wp:docPr\b/i.test(sourceXml)) {
    if (fallbackTemplateXml && /<wp:docPr\b/i.test(fallbackTemplateXml)) {
      const fallbackXml = applyImageDrawingEdits(fallbackTemplateXml, block)
      const { paragraphProperties } = extractParagraphStyles(fallbackTemplateXml)
      const nextParagraphProperties = applyParagraphFormatting(paragraphProperties, block)
      if (/<w:pPr\b/i.test(fallbackXml)) {
        return fallbackXml.replace(/<w:pPr\b[\s\S]*?<\/w:pPr>/i, nextParagraphProperties)
      }
      return fallbackXml.replace(/<w:p>/i, `<w:p>${nextParagraphProperties}`)
    }
    return buildGeneratedImageParagraphXml(block, fallbackTemplateXml)
  }

  const rewrittenXml = applyImageDrawingEdits(sourceXml, block)
  const { paragraphProperties } = extractParagraphStyles(sourceXml || fallbackTemplateXml || '')
  const nextParagraphProperties = applyParagraphFormatting(paragraphProperties, block)
  if (/<w:pPr\b/i.test(rewrittenXml)) {
    return rewrittenXml.replace(/<w:pPr\b[\s\S]*?<\/w:pPr>/i, nextParagraphProperties)
  }
  return rewrittenXml.replace(/<w:p>/i, `<w:p>${nextParagraphProperties}`)
}

function buildMinimalOmml(latex: string, displayMode: boolean): string {
  const mathRun = `<m:r><m:t>${escapeXmlText(latex)}</m:t></m:r>`
  return displayMode ? `<m:oMathPara><m:oMath>${mathRun}</m:oMath></m:oMathPara>` : `<m:oMath>${mathRun}</m:oMath>`
}

function buildFormulaMetadataRun(latex: string, displayMode: 'inline' | 'block', ommlXml: string): string {
  const plainText = extractFormulaPlainText(ommlXml)
  const payload = encodeUtf8ToBase64(JSON.stringify({ latex, plainText, displayMode } satisfies FormulaMetadataSnapshot))
  if (!payload) return ''
  return `<w:r><w:rPr><w:vanish/><w:noProof/></w:rPr><w:t>${FORMULA_METADATA_PREFIX}${escapeXmlText(payload)}</w:t></w:r>`
}

function wrapBlockFormulaForPlaintext(latex: string): string {
  // 写回 Word 时只保留 LaTeX 正文；读入时仍识别历史包裹格式（见 BLOCK_LATEX_PATTERN）。
  return String(latex || '').trim()
}

function rewriteFormulaParagraphXml(sourceXml: string, block: OoxmlBlockSnapshot, fallbackTemplateXml: string | null): string {
  // 公式以明文形式写回整段，便于在 Word 中直接查看或复制到公式编辑器。
  const latex = block.latex || block.text || ''
  const plaintext = wrapBlockFormulaForPlaintext(latex)
  const templateXml = sourceXml || fallbackTemplateXml || ''
  if (templateXml) {
    const { paragraphProperties, runProperties } = extractParagraphStyles(templateXml)
    const runXml = buildRunXml(plaintext, runProperties)
    return `<w:p>${paragraphProperties}${runXml}</w:p>`
  }
  const runXml = buildRunXml(plaintext, '')
  return `<w:p>${runXml}</w:p>`
}

function applyTableCellProperties(templateProperties: string, cell: OoxmlTableCellSnapshot): string {
  let properties = (templateProperties || '<w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>')
    .replace(/<w:vMerge\b[^>]*\/>/gi, '')
    .replace(/<w:vMerge\b[^>]*>(?:<\/w:vMerge>)?/gi, '')
  if (cell.width) {
    if (/<w:tcW\b/i.test(properties)) {
      properties = properties.replace(/<w:tcW\b[^>]*w:w="[^"]+"[^>]*\/>/i, `<w:tcW w:w="${escapeXmlText(cell.width)}" w:type="dxa"/>`)
    } else {
      properties = properties.replace(/<w:tcPr([^>]*)>/i, `<w:tcPr$1><w:tcW w:w="${escapeXmlText(cell.width)}" w:type="dxa"/>`)
    }
  }
  if (cell.colspan && cell.colspan > 1) {
    if (/<w:gridSpan\b/i.test(properties)) {
      properties = properties.replace(/<w:gridSpan\b[^>]*w:val="\d+"[^>]*\/>/i, `<w:gridSpan w:val="${cell.colspan}"/>`)
    } else {
      properties = properties.replace(/<w:tcPr([^>]*)>/i, `<w:tcPr$1><w:gridSpan w:val="${cell.colspan}"/>`)
    }
  } else {
    properties = properties.replace(/<w:gridSpan\b[^>]*\/>/gi, '')
  }
  return properties
}

function buildTableCellParagraphXml(cell: OoxmlTableCellSnapshot, templateXml: string | null, paragraphTemplateXml: string | null, citationSourceTagMap?: Map<number, string>): string {
  const paragraphs = cell.paragraphs?.length ? cell.paragraphs : [{ text: cell.text || '' }]
  return paragraphs.map((paragraph) => {
    // Preserve formula/image paragraphs verbatim from their sourceXml
    if (paragraph.sourceXml) return paragraph.sourceXml
    const style = paragraph.style || (paragraph.level ? `Heading${paragraph.level}` : undefined)
    const activeTemplate = style ? templateXml : paragraphTemplateXml
    return buildParagraphXml(paragraph.text, activeTemplate, style, undefined, citationSourceTagMap)
  }).join('')
}

function computeTableColumnCount(tableRows: OoxmlTableCellSnapshot[][]): number {
  return Math.max(1, ...tableRows.map((row) => row.reduce((total, cell) => Math.max(total, (cell.column || 0) + Math.max(1, cell.colspan || 1)), 0)))
}

function buildTableXml(block: OoxmlBlockSnapshot, templateXml: string | null, paragraphTemplateXml: string | null, citationSourceTagMap?: Map<number, string>): string {
  const tableRows = normalizeTableRows(block.tableRows, block.cells)
  const safeColumns = Math.max(1, block.columns || computeTableColumnCount(tableRows) || 1)

  const tableProperties = templateXml?.match(/<w:tblPr\b[\s\S]*?<\/w:tblPr>/)?.[0]
    || '<w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr>'
  const gridCols = Array.from(templateXml?.matchAll(/<w:gridCol\b[^>]*w:w="([^"]+)"[^>]*\/>/g) || []).map((match) => match[1])
  const defaultGridWidth = gridCols[0] || '2400'
  const gridXml = `<w:tblGrid>${Array.from({ length: safeColumns }, (_item, index) => `<w:gridCol w:w="${gridCols[index] || defaultGridWidth}"/>`).join('')}</w:tblGrid>`
  const rowTemplateXml = templateXml?.match(/<w:tr\b[\s\S]*?<\/w:tr>/)?.[0] || null
  const rowProperties = rowTemplateXml?.match(/<w:trPr\b[\s\S]*?<\/w:trPr>/)?.[0] || ''
  const cellTemplateXml = rowTemplateXml?.match(/<w:tc\b[\s\S]*?<\/w:tc>/)?.[0] || templateXml?.match(/<w:tc\b[\s\S]*?<\/w:tc>/)?.[0] || null
  const cellProperties = cellTemplateXml?.match(/<w:tcPr\b[\s\S]*?<\/w:tcPr>/)?.[0] || '<w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>'
  const cellParagraphTemplate = cellTemplateXml?.match(/<w:p\b[\s\S]*?<\/w:p>/)?.[0] || paragraphTemplateXml

  const activeRowSpans: Array<{ remaining: number; cell: OoxmlTableCellSnapshot } | null> = Array.from({ length: safeColumns }, () => null)
  const rowXml = tableRows.map((row) => {
    const cellByColumn = new Map<number, OoxmlTableCellSnapshot>()
    row.forEach((cell) => {
      cellByColumn.set(cell.column || 0, cell)
    })

    let column = 0
    const physicalCells: string[] = []
    while (column < safeColumns) {
      const active = activeRowSpans[column]
      if (active) {
        if ((active.cell.column || 0) === column) {
          const continuationProperties = applyTableCellProperties(cellProperties, active.cell)
          physicalCells.push(`<w:tc>${continuationProperties.replace(/<w:tcPr([^>]*)>/i, '<w:tcPr$1><w:vMerge/>')}<w:p/></w:tc>`)
        }
        active.remaining -= 1
        const spanWidth = Math.max(1, active.cell.colspan || 1)
        if (active.remaining <= 0) {
          for (let offset = 0; offset < spanWidth; offset += 1) {
            activeRowSpans[column + offset] = null
          }
        }
        column += spanWidth
        continue
      }

      const cell = cellByColumn.get(column)
      if (!cell) {
        physicalCells.push(`<w:tc>${cellProperties}${buildParagraphXml('', cellParagraphTemplate, undefined, undefined, citationSourceTagMap)}</w:tc>`)
        column += 1
        continue
      }

      const propertiesWithSpan = applyTableCellProperties(cellProperties, cell)
      const properties = cell.rowspan && cell.rowspan > 1
        ? propertiesWithSpan.replace(/<w:tcPr([^>]*)>/i, '<w:tcPr$1><w:vMerge w:val="restart"/>')
        : propertiesWithSpan
      physicalCells.push(`<w:tc>${properties}${buildTableCellParagraphXml(cell, cellParagraphTemplate, paragraphTemplateXml, citationSourceTagMap)}</w:tc>`)

      if (cell.rowspan && cell.rowspan > 1) {
        const spanWidth = Math.max(1, cell.colspan || 1)
        for (let offset = 0; offset < spanWidth; offset += 1) {
          activeRowSpans[column + offset] = { remaining: cell.rowspan - 1, cell }
        }
      }

      column += Math.max(1, cell.colspan || 1)
    }

    return `<w:tr>${rowProperties}${physicalCells.join('')}</w:tr>`
  }).join('')

  return `<w:tbl>${tableProperties}${gridXml}${rowXml}</w:tbl>`
}

function parseCssBoxShorthand(value: string | null | undefined): { top?: string; right?: string; bottom?: string; left?: string } {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return {}
  if (parts.length === 1) return { top: parts[0], right: parts[0], bottom: parts[0], left: parts[0] }
  if (parts.length === 2) return { top: parts[0], right: parts[1], bottom: parts[0], left: parts[1] }
  if (parts.length === 3) return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[1] }
  return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] }
}

function hasReusableParagraphFormatting(paragraphXml: string): boolean {
  return /<w:(?:spacing|ind|jc|pStyle|numPr|tabs|contextualSpacing|keepLines|keepNext|pageBreakBefore)\b/i.test(paragraphXml)
}

function isReusableParagraphTemplateXml(paragraphXml: string): boolean {
  if (classifyParagraphKind(paragraphXml) !== 'paragraph') return false
  return Boolean(extractTextFromParagraphXml(paragraphXml).trim() || hasReusableParagraphFormatting(paragraphXml))
}

function resolveParagraphTemplateXml(templateXml: string | null, block: OoxmlBlockSnapshot): string | null {
  if ((block.kind === 'paragraph' || block.kind === 'heading') && block.sourceXml) {
    const sourceKind = classifyParagraphKind(block.sourceXml)
    if ((block.kind === 'paragraph' && sourceKind === 'paragraph') || (block.kind === 'heading' && sourceKind === 'heading')) {
      return block.sourceXml
    }
  }
  return templateXml
}

function shouldPreserveSourceParagraphFormatting(templateXml: string | null, block: OoxmlBlockSnapshot, paragraphStyle?: string): boolean {
  return templateXml === block.sourceXml
    && block.kind === 'paragraph'
    && !paragraphStyle
    && typeof block.indentLevel !== 'number'
    && !block.listType
    && typeof block.listLevel !== 'number'
}

function rewriteSectionXml(sectionXml: string, blocks: OoxmlBlockSnapshot[]): string {
  const templateId = blocks.find((block) => block.pageTemplateId)?.pageTemplateId
  if (!templateId) return sectionXml || '<w:sectPr/>'
  const template = getPaperTemplate(templateId)
  /* 使用 mm 物理页边距（Word 对齐） */
  const MM_TO_TWIP_FACTOR = 56.6929
  const top = Math.round(template.pageMargins.top * MM_TO_TWIP_FACTOR)
  const right = Math.round(template.pageMargins.right * MM_TO_TWIP_FACTOR)
  const bottom = Math.round(template.pageMargins.bottom * MM_TO_TWIP_FACTOR)
  const left = Math.round(template.pageMargins.left * MM_TO_TWIP_FACTOR)
  const baseSectionXml = sectionXml && sectionXml.trim() ? sectionXml : '<w:sectPr/>'
  const pgMarXml = `<w:pgMar w:top="${top}" w:right="${right}" w:bottom="${bottom}" w:left="${left}" w:header="720" w:footer="720" w:gutter="0"/>`
  /* A4: 210mm × 297mm = 11906 × 16838 twips */
  const pgSzXml = '<w:pgSz w:w="11906" w:h="16838"/>'
  let result = baseSectionXml
  /* pgMar */
  if (/<w:pgMar\b/i.test(result)) {
    result = result.replace(/<w:pgMar\b[^>]*\/>/i, pgMarXml)
  } else if (/<w:sectPr\b[^>]*\/>/i.test(result)) {
    result = result.replace(/<w:sectPr\b([^>]*)\/>/i, `<w:sectPr$1>${pgMarXml}</w:sectPr>`)
  } else {
    result = result.replace(/<w:sectPr([^>]*)>/i, `<w:sectPr$1>${pgMarXml}`)
  }
  /* pgSz */
  if (/<w:pgSz\b/i.test(result)) {
    result = result.replace(/<w:pgSz\b[^>]*\/>/i, pgSzXml)
  } else {
    result = result.replace(/<w:pgMar/, `${pgSzXml}<w:pgMar`)
  }
  return result
}

function buildDocumentTemplates(elements: BodyElementSnapshot[]): DocumentTemplates {
  const headingByLevel: Record<number, string | null> = { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null }
  let paragraphXml: string | null = null
  let imageParagraphXml: string | null = null
  let formulaParagraphXml: string | null = null
  let tableXml: string | null = null

  for (const element of elements) {
    if (element.type === 'table') {
      tableXml ||= element.xml
      continue
    }
    if (element.type !== 'paragraph') continue

    const kind = classifyParagraphKind(element.xml)
    const level = extractHeadingLevel(element.xml)
    if (kind === 'heading' && level) {
      headingByLevel[level] ||= element.xml
      continue
    }
    if (kind === 'image-placeholder') {
      imageParagraphXml ||= element.xml
      continue
    }
    if (kind === 'formula-placeholder') {
      formulaParagraphXml ||= element.xml
      continue
    }
    if (!paragraphXml && isReusableParagraphTemplateXml(element.xml)) {
      paragraphXml = element.xml
    }
  }

  return { paragraphXml, headingByLevel, imageParagraphXml, formulaParagraphXml, tableXml }
}

function blockToBodyXml(block: OoxmlBlockSnapshot, templates: DocumentTemplates, citationSourceTagMap?: Map<number, string>): string {
  switch (block.kind) {
    case 'heading':
      return buildParagraphXml(block.text, templates.headingByLevel[block.level || 1], block.paragraphStyle || `Heading${Math.max(1, Math.min(block.level || 1, 6))}`, block, citationSourceTagMap)
    case 'image-placeholder':
      return rewriteImageParagraphXml(block.sourceXml || templates.imageParagraphXml || '', block, templates.imageParagraphXml || templates.paragraphXml)
    case 'formula-placeholder':
      return rewriteFormulaParagraphXml(block.sourceXml || templates.formulaParagraphXml || '', block, templates.formulaParagraphXml || templates.paragraphXml)
    case 'table-placeholder':
      return buildTableXml(block, templates.tableXml, templates.paragraphXml, citationSourceTagMap)
    case 'page-break':
      return buildPageBreakParagraphXml(block, templates.paragraphXml)
    case 'section-break':
      return buildSectionBreakParagraphXml(block, templates.paragraphXml)
    default:
      return buildParagraphXml(block.text, templates.paragraphXml, block.paragraphStyle, block, citationSourceTagMap)
  }
}

function writeBlocksIntoDocumentXml(
  documentXml: string,
  blocks: OoxmlBlockSnapshot[],
  citationSourceTagMap?: Map<number, string>,
  documentSectionPropertiesXml?: string,
): string {
  const { prefix, elements, suffix } = splitBodyElements(documentXml)
  if (!prefix || !suffix) return documentXml

  const templates = buildDocumentTemplates(elements)
  const sectionXml = rewriteSectionXml(
    documentSectionPropertiesXml || elements.find((element) => element.type === 'section')?.xml || '',
    blocks,
  )
  const blockXml = blocks.map((block) => blockToBodyXml(block, templates, citationSourceTagMap)).join('')
  const safePrefix = ensureRequiredNamespaces(prefix, blockXml)
  return `${safePrefix}${blockXml}${sectionXml}${suffix}`
}

function ensureRequiredNamespaces(prefix: string, blockXml: string): string {
  let patched = prefix
  const nsMap: [RegExp, string, string][] = [
    [/<m:/, 'xmlns:m', ' xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"'],
    [/<wp:/, 'xmlns:wp', ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"'],
    [/<a:/, 'xmlns:a', ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'],
    [/<pic:/, 'xmlns:pic', ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"'],
    [/<r:/, 'xmlns:r', ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'],
  ]
  for (const [contentTest, nsAttr, nsDecl] of nsMap) {
    if (contentTest.test(blockXml) && !patched.includes(nsAttr)) {
      patched = patched.replace(/<w:document\b/, `<w:document${nsDecl}`)
    }
  }
  return patched
}

function normalizeWritePayload(payload: OoxmlWritePayload): OoxmlBlockSnapshot[] {
  if (Array.isArray(payload.blocks) && payload.blocks.length) {
    return payload.blocks.map((block, index) => ({ ...block, index }))
  }
  if (typeof payload.html === 'string' && payload.html.trim()) {
    return htmlToBlocks(payload.html)
  }
  if (typeof payload.plainText === 'string' && payload.plainText.trim()) {
    return plainTextToBlocks(payload.plainText)
  }
  if (Array.isArray(payload.paragraphs) && payload.paragraphs.length) {
    return payload.paragraphs.map((paragraph, index) => ({ index, kind: 'paragraph', text: String(paragraph || '').replace(/\r/g, '').trimEnd() }))
  }
  return []
}

const MINIMAL_CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`

const MINIMAL_ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

const MINIMAL_DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`

const MINIMAL_DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
  <w:body>
    <w:p><w:r><w:t>AI Writer Seed</w:t></w:r></w:p>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1797" w:bottom="1440" w:left="1797" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>
  </w:body>
</w:document>`

/* Normal 样式基于 12pt 宋体 / Times New Roman, 1.5 倍行距 */
const MINIMAL_STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="both"/></w:pPr></w:style>
</w:styles>`

async function createMinimalDocxPackage(targetPath: string): Promise<void> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', MINIMAL_CONTENT_TYPES_XML.replace(
    '</Types>',
    '  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>\n</Types>',
  ))
  zip.file('_rels/.rels', MINIMAL_ROOT_RELS_XML)
  zip.file('word/document.xml', MINIMAL_DOCUMENT_XML)
  zip.file('word/styles.xml', MINIMAL_STYLES_XML)
  zip.file('word/_rels/document.xml.rels', MINIMAL_DOCUMENT_RELS_XML.replace(
    '</Relationships>',
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
  ))
  const output = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  await fs.writeFile(targetPath, output)
}

export class DocumentEngineService {
  private preferredEngineId: 'legacy-tiptap-bridge' | 'embedded-office-engine' = 'embedded-office-engine'

  getActiveEngine() {
    return {
      engineId: this.preferredEngineId,
      availableEngineIds: ['legacy-tiptap-bridge', 'embedded-office-engine'],
    }
  }

  setPreferredEngine(engineId: string) {
    if (engineId === 'legacy-tiptap-bridge' || engineId === 'embedded-office-engine') {
      this.preferredEngineId = engineId
    }
    return this.getActiveEngine()
  }

  async readOoxmlPackage(filePath: string): Promise<OoxmlPackageSnapshot> {
    const target = path.resolve(String(filePath))

    const buildSnapshot = (
      status: OoxmlReadStatus,
      overrides: Partial<OoxmlPackageSnapshot> = {},
    ): OoxmlPackageSnapshot => ({
      filePath: target,
      status,
      exists: status !== 'missing-file',
      entryCount: 0,
      entries: [],
      contentTypesXml: null,
      documentXml: null,
      paragraphCount: 0,
      paragraphs: [],
      blockCount: 0,
      blocks: [],
      bibliographySources: [],
      plainText: '',
      html: '<p></p>',
      ...overrides,
    })

    try {
      const stat = await fs.stat(target)
      if (!stat.isFile()) {
        return buildSnapshot('missing-file', {
          exists: false,
          diagnostics: {
            code: 'missing-file',
            message: '预览文件不存在或不是可读取文件。',
          },
        })
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return buildSnapshot('missing-file', {
          exists: false,
          diagnostics: {
            code: 'missing-file',
            message: '预览文件不存在，可能已被移动、删除或尚未生成完成。',
          },
        })
      }

      return buildSnapshot('parse-failed', {
        exists: false,
        diagnostics: {
          code: 'parse-failed',
          message: '无法访问 DOCX 文件，预览读取已终止。',
          detail: error instanceof Error ? error.message : String(error),
        },
      })
    }

    try {
      const buffer = await fs.readFile(target)
      const zip = await JSZip.loadAsync(buffer)
      const entries = Object.keys(zip.files).sort()
      const contentTypesXml = await zip.file('[Content_Types].xml')?.async('text') || null
      const rootRelationshipsXml = await zip.file('_rels/.rels')?.async('text') || null
      const documentXml = await zip.file('word/document.xml')?.async('text') || null

      if (!documentXml) {
        return buildSnapshot('missing-document-xml', {
          exists: true,
          entryCount: entries.length,
          entries,
          contentTypesXml,
          diagnostics: {
            code: 'missing-document-xml',
            message: 'DOCX 包中缺少 word/document.xml，无法构建正文预览。',
          },
        })
      }

      const relationshipsXml = await zip.file('word/_rels/document.xml.rels')?.async('text') || null
      const numberingXml = await zip.file('word/numbering.xml')?.async('text') || null
      const stylesXml = await zip.file('word/styles.xml')?.async('text') || null
      const bibliographyPart = await findBibliographyCustomXmlPart(zip, rootRelationshipsXml)
      const relationships = parseDocumentRelationships(relationshipsXml)
      const numberingFormats = parseNumberingFormats(numberingXml)
      const bibliographySources = bibliographyPart?.sources || []
      const rawBlocks = await deriveBlocksFromDocumentXml(documentXml, { zip, contentTypesXml, relationships, numberingFormats })
      const bibliographyBlocks = normalizeImportedBibliographyBlocks(rawBlocks, bibliographySources)
      const blocks = normalizeImportedCitationFieldBlocks(bibliographyBlocks, bibliographySources)
      const paragraphs = toParagraphSnapshots(blocks)
      const plainText = blocksToPlainText(blocks)
      const renderMeta = await buildRenderMetaSnapshot(stylesXml, documentXml, relationships, zip, blocks)
      const html = wrapBlocksHtmlWithRenderMeta(blocksToHtml(blocks), renderMeta)
      const status: OoxmlReadStatus = blocks.length === 0 ? 'empty-document' : 'ok'

      return {
        filePath: target,
        status,
        exists: true,
        entryCount: entries.length,
        entries,
        contentTypesXml,
        documentXml,
        paragraphCount: paragraphs.length,
        paragraphs,
        blockCount: blocks.length,
        blocks,
        bibliographySources,
        plainText,
        html,
        renderMeta,
        diagnostics: status === 'empty-document'
          ? {
              code: 'empty-document',
              message: '文档为空，未提取到可展示的正文内容。',
            }
          : undefined,
      }
    } catch (error) {
      return buildSnapshot('parse-failed', {
        exists: true,
        diagnostics: {
          code: 'parse-failed',
          message: 'OOXML 解析失败，无法构建预览。',
          detail: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }

  async writeOoxmlPackage(filePath: string, payload: OoxmlWritePayload): Promise<OoxmlWriteResult> {
    const target = path.resolve(String(filePath))
    const normalizedBlocks = normalizeDocumentStructure(normalizeWritePayload(payload))

    try {
      let created = false
      let zip: JSZip | null = null

      try {
        const buffer = await fs.readFile(target)
        zip = await JSZip.loadAsync(buffer)
      } catch {
        await createMinimalDocxPackage(target)
        const buffer = await fs.readFile(target)
        zip = await JSZip.loadAsync(buffer)
        created = true
      }

      if (!zip) {
        return { success: false, filePath: target, paragraphCount: 0, entryCount: 0, created: false }
      }

      const documentEntry = zip.file('word/document.xml')
      if (!documentEntry) {
        return { success: false, filePath: target, paragraphCount: 0, entryCount: Object.keys(zip.files).length, created: false }
      }

      const documentXml = await documentEntry.async('text')
      const rootRelationshipsEntry = zip.file('_rels/.rels')
      const relationshipsEntry = zip.file('word/_rels/document.xml.rels')
      const contentTypesEntry = zip.file('[Content_Types].xml')
      const contentTypesXml = contentTypesEntry ? await contentTypesEntry.async('text') : null
      const rootRelationshipsXml = rootRelationshipsEntry ? await rootRelationshipsEntry.async('text') : null
      const relationshipsXml = relationshipsEntry ? await relationshipsEntry.async('text') : null
      const imageResources = ensureImageRelationshipResources(normalizedBlocks, relationshipsXml)
      const nextBlocks = imageResources.blocks
      const bibliographyResources = await ensureBibliographyResources(zip, nextBlocks, rootRelationshipsXml, contentTypesXml)
      zip.file('word/document.xml', writeBlocksIntoDocumentXml(
        documentXml,
        nextBlocks,
        bibliographyResources.sourceTagMap,
        payload.documentSectionPropertiesXml,
      ))
      const numberingResources = await ensureNumberingResources(zip, nextBlocks, imageResources.relationshipsXml, bibliographyResources.contentTypesXml)
      const styleResources = await ensureStylesResources(zip, nextBlocks, numberingResources.relationshipsXml, numberingResources.contentTypesXml)
      const nextRelationshipsXml = rewriteDocumentRelationshipsXml(styleResources.relationshipsXml || numberingResources.relationshipsXml || imageResources.relationshipsXml || relationshipsXml || '', nextBlocks)
      const nextContentTypesXml = await syncImageMediaEntries(zip, nextBlocks, nextRelationshipsXml, styleResources.contentTypesXml)
      zip.file('word/_rels/document.xml.rels', nextRelationshipsXml)
      if (bibliographyResources.rootRelationshipsXml) {
        zip.file('_rels/.rels', bibliographyResources.rootRelationshipsXml)
      }
      if (nextContentTypesXml) {
        zip.file('[Content_Types].xml', nextContentTypesXml)
      }

      const output = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, output)

      return {
        success: true,
        filePath: target,
        paragraphCount: nextBlocks.filter((block) => block.kind === 'heading' || block.kind === 'paragraph').length,
        entryCount: Object.keys(zip.files).length,
        created,
      }
    } catch {
      return { success: false, filePath: target, paragraphCount: 0, entryCount: 0, created: false }
    }
  }
}