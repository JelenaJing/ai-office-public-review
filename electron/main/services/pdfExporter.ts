import { BrowserWindow, dialog } from 'electron'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { marked } from 'marked'
import katex from 'katex'
// html-docx-js has no maintained TS types; use it as an untyped helper.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const htmlDocx = require('html-docx-js')

const _require = createRequire(import.meta.url)

async function loadKatexCss(): Promise<string> {
  try {
    const pkgJsonPath = _require.resolve('katex/package.json')
    const cssPath = path.join(path.dirname(pkgJsonPath), 'dist', 'katex.min.css')
    return await fs.readFile(cssPath, 'utf-8')
  } catch {
    return ''
  }
}

function renderFormulaForPdf(latex: string, displayMode: boolean): string {
  const value = String(latex || '').trim()
  if (!value) return ''
  try {
    const html = katex.renderToString(value, {
      throwOnError: false,
      strict: 'ignore',
      displayMode,
      output: 'html',
    })
    return displayMode
      ? `<div style="margin:12px 0;text-align:center;overflow-x:auto;">${html}</div>`
      : html
  } catch {
    const escaped = escapeHtml(value)
    return displayMode
      ? `<div style="margin:12px 0;text-align:center;font-family:'Cambria Math','Times New Roman',serif;">${escaped}</div>`
      : `<span style="font-family:'Cambria Math','Times New Roman',serif;">${escaped}</span>`
  }
}

function replaceFormulasForPdf(html: string): string {
  return html.replace(
    /<(div|span)(\s[^>]*)>([\s\S]*?)<\/\1>/gi,
    (match, tag, attrs) => {
      if (!/\bdata-formula-node="true"/i.test(attrs) && !/\bdata-ooxml-object="formula"/i.test(attrs)) {
        return match
      }
      const latexMatch = attrs.match(/\bdata-latex="([^"]*)"/i)
      if (!latexMatch) return match
      const isBlock = String(tag || '').toLowerCase() === 'div'
      const latex = decodeHtmlAttribute(latexMatch[1])
      return renderFormulaForPdf(latex, isBlock)
    },
  )
}

marked.setOptions({ gfm: true, breaks: false })

function looksLikeHtml(content: string): boolean {
  const trimmed = String(content || '').trim()
  return /<(?:h[1-6]|p|div|span|strong|em|u|s|ul|ol|li|table|thead|tbody|tr|td|th|blockquote|img|figure|figcaption|hr|br)\b/i.test(trimmed)
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function markdownToHtml(markdown: string): string {
  if (looksLikeHtml(markdown)) return markdown
  return marked.parse(markdown || '') as string
}

function wrapBodyHtml(content: string): string {
  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: "Times New Roman", serif; padding: 40px; color: #111; line-height: 1.7; }
          h1, h2, h3 { break-after: avoid; }
          h1 { font-size: 28px; margin-bottom: 18px; }
          h2 { font-size: 20px; margin-top: 24px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
          h3 { font-size: 16px; margin-top: 18px; }
          p, blockquote, li { font-size: 13px; margin: 8px 0; white-space: pre-wrap; }
          ul, ol { padding-left: 24px; margin: 10px 0; }
          table { width: 100%; border-collapse: collapse; margin: 16px 0; }
          th, td { border: 1px solid #bbb; padding: 6px 8px; vertical-align: top; }
          figure { margin: 16px 0; }
          img { max-width: 100%; }
          figcaption { font-size: 12px; color: #555; margin-top: 6px; }
          .reference { font-size: 12px; }
          blockquote { border-left: 3px solid #888; padding-left: 12px; color: #444; }
          .spacer { height: 10px; }
          [data-paper-template] { display: block; }
          [data-paper-template="academic-cn"] { font-family: "Source Serif 4", "Noto Serif SC", "SimSun", serif; font-size: 15px; line-height: 1.9; }
          [data-paper-template="academic-cn"] p { text-indent: 2em; margin: 8px 0; line-height: 1.9; }
          [data-paper-template="academic-cn"] h1, [data-paper-template="academic-cn"] h2 { text-align: center; }
          [data-paper-template="academic-cn"] .references-list { padding-left: 0; list-style-position: inside; }
          [data-paper-template="academic-cn"] .references-list li { margin: 10px 0; padding-left: 2.2em; text-indent: -2.2em; }
          [data-paper-template="academic-en"] { font-family: "Times New Roman", "Georgia", serif; font-size: 14px; line-height: 1.8; }
          [data-paper-template="academic-en"] p { text-indent: 0; margin: 0 0 12pt; line-height: 1.8; text-align: justify; }
          [data-paper-template="academic-en"] h1, [data-paper-template="academic-en"] h2 { text-align: center; }
          [data-paper-template="academic-en"] h1:first-of-type { margin-top: 120pt; margin-bottom: 48pt; font-size: 22pt; letter-spacing: 0.02em; }
          [data-paper-template="academic-en"] h1:first-of-type + h2 { page-break-before: always; margin-top: 0; }
          [data-paper-template="academic-en"] h2 { margin-top: 18pt; margin-bottom: 12pt; }
          [data-paper-template="academic-en"] h3 { margin-top: 14pt; margin-bottom: 8pt; }
          [data-paper-template="academic-en"] .references-list { padding-left: 0; margin: 12pt 0 0; list-style-position: inside; }
          [data-paper-template="academic-en"] .references-list li { margin: 0 0 10pt; padding-left: 2.4em; text-indent: -2.4em; line-height: 1.7; }
          [data-paper-template="thesis"] { font-family: "Times New Roman", "Noto Serif SC", serif; font-size: 15px; line-height: 2; }
          [data-paper-template="thesis"] p { text-indent: 2em; margin: 10px 0; line-height: 2; }
          [data-paper-template="thesis"] h1, [data-paper-template="thesis"] h2 { text-align: center; }
          [data-paper-template="thesis"] .references-list { padding-left: 0; list-style-position: inside; }
          [data-paper-template="thesis"] .references-list li { margin: 10px 0; padding-left: 2.2em; text-indent: -2.2em; }
          [data-paper-template="compact"] { font-family: "Source Serif 4", "Noto Serif SC", serif; font-size: 14px; line-height: 1.6; }
          [data-paper-template="compact"] p { text-indent: 0; margin: 6px 0; line-height: 1.6; }
          [data-paper-template="compact"] h1, [data-paper-template="compact"] h2 { text-align: left; }
          [data-paper-template="compact"] .references-list { padding-left: 0; list-style-position: inside; }
          [data-paper-template="compact"] .references-list li { margin: 8px 0; padding-left: 2em; text-indent: -2em; }
        </style>
      </head>
      <body>
        ${content}
      </body>
    </html>
  `
}

export async function exportPdf(markdown: string, title: string): Promise<string | null> {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: '导出 PDF',
    defaultPath: `${title || '智阅-文档'}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })

  if (canceled || !filePath) {
    return null
  }

  const browser = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
    },
  })

  const html = wrapBodyHtml(markdownToHtml(markdown))

  await browser.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  const pdf = await browser.webContents.printToPDF({
    printBackground: true,
    pageSize: 'A4',
    margins: {
      marginType: 'default',
    },
  })
  await browser.close()

  await fs.writeFile(filePath, pdf)
  return filePath
}

function buildDocumentHtml(markdown: string): string {
  return wrapBodyHtml(markdownToHtml(markdown))
}

function decodeHtmlAttribute(value: string): string {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function escapeAttribute(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function stripEditorOnlyMarkup(html: string): string {
  let output = String(html || '')
  output = output.replace(/\sdata-node-view-wrapper="[^"]*"/gi, '')
  output = output.replace(/\scontenteditable="[^"]*"/gi, '')
  output = output.replace(/\sclass="(?:ProseMirror[^"\\]*?)"/gi, '')
  if (typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(`<div data-aiw-export-root="true">${output}</div>`, 'text/html')
      const root = doc.querySelector('[data-aiw-export-root="true"]')
      if (root) {
        const formulaNodes = Array.from(root.querySelectorAll('[data-formula-node="true"], [data-ooxml-object="formula"]'))
        for (const node of formulaNodes) {
          const element = node as HTMLElement
          const display = String(element.getAttribute('data-formula-display') || '').toLowerCase() === 'block'
            || element.tagName.toLowerCase() === 'div'
            ? 'block'
            : 'inline'
          const rawLatex = String(element.getAttribute('data-latex') || '').trim()
          const latex = decodeHtmlAttribute(rawLatex)
          const replacementHtml = display === 'block'
            ? `<div style="margin:12px 0;text-align:center;">${renderFormulaForWord(latex, true)}</div>`
            : renderFormulaForWord(latex, false)
          const holder = doc.createElement('div')
          holder.innerHTML = replacementHtml
          const replacement = display === 'block'
            ? holder.firstElementChild
            : holder.firstChild
          if (!replacement) {
            element.remove()
            continue
          }
          element.replaceWith(replacement)
        }
        output = root.innerHTML
      }
    } catch {
      // Keep regex fallback for environments where DOM parsing fails.
    }
  }
  // Order-independent replacement: TipTap serializes data-latex BEFORE data-formula-node,
  // so the previous attribute-ordered regexes never matched. This single regex matches any
  // <div>/<span> that carries a formula attribute, then extracts data-latex by name.
  output = output.replace(
    /<(div|span)(\s[^>]*)>([\s\S]*?)<\/\1>/gi,
    (match, tag, attrs) => {
      if (!/\bdata-formula-node="true"/i.test(attrs) && !/\bdata-ooxml-object="formula"/i.test(attrs)) {
        return match
      }
      const latexMatch = attrs.match(/\bdata-latex="([^"]*)"/i)
      if (!latexMatch) return match
      const isBlock = String(tag || '').toLowerCase() === 'div'
      const latex = decodeHtmlAttribute(latexMatch[1])
      const rendered = renderFormulaForWord(latex, isBlock)
      return isBlock
        ? `<div style="margin:12px 0;text-align:center;">${rendered}</div>`
        : rendered
    },
  )

  return output
}

function renderFormulaForWord(latex: string, displayMode: boolean): string {
  const value = String(latex || '').trim()
  if (!value) return ''
  try {
    return katex.renderToString(value, {
      throwOnError: false,
      strict: 'ignore',
      displayMode,
      output: 'mathml',
    })
  } catch {
    const escaped = escapeHtml(value)
    return displayMode
      ? `<p style="text-align:center;font-family:'Cambria Math','Times New Roman',serif;">${escaped}</p>`
      : `<span style="font-family:'Cambria Math','Times New Roman',serif;">${escaped}</span>`
  }
}

export async function inlineLocalImages(html: string): Promise<string> {
  const matches = Array.from(String(html || '').matchAll(/<img\b([^>]*?)\ssrc="([^"]+)"([^>]*?)>/gi))
  if (matches.length === 0) return html

  let output = String(html || '')
  for (const match of matches) {
    const originalTag = match[0]
    const src = String(match[2] || '').trim()
    if (!src || /^data:/i.test(src) || /^https?:/i.test(src)) continue

    const resolvedPath = src.startsWith('file://')
      ? decodeURI(src.replace(/^file:\/\//i, ''))
      : src
    const absolutePath = path.isAbsolute(resolvedPath) ? resolvedPath : ''
    if (!absolutePath) continue

    try {
      const binary = await fs.readFile(absolutePath)
      const ext = path.extname(absolutePath).slice(1).toLowerCase() || 'png'
      const mime = ext === 'jpg' || ext === 'jpeg'
        ? 'image/jpeg'
        : ext === 'gif'
          ? 'image/gif'
          : ext === 'svg'
            ? 'image/svg+xml'
            : ext === 'webp'
              ? 'image/webp'
              : 'image/png'
      const dataUri = `data:${mime};base64,${binary.toString('base64')}`
      output = output.replace(originalTag, originalTag.replace(src, dataUri))
    } catch {
      continue
    }
  }

  return output
}

async function buildDocxDocumentHtml(markdown: string): Promise<string> {
  const html = buildDocumentHtml(markdown)
  const stripped = stripEditorOnlyMarkup(html)
  return inlineLocalImages(stripped)
}

export function getDocxSidecarPath(filePath: string): string {
  return `${filePath}.aiwriter.html`
}

export async function exportDocxToPath(markdown: string, filePath: string): Promise<string> {
  const html = await buildDocxDocumentHtml(markdown)
  const docxBuffer = htmlDocx.asBlob(html)
  const arrayBuffer = await docxBuffer.arrayBuffer()
  await fs.writeFile(filePath, Buffer.from(arrayBuffer))
  await fs.rm(getDocxSidecarPath(filePath), { force: true })
  return filePath
}

export type EditorExportStyles = {
  templateId: string
  fontFamily: string
  fontSize: string
  fontSizePx: number
  lineHeight: string
  textIndent: string
  paragraphSpacing: string
  headingAlign: string
  pagePadding: string
}

function buildEditorPdfCss(styles: EditorExportStyles): string {
  const { fontFamily, fontSize, fontSizePx, lineHeight, textIndent, paragraphSpacing, headingAlign, pagePadding, templateId } = styles
  return `
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 0; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page-wrapper { width: 794px; margin: 0 auto; background: #fff; padding: ${pagePadding}; }
    .tiptap { font-family: ${fontFamily}; font-size: ${fontSize}; line-height: ${lineHeight}; color: #222; letter-spacing: .02em; }
    .tiptap h1 { font-size: 22pt; font-weight: 700; margin: 36px 0 20px; text-align: center; letter-spacing: .04em; }
    .tiptap h2 { font-size: 16pt; font-weight: 700; margin: 24px 0 12px; padding-bottom: 6px; border-bottom: 1px solid #eee; text-align: ${headingAlign}; }
    .tiptap h3 { font-size: 14pt; font-weight: 600; margin: 18px 0 8px; }
    .tiptap h4 { font-size: 12pt; font-weight: 600; margin: 14px 0 6px; }
    .tiptap p { margin: ${paragraphSpacing} 0; text-align: justify; text-indent: ${textIndent}; line-height: ${lineHeight}; }
    .tiptap [data-semantic-role="paper-title"] { margin-top: ${templateId === 'academic-en' ? '72px' : '48px'}; margin-bottom: 12px; font-size: 22pt; line-height: 1.4; text-align: center; }
    .tiptap [data-semantic-role="abstract-heading"] { margin-top: 28px; border-bottom: none; font-size: 14pt; font-weight: 700; color: #333; text-align: center; }
    .tiptap [data-semantic-role="abstract-body"] { text-indent: 0; font-size: ${Math.max(10, fontSizePx - 1)}px; color: #444; line-height: 1.75; margin-bottom: 4px; }
    .tiptap [data-semantic-role="keywords-heading"] { border-bottom: none; font-size: 12pt; font-weight: 700; color: #333; text-align: left; margin-top: 12px; margin-bottom: 8px; }
    .tiptap [data-semantic-role="keywords-body"] { text-indent: 0; font-size: ${Math.max(10, fontSizePx - 1)}px; color: #444; line-height: 1.75; margin-bottom: 8px; }
    .tiptap [data-semantic-role="section-heading"] { border-bottom: 1px solid #eee; font-size: 16pt; color: #222; }
    .tiptap [data-semantic-role="references-heading"] { border-bottom: 1px solid #eee; font-size: 16pt; color: #222; }
    .tiptap [data-semantic-role="reference-item"] { text-indent: 0; line-height: 1.8; }
    .tiptap blockquote { border-left: 2px solid #d9dee8; padding-left: 14px; color: #616975; margin: 14px 0; background: #fafbfe; padding: 8px 14px; border-radius: 0 4px 4px 0; font-size: 14px; line-height: 1.7; }
    .tiptap ul, .tiptap ol { padding-left: 24px; }
    .tiptap li { margin: 4px 0; }
    .tiptap li > p { text-indent: 0; }
    .tiptap .references-list { padding-left: 0; margin: 14px 0; list-style-position: inside; }
    .tiptap .references-list li { margin: 10px 0; padding-left: 2.2em; text-indent: -2.2em; line-height: 1.75; }
    .tiptap img { max-width: 100%; border-radius: 2px; margin: 12px 0; }
    .tiptap figure { margin: 16px 0; text-align: center; }
    .tiptap figcaption { font-size: 10pt; color: #666; margin-top: 6px; line-height: 1.6; }
    .tiptap .document-break { display: none; }
    .tiptap table { width: 100%; border-collapse: collapse; margin: 14px 0; }
    .tiptap th, .tiptap td { border: 1px solid #e0e0e0; padding: 8px 12px; text-align: left; }
    .tiptap th { background: #f0f2f8; font-weight: 600; color: #444; }
    .tiptap code { background: #f0f2f5; padding: 2px 6px; border-radius: 3px; font-family: 'JetBrains Mono', 'Consolas', monospace; font-size: 13px; color: #d63384; }
    .tiptap pre { background: #f7f8fa; padding: 16px; border-radius: 6px; overflow-x: auto; border: 1px solid #eee; }
    .tiptap pre code { background: none; padding: 0; color: #333; }
    .tiptap ul[data-type="taskList"] { list-style: none; padding-left: 0; }
    .tiptap ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 8px; }
    .tiptap .formula-inline { display: inline-block; padding: 0 3px; margin: 0 1px; vertical-align: middle; }
    .tiptap .formula-block { display: flex; justify-content: center; margin: 10px 0; padding: 6px 10px; overflow-x: auto; }
    .tiptap .ai-ghost-text { display: none; }
    .tiptap .is-empty::before { display: none; }
  `
}

export async function exportPdfFromEditorHtml(
  editorHtml: string,
  styles: EditorExportStyles,
  title: string,
  parentWindow?: BrowserWindow,
): Promise<string | null> {
  const saveDialogOptions = {
    title: '导出 PDF',
    defaultPath: `${title || '文档'}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  }
  const { canceled, filePath } = parentWindow
    ? await dialog.showSaveDialog(parentWindow, saveDialogOptions)
    : await dialog.showSaveDialog(saveDialogOptions)

  if (canceled || !filePath) return null

  // Strip TipTap-only markup (removes contenteditable, ProseMirror classes, etc.)
  // then replace formula nodes with KaTeX HTML for high-quality PDF rendering.
  const stripped = stripEditorOnlyMarkup(editorHtml)
  const withFormulas = replaceFormulasForPdf(stripped)
  const withImages = await inlineLocalImages(withFormulas)

  const [css, katexCss] = await Promise.all([
    Promise.resolve(buildEditorPdfCss(styles)),
    loadKatexCss(),
  ])
  const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title || '文档')}</title>
    ${katexCss ? `<style>${katexCss}</style>` : ''}
    <style>${css}</style>
  </head>
  <body>
    <div class="page-wrapper">
      <div class="tiptap">${withImages}</div>
    </div>
  </body>
</html>`

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-writer-pdf-'))
  const tmpHtmlPath = path.join(tmpDir, 'export.html')

  const browser = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: false, contextIsolation: false },
  })

  try {
    await fs.writeFile(tmpHtmlPath, html, 'utf-8')
    await browser.loadFile(tmpHtmlPath)
    // Wait for layout/paint to settle before printing
    await new Promise<void>((resolve) => setTimeout(resolve, 500))
    const pdf = await browser.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'none' },
    })
    await fs.writeFile(filePath, pdf)
    return filePath
  } finally {
    browser.destroy()
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
  }
}