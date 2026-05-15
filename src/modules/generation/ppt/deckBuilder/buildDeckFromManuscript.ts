/**
 * buildDeckFromManuscript — convert a written document into a DeckDocument.
 *
 * Phase: LLM call (1 call). Token cost: yes (proportional to manuscript length).
 * The LLM reads the manuscript and restructures it as presentation slides.
 * Each slide carries sourceRefs pointing back to the source manuscript.
 * Output is template-agnostic DeckDocument.
 */

import type { DeckDocument, DeckSourceRef } from '../../../../types/deckDocument'
import { validateDeckDocumentOutput } from '../validateDeckDocumentOutput'
import { buildPromptFromManuscript } from './deckPromptTemplates'
import { extractJsonFromLlmText } from './buildDeckFromPrompt'
import type { DeckBuildRequest, DeckBuildResult, LlmCompleter } from './types'

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Builds a DeckDocument from an existing manuscript / written document.
 *
 * The LLM reads the manuscript and generates a presentation plan that
 * "tells the story" of the manuscript — not a copy, but a structured presentation.
 *
 * @param request  Must have sourceType = 'manuscript' and manuscriptContent set
 * @param llm      Injectable LLM function
 */
export async function buildDeckFromManuscript(
  request: DeckBuildRequest,
  llm: LlmCompleter
): Promise<DeckBuildResult> {
  const warnings: string[] = []

  if (!request.manuscriptContent?.trim()) {
    return {
      success: false,
      warnings,
      error: '文稿内容不能为空 (manuscriptContent is required)',
    }
  }

  try {
    const { systemPrompt, userPrompt } = buildPromptFromManuscript(request)
    const rawText = await llm(systemPrompt, userPrompt, 'buildDeckFromManuscript')

    let parsed: unknown
    try {
      parsed = extractJsonFromLlmText(rawText)
    } catch (parseErr) {
      return {
        success: false,
        warnings,
        error: `LLM 输出无法解析为 JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
      }
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { success: false, warnings, error: 'LLM 输出不是有效的 JSON 对象' }
    }

    const raw = parsed as Record<string, unknown>

    // Auto-fill required fields
    if (!raw.deckId || typeof raw.deckId !== 'string') {
      raw.deckId = Math.random().toString(16).slice(2, 10)
    }
    if (!raw.schemaVersion) raw.schemaVersion = '1.0'
    if (!raw.status) raw.status = 'completed'
    if (!raw.language) raw.language = request.language ?? 'zh'
    const now = new Date().toISOString()
    if (!raw.createdAt) raw.createdAt = now
    if (!raw.updatedAt) raw.updatedAt = now
    if (!Array.isArray(raw.assets)) raw.assets = []

    // Force correct source type
    raw.source = {
      type: 'manuscript',
      manuscriptId: request.manuscriptId ?? undefined,
    }

    if (Array.isArray(raw.slides)) {
      const slides = raw.slides as Record<string, unknown>[]
      raw.expectedSlideCount = slides.length
      raw.completedSlideCount = slides.length
      slides.forEach((slide, i) => {
        if (!slide.id) slide.id = `slide-${i}`
        if (typeof slide.index !== 'number') slide.index = i
        if (slide.speakerNotes && !slide.notes) slide.notes = slide.speakerNotes
      })
    }

    // Build top-level sourceRefs linking the deck to the manuscript
    const sourceRefs: DeckSourceRef[] = []
    if (request.manuscriptId) {
      sourceRefs.push({
        sourceId: request.manuscriptId,
        sourceType: 'manuscript',
        confidence: 1,
      })
    }
    if (sourceRefs.length > 0) raw.sourceRefs = sourceRefs

    const validation = validateDeckDocumentOutput(raw)
    warnings.push(...validation.warnings)

    if (!validation.valid || !validation.deck) {
      return {
        success: false,
        warnings,
        error: `DeckDocument 校验失败: ${validation.errors.join('; ')}`,
      }
    }

    return {
      success: true,
      deckDocumentId: validation.deck.deckId,
      deck: validation.deck as DeckDocument,
      warnings,
    }
  } catch (err) {
    return {
      success: false,
      warnings,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
