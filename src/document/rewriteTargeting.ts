import type { Editor } from '@tiptap/react'

export interface ResolvedDocumentRewriteTarget {
  from: number
  to: number
  text: string
  anchorId?: string
  label: string
  kind: 'paragraph' | 'anchor-paragraph' | 'heading-paragraph' | 'heading-section' | 'exact-text'
  directReplacementText?: string
  batchReplacementEdits?: Array<{ from: number; to: number; anchorId?: string; text: string }>
}

export interface DocumentRewriteTargetResolution {
  mentioned: boolean
  target: ResolvedDocumentRewriteTarget | null
  failureReason?: string
}

type EditorTextBlock = {
  kind: 'paragraph' | 'heading'
  text: string
  normalizedText: string
  from: number
  to: number
  positions: number[]
  anchorId?: string
}

function normalizeSearchText(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function parseChineseNumeral(value: string): number | null {
  const normalized = String(value || '').trim()
  if (!normalized) return null
  if (/^\d+$/.test(normalized)) return Number.parseInt(normalized, 10)

  const digits: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  }
  const units: Record<string, number> = {
    十: 10,
    百: 100,
    千: 1000,
  }

  let total = 0
  let current = 0

  for (const character of normalized) {
    if (character in digits) {
      current = digits[character]
      continue
    }

    if (character in units) {
      total += (current || 1) * units[character]
      current = 0
      continue
    }

    return null
  }

  return total + current
}

function parseParagraphIndex(instruction: string): number | null {
  const matched = String(instruction || '').match(/第\s*([0-9零一二两三四五六七八九十百千]+)\s*(?:自然)?段(?:落)?/u)
  if (!matched?.[1]) return null
  const parsed = parseChineseNumeral(matched[1])
  if (!parsed || parsed < 1) return null
  return parsed - 1
}

function parseHeadingQuery(instruction: string): string | null {
  const normalized = String(instruction || '').trim()
  if (!normalized) return null

  const patterns = [
    /标题(?:为|是)\s*[“"']?([^“”"'，。；:\n]{1,60})[”"']?\s*的那一段/u,
    /在标题(?:为|是)\s*[“"']?([^“”"'，。；:\n]{1,60})[”"']?\s*的部分/u,
  ]

  for (const pattern of patterns) {
    const matched = normalized.match(pattern)
    const value = cleanAnchorQuery(matched?.[1] || '')
    if (value) return value
  }

  return null
}

function parseHeadingSectionQuery(instruction: string): string | null {
  const normalized = String(instruction || '').trim()
  if (!normalized) return null

  const patterns = [
    /标题(?:为|是)\s*[“"']?([^“”"'，。；:\n]{1,60})[”"']?\s*的整节(?:内容)?/u,
    /在标题(?:为|是)\s*[“"']?([^“”"'，。；:\n]{1,60})[”"']?\s*这一节/u,
    /标题(?:为|是)\s*[“"']?([^“”"'，。；:\n]{1,60})[”"']?\s*整节/u,
  ]

  for (const pattern of patterns) {
    const matched = normalized.match(pattern)
    const value = cleanAnchorQuery(matched?.[1] || '')
    if (value) return value
  }

  return null
}

function cleanAnchorQuery(value: string): string {
  return String(value || '')
    .replace(/^[“"'‘]+/, '')
    .replace(/[”"'’]+$/u, '')
    .replace(/^(当前|文中|正文中|编辑器中)/u, '')
    .trim()
}

function parseAnchorQuery(instruction: string): string | null {
  const normalized = String(instruction || '').trim()
  if (!normalized) return null

  const patterns = [
    /(?:把|将)([^，。；：:\n]{1,40}?)(?:改成|改为|替换成|替换为|修改为|调整为|补成|补为|补充为|写成|写为|删掉|删除|去掉)/u,
    /(?:针对|围绕|关于)([^，。；：:\n]{1,40}?)(?:这段|该段|所在段落)/u,
  ]

  for (const pattern of patterns) {
    const matched = normalized.match(pattern)
    if (!matched?.[1]) continue
    const cleaned = cleanAnchorQuery(matched[1])
    if (cleaned) return cleaned
  }

  return null
}

function cleanReplacementValue(value: string): string {
  return String(value || '')
    .trim()
    .replace(/^[“"'‘]+/, '')
    .replace(/[”"'’]+$/u, '')
    .replace(/[。；，]+$/u, '')
    .trim()
}

function cleanReplacementTargetText(value: string): string {
  return String(value || '')
    .replace(/^第\s*[0-9零一二两三四五六七八九十百千]+\s*(?:自然)?段(?:落)?(?:中|中的|里|内)?/u, '')
    .replace(/^标题(?:为|是)\s*[“"']?[^“”"'，。；:\n]{1,60}[”"']?\s*的(?:整节(?:内容)?|那一段|部分)(?:中|中的|里|内)?/u, '')
    .replace(/^(?:这一段|该段|这一节|该节)(?:中|中的|里|内)?/u, '')
    .trim()
}

function parseDirectTextReplacement(instruction: string): { targetText: string; replacementText: string; applyToAll: boolean } | null {
  const normalized = String(instruction || '').trim()
  if (!normalized) return null
  const applyToAll = /(?:所有|全部).*(?:都|统一)|全都|全部都/u.test(normalized)

  const quotedPattern = /(?:把|将)\s*(?:所有|全部)?\s*[“"']([^“”"'\n]{1,80})[”"']\s*(?:都\s*)?(?:改成|改为|替换成|替换为)\s*[“"']?([^“”"'\n]{1,80})[”"']?/u
  const placeholderPattern = /(?:把|将)\s*(?:所有|全部)?\s*([^，。；:\n]{0,24}(?:\[[^\]]+\]|【[^】]+】)[^，。；:\n]{0,24})\s*(?:都\s*)?(?:改成|改为|替换成|替换为)\s*[“"']?([^“”"'\n]{1,80})[”"']?/u

  const quotedMatch = normalized.match(quotedPattern)
  if (quotedMatch?.[1] && quotedMatch?.[2]) {
    const targetText = cleanReplacementTargetText(cleanAnchorQuery(quotedMatch[1]))
    const replacementText = cleanReplacementValue(quotedMatch[2])
    if (targetText && replacementText) {
      return { targetText, replacementText, applyToAll }
    }
  }

  const placeholderMatch = normalized.match(placeholderPattern)
  if (placeholderMatch?.[1] && placeholderMatch?.[2]) {
    const targetText = cleanReplacementTargetText(cleanAnchorQuery(placeholderMatch[1]))
    const replacementText = cleanReplacementValue(placeholderMatch[2])
    if (targetText && replacementText) {
      return { targetText, replacementText, applyToAll }
    }
  }

  return null
}

function buildNormalizedPositionMap(text: string, positions: number[]): { text: string; positions: number[] } {
  let normalized = ''
  const normalizedPositions: number[] = []
  let pendingWhitespace = false
  let whitespacePosition: number | null = null

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    const position = positions[index]
    if (/\s/.test(character)) {
      if (normalized.length > 0) {
        pendingWhitespace = true
        if (whitespacePosition == null) whitespacePosition = position
      }
      continue
    }

    if (pendingWhitespace) {
      normalized += ' '
      normalizedPositions.push(whitespacePosition ?? position)
      pendingWhitespace = false
      whitespacePosition = null
    }

    normalized += character
    normalizedPositions.push(position)
  }

  return {
    text: normalized,
    positions: normalizedPositions,
  }
}

function collectAllIndexes(source: string, needle: string): number[] {
  const indexes: number[] = []
  if (!needle) return indexes

  let cursor = source.indexOf(needle)
  while (cursor >= 0) {
    indexes.push(cursor)
    cursor = source.indexOf(needle, cursor + 1)
  }
  return indexes
}

function collectEditorTextBlocks(editor: Editor | null): EditorTextBlock[] {
  if (!editor) return []

  const blocks: EditorTextBlock[] = []
  editor.state.doc.descendants((node, pos) => {
    const kind = node.type.name === 'paragraph'
      ? 'paragraph'
      : node.type.name === 'heading'
        ? 'heading'
        : null
    if (!kind) return

    const blockTextParts: string[] = []
    const blockPositions: number[] = []
    node.descendants((child, childPos) => {
      if (child.isText) {
        const childText = child.text || ''
        for (let index = 0; index < childText.length; index += 1) {
          blockTextParts.push(childText[index])
          blockPositions.push(pos + 1 + childPos + index)
        }
        return
      }

      if (child.type.name === 'hardBreak') {
        blockTextParts.push('\n')
        blockPositions.push(pos + 1 + childPos)
      }
    })

    const blockText = blockTextParts.join('')
    const normalizedText = normalizeSearchText(blockText)
    if (!normalizedText || blockPositions.length === 0) return

    const from = blockPositions[0]
    const to = blockPositions[blockPositions.length - 1] + 1
    blocks.push({
      kind,
      text: blockText,
      normalizedText,
      from,
      to,
      positions: blockPositions,
      anchorId: typeof node.attrs?.id === 'string' ? String(node.attrs.id) : undefined,
    })
  })

  return blocks
}

function resolveHeadingParagraphTarget(blocks: EditorTextBlock[], headingQuery: string): DocumentRewriteTargetResolution {
  const normalizedHeading = normalizeSearchText(headingQuery)
  const matchedHeadings = blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => block.kind === 'heading' && block.normalizedText.includes(normalizedHeading))

  if (matchedHeadings.length === 0) {
    return {
      mentioned: true,
      target: null,
      failureReason: `未找到标题为“${headingQuery}”的章节。`,
    }
  }

  if (matchedHeadings.length > 1) {
    return {
      mentioned: true,
      target: null,
      failureReason: `命中了多个标题为“${headingQuery}”的章节，暂时无法唯一定位。`,
    }
  }

  const [{ index: headingIndex }] = matchedHeadings
  for (let index = headingIndex + 1; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (block.kind === 'heading') break
    if (block.kind === 'paragraph' && block.normalizedText) {
      return {
        mentioned: true,
        target: {
          from: block.from,
          to: block.to,
          text: block.text,
          anchorId: block.anchorId,
          label: `标题为“${headingQuery}”下的段落`,
          kind: 'heading-paragraph',
        },
      }
    }
  }

  return {
    mentioned: true,
    target: null,
    failureReason: `找到了标题“${headingQuery}”，但其下没有可改写的正文段落。`,
  }
}

function resolveHeadingSectionTarget(blocks: EditorTextBlock[], headingQuery: string): DocumentRewriteTargetResolution {
  const normalizedHeading = normalizeSearchText(headingQuery)
  const matchedHeadings = blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => block.kind === 'heading' && block.normalizedText.includes(normalizedHeading))

  if (matchedHeadings.length === 0) {
    return {
      mentioned: true,
      target: null,
      failureReason: `未找到标题为“${headingQuery}”的章节。`,
    }
  }

  if (matchedHeadings.length > 1) {
    return {
      mentioned: true,
      target: null,
      failureReason: `命中了多个标题为“${headingQuery}”的章节，暂时无法唯一定位。`,
    }
  }

  const [{ index: headingIndex }] = matchedHeadings
  const sectionBlocks: EditorTextBlock[] = []
  for (let index = headingIndex + 1; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (block.kind === 'heading') break
    if (block.normalizedText) sectionBlocks.push(block)
  }

  if (!sectionBlocks.length) {
    return {
      mentioned: true,
      target: null,
      failureReason: `找到了标题“${headingQuery}”，但其下没有可改写的正文内容。`,
    }
  }

  const from = sectionBlocks[0].from
  const to = sectionBlocks[sectionBlocks.length - 1].to
  const text = sectionBlocks.map((block) => block.text).join('\n\n').trim()

  return {
    mentioned: true,
    target: {
      from,
      to,
      text,
      anchorId: sectionBlocks[0].anchorId,
      label: `标题为“${headingQuery}”的整节内容`,
      kind: 'heading-section',
    },
  }
}

function resolveParagraphTarget(blocks: EditorTextBlock[], paragraphIndex: number): DocumentRewriteTargetResolution {
  const paragraphs = blocks.filter((block) => block.kind === 'paragraph')
  const target = paragraphs[paragraphIndex]
  if (!target) {
    return {
      mentioned: true,
      target: null,
      failureReason: `未找到第 ${paragraphIndex + 1} 段，无法执行定点改写。`,
    }
  }

  return {
    mentioned: true,
    target: {
      from: target.from,
      to: target.to,
      text: target.text,
      anchorId: target.anchorId,
      label: `第 ${paragraphIndex + 1} 段`,
      kind: 'paragraph',
    },
  }
}

function resolveAnchorParagraphTarget(blocks: EditorTextBlock[], anchorQuery: string): DocumentRewriteTargetResolution {
  const normalizedAnchor = normalizeSearchText(anchorQuery)
  if (!normalizedAnchor) {
    return {
      mentioned: true,
      target: null,
      failureReason: '提示词里指定了改写目标，但目标文本为空。',
    }
  }

  const paragraphMatches = blocks.filter((block) => block.kind === 'paragraph' && block.normalizedText.includes(normalizedAnchor))
  if (paragraphMatches.length === 1) {
    const target = paragraphMatches[0]
    return {
      mentioned: true,
      target: {
        from: target.from,
        to: target.to,
        text: target.text,
        anchorId: target.anchorId,
        label: `包含“${anchorQuery}”的段落`,
        kind: 'anchor-paragraph',
      },
    }
  }

  if (paragraphMatches.length > 1) {
    return {
      mentioned: true,
      target: null,
      failureReason: `命中了多个包含“${anchorQuery}”的段落，暂时无法唯一定位。`,
    }
  }

  return {
    mentioned: true,
    target: null,
    failureReason: `未在当前文稿中找到包含“${anchorQuery}”的段落。`,
  }
}

function resolveDirectTextReplacementTarget(
  blocks: EditorTextBlock[],
  targetText: string,
  replacementText: string,
  applyToAll: boolean,
  scopeLabel?: string,
): DocumentRewriteTargetResolution {
  const normalizedTarget = normalizeSearchText(targetText)
  if (!normalizedTarget) {
    return {
      mentioned: true,
      target: null,
      failureReason: '提示词里指定了替换目标，但目标文本为空。',
    }
  }

  const matches: Array<{ block: EditorTextBlock; from: number; to: number }> = []

  for (const block of blocks) {
    const exactIndexes = collectAllIndexes(block.text, targetText)
    for (const exactIndex of exactIndexes) {
      const from = block.positions[exactIndex]
      const to = block.positions[exactIndex + targetText.length - 1]
      if (Number.isFinite(from) && Number.isFinite(to)) {
        matches.push({ block, from, to: to + 1 })
      }
    }

    if (exactIndexes.length > 0) continue

    const normalizedBlock = buildNormalizedPositionMap(block.text, block.positions)
    const normalizedIndexes = collectAllIndexes(normalizedBlock.text, normalizedTarget)
    for (const normalizedIndex of normalizedIndexes) {
      const from = normalizedBlock.positions[normalizedIndex]
      const to = normalizedBlock.positions[normalizedIndex + normalizedTarget.length - 1]
      if (Number.isFinite(from) && Number.isFinite(to)) {
        matches.push({ block, from, to: to + 1 })
      }
    }
  }

  if (matches.length === 0) {
    return {
      mentioned: true,
      target: null,
      failureReason: `未在当前文稿中找到“${targetText}”。`,
    }
  }

  if (matches.length > 1 && !applyToAll) {
    return {
      mentioned: true,
      target: null,
      failureReason: `当前文稿中“${targetText}”出现了多次，暂时无法唯一替换。`,
    }
  }

  if (matches.length > 1 && applyToAll) {
    const orderedMatches = matches
      .slice()
      .sort((left, right) => right.from - left.from)

    const firstMatch = orderedMatches[orderedMatches.length - 1]
    const lastMatch = orderedMatches[0]
    return {
      mentioned: true,
      target: {
        from: firstMatch.from,
        to: lastMatch.to,
        text: targetText,
        anchorId: firstMatch.block.anchorId,
        label: scopeLabel ? `${scopeLabel}中的所有“${targetText}”` : `所有文本“${targetText}”`,
        kind: 'exact-text',
        directReplacementText: replacementText,
        batchReplacementEdits: orderedMatches.map((match) => ({
          from: match.from,
          to: match.to,
          anchorId: match.block.anchorId,
          text: replacementText,
        })),
      },
    }
  }

  const [{ block, from, to }] = matches
  return {
    mentioned: true,
    target: {
      from,
      to,
      text: targetText,
      anchorId: block.anchorId,
      label: scopeLabel ? `${scopeLabel}中的文本“${targetText}”` : `文本“${targetText}”`,
      kind: 'exact-text',
      directReplacementText: replacementText,
    },
  }
}

export function resolveDocumentRewriteTargetInEditor(editor: Editor | null, instruction: string): DocumentRewriteTargetResolution {
  const paragraphIndex = parseParagraphIndex(instruction)
  const headingSectionQuery = parseHeadingSectionQuery(instruction)
  const headingQuery = parseHeadingQuery(instruction)
  const directTextReplacement = parseDirectTextReplacement(instruction)
  const anchorQuery = parseAnchorQuery(instruction)
  const mentioned = paragraphIndex !== null || Boolean(headingSectionQuery) || Boolean(headingQuery) || Boolean(directTextReplacement) || Boolean(anchorQuery)
  if (!mentioned) {
    return {
      mentioned: false,
      target: null,
    }
  }

  if (!editor) {
    return {
      mentioned: true,
      target: null,
      failureReason: '当前编辑器未就绪，无法定位提示词中指定的改写目标。',
    }
  }

  const blocks = collectEditorTextBlocks(editor)
  if (!blocks.length) {
    return {
      mentioned: true,
      target: null,
      failureReason: '当前文稿没有可定位的正文段落，无法执行定点改写。',
    }
  }

  if (directTextReplacement && paragraphIndex !== null) {
    const paragraphs = blocks.filter((block) => block.kind === 'paragraph')
    const paragraphBlock = paragraphs[paragraphIndex]
    if (!paragraphBlock) {
      return {
        mentioned: true,
        target: null,
        failureReason: `未找到第 ${paragraphIndex + 1} 段，无法在段内执行精确替换。`,
      }
    }
    return resolveDirectTextReplacementTarget(
      [paragraphBlock],
      directTextReplacement.targetText,
      directTextReplacement.replacementText,
      directTextReplacement.applyToAll,
      `第 ${paragraphIndex + 1} 段`,
    )
  }

  if (directTextReplacement && headingSectionQuery) {
    const sectionTarget = resolveHeadingSectionTarget(blocks, headingSectionQuery)
    if (!sectionTarget.target) return sectionTarget
    const scopedBlocks = blocks.filter((block) => block.from >= sectionTarget.target!.from && block.to <= sectionTarget.target!.to)
    return resolveDirectTextReplacementTarget(
      scopedBlocks,
      directTextReplacement.targetText,
      directTextReplacement.replacementText,
      directTextReplacement.applyToAll,
      sectionTarget.target.label,
    )
  }

  if (headingSectionQuery) {
    return resolveHeadingSectionTarget(blocks, headingSectionQuery)
  }

  if (directTextReplacement) {
    return resolveDirectTextReplacementTarget(
      blocks,
      directTextReplacement.targetText,
      directTextReplacement.replacementText,
      directTextReplacement.applyToAll,
    )
  }

  if (paragraphIndex !== null) {
    return resolveParagraphTarget(blocks, paragraphIndex)
  }

  if (headingQuery) {
    return resolveHeadingParagraphTarget(blocks, headingQuery)
  }

  if (anchorQuery) {
    return resolveAnchorParagraphTarget(blocks, anchorQuery)
  }

  return {
    mentioned: false,
    target: null,
  }
}