import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { DocumentEngineService } from '../electron/main/services/documentEngineService'

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

const SOURCE_DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Reference numbering seed</w:t></w:r></w:p>
    <w:sectPr/>
  </w:body>
</w:document>`

async function createMinimalDocx(targetPath: string): Promise<void> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', CONTENT_TYPES_XML)
  zip.file('_rels/.rels', ROOT_RELS_XML)
  zip.file('word/document.xml', SOURCE_DOCUMENT_XML)
  zip.file('word/_rels/document.xml.rels', DOCUMENT_RELS_XML)
  const output = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  await fs.writeFile(targetPath, output)
}

async function main(): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-writer-reference-numbering-smoke-'))
  const filePath = path.join(tempDir, 'reference-numbering.docx')
  const htmlOnlyFilePath = path.join(tempDir, 'reference-numbering-html-only.docx')
  const service = new DocumentEngineService()

  try {
    await createMinimalDocx(filePath)
    await createMinimalDocx(htmlOnlyFilePath)

    const writeResult = await service.writeOoxmlPackage(filePath, {
      html: '<h1>参考文献</h1><p data-paragraph-style="Reference">未编号参考文献 A</p><p data-paragraph-style="Reference">未编号参考文献 B</p>',
      plainText: '参考文献\n\n未编号参考文献 A\n\n未编号参考文献 B',
      blocks: [
        { index: 0, kind: 'heading', text: '参考文献', level: 1, paragraphStyle: 'ReferencesHeading' },
        { index: 1, kind: 'paragraph', text: '[1] 编号参考文献 A', paragraphStyle: 'Reference' },
        { index: 2, kind: 'paragraph', text: '[2] 编号参考文献 B', paragraphStyle: 'Reference' },
      ],
    })

    assert.equal(writeResult.success, true, '引用编号 smoke 写回应该成功')

    const buffer = await fs.readFile(filePath)
    const zip = await JSZip.loadAsync(buffer)
    const documentXml = await zip.file('word/document.xml')!.async('text')
    assert.match(documentXml, /\[1\] 编号参考文献 A/, 'DOCX 应写入第一条引用编号')
    assert.match(documentXml, /\[2\] 编号参考文献 B/, 'DOCX 应写入第二条引用编号')
    assert.doesNotMatch(documentXml, /未编号参考文献 A/, '写回时不应退回到未编号 HTML 引用')

    const snapshot = await service.readOoxmlPackage(filePath)
    const referenceBlocks = snapshot.blocks.filter((block) => block.paragraphStyle === 'Reference')
    assert.deepEqual(referenceBlocks.map((block) => block.text), ['[1] 编号参考文献 A', '[2] 编号参考文献 B'], '回读的引用段落应保留编号')

    const htmlOnlyWriteResult = await service.writeOoxmlPackage(htmlOnlyFilePath, {
      html: '<h1 data-semantic-role="references-heading">参考文献</h1><ol class="references-list"><li>HTML 引用 A</li><li>HTML 引用 B</li></ol>',
      plainText: '参考文献\n\nHTML 引用 A\n\nHTML 引用 B',
    })

    assert.equal(htmlOnlyWriteResult.success, true, 'html-only 引用编号 smoke 写回应该成功')

    const htmlOnlyBuffer = await fs.readFile(htmlOnlyFilePath)
    const htmlOnlyZip = await JSZip.loadAsync(htmlOnlyBuffer)
    const htmlOnlyDocumentXml = await htmlOnlyZip.file('word/document.xml')!.async('text')
    assert.match(htmlOnlyDocumentXml, /w:numId w:val="901"/, 'html-only 引用列表应写入 Word 编号列表配置')
    assert.match(htmlOnlyDocumentXml, /HTML 引用 A/, 'html-only 引用列表应保留第一条内容')
    assert.match(htmlOnlyDocumentXml, /HTML 引用 B/, 'html-only 引用列表应保留第二条内容')

    const htmlOnlySnapshot = await service.readOoxmlPackage(htmlOnlyFilePath)
    const htmlOnlyHeading = htmlOnlySnapshot.blocks.find((block) => block.kind === 'heading' && String(block.text || '').trim() === '参考文献')
    const htmlOnlyReferenceBlocks = htmlOnlySnapshot.blocks.filter((block) => block.paragraphStyle === 'Reference')
    assert.equal(htmlOnlyHeading?.paragraphStyle, 'ReferencesHeading', 'Word 编号列表回读后应识别参考文献标题')
    assert.deepEqual(
      htmlOnlyReferenceBlocks.map((block) => ({ text: block.text, listType: block.listType })),
      [
        { text: '[1] HTML 引用 A', listType: undefined },
        { text: '[2] HTML 引用 B', listType: undefined },
      ],
      'html-only 引用列表回读后应标准化为可编辑的显式编号参考文献',
    )

    console.log('reference numbering smoke passed')
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

void main()