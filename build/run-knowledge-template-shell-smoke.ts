import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import JSZip from 'jszip'
import { WorkspaceService } from '../electron/main/services/workspaceService'
import { DocumentEngineService } from '../electron/main/services/documentEngineService'
import { cleanupPreparedCompatibleDocxSource, prepareCompatibleDocxSource } from '../electron/main/services/wordDocumentCompatibility'

const REAL_TEMPLATE_SAMPLE_PATH = path.resolve('docs/拜访函_模板.docx')

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
</Types>`

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdHeader1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
  <Relationship Id="rIdFooter1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
</Relationships>`

const TEMPLATE_DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p><w:r><w:t>模板原始正文</w:t></w:r></w:p>
    <w:sectPr>
      <w:headerReference w:type="default" r:id="rIdHeader1"/>
      <w:footerReference w:type="default" r:id="rIdFooter1"/>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1800" w:bottom="1440" w:left="1800" w:header="851" w:footer="992" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`

const TEMPLATE_HEADER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w10="urn:schemas-microsoft-com:office:word">
  <w:p><w:r><w:t>香港中文大学（深圳）</w:t></w:r></w:p>
  <w:p>
    <w:r>
      <w:pict>
        <v:shape id="AiWriterWatermark" o:spid="_x0000_s2049" type="#_x0000_t136" style="position:absolute;margin-left:0;margin-top:0;width:415pt;height:207.5pt;rotation:315" fillcolor="silver" stroked="f">
          <v:textpath style="font-family:&quot;Calibri&quot;;font-size:1pt" string="AI_WRITER_TEMPLATE_WATERMARK"/>
        </v:shape>
      </w:pict>
    </w:r>
  </w:p>
</w:hdr>`

const TEMPLATE_FOOTER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p><w:r><w:t>模板页脚占位</w:t></w:r></w:p>
</w:ftr>`

function isHeaderFooterEntry(entryName: string): boolean {
  return /^word\/(header|footer)\d+\.xml$/i.test(entryName) || /^word\/_rels\/(header|footer)\d+\.xml\.rels$/i.test(entryName)
}

function resolveSourcePartFromRels(entryName: string): string {
  const normalized = entryName.replace(/\\/g, '/')
  return normalized
    .replace('/_rels/', '/')
    .replace(/\.rels$/i, '')
}

function resolveRelationshipTargets(entryName: string, xml: string): string[] {
  const sourcePart = resolveSourcePartFromRels(entryName)
  const baseDir = path.posix.dirname(sourcePart)
  return Array.from(String(xml || '').matchAll(/Target="([^"]+)"/g))
    .map((match) => String(match[1] || '').trim())
    .filter(Boolean)
    .map((target) => path.posix.normalize(path.posix.join(baseDir, target)).replace(/^\/+/, ''))
}

async function loadZip(filePath: string): Promise<JSZip> {
  return JSZip.loadAsync(await fs.readFile(filePath))
}

async function collectTemplateShellSnapshot(filePath: string): Promise<Map<string, Buffer>> {
  const zip = await loadZip(filePath)
  const entryNames = Object.keys(zip.files)
  const shellEntries = new Set(entryNames.filter(isHeaderFooterEntry))

  for (const entryName of Array.from(shellEntries)) {
    if (!/\.rels$/i.test(entryName)) continue
    const xml = await zip.file(entryName)?.async('text') || ''
    for (const targetEntry of resolveRelationshipTargets(entryName, xml)) {
      if (zip.file(targetEntry)) shellEntries.add(targetEntry)
    }
  }

  const snapshot = new Map<string, Buffer>()
  for (const entryName of Array.from(shellEntries).sort()) {
    const buffer = await zip.file(entryName)?.async('nodebuffer')
    if (buffer) snapshot.set(entryName, buffer)
  }
  return snapshot
}

function assertShellSnapshotEqual(
  actual: Map<string, Buffer>,
  expected: Map<string, Buffer>,
  messagePrefix: string,
): void {
  assert.deepEqual(Array.from(actual.keys()), Array.from(expected.keys()), `${messagePrefix} 应保留同一组页眉页脚资源条目`)
  for (const [entryName, expectedBuffer] of expected.entries()) {
    const actualBuffer = actual.get(entryName)
    assert.ok(actualBuffer, `${messagePrefix} 缺少条目 ${entryName}`)
    assert.equal(Buffer.compare(actualBuffer, expectedBuffer), 0, `${messagePrefix} 应原样保留 ${entryName}`)
  }
}

async function createGeneratedTemplateDocx(filePath: string): Promise<void> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', CONTENT_TYPES_XML)
  zip.file('_rels/.rels', ROOT_RELS_XML)
  zip.file('word/document.xml', TEMPLATE_DOCUMENT_XML)
  zip.file('word/_rels/document.xml.rels', DOCUMENT_RELS_XML)
  zip.file('word/header1.xml', TEMPLATE_HEADER_XML)
  zip.file('word/footer1.xml', TEMPLATE_FOOTER_XML)
  const output = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  await fs.writeFile(filePath, output)
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function resolveTemplateSample(templateDir: string): Promise<{ filePath: string; source: string; applicationPath: string; cleanup?: () => Promise<void>; originalPath?: string }> {
  const requested = String(process.env.AI_WRITER_TEMPLATE_DOCX_SMOKE_PATH || '').trim()
  const preferredRealSample = requested || (await pathExists(REAL_TEMPLATE_SAMPLE_PATH) ? REAL_TEMPLATE_SAMPLE_PATH : '')

  if (preferredRealSample) {
    const preparedSample = await prepareCompatibleDocxSource(preferredRealSample)
    const snapshot = await collectTemplateShellSnapshot(preparedSample.filePath).catch(() => new Map<string, Buffer>())
    if (snapshot.size > 0) {
      return {
        filePath: preparedSample.filePath,
        applicationPath: preferredRealSample,
        source: preparedSample.converted ? (requested ? 'env-converted' : 'repo-real-converted') : (requested ? 'env' : 'repo-real'),
        originalPath: preferredRealSample,
        cleanup: async () => cleanupPreparedCompatibleDocxSource(preparedSample),
      }
    }

    await cleanupPreparedCompatibleDocxSource(preparedSample)
    throw new Error(`真实模板样本不可直接用于 OOXML 模板回归，且自动转换失败: ${preferredRealSample}`)
  }

  const generatedPath = path.join(templateDir, 'generated-template-shell.docx')
  await createGeneratedTemplateDocx(generatedPath)
  return { filePath: generatedPath, applicationPath: generatedPath, source: 'generated' }
}

async function readZipEntryText(filePath: string, entryName: string): Promise<string> {
  const zip = await loadZip(filePath)
  return await zip.file(entryName)?.async('text') || ''
}

async function main(): Promise<void> {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-writer-knowledge-template-shell-'))
  const workspaceService = new WorkspaceService(baseDir)
  const documentEngineService = new DocumentEngineService()

  try {
    const templateSample = await resolveTemplateSample(baseDir)
    try {
      const templateShellSnapshot = await collectTemplateShellSnapshot(templateSample.filePath)
      assert.ok(templateShellSnapshot.size > 0, '模板样本必须包含至少一组页眉或页脚资源')

      if (templateSample.source === 'generated') {
        const generatedHeader = await readZipEntryText(templateSample.filePath, 'word/header1.xml')
        assert.match(generatedHeader, /AI_WRITER_TEMPLATE_WATERMARK/, '生成模板样本应包含 watermark 标记')
      } else if (templateSample.source.includes('real')) {
        const realHeader = await readZipEntryText(templateSample.filePath, 'word/header1.xml')
        const realFooter = await readZipEntryText(templateSample.filePath, 'word/footer1.xml')
        assert.match(realHeader, /<a:blip\b|<wp:anchor\b|<w:drawing\b/i, '真实模板样本页眉应保留抬头图片或图形资源')
        assert.match(realFooter, /招生热线|学校官网|admissions@cuhk\.edu\.cn/i, '真实模板样本页脚应保留联系信息')
      }

      const workspace = await workspaceService.createWorkspace('知识库模板壳子保留')
      const draft = await workspaceService.saveManuscript(
        workspace.path,
        '<p></p>',
        '拜访函模板输出.docx',
        templateSample.applicationPath,
      )

      const seededShellSnapshot = await collectTemplateShellSnapshot(draft.path)
      assertShellSnapshotEqual(seededShellSnapshot, templateShellSnapshot, '模板建稿阶段')

      const rewriteResult = await documentEngineService.writeOoxmlPackage(draft.path, {
        html: '<h1>拜访函</h1><p>这是基于知识库 Word 模板生成的新正文。</p><p>页眉页脚和水印应继续保留。</p>',
      })
      assert.equal(rewriteResult.success, true, '模板建稿后的正文写回应成功')

      const finalShellSnapshot = await collectTemplateShellSnapshot(draft.path)
      assertShellSnapshotEqual(finalShellSnapshot, templateShellSnapshot, '正文写回阶段')

      const finalSnapshot = await documentEngineService.readOoxmlPackage(draft.path)
      assert.equal(finalSnapshot.plainText.includes('拜访函'), true, '最终文档应写入新的正文标题')
      assert.equal(finalSnapshot.plainText.includes('页眉页脚和水印应继续保留。'), true, '最终文档应写入新的正文内容')

      console.log('knowledge template shell smoke passed')
      console.log(JSON.stringify({
        sampleSource: templateSample.source,
        originalSamplePath: templateSample.originalPath || templateSample.filePath,
        samplePath: templateSample.filePath,
        applicationTemplatePath: templateSample.applicationPath,
        draftPath: draft.path,
        preservedEntries: Array.from(templateShellSnapshot.keys()),
      }, null, 2))
    } finally {
      await templateSample.cleanup?.()
    }
  } finally {
    await fs.rm(baseDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})