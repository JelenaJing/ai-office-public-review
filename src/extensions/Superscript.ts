import { Mark, mergeAttributes } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    superscript: {
      setSuperscript: () => ReturnType
      unsetSuperscript: () => ReturnType
      toggleSuperscript: () => ReturnType
    }
  }
}

const Superscript = Mark.create({
  name: 'superscript',

  excludes: 'subscript',

  parseHTML() {
    return [
      { tag: 'sup' },
      { style: 'vertical-align', getAttrs: (value) => (value === 'super' ? {} : false) },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['sup', mergeAttributes(HTMLAttributes), 0]
  },

  addCommands() {
    return {
      setSuperscript:
        () =>
        ({ commands }) =>
          commands.setMark(this.name),
      unsetSuperscript:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
      toggleSuperscript:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-.': () => this.editor.commands.toggleSuperscript(),
    }
  },
})

export default Superscript
