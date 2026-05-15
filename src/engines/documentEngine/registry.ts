import type { DocumentEngineDescriptor, DocumentEngineId } from './types'

export const DEFAULT_DOCUMENT_ENGINE_ID: DocumentEngineId = 'legacy-tiptap-bridge'
export const DOCUMENT_ENGINE_STORAGE_KEY = 'ai_writer_document_engine'
// Bumped key name so prior "migrated to embedded" flag no longer short-circuits the new default.
export const DOCUMENT_ENGINE_MIGRATION_KEY = 'ai_writer_document_engine_migrated_to_tiptap_2026_04_21'

const documentEngines: Record<DocumentEngineId, DocumentEngineDescriptor> = {
  'legacy-tiptap-bridge': {
    id: 'legacy-tiptap-bridge',
    label: 'TipTap 文档引擎',
    shortLabel: 'TipTap',
    kind: 'bridge',
    status: 'active',
    description: 'AI-Office 3.0 主文档引擎。基于 TipTap/ProseMirror 的连续流式编辑体验，配合 OOXML data-* 透传在 Word 与编辑器之间实现无损往返。',
    exchangeFormat: 'docx',
    capabilities: [
      { key: 'workspace-editing', label: '工作区编辑与落盘', ready: true },
      { key: 'ai-generation', label: 'AI 生成链路', ready: true },
      { key: 'word-fidelity', label: 'Word/WPS 高保真兼容', ready: true },
    ],
  },
  'embedded-office-engine': {
    id: 'embedded-office-engine',
    label: '块式 Office 引擎（备用）',
    shortLabel: 'Embedded Office',
    kind: 'embedded',
    status: 'planned',
    description: '块式结构化编辑器，保留为备用/对照。主线已切换至 TipTap 引擎。',
    exchangeFormat: 'ooxml',
    capabilities: [
      { key: 'native-docx-layout', label: 'OOXML 布局保真', ready: true },
      { key: 'editable-export', label: '可编辑 DOCX 回写', ready: true },
      { key: 'local-embedded-runtime', label: '本地内置运行时', ready: true },
    ],
  },
}

export function listDocumentEngines(): DocumentEngineDescriptor[] {
  return Object.values(documentEngines)
}

export function getDocumentEngine(id: DocumentEngineId = DEFAULT_DOCUMENT_ENGINE_ID): DocumentEngineDescriptor {
  return documentEngines[id] ?? documentEngines[DEFAULT_DOCUMENT_ENGINE_ID]
}

export function resolveActiveDocumentEngineId(): DocumentEngineId {
  if (typeof window !== 'undefined') {
    const migrated = window.localStorage.getItem(DOCUMENT_ENGINE_MIGRATION_KEY) === 'true'
    if (!migrated) {
      // First run after switching default back to TipTap: force new default regardless of prior stored choice.
      window.localStorage.setItem(DOCUMENT_ENGINE_STORAGE_KEY, DEFAULT_DOCUMENT_ENGINE_ID)
      window.localStorage.setItem(DOCUMENT_ENGINE_MIGRATION_KEY, 'true')
      return DEFAULT_DOCUMENT_ENGINE_ID
    }
    const fromStorage = window.localStorage.getItem(DOCUMENT_ENGINE_STORAGE_KEY)
    if (fromStorage === 'legacy-tiptap-bridge' || fromStorage === 'embedded-office-engine') {
      return fromStorage
    }
    window.localStorage.setItem(DOCUMENT_ENGINE_STORAGE_KEY, DEFAULT_DOCUMENT_ENGINE_ID)
  }
  return DEFAULT_DOCUMENT_ENGINE_ID
}

export function getActiveDocumentEngine(): DocumentEngineDescriptor {
  return getDocumentEngine(resolveActiveDocumentEngineId())
}