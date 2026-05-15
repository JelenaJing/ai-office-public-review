import { validateDeckDocument, type DeckDocument } from '../../../../src/types/deckDocument'
import { extractJsonFromLlmText } from '../../../../src/modules/generation/ppt/deckBuilder/buildDeckFromPrompt'
import { completeText } from '../llmClient'
import type { AppSettings } from '../settingsStore'
import { loadDeckDocument, saveDeckDocument } from '../deckDocumentService'

export interface OptimizeDeckStructureResult {
  success: boolean
  deckId: string
  deckPath?: string
  deck?: DeckDocument
  error?: string
}

function compactDeckForPrompt(deck: DeckDocument): unknown {
  return {
    deckId: deck.deckId,
    schemaVersion: deck.schemaVersion,
    title: deck.title,
    subtitle: deck.subtitle,
    scenario: deck.scenario,
    language: deck.language,
    sections: deck.sections,
    imageMode: deck.imageMode,
    sourcePrompt: deck.sourcePrompt,
    source: deck.source,
    sourceRefs: deck.sourceRefs,
    assets: deck.assets,
    slides: deck.slides.map((slide, index) => ({
      index: typeof slide.index === 'number' ? slide.index : index,
      id: slide.id || `slide-${index}`,
      intent: slide.intent,
      sectionId: slide.sectionId,
      title: slide.title,
      shortTitle: slide.shortTitle,
      displayTitle: slide.displayTitle,
      subtitle: slide.subtitle,
      heading: slide.heading,
      body: slide.body,
      items: slide.items,
      summary: slide.summary,
      keyTakeaways: slide.keyTakeaways,
      keywords: slide.keywords,
      visualBrief: slide.visualBrief,
      notes: slide.notes,
      speakerNotes: slide.speakerNotes,
      contentDensity: slide.contentDensity,
      visualDemand: slide.visualDemand,
      preferredLayout: slide.preferredLayout,
      metrics: slide.metrics,
      timeline: slide.timeline,
      leftTitle: slide.leftTitle,
      leftItems: slide.leftItems,
      rightTitle: slide.rightTitle,
      rightItems: slide.rightItems,
      textBlocks: slide.textBlocks,
      assetRefs: slide.assetRefs,
      imagePath: slide.imagePath,
    })),
  }
}

function normalizeOptimizedDeck(raw: unknown, original: DeckDocument): DeckDocument {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('AI 返回的结构不完整，已保留原 PPT。')
  }

  const candidate = raw as Record<string, unknown>
  const now = new Date().toISOString()
  const merged: Record<string, unknown> = {
    ...candidate,
    deckId: original.deckId,
    schemaVersion: '1.0',
    language: candidate.language === 'en' ? 'en' : original.language,
    source: original.source,
    sourcePrompt: original.sourcePrompt,
    sourceRefs: original.sourceRefs,
    assets: original.assets,
    status: 'completed',
    createdAt: original.createdAt,
    updatedAt: now,
  }

  if (!merged.title) merged.title = original.title
  if (!Array.isArray(merged.slides) || merged.slides.length === 0) {
    throw new Error('AI 返回的结构不完整，已保留原 PPT。')
  }

  const slides = merged.slides as Array<Record<string, unknown>>
  merged.expectedSlideCount = slides.length
  merged.completedSlideCount = slides.length
  merged.slides = slides.map((slide, index) => ({
    ...slide,
    index,
    id: slide.id ? String(slide.id) : `slide-${index}`,
    intent: slide.intent || (index === 0 ? 'cover' : index === slides.length - 1 ? 'closing' : 'text_content'),
  }))

  return validateDeckDocument(merged)
}

export async function optimizeDeckStructure(input: {
  settings: AppSettings
  workspacePath: string
  deckId: string
}): Promise<OptimizeDeckStructureResult> {
  const loaded = await loadDeckDocument(input.workspacePath, input.deckId)
  if (!loaded.success || !loaded.deck) {
    return { success: false, deckId: input.deckId, error: loaded.error || 'DeckDocument 加载失败' }
  }

  const original = loaded.deck
  const systemPrompt = [
    '你是专业演示文稿结构编辑器。你的任务是优化 DeckDocument 的结构，而不是修改模板。',
    '必须返回严格 JSON，不要 Markdown，不要解释。',
    '保留原始主题、事实和核心内容，不要虚构信息。',
    '可以优化章节顺序、标题、正文长度、要点拆分，必要时补充目录或过渡页。',
    '不要输出 theme、templateId、font、color、backgroundImage、layoutCoordinates、master、animation 等模板字段。',
  ].join('\n')
  const userPrompt = [
    '请优化下面的 DeckDocument，返回完整 DeckDocument JSON。',
    '要求：',
    '1. 保持 deckId、source、sourceRefs、assets 语义不丢失。',
    '2. 每页必须有 index、id、intent，并尽量包含 title/heading/body/items。',
    '3. 精简过长正文，把长段落拆成更适合幻灯片的要点。',
    '4. 如果结构缺少目录或过渡页且有必要，可以新增 toc 或 section_divider。',
    '5. 返回 JSON 顶层必须包含 title、language、slides、status、expectedSlideCount、completedSlideCount。',
    '',
    JSON.stringify(compactDeckForPrompt(original), null, 2),
  ].join('\n')

  try {
    const rawText = await completeText(input.settings, {
      systemPrompt,
      userPrompt,
      temperature: 0.35,
      maxTokens: 8192,
      featureName: 'pptOptimizeStructure',
    })
    const parsed = extractJsonFromLlmText(rawText)
    const optimized = normalizeOptimizedDeck(parsed, original)
    const saved = await saveDeckDocument(input.workspacePath, optimized)
    if (!saved.success) {
      return { success: false, deckId: input.deckId, error: saved.error || '保存优化后的 DeckDocument 失败' }
    }
    return { success: true, deckId: saved.deckId, deckPath: saved.filePath, deck: optimized }
  } catch (error) {
    return {
      success: false,
      deckId: input.deckId,
      error: error instanceof Error ? error.message : 'AI 优化结构失败',
    }
  }
}
