import styled from 'styled-components'
import { Globe, PenLine, Palette, BookHeart, Sparkles, Coffee, Microscope } from 'lucide-react'
import { useWorkspaceMode } from '../contexts/WorkspaceModeContext'
import { SceneFeatureRow } from '../components/scene/SceneFeatureRow'

interface LifeWorkspaceProps {
  onGoToWorkspace: () => void
}

const Page = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  background: #fdf8f4;
  padding: 40px 56px;
`

const PageHeader = styled.div`
  margin-bottom: 28px;
  flex-shrink: 0;
`

const PageTitle = styled.h1`
  margin: 0 0 6px;
  font-size: 28px;
  font-weight: 800;
  color: #2d1f0f;
`

const PageSubtitle = styled.p`
  margin: 0;
  font-size: 14px;
  color: #8a6f58;
`

const FeatureList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
`

export default function LifeWorkspace({ onGoToWorkspace }: LifeWorkspaceProps) {
  const {
    enterAiForumMode,
    enterFreeMode,
    enterImageGenerationMode,
    enterDailyFeedMode,
  } = useWorkspaceMode()

  const go = (fn: () => void) => { fn(); onGoToWorkspace() }

  return (
    <Page>
      <PageHeader>
        <PageTitle>生活场景</PageTitle>
        <PageSubtitle>兴趣创作、个人记录与轻量社区</PageSubtitle>
      </PageHeader>

      <FeatureList>
        <SceneFeatureRow
          icon={<Globe size={24} />}
          title="AI 论坛"
          description="连接在线社区，浏览和参与讨论内容"
          accent="orange"
          status="requiresNetwork"
          actionLabel="打开论坛"
          onClick={() => go(enterAiForumMode)}
        />
        <SceneFeatureRow
          icon={<PenLine size={24} />}
          title="轻量写作"
          description="自由写作、随笔和日常表达，轻松记录想法"
          accent="orange"
          actionLabel="开始写作"
          onClick={() => go(enterFreeMode)}
        />
        <SceneFeatureRow
          icon={<Palette size={24} />}
          title="图片创作"
          description="生成生活图片、头像、海报和创意图"
          accent="orange"
          actionLabel="创作图片"
          onClick={() => go(enterImageGenerationMode)}
        />
        <SceneFeatureRow
          icon={<Microscope size={24} />}
          title="科学资讯"
          description="浏览最新科研动态，阅读科学解读文章（需要网络连接）"
          accent="orange"
          status="requiresNetwork"
          actionLabel="科学资讯"
          onClick={() => go(enterDailyFeedMode)}
        />
        <SceneFeatureRow
          icon={<BookHeart size={24} />}
          title="生活记录"
          description="记录日常想法、计划和备忘，管理个人日志"
          accent="orange"
          status="comingSoon"
        />
        <SceneFeatureRow
          icon={<Sparkles size={24} />}
          title="兴趣创作"
          description="围绕兴趣主题进行创意生成和内容探索"
          accent="orange"
          status="comingSoon"
        />
        <SceneFeatureRow
          icon={<Coffee size={24} />}
          title="放松助手"
          description="提供轻量陪伴和放松内容，调节工作节奏"
          accent="orange"
          status="comingSoon"
        />
      </FeatureList>
    </Page>
  )
}

