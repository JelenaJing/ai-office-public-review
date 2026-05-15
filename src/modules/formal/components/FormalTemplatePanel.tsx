import { useMemo, useState } from 'react'
import styled from 'styled-components'
import { useFormalTemplateSession, type FormalTemplateSessionPhase } from '../contexts/FormalTemplateSessionContext'
import { useKnowledge } from '../../../contexts/KnowledgeContext'
import { useWorkspace } from '../../../contexts/WorkspaceContext'
import { useWorkspaceMode } from '../../../contexts/WorkspaceModeContext'
import { buildDocumentPreviewDiagnosticsModel } from '../../../document/preview'
import type { FieldValue, FormalTemplateErrorCode, TemplateProfile } from '../../../types/templateGeneration'
import { joinRelativePath, toRelativeWorkspacePath } from '../../../utils/workspacePath'

const PanelShell = styled.div`
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  align-items: stretch;
  justify-content: flex-start;
  padding: 28px;
  background: linear-gradient(180deg, #f8fbff 0%, #eef4fb 100%);
  overflow: auto;
`

const PanelCard = styled.div`
  width: min(1080px, 100%);
  margin: 0 auto;
  border-radius: 18px;
  border: 1px solid #d9e3ef;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 24px 54px rgba(19, 41, 61, 0.08);
  padding: 28px;
  display: grid;
  gap: 18px;
`

const Header = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
`

const Eyebrow = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #8b4c2e;
`

const Title = styled.h2`
  margin: 0;
  font-size: 28px;
  color: #1f3142;
`

const Description = styled.p`
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  color: #5d7185;
`

const SummaryGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;

  @media (max-width: 760px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`

const SummaryCard = styled.div`
  border-radius: 14px;
  border: 1px solid #e2e9f2;
  background: #f8fbfe;
  padding: 14px;
  display: grid;
  gap: 6px;
`

const SummaryLabel = styled.div`
  font-size: var(--font-size-xs);
  color: #6b7d8f;
`

const SummaryValue = styled.div`
  font-size: 16px;
  font-weight: 700;
  color: #1f3142;
  line-height: 1.45;
  word-break: break-word;
`

const SummaryMeta = styled.div`
  font-size: var(--font-size-xs);
  color: #7d8ea1;
  word-break: break-word;
`

const StatusPill = styled.div<{ $phase: FormalTemplateSessionPhase }>`
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-xs);
  font-weight: 700;
  color: ${({ $phase }) => ($phase === 'error' ? '#a02a2a' : '#27435f')};
  background: ${({ $phase }) => ($phase === 'error' ? '#fde9e9' : '#edf4fb')};
  border: 1px solid ${({ $phase }) => ($phase === 'error' ? '#f1c5c5' : '#d5e2ef')};
`

const Section = styled.section`
  border-radius: 16px;
  border: 1px solid #e3ebf3;
  background: #fbfdff;
  padding: 18px;
  display: grid;
  gap: 14px;
`

const SectionTitle = styled.h3`
  margin: 0;
  font-size: 16px;
  color: #22374a;
`

const SectionBody = styled.div`
  display: grid;
  gap: 12px;
`

const ActionRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  flex-wrap: wrap;
`

const ButtonRow = styled.div`
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
`

const ActionButton = styled.button<{ $primary?: boolean }>`
  min-width: 132px;
  height: 40px;
  border-radius: 10px;
  border: 1px solid ${({ $primary }) => ($primary ? '#1f6fd6' : '#cfdbe7')};
  background: ${({ $primary }) => ($primary ? '#1f6fd6' : '#ffffff')};
  color: ${({ $primary }) => ($primary ? '#ffffff' : '#304255')};
  font-size: var(--font-size-sm);
  font-weight: 700;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: ${({ $primary }) => ($primary ? '#195cb1' : '#f4f8fc')};
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`

const InlineNote = styled.div`
  max-width: 520px;
  font-size: var(--font-size-xs);
  line-height: 1.65;
  color: #627589;
`

const InlineWarning = styled.div`
  border-radius: 12px;
  border: 1px solid #ead5a6;
  background: #fff9ea;
  padding: 12px 14px;
  font-size: var(--font-size-xs);
  line-height: 1.6;
  color: #765b1d;
`

const ErrorBanner = styled.div`
  border-radius: 14px;
  border: 1px solid #f0c8c8;
  background: #fff1f1;
  padding: 14px 16px;
  font-size: var(--font-size-sm);
  line-height: 1.65;
  color: #9d2f2f;
`

const DetailGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;

  @media (max-width: 820px) {
    grid-template-columns: minmax(0, 1fr);
  }
`

const DetailCard = styled.div`
  border-radius: 14px;
  border: 1px solid #e2e9f2;
  background: #ffffff;
  padding: 14px;
  display: grid;
  gap: 6px;
`

const DetailLabel = styled.div`
  font-size: var(--font-size-xs);
  color: #6b7d8f;
`

const DetailValue = styled.div`
  font-size: 14px;
  line-height: 1.6;
  color: #203245;
  word-break: break-word;
`

const EmptyState = styled.div`
  border-radius: 12px;
  border: 1px dashed #d7e1eb;
  background: #f8fbfe;
  padding: 16px;
  font-size: var(--font-size-sm);
  line-height: 1.6;
  color: #6b7d8f;
`

const ListGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;

  @media (max-width: 900px) {
    grid-template-columns: minmax(0, 1fr);
  }
`

const ListCard = styled.div`
  border-radius: 14px;
  border: 1px solid #e2e9f2;
  background: #ffffff;
  padding: 14px;
  display: grid;
  gap: 8px;
`

const ListHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`

const ListTitle = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: #203245;
`

const Tag = styled.span<{ $tone?: 'default' | 'warn' }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: var(--font-size-xs);
  font-weight: 700;
  color: ${({ $tone }) => ($tone === 'warn' ? '#8a5a00' : '#3e5468')};
  background: ${({ $tone }) => ($tone === 'warn' ? '#fff3cd' : '#eef4fb')};
  border: 1px solid ${({ $tone }) => ($tone === 'warn' ? '#ecd390' : '#d9e4ef')};
`

const ValueText = styled.div`
  font-size: var(--font-size-sm);
  line-height: 1.7;
  color: #465a6f;
  word-break: break-word;
`

const EditableInput = styled.input`
  width: 100%;
  min-height: 38px;
  border-radius: 10px;
  border: 1px solid #d4dfeb;
  background: #ffffff;
  padding: 0 12px;
  font-size: var(--font-size-sm);
  color: #203245;
`

const EditableTextarea = styled.textarea`
  width: 100%;
  min-height: 90px;
  border-radius: 10px;
  border: 1px solid #d4dfeb;
  background: #ffffff;
  padding: 10px 12px;
  font-size: var(--font-size-sm);
  line-height: 1.6;
  color: #203245;
  resize: vertical;
`

const InlineButton = styled.button<{ $active?: boolean }>`
  min-width: 88px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid ${({ $active }) => ($active ? '#1f6fd6' : '#cfdae6')};
  background: ${({ $active }) => ($active ? '#edf5ff' : '#ffffff')};
  color: ${({ $active }) => ($active ? '#1f6fd6' : '#43586d')};
  font-size: var(--font-size-xs);
  font-weight: 700;
  cursor: pointer;
`

const CandidateBlock = styled.div`
  border-radius: 14px;
  border: 1px solid #dfe8f1;
  background: #ffffff;
  padding: 16px;
  font-size: var(--font-size-sm);
  line-height: 1.8;
  color: #203245;
  white-space: pre-wrap;
`

const MetaRow = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
`

const MetaChip = styled.span<{ $tone?: 'default' | 'warn' }>`
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 8px;
  border-radius: 999px;
  background: ${({ $tone }) => ($tone === 'warn' ? '#fff3cd' : '#f2f6fa')};
  color: ${({ $tone }) => ($tone === 'warn' ? '#8a5a00' : '#5e7287')};
  border: 1px solid ${({ $tone }) => ($tone === 'warn' ? '#ecd390' : '#d9e4ef')};
  font-size: var(--font-size-xs);
  font-weight: 700;
`

const PendingRow = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
`

const Footer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
`

const MutedText = styled.div`
  font-size: var(--font-size-xs);
  line-height: 1.6;
  color: #6b7d8f;
`

const BackButton = styled.button`
  min-width: 120px;
  height: 38px;
  border-radius: 10px;
  border: 1px solid #cfdbe7;
  background: #ffffff;
  color: #304255;
  font-size: var(--font-size-sm);
  font-weight: 700;
  cursor: pointer;

  &:hover {
    background: #f4f8fc;
  }
`

const PHASE_LABELS: Record<FormalTemplateSessionPhase, string> = {
  idle: '待命',
  analyzing: '分析中',
  confirming: '待确认',
  previewing: '预演中',
  committing: '提交中',
  completed: '已完成',
  error: '错误',
}

function buildInitialFieldValues(profile: TemplateProfile): FieldValue[] {
  return profile.fields.map((field) => ({
    fieldId: field.fieldId,
    value: field.defaultText,
    userOverride: false,
    confirmed: false,
  }))
}

function buildPreviewInstruction(templateTitle: string): string {
  return `请围绕正式模板《${templateTitle}》生成候选内容，保持模板结构、正式写作语气和可编辑区域边界。`
}

function truncateText(value: string, maxLength = 160): string {
  const trimmed = value.trim()
  if (!trimmed) return '空'
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed
}

function getResponseErrorMessage(errorMessage: string | undefined, fallback: string): string {
  return errorMessage?.trim() || fallback
}

type MinimalErrorStep = 'analyze' | 'preview' | 'commit'

interface MinimalErrorCardState {
  step: MinimalErrorStep
  reason: string
  validationFailed: boolean
}

function getErrorStepLabel(step: MinimalErrorStep): string {
  if (step === 'analyze') return 'analyze'
  if (step === 'preview') return 'preview'
  return 'commit'
}

function isShellValidationError(errorCode?: FormalTemplateErrorCode): boolean {
  return errorCode === 'FT_SHELL_INTEGRITY_VIOLATED'
}

function summarizeIndices(indices: number[]): string {
  if (indices.length === 0) return '无'
  return indices.join(', ')
}

function formatRoutingSummary(profile: TemplateProfile | null): string {
  if (!profile?.routingPlan) return '未声明'
  return `schema-first / ${profile.routingPlan.defaultExecution.strategy}`
}

function formatExecutionSummary(profile: TemplateProfile | null, commitResultMode: NonNullable<ReturnType<typeof buildDocumentPreviewDiagnosticsModel>>['formalTemplate'] | undefined): string {
  if (commitResultMode?.actualMode === 'schema-first') {
    return `schema-first / ${commitResultMode.actualStrategy || commitResultMode.defaultStrategy || 'unknown'}`
  }
  if (commitResultMode?.actualMode === 'legacy-fallback') {
    return `legacy-fallback / ${commitResultMode.fallbackAdapter || commitResultMode.legacyFallbackAdapter || 'unknown'}`
  }
  return profile?.routingPlan ? formatRoutingSummary(profile) : '未执行'
}

function summarizeBindings(bindings: Array<{ variant: string; status: string; relationshipId?: string; entryPath?: string }>): string {
  return bindings.map((binding) => {
    if (binding.status === 'explicit') {
      return `${binding.variant}=${binding.relationshipId || binding.entryPath || 'explicit'}`
    }
    return `${binding.variant}=inherit-or-none`
  }).join(' / ')
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/g, '')
}

function getParentPath(value: string): string {
  const normalized = normalizePath(value)
  const lastSlashIndex = normalized.lastIndexOf('/')
  return lastSlashIndex > 0 ? normalized.slice(0, lastSlashIndex) : normalized
}

function getFileName(value: string): string {
  const normalized = normalizePath(value)
  const lastSlashIndex = normalized.lastIndexOf('/')
  return lastSlashIndex >= 0 ? normalized.slice(lastSlashIndex + 1) : normalized
}

function getFileExtension(value: string): string {
  const fileName = getFileName(value)
  const extensionIndex = fileName.lastIndexOf('.')
  return extensionIndex >= 0 ? fileName.slice(extensionIndex) : ''
}

function sanitizeArtifactName(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return 'formal-template-beta'
  return trimmed.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-')
}

function buildArtifactTimestamp(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join('') + `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

function buildPreservedArtifactRelativePath(templateTitle: string, outputPath: string): string {
  const extension = getFileExtension(outputPath) || '.docx'
  const fileName = `${sanitizeArtifactName(templateTitle)}-beta-${buildArtifactTimestamp()}${extension}`
  return joinRelativePath('正式模板输出-beta', fileName)
}

export default function FormalTemplatePanel() {
  const { enterFreeMode } = useWorkspaceMode()
  const { activeWorkspaceName, activeWorkspacePath } = useWorkspace()
  const { documents, referenceDocumentIds, templateDocumentId } = useKnowledge()
  const {
    phase,
    profile,
    fieldValues,
    previewPlan,
    previewCandidate,
    commitResult,
    errorMessage,
    lastInstruction,
    setPhase,
    setProfile,
    setFieldValues,
    setPreviewPlan,
    setPreviewCandidate,
    setCommitResult,
    setErrorMessage,
    resetSession,
  } = useFormalTemplateSession()
  const [lastErrorCard, setLastErrorCard] = useState<MinimalErrorCardState | null>(null)
  const [artifactMessage, setArtifactMessage] = useState<string | null>(null)
  const [preservedArtifactPath, setPreservedArtifactPath] = useState<string | null>(null)

  const templateDocument = useMemo(
    () => documents.find((item) => item.id === templateDocumentId) || null,
    [documents, templateDocumentId],
  )

  const referenceDocuments = useMemo(
    () => referenceDocumentIds.map((id) => documents.find((item) => item.id === id)).filter(Boolean),
    [documents, referenceDocumentIds],
  )

  const fieldSchemaById = useMemo(
    () => new Map((profile?.fields || []).map((field) => [field.fieldId, field])),
    [profile],
  )

  const regionById = useMemo(
    () => new Map((profile?.regions || []).map((region) => [region.regionId, region])),
    [profile],
  )

  const pendingFieldLabels = useMemo(
    () => (previewPlan?.pendingFieldIds || []).map((fieldId) => fieldSchemaById.get(fieldId)?.label || fieldId),
    [fieldSchemaById, previewPlan],
  )

  const lockedRegions = useMemo(
    () => (profile?.regions || []).filter((region) => region.shellLocked || !region.llmWritable),
    [profile],
  )

  const generativeRegions = useMemo(
    () => (profile?.regions || []).filter((region) => region.llmWritable && !region.shellLocked),
    [profile],
  )

  const changedFieldLabels = useMemo(
    () => (commitResult?.fieldValues || [])
      .filter((fieldValue) => {
        const schema = fieldSchemaById.get(fieldValue.fieldId)
        return fieldValue.value.trim() !== (schema?.defaultText || '').trim()
      })
      .map((fieldValue) => fieldSchemaById.get(fieldValue.fieldId)?.label || fieldValue.fieldId),
    [commitResult?.fieldValues, fieldSchemaById],
  )

  const changedRegionLabels = useMemo(
    () => (commitResult?.regionResults || []).map((regionResult) => regionById.get(regionResult.regionId)?.label || regionResult.regionId),
    [commitResult?.regionResults, regionById],
  )

  const commitDiagnostics = useMemo(
    () => (commitResult?.documentArtifact?.document ? buildDocumentPreviewDiagnosticsModel(commitResult.documentArtifact.document) : null),
    [commitResult?.documentArtifact?.document],
  )

  const previewInstruction = useMemo(
    () => buildPreviewInstruction(profile?.title || templateDocument?.title || '当前模板'),
    [profile?.title, templateDocument?.title],
  )

  const isBusy = phase === 'analyzing' || phase === 'previewing' || phase === 'committing'
  const canAnalyze = Boolean(templateDocumentId && activeWorkspacePath) && !isBusy
  const canPreview = Boolean(profile?.profileId && profile.workCopyPath) && !isBusy
  const canCommit = Boolean(profile?.profileId && profile?.workCopyPath && previewCandidate?.candidateText.trim()) && !isBusy
  const phaseLabel = PHASE_LABELS[phase]
  const outputDirectoryPath = commitResult ? getParentPath(commitResult.outputPath) : ''

  const setStepError = (step: MinimalErrorStep, reason: string, options?: { validationFailed?: boolean }) => {
    setPhase('error')
    setCommitResult(null)
    setArtifactMessage(null)
    setPreservedArtifactPath(null)
    setErrorMessage(reason)
    setLastErrorCard({
      step,
      reason,
      validationFailed: Boolean(options?.validationFailed),
    })
  }

  const invalidatePreviewArtifacts = () => {
    setPreviewPlan(null)
    setPreviewCandidate(null)
    setCommitResult(null)
    setArtifactMessage(null)
    setPreservedArtifactPath(null)
    setErrorMessage(null)
    setLastErrorCard(null)
    if (profile) setPhase('confirming')
  }

  const handleAnalyze = async () => {
    if (!templateDocumentId) {
      setStepError('analyze', 'Analyze 需要先在知识库中选择一份正式模板文档。')
      return
    }
    if (!activeWorkspacePath) {
      setStepError('analyze', 'Analyze 需要先打开一个工作区，用于放置正式模板工作副本。')
      return
    }

    resetSession()
    setPhase('analyzing')
    setArtifactMessage(null)
    setPreservedArtifactPath(null)
    setErrorMessage(null)
    setLastErrorCard(null)

    try {
      const response = await window.electronAPI.analyzeFormalTemplate({
        knowledgeDocumentId: templateDocumentId,
        sampleDocumentIds: [],
        workspacePath: activeWorkspacePath,
      })

      if (!response.success || !response.profile) {
        setStepError('analyze', getResponseErrorMessage(response.errorMessage, '正式模板 analyze 失败。'))
        return
      }

      setProfile(response.profile)
      setFieldValues(buildInitialFieldValues(response.profile))
      setPreviewPlan(null)
      setPreviewCandidate(null)
      setCommitResult(null)
      setArtifactMessage(null)
      setPreservedArtifactPath(null)
      setErrorMessage(null)
      setLastErrorCard(null)
      setPhase('confirming')
    } catch (error) {
      setStepError('analyze', error instanceof Error ? error.message : '正式模板 analyze 失败。')
    }
  }

  const handlePreview = async () => {
    if (!profile?.profileId || !profile.workCopyPath) {
      setStepError('preview', 'Preview 需要先完成 analyze，拿到 TemplateProfile 和工作副本路径。')
      return
    }

    setPhase('previewing')
    setPreviewPlan(null)
    setPreviewCandidate(null)
    setCommitResult(null)
    setArtifactMessage(null)
    setPreservedArtifactPath(null)
    setErrorMessage(null)
    setLastErrorCard(null)

    try {
      const response = await window.electronAPI.previewFormalTemplateTask({
        profileId: profile.profileId,
        workCopyPath: profile.workCopyPath,
        instruction: previewInstruction,
        referenceDocumentIds,
        sampleDocumentIds: [],
        fieldValues,
        retrievalMode: 'auto',
      })

      if (!response.success || !response.plan) {
        setStepError('preview', getResponseErrorMessage(response.errorMessage, '正式模板 preview 失败。'))
        return
      }

      setPreviewPlan(response.plan)
      setPreviewCandidate(response.regionCandidate || null)
      setErrorMessage(null)
      setLastErrorCard(null)
      setPhase('completed')
    } catch (error) {
      setStepError('preview', error instanceof Error ? error.message : '正式模板 preview 失败。')
    }
  }

  const handleCommit = async () => {
    if (!profile?.profileId || !profile.workCopyPath) {
      setStepError('commit', 'Commit 需要先完成 analyze，拿到 TemplateProfile 和工作副本路径。')
      return
    }
    const hasPreviewParagraphs = Array.isArray(previewCandidate?.candidateParagraphs) && previewCandidate.candidateParagraphs.some((paragraph) => paragraph.trim())
    if (!previewCandidate?.candidateText.trim() && !hasPreviewParagraphs) {
      setStepError('commit', 'Commit 需要先拿到当前中间正文 candidateText；字段改动后请重新 Preview。')
      return
    }

    setPhase('committing')
    setCommitResult(null)
    setArtifactMessage(null)
    setPreservedArtifactPath(null)
    setErrorMessage(null)
    setLastErrorCard(null)

    try {
      const response = await window.electronAPI.commitFormalTemplateTask({
        profileId: profile.profileId,
        workCopyPath: profile.workCopyPath,
        instruction: lastInstruction || undefined,
        fieldValues,
        regionPatches: [{
          regionId: previewCandidate.regionId,
          finalText: previewCandidate.candidateText,
          finalParagraphs: previewCandidate.candidateParagraphs,
        }],
      })

      if (!response.success || !response.result) {
        const validationFailed = isShellValidationError(response.errorCode)
        const reason = validationFailed
          ? `validation failed: ${getResponseErrorMessage(response.errorMessage, 'shell validation 未通过。')}`
          : getResponseErrorMessage(response.errorMessage, '正式模板 commit 失败。')
        setStepError('commit', reason, { validationFailed })
        return
      }

      if (!response.result.allCommitted || !response.result.shellValidation.passed) {
        setStepError(
          'commit',
          `validation failed: ${response.result.shellValidation.errorMessage || 'shell validation 未通过；本次 commit 视为失败。'}`,
          { validationFailed: true },
        )
        return
      }

      setCommitResult(response.result)
      setArtifactMessage(null)
      setPreservedArtifactPath(null)
      setErrorMessage(null)
      setLastErrorCard(null)
      setPhase('completed')
    } catch (error) {
      setStepError('commit', error instanceof Error ? error.message : '正式模板 commit 失败。')
    }
  }

  const handleFieldValueChange = (fieldId: string, value: string) => {
    invalidatePreviewArtifacts()
    setFieldValues(fieldValues.map((fieldValue) => (
      fieldValue.fieldId === fieldId
        ? { ...fieldValue, value, userOverride: true }
        : fieldValue
    )))
  }

  const handleFieldConfirmToggle = (fieldId: string) => {
    setFieldValues(fieldValues.map((fieldValue) => (
      fieldValue.fieldId === fieldId
        ? { ...fieldValue, confirmed: !fieldValue.confirmed, userOverride: true }
        : fieldValue
    )))
  }

  const handleFieldReset = (fieldId: string) => {
    invalidatePreviewArtifacts()
    setFieldValues(fieldValues.map((fieldValue) => {
      if (fieldValue.fieldId !== fieldId) return fieldValue
      const schema = fieldSchemaById.get(fieldId)
      return {
        ...fieldValue,
        value: schema?.defaultText || '',
        userOverride: false,
        confirmed: false,
      }
    }))
  }

  const handleOpenPath = async (targetPath: string, successMessage: string, failurePrefix: string) => {
    const normalizedPath = targetPath.trim()
    if (!normalizedPath) {
      setArtifactMessage(failurePrefix)
      return
    }

    const opened = await window.electronAPI.openExternalFile(normalizedPath)
    setArtifactMessage(opened.success ? successMessage : `${failurePrefix}${opened.error ? `：${opened.error}` : ''}`)
  }

  const handlePreserveArtifact = async () => {
    if (!commitResult?.outputPath) {
      setArtifactMessage('保留产物需要先完成一次成功的 Commit。')
      return
    }
    if (!activeWorkspacePath) {
      setArtifactMessage('保留产物需要当前工作区处于打开状态。')
      return
    }

    const sourceRelativePath = toRelativeWorkspacePath(activeWorkspacePath, commitResult.outputPath)
    if (!sourceRelativePath) {
      setArtifactMessage('当前生成结果不在工作区内，无法保留到正式模板输出目录。')
      return
    }

    try {
      const targetRelativePath = buildPreservedArtifactRelativePath(profile?.title || templateDocument?.title || 'formal-template', commitResult.outputPath)
      const copied = await window.electronAPI.copyWorkspacePath(activeWorkspacePath, sourceRelativePath, targetRelativePath)
      setPreservedArtifactPath(copied.path)
      setArtifactMessage(`已保留到 ${copied.path}`)
    } catch (error) {
      setArtifactMessage(error instanceof Error ? `保留产物失败：${error.message}` : '保留产物失败。')
    }
  }

  return (
    <PanelShell data-workspace-mode="formal-template">
      <PanelCard>
        <Header>
          <div>
            <Eyebrow>Formal Template Debug</Eyebrow>
            <Title>正式模板调试面板</Title>
          </div>
          <StatusPill $phase={phase}>{phaseLabel}</StatusPill>
        </Header>

        <Description>
          这个面板只在 formalTemplateDebug 开关打开时作为 analyze / preview / commit 直连调试入口保留。正常 templateDocument 前台仍然是底部输入框驱动的统一生成主链，这里不定义正式用户流。
        </Description>

        <Section>
          <SectionTitle>调试边界</SectionTitle>
          <SectionBody>
            <DetailGrid>
              <DetailCard>
                <DetailLabel>当前适用</DetailLabel>
                <DetailValue>固定信头、固定页脚、固定落款壳层，只有少量字段替换和一个中间正文改写区的正式函件模板。</DetailValue>
              </DetailCard>
              <DetailCard>
                <DetailLabel>当前不做</DetailLabel>
                <DetailValue>不扩成通用模板平台，不处理多正文区联动、复杂表格、附件回执、跨页重排、页眉页脚动态生成等模板类型。</DetailValue>
              </DetailCard>
            </DetailGrid>
            <InlineNote>
              当前软件内接入的是“正式模板模式 Beta”，底层仍然只针对《拜访函_模板1.docx》这类样例模板做受控 Analyze / Preview / Commit，自由写作模式完全保留原状。
            </InlineNote>
          </SectionBody>
        </Section>

        <SummaryGrid>
          <SummaryCard>
            <SummaryLabel>当前模板</SummaryLabel>
            <SummaryValue>{templateDocument?.title || '未选择'}</SummaryValue>
            <SummaryMeta>{templateDocumentId || '请先在知识库中选择模板文档'}</SummaryMeta>
          </SummaryCard>
          <SummaryCard>
            <SummaryLabel>当前工作区</SummaryLabel>
            <SummaryValue>{activeWorkspaceName || '未打开'}</SummaryValue>
            <SummaryMeta>{activeWorkspacePath || 'Analyze 需要工作区路径'}</SummaryMeta>
          </SummaryCard>
          <SummaryCard>
            <SummaryLabel>参考材料</SummaryLabel>
            <SummaryValue>{referenceDocumentIds.length}</SummaryValue>
            <SummaryMeta>
              {referenceDocuments.length > 0 ? referenceDocuments.map((item) => item?.title).join(' / ') : '允许为空，Preview 会走最小默认检索'}
            </SummaryMeta>
          </SummaryCard>
          <SummaryCard>
            <SummaryLabel>当前阶段</SummaryLabel>
            <SummaryValue>{phaseLabel}</SummaryValue>
            <SummaryMeta>{phase}</SummaryMeta>
          </SummaryCard>
        </SummaryGrid>

        <Section>
          <SectionTitle>最小操作</SectionTitle>
          <SectionBody>
            <ActionRow>
              <ButtonRow>
                <ActionButton type="button" $primary onClick={() => void handleAnalyze()} disabled={!canAnalyze}>
                  {phase === 'analyzing' ? 'Analyze 中...' : 'Analyze 模板'}
                </ActionButton>
                <ActionButton type="button" onClick={() => void handlePreview()} disabled={!canPreview}>
                  {phase === 'previewing' ? 'Preview 中...' : 'Preview 计划'}
                </ActionButton>
                <ActionButton type="button" onClick={() => void handleCommit()} disabled={!canCommit}>
                  {phase === 'committing' ? 'Commit 中...' : 'Commit 写回'}
                </ActionButton>
              </ButtonRow>
              <InlineNote>
                当前 Beta 只命中拜访函样例适配层。Preview 只返回唯一中间正文区的 candidateText；Commit 只把允许改的字段块和这一个中间正文区写回工作区内的 formal-template 工作副本，然后立即做 shell validation，任何失败都直接报错。
              </InlineNote>
            </ActionRow>

            {!templateDocumentId || !activeWorkspacePath ? (
              <InlineWarning>
                当前还不满足 analyze 前置条件。需要先选择正式模板文档，并保证中央工作区已经打开。
              </InlineWarning>
            ) : null}
          </SectionBody>
        </Section>

        {lastErrorCard ? (
          <Section>
            <SectionTitle>Last Error</SectionTitle>
            <SectionBody>
              <DetailGrid>
                <DetailCard>
                  <DetailLabel>失败步骤</DetailLabel>
                  <DetailValue>{getErrorStepLabel(lastErrorCard.step)}</DetailValue>
                </DetailCard>
                <DetailCard>
                  <DetailLabel>错误类型</DetailLabel>
                  <DetailValue>{lastErrorCard.validationFailed ? 'validation failed' : 'step failed'}</DetailValue>
                </DetailCard>
              </DetailGrid>
              <ErrorBanner>{lastErrorCard.reason}</ErrorBanner>
            </SectionBody>
          </Section>
        ) : null}

        <Section>
          <SectionTitle>Template Profile</SectionTitle>
          {profile ? (
            <DetailGrid>
              <DetailCard>
                <DetailLabel>模板标题</DetailLabel>
                <DetailValue>{profile.title}</DetailValue>
              </DetailCard>
              <DetailCard>
                <DetailLabel>Profile ID</DetailLabel>
                <DetailValue>{profile.profileId}</DetailValue>
              </DetailCard>
              <DetailCard>
                <DetailLabel>来源格式</DetailLabel>
                <DetailValue>{profile.sourceType}</DetailValue>
              </DetailCard>
              <DetailCard>
                <DetailLabel>工作副本路径</DetailLabel>
                <DetailValue>{profile.workCopyPath}</DetailValue>
              </DetailCard>
              <DetailCard>
                <DetailLabel>字段数量</DetailLabel>
                <DetailValue>{profile.fields.length}</DetailValue>
              </DetailCard>
              <DetailCard>
                <DetailLabel>区域数量</DetailLabel>
                <DetailValue>{profile.regions.length}</DetailValue>
              </DetailCard>
            </DetailGrid>
          ) : (
            <EmptyState>
              还没有 TemplateProfile。点击 Analyze 模板后，这里会展示 profileId、工作副本路径、字段数和区域数。
            </EmptyState>
          )}
        </Section>

        <Section>
          <SectionTitle>Field Values</SectionTitle>
          {fieldValues.length > 0 ? (
            <ListGrid>
              {fieldValues.map((fieldValue) => {
                const schema = fieldSchemaById.get(fieldValue.fieldId)
                const useTextarea = schema?.label === '来访人员说明' || fieldValue.value.length > 36
                return (
                  <ListCard key={fieldValue.fieldId}>
                    <ListHeader>
                      <ListTitle>{schema?.label || fieldValue.fieldId}</ListTitle>
                      <Tag $tone={schema?.required ? 'warn' : 'default'}>{schema?.required ? '必填' : '可选'}</Tag>
                    </ListHeader>
                    {useTextarea ? (
                      <EditableTextarea value={fieldValue.value} onChange={(event) => handleFieldValueChange(fieldValue.fieldId, event.target.value)} />
                    ) : (
                      <EditableInput value={fieldValue.value} onChange={(event) => handleFieldValueChange(fieldValue.fieldId, event.target.value)} />
                    )}
                    <ButtonRow>
                      <InlineButton type="button" $active={fieldValue.confirmed} onClick={() => handleFieldConfirmToggle(fieldValue.fieldId)}>
                        {fieldValue.confirmed ? '已确认' : '确认字段'}
                      </InlineButton>
                      <InlineButton type="button" onClick={() => handleFieldReset(fieldValue.fieldId)}>
                        恢复样例值
                      </InlineButton>
                    </ButtonRow>
                    <MetaRow>
                      <MetaChip>{schema?.dataType || 'text'}</MetaChip>
                      <MetaChip>{schema?.sourceKind || 'placeholder'}</MetaChip>
                      <MetaChip>blocks: {(schema?.blockIndices || []).join(', ') || '--'}</MetaChip>
                      <MetaChip>{fieldValue.confirmed ? '已确认' : '未确认'}</MetaChip>
                    </MetaRow>
                  </ListCard>
                )
              })}
            </ListGrid>
          ) : (
            <EmptyState>
              还没有字段值。Analyze 成功后，会把模板字段默认值 materialize 到 FormalTemplateSessionContext.fieldValues。
            </EmptyState>
          )}
        </Section>

        <Section>
          <SectionTitle>Regions</SectionTitle>
          {profile ? (
            <ListGrid>
              <ListCard>
                <ListHeader>
                  <ListTitle>锁定区</ListTitle>
                  <Tag>{lockedRegions.length}</Tag>
                </ListHeader>
                {lockedRegions.length > 0 ? lockedRegions.map((region) => (
                  <div key={region.regionId}>
                    <ValueText>{region.label}</ValueText>
                    <MetaRow>
                      <MetaChip>{region.blockRange.start}-{region.blockRange.end}</MetaChip>
                      <MetaChip>{region.detectionKind}</MetaChip>
                    </MetaRow>
                  </div>
                )) : <EmptyState>暂无锁定区。</EmptyState>}
              </ListCard>

              <ListCard>
                <ListHeader>
                  <ListTitle>字段区</ListTitle>
                  <Tag>{profile.fields.length}</Tag>
                </ListHeader>
                {profile.fields.length > 0 ? profile.fields.map((field) => (
                  <div key={field.fieldId}>
                    <ValueText>{field.label}</ValueText>
                    <MetaRow>
                      <MetaChip>{field.blockIndices.join(', ')}</MetaChip>
                      <MetaChip>{field.sourceKind}</MetaChip>
                    </MetaRow>
                  </div>
                )) : <EmptyState>暂无字段区。</EmptyState>}
              </ListCard>

              <ListCard>
                <ListHeader>
                  <ListTitle>可生成区</ListTitle>
                  <Tag>{generativeRegions.length}</Tag>
                </ListHeader>
                {generativeRegions.length > 0 ? generativeRegions.map((region) => (
                  <div key={region.regionId}>
                    <ValueText>{region.label}</ValueText>
                    <MetaRow>
                      <MetaChip>{region.blockRange.start}-{region.blockRange.end}</MetaChip>
                      <MetaChip>{region.detectionKind}</MetaChip>
                    </MetaRow>
                  </div>
                )) : <EmptyState>暂无可生成区。</EmptyState>}
              </ListCard>
            </ListGrid>
          ) : (
            <EmptyState>
              还没有 regions。Analyze 成功后，这里会按锁定区 / 字段区 / 可生成区展示拜访函样例拆分结果。
            </EmptyState>
          )}
        </Section>

        <Section>
          <SectionTitle>Preview Plan</SectionTitle>
          {previewPlan ? (
            <SectionBody>
              <DetailGrid>
                <DetailCard>
                  <DetailLabel>计划所属 Profile</DetailLabel>
                  <DetailValue>{previewPlan.profileId}</DetailValue>
                </DetailCard>
                <DetailCard>
                  <DetailLabel>区域计划数</DetailLabel>
                  <DetailValue>{previewPlan.regionPlans.length}</DetailValue>
                </DetailCard>
                <DetailCard>
                  <DetailLabel>待补字段数</DetailLabel>
                  <DetailValue>{previewPlan.pendingFieldIds.length}</DetailValue>
                </DetailCard>
                <DetailCard>
                  <DetailLabel>预估 Tokens</DetailLabel>
                  <DetailValue>{previewPlan.estimatedTotalTokens ?? '--'}</DetailValue>
                </DetailCard>
              </DetailGrid>

              {pendingFieldLabels.length > 0 ? (
                <PendingRow>
                  {pendingFieldLabels.map((label) => <Tag key={label} $tone="warn">{label}</Tag>)}
                </PendingRow>
              ) : (
                <MutedText>当前没有待补字段，preview plan 已覆盖所有已知必填字段。</MutedText>
              )}

              <ListGrid>
                {previewPlan.regionPlans.map((plan) => {
                  const region = regionById.get(plan.regionId)
                  return (
                    <ListCard key={plan.regionId}>
                      <ListHeader>
                        <ListTitle>{region?.label || plan.regionId}</ListTitle>
                        <Tag>{plan.promptStrategy}</Tag>
                      </ListHeader>
                      <ValueText>{truncateText(region?.originalText || '', 140)}</ValueText>
                      <MetaRow>
                        <MetaChip>mode: {plan.retrievalConfig.mode}</MetaChip>
                        <MetaChip>refs: {plan.retrievalConfig.referenceDocumentIds.length}</MetaChip>
                        <MetaChip>samples: {plan.retrievalConfig.sampleDocumentIds.length}</MetaChip>
                        <MetaChip>maxChunks: {plan.retrievalConfig.maxChunks}</MetaChip>
                      </MetaRow>
                    </ListCard>
                  )
                })}
              </ListGrid>
            </SectionBody>
          ) : (
            <EmptyState>
              还没有 preview plan。点击 Preview 计划后，这里会展示 regionPlans、pendingFieldIds 和检索配置摘要。
            </EmptyState>
          )}
        </Section>

        <Section>
          <SectionTitle>Preview Candidate</SectionTitle>
          {previewCandidate ? (
            <SectionBody>
              <MetaRow>
                <MetaChip>{previewCandidate.label}</MetaChip>
                <MetaChip>{previewCandidate.regionId}</MetaChip>
              </MetaRow>
              <CandidateBlock>{previewCandidate.candidateText}</CandidateBlock>
            </SectionBody>
          ) : (
            <EmptyState>
              还没有中间正文候选内容。点击 Preview 计划后，这里只会显示《拜访函_模板1.docx》唯一中间正文区的 candidateText；Commit 也只接受这一段候选内容。
            </EmptyState>
          )}
        </Section>

        <Section>
          <SectionTitle>Commit Result</SectionTitle>
          {commitResult ? (
            <SectionBody>
              <DetailGrid>
                <DetailCard>
                  <DetailLabel>输出文件</DetailLabel>
                  <DetailValue>{commitResult.outputPath}</DetailValue>
                </DetailCard>
                <DetailCard>
                  <DetailLabel>模板模式</DetailLabel>
                  <DetailValue>{commitDiagnostics?.template?.mode || '未声明'}</DetailValue>
                </DetailCard>
                <DetailCard>
                  <DetailLabel>默认路由</DetailLabel>
                  <DetailValue>{formatRoutingSummary(profile)}</DetailValue>
                </DetailCard>
                <DetailCard>
                  <DetailLabel>实际执行</DetailLabel>
                  <DetailValue>{formatExecutionSummary(profile, commitDiagnostics?.formalTemplate)}</DetailValue>
                </DetailCard>
                <DetailCard>
                  <DetailLabel>Fallback 原因</DetailLabel>
                  <DetailValue>{commitDiagnostics?.formalTemplate?.fallbackReasonCode || '未触发'}</DetailValue>
                </DetailCard>
                <DetailCard>
                  <DetailLabel>写回状态</DetailLabel>
                  <DetailValue>{commitResult.allCommitted ? 'commit 成功' : 'commit 未完成'}</DetailValue>
                </DetailCard>
                <DetailCard>
                  <DetailLabel>Shell Validation</DetailLabel>
                  <DetailValue>{commitResult.shellValidation.passed ? 'passed' : 'failed'}</DetailValue>
                </DetailCard>
                <DetailCard>
                  <DetailLabel>校验块数</DetailLabel>
                  <DetailValue>{commitResult.shellValidation.checkedBlockCount}</DetailValue>
                </DetailCard>
                <DetailCard>
                  <DetailLabel>修改字段</DetailLabel>
                  <DetailValue>{changedFieldLabels.length > 0 ? changedFieldLabels.join(' / ') : '无字段值变化'}</DetailValue>
                </DetailCard>
                <DetailCard>
                  <DetailLabel>修改正文区域</DetailLabel>
                  <DetailValue>{changedRegionLabels.length > 0 ? changedRegionLabels.join(' / ') : '无'}</DetailValue>
                </DetailCard>
                <DetailCard>
                  <DetailLabel>changedIndices 摘要</DetailLabel>
                  <DetailValue>{summarizeIndices(commitResult.changedIndices)}</DetailValue>
                </DetailCard>
                <DetailCard>
                  <DetailLabel>区域写回状态</DetailLabel>
                  <DetailValue>{commitResult.regionResults.every((item) => item.committed) ? '全部已写回' : '存在未写回区域'}</DetailValue>
                </DetailCard>
              </DetailGrid>

              <MetaRow>
                <MetaChip>changedIndices: {commitResult.changedIndices.length}</MetaChip>
                <MetaChip>violations: {commitResult.shellValidation.violatedBlockIndices.length}</MetaChip>
                <MetaChip>duration: {commitResult.shellValidation.durationMs} ms</MetaChip>
                <MetaChip>regions: {commitResult.regionResults.length}</MetaChip>
                {commitDiagnostics?.template?.mode ? <MetaChip>{`templateMode: ${commitDiagnostics.template.mode}`}</MetaChip> : null}
                {commitDiagnostics?.formalTemplate?.actualMode ? (
                  <MetaChip $tone={commitDiagnostics.formalTemplate.usedFallback ? 'warn' : 'default'}>
                    {`execution: ${commitDiagnostics.formalTemplate.actualMode}`}
                  </MetaChip>
                ) : null}
                {commitDiagnostics?.formalTemplate?.fallbackReasonCode ? (
                  <MetaChip $tone="warn">{`fallback: ${commitDiagnostics.formalTemplate.fallbackReasonCode}`}</MetaChip>
                ) : null}
              </MetaRow>

              {commitDiagnostics?.formalTemplate?.fallbackReason ? <MutedText>{commitDiagnostics.formalTemplate.fallbackReason}</MutedText> : null}

              {commitDiagnostics?.sections.length ? (
                <DetailGrid>
                  {commitDiagnostics.sections.map((section, index) => (
                    <DetailCard key={section.id}>
                      <DetailLabel>{`Section ${index + 1}`}</DetailLabel>
                      <DetailValue>{section.boundaryLabel}</DetailValue>
                      <MutedText>{`${section.scope} / ${section.breakType || 'nextPage'} / ${section.titlePage ? 'titlePg=yes' : 'titlePg=no'}${typeof section.columnCount === 'number' ? ` / cols=${section.columnCount}` : ''}`}</MutedText>
                      <MutedText>{`Page Number: ${section.pageNumber ? `${section.pageNumber.format || 'default'} / ${typeof section.pageNumber.start === 'number' ? `start=${section.pageNumber.start}` : 'follow-previous'} / ${section.pageNumber.restart ? 'restart=yes' : 'restart=no'}` : '未声明'}`}</MutedText>
                      <MutedText>{`Header: ${summarizeBindings(section.headerBindings)}`}</MutedText>
                      <MutedText>{`Footer: ${summarizeBindings(section.footerBindings)}`}</MutedText>
                    </DetailCard>
                  ))}
                </DetailGrid>
              ) : null}

              <ActionRow>
                <ButtonRow>
                  <ActionButton type="button" onClick={() => void handleOpenPath(commitResult.outputPath, '已打开生成结果。', '打开生成结果失败')}>
                    打开生成结果
                  </ActionButton>
                  <ActionButton type="button" onClick={() => void handleOpenPath(outputDirectoryPath, '已打开输出目录。', '打开输出目录失败')}>
                    打开输出目录
                  </ActionButton>
                  <ActionButton type="button" onClick={() => void handlePreserveArtifact()}>
                    保留产物
                  </ActionButton>
                  {preservedArtifactPath ? (
                    <ActionButton type="button" onClick={() => void handleOpenPath(preservedArtifactPath, '已打开保留产物。', '打开保留产物失败')}>
                      打开保留产物
                    </ActionButton>
                  ) : null}
                </ButtonRow>
                <InlineNote>
                  当前输出默认位于工作区的 .formal-template 目录。点击“保留产物”会复制一份到正式模板输出-beta，便于人工验收、发给业务同学或保留 Beta 样例结果。
                </InlineNote>
              </ActionRow>

              {artifactMessage ? <MutedText>{artifactMessage}</MutedText> : null}

              {preservedArtifactPath ? (
                <DetailGrid>
                  <DetailCard>
                    <DetailLabel>保留产物路径</DetailLabel>
                    <DetailValue>{preservedArtifactPath}</DetailValue>
                  </DetailCard>
                </DetailGrid>
              ) : null}
            </SectionBody>
          ) : (
            <EmptyState>
              还没有 commit 结果。只有 OOXML 写回成功且 shell validation passed，才会在这里显示正式输出文件路径；否则直接进入错误态，不假成功。
            </EmptyState>
          )}
        </Section>

        <Footer>
          <MutedText>
            当前正式模板模式 Beta 只写 formal-template 工作副本并提供 Beta 结果入口，不接 DocumentContext、EditorPanel、GenerationComposer、paperGenerator、自由写作保存链，也不扩展到其它模板平台或改底部 Dock 主逻辑。
          </MutedText>
          <BackButton type="button" onClick={enterFreeMode}>返回自由写作</BackButton>
        </Footer>
      </PanelCard>
    </PanelShell>
  )
}