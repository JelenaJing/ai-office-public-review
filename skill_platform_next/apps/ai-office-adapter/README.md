# ai-office-adapter（独立客户端适配层）

该目录用于 AI Office 客户端与新后端系统对接，不放 Skill 业务实现代码。

## 功能边界

- 调用 `entitlements/sync-plan/install-token/install-report`。
- 维护本机安装状态和同步视图。
- 发起 `engine/install` 与 `engine/run`。

## 禁止事项

- 不承载 Prompt 编排、模块依赖解析、Skill 私有业务逻辑。
- 不直接访问商店交易接口进行安装。

