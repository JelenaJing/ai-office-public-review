/**
 * deckBuilderService — main-process implementation of the DeckDocument builder.
 *
 * Wires the LLM client (completeText) and the deck persistence layer
 * (saveDeckDocument) to the pure builder functions in src/modules/generation/ppt/deckBuilder/.
 *
 * Exposed via IPC handlers:
 *   deck:buildFromPrompt
 *   deck:buildFromManuscript
 *   deck:buildFromImportedPptx
 *   deck:extractPptx  (PPTX text extraction, Node.js only)
 *
 * All handlers return a DeckBuildResult (serializable plain object).
 */

import type { AppSettings } from '../../settingsStore'
import { completeText } from '../../llmClient'
import { saveDeckDocument } from '../../deckDocumentService'
import {
  buildDeckFromPrompt,
  extractJsonFromLlmText,
} from '../../../../../src/modules/generation/ppt/deckBuilder/buildDeckFromPrompt'
import { buildDeckFromManuscript } from '../../../../../src/modules/generation/ppt/deckBuilder/buildDeckFromManuscript'
import { buildDeckFromImportedPptx } from '../../../../../src/modules/generation/ppt/deckBuilder/buildDeckFromImportedPptx'
import type {
  DeckBuildRequest,
  DeckBuildResult,
  LlmCompleter,
  RawPptxSlide,
} from '../../../../../src/modules/generation/ppt/deckBuilder/types'

import * as fs from 'fs'
import JSZip from 'jszip'

// ---------------------------------------------------------------------------
// LLM adapter
// ---------------------------------------------------------------------------

function makeLlmCompleter(settings: AppSettings, signal?: AbortSignal): LlmCompleter {
  return async (systemPrompt: string, userPrompt: string, featureName?: string, callSignal?: AbortSignal) => {
    return completeText(settings, {
      systemPrompt,
      userPrompt,
      temperature: 0.7,
      maxTokens: 8192,
      featureName: featureName ?? 'deckBuilder',
    }, callSignal ?? signal)
  }
}

// ---------------------------------------------------------------------------
// Build-and-save helpers
// ---------------------------------------------------------------------------

async function saveIfWorkspace(
  result: DeckBuildResult,
  workspacePath?: string
): Promise<DeckBuildResult> {
  if (!result.success || !result.deck || !workspacePath) return result

  try {
    const saveResult = await saveDeckDocument(workspacePath, result.deck)
    return {
      ...result,
      deckDocumentId: saveResult.deckId,
      deckPath: saveResult.filePath,
    }
  } catch (err) {
    return {
      ...result,
      warnings: [
        ...result.warnings,
        `保存 deck.json 失败: ${err instanceof Error ? err.message : String(err)}`,
      ],
    }
  }
}

// ---------------------------------------------------------------------------
// Public service functions (called from IPC handlers)
// ---------------------------------------------------------------------------

export async function buildDeckFromPromptService(
  settings: AppSettings,
  payload: unknown,
  signal?: AbortSignal
): Promise<DeckBuildResult> {
  const req = payload as DeckBuildRequest
  const llm = makeLlmCompleter(settings, signal)
  const result = await buildDeckFromPrompt(req, llm)
  return saveIfWorkspace(result, req.workspacePath)
}

export async function buildDeckFromManuscriptService(
  settings: AppSettings,
  payload: unknown,
  signal?: AbortSignal
): Promise<DeckBuildResult> {
  const req = payload as DeckBuildRequest
  const llm = makeLlmCompleter(settings, signal)
  const result = await buildDeckFromManuscript(req, llm)
  return saveIfWorkspace(result, req.workspacePath)
}

export async function buildDeckFromImportedPptxService(
  settings: AppSettings | null,
  payload: unknown
): Promise<DeckBuildResult> {
  const req = payload as DeckBuildRequest & { rawSlides?: RawPptxSlide[] }

  // rawSlides may be pre-extracted by the caller, or we extract them now
  let rawSlides: RawPptxSlide[] = req.rawSlides ?? []

  if (rawSlides.length === 0 && req.pptxPath) {
    const extractResult = await extractRawPptxSlides(req.pptxPath)
    if (!extractResult.success) {
      return { success: false, warnings: [], error: extractResult.error }
    }
    rawSlides = extractResult.slides
  }

  const llm = settings && req.importMode === 'ai_assisted'
    ? makeLlmCompleter(settings)
    : undefined

  const result = await buildDeckFromImportedPptx(rawSlides, req, llm)
  return saveIfWorkspace(result, req.workspacePath)
}

// ---------------------------------------------------------------------------
// PPTX text extraction (Node.js only — uses JSZip)
// ---------------------------------------------------------------------------

interface ExtractResult {
  success: boolean
  slides: RawPptxSlide[]
  error?: string
}

/**
 * Extracts raw text from each slide in a PPTX file (async).
 *
 * PPTX is a ZIP archive. Slide XML files are at:
 *   ppt/slides/slide1.xml, slide2.xml, ...
 *   ppt/notesSlides/notesSlide1.xml, ...
 */
export async function extractRawPptxSlides(pptxPath: string): Promise<ExtractResult> {
  if (!fs.existsSync(pptxPath)) {
    return { success: false, slides: [], error: `文件不存在: ${pptxPath}` }
  }

  try {
    const buffer = fs.readFileSync(pptxPath)
    const zip = await JSZip.loadAsync(buffer)

    const slideEntries = Object.keys(zip.files)
      .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => {
        const na = parseInt(a.match(/(\d+)/)?.[1] ?? '0')
        const nb = parseInt(b.match(/(\d+)/)?.[1] ?? '0')
        return na - nb
      })

    const notesMap: Record<number, string> = {}
    const notesEntries = Object.keys(zip.files)
      .filter(name => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name))

    for (const notesEntry of notesEntries) {
      const idx = parseInt(notesEntry.match(/(\d+)/)?.[1] ?? '0') - 1
      const xml = await zip.files[notesEntry].async('string')
      notesMap[idx] = stripXmlTags(xml)
    }

    const slides: RawPptxSlide[] = []
    for (let i = 0; i < slideEntries.length; i++) {
      const xml = await zip.files[slideEntries[i]].async('string')
      const texts = extractTextsFromSlideXml(xml)
      const hasImages = /<p:pic\b/.test(xml) || /<p:graphicFrame\b/.test(xml)

      slides.push({
        slideIndex: i,
        title: texts[0],
        body: texts.slice(1).join('\n') || undefined,
        texts,
        hasImages,
        notes: notesMap[i],
      })
    }

    return { success: true, slides }
  } catch (err) {
    return {
      success: false,
      slides: [],
      error: `PPTX 解析失败: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/** Strip all XML tags and return visible text content */
function stripXmlTags(xml: string): string {
  return xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Extract text from a slide XML, preserving paragraph groupings.
 * Returns an array of text strings, one per paragraph run group.
 */
function extractTextsFromSlideXml(xml: string): string[] {
  const results: string[] = []
  // Each <a:p> paragraph
  const paragraphRegex = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g
  let paraMatch: RegExpExecArray | null
  while ((paraMatch = paragraphRegex.exec(xml)) !== null) {
    const paraXml = paraMatch[1]
    // Each <a:t> text run within the paragraph
    const textRunRegex = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g
    let runMatch: RegExpExecArray | null
    const runs: string[] = []
    while ((runMatch = textRunRegex.exec(paraXml)) !== null) {
      const text = runMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim()
      if (text) runs.push(text)
    }
    if (runs.length > 0) results.push(runs.join(''))
  }
  return results.filter(Boolean)
}

// Re-export for convenience
export type { DeckBuildRequest, DeckBuildResult, RawPptxSlide }
export { extractJsonFromLlmText }
