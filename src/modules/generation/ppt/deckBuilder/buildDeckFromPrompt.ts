/**
 * buildDeckFromPrompt — generate a DeckDocument from a user's text prompt.
 *
 * Phase: LLM call (1 call). Token cost: yes.
 * No template knowledge. No image generation.
 * Output is template-agnostic DeckDocument.
 */

import type { DeckDocument } from '../../../../types/deckDocument'
import { validateDeckDocumentOutput } from '../validateDeckDocumentOutput'
import { buildPromptFromUserPrompt } from './deckPromptTemplates'
import type { DeckBuildRequest, DeckBuildResult, LlmCompleter } from './types'

// ---------------------------------------------------------------------------
// JSON extraction helper (shared)
// ---------------------------------------------------------------------------

/**
 * Extracts the first valid JSON object from an LLM response string.
 * The LLM may wrap JSON in a markdown code block — this strips it.
 */
export function extractJsonFromLlmText(text: string): unknown {
  const trimmed = text.trim()

  // Direct JSON object
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed)
  }

  // Markdown code block: ```json ... ``` or ``` ... ```
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    return JSON.parse(codeBlockMatch[1].trim())
  }

  // Embedded JSON object: find first { ... } spanning the full text
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1))
  }

  throw new SyntaxError('No JSON object found in LLM response')
}

/**
 * Ensures the deck has required auto-generated fields that the LLM may have
 * omitted or set incorrectly.
 */
function normalizeDeckFields(raw: Record<string, unknown>, sourceType: string): void {
  if (!raw.deckId || typeof raw.deckId !== 'string') {
    raw.deckId = Math.random().toString(16).slice(2, 10)
  }
  if (!raw.schemaVersion) {
    raw.schemaVersion = '1.0'
  }
  if (!raw.status) {
    raw.status = 'completed'
  }
  if (!raw.language) {
    raw.language = 'zh'
  }
  const now = new Date().toISOString()
  if (!raw.createdAt) raw.createdAt = now
  if (!raw.updatedAt) raw.updatedAt = now
  if (!Array.isArray(raw.assets)) raw.assets = []
  if (!raw.source || typeof raw.source !== 'object') {
    raw.source = { type: sourceType }
  } else {
    (raw.source as Record<string, unknown>).type = sourceType
  }
  if (Array.isArray(raw.slides)) {
    const slides = raw.slides as Record<string, unknown>[]
    raw.expectedSlideCount = slides.length
    raw.completedSlideCount = slides.length
    // Ensure each slide has an id
    slides.forEach((slide, i) => {
      if (!slide.id) slide.id = `slide-${i}`
      if (typeof slide.index !== 'number') slide.index = i
      // Map speakerNotes → notes if only speakerNotes is present
      if (slide.speakerNotes && !slide.notes) slide.notes = slide.speakerNotes
    })
  }
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Builds a DeckDocument from a user's natural-language prompt.
 *
 * @param request  The build request (must have sourceType = 'prompt' and prompt set)
 * @param llm      Injectable LLM function — provides the actual model call
 * @returns        DeckBuildResult containing the deck and any warnings
 */
export async function buildDeckFromPrompt(
  request: DeckBuildRequest,
  llm: LlmCompleter
): Promise<DeckBuildResult> {
  const warnings: string[] = []

  try {
    const { systemPrompt, userPrompt } = buildPromptFromUserPrompt(request)

    const rawText = await llm(systemPrompt, userPrompt, 'buildDeckFromPrompt')

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
    normalizeDeckFields(raw, 'prompt')

    // Propagate source prompt
    if (request.prompt) raw.sourcePrompt = request.prompt.slice(0, 500)

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
