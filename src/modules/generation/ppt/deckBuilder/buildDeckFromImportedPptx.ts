/**
 * buildDeckFromImportedPptx — convert a PPTX file into a DeckDocument.
 *
 * Two modes:
 *   'rule_based'   — heuristic intent detection from raw text. Zero LLM calls.
 *   'ai_assisted'  — rule_based first, then LLM refines the structure. Costs tokens.
 *
 * The caller must supply RawPptxSlide[] (already extracted from the PPTX).
 * The main process handles the actual PPTX file reading (Node.js FS + ZIP).
 * This module contains only the pure transformation logic (renderer-safe).
 */

import type { DeckDocument, DeckSlide, DeckSlideIntent, DeckSourceRef } from '../../../../types/deckDocument'
import { validateDeckDocumentOutput } from '../validateDeckDocumentOutput'
import { buildPromptFromRawPptx } from './deckPromptTemplates'
import { extractJsonFromLlmText } from './buildDeckFromPrompt'
import type { DeckBuildRequest, DeckBuildResult, LlmCompleter, RawPptxSlide } from './types'

// ---------------------------------------------------------------------------
// Rule-based intent detection
// ---------------------------------------------------------------------------

/**
 * Heuristically assigns a DeckSlideIntent to a raw PPTX slide.
 *
 * Rules (in priority order):
 * 1. First slide → cover
 * 2. Last slide → closing
 * 3. Short title + 3-6 short items (numbered or bulleted) → toc (if near front) or content_cards
 * 4. Short title + no/very-short body → section_divider
 * 5. Has images + body → image_text
 * 6. Items 2-6 present + body short → content_cards
 * 7. Body > 200 chars → text_content
 * 8. Fallback → text_content
 */
function detectIntent(slide: RawPptxSlide, totalSlides: number): DeckSlideIntent {
  const { slideIndex, title, body, texts, hasImages } = slide
  const bodyLen = body?.length ?? 0
  const textCount = texts.length
  const titleLen = title?.length ?? 0

  if (slideIndex === 0) return 'cover'
  if (slideIndex === totalSlides - 1) return 'closing'

  // TOC: typically the 2nd slide with a list of short items
  if (slideIndex === 1 && textCount >= 3 && bodyLen < 300) return 'toc'

  // Section divider: short title, minimal body
  if (titleLen > 0 && bodyLen < 60 && textCount <= 2) return 'section_divider'

  // Image + text
  if (hasImages && bodyLen > 0) return 'image_text'

  // Content cards: several short text items
  const shortItems = texts.filter(t => t.length < 60)
  if (shortItems.length >= 3 && shortItems.length <= 6 && bodyLen < 200) return 'content_cards'

  // Long body → text content
  return 'text_content'
}

/**
 * Converts a RawPptxSlide into a DeckSlide using heuristic rules.
 * No LLM involved.
 */
function rawSlideToDeckSlide(raw: RawPptxSlide, totalSlides: number): DeckSlide {
  const intent = detectIntent(raw, totalSlides)
  const texts = raw.texts.filter(Boolean)

  // For content_cards and toc, extract items from text list (skip title)
  const itemCandidates = texts.length > 1 ? texts.slice(1) : []

  return {
    index: raw.slideIndex,
    id: `slide-${raw.slideIndex}`,
    intent,
    title: raw.title ?? texts[0] ?? `第 ${raw.slideIndex + 1} 页`,
    body: intent === 'text_content' || intent === 'image_text' ? raw.body : undefined,
    items: (intent === 'content_cards' || intent === 'toc') && itemCandidates.length >= 2
      ? itemCandidates.slice(0, 6)
      : undefined,
    notes: raw.notes,
    speakerNotes: raw.notes,
    contentDensity: (raw.body?.length ?? 0) > 300 ? 'high' : (raw.body?.length ?? 0) > 100 ? 'medium' : 'low',
    visualDemand: raw.hasImages ? 'optional' : 'none',
  }
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Builds a DeckDocument from an array of RawPptxSlide objects.
 *
 * @param rawSlides  Slides extracted from the PPTX by the main process
 * @param request    Build request (sourceType = 'imported_pptx')
 * @param llm        LLM function — only used when importMode = 'ai_assisted'
 */
export async function buildDeckFromImportedPptx(
  rawSlides: RawPptxSlide[],
  request: DeckBuildRequest,
  llm?: LlmCompleter
): Promise<DeckBuildResult> {
  const warnings: string[] = []

  if (!rawSlides || rawSlides.length === 0) {
    return {
      success: false,
      warnings,
      error: '没有可导入的幻灯片数据 (rawSlides is empty)',
    }
  }

  const total = rawSlides.length

  // ── AI-assisted mode: ask LLM to rebuild the deck structure ──────────────
  if (request.importMode === 'ai_assisted' && llm) {
    try {
      const { systemPrompt, userPrompt } = buildPromptFromRawPptx(rawSlides, request)
      const rawText = await llm(systemPrompt, userPrompt, 'buildDeckFromImportedPptx')

      let parsed: unknown
      try {
        parsed = extractJsonFromLlmText(rawText)
      } catch {
        warnings.push('AI 重建失败，回退到规则模式')
        // Fall through to rule_based path below
      }

      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const raw = parsed as Record<string, unknown>
        if (!raw.deckId) raw.deckId = Math.random().toString(16).slice(2, 10)
        if (!raw.schemaVersion) raw.schemaVersion = '1.0'
        if (!raw.status) raw.status = 'completed'
        if (!raw.language) raw.language = request.language ?? 'zh'
        const now = new Date().toISOString()
        if (!raw.createdAt) raw.createdAt = now
        if (!raw.updatedAt) raw.updatedAt = now
        if (!Array.isArray(raw.assets)) raw.assets = []
        raw.source = { type: 'imported_pptx', sourcePath: request.pptxPath }

        if (Array.isArray(raw.slides)) {
          const slides = raw.slides as Record<string, unknown>[]
          raw.expectedSlideCount = slides.length
          raw.completedSlideCount = slides.length
          slides.forEach((s, i) => {
            if (!s.id) s.id = `slide-${i}`
            if (typeof s.index !== 'number') s.index = i
            if (s.speakerNotes && !s.notes) s.notes = s.speakerNotes
          })
        }

        const validation = validateDeckDocumentOutput(raw)
        warnings.push(...validation.warnings)

        if (validation.valid && validation.deck) {
          return {
            success: true,
            deckDocumentId: validation.deck.deckId,
            deck: validation.deck as DeckDocument,
            warnings,
          }
        }
        warnings.push(`AI 重建校验失败 (${validation.errors.join('; ')})，回退到规则模式`)
      }
    } catch (err) {
      warnings.push(`AI 重建出错: ${err instanceof Error ? err.message : String(err)}，回退到规则模式`)
    }
  }

  // ── Rule-based mode ───────────────────────────────────────────────────────
  const slides: DeckSlide[] = rawSlides.map(r => rawSlideToDeckSlide(r, total))

  // Derive title from the cover slide
  const coverTitle = slides.find(s => s.intent === 'cover')?.title ?? '导入演示文稿'

  const sourceRefs: DeckSourceRef[] = rawSlides.map(r => ({
    sourceId: `pptx-slide-${r.slideIndex}`,
    sourceType: 'pptx_slide' as const,
    slideIndex: r.slideIndex,
    confidence: 0.7,
  }))

  const raw: Record<string, unknown> = {
    deckId: Math.random().toString(16).slice(2, 10),
    schemaVersion: '1.0',
    title: coverTitle,
    language: request.language ?? 'zh',
    status: 'completed',
    expectedSlideCount: slides.length,
    completedSlideCount: slides.length,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: { type: 'imported_pptx', sourcePath: request.pptxPath },
    sourceRefs,
    assets: [],
    slides,
  }

  const validation = validateDeckDocumentOutput(raw)
  warnings.push(...validation.warnings)

  if (!validation.valid || !validation.deck) {
    return {
      success: false,
      warnings,
      error: `DeckDocument 校验失败: ${validation.errors.join('; ')}`,
    }
  }

  warnings.push(`规则模式重建完成，共 ${slides.length} 页（置信度 0.7，建议人工审查）`)

  return {
    success: true,
    deckDocumentId: validation.deck.deckId,
    deck: validation.deck as DeckDocument,
    warnings,
  }
}
