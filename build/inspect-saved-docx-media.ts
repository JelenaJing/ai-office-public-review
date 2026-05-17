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
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`

const SOURCE_DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>图片嵌入检查</w:t></w:r>
    </w:p>
    <w:p>
      <w:r>
        <w:drawing>
          <wp:anchor distT="0" distB="0" distL="114300" distR="114300">
            <wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>
            <wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>
            <wp:extent cx="1905000" cy="952500"/>
            <wp:wrapSquare wrapText="bothSides"/>
            <wp:docPr id="42" name="SourceImage" descr="源图片" title="源图片"/>
            <a:graphic>
              <a:graphicData>
                <pic:pic>
                  <pic:nvPicPr><pic:cNvPr id="0" name="SourceImage"/></pic:nvPicPr>
                  <pic:blipFill><a:blip r:embed="rId5"/></pic:blipFill>
                </pic:pic>
              </a:graphicData>
            </a:graphic>
          </wp:anchor>
        </w:drawing>
      </w:r>
    </w:p>
    <w:sectPr/>
  </w:body>
</w:document>`

async function createMinimalDocx(targetPath: string): Promise<void> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', CONTENT_TYPES_XML)
  zip.file('_rels/.rels', ROOT_RELS_XML)
  zip.file('word/document.xml', SOURCE_DOCUMENT_XML)
  zip.file('word/_rels/document.xml.rels', DOCUMENT_RELS_XML)
  zip.file('word/media/image1.png', Buffer.from([137, 80, 78, 71]))
  const output = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  await fs.writeFile(targetPath, output)
}

async function main(): Promise<void> {
  const imagePath = path.resolve('/data/AI_writer/NFTCORE/logo.png')
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-writer-docx-media-check-'))
  const filePath = path.join(tempDir, 'saved-with-local-image.docx')
  const service = new DocumentEngineService()

  await createMinimalDocx(filePath)
  const snapshot = await service.readOoxmlPackage(filePath)
  const imageBlock = snapshot.blocks.find((block) => block.kind === 'image-placeholder')
  if (!imageBlock) {
    throw new Error('未能从临时 DOCX 中解析出图片 block')
  }

  const nextBlocks = snapshot.blocks.map((block) => {
    if (block.kind !== 'image-placeholder') {
      return block
    }
    return {
      ...block,
      alt: '本地图片嵌入检查',
      title: 'LocalImageCheck',
      previewSrc: `file://${imagePath}`,
      sourceId: imagePath,
      mediaPath: 'word/media/local-image-check.png',
      mediaContentType: undefined,
    }
  })

  const writeResult = await service.writeOoxmlPackage(filePath, { blocks: nextBlocks })
  if (!writeResult.success) {
    throw new Error('writeOoxmlPackage 失败，未生成可检查的 DOCX')
  }

  const buffer = await fs.readFile(filePath)
  const zip = await JSZip.loadAsync(buffer)
  const entries = Object.keys(zip.files).sort()
  const mediaEntries = entries.filter((entry) => entry.startsWith('word/media/') && !entry.endsWith('/'))
  const relsXml = await zip.file('word/_rels/document.xml.rels')?.async('text')
  const documentXml = await zip.file('word/document.xml')?.async('text')
  const imageRels = Array.from(relsXml?.matchAll(/<Relationship\s+Id="([^"]+)"\s+Type="([^"]*\/image)"\s+Target="([^"]+)"\s*\/?/g) || []).map((match) => ({
    id: match[1],
    type: match[2],
    target: match[3],
    zipPath: match[3].startsWith('word/') ? match[3] : `word/${match[3].replace(/^\.\//, '')}`,
  }))
  const existingTargets = imageRels.filter((rel) => mediaEntries.includes(rel.zipPath))
  const embedIds = Array.from(documentXml?.matchAll(/r:embed="([^"]+)"/g) || []).map((match) => match[1])

  console.log(JSON.stringify({
    filePath,
    imagePath,
    writeResult,
    mediaEntries,
    imageRelationships: imageRels,
    relationshipTargetsExistingInZip: existingTargets,
    documentEmbedIds: embedIds,
    allEmbedIdsResolved: embedIds.every((id) => imageRels.some((rel) => rel.id === id)),
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})