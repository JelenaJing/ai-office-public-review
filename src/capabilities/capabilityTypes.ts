export type CapabilityLayer = 'primitive' | 'adapter' | 'runtime' | 'registry'

export type ImplementationStatus =
  | 'stable'
  | 'wrapper'
  | 'planned'
  | 'restricted'
  | 'deprecated'

export type SkillCallablePolicy = 'allowed' | 'workflow-only' | 'forbidden'

export type InvokeBatch = 'none' | 'batch-1-deck' | 'batch-2-document' | 'future'

export type SkillKind = 'template' | 'workflow' | 'style' | 'adapter'

export type CallerType = 'skill' | 'agent' | 'ui'

/** v0.3 全量 Core Capability id（不含 Agent Action 字符串） */
export type CapabilityId =
  | 'llm.generate'
  | 'llm.generateJson'
  | 'knowledge.retrieve'
  | 'workspace.readFile'
  | 'workspace.writeFile'
  | 'workspace.copyFile'
  | 'runtime.reportProgress'
  | 'runtime.writeLog'
  | 'document.create'
  | 'document.load'
  | 'document.save'
  | 'document.applyPatch'
  | 'document.renderPreview'
  | 'docx.readPackage'
  | 'docx.importTemplate'
  | 'docx.extractFields'
  | 'docx.writeback'
  | 'docx.export'
  | 'pdf.export'
  | 'deck.create'
  | 'deck.load'
  | 'deck.save'
  | 'deck.applyPatch'
  | 'deck.render'
  | 'deck.preview'
  | 'pptx.extract'
  | 'pptx.import'
  | 'deckTemplate.list'
  | 'deckTemplate.validate'
  | 'documentTemplate.list'
  | 'documentTemplate.validate'

export const CAPABILITY_IDS = [
  'llm.generate',
  'llm.generateJson',
  'knowledge.retrieve',
  'workspace.readFile',
  'workspace.writeFile',
  'workspace.copyFile',
  'runtime.reportProgress',
  'runtime.writeLog',
  'document.create',
  'document.load',
  'document.save',
  'document.applyPatch',
  'document.renderPreview',
  'docx.readPackage',
  'docx.importTemplate',
  'docx.extractFields',
  'docx.writeback',
  'docx.export',
  'pdf.export',
  'deck.create',
  'deck.load',
  'deck.save',
  'deck.applyPatch',
  'deck.render',
  'deck.preview',
  'pptx.extract',
  'pptx.import',
  'deckTemplate.list',
  'deckTemplate.validate',
  'documentTemplate.list',
  'documentTemplate.validate',
] as const satisfies readonly CapabilityId[]

export interface CapabilityError {
  code: string
  message: string
  detail?: Record<string, unknown>
}

export interface CapabilityCost {
  llmCalls: number
  imageCalls: number
  tokenEstimate?: number
}

export interface CapabilityResult<T = unknown> {
  ok: boolean
  data: T
  error?: CapabilityError
  cost?: CapabilityCost
}

export interface CapabilityWrapperRef {
  transport: 'ipc' | 'in-process'
  target: string
  requestMap?: string
  responseMap?: string
}

export interface CapabilityCatalogEntry {
  id: CapabilityId
  version: string
  layer: CapabilityLayer
  implementationStatus: ImplementationStatus
  displayName: string
  description: string
  consumesTokens: boolean
  skillCallable: SkillCallablePolicy
  invokeBatch: InvokeBatch
  invokeEnabled: boolean
  wrapper?: CapabilityWrapperRef
  replaces?: CapabilityId[]
  notes?: string
}

export interface CapabilityCatalog {
  schemaVersion: 'ai-office-capability-catalog-v1'
  entries: CapabilityCatalogEntry[]
}

export interface ValidateManifestCapabilitiesInput {
  requiredCapabilities: string[]
  skillKind: SkillKind
  callerType: CallerType
}

export interface ManifestCapabilityIssue {
  capability: string
  code: string
  message: string
}

export interface ValidateManifestCapabilitiesResult {
  ok: boolean
  errors: ManifestCapabilityIssue[]
  warnings: ManifestCapabilityIssue[]
}

export interface CapabilityInvokeCaller {
  type: CallerType
  id: string
  skillManifestId?: string
}

export interface CapabilityInvokeRequest {
  capability: string
  workspaceId?: string
  params: Record<string, unknown>
  caller: CapabilityInvokeCaller
}

/** 非 Capability id 的 Agent Action 名称（manifest 中应拒绝） */
export const AGENT_ACTION_DENYLIST = [
  'exportDeckToUserPath',
  'saveManuscript',
  'importPptxAsNewDeck',
  'buildDeckFromManuscript',
  'registerWorkspace',
] as const

export const ZERO_DECK_COST: CapabilityCost = {
  llmCalls: 0,
  imageCalls: 0,
  tokenEstimate: 0,
}
