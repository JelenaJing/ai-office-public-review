// ---------------------------------------------------------------------------
// templateGeneration.ts — 正式模板模式 V1 类型定义
// ---------------------------------------------------------------------------
// 仅在 formalTemplate 模式下使用。自由写作模式不引用此文件中的任何类型。
// ---------------------------------------------------------------------------

import type { DocumentArtifact } from '../document/core'
import type { KnowledgeDocumentCategory, KnowledgeRetrievalMode } from './knowledge'

// ========================== 基础枚举 / 常量 ==========================

/** 模板来源格式 */
export type TemplateSourceType = 'docx' | 'doc'

export const FORMAL_TEMPLATE_DEBUG_SNAPSHOT_METADATA_KEY = 'formalTemplateDebug'

export type FormalTemplateTemplateKind = 'generic' | 'visit-letter' | 'congratulation-letter'

export type FormalTemplateRouteStrategy = 'overlay' | 'base-replace'

export type FormalTemplateFallbackAdapter = 'visit-letter-sample-adapter' | 'legacy-ooxml-patch'

export type FormalTemplateFallbackReasonCode =
  | 'schema-contract-missing'
  | 'schema-hydration-failed'
  | 'schema-region-mapping-failed'
  | 'schema-compile-failed'
  | 'schema-write-failed'
  | 'schema-shell-validation-failed'
  | 'unsupported-template-structure'

export type FormalTemplateExecutionMode =
  | {
      mode: 'schema-first'
      strategy: FormalTemplateRouteStrategy
      templateKind: FormalTemplateTemplateKind
      decisionSource: 'formal-template-routing-service'
    }
  | {
      mode: 'legacy-fallback'
      templateKind: FormalTemplateTemplateKind
      fallbackAdapter: FormalTemplateFallbackAdapter
      reasonCode: FormalTemplateFallbackReasonCode
      reason: string
    }

export interface FormalTemplateRoutingPlan {
  templateKind: FormalTemplateTemplateKind
  defaultExecution: Extract<FormalTemplateExecutionMode, { mode: 'schema-first' }>
  legacyFallbackAdapter?: FormalTemplateFallbackAdapter
}

export interface FormalTemplateDebugSnapshot {
  routingPlan?: FormalTemplateRoutingPlan
  executionMode?: FormalTemplateExecutionMode
}

/** 正式模板模式错误码 —— 均以 FT_ 前缀区分 */
export type FormalTemplateErrorCode =
  | 'FT_ADMISSION_INVALID_FORMAT'       // 文件不是合法 docx
  | 'FT_ADMISSION_NO_REGIONS'           // 解析不出任何可编辑区域
  | 'FT_ADMISSION_COMPATIBILITY_FAILED' // .doc → .docx 转换失败
  | 'FT_FIELD_CONFLICT'                 // 多样本字段值冲突
  | 'FT_FIELD_MISSING_REQUIRED'         // 必填字段缺失
  | 'FT_GENERATION_FAILED'              // LLM 区域生成失败
  | 'FT_OOXML_WRITE_FAILED'            // writeOoxmlPackage 返回 success:false
  | 'FT_SHELL_INTEGRITY_VIOLATED'       // 壳层校验：region 外 blocks 被篡改
  | 'FT_PREVIEW_BUILD_FAILED'           // 预览渲染失败
  | 'FT_UNKNOWN'                        // 未分类错误

// ========================== 调试追踪 ==========================

/** 每个 IPC 调用都可以返回的调试追踪结构 */
export interface ResolutionTrace {
  /** ISO 时间戳，标记这条 trace 的产生时刻 */
  timestamp: string
  /** 唯一 traceId，跨 IPC 可串联 */
  traceId: string
  /** 阶段标签：analyze / confirm / preview / commit */
  phase: 'analyze' | 'confirm' | 'preview' | 'commit'
  /** 每个关键步骤的日志行 */
  steps: Array<{
    label: string
    durationMs?: number
    detail?: string
  }>
  /** 若该阶段出错，记录错误码 + 消息 */
  error?: {
    code: FormalTemplateErrorCode
    message: string
  }
}

// ========================== Block 引用（复用 OOXML blocks 类型） ==========================

/**
 * OoxmlBlockRef 是 readOoxmlPackage 返回 blocks 的精简引用。
 * 不重新定义完整 block 类型，只保留识别和定位所需的字段。
 * 完整 block 结构由 readOoxmlPackage / writeOoxmlPackage 的已有类型承载。
 */
export interface OoxmlBlockRef {
  index: number
  kind: 'heading' | 'paragraph' | 'image-placeholder' | 'formula-placeholder' | 'table-placeholder' | 'page-break' | 'section-break'
  text: string
  level?: number
  sourceId?: string
}

// ========================== TemplateProfile ==========================

/**
 * TemplateProfile —— 一份正式模板的完整画像。
 * 由 analyzeFormalTemplateTask 产出，贯穿整个正式模板链路。
 */
export interface TemplateProfile {
  /** 模板画像唯一 ID */
  profileId: string
  /** 知识库文档 ID（即 KnowledgeDocumentMeta.id） */
  knowledgeDocumentId: string
  /** 模板原始文件路径（工作副本，非知识库原文件） */
  workCopyPath: string
  /** 模板来源格式 */
  sourceType: TemplateSourceType
  /** 文档分类（复用 knowledge.ts 中的分类） */
  documentCategory?: KnowledgeDocumentCategory
  /** 模板标题 */
  title: string

  // ---- 模式标记 ----
  /** 始终为 true，标识这是正式模板任务 */
  isFormalTemplate: true
  /** 是否要求壳层完整性校验（V1 始终为 true） */
  shellLocked: true
  /** 是否要求 OOXML 写回（V1 始终为 true，不允许 fallback） */
  requireOoxmlWrite: true
  /** 是否允许 HTML→DOCX fallback（V1 始终为 false） */
  allowFallback: false

  // ---- 结构 ----
  /** 模板中的所有字段 */
  fields: FieldSchema[]
  /** 模板中的所有区域 */
  regions: TemplateRegion[]
  /** blocks 快照下标范围（写回前壳层校验基准） */
  totalBlockCount: number
  /** 路由决策：formal template 统一执行主链与兼容兜底信息 */
  routingPlan?: FormalTemplateRoutingPlan

  // ---- 时间 ----
  createdAt: string
  updatedAt: string
}

// ========================== FieldSchema / FieldValue ==========================

/** 字段来源标识 */
export type FieldSourceKind =
  | 'content-control'   // w:sdt 内容控件
  | 'placeholder'       // {{字段名}} 占位符
  | 'sample-adapter'    // 样例适配层硬编码字段（仅样例化 Step C 使用）
  | 'doc-property'      // Word 文档属性（标题、作者等）

/** 字段数据类型（V1 先只支持前三种，后续可扩展） */
export type FieldDataType = 'text' | 'date' | 'number' | 'enum' | 'multiline'

/**
 * FieldSchema —— 模板中一个可填写字段的定义。
 * 来自解析阶段，不含用户填写值。
 */
export interface FieldSchema {
  /** 字段唯一 ID（自动生成的稳定 hash，基于位置 + 名称） */
  fieldId: string
  /** 显示名称（sdt title / 占位符名 / 属性名） */
  label: string
  /** 字段来源 */
  sourceKind: FieldSourceKind
  /** 字段数据类型 */
  dataType: FieldDataType
  /** 是否必填 */
  required: boolean
  /** 模板原始文本（占位符文本 / sdt 默认值） */
  defaultText: string
  /** 字段所在 block 下标（可能跨多个 block） */
  blockIndices: number[]
  /** 若 dataType 为 enum，可选值列表 */
  enumOptions?: string[]
  /** V1.1 扩展：样本文档中该字段的已有值 */
  sampleValues?: Array<{ sampleDocumentId: string; value: string }>
}

/**
 * FieldValue —— 用户对一个字段的填写值。
 */
export interface FieldValue {
  fieldId: string
  /** 用户填入的值 */
  value: string
  /** 是否由用户手动覆写（vs LLM 候选自动填充） */
  userOverride: boolean
  /** LLM 候选值（如果有） */
  candidateValue?: string
  /** 用户确认状态 */
  confirmed: boolean
}

// ========================== TemplateRegion ==========================

/**
 * 区域检测来源标识
 */
export type RegionDetectionKind =
  | 'heading-section'    // 按 heading 层级自动划分
  | 'content-control'    // w:sdt 包裹的区域
  | 'bookmark'           // w:bookmarkStart / End
  | 'sample-adapter'     // 样例适配层硬编码区域（仅样例化 Step C 使用）
  | 'placeholder-block'  // 整个 block 是占位符

/**
 * TemplateRegion —— 模板中一个可编辑区域。
 * 区域 = 连续的一段 blocks，可由 LLM 生成候选内容。
 */
export interface TemplateRegion {
  /** 区域唯一 ID */
  regionId: string
  /** 显示名称（heading 文本 / bookmark name / sdt title） */
  label: string
  /** 区域检测来源 */
  detectionKind: RegionDetectionKind
  /** 对应 blocks 中的连续下标范围 [startIndex, endIndex)（左闭右开） */
  blockRange: { start: number; end: number }
  /** 区域内原始纯文本（用于 diff 对比） */
  originalText: string
  /** 区域内 block 引用快照（轻量级，用于前端展示） */
  blockRefs: OoxmlBlockRef[]
  /** 是否允许 LLM 生成候选 */
  llmWritable: boolean
  /** 是否属于壳层（锁定区，LLM 不可写） */
  shellLocked: boolean
  /** V1.1 扩展：样本文档中该区域的已有内容 */
  sampleTexts?: Array<{ sampleDocumentId: string; text: string }>
}

// ========================== GenerationPlan ==========================

/**
 * RegionGenerationPlan —— 单个区域的生成计划。
 * 由 previewFormalTemplateTask 产出。
 */
export interface RegionGenerationContract {
  /** 轻量模板类型标识，用于调试与 prompt 注入 */
  templateKind?: string
  /** sample adapter 提供的结构化事实摘要 */
  contextSummary?: string
  /** 建议的段落职责 */
  paragraphInstructions?: string[]
  /** 生成正文时必须显式覆盖的实体/事实 */
  mustInclude?: string[]
  /** 生成正文时要避免泄漏或避免使用的短语 */
  avoidPhrases?: string[]
  /** 额外风格/风险约束 */
  styleConstraints?: string[]
  /** 期望段落数，仅用于 prompt 约束与后处理 */
  paragraphTarget?: number
  /** LLM 不可用或生成失败时的回退文本 */
  fallbackText?: string
}

export interface RegionGenerationPlan {
  regionId: string
  /** LLM 将使用的 prompt 策略标签（便于调试） */
  promptStrategy: 'fill-field' | 'generate-body' | 'rewrite-body'
  /** 参考材料 chunk 检索配置 */
  retrievalConfig: {
    mode: KnowledgeRetrievalMode
    referenceDocumentIds: string[]
    sampleDocumentIds: string[]
    maxChunks: number
  }
  /** 轻量生成合同：允许样例模板追加事实与写作约束，但不控制版式 */
  contract?: RegionGenerationContract
  /** 预估 token 消耗（前端展示用） */
  estimatedTokens?: number
}

/**
 * GenerationPlan —— 整个正式模板任务的生成计划。
 */
export interface GenerationPlan {
  profileId: string
  /** 所有需要生成的区域计划（不包含 shellLocked 区域） */
  regionPlans: RegionGenerationPlan[]
  /** 所有需要填充的字段 ID（不包含已确认的） */
  pendingFieldIds: string[]
  /** 预估总 token 消耗 */
  estimatedTotalTokens?: number
}

// ========================== RenderResult ==========================

/**
 * RegionRenderResult —— 单个区域的生成 / 写回结果。
 */
export interface RegionRenderResult {
  regionId: string
  /** 生成的候选文本 */
  candidateText: string
  /** 是否已写回 OOXML */
  committed: boolean
  /** 写回后该区域的最新 block 引用 */
  updatedBlockRefs?: OoxmlBlockRef[]
}

/**
 * RenderResult —— 整个正式模板任务的渲染/写回汇总。
 */
export interface RenderResult {
  profileId: string
  /** 输出文件路径（写回后的 docx 工作副本） */
  outputPath: string
  /** vNext 兼容桥：只读预览优先消费的 Document JSON artifact */
  documentArtifact?: DocumentArtifact
  /** 本次 formal template 执行模式，便于审计 schema-first / fallback */
  executionMode?: FormalTemplateExecutionMode
  /** 各区域结果 */
  regionResults: RegionRenderResult[]
  /** 各字段最终值 */
  fieldValues: FieldValue[]
  /** 本次写回后实际发生变化的 block 下标摘要 */
  changedIndices: number[]
  /** 写回是否全部成功 */
  allCommitted: boolean
  /** 壳层校验结果 */
  shellValidation: ShellValidationResult
}

// ========================== ShellValidationResult ==========================

/**
 * ShellValidationResult —— 壳层校验结果。
 * 写回后 re-read，比对 region 外 blocks 是否被篡改。
 */
export interface ShellValidationResult {
  /** 是否通过 */
  passed: boolean
  /** 校验的 block 总数 */
  checkedBlockCount: number
  /** 被篡改的 block 下标列表（passed=false 时非空） */
  violatedBlockIndices: number[]
  /** 校验耗时 ms */
  durationMs: number
  /** 失败时的错误码 */
  errorCode?: 'FT_SHELL_INTEGRITY_VIOLATED'
  /** 失败时的可读消息 */
  errorMessage?: string
}

// ========================== IPC request / response ==========================

// ---- 1. analyzeFormalTemplateTask ----

/** analyze 请求 */
export interface AnalyzeFormalTemplateRequest {
  /** 知识库文档 ID（必须是 doc/docx） */
  knowledgeDocumentId: string
  /** 样本文档 ID 列表（可选，用于辅助字段预填） */
  sampleDocumentIds?: string[]
  /** 工作区路径（模板工作副本将放在此工作区下） */
  workspacePath: string
}

/** analyze 响应 */
export interface AnalyzeFormalTemplateResponse {
  success: boolean
  /** 模板画像（成功时存在） */
  profile?: TemplateProfile
  /** 错误码 */
  errorCode?: FormalTemplateErrorCode
  /** 可读错误消息 */
  errorMessage?: string
  /** 调试追踪 */
  trace: ResolutionTrace
}

// ---- 2. confirmFormalTemplateFields ----

/** confirm 请求 */
export interface ConfirmFormalTemplateFieldsRequest {
  /** 模板画像 ID */
  profileId: string
  /** 工作副本路径 */
  workCopyPath: string
  /** 用户确认后的字段值列表 */
  fieldValues: FieldValue[]
}

/** confirm 响应 */
export interface ConfirmFormalTemplateFieldsResponse {
  success: boolean
  /** 写回后更新的 profile（字段已填充，blockRefs 可能变化） */
  updatedProfile?: TemplateProfile
  /** 未通过校验的字段 ID（required 但 value 为空） */
  invalidFieldIds?: string[]
  errorCode?: FormalTemplateErrorCode
  errorMessage?: string
  trace: ResolutionTrace
}

// ---- 3. previewFormalTemplateTask ----

/** preview 请求 */
export interface PreviewFormalTemplateTaskRequest {
  /** 模板画像 ID */
  profileId: string
  /** 工作副本路径 */
  workCopyPath: string
  /** 用户指令 / 主题描述 */
  instruction: string
  /** 参考材料文档 ID 列表 */
  referenceDocumentIds: string[]
  /** 样本文档 ID 列表 */
  sampleDocumentIds: string[]
  /** 前端 session 中当前字段值，仅用于 session-only preview */
  fieldValues?: FieldValue[]
  /** 检索策略 */
  retrievalMode: KnowledgeRetrievalMode
  /** 指定要生成的区域 ID（空数组 = 全部 llmWritable 区域） */
  targetRegionIds?: string[]
  /** 文稿工作区明确选择的知识库 ID 列表（空数组 = 使用当前激活知识库） */
  knowledgeBaseIds?: string[]
}

/** preview 阶段唯一返回的中间正文候选 */
export interface PreviewRegionCandidate {
  regionId: string
  label: string
  candidateText: string
  candidateParagraphs?: string[]
}

/** preview 响应 */
export interface PreviewFormalTemplateTaskResponse {
  success: boolean
  /** 生成计划 */
  plan?: GenerationPlan
  /** C1 仅返回唯一中间正文区候选 */
  regionCandidate?: PreviewRegionCandidate
  /** 通用正式模板可返回多个区域候选 */
  regionCandidates?: PreviewRegionCandidate[]
  /** 各区域的参考材料检索预览（用于前端展示来源） */
  retrievalPreview?: Array<{
    regionId: string
    hitCount: number
    topHitSummary?: string
  }>
  errorCode?: FormalTemplateErrorCode
  errorMessage?: string
  trace: ResolutionTrace
}

// ---- 4. commitFormalTemplateTask ----

/** commit 请求 */
export interface CommitFormalTemplateTaskRequest {
  /** 模板画像 ID */
  profileId: string
  /** 工作副本路径 */
  workCopyPath: string
  /** 原始生成需求，用于 commit 前的语义一致性校验 */
  instruction?: string
  /** 最终字段值（可能在 preview 阶段被 LLM 补充了候选） */
  fieldValues: FieldValue[]
  /** 各区域的确认内容 */
  regionPatches: Array<{
    regionId: string
    /** 用户确认后的最终文本 */
    finalText: string
    /** 与 preview 共用的结构化段落列表 */
    finalParagraphs?: string[]
  }>
}

/** commit 响应 */
export interface CommitFormalTemplateTaskResponse {
  success: boolean
  /** 完整渲染/写回结果 */
  result?: RenderResult
  errorCode?: FormalTemplateErrorCode
  errorMessage?: string
  trace: ResolutionTrace
}
