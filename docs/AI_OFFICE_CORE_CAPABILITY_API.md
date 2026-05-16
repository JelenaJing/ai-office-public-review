# AI Office Core Capability API（第一版）

> 版本：v0.1（设计稿）  
> 适用范围：`ai_writer3.0-public`  
> 关联文档：[AI_OFFICE_SKILL_BOUNDARY_DESIGN.md](./AI_OFFICE_SKILL_BOUNDARY_DESIGN.md)

---

## 1. 设计原则

### 1.1 Core Capability 是什么

**Core Capability** 是 AI Office **本体提供的稳定执行 API**。特征：

- 由 Electron 主进程或受信宿主服务实现（非 Skill 包内代码）
- 输入 / 输出契约固定，版本化（`capability-v1`）
- 统一返回 `CapabilityResult`（见 §2）
- 可记录 token 消耗、审计日志、权限校验

### 1.2 Agent 只负责任务编排

Agent 层职责：

- 解析用户意图，选择 Skill（读 `manifest.json`）
- 按 `workflow.steps` 或对话策略调用 Core Capability
- 聚合多步结果、向用户汇报进度与失败
- **不**内嵌 DOCX/PPTX/LLM 实现

典型 Agent 落点：`src/modules/writing/`、`src/modules/generation/`、`src/modules/email/`、未来独立 Agent 运行时。

### 1.3 Skill 只声明模板、流程、风格、规则

Skill 通过 `manifest.json` 的 `requiredCapabilities` 声明依赖；**不**实现 Capability 本体。运行时通过 `host.call(capabilityId, params)` 派发。

### 1.4 真正执行由 Core Capability 提供

所有副作用（写文件、调模型、渲染 PPT、检索知识库）必须经过 Capability 网关，便于：

- 统一计费（`cost` 字段）
- 统一权限（`permissions`）
- 统一错误码

---

## 2. 统一返回格式

所有 Capability 返回 **同一信封结构**（设计目标；当前 IPC 层部分仍为遗留形状，迁移时对齐本契约）。

```json
{
  "ok": true,
  "data": {},
  "error": {
    "code": "string",
    "message": "string",
    "detail": {}
  },
  "cost": {
    "llmCalls": 0,
    "imageCalls": 0,
    "tokenEstimate": 0
  }
}
```

| 字段 | 说明 |
|------|------|
| `ok` | `true` 表示业务成功；`false` 时 `data` 可为空对象 |
| `data` | 各 Capability 定义的载荷 |
| `error` | 失败时必填；`code` 为机器可读错误码 |
| `cost` | 可选；LLM / 图像调用统计，供配额与审计 |

### 2.1 通用错误码（建议）

| code | 含义 |
|------|------|
| `CAPABILITY_NOT_FOUND` | 未知 capability id |
| `PERMISSION_DENIED` | Skill / 用户无权限 |
| `INVALID_INPUT` | 参数校验失败 |
| `WORKSPACE_NOT_FOUND` | 工作区路径无效 |
| `RESOURCE_NOT_FOUND` | 文档 / deck / 文件不存在 |
| `ENGINE_ERROR` | 底层引擎异常 |
| `LLM_UNAVAILABLE` | 模型未配置或调用失败 |
| `TIMEOUT` | 操作超时 |
| `CANCELLED` | 用户取消 |

### 2.2 Skill 调用权限标记

| 标记 | 含义 |
|------|------|
| **允许** | 普通 Template / Workflow / Style Skill 可通过 `host.call` 调用 |
| **受限** | 仅 Agent 或平台内置模块可调用 |
| **禁止** | 不对 Skill 开放（仅 UI / 系统服务） |

---

## 3. 通用能力（General）

### 3.1 `llm.generate`

| 项 | 说明 |
|----|------|
| **名称** | `llm.generate` |
| **描述** | 调用已配置的 LLM 提供方生成自然语言文本 |
| **输入** | `{ systemPrompt: string, userPrompt: string, temperature?: number, maxTokens?: number, images?: { base64, mediaType }[], featureName?: string }` |
| **输出** | `{ text: string, provider: string, model: string }` |
| **消耗 token** | **是**（计入 `cost.llmCalls`、`cost.tokenEstimate`） |
| **Skill 可调用** | **允许** |
| **失败返回** | `{ ok: false, error: { code: "LLM_UNAVAILABLE" \| "INVALID_INPUT", message, detail: { status?, endpoint? } } }` |
| **现有代码** | `electron/main/services/llmClient.ts` → `completeText()`；`src/shared/ai/providerCatalog.ts` |

---

### 3.2 `llm.generateJson`

| 项 | 说明 |
|----|------|
| **名称** | `llm.generateJson` |
| **描述** | 生成并解析为 JSON 的结构化输出（提纲、槽位填充计划等） |
| **输入** | `{ systemPrompt, userPrompt, schema?: object \| string, temperature?, maxTokens?, featureName? }` |
| **输出** | `{ json: object, rawText?: string }` |
| **消耗 token** | **是** |
| **Skill 可调用** | **允许** |
| **失败返回** | `{ ok: false, error: { code: "LLM_UNAVAILABLE" \| "INVALID_JSON", message, detail: { parseError? } } }` |
| **现有代码** | 尚无独立 `generateJson`；各服务在 `completeText` 后自行 `JSON.parse`（如 `electron/main/services/ppt/deckBuilder/deckBuilderService.ts`、`paperGenerator.ts`）— **待收敛** |

---

### 3.3 `knowledge.retrieve`

| 项 | 说明 |
|----|------|
| **名称** | `knowledge.retrieve` |
| **描述** | 按任务约束从知识库检索文档块 |
| **输入** | `{ departmentId: string, query: string, constraints?: KnowledgeTaskConstraints, limit?: number }` |
| **输出** | `{ chunks: Array<{ documentId, chunkId, text, score?, metadata? }>, mode: string }` |
| **消耗 token** | **否**（检索本身）；后续 `llm.generate` 另计 |
| **Skill 可调用** | **允许**（需 `knowledge:retrieve` 权限） |
| **失败返回** | `{ ok: false, error: { code: "RESOURCE_NOT_FOUND" \| "PERMISSION_DENIED", message } }` |
| **现有代码** | `electron/main/services/knowledgeService.ts`；IPC `knowledge:retrieveChunks`（`electron/main/index.ts` ~1757） |

---

### 3.4 `workspace.readFile`

| 项 | 说明 |
|----|------|
| **名称** | `workspace.readFile` |
| **描述** | 读取工作区内相对路径文件 |
| **输入** | `{ workspacePath: string, relativePath: string, encoding?: "utf8" \| "base64" }` |
| **输出** | `{ content: string, size: number, modifiedAt?: string }` |
| **消耗 token** | **否** |
| **Skill 可调用** | **允许** |
| **失败返回** | `{ ok: false, error: { code: "WORKSPACE_NOT_FOUND" \| "RESOURCE_NOT_FOUND", message } }` |
| **现有代码** | `electron/main/services/workspaceService.ts`；树遍历 `getWorkspaceTree`；IPC `workspace:tree` |

---

### 3.5 `workspace.writeFile`

| 项 | 说明 |
|----|------|
| **名称** | `workspace.writeFile` |
| **描述** | 写入或覆盖工作区相对路径文件 |
| **输入** | `{ workspacePath, relativePath, content: string }` |
| **输出** | `{ relativePath, size }` |
| **消耗 token** | **否** |
| **Skill 可调用** | **允许**（需 `workspace:write`） |
| **失败返回** | `{ ok: false, error: { code: "PERMISSION_DENIED" \| "ENGINE_ERROR", message } }` |
| **现有代码** | IPC `workspace:writeFile` → `workspaceService.writeWorkspaceFile()` |

---

### 3.6 `workspace.saveFile`

| 项 | 说明 |
|----|------|
| **名称** | `workspace.saveFile` |
| **描述** | 将内存中的文稿 / 附件保存到工作区约定路径（含 `saveManuscript` 语义） |
| **输入** | `{ workspacePath, content, filename?, options?: { subdir?, format? } }` |
| **输出** | `{ savedPath: string, displayName: string }` |
| **消耗 token** | **否** |
| **Skill 可调用** | **允许** |
| **失败返回** | `{ ok: false, error: { code: "INVALID_INPUT" \| "ENGINE_ERROR", message } }` |
| **现有代码** | IPC `workspace:saveManuscript`（`electron/main/index.ts` ~1175）；`workspaceService.saveManuscript()` |

---

### 3.7 `workspace.copyAsset`

| 项 | 说明 |
|----|------|
| **名称** | `workspace.copyAsset` |
| **描述** | 在工作区内复制文件或目录（含图片到 `figures`） |
| **输入** | `{ workspacePath, sourceRelativePath, targetRelativePath }` |
| **输出** | `{ targetRelativePath }` |
| **消耗 token** | **否** |
| **Skill 可调用** | **允许** |
| **失败返回** | `{ ok: false, error: { code: "RESOURCE_NOT_FOUND", message } }` |
| **现有代码** | IPC `workspace:copyPath` → `workspaceService.copyWorkspacePath()` |

---

### 3.8 `task.reportProgress`

| 项 | 说明 |
|----|------|
| **名称** | `task.reportProgress` |
| **描述** | 向 UI / 任务中心上报步骤进度 |
| **输入** | `{ taskId: string, stepId: string, percent: number, message?: string, status?: "running" \| "completed" \| "failed" }` |
| **输出** | `{ acknowledged: true }` |
| **消耗 token** | **否** |
| **Skill 可调用** | **允许** |
| **失败返回** | `{ ok: false, error: { code: "INVALID_INPUT", message } }` |
| **现有代码** | `electron/main/services/localTaskService.ts`；`emitAiEvent` 进度事件（`electron/main/index.ts`）；`workspace:appendTaskHistory` |

---

### 3.9 `task.writeLog`

| 项 | 说明 |
|----|------|
| **名称** | `task.writeLog` |
| **描述** | 写入任务审计 / 用户行为日志 |
| **输入** | `{ module: string, action: string, eventType: string, details?: object, status?: string }` |
| **输出** | `{ logId?: string }` |
| **消耗 token** | **否** |
| **Skill 可调用** | **受限**（Workflow Skill 允许；Template Skill 仅错误日志） |
| **失败返回** | `{ ok: false, error: { code: "ENGINE_ERROR", message } }` |
| **现有代码** | `electron/main/services/userActionLogService.ts` |

---

## 4. 文稿能力（Document）

### 4.1 `document.create`

| 项 | 说明 |
|----|------|
| **名称** | `document.create` |
| **描述** | 在工作区创建空白 `DocumentSchema` 文档 |
| **输入** | `{ workspacePath, relativePath?: string, title?: string, templateId?: string }` |
| **输出** | `{ documentId, jsonPath, document: DocumentSchema }` |
| **消耗 token** | **否** |
| **Skill 可调用** | **允许** |
| **失败返回** | `{ ok: false, error: { code: "WORKSPACE_NOT_FOUND", message } }` |
| **现有代码** | `workspaceService.createBlankDocument()`；`src/document/schema` → `createDocumentSchema()` |

---

### 4.2 `document.load`

| 项 | 说明 |
|----|------|
| **名称** | `document.load` |
| **描述** | 加载工作区 `document.json` 或遗留格式 |
| **输入** | `{ workspacePath, relativePath?: string }` |
| **输出** | `{ document: DocumentSchema, source: "document-json" \| "legacy-workspace" \| "empty", compatHtml }` |
| **消耗 token** | **否** |
| **Skill 可调用** | **允许** |
| **失败返回** | `{ ok: false, error: { code: "RESOURCE_NOT_FOUND", message } }` |
| **现有代码** | `workspaceService.readWorkspaceDocumentSchema()`；IPC `workspace:readDocumentSchema` |

---

### 4.3 `document.save`

| 项 | 说明 |
|----|------|
| **名称** | `document.save` |
| **描述** | 持久化 `DocumentSchema` 到工作区 |
| **输入** | `{ workspacePath, document: DocumentSchema, relativePath?: string }` |
| **输出** | `{ jsonPath, resourceCount, displayName }` |
| **消耗 token** | **否** |
| **Skill 可调用** | **允许** |
| **失败返回** | `{ ok: false, error: { code: "ENGINE_ERROR", message } }` |
| **现有代码** | `workspaceService.saveWorkspaceDocumentSchema()`；IPC `workspace:saveDocumentSchema` |

---

### 4.4 `document.updateBlock`

| 项 | 说明 |
|----|------|
| **名称** | `document.updateBlock` |
| **描述** | 按块 ID 或选区更新文档内容（Agent 写作主路径） |
| **输入** | `{ workspacePath, documentId?, patches: DocumentPatch[] }` 或 `{ blockId, content }` |
| **输出** | `{ document: DocumentSchema, appliedCount: number }` |
| **消耗 token** | **否** |
| **Skill 可调用** | **允许** |
| **失败返回** | `{ ok: false, error: { code: "INVALID_INPUT" \| "RESOURCE_NOT_FOUND", message } }` |
| **现有代码** | `src/document/core` patch 模型；`src/engines/documentEngine/` → `applyTextEdit`；`templateDocumentOrchestrator` 提交 patches |

---

### 4.5 `document.importDocxTemplate`

| 项 | 说明 |
|----|------|
| **名称** | `document.importDocxTemplate` |
| **描述** | 导入 DOCX 模板为 `DocumentSchema` + OOXML 快照 |
| **输入** | `{ workspacePath, templatePath: string, mode?: DocumentSchemaDocxTemplateMode }` |
| **输出** | `{ document, ooxmlSnapshot?, templateFields? }` |
| **消耗 token** | **否** |
| **Skill 可调用** | **允许** |
| **失败返回** | `{ ok: false, error: { code: "ENGINE_ERROR", message, detail: { compatibility? } } }` |
| **现有代码** | `workspaceService` + `documentSchemaDocxBoundary`（`importDocumentSchemaFromOoxmlSnapshot`）；`documentEngine:readOoxmlPackage` |

---

### 4.6 `document.extractTemplateFields`

| 项 | 说明 |
|----|------|
| **名称** | `document.extractTemplateFields` |
| **描述** | 从模板 DOCX / schema 提取可填字段列表 |
| **输入** | `{ templatePath \| documentId, workspacePath }` |
| **输出** | `{ fields: Array<{ id, label, type, required, default? }> }` |
| **消耗 token** | **否**（纯解析）；若结合 LLM 识别字段则另调 `llm.generateJson` |
| **Skill 可调用** | **允许** |
| **失败返回** | `{ ok: false, error: { code: "RESOURCE_NOT_FOUND", message } }` |
| **现有代码** | IPC `formalTemplate:analyze`；`src/modules/formal/hooks/useFormalTemplateGeneration.ts` |

---

### 4.7 `document.writebackToTemplate`

| 项 | 说明 |
|----|------|
| **名称** | `document.writebackToTemplate` |
| **描述** | 将编辑结果按规则回写到 OOXML 模板字段 |
| **输入** | `{ workspacePath, document, templatePath, writebackRules, outputPath? }` |
| **输出** | `{ outputPath, commitResultPath? }` |
| **消耗 token** | **否** |
| **Skill 可调用** | **允许** |
| **失败返回** | `{ ok: false, error: { code: "ENGINE_ERROR", message } }` |
| **现有代码** | IPC `formalTemplate:commit`；`src/document/profiles/templateDocument/orchestrator/templateDocumentOrchestrator.ts` |

---

### 4.8 `document.exportDocx`

| 项 | 说明 |
|----|------|
| **名称** | `document.exportDocx` |
| **描述** | 导出 DOCX 文件 |
| **输入** | `{ workspacePath, document \| markdown \| html, targetPath?, journalFormatId? }` |
| **输出** | `{ filePath, fileName }` |
| **消耗 token** | **否** |
| **Skill 可调用** | **允许** |
| **失败返回** | `{ ok: false, error: { code: "ENGINE_ERROR", message } }` |
| **现有代码** | `electron/main/services/pdfExporter.ts` → `exportDocxToPath()`；`journalDocxExporter.ts` → `exportWithJournalFormat`；IPC `ai:exportDocx` 相关 |

---

### 4.9 `document.exportPdf`

| 项 | 说明 |
|----|------|
| **名称** | `document.exportPdf` |
| **描述** | 从 Markdown / 编辑器 HTML 导出 PDF |
| **输入** | `{ markdown?: string, editorHtml?: string, title: string, targetPath? }` |
| **输出** | `{ filePath }` |
| **消耗 token** | **否** |
| **Skill 可调用** | **允许** |
| **失败返回** | `{ ok: false, error: { code: "ENGINE_ERROR", message } }` |
| **现有代码** | `pdfExporter.ts` → `exportPdf`, `exportPdfFromEditorHtml`；IPC `ai:exportPdf`, `ai:exportPdfFromEditor` |

---

### 4.10 `document.preview`

| 项 | 说明 |
|----|------|
| **名称** | `document.preview` |
| **描述** | 生成文档预览（HTML / 快照路径） |
| **输入** | `{ workspacePath, document?, format?: "html" \| "snapshot" }` |
| **输出** | `{ previewHtml?, previewPath?, pageCount? }` |
| **消耗 token** | **否** |
| **Skill 可调用** | **允许** |
| **失败返回** | `{ ok: false, error: { code: "ENGINE_ERROR", message } }` |
| **现有代码** | `src/document/preview/`；`src/hooks/useDocumentPreview.ts`；IPC `formalTemplate:preview` |

---

## 5. PPT 能力（Deck / Template）

### 5.1 `deck.create`

| 项 | 说明 |
|----|------|
| **名称** | `deck.create` |
| **描述** | 创建空 `DeckDocument` 并初始化目录 |
| **输入** | `{ workspacePath, deckId?: string, title?: string, templateManifestId?: string }` |
| **输出** | `{ deck: DeckDocument, deckId, filePath }` |
| **消耗 token** | **否** |
| **Skill 可调用** | **允许** |
| **失败返回** | `{ ok: false, error: { code: "WORKSPACE_NOT_FOUND", message } }` |
| **现有代码** | `src/types/deckDocument.ts`；`deckBuilder` 各 `buildDeckFrom*` 入口创建逻辑 |

---

### 5.2 `deck.load`

| 项 | 说明 |
|----|------|
| **名称** | `deck.load` |
| **描述** | 从 `05_Presentation/decks/<id>/deck.json` 加载 |
| **输入** | `{ workspacePath, deckId }` |
| **输出** | `{ deck: DeckDocument, filePath }` |
| **消耗 token** | **否** |
| **Skill 可调用** | **允许** |
| **失败返回** | `{ ok: false, error: { code: "RESOURCE_NOT_FOUND", message } }` |
| **现有代码** | `electron/main/services/deckDocumentService.ts` → `loadDeckDocument()`；IPC `deck:load` |

---

### 5.3 `deck.save`

| 项 | 说明 |
|----|------|
| **名称** | `deck.save` |
| **描述** | 持久化 `DeckDocument` |
| **输入** | `{ workspacePath, deck: DeckDocument }` |
| **输出** | `{ deckId, filePath }` |
| **消耗 token** | **否** |
| **Skill 可调用** | **允许** |
| **失败返回** | `{ ok: false, error: { code: "ENGINE_ERROR", message } }` |
| **现有代码** | `deckDocumentService.saveDeckDocument()`；IPC `deck:save` |

---

### 5.4 `deck.importPptx`

| 项 | 说明 |
|----|------|
| **名称** | `deck.importPptx` |
| **描述** | 从 PPTX 导入为 `DeckDocument` 或内容包 |
| **输入** | `{ workspacePath, pptxPath, options?: { buildDeck?: boolean } }` |
| **输出** | `{ deck?: DeckDocument, contentPackage?, extractedSlides? }` |
| **消耗 token** | **否** |
| **Skill 可调用** | **允许** |
| **失败返回** | `{ ok: false, error: { code: "ENGINE_ERROR", message } }` |
| **现有代码** | `electron/main/services/ppt/pptxImportService.ts`；IPC `pptx:importFromFile`, `deck:extractPptx`, `deck:buildFromImportedPptx` |

---

### 5.5 `deck.updateSlide`

| 项 | 说明 |
|----|------|
| **名称** | `deck.updateSlide` |
| **描述** | 更新单张幻灯片的槽位内容 |
| **输入** | `{ workspacePath, deckId, slideIndex, slots: Record<string, unknown> }` |
| **输出** | `{ deck: DeckDocument }` |
| **消耗 token** | **否** |
| **Skill 可调用** | **允许** |
| **失败返回** | `{ ok: false, error: { code: "INVALID_INPUT", message } }` |
| **现有代码** | IPC `deck:updateSlide`；`deck:updateDeckDocument`（`electron/main/index.ts`） |

---

### 5.6 `deck.render`

| 项 | 说明 |
|----|------|
| **名称** | `deck.render` |
| **描述** | 将 `DeckDocument` 渲染为 PPTX 文件 |
| **输入** | `{ workspacePath, deckId, manifestId, outputPath? }` |
| **输出** | `{ pptxPath, manifestId, warnings?: string[] }` |
| **消耗 token** | **否** |
| **Skill 可调用** | **允许** |
| **失败返回** | `{ ok: false, error: { code: "ENGINE_ERROR", message, detail: { slotErrors? } } }` |
| **现有代码** | `deckDocumentService` → `renderDeck()`；`electron/main/services/ppt/retemplateEngine.ts`；`templateCloneRenderer.ts`；IPC `deck:render` |

---

### 5.7 `deck.preview`

| 项 | 说明 |
|----|------|
| **名称** | `deck.preview` |
| **描述** | 生成幻灯片缩略图预览 |
| **输入** | `{ pptxPath, previewDir?, maxSlides? }` |
| **输出** | `{ slides: Array<{ index, imagePath, title? }>, previewDir }` |
| **消耗 token** | **否** |
| **Skill 可调用** | **允许** |
| **失败返回** | `{ ok: false, error: { code: "ENGINE_ERROR", message, detail: { warning? } } }`（可部分成功） |
| **现有代码** | `electron/main/services/ppt/pptxPreviewService.ts`；IPC `deck:preview` |

---

### 5.8 `deck.exportPptx`

| 项 | 说明 |
|----|------|
| **名称** | `deck.exportPptx` |
| **描述** | 导出 / 复制已渲染 PPTX 到用户指定路径 |
| **输入** | `{ workspacePath, deckId, manifestId, targetPath? }` |
| **输出** | `{ filePath }` |
| **消耗 token** | **否** |
| **Skill 可调用** | **允许** |
| **失败返回** | `{ ok: false, error: { code: "RESOURCE_NOT_FOUND", message } }` |
| **现有代码** | `deckDocumentService` 输出路径 `{manifestId}_output.pptx`；`pptxGenerator.ts`；IPC `pptx:generate` |

---

### 5.9 `template.list`

| 项 | 说明 |
|----|------|
| **名称** | `template.list` |
| **描述** | 列出可用 PPT 模板 manifest |
| **输入** | `{ source?: "built-in" \| "skill" \| "all" }` |
| **输出** | `{ templates: Array<{ id, name, type, source, slideSize }> }` |
| **消耗 token** | **否** |
| **Skill 可调用** | **允许** |
| **失败返回** | `{ ok: false, error: { code: "ENGINE_ERROR", message } }` |
| **现有代码** | `electron/main/services/pptTemplateRegistry.ts`；`src/types/pptTemplateManifest.ts`；IPC `pptx:listSkills` |

---

### 5.10 `template.validate`

| 项 | 说明 |
|----|------|
| **名称** | `template.validate` |
| **描述** | 校验模板 manifest 与 slot-rules 一致性 |
| **输入** | `{ manifestId, manifestPath?, slotRules? }` |
| **输出** | `{ valid: boolean, errors: Array<{ code, message, slideIndex? }> }` |
| **消耗 token** | **否** |
| **Skill 可调用** | **允许** |
| **失败返回** | `{ ok: false, error: { code: "INVALID_INPUT", message, detail: { errors } } }` |
| **现有代码** | `src/types/deckDocument.ts` → `validateDeckDocument`；`.debug-template-slots/` 调试产物；**manifest 校验器待实现** |

---

## 6. Capability 调用矩阵（速查）

| Capability | Token | Skill | Agent |
|------------|-------|-------|-------|
| llm.generate | 是 | ✓ | ✓ |
| llm.generateJson | 是 | ✓ | ✓ |
| knowledge.retrieve | 否 | ✓ | ✓ |
| workspace.* | 否 | ✓ | ✓ |
| task.reportProgress | 否 | ✓ | ✓ |
| task.writeLog | 否 | △ 受限 | ✓ |
| document.* | 否 | ✓ | ✓ |
| deck.* | 否 | ✓ | ✓ |
| template.* | 否 | ✓ | ✓ |

---

## 7. 宿主调用约定（目标 API）

```typescript
// 设计目标接口（尚未作为单一模块实现）
type CapabilityId =
  | `llm.${string}`
  | `knowledge.${string}`
  | `workspace.${string}`
  | `task.${string}`
  | `document.${string}`
  | `deck.${string}`
  | `template.${string}`

interface CapabilityInvokeRequest {
  capability: CapabilityId
  workspaceId?: string
  params: Record<string, unknown>
  caller: {
    type: 'agent' | 'skill' | 'ui'
    id: string
    skillManifestId?: string
  }
}

interface CapabilityResult<T = unknown> {
  ok: boolean
  data: T
  error?: { code: string; message: string; detail?: Record<string, unknown> }
  cost?: { llmCalls: number; imageCalls: number; tokenEstimate: number }
}

declare function hostCall<T>(req: CapabilityInvokeRequest): Promise<CapabilityResult<T>>
```

**迁移路径**：

1. 将现有 `ipcMain.handle('deck:*')` 等包装为 `CapabilityResult` 信封  
2. 在 `skill_platform_next/services/skill-engine` 增加 `host.call` 白名单映射  
3. Skill 包仅通过 engine 调用，禁止渲染进程直连 IPC  

---

## 8. 与 IPC 通道对照（实现参考）

| Capability | 现有 IPC（部分） |
|------------|------------------|
| workspace.readFile / writeFile | `workspace:tree`, `workspace:writeFile` |
| document.load / save | `workspace:readDocumentSchema`, `workspace:saveDocumentSchema` |
| document.importDocxTemplate | `documentEngine:readOoxmlPackage` |
| document.extractTemplateFields | `formalTemplate:analyze` |
| document.writebackToTemplate | `formalTemplate:commit` |
| document.exportPdf | `ai:exportPdf`, `ai:exportPdfFromEditor` |
| knowledge.retrieve | `knowledge:retrieveChunks` |
| deck.load / save / render | `deck:load`, `deck:save`, `deck:render` |
| deck.preview | `deck:preview` |
| deck.importPptx | `pptx:importFromFile`, `deck:buildFromImportedPptx` |
| template.list | `pptx:listSkills` |

完整 IPC 注册见：`electron/main/index.ts`、`electron/preload/index.ts`、`src/types/electron.d.ts`。

---

## 9. 第一版范围外（后续版本）

- `image.generate` — 已有 `imageClient.ts`，待纳入 Capability _registry  
- `mail.parse` / `mail.send` — 邮件 Agent 专用  
- `workspace.create` — 工作区生命周期，建议仅 Agent 调用  
- 流式 `llm.stream` — 对应 `streamText()` in `llmClient.ts`  

---

*文档维护：架构组 · 设计稿 v0.1 · 2026-05*
