import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { DocumentEngineService, type OoxmlBlockSnapshot } from './documentEngineService'
import type { EmbeddedPayloadBlock, EmbeddedPayloadTableCell, EmbeddedReferenceListItem, EmbeddedFootnoteItem } from '../../../src/engines/documentEngine/embeddedPaperDocument'

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
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
  <w:body>
    <w:p><w:r><w:t>智阅 OOXML Snapshot Seed</w:t></w:r></w:p>
    <w:sectPr/>
  </w:body>
</w:document>`

export interface GeneratedOoxmlSnapshot {
  schemaVersion: 1
  source: 'structured-blocks'
  generatedAt: string
  paragraphCount: number
  blockCount: number
  plainText: string
  html: string
  documentXml: string | null
  contentTypesXml: string | null
}

async function createMinimalDocx(targetPath: string): Promise<void> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', CONTENT_TYPES_XML)
  zip.file('_rels/.rels', ROOT_RELS_XML)
  zip.file('word/document.xml', SOURCE_DOCUMENT_XML)
  zip.file('word/_rels/document.xml.rels', DOCUMENT_RELS_XML)
  const output = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  await fs.writeFile(targetPath, output)
}

function isOoxmlBlockSnapshot(block: OoxmlBlockSnapshot | EmbeddedPayloadBlock): block is OoxmlBlockSnapshot {
  return typeof (block as OoxmlBlockSnapshot)?.kind === 'string'
}

function toReferenceParagraphs(items: EmbeddedReferenceListItem[]): OoxmlBlockSnapshot[] {
  return items.map((item, index) => ({
    index,
    kind: 'paragraph',
    text: `[${item.citationNumber || index + 1}] ${String(item.text || item.title || item.doi || 'Untitled reference').trim()}`.trim(),
  }))
}

function toFootnoteParagraphs(items: EmbeddedFootnoteItem[]): OoxmlBlockSnapshot[] {
  return items.map((item, index) => ({
    index,
    kind: 'paragraph',
    text: `[^${item.id || index + 1}]: ${String(item.text || '').trim()}`.trim(),
  }))
}

function normalizeTableRows(tableRows: EmbeddedPayloadTableCell[][] | undefined): EmbeddedPayloadTableCell[][] | undefined {
  if (!Array.isArray(tableRows) || tableRows.length === 0) return undefined
  return tableRows.map((row) => Array.isArray(row) ? row.map((cell, columnIndex) => ({
    ...cell,
    column: Number.isFinite(cell?.column) ? Number(cell.column) : columnIndex,
  })) : [])
}

function convertEmbeddedBlock(block: EmbeddedPayloadBlock, index: number): OoxmlBlockSnapshot[] {
  switch (block.type) {
    case 'paragraph':
      return [{
        index,
        kind: 'paragraph',
        text: block.text,
        paragraphStyle: block.paragraphStyle,
        alignment: block.alignment,
        indentLevel: block.indentLevel,
        listType: block.listType,
        listLevel: block.listLevel,
      }]
    case 'heading':
      return [{
        index,
        kind: 'heading',
        text: block.text,
        level: block.level,
        paragraphStyle: block.paragraphStyle,
        alignment: block.alignment,
      }]
    case 'image':
      return [{
        index,
        kind: 'image-placeholder',
        text: block.alt || block.title || 'image',
        alt: block.alt,
        title: block.title,
        sourceId: block.sourceId,
        previewSrc: block.previewSrc,
        mediaPath: block.mediaPath,
        mediaContentType: block.mediaContentType,
      }]
    case 'formula':
      return [{
        index,
        kind: 'formula-placeholder',
        text: block.latex,
        latex: block.latex,
        formulaDisplay: block.display,
      }]
    case 'table':
      return [{
        index,
        kind: 'table-placeholder',
        text: block.caption || `表格 ${index + 1}`,
        rows: block.rows,
        columns: block.cols,
        tableRows: normalizeTableRows(block.tableRows),
      }]
    case 'caption':
      return [{
        index,
        kind: 'paragraph',
        text: block.text,
      }]
    case 'reference-list':
      return [
        {
          index,
          kind: 'heading',
          text: block.heading || '参考文献',
          level: 2,
          paragraphStyle: 'Heading2',
        },
        ...toReferenceParagraphs(block.items),
      ]
    case 'footnote-list':
      return [
        {
          index,
          kind: 'heading',
          text: block.heading || '脚注',
          level: 2,
          paragraphStyle: 'Heading2',
        },
        ...toFootnoteParagraphs(block.items),
      ]
    default:
      return []
  }
}

function normalizeSnapshotBlocks(blocks: Array<OoxmlBlockSnapshot | EmbeddedPayloadBlock>): OoxmlBlockSnapshot[] {
  if (blocks.every((block) => isOoxmlBlockSnapshot(block))) {
    return blocks.map((block, index) => ({ ...block, index }))
  }

  return blocks.flatMap((block, index) => isOoxmlBlockSnapshot(block) ? [{ ...block, index }] : convertEmbeddedBlock(block, index))
    .map((block, index) => ({ ...block, index }))
}

export async function buildGeneratedOoxmlSnapshot(blocks: Array<OoxmlBlockSnapshot | EmbeddedPayloadBlock>): Promise<GeneratedOoxmlSnapshot | undefined> {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return undefined
  }

  const service = new DocumentEngineService()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-office-ooxml-snapshot-'))
  const tempFilePath = path.join(tempDir, 'generated-snapshot.docx')

  try {
    await createMinimalDocx(tempFilePath)
    const writeResult = await service.writeOoxmlPackage(tempFilePath, { blocks: normalizeSnapshotBlocks(blocks) })
    if (!writeResult.success) {
      return undefined
    }

    const snapshot = await service.readOoxmlPackage(tempFilePath)
    return {
      schemaVersion: 1,
      source: 'structured-blocks',
      generatedAt: new Date().toISOString(),
      paragraphCount: snapshot.paragraphCount,
      blockCount: snapshot.blockCount,
      plainText: snapshot.plainText,
      html: snapshot.html,
      documentXml: snapshot.documentXml,
      contentTypesXml: snapshot.contentTypesXml,
    }
  } catch {
    return undefined
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}