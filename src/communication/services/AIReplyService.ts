/**
 * AIReplyService — unified AI reply generation for email and chat threads.
 *
 * Both provider types call `runWritingAssistant` from WritingAssistantService.
 * Falls back to a typed mock reply if the LLM is unavailable.
 */
import { runWritingAssistant } from '../../modules/writing/services/WritingAssistantService'
import type { AIReplyInput } from '../types'

const AI_SIGNATURE = '\n\n（本条回复由 AI 自动生成，请确认后再发送。）'

export interface CommReplyCallbacks {
  onDelta: (text: string) => void
  onComplete: (text: string) => void
  onError: (msg: string) => void
}

/* ------------------------------------------------------------------ */
/*  Prompt builders                                                    */
/* ------------------------------------------------------------------ */

function buildEmailPrompt(input: AIReplyInput): string {
  const {
    thread,
    targetMessage,
    responderName = '用户',
    responderAddress = '',
    knowledgeContext,
  } = input

  const refBlock = knowledgeContext
    ? `\n\n参考资料：\n${knowledgeContext}`
    : ''

  return `You are a professional email reply expert. Write a well-crafted reply email from the perspective of the recipient.

Requirements:
1. Output the reply body directly — do NOT include a subject line.
2. You are replying on behalf of "${responderName} (${responderAddress})" to "${targetMessage.fromName} (${targetMessage.from})".
3. Address the counterparty by name.
4. Automatically determine the appropriate tone and structure based on the email type:
   - Task: confirm todos and deadlines in both languages
   - Request: respond to each item in both languages
   - Inquiry: answer step by step; if no clear basis, state "pending further confirmation" in both languages
   - Notification: brief acknowledgment only if a reply is needed; do NOT force a long reply
   - Attachment review: state the attachment handling plan in both languages
   - Approval: be formal and cautious; flag items requiring manual confirmation in both languages
5. If the email involves policy, procedures, deadlines, or approval criteria that are not clearly stated in the body, do NOT fabricate facts — state "pending further confirmation" in both languages.
6. Sign with "${responderName}" at the end of the Chinese section.
7. IMPORTANT — You MUST generate the reply in bilingual format. Use EXACTLY these two section headings with no variation:

English:

<English reply body here>

中文：

<Chinese reply body here>

The English version must appear first. The Chinese version must follow. Do NOT omit either section. The Chinese version should be a natural, formal Chinese expression of the same content — not a word-for-word translation.

Received email:
From: ${targetMessage.fromName} (${targetMessage.from})
Subject: ${thread.subject}
Body:
${targetMessage.body}${refBlock}`
}

function buildChatPrompt(input: AIReplyInput): string {
  const {
    thread,
    targetMessage,
    responderName = '用户',
    tone = 'friendly',
  } = input

  const toneDesc =
    tone === 'professional'
      ? '正式、专业'
      : tone === 'concise'
        ? '极简，一句话即可'
        : '自然、友好'

  const recentContext = thread.messages
    .slice(-6)
    .map((m) => `${m.isIncoming ? m.fromName : responderName}: ${m.body}`)
    .join('\n')

  const kbBlock = input.knowledgeContext
    ? `\n\n知识库参考资料（仅在与本次回复直接相关时参考，不要照搬原文）：\n${input.knowledgeContext}`
    : ''

  return `你是一个即时通信助手，帮助用户回复聊天消息。

要求：
1. 直接输出回复内容，不要加任何前缀
2. 语气${toneDesc}
3. 使用中文
4. 不超过3句话，简短自然，符合聊天习惯
5. 针对最新消息做出直接回应

最近对话记录：
${recentContext}${kbBlock}

请回复最后一条消息："${targetMessage.body}"`
}

/* ------------------------------------------------------------------ */
/*  Mock fallback                                                      */
/* ------------------------------------------------------------------ */

function buildMockReply(input: AIReplyInput): string {
  if (input.providerType === 'email') {
    const name = input.responderName ?? '用户'
    const subject = input.thread.subject
    const counterparty = input.targetMessage.fromName
    return (
      `English:\n\nDear ${counterparty},\n\n` +
      `Thank you for your email regarding "${subject}". I have reviewed your message carefully and will attend to the relevant matters as soon as possible.\n\n` +
      `Please feel free to reach out if you need anything further.\n\n` +
      `Best regards,\n${name}\n\n` +
      `中文：\n\n${counterparty}您好：\n\n` +
      `感谢您的来信。关于"${subject}"，我已仔细阅读您的邮件，会尽快处理相关事宜。\n\n` +
      `如有需要，欢迎随时与我联系。\n\n` +
      `${name} 敬上`
    )
  }
  return '好的，我知道了。稍后回复您。'
}

async function streamMock(
  text: string,
  callbacks: CommReplyCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const full = text + AI_SIGNATURE
  await new Promise<void>((resolve) => {
    let i = 0
    const step = () => {
      if (signal?.aborted) {
        callbacks.onError('已取消')
        resolve()
        return
      }
      i += Math.floor(Math.random() * 6) + 4
      if (i >= full.length) {
        callbacks.onDelta(full)
        callbacks.onComplete(full)
        resolve()
      } else {
        callbacks.onDelta(full.slice(0, i))
        setTimeout(step, 25)
      }
    }
    setTimeout(step, 300)
  })
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export async function generateCommReply(
  input: AIReplyInput,
  callbacks: CommReplyCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const prompt =
    input.providerType === 'email'
      ? buildEmailPrompt(input)
      : buildChatPrompt(input)

  let useMock = false

  try {
    let completedText = ''
    await runWritingAssistant(
      { instruction: prompt, language: 'zh' },
      {
        onDelta: (_delta, acc) => {
          if (!signal?.aborted) callbacks.onDelta(acc)
        },
        onComplete: ({ text }) => {
          completedText = text.trim()
        },
        onError: () => {
          useMock = true
        },
      },
      signal,
    )
    if (!useMock && completedText) {
      const final = completedText + AI_SIGNATURE
      callbacks.onDelta(final)
      callbacks.onComplete(final)
      return
    }
    useMock = true
  } catch {
    useMock = true
  }

  if (useMock) {
    await streamMock(buildMockReply(input), callbacks, signal)
  }
}
