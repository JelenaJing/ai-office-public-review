import type { CalendarEvent } from './types'

const CALENDAR_EVENTS_STORAGE_KEY = 'aioffice.calendar.events.v1'

function now(): string {
  return new Date().toISOString()
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `cal-${crypto.randomUUID()}`
  }
  return `cal-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function compareByStartTime(a: CalendarEvent, b: CalendarEvent): number {
  return a.startTime.localeCompare(b.startTime)
}

function loadEvents(): CalendarEvent[] {
  try {
    const raw = localStorage.getItem(CALENDAR_EVENTS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as CalendarEvent[]
    return Array.isArray(parsed) ? parsed.sort(compareByStartTime) : []
  } catch {
    return []
  }
}

function saveEvents(events: CalendarEvent[]): void {
  localStorage.setItem(CALENDAR_EVENTS_STORAGE_KEY, JSON.stringify([...events].sort(compareByStartTime)))
}

export async function listCalendarEvents(): Promise<CalendarEvent[]> {
  return loadEvents()
}

export async function getCalendarEventById(id: string): Promise<CalendarEvent | null> {
  return loadEvents().find((event) => event.id === id) ?? null
}

export async function createCalendarEvent(
  input: Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<CalendarEvent> {
  const ts = now()
  const event: CalendarEvent = {
    ...input,
    id: makeId(),
    createdAt: ts,
    updatedAt: ts,
  }
  const events = [...loadEvents(), event].sort(compareByStartTime)
  saveEvents(events)
  return event
}

export async function updateCalendarEvent(
  id: string,
  patch: Partial<Omit<CalendarEvent, 'id' | 'createdAt'>>,
): Promise<CalendarEvent | null> {
  const events = loadEvents()
  const index = events.findIndex((event) => event.id === id)
  if (index < 0) return null

  const updated: CalendarEvent = {
    ...events[index],
    ...patch,
    id,
    createdAt: events[index].createdAt,
    updatedAt: now(),
  }
  const nextEvents = [...events.slice(0, index), updated, ...events.slice(index + 1)].sort(compareByStartTime)
  saveEvents(nextEvents)
  return updated
}

export async function deleteCalendarEvent(id: string): Promise<boolean> {
  const events = loadEvents()
  const nextEvents = events.filter((event) => event.id !== id)
  if (nextEvents.length === events.length) return false
  saveEvents(nextEvents)
  return true
}

export async function listCalendarEventsByRange(
  startTime: string,
  endTime: string,
): Promise<CalendarEvent[]> {
  const start = new Date(startTime).getTime()
  const end = new Date(endTime).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end)) return []
  return loadEvents().filter((event) => {
    const eventStart = new Date(event.startTime).getTime()
    if (!Number.isFinite(eventStart)) return false
    return eventStart >= start && eventStart <= end
  })
}
