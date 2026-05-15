/**
 * templateDocument.generate.legacy
 * 包装现有 runWritingAssistant 正式模板文稿生成模式
 */
import type { AiOfficeSkill, SkillExecutionContext, SkillExecutionResult } from '../types'
import { runWritingAssistant } from '../../modules/writing/services/WritingAssistantService'

interface TemplateDocumentInput extends Record<string, unknown> {
  instruction: string
  templateTitle?: string
  templateExtractedText?: string
  templateOutline?: string[]
  language?: 'zh' | 'en'
  extraContext?: string
}

export const templateDocumentGenerateLegacySkill: AiOfficeSkill<TemplateDocumentInput> = {
  manifest: {
    id: 'templateDocument.generate.legacy',
    name: '正式模板文稿生成（Legacy）',
    version: '1.0.0',
    category: 'document',
    runtime: 'internal',
    description: '基于正式模板生成文稿，包装现有 runWritingAssistant knowledge-template-document 模式',
    supportedInputs: ['text', 'template'],
    supportedOutputs: ['document'],
    requiredTools: ['writingAssistant'],
  },

  async execute(
    input: TemplateDocumentInput,
    context: SkillExecutionContext,
  ): Promise<SkillExecutionResult> {
    const { instruction, templateTitle, templateExtractedText, templateOutline, language, extraContext } =
      input
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
        language,
        extraContext: extraContext as string | undefined,
        generationMode: 'knowledge-template-document',
        templateDocument: templateTitle
          ? {
              title: templateTitle,
              extractedText: (templateExtractedText as string) ?? '',
              outline: templateOutline as string[] | undefined,
            }
          : undefined,
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
      const errMsg = logs.find((l) => l.startsWith('error:')) ?? '模板文稿生成失败'
      return { status: 'failed', error: { code: 'GENERATION_ERROR', message: errMsg }, logs }
    }

    return { status: 'success', output: { text: accumulated }, logs }
  },
}
