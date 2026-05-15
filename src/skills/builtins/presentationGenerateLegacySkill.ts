/**
 * presentation.generate.legacy
 * 包装现有 window.electronAPI.generatePptx IPC 调用
 *
 * 注意：此 Skill 接收已组装好的 slide plan（JSON），
 * 不负责从提示词生成 plan（那部分由 GenerationPromptComposer 负责）。
 * 后续如需端到端 PPT Skill，可新增 presentation.compose.legacy 包装 prompt → plan 阶段。
 */
import type { AiOfficeSkill, SkillExecutionContext, SkillExecutionResult } from '../types'

interface PresentationInput extends Record<string, unknown> {
  plan: Record<string, unknown>
  outputPath: string
  templateId?: string
}

export const presentationGenerateLegacySkill: AiOfficeSkill<PresentationInput> = {
  manifest: {
    id: 'presentation.generate.legacy',
    name: 'PPT 生成（Legacy）',
    version: '1.0.0',
    category: 'presentation',
    runtime: 'internal',
    description: '调用 Electron IPC generatePptx 将 slide plan 编译为 .pptx 文件',
    supportedInputs: ['presentation-plan', 'template'],
    supportedOutputs: ['presentation'],
    requiredTools: ['electronAPI', 'pptxGenJs'],
  },

  async execute(
    input: PresentationInput,
    context: SkillExecutionContext,
  ): Promise<SkillExecutionResult> {
    const { plan, outputPath, templateId } = input
    if (!plan || !outputPath) {
      return {
        status: 'failed',
        error: { code: 'INVALID_INPUT', message: '必须提供 plan 和 outputPath 字段' },
      }
    }

    context.onStatus?.('正在生成 PPT...')
    const result = await window.electronAPI.generatePptx({
      plan: plan as Record<string, unknown>,
      outputPath: outputPath as string,
      templateId: templateId as string | undefined,
    })

    if (!result.success) {
      return {
        status: 'failed',
        error: {
          code: 'PPT_GENERATION_ERROR',
          message: result.error ?? 'PPT 生成失败',
          detail: result,
        },
      }
    }

    context.onStatus?.(`PPT 已生成（${result.slideCount} 页）`)
    context.onArtifact?.({
      type: 'presentation',
      path: result.outputPath,
      name: result.outputPath.split(/[\\/]/).pop() ?? 'presentation.pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    })

    return {
      status: 'success',
      output: {
        outputPath: result.outputPath,
        slideCount: result.slideCount,
        templateId: result.templateId,
      },
      artifacts: [
        {
          type: 'presentation',
          path: result.outputPath,
          mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        },
      ],
    }
  },
}
