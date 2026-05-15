import type { OoxmlBlockSnapshot } from '../../documentEngineService'
import type {
  FieldSchema,
  FieldValue,
  FormalTemplateErrorCode,
  GenerationPlan,
  PreviewRegionCandidate,
  RegionGenerationContract,
  RegionRenderResult,
  RegionGenerationPlan,
  TemplateProfile,
  TemplateRegion,
} from '../../../../../src/types/templateGeneration'
import type { KnowledgeRetrievalMode } from '../../../../../src/types/knowledge'
import type { AppSettings } from '../../settingsStore'

const SAMPLE_FIELD_PREFIX = 'visit-letter-field'
const SAMPLE_REGION_PREFIX = 'visit-letter-region'
const VISIT_LETTER_PREVIEW_REGION_ID = `${SAMPLE_REGION_PREFIX}-middle-body`

const REQUIRED_MARKERS = {
  title: '拜访函',
  recipient: '陕西省招生办公室',
  intro: '香港中文大学（深圳）定位于立足中国、面向世界',
  body: '贵省为全国高考生源大省',
  agenda1: '1、2017年学校发展情况和招生工作进展',
  agenda2: '2、请求贵处支持在高考出分后为我校推荐优质生源',
  courtesy: '给予接洽为盼',
  contact: '联系人：',
  signatureOffice: '招生办公室',
  date: '二〇一七年十月二十五日',
}

const CONGRATULATION_LETTER_MARKERS = {
  title: '贺信',
  signatureSchool: '香港中文大学（深圳）',
}

const CONGRATULATION_FIELD_IDS = {
  recipient: `${SAMPLE_FIELD_PREFIX}-recipient`,
  date: `${SAMPLE_FIELD_PREFIX}-letter-date`,
  theme: `${SAMPLE_FIELD_PREFIX}-theme`,
  tone: `${SAMPLE_FIELD_PREFIX}-tone`,
  sender: `${SAMPLE_FIELD_PREFIX}-sender`,
  optionalContext: `${SAMPLE_FIELD_PREFIX}-optional-context`,
} as const

const DEFAULT_CONGRATULATION_TONE = '正式庄重'
const DEFAULT_CONGRATULATION_SENDER = '香港中文大学（深圳）招生办公室'
const KNOWN_CONGRATULATION_TEMPLATE_LEAKS = [
  '福建省福州第一中学',
  '福州第一中学',
  '福州一中',
  '建校200周年',
]

type LetterTemplateKind = 'visit-letter' | 'congratulation-letter'

interface CongratulationLetterFacts {
  recipient: string
  date: string
  theme: string
  tone: string
  sender: string
  optionalContext: string
}

type LetterTemplateRegionPatch = {
  regionId: string
  finalText: string
  finalParagraphs?: string[]
}

interface VisitLetterSampleProfileData {
  fields: FieldSchema[]
  regions: TemplateRegion[]
}

type VisitLetterCommitArtifactsResult =
  | {
      ok: true
      patchedBlocks: OoxmlBlockSnapshot[]
      regionResults: RegionRenderResult[]
      resolvedFieldValues: FieldValue[]
      extraEditableBlockIndices: number[]
    }
  | {
      ok: false
      errorCode: FormalTemplateErrorCode
      errorMessage: string
    }

export function analyzeVisitLetterTemplateSample(blocks: OoxmlBlockSnapshot[]): VisitLetterSampleProfileData | null {
  return analyzeCongratulationLetterTemplate(blocks) || analyzeLegacyVisitLetterTemplate(blocks)
}

function analyzeLegacyVisitLetterTemplate(blocks: OoxmlBlockSnapshot[]): VisitLetterSampleProfileData | null {
  const titleIndex = findBlockIndexByIncludes(blocks, REQUIRED_MARKERS.title)
  const recipientIndex = findBlockIndexByIncludes(blocks, REQUIRED_MARKERS.recipient)
  const introIndex = findBlockIndexByIncludes(blocks, REQUIRED_MARKERS.intro)
  const bodyIndex = findBlockIndexByIncludes(blocks, REQUIRED_MARKERS.body)
  const agenda1Index = findBlockIndexByIncludes(blocks, REQUIRED_MARKERS.agenda1)
  const agenda2Index = findBlockIndexByIncludes(blocks, REQUIRED_MARKERS.agenda2)
  const courtesyIndex = findBlockIndexByIncludes(blocks, REQUIRED_MARKERS.courtesy)
  const contactIndex = findBlockIndexByIncludes(blocks, REQUIRED_MARKERS.contact)
  const signatureSchoolIndex = findBlockIndexFrom(blocks, '香港中文大学（深圳）', contactIndex + 1)
  const signatureOfficeIndex = findBlockIndexFrom(blocks, REQUIRED_MARKERS.signatureOffice, signatureSchoolIndex + 1)
  const dateIndex = findBlockIndexByIncludes(blocks, REQUIRED_MARKERS.date)

  if ([
    titleIndex,
    recipientIndex,
    introIndex,
    bodyIndex,
    agenda1Index,
    agenda2Index,
    courtesyIndex,
    contactIndex,
    signatureSchoolIndex,
    signatureOfficeIndex,
    dateIndex,
  ].some((index) => index < 0)) {
    return null
  }

  const recipientBlock = blocks[recipientIndex]?.text || ''
  const bodyBlock = blocks[bodyIndex]?.text || ''
  const contactBlock = blocks[contactIndex]?.text || ''
  const dateBlock = blocks[dateIndex]?.text || ''

  const recipient = recipientBlock.replace(/[：:]+$/, '').trim() || '陕西省招生办公室'
  const province = capture(bodyBlock, /在([^，。；]+?)的招生工作/, '陕西省')
  const visitPerson = capture(bodyBlock, /我校(.+?)拟于/, '顾阳教授等一行3人')
  const visitTime = capture(bodyBlock, /拟于(.+?)到访/, '2017年11月7日（周二）下午')
  const contactPerson = capture(contactBlock, /联系人[:：]\s*(.+?)\s*手机[:：]/, '朱**老师')
  const contactPhone = capture(contactBlock, /手机[:：]\s*(.+?)[。.]?$/, '188********')
  const letterDate = dateBlock.trim() || '二〇一七年十月二十五日'

  const fields: FieldSchema[] = [
    buildField('recipient', '收函单位', recipient, recipientIndex),
    buildField('province', '目标省份', province, bodyIndex),
    buildField('visit-person', '来访人员说明', visitPerson, bodyIndex, 'multiline'),
    buildField('visit-time', '拜访时间', visitTime, bodyIndex, 'date'),
    buildField('contact-person', '联系人', contactPerson, contactIndex),
    buildField('contact-phone', '联系电话', contactPhone, contactIndex),
    buildField('letter-date', '发函日期', letterDate, dateIndex, 'date'),
  ]

  const regions: TemplateRegion[] = [
    buildRegion(blocks, `${SAMPLE_REGION_PREFIX}-title`, '锁定区：标题', titleIndex, titleIndex + 1, false, true),
    buildRegion(blocks, `${SAMPLE_REGION_PREFIX}-school-intro`, '锁定区：学校介绍', introIndex, introIndex + 1, false, true),
    buildRegion(blocks, VISIT_LETTER_PREVIEW_REGION_ID, '可生成区：中间正文', bodyIndex, agenda2Index + 1, true, false),
    buildRegion(blocks, `${SAMPLE_REGION_PREFIX}-courtesy`, '锁定区：结语', courtesyIndex, courtesyIndex + 1, false, true),
    buildRegion(blocks, `${SAMPLE_REGION_PREFIX}-signature`, '锁定区：落款单位', signatureSchoolIndex, signatureOfficeIndex + 1, false, true),
  ]

  return { fields, regions }
}

function analyzeCongratulationLetterTemplate(blocks: OoxmlBlockSnapshot[]): VisitLetterSampleProfileData | null {
  const titleIndex = findBlockIndexByIncludes(blocks, CONGRATULATION_LETTER_MARKERS.title)
  if (titleIndex < 0) return null

  const salutationIndex = findCongratulationSalutationIndex(blocks, titleIndex + 1)
  const signatureIndex = findLastBlockIndexByIncludes(blocks, CONGRATULATION_LETTER_MARKERS.signatureSchool)
  const dateIndex = findDateBlockIndexFrom(blocks, signatureIndex + 1)

  if (salutationIndex < 0 || signatureIndex < 0 || dateIndex < 0) {
    return null
  }

  const bodyStart = salutationIndex + 1
  const bodyEnd = signatureIndex
  if (bodyStart >= bodyEnd) {
    return null
  }

  const signatureBlock = String(blocks[signatureIndex]?.text || '').trim()
  const fields: FieldSchema[] = [
    buildField('recipient', '收件人', '', salutationIndex),
    buildField('letter-date', '日期', '', dateIndex, 'date'),
    buildField('theme', '主题', '', bodyStart, 'multiline'),
    buildField('tone', '语气', DEFAULT_CONGRATULATION_TONE, bodyStart, 'text', false),
    buildField('sender', '发信单位', normalizeCongratulationSender(signatureBlock) || DEFAULT_CONGRATULATION_SENDER, signatureIndex, 'text', false),
    buildField('optional-context', '补充背景', '', bodyStart, 'multiline', false),
  ]
  const regions: TemplateRegion[] = [
    buildRegion(blocks, `${SAMPLE_REGION_PREFIX}-title`, '锁定区：标题', titleIndex, titleIndex + 1, false, true),
    buildRegion(blocks, `${SAMPLE_REGION_PREFIX}-salutation`, '锁定区：称谓', salutationIndex, salutationIndex + 1, false, true),
    buildRegion(blocks, VISIT_LETTER_PREVIEW_REGION_ID, '可生成区：正文', bodyStart, bodyEnd, true, false),
    buildRegion(blocks, `${SAMPLE_REGION_PREFIX}-signature`, '锁定区：落款与日期', signatureIndex, dateIndex + 1, false, true),
  ]

  return { fields, regions }
}

export function isVisitLetterTemplateProfile(profile: TemplateProfile): boolean {
  return profile.fields.some((field) => field.sourceKind === 'sample-adapter' && field.fieldId.startsWith(SAMPLE_FIELD_PREFIX))
    || profile.regions.some((region) => region.regionId.startsWith(SAMPLE_REGION_PREFIX))
}

export async function buildVisitLetterPreviewArtifacts(input: {
  profile: TemplateProfile
  fieldValues?: FieldValue[]
  instruction: string
  referenceDocumentIds: string[]
  sampleDocumentIds: string[]
  retrievalMode: KnowledgeRetrievalMode
  targetRegionIds?: string[]
}): Promise<{
  plan: GenerationPlan
  retrievalPreview: Array<{ regionId: string; hitCount: number; topHitSummary?: string }>
  regionCandidate?: PreviewRegionCandidate
}> {
  const templateKind = resolveLetterTemplateKindFromProfile(input.profile)
  if (templateKind === 'congratulation-letter') {
    return buildCongratulationLetterPreviewArtifacts(input)
  }

  const effectiveFieldValues = resolveEffectiveFieldValues(input.profile.fields, input.fieldValues)
  const pendingFieldIds = input.profile.fields
    .filter((field) => field.required)
    .filter((field) => !(effectiveFieldValues.get(field.fieldId) || '').trim())
    .map((field) => field.fieldId)

  const previewRegion = input.profile.regions.find((region) => region.regionId === VISIT_LETTER_PREVIEW_REGION_ID)
  const targetRegionIds = input.targetRegionIds && input.targetRegionIds.length > 0
    ? new Set(input.targetRegionIds)
    : null
  const includePreviewRegion = Boolean(previewRegion) && (!targetRegionIds || targetRegionIds.has(VISIT_LETTER_PREVIEW_REGION_ID))

  const regionPlans: RegionGenerationPlan[] = includePreviewRegion && previewRegion
    ? [{
        regionId: previewRegion.regionId,
        promptStrategy: 'rewrite-body',
        retrievalConfig: {
          mode: input.retrievalMode,
          referenceDocumentIds: input.referenceDocumentIds,
          sampleDocumentIds: input.sampleDocumentIds,
          maxChunks: 0,
        },
        contract: buildVisitLetterGenerationContract({
          profile: input.profile,
          region: previewRegion,
          fieldValues: effectiveFieldValues,
          instruction: input.instruction,
        }),
      }]
    : []

  return {
    plan: {
      profileId: input.profile.profileId,
      regionPlans,
      pendingFieldIds,
    },
    retrievalPreview: includePreviewRegion && previewRegion
      ? [{
          regionId: previewRegion.regionId,
          hitCount: 0,
          topHitSummary: '样例模板会先提炼字段与模板事实，再交给通用 LLM 正文主链生成候选；sample adapter 只提供上下文与回退。',
        }]
      : [],
  }
}

export function buildVisitLetterCommitArtifacts(input: {
  profile: TemplateProfile
  blocks: OoxmlBlockSnapshot[]
  fieldValues: FieldValue[]
  regionPatches: LetterTemplateRegionPatch[]
  instruction?: string
}): VisitLetterCommitArtifactsResult {
  const templateKind = resolveLetterTemplateKindFromProfile(input.profile)
  if (templateKind === 'congratulation-letter') {
    return buildCongratulationLetterCommitArtifacts(input)
  }

  const currentFieldMap = new Map((input.fieldValues || []).map((fieldValue) => [fieldValue.fieldId, fieldValue]))
  const resolvedFieldValues = input.profile.fields.map((field) => {
    const current = currentFieldMap.get(field.fieldId)
    return {
      fieldId: field.fieldId,
      value: current?.value ?? field.defaultText,
      userOverride: current?.userOverride ?? false,
      candidateValue: current?.candidateValue,
      confirmed: current?.confirmed ?? false,
    }
  })

  const missingRequiredFieldIds = resolvedFieldValues
    .filter((fieldValue) => input.profile.fields.find((field) => field.fieldId === fieldValue.fieldId)?.required)
    .filter((fieldValue) => !fieldValue.value.trim())
    .map((fieldValue) => fieldValue.fieldId)

  if (missingRequiredFieldIds.length > 0) {
    return {
      ok: false,
      errorCode: 'FT_FIELD_MISSING_REQUIRED',
      errorMessage: `${missingRequiredFieldIds.length} 个必填字段未填写，正式模板 commit 已终止。`,
    }
  }

  const regionPatch = input.regionPatches.find((patch) => patch.regionId === VISIT_LETTER_PREVIEW_REGION_ID)
  if (!regionPatch || resolvePatchParagraphs(regionPatch).length === 0) {
    return {
      ok: false,
      errorCode: 'FT_GENERATION_FAILED',
      errorMessage: '中间正文 candidateText 缺失，正式模板 commit 不能继续。',
    }
  }

  const previewRegion = input.profile.regions.find((region) => region.regionId === VISIT_LETTER_PREVIEW_REGION_ID)
  if (!previewRegion) {
    return {
      ok: false,
      errorCode: 'FT_GENERATION_FAILED',
      errorMessage: '未找到拜访函样例的唯一中间正文可生成区。',
    }
  }

  const regionStart = previewRegion.blockRange.start
  const regionEnd = previewRegion.blockRange.end
  const regionBlockCount = Math.max(0, regionEnd - regionStart)
  const candidateParagraphs = normalizeVisitLetterParagraphs(resolvePatchParagraphs(regionPatch), previewRegion)

  if (candidateParagraphs.length === 0) {
    return {
      ok: false,
      errorCode: 'FT_GENERATION_FAILED',
      errorMessage: '中间正文 candidate 未产出有效段落，正式模板 commit 不能继续。',
    }
  }

  if (candidateParagraphs.length !== regionBlockCount) {
    return {
      ok: false,
      errorCode: 'FT_GENERATION_FAILED',
      errorMessage: `中间正文 candidate 规范化后共有 ${candidateParagraphs.length} 段，但拜访函样例正文区需要 ${regionBlockCount} 个连续段落。`,
    }
  }

  const effectiveFieldValues = new Map(resolvedFieldValues.map((fieldValue) => [fieldValue.fieldId, fieldValue.value.trim()]))
  const recipientText = `${stripTrailingColon(effectiveFieldValues.get(`${SAMPLE_FIELD_PREFIX}-recipient`) || '陕西省招生办公室')}：`
  const contactText = `联系人：${effectiveFieldValues.get(`${SAMPLE_FIELD_PREFIX}-contact-person`) || '朱**老师'} 手机：${effectiveFieldValues.get(`${SAMPLE_FIELD_PREFIX}-contact-phone`) || '188********'}。`
  const dateText = effectiveFieldValues.get(`${SAMPLE_FIELD_PREFIX}-letter-date`) || '二〇一七年十月二十五日'

  let patchedBlocks = input.blocks.map((block) => ({ ...block }))
  patchedBlocks = patchBlockByFieldId(patchedBlocks, input.profile.fields, `${SAMPLE_FIELD_PREFIX}-recipient`, recipientText)
  patchedBlocks = patchBlockByFieldId(patchedBlocks, input.profile.fields, `${SAMPLE_FIELD_PREFIX}-contact-person`, contactText)
  patchedBlocks = patchBlockByFieldId(patchedBlocks, input.profile.fields, `${SAMPLE_FIELD_PREFIX}-letter-date`, dateText)
  const replacementBlocks = buildRegionParagraphBlocks(patchedBlocks, previewRegion, candidateParagraphs)
  if (!replacementBlocks) {
    return {
      ok: false,
      errorCode: 'FT_GENERATION_FAILED',
      errorMessage: '拜访函正文区缺少可复用的段落模板，正式模板 commit 已终止。',
    }
  }
  patchedBlocks = replaceBlockRange(patchedBlocks, previewRegion.blockRange.start, previewRegion.blockRange.end, replacementBlocks)

  const extraEditableBlockIndices = Array.from(new Set(input.profile.fields.flatMap((field) => field.blockIndices))).sort((left, right) => left - right)

  return {
    ok: true,
    patchedBlocks,
    regionResults: [{
      regionId: previewRegion.regionId,
      candidateText: joinStructuredParagraphs(candidateParagraphs),
      committed: false,
    }],
    resolvedFieldValues,
    extraEditableBlockIndices,
  }
}

function buildField(
  suffix: string,
  label: string,
  defaultText: string,
  blockIndex: number,
  dataType: FieldSchema['dataType'] = 'text',
  required = true,
): FieldSchema {
  return {
    fieldId: `${SAMPLE_FIELD_PREFIX}-${suffix}`,
    label,
    sourceKind: 'sample-adapter',
    dataType,
    required,
    defaultText,
    blockIndices: [blockIndex],
  }
}

function buildRegion(
  blocks: OoxmlBlockSnapshot[],
  regionId: string,
  label: string,
  start: number,
  end: number,
  llmWritable: boolean,
  shellLocked: boolean,
): TemplateRegion {
  const regionBlocks = blocks.slice(start, end)
  return {
    regionId,
    label,
    detectionKind: 'sample-adapter',
    blockRange: { start, end },
    originalText: regionBlocks.map((block) => block.text).join('\n'),
    blockRefs: regionBlocks.map((block) => ({
      index: block.index,
      kind: block.kind,
      text: block.text,
      level: block.level,
      sourceId: block.sourceId,
    })),
    llmWritable,
    shellLocked,
  }
}

function findBlockIndexByIncludes(blocks: OoxmlBlockSnapshot[], keyword: string): number {
  return blocks.findIndex((block) => normalizeText(block.text).includes(normalizeText(keyword)))
}

function findBlockIndexFrom(blocks: OoxmlBlockSnapshot[], keyword: string, startIndex: number): number {
  for (let index = Math.max(startIndex, 0); index < blocks.length; index += 1) {
    if (normalizeText(blocks[index].text).includes(normalizeText(keyword))) return index
  }
  return -1
}

function findLastBlockIndexByIncludes(blocks: OoxmlBlockSnapshot[], keyword: string): number {
  const normalizedKeyword = normalizeText(keyword)
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (normalizeText(blocks[index].text).includes(normalizedKeyword)) return index
  }
  return -1
}

function findCongratulationSalutationIndex(blocks: OoxmlBlockSnapshot[], startIndex: number): number {
  for (let index = Math.max(startIndex, 0); index < blocks.length; index += 1) {
    const text = String(blocks[index]?.text || '').trim()
    if (!text) continue
    if (/[：:]$/.test(text)) return index
  }
  return -1
}

function findDateBlockIndexFrom(blocks: OoxmlBlockSnapshot[], startIndex: number): number {
  for (let index = Math.max(startIndex, 0); index < blocks.length; index += 1) {
    const normalized = normalizeText(blocks[index]?.text || '')
    if (/^[二〇零一二三四五六七八九十0-9]{2,}年.+月.+日$/.test(normalized)) return index
  }
  return -1
}

function resolveLetterTemplateKindFromProfile(profile: TemplateProfile): LetterTemplateKind | null {
  const titleRegion = profile.regions.find((region) => region.regionId === `${SAMPLE_REGION_PREFIX}-title`)
  const normalizedTitle = normalizeText(titleRegion?.originalText || profile.title || '')
  if (normalizedTitle.includes(normalizeText(CONGRATULATION_LETTER_MARKERS.title))) return 'congratulation-letter'
  if (normalizedTitle.includes(normalizeText(REQUIRED_MARKERS.title))) return 'visit-letter'
  return null
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, '').trim()
}

function capture(source: string, pattern: RegExp, fallback: string): string {
  const match = source.match(pattern)
  return match?.[1]?.trim() || fallback
}

function resolveEffectiveFieldValues(fields: FieldSchema[], currentValues?: FieldValue[]): Map<string, string> {
  const currentMap = new Map((currentValues || []).map((value) => [value.fieldId, value.value]))
  return new Map(fields.map((field) => [field.fieldId, currentMap.get(field.fieldId) ?? field.defaultText]))
}

function patchBlockByFieldId(
  blocks: OoxmlBlockSnapshot[],
  fields: FieldSchema[],
  fieldId: string,
  nextText: string,
): OoxmlBlockSnapshot[] {
  const field = fields.find((item) => item.fieldId === fieldId)
  if (!field || field.blockIndices.length === 0) return blocks
  const targetIndex = field.blockIndices[0]
  return blocks.map((block) => (
    block.index === targetIndex
      ? clonePatchedParagraphBlock(block, nextText)
      : block
  ))
}

function buildRegionParagraphBlocks(
  blocks: OoxmlBlockSnapshot[],
  region: TemplateRegion,
  paragraphs: string[],
): OoxmlBlockSnapshot[] | null {
  const templateBlocks = blocks.slice(region.blockRange.start, region.blockRange.end)
    .filter((block) => block.kind === 'paragraph')
  const fallbackTemplateBlock = templateBlocks[templateBlocks.length - 1]

  if (!fallbackTemplateBlock) return null

  return paragraphs.map((paragraph, index) => {
    const templateBlock = templateBlocks[Math.min(index, templateBlocks.length - 1)] || fallbackTemplateBlock
    return clonePatchedParagraphBlock(templateBlock, paragraph)
  })
}

function replaceBlockRange(
  blocks: OoxmlBlockSnapshot[],
  start: number,
  end: number,
  replacement: OoxmlBlockSnapshot[],
): OoxmlBlockSnapshot[] {
  const merged = [...blocks.slice(0, start), ...replacement, ...blocks.slice(end)]
  return merged.map((block, index) => ({ ...block, index }))
}

function clonePatchedParagraphBlock(block: OoxmlBlockSnapshot, nextText: string): OoxmlBlockSnapshot {
  return {
    ...block,
    text: normalizeSingleParagraphText(nextText),
    paragraphStyle: block.sourceXml ? undefined : block.paragraphStyle,
    inlineRuns: undefined,
    disableSourceSkeletonRewrite: Boolean(block.sourceXml),
  }
}

function normalizeVisitLetterBodyCandidate(text: string, region: TemplateRegion): string {
  return joinStructuredParagraphs(normalizeVisitLetterParagraphs(splitVisitLetterParagraphs(text), region))
}

function splitVisitLetterParagraphs(text: string): string[] {
  const normalized = splitStructuredParagraphs(text)
  if (normalized.length > 1) return normalized

  const agendaParagraphs = splitVisitLetterAgendaParagraphs(normalized[0] || '')
  return agendaParagraphs.length > 0 ? agendaParagraphs : normalized
}

function splitVisitLetterAgendaParagraphs(text: string): string[] {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return []

  const matches = Array.from(normalized.matchAll(/([0-9]+[、.．][\s\S]*?)(?=(?:\s*[0-9]+[、.．])|$)/g))
    .map((match) => String(match[1] || '').trim())
    .filter(Boolean)

  if (matches.length === 0) return []

  const firstAgendaIndex = normalized.search(/[0-9]+[、.．]/)
  const leadParagraph = firstAgendaIndex > 0
    ? normalized.slice(0, firstAgendaIndex).trim().replace(/[；;，,\s]+$/g, '')
    : ''

  return [leadParagraph, ...matches].filter(Boolean)
}

function normalizeVisitLetterParagraphs(paragraphs: string[], region: TemplateRegion): string[] {
  const targetCount = Math.max(0, region.blockRange.end - region.blockRange.start)
  const fallbackParagraphs = region.blockRefs.map((blockRef) => blockRef.text.trim()).filter(Boolean)
  if (targetCount === 0) return []

  const normalizedParagraphs = paragraphs.map((paragraph) => normalizeSingleParagraphText(paragraph)).filter(Boolean)
  if (normalizedParagraphs.length === 0) {
    return fallbackParagraphs.slice(0, targetCount)
  }

  if (normalizedParagraphs.length > targetCount) {
    return [
      ...normalizedParagraphs.slice(0, targetCount - 1),
      normalizedParagraphs.slice(targetCount - 1).join(' '),
    ]
  }

  if (normalizedParagraphs.length < targetCount) {
    return [
      ...normalizedParagraphs,
      ...fallbackParagraphs.slice(normalizedParagraphs.length, targetCount),
    ]
  }

  return normalizedParagraphs
}

function splitStructuredParagraphs(text: string): string[] {
  const normalized = String(text || '').replace(/\r/g, '').trim()
  if (!normalized) return []

  const blankLineParagraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\n+/g, ' ').trim())
    .filter(Boolean)
  if (blankLineParagraphs.length > 1) return blankLineParagraphs.map((paragraph) => normalizeSingleParagraphText(paragraph)).filter(Boolean)

  const lineParagraphs = normalized
    .split(/\n+/)
    .map((paragraph) => normalizeSingleParagraphText(paragraph))
    .filter(Boolean)
  if (lineParagraphs.length > 1) return lineParagraphs

  return [normalizeSingleParagraphText(normalized)].filter(Boolean)
}

function joinStructuredParagraphs(paragraphs: string[]): string {
  return paragraphs.map((paragraph) => normalizeSingleParagraphText(paragraph)).filter(Boolean).join('\n')
}

function normalizeSingleParagraphText(value: string): string {
  return String(value || '').replace(/\r/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim()
}

function resolvePatchParagraphs(regionPatch: LetterTemplateRegionPatch): string[] {
  if (Array.isArray(regionPatch.finalParagraphs) && regionPatch.finalParagraphs.length > 0) {
    return regionPatch.finalParagraphs.map((paragraph) => normalizeSingleParagraphText(paragraph)).filter(Boolean)
  }
  return splitStructuredParagraphs(regionPatch.finalText)
}

function stripTrailingColon(value: string): string {
  return String(value || '').trim().replace(/[：:]+$/, '')
}

function extractUserDemandText(instruction: string): string {
  const normalized = String(instruction || '').trim()
  if (!normalized) return ''

  const matched = normalized.match(/用户需求[:：]\s*([\s\S]*)$/)
  return matched?.[1]?.trim() || normalized
}

function captureFirstMatch(source: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const matched = source.match(pattern)
    if (matched?.[1]) return matched[1].trim()
  }
  return ''
}

function normalizeCongratulationRecipient(value: string): string {
  return stripTrailingColon(normalizeSingleParagraphText(value)).replace(/[，。；]+$/g, '')
}

function normalizeCongratulationDate(value: string): string {
  return normalizeSingleParagraphText(value)
    .replace(/\s*年\s*/g, '年')
    .replace(/\s*月\s*/g, '月')
    .replace(/\s*日\s*/g, '日')
    .replace(/[，。；]+$/g, '')
}

function normalizeCongratulationTheme(value: string): string {
  return normalizeSingleParagraphText(value)
    .replace(/^(?:主题(?:围绕|为|是)?|围绕|聚焦|关于)\s*/u, '')
    .replace(/[，。；]+$/g, '')
}

function normalizeCongratulationTone(value: string): string {
  return normalizeSingleParagraphText(value)
    .replace(/^(?:语气|风格)(?:写|为|是|用)?\s*/u, '')
    .replace(/[，。；]+$/g, '')
}

function normalizeCongratulationSender(value: string): string {
  return normalizeSingleParagraphText(value).replace(/[，。；]+$/g, '')
}

function normalizeCongratulationOptionalContext(value: string): string {
  return normalizeSingleParagraphText(value).replace(/[；。]+$/g, '')
}

function extractCongratulationFactsFromInstruction(instruction: string): Partial<CongratulationLetterFacts> {
  const source = extractUserDemandText(instruction)
  if (!source) return {}

  return {
    recipient: normalizeCongratulationRecipient(captureFirstMatch(source, [
      /recipient\s*[:=：]\s*([^\n,，。；]{2,80})/i,
      /(?:收件人|收函单位|称谓)\s*[:=：]\s*([^\n,，。；]{2,80})/u,
      /(?:给|致|向)([^，。；\n]{2,80}?)(?:的)?贺信/u,
    ])),
    date: normalizeCongratulationDate(captureFirstMatch(source, [
      /date\s*[:=：]\s*([^\n,，。；]{4,40})/i,
      /(?:日期|时间)\s*[:=：]\s*([^\n,，。；]{4,40})/u,
      /(?:时间写|日期写)(?:成|为|写|用)?\s*([^\n,，。；]{4,40})/u,
    ])),
    theme: normalizeCongratulationTheme(captureFirstMatch(source, [
      /theme\s*[:=：]\s*([^\n,，。；]{2,80})/i,
      /主题\s*[:=：]\s*([^\n,，。；]{2,80})/u,
      /(?:主题(?:围绕|为|是)?|围绕|聚焦|关于)([^，。；\n]{2,80})/u,
    ])),
    tone: normalizeCongratulationTone(captureFirstMatch(source, [
      /tone\s*[:=：]\s*([^\n,，。；]{2,40})/i,
      /(?:语气|风格)\s*[:=：]\s*([^\n,，。；]{2,40})/u,
      /(?:语气|风格)(?:写|为|是|用)?\s*([^，。；\n]{2,40})/u,
    ])),
    sender: normalizeCongratulationSender(captureFirstMatch(source, [
      /sender\s*[:=：]\s*([^\n,，。；]{2,80})/i,
      /(?:发信单位|落款(?:单位)?|署名)\s*[:=：]\s*([^\n,，。；]{2,80})/u,
      /(?:发信单位|落款(?:单位)?|署名)(?:写|为|是|用)?\s*([^，。；\n]{2,80})/u,
    ])),
    optionalContext: normalizeCongratulationOptionalContext(captureFirstMatch(source, [
      /(?:optional[_\s-]?context|补充背景)\s*[:=：]\s*([^\n]+)/i,
    ])),
  }
}

function pickCongratulationFact(
  fieldId: string,
  extractedValue: string | undefined,
  currentMap: Map<string, FieldValue>,
  defaultMap: Map<string, string>,
  normalizer: (value: string) => string,
): string {
  return normalizer(extractedValue || currentMap.get(fieldId)?.value || defaultMap.get(fieldId) || '')
}

function resolveCongratulationFactValueForField(fieldId: string, facts: CongratulationLetterFacts): string | undefined {
  switch (fieldId) {
    case CONGRATULATION_FIELD_IDS.recipient:
      return facts.recipient
    case CONGRATULATION_FIELD_IDS.date:
      return facts.date
    case CONGRATULATION_FIELD_IDS.theme:
      return facts.theme
    case CONGRATULATION_FIELD_IDS.tone:
      return facts.tone
    case CONGRATULATION_FIELD_IDS.sender:
      return facts.sender
    case CONGRATULATION_FIELD_IDS.optionalContext:
      return facts.optionalContext
    default:
      return undefined
  }
}

function resolveCongratulationLetterFacts(input: {
  fields: FieldSchema[]
  currentValues?: FieldValue[]
  instruction?: string
}): { facts: CongratulationLetterFacts; resolvedFieldValues: FieldValue[] } {
  const currentMap = new Map((input.currentValues || []).map((value) => [value.fieldId, value]))
  const defaultMap = new Map(input.fields.map((field) => [field.fieldId, field.defaultText || '']))
  const extractedFacts = extractCongratulationFactsFromInstruction(input.instruction || '')

  const facts: CongratulationLetterFacts = {
    recipient: pickCongratulationFact(CONGRATULATION_FIELD_IDS.recipient, extractedFacts.recipient, currentMap, defaultMap, normalizeCongratulationRecipient),
    date: pickCongratulationFact(CONGRATULATION_FIELD_IDS.date, extractedFacts.date, currentMap, defaultMap, normalizeCongratulationDate),
    theme: pickCongratulationFact(CONGRATULATION_FIELD_IDS.theme, extractedFacts.theme, currentMap, defaultMap, normalizeCongratulationTheme),
    tone: pickCongratulationFact(CONGRATULATION_FIELD_IDS.tone, extractedFacts.tone, currentMap, defaultMap, normalizeCongratulationTone),
    sender: pickCongratulationFact(CONGRATULATION_FIELD_IDS.sender, extractedFacts.sender, currentMap, defaultMap, normalizeCongratulationSender),
    optionalContext: pickCongratulationFact(CONGRATULATION_FIELD_IDS.optionalContext, extractedFacts.optionalContext, currentMap, defaultMap, normalizeCongratulationOptionalContext),
  }

  const resolvedFieldValues = input.fields.map((field) => {
    const current = currentMap.get(field.fieldId)
    const resolvedValue = resolveCongratulationFactValueForField(field.fieldId, facts)
    const value = resolvedValue ?? normalizeSingleParagraphText(current?.value || field.defaultText || '')
    return {
      fieldId: field.fieldId,
      value,
      userOverride: current?.userOverride ?? Boolean(value.trim()),
      candidateValue: current?.candidateValue,
      confirmed: current?.confirmed ?? Boolean(value.trim()),
    }
  })

  return { facts, resolvedFieldValues }
}

function buildCongratulationRecipientAliases(recipient: string): string[] {
  const normalizedRecipient = normalizeCongratulationRecipient(recipient)
  if (!normalizedRecipient) return []

  const aliases = new Set<string>([normalizedRecipient])
  if (normalizedRecipient.includes('第一中学')) {
    const withoutProvince = normalizedRecipient.replace(/^[\u4e00-\u9fa5]{1,8}省/u, '')
    if (withoutProvince) aliases.add(withoutProvince)
    const schoolMatch = withoutProvince.match(/([\u4e00-\u9fa5]{1,8})第一中学$/u)
    if (schoolMatch?.[1]) {
      const schoolArea = schoolMatch[1].replace(/市$/u, '')
      aliases.add(`${schoolArea}第一中学`)
      aliases.add(`${schoolArea}一中`)
    }
  }

  return Array.from(aliases).filter(Boolean)
}

function resolveCongratulationDisallowedLeaks(profile: TemplateProfile, facts: CongratulationLetterFacts): string[] {
  const salutationRegion = profile.regions.find((region) => region.regionId === `${SAMPLE_REGION_PREFIX}-salutation`)
  const templateRecipient = normalizeCongratulationRecipient(salutationRegion?.originalText || '')
  const allowed = new Set([
    ...buildCongratulationRecipientAliases(facts.recipient),
    facts.theme,
    facts.sender,
  ].map((value) => normalizeText(value)).filter(Boolean))

  return Array.from(new Set([
    ...KNOWN_CONGRATULATION_TEMPLATE_LEAKS,
    ...buildCongratulationRecipientAliases(templateRecipient),
  ].map((value) => normalizeSingleParagraphText(value)).filter(Boolean)))
    .filter((value) => !allowed.has(normalizeText(value)))
}

function findCongratulationLeaks(segments: string[], disallowedLeaks: string[]): string[] {
  const renderedText = normalizeText(segments.join('\n'))
  return disallowedLeaks
    .filter((value) => normalizeText(value) && renderedText.includes(normalizeText(value)))
    .sort((left, right) => right.length - left.length)
}

function renderCongratulationSalutationText(recipient: string): string {
  return `${normalizeCongratulationRecipient(recipient) || '贵方'}：`
}

function renderCongratulationSenderBlockText(templateText: string, sender: string): string {
  const normalizedSender = normalizeCongratulationSender(sender)
  if (!normalizedSender) return normalizeSingleParagraphText(templateText)
  if (!normalizedSender.includes(CONGRATULATION_LETTER_MARKERS.signatureSchool) || !normalizeText(templateText).includes(normalizeText(CONGRATULATION_LETTER_MARKERS.signatureSchool))) {
    return normalizedSender
  }

  const officePart = normalizedSender.replace(CONGRATULATION_LETTER_MARKERS.signatureSchool, '').trim()
  if (!officePart) return CONGRATULATION_LETTER_MARKERS.signatureSchool

  const spacing = String(templateText || '').match(/香港中文大学（深圳）([\s\u00A0]+)/)?.[1] || ' '
  return `${CONGRATULATION_LETTER_MARKERS.signatureSchool}${spacing}${officePart}`
}

function buildCongratulationLetterParagraphs(facts: CongratulationLetterFacts): string[] {
  const recipient = facts.recipient || '贵方'
  const theme = facts.theme || '相关事业高质量发展'
  const tone = facts.tone || DEFAULT_CONGRATULATION_TONE
  const sender = facts.sender || DEFAULT_CONGRATULATION_SENDER
  const optionalContext = facts.optionalContext
  const salutationVerb = tone.includes('正式') || tone.includes('庄重') ? '谨向' : '特向'
  const contextSentence = optionalContext
    ? `${optionalContext.endsWith('。') ? optionalContext : `${optionalContext}。`}`
    : `${recipient}围绕${theme}持续完善政策供给、创新生态与场景支撑，为相关产业发展、技术转化和应用落地营造了良好环境。`

  return [
    `值此${theme}深入推进之际，${salutationVerb}${recipient}致以诚挚敬意，并对贵方在相关工作中的系统谋划与务实推进表示由衷钦佩。`,
    contextSentence,
    `${sender}高度关注${theme}相关领域的发展进展，愿在人才培养、科研协同、成果转化和社会服务等方面同${recipient}进一步加强沟通对接，形成更多务实合作成果。`,
    `衷心祝愿${recipient}在推进${theme}过程中不断取得新成效，愿双方在今后的交流合作中携手并进、共创佳绩。`,
  ].map((paragraph) => normalizeSingleParagraphText(paragraph)).filter(Boolean)
}

function normalizeCongratulationLetterParagraphs(paragraphs: string[], region: TemplateRegion, facts: CongratulationLetterFacts): string[] {
  const targetCount = Math.max(1, region.blockRange.end - region.blockRange.start)
  const normalizedParagraphs = extractCongratulationBodyParagraphs(paragraphs, facts).bodyParagraphs
  const fallbackParagraphs = buildCongratulationLetterParagraphs(facts)

  if (normalizedParagraphs.length === 0) {
    return fallbackParagraphs.slice(0, targetCount)
  }

  if (normalizedParagraphs.length > targetCount) {
    return ensureCongratulationThemeBoundParagraphs([
      ...normalizedParagraphs.slice(0, targetCount - 1),
      normalizedParagraphs.slice(targetCount - 1).join(' '),
    ], facts)
  }

  if (normalizedParagraphs.length < targetCount) {
    return ensureCongratulationThemeBoundParagraphs([
      ...normalizedParagraphs,
      ...fallbackParagraphs.slice(normalizedParagraphs.length, targetCount),
    ], facts)
  }

  return ensureCongratulationThemeBoundParagraphs(normalizedParagraphs, facts)
}

function extractCongratulationBodyParagraphs(paragraphs: string[], facts: CongratulationLetterFacts): {
  normalizedParagraphs: string[]
  leadingNonBodyParagraphs: string[]
  bodyParagraphs: string[]
} {
  const normalizedParagraphs = paragraphs
    .map((paragraph) => normalizeSingleParagraphText(String(paragraph || '').replace(/\r\n?/g, '\n').trim()))
    .filter(Boolean)

  const leadingNonBodyParagraphs: string[] = []
  let bodyStartIndex = 0
  while (bodyStartIndex < normalizedParagraphs.length) {
    const paragraph = normalizedParagraphs[bodyStartIndex]
    if (!isCongratulationLeadingNonBodyParagraph(paragraph, facts)) break
    leadingNonBodyParagraphs.push(paragraph)
    bodyStartIndex += 1
  }

  return {
    normalizedParagraphs,
    leadingNonBodyParagraphs,
    bodyParagraphs: normalizedParagraphs.slice(bodyStartIndex),
  }
}

function buildCharacterNgrams(value: string, size = 2): string[] {
  const normalized = normalizeText(value)
  if (!normalized) return []
  if (normalized.length <= size) return [normalized]

  const grams: string[] = []
  for (let index = 0; index <= normalized.length - size; index += 1) {
    grams.push(normalized.slice(index, index + size))
  }
  return grams
}

function computeNgramCoverage(text: string, target: string): number {
  const targetGrams = Array.from(new Set(buildCharacterNgrams(target)))
  if (targetGrams.length === 0) return 0

  const textGramSet = new Set(buildCharacterNgrams(text))
  let matchedCount = 0
  for (const gram of targetGrams) {
    if (textGramSet.has(gram)) matchedCount += 1
  }

  return matchedCount / targetGrams.length
}

function matchesCongratulationTheme(text: string, theme: string): boolean {
  const normalizedText = normalizeText(text)
  const normalizedTheme = normalizeText(theme)
  if (!normalizedText || !normalizedTheme) return false
  if (normalizedText.includes(normalizedTheme)) return true

  const overlapCoverage = computeNgramCoverage(normalizedText, normalizedTheme)
  if (normalizedTheme.length >= 6 && overlapCoverage >= 0.55) return true

  const themeTail = normalizedTheme.slice(2)
  if (themeTail.length >= 6 && normalizedText.includes(themeTail)) return true

  return false
}

function ensureCongratulationThemeBoundParagraphs(paragraphs: string[], facts: CongratulationLetterFacts): string[] {
  const normalizedTheme = normalizeCongratulationTheme(facts.theme)
  if (!normalizedTheme) return paragraphs
  if (paragraphs.length === 0) return paragraphs

  const firstBodyParagraph = paragraphs[0] || ''
  const firstTwoBodyParagraphsText = paragraphs.slice(0, 2).join(' ')
  if (matchesCongratulationTheme(firstBodyParagraph, normalizedTheme) || matchesCongratulationTheme(firstTwoBodyParagraphsText, normalizedTheme)) {
    return paragraphs
  }

  const fallbackFirstParagraph = buildCongratulationLetterParagraphs(facts)[0]
  if (!fallbackFirstParagraph) return paragraphs

  const repairedParagraphs = [...paragraphs]
  repairedParagraphs[0] = fallbackFirstParagraph
  return repairedParagraphs
}

function isCongratulationLeadingNonBodyParagraph(paragraph: string, facts: CongratulationLetterFacts): boolean {
  const normalizedParagraph = normalizeSingleParagraphText(paragraph)
  if (!normalizedParagraph) return true

  const normalizedCompact = normalizeText(normalizedParagraph)
  if (!normalizedCompact) return true
  if (normalizedCompact === normalizeText(CONGRATULATION_LETTER_MARKERS.title)) return true

  const recipientAliases = buildCongratulationRecipientAliases(facts.recipient)
    .map((value) => normalizeText(stripTrailingColon(value)))
    .filter(Boolean)
  const salutationCandidate = normalizeText(stripTrailingColon(normalizedParagraph))
  if (recipientAliases.includes(salutationCandidate)) return true

  if (/^[^，。；]{2,40}[：:]$/u.test(normalizedParagraph)) return true

  return false
}

function validateCongratulationCommitPayload(input: {
  profile: TemplateProfile
  facts: CongratulationLetterFacts
  salutationText: string
  senderText: string
  dateText: string
  bodyParagraphs: string[]
}): string[] {
  const errors: string[] = []
  const normalizedRecipient = normalizeText(input.facts.recipient)
  const normalizedTheme = normalizeText(input.facts.theme)
  const normalizedSender = normalizeText(input.facts.sender)
  const normalizedDate = normalizeText(input.facts.date)
  const paragraphInspection = extractCongratulationBodyParagraphs(input.bodyParagraphs, input.facts)
  const firstBodyParagraph = paragraphInspection.bodyParagraphs[0] || ''
  const firstTwoBodyParagraphsText = paragraphInspection.bodyParagraphs.slice(0, 2).join(' ')

  if (!normalizedRecipient) errors.push('贺信收件人为空。')
  if (!normalizedTheme) errors.push('贺信主题为空。')
  if (!normalizedDate) errors.push('贺信日期为空。')
  if (normalizedRecipient && normalizeText(stripTrailingColon(input.salutationText)) !== normalizedRecipient) {
    errors.push('贺信称谓未与收件人保持一致。')
  }
  if (normalizedTheme) {
    if (!firstBodyParagraph) {
      errors.push('未找到正文首段。')
    } else {
      const firstBodyHitsTheme = matchesCongratulationTheme(firstBodyParagraph, normalizedTheme)
      const firstTwoBodyHitTheme = matchesCongratulationTheme(firstTwoBodyParagraphsText, normalizedTheme)
      if (!firstBodyHitsTheme && !firstTwoBodyHitTheme) {
        errors.push('找到正文首段，但前两段均未命中用户主题。')
      }
    }
  }
  if (normalizedSender && !normalizeText(input.senderText).includes(normalizedSender)) {
    errors.push('贺信落款未绑定用户发信单位。')
  }
  if (normalizedDate && normalizeText(input.dateText) !== normalizedDate) {
    errors.push('贺信日期未绑定用户日期。')
  }

  const leakedPhrases = findCongratulationLeaks(
    [input.salutationText, ...input.bodyParagraphs, input.senderText, input.dateText],
    resolveCongratulationDisallowedLeaks(input.profile, input.facts),
  )
  if (leakedPhrases.length > 0) {
    errors.push(`检测到模板原实体泄漏：${leakedPhrases.join('、')}。`)
  }

  return errors
}

async function buildCongratulationLetterPreviewArtifacts(input: {
  profile: TemplateProfile
  fieldValues?: FieldValue[]
  instruction: string
  referenceDocumentIds: string[]
  sampleDocumentIds: string[]
  retrievalMode: KnowledgeRetrievalMode
  targetRegionIds?: string[]
  settings?: AppSettings
}): Promise<{
  plan: GenerationPlan
  retrievalPreview: Array<{ regionId: string; hitCount: number; topHitSummary?: string }>
  regionCandidate?: PreviewRegionCandidate
}> {
  const { facts, resolvedFieldValues } = resolveCongratulationLetterFacts({
    fields: input.profile.fields,
    currentValues: input.fieldValues,
    instruction: input.instruction,
  })
  const previewRegion = input.profile.regions.find((region) => region.regionId === VISIT_LETTER_PREVIEW_REGION_ID)
  const targetRegionIds = input.targetRegionIds && input.targetRegionIds.length > 0
    ? new Set(input.targetRegionIds)
    : null
  const includePreviewRegion = Boolean(previewRegion) && (!targetRegionIds || targetRegionIds.has(VISIT_LETTER_PREVIEW_REGION_ID))
  const pendingFieldIds = resolvedFieldValues
    .filter((fieldValue) => input.profile.fields.find((field) => field.fieldId === fieldValue.fieldId)?.required)
    .filter((fieldValue) => !fieldValue.value.trim())
    .map((fieldValue) => fieldValue.fieldId)

  const regionPlans: RegionGenerationPlan[] = includePreviewRegion && previewRegion
    ? [{
        regionId: previewRegion.regionId,
        promptStrategy: 'rewrite-body',
        retrievalConfig: {
          mode: input.retrievalMode,
          referenceDocumentIds: input.referenceDocumentIds,
          sampleDocumentIds: input.sampleDocumentIds,
          maxChunks: 0,
        },
        contract: buildCongratulationGenerationContract({
          profile: input.profile,
          region: previewRegion,
          facts,
          instruction: input.instruction,
        }),
      }]
    : []

  return {
    plan: {
      profileId: input.profile.profileId,
      regionPlans,
      pendingFieldIds,
    },
    retrievalPreview: includePreviewRegion && previewRegion
      ? [{
          regionId: previewRegion.regionId,
          hitCount: 0,
          topHitSummary: '当前贺信链路会先解析收件人/日期/主题/语气/发信单位，再把 facts 与模板正文交给通用 LLM 正文主链生成。',
        }]
      : [],
  }
}

function buildCongratulationLetterCommitArtifacts(input: {
  profile: TemplateProfile
  blocks: OoxmlBlockSnapshot[]
  fieldValues: FieldValue[]
  regionPatches: LetterTemplateRegionPatch[]
  instruction?: string
}): VisitLetterCommitArtifactsResult {
  const { facts, resolvedFieldValues } = resolveCongratulationLetterFacts({
    fields: input.profile.fields,
    currentValues: input.fieldValues,
    instruction: input.instruction,
  })
  const missingRequiredFieldIds = resolvedFieldValues
    .filter((fieldValue) => input.profile.fields.find((field) => field.fieldId === fieldValue.fieldId)?.required)
    .filter((fieldValue) => !fieldValue.value.trim())
    .map((fieldValue) => fieldValue.fieldId)

  if (missingRequiredFieldIds.length > 0) {
    return {
      ok: false,
      errorCode: 'FT_FIELD_MISSING_REQUIRED',
      errorMessage: `${missingRequiredFieldIds.length} 个贺信必填字段缺失，正式模板 commit 已终止。`,
    }
  }

  const previewRegion = input.profile.regions.find((region) => region.regionId === VISIT_LETTER_PREVIEW_REGION_ID)
  if (!previewRegion) {
    return {
      ok: false,
      errorCode: 'FT_GENERATION_FAILED',
      errorMessage: '未找到贺信模板的正文可生成区。',
    }
  }

  const regionPatch = input.regionPatches.find((patch) => patch.regionId === previewRegion.regionId)
  const candidateParagraphs = regionPatch
    ? normalizeCongratulationLetterParagraphs(resolvePatchParagraphs(regionPatch), previewRegion, facts)
    : []

  if (candidateParagraphs.length === 0) {
    return {
      ok: false,
      errorCode: 'FT_GENERATION_FAILED',
      errorMessage: '贺信正文 candidate 未产出有效段落，正式模板 commit 不能继续。',
    }
  }

  const salutationText = renderCongratulationSalutationText(facts.recipient)
  const senderField = input.profile.fields.find((field) => field.fieldId === CONGRATULATION_FIELD_IDS.sender)
  const senderTemplateBlock = senderField && senderField.blockIndices.length > 0
    ? input.blocks.find((block) => block.index === senderField.blockIndices[0])
    : null
  const senderText = renderCongratulationSenderBlockText(senderTemplateBlock?.text || '', facts.sender)
  const dateText = facts.date
  const semanticErrors = validateCongratulationCommitPayload({
    profile: input.profile,
    facts,
    salutationText,
    senderText,
    dateText,
    bodyParagraphs: candidateParagraphs,
  })
  if (semanticErrors.length > 0) {
    return {
      ok: false,
      errorCode: 'FT_GENERATION_FAILED',
      errorMessage: semanticErrors.join(' '),
    }
  }

  const replacementBlocks = buildRegionParagraphBlocks(input.blocks, previewRegion, candidateParagraphs)
  if (!replacementBlocks) {
    return {
      ok: false,
      errorCode: 'FT_GENERATION_FAILED',
      errorMessage: '贺信正文区缺少可复用的段落模板，正式模板 commit 已终止。',
    }
  }

  let patchedBlocks = input.blocks.map((block) => ({ ...block }))
  patchedBlocks = patchBlockByFieldId(patchedBlocks, input.profile.fields, CONGRATULATION_FIELD_IDS.recipient, salutationText)
  patchedBlocks = patchBlockByFieldId(patchedBlocks, input.profile.fields, CONGRATULATION_FIELD_IDS.sender, senderText)
  patchedBlocks = patchBlockByFieldId(patchedBlocks, input.profile.fields, CONGRATULATION_FIELD_IDS.date, dateText)
  patchedBlocks = replaceBlockRange(patchedBlocks, previewRegion.blockRange.start, previewRegion.blockRange.end, replacementBlocks)

  const extraEditableBlockIndices = Array.from(new Set(input.profile.fields.flatMap((field) => field.blockIndices))).sort((left, right) => left - right)

  return {
    ok: true,
    patchedBlocks,
    regionResults: [{
      regionId: previewRegion.regionId,
      candidateText: joinStructuredParagraphs(candidateParagraphs),
      committed: false,
    }],
    resolvedFieldValues,
    extraEditableBlockIndices,
  }
}

async function composeCongratulationLetterBodyCandidate(facts: CongratulationLetterFacts): Promise<string> {
  return buildCongratulationLetterParagraphs(facts).join('\n')
}

function buildCongratulationGenerationContract(input: {
  profile: TemplateProfile
  region: TemplateRegion
  facts: CongratulationLetterFacts
  instruction: string
}): RegionGenerationContract {
  const paragraphTarget = Math.max(1, input.region.blockRange.end - input.region.blockRange.start)
  const theme = input.facts.theme || extractCongratulationFocus(input.instruction) || '相关事业高质量发展'
  const recipient = input.facts.recipient || '贵方'
  const sender = input.facts.sender || DEFAULT_CONGRATULATION_SENDER
  const optionalContext = input.facts.optionalContext

  const paragraphInstructions = [
    `首段围绕“${theme}”开篇，明确向${recipient}表达祝贺与敬意，语气正式庄重。`,
    optionalContext
      ? `第二段结合这条补充背景展开：${optionalContext}。保持中性、克制，不写口号。`
      : `第二段结合主题说明${recipient}推进相关工作的意义与影响，避免空泛赞美。`,
    `第三段说明${sender}对该主题的关注，以及后续交流合作或协同意愿。`,
    `最后一段以正式祝愿收束全文，保持模板文种语气，不引入模板外具体实体。`,
  ].slice(0, paragraphTarget)

  return {
    templateKind: 'congratulation-letter',
    contextSummary: [
      `收件人: ${recipient}`,
      `日期: ${input.facts.date || '未明确'}`,
      `主题: ${theme}`,
      `语气: ${input.facts.tone || DEFAULT_CONGRATULATION_TONE}`,
      `发信单位: ${sender}`,
      optionalContext ? `补充背景: ${optionalContext}` : '',
      input.instruction ? `用户补充要求: ${extractUserDemandText(input.instruction)}` : '',
    ].filter(Boolean).join('\n'),
    paragraphInstructions,
    mustInclude: [recipient, theme].filter(Boolean),
    avoidPhrases: resolveCongratulationDisallowedLeaks(input.profile, input.facts),
    styleConstraints: [
      '必须保持正式公函/贺信口吻，不要写成宣传稿或新闻稿。',
      '不要编造数据、政策成效、排名或无法核验的事实。',
      '正文内容必须与模板原文种一致，只改写正文，不改变版式与落款字段。',
    ],
    paragraphTarget,
    fallbackText: joinStructuredParagraphs(buildCongratulationLetterParagraphs(input.facts).slice(0, paragraphTarget)),
  }
}

function extractCongratulationFocus(instruction: string): string {
  const normalized = String(instruction || '').trim()
  if (!normalized) return ''

  const matched = normalized.match(/(?:围绕|聚焦|关于|主题(?:围绕|为)?)([^，。；]+)/)
  if (!matched?.[1]) return ''

  return matched[1].trim().replace(/^(?:当前|本次|此次)/, '').replace(/[，。；]+$/g, '')
}

async function composeVisitLetterBodyCandidate(
  fieldValues: Map<string, string>,
  instruction: string,
  _settings?: unknown,
): Promise<string> {
  const firstParagraph = await composeVisitLetterLeadParagraph(fieldValues, instruction, undefined)

  return [
    firstParagraph,
    '1、2017年学校发展情况和招生工作进展。',
    '2、请求贵处支持在高考出分后为我校推荐优质生源，我校将为其提供相应指导，并为符合录取条件考生提供良好发展机会（包括助奖学金等）。',
  ].join('\n')
}

async function composeVisitLetterLeadParagraph(
  fieldValues: Map<string, string>,
  instruction: string,
  _settings?: unknown,
): Promise<string> {
  const recipient = fieldValues.get(`${SAMPLE_FIELD_PREFIX}-recipient`) || '陕西省招生办公室'
  const province = fieldValues.get(`${SAMPLE_FIELD_PREFIX}-province`) || '陕西省'
  const visitPerson = fieldValues.get(`${SAMPLE_FIELD_PREFIX}-visit-person`) || '顾阳教授等一行3人'
  const visitTime = fieldValues.get(`${SAMPLE_FIELD_PREFIX}-visit-time`) || '2017年11月7日（周二）下午'
  const recipientName = stripTrailingColon(recipient) || '陕西省招生办公室'
  const areaContext = resolveAreaContext(province)
  const unitType = inferRecipientUnitType(recipientName)
  const purpose = inferVisitPurpose(instruction, unitType)

  return composeVisitLetterLeadParagraphFallback({
    recipient: recipientName,
    areaContext,
    visitPerson,
    visitTime,
    unitType,
    purpose,
  })
}

function buildVisitLetterGenerationContract(input: {
  profile: TemplateProfile
  region: TemplateRegion
  fieldValues: Map<string, string>
  instruction: string
}): RegionGenerationContract {
  const recipient = input.fieldValues.get(`${SAMPLE_FIELD_PREFIX}-recipient`) || '陕西省招生办公室'
  const province = input.fieldValues.get(`${SAMPLE_FIELD_PREFIX}-province`) || '陕西省'
  const visitPerson = input.fieldValues.get(`${SAMPLE_FIELD_PREFIX}-visit-person`) || '顾阳教授等一行3人'
  const visitTime = input.fieldValues.get(`${SAMPLE_FIELD_PREFIX}-visit-time`) || '2017年11月7日（周二）下午'
  const recipientName = stripTrailingColon(recipient) || '陕西省招生办公室'
  const areaContext = resolveAreaContext(province)
  const unitType = inferRecipientUnitType(recipientName)
  const purpose = inferVisitPurpose(input.instruction, unitType)
  const paragraphTarget = Math.max(1, input.region.blockRange.end - input.region.blockRange.start)

  return {
    templateKind: 'visit-letter',
    contextSummary: [
      `收函单位: ${recipientName}`,
      `地区信息: ${areaContext.areaName}（${areaContext.areaTypeLabel}）`,
      `单位类型: ${unitType}`,
      `来访人员: ${visitPerson}`,
      `拜访时间: ${visitTime}`,
      `主要事项: ${purpose}`,
      input.instruction ? `用户补充要求: ${extractUserDemandText(input.instruction)}` : '',
    ].filter(Boolean).join('\n'),
    paragraphInstructions: [
      `首段结合${areaContext.areaName}的教育/生源背景与${recipientName}的职责，说明此次来访背景，并自然引出${visitPerson}拟于${visitTime}到访。`,
      '第二段概述学校发展情况、人才培养特色和当前拟沟通的招生或交流事项，保持正式公函语气，不写成宣传稿。',
      purpose === '招生工作'
        ? `最后一段明确希望与${recipientName}就招生工作进一步沟通，并对后续支持、协作或优秀生源推荐表达正式请求。`
        : `最后一段明确希望与${recipientName}围绕相关事项进一步沟通协作，并自然收束到后续安排。`,
    ].slice(0, paragraphTarget),
    mustInclude: [recipientName, visitPerson, visitTime, areaContext.areaName, purpose].filter(Boolean),
    avoidPhrases: ['统计数据显示', '升学率', '录取率', '排名', '全国第一', '顶尖', '爆发式增长'],
    styleConstraints: [
      '必须保持正式拜访函口吻，不要写成宣传稿或新闻稿。',
      '不要编造数据、排名、录取表现、政策成效或其他无法核验的事实。',
      '只生成正文区域内容，不改标题、称谓、落款、日期和版式。',
    ],
    paragraphTarget,
    fallbackText: joinStructuredParagraphs(buildVisitLetterFallbackParagraphs({
      recipient: recipientName,
      areaContext,
      visitPerson,
      visitTime,
      unitType,
      purpose,
    }).slice(0, paragraphTarget)),
  }
}

function composeVisitLetterLeadParagraphFallback(input: {
  recipient: string
  areaContext: ReturnType<typeof resolveAreaContext>
  visitPerson: string
  visitTime: string
  unitType: string
  purpose: string
}): string {
  const backgroundSentences = buildVisitLetterBackgroundSentences(input.areaContext, input.unitType)
  const visitSentence = buildVisitReasonSentence(
    input.areaContext.areaName,
    input.recipient,
    input.visitPerson,
    input.visitTime,
    input.purpose,
  )
  return [...backgroundSentences, visitSentence].filter(Boolean).join('')
}

function buildVisitLetterFallbackParagraphs(input: {
  recipient: string
  areaContext: ReturnType<typeof resolveAreaContext>
  visitPerson: string
  visitTime: string
  unitType: string
  purpose: string
}): string[] {
  const firstParagraph = composeVisitLetterLeadParagraphFallback(input)
  const secondParagraph = input.purpose === '招生工作'
    ? `届时，我校拟就学校近年发展情况、人才培养特色以及在${input.areaContext.areaName}开展招生工作的整体安排向${input.recipient}作简要介绍，并就后续沟通协作听取意见。`
    : `届时，我校拟就学校近年发展情况、人才培养特色及相关工作安排向${input.recipient}作简要介绍，并就后续交流协作听取意见。`
  const thirdParagraph = input.purpose === '招生工作'
    ? `同时，恳请${input.recipient}在后续沟通衔接、政策宣传与优质生源推荐等方面继续给予指导与支持，以便我校进一步做好在${input.areaContext.areaName}的招生工作。`
    : `同时，希望双方围绕相关事项进一步加强沟通对接，推动后续交流安排有序开展。`

  return [firstParagraph, secondParagraph, thirdParagraph]
    .map((paragraph) => normalizeSingleParagraphText(paragraph))
    .filter(Boolean)
}

function buildVisitLetterBackgroundSentences(
  areaContext: ReturnType<typeof resolveAreaContext>,
  unitType: string,
): string[] {
  const areaSentence = buildNeutralAreaSentence(areaContext)
  const unitSentence = buildNeutralUnitSentence(unitType)
  return [areaSentence, unitSentence].filter(Boolean).slice(0, 2)
}

function buildNeutralAreaSentence(areaContext: ReturnType<typeof resolveAreaContext>): string {
  const areaName = areaContext.areaName || '当地'
  if (areaName.includes('浙江')) {
    return '浙江基础教育基础扎实，学生综合素质较高，区域经济活力强、开放程度高，与我校相关人才培养方向具有较高契合度。'
  }
  if (areaName.includes('江苏')) {
    return '江苏教育资源丰富，生源基础较好，学生学业能力较强，与我校在多学科人才培养方面具有较强匹配度。'
  }
  if (areaContext.areaType === 'city') {
    return `${areaName}教育基础较为扎实，区域发展活力较强，与我校相关人才培养方向具有一定契合度。`
  }
  if (areaContext.areaType === 'district') {
    return `${areaName}教育工作基础较好，学校培养与升学服务衔接较为紧密，与我校此次来访事项具有一定相关性。`
  }
  return `${areaName}教育资源较为丰富，生源基础较好，与我校相关人才培养方向具有一定契合度。`
}

function buildNeutralUnitSentence(unitType: string): string {
  if (unitType === '考试招生机构' || unitType === '招生管理部门') {
    return '贵单位在当地考试招生组织与沟通衔接方面承担相关工作，与我校此次拜访事项直接相关。'
  }
  if (unitType === '教育行政部门') {
    return '贵单位在区域教育统筹与沟通协调方面承担相关职责，与我校此次交流事项具有较强相关性。'
  }
  if (unitType === '中学') {
    return '贵校在学生培养与升学指导方面积累了较多实践经验，与我校此次交流内容相关。'
  }
  return ''
}

function buildVisitReasonSentence(
  areaName: string,
  recipient: string,
  visitPerson: string,
  visitTime: string,
  purpose: string,
): string {
  if (purpose === '招生工作') {
    return `为进一步做好今年在${areaName}的招生工作，我校${visitPerson}拟于${visitTime}到访，希望就相关招生工作向${recipient}汇报沟通。`
  }
  if (purpose === '交流合作事项') {
    return `为进一步加强与${recipient}的工作联系，我校${visitPerson}拟于${visitTime}到访，希望就交流合作相关事项进行沟通。`
  }
  return `为进一步加强与${recipient}的沟通联系，我校${visitPerson}拟于${visitTime}到访，希望就相关事项进行交流。`
}

function resolveAreaContext(value: string): {
  areaName: string
  areaType: 'province' | 'city' | 'district' | 'region'
  areaTypeLabel: string
} {
  const areaName = String(value || '').trim() || '当地'
  if (/(省|自治区|特别行政区)$/.test(areaName)) {
    return { areaName, areaType: 'province', areaTypeLabel: '省份' }
  }
  if (/市$/.test(areaName)) {
    return { areaName, areaType: 'city', areaTypeLabel: '城市' }
  }
  if (/(区|县|旗)$/.test(areaName)) {
    return { areaName, areaType: 'district', areaTypeLabel: '地区' }
  }
  return { areaName, areaType: 'region', areaTypeLabel: '区域' }
}

function inferRecipientUnitType(recipient: string): string {
  if (/(考试院|考试中心)/.test(recipient)) return '考试招生机构'
  if (/(招生办公室|招生办|招办)/.test(recipient)) return '招生管理部门'
  if (/(教育局|教委|教育厅|教育考试院)/.test(recipient)) return '教育行政部门'
  if (/(中学|高中)/.test(recipient)) return '中学'
  if (/(大学|学院)/.test(recipient)) return '高校'
  return '相关单位'
}

function inferVisitPurpose(instruction: string, unitType: string): string {
  const normalized = String(instruction || '')
  if (/(合作|共建|协同)/.test(normalized)) return '交流合作事项'
  if (/(招生|生源|录取)/.test(normalized)) return '招生工作'
  if (unitType === '考试招生机构' || unitType === '招生管理部门') return '招生工作'
  return '交流事项'
}