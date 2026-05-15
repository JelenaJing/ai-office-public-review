import { stripThinkTags } from './StreamThinkFilter'

const LEADING_META_HEADER_PATTERN = /^(?:#{1,6}\s*)?(?:任务说明|任务要求|写作要求|输出要求|操作要求|生成要求|注意事项|系统提示|提示词|prompt|instructions?|requirements?|task|goal|output|status|执行状态|状态说明)\s*[:：]?$/i
const LEADING_META_INLINE_PATTERN = /^(?:任务说明|任务要求|写作要求|输出要求|操作要求|生成要求|注意事项|系统提示|提示词|prompt|instructions?|requirements?|task|goal|output|status|执行状态|状态说明)\s*[:：]/i
const LEADING_STATUS_PATTERN = /^(?:当前)?(?:任务|流程)?(?:状态|进度)\s*[:：]|^(?:正在|开始|继续|准备|已完成|已经完成|已生成|生成完成|处理中|执行中|本次任务已)(?:全文|文稿|正文|论文|内容|任务|结果|整文|生成)/
const LEADING_CHATTER_PATTERN = /^(?:好的[，,。:]?|下面(?:是|将为你|给出)?[：:]?|以下(?:是|为)?[：:]?|根据(?:你的|以上)?(?:要求|内容|主题)[，,:：]?|我将(?:为你)?[：:]?|让我们(?:先)?[：:]?|先说明一下[：:]?|说明如下[：:]?)/
const TRAILING_CHATTER_PATTERN = /^(?:如需|如果你(?:还)?需要|若需|欢迎继续|以上(?:为|就是)|希望(?:这|以上)|你可以继续|请告诉我|是否需要我|还可以继续|后续如需)/

function normalizeLineEndings(value: string): string {
  return String(value || '').replace(/\r\n?/g, '\n')
}

function isMetaHeaderLine(trimmed: string): boolean {
  return LEADING_META_HEADER_PATTERN.test(trimmed)
}

function isExplicitNoiseLine(trimmed: string): boolean {
  return LEADING_META_INLINE_PATTERN.test(trimmed)
    || LEADING_STATUS_PATTERN.test(trimmed)
    || /^(?:prompt|instruction|instructions|requirements|task|goal|output)\s*[:：]/i.test(trimmed)
    || /^(?:已打开|已保存|已写入|已同步|打开目录|打开文稿|下载文稿)\b/.test(trimmed)
}

function isMetaContinuationLine(trimmed: string): boolean {
  return /^(?:[-*+]\s+|\d+[.)、]\s+|[A-Za-z][.)]\s+|\[[ xX]\]\s+)/.test(trimmed)
    || /^(?:请|需|需要|必须|禁止|避免|保留|只清掉|只清理|输出|注意|不要|不得)\b/.test(trimmed)
    || /^(?:should|must|need to|do not|don't|keep|remove|avoid|preserve|output)\b/i.test(trimmed)
    || isExplicitNoiseLine(trimmed)
}

function isChatterLeadLine(trimmed: string): boolean {
  return LEADING_CHATTER_PATTERN.test(trimmed)
}

function isTrailingNoiseLine(trimmed: string): boolean {
  return TRAILING_CHATTER_PATTERN.test(trimmed)
    || isExplicitNoiseLine(trimmed)
}

function nextSignificantLine(lines: string[], startIndex: number): string {
  for (let index = startIndex; index < lines.length; index += 1) {
    const trimmed = lines[index].trim()
    if (trimmed) return trimmed
  }
  return ''
}

function isLikelyStructuredBodyLine(trimmed: string): boolean {
  return /^#{1,6}\s+\S/.test(trimmed)
    || /^!\[[^\]]*\]\([^)]+\)/.test(trimmed)
    || /^(?:[-*+]\s+|\d+[.)、]\s+|[A-Za-z][.)]\s+)/.test(trimmed)
    || /^(?:图|表|Figure|Table)\s*\d+/i.test(trimmed)
    || /^\[\d+(?:\s*[,\-]\s*\d+)*\]\s+\S/.test(trimmed)
    || /^\|.*\|$/.test(trimmed)
}

function stripLeadingNoiseBlocks(input: string): string {
  const lines = normalizeLineEndings(input).split('\n')
  let index = 0

  while (index < lines.length) {
    const trimmed = lines[index].trim()
    if (!trimmed) {
      index += 1
      continue
    }

    if (isMetaHeaderLine(trimmed)) {
      index += 1
      while (index < lines.length) {
        const nextTrimmed = lines[index].trim()
        if (!nextTrimmed) {
          index += 1
          break
        }
        if (isMetaContinuationLine(nextTrimmed)) {
          index += 1
          continue
        }
        break
      }
      continue
    }

    if (isExplicitNoiseLine(trimmed)) {
      index += 1
      continue
    }

    if (isChatterLeadLine(trimmed)) {
      const nextLine = nextSignificantLine(lines, index + 1)
      if (!nextLine || isLikelyStructuredBodyLine(nextLine) || !isExplicitNoiseLine(nextLine)) {
        index += 1
        continue
      }
    }

    break
  }

  return lines.slice(index).join('\n')
}

function stripTrailingNoiseLines(input: string): string {
  const lines = normalizeLineEndings(input).split('\n')
  let end = lines.length - 1

  while (end >= 0) {
    const trimmed = lines[end].trim()
    if (!trimmed) {
      end -= 1
      continue
    }
    if (isTrailingNoiseLine(trimmed)) {
      end -= 1
      continue
    }
    break
  }

  return lines.slice(0, end + 1).join('\n')
}

function collapseBlankLines(input: string): string {
  return normalizeLineEndings(input)
    .replace(/\n[ \t]+\n/g, '\n\n')
    .replace(/\n{3,}/g, '\n\n')
}

export function hasDocumentResultNoise(input: string): boolean {
  const stripped = normalizeLineEndings(stripThinkTags(String(input || ''))).trim()
  if (!stripped) return false
  const leadingStripped = stripLeadingNoiseBlocks(stripped)
  const trailingStripped = stripTrailingNoiseLines(leadingStripped)
  return trailingStripped !== stripped
}

export function normalizeDocumentResultMarkdown(input: string): string {
  let normalized = normalizeLineEndings(stripThinkTags(String(input || '')))
  normalized = stripLeadingNoiseBlocks(normalized)
  normalized = stripTrailingNoiseLines(normalized)
  normalized = collapseBlankLines(normalized)
  return normalized.trim()
}