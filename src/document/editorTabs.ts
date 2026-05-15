import {
  createManuscriptTabState,
  projectManuscriptTabShellSnapshot,
  resolveManuscriptTabDirty,
  updateManuscriptTabState,
  type ManuscriptTabState,
  type UpdateManuscriptTabStateInput,
} from './manuscriptTabState'
import type { MailAttachmentSourceContext } from '../types/mailAttachment'

export type EditorTabPreview = {
  kind: 'pdf'
  source: string
  hint?: string
  actionLabel?: string
  externalFilePath?: string | null
} | {
  kind: 'frame'
  source?: string
  sourceDoc?: string
  hint?: string
  actionLabel?: string
  externalFilePath?: string | null
}

interface EditorTabBase {
  id: string
  filePath: string | null
  fileName: string
  preview?: EditorTabPreview
  sourceContext?: MailAttachmentSourceContext
  /** Stable unique ID independent of file name.
   *  Format: `local:<absolutePath>` | `mail:<msgId>:<attachmentName>` | `generated:<tabId>` */
  canonicalDocumentId?: string
}

interface LegacyEditorTabShellState {
  content: string
  savedContent: string
  dirty: boolean
}

interface ManuscriptEditorTabShellState {
  content: string
  savedContent: string
  dirty: boolean
}

export interface EditorTabProjectionSnapshot {
  content: string
  savedContent: string
  dirty: boolean
}

export interface UpdateEditorTabShellProjectionInput {
  content?: string
  savedContent?: string
  dirty?: boolean
  filePath?: string | null
  fileName?: string
  sourceContext?: MailAttachmentSourceContext
}

export interface MarkEditorTabShellSavedInput {
  filePath?: string | null
  fileName?: string
  content?: string
}

export type MarkEditorTabSavedProjectionInput = MarkEditorTabShellSavedInput

export interface LegacyEditorTab extends EditorTabBase, LegacyEditorTabShellState {
  tabKind: 'legacy'
  manuscriptState: null
}

export interface ManuscriptEditorTab extends EditorTabBase, ManuscriptEditorTabShellState {
  tabKind: 'manuscript'
  manuscriptState: ManuscriptTabState
}

export type EditorTab = LegacyEditorTab | ManuscriptEditorTab

interface CreateLegacyEditorTabInput extends EditorTabBase {
  content?: string
  savedContent?: string
  dirty?: boolean
}

export interface CreateManuscriptEditorTabInput extends EditorTabBase, UpdateManuscriptTabStateInput {}

export interface UpdateManuscriptEditorTabInput extends UpdateManuscriptTabStateInput {
  filePath?: string | null
  fileName?: string
  preview?: EditorTabPreview
  sourceContext?: MailAttachmentSourceContext
}

function buildManuscriptEditorTabFromState(
  base: EditorTabBase,
  manuscriptState: ManuscriptTabState,
): ManuscriptEditorTab {
  const shellSnapshot = projectManuscriptTabShellSnapshot(manuscriptState)
  return {
    ...base,
    tabKind: 'manuscript',
    manuscriptState,
    content: shellSnapshot.content,
    savedContent: shellSnapshot.savedContent,
    dirty: shellSnapshot.dirty,
  }
}

export function createLegacyEditorTab(input: CreateLegacyEditorTabInput): LegacyEditorTab {
  const content = String(input.content || '')
  const savedContent = input.savedContent !== undefined ? String(input.savedContent || '') : content
  return {
    id: input.id,
    filePath: input.filePath,
    fileName: input.fileName,
    preview: input.preview,
    sourceContext: input.sourceContext,
    canonicalDocumentId: input.canonicalDocumentId,
    tabKind: 'legacy',
    manuscriptState: null,
    content,
    savedContent,
    dirty: Boolean(input.dirty),
  }
}

export function createManuscriptEditorTab(input: CreateManuscriptEditorTabInput): ManuscriptEditorTab {
  const manuscriptState = createManuscriptTabState({
    ownerLabel: input.ownerLabel,
    currentArtifactKey: input.currentArtifactKey,
    acceptedArtifactKey: input.acceptedArtifactKey,
    currentCompatHtml: input.currentCompatHtml,
    acceptedCompatHtml: input.acceptedCompatHtml,
  })
  return buildManuscriptEditorTabFromState({
    id: input.id,
    filePath: input.filePath,
    fileName: input.fileName,
    preview: input.preview,
    sourceContext: input.sourceContext,
    canonicalDocumentId: input.canonicalDocumentId,
  }, manuscriptState)
}

export function updateManuscriptEditorTab(
  tab: ManuscriptEditorTab,
  input: UpdateManuscriptEditorTabInput,
): ManuscriptEditorTab {
  const manuscriptState = updateManuscriptTabState(tab.manuscriptState, input)
  return buildManuscriptEditorTabFromState({
    id: tab.id,
    filePath: input.filePath !== undefined ? input.filePath : tab.filePath,
    fileName: input.fileName ?? tab.fileName,
    preview: input.preview ?? tab.preview,
    sourceContext: input.sourceContext ?? tab.sourceContext,
    canonicalDocumentId: tab.canonicalDocumentId,
  }, manuscriptState)
}

export function isLegacyEditorTab(tab: EditorTab | null | undefined): tab is LegacyEditorTab {
  return Boolean(tab?.tabKind === 'legacy')
}

export function isManuscriptEditorTab(tab: EditorTab | null | undefined): tab is ManuscriptEditorTab {
  return Boolean(tab?.tabKind === 'manuscript' && tab.manuscriptState)
}

export function isWritableManuscriptEditorTab(tab: EditorTab | null | undefined): tab is ManuscriptEditorTab {
  return Boolean(isManuscriptEditorTab(tab) && !tab.preview)
}

export function getEditorTabShellProjectionSnapshot(tab: EditorTab | null | undefined): EditorTabProjectionSnapshot {
  if (!tab) {
    return {
      content: '',
      savedContent: '',
      dirty: false,
    }
  }
  if (isLegacyEditorTab(tab)) {
    return {
      content: tab.content,
      savedContent: tab.savedContent,
      dirty: tab.dirty,
    }
  }
  const shellSnapshot = projectManuscriptTabShellSnapshot(tab.manuscriptState)
  return {
    content: shellSnapshot.content,
    savedContent: shellSnapshot.savedContent,
    dirty: shellSnapshot.dirty,
  }
}

export function getEditorTabResolvedContent(tab: EditorTab | null | undefined): string {
  if (!tab) return ''
  if (isLegacyEditorTab(tab)) return tab.content
  return projectManuscriptTabShellSnapshot(tab.manuscriptState).content
}

export function getEditorTabResolvedSavedContent(tab: EditorTab | null | undefined): string {
  if (!tab) return ''
  if (isLegacyEditorTab(tab)) return tab.savedContent
  return projectManuscriptTabShellSnapshot(tab.manuscriptState).savedContent
}

export function getEditorTabResolvedDirty(tab: EditorTab | null | undefined): boolean {
  if (!tab) return false
  if (isLegacyEditorTab(tab)) return tab.dirty
  return resolveManuscriptTabDirty(tab.manuscriptState)
}

export function getEditorTabContent(tab: EditorTab | null | undefined): string {
  return getEditorTabResolvedContent(tab)
}

export function getEditorTabSavedContent(tab: EditorTab | null | undefined): string {
  return getEditorTabResolvedSavedContent(tab)
}

export function getEditorTabDirty(tab: EditorTab | null | undefined): boolean {
  return getEditorTabResolvedDirty(tab)
}

export function updateEditorTabShellProjection(
  tab: EditorTab,
  input: UpdateEditorTabShellProjectionInput,
): EditorTab {
  if (isLegacyEditorTab(tab)) {
    return {
      ...tab,
      filePath: input.filePath !== undefined ? input.filePath : tab.filePath,
      fileName: input.fileName ?? tab.fileName,
      sourceContext: input.sourceContext ?? tab.sourceContext,
      content: input.content ?? tab.content,
      savedContent: input.savedContent ?? tab.savedContent,
      dirty: input.dirty ?? tab.dirty,
    }
  }

  return updateManuscriptEditorTab(tab, {
    filePath: input.filePath,
    fileName: input.fileName,
    sourceContext: input.sourceContext,
    currentCompatHtml: input.content,
    acceptedCompatHtml: input.savedContent,
  })
}

export function setEditorTabShellContent(tab: EditorTab, content: string): EditorTab {
  return updateEditorTabShellProjection(tab, isLegacyEditorTab(tab)
    ? { content, dirty: true }
    : { content })
}

export function markEditorTabShellSaved(
  tab: EditorTab,
  input?: MarkEditorTabShellSavedInput,
): EditorTab {
  const projectedContent = input?.content ?? getEditorTabResolvedContent(tab)
  return updateEditorTabShellProjection(tab, {
    filePath: input?.filePath,
    fileName: input?.fileName,
    content: projectedContent,
    savedContent: projectedContent,
    dirty: false,
  })
}

export function updateEditorTabContentProjection(tab: EditorTab, content: string): EditorTab {
  return setEditorTabShellContent(tab, content)
}

export function markEditorTabSavedProjection(
  tab: EditorTab,
  input?: MarkEditorTabShellSavedInput,
): EditorTab {
  return markEditorTabShellSaved(tab, input)
}

export function isReusableEmptyManuscriptDraftTab(tab: EditorTab | null | undefined): tab is ManuscriptEditorTab {
  return Boolean(
    isWritableManuscriptEditorTab(tab)
    && !tab.filePath
    && !getEditorTabResolvedContent(tab).trim()
    && !getEditorTabResolvedDirty(tab),
  )
}
