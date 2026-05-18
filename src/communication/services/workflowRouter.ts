/**
 * workflowRouter.ts
 *
 * Decides the routing action based on a WorkflowMatter's pattern and
 * the MatterEvaluator's decision.
 */

import type { WorkflowMatter } from '../types/workflowMatter'
import type { MatterEvaluation } from '../types/workflowMatter'

export type RouterAction =
  | 'agent_auto_complete'
  | 'request_missing_material'
  | 'human_review'
  | 'start_linear_handoff'
  | 'start_approval'
  | 'single_step_confirm'

export function routeMatter(
  matter: WorkflowMatter,
  evaluation: MatterEvaluation,
): RouterAction {
  if (matter.workflowPattern === 'agent_autonomous') {
    if (evaluation.decision === 'auto_complete') return 'agent_auto_complete'
    if (evaluation.decision === 'request_missing_material') return 'request_missing_material'
    return 'human_review'
  }

  if (matter.workflowPattern === 'linear_handoff') return 'start_linear_handoff'
  if (matter.workflowPattern === 'approval_chain') return 'start_approval'

  return 'single_step_confirm'
}
