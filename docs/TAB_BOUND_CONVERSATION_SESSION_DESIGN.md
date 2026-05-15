# Tab 绑定会话（会话隔离）方案设计

> 本文档为独立方案说明，与「写作与问答双模集成」等其它计划文件并列；实现时可与问答 Dock、写作 Composer 等模块对照落地。

## 1. 背景与目标

### 1.1 问题

- 当前部分「对话框 / 生成面板」状态若采用全局单例或单一 `running` 标记，在**多 Tab 并行**时容易出现：上下文串线、状态条互相覆盖、流式回调更新到错误 Tab、插入编辑器落到错误文档等问题。

### 1.2 目标

- **每个文稿 Tab 拥有独立的会话上下文**（写作任务态 + 问答消息流 + 输入草稿等），切换 Tab 即切换会话视图。
- **并行任务**在 Tab 维度隔离；跨 Tab 事件必须带 `tabId` 路由，只更新对应会话。
- **可控资源**：限制全局并发任务数量，避免 API 与 UI 过载。
- **生命周期明确**：新建 Tab、关闭 Tab、重开文档时对会话的创建、挂起、清理规则可预期。

---

## 2. 核心概念

### 2.1 Tab 与 Session 的关系

| 概念 | 说明 |
|------|------|
| `tabId` | 现有编辑器 Tab 的稳定标识（与 `DocumentContext` 中 tab 一致）。 |
| `ConversationSession`（或 `EditorAiSession`） | 绑定到单个 `tabId` 的 AI 侧状态聚合体。 |
| `sessionByTabId` | `Record<tabId, ConversationSession>` 或 `Map<tabId, ConversationSession>` 的存储形态。 |

**原则**：凡与「当前这篇稿子上的 AI 交互」相关的可变状态，默认进入 `sessionByTabId[tabId]`，不放在无 Tab 维度的全局根上。

### 2.2 与现有 `targetTabId` 的关系

- 写作链路已有「写回哪个 Tab」的语义（如 `targetTabId`），应统一为：**任务创建时绑定 `tabId`，回调与 UI 更新只认该 `tabId`**。
- Tab 级 Session 与「任务写回目标」对齐：同一 Tab 内，会话即该 Tab 的 AI 上下文；任务落盘目标即该 Tab 对应文档。

---

## 3. 数据模型

### 3.1 `ConversationSession`（建议字段）

以下为逻辑模型，具体 TypeScript 类型可在实现时微调命名。

```ts
type SessionMode = 'idle' | 'writing' | 'qa'

type ConversationSession = {
  tabId: string

  /** 当前 Tab 更偏写作任务还是问答（用于 UI 高亮与默认入口，可与 workbench 模式协同） */
  mode: SessionMode

  /** 问答消息流（仅 qa 域使用；写作任务可不占用或仅存摘要） */
  messages: Array<{
    id: string
    role: 'user' | 'assistant' | 'system'
    content: string
    status: 'pending' | 'streaming' | 'done' | 'error'
    createdAt: string
    errorMessage?: string
    /** 可选：引用片段、知识来源等 */
    sources?: unknown[]
  }>

  /** 输入框草稿，按 Tab 隔离 */
  inputDraft: string

  /** 写作任务侧 */
  activeTaskId: string | null
  taskPhase: 'idle' | 'submitted' | 'running' | 'paused' | 'completed' | 'stopped' | 'error'
  taskStatusMessage: string

  /** 并发与取消 */
  abortController: AbortController | null

  /** 用户是否手动折叠问答回复区（与 UI 方案对齐） */
  replyPaneCollapsed: boolean

  /** 流式期间是否临时展开（生成结束后恢复用户偏好） */
  replyPaneTemporaryExpand: boolean

  /** 可选：最后活跃时间，用于 LRU 清理 */
  lastActiveAt: number
}
```

### 3.2 全局层仅存「索引与策略」

建议单独维护：

- `activeTabId`：仍由现有 `DocumentContext` 管理。
- `globalConcurrency`：当前**跨 Tab**处于 `running` 的任务数；提交新任务时若超限则排队或提示。
- `maxConcurrentTasks`：常量，建议首版 **2～3**（可配置）。

**不在全局根上存放**：某 Tab 的 `messages`、`inputDraft`、单 Tab 的 `running` 布尔（避免被覆盖）。

---

## 4. 状态存放位置（实现选型）

### 4.1 推荐：Context + reducer 或 Zustand slice

- 新增 `EditorSessionProvider`（名称可议），包裹在 `DocumentProvider` 子树内，便于读取 `tabs` / `activeTabId`。
- 内部状态：`sessions: Record<string, ConversationSession>`，`getSession(tabId)` 懒创建默认空会话。

### 4.2 与 `GenerationWorkbenchContext` 的关系

- 若当前 workbench 状态是「全局一份」，需要二选一或折中：
  - **折中（改动较小）**：workbench 仍存「当前 UI 选中的模式」，但**任务 payload 与流式累积**必须写入 `sessionByTabId[targetTabId]`。
  - **彻底（改动大）**：workbench 按 Tab 分片；仅当产品明确要求全工作台 Tab 化时再选。

首版建议 **折中**：减少动刀面，先把「任务与问答状态」Tab 化。

---

## 5. 事件路由约束（强制）

### 5.1 所有异步回调必须携带 `tabId`

包括但不限于：

- 流式 token / delta
- 任务轮询 `onProgress` / `onComplete`
- 错误回调
- 「插入到编辑器」完成后的 toast

### 5.2 更新前校验

```pseudo
onEvent(event):
  if event.tabId not in sessions: return  // 或懒建后仅处理白名单事件
  if event.tabId !== event.targetTabId && event.kind === 'writeback':
    // 写回类事件必须 targetTabId === event.tabId，否则打日志并丢弃
  updateSession(event.tabId, reducer)
```

### 5.3 UI 订阅

- 展示层组件：`const session = sessions[activeTabId]`，仅渲染当前 Tab。
- 后台 Tab 任务仍在跑时：可选在 Tab 标题上显示小角标（● 进行中），不抢全局状态条。

---

## 6. Tab 生命周期策略

### 6.1 新建 Tab

- `openTab` / 新建文档成功时：`getSession(newTabId)` 懒创建默认 `ConversationSession`（空消息、空草稿、`idle`）。

### 6.2 切换 Tab（激活变更）

- `activeTabId` 变化：UI 切换到 `sessions[newActiveId]`；**不取消**旧 Tab 未完成任务（若产品希望切换即暂停，可作为可选策略）。
- 若旧 Tab 有未读完成通知：可用 `session.hasUnreadComplete` 等小字段（可选）。

### 6.3 关闭 Tab

需产品拍板，推荐默认策略：

| 策略 | 行为 |
|------|------|
| **默认（推荐）** | 关闭 Tab 时：若该 Tab 有 `running` 写作任务，**弹出确认**「关闭将终止当前任务」；确认后 `abort` + `stopTask`；问答流可丢弃或提示「关闭后对话清空」。 |
| **温和** | 关闭 Tab 仅隐藏面板，任务转后台直至完成（需全局任务列表与恢复入口，首版成本高）。 |

首版建议 **默认策略**，实现与心智成本最低。

### 6.4 重命名 / 文件路径变更

- `tabId` 不变则 **Session 不动**；若未来存在「tabId 随文件重绑」逻辑，必须提供 `migrateSession(oldId, newId)`。

### 6.5 会话持久化（可选二期）

- 落盘：`localStorage` key `sessions_v1_${tabId}` 或与 `filePath` 绑定（重开同文件可恢复问答历史）。
- 首版可 **不做持久化**，关闭 Tab 即清空，降低数据一致性与隐私风险。

---

## 7. 并行与排队

### 7.1 Tab 内

- 同一 Tab 同时只允许 **一个** 主写作流或一个主问答流（避免同一输入框双请求）；新请求可禁用发送或排队。

### 7.2 Tab 间

- 允许 Tab A 与 Tab B 各跑一个任务，但总数受 `maxConcurrentTasks` 限制。
- 超限行为：按钮置灰 + 文案「当前已有 N 个任务在运行，请等待或前往对应 Tab 停止」；或自动排队（实现复杂，二期）。

---

## 8. UI 影响（摘要）

- **写作 Composer**：打开时传入 `targetTabId`（通常即 `activeTabId`），标题区显示 `当前文档：<文件名>`。
- **问答 Dock**：消息列表与草稿绑定 `activeTabId` 对应 Session；Header 增加「折叠/展开回复区」等与现有 UI 方案一致的控制。
- **Tab 条**：可选「进行中」角标；关闭确认与上述生命周期一致。

---

## 9. 与「写作 / 问答分流」的配合

- `SessionMode` 或 UI 入口区分「写作任务」「知识问答」，两者共享同一 `tabId` 的 Session 容器，但建议：
  - **写作**：主要写 `activeTaskId`、`taskPhase`、进度文案。
  - **问答**：主要写 `messages`、`inputDraft`。
- 「插入到编辑器」：**必须**使用 `tabId === activeTabId` 且该 Tab 为可写文稿时才允许插入；否则 toast 提示切换 Tab。

---

## 10. 实施顺序建议

1. 引入 `EditorSessionProvider` + `sessionByTabId` + `getSession` 懒创建。  
2. 将 `GenerationComposer` 中与「当前任务状态、流式缓冲」强相关的 state 迁入 Session（按 `targetTabId` 读写）。  
3. 将 `KnowledgeConversationDock` 的 `messages` / `inputDraft` / 折叠态迁入 Session。  
4. 全链路事件补 `tabId` 与更新前校验。  
5. 关闭 Tab 确认与 `maxConcurrentTasks`。  
6. （可选）Tab 角标与持久化。

---

## 11. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 状态迁移工作量大 | 先折中：仅迁移任务与问答核心状态，workbench 全局保留最小字段。 |
| 内存增长 | LRU 清理已关闭且非 running 的 Session；或限制 `messages` 条数。 |
| 回调晚到已删 Tab | `tabId` 不在 `sessions` 则丢弃并打 debug 日志。 |
| 用户误以为后台无限并行 | UI 明确并发上限与当前运行数。 |

---

## 12. 验收标准（建议）

- 打开两个 Tab，分别在 Tab A、Tab B 启动写作或问答，**互不覆盖**消息与状态。  
- 流式输出过程中切换 Tab，**仅当前 Tab UI 更新**对应内容；另一 Tab 后台继续或按策略暂停。  
- 关闭带运行任务的 Tab，按策略 **终止或提示**，无静默泄漏请求。  
- 「插入到编辑器」仅影响 **当前激活且可写** Tab 的正文。  
- 全局同时 `running` 任务数 **不超过** `maxConcurrentTasks`。

---

## 13. 文档维护

- 实现过程中若字段增减，请同步更新本文「§3 数据模型」与「§6 生命周期」。  
- 与 `DocumentContext` 的 `tab` 结构变更（如 tabId 策略）强相关时，必须在 PR 说明中显式列出迁移步骤。
