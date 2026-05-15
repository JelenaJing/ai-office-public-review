import { Node, mergeAttributes } from '@tiptap/core'
import katex from 'katex'

function readDataAttribute(element: HTMLElement, name: string): string {
  return element.getAttribute(name) || ''
}

function renderFormulaHtml(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex || '', {
      throwOnError: false,
      strict: 'ignore',
      displayMode,
      output: 'html',
    })
  } catch {
    return `<span class="katex-error">${String(latex || '')}</span>`
  }
}

function buildNodeView(displayMode: boolean) {
  return ({ node }: { node: { attrs: { latex?: string; sourceId?: string; sourceXml?: string; mathml?: string } } }) => {
    const dom = document.createElement(displayMode ? 'div' : 'span')
    dom.className = displayMode ? 'formula-node formula-block' : 'formula-node formula-inline'
    dom.dataset.formulaNode = 'true'
    dom.dataset.ooxmlObject = 'formula'
    dom.dataset.formulaDisplay = displayMode ? 'block' : 'inline'
    dom.dataset.latex = String(node.attrs.latex || '')
    if (node.attrs.sourceId) dom.dataset.sourceId = String(node.attrs.sourceId)
    if (node.attrs.sourceXml) dom.dataset.sourceXml = String(node.attrs.sourceXml)
    if (node.attrs.mathml) dom.dataset.mathml = String(node.attrs.mathml)
    dom.contentEditable = 'false'
    dom.innerHTML = renderFormulaHtml(String(node.attrs.latex || ''), displayMode)
    return {
      dom,
      update(updatedNode: { attrs: { latex?: string; sourceId?: string; sourceXml?: string; mathml?: string } }) {
        const newLatex = String(updatedNode.attrs.latex || '')
        if (dom.dataset.latex !== newLatex) {
          dom.dataset.latex = newLatex
          dom.innerHTML = renderFormulaHtml(newLatex, displayMode)
        }
        if (updatedNode.attrs.sourceId != null) dom.dataset.sourceId = String(updatedNode.attrs.sourceId)
        if (updatedNode.attrs.sourceXml != null) dom.dataset.sourceXml = String(updatedNode.attrs.sourceXml)
        if (updatedNode.attrs.mathml != null) dom.dataset.mathml = String(updatedNode.attrs.mathml)
        return true
      },
    }
  }
}

export const InlineFormula = Node.create({
  name: 'inlineFormula',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (element) => readDataAttribute(element as HTMLElement, 'data-latex'),
        renderHTML: (attributes) => attributes.latex ? { 'data-latex': attributes.latex } : {},
      },
      sourceId: {
        default: '',
        parseHTML: (element) => readDataAttribute(element as HTMLElement, 'data-source-id'),
        renderHTML: (attributes) => attributes.sourceId ? { 'data-source-id': attributes.sourceId } : {},
      },
      sourceXml: {
        default: '',
        parseHTML: (element) => readDataAttribute(element as HTMLElement, 'data-source-xml'),
        renderHTML: (attributes) => attributes.sourceXml ? { 'data-source-xml': attributes.sourceXml } : {},
      },
      mathml: {
        default: '',
        parseHTML: (element) => readDataAttribute(element as HTMLElement, 'data-mathml'),
        renderHTML: (attributes) => attributes.mathml ? { 'data-mathml': attributes.mathml } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-formula-node="true"][data-formula-display="inline"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-formula-node': 'true',
      'data-ooxml-object': 'formula',
      'data-formula-display': 'inline',
      class: 'formula-node formula-inline',
    })]
  },

  addNodeView() {
    return buildNodeView(false)
  },
})

export const BlockFormula = Node.create({
  name: 'blockFormula',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (element) => readDataAttribute(element as HTMLElement, 'data-latex'),
        renderHTML: (attributes) => attributes.latex ? { 'data-latex': attributes.latex } : {},
      },
      sourceId: {
        default: '',
        parseHTML: (element) => readDataAttribute(element as HTMLElement, 'data-source-id'),
        renderHTML: (attributes) => attributes.sourceId ? { 'data-source-id': attributes.sourceId } : {},
      },
      sourceXml: {
        default: '',
        parseHTML: (element) => readDataAttribute(element as HTMLElement, 'data-source-xml'),
        renderHTML: (attributes) => attributes.sourceXml ? { 'data-source-xml': attributes.sourceXml } : {},
      },
      mathml: {
        default: '',
        parseHTML: (element) => readDataAttribute(element as HTMLElement, 'data-mathml'),
        renderHTML: (attributes) => attributes.mathml ? { 'data-mathml': attributes.mathml } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-formula-node="true"][data-formula-display="block"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-formula-node': 'true',
      'data-ooxml-object': 'formula',
      'data-formula-display': 'block',
      class: 'formula-node formula-block',
    })]
  },

  addNodeView() {
    return buildNodeView(true)
  },
})