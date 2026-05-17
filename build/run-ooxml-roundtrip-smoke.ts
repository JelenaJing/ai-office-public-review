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
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`

const SOURCE_DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>测试标题</w:t></w:r>
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
    <w:p>
      <m:oMathPara>
        <m:oMath>
          <m:r><m:t>a+b</m:t></m:r>
        </m:oMath>
      </m:oMathPara>
    </w:p>
    <w:tbl>
      <w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>
      <w:tblGrid>
        <w:gridCol w:w="2400"/>
        <w:gridCol w:w="2400"/>
        <w:gridCol w:w="2400"/>
      </w:tblGrid>
      <w:tr>
        <w:tc>
          <w:tcPr>
            <w:tcW w:w="4800" w:type="dxa"/>
            <w:gridSpan w:val="2"/>
            <w:vMerge w:val="restart"/>
          </w:tcPr>
          <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>合并标题</w:t></w:r></w:p>
          <w:p><w:r><w:t>首段说明</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>
          <w:p><w:r><w:t>右上</w:t></w:r></w:p>
        </w:tc>
      </w:tr>
      <w:tr>
        <w:tc>
          <w:tcPr>
            <w:tcW w:w="4800" w:type="dxa"/>
            <w:gridSpan w:val="2"/>
            <w:vMerge/>
          </w:tcPr>
          <w:p/>
        </w:tc>
        <w:tc>
          <w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>
          <w:p><w:r><w:t>右下</w:t></w:r></w:p>
        </w:tc>
      </w:tr>
    </w:tbl>
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
  await fs.writeFile(targetPath, output)
}

async function readDocumentXml(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath)
  const zip = await JSZip.loadAsync(buffer)
  return await zip.file('word/document.xml')!.async('text')
}

async function readZipEntryText(filePath: string, entryPath: string): Promise<string> {
  const buffer = await fs.readFile(filePath)
  const zip = await JSZip.loadAsync(buffer)
  return await zip.file(entryPath)!.async('text')
}

async function readZipEntryBuffer(filePath: string, entryPath: string): Promise<Buffer> {
  const buffer = await fs.readFile(filePath)
  const zip = await JSZip.loadAsync(buffer)
  return await zip.file(entryPath)!.async('nodebuffer')
}

function extractImageRelationshipIds(relationshipsXml: string): string[] {
  return Array.from(
    String(relationshipsXml || '').matchAll(/<Relationship\s+Id="([^"]+)"\s+Type="[^"]*\/image"\s+Target="([^"]+)"\s*\/?>/g),
  ).map((match) => match[1])
}

function assertUniqueImageRelationships(relationshipsXml: string, message: string): void {
  const imageRelationshipIds = extractImageRelationshipIds(relationshipsXml)
  assert.equal(
    imageRelationshipIds.length,
    new Set(imageRelationshipIds).size,
    message,
  )
}

function replaceFirstTable(html: string, nextTable: string): string {
  return html.replace(/<table\b[\s\S]*?<\/table>/i, nextTable)
}

async function main(): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-writer-ooxml-smoke-'))
  const filePath = path.join(tempDir, 'roundtrip.docx')
  const service = new DocumentEngineService()
  const replacementPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF6sAAAAASUVORK5CYII=', 'base64')
  const replacementPreviewSrc = `data:image/png;base64,${replacementPng.toString('base64')}`

  try {
    await createMinimalDocx(filePath)

    const initial = await service.readOoxmlPackage(filePath)
    const imageBlock = initial.blocks.find((block) => block.kind === 'image-placeholder')
    const formulaBlock = initial.blocks.find((block) => block.kind === 'formula-placeholder')
    const tableBlock = initial.blocks.find((block) => block.kind === 'table-placeholder')

    assert.ok(imageBlock, '应能从源 DOCX 解析出图片 block')
    assert.ok(formulaBlock, '应能从源 DOCX 解析出公式 block')
    assert.ok(tableBlock?.tableRows?.[0]?.[0], '应能从源 DOCX 解析出结构化表格 block')
    assert.equal(imageBlock.previewSrc?.startsWith('data:image/png;base64,'), true)
    assert.equal(imageBlock.mediaPath, 'word/media/image1.png')
    assert.equal(imageBlock.drawingLayout, 'anchor')
    assert.equal(imageBlock.imageWidthPx, 200)
    assert.equal(imageBlock.imageHeightPx, 100)
    assert.equal(imageBlock.anchorHorizontal, 'column')
    assert.equal(imageBlock.anchorVertical, 'paragraph')
    assert.equal(formulaBlock.formulaDisplay, 'block')
    assert.equal(tableBlock.tableRows![0][0].colspan, 2)
    assert.equal(tableBlock.tableRows![0][0].rowspan, 2)
    assert.equal(tableBlock.tableRows![0][0].paragraphs?.[0]?.level, 2)

    const updatedBlocks = initial.blocks.map((block) => {
      if (block.kind === 'image-placeholder') {
        return { ...block, alt: '更新图片说明', title: 'UpdatedImage' }
      }
      if (block.kind === 'formula-placeholder') {
        return { ...block, text: '\\sum_{i=1}^{n} \\hat{x}_i', latex: '\\sum_{i=1}^{n} \\hat{x}_i' }
      }
      if (block.kind === 'table-placeholder') {
        return {
          ...block,
          tableRows: [
            [
              {
                text: '结构标题\n第二段',
                colspan: 2,
                rowspan: 2,
                width: '4800',
                column: 0,
                paragraphs: [
                  { text: '结构标题', level: 2, style: 'Heading2' },
                  { text: '第二段' },
                ],
              },
              {
                text: '右上更新',
                column: 2,
                paragraphs: [{ text: '右上更新' }],
              },
            ],
            [
              {
                text: '右下第一段\n右下第二段',
                column: 2,
                paragraphs: [{ text: '右下第一段' }, { text: '右下第二段' }],
              },
            ],
          ],
          cells: [
            ['结构标题\n第二段', '', '右上更新'],
            ['', '', '右下第一段\n右下第二段'],
          ],
        }
      }
      return block
    })

    const blocksWrite = await service.writeOoxmlPackage(filePath, { blocks: updatedBlocks })
    assert.equal(blocksWrite.success, true, 'blocks 写回应成功')
    const blocksXml = await readDocumentXml(filePath)
    const blocksRelsXml = await readZipEntryText(filePath, 'word/_rels/document.xml.rels')
    assert.match(blocksXml, /descr="更新图片说明"/)
    assert.match(blocksXml, /name="UpdatedImage"/)
    assert.match(blocksXml, /<m:nary>/)
    assert.match(blocksXml, /<m:acc>/)
    assert.match(blocksXml, /<m:sSub>/)
    assert.match(blocksXml, /__AI_WRITER_FORMULA__/)
    assert.match(blocksXml, /<w:gridSpan w:val="2"\/>/)
    assert.match(blocksXml, /<w:vMerge w:val="restart"\/>/)
    assert.match(blocksXml, /<w:vMerge\/>/)
    assert.match(blocksXml, /<w:pStyle w:val="Heading2"\/>/)
    assertUniqueImageRelationships(blocksRelsXml, 'blocks 写回后图片 Relationship 应保持唯一')

    const afterBlocks = await service.readOoxmlPackage(filePath)
    const afterBlocksTable = afterBlocks.blocks.find((block) => block.kind === 'table-placeholder')
    const afterBlocksFormula = afterBlocks.blocks.find((block) => block.kind === 'formula-placeholder')
    assert.equal(afterBlocksTable?.tableRows?.[0]?.[0]?.rowspan, 2)
    assert.equal(afterBlocksTable?.tableRows?.[0]?.[0]?.colspan, 2)
    assert.equal(afterBlocksTable?.tableRows?.[1]?.[0]?.paragraphs?.length, 2)
    assert.equal(afterBlocksFormula?.latex, '\\sum_{i=1}^{n} \\hat{x}_i')

    const htmlPayload = replaceFirstTable(
      afterBlocks.html,
      '<table data-ooxml-object="table" data-rows="2" data-cols="3"><tbody><tr><th colspan="2" rowspan="2" data-width="4800"><h2>HTML 标题</h2><p>HTML 第二段</p></th><td><p>HTML 右上</p></td></tr><tr><td><p>HTML 右下</p><p>HTML 附加段</p></td></tr></tbody></table>',
    )
      .replace(/data-alt="[^"]*"/, 'data-alt="HTML 图片说明"')
      .replace(/data-title="[^"]*"/, 'data-title="HtmlImage"')
      .replace(/data-media-path="[^"]*"/, 'data-media-path="word/media/replaced-image.png"')
      .replace(/data-media-content-type="[^"]*"/, 'data-media-content-type="image/png"')
      .replace(/data-preview-src="[^"]*"/, `data-preview-src="${replacementPreviewSrc}"`)
      .replace(/data-image-width-px="[^"]*"/, 'data-image-width-px="320"')
      .replace(/data-image-height-px="[^"]*"/, 'data-image-height-px="180"')
      .replace(/data-anchor-horizontal="[^"]*"/, 'data-anchor-horizontal="page"')
      .replace(/data-anchor-vertical="[^"]*"/, 'data-anchor-vertical="page"')
      .replace(/data-wrap-type="[^"]*"/, 'data-wrap-type="tight"')
      .replace(/data-latex="[^"]*"/, 'data-latex="\\left(\\begin{aligned}a&=b\\\\c&=d\\end{aligned}\\right)"')

    const htmlWrite = await service.writeOoxmlPackage(filePath, { html: htmlPayload })
    assert.equal(htmlWrite.success, true, 'html 写回应成功')
    const htmlXml = await readDocumentXml(filePath)
    const htmlRelsXml = await readZipEntryText(filePath, 'word/_rels/document.xml.rels')
    const htmlContentTypesXml = await readZipEntryText(filePath, '[Content_Types].xml')
    const replacedImageBuffer = await readZipEntryBuffer(filePath, 'word/media/replaced-image.png')
    assert.match(htmlXml, /descr="HTML 图片说明"/)
    assert.match(htmlXml, /name="HtmlImage"/)
    assert.match(htmlXml, /cx="3048000"/)
    assert.match(htmlXml, /cy="1714500"/)
    assert.match(htmlXml, /<wp:positionH relativeFrom="page">/)
    assert.match(htmlXml, /<wp:positionV relativeFrom="page">/)
    assert.match(htmlXml, /<wp:wrapTight wrapText="bothSides"\/>/)
    assert.match(htmlXml, /<m:d>/)
    assert.match(htmlXml, /<m:eqArr>/)
    assert.match(htmlXml, /HTML 标题/)
    assert.match(htmlXml, /HTML 第二段/)
    assert.match(htmlXml, /HTML 附加段/)
    assert.match(htmlRelsXml, /Target="media\/replaced-image.png"/)
    assertUniqueImageRelationships(htmlRelsXml, 'HTML 写回后图片 Relationship 应保持唯一')
    assert.match(htmlContentTypesXml, /<Default Extension="png" ContentType="image\/png"\/>/)
    assert.deepEqual(replacedImageBuffer, replacementPng)

    const finalSnapshot = await service.readOoxmlPackage(filePath)
    const finalTable = finalSnapshot.blocks.find((block) => block.kind === 'table-placeholder')
    const finalImage = finalSnapshot.blocks.find((block) => block.kind === 'image-placeholder')
    const finalFormula = finalSnapshot.blocks.find((block) => block.kind === 'formula-placeholder')
    assert.equal(finalTable?.tableRows?.[0]?.[0]?.colspan, 2)
    assert.equal(finalTable?.tableRows?.[0]?.[0]?.rowspan, 2)
    assert.equal(finalTable?.tableRows?.[0]?.[0]?.paragraphs?.[0]?.level, 2)
    assert.equal(finalTable?.tableRows?.[0]?.[0]?.paragraphs?.length, 2)
    assert.equal(finalTable?.tableRows?.[1]?.[0]?.paragraphs?.length, 2)
    assert.equal(finalFormula?.latex, '\\left(\\begin{aligned}a&=b\\\\c&=d\\end{aligned}\\right)')
    assert.equal(finalImage?.mediaPath, 'word/media/replaced-image.png')
    assert.equal(finalImage?.imageWidthPx, 320)
    assert.equal(finalImage?.imageHeightPx, 180)
    assert.equal(finalImage?.anchorHorizontal, 'page')
    assert.equal(finalImage?.anchorVertical, 'page')
    assert.equal(finalImage?.wrapType, 'wrapTight')
    assert.equal(finalImage?.previewSrc, replacementPreviewSrc)

    const genericImgHtml = `<p>普通图片回写验证</p><img src="${replacementPreviewSrc}" alt="Generic Html Image" title="GenericHtmlImage" width="48" height="32" />`
    const genericHtmlWrite = await service.writeOoxmlPackage(filePath, { html: genericImgHtml })
    assert.equal(genericHtmlWrite.success, true, '普通 img HTML 写回应成功')
    const genericHtmlXml = await readDocumentXml(filePath)
    const genericHtmlRelsXml = await readZipEntryText(filePath, 'word/_rels/document.xml.rels')
    const genericHtmlContentTypesXml = await readZipEntryText(filePath, '[Content_Types].xml')
    const genericHtmlZip = await JSZip.loadAsync(await fs.readFile(filePath))
    const genericMediaEntryName = Object.keys(genericHtmlZip.files).find((name) => /word\/media\/GenericHtmlImage(?:-\d+(?:-\d+)*)?\.png$/i.test(name))
    assert.ok(genericMediaEntryName, '普通 img 写回后应在 word/media 下生成图片文件')
    const genericMediaBuffer = await genericHtmlZip.file(genericMediaEntryName!)!.async('nodebuffer')
    assert.match(genericHtmlXml, /descr="Generic Html Image"/)
    assert.match(genericHtmlXml, /name="GenericHtmlImage"/)
    assert.match(genericHtmlXml, /cx="457200"/)
    assert.match(genericHtmlXml, /cy="304800"/)
    assert.match(genericHtmlRelsXml, /Target="media\/GenericHtmlImage(?:-\d+(?:-\d+)*)?\.png"/)
    assertUniqueImageRelationships(genericHtmlRelsXml, '普通 img 写回后图片 Relationship 应保持唯一')
    assert.match(genericHtmlContentTypesXml, /<Default Extension="png" ContentType="image\/png"\/>/)
    assert.deepEqual(genericMediaBuffer, replacementPng)

    const normalizedWrite = await service.writeOoxmlPackage(filePath, {
      plainText: '量子点合成方法学：进展、调控策略与未来展望\n\n## 摘要 量子点作为一类重要的半导体纳米晶体，其性能高度依赖于合成方法学。\n\n## 关键词：量子点；合成；光电\n\n# 引言\n\n这是正文第一段，用于验证首行缩进和正文行距。',
    })
    assert.equal(normalizedWrite.success, true, '结构正规化写回应成功')
    const normalizedXml = await readDocumentXml(filePath)
    const stylesXml = await readZipEntryText(filePath, 'word/styles.xml')
    assert.match(normalizedXml, /<w:pStyle w:val="Title"\/>/)
    assert.match(normalizedXml, /<w:pStyle w:val="AbstractHeading"\/>/)
    assert.match(normalizedXml, /<w:pStyle w:val="Abstract"\/>/)
    assert.match(normalizedXml, /<w:pStyle w:val="KeywordsHeading"\/>/)
    assert.match(normalizedXml, /<w:pStyle w:val="Keywords"\/>/)
    assert.match(normalizedXml, /<w:pStyle w:val="Heading1"\/>/)
    assert.match(normalizedXml, /<w:jc w:val="center"\/>/)
    assert.match(normalizedXml, /<w:spacing w:before="160" w:after="80" w:line="360" w:lineRule="auto"\/>/)
    assert.match(normalizedXml, /<w:spacing w:before="0" w:after="120" w:line="360" w:lineRule="auto"\/>/)
    assert.match(normalizedXml, /<w:ind w:firstLine="420"\/>/)
    assert.match(normalizedXml, /量子点合成方法学：进展、调控策略与未来展望/)
    assert.match(normalizedXml, /量子点作为一类重要的半导体纳米晶体/)
    assert.match(normalizedXml, /这是正文第一段，用于验证首行缩进和正文行距。/)
    assert.match(stylesXml, /w:styleId="Title"/)
    assert.match(stylesXml, /w:styleId="AbstractHeading"/)
    assert.match(stylesXml, /w:styleId="Abstract"/)
    assert.match(stylesXml, /w:styleId="KeywordsHeading"/)
    assert.match(stylesXml, /w:styleId="Keywords"/)
    assert.match(stylesXml, /w:styleId="Heading1"/)

    const multilineAbstractWrite = await service.writeOoxmlPackage(filePath, {
      blocks: [
        { index: 0, kind: 'paragraph', text: '多段摘要回归验证标题\n摘要\n这是摘要第一段。\n这是摘要第二段。\n关键词：回归测试、摘要段落' },
        { index: 1, kind: 'paragraph', text: '这是正文首段，用于确认摘要后的正文仍正常写回。' },
      ],
    })
    assert.equal(multilineAbstractWrite.success, true, '多段摘要结构写回应成功')
    const multilineAbstractXml = await readDocumentXml(filePath)
    const abstractParagraphMatches = Array.from(multilineAbstractXml.matchAll(/<w:p>[\s\S]*?<w:pStyle w:val="Abstract"\/>[\s\S]*?<\/w:p>/g))
    assert.equal(abstractParagraphMatches.length, 2, '多行摘要应拆成两个 Abstract 段落')
    assert.equal(abstractParagraphMatches.every((match) => !match[0].includes('<w:br/>')), true, 'Abstract 段落不应再通过 w:br 写回多行内容')
    assert.match(multilineAbstractXml, /这是摘要第一段。/)
    assert.match(multilineAbstractXml, /这是摘要第二段。/)

    const multilineAbstractSnapshot = await service.readOoxmlPackage(filePath)
    const abstractBlocks = multilineAbstractSnapshot.blocks.filter((block) => block.paragraphStyle === 'Abstract')
    assert.equal(abstractBlocks.length, 2, '回读后应保留两个 Abstract block')
    assert.deepEqual(abstractBlocks.map((block) => block.text), ['这是摘要第一段。', '这是摘要第二段。'])

    const templateFormattingWrite = await service.writeOoxmlPackage(filePath, {
      html: '<div data-paper-template="academic-cn"><h1>模板标题</h1><p>模板正文格式验证。</p></div>',
    })
    assert.equal(templateFormattingWrite.success, true, '模板默认格式写回应成功')
    const templateFormattingXml = await readDocumentXml(filePath)
    assert.match(templateFormattingXml, /模板正文格式验证。/)
    assert.match(templateFormattingXml, /<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman"\/>/)
    assert.match(templateFormattingXml, /<w:sz w:val="23"\/>/)
    assert.match(templateFormattingXml, /<w:ind w:firstLine="450"\/>/)
    assert.match(templateFormattingXml, /<w:spacing w:before="120" w:after="120" w:line="456" w:lineRule="auto"\/>/)
    assert.match(templateFormattingXml, /<w:pgMar w:top="600" w:right="900" w:bottom="1200" w:left="900" w:header="720" w:footer="720" w:gutter="0"\/>/)

    const inlineStyleWrite = await service.writeOoxmlPackage(filePath, {
      html: '<div data-paper-template="academic-cn"><p>普通文本 <strong>加粗文本</strong><span style="font-family: SimHei, sans-serif; font-size: 18px;">黑体大字</span><u>下划线文本</u></p></div>',
    })
    assert.equal(inlineStyleWrite.success, true, '混合行内样式写回应成功')
    const inlineStyleXml = await readDocumentXml(filePath)
    assert.match(inlineStyleXml, /加粗文本/)
    assert.match(inlineStyleXml, /<w:b\/>/)
    assert.match(inlineStyleXml, /<w:rFonts w:ascii="SimHei" w:hAnsi="SimHei" w:eastAsia="黑体" w:cs="SimHei"\/>/)
    assert.match(inlineStyleXml, /<w:sz w:val="27"\/>/)
    assert.match(inlineStyleXml, /<w:u w:val="single"\/>/)

    const inlineStyleSnapshot = await service.readOoxmlPackage(filePath)
    assert.match(inlineStyleSnapshot.html, /font-weight: 700/)
    assert.match(inlineStyleSnapshot.html, /font-family: SimHei, 黑体/)
    assert.match(inlineStyleSnapshot.html, /text-decoration: underline/)

    const breakSectionXml = '<w:sectPr><w:type w:val="continuous"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="720" w:right="900" w:bottom="720" w:left="900" w:header="720" w:footer="720" w:gutter="0"/><w:cols w:space="720"/></w:sectPr>'
    const breakWrite = await service.writeOoxmlPackage(filePath, {
      blocks: [
        { index: 0, kind: 'paragraph', text: '分节分页前正文。', pageTemplateId: 'academic-cn' },
        { index: 1, kind: 'page-break', text: '分页符', hasManualPageBreak: true, pageTemplateId: 'academic-cn' },
        { index: 2, kind: 'heading', text: '分页后标题', level: 1, paragraphStyle: 'Heading1', paperStyle: 'break-before: page', pageTemplateId: 'academic-cn' },
        { index: 3, kind: 'section-break', text: '分节符 · 连续', sectionType: 'continuous', sectionPropertiesXml: breakSectionXml, pageTemplateId: 'academic-cn' },
        { index: 4, kind: 'paragraph', text: '分节后正文。', pageTemplateId: 'academic-cn' },
      ],
    })
    assert.equal(breakWrite.success, true, '分页与分节结构写回应成功')
    const breakXml = await readDocumentXml(filePath)
    assert.match(breakXml, /<w:br w:type="page"\/>/)
    assert.match(breakXml, /<w:pageBreakBefore\/>/)
    assert.match(breakXml, /<w:p>[\s\S]*?<w:sectPr>[\s\S]*?<w:type w:val="continuous"\/>[\s\S]*?<w:cols w:space="720"\/>[\s\S]*?<\/w:sectPr>[\s\S]*?<\/w:p>/)

    const breakSnapshot = await service.readOoxmlPackage(filePath)
    const breakPageBlock = breakSnapshot.blocks.find((block) => block.kind === 'page-break')
    const breakSectionBlock = breakSnapshot.blocks.find((block) => block.kind === 'section-break')
    assert.ok(breakPageBlock, '应能回读出分页符 block')
    assert.ok(breakSectionBlock, '应能回读出分节符 block')
    assert.equal(breakSectionBlock?.sectionType, 'continuous')
    assert.match(breakSectionBlock?.sectionPropertiesXml || '', /<w:cols w:space="720"\/>/)
    assert.match(breakSnapshot.html, /data-ooxml-object="page-break"/)
    assert.match(breakSnapshot.html, /data-source-xml=/)
    assert.match(breakSnapshot.html, /data-ooxml-object="section-break"/)

    const breakHtmlRoundtripWrite = await service.writeOoxmlPackage(filePath, { html: breakSnapshot.html })
    assert.equal(breakHtmlRoundtripWrite.success, true, '分页与分节 HTML 回写应成功')
    const breakHtmlRoundtripXml = await readDocumentXml(filePath)
    assert.match(breakHtmlRoundtripXml, /<w:br w:type="page"\/>/)
    assert.match(breakHtmlRoundtripXml, /<w:pageBreakBefore\/>/)
    assert.match(breakHtmlRoundtripXml, /<w:p>[\s\S]*?<w:sectPr>[\s\S]*?<w:type w:val="continuous"\/>[\s\S]*?<w:cols w:space="720"\/>[\s\S]*?<\/w:sectPr>[\s\S]*?<\/w:p>/)

    console.log(
      JSON.stringify(
        {
          ok: true,
          filePath,
          imageSourceId: imageBlock.sourceId,
          formulaSourceId: formulaBlock.sourceId,
          tableShape: finalTable?.tableRows?.map((row) => row.map((cell) => ({
            text: cell.text,
            column: cell.column,
            colspan: cell.colspan,
            rowspan: cell.rowspan,
            paragraphCount: cell.paragraphs?.length || 0,
          }))),
        },
        null,
        2,
      ),
    )
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})