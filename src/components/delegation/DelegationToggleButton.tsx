/**
 * DelegationToggleButton — 状态栏"开启下班托管"按钮
 *
 * 员工点击后弹出确认面板，确认后开启 AI 托管。
 * AI 托管中显示"AI 托管中 · 结束托管"按钮。
 */

import { useCallback, useState } from 'react'
import styled, { css, keyframes } from 'styled-components'
import { BotIcon, LogOut } from 'lucide-react'
import { useDelegation } from '../../contexts/DelegationContext'
import { DelegationConfirmPanel } from './DelegationConfirmPanel'

const pulseAnim = keyframes`
  0%, 100% { box-shadow: 0 0 0 0 rgba(196, 106, 0, 0.25); }
  50%       { box-shadow: 0 0 0 4px rgba(196, 106, 0, 0); }
`

const ToggleButton = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 8px;
  border-radius: 4px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;

  ${({ $active }) =>
    $active
      ? css`
          border: 1px solid #fdd8a0;
          background: #fff3e0;
          color: #c46a00;
          animation: ${pulseAnim} 2.5s ease-in-out infinite;
        `
      : css`
          border: 1px solid #cad6e2;
          background: #ffffff;
          color: #304255;
          &:hover { background: #eef4fb; border-color: #b0c4d8; }
        `}

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`

const Divider = styled.span<{ $active: boolean }>`
  display: inline-block;
  width: 1px;
  height: 12px;
  background: ${(p) => (p.$active ? '#fdd8a0' : '#d0dae5')};
  margin: 0 2px;
`

const EndButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 7px;
  border: 1px solid #fdd8a0;
  border-left: none;
  border-radius: 0 4px 4px 0;
  background: #fff3e0;
  color: #c46a00;
  font-size: var(--font-size-xs);
  font-weight: 700;
  cursor: pointer;
  &:hover { background: #ffe7c4; }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
`

const ActiveGroup = styled.div`
  display: inline-flex;
  align-items: center;
`

const ActiveMainButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid #fdd8a0;
  border-right: none;
  border-radius: 4px 0 0 4px;
  background: #fff3e0;
  color: #c46a00;
  font-size: var(--font-size-xs);
  font-weight: 700;
  cursor: default;
`

const PendingBadge = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: #e83c3c;
  color: #ffffff;
  font-size: var(--font-size-xs);
  font-weight: 800;
  line-height: 1;
`

// ─── Component ────────────────────────────────────────────────────────────────

export function DelegationToggleButton() {
  const {
    isActive,
    isEnabling,
    isDisabling,
    pendingReplyCount,
    enableDelegation,
    disableDelegation,
  } = useDelegation()

  const [confirmOpen, setConfirmOpen] = useState(false)

  const handleClickEnable = useCallback(() => {
    setConfirmOpen(true)
  }, [])

  const handleConfirm = useCallback(async () => {
    setConfirmOpen(false)
    await enableDelegation(null)
  }, [enableDelegation])

  const handleCancel = useCallback(() => {
    setConfirmOpen(false)
  }, [])

  const handleDisable = useCallback(async () => {
    await disableDelegation()
  }, [disableDelegation])

  if (isActive) {
    return (
      <>
        <ActiveGroup>
          <ActiveMainButton type="button" title="AI 托管中 — AI 正在监听您的邮件和内部通讯">
            <BotIcon size={11} />
            AI 托管中
            {pendingReplyCount > 0 && (
              <PendingBadge title={`${pendingReplyCount} 条待审核回复`}>
                {pendingReplyCount > 9 ? '9+' : pendingReplyCount}
              </PendingBadge>
            )}
          </ActiveMainButton>
          <EndButton
            type="button"
            onClick={handleDisable}
            disabled={isDisabling}
            title="结束 AI 托管，恢复在线状态"
          >
            <LogOut size={10} />
            {isDisabling ? '…' : '结束托管'}
          </EndButton>
        </ActiveGroup>
        {confirmOpen && (
          <DelegationConfirmPanel
            onConfirm={handleConfirm}
            onCancel={handleCancel}
            isLoading={isEnabling}
          />
        )}
      </>
    )
  }

  return (
    <>
      <ToggleButton
        type="button"
        $active={false}
        onClick={handleClickEnable}
        disabled={isEnabling}
        title="开启 AI 下班托管 — AI 将在您离开后处理邮件和通讯"
      >
        <BotIcon size={11} />
        {isEnabling ? '开启中…' : '下班托管'}
      </ToggleButton>

      {confirmOpen && (
        <DelegationConfirmPanel
          onConfirm={handleConfirm}
          onCancel={handleCancel}
          isLoading={isEnabling}
        />
      )}
    </>
  )
}
