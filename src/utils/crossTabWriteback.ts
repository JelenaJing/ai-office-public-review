import { markdownToHtml } from './markdownToHtml'

export interface CrossTabTargetSelectionState {
  from: number
  to: number
  text?: string
  anchorId?: string
}

export interface CrossTabPendingImageInsertionState {
  requestId: string
  tabId: string
  src: string
  alt?: string
  title?: string
  placement: 'cursor' | 'after-selection' | 'document-end'
  widthPx?: number
  heightPx?: number
  selection: CrossTabTargetSelectionState | null
  statusMessage?: string
  createdAt: string
}

export type PaperStreamDecision =
  | { action: 'skip' }
  | { action: 'shell'; html: string }
  | { action: 'runtime'; html: string }

interface PaperStreamDecisionInput {
  activeTabId: string
  targetTabId: string
  markdown: string
  manualModified: boolean
}

interface PendingImageInsertionInput {
  tabId: string
  src: string
  alt?: string
  title?: string
  placement: 'cursor' | 'after-selection' | 'document-end'
  widthPx?: number
  heightPx?: number
  selection: CrossTabTargetSelectionState | null
  statusMessage?: string
  createdAt?: string
  requestId?: string
}

export function resolvePaperStreamSyncDecision(input: PaperStreamDecisionInput): PaperStreamDecision {
  if (input.activeTabId !== input.targetTabId) {
    if (input.manualModified) return { action: 'skip' }
    return { action: 'shell', html: markdownToHtml(input.markdown) }
  }
  if (input.manualModified) return { action: 'skip' }
  return { action: 'runtime', html: markdownToHtml(input.markdown) }
}

export function resolvePaperStreamCompletionDecision(input: Omit<PaperStreamDecisionInput, 'manualModified'>): Exclude<PaperStreamDecision, { action: 'skip' }> {
  if (input.activeTabId !== input.targetTabId) {
    return { action: 'shell', html: markdownToHtml(input.markdown) }
  }
  return { action: 'runtime', html: markdownToHtml(input.markdown) }
}

export function createPendingImageInsertionState(input: PendingImageInsertionInput): CrossTabPendingImageInsertionState {
  const createdAt = input.createdAt || new Date().toISOString()
  return {
    requestId: input.requestId || `pending-image:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    tabId: input.tabId,
    src: input.src,
    alt: input.alt,
    title: input.title,
    placement: input.placement,
    widthPx: input.widthPx,
    heightPx: input.heightPx,
    selection: input.selection,
    statusMessage: input.statusMessage,
    createdAt,
  }
}

export function shouldAutoApplyPendingImageInsertion(
  pendingImageInsertion: CrossTabPendingImageInsertionState | null | undefined,
  activeTabId: string,
  editorReady: boolean,
): boolean {
  return Boolean(pendingImageInsertion && editorReady && pendingImageInsertion.tabId === activeTabId)
}