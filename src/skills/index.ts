/**
 * AI-Office Skills — public API
 *
 * External code should import from here rather than from individual sub-modules.
 */
export type {
  AiOfficeSkillManifest,
  AiOfficeSkill,
  SkillExecutionRequest,
  SkillExecutionResult,
  SkillExecutionContext,
  SkillExecutionStatus,
  SkillExecutionError,
  SkillArtifactRef,
  SkillCategory,
  SkillRuntimeType,
} from './types'

export {
  registerSkill,
  unregisterSkill,
  getSkill,
  listSkills,
  setDefaultSkill,
  getDefaultSkill,
  resolveSkill,
} from './registry'

export { executeSkill } from './runtime'

export { registerBuiltins } from './registerBuiltins'
