import { createThinkFilter, stripThinkTags } from '../../../utils/StreamThinkFilter'

export interface RewriteParams {
  paragraph: string
  contextBefore?: string
  contextAfter?: string
  fullMarkdown?: string
  userRequirements?: string
  language?: string
  sectionType?: string
  articleType?: string
}

export interface RewriteCallbacks {
  onDelta: (char: string, accumulated: string) => void
  onComplete: (rewritten: string, originalLength: number, newLength: number) => void
  onError: (error: string) => void
}

export async function rewriteParagraph(params: RewriteParams, callbacks: RewriteCallbacks, signal?: AbortSignal): Promise<void> {
  const filter = createThinkFilter()
  let accumulated = ''
  const dispose = window.electronAPI.onAiEvent((payload) => {
    const data = payload as Record<string, any>
    if (data.scope !== 'rewrite') return
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
    const text = await window.electronAPI.rewriteParagraph({
      paragraph: params.paragraph,
      instruction: params.userRequirements,
      language: params.language,
      sectionType: params.sectionType,
      articleType: params.articleType,
    })
    dispose()
    const cleaned = stripThinkTags(text)
    callbacks.onComplete(cleaned, params.paragraph.length, cleaned.length)
  } catch (error) {
    dispose()
    callbacks.onError(error instanceof Error ? error.message : String(error))
  } finally {
    signal?.removeEventListener('abort', abortHandler)
  }
}