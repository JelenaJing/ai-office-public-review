import { detectSectionType, type ArticleSection } from '../../../services/ArticleClassificationService'

export interface StructuredRemakeContext {
  articleType?: string | null
  articleTypeLabel?: string
  sectionType: string
  sectionTitle: string
  previousSectionTitle?: string
  nextSectionTitle?: string
  sourceLabel: string
  promptContext: string
  unsupportedReason?: string
}

export interface StructuredRemakeBlock {
  id?: string
  type: 'paragraph' | 'heading'
  text: string
  level?: number
  paragraphStyle?: string
}

interface ResolvedSectionMeta {
  sectionType: string
  sectionTitle: string
  previousSectionTitle?: string
  nextSectionTitle?: string
}

interface HeadingSection {
  title: string
  type: string
  startIndex: number
}

const ARTICLE_TYPE_LABELS: Record<string, string> = {
  review: '综述论文',
  research: '研究论文',
  thesis_research: '学位论文',
}

function normalizeSectionKey(value: string | undefined | null): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '_')
}

function resolveArticleTypeLabel(articleType: string | null | undefined): string {
  return ARTICLE_TYPE_LABELS[String(articleType || '').trim()] || '学术论文'
}

function guessSectionType(title: string | undefined): string {
  const normalized = normalizeSectionKey(title)
  if (!normalized) return ''
  if (/(^|_)(title|标题)($|_)/.test(normalized)) return 'title'
  if (/(^|_)(abstract|摘要)($|_)/.test(normalized)) return 'abstract'
  if (/(^|_)(keywords|keyword|关键词|关键字)($|_)/.test(normalized)) return 'keywords'
  if (/(^|_)(introduction|intro|引言|前言|绪论)($|_)/.test(normalized)) return 'introduction'
  if (/(^|_)(related_work|related|background|literature_review|研究背景|相关研究|相关工作|文献综述|研究现状|研究脉络)($|_)/.test(normalized)) return 'related_work'
  if (/(^|_)(method|methods|materials|experimental_setup|experiment|research_design|methodology|方法|实验设备|实验方法|材料与方法|研究设计)($|_)/.test(normalized)) return 'methods'
  if (/(^|_)(result|results|analysis|findings|结果|结果分析|实验结果|性能分析|数据分析)($|_)/.test(normalized)) return 'results'
  if (/(^|_)(discussion|讨论|机理分析|理论分析)($|_)/.test(normalized)) return 'discussion'
  if (/(^|_)(conclusion|结论|总结|总结与展望)($|_)/.test(normalized)) return 'conclusion'
  if (/(^|_)(reference|references|bibliography|参考文献)($|_)/.test(normalized)) return 'references'
  if (/(^|_)(footnote|footnotes|notes|注释|脚注)($|_)/.test(normalized)) return 'footnotes'
  return normalized
}

function humanizeSectionTitle(sectionType: string, sectionTitle: string): string {
  if (sectionTitle) return sectionTitle
  if (sectionType === 'abstract') return '摘要'
  if (sectionType === 'keywords') return '关键词'
  if (sectionType === 'introduction') return '引言'
  if (sectionType === 'related_work') return '相关研究'
  if (sectionType === 'methods') return '方法与设计'
  if (sectionType === 'results') return '结果与分析'
  if (sectionType === 'discussion') return '讨论'
  if (sectionType === 'conclusion') return '结论'
  if (sectionType === 'references') return '参考文献'
  if (sectionType === 'footnotes') return '脚注'
  if (sectionType === 'title') return '标题'
  return '当前章节'
}

function buildSectionGuidance(sectionType: string): string {
  if (sectionType === 'abstract') return '当前片段属于摘要，请保持高度概括、结果导向和摘要语体，不要扩写成引言或展开新的方法细节。'
  if (sectionType === 'introduction' || sectionType === 'related_work') return '当前片段属于引言或相关研究，请保持研究背景、问题缺口与文献脉络的组织功能，优先用文献池补强近期进展和研究定位。'
  if (sectionType === 'methods') return '当前片段属于方法或研究设计，请保留原有流程、材料、装置、参数和步骤顺序；不要虚构新的实验条件、设备参数或结果；如引用文献，只用于方法来源或设计依据。'
  if (sectionType === 'results' || sectionType === 'discussion') return '当前片段属于结果、分析或讨论，请保留原文已给出的现象、数据口径、比较关系和解释方向；不要虚构新的数据、图表或实验发现；可用文献池补充解释与对比。'
  if (sectionType === 'conclusion') return '当前片段属于结论，请保持总结、贡献、局限和展望的收束角色，不要展开新的方法细节或引入未铺垫的新论证分支。'
  if (sectionType === 'keywords') return '当前片段属于关键词区域，请优先保持关键词式的短语表达，不要扩写成完整段落。'
  if (sectionType === 'title') return '当前片段属于标题，请保持标题级表达，不要扩写为正文。'
  return '请先判断该片段在当前章节中的论证功能，并保持与前后文一致的术语、语气、逻辑角色和衔接方式。'
}

function buildPromptContext(meta: ResolvedSectionMeta, articleTypeLabel: string, selectedText: string): string {
  const sectionTitle = humanizeSectionTitle(meta.sectionType, meta.sectionTitle)
  return [
    `当前文稿类型：${articleTypeLabel}。`,
    `当前选中片段所在章节：${sectionTitle}。`,
    meta.previousSectionTitle ? `上一章节：${meta.previousSectionTitle}。` : '',
    meta.nextSectionTitle ? `下一章节：${meta.nextSectionTitle}。` : '',
    buildSectionGuidance(meta.sectionType),
    '重写时必须保留原片段在全文中的结构角色，不要把本节改写成别的章节类型。',
    '如果原文已经包含实验条件、数据、结论、术语定义或限定条件，必须保持这些信息，不得凭空添加。',
    selectedText.length < 120 ? '当前选区较短，请控制改写幅度，优先保持句法功能和上下文衔接。' : '',
  ].filter(Boolean).join('\n')
}

function buildContextResult(meta: ResolvedSectionMeta, articleType: string | null | undefined, selectedText: string): StructuredRemakeContext {
  const articleTypeLabel = resolveArticleTypeLabel(articleType)
  const sectionTitle = humanizeSectionTitle(meta.sectionType, meta.sectionTitle)
  const unsupportedReason = meta.sectionType === 'references'
    ? '参考文献区域不适合走正文 remake。'
    : meta.sectionType === 'footnotes'
      ? '脚注区域不适合走正文 remake。'
      : undefined

  return {
    articleType,
    articleTypeLabel,
    sectionType: meta.sectionType,
    sectionTitle,
    previousSectionTitle: meta.previousSectionTitle,
    nextSectionTitle: meta.nextSectionTitle,
    sourceLabel: `当前文稿中“${sectionTitle}”部分的选中片段`,
    promptContext: buildPromptContext(meta, articleTypeLabel, selectedText),
    unsupportedReason,
  }
}

function extractHeadingSections(fullText: string): HeadingSection[] {
  return Array.from(String(fullText || '').matchAll(/^#{1,6}\s+(.+)$/gm))
    .map((match) => ({
      title: String(match[1] || '').trim(),
      type: guessSectionType(String(match[1] || '').trim()),
      startIndex: match.index ?? -1,
    }))
    .filter((item) => item.title)
}

function resolveMetaFromHeadings(selectedText: string, fullText: string): ResolvedSectionMeta | null {
  const headingSections = extractHeadingSections(fullText)
  if (!headingSections.length) return null
  const probe = String(selectedText || '').trim().slice(0, 80)
  const selectedPos = probe ? fullText.indexOf(probe) : -1
  if (selectedPos < 0) return null

  let currentIndex = -1
  for (let index = 0; index < headingSections.length; index += 1) {
    if (headingSections[index].startIndex <= selectedPos) {
      currentIndex = index
      continue
    }
    break
  }

  if (currentIndex < 0) return null
  return {
    sectionType: headingSections[currentIndex].type,
    sectionTitle: headingSections[currentIndex].title,
    previousSectionTitle: currentIndex > 0 ? headingSections[currentIndex - 1].title : undefined,
    nextSectionTitle: currentIndex < headingSections.length - 1 ? headingSections[currentIndex + 1].title : undefined,
  }
}

function resolveMetaFromArticleSections(selectedText: string, fullText: string, articleSections: ArticleSection[]): ResolvedSectionMeta {
  const detectedType = detectSectionType(selectedText, fullText, articleSections)
  const sectionIndex = articleSections.findIndex((section) => section.type === detectedType)
  const fallbackIndex = sectionIndex >= 0 ? sectionIndex : 0
  const current = articleSections[fallbackIndex]
  return {
    sectionType: detectedType || normalizeSectionKey(current?.type || current?.title),
    sectionTitle: String(current?.title || '').trim(),
    previousSectionTitle: fallbackIndex > 0 ? articleSections[fallbackIndex - 1]?.title : undefined,
    nextSectionTitle: fallbackIndex < articleSections.length - 1 ? articleSections[fallbackIndex + 1]?.title : undefined,
  }
}

function isHeadingLikeBlock(block: StructuredRemakeBlock): boolean {
  if (block.type === 'heading') return true
  const style = String(block.paragraphStyle || '').trim()
  return Boolean(style && (/^Heading[1-6]$/i.test(style) || /^(AbstractHeading|KeywordsHeading|ReferencesHeading|FootnotesHeading)$/i.test(style)))
}

function resolveSectionTypeFromBlock(block: StructuredRemakeBlock | null | undefined): string {
  if (!block) return ''
  const style = String(block.paragraphStyle || '').trim()
  if (/^AbstractHeading$/i.test(style) || /^Abstract$/i.test(style)) return 'abstract'
  if (/^KeywordsHeading$/i.test(style) || /^Keywords$/i.test(style)) return 'keywords'
  if (/^ReferencesHeading$/i.test(style) || /^Reference$/i.test(style)) return 'references'
  if (/^FootnotesHeading$/i.test(style) || /^Footnote$/i.test(style)) return 'footnotes'
  return guessSectionType(block.text)
}

export function resolveStructuredRemakeContextFromArticle(params: {
  selectedText: string
  fullText: string
  articleSections?: ArticleSection[]
  articleType?: string | null
}): StructuredRemakeContext {
  const selectedText = String(params.selectedText || '').trim()
  const fullText = String(params.fullText || '')
  const fromHeadings = resolveMetaFromHeadings(selectedText, fullText)
  const fromSections = params.articleSections?.length
    ? resolveMetaFromArticleSections(selectedText, fullText, params.articleSections)
    : null

  return buildContextResult({
    sectionType: fromHeadings?.sectionType || fromSections?.sectionType || '',
    sectionTitle: fromHeadings?.sectionTitle || fromSections?.sectionTitle || '',
    previousSectionTitle: fromHeadings?.previousSectionTitle || fromSections?.previousSectionTitle,
    nextSectionTitle: fromHeadings?.nextSectionTitle || fromSections?.nextSectionTitle,
  }, params.articleType, selectedText)
}

export function resolveStructuredRemakeContextFromBlocks(params: {
  selectedText: string
  anchorId?: string
  blocks: StructuredRemakeBlock[]
  articleType?: string | null
}): StructuredRemakeContext {
  const selectedText = String(params.selectedText || '').trim()
  const blocks = Array.isArray(params.blocks) ? params.blocks : []
  const anchorIndex = blocks.findIndex((block) => block.id && params.anchorId && block.id === params.anchorId)
  const fallbackIndex = anchorIndex >= 0
    ? anchorIndex
    : blocks.findIndex((block) => String(block.text || '').includes(selectedText.slice(0, 60)))
  const currentIndex = fallbackIndex >= 0 ? fallbackIndex : 0
  const currentBlock = blocks[currentIndex]
  const headingEntries = blocks
    .map((block, index) => ({ block, index }))
    .filter((entry) => isHeadingLikeBlock(entry.block))
  const currentHeadingEntry = currentBlock && isHeadingLikeBlock(currentBlock)
    ? { block: currentBlock, index: currentIndex }
    : [...headingEntries].reverse().find((entry) => entry.index <= currentIndex)
  const currentHeadingIndex = currentHeadingEntry
    ? headingEntries.findIndex((entry) => entry.index === currentHeadingEntry.index)
    : -1
  const directSectionType = resolveSectionTypeFromBlock(currentBlock)
  const headingSectionType = resolveSectionTypeFromBlock(currentHeadingEntry?.block)

  return buildContextResult({
    sectionType: headingSectionType || directSectionType,
    sectionTitle: String(currentHeadingEntry?.block?.text || currentBlock?.text || '').trim(),
    previousSectionTitle: currentHeadingIndex > 0 ? headingEntries[currentHeadingIndex - 1]?.block.text : undefined,
    nextSectionTitle: currentHeadingIndex >= 0 && currentHeadingIndex < headingEntries.length - 1 ? headingEntries[currentHeadingIndex + 1]?.block.text : undefined,
  }, params.articleType, selectedText)
}