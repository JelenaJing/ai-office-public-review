import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import type { DocumentEditAction } from '../editor'
import type {
  DocumentDocxTemplateMode,
  DocumentHeaderFooterContract,
  DocumentHeaderFooterVariant,
  DocumentSchema,
  DocumentSectionContract,
  DocumentSectionType,
} from '../schema'
import {
  FORMAL_TEMPLATE_DEBUG_SNAPSHOT_METADATA_KEY,
  type FormalTemplateDebugSnapshot,
  type FormalTemplateExecutionMode,
  type FormalTemplateFallbackAdapter,
  type FormalTemplateFallbackReasonCode,
  type FormalTemplateRouteStrategy,
  type FormalTemplateRoutingPlan,
  type FormalTemplateTemplateKind,
} from '../../types/templateGeneration'

export interface DocumentPreviewHeaderFooterBindingSummary {
  variant: DocumentHeaderFooterVariant
  status: 'explicit' | 'inherit-or-none'
  relationshipId?: string
  entryPath?: string
}

export interface DocumentPreviewSectionPageNumberSummary {
  start?: number
  format?: string
  chapterSeparator?: string
  chapterStyle?: number
  restart: boolean
}

export interface DocumentPreviewSectionContractSummary {
  id: string
  scope: DocumentSectionContract['scope']
  boundaryBlockId?: string
  boundaryLabel: string
  breakType?: DocumentSectionType
  titlePage: boolean
  columnCount?: number
  pageNumber?: DocumentPreviewSectionPageNumberSummary
  headerBindings: DocumentPreviewHeaderFooterBindingSummary[]
  footerBindings: DocumentPreviewHeaderFooterBindingSummary[]
}

export interface DocumentPreviewTemplateContractSummary {
  kind?: string
  mode?: DocumentDocxTemplateMode
  preserveShell?: boolean
  legacyFallback?: string
  shellEntryCount: number
  shellEntries: string[]
}

export interface DocumentPreviewFormalTemplateExecutionSummary {
  templateKind?: FormalTemplateTemplateKind
  defaultMode?: 'schema-first'
  defaultStrategy?: FormalTemplateRouteStrategy
  legacyFallbackAdapter?: FormalTemplateFallbackAdapter
  actualMode?: FormalTemplateExecutionMode['mode']
  actualStrategy?: FormalTemplateRouteStrategy
  fallbackAdapter?: FormalTemplateFallbackAdapter
  fallbackReasonCode?: FormalTemplateFallbackReasonCode
  fallbackReason?: string
  usedFallback: boolean
}

export interface DocumentPreviewDiagnosticsModel {
  template?: DocumentPreviewTemplateContractSummary
  sections: DocumentPreviewSectionContractSummary[]
  formalTemplate?: DocumentPreviewFormalTemplateExecutionSummary
}

export interface DocumentPreviewBlockModel {
  id: string
  type: string
  text: string
}

export interface DocumentPreviewModel {
  blocks: DocumentPreviewBlockModel[]
  diagnostics: DocumentPreviewDiagnosticsModel | null
}

function normalizeOptionalString(value: unknown): string | undefined {
  const normalized = String(value ?? '').trim()
  return normalized || undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function buildHeaderFooterBindings(refs: DocumentHeaderFooterContract[] | undefined): DocumentPreviewHeaderFooterBindingSummary[] {
  const variants: DocumentHeaderFooterVariant[] = ['default', 'first', 'even']
  return variants.map((variant) => {
    const ref = (refs || []).find((item) => item.variant === variant)
    return {
      variant,
      status: ref ? 'explicit' : 'inherit-or-none',
      relationshipId: normalizeOptionalString(ref?.relationshipId),
      entryPath: normalizeOptionalString(ref?.entryPath),
    }
  })
}

function resolveBoundaryLabel(document: DocumentSchema, contract: DocumentSectionContract): string {
  if (contract.scope === 'document-end') return '文档末尾 section shell'
  const block = document.blocks.find((item) => item.id === contract.boundaryBlockId)
  if (!block) return contract.boundaryBlockId || '未定位边界块'
  return `${block.id} · ${String(block.text || block.type || '').trim() || block.type}`
}

function buildPageNumberSummary(contract: DocumentSectionContract): DocumentPreviewSectionPageNumberSummary | undefined {
  if (!contract.pageNumber) return undefined
  return {
    start: contract.pageNumber.start,
    format: normalizeOptionalString(contract.pageNumber.format),
    chapterSeparator: normalizeOptionalString(contract.pageNumber.chapterSeparator),
    chapterStyle: contract.pageNumber.chapterStyle,
    restart: typeof contract.pageNumber.start === 'number',
  }
}

function readFormalTemplateDebugSnapshot(document: DocumentSchema): FormalTemplateDebugSnapshot | undefined {
  const candidate = document.document.metadata?.[FORMAL_TEMPLATE_DEBUG_SNAPSHOT_METADATA_KEY]
  if (!isRecord(candidate)) return undefined
  const snapshot = candidate as FormalTemplateDebugSnapshot
  if (!snapshot.routingPlan && !snapshot.executionMode) return undefined
  return snapshot
}

function buildFormalTemplateExecutionSummary(
  routingPlan: FormalTemplateRoutingPlan | undefined,
  executionMode: FormalTemplateExecutionMode | undefined,
): DocumentPreviewFormalTemplateExecutionSummary | undefined {
  if (!routingPlan && !executionMode) return undefined
  return {
    templateKind: executionMode?.templateKind || routingPlan?.templateKind,
    defaultMode: routingPlan?.defaultExecution.mode,
    defaultStrategy: routingPlan?.defaultExecution.strategy,
    legacyFallbackAdapter: routingPlan?.legacyFallbackAdapter,
    actualMode: executionMode?.mode,
    actualStrategy: executionMode?.mode === 'schema-first' ? executionMode.strategy : undefined,
    fallbackAdapter: executionMode?.mode === 'legacy-fallback' ? executionMode.fallbackAdapter : undefined,
    fallbackReasonCode: executionMode?.mode === 'legacy-fallback' ? executionMode.reasonCode : undefined,
    fallbackReason: executionMode?.mode === 'legacy-fallback' ? normalizeOptionalString(executionMode.reason) : undefined,
    usedFallback: executionMode?.mode === 'legacy-fallback',
  }
}

export function buildDocumentPreviewDiagnosticsModel(document: DocumentSchema): DocumentPreviewDiagnosticsModel | null {
  const sectionContracts = Array.isArray(document.templateHints?.sectionContracts)
    ? document.templateHints.sectionContracts || []
    : []
  const templateContract = document.templateHints?.templateContract
  const debugSnapshot = readFormalTemplateDebugSnapshot(document)
  const templateMode = templateContract?.mode || document.templateHints?.docxTemplateMode

  const template = templateContract || templateMode
    ? {
        kind: normalizeOptionalString(templateContract?.kind),
        mode: templateMode,
        preserveShell: Boolean(templateContract?.preserveShell),
        legacyFallback: normalizeOptionalString(templateContract?.legacyFallback),
        shellEntryCount: Array.isArray(templateContract?.shellEntries) ? templateContract.shellEntries.length : 0,
        shellEntries: Array.isArray(templateContract?.shellEntries) ? templateContract.shellEntries.map((item) => String(item)) : [],
      }
    : undefined

  const sections = sectionContracts.map((contract) => ({
    id: contract.id,
    scope: contract.scope,
    boundaryBlockId: contract.boundaryBlockId,
    boundaryLabel: resolveBoundaryLabel(document, contract),
    breakType: contract.sectionType,
    titlePage: Boolean(contract.titlePage),
    columnCount: undefined,
    pageNumber: buildPageNumberSummary(contract),
    headerBindings: buildHeaderFooterBindings(contract.headerRefs),
    footerBindings: buildHeaderFooterBindings(contract.footerRefs),
  }))

  const formalTemplate = buildFormalTemplateExecutionSummary(debugSnapshot?.routingPlan, debugSnapshot?.executionMode)
  if (!template && sections.length === 0 && !formalTemplate) return null
  return { template, sections, formalTemplate }
}

export function buildDocumentPreviewModel(document: DocumentSchema): DocumentPreviewModel {
  return {
    blocks: document.blocks.map((block) => ({
      id: block.id,
      type: block.type,
      text: String(block.type === 'image' ? (block.value?.caption || block.text || block.resourceRef) : block.text || '').trim(),
    })),
    diagnostics: buildDocumentPreviewDiagnosticsModel(document),
  }
}

function ActionButton(props: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      style={{ border: '1px solid #d5e2ef', background: '#fff', borderRadius: 8, padding: '4px 8px', fontSize: 14, cursor: 'pointer' }}
    >
      {props.label}
    </button>
  )
}

export function DocumentPreviewRenderer(props: {
  document: DocumentSchema
  model?: DocumentPreviewModel
  editErrorMessage?: string | null
  onApplyEditAction?: (action: DocumentEditAction) => Promise<boolean> | boolean
  testId?: string
}) {
  const model = useMemo(() => props.model || buildDocumentPreviewModel(props.document), [props.document, props.model])

  const pageStyle: CSSProperties = {
    width: 'min(860px, 100%)',
    margin: '0 auto',
    background: '#fff',
    border: '1px solid #d9e4ee',
    boxShadow: '0 12px 28px rgba(30,58,95,0.08)',
    padding: 32,
    borderRadius: 8,
  }

  const runAction = async (action: DocumentEditAction) => {
    if (!props.onApplyEditAction) return
    await props.onApplyEditAction(action)
  }

  return (
    <div data-testid={props.testId} style={{ width: '100%', minHeight: '100%', overflow: 'auto', padding: 12 }}>
      {props.editErrorMessage ? (
        <div style={{ marginBottom: 12, borderRadius: 12, border: '1px solid #efd0d0', background: '#fff7f7', color: '#944444', padding: '10px 12px', fontSize: 14 }}>
          {props.editErrorMessage}
        </div>
      ) : null}
      <div style={pageStyle}>
        {model.diagnostics ? (
          <div style={{ marginBottom: 18, display: 'grid', gap: 10 }}>
            {model.diagnostics.template ? (
              <div style={{ fontSize: 14, color: '#4c657c' }}>
                {`templateMode: ${model.diagnostics.template.mode || '未声明'}`}
              </div>
            ) : null}
            {model.diagnostics.formalTemplate?.actualMode ? (
              <div style={{ fontSize: 14, color: '#4c657c' }}>
                {`execution: ${model.diagnostics.formalTemplate.actualMode}`}
              </div>
            ) : null}
          </div>
        ) : null}
        <div style={{ display: 'grid', gap: 14 }}>
          {props.document.blocks.map((block) => {
            const commonStyle: CSSProperties = { display: 'grid', gap: 8 }
            if (block.type === 'heading') {
              const Tag = `h${Math.max(1, Math.min(block.level || 1, 6))}` as keyof JSX.IntrinsicElements
              return (
                <div key={block.id} style={commonStyle}>
                  <Tag style={{ margin: 0, color: '#1f3142' }}>{block.text}</Tag>
                  {props.onApplyEditAction ? (
                    <ActionButton label="改写" onClick={() => {
                      const value = window.prompt('输入新的标题内容', block.text || '')
                      if (value == null) return
                      void runAction({ type: 'replace_block', targetId: block.id, text: value })
                    }} />
                  ) : null}
                </div>
              )
            }
            if (block.type === 'image') {
              return (
                <div key={block.id} style={commonStyle}>
                  <div style={{ border: '1px solid #dbe5ef', borderRadius: 12, padding: 12, background: '#f8fbff' }}>
                    <img src={block.resourceRef} alt={block.value?.alt || block.text || ''} style={{ maxWidth: '100%', display: 'block', margin: '0 auto', borderRadius: 8 }} />
                    {block.value?.caption || block.text ? <div style={{ marginTop: 8, fontSize: 14, color: '#66788b', textAlign: 'center' }}>{block.value?.caption || block.text}</div> : null}
                  </div>
                  {props.onApplyEditAction ? (
                    <ActionButton label="替换图片" onClick={() => {
                      const url = window.prompt('输入新的图片路径或 URL', block.resourceRef || '')
                      if (!url) return
                      void runAction({ type: 'replace_image', targetId: block.id, resourceRef: url, caption: block.value?.caption || block.text || '' })
                    }} />
                  ) : null}
                </div>
              )
            }
            if (block.type === 'slot') {
              return (
                <div key={block.id} style={commonStyle}>
                  <div style={{ padding: '10px 12px', borderRadius: 10, background: '#eef4ff', border: '1px solid #d8e4ff' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#587191', marginBottom: 4 }}>{block.slotKey}</div>
                    <div style={{ color: '#1f3142' }}>{block.value?.text || block.text || '待补内容'}</div>
                  </div>
                  {props.onApplyEditAction ? (
                    <ActionButton label="填写" onClick={() => {
                      const value = window.prompt(`输入 ${block.slotKey} 的内容`, block.value?.text || block.text || '')
                      if (value == null) return
                      void runAction({ type: 'fill_slot', targetId: block.id, value })
                    }} />
                  ) : null}
                </div>
              )
            }
            if (block.type === 'table') {
              const headers = block.value?.headers || []
              const rows = block.value?.rows || []
              return (
                <div key={block.id} style={commonStyle}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                    {headers.length > 0 ? (
                      <thead>
                        <tr>
                          {headers.map((header, index) => <th key={index} style={{ border: '1px solid #dbe5ef', padding: 8, background: '#f5f9fc' }}>{header}</th>)}
                        </tr>
                      </thead>
                    ) : null}
                    <tbody>
                      {rows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          {(row || []).map((cell, cellIndex) => <td key={cellIndex} style={{ border: '1px solid #dbe5ef', padding: 8 }}>{String(cell ?? '')}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            }
            return (
              <div key={block.id} style={commonStyle}>
                <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8, color: '#24384b' }}>{block.text}</div>
                {props.onApplyEditAction ? (
                  <ActionButton label="改写" onClick={() => {
                    const value = window.prompt('输入新的段落内容', block.text || '')
                    if (value == null) return
                    void runAction({ type: 'replace_block', targetId: block.id, text: value })
                  }} />
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}