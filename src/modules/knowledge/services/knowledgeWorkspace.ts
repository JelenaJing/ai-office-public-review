import type { MaterializeKnowledgeWorkspaceInput, MaterializeKnowledgeWorkspaceResult } from '../../../types/knowledge'

interface OpenKnowledgeWorkspaceParams extends MaterializeKnowledgeWorkspaceInput {
  departmentId: string
  openWorkspace: (workspacePath: string) => Promise<void>
  openDocumentPath: (filePath: string, options?: { isInternalOpen?: boolean }) => Promise<void>
  refreshTree?: () => Promise<void>
  setStatusMessage?: (value: string) => void
}

export function stripDocxExtension(value: string): string {
  return String(value || '').replace(/\.docx$/i, '').trim()
}

export async function openKnowledgeWorkspaceDraft(params: OpenKnowledgeWorkspaceParams): Promise<MaterializeKnowledgeWorkspaceResult> {
  const result = await window.electronAPI.materializeKnowledgeWorkspace(params.departmentId, {
    workspaceName: stripDocxExtension(params.workspaceName || params.fileName || ''),
    fileName: stripDocxExtension(params.fileName || params.workspaceName || ''),
    documentId: params.documentId,
    versionId: params.versionId,
    sourceDocumentIds: params.sourceDocumentIds,
    content: params.content,
  })
  await params.openWorkspace(result.workspacePath)
  await params.refreshTree?.()
  // materializeKnowledgeWorkspace saves as .aidoc.json — open it as an internal draft.
  await params.openDocumentPath(result.documentPath, { isInternalOpen: true })
  params.setStatusMessage?.(`已新建文章工作区：${result.name}`)
  return result
}