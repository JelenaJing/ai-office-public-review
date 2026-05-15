/**
 * knowledge.writing.legacy
 * 包装现有 runWritingAssistant 知识库写作流程
 */
import type { AiOfficeSkill, SkillExecutionContext, SkillExecutionResult } from '../types'
import { runWritingAssistant } from '../../modules/writing/services/WritingAssistantService'

interface KnowledgeWritingInput extends Record<string, unknown> {
  instruction: string
  documentText?: string
  language?: 'zh' | 'en'
  extraContext?: string
}

export const knowledgeWritingLegacySkill: AiOfficeSkill<KnowledgeWritingInput> = {
  manifest: {
    id: 'knowledge.writing.legacy',
    name: '知识库写作（Legacy）',
    version: '1.0.0',
    category: 'document',
    runtime: 'internal',
    description: '基于知识库内容生成文稿，包装现有 runWritingAssistant 调用链',
    supportedInputs: ['text', 'knowledge', 'template'],
    supportedOutputs: ['document'],
    requiredTools: ['writingAssistant'],
  },

  async execute(
    input: KnowledgeWritingInput,
    context: SkillExecutionContext,
  ): Promise<SkillExecutionResult> {
    const { instruction, documentText, language, extraContext } = input
    if (!instruction) {
      return {
        status: 'failed',
        error: { code: 'INVALID_INPUT', message: '必须提供 instruction 字段' },
      }
    }

    let accumulated = ''
    const logs: string[] = []
    let hasError = false

    await runWritingAssistant(
      {
        instruction,
        documentText,
        language,
        extraContext: extraContext as string | undefined,
      },
      {
        onDelta: (delta, acc) => {
          accumulated = acc
          context.onDelta?.(delta, acc)
        },
        onComplete: ({ text }) => {
          accumulated = text
        },
        onError: (err) => {
          hasError = true
          logs.push(`error: ${err}`)
        },
        onStatus: (msg) => {
          context.onStatus?.(msg)
          logs.push(msg)
        },
      },
      context.signal,
    )

    if (hasError) {
      const errMsg = logs.find((l) => l.startsWith('error:')) ?? '写作失败'
      return { status: 'failed', error: { code: 'WRITING_ERROR', message: errMsg }, logs }
    }

    return {
      status: 'success',
      output: { text: accumulated },
      logs,
    }
  },
}
