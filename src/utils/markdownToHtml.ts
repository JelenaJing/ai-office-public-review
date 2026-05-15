import { marked } from 'marked'
import katex from 'katex'

marked.setOptions({
  gfm: true,
  breaks: false,
})

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

export function markdownToHtml(md: string): string {
  if (!md || !md.trim()) return ''
  const htmlTagPattern = /^<(?:h[1-6]|p|div|ul|ol|table|blockquote|img|pre|br)\b/i
  const stripped = md.trim()
  if (htmlTagPattern.test(stripped)) {
    return annotatePaperStructure(stripped)
  }
  const tokenized = tokenizeMarkdownFormulas(md)
  const rendered = marked.parse(tokenized.markdown) as string
  return annotatePaperStructure(rehydrateFormulaTokens(rendered, tokenized))
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

  return {
    markdown: withInlineTokens,
    blockLatexByToken,
    inlineLatexByToken,
  }
}

function rehydrateFormulaTokens(renderedHtml: string, tokenized: FormulaTokenizedResult): string {
  let html = String(renderedHtml || '')

  tokenized.blockLatexByToken.forEach((latex, token) => {
    const replacement = `<div data-formula-node="true" data-formula-display="block" data-latex="${escapeHtml(latex)}" class="formula-node formula-block">${renderKatex(latex, true)}</div>`
    html = html
      .replace(new RegExp(`<p>\\s*${escapeRegExp(token)}\\s*</p>`, 'g'), replacement)
      .replace(new RegExp(escapeRegExp(token), 'g'), replacement)
  })

  tokenized.inlineLatexByToken.forEach((latex, token) => {
    const replacement = `<span data-formula-node="true" data-formula-display="inline" data-latex="${escapeHtml(latex)}" class="formula-node formula-inline">${renderKatex(latex, false)}</span>`
    html = html.replace(new RegExp(escapeRegExp(token), 'g'), replacement)
  })

  return html
}

function normalizeImageSource(src: string): string {
  const value = String(src || '').trim()
  if (!value) return value
  if (/^(https?:)?\/\//i.test(value) || value.startsWith('data:') || value.startsWith('file:///')) {
    return value
  }
  if (value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value)) {
    const normalized = value.replace(/\\/g, '/')
    const encoded = encodeURI(normalized)
    return encoded.startsWith('/') ? `file://${encoded}` : `file:///${encoded}`
  }
  return value
}

function transformCitationSuperscripts(root: Element): void {
  const doc = root.ownerDocument
  if (!doc) return

  const paragraphs = Array.from(root.querySelectorAll('p'))
  for (const para of paragraphs) {
    if (para.closest('.references-list')) continue
    const walker = doc.createTreeWalker(para, NodeFilter.SHOW_TEXT)
    const textNodes: Text[] = []
    let node: Node | null
    while ((node = walker.nextNode())) {
      textNodes.push(node as Text)
    }
    for (const textNode of textNodes) {
      const text = textNode.textContent || ''
      if (!/\[\d+\]/.test(text)) continue
      const frag = doc.createDocumentFragment()
      let lastIndex = 0
      const regex = /\[(\d+)\]/g
      let match: RegExpExecArray | null
      while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
          frag.appendChild(doc.createTextNode(text.slice(lastIndex, match.index)))
        }
        const sup = doc.createElement('sup')
        sup.textContent = `[${match[1]}]`
        frag.appendChild(sup)
        lastIndex = match.index + match[0].length
      }
      if (lastIndex < text.length) {
        frag.appendChild(doc.createTextNode(text.slice(lastIndex)))
      }
      textNode.parentNode?.replaceChild(frag, textNode)
    }
  }
}

function transformReferenceParagraphs(root: Element): void {
  const doc = root.ownerDocument
  if (!doc) return

  const extractReferenceEntries = (text: string): string[] => {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim()
    if (!normalized) return []
    const matches = normalized.match(/(?:\[\d+\]|\d+[.)])\s+.*?(?=(?:\s+(?:\[\d+\]|\d+[.)])\s+)|$)/g)
    return Array.isArray(matches)
      ? matches.map((item) => item.trim()).filter(Boolean)
      : []
  }

  const children = Array.from(root.children)
  for (let index = 0; index < children.length; index += 1) {
    const element = children[index]
    if (element.tagName.toLowerCase() !== 'h1' && element.tagName.toLowerCase() !== 'h2' && element.tagName.toLowerCase() !== 'h3' && element.tagName.toLowerCase() !== 'h4' && element.tagName.toLowerCase() !== 'h5' && element.tagName.toLowerCase() !== 'h6') {
      continue
    }

    const headingText = String(element.textContent || '').trim()
    if (!/^(参考文献|references)$/i.test(headingText)) continue

    const referenceParagraphs: HTMLParagraphElement[] = []
    const inlineReferenceEntries: string[] = []
    let cursor = index + 1
    while (cursor < children.length) {
      const candidate = children[cursor]
      const tagName = candidate.tagName.toLowerCase()
      if (/^h[1-6]$/.test(tagName)) break
      if (tagName === 'p') {
        const paragraphText = String(candidate.textContent || '').trim()
        const extractedEntries = extractReferenceEntries(paragraphText)
        if (extractedEntries.length > 1) {
          inlineReferenceEntries.push(...extractedEntries)
          candidate.remove()
          cursor += 1
          continue
        }
        if (/^\[\d+\]\s+/.test(paragraphText) || /^\d+[.)]\s+/.test(paragraphText)) {
          referenceParagraphs.push(candidate as HTMLParagraphElement)
          cursor += 1
          continue
        }
      }
      if (!String(candidate.textContent || '').trim()) {
        cursor += 1
        continue
      }
      break
    }

    if (referenceParagraphs.length === 0 && inlineReferenceEntries.length === 0) continue

    const list = doc.createElement('ol')
    list.className = 'references-list'
    for (const paragraph of referenceParagraphs) {
      const text = String(paragraph.textContent || '').trim().replace(/^(?:\[(\d+)\]|(\d+)[.)])\s+/, '')
      const item = doc.createElement('li')
      item.textContent = text
      list.appendChild(item)
      paragraph.remove()
    }

    for (const entry of inlineReferenceEntries) {
      const text = entry.replace(/^(?:\[(\d+)\]|(\d+)[.)])\s+/, '').trim()
      if (!text) continue
      const item = doc.createElement('li')
      item.textContent = text
      list.appendChild(item)
    }

    element.insertAdjacentElement('afterend', list)
  }
}

function annotatePaperStructure(html: string): string {
  if (typeof DOMParser === 'undefined') return html

  const doc = new DOMParser().parseFromString(`<div data-paper-root="true">${html}</div>`, 'text/html')
  const root = doc.querySelector('[data-paper-root="true"]')
  if (!root) return html

  let titleAssigned = false
  let sectionMode: 'abstract' | 'keywords' | null = null

  Array.from(root.children).forEach((element) => {
    const tagName = element.tagName.toLowerCase()
    const text = String(element.textContent || '').trim()
    element.removeAttribute('data-semantic-role')

    if (!text) {
      return
    }

    if (!titleAssigned && tagName === 'h1' && !/^(摘要|abstract|关键词|关键字|keywords?|参考文献|references)$/i.test(text)) {
      element.setAttribute('data-semantic-role', 'paper-title')
      titleAssigned = true
      sectionMode = null
      return
    }

    if (/^h[1-6]$/.test(tagName)) {
      if (/^(摘要|abstract)$/i.test(text)) {
        element.setAttribute('data-semantic-role', 'abstract-heading')
        sectionMode = 'abstract'
        return
      }

      if (/^(关键词|关键字|keywords?)$/i.test(text)) {
        element.setAttribute('data-semantic-role', 'keywords-heading')
        sectionMode = 'keywords'
        return
      }

      if (/^(参考文献|references)$/i.test(text)) {
        element.setAttribute('data-semantic-role', 'references-heading')
      } else {
        element.setAttribute('data-semantic-role', 'section-heading')
      }
      sectionMode = null
      return
    }

    if (tagName === 'p') {
      if (sectionMode === 'abstract') {
        element.setAttribute('data-semantic-role', 'abstract-body')
        return
      }
      if (sectionMode === 'keywords') {
        element.setAttribute('data-semantic-role', 'keywords-body')
        return
      }
    }
  })

  Array.from(root.querySelectorAll('img')).forEach((image) => {
    const src = image.getAttribute('src')
    if (!src) return
    image.setAttribute('src', normalizeImageSource(src))
  })

  transformReferenceParagraphs(root)
  transformCitationSuperscripts(root)

  return root.innerHTML
}

function renderKatex(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, { throwOnError: false, strict: 'ignore', displayMode, output: 'html' })
  } catch {
    return escapeHtml(latex)
  }
}

function escapeHtml(input: string): string {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeRegExp(value: string): string {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function hasMarkdownSyntax(text: string): boolean {
  const value = String(text || '')
  if (/(^|\n)\s*(?:\$\$|\\\[)|\\\(|(^|\n)\s*\\(?:frac|begin|left|right|sum|prod|int|sqrt|tag)\b/m.test(value)) return true
  if (value.split(/\n/).some((line) => isLikelyBareBlockLatex(line))) return true
  return /(^|\n)#{1,6}\s+|\*\*.+?\*\*|\*.+?\*|`[^`]+`|!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\)|(^|\n)\s*[-*+]\s+|(^|\n)\s*\d+\.\s+/m.test(value)
}