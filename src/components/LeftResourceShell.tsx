import styled from 'styled-components'
import { BookUser, Database, FolderOpen, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import FileExplorer from './FileExplorer'
import GenerationKnowledgeSidebar from '../modules/generation/components/GenerationKnowledgeSidebar'
import PersonalLibrarySidebar from '../modules/knowledge/components/PersonalLibrarySidebar'

export type LeftResourceView = 'files' | 'knowledge' | 'personal-library'

interface LeftResourceShellProps {
  expanded: boolean
  activeView: LeftResourceView
  onChangeView: (view: LeftResourceView) => void
  onExpand: () => void
  onCollapse: () => void
}

const Shell = styled.div`
  height: 100%;
  min-height: 0;
  flex-shrink: 0;
  display: flex;
  overflow: hidden;
  border-right: 1px solid #d9e2ec;
  background: linear-gradient(180deg, #f8fbff 0%, #f1f6fb 100%);
`

const ActivityRail = styled.div`
  width: 52px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  padding: 10px 8px;
  border-right: 1px solid #e0e8f1;
  background: linear-gradient(180deg, #ffffff 0%, #f5f8fc 100%);
`

const ActivityGroup = styled.div`
  display: grid;
  gap: 8px;
  width: 100%;
`

const ActivityButton = styled.button<{ $active?: boolean }>`
  width: 100%;
  height: 38px;
  border-radius: 12px;
  border: 1px solid ${({ $active }) => ($active ? '#b7d1ec' : 'transparent')};
  background: ${({ $active }) => ($active ? '#eaf4ff' : 'transparent')};
  color: ${({ $active }) => ($active ? '#17456d' : '#6a7f94')};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.14s ease, border-color 0.14s ease, color 0.14s ease;

  &:hover {
    background: ${({ $active }) => ($active ? '#e3f0ff' : '#edf3fa')};
    color: #1f3447;
  }
`

const ResourcePane = styled.div<{ $expanded?: boolean }>`
  width: ${({ $expanded }) => ($expanded ? '420px' : '0')};
  min-width: ${({ $expanded }) => ($expanded ? '420px' : '0')};
  max-width: ${({ $expanded }) => ($expanded ? '420px' : '0')};
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: linear-gradient(180deg, #fbfdff 0%, #f3f8fd 100%);
  transition: width 0.18s ease, min-width 0.18s ease, max-width 0.18s ease;
`

const ResourcePaneInner = styled.div`
  width: 420px;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  display: flex;
`

const ViewLayer = styled.div<{ $active?: boolean }>`
  width: 100%;
  height: 100%;
  min-height: 0;
  min-width: 0;
  display: ${({ $active }) => ($active ? 'flex' : 'none')};
  overflow: hidden;
`

export default function LeftResourceShell({
  expanded,
  activeView,
  onChangeView,
  onExpand,
  onCollapse,
}: LeftResourceShellProps) {
  const handleActivate = (view: LeftResourceView) => {
    if (activeView !== view) {
      onChangeView(view)
      if (!expanded) onExpand()
      return
    }

    if (expanded) {
      onCollapse()
      return
    }

    onExpand()
  }

  return (
    <Shell data-testid="left-resource-shell">
      <ActivityRail>
        <ActivityGroup>
          <ActivityButton
            type="button"
            $active={expanded && activeView === 'files'}
            title="文件管理器"
            aria-label="切换到文件管理器"
            onClick={() => handleActivate('files')}
          >
            <FolderOpen size={18} />
          </ActivityButton>
          <ActivityButton
            type="button"
            $active={expanded && activeView === 'knowledge'}
            title="知识库"
            aria-label="切换到知识库"
            onClick={() => handleActivate('knowledge')}
          >
            <Database size={18} />
          </ActivityButton>
          <ActivityButton
            type="button"
            $active={expanded && activeView === 'personal-library'}
            title="个人文件库"
            aria-label="切换到个人文件库"
            onClick={() => handleActivate('personal-library')}
          >
            <BookUser size={18} />
          </ActivityButton>
        </ActivityGroup>

        <ActivityButton
          type="button"
          $active={expanded}
          title={expanded ? '收起左侧资源区' : '展开左侧资源区'}
          aria-label={expanded ? '收起左侧资源区' : '展开左侧资源区'}
          onClick={expanded ? onCollapse : onExpand}
        >
          {expanded ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </ActivityButton>
      </ActivityRail>

      <ResourcePane $expanded={expanded}>
        <ResourcePaneInner>
          <ViewLayer $active={activeView === 'files'}>
            <FileExplorer embedded panelMode="documents" showKnowledgeDock={false} />
          </ViewLayer>
          <ViewLayer $active={activeView === 'knowledge'}>
            <GenerationKnowledgeSidebar embedded />
          </ViewLayer>
          <ViewLayer $active={activeView === 'personal-library'}>
            <PersonalLibrarySidebar />
          </ViewLayer>
        </ResourcePaneInner>
      </ResourcePane>
    </Shell>
  )
}