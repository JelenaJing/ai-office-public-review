/**
 * AI-Office Skill 架构 — 核心类型定义
 *
 * Skill 是用户级任务能力单元，与底层 Tool/Service/Engine 区分。
 * 每个 Skill 有明确的输入/输出约定，可通过 SkillRegistry 注册、
 * 通过 SkillRuntime 统一执行。
 */

export type SkillCategory =
  | 'document'
  | 'paper'
  | 'presentation'
  | 'image'
  | 'mail'
  | 'chat'
  | 'report'
  | 'automation'
  | 'knowledge'

export type SkillRuntimeType = 'internal' | 'http' | 'local-process' | 'mcp'

export interface AiOfficeSkillManifest {
  id: string
  name: string
  version: string
  category: SkillCategory
  runtime: SkillRuntimeType
  description: string
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  requiredTools?: string[]
  requiredPermissions?: string[]
  supportedInputs?: string[]
  supportedOutputs?: string[]
}

export interface SkillArtifactRef {
  type: 'document' | 'image' | 'presentation' | 'audio' | 'data' | 'file'
  path?: string
  name?: string
  mimeType?: string
  url?: string
}

/**
 * Runtime context injected into every Skill execute() call.
 * Provides workspace/user info and optional streaming callbacks
 * for skills that produce incremental output.
 */
export interface SkillExecutionContext {
  workspacePath?: string
  departmentId?: string
  userId?: string
  signal?: AbortSignal
  /** Called when the skill emits a human-readable status update */
  onStatus?: (message: string) => void
  /** Called when the skill emits a text delta (streaming skills) */
  onDelta?: (delta: string, accumulated: string) => void
  /** Called when the skill produces a file/image artifact */
  onArtifact?: (artifact: SkillArtifactRef) => void
}

export interface SkillExecutionRequest {
  skillId: string
  userId?: string
  workspaceId?: string
  input: Record<string, unknown>
  context: SkillExecutionContext
}

export type SkillExecutionStatus = 'success' | 'failed' | 'requires_user_action'

export interface SkillExecutionError {
  code: string
  message: string
  detail?: unknown
}

export interface SkillExecutionResult {
  status: SkillExecutionStatus
  output?: Record<string, unknown>
  artifacts?: SkillArtifactRef[]
  error?: SkillExecutionError
  logs?: string[]
}

/**
 * A registered AI-Office Skill.
 * Generic TInput / TOutput are type-narrowed by individual skill implementations.
 */
export interface AiOfficeSkill<
  TInput extends Record<string, unknown> = Record<string, unknown>,
  TOutput extends Record<string, unknown> = Record<string, unknown>,
> {
  manifest: AiOfficeSkillManifest
  execute: (
    input: TInput,
    context: SkillExecutionContext,
  ) => Promise<SkillExecutionResult & { output?: TOutput }>
}
