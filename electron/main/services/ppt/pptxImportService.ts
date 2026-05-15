import path from 'node:path'
import { buildDeckFromImportedPptxService, extractRawPptxSlides } from './deckBuilder/deckBuilderService'
import { renderPptxPreview, type PptxPreviewSlide } from './pptxPreviewService'
import type { AppSettings } from '../settingsStore'
import type { DeckDocument } from '../../../../src/types/deckDocument'
import { saveDeckDocument } from '../deckDocumentService'

export interface PptxImportSource {
  type: 'email_attachment' | 'local_file'
  messageId?: string
  attachmentId?: string
  filename?: string
}

export interface PptxImportFromFileInput {
  workspacePath: string
  pptxPath: string
  source: PptxImportSource
  importMode?: 'rule_based' | 'ai_assisted'
  language?: 'zh' | 'en'
}

export interface PptxImportFromFileResult {
  success: boolean
  deckDocumentId?: string
  deckPath?: string
  deck?: DeckDocument
  originalPptxPath?: string
  previewSlides: PptxPreviewSlide[]
  extractionWarnings: string[]
  error?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeImportInput(payload: unknown): PptxImportFromFileInput {
  if (!isRecord(payload)) throw new Error('PPTX 导入参数无效')

  const workspacePath = String(payload.workspacePath || '').trim()
  const pptxPath = String(payload.pptxPath || '').trim()
  if (!workspacePath) throw new Error('缺少 workspacePath')
  if (!pptxPath) throw new Error('缺少 pptxPath')

  const sourceRaw = isRecord(payload.source) ? payload.source : {}
  const sourceType = String(sourceRaw.type || 'local_file') === 'email_attachment'
    ? 'email_attachment'
    : 'local_file'

  const importMode = payload.importMode === 'ai_assisted' ? 'ai_assisted' : 'rule_based'
  const language = payload.language === 'en' ? 'en' : 'zh'

  return {
    workspacePath,
    pptxPath,
    importMode,
    language,
    source: {
      type: sourceType,
      messageId: sourceRaw.messageId != null ? String(sourceRaw.messageId) : undefined,
      attachmentId: sourceRaw.attachmentId != null ? String(sourceRaw.attachmentId) : undefined,
      filename: sourceRaw.filename != null ? String(sourceRaw.filename) : undefined,
    },
  }
}

function buildPreviewDir(workspacePath: string, source: PptxImportSource): string {
  const baseName = String(source.filename || 'imported-pptx')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/^\.+/, '_')
    .slice(0, 120) || 'imported-pptx'
  return path.join(workspacePath, '05_Presentation', 'imports', 'email-attachments', '.preview', `${Date.now()}-${baseName}`)
}

export async function importPptxFromFile(
  payload: unknown,
  settings: AppSettings | null,
): Promise<PptxImportFromFileResult> {
  const input = normalizeImportInput(payload)
  const warnings: string[] = []

  const extracted = await extractRawPptxSlides(input.pptxPath)
  if (!extracted.success) {
    return {
      success: false,
      originalPptxPath: input.pptxPath,
      previewSlides: [],
      extractionWarnings: warnings,
      error: extracted.error || 'PPTX 解析失败',
    }
  }

  const previewResult = await renderPptxPreview({
    pptxPath: input.pptxPath,
    previewDir: buildPreviewDir(input.workspacePath, input.source),
  })
  if (previewResult.warning) warnings.push(previewResult.warning)
  if (previewResult.error) warnings.push(previewResult.error)

  const deckResult = await buildDeckFromImportedPptxService(settings, {
    sourceType: 'imported_pptx',
    workspacePath: input.workspacePath,
    pptxPath: input.pptxPath,
    rawSlides: extracted.slides,
    importMode: input.importMode,
    language: input.language,
  })

  warnings.push(...deckResult.warnings)

  if (!deckResult.success || !deckResult.deckDocumentId || !deckResult.deckPath) {
    return {
      success: false,
      originalPptxPath: input.pptxPath,
      previewSlides: previewResult.slides || [],
      extractionWarnings: warnings,
      error: deckResult.error || 'DeckDocument 构建失败',
    }
  }

  let deck = deckResult.deck
  let deckPath = deckResult.deckPath
  if (deck && input.source.type === 'email_attachment') {
    const emailAttachment = {
      messageId: input.source.messageId,
      attachmentId: input.source.attachmentId,
      filename: input.source.filename,
    }
    deck = {
      ...deck,
      source: {
        ...deck.source,
        emailAttachment,
      },
      sourceRefs: (deck.sourceRefs || []).map((ref) => ({
        ...ref,
        sourceType: ref.sourceType === 'pptx_slide' ? 'mail_attachment' : ref.sourceType,
        emailAttachment,
      })),
    }
    const saved = await saveDeckDocument(input.workspacePath, deck)
    if (!saved.success) {
      warnings.push(`保存邮件附件来源信息失败: ${saved.error || '未知错误'}`)
    } else {
      deckPath = saved.filePath
    }
  }

  return {
    success: true,
    deckDocumentId: deckResult.deckDocumentId,
    deckPath,
    deck,
    originalPptxPath: input.pptxPath,
    previewSlides: previewResult.slides || [],
    extractionWarnings: warnings,
  }
}
