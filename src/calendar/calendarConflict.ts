import type { CalendarEvent, CalendarEventStatus } from './types'

export interface CalendarConflict {
  eventId: string
  title: string
  startTime: string
  endTime?: string
  status: CalendarEventStatus
  conflictLevel: 'hard' | 'soft'
}

const NON_BLOCKING_STATUSES: CalendarEventStatus[] = ['cancelled', 'declined', 'ignored']
const DEFAULT_EVENT_DURATION_MS = 30 * 60 * 1000

function parseTime(value: string | undefined): number | null {
  if (!value) return null
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : null
}

function endTimeOrDefault(startTime: number, endTime?: string): number {
  const parsedEnd = parseTime(endTime)
  if (parsedEnd !== null && parsedEnd > startTime) return parsedEnd
  return startTime + DEFAULT_EVENT_DURATION_MS
}

export function detectCalendarConflicts(
  targetEvent: Pick<CalendarEvent, 'id' | 'startTime' | 'endTime' | 'allDay' | 'eventType'>,
  existingEvents: CalendarEvent[],
): CalendarConflict[] {
  if (targetEvent.eventType === 'deadline' || targetEvent.eventType === 'reminder') return []

  const targetStart = parseTime(targetEvent.startTime)
  if (targetStart === null) return []
  const targetEnd = endTimeOrDefault(targetStart, targetEvent.endTime)

  return existingEvents
    .filter((event) => {
      if (event.id === targetEvent.id) return false
      if (NON_BLOCKING_STATUSES.includes(event.status)) return false
      if (event.eventType === 'deadline' || event.eventType === 'reminder') return false
      const existingStart = parseTime(event.startTime)
      if (existingStart === null) return false
      const existingEnd = endTimeOrDefault(existingStart, event.endTime)
      return targetStart < existingEnd && targetEnd > existingStart
    })
    .map((event) => ({
      eventId: event.id,
      title: event.title,
      startTime: event.startTime,
      endTime: event.endTime,
      status: event.status,
      conflictLevel: targetEvent.allDay || event.allDay || event.status === 'tentative' ? 'soft' : 'hard',
    }))
}
