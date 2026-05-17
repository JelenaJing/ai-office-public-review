import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { KnowledgeService } from '../electron/main/services/knowledgeService'

async function main(): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-writer-knowledge-doc-migration-'))
  const knowledgeRoot = path.join(tempDir, 'knowledge-base')
  const documentId = 'legacy-doc-pending'
  const documentDir = path.join(knowledgeRoot, 'documents', documentId)

  try {
    await fs.mkdir(documentDir, { recursive: true })
    await fs.mkdir(path.join(knowledgeRoot, 'versions'), { recursive: true })
    await fs.mkdir(path.join(knowledgeRoot, 'tasks'), { recursive: true })
    await fs.mkdir(path.join(knowledgeRoot, 'trash'), { recursive: true })
    await fs.writeFile(path.join(documentDir, 'source.doc'), 'legacy binary placeholder', 'utf-8')
    await fs.writeFile(path.join(documentDir, 'extracted.txt'), '', 'utf-8')

    const now = new Date().toISOString()
    await fs.writeFile(path.join(knowledgeRoot, 'index.json'), JSON.stringify({
      version: 2,
      createdAt: now,
      updatedAt: now,
      documents: [
        {
          id: documentId,
          title: '拜访函_模板',
          originalName: '拜访函_模板.doc',
          sourceType: 'doc',
          mimeType: 'application/msword',
          hash: 'hash-doc-pending',
          importedAt: now,
          updatedAt: now,
          size: 128,
          storedRelativePath: `documents/${documentId}/source.doc`,
          extractedRelativePath: `documents/${documentId}/extracted.txt`,
          extractionStatus: 'pending',
          extractedTextLength: 0,
          previewText: '',
          versionCount: 0,
          templateUsageCount: 0,
        },
      ],
      versions: [],
      tasks: [],
    }, null, 2), 'utf-8')

    const service = new KnowledgeService(knowledgeRoot)
    const documents = await service.listDocuments()
    assert.equal(documents.length, 1)
    assert.equal(documents[0].extractionStatus, 'failed')
    assert.match(String(documents[0].errorMessage || ''), /DOC 导入失败|soffice|libreoffice/i)

    const detail = await service.getDocument(documentId)
    assert.ok(detail)
    assert.equal(detail?.meta.extractionStatus, 'failed')

    const savedIndex = JSON.parse(await fs.readFile(path.join(knowledgeRoot, 'index.json'), 'utf-8'))
    assert.equal(savedIndex.documents[0].extractionStatus, 'failed')
    assert.match(String(savedIndex.documents[0].errorMessage || ''), /DOC 导入失败|soffice|libreoffice/i)

    console.log('knowledge doc pending migration smoke passed')
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})