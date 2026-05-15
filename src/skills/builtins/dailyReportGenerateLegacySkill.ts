/**
 * dailyReport.generate.legacy
 * 包装现有 PaperService.submitDailyReportTask 日报/工作总结生成流程
 * 提交任务后立即返回 taskId，生成进度由现有 UI 组件继续跟踪。
 */
import type { AiOfficeSkill, SkillExecutionContext, SkillExecutionResult } from '../types'
import {
  submitDailyReportTask,
  type PaperGenerationParams,
} from '../../modules/paper/services/PaperService'

interface DailyReportInput extends Record<string, unknown> {
  topic: string
  language?: string
  workspacePath?: string
  extraContext?: string
}

export const dailyReportGenerateLegacySkill: AiOfficeSkill<DailyReportInput> = {
  manifest: {
    id: 'dailyReport.generate.legacy',
    name: '日报/工作总结生成（Legacy）',
    version: '1.0.0',
    category: 'report',
    runtime: 'internal',
    description: '提交日报/工作总结生成任务，包装现有 PaperService.submitDailyReportTask',
    supportedInputs: ['text'],
    supportedOutputs: ['document'],
    requiredTools: ['paperService'],
  },

  async execute(
    input: DailyReportInput,
    context: SkillExecutionContext,
  ): Promise<SkillExecutionResult> {
    const { topic, language, extraContext } = input
    if (!topic) {
      return {
        status: 'failed',
        error: { code: 'INVALID_INPUT', message: '必须提供 topic 字段' },
      }
    }

    const params: PaperGenerationParams = {
      topic,
      scope: 'daily-report',
      language: language ?? 'zh',
      workspacePath: (input.workspacePath as string | undefined) ?? context.workspacePath,
      extraContext: extraContext as string | undefined,
    }

    context.onStatus?.('正在提交日报生成任务...')
    const taskId = await submitDailyReportTask(params)
    context.onStatus?.(`日报生成任务已提交，任务ID: ${taskId}`)

    return {
      status: 'success',
      output: { taskId },
    }
  },
}
