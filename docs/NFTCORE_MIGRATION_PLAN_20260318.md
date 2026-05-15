# NFTCORE 完整流程迁移计划

**创建时间**: 2026-03-18  
**目标**: 将 NFTCORE/textfigure 的完整论文生成流程移植到 AI Writer 3.0

---

## 1. 架构对比分析

### NFTCORE 完整流程（20+ 步骤）

```
1. [动态规划] build_paper_plan_basic() 用 LLM 生成 4-8 个 section
   └─ 输入: topic + OpenAlex abstracts
   └─ 输出: PaperPlan with sections (title/description/importance/planned_figures)

2. [结构思考] Structure Thinking
   └─ 6句话自然段，streaming with <thinking> tags
   └─ 不同 paper_type 用不同 system prompt

3. [标题摘要思考] Title/Abstract Thinking
   └─ 独立推理步骤

4. [标题摘要生成] Title & Abstract Generation
   └─ 750词 Abstract（无引用标记）

5. [章节循环] For each section (4-8个):
   ├─ 5.1 [章节思考] Section Thinking
   │    └─ context-aware，引用前文 sections
   ├─ 5.2 [章节文字] Section Text Generation
   │    └─ 750词，2-3段，**无引用标记**（"Do NOT use [1], [2]"）
   ├─ 5.3 [知识树检查] Knowledge Tree Check
   │    └─ 验证内容准确性
   ├─ 5.4 [图片Prompt] Generate Figure Prompts
   │    └─ 1-3张图片，支持4子图组合模式
   ├─ 5.5 [图片生成] Generate Figures
   │    └─ 流式状态更新，质量检查，retry机制
   └─ 5.6 [图片Caption] Generate Figure Caption
        └─ overall_description + detail_description（或4个 subfigure_descriptions）
        └─ **无引用标记**（后续统一插入）

6. [Conclusion思考] Conclusion Thinking

7. [Conclusion生成] Conclusion Generation
   └─ 200-300词，**无引用标记**

8. [全文审查] Full Review
   └─ 独立 LLM 审查步骤

9. [引用整理] organize_references() **核心步骤**
   ├─ search_and_understand_references() 检索文献
   ├─ 清理已有引用标记（确保干净）
   ├─ 排除 Abstract + Conclusion 部分
   ├─ 分段（按双换行符）
   ├─ analyze_paragraphs_for_citations() **用 LLM 分析**哪些段落需要引用
   ├─ insert_references_with_numbering() 智能插入
   │    └─ 分析句子语义 + 文献匹配度
   │    └─ ReferenceNumberManager 管理编号
   └─ 返回 updated_markdown + reference_list

10. [公式推导] insert_formulas_stream() (可选，暂时禁用)
```

### AI Writer 3.0 现有流程（简化版）

```
1. [固定模板] 使用 standardSections 固定章节结构
2. 生成 Outline
3. 生成 Title
4. 生成 Abstract
5. For each section (固定4个):
   ├─ Section Thinking
   ├─ Section Text (直接要求含引用标记 [1] [2])
   ├─ Bridge Paragraph (过渡段)
   └─ 可选: 生成1张图片（整个论文最多3张）
6. (如果无 Discussion) 生成 Discussion
7. Conclusion Thinking
8. Conclusion Generation
9. [引用调整] organizeReferencesStream() 增量式验证和调整引用
10. 格式化 References 列表
```

---

## 2. 关键差异总结

| 特性 | NFTCORE | AI Writer 3.0 | 优先级 |
|------|---------|---------------|--------|
| **结构规划** | LLM 动态生成 | 固定模板 | 🔥 高 |
| **引用策略** | 直接生成含引用 + 增量调整 | 直接生成含引用 + 增量调整 | 🔥 **核心** |
| **图片数量** | 每节1-3张 | 全文最多3张 | 🔥 高 |
| **组合图** | 支持4子图 | 不支持 | 🟡 中 |
| **Caption质量** | LLM生成详细描述 | 简单 prompt | 🟡 中 |
| **知识树检查** | 有 | 无 | 🟡 中 |
| **全文审查** | 有 | 无 | 🟡 中 |
| **公式推导** | 有（暂禁用） | 无 | 🟢 低 |
| **过渡段** | 无 | 有 | ✅ 我们更好 |

---

## 3. 迁移策略

### Phase 1: 引用增量调整（已落地） ⭐ **最核心**

**目标**: 维持"生成时直接含引用"，并通过增量校验持续修正引用相关性和编号。

**实现模块**: `electron/main/services/referenceManager.ts`

**核心函数**:
- `organizeReferencesStream()` - 分段分析、插入/修正引用并重排编号
- `verifyAndFixCitations()` - 对已插入引用做相关性校验与替换
- `buildDeterministicSupplementalCitationActions()` - 模型建议不足时做确定性补充

**主流程改动**:
1. `generateSectionBodyWithCitations()`：章节生成阶段直接要求插入 [1]/[2] 引用
2. `generatePaperNFTCORE()`：每 2 章做一次增量整理，结论后做最终校验

---

### Phase 2: 动态结构规划

**目标**: 用 LLM 根据主题动态生成 4-8 个 section，而非固定模板

**新建模块**: `electron/main/services/paperStructurePlanner.ts`

**移植函数**:
- `buildPaperPlanDynamic()` - 用 LLM 生成动态 section 列表
- 接口: `PaperPlan`, `SectionPlan`

**修改点**:
1. `generatePaper()` - 先调用 `buildPaperPlanDynamic()` 获取 sections
2. 替换固定的 `standardSections` 为动态生成的 sections

---

### Phase 3: 图片生成增强

**目标**: 支持每 section 多张图、4子图组合、详细 caption

**新建模块**: `electron/main/services/advancedImageGenerator.ts`

**移植功能**:
- `generateSectionImages()` - 每个 section 生成 1-3 张图
- `generateCombinedImage()` - 4张子图组合（需要 canvas 库或 sharp）
- `generateFigureCaption()` - LLM 生成详细 caption（overall + detail 或 subfigure descriptions）

**依赖**: 需要图片处理库（sharp 或 canvas）

---

### Phase 4: 质量控制模块

**新建模块**: `electron/main/services/paperQualityControl.ts`

**移植功能**:
- `checkKnowledgeTree()` - 验证内容准确性（可选）
- `reviewFullPaper()` - 全文审查

---

### Phase 5: 独立模块（可选）

- 公式推导（NFTCORE 中暂时禁用，优先级低）
- Structure Thinking, Title/Abstract Thinking（额外的思考步骤）

---

## 4. 实施顺序

### 第一阶段 (核心功能)
1. ✅ 创建本文档
2. ✅ Phase 1: 引用增量调整 - **已接入主链路**
3. 🔄 Phase 2: 动态结构规划
4. 🔄 Phase 3: 图片生成增强（基础版：每节多张图 + 详细 caption）

### 第二阶段 (质量提升)
5. 🔄 Phase 4: 质量控制模块
6. 🔄 Phase 3: 图片生成进阶（组合图功能）

### 第三阶段 (可选功能)
7. 🔄 公式推导（如需要）

---

## 5. 技术挑战

### 挑战 1: Python → TypeScript 转换
- NFTCORE 用 Python 的正则、字符串处理
- 需要用 TypeScript 等价实现

### 挑战 2: 流式输出架构
- NFTCORE 用 Generator (`yield`)
- AI Writer 3.0 用回调 (`onProgress`, `onChunk`)
- 需要适配

### 挑战 3: 图片组合
- NFTCORE 用 Python Pillow (`combine_images()`)
- TypeScript 需要用 Sharp 或 Canvas 库

### 挑战 4: LLM 客户端差异
- NFTCORE 用 OpenAI client 直接调用
- AI Writer 3.0 封装了 `llmClient.ts`
- 需要统一接口

---

## 6. 成功标准

- ✅ 论文生成阶段直接带引用，后续执行增量调整与最终校验
- ✅ 用 LLM 动态生成 section 结构
- ✅ 每个 section 可生成多张图片
- ✅ 图片 caption 由 LLM 生成详细描述
- ✅ 全文审查步骤
- ✅ 完整流式进度反馈
- ✅ 保持向后兼容（不破坏现有 API）

---

## 7. 下一步行动

**当前结论**: 统一以 `referenceManager.ts` 作为引用处理入口，移除 `smartReferenceInserter.ts` 遗留实现，避免双路径分叉。
