import React, { useState, useMemo } from 'react'
import styled from 'styled-components'
import {
  JOURNAL_EXPORT_PRESETS,
  JOURNAL_CATEGORIES,
  JOURNAL_CATEGORY_LABELS,
  getPresetsByCategory,
  type JournalExportPreset,
  type JournalExportConfig,
} from '../utils/journalExportPresets'

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1500;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
`

const Dialog = styled.div`
  background: #ffffff;
  border-radius: 16px;
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.18);
  width: min(780px, 100%);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`

const DialogHeader = styled.div`
  padding: 20px 24px 14px;
  border-bottom: 1px solid #e4ecf5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
`

const DialogTitle = styled.h2`
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: #1f3142;
`

const DialogSubtitle = styled.p`
  margin: 3px 0 0;
  font-size: var(--font-size-xs);
  color: #6b7d8e;
`

const CloseBtn = styled.button`
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #708396;
  cursor: pointer;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  &:hover { background: #eef4fb; color: #1f3142; }
`

const Body = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
`

const SectionLabel = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #8298ae;
  margin-bottom: 10px;
`

// ── Category tabs ──
const CategoryTabs = styled.div`
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
`

const CategoryTab = styled.button<{ $active: boolean }>`
  height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid ${p => p.$active ? '#0e639c' : '#d0dbe6'};
  background: ${p => p.$active ? '#0e639c' : '#ffffff'};
  color: ${p => p.$active ? '#fff' : '#4a5d6e'};
  font-size: var(--font-size-xs);
  font-weight: ${p => p.$active ? 600 : 400};
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.12s;
  &:hover { border-color: #0e639c; color: ${p => p.$active ? '#fff' : '#0e639c'}; }
`

// ── Preset cards ──
const PresetGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
`

const PresetCard = styled.button<{ $selected: boolean }>`
  border: 2px solid ${p => p.$selected ? '#0e639c' : '#dde6ef'};
  border-radius: 10px;
  background: ${p => p.$selected ? '#eaf4ff' : '#fafcff'};
  padding: 12px 12px 10px;
  cursor: pointer;
  text-align: left;
  transition: all 0.12s;
  &:hover { border-color: #0e639c; background: #eef7ff; }
`

const CardLabel = styled.div<{ $selected: boolean }>`
  font-size: 15px;
  font-weight: 700;
  color: ${p => p.$selected ? '#0e639c' : '#1f3142'};
  margin-bottom: 4px;
`

const CardDesc = styled.div`
  font-size: var(--font-size-xs);
  color: #7089a0;
  line-height: 1.5;
`

const CardExamples = styled.div`
  margin-top: 5px;
  font-size: var(--font-size-xs);
  color: #a0b0be;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

// ── Format preview strip ──
const FormatStrip = styled.div`
  background: #f5f8fb;
  border: 1px solid #dde6ef;
  border-radius: 8px;
  padding: 10px 14px;
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  font-size: var(--font-size-xs);
  color: #4a5d6e;
`

const FormatItem = styled.span`
  display: flex;
  align-items: center;
  gap: 5px;
`

const FormatValue = styled.span`
  font-weight: 600;
  color: #1f3142;
`

// ── Form fields ──
const FieldGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  @media (max-width: 600px) { grid-template-columns: 1fr; }
`

const FieldLabel = styled.label`
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: #4a5d6e;
`

const FieldInput = styled.input`
  height: 34px;
  border: 1px solid #d0dbe6;
  border-radius: 6px;
  padding: 0 10px;
  font-size: var(--font-size-sm);
  color: #1f3142;
  outline: none;
  background: #fff;
  &:focus { border-color: #0e639c; background: #f8fcff; }
`

const FieldHint = styled.div`
  font-size: var(--font-size-xs);
  color: #8298ae;
  font-weight: 400;
  margin-top: 2px;
`

// ── Header/footer preview ──
const HFPreview = styled.div`
  border: 1px solid #dde6ef;
  border-radius: 8px;
  overflow: hidden;
  font-size: var(--font-size-xs);
`

const HFRow = styled.div<{ $kind: 'header' | 'footer' }>`
  background: ${p => p.$kind === 'header' ? '#f8fbff' : '#f8fbff'};
  border-bottom: ${p => p.$kind === 'header' ? '1px solid #dde6ef' : 'none'};
  border-top: ${p => p.$kind === 'footer' ? '1px solid #dde6ef' : 'none'};
  padding: 6px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #4a5d6e;
  gap: 8px;
`

const HFLabel = styled.span`
  font-size: var(--font-size-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #a0b4c2;
  width: 36px;
  flex-shrink: 0;
`

const HFContent = styled.span`
  flex: 1;
  font-family: 'Times New Roman', serif;
  font-size: var(--font-size-xs);
  color: #243040;
  display: flex;
  align-items: center;
  gap: 4px;
`

const HFLeft = styled.span`flex: 1;`
const HFRight = styled.span`color: #708396;`

const HFBody = styled.div`
  padding: 8px 12px;
  color: #aab6c2;
  font-size: var(--font-size-xs);
  font-style: italic;
  text-align: center;
`

// ── Footer ──
const DialogFooter = styled.div`
  padding: 14px 24px;
  border-top: 1px solid #e4ecf5;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  flex-shrink: 0;
  background: #fafcff;
`

const CancelBtn = styled.button`
  height: 34px;
  padding: 0 16px;
  border: 1px solid #d0dbe6;
  border-radius: 6px;
  background: #ffffff;
  color: #4a5d6e;
  font-size: var(--font-size-sm);
  cursor: pointer;
  &:hover { background: #f0f4f8; }
`

const ConfirmBtn = styled.button<{ $disabled?: boolean }>`
  height: 34px;
  padding: 0 20px;
  border: 1px solid ${p => p.$disabled ? '#b0c8de' : '#1558d4'};
  border-radius: 6px;
  background: ${p => p.$disabled ? '#b0c8de' : '#1a5cc8'};
  color: #fff;
  font-size: var(--font-size-sm);
  font-weight: 600;
  cursor: ${p => p.$disabled ? 'not-allowed' : 'pointer'};
  &:hover:not([disabled]) { background: #154faa; }
`

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatLineSpacing(multiple: number): string {
  if (multiple === 1.0) return '单倍'
  if (multiple === 1.5) return '1.5 倍'
  if (multiple === 2.0) return '双倍'
  return `${multiple} 倍`
}

function formatPageSize(preset: JournalExportPreset): string {
  const { widthMm, heightMm } = preset.pageSize
  if (Math.abs(widthMm - 210) < 1 && Math.abs(heightMm - 297) < 1) return 'A4'
  if (Math.abs(widthMm - 215.9) < 1 && Math.abs(heightMm - 279.4) < 1) return 'Letter'
  return `${Math.round(widthMm)}×${Math.round(heightMm)}mm`
}

function buildHeaderPreview(preset: JournalExportPreset, runningTitle: string): React.ReactNode {
  const title = runningTitle.trim() || preset.runningTitlePlaceholder
  const { headerLayout } = preset.headerFooter

  if (headerLayout === 'none') return <HFContent><HFLeft style={{ color: '#b0bec8', fontStyle: 'italic' }}>（无页眉）</HFLeft></HFContent>
  if (headerLayout === 'center-title') return <HFContent style={{ justifyContent: 'center' }}><HFLeft style={{ textAlign: 'center' }}>{title}</HFLeft></HFContent>
  // left-title-right-pagenum
  return (
    <HFContent>
      <HFLeft>{title}</HFLeft>
      <HFRight>1</HFRight>
    </HFContent>
  )
}

function buildFooterPreview(preset: JournalExportPreset): React.ReactNode {
  const { footerLayout } = preset.headerFooter
  if (footerLayout === 'none') return <HFContent><HFLeft style={{ color: '#b0bec8', fontStyle: 'italic' }}>（无页脚）</HFLeft></HFContent>
  if (footerLayout === 'center-pagenum') return <HFContent style={{ justifyContent: 'center' }}>1</HFContent>
  return <HFContent><HFLeft /><HFRight>1</HFRight></HFContent>
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ExportJournalDialogProps {
  onConfirm: (config: JournalExportConfig) => void
  onCancel: () => void
}

export default function ExportJournalDialog({ onConfirm, onCancel }: ExportJournalDialogProps) {
  const [activeCategory, setActiveCategory] = useState<JournalExportPreset['category']>(JOURNAL_CATEGORIES[0])
  const [selectedId, setSelectedId] = useState<string>(JOURNAL_EXPORT_PRESETS[0].id)
  const [runningTitle, setRunningTitle] = useState('')
  const [authorLine, setAuthorLine] = useState('')

  const selectedPreset = useMemo(
    () => JOURNAL_EXPORT_PRESETS.find((p) => p.id === selectedId) ?? JOURNAL_EXPORT_PRESETS[0],
    [selectedId],
  )

  const visiblePresets = useMemo(() => getPresetsByCategory(activeCategory), [activeCategory])

  const handleConfirm = () => {
    onConfirm({ preset: selectedPreset, runningTitle: runningTitle.trim(), authorLine: authorLine.trim() })
  }

  const handleCardClick = (preset: JournalExportPreset) => {
    setSelectedId(preset.id)
    // Switch category tab to match selected preset
    setActiveCategory(preset.category)
  }

  return (
    <Backdrop onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <Dialog>
        <DialogHeader>
          <div>
            <DialogTitle>📄 期刊格式导出</DialogTitle>
            <DialogSubtitle>选择目标期刊，生成符合投稿要求的 DOCX（含页眉页脚）</DialogSubtitle>
          </div>
          <CloseBtn onClick={onCancel}>×</CloseBtn>
        </DialogHeader>

        <Body>
          {/* ── Step 1: Category + Preset ── */}
          <div>
            <SectionLabel>① 选择期刊格式</SectionLabel>
            <CategoryTabs>
              {JOURNAL_CATEGORIES.map((cat) => (
                <CategoryTab
                  key={cat}
                  $active={activeCategory === cat}
                  onClick={() => setActiveCategory(cat)}
                >
                  {JOURNAL_CATEGORY_LABELS[cat]}
                </CategoryTab>
              ))}
            </CategoryTabs>
            <div style={{ marginTop: 12 }}>
              <PresetGrid>
                {visiblePresets.map((preset) => (
                  <PresetCard
                    key={preset.id}
                    $selected={selectedId === preset.id}
                    onClick={() => handleCardClick(preset)}
                    type="button"
                  >
                    <CardLabel $selected={selectedId === preset.id}>{preset.label}</CardLabel>
                    <CardDesc>{preset.description}</CardDesc>
                    {preset.exampleJournals && (
                      <CardExamples>{preset.exampleJournals.join(' · ')}</CardExamples>
                    )}
                  </PresetCard>
                ))}
              </PresetGrid>
            </div>
          </div>

          {/* ── Format strip ── */}
          <FormatStrip>
            <FormatItem>字体 <FormatValue>{selectedPreset.fontFamily.split(',')[0].trim()} {selectedPreset.fontSizePt}pt</FormatValue></FormatItem>
            <FormatItem>行距 <FormatValue>{formatLineSpacing(selectedPreset.lineSpacingMultiple)}</FormatValue></FormatItem>
            <FormatItem>纸张 <FormatValue>{formatPageSize(selectedPreset)}</FormatValue></FormatItem>
            <FormatItem>页边距 <FormatValue>{selectedPreset.margins.top}mm（四边）</FormatValue></FormatItem>
            <FormatItem>
              页眉 <FormatValue>
                {selectedPreset.headerFooter.headerLayout === 'none' ? '无' :
                 selectedPreset.headerFooter.headerLayout === 'center-title' ? '居中标题' : '标题+页码'}
              </FormatValue>
            </FormatItem>
          </FormatStrip>

          {/* ── Step 2: Running title / author ── */}
          <div>
            <SectionLabel>② 填写页眉信息</SectionLabel>
            <FieldGrid>
              <div>
                <FieldLabel>
                  {selectedPreset.runningTitleLabel}
                  <FieldInput
                    value={runningTitle}
                    onChange={(e) => {
                      const max = selectedPreset.runningTitleMaxChars ?? 200
                      if (e.target.value.length <= max) setRunningTitle(e.target.value)
                    }}
                    placeholder={selectedPreset.runningTitlePlaceholder}
                  />
                  {selectedPreset.runningTitleMaxChars && (
                    <FieldHint>
                      {runningTitle.length}/{selectedPreset.runningTitleMaxChars} 字符
                      {selectedPreset.headerFooter.headerLayout === 'none' ? '（此格式无页眉，可留空）' : ''}
                    </FieldHint>
                  )}
                </FieldLabel>
              </div>
              <div>
                <FieldLabel>
                  {selectedPreset.authorLineLabel}（可选）
                  <FieldInput
                    value={authorLine}
                    onChange={(e) => setAuthorLine(e.target.value)}
                    placeholder={selectedPreset.authorLinePlaceholder}
                  />
                  <FieldHint>仅用于备注，不影响页眉生成</FieldHint>
                </FieldLabel>
              </div>
            </FieldGrid>
          </div>

          {/* ── Preview ── */}
          <div>
            <SectionLabel>③ 页眉/页脚预览</SectionLabel>
            <HFPreview>
              <HFRow $kind="header">
                <HFLabel>页眉</HFLabel>
                {buildHeaderPreview(selectedPreset, runningTitle)}
              </HFRow>
              <HFBody>…文章正文…</HFBody>
              <HFRow $kind="footer">
                <HFLabel>页脚</HFLabel>
                {buildFooterPreview(selectedPreset)}
              </HFRow>
            </HFPreview>
          </div>
        </Body>

        <DialogFooter>
          <CancelBtn onClick={onCancel}>取消</CancelBtn>
          <ConfirmBtn
            onClick={handleConfirm}
            $disabled={selectedPreset.headerFooter.headerLayout !== 'none' && !runningTitle.trim()}
            disabled={selectedPreset.headerFooter.headerLayout !== 'none' && !runningTitle.trim()}
          >
            导出为 .docx
          </ConfirmBtn>
        </DialogFooter>
      </Dialog>
    </Backdrop>
  )
}
