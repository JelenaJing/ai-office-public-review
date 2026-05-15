import MarkdownIt from 'markdown-it'
import type { Editor } from '@tiptap/react'
import type { JSONContent } from '@tiptap/core'
import { MarkdownParser, MarkdownSerializer, type ParseSpec } from '@tiptap/pm/markdown'
import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model'

const BLOCK_FORMULA_TOKEN_PREFIX = 'AIWFORMULABLOCKTOKEN'
const INLINE_FORMULA_TOKEN_PREFIX = 'AIWFORMULAINLINETOKEN'

interface FormulaTokenizedResult {
  markdown: string
  blockLatexByToken: Map<string, string>
  inlineLatexByToken: Map<string, string>
}

function isLikelyInlineLatex(latex: string): boolean {
  const normalized = String(latex || '').trim()
  if (!normalized) return false
  if (/^[\d\s.,%]+$/.test(normalized)) return false
  if (/^[\d\s.,%+\-]+$/.test(normalized)) return false
  if (/^[A-Za-z]+(?:_[A-Za-z0-9]+)?$/.test(normalized)) return true
  return /[\\^_{}=+\-*/()]/.test(normalized) || /[A-Za-z]\s*[=<>]/.test(normalized)
}

function normalizeOcrStyledLatex(latex: string, mode: 'inline' | 'block' = 'inline'): string {
  let normalized = String(latex || '')
    .replace(/\s+/g, ' ')
    // OCR / manual "~ 11606K" should be approximate symbol, not spacing.
    .replace(/(^|[=<>+\-*/,(\[{;:])\s*~\s*(?=[A-Za-z0-9\\])/g, '$1\\sim ')
    .replace(/\s*([{}_^=+\-*/\\()[\]])\s*/g, '$1')
    .replace(/(\d)\s*\.\s*(\d)/g, '$1.$2')
    // 不要合并任意「字母 空格 字母」：会破坏合法 LaTeX（如 \langle E、\Delta T）。
    // OCR 下标里的字母空格由 block 模式下的 _{...} 归一化单独处理。
    .trim()

  for (let i = 0; i < 4; i += 1) {
    const next = normalized.replace(/(\d)\s+(\d)/g, '$1$2')
    if (next === normalized) break
    normalized = next
  }
  if (mode === 'block') {
    // Merge OCR-spaced identifiers inside sub/superscript braces: _{t o t} -> _{tot}
    normalized = normalized.replace(/([_^]\{)\s*([A-Za-z0-9](?:\s+[A-Za-z0-9])+)\s*(\})/g, (_m, open, body, close) => {
      const compact = String(body || '').replace(/\s+/g, '')
      return `${open}${compact}${close}`
    })
    // Merge all-caps acronyms split by OCR: C E D -> CED
    normalized = normalized.replace(/\b([A-Z](?:\s+[A-Z]){1,10})\b/g, (_m, body) => String(body || '').replace(/\s+/g, ''))
    normalized = normalizeLatexTagPlacement(normalized)
  }
  return normalized
}

function normalizeLatexTagPlacement(latex: string): string {
  const source = String(latex || '')
  return source.replace(
    /\\begin\{(array|aligned|align|gathered)\}([\s\S]*?)\\tag\{([^}]+)\}([\s\S]*?)\\end\{\1\}/g,
    (_match, env: string, beforeTag: string, tagValue: string, afterTag: string) => {
      const mergedBody = `${beforeTag}${afterTag}`.replace(/(?:\\\\\s*)+$/g, '').trim()
      const safeBody = mergedBody ? `${mergedBody}\\\\` : ''
      return `\\begin{${env}}${safeBody}\\end{${env}}\\tag{${String(tagValue || '').trim()}}`
    },
  )
}

function isLikelyBareBlockLatex(source: string): boolean {
  const value = String(source || '').trim()
  if (!value) return false
  if (/^(```|~~~|#{1,6}\s|>\s|\s*[-*+]\s+|\s*\d+\.\s+)/m.test(value)) return false
  if (/^\|.*\|$/m.test(value)) return false
  if (!/[{}_^=\\]/.test(value)) return false

  const lines = value.split(/\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length > 1 && lines.some((line) => !/[\\{}_^=+\-*/&]/.test(line))) return false
  const firstCommandIndex = value.search(/\\[A-Za-z]+/)
  if (firstCommandIndex > 0 && /\s/.test(value.slice(0, firstCommandIndex).trim())) return false

  const commandMatches = value.match(/\\[A-Za-z]+/g) || []
  const hasStrongFormulaCommand = /\\(?:frac|begin|left|right|sum|prod|int|sqrt|tag|Delta|Gamma|Theta|lambda|mu|langle|rangle|cdot|times|overline|underline|mathbf|mathrm|mathit|mathcal)\b/.test(value)
  const hasFormulaStructure = /(?:[{}_^=]|\\\\)/.test(value)
  if (hasStrongFormulaCommand && hasFormulaStructure) return true
  if (value.includes('\n') && commandMatches.length >= 1 && hasFormulaStructure) return true
  return commandMatches.length >= 2 && hasFormulaStructure
}

function isBareLatexContinuationLine(source: string): boolean {
  const value = String(source || '').trim()
  if (!value) return false
  if (/^(```|~~~|#{1,6}\s|>\s|\s*[-*+]\s+|\s*\d+\.\s+)/.test(value)) return false
  return /[\\{}_^=+\-*/&]/.test(value)
}

function replaceBareLatexBlocks(source: string, createToken: (latex: string) => string): string {
  const lines = String(source || '').split('\n')
  const output: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!isLikelyBareBlockLatex(line)) {
      output.push(line)
      continue
    }

    const latexLines = [line]
    let cursor = index + 1
    while (cursor < lines.length && isBareLatexContinuationLine(lines[cursor])) {
      latexLines.push(lines[cursor])
      cursor += 1
    }
    output.push(createToken(latexLines.join('\n')))
    index = cursor - 1
  }

  return output.join('\n')
}

function tokenizeMarkdownFormulas(source: string): FormulaTokenizedResult {
  const blockLatexByToken = new Map<string, string>()
  const inlineLatexByToken = new Map<string, string>()
  let blockIndex = 0
  let inlineIndex = 0

  const withBlockTokens = String(source || '').replace(
    /(^|\n)\$\$([\s\S]*?)\$\$(?=\n|$)/g,
    (_match, prefix: string, latex: string) => {
      const normalizedLatex = normalizeOcrStyledLatex(latex, 'block')
      const token = `${BLOCK_FORMULA_TOKEN_PREFIX}${blockIndex++}END`
      blockLatexByToken.set(token, normalizedLatex)
      return `${prefix}\n${token}\n`
    },
  )
  const withBracketBlockTokens = withBlockTokens.replace(
    /(^|\n)\\\[([\s\S]*?)\\\](?=\n|$)/g,
    (_match, prefix: string, latex: string) => {
      const normalizedLatex = normalizeOcrStyledLatex(latex, 'block')
      const token = `${BLOCK_FORMULA_TOKEN_PREFIX}${blockIndex++}END`
      blockLatexByToken.set(token, normalizedLatex)
      return `${prefix}\n${token}\n`
    },
  )

  const withBareBlockTokens = replaceBareLatexBlocks(withBracketBlockTokens, (latex) => {
    const normalizedLatex = normalizeOcrStyledLatex(latex, 'block')
    const token = `${BLOCK_FORMULA_TOKEN_PREFIX}${blockIndex++}END`
    blockLatexByToken.set(token, normalizedLatex)
    return token
  })

  const withParenInlineTokens = withBareBlockTokens.replace(
    /\\\(([\s\S]*?)\\\)/g,
    (_match, latex: string) => {
      const normalizedLatex = normalizeOcrStyledLatex(latex, 'inline')
      if (!isLikelyInlineLatex(normalizedLatex)) return _match
      const token = `${INLINE_FORMULA_TOKEN_PREFIX}${inlineIndex++}END`
      inlineLatexByToken.set(token, normalizedLatex)
      return token
    },
  )

  const withInlineTokens = withParenInlineTokens.replace(
    /(^|[^\\$])\$(?!\s)([^$\n]|\\\$)+?(?<!\s)\$/g,
    (fullMatch, leftBoundary: string, _unused: string, offset: number, source: string) => {
      const inlineMatch = fullMatch.slice(String(leftBoundary).length)
      const latex = inlineMatch.slice(1, -1)
      const normalizedLatex = normalizeOcrStyledLatex(latex, 'inline')
      if (!isLikelyInlineLatex(normalizedLatex)) return fullMatch
      const openingDollarIndex = offset + String(leftBoundary).length
      const closingDollarIndex = openingDollarIndex + inlineMatch.length - 1
      const prevChar = openingDollarIndex > 0 ? source.charAt(openingDollarIndex - 1) : ''
      const nextChar = closingDollarIndex + 1 < source.length ? source.charAt(closingDollarIndex + 1) : ''
      if (/[A-Za-z0-9]/.test(prevChar) || /[A-Za-z0-9]/.test(nextChar)) return fullMatch
      const token = `${INLINE_FORMULA_TOKEN_PREFIX}${inlineIndex++}END`
      inlineLatexByToken.set(token, normalizedLatex)
      return `${leftBoundary}${token}`
    },
  )

  return { markdown: withInlineTokens, blockLatexByToken, inlineLatexByToken }
}

function buildMarkdownParser(schema: Schema): MarkdownParser {
  const tokens: Record<string, ParseSpec> = {}
  const hasNode = (name: string) => Boolean(schema.nodes[name])
  const hasMark = (name: string) => Boolean(schema.marks[name])

  if (hasNode('blockquote')) tokens.blockquote = { block: 'blockquote' }
  if (hasNode('paragraph')) tokens.paragraph = { block: 'paragraph' }
  if (hasNode('listItem')) tokens.list_item = { block: 'listItem' }
  if (hasNode('bulletList')) tokens.bullet_list = { block: 'bulletList', getAttrs: (tok: any) => ({ tight: tok.hidden }) }
  if (hasNode('orderedList')) {
    tokens.ordered_list = {
      block: 'orderedList',
      getAttrs: (tok: any) => ({
        order: tok.attrGet('start') == null ? 1 : +tok.attrGet('start'),
        tight: tok.hidden,
      }),
    }
  }
  if (hasNode('heading')) tokens.heading = { block: 'heading', getAttrs: (tok: any) => ({ level: +tok.tag.slice(1) }) }
  if (hasNode('codeBlock')) tokens.code_block = { block: 'codeBlock', noCloseToken: true }
  if (hasNode('codeBlock')) tokens.fence = { block: 'codeBlock', noCloseToken: true, getAttrs: (tok: any) => ({ language: tok.info || '' }) }
  if (hasNode('horizontalRule')) tokens.hr = { node: 'horizontalRule' }
  if (hasNode('hardBreak')) tokens.hardbreak = { node: 'hardBreak' }
  if (hasNode('image')) {
    tokens.image = {
      node: 'image',
      getAttrs: (tok: any) => {
        const title = tok.attrGet('title')
        return {
          src: tok.attrGet('src'),
          title,
          alt: tok.content || null,
          caption: title || null,
        }
      },
    }
  }

  if (hasMark('italic')) tokens.em = { mark: 'italic' }
  if (hasMark('bold')) tokens.strong = { mark: 'bold' }
  if (hasMark('link')) tokens.link = { mark: 'link', getAttrs: (tok: any) => ({ href: tok.attrGet('href'), title: tok.attrGet('title') || null }) }
  if (hasMark('code')) tokens.code_inline = { mark: 'code', noCloseToken: true }
  if (hasMark('strike')) tokens.s = { mark: 'strike' }

  return new MarkdownParser(schema, new MarkdownIt('default', { html: false, linkify: true }), tokens)
}

function replaceFormulaTokens(node: JSONContent, tokens: FormulaTokenizedResult): JSONContent {
  const content = Array.isArray(node.content) ? node.content : []
  const nextContent: JSONContent[] = []

  for (const child of content) {
    if (child.type === 'paragraph' && Array.isArray(child.content) && child.content.length === 1) {
      const only = child.content[0]
      if (only.type === 'text') {
        const tokenValue = String(only.text || '').trim()
        const blockLatex = tokens.blockLatexByToken.get(tokenValue)
        if (blockLatex) {
          nextContent.push({ type: 'blockFormula', attrs: { latex: blockLatex } })
          continue
        }
      }
    }

    if (child.type === 'paragraph' && Array.isArray(child.content)) {
      const paragraphContent: JSONContent[] = []
      for (const inlineNode of child.content) {
        if (inlineNode.type !== 'text') {
          paragraphContent.push(replaceFormulaTokens(inlineNode, tokens))
          continue
        }
        const textValue = String(inlineNode.text || '')
        if (!textValue) continue
        const parts = textValue.split(new RegExp(`(${INLINE_FORMULA_TOKEN_PREFIX}\\d+END)`, 'g')).filter(Boolean)
        if (parts.length <= 1) {
          paragraphContent.push(inlineNode)
          continue
        }
        for (const part of parts) {
          const latex = tokens.inlineLatexByToken.get(part)
          if (latex) {
            paragraphContent.push({ type: 'inlineFormula', attrs: { latex } })
          } else {
            paragraphContent.push({ type: 'text', text: part, marks: inlineNode.marks })
          }
        }
      }
      nextContent.push({ ...child, content: paragraphContent })
      continue
    }

    nextContent.push(replaceFormulaTokens(child, tokens))
  }

  return { ...node, content: nextContent }
}

function createMarkdownSerializer(schema: Schema): MarkdownSerializer {
  const readInlineText = (node: ProseMirrorNode): string => {
    if (node.type.name === 'text') return String(node.text || '')
    if (!node.childCount) return ''
    const parts: string[] = []
    node.forEach((child) => {
      if (child.type.name === 'inlineFormula') {
        parts.push(`$${String(child.attrs.latex || '').trim()}$`)
        return
      }
      if (child.type.name === 'hardBreak') {
        parts.push(' ')
        return
      }
      parts.push(readInlineText(child))
    })
    return parts.join('').replace(/\s+/g, ' ').trim()
  }

  const nodes: Record<string, any> = {
    text: (state: any, node: ProseMirrorNode) => state.text(node.text || '', !state.inAutolink),
    paragraph: (state: any, node: ProseMirrorNode) => {
      state.renderInline(node)
      state.closeBlock(node)
    },
    blockquote: (state: any, node: ProseMirrorNode) => {
      state.wrapBlock('> ', null, node, () => state.renderContent(node))
    },
    heading: (state: any, node: ProseMirrorNode) => {
      const level = Number(node.attrs.level || 1)
      state.write(`${'#'.repeat(Math.min(6, Math.max(1, level)))} `)
      state.renderInline(node, false)
      state.closeBlock(node)
    },
    bulletList: (state: any, node: ProseMirrorNode) => {
      state.renderList(node, '  ', () => '- ')
    },
    orderedList: (state: any, node: ProseMirrorNode) => {
      const start = Number(node.attrs.order || 1)
      const maxW = String(start + node.childCount - 1).length
      const space = `${' '.repeat(maxW)}. `
      state.renderList(node, `${' '.repeat(space.length)}`, (index: number) => `${String(start + index).padStart(maxW, ' ')}. `)
    },
    listItem: (state: any, node: ProseMirrorNode) => {
      state.renderContent(node)
    },
    codeBlock: (state: any, node: ProseMirrorNode) => {
      const language = String(node.attrs.language || '').trim()
      state.write(`\`\`\`${language}\n`)
      state.text(node.textContent, false)
      state.write('\n```')
      state.closeBlock(node)
    },
    horizontalRule: (state: any, node: ProseMirrorNode) => {
      state.write('---')
      state.closeBlock(node)
    },
    hardBreak: (state: any) => {
      state.write('\\\n')
    },
    image: (state: any, node: ProseMirrorNode) => {
      const alt = String(node.attrs.alt || '')
      const src = String(node.attrs.src || '').replace(/[\(\)]/g, '\\$&')
      const titleCandidate = String(node.attrs.title || node.attrs.caption || '').trim()
      const title = titleCandidate ? ` "${titleCandidate.replace(/"/g, '\\"')}"` : ''
      state.write(`![${state.esc(alt)}](${src}${title})`)
    },
    table: (state: any, node: ProseMirrorNode) => {
      const rows: string[][] = []
      node.forEach((row) => {
        const cells: string[] = []
        row.forEach((cell) => {
          const cellText = readInlineText(cell).replace(/\|/g, '\\|')
          cells.push(cellText)
        })
        rows.push(cells)
      })
      if (!rows.length) return
      const header = rows[0]
      const bodyRows = rows.slice(1)
      state.write(`| ${header.join(' | ')} |`)
      state.write('\n')
      state.write(`| ${header.map(() => '---').join(' | ')} |`)
      for (const row of bodyRows) {
        state.write('\n')
        state.write(`| ${row.join(' | ')} |`)
      }
      state.closeBlock(node)
    },
    inlineFormula: (state: any, node: ProseMirrorNode) => {
      state.write(`$${String(node.attrs.latex || '').trim()}$`)
    },
    blockFormula: (state: any, node: ProseMirrorNode) => {
      const latex = String(node.attrs.latex || '').trim()
      state.write(`$$\n${latex}\n$$`)
      state.closeBlock(node)
    },
  }

  const marks: Record<string, any> = {}
  if (schema.marks.bold) marks.bold = { open: '**', close: '**', mixable: true, expelEnclosingWhitespace: true }
  if (schema.marks.italic) marks.italic = { open: '*', close: '*', mixable: true, expelEnclosingWhitespace: true }
  if (schema.marks.code) marks.code = { open: '`', close: '`', escape: false }
  if (schema.marks.strike) marks.strike = { open: '~~', close: '~~', mixable: true }
  if (schema.marks.link) {
    marks.link = {
      open: '[',
      close: (_state: any, mark: any) => {
        const href = String(mark.attrs.href || '').replace(/[\(\)"]/g, '\\$&')
        const title = mark.attrs.title ? ` "${String(mark.attrs.title).replace(/"/g, '\\"')}"` : ''
        return `](${href}${title})`
      },
      mixable: true,
    }
  }

  return new MarkdownSerializer(nodes, marks, { strict: false, hardBreakNodeName: 'hardBreak' })
}

export function parseMarkdownWithTiptapBridge(markdown: string, editor: Editor): JSONContent {
  const tokenized = tokenizeMarkdownFormulas(markdown)
  const parser = buildMarkdownParser(editor.schema)
  const doc = parser.parse(tokenized.markdown)
  return replaceFormulaTokens(doc.toJSON(), tokenized)
}

export function serializeEditorToMarkdownWithBridge(editor: Editor): string {
  const serializer = createMarkdownSerializer(editor.schema)
  const markdown = serializer.serialize(editor.state.doc)
  return String(markdown || '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
