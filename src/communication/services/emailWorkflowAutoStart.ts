/**
 * emailWorkflowAutoStart.ts
 *
 * Helper logic for deciding whether an email's AI triage result should
 * automatically trigger a Flowable workflow, and for building the request payload.
 *
 * Keeping this logic outside CommunicationWorkbench keeps the component leaner
 * and makes the rules easy to unit-test in isolation.
 */

import type { AiMailTriageResult } from '../../types/mailTriage'
import type { StartEmailWorkflowInput } from '../../services/workflowClient'

// ── Skip / Trigger rules ──────────────────────────────────────────────────────

/**
 * Returns `true` if the AI triage result warrants an automatic workflow start.
 *
 * Skip conditions (evaluated first):
 *  - The thread lives in sent / trash / spam folders
 *  - emailCategory is spam or promotion
 *  - skipReason is system_delivery_notice
 *  - intentType is spam
 *
 * Trigger conditions (any one is sufficient):
 *  - intentType in [approval, task, request, attachment_review]
 *  - requiresAction === true
 *  - category === action_required
 *  - category === reply_required AND priority === high
 *  - timeIntent.hasTimeRequirement AND timeIntent.needsUserConfirmation
 */
export function shouldAutoStartWorkflow(
  triage: AiMailTriageResult,
  folder?: string,
): boolean {
  // ── Skip conditions ──────────────────────────────────────────────────────────
  if (folder === 'trash' || folder === 'sent' || folder === 'spam') return false
  if (triage.emailCategory === 'spam' || triage.emailCategory === 'promotion') return false
  if (triage.skipReason === 'system_delivery_notice') return false
  if (triage.actionPlan?.intentType === 'spam') return false

  // ── Trigger conditions ───────────────────────────────────────────────────────
  const intentType = triage.actionPlan?.intentType
  if (
    intentType === 'approval' ||
    intentType === 'task' ||
    intentType === 'request' ||
    intentType === 'attachment_review'
  ) return true

  if (triage.requiresAction === true) return true
  if ((triage as Record<string, unknown>).requiresApproval === true) return true

  if (triage.category === 'action_required') return true
  if (triage.category === 'reply_required' && triage.priority === 'high') return true

  if (triage.timeIntent?.hasTimeRequirement && triage.timeIntent.needsUserConfirmation) return true

  return false
}

// ── Payload builder ───────────────────────────────────────────────────────────

/**
 * Build a `StartEmailWorkflowInput` from triage data and thread metadata.
 * All required fields are guaranteed to be non-empty.
 *
 * Priority mapping (backend only accepts urgent | important | normal):
 *   triage.urgency === 'urgent'                       → 'urgent'
 *   triage.urgency === 'soon' OR priority === 'high'  → 'important'
 *   otherwise                                         → 'normal'
 */
export function buildAutoWorkflowInput(
  mailId: string,
  threadId: string,
  triage: AiMailTriageResult,
  subject: string,
  sender: string,
  requesterId: string,
  workspaceId: string,
): StartEmailWorkflowInput {
  const priority: 'urgent' | 'important' | 'normal' =
    triage.urgency === 'urgent' ? 'urgent'
    : (triage.urgency === 'soon' || triage.priority === 'high') ? 'important'
    : 'normal'

  return {
    sourceType: 'email',
    emailId: mailId,
    threadId: threadId || mailId,
    subject: subject || '(无主题)',
    sender: sender || 'unknown',
    requesterId: requesterId || 'demo-user',
    assignee: 'approver-001',
    priority,
    category: triage.emailCategory || triage.category || 'email_approval',
    aiSummary: triage.summary || '',
    attachmentIds: [],
    workspaceId: workspaceId || 'default',
  }
}
