import { createThinkFilter, stripThinkTags } from '../../../utils/StreamThinkFilter'

export interface WritingAssistantParams {
  instruction: string
  documentText?: string
  language?: 'zh' | 'en'
  outputLanguage?: 'zh-CN' | 'en-US'
  extraContext?: string
  generationMode?: 'default' | 'knowledge-template-document'
  taskId?: string
  templateDocument?: {
    title: string
    sourceType?: string
    extractedText: string
    outline?: string[]
  }
}

export interface WritingAssistantCallbacks {
  onDelta: (delta: string, accumulated: string) => void
  onComplete: (result: { text: string }) => void | Promise<void>
  onError: (error: string) => void
  onStatus?: (message: string) => void
}

export async function runWritingAssistant(
  params: WritingAssistantParams,
  callbacks: WritingAssistantCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  // Dev-mode circuit breaker: image mode must never enter the writing-assistant chain
  const imageModeTraceId = (window as unknown as Record<string, unknown>).__imageMode_traceId__
  if (imageModeTraceId) {
    const errorMessage = `[IMAGE-MODE-CIRCUIT-BREAKER] Image mode (traceId=${String(imageModeTraceId)}) incorrectly entered paper-generation chain (runWritingAssistant). This is a routing bug — image mode must only call generateImage(), not runWritingAssistant().`
    console.error(errorMessage)
    throw new Error(errorMessage)
  }

  const filter = createThinkFilter()
  let accumulated = ''
  let disposed = false

  const dispose = window.electronAPI.onAiEvent((payload) => {
    const data = payload as Record<string, any>
    if (data.scope !== 'assistant') return
    if (data.type === 'start') callbacks.onStatus?.('正在处理当前文档...')
    if (data.type === 'status') callbacks.onStatus?.(String(data.message || '正在处理当前文档...'))
    if (data.type === 'chunk') {
      const cleanDelta = filter.push(String(data.chunk || ''))
      accumulated += cleanDelta
      callbacks.onDelta(cleanDelta, accumulated)
    }
  })

  const safeDispose = () => {
    if (disposed) return
    disposed = true
    dispose()
  }

  const abortHandler = () => {
    safeDispose()
    callbacks.onError('已停止')
  }
  signal?.addEventListener('abort', abortHandler, { once: true })

  try {
    const ipcPromise = window.electronAPI.writingAssistant(params as unknown as Record<string, unknown>)

    if (signal?.aborted) { safeDispose(); return }

    const text = await (signal
      ? Promise.race([
          ipcPromise,
          new Promise<never>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
          }),
        ])
      : ipcPromise)

    safeDispose()
    await callbacks.onComplete({ text: stripThinkTags(text) })
  } catch (error) {
    safeDispose()
    if (error instanceof DOMException && error.name === 'AbortError') return
    callbacks.onError(error instanceof Error ? error.message : String(error))
  } finally {
    signal?.removeEventListener('abort', abortHandler)
  }
}
