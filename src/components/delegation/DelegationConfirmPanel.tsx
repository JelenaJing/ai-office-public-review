/**
 * DelegationConfirmPanel — 开启下班托管确认弹窗
 *
 * 向用户说明 AI 托管的行为，确认后执行托管流程。
 */

import styled, { keyframes } from 'styled-components'
import { BotIcon, X, ShieldCheck, Clock, MessageSquare, FileText } from 'lucide-react'

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(-8px); }
  to   { opacity: 1; transform: translateY(0); }
`

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(10, 20, 35, 0.45);
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
`

const Panel = styled.div`
  width: min(480px, calc(100vw - 32px));
  background: #ffffff;
  border-radius: 16px;
  box-shadow: 0 24px 60px rgba(10, 20, 35, 0.18);
  animation: ${fadeIn} 0.2s ease;
  overflow: hidden;
`

const PanelHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 20px 16px;
  border-bottom: 1px solid #eef2f7;
`

const PanelTitleWrap = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`

const PanelIcon = styled.div`
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: linear-gradient(135deg, #e8f3ff 0%, #d0e8ff 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #1a6fc4;
  flex-shrink: 0;
`

const PanelTitle = styled.h2`
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #1b2d42;
`

const PanelSubtitle = styled.p`
  margin: 2px 0 0;
  font-size: var(--font-size-xs);
  color: #7089a5;
`

const CloseButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #8096aa;
  cursor: pointer;
  &:hover { background: #f0f4f8; color: #243447; }
`

const PanelBody = styled.div`
  padding: 20px;
`

const InfoList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 20px;
`

const InfoItem = styled.div`
  display: flex;
  gap: 12px;
  align-items: flex-start;
`

const InfoItemIcon = styled.div<{ $color: string; $bg: string }>`
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: ${(p) => p.$bg};
  color: ${(p) => p.$color};
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 1px;
`

const InfoItemText = styled.div``

const InfoItemTitle = styled.div`
  font-size: var(--font-size-sm);
  font-weight: 700;
  color: #1b2d42;
  margin-bottom: 2px;
`

const InfoItemDesc = styled.div`
  font-size: var(--font-size-xs);
  line-height: 1.6;
  color: #5e7a90;
`

const HighlightNote = styled.div`
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 12px 14px;
  border-radius: 10px;
  background: #fff8e6;
  border: 1px solid #fde6a0;
  margin-bottom: 20px;
  font-size: var(--font-size-xs);
  line-height: 1.6;
  color: #8b5a00;
`

const PanelActions = styled.div`
  display: flex;
  gap: 10px;
`

const CancelButton = styled.button`
  flex: 1;
  height: 38px;
  border: 1px solid #d0dae5;
  border-radius: 10px;
  background: #ffffff;
  color: #4a6278;
  font-size: var(--font-size-sm);
  font-weight: 600;
  cursor: pointer;
  &:hover { background: #f4f8fb; }
`

const ConfirmButton = styled.button`
  flex: 2;
  height: 38px;
  border: none;
  border-radius: 10px;
  background: linear-gradient(135deg, #1a6fc4 0%, #1558a8 100%);
  color: #ffffff;
  font-size: var(--font-size-sm);
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  &:hover { background: linear-gradient(135deg, #1868ba 0%, #1350a0 100%); }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
`

// ─── Component ────────────────────────────────────────────────────────────────

interface DelegationConfirmPanelProps {
  onConfirm: () => void
  onCancel: () => void
  isLoading?: boolean
}

export function DelegationConfirmPanel({
  onConfirm,
  onCancel,
  isLoading = false,
}: DelegationConfirmPanelProps) {
  return (
    <Overlay onClick={onCancel}>
      <Panel onClick={(e) => e.stopPropagation()}>
        <PanelHeader>
          <PanelTitleWrap>
            <PanelIcon>
              <BotIcon size={18} />
            </PanelIcon>
            <div>
              <PanelTitle>开启 AI 下班托管</PanelTitle>
              <PanelSubtitle>AI 将在您离开后托管 AI Office 内的工作事务</PanelSubtitle>
            </div>
          </PanelTitleWrap>
          <CloseButton onClick={onCancel}><X size={15} /></CloseButton>
        </PanelHeader>

        <PanelBody>
          <InfoList>
            <InfoItem>
              <InfoItemIcon $color="#1a6fc4" $bg="#e8f3ff">
                <MessageSquare size={15} />
              </InfoItemIcon>
              <InfoItemText>
                <InfoItemTitle>邮件与内部通讯自动处理</InfoItemTitle>
                <InfoItemDesc>
                  您离开后，AI 会结合知识库尝试回复收到的邮件和内部消息。低风险问题可自动回复，
                  中高风险问题只生成草稿或进入待审核，不会代替您做出重要决定。
                </InfoItemDesc>
              </InfoItemText>
            </InfoItem>

            <InfoItem>
              <InfoItemIcon $color="#1a8a5a" $bg="#e6f6ee">
                <FileText size={15} />
              </InfoItemIcon>
              <InfoItemText>
                <InfoItemTitle>自动整理今日工作日报</InfoItemTitle>
                <InfoItemDesc>
                  系统将收尾今日工作记录，包括文件变更、邮件行为和 AI 使用情况，
                  并生成工作日报。管理层可在后台查看您的日报摘要。
                </InfoItemDesc>
              </InfoItemText>
            </InfoItem>

            <InfoItem>
              <InfoItemIcon $color="#c4771a" $bg="#fff3e0">
                <ShieldCheck size={15} />
              </InfoItemIcon>
              <InfoItemText>
                <InfoItemTitle>高风险内容不会自动发送</InfoItemTitle>
                <InfoItemDesc>
                  涉及审批决定、财务承诺、人事处分、法律责任等高风险事项，
                  AI 只生成草稿并等待您本人审核，不会自动代您发送。
                </InfoItemDesc>
              </InfoItemText>
            </InfoItem>

            <InfoItem>
              <InfoItemIcon $color="#7b4fc4" $bg="#f0eaff">
                <Clock size={15} />
              </InfoItemIcon>
              <InfoItemText>
                <InfoItemTitle>随时可以结束托管</InfoItemTitle>
                <InfoItemDesc>
                  您可以随时点击状态栏的"结束托管"按钮恢复在线状态，
                  所有 AI 回复均带有"AI 托管回复"标识，不会伪装成您本人。
                </InfoItemDesc>
              </InfoItemText>
            </InfoItem>
          </InfoList>

          <HighlightNote>
            ⚠️ AI 托管仅处理 AI Office 内部的邮件、通讯、知识库和工作日报，不控制您的电脑或其他应用。
          </HighlightNote>

          <PanelActions>
            <CancelButton type="button" onClick={onCancel}>取消</CancelButton>
            <ConfirmButton type="button" onClick={onConfirm} disabled={isLoading}>
              <BotIcon size={14} />
              {isLoading ? '正在开启…' : '确认开启托管'}
            </ConfirmButton>
          </PanelActions>
        </PanelBody>
      </Panel>
    </Overlay>
  )
}
