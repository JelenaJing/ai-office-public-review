import React from 'react'

export function shouldShowPresetModal(): boolean {
  return false
}

export function resetPresetModal(): void {
  localStorage.removeItem('ai_writer_preset_seen')
}

const GlobalPresetModal: React.FC = () => null

export default GlobalPresetModal