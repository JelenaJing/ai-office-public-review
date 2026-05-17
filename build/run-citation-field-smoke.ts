import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DocumentEngineService, type OoxmlBlockSnapshot } from '../electron/main/services/documentEngineService'
import { extractCitationNumbers, formatCitationNumbers, updateCitationNumbersInText } from '../src/utils/citationGroups'

async function main() {
  assert.deepEqual(extractCitationNumbers('A [1-3] and [5, 7]'), [1, 2, 3, 5, 7])
  assert.equal(formatCitationNumbers([7, 5, 1, 2, 3]), '[1-3, 5, 7]')
  assert.equal(updateCitationNumbersInText('A [1-3] and [5, 7]', new Map([[1, 1], [2, 2], [3, 4], [5, 6], [7, 8]])), 'A [1, 2, 4] and [6, 8]')

  const service = new DocumentEngineService()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-writer-citation-field-'))
  const tempFile = path.join(tempDir, 'citation-field.docx')

  const blocks: OoxmlBlockSnapshot[] = [
    { index: 0, kind: 'paragraph', text: '正文引用 [1-3]，随后再次引用 [5, 7]。' },
    { index: 1, kind: 'heading', text: '参考文献', level: 2, paragraphStyle: 'ReferencesHeading' },
    { index: 2, kind: 'paragraph', text: '[1] Ref A', paragraphStyle: 'Reference' },
    { index: 3, kind: 'paragraph', text: '[2] Ref B', paragraphStyle: 'Reference' },
    { index: 4, kind: 'paragraph', text: '[3] Ref C', paragraphStyle: 'Reference' },
    { index: 5, kind: 'paragraph', text: '[5] Ref E', paragraphStyle: 'Reference' },
    { index: 6, kind: 'paragraph', text: '[7] Ref G', paragraphStyle: 'Reference' },
  ]

  try {
    const writeResult = await service.writeOoxmlPackage(tempFile, { blocks })
    assert.equal(writeResult.success, true)

    const firstRead = await service.readOoxmlPackage(tempFile)
    assert.equal(firstRead.exists, true)
    assert.match(firstRead.documentXml || '', /w:fldSimple/i)
    assert.equal(firstRead.bibliographySources.length, 5)
    const firstTags = firstRead.bibliographySources.map((source) => source.tag)
    assert.equal((firstRead.documentXml || '').includes(`CITATION ${firstTags[0]} \\m ${firstTags[1]} \\m ${firstTags[2]} \\* MERGEFORMAT`), true)
    assert.equal((firstRead.documentXml || '').includes(`CITATION ${firstTags[3]} \\m ${firstTags[4]} \\* MERGEFORMAT`), true)

    const secondFile = path.join(tempDir, 'citation-field-roundtrip.docx')
    const secondWrite = await service.writeOoxmlPackage(secondFile, { blocks: firstRead.blocks })
    assert.equal(secondWrite.success, true)
    const secondRead = await service.readOoxmlPackage(secondFile)
    assert.match(secondRead.documentXml || '', /w:fldSimple/i)
    assert.equal(secondRead.bibliographySources.length, 5)
    assert.match(secondRead.plainText, /\[1-3\]/)
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})