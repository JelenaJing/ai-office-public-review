import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import styled from 'styled-components'
import { CalendarClock, PanelRight, Plus } from 'lucide-react'
import type { CalendarEvent, CalendarEventStatus, CalendarEventType } from '../calendar/types'
import {
  createCalendarEvent,
  deleteCalendarEvent,
  listCalendarEvents,
  updateCalendarEvent,
} from '../calendar/calendarService'
import { detectCalendarConflicts } from '../calendar/calendarConflict'

type CalendarFilterKey = 'today' | 'week' | 'pending' | 'from-email' | 'conflict' | 'deadline'
type CalendarViewMode = 'week' | 'list'
type CalendarPeriod = 'morning' | 'afternoon'

const CALENDAR_FILTERS: { key: CalendarFilterKey; label: string }[] = [
  { key: 'today',      label: '今天' },
  { key: 'week',       label: '本周' },
  { key: 'pending',    label: '待确认日程' },
  { key: 'from-email', label: '来自邮件' },
  { key: 'conflict',   label: '有冲突' },
  { key: 'deadline',   label: '截止事项' },
]

const STATUS_LABEL: Record<CalendarEventStatus, string> = {
  tentative: '待确认',
  confirmed: '已确认',
  declined: '已拒绝',
  cancelled: '已取消',
  ignored: '已忽略',
}

const TYPE_LABEL: Record<CalendarEventType, string> = {
  meeting: '会议',
  interview: '面试',
  deadline: '截止事项',
  reminder: '提醒',
  focus: '专注',
  task: '任务',
}

const calendarTheme = {
  pageBg: '#F7F8FA',
  panelBg: '#FFFFFF',
  border: '#E5E7EB',
  borderStrong: '#D1D5DB',
  textPrimary: '#111827',
  textSecondary: '#4B5563',
  textTertiary: '#9CA3AF',
  primary: '#2563EB',
  primaryHover: '#1D4ED8',
  primarySoft: '#EFF6FF',
  success: '#16A34A',
  successSoft: '#DCFCE7',
  warning: '#D97706',
  warningSoft: '#FEF3C7',
  danger: '#DC2626',
  dangerSoft: '#FEE2E2',
  info: '#2563EB',
  infoSoft: '#DBEAFE',
  neutralSoft: '#F9FAFB',
} as const

function sourceLabel(source: CalendarEvent['source']): string {
  if (source === 'manual') return '手动创建'
  if (source === 'email_ai') return '邮件识别'
  if (source === 'email_user_confirmed') return '邮件确认'
  return '导入'
}

function toneForStatus(status: CalendarEventStatus): 'warning' | 'success' | 'muted' | 'indigo' | 'info' | 'danger' {
  if (status === 'confirmed') return 'success'
  if (status === 'tentative') return 'warning'
  if (status === 'ignored') return 'muted'
  if (status === 'declined' || status === 'cancelled') return 'danger'
  return 'muted'
}

function toneForType(type: CalendarEventType): 'warning' | 'success' | 'muted' | 'indigo' | 'info' | 'danger' {
  if (type === 'deadline') return 'warning'
  if (type === 'reminder') return 'info'
  if (type === 'meeting' || type === 'interview') return 'indigo'
  return 'muted'
}

function toneForSource(source: CalendarEvent['source']): 'warning' | 'success' | 'muted' | 'indigo' | 'info' | 'danger' {
  if (source === 'email_ai' || source === 'email_user_confirmed') return 'info'
  return 'muted'
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function safeDate(value?: string): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function weekRange(date: Date): { start: Date; end: Date } {
  const start = new Date(date)
  const day = start.getDay() || 7
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - day + 1)
  const end = new Date(start)
  end.setDate(start.getDate() + 7)
  return { start, end }
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function weekDays(anchor: Date): Date[] {
  const { start } = weekRange(anchor)
  return Array.from({ length: 7 }, (_, index) => addDays(start, index))
}

function weekTitle(anchor: Date): string {
  const { start } = weekRange(anchor)
  const weekOfMonth = Math.floor((start.getDate() - 1) / 7) + 1
  return `${start.getFullYear()}年${start.getMonth() + 1}月第${weekOfMonth}周`
}

function formatDateLabel(value: string): string {
  const date = safeDate(value)
  if (!date) return '未设置日期'
  return date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })
}

function formatTimeRange(event: Pick<CalendarEvent, 'startTime' | 'endTime' | 'allDay'>): string {
  const start = safeDate(event.startTime)
  if (!start) return '时间待确认'
  if (event.allDay) return `${start.toLocaleDateString('zh-CN')} 全天`
  const startText = start.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  if (!event.endTime) return startText
  const end = safeDate(event.endTime)
  if (!end) return startText
  const endText = sameDay(start, end)
    ? end.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : end.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  return `${startText} - ${endText}`
}

function formatCompactTimeRange(event: Pick<CalendarEvent, 'startTime' | 'endTime' | 'allDay'>): string {
  const start = safeDate(event.startTime)
  if (!start) return '时间待确认'
  if (event.allDay) return '全天'
  const startText = start.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  if (!event.endTime) return startText
  const end = safeDate(event.endTime)
  if (!end) return startText
  return `${startText} - ${end.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
}

function resolveEventPeriod(event: Pick<CalendarEvent, 'startTime'>): CalendarPeriod | null {
  const start = safeDate(event.startTime)
  if (!start) return null
  return start.getHours() < 12 ? 'morning' : 'afternoon'
}

function toDateTimeLocalValue(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function fromDateTimeLocalValue(value: string): string {
  return new Date(value).toISOString()
}

function filterEvents(events: CalendarEvent[], filter: CalendarFilterKey, weekAnchor = new Date()): CalendarEvent[] {
  const now = new Date()
  const { start, end } = weekRange(weekAnchor)
  return events.filter((event) => {
    const eventStart = safeDate(event.startTime)
    if (filter === 'today') return Boolean(eventStart) && sameDay(eventStart, now)
    if (filter === 'week') return Boolean(eventStart) && eventStart >= start && eventStart < end
    if (filter === 'pending') return event.status === 'tentative' || event.needsUserConfirmation === true
    if (filter === 'from-email') return event.source === 'email_ai' || event.source === 'email_user_confirmed'
    if (filter === 'conflict') return Boolean(event.conflictEventIds?.length)
    if (filter === 'deadline') return event.eventType === 'deadline'
    return true
  })
}

function groupByDate(events: CalendarEvent[]): Array<{ dateKey: string; label: string; events: CalendarEvent[] }> {
  const map = new Map<string, CalendarEvent[]>()
  for (const event of events) {
    const start = safeDate(event.startTime)
    const key = start ? localDateKey(start) : (event.startTime || 'unknown-date').slice(0, 10)
    map.set(key, [...(map.get(key) ?? []), event])
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateKey, items]) => ({ dateKey, label: formatDateLabel(items[0]?.startTime ?? dateKey), events: items }))
}

const Page = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: ${calendarTheme.pageBg};
`

const PageHeader = styled.div`
  padding: 26px 24px 18px;
  flex-shrink: 0;
  background: ${calendarTheme.pageBg};
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
`

const PageTitle = styled.h1`
  margin: 0 0 6px;
  font-size: 26px;
  font-weight: 800;
  color: ${calendarTheme.textPrimary};
`

const PageSubtitle = styled.p`
  margin: 0;
  font-size: 14px;
  color: ${calendarTheme.textSecondary};
`

const HeaderAction = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 16px;
  border: 1px solid ${calendarTheme.primary};
  border-radius: 10px;
  background: ${calendarTheme.primary};
  color: #ffffff;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(17, 24, 39, 0.08);
  &:hover { background: ${calendarTheme.primaryHover}; }
`

const ContentLayout = styled.div`
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
  gap: 16px;
  padding: 0 24px 24px;
`

const FilterSidebar = styled.aside`
  width: 192px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding: 16px 10px;
  gap: 4px;
  border: 1px solid ${calendarTheme.border};
  border-radius: 16px;
  background: ${calendarTheme.panelBg};
  box-shadow: 0 1px 2px rgba(17, 24, 39, 0.04);
  overflow-y: auto;
`

const FilterSectionLabel = styled.span`
  font-size: 11px;
  font-weight: 700;
  color: ${calendarTheme.textTertiary};
  letter-spacing: 0.04em;
  padding: 0 10px 8px;
`

const FilterItem = styled.button<{ $active: boolean }>`
  position: relative;
  width: 100%;
  padding: 10px 12px 10px 16px;
  border: none;
  border-radius: 10px;
  background: ${p => p.$active ? calendarTheme.primarySoft : 'transparent'};
  color: ${p => p.$active ? calendarTheme.primaryHover : '#374151'};
  font-size: 14px;
  font-weight: ${p => p.$active ? 700 : 500};
  text-align: left;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;

  &::before {
    content: '';
    position: absolute;
    left: 0;
    top: 8px;
    bottom: 8px;
    width: 3px;
    border-radius: 999px;
    background: ${p => p.$active ? calendarTheme.primary : 'transparent'};
  }

  &:hover {
    background: ${p => p.$active ? calendarTheme.primarySoft : '#F3F4F6'};
  }
`

const ScheduleList = styled.main`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 18px 20px 20px;
  border: 1px solid ${calendarTheme.border};
  border-radius: 16px;
  background: ${calendarTheme.panelBg};
  box-shadow: 0 1px 2px rgba(17, 24, 39, 0.04);
  gap: 16px;
`

const CalendarToolbar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  padding: 12px 14px;
  border: 1px solid ${calendarTheme.border};
  border-radius: 12px;
  background: ${calendarTheme.neutralSoft};
`

const ToolbarGroup = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`

const ToolbarMetaLabel = styled.span`
  font-size: 13px;
  font-weight: 700;
  color: ${calendarTheme.textSecondary};
`

const ToolbarButton = styled.button<{ $active?: boolean }>`
  height: 32px;
  padding: 0 12px;
  border-radius: 9px;
  border: 1px solid ${p => p.$active ? calendarTheme.primary : calendarTheme.borderStrong};
  background: ${p => p.$active ? calendarTheme.primary : calendarTheme.panelBg};
  color: ${p => p.$active ? '#ffffff' : '#334155'};
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 1px 1px rgba(17, 24, 39, 0.03);
  &:hover {
    border-color: ${p => p.$active ? calendarTheme.primaryHover : calendarTheme.borderStrong};
    background: ${p => p.$active ? calendarTheme.primaryHover : calendarTheme.neutralSoft};
  }
`

const WeekLabel = styled.div`
  min-width: 160px;
  text-align: center;
  font-size: 15px;
  font-weight: 800;
  color: ${calendarTheme.textPrimary};
`

const TimetableGrid = styled.div`
  display: grid;
  grid-template-columns: 86px repeat(7, minmax(120px, 1fr));
  grid-template-rows: auto repeat(2, minmax(220px, auto));
  border: 1px solid ${calendarTheme.border};
  border-radius: 14px;
  overflow: hidden;
  background: ${calendarTheme.panelBg};
`

const TimetableCorner = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px 8px;
  border-right: 1px solid ${calendarTheme.border};
  border-bottom: 1px solid ${calendarTheme.border};
  background: ${calendarTheme.neutralSoft};
  font-size: 12px;
  font-weight: 800;
  color: ${calendarTheme.textSecondary};
`

const TimetableDayHeader = styled.div<{ $today: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 10px;
  border-right: 1px solid ${calendarTheme.border};
  border-bottom: 1px solid ${calendarTheme.border};
  background: ${p => p.$today ? '#F8FBFF' : calendarTheme.panelBg};
  &:last-child { border-right: none; }
`

const TimetableDayName = styled.div`
  font-size: 13px;
  font-weight: 800;
  color: #374151;
`

const TimetableDayDate = styled.div`
  font-size: 12px;
  color: ${calendarTheme.textTertiary};
`

const PeriodLabelCell = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px 8px;
  border-right: 1px solid ${calendarTheme.border};
  border-bottom: 1px solid ${calendarTheme.border};
  background: ${calendarTheme.neutralSoft};
  font-size: 13px;
  font-weight: 800;
  color: #374151;
`

const TimetableCell = styled.div<{ $today: boolean; $lastColumn?: boolean; $lastRow?: boolean }>`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  background: ${p => p.$today ? '#FBFDFF' : calendarTheme.panelBg};
  border-right: ${p => p.$lastColumn ? 'none' : `1px solid ${calendarTheme.border}`};
  border-bottom: ${p => p.$lastRow ? 'none' : `1px solid ${calendarTheme.border}`};
  min-height: 220px;
  transition: background 0.12s ease;

  &:hover {
    background: #FAFCFF;
  }
`

const WeekEmptyHint = styled.div`
  margin-top: -4px;
  align-self: center;
  padding: 6px 12px;
  border-radius: 999px;
  background: ${calendarTheme.neutralSoft};
  border: 1px solid ${calendarTheme.border};
  font-size: 13px;
  color: ${calendarTheme.textSecondary};
`

const WeekEventTime = styled.div`
  font-size: 12px;
  font-weight: 800;
  color: ${calendarTheme.primaryHover};
  margin-bottom: 5px;
`

const WeekEventTitle = styled.div`
  font-size: 13px;
  line-height: 1.35;
  font-weight: 800;
  color: #1E293B;
  margin-bottom: 6px;
`

const DateGroup = styled.section`
  display: flex;
  flex-direction: column;
  gap: 10px;
`

const DateHeading = styled.h2`
  margin: 0;
  font-size: 14px;
  font-weight: 800;
  color: #334155;
`

const EventCard = styled.button<{ $active: boolean; $conflict: boolean; $fromEmail?: boolean }>`
  width: 100%;
  padding: 12px 14px;
  border: 1px solid ${p => p.$active ? calendarTheme.primary : p.$conflict ? '#FCA5A5' : p.$fromEmail ? '#BFDBFE' : calendarTheme.border};
  border-radius: 12px;
  background: ${p => p.$active ? calendarTheme.primarySoft : p.$fromEmail ? '#F8FBFF' : calendarTheme.panelBg};
  text-align: left;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  transition: border-color 0.12s ease, background 0.12s ease, box-shadow 0.12s ease;
  &:hover {
    border-color: ${p => p.$conflict ? calendarTheme.danger : calendarTheme.info};
    background: ${p => p.$fromEmail ? '#F4F9FF' : '#FAFCFF'};
    box-shadow: 0 2px 6px rgba(17, 24, 39, 0.06);
  }
`

const WeekEventCard = styled(EventCard)`
  padding: 10px 11px;
  border-radius: 10px;
`

const EventTitle = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: ${calendarTheme.textPrimary};
  margin-bottom: 6px;
`

const EventMeta = styled.div`
  font-size: 12px;
  font-weight: 700;
  color: ${calendarTheme.textSecondary};
  margin-bottom: 8px;
`

const TagRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`

const Tag = styled.span<{ $tone?: 'warning' | 'success' | 'muted' | 'indigo' | 'info' | 'danger' }>`
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 1.2;
  font-weight: 700;
  background: ${p =>
    p.$tone === 'warning' ? calendarTheme.warningSoft
      : p.$tone === 'success' ? calendarTheme.successSoft
        : p.$tone === 'info' ? calendarTheme.infoSoft
          : p.$tone === 'danger' ? calendarTheme.dangerSoft
            : p.$tone === 'indigo' ? '#E0E7FF'
              : calendarTheme.neutralSoft};
  color: ${p =>
    p.$tone === 'warning' ? '#92400E'
      : p.$tone === 'success' ? '#166534'
        : p.$tone === 'info' ? '#1D4ED8'
          : p.$tone === 'danger' ? '#B91C1C'
            : p.$tone === 'indigo' ? '#3730A3'
              : '#6B7280'};
  border: 1px solid ${p =>
    p.$tone === 'warning' ? '#FCD34D'
      : p.$tone === 'success' ? '#BBF7D0'
        : p.$tone === 'info' ? '#BFDBFE'
          : p.$tone === 'danger' ? '#FECACA'
            : p.$tone === 'indigo' ? '#C7D2FE'
              : calendarTheme.border};
`

const EmptyStateWrap = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 60px 24px;
  text-align: center;
`

const EmptyIconWrap = styled.div`
  width: 80px;
  height: 80px;
  border-radius: 18px;
  background: ${calendarTheme.neutralSoft};
  color: ${calendarTheme.borderStrong};
  border: 1px solid ${calendarTheme.border};
  display: flex;
  align-items: center;
  justify-content: center;
`

const EmptyTitle = styled.h3`
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: ${calendarTheme.textSecondary};
`

const EmptyDesc = styled.p`
  margin: 0;
  font-size: 14px;
  color: ${calendarTheme.textTertiary};
  line-height: 1.7;
  max-width: 380px;
`

const DetailPanel = styled.aside`
  width: 340px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  background: ${calendarTheme.panelBg};
  border: 1px solid ${calendarTheme.border};
  border-radius: 16px;
  box-shadow: 0 1px 2px rgba(17, 24, 39, 0.04);
`

const DetailPlaceholder = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px 24px;
  color: ${calendarTheme.borderStrong};
`

const DetailPlaceholderText = styled.span`
  font-size: 15px;
  font-weight: 700;
  color: ${calendarTheme.textSecondary};
  text-align: center;
`

const DetailPlaceholderHint = styled.span`
  font-size: 13px;
  color: ${calendarTheme.textTertiary};
  text-align: center;
`

const DetailContent = styled.div`
  padding: 22px;
`

const DetailTitle = styled.h2`
  margin: 0 0 14px;
  font-size: 22px;
  font-weight: 800;
  color: ${calendarTheme.textPrimary};
`

const DetailRow = styled.div`
  display: grid;
  grid-template-columns: 82px 1fr;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid ${calendarTheme.border};
  font-size: 13px;
`

const DetailLabel = styled.span`
  color: #6B7280;
  font-weight: 700;
`

const DetailValue = styled.span`
  color: ${calendarTheme.textPrimary};
  word-break: break-word;
`

const ButtonRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 18px;
`

const ActionBtn = styled.button<{ $variant?: 'primary' | 'danger' | 'muted' }>`
  padding: 9px 12px;
  border-radius: 9px;
  border: 1px solid ${p => p.$variant === 'danger' ? '#FECACA' : p.$variant === 'primary' ? calendarTheme.primary : calendarTheme.borderStrong};
  background: ${p => p.$variant === 'danger' ? calendarTheme.dangerSoft : p.$variant === 'primary' ? calendarTheme.primary : calendarTheme.panelBg};
  color: ${p => p.$variant === 'danger' ? calendarTheme.danger : p.$variant === 'primary' ? '#FFFFFF' : '#334155'};
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: ${p => p.$variant === 'primary' ? '0 1px 2px rgba(17, 24, 39, 0.08)' : 'none'};
  &:hover {
    background: ${p => p.$variant === 'danger' ? '#FECACA' : p.$variant === 'primary' ? calendarTheme.primaryHover : calendarTheme.neutralSoft};
  }
`

const FormPanel = styled.form`
  margin: 0 0 18px;
  padding: 16px;
  border: 1px solid ${calendarTheme.border};
  border-radius: 14px;
  background: ${calendarTheme.panelBg};
  display: grid;
  gap: 12px;
`

const FormTitle = styled.div`
  font-size: 15px;
  font-weight: 800;
  color: ${calendarTheme.textPrimary};
`

const FormGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
`

const Field = styled.label`
  display: grid;
  gap: 5px;
  font-size: 12px;
  font-weight: 700;
  color: #64748B;
`

const Input = styled.input`
  width: 100%;
  box-sizing: border-box;
  border: 1px solid ${calendarTheme.borderStrong};
  border-radius: 9px;
  padding: 9px 10px;
  font-size: 13px;
  color: ${calendarTheme.textPrimary};
  background: ${calendarTheme.panelBg};
  outline: none;

  &:focus {
    border-color: ${calendarTheme.primary};
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
  }
`

const Select = styled.select`
  width: 100%;
  box-sizing: border-box;
  border: 1px solid ${calendarTheme.borderStrong};
  border-radius: 9px;
  padding: 9px 10px;
  font-size: 13px;
  color: ${calendarTheme.textPrimary};
  background: ${calendarTheme.panelBg};
  outline: none;

  &:focus {
    border-color: ${calendarTheme.primary};
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
  }
`

const Textarea = styled.textarea`
  width: 100%;
  min-height: 70px;
  box-sizing: border-box;
  border: 1px solid ${calendarTheme.borderStrong};
  border-radius: 9px;
  padding: 9px 10px;
  font-size: 13px;
  color: ${calendarTheme.textPrimary};
  background: ${calendarTheme.panelBg};
  resize: vertical;
  outline: none;

  &:focus {
    border-color: ${calendarTheme.primary};
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
  }
`

const ConflictNotice = styled.div`
  padding: 10px 12px;
  border-radius: 10px;
  background: ${calendarTheme.warningSoft};
  border: 1px solid #FCD34D;
  color: #92400E;
  font-size: 13px;
  line-height: 1.5;
`

const ModalBackdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.36);
`

const ModalPanel = styled.div`
  width: min(640px, 100%);
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  border-radius: 18px;
  background: ${calendarTheme.panelBg};
  border: 1px solid ${calendarTheme.border};
  box-shadow: 0 22px 60px rgba(15, 23, 42, 0.24);
`

const EditFormPanel = styled(FormPanel)`
  margin: 0;
  border: none;
  border-radius: 18px;
`

interface FormState {
  title: string
  startTime: string
  endTime: string
  location: string
  description: string
  eventType: CalendarEventType
  status: CalendarEventStatus
}

const initialFormState: FormState = {
  title: '',
  startTime: '',
  endTime: '',
  location: '',
  description: '',
  eventType: 'meeting',
  status: 'confirmed',
}

export default function CalendarWorkspace() {
  const [activeFilter, setActiveFilter] = useState<CalendarFilterKey>('week')
  const [viewMode, setViewMode] = useState<CalendarViewMode>('week')
  const [weekAnchor, setWeekAnchor] = useState(() => new Date())
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [form, setForm] = useState<FormState>(initialFormState)
  const [editingEventId, setEditingEventId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<FormState>(initialFormState)
  const [conflictMessage, setConflictMessage] = useState<string | null>(null)
  const [detailNotice, setDetailNotice] = useState<string | null>(null)

  const reloadEvents = useCallback(async () => {
    const nextEvents = await listCalendarEvents()
    setEvents(nextEvents)
    setSelectedEventId((current) => current && nextEvents.some((event) => event.id === current) ? current : null)
  }, [])

  useEffect(() => {
    void reloadEvents()
  }, [reloadEvents])

  useEffect(() => {
    setDetailNotice(null)
  }, [selectedEventId])

  const selectedEvent = useMemo(
    () => events.find((event) => event.id === selectedEventId) ?? null,
    [events, selectedEventId],
  )

  const groupedEvents = useMemo(
    () => groupByDate(filterEvents(events, activeFilter, weekAnchor)),
    [events, activeFilter, weekAnchor],
  )

  const filteredEvents = useMemo(
    () => filterEvents(events, activeFilter, weekAnchor),
    [events, activeFilter, weekAnchor],
  )

  const visibleWeekDays = useMemo(() => weekDays(weekAnchor), [weekAnchor])

  const timetableEvents = useMemo(() => {
    const map = new Map<string, Record<CalendarPeriod, CalendarEvent[]>>()
    for (const day of visibleWeekDays) {
      map.set(localDateKey(day), { morning: [], afternoon: [] })
    }
    for (const item of filteredEvents) {
      const start = safeDate(item.startTime)
      if (!start) continue
      const key = localDateKey(start)
      const period = resolveEventPeriod(item)
      if (!period || !map.has(key)) continue
      const current = map.get(key) ?? { morning: [], afternoon: [] }
      map.set(key, { ...current, [period]: [...current[period], item] })
    }
    for (const [key, periods] of map) {
      map.set(key, {
        morning: [...periods.morning].sort((a, b) => a.startTime.localeCompare(b.startTime)),
        afternoon: [...periods.afternoon].sort((a, b) => a.startTime.localeCompare(b.startTime)),
      })
    }
    return map
  }, [filteredEvents, visibleWeekDays])

  const hasWeekEvents = useMemo(
    () => [...timetableEvents.values()].some((periods) => periods.morning.length > 0 || periods.afternoon.length > 0),
    [timetableEvents],
  )

  const openEditForm = (event: CalendarEvent) => {
    setEditForm({
      title: event.title,
      startTime: toDateTimeLocalValue(event.startTime),
      endTime: event.endTime ? toDateTimeLocalValue(event.endTime) : '',
      location: event.location ?? '',
      description: event.description ?? '',
      eventType: event.eventType,
      status: event.status,
    })
    setConflictMessage(null)
    setEditingEventId(event.id)
  }

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault()
    if (!form.title.trim() || !form.startTime) {
      setConflictMessage('请填写标题和开始时间。')
      return
    }

    const input = {
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      startTime: fromDateTimeLocalValue(form.startTime),
      endTime: form.endTime ? fromDateTimeLocalValue(form.endTime) : undefined,
      location: form.location.trim() || undefined,
      status: form.status,
      eventType: form.eventType,
      source: 'manual' as const,
      needsUserConfirmation: false,
      conflictEventIds: [] as string[],
    }
    const conflicts = detectCalendarConflicts({ id: '', ...input }, events)
    const created = await createCalendarEvent({
      ...input,
      conflictEventIds: conflicts.map((conflict) => conflict.eventId),
    })
    setConflictMessage(conflicts.length ? `检测到 ${conflicts.length} 个时间冲突，已保存并标记冲突。` : null)
    setForm(initialFormState)
    setShowCreateForm(false)
    await reloadEvents()
    setSelectedEventId(created.id)
  }

  const handleUpdate = async (event: FormEvent) => {
    event.preventDefault()
    const target = events.find((item) => item.id === editingEventId)
    if (!target) return
    if (!editForm.title.trim() || !editForm.startTime) {
      setConflictMessage('请填写标题和开始时间。')
      return
    }

    const patch = {
      title: editForm.title.trim(),
      description: editForm.description.trim() || undefined,
      startTime: fromDateTimeLocalValue(editForm.startTime),
      endTime: editForm.endTime ? fromDateTimeLocalValue(editForm.endTime) : undefined,
      location: editForm.location.trim() || undefined,
      eventType: editForm.eventType,
      status: editForm.status,
      conflictEventIds: [] as string[],
    }
    const conflicts = detectCalendarConflicts({ id: target.id, ...patch }, events)
    const updated = await updateCalendarEvent(target.id, {
      ...patch,
      conflictEventIds: conflicts.map((conflict) => conflict.eventId),
    })
    if (!updated) {
      setConflictMessage('保存失败，未找到该日程。')
      return
    }
    setDetailNotice(conflicts.length ? `检测到 ${conflicts.length} 个时间冲突，已保存并标记冲突。` : '日程已更新。')
    setConflictMessage(null)
    setEditingEventId(null)
    await reloadEvents()
    setSelectedEventId(updated.id)
  }

  const handleConfirm = async (event: CalendarEvent) => {
    const updated = await updateCalendarEvent(event.id, {
      status: 'confirmed',
      needsUserConfirmation: false,
      source: event.source === 'email_ai' ? 'email_user_confirmed' : event.source,
    })
    if (updated) await reloadEvents()
  }

  const handleIgnore = async (event: CalendarEvent) => {
    const updated = await updateCalendarEvent(event.id, { status: 'ignored', needsUserConfirmation: false })
    if (updated) await reloadEvents()
  }

  const handleDelete = async (event: CalendarEvent) => {
    const deleted = await deleteCalendarEvent(event.id)
    if (deleted) await reloadEvents()
  }

  const handleOpenSourceMail = (event: CalendarEvent) => {
    if (!event.sourceMessageId) return
    sessionStorage.setItem('aioffice.pendingSourceMailId', JSON.stringify({
      messageId: event.sourceMessageId,
      subject: event.sourceEmailSubject ?? event.title,
    }))
    window.dispatchEvent(new CustomEvent('open-calendar-source-mail', {
      detail: {
        messageId: event.sourceMessageId,
        subject: event.sourceEmailSubject ?? event.title,
      },
    }))
  }

  return (
    <Page>
      <PageHeader>
        <div>
          <PageTitle>日程管理</PageTitle>
          <PageSubtitle>管理会议、截止事项、待确认日程和邮件识别出的时间安排。</PageSubtitle>
        </div>
        <HeaderAction type="button" onClick={() => setShowCreateForm((value) => !value)}>
          <Plus size={16} /> 新建日程
        </HeaderAction>
      </PageHeader>

      <ContentLayout>
        <FilterSidebar>
          <FilterSectionLabel>筛选</FilterSectionLabel>
          {CALENDAR_FILTERS.map(f => (
            <FilterItem
              key={f.key}
              $active={activeFilter === f.key}
              onClick={() => setActiveFilter(f.key)}
            >
              {f.label}
            </FilterItem>
          ))}
        </FilterSidebar>

        <ScheduleList>
          <CalendarToolbar>
            <ToolbarGroup>
              <ToolbarButton type="button" onClick={() => setWeekAnchor(new Date())}>今天</ToolbarButton>
              <ToolbarButton type="button" onClick={() => setWeekAnchor((value) => addDays(value, -7))}>上一周</ToolbarButton>
              <WeekLabel>{weekTitle(weekAnchor)}</WeekLabel>
              <ToolbarButton type="button" onClick={() => setWeekAnchor((value) => addDays(value, 7))}>下一周</ToolbarButton>
            </ToolbarGroup>
            <ToolbarGroup>
              <ToolbarMetaLabel>视图：</ToolbarMetaLabel>
              <ToolbarButton type="button" $active={viewMode === 'week'} onClick={() => setViewMode('week')}>日程表</ToolbarButton>
              <ToolbarButton type="button" $active={viewMode === 'list'} onClick={() => setViewMode('list')}>列表</ToolbarButton>
            </ToolbarGroup>
          </CalendarToolbar>

          {showCreateForm && (
            <FormPanel onSubmit={(event) => void handleCreate(event)}>
              <FormTitle>新建日程</FormTitle>
              {conflictMessage && <ConflictNotice>{conflictMessage}</ConflictNotice>}
              <Field>
                标题
                <Input value={form.title} onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))} />
              </Field>
              <FormGrid>
                <Field>
                  开始时间
                  <Input type="datetime-local" value={form.startTime} onChange={(event) => setForm((prev) => ({ ...prev, startTime: event.target.value }))} />
                </Field>
                <Field>
                  结束时间
                  <Input type="datetime-local" value={form.endTime} onChange={(event) => setForm((prev) => ({ ...prev, endTime: event.target.value }))} />
                </Field>
                <Field>
                  地点
                  <Input value={form.location} onChange={(event) => setForm((prev) => ({ ...prev, location: event.target.value }))} />
                </Field>
                <Field>
                  类型
                  <Select value={form.eventType} onChange={(event) => setForm((prev) => ({ ...prev, eventType: event.target.value as CalendarEventType }))}>
                    {Object.entries(TYPE_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </Select>
                </Field>
                <Field>
                  状态
                  <Select value={form.status} onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value as CalendarEventStatus }))}>
                    <option value="confirmed">已确认</option>
                    <option value="tentative">待确认</option>
                  </Select>
                </Field>
              </FormGrid>
              <Field>
                描述
                <Textarea value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} />
              </Field>
              <ButtonRow>
                <ActionBtn $variant="primary" type="submit">保存</ActionBtn>
                <ActionBtn type="button" onClick={() => { setShowCreateForm(false); setConflictMessage(null) }}>取消</ActionBtn>
              </ButtonRow>
            </FormPanel>
          )}

          {viewMode === 'week' ? (
            <>
              <TimetableGrid>
                <TimetableCorner>时段</TimetableCorner>
                {visibleWeekDays.map((day) => (
                  <TimetableDayHeader key={localDateKey(day)} $today={sameDay(day, new Date())}>
                    <TimetableDayName>{day.toLocaleDateString('zh-CN', { weekday: 'short' })}</TimetableDayName>
                    <TimetableDayDate>{day.getMonth() + 1}/{day.getDate()}</TimetableDayDate>
                  </TimetableDayHeader>
                ))}
                {(['morning', 'afternoon'] as const).map((period, rowIndex) => (
                  <Fragment key={period}>
                    <PeriodLabelCell key={`label-${period}`}>{period === 'morning' ? '上午' : '下午'}</PeriodLabelCell>
                    {visibleWeekDays.map((day, columnIndex) => {
                      const key = localDateKey(day)
                      const dayPeriods = timetableEvents.get(key) ?? { morning: [], afternoon: [] }
                      const cellEvents = dayPeriods[period]
                      return (
                        <TimetableCell
                          key={`${key}-${period}`}
                          $today={sameDay(day, new Date())}
                          $lastColumn={columnIndex === visibleWeekDays.length - 1}
                          $lastRow={rowIndex === 1}
                        >
                          {cellEvents.map((item) => (
                            <WeekEventCard
                              key={item.id}
                              type="button"
                              $active={item.id === selectedEventId}
                              $conflict={Boolean(item.conflictEventIds?.length)}
                              $fromEmail={item.source === 'email_ai' || item.source === 'email_user_confirmed'}
                              onClick={() => setSelectedEventId(item.id)}
                            >
                              <WeekEventTime>{formatCompactTimeRange(item)}</WeekEventTime>
                              <WeekEventTitle>{item.title}</WeekEventTitle>
                              <TagRow>
                                <Tag $tone={toneForStatus(item.status)}>{STATUS_LABEL[item.status]}</Tag>
                                <Tag $tone={toneForType(item.eventType)}>{TYPE_LABEL[item.eventType]}</Tag>
                                <Tag $tone={toneForSource(item.source)}>{sourceLabel(item.source)}</Tag>
                                {Boolean(item.conflictEventIds?.length) && <Tag $tone="danger">有冲突</Tag>}
                              </TagRow>
                            </WeekEventCard>
                          ))}
                        </TimetableCell>
                      )
                    })}
                  </Fragment>
                ))}
              </TimetableGrid>
              {!hasWeekEvents && <WeekEmptyHint>本周暂无日程</WeekEmptyHint>}
            </>
          ) : groupedEvents.length === 0 ? (
            <EmptyStateWrap>
              <EmptyIconWrap>
                <CalendarClock size={40} strokeWidth={1.4} />
              </EmptyIconWrap>
              <EmptyTitle>暂无日程安排。</EmptyTitle>
              <EmptyDesc>
                当邮件中识别到会议、截止时间或候选时间后，<br />
                会在这里显示待确认日程。
              </EmptyDesc>
            </EmptyStateWrap>
          ) : groupedEvents.map((group) => (
            <DateGroup key={group.dateKey}>
              <DateHeading>{group.label}</DateHeading>
              {group.events.map((item) => (
                <EventCard
                  key={item.id}
                  type="button"
                  $active={item.id === selectedEventId}
                  $conflict={Boolean(item.conflictEventIds?.length)}
                  $fromEmail={item.source === 'email_ai' || item.source === 'email_user_confirmed'}
                  onClick={() => setSelectedEventId(item.id)}
                >
                  <EventTitle>{item.title}</EventTitle>
                  <EventMeta>{formatTimeRange(item)}</EventMeta>
                  <TagRow>
                    <Tag $tone={toneForStatus(item.status)}>{STATUS_LABEL[item.status]}</Tag>
                    <Tag $tone={toneForType(item.eventType)}>{TYPE_LABEL[item.eventType]}</Tag>
                    <Tag $tone={toneForSource(item.source)}>{sourceLabel(item.source)}</Tag>
                    {Boolean(item.conflictEventIds?.length) && <Tag $tone="danger">有冲突</Tag>}
                  </TagRow>
                </EventCard>
              ))}
            </DateGroup>
          ))}
        </ScheduleList>

        <DetailPanel>
          {selectedEvent ? (
            <DetailContent>
              <DetailTitle>{selectedEvent.title}</DetailTitle>
              <DetailRow><DetailLabel>时间</DetailLabel><DetailValue>{formatTimeRange(selectedEvent)}</DetailValue></DetailRow>
              <DetailRow><DetailLabel>地点</DetailLabel><DetailValue>{selectedEvent.location || '未填写'}</DetailValue></DetailRow>
              <DetailRow><DetailLabel>会议链接</DetailLabel><DetailValue>{selectedEvent.meetingLink || '未填写'}</DetailValue></DetailRow>
              <DetailRow><DetailLabel>描述</DetailLabel><DetailValue>{selectedEvent.description || '无'}</DetailValue></DetailRow>
              <DetailRow><DetailLabel>状态</DetailLabel><DetailValue>{STATUS_LABEL[selectedEvent.status]}</DetailValue></DetailRow>
              <DetailRow><DetailLabel>类型</DetailLabel><DetailValue>{TYPE_LABEL[selectedEvent.eventType]}</DetailValue></DetailRow>
              <DetailRow><DetailLabel>来源</DetailLabel><DetailValue>{sourceLabel(selectedEvent.source)}</DetailValue></DetailRow>
              <DetailRow><DetailLabel>来源邮件</DetailLabel><DetailValue>{selectedEvent.sourceEmailSubject || '无'}</DetailValue></DetailRow>
              <DetailRow><DetailLabel>发件人</DetailLabel><DetailValue>{selectedEvent.sourceEmailFrom || '无'}</DetailValue></DetailRow>
              <DetailRow>
                <DetailLabel>冲突状态</DetailLabel>
                <DetailValue>{selectedEvent.conflictEventIds?.length ? `与 ${selectedEvent.conflictEventIds.length} 个日程冲突` : '无冲突'}</DetailValue>
              </DetailRow>
               <DetailRow>
                 <DetailLabel>参会人</DetailLabel>
                 <DetailValue>{selectedEvent.attendees?.length ? selectedEvent.attendees.map((attendee) => attendee.name || attendee.email).filter(Boolean).join('、') : '无'}</DetailValue>
               </DetailRow>
              {detailNotice && <ConflictNotice>{detailNotice}</ConflictNotice>}
               <ButtonRow>
                {selectedEvent.source !== 'manual' && selectedEvent.status !== 'confirmed' && selectedEvent.status !== 'ignored' && (
                  <ActionBtn $variant="primary" type="button" onClick={() => void handleConfirm(selectedEvent)}>确认加入日程</ActionBtn>
                )}
                {selectedEvent.status !== 'ignored' && (
                  <ActionBtn type="button" onClick={() => openEditForm(selectedEvent)}>修改时间</ActionBtn>
                )}
                {selectedEvent.source !== 'manual' && selectedEvent.status !== 'ignored' && (
                  <ActionBtn type="button" onClick={() => void handleIgnore(selectedEvent)}>忽略</ActionBtn>
                )}
                {selectedEvent.status !== 'ignored' && (selectedEvent.source === 'email_ai' || selectedEvent.source === 'email_user_confirmed') && selectedEvent.sourceMessageId && (
                  <ActionBtn type="button" onClick={() => handleOpenSourceMail(selectedEvent)}>查看来源邮件</ActionBtn>
                )}
                <ActionBtn $variant="danger" type="button" onClick={() => void handleDelete(selectedEvent)}>删除</ActionBtn>
              </ButtonRow>
            </DetailContent>
          ) : (
            <DetailPlaceholder>
              <PanelRight size={32} strokeWidth={1.3} />
              <DetailPlaceholderText>请选择一个日程查看详情</DetailPlaceholderText>
              <DetailPlaceholderHint>选中后可查看时间、来源邮件与可执行操作。</DetailPlaceholderHint>
            </DetailPlaceholder>
          )}
        </DetailPanel>
      </ContentLayout>
      {editingEventId && (
        <ModalBackdrop>
          <ModalPanel>
            <EditFormPanel onSubmit={(event) => void handleUpdate(event)}>
              <FormTitle>修改日程</FormTitle>
              {conflictMessage && <ConflictNotice>{conflictMessage}</ConflictNotice>}
              <Field>
                标题
                <Input value={editForm.title} onChange={(event) => setEditForm((prev) => ({ ...prev, title: event.target.value }))} />
              </Field>
              <FormGrid>
                <Field>
                  开始时间
                  <Input type="datetime-local" value={editForm.startTime} onChange={(event) => setEditForm((prev) => ({ ...prev, startTime: event.target.value }))} />
                </Field>
                <Field>
                  结束时间
                  <Input type="datetime-local" value={editForm.endTime} onChange={(event) => setEditForm((prev) => ({ ...prev, endTime: event.target.value }))} />
                </Field>
                <Field>
                  地点
                  <Input value={editForm.location} onChange={(event) => setEditForm((prev) => ({ ...prev, location: event.target.value }))} />
                </Field>
                <Field>
                  类型
                  <Select value={editForm.eventType} onChange={(event) => setEditForm((prev) => ({ ...prev, eventType: event.target.value as CalendarEventType }))}>
                    {Object.entries(TYPE_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </Select>
                </Field>
                <Field>
                  状态
                  <Select value={editForm.status} onChange={(event) => setEditForm((prev) => ({ ...prev, status: event.target.value as CalendarEventStatus }))}>
                    {Object.entries(STATUS_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </Select>
                </Field>
              </FormGrid>
              <Field>
                描述
                <Textarea value={editForm.description} onChange={(event) => setEditForm((prev) => ({ ...prev, description: event.target.value }))} />
              </Field>
              <ButtonRow>
                <ActionBtn $variant="primary" type="submit">保存修改</ActionBtn>
                <ActionBtn type="button" onClick={() => { setEditingEventId(null); setConflictMessage(null) }}>取消</ActionBtn>
              </ButtonRow>
            </EditFormPanel>
          </ModalPanel>
        </ModalBackdrop>
      )}
    </Page>
  )
}
