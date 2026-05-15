# skill_platform_next

这是一个与现有仓库实现解耦的全新 Skill 平台骨架，专门用于后端引擎化落地。

## 设计目标

- 与历史 `src/electron/public` 代码隔离，不复用旧目录。
- 三块能力完全拆开：`AI Office 适配`、`Skill Store 前端`、`Skill 库后端 + Skill 引擎`。
- 通过共享契约层保持接口稳定，避免前后端互相污染。

## 目录

```text
skill_platform_next/
  apps/
    ai-office-adapter/
    skill-store-web/
  services/
    skill-engine/
    skill-library-backend/
  contracts/
```

## 当前阶段

- 已提供：可运行的库后端、引擎服务、商店前端（Node HTTP，无第三方依赖）。
- 已提供：`SkillRunRequest`、`ArtifactPackage`、`SyncPlan` 三份契约。
- 已提供：AI Office 适配层同步脚本，可串联安装与运行。
- 已提供：端到端 smoke 脚本。

## 运行（开发态）

```bash
npm run dev:library
npm run dev:engine
npm run dev:store
```

默认端口：

- `skill-library-backend`: `4010`
- `skill-engine`: `4020`
- `skill-store-web`: `4030`

## 关键接口

### Store Web（公开）

- `GET /store/skills`
- `GET /store/skills/{skillId}`
- `POST /store/skills/{skillId}/purchase`
- `GET /store/my-purchases`
- `GET /api/docs`（由 `skill-store-web` 提供的网关接口说明）

### Skill Sync（内部 token 鉴权）

- `GET /skills/entitlements`
- `POST /skills/sync-plan`
- `POST /skills/install-token`
- `GET /skills/packages/{packageId}`
- `POST /skills/install-report`

### Skill Engine（内部 token 鉴权）

- `POST /engine/install`
- `POST /engine/run`
- `GET /engine/runs/{runId}`
- `POST /engine/uninstall`

## 一键验证

```bash
npm run smoke
```

## 上线前建议

- 使用进程管理器（PM2/systemd/NSSM）守护三个服务。
- 通过环境变量设置 `SKILL_INTERNAL_API_TOKEN` 并轮换。
- 将 `SKILL_ALLOWED_ORIGINS` 配置为正式域名白名单。
- 把内存存储替换为持久化数据库（PostgreSQL/MySQL）。
- 在网关层加 TLS、限流、审计与告警。

## 远程 Skill 中心接口文档

- 详细文档：`docs/SKILL_STORE_REMOTE_API.md`

