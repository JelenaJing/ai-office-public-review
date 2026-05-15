import type { AppSettings } from './settingsStore'
import { completeText } from './llmClient'
import { searchReferences, type ReferenceItem } from './openAlexClient'

export interface CitationSuggestion {
  sentenceText: string
  referenceIndex: number
  position: 'start' | 'middle' | 'end'
  relevanceReason?: string
}

export interface ParagraphCitationAnalysis {
  paragraphIndex: number
  paragraphText: string
  citationSuggestions: Array<CitationSuggestion & { reference: ReferenceItem }>
}

export interface ReferenceNumberedItem {
  number: number
  reference: ReferenceItem
}

export interface ReferenceOrganizeParams {
  topic: string
  paperMarkdown: string
  references: ReferenceItem[]
  enableVerification?: boolean
  analysisWindowSize?: number
  targetReferenceCount?: number
  referenceSoftFloorPercent?: number
  referenceTargetMode?: 'soft' | 'hard'
  supplementalMode?: 'off' | 'weak' | 'strong'
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.round(value)))
}

export type ReferenceOrganizeStreamUpdate =
  | { type: 'status'; message: string; progress?: number }
  | { type: 'paragraph_analyzed'; paragraphIndex: number; citationsFound: number; message: string }
  | {
      type: 'reference_inserted'
      paragraphIndex: number
      updatedParagraph: string
      citationNumber: number
      citation: string
      sentenceText: string
      currentMarkdown: string
      accumulatedReferences: Array<[number, string]>
      references: ReferenceItem[]
    }
  | {
      type: 'complete'
      status: 'success'
      updatedMarkdown: string
      referenceList: ReferenceItem[]
      numberedReferences: ReferenceNumberedItem[]
      sentenceChanges: Array<{ paragraphIndex: number; oldText: string; newText: string }>
    }
  | { type: 'error'; status: 'failed'; error: string }

class ReferenceNumberManager {
  private readonly citationToNumber = new Map<string, number>()
  private readonly numberToReference = new Map<number, ReferenceItem>()
  private readonly numberUsageCount = new Map<number, number>()
  private nextNumber = 1

  addFixedNumber(number: number, reference: ReferenceItem): void {
    if (!Number.isFinite(number) || number < 1) return
    const key = makeReferenceKey(reference)
    this.citationToNumber.set(key, number)
    this.numberToReference.set(number, reference)
    if (!this.numberUsageCount.has(number)) this.numberUsageCount.set(number, 0)
    this.nextNumber = Math.max(this.nextNumber, number + 1)
  }

  getOrAssignNumber(reference: ReferenceItem): number {
    const key = makeReferenceKey(reference)
    const existing = this.citationToNumber.get(key)
    if (existing) return existing
    const next = this.nextNumber
    this.nextNumber += 1
    this.citationToNumber.set(key, next)
    this.numberToReference.set(next, reference)
    this.numberUsageCount.set(next, 0)
    return next
  }

  hasReference(reference: ReferenceItem): boolean {
    return this.citationToNumber.has(makeReferenceKey(reference))
  }

  getNumber(reference: ReferenceItem): number | null {
    return this.citationToNumber.get(makeReferenceKey(reference)) ?? null
  }

  getUsageCount(reference: ReferenceItem): number {
    const number = this.getNumber(reference)
    if (!number) return 0
    return this.numberUsageCount.get(number) ?? 0
  }

  getUsageCountByNumber(number: number): number {
    return this.numberUsageCount.get(number) ?? 0
  }

  getReferenceByNumber(number: number): ReferenceItem | null {
    return this.numberToReference.get(number) ?? null
  }

  recordCitationUsage(number: number): void {
    if (!Number.isFinite(number) || number < 1) return
    this.numberUsageCount.set(number, (this.numberUsageCount.get(number) ?? 0) + 1)
  }

  removeCitationUsage(number: number): void {
    if (!Number.isFinite(number) || number < 1) return
    this.numberUsageCount.set(number, Math.max(0, (this.numberUsageCount.get(number) ?? 0) - 1))
  }

  getAllReferences(): ReferenceNumberedItem[] {
    return Array.from(this.numberToReference.entries())
      .sort((left, right) => left[0] - right[0])
      .map(([number, reference]) => ({ number, reference }))
  }
}

interface CitationVerificationResult {
  isValid: boolean
  relevanceScore: number
  reason: string
  contentUsed: 'abstract' | 'title' | 'none'
}

interface SupplementalCitationAction {
  paragraphIndex: number
  sentenceText: string
  reference: ReferenceItem
}

interface CitedSentence {
  sentence: string
  refNumbers: number[]
}

const RELEVANCE_THRESHOLD = 0.56
const NEW_REFERENCE_THRESHOLD = 0.72
const MAX_EXISTING_REFERENCE_CHECKS = 6
const MAX_VERIFICATION_SENTENCES = 4
const MAX_VERIFICATION_PAIRS = 8
const MAX_PREFERRED_REFERENCE_USAGE = 2
const MIN_DIVERSIFIED_REFERENCE_SCORE = 3

function makeReferenceKey(reference: ReferenceItem): string {
  const doi = String(reference.doi || '').trim().toLowerCase()
  if (doi) return `doi:${doi}`
  return `title:${String(reference.title || '').trim().toLowerCase()}|year:${String(reference.year || '').trim()}`
}

interface PreparedParagraph {
  original: string
  clean: string
}

function stripMarkdownDecoration(text: string): string {
  return String(text || '')
    .trim()
    .replace(/^\*\*(.+)\*\*$/s, '$1')
    .replace(/^__(.+)__$/s, '$1')
    .replace(/^_(.+)_$/s, '$1')
    .replace(/^\*(.+)\*$/s, '$1')
    .trim()
}

function isStructuredCaptionParagraph(paragraph: string): boolean {
  const normalized = stripMarkdownDecoration(paragraph)
  return /^(图|表|figure|fig\.?|table)\s*\d+([\s.:：-]|$)/i.test(normalized)
}

function isStructuredMediaParagraph(paragraph: string): boolean {
  const normalized = String(paragraph || '').trim()
  if (!normalized) return false
  if (/!\[[^\]]*\]\([^\n)]+\)/.test(normalized)) return true
  if (/<img\b/i.test(normalized)) return true
  if (/file:\/\//i.test(normalized)) return true
  if (/^\|.+\|$/m.test(normalized) || /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/m.test(normalized)) return true
  if (isStructuredCaptionParagraph(normalized)) return true
  return false
}

function stripExistingCitationMarks(text: string): string {
  return text.replace(/\[(\d+)(?:\s*[,-]\s*\d+)*\]/g, '').replace(/\s{2,}/g, ' ').trim()
}

function countCitationGroups(text: string): number {
  return Array.from(String(text || '').matchAll(/\[(\d+(?:\s*[,-]\s*\d+)*)\]/g)).length
}

function stripThinkingBlocks(markdown: string): string {
  return markdown
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
}

function stripReferencesSection(markdown: string): string {
  return markdown.replace(/\n##\s*(参考文献|References)[\s\S]*$/i, '').trim()
}

function stripAbstractSection(markdown: string): string {
  return String(markdown || '')
    .replace(/(^|\n)##\s*(摘要|Abstract)\s*\n[\s\S]*?(?=\n##\s+|\n#\s+|$)/i, '$1')
    .trim()
}

function stripInlineCitationMarks(text: string): string {
  return String(text || '')
    .split('\n')
    .map((line) => line.replace(/\s*\[(\d+(?:\s*[,-]\s*\d+)*)\]/g, '').replace(/\s{2,}/g, ' ').replace(/[ \t]+([,.;:!?。！？])/g, '$1').trimEnd())
    .join('\n')
}

function stripAbstractCitationMarks(markdown: string): string {
  return String(markdown || '').replace(/(^|\n)(##\s*(摘要|Abstract)\s*\n)([\s\S]*?)(?=\n##\s+|\n#\s+|$)/i, (_match, prefix, heading, _title, body) => {
    const cleanedBody = stripInlineCitationMarks(String(body || '')).trim()
    return `${prefix}${heading}${cleanedBody}${cleanedBody ? '\n' : ''}`
  })
}

function normalizeComparableText(text: string): string {
  return String(text || '')
    .replace(/\[(\d+)(?:\s*[,-]\s*\d+)*\]/g, '')
    .replace(/[“”"'`]/g, '')
    .replace(/[，。！？；：,.!?;:()（）【】\[\]{}<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function meaningfulComparableLength(markdown: string): number {
  return normalizeComparableText(stripExistingCitationMarks(stripReferencesSection(markdown))).replace(/\s+/g, '').length
}

export function extractReferenceParagraphs(markdown: string): PreparedParagraph[] {
  return stripAbstractSection(stripThinkingBlocks(stripReferencesSection(markdown)))
    .split(/\n\s*\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !item.startsWith('#'))
    .filter((item) => !isStructuredMediaParagraph(item))
    .filter((item) => item.length >= 50)
    .map((item) => ({ original: item, clean: stripExistingCitationMarks(item) }))
}

function extractParagraphs(markdown: string): PreparedParagraph[] {
  return extractReferenceParagraphs(markdown)
}

function parseJsonObject(raw: string): Record<string, any> | null {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return null
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = codeBlockMatch ? codeBlockMatch[1].trim() : trimmed
  const objectMatch = candidate.match(/\{[\s\S]*\}/)
  const objectText = objectMatch ? objectMatch[0] : candidate
  try {
    return JSON.parse(objectText) as Record<string, any>
  } catch {
    return null
  }
}

function extractCitationNumbers(text: string): number[] {
  const matches = Array.from(text.matchAll(/\[(\d+(?:\s*[,-]\s*\d+)*)\]/g))
  const numbers: number[] = []
  for (const match of matches) {
    const content = String(match[1] || '').trim()
    const parts = content.split(',').map((item) => item.trim()).filter(Boolean)
    for (const part of parts) {
      if (part.includes('-')) {
        const [startRaw, endRaw] = part.split('-').map((item) => Number(item.trim()))
        if (Number.isFinite(startRaw) && Number.isFinite(endRaw) && endRaw >= startRaw) {
          for (let value = startRaw; value <= endRaw; value += 1) numbers.push(value)
        }
        continue
      }
      const value = Number(part)
      if (Number.isFinite(value)) numbers.push(value)
    }
  }
  return numbers
}

function formatCitationNumbers(numbers: number[]): string {
  const uniqueNumbers = Array.from(new Set(numbers)).sort((left, right) => left - right)
  if (uniqueNumbers.length === 0) return ''
  if (uniqueNumbers.length === 1) return `[${uniqueNumbers[0]}]`
  if (uniqueNumbers.length <= 4) return `[${uniqueNumbers.join(', ')}]`

  const preview = uniqueNumbers.slice(0, 4)
  const contiguous = preview[preview.length - 1] - preview[0] + 1 === preview.length
  return contiguous ? `[${preview[0]}-${preview[preview.length - 1]}]` : `[${preview.join(', ')}]`
}

function updateReferenceNumbersInText(text: string, replacementMap: Map<number, number | null>): string {
  if (replacementMap.size === 0) return text

  return text
    .replace(/\[(\d+(?:\s*[,-]\s*\d+)*)\]/g, (fullMatch, content) => {
      const currentNumbers = extractCitationNumbers(`[${String(content || '')}]`)
      const updatedNumbers: number[] = []
      for (const number of currentNumbers) {
        if (replacementMap.has(number)) {
          const next = replacementMap.get(number)
          if (typeof next === 'number' && Number.isFinite(next)) updatedNumbers.push(next)
        } else {
          updatedNumbers.push(number)
        }
      }
      const rebuilt = formatCitationNumbers(updatedNumbers)
      return rebuilt || ''
    })
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.;:!?。！？])/g, '$1')
}

function extractCitedSentences(markdown: string): CitedSentence[] {
  const paragraphs = extractParagraphs(markdown)
  const sentences: CitedSentence[] = []

  for (const paragraph of paragraphs) {
    for (const segment of findSentenceSegments(paragraph.original)) {
      const refNumbers = extractCitationNumbers(segment.text)
      if (refNumbers.length === 0) continue
      sentences.push({
        sentence: segment.text.trim(),
        refNumbers: Array.from(new Set(refNumbers)).sort((left, right) => left - right),
      })
    }
  }

  return sentences
}

function collectCitationOrder(markdown: string): number[] {
  const ordered: number[] = []
  const seen = new Set<number>()
  for (const match of markdown.matchAll(/\[(\d+(?:\s*[,-]\s*\d+)*)\]/g)) {
    for (const number of extractCitationNumbers(match[0])) {
      if (seen.has(number)) continue
      seen.add(number)
      ordered.push(number)
    }
  }
  return ordered
}

async function verifyCitationRelevance(
  settings: AppSettings,
  sentence: string,
  reference: ReferenceItem,
): Promise<CitationVerificationResult> {
  const abstract = String(reference.abstract || '').trim()
  const title = String(reference.title || '').trim()
  const content = abstract || title
  const contentUsed: CitationVerificationResult['contentUsed'] = abstract ? 'abstract' : title ? 'title' : 'none'

  if (!content || content.length < 10) {
    return {
      isValid: false,
      relevanceScore: 0,
      reason: 'Reference content is too short',
      contentUsed,
    }
  }

  try {
    const response = await completeText(settings, {
      systemPrompt: 'You are an academic citation verification expert. Return JSON only.',
      userPrompt: `验证以下句子是否能被给定参考文献支持。\n\n句子:\n${sentence}\n\n参考文献${contentUsed === 'abstract' ? '摘要' : '标题'}:\n${content.slice(0, 1200)}\n\n输出 JSON:\n{\n  "is_valid": true,\n  "relevance_score": 0.85,\n  "reason": "brief reason"\n}`,
      temperature: 0.1,
      maxTokens: 260,
    })

    const parsed = parseJsonObject(response)
    return {
      isValid: Boolean(parsed?.is_valid),
      relevanceScore: Number(parsed?.relevance_score ?? 0),
      reason: String(parsed?.reason || ''),
      contentUsed,
    }
  } catch (error) {
    return {
      isValid: true,
      relevanceScore: 0.5,
      reason: error instanceof Error ? error.message : String(error),
      contentUsed,
    }
  }
}

async function findBetterReferenceFromExisting(
  settings: AppSettings,
  sentence: string,
  currentRef: number,
  currentScore: number,
  referencesByNumber: Map<number, ReferenceItem>,
  excludedRefs: Set<number>,
): Promise<{ refNumber: number; score: number } | null> {
  let bestMatch: { refNumber: number; score: number } | null = null
  let checked = 0

  for (const [refNumber, reference] of Array.from(referencesByNumber.entries()).sort((left, right) => left[0] - right[0])) {
    if (refNumber === currentRef || excludedRefs.has(refNumber)) continue
    const verification = await verifyCitationRelevance(settings, sentence, reference)
    checked += 1
    if (verification.relevanceScore >= Math.max(NEW_REFERENCE_THRESHOLD, currentScore + 0.1)) {
      if (!bestMatch || verification.relevanceScore > bestMatch.score) {
        bestMatch = { refNumber, score: verification.relevanceScore }
      }
    }
    if (checked >= MAX_EXISTING_REFERENCE_CHECKS) break
  }

  return bestMatch
}

function extractSearchQuery(sentence: string, topic: string): string {
  const englishWords = Array.from(
    new Set(
      String(sentence || '')
        .toLowerCase()
        .match(/[a-z][a-z-]{3,}/g) || [],
    ),
  ).slice(0, 4)

  const chineseTerms = Array.from(
    new Set(String(sentence || '').match(/[\u4e00-\u9fa5]{2,}/g) || []),
  ).slice(0, 3)

  const terms = [...englishWords, ...chineseTerms].slice(0, 4)
  return terms.length > 0 ? `${topic} ${terms.join(' ')}`.trim() : topic
}

function tokenizeForSearch(text: string): string[] {
  const englishWords = String(text || '')
    .toLowerCase()
    .match(/[a-z][a-z-]{2,}/g) || []

  const chineseTerms = String(text || '').match(/[\u4e00-\u9fa5]{2,}/g) || []

  return Array.from(new Set([...englishWords, ...chineseTerms]))
}

function scoreReferenceForBatch(reference: ReferenceItem, tokens: string[], topic: string): number {
  const title = String(reference.title || '').toLowerCase()
  const abstract = String(reference.abstract || '').toLowerCase()
  const journal = String(reference.journal || '').toLowerCase()
  const topicTokens = tokenizeForSearch(topic)

  let score = 0
  for (const token of tokens) {
    const lowerToken = token.toLowerCase()
    if (title.includes(lowerToken)) score += 5
    if (abstract.includes(lowerToken)) score += 2
    if (journal.includes(lowerToken)) score += 1
  }

  for (const token of topicTokens) {
    if (title.includes(token.toLowerCase())) score += 1.5
    if (abstract.includes(token.toLowerCase())) score += 0.5
  }

  if (reference.year && reference.year >= new Date().getFullYear() - 5) score += 0.8
  return score
}

function findDiversifiedReferenceCandidate(
  topic: string,
  paragraphText: string,
  sentenceText: string,
  references: ReferenceItem[],
  numberManager: ReferenceNumberManager,
  preferredReference: ReferenceItem,
): ReferenceItem | null {
  const unusedReferences = references.filter((reference) => !numberManager.hasReference(reference))
  if (unusedReferences.length === 0) return null

  const tokens = tokenizeForSearch(`${topic} ${paragraphText} ${sentenceText}`)
  const preferredScore = scoreReferenceForBatch(preferredReference, tokens, topic)
  const candidate = unusedReferences
    .map((reference, index) => ({
      reference,
      index,
      score: scoreReferenceForBatch(reference, tokens, topic),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score
      return left.index - right.index
    })[0]

  if (!candidate) return null
  if (candidate.score < MIN_DIVERSIFIED_REFERENCE_SCORE) return null
  if (preferredScore > 0 && candidate.score + 2 < preferredScore) return null
  return candidate.reference
}

function findBestUnusedReferenceCandidate(
  topic: string,
  paragraphText: string,
  sentenceText: string,
  references: ReferenceItem[],
  numberManager: ReferenceNumberManager,
): ReferenceItem | null {
  const unusedReferences = references.filter((reference) => !numberManager.hasReference(reference))
  if (unusedReferences.length === 0) return null

  const tokens = tokenizeForSearch(`${topic} ${paragraphText} ${sentenceText}`)
  const candidate = unusedReferences
    .map((reference, index) => ({
      reference,
      index,
      score: scoreReferenceForBatch(reference, tokens, topic),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score
      return left.index - right.index
    })[0]

  if (!candidate || candidate.score < MIN_DIVERSIFIED_REFERENCE_SCORE) return null
  return candidate.reference
}

function selectReferenceForSuggestion(
  topic: string,
  paragraphText: string,
  sentenceText: string,
  preferredReference: ReferenceItem,
  references: ReferenceItem[],
  numberManager: ReferenceNumberManager,
  targetReferenceCount: number,
  referenceTargetMode: 'soft' | 'hard',
): ReferenceItem {
  if (referenceTargetMode !== 'hard') return preferredReference

  const uniqueReferenceCount = numberManager.getAllReferences().length
  const preferredUsage = numberManager.getUsageCount(preferredReference)
  const shouldDiversify =
    uniqueReferenceCount < targetReferenceCount &&
    numberManager.hasReference(preferredReference) &&
    preferredUsage >= MAX_PREFERRED_REFERENCE_USAGE

  if (!shouldDiversify) return preferredReference

  return findDiversifiedReferenceCandidate(
    topic,
    paragraphText,
    sentenceText,
    references,
    numberManager,
    preferredReference,
  ) || preferredReference
}

function selectReferenceWindow(
  topic: string,
  paragraphs: PreparedParagraph[],
  references: ReferenceItem[],
  analysisWindowSize: number,
): ReferenceItem[] {
  if (references.length <= analysisWindowSize) return references

  const tokens = tokenizeForSearch(`${topic} ${paragraphs.map((item) => item.clean).join(' ')}`)
  return references
    .map((reference, index) => ({
      reference,
      index,
      score: scoreReferenceForBatch(reference, tokens, topic),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score
      return left.index - right.index
    })
    .slice(0, analysisWindowSize)
    .map((item) => item.reference)
}

async function searchReplacementReference(
  settings: AppSettings,
  sentence: string,
  topic: string,
  referencesByNumber: Map<number, ReferenceItem>,
): Promise<ReferenceItem | null> {
  const existingKeys = new Set(Array.from(referencesByNumber.values()).map((item) => makeReferenceKey(item)))
  const candidates = await searchReferences({
    topic: extractSearchQuery(sentence, topic),
    maxResults: 5,
  })

  for (const candidate of candidates.slice(0, 3)) {
    if (existingKeys.has(makeReferenceKey(candidate))) continue
    const verification = await verifyCitationRelevance(settings, sentence, candidate)
    if (verification.relevanceScore >= NEW_REFERENCE_THRESHOLD) {
      return candidate
    }
  }

  return null
}

async function verifyAndFixCitations(
  settings: AppSettings,
  topic: string,
  markdown: string,
  referencesByNumber: Map<number, ReferenceItem>,
): Promise<{ updatedMarkdown: string; referencesByNumber: Map<number, ReferenceItem> }> {
  const citedSentences = extractCitedSentences(markdown).slice(0, MAX_VERIFICATION_SENTENCES)
  if (citedSentences.length === 0) {
    return { updatedMarkdown: markdown, referencesByNumber }
  }

  const replacementMap = new Map<number, number | null>()
  const updatedReferences = new Map(referencesByNumber)
  let nextNumber = Math.max(0, ...Array.from(updatedReferences.keys())) + 1
  let remainingVerificationPairs = MAX_VERIFICATION_PAIRS

  for (const citedSentence of citedSentences) {
    if (remainingVerificationPairs <= 0) break
    const excludedRefs = new Set(citedSentence.refNumbers)
    for (const refNumber of citedSentence.refNumbers) {
      if (remainingVerificationPairs <= 0) break
      if (replacementMap.has(refNumber)) continue
      const reference = updatedReferences.get(refNumber)
      if (!reference) continue

      const verification = await verifyCitationRelevance(settings, citedSentence.sentence, reference)
      remainingVerificationPairs -= 1
      if (verification.isValid && verification.relevanceScore >= RELEVANCE_THRESHOLD) {
        continue
      }

      const betterExisting = await findBetterReferenceFromExisting(
        settings,
        citedSentence.sentence,
        refNumber,
        verification.relevanceScore,
        updatedReferences,
        excludedRefs,
      )

      if (betterExisting) {
        replacementMap.set(refNumber, betterExisting.refNumber)
        continue
      }

      const replacementReference = await searchReplacementReference(settings, citedSentence.sentence, topic, updatedReferences)
      if (replacementReference) {
        updatedReferences.set(nextNumber, replacementReference)
        replacementMap.set(refNumber, nextNumber)
        nextNumber += 1
        continue
      }
    }
  }

  return {
    updatedMarkdown: updateReferenceNumbersInText(markdown, replacementMap),
    referencesByNumber: updatedReferences,
  }
}

function remapReferenceNumbers(
  markdown: string,
  referencesByNumber: Map<number, ReferenceItem>,
): { updatedMarkdown: string; numberedReferences: ReferenceNumberedItem[] } {
  const orderedNumbers = collectCitationOrder(markdown)
  const remap = new Map<number, number | null>()
  const renumberedReferences: ReferenceNumberedItem[] = []

  orderedNumbers.forEach((oldNumber, index) => {
    const reference = referencesByNumber.get(oldNumber)
    if (!reference) {
      remap.set(oldNumber, null)
      return
    }
    const newNumber = index + 1
    remap.set(oldNumber, newNumber)
    renumberedReferences.push({ number: newNumber, reference })
  })

  for (const oldNumber of referencesByNumber.keys()) {
    if (!remap.has(oldNumber)) remap.set(oldNumber, null)
  }

  return {
    updatedMarkdown: updateReferenceNumbersInText(markdown, remap),
    numberedReferences: renumberedReferences,
  }
}

async function analyzeParagraphBatch(
  settings: AppSettings,
  topic: string,
  paragraphs: PreparedParagraph[],
  paragraphOffset: number,
  references: ReferenceItem[],
  analysisWindowSize: number,
  targetReferenceCount: number,
  referenceTargetMode: 'soft' | 'hard',
): Promise<ParagraphCitationAnalysis[]> {
  const selectedReferences = selectReferenceWindow(topic, paragraphs, references, analysisWindowSize)
  const selectedReferencesSummary = selectedReferences
    .map((reference, index) => {
      const authors = reference.authors.slice(0, 4).join(', ') || 'Unknown Authors'
      const journal = reference.journal ? ` | ${reference.journal}` : ''
      const year = reference.year ?? 'n.d.'
      const abstract = reference.abstract ? `\nAbstract: ${reference.abstract}` : ''
      return `[${index + 1}] ${authors} (${year}). ${reference.title}.${journal}${abstract}`
    })
    .join('\n\n')

  const paragraphsText = paragraphs
    .map((paragraph, index) => `段落${paragraphOffset + index + 1}:\n${paragraph.clean}`)
    .join('\n\n')

  const response = await completeText(settings, {
    systemPrompt: 'You are an expert academic citation analyst. Return valid JSON only.',
    userPrompt: `请分析以下论文正文段落，判断哪些句子需要引用，并从给定候选文献中选择最匹配的参考文献。

论文主题: ${topic}
${referenceTargetMode === 'hard' ? `目标最终引用数: ${targetReferenceCount}` : `软目标参考数量: ${targetReferenceCount}（仅作宽松参考，不要为了凑数量而强行加引）`}

候选文献总量: ${references.length}
本轮精排分析窗口: ${selectedReferences.length}

候选文献:
${selectedReferencesSummary}

待分析段落:
${paragraphsText}

请返回 JSON，格式如下：
{
  "paragraphs": [
    {
      "paragraph_index": 0,
      "citations": [
        {
          "sentence_text": "需要引用的完整句子",
          "reference_index": 1,
          "position": "end",
          "relevance_reason": "为什么这篇文献适合"
        }
      ]
    }
  ]
}

要求：
1. 只为事实陈述、方法、实验结果、比较性结论添加引用。
2. 需要时再加引，不要机械地给每段凑引用；某些段落可以没有引用，某些段落也可以有多处引用。
3. 优先分散使用不同候选文献，避免反复只使用少数几篇。
4. 如果多个候选文献都能支撑句子，优先选择尚未被其他句子重复使用的文献。
5. position 只能是 start、middle、end。
6. reference_index 必须引用当前分析窗口中的候选文献编号。
7. 没有需要引用的句子时，citations 返回空数组。
8. 优先选择与当前段落关键词最接近、年份较新的文献。
9. 不要为了接近目标引用数而输出低相关度引用；相关性优先于数量。
10. 只能输出 JSON，不要输出额外说明。`,
    temperature: 0.2,
    maxTokens: 2600,
  })

  const parsed = parseJsonObject(response)
  const paragraphItems = Array.isArray(parsed?.paragraphs) ? parsed?.paragraphs : []

  return paragraphItems.map((item: Record<string, any>) => {
    const paragraphIndex = Number(item.paragraph_index ?? 0)
    const source = paragraphs[paragraphIndex]
    const suggestions = Array.isArray(item.citations) ? item.citations : []
    return {
      paragraphIndex: paragraphOffset + paragraphIndex,
      paragraphText: source?.original || '',
      citationSuggestions: suggestions
        .map((suggestion: Record<string, any>) => {
          const refIndex = Number(suggestion.reference_index ?? 0) - 1
          const reference = selectedReferences[refIndex]
          if (!reference) return null
          const position = String(suggestion.position || 'end').toLowerCase()
          return {
            sentenceText: String(suggestion.sentence_text || '').trim(),
            referenceIndex: refIndex,
            position: position === 'start' || position === 'middle' ? position : 'end',
            relevanceReason: String(suggestion.relevance_reason || '').trim(),
            reference,
          }
        })
        .filter(Boolean) as Array<CitationSuggestion & { reference: ReferenceItem }>,
    }
  }).filter((item) => item.paragraphText)
}

function findSentenceSegments(paragraph: string): Array<{ start: number; end: number; text: string }> {
  const regex = /[^.!?。！？]+[.!?。！？]?\s*/g
  const matches: Array<{ start: number; end: number; text: string }> = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(paragraph)) !== null) {
    matches.push({ start: match.index, end: regex.lastIndex, text: match[0] })
  }
  return matches.length > 0 ? matches : [{ start: 0, end: paragraph.length, text: paragraph }]
}

function matchSentenceIndex(paragraph: string, sentenceText: string): number {
  const normalizedTarget = normalizeComparableText(sentenceText)
  const sentences = findSentenceSegments(paragraph)
  for (let index = 0; index < sentences.length; index += 1) {
    const normalizedSentence = normalizeComparableText(sentences[index].text)
    if (!normalizedTarget || !normalizedSentence) continue
    if (normalizedSentence.includes(normalizedTarget) || normalizedTarget.includes(normalizedSentence)) {
      return index
    }
  }
  return -1
}

function matchSentenceSegment(paragraph: string, sentenceText: string): { start: number; end: number; text: string } | null {
  const normalizedTarget = normalizeComparableText(sentenceText)
  if (!normalizedTarget) return null
  const sentences = findSentenceSegments(paragraph)
  for (const sentence of sentences) {
    const normalizedSentence = normalizeComparableText(stripExistingCitationMarks(sentence.text))
    if (!normalizedSentence) continue
    if (normalizedSentence.includes(normalizedTarget) || normalizedTarget.includes(normalizedSentence)) {
      return sentence
    }
  }
  return null
}

function isCitationOnlyText(text: string): boolean {
  return !stripExistingCitationMarks(text).replace(/\s+/g, '').trim()
}

function insertCitationIntoSentence(sentence: string, numbers: number[]): string {
  if (numbers.length === 0) return sentence
  if (isCitationOnlyText(sentence)) return sentence
  const uniqueNumbers = Array.from(new Set(numbers)).sort((left, right) => left - right)
  const existingCitationMatch = sentence.match(/\[(\d+(?:\s*[,-]\s*\d+)*)\]/)
  if (existingCitationMatch) {
    const existingNumbers = extractCitationNumbers(existingCitationMatch[0])
    const mergedNumbers = Array.from(new Set([...existingNumbers, ...uniqueNumbers])).sort((left, right) => left - right)
    return sentence.replace(existingCitationMatch[0], formatCitationNumbers(mergedNumbers))
  }
  const citationText = formatCitationNumbers(uniqueNumbers)

  const punctuationMatch = sentence.match(/([.!?。！？]+)(\s*)$/)
  if (punctuationMatch) {
    const punctuation = punctuationMatch[1]
    const suffixSpace = punctuationMatch[2] || ''
    const body = sentence.slice(0, sentence.length - punctuation.length - suffixSpace.length).trimEnd()
    return `${body} ${citationText}${punctuation}${suffixSpace}`
  }
  return `${sentence.trimEnd()} ${citationText}`
}

function overwriteSentenceCitationNumbers(sentence: string, numbers: number[]): string {
  if (numbers.length === 0) return sentence
  if (isCitationOnlyText(sentence)) return sentence
  const existingCitationMatch = sentence.match(/\[(\d+(?:\s*[,-]\s*\d+)*)\]/)
  if (existingCitationMatch) {
    return sentence.replace(existingCitationMatch[0], formatCitationNumbers(numbers))
  }
  return insertCitationIntoSentence(sentence, numbers)
}

function rebuildMarkdownWithParagraph(originalMarkdown: string, oldParagraph: string, newParagraph: string): string {
  if (!oldParagraph || oldParagraph === newParagraph) return originalMarkdown
  if (!originalMarkdown.includes(oldParagraph)) return originalMarkdown
  return originalMarkdown.replace(oldParagraph, newParagraph)
}

function buildSupplementalCitationActions(
  analyses: ParagraphCitationAnalysis[],
  numberManager: ReferenceNumberManager,
): SupplementalCitationAction[] {
  const actions: SupplementalCitationAction[] = []
  const seen = new Set<string>()

  for (const analysis of analyses) {
    for (const suggestion of analysis.citationSuggestions) {
      if (numberManager.hasReference(suggestion.reference)) continue
      const key = `${analysis.paragraphIndex}::${normalizeComparableText(suggestion.sentenceText)}::${makeReferenceKey(suggestion.reference)}`
      if (seen.has(key)) continue
      seen.add(key)
      actions.push({
        paragraphIndex: analysis.paragraphIndex,
        sentenceText: suggestion.sentenceText,
        reference: suggestion.reference,
      })
    }
  }

  return actions
}

function buildDeterministicSupplementalCitationActions(
  topic: string,
  paragraphs: PreparedParagraph[],
  references: ReferenceItem[],
  numberManager: ReferenceNumberManager,
  targetReferenceCount: number,
  currentParagraphTexts: string[],
): SupplementalCitationAction[] {
  const needed = Math.max(0, targetReferenceCount - numberManager.getAllReferences().length)
  if (needed <= 0) return []

  const unusedReferences = references.filter((reference) => !numberManager.hasReference(reference))
  if (unusedReferences.length === 0) return []

  const paragraphPlans = paragraphs
    .map((paragraph, paragraphIndex) => ({
      paragraphIndex,
      paragraph,
      citationCount: countCitationGroups(currentParagraphTexts[paragraphIndex] || paragraph.original),
      sentences: findSentenceSegments(paragraph.clean)
        .map((segment) => segment.text.trim())
        .filter((text) => text.length >= 40),
      cursor: 0,
    }))
    .filter((item) => item.sentences.length > 0)
    .sort((left, right) => {
      if (left.citationCount !== right.citationCount) return left.citationCount - right.citationCount
      return left.paragraphIndex - right.paragraphIndex
    })

  if (paragraphPlans.length === 0) return []

  const actions: SupplementalCitationAction[] = []
  let stalledRounds = 0

  while (actions.length < needed && unusedReferences.length > 0 && stalledRounds < 2) {
    let progressed = false

    for (const plan of paragraphPlans) {
      if (actions.length >= needed || unusedReferences.length === 0) break
      const sentenceText = plan.sentences[plan.cursor % plan.sentences.length]
      plan.cursor += 1
      if (!sentenceText) continue

      const tokens = tokenizeForSearch(`${topic} ${plan.paragraph.clean}`)
      let bestIndex = -1
      let bestScore = Number.NEGATIVE_INFINITY

      for (let index = 0; index < unusedReferences.length; index += 1) {
        const score = scoreReferenceForBatch(unusedReferences[index], tokens, topic)
        if (score > bestScore) {
          bestScore = score
          bestIndex = index
        }
      }

      if (bestIndex < 0) continue
      const [reference] = unusedReferences.splice(bestIndex, 1)
      actions.push({
        paragraphIndex: plan.paragraphIndex,
        sentenceText,
        reference,
      })
      progressed = true
    }

    stalledRounds = progressed ? 0 : stalledRounds + 1
  }

  return actions
}

function rebalanceExistingCitationAssignments(
  topic: string,
  paragraphs: PreparedParagraph[],
  references: ReferenceItem[],
  numberManager: ReferenceNumberManager,
  targetReferenceCount: number,
  currentMarkdown: string,
  sentenceChanges: Array<{ paragraphIndex: number; oldText: string; newText: string }>,
): {
  updatedMarkdown: string
  sentenceChanges: Array<{ paragraphIndex: number; oldText: string; newText: string }>
} {
  if (references.length === 0) {
    return { updatedMarkdown: currentMarkdown, sentenceChanges }
  }

  let updatedMarkdown = currentMarkdown
  const updatedSentenceChanges = [...sentenceChanges]

  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
    if (numberManager.getAllReferences().length >= targetReferenceCount) break
    const paragraphEntry = paragraphs[paragraphIndex]
    if (!paragraphEntry) continue

    const originalParagraph = paragraphEntry.original
    const existingChangeIndex = updatedSentenceChanges.findIndex((item) => item.paragraphIndex === paragraphIndex)
    let currentParagraphSource = existingChangeIndex >= 0 ? updatedSentenceChanges[existingChangeIndex].newText : originalParagraph
    const sentences = findSentenceSegments(currentParagraphSource)
    let updatedParagraph = currentParagraphSource
    let offset = 0
    let paragraphChanged = false

    for (const sentence of sentences) {
      if (numberManager.getAllReferences().length >= targetReferenceCount) break

      const currentSentence = updatedParagraph.slice(sentence.start + offset, sentence.end + offset)
      const currentNumbers = Array.from(new Set(extractCitationNumbers(currentSentence))).sort((left, right) => left - right)
      if (currentNumbers.length !== 1) continue

      const currentNumber = currentNumbers[0]
      const currentReference = numberManager.getReferenceByNumber(currentNumber)
      const isUnmappedCitation = !currentReference
      if (!isUnmappedCitation && numberManager.getUsageCountByNumber(currentNumber) < MAX_PREFERRED_REFERENCE_USAGE) continue

      const plainSentence = stripExistingCitationMarks(currentSentence)
      const alternativeReference = isUnmappedCitation
        ? findBestUnusedReferenceCandidate(
          topic,
          paragraphEntry.clean,
          plainSentence,
          references,
          numberManager,
        )
        : findDiversifiedReferenceCandidate(
          topic,
          paragraphEntry.clean,
          plainSentence,
          references,
          numberManager,
          currentReference,
        )
      if (!alternativeReference) continue

      const alternativeNumber = numberManager.getOrAssignNumber(alternativeReference)
      if (alternativeNumber === currentNumber) continue

      const adjustedStart = sentence.start + offset
      const adjustedEnd = sentence.end + offset
      const before = updatedParagraph.slice(0, adjustedStart)
      const after = updatedParagraph.slice(adjustedEnd)
      const rewrittenSentence = overwriteSentenceCitationNumbers(currentSentence, [alternativeNumber])
      if (rewrittenSentence === currentSentence) continue

      updatedParagraph = `${before}${rewrittenSentence}${after}`
      offset += rewrittenSentence.length - currentSentence.length
      if (!isUnmappedCitation) numberManager.removeCitationUsage(currentNumber)
      if (alternativeNumber !== currentNumber) numberManager.recordCitationUsage(alternativeNumber)
      updatedMarkdown = rebuildMarkdownWithParagraph(updatedMarkdown, currentParagraphSource, updatedParagraph)
      currentParagraphSource = updatedParagraph
      paragraphChanged = true
    }

    if (!paragraphChanged) continue

    if (existingChangeIndex >= 0) {
      updatedSentenceChanges[existingChangeIndex] = { paragraphIndex, oldText: originalParagraph, newText: updatedParagraph }
    } else {
      updatedSentenceChanges.push({ paragraphIndex, oldText: originalParagraph, newText: updatedParagraph })
    }
  }

  return {
    updatedMarkdown,
    sentenceChanges: updatedSentenceChanges,
  }
}

export async function organizeReferencesStream(
  settings: AppSettings,
  params: ReferenceOrganizeParams,
  onUpdate: (update: ReferenceOrganizeStreamUpdate) => void,
): Promise<Extract<ReferenceOrganizeStreamUpdate, { type: 'complete' }>> {
  try {
    const paragraphs = extractParagraphs(params.paperMarkdown)
    if (paragraphs.length === 0 || params.references.length === 0) {
      const result: Extract<ReferenceOrganizeStreamUpdate, { type: 'complete' }> = {
        type: 'complete',
        status: 'success',
        updatedMarkdown: stripReferencesSection(params.paperMarkdown),
        referenceList: [],
        numberedReferences: [],
        sentenceChanges: [],
      }
      onUpdate(result)
      return result
    }

    onUpdate({ type: 'status', message: `开始分析 ${paragraphs.length} 个段落的引用需求`, progress: 10 })

    const analyses: ParagraphCitationAnalysis[] = []
    const batchSize = 4
    const analysisWindowSize = Math.max(5, Math.min(params.analysisWindowSize ?? 40, params.references.length))
    const targetReferenceCount = Math.max(1, params.targetReferenceCount ?? 36)
    const referenceTargetMode = params.referenceTargetMode === 'hard' ? 'hard' : 'soft'
    const referenceSoftFloorPercent = clampInteger(params.referenceSoftFloorPercent ?? 80, 0, 100)
    const enforcedReferenceCount = referenceTargetMode === 'hard'
      ? targetReferenceCount
      : Math.min(targetReferenceCount, Math.ceil(targetReferenceCount * (referenceSoftFloorPercent / 100)))
    const supplementalMode = params.supplementalMode === 'strong'
      ? 'strong'
      : params.supplementalMode === 'off'
        ? 'off'
        : 'weak'
    if (supplementalMode === 'off') {
      onUpdate({
        type: 'status',
        message: '当前模式只整理已有引用编号与校验结果，不新增补引',
        progress: 18,
      })
    } else {
      for (let start = 0; start < paragraphs.length; start += batchSize) {
        const batch = paragraphs.slice(start, start + batchSize)
        const batchAnalyses = await analyzeParagraphBatch(
          settings,
          params.topic,
          batch,
          start,
          params.references,
          analysisWindowSize,
          targetReferenceCount,
          referenceTargetMode,
        )
        for (const item of batchAnalyses) {
          analyses.push(item)
          onUpdate({
            type: 'paragraph_analyzed',
            paragraphIndex: item.paragraphIndex,
            citationsFound: item.citationSuggestions.length,
            message: `段落 ${item.paragraphIndex + 1} 分析完成，找到 ${item.citationSuggestions.length} 个引用建议`,
          })
        }
      }
    }

    const numberManager = new ReferenceNumberManager()
    const originalBodyMarkdown = stripAbstractCitationMarks(stripReferencesSection(params.paperMarkdown))
    const originalMeaningfulLength = meaningfulComparableLength(originalBodyMarkdown)
    let currentMarkdown = originalBodyMarkdown
    let sentenceChanges: Array<{ paragraphIndex: number; oldText: string; newText: string }> = []

    for (const number of Array.from(new Set(extractCitationNumbers(currentMarkdown))).sort((left, right) => left - right)) {
      const reference = params.references[number - 1]
      if (reference) numberManager.addFixedNumber(number, reference)
    }

    for (const match of currentMarkdown.matchAll(/\[(\d+(?:\s*[,-]\s*\d+)*)\]/g)) {
      for (const number of extractCitationNumbers(match[0])) {
        numberManager.recordCitationUsage(number)
      }
    }

    if (supplementalMode === 'strong' || referenceTargetMode === 'hard') {
      const rebalanced = rebalanceExistingCitationAssignments(
        params.topic,
        paragraphs,
        params.references,
        numberManager,
        targetReferenceCount,
        currentMarkdown,
        sentenceChanges,
      )
      currentMarkdown = rebalanced.updatedMarkdown
      sentenceChanges = rebalanced.sentenceChanges
    }

    for (const analysis of analyses.sort((left, right) => left.paragraphIndex - right.paragraphIndex)) {
      if (analysis.citationSuggestions.length === 0) continue
      const paragraphEntry = paragraphs[analysis.paragraphIndex]
      if (!paragraphEntry) continue

      const sentenceGroups = new Map<number, { numbers: number[]; sentenceText: string; refs: ReferenceItem[] }>()
      for (const suggestion of analysis.citationSuggestions) {
        const sentenceIndex = matchSentenceIndex(paragraphEntry.clean, suggestion.sentenceText)
        if (sentenceIndex < 0) continue
        const selectedReference = selectReferenceForSuggestion(
          params.topic,
          paragraphEntry.clean,
          suggestion.sentenceText,
          suggestion.reference,
          params.references,
          numberManager,
          targetReferenceCount,
          referenceTargetMode,
        )
        const assignedCount = numberManager.getAllReferences().length
        if (referenceTargetMode === 'hard' && assignedCount >= targetReferenceCount && !numberManager.hasReference(selectedReference)) continue
        const number = numberManager.getOrAssignNumber(selectedReference)
        const existing = sentenceGroups.get(sentenceIndex) || { numbers: [], sentenceText: suggestion.sentenceText, refs: [] }
        existing.numbers.push(number)
        existing.refs.push(selectedReference)
        sentenceGroups.set(sentenceIndex, existing)
      }

      if (sentenceGroups.size === 0) continue

      const originalParagraph = paragraphEntry.original
      const currentParagraphSource = sentenceChanges.find((item) => item.paragraphIndex === analysis.paragraphIndex)?.newText || originalParagraph
      let updatedParagraph = currentParagraphSource

      for (const [, group] of Array.from(sentenceGroups.entries()).sort((left, right) => left[0] - right[0])) {
        const sentence = matchSentenceSegment(updatedParagraph, group.sentenceText)
        if (!sentence) continue
        const uniqueGroupNumbers = Array.from(new Set(group.numbers)).sort((left, right) => left - right)
        const adjustedStart = sentence.start
        const adjustedEnd = sentence.end
        const before = updatedParagraph.slice(0, adjustedStart)
        const currentSentence = updatedParagraph.slice(adjustedStart, adjustedEnd)
        const after = updatedParagraph.slice(adjustedEnd)
        const rewrittenSentence = insertCitationIntoSentence(currentSentence, uniqueGroupNumbers)
        if (rewrittenSentence === currentSentence) continue
        updatedParagraph = `${before}${rewrittenSentence}${after}`
        uniqueGroupNumbers.forEach((number) => numberManager.recordCitationUsage(number))

        currentMarkdown = rebuildMarkdownWithParagraph(currentMarkdown, currentParagraphSource, updatedParagraph)
        const accumulated = numberManager.getAllReferences().map((item) => [item.number, `${item.reference.title}${item.reference.doi ? ` DOI: ${item.reference.doi}` : ''}`] as [number, string])
        for (const number of uniqueGroupNumbers) {
          const numberedRef = numberManager.getAllReferences().find((item) => item.number === number)
          if (!numberedRef) continue
          onUpdate({
            type: 'reference_inserted',
            paragraphIndex: analysis.paragraphIndex,
            updatedParagraph,
            citationNumber: number,
            citation: numberedRef.reference.title,
            sentenceText: group.sentenceText,
            currentMarkdown,
            accumulatedReferences: accumulated,
            references: numberManager.getAllReferences().map((item) => item.reference),
          })
        }
      }

      const existingIndex = sentenceChanges.findIndex((item) => item.paragraphIndex === analysis.paragraphIndex)
      if (existingIndex >= 0) {
        sentenceChanges[existingIndex] = { paragraphIndex: analysis.paragraphIndex, oldText: originalParagraph, newText: updatedParagraph }
      } else if (updatedParagraph !== originalParagraph) {
        sentenceChanges.push({ paragraphIndex: analysis.paragraphIndex, oldText: originalParagraph, newText: updatedParagraph })
      }
    }

    if (supplementalMode !== 'off' && numberManager.getAllReferences().length < enforcedReferenceCount) {
      onUpdate({
        type: 'status',
        message: referenceTargetMode === 'hard'
          ? `当前已整理 ${numberManager.getAllReferences().length} 篇文献，正在根据模型建议进行轻量补引，目标 ${targetReferenceCount} 篇`
          : `当前已整理 ${numberManager.getAllReferences().length} 篇文献，正在根据模型建议进行轻量补引，至少达到 ${enforcedReferenceCount}/${targetReferenceCount} 篇`,
        progress: 82,
      })

      const supplementalActions = buildSupplementalCitationActions(analyses, numberManager)
      for (const action of supplementalActions) {
        if (numberManager.getAllReferences().length >= enforcedReferenceCount) break
        const paragraphEntry = paragraphs[action.paragraphIndex]
        if (!paragraphEntry) continue

        const originalParagraph = paragraphEntry.original
        const currentParagraphSource = sentenceChanges.find((item) => item.paragraphIndex === action.paragraphIndex)?.newText || originalParagraph
        const sentence = matchSentenceSegment(currentParagraphSource, action.sentenceText)
        if (!sentence) continue

        const number = numberManager.getOrAssignNumber(action.reference)
        const before = currentParagraphSource.slice(0, sentence.start)
        const currentSentence = currentParagraphSource.slice(sentence.start, sentence.end)
        const after = currentParagraphSource.slice(sentence.end)
        const rewrittenSentence = insertCitationIntoSentence(currentSentence, [number])
        if (rewrittenSentence === currentSentence) continue

        const updatedParagraph = `${before}${rewrittenSentence}${after}`
        numberManager.recordCitationUsage(number)
        currentMarkdown = rebuildMarkdownWithParagraph(currentMarkdown, currentParagraphSource, updatedParagraph)
        const existingSupplementIndex = sentenceChanges.findIndex((item) => item.paragraphIndex === action.paragraphIndex)
        if (existingSupplementIndex >= 0) {
          sentenceChanges[existingSupplementIndex] = { paragraphIndex: action.paragraphIndex, oldText: originalParagraph, newText: updatedParagraph }
        } else {
          sentenceChanges.push({ paragraphIndex: action.paragraphIndex, oldText: originalParagraph, newText: updatedParagraph })
        }

        onUpdate({
          type: 'reference_inserted',
          paragraphIndex: action.paragraphIndex,
          updatedParagraph,
          citationNumber: number,
          citation: action.reference.title,
          sentenceText: action.sentenceText,
          currentMarkdown,
          accumulatedReferences: numberManager.getAllReferences().map((item) => [item.number, `${item.reference.title}${item.reference.doi ? ` DOI: ${item.reference.doi}` : ''}`] as [number, string]),
          references: numberManager.getAllReferences().map((item) => item.reference),
        })
      }
    }

    if (supplementalMode === 'strong' && numberManager.getAllReferences().length < enforcedReferenceCount) {
      onUpdate({
        type: 'status',
        message: referenceTargetMode === 'hard'
          ? `模型建议仍不足，正在根据段落内容自动扩充引用，当前 ${numberManager.getAllReferences().length}/${targetReferenceCount}`
          : `模型建议仍不足，正在根据段落内容自动扩充引用，当前 ${numberManager.getAllReferences().length}/${enforcedReferenceCount}（软目标 ${targetReferenceCount}）`,
        progress: 86,
      })

      const deterministicActions = buildDeterministicSupplementalCitationActions(
        params.topic,
        paragraphs,
        params.references,
        numberManager,
        enforcedReferenceCount,
        paragraphs.map(
          (paragraph, paragraphIndex) =>
            sentenceChanges.find((item) => item.paragraphIndex === paragraphIndex)?.newText || paragraph.original,
        ),
      )

      for (const action of deterministicActions) {
        if (numberManager.getAllReferences().length >= enforcedReferenceCount) break
        const paragraphEntry = paragraphs[action.paragraphIndex]
        if (!paragraphEntry) continue

        const originalParagraph = paragraphEntry.original
        const currentParagraphSource = sentenceChanges.find((item) => item.paragraphIndex === action.paragraphIndex)?.newText || originalParagraph
        const sentence = matchSentenceSegment(currentParagraphSource, action.sentenceText)
        if (!sentence) continue

        const number = numberManager.getOrAssignNumber(action.reference)
        const before = currentParagraphSource.slice(0, sentence.start)
        const currentSentence = currentParagraphSource.slice(sentence.start, sentence.end)
        const after = currentParagraphSource.slice(sentence.end)
        const rewrittenSentence = insertCitationIntoSentence(currentSentence, [number])
        if (rewrittenSentence === currentSentence) continue

        const updatedParagraph = `${before}${rewrittenSentence}${after}`
        numberManager.recordCitationUsage(number)
        currentMarkdown = rebuildMarkdownWithParagraph(currentMarkdown, currentParagraphSource, updatedParagraph)
        const existingSupplementIndex = sentenceChanges.findIndex((item) => item.paragraphIndex === action.paragraphIndex)
        if (existingSupplementIndex >= 0) {
          sentenceChanges[existingSupplementIndex] = { paragraphIndex: action.paragraphIndex, oldText: originalParagraph, newText: updatedParagraph }
        } else {
          sentenceChanges.push({ paragraphIndex: action.paragraphIndex, oldText: originalParagraph, newText: updatedParagraph })
        }

        onUpdate({
          type: 'reference_inserted',
          paragraphIndex: action.paragraphIndex,
          updatedParagraph,
          citationNumber: number,
          citation: action.reference.title,
          sentenceText: action.sentenceText,
          currentMarkdown,
          accumulatedReferences: numberManager.getAllReferences().map((item) => [item.number, `${item.reference.title}${item.reference.doi ? ` DOI: ${item.reference.doi}` : ''}`] as [number, string]),
          references: numberManager.getAllReferences().map((item) => item.reference),
        })
      }
    }

    let referencesByNumber = new Map<number, ReferenceItem>(
      numberManager.getAllReferences().map((item) => [item.number, item.reference]),
    )
    const citationCountBeforeVerification = collectCitationOrder(currentMarkdown).length
    const markdownBeforeVerification = currentMarkdown
    const referencesBeforeVerification = new Map(referencesByNumber)

    if (params.enableVerification !== false) {
      onUpdate({ type: 'status', message: '正在校验已插入引用的关联性', progress: 90 })
      const verified = await verifyAndFixCitations(settings, params.topic, currentMarkdown, referencesByNumber)
      currentMarkdown = verified.updatedMarkdown
      referencesByNumber = verified.referencesByNumber

      const citationCountAfterVerification = collectCitationOrder(currentMarkdown).length
      if (citationCountBeforeVerification > 0 && citationCountAfterVerification === 0) {
        currentMarkdown = markdownBeforeVerification
        referencesByNumber = referencesBeforeVerification
        onUpdate({
          type: 'status',
          message: '引用校验导致正文引用被清空，已回退到校验前结果',
          progress: 91,
        })
      }
    }

    const remapped = remapReferenceNumbers(currentMarkdown, referencesByNumber)
    currentMarkdown = remapped.updatedMarkdown
    let numberedReferences = remapped.numberedReferences
    const nextMeaningfulLength = meaningfulComparableLength(currentMarkdown)
    if (
      originalMeaningfulLength > 0
      && nextMeaningfulLength < Math.max(120, Math.floor(originalMeaningfulLength * 0.75))
    ) {
      currentMarkdown = originalBodyMarkdown
      numberedReferences = []
      onUpdate({
        type: 'status',
        message: '引用整理结果疑似导致正文丢失，已回退到整理前正文',
        progress: 96,
      })
    }
    const complete: Extract<ReferenceOrganizeStreamUpdate, { type: 'complete' }> = {
      type: 'complete',
      status: 'success',
      updatedMarkdown: currentMarkdown,
      referenceList: numberedReferences.map((item) => item.reference),
      numberedReferences,
      sentenceChanges,
    }
    onUpdate(complete)
    return complete
  } catch (error) {
    const update: ReferenceOrganizeStreamUpdate = {
      type: 'error',
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    }
    onUpdate(update)
    throw error
  }
}

export async function organizeReferences(
  settings: AppSettings,
  params: ReferenceOrganizeParams,
): Promise<Extract<ReferenceOrganizeStreamUpdate, { type: 'complete' }>> {
  let finalResult: Extract<ReferenceOrganizeStreamUpdate, { type: 'complete' }> | null = null
  await organizeReferencesStream(settings, params, (update) => {
    if (update.type === 'complete') finalResult = update
  })
  if (!finalResult) {
    throw new Error('引用整理未返回结果')
  }
  return finalResult
}
