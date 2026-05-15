/**
 * AI-Office Skill Runtime — unified execution engine
 *
 * All Skill invocations go through executeSkill().
 * Catches all exceptions and normalises them into SkillExecutionResult,
 * so raw errors never surface directly to the UI.
 */
import type { SkillExecutionRequest, SkillExecutionResult } from './types'
import { resolveSkill } from './registry'

/**
 * Execute a Skill by id or alias.
 * Never throws — all errors are captured in the returned result.
 */
export async function executeSkill(
  request: SkillExecutionRequest,
): Promise<SkillExecutionResult> {
  const { skillId, input, context } = request

  const skill = resolveSkill(skillId)
  if (!skill) {
    return {
      status: 'failed',
      error: {
        code: 'SKILL_NOT_FOUND',
        message: `未找到 Skill: ${skillId}`,
      },
    }
  }

  try {
    return await skill.execute(input, context)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      status: 'failed',
      error: {
        code: 'SKILL_EXECUTION_ERROR',
        message,
        detail: err instanceof Error ? { name: err.name, stack: err.stack } : err,
      },
    }
  }
}
