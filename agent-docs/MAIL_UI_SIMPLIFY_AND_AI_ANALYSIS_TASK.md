# AI Office 邮件工作台 UI 简化与 AI 分析增强任务

> 建议文件位置：`docs/MAIL_UI_SIMPLIFY_AND_AI_ANALYSIS_TASK.md`  
> 项目：AI Office / AI Writer 3.0  
> 技术栈：Electron + Vite + React + TypeScript  
> 目标模块：邮件 / 通讯工作台  
> 任务类型：UI 简化 + AI 分析结果增强 + 删除多余代码

---

## 0. 任务目标

当前邮件工作台已经具备真实邮件收发、AI 邮件分析、待办、预回复、附件、回收站等主流程。

但是当前 UI 和代码存在以下问题：

1. 邮件详情里暴露了过多 AI 内部参数，例如：
   - 使用知识库
   - 正式
   - 简洁
   - 友好
   - 强硬
   - 英文正式
   - 中文正式
   - 已修改

2. 邮件列表展示了过多标签，例如：
   - 待回复
   - 待处理
   - 有草稿
   - 风险

3. 附件入口被拆成：
   - 添加本地附件
   - 从工作区添加附件

4. AI 分析结果太简单，只是字段罗列，不能根据不同邮件类型生成不同处理方案。

5. 有些 UI、state、handler、类型、样式已经不应该继续保留，必须直接删除，不能只是隐藏。

本次目标是：

```text
真实邮件
→ AI 自动判断邮件类型
→ AI 自动决定是否需要知识库、语气和回复结构
→ 展示结构化处理方案
→ 生成可编辑回复草稿
→ 用户添加附件
→ 用户确认发送
```

---

## 1. 核心原则

必须遵守：

1. 这次不是新增功能，而是收敛和清理。
2. 不是隐藏按钮，而是删除多余代码。
3. 知识库、语气、附件来源这些应该由系统和 LLM 自动判断，不要让用户手动点一堆按钮。
4. 用户只需要看到：
   - 邮件原文
   - AI 分析结果
   - AI 处理建议
   - 可编辑回复草稿
   - 添加附件
   - 保存草稿
   - 确认发送
5. 不要恢复任何旧方案。
6. 不要恢复 demo / mock / seed / WorkInbox / CommunicationAIDock / EmailTaskPreviewCard。
7. 不要新增旧的命令式群发入口。
8. 不要引入 mock 数据。
9. 修改完成后必须删除不再使用的 state、handler、类型、组件、样式和 import。
10. 必须保留真实邮件主线。

---

## 2. 当前正式邮件主线

只保留以下正式主线：

```text
真实邮件收件箱
→ AI 邮件分析
→ 邮件详情展示分析结果
→ 根据邮件类型生成结构化处理建议
→ 生成可编辑预回复
→ 添加附件
→ 用户确认发送
→ 已发送刷新
→ 日志记录
```

---

## 3. 删除邮件详情中的手动 AI 控制按钮

### 3.1 要删除的按钮

请删除邮件详情回复区域中的以下按钮和相关逻辑：

```text
使用知识库
正式
简洁
友好
强硬
英文正式
中文正式
已修改
```

### 3.2 删除要求

1. 不要只是 `display: none`。
2. 如果对应 state、props、handler、类型、样式不再使用，请一起删除。
3. 不要保留 fallback。
4. 不要保留无用 import。
5. 不要保留无用 CSS class。
6. 不要保留无用类型字段。

### 3.3 LLM 自动判断内容

删除这些按钮后，LLM 应该自动判断：

```text
是否需要知识库
回复语气
回复格式
是否需要任务清单
是否需要需求整理
是否需要附件说明
是否需要简短确认
是否需要正式说明流程
```

### 3.4 回复区只保留的按钮

回复区最多保留：

```text
重新生成
保存草稿
添加附件
确认发送
```

---

## 4. 增强 AI 分析结果结构

当前 AI 分析结果太简单，只显示：

```text
摘要
分类
重要性
紧急性
需要回复
需要行动
需要知识库
建议操作
```

需要增强为：

```text
按邮件类型生成不同处理结果
```

请检查并修改：

```text
AiEmailAnalysisResult
AiEmailTodo
mailTriageClassifier
MailTriageContext
CommunicationWorkbench 中 AI 分析结果展示区域
```

---

## 5. 建议新增或等价实现的类型

可以按项目现有命名风格调整，但必须具备同等能力。

```ts
export type AiEmailIntentType =
  | 'task'
  | 'request'
  | 'question'
  | 'notice'
  | 'attachment_review'
  | 'meeting'
  | 'approval'
  | 'spam'
  | 'ordinary';

export interface AiEmailActionPlan {
  intentType: AiEmailIntentType;
  title: string;
  brief: string;

  taskChecklist?: Array<{
    id: string;
    text: string;
    done: boolean;
    deadline?: string | null;
  }>;

  requestItems?: Array<{
    id: string;
    text: string;
    required: boolean;
  }>;

  questionAnswer?: {
    question: string;
    answerDraft: string;
    usedKnowledgeBase: boolean;
    knowledgeMissing: boolean;
  };

  noticeSummary?: {
    keyPoints: string[];
    needFollowUp: boolean;
    followUpReason?: string;
  };

  attachmentActions?: Array<{
    fileName?: string;
    action: 'read' | 'edit' | 'review' | 'sign' | 'return' | 'archive';
    targetWorkspace?: 'document' | 'ppt' | 'excel' | 'preview' | 'none';
    note: string;
  }>;

  replyStrategy: {
    shouldReply: boolean;
    tone: 'formal' | 'concise' | 'friendly' | 'neutral';
    reason: string;
  };
}
```

在 AI 分析结果中加入：

```ts
actionPlan?: AiEmailActionPlan;
```

---

## 6. 不同邮件类型的分析逻辑

请让 LLM 或当前 classifier 根据邮件内容自动判断 `intentType`。

### 6.1 任务型：`task`

判断依据：

```text
请完成
请处理
请提交
请修改
请准备
please finish
please submit
please revise
有明确动作和截止时间
```

输出内容：

```text
taskChecklist
deadline
suggestedAction
replyDraft
```

预回复应包含：

```text
确认收到
列出会处理的事项
如果有截止时间，确认时间
```

### 6.2 需求型：`request`

判断依据：

```text
对方提出材料、信息、文件、数据、确认、协助需求
```

输出内容：

```text
requestItems
是否需要附件
回复中逐项回应需求
```

预回复应包含：

```text
逐项回应需求
说明是否已附上文件
如果缺资料，请求补充
```

### 6.3 询问型：`question`

判断依据：

```text
请问
如何
是否
what
how
could you explain
需要解释政策、流程、安排
```

输出内容：

```text
questionAnswer
自动检索知识库
如果知识库无依据，明确提示人工确认
生成预回复
```

预回复应包含：

```text
结合知识库回答
分步骤说明
无依据时提示人工确认
不能胡编政策、截止时间、审批流程
```

### 6.4 通知型：`notice`

判断依据：

```text
会议通知
活动通知
系统通知
安排说明
```

输出内容：

```text
noticeSummary.keyPoints
是否需要跟进
如果不需要回复，明确说明“不需要回复”
```

预回复应包含：

```text
如需回复，只做简短确认
不需要回复时不强行生成长回复
```

### 6.5 附件处理型：`attachment_review`

判断依据：

```text
邮件包含附件
正文要求查看、修改、签署、反馈、回传
```

输出内容：

```text
attachmentActions
指明附件应打开到哪个工作台
生成回复草稿时说明附件处理结果
```

预回复应包含：

```text
说明附件已查看 / 修改 / 将处理
需要回传时提醒添加附件
```

### 6.6 审批型：`approval`

判断依据：

```text
需要同意
需要拒绝
需要确认
需要批准
```

输出内容：

```text
待确认事项
谨慎回复建议
风险提示可放进邮件详情分析区
```

注意：

```text
不要在邮件列表显示“风险”标签
```

### 6.7 垃圾 / 推广：`spam`

判断依据：

```text
广告
推广
无关营销
明显垃圾邮件
```

输出内容：

```text
建议移入可恢复区域
不生成正式回复草稿
```

---

## 7. AI 分析结果 UI 改造

### 7.1 当前展示方式需要替换

当前 AI 分析结果不要再机械展示：

```text
摘要
分类
重要性
紧急性
需要回复
需要行动
需要知识库
建议操作
```

### 7.2 新展示结构

邮件详情页 AI 分析区域改为：

#### 顶部概览

显示：

```text
邮件类型：任务 / 需求 / 询问 / 通知 / 附件处理 / 审批 / 普通
重要性
紧急性
是否需要回复
```

#### 按类型展示不同内容

任务型：

```text
标题：任务清单
- 任务 1
- 任务 2
- 截止时间
```

需求型：

```text
标题：对方需求
- 需求 1
- 需求 2
- 是否需要附件
```

询问型：

```text
标题：问题与建议回复
- 对方问题
- 知识库依据状态
- 回复要点
```

通知型：

```text
标题：关键信息
- 时间
- 地点
- 事项
- 是否需要跟进
```

附件处理型：

```text
标题：附件处理建议
- 附件名
- 处理动作
- 推荐工作台
```

审批型：

```text
标题：待确认事项
- 需要确认什么
- 建议回复方式
- 需要人工确认的风险点
```

普通邮件：

```text
摘要
建议是否回复
```

### 7.3 知识库展示规则

不要再把：

```text
需要知识库：是 / 否
```

作为主要字段展示。

只在询问型或政策流程相关邮件中显示：

```text
已参考知识库
```

或：

```text
未找到明确依据，建议人工确认
```

---

## 8. 邮件列表标签简化

### 8.1 要删除的列表标签

请删除邮件列表中的以下标签：

```text
待回复
待处理
有草稿
风险
```

### 8.2 只保留最必要信息

邮件列表只保留：

#### 邮件类型标签

例如：

```text
任务
需求
询问
通知
附件
审批
普通
```

#### 重要性标签

只在 `high` 或 `urgent` 时显示：

```text
重要
紧急
```

#### 附件图标

如果有附件，显示附件图标即可。

### 8.3 UI 目标

邮件列表要干净，不要显示太多 AI 标签。

---

## 9. 合并附件按钮

### 9.1 当前要合并的按钮

请把：

```text
添加本地附件
从工作区添加附件
```

合并为一个按钮：

```text
添加附件
```

### 9.2 行为要求

点击“添加附件”后直接调用 Windows 文件选择器。

要求：

1. 不再区分本地附件和工作区附件两个入口。
2. 如果当前已有工作区文件需要发送，也可以通过 Windows 文件选择器选择工作区内文件。
3. 发送邮件时仍然走现有附件发送能力。
4. 删除不再使用的 workspace attachment picker UI、state、handler、样式。
5. 保留收到邮件附件“保存到工作区”和“打开到工作台”的能力。

### 9.3 注意区分

发送附件入口合并。

收到邮件附件处理能力保留：

```text
保存到工作区
打开到工作台
```

---

## 10. 预回复生成逻辑调整

删除用户手动选择语气后，AI 生成回复时需要自动判断语气。

### 10.1 自动语气规则

```text
学生 / 外部咨询：正式、清楚、有礼貌
同事协作：简洁、明确
上级 / 审批：正式、谨慎
通知确认：简短确认
垃圾 / 推广：不生成正式回复
知识库无依据：草稿中提醒人工确认，不能胡编
```

### 10.2 按类型生成回复

任务型：

```text
确认收到
列出会处理的事项
如果有截止时间，确认时间
```

需求型：

```text
逐项回应需求
说明是否已附上文件
如果缺资料，请求补充
```

询问型：

```text
结合知识库回答
分步骤说明
无依据时提示人工确认
```

通知型：

```text
如需回复，只做简短确认
不需要回复时不强行生成长回复
```

附件处理型：

```text
说明附件已查看 / 修改 / 将处理
需要回传时提醒添加附件
```

---

## 11. 删除多余代码

完成 UI 和逻辑调整后，请删除不再使用的代码。

重点清理：

```text
语气选择相关 state
语气按钮组件
tone 类型中不再需要的值
useKbRef / 手动知识库开关相关代码
workspace attachment picker 相关 UI
workspaceAttachError 等只服务旧双按钮结构的代码
邮件列表中过度标签相关组件和样式
不再使用的 props
不再使用的 imports
不再使用的 CSS class
不再使用的类型字段
```

要求：

1. 不要只是隐藏。
2. 不要保留 fallback。
3. 不再使用的代码直接删除。

---

## 12. 必须保留的能力

修改时必须保留：

```text
真实收件箱
真实已发送
真实回收站
新建邮件
回复邮件
AI 邮件分析
AI 分析结果展示
邮件待办
可编辑预回复
添加附件
收到邮件附件保存到工作区
docx 附件打开文稿工作台
删除邮件到可恢复区域
邮件处理日志
即时通讯
通讯录
```

---

## 13. 禁止恢复的旧方案

不要恢复：

```text
demo
mock
seed
WorkInbox
CommunicationAIDock
EmailTaskPreviewCard
batchEmailQueue
旧 AI 通讯任务 Dock
旧命令式群发入口
```

---

## 14. 验收要求

修改完成后运行：

```bash
npm run build
```

如果可以，再运行：

```bash
npm run typecheck
```

最终输出：

```text
1. 删除了哪些按钮
2. 删除了哪些旧 state / handler / 类型
3. AI 分析结果结构如何增强
4. 不同邮件类型现在如何展示
5. 附件按钮如何合并
6. 哪些多余代码已删除
7. 是否仍保留收到附件保存工作区 / 打开工作台
8. 是否仍保留真实邮件发送
9. 是否仍保留即时通讯和通讯录
10. build 是否通过
11. typecheck 是否通过
12. 如果 typecheck 失败，区分本次新增错误和历史错误
```

---

## 15. 最终期望

修改完成后，邮件工作台应该变成：

```text
邮件进入
→ AI 自动判断邮件类型和处理方式
→ 用户看到结构化处理建议
→ 用户编辑回复草稿
→ 用户添加附件
→ 用户确认发送
```

而不是：

```text
用户手动选择知识库
用户手动选择语气
用户判断用哪个附件入口
用户看一堆 AI 标签
```

最终目标：

```text
AI 判断，用户确认。
```
