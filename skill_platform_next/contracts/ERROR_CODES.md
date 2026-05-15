# 统一错误码表

| 错误码 | HTTP | 含义 |
|---|---:|---|
| `AUTH_001_UNAUTHORIZED` | 401 | 内部接口鉴权失败 |
| `REQ_001_INVALID_JSON` | 400 | 请求 JSON 非法 |
| `REQ_002_INVALID_PAYLOAD` | 400 | 结构不符合预期 |
| `REQ_003_INVALID_SCHEMA_VERSION` | 400 | schema_version 不匹配 |
| `REQ_004_MISSING_REQUIRED_FIELDS` | 400 | 缺少必填字段 |
| `REQ_005_MISSING_SOURCE_ARTIFACTS` | 400 | run 请求缺少 source_artifacts |
| `SKILL_001_NOT_FOUND` | 404 | 技能不存在 |
| `SKILL_002_NOT_INSTALLED` | 404 | 技能未安装 |
| `PKG_001_NOT_FOUND` | 404 | 包不存在 |
| `PKG_002_INVALID_HASH` | 400 | 包 hash 无效 |
| `PKG_003_INVALID_SIGNATURE` | 400 | 签名不合法或验签失败 |
| `PKG_004_INVALID_MANIFEST` | 400 | manifest 非法 |
| `PKG_005_CHECKSUM_MISMATCH` | 400 | 文件 checksum 不匹配 |
| `PKG_006_MISSING_REQUIRED_FILE` | 400 | 缺少 Capsule 必要文件 |
| `PKG_007_CLOSED_WORLD_REQUIRED` | 400 | 必须 closed_world=true |
| `PKG_008_EXTERNAL_CALLS_FORBIDDEN` | 400 | 必须 external_skill_calls_allowed=false |
| `RUN_001_NOT_FOUND` | 404 | run 记录不存在 |
| `SYS_001_INTERNAL_ERROR` | 500 | 服务内部错误 |
| `SYS_404_NOT_FOUND` | 404 | 路由不存在 |

