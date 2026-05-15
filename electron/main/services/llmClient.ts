import type { AppSettings } from './settingsStore'
import { formatProviderLabel, getLlmProviderPreset, resolveLlmEndpoint } from '../../../src/shared/ai/providerCatalog'
import { userActionLogService } from './userActionLogService'

export interface PromptInputImage {
  base64: string
  mediaType: string
}

export interface PromptInput {
  systemPrompt: string
  userPrompt: string
  temperature?: number
  maxTokens?: number
  images?: PromptInputImage[]
  /** Optional: identifies which AI feature triggered this call, used for work activity logging. */
  featureName?: string
}

const LLM_MAX_ATTEMPTS = 3

function ensureLlmConfigured(settings: AppSettings): void {
  if (!settings.llm.apiKey.trim()) {
    if (settings.llm.useBuiltinKey) {
      const preset = getLlmProviderPreset(settings.llm.provider)
      const envHint = preset.builtinKeyEnvNames.length > 0 ? `，可通过 ${preset.builtinKeyEnvNames.join(' / ')} 配置` : ''
      throw new Error(`当前文字提供方 ${formatProviderLabel(settings.llm.provider)} 没有可用的内置 API Key，请在设置中关闭内置 Key 或手动填写 API Key${envHint}`)
    }
    throw new Error('请先在设置中配置文字模型 API Key')
  }
}

function extractFetchReason(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause
    if (cause instanceof Error && cause.message) {
      return cause.message
    }
    return error.message
  }
  return String(error)
}

function wrapFetchError(label: string, endpoint: string, error: unknown): Error {
  let target = endpoint
  try {
    target = new URL(endpoint).origin
  } catch {
    target = endpoint
  }
  return new Error(`${label}网络请求失败: ${target}，${extractFetchReason(error)}`)
}

function wrapTransientLlmError(label: string, endpoint: string, error: unknown): Error {
  let target = endpoint
  try {
    target = new URL(endpoint).origin
  } catch {
    target = endpoint
  }
  return new Error(`${label}连接中断: ${target}，${extractFetchReason(error)}。这通常是上游模型流在生成过程中被断开，可稍后重试。`)
}

function normalizeLlmError(label: string, endpoint: string, error: unknown): Error {
  if (shouldRetryTransientError(error)) {
    return wrapTransientLlmError(label, endpoint, error)
  }
  if (error instanceof Error) {
    return error
  }
  return wrapFetchError(label, endpoint, error)
}

function chunkText(text: string, size = 120): string[] {
  const chunks: string[] = []
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size))
  }
  return chunks
}

function shouldRetryTransientError(error: unknown): boolean {
  const reason = extractFetchReason(error).toLowerCase()
  return reason.includes('terminated') || reason.includes('socket') || reason.includes('econnreset') || reason.includes('aborted')
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function parseEventStream(
  response: Response,
  onChunk: (chunk: string) => void | Promise<void>,
): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('上游模型未返回可读流')
  }
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''

    for (const part of parts) {
      const line = part
        .split('\n')
        .find((entry) => entry.startsWith('data: '))
      if (!line) continue

      const payload = line.slice(6).trim()
      if (payload === '[DONE]') continue

      try {
        const data = JSON.parse(payload) as Record<string, any>
        const delta =
          data.choices?.[0]?.delta?.content ??
          data.choices?.[0]?.message?.content ??
          data.delta?.text ??
          ''

        if (delta) {
          fullText += delta
          await onChunk(delta)
        }
      } catch {
        continue
      }
    }
  }

  return fullText
}

export async function completeText(settings: AppSettings, input: PromptInput, signal?: AbortSignal): Promise<string> {
  ensureLlmConfigured(settings)
  const endpoint = resolveLlmEndpoint(settings.llm.provider, settings.llm.baseUrl)
  const startedAt = new Date().toISOString()
  const t0 = Date.now()

  const logPrompt = () => {
    try {
      userActionLogService.appendAction({
        module: 'llmClient',
        action: 'completeText',
        eventType: 'ai_prompt_submitted',
        startedAt,
        status: 'success',
        details: {
          featureName: input.featureName ?? 'completeText',
          provider: settings.llm.provider,
          model: settings.llm.model,
          promptSummary: input.userPrompt.slice(0, 200),
          systemPromptSummary: input.systemPrompt.slice(0, 200),
        },
      })
    } catch { /* never crash main logic */ }
  }

  for (let attempt = 1; attempt <= LLM_MAX_ATTEMPTS; attempt += 1) {
    try {
      if (settings.llm.provider === 'anthropic') {
        const userContent: unknown[] = []
        for (const img of input.images ?? []) {
          userContent.push({
            type: 'image',
            source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
          })
        }
        userContent.push({ type: 'text', text: input.userPrompt })

        let response: Response
        try {
          response = await fetch(endpoint, {
            method: 'POST',
            signal,
            headers: {
              'content-type': 'application/json',
              'x-api-key': settings.llm.apiKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: settings.llm.model,
              max_tokens: input.maxTokens ?? 1800,
              temperature: input.temperature ?? 0.6,
              system: input.systemPrompt,
              messages: [{ role: 'user', content: userContent }],
            }),
          })
        } catch (error) {
          throw wrapFetchError('Anthropic', endpoint, error)
        }

        if (!response.ok) {
          throw new Error(`Anthropic 调用失败: ${response.status} ${await response.text()}`)
        }

        const data = (await response.json()) as Record<string, any>
        const output = data.content?.map((item: Record<string, any>) => item.text ?? '').join('') ?? ''
        logPrompt()
        try {
          userActionLogService.appendAction({
            module: 'llmClient', action: 'completeText', eventType: 'ai_task_completed',
            startedAt, durationMs: Date.now() - t0, status: 'success',
            details: { featureName: input.featureName ?? 'completeText', provider: settings.llm.provider, model: settings.llm.model, outputSummary: output.slice(0, 200), durationMs: Date.now() - t0, success: true },
          })
        } catch { /* never crash main logic */ }
        return output
      }

      // Build user message content: images first, then text (OpenAI vision format)
      const userMessageContent: unknown = (input.images && input.images.length > 0)
        ? [
            ...input.images.map((img) => ({
              type: 'image_url',
              image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
            })),
            { type: 'text', text: input.userPrompt },
          ]
        : input.userPrompt

      let response: Response
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          signal,
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${settings.llm.apiKey}`,
          },
          body: JSON.stringify({
            model: settings.llm.model,
            temperature: input.temperature ?? 0.6,
            max_tokens: input.maxTokens ?? 1800,
            stream: false,
            messages: [
              { role: 'system', content: input.systemPrompt },
              { role: 'user', content: userMessageContent },
            ],
          }),
        })
      } catch (error) {
        throw wrapFetchError('文字模型', endpoint, error)
      }

      if (!response.ok) {
        throw new Error(`模型调用失败: ${response.status} ${await response.text()}`)
      }

      const data = (await response.json()) as Record<string, any>
      const output = data.choices?.[0]?.message?.content ?? ''
      logPrompt()
      try {
        userActionLogService.appendAction({
          module: 'llmClient', action: 'completeText', eventType: 'ai_task_completed',
          startedAt, durationMs: Date.now() - t0, status: 'success',
          details: { featureName: input.featureName ?? 'completeText', provider: settings.llm.provider, model: settings.llm.model, outputSummary: output.slice(0, 200), durationMs: Date.now() - t0, success: true },
        })
      } catch { /* never crash main logic */ }
      return output
    } catch (error) {
      if (attempt >= LLM_MAX_ATTEMPTS || !shouldRetryTransientError(error)) {
        try {
          userActionLogService.appendAction({
            module: 'llmClient', action: 'completeText', eventType: 'ai_task_failed',
            startedAt, durationMs: Date.now() - t0, status: 'failed',
            errorMessage: error instanceof Error ? error.message : String(error),
            details: { featureName: input.featureName ?? 'completeText', provider: settings.llm.provider, model: settings.llm.model, success: false },
          })
        } catch { /* never crash main logic */ }
        throw normalizeLlmError('文字模型', endpoint, error)
      }
      await sleep(800 * attempt)
    }
  }

  throw new Error('文字模型调用失败: unexpected retry exhaustion')
}

export async function streamText(
  settings: AppSettings,
  input: PromptInput,
  onChunk: (chunk: string) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<string> {
  ensureLlmConfigured(settings)
  const endpoint = resolveLlmEndpoint(settings.llm.provider, settings.llm.baseUrl)
  const startedAt = new Date().toISOString()
  const t0 = Date.now()

  if (settings.llm.provider === 'anthropic') {
    const full = await completeText(settings, input)
    for (const chunk of chunkText(full)) {
      await onChunk(chunk)
    }
    return full
  }

  for (let attempt = 1; attempt <= LLM_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${settings.llm.apiKey}`,
        },
        body: JSON.stringify({
          model: settings.llm.model,
          temperature: input.temperature ?? 0.6,
          max_tokens: input.maxTokens ?? 1800,
          stream: true,
          messages: [
            { role: 'system', content: input.systemPrompt },
            { role: 'user', content: input.userPrompt },
          ],
        }),
      })

      if (!response.ok) {
        throw new Error(`模型流式调用失败: ${response.status} ${await response.text()}`)
      }

      const full = await parseEventStream(response, onChunk)
      try {
        userActionLogService.appendAction({
          module: 'llmClient', action: 'streamText', eventType: 'ai_prompt_submitted',
          startedAt, status: 'success',
          details: { featureName: input.featureName ?? 'streamText', provider: settings.llm.provider, model: settings.llm.model, promptSummary: input.userPrompt.slice(0, 200), systemPromptSummary: input.systemPrompt.slice(0, 200) },
        })
        userActionLogService.appendAction({
          module: 'llmClient', action: 'streamText', eventType: 'ai_task_completed',
          startedAt, durationMs: Date.now() - t0, status: 'success',
          details: { featureName: input.featureName ?? 'streamText', provider: settings.llm.provider, model: settings.llm.model, outputSummary: full.slice(0, 200), durationMs: Date.now() - t0, success: true },
        })
      } catch { /* never crash main logic */ }
      return full
    } catch (error) {
      if (attempt < LLM_MAX_ATTEMPTS && shouldRetryTransientError(error)) {
        await sleep(800 * attempt)
        continue
      }

      if (!shouldRetryTransientError(error)) {
        try {
          userActionLogService.appendAction({
            module: 'llmClient', action: 'streamText', eventType: 'ai_task_failed',
            startedAt, durationMs: Date.now() - t0, status: 'failed',
            errorMessage: error instanceof Error ? error.message : String(error),
            details: { featureName: input.featureName ?? 'streamText', provider: settings.llm.provider, model: settings.llm.model, success: false },
          })
        } catch { /* never crash main logic */ }
        throw normalizeLlmError('文字模型流式调用', endpoint, error)
      }

      try {
        const full = await completeText(settings, input)
        for (const chunk of chunkText(full)) {
          await onChunk(chunk)
        }
        return full
      } catch (fallbackError) {
        try {
          userActionLogService.appendAction({
            module: 'llmClient', action: 'streamText', eventType: 'ai_task_failed',
            startedAt, durationMs: Date.now() - t0, status: 'failed',
            errorMessage: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
            details: { featureName: input.featureName ?? 'streamText', provider: settings.llm.provider, model: settings.llm.model, success: false },
          })
        } catch { /* never crash main logic */ }
        throw normalizeLlmError('文字模型流式调用', endpoint, fallbackError)
      }
    }
  }

  throw new Error('文字模型流式调用失败: unexpected retry exhaustion')
}

export async function testLlmConnection(settings: AppSettings): Promise<string> {
  const text = await completeText(settings, {
    systemPrompt: 'You are a concise assistant.',
    userPrompt: 'Reply with exactly OK.',
    temperature: 0,
    maxTokens: 16,
  })
  return text.trim()
}