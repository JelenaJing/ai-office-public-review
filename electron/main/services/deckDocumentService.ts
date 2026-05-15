/**
 * DeckDocumentService — save, load, and render DeckDocuments.
 *
 * Storage layout (within a workspace's 05_Presentation folder):
 *   <workspacePath>/05_Presentation/decks/<deckId>/deck.json
 *   <workspacePath>/05_Presentation/decks/<deckId>/<manifestId>_output.pptx
 *
 * All operations are pure local I/O. No LLM calls, no token consumption.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { validateDeckDocument, type DeckDocument } from '../../../src/types/deckDocument'
import { renderDeck, type RetemplateResult } from './ppt/retemplateEngine'
import { buildTemplateSourcePath } from './pptTemplateRegistry'

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function decksRoot(workspacePath: string): string {
  return path.join(workspacePath, '05_Presentation', 'decks')
}

function deckDir(workspacePath: string, deckId: string): string {
  return path.join(decksRoot(workspacePath), deckId)
}

function deckJsonPath(workspacePath: string, deckId: string): string {
  return path.join(deckDir(workspacePath, deckId), 'deck.json')
}

function deckOutputPath(workspacePath: string, deckId: string, manifestId: string): string {
  return path.join(deckDir(workspacePath, deckId), `${manifestId}_output.pptx`)
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

export interface SaveDeckResult {
  success: boolean
  deckId: string
  filePath: string
  error?: string
}

/**
 * Persist a DeckDocument to disk as deck.json.
 * Creates the directory if necessary. updatedAt is refreshed automatically.
 */
export async function saveDeckDocument(
  workspacePath: string,
  deck: DeckDocument,
): Promise<SaveDeckResult> {
  try {
    const dir = deckDir(workspacePath, deck.deckId)
    await fs.mkdir(dir, { recursive: true })

    const updated: DeckDocument = { ...deck, updatedAt: new Date().toISOString() }
    const filePath = deckJsonPath(workspacePath, deck.deckId)
    await fs.writeFile(filePath, JSON.stringify(updated, null, 2), 'utf8')

    console.log('[deckDocumentService] saved deck', deck.deckId, 'to', filePath)
    return { success: true, deckId: deck.deckId, filePath }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[deckDocumentService] saveDeckDocument error', msg)
    return { success: false, deckId: deck.deckId, filePath: '', error: msg }
  }
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

export interface LoadDeckResult {
  success: boolean
  deck?: DeckDocument
  filePath: string
  error?: string
}

/**
 * Load and validate a DeckDocument from disk.
 */
export async function loadDeckDocument(
  workspacePath: string,
  deckId: string,
): Promise<LoadDeckResult> {
  const filePath = deckJsonPath(workspacePath, deckId)
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    const deck = validateDeckDocument(parsed)
    return { success: true, deck, filePath }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[deckDocumentService] loadDeckDocument error', deckId, msg)
    return { success: false, filePath, error: msg }
  }
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

const EDITABLE_SLIDE_FIELDS = new Set([
  'title',
  'subtitle',
  'summary',
  'body',
  'items',
  'speakerNotes',
  'notes',
  'visualBrief',
])

function sanitizeSlideUpdates(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('slide updates must be an object')
  }

  const updates: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!EDITABLE_SLIDE_FIELDS.has(key)) continue
    if (key === 'items') {
      updates.items = Array.isArray(value)
        ? value.map(String).filter((item) => item.trim())
        : typeof value === 'string'
          ? value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
          : []
      continue
    }
    updates[key] = value == null ? undefined : String(value)
  }

  if (updates.speakerNotes !== undefined && updates.notes === undefined) {
    updates.notes = updates.speakerNotes
  } else if (updates.notes !== undefined && updates.speakerNotes === undefined) {
    updates.speakerNotes = updates.notes
  }

  return updates
}

export async function updateDeckSlide(input: {
  workspacePath: string
  deckId: string
  slideIndex: number
  updates: unknown
}): Promise<SaveDeckResult & { deck?: DeckDocument }> {
  const loaded = await loadDeckDocument(input.workspacePath, input.deckId)
  if (!loaded.success || !loaded.deck) {
    return { success: false, deckId: input.deckId, filePath: loaded.filePath, error: loaded.error || 'DeckDocument 加载失败' }
  }

  if (!Number.isInteger(input.slideIndex) || input.slideIndex < 0 || input.slideIndex >= loaded.deck.slides.length) {
    return { success: false, deckId: input.deckId, filePath: loaded.filePath, error: 'slideIndex 超出范围' }
  }

  const updates = sanitizeSlideUpdates(input.updates)
  const deck: DeckDocument = {
    ...loaded.deck,
    slides: loaded.deck.slides.map((slide, index) => (
      index === input.slideIndex ? { ...slide, ...updates } : slide
    )),
  }
  const saved = await saveDeckDocument(input.workspacePath, deck)
  return { ...saved, deck }
}

export async function updateDeckDocument(input: {
  workspacePath: string
  deckId: string
  updates: unknown
}): Promise<SaveDeckResult & { deck?: DeckDocument }> {
  const loaded = await loadDeckDocument(input.workspacePath, input.deckId)
  if (!loaded.success || !loaded.deck) {
    return { success: false, deckId: input.deckId, filePath: loaded.filePath, error: loaded.error || 'DeckDocument 加载失败' }
  }
  if (typeof input.updates !== 'object' || input.updates === null || Array.isArray(input.updates)) {
    return { success: false, deckId: input.deckId, filePath: loaded.filePath, error: 'deck updates must be an object' }
  }

  const raw = input.updates as Partial<DeckDocument>
  const deck: DeckDocument = {
    ...loaded.deck,
    title: raw.title != null ? String(raw.title) : loaded.deck.title,
    subtitle: raw.subtitle != null ? String(raw.subtitle) : loaded.deck.subtitle,
    scenario: raw.scenario != null ? String(raw.scenario) : loaded.deck.scenario,
    imageMode: raw.imageMode ?? loaded.deck.imageMode,
    sections: Array.isArray(raw.sections) ? raw.sections.map(String) : loaded.deck.sections,
    status: raw.status === 'partial' || raw.status === 'completed' ? raw.status : loaded.deck.status,
  }
  const saved = await saveDeckDocument(input.workspacePath, deck)
  return { ...saved, deck }
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export interface DeckSummary {
  deckId: string
  title: string
  status: 'partial' | 'completed'
  slideCount: number
  updatedAt: string
}

/**
 * List all DeckDocuments in a workspace (shallow load, just deck.json).
 */
export async function listDeckDocuments(workspacePath: string): Promise<DeckSummary[]> {
  const root = decksRoot(workspacePath)
  try {
    const entries = await fs.readdir(root, { withFileTypes: true })
    const results: DeckSummary[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const jsonPath = path.join(root, entry.name, 'deck.json')
      try {
        const raw = await fs.readFile(jsonPath, 'utf8')
        const parsed = JSON.parse(raw)
        const deck = validateDeckDocument(parsed)
        results.push({
          deckId: deck.deckId,
          title: deck.title,
          status: deck.status,
          slideCount: deck.slides.length,
          updatedAt: deck.updatedAt,
        })
      } catch {
        // skip corrupted / incomplete deck dirs
      }
    }

    return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

export interface RenderDeckInput {
  workspacePath: string
  deckId: string
  manifestId: string
  /** Override output file path; default: <deckDir>/<manifestId>_output.pptx */
  outputPath?: string
}

/**
 * Load a DeckDocument from disk and render it to PPTX using the specified manifest.
 *
 * Zero LLM calls. Zero image generation. Zero token cost.
 */
export async function renderDeckDocument(input: RenderDeckInput): Promise<RetemplateResult> {
  const { workspacePath, deckId, manifestId } = input

  // Load deck
  const loaded = await loadDeckDocument(workspacePath, deckId)
  if (!loaded.success || !loaded.deck) {
    return {
      success: false,
      outputPath: input.outputPath ?? '',
      slideCount: 0,
      manifestId,
      templateId: manifestId,
      error: loaded.error ?? 'Failed to load deck',
      llmCalls: 0,
      imageCalls: 0,
      tokenCost: 0,
    }
  }

  const outputPath = input.outputPath ?? deckOutputPath(workspacePath, deckId, manifestId)
  await fs.mkdir(path.dirname(outputPath), { recursive: true })

  console.log('[deckDocumentService] renderDeckDocument', deckId, manifestId, '->', outputPath)

  return renderDeck(loaded.deck, manifestId, { outputPath, templateId: manifestId })
}

// ---------------------------------------------------------------------------
// Helpers for template init (called by deckDocumentService bootstrap)
// ---------------------------------------------------------------------------

/**
 * Resolve the default source .pptx path for new built-in templates.
 * New templates (business_report_light, chinese_season_light) reuse the
 * cuhk_sz_default source template since PptxGenJS only needs the XML structure.
 */
export function resolveDefaultSourceTemplatePath(): string {
  return buildTemplateSourcePath('cuhk_sz_default', 'source-template.pptx')
}
