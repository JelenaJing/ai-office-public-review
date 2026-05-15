# Skill 中心远程接口说明

## 架构与远程访问

- 前端入口：`skill-store-web`（默认 `http://10.20.5.62:4030`）
- 网关 API：`/api/*`（`apps/skill-store-web/server.js`）
- 后端服务：`skill-library-backend`（默认 `http://10.20.5.62:4010`）

前端通过网关访问后端接口，不依赖本地文件读取，因此支持远程访问（取决于部署网络和反向代理配置）。

## 分类与论坛模块映射

`GET /api/store/skills` 每个 skill 包含：

- `scene_category`: `工作 | 学习 | 生活`
- `forum_module`: `forum-work | forum-study | forum-life`
- `priority_tier`: `core | filler`
- `core_rank`: 核心相关优先级（越小越靠前）

当前策略：
- 你已筛选的高相关 skill 标记为 `core`，在列表顶部。
- 补充 skill 标记为 `filler`，排列在后。

## 商店接口

### `GET /api/store/skills`
- 说明：获取技能列表（已按 `core -> filler` 排序）
- 请求头：可选 `X-User-Id`、`X-Tenant-Id`
- 响应：数组

### `GET /api/store/skills/{skillId}`
- 说明：获取单个技能详情

### `POST /api/store/skills/{skillId}/purchase`
- 说明：购买 skill 并写入授权

### `GET /api/store/my-purchases`
- 说明：读取我的购买记录

## 创作者接口

### `GET /api/creator/skills`
- 说明：读取当前用户发布的技能

### `POST /api/creator/skills`
- 说明：发布技能元数据

### `POST /api/creator/withdrawals`
- 说明：提交提现请求（演示链路）

## 内部同步接口（library 直连）

- `GET /skills/entitlements`
- `POST /skills/sync-plan`
- `POST /skills/install-token`
- `GET /skills/packages/{packageId}`
- `POST /skills/install-report`

## 启动方式

在 `skill_platform_next` 目录：

- `npm run dev:library`
- `npm run dev:store`

访问：

- 前端：`http://localhost:4030`
- 列表接口：`http://localhost:4030/api/store/skills`
