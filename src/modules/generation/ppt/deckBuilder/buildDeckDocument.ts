/**
 * buildDeckDocument — unified DeckDocument builder dispatcher.
 *
 * Routes to the correct builder based on request.sourceType:
 *   'prompt'        → buildDeckFromPrompt (LLM, costs tokens)
 *   'manuscript'    → buildDeckFromManuscript (LLM, costs tokens)
 *   'imported_pptx' → buildDeckFromImportedPptx (rule-based, optional LLM)
 *
 * All three paths produce the same DeckDocument schema.
 * After building, the deck can be rendered with any TemplateManifest
 * without re-invoking the LLM (zero tokens, zero image calls).
 */

import { buildDeckFromPrompt } from './buildDeckFromPrompt'
import { buildDeckFromManuscript } from './buildDeckFromManuscript'
import { buildDeckFromImportedPptx } from './buildDeckFromImportedPptx'
import type { DeckBuildRequest, DeckBuildResult, LlmCompleter, RawPptxSlide } from './types'

export type { DeckBuildRequest, DeckBuildResult, LlmCompleter, RawPptxSlide }
export type { DeckBuildSourceType, TokenUsage } from './types'

export interface BuildDeckDocumentOptions {
  request: DeckBuildRequest
  /**
   * LLM function injected by the caller.
   * Required when sourceType = 'prompt' or 'manuscript'.
   * Optional (used only with importMode = 'ai_assisted') for 'imported_pptx'.
   */
  llm?: LlmCompleter
  /**
   * Pre-extracted PPTX slides.
   * Required when sourceType = 'imported_pptx'.
   * The actual PPTX extraction must be done in the main process (Node.js).
   */
  rawSlides?: RawPptxSlide[]
}

/**
 * Dispatches to the appropriate builder and returns a DeckBuildResult.
 *
 * @example
 * // From prompt:
 * const result = await buildDeckDocument({
 *   request: { sourceType: 'prompt', prompt: '介绍区块链技术的演示', imageMode: 'none' },
 *   llm: async (sys, user) => await window.electronAPI.runWritingAssistant({ ... })
 * })
 *
 * @example
 * // From manuscript:
 * const result = await buildDeckDocument({
 *   request: { sourceType: 'manuscript', manuscriptContent: fullText, manuscriptId: doc.id },
 *   llm: async (sys, user) => await window.electronAPI.runWritingAssistant({ ... })
 * })
 *
 * @example
 * // From imported PPTX (rule-based, zero LLM):
 * const rawSlides = await window.electronAPI.deckExtractPptx({ pptxPath: '/path/to/file.pptx' })
 * const result = await buildDeckDocument({
 *   request: { sourceType: 'imported_pptx', pptxPath: '/path/to/file.pptx' },
 *   rawSlides
 * })
 */
export async function buildDeckDocument(
  options: BuildDeckDocumentOptions
): Promise<DeckBuildResult> {
  const { request, llm, rawSlides } = options

  switch (request.sourceType) {
    case 'prompt': {
      if (!llm) {
        return {
          success: false,
          warnings: [],
          error: 'sourceType="prompt" requires an llm function',
        }
      }
      return buildDeckFromPrompt(request, llm)
    }

    case 'manuscript': {
      if (!llm) {
        return {
          success: false,
          warnings: [],
          error: 'sourceType="manuscript" requires an llm function',
        }
      }
      return buildDeckFromManuscript(request, llm)
    }

    case 'imported_pptx': {
      if (!rawSlides || rawSlides.length === 0) {
        return {
          success: false,
          warnings: [],
          error: 'sourceType="imported_pptx" requires rawSlides extracted from the PPTX file',
        }
      }
      return buildDeckFromImportedPptx(rawSlides, request, llm)
    }

    default: {
      const exhaustiveCheck: never = request.sourceType
      return {
        success: false,
        warnings: [],
        error: `Unknown sourceType: ${exhaustiveCheck}`,
      }
    }
  }
}
