import React, { useMemo } from 'react'
import styled from 'styled-components'
import type { KnowledgeDocumentMeta, KnowledgeRetrievalMode, KnowledgeTemplateInheritanceOptions } from '../../../types/knowledge'

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const SummaryRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
`

const Summary = styled.div`
  color: #3d5b78;
  font-size: var(--font-size-xs);
  line-height: 1.4;
`

const TriggerButton = styled.button`
  min-height: 30px;
  border-radius: 8px;
  border: 1px solid #d6e0ea;
  background: #ffffff;
  color: #304255;
  font-size: var(--font-size-xs);
  padding: 0 10px;
  cursor: pointer;
  transition: background 0.15s;

  &:hover {
    background: #f4f8fc;
  }
`

const Panel = styled.div`
  border: 1px solid #dce5ef;
  border-radius: 10px;
  background: #f8fbff;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const Header = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
`

const Title = styled.div`
  color: #304255;
  font-size: var(--font-size-sm);
  font-weight: 600;
`

const Subtext = styled.div`
  color: #627385;
  font-size: var(--font-size-xs);
  line-height: 1.5;
`

const Tools = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`

const ActionButton = styled.button`
  min-height: 28px;
  border-radius: 6px;
  border: 1px solid #d6e0ea;
  background: #ffffff;
  color: #304255;
  font-size: var(--font-size-xs);
  padding: 0 8px;
  cursor: pointer;
  transition: background 0.15s;

  &:hover {
    background: #f4f8fc;
  }
`

const SearchInput = styled.input`
  flex: 1;
  min-width: 220px;
  height: 34px;
  border-radius: 8px;
  border: 1px solid #d6e0ea;
  background: #ffffff;
  color: #304255;
  padding: 0 10px;
  font-size: var(--font-size-xs);
  outline: none;

  &:focus {
    border-color: #4ea1ff;
  }
`

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid #dce5ef;
  border-radius: 8px;
  background: #ffffff;
  padding: 8px;
`

const SectionTitle = styled.div`
  color: #304255;
  font-size: var(--font-size-xs);
  font-weight: 600;
`

const OptionRow = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
`

const OptionButton = styled.button<{ $active?: boolean }>`
  min-height: 30px;
  border-radius: 8px;
  border: 1px solid ${p => p.$active ? '#7aa8dc' : '#d6e0ea'};
  background: ${p => p.$active ? '#eaf3ff' : '#ffffff'};
  color: ${p => p.$active ? '#1e5a92' : '#304255'};
  font-size: var(--font-size-xs);
  padding: 0 10px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;

  &:hover {
    background: ${p => p.$active ? '#e0edff' : '#f4f8fc'};
  }
`

const HintRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`

const HintTag = styled.span<{ $accent?: boolean; $target?: boolean }>`
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid ${p => p.$target ? '#ebc287' : p.$accent ? '#9bbcf7' : '#d6e0ea'};
  background: ${p => p.$target ? '#fff5e8' : p.$accent ? '#eef4ff' : '#f8fbff'};
  color: ${p => p.$target ? '#9a5a11' : p.$accent ? '#254f9b' : '#627385'};
  font-size: var(--font-size-xs);
  font-weight: 600;
`

const Empty = styled.div`
  color: #627385;
  font-size: var(--font-size-xs);
  line-height: 1.6;
  border: 1px dashed #d6e0ea;
  border-radius: 8px;
  background: #ffffff;
  padding: 12px;
`

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 240px;
  overflow-x: hidden;
  overflow-y: scroll;
  scrollbar-gutter: stable both-edges;
  scrollbar-width: thin;
  scrollbar-color: rgba(110, 135, 164, 0.45) rgba(148, 167, 190, 0.12);

  &:focus {
    outline: none;
    box-shadow: inset 0 0 0 1px rgba(74, 140, 214, 0.18);
  }
`

const Item = styled.div<{ $template?: boolean; $reference?: boolean; $target?: boolean }>`
  border: 1px solid ${p => p.$target ? '#ebc287' : p.$template ? '#9bbcf7' : p.$reference ? '#c9d9f6' : '#dce5ef'};
  border-radius: 8px;
  background: ${p => p.$target ? '#fffaf2' : p.$template ? '#eef4ff' : p.$reference ? '#f4f8ff' : '#ffffff'};
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: border-color 0.15s;
`

const ItemTop = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
`

const ItemMain = styled.div`
  min-width: 0;
`

const ItemTitle = styled.div`
  color: #304255;
  font-size: var(--font-size-sm);
  font-weight: 600;
  line-height: 1.4;
`

const ItemMeta = styled.div`
  color: #627385;
  font-size: var(--font-size-xs);
  line-height: 1.4;
  margin-top: 2px;
`

const ItemPreview = styled.div`
  color: #4f647a;
  font-size: var(--font-size-xs);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
`

const Controls = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
`

const Toggle = styled.label<{ $disabled?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: ${p => p.$disabled ? '#9aa8b6' : '#304255'};
  font-size: var(--font-size-xs);
  cursor: ${p => p.$disabled ? 'not-allowed' : 'pointer'};
`

function matchKnowledgeDocument(item: KnowledgeDocumentMeta, query: string): boolean {
  const needle = String(query || '').trim().toLowerCase()
  if (!needle) return true
  const haystack = `${item.title}\n${item.originalName}\n${item.previewText}`.toLowerCase()
  return haystack.includes(needle)
}

export interface KnowledgeTaskSelectorProps {
  documents: KnowledgeDocumentMeta[]
  open: boolean
  query: string
  targetDocumentIds?: string[]
  allowedRetrievalModes?: KnowledgeRetrievalMode[]
  templateDocumentId: string | null
  referenceDocumentIds: string[]
  retrievalMode: KnowledgeRetrievalMode
  autoRetrievalLimit: number
  templateInheritance: KnowledgeTemplateInheritanceOptions
  summaryTargetSelected?: (count: number) => string
  summaryTargetEmpty?: string
  summaryTemplatePrefix: string
  summaryTemplateEmpty: string
  summaryReferenceSelected: (count: number) => string
  summaryReferenceEmpty: string
  triggerOpenLabel: string
  triggerCloseLabel: string
  title: string
  subtext: string
  searchPlaceholder?: string
  noDocumentsText: string
  noMatchesText: string
  targetChipLabel?: string
  templateChipLabel?: string
  referenceChipLabel?: string
  targetToggleLabel?: string
  templateToggleLabel?: string
  referenceToggleLabel?: string
  resetLabel?: string
  clearLabel?: string
  excludeDocumentIds?: string[]
  disableTemplateDocumentIds?: string[]
  disableReferenceDocumentIds?: string[]
  onToggleOpen: () => void
  onQueryChange: (value: string) => void
  onTargetToggle?: (documentId: string) => void
  onTemplateChange: (documentId: string | null) => void
  onReferenceToggle: (documentId: string) => void
  onRetrievalModeChange: (mode: KnowledgeRetrievalMode) => void
  onAutoRetrievalLimitChange: (limit: number) => void
  onTemplateInheritanceChange: (value: KnowledgeTemplateInheritanceOptions) => void
  onResetDefaults?: () => void
  onClearSelection?: () => void
}

const KnowledgeTaskSelector: React.FC<KnowledgeTaskSelectorProps> = ({
  documents,
  open,
  query,
  targetDocumentIds,
  allowedRetrievalModes,
  templateDocumentId,
  referenceDocumentIds,
  retrievalMode,
  autoRetrievalLimit,
  templateInheritance,
  summaryTargetSelected,
  summaryTargetEmpty,
  summaryTemplatePrefix,
  summaryTemplateEmpty,
  summaryReferenceSelected,
  summaryReferenceEmpty,
  triggerOpenLabel,
  triggerCloseLabel,
  title,
  subtext,
  searchPlaceholder = '搜索知识库标题、原文件名或摘要',
  noDocumentsText,
  noMatchesText,
  targetChipLabel = '批量目标',
  templateChipLabel = '模板',
  referenceChipLabel = '参考资料',
  targetToggleLabel = '纳入本次任务目标',
  templateToggleLabel = '作为本次任务模板',
  referenceToggleLabel = '作为本次任务参考资料',
  resetLabel = '恢复全局默认',
  clearLabel = '清空当前任务',
  excludeDocumentIds,
  disableTemplateDocumentIds,
  disableReferenceDocumentIds,
  onToggleOpen,
  onQueryChange,
  onTargetToggle,
  onTemplateChange,
  onReferenceToggle,
  onRetrievalModeChange,
  onAutoRetrievalLimitChange,
  onTemplateInheritanceChange,
  onResetDefaults,
  onClearSelection,
}) => {
  const hasTargetSelection = Boolean(onTargetToggle)
  const excludedSet = useMemo(() => new Set((excludeDocumentIds || []).map((item) => String(item || '').trim()).filter(Boolean)), [excludeDocumentIds])
  const templateDisabledSet = useMemo(() => new Set((disableTemplateDocumentIds || []).map((item) => String(item || '').trim()).filter(Boolean)), [disableTemplateDocumentIds])
  const referenceDisabledSet = useMemo(() => new Set((disableReferenceDocumentIds || []).map((item) => String(item || '').trim()).filter(Boolean)), [disableReferenceDocumentIds])
  const availableDocuments = useMemo(
    () => documents.filter((item) => !excludedSet.has(item.id)),
    [documents, excludedSet],
  )
  const filteredDocuments = useMemo(
    () => availableDocuments.filter((item) => matchKnowledgeDocument(item, query)),
    [availableDocuments, query],
  )
  const selectedTemplate = useMemo(
    () => documents.find((item) => item.id === templateDocumentId) || null,
    [documents, templateDocumentId],
  )
  const effectiveTargetDocumentIds = useMemo(
    () => Array.from(new Set((targetDocumentIds || []).filter((item) => item && !excludedSet.has(item)))),
    [excludedSet, targetDocumentIds],
  )
  const effectiveReferenceDocumentIds = useMemo(
    () => Array.from(new Set(referenceDocumentIds.filter((item) => item && item !== templateDocumentId && !excludedSet.has(item)))),
    [excludedSet, referenceDocumentIds, templateDocumentId],
  )
  const retrievalModeOptions = useMemo(() => {
    const modes = (allowedRetrievalModes && allowedRetrievalModes.length > 0)
      ? allowedRetrievalModes
      : ['selected-only', 'selected-first', 'auto']
    return Array.from(new Set(modes))
  }, [allowedRetrievalModes])
  const retrievalModeLabel = retrievalMode === 'selected-only'
    ? '仅使用已选资料'
    : retrievalMode === 'selected-first'
      ? '已选资料优先，允许自动补充'
      : '完全自动检索'
  const summaryParts = [
    hasTargetSelection
      ? (effectiveTargetDocumentIds.length > 0
        ? summaryTargetSelected?.(effectiveTargetDocumentIds.length) || `批量目标 ${effectiveTargetDocumentIds.length} 份`
        : (summaryTargetEmpty || ''))
      : '',
    selectedTemplate ? `${summaryTemplatePrefix}${selectedTemplate.title}` : summaryTemplateEmpty,
    effectiveReferenceDocumentIds.length > 0
      ? summaryReferenceSelected(effectiveReferenceDocumentIds.length)
      : summaryReferenceEmpty,
    ` · 模式：${retrievalModeLabel}`,
  ].filter(Boolean)

  return (
    <Wrap>
      <SummaryRow>
        <Summary>{summaryParts.join('')}</Summary>
        <TriggerButton onClick={onToggleOpen}>
          {open ? triggerCloseLabel : triggerOpenLabel}
        </TriggerButton>
      </SummaryRow>

      {open && (
        <Panel>
          <Header>
            <div>
              <Title>{title}</Title>
              <Subtext>{subtext}</Subtext>
            </div>
            <Tools>
              {onResetDefaults ? <ActionButton onClick={onResetDefaults}>{resetLabel}</ActionButton> : null}
              {onClearSelection ? <ActionButton onClick={onClearSelection}>{clearLabel}</ActionButton> : null}
            </Tools>
          </Header>

          <SearchInput
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={searchPlaceholder}
          />

          <Section>
            <SectionTitle>本次任务的资料使用策略</SectionTitle>
            <OptionRow>
              {retrievalModeOptions.includes('selected-only') ? (
                <OptionButton
                  type="button"
                  $active={retrievalMode === 'selected-only'}
                  onClick={() => onRetrievalModeChange('selected-only')}
                >
                  仅使用已选资料
                </OptionButton>
              ) : null}
              {retrievalModeOptions.includes('selected-first') ? (
                <OptionButton
                  type="button"
                  $active={retrievalMode === 'selected-first'}
                  onClick={() => onRetrievalModeChange('selected-first')}
                >
                  已选资料优先，允许自动补充
                </OptionButton>
              ) : null}
              {retrievalModeOptions.includes('auto') ? (
                <OptionButton
                  type="button"
                  $active={retrievalMode === 'auto'}
                  onClick={() => onRetrievalModeChange('auto')}
                >
                  完全自动检索
                </OptionButton>
              ) : null}
            </OptionRow>
            <HintRow>
              <HintTag>{retrievalModeLabel}</HintTag>
            </HintRow>
          </Section>

          <HintRow>
            {hasTargetSelection
              ? (effectiveTargetDocumentIds.length > 0
                ? <HintTag $target>{targetChipLabel} {effectiveTargetDocumentIds.length} 份</HintTag>
                : <HintTag $target>当前未选择{targetChipLabel}</HintTag>)
              : null}
            {selectedTemplate ? <HintTag $accent>{templateChipLabel}：{selectedTemplate.title}</HintTag> : <HintTag>当前未指定{templateChipLabel}</HintTag>}
            {effectiveReferenceDocumentIds.length > 0 ? <HintTag>{referenceChipLabel} {effectiveReferenceDocumentIds.length} 份</HintTag> : <HintTag>当前未选择{referenceChipLabel}</HintTag>}
          </HintRow>

          {!filteredDocuments.length ? (
            <Empty>{availableDocuments.length ? noMatchesText : noDocumentsText}</Empty>
          ) : (
            <List tabIndex={0} aria-label="任务知识资料列表，可滚动浏览">
              {filteredDocuments.map((document) => {
                const isTarget = effectiveTargetDocumentIds.includes(document.id)
                const isTemplate = templateDocumentId === document.id
                const isReference = effectiveReferenceDocumentIds.includes(document.id)
                const templateDisabled = templateDisabledSet.has(document.id)
                const referenceDisabled = isTemplate || referenceDisabledSet.has(document.id)
                const preview = String(document.previewText || '').trim() || document.originalName
                return (
                  <Item key={document.id} $template={isTemplate} $reference={isReference} $target={isTarget}>
                    <ItemTop>
                      <ItemMain>
                        <ItemTitle>{document.title}</ItemTitle>
                        <ItemMeta>{document.sourceType.toUpperCase()} · 版本 {document.versionCount} · {document.originalName}</ItemMeta>
                      </ItemMain>
                      <HintRow>
                        {isTarget ? <HintTag $target>{targetChipLabel}</HintTag> : null}
                        {isTemplate ? <HintTag $accent>{templateChipLabel}</HintTag> : null}
                        {isReference ? <HintTag>{referenceChipLabel}</HintTag> : null}
                      </HintRow>
                    </ItemTop>
                    <ItemPreview>{preview}</ItemPreview>
                    <Controls>
                      {hasTargetSelection ? (
                        <Toggle>
                          <input
                            type="checkbox"
                            checked={isTarget}
                            onChange={() => onTargetToggle?.(document.id)}
                          />
                          {targetToggleLabel}
                        </Toggle>
                      ) : null}
                      <Toggle $disabled={referenceDisabled}>
                        <input
                          type="checkbox"
                          checked={isReference}
                          disabled={referenceDisabled}
                          onChange={() => onReferenceToggle(document.id)}
                        />
                        {referenceToggleLabel}
                      </Toggle>
                      <Toggle $disabled={templateDisabled}>
                        <input
                          type="radio"
                          name={title}
                          checked={isTemplate}
                          disabled={templateDisabled}
                          onChange={() => onTemplateChange(document.id)}
                        />
                        {templateToggleLabel}
                      </Toggle>
                      {isTemplate ? <ActionButton onClick={() => onTemplateChange(null)}>取消模板</ActionButton> : null}
                    </Controls>
                  </Item>
                )
              })}
            </List>
          )}
        </Panel>
      )}
    </Wrap>
  )
}

export default KnowledgeTaskSelector