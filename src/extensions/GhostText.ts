import { Extension } from '@tiptap/core'

export const GhostText = Extension.create({
  name: 'ghostText',
  addOptions() {
    return {
      enabled: false,
      debounceMs: 400,
      contextChars: 2000,
      language: 'zh',
    }
  },
})

export function setGhostLanguage(_language?: string): void {
  // no-op compatibility shim
}