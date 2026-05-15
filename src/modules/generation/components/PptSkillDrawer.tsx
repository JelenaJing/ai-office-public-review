import React, { useEffect, useState } from 'react'
import styled from 'styled-components'

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.55);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
`

const Drawer = styled.div`
  width: min(920px, 96vw);
  max-height: min(720px, 92vh);
  background: #1e2538;
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  box-shadow: 0 22px 80px rgba(0,0,0,0.45);
  overflow: hidden;
`

const DrawerHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px 14px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
`

const DrawerTitle = styled.div`
  font-size: 15px;
  font-weight: 700;
  color: #e2e8f0;
`

const CloseBtn = styled.button`
  background: none;
  border: none;
  color: rgba(255,255,255,0.5);
  font-size: 18px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  &:hover { background: rgba(255,255,255,0.1); color: #fff; }
`

const DrawerBody = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  display: grid;
  grid-template-columns: minmax(260px, 360px) minmax(320px, 1fr);
  gap: 14px;
  min-height: 0;

  &::-webkit-scrollbar { width: 4px; }
  &::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`

const TemplateList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`

const SkillCard = styled.div<{ $active: boolean }>`
  border: 2px solid ${({ $active }) => $active ? '#60a5fa' : 'rgba(255,255,255,0.1)'};
  border-radius: 8px;
  padding: 10px;
  cursor: pointer;
  background: ${({ $active }) => $active ? 'rgba(96,165,250,0.1)' : 'rgba(255,255,255,0.03)'};
  transition: border-color 0.15s, background 0.15s;
  display: grid;
  gap: 8px;

  &:hover {
    border-color: ${({ $active }) => $active ? '#60a5fa' : 'rgba(255,255,255,0.2)'};
    background: rgba(255,255,255,0.06);
  }
`

const SkillInfo = styled.div`
  flex: 1;
  min-width: 0;
`

const SkillName = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: #e2e8f0;
  margin-bottom: 2px;
`

const SkillDesc = styled.div`
  font-size: var(--font-size-xs);
  color: rgba(255,255,255,0.45);
  line-height: 1.4;
`

const SkillMeta = styled.div`
  margin-top: 4px;
  font-size: var(--font-size-xs);
  color: rgba(255,255,255,0.45);
`

const PreviewFrame = styled.div<{ $color: string; $large?: boolean }>`
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: ${({ $large }) => $large ? '14px' : '8px'};
  border: 1px solid rgba(255,255,255,0.14);
  background:
    radial-gradient(circle at 84% 18%, ${({ $color }) => `${normalizeColor($color)}33`} 0 14%, transparent 15%),
    linear-gradient(135deg, ${({ $color }) => `${normalizeColor($color)}22`} 0%, #f8fafc 46%, #e2e8f0 100%);
`

const PreviewAccent = styled.div<{ $color: string }>`
  position: absolute;
  left: 0;
  top: 0;
  width: 34%;
  height: 100%;
  background: linear-gradient(180deg, ${({ $color }) => normalizeColor($color)}, ${({ $color }) => `${normalizeColor($color)}99`});
  opacity: 0.9;
`

const PreviewTitleBox = styled.div<{ $large?: boolean }>`
  position: absolute;
  left: 9%;
  top: ${({ $large }) => $large ? '18%' : '20%'};
  width: 48%;
  height: ${({ $large }) => $large ? '10%' : '12%'};
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.88);
`

const PreviewBodyLine = styled.div<{ $top: number; $width: number; $large?: boolean }>`
  position: absolute;
  left: 9%;
  top: ${({ $top }) => `${$top}%`};
  width: ${({ $width }) => `${$width}%`};
  height: ${({ $large }) => $large ? '4%' : '5%'};
  border-radius: 999px;
  background: rgba(100, 116, 139, 0.72);
`

const PreviewImageBox = styled.div<{ $color: string }>`
  position: absolute;
  right: 9%;
  top: 24%;
  width: 30%;
  height: 48%;
  border-radius: 12px;
  background: ${({ $color }) => `${normalizeColor($color)}26`};
  border: 2px dashed ${({ $color }) => `${normalizeColor($color)}88`};
`

const PreviewPanel = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 12px;
  background: rgba(255,255,255,0.035);
`

const PreviewPanelTitle = styled.div`
  font-size: 14px;
  font-weight: 800;
  color: #f8fafc;
`

const PreviewPanelDesc = styled.div`
  font-size: var(--font-size-xs);
  color: rgba(255,255,255,0.55);
  line-height: 1.6;
`

const ActiveBadge = styled.span`
  background: #60a5fa;
  color: #111827;
  font-size: var(--font-size-xs);
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 10px;
  margin-left: 6px;
  vertical-align: middle;
`

const SourceBadge = styled.span<{ $source?: 'built-in' | 'skill' }>`
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: var(--font-size-xs);
  font-weight: 700;
  background: ${({ $source }) => $source === 'built-in' ? 'rgba(251,191,36,0.18)' : 'rgba(96,165,250,0.18)'};
  color: ${({ $source }) => $source === 'built-in' ? '#fde68a' : '#bfdbfe'};
`

const DrawerFooter = styled.div`
  padding: 14px 16px;
  border-top: 1px solid rgba(255,255,255,0.08);
`

const ApplyBtn = styled.button<{ $disabled: boolean }>`
  width: 100%;
  padding: 10px;
  border-radius: 7px;
  border: none;
  font-size: var(--font-size-sm);
  font-weight: 700;
  cursor: ${({ $disabled }) => $disabled ? 'not-allowed' : 'pointer'};
  background: ${({ $disabled }) => $disabled ? 'rgba(255,255,255,0.1)' : '#3b82f6'};
  color: ${({ $disabled }) => $disabled ? 'rgba(255,255,255,0.3)' : '#fff'};
  transition: background 0.15s;

  &:hover:not(:disabled) { background: #2563eb; }
`

const StatusLine = styled.div<{ $type: 'applying' | 'success' | 'error' }>`
  text-align: center;
  font-size: var(--font-size-xs);
  margin-top: 8px;
  color: ${({ $type }) => $type === 'error' ? '#f87171' : $type === 'success' ? '#4ade80' : '#fbbf24'};
`

const EmptyMsg = styled.div`
  text-align: center;
  font-size: var(--font-size-xs);
  color: rgba(255,255,255,0.3);
  padding: 32px 0;
`

interface SkillInfo {
  id: string
  name: string
  description?: string
  previewColor?: string
  source?: 'built-in' | 'skill'
  widthInches?: number
  heightInches?: number
}

function normalizeColor(color?: string): string {
  const value = String(color || '3b82f6').replace(/^#/, '').slice(0, 6).padEnd(6, '0')
  return `#${value || '3b82f6'}`
}

function formatSourceLabel(source?: SkillInfo['source']): string {
  if (source === 'built-in') return '内置'
  return 'Skill'
}

function formatTemplateMeta(skill?: SkillInfo): string {
  if (!skill) return ''
  const parts: string[] = []
  if (typeof skill.widthInches === 'number' && typeof skill.heightInches === 'number') {
    parts.push(`${skill.widthInches.toFixed(1)} × ${skill.heightInches.toFixed(1)} in`)
  }
  return parts.join(' · ')
}

function TemplatePreview({ skill, large = false }: { skill: SkillInfo; large?: boolean }) {
  const color = skill.previewColor || '3b82f6'
  return (
    <PreviewFrame $color={color} $large={large}>
      <PreviewAccent $color={color} />
      <PreviewTitleBox $large={large} />
      <PreviewBodyLine $top={large ? 38 : 42} $width={42} $large={large} />
      <PreviewBodyLine $top={large ? 49 : 54} $width={35} $large={large} />
      <PreviewBodyLine $top={large ? 60 : 66} $width={28} $large={large} />
      <PreviewImageBox $color={color} />
    </PreviewFrame>
  )
}

interface PptSkillDrawerProps {
  open: boolean
  skills: SkillInfo[]
  activeSkillId: string | null
  contentPackageId: string | null
  workspacePath: string | null
  /** DeckDocument ID, if available. When set, template switching uses deckRender (zero LLM/token). */
  deckDocumentId?: string | null
  onClose: () => void
  onApplied: (skillId: string, outputPath: string) => void
}

export default function PptSkillDrawer({
  open,
  skills,
  activeSkillId,
  contentPackageId,
  workspacePath,
  deckDocumentId,
  onClose,
  onApplied,
}: PptSkillDrawerProps) {
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(activeSkillId)
  const [applying, setApplying] = useState(false)
  const [applyStatus, setApplyStatus] = useState<{ type: 'applying' | 'success' | 'error'; msg: string } | null>(null)

  // Reset selection when drawer opens
  useEffect(() => {
    if (open) {
      setSelectedSkillId(activeSkillId ?? skills[0]?.id ?? null)
      setApplyStatus(null)
    }
  }, [open, activeSkillId, skills])

  if (!open) return null
  const selectedSkill = skills.find((skill) => skill.id === selectedSkillId) || skills[0]

  const canApply = Boolean(
    selectedSkillId && (contentPackageId || deckDocumentId) && workspacePath && !applying && selectedSkillId !== activeSkillId
  )

  const handleApply = async () => {
    if (!selectedSkillId || !workspacePath || applying) return
    if (!contentPackageId && !deckDocumentId) return
    setApplying(true)
    setApplyStatus({ type: 'applying', msg: '正在应用模板... · 不消耗 token' })
    try {
      // Prefer new DeckDocument path: no LLM, no image generation, zero token cost
      if (deckDocumentId) {
        setApplyStatus({ type: 'applying', msg: '正在重新渲染... · 不消耗 token' })
        const result = await window.electronAPI.deckRender({
          workspacePath,
          deckId: deckDocumentId,
          manifestId: selectedSkillId,
        })
        if (!result.success || !result.outputPath) {
          // Fall back to legacy path if deck render fails
          if (contentPackageId) {
            const legacyResult = await window.electronAPI.pptxRenderWithSkill({
              workspacePath,
              contentPackageId,
              skillId: selectedSkillId,
            })
            if (!legacyResult.success || !legacyResult.outputPath) {
              setApplyStatus({ type: 'error', msg: `应用失败：${legacyResult.error || '未知错误'}` })
              return
            }
            console.log('[apply_skill]', {
              skillId: selectedSkillId,
              path: 'legacy_pptxRenderWithSkill',
              llmCalls: 0,
              imageCalls: 0,
              tokenCost: 0,
            })
            setApplyStatus({ type: 'success', msg: '模板已应用 · 不消耗 token' })
            onApplied(selectedSkillId, legacyResult.outputPath)
            setTimeout(() => onClose(), 800)
            return
          }
          setApplyStatus({ type: 'error', msg: `应用失败：${result.error || '未知错误'}` })
          return
        }
        console.log('[apply_skill]', {
          skillId: selectedSkillId,
          path: 'deckRender',
          llmCalls: result.llmCalls,
          imageCalls: result.imageCalls,
          tokenCost: result.tokenCost,
        })
        setApplyStatus({ type: 'success', msg: '模板已应用 · 不消耗 token' })
        onApplied(selectedSkillId, result.outputPath)
        setTimeout(() => onClose(), 800)
        return
      }

      // Legacy path: ContentPackage + pptxRenderWithSkill
      setApplyStatus({ type: 'applying', msg: '正在重新渲染... · 不消耗 token' })
      const result = await window.electronAPI.pptxRenderWithSkill({
        workspacePath,
        contentPackageId: contentPackageId!,
        skillId: selectedSkillId,
      })
      if (!result.success || !result.outputPath) {
        setApplyStatus({ type: 'error', msg: `应用失败：${result.error || '未知错误'}` })
        return
      }
      console.log('[apply_skill]', {
        skillId: selectedSkillId,
        path: 'legacy_pptxRenderWithSkill',
        llmCalls: 0,
        imageCalls: 0,
        tokenCost: 0,
      })
      setApplyStatus({ type: 'success', msg: '模板已应用 · 不消耗 token' })
      onApplied(selectedSkillId, result.outputPath)
      setTimeout(() => onClose(), 800)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '应用模板失败'
      setApplyStatus({ type: 'error', msg: `应用失败：${msg}` })
    } finally {
      setApplying(false)
    }
  }

  return (
    <Overlay onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <Drawer onClick={(e) => e.stopPropagation()}>
        <DrawerHeader>
          <DrawerTitle>替换 PPT 模板</DrawerTitle>
          <CloseBtn onClick={onClose}>✕</CloseBtn>
        </DrawerHeader>

        <DrawerBody>
          <TemplateList>
            {skills.length === 0
              ? <EmptyMsg>暂无可用模板</EmptyMsg>
              : skills.map(skill => (
                <SkillCard
                  key={skill.id}
                  $active={selectedSkillId === skill.id}
                  onClick={() => !applying && setSelectedSkillId(skill.id)}
                >
                  <TemplatePreview skill={skill} />
                  <SkillInfo>
                    <SkillName>
                      {skill.name}
                      <SourceBadge $source={skill.source}>{formatSourceLabel(skill.source)}</SourceBadge>
                      {skill.id === activeSkillId && <ActiveBadge>当前模板</ActiveBadge>}
                    </SkillName>
                    {skill.description && <SkillDesc>{skill.description}</SkillDesc>}
                    {formatTemplateMeta(skill) && <SkillMeta>{formatTemplateMeta(skill)}</SkillMeta>}
                  </SkillInfo>
                </SkillCard>
              ))
            }
          </TemplateList>
          {selectedSkill && (
            <PreviewPanel>
              <PreviewPanelTitle>{selectedSkill.name}</PreviewPanelTitle>
              <TemplatePreview skill={selectedSkill} large />
              <PreviewPanelDesc>
                来源：{formatSourceLabel(selectedSkill.source)}模板
                {formatTemplateMeta(selectedSkill) ? ` · ${formatTemplateMeta(selectedSkill)}` : ''}
                <br />
                当前预览根据模板主题、尺寸和布局能力生成；应用模板会使用当前 DeckDocument 重新渲染，不调用 LLM。
              </PreviewPanelDesc>
            </PreviewPanel>
          )}
        </DrawerBody>

        <DrawerFooter>
          <ApplyBtn
            $disabled={!canApply}
            disabled={!canApply}
            onClick={handleApply}
          >
            {applying ? '应用模板中…' : '应用并保存为新 PPT'}
          </ApplyBtn>
          {applyStatus && (
            <StatusLine $type={applyStatus.type}>{applyStatus.msg}</StatusLine>
          )}
          {!applyStatus && (
            <StatusLine $type="applying" style={{ color: 'rgba(255,255,255,0.3)' }}>
              应用模板不消耗 Token
            </StatusLine>
          )}
        </DrawerFooter>
      </Drawer>
    </Overlay>
  )
}
