/**
 * RetemplateEngine — orchestrates the DeckDocument → TemplateManifest → PPTX pipeline.
 *
 * Pipeline (all steps are local computation — no LLM, no image API):
 *   DeckDocument
 *     → getTemplateManifest(manifestId)          PptTemplateManifest
 *     → matchLayouts()        LayoutMatchResult[]  (LayoutMatcher — rule-based)
 *     → paginateAll()         DeckSlide[]          (ContentPaginator — overflow split)
 *     → bindSlots()           BindingPlan          (SlotBinder — data mapping)
 *     → adaptToPptxSlides()   PptxSlideDefinition[] (Adapter — type conversion)
 *     → generatePptx()        .pptx file           (pptxGenerator.ts — unchanged)
 *
 * Lives in electron/main so it can call generatePptx (Node.js fs APIs).
 * tokenCost = 0, llmCalls = 0, imageCalls = 0 — always.
 */

import * as path from 'node:path'
import * as fs from 'node:fs'
import { getTemplateManifest } from '../../../../src/types/pptTemplateManifest'
import { matchLayouts } from '../../../../src/modules/generation/ppt/retemplate/layoutMatcher'
import { paginateAll } from '../../../../src/modules/generation/ppt/retemplate/contentPaginator'
import { bindSlots } from '../../../../src/modules/generation/ppt/retemplate/slotBinder'
import { adaptToPptxSlides } from '../../../../src/modules/generation/ppt/retemplate/deckToPptxAdapter'
import { generatePptx, type PptxGenerateResult } from '../pptxGenerator'
import { renderWithClone, canUseCloneRenderer } from './templateCloneRenderer'
import { resolvePptSkillsRoot } from '../pptTemplateRegistry'

import type { DeckDocument } from '../../../../src/types/deckDocument'
import type { PptTemplateManifest } from '../../../../src/types/pptTemplateManifest'

export interface RetemplateOptions {
  /** Absolute output .pptx file path */
  outputPath: string
  /** PptBrandTemplate ID override. Defaults to manifestId (they share the same key). */
  templateId?: string
}

export interface RetemplateResult {
  success: boolean
  outputPath: string
  slideCount: number
  manifestId: string
  templateId: string
  error?: string
  /** true = TemplateCloneRenderer was used; false = fell back to pptxGenerator */
  cloneRendererUsed?: boolean
  /** Always 0 — contract: no LLM was called */
  llmCalls: 0
  /** Always 0 — contract: no images were generated */
  imageCalls: 0
  /** Always 0 — no token consumption */
  tokenCost: 0
}

/**
 * Render a DeckDocument using the specified TemplateManifest and write a PPTX file.
 *
 * @param deck       The content source-of-truth
 * @param manifestId Which TemplateManifest to use for layout matching
 * @param options    Where to write output, optional templateId override
 */
export async function renderDeck(
  deck: DeckDocument,
  manifestId: string,
  options: RetemplateOptions,
): Promise<RetemplateResult> {
  const manifest: PptTemplateManifest | undefined = getTemplateManifest(manifestId)
  if (!manifest) {
    return {
      success: false,
      outputPath: options.outputPath,
      slideCount: 0,
      manifestId,
      templateId: options.templateId ?? manifestId,
      error: `TemplateManifest not found: "${manifestId}". Call registerTemplateManifest() before use.`,
      llmCalls: 0,
      imageCalls: 0,
      tokenCost: 0,
    }
  }

  try {
    // 1. Rule-based layout matching (no LLM)
    const matchResults = matchLayouts(deck.slides, manifest.layouts, manifest.templateProfile)

    // 2. Overflow pagination (no LLM) — profile drives split behavior
    const paginatedSlides = paginateAll(deck.slides, manifest.layouts, matchResults, manifest.templateProfile)

    // 3. Slot binding — pass deck.assets for assetId-based image resolution
    const bindingPlan = bindSlots(paginatedSlides, matchResults, manifestId, deck.assets ?? [], deck.deckId, manifest.templateProfile)

    // Resolve the skill directory name (strip _light suffix for path resolution)
    const skillDirName = manifestId.replace(/_light$/, '')
    const templatePptxPath = path.join(resolvePptSkillsRoot(), skillDirName, 'source-template.pptx')

    // 4a. Try TemplateCloneRenderer first (preserves original template slide structure)
    if (canUseCloneRenderer(bindingPlan) && fs.existsSync(templatePptxPath)) {
      console.log(`[retemplateEngine] Using TemplateCloneRenderer for ${manifestId}`)
      const cloneResult = await renderWithClone({
        templatePptxPath,
        outputPath: options.outputPath,
        bindingPlan,
        deckTitle: deck.title,
      })

      if (cloneResult.success) {
        return {
          success: true,
          outputPath: cloneResult.outputPath,
          slideCount: cloneResult.slideCount,
          manifestId,
          templateId: options.templateId ?? manifestId,
          cloneRendererUsed: true,
          llmCalls: 0,
          imageCalls: 0,
          tokenCost: 0,
        }
      }

      // Clone renderer failed — log and fall through to legacy pptxGenerator
      console.warn(`[retemplateEngine] TemplateCloneRenderer failed, falling back to pptxGenerator: ${cloneResult.error}`)
    } else {
      if (!canUseCloneRenderer(bindingPlan)) {
        console.log(`[retemplateEngine] Clone renderer skipped: not all layouts have sourceSlideIndex`)
      } else {
        console.log(`[retemplateEngine] Clone renderer skipped: template PPTX not found at ${templatePptxPath}`)
      }
    }

    // 4b. Fallback: Convert to PptxSlideDefinition[] and use pptxGenerator
    const slideDefinitions = adaptToPptxSlides(bindingPlan)

    // 5. Write PPTX (existing layer — not modified)
    const templateId = options.templateId ?? manifestId
    const generateInput = {
      plan: {
        title: deck.title,
        templateId,
        slides: slideDefinitions,
      },
      outputPath: options.outputPath,
      templateId,
    }

    const result: PptxGenerateResult = await generatePptx(generateInput)

    return {
      success: result.success,
      outputPath: result.outputPath,
      slideCount: result.slideCount,
      manifestId,
      templateId: result.templateId ?? templateId,
      error: result.error,
      cloneRendererUsed: false,
      llmCalls: 0,
      imageCalls: 0,
      tokenCost: 0,
    }
  } catch (err) {
    return {
      success: false,
      outputPath: options.outputPath,
      slideCount: 0,
      manifestId,
      templateId: options.templateId ?? manifestId,
      error: err instanceof Error ? err.message : String(err),
      llmCalls: 0,
      imageCalls: 0,
      tokenCost: 0,
    }
  }
}
