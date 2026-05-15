# 模块化迁移记录

> 迁移时间：2026-04-29  
> 迁移策略：**Strangler Migration**（逐模块迁移，每步构建验证，不改变任何业务逻辑）

---

## 背景与目标

原项目中所有组件统一堆放在 `src/components/` 和 `src/services/`，随着功能增长，文件之间的耦合越来越难以维护。本次迁移的核心目标：

- **隔离故障范围**：某模块出现问题只需修复该模块，不干扰其他模块
- **清晰的归属边界**：每个功能域拥有独立的 `components/`、`services/`、`hooks/`、`contexts/` 目录
- **可读性**：新开发者能快速定位某功能属于哪个模块
- **零功能回归**：每个模块迁移后立即做构建验证，确保无破坏性改动

---

## 目录结构约定

```
src/modules/
├── <module-name>/
│   ├── components/      # React 组件
│   ├── services/        # 业务逻辑、API 调用
│   ├── hooks/           # 自定义 Hook
│   ├── contexts/        # React Context
│   └── index.ts         # Barrel 导出（公共 API）
```

每个模块的 `index.ts` 是对外的唯一接口，外部模块只能通过 barrel 引用，不应直接深入 `components/` 或 `services/` 子目录。

---

## 迁移模块总览

| 模块 | 迁移状态 | 构建验证 |
|------|----------|----------|
| homework | ✅ 完成 | ✅ 通过 |
| plot | ✅ 完成 | ✅ 通过 |
| email | ✅ 完成 | ✅ 通过 |
| image | ✅ 完成 | ✅ 通过 |
| formal | ✅ 完成 | ✅ 通过 |
| paper | ✅ 完成 | ✅ 通过 |
| knowledge | ✅ 完成 | ✅ 通过 |
| generation | ✅ 完成 | ✅ 通过 |
| writing | ✅ 完成 | ✅ 通过 |

---

## 各模块详细说明

### 1. `writing` — 文档编辑与 AI 写作助手

**路径：** `src/modules/writing/`

**职责：**  
核心写作编辑器模块，提供基于 TipTap 的富文本编辑器，支持表格、公式、引用、Markdown 等。集成多种 AI 写作辅助能力，包括续写、改写、章节感知重构、引言重写等。同时负责文档预览渲染和 Docx 导出。

**包含文件：**

| 文件 | 说明 |
|------|------|
| `components/EditorPanel.tsx` | 主编辑器面板，TipTap 编辑器宿主，扩展注册、工具栏、快捷键 |
| `components/DocumentEngineHost.tsx` | 文档引擎宿主，懒加载 EditorPanel，管理文档生命周期 |
| `components/DocumentPreviewPane.tsx` | 文档预览面板，支持 frame/block 两种预览模式 |
| `components/ReadonlyDocumentPreview.tsx` | 只读文档预览，用于生成结果展示 |
| `components/ContinueWritingPanel.tsx` | 续写面板，收集续写目标并触发流式续写 |
| `components/DocumentEngineBanner.tsx` | 文档引擎顶部状态条 |
| `services/WritingAssistantService.ts` | AI 写作助手服务，统一封装写作相关 AI 请求 |
| `services/ContinueWritingService.ts` | 续写服务，处理流式续写逻辑 |
| `services/RewriteService.ts` | 改写服务 |
| `services/sectionAwareRemake.ts` | 章节感知重构，解析文档结构并生成重写上下文 |
| `services/introductionRemakeFlow.ts` | 引言重写流程 |
| `services/importDocumentForRemake.ts` | 导入外部文档用于重构流程 |

**被依赖方（外部调用者）：**
- `src/components/WorkspaceViewportHost.tsx`（加载 DocumentEngineHost）
- `src/components/EmbeddedOfficeEnginePanel.tsx`（调用多个服务）
- `src/modules/generation/`、`src/modules/formal/`、`src/modules/email/`、`src/modules/knowledge/`（调用 WritingAssistantService）

---

### 2. `generation` — 内容生成工作台

**路径：** `src/modules/generation/`

**职责：**  
核心内容生成引擎，提供灵活的生成工作台，支持多种生成模式（文章、邮件、论文等）。管理生成组合界面、模式切换、知识库集成和结果预览。

**包含文件：**

| 文件 | 说明 |
|------|------|
| `components/GenerationWorkbenchPanel.tsx` | 生成工作台主面板 |
| `components/GenerationComposer.tsx` | 生成内容组合器，管理生成流程和状态 |
| `components/GenerationPromptComposer.tsx` | Prompt 编辑与提交界面 |
| `components/GenerationKnowledgeSidebar.tsx` | 知识库侧边栏集成 |
| `components/GenerationModeSwitcher.tsx` | 生成模式切换器 |
| `components/ResultPreviewPanel.tsx` | 生成结果预览面板 |
| `components/generationDockPrimitives.tsx` | 工作台 UI 基础组件 |
| `components/generationWorkbenchConfig.ts` | 工作台配置常量 |
| `components/generationWorkbenchUtils.ts` | 工作台工具函数（路径标准化、时间戳等） |

---

### 3. `knowledge` — 个人知识库

**路径：** `src/modules/knowledge/`

**职责：**  
管理用户个人知识库和研究资料。提供文档浏览与选择、基于对话的知识检索、知识工作区物化等能力。为其他模块（生成、邮件、正式文档等）提供知识引用注入。

**包含文件：**

| 文件 | 说明 |
|------|------|
| `components/KnowledgeConversationDock.tsx` | 知识对话面板，基于知识库内容进行 AI 对话 |
| `components/KnowledgeSelectionDock.tsx` | 知识文档选择面板 |
| `components/PersonalLibrarySidebar.tsx` | 个人文档库侧边栏，文件/文件夹浏览 |
| `components/KnowledgeTaskSelector.tsx` | 知识任务选择器 |
| `services/knowledgeWorkspace.ts` | 知识工作区服务，管理知识资料集合 |

---

### 4. `email` — AI 邮件助手

**路径：** `src/modules/email/`

**职责：**  
提供 AI 驱动的邮件撰写和回复辅助界面。模拟邮件客户端，支持线程对话、AI 草稿生成，并可将知识库内容注入邮件回复上下文。

**包含文件：**

| 文件 | 说明 |
|------|------|
| `components/EmailWorkbench.tsx` | 邮件工作台主界面 |
| `components/MailModeWorkbench.tsx` | 邮件模式工作台 |
| `contexts/EmailContext.tsx` | 邮件状态上下文，管理账户、线程、草稿 |
| `contexts/MockEmailContext.tsx` | 模拟邮件上下文（开发/测试用） |
| `services/mockEmailService.ts` | 模拟邮件服务 |

---

### 5. `formal` — 正式文档模板生成

**路径：** `src/modules/formal/`

**职责：**  
基于结构化模板和字段值生成正式文档（合同、简历、申请表等）。引导用户经历「分析 → 确认 → 预览 → 提交」多阶段流程，结合知识库引用生成规范化文档。

**包含文件：**

| 文件 | 说明 |
|------|------|
| `components/FormalTemplatePanel.tsx` | 正式文档模板主面板 |
| `components/FormalTemplateGeneratePanel.tsx` | 模板生成面板，展示生成进度与预览 |
| `components/FormalTemplateKnowledgeSidebar.tsx` | 知识库侧边栏（正式文档场景） |
| `contexts/FormalTemplateSessionContext.tsx` | 生成会话状态上下文（阶段、预览、结果） |
| `hooks/useFormalTemplateGeneration.ts` | 模板生成逻辑 Hook |

---

### 6. `paper` — 学术论文生成

**路径：** `src/modules/paper/`

**职责：**  
专注于 AI 驱动的学术论文和长篇研究报告生成。提交生成任务、监控状态、流式获取结果并预览 Markdown，支持嵌入块、引用管理和大纲快照。

**包含文件：**

| 文件 | 说明 |
|------|------|
| `components/PaperGenerationPanel.tsx` | 论文生成面板，任务提交与结果展示 |
| `services/PaperService.ts` | 论文生成服务，任务管理与 API 调用 |
| `services/paperStreaming.ts` | 流式论文内容接收与渲染 |

---

### 7. `image` — AI 图片生成

**路径：** `src/modules/image/`

**职责：**  
提供 AI 图片生成功能，支持 Prompt 输入、风格配置、宽高比选择和负向 Prompt。可从知识库文档中提取风格参考，生成的图片可直接插入文档。

**包含文件：**

| 文件 | 说明 |
|------|------|
| `components/ImageWorkspace.tsx` | 图片生成工作台主界面 |
| `services/ImageService.ts` | 图片生成服务，API 封装 |
| `services/imageGenerationPrompt.ts` | 图片生成 Prompt 构建工具 |
| `services/imageStyleProfile.ts` | 图片风格配置管理 |
| `services/sharedImageGeneration.ts` | 跨模块共享的图片生成工作流 |

---

### 8. `homework` — AI 学习助手

**路径：** `src/modules/homework/`

**职责：**  
提供多种 AI 辅助学习场景：PDF 作业题目提取与解答、在线课程内容辅助、论坛讨论辅助。支持自动识别选择题和简答题，并流式生成答案。

**包含文件：**

| 文件 | 说明 |
|------|------|
| `components/HomeworkWorkbench.tsx` | 作业助手工作台（PDF 题目提取与解答） |
| `components/AiClassWorkbench.tsx` | AI 课堂工作台 |
| `components/AiForumWorkbench.tsx` | AI 论坛工作台 |
| `components/WebviewWorkbench.tsx` | 内嵌 Webview 工作台 |

---

### 9. `plot` — 数据可视化

**路径：** `src/modules/plot/`

**职责：**  
基于上传的数据文件（CSV、Excel）进行 AI 驱动的图表生成。分析数据结构，推荐最合适的图表类型（含置信度和理由），并调用 Python 绘图服务实时生成统计图表。

**包含文件：**

| 文件 | 说明 |
|------|------|
| `components/PlotWorkspace.tsx` | 数据可视化工作台 |
| `services/PlotService.ts` | 图表生成服务，数据分析与图表 API 调用 |

---

## 不迁移的部分（有意保留）

以下文件**未纳入任何模块**，原因是它们被 20+ 个跨模块文件共同依赖，迁移收益远低于迁移成本：

| 文件/目录 | 原因 |
|-----------|------|
| `src/contexts/KnowledgeContext.tsx` | 全局知识状态，几乎所有模块都依赖 |
| `src/contexts/GenerationWorkbenchContext.tsx` | 全局生成状态上下文 |
| `src/components/EmbeddedOfficeEnginePanel.tsx` | 超大复合组件，是整个嵌入式 Office 引擎的入口，不属于任何单一模块 |
| `src/components/WorkspaceViewportHost.tsx` | 顶层路由/视口宿主，负责调度所有模块 |
| `src/engines/` | 文档引擎底层运行时，所有模块共用 |
| `src/utils/`、`src/hooks/`、`src/types/` | 全局工具库，跨模块共享 |

---

## 迁移原则

1. **只移动文件，不改逻辑**：迁移过程中只修改 import 路径，绝不修改任何业务代码
2. **每步验证**：每个模块迁移完成后立即执行 `npm run build`，return code 0 才继续
3. **Barrel 隔离**：每个模块通过 `index.ts` 对外暴露公共 API，内部结构对外不可见
4. **独立故障域**：一个模块的问题不会传播到其他模块，修复时只需关注该模块目录

---

## 后续建议

- [ ] 逐步将 `EmbeddedOfficeEnginePanel.tsx` 拆分为更小的协作组件，最终归入对应模块
- [ ] 考虑将全局 Context（`KnowledgeContext`、`GenerationWorkbenchContext`）迁移到独立的 `src/core/` 层
- [ ] 为每个模块的 `index.ts` 补充 JSDoc，明确公共 API 契约
- [ ] 可引入 ESLint 模块边界规则（如 `eslint-plugin-boundaries`）防止跨模块直接引用内部文件
