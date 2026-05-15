import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import mammoth from 'mammoth'
import { cleanupPreparedCompatibleDocxSource, prepareCompatibleDocxSource, WORD_COMPATIBILITY_ERROR_MESSAGE } from './wordDocumentCompatibility'
import { completeText } from './llmClient'
import type { AppSettings } from './settingsStore'
import type { KnowledgeDocumentJson } from '../../../src/types/knowledgeDocumentJson'
import { isKnowledgeDocumentJson } from '../../../src/types/knowledgeDocumentJson'
import { buildKnowledgeDocumentJsonFromPlainText } from '../../../src/shared/knowledge/knowledgeDocumentJson'
import { importFileToKnowledgeJson } from './knowledgeJsonImport'

const execFileAsync = promisify(execFile)

export type KnowledgeSourceType = 'pdf' | 'docx' | 'doc' | 'txt' | 'md' | 'image' | 'pptx'
export type KnowledgeTemplateType = 'email_reply'
export type KnowledgeTemplateDeclarationSource = 'frontmatter' | 'fields'
export type KnowledgeEmailSubjectStrategy = 'reply-prefix' | 'keep-original' | 'custom-prefix'
export type KnowledgeExtractionStatus = 'ready' | 'failed' | 'pending'
export type KnowledgeVersionKind = 'source' | 'remake'
export type KnowledgeTaskType = 'template-generation' | 'reference-generation' | 'document-remake'
export type KnowledgeTaskStatus = 'submitted' | 'running' | 'completed' | 'failed' | 'stopped'
export type KnowledgeRetrievalMode = 'selected-only' | 'selected-first' | 'auto'

export type KnowledgeDocumentCategory =
  | 'notice' | 'report' | 'briefing' | 'proposal' | 'minutes'
  | 'contract' | 'letter' | 'regulation' | 'plan' | 'summary'
  | 'manual' | 'academic' | 'other'

export interface KnowledgeTemplateInheritanceOptions {
  structure: boolean
  tone: boolean
  terminology: boolean
}

export interface KnowledgeTaskConstraints {
  mode: KnowledgeRetrievalMode
  templateDocumentId?: string
  requiredReferenceDocumentIds: string[]
  preferredReferenceDocumentIds: string[]
  allowAutoRetrieval: boolean
  autoRetrievalLimit: number
  templateInheritance: KnowledgeTemplateInheritanceOptions
}

export interface KnowledgeEmailTemplateMeta {
  title?: string
  summary?: string
  category?: string
  tone?: string
  opening?: string
  closing?: string
  signature?: string
  subjectStrategy?: KnowledgeEmailSubjectStrategy
  subjectPrefix?: string
  priority?: number
  defaultSelected?: boolean
  declarationSource?: KnowledgeTemplateDeclarationSource
}

export interface KnowledgeChunkMeta {
  id: string
  documentId: string
  versionId?: string
  order: number
  titlePath: string[]
  sectionLabel?: string
  pageStart?: number
  pageEnd?: number
  paragraphStart?: number
  paragraphEnd?: number
  text: string
  normalizedText: string
  summary: string
  keywords: string[]
  tokenEstimate: number
  sourceType: KnowledgeSourceType
  createdAt: string
  updatedAt: string
}

export interface KnowledgeDocumentChunkIndex {
  documentId: string
  versionId?: string
  updatedAt: string
  chunks: KnowledgeChunkMeta[]
}

export interface KnowledgeRetrievalQuery {
  query: string
  mode: KnowledgeRetrievalMode
  templateDocumentId?: string
  requiredReferenceDocumentIds?: string[]
  preferredReferenceDocumentIds?: string[]
  includeDocumentIds?: string[]
  excludeDocumentIds?: string[]
  sourceTypes?: KnowledgeSourceType[]
  maxChunks?: number
}

export type KnowledgeRetrievalHitSource = 'required-reference' | 'preferred-reference' | 'auto-retrieval'
export type KnowledgeRetrievalMatchType = 'keyword' | 'summary' | 'title' | 'heuristic'

export interface KnowledgeRetrievalHit {
  chunk: KnowledgeChunkMeta
  score: number
  source: KnowledgeRetrievalHitSource
  matchedBy: KnowledgeRetrievalMatchType[]
  quote: string
}

export interface KnowledgeCitation {
  id: string
  documentId: string
  chunkId: string
  sourceKind: 'template' | KnowledgeRetrievalHitSource
  documentTitle: string
  locatorLabel: string
  quote: string
  score?: number
}

export interface KnowledgeGenerationTrace {
  templateDocumentId?: string
  requiredReferenceDocumentIds: string[]
  preferredReferenceDocumentIds: string[]
  retrievedHits: KnowledgeRetrievalHit[]
  citations: KnowledgeCitation[]
  coverage: {
    templateApplied: boolean
    explicitReferenceCount: number
    autoRetrievedCount: number
  }
}

export interface PreviewKnowledgeTaskContextInput {
  instruction: string
  constraints?: KnowledgeTaskConstraints
  documentId?: string
  sourceVersionId?: string
  topK?: number
}

export interface PreviewKnowledgeTaskContextResult {
  templateSummary?: string
  explicitReferenceSummaries: Array<{ documentId: string; title: string }>
  retrievedHits: KnowledgeRetrievalHit[]
  citations: KnowledgeCitation[]
}

export interface KnowledgeRetrievalResult {
  hits: KnowledgeRetrievalHit[]
  citations: KnowledgeCitation[]
}

export interface KnowledgeDocumentMeta {
  id: string
  title: string
  originalName: string
  sourceType: KnowledgeSourceType
  templateType?: KnowledgeTemplateType
  emailTemplate?: KnowledgeEmailTemplateMeta
  mimeType: string
  hash: string
  importedAt: string
  updatedAt: string
  size: number
  storedRelativePath: string
  thumbnailPath?: string
  thumbnailRelativePath?: string
  originalPath?: string
  originalRelativePath?: string
  extractedRelativePath: string
  extractionStatus: KnowledgeExtractionStatus
  extractedTextLength: number
  previewText: string
  latestVersionId?: string
  versionCount: number
  templateUsageCount: number
  lastUsedAsTemplateAt?: string
  lastRemadeAt?: string
  errorMessage?: string
  documentCategory?: KnowledgeDocumentCategory
  categoryDetail?: string
  categoryConfidence?: number
}

export interface KnowledgeDocumentVersionMeta {
  id: string
  documentId: string
  versionNumber: number
  kind: KnowledgeVersionKind
  title: string
  createdAt: string
  updatedAt: string
  parentVersionId?: string
  instruction?: string
  textRelativePath: string
  textLength: number
  previewText: string
  taskId?: string
}

export interface KnowledgeTaskRecord {
  id: string
  externalTaskId?: string
  type: KnowledgeTaskType
  status: KnowledgeTaskStatus
  title: string
  createdAt: string
  updatedAt: string
  documentId?: string
  sourceDocumentIds: string[]
  templateDocumentId?: string
  referenceDocumentIds: string[]
  constraints?: KnowledgeTaskConstraints
  generationTrace?: KnowledgeGenerationTrace
  sourceVersionId?: string
  outputVersionId?: string
  templateTitle?: string
  referenceTitles?: string[]
  instruction?: string
  outputPreview?: string
  errorMessage?: string
}

interface KnowledgeBundledSeedState {
  version: string
  completedAt: string
  seededFileNames: string[]
}

interface KnowledgeLibraryIndex {
  version: 2
  createdAt: string
  updatedAt: string
  documents: KnowledgeDocumentMeta[]
  versions: KnowledgeDocumentVersionMeta[]
  tasks: KnowledgeTaskRecord[]
  bundledSeedState?: KnowledgeBundledSeedState
}

export interface KnowledgeBundledSeedConfig {
  enabled?: boolean
  version: string
  filePaths: string[]
}

export interface KnowledgeServiceOptions {
  bundledSeeds?: KnowledgeBundledSeedConfig
}

export interface KnowledgeLibraryInfo {
  rootPath: string
  documentCount: number
  createdAt: string
  updatedAt: string
}

export interface KnowledgeDocumentVersionDetail {
  meta: KnowledgeDocumentVersionMeta
  text: string
}

export interface KnowledgeDocumentDetail {
  meta: KnowledgeDocumentMeta
  extractedText: string
  originalExtractedText: string
  currentVersionId: string | null
  versions: KnowledgeDocumentVersionMeta[]
  tasks: KnowledgeTaskRecord[]
  chunkCount?: number
  parsedDocument: KnowledgeDocumentJson | null
  parsedDocumentRelativePath?: string
  chunkIndexRelativePath?: string
  assetDirRelativePath?: string
}

export interface KnowledgeImportResult {
  imported: KnowledgeDocumentMeta[]
  duplicates: KnowledgeDocumentMeta[]
  failed: Array<{ filePath: string; fileName: string; error: string }>
}

export interface SaveKnowledgeTaskInput {
  id?: string
  externalTaskId?: string
  type: KnowledgeTaskType
  status: KnowledgeTaskStatus
  title: string
  documentId?: string
  sourceDocumentIds?: string[]
  templateDocumentId?: string
  referenceDocumentIds?: string[]
  constraints?: KnowledgeTaskConstraints
  generationTrace?: KnowledgeGenerationTrace
  sourceVersionId?: string
  outputVersionId?: string
  instruction?: string
  outputPreview?: string
  errorMessage?: string
}

export interface CreateKnowledgeRemakeVersionInput {
  taskId?: string
  documentId: string
  title?: string
  instruction: string
  content: string
  sourceVersionId?: string
  templateDocumentId?: string
  referenceDocumentIds?: string[]
  constraints?: KnowledgeTaskConstraints
  generationTrace?: KnowledgeGenerationTrace
}

export interface KnowledgeRemakeTaskParams {
  documentId: string
  sourceVersionId?: string
  instruction: string
  title?: string
  templateDocumentId?: string
  referenceDocumentIds?: string[]
  constraints?: KnowledgeTaskConstraints
}

const PDF_EXTRACT_SCRIPT = String.raw`
import sys

path = sys.argv[1]
reader = None
errors = []

for module_name in ('pypdf', 'PyPDF2'):
    try:
        if module_name == 'pypdf':
            from pypdf import PdfReader
        else:
            from PyPDF2 import PdfReader
        reader = PdfReader(path)
        break
    except Exception as exc:
        errors.append(str(exc))

if reader is None:
    sys.stderr.write('未找到可用的 PDF 解析依赖（pypdf / PyPDF2）')
    sys.exit(2)

parts = []
for page in reader.pages:
    try:
        parts.append(page.extract_text() or '')
    except Exception:
        parts.append('')

sys.stdout.write('\n\n'.join(parts))
`

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true })
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function writeJsonAtomic(filePath: string, payload: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath))
  const tempPath = `${filePath}.tmp-${Date.now()}`
  await fs.writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf-8')
  await fs.rename(tempPath, filePath)
}

function normalizeText(value: string): string {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/\u0000/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function nowIso(): string {
  return new Date().toISOString()
}

function sanitizeSegment(value: string): string {
  return String(value || '')
    .trim()
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'knowledge-item'
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeDeclarationKey(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '')
}

function parseBooleanLike(value: string): boolean | undefined {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return undefined
  if (['true', '1', 'yes', 'y', 'on', '是', '默认', '默认模板'].includes(normalized)) return true
  if (['false', '0', 'no', 'n', 'off', '否'].includes(normalized)) return false
  return undefined
}

function parseNumberLike(value: string): number | undefined {
  const normalized = Number(String(value || '').trim())
  return Number.isFinite(normalized) ? normalized : undefined
}

function normalizeTemplateType(value: string): KnowledgeTemplateType | undefined {
  const normalized = normalizeDeclarationKey(value)
  if (['emailreply', 'emailreplytemplate'].includes(normalized)) return 'email_reply'
  return undefined
}

function normalizeSubjectStrategy(value: string): KnowledgeEmailSubjectStrategy | undefined {
  const normalized = normalizeDeclarationKey(value)
  if (['replyprefix', 're', 'reply'].includes(normalized)) return 'reply-prefix'
  if (['keeporiginal', 'original', 'same'].includes(normalized)) return 'keep-original'
  if (['customprefix', 'custom'].includes(normalized)) return 'custom-prefix'
  return undefined
}

function normalizeMultilineValue(value: string): string | undefined {
  const normalized = String(value || '').replace(/\r\n/g, '\n').trim()
  return normalized || undefined
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const TEMPLATE_TYPE_LABELS = ['templateType', '模板类型']
const TEMPLATE_TITLE_LABELS = ['templateTitle', '标题', '模板标题']
const TEMPLATE_SUMMARY_LABELS = ['templateSummary', '摘要', '模板摘要', '简介']
const TEMPLATE_CATEGORY_LABELS = ['templateCategory', '模板类别', '类别']
const TEMPLATE_TONE_LABELS = ['templateTone', '模板语气', '语气', '风格']
const TEMPLATE_OPENING_LABELS = ['templateOpening', '开场', '开头']
const TEMPLATE_CLOSING_LABELS = ['templateClosing', '结尾', '结束语']
const TEMPLATE_SIGNATURE_LABELS = ['templateSignature', '签名', '落款']
const TEMPLATE_SUBJECT_STRATEGY_LABELS = ['templateSubjectStrategy', '主题策略', '邮件主题策略']
const TEMPLATE_SUBJECT_PREFIX_LABELS = ['templateSubjectPrefix', '主题前缀', '邮件主题前缀']
const TEMPLATE_PRIORITY_LABELS = ['templatePriority', '模板优先级', '优先级']
const TEMPLATE_DEFAULT_LABELS = ['templateDefault', 'defaultTemplate', '默认模板']

function extractLabeledLine(text: string, labels: string[]): string {
  const labelPattern = labels.map(escapeRegExp).join('|')
  const match = text.match(new RegExp(`(?:^|\\n)\\s*(?:#{1,6}\\s*)?(?:${labelPattern})\\s*[:：]\\s*(.+)$`, 'im'))
  return match ? String(match[1] || '').trim() : ''
}

function extractLabeledBlock(text: string, labels: string[], stopLabels: string[]): string {
  const labelPattern = labels.map(escapeRegExp).join('|')
  const stopPattern = stopLabels.map(escapeRegExp).join('|')
  const match = text.match(new RegExp(
    `(?:^|\\n)\\s*(?:#{1,6}\\s*)?(?:${labelPattern})\\s*[:：]?\\s*(?:\\n+)?([\\s\\S]*?)(?=\\n\\s*(?:#{1,6}\\s*)?(?:${stopPattern})\\s*[:：]?|$)`,
    'i',
  ))
  return match ? String(match[1] || '').replace(/\r\n/g, '\n').trim() : ''
}

function parseSimpleFrontmatter(text: string): { attributes: Record<string, string>; body: string } {
  const normalized = String(text || '').replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  if (lines[0]?.trim() !== '---') {
    return { attributes: {}, body: normalized }
  }

  const attributes: Record<string, string> = {}
  let index = 1
  while (index < lines.length) {
    const line = lines[index]
    if (line.trim() === '---' || line.trim() === '...') {
      index += 1
      break
    }
    const match = line.match(/^([^:#]+?)\s*:\s*(.*)$/)
    if (!match) {
      index += 1
      continue
    }

    const key = normalizeDeclarationKey(match[1])
    const rawValue = String(match[2] || '')
    if (rawValue === '|' || rawValue === '>') {
      index += 1
      const blockLines: string[] = []
      while (index < lines.length) {
        const blockLine = lines[index]
        if (blockLine.trim() === '---' || blockLine.trim() === '...') break
        if (/^\s+/.test(blockLine) || blockLine === '') {
          blockLines.push(blockLine.replace(/^\s{2}/, ''))
          index += 1
          continue
        }
        break
      }
      attributes[key] = blockLines.join('\n').trim()
      continue
    }

    attributes[key] = rawValue.trim()
    index += 1
  }

  return {
    attributes,
    body: lines.slice(index).join('\n'),
  }
}

function normalizeEmailTemplateMeta(value: unknown): KnowledgeEmailTemplateMeta | undefined {
  const record = typeof value === 'object' && value ? (value as Record<string, unknown>) : null
  if (!record) return undefined
  const priority = Number(record.priority)
  return {
    title: String(record.title || '').trim() || undefined,
    summary: normalizeMultilineValue(String(record.summary || '')),
    category: String(record.category || '').trim() || undefined,
    tone: String(record.tone || '').trim() || undefined,
    opening: normalizeMultilineValue(String(record.opening || '')),
    closing: normalizeMultilineValue(String(record.closing || '')),
    signature: normalizeMultilineValue(String(record.signature || '')),
    subjectStrategy: normalizeSubjectStrategy(String(record.subjectStrategy || '')),
    subjectPrefix: String(record.subjectPrefix || '').trim() || undefined,
    priority: Number.isFinite(priority) ? priority : undefined,
    defaultSelected: typeof record.defaultSelected === 'boolean' ? record.defaultSelected : parseBooleanLike(String(record.defaultSelected || '')),
    declarationSource: record.declarationSource === 'frontmatter' || record.declarationSource === 'fields'
      ? record.declarationSource
      : undefined,
  }
}

interface ExplicitEmailTemplateDeclaration {
  templateType: KnowledgeTemplateType
  emailTemplate: KnowledgeEmailTemplateMeta
  bodyText: string
}

function parseExplicitEmailTemplateDeclaration(text: string): ExplicitEmailTemplateDeclaration | null {
  const rawText = String(text || '').replace(/\r\n/g, '\n')
  const frontmatter = parseSimpleFrontmatter(rawText)
  const normalizedAttributes = frontmatter.attributes
  const stopLabels = [
    ...TEMPLATE_TYPE_LABELS,
    ...TEMPLATE_TITLE_LABELS,
    ...TEMPLATE_SUMMARY_LABELS,
    ...TEMPLATE_CATEGORY_LABELS,
    ...TEMPLATE_TONE_LABELS,
    ...TEMPLATE_OPENING_LABELS,
    ...TEMPLATE_CLOSING_LABELS,
    ...TEMPLATE_SIGNATURE_LABELS,
    ...TEMPLATE_SUBJECT_STRATEGY_LABELS,
    ...TEMPLATE_SUBJECT_PREFIX_LABELS,
    ...TEMPLATE_PRIORITY_LABELS,
    ...TEMPLATE_DEFAULT_LABELS,
  ]

  const frontmatterTemplateType = normalizeTemplateType(normalizedAttributes[normalizeDeclarationKey('templateType')] || normalizedAttributes[normalizeDeclarationKey('模板类型')] || '')
  const fieldTemplateType = normalizeTemplateType(extractLabeledLine(frontmatter.body, TEMPLATE_TYPE_LABELS))
  const declarationSource: KnowledgeTemplateDeclarationSource | undefined = frontmatterTemplateType
    ? 'frontmatter'
    : fieldTemplateType
      ? 'fields'
      : undefined

  if (!declarationSource) return null

  const templateType = frontmatterTemplateType || fieldTemplateType
  if (templateType !== 'email_reply') return null

  const getAttribute = (...keys: string[]) => {
    for (const key of keys) {
      const value = normalizedAttributes[normalizeDeclarationKey(key)]
      if (String(value || '').trim()) return String(value || '').trim()
    }
    return ''
  }

  const bodyText = frontmatter.body.trim() || rawText.trim()
  const title = getAttribute('templateTitle', '标题', '模板标题') || extractLabeledLine(frontmatter.body, TEMPLATE_TITLE_LABELS)
  const summary = getAttribute('templateSummary', '摘要', '模板摘要', '简介')
    || extractLabeledBlock(frontmatter.body, TEMPLATE_SUMMARY_LABELS, stopLabels)
    || extractLabeledLine(frontmatter.body, TEMPLATE_SUMMARY_LABELS)
  const category = getAttribute('templateCategory', '模板类别', '类别') || extractLabeledLine(frontmatter.body, TEMPLATE_CATEGORY_LABELS)
  const tone = getAttribute('templateTone', '模板语气', '语气', '风格') || extractLabeledLine(frontmatter.body, TEMPLATE_TONE_LABELS)
  const opening = getAttribute('templateOpening', '开场', '开头') || extractLabeledBlock(frontmatter.body, TEMPLATE_OPENING_LABELS, stopLabels)
  const closing = getAttribute('templateClosing', '结尾', '结束语') || extractLabeledBlock(frontmatter.body, TEMPLATE_CLOSING_LABELS, stopLabels)
  const signature = getAttribute('templateSignature', '签名', '落款') || extractLabeledBlock(frontmatter.body, TEMPLATE_SIGNATURE_LABELS, stopLabels)
  const subjectStrategy = normalizeSubjectStrategy(getAttribute('templateSubjectStrategy', '主题策略', '邮件主题策略') || extractLabeledLine(frontmatter.body, TEMPLATE_SUBJECT_STRATEGY_LABELS))
  const subjectPrefix = getAttribute('templateSubjectPrefix', '主题前缀', '邮件主题前缀') || extractLabeledLine(frontmatter.body, TEMPLATE_SUBJECT_PREFIX_LABELS)
  const priority = parseNumberLike(getAttribute('templatePriority', '模板优先级', '优先级') || extractLabeledLine(frontmatter.body, TEMPLATE_PRIORITY_LABELS))
  const defaultSelected = parseBooleanLike(getAttribute('templateDefault', 'defaultTemplate', '默认模板') || extractLabeledLine(frontmatter.body, TEMPLATE_DEFAULT_LABELS))

  return {
    templateType,
    emailTemplate: {
      title: title || undefined,
      summary: normalizeMultilineValue(summary),
      category: category || undefined,
      tone: tone || undefined,
      opening: normalizeMultilineValue(opening),
      closing: normalizeMultilineValue(closing),
      signature: normalizeMultilineValue(signature),
      subjectStrategy,
      subjectPrefix: subjectPrefix || undefined,
      priority,
      defaultSelected,
      declarationSource,
    },
    bodyText,
  }
}

function detectMimeType(sourceType: KnowledgeSourceType): string {
  if (sourceType === 'pdf') return 'application/pdf'
  if (sourceType === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (sourceType === 'doc') return 'application/msword'
  if (sourceType === 'pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  if (sourceType === 'md') return 'text/markdown'
  if (sourceType === 'image') return 'image/*'
  return 'text/plain'
}

function resolveSourceType(filePath: string): KnowledgeSourceType {
  const extension = path.extname(String(filePath || '')).toLowerCase()
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'].includes(extension)) return 'image'
  if (extension === '.pdf') return 'pdf'
  if (extension === '.docx') return 'docx'
  if (extension === '.doc') return 'doc'
  if (extension === '.pptx') return 'pptx'
  if (extension === '.md' || extension === '.markdown') return 'md'
  return 'txt'
}

function detectMimeTypeFromPath(filePath: string): string {
  const extension = path.extname(String(filePath || '')).toLowerCase()
  if (extension === '.png') return 'image/png'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.gif') return 'image/gif'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.svg') return 'image/svg+xml'
  if (extension === '.bmp') return 'image/bmp'
  return 'image/*'
}

function buildDocumentId(fileName: string, hash: string): string {
  const stem = sanitizeSegment(path.basename(fileName, path.extname(fileName))) || 'knowledge-doc'
  return `${stem}-${hash.slice(0, 12)}`
}

function buildVersionId(documentId: string, versionNumber: number): string {
  return `${documentId}-v${versionNumber}`
}

function previewText(text: string): string {
  return normalizeText(text).slice(0, 280)
}

function buildKnowledgeExtractionFailureMessage(sourceType: KnowledgeSourceType, errorMessage?: string): string {
  const normalized = String(errorMessage || '').trim()
  if (normalized) return normalized
  if (sourceType === 'doc') {
    return `DOC 导入失败：${WORD_COMPATIBILITY_ERROR_MESSAGE}。`
  }
  if (sourceType === 'pptx') {
    return 'PPTX 结构化解析失败，请检查文件是否损坏后重试。'
  }
  return '文档抽取失败，请重试。'
}

function normalizeLegacyExtractionState(document: KnowledgeDocumentMeta): KnowledgeDocumentMeta {
  if (document.extractionStatus !== 'pending') return document
  if (document.sourceType !== 'doc') return document

  return {
    ...document,
    extractionStatus: 'failed',
    errorMessage: buildKnowledgeExtractionFailureMessage(document.sourceType, document.errorMessage),
    previewText: document.previewText || 'DOC 导入失败，未能完成文本抽取。',
  }
}

function normalizeTemplateInheritanceOptions(value: unknown): KnowledgeTemplateInheritanceOptions {
  const record = typeof value === 'object' && value ? (value as Record<string, unknown>) : {}
  return {
    structure: record.structure !== false,
    tone: record.tone !== false,
    terminology: record.terminology !== false,
  }
}

function normalizeTaskConstraints(value: unknown): KnowledgeTaskConstraints | undefined {
  const record = typeof value === 'object' && value ? (value as Record<string, unknown>) : null
  if (!record) return undefined
  return {
    mode: record.mode === 'selected-only' || record.mode === 'selected-first' || record.mode === 'auto'
      ? record.mode
      : 'selected-first',
    templateDocumentId: String(record.templateDocumentId || '').trim() || undefined,
    requiredReferenceDocumentIds: Array.isArray(record.requiredReferenceDocumentIds)
      ? record.requiredReferenceDocumentIds.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    preferredReferenceDocumentIds: Array.isArray(record.preferredReferenceDocumentIds)
      ? record.preferredReferenceDocumentIds.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    allowAutoRetrieval: record.allowAutoRetrieval !== false,
    autoRetrievalLimit: Math.max(1, Math.min(12, Number(record.autoRetrievalLimit || 5))),
    templateInheritance: normalizeTemplateInheritanceOptions(record.templateInheritance),
  }
}

function normalizeChunkMeta(value: unknown): KnowledgeChunkMeta | null {
  const record = typeof value === 'object' && value ? (value as Record<string, unknown>) : null
  if (!record) return null
  const id = String(record.id || '').trim()
  const documentId = String(record.documentId || '').trim()
  if (!id || !documentId) return null
  return {
    id,
    documentId,
    versionId: String(record.versionId || '').trim() || undefined,
    order: Math.max(0, Number(record.order || 0)),
    titlePath: Array.isArray(record.titlePath) ? record.titlePath.map((item) => String(item || '').trim()).filter(Boolean) : [],
    sectionLabel: String(record.sectionLabel || '').trim() || undefined,
    pageStart: Number.isFinite(Number(record.pageStart)) ? Number(record.pageStart) : undefined,
    pageEnd: Number.isFinite(Number(record.pageEnd)) ? Number(record.pageEnd) : undefined,
    paragraphStart: Number.isFinite(Number(record.paragraphStart)) ? Number(record.paragraphStart) : undefined,
    paragraphEnd: Number.isFinite(Number(record.paragraphEnd)) ? Number(record.paragraphEnd) : undefined,
    text: String(record.text || ''),
    normalizedText: String(record.normalizedText || record.text || ''),
    summary: String(record.summary || ''),
    keywords: Array.isArray(record.keywords) ? record.keywords.map((item) => String(item || '').trim()).filter(Boolean) : [],
    tokenEstimate: Math.max(1, Number(record.tokenEstimate || 1)),
    sourceType: (record.sourceType as KnowledgeSourceType) || 'txt',
    createdAt: String(record.createdAt || nowIso()),
    updatedAt: String(record.updatedAt || record.createdAt || nowIso()),
  }
}

function normalizeRetrievalHit(value: unknown): KnowledgeRetrievalHit | null {
  const record = typeof value === 'object' && value ? (value as Record<string, unknown>) : null
  const chunk = normalizeChunkMeta(record?.chunk)
  if (!record || !chunk) return null
  return {
    chunk,
    score: Number(record.score || 0),
    source: record.source === 'required-reference' || record.source === 'preferred-reference' || record.source === 'auto-retrieval'
      ? record.source
      : 'auto-retrieval',
    matchedBy: Array.isArray(record.matchedBy)
      ? record.matchedBy.filter((item): item is KnowledgeRetrievalMatchType => item === 'keyword' || item === 'summary' || item === 'title' || item === 'heuristic')
      : [],
    quote: String(record.quote || ''),
  }
}

function normalizeCitation(value: unknown): KnowledgeCitation | null {
  const record = typeof value === 'object' && value ? (value as Record<string, unknown>) : null
  if (!record) return null
  const id = String(record.id || '').trim()
  const documentId = String(record.documentId || '').trim()
  const chunkId = String(record.chunkId || '').trim()
  if (!id || !documentId || !chunkId) return null
  return {
    id,
    documentId,
    chunkId,
    sourceKind: record.sourceKind === 'template' || record.sourceKind === 'required-reference' || record.sourceKind === 'preferred-reference' || record.sourceKind === 'auto-retrieval'
      ? record.sourceKind
      : 'auto-retrieval',
    documentTitle: String(record.documentTitle || ''),
    locatorLabel: String(record.locatorLabel || ''),
    quote: String(record.quote || ''),
    score: Number.isFinite(Number(record.score)) ? Number(record.score) : undefined,
  }
}

function normalizeGenerationTrace(value: unknown): KnowledgeGenerationTrace | undefined {
  const record = typeof value === 'object' && value ? (value as Record<string, unknown>) : null
  if (!record) return undefined
  return {
    templateDocumentId: String(record.templateDocumentId || '').trim() || undefined,
    requiredReferenceDocumentIds: Array.isArray(record.requiredReferenceDocumentIds)
      ? record.requiredReferenceDocumentIds.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    preferredReferenceDocumentIds: Array.isArray(record.preferredReferenceDocumentIds)
      ? record.preferredReferenceDocumentIds.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    retrievedHits: Array.isArray(record.retrievedHits) ? record.retrievedHits.map((item) => normalizeRetrievalHit(item)).filter(Boolean) as KnowledgeRetrievalHit[] : [],
    citations: Array.isArray(record.citations) ? record.citations.map((item) => normalizeCitation(item)).filter(Boolean) as KnowledgeCitation[] : [],
    coverage: {
      templateApplied: Boolean((record.coverage as Record<string, unknown> | undefined)?.templateApplied),
      explicitReferenceCount: Number((record.coverage as Record<string, unknown> | undefined)?.explicitReferenceCount || 0),
      autoRetrievedCount: Number((record.coverage as Record<string, unknown> | undefined)?.autoRetrievedCount || 0),
    },
  }
}

function sortVersions(versions: KnowledgeDocumentVersionMeta[]): KnowledgeDocumentVersionMeta[] {
  return [...versions].sort((left, right) => {
    if (left.versionNumber !== right.versionNumber) return right.versionNumber - left.versionNumber
    return String(right.createdAt || '').localeCompare(String(left.createdAt || ''))
  })
}

function sortTasks(tasks: KnowledgeTaskRecord[]): KnowledgeTaskRecord[] {
  return [...tasks].sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))
}

async function hashFile(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath)
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

async function tryPdfTextWithPython(filePath: string): Promise<string> {
  for (const command of ['python3', 'python']) {
    try {
      const { stdout } = await execFileAsync(command, ['-c', PDF_EXTRACT_SCRIPT, filePath], {
        timeout: 120000,
        maxBuffer: 20 * 1024 * 1024,
      })
      const text = normalizeText(stdout)
      if (text) return text
    } catch {
      continue
    }
  }
  return ''
}

async function tryPdfTextWithPdftotext(filePath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('pdftotext', ['-layout', filePath, '-'], {
      timeout: 120000,
      maxBuffer: 20 * 1024 * 1024,
    })
    return normalizeText(stdout)
  } catch {
    return ''
  }
}

async function extractPdfText(filePath: string): Promise<string> {
  const pythonText = await tryPdfTextWithPython(filePath)
  if (pythonText) return pythonText
  const pdftotext = await tryPdfTextWithPdftotext(filePath)
  if (pdftotext) return pdftotext
  throw new Error('当前环境缺少可用的 PDF 文本提取能力（pypdf/PyPDF2 或 pdftotext）')
}

async function extractDocxText(filePath: string): Promise<string> {
  const result = await mammoth.extractRawText({ path: filePath })
  return normalizeText(result.value || '')
}

async function extractWordText(filePath: string): Promise<string> {
  const prepared = await prepareCompatibleDocxSource(filePath)
  try {
    return await extractDocxText(prepared.filePath)
  } finally {
    await cleanupPreparedCompatibleDocxSource(prepared)
  }
}

async function extractTextForFile(filePath: string, sourceType: KnowledgeSourceType): Promise<string> {
  if (sourceType === 'image') {
    return ''
  }
  if (sourceType === 'txt' || sourceType === 'md') {
    return normalizeText(await fs.readFile(filePath, 'utf-8'))
  }
  if (sourceType === 'docx' || sourceType === 'doc') {
    return extractWordText(filePath)
  }
  if (sourceType === 'pptx') {
    throw new Error('PPTX 需要结构化导入适配器，当前 fallback 不支持直接抽取')
  }
  return extractPdfText(filePath)
}

const VALID_CATEGORIES: KnowledgeDocumentCategory[] = [
  'notice', 'report', 'briefing', 'proposal', 'minutes',
  'contract', 'letter', 'regulation', 'plan', 'summary',
  'manual', 'academic', 'other',
]

const CATEGORY_DESCRIPTIONS: Record<KnowledgeDocumentCategory, string> = {
  notice: '通知类 — 上级对下级的指示、通告、公告',
  report: '报告类 — 工作报告、调研报告、分析报告',
  briefing: '汇报类 — 工作汇报、进展汇报、述职',
  proposal: '方案/提案类 — 实施方案、策划方案、建议书',
  minutes: '会议纪要类 — 会议记录、纪要、决议',
  contract: '合同/协议类 — 商务合同、合作协议、意向书',
  letter: '函件/信函类 — 邀请函、感谢信、公函、拜访函',
  regulation: '制度/规章类 — 管理制度、操作规范、章程',
  plan: '计划/规划类 — 工作计划、年度规划、项目排期',
  summary: '总结类 — 工作总结、年度总结、项目复盘',
  manual: '说明书/手册类 — 产品说明书、用户手册、操作指南',
  academic: '学术论文类 — 期刊论文、学位论文、研究摘要',
  other: '其他 — 无法归入以上类别',
}

function buildClassificationPrompt(): string {
  const categoryList = VALID_CATEGORIES
    .map((cat) => `- ${cat}: ${CATEGORY_DESCRIPTIONS[cat]}`)
    .join('\n')
  return `你是一个文档分类专家。请根据文档内容判断其所属大类和具体子类别。

可选的大类如下：
${categoryList}

分类规则：
1. 先选择最匹配的大类（category）
2. 再根据文档实际内容，用简短中文给出更精确的子类别描述（detail），2-8个字
   - 例如大类是 notice 时，detail 可以是"停水通知""停电通知""校巴停运通知""人事任免通知""考试安排通知"等
   - 例如大类是 report 时，detail 可以是"市场调研报告""年度财务报告""实验报告""审计报告"等
   - 例如大类是 letter 时，detail 可以是"拜访函""邀请函""感谢信""催款函"等
   - 例如大类是 plan 时，detail 可以是"学期教学计划""项目实施计划""预算计划"等
   - detail 应尽量具体、贴合文档实际内容，不要照搬大类名称

请严格按照以下 JSON 格式回复，不要输出任何其他内容：
{"category": "<类别英文标识>", "detail": "<具体子类别中文>", "confidence": <0到1之间的置信度数字>}

如果文档内容太短或无法判断，请返回：
{"category": "other", "detail": "未知类型", "confidence": 0.3}`
}

interface ClassificationResult {
  category: KnowledgeDocumentCategory
  detail: string
  confidence: number
}

async function classifyDocumentText(
  settings: AppSettings,
  text: string,
  fileName: string,
): Promise<ClassificationResult> {
  const sampleText = text.slice(0, 3000).trim()
  if (!sampleText) {
    return { category: 'other', detail: '', confidence: 0.1 }
  }

  const userPrompt = `文件名：${fileName}\n\n文档内容（前 3000 字）：\n${sampleText}`
  const raw = await completeText(settings, {
    systemPrompt: buildClassificationPrompt(),
    userPrompt,
    temperature: 0.1,
    maxTokens: 120,
  })

  try {
    const cleaned = raw.replace(/```json\s*|```\s*/g, '').trim()
    const parsed = JSON.parse(cleaned) as { category?: string; detail?: string; confidence?: number }
    const cat = String(parsed.category || 'other').toLowerCase().trim() as KnowledgeDocumentCategory
    const detail = String(parsed.detail || '').trim().slice(0, 20)
    const conf = typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5
    if (VALID_CATEGORIES.includes(cat)) {
      return { category: cat, detail, confidence: conf }
    }
  } catch {
    // parse failed — fall through
  }
  return { category: 'other', detail: '', confidence: 0.2 }
}

export class KnowledgeService {
  private getSettings?: () => Promise<AppSettings>

  constructor(
    private readonly rootPath: string,
    private readonly options: KnowledgeServiceOptions = {},
  ) {}

  setSettingsGetter(getter: () => Promise<AppSettings>): void {
    this.getSettings = getter
  }

  private get documentsDir(): string {
    return path.join(this.rootPath, 'documents')
  }

  private getDocumentRootDir(documentId: string): string {
    return path.join(this.documentsDir, documentId)
  }

  private getDocumentSourceDir(documentId: string): string {
    return path.join(this.getDocumentRootDir(documentId), 'source')
  }

  private getDocumentParsedDir(documentId: string): string {
    return path.join(this.getDocumentRootDir(documentId), 'parsed')
  }

  private getDocumentParsedAssetsDir(documentId: string): string {
    return path.join(this.getDocumentParsedDir(documentId), 'assets')
  }

  private get versionsDir(): string {
    return path.join(this.rootPath, 'versions')
  }

  private get tasksDir(): string {
    return path.join(this.rootPath, 'tasks')
  }

  private get trashDir(): string {
    return path.join(this.rootPath, 'trash')
  }

  private get indexPath(): string {
    return path.join(this.rootPath, 'index.json')
  }

  private get bundledSeeds(): KnowledgeBundledSeedConfig | null {
    const configured = this.options.bundledSeeds
    if (!configured || configured.enabled === false) return null
    const version = String(configured.version || '').trim()
    const filePaths = Array.isArray(configured.filePaths)
      ? configured.filePaths.map((item) => String(item || '').trim()).filter(Boolean)
      : []
    if (!version || filePaths.length === 0) return null
    return {
      enabled: true,
      version,
      filePaths,
    }
  }

  async initialize(): Promise<void> {
    await Promise.all([
      ensureDir(this.rootPath),
      ensureDir(this.documentsDir),
      ensureDir(this.versionsDir),
      ensureDir(this.tasksDir),
      ensureDir(this.trashDir),
    ])
    if (!(await pathExists(this.indexPath))) {
      const now = nowIso()
      await writeJsonAtomic(this.indexPath, {
        version: 2,
        createdAt: now,
        updatedAt: now,
        documents: [],
        versions: [],
        tasks: [],
      } satisfies KnowledgeLibraryIndex)
    }
  }

  async importBundledSeedsIfNeeded(): Promise<KnowledgeImportResult> {
    const bundledSeeds = this.bundledSeeds
    if (!bundledSeeds) {
      return { imported: [], duplicates: [], failed: [] }
    }

    const index = await this.readIndex()
    if (index.bundledSeedState?.version === bundledSeeds.version) {
      return { imported: [], duplicates: [], failed: [] }
    }

    const missingFiles: Array<{ filePath: string; fileName: string; error: string }> = []
    const existingFiles: string[] = []
    for (const filePath of bundledSeeds.filePaths) {
      if (await pathExists(filePath)) {
        existingFiles.push(filePath)
      } else {
        missingFiles.push({
          filePath,
          fileName: path.basename(filePath),
          error: 'Bundled seed file is missing',
        })
      }
    }

    const importResult = await this.importDocumentsWithIndex(index, existingFiles, {
      refreshDuplicateMetadata: true,
    })
    const nextIndex: KnowledgeLibraryIndex = {
      ...importResult.index,
      bundledSeedState: missingFiles.length === 0
        ? {
            version: bundledSeeds.version,
            completedAt: nowIso(),
            seededFileNames: bundledSeeds.filePaths.map((filePath) => path.basename(filePath)),
          }
        : importResult.index.bundledSeedState,
    }

    if (importResult.changed || missingFiles.length > 0 || nextIndex.bundledSeedState !== importResult.index.bundledSeedState) {
      await this.writeIndex(nextIndex)
    }

    return {
      imported: importResult.result.imported,
      duplicates: importResult.result.duplicates,
      failed: [...importResult.result.failed, ...missingFiles],
    }
  }

  private async readTextRelative(relativePath: string | undefined): Promise<string> {
    const normalized = String(relativePath || '').trim()
    if (!normalized) return ''
    const targetPath = path.join(this.rootPath, normalized)
    if (!(await pathExists(targetPath))) return ''
    return fs.readFile(targetPath, 'utf-8')
  }

  private async writeVersionText(documentId: string, versionId: string, text: string): Promise<string> {
    const versionDir = path.join(this.versionsDir, documentId)
    await ensureDir(versionDir)
    const targetPath = path.join(versionDir, `${versionId}.txt`)
    await fs.writeFile(targetPath, text, 'utf-8')
    return path.relative(this.rootPath, targetPath).replace(/\\/g, '/')
  }

  private buildTaskRecord(index: KnowledgeLibraryIndex, input: SaveKnowledgeTaskInput, existing?: KnowledgeTaskRecord): KnowledgeTaskRecord {
    const sourceDocumentIds = Array.from(new Set((input.sourceDocumentIds || existing?.sourceDocumentIds || []).map((item) => String(item || '').trim()).filter(Boolean)))
    const referenceDocumentIds = Array.from(new Set((input.referenceDocumentIds || existing?.referenceDocumentIds || []).map((item) => String(item || '').trim()).filter(Boolean)))
    const templateDocumentId = String(input.templateDocumentId || existing?.templateDocumentId || '').trim() || undefined
    const templateTitle = templateDocumentId
      ? index.documents.find((item) => item.id === templateDocumentId)?.title || existing?.templateTitle
      : undefined
    const referenceTitles = referenceDocumentIds
      .map((documentId) => index.documents.find((item) => item.id === documentId)?.title)
      .filter((item): item is string => Boolean(item))

    return {
      id: String(input.id || existing?.id || input.externalTaskId || createId('knowledge-task')),
      externalTaskId: String(input.externalTaskId || existing?.externalTaskId || '').trim() || undefined,
      type: input.type || existing?.type || 'reference-generation',
      status: input.status || existing?.status || 'submitted',
      title: String(input.title || existing?.title || 'Knowledge Task').trim() || 'Knowledge Task',
      createdAt: existing?.createdAt || nowIso(),
      updatedAt: nowIso(),
      documentId: String(input.documentId || existing?.documentId || '').trim() || undefined,
      sourceDocumentIds,
      templateDocumentId,
      referenceDocumentIds,
      constraints: normalizeTaskConstraints(input.constraints) || existing?.constraints,
      generationTrace: normalizeGenerationTrace(input.generationTrace) || existing?.generationTrace,
      sourceVersionId: String(input.sourceVersionId || existing?.sourceVersionId || '').trim() || undefined,
      outputVersionId: String(input.outputVersionId || existing?.outputVersionId || '').trim() || undefined,
      templateTitle,
      referenceTitles: referenceTitles.length ? referenceTitles : existing?.referenceTitles,
      instruction: String(input.instruction || existing?.instruction || '').trim() || undefined,
      outputPreview: String(input.outputPreview || existing?.outputPreview || '').trim() || undefined,
      errorMessage: String(input.errorMessage || existing?.errorMessage || '').trim() || undefined,
    }
  }

  private async ensureIndexConsistency(index: KnowledgeLibraryIndex): Promise<{ index: KnowledgeLibraryIndex; mutated: boolean }> {
    let mutated = false
    const documents: KnowledgeDocumentMeta[] = []
    for (const document of index.documents) {
      const normalized = normalizeLegacyExtractionState(document)
      if (normalized !== document) mutated = true
      const nextDocument: KnowledgeDocumentMeta = {
        ...normalized,
        versionCount: Math.max(0, Number(normalized.versionCount) || 0),
        templateUsageCount: Math.max(0, Number(normalized.templateUsageCount) || 0),
      }

      const canParseTemplateDeclaration = nextDocument.sourceType !== 'image'
      if (canParseTemplateDeclaration) {
        const extractedText = await this.readTextRelative(nextDocument.extractedRelativePath)
        const declaration = extractedText ? parseExplicitEmailTemplateDeclaration(extractedText) : null
        const nextTemplateType = declaration?.templateType
        const nextEmailTemplate = declaration?.emailTemplate
        const nextPreviewText = declaration?.emailTemplate.summary
          || (declaration?.bodyText ? previewText(declaration.bodyText) : nextDocument.previewText)

        if (nextDocument.templateType !== nextTemplateType) {
          nextDocument.templateType = nextTemplateType
          mutated = true
        }

        const currentTemplateMeta = JSON.stringify(nextDocument.emailTemplate || null)
        const nextTemplateMeta = JSON.stringify(nextEmailTemplate || null)
        if (currentTemplateMeta !== nextTemplateMeta) {
          nextDocument.emailTemplate = nextEmailTemplate
          mutated = true
        }

        if (declaration && nextPreviewText && nextDocument.previewText !== nextPreviewText) {
          nextDocument.previewText = nextPreviewText
          mutated = true
        }
      }

      documents.push(nextDocument)
    }
    const versions = [...index.versions]
    const tasks = sortTasks(index.tasks || [])

    for (const document of documents) {
      let documentVersions = sortVersions(versions.filter((item) => item.documentId === document.id))
      if (documentVersions.length === 0) {
        const originalText = await this.readTextRelative(document.extractedRelativePath)
        const versionId = buildVersionId(document.id, 1)
        const textRelativePath = await this.writeVersionText(document.id, versionId, originalText)
        const sourceVersion: KnowledgeDocumentVersionMeta = {
          id: versionId,
          documentId: document.id,
          versionNumber: 1,
          kind: 'source',
          title: `${document.title}（原始导入）`,
          createdAt: document.importedAt || nowIso(),
          updatedAt: document.updatedAt || document.importedAt || nowIso(),
          instruction: '原始导入',
          textRelativePath,
          textLength: originalText.length,
          previewText: previewText(originalText),
        }
        versions.push(sourceVersion)
        documentVersions = [sourceVersion]
        mutated = true
      }

      const currentVersion = document.latestVersionId
        ? documentVersions.find((item) => item.id === document.latestVersionId)
        : null
      const effectiveCurrentVersion = currentVersion || documentVersions[0]
      if (document.latestVersionId !== effectiveCurrentVersion.id) {
        document.latestVersionId = effectiveCurrentVersion.id
        mutated = true
      }
      if (document.versionCount !== documentVersions.length) {
        document.versionCount = documentVersions.length
        mutated = true
      }
      if (document.templateUsageCount === undefined) {
        document.templateUsageCount = 0
        mutated = true
      }
    }

    return {
      index: {
        version: 2,
        createdAt: index.createdAt,
        updatedAt: index.updatedAt,
        documents,
        versions: sortVersions(versions),
        tasks,
        bundledSeedState: index.bundledSeedState,
      },
      mutated,
    }
  }

  private normalizeBundledSeedState(rawState: any): KnowledgeBundledSeedState | undefined {
    const version = String(rawState?.version || '').trim()
    const completedAt = String(rawState?.completedAt || '').trim()
    if (!version || !completedAt) return undefined
    return {
      version,
      completedAt,
      seededFileNames: Array.isArray(rawState?.seededFileNames)
        ? rawState.seededFileNames.map((item: unknown) => String(item || '').trim()).filter(Boolean)
        : [],
    }
  }

  private async readIndex(): Promise<KnowledgeLibraryIndex> {
    await this.initialize()
    let parsed: any = null
    try {
      parsed = JSON.parse(await fs.readFile(this.indexPath, 'utf-8'))
    } catch {
      parsed = null
    }

    const now = nowIso()
    const index: KnowledgeLibraryIndex = {
      version: 2,
      createdAt: String(parsed?.createdAt || now),
      updatedAt: String(parsed?.updatedAt || now),
      documents: Array.isArray(parsed?.documents) ? parsed.documents.map((item: any) => ({
        id: String(item?.id || ''),
        title: String(item?.title || ''),
        originalName: String(item?.originalName || ''),
        sourceType: item?.sourceType as KnowledgeSourceType,
        templateType: normalizeTemplateType(String(item?.templateType || '')),
        emailTemplate: normalizeEmailTemplateMeta(item?.emailTemplate),
        mimeType: String(item?.mimeType || ''),
        hash: String(item?.hash || ''),
        importedAt: String(item?.importedAt || now),
        updatedAt: String(item?.updatedAt || item?.importedAt || now),
        size: Number(item?.size || 0),
        storedRelativePath: String(item?.storedRelativePath || ''),
        thumbnailPath: String(item?.thumbnailPath || '').trim() || undefined,
        thumbnailRelativePath: String(item?.thumbnailRelativePath || '').trim() || undefined,
        originalPath: String(item?.originalPath || '').trim() || undefined,
        originalRelativePath: String(item?.originalRelativePath || '').trim() || undefined,
        extractedRelativePath: String(item?.extractedRelativePath || ''),
        extractionStatus: (item?.extractionStatus as KnowledgeExtractionStatus) || 'pending',
        extractedTextLength: Number(item?.extractedTextLength || 0),
        previewText: String(item?.previewText || ''),
        latestVersionId: String(item?.latestVersionId || '').trim() || undefined,
        versionCount: Number(item?.versionCount || 0),
        templateUsageCount: Number(item?.templateUsageCount || 0),
        lastUsedAsTemplateAt: String(item?.lastUsedAsTemplateAt || '').trim() || undefined,
        lastRemadeAt: String(item?.lastRemadeAt || '').trim() || undefined,
        errorMessage: String(item?.errorMessage || '').trim() || undefined,
        documentCategory: VALID_CATEGORIES.includes(String(item?.documentCategory || '').trim() as KnowledgeDocumentCategory)
          ? String(item?.documentCategory || '').trim() as KnowledgeDocumentCategory
          : undefined,
        categoryDetail: String(item?.categoryDetail || '').trim() || undefined,
        categoryConfidence: Number.isFinite(Number(item?.categoryConfidence)) ? Number(item?.categoryConfidence) : undefined,
      })) : [],
      versions: Array.isArray(parsed?.versions) ? parsed.versions.map((item: any) => ({
        id: String(item?.id || ''),
        documentId: String(item?.documentId || ''),
        versionNumber: Number(item?.versionNumber || 1),
        kind: (item?.kind as KnowledgeVersionKind) || 'source',
        title: String(item?.title || ''),
        createdAt: String(item?.createdAt || now),
        updatedAt: String(item?.updatedAt || item?.createdAt || now),
        parentVersionId: String(item?.parentVersionId || '').trim() || undefined,
        instruction: String(item?.instruction || '').trim() || undefined,
        textRelativePath: String(item?.textRelativePath || ''),
        textLength: Number(item?.textLength || 0),
        previewText: String(item?.previewText || ''),
        taskId: String(item?.taskId || '').trim() || undefined,
      })) : [],
      tasks: Array.isArray(parsed?.tasks) ? parsed.tasks.map((item: any) => ({
        id: String(item?.id || ''),
        externalTaskId: String(item?.externalTaskId || '').trim() || undefined,
        type: (item?.type as KnowledgeTaskType) || 'reference-generation',
        status: (item?.status as KnowledgeTaskStatus) || 'submitted',
        title: String(item?.title || ''),
        createdAt: String(item?.createdAt || now),
        updatedAt: String(item?.updatedAt || item?.createdAt || now),
        documentId: String(item?.documentId || '').trim() || undefined,
        sourceDocumentIds: Array.isArray(item?.sourceDocumentIds) ? item.sourceDocumentIds.map((value: unknown) => String(value || '').trim()).filter(Boolean) : [],
        templateDocumentId: String(item?.templateDocumentId || '').trim() || undefined,
        referenceDocumentIds: Array.isArray(item?.referenceDocumentIds) ? item.referenceDocumentIds.map((value: unknown) => String(value || '').trim()).filter(Boolean) : [],
        constraints: normalizeTaskConstraints(item?.constraints),
        generationTrace: normalizeGenerationTrace(item?.generationTrace),
        sourceVersionId: String(item?.sourceVersionId || '').trim() || undefined,
        outputVersionId: String(item?.outputVersionId || '').trim() || undefined,
        templateTitle: String(item?.templateTitle || '').trim() || undefined,
        referenceTitles: Array.isArray(item?.referenceTitles) ? item.referenceTitles.map((value: unknown) => String(value || '').trim()).filter(Boolean) : undefined,
        instruction: String(item?.instruction || '').trim() || undefined,
        outputPreview: String(item?.outputPreview || '').trim() || undefined,
        errorMessage: String(item?.errorMessage || '').trim() || undefined,
      })) : [],
      bundledSeedState: this.normalizeBundledSeedState(parsed?.bundledSeedState),
    }

    const normalizedDocuments = index.documents.filter((item) => item.id)
    const normalizedVersions = index.versions.filter((item) => item.id && item.documentId)
    const normalizedTasks = index.tasks.filter((item) => item.id)
    const consistent = await this.ensureIndexConsistency({
      ...index,
      documents: normalizedDocuments,
      versions: normalizedVersions,
      tasks: normalizedTasks,
    })
    if (consistent.mutated || parsed?.version !== 2) {
      await this.writeIndex(consistent.index)
    }
    return consistent.index
  }

  private async writeIndex(index: KnowledgeLibraryIndex): Promise<void> {
    await writeJsonAtomic(this.indexPath, {
      ...index,
      version: 2,
      updatedAt: nowIso(),
    })
  }

  private async importDocumentsWithIndex(
    index: KnowledgeLibraryIndex,
    filePaths: string[],
    options: {
      refreshDuplicateMetadata?: boolean
    } = {},
  ): Promise<{
    index: KnowledgeLibraryIndex
    changed: boolean
    result: KnowledgeImportResult
  }> {
    const imported: KnowledgeDocumentMeta[] = []
    const duplicates: KnowledgeDocumentMeta[] = []
    const failed: Array<{ filePath: string; fileName: string; error: string }> = []
    const nextDocuments = [...index.documents]
    const nextVersions = [...index.versions]
    let metadataRefreshed = false

    for (const sourcePathRaw of filePaths) {
      const sourcePath = String(sourcePathRaw || '').trim()
      if (!sourcePath) continue
      const fileName = path.basename(sourcePath)
      try {
        const stat = await fs.stat(sourcePath)
        const hash = await hashFile(sourcePath)
        const duplicateIndex = nextDocuments.findIndex((item) => item.hash === hash)
        const duplicate = duplicateIndex >= 0 ? nextDocuments[duplicateIndex] : null
        if (duplicate) {
          if (options.refreshDuplicateMetadata) {
            const sourceType = resolveSourceType(sourcePath)
            const nextTitle = path.basename(fileName, path.extname(fileName))
            const nextPreviewText = sourceType === 'image'
              ? `视觉参考图片 · ${fileName}`
              : duplicate.previewText
            const shouldRefresh = duplicate.title !== nextTitle
              || duplicate.originalName !== fileName
              || duplicate.previewText !== nextPreviewText

            if (shouldRefresh) {
              const refreshedAt = nowIso()
              const nextDuplicate: KnowledgeDocumentMeta = {
                ...duplicate,
                title: nextTitle,
                originalName: fileName,
                previewText: nextPreviewText,
                updatedAt: refreshedAt,
              }
              nextDocuments[duplicateIndex] = nextDuplicate
              metadataRefreshed = true

              for (let index = 0; index < nextVersions.length; index += 1) {
                const version = nextVersions[index]
                if (version.documentId !== duplicate.id || version.kind !== 'source' || version.versionNumber !== 1) continue
                nextVersions[index] = {
                  ...version,
                  title: `${nextTitle}（原始导入）`,
                  previewText: sourceType === 'image' ? nextPreviewText : version.previewText,
                  updatedAt: refreshedAt,
                }
              }

              duplicates.push(nextDuplicate)
              continue
            }
          }

          duplicates.push(duplicate)
          continue
        }

        const sourceType = resolveSourceType(sourcePath)
        const documentId = buildDocumentId(fileName, hash)
        const documentDir = this.getDocumentRootDir(documentId)
        const sourceDir = this.getDocumentSourceDir(documentId)
        const parsedDir = this.getDocumentParsedDir(documentId)
        const parsedAssetsDir = this.getDocumentParsedAssetsDir(documentId)
        await Promise.all([ensureDir(documentDir), ensureDir(sourceDir), ensureDir(parsedDir), ensureDir(parsedAssetsDir)])
        const storedFileName = `source${path.extname(sourcePath).toLowerCase()}`
        const storedPath = path.join(sourceDir, storedFileName)
        const extractedPath = path.join(parsedDir, 'extracted.txt')
        const parsedDocumentPath = path.join(parsedDir, 'document.json')
        const chunkIndexPath = path.join(parsedDir, 'chunks.json')
        await fs.copyFile(sourcePath, storedPath)

        let extractionStatus: KnowledgeExtractionStatus = 'ready'
        let extractedText = ''
        let errorMessage = ''
        let parsedDocument: KnowledgeDocumentJson | null = null

        try {
          let plainText = ''
          if (sourceType === 'txt' || sourceType === 'md' || sourceType === 'pdf') {
            plainText = await extractTextForFile(sourcePath, sourceType)
          }

          let parseFilePath = sourcePath
          let cleanupPreparedDoc: (() => Promise<void>) | null = null
          if (sourceType === 'doc') {
            const prepared = await prepareCompatibleDocxSource(sourcePath)
            parseFilePath = prepared.filePath
            cleanupPreparedDoc = async () => {
              await cleanupPreparedCompatibleDocxSource(prepared)
            }
          }

          try {
            parsedDocument = await importFileToKnowledgeJson({
              id: documentId,
              title: path.basename(fileName, path.extname(fileName)),
              sourceType,
              originalFileName: fileName,
              createdAt: nowIso(),
              updatedAt: nowIso(),
              mimeType: sourceType === 'image' ? detectMimeTypeFromPath(sourcePath) : detectMimeType(sourceType),
              hash,
              sourceRelativePath: path.relative(this.rootPath, storedPath).replace(/\\/g, '/'),
              parsedRelativePath: path.relative(this.rootPath, parsedDocumentPath).replace(/\\/g, '/'),
              chunkIndexRelativePath: path.relative(this.rootPath, chunkIndexPath).replace(/\\/g, '/'),
              assetDirRelativePath: path.relative(this.rootPath, parsedAssetsDir).replace(/\\/g, '/'),
              extractionStatus: 'ready',
              parseFilePath,
              format: path.extname(sourcePath).toLowerCase(),
              plainText,
              assetsDir: parsedAssetsDir,
            })
          } finally {
            if (cleanupPreparedDoc) {
              await cleanupPreparedDoc().catch(() => undefined)
            }
          }

          extractedText = String(parsedDocument?.extractedText || '').trim()
          if (!parsedDocument) {
            throw new Error('未生成标准 Knowledge JSON')
          }
          const parsedNow = parsedDocument
          await fs.writeFile(extractedPath, extractedText, 'utf-8')
          await writeJsonAtomic(parsedDocumentPath, parsedNow)
          await writeJsonAtomic(chunkIndexPath, {
            documentId,
            versionId: undefined,
            updatedAt: parsedNow.updatedAt,
            chunks: parsedNow.chunkIndex.map((chunk) => ({
              id: chunk.id,
              documentId,
              order: chunk.order,
              titlePath: chunk.titlePath,
              sectionLabel: chunk.titlePath[chunk.titlePath.length - 1] || undefined,
              text: chunk.text,
              normalizedText: chunk.text,
              summary: chunk.summary,
              keywords: chunk.keywords,
              tokenEstimate: chunk.tokenEstimate,
              sourceType,
              createdAt: parsedNow.createdAt,
              updatedAt: parsedNow.updatedAt,
            })),
          } satisfies KnowledgeDocumentChunkIndex)
        } catch (error) {
          try {
            extractedText = await extractTextForFile(sourcePath, sourceType)
            const fallbackNow = nowIso()
            parsedDocument = buildKnowledgeDocumentJsonFromPlainText({
              id: documentId,
              title: path.basename(fileName, path.extname(fileName)),
              sourceType,
              originalFileName: fileName,
              createdAt: fallbackNow,
              updatedAt: fallbackNow,
              mimeType: sourceType === 'image' ? detectMimeTypeFromPath(sourcePath) : detectMimeType(sourceType),
              hash,
              sourceRelativePath: path.relative(this.rootPath, storedPath).replace(/\\/g, '/'),
              parsedRelativePath: path.relative(this.rootPath, parsedDocumentPath).replace(/\\/g, '/'),
              chunkIndexRelativePath: path.relative(this.rootPath, chunkIndexPath).replace(/\\/g, '/'),
              assetDirRelativePath: path.relative(this.rootPath, parsedAssetsDir).replace(/\\/g, '/'),
              extractionStatus: 'ready',
              text: extractedText,
            })
            const parsedFallback = parsedDocument
            await fs.writeFile(extractedPath, extractedText, 'utf-8')
            await writeJsonAtomic(parsedDocumentPath, parsedFallback)
            await writeJsonAtomic(chunkIndexPath, {
              documentId,
              versionId: undefined,
              updatedAt: parsedFallback.updatedAt,
              chunks: parsedFallback.chunkIndex.map((chunk) => ({
                id: chunk.id,
                documentId,
                order: chunk.order,
                titlePath: chunk.titlePath,
                sectionLabel: chunk.titlePath[chunk.titlePath.length - 1] || undefined,
                text: chunk.text,
                normalizedText: chunk.text,
                summary: chunk.summary,
                keywords: chunk.keywords,
                tokenEstimate: chunk.tokenEstimate,
                sourceType,
                createdAt: parsedFallback.createdAt,
                updatedAt: parsedFallback.updatedAt,
              })),
            } satisfies KnowledgeDocumentChunkIndex)
          } catch (fallbackError) {
            extractionStatus = sourceType === 'image' ? 'ready' : 'failed'
            errorMessage = buildKnowledgeExtractionFailureMessage(sourceType, fallbackError instanceof Error ? fallbackError.message : String(fallbackError))
            await fs.writeFile(extractedPath, '', 'utf-8')
          }
        }

        const now = nowIso()
        const explicitTemplate = extractedText ? parseExplicitEmailTemplateDeclaration(extractedText) : null
        const normalizedExtractedPreviewText = explicitTemplate?.emailTemplate.summary
          || (explicitTemplate?.bodyText ? previewText(explicitTemplate.bodyText) : previewText(extractedText))
        const versionId = buildVersionId(documentId, 1)
        const versionTextRelativePath = await this.writeVersionText(documentId, versionId, extractedText)
        const baseVersion: KnowledgeDocumentVersionMeta = {
          id: versionId,
          documentId,
          versionNumber: 1,
          kind: 'source',
          title: `${path.basename(fileName, path.extname(fileName))}（原始导入）`,
          createdAt: now,
          updatedAt: now,
          instruction: '原始导入',
          textRelativePath: versionTextRelativePath,
          textLength: extractedText.length,
          previewText: sourceType === 'image' ? `视觉参考图片 · ${fileName}` : normalizedExtractedPreviewText,
        }

        const meta: KnowledgeDocumentMeta = {
          id: documentId,
          title: path.basename(fileName, path.extname(fileName)),
          originalName: fileName,
          sourceType,
          templateType: explicitTemplate?.templateType,
          emailTemplate: explicitTemplate?.emailTemplate,
          mimeType: sourceType === 'image' ? detectMimeTypeFromPath(sourcePath) : detectMimeType(sourceType),
          hash,
          importedAt: now,
          updatedAt: now,
          size: stat.size,
          storedRelativePath: path.relative(this.rootPath, storedPath).replace(/\\/g, '/'),
          originalRelativePath: path.relative(this.rootPath, storedPath).replace(/\\/g, '/'),
          extractedRelativePath: path.relative(this.rootPath, extractedPath).replace(/\\/g, '/'),
          extractionStatus,
          extractedTextLength: extractedText.length,
          previewText: sourceType === 'image'
            ? `视觉参考图片 · ${fileName}`
            : extractedText
              ? (String(parsedDocument?.metadata.previewText || '').trim() || normalizedExtractedPreviewText)
              : extractionStatus === 'failed'
                ? `抽取失败：${errorMessage}`
                : previewText(extractedText),
          latestVersionId: versionId,
          versionCount: 1,
          templateUsageCount: 0,
          errorMessage: errorMessage || undefined,
        }

        if (extractedText && this.getSettings) {
          try {
            const settings = await this.getSettings()
            const classification = await classifyDocumentText(settings, explicitTemplate?.bodyText || extractedText, fileName)
            meta.documentCategory = classification.category
            meta.categoryDetail = classification.detail || undefined
            meta.categoryConfidence = classification.confidence
          } catch {
            // classification is best-effort; import proceeds regardless
          }
        }

        nextDocuments.push(meta)
        nextVersions.push(baseVersion)
        imported.push(meta)
      } catch (error) {
        failed.push({
          filePath: sourcePath,
          fileName,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return {
      index: {
        ...index,
        documents: nextDocuments,
        versions: nextVersions,
      },
      changed: imported.length > 0 || metadataRefreshed,
      result: { imported, duplicates, failed },
    }
  }

  async getInfo(): Promise<KnowledgeLibraryInfo> {
    const index = await this.readIndex()
    return {
      rootPath: this.rootPath,
      documentCount: index.documents.length,
      createdAt: index.createdAt,
      updatedAt: index.updatedAt,
    }
  }

  async listDocuments(query?: string): Promise<KnowledgeDocumentMeta[]> {
    const index = await this.readIndex()
    const needle = String(query || '').trim().toLowerCase()
    const documents = [...index.documents].sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))
    if (!needle) return documents
    return documents.filter((document) => {
      const haystack = `${document.title}\n${document.originalName}\n${document.previewText}`.toLowerCase()
      return haystack.includes(needle)
    })
  }

  async getDocument(documentId: string): Promise<KnowledgeDocumentDetail | null> {
    const id = String(documentId || '').trim()
    if (!id) return null
    const index = await this.readIndex()
    const meta = index.documents.find((item) => item.id === id)
    if (!meta) return null

    const versions = sortVersions(index.versions.filter((item) => item.documentId === id))
    const currentVersion = versions.find((item) => item.id === meta.latestVersionId) || versions[0] || null
    const currentText = currentVersion
      ? await this.readTextRelative(currentVersion.textRelativePath)
      : await this.readTextRelative(meta.extractedRelativePath)
    const originalExtractedText = await this.readTextRelative(meta.extractedRelativePath)
    const tasks = sortTasks(index.tasks.filter((item) => item.documentId === id || item.templateDocumentId === id || item.sourceDocumentIds.includes(id) || item.referenceDocumentIds.includes(id))).slice(0, 20)
    const parsedDocumentRelativePath = path.join('documents', id, 'parsed', 'document.json').replace(/\\/g, '/')
    const chunkIndexRelativePath = path.join('documents', id, 'parsed', 'chunks.json').replace(/\\/g, '/')
    const assetDirRelativePath = path.join('documents', id, 'parsed', 'assets').replace(/\\/g, '/')
    let parsedDocument: KnowledgeDocumentJson | null = null

    try {
      const raw = await fs.readFile(path.join(this.rootPath, parsedDocumentRelativePath), 'utf-8')
      const parsed = JSON.parse(raw)
      if (isKnowledgeDocumentJson(parsed)) {
        parsedDocument = parsed
      }
    } catch {
      parsedDocument = null
    }

    if (!parsedDocument && originalExtractedText.trim()) {
      parsedDocument = buildKnowledgeDocumentJsonFromPlainText({
        id,
        title: meta.title,
        sourceType: meta.sourceType,
        originalFileName: meta.originalName,
        createdAt: meta.importedAt,
        updatedAt: meta.updatedAt,
        mimeType: meta.mimeType,
        hash: meta.hash,
        sourceRelativePath: meta.storedRelativePath,
        parsedRelativePath: parsedDocumentRelativePath,
        chunkIndexRelativePath,
        assetDirRelativePath,
        extractionStatus: meta.extractionStatus,
        text: originalExtractedText,
      })
    }

    return {
      meta,
      extractedText: currentText,
      originalExtractedText,
      currentVersionId: currentVersion?.id || null,
      versions,
      tasks,
      chunkCount: undefined,
      parsedDocument,
      parsedDocumentRelativePath,
      chunkIndexRelativePath,
      assetDirRelativePath,
    }
  }

  async getDocumentVersion(documentId: string, versionId: string): Promise<KnowledgeDocumentVersionDetail | null> {
    const normalizedDocumentId = String(documentId || '').trim()
    const normalizedVersionId = String(versionId || '').trim()
    if (!normalizedDocumentId || !normalizedVersionId) return null
    const index = await this.readIndex()
    const meta = index.versions.find((item) => item.documentId === normalizedDocumentId && item.id === normalizedVersionId)
    if (!meta) return null
    const text = await this.readTextRelative(meta.textRelativePath)
    return { meta, text }
  }

  async importDocuments(filePaths: string[]): Promise<KnowledgeImportResult> {
    const index = await this.readIndex()
    const importResult = await this.importDocumentsWithIndex(index, filePaths)
    if (importResult.changed) {
      await this.writeIndex(importResult.index)
    }
    return importResult.result
  }

  async classifyDocument(documentId: string): Promise<{ category: KnowledgeDocumentCategory; confidence: number } | null> {
    if (!this.getSettings) return null
    const detail = await this.getDocument(documentId)
    if (!detail) return null
    const originalText = detail.extractedText || detail.originalExtractedText || ''
    const text = parseExplicitEmailTemplateDeclaration(originalText)?.bodyText || originalText
    if (!text.trim()) return null
    const settings = await this.getSettings()
    const result = await classifyDocumentText(settings, text, detail.meta.originalName)
    const index = await this.readIndex()
    const docIndex = index.documents.findIndex((item) => item.id === documentId)
    if (docIndex >= 0) {
      index.documents[docIndex] = {
        ...index.documents[docIndex],
        documentCategory: result.category,
        categoryDetail: result.detail || undefined,
        categoryConfidence: result.confidence,
        updatedAt: nowIso(),
      }
      await this.writeIndex(index)
    }
    return result
  }

  async updateDocumentCategory(documentId: string, category: KnowledgeDocumentCategory): Promise<void> {
    const index = await this.readIndex()
    const docIndex = index.documents.findIndex((item) => item.id === documentId)
    if (docIndex < 0) throw new Error('未找到对应的知识库文档')
    index.documents[docIndex] = {
      ...index.documents[docIndex],
      documentCategory: category,
      categoryConfidence: 1.0,
      updatedAt: nowIso(),
    }
    await this.writeIndex(index)
  }

  async saveTaskRecord(input: SaveKnowledgeTaskInput): Promise<{ task: KnowledgeTaskRecord }> {
    const index = await this.readIndex()
    const documents = [...index.documents]
    const tasks = [...index.tasks]
    const existingIndex = tasks.findIndex((item) => item.id === input.id || (!!input.externalTaskId && item.externalTaskId === input.externalTaskId))
    const existing = existingIndex >= 0 ? tasks[existingIndex] : undefined
    const task = this.buildTaskRecord(index, input, existing)
    const isNew = !existing

    if (existingIndex >= 0) {
      tasks[existingIndex] = task
    } else {
      tasks.unshift(task)
    }

    if (isNew && task.templateDocumentId && ['submitted', 'running', 'completed'].includes(task.status)) {
      const documentIndex = documents.findIndex((item) => item.id === task.templateDocumentId)
      if (documentIndex >= 0) {
        documents[documentIndex] = {
          ...documents[documentIndex],
          templateUsageCount: (documents[documentIndex].templateUsageCount || 0) + 1,
          lastUsedAsTemplateAt: task.updatedAt,
          updatedAt: task.updatedAt,
        }
      }
    }

    await this.writeIndex({
      ...index,
      documents,
      tasks,
    })

    return { task }
  }

  async createRemakeVersion(input: CreateKnowledgeRemakeVersionInput): Promise<{ document: KnowledgeDocumentMeta; version: KnowledgeDocumentVersionMeta; task: KnowledgeTaskRecord }> {
    const documentId = String(input.documentId || '').trim()
    const content = normalizeText(input.content)
    const instruction = String(input.instruction || '').trim()
    if (!documentId) throw new Error('文档 ID 不能为空')
    if (!content) throw new Error('Remake 结果不能为空')
    if (!instruction) throw new Error('Remake 指令不能为空')

    const index = await this.readIndex()
    const documentIndex = index.documents.findIndex((item) => item.id === documentId)
    if (documentIndex < 0) {
      throw new Error('未找到对应的知识库文档')
    }

    const document = index.documents[documentIndex]
    const documentVersions = sortVersions(index.versions.filter((item) => item.documentId === documentId))
    const sourceVersion = documentVersions.find((item) => item.id === String(input.sourceVersionId || '').trim()) || documentVersions[0]
    const versionNumber = documentVersions.length + 1
    const versionId = buildVersionId(documentId, versionNumber)
    const textRelativePath = await this.writeVersionText(documentId, versionId, content)
    const versionTitle = String(input.title || '').trim() || `${document.title}（Remake v${versionNumber}）`
    const timestamp = nowIso()

    const version: KnowledgeDocumentVersionMeta = {
      id: versionId,
      documentId,
      versionNumber,
      kind: 'remake',
      title: versionTitle,
      createdAt: timestamp,
      updatedAt: timestamp,
      parentVersionId: sourceVersion?.id,
      instruction,
      textRelativePath,
      textLength: content.length,
      previewText: previewText(content),
      taskId: String(input.taskId || '').trim() || undefined,
    }

    const updatedDocument: KnowledgeDocumentMeta = {
      ...document,
      updatedAt: timestamp,
      latestVersionId: versionId,
      versionCount: versionNumber,
      lastRemadeAt: timestamp,
      extractedTextLength: content.length,
      previewText: previewText(content),
    }

    const task = this.buildTaskRecord({
      ...index,
      documents: index.documents.map((item, idx) => (idx === documentIndex ? updatedDocument : item)),
    }, {
      id: String(input.taskId || '').trim() || undefined,
      type: 'document-remake',
      status: 'completed',
      title: versionTitle,
      documentId,
      sourceDocumentIds: [documentId, String(input.templateDocumentId || '').trim(), ...((input.referenceDocumentIds || []).map((item) => String(item || '').trim()))].filter(Boolean),
      templateDocumentId: String(input.templateDocumentId || '').trim() || undefined,
      referenceDocumentIds: Array.from(new Set((input.referenceDocumentIds || []).map((item) => String(item || '').trim()).filter(Boolean))),
      constraints: input.constraints,
      generationTrace: input.generationTrace,
      sourceVersionId: sourceVersion?.id,
      outputVersionId: versionId,
      instruction,
      outputPreview: previewText(content),
    }, index.tasks.find((item) => item.id === String(input.taskId || '').trim()))

    const nextTasks = [task, ...index.tasks.filter((item) => item.id !== task.id)]

    await this.writeIndex({
      ...index,
      documents: index.documents.map((item, idx) => (idx === documentIndex ? updatedDocument : item)),
      versions: [version, ...index.versions],
      tasks: nextTasks,
    })

    return {
      document: updatedDocument,
      version,
      task,
    }
  }

  async listTaskRecords(limit = 20): Promise<KnowledgeTaskRecord[]> {
    const index = await this.readIndex()
    return sortTasks(index.tasks).slice(0, Math.max(1, limit))
  }

  async setCurrentVersion(documentId: string, versionId: string): Promise<{ document: KnowledgeDocumentMeta; version: KnowledgeDocumentVersionMeta }> {
    const normalizedDocumentId = String(documentId || '').trim()
    const normalizedVersionId = String(versionId || '').trim()
    if (!normalizedDocumentId || !normalizedVersionId) {
      throw new Error('文档版本信息不能为空')
    }

    const index = await this.readIndex()
    const documentIndex = index.documents.findIndex((item) => item.id === normalizedDocumentId)
    if (documentIndex < 0) {
      throw new Error('未找到对应的知识库文档')
    }

    const version = index.versions.find((item) => item.documentId === normalizedDocumentId && item.id === normalizedVersionId)
    if (!version) {
      throw new Error('未找到对应的知识库版本')
    }

    const updatedDocument: KnowledgeDocumentMeta = {
      ...index.documents[documentIndex],
      latestVersionId: version.id,
      updatedAt: nowIso(),
      extractedTextLength: version.textLength,
      previewText: version.previewText,
    }

    await this.writeIndex({
      ...index,
      documents: index.documents.map((item, idx) => (idx === documentIndex ? updatedDocument : item)),
    })

    return { document: updatedDocument, version }
  }

  async deleteDocument(documentId: string): Promise<{ success: boolean }> {
    const id = String(documentId || '').trim()
    if (!id) throw new Error('文档 ID 不能为空')
    const index = await this.readIndex()
    const meta = index.documents.find((item) => item.id === id)
    if (!meta) return { success: true }

    const sourceDir = path.join(this.documentsDir, id)
    const sourceVersionDir = path.join(this.versionsDir, id)
    const trashStamp = `${id}-${Date.now()}`
    if (await pathExists(sourceDir)) {
      await fs.rename(sourceDir, path.join(this.trashDir, trashStamp))
    }
    if (await pathExists(sourceVersionDir)) {
      await fs.rename(sourceVersionDir, path.join(this.trashDir, `${trashStamp}-versions`))
    }

    await this.writeIndex({
      ...index,
      documents: index.documents.filter((item) => item.id !== id),
      versions: index.versions.filter((item) => item.documentId !== id),
      tasks: index.tasks.filter((item) => item.documentId !== id && item.templateDocumentId !== id && !item.sourceDocumentIds.includes(id) && !item.referenceDocumentIds.includes(id)),
    })
    return { success: true }
  }
}
