/**
 * cuhkszAgentWorkflow.ts
 *
 * Orchestrates the full campus-card-replacement agent flow using mock connectors
 * and the matter evaluator/router.
 */

import { getMockStudentByEmail } from './connectors/mockStudentInfoConnector'
import {
  getMockCampusCardStatus,
  submitMockCampusCardReplacement,
} from './connectors/mockCampusCardConnector'
import { getMockPaymentStatus } from './connectors/mockPaymentConnector'
import {
  findMockOpenTickets,
  createMockTicket,
} from './connectors/mockTicketConnector'
import { retrieveMatterPolicy } from './matterPolicyRetriever'
import { evaluateMatter } from './matterEvaluator'
import { routeMatter } from './workflowRouter'
import type { WorkflowMatter } from '../types/workflowMatter'

export interface AgentHandleInput {
  matter: WorkflowMatter
  senderEmail: string
  emailBody: string
  attachmentNames?: string[]
}

export type AgentWorkflowStatus =
  | 'auto_completed'
  | 'waiting_material'
  | 'human_review_required'

export interface AgentWorkflowResult {
  status: AgentWorkflowStatus
  message: string
  missingItems?: string[]
  ticketId?: string
  explanation?: string
}

export async function handleCampusCardReplacementMatter(
  input: AgentHandleInput,
): Promise<AgentWorkflowResult> {
  const { matter, senderEmail, emailBody, attachmentNames = [] } = input

  // Step 1: Retrieve policy
  const policy = retrieveMatterPolicy('campus_card_replacement')

  // Step 2: Look up student identity
  const studentInfo = getMockStudentByEmail(senderEmail)

  // Step 3: Campus card status
  const cardStatus = studentInfo
    ? getMockCampusCardStatus(studentInfo.studentId)
    : null

  // Step 4: Payment status
  const paymentStatus = studentInfo
    ? getMockPaymentStatus(studentInfo.studentId, 'campus_card_replacement')
    : null

  // Step 5: Find existing open tickets
  const openTickets = studentInfo
    ? findMockOpenTickets({
        studentId: studentInfo.studentId,
        scenarioType: 'campus_card_replacement',
      })
    : []

  // Step 6: Evaluate
  const evaluation = evaluateMatter(matter, {
    emailBody,
    senderEmail,
    attachmentNames,
    policy,
    studentInfo,
    cardStatus,
    paymentStatus,
    openTickets,
  })

  // Step 7: Route
  const route = routeMatter(matter, evaluation)

  if (route === 'agent_auto_complete') {
    // Create a tracking ticket and submit replacement
    const ticket = createMockTicket({
      studentId: studentInfo!.studentId,
      scenarioType: 'campus_card_replacement',
      subject: matter.subject,
      description: matter.summary,
      sourceEmailId: matter.emailId,
    })
    submitMockCampusCardReplacement({
      studentId: studentInfo!.studentId,
      name: studentInfo!.name,
      reason: matter.summary,
      contactEmail: senderEmail,
    })
    return {
      status: 'auto_completed',
      message: `CUHKSZ Agent 已完成校园卡补办材料校验，并自动提交办理流程（工单号：${ticket.ticketId}）。预计 5 个工作日内可领取。`,
      ticketId: ticket.ticketId,
      explanation: evaluation.explanation,
    }
  }

  if (route === 'request_missing_material') {
    return {
      status: 'waiting_material',
      message: `CUHKSZ Agent 需要学生补充材料：${evaluation.policyChecks.missingMaterials.join('、')}`,
      missingItems: evaluation.policyChecks.missingMaterials,
      explanation: evaluation.explanation,
    }
  }

  // human_review
  return {
    status: 'human_review_required',
    message: `智能体发现异常（${evaluation.explanation}），已转交人工复核。`,
    explanation: evaluation.explanation,
  }
}
