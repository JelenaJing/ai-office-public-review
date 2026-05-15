import styled from 'styled-components'
import React from 'react'
import { Briefcase, BookOpen, Heart, RefreshCw } from 'lucide-react'
import { useWorkspace } from '../contexts/WorkspaceContext'
import type { PrimarySection } from '../components/nav/PrimaryNav'
import { PRODUCT_FEATURES } from '../config/productFeatures'

interface HomeDashboardProps {
  onNavigate: (section: PrimarySection) => void
}

const Page = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  background: #f4f7fc;
  padding: 48px 64px;
`

const Header = styled.div`
  margin-bottom: 44px;
  text-align: center;
`

const Title = styled.h1`
  margin: 0 0 10px;
  font-size: 36px;
  font-weight: 800;
  color: #1a2f47;
`

const Subtitle = styled.p`
  margin: 0;
  font-size: 16px;
  color: #6b7f94;
`

const ScenarioGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(320px, 1fr));
  gap: 32px;
  width: 100%;

  @media (max-width: 1000px) {
    grid-template-columns: repeat(2, 1fr);
  }

  @media (max-width: 680px) {
    grid-template-columns: 1fr;
  }
`

const ScenarioCard = styled.button<{ $accent: string; $accentBg: string }>`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 36px 32px 28px;
  min-height: clamp(260px, 30vh, 360px);
  border: 1.5px solid ${p => p.$accentBg};
  border-radius: 18px;
  background: #ffffff;
  cursor: pointer;
  text-align: left;
  transition: box-shadow 0.15s, transform 0.15s, border-color 0.15s;

  &:hover {
    border-color: ${p => p.$accent};
    box-shadow: 0 8px 36px rgba(0,0,0,0.11);
    transform: translateY(-4px);
  }
`

const CardIconWrap = styled.div<{ $bg: string }>`
  width: 64px;
  height: 64px;
  border-radius: 16px;
  background: ${p => p.$bg};
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 20px;
  flex-shrink: 0;
`

const CardTitle = styled.div`
  font-size: 20px;
  font-weight: 800;
  color: #1a2f47;
  margin-bottom: 10px;
`

const CardDesc = styled.div`
  font-size: 14px;
  color: #6b7f94;
  line-height: 1.6;
  margin-bottom: 20px;
  flex: 1;
`

const ChipRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`

const Chip = styled.span<{ $accent: string; $accentBg: string }>`
  display: inline-block;
  padding: 5px 14px;
  border-radius: 999px;
  background: ${p => p.$accentBg};
  color: ${p => p.$accent};
  font-size: var(--font-size-xs);
  font-weight: 600;
`

const WorkspaceBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-top: 36px;
  padding: 14px 24px;
  background: #ffffff;
  border: 1px solid #dde6f0;
  border-radius: 12px;
  width: 100%;
`

const WorkspaceLabel = styled.span`
  font-size: 14px;
  color: #6b7f94;
  flex-shrink: 0;
`

const WorkspaceName = styled.span`
  font-size: 14px;
  font-weight: 700;
  color: #1a2f47;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
`

const SwitchBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 8px 16px;
  border: 1px solid #c8d6e8;
  border-radius: 8px;
  background: #f4f7fb;
  color: #3d5a78;
  font-size: var(--font-size-xs);
  font-weight: 600;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.13s, border-color 0.13s;
  &:hover { background: #e6f0fb; border-color: #96b8dc; }
`

interface HomeCardDef {
  featureKey: keyof Pick<typeof PRODUCT_FEATURES, 'work' | 'learning' | 'life'>
  section: PrimarySection
  accent: string
  accentBg: string
  iconBg: string
  icon: React.ReactElement
  title: string
  desc: string
  chips: string[]
}

const HOME_CARD_DEFS: HomeCardDef[] = [
  {
    featureKey: 'work',
    section: 'work',
    accent: '#1f6fd6',
    accentBg: '#e6f0fc',
    iconBg: '#deeeff',
    icon: <Briefcase size={30} color="#1f6fd6" />,
    title: '工作',
    desc: '文稿、PPT、邮件、图片与办公资料',
    chips: ['文稿', 'PPT', '邮件', '图片'],
  },
  {
    featureKey: 'learning',
    section: 'study',
    accent: '#1a7a4a',
    accentBg: '#e4f5ec',
    iconBg: '#d5f0e2',
    icon: <BookOpen size={30} color="#1a7a4a" />,
    title: '学习',
    desc: '作业解析、课程学习与科学研究',
    chips: ['作业解析', 'AI课堂', '课程资料', '科学研究'],
  },
  {
    featureKey: 'life',
    section: 'life',
    accent: '#c05c15',
    accentBg: '#fdf0e6',
    iconBg: '#fce5cf',
    icon: <Heart size={30} color="#c05c15" />,
    title: '生活',
    desc: '兴趣创作、个人记录与轻量社区',
    chips: ['AI论坛', '轻量写作', '图片创作', '生活记录'],
  },
]

export default function HomeDashboard({ onNavigate }: HomeDashboardProps) {
  const { activeWorkspaceName, activeWorkspacePath, closeWorkspace } = useWorkspace()

  const visibleCards = HOME_CARD_DEFS.filter(card => PRODUCT_FEATURES[card.featureKey])

  return (
    <Page>
      <Header>
        <Title>AI-Office 个人工作台</Title>
        <Subtitle>围绕工作、学习、生活三个场景组织你的 AI 能力</Subtitle>
      </Header>

      <ScenarioGrid>
        {visibleCards.map(card => (
          <ScenarioCard
            key={card.featureKey}
            $accent={card.accent}
            $accentBg={card.accentBg}
            onClick={() => onNavigate(card.section)}
          >
            <CardIconWrap $bg={card.iconBg}>
              {card.icon}
            </CardIconWrap>
            <CardTitle>{card.title}</CardTitle>
            <CardDesc>{card.desc}</CardDesc>
            <ChipRow>
              {card.chips.map(c => (
                <Chip key={c} $accent={card.accent} $accentBg={card.accentBg}>{c}</Chip>
              ))}
            </ChipRow>
          </ScenarioCard>
        ))}
      </ScenarioGrid>

      {activeWorkspaceName && (
        <WorkspaceBar>
          <WorkspaceLabel>当前工作区：</WorkspaceLabel>
          <WorkspaceName title={activeWorkspacePath ?? undefined}>
            {activeWorkspaceName}
          </WorkspaceName>
          <SwitchBtn onClick={closeWorkspace}>
            <RefreshCw size={11} />
            切换工作区
          </SwitchBtn>
        </WorkspaceBar>
      )}
    </Page>
  )
}

