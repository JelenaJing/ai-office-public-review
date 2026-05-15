// vNext freeze: this host selects the current freewrite authoring surface.
// It is not the long-term Word fidelity boundary or a delivery engine.
import React, { Suspense, lazy } from 'react'
import { getActiveDocumentEngine } from '../../../engines/documentEngine/registry'
import type { ManuscriptProfileId } from '../../../components/manuscript/ManuscriptProfileSwitcher'

const EditorPanel = lazy(() => import('./EditorPanel'))

interface DocumentEngineHostProps {
  ghostTextEnabled: boolean
  manuscriptProfile?: ManuscriptProfileId
  headless?: boolean
  active?: boolean
}

export default function DocumentEngineHost({ ghostTextEnabled, manuscriptProfile = 'freewrite', headless = false, active = true }: DocumentEngineHostProps) {
  const engine = getActiveDocumentEngine()

  return (
    <Suspense fallback={<div style={{ flex: 1, background: '#ffffff' }} />}>
      <EditorPanel
        ghostTextEnabled={ghostTextEnabled}
        preferredEngineId={engine.id}
        manuscriptProfile={manuscriptProfile}
        headless={headless}
        active={active}
      />
    </Suspense>
  )
}