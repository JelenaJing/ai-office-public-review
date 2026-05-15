import styled from 'styled-components'
import { ChevronRight } from 'lucide-react'

export type SceneFeatureStatus = 'available' | 'comingSoon' | 'requiresNetwork' | 'disabled'
export type SceneFeatureAccent = 'blue' | 'green' | 'orange' | 'purple' | 'teal' | 'gray' | 'indigo'

const ACCENT_COLORS: Record<SceneFeatureAccent, { border: string; iconBg: string; iconColor: string; btn: string }> = {
  blue:   { border: '#d4e2f0', iconBg: '#deeeff', iconColor: '#1f6fd6', btn: '#1f6fd6' },
  green:  { border: '#cce9d8', iconBg: '#d5f0e2', iconColor: '#1a7a4a', btn: '#1a7a4a' },
  orange: { border: '#f0d9c4', iconBg: '#fce5cf', iconColor: '#c05c15', btn: '#c05c15' },
  purple: { border: '#ddd0f5', iconBg: '#ede4ff', iconColor: '#7c4dff', btn: '#7c4dff' },
  teal:   { border: '#c4e8e4', iconBg: '#d0f0ec', iconColor: '#00897b', btn: '#00897b' },
  gray:   { border: '#e2e8f0', iconBg: '#f0f4f8', iconColor: '#607080', btn: '#607080' },
  indigo: { border: '#c7d2fe', iconBg: '#e0e7ff', iconColor: '#4338ca', btn: '#4338ca' },
}

export interface SceneFeatureRowProps {
  icon: React.ReactNode
  title: string
  description: string
  tags?: string[]
  status?: SceneFeatureStatus
  accent?: SceneFeatureAccent
  actionLabel?: string
  onClick?: () => void
}

const Row = styled.button<{ $disabled: boolean; $accent: SceneFeatureAccent }>`
  width: 100%;
  min-height: 96px;
  padding: 20px 24px;
  border: 1.5px solid ${p => ACCENT_COLORS[p.$accent].border};
  border-radius: 18px;
  background: ${p => p.$disabled ? '#f9fafb' : '#ffffff'};
  display: grid;
  grid-template-columns: 56px 1fr auto;
  align-items: center;
  gap: 20px;
  cursor: ${p => p.$disabled ? 'default' : 'pointer'};
  text-align: left;
  transition: border-color 0.14s, box-shadow 0.14s, background 0.14s;
  opacity: ${p => p.$disabled ? 0.55 : 1};

  ${p => !p.$disabled && `
    &:hover {
      border-color: ${ACCENT_COLORS[p.$accent].btn};
      box-shadow: 0 4px 20px rgba(0,0,0,0.08);
      background: #fafcff;
    }
  `}
`

const IconWrap = styled.div<{ $accent: SceneFeatureAccent }>`
  width: 52px;
  height: 52px;
  border-radius: 14px;
  background: ${p => ACCENT_COLORS[p.$accent].iconBg};
  color: ${p => ACCENT_COLORS[p.$accent].iconColor};
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
`

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
`

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
`

const FeatureTitle = styled.span`
  font-size: 17px;
  font-weight: 700;
  color: #1a2f47;
  line-height: 1.2;
`

const StatusBadge = styled.span<{ $kind: SceneFeatureStatus }>`
  display: inline-block;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  background: ${p => p.$kind === 'requiresNetwork' ? '#e8f0fc'
    : p.$kind === 'comingSoon' ? '#fdf0e2'
    : '#f0f2f5'};
  color: ${p => p.$kind === 'requiresNetwork' ? '#1f5fb4'
    : p.$kind === 'comingSoon' ? '#a05c10'
    : '#7a8898'};
`

const Description = styled.span`
  font-size: 14px;
  color: #6b7f94;
  line-height: 1.5;
`

const Tags = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 2px;
`

const Tag = styled.span`
  display: inline-block;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: var(--font-size-xs);
  font-weight: 500;
  background: #f0f4fa;
  color: #4a6080;
`

const ActionArea = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
`

const ActionBtn = styled.span<{ $accent: SceneFeatureAccent; $disabled: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 36px;
  padding: 0 18px;
  border-radius: 10px;
  background: ${p => p.$disabled ? '#e8edf4' : ACCENT_COLORS[p.$accent].btn};
  color: ${p => p.$disabled ? '#9aaab8' : '#ffffff'};
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  pointer-events: none;
`

function statusLabel(status: SceneFeatureStatus): string | null {
  if (status === 'comingSoon') return '即将接入'
  if (status === 'requiresNetwork') return '需要网络'
  if (status === 'disabled') return '不可用'
  return null
}

export function SceneFeatureRow({
  icon,
  title,
  description,
  tags,
  status = 'available',
  accent = 'blue',
  actionLabel = '进入',
  onClick,
}: SceneFeatureRowProps) {
  const isDisabled = status === 'comingSoon' || status === 'disabled'
  const badge = statusLabel(status)

  return (
    <Row $disabled={isDisabled} $accent={accent} onClick={isDisabled ? undefined : onClick}>
      <IconWrap $accent={accent}>{icon}</IconWrap>
      <Body>
        <TitleRow>
          <FeatureTitle>{title}</FeatureTitle>
          {badge && <StatusBadge $kind={status}>{badge}</StatusBadge>}
        </TitleRow>
        <Description>{description}</Description>
        {tags && tags.length > 0 && (
          <Tags>{tags.map(t => <Tag key={t}>{t}</Tag>)}</Tags>
        )}
      </Body>
      <ActionArea>
        <ActionBtn $accent={accent} $disabled={isDisabled}>
          {isDisabled ? '待接入' : actionLabel}
          {!isDisabled && <ChevronRight size={15} />}
        </ActionBtn>
      </ActionArea>
    </Row>
  )
}
