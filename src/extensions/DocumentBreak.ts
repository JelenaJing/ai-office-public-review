import { Node, mergeAttributes } from '@tiptap/core'

function buildBreakLabel(breakKind: string, sectionType?: string | null): string {
  if (breakKind === 'section-break') {
    const normalized = String(sectionType || '').trim()
    if (normalized === 'continuous') return '分节符 · 连续'
    if (normalized === 'evenPage') return '分节符 · 偶数页'
    if (normalized === 'oddPage') return '分节符 · 奇数页'
    return '分节符 · 下一页'
  }
  return '分页符'
}

export const DocumentBreak = Node.create({
  name: 'documentBreak',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      breakKind: {
        default: 'page-break',
        parseHTML: (element) => element.getAttribute('data-ooxml-object') || 'page-break',
        renderHTML: (attributes) => ({ 'data-ooxml-object': attributes.breakKind || 'page-break' }),
      },
      sourceXml: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-source-xml'),
        renderHTML: (attributes) => attributes.sourceXml ? { 'data-source-xml': attributes.sourceXml } : {},
      },
      sectionType: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-section-type'),
        renderHTML: (attributes) => attributes.sectionType ? { 'data-section-type': attributes.sectionType } : {},
      },
      sectionPropertiesXml: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-section-properties-xml'),
        renderHTML: (attributes) => attributes.sectionPropertiesXml ? { 'data-section-properties-xml': attributes.sectionPropertiesXml } : {},
      },
      sectionBreakXml: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-section-break-xml'),
        renderHTML: (attributes) => attributes.sectionBreakXml ? { 'data-section-break-xml': attributes.sectionBreakXml } : {},
      },
      hasManualPageBreak: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-has-manual-page-break') === 'true',
        renderHTML: (attributes) => attributes.hasManualPageBreak ? { 'data-has-manual-page-break': 'true' } : {},
      },
      pageTemplateId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-page-template-id'),
        renderHTML: (attributes) => attributes.pageTemplateId ? { 'data-page-template-id': attributes.pageTemplateId } : {},
      },
      label: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-break-label'),
        renderHTML: (attributes) => ({ 'data-break-label': attributes.label || buildBreakLabel(attributes.breakKind, attributes.sectionType) }),
      },
    }
  },

  parseHTML() {
    return [
      { tag: 'div[data-ooxml-object="page-break"]' },
      { tag: 'div[data-ooxml-object="section-break"]' },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    const breakKind = String(HTMLAttributes.breakKind || 'page-break')
    const label = String(HTMLAttributes.label || buildBreakLabel(breakKind, HTMLAttributes.sectionType))
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        class: `document-break document-break-${breakKind}`,
        contenteditable: 'false',
      }),
      ['span', { class: 'document-break__line', 'aria-hidden': 'true' }],
      ['span', { class: 'document-break__label' }, label],
      ['span', { class: 'document-break__line', 'aria-hidden': 'true' }],
    ]
  },
})
