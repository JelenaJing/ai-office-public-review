import {
  applyArtifactPatches,
  type DocumentArtifact,
  type DocumentPatch,
} from '../../core'
import type {
  CommitFormalTemplateTaskRequest,
  FieldValue,
  RenderResult,
  TemplateProfile,
} from '../../../types/templateGeneration'
import {
  collectTemplateDocumentRegionBlocks,
  getTemplateDocumentFieldBindingFromBlock,
  getTemplateDocumentRegionBindingFromBlock,
  serializeTemplateDocumentRegionBlocks,
  type TemplateDocumentRenderResultArtifactContext,
} from '../../profiles/templateDocument/orchestrator/templateDocumentOrchestrator'

type TemplateDocumentCommitPatch = Extract<DocumentPatch, { type: 'replace_block' | 'fill_slot' | 'replace_image' }>

export interface PreparedTemplateDocumentEditCommit {
  patchedArtifact: DocumentArtifact
  commitRequest: CommitFormalTemplateTaskRequest
  affectedFieldIds: string[]
  affectedRegionIds: string[]
}

export type PrepareTemplateDocumentEditCommitResult =
  | { ok: true; value: PreparedTemplateDocumentEditCommit }
  | { ok: false; error: string; patchedArtifact?: DocumentArtifact }

export type PreparedTemplateDocumentRewriteCommit = PreparedTemplateDocumentEditCommit
export type PrepareTemplateDocumentRewriteCommitResult = PrepareTemplateDocumentEditCommitResult

interface PrepareTemplateDocumentEditCommitInput {
  commitResult: RenderResult | null
  sourceArtifact?: DocumentArtifact | null
  profile: TemplateProfile | null
  instruction?: string
  patches: DocumentPatch[]
}

export interface CreateTemplateDocumentArtifactContextInput {
  commitResult: RenderResult
  profile: TemplateProfile | null
  templateDocumentId?: string
  templateTitle?: string
}

function findBlockById(artifact: DocumentArtifact, targetId: string) {
  return artifact.document.blocks.find((block) => block.id === targetId) || null
}

function findSlotBlockByKey(artifact: DocumentArtifact, slotKey: string) {
  return artifact.document.blocks.find((block) => block.type === 'slot' && block.slotKey === slotKey) || null
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function normalizeOptionalString(value: unknown): string | undefined {
  const normalized = String(value ?? '').trim()
  return normalized || undefined
}

function isTemplateDocumentCommitPatch(patch: DocumentPatch): patch is TemplateDocumentCommitPatch {
  return patch.type === 'replace_block' || patch.type === 'fill_slot' || patch.type === 'replace_image'
}

function resolveSlotBlockText(block: ReturnType<typeof findBlockById>): string {
  if (!block || block.type !== 'slot') return ''
  const slotValue = block.value && typeof block.value === 'object' && !Array.isArray(block.value)
    ? block.value as Record<string, unknown>
    : null
  return normalizeOptionalString(slotValue?.text) || normalizeOptionalString(block.text) || ''
}

function buildCommittedFieldValues(input: {
  currentFieldValues: FieldValue[]
  profile: TemplateProfile
  patchedArtifact: DocumentArtifact
  patches: Extract<TemplateDocumentCommitPatch, { type: 'fill_slot' }> []
}): { fieldValues: FieldValue[]; affectedFieldIds: string[] } {
  const updates = new Map<string, string>()
  input.patches.forEach((patch) => {
    const targetBlock = 'targetId' in patch
      ? findBlockById(input.patchedArtifact, patch.targetId)
      : findSlotBlockByKey(input.patchedArtifact, patch.slotKey)
    const binding = getTemplateDocumentFieldBindingFromBlock(targetBlock)
    const slotText = resolveSlotBlockText(targetBlock)
    if (!binding?.fieldId || !slotText) return
    updates.set(binding.fieldId, slotText)
  })

  const affectedFieldIds = Array.from(updates.keys())
  if (affectedFieldIds.length === 0) {
    return { fieldValues: input.currentFieldValues, affectedFieldIds }
  }

  const existingByFieldId = new Map(input.currentFieldValues.map((fieldValue) => [fieldValue.fieldId, fieldValue]))
  const orderedFieldIds = uniqueStrings([
    ...input.profile.fields.map((field) => field.fieldId),
    ...input.currentFieldValues.map((fieldValue) => fieldValue.fieldId),
    ...affectedFieldIds,
  ])

  return {
    affectedFieldIds,
    fieldValues: orderedFieldIds
      .map((fieldId) => {
        const existing = existingByFieldId.get(fieldId)
        const nextValue = updates.get(fieldId)
        if (existing) {
          if (nextValue === undefined) return existing
          return {
            ...existing,
            value: nextValue,
            userOverride: true,
            confirmed: true,
          }
        }
        if (nextValue === undefined) return null
        return {
          fieldId,
          value: nextValue,
          userOverride: true,
          confirmed: true,
        }
      })
      .filter((fieldValue): fieldValue is FieldValue => Boolean(fieldValue)),
  }
}

export function prepareTemplateDocumentEditCommit(input: PrepareTemplateDocumentEditCommitInput): PrepareTemplateDocumentEditCommitResult {
  const supportedPatches = input.patches.filter(isTemplateDocumentCommitPatch)
  const sourceArtifact = input.sourceArtifact || input.commitResult?.documentArtifact || null

  if (!sourceArtifact) return { ok: false, error: '当前还没有正式结果，暂时无法提交文稿修改。' }
  if (!input.commitResult) return { ok: false, error: '当前模板提交流程上下文不完整，暂时无法提交文稿修改。' }
  if (!input.profile?.profileId || !input.profile?.workCopyPath) return { ok: false, error: '当前模板上下文不完整，暂时无法提交文稿修改。' }
  if (supportedPatches.length === 0) return { ok: false, error: '当前没有可提交的文稿修改。' }

  const patchedArtifactResult = applyArtifactPatches(sourceArtifact, supportedPatches)
  if (!patchedArtifactResult.ok) {
    return {
      ok: false,
      error: `本地预览已更新，但无法整理为可提交版本：${patchedArtifactResult.error.message}`,
      patchedArtifact: patchedArtifactResult.artifact,
    }
  }

  const fillSlotPatches = supportedPatches.filter((patch): patch is Extract<TemplateDocumentCommitPatch, { type: 'fill_slot' }> => patch.type === 'fill_slot')
  const regionAwarePatches = supportedPatches.filter((patch): patch is Extract<TemplateDocumentCommitPatch, { type: 'replace_block' | 'replace_image' }> => patch.type === 'replace_block' || patch.type === 'replace_image')

  const { fieldValues, affectedFieldIds } = buildCommittedFieldValues({
    currentFieldValues: input.commitResult.fieldValues,
    profile: input.profile,
    patchedArtifact: patchedArtifactResult.artifact,
    patches: fillSlotPatches,
  })

  if (fillSlotPatches.length > 0 && affectedFieldIds.length === 0) {
    return { ok: false, error: '当前待补内容还没有对应的正式模板字段映射，暂时无法提交。', patchedArtifact: patchedArtifactResult.artifact }
  }

  const affectedRegionIds = uniqueStrings(regionAwarePatches.map((patch) => {
    const block = findBlockById(patchedArtifactResult.artifact, patch.targetId)
    const binding = getTemplateDocumentRegionBindingFromBlock(block)
    return binding?.editable === false ? '' : binding?.regionId || ''
  }))

  if (regionAwarePatches.length > 0 && affectedRegionIds.length === 0) {
    return { ok: false, error: '当前修改位置还没有对应的正式模板区域映射，暂时无法提交。', patchedArtifact: patchedArtifactResult.artifact }
  }

  const regionPatches = affectedRegionIds.map((regionId) => {
    const regionBlocks = collectTemplateDocumentRegionBlocks(patchedArtifactResult.artifact.document, regionId)
    const serialized = serializeTemplateDocumentRegionBlocks(regionBlocks)
    return {
      regionId,
      finalText: serialized.finalText,
      finalParagraphs: serialized.finalParagraphs,
    }
  }).filter((item) => item.finalText.trim())

  if (regionAwarePatches.length > 0 && regionPatches.length === 0) {
    return { ok: false, error: '当前修改区域还没有可提交的正文内容。', patchedArtifact: patchedArtifactResult.artifact }
  }

  if (affectedFieldIds.length === 0 && regionPatches.length === 0) {
    return { ok: false, error: '当前没有整理出可提交的字段或正文修改。', patchedArtifact: patchedArtifactResult.artifact }
  }

  return {
    ok: true,
    value: {
      patchedArtifact: patchedArtifactResult.artifact,
      affectedFieldIds,
      affectedRegionIds,
      commitRequest: {
        profileId: input.profile.profileId,
        workCopyPath: input.profile.workCopyPath,
        instruction: input.instruction?.trim() || undefined,
        fieldValues,
        regionPatches,
      },
    },
  }
}

export function prepareTemplateDocumentRewriteCommit(input: PrepareTemplateDocumentEditCommitInput): PrepareTemplateDocumentRewriteCommitResult {
  return prepareTemplateDocumentEditCommit({
    ...input,
    patches: input.patches.filter((patch): patch is Extract<DocumentPatch, { type: 'replace_block' }> => patch.type === 'replace_block'),
  })
}

export function createTemplateDocumentArtifactContext(input: CreateTemplateDocumentArtifactContextInput): TemplateDocumentRenderResultArtifactContext {
  const fieldLabels = input.profile ? Object.fromEntries(input.profile.fields.map((field) => [field.fieldId, field.label || field.fieldId])) : undefined
  const regionLabels = input.profile ? Object.fromEntries(input.profile.regions.map((region) => [region.regionId, region.label || region.regionId])) : undefined
  return {
    artifactId: `templateDocument:${input.commitResult.profileId}:commit`,
    templateDocumentId: input.templateDocumentId || input.profile?.knowledgeDocumentId,
    templateTitle: input.templateTitle || input.profile?.title,
    activeTaskId: input.commitResult.documentArtifact?.profileMetadata?.activeTaskId as string | undefined,
    fieldLabels,
    regionLabels,
    routingPlan: input.profile?.routingPlan,
  }
}