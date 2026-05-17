import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { WorkspaceService } from '../electron/main/services/workspaceService'
import { buildCitationRenumberPlan, insertCitationMarkerAtSelection, resolveCitationInsertionOffset, updateCitationNumbersInText } from '../src/utils/citationGroups'

async function main(): Promise<void> {
  const sentence = '句2 插入三条新引用。后面还有内容。'
  const selectionEnd = sentence.indexOf('。')
  assert.equal(resolveCitationInsertionOffset(sentence, selectionEnd), selectionEnd + 1)
  assert.equal(
    insertCitationMarkerAtSelection(sentence, sentence.indexOf('插入'), selectionEnd, '[10-12]').text,
    '句2 插入三条新引用。 [10-12]后面还有内容。',
  )

  const bodyText = '前文已有引用[1-8]。句1已有引用[9]。句2插入三条新引用[11-13]。句3原有引用[10]。'
  const items = Array.from({ length: 13 }, (_, index) => {
    const citationNumber = index + 1
    const textByNumber = new Map<number, string>([
      [9, 'Existing Ref 9'],
      [10, 'Existing Ref 10'],
      [11, 'Inserted Ref A'],
      [12, 'Inserted Ref B'],
      [13, 'Inserted Ref C'],
    ])

    return {
      citationNumber,
      text: textByNumber.get(citationNumber) || `Existing Ref ${citationNumber}`,
    }
  })

  const { remap, orderedItems } = buildCitationRenumberPlan(bodyText, items)

  assert.equal(remap.get(9), 9)
  assert.equal(remap.get(10), 13)
  assert.equal(remap.get(11), 10)
  assert.equal(remap.get(12), 11)
  assert.equal(remap.get(13), 12)

  assert.equal(
    updateCitationNumbersInText(bodyText, remap),
    '前文已有引用[1-8]。句1已有引用[9]。句2插入三条新引用[10-12]。句3原有引用[13]。',
  )

  assert.deepEqual(
    orderedItems.slice(8, 13).map((item) => ({ citationNumber: item.citationNumber, text: item.text })),
    [
      { citationNumber: 9, text: 'Existing Ref 9' },
      { citationNumber: 10, text: 'Inserted Ref A' },
      { citationNumber: 11, text: 'Inserted Ref B' },
      { citationNumber: 12, text: 'Inserted Ref C' },
      { citationNumber: 13, text: 'Existing Ref 10' },
    ],
  )

  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-writer-inline-citation-renumber-'))
  const workspaceName = 'workspace'
  const workspacePath = path.join(baseDir, workspaceName)
  const documentPath = path.join(workspacePath, 'paper.md')
  const service = new WorkspaceService(baseDir)

  try {
    await service.createWorkspace(workspaceName, baseDir)
    await fs.writeFile(documentPath, '# paper\n', 'utf-8')

    await service.saveReferences(
      workspacePath,
      orderedItems.map((item) => ({
        reference_number: item.citationNumber,
        citation: item.text,
      })),
      documentPath,
    )

    const saved = await service.readReferences(workspacePath, documentPath)
    assert.deepEqual(
      saved.references.slice(8, 13).map((item: any) => ({ reference_number: item.reference_number, citation: item.citation })),
      [
        { reference_number: 9, citation: 'Existing Ref 9' },
        { reference_number: 10, citation: 'Inserted Ref A' },
        { reference_number: 11, citation: 'Inserted Ref B' },
        { reference_number: 12, citation: 'Inserted Ref C' },
        { reference_number: 13, citation: 'Existing Ref 10' },
      ],
    )

    const sidecarText = await fs.readFile(path.join(workspacePath, 'paper.references.txt'), 'utf-8')
    const entries = sidecarText.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean)
    assert.deepEqual(entries.slice(8, 13), [
      '9. Unknown Authors (n.d.). Existing Ref 9.',
      '10. Unknown Authors (n.d.). Inserted Ref A.',
      '11. Unknown Authors (n.d.). Inserted Ref B.',
      '12. Unknown Authors (n.d.). Inserted Ref C.',
      '13. Unknown Authors (n.d.). Existing Ref 10.',
    ])

    console.log('inline citation renumber smoke passed')
  } finally {
    await fs.rm(baseDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})