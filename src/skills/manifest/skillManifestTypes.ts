import type { SkillKind as CapabilitySkillKind } from '../../capabilities/capabilityTypes'

export type SkillKind = CapabilitySkillKind

export type SkillDomain = 'document' | 'ppt' | 'email' | 'image' | 'excel' | 'general'

export const SKILL_MANIFEST_SCHEMA_VERSION = 'ai-office-skill-manifest-v1' as const

export type SkillManifestPermission =
  | 'workspace.read'
  | 'workspace.write'
  | 'knowledge.retrieve'
  | 'llm.generate'
  | 'document.write'
  | 'deck.write'
  | 'email.read'
  | 'email.draft'
  | 'calendar.write'

export const SKILL_MANIFEST_PERMISSION_ALLOWLIST: readonly SkillManifestPermission[] = [
  'workspace.read',
  'workspace.write',
  'knowledge.retrieve',
  'llm.generate',
  'document.write',
  'deck.write',
  'email.read',
  'email.draft',
  'calendar.write',
] as const

export const SKILL_MANIFEST_PERMISSION_DENYLIST = [
  'shell.execute',
  'fs.absolute',
  'network.raw',
  'process.spawn',
  'system.admin',
] as const

export interface SkillManifestAsset {
  /** 逻辑键 → 包内相对路径 */
  [key: string]: string
}

export interface SkillWorkflowStep {
  id: string
  title?: string
  capability: string
  inputs?: Record<string, unknown>
  repeat?: string
  capabilities?: string[]
}

export interface SkillManifest {
  schemaVersion: typeof SKILL_MANIFEST_SCHEMA_VERSION
  skillId: string
  name: string
  description?: string
  version: string
  kind: SkillKind
  domain: SkillDomain
  requiredCapabilities: string[]
  compatibleAgents?: string[]
  inputs?: Record<string, unknown>
  outputs?: Record<string, unknown>
  assets?: SkillManifestAsset
  prompts?: Record<string, string>
  permissions?: string[]
  workflow?: {
    steps: SkillWorkflowStep[]
  }
}

export interface SkillManifestValidationIssue {
  code: string
  message: string
  path?: string
  severity: 'error' | 'warning'
}

export interface SkillManifestValidationResult {
  ok: boolean
  errors: SkillManifestValidationIssue[]
  warnings: SkillManifestValidationIssue[]
}

export interface ParseSkillManifestJsonResult {
  ok: boolean
  manifest?: SkillManifest
  errors?: string[]
}

export interface ValidateSkillManifestOptions {
  /** Skill 包根目录；若提供则校验 assets / prompts 路径是否存在 */
  skillDir?: string
}
