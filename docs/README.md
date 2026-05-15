# AI Writer 3.0 文档中心

> 最后更新: 2026-03-18

## 📚 文档索引

### 核心文档

1. **[AI_WRITER_3_CURRENT_STATE_20260318.md](./AI_WRITER_3_CURRENT_STATE_20260318.md)** ⭐⭐⭐
   - **AI Writer 3.0 完整状态文档**
   - 架构概览、OOXML迁移进度、核心模块、数据模型
   - 包含术语表、快速排查指南
   - **推荐首次阅读文档**

2. **[AI_WRITER_3_ENGINE_REBUILD_PLAN.md](./AI_WRITER_3_ENGINE_REBUILD_PLAN.md)**
   - AI Writer 3.0 内置文档引擎重构计划
   - 从 TipTap/HTML 到 Embedded Office Engine 的架构转型
   - 读者：了解 3.0 重构目标和当前进展

3. **[OOXML_GLOBAL_MIGRATION_CHECKLIST_20260318.md](./OOXML_GLOBAL_MIGRATION_CHECKLIST_20260318.md)** ⭐
   - OOXML 全局化迁移的分阶段执行清单
   - 当前进度：阶段 5 进行中（收缩兼容字段）
   - 包含 smoke test 覆盖说明和兼容性边界定义
   - 读者：了解 OOXML 迁移路径和当前状态

4. **[EMBEDDED_OFFICE_MODULE_UPDATE_LOG_20260317.md](./EMBEDDED_OFFICE_MODULE_UPDATE_LOG_20260317.md)** ⭐
   - Embedded Office 引擎模块更新日志
   - 按模块记录变更，避免上下文丢失
   - 最新更新：任务管理收缩、smoke test 验证（2026-03-18）
   - 读者：跟踪 embedded office 引擎的持续演进

### 集成文档

5. **[EMBEDDED_OFFICE_ENGINE_INTEGRATION.md](./EMBEDDED_OFFICE_ENGINE_INTEGRATION.md)**
   - Embedded Office 引擎接入技术方案
   - 模块划分、接入边界、真源设计
   - 读者：了解引擎接入架构设计

6. **[EMBEDDED_OFFICE_RUNTIME_HANDOFF_20260316.md](./EMBEDDED_OFFICE_RUNTIME_HANDOFF_20260316.md)**
   - Embedded Office Runtime 续接文档
   - OOXML 真实包解析实现细节
   - file:read/writeDocx 接入路径
   - 读者：了解 runtime 第一版落地细节

### 测试文档

7. **[EMBEDDED_FIRST_ROUND_TEST_CHECKLIST_20260317.md](./EMBEDDED_FIRST_ROUND_TEST_CHECKLIST_20260317.md)**
   - Embedded 首轮最小回归清单
   - Windows 手工回归测试步骤
   - 读者：执行回归测试前必读

8. **[MAIN_PACKAGE_INSTALLER_SMOKE_CHECKLIST_20260402.md](./MAIN_PACKAGE_INSTALLER_SMOKE_CHECKLIST_20260402.md)** ⭐
   - 主包安装包级别冒烟清单
   - 聚焦 PDF 导入、Remake 启动和结果导出
   - 读者：打包完成后执行主包验收的同学

### 设计与规范文档

9. **[STRUCTURED_BLOCKS_SEMANTIC_BOUNDARY_20260318.md](./STRUCTURED_BLOCKS_SEMANTIC_BOUNDARY_20260318.md)** ⭐
   - structuredBlocks 语义边界与使用规范
   - 明确定位：运行时缓存，非持久化真源
   - 正确使用模式与反模式
   - 读者：理解 structuredBlocks 在 OOXML 化后的角色

## 🎯 快速导航

### 我想了解...

- **AI Writer 3.0 是什么？当前进展如何？** → [AI_WRITER_3_CURRENT_STATE_20260318.md](./AI_WRITER_3_CURRENT_STATE_20260318.md) ⭐
- **3.0 的核心目标是什么？** → [AI_WRITER_3_ENGINE_REBUILD_PLAN.md](./AI_WRITER_3_ENGINE_REBUILD_PLAN.md)
- **当前迁移到哪一步了？** → [OOXML_GLOBAL_MIGRATION_CHECKLIST_20260318.md](./OOXML_GLOBAL_MIGRATION_CHECKLIST_20260318.md)
- **最近做了哪些改动？** → [EMBEDDED_OFFICE_MODULE_UPDATE_LOG_20260317.md](./EMBEDDED_OFFICE_MODULE_UPDATE_LOG_20260317.md)
- **如何测试 embedded 引擎？** → [EMBEDDED_FIRST_ROUND_TEST_CHECKLIST_20260317.md](./EMBEDDED_FIRST_ROUND_TEST_CHECKLIST_20260317.md)
- **如何做主包安装包冒烟？** → [MAIN_PACKAGE_INSTALLER_SMOKE_CHECKLIST_20260402.md](./MAIN_PACKAGE_INSTALLER_SMOKE_CHECKLIST_20260402.md) ⭐
- **structuredBlocks 应该怎么用？** → [STRUCTURED_BLOCKS_SEMANTIC_BOUNDARY_20260318.md](./STRUCTURED_BLOCKS_SEMANTIC_BOUNDARY_20260318.md)

### 关键概念速查

- **Embedded Office Engine**: 内置的 OOXML-native 文档编辑引擎，3.0 的核心替换目标
- **Legacy TipTap Bridge**: 2.0 的 HTML 富文本编辑器，在 3.0 中保留为回退路径
- **OOXML Snapshot**: 轻量级 OOXML 文档快照，包含 plainText/html/documentXml
- **structuredBlocks**: 结构化文档块模型，运行时中间表示
- **current_content**: 已收缩为内部回退字段，不再对外暴露
- **paper_markdown**: 最小只读兼容字段，从 OOXML 或 structuredBlocks 派生

## 📊 当前状态摘要

### 架构状态
- ✅ 引擎抽象层已完成
- ✅ Embedded Office Engine 已切为默认主线
- ✅ Legacy TipTap Bridge 保留为兼容回退
- ✅ OOXML 包读写已接入真实 zip 解析

### OOXML 迁移进度
- ✅ 阶段 1: 任务层双写基础
- ✅ 阶段 2: 生成链补 OOXML 导出快照
- ✅ 阶段 3: 服务层优先读取 OOXML 快照
- ✅ 阶段 4: 编辑器和预览层 OOXML 优先
- 🔄 阶段 5: 收缩兼容字段（进行中）

### Smoke Test 覆盖
- ✅ `smoke:ooxml` - OOXML 包读写往返验证（图片、公式、表格）
- ✅ `smoke:ooxml-snapshot` - OOXML 快照完整性与多次往返稳定性
- ✅ `smoke:paper-stream` - 流式正文更新验证

## 🔄 更新记录

- **2026-03-18**: 
  - 完成 current_content 内外边界收缩
  - 新增 paper streaming smoke test
  - 新增 OOXML 快照完整性 smoke test
  - 创建 structuredBlocks 语义边界文档
  - 更新迁移清单至阶段 5
  - 删除过时的 2.0 状态文档
  
- **2026-03-17**: 
  - 任务管理 UI 完全移除
  - 任务历史持久化移除
  - 建立模块更新日志

- **2026-03-16**: 
  - Embedded Office Runtime 第一版落地
  - OOXML 真实包解析实现

## 📝 文档维护约定

1. **模块变更** → 追加到 [EMBEDDED_OFFICE_MODULE_UPDATE_LOG](./EMBEDDED_OFFICE_MODULE_UPDATE_LOG_20260317.md)
2. **迁移进度** → 更新 [OOXML_GLOBAL_MIGRATION_CHECKLIST](./OOXML_GLOBAL_MIGRATION_CHECKLIST_20260318.md)
3. **架构决策** → 记录到对应的设计文档
4. **重大里程碑** → 更新本 README 的更新记录

## 🚫 已删除的过时文档

- ~~当前状态文档_20260316.md~~ - AI Writer 2.0 的文档，与 3.0 无关，已于 2026-03-18 删除
