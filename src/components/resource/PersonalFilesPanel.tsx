import styled from 'styled-components'
import { User } from 'lucide-react'
import PersonalLibrarySidebar from '../../modules/knowledge/components/PersonalLibrarySidebar'

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const Wrap = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`

const Header = styled.div`
  padding: 14px 16px 10px;
  border-bottom: 1px solid #e4ecf5;
  flex-shrink: 0;
  background: #fafdff;
`

const HeaderTitle = styled.div`
  font-size: 15px;
  font-weight: 700;
  color: #1f3044;
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 4px;
`

const SubTitle = styled.div`
  font-size: var(--font-size-xs);
  color: #6b84a0;
  line-height: 1.5;
`

const SelectionNote = styled.div`
  margin: 0 14px;
  padding: 8px 12px;
  border-radius: 8px;
  background: #f0f7ff;
  border: 1px solid #d0e6f7;
  font-size: var(--font-size-xs);
  color: #3a6fa0;
  line-height: 1.5;
  flex-shrink: 0;
`

const SidebarWrap = styled.div`
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
`

// ---------------------------------------------------------------------------

export default function PersonalFilesPanel() {
  return (
    <Wrap>
      <Header>
        <HeaderTitle>
          <User size={15} />
          个人文件
        </HeaderTitle>
        <SubTitle>上传和管理个人文件，可在生成任务中作为参考资料。</SubTitle>
      </Header>

      <SelectionNote style={{ marginTop: 10, marginBottom: 8 }}>
        💡 已选择的个人文件将在后续生成任务中作为参考资料使用（接入进行中）
      </SelectionNote>

      <SidebarWrap>
        <PersonalLibrarySidebar />
      </SidebarWrap>
    </Wrap>
  )
}
