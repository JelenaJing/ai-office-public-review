/**
 * AI-Office Skill Registry — in-memory singleton
 *
 * All registered Skills and default aliases are stored here.
 * Registry is renderer-process only and lives for the duration of the app session.
 * Pre-reserved for future persistence via workspace/user settings.
 */
import type { AiOfficeSkill } from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _skills = new Map<string, AiOfficeSkill<any, any>>()
const _defaults = new Map<string, string>()

/** Register a Skill. Overwrites any existing Skill with the same id. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerSkill(skill: AiOfficeSkill<any, any>): void {
  _skills.set(skill.manifest.id, skill)
}

/** Remove a Skill by id. Returns true if the skill existed. */
export function unregisterSkill(skillId: string): boolean {
  return _skills.delete(skillId)
}

/** Look up a Skill by its exact id. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getSkill(skillId: string): AiOfficeSkill<any, any> | undefined {
  return _skills.get(skillId)
}

/** Return all registered Skills. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function listSkills(): AiOfficeSkill<any, any>[] {
  return Array.from(_skills.values())
}

/**
 * Assign a default Skill for a given alias (e.g. 'knowledge.writing.default').
 * The runtime resolves the alias to a concrete skillId before execution.
 */
export function setDefaultSkill(alias: string, skillId: string): void {
  _defaults.set(alias, skillId)
}

/** Retrieve the skillId mapped to the given alias, if any. */
export function getDefaultSkill(alias: string): string | undefined {
  return _defaults.get(alias)
}

/**
 * Resolve a Skill by direct id or alias.
 * Tries direct lookup first; falls back to alias → skillId → skill.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function resolveSkill(aliasOrId: string): AiOfficeSkill<any, any> | undefined {
  const direct = _skills.get(aliasOrId)
  if (direct) return direct
  const resolvedId = _defaults.get(aliasOrId)
  if (resolvedId) return _skills.get(resolvedId)
  return undefined
}
