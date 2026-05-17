import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import JSZip from 'jszip'
import { KnowledgeService } from '../electron/main/services/knowledgeService'

const execFileAsync = promisify(execFile)

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`

function escapeXml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

async function createDocx(filePath: string, paragraphs: string[]): Promise<void> {
  const body = paragraphs.map((paragraph) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(paragraph)}</w:t></w:r></w:p>`).join('')
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${body}
    <w:sectPr/>
  </w:body>
</w:document>`

  const zip = new JSZip()
  zip.file('[Content_Types].xml', CONTENT_TYPES_XML)
  zip.file('_rels/.rels', ROOT_RELS_XML)
  zip.file('word/document.xml', documentXml)
  zip.file('word/_rels/document.xml.rels', DOCUMENT_RELS_XML)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const output = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  await fs.writeFile(filePath, output)
}

async function convertWithOffice(inputPath: string, formatCandidates: string[], outputExtension: string): Promise<string> {
  const outDir = path.dirname(inputPath)
  const baseName = path.basename(inputPath, path.extname(inputPath))
  const targetPath = path.join(outDir, `${baseName}.${outputExtension}`)

  for (const command of ['soffice', 'libreoffice']) {
    for (const format of formatCandidates) {
      try {
        await execFileAsync(command, ['--headless', '--convert-to', format, '--outdir', outDir, inputPath], {
          timeout: 120000,
          maxBuffer: 8 * 1024 * 1024,
        })
        await fs.access(targetPath)
        return targetPath
      } catch {
        continue
      }
    }
  }

  throw new Error(`无法将 ${path.basename(inputPath)} 转成 ${outputExtension}`)
}

async function createFixtures(fixturesDir: string): Promise<Record<string, string>> {
  const markdownPath = path.join(fixturesDir, 'knowledge-template-report.md')
  const txtPath = path.join(fixturesDir, 'knowledge-reference-facts.txt')
  const docxPath = path.join(fixturesDir, 'knowledge-remake-source.docx')
  const pdfSourceDocxPath = path.join(fixturesDir, 'knowledge-reference-whitepaper.docx')
  const legacySourceDocxPath = path.join(fixturesDir, 'knowledge-legacy-proposal.docx')

  await fs.writeFile(markdownPath, [
    '# 医疗数据治理年度报告模板',
    '',
    '## 执行摘要',
    '本模板用于沉淀年度数据治理报告的结构、语气与章节节奏。',
    '',
    '## 风险与建议',
    '请围绕数据质量、权限边界、审计链路和改进计划组织正文。',
  ].join('\n'), 'utf-8')

  await fs.writeFile(txtPath, [
    '参考资料：2025 年医院数据治理关键事实。',
    '重点包括主数据一致性、数据血缘可追溯、审计日志保留 180 天。',
    '相关术语：数据资产目录、权限矩阵、指标口径统一。',
  ].join('\n'), 'utf-8')

  await createDocx(docxPath, [
    '医疗数据治理季度分析原稿',
    '第一部分说明现有数据平台的组织边界与职责分工。',
    '第二部分总结数据质量、接口稳定性和审计流程中的主要问题。',
    '第三部分给出后续整改计划与里程碑。',
  ])

  await createDocx(pdfSourceDocxPath, [
    '白皮书：临床数据共享与合规审查',
    '本白皮书讨论共享审批、脱敏流程、科研访问授权和跨部门协作。',
    '建议统一术语、审批编号与责任矩阵。',
  ])

  await createDocx(legacySourceDocxPath, [
    '历史方案：旧版病案归档流程',
    '该方案包含纸质病案扫描、索引录入、质控抽检和归档审批。',
    '保留术语：病案首页、归档时效、抽检合格率。',
  ])

  const pdfPath = await convertWithOffice(pdfSourceDocxPath, ['pdf'], 'pdf')
  const docPath = await convertWithOffice(legacySourceDocxPath, ['doc', 'doc:MS Word 97', 'doc:"MS Word 97"'], 'doc')

  return {
    markdownPath,
    txtPath,
    docxPath,
    pdfPath,
    docPath,
  }
}

async function main(): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-writer-knowledge-service-smoke-'))
  const knowledgeRoot = path.join(tempDir, 'knowledge-base')
  const fixturesDir = path.join(tempDir, 'fixtures')
  const service = new KnowledgeService(knowledgeRoot)

  try {
    await fs.mkdir(fixturesDir, { recursive: true })
    const fixtures = await createFixtures(fixturesDir)

    const initialInfo = await service.getInfo()
    assert.equal(initialInfo.documentCount, 0, '知识库初始应为空')

    const firstImport = await service.importDocuments([
      fixtures.markdownPath,
      fixtures.txtPath,
      fixtures.docxPath,
      fixtures.pdfPath,
      fixtures.docPath,
    ])

    assert.equal(firstImport.failed.length, 0, '样例文件导入不应失败')
    assert.equal(firstImport.imported.length, 5, '应导入五种知识库文件')
    assert.deepEqual(
      firstImport.imported.map((item) => item.sourceType).sort(),
      ['doc', 'docx', 'md', 'pdf', 'txt'],
      '导入结果应覆盖五种文件类型',
    )
    assert.ok(firstImport.imported.every((item) => item.extractionStatus === 'ready'), '当前环境下五种文件都应能完成提取')

    const infoAfterImport = await service.getInfo()
    assert.equal(infoAfterImport.documentCount, 5, '导入后知识库文档数应为 5')

    const documents = await service.listDocuments()
    assert.equal(documents.length, 5, '文档列表应返回全部导入项')
    const queryMatches = await service.listDocuments('白皮书')
    assert.equal(queryMatches.length, 1, '关键词检索应命中 PDF 白皮书文档')
    assert.equal(queryMatches[0].sourceType, 'pdf')

    const templateDocument = documents.find((item) => item.sourceType === 'md')
    const referenceTxt = documents.find((item) => item.sourceType === 'txt')
    const referencePdf = documents.find((item) => item.sourceType === 'pdf')
    const legacyDoc = documents.find((item) => item.sourceType === 'doc')
    const remakeSource = documents.find((item) => item.sourceType === 'docx')
    assert.ok(templateDocument && referenceTxt && referencePdf && legacyDoc && remakeSource, '应能找到所有关键文档类型')

    const templateDetail = await service.getDocument(templateDocument!.id)
    const pdfDetail = await service.getDocument(referencePdf!.id)
    const legacyDetail = await service.getDocument(legacyDoc!.id)
    const remakeDetail = await service.getDocument(remakeSource!.id)
    assert.ok(templateDetail?.extractedText.includes('执行摘要'), 'Markdown 模板正文应可读取')
    assert.ok(pdfDetail?.extractedText.includes('临床数据共享与合规审查'), 'PDF 正文应可提取')
    assert.ok(legacyDetail?.extractedText.includes('旧版病案归档流程'), 'DOC 正文应可提取')
    assert.ok(remakeDetail?.extractedText.includes('季度分析原稿'), 'DOCX 正文应可提取')
    assert.ok(templateDetail?.parsedDocument, '导入后详情必须带出 parsedDocument')
    assert.ok(pdfDetail?.parsedDocument, 'PDF 导入后详情必须带出 parsedDocument')
    assert.ok(templateDetail?.parsedDocumentRelativePath?.endsWith('/parsed/document.json'), '详情必须暴露 parsed/document.json 路径')
    assert.ok(templateDetail?.chunkIndexRelativePath?.endsWith('/parsed/chunks.json'), '详情必须暴露 parsed/chunks.json 路径')
    assert.ok(templateDetail?.assetDirRelativePath?.endsWith('/parsed/assets'), '详情必须暴露 parsed/assets 路径')

    const templateParsedJsonPath = path.join(knowledgeRoot, templateDetail!.parsedDocumentRelativePath!)
    const templateChunkJsonPath = path.join(knowledgeRoot, templateDetail!.chunkIndexRelativePath!)
    await fs.access(templateParsedJsonPath)
    await fs.access(templateChunkJsonPath)

    const templateParsedRaw = JSON.parse(await fs.readFile(templateParsedJsonPath, 'utf-8')) as { schemaVersion?: string; sections?: unknown[]; blocks?: unknown[]; chunkIndex?: unknown[]; metadata?: Record<string, unknown> }
    assert.equal(templateParsedRaw.schemaVersion, '1.0', '标准 Knowledge JSON 必须落盘 schemaVersion=1.0')
    assert.ok(Array.isArray(templateParsedRaw.sections) && templateParsedRaw.sections.length > 0, '标准 Knowledge JSON 必须包含 sections')
    assert.ok(Array.isArray(templateParsedRaw.blocks) && templateParsedRaw.blocks.length > 0, '标准 Knowledge JSON 必须包含 blocks')
    assert.ok(Array.isArray(templateParsedRaw.chunkIndex), '标准 Knowledge JSON 必须包含 chunkIndex')
    assert.ok(String(templateParsedRaw.metadata?.sourceRelativePath || '').includes('/source/'), '标准 Knowledge JSON metadata 必须记录 source 相对路径')
    assert.ok(String(templateParsedRaw.metadata?.parsedRelativePath || '').includes('/parsed/document.json'), '标准 Knowledge JSON metadata 必须记录 parsed/document.json 路径')

    const duplicateImport = await service.importDocuments([
      fixtures.markdownPath,
      fixtures.txtPath,
      fixtures.docxPath,
      fixtures.pdfPath,
      fixtures.docPath,
    ])
    assert.equal(duplicateImport.imported.length, 0, '重复导入不应新增文档')
    assert.equal(duplicateImport.duplicates.length, 5, '重复导入应全部识别为重复')

    await service.saveTaskRecord({
      id: 'knowledge-template-generation-smoke',
      externalTaskId: 'knowledge-template-generation-smoke',
      type: 'template-generation',
      status: 'completed',
      title: '知识库模板写作 smoke',
      templateDocumentId: templateDocument!.id,
      sourceDocumentIds: [templateDocument!.id, referenceTxt!.id, referencePdf!.id],
      referenceDocumentIds: [referenceTxt!.id, referencePdf!.id],
      outputPreview: '已根据模板与参考资料生成新的治理报告。',
    })

    await service.saveTaskRecord({
      id: 'knowledge-reference-generation-smoke',
      externalTaskId: 'knowledge-reference-generation-smoke',
      type: 'reference-generation',
      status: 'completed',
      title: '知识库参考写作 smoke',
      sourceDocumentIds: [referenceTxt!.id, referencePdf!.id, legacyDoc!.id],
      referenceDocumentIds: [referenceTxt!.id, referencePdf!.id, legacyDoc!.id],
      outputPreview: '已基于多份参考资料生成综合综述。',
    })

    const templateAfterTask = await service.getDocument(templateDocument!.id)
    assert.equal(templateAfterTask?.meta.templateUsageCount, 1, '模板写作任务应累计模板使用次数')
    assert.ok(templateAfterTask?.meta.lastUsedAsTemplateAt, '模板写作任务应回写最近模板使用时间')
    assert.ok(templateAfterTask?.tasks.some((item) => item.id === 'knowledge-template-generation-smoke'), '模板文档详情应带出关联写作任务')

    const referenceAfterTask = await service.getDocument(referenceTxt!.id)
    assert.ok(referenceAfterTask?.tasks.some((item) => item.id === 'knowledge-template-generation-smoke'), '参考资料详情应带出模板写作任务')
    assert.ok(referenceAfterTask?.tasks.some((item) => item.id === 'knowledge-reference-generation-smoke'), '参考资料详情应带出参考写作任务')

    const remakeResult = await service.createRemakeVersion({
      taskId: 'knowledge-remake-service-smoke',
      documentId: remakeSource!.id,
      instruction: '保留章节框架，改写成面向年度复盘的版本，突出风险优先级和整改里程碑。',
      title: '医疗数据治理季度分析（Remake）',
      content: [
        '医疗数据治理年度复盘',
        '一、组织边界与职责分工需要进一步固化，确保主数据维护责任明确。',
        '二、当前高优先级风险包括数据质量波动、接口告警滞后和审计留痕不足。',
        '三、整改计划分为当季修复、半年度机制建设和年度审计闭环三阶段。',
      ].join('\n'),
    })

    assert.equal(remakeResult.version.kind, 'remake', 'remake 结果应生成新版本')
    assert.equal(remakeResult.document.versionCount, 2, 'remake 后版本数应递增')
    assert.ok(remakeResult.document.lastRemadeAt, 'remake 后应记录最近重写时间')

    const remakeAfter = await service.getDocument(remakeSource!.id)
    assert.equal(remakeAfter?.currentVersionId, remakeResult.version.id, '当前版本应切换到 remake 版本')
    assert.ok(remakeAfter?.extractedText.includes('年度复盘'), '文档详情应返回 remake 后正文')
    assert.ok(remakeAfter?.tasks.some((item) => item.id === 'knowledge-remake-service-smoke' && item.status === 'completed'), '文档详情应带出 remake 任务记录')

    const originalVersionId = remakeAfter?.versions.find((item) => item.kind === 'source')?.id
    assert.ok(originalVersionId, '应保留原始导入版本')
    await service.setCurrentVersion(remakeSource!.id, originalVersionId!)
    const restoredDetail = await service.getDocument(remakeSource!.id)
    assert.equal(restoredDetail?.currentVersionId, originalVersionId, '应能切回原始版本')
    assert.ok(restoredDetail?.extractedText.includes('季度分析原稿'), '切回原始版本后正文应恢复原始导入内容')

    const taskRecords = await service.listTaskRecords(10)
    assert.deepEqual(
      taskRecords.map((item) => item.id).slice(0, 3).sort(),
      ['knowledge-reference-generation-smoke', 'knowledge-remake-service-smoke', 'knowledge-template-generation-smoke'].sort(),
      '任务列表应包含写作与 remake 记录',
    )

    console.log('knowledge service smoke passed')
    console.log(JSON.stringify({
      importedSourceTypes: firstImport.imported.map((item) => item.sourceType).sort(),
      documentCount: infoAfterImport.documentCount,
      templateUsageCount: templateAfterTask?.meta.templateUsageCount,
      remakeVersionId: remakeResult.version.id,
    }, null, 2))
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

void main()