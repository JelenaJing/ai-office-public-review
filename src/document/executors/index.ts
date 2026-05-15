import type { RoutedManuscriptCommand } from '../commands'

export interface ManuscriptResolvedSelection {
  text: string
  from: number
  to: number
  posX: number
  posY: number
  anchorId?: string
}

export interface ManuscriptCompatExecutorDelegate {
  openComposer: (payload: {
    mode: 'document'
    instruction: string
    autoRun: boolean
    flow?: 'auto' | 'paper-generation' | 'assistant' | 'rewrite'
    targetTabId?: string
    selection: ManuscriptResolvedSelection | null
  }) => void
  resolveSelection: (command: RoutedManuscriptCommand) => ManuscriptResolvedSelection | null
  getCurrentSelectionText: () => string
  rewriteSelection: (selection: ManuscriptResolvedSelection) => void
  expandSelection: (selection: ManuscriptResolvedSelection) => void
  insertCitation: (selection: ManuscriptResolvedSelection) => Promise<void> | void
  continueWriting: (selectionText: string, selection?: ManuscriptResolvedSelection | null) => Promise<void> | void
  insertImage: (prompt: string) => Promise<void> | void
}

function hasSelection(selection: ManuscriptResolvedSelection | null): selection is ManuscriptResolvedSelection {
  return Boolean(selection && typeof selection.text === 'string')
}

export function getManuscriptExecutorIdForProfile(profile: string): string {
  return `compat:${profile || 'freewrite'}`
}

export async function executeRoutedManuscriptCommandWithExecutor(
  command: RoutedManuscriptCommand,
  executors: { compat: ManuscriptCompatExecutorDelegate },
): Promise<{ ok: true; message?: string } | { ok: false; error: string }> {
  const compat = executors.compat
  const selection = compat.resolveSelection(command)
  const selectionText = String(command.payload.selectionText || selection?.text || compat.getCurrentSelectionText() || '').trim()

  switch (command.adapterRoute) {
    case 'open_composer': {
      compat.openComposer({
        mode: 'document',
        instruction: String(command.payload.instruction || selectionText || '').trim(),
        autoRun: Boolean(command.payload.autoRun ?? true),
        flow: command.payload.flow === 'paper-generation' || command.payload.flow === 'assistant' || command.payload.flow === 'rewrite'
          ? command.payload.flow
          : 'assistant',
        targetTabId: typeof command.payload.targetTabId === 'string' ? String(command.payload.targetTabId).trim() || undefined : undefined,
        selection,
      })
      return { ok: true }
    }
    case 'rewrite_selection': {
      if (!hasSelection(selection) || !selection.text.trim()) {
        return { ok: false, error: '请先选中文本后再执行重写' }
      }
      compat.rewriteSelection(selection)
      return { ok: true }
    }
    case 'expand_selection': {
      if (!hasSelection(selection) || !selection.text.trim()) {
        return { ok: false, error: '请先选中文本后再执行扩写' }
      }
      compat.expandSelection(selection)
      return { ok: true }
    }
    case 'insert_citation': {
      if (!hasSelection(selection) || !selection.text.trim()) {
        return { ok: false, error: '请先选中文本后再插入文献' }
      }
      await compat.insertCitation(selection)
      return { ok: true }
    }
    case 'continue_writing': {
      const prompt = selectionText
      await compat.continueWriting(prompt, selection)
      return { ok: true }
    }
    case 'insert_image': {
      const prompt = selectionText || String(command.payload.instruction || '').trim()
      if (!prompt) {
        return { ok: false, error: '请先提供图片生成描述或选中文本' }
      }
      await compat.insertImage(prompt)
      return { ok: true }
    }
    default:
      return { ok: false, error: '未支持的编辑命令' }
  }
}