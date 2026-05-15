/**
 * AIDelegationBanner — 通讯界面中的 AI 托管提示横幅
 *
 * 在邮件/聊天界面中显示：
 * 1. "对方处于 AI 托管中" 状态提示（给发信方看）
 * 2. AI 回复消息的"AI 托管回复"标识（附加在 AI 生成的回复上）
 */

import styled from 'styled-components'
import { BotIcon, AlertTriangle, CheckCircle } from 'lucide-react'
import type { RiskLevel } from '../../types/delegation'

// ─── Recipient-is-delegated banner ───────────────────────────────────────────

const RecipientBanner = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #fff8e6;
  border: 1px solid #fde6a0;
  border-radius: 8px;
  font-size: var(--font-size-xs);
  color: #8b5a00;
`

const RecipientBannerIcon = styled.div`
  color: #c47a00;
  flex-shrink: 0;
`

interface RecipientDelegatedBannerProps {
  recipientName?: string
}

export function RecipientDelegatedBanner({ recipientName }: RecipientDelegatedBannerProps) {
  return (
    <RecipientBanner>
      <RecipientBannerIcon>
        <BotIcon size={14} />
      </RecipientBannerIcon>
      <span>
        {recipientName ? `${recipientName} ` : '对方'}
        当前处于 AI 托管中，AI 将根据知识库尝试回复您的消息。重要事项请等待本人回复。
      </span>
    </RecipientBanner>
  )
}

// ─── AI reply badge ───────────────────────────────────────────────────────────

const ReplyBadgeWrap = styled.div<{ $riskLevel: RiskLevel }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: var(--font-size-xs);
  font-weight: 700;
  background: ${({ $riskLevel }) =>
    $riskLevel === 'high' ? '#fff0f0'
    : $riskLevel === 'medium' ? '#fff8e6'
    : '#eaf5ff'};
  color: ${({ $riskLevel }) =>
    $riskLevel === 'high' ? '#b83c3c'
    : $riskLevel === 'medium' ? '#8b5a00'
    : '#1a5a9a'};
  border: 1px solid ${({ $riskLevel }) =>
    $riskLevel === 'high' ? '#f7cccc'
    : $riskLevel === 'medium' ? '#fde6a0'
    : '#c8e0f5'};
`

const RISK_LABEL: Record<RiskLevel, string> = {
  low: 'AI 托管回复',
  medium: 'AI 托管回复 · 中风险待审核',
  high: 'AI 托管回复 · 高风险待审核',
}

interface AIReplyBadgeProps {
  riskLevel: RiskLevel
}

export function AIReplyBadge({ riskLevel }: AIReplyBadgeProps) {
  const Icon = riskLevel === 'high' ? AlertTriangle : riskLevel === 'medium' ? AlertTriangle : CheckCircle
  return (
    <ReplyBadgeWrap $riskLevel={riskLevel}>
      <BotIcon size={10} />
      <Icon size={10} />
      {RISK_LABEL[riskLevel]}
    </ReplyBadgeWrap>
  )
}

// ─── Delegation active notice (shown to the delegated user themselves) ────────

const ActiveNotice = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: linear-gradient(90deg, #eaf2ff 0%, #f0f8ff 100%);
  border: 1px solid #c0d9f5;
  border-radius: 10px;
  font-size: var(--font-size-xs);
  color: #1a4a7a;
`

const ActiveNoticeIcon = styled.div`
  color: #1a6fc4;
  flex-shrink: 0;
`

export function DelegationActiveNotice() {
  return (
    <ActiveNotice>
      <ActiveNoticeIcon>
        <BotIcon size={15} />
      </ActiveNoticeIcon>
      <div>
        <strong>AI 托管中</strong> — AI 正在监听您的邮件和内部通讯，低风险问题将自动回复，高风险问题需要您审核后发送。
      </div>
    </ActiveNotice>
  )
}
