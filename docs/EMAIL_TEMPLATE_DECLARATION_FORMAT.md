# 邮件模板显式声明格式示例

推荐优先使用 frontmatter。它更稳定，也更适合后续扩展。

## 推荐格式：Frontmatter

```md
---
templateType: email_reply
templateTitle: 项目推进正式回复
templateSummary: 适合对外确认排期、回传材料与责任边界的正式邮件回复。
templateCategory: 项目推进
templateTone: 正式、稳妥、清晰
templateSubjectStrategy: keep-original
templateDefault: true
templatePriority: 80
templateSignature: |
  此致
  敬礼
  项目推进办公室
---

开场：
感谢来信，我们已根据当前项目安排梳理需要同步的重点，并整理如下回复。

结尾：
如需我们补充附件或调整回传节奏，请直接说明，我们会继续配合推进。
```

## 兼容格式：固定字段

```md
templateType: email_reply
标题：学术补充说明回复
摘要：适合审稿意见、实验补充和逐项答复场景。
模板类别：学术回复
语气：严谨、克制、回应具体问题
主题策略：custom-prefix
主题前缀：答复：
模板优先级：40
默认模板：false

开场：
感谢审阅意见，我们已根据问题逐项整理一版补充说明。

结尾：
如果还需要补充实验细节，我们会继续完善。

签名：
祝好
作者团队
```

## 支持字段

- `templateType`: 当前固定写 `email_reply`
- `templateTitle` / `标题`: 模板在邮件侧栏中的显示名称
- `templateSummary` / `摘要`: 模板摘要
- `templateCategory` / `模板类别`: 模板类别，例如项目推进、学术回复、商务正式
- `templateTone` / `语气`: 模板语气说明
- `templateOpening` / `开场`: 模板开场段
- `templateClosing` / `结尾`: 模板结尾段
- `templateSignature` / `签名`: 模板签名，支持多行
- `templateSubjectStrategy` / `主题策略`: `reply-prefix`、`keep-original`、`custom-prefix`
- `templateSubjectPrefix` / `主题前缀`: 当主题策略为 `custom-prefix` 时使用
- `templatePriority` / `模板优先级`: 数字越大排序越靠前
- `templateDefault` / `默认模板`: `true/false`，多个模板同时存在时优先选中标记为默认的模板

## 推荐约定

- 同一知识库中只保留一个 `templateDefault: true` 的邮件模板。
- 需要稳定默认顺序时，显式填写 `templatePriority`。
- `templateSummary` 尽量控制在一两句话，方便侧栏直接预览。
- `templateSignature` 建议总是显式填写，避免回退到推断签名。