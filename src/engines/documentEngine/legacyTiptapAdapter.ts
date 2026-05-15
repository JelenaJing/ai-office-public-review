import type { Editor } from '@tiptap/react'
import type {
  DocumentEngineCommentPayload,
  DocumentEngineContentPayload,
  DocumentEngineFormulaPayload,
  DocumentEngineImageAnchorPayload,
  DocumentEngineLoadRequest,
  DocumentEngineRuntime,
  DocumentEngineSaveRequest,
  DocumentEngineSaveResult,
  DocumentEngineSelection,
  DocumentEngineTextEditPayload,
} from './contracts'
import {
  forEachTiptapDocNode,
  getTiptapDocumentSize,
  getTiptapNodeAt,
  readTiptapDocumentSelection,
} from './tiptapSelectionQuery'
import { resolveCitationInsertionOffset } from '../../utils/citationGroups'

export function readLegacyTiptapSelection(editor: Editor | null): DocumentEngineSelection | null {
  return readTiptapDocumentSelection(editor)
}

interface LegacyTiptapAdapterDeps {
  editor: Editor | null
  loadDocument: (request: DocumentEngineLoadRequest) => Promise<void>
  saveDocument: (request?: DocumentEngineSaveRequest) => Promise<DocumentEngineSaveResult | null>
  setStatusMessage: (message: string) => void
}

type LegacyTextEditPlan =
  | { kind: 'append-inline-at-end'; text: string }
  | { kind: 'append-paragraph-at-end'; text: string }
  | { kind: 'append-at-end'; text: string }
  | { kind: 'replace-range'; text: string; range: DocumentEngineSelection }
  | { kind: 'append-after-range'; text: string; range: DocumentEngineSelection }

export function createLegacyTiptapRuntime({
  editor,
  loadDocument,
  saveDocument,
  setStatusMessage,
}: LegacyTiptapAdapterDeps): DocumentEngineRuntime {
  const insertContentAt = (position: number | { from: number; to: number }, value: string | Record<string, any> | Array<Record<string, any>>) => {
    if (!editor) return
    editor.chain().focus().insertContentAt(position, value, { updateSelection: true }).run()
  }

  const normalizeTextEditText = (text: string) => String(text || '').replace(/\r\n/g, '\n')

  const getDocumentEndPosition = () => getTiptapDocumentSize(editor)

  const getBlockAppendPosition = () => {
    if (!editor) return getDocumentEndPosition()
    let lastBlockPos = -1
    let lastBlockSize = 0
    forEachTiptapDocNode(editor, (node, pos) => {
      if (!node.isBlock) return
      lastBlockPos = pos
      lastBlockSize = node.nodeSize
    })
    return lastBlockPos >= 0 ? lastBlockPos + lastBlockSize : getDocumentEndPosition()
  }

  const resolveTextEditRange = (payload: DocumentEngineTextEditPayload) => payload.range || readLegacyTiptapSelection(editor)

  const buildTextEditPlan = (payload: DocumentEngineTextEditPayload): LegacyTextEditPlan | null => {
    if (!editor || !payload.text) return null

    const text = normalizeTextEditText(payload.text)
    if (!text) return null

    if (payload.mode === 'append-inline-at-end') {
      return { kind: 'append-inline-at-end', text }
    }

    if (payload.mode === 'append-paragraph-at-end') {
      return { kind: 'append-paragraph-at-end', text }
    }

    if (payload.mode === 'append-at-end') {
      return { kind: 'append-at-end', text }
    }

    const range = resolveTextEditRange(payload)
    if (!range) return null

    if (payload.mode === 'replace-range') {
      return { kind: 'replace-range', text, range }
    }

    return { kind: 'append-after-range', text, range }
  }

  const applyTextEditPlan = (plan: LegacyTextEditPlan) => {
    switch (plan.kind) {
      case 'append-inline-at-end':
        appendInlineTextAtEnd(plan.text)
        return
      case 'append-paragraph-at-end':
        appendParagraphTextAtEnd(plan.text)
        return
      case 'append-at-end':
        insertContentAt(getDocumentEndPosition(), plan.text)
        return
      case 'replace-range':
        insertContentAt({ from: plan.range.from, to: plan.range.to }, plan.text)
        return
      case 'append-after-range':
        insertContentAt(plan.range.to, plan.text)
        return
    }
  }

  const buildInlineNodes = (text: string) => {
    const normalized = normalizeTextEditText(text)
    const parts = normalized.split('\n')
    const nodes: Array<Record<string, any>> = []
    parts.forEach((part, index) => {
      if (part) {
        nodes.push({ type: 'text', text: part })
      }
      if (index < parts.length - 1) {
        nodes.push({ type: 'hardBreak' })
      }
    })
    return nodes
  }

  const appendInlineTextAtEnd = (text: string) => {
    if (!editor || !text) return

    const normalized = normalizeTextEditText(text)
    const blocks = normalized.split(/\n{2,}/)

    const appendToLastParagraph = (value: string) => {
      let lastParagraphPos = -1
      let lastParagraphSize = 0
      forEachTiptapDocNode(editor, (node, pos) => {
        if (node.type.name === 'paragraph') {
          lastParagraphPos = pos
          lastParagraphSize = node.nodeSize
        }
      })

      const inlineNodes = buildInlineNodes(value)
      if (inlineNodes.length === 0) return

      if (lastParagraphPos >= 0) {
        insertContentAt(lastParagraphPos + lastParagraphSize - 1, inlineNodes)
        return
      }

      insertContentAt(getDocumentEndPosition(), { type: 'paragraph', content: inlineNodes })
    }

    const appendAsNewParagraph = (value: string) => {
      const inlineNodes = buildInlineNodes(value)
      insertContentAt(getBlockAppendPosition(), { type: 'paragraph', content: inlineNodes.length > 0 ? inlineNodes : undefined })
    }

    blocks.forEach((block, index) => {
      if (index === 0) {
        appendToLastParagraph(block)
        return
      }
      appendAsNewParagraph(block)
    })
  }

  const appendParagraphTextAtEnd = (text: string) => {
    if (!editor || !text) return

    const normalized = normalizeTextEditText(text)
    const blocks = normalized.split(/\n{2,}/)

    blocks.forEach((block) => {
      const inlineNodes = buildInlineNodes(block)
      insertContentAt(getBlockAppendPosition(), {
        type: 'paragraph',
        content: inlineNodes.length > 0 ? inlineNodes : undefined,
      })
    })
  }

  const applyTextEdit = (payload: DocumentEngineTextEditPayload) => {
    const plan = buildTextEditPlan(payload)
    if (!plan) return
    applyTextEditPlan(plan)
  }

  const setDocumentContent = (content: DocumentEngineContentPayload) => {
    if (!editor) return
    // Safety guard: if the content is a raw aidoc JSON string, unwrap and use the html field
    if (typeof content === 'string' && content.trimStart().startsWith('{"version":1,"format":"aidoc"')) {
      try {
        const parsed = JSON.parse(content) as { format?: string; html?: string; tiptapJson?: unknown }
        if (parsed.format === 'aidoc') {
          if (parsed.tiptapJson) {
            editor.commands.setContent(parsed.tiptapJson as any, false)
          } else {
            editor.commands.setContent(parsed.html || '<p></p>', false)
          }
          return
        }
      } catch { /* malformed — fall through to normal set */ }
    }
    editor.commands.setContent(content as any, false)
  }

  return {
    engineId: 'legacy-tiptap-bridge',
    getSelection: () => readLegacyTiptapSelection(editor),
    loadDocument,
    saveDocument,
    setDocumentContent,
    applyTextEdit,
    insertComment: (payload: DocumentEngineCommentPayload) => {
      if (!editor || !payload.body.trim()) return
      let insertAt = payload.range.to
      if (payload.kind === 'citation') {
        try {
          const safeTo = Math.max(0, Math.min(payload.range.to, getDocumentEndPosition()))
          const resolved = editor.state.doc.resolve(safeTo)
          const parent = resolved.parent
          const blockText = parent.textBetween(0, parent.content.size, '\n', '\n')
          const insertionOffset = resolveCitationInsertionOffset(blockText, resolved.parentOffset)
          insertAt = resolved.start() + insertionOffset
        } catch {
          insertAt = payload.range.to
        }
      }
      insertContentAt(insertAt, [
        { type: 'text', text: ' ' },
        { type: 'text', text: payload.body.trim(), marks: [{ type: 'superscript' }] },
      ])
      setStatusMessage(payload.kind === 'citation' ? '已通过引擎接口插入引用' : '已通过引擎接口插入批注')
    },
    upsertFormula: (payload: DocumentEngineFormulaPayload) => {
      if (!editor || !payload.latex.trim()) return
      const nodeType = payload.displayMode === 'block' ? 'blockFormula' : 'inlineFormula'

      if (typeof payload.editPos === 'number') {
        const node = getTiptapNodeAt(editor, payload.editPos)
        const nodeSize = node?.nodeSize || 1
        insertContentAt({ from: payload.editPos, to: payload.editPos + nodeSize }, { type: nodeType, attrs: { latex: payload.latex.trim() } })
      } else {
        insertContentAt(readLegacyTiptapSelection(editor)?.to ?? getDocumentEndPosition(), { type: nodeType, attrs: { latex: payload.latex.trim() } })
      }
    },
    insertAnchoredImage: (payload: DocumentEngineImageAnchorPayload) => {
      if (!editor || !payload.src.trim()) return
      const selection = readLegacyTiptapSelection(editor)
      const insertPos = payload.placement === 'document-end'
        ? getDocumentEndPosition()
        : payload.placement === 'after-selection'
          ? (selection?.to ?? getDocumentEndPosition())
          : (selection?.from ?? getDocumentEndPosition())
      insertContentAt(insertPos, {
        type: 'image',
        attrs: {
          src: payload.src.trim(),
          alt: payload.alt,
          title: payload.title,
          width: payload.widthPx,
          height: payload.heightPx,
        },
      })
      setStatusMessage('已通过引擎接口插入锚定图片')
    },
  }
}