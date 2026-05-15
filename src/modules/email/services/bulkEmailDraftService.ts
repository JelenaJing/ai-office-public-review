import type { BulkEmailDraft, BulkEmailRecipient } from '../../../types/email'
import { stripThinkTags } from '../../../utils/StreamThinkFilter'

export interface GenerateBulkEmailDraftsInput {
  objective: string
  suggestedSubject?: string
  recipients: BulkEmailRecipient[]
  senderName?: string
  senderEmail?: string
  workspaceContext?: string
}

interface ParsedDraftPayload {
  subject?: string
  body?: string
}

function draftId(recipient: BulkEmailRecipient): string {
  return `bulk-${recipient.id || recipient.email}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function fallbackSubject(input: GenerateBulkEmailDraftsInput): string {
  const trimmed = input.suggestedSubject?.trim()
  if (trimmed) return trimmed
  const objective = input.objective.trim()
  return objective.length > 28 ? `${objective.slice(0, 28)}...` : objective || '群发邮件'
}

function fallbackBody(input: GenerateBulkEmailDraftsInput, recipient: BulkEmailRecipient): string {
  const name = recipient.name || recipient.email
  const sender = input.senderName || '用户'
  return `${name}您好：

${input.objective.trim() || '现向您同步相关事项，请您查收。'}

如有问题，欢迎随时与我联系。

祝好！
${sender}`
}

function extractJsonPayload(text: string): ParsedDraftPayload | null {
  const cleaned = stripThinkTags(text).trim()
  if (!cleaned) return null
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]
  const candidate = fenced || cleaned.match(/\{[\s\S]*\}/)?.[0] || cleaned
  try {
    const parsed = JSON.parse(candidate) as ParsedDraftPayload
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function buildPrompt(input: GenerateBulkEmailDraftsInput, recipient: BulkEmailRecipient): string {
  const senderLine = input.senderName || input.senderEmail
    ? `Sender: ${input.senderName || ''}${input.senderEmail ? ` <${input.senderEmail}>` : ''}`
    : 'Sender: current user'
  const subjectLine = input.suggestedSubject?.trim()
    ? `The user-provided subject is: ${input.suggestedSubject.trim()}`
    : 'Suggest a concise subject.'
  const contextLine = input.workspaceContext?.trim()
    ? `Workspace context:\n${input.workspaceContext.trim()}`
    : ''

  return `You are helping a user prepare a personalized bulk email draft. Generate exactly one email draft for the recipient below.

Important rules:
1. Do NOT send the email.
2. Personalize the body using the recipient's name, department, and position when useful.
3. Keep the tone professional, concise, and appropriate for an internal formal email.
4. Do not invent facts, dates, commitments, or policies that are not present in the user's objective.
5. Return strict JSON only, with exactly these keys: "subject" and "body".

Bulk email objective:
${input.objective.trim()}

${subjectLine}
${senderLine}

Recipient:
- Name: ${recipient.name || recipient.email}
- Email: ${recipient.email}
- Department: ${recipient.department || 'N/A'}
- Position: ${recipient.position || 'N/A'}

${contextLine}

JSON response format:
{"subject":"...","body":"..."}`
}

async function generateOneDraft(
  input: GenerateBulkEmailDraftsInput,
  recipient: BulkEmailRecipient,
): Promise<BulkEmailDraft> {
  const base: BulkEmailDraft = {
    id: draftId(recipient),
    recipient,
    subject: fallbackSubject(input),
    body: fallbackBody(input, recipient),
    status: 'draft',
  }

  if (!window.electronAPI?.writingAssistant) return base

  try {
    const raw = await window.electronAPI.writingAssistant({
      instruction: buildPrompt(input, recipient),
      language: 'zh',
    })
    const parsed = extractJsonPayload(raw)
    const subject = input.suggestedSubject?.trim() || parsed?.subject?.trim() || base.subject
    const body = parsed?.body?.trim() || stripThinkTags(raw).trim() || base.body
    return {
      ...base,
      subject,
      body,
      status: 'draft',
    }
  } catch (err) {
    return {
      ...base,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function generateBulkEmailDrafts(input: GenerateBulkEmailDraftsInput): Promise<BulkEmailDraft[]> {
  const objective = input.objective.trim()
  if (!objective) throw new Error('请输入群发目标')
  if (input.recipients.length === 0) throw new Error('请至少添加一个群发收件人')

  const drafts: BulkEmailDraft[] = []
  for (const recipient of input.recipients) {
    drafts.push(await generateOneDraft({ ...input, objective }, recipient))
  }
  return drafts
}
