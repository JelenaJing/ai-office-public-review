export type DocumentEngineId = 'legacy-tiptap-bridge' | 'embedded-office-engine'

export type DocumentEngineKind = 'bridge' | 'embedded'

export type DocumentEngineStatus = 'active' | 'planned'

export interface DocumentEngineCapability {
  key: string
  label: string
  ready: boolean
}

export interface DocumentEngineDescriptor {
  id: DocumentEngineId
  label: string
  shortLabel: string
  kind: DocumentEngineKind
  status: DocumentEngineStatus
  description: string
  exchangeFormat: 'docx' | 'ooxml'
  capabilities: DocumentEngineCapability[]
}