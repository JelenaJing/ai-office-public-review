export interface CitationReferenceItem {
  citationNumber: number
  text: string
}

const CITATION_GROUP_PATTERN = /\[(\s*\d+(?:(?:\s*[,，]\s*\d+)|(?:\s*[-–—]\s*\d+))*)\s*\]/g
const LEADING_CITATION_PATTERN = /^(?:\[(\d+)\]|(\d+)[.)])\s+/
const SENTENCE_END_CHARACTER_PATTERN = /[.!?。！？]/
const SENTENCE_CLOSER_CHARACTER_PATTERN = /["'”’）)】\]》」』]/

function parseCitationGroupContent(content: string): number[] {
  const normalized = String(content || '').trim()
  if (!normalized) return []

  const numbers: number[] = []
  normalized.split(/[,，]/).map((segment) => segment.trim()).filter(Boolean).forEach((segment) => {
    const rangeMatch = segment.match(/^(\d+)\s*[-–—]\s*(\d+)$/)
    if (rangeMatch) {
      const start = Number(rangeMatch[1])
      const end = Number(rangeMatch[2])
      if (Number.isFinite(start) && Number.isFinite(end)) {
        const step = start <= end ? 1 : -1
        for (let value = start; step > 0 ? value <= end : value >= end; value += step) {
          numbers.push(value)
        }
      }
      return
    }

    const direct = Number(segment)
    if (Number.isFinite(direct) && direct > 0) {
      numbers.push(direct)
    }
  })

  return numbers.filter((value) => Number.isFinite(value) && value > 0)
}

export function extractCitationNumbers(text: string): number[] {
  const matches = Array.from(String(text || '').matchAll(CITATION_GROUP_PATTERN))
  if (!matches.length) return []
  return matches.flatMap((match) => parseCitationGroupContent(match[1] || ''))
}

export function formatCitationNumbers(numbers: number[]): string {
  const normalized = Array.from(new Set(numbers.filter((value) => Number.isFinite(value) && value > 0))).sort((left, right) => left - right)
  if (!normalized.length) return ''

  const parts: string[] = []
  let cursor = 0
  while (cursor < normalized.length) {
    const start = normalized[cursor]
    let end = start
    while (cursor + 1 < normalized.length && normalized[cursor + 1] === end + 1) {
      cursor += 1
      end = normalized[cursor]
    }
    if (end - start >= 2) {
      parts.push(`${start}-${end}`)
    } else if (end !== start) {
      parts.push(String(start), String(end))
    } else {
      parts.push(String(start))
    }
    cursor += 1
  }

  return `[${parts.join(', ')}]`
}

export function resolveCitationInsertionOffset(text: string, selectionEnd: number): number {
  const normalized = String(text || '')
  if (!normalized) return 0

  const safeEnd = Math.max(0, Math.min(selectionEnd, normalized.length))
  const probeStart = safeEnd > 0 ? safeEnd - 1 : 0

  for (let index = probeStart; index < normalized.length; index += 1) {
    if (!SENTENCE_END_CHARACTER_PATTERN.test(normalized[index] || '')) continue

    let cursor = index + 1
    while (cursor < normalized.length && SENTENCE_CLOSER_CHARACTER_PATTERN.test(normalized[cursor] || '')) {
      cursor += 1
    }
    return cursor
  }

  return normalized.length
}

export function insertCitationMarkerAtSelection(text: string, selectionFrom: number, selectionTo: number, marker: string): {
  text: string
  insertionOffset: number
} {
  const normalizedText = String(text || '')
  const normalizedMarker = String(marker || '').trim()
  const safeFrom = Math.max(0, Math.min(selectionFrom, normalizedText.length))
  const safeTo = Math.max(safeFrom, Math.min(selectionTo, normalizedText.length))
  const insertionOffset = resolveCitationInsertionOffset(normalizedText, safeTo)

  if (!normalizedMarker) {
    return {
      text: normalizedText,
      insertionOffset,
    }
  }

  return {
    text: `${normalizedText.slice(0, insertionOffset)} ${normalizedMarker}${normalizedText.slice(insertionOffset)}`,
    insertionOffset,
  }
}

export function updateCitationNumbersInText(text: string, replacementMap: Map<number, number | null | undefined>): string {
  if (!replacementMap.size) return text
  return String(text || '').replace(CITATION_GROUP_PATTERN, (fullMatch, content) => {
    const nextNumbers = parseCitationGroupContent(String(content || '')).flatMap((number) => {
      if (!replacementMap.has(number)) return [number]
      const mapped = replacementMap.get(number)
      return typeof mapped === 'number' && Number.isFinite(mapped) && mapped > 0 ? [mapped] : []
    })
    const rebuilt = formatCitationNumbers(nextNumbers)
    return rebuilt || fullMatch
  })
}

export function collectCitationOrder(text: string): number[] {
  const ordered: number[] = []
  const seen = new Set<number>()
  for (const match of String(text || '').matchAll(CITATION_GROUP_PATTERN)) {
    parseCitationGroupContent(match[1] || '').forEach((number) => {
      if (seen.has(number)) return
      seen.add(number)
      ordered.push(number)
    })
  }
  return ordered
}

export function parseLeadingCitationNumber(text: string, fallbackNumber?: number): number | undefined {
  const match = String(text || '').trim().match(LEADING_CITATION_PATTERN)
  const parsed = Number(match?.[1] || match?.[2] || fallbackNumber || 0)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

export function stripLeadingCitationPrefix(text: string): string {
  return String(text || '').replace(LEADING_CITATION_PATTERN, '').trim()
}

export function buildCitationRenumberPlan(bodyText: string, items: CitationReferenceItem[]): {
  remap: Map<number, number>
  orderedItems: CitationReferenceItem[]
} {
  const normalizedItems = items
    .filter((item) => Number.isFinite(item.citationNumber) && item.citationNumber > 0)
    .sort((left, right) => left.citationNumber - right.citationNumber)

  const itemByNumber = new Map<number, CitationReferenceItem>()
  normalizedItems.forEach((item) => {
    if (!itemByNumber.has(item.citationNumber)) {
      itemByNumber.set(item.citationNumber, { citationNumber: item.citationNumber, text: String(item.text || '').trim() })
    }
  })

  const orderedNumbers = collectCitationOrder(bodyText).filter((number) => itemByNumber.has(number))
  const trailingNumbers = Array.from(itemByNumber.keys()).filter((number) => !orderedNumbers.includes(number)).sort((left, right) => left - right)
  const finalNumbers = [...orderedNumbers, ...trailingNumbers]

  const remap = new Map<number, number>()
  const orderedItems = finalNumbers.map((oldNumber, index) => {
    const nextNumber = index + 1
    remap.set(oldNumber, nextNumber)
    const item = itemByNumber.get(oldNumber)
    return {
      citationNumber: nextNumber,
      text: String(item?.text || '').trim(),
    }
  })

  return { remap, orderedItems }
}