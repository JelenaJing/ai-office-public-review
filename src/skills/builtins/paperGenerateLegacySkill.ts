/**
 * paper.generate.legacy
 * 包装现有 PaperService.submitTask 论文生成流程
 * 提交任务后立即返回 taskId，生成进度由现有 UI 组件继续跟踪。
 */
import type { AiOfficeSkill, SkillExecutionContext, SkillExecutionResult } from '../types'
import {
  submitTask,
  type PaperGenerationParams,
} from '../../modules/paper/services/PaperService'

interface PaperGenerateInput extends Record<string, unknown> {
  topic: string
  paperType?: 'research' | 'review' | 'thesis_research'
  language?: string
  workspacePath?: string
  scope?: 'paper' | 'daily-report' | 'essay-writing'
  extraContext?: string
  yearFrom?: string
  yearTo?: string
}

export const paperGenerateLegacySkill: AiOfficeSkill<PaperGenerateInput> = {
  manifest: {
    id: 'paper.generate.legacy',
    name: '论文生成（Legacy）',
    version: '1.0.0',
    category: 'paper',
    runtime: 'internal',
    description: '提交论文生成任务，包装现有 PaperService.submitTask 调用链',
    supportedInputs: ['text', 'knowledge'],
    supportedOutputs: ['document'],
    requiredTools: ['paperService', 'electronAPI'],
  },

  async execute(
    input: PaperGenerateInput,
    context: SkillExecutionContext,
  ): Promise<SkillExecutionResult> {
    const { topic, paperType, language, scope, extraContext, yearFrom, yearTo } = input
    if (!topic) {
      return {
        status: 'failed',
        error: { code: 'INVALID_INPUT', message: '必须提供 topic 字段' },
      }
    }

    const params: PaperGenerationParams = {
      topic,
      paperType: paperType ?? 'research',
      language: language ?? 'zh',
      workspacePath: (input.workspacePath as string | undefined) ?? context.workspacePath,
      scope: scope ?? 'paper',
      extraContext: extraContext as string | undefined,
      yearFrom: yearFrom as string | undefined,
      yearTo: yearTo as string | undefined,
    }

    context.onStatus?.('正在提交论文生成任务...')
    const taskId = await submitTask(params)
    context.onStatus?.(`论文生成任务已提交，任务ID: ${taskId}`)

    return {
      status: 'success',
      output: { taskId },
    }
  },
}
