/**
 * Shared types for the unified DeckDocument builder system.
 *
 * Three generation paths all produce the same DeckDocument:
 *   1. 'prompt'        — User types a description; LLM generates a full DeckDocument.
 *   2. 'manuscript'    — User has a written document; LLM converts it to a presentation.
 *   3. 'imported_pptx' — User provides an existing PPTX; rule-based + optional AI rebuild.
 *
 * After building, the DeckDocument is template-agnostic.
 * Any number of TemplateManifests can render it without re-invoking the LLM.
 */

import type { DeckDocument, ImageMode } from '../../../../types/deckDocument'

// ---------------------------------------------------------------------------
// Build request
// ---------------------------------------------------------------------------

export type DeckBuildSourceType = 'manuscript' | 'prompt' | 'imported_pptx'

export interface DeckBuildRequest {
  sourceType: DeckBuildSourceType

  // ── Prompt mode ──────────────────────────────────────────────────────────
  /** User's natural-language prompt describing what the presentation should cover */
  prompt?: string

  // ── Manuscript mode ──────────────────────────────────────────────────────
  /** ID of the source manuscript (for logging and sourceRefs) */
  manuscriptId?: string
  /** Full text content of the manuscript */
  manuscriptContent?: string

  // ── Import mode ──────────────────────────────────────────────────────────
  /** Absolute path to the PPTX file to import */
  pptxPath?: string
  /**
   * Set to 'ai_assisted' to let the LLM improve intent/content detection.
   * Default 'rule_based' uses heuristics only (no token cost).
   */
  importMode?: 'rule_based' | 'ai_assisted'

  // ── Shared options ───────────────────────────────────────────────────────
  knowledgeBaseIds?: string[]
  imageMode?: ImageMode
  targetAudience?: string
  purpose?: string
  language?: 'zh' | 'en'
  scenario?: string
  /** Path to the user's workspace (for saving deck.json) */
  workspacePath?: string
}

// ---------------------------------------------------------------------------
// Build result
// ---------------------------------------------------------------------------

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  total: number
}

export interface DeckBuildResult {
  success: boolean
  deckDocumentId?: string
  /** Absolute path to the saved deck.json */
  deckPath?: string
  deck?: DeckDocument
  warnings: string[]
  tokenUsage?: TokenUsage
  error?: string
}

// ---------------------------------------------------------------------------
// LLM injection
// ---------------------------------------------------------------------------

/**
 * Injectable LLM function.
 *
 * In the renderer: wrap window.electronAPI.runWritingAssistant.
 * In the main process: wrap completeText() from llmClient.ts.
 * In tests: provide a mock that returns fixture JSON.
 *
 * Must return the raw LLM response string (may be JSON or markdown-wrapped JSON).
 */
export type LlmCompleter = (
  systemPrompt: string,
  userPrompt: string,
  featureName?: string,
  signal?: AbortSignal
) => Promise<string>

// ---------------------------------------------------------------------------
// Raw PPTX extraction types (for imported_pptx path)
// ---------------------------------------------------------------------------

/** One slide worth of raw text extracted from a PPTX file */
export interface RawPptxSlide {
  /** 0-based slide index */
  slideIndex: number
  /** Detected title text (largest/first text element) */
  title?: string
  /** Body text (remaining text joined with newlines) */
  body?: string
  /** All text strings extracted from the slide, in DOM order */
  texts: string[]
  /** Whether the slide had any image shapes */
  hasImages: boolean
  /** Speaker notes */
  notes?: string
}
