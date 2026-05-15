# 架构约束（强制）

## 1. 路径隔离

- 新功能只允许在 `skill_platform_next/` 下开发。
- 不允许修改旧实现目录来承载新 Skill 系统能力。

## 2. 系统边界

- `apps/skill-store-web`: 只做交易展示，不做安装运行。
- `services/skill-library-backend`: 只做包管理/授权/同步，不做执行。
- `services/skill-engine`: 只做安装校验与执行，不做交易展示。
- `apps/ai-office-adapter`: 只做客户端适配，不做 Skill 业务实现。

## 3. 契约优先

- 所有跨服务请求和响应必须以 `contracts/*.schema.json` 为准。
- 若接口改动，先改契约，再改服务。

## 4. 运行限制

- 执行模式必须是 `closed_world=true`。
- 禁止 `external_skill_calls_allowed=true`。
- 仅允许 `internal.call(...)` 和 `host.call(...)` 语义路径。

