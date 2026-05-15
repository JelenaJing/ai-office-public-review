// journalDocxExporter.ts — 期刊格式 DOCX 导出服务
// 流程：html-docx-js 生成基础 DOCX → JSZip 后处理注入页眉/页脚 OOXML

import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import JSZip from 'jszip'
import type { JournalExportConfig, JournalExportPreset } from '../../../src/utils/journalExportPresets'
import { stripEditorOnlyMarkup, inlineLocalImages } from './pdfExporter'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const htmlDocx = createRequire(import.meta.url)('html-docx-js')

// OOXML namespace URIs
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

// Relationship IDs — use unique-enough values to avoid collision with existing rels
const HDR_REL_ID = 'rId_aiw_hdr1'
const FTR_REL_ID = 'rId_aiw_ftr1'

// ---------------------------------------------------------------------------
// Unit conversion
// ---------------------------------------------------------------------------

function mmToTwip(mm: number): number {
  return Math.round(mm * 56.6929)
}

// ---------------------------------------------------------------------------
// HTML wrapper with journal-specific CSS
// ---------------------------------------------------------------------------

function buildJournalCss(preset: JournalExportPreset): string {
  // pt → px: 1pt = 4/3 px at 96dpi
  const fontPx = preset.fontSizePt * (4 / 3)
  const lh = preset.lineSpacingMultiple
  const { top, right, bottom, left } = preset.margins
  const indent = preset.chineseTextIndent ? 'text-indent: 2em;' : ''

  return `
    body {
      font-family: ${preset.fontFamily};
      font-size: ${fontPx}px;
      line-height: ${lh};
      color: #111;
      margin: ${top}mm ${right}mm ${bottom}mm ${left}mm;
    }
    p {
      margin: 0 0 ${(lh * fontPx * 0.4).toFixed(1)}px;
      text-align: justify;
      ${indent}
    }
    h1 { font-size: ${(fontPx * 1.4).toFixed(1)}px; text-align: center; font-family: ${preset.fontFamily}; margin: 24px 0 16px; }
    h2 { font-size: ${(fontPx * 1.15).toFixed(1)}px; font-family: ${preset.fontFamily}; margin: ${(fontPx * 1.5).toFixed(1)}px 0 8px; }
    h3 { font-size: ${(fontPx * 1.05).toFixed(1)}px; font-family: ${preset.fontFamily}; margin: ${fontPx.toFixed(1)}px 0 6px; }
    h4 { font-size: ${fontPx.toFixed(1)}px; font-family: ${preset.fontFamily}; font-weight: bold; margin: 8px 0 4px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: ${fontPx}px; }
    th, td { border: 1px solid #444; padding: 4px 8px; vertical-align: top; }
    figure { margin: 16px 0; text-align: center; }
    img { max-width: 100%; }
    figcaption { font-size: ${(fontPx * 0.9).toFixed(1)}px; margin-top: 4px; color: #444; }
    blockquote { border-left: 2px solid #888; padding-left: 12px; margin: 8px 24px; color: #333; }
    ul, ol { padding-left: 24px; margin: 8px 0; }
    li { margin: 2px 0; }
    sup, sub { font-size: 0.75em; }
  `
}

function buildJournalBodyHtml(html: string, preset: JournalExportPreset): string {
  const css = buildJournalCss(preset)
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>${css}</style></head><body>${html}</body></html>`
}

// ---------------------------------------------------------------------------
// OOXML builder helpers
// ---------------------------------------------------------------------------

function xmlEscape(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildHeaderXml(config: JournalExportConfig): string {
  const { preset, runningTitle } = config
  const { headerLayout } = preset.headerFooter
  const safeTitle = xmlEscape(runningTitle)

  // Right-aligned tab stop = width of text area in twips
  const textWidthTwip =
    mmToTwip(preset.pageSize.widthMm) -
    mmToTwip(preset.margins.left) -
    mmToTwip(preset.margins.right)

  let inner: string

  if (headerLayout === 'none') {
    inner = `<w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr><w:r><w:t></w:t></w:r></w:p>`
  } else if (headerLayout === 'center-title') {
    inner = `<w:p>
  <w:pPr><w:pStyle w:val="Header"/><w:jc w:val="center"/></w:pPr>
  <w:r><w:t>${safeTitle}</w:t></w:r>
</w:p>`
  } else {
    // left-title-right-pagenum
    inner = `<w:p>
  <w:pPr>
    <w:pStyle w:val="Header"/>
    <w:tabs><w:tab w:val="right" w:pos="${textWidthTwip}"/></w:tabs>
  </w:pPr>
  <w:r><w:t xml:space="preserve">${safeTitle}</w:t></w:r>
  <w:r><w:tab/></w:r>
  <w:r><w:fldChar w:fldCharType="begin"/></w:r>
  <w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>
  <w:r><w:fldChar w:fldCharType="end"/></w:r>
</w:p>`
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="${W_NS}" xmlns:r="${R_NS}">
${inner}
</w:hdr>`
}

function buildFooterXml(config: JournalExportConfig): string {
  const { footerLayout } = config.preset.headerFooter

  if (footerLayout === 'none') {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="${W_NS}" xmlns:r="${R_NS}">
  <w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr><w:r><w:t></w:t></w:r></w:p>
</w:ftr>`
  }

  const jc = footerLayout === 'right-pagenum' ? 'right' : 'center'
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="${W_NS}" xmlns:r="${R_NS}">
  <w:p>
    <w:pPr><w:pStyle w:val="Footer"/><w:jc w:val="${jc}"/></w:pPr>
    <w:r><w:fldChar w:fldCharType="begin"/></w:r>
    <w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>
    <w:r><w:fldChar w:fldCharType="end"/></w:r>
  </w:p>
</w:ftr>`
}

function buildSectPrXml(
  preset: JournalExportPreset,
  hasHeader: boolean,
  hasFooter: boolean,
): string {
  const pgW = mmToTwip(preset.pageSize.widthMm)
  const pgH = mmToTwip(preset.pageSize.heightMm)
  const mTop = mmToTwip(preset.margins.top)
  const mRight = mmToTwip(preset.margins.right)
  const mBottom = mmToTwip(preset.margins.bottom)
  const mLeft = mmToTwip(preset.margins.left)

  const hdrRef = hasHeader
    ? `<w:headerReference w:type="default" r:id="${HDR_REL_ID}"/>`
    : ''
  const ftrRef = hasFooter
    ? `<w:footerReference w:type="default" r:id="${FTR_REL_ID}"/>`
    : ''
  const titlePg = preset.headerFooter.differentFirstPage ? '<w:titlePg/>' : ''

  return `<w:sectPr xmlns:r="${R_NS}">
    ${hdrRef}
    ${ftrRef}
    ${titlePg}
    <w:pgSz w:w="${pgW}" w:h="${pgH}"/>
    <w:pgMar w:top="${mTop}" w:right="${mRight}" w:bottom="${mBottom}" w:left="${mLeft}" w:header="708" w:footer="708" w:gutter="0"/>
  </w:sectPr>`
}

// ---------------------------------------------------------------------------
// JSZip post-processing
// ---------------------------------------------------------------------------

async function patchDocxBuffer(
  buffer: Buffer,
  config: JournalExportConfig,
): Promise<Buffer> {
  const preset = config.preset
  const hasHeader = preset.headerFooter.headerLayout !== 'none'
  const hasFooter = preset.headerFooter.footerLayout !== 'none'

  const zip = await JSZip.loadAsync(buffer)

  // 1. Inject header/footer XML files
  zip.file('word/header1.xml', buildHeaderXml(config))
  zip.file('word/footer1.xml', buildFooterXml(config))

  // 2. Patch word/document.xml — replace/inject sectPr
  const docEntry = zip.file('word/document.xml')
  if (docEntry) {
    let docXml = await docEntry.async('string')
    const newSectPr = buildSectPrXml(preset, hasHeader, hasFooter)
    if (/<w:sectPr[\s>]/i.test(docXml)) {
      // Replace existing sectPr (handles attributes on the opening tag too)
      docXml = docXml.replace(/<w:sectPr[\s\S]*?<\/w:sectPr>/i, newSectPr)
    } else {
      // Append before </w:body>
      docXml = docXml.replace(/<\/w:body>/i, `${newSectPr}</w:body>`)
    }
    zip.file('word/document.xml', docXml)
  }

  // 3. Patch word/_rels/document.xml.rels — add header/footer relationships
  const relsEntry = zip.file('word/_rels/document.xml.rels')
  if (relsEntry) {
    let relsXml = await relsEntry.async('string')
    const hdrRel = `<Relationship Id="${HDR_REL_ID}" Type="${R_NS}/header" Target="header1.xml"/>`
    const ftrRel = `<Relationship Id="${FTR_REL_ID}" Type="${R_NS}/footer" Target="footer1.xml"/>`
    relsXml = relsXml.replace('</Relationships>', `${hdrRel}${ftrRel}</Relationships>`)
    zip.file('word/_rels/document.xml.rels', relsXml)
  }

  // 4. Patch [Content_Types].xml — register header/footer parts
  const ctEntry = zip.file('[Content_Types].xml')
  if (ctEntry) {
    let ctXml = await ctEntry.async('string')
    const hdrCt = `<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>`
    const ftrCt = `<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>`
    ctXml = ctXml.replace('</Types>', `${hdrCt}${ftrCt}</Types>`)
    zip.file('[Content_Types].xml', ctXml)
  }

  return zip.generateAsync({ type: 'nodebuffer' }) as Promise<Buffer>
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function exportWithJournalFormat(
  html: string,
  filePath: string,
  config: JournalExportConfig,
): Promise<void> {
  // Clean editor-specific markup and inline local images
  const cleaned = stripEditorOnlyMarkup(html)
  const withImages = await inlineLocalImages(cleaned)

  // Wrap with journal CSS
  const bodyHtml = buildJournalBodyHtml(withImages, config.preset)

  // Generate base DOCX via html-docx-js
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  const blob: Blob = htmlDocx.asBlob(bodyHtml) as Blob
  const arrayBuffer = await blob.arrayBuffer()
  const baseBuffer = Buffer.from(arrayBuffer)

  // Inject OOXML header/footer via JSZip post-processing
  const finalBuffer = await patchDocxBuffer(baseBuffer, config)

  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, finalBuffer)
}
