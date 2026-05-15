import type { KnowledgeSourceType } from '../../../src/types/knowledge'
import type { KnowledgeDocumentJson } from '../../../src/types/knowledgeDocumentJson'
import { buildKnowledgeDocumentJsonFromCanonical, buildKnowledgeDocumentJsonFromPlainText } from '../../../src/shared/knowledge/knowledgeDocumentJson'
import { buildKnowledgeCanonicalDocument, canonicalDocumentToPlainText } from './knowledgeCanonicalImport'

export interface ImportKnowledgeJsonInput {
  id: string
  title: string
  sourceType: KnowledgeSourceType
  originalFileName: string
  createdAt: string
  updatedAt: string
  mimeType?: string
  hash?: string
  sourceRelativePath?: string
  parsedRelativePath?: string
  chunkIndexRelativePath?: string
  assetDirRelativePath?: string
  extractionStatus?: string
  parseFilePath: string
  format: string
  plainText?: string
  assetsDir?: string
}

export async function importFileToKnowledgeJson(input: ImportKnowledgeJsonInput): Promise<KnowledgeDocumentJson> {
  const baseMetadata = {
    id: input.id,
    title: input.title,
    sourceType: input.sourceType,
    originalFileName: input.originalFileName,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    mimeType: input.mimeType,
    hash: input.hash,
    sourceRelativePath: input.sourceRelativePath,
    parsedRelativePath: input.parsedRelativePath,
    chunkIndexRelativePath: input.chunkIndexRelativePath,
    assetDirRelativePath: input.assetDirRelativePath,
    extractionStatus: input.extractionStatus,
  }

  if (input.sourceType === 'txt' || input.sourceType === 'md') {
    return buildKnowledgeDocumentJsonFromPlainText({
      ...baseMetadata,
      text: input.plainText || '',
    })
  }

  const canonical = await buildKnowledgeCanonicalDocument({
    documentId: input.id,
    title: input.title,
    originalName: input.originalFileName,
    parseFilePath: input.parseFilePath,
    format: input.format,
    sourceKind: input.sourceType,
    preExtractedText: input.plainText,
    pptxMediaOutDir: input.sourceType === 'pptx' ? input.assetsDir : undefined,
    docxMediaOutDir: input.sourceType === 'docx' || input.sourceType === 'doc' ? input.assetsDir : undefined,
  })

  const document = buildKnowledgeDocumentJsonFromCanonical({
    ...baseMetadata,
    canonical,
  })

  if (!document.extractedText && canonical) {
    document.extractedText = canonicalDocumentToPlainText(canonical)
  }
  return document
}