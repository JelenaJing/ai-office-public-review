import styled from 'styled-components'
import {
  Calculator, GraduationCap, FolderOpen, Brain,
  ScrollText, BookMarked, BarChart2,
} from 'lucide-react'
import { useWorkspaceMode } from '../contexts/WorkspaceModeContext'
import { SceneFeatureRow } from '../components/scene/SceneFeatureRow'

interface StudyWorkspaceProps {
  onGoToWorkspace: () => void
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

export default function StudyWorkspace({ onGoToWorkspace }: StudyWorkspaceProps) {
  const {
    enterHomeworkMode,
    enterAiClassMode,
    enterDocumentGenerationMode,
    enterImageGenerationMode,
  } = useWorkspaceMode()

  const go = (fn: () => void) => { fn(); onGoToWorkspace() }

  return (
    <Page>
      <PageHeader>
        <PageTitle>学习场景</PageTitle>
        <PageSubtitle>作业解析、课程学习与科学研究辅助</PageSubtitle>
      </PageHeader>

      <FeatureList>
        <SceneFeatureRow
          icon={<Calculator size={24} />}
          title="作业解析"
          description="上传或输入题目，获得解题思路、步骤和答案"
          accent="green"
          actionLabel="作业解析"
          onClick={() => go(enterHomeworkMode)}
        />
        <SceneFeatureRow
          icon={<GraduationCap size={24} />}
          title="AI 课堂"
          description="进入课程学习和 AI 辅助讲解，需要网络连接"
          accent="green"
          status="requiresNetwork"
          actionLabel="进入课堂"
          onClick={() => go(enterAiClassMode)}
        />
        <SceneFeatureRow
          icon={<ScrollText size={24} />}
          title="论文写作"
          description="生成论文初稿、修改论文结构和整理参考文献"
          accent="blue"
          actionLabel="论文写作"
          onClick={() => go(enterDocumentGenerationMode)}
        />
        <SceneFeatureRow
          icon={<BarChart2 size={24} />}
          title="数据图表"
          description="生成科研图表和数据可视化，辅助科研汇报"
          accent="blue"
          actionLabel="生成图表"
          onClick={() => go(enterImageGenerationMode)}
        />
        <SceneFeatureRow
          icon={<FolderOpen size={24} />}
          title="课程资料"
          description="管理和引用课程资料、讲义和参考文件"
          accent="green"
          status="comingSoon"
        />
        <SceneFeatureRow
          icon={<Brain size={24} />}
          title="知识整理"
          description="整理笔记、资料和知识点，构建个人知识库"
          accent="green"
          status="comingSoon"
        />
        <SceneFeatureRow
          icon={<BookMarked size={24} />}
          title="文献资料"
          description="管理文献、论文和阅读材料，支持 PDF 解析"
          accent="blue"
          status="comingSoon"
        />
      </FeatureList>
    </Page>
  )
}

