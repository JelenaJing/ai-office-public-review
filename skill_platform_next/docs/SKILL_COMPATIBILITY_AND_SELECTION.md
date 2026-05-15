# Skill Store 接入与兼容性说明

## 1) 已完成的接入

- `skill_platform_next` 三服务可独立运行：
  - `skill-library-backend` (`4010`)
  - `skill-engine` (`4020`)
  - `skill-store-web` (`4030`)
- `skill-library-backend` 已支持自动加载 `skins/imported/catalog.json` 中的导入技能。
- 新增批量导入脚本：
  - `npm run import:skills`
  - 从 `D:/Projects/Codex/skin_bank/skills_download/manifest.csv` 自动筛选并打包 `.aoskin`
  - 产物目录：`skill_platform_next/skins/imported/`
  - 已生成：`20` 个（写作 `10` + 分析 `10`）

## 2) 与现有项目功能的兼容判断

现有项目（`ai_writer3.0`）的内置能力主要包括：

- 文稿写作与改写（`knowledge/writing/paper`）
- 学术论文生成（`paper`）
- 报告与模板文书（`report/templateDocument`）
- 演示文稿生成（`presentation`）
- 图像生成（`image`）
- 邮件草拟（`mail`）

与本次筛选技能的关系：

- **可直接增强（建议接入）**
  - 写作类：长文写作、科研写作、文档共创、文档写作
  - 分析类：研究检索、市场研究、评测/benchmark、数据科学
- **已有能力重复（可后续灰度）**
  - 基础续写/重写/提纲（项目已有对应能力）
- **暂不优先（本轮未纳入）**
  - 纯工程开发类、框架配置类、图片/视频编辑类、基础设施运维类

## 3) 本轮筛选策略

- 优先规则：
  - 与“文稿写作 / 创作 / 数据分析”直接相关
  - 有明确 `SKILL.md/README` 说明
  - 有可追溯 `github_repo` 与 `skill_path`
- 排除规则：
  - 与当前产品方向弱相关（如部署运维、底层框架细节）
  - 明显偏图像/音视频后处理

## 4) 产物格式

每个导入技能均封装为 `.aoskin`（zip capsule）：

- `AOSKIN`
- `manifest.json`
- `runtime/mock_handler.json`
- `checksums.json`
- `signature.sig`
- `assets/source_meta.json`
- `assets/skill_doc_excerpt.md`

运行时遵循：

- `closed_world: true`
- `external_skill_calls_allowed: false`

## 5) 用户系统对齐方式

`skill-store-web` 已支持通过请求头透传账号：

- `X-User-Id`
- `X-Tenant-Id`

前端会默认使用本地会话值（可被你主项目登录态桥接注入），从而复用你现有用户体系而不是固定 `user_001`。

