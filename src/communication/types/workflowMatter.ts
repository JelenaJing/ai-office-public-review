/**
 * workflowMatter.ts
 *
 * Type definitions for AI-generated workflow matters — structured action packages
 * derived from email AI triage. A Matter groups related WorkItems and expresses
 * the workflow pattern (linear handoff, fan-out, approval chain, etc.).
 */

// ── Workflow pattern ──────────────────────────────────────────────────────────

/** Describes the structural shape of how work flows between people. */
export type WorkflowPattern =
  | 'linear_handoff'   // Point-to-point sequential handoff (e.g. student → advisor)
  | 'fan_out'          // One initiator → multiple parallel assignees
  | 'many_to_one'      // Multiple contributors → single approver
  | 'approval_chain'   // Multi-level sequential approvals
  | 'single_step'      // Single action, single assignee

// ── Scenario types ────────────────────────────────────────────────────────────

export type MatterScenarioType =
  | 'approval_request'
  | 'meeting_invitation'
  | 'material_collection'
  | 'document_review'
  | 'task_assignment'
  | 'information_summary'
  | 'research_progress_submission'
  | 'unknown'

// ── Work item types ───────────────────────────────────────────────────────────

export type WorkItemActionType =
  | 'reply'
  | 'confirm'
  | 'review'
  | 'approve'
  | 'reject'
  | 'forward'
  | 'schedule'
  | 'collect'
  | 'archive'
  | 'prepare_material'   // Prepare research progress documents
  | 'submit_form'        // Submit the form / materials to institution
  | 'advisor_review'     // Advisor reviews and signs off
  | 'handoff'            // Hand off responsibility to next role
  | 'archive_result'     // Archive the final outcome

export type WorkItemStatus = 'pending' | 'in_progress' | 'waiting' | 'completed' | 'rejected'

// ── Core data structures ──────────────────────────────────────────────────────

export interface WorkflowWorkItem {
  id: string
  title: string
  description?: string
  actionType: WorkItemActionType
  assigneeRole: string
  assigneeId?: string
  outputType?: 'document' | 'form_submission' | 'email_reply' | 'record' | 'none'
  requiredHumanSignature: boolean
  evidenceRequired?: boolean
  status?: WorkItemStatus
  /** IDs of WorkItems that must complete before this one can start */
  dependsOn?: string[]
  /** IDs of WorkItems that follow this one */
  nextWorkItemIds?: string[]
  /** Role to hand off to after this step */
  handoffToRole?: string
  /** Specific assignee ID to hand off to */
  handoffToId?: string
  dueAt?: string
}

export interface WorkflowMatter {
  matterId: string
  title: string
  summary: string
  scenarioType: MatterScenarioType
  workflowPattern: WorkflowPattern
  source: 'email'
  emailId: string
  threadId: string
  subject: string
  sender: string
  riskLevel: 'low' | 'medium' | 'high'
  status: 'draft' | 'in_progress' | 'completed' | 'cancelled'
  currentStepId?: string
  currentAssigneeRole?: string
  finalApproverRole?: string
  suggestedNextAction: string
  workItems: WorkflowWorkItem[]
  createdAt: string
}
