# PPT 功能架构审计报告

> 审计日期：2025-01
> 覆盖文件：`src/contexts/GenerationWorkbenchContext.tsx`、`src/modules/generation/components/GenerationPromptComposer.tsx`、`src/modules/generation/components/ResultPreviewPanel.tsx`、`src/modules/generation/components/PptWorkbenchPanel.tsx`、`src/modules/generation/ppt/assembleDeckDocument.ts`

---

## 一、整体架构概述

PPT 生成功能的数据流如下：

```
WorkspaceModeContext
  └── currentMode: 'ppt'
      ↓
GenerationWorkbenchContext (sessions.ppt)
  ├── pptDeckDocumentId        — DeckDocument 路径（新路径）
  ├── pptActiveTemplateManifestId — 当前模板 manifestId
  ├── pptContentPackageId      — ContentPackage ID（旧路径）
  ├── pptLiveSlides            — 当前幻灯片预览列表
  ├── pptTaskStatus            — 生成阶段状态机
  └── pptSourceType            — 'generated' | 'imported_pptx'
      ↓
GenerationPromptComposer.handleGeneratePpt()   ← 生成逻辑入口
      ↓
ResultPreviewPanel                             ← 结果展示与操作入口
  └── PptWorkbenchPanel                        ← PPT 专用操作面板（模板切换、重渲染）
```

---

## 二、三条 PPT 生成链

当前代码中存在**三条**相互独立的 PPT 生成路径，每条路径产出不同的状态格局：

### 链路 A：DeckDocument 优先路径（当前主路径）

**入口**：`GenerationPromptComposer.handleGeneratePpt()`，"NEW PRIMARY PATH" 注释块

**流程**：
```
deckBuildFromPrompt / deckBuildFromManuscript
  → deckRender({ deckId, manifestId: 'business_report' })
    → deckLoad（加载 slide 预览内容）
      → deckPreview（用 PowerPoint COM 渲染 PNG 缩略图）
```

**成功后会话状态**：
```
pptDeckDocumentId = deckId   ✅
pptActiveTemplateManifestId = 'business_report'  ✅
pptContentPackageId = null   （清空）
pptActiveSkillId = 'business_report'
pptLiveSlides = [...deckSlidePreviews]
```

**`isManuscriptMode` 判断**：
- 仅当 `opts?.fromManuscriptAutoSubmit === true` 且 `manuscriptText.length > 200` 时为 true
- 手动对话框生成，无论是否挂载了 `pptPrimarySource`，均走 `deckBuildFromPrompt`

**默认模板**：硬编码为 `'business_report'`，无法通过界面在首次生成时修改。

---

### 链路 B：Legacy Per-Slide 回退路径

**触发条件**：链路 A 的 `deckBuildFromPrompt` 或 `deckRender` 抛出异常，或返回非成功状态

**流程**：
```
Phase 1: LLM 生成大纲 JSON（buildPptOutlineInstruction）
Phase 2: 逐页 LLM 生成幻灯片 JSON（buildSlideDetailInstruction）
         ↓ 每完成一页增量保存
Phase 3: 图片分配（知识库匹配 → 用户勾选图片 → AI 图片生成）
Phase 4: pptxSaveContentPackage（保存 ContentPackage）
Phase 5: pptxRenderWithSkill({ skillId: 'cuhk_sz_default' })
```

**成功后会话状态**：
```
pptContentPackageId = finalPackageId  ✅
pptActiveSkillId = 'cuhk_sz_default'
pptDeckDocumentId = null   （清空）
pptActiveTemplateManifestId = null（未设置）
pptLiveSlides = [...per-slide data]
```

**消耗 LLM 次数**：1（大纲）+ N（每页 1 次，N=8~16）次，合计最多 17 次 LLM 调用，远高于链路 A 的 1 次。

---

### 链路 C：PPT 导入路径

**入口**：`ResultPreviewPanel.handleImportPptContent()`

**流程**：
```
pptxImportFromDialog({ workspacePath })
  → 返回 deckDocumentId + deckPath + originalPptxPath + previewSlides
    → 设置 pptDeckDocumentId, pptSourceType='imported_pptx'
    → pptActiveTemplateManifestId = null（源预览模式，暂未应用模板）
```

**成功后会话状态**：
```
pptDeckDocumentId = imported.deckDocumentId  ✅
pptSourceType = 'imported_pptx'
pptActiveTemplateManifestId = null  （尚未应用模板）
pptActiveSkillId = null
pptContentPackageId = (不变，保留之前值)
```

---

## 三、状态格局差异总结

| 字段 | 链路 A（生成-DeckDoc） | 链路 B（生成-Legacy） | 链路 C（导入） |
|------|----------------------|--------------------|--------------|
| `pptDeckDocumentId` | ✅ 有值 | ❌ null | ✅ 有值 |
| `pptContentPackageId` | ❌ null | ✅ 有值 | ❌ 保留旧值 |
| `pptActiveTemplateManifestId` | `'business_report'` | ❌ null | ❌ null |
| `pptActiveSkillId` | `'business_report'` | `'cuhk_sz_default'` | ❌ null |

`handlePptRerender`（重渲染）和 `handlePptSkillApplied`（模板切换）均通过 `pptDeckDocumentId ?? pptContentPackageId` 分支判断，与上述格局一致——当前分支逻辑是正确的，但极度依赖"两者不会同时为有值"的隐式约定。

---

## 四、已识别缺陷

### BUG-4：PPT 关键会话状态不持久化，应用重启后全部丢失

**位置**：`src/contexts/GenerationWorkbenchContext.tsx`，`saveTimerRef` useEffect 中的持久化逻辑

**问题描述**：

`GenerationWorkbenchContext` 将会话状态保存到 `localStorage`，但 PPT 会话字段只持久化了：

```typescript
const toSave = {
  ...session,
  pptPrimarySource: session.pptPrimarySource,  // ← 仅此一项
  lastUpdatedAt: session.lastUpdatedAt,
}
```

**未持久化的关键字段**：

| 字段 | 影响 |
|------|------|
| `pptDeckDocumentId` | 应用重启后无法再对该 deck 执行重渲染 / 模板切换 / AI 优化 |
| `pptActiveTemplateManifestId` | 重启后不知道上次用了哪个模板 |
| `pptContentPackageId` | legacy 路径的内容包 ID 丢失（注意：有自动恢复逻辑，见下） |
| `pptOriginalFilePath` | 导入 PPT 的源文件路径丢失，「打开源文件」按钮失效 |
| `pptOriginalFileName` | 丢失，UI 显示文件名回退到空 |
| `pptLiveSlides` | 幻灯片列表清空，预览面板空白 |
| `pptActiveSkillId` | 重启后不知道上次用了哪个技能 |

**部分缓解**：`ResultPreviewPanel` 中有一个 `useEffect` 在 PPT 模式激活时，自动从磁盘恢复最近的 `ContentPackage`：

```typescript
// 只恢复 pptContentPackageId（链路 B），不恢复 pptDeckDocumentId（链路 A / C）
workbench.setModeSession('ppt', (session) => ({
  ...session,
  pptContentPackageId: session.pptContentPackageId || latest.packageId,
}))
```

但此缓解只作用于链路 B，链路 A 和链路 C 的 `pptDeckDocumentId` 无法自动恢复。

**影响等级**：🔴 高（应用重启后 PPT 工作台功能性断裂）

**修复建议**：

```typescript
// GenerationWorkbenchContext.tsx，toSave 构造处补充：
const toSave = {
  ...session,
  pptPrimarySource: session.pptPrimarySource,
  pptDeckDocumentId: session.pptDeckDocumentId,
  pptActiveTemplateManifestId: session.pptActiveTemplateManifestId,
  pptContentPackageId: session.pptContentPackageId,
  pptOriginalFilePath: session.pptOriginalFilePath,
  pptOriginalFileName: session.pptOriginalFileName,
  pptActiveSkillId: session.pptActiveSkillId,
  // 注意：pptLiveSlides 体积较大，建议只持久化 imagePath（PNG 路径列表），
  //       运行时内容（body/items）在需要时从 DeckDocument 重新加载
  pptTotalSlides: session.pptTotalSlides,
  lastUpdatedAt: session.lastUpdatedAt,
}
```

---

### BUG-5：「替换模板」按钮在应用重启后无法使用

**位置**：`src/modules/generation/components/PptWorkbenchPanel.tsx`，`handleOpenTemplateDrawer`

**问题描述**：

```typescript
const hasTemplateContent = !!contentPackageId || !!deckDocumentId
// 如果 pptDeckDocumentId 和 pptContentPackageId 均为 null（应用重启后）
// → hasTemplateContent = false
// → 点击「替换模板」按钮弹出提示：「请先导入或生成 PPT 内容后再替换模板」
```

用户已生成过 PPT，但重启应用后，`pptDeckDocumentId` 由于 BUG-4 未持久化而为 null，导致所有需要它的操作（模板切换、AI 优化结构、重渲染）均失效。

**影响等级**：🔴 高（应用重启后用户无法对已生成 PPT 执行任何后处理操作）

**依赖关系**：修复 BUG-4（持久化 pptDeckDocumentId）可一并修复此问题。另外，`PptWorkbenchPanel` 也可增加「从历史记录中重新加载」的恢复入口。

---

### BUG-6：`pptStopRef` 重复检查代码（冗余条件）

**位置**：`GenerationPromptComposer.tsx`，`handleGeneratePpt` 新路径块内

**问题描述**：

```typescript
if (pptStopRef.current) { ... return }  // line ~1832
// ...
if (pptStopRef.current) { ... return }  // line ~1840（内容完全相同，冗余）
```

在 `deckBuildResult` 成功/失败处理之前，连续出现两次相同的 stop check。这不会引起功能问题，但增加了可读性负担。

**影响等级**：🟡 低（代码质量问题）

---

### DESIGN-3：默认 PPT 模板硬编码为 `'business_report'`，首次生成无法更改

**位置**：`GenerationPromptComposer.tsx`，链路 A 的 `deckRender` 调用

**问题描述**：

```typescript
deckRenderResult = await window.electronAPI.deckRender({
  workspacePath: activeWorkspacePath,
  deckId,
  manifestId: 'business_report',  // ← 始终硬编码
})
```

即使用户在 `GenerationPromptComposer` 的模板下拉框中选择了其他模板（如 `'academic_defense'`），链路 A 在首次生成时也不会使用该选择。模板选择只在链路 B 的 `pptxRenderWithSkill` 调用处被读取。

**影响等级**：🟠 中（功能与 UI 不一致）

**修复建议**：链路 A 中读取 `selectedTemplateId`（组件 state）并传入 `manifestId`：

```typescript
deckRenderResult = await window.electronAPI.deckRender({
  workspacePath: activeWorkspacePath,
  deckId,
  manifestId: selectedTemplateId || 'business_report',
})
```

---

### DESIGN-4：`assembleDeckDocument.ts` 疑似孤立代码

**位置**：`src/modules/generation/ppt/assembleDeckDocument.ts`

**问题描述**：此文件将旧式 `PresentationContentPackage`（链路 B 产物）转换为新式 `DeckDocument`（链路 A 产物），作为两者的"桥接层"。但当前主路径（链路 A）不经过此文件，链路 B（旧式 per-slide 生成）也未调用此函数——链路 B 直接通过 `pptxRenderWithSkill` 渲染，不转换为 DeckDocument。

通过 grep 全局搜索 `assembleDeckDocument` 未发现任何调用者，此模块可能是废弃的迁移桥接代码。

**影响等级**：🟡 低（无运行时影响，但增加维护认知负担）

**建议**：确认无调用者后，进入待删除候选列表。

---

### DESIGN-5：`DECK_TEMPLATE_IDS` 白名单硬编码

**位置**：`ResultPreviewPanel.tsx`，PPT 模式 `useEffect` 内

```typescript
const DECK_TEMPLATE_IDS = ['academic_defense', 'chinese_season', 'business_report']
setPptAvailableSkills(result.skills.filter(
  (s) => DECK_TEMPLATE_IDS.includes(s.id) || s.source === 'skill'
))
```

此白名单控制了模板切换抽屉中显示的模板列表，新增的 deck template 必须先加入此数组，否则不会显示在 UI 中。这是有意的过滤还是遗漏维护，需要确认。

---

## 五、持久化状态完整性矩阵

| 字段 | 是否持久化 | 是否有恢复机制 | 应用重启后可用性 |
|------|-----------|-------------|----------------|
| `pptPrimarySource` | ✅ | N/A | 完整恢复 |
| `pptDeckDocumentId` | ❌ | ❌ | **丢失** |
| `pptActiveTemplateManifestId` | ❌ | ❌ | **丢失** |
| `pptContentPackageId` | ❌ | ⚠️ 部分（从磁盘最新包） | 部分恢复 |
| `pptLiveSlides` | ❌ | ⚠️ 可从 deckLoad 重建 | **丢失（需手动重建）** |
| `pptOriginalFilePath` | ❌ | ⚠️ 可从 deckLoad 读 source.sourcePath | 需额外操作 |
| `pptActiveSkillId` | ❌ | ❌ | **丢失** |
| `pptOriginalFileName` | ❌ | ❌ | **丢失** |
| `pptTotalSlides` | ❌ | ❌ | **丢失** |

---

## 六、建议优先级汇总

| 优先级 | 编号 | 描述 |
|-------|------|------|
| 🔴 立即修复 | BUG-4 | 持久化 pptDeckDocumentId 等关键字段到 localStorage |
| 🔴 连带修复 | BUG-5 | 「替换模板」按钮重启后失效（依赖 BUG-4 修复） |
| 🟠 近期修复 | DESIGN-3 | 链路 A 应读取用户选择的模板 ID 而非始终使用 `'business_report'` |
| 🟡 低优先级 | BUG-6 | 移除 `pptStopRef` 重复 stop check |
| 📌 待确认删除 | DESIGN-4 | `assembleDeckDocument.ts` 可能是孤立桥接代码 |
| 📝 监控 | DESIGN-5 | `DECK_TEMPLATE_IDS` 白名单是否需要与后端 skill 清单动态同步 |
