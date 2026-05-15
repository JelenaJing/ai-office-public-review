import styled from 'styled-components'
import { FileText, Mail, BarChart2, Presentation, CalendarClock } from 'lucide-react'
import { useWorkspaceMode } from '../contexts/WorkspaceModeContext'
import { SceneFeatureRow } from '../components/scene/SceneFeatureRow'
import type { PrimarySection } from '../components/nav/PrimaryNav'

interface WorkWorkspaceProps {
  onGoToWorkspace: () => void
  onNavigate: (section: PrimarySection) => void
}

const Page = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  background: #f4f7fc;
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
  color: #1a2f47;
`

const PageSubtitle = styled.p`
  margin: 0;
  font-size: 14px;
  color: #6b7f94;
`

const FeatureList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
`

export default function WorkWorkspace({ onGoToWorkspace, onNavigate }: WorkWorkspaceProps) {
  const {
    enterFreeMode,
    enterEmailMode,
    enterDataMode,
    enterPptGenerationMode,
  } = useWorkspaceMode()

  const go = (fn: () => void) => { fn(); onGoToWorkspace() }

  return (
    <Page>
      <PageHeader>
        <PageTitle>工作场景</PageTitle>
        <PageSubtitle>文稿编辑、邮件收发、日程管理、数据分析与 PPT 生成</PageSubtitle>
      </PageHeader>

      <FeatureList>
        <SceneFeatureRow
          icon={<FileText size={24} />}
          title="文稿编辑"
          description="新建、编辑、生成和导出文稿 / PPT / 模板材料"
          accent="blue"
          actionLabel="进入"
          onClick={() => go(enterFreeMode)}
        />
        <SceneFeatureRow
          icon={<Mail size={24} />}
          title="邮件收发"
          description="收发邮件、新建邮件、AI 预回复和附件管理"
          accent="purple"
          actionLabel="进入"
          onClick={() => go(enterEmailMode)}
        />
        <SceneFeatureRow
          icon={<CalendarClock size={24} />}
          title="日程管理"
          description="AI识别邮件中的会议、截止事项和候选时间，自动生成日程并检测时间冲突"
          accent="indigo"
          actionLabel="进入"
          onClick={() => onNavigate('calendar')}
        />
        <SceneFeatureRow
          icon={<BarChart2 size={24} />}
          title="数据分析"
          description="分析表格、生成图表、整理数据结论"
          accent="teal"
          actionLabel="进入"
          onClick={() => go(enterDataMode)}
        />
        <SceneFeatureRow
          icon={<Presentation size={24} />}
          title="PPT 生成"
          description="根据主题、资料和模板生成演示文稿，支持 Skill 模板"
          accent="orange"
          actionLabel="进入"
          onClick={() => go(enterPptGenerationMode)}
        />
      </FeatureList>
    </Page>
  )
}

