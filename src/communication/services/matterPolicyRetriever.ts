/**
 * matterPolicyRetriever.ts
 *
 * Retrieves policy rules for a given matter scenario type.
 * MVP: returns local hard-coded rules. Future version will query a real knowledge base.
 */

import type { MatterScenarioType } from '../types/workflowMatter'

export interface MatterPolicy {
  scenarioType: MatterScenarioType
  matchedPolicyIds: string[]
  requiredMaterials: string[]
  requiredKeywords: string[]
  riskKeywords: string[]
  description: string
}

const POLICIES: Partial<Record<MatterScenarioType, MatterPolicy>> = {
  campus_card_replacement: {
    scenarioType: 'campus_card_replacement',
    matchedPolicyIds: ['cuhksz-campus-card-replacement-policy-mvp'],
    requiredMaterials: ['姓名', '学号', '学校邮箱', '补办原因'],
    requiredKeywords: ['校园卡', '补办', '丢失', '挂失', 'student card', 'campus card'],
    riskKeywords: ['代办', '帮别人', '不是本人', '借用', 'on behalf', 'for someone else'],
    description:
      '校园卡补办需提供学生身份信息（姓名、学号、邮箱）及补办原因，需本人申请，不接受代办。',
  },
  research_progress_submission: {
    scenarioType: 'research_progress_submission',
    matchedPolicyIds: ['cuhksz-research-progress-policy-mvp'],
    requiredMaterials: ['研究进展报告', '导师确认', '提交截止日期'],
    requiredKeywords: ['research progress', 'progress report', '进展报告'],
    riskKeywords: [],
    description: '研究生需按时提交 Research Progress 报告，经导师审批后归档。',
  },
}

/** Retrieve policy rules for the given scenario. Returns null if no policy is defined. */
export function retrieveMatterPolicy(scenarioType: MatterScenarioType): MatterPolicy | null {
  return POLICIES[scenarioType] ?? null
}
