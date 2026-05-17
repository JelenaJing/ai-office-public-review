import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { DocumentEngineService } from '../electron/main/services/documentEngineService'

const REAL_SAMPLE_DOCX = path.resolve('docs/local-test-assets/01_新能源项目季度进展汇报.docx')

const MIXED_FIELD_DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>真实样本混合引用回归</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t xml:space="preserve">复杂域引用 </w:t></w:r>
      <w:r><w:fldChar w:fldCharType="begin"/></w:r>
      <w:r><w:instrText xml:space="preserve"> CITATION USERSRC_ONE \\* MERGEFORMAT </w:instrText></w:r>
      <w:r><w:fldChar w:fldCharType="separate"/></w:r>
      <w:r><w:t>[1]</w:t></w:r>
      <w:r><w:fldChar w:fldCharType="end"/></w:r>
      <w:r><w:t xml:space="preserve"> 与正文保留。</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t xml:space="preserve">简单域引用 </w:t></w:r>
      <w:fldSimple w:instr=" CITATION USERSRC_TWO \\m USERSRC_THREE \\* MERGEFORMAT ">
        <w:r><w:t>[2, 3]</w:t></w:r>
      </w:fldSimple>
      <w:r><w:t xml:space="preserve"> 继续。</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="ReferencesHeading"/></w:pPr>
      <w:r><w:t>参考文献</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Reference"/></w:pPr>
      <w:r><w:t>[1] Zhang, S. (2024). Native bibliography one.</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Reference"/></w:pPr>
      <w:r><w:t>[2] Li, Q. (2023). Native bibliography two.</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Reference"/></w:pPr>
      <w:r><w:t>[3] Wang, X. (2022). Native bibliography three.</w:t></w:r>
    </w:p>
    <w:sectPr/>
  </w:body>
</w:document>`

const AUTHOR_YEAR_FIELD_DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>Word 作者年份显示回读归一化</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t xml:space="preserve">复杂域引用 </w:t></w:r>
      <w:r><w:fldChar w:fldCharType="begin"/></w:r>
      <w:r><w:instrText xml:space="preserve"> CITATION USERSRC_ONE \\* MERGEFORMAT </w:instrText></w:r>
      <w:r><w:fldChar w:fldCharType="separate"/></w:r>
      <w:r><w:t>(Zhang, 2024)</w:t></w:r>
      <w:r><w:fldChar w:fldCharType="end"/></w:r>
      <w:r><w:t xml:space="preserve"> 与正文保留。</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t xml:space="preserve">简单域引用 </w:t></w:r>
      <w:fldSimple w:instr=" CITATION USERSRC_TWO \\m USERSRC_THREE \\* MERGEFORMAT ">
        <w:r><w:t>(Li, 2023; Wang, 2022)</w:t></w:r>
      </w:fldSimple>
      <w:r><w:t xml:space="preserve"> 继续。</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="ReferencesHeading"/></w:pPr>
      <w:r><w:t>参考文献</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Reference"/></w:pPr>
      <w:r><w:t>[1] Zhang, S. (2024). Native bibliography one.</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Reference"/></w:pPr>
      <w:r><w:t>[2] Li, Q. (2023). Native bibliography two.</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Reference"/></w:pPr>
      <w:r><w:t>[3] Wang, X. (2022). Native bibliography three.</w:t></w:r>
    </w:p>
    <w:sectPr/>
  </w:body>
</w:document>`

const BIBLIOGRAPHY_SOURCES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<b:Sources xmlns:b="http://schemas.openxmlformats.org/officeDocument/2006/bibliography" SelectedStyle="/IEEE2006.XSL" StyleName="IEEE">
  <b:Source><b:Tag>USERSRC_ONE</b:Tag><b:SourceType>Misc</b:SourceType><b:Guid>{11111111-1111-1111-1111-111111111111}</b:Guid><b:Title>Native bibliography one</b:Title><b:Comments>Zhang, S. (2024). Native bibliography one.</b:Comments><b:Year>2024</b:Year></b:Source>
  <b:Source><b:Tag>USERSRC_TWO</b:Tag><b:SourceType>Misc</b:SourceType><b:Guid>{22222222-2222-2222-2222-222222222222}</b:Guid><b:Title>Native bibliography two</b:Title><b:Comments>Li, Q. (2023). Native bibliography two.</b:Comments><b:Year>2023</b:Year></b:Source>
  <b:Source><b:Tag>USERSRC_THREE</b:Tag><b:SourceType>Misc</b:SourceType><b:Guid>{33333333-3333-3333-3333-333333333333}</b:Guid><b:Title>Native bibliography three</b:Title><b:Comments>Wang, X. (2022). Native bibliography three.</b:Comments><b:Year>2022</b:Year></b:Source>
</b:Sources>`

const BIBLIOGRAPHY_ITEM_PROPS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<ds:datastoreItem ds:itemID="{44444444-4444-4444-4444-444444444444}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs><ds:schemaRef ds:uri="http://schemas.openxmlformats.org/officeDocument/2006/bibliography"/></ds:schemaRefs></ds:datastoreItem>`

const BIBLIOGRAPHY_ITEM_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="itemProps1.xml"/></Relationships>`

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function ensureRelationship(xml: string, id: string, type: string, target: string): string {
  const relationshipXml = `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`
  if (new RegExp(`Id="${escapeRegExp(id)}"`, 'i').test(xml)) {
    return xml.replace(new RegExp(`<Relationship\\b[^>]*Id="${escapeRegExp(id)}"[^>]*\\/?>`, 'i'), relationshipXml)
  }
  return xml.replace(/<\/Relationships>\s*$/i, `${relationshipXml}</Relationships>`)
}

function ensureItemPropsContentType(xml: string): string {
  if (/PartName="\/customXml\/itemProps1\.xml"/i.test(xml)) return xml
  return xml.replace(/<\/Types>\s*$/i, '<Override PartName="/customXml/itemProps1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/></Types>')
}

async function readZipEntryText(filePath: string, entryPath: string): Promise<string> {
  const zip = await JSZip.loadAsync(await fs.readFile(filePath))
  return await zip.file(entryPath)!.async('text')
}

async function prepareFieldSample(sourcePath: string, targetPath: string, documentXml: string): Promise<void> {
  const sourceBuffer = await fs.readFile(sourcePath)
  const zip = await JSZip.loadAsync(sourceBuffer)
  const rootRelsXml = await zip.file('_rels/.rels')!.async('text')
  const contentTypesXml = await zip.file('[Content_Types].xml')!.async('text')

  zip.file('word/document.xml', documentXml)
  zip.file('_rels/.rels', ensureRelationship(rootRelsXml, 'rIdBibliographySample', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml', 'customXml/item1.xml'))
  zip.file('[Content_Types].xml', ensureItemPropsContentType(contentTypesXml))
  zip.file('customXml/item1.xml', BIBLIOGRAPHY_SOURCES_XML)
  zip.file('customXml/itemProps1.xml', BIBLIOGRAPHY_ITEM_PROPS_XML)
  zip.file('customXml/_rels/item1.xml.rels', BIBLIOGRAPHY_ITEM_RELS_XML)

  const output = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  await fs.writeFile(targetPath, output)
}

async function main(): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-writer-word-bibliography-smoke-'))
  const baselineFile = path.join(tempDir, 'real-user-mixed-field.docx')
  const editedFile = path.join(tempDir, 'real-user-mixed-field-edited.docx')
  const authorYearFile = path.join(tempDir, 'real-user-author-year-field.docx')
  const service = new DocumentEngineService()

  try {
    await prepareFieldSample(REAL_SAMPLE_DOCX, baselineFile, MIXED_FIELD_DOCUMENT_XML)

    const baseline = await service.readOoxmlPackage(baselineFile)
    assert.equal(baseline.exists, true, '真实样本基线应可读取')
    assert.equal(baseline.bibliographySources.length, 3, '应能读取 customXml bibliography sources')

    const complexBlock = baseline.blocks.find((block) => block.kind === 'paragraph' && block.text.includes('复杂域引用'))
    const simpleBlock = baseline.blocks.find((block) => block.kind === 'paragraph' && block.text.includes('简单域引用'))
    assert.deepEqual(complexBlock?.citationSourceTags, ['USERSRC_ONE'], '复杂 field code 应提取原生 source tag')
    assert.deepEqual(simpleBlock?.citationSourceTags, ['USERSRC_TWO', 'USERSRC_THREE'], 'fldSimple 应提取多 source tag')

    const unchangedWrite = await service.writeOoxmlPackage(baselineFile, { blocks: baseline.blocks })
    assert.equal(unchangedWrite.success, true, '未改动 mixed field 样本写回应成功')
    const unchangedDocumentXml = await readZipEntryText(baselineFile, 'word/document.xml')
    assert.equal(unchangedDocumentXml.includes('<w:instrText xml:space="preserve"> CITATION USERSRC_ONE \\* MERGEFORMAT </w:instrText>'), true, '复杂 field code 段落应原样保留')
    assert.equal(unchangedDocumentXml.includes('<w:fldSimple w:instr=" CITATION USERSRC_TWO \\m USERSRC_THREE \\* MERGEFORMAT ">'), true, '原始 fldSimple 多引用段落应原样保留')

    const editedBlocks = baseline.blocks.map((block) => {
      if (block.kind === 'paragraph' && block.text.includes('简单域引用')) {
        return {
          ...block,
          text: '简单域引用 [1-3] 继续。',
        }
      }
      return block
    })

    await fs.copyFile(baselineFile, editedFile)
    const editedWrite = await service.writeOoxmlPackage(editedFile, { blocks: editedBlocks })
    assert.equal(editedWrite.success, true, '改动后的 mixed field 样本写回应成功')

    const editedSnapshot = await service.readOoxmlPackage(editedFile)
    assert.equal(editedSnapshot.bibliographySources.length, 3, '改动后应重建并保留 bibliography sources')
    const rebuiltTags = editedSnapshot.bibliographySources.map((source) => source.tag)
    assert.equal(rebuiltTags.length, 3)

    const editedDocumentXml = await readZipEntryText(editedFile, 'word/document.xml')
    assert.equal(editedDocumentXml.includes('<w:instrText xml:space="preserve"> CITATION USERSRC_ONE \\* MERGEFORMAT </w:instrText>'), true, '未改动的复杂 field code 段落仍应保留')
    assert.equal(
      editedDocumentXml.includes(`<w:fldSimple w:instr=" CITATION ${rebuiltTags[0]} \\m ${rebuiltTags[1]} \\m ${rebuiltTags[2]} \\* MERGEFORMAT ">`),
      true,
      '改动后的正文分组引用应写成基于 bibliography source tags 的原生 Word CITATION 域',
    )

    const editedBibliographyXml = await readZipEntryText(editedFile, 'customXml/item1.xml')
    rebuiltTags.forEach((tag) => {
      assert.match(editedBibliographyXml, new RegExp(`<b:Tag>${escapeRegExp(tag)}<\/b:Tag>`, 'i'))
    })

    await prepareFieldSample(REAL_SAMPLE_DOCX, authorYearFile, AUTHOR_YEAR_FIELD_DOCUMENT_XML)

    const authorYearSnapshot = await service.readOoxmlPackage(authorYearFile)
    const authorYearComplexBlock = authorYearSnapshot.blocks.find((block) => block.kind === 'paragraph' && block.text.includes('复杂域引用'))
    const authorYearSimpleBlock = authorYearSnapshot.blocks.find((block) => block.kind === 'paragraph' && block.text.includes('简单域引用'))
    assert.equal(authorYearComplexBlock?.text, '复杂域引用 [1] 与正文保留。', '复杂 Word 域显示为作者年份时，读回编辑器应恢复成数值引用')
    assert.equal(authorYearSimpleBlock?.text, '简单域引用 [2, 3] 继续。', 'fldSimple 显示为作者年份时，读回编辑器应恢复成分组数值引用')
    assert.deepEqual(authorYearComplexBlock?.citationSourceTags, ['USERSRC_ONE'])
    assert.deepEqual(authorYearSimpleBlock?.citationSourceTags, ['USERSRC_TWO', 'USERSRC_THREE'])

    const authorYearWrite = await service.writeOoxmlPackage(authorYearFile, { blocks: authorYearSnapshot.blocks })
    assert.equal(authorYearWrite.success, true, '作者年份显示样本写回应成功')

    const authorYearRoundtrip = await service.readOoxmlPackage(authorYearFile)
    assert.match(authorYearRoundtrip.documentXml || '', /w:fldSimple/i)
    assert.equal(
      authorYearRoundtrip.blocks.some((block) => block.kind === 'paragraph' && block.text === '复杂域引用 [1] 与正文保留。'),
      true,
      'Word 往返后复杂域仍应保持编辑器可识别的数值引用文本',
    )
    assert.equal(
      authorYearRoundtrip.blocks.some((block) => block.kind === 'paragraph' && block.text === '简单域引用 [2, 3] 继续。'),
      true,
      'Word 往返后简单域仍应保持编辑器可识别的分组数值引用文本',
    )

    console.log('word bibliography smoke passed')
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

void main()