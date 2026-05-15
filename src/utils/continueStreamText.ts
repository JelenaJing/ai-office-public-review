export function normalizeContinueLeadingText(text: string): string {
  return String(text || '').replace(/^\s+/, '')
}

export function normalizeContinueDeltaAtStart(text: string, hasInsertedText: boolean): string {
  const normalized = String(text || '')
  if (!normalized) return ''
  return hasInsertedText ? normalized : normalizeContinueLeadingText(normalized)
}