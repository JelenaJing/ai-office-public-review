# 废弃/死代码候选列表

> 审计日期：2025-01
> 说明：本列表记录当前代码库中已确认或疑似废弃的接口、函数和模块，供后续清理参考。
> **所有条目均为候选，删除前请确认无测试或运行时隐式依赖。**

---

## 一、DocumentContext API 废弃别名

### 1.1 `setTabContent`

| 属性 | 值 |
|------|---|
| 文件 | `src/contexts/DocumentContext.tsx` |
| 类型 | Context interface 方法 + 实现 |
| 状态 | 废弃别名，指向 `setTabShellContent` |
| 最后已知调用者 | **无**（grep 全库未发现调用） |
| 安全删除步骤 | 1. 从 `DocumentContextValue` interface 移除 `setTabContent` 字段<br>2. 从 context value 对象中移除对应字段<br>3. 移除 `useCallback` 实现 |
| 风险 | 🟢 低（无调用者） |

### 1.2 `markTabSaved`

| 属性 | 值 |
|------|---|
| 文件 | `src/contexts/DocumentContext.tsx` |
| 类型 | Context interface 方法 + 实现 |
| 状态 | 废弃别名，指向 `markTabShellSaved` |
| 最后已知调用者 | `src/components/EmbeddedOfficeEnginePanel.tsx` 约第 2832、3253 行 |
| 安全删除步骤 | 1. 将 `EmbeddedOfficeEnginePanel.tsx` 中两处 `markTabSaved(...)` 改为 `markTabShellSaved(...)`<br>2. 从 `DocumentContextValue` interface 和实现中移除 `markTabSaved` |
| 风险 | 🟡 低（只有一处调用，替换语义相同） |

---

## 二、editorTabs.ts 函数别名

以下别名在 `src/document/editorTabs.ts`（或对应类型文件）中定义，是旧命名的别名，
仅在 DocumentContext 内部使用：

### 2.1 `updateEditorTabContentProjection`

| 属性 | 值 |
|------|---|
| 状态 | 别名 → `setEditorTabShellContent` |
| 最后已知调用者 | 仅 DocumentContext 内部 |
| 风险 | 🟢 低 |

### 2.2 `markEditorTabSavedProjection`

| 属性 | 值 |
|------|---|
| 状态 | 别名 → `markEditorTabShellSaved` |
| 最后已知调用者 | 仅 DocumentContext 内部 |
| 风险 | 🟢 低 |

### 2.3 `getEditorTabContent` / `getEditorTabSavedContent` / `getEditorTabDirty`

| 属性 | 值 |
|------|---|
| 状态 | 别名 → `getEditorTabResolvedContent` / `getEditorTabResolvedSavedContent` / `getEditorTabResolvedDirty` |
| 最后已知调用者 | 待 grep 确认（可能仍有外部消费者） |
| 风险 | 🟡 中（需全库 grep 确认后再删） |

---

## 三、Legacy Tab 相关 API

### 3.1 `mainTabId`（DocumentContext 暴露字段）

| 属性 | 值 |
|------|---|
| 文件 | `src/contexts/DocumentContext.tsx` |
| 类型 | Context interface string 字段 |
| 用途 | 历史上的"主 Tab"概念（固定 ID 的特殊只读 tab） |
| 当前状态 | Tab 管理已改为数组，mainTab 概念已弱化 |
| 使用者 | `ResultPreviewPanel.tsx` 读取 `mainTabId` 以判断 `hasEditableDocumentTab`；`DocumentContext` 内部用于跳过脏检查 |
| 建议 | 评估是否可改为 `tabs.find(t => t.role === 'main')` 风格，彻底移除对固定 ID 的依赖 |
| 风险 | 🟡 中（有运行时读取，删除前需完整替换） |

### 3.2 `switchToMainTab()`

| 属性 | 值 |
|------|---|
| 文件 | `src/contexts/DocumentContext.tsx` |
| 类型 | Context 方法 |
| 最后已知调用者 | 待 grep 确认（早期导航逻辑）；可能已无 UI 入口 |
| 风险 | 🟡 中（需 grep 确认后决策） |

---

## 四、PPT 相关废弃 / 死代码

### 4.1 `assembleDeckDocument.ts`

| 属性 | 值 |
|------|---|
| 文件 | `src/modules/generation/ppt/assembleDeckDocument.ts` |
| 用途 | 将旧式 `PresentationContentPackage` 转换为新式 `DeckDocument`（桥接迁移层） |
| 当前状态 | **疑似无调用者**：grep `assembleDeckDocument` 全库无匹配 |
| 背景 | 新路径（链路 A）直接使用 `deckBuildFromPrompt` 生成 DeckDocument，不经过此文件；旧路径（链路 B）直接使用 `pptxRenderWithSkill`，也不经过此文件 |
| 风险 | 🟢 低（确认无调用者后可安全删除） |
| 删除验证 | `grep -r "assembleDeckDocument" src/` 应无结果 |

### 4.2 `generatePptx` IPC（Electron API）

| 属性 | 值 |
|------|---|
| 文件 | `electron/` + `src/types/electron.d.ts`（约第 240 行） |
| 用途 | 最早期的整包 PPTX 生成 IPC（单次调用全部生成） |
| 当前状态 | 在 `GenerationPromptComposer.tsx` 链路 B 末尾仅作为三级后备使用，实际触达概率极低 |
| 风险 | 🟡 中（有条件路径使用，但路径覆盖率极低；建议监控后移除） |

### 4.3 Legacy `pptxRenderWithSkill` 调用中的 `skillId: 'cuhk_sz_default'`

| 属性 | 值 |
|------|---|
| 文件 | `GenerationPromptComposer.tsx`，链路 B Phase 5 |
| 用途 | 链路 B 默认使用 `cuhk_sz_default` skill 渲染 |
| 当前状态 | 此 skillId 未出现在 `DECK_TEMPLATE_IDS` 白名单中，用户在 UI 中不可见 |
| 建议 | 若链路 B 最终被废弃，随链路 B 一起清理；否则需决定是否允许用户选择此 skill |

---

## 五、待进一步确认的候选

以下条目需要手动 grep 或测试环境运行确认，在确认前不应删除：

| 候选 | 位置 | 确认方式 |
|------|------|---------|
| `setTabContent` 相关测试 | `src/**/__tests__/` | `grep -r "setTabContent" src/` |
| `getEditorTabContent` 调用者 | 全库 | `grep -r "getEditorTabContent" src/` |
| `switchToMainTab` 调用者 | 全库 | `grep -r "switchToMainTab" src/` |
| `generatePptx` IPC Handler（Electron 侧） | `electron/` | 确认链路 B 回退路径中是否仍调用此 IPC |

---

## 六、清理收益预估

完成上述清理后的预期收益：

- **减少混淆**：移除 `setTabContent` / `markTabSaved` 别名后，DocumentContext API 接口命名一致，开发者无需区分新旧命名
- **减少维护面**：删除 `assembleDeckDocument.ts` 后，PPT 生成链路从"三条半"缩减为三条（A/B/C），降低认知负担
- **减少 TypeScript 类型噪音**：废弃别名字段从 `DocumentContextValue` interface 移除后，类型自动补全结果更干净
- **测试覆盖改善**：废弃路径删除后，现有测试不再需要覆盖不可达路径
