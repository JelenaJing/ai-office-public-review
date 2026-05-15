import type { KnowledgeSourceType } from './knowledge'

export const KNOWLEDGE_DOCUMENT_JSON_SCHEMA_VERSION = '1.0' as const

export type KnowledgeDocumentJsonSchemaVersion = typeof KNOWLEDGE_DOCUMENT_JSON_SCHEMA_VERSION

export type KnowledgeDocumentBlockType = 'paragraph' | 'heading' | 'list' | 'table' | 'image' | 'code'
export type KnowledgeDocumentAssetType = 'source' | 'image' | 'preview' | 'other'

export interface KnowledgeDocumentSection {
  id: string
  title: string
  order: number
  level: number
  blockIds: string[]
  summary?: string
}

export interface KnowledgeDocumentBlock {
  id: string
  type: KnowledgeDocumentBlockType
  order: number
  sectionId?: string
  level?: number
  text?: string
  items?: string[]
  rows?: string[][]
  assetId?: string
  language?: string
  metadata?: Record<string, unknown>
}

export interface KnowledgeDocumentChunk {
  id: string
  order: number
  sectionId?: string
  titlePath: string[]
  blockIds: string[]
  text: string
  summary: string
  keywords: string[]
  tokenEstimate: number
}

export interface KnowledgeDocumentAsset {
  id: string
  type: KnowledgeDocumentAssetType
  title?: string
  originalFileName?: string
  mimeType?: string
  relativePath?: string
  metadata?: Record<string, unknown>
}

export interface KnowledgeDocumentJson {
  schemaVersion: KnowledgeDocumentJsonSchemaVersion
  id: string
  title: string
  sourceType: KnowledgeSourceType
  originalFileName: string
  createdAt: string
  updatedAt: string
  metadata: {
    mimeType?: string
    hash?: string
    sourceRelativePath?: string
    parsedRelativePath?: string
    chunkIndexRelativePath?: string
    assetDirRelativePath?: string
    extractionStatus?: string
    previewText?: string
    canonicalDocType?: string
    canonicalPresentAs?: string
    originalLayoutPdfRelativePath?: string
    [key: string]: unknown
  }
  sections: KnowledgeDocumentSection[]
  blocks: KnowledgeDocumentBlock[]
  extractedText: string
  chunkIndex: KnowledgeDocumentChunk[]
  assets: KnowledgeDocumentAsset[]
}

export function isKnowledgeDocumentJson(value: unknown): value is KnowledgeDocumentJson {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return record.schemaVersion === KNOWLEDGE_DOCUMENT_JSON_SCHEMA_VERSION
    && typeof record.id === 'string'
    && typeof record.title === 'string'
    && typeof record.sourceType === 'string'
    && Array.isArray(record.sections)
    && Array.isArray(record.blocks)
    && typeof record.extractedText === 'string'
    && Array.isArray(record.chunkIndex)
    && Array.isArray(record.assets)
}