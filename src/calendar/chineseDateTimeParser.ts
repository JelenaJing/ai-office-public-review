export interface InferredChineseDateTime {
  startTime?: string
  endTime?: string
  deadlineTime?: string
  matchedText?: string
}

const WEEKDAY_MAP: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 0,
  天: 0,
}

type DayPeriod = '早上' | '上午' | '中午' | '下午' | '晚上'

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function startOfNaturalWeek(date: Date): Date {
  const start = new Date(date)
  const day = start.getDay() || 7
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - day + 1)
  return start
}

function resolveDate(dateText: string, now: Date): Date | null {
  const base = new Date(now)
  base.setHours(0, 0, 0, 0)

  if (dateText === '明天') return addDays(base, 1)
  if (dateText === '后天') return addDays(base, 2)

  const weekMatch = dateText.match(/^(本周|下周)([一二三四五六日天])$/)
  if (!weekMatch) return null

  const targetWeekday = WEEKDAY_MAP[weekMatch[2]]
  const monday = startOfNaturalWeek(now)
  const offset = targetWeekday === 0 ? 6 : targetWeekday - 1
  const candidate = addDays(monday, weekMatch[1] === '下周' ? 7 + offset : offset)

  if (weekMatch[1] === '本周' && candidate.getTime() < base.getTime()) {
    return addDays(candidate, 7)
  }

  return candidate
}

function normalizeHour(hour: number, period?: DayPeriod): number {
  if (period === '下午' || period === '晚上') {
    return hour < 12 ? hour + 12 : hour
  }
  if (period === '中午' && hour < 11) {
    return hour + 12
  }
  return hour
}

function defaultHourForPeriod(period?: DayPeriod): number {
  if (period === '早上' || period === '上午') return 9
  if (period === '中午') return 12
  if (period === '晚上') return 19
  return 15
}

function buildDateTime(date: Date, hour: number, minute: number): Date {
  const next = new Date(date)
  next.setHours(hour, minute, 0, 0)
  return next
}

function isDeadlineText(text: string, matchedText: string): boolean {
  if (/前/.test(matchedText)) return true
  const normalized = text.replace(/\s+/g, '')
  const compactMatch = matchedText.replace(/\s+/g, '')
  const index = normalized.indexOf(compactMatch)
  if (index < 0) return /截止|提交|反馈|回传|补充/.test(text)

  const before = normalized.slice(Math.max(0, index - 12), index)
  const after = normalized.slice(index + compactMatch.length, index + compactMatch.length + 12)
  return /截止|请在|需在|提交|反馈|回传|补充/.test(before) || /前|截止|提交|反馈|回传|补充/.test(after)
}

export function inferRelativeChineseDateTimeFromText(text: string, now = new Date()): InferredChineseDateTime {
  const datePattern = '(明天|后天|本周[一二三四五六日天]|下周[一二三四五六日天])'
  const periodPattern = '(早上|上午|中午|下午|晚上)?'
  const timePattern = '(?:(\\d{1,2})(?:[:：](\\d{1,2}))?\\s*点?(半)?)?'
  const rangePattern = '(?:\\s*(?:到|至|[-—~])\\s*(早上|上午|中午|下午|晚上)?\\s*(\\d{1,2})(?:[:：](\\d{1,2}))?\\s*点?(半)?)?'
  const regex = new RegExp(`${datePattern}\\s*${periodPattern}\\s*${timePattern}${rangePattern}\\s*(前)?`, 'g')

  for (const match of text.matchAll(regex)) {
    const matchedText = match[0].trim()
    if (!matchedText) continue

    const date = resolveDate(match[1], now)
    if (!date) continue

    const startPeriod = match[2] as DayPeriod | undefined
    const startHourRaw = match[3] ? Number.parseInt(match[3], 10) : undefined
    const startMinuteRaw = match[4] ? Number.parseInt(match[4], 10) : undefined
    const startHalf = Boolean(match[5])
    const endPeriod = (match[6] as DayPeriod | undefined) || startPeriod
    const endHourRaw = match[7] ? Number.parseInt(match[7], 10) : undefined
    const endMinuteRaw = match[8] ? Number.parseInt(match[8], 10) : undefined
    const endHalf = Boolean(match[9])

    const startHour = normalizeHour(startHourRaw ?? defaultHourForPeriod(startPeriod), startPeriod)
    const startMinute = startHalf ? 30 : startMinuteRaw ?? 0
    const start = buildDateTime(date, startHour, startMinute)

    const hasExplicitEnd = typeof endHourRaw === 'number'
    const end = hasExplicitEnd
      ? buildDateTime(
          date,
          normalizeHour(endHourRaw, endPeriod),
          endHalf ? 30 : endMinuteRaw ?? 0,
        )
      : undefined

    if (end && end.getTime() <= start.getTime() && startPeriod && !match[6]) {
      end.setHours(end.getHours() + 12)
    }

    const inferred: InferredChineseDateTime = {
      startTime: start.toISOString(),
      endTime: end?.toISOString(),
      matchedText,
    }

    if (isDeadlineText(text, matchedText)) {
      return {
        deadlineTime: start.toISOString(),
        matchedText,
      }
    }

    if (!inferred.endTime && startHourRaw !== undefined) {
      const defaultEnd = new Date(start)
      defaultEnd.setMinutes(defaultEnd.getMinutes() + 60)
      inferred.endTime = defaultEnd.toISOString()
    }

    return inferred
  }

  return {}
}
