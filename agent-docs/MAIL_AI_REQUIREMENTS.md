# AI Office 邮件功能全流程完善任务说明

> 建议文件位置：`docs/MAIL_AI_FULL_FLOW_TASK.md`  
> 项目：AI Office / AI Writer 3.0  
> 技术栈：Electron + Vite + React + TypeScript  
> 目标模块：邮件 / 通讯工作台  
> 任务目标：把邮件模块从普通邮箱客户端升级为 **AI 邮件任务中心**

---

## 0. 核心结论

邮件模块不应只是收件箱、发件箱、写信、回复。

它应该成为 AI Office 的任务入口：

```text
收到邮件
→ AI 分析邮件
→ 判断邮件类别、重要性、紧急性
→ 判断用户需要做什么
→ 生成待办事项
→ 生成可编辑预回复
→ 需要时结合知识库生成准确回复
→ 需要时从当前工作区选择附件
→ 收到的附件可以保存到工作区并打开到对应工作台
→ 用户确认后发送
→ 邮件处理行为进入工作日志 / 日报
```

本任务要求推进完整主流程，不是只做第一阶段。

---

## 1. 开发前必须检查的代码区域

请先完整检查当前项目中已有邮件相关代码，不要盲目新建重复模块。

项目路径通常是：

```text
E:\ai-office\ai_writer3.0
```

重点检查：

```text
src/communication/
src/modules/communication/
src/modules/chat/
src/contexts/
src/services/
electron/main/
electron/main/services/
preload/
```

重点搜索：

```text
CommunicationWorkbench
ComposeModal
email:send
email:fetch
email:fetchSent
email:deleteMessage
email:readAttachment
email:saveAttachment
emailSalutationBuilder
recipientResolver
unifiedDirectoryResolver
workActivityLog
knowledge
workspace
IMAP
SMTP
AI 邮件分析
```

---

## 2. 开发原则

必须遵守：

1. 基于现有代码渐进式修改。
2. 不要推翻重写整个通信模块。
3. 不要新建重复的邮件系统。
4. 不要破坏已有收件箱、邮件详情、新建邮件、回复邮件、已发送、删除、通讯录、即时通讯等已有功能。
5. 不要做纯前端假流程，优先接真实邮件、真实附件、真实工作区文件。
6. UI 中不要出现 `demo`、`test`、`mock`、`测试模式`、`示例数据` 等字样。
7. AI 可以自动分析、自动生成待办、自动生成草稿。
8. AI 不允许自动发送正式邮件，必须用户确认后发送。
9. AI 不允许永久删除邮件。
10. 垃圾邮件只能进入垃圾邮件区 / 回收站，必须可恢复。
11. 所有 AI 生成回复必须可编辑。
12. 用户编辑过的草稿不能被重新分析无理由覆盖。
13. 不允许伪造知识库依据。
14. 知识库找不到明确依据时，必须提示人工确认。
15. 不允许把本地绝对路径、邮箱密码、token、服务器配置暴露给 LLM。
16. 所有数据必须按当前登录账号和当前工作区隔离。
17. 不要引入硬编码邮箱账号。

---

## 3. 最终能力树

邮件模块最终应具备以下能力：

```text
邮件 / 通讯工作台
├── 基础邮箱能力
│   ├── 收件箱
│   ├── 已发送
│   ├── 草稿
│   ├── 回收站
│   ├── 垃圾邮件
│   ├── 邮件详情
│   ├── 新建邮件
│   ├── 回复邮件
│   ├── 转发邮件
│   ├── 删除邮件
│   └── 附件展示
│
├── AI 邮件分析
│   ├── 邮件摘要
│   ├── 邮件分类
│   ├── 重要性判断
│   ├── 紧急性判断
│   ├── 是否需要回复
│   ├── 是否需要行动
│   ├── 是否需要知识库
│   ├── 是否需要附件
│   ├── 是否需要打开附件
│   └── 风险提示
│
├── 邮件待办
│   ├── 待回复
│   ├── 待修改附件
│   ├── 待上传材料
│   ├── 待确认
│   ├── 今日截止
│   ├── 本周截止
│   └── 已完成
│
├── AI 预回复
│   ├── 直接回答
│   ├── 请求补充信息
│   ├── 确认收到
│   ├── 承诺稍后处理
│   ├── 拒绝 / 无法处理
│   ├── 转交他人
│   ├── 发送附件
│   ├── 提交修改结果
│   └── 正式说明流程
│
├── 知识库增强回复
│   ├── 判断是否需要知识库
│   ├── 生成知识库检索关键词
│   ├── 检索现有知识库
│   ├── 根据知识库生成回复
│   └── 无依据时提示人工确认
│
├── 附件与工作区联动
│   ├── 从工作区选择附件发送
│   ├── 收到附件保存到工作区
│   ├── docx 打开到文稿工作台
│   ├── pptx 打开到 PPT 工作台
│   ├── xlsx / csv 打开到 Excel 工作台
│   └── 修改后的文件可重新作为回复附件
│
└── 日志 / 日报
    ├── AI 邮件分析日志
    ├── 邮件待办日志
    ├── 邮件发送日志
    ├── 附件处理日志
    └── 知识库回复日志
```

---

## 4. AI 邮件分析数据结构

请定义或完善以下类型。字段命名可根据现有项目风格调整，但前后端必须统一。

```ts
export type AiEmailCategory =
  | 'spam'
  | 'promotion'
  | 'system_notice'
  | 'internal_notice'
  | 'student_request'
  | 'colleague_collaboration'
  | 'task_assignment'
  | 'approval_request'
  | 'meeting_invitation'
  | 'document_review'
  | 'data_report_request'
  | 'project_update'
  | 'urgent_issue'
  | 'ordinary';

export type AiEmailImportance = 'high' | 'medium' | 'low';

export type AiEmailUrgency = 'urgent' | 'soon' | 'normal' | 'none';

export type AiEmailTodoType =
  | 'reply_email'
  | 'edit_document'
  | 'review_attachment'
  | 'prepare_material'
  | 'upload_file'
  | 'confirm_information'
  | 'schedule_meeting'
  | 'approve_or_reject'
  | 'analyze_data'
  | 'forward_to_others';

export type AiEmailTargetWorkspace =
  | 'document'
  | 'ppt'
  | 'excel'
  | 'mail'
  | 'none';

export type AiEmailTodoStatus = 'pending' | 'done';

export interface AiEmailTodo {
  id: string;
  title: string;
  description?: string;
  type: AiEmailTodoType;
  priority: AiEmailImportance;
  deadline?: string | null;
  sourceEmailId: string;
  targetWorkspace?: AiEmailTargetWorkspace;
  status: AiEmailTodoStatus;
  createdAt: string;
  updatedAt?: string;
}

export type AiEmailReplyIntent =
  | 'direct_answer'
  | 'ask_for_more_information'
  | 'acknowledge_received'
  | 'promise_later'
  | 'reject_or_decline'
  | 'forward_to_others'
  | 'send_attachment'
  | 'submit_revision'
  | 'explain_policy'
  | 'none';

export interface AiEmailAnalysisResult {
  emailId: string;

  summary: string;
  category: AiEmailCategory;
  importance: AiEmailImportance;
  urgency: AiEmailUrgency;

  requiresReply: boolean;
  requiresAction: boolean;
  requiresKnowledgeBase: boolean;
  requiresAttachment: boolean;
  requiresOpenAttachment: boolean;

  suggestedAction: string;
  suggestedKnowledgeQueries: string[];

  todos: AiEmailTodo[];

  replyIntent: AiEmailReplyIntent;
  draftReply?: string;

  riskFlags: string[];

  analyzedAt: string;
  updatedAt?: string;
}
```

---

## 5. 邮件分类规则

AI 不允许自由生成分类名称，必须从固定分类中选择。

| 分类值 | 中文含义 | 默认处理 |
|---|---|---|
| `spam` | 垃圾邮件 | 移入垃圾邮件区 / 回收站，可恢复 |
| `promotion` | 推广 / 营销邮件 | 低优先级，可移入垃圾邮件区 |
| `system_notice` | 系统通知 | 摘要，不一定回复 |
| `internal_notice` | 校内通知 / 组织通知 | 摘要，可生成待办 |
| `student_request` | 学生咨询 | 通常需要知识库回复 |
| `colleague_collaboration` | 同事协作 | 判断任务、截止时间、是否回复 |
| `task_assignment` | 任务分配 | 生成待办 |
| `approval_request` | 审批 / 确认请求 | 标记待确认，生成建议回复 |
| `meeting_invitation` | 会议邀请 | 提取时间、地点、参会动作 |
| `document_review` | 文件修改 / 附件处理 | 打开附件进入工作台 |
| `data_report_request` | 数据 / 报表请求 | 进入 Excel / 数据分析工作台 |
| `project_update` | 项目进展 | 摘要并判断是否跟进 |
| `urgent_issue` | 紧急事项 | 高亮、置顶、生成预回复 |
| `ordinary` | 普通邮件 | 摘要 + 普通回复建议 |

---

## 6. 重要性与紧急性

必须分开实现 `importance` 和 `urgency`。

### 6.1 importance

```text
high    重要
medium  一般
low     不重要
```

判断依据：

1. 发件人身份。
2. 是否来自上级、老师、客户、学生、管理员。
3. 是否明确点名当前用户。
4. 是否要求回复。
5. 是否要求修改附件。
6. 是否涉及审批、投诉、申请、报销、政策流程、重要会议。
7. 是否有附件或要求提交材料。

### 6.2 urgency

```text
urgent  紧急
soon    尽快处理
normal  正常
none    不紧急
```

判断依据：

1. 是否出现明确截止时间。
2. 是否出现 `urgent`、`ASAP`、`today`、`tomorrow`、`by Friday`。
3. 是否出现 `尽快`、`今天`、`明天`、`截止`、`马上`、`立刻`。
4. 是否会议时间临近。
5. 是否阻塞流程继续推进。

---

## 7. 分阶段完整实施计划

本任务要求按阶段推进完整流程，不要只停在第一阶段。

---

### 阶段一：AI 邮件分析数据结构与服务

目标：

```text
建立 AI 邮件分析的基础类型、服务和持久化能力
```

任务：

1. 定义 AI 邮件分析相关类型。
2. 实现 AI 邮件分析服务。
3. 分析输入包括：
   - 邮件 ID
   - 主题
   - 发件人
   - 收件人
   - 时间
   - 正文
   - 附件信息
   - 当前账号信息
   - 当前用户身份，若已有
   - 线程上下文，若已有
4. 分析输出必须为结构化结果。
5. 只分析当前登录账号的当前收件箱 / INBOX 未读邮件。
6. 由用户点击“AI 邮件分析”按钮触发。
7. 实现分析结果持久化。

持久化要求：

1. 切换页面后分析结果不丢。
2. 刷新后分析结果不丢。
3. 同一封邮件不要重复生成多个相同待办。
4. 数据按账号隔离。
5. 用户编辑过的草稿不要被覆盖。

---

### 阶段二：邮件列表和邮件详情展示 AI 分析结果

目标：

```text
让 AI 分析结果真正落到 UI
```

任务：

1. 邮件工作台顶部保留或新增按钮：`AI 邮件分析`。
2. 点击按钮后：
   - 拉取当前账号未读收件箱邮件。
   - 执行 AI 分析。
   - 显示分析进度。
   - 分析完成后刷新邮件列表和详情状态。
3. 邮件列表展示：
   - 摘要
   - 分类标签
   - 重要性标签
   - 紧急性标签
   - 是否需回复
   - 是否有待办
   - 是否需要知识库
   - 是否有附件
   - 截止时间，若有
4. 邮件详情页展示 AI 分析区：
   - 分类
   - 重要性
   - 紧急性
   - 是否需要回复
   - 是否需要行动
   - 是否需要知识库
   - 建议操作
   - 风险提示
   - 建议知识库关键词

---

### 阶段三：邮件待办事项

目标：

```text
根据邮件自动生成待办事项，并形成邮件待办视图
```

任务：

1. 从 AI 分析结果中的 `todos` 生成邮件待办。
2. 邮件详情页展示当前邮件的 AI 待办。
3. 每条待办显示：
   - 标题
   - 描述
   - 优先级
   - 截止时间
   - 状态
   - 来源邮件
4. 每条待办提供操作：
   - 打开原邮件
   - 生成回复
   - 打开附件，若有关联附件
   - 从工作区添加附件
   - 标记完成
5. 增加或完善“邮件待办”视图。
6. 待办分组：
   - 待回复
   - 待修改附件
   - 待上传材料
   - 待确认
   - 今日截止
   - 本周截止
   - 已完成
7. 待办必须能点击回到原邮件。
8. 待办状态需要持久化。
9. 重新分析邮件时，不要覆盖用户手动完成状态。

---

### 阶段四：AI 预回复

目标：

```text
对需要回复的邮件生成可编辑 AI 回复草稿
```

任务：

1. 对 `requiresReply = true` 的邮件生成 `draftReply`。
2. 邮件详情页增加或完善 AI 回复草稿区域。
3. 草稿区域必须：
   - 可编辑
   - 可保存
   - 可重新生成
   - 可切换语气
   - 可发送
   - 不自动发送
4. 支持语气选项：
   - 正式
   - 简洁
   - 友好
   - 强硬
   - 英文正式
   - 中文正式
5. 预回复生成时参考：
   - 原邮件标题
   - 原邮件正文
   - 发件人
   - 收件人
   - 当前用户身份
   - 邮件分类
   - 重要性
   - 紧急性
   - 待办事项
   - 附件情况
   - 知识库检索结果，若有
   - 历史线程上下文，若已有
6. 用户编辑后的草稿必须持久化。
7. 用户点击发送时，复用现有邮件发送 / 回复 IPC，保持邮件线程。
8. 发送成功后：
   - 刷新已发送
   - 更新当前邮件状态
   - 可将对应待办标记为完成
   - 写入工作日志

---

### 阶段五：知识库增强回复

目标：

```text
让邮件回复可以结合知识库，不再只根据邮件正文生成
```

任务：

1. AI 分析时判断 `requiresKnowledgeBase`。
2. 如果 `requiresKnowledgeBase = true`，使用 `suggestedKnowledgeQueries` 检索现有知识库。
3. 优先复用项目中已有知识库模块，不要新建孤立知识库系统。
4. 检索结果传入 AI 回复生成上下文。
5. 邮件详情页展示知识库区域：
   - 检索关键词
   - 使用到的知识条目标题
   - 是否找到明确依据
6. 如果知识库没有找到明确依据，草稿区必须提示：

```text
当前知识库没有找到明确依据，建议人工确认后发送。
```

7. 不允许 AI 胡编政策、截止时间、流程、审批要求。

典型场景：

```text
学生询问 late drop 如何申请
→ 分类为 student_request
→ requiresKnowledgeBase = true
→ 检索 late drop、退课、申请流程、deadline
→ 根据知识库生成正式回复
→ 无依据时提示人工确认
```

---

### 阶段六：工作区附件上传到邮件

目标：

```text
回复邮件时，用户可以从当前工作区选择文件作为附件发送
```

任务：

1. 在新建邮件、回复邮件、AI 草稿区域增加：`从工作区添加附件`。
2. 能读取当前工作区文件列表。
3. 用户选择文件后加入邮件附件列表。
4. 发送邮件时通过现有 `email:send` 或回复 IPC 携带附件。
5. 附件信息包括：
   - 文件名
   - MIME type
   - 文件大小
   - 安全文件引用或 buffer
6. 不要把本地绝对路径暴露给 LLM。
7. 发送成功后刷新状态。
8. 附件失败时显示清晰错误，不要静默失败。

附件来源包括：

```text
本地上传
当前工作区文件
文稿工作台生成的 docx / pdf
PPT 工作台生成的 pptx / pdf
Excel 工作台生成的 xlsx / csv / 图表 / 报告
知识库文件
原邮件附件修改后的新版本
```

---

### 阶段七：收到邮件附件保存到工作区并打开到工作台

目标：

```text
打通邮件附件到 AI Office 其他工作台的流程
```

任务：

1. 邮件详情页附件区域支持：
   - 查看附件
   - 下载附件
   - 保存到当前工作区
   - 打开到对应工作台
2. 文件类型对应：
   - `.docx` / `.md` / `.txt` → 文稿工作台
   - `.pptx` → PPT 工作台
   - `.xlsx` / `.csv` → Excel / 数据分析工作台
   - `.pdf` → PDF 预览 / 知识库解析
   - 图片 → 图片预览 / 图片生成参考
   - `.zip` / 其他 → 保存到工作区，不直接编辑
3. 第一优先级先实现 docx 附件闭环：

```text
docx 附件
→ 保存到当前工作区
→ 打开文稿工作台
→ 用户修改
→ 保存新版本
→ 回到邮件
→ 从工作区选择修改后的文件作为回复附件
```

4. 如果现有文稿工作台已有打开文件能力，请复用现有路由 / IPC / store。
5. 如果 PPT / Excel 暂时无法完全打开，也要做好类型判断和清晰提示，不要崩溃。

---

### 阶段八：垃圾邮件 / 回收站

目标：

```text
让 AI 分类中的 spam / promotion 可以进入可恢复区域
```

任务：

1. 邮箱分区包括：
   - 收件箱
   - 已发送
   - 草稿，若已有
   - 垃圾邮件
   - 回收站
2. AI 判断为 `spam` 或 `promotion` 的邮件：
   - 可以移动到垃圾邮件区 / 回收站
   - 必须可恢复
   - 不允许永久删除
3. 如果当前 IMAP 删除逻辑已有 MOVE Trash / fallback COPY + Deleted，请复用并完善。
4. UI 文案必须正式，不要出现测试、demo、mock。
5. 第一版可以做成：

```text
AI 建议移入垃圾邮件
→ 用户确认
→ 移入垃圾邮件区
```

---

### 阶段九：邮件处理日志 / 日报事件

目标：

```text
邮件处理过程进入工作日志，后续可用于 AI 日报
```

请复用项目已有 `workActivityLog` 或类似服务。

需要记录：

1. AI 邮件分析已运行。
2. 分析了多少封邮件。
3. 生成了多少条待办。
4. 生成了多少封预回复。
5. 用户打开了哪封邮件。
6. 用户打开了哪个附件。
7. 用户保存了哪个附件到工作区。
8. 用户从工作区添加了哪个附件。
9. 用户发送了邮件。
10. 用户完成了哪个邮件待办。
11. 用户将垃圾邮件移入回收站。
12. 用户使用知识库生成了邮件回复。

日志要求：

1. 包含当前账号。
2. 包含邮件 ID。
3. 包含事件时间。
4. 包含模块名 `mail` 或 `communication`。
5. 不记录邮箱密码、token 等敏感信息。
6. 不把完整邮件正文无脑写进日志，必要时只记录摘要或标题。

---

### 阶段十：整体联调和验收

必须验证：

1. `npm run build` 或项目现有 typecheck 命令通过。
2. 普通收件箱仍可正常查看邮件。
3. 普通发邮件仍可正常发送。
4. 回复邮件仍保持原线程。
5. 已发送邮件能刷新显示。
6. 删除邮件不永久删除，进入可恢复区域。
7. 点击 AI 邮件分析后，能分析当前账号未读邮件。
8. 邮件列表能显示 AI 标签。
9. 邮件详情能显示 AI 分析结果。
10. 需要回复的邮件能生成可编辑预回复。
11. 用户编辑过的草稿不会被重新分析覆盖。
12. 能从邮件生成待办事项。
13. 待办能点击回到原邮件。
14. 待办状态能持久化。
15. 需要知识库时能检索知识库。
16. 知识库无依据时不会胡编。
17. 回复邮件时能从当前工作区选择附件。
18. 收到的 docx 附件能保存到工作区。
19. docx 附件能打开到文稿工作台，或至少进入现有文稿打开流程。
20. 垃圾邮件不会永久删除。
21. 邮件处理行为能写入日志。
22. UI 中不出现 `demo` / `test` / `mock` / `测试模式` 等字样。
23. 不破坏即时通讯模块。
24. 不破坏通讯录模块。
25. 不破坏已有联系人群发逻辑。

---

## 8. 降级策略

如果某个能力因现有代码缺失无法完整实现，请使用降级策略。

允许的降级：

1. 知识库接口缺失：保留 service 接口和 UI 状态，提示“未检索到明确依据”。
2. PPT / Excel 附件暂时无法打开：先保存到工作区，并提示后续可在对应工作台打开。
3. 垃圾邮件自动移动风险高：先改为“AI 建议移动，用户确认”。
4. 日志服务未找到：新增轻量封装，但不要破坏现有日志结构。
5. LLM 服务未统一：先复用项目已有 AI 调用方式，不要硬编码新 provider。
6. 工作区文件选择器缺失：先复用现有文件选择能力或做最小安全 IPC。

不允许的降级：

1. 不允许做假数据冒充真实流程。
2. 不允许写死邮箱账号。
3. 不允许跳过现有代码另建一套邮件模块。
4. 不允许让 AI 自动发送邮件。
5. 不允许永久删除邮件。
6. 不允许 UI 出现测试、demo、mock 字样。

---

## 9. Copilot 完成后必须汇报

请在完成后输出：

```text
1. 修改了哪些文件
2. 新增了哪些类型
3. 新增了哪些服务
4. 新增或修改了哪些 IPC
5. AI 邮件分析流程现在怎么走
6. 邮件待办如何生成和保存
7. 预回复如何生成、编辑和发送
8. 知识库增强回复是否完成
9. 从工作区添加附件是否完成
10. 邮件附件保存到工作区是否完成
11. docx 附件打开到文稿工作台是否完成
12. 垃圾邮件 / 回收站是否完成
13. 日志 / 日报事件是否完成
14. 哪些能力已经完成
15. 哪些能力只是预留接口
16. 如何运行和验证
17. 是否通过 build / typecheck
18. 还有哪些风险或后续需要人工确认的点
```

---

## 10. 最终目标

完成后，邮件模块应从：

```text
普通邮件客户端
```

升级为：

```text
AI 邮件任务中心
```

最终闭环：

```text
邮件
→ AI 理解
→ 生成待办
→ 调用知识库
→ 处理附件
→ 进入工作台
→ 生成回复
→ 用户确认发送
→ 写入工作日志 / 日报
```
