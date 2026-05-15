import styled from 'styled-components'
import ResultPreviewPanel from './ResultPreviewPanel'

const PanelShell = styled.div`
  flex: 1;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
  background: linear-gradient(180deg, #f5f8fb 0%, #eef3f7 100%);
`

export default function GenerationWorkbenchPanel() {
  return (
    <PanelShell data-workspace-mode="generation">
      <ResultPreviewPanel />
    </PanelShell>
  )
}