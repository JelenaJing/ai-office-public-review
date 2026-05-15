# AI Writer 3.0 Embedded Office 模块更新日志

> 日期: 2026-03-17
> 目标: 把 ai_writer3.0 的后续更新统一收敛到内置 Office 引擎主线，并按模块记录变更，避免上下文丢失。

## 使用约定

- 后续每次涉及 embedded office 主线的改动，都在本文件追加一条模块记录。
- 每条记录只描述一个模块，避免把多类改动混在同一段里。
- 记录顺序按模块推进，而不是按临时问题顺序堆叠。

## 模块清单

### 模块 A: 引擎注册与默认路由

- 当前状态: 已完成主线切换
- 代码位置:
  - src/engines/documentEngine/registry.ts
  - src/components/DocumentEngineHost.tsx
  - src/components/DocumentEngineBanner.tsx
- 本次更新:
  - 默认活动引擎切为 embedded-office-engine
  - 历史 localStorage 中的 legacy-tiptap-bridge 偏好自动迁移到 embedded-office-engine
  - Banner 文案改为“embedded 为主，legacy 为回退”
- 影响范围:
  - 3.0 的默认打开路径
  - 宿主层面板选择
  - 状态展示与对外口径

### 模块 B: 宿主命令与文件 IO

- 当前状态: 已接入，持续增强中
- 代码位置:
  - src/engines/documentEngine/hostCommands.tsx
  - electron/main/services/documentEngineService.ts
- 已知结论:
  - open/save/save-as 已由 host 接管
  - DOCX 在 embedded runtime 下优先走 OOXML snapshot + 回写链路
- 下一步:
  - 统一 rename/move/refresh 等文件动作到 host 语义层

### 模块 C: Embedded Runtime 编辑面板

- 当前状态: 第一版已可用，仍需继续保真化
- 代码位置:
  - src/components/EmbeddedOfficeEnginePanel.tsx
  - src/engines/documentEngine/embeddedOfficeAdapter.ts
- 已知能力:
  - 文本块/图片/公式/表格对象级编辑
  - DOCX OOXML block snapshot 读写
- 当前限制:
  - 还不是 Word/WPS 原生版面级引擎
  - 复杂分页、脚注、页眉页脚、批注等高级语义仍需继续补齐

### 模块 D: Legacy Bridge 回退层

- 当前状态: 保留，不再作为主线
- 代码位置:
  - src/components/EditorPanel.tsx
  - src/engines/documentEngine/legacyTiptapAdapter.ts
- 使用原则:
  - 仅在回退、对照验证、局部兼容时使用
  - 不再把新的 3.0 核心能力优先堆在 legacy 路径上

### 模块 E: AI 生成与文档引擎联动

- 当前状态: 已接入，仍需结构化收敛
- 代码位置:
  - src/components/PaperGenerationPanel.tsx
  - electron/main/services/paperGenerator.ts
  - electron/main/services/localTaskService.ts
- 已知结论:
  - 论文生成链路要以 embedded engine 的结构化落地为目标
  - 不能再以 TipTap HTML 的偶然样式结果作为 3.0 主线判据
- 下一步:
  - 继续减少生成链对 legacy HTML 预览假设的依赖
  - 把生成结果更稳定地接到 embedded block/object 模型

- 本次更新:
  - 新增 src/engines/documentEngine/embeddedPaperDocument.ts，作为论文生成到 embedded 文档模型的专用模块
  - 论文生成链现在优先把累计 Markdown 解析为结构化 blocks，再编码成 embedded payload
  - EmbeddedOfficeEnginePanel 已能直接识别 embedded payload，并把 blocks 作为真源载入
  - PaperGenerationPanel 与 legacy 回退入口 EditorPanel 已统一复用同一套 preview content builder，避免生成链继续假设 HTML 为唯一中间态

### 模块 F: 结构化内容传输层

- 当前状态: 第一版已落地
- 代码位置:
  - src/engines/documentEngine/embeddedPaperDocument.ts
  - src/components/EmbeddedOfficeEnginePanel.tsx
- 作用:
  - 让论文生成结果以结构化 payload 形式注入 embedded engine
  - 将 Markdown 中的标题、摘要、关键词、图片、公式、表格优先映射成 block/object 结构
- 当前边界:
  - 这是论文生成专用结构化传输层，不是通用 OOXML 文档 AST
  - 后续如要支持更复杂的学术对象，需要继续扩充 block schema 和解析器

- 本次更新:
  - main process 的 paper content 事件已进一步切到 structuredBlocks-first；当结构化块存在时，IPC content 事件不再把 cumulativeMarkdown 当主载荷透出
  - LocalTaskService 的任务状态现在优先保存 current_structured_blocks 与 current_ooxml_snapshot，current_content 只在流式阶段缺少结构化快照时作为最小回退文本保留

### 模块 G: 任务管理与兼容字段收缩

- 当前状态: 持续简化中
- 代码位置:
  - electron/main/services/localTaskService.ts
  - electron/main/services/workspaceService.ts
  - src/services/PaperService.ts
  - src/components/GenerationComposer.tsx
- 已知结论:
  - 任务管理 UI 已完全移除（TaskManagementPanel）
  - 任务历史持久化已从 workspaceService 移除
  - current_content 已从公共 LocalTaskInfo 接口移除，仅保留为内部 InternalTaskInfo 的私有回退字段
  - renderer 统一通过 resolvePaperText() 优先读取 OOXML -> paper_markdown -> current_content（历史兼容）
- 本次更新 (2026-03-18):
  - 新增 src/services/paperStreaming.ts 作为 renderer 侧流式 content 事件处理的统一 helper
  - GenerationComposer 已切换为使用 resolveStreamingPreviewMarkdown() 处理 content 事件，支持增量 delta 和 cumulative 两种模式
  - 新增 build/run-paper-streaming-smoke.ts 作为流式正文更新的最小验证清单
  - smoke:paper-stream 脚本已加入 package.json，验证通过
  - LocalTaskInfo 的公共接口不再包含 current_content，改为暴露 paper_markdown（可从 OOXML 或 structuredBlocks 派生）
  - InternalTaskInfo 新增，用于内部 runtime 持有 current_content fallback，不通过 IPC 对外暴露
  - buildCompatTaskInfo() 现在派生 paper_markdown 并保证公共返回不包含 current_content

### 模块 H: Smoke Test 与回归验证

- 当前状态: 两个核心 smoke test 已落地
- 代码位置:
  - build/run-ooxml-roundtrip-smoke.ts
  - build/run-paper-streaming-smoke.ts
  - package.json (smoke:ooxml, smoke:paper-stream)
- 验证覆盖:
  - ✅ OOXML 包读写往返（documentXml 解析、paragraph/block 抽取、原包回写）
  - ✅ 流式正文增量更新（content delta append、cumulativeMarkdown 优先、structuredBlocks 序列化回退）
  - ✅ resolvePaperText() OOXML-first 链路（plainText > paper_markdown > current_content）
  - ✅ buildPaperGenerationPreviewContent() OOXML HTML 优先级
- 本次更新 (2026-03-18):
  - paper streaming smoke test 已通过完整验证，包含 6 项核心断言
  - 独立 smoke 编译路径已修正类型边界问题（compatSubmitTask 参数显式断言）
  - 两个 smoke test 都可独立运行且不依赖主构建产物
  - renderer 侧 PaperService 已新增统一的 `resolvePaperText()` 收口 helper，渲染层对论文正文的读取优先级统一为 OOXML snapshot -> markdown -> structured blocks -> 回退文本
  - compat:getTaskStatus / getActiveTasks / getRecentTasks 仍保留 `current_content` 只读兼容面，但不再为其额外派生结构化或 OOXML 内容
  - compat:getTaskResult 继续以 structuredBlocks 与 ooxmlSnapshot 为真源，对外保留 markdown/paper_markdown 兼容派生输出
  - 任务历史列表、历史 IPC 与 `.ai-writer/task-history.json` 写入口已下线，任务链路不再维护历史任务归档

### 模块 G: 非论文类 AI 编辑能力适配现状

- 当前状态: 混合态，底层 runtime 已有接口，但 UI/流程尚未全部迁入 embedded 主线
- 代码位置:
  - src/components/EditorPanel.tsx
  - src/components/EmbeddedOfficeEnginePanel.tsx
  - src/engines/documentEngine/embeddedOfficeAdapter.ts
  - src/engines/documentEngine/legacyTiptapAdapter.ts
- 已知结论:
  - 引用插入: 运行时接口已抽象为 `insertComment`，EditorPanel 的“查引用后插入”已改为走当前 runtime，不再硬绑 legacyRuntime
  - 图片插入: embedded runtime 已原生支持 `insertAnchoredImage` -> image block，并能把本地图片稳定化到工作区后写入对象块；EditorPanel 的“AI 生成图片后自动插入”也已改为走当前 runtime
  - 续写: EditorPanel 内联续写现已改为通过 runtime 的统一 `applyTextEdit` 命令落地，不再直接走 `__editorAppend` 或 `setMarkdown`
  - 重写: EditorPanel 的接受重写与 GenerationComposer 的局部改写写回，现已统一通过 runtime 的 `applyTextEdit` 落地
  - 公式: 底层已双 runtime 支持；embedded runtime 能原生插入 formula block，legacy runtime 仍插 Tiptap formula node
- 当前判断:
  - 非论文功能里，EditorPanel 这条主编辑链已经把“引用插入、图片插入、续写写回、重写写回”统一收口到 document-engine runtime
  - 仍未完成 embedded 主线适配的是“EmbeddedOfficeEnginePanel 自身缺少对等 AI 入口 UI/上下文菜单/工具面板”这一层；也就是说底层写入命令已统一，交互入口还没有全部迁到 embedded 面板

- 本次更新:
  - EmbeddedOfficeEnginePanel 已补上内联 AI 工具入口：当前主面板顶部现可直接触发 AI 续写、重写选中、查文献并插入、生成图片并插入，以及任务管理/工具箱/AI 设置入口
  - embedded 主面板已补齐重写确认弹层与文献检索插入弹层，相关写回统一走当前 embedded runtime，而不是旁路 legacy EditorPanel
  - ImageWorkspace 已移除对 `__editorAppend` 的依赖，插图动作改为通过当前 document-engine runtime 的 `insertAnchoredImage` 落地
  - EditorPanel 已清掉 `__editorAppend` / `__editorInstance` 兼容残留，选区获取与右键菜单现统一走当前 runtime
  - EditorPanel 已补齐与 embedded 更接近的 AI 入口集合：顶部增加 AI 工具条，右键菜单新增“仅改写选中内容”，并统一文案为“一键生成全文 / 仅改写选中 / AI 设置”
  - EditorPanel 的“全文生成”默认入口已不再直接走本地论文任务轮询链，而是与 embedded 一样收敛到 `GenerationComposer` 的 document 模式；右键从选中内容触发时，两侧也都会把选中文字带入 composer 作为同一类生成指令
  - 当前剩余缺口已进一步收缩到“legacy 与 embedded 的编辑承载层不同，但 AI 入口的默认生成语义、停止语义、局部改写写回语义已基本一致”
  - Windows 打包命名已从 2.0 切换到 3.0：electron-builder 的 `productName`、portable artifactName、appId，以及 Electron 窗口标题/侧栏回退标题/OpenAlex user-agent 均已统一到 3.0，并重新产出新的 portable exe 供首轮 Windows 回归测试

## Embedded 首轮最小回归清单

1. 启动 [release/AI-Writer-3.0-3.0.0-alpha.1-Portable.exe](../release/AI-Writer-3.0-3.0.0-alpha.1-Portable.exe) ，确认窗口标题与包名均显示为 AI-Writer 3.0。
2. 新建一个空白文档，确认默认主编辑链进入 embedded 面板，而不是自动退回 legacy EditorPanel。
3. 在正文输入一小段测试文本，右键选中其中一句，点击“仅改写选中内容”，确认会打开 composer，生成结果后能准确替换选区。
4. 继续选中一段主题句，右键点击“一键生成全文”，确认两边现在都走 composer document 模式，且选中文字会作为初始指令带入。
5. 在一段已有正文后触发“AI 续写”，确认生成结果会直接写回当前光标/选区后方，没有落到错误标签页。
6. 选中一段可检索文献的描述，执行“查找文献并插入”，确认能插入 citation/comment，且工作区引用数据同步更新。
7. 选中一段适合出图的描述，执行“生成图片并插入”，确认图片会写回当前 embedded 文档，并在工作区有对应文件落盘。
8. 执行“保存回写”导出 DOCX，关闭并重新打开该 DOCX，确认重写文本、引用标记、图片对象都仍然存在。
9. 最后切回一个 legacy/fallback 场景做一次快速冒烟，确认 EditorPanel 仍可打开文件、保存文件、使用相同 AI 入口，但默认生成语义已与 embedded 对齐。

## 当前决策

- 从 2026-03-17 起，ai_writer3.0 的默认文档主线明确为 embedded-office-engine。
- 后续若修 legacy 相关问题，只能作为回退兼容修复，不应改变 3.0 的主路径定位。
- 后续大更新优先按模块推进，并先更新本日志，再做跨模块联动改动。
