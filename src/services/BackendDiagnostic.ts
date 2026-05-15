export interface DiagnosticResult {
  success: boolean
  summary: string
}

export async function runDiagnostic(): Promise<DiagnosticResult> {
  try {
    const llm = await window.electronAPI.testLlmConnection()
    return { success: true, summary: `LLM 已连接: ${llm}` }
  } catch (error) {
    return { success: false, summary: error instanceof Error ? error.message : String(error) }
  }
}

export function formatDiagnosticReport(result: DiagnosticResult): string {
  return `${result.success ? 'success' : 'failed'}: ${result.summary}`
}