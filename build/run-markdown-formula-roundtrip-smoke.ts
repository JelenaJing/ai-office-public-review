import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import TurndownService from 'turndown'
import { hasMarkdownSyntax, markdownToHtml } from '../src/utils/markdownToHtml'

function extractFormulaLatexFromNode(node: Node): string {
  const element = node as HTMLElement
  const fromDataset = String((element as any)?.dataset?.latex || '').trim()
  if (fromDataset) return fromDataset
  const fromAttr = String(element?.getAttribute?.('data-latex') || '').trim()
  if (fromAttr) return fromAttr
  return String(element?.textContent || '').replace(/\s+/g, ' ').trim()
}

function isElementNode(node: Node): node is HTMLElement {
  return Boolean(node && (node as Node).nodeType === 1)
}

function readNodeData(node: HTMLElement, key: string): string {
  const fromDataset = (node as any)?.dataset?.[key]
  if (typeof fromDataset === 'string') return fromDataset
  const attrName = `data-${key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`
  const fromAttr = node.getAttribute?.(attrName)
  return typeof fromAttr === 'string' ? fromAttr : ''
}

function normalizeMarkdownFormulaOutput(markdown: string): string {
  return String(markdown || '')
    .replace(/\$\$\s*([\s\S]*?)\s*\$\$/g, (_match, latex) => {
      const normalizedLatex = String(latex || '').trim()
      if (!normalizedLatex) return ''
      return `$$\n${normalizedLatex}\n$$`
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function createEditorTurndownService(): TurndownService {
  const service = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' })
  service.addRule('preserveInlineFormula', {
    filter: (node) => isElementNode(node) && node.nodeName === 'SPAN' && readNodeData(node, 'formulaNode') === 'true' && readNodeData(node, 'formulaDisplay') === 'inline',
    replacement: (_content, node) => `$${extractFormulaLatexFromNode(node)}$`,
  })
  service.addRule('preserveBlockFormula', {
    filter: (node) => isElementNode(node) && node.nodeName === 'DIV' && readNodeData(node, 'formulaNode') === 'true' && readNodeData(node, 'formulaDisplay') === 'block',
    replacement: (_content, node) => {
      const latex = extractFormulaLatexFromNode(node)
      return `\n\n$$\n${latex}\n$$\n\n`
    },
  })
  service.addRule('preserveInlineOoxmlFormula', {
    filter: (node) => {
      if (!isElementNode(node) || node.nodeName !== 'SPAN') return false
      const element = node
      return readNodeData(element, 'ooxmlObject') === 'formula' && readNodeData(element, 'formulaDisplay') !== 'block'
    },
    replacement: (_content, node) => `$${extractFormulaLatexFromNode(node)}$`,
  })
  service.addRule('preserveBlockOoxmlFormula', {
    filter: (node) => {
      if (!isElementNode(node)) return false
      const element = node
      if (!element || readNodeData(element, 'ooxmlObject') !== 'formula') return false
      if (node.nodeName === 'DIV') return true
      return readNodeData(element, 'formulaDisplay') === 'block'
    },
    replacement: (_content, node) => {
      const latex = extractFormulaLatexFromNode(node)
      return `\n\n$$\n${latex}\n$$\n\n`
    },
  })
  return service
}

function roundtripMarkdown(input: string): { html: string; markdown: string } {
  const html = markdownToHtml(input)
  const markdown = normalizeMarkdownFormulaOutput(createEditorTurndownService().turndown(html))
  return { html, markdown }
}

async function assertEditorPanelRules(projectRoot: string): Promise<void> {
  const source = await fs.readFile(path.join(projectRoot, 'src', 'components', 'EditorPanel.tsx'), 'utf-8')
  const bridgeSource = await fs.readFile(path.join(projectRoot, 'src', 'utils', 'tiptapMarkdownBridge.ts'), 'utf-8')
  assert.match(source, /preserveInlineOoxmlFormula/, 'EditorPanel 缺少 OOXML 行内公式 turndown 规则')
  assert.match(source, /preserveBlockOoxmlFormula/, 'EditorPanel 缺少 OOXML 块公式 turndown 规则')
  assert.match(source, /normalizeMarkdownFormulaOutput/, 'EditorPanel 缺少 markdown 公式标准化输出步骤')
  assert.match(source, /parseMarkdownWithTiptapBridge/, 'EditorPanel 未接入 markdown bridge 入站解析')
  assert.match(source, /serializeEditorToMarkdownWithBridge/, 'EditorPanel 未接入 markdown bridge 出站序列化')
  assert.match(source, /isMarkdownFilePath/, 'EditorPanel 缺少 md 文件分流判断')
  assert.match(bridgeSource, /inlineFormula/, 'markdown bridge 缺少 inlineFormula 映射')
  assert.match(bridgeSource, /blockFormula/, 'markdown bridge 缺少 blockFormula 映射')
  assert.match(bridgeSource, /image/, 'markdown bridge 缺少 image 节点映射')
  assert.match(bridgeSource, /table/, 'markdown bridge 缺少 table 节点序列化映射')
}

function runRoundtripCases(): void {
  const inlineCase = roundtripMarkdown('这是行内公式 $E=mc^2$ 的测试。')
  assert.match(inlineCase.html, /data-formula-display="inline"/, '行内公式未转换为公式节点')
  assert.match(inlineCase.markdown, /\$E=mc\^2\$/, '行内公式未回写为 $...$')
  const symbolCase = roundtripMarkdown('where $e$ is charge, $V$ is volt, and $CED$ is dimension.')
  assert.match(symbolCase.html, /data-formula-display="inline"/, '单变量/缩写行内公式未被识别')
  assert.match(symbolCase.markdown, /\$e\$/, '变量 e 未保留为行内公式')
  assert.match(symbolCase.markdown, /\$V\$/, '变量 V 未保留为行内公式')
  assert.match(symbolCase.markdown, /\$CED\$/, '变量 CED 未保留为行内公式')

  const blockCase = roundtripMarkdown('$$x^2+y^2=z^2$$')
  assert.match(blockCase.html, /data-formula-display="block"/, '块公式未转换为公式节点')
  assert.doesNotMatch(blockCase.html, /<p>\s*<div[^>]*data-formula-node="true"/, '块公式被错误包裹在段落中')
  assert.match(blockCase.markdown, /\$\$\nx\^2\+y\^2=z\^2\n\$\$/, '块公式未回写为标准多行 $$ 包裹')

  const mixedCase = roundtripMarkdown('段落一。\n\n$$a=b+c$$\n\n段落二里有 $x+y$。')
  assert.match(mixedCase.markdown, /段落一。/, '混排内容丢失首段')
  assert.match(mixedCase.markdown, /\$\$\na=b\+c\n\$\$/, '混排中的块公式回写异常')
  assert.match(mixedCase.markdown, /\$x\+y\$/, '混排中的行内公式回写异常')

  const currencyCase = roundtripMarkdown('价格是 $100，不是公式。\n下一行是公式 $x+1$。')
  assert.match(currencyCase.markdown, /\$100/, '货币美元符号被误处理')
  assert.match(currencyCase.markdown, /\$x\+1\$/, '合法公式未被保留')

  const parenDelimiterCase = roundtripMarkdown('使用 \\(a^2+b^2=c^2\\) 作为行内公式。')
  assert.match(parenDelimiterCase.html, /data-formula-display="inline"/, '\\(\\) 行内公式未被识别')

  const bracketDelimiterCase = roundtripMarkdown('\\[\\n\\frac{1}{2}mv^2\\n\\]')
  assert.match(bracketDelimiterCase.html, /data-formula-display="block"/, '\\[\\] 块公式未被识别')

  const bareLatexBlockCase = roundtripMarkdown('\\frac{\\left\\langle E_{ca} \\right\\rangle}{\\left\\langle E_J \\right\\rangle}=\\frac{C_p m_{water}\\Delta T}{Mgh}=4.186\\tag{2}')
  assert.match(bareLatexBlockCase.html, /data-formula-display="block"/, '裸 LaTeX 块公式未被识别')
  assert.match(bareLatexBlockCase.markdown, /\$\$\n\\frac\{\\left\\langle E_\{ca\}\\right\\rangle\}/, `裸 LaTeX 块公式未回写为块公式: ${bareLatexBlockCase.markdown}`)

  const reportedBareLatexCase = '\\frac{\\left\\langleE_{ca l}\\right\\rangle}{\\left\\langleE_{J}\\right\\rangle}=\\frac{C_{p}m_{wa te r}\\DeltaT}{Mg h}=\\frac{1}{1}\\frac{(Ca l)}{(J)}\\frac{CE D}{CE D}=\\frac{(Ca l)}{(J)}=4.186\\tag{2}'
  assert.equal(hasMarkdownSyntax(reportedBareLatexCase), true, '裸 LaTeX 未触发结构化渲染入口')
  const reportedCase = roundtripMarkdown(reportedBareLatexCase)
  assert.match(reportedCase.html, /data-formula-display="block"/, '用户反馈的裸 LaTeX 块公式未被识别')
  assert.match(reportedCase.markdown, /\$\$\n\\frac\{\\left\\langleE_\{ca l\}\\right\\rangle\}/, `用户反馈的裸 LaTeX 未回写为块公式: ${reportedCase.markdown}`)

  const proseBeforeBareLatexCase = roundtripMarkdown('obtained:\n\\frac{1}{1}\\frac{Ca J}{J}=4.186\\tag{2}')
  assert.match(proseBeforeBareLatexCase.markdown, /obtained:/, `裸公式前的正文丢失: ${proseBeforeBareLatexCase.markdown}`)
  assert.match(proseBeforeBareLatexCase.markdown, /\$\$\n\\frac\{1\}\{1\}/, `正文后的裸 LaTeX 行未转成块公式: ${proseBeforeBareLatexCase.markdown}`)

  const ocrSpacingCase = roundtripMarkdown('$$ 1 . 6 0 2 \\times 1 0 ^ {- 1 9} $$')
  assert.match(ocrSpacingCase.html, /data-formula-display="block"/, 'OCR 风格块公式未被识别')
  assert.doesNotMatch(ocrSpacingCase.markdown, /1\s+\.\s+6|1\.6\s+0|60\s+2/, `OCR 小数空格未归一化: ${ocrSpacingCase.markdown}`)
  assert.doesNotMatch(ocrSpacingCase.markdown, /1\s+0\^\{-19\}|10\^\{\s+-\s+19\s+\}/, `OCR 指数空格未归一化: ${ocrSpacingCase.markdown}`)

  const tildeApproxCase = roundtripMarkdown('$$ ~ 11606K $$')
  assert.match(tildeApproxCase.markdown, /\\sim11606K|\\sim 11606K/, `裸 ~ 未归一化为 \\sim: ${tildeApproxCase.markdown}`)

  const ocrIdentifierCase = roundtripMarkdown('$$ H _ {t o t} = \\frac {C E D}{C E D} = 1 1 6 0 6 $$')
  assert.doesNotMatch(ocrIdentifierCase.markdown, /_\{t o t\}/, `OCR 下标字母未归一化: ${ocrIdentifierCase.markdown}`)
  assert.doesNotMatch(ocrIdentifierCase.markdown, /C E D/, `OCR 全大写缩写未归一化: ${ocrIdentifierCase.markdown}`)
  assert.doesNotMatch(ocrIdentifierCase.markdown, /1 1 6 0 6/, `OCR 数字串未归一化: ${ocrIdentifierCase.markdown}`)

  const tagPlacementCase = roundtripMarkdown('$$\\begin{array}{l}a=b\\tag{1}\\\\\\end{array}$$')
  assert.match(tagPlacementCase.markdown, /\\end\{array\}\\tag\{1\}/, `\\tag 位置未归一化: ${tagPlacementCase.markdown}`)
}

async function main(): Promise<void> {
  const projectRoot = process.cwd()
  await assertEditorPanelRules(projectRoot)
  runRoundtripCases()
  console.log('markdown formula roundtrip smoke passed')
}

main().catch((error) => {
  console.error('[smoke] failed:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
