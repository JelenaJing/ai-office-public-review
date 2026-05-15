export const MANUSCRIPT_COMMAND_EVENT = 'ai-writer-manuscript-command'

export function isRoutedManuscriptCommand(command: unknown): command is {
  executorId: string
  adapterRoute: string
  payload: Record<string, unknown>
} {
  if (!command || typeof command !== 'object') return false
  const candidate = command as Record<string, unknown>
  return typeof candidate.executorId === 'string'
    && typeof candidate.adapterRoute === 'string'
    && Boolean(candidate.payload)
    && typeof candidate.payload === 'object'
}