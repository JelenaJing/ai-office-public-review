import type { Editor } from '@tiptap/react'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { Selection } from '@tiptap/pm/state'
import type { DocumentEngineSelection } from './contracts'

export interface TiptapSelectionRange {
  from: number
  to: number
  empty: boolean
}

export function getTiptapRawSelection(editor: Editor | null): Selection | null {
  return editor?.state.selection || null
}

export function getTiptapSelectionRange(editor: Editor | null): TiptapSelectionRange | null {
  const selection = getTiptapRawSelection(editor)
  if (!selection) return null
  return {
    from: selection.from,
    to: selection.to,
    empty: selection.empty,
  }
}

export function readTiptapDocumentSelection(editor: Editor | null): DocumentEngineSelection | null {
  const selection = getTiptapSelectionRange(editor)
  if (!editor || !selection) return null

  return {
    from: selection.from,
    to: selection.to,
    text: !selection.empty ? editor.state.doc.textBetween(selection.from, selection.to, '\n').trim() : '',
    collapsed: selection.empty,
  }
}

export function getTiptapSelectionEdgePosition(editor: Editor | null, edge: 'from' | 'to' = 'from'): number | null {
  const selection = getTiptapSelectionRange(editor)
  if (!selection) return null
  return edge === 'to' ? selection.to : selection.from
}

export function getTiptapDocumentSize(editor: Editor | null): number {
  return editor?.state.doc.content.size || 0
}

export function getTiptapNodeAt(editor: Editor | null, position: number): ProseMirrorNode | null {
  if (!editor || position < 0) return null
  return editor.state.doc.nodeAt(position)
}

export function forEachTiptapDocNode(editor: Editor | null, visitor: (node: ProseMirrorNode, position: number) => void): void {
  if (!editor) return
  editor.state.doc.descendants((node, position) => {
    visitor(node, position)
  })
}
