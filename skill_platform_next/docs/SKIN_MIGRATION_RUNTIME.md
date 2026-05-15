# Skin 迁移运行说明

本文档说明如何在 `skill_platform_next` 内独立完成 `.aoskin` 的解码、校验、安装、运行。

## 引擎实现位置

- 解码与校验：`services/skill-engine/src/aoskinRuntime.js`
- 引擎入口：`services/skill-engine/src/server.js`

## 支持的安装输入

`POST /engine/install` 支持三种方式（任选其一）：

1. `capsule.files`（内存对象）
2. `skin_binary_base64`（base64 二进制）
3. `skin_path`（本地 `.aoskin` 文件路径）

## `.aoskin` 校验链

1. ZIP 解码（读取所有文件）
2. 校验 `AOSKIN` 标记文件
3. 校验 `manifest.json`（closed-world 约束）
4. 校验 `checksums.json`（逐文件 sha256）
5. 校验 `signature.sig`（Ed25519）

## 运行机制

`POST /engine/run` 按 `skill_id + operation` 在已安装 skin 的 `manifest.operations` 中解析 `host_action`，由引擎 runtime 执行并返回 `ArtifactPackage`。

当前支持的 `host_action`（内置）：

- `writing.continue`
- `writing.rewrite`
- `writing.assistant`
- `writing.outline`
- `writing.topic`
- `writing.experiment_plan`
- `paper.generate`
- `ppt.generate`

## 迁移建议

迁移到新工程时，只需保留：

- `skins/*.aoskin`
- `services/skill-engine/src/aoskinRuntime.js`
- `services/skill-engine/src/server.js`
- 共享错误码定义 `shared/constants.js`

即可在不依赖旧仓库 UI 的情况下独立运行 Skin 引擎。

