import type { MailItem } from '../types/email'
import type { AiMailTriageResult, EmailTimeIntent } from '../types/mailTriage'
import type { CalendarEvent, CalendarEventSource, CalendarEventStatus, CalendarEventType } from './types'
import { createCalendarEvent, listCalendarEvents } from './calendarService'
import { detectCalendarConflicts } from './calendarConflict'

interface CreateFromEmailOptions {
  source: CalendarEventSource
  status: CalendarEventStatus
  needsUserConfirmation: boolean
  candidateTime?: NonNullable<EmailTimeIntent['candidateTimes']>[number]
}

function eventTypeFromIntent(type: EmailTimeIntent['type']): CalendarEventType {
  if (type === 'interview') return 'interview'
  if (type === 'deadline') return 'deadline'
  if (type === 'reminder') return 'reminder'
  return 'meeting'
}

function resolveStartTime(intent: EmailTimeIntent, candidateTime?: NonNullable<EmailTimeIntent['candidateTimes']>[number]): string | null {
  if (candidateTime?.startTime) return candidateTime.startTime
  if (intent.type === 'deadline') return intent.deadlineTime ?? null
  return intent.startTime ?? null
}

function resolveEndTime(intent: EmailTimeIntent, candidateTime?: NonNullable<EmailTimeIntent['candidateTimes']>[number]): string | undefined {
  if (candidateTime) return candidateTime.endTime
  if (intent.endTime || !intent.startTime || intent.type === 'deadline' || intent.type === 'reminder') return intent.endTime
  const start = new Date(intent.startTime)
  if (!Number.isFinite(start.getTime())) return intent.endTime
  const end = new Date(start)
  end.setMinutes(end.getMinutes() + (intent.type === 'interview' ? 30 : 60))
  return end.toISOString()
}

export function buildCalendarEventInputFromEmail(
  mail: MailItem,
  timeIntent: EmailTimeIntent,
  options: CreateFromEmailOptions,
): Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt'> | null {
  if (!timeIntent.hasTimeRequirement) return null
  if (timeIntent.type === 'follow_up' || timeIntent.type === 'none') return null
  if (timeIntent.type === 'candidate_times' && !options.candidateTime) return null

  const startTime = resolveStartTime(timeIntent, options.candidateTime)
  if (!startTime) return null

  return {
    title: timeIntent.type === 'deadline'
      ? `截止：${timeIntent.title || mail.subject || '截止事项'}`
      : timeIntent.title || mail.subject || '日程安排',
    description: timeIntent.description || timeIntent.sourceText || undefined,
    startTime,
    endTime: resolveEndTime(timeIntent, options.candidateTime),
    timezone: options.candidateTime?.timezone || timeIntent.timezone,
    location: timeIntent.location,
    meetingLink: timeIntent.meetingLink,
    attendees: timeIntent.attendees?.map((attendee) => ({ ...attendee, status: 'unknown' as const })),
    status: options.status,
    eventType: eventTypeFromIntent(timeIntent.type),
    source: options.source,
    sourceMessageId: mail.id,
    sourceThreadId: mail.threadId,
    sourceEmailSubject: mail.subject,
    sourceEmailFrom: mail.fromName ? `${mail.fromName} <${mail.from}>` : mail.from,
    confidence: timeIntent.confidence,
    needsUserConfirmation: options.needsUserConfirmation,
    conflictEventIds: [],
  }
}

export async function createCalendarEventFromEmail(
  mail: MailItem,
  timeIntent: EmailTimeIntent,
  options: CreateFromEmailOptions,
): Promise<CalendarEvent | null> {
  const input = buildCalendarEventInputFromEmail(mail, timeIntent, options)
  if (!input) return null

  const existingEvents = await listCalendarEvents()
  const conflicts = detectCalendarConflicts({ id: '', ...input }, existingEvents)
  return createCalendarEvent({
    ...input,
    conflictEventIds: conflicts.map((conflict) => conflict.eventId),
  })
}

export async function ensureTentativeCalendarEventFromEmail(
  mail: MailItem,
  triage: AiMailTriageResult,
): Promise<{ event: CalendarEvent; conflictCount: number } | null> {
  const timeIntent = triage.timeIntent
  if (!timeIntent?.hasTimeRequirement) return null
  if (timeIntent.type === 'candidate_times' || timeIntent.type === 'follow_up' || timeIntent.type === 'none') return null

  const existingEvents = await listCalendarEvents()
  const existing = existingEvents.find((event) =>
    event.sourceMessageId === mail.id &&
    (event.source === 'email_ai' || event.source === 'email_user_confirmed') &&
    event.status !== 'ignored' &&
    event.status !== 'cancelled',
  )
  if (existing) {
    return { event: existing, conflictCount: existing.conflictEventIds?.length ?? 0 }
  }

  const input = buildCalendarEventInputFromEmail(mail, timeIntent, {
    source: 'email_ai',
    status: 'tentative',
    needsUserConfirmation: true,
  })
  if (!input) return null

  const conflicts = detectCalendarConflicts({ id: '', ...input }, existingEvents)
  const event = await createCalendarEvent({
    ...input,
    conflictEventIds: conflicts.map((conflict) => conflict.eventId),
  })
  return { event, conflictCount: conflicts.length }
}
