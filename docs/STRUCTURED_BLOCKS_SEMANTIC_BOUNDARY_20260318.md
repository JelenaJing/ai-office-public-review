# structuredBlocks 语义边界与使用规范

## 更新日期

2026-03-18

## 目标

明确 `structuredBlocks` 在 AI Writer 3.0 OOXML化迁移后的语义定位，防止误用为持久化真源或唯一数据格式。

## structuredBlocks 的定位

### ✅ 正确定位

1. **编辑运行时缓存**
   - structuredBlocks 是 embedded editor 运行时使用的结构化数据格式
   - 用于支持块级编辑、段落识别、引用插入等编辑器功能
   - 是用户交互过程中的临时状态表示

2. **格式转换桥梁**
   - 在 OOXML ↔ Markdown ↔ HTML 之间转换的中间格式
   - 提供统一的结构化抽象，便于不同格式之间互相转换
   - 支持 `parsePaperMarkdownToEmbeddedBlocks()` 和 `serializeEmbeddedBlocksToMarkdown()` 双向转换

3. **预览与流式传输格式**
   - 在流式生成过程中作为增量结构化数据的载体
   - 便于实时预览和渐进式渲染
   - 支持更细粒度的内容更新通知

### ❌ 错误定位

1. **不是持久化真源**
   - ❌ 不应该作为任务结果的唯一存储格式
   - ❌ 不应该在没有 OOXML 快照时成为唯一可用数据
   - ❌ 不应该被当作最终交付格式

2. **不是完整语义表示**
   - ❌ 不包含完整的文档级元数据（如页面设置、样式定义）
   - ❌ 不支持高级 OOXML 特性（如脚注、尾注、复杂表格）
   - ❌ 不能替代 OOXML 快照作为高保真数据源

3. **不是独立交换格式**
   - ❌ 不应该在没有上下文的情况下作为唯一导出格式
   - ❌ 不应该在跨系统传输时作为主要载荷
   - ❌ 需要配合 OOXML 快照或 Markdown 使用

## 当前使用场景

### 合理使用 ✅

#### 1. 生成链中间表示

```typescript
// paperGenerator.ts
const finalStructuredBlocks = parsePaperMarkdownToEmbeddedBlocks(assembledMarkdown, { 
  references: organizedReferences 
})
const ooxmlSnapshot = await buildGeneratedOoxmlSnapshot(finalStructuredBlocks)

return {
  structuredBlocks: finalStructuredBlocks,  // ✅ 作为中间格式，配合 OOXML 快照
  ooxmlSnapshot,
  markdown: assembledMarkdown,
}
```

#### 2. 流式预览更新

```typescript
// localTaskService.ts
if (Array.isArray(event.structuredBlocks) && event.structuredBlocks.length > 0) {
  current.info.current_structured_blocks = event.structuredBlocks  // ✅ 运行时缓存
}
```

#### 3. 渲染前优先级回退

```typescript
// embeddedPaperDocument.ts
export function buildPaperGenerationPreviewContent(
  markdown: string, 
  structuredBlocks?: EmbeddedPayloadBlock[], 
  ooxmlSnapshot?: Record<string, unknown>
): string {
  const ooxmlHtml = extractPaperHtmlFromOoxmlSnapshot(ooxmlSnapshot)
  if (ooxmlHtml) return ooxmlHtml  // ✅ OOXML 优先
  
  const fallbackMarkdown = structuredBlocks?.length > 0 
    ? serializeEmbeddedBlocksToMarkdown(structuredBlocks)  // ✅ 作为回退
    : ''
  // ...
}
```

### 需要改进的使用 🔄

#### 1. 对外接口暴露过多

当前 `LocalTaskInfo` 仍然对外暴露 `current_structured_blocks`：

```typescript
export interface LocalTaskInfo {
  // ...
  current_structured_blocks?: unknown[]  // 🔄 考虑仅内部使用
  current_ooxml_snapshot?: PaperOoxmlSnapshot
  paper_markdown?: string
}
```

**改进方向：**
- 考虑将 `current_structured_blocks` 移到内部接口
- 对外只提供 OOXML 快照和派生的 Markdown
- 保留 structuredBlocks 仅用于编辑器内部状态管理

#### 2. 归一化输出时过度依赖

```typescript
// PaperService.ts
function normalizeTaskResultPayload(rawResult: Record<string, any>) {
  const structuredBlocks = extractStructuredBlocks(rawResult)
  return {
    // ...
    structured_blocks: structuredBlocks,  // 🔄 是否需要对外暴露？
    structuredBlocks,
  }
}
```

**改进方向：**
- 明确哪些消费方真正需要 structuredBlocks
- 考虑只在需要编辑器交互时暴露
- 常规数据查询场景使用 OOXML 快照 + Markdown

## 数据流向与优先级

### 生成流程

```
Python Backend (生成 Markdown)
    ↓
Electron Main (解析为 structuredBlocks)
    ↓
构建 OOXML 快照 (从 structuredBlocks)
    ↓
任务结果 = {
  ooxmlSnapshot,      // 真源
  structuredBlocks,   // 中间缓存
  markdown            // 文本回退
}
```

### 读取优先级

```
读取任务内容:
  1. ✅ current_ooxml_snapshot.plainText (优先)
  2. ✅ paper_markdown (兼容)
  3. ⚠️  current_structured_blocks → serialize (回退)
  4. ⚠️  current_content (历史兼容，即将废弃)
```

### 编辑器交互

```
打开编辑器:
  1. 如有 OOXML 快照 → 解析为 structuredBlocks → 编辑器
  2. 如有 structuredBlocks 缓存 → 直接加载 → 编辑器
  3. 如只有 Markdown → 解析为 structuredBlocks → 编辑器

保存编辑:
  编辑器 structuredBlocks (当前状态)
    ↓
  构建 OOXML 快照
    ↓
  持久化 OOXML 快照 + 派生 Markdown
```

## 未来演进路径

### 短期（阶段 5 完成前）

- ✅ 保持 structuredBlocks 作为编辑器运行时格式
- ✅ 确保 OOXML 快照始终优先于 structuredBlocks
- ✅ 所有对外接口返回时必须包含 OOXML 快照

### 中期（阶段 5 完成后）

- 🔄 将 `current_structured_blocks` 从 `LocalTaskInfo` 移到内部接口
- 🔄 对外接口只暴露 OOXML 快照和 Markdown
- 🔄 structuredBlocks 仅在编辑器模块内部可见

### 长期（embedded runtime 增强后）

- 📋 如果 embedded runtime 支持直接编辑 OOXML 语义
- 📋 考虑将 structuredBlocks 降级为纯内部转换层
- 📋 最终目标：OOXML ↔ Editor 直接交互，无需 structuredBlocks 中间层

## 最佳实践

### ✅ 推荐做法

1. **生成时双写**
   ```typescript
   const structuredBlocks = parsePaperMarkdownToEmbeddedBlocks(markdown)
   const ooxmlSnapshot = await buildGeneratedOoxmlSnapshot(structuredBlocks)
   return { structuredBlocks, ooxmlSnapshot, markdown }  // ✅ 三者同时提供
   ```

2. **读取时优先 OOXML**
   ```typescript
   const text = resolvePaperText(task)  // ✅ 内部自动优先 OOXML
   ```

3. **编辑时临时使用**
   ```typescript
   const editorBlocks = task.current_structured_blocks || 
     parsePaperMarkdownToEmbeddedBlocks(task.paper_markdown)  // ✅ 运行时转换
   ```

### ❌ 避免做法

1. **只存 structuredBlocks 不存 OOXML**
   ```typescript
   return { structuredBlocks }  // ❌ 缺少 OOXML 快照
   ```

2. **优先读取 structuredBlocks**
   ```typescript
   const text = task.current_structured_blocks 
     ? serializeEmbeddedBlocksToMarkdown(task.current_structured_blocks)
     : task.paper_markdown  // ❌ 应该优先 OOXML
   ```

3. **作为独立导出格式**
   ```typescript
   await exportTask(task.current_structured_blocks)  // ❌ 应导出 OOXML 或 Markdown
   ```

## 相关文档

- [OOXML 全局迁移清单](./OOXML_GLOBAL_MIGRATION_CHECKLIST_20260318.md)
- [Embedded Office 模块更新日志](./EMBEDDED_OFFICE_MODULE_UPDATE_LOG_20260317.md)
- [AI Writer 3.0 当前状态](./AI_WRITER_3_CURRENT_STATE_20260318.md)

## 总结

**structuredBlocks 的核心定位：**
- ✅ 编辑器运行时的中间表示
- ✅ 格式转换的桥梁层
- ✅ 流式传输的结构化载体
- ❌ 不是持久化真源
- ❌ 不是完整语义表示
- ❌ 不是独立交换格式

**关键原则：OOXML 是真源，structuredBlocks 是缓存。**
