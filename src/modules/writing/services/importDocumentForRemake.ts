import { plainTextToHtml } from '../../../utils/plainTextToHtml'
import type { KnowledgeImportResult } from '../../../types/knowledge'

export const DEFAULT_EDITOR_REWRITE_INSTRUCTION = '请先分析原文结构，在尽量保留结构框架和核心语义的前提下，按照当前文稿内容改写全文。'

async function waitForTabIdByName(getTabs: () => Array<{ id: string; fileName: string }>, fileName: string): Promise<string | null> {
  for (let index = 0; index < 20; index += 1) {
    const matched = getTabs().find((tab) => tab.fileName === fileName)
    if (matched) return matched.id
    await new Promise((resolve) => window.setTimeout(resolve, 50))
  }
  return null
}

interface ImportDocumentForRemakeParams {
  departmentId: string
  importDocuments: () => Promise<KnowledgeImportResult>
  openKnowledgeDocument: (documentId: string) => Promise<void>
  openTab: (filePath: string | null, fileName: string, content: string) => Promise<void>
  getTabs: () => Array<{ id: string; fileName: string }>
  setStatusMessage: (message: string) => void
}

export async function importDocumentForRemake({
  departmentId,
  importDocuments,
  openKnowledgeDocument,
  openTab,
  getTabs,
  setStatusMessage,
}: ImportDocumentForRemakeParams): Promise<boolean> {
  const result = await importDocuments()
  if (result.canceled) return false

  const preferredDocument = result.imported[0] || result.duplicates[0] || null
  if (preferredDocument?.id) {
    await openKnowledgeDocument(preferredDocument.id)
    const detail = await window.electronAPI.getKnowledgeDocument(departmentId, preferredDocument.id)
    const extractedText = String(detail?.extractedText || detail?.originalExtractedText || '').trim()
    if (!extractedText) {
      setStatusMessage(`已导入 ${preferredDocument.title}，但暂时没有可用于编辑的提取文本`)
      return false
    }

    const tabName = `${preferredDocument.title}-提取文本.md`
    await openTab(null, tabName, plainTextToHtml(extractedText))
    const targetTabId = await waitForTabIdByName(getTabs, tabName)
    window.dispatchEvent(new CustomEvent('ai-writer-trigger-rewrite', {
      detail: {
        targetTabId,
        instruction: DEFAULT_EDITOR_REWRITE_INSTRUCTION,
        autoRun: true,
      },
    }))

    setStatusMessage(
      result.imported[0]
        ? `已导入 ${preferredDocument.title}，并在主编辑器中启动 Remake`
        : `文档已存在，已在主编辑器中启动 Remake：${preferredDocument.title}`,
    )
    return true
  }

  if (result.failed[0]) {
    setStatusMessage(`导入失败：${result.failed[0].fileName} - ${result.failed[0].error}`)
  }
  return false
}