import React from 'react'
import styled from 'styled-components'

/** 各生成模式底部 Dock 外容器（渐变底、顶部分割线） */
export const UnifiedGenerationDockWrap = styled.div`
  flex-shrink: 0;
  border-top: 1px solid #dfe7ef;
  background: linear-gradient(180deg, rgba(249, 252, 255, 0.96) 0%, rgba(244, 248, 252, 0.98) 100%);
  padding: 12px 18px 16px;
`

/** 圆角输入卡片（与 GenerationPromptComposer 主视觉一致） */
export const UnifiedComposerShell = styled.div<{ $dragging?: boolean }>`
  position: relative;
  min-width: 0;
  border: 1px solid ${({ $dragging }) => ($dragging ? '#6aa6ff' : '#d9e3ee')};
  border-radius: 20px;
  background: #ffffff;
  padding: 14px 16px 12px;
  transition: border-color 0.15s, box-shadow 0.15s;

  &:focus-within {
    border-color: ${({ $dragging }) => ($dragging ? '#6aa6ff' : '#80addd')};
    box-shadow: 0 10px 26px rgba(74, 140, 214, 0.12);
  }
`

export const UnifiedComposerTextarea = styled.textarea`
  width: 100%;
  min-height: 72px;
  max-height: 144px;
  resize: none;
  border: none;
  background: transparent;
  color: #304255;
  padding: 0;
  font-size: 14px;
  line-height: 1.7;
  outline: none;

  &::placeholder {
    color: #a0aebc;
  }
`

export const UnifiedComposerFooter = styled.div`
  margin-top: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
`

export const UnifiedFooterActions = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
`

export const UnifiedGhostButton = styled.button`
  min-height: 34px;
  padding: 0 12px;
  border-radius: 12px;
  border: 1px solid #d9e3ee;
  background: #f9fbfd;
  color: #607487;
  font-size: var(--font-size-sm);
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: #f4f8fc;
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`

export const UnifiedPrimaryButton = styled.button`
  min-height: 34px;
  padding: 0 12px;
  border-radius: 12px;
  border: 1px solid #76a7de;
  background: linear-gradient(180deg, #6aa3e1 0%, #4d8fd7 100%);
  color: #ffffff;
  font-size: var(--font-size-sm);
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  box-shadow: 0 10px 20px rgba(74, 140, 214, 0.18);

  &:hover:not(:disabled) {
    opacity: 0.92;
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
    box-shadow: none;
  }
`

export const UnifiedDangerButton = styled.button`
  min-height: 34px;
  padding: 0 12px;
  border-radius: 12px;
  border: 1px solid #dd8d8d;
  background: #fff4f4;
  color: #b33a3a;
  font-size: var(--font-size-sm);
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: #ffeaea;
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`

export const UnifiedSendButton = styled.button`
  width: 42px;
  height: 42px;
  border-radius: 14px;
  border: 1px solid #76a7de;
  background: linear-gradient(180deg, #6aa3e1 0%, #4d8fd7 100%);
  color: #ffffff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 10px 20px rgba(74, 140, 214, 0.18);
  cursor: pointer;

  &:hover:not(:disabled) {
    opacity: 0.92;
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`

export interface UnifiedComposerCapabilities {
  canSend: boolean
  canStop: boolean
  canPause: boolean
  canResume: boolean
}

interface UnifiedComposerActionRowProps {
  capabilities: UnifiedComposerCapabilities
  running?: boolean
  sendDisabled?: boolean
  onSend?: () => void
  onStop?: () => void
  onPause?: () => void
  onResume?: () => void
  leftActions?: React.ReactNode
  rightActions?: React.ReactNode
  sendLabel?: string
}

export function UnifiedComposerActionRow({
  capabilities,
  running = false,
  sendDisabled = false,
  onSend,
  onStop,
  onPause,
  onResume,
  leftActions,
  rightActions,
  sendLabel = '发送',
}: UnifiedComposerActionRowProps) {
  return (
    <UnifiedComposerFooter>
      <UnifiedFooterActions>
        {leftActions}
        {capabilities.canPause && running ? (
          <UnifiedGhostButton type="button" onClick={onPause}>
            暂停
          </UnifiedGhostButton>
        ) : null}
        {capabilities.canResume && running ? (
          <UnifiedPrimaryButton type="button" onClick={onResume}>
            继续
          </UnifiedPrimaryButton>
        ) : null}
        {capabilities.canStop && running ? (
          <UnifiedDangerButton type="button" onClick={onStop}>
            停止
          </UnifiedDangerButton>
        ) : null}
      </UnifiedFooterActions>
      <UnifiedFooterActions>
        {rightActions}
        {capabilities.canSend && !running ? (
          <UnifiedPrimaryButton type="button" onClick={onSend} disabled={sendDisabled}>
            {sendLabel}
          </UnifiedPrimaryButton>
        ) : null}
      </UnifiedFooterActions>
    </UnifiedComposerFooter>
  )
}

export const UnifiedComposerStatusRow = styled.div`
  margin-top: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
`

export const UnifiedComposerStatusText = styled.span`
  font-size: var(--font-size-sm);
  line-height: 1.6;
  color: #667b90;
`

export const UnifiedComposerStatusPill = styled.span<{ $tone?: 'idle' | 'running' | 'paused' | 'error' }>`
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid ${({ $tone }) => (
    $tone === 'running' ? '#8bb6ea'
      : $tone === 'paused' ? '#e2c07a'
      : $tone === 'error' ? '#e3a1a1'
      : '#d9e3ee'
  )};
  background: ${({ $tone }) => (
    $tone === 'running' ? '#edf5ff'
      : $tone === 'paused' ? '#fff6e8'
      : $tone === 'error' ? '#fff2f2'
      : '#f7fafd'
  )};
  color: ${({ $tone }) => (
    $tone === 'running' ? '#2455c3'
      : $tone === 'paused' ? '#946118'
      : $tone === 'error' ? '#b33a3a'
      : '#607487'
  )};
  font-size: var(--font-size-xs);
  font-weight: 700;
  letter-spacing: 0.02em;
`

export const UnifiedVoiceButton = styled.button<{ $active?: boolean }>`
  width: 38px;
  height: 38px;
  border-radius: 999px;
  border: 1px solid ${({ $active }) => ($active ? '#d98b52' : '#d9e3ee')};
  background: ${({ $active }) => ($active ? '#fff1e7' : '#f9fbfd')};
  color: ${({ $active }) => ($active ? '#b85b18' : '#607487')};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: ${({ $active }) => ($active ? '0 0 0 4px rgba(217, 139, 82, 0.12)' : 'none')};
  transition: all 0.15s ease;
  flex-shrink: 0;

  &:hover:not(:disabled) {
    background: ${({ $active }) => ($active ? '#ffe7d7' : '#f4f8fc')};
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`

export const UnifiedComposerAssist = styled.div`
  margin-top: 10px;
  font-size: var(--font-size-sm);
  line-height: 1.6;
  color: #667b90;
`

export const UnifiedModeHintTitle = styled.div`
  font-size: var(--font-size-sm);
  font-weight: 700;
  color: #1e3a5f;
  margin-bottom: 6px;
`

export const UnifiedModeHintBody = styled.div`
  font-size: var(--font-size-sm);
  line-height: 1.65;
  color: #667b90;
`

/** Dock 顶部「模式标签 + 收起」条 */
export const UnifiedDockCollapseBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 18px;
  height: 32px;
  background: rgba(255, 255, 255, 0.75);
  border-bottom: 1px solid #dce5ef;
  border-top: 1px solid #dfe7ef;
`

export const UnifiedDockCollapseLabel = styled.span`
  font-size: var(--font-size-xs);
  font-weight: 700;
  color: #5f7387;
  letter-spacing: 0.04em;
`

export const UnifiedDockCollapseBtn = styled.button`
  font-size: var(--font-size-xs);
  color: #7b8794;
  background: #ffffff;
  border: 1px solid #dde3ec;
  border-radius: 6px;
  padding: 2px 10px;
  cursor: pointer;
  line-height: 1.5;
  &:hover {
    background: #eef2f7;
    color: #304255;
  }
`

/** 收起后的展开条 */
export const UnifiedDockExpandStrip = styled.div`
  width: 100%;
  height: 40px;
  border-top: 1px solid #dde3ec;
  background: linear-gradient(180deg, rgba(249, 252, 255, 0.96) 0%, rgba(244, 248, 252, 0.98) 100%);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 18px;
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;
  &:hover {
    background: linear-gradient(180deg, #f3f7fc 0%, #e8eef6 100%);
  }
`

export const UnifiedDockExpandLabel = styled.span`
  color: #2455c3;
  font-size: var(--font-size-sm);
  font-weight: 600;
  white-space: nowrap;
`

export const UnifiedDockExpandAction = styled.span`
  font-size: var(--font-size-sm);
  color: #7b8794;
  padding: 2px 10px;
  border: 1px solid #dde3ec;
  border-radius: 6px;
  background: #ffffff;
`
