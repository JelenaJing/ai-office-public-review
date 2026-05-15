# AI Writer 3.0 全局 OOXML 化迁移清单

## 目标

把 AI Writer 3.0 从“运行时以 structuredBlocks 为真源，markdown 为兼容派生”的状态，逐步迁移到“OOXML 作为持久化真源和交换格式”的架构，同时避免一次性替换导致生成链、任务链、预览链和历史任务损坏。

## 当前结论

1. DOCX 打开与保存已经具备真实 OOXML 包解析和原包回写能力。
2. 论文生成、任务状态、任务历史、预览传输仍以 structuredBlocks 为主真源。
3. embedded runtime 还不是 Word/WPS 级高保真版面引擎，不能直接删除 structuredBlocks 并全局切到 OOXML。

## 迁移原则

1. 先双写，再切读，最后收缩兼容字段。
2. 先动任务与持久化层，不先动编辑器主交互。
3. 每一步都保证 build 可过，且旧任务历史仍可读取。
4. 任何阶段都保留回退路径，不做不可逆替换。

## 阶段 0：建立迁移边界

目标：明确哪些模块必须改，哪些模块先不碰。

涉及模块：

1. electron/main/services/localTaskService.ts
2. electron/main/services/workspaceService.ts
3. src/services/PaperService.ts
4. electron/main/services/paperGenerator.ts
5. electron/main/services/documentEngineService.ts
6. electron/preload/index.ts
7. src/components/GenerationComposer.tsx
8. EmbeddedOfficeEnginePanel / document-engine host 相关面板

完成标准：

1. 形成分阶段执行清单。
2. 每个阶段都有明确输入、输出和回归点。

## 阶段 1：任务层双写基础

目标：在不改变现有消费方的前提下，为任务状态、任务结果、工作区历史补齐 OOXML 快照字段。

执行项：

1. 为 LocalTaskInfo 增加 `current_ooxml_snapshot` 字段。
2. 为 PaperGenerationResult 兼容结果增加 `ooxml_snapshot` 字段。
3. 为 WorkspaceTaskHistoryItem 增加 `current_ooxml_snapshot` 字段。
4. 在任务归一化和历史归一化入口中统一保留该字段。
5. 先允许字段为空，不切换现有读取逻辑。

完成标准：

1. 新旧任务历史都能正常读取。
2. 不破坏现有 `structuredBlocks -> markdown` 兼容逻辑。
3. build 通过。

## 阶段 2：生成链补 OOXML 导出快照

目标：在论文生成完成后，为每次任务生成可复用的 OOXML 快照，而不是只有 markdown/structuredBlocks。

执行项：

1. 从 structuredBlocks 或 markdown 生成 OOXML 快照对象。
2. 把 OOXML 快照写入 task result、task history。
3. 让 `done` 事件对外可带 `ooxml_snapshot`。
4. 明确快照格式：至少包含 document 级内容、版本、生成来源、是否可回写。

完成标准：

1. 新任务完成后有稳定的 `ooxml_snapshot`。
2. 即使没有 DOCX 原包，也能拿到可用于后续导出的 OOXML 表示。

## 阶段 3：服务层优先读取 OOXML 快照

目标：让 PaperService、任务结果接口优先识别 OOXML 快照，但保留旧字段兼容。

执行项：

1. normalizeTaskResultPayload 增加 `ooxml_snapshot` 归一化。
2. normalizeTaskPayload 增加 `current_ooxml_snapshot` 归一化。
3. 对外数据模型统一：`ooxml_snapshot`、`structured_blocks`、`paper_markdown` 三者并存。

完成标准：

1. 前端拿到任务结果时能看到 OOXML 快照字段。
2. 旧 UI 不需要立即改动也不出错。

## 阶段 4：编辑器和预览层切换为 OOXML 优先

目标：在 embedded 主链中让预览和文档载入优先消费 OOXML 快照，而不是 markdown 派生结果。

执行项：

1. GenerationComposer 支持从 `ooxml_snapshot` 还原预览。
2. EmbeddedOfficeEnginePanel 支持直接加载 task result 内的 OOXML 快照。
3. 仅在 OOXML 快照缺失时，才回退到 structuredBlocks / markdown。

完成标准：

1. 论文生成完成后可以直接以 OOXML 语义进入 embedded runtime。
2. preview 不再默认依赖 markdownToHtml。

## 阶段 5：收缩兼容字段

目标：当 OOXML 读写链足够稳定后，把 structuredBlocks 和 markdown 从“真源”降到“编辑缓存/兼容输出”。

执行项：

1. 任务状态不再把 `current_content` 当任何主字段使用。
2. `paper_markdown` 仅作导出兼容字段。
3. `structuredBlocks` 降为编辑运行态缓存，而不是结果真源。

完成标准：

1. 系统主真源切换为 OOXML 快照或 OOXML 包。
2. 旧兼容字段仍能输出，但已不承担主语义。

## 风险点

1. 当前 embedded runtime 仍缺少分页、脚注、页眉页脚、批注等高级语义，不能把 OOXML 全局化理解成“已经具备 Word 原生兼容”。
2. 任务历史如果直接存完整 DOCX base64，体积会迅速膨胀，必须控制快照格式。
3. 生成链是流式链路，不能把完整 OOXML 包当作高频流事件主载荷。

## 执行顺序

1. 阶段 1：任务层双写基础
2. 阶段 2：生成链补 OOXML 导出快照
3. 阶段 3：服务层优先读取 OOXML 快照
4. 阶段 4：编辑器和预览层切换为 OOXML 优先
5. 阶段 5：收缩兼容字段

## 当前执行状态

1. ✅ 阶段 0：已完成
2. ✅ 阶段 1：已完成
3. ✅ 阶段 2：已完成
4. ✅ 阶段 3：已完成
5. ✅ 阶段 4：已完成
6. 🔄 阶段 5：进行中

## 阶段执行详情

### 阶段 1：任务层双写基础 ✅

**已完成项：**
- LocalTaskInfo 已增加 `current_ooxml_snapshot` 字段
- PaperGenerationResult 已增加 `ooxml_snapshot` 字段
- 任务归一化入口统一保留 OOXML 快照字段
- 新旧任务历史都能正常读取

### 阶段 2：生成链补 OOXML 导出快照 ✅

**已完成项：**
- 从 structuredBlocks 生成 OOXML 快照对象（documentXml, plainText, html）
- OOXML 快照已写入 task result
- done 事件可携带 ooxml_snapshot
- 快照格式已标准化

### 阶段 3：服务层优先读取 OOXML 快照 ✅

**已完成项：**
- PaperService.normalizeTaskResultPayload() 已优先归一化 ooxml_snapshot
- PaperService.normalizeTaskPayload() 已优先归一化 current_ooxml_snapshot
- 前端可正常读取 OOXML 快照字段
- 旧字段仍保留兼容

### 阶段 4：编辑器和预览层切换为 OOXML 优先 ✅

**已完成项：**
- embeddedPaperDocument.ts 已实现 OOXML-first 文本/HTML 提取
- PaperGenerationPanel 预览已切换为 OOXML 优先
- GenerationComposer 已通过 resolvePaperText() 优先消费 OOXML
- OOXML 缺失时自动回退到 structuredBlocks/markdown

### 阶段 5：收缩兼容字段 🔄

**已完成项：**
- ✅ 任务管理 UI 已完全移除
- ✅ 任务历史持久化已移除
- ✅ workspaceService 不再维护任务历史
- ✅ current_content 已从 LocalTaskInfo 公共接口移除，仅保留为内部 InternalTaskInfo 的私有回退字段
- ✅ paper_markdown 作为最小只读兼容字段保留在 LocalTaskInfo
- ✅ renderer 统一通过 resolvePaperText() 读取正文
- ✅ 流式正文 helper (paperStreaming.ts) 已提取并通过 smoke test 验证
- ✅ structuredBlocks 语义边界已明确并文档化（[STRUCTURED_BLOCKS_SEMANTIC_BOUNDARY_20260318.md](./STRUCTURED_BLOCKS_SEMANTIC_BOUNDARY_20260318.md)）
- ✅ 补充 OOXML 快照完整性测试（`smoke:ooxml-snapshot`）

**进行中项：**
- 🔄 继续收缩 renderer 对旧兼容字段的依赖范围
- 🔄 进一步明确 paper_markdown 的只读语义

**待完成项：**
- ⏳ 考虑将 current_structured_blocks 从 LocalTaskInfo 移到内部接口（中期目标）
- ⏳ 完善 embedded runtime 对高级 OOXML 特性的支持（脚注、尾注、复杂表格等）

## 验证与测试清单

### Smoke Test 覆盖

1. ✅ **OOXML round-trip smoke test** (`smoke:ooxml`)
   - 验证 OOXML 包读写往返
   - 验证图片、公式、表格的往返完整性
   - 验证 documentXml 解析和重建
   - 验证结构正规化（从 plainText 生成完整 OOXML）

2. ✅ **OOXML snapshot completeness smoke test** (`smoke:ooxml-snapshot`)
   - 验证 OOXML 快照包含所有必要字段（documentXml, plainText, html）
   - 验证 plainText 和 HTML 提取功能
   - 验证多次往返稳定性（structuredBlocks ↔ markdown ↔ OOXML 快照）
   - 验证 OOXML 快照可序列化和反序列化
   - 验证空内容处理

3. ✅ **Paper streaming smoke test** (`smoke:paper-stream`)
   - 验证 content 事件增量流式正文更新
   - 验证 cumulativeMarkdown 优先级
   - 验证 structuredBlocks 序列化回退
   - 验证 resolvePaperText() OOXML-first 行为
   - 验证 buildPaperGenerationPreviewContent() OOXML HTML 优先级

### 兼容性边界

#### current_content 内外边界（2026-03-18 更新）

**内部边界（InternalTaskInfo）：**
- `current_content` 仅保留在 `InternalTaskInfo` 接口中
- 仅在 task runtime 内部作为最小文本回退保留
- 生成过程中流式写入，作为 plain-text fallback

**外部边界（LocalTaskInfo）：**
- ❌ 不再对外暴露 `current_content`
- ✅ 对外暴露 `paper_markdown`（由 OOXML 快照或 structuredBlocks 派生）
- ✅ 对外暴露 `current_ooxml_snapshot`（优先）

**Renderer 消费链：**
```
resolvePaperText(task) {
  if (task.current_ooxml_snapshot?.plainText) return plainText
  if (task.paper_markdown) return paper_markdown
  if (task.current_content) return current_content  // 仅历史兼容
  return ''
}
```

**IPC 返回策略：**
- `compatGetTaskStatus()` / `compatGetTaskResult()` 只返回包含 `paper_markdown` 和 `ooxml_snapshot` 的 LocalTaskInfo
- 内部 runtime 使用的 InternalTaskInfo 不通过 IPC 泄漏

### 数据一致性保证

- ✅ 新任务：OOXML snapshot + paper_markdown 双写
- ✅ 旧任务：markdown/current_content 兼容读取
- ✅ 混合场景：优先 OOXML，自动回退
- ✅ 流式更新：content 事件正常驱动预览