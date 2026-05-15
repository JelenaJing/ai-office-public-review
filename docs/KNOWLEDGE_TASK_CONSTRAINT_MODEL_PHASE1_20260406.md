# AI Writer 3.0 知识任务约束模型一期实现清单

## 目标

一期不引入“研究本”概念，直接把现有知识库升级为可用于正式办公写作的任务约束系统。

一期必须同时满足 4 个条件：

1. 保留并强化“模板文档 + 参考资料”选择能力。
2. 在此基础上补齐片段级检索，而不是只按整篇文档摘录。
3. 生成结果能追踪来源，区分模板继承、显式参考、自动检索补充。
4. 给用户明确的检索策略开关，而不是把所有任务都走同一条自动链路。

## 现状判断

当前系统已经有任务级模板和参考资料选择，但仍然属于文档级选择，不属于正式任务约束模型。

现状能力：

1. 前端已经支持任务级模板和参考资料选择。
2. 主进程已经能把模板和参考文档拼成额外上下文。
3. 知识库已有来源文档、抽取文本、版本、任务记录等基础对象。

现状缺口：

1. 没有任务约束对象，模板和参考仍然只是 UI 状态。
2. 没有 chunk 级索引，生成仍以整篇文档摘录为主。
3. 没有 citation 和 retrieval hit 对象，无法追踪句子级证据来源。
4. 没有任务模式开关，用户无法声明“仅用已选资料”还是“允许自动补充”。

## 一期范围

一期只做以下内容，不做知识图谱，不做全量向量数据库重构。

1. 正式引入任务约束模型。
2. 给知识库增加 chunk 级索引和检索结果结构。
3. 给生成任务增加来源追踪结果。
4. 给用户增加 3 档检索策略开关。

## 一期核心模型

### 1. 任务模式

```ts
export type KnowledgeRetrievalMode =
  | 'selected-only'
  | 'selected-first'
  | 'auto'
```

定义：

1. `selected-only`
   仅使用当前显式选择的模板文档和参考资料，不做全库补充检索。
2. `selected-first`
   显式选择优先，当显式资料不足时允许自动检索补充。
3. `auto`
   不依赖显式参考资料，按任务需求在知识库中自动检索。

### 2. 任务约束对象

```ts
export interface KnowledgeTaskConstraints {
  mode: KnowledgeRetrievalMode
  templateDocumentId?: string
  requiredReferenceDocumentIds: string[]
  preferredReferenceDocumentIds: string[]
  allowAutoRetrieval: boolean
  autoRetrievalLimit: number
  templateInheritance: {
    structure: boolean
    tone: boolean
    terminology: boolean
  }
}
```

说明：

1. `templateDocumentId`
   单个模板文档，负责结构、语气、章节组织。
2. `requiredReferenceDocumentIds`
   必选参考资料，生成时必须优先消费。
3. `preferredReferenceDocumentIds`
   可选增强资料，一期可先与 required 复用同一 UI，后端先留字段。
4. `allowAutoRetrieval`
   显式声明是否允许从全库自动补检。
5. `autoRetrievalLimit`
   自动检索补充的 chunk 数量上限。
6. `templateInheritance`
   控制模板继承维度，一期先支持结构、语气、术语三项。

### 3. 片段对象

```ts
export interface KnowledgeChunkMeta {
  id: string
  documentId: string
  versionId?: string
  order: number
  titlePath: string[]
  sectionLabel?: string
  pageStart?: number
  pageEnd?: number
  paragraphStart?: number
  paragraphEnd?: number
  text: string
  normalizedText: string
  summary: string
  keywords: string[]
  tokenEstimate: number
  sourceType: KnowledgeSourceType
  createdAt: string
  updatedAt: string
}
```

一期要求：

1. 先做稳定 chunk，不要求复杂语义切分。
2. PDF 和 Word 优先按标题/段落切分，兜底按长度分块。
3. 图片文档不进入文本 chunk 检索，但保留为独立 style/reference 资源。

### 4. 检索请求和命中对象

```ts
export interface KnowledgeRetrievalQuery {
  query: string
  mode: KnowledgeRetrievalMode
  templateDocumentId?: string
  requiredReferenceDocumentIds?: string[]
  preferredReferenceDocumentIds?: string[]
  includeDocumentIds?: string[]
  excludeDocumentIds?: string[]
  sourceTypes?: KnowledgeSourceType[]
  maxChunks?: number
}

export interface KnowledgeRetrievalHit {
  chunk: KnowledgeChunkMeta
  score: number
  source: 'required-reference' | 'preferred-reference' | 'auto-retrieval'
  matchedBy: Array<'keyword' | 'summary' | 'title' | 'heuristic'>
  quote: string
}
```

一期检索策略：

1. 先按文档集合做过滤。
2. 再按关键词命中、标题命中、摘要命中做启发式排序。
3. 一期不强依赖向量检索，先把结构和返回对象做对。

### 5. 引用对象

```ts
export interface KnowledgeCitation {
  id: string
  documentId: string
  chunkId: string
  sourceKind: 'template' | 'required-reference' | 'preferred-reference' | 'auto-retrieval'
  documentTitle: string
  locatorLabel: string
  quote: string
  score?: number
}
```

要求：

1. 每个检索命中都能转成 citation。
2. 生成阶段使用的证据必须能回溯到 citation。
3. citation 至少要能显示文档标题和定位信息。

### 6. 生成来源追踪对象

```ts
export interface KnowledgeGenerationTrace {
  templateDocumentId?: string
  requiredReferenceDocumentIds: string[]
  preferredReferenceDocumentIds: string[]
  retrievedHits: KnowledgeRetrievalHit[]
  citations: KnowledgeCitation[]
  coverage: {
    templateApplied: boolean
    explicitReferenceCount: number
    autoRetrievedCount: number
  }
}
```

说明：

1. `templateApplied`
   表示本次生成确实使用了模板继承逻辑。
2. `explicitReferenceCount`
   表示显式参考实际进入上下文的数量。
3. `autoRetrievedCount`
   表示自动补检命中数量。

## 现有类型的改造建议

### 1. 扩展任务参数

当前 `KnowledgeRemakeTaskParams` 只支持模板文档和参考文档 ID。

一期改为：

```ts
export interface KnowledgeRemakeTaskParams {
  documentId: string
  sourceVersionId?: string
  instruction: string
  title?: string
  constraints?: KnowledgeTaskConstraints
}
```

兼容策略：

1. 旧字段 `templateDocumentId` 和 `referenceDocumentIds` 先保留一版。
2. 提交时统一归并到 `constraints`。
3. 二期再清理旧字段。

### 2. 扩展任务记录

```ts
export interface KnowledgeTaskRecord {
  id: string
  type: KnowledgeTaskType
  status: KnowledgeTaskStatus
  title: string
  createdAt: string
  updatedAt: string
  documentId?: string
  sourceDocumentIds: string[]
  templateDocumentId?: string
  referenceDocumentIds: string[]
  constraints?: KnowledgeTaskConstraints
  generationTrace?: KnowledgeGenerationTrace
  sourceVersionId?: string
  outputVersionId?: string
  instruction?: string
  outputPreview?: string
  errorMessage?: string
}
```

要求：

1. `constraints` 保存任务级约束原貌。
2. `generationTrace` 保存任务完成后的来源追踪结果。

### 3. 扩展文档详情

```ts
export interface KnowledgeDocumentDetail {
  meta: KnowledgeDocumentMeta
  extractedText: string
  originalExtractedText: string
  currentVersionId: string | null
  versions: KnowledgeDocumentVersionMeta[]
  tasks: KnowledgeTaskRecord[]
  chunkCount?: number
}
```

一期只补 `chunkCount` 即可，详细 chunk 列表走独立接口读取。

## Electron API 一期新增接口

### 1. 预览任务上下文

```ts
previewKnowledgeTaskContext: (payload: {
  instruction: string
  constraints: KnowledgeTaskConstraints
  documentId?: string
  sourceVersionId?: string
}) => Promise<{
  templateSummary?: string
  explicitReferenceSummaries: Array<{ documentId: string; title: string }>
  retrievedHits: KnowledgeRetrievalHit[]
  citations: KnowledgeCitation[]
}>
```

用途：

1. 让前端在正式提交前看到本次任务会消费哪些资料。
2. 便于调试“为什么这次生成用了哪些来源”。

### 2. chunk 检索接口

```ts
retrieveKnowledgeChunks: (payload: KnowledgeRetrievalQuery) => Promise<{
  hits: KnowledgeRetrievalHit[]
  citations: KnowledgeCitation[]
}>
```

### 3. 读取文档 chunk 列表

```ts
listKnowledgeDocumentChunks: (payload: {
  documentId: string
  versionId?: string
}) => Promise<KnowledgeChunkMeta[]>
```

### 4. 扩展提交任务接口

```ts
submitKnowledgeRemakeTask: (payload: KnowledgeRemakeTaskParams) => Promise<string>
```

要求：

1. 允许只传 `constraints.mode = 'auto'`。
2. 允许模板为空但参考存在。
3. 允许模板存在且参考为空。

## 主进程服务拆分建议

### 1. 保留现有服务

1. `knowledgeService.ts`
   继续负责来源文档、版本、任务记录。
2. `knowledgeTaskService.ts`
   继续负责提交和执行任务。

### 2. 新增服务

一期新增一个独立服务：

```ts
electron/main/services/knowledgeRetrievalService.ts
```

职责：

1. 生成和读取 chunk 索引。
2. 执行文档过滤和 chunk 检索。
3. 输出 retrieval hit 和 citation。
4. 给生成服务提供 evidence bundle。

### 3. `knowledgeTaskService.ts` 的职责变化

当前是“直接拼模板摘录和参考文档摘录”。

一期改成：

1. 先解析 `constraints`。
2. 调用 `knowledgeRetrievalService` 生成 evidence bundle。
3. 再把模板上下文、显式参考命中、自动检索命中分段拼装进 prompt。
4. 把 `generationTrace` 写回任务记录。

## Prompt 组装规则

一期生成上下文固定按 3 段拼接：

1. 模板继承段
   只放模板结构线索、模板风格说明和少量模板节选。
2. 显式参考段
   只放 `requiredReferenceDocumentIds` 和 `preferredReferenceDocumentIds` 命中的 chunk。
3. 自动补检段
   只在 `selected-first` 或 `auto` 模式下出现。

要求：

1. 模板内容不能被当作事实来源引用。
2. 显式参考优先于自动补检。
3. `selected-only` 模式下，自动补检段必须为空。

## 前端交互一期改造

### 1. 任务选择器

现有 `KnowledgeTaskSelector` 保留，但升级为正式约束输入器。

新增字段：

1. 模式开关
   `仅使用已选资料`
   `已选资料优先，允许自动补充`
   `完全自动检索`
2. 模板继承范围
   `结构`
   `语气`
   `术语`
3. 自动补检上限
   一期可先做 3、5、8 三档。

### 2. 生成前预览

生成前显示：

1. 当前模板文档
2. 当前必选参考资料
3. 预计自动补检命中数量
4. 本次任务模式

### 3. 生成后来源面板

一期不做句子级联动，但至少展示：

1. 模板来源
2. 显式参考来源列表
3. 自动补检来源列表
4. 每条来源对应的引文摘录

## 存储建议

一期不引入数据库，沿用知识库目录下的 JSON 索引即可。

建议新增目录：

```text
knowledge/
  index.json
  chunks/
    {documentId}.chunks.json
```

`{documentId}.chunks.json` 内容为：

```ts
export interface KnowledgeDocumentChunkIndex {
  documentId: string
  versionId?: string
  updatedAt: string
  chunks: KnowledgeChunkMeta[]
}
```

## 一期文件改造清单

### 类型层

1. `src/types/knowledge.ts`
   新增 `KnowledgeTaskConstraints`、`KnowledgeChunkMeta`、`KnowledgeRetrievalQuery`、`KnowledgeRetrievalHit`、`KnowledgeCitation`、`KnowledgeGenerationTrace`。
2. `src/types/electron.d.ts`
   新增 retrieval 和 preview 接口声明。

### 主进程

1. `electron/main/services/knowledgeService.ts`
   增加 chunk 索引读写入口，维护 `chunkCount`。
2. `electron/main/services/knowledgeRetrievalService.ts`
   新增。
3. `electron/main/services/knowledgeTaskService.ts`
   从“整篇摘录拼接”改成“约束解析 + chunk 检索 + evidence bundle 组装”。
4. `electron/main/index.ts`
   新增 IPC：
   - `knowledge:retrieveChunks`
   - `knowledge:previewTaskContext`
   - `knowledge:listDocumentChunks`

### 前端

1. `src/components/KnowledgeTaskSelector.tsx`
   增加模式开关、模板继承开关、自动补检上限。
2. `src/components/GenerationComposer.tsx`
   提交时传 `constraints`，并显示上下文预览。
3. `src/components/KnowledgeConversationDock.tsx`
   对话模式同样接入 `constraints`。
4. `src/contexts/KnowledgeContext.tsx`
   保持全局默认模板/参考资料，但新增全局默认模式配置入口。

## 一期验收标准

### 场景 1

用户勾选 `2025 年工作总结` 为模板，再勾选 `2026 年计划`、`2026 年项目清单` 为参考资料。

输入：

`按照 2025 年工作总结模板，生成 2026 年工作报告。`

验收：

1. 生成结果沿用 2025 年结构和语气。
2. 事实内容优先来自 2026 显式资料。
3. 若模式为 `selected-only`，系统不能再从全库补资料。

### 场景 2

用户只输入需求，不选模板和参考，模式为 `auto`。

验收：

1. 系统自动检索 chunk。
2. 结果面板能看到自动检索来源列表。

### 场景 3

用户选了模板和参考，模式为 `selected-first`。

验收：

1. 显式资料优先进入上下文。
2. 自动检索只作为补充。
3. 任务记录中能区分显式来源和自动来源。

## 一期不做的事

1. 不做句子级引用回写到编辑器正文。
2. 不做向量检索基础设施改造。
3. 不做跨任务知识沉淀容器。
4. 不做复杂 rerank 模型。

## 建议实现顺序

1. 先补类型和任务约束对象。
2. 再补 chunk 索引和 retrieval service。
3. 再改任务服务的 prompt 组装。
4. 最后补前端模式开关和来源预览。

## 结论

一期的关键不是“把知识库做得更自动”，而是把当前已有的模板文档和参考资料能力正式化，再在其上引入可控的自动检索和可追踪的来源结构。

这样可以同时满足两类任务：

1. 强约束任务
   例如按 2025 年工作总结写 2026 年报告。
2. 自由检索任务
   例如围绕某个主题自动搜资料后生成初稿。

这两类任务共享同一套任务约束模型，而不是拆成两套系统。