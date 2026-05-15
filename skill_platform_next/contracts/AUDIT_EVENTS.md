# 统一审计事件表

| 事件名 | 服务 | 触发时机 |
|---|---|---|
| `store.purchase.created` | library-backend | 新购买创建成功 |
| `store.purchase.duplicate` | library-backend | 重复购买请求 |
| `skills.entitlements.fetched` | library-backend | 拉取授权列表 |
| `skills.sync_plan.generated` | library-backend | 生成同步计划 |
| `skills.install_token.issued` | library-backend | 下发安装令牌 |
| `skills.package.metadata_read` | library-backend | 读取包元信息 |
| `skills.install_report.accepted` | library-backend | 接收安装回执 |
| `engine.install.validated` | engine | `.aoskill` 验证通过 |
| `engine.install.rejected` | engine | `.aoskill` 验证失败 |
| `engine.install.completed` | engine | 安装完成 |
| `engine.run.started` | engine | 运行开始 |
| `engine.run.completed` | engine | 运行完成 |
| `engine.run.rejected` | engine | 运行请求被拒绝 |
| `engine.uninstall.completed` | engine | 卸载完成 |

## 查询接口

- `GET /skills/audit/events`（需要内部 token）
- `GET /engine/audit/events`（需要内部 token）

