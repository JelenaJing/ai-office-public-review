import type {
  CapabilityCatalog,
  CapabilityCatalogEntry,
  CapabilityId,
  ImplementationStatus,
  InvokeBatch,
  SkillCallablePolicy,
} from './capabilityTypes'

function entry(
  id: CapabilityId,
  opts: {
    layer: CapabilityCatalogEntry['layer']
    implementationStatus: ImplementationStatus
    displayName: string
    description: string
    consumesTokens: boolean
    skillCallable: SkillCallablePolicy
    invokeBatch: InvokeBatch
    invokeEnabled: boolean
    wrapper?: CapabilityCatalogEntry['wrapper']
    notes?: string
    replaces?: CapabilityCatalogEntry['replaces']
  },
): CapabilityCatalogEntry {
  return {
    id,
    version: '1',
    layer: opts.layer,
    implementationStatus: opts.implementationStatus,
    displayName: opts.displayName,
    description: opts.description,
    consumesTokens: opts.consumesTokens,
    skillCallable: opts.skillCallable,
    invokeBatch: opts.invokeBatch,
    invokeEnabled: opts.invokeEnabled,
    wrapper: opts.wrapper,
    notes: opts.notes,
    replaces: opts.replaces,
  }
}

const CAPABILITY_CATALOG_ENTRIES: CapabilityCatalogEntry[] = [
  // —— 通用 Primitive ——
  entry('llm.generate', {
    layer: 'primitive',
    implementationStatus: 'wrapper',
    displayName: 'LLM 文本生成',
    description: '调用已配置 LLM 生成自然语言',
    consumesTokens: true,
    skillCallable: 'allowed',
    invokeBatch: 'none',
    invokeEnabled: false,
    wrapper: { transport: 'in-process', target: 'llmClient.completeText' },
  }),
  entry('llm.generateJson', {
    layer: 'primitive',
    implementationStatus: 'planned',
    displayName: 'LLM 结构化 JSON 生成',
    description: '生成并解析 JSON 结构化输出',
    consumesTokens: true,
    skillCallable: 'allowed',
    invokeBatch: 'none',
    invokeEnabled: false,
  }),
  entry('knowledge.retrieve', {
    layer: 'primitive',
    implementationStatus: 'wrapper',
    displayName: '知识库检索',
    description: '按任务约束检索知识库分块',
    consumesTokens: false,
    skillCallable: 'allowed',
    invokeBatch: 'none',
    invokeEnabled: false,
    wrapper: { transport: 'ipc', target: 'knowledge:retrieveChunks' },
  }),
  entry('workspace.readFile', {
    layer: 'primitive',
    implementationStatus: 'wrapper',
    displayName: '读取工作区文件',
    description: '读取工作区相对路径文件',
    consumesTokens: false,
    skillCallable: 'allowed',
    invokeBatch: 'none',
    invokeEnabled: false,
    wrapper: { transport: 'ipc', target: 'workspace:tree' },
  }),
  entry('workspace.writeFile', {
    layer: 'primitive',
    implementationStatus: 'wrapper',
    displayName: '写入工作区文件',
    description: '写入或覆盖工作区相对路径文件',
    consumesTokens: false,
    skillCallable: 'allowed',
    invokeBatch: 'none',
    invokeEnabled: false,
    wrapper: { transport: 'ipc', target: 'workspace:writeFile' },
  }),
  entry('workspace.copyFile', {
    layer: 'primitive',
    implementationStatus: 'wrapper',
    displayName: '复制工作区文件',
    description: '在工作区内复制文件或目录',
    consumesTokens: false,
    skillCallable: 'allowed',
    invokeBatch: 'none',
    invokeEnabled: false,
    wrapper: { transport: 'ipc', target: 'workspace:copyPath' },
  }),

  // —— Runtime ——
  entry('runtime.reportProgress', {
    layer: 'runtime',
    implementationStatus: 'wrapper',
    displayName: '上报任务进度',
    description: '向 UI / 任务中心上报步骤进度',
    consumesTokens: false,
    skillCallable: 'allowed',
    invokeBatch: 'none',
    invokeEnabled: false,
    wrapper: { transport: 'in-process', target: 'localTaskService' },
  }),
  entry('runtime.writeLog', {
    layer: 'runtime',
    implementationStatus: 'restricted',
    displayName: '写入审计日志',
    description: '写入用户行为 / 任务审计日志',
    consumesTokens: false,
    skillCallable: 'workflow-only',
    invokeBatch: 'none',
    invokeEnabled: false,
    wrapper: { transport: 'in-process', target: 'userActionLogService.appendAction' },
    notes: 'Template Skill 不得声明；仅 Workflow / Agent 场景',
  }),

  // —— Document Primitive ——
  entry('document.create', {
    layer: 'primitive',
    implementationStatus: 'wrapper',
    displayName: '创建文档',
    description: '在工作区创建 DocumentSchema 文档',
    consumesTokens: false,
    skillCallable: 'allowed',
    invokeBatch: 'none',
    invokeEnabled: false,
    wrapper: { transport: 'ipc', target: 'workspace:createBlankDocument' },
  }),
  entry('document.load', {
    layer: 'primitive',
    implementationStatus: 'wrapper',
    displayName: '加载文档',
    description: '加载工作区 document.json',
    consumesTokens: false,
    skillCallable: 'allowed',
    invokeBatch: 'none',
    invokeEnabled: false,
    wrapper: { transport: 'ipc', target: 'workspace:readDocumentSchema' },
  }),
  entry('document.save', {
    layer: 'primitive',
    implementationStatus: 'wrapper',
    displayName: '保存文档',
    description: '持久化 DocumentSchema',
    consumesTokens: false,
    skillCallable: 'allowed',
    invokeBatch: 'none',
    invokeEnabled: false,
    wrapper: { transport: 'ipc', target: 'workspace:saveDocumentSchema' },
  }),
  entry('document.applyPatch', {
    layer: 'primitive',
    implementationStatus: 'planned',
    displayName: '文档块级补丁',
    description: '对 DocumentSchema 应用块级 patches',
    consumesTokens: false,
    skillCallable: 'allowed',
    invokeBatch: 'none',
    invokeEnabled: false,
    notes: '暂缓 invoke；契约已定义',
  }),
  entry('document.renderPreview', {
    layer: 'primitive',
    implementationStatus: 'planned',
    displayName: '文档预览',
    description: '生成文档 HTML / 快照预览',
    consumesTokens: false,
    skillCallable: 'allowed',
    invokeBatch: 'none',
    invokeEnabled: false,
  }),

  // —— DOCX Adapter ——
  entry('docx.readPackage', {
    layer: 'adapter',
    implementationStatus: 'wrapper',
    displayName: '读取 DOCX 包',
    description: '读取 OOXML 包快照',
    consumesTokens: false,
    skillCallable: 'allowed',
    invokeBatch: 'none',
    invokeEnabled: false,
    wrapper: { transport: 'ipc', target: 'documentEngine:readOoxmlPackage' },
  }),
  entry('docx.importTemplate', {
    layer: 'adapter',
    implementationStatus: 'planned',
    displayName: '导入 DOCX 模板',
    description: '从 DOCX 导入模板结构到 DocumentSchema',
    consumesTokens: false,
    skillCallable: 'allowed',
    invokeBatch: 'none',
    invokeEnabled: false,
  }),
  entry('docx.extractFields', {
    layer: 'adapter',
    implementationStatus: 'planned',
    displayName: '提取模板字段',
    description: '从模板 DOCX 提取可填字段',
    consumesTokens: false,
    skillCallable: 'allowed',
    invokeBatch: 'none',
    invokeEnabled: false,
    wrapper: { transport: 'ipc', target: 'formalTemplate:analyze' },
  }),
  entry('docx.writeback', {
    layer: 'adapter',
    implementationStatus: 'planned',
    displayName: 'DOCX 模板回写',
    description: '按规则将编辑结果回写到 OOXML 模板',
    consumesTokens: false,
    skillCallable: 'allowed',
    invokeBatch: 'none',
    invokeEnabled: false,
    notes: '暂缓 invoke',
  }),
  entry('docx.export', {
    layer: 'adapter',
    implementationStatus: 'wrapper',
    displayName: '导出 DOCX',
    description: '导出 DOCX 文件',
    consumesTokens: false,
    skillCallable: 'allowed',
    invokeBatch: 'none',
    invokeEnabled: false,
    wrapper: { transport: 'in-process', target: 'journalDocxExporter.exportWithJournalFormat' },
  }),

  // —— PDF Adapter ——
  entry('pdf.export', {
    layer: 'adapter',
    implementationStatus: 'wrapper',
    displayName: '导出 PDF',
    description: '从 Markdown / 编辑器 HTML 导出 PDF',
    consumesTokens: false,
    skillCallable: 'allowed',
    invokeBatch: 'none',
    invokeEnabled: false,
    wrapper: { transport: 'ipc', target: 'ai:exportPdf' },
  }),

  // —— Deck Primitive ——
  entry('deck.create', {
    layer: 'primitive',
    implementationStatus: 'wrapper',
    displayName: '创建 Deck',
    description: '创建空 DeckDocument',
    consumesTokens: false,
    skillCallable: 'allowed',
    invokeBatch: 'none',
    invokeEnabled: false,
  }),
  entry('deck.load', {
    layer: 'primitive',
    implementationStatus: 'wrapper',
    displayName: '加载 Deck',
    description: '从 deck.json 加载 DeckDocument',
    consumesTokens: false,
    skillCallable: 'allowed',
    invokeBatch: 'batch-1-deck',
    invokeEnabled: true,
    wrapper: { transport: 'in-process', target: 'deckDocumentService.loadDeckDocument', responseMap: 'capabilityResult.v1' },
  }),
  entry('deck.save', {
    layer: 'primitive',
    implementationStatus: 'wrapper',
    displayName: '保存 Deck',
    description: '持久化 DeckDocument 到 deck.json',
    consumesTokens: false,
    skillCallable: 'allowed',
    invokeBatch: 'batch-1-deck',
    invokeEnabled: true,
    wrapper: { transport: 'in-process', target: 'deckDocumentService.saveDeckDocument', responseMap: 'capabilityResult.v1' },
  }),
  entry('deck.applyPatch', {
    layer: 'primitive',
    implementationStatus: 'planned',
    displayName: 'Deck 幻灯片补丁',
    description: '更新幻灯片槽位或批量 patches',
    consumesTokens: false,
    skillCallable: 'allowed',
    invokeBatch: 'none',
    invokeEnabled: false,
    wrapper: { transport: 'ipc', target: 'deck:updateSlide' },
  }),
  entry('deck.render', {
    layer: 'primitive',
    implementationStatus: 'wrapper',
    displayName: '渲染 Deck 为 PPTX',
    description: '将 DeckDocument 渲染为 PPTX 文件',
    consumesTokens: false,
    skillCallable: 'allowed',
    invokeBatch: 'batch-1-deck',
    invokeEnabled: true,
    wrapper: { transport: 'in-process', target: 'deckDocumentService.renderDeckDocument', responseMap: 'capabilityResult.v1' },
  }),
  entry('deck.preview', {
    layer: 'primitive',
    implementationStatus: 'wrapper',
    displayName: 'PPTX 幻灯片预览',
    description: '生成幻灯片缩略图 PNG',
    consumesTokens: false,
    skillCallable: 'allowed',
    invokeBatch: 'batch-1-deck',
    invokeEnabled: true,
    wrapper: { transport: 'in-process', target: 'pptxPreviewService.renderPptxPreview', responseMap: 'capabilityResult.v1' },
  }),

  // —— PPTX Adapter ——
  entry('pptx.extract', {
    layer: 'adapter',
    implementationStatus: 'wrapper',
    displayName: '提取 PPTX 结构',
    description: '从 PPTX 提取结构与文本',
    consumesTokens: false,
    skillCallable: 'allowed',
    invokeBatch: 'none',
    invokeEnabled: false,
    wrapper: { transport: 'ipc', target: 'deck:extractPptx' },
  }),
  entry('pptx.import', {
    layer: 'adapter',
    implementationStatus: 'restricted',
    displayName: 'PPTX 一站式导入',
    description: '将 PPTX 导入为 DeckDocument（便捷 adapter）',
    consumesTokens: false,
    skillCallable: 'forbidden',
    invokeBatch: 'none',
    invokeEnabled: false,
    notes: '仅 Agent / 平台内置 Workflow 可调用；普通 Skill 不得声明于 requiredCapabilities',
  }),

  // —— Template Registry ——
  entry('deckTemplate.list', {
    layer: 'registry',
    implementationStatus: 'wrapper',
    displayName: '列出 PPT 模板',
    description: '列出可用 deck 模板 manifest',
    consumesTokens: false,
    skillCallable: 'allowed',
    invokeBatch: 'batch-1-deck',
    invokeEnabled: true,
    wrapper: { transport: 'in-process', target: 'pptTemplateRegistry.listPptTemplates', responseMap: 'capabilityResult.v1' },
  }),
  entry('deckTemplate.validate', {
    layer: 'registry',
    implementationStatus: 'planned',
    displayName: '校验 PPT 模板',
    description: '校验 deck 模板与 slot-rules',
    consumesTokens: false,
    skillCallable: 'allowed',
    invokeBatch: 'none',
    invokeEnabled: false,
  }),
  entry('documentTemplate.list', {
    layer: 'registry',
    implementationStatus: 'planned',
    displayName: '列出文稿模板',
    description: '列出可用 document 模板 manifest',
    consumesTokens: false,
    skillCallable: 'allowed',
    invokeBatch: 'none',
    invokeEnabled: false,
  }),
  entry('documentTemplate.validate', {
    layer: 'registry',
    implementationStatus: 'planned',
    displayName: '校验文稿模板',
    description: '校验字段 schema 与 writeback 规则',
    consumesTokens: false,
    skillCallable: 'allowed',
    invokeBatch: 'none',
    invokeEnabled: false,
    notes: '暂缓 invoke',
  }),
]

export const CAPABILITY_CATALOG: CapabilityCatalog = {
  schemaVersion: 'ai-office-capability-catalog-v1',
  entries: CAPABILITY_CATALOG_ENTRIES,
}

const CATALOG_BY_ID = new Map<CapabilityId, CapabilityCatalogEntry>(
  CAPABILITY_CATALOG_ENTRIES.map((e) => [e.id, e]),
)

export function getCatalogEntry(id: string): CapabilityCatalogEntry | undefined {
  return CATALOG_BY_ID.get(id as CapabilityId)
}

export interface ListCatalogEntriesFilter {
  layer?: CapabilityCatalogEntry['layer']
  implementationStatus?: ImplementationStatus
  invokeEnabled?: boolean
  invokeBatch?: InvokeBatch
}

export function listCatalogEntries(filter?: ListCatalogEntriesFilter): CapabilityCatalogEntry[] {
  let rows = [...CAPABILITY_CATALOG_ENTRIES]
  if (!filter) return rows
  if (filter.layer) rows = rows.filter((r) => r.layer === filter.layer)
  if (filter.implementationStatus) {
    rows = rows.filter((r) => r.implementationStatus === filter.implementationStatus)
  }
  if (filter.invokeEnabled !== undefined) {
    rows = rows.filter((r) => r.invokeEnabled === filter.invokeEnabled)
  }
  if (filter.invokeBatch) rows = rows.filter((r) => r.invokeBatch === filter.invokeBatch)
  return rows
}
