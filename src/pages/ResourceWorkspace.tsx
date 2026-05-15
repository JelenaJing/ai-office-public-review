import { useState } from 'react'
import styled from 'styled-components'
import { FolderOpen, BookOpen, User } from 'lucide-react'
import WorkspaceFilesPanel from '../components/resource/WorkspaceFilesPanel'
import KnowledgePanel from '../components/resource/KnowledgePanel'
import PersonalFilesPanel from '../components/resource/PersonalFilesPanel'

type ResourceTab = 'files' | 'kb' | 'personal'

interface ResourceWorkspaceProps {
  onGoToWorkspace?: () => void
}

const Page = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #f4f7fc;
`

const PageHeader = styled.div`
  padding: 20px 28px 0;
  flex-shrink: 0;
`

const PageTitle = styled.h1`
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: 800;
  color: #1a2f47;
`

const PageSubtitle = styled.p`
  margin: 0 0 16px;
  font-size: var(--font-size-xs);
  color: #6b7f94;
`

const TabBar = styled.div`
  display: flex;
  align-items: center;
  gap: 0;
  padding: 0 28px;
  border-bottom: 1px solid #dde3ec;
  background: #f4f7fc;
  flex-shrink: 0;
`

const Tab = styled.button<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  border: none;
  border-bottom: 2px solid ${p => p.$active ? '#1f6fd6' : 'transparent'};
  background: transparent;
  color: ${p => p.$active ? '#1f6fd6' : '#4a5f73'};
  font-size: var(--font-size-xs);
  font-weight: ${p => p.$active ? '700' : '500'};
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;

  &:hover {
    color: #1f6fd6;
  }
`

const PanelArea = styled.div`
  flex: 1;
  min-height: 0;
  background: #ffffff;
  margin: 12px 28px 20px;
  border: 1px solid #e2e8f2;
  border-radius: 12px;
  overflow: hidden;
  display: flex;
`

const PanelWrap = styled.div<{ $visible: boolean }>`
  display: ${p => p.$visible ? 'flex' : 'none'};
  flex: 1;
  min-height: 0;
  overflow: hidden;
`

export default function ResourceWorkspace({ onGoToWorkspace }: ResourceWorkspaceProps) {
  const [tab, setTab] = useState<ResourceTab>('files')

  return (
    <Page>
      <PageHeader>
        <PageTitle>资源中心</PageTitle>
        <PageSubtitle>管理工作区文件、知识库和个人文件</PageSubtitle>
      </PageHeader>

      <TabBar>
        <Tab $active={tab === 'files'} onClick={() => setTab('files')}>
          <FolderOpen size={14} /> 工作区文件
        </Tab>
        <Tab $active={tab === 'kb'} onClick={() => setTab('kb')}>
          <BookOpen size={14} /> 知识库
        </Tab>
        <Tab $active={tab === 'personal'} onClick={() => setTab('personal')}>
          <User size={14} /> 个人文件
        </Tab>
      </TabBar>

      <PanelArea>
        <PanelWrap $visible={tab === 'files'}>
          <WorkspaceFilesPanel onFileOpen={onGoToWorkspace} />
        </PanelWrap>
        <PanelWrap $visible={tab === 'kb'}>
          <KnowledgePanel />
        </PanelWrap>
        <PanelWrap $visible={tab === 'personal'}>
          <PersonalFilesPanel />
        </PanelWrap>
      </PanelArea>
    </Page>
  )
}

