import { Mark, mergeAttributes } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    subscript: {
      setSubscript: () => ReturnType
      unsetSubscript: () => ReturnType
      toggleSubscript: () => ReturnType
    }
  }
}

const Subscript = Mark.create({
  name: 'subscript',

  excludes: 'superscript',

  parseHTML() {
    return [
      { tag: 'sub' },
      { style: 'vertical-align', getAttrs: (value) => (value === 'sub' ? {} : false) },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['sub', mergeAttributes(HTMLAttributes), 0]
  },

  addCommands() {
    return {
      setSubscript:
        () =>
        ({ commands }) =>
          commands.setMark(this.name),
      unsetSubscript:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
      toggleSubscript:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-,': () => this.editor.commands.toggleSubscript(),
    }
  },
})

export default Subscript
