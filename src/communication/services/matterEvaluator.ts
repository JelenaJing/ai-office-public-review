/**
 * matterEvaluator.ts
 *
 * Evaluates a WorkflowMatter against policy rules and system check results
 * to produce a routing decision (auto_complete, missing_material, human_review, etc.).
 */

import type { WorkflowMatter, MatterEvaluation } from '../types/workflowMatter'
import type { MatterPolicy } from './matterPolicyRetriever'
import type { MockStudentInfo } from './connectors/mockStudentInfoConnector'
import type { MockCampusCardStatus } from './connectors/mockCampusCardConnector'
import type { MockPaymentStatus } from './connectors/mockPaymentConnector'
import type { MockTicket } from './connectors/mockTicketConnector'

export interface EvaluationContext {
  emailBody: string
  senderEmail: string
  attachmentNames: string[]
  policy: MatterPolicy | null
  studentInfo: MockStudentInfo | null
  cardStatus: MockCampusCardStatus | null
  paymentStatus: MockPaymentStatus | null
  openTickets: MockTicket[]
}

export function evaluateMatter(
  matter: WorkflowMatter,
  ctx: EvaluationContext,
): MatterEvaluation {
  const base: MatterEvaluation = {
    matterId: matter.matterId,
    scenarioType: matter.scenarioType,
    decision: 'human_review_required',
    confidence: 0,
    policyChecks: {
      matchedPolicyIds: ctx.policy?.matchedPolicyIds ?? [],
      requiredMaterials: ctx.policy?.requiredMaterials ?? [],
      providedMaterials: [],
      missingMaterials: [],
    },
    systemChecks: {},
    riskFlags: [],
    explanation: '',
    nextAction: '',
  }

  if (matter.scenarioType === 'campus_card_replacement') {
    return evaluateCampusCardReplacement(matter, ctx, base)
  }

  // Default: escalate to human review for unknown scenarios
  base.explanation = '未知场景，转人工复核。'
  base.nextAction = '人工复核'
  return base
}

function evaluateCampusCardReplacement(
  matter: WorkflowMatter,
  ctx: EvaluationContext,
  result: MatterEvaluation,
): MatterEvaluation {
  const { policy, studentInfo, paymentStatus, openTickets, emailBody, senderEmail } = ctx

  // ── 1. Student identity check ───────────────────────────────────────────────
  if (!studentInfo) {
    result.systemChecks.studentIdentity = 'failed'
    result.decision = 'human_review_required'
    result.confidence = 0.3
    result.explanation = `无法验证发件人 ${senderEmail} 的学生身份，需要人工复核。`
    result.nextAction = '请人工核实学生身份后再处理申请。'
    return result
  }
  result.systemChecks.studentIdentity = 'passed'

  // ── 2. Risk keyword check ───────────────────────────────────────────────────
  const combinedText = [emailBody, matter.subject, matter.summary].join(' ')
  const riskHits = (policy?.riskKeywords ?? []).filter((k) => combinedText.includes(k))
  if (riskHits.length > 0) {
    result.riskFlags.push(`检测到风险词：${riskHits.join('、')}`)
    result.decision = 'human_review_required'
    result.confidence = 0.2
    result.systemChecks.authMatch = 'failed'
    result.explanation = `邮件中出现代办/非本人申请风险词（${riskHits.join('、')}），转人工复核。`
    result.nextAction = '人工核实是否为本人申请。'
    return result
  }
  result.systemChecks.authMatch = 'passed'

  // ── 3. Required materials check ────────────────────────────────────────────
  const required = policy?.requiredMaterials ?? []
  const provided = required.filter((m) => combinedText.includes(m))
  const missing = required.filter((m) => !combinedText.includes(m))
  result.policyChecks.providedMaterials = provided
  result.policyChecks.missingMaterials = missing

  if (missing.length > 0) {
    result.decision = 'request_missing_material'
    result.confidence = 0.6
    result.explanation = `申请缺少必要材料：${missing.join('、')}。`
    result.nextAction = `请学生补充：${missing.join('、')}`
    return result
  }

  // ── 4. Duplicate ticket check ──────────────────────────────────────────────
  if (openTickets.length > 0) {
    result.systemChecks.duplicateTicket = 'failed'
    result.decision = 'human_review_required'
    result.confidence = 0.5
    result.explanation = `学生 ${studentInfo.studentId} 已有进行中的校园卡补办申请，请人工确认是否重复。`
    result.nextAction = '人工确认是否重复申请。'
    return result
  }
  result.systemChecks.duplicateTicket = 'passed'

  // ── 5. Payment check ───────────────────────────────────────────────────────
  if (paymentStatus && paymentStatus.status !== 'paid' && paymentStatus.status !== 'waived') {
    result.systemChecks.paymentStatus = 'failed'
    result.decision = 'request_missing_material'
    result.confidence = 0.55
    result.policyChecks.missingMaterials.push('补办费用缴纳')
    result.explanation = '尚未完成补办费用缴纳。'
    result.nextAction = '请学生先缴纳校园卡补办费用。'
    return result
  }
  result.systemChecks.paymentStatus = 'passed'

  // ── All checks passed → auto_complete ─────────────────────────────────────
  result.decision = 'auto_complete'
  result.confidence = 0.92
  result.explanation = '所有材料和系统检查通过，可智能体自动提交补办申请。'
  result.nextAction = '智能体自动提交校园卡补办。'
  return result
}
