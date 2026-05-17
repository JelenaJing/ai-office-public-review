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
    <w:p><w:r><w:t>Image uniqueness seed</w:t></w:r></w:p>
    <w:sectPr/>
  </w:body>
</w:document>`

const RED_PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF6sAAAAASUVORK5CYII='
const BLUE_PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAusB9WnRsl0AAAAASUVORK5CYII='

async function createMinimalDocx(targetPath: string): Promise<void> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', CONTENT_TYPES_XML)
  zip.file('_rels/.rels', ROOT_RELS_XML)
  zip.file('word/document.xml', SOURCE_DOCUMENT_XML)
  zip.file('word/_rels/document.xml.rels', DOCUMENT_RELS_XML)
  const output = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  await fs.writeFile(targetPath, output)
}

function extractImageTargets(relationshipsXml: string): string[] {
  return Array.from(
    String(relationshipsXml || '').matchAll(/<Relationship\s+Id="([^"]+)"\s+Type="[^"]*\/image"\s+Target="([^"]+)"\s*\/?>/g),
  ).map((match) => match[2])
}

async function main(): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-writer-image-unique-smoke-'))
  const filePath = path.join(tempDir, 'generated-images.docx')
  const service = new DocumentEngineService()

  try {
    await createMinimalDocx(filePath)

    const writeResult = await service.writeOoxmlPackage(filePath, {
      blocks: [
        { index: 0, kind: 'paragraph', text: '图片唯一性回归测试' },
        {
          index: 1,
          kind: 'image-placeholder',
          text: 'Figure',
          alt: 'Figure',
          title: 'DuplicateCaption',
          previewSrc: `data:image/png;base64,${RED_PIXEL}`,
        },
        { index: 2, kind: 'paragraph', text: '图 1 说明' },
        {
          index: 3,
          kind: 'image-placeholder',
          text: 'Figure',
          alt: 'Figure',
          title: 'DuplicateCaption',
          previewSrc: `data:image/png;base64,${BLUE_PIXEL}`,
        },
        { index: 4, kind: 'paragraph', text: '图 2 说明' },
      ],
    })

    assert.equal(writeResult.success, true, '图片唯一性 smoke 写回应该成功')

    const buffer = await fs.readFile(filePath)
    const zip = await JSZip.loadAsync(buffer)
    const relationshipsXml = await zip.file('word/_rels/document.xml.rels')!.async('text')
    const imageTargets = extractImageTargets(relationshipsXml)
    assert.equal(imageTargets.length, 2, '应写入两条图片 relationship')
    assert.equal(new Set(imageTargets).size, 2, '不同图片必须写入不同的 media target')

    const firstImage = await zip.file(`word/${imageTargets[0]}`)!.async('nodebuffer')
    const secondImage = await zip.file(`word/${imageTargets[1]}`)!.async('nodebuffer')
    assert.notDeepEqual(firstImage, secondImage, '不同图片的媒体内容不应被覆盖成同一份 buffer')

    console.log('generated image media uniqueness smoke passed')
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

void main()