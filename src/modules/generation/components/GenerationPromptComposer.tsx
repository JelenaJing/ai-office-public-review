// vNext freeze: this is the generation-mode front-end entry for document/image/ppt flows.
// Delivery stays downstream in profile-specific services and delivery engines.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Mic, RefreshCw } from 'lucide-react'
import { useDocument } from '../../../contexts/DocumentContext'
import { useFormalTemplateSession } from '../../formal/contexts/FormalTemplateSessionContext'
import { useGenerationWorkbench, type PptSlidePreview } from '../../../contexts/GenerationWorkbenchContext'
import { useKnowledge } from '../../../contexts/KnowledgeContext'
import { useWorkspace } from '../../../contexts/WorkspaceContext'
import { useWorkspaceMode } from '../../../contexts/WorkspaceModeContext'
import { FORMAL_TEMPLATE_COMPOSER_PLACEHOLDER, useFormalTemplateGeneration } from '../../formal/hooks/useFormalTemplateGeneration'
import {
  getPrimaryStyleReferenceId,
} from '../../image/services/imageGenerationPrompt'
import {
  isExplicitImageGenerationRequest,
  orderSelectedKnowledgeDocuments,
  resolveActiveImageStyleProfile,
  runSharedImageGeneration,
} from '../../image/services/sharedImageGeneration'
import { generateSelectionImage } from '../../image/services/ImageService'
import {
  buildKnowledgeTaskConstraints,
  createDefaultTemplateInheritance,
  resolveKnowledgeTaskPreview,
} from '../../../shared/knowledge/knowledgeTaskHelper'
import { runWritingAssistant } from '../../writing/services/WritingAssistantService'
import type {
  KnowledgeDocumentDetail,
  KnowledgeDocumentMeta,
  KnowledgeSourceType,
  PreviewKnowledgeTaskContextResult,
} from '../../../types/knowledge'
import type { KnowledgeDocumentBlock, KnowledgeDocumentJson, KnowledgeDocumentSection } from '../../../types/knowledgeDocumentJson'
import type { ImageReferenceRole } from '../../../types/imageGeneration'
import { extractPptPrimarySourceParagraphs, type PptPrimarySourceState } from '../../../utils/pptPrimarySource'
import { getGenerationModeOption } from './generationWorkbenchConfig'
import {
  buildTimestampStamp,
  getFileName,
  normalizeFileLikePath,
  sanitizeFileStem,
  toDisplayUrl,
} from './generationWorkbenchUtils'
import { startChineseVoskVoiceInput, supportsVoskVoiceInput, type VoskVoiceInputSession } from '../../../services/voskVoiceInput'
import { assembleDeckDocument } from '../ppt/assembleDeckDocument'
import { validateDeckDocumentOutput } from '../ppt/validateDeckDocumentOutput'
import {
  type UnifiedComposerCapabilities,
  UnifiedComposerActionRow,
  UnifiedComposerAssist,
  UnifiedComposerShell,
  UnifiedComposerStatusPill,
  UnifiedComposerStatusRow,
  UnifiedComposerStatusText,
  UnifiedComposerTextarea,
  UnifiedGenerationDockWrap,
  UnifiedGhostButton,
  UnifiedVoiceButton,
} from './generationDockPrimitives'

const PPT_TEXT_SOURCE_TYPES: KnowledgeSourceType[] = ['pdf', 'docx', 'doc', 'txt', 'md', 'pptx']
const PPT_WORD_CONTENT_CHAR_BUDGET = 16000
const PPT_EVIDENCE_CHAR_BUDGET = 12000

function isWordKnowledgeDocument(document: KnowledgeDocumentMeta | null | undefined): document is KnowledgeDocumentMeta {
  return Boolean(document && (document.sourceType === 'doc' || document.sourceType === 'docx'))
}

function isPptTextKnowledgeDocument(document: KnowledgeDocumentMeta | null | undefined): document is KnowledgeDocumentMeta {
  return Boolean(document && PPT_TEXT_SOURCE_TYPES.includes(document.sourceType))
}

function normalizeKnowledgeSourceText(value: string): string {
  return String(value || '')
    .replace(/\r/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function intentToSlideType(intent: string): string {
  switch (intent) {
    case 'cover': return 'cover'
    case 'toc': return 'toc'
    case 'section_divider': return 'section'
    case 'closing': return 'summary'
    default: return 'content'
  }
}

function splitKnowledgeParagraphs(text: string): string[] {
  const normalized = normalizeKnowledgeSourceText(text)
  if (!normalized) return []

  const paragraphs = normalized
    .split(/\n+/)
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  if (paragraphs.length >= 3) return paragraphs

  return normalized
    .split(/(?<=[。！？；.!?;])\s*/)
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function fitTextSegmentsWithinBudget(segments: string[], maxChars: number): { segments: string[]; omittedCount: number } {
  const normalizedSegments = segments.map((segment) => normalizeKnowledgeSourceText(segment)).filter(Boolean)
  const included: string[] = []
  let usedChars = 0

  for (const segment of normalizedSegments) {
    const separatorLength = included.length > 0 ? 1 : 0
    if (usedChars + separatorLength + segment.length <= maxChars) {
      included.push(segment)
      usedChars += separatorLength + segment.length
      continue
    }

    if (included.length === 0) {
      included.push(segment.slice(0, Math.max(0, maxChars)).trim())
    }
    break
  }

  return {
    segments: included.filter(Boolean),
    omittedCount: Math.max(0, normalizedSegments.length - included.length),
  }
}

function summarizeKnowledgeBlocks(blocks: KnowledgeDocumentBlock[]): string[] {
  const items: string[] = []

  for (const block of blocks) {
    if (items.length >= 4) break

    if (block.type === 'image') {
      items.push('图片内容')
      continue
    }

    if (block.type === 'table') {
      const rowCount = block.rows?.length || 0
      const colCount = block.rows?.[0]?.length || 0
      items.push(rowCount > 0 && colCount > 0 ? `表格 ${rowCount}x${colCount}` : '表格内容')
      continue
    }

    if (block.type === 'list') {
      const joined = (block.items || []).map((item) => normalizePptSummaryText(item, 28)).filter(Boolean).slice(0, 3).join('；')
      if (joined) items.push(`要点 ${joined}`)
      continue
    }

    const text = normalizePptSummaryText(block.text || '', block.type === 'heading' ? 30 : 52)
    if (text) items.push(text)
  }

  return Array.from(new Set(items.filter(Boolean))).slice(0, 4)
}

function buildWordContentSummary(document: KnowledgeDocumentMeta, detail: KnowledgeDocumentDetail | null): { summary: string; sourceTextLength: number; paragraphCount: number } {
  const text = normalizeKnowledgeSourceText(detail?.extractedText || detail?.originalExtractedText || '')
  const allParagraphs = splitKnowledgeParagraphs(text)
    .filter((item) => item !== document.title && item !== document.originalName)
  const numberedParagraphs = allParagraphs.map((item, index) => `${index + 1}. ${item}`)
  const includedParagraphs = fitTextSegmentsWithinBudget(numberedParagraphs, PPT_WORD_CONTENT_CHAR_BUDGET)

  const sections = detail?.parsedDocument?.sections?.length
    ? [...detail.parsedDocument.sections].sort((left, right) => left.order - right.order)
    : []
  const sectionLines = fitTextSegmentsWithinBudget(
    sections.map((section, index) => `${index + 1}. ${normalizeKnowledgeSourceText(section.title || `第 ${index + 1} 部分`)}`),
    1200,
  )

  if (includedParagraphs.segments.length === 0) {
    return {
      summary: [
        `主内容 Word：${document.title}`,
        '未读取到稳定的正文提要；请主要根据下方命中的正文证据组织 PPT。',
      ].join('\n'),
      sourceTextLength: text.length,
      paragraphCount: allParagraphs.length,
    }
  }

  const lines = [
    `主内容 Word：${document.title}`,
    '以下为该 Word 尽量保全的原始正文内容，请优先依据这些段落组织 PPT；不要只提炼标题，要从正文事实、论点、步骤和结论中提取页面内容。',
  ]

  if (sectionLines.segments.length > 0) {
    lines.push('文档章节：')
    lines.push(...sectionLines.segments)
    if (sectionLines.omittedCount > 0) {
      lines.push(`其余 ${sectionLines.omittedCount} 个章节标题因提示词长度限制未展开，但正文段落仍已尽量保留。`)
    }
  }

  lines.push('正文段落：')
  lines.push(...includedParagraphs.segments)
  if (includedParagraphs.omittedCount > 0) {
    lines.push(`其余 ${includedParagraphs.omittedCount} 段正文因提示词长度限制未继续展开；已优先保留靠前且完整的原文段落。`)
  }

  return {
    summary: lines.join('\n'),
    sourceTextLength: text.length,
    paragraphCount: allParagraphs.length,
  }
}

type PptPrimaryContentContext = {
  title: string | null
  summary: string
  sourceTextLength: number
  paragraphCount: number
  kind: 'direct-document' | 'word-knowledge' | 'none'
}

function buildDirectPrimaryContentSummary(source: PptPrimarySourceState): PptPrimaryContentContext {
  const extracted = extractPptPrimarySourceParagraphs(source)
  const title = extracted.title || '当前文稿'
  const allParagraphs = extracted.paragraphs.filter((item) => item !== title)
  const numberedParagraphs = allParagraphs.map((item, index) => `${index + 1}. ${item}`)
  const includedParagraphs = fitTextSegmentsWithinBudget(numberedParagraphs, PPT_WORD_CONTENT_CHAR_BUDGET)

  if (includedParagraphs.segments.length === 0) {
    return {
      title,
      kind: 'direct-document',
      summary: [
        `主内容文稿：${title}`,
        '当前本轮内存文稿尚未提取到稳定正文；如已勾选补充资料，请结合下方正文证据生成 PPT。',
      ].join('\n'),
      sourceTextLength: extracted.sourceTextLength,
      paragraphCount: allParagraphs.length,
    }
  }

  const lines = [
    `主内容文稿：${title}`,
    '以下为本轮内存文稿提取出的正文内容，请优先依据这些段落组织 PPT；不要只根据标题、文件名或空泛常识生成。',
    '正文段落：',
    ...includedParagraphs.segments,
  ]

  if (includedParagraphs.omittedCount > 0) {
    lines.push(`其余 ${includedParagraphs.omittedCount} 段正文因提示词长度限制未继续展开；已优先保留靠前且完整的原文段落。`)
  }

  return {
    title,
    kind: 'direct-document',
    summary: lines.join('\n'),
    sourceTextLength: extracted.sourceTextLength,
    paragraphCount: allParagraphs.length,
  }
}

function buildPptEvidenceSummary(preview: PreviewKnowledgeTaskContextResult | null): { summary: string; evidenceCount: number; evidenceTextLength: number } {
  const explicitCitations = (preview?.citations || []).filter((item) => item.sourceKind === 'required-reference' || item.sourceKind === 'preferred-reference')
  if (explicitCitations.length === 0) {
    return {
      summary: '当前未命中稳定的正文证据；若存在主内容文稿，请优先依据其正文提要生成 PPT。',
      evidenceCount: 0,
      evidenceTextLength: 0,
    }
  }

  const hitTextByChunkId = new Map((preview?.retrievedHits || []).map((item) => [item.chunk.id, normalizeKnowledgeSourceText(item.chunk.text || item.quote || '')]))
  const evidenceSegments = explicitCitations.map((item) => {
    const text = hitTextByChunkId.get(item.chunkId) || normalizeKnowledgeSourceText(item.quote || '')
    return `- ${item.documentTitle}｜${item.locatorLabel}\n  ${text}`
  })
  const includedEvidence = fitTextSegmentsWithinBudget(evidenceSegments, PPT_EVIDENCE_CHAR_BUDGET)
  return {
    summary: [
      '以下片段来自你本轮明确勾选的资料正文，必须作为 PPT 内容事实与术语表达的主要依据：',
      ...includedEvidence.segments,
      ...(includedEvidence.omittedCount > 0 ? [`其余 ${includedEvidence.omittedCount} 条正文证据因提示词长度限制未继续展开；已优先保留完整 chunk 原文而非短摘要。`] : []),
    ].join('\n'),
    evidenceCount: explicitCitations.length,
    evidenceTextLength: explicitCitations.reduce((total, item) => total + (hitTextByChunkId.get(item.chunkId) || normalizeKnowledgeSourceText(item.quote || '')).length, 0),
  }
}

function buildPptContentStrategy(params: {
  primaryContentTitle: string | null
  primaryContentKind: 'direct-document' | 'word-knowledge' | 'none'
  primaryPptDocument: KnowledgeDocumentMeta | null
  sourceTextLength: number
  paragraphCount: number
  evidenceCount: number
  evidenceTextLength: number
}): string {
  const { primaryContentTitle, primaryContentKind, primaryPptDocument, sourceTextLength, paragraphCount, evidenceCount, evidenceTextLength } = params
  const shouldExpand = primaryContentKind !== 'none'
    ? sourceTextLength < 900 || paragraphCount < 4
    : evidenceTextLength < 500 || evidenceCount < 3

  const roleLine = primaryContentTitle
    ? `主内容来源：${primaryContentTitle}（${primaryContentKind === 'direct-document' ? '本轮内存文稿优先' : 'Word 正文优先'}）${primaryPptDocument ? `；主素材 PPT ${primaryPptDocument.title} 仅提供页序和版式参考。` : '；当前没有主素材 PPT，请直接按主内容正文组织结构。'}`
    : primaryPptDocument
      ? `当前没有显式主内容文稿；请以主素材 PPT 的页序为骨架，并严格依据勾选资料正文证据填充内容。`
      : '当前没有显式主素材 PPT；请严格依据勾选资料正文证据自行组织演示结构。'

  const densityLine = shouldExpand
    ? '当前正文资料信息密度偏低。你可以在不脱离原文主题和事实边界的前提下做适度扩写，用于补足背景说明、概念解释、过渡句、总结句、影响与建议，但不得编造新的具体事实、数字、案例、政策或实验结果。'
    : '当前正文资料较充足。请以提炼、重组和演示化表达为主，尽量少做扩写，不要把一页写成空泛套话。'

  return [roleLine, densityLine].join('\n')
}

async function buildPptKnowledgeContext(
  departmentId: string,
  prompt: string,
  selectedDocuments: KnowledgeDocumentMeta[],
  primaryDocumentId: string | null,
  primarySource: PptPrimarySourceState | null,
): Promise<{
  primaryWordDocument: KnowledgeDocumentMeta | null
  primaryContentTitle: string | null
  primaryContentSummary: string
  evidenceSummary: string
  contentStrategy: string
}> {
  const primaryPptDocument = selectedDocuments.find((document) => document.id === primaryDocumentId && document.sourceType === 'pptx')
    || selectedDocuments.find((document) => document.sourceType === 'pptx')
    || null
  const primaryWordDocument = selectedDocuments.find((document) => document.id === primaryDocumentId && isWordKnowledgeDocument(document))
    || selectedDocuments.find((document) => isWordKnowledgeDocument(document))
    || null
  const textDocuments = selectedDocuments.filter((document) => isPptTextKnowledgeDocument(document))
  const directPrimaryContent = primarySource ? buildDirectPrimaryContentSummary(primarySource) : null

  const [primaryWordDetail, preview] = await Promise.all([
    !directPrimaryContent && primaryWordDocument
      ? window.electronAPI.getKnowledgeDocument(departmentId, primaryWordDocument.id).catch(() => null)
      : Promise.resolve(null),
    textDocuments.length > 0
      ? resolveKnowledgeTaskPreview({
        instruction: prompt,
        constraints: buildKnowledgeTaskConstraints({
          mode: 'selected-only',
          requiredReferenceDocumentIds: textDocuments.map((document) => document.id),
          autoRetrievalLimit: Math.min(24, Math.max(10, textDocuments.length * 6)),
          templateInheritance: createDefaultTemplateInheritance(),
        }),
        previewContext: (p: any) => window.electronAPI.previewKnowledgeTaskContext(departmentId, p),
        fallbackInstruction: '请根据当前勾选资料生成 PPT',
      })
      : Promise.resolve(null),
  ])

  const primaryContent: PptPrimaryContentContext = directPrimaryContent
    || (primaryWordDocument
      ? (() => {
          const wordSummary = buildWordContentSummary(primaryWordDocument, primaryWordDetail)
          return {
            title: primaryWordDocument.title,
            summary: wordSummary.summary,
            sourceTextLength: wordSummary.sourceTextLength,
            paragraphCount: wordSummary.paragraphCount,
            kind: 'word-knowledge' as const,
          }
        })()
      : {
          title: null,
          summary: '当前未指定主内容文稿。',
          sourceTextLength: 0,
          paragraphCount: 0,
          kind: 'none' as const,
        })
  const evidenceSummary = buildPptEvidenceSummary(preview)

  return {
    primaryWordDocument,
    primaryContentTitle: primaryContent.title,
    primaryContentSummary: primaryContent.summary,
    evidenceSummary: evidenceSummary.summary,
    contentStrategy: buildPptContentStrategy({
      primaryContentTitle: primaryContent.title,
      primaryContentKind: primaryContent.kind,
      primaryPptDocument,
      sourceTextLength: primaryContent.sourceTextLength,
      paragraphCount: primaryContent.paragraphCount,
      evidenceCount: evidenceSummary.evidenceCount,
      evidenceTextLength: evidenceSummary.evidenceTextLength,
    }),
  }
}

function normalizePptSummaryText(value: string, maxLength = 40): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function summarizePptBlocks(blocks: KnowledgeDocumentBlock[]): string[] {
  const items: string[] = []

  for (const block of blocks) {
    if (items.length >= 4) break

    if (block.type === 'image') {
      items.push('图片占位')
      continue
    }

    if (block.type === 'table') {
      const rowCount = block.rows?.length || 0
      const colCount = block.rows?.[0]?.length || 0
      items.push(rowCount > 0 && colCount > 0 ? `表格 ${rowCount}x${colCount}` : '表格')
      continue
    }

    if (block.type === 'list') {
      const joined = (block.items || []).map((item) => normalizePptSummaryText(item, 24)).filter(Boolean).slice(0, 3).join('；')
      if (joined) items.push(`要点 ${joined}`)
      continue
    }

    const text = normalizePptSummaryText(block.text || '', block.type === 'heading' ? 28 : 36)
    if (text) items.push(text)
  }

  return Array.from(new Set(items.filter(Boolean))).slice(0, 4)
}

function buildPptPageLine(section: KnowledgeDocumentSection, blocks: KnowledgeDocumentBlock[], index: number): string {
  const imageCount = blocks.filter((block) => block.type === 'image').length
  const tableCount = blocks.filter((block) => block.type === 'table').length
  const summaryItems = summarizePptBlocks(blocks)
  const structureTags = [
    imageCount > 0 ? `${imageCount} 张图片` : '',
    tableCount > 0 ? `${tableCount} 个表格` : '',
  ].filter(Boolean)
  const detailParts = [
    normalizePptSummaryText(section.title || `第 ${index + 1} 页`, 32),
    ...structureTags,
    ...summaryItems,
  ].filter(Boolean)
  return `${index + 1}. 第 ${index + 1} 页｜${detailParts.join('｜') || '以图片或版式占位为主'}`
}

function buildPrimaryPptStructureSummary(document: KnowledgeDocumentMeta, parsedDocument: KnowledgeDocumentJson | null): string {
  if (!parsedDocument) {
    return [
      `主素材：${document.title}`,
      '未读取到可用的逐页解析结果；请仍以该 PPT 作为整体版式和页序参考。',
    ].join('\n')
  }

  const sections = [...parsedDocument.sections].sort((left, right) => left.order - right.order)
  const pageLines = sections.map((section, index) => {
    const sectionBlocks = parsedDocument.blocks
      .filter((block) => block.sectionId === section.id)
      .sort((left, right) => left.order - right.order)
    return buildPptPageLine(section, sectionBlocks, index)
  })

  return [
    `主素材：${document.title}`,
    `总页数：${sections.length}`,
    ...pageLines,
  ].join('\n')
}

interface PptOutlineSlide {
  index: number
  role: string
  heading: string
  hint?: string
}

interface PptOutline {
  title: string
  slides: PptOutlineSlide[]
}

interface PptContextData {
  prompt: string
  primaryContentSummary: string
  evidenceSummary: string
  contentStrategy: string
  primaryPptSummary: string
  materialLines: string
}

async function fetchPptContextData(
  departmentId: string,
  prompt: string,
  selectedDocuments: KnowledgeDocumentMeta[],
  primaryDocumentId: string | null,
  primarySource: PptPrimarySourceState | null,
): Promise<PptContextData> {
  const knowledgeContext = await buildPptKnowledgeContext(departmentId, prompt, selectedDocuments, primaryDocumentId, primarySource)
  const primaryPptDocument = selectedDocuments.find((d) => d.id === primaryDocumentId && d.sourceType === 'pptx')
    || selectedDocuments.find((d) => d.sourceType === 'pptx')
    || null
  const primaryPptDetail = primaryPptDocument
    ? await window.electronAPI.getKnowledgeDocument(departmentId, primaryPptDocument.id).catch(() => null)
    : null
  const primaryPptSummary = primaryPptDocument
    ? buildPrimaryPptStructureSummary(primaryPptDocument, primaryPptDetail?.parsedDocument || null)
    : '当前未指定 PPT 主素材；请仅根据用户需求组织演示结构。'
  const secondaryMaterialLines = selectedDocuments
    .filter((d) => d.id !== primaryPptDocument?.id)
    .map((d, i) => {
      const tags: string[] = [d.sourceType]
      if (knowledgeContext.primaryWordDocument?.id === d.id) tags.push('主内容 Word')
      return `${i + 1}. ${d.title}｜${tags.join('｜')}｜${d.originalName}`
    })
  return {
    prompt,
    primaryContentSummary: knowledgeContext.primaryContentSummary,
    evidenceSummary: knowledgeContext.evidenceSummary,
    contentStrategy: knowledgeContext.contentStrategy,
    primaryPptSummary,
    materialLines: secondaryMaterialLines.length > 0 ? secondaryMaterialLines.join('\n') : '除主素材外，当前没有其他已选资料。',
  }
}

function buildPptOutlineInstruction(data: PptContextData): string {
  return [
    '你是一位专业的企业/机构 PPT 策划助手。',
    '请根据以下材料，为用户需求规划一份 PPT 演示文稿的结构大纲。',
    '你必须且只能输出一段合法的 JSON，不要输出任何额外解释、代码块标记或 markdown。',
    '',
    '## 输出格式（只需规划结构，不需要填写具体内容）',
    '{',
    '  "title": "演示标题",',
    '  "slides": [',
    '    {"index": 0, "intent": "cover", "heading": "封面标题", "hint": "副标题关键词"},',
    '    {"index": 1, "intent": "toc", "heading": "目录"},',
    '    {"index": 2, "intent": "section_divider", "heading": "第一章：背景"},',
    '    {"index": 3, "intent": "text_content", "heading": "页面标题", "hint": "此页核心观点一句话"},',
    '    {"index": 4, "intent": "content_cards", "heading": "核心要点", "hint": "要展示哪些卡片"},',
    '    {"index": 5, "intent": "closing", "heading": "总结与展望"}',
    '  ]',
    '}',
    '',
    '## 页面意图说明',
    '- cover：封面（必须第 0 页）- toc：目录 - section_divider：章节分隔 - text_content：正文（最常用）- content_cards：要点卡片 - image_text：图文页 - closing：总结',
    '',
    '## 约束',
    '1. 第 0 页必须是 cover。2. 总页数 8~16 页。3. 至少使用 2 种非 text_content 的页面类型。4. 只输出 JSON，禁止包含 theme/color/font/style/templateId 字段。',
    '',
    `## 用户需求\n${data.prompt}`,
    '',
    '## 内容处理策略',
    data.contentStrategy,
    '',
    '## 主内容正文提要',
    data.primaryContentSummary,
    '',
    '## 主素材 PPT 逐页结构摘要',
    data.primaryPptSummary,
    '',
    '## 勾选素材正文证据',
    data.evidenceSummary,
    '',
    '## 其他素材',
    data.materialLines,
  ].join('\n')
}

function buildSlideDetailInstruction(
  data: PptContextData,
  outline: PptOutline,
  slideInfo: PptOutlineSlide,
): string {
  const slideSummary = outline.slides.map((s) => `  ${s.index + 1}. [${s.role}] ${s.heading}`).join('\n')
  // Keyed by both new intent names and legacy role names for backward compatibility
  const roleGuide: Record<string, string> = {
    cover: '{"intent": "cover", "title": "封面主标题", "subtitle": "副标题或机构名"}',
    toc: '{"intent": "toc", "title": "目录", "items": ["章节一", "章节二", "章节三"]}',
    section_divider: '{"intent": "section_divider", "heading": "章节标题", "subtitle": "章节描述（可选）"}',
    section: '{"intent": "section_divider", "heading": "章节标题", "subtitle": "章节描述（可选）"}',
    text_content: '{"intent": "text_content", "heading": "页面标题", "body": "可选导语（直接引用原文结论）", "items": ["具体事实或数据（15字以上）", "要点2", "要点3", "要点4"]}',
    content: '{"intent": "text_content", "heading": "页面标题", "body": "可选导语（直接引用原文结论）", "items": ["具体事实或数据（15字以上）", "要点2", "要点3", "要点4"]}',
    content_cards: '{"intent": "content_cards", "heading": "核心要点", "items": ["要点一（15字以上）", "要点二", "要点三", "要点四"]}',
    metrics: '{"intent": "text_content", "heading": "核心指标", "body": "可选说明", "metrics": [{"value": "87%", "label": "指标名", "detail": "说明"}]}',
    comparison: '{"intent": "text_content", "heading": "对比标题", "leftTitle": "左侧标题", "leftItems": ["要点1", "要点2"], "rightTitle": "右侧标题", "rightItems": ["要点1", "要点2"]}',
    timeline: '{"intent": "text_content", "heading": "推进节奏", "timeline": [{"title": "阶段1", "detail": "具体说明"}]}',
    closing: '{"intent": "closing", "heading": "总结标题", "body": "可选收束语", "items": ["总结要点1", "要点2", "要点3"]}',
    summary: '{"intent": "closing", "heading": "总结标题", "body": "可选收束语", "items": ["总结要点1", "要点2", "要点3"]}',
    image_text: '{"intent": "image_text", "heading": "页面标题", "body": "配图说明文字", "items": ["要点1", "要点2"]}',
  }
  const expectedFormat = roleGuide[slideInfo.role] ?? roleGuide['text_content']
  return [
    '你是一位专业的企业/机构 PPT 内容撰写助手。',
    '请为 PPT 中的单页幻灯片生成完整内容。只输出一段合法的 JSON，不要输出任何额外解释、代码块标记或 markdown。',
    '禁止在 JSON 中出现 theme、color、font、style、templateId、imagePath、x、y、w、h、master、animation 等视觉样式或模板字段。',
    '',
    `## 整份 PPT 概要：${outline.title}（共 ${outline.slides.length} 页）`,
    slideSummary,
    '',
    `## 当前需要生成的页面`,
    `第 ${slideInfo.index + 1} 页 · 页面意图：${slideInfo.role} · heading：${slideInfo.heading}`,
    slideInfo.hint ? `内容提示：${slideInfo.hint}` : '',
    '',
    `## 输出格式（严格按照如下 JSON 结构）`,
    expectedFormat,
    '',
    '## 内容约束：每条 items 至少 15 字；不要使用"要点1"等占位符；text_content 页建议 4~6 条 items；metrics 建议 2~4 个指标。',
    '',
    `## 用户原始需求\n${data.prompt}`,
    '',
    '## 内容处理策略',
    data.contentStrategy,
    '',
    '## 主内容正文提要（优先参考）',
    data.primaryContentSummary,
    '',
    '## 勾选素材正文证据',
    data.evidenceSummary,
  ].filter(Boolean).join('\n')
}

function orderSelectedDocuments(
  documents: KnowledgeDocumentMeta[],
  selectedDocumentIds: string[],
  primaryDocumentId: string | null,
): KnowledgeDocumentMeta[] {
  return orderSelectedKnowledgeDocuments(documents, selectedDocumentIds, primaryDocumentId)
}

export default function GenerationPromptComposer() {
  const { currentMode, enterImageGenerationMode } = useWorkspaceMode()
  const workbench = useGenerationWorkbench()
  const knowledge = useKnowledge()
  // Effective department (knowledge base) for PPT generation: prefer first explicitly selected KB,
  // fall back to the globally active department.
  const effectivePptDepartmentId = (workbench.sessions['ppt']?.selectedKnowledgeBaseIds?.[0]) || knowledge.departmentId
  const { activeWorkspacePath } = useWorkspace()
  const { setStatusMessage } = useDocument()
  const { commitResult, setCommitResult } = useFormalTemplateSession()
  const { generateDocument, isBusy: documentBusy } = useFormalTemplateGeneration()
  const [submitting, setSubmitting] = useState(false)
  const pptRunningRef = useRef(false)
  const pptStopRef = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const pptTaskIdRef = useRef('')
  const lastConsumedPptTokenRef = useRef<string | null>(null)

  const voiceSupported = useMemo(() => supportsVoskVoiceInput(), [])
  const [voiceListening, setVoiceListening] = useState(false)
  const voiceSessionRef = useRef<VoskVoiceInputSession | null>(null)
  const voiceBaseInputRef = useRef('')
  const voiceStopRequestedRef = useRef(false)

  const modeOption = getGenerationModeOption(currentMode)
  const selectedDocumentIds = useMemo(() => {
    if (currentMode === 'image') {
      return workbench.imageReferences.map((item) => item.id)
    }
    return workbench.selectedAssetIds
  }, [currentMode, workbench.imageReferences, workbench.selectedAssetIds])
  const selectedDocuments = useMemo(
    () => orderSelectedDocuments(knowledge.documents, selectedDocumentIds, workbench.primaryAssetId),
    [knowledge.documents, selectedDocumentIds, workbench.primaryAssetId],
  )
  const imageSession = workbench.sessions.image
  const imageSessionDocumentIds = useMemo(
    () => imageSession.imageReferences.map((item) => item.id),
    [imageSession.imageReferences],
  )
  const imageSessionDocuments = useMemo(
    () => orderSelectedKnowledgeDocuments(knowledge.documents, imageSessionDocumentIds, imageSession.primaryAssetId),
    [imageSession.primaryAssetId, imageSessionDocumentIds, imageSession.imageReferences, knowledge.documents],
  )
  const imageReferenceSelections = useMemo(
    () => workbench.imageReferences.map((item, index) => ({ ...item, order: index })),
    [workbench.imageReferences],
  )
  const imagePrimaryReferenceId = useMemo(
    () => getPrimaryStyleReferenceId(workbench.imageReferences),
    [workbench.imageReferences],
  )
  const imageSessionPrimaryReferenceId = useMemo(
    () => getPrimaryStyleReferenceId(imageSession.imageReferences),
    [imageSession.imageReferences],
  )
  const imageSessionActiveStyleProfile = useMemo(
    () => resolveActiveImageStyleProfile(imageSession.lastImageStyleProfile, imageSessionPrimaryReferenceId),
    [imageSession.lastImageStyleProfile, imageSessionPrimaryReferenceId],
  )
  const pendingPptAutoSubmitToken = workbench.sessions.ppt.pendingAutoSubmitToken
  const pendingPptAutoSubmitTargetAssetId = workbench.sessions.ppt.pendingAutoSubmitTargetAssetId
  const pptPrimarySource = workbench.sessions.ppt.pptPrimarySource
  const pptStopRequested = workbench.sessions.ppt.pptStopRequested
  const pptResumeRequested = workbench.sessions.ppt.pptResumeRequested

  // Sync context stop flag to ref AND abort any in-flight LLM call
  useEffect(() => {
    if (pptStopRequested) {
      pptStopRef.current = true
      abortControllerRef.current?.abort()
      if (pptTaskIdRef.current) {
        window.electronAPI.aiCancelTask(pptTaskIdRef.current).catch(() => {/* best-effort */})
      }
    }
  }, [pptStopRequested])

  const imageComposerAssist = useMemo(() => {
    if (currentMode !== 'image') return null
    const parts = [`已选参考图 ${imageReferenceSelections.length} 张`]
    parts.push(imagePrimaryReferenceId ? '主参考图将直接随请求上传给图片 API' : '建议先设为主参考图，以明确参考优先级')
    return parts.join(' · ')
  }, [currentMode, imagePrimaryReferenceId, imageReferenceSelections])
  const currentTemplate = useMemo(
    () => knowledge.documents.find((item) => item.id === workbench.currentTemplateId) || null,
    [knowledge.documents, workbench.currentTemplateId],
  )
  const primaryAsset = useMemo(
    () => knowledge.documents.find((item) => item.id === workbench.primaryAssetId) || null,
    [knowledge.documents, workbench.primaryAssetId],
  )
  const effectiveBusy = currentMode === 'document' ? documentBusy : submitting

  // PPT template selector state
  const [pptTemplates, setPptTemplates] = useState<Array<{ id: string; name: string }>>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('cuhk_sz_default')

  useEffect(() => {
    if (currentMode !== 'ppt') return
    window.electronAPI.listSkillTemplates?.().then((res) => {
      if (res?.ok && Array.isArray(res.templates)) {
        setPptTemplates(res.templates)
      }
    }).catch(() => { /* ignore */ })
  }, [currentMode])
  const composerCapabilities: UnifiedComposerCapabilities = useMemo(() => ({
    canSend: true,
    canStop: false,
    canPause: false,
    canResume: false,
  }), [])
  const modeStatus = useMemo(() => {
    const statusMessage = String(workbench.generationStatus.message || '').trim()
    if (effectiveBusy) {
      return statusMessage || `正在${modeOption.label}生成...`
    }
    if (currentMode === 'image') return '可生成图片结果（支持参考图）'
    if (currentMode === 'ppt') return '可生成 PPT 文件与预览'
    return '就绪'
  }, [currentMode, effectiveBusy, modeOption.label, workbench.generationStatus.message])
  const hasCurrentResult = currentMode === 'document'
    ? Boolean(commitResult?.outputPath || workbench.resultType)
    : Boolean(workbench.resultType)

  const handleGenerateDocument = async () => {
    const result = await generateDocument(workbench.generationPrompt.trim())
    if (!result.success) {
      setStatusMessage(result.errorMessage)
      return
    }

    setStatusMessage('正式文稿已生成')
  }

  const handleClearResult = () => {
    if (currentMode === 'document') {
      setCommitResult(null)
    }
    workbench.clearCurrentResult()
  }

  const handleGenerateImage = async (options?: { prompt?: string; forceEnterImageMode?: boolean; source?: string }) => {
    const prompt = String(options?.prompt ?? workbench.generationPrompt ?? imageSession.generationPrompt).trim()
    if (!prompt) return
    if (options?.forceEnterImageMode) {
      enterImageGenerationMode()
    }

    setSubmitting(true)
    workbench.setModeSession('image', (session) => ({
      ...session,
      generationPrompt: prompt,
      generationStatus: {
        phase: 'running',
        message: imageSession.imageReferences.length > 0 ? `正在准备并上传 ${imageSession.imageReferences.length} 张参考图...` : '正在生成图片，请稍候...',
        updatedAt: new Date().toISOString(),
      },
      lastImageStyleProfile: null,
      resultAssetId: null,
      resultType: null,
      resultPath: null,
      resultTitle: '',
      resultPreviewText: '',
      resultPreviewUrl: null,
      lastUpdatedAt: new Date().toISOString(),
    }))
    try {
      const { result, references, roleSummary } = await runSharedImageGeneration({
        prompt,
        knowledgeRootPath: knowledge.info?.rootPath,
        documents: imageSessionDocuments,
        imageReferences: imageSession.imageReferences,
        styleOptions: imageSession.imageStyleOptions,
        generationMode: imageSession.imageGenerationMode,
        activeStyleProfile: imageSessionActiveStyleProfile,
        aspectRatio: '16:9',
        source: options?.source || 'GenerationPromptComposer.handleGenerateImage',
        debugContext: {
          currentMode,
          handlerName: 'handleGenerateImage',
          note: 'Dialog/workbench image generation uses shared structured-reference pipeline',
        },
        onStatus: (message) => {
          workbench.setModeSession('image', (session) => ({
            ...session,
            generationStatus: {
              phase: 'running',
              message,
              updatedAt: new Date().toISOString(),
            },
            lastUpdatedAt: new Date().toISOString(),
          }))
        },
        onStyleProfileChange: (profile) => {
          workbench.setModeSession('image', (session) => ({
            ...session,
            lastImageStyleProfile: profile,
            lastUpdatedAt: new Date().toISOString(),
          }))
        },
      })

      if (result.status !== 'success' || !result.image_url) {
        const errorMessage = result.error || '图片生成失败'
        workbench.setModeSession('image', (session) => ({
          ...session,
          generationStatus: {
            phase: 'error',
            message: errorMessage,
            updatedAt: new Date().toISOString(),
          },
          lastUpdatedAt: new Date().toISOString(),
        }))
        setStatusMessage(errorMessage)
        return
      }

      const outputPath = result.file_path || result.image_url
      workbench.setModeSession('image', (session) => ({
        ...session,
        generationPrompt: prompt,
        generationStatus: {
          phase: 'completed',
          message: '图片已生成，可在右侧保存或直接打开。',
          updatedAt: new Date().toISOString(),
        },
        resultType: 'image',
        resultAssetId: outputPath || null,
        resultPath: outputPath || null,
        resultTitle: result.filename || getFileName(outputPath || '') || 'generated.png',
        resultPreviewUrl: toDisplayUrl(result.image_url || outputPath || ''),
        lastUpdatedAt: new Date().toISOString(),
      }))
      setStatusMessage(references.length > 0 ? `图片生成完成，参考链路：${roleSummary.join(' / ')}` : '图片生成完成')
    } catch (error) {
      const message = error instanceof Error ? error.message : '图片生成失败'
      workbench.setModeSession('image', (session) => ({
        ...session,
        generationStatus: {
          phase: 'error',
          message,
          updatedAt: new Date().toISOString(),
        },
        lastUpdatedAt: new Date().toISOString(),
      }))
      setStatusMessage(message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleGeneratePpt = async (opts?: { fromManuscriptAutoSubmit?: boolean }) => {
    if (pptRunningRef.current) return
    if (!activeWorkspacePath) {
      const message = '请先打开工作区，再生成 PPT。'
      workbench.setGenerationStatus('error', message)
      setStatusMessage(message)
      return
    }

    // Freeze current user prompt immediately — never read workbench.generationPrompt again after this point
    const rawUserPrompt = workbench.generationPrompt.trim()

    pptRunningRef.current = true
    pptStopRef.current = false
    const abortCtrl = new AbortController()
    abortControllerRef.current = abortCtrl
    pptTaskIdRef.current = `ppt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

    setSubmitting(true)
    workbench.setGenerationStatus('running', '正在分析已选素材内容...')
    workbench.clearCurrentResult()

    // Full PPT session reset — clear all stale results from previous generation
    workbench.setModeSession('ppt', (session) => ({
      ...session,
      pptTaskStatus: 'generating_outline',
      pptLiveSlides: [],
      pptTotalSlides: 0,
      pptActiveSlideIndex: 0,
      pptStopRequested: false,
      pptDeckDocumentId: null,
      pptDeckPath: null,
      pptActiveTemplateManifestId: null,
      pptContentPackageId: null,
      pptSourceType: 'generated',
      pptOriginalFilePath: null,
      pptOriginalFileName: null,
      pptImportStatus: null,
      pptImportWarnings: [],
      pptPreviewSlides: [],
    }))

    try {
      /* ── 0. Fetch context data once (before any LLM call) ── */
      const contextData = await fetchPptContextData(
        effectivePptDepartmentId,
        rawUserPrompt,
        selectedDocuments,
        workbench.primaryAssetId,
        pptPrimarySource,
      )
      if (pptStopRef.current) {
        workbench.setModeSession('ppt', (s) => ({ ...s, pptTaskStatus: 'stopped' }))
        workbench.setGenerationStatus('completed', '已停止')
        return
      }

      /* ── NEW PRIMARY PATH: Single-call DeckDocument builder ── */
      // Attempts to build a full DeckDocument with one LLM call.
      // On success: renders PPTX immediately and returns (skips legacy per-slide loop).
      // On failure: falls through to the legacy per-slide loop as fallback.
      {
        const manuscriptText = extractPptPrimarySourceParagraphs(pptPrimarySource)
          .paragraphs.join('\n\n')
          .trim()

        // Source is manuscript ONLY when explicitly auto-submitted from the manuscript workbench.
        // Dialog-box manual generation ALWAYS uses deckBuildFromPrompt regardless of pptPrimarySource.
        const isManuscriptMode = Boolean(opts?.fromManuscriptAutoSubmit) && manuscriptText.length > 200

        const selectedBuilder = isManuscriptMode ? 'deckBuildFromManuscript' : 'deckBuildFromPrompt'
        console.log('[deck] build request', {
          sourceType: isManuscriptMode ? 'manuscript' : 'prompt',
          rawPromptPreview: rawUserPrompt.slice(0, 80),
          rawPromptLength: rawUserPrompt.length,
          hasPrimarySource: Boolean(pptPrimarySource),
          primarySourceKind: (pptPrimarySource as Record<string, unknown> | null)?.sourceKind ?? null,
          manuscriptTextLength: manuscriptText.length,
          selectedBuilder,
          fromManuscriptAutoSubmit: Boolean(opts?.fromManuscriptAutoSubmit),
        })

        const enrichedPrompt = [
          rawUserPrompt,
          contextData.primaryContentSummary
            ? `\n\n参考素材摘要：\n${contextData.primaryContentSummary.slice(0, 3000)}`
            : '',
          contextData.evidenceSummary
            ? `\n\n知识库证据：\n${contextData.evidenceSummary.slice(0, 2000)}`
            : '',
        ]
          .join('')
          .trim()

        workbench.setGenerationStatus('running', '正在生成演示文稿内容 · 消耗 token')
        workbench.setModeSession('ppt', (session) => ({
          ...session,
          pptTaskStatus: 'generating_deck',
        }))

        let deckBuildResult: Awaited<ReturnType<typeof window.electronAPI.deckBuildFromPrompt>> | null = null
        try {
          if (isManuscriptMode) {
            deckBuildResult = await window.electronAPI.deckBuildFromManuscript({
              sourceType: 'manuscript',
              manuscriptContent: manuscriptText.slice(0, 8000),
              prompt: enrichedPrompt,
              imageMode: 'none',
              language: 'zh',
              workspacePath: activeWorkspacePath,
              taskId: pptTaskIdRef.current,
            })
          } else {
            deckBuildResult = await window.electronAPI.deckBuildFromPrompt({
              sourceType: 'prompt',
              prompt: enrichedPrompt,
              imageMode: 'none',
              language: 'zh',
              workspacePath: activeWorkspacePath,
              taskId: pptTaskIdRef.current,
            })
          }
        } catch (deckBuildErr) {
          console.warn('[deck] deckBuild failed (exception), falling back to legacy loop:', deckBuildErr)
        }

        // Stop check: user may have pressed stop while deckBuild was running
        if (pptStopRef.current) {
          workbench.setModeSession('ppt', (s) => ({ ...s, pptTaskStatus: 'stopped' }))
          workbench.setGenerationStatus('completed', '已停止')
          return
        }

        // Stop check: user may have pressed stop while deckBuild was in flight
        if (pptStopRef.current) {
          workbench.setModeSession('ppt', (s) => ({ ...s, pptTaskStatus: 'stopped' }))
          workbench.setGenerationStatus('completed', '已停止')
          return
        }

        if (deckBuildResult?.success && deckBuildResult.deckDocumentId) {
          const deckId = deckBuildResult.deckDocumentId
          const deckTitle = (deckBuildResult as Record<string, unknown> & { deck?: { title?: string } })?.deck?.title ?? '(unknown)'
          console.log('[deck] deckBuild succeeded:', { deckId, isManuscriptMode, selectedBuilder, title: deckTitle, rawPromptHash: rawUserPrompt.slice(0, 12) })

          workbench.setGenerationStatus('running', '应用模板中 · 不消耗 token')
          workbench.setModeSession('ppt', (session) => ({
            ...session,
            pptTaskStatus: 'rendering_pptx',
          }))

          let deckRenderResult: Awaited<ReturnType<typeof window.electronAPI.deckRender>> | null = null
          try {
            deckRenderResult = await window.electronAPI.deckRender({
              workspacePath: activeWorkspacePath,
              deckId,
              manifestId: 'business_report',
            })
          } catch (renderErr) {
            console.warn('[deck] deckRender failed (exception), falling back to legacy loop:', renderErr)
          }

          if (deckRenderResult?.success && deckRenderResult.outputPath) {
            const finalPath = deckRenderResult.outputPath
            const slideCount = deckRenderResult.slideCount ?? 0
            console.log('[deck] deckRender succeeded:', {
              deckId,
              outputPath: finalPath,
              slideCount,
              llmCalls: deckRenderResult.llmCalls,
              imageCalls: deckRenderResult.imageCalls,
              tokenCost: deckRenderResult.tokenCost,
            })

            // Load deck slides for preview
            let deckSlidePreviews: PptSlidePreview[] = []
            try {
              const loadResult = await window.electronAPI.deckLoad({ workspacePath: activeWorkspacePath, deckId })
              if (loadResult.success && loadResult.deck) {
                type RawSlide = {
                  index?: number; intent?: string; title?: string; subtitle?: string;
                  heading?: string; body?: string; summary?: string; items?: string[];
                  imagePath?: string | null; imageLoading?: boolean;
                  leftTitle?: string; leftItems?: string[]; rightTitle?: string; rightItems?: string[];
                  metrics?: Array<{ value: string; label: string; detail?: string }>;
                  timeline?: Array<{ title: string; detail?: string }>;
                  notes?: string; speakerNotes?: string;
                }
                const deck = loadResult.deck as { slides?: RawSlide[] }
                deckSlidePreviews = (deck.slides ?? []).map((s, i) => ({
                  index: s.index ?? i,
                  type: intentToSlideType(s.intent ?? 'unknown'),
                  title: s.title,
                  subtitle: s.subtitle,
                  heading: s.heading ?? s.title,
                  body: s.body ?? s.summary,
                  items: s.items,
                  imagePath: s.imagePath ?? null,
                  imageLoading: false,
                  isGenerating: false,
                  leftTitle: s.leftTitle,
                  leftItems: s.leftItems,
                  rightTitle: s.rightTitle,
                  rightItems: s.rightItems,
                  metrics: s.metrics,
                  timeline: s.timeline,
                  notes: s.speakerNotes ?? s.notes,
                }))
              }
            } catch {
              // Preview is optional — don't block completion
            }

            // Request real PPTX PNG previews via PowerPoint COM
            try {
              const previewDir = `${activeWorkspacePath}/05_Presentation/decks/${deckId}/preview/business_report`
              const previewResult = await window.electronAPI.deckPreview({
                pptxPath: finalPath,
                previewDir: previewDir.replace(/\//g, '\\'),
              })
              if (previewResult.success && previewResult.slides && previewResult.slides.length > 0) {
                console.log('[deck] pptxPreview succeeded:', previewResult.slides.length, 'slides')
                // Merge real PNG paths into deckSlidePreviews
                const previewMap = new Map(previewResult.slides.map((ps: { index: number; imagePath: string }) => [ps.index, ps.imagePath]))
                deckSlidePreviews = deckSlidePreviews.map((slide, i) => ({
                  ...slide,
                  imagePath: (previewMap.get(i) as string | undefined) ?? slide.imagePath ?? null,
                }))
                if (deckSlidePreviews.length === 0 && previewResult.slides.length > 0) {
                  // DeckLoad failed but preview succeeded — create slides from preview
                  deckSlidePreviews = previewResult.slides.map((ps: { index: number; imagePath: string }) => ({
                    index: ps.index,
                    type: 'content',
                    title: `第 ${ps.index + 1} 页`,
                    imagePath: ps.imagePath,
                    imageLoading: false,
                    isGenerating: false,
                  }))
                }
              } else if (previewResult.warning) {
                console.warn('[deck] pptxPreview warning:', previewResult.warning)
              }
            } catch (prevErr) {
              console.warn('[deck] pptxPreview exception:', prevErr)
            }

            workbench.setGenerationStatus(
              'completed',
              `PPT 已生成（${slideCount} 页）· 模板：商务汇报`,
            )
            workbench.setModeSession('ppt', (session) => ({
              ...session,
              resultType: 'pptx',
              resultAssetId: finalPath,
              resultPath: finalPath,
              resultTitle: getFileName(finalPath),
              resultPreviewText: '',
              pptContentPackageId: null,
              pptActiveSkillId: 'business_report',
              pptTaskStatus: 'completed',
              pptTotalSlides: slideCount,
              pptDeckDocumentId: deckId,
              pptActiveTemplateManifestId: 'business_report',
              pptLiveSlides: deckSlidePreviews,
              pptActiveSlideIndex: 0,
            }))
            setStatusMessage(`PPT 已生成，${slideCount} 页`)
            return // skip legacy per-slide loop
          }
          console.warn('[deck] deckRender failed, falling back to legacy loop:', deckRenderResult?.error)
        } else {
          console.warn('[deck] deckBuild failed, falling back to legacy loop:', deckBuildResult?.error)
        }

        // Stop check: if stop was pressed during deckBuild/deckRender, don't fallback
        if (pptStopRef.current) {
          workbench.setModeSession('ppt', (s) => ({ ...s, pptTaskStatus: 'stopped' }))
          workbench.setGenerationStatus('completed', '已停止')
          return
        }

        // Stop check: don't fall into legacy loop if user stopped
        if (pptStopRef.current) {
          workbench.setModeSession('ppt', (s) => ({ ...s, pptTaskStatus: 'stopped' }))
          workbench.setGenerationStatus('completed', '已停止')
          return
        }

        // Reset status labels so the legacy path starts cleanly
        workbench.setGenerationStatus('running', '正在规划幻灯片结构...')
        workbench.setModeSession('ppt', (session) => ({
          ...session,
          pptTaskStatus: 'generating_outline',
        }))
      }
      /* ── END OF NEW PRIMARY PATH ── */

      /* ── Phase 1: Generate outline skeleton (title + slide roles/headings only) ── */
      workbench.setGenerationStatus('running', '生成大纲中 · 可能消耗 token')
      let outlineText = ''
      let outlineError = ''
      await runWritingAssistant(
        { instruction: buildPptOutlineInstruction(contextData), language: 'zh', taskId: pptTaskIdRef.current },
        {
          onDelta: (_delta, accumulated) => { outlineText = accumulated },
          onComplete: async (result) => { outlineText = result.text },
          onError: (error) => { outlineError = error },
          onStatus: (msg) => { workbench.setGenerationStatus('running', msg || '正在规划幻灯片结构...') },
        },
        abortCtrl.signal,
      )

      // Stop check takes priority over error check
      if (pptStopRef.current) {
        workbench.setModeSession('ppt', (s) => ({ ...s, pptTaskStatus: 'stopped' }))
        workbench.setGenerationStatus('completed', '已停止 · 大纲阶段')
        return
      }
      if (outlineError && outlineError !== '已停止') throw new Error(outlineError)
      if (!outlineText.trim()) throw new Error('LLM 未返回幻灯片大纲内容，请重试。')

      /* ── Parse outline ── */
      let outline: PptOutline
      try {
        const cleaned = outlineText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
        const parsed = JSON.parse(cleaned)
        outline = {
          title: String(parsed.title || workbench.generationPrompt.slice(0, 60) || '演示文稿'),
          slides: Array.isArray(parsed.slides)
            ? (parsed.slides as Array<Record<string, unknown>>).map((s, i) => ({
                index: i,
                // Accept new 'intent' field or legacy 'role'/'type' field
                role: String(s.intent || s.role || s.type || 'text_content'),
                heading: String(s.heading || s.title || `第 ${i + 1} 页`),
                hint: s.hint ? String(s.hint) : undefined,
              }))
            : [],
        }
      } catch {
        throw new Error('LLM 返回的幻灯片大纲不是合法 JSON，请重试。')
      }
      if (outline.slides.length === 0) throw new Error('大纲为空，请重试。')

      /* ── Push placeholder slides to live preview ── */
      const placeholders = outline.slides.map((s) => ({
        index: s.index,
        type: s.role,
        heading: s.heading,
        isGenerating: false,
        imageLoading: false,
      }))
      workbench.setModeSession('ppt', (session) => ({
        ...session,
        pptLiveSlides: placeholders,
        pptTotalSlides: outline.slides.length,
        pptActiveSlideIndex: 0,
        pptTaskStatus: 'generating_slide',
      }))
      workbench.setGenerationStatus('running', `大纲已规划 ${outline.slides.length} 页，开始逐页生成内容...`)

      /* ── Create initial partial ContentPackage (establishes packageId for incremental saves) ── */
      let packageId: string | null = null
      try {
        const pkgInit = await window.electronAPI.pptxSaveContentPackage({
          workspacePath: activeWorkspacePath,
          pkg: {
            title: outline.title,
            sourcePrompt: workbench.generationPrompt,
            slides: [],
            assets: [],
            outlinePlan: outline.slides,
            expectedSlideCount: outline.slides.length,
            status: 'partial',
          },
        })
        if (pkgInit.success) packageId = pkgInit.packageId ?? null
      } catch { /* best-effort */ }

      /* ── Phase 2: Per-slide content generation loop ── */
      type CompletedSlide = { slideData: Record<string, unknown>; outlineIndex: number }
      const completedSlides: CompletedSlide[] = []

      for (let i = 0; i < outline.slides.length; i++) {
        if (pptStopRef.current) break

        const slideInfo = outline.slides[i]

        // Mark this slide as actively generating
        workbench.setModeSession('ppt', (session) => ({
          ...session,
          pptLiveSlides: session.pptLiveSlides.map((ls, li) =>
            li === i ? { ...ls, isGenerating: true } : ls
          ),
          pptActiveSlideIndex: i,
        }))
        workbench.setGenerationStatus(
          'running',
          `生成内容中 · 可能消耗 token（第 ${i + 1}/${outline.slides.length} 页）`,
        )

        let slideText = ''
        await runWritingAssistant(
          { instruction: buildSlideDetailInstruction(contextData, outline, slideInfo), language: 'zh', taskId: pptTaskIdRef.current },
          {
            onDelta: (_delta, accumulated) => { slideText = accumulated },
            onComplete: async (result) => { slideText = result.text },
            onError: () => { /* silently skip; pptStopRef checked below */ },
            onStatus: () => {},
          },
          abortCtrl.signal,
        )

        if (pptStopRef.current) break

        /* Parse slide detail JSON; fall back to placeholder data on parse error */
        let slideData: Record<string, unknown> = { type: slideInfo.role, heading: slideInfo.heading }
        try {
          const cleaned = slideText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
          if (cleaned) slideData = JSON.parse(cleaned)
        } catch { /* use fallback above */ }

        /* Strip forbidden visual-style fields */
        const { theme: _t, templateId: _tp, color: _c, font: _f, style: _s, imagePath: _ip,
          x: _x, y: _y, w: _w, h: _h, master: _ma, animation: _an, background: _bg, layout: _la,
          pptxConfig: _px, ...cleanSlide } =
          slideData as Record<string, unknown>
        void _t; void _tp; void _c; void _f; void _s; void _ip
        void _x; void _y; void _w; void _h; void _ma; void _an; void _bg; void _la; void _px

        // Resolve slide type: prefer 'intent' (new), then 'type' (legacy), then outline role
        const slideType = String(cleanSlide.intent || cleanSlide.type || slideInfo.role || 'text_content')
        const liveSlide = {
          index: i,
          type: slideType,
          title: cleanSlide.title ? String(cleanSlide.title) : undefined,
          subtitle: cleanSlide.subtitle ? String(cleanSlide.subtitle) : undefined,
          heading: cleanSlide.heading ? String(cleanSlide.heading) : slideInfo.heading,
          body: cleanSlide.body ? String(cleanSlide.body) : undefined,
          items: Array.isArray(cleanSlide.items)
            ? (cleanSlide.items as unknown[]).map(String)
            : undefined,
          metrics: Array.isArray(cleanSlide.metrics)
            ? (cleanSlide.metrics as Array<Record<string, unknown>>).map((m) => ({
                value: String(m.value ?? ''),
                label: String(m.label ?? ''),
                detail: m.detail ? String(m.detail) : undefined,
              }))
            : undefined,
          timeline: Array.isArray(cleanSlide.timeline)
            ? (cleanSlide.timeline as Array<Record<string, unknown>>).map((t) => ({
                title: String(t.title ?? ''),
                detail: t.detail ? String(t.detail) : undefined,
              }))
            : undefined,
          leftTitle: cleanSlide.leftTitle ? String(cleanSlide.leftTitle) : undefined,
          leftItems: Array.isArray(cleanSlide.leftItems)
            ? (cleanSlide.leftItems as unknown[]).map(String)
            : undefined,
          rightTitle: cleanSlide.rightTitle ? String(cleanSlide.rightTitle) : undefined,
          rightItems: Array.isArray(cleanSlide.rightItems)
            ? (cleanSlide.rightItems as unknown[]).map(String)
            : undefined,
          imagePath: null as string | null,
          imageLoading: slideType === 'content',
          isGenerating: false,
          notes: cleanSlide.notes ? String(cleanSlide.notes) : undefined,
        }

        completedSlides.push({ slideData: { index: i, ...cleanSlide, type: slideType }, outlineIndex: i })

        // Replace placeholder with real content in live preview
        workbench.setModeSession('ppt', (session) => ({
          ...session,
          pptLiveSlides: session.pptLiveSlides.map((ls, li) => (li === i ? liveSlide : ls)),
        }))

        // Incremental ContentPackage save (fire-and-forget, best-effort)
        if (packageId) {
          window.electronAPI.pptxSaveContentPackage({
            workspacePath: activeWorkspacePath,
            pkg: {
              id: packageId,
              title: outline.title,
              sourcePrompt: workbench.generationPrompt,
              slides: completedSlides.map(({ slideData: sd }) => sd),
              assets: [],
              outlinePlan: outline.slides,
              status: 'partial',
              expectedSlideCount: outline.slides.length,
              completedSlideCount: completedSlides.length,
            },
          }).catch(() => { /* best-effort */ })
        }
      }

      // Clear any remaining isGenerating flags
      workbench.setModeSession('ppt', (session) => ({
        ...session,
        pptLiveSlides: session.pptLiveSlides.map((s) => ({ ...s, isGenerating: false })),
      }))

      /* ── Handle stop after per-slide loop ── */
      if (pptStopRef.current) {
        if (packageId) {
          await window.electronAPI.pptxSaveContentPackage({
            workspacePath: activeWorkspacePath,
            pkg: {
              id: packageId,
              title: outline.title,
              sourcePrompt: workbench.generationPrompt,
              slides: completedSlides.map(({ slideData: sd }) => sd),
              assets: [],
              outlinePlan: outline.slides,
              status: 'partial',
              expectedSlideCount: outline.slides.length,
              completedSlideCount: completedSlides.length,
              stoppedAt: new Date().toISOString(),
            },
          }).catch(() => {})
        }
        workbench.setModeSession('ppt', (session) => ({
          ...session,
          pptTaskStatus: 'stopped',
          pptContentPackageId: packageId,
        }))
        workbench.setGenerationStatus(
          'completed',
          `已停止 · 已保留 ${completedSlides.length} / ${outline.slides.length} 页`,
        )
        return
      }

      /* ── Resolve images for content slides ── */
      const contentSlidesNeedingImage = completedSlides
        .filter(({ slideData: sd }) => sd.type === 'content' && !sd.imagePath)
        .map(({ slideData: sd, outlineIndex }) => ({ slide: sd, index: outlineIndex }))

      if (contentSlidesNeedingImage.length > 0) {
        const rootPath = knowledge.info?.rootPath?.replace(/[\\/]+$/g, '') || ''
        const allDocuments = knowledge.documents
        const imageDocuments = selectedDocuments.filter((d) => d.sourceType === 'image')
        const usedImageIds = new Set<string>()

        /* ── Phase A: semantic KB image matching (parallel) ── */
        if (knowledge.departmentId && rootPath) {
          workbench.setGenerationStatus('running', '正在为幻灯片匹配知识库图片...')
          const matchResults = await Promise.allSettled(
            contentSlidesNeedingImage.map(({ slide }) => {
              const query = [
                String(slide.heading || ''),
                String(slide.body || ''),
                ...(Array.isArray(slide.items) ? (slide.items as unknown[]).map(String) : []),
              ].filter(Boolean).join(' ').slice(0, 200)
              return window.electronAPI.previewKnowledgeTaskContext(
                effectivePptDepartmentId, { instruction: query, topK: 4 },
              )
            }),
          )
          let kbMatchCount = 0
          for (let i = 0; i < matchResults.length; i++) {
            const r = matchResults[i]
            if (r.status !== 'fulfilled' || !r.value) continue
            const imageHits = (r.value.retrievedHits || [])
              .filter((h: any) => {
                const meta = allDocuments.find((d) => d.id === h?.chunk?.documentId)
                return meta?.sourceType === 'image' && (h.score ?? 0) >= 0.6 && !usedImageIds.has(meta.id)
              })
              .sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0))
            if (imageHits.length > 0) {
              const bestHit = imageHits[0] as any
              const meta = allDocuments.find((d) => d.id === bestHit?.chunk?.documentId)
              if (meta?.storedRelativePath) {
                const resolvedPath = `${rootPath}/${meta.storedRelativePath.replace(/^[\\/]+/g, '')}`
                contentSlidesNeedingImage[i].slide.imagePath = resolvedPath
                usedImageIds.add(meta.id)
                kbMatchCount++
                const slideIdx = contentSlidesNeedingImage[i].index
                workbench.setModeSession('ppt', (session) => ({
                  ...session,
                  pptLiveSlides: session.pptLiveSlides.map((s, si) =>
                    si === slideIdx ? { ...s, imagePath: resolvedPath, imageLoading: false } : s
                  ),
                }))
              }
            }
          }
          if (kbMatchCount > 0) {
            workbench.setGenerationStatus('running', `已为 ${kbMatchCount} 页匹配知识库图片`)
          }
        }

        /* ── Phase B: sequential fallback from user-selected image documents ── */
        const stillNeedImage = contentSlidesNeedingImage.filter(({ slide }) => !slide.imagePath)
        if (stillNeedImage.length > 0 && imageDocuments.length > 0 && rootPath) {
          const remainingImages = imageDocuments.filter((d) => !usedImageIds.has(d.id))
          let imgIdx = 0
          for (const { slide, index: slideIdx } of stillNeedImage) {
            if (imgIdx >= remainingImages.length) break
            const doc = remainingImages[imgIdx]
            const resolvedPath = `${rootPath}/${doc.storedRelativePath.replace(/^[\\/]+/g, '')}`
            slide.imagePath = resolvedPath
            usedImageIds.add(doc.id)
            imgIdx++
            workbench.setModeSession('ppt', (session) => ({
              ...session,
              pptLiveSlides: session.pptLiveSlides.map((s, si) =>
                si === slideIdx ? { ...s, imagePath: resolvedPath, imageLoading: false } : s
              ),
            }))
          }
        }

        /* ── Phase C: AI image generation for remaining slides ── */
        const finalNeedImage = contentSlidesNeedingImage.filter(({ slide }) => !slide.imagePath)
        if (finalNeedImage.length > 0) {
          workbench.setModeSession('ppt', (session) => ({ ...session, pptTaskStatus: 'generating_image' }))
          let aiGenCount = 0
          for (let i = 0; i < finalNeedImage.length; i++) {
            if (pptStopRef.current) {
              workbench.setModeSession('ppt', (session) => ({ ...session, pptTaskStatus: 'stopped' }))
              workbench.setGenerationStatus(
                'completed',
                `已停止 · 已保留 ${completedSlides.length} / ${outline.slides.length} 页`,
              )
              break
            }
            const { slide, index: slideIdx } = finalNeedImage[i]
            workbench.setGenerationStatus(
              'running',
              `生成图片中 · 可能消耗 token（第 ${i + 1}/${finalNeedImage.length} 张）`,
            )
            const prompt = [
              String(slide.heading || ''),
              String(slide.body || ''),
              ...(Array.isArray(slide.items) ? (slide.items as unknown[]).map(String) : []),
            ].filter(Boolean).join(', ')
            if (!prompt.trim()) {
              workbench.setModeSession('ppt', (session) => ({
                ...session,
                pptLiveSlides: session.pptLiveSlides.map((s, si) =>
                  si === slideIdx ? { ...s, imageLoading: false } : s
                ),
              }))
              continue
            }
            try {
              const imgResult = await generateSelectionImage(prompt, '1:1')
              if (imgResult.status === 'success') {
                const localPath = imgResult.file_path || imgResult.image_url || null
                if (localPath) {
                  slide.imagePath = localPath
                  aiGenCount++
                  workbench.setModeSession('ppt', (session) => ({
                    ...session,
                    pptLiveSlides: session.pptLiveSlides.map((s, si) =>
                      si === slideIdx ? { ...s, imagePath: localPath, imageLoading: false } : s
                    ),
                  }))
                } else {
                  workbench.setModeSession('ppt', (session) => ({
                    ...session,
                    pptLiveSlides: session.pptLiveSlides.map((s, si) =>
                      si === slideIdx ? { ...s, imageLoading: false } : s
                    ),
                  }))
                }
              } else {
                workbench.setModeSession('ppt', (session) => ({
                  ...session,
                  pptLiveSlides: session.pptLiveSlides.map((s, si) =>
                    si === slideIdx ? { ...s, imageLoading: false } : s
                  ),
                }))
              }
            } catch {
              workbench.setModeSession('ppt', (session) => ({
                ...session,
                pptLiveSlides: session.pptLiveSlides.map((s, si) =>
                  si === slideIdx ? { ...s, imageLoading: false } : s
                ),
              }))
            }
          }
          if (aiGenCount > 0) {
            workbench.setGenerationStatus('running', `已完成 AI 插图生成（共 ${aiGenCount} 张）`)
          }
        }
      }

      // Final stop check after image phases
      if (pptStopRef.current) {
        workbench.setModeSession('ppt', (session) => ({
          ...session,
          pptTaskStatus: 'stopped',
          pptContentPackageId: packageId,
        }))
        workbench.setGenerationStatus(
          'completed',
          `已停止 · 已保留 ${completedSlides.length} / ${outline.slides.length} 页`,
        )
        return
      }

      /* ── Save final ContentPackage (content-only, no template/theme) ── */
      workbench.setGenerationStatus('running', '正在保存内容包...')

      const contentAssets = completedSlides
        .map(({ slideData: sd, outlineIndex }) =>
          sd.imagePath ? { slideIndex: outlineIndex, imagePath: String(sd.imagePath) } : null
        )
        .filter(Boolean) as Array<{ slideIndex: number; imagePath: string }>

      const finalPkgSave = await window.electronAPI.pptxSaveContentPackage({
        workspacePath: activeWorkspacePath,
        pkg: {
          ...(packageId ? { id: packageId } : {}),
          title: outline.title,
          sourcePrompt: workbench.generationPrompt,
          slides: completedSlides.map(({ slideData: sd }) => sd),
          assets: contentAssets,
        },
      })
      const contentPackageId = finalPkgSave.success ? (finalPkgSave.packageId ?? packageId) : packageId

      /* ── Render PPTX with default skill (NO LLM) ── */
      workbench.setGenerationStatus('running', '应用模板中 · 不消耗 token')
      workbench.setModeSession('ppt', (session) => ({ ...session, pptTaskStatus: 'rendering_pptx' }))
      const fileName = `${sanitizeFileStem(workbench.generationPrompt, '演示文稿')}-${buildTimestampStamp()}.pptx`
      const outputDir = `${activeWorkspacePath.replace(/[\\/]+$/g, '')}/05_Presentation`
      const outputPath = `${outputDir}/${fileName}`

      let result: { success: boolean; outputPath: string; slideCount: number; error?: string }
      if (contentPackageId) {
        const rendered = await window.electronAPI.pptxRenderWithSkill({
          workspacePath: activeWorkspacePath,
          contentPackageId,
          skillId: 'cuhk_sz_default',
          outputPath,
        })
        result = {
          success: Boolean(rendered.success),
          outputPath: rendered.outputPath || outputPath,
          slideCount: rendered.slideCount || 0,
          error: rendered.error,
        }
      } else {
        // Fallback: use legacy generatePptx if content package save failed
        result = await window.electronAPI.generatePptx({
          plan: { title: outline.title, slides: completedSlides.map(({ slideData: sd }) => sd) },
          outputPath,
        })
      }

      if (!result.success) throw new Error(result.error || 'PPT 生成失败')

      /* ── NEW: Assemble DeckDocument in parallel with legacy ContentPackage ── */
      // This path is additive — the old PPTX is already generated above.
      // Any failure here logs a warning but never blocks the user.
      let pptDeckDocumentId: string | null = null
      try {
        console.log('[deck] generate_deck_document_started', { slideCount: completedSlides.length })
        const imageAssetsForDeck = completedSlides
          .filter(({ slideData: sd }) => !!sd.imagePath)
          .map(({ slideData: sd, outlineIndex }) => ({
            slideIndex: outlineIndex,
            imagePath: String(sd.imagePath),
          }))

        const rawDeck = assembleDeckDocument({
          outlineTitle: outline.title,
          completedSlides: completedSlides.map(({ slideData: sd, outlineIndex }) => ({
            slideData: sd,
            outlineIndex,
          })),
          outlinePlan: outline.slides,
          sourcePrompt: workbench.generationPrompt,
          imageAssets: imageAssetsForDeck,
        })

        const validationResult = validateDeckDocumentOutput(rawDeck)
        if (validationResult.warnings.length > 0) {
          console.warn('[deck] deck_validation_warnings', validationResult.warnings)
        }
        if (!validationResult.valid || !validationResult.deck) {
          console.warn('[deck] deck_assemble_failed', {
            errors: validationResult.errors,
            fallback_to_legacy_pptx: true,
          })
        } else {
          const validDeck = validationResult.deck
          console.log('[deck] generate_deck_document_completed', {
            deckId: validDeck.deckId,
            slideCount: validDeck.slides.length,
            assetCount: validDeck.assets.length,
          })

          // Save deck.json
          const saveResult = await window.electronAPI.deckSave({
            workspacePath: activeWorkspacePath,
            deck: validDeck as unknown,
          })
          if (!saveResult.success) {
            console.warn('[deck] deck_save_failed', { error: saveResult.error, fallback_to_legacy_pptx: true })
          } else {
            pptDeckDocumentId = validDeck.deckId

            // Render with default template (no LLM, no image calls)
            console.log('[deck] deck_render_started', { deckId: validDeck.deckId, manifestId: 'business_report' })
            const deckRenderResult = await window.electronAPI.deckRender({
              workspacePath: activeWorkspacePath,
              deckId: validDeck.deckId,
              manifestId: 'business_report',
            })
            if (!deckRenderResult.success) {
              console.warn('[deck] deck_render_failed', {
                error: deckRenderResult.error,
                fallback_to_legacy_pptx: true,
              })
            } else {
              console.log('[deck] deck_render_completed', {
                deckId: validDeck.deckId,
                outputPath: deckRenderResult.outputPath,
                slideCount: deckRenderResult.slideCount,
                llmCalls: deckRenderResult.llmCalls,
                imageCalls: deckRenderResult.imageCalls,
                tokenCost: deckRenderResult.tokenCost,
              })
            }
          }
        }
      } catch (deckErr) {
        console.warn('[deck] deck_assemble_failed (exception)', {
          error: deckErr instanceof Error ? deckErr.message : String(deckErr),
          fallback_to_legacy_pptx: true,
        })
      }

      workbench.setGenerationStatus('completed', `PPT 已生成（${result.slideCount} 页），可在右侧打开或下载。`)
      workbench.setModeSession('ppt', (session) => ({
        ...session,
        resultType: 'pptx',
        resultAssetId: result.outputPath,
        resultPath: result.outputPath,
        resultTitle: fileName,
        resultPreviewText: JSON.stringify({ title: outline.title, slides: outline.slides }),
        pptContentPackageId: contentPackageId,
        pptActiveSkillId: 'business_report',
        pptTaskStatus: 'completed',
        pptTotalSlides: completedSlides.length,
        pptDeckDocumentId: pptDeckDocumentId,
        pptActiveTemplateManifestId: pptDeckDocumentId ? 'business_report' : null,
      }))
      setStatusMessage(`PPT 已生成：${fileName}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PPT 生成失败'
      workbench.setGenerationStatus('error', message)
      workbench.setModeSession('ppt', (session) => ({
        ...session,
        pptTaskStatus: 'failed',
      }))
      setStatusMessage(message)
    } finally {
      abortControllerRef.current = null
      pptRunningRef.current = false
      setSubmitting(false)
    }
  }

  const handleResumePptGeneration = async () => {
    if (pptRunningRef.current) return
    if (!activeWorkspacePath) {
      workbench.setGenerationStatus('error', '请先打开工作区。')
      return
    }
    const packageId = workbench.sessions.ppt.pptContentPackageId
    if (!packageId) {
      workbench.setGenerationStatus('error', '没有可继续的内容包，请重新生成。')
      return
    }

    pptRunningRef.current = true
    pptStopRef.current = false
    const abortCtrl = new AbortController()
    abortControllerRef.current = abortCtrl
    pptTaskIdRef.current = `ppt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

    setSubmitting(true)
    workbench.setGenerationStatus('running', '加载已保存内容包...')

    try {
      const loadResult = await window.electronAPI.pptxLoadContentPackage({
        workspacePath: activeWorkspacePath,
        packageId,
      }) as { success: boolean; pkg?: Record<string, unknown>; error?: string }

      if (!loadResult?.success || !loadResult.pkg) {
        throw new Error('内容包加载失败，请重新生成。')
      }

      type SavedPkg = {
        title: string
        sourcePrompt: string
        slides: Array<Record<string, unknown>>
        expectedSlideCount: number
        completedSlideCount: number
        outlinePlan?: Array<{ index: number; role: string; heading: string; hint?: string }>
      }
      const existingPkg = loadResult.pkg as SavedPkg

      if (!existingPkg.outlinePlan || existingPkg.outlinePlan.length === 0) {
        throw new Error('内容包中没有大纲信息，无法继续生成。请重新生成。')
      }

      const outline: PptOutline = {
        title: existingPkg.title,
        slides: existingPkg.outlinePlan,
      }

      const resumeFromIndex = Math.max(0, existingPkg.completedSlideCount)
      if (resumeFromIndex >= outline.slides.length) {
        workbench.setModeSession('ppt', (s) => ({
          ...s, pptResumeRequested: false, pptIsResuming: false, pptTaskStatus: 'completed',
        }))
        return
      }

      // Build live slides from existing completed slides
      const existingLiveSlides: PptSlidePreview[] = existingPkg.slides.map((sd, i) => ({
        index: i,
        type: String(sd.type || 'content'),
        title: sd.title ? String(sd.title) : undefined,
        subtitle: sd.subtitle ? String(sd.subtitle) : undefined,
        heading: sd.heading ? String(sd.heading) : (outline.slides[i]?.heading ?? ''),
        body: sd.body ? String(sd.body) : undefined,
        items: Array.isArray(sd.items) ? (sd.items as unknown[]).map(String) : undefined,
        metrics: Array.isArray(sd.metrics)
          ? (sd.metrics as Array<Record<string, unknown>>).map((m) => ({
              value: String(m.value ?? ''), label: String(m.label ?? ''),
              detail: m.detail ? String(m.detail) : undefined,
            }))
          : undefined,
        timeline: Array.isArray(sd.timeline)
          ? (sd.timeline as Array<Record<string, unknown>>).map((t) => ({
              title: String(t.title ?? ''),
              detail: t.detail ? String(t.detail) : undefined,
            }))
          : undefined,
        leftTitle: sd.leftTitle ? String(sd.leftTitle) : undefined,
        leftItems: Array.isArray(sd.leftItems) ? (sd.leftItems as unknown[]).map(String) : undefined,
        rightTitle: sd.rightTitle ? String(sd.rightTitle) : undefined,
        rightItems: Array.isArray(sd.rightItems) ? (sd.rightItems as unknown[]).map(String) : undefined,
        imagePath: sd.imagePath ? String(sd.imagePath) : null,
        imageLoading: false,
        isGenerating: false,
        notes: sd.notes ? String(sd.notes) : undefined,
      }))

      // Placeholder slides for not-yet-generated slides
      const remainingPlaceholders = outline.slides.slice(resumeFromIndex).map((s) => ({
        index: s.index, type: s.role, heading: s.heading, isGenerating: false, imageLoading: false,
      }))

      workbench.setModeSession('ppt', (session) => ({
        ...session,
        pptTaskStatus: 'generating_slide',
        pptLiveSlides: [...existingLiveSlides, ...remainingPlaceholders],
        pptTotalSlides: outline.slides.length,
        pptActiveSlideIndex: resumeFromIndex,
        pptStopRequested: false,
        pptResumeRequested: false,
        pptIsResuming: true,
      }))
      workbench.setGenerationStatus('running', `正在继续生成 · 从第 ${resumeFromIndex + 1} 页开始...`)

      const contextData = await fetchPptContextData(
        effectivePptDepartmentId,
        existingPkg.sourcePrompt || workbench.generationPrompt.trim(),
        selectedDocuments,
        workbench.primaryAssetId,
        pptPrimarySource,
      )

      if (pptStopRef.current) {
        workbench.setModeSession('ppt', (s) => ({ ...s, pptTaskStatus: 'stopped', pptIsResuming: false }))
        workbench.setGenerationStatus('completed', '已停止')
        return
      }

      // All slides accumulator: existing + newly generated
      type CompletedSlide = { slideData: Record<string, unknown>; outlineIndex: number }
      const allCompletedSlides: CompletedSlide[] = existingPkg.slides.map((sd, i) => ({
        slideData: { ...sd, index: i }, outlineIndex: i,
      }))

      for (let i = resumeFromIndex; i < outline.slides.length; i++) {
        if (pptStopRef.current) break

        const slideInfo = outline.slides[i]
        workbench.setModeSession('ppt', (session) => ({
          ...session,
          pptLiveSlides: session.pptLiveSlides.map((ls, li) => li === i ? { ...ls, isGenerating: true } : ls),
          pptActiveSlideIndex: i,
        }))
        workbench.setGenerationStatus('running', `正在继续生成 · 已生成 ${i} / ${outline.slides.length} 页`)

        let slideText = ''
        await runWritingAssistant(
          { instruction: buildSlideDetailInstruction(contextData, outline, slideInfo), language: 'zh', taskId: pptTaskIdRef.current },
          {
            onDelta: (_delta, accumulated) => { slideText = accumulated },
            onComplete: async (result) => { slideText = result.text },
            onError: () => {},
            onStatus: () => {},
          },
          abortCtrl.signal,
        )

        if (pptStopRef.current) break

        let slideData: Record<string, unknown> = { type: slideInfo.role, heading: slideInfo.heading }
        try {
          const cleaned = slideText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
          if (cleaned) slideData = JSON.parse(cleaned)
        } catch { /* use fallback */ }

        const { theme: _t, templateId: _tp, color: _c, font: _f, style: _s, imagePath: _ip, ...cleanSlide } =
          slideData as Record<string, unknown>
        void _t; void _tp; void _c; void _f; void _s; void _ip

        const slideType = String(cleanSlide.type || slideInfo.role || 'content')
        const liveSlide: PptSlidePreview = {
          index: i,
          type: slideType,
          title: cleanSlide.title ? String(cleanSlide.title) : undefined,
          subtitle: cleanSlide.subtitle ? String(cleanSlide.subtitle) : undefined,
          heading: cleanSlide.heading ? String(cleanSlide.heading) : slideInfo.heading,
          body: cleanSlide.body ? String(cleanSlide.body) : undefined,
          items: Array.isArray(cleanSlide.items) ? (cleanSlide.items as unknown[]).map(String) : undefined,
          metrics: Array.isArray(cleanSlide.metrics)
            ? (cleanSlide.metrics as Array<Record<string, unknown>>).map((m) => ({
                value: String(m.value ?? ''), label: String(m.label ?? ''),
                detail: m.detail ? String(m.detail) : undefined,
              }))
            : undefined,
          timeline: Array.isArray(cleanSlide.timeline)
            ? (cleanSlide.timeline as Array<Record<string, unknown>>).map((t) => ({
                title: String(t.title ?? ''),
                detail: t.detail ? String(t.detail) : undefined,
              }))
            : undefined,
          leftTitle: cleanSlide.leftTitle ? String(cleanSlide.leftTitle) : undefined,
          leftItems: Array.isArray(cleanSlide.leftItems) ? (cleanSlide.leftItems as unknown[]).map(String) : undefined,
          rightTitle: cleanSlide.rightTitle ? String(cleanSlide.rightTitle) : undefined,
          rightItems: Array.isArray(cleanSlide.rightItems) ? (cleanSlide.rightItems as unknown[]).map(String) : undefined,
          imagePath: null,
          imageLoading: slideType === 'content',
          isGenerating: false,
          notes: cleanSlide.notes ? String(cleanSlide.notes) : undefined,
        }

        allCompletedSlides.push({ slideData: { index: i, ...cleanSlide, type: slideType }, outlineIndex: i })
        workbench.setModeSession('ppt', (session) => ({
          ...session,
          pptLiveSlides: session.pptLiveSlides.map((ls, li) => li === i ? liveSlide : ls),
        }))

        window.electronAPI.pptxSaveContentPackage({
          workspacePath: activeWorkspacePath,
          pkg: {
            id: packageId,
            title: outline.title,
            sourcePrompt: existingPkg.sourcePrompt || workbench.generationPrompt,
            slides: allCompletedSlides.map(({ slideData: sd }) => sd),
            assets: [],
            outlinePlan: outline.slides,
            status: 'partial',
            expectedSlideCount: outline.slides.length,
            completedSlideCount: allCompletedSlides.length,
          },
        }).catch(() => {})
      }

      workbench.setModeSession('ppt', (session) => ({
        ...session,
        pptLiveSlides: session.pptLiveSlides.map((s) => ({ ...s, isGenerating: false })),
      }))

      if (pptStopRef.current) {
        await window.electronAPI.pptxSaveContentPackage({
          workspacePath: activeWorkspacePath,
          pkg: {
            id: packageId,
            title: outline.title,
            sourcePrompt: existingPkg.sourcePrompt || workbench.generationPrompt,
            slides: allCompletedSlides.map(({ slideData: sd }) => sd),
            assets: [],
            outlinePlan: outline.slides,
            status: 'partial',
            expectedSlideCount: outline.slides.length,
            completedSlideCount: allCompletedSlides.length,
            stoppedAt: new Date().toISOString(),
          },
        }).catch(() => {})
        workbench.setModeSession('ppt', (session) => ({
          ...session,
          pptTaskStatus: 'stopped',
          pptIsResuming: false,
          pptContentPackageId: packageId,
        }))
        workbench.setGenerationStatus('completed', `已停止 · 已保留 ${allCompletedSlides.length} / ${outline.slides.length} 页`)
        return
      }

      /* ── Image generation for newly generated content slides ── */
      const newSlidesNeedingImage = allCompletedSlides
        .filter(({ slideData: sd, outlineIndex }) => outlineIndex >= resumeFromIndex && sd.type === 'content' && !sd.imagePath)
        .map(({ slideData: sd, outlineIndex }) => ({ slide: sd, index: outlineIndex }))

      if (newSlidesNeedingImage.length > 0) {
        const rootPath = knowledge.info?.rootPath?.replace(/[\\/]+$/g, '') || ''
        const allDocuments = knowledge.documents
        const imageDocuments = selectedDocuments.filter((d) => d.sourceType === 'image')
        const usedImageIds = new Set<string>()

        if (knowledge.departmentId && rootPath) {
          workbench.setGenerationStatus('running', '正在为新生成幻灯片匹配知识库图片...')
          const matchResults = await Promise.allSettled(
            newSlidesNeedingImage.map(({ slide }) => {
              const query = [
                String(slide.heading || ''), String(slide.body || ''),
                ...(Array.isArray(slide.items) ? (slide.items as unknown[]).map(String) : []),
              ].filter(Boolean).join(' ').slice(0, 200)
              return window.electronAPI.previewKnowledgeTaskContext(effectivePptDepartmentId, { instruction: query, topK: 4 })
            }),
          )
          for (let i = 0; i < matchResults.length; i++) {
            const r = matchResults[i]
            if (r.status !== 'fulfilled' || !r.value) continue
            const imageHits = (r.value.retrievedHits || [])
              .filter((h: any) => {
                const meta = allDocuments.find((d) => d.id === h?.chunk?.documentId)
                return meta?.sourceType === 'image' && (h.score ?? 0) >= 0.6 && !usedImageIds.has(meta.id)
              })
              .sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0))
            if (imageHits.length > 0) {
              const bestHit = imageHits[0] as any
              const meta = allDocuments.find((d) => d.id === bestHit?.chunk?.documentId)
              if (meta?.storedRelativePath) {
                const resolvedPath = `${rootPath}/${meta.storedRelativePath.replace(/^[\\/]+/g, '')}`
                newSlidesNeedingImage[i].slide.imagePath = resolvedPath
                usedImageIds.add(meta.id)
                const slideIdx = newSlidesNeedingImage[i].index
                workbench.setModeSession('ppt', (session) => ({
                  ...session,
                  pptLiveSlides: session.pptLiveSlides.map((s, si) =>
                    si === slideIdx ? { ...s, imagePath: resolvedPath, imageLoading: false } : s
                  ),
                }))
              }
            }
          }
        }

        const stillNeedImage = newSlidesNeedingImage.filter(({ slide }) => !slide.imagePath)
        if (stillNeedImage.length > 0 && imageDocuments.length > 0 && rootPath) {
          const remainingImages = imageDocuments.filter((d) => !usedImageIds.has(d.id))
          let imgIdx = 0
          for (const { slide, index: slideIdx } of stillNeedImage) {
            if (imgIdx >= remainingImages.length) break
            const doc = remainingImages[imgIdx]
            const resolvedPath = `${rootPath}/${doc.storedRelativePath.replace(/^[\\/]+/g, '')}`
            slide.imagePath = resolvedPath
            usedImageIds.add(doc.id)
            imgIdx++
            workbench.setModeSession('ppt', (session) => ({
              ...session,
              pptLiveSlides: session.pptLiveSlides.map((s, si) =>
                si === slideIdx ? { ...s, imagePath: resolvedPath, imageLoading: false } : s
              ),
            }))
          }
        }

        const finalNeedImage = newSlidesNeedingImage.filter(({ slide }) => !slide.imagePath)
        if (finalNeedImage.length > 0) {
          workbench.setModeSession('ppt', (session) => ({ ...session, pptTaskStatus: 'generating_image' }))
          for (let i = 0; i < finalNeedImage.length; i++) {
            if (pptStopRef.current) break
            const { slide, index: slideIdx } = finalNeedImage[i]
            workbench.setGenerationStatus('running', `生成图片中 · 可能消耗 token（第 ${i + 1}/${finalNeedImage.length} 张）`)
            const prompt = [
              String(slide.heading || ''), String(slide.body || ''),
              ...(Array.isArray(slide.items) ? (slide.items as unknown[]).map(String) : []),
            ].filter(Boolean).join(', ')
            if (!prompt.trim()) {
              workbench.setModeSession('ppt', (session) => ({
                ...session,
                pptLiveSlides: session.pptLiveSlides.map((s, si) => si === slideIdx ? { ...s, imageLoading: false } : s),
              }))
              continue
            }
            try {
              const imgResult = await generateSelectionImage(prompt, '1:1')
              if (imgResult.status === 'success') {
                const localPath = imgResult.file_path || imgResult.image_url || null
                if (localPath) {
                  slide.imagePath = localPath
                  workbench.setModeSession('ppt', (session) => ({
                    ...session,
                    pptLiveSlides: session.pptLiveSlides.map((s, si) =>
                      si === slideIdx ? { ...s, imagePath: localPath, imageLoading: false } : s
                    ),
                  }))
                } else {
                  workbench.setModeSession('ppt', (session) => ({
                    ...session,
                    pptLiveSlides: session.pptLiveSlides.map((s, si) => si === slideIdx ? { ...s, imageLoading: false } : s),
                  }))
                }
              } else {
                workbench.setModeSession('ppt', (session) => ({
                  ...session,
                  pptLiveSlides: session.pptLiveSlides.map((s, si) => si === slideIdx ? { ...s, imageLoading: false } : s),
                }))
              }
            } catch {
              workbench.setModeSession('ppt', (session) => ({
                ...session,
                pptLiveSlides: session.pptLiveSlides.map((s, si) => si === slideIdx ? { ...s, imageLoading: false } : s),
              }))
            }
          }
        }
      }

      if (pptStopRef.current) {
        workbench.setModeSession('ppt', (session) => ({
          ...session,
          pptTaskStatus: 'stopped',
          pptIsResuming: false,
          pptContentPackageId: packageId,
        }))
        workbench.setGenerationStatus('completed', `已停止 · 已保留 ${allCompletedSlides.length} / ${outline.slides.length} 页`)
        return
      }

      /* ── Final save as completed ── */
      workbench.setGenerationStatus('running', '正在保存内容包...')
      workbench.setModeSession('ppt', (session) => ({ ...session, pptTaskStatus: 'rendering_preview' }))

      const contentAssets = allCompletedSlides
        .map(({ slideData: sd, outlineIndex }) =>
          sd.imagePath ? { slideIndex: outlineIndex, imagePath: String(sd.imagePath) } : null
        )
        .filter(Boolean) as Array<{ slideIndex: number; imagePath: string }>

      await window.electronAPI.pptxSaveContentPackage({
        workspacePath: activeWorkspacePath,
        pkg: {
          id: packageId,
          title: outline.title,
          sourcePrompt: existingPkg.sourcePrompt || workbench.generationPrompt,
          slides: allCompletedSlides.map(({ slideData: sd }) => sd),
          assets: contentAssets,
          outlinePlan: outline.slides,
          status: 'completed',
          expectedSlideCount: outline.slides.length,
          completedSlideCount: allCompletedSlides.length,
        },
      })

      /* ── Render PPTX ── */
      workbench.setGenerationStatus('running', '应用模板中 · 不消耗 token')
      const skillId = workbench.sessions.ppt.pptActiveSkillId || 'cuhk_sz_default'
      const fileName = `${sanitizeFileStem(outline.title, '演示文稿')}-${buildTimestampStamp()}.pptx`
      const outputPath = `${activeWorkspacePath.replace(/[\\/]+$/g, '')}/05_Presentation/${fileName}`

      const rendered = await window.electronAPI.pptxRenderWithSkill({
        workspacePath: activeWorkspacePath,
        contentPackageId: packageId,
        skillId,
        outputPath,
      })

      if (!rendered.success) throw new Error(rendered.error || '渲染失败')

      workbench.setGenerationStatus('completed', `PPT 已生成（${rendered.slideCount} 页），可在右侧打开或下载。`)
      workbench.setModeSession('ppt', (session) => ({
        ...session,
        resultType: 'pptx',
        resultAssetId: rendered.outputPath || outputPath,
        resultPath: rendered.outputPath || outputPath,
        resultTitle: fileName,
        pptContentPackageId: packageId,
        pptActiveSkillId: skillId,
        pptTaskStatus: 'completed',
        pptTotalSlides: allCompletedSlides.length,
        pptIsResuming: false,
      }))
      setStatusMessage(`PPT 已生成：${fileName}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PPT 继续生成失败'
      workbench.setGenerationStatus('error', message)
      workbench.setModeSession('ppt', (session) => ({
        ...session,
        pptTaskStatus: 'failed',
        pptIsResuming: false,
      }))
      setStatusMessage(message)
    } finally {
      abortControllerRef.current = null
      pptRunningRef.current = false
      setSubmitting(false)
    }
  }

  useEffect(() => {
    if (currentMode !== 'ppt') return
    if (!pptResumeRequested) return
    if (pptRunningRef.current) return
    void handleResumePptGeneration()
  }, [currentMode, pptResumeRequested])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (currentMode !== 'ppt') return
    if (!pendingPptAutoSubmitToken || effectiveBusy) return
    if (pptRunningRef.current) return
    if (lastConsumedPptTokenRef.current === pendingPptAutoSubmitToken) return
    if (!workbench.generationPrompt.trim()) {
      workbench.setModeSession('ppt', (session) => ({
        ...session,
        pendingAutoSubmitToken: null,
        pendingAutoSubmitTargetAssetId: null,
      }))
      return
    }
    if (pendingPptAutoSubmitTargetAssetId && !selectedDocuments.some((document) => document.id === pendingPptAutoSubmitTargetAssetId)) {
      return
    }

    lastConsumedPptTokenRef.current = pendingPptAutoSubmitToken
    workbench.setModeSession('ppt', (session) => ({
      ...session,
      pendingAutoSubmitToken: null,
      pendingAutoSubmitTargetAssetId: null,
    }))
    void handleGeneratePpt({ fromManuscriptAutoSubmit: true })
  }, [
    currentMode,
    effectiveBusy,
    handleGeneratePpt,
    pendingPptAutoSubmitTargetAssetId,
    pendingPptAutoSubmitToken,
    pptPrimarySource,
    selectedDocuments,
    workbench,
  ])

  const handleSubmit = async () => {
    if (!workbench.generationPrompt.trim() || effectiveBusy) return
    if (currentMode === 'image' || isExplicitImageGenerationRequest(workbench.generationPrompt)) {
      await handleGenerateImage({
        prompt: workbench.generationPrompt.trim(),
        forceEnterImageMode: currentMode !== 'image',
        source: currentMode === 'image'
          ? 'GenerationPromptComposer.handleGenerateImage'
          : `GenerationPromptComposer.handleSubmit.${currentMode}.imageIntent`,
      })
      return
    }
    if (currentMode === 'document') {
      await handleGenerateDocument()
      return
    }
    if (currentMode === 'ppt') {
      await handleGeneratePpt()
      return
    }
    await handleGenerateDocument()
  }

  const stopVoiceInput = async (reason?: string) => {
    voiceStopRequestedRef.current = true
    const activeSession = voiceSessionRef.current
    voiceSessionRef.current = null
    setVoiceListening(false)
    if (reason) setStatusMessage(reason)
    await activeSession?.stop().catch(() => undefined)
  }

  const handleVoiceInputToggle = async () => {
    if (effectiveBusy && !voiceListening) return
    if (voiceListening) {
      await stopVoiceInput('已停止语音输入')
      return
    }
    if (!voiceSupported) {
      setStatusMessage('当前环境不支持语音输入，请改用键盘输入')
      return
    }
    try {
      voiceStopRequestedRef.current = false
      voiceBaseInputRef.current = workbench.generationPrompt
      setStatusMessage('正在启动语音输入...')
      const session = await startChineseVoskVoiceInput({
        onPartialText: (partialText) => {
          const base = voiceBaseInputRef.current
          const merged = partialText
            ? (base.trim() ? `${base}\n${partialText.trim()}` : partialText.trim())
            : base
          workbench.setGenerationPrompt(merged)
        },
        onFinalText: (finalText) => {
          const base = voiceBaseInputRef.current
          const merged = finalText
            ? (base.trim() ? `${base}\n${finalText.trim()}` : finalText.trim())
            : base
          if (finalText) voiceBaseInputRef.current = merged
          workbench.setGenerationPrompt(merged)
        },
        onError: (message) => {
          void stopVoiceInput(message || '语音输入失败，请稍后重试')
        },
        onStatusChange: (message) => {
          setStatusMessage(message)
        },
      })
      voiceSessionRef.current = session
      setVoiceListening(true)
      setStatusMessage('语音输入中，请说出您的需求')
    } catch (error) {
      const message = error instanceof Error && error.message.trim()
        ? error.message.trim()
        : '启动语音输入失败，请稍后重试'
      setStatusMessage(message)
      setVoiceListening(false)
      voiceSessionRef.current = null
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    if (voiceListening) void stopVoiceInput()
    void handleSubmit()
  }

  return (
    <UnifiedGenerationDockWrap data-testid="generation-prompt-composer">
      <UnifiedComposerShell>
        <UnifiedComposerTextarea
          value={workbench.generationPrompt}
          onChange={(event) => workbench.setGenerationPrompt(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={currentMode === 'document' ? FORMAL_TEMPLATE_COMPOSER_PLACEHOLDER : modeOption.composerPlaceholder}
          disabled={effectiveBusy}
        />
        {imageComposerAssist ? <UnifiedComposerAssist>{imageComposerAssist}</UnifiedComposerAssist> : null}
        <UnifiedComposerActionRow
          capabilities={composerCapabilities}
          sendLabel={`生成${modeOption.label}`}
          sendDisabled={!workbench.generationPrompt.trim() || effectiveBusy}
          onSend={() => {
            if (voiceListening) void stopVoiceInput()
            void handleSubmit()
          }}
          leftActions={(
            <>
              <UnifiedGhostButton type="button" onClick={() => workbench.setGenerationPrompt('')} disabled={effectiveBusy || !workbench.generationPrompt}>
                <RefreshCw size={14} /> 清空输入
              </UnifiedGhostButton>
              <UnifiedGhostButton type="button" onClick={handleClearResult} disabled={effectiveBusy || !hasCurrentResult}>
                清空结果
              </UnifiedGhostButton>
            </>
          )}
          rightActions={(
            <UnifiedVoiceButton
              type="button"
              $active={voiceListening}
              onClick={() => { void handleVoiceInputToggle() }}
              disabled={effectiveBusy && !voiceListening}
              title={voiceSupported ? (voiceListening ? '停止语音输入' : '开启语音输入') : '当前环境不支持语音输入'}
            >
              <Mic size={16} />
            </UnifiedVoiceButton>
          )}
        />
        <UnifiedComposerStatusRow>
          <UnifiedComposerStatusPill $tone={effectiveBusy ? 'running' : 'idle'}>
            {currentMode === 'image' ? '图片生成' : currentMode === 'ppt' ? 'PPT 生成' : modeOption.label}
          </UnifiedComposerStatusPill>
          <UnifiedComposerStatusText>{modeStatus}</UnifiedComposerStatusText>
          <UnifiedComposerStatusText>{voiceListening ? '语音输入中…' : 'Enter 发送，Shift+Enter 换行'}</UnifiedComposerStatusText>
          {currentMode === 'ppt' && false && pptTemplates.length > 1 && (
            <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: '#627385' }}>
              模板：
              <select
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                disabled={effectiveBusy}
                style={{ fontSize: 14, padding: '2px 6px', borderRadius: 4, border: '1px solid #c8d6e5', background: '#fff', color: '#2d3a4a' }}
              >
                {pptTemplates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </span>
          )}
        </UnifiedComposerStatusRow>
      </UnifiedComposerShell>
    </UnifiedGenerationDockWrap>
  )
}
