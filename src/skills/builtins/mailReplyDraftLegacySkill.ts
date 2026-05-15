/**
 * mail.replyDraft.legacy
 * 包装现有 AIReplyService.generateCommReply 邮件预回复草稿生成流程
 */
import type { AiOfficeSkill, SkillExecutionContext, SkillExecutionResult } from '../types'
import { generateCommReply } from '../../communication/services/AIReplyService'
import type { AIReplyInput, CommunicationThread, CommunicationMessage, CommTone } from '../../communication/types'

interface MailReplyDraftInput extends Record<string, unknown> {
  thread: CommunicationThread
  targetMessage: CommunicationMessage
  responderName?: string
  responderAddress?: string
  tone?: CommTone
  knowledgeContext?: string
}

export const mailReplyDraftLegacySkill: AiOfficeSkill<MailReplyDraftInput> = {
  manifest: {
    id: 'mail.replyDraft.legacy',
    name: '邮件预回复草稿（Legacy）',
    version: '1.0.0',
    category: 'mail',
    runtime: 'internal',
    description: '调用现有 AIReplyService.generateCommReply 生成邮件回复草稿',
    supportedInputs: ['mail-thread', 'knowledge'],
    supportedOutputs: ['mail-draft'],
    requiredTools: ['writingAssistant'],
  },

  async execute(
    input: MailReplyDraftInput,
    context: SkillExecutionContext,
  ): Promise<SkillExecutionResult> {
    const { thread, targetMessage, responderName, responderAddress, tone, knowledgeContext } = input
    if (!thread || !targetMessage) {
      return {
        status: 'failed',
        error: { code: 'INVALID_INPUT', message: '必须提供 thread 和 targetMessage 字段' },
      }
    }

    let accumulated = ''
    const logs: string[] = []
    let hasError = false

    const replyInput: AIReplyInput = {
      providerType: 'email',
      thread,
      targetMessage,
      responderName,
      responderAddress,
      tone,
      knowledgeContext,
    }

    context.onStatus?.('正在生成邮件草稿...')
    await generateCommReply(
      replyInput,
      {
        onDelta: (text) => {
          accumulated = text
          context.onDelta?.(text, text)
        },
        onComplete: (text) => {
          accumulated = text
        },
        onError: (msg) => {
          hasError = true
          logs.push(`error: ${msg}`)
        },
      },
      context.signal,
    )

    if (hasError) {
      const errMsg = logs.find((l) => l.startsWith('error:')) ?? '邮件草稿生成失败'
      return { status: 'failed', error: { code: 'REPLY_DRAFT_ERROR', message: errMsg }, logs }
    }

    return { status: 'success', output: { text: accumulated }, logs }
  },
}
