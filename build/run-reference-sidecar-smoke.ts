import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { WorkspaceService } from '../electron/main/services/workspaceService'

async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function main(): Promise<void> {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-writer-reference-sidecar-'))
  const workspacePath = path.join(baseDir, 'workspace')
  const service = new WorkspaceService(baseDir)

  try {
    await service.createWorkspace('workspace', baseDir)
    const docOne = path.join(workspacePath, 'paper-a.md')
    const docTwo = path.join(workspacePath, 'paper-b.md')
    await fs.writeFile(docOne, '# A\n', 'utf-8')
    await fs.writeFile(docTwo, '# B\n', 'utf-8')

    const refA = { citation: 'Alpha paper', doi: '10.1000/a', year: 2024 }
    const refB = { citation: 'Beta paper', doi: '10.1000/b', year: 2025 }
    const refC = { citation: 'Gamma paper', doi: '10.1000/c', year: 2023 }

    await service.saveReferences(workspacePath, [refA], docOne)
    await service.appendReferences(workspacePath, [refB], docOne)
    await service.saveReferences(workspacePath, [refC], docTwo)

    const docOneRefs = await service.readReferences(workspacePath, docOne)
    const docTwoRefs = await service.readReferences(workspacePath, docTwo)
    assert.equal(docOneRefs.references.length, 2)
    assert.equal(docTwoRefs.references.length, 1)
    assert.equal((docOneRefs.references as any[]).some((item) => item.doi === '10.1000/c'), false)

    assert.equal(await exists(path.join(workspacePath, 'paper-a.references.json')), true)
    assert.equal(await exists(path.join(workspacePath, 'paper-a.references.txt')), true)
    assert.equal(await exists(path.join(workspacePath, 'paper-b.references.json')), true)
    assert.equal(await exists(path.join(workspacePath, 'paper-b.references.txt')), true)

    await service.renameWorkspacePath(workspacePath, 'paper-a.md', 'paper-a-renamed.docx')
    assert.equal(await exists(path.join(workspacePath, 'paper-a.references.json')), false)
    assert.equal(await exists(path.join(workspacePath, 'paper-a.references.txt')), false)
    assert.equal(await exists(path.join(workspacePath, 'paper-a-renamed.references.json')), true)
    assert.equal(await exists(path.join(workspacePath, 'paper-a-renamed.references.txt')), true)

    const renamedDocRefs = await service.readReferences(workspacePath, path.join(workspacePath, 'paper-a-renamed.docx'))
    assert.equal(renamedDocRefs.references.length, 2)

    assert.equal(await exists(path.join(workspacePath, 'references.json')), false)
    assert.equal(await exists(path.join(workspacePath, 'documents')), false)
    assert.equal(await exists(path.join(workspacePath, '01_Main_Manuscript')), false)
    assert.equal(await exists(path.join(workspacePath, '03_Data_and_Analysis')), false)
    assert.equal(await exists(path.join(workspacePath, '04_Figures_and_Tables')), false)

    const legacyWorkspacePath = path.join(baseDir, 'legacy-workspace')
    const legacyManuscriptDir = path.join(legacyWorkspacePath, '01_Main_Manuscript')
    const legacyAnalysisDir = path.join(legacyWorkspacePath, '03_Data_and_Analysis')
    const legacyFiguresDir = path.join(legacyWorkspacePath, '04_Figures_and_Tables', 'Final_Figures')
    const legacyDocumentsDir = path.join(legacyWorkspacePath, 'documents')
    await fs.mkdir(legacyManuscriptDir, { recursive: true })
    await fs.mkdir(legacyAnalysisDir, { recursive: true })
    await fs.mkdir(legacyFiguresDir, { recursive: true })
    await fs.mkdir(legacyDocumentsDir, { recursive: true })

    const legacyPaperPath = path.join(legacyManuscriptDir, 'legacy-paper.md')
    const legacyDraftPath = path.join(legacyDocumentsDir, 'draft.docx')
    const legacyPlanPath = path.join(legacyAnalysisDir, '实验思路.md')
    const legacyFigurePath = path.join(legacyFiguresDir, 'figure-a.png')
    await fs.writeFile(legacyPaperPath, '# legacy\n', 'utf-8')
    await fs.writeFile(legacyDraftPath, 'draft', 'utf-8')
    await fs.writeFile(legacyPlanPath, 'plan', 'utf-8')
    await fs.writeFile(legacyFigurePath, 'img', 'utf-8')
    await fs.writeFile(path.join(legacyWorkspacePath, 'references.json'), JSON.stringify([refA], null, 2), 'utf-8')
    await fs.writeFile(path.join(legacyWorkspacePath, 'References_List.txt'), '1. Alpha paper\n', 'utf-8')

    await service.getWorkspaceTree(legacyWorkspacePath)

    assert.equal(await exists(path.join(legacyWorkspacePath, 'legacy-paper.md')), true)
    assert.equal(await exists(path.join(legacyWorkspacePath, 'draft.docx')), true)
    assert.equal(await exists(path.join(legacyWorkspacePath, '实验思路.md')), false)
    assert.equal(await exists(path.join(legacyWorkspacePath, 'pic', 'figure-a.png')), true)
    assert.equal(await exists(path.join(legacyWorkspacePath, 'legacy-paper.references.json')), true)
    assert.equal(await exists(path.join(legacyWorkspacePath, 'legacy-paper.references.txt')), true)
    assert.equal(await exists(path.join(legacyWorkspacePath, 'references.json')), false)
    assert.equal(await exists(path.join(legacyWorkspacePath, 'References_List.txt')), false)
    assert.equal(await exists(path.join(legacyWorkspacePath, 'documents')), false)
    assert.equal(await exists(path.join(legacyWorkspacePath, '01_Main_Manuscript')), false)
    assert.equal(await exists(path.join(legacyWorkspacePath, '03_Data_and_Analysis')), false)
    assert.equal(await exists(path.join(legacyWorkspacePath, '04_Figures_and_Tables')), false)

    console.log('reference sidecar smoke passed')
  } finally {
    await fs.rm(baseDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})