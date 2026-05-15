export type CalendarEventStatus =
  | 'tentative'
  | 'confirmed'
  | 'declined'
  | 'cancelled'
  | 'ignored'

export type CalendarEventSource =
  | 'manual'
  | 'email_ai'
  | 'email_user_confirmed'
  | 'imported'

export type CalendarEventType =
  | 'meeting'
  | 'interview'
  | 'deadline'
  | 'reminder'
  | 'focus'
  | 'task'

export interface CalendarAttendee {
  name?: string
  email?: string
  status?: 'accepted' | 'declined' | 'tentative' | 'unknown'
}

export interface CalendarEvent {
  id: string

  title: string
  description?: string

  startTime: string
  endTime?: string
  timezone?: string

  allDay?: boolean

  location?: string
  meetingLink?: string

  attendees?: CalendarAttendee[]

  status: CalendarEventStatus
  eventType: CalendarEventType

  source: CalendarEventSource

  sourceMessageId?: string
  sourceThreadId?: string
  sourceEmailSubject?: string
  sourceEmailFrom?: string

  confidence?: number
  needsUserConfirmation?: boolean

  conflictEventIds?: string[]

  createdAt: string
  updatedAt: string
}
