import styled from 'styled-components'
import { type GenerationMode } from '../../../contexts/WorkspaceModeContext'
import { GENERATION_MODE_OPTIONS } from './generationWorkbenchConfig'

const Switcher = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  padding: 4px;
  border: 1px solid #d9e4ee;
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(243, 248, 253, 0.96) 0%, rgba(237, 243, 249, 0.96) 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
`

const ModeButton = styled.button<{ $active?: boolean }>`
  min-height: 36px;
  border-radius: 14px;
  border: 1px solid ${({ $active }) => ($active ? '#a9c7e8' : 'transparent')};
  background: ${({ $active }) => ($active ? '#ffffff' : 'transparent')};
  color: ${({ $active }) => ($active ? '#1d578d' : '#667b8f')};
  padding: 0 18px;
  font-size: var(--font-size-xs);
  font-weight: 800;
  cursor: pointer;
  transition: all 0.15s ease;
  box-shadow: ${({ $active }) => ($active ? '0 8px 18px rgba(88, 145, 212, 0.12)' : 'none')};

  &:hover:not(:disabled) {
    background: ${({ $active }) => ($active ? '#ffffff' : 'rgba(255, 255, 255, 0.74)')};
    color: #315f8c;
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`

interface GenerationModeSwitcherProps {
  value: GenerationMode
  onChange: (mode: GenerationMode) => void
}

export default function GenerationModeSwitcher({ value, onChange }: GenerationModeSwitcherProps) {
  return (
    <Switcher>
      {GENERATION_MODE_OPTIONS.map((item) => (
        <ModeButton
          key={item.value}
          type="button"
          $active={item.value === value}
          onClick={() => onChange(item.value)}
          title={item.description}
        >
          {item.label}
        </ModeButton>
      ))}
    </Switcher>
  )
}