import React, { useMemo, useState } from 'react'
import styled from 'styled-components'
import { X } from 'lucide-react'
import { builtinMagazineArticles, type MagazineArticle } from '../data/builtinMagazineArticles'

const Shell = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #0c1118;
  color: #e8eef5;
`

const TopBar = styled.div`
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
`

const Brand = styled.div`
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #94a3b8;
`

const CloseBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: #cbd5e1;
  font-size: 12px;
  cursor: pointer;
  &:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
  }
`

const Scroll = styled.div`
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px 18px 22px;
  display: grid;
  gap: 18px;
`

const IssueCard = styled.article`
  border-radius: 16px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: #111827;
  display: grid;
  grid-template-columns: minmax(0, 140px) minmax(0, 1fr);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.35);

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
`

const Cover = styled.div<{ $gradient: string }>`
  min-height: 140px;
  background: ${({ $gradient }) => $gradient};
  position: relative;
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, transparent 40%, rgba(0, 0, 0, 0.35));
  }
`

const CoverTag = styled.span`
  position: absolute;
  left: 12px;
  bottom: 12px;
  z-index: 1;
  font-size: 11px;
  font-weight: 800;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.65);
  color: #f8fafc;
  backdrop-filter: blur(6px);
`

const Body = styled.div`
  padding: 16px 18px 18px;
  display: grid;
  gap: 10px;
  min-width: 0;
`

const MetaRow = styled.div`
  font-size: 11px;
  color: #94a3b8;
  font-weight: 600;
`

const Headline = styled.h2`
  margin: 0;
  font-size: 18px;
  line-height: 1.35;
  font-weight: 800;
  color: #f8fafc;
`

const Deck = styled.p`
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: #cbd5e1;
`

const ArticleBody = styled.div<{ $expanded: boolean }>`
  font-size: 12px;
  line-height: 1.75;
  color: #94a3b8;
  max-height: ${({ $expanded }) => ($expanded ? 'none' : '4.5em')};
  overflow: hidden;
  position: relative;
  white-space: pre-wrap;
`

const ToggleText = styled.button`
  justify-self: start;
  margin-top: 2px;
  border: none;
  background: none;
  color: #38bdf8;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  padding: 0;
  &:hover {
    text-decoration: underline;
  }
`

const Footnote = styled.div`
  margin-top: 8px;
  padding-top: 12px;
  border-top: 1px dashed rgba(148, 163, 184, 0.25);
  font-size: 11px;
  line-height: 1.65;
  color: #64748b;
`

interface DailyMagazineDrawerProps {
  onClose: () => void
}

export default function DailyMagazineDrawer({ onClose }: DailyMagazineDrawerProps) {
  const articles = useMemo(() => builtinMagazineArticles, [])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const toggle = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <Shell data-testid="daily-magazine-drawer">
      <TopBar>
        <Brand>每日精选 · Daily</Brand>
        <CloseBtn type="button" onClick={onClose} aria-label="关闭每日推送">
          <X size={16} /> 关闭
        </CloseBtn>
      </TopBar>
      <Scroll>
        {articles.map((item: MagazineArticle) => (
          <IssueCard key={item.id}>
            <Cover $gradient={item.coverGradient}>
              <CoverTag>{item.tag}</CoverTag>
            </Cover>
            <Body>
              <MetaRow>{item.date}</MetaRow>
              <Headline>{item.headline}</Headline>
              <Deck>{item.deck}</Deck>
              <ArticleBody $expanded={Boolean(expanded[item.id])}>{item.body}</ArticleBody>
              <ToggleText type="button" onClick={() => toggle(item.id)}>
                {expanded[item.id] ? '收起正文' : '展开正文'}
              </ToggleText>
            </Body>
          </IssueCard>
        ))}
        <Footnote>
          以上为内置稿件。若需每日自动更新，可在构建或启动时拉取远端 JSON（含标题、摘要、封面 URL、正文），并与本地面包屑合并；大图建议落盘缓存后再绑定到卡片。
        </Footnote>
      </Scroll>
    </Shell>
  )
}
