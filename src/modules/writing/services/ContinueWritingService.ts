import { createThinkFilter, stripThinkTags } from '../../../utils/StreamThinkFilter'

export interface ContinueWritingParams {
  draftText: string
  writingGoal?: string
  style?: string
  language?: string
  returnFormat?: string
  targetWords?: number
  extraContext?: string
}

export interface ContinueWritingCallbacks {
  onDelta: (delta: string, accumulated: string) => void
  onComplete: (result: { continuedText: string; fullText: string }) => void
  onError: (error: string) => void
  onStatus?: (message: string) => void
}

export async function continueWriting(params: ContinueWritingParams, callbacks: ContinueWritingCallbacks, signal?: AbortSignal): Promise<void> {
  const filter = createThinkFilter()
  let accumulated = ''
  const dispose = window.electronAPI.onAiEvent((payload) => {
    const data = payload as Record<string, any>
    if (data.scope !== 'continue') return
    if (data.type === 'start') callbacks.onStatus?.('正在续写...')
    if (data.type === 'chunk') {
      const cleanDelta = filter.push(String(data.chunk || ''))
      accumulated += cleanDelta
      callbacks.onDelta(cleanDelta, accumulated)
    }
  })

  const abortHandler = () => {
    dispose()
    callbacks.onError('已停止')
  }
  signal?.addEventListener('abort', abortHandler, { once: true })

  try {
    const ipcPromise = window.electronAPI.continueWriting(params as unknown as Record<string, unknown>)

    if (signal?.aborted) { dispose(); return }

    const text = await (signal
      ? Promise.race([
          ipcPromise,
          new Promise<never>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
          }),
        ])
      : ipcPromise)

    dispose()
    callbacks.onComplete({ continuedText: stripThinkTags(text), fullText: stripThinkTags(text) })
  } catch (error) {
    dispose()
    if (error instanceof DOMException && error.name === 'AbortError') return
    callbacks.onError(error instanceof Error ? error.message : String(error))
  } finally {
    signal?.removeEventListener('abort', abortHandler)
  }
}