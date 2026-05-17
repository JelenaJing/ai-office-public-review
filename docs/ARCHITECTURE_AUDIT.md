# 架构综合审计报告

> 审计日期：2025-01
> 范围：文稿编辑功能 + PPT 生成功能（前端，Electron + React 桌面端）
> 详细分析见：`MANUSCRIPT_ARCHITECTURE_AUDIT.md`、`PPT_ARCHITECTURE_AUDIT.md`
> 废弃候选见：`DEPRECATED_CANDIDATES.md`

---

## 一、系统概述

```
ai_writer3.0
├── 文稿编辑子系统
│   ├── DocumentContext（状态管理）
│   ├── EditorPanel（Tiptap 编辑器）
│   ├── EmbeddedOfficeEnginePanel（Word/OOXML 编辑器）
│   └── FormalTemplateSession（生成结果提交）
└── PPT 生成子系统
    ├── GenerationWorkbenchContext（生成会话状态）
    ├── GenerationPromptComposer（生成逻辑入口）
    ├── ResultPreviewPanel（结果操作面板）
    └── PptWorkbenchPanel（PPT 专用操作）
```

---

## 二、跨子系统数据流

### 文稿 → PPT 联动路径

```
用户在文稿 Tab 点击「生成 PPT」
  → ResultPreviewPanel.handleGeneratePptFromDocument()
    → createPptPrimarySourceState({ documentArtifact, previewText })
      → workbench.setModeSession('ppt', { pptPrimarySource: ..., pendingAutoSubmitToken: ... })
        → enterPptGenerationMode()
          → GenerationPromptComposer 检测到 pendingPptAutoSubmitToken 变化
            → handleGeneratePpt({ fromManuscriptAutoSubmit: true })
              → 若 manuscriptText.length > 200 → deckBuildFromManuscript
              → 否则 → deckBuildFromPrompt
```

此路径完整，但有一个边界问题：`pptPrimarySource` 中的文稿内容快照仅在"跳转时刻"取一次，若用户在切换到 PPT 模式前又修改了文稿，快照与最新内容可能不一致。

---

## 三、关键缺陷总表

| ID | 子系统 | 类型 | 严重性 | 简述 | 修复难度 |
|----|-------|------|--------|------|---------|
| BUG-1 | 文稿 | 数据丢失 | 🔴 高 | `closeTab` 关闭非活跃脏标签时，保存对话框作用于错误的活跃标签 | 中 |
| BUG-2 | 文稿 | 功能失效 | 🟠 中 | ManuscriptEditorTab 的 `discardTabChanges` 未实现，「不保存」操作静默失效 | 低 |
| BUG-3 | 文稿 | 潜在 | 🟡 低 | `newTab()` 始终创建 LegacyEditorTab，与 AI 生成依赖 ManuscriptEditorTab 的假设不一致 | 低 |
| BUG-4 | PPT | 数据丢失 | 🔴 高 | PPT 关键会话字段（deckDocumentId、liveSlides 等）不持久化，重启后丢失 | 低 |
| BUG-5 | PPT | 功能失效 | 🔴 高 | 「替换模板」/「重渲染」按钮重启后失效（依赖 BUG-4 修复） | 低（依赖BUG-4） |
| BUG-6 | PPT | 代码质量 | 🟡 低 | `handleGeneratePpt` 中 `pptStopRef` 重复 stop check，逻辑冗余 | 极低 |
| DESIGN-1 | 文稿 | API 清理 | 📌 低 | `setTabContent` / `markTabSaved` 废弃别名未清理，最后调用者在 `EmbeddedOfficeEnginePanel.tsx` | 低 |
| DESIGN-2 | 文稿 | 维护风险 | 📝 低 | `markdown` 镜像与 `tabs` 状态存在多路径双写风险 | 中 |
| DESIGN-3 | PPT | 功能不一致 | 🟠 中 | 链路 A 首次生成模板硬编码 `'business_report'`，未读取用户选择的模板 | 低 |
| DESIGN-4 | PPT | 死代码 | 📌 低 | `assembleDeckDocument.ts` 疑似无调用者 | 极低 |
| DESIGN-5 | PPT | 维护风险 | 📝 低 | `DECK_TEMPLATE_IDS` 白名单硬编码，新增模板需手动维护 | 低 |

---

## 四、关键设计边界

### 4.1 文稿内容真值（Single Source of Truth）

| 标签类型 | 内容真值字段 | 脏状态真值 |
|---------|------------|----------|
| `LegacyEditorTab` | `content: string` | `content !== savedContent` |
| `ManuscriptEditorTab` | `manuscriptState.currentCompatHtml` | `currentArtifactKey !== acceptedArtifactKey` |

二者通过 shell projection（`getEditorTabResolvedContent` 等函数）统一对外暴露，外部消费者不应直接区分两种类型。

### 4.2 PPT 内容真值与状态格局

两条生成链路产出完全不同的"真值标识"：

| 来源 | 内容真值标识 | 模板重渲染 API |
|------|-----------|--------------|
| 链路 A（deckBuild） | `pptDeckDocumentId` | `window.electronAPI.deckRender` |
| 链路 B（per-slide） | `pptContentPackageId` | `window.electronAPI.pptxRenderWithSkill` |
| 链路 C（import） | `pptDeckDocumentId` | `window.electronAPI.deckRender` |

代码中所有"执行后续操作"的处理器（`handlePptRerender`、`handlePptUpdateSlide`、`handleAiOptimizePptStructure`）均通过 `if (pptDeckDocumentId) ... else if (pptContentPackageId) ...` 正确分支——此设计可行但脆弱：若两者同时有值（理论上不应发生），分支行为不可预测。

**建议**：引入显式 enum 字段 `pptContentKind: 'deck' | 'package' | null` 来明确当前活跃的内容格局，替代依赖两个字段的隐式约定。

---

## 五、修复优先级建议

### 阶段 1（当前 sprint，防止数据丢失）

1. **BUG-4**：`GenerationWorkbenchContext` 持久化 `pptDeckDocumentId`、`pptActiveTemplateManifestId`、`pptContentPackageId`、`pptOriginalFilePath`、`pptActiveSkillId` 到 localStorage
2. **BUG-1**：`closeTab` 非活跃脏标签关闭逻辑隔离

### 阶段 2（下一 sprint，功能完整性）

3. **BUG-5**：BUG-4 完成后联动验证「替换模板」按钮可用
4. **BUG-2**：`discardTabChanges` 补充 ManuscriptEditorTab 的回滚逻辑
5. **DESIGN-3**：链路 A 读取用户选择的模板 ID

### 阶段 3（技术债清理）

6. **DESIGN-1**：清理 `setTabContent` / `markTabSaved` 废弃别名
7. **DESIGN-4**：确认后删除 `assembleDeckDocument.ts`
8. **BUG-3**：确定 `newTab()` 的预期行为并修正
9. **DESIGN-5**：将 `DECK_TEMPLATE_IDS` 改为后端接口动态返回

---

## 六、无问题模块（供参考）

以下模块在此次审计中未发现显著缺陷：

- `src/document/manuscriptTabState.ts`：ManuscriptTabState 数据结构与变换函数设计合理，`discardManuscriptTabState` 已实现，但未被 DocumentContext 正确调用（BUG-2 问题所在）
- `ResultPreviewPanel.handleImportPptContent`：导入流程完整，DeckDocument 创建、预览加载、状态设置逻辑均正确
- `ResultPreviewPanel.handlePptRerender`：重渲染分支逻辑（DeckDoc vs ContentPackage）正确
- `ResultPreviewPanel.handlePptSkillApplied`：模板切换后更新 liveSlides 预览逻辑正确
- 全局 PPT 停止机制（`pptStopRef` + `abortControllerRef` + `aiCancelTask`）：信号传播路径清晰，stop 检查覆盖主要阶段
