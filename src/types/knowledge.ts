import type { KnowledgeDocumentJson } from './knowledgeDocumentJson'

// ---- 部门 Department ----
export interface Department {
  id: string
  name: string
  nameEn: string
  preset: boolean
  createdAt: string
  parentId?: string
}

export interface DepartmentRegistry {
  version: 1
  departments: Department[]
}

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
  | 'notice'        // 通知类
  | 'report'        // 报告类
  | 'briefing'      // 汇报类
  | 'proposal'      // 方案/提案类
  | 'minutes'       // 会议纪要类
  | 'contract'      // 合同/协议类
  | 'letter'        // 函件/信函类
  | 'regulation'    // 制度/规章类
  | 'plan'          // 计划/规划类
  | 'summary'       // 总结类
  | 'manual'        // 说明书/手册类
  | 'academic'      // 学术论文类
  | 'other'         // 其他

export const KNOWLEDGE_DOCUMENT_CATEGORY_LABELS: Record<KnowledgeDocumentCategory, string> = {
  notice: '通知',
  report: '报告',
  briefing: '汇报',
  proposal: '方案',
  minutes: '纪要',
  contract: '合同',
  letter: '函件',
  regulation: '制度',
  plan: '计划',
  summary: '总结',
  manual: '手册',
  academic: '论文',
  other: '其他',
}

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

export interface KnowledgeLibraryInfo {
  rootPath: string
  documentCount: number
  createdAt: string
  updatedAt: string
}

export interface KnowledgeImportResult {
  imported: KnowledgeDocumentMeta[]
  duplicates: KnowledgeDocumentMeta[]
  failed: Array<{ filePath: string; fileName: string; error: string }>
  canceled: boolean
}

export interface MaterializeKnowledgeWorkspaceInput {
  workspaceName?: string
  fileName?: string
  documentId?: string
  versionId?: string
  sourceDocumentIds?: string[]
  content?: string
}

export interface MaterializeKnowledgeWorkspaceResult {
  success: boolean
  workspacePath: string
  name: string
  documentPath: string
  fileName: string
  sourceCount: number
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