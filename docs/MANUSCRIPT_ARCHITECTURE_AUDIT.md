# 文稿功能架构审计报告

> 审计日期：2025-01
> 覆盖文件：`src/contexts/DocumentContext.tsx`、`src/modules/writing/components/EditorPanel.tsx`、`src/components/EmbeddedOfficeEnginePanel.tsx`、`src/modules/generation/components/ResultPreviewPanel.tsx`、`src/types/documentTabs.ts`

---

## 一、整体架构概述

文稿功能建立在 `DocumentContext` 之上，采用**多标签页（Tab）+ 单活跃内容镜像**的模式。

```
DocumentContext
  ├── tabs: EditorTab[]          // 所有标签页快照
  ├── activeTabId: string        // 当前活跃标签 ID
  ├── markdown: string           // 活跃标签内容镜像（用于编辑器渲染）
  ├── filePath: string | null    // 活跃标签文件路径
  └── dirty: boolean             // 活跃标签脏状态
```

### 1.1 标签页类型（EditorTab）

共有两种标签页，通过 `tabKind` 区分：

| 类型 | `tabKind` | 内容存储字段 | 脏状态来源 |
|------|-----------|-------------|------------|
| `LegacyEditorTab` | `'legacy'` | `content: string`（当前内容）+ `savedContent: string`（已保存内容） | `content !== savedContent` |
| `ManuscriptEditorTab` | `'manuscript'` | `manuscriptState.currentCompatHtml`（当前 HTML）+ `manuscriptState.acceptedCompatHtml`（已接受内容） | `currentArtifactKey !== acceptedArtifactKey` |

两种类型共享 **shell projection** 字段（`content`、`savedContent`、`dirty`），通过 `getEditorTabResolvedContent()`、`getEditorTabResolvedDirty()` 统一读取。

### 1.2 新内容写入流程

AI 生成文稿后，写入路径为：

```
GenerationPromptComposer.handleGenerateDocument()
  → useFormalTemplateGeneration.generateDocument()
    → FormalTemplateSessionContext.commitResult
      → DocumentContext.ensureWritableManuscriptTarget()
          ├── 优先复用活跃的可写 ManuscriptEditorTab
          ├── 无则弹出保存当前文稿对话框
          └── 创建新的 ManuscriptEditorTab（createManuscriptEditorTab）
      → EditorPanel 监听 manuscriptState 变化，更新 Tiptap 编辑器内容
```

`ManuscriptEditorTab` 的内容真正的存储入口是 `syncManuscriptTabState(tabId, nextState)`，它接受 `currentCompatHtml`、`acceptedCompatHtml`、`currentArtifactKey`、`acceptedArtifactKey` 的增量更新。

### 1.3 保存流程

文稿保存通过 `registerSaveHandler` / `runSaveHandler` 的**回调注入模式**实现：

```
EditorPanel.tsx
  → registerSaveHandler(async () => {
       await saveActiveDocument({ reason: 'manual' })
       return true
    })
    
DocumentContext.ensureCurrentDocumentSaved()
  → 先尝试 saveHandlerRef.current()   // 静默保存
  → 失败则弹出 UnsavedDialogOverlay
    → 用户选择「保存(S)」→ 调用 saveHandlerRef.current()
    → 用户选择「不保存(N)」→ 调用 discardHandlerRef.current()
    → 用户选择「取消」→ 返回 false
```

---

## 二、已识别缺陷

### BUG-1：`closeTab` 关闭非活跃脏标签时校验对象错误

**位置**：`src/contexts/DocumentContext.tsx`，`closeTab` 函数

**问题描述**：

```typescript
const closeTab = useCallback(async (tabId: string) => {
  const targetTab = tabsRef.current.find((tab) => tab.id === tabId)
  if (getEditorTabResolvedDirty(targetTab)) {
    if (!await ensureCurrentDocumentSaved('关闭标签页')) return  // ← BUG
  }
```

`ensureCurrentDocumentSaved` 内部读取的是 `activeTabIdRef.current`（当前活跃标签），而 `saveHandlerRef.current` 也只绑定了当前活跃编辑器的保存能力。

**复现场景**：  
1. 标签 A（活跃，干净），标签 B（后台，有未保存修改）  
2. 用户点击关闭标签 B  
3. `closeTab` 检测到 B 有脏状态，调用 `ensureCurrentDocumentSaved`  
4. 对话框弹出，询问是否保存——但 `saveHandlerRef` 绑定的是标签 A 的保存处理器  
5. 用户点「保存」→ 实际保存了标签 A，标签 B 的内容丢失  
6. 用户点「不保存」→ 调用 `discardTabChanges(tabId)` 正确，但对话框描述具有误导性

**影响等级**：🔴 高（数据丢失风险）

**修复建议**：

```typescript
const closeTab = useCallback(async (tabId: string) => {
  const targetTab = tabsRef.current.find((tab) => tab.id === tabId)
  if (getEditorTabResolvedDirty(targetTab)) {
    // 只有当要关闭的是当前活跃标签时，才能使用通用 ensureCurrentDocumentSaved
    if (activeTabIdRef.current === tabId) {
      if (!await ensureCurrentDocumentSaved('关闭标签页')) return
    } else {
      // 非活跃脏标签：只弹简化确认框，选择「不保存」直接丢弃
      const decision = await openUnsavedDialog({
        title: '是否保存后台标签页？',
        fileName: targetTab?.fileName || '后台文档',
        description: `"${targetTab?.fileName || '后台文档'}"有未保存的修改，关闭后将丢失。`,
        actionLabel: '关闭标签页',
      })
      if (decision === 'cancel') return
      // decision==='save' 无法处理（saveHandler 未注册），等同于 discard
      if (isManuscriptEditorTab(targetTab) && decision !== 'discard') return
      discardTabChanges(tabId)
    }
  }
  // ... 正常关闭逻辑
}, [...])
```

---

### BUG-2：`discardTabChanges` 对 ManuscriptEditorTab 静默跳过

**位置**：`src/contexts/DocumentContext.tsx`，`discardTabChanges` 函数

**问题描述**：

```typescript
const discardTabChanges = useCallback((tabId: string) => {
  // ...
  setTabs((prev) => prev.map((tab) => {
    if (tab.id !== tabId) return tab
    if (isManuscriptEditorTab(tab)) return tab  // ← 直接 return，未做任何丢弃处理
    return markEditorTabShellSaved(tab, {
      content: getEditorTabResolvedSavedContent(tab),
    })
  }))
  // ...
})
```

对于 `ManuscriptEditorTab`，`discardTabChanges` 什么也不做。若用户在「未保存对话框」选择「不保存」，且当前标签是 ManuscriptEditorTab，则：
- 该标签仍保留 `dirty` 状态
- 用户期望的内容回滚未发生
- `closeTab` 随后可能又触发同样的脏检测，形成循环

**影响等级**：🟠 中（功能失效，操作流程破损）

**修复建议**：ManuscriptEditorTab 的 discard 应将 `currentArtifactKey`、`currentCompatHtml` 重置回 `acceptedArtifactKey`、`acceptedCompatHtml`：

```typescript
if (isManuscriptEditorTab(tab)) {
  return updateManuscriptEditorTab(tab, {
    currentArtifactKey: tab.manuscriptState.acceptedArtifactKey,
    currentCompatHtml: tab.manuscriptState.acceptedCompatHtml,
  })
}
```

---

### BUG-3：`newTab()` 始终创建 LegacyEditorTab

**位置**：`src/contexts/DocumentContext.tsx`，`newTab` 函数

**问题描述**：

```typescript
const newTab = useCallback(async () => {
  // ...
  const id = `tab_${Date.now()}`
  setTabs((prev) => [...syncCurrentTabSnapshot(prev), 
    createLegacyEditorTab({ id, filePath: null, fileName: '未命名文档', content: '', savedContent: '', dirty: false })
  ])
  // ...
}, [])
```

新建标签页总是 `LegacyEditorTab`，但 AI 生成文稿需要 `ManuscriptEditorTab`（`ensureWritableManuscriptTarget` 会检查 `isWritableManuscriptEditorTab`）。新建的 legacy 标签不满足 manuscript 条件，`ensureManuscriptTab` 会再额外创建一个 ManuscriptEditorTab，导致出现两个标签页而非预期的一个。

**注意**：`newTab` 当前无外部调用者（grep 确认只在 `DocumentContext` 内部定义和暴露），但若未来在 UI 上新增「新建文档」按钮，此问题会显现。

**影响等级**：🟡 低（现有流程未触达，但有潜在问题）

---

### DESIGN-1：`setTabContent` / `markTabSaved` 已成死 API

**位置**：`src/contexts/DocumentContext.tsx` 第 94、96 行

这两个接口名是 legacy 别名，实际只有 `EmbeddedOfficeEnginePanel.tsx` 一处调用了 `markTabSaved`，且语义与 `markTabShellSaved` 完全重叠。

**建议**：在 `EmbeddedOfficeEnginePanel.tsx` 替换为 `markTabShellSaved`，然后从 `DocumentContext` 接口和实现中移除这两个别名。

---

### DESIGN-2：`markdown` 镜像与 tabs 状态存在双写风险

**位置**：`DocumentContext`

```
tabs[activeTabId].content  ← 真值
markdown (state)           ← 镜像，用于 Editor 渲染
```

两者通过 `setMarkdown` / `activateTabState` 等多个路径同步，但若某路径未同步（如 `syncCurrentTabSnapshot`），会导致 `markdown` 与 `tabs[activeTabId]` 不一致。

目前可靠性依赖于严格的调用规范，建议统一通过单一函数 `activateTabState` 进行切换，其他路径不直接修改 `markdownRaw`。

---

## 三、API 健壮性速览

| API | 健壮性评价 |
|-----|-----------|
| `openTab()` | ✅ 完善：有去重（canonicalDocumentId > filePath > sourceContext）、有 ensureCurrentDocumentSaved 检查 |
| `switchTab()` | ✅ 完善：切换前检查当前活跃 tab 脏状态 |
| `closeTab()` | ❌ 存在 BUG-1（见上） |
| `ensureManuscriptTab()` | ✅ 完善：支持 preferredTabId、requireDraft、空标签复用 |
| `syncManuscriptTabState()` | ✅ 完善：正确区分活跃/后台标签 |
| `registerSaveHandler()` | ✅ 完善：返回清理函数 |
| `discardTabChanges()` | ❌ 存在 BUG-2（ManuscriptEditorTab 未处理） |

---

## 四、生命周期与持久化

- **内存持久化**：`DocumentContext` 是应用顶层 Provider，存活周期与应用等长，标签页状态不会因路由跳转丢失。
- **应用关闭防护**：通过 `window.addEventListener('beforeunload', ...)` 拦截浏览器/Electron 窗口关闭，有未保存内容时阻止关闭。
- **Electron 关闭请求**：通过 `electronAPI.onAppCloseRequest` 接收 Electron 关闭信号，设置 `appCloseInProgressRef` 后直接允许关闭（非阻断）。

---

## 五、建议优先级汇总

| 优先级 | 编号 | 描述 |
|-------|------|------|
| 🔴 立即修复 | BUG-1 | `closeTab` 关闭非活跃脏标签时保存了错误的标签内容 |
| 🟠 近期修复 | BUG-2 | ManuscriptEditorTab 的 discardTabChanges 未实现，导致「不保存」操作失效 |
| 🟡 低优先级 | BUG-3 | `newTab()` 应创建 ManuscriptEditorTab 或在 UI 层确认调用场景 |
| 📌 清理 | DESIGN-1 | 移除 `setTabContent` / `markTabSaved` 废弃别名 |
| 📝 监控 | DESIGN-2 | `markdown` 双写路径审查，确保所有激活路径均通过 `activateTabState` |
