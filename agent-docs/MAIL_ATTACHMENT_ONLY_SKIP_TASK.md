# 邮件附件-only 跳过 AI 分析与附件 UI 简化任务

> 建议文件位置：`docs/MAIL_ATTACHMENT_ONLY_SKIP_TASK.md`  
> 目标：只修复“单纯附件邮件不应进入 AI 分析”和“附件邮件 UI 过重”两个问题。  
> 不要新增其他功能，不要恢复旧代码。

---

## 1. 本次只处理两个问题

### 问题 1：单纯附件邮件不应该进入 AI 邮件分析

现在有些邮件只是为了传附件，没有明确任务、需求、询问或处理要求。  
这类邮件不应该显示“分析中”，也不应该生成 AI 分析结果、待办或预回复。

### 问题 2：附件邮件详情 UI 需要更干净

附件-only 邮件详情页应该以附件操作为中心，只保留基础邮件信息和附件操作，不要显示无意义的 AI 分析区和预回复区。

---

## 2. 需要检查的文件

请优先检查：

```text
src/communication/CommunicationWorkbench.tsx
src/modules/email/contexts/MailTriageContext.tsx
src/modules/email/services/mailTriageClassifier.ts
src/types/mailTriage.ts
src/types/email.ts
src/modules/email/components/ComposeModal.tsx
```

---

## 3. 定义 attachment-only 邮件

请新增一个清晰判断函数，例如：

```ts
function isAttachmentOnlyMail(mail: MailItem): boolean
```

满足以下条件时，视为 attachment-only 邮件：

```text
1. 邮件有附件。
2. 邮件正文为空，或正文非常短。
3. 邮件正文没有明确任务、需求、询问、审批、会议、修改、回传等动作。
4. 邮件主题为空、无主题，或主题无法表达明确任务。
5. 邮件看起来只是为了传一个文件。
```

---

## 4. 不应跳过分析的附件邮件

如果主题或正文出现以下关键词，则不要跳过 AI 分析，应识别为附件处理型邮件 `attachment_review`。

中文关键词：

```text
请查看
请修改
请反馈
请签署
请确认
请回传
请处理
请审阅
请审批
修改后发回
截止
尽快
今天
明天
```

英文关键词：

```text
please review
please revise
please sign
please confirm
please send back
please handle
please process
feedback
deadline
urgent
by Friday
by tomorrow
```

这类邮件不是 attachment-only，而是附件处理任务，仍然需要 AI 分析。

---

## 5. AI 分析流程调整

当用户点击“AI 邮件分析”时：

```text
attachment-only 邮件不要进入 LLM 分析。
attachment-only 邮件不要显示“分析中”。
attachment-only 邮件不要生成 AI 分析结果。
attachment-only 邮件不要生成待办。
attachment-only 邮件不要生成预回复。
attachment-only 邮件不要生成 actionPlan。
```

可以新增状态：

```ts
export type AiMailTriageStatus = 'success' | 'failed' | 'skipped';

export type AiMailSkipReason =
  | 'attachment_only'
  | 'empty_mail'
  | 'system_delivery_notice';
```

如果现有类型不适合这样改，也可以用项目现有风格实现，但必须保证 attachment-only 邮件不会进入 AI 分析队列。

---

## 6. attachment-only 邮件列表 UI

左侧邮件列表中，attachment-only 邮件只显示：

```text
附件图标
发件人
时间
主题
一个简单的“附件”标签
```

如果主题为空，可以显示：

```text
附件邮件
```

不要显示：

```text
普通
分析中
待处理
待回复
有草稿
风险
需知识库
有待办
```

---

## 7. attachment-only 邮件详情 UI

attachment-only 邮件详情页只需要显示：

```text
发件人
收件人
时间
主题
附件区域
基础回复区
```

附件区域保留：

```text
文件图标
文件名
文件大小
下载
保存到工作区
打开到工作台
```

不要默认显示：

```text
AI 分析结果
任务清单
对方需求
问题与建议回复
预回复草稿自动生成状态
分析中
普通标签
待处理
待回复
有草稿
风险
```

用户手动输入回复并发送的能力可以保留。

---

## 8. ComposeModal 附件按钮确认

请检查：

```text
src/modules/email/components/ComposeModal.tsx
```

确认新建邮件弹窗里只保留一个按钮：

```text
添加附件
```

如果仍然存在：

```text
添加本地附件
从工作区添加附件
```

请合并成一个：

```text
添加附件
```

点击后调用现有 Windows/Electron 文件选择器。

不要恢复工作区附件选择面板。工作区文件也可以通过 Windows 文件选择器选择。

注意：

```text
发送邮件的“添加附件”入口合并。
收到邮件附件的“保存到工作区 / 打开到工作台”能力必须保留。
```

---

## 9. 删除多余代码

完成后删除不再使用的代码，不要只是隐藏。

重点清理：

```text
attachment-only 邮件仍进入 AI 分析的分支
attachment-only 邮件显示“分析中”的分支
attachment-only 邮件自动生成预回复的分支
attachment-only 邮件无意义标签渲染
废弃附件按钮 state / handler / UI
未使用 imports
未使用 CSS class
未使用类型字段
```

---

## 10. 必须保留

必须保留：

```text
真实收件箱
真实已发送
真实回收站
新建邮件
回复邮件
AI 邮件分析
非 attachment-only 邮件的 AI 分析结果
邮件待办
可编辑预回复
添加附件发送
收到附件下载
收到附件保存到工作区
docx 附件打开到文稿工作台
删除邮件到可恢复区域
即时通讯
通讯录
```

---

## 11. 禁止恢复

不要恢复：

```text
demo
mock
seed
WorkInbox
CommunicationAIDock
EmailTaskPreviewCard
旧命令式群发入口
```

---

## 12. 验收

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
1. 如何判断 attachment-only 邮件。
2. attachment-only 邮件是否已跳过 AI 分析。
3. attachment-only 邮件列表现在如何展示。
4. attachment-only 邮件详情现在如何展示。
5. ComposeModal 是否只剩一个“添加附件”按钮。
6. 删除了哪些多余代码。
7. 是否仍保留收到附件保存到工作区。
8. 是否仍保留 docx 附件打开到文稿工作台。
9. build 是否通过。
10. typecheck 是否通过；如果失败，区分本次新增错误和历史错误。
```
