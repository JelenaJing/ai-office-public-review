import React from 'react'
import styled from 'styled-components'
import { getActiveDocumentEngine, getDocumentEngine, listDocumentEngines } from '../../../engines/documentEngine/registry'

const Banner = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  background: linear-gradient(90deg, #2b3038 0%, #222831 100%);
  border-bottom: 1px solid #333;
  flex-shrink: 0;
`

const Summary = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const Title = styled.div`
  color: #fff;
  font-size: var(--font-size-sm);
  font-weight: 600;
`

const Description = styled.div`
  color: #aeb6c2;
  font-size: var(--font-size-xs);
  line-height: 1.6;
`

const Chips = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
`

const Chip = styled.span<{ $tone?: 'active' | 'planned' }>`
  display: inline-flex;
  align-items: center;
  padding: 4px 8px;
  border-radius: 999px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: ${({ $tone }) => ($tone === 'active' ? '#dff4ff' : '#fcefc7')};
  background: ${({ $tone }) => ($tone === 'active' ? 'rgba(14, 99, 156, 0.24)' : 'rgba(146, 114, 28, 0.24)')};
  border: 1px solid ${({ $tone }) => ($tone === 'active' ? 'rgba(14, 99, 156, 0.45)' : 'rgba(146, 114, 28, 0.45)')};
`

export default function DocumentEngineBanner() {
  const activeEngine = getActiveDocumentEngine()
  const fallbackEngine = getDocumentEngine('legacy-tiptap-bridge')
  const readyCount = listDocumentEngines().flatMap((engine) => engine.capabilities).filter((capability) => capability.ready).length

  return (
    <Banner>
      <Summary>
        <Title>AI Office 3.0 正在进行文档引擎重构</Title>
        <Description>
          当前 3.0 主线已切到 {activeEngine.label}。文档宿主层以 OOXML 与 DOCX 回写为主路径推进，{fallbackEngine.label} 仅保留为兼容回退层，不再作为默认编辑内核。
        </Description>
      </Summary>
      <Chips>
        <Chip $tone="active">当前: {activeEngine.shortLabel}</Chip>
        <Chip $tone="planned">回退: {fallbackEngine.shortLabel}</Chip>
        <Chip>已就绪能力: {readyCount}</Chip>
      </Chips>
    </Banner>
  )
}