import type { Editor } from '@tiptap/react'

export interface ManuscriptSelectionAnchorRange {
  from: number
  to: number
  text: string
  anchorId?: string
}

function readTextAtRange(editor: Editor, from: number, to: number): string {
  try {
    return editor.state.doc.textBetween(from, to, ' ').trim()
  } catch {
    return ''
  }
}

export function resolveManuscriptSelectionAnchorToEditorRange(
  editor: Editor,
  _artifact: unknown,
  anchor: unknown,
): ManuscriptSelectionAnchorRange | null {
  if (!anchor || typeof anchor !== 'object') return null
  const candidate = anchor as Record<string, unknown>
  const anchorId = typeof candidate.anchorId === 'string'
    ? candidate.anchorId
    : typeof candidate.blockId === 'string'
      ? candidate.blockId
      : undefined

  const from = Number(candidate.from ?? candidate.start)
  const to = Number(candidate.to ?? candidate.end)
  if (Number.isFinite(from) && Number.isFinite(to) && to >= from) {
    return {
      from,
      to,
      text: readTextAtRange(editor, from, to),
      anchorId,
    }
  }

  const text = String(candidate.text || '').trim()
  if (!text) return null

  const fullText = editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n', '\n')
  const index = fullText.indexOf(text)
  if (index < 0) return null

  const approximateFrom = Math.max(0, index)
  const approximateTo = approximateFrom + text.length
  return {
    from: approximateFrom,
    to: approximateTo,
    text,
    anchorId,
  }
}