export interface CitationItem {
  number: number
  citation: string
  abstract: string
  doi: string | null
}

export interface FindCitationResult {
  status: string
  citations: CitationItem[]
  message?: string
}

export const INLINE_CITATION_MAX_RESULTS = 10

export async function findCitationForText(params: Record<string, unknown>): Promise<FindCitationResult> {
  return window.electronAPI.compatFindCitationForText(params) as unknown as Promise<FindCitationResult>
}

export async function organizeReferences(params: Record<string, unknown>): Promise<{ status: string; updated_markdown: string; reference_list: any[]; sentence_changes: any[] }> {
  return window.electronAPI.organizeReferences(params) as Promise<{ status: string; updated_markdown: string; reference_list: any[]; sentence_changes: any[] }>
}