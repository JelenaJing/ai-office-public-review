/**
 * DelegationStatusBadge — AI 托管中状态标识
 *
 * 当用户处于 ai_delegated 状态时，在 UI 中展示橙色"AI 托管中"标签。
 */

import styled, { keyframes, css } from 'styled-components'
import { BotIcon } from 'lucide-react'
import type { UserPresenceStatus } from '../../types/delegation'

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.6; }
`

const Badge = styled.span<{ $status: UserPresenceStatus }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  height: 20px;
  border-radius: 999px;
  font-size: var(--font-size-xs);
  font-weight: 700;
  letter-spacing: 0.01em;
  white-space: nowrap;

  ${({ $status }) => {
    switch ($status) {
      case 'ai_delegated':
        return css`
          background: #fff3e0;
          color: #c46a00;
          border: 1px solid #fdd8a0;
          animation: ${pulse} 2.5s ease-in-out infinite;
        `
      case 'away':
        return css`
          background: #f5f5f5;
          color: #6e7d8e;
          border: 1px solid #dde3ec;
        `
      case 'do_not_disturb':
        return css`
          background: #fff0f0;
          color: #b83c3c;
          border: 1px solid #f7cccc;
        `
      case 'online':
        return css`
          background: #edfaf3;
          color: #1a7a46;
          border: 1px solid #b8e8cf;
        `
      default:
        return css`
          background: #f5f5f5;
          color: #6e7d8e;
          border: 1px solid #dde3ec;
        `
    }
  }}
`

const Dot = styled.span<{ $status: UserPresenceStatus }>`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: ${({ $status }) => {
    switch ($status) {
      case 'ai_delegated': return '#c46a00'
      case 'online': return '#1a7a46'
      case 'do_not_disturb': return '#b83c3c'
      default: return '#9eaab6'
    }
  }};
`

interface DelegationStatusBadgeProps {
  status: UserPresenceStatus
  /** If true, show the badge as a standalone chip with full text */
  showLabel?: boolean
}

const STATUS_LABELS: Record<UserPresenceStatus, string> = {
  online: '在线',
  away: '离开',
  ai_delegated: 'AI 托管中',
  do_not_disturb: '请勿打扰',
  offline: '离线',
}

export function DelegationStatusBadge({
  status,
  showLabel = true,
}: DelegationStatusBadgeProps) {
  if (status === 'online' || status === 'offline') return null

  return (
    <Badge $status={status} title={STATUS_LABELS[status]}>
      {status === 'ai_delegated' ? (
        <BotIcon size={10} />
      ) : (
        <Dot $status={status} />
      )}
      {showLabel && STATUS_LABELS[status]}
    </Badge>
  )
}
