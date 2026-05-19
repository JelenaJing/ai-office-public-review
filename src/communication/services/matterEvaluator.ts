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
import { extractCampusCardApplicationFields } from './campusCardApplicationExtractor'

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
  const { policy, studentInfo, paymentStatus, openTickets, emailBody, senderEmail, attachmentNames } = ctx
  const systemCheckDetails: MatterEvaluation['systemCheckDetails'] = []

  // ── 0. Structured field extraction ─────────────────────────────────────────
  const extracted = extractCampusCardApplicationFields({ emailBody, senderEmail, attachmentNames })
  result.extractedFields = {
    applicantName: extracted.applicantName,
    studentId: extracted.studentId,
    schoolEmail: extracted.schoolEmail,
    reason: extracted.reason,
    hasLostStatement: extracted.hasLostStatement,
    hasReplacementIntent: extracted.hasReplacementIntent,
    mentionedCampusCard: extracted.mentionedCampusCard,
  }
  result.evidence = extracted.evidence.map((e) => ({ ...e }))
  result.policyChecks.providedMaterials = extracted.providedFields
  result.policyChecks.missingMaterials = extracted.missingFields

  // ── 1. Student identity check ───────────────────────────────────────────────
  if (!studentInfo) {
    result.systemChecks.studentIdentity = 'failed'
    systemCheckDetails.push({
      name: '学生身份验证',
      status: 'failed',
      detail: `无法通过发件人 ${senderEmail} 匹配模拟学生身份。`,
    })
    result.systemCheckDetails = systemCheckDetails
    result.decision = 'human_review_required'
    result.confidence = 0.3
    result.explanation = `无法验证发件人 ${senderEmail} 的学生身份，需要人工复核。`
    result.nextAction = '请人工核实学生身份后再处理申请。'
    return result
  }
  result.systemChecks.studentIdentity = 'passed'
  systemCheckDetails.push({
    name: '学生身份验证',
    status: 'passed',
    detail: `已通过 ${senderEmail} 匹配到学生 ${studentInfo.name}（${studentInfo.studentId}）。`,
  })

  // ── 2. Risk keyword check ───────────────────────────────────────────────────
  const combinedText = [emailBody, matter.subject, matter.summary].join(' ')
  const riskHits = (policy?.riskKeywords ?? []).filter((k) => combinedText.includes(k))
  if (riskHits.length > 0) {
    result.riskFlags.push(`检测到风险词：${riskHits.join('、')}`)
    result.systemChecks.authMatch = 'failed'
    systemCheckDetails.push({
      name: '代办风险检测',
      status: 'failed',
      detail: `检测到风险词：${riskHits.join('、')}，可能为代办或非本人申请。`,
    })
    result.systemCheckDetails = systemCheckDetails
    result.decision = 'human_review_required'
    result.confidence = 0.2
    result.explanation = `邮件中出现代办/非本人申请风险词（${riskHits.join('、')}），转人工复核。`
    result.nextAction = '人工核实是否为本人申请。'
    return result
  }
  result.systemChecks.authMatch = 'passed'
  systemCheckDetails.push({
    name: '代办风险检测',
    status: 'passed',
    detail: '未检测到代办或非本人申请风险词。',
  })

  // ── 3. Required materials check (structured extraction) ────────────────────
  if (extracted.missingFields.length > 0) {
    result.decision = 'request_missing_material'
    result.confidence = 0.6
    result.explanation = `申请缺少必要材料：${extracted.missingFields.join('、')}。`
    result.nextAction = `请学生补充：${extracted.missingFields.join('、')}`
    systemCheckDetails.push({
      name: '申请材料核查',
      status: 'failed',
      detail: `已提供：${extracted.providedFields.join('、') || '（无）'}；缺少：${extracted.missingFields.join('、')}。`,
    })
    result.systemCheckDetails = systemCheckDetails
    return result
  }
  systemCheckDetails.push({
    name: '申请材料核查',
    status: 'passed',
    detail: `已提供全部必要材料：${extracted.providedFields.join('、')}。`,
  })

  // ── 4. Duplicate ticket check ──────────────────────────────────────────────
  if (openTickets.length > 0) {
    result.systemChecks.duplicateTicket = 'failed'
    systemCheckDetails.push({
      name: '重复工单检测',
      status: 'failed',
      detail: `学生 ${studentInfo.studentId} 已有 ${openTickets.length} 个进行中的校园卡补办工单（${openTickets.map((t) => t.ticketId).join('、')}）。`,
    })
    result.systemCheckDetails = systemCheckDetails
    result.decision = 'human_review_required'
    result.confidence = 0.5
    result.explanation = `学生 ${studentInfo.studentId} 已有进行中的校园卡补办申请，请人工确认是否重复。`
    result.nextAction = '人工确认是否重复申请。'
    return result
  }
  result.systemChecks.duplicateTicket = 'passed'
  systemCheckDetails.push({
    name: '重复工单检测',
    status: 'passed',
    detail: '未发现进行中的同类工单。',
  })

  // ── 5. Payment check ───────────────────────────────────────────────────────
  if (paymentStatus && paymentStatus.status !== 'paid' && paymentStatus.status !== 'waived') {
    result.systemChecks.paymentStatus = 'failed'
    result.policyChecks.missingMaterials.push('补办费用缴纳')
    systemCheckDetails.push({
      name: '缴费状态',
      status: 'failed',
      detail: `当前缴费状态：${paymentStatus.status}，尚未完成补办费用缴纳。`,
    })
    result.systemCheckDetails = systemCheckDetails
    result.decision = 'request_missing_material'
    result.confidence = 0.55
    result.explanation = '尚未完成补办费用缴纳。'
    result.nextAction = '请学生先缴纳校园卡补办费用。'
    return result
  }
  result.systemChecks.paymentStatus = 'passed'
  systemCheckDetails.push({
    name: '缴费状态',
    status: 'passed',
    detail: paymentStatus ? `缴费状态：${paymentStatus.status}，已通过。` : '（免缴费）已通过。',
  })

  // ── All checks passed → auto_complete ─────────────────────────────────────
  result.systemCheckDetails = systemCheckDetails
  result.decision = 'auto_complete'
  result.confidence = 0.92
  result.explanation = '身份、材料、缴费、重复工单检查均通过，可由 CUHKSZ Agent 自动提交补办申请。'
  result.nextAction = 'CUHKSZ Agent 自动提交校园卡补办申请。'
  return result
}
