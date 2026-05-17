import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { DocumentEngineService } from '../electron/main/services/documentEngineService'
import { WorkspaceService } from '../electron/main/services/workspaceService'
import { createDocumentSchema, createImageBlock, createParagraphBlock } from '../src/document/schema'

async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function main(): Promise<void> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-writer-runtime-smoke-'))
  const workspaceRegistryDir = path.join(tempRoot, 'workspace-registry')
  const workspaceParentDir = path.join(tempRoot, 'workspace-parent')

  const workspaceService = new WorkspaceService(workspaceRegistryDir)
  const documentEngineService = new DocumentEngineService()

  const createdWorkspace = await workspaceService.createWorkspace('runtime-smoke', workspaceParentDir)
  const workspacePath = createdWorkspace.path

  console.log(`[smoke] workspace=${workspacePath}`)

  await workspaceService.createWorkspaceFolder(workspacePath, 'drafts')
  await workspaceService.createWorkspaceFolder(workspacePath, 'copied')
  await workspaceService.createWorkspaceFolder(workspacePath, 'moved')

  const blankDocument = await workspaceService.createBlankDocument(workspacePath, 'drafts/blank')
  const blankDocumentPath = blankDocument.path
  assert.equal(await exists(blankDocumentPath), true, '空白文档未创建成功')
  console.log(`[smoke] blank-doc=${blankDocumentPath}`)

  const blankSnapshot = await documentEngineService.readOoxmlPackage(blankDocumentPath)
  assert.equal(blankSnapshot.exists, true, '空白文档无法读取')
  assert.ok(blankSnapshot.documentXml, '空白文档缺少 document.xml')
  assert.ok(blankSnapshot.html.includes('<p'), '空白文档未解析出 HTML 段落')
  console.log(`[smoke] open-doc ok blocks=${blankSnapshot.blockCount} paragraphs=${blankSnapshot.paragraphCount}`)

  const copiedDocument = await workspaceService.copyWorkspacePath(
    workspacePath,
    'drafts/blank.docx',
    'copied/blank.docx',
  )
  assert.equal(await exists(copiedDocument.path), true, '复制后的文档不存在')
  assert.equal(await exists(blankDocumentPath), true, '复制不应删除原始文档')
  console.log(`[smoke] copy-file=${copiedDocument.path}`)

  const movedDocument = await workspaceService.moveWorkspacePath(
    workspacePath,
    'copied/blank.docx',
    'moved/blank.docx',
  )
  assert.equal(await exists(movedDocument.path), true, '剪切粘贴后的文档不存在')
  assert.equal(await exists(path.join(workspacePath, 'copied', 'blank.docx')), false, '剪切后原始位置仍存在文档')
  console.log(`[smoke] cut-paste-file=${movedDocument.path}`)

  const conflictCopy = await workspaceService.copyWorkspacePath(
    workspacePath,
    'drafts/blank.docx',
    'moved/blank.docx',
  )
  assert.equal(await exists(conflictCopy.path), true, '冲突复制后的文档不存在')
  assert.notEqual(conflictCopy.path, movedDocument.path, '同名粘贴未生成唯一文件名')
  console.log(`[smoke] paste-conflict-file=${conflictCopy.path}`)

  await workspaceService.createWorkspaceFolder(workspacePath, 'assets/nested')
  await workspaceService.createWorkspaceFile(workspacePath, 'assets/nested/readme.txt')
  await workspaceService.writeWorkspaceFile(workspacePath, 'assets/nested/readme.txt', 'runtime smoke content')

  const savedSchema = await workspaceService.saveWorkspaceDocumentSchema(workspacePath, createDocumentSchema({
    id: 'workspace-runtime-smoke-document',
    profile: 'freewrite',
    title: 'Workspace Runtime Smoke',
    sourceType: 'workspace-json',
    blocks: [
      createParagraphBlock({
        id: 'paragraph-1',
        text: 'Schema persisted paragraph.',
      }),
      createImageBlock({
        id: 'image-1',
        resourceRef: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WnHCq0AAAAASUVORK5CYII=',
        caption: 'Smoke image',
      }),
    ],
  }))
  assert.equal(await exists(savedSchema.jsonPath), true, 'document.json 未写入成功')
  assert.equal(savedSchema.document.meta.title, 'Workspace Runtime Smoke')
  assert.equal(savedSchema.document.blocks.some((block) => block.type === 'image' && !String(block.resourceRef || '').startsWith('data:')), true, '图片 block 未被规范化为真实资源路径')
  const persistedJson = JSON.parse(await fs.readFile(savedSchema.jsonPath, 'utf-8')) as { blocks: Array<{ type: string; resourceRef?: string }>; resources: Array<{ id: string; path: string }> }
  assert.equal(Array.isArray(persistedJson.resources), true, 'document.json 缺少 resources')
  assert.equal(persistedJson.blocks.some((block) => block.type === 'image' && String(block.resourceRef || '').startsWith('assets/')), true, 'document.json 中图片 block 未引用 assets 资源')
  assert.equal(persistedJson.resources.some((resource) => resource.id === resource.path && resource.path.startsWith('assets/')), true, 'document.json 中图片资源未落到 assets/')

  const restoredSchema = await workspaceService.readWorkspaceDocumentSchema(workspacePath)
  assert.equal(restoredSchema.source, 'document-json', '工作区重新打开后未优先从 document.json 恢复')
  assert.equal(restoredSchema.document.blocks.some((block) => block.type === 'paragraph' && block.text === 'Schema persisted paragraph.'), true, 'document.json 恢复后正文内容丢失')
  assert.equal(restoredSchema.document.blocks.some((block) => block.type === 'image' && !String(block.resourceRef || '').startsWith('data:')), true, 'document.json 恢复后图片仍是 base64/占位文本')
  console.log(`[smoke] workspace-document-json=${savedSchema.jsonPath}`)

  const copiedFolder = await workspaceService.copyWorkspacePath(
    workspacePath,
    'assets',
    'assets-copy',
  )
  const copiedFolderFile = path.join(copiedFolder.path, 'nested', 'readme.txt')
  assert.equal(await exists(copiedFolderFile), true, '复制后的目录内容不存在')
  assert.equal(await fs.readFile(copiedFolderFile, 'utf-8'), 'runtime smoke content', '复制后的目录内容不正确')
  console.log(`[smoke] copy-folder=${copiedFolder.path}`)

  const movedFolder = await workspaceService.moveWorkspacePath(
    workspacePath,
    'assets-copy',
    'moved/assets-copy',
  )
  const movedFolderFile = path.join(movedFolder.path, 'nested', 'readme.txt')
  assert.equal(await exists(movedFolderFile), true, '剪切粘贴后的目录内容不存在')
  assert.equal(await exists(path.join(workspacePath, 'assets-copy')), false, '目录剪切后原始位置仍存在')
  console.log(`[smoke] cut-paste-folder=${movedFolder.path}`)

  const tree = await workspaceService.getWorkspaceTree(workspacePath)
  const relativePaths = JSON.stringify(tree)
  assert.ok(relativePaths.includes('drafts/blank.docx'), '工作区树未包含原始空白文档')
  assert.ok(relativePaths.includes('moved/blank.docx'), '工作区树未包含移动后的文档')
  assert.ok(relativePaths.includes('moved/assets-copy'), '工作区树未包含移动后的目录')
  console.log(`[smoke] tree-ok rootNodes=${tree.length}`)

  console.log(`[smoke] success tempRoot=${tempRoot}`)
}

main().catch((error) => {
  console.error('[smoke] failed', error)
  process.exitCode = 1
})