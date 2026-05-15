import { Extension } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    verticalAlign: {
      setVerticalAlign: (value: 'super' | 'sub') => ReturnType
      unsetVerticalAlign: () => ReturnType
    }
  }
}

const VerticalAlign = Extension.create<{ types: string[] }>({
  name: 'verticalAlign',

  addOptions() {
    return { types: ['textStyle'] }
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          verticalAlign: {
            default: null,
            parseHTML: (element) => {
              const tagName = (element as HTMLElement).tagName?.toLowerCase()
              if (tagName === 'sup') return 'super'
              if (tagName === 'sub') return 'sub'
              const value = (element as HTMLElement).style.verticalAlign || null
              if (value === 'super' || value === 'sub') return value
              if (value === 'superscript') return 'super'
              if (value === 'subscript') return 'sub'
              return null
            },
            renderHTML: (attributes) => {
              const value = attributes['verticalAlign']
              if (value !== 'super' && value !== 'sub') return {}
              return { style: `vertical-align: ${value}` }
            },
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      setVerticalAlign:
        (value: 'super' | 'sub') =>
        ({ chain }) =>
          chain().setMark('textStyle', { verticalAlign: value }).run(),
      unsetVerticalAlign:
        () =>
        ({ chain }) =>
          chain().setMark('textStyle', { verticalAlign: null }).removeEmptyTextStyle().run(),
    }
  },
})

export default VerticalAlign