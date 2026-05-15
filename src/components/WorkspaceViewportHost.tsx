import { useEffect, useRef } from 'react'
import styled from 'styled-components'
import DocumentEngineHost from '../modules/writing/components/DocumentEngineHost'
import GenerationWorkbenchPanel from '../modules/generation/components/GenerationWorkbenchPanel'
import CommunicationWorkbench from '../communication/CommunicationWorkbench'
import HomeworkWorkbench from '../modules/homework/components/HomeworkWorkbench'
import AiClassWorkbench from '../modules/homework/components/AiClassWorkbench'
import AiForumWorkbench from '../modules/homework/components/AiForumWorkbench'
import ExcelAnalysisWorkbench from '../modules/excel-analysis/components/ExcelAnalysisWorkbench'
import DailyFeedWorkbench from '../modules/feed/components/DailyFeedWorkbench'
import ModelDevPanel from './ModelDevPanel'
import { useWorkspaceMode } from '../contexts/WorkspaceModeContext'

const GenerationShell = styled.div`
  width: 100%;
  height: 100%;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, #f8fbfe 0%, #eef4f9 100%);
`

const ViewportBody = styled.div`
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  overflow: hidden;
`

const EditorViewportShell = styled.div`
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
`

// Wraps each panel; hidden panels remain mounted (keep-alive) to preserve their state.
const ViewportSlot = styled.div<{ $active: boolean }>`
  ${({ $active }) => $active
    ? 'flex: 1; min-width: 0; min-height: 0; display: flex; overflow: hidden;'
    : 'display: none;'}
`

type PanelKey = 'freewrite' | 'paper' | 'workbench' | 'email' | 'homework' | 'ai-class' | 'ai-forum' | 'data' | 'model' | 'daily-feed'

function resolvePanelKey(mode: string, generationMode: string): PanelKey {
  if (mode === 'free') return 'freewrite'
  if (generationMode === 'document' || generationMode === 'daily-report') return 'paper'
  if (generationMode === 'email') return 'email'
  if (generationMode === 'homework') return 'homework'
  if (generationMode === 'ai-class') return 'ai-class'
  if (generationMode === 'ai-forum') return 'ai-forum'
  if (generationMode === 'data') return 'data'
  if (generationMode === 'model') return 'model'
  if (generationMode === 'daily-feed') return 'daily-feed'
  return 'workbench' // image / ppt / paper generation
}

interface WorkspaceViewportHostProps {
  ghostTextEnabled: boolean
}

export default function WorkspaceViewportHost({ ghostTextEnabled }: WorkspaceViewportHostProps) {
  const { mode, generationMode, setGenerationMode } = useWorkspaceMode()
  const activePanel = resolvePanelKey(mode, generationMode)

  // Listen for "open-communication-workbench" events dispatched by any component
  // that wants to programmatically navigate to the email/communication mode.
  useEffect(() => {
    const handler = () => setGenerationMode('email')
    window.addEventListener('open-communication-workbench', handler)
    return () => window.removeEventListener('open-communication-workbench', handler)
  }, [setGenerationMode])

  // Lazily track which panels have ever been activated so we only mount them
  // on first visit and keep them alive (hidden) on subsequent mode switches.
  const mountedRef = useRef<Set<PanelKey>>(new Set())
  mountedRef.current.add(activePanel)
  const mounted = (key: PanelKey) => mountedRef.current.has(key)

  return (
    <>
      <ViewportSlot $active={activePanel === 'freewrite'}>
        {mounted('freewrite') && (
          <EditorViewportShell>
            <DocumentEngineHost ghostTextEnabled={ghostTextEnabled} manuscriptProfile="freewrite" active={activePanel === 'freewrite'} />
          </EditorViewportShell>
        )}
      </ViewportSlot>

      <ViewportSlot $active={activePanel === 'paper'}>
        {mounted('paper') && (
          <EditorViewportShell>
            <DocumentEngineHost ghostTextEnabled={ghostTextEnabled} manuscriptProfile="paper" active={activePanel === 'paper'} />
          </EditorViewportShell>
        )}
      </ViewportSlot>

      <ViewportSlot $active={activePanel === 'workbench'}>
        {mounted('workbench') && (
          <GenerationShell>
            <ViewportBody>
              <GenerationWorkbenchPanel />
            </ViewportBody>
          </GenerationShell>
        )}
      </ViewportSlot>

      <ViewportSlot $active={activePanel === 'email'}>
        {mounted('email') && <CommunicationWorkbench />}
      </ViewportSlot>

      <ViewportSlot $active={activePanel === 'homework'}>
        {mounted('homework') && (
          <GenerationShell>
            <HomeworkWorkbench />
          </GenerationShell>
        )}
      </ViewportSlot>

      <ViewportSlot $active={activePanel === 'ai-class'}>
        {mounted('ai-class') && <AiClassWorkbench />}
      </ViewportSlot>

      <ViewportSlot $active={activePanel === 'ai-forum'}>
        {mounted('ai-forum') && <AiForumWorkbench />}
      </ViewportSlot>

      <ViewportSlot $active={activePanel === 'data'}>
        {mounted('data') && <ExcelAnalysisWorkbench />}
      </ViewportSlot>

      <ViewportSlot $active={activePanel === 'model'}>
        {mounted('model') && <ModelDevPanel />}
      </ViewportSlot>

      <ViewportSlot $active={activePanel === 'daily-feed'}>
        {mounted('daily-feed') && <DailyFeedWorkbench />}
      </ViewportSlot>
    </>
  )
}