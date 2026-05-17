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

async function readJson(targetPath: string): Promise<any> {
  return JSON.parse(await fs.readFile(targetPath, 'utf-8'))
}

async function listVisibleEntries(dirPath: string): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  return entries.filter((entry) => !entry.name.startsWith('.')).map((entry) => entry.name).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
}

async function main(): Promise<void> {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-writer-article-workspace-'))
  const service = new WorkspaceService(baseDir)
  const imageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9oNcamQAAAAASUVORK5CYII='

  try {
    const firstCreated = await service.createWorkspace('多模态医学综述草稿')
    const secondCreated = await service.createWorkspace('新的研究论文')

    assert.notEqual(firstCreated.path, secondCreated.path, '新建第二篇文章时应生成新的工作区目录')
    assert.equal(await exists(firstCreated.path), true, '第一篇文章目录应存在')
    assert.equal(await exists(secondCreated.path), true, '第二篇文章目录应存在')

    const finalTitle = '多模态医学影像大模型在临床辅助诊断中的应用综述'
    const manuscriptFileName = `${finalTitle}.docx`
    const manuscriptResult = await service.saveManuscript(firstCreated.path, `# ${finalTitle}\n\n这是烟测正文。\n`, manuscriptFileName)
    await service.saveReferences(firstCreated.path, [
      { title: 'Clinical multimodal foundation model', citation: 'Clinical multimodal foundation model', year: 2025, doi: '10.1000/alpha' },
      { title: 'Large vision-language model for diagnosis', citation: 'Large vision-language model for diagnosis', year: 2024, doi: '10.1000/beta' },
    ], manuscriptResult.path)
    const imageResult = await service.saveImageToWorkspace(firstCreated.path, 'figure-1.png', imageBase64)

    const renamed = await service.renameWorkspace(firstCreated.path, finalTitle)

    const renamedManuscriptPath = path.join(renamed.path, manuscriptFileName)
    const renamedReferencesJsonPath = path.join(renamed.path, `${finalTitle}.references.json`)
    const renamedReferencesTxtPath = path.join(renamed.path, `${finalTitle}.references.txt`)
    const renamedImagePath = path.join(renamed.path, imageResult.relativePath)

    assert.equal(await exists(renamed.path), true, '按最终标题重命名后，文章目录应存在')
    assert.equal(await exists(firstCreated.path), false, '旧的临时文章目录应被替换为新标题目录')
    assert.equal(await exists(renamedManuscriptPath), true, '全文 DOCX 应保存在文章目录根部')
    assert.equal(await exists(renamedReferencesJsonPath), true, '引用 json sidecar 应保存在文章目录根部')
    assert.equal(await exists(renamedReferencesTxtPath), true, '引用 txt sidecar 应保存在文章目录根部')
    assert.equal(await exists(renamedImagePath), true, '文章图片应保存在文章目录内的 pic 文件夹')
    assert.equal(await exists(path.join(renamed.path, 'pic')), true, '文章目录内应存在 pic 文件夹')
    assert.equal(await exists(path.join(renamed.path, 'reference')), true, '文章目录内应预建 reference 文件夹')

    const references = await readJson(renamedReferencesJsonPath)
    assert.equal(Array.isArray(references), true, '引用 sidecar 应为数组结构')
    assert.equal(references.length, 2, '应写入 2 条引用')

    const topLevelEntries = await listVisibleEntries(renamed.path)
    assert.deepEqual(topLevelEntries, [
      `${finalTitle}.docx`,
      `${finalTitle}.references.json`,
      `${finalTitle}.references.txt`,
      'assets',
      'pic',
      'reference',
    ], '全文、引用与 pic/reference 目录应全部落在文章目录内，且不再散落旧目录结构')

    const baseDirEntries = await listVisibleEntries(baseDir)
    assert.deepEqual(baseDirEntries, [path.basename(renamed.path), path.basename(secondCreated.path)], '新建第二篇文章后，基础目录下应同时存在两个独立文章工作区')

    console.log('article workspace smoke passed')
    console.log(JSON.stringify({
      renamedWorkspace: renamed.path,
      manuscriptPath: renamedManuscriptPath,
      referencesJsonPath: renamedReferencesJsonPath,
      referencesTxtPath: renamedReferencesTxtPath,
      imagePath: renamedImagePath,
      secondWorkspace: secondCreated.path,
    }, null, 2))
  } finally {
    await fs.rm(baseDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})