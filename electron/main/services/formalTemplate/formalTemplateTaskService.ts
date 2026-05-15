// ---------------------------------------------------------------------------
// formalTemplateTaskService.ts — 正式模板模式唯一主编排器
// ---------------------------------------------------------------------------
// 职责：串起整个正式模板任务链的 4 个阶段（analyze → confirm → preview → commit）。
//       每个阶段对应一个 IPC handler，由 index.ts 直接调用本服务中的方法。
//
// 调用顺序：
//   analyze:  admit → extractFields → locateRegions → createProfile → saveProfile
//   confirm:  loadProfile → resolveFields → writeFieldsToDocx → updateProfile
//   preview:  loadProfile → retrieveChunks → buildGenerationPlan
//   commit:   loadProfile → generateRegionCandidates → applyBlockPatches → writeOoxmlPackage → validateShell
//
// 编排器本身不包含业务逻辑实现，只串联子服务。
// 所有状态持久化在 TemplateProfile JSON 中，不依赖前端 Context。
// ---------------------------------------------------------------------------

import type { OoxmlPackageSnapshot, OoxmlBlockSnapshot } from '../documentEngineService'
import path from 'node:path'
import type { AppSettings } from '../settingsStore'
import type { KnowledgeRetrievalResult } from '../../../../src/types/knowledge'
import type {
  AnalyzeFormalTemplateRequest, AnalyzeFormalTemplateResponse,
  ConfirmFormalTemplateFieldsRequest, ConfirmFormalTemplateFieldsResponse,
  PreviewFormalTemplateTaskRequest, PreviewFormalTemplateTaskResponse,
  CommitFormalTemplateTaskRequest, CommitFormalTemplateTaskResponse,
  TemplateProfile, FieldValue, ResolutionTrace, FormalTemplateErrorCode,
  FormalTemplateFallbackReasonCode,
  GenerationPlan, RegionGenerationPlan, RenderResult, RegionRenderResult, PreviewRegionCandidate,
} from '../../../../src/types/templateGeneration'
import {
  buildDocumentBlocksFromText,
  cloneDocumentSchema,
  type DocumentBlock,
  type DocumentSchema,
} from '../../../../src/document/schema'
import {
  collectDocumentSchemaDocxSourceBlockIndices,
  compileDocumentSchemaToOoxmlBlocks,
  importDocumentSchemaFromOoxmlSnapshot,
  resolveDocumentSchemaDocumentSectionPropertiesXml,
} from '../documentSchemaDocxBoundary'
import {
  buildTemplateDocumentCommitArtifact,
} from '../../../../src/document/profiles/templateDocument/orchestrator/templateDocumentOrchestrator'

import { admit, extractBaselineShellFingerprint } from './templateAdmissionService'
import { createProfile, saveProfile, loadProfileByWorkCopy, updateProfile, mergeFieldValuesIntoProfile } from './templateProfileService'
import { extractFields } from './fieldExtractionService'
import { resolveFields, freezeUserOverrides } from './fieldResolutionService'
import { locateRegions, collectEditableBlockIndices } from './regionLocatorService'
import { generateRegionCandidate, type RegionGenerationInput } from './regionGenerationService'
import { validateShellIntegrity } from './shellValidationService'
import {
  buildVisitLetterCommitArtifacts,
} from './sampleAdapters/visitLetterTemplateSampleAdapter'
import {
  resolveFormalTemplateDefaultExecutionMode,
  resolveFormalTemplateLegacyFallbackMode,
  resolveFormalTemplateRoutingPlan,
} from './formalTemplateRoutingService'
import {
  analyzeVisitLetterSchemaTemplate,
  buildVisitLetterSchemaPreviewArtifacts,
  isVisitLetterSchemaProfile,
} from './visitLetterSchemaStrategyService'

// ---- 外部依赖注入接口 ----

/**
 * FormalTemplateTaskDeps — 编排器所需的外部依赖。
 * 由 index.ts 在初始化时注入，避免循环引用。
 */
export interface FormalTemplateTaskDeps {
  /** documentEngineService.readOoxmlPackage */
  readOoxmlPackage: (filePath: string) => Promise<OoxmlPackageSnapshot>
  /** documentEngineService.writeOoxmlPackage */
  writeOoxmlPackage: (filePath: string, payload: { blocks: OoxmlBlockSnapshot[]; documentSectionPropertiesXml?: string }) => Promise<{ success: boolean; filePath: string; paragraphCount: number; entryCount: number; created: boolean }>
  /** knowledgeService.getDocumentSourcePath — 获取知识库文档原始文件路径 */
  getDocumentSourcePath: (documentId: string) => Promise<string | null>
  /** knowledgeService.getDocumentMeta — 获取文档元信息 */
  getDocumentMeta: (documentId: string) => Promise<{ title: string; sourceType: string; documentCategory?: string } | null>
  /** knowledgeRetrievalService.retrieveChunks */
  retrieveChunks: (query: { query: string; referenceDocumentIds?: string[]; maxChunks?: number }) => Promise<KnowledgeRetrievalResult>
  /** settingsStore.getSettings */
  getSettings: () => Promise<AppSettings>
}

// ---- 编排器类 ----

export class FormalTemplateTaskService {
  constructor(private deps: FormalTemplateTaskDeps) {}

  // ============================ analyze ============================

  async analyze(request: AnalyzeFormalTemplateRequest): Promise<AnalyzeFormalTemplateResponse> {
    const trace = createTrace('analyze')

    try {
      // 1. 获取源文件路径
      addStep(trace, '获取知识库文档路径')
      const sourcePath = await this.deps.getDocumentSourcePath(request.knowledgeDocumentId)
      if (!sourcePath) {
        return fail(trace, 'FT_ADMISSION_INVALID_FORMAT', '未找到知识库文档源文件')
      }

      // 2. 准入校验 + 工作副本
      addStep(trace, '准入校验与工作副本创建')
      const workDir = `${request.workspacePath}/.formal-template`
      const admission = await admit(sourcePath, workDir, this.deps.readOoxmlPackage)
      if (!admission.admitted || !admission.baselineSnapshot || !admission.workCopyPath) {
        return fail(trace, admission.errorCode || 'FT_ADMISSION_INVALID_FORMAT', admission.errorMessage || '准入校验失败')
      }

      // 3. 样例适配 / 通用提取
      addStep(trace, '样例适配与结构抽取')
      const visitLetterProfileData = analyzeVisitLetterSchemaTemplate(admission.baselineSnapshot.blocks)
      const fields = visitLetterProfileData
        ? visitLetterProfileData.fields
        : extractFields(admission.baselineSnapshot.blocks)
      const regions = visitLetterProfileData
        ? visitLetterProfileData.regions
        : locateRegions(admission.baselineSnapshot.blocks)
      const routingPlan = visitLetterProfileData
        ? resolveFormalTemplateRoutingPlan({
            templateKind: visitLetterProfileData.templateKind,
            strategy: 'base-replace',
            legacyFallbackAdapter: 'visit-letter-sample-adapter',
          })
        : resolveFormalTemplateRoutingPlan({
            templateKind: 'generic',
            strategy: 'base-replace',
            legacyFallbackAdapter: 'legacy-ooxml-patch',
          })

      if (visitLetterProfileData) {
        addStep(trace, '命中 visit-letter schema-first 路由', visitLetterProfileData.templateKind)
      }

      if (regions.length === 0) {
        return fail(trace, 'FT_ADMISSION_NO_REGIONS', '模板中未检测到任何可用区域')
      }

      // 5. 获取文档元信息
      addStep(trace, '获取文档元信息')
      const meta = await this.deps.getDocumentMeta(request.knowledgeDocumentId)

      // 6. 创建并保存 Profile
      addStep(trace, '创建 TemplateProfile')
      const profile = createProfile({
        knowledgeDocumentId: request.knowledgeDocumentId,
        workCopyPath: admission.workCopyPath,
        sourceType: sourcePath.toLowerCase().endsWith('.doc') ? 'doc' : 'docx',
        title: meta?.title || '未命名模板',
        documentCategory: meta?.documentCategory as any,
        fields,
        regions,
        totalBlockCount: admission.baselineSnapshot.blockCount,
        routingPlan,
      })

      await saveProfile(profile)
      addStep(trace, 'Profile 已保存')

      return { success: true, profile, trace }
    } catch (error) {
      return fail(trace, 'FT_UNKNOWN', error instanceof Error ? error.message : String(error))
    }
  }

  // ============================ confirmFields ============================

  async confirmFields(request: ConfirmFormalTemplateFieldsRequest): Promise<ConfirmFormalTemplateFieldsResponse> {
    const trace = createTrace('confirm')

    try {
      // 1. 加载 Profile
      addStep(trace, '加载 Profile')
      const profile = await loadProfileByWorkCopy(request.workCopyPath, request.profileId)
      if (!profile || profile.profileId !== request.profileId) {
        return fail(trace, 'FT_UNKNOWN', '未找到匹配的 TemplateProfile')
      }

      // 2. 字段合并（当前无样本候选，直接用用户值）
      addStep(trace, '字段值合并')
      const resolution = resolveFields(profile.fields, request.fieldValues, [])

      if (resolution.missingRequiredFieldIds.length > 0) {
        return {
          success: false,
          invalidFieldIds: resolution.missingRequiredFieldIds,
          errorCode: 'FT_FIELD_MISSING_REQUIRED',
          errorMessage: `${resolution.missingRequiredFieldIds.length} 个必填字段未填写`,
          trace,
        }
      }

      // 3. 冻结用户确认的字段
      addStep(trace, '冻结用户确认字段')
      const frozenValues = freezeUserOverrides(
        resolution.resolvedValues,
        request.fieldValues.filter((fv: FieldValue) => fv.confirmed).map((fv: FieldValue) => fv.fieldId),
      )

      // 4. 将字段值写回工作副本 docx
      addStep(trace, '字段值写回 schema-first compiler')
      const currentSnapshot = await this.deps.readOoxmlPackage(request.workCopyPath)
      const schemaDocument = await hydrateFormalTemplateDocumentSchema(profile, currentSnapshot)
      const patchedDocument = applyFieldValuesToDocumentSchema(schemaDocument, profile.fields, frozenValues)
      const workspacePath = resolveFormalTemplateWorkspacePath(request.workCopyPath)
      const compiledBlocks = compileDocumentSchemaToOoxmlBlocks(patchedDocument, {
        workspacePath,
        resourceBasePath: workspacePath,
      })
      const writeResult = await this.deps.writeOoxmlPackage(request.workCopyPath, {
        blocks: compiledBlocks,
        documentSectionPropertiesXml: resolveDocumentSchemaDocumentSectionPropertiesXml(patchedDocument),
      })

      if (!writeResult.success) {
        return fail(trace, 'FT_OOXML_WRITE_FAILED', '字段值写回 OOXML 失败')
      }

      // 5. 更新 Profile
      addStep(trace, '更新 Profile')
      const updatedProfile = await updateProfile(
        mergeFieldValuesIntoProfile(profile, frozenValues),
        { totalBlockCount: compiledBlocks.length },
      )

      return { success: true, updatedProfile, trace }
    } catch (error) {
      return fail(trace, 'FT_UNKNOWN', error instanceof Error ? error.message : String(error))
    }
  }

  // ============================ preview ============================

  async preview(request: PreviewFormalTemplateTaskRequest): Promise<PreviewFormalTemplateTaskResponse> {
    const trace = createTrace('preview')

    try {
      // 1. 加载 Profile
      addStep(trace, '加载 Profile')
      const profile = await loadProfileByWorkCopy(request.workCopyPath, request.profileId)
      if (!profile || profile.profileId !== request.profileId) {
        return fail(trace, 'FT_UNKNOWN', '未找到匹配的 TemplateProfile')
      }

      const retrievalPreview: Array<{ regionId: string; hitCount: number; topHitSummary?: string }> = []
      const regionPlans: RegionGenerationPlan[] = []
      const retrievalResultByRegionId = new Map<string, KnowledgeRetrievalResult>()
      let pendingFieldIds: string[] = []
      let targetRegions: import('../../../../src/types/templateGeneration').TemplateRegion[] = []

      // 2. 样例模板合同 / 通用目标区域识别
      if (isVisitLetterSchemaProfile(profile)) {
        addStep(trace, '命中 visit-letter schema-first 合同规划', profile.routingPlan?.templateKind)
        const samplePreview = buildVisitLetterSchemaPreviewArtifacts({
          profile,
          fieldValues: request.fieldValues,
          instruction: request.instruction,
          referenceDocumentIds: request.referenceDocumentIds,
          sampleDocumentIds: request.sampleDocumentIds,
          retrievalMode: request.retrievalMode,
          targetRegionIds: request.targetRegionIds,
        })

        regionPlans.push(...samplePreview.plan.regionPlans)
        pendingFieldIds = samplePreview.plan.pendingFieldIds
        retrievalPreview.push(...samplePreview.retrievalPreview)

        const sampleRegionIds = new Set(regionPlans.map((plan) => plan.regionId))
        targetRegions = (profile.regions as import('../../../../src/types/templateGeneration').TemplateRegion[])
          .filter((region) => sampleRegionIds.has(region.regionId))
      } else {
        // 2. 筛选目标区域
        addStep(trace, '筛选目标区域')
        const targetRegionIds = request.targetRegionIds && request.targetRegionIds.length > 0
          ? new Set(request.targetRegionIds)
          : null
        targetRegions = (profile.regions as import('../../../../src/types/templateGeneration').TemplateRegion[]).filter((r) =>
          r.llmWritable && !r.shellLocked && (!targetRegionIds || targetRegionIds.has(r.regionId)),
        )

        if (targetRegions.length === 0) {
          addStep(trace, '未检测到需要生成的正文区域')
        }

        // 3. 为每个区域做检索预演
        addStep(trace, '参考材料检索预演')

        for (const region of targetRegions) {
          const retrieval = await this.deps.retrieveChunks({
            query: `${request.instruction} ${region.label}`.trim(),
            referenceDocumentIds: request.referenceDocumentIds,
            maxChunks: 8,
          }).catch(() => ({ hits: [], citations: [] }))

          retrievalResultByRegionId.set(region.regionId, retrieval)

          retrievalPreview.push({
            regionId: region.regionId,
            hitCount: retrieval.hits.length,
            topHitSummary: retrieval.hits[0]?.chunk.text.slice(0, 200),
          })

          const isEmpty = !region.originalText.trim()
          regionPlans.push({
            regionId: region.regionId,
            promptStrategy: isEmpty ? 'generate-body' : 'rewrite-body',
            retrievalConfig: {
              mode: request.retrievalMode,
              referenceDocumentIds: request.referenceDocumentIds,
              sampleDocumentIds: request.sampleDocumentIds,
              maxChunks: 8,
            },
          })
        }

        const previewFieldValueMap = new Map((request.fieldValues || []).map((fieldValue) => [fieldValue.fieldId, fieldValue.value]))
        pendingFieldIds = (profile.fields as import('../../../../src/types/templateGeneration').FieldSchema[])
          .filter((f) => f.required && !(previewFieldValueMap.get(f.fieldId) ?? f.defaultText).trim())
          .map((f) => f.fieldId)
      }

      // 4. 构建 GenerationPlan
      addStep(trace, '构建 GenerationPlan')

      const plan: GenerationPlan = {
        profileId: profile.profileId,
        regionPlans,
        pendingFieldIds,
      }

      const regionCandidates: PreviewRegionCandidate[] = []
      if (targetRegions.length > 0) {
        addStep(trace, '生成区域候选')
        const settings = await this.deps.getSettings()
        const fieldValues = request.fieldValues || []

        for (const region of targetRegions) {
          const planForRegion = regionPlans.find((item) => item.regionId === region.regionId)
          if (!planForRegion) continue

          const generated = await generateRegionCandidate(settings, {
            region,
            plan: planForRegion,
            templateTitle: profile.title,
            instruction: request.instruction,
            fieldValues,
            fieldSchemas: profile.fields,
            neighborContext: buildNeighborContext(profile.regions, region.regionId),
            retrievalResult: retrievalResultByRegionId.get(region.regionId),
          })

          regionCandidates.push({
            regionId: generated.regionId,
            label: region.label,
            candidateText: generated.candidateText,
          })
        }
      }

      return {
        success: true,
        plan,
        regionCandidate: regionCandidates[0],
        regionCandidates,
        retrievalPreview,
        trace,
      }
    } catch (error) {
      return fail(trace, 'FT_PREVIEW_BUILD_FAILED', error instanceof Error ? error.message : String(error))
    }
  }

  // ============================ commit ============================

  async commit(request: CommitFormalTemplateTaskRequest): Promise<CommitFormalTemplateTaskResponse> {
    const trace = createTrace('commit')

    try {
      // 1. 加载 Profile
      addStep(trace, '加载 Profile')
      const profile = await loadProfileByWorkCopy(request.workCopyPath, request.profileId)
      if (!profile || profile.profileId !== request.profileId) {
        return fail(trace, 'FT_UNKNOWN', '未找到匹配的 TemplateProfile')
      }

      // 2. 取写回前基线快照
      addStep(trace, '取写回前基线快照')
      const beforeSnapshot = await this.deps.readOoxmlPackage(request.workCopyPath)
      const defaultExecutionMode = resolveFormalTemplateDefaultExecutionMode(profile)
      addStep(trace, 'formal template route 决策', `${defaultExecutionMode.templateKind}/${defaultExecutionMode.strategy}`)

      const schemaFirstResult = await commitWithSchemaCompiler(this.deps, profile, request, trace)
      if (schemaFirstResult.ok) {
        return schemaFirstResult.response
      }

      addStep(
        trace,
        'schema-first 主链失败，评估显式 legacy fallback',
        `${schemaFirstResult.reasonCode}: ${schemaFirstResult.reason}`,
      )
      const fallbackMode = resolveFormalTemplateLegacyFallbackMode({
        profile,
        reasonCode: schemaFirstResult.reasonCode,
        reason: schemaFirstResult.reason,
      })

      if (!fallbackMode) {
        return fail(
          trace,
          mapFallbackReasonCodeToErrorCode(schemaFirstResult.reasonCode),
          `schema-first 主链失败，且当前模板未配置 legacy fallback: ${schemaFirstResult.reason}`,
        )
      }

      if (fallbackMode.fallbackAdapter === 'visit-letter-sample-adapter') {
        return commitWithVisitLetterLegacyFallback(this.deps, profile, request, trace, beforeSnapshot, fallbackMode)
      }

      if (fallbackMode.fallbackAdapter === 'legacy-ooxml-patch') {
        return commitWithLegacyOoxmlPatch(this.deps, profile, request, trace, beforeSnapshot, fallbackMode)
      }

      return fail(trace, 'FT_UNKNOWN', `未支持的 legacy fallback adapter: ${fallbackMode.fallbackAdapter}`)
    } catch (error) {
      return fail(trace, 'FT_UNKNOWN', error instanceof Error ? error.message : String(error))
    }
  }
}

// ========================== 内部工具函数 ==========================

const TEMPLATE_DOCUMENT_REGION_ID_METADATA_KEY = 'templateRegionId'
const TEMPLATE_DOCUMENT_REGION_LABEL_METADATA_KEY = 'templateRegionLabel'
const TEMPLATE_DOCUMENT_REGION_INDEX_METADATA_KEY = 'templateRegionIndex'
const TEMPLATE_DOCUMENT_REGION_EDITABLE_METADATA_KEY = 'templateRegionEditable'
const TEMPLATE_DOCUMENT_FIELD_ID_METADATA_KEY = 'templateFieldId'
const TEMPLATE_DOCUMENT_FIELD_LABEL_METADATA_KEY = 'templateFieldLabel'

function resolveFormalTemplateWorkspacePath(workCopyPath: string): string {
  return path.dirname(path.dirname(workCopyPath))
}

function overlapsSourceRange(sourceIndices: number[], start: number, end: number): boolean {
  return sourceIndices.some((index) => index >= start && index < end)
}

function replaceFieldPlaceholders(text: string | undefined, label: string, value: string): string | undefined {
  if (!text) return text
  return text.replace(new RegExp(`\\{\\{\\s*${escapeRegex(label)}\\s*\\}\\}`, 'g'), value)
}

function annotateTemplateBindings(document: DocumentSchema, profile: TemplateProfile): DocumentSchema {
  const cloned = cloneDocumentSchema(document)
  cloned.blocks = cloned.blocks.map((block) => {
    const sourceIndices = collectDocumentSchemaDocxSourceBlockIndices(block)
    const matchedRegion = sourceIndices.length > 0
      ? (profile.regions as import('../../../../src/types/templateGeneration').TemplateRegion[]).find((region, index) => overlapsSourceRange(sourceIndices, region.blockRange.start, region.blockRange.end) ? index >= 0 : false)
      : undefined
    const matchedField = sourceIndices.length > 0
      ? (profile.fields as import('../../../../src/types/templateGeneration').FieldSchema[]).find((field) => field.blockIndices.some((index) => sourceIndices.includes(index)))
      : undefined

    if (!matchedRegion && !matchedField) return block

    return {
      ...block,
      metadata: {
        ...(block.metadata || {}),
        ...(matchedRegion ? {
          [TEMPLATE_DOCUMENT_REGION_ID_METADATA_KEY]: matchedRegion.regionId,
          [TEMPLATE_DOCUMENT_REGION_LABEL_METADATA_KEY]: matchedRegion.label,
          [TEMPLATE_DOCUMENT_REGION_INDEX_METADATA_KEY]: profile.regions.findIndex((region) => region.regionId === matchedRegion.regionId),
          [TEMPLATE_DOCUMENT_REGION_EDITABLE_METADATA_KEY]: matchedRegion.llmWritable && !matchedRegion.shellLocked,
        } : {}),
        ...(matchedField ? {
          [TEMPLATE_DOCUMENT_FIELD_ID_METADATA_KEY]: matchedField.fieldId,
          [TEMPLATE_DOCUMENT_FIELD_LABEL_METADATA_KEY]: matchedField.label,
        } : {}),
      },
    }
  })
  return cloned
}

async function hydrateFormalTemplateDocumentSchema(
  profile: TemplateProfile,
  snapshot: OoxmlPackageSnapshot,
): Promise<DocumentSchema> {
  const workspacePath = resolveFormalTemplateWorkspacePath(profile.workCopyPath)
  const imported = await importDocumentSchemaFromOoxmlSnapshot(
    workspacePath,
    profile.workCopyPath,
    snapshot,
    {
      profile: 'templateDocument',
      metadata: {
        formalTemplateProfileId: profile.profileId,
      },
      templateHints: {
        docxTemplateMode: 'base-replace',
        templateContract: {
          kind: 'formal-template',
          mode: 'base-replace',
          preserveShell: true,
          legacyFallback: 'ooxml-block-patch',
        },
      },
    },
  )
  return annotateTemplateBindings(imported, profile)
}

function applyFieldValuesToDocumentSchema(
  document: DocumentSchema,
  fields: import('../../../../src/types/templateGeneration').FieldSchema[],
  fieldValues: FieldValue[],
): DocumentSchema {
  const valueMap = new Map(fieldValues.map((fieldValue) => [fieldValue.fieldId, fieldValue.value]))
  const cloned = cloneDocumentSchema(document)
  const sampleAdapterFieldTextOverrides = resolveSampleAdapterFieldTextOverrides(cloned, fields, valueMap)

  cloned.blocks = cloned.blocks.map((block) => {
    const sourceIndices = collectDocumentSchemaDocxSourceBlockIndices(block)
    if (!sourceIndices.length) return block

    let nextBlock: DocumentBlock = block
    for (const field of fields) {
      const replacementValue = valueMap.get(field.fieldId)
      if (replacementValue === undefined) continue
      if (!field.blockIndices.some((index) => sourceIndices.includes(index))) continue

      const nextText = replaceFieldPlaceholders(nextBlock.text, field.label, replacementValue)
      if (typeof nextText === 'string' && nextText !== nextBlock.text) {
        nextBlock = {
          ...nextBlock,
          text: nextText,
        }
      }

      if (nextBlock.type === 'slot' && nextBlock.value && typeof nextBlock.value === 'object') {
        nextBlock = {
          ...nextBlock,
          value: {
            ...(nextBlock.value as Record<string, unknown>),
            text: replacementValue,
          },
        }
      }
    }

    const directTextOverride = resolveBlockTextOverride(sourceIndices, sampleAdapterFieldTextOverrides)
    if (typeof directTextOverride === 'string' && directTextOverride !== nextBlock.text) {
      nextBlock = {
        ...nextBlock,
        text: directTextOverride,
      }
      if (nextBlock.type === 'slot' && nextBlock.value && typeof nextBlock.value === 'object') {
        nextBlock = {
          ...nextBlock,
          value: {
            ...(nextBlock.value as Record<string, unknown>),
            text: directTextOverride,
          },
        }
      }
    }

    return nextBlock
  })

  return cloned
}

function resolveSampleAdapterFieldTextOverrides(
  document: DocumentSchema,
  fields: import('../../../../src/types/templateGeneration').FieldSchema[],
  valueMap: Map<string, string>,
): Map<number, string> {
  const overrides = new Map<number, string>()
  const templateKind = resolveSampleAdapterTemplateKind(fields)
  if (!templateKind) return overrides

  if (templateKind === 'congratulation-letter') {
    const recipientField = findFieldBySuffix(fields, '-recipient')
    const senderField = findFieldBySuffix(fields, '-sender')
    const dateField = findFieldBySuffix(fields, '-letter-date')
    const recipient = resolveFieldValue(recipientField, valueMap)
    const sender = resolveFieldValue(senderField, valueMap)
    const date = resolveFieldValue(dateField, valueMap)
    const senderTemplateText = senderField ? resolveSourceTemplateText(document, senderField.blockIndices[0]) : ''

    if (recipientField?.blockIndices[0] !== undefined) {
      overrides.set(recipientField.blockIndices[0], `${stripTrailingColon(recipient) || '贵方'}：`)
    }
    if (senderField?.blockIndices[0] !== undefined) {
      overrides.set(senderField.blockIndices[0], renderCongratulationSenderBlockText(senderTemplateText, sender))
    }
    if (dateField?.blockIndices[0] !== undefined) {
      overrides.set(dateField.blockIndices[0], date)
    }
    return overrides
  }

  const recipientField = findFieldBySuffix(fields, '-recipient')
  const contactPersonField = findFieldBySuffix(fields, '-contact-person')
  const contactPhoneField = findFieldBySuffix(fields, '-contact-phone')
  const dateField = findFieldBySuffix(fields, '-letter-date')

  if (recipientField?.blockIndices[0] !== undefined) {
    overrides.set(recipientField.blockIndices[0], `${stripTrailingColon(resolveFieldValue(recipientField, valueMap) || '陕西省招生办公室')}：`)
  }
  if (contactPersonField?.blockIndices[0] !== undefined) {
    overrides.set(
      contactPersonField.blockIndices[0],
      `联系人：${resolveFieldValue(contactPersonField, valueMap) || '朱**老师'} 手机：${resolveFieldValue(contactPhoneField, valueMap) || '188********'}。`,
    )
  }
  if (dateField?.blockIndices[0] !== undefined) {
    overrides.set(dateField.blockIndices[0], resolveFieldValue(dateField, valueMap) || '二〇一七年十月二十五日')
  }

  return overrides
}

function resolveSampleAdapterTemplateKind(
  fields: import('../../../../src/types/templateGeneration').FieldSchema[],
): 'visit-letter' | 'congratulation-letter' | null {
  if (!fields.some((field) => field.sourceKind === 'sample-adapter')) return null
  if (fields.some((field) => field.fieldId.endsWith('-sender') || field.fieldId.endsWith('-theme'))) {
    return 'congratulation-letter'
  }
  return 'visit-letter'
}

function findFieldBySuffix(
  fields: import('../../../../src/types/templateGeneration').FieldSchema[],
  suffix: string,
): import('../../../../src/types/templateGeneration').FieldSchema | undefined {
  return fields.find((field) => field.fieldId.endsWith(suffix))
}

function resolveFieldValue(
  field: import('../../../../src/types/templateGeneration').FieldSchema | undefined,
  valueMap: Map<string, string>,
): string {
  if (!field) return ''
  return valueMap.get(field.fieldId) ?? field.defaultText ?? ''
}

function resolveSourceTemplateText(document: DocumentSchema, sourceBlockIndex: number | undefined): string {
  if (!Number.isInteger(sourceBlockIndex)) return ''
  const matchedBlock = document.blocks.find((block) => collectDocumentSchemaDocxSourceBlockIndices(block).includes(sourceBlockIndex as number))
  return String(matchedBlock?.text || '')
}

function resolveBlockTextOverride(sourceIndices: number[], overrides: Map<number, string>): string | undefined {
  for (const sourceIndex of sourceIndices) {
    const override = overrides.get(sourceIndex)
    if (typeof override === 'string') return override
  }
  return undefined
}

function stripTrailingColon(value: string): string {
  return String(value || '').trim().replace(/[：:]+$/, '')
}

function renderCongratulationSenderBlockText(templateText: string, sender: string): string {
  const normalizedSender = String(sender || '').trim().replace(/[，。；]+$/g, '')
  if (!normalizedSender) return String(templateText || '').trim()
  const signatureSchool = '香港中文大学（深圳）'
  if (!normalizedSender.includes(signatureSchool) || !String(templateText || '').includes(signatureSchool)) {
    return normalizedSender
  }

  const officePart = normalizedSender.replace(signatureSchool, '').trim()
  if (!officePart) return signatureSchool

  const spacing = String(templateText || '').match(/香港中文大学（深圳）([\s\u00A0]+)/)?.[1] || ' '
  return `${signatureSchool}${spacing}${officePart}`
}

function resolveSchemaRegionRange(
  blocks: DocumentBlock[],
  regionId: string,
): { start: number; end: number; templateBlocks: DocumentBlock[] } | null {
  const indices = blocks.reduce<number[]>((matched, block, index) => {
    if (block.metadata?.[TEMPLATE_DOCUMENT_REGION_ID_METADATA_KEY] === regionId) matched.push(index)
    return matched
  }, [])

  if (!indices.length) return null
  const start = Math.min(...indices)
  const end = Math.max(...indices) + 1
  return {
    start,
    end,
    templateBlocks: blocks.slice(start, end),
  }
}

function inheritTemplateBlockMetadata(templateBlocks: DocumentBlock[], replacementBlocks: DocumentBlock[]): DocumentBlock[] {
  if (!templateBlocks.length) return replacementBlocks
  return replacementBlocks.map((block, index) => {
    const templateBlock = templateBlocks[Math.min(index, templateBlocks.length - 1)]
    return {
      ...block,
      styleRef: block.styleRef || templateBlock.styleRef,
      metadata: {
        ...(templateBlock.metadata || {}),
        ...(block.metadata || {}),
      },
    }
  })
}

function annotateRegionBlocks(
  blocks: DocumentBlock[],
  region: import('../../../../src/types/templateGeneration').TemplateRegion,
  regionIndex: number,
): DocumentBlock[] {
  return blocks.map((block) => ({
    ...block,
    metadata: {
      ...(block.metadata || {}),
      [TEMPLATE_DOCUMENT_REGION_ID_METADATA_KEY]: region.regionId,
      [TEMPLATE_DOCUMENT_REGION_LABEL_METADATA_KEY]: region.label,
      [TEMPLATE_DOCUMENT_REGION_INDEX_METADATA_KEY]: regionIndex,
      [TEMPLATE_DOCUMENT_REGION_EDITABLE_METADATA_KEY]: region.llmWritable && !region.shellLocked,
    },
  }))
}

function applyRegionPatchesToDocumentSchema(
  document: DocumentSchema,
  profile: TemplateProfile,
  regionPatches: CommitFormalTemplateTaskRequest['regionPatches'],
): { ok: true; document: DocumentSchema; replacementRanges: Array<{ start: number; end: number; replacementLength: number }> } | { ok: false; reason: string } {
  const cloned = cloneDocumentSchema(document)
  const replacementRanges: Array<{ start: number; end: number; replacementLength: number }> = []

  for (const patch of [...regionPatches]) {
    const regionIndex = profile.regions.findIndex((region) => region.regionId === patch.regionId)
    const region = regionIndex >= 0 ? profile.regions[regionIndex] : null
    if (!region || region.shellLocked) continue

    const range = resolveSchemaRegionRange(cloned.blocks, patch.regionId)
    if (!range) {
      return { ok: false, reason: `未找到 region ${patch.regionId} 对应的 schema block 范围` }
    }

    const builtBlocks = buildDocumentBlocksFromText({
      text: resolveRegionPatchText(patch),
      blockIdPrefix: `template-region-${regionIndex + 1}`,
    })
    const inheritedBlocks = inheritTemplateBlockMetadata(range.templateBlocks, builtBlocks)
    const annotatedBlocks = annotateRegionBlocks(inheritedBlocks, region as import('../../../../src/types/templateGeneration').TemplateRegion, regionIndex)
    cloned.blocks.splice(range.start, range.end - range.start, ...annotatedBlocks)
    replacementRanges.push({
      start: region.blockRange.start,
      end: region.blockRange.end,
      replacementLength: annotatedBlocks.length,
    })
  }

  return { ok: true, document: cloned, replacementRanges }
}

function resolveRegionPatchText(
  patch: CommitFormalTemplateTaskRequest['regionPatches'][number],
): string {
  if (Array.isArray(patch.finalParagraphs) && patch.finalParagraphs.length > 0) {
    return patch.finalParagraphs
      .map((paragraph) => String(paragraph || '').trim())
      .filter(Boolean)
      .join('\n\n')
  }
  return patch.finalText
}

function collectEditableFieldBlockIndices(fields: import('../../../../src/types/templateGeneration').FieldSchema[]): number[] {
  return Array.from(new Set(fields.flatMap((field) => field.blockIndices))).sort((left, right) => left - right)
}

function buildSchemaCommitArtifact(profile: TemplateProfile, result: RenderResult, document: DocumentSchema) {
  return buildTemplateDocumentCommitArtifact({
    artifactId: `templateDocument:${profile.profileId}:commit`,
    templateDocumentId: profile.knowledgeDocumentId,
    templateTitle: profile.title,
    outputPath: result.outputPath,
    fieldValues: result.fieldValues,
    fieldLabels: Object.fromEntries(profile.fields.map((field) => [field.fieldId, field.label || field.fieldId])),
    regionResults: result.regionResults,
    regionLabels: Object.fromEntries(profile.regions.map((region) => [region.regionId, region.label || region.regionId])),
    documentOverride: document,
  })
}

type SchemaCommitAttemptResult =
  | {
      ok: true
      response: CommitFormalTemplateTaskResponse
    }
  | {
      ok: false
      reasonCode: FormalTemplateFallbackReasonCode
      reason: string
    }

async function commitWithSchemaCompiler(
  deps: FormalTemplateTaskDeps,
  profile: TemplateProfile,
  request: CommitFormalTemplateTaskRequest,
  trace: ResolutionTrace,
): Promise<SchemaCommitAttemptResult> {
  addStep(trace, 'schema-first 模板编译准备')
  const beforeSnapshot = await deps.readOoxmlPackage(request.workCopyPath)

  let schemaDocument: DocumentSchema
  try {
    schemaDocument = await hydrateFormalTemplateDocumentSchema(profile, beforeSnapshot)
  } catch (error) {
    return {
      ok: false,
      reasonCode: 'schema-hydration-failed',
      reason: error instanceof Error ? error.message : String(error),
    }
  }

  const fieldsAppliedDocument = applyFieldValuesToDocumentSchema(schemaDocument, profile.fields, request.fieldValues)
  const patchedDocumentResult = applyRegionPatchesToDocumentSchema(fieldsAppliedDocument, profile, request.regionPatches)

  if (!patchedDocumentResult.ok) {
    return {
      ok: false,
      reasonCode: 'schema-region-mapping-failed',
      reason: patchedDocumentResult.reason,
    }
  }

  addStep(trace, 'schema-first DOCX boundary compile (base-replace)')
  const workspacePath = resolveFormalTemplateWorkspacePath(request.workCopyPath)

  let compiledBlocks: OoxmlBlockSnapshot[]
  try {
    compiledBlocks = compileDocumentSchemaToOoxmlBlocks(patchedDocumentResult.document, {
      workspacePath,
      resourceBasePath: workspacePath,
    })
  } catch (error) {
    return {
      ok: false,
      reasonCode: 'schema-compile-failed',
      reason: error instanceof Error ? error.message : String(error),
    }
  }

  addStep(trace, 'OOXML 写回')
  const writeResult = await deps.writeOoxmlPackage(request.workCopyPath, {
    blocks: compiledBlocks,
    documentSectionPropertiesXml: resolveDocumentSchemaDocumentSectionPropertiesXml(patchedDocumentResult.document),
  })

  if (!writeResult.success) {
    return {
      ok: false,
      reasonCode: 'schema-write-failed',
      reason: 'schema-first DOCX compiler 写回失败',
    }
  }

  addStep(trace, '壳层校验')
  const afterSnapshot = await deps.readOoxmlPackage(request.workCopyPath)
  const changedIndices = collectChangedIndices(beforeSnapshot.blocks, afterSnapshot.blocks)
  const shellValidation = validateShellIntegrity(beforeSnapshot, afterSnapshot, profile.regions, {
    extraEditableBlockIndices: collectEditableFieldBlockIndices(profile.fields),
    replacementRanges: patchedDocumentResult.replacementRanges,
  })

  if (!shellValidation.passed) {
    return {
      ok: false,
      reasonCode: 'schema-shell-validation-failed',
      reason: shellValidation.errorMessage || 'schema-first 模板壳层校验失败',
    }
  }

  const regionResults: RegionRenderResult[] = request.regionPatches.map((patch) => ({
    regionId: patch.regionId,
    candidateText: patch.finalText,
    committed: true,
  }))

  const result: RenderResult = {
    profileId: profile.profileId,
    outputPath: request.workCopyPath,
    documentArtifact: undefined,
    executionMode: resolveFormalTemplateDefaultExecutionMode(profile),
    regionResults,
    fieldValues: request.fieldValues,
    changedIndices,
    allCommitted: true,
    shellValidation,
  }
  result.documentArtifact = buildSchemaCommitArtifact(profile, result, patchedDocumentResult.document)

  addStep(trace, 'schema-first commit 完成')
  return { ok: true, response: { success: true, result, trace } }
}

async function commitWithVisitLetterLegacyFallback(
  deps: FormalTemplateTaskDeps,
  profile: TemplateProfile,
  request: CommitFormalTemplateTaskRequest,
  trace: ResolutionTrace,
  beforeSnapshot: OoxmlPackageSnapshot,
  executionMode: Extract<RenderResult['executionMode'], { mode: 'legacy-fallback' }>,
): Promise<CommitFormalTemplateTaskResponse> {
  addStep(trace, '执行 visit-letter legacy fallback', `${executionMode.reasonCode}: ${executionMode.reason}`)
  const sampleCommit = buildVisitLetterCommitArtifacts({
    profile,
    blocks: beforeSnapshot.blocks,
    instruction: request.instruction,
    fieldValues: request.fieldValues,
    regionPatches: request.regionPatches,
  })

  if (!sampleCommit.ok) {
    return fail(trace, sampleCommit.errorCode, sampleCommit.errorMessage)
  }

  addStep(trace, 'OOXML 写回')
  const writeResult = await deps.writeOoxmlPackage(request.workCopyPath, { blocks: sampleCommit.patchedBlocks })
  if (!writeResult.success) {
    return fail(trace, 'FT_OOXML_WRITE_FAILED', 'visit-letter legacy fallback 写回失败')
  }

  addStep(trace, '壳层校验')
  const afterSnapshot = await deps.readOoxmlPackage(request.workCopyPath)
  const changedIndices = collectChangedIndices(beforeSnapshot.blocks, afterSnapshot.blocks)
  const shellValidation = validateShellIntegrity(beforeSnapshot, afterSnapshot, profile.regions, {
    extraEditableBlockIndices: sampleCommit.extraEditableBlockIndices,
  })

  if (!shellValidation.passed) {
    return fail(trace, 'FT_SHELL_INTEGRITY_VIOLATED', shellValidation.errorMessage || 'visit-letter legacy fallback 壳层校验失败')
  }

  for (const regionResult of sampleCommit.regionResults) {
    regionResult.committed = true
  }

  addStep(trace, '全部完成')
  return {
    success: true,
    result: {
      profileId: profile.profileId,
      outputPath: request.workCopyPath,
      executionMode,
      regionResults: sampleCommit.regionResults,
      fieldValues: sampleCommit.resolvedFieldValues,
      changedIndices,
      allCommitted: true,
      shellValidation,
    },
    trace,
  }
}

async function commitWithLegacyOoxmlPatch(
  deps: FormalTemplateTaskDeps,
  profile: TemplateProfile,
  request: CommitFormalTemplateTaskRequest,
  trace: ResolutionTrace,
  beforeSnapshot: OoxmlPackageSnapshot,
  executionMode: Extract<RenderResult['executionMode'], { mode: 'legacy-fallback' }>,
): Promise<CommitFormalTemplateTaskResponse> {
  addStep(trace, '执行 legacy OOXML patch fallback', `${executionMode.reasonCode}: ${executionMode.reason}`)

  addStep(trace, '应用字段值')
  let patchedBlocks = applyFieldValuesToBlocks(beforeSnapshot.blocks, profile.fields, request.fieldValues)

  addStep(trace, '应用区域 patches')
  const resolvedRegionPatches = request.regionPatches
    .map((patch) => {
      const region = (profile.regions as import('../../../../src/types/templateGeneration').TemplateRegion[]).find((r) => r.regionId === patch.regionId)
      if (!region || region.shellLocked) return null

      return {
        patch,
        region,
        newBlocks: textToBlocks(patch.finalText, region.blockRange.start),
      }
    })
    .filter((item): item is {
      patch: CommitFormalTemplateTaskRequest['regionPatches'][number]
      region: import('../../../../src/types/templateGeneration').TemplateRegion
      newBlocks: OoxmlBlockSnapshot[]
    } => Boolean(item))

  const regionResults: RegionRenderResult[] = resolvedRegionPatches.map(({ patch }) => ({
    regionId: patch.regionId,
    candidateText: patch.finalText,
    committed: false,
  }))

  for (const { region, newBlocks } of [...resolvedRegionPatches].sort(
    (left, right) => right.region.blockRange.start - left.region.blockRange.start,
  )) {
    patchedBlocks = replaceBlockRange(patchedBlocks, region.blockRange.start, region.blockRange.end, newBlocks)
  }

  addStep(trace, 'OOXML 写回')
  const writeResult = await deps.writeOoxmlPackage(request.workCopyPath, { blocks: patchedBlocks })
  if (!writeResult.success) {
    return fail(trace, 'FT_OOXML_WRITE_FAILED', 'legacy OOXML patch fallback 写回失败')
  }

  addStep(trace, '壳层校验')
  const afterSnapshot = await deps.readOoxmlPackage(request.workCopyPath)
  const changedIndices = collectChangedIndices(beforeSnapshot.blocks, afterSnapshot.blocks)
  const shellValidation = validateShellIntegrity(beforeSnapshot, afterSnapshot, profile.regions, {
    replacementRanges: resolvedRegionPatches.map(({ region, newBlocks }) => ({
      start: region.blockRange.start,
      end: region.blockRange.end,
      replacementLength: newBlocks.length,
    })),
  })

  if (!shellValidation.passed) {
    return fail(trace, 'FT_SHELL_INTEGRITY_VIOLATED', shellValidation.errorMessage || 'legacy OOXML patch fallback 壳层校验失败')
  }

  for (const rr of regionResults) {
    rr.committed = true
  }

  addStep(trace, '全部完成')
  return {
    success: true,
    result: {
      profileId: profile.profileId,
      outputPath: request.workCopyPath,
      executionMode,
      regionResults,
      fieldValues: request.fieldValues,
      changedIndices,
      allCommitted: true,
      shellValidation,
    },
    trace,
  }
}

function mapFallbackReasonCodeToErrorCode(reasonCode: FormalTemplateFallbackReasonCode): FormalTemplateErrorCode {
  switch (reasonCode) {
    case 'schema-region-mapping-failed':
    case 'unsupported-template-structure':
    case 'schema-contract-missing':
      return 'FT_ADMISSION_NO_REGIONS'
    case 'schema-write-failed':
      return 'FT_OOXML_WRITE_FAILED'
    case 'schema-shell-validation-failed':
      return 'FT_SHELL_INTEGRITY_VIOLATED'
    case 'schema-hydration-failed':
    case 'schema-compile-failed':
    default:
      return 'FT_UNKNOWN'
  }
}

/**
 * applyFieldValuesToBlocks — 将字段值替换进对应 blocks 的文本中
 * 只处理 {{占位符}} 模式，sdt 内容控件在 V1.1 支持
 */
function applyFieldValuesToBlocks(
  blocks: OoxmlBlockSnapshot[],
  fields: import('../../../../src/types/templateGeneration').FieldSchema[],
  fieldValues: FieldValue[],
): OoxmlBlockSnapshot[] {
  const valueMap = new Map(fieldValues.map((fv) => [fv.fieldId, fv.value]))
  const fieldByBlock = new Map<number, Array<{ label: string; value: string }>>()

  for (const field of fields) {
    const value = valueMap.get(field.fieldId)
    if (value === undefined) continue
    for (const idx of field.blockIndices) {
      const existing = fieldByBlock.get(idx) || []
      existing.push({ label: field.label, value })
      fieldByBlock.set(idx, existing)
    }
  }

  return blocks.map((block) => {
    const replacements = fieldByBlock.get(block.index)
    if (!replacements || replacements.length === 0) return block

    let text = block.text
    let sourceXml = block.sourceXml
    for (const { label, value } of replacements) {
      const pattern = new RegExp(`\\{\\{\\s*${escapeRegex(label)}\\s*\\}\\}`, 'g')
      text = text.replace(pattern, value)
      if (sourceXml) {
        sourceXml = sourceXml.replace(pattern, escapeXmlText(value))
      }
    }

    return { ...block, text, sourceXml }
  })
}

function buildNeighborContext(
  regions: import('../../../../src/types/templateGeneration').TemplateRegion[],
  currentRegionId: string,
): string | undefined {
  const currentIndex = regions.findIndex((region) => region.regionId === currentRegionId)
  if (currentIndex < 0) return undefined

  const neighborSections: string[] = []
  const previousRegion = regions[currentIndex - 1]
  const nextRegion = regions[currentIndex + 1]

  if (previousRegion?.originalText.trim()) {
    neighborSections.push(`前一区域（${previousRegion.label}）:\n${previousRegion.originalText.trim().slice(0, 400)}`)
  }
  if (nextRegion?.originalText.trim()) {
    neighborSections.push(`后一区域（${nextRegion.label}）:\n${nextRegion.originalText.trim().slice(0, 400)}`)
  }

  return neighborSections.length > 0 ? neighborSections.join('\n\n') : undefined
}

function collectChangedIndices(beforeBlocks: OoxmlBlockSnapshot[], afterBlocks: OoxmlBlockSnapshot[]): number[] {
  const maxLength = Math.max(beforeBlocks.length, afterBlocks.length)
  const changed = new Set<number>()

  for (let index = 0; index < maxLength; index += 1) {
    const before = beforeBlocks[index]
    const after = afterBlocks[index]
    if (!before || !after) {
      changed.add(index)
      continue
    }
    if (before.kind !== after.kind || before.text !== after.text || before.sourceId !== after.sourceId) {
      changed.add(index)
    }
  }

  return Array.from(changed).sort((left, right) => left - right)
}

function deriveImageLabel(source: string): string {
  const normalized = String(source || '').trim().replace(/\\/g, '/')
  const lastSegment = normalized.split('/').filter(Boolean).pop() || normalized
  return lastSegment.replace(/\.[^.]+$/g, '').trim() || 'image'
}

/**
 * textToBlocks — 将候选文本转成最小可写回 blocks。
 * 当前至少保留 heading / image-placeholder / paragraph 三类，避免局部 commit 把图片 markdown 写成普通文字。
 */
function textToBlocks(text: string, startIndex: number): OoxmlBlockSnapshot[] {
  const lines = String(text || '').replace(/\r/g, '').split(/\n+/).map((line) => line.trim()).filter(Boolean)
  return lines.map((line, i) => {
    const index = startIndex + i
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      return {
        index,
        kind: 'heading' as const,
        text: headingMatch[2].trim(),
        level: headingMatch[1].length,
      }
    }

    const markdownImageMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
    if (markdownImageMatch) {
      const alt = markdownImageMatch[1].trim()
      const resourceRef = markdownImageMatch[2].trim()
      const label = alt || deriveImageLabel(resourceRef)
      return {
        index,
        kind: 'image-placeholder' as const,
        text: label,
        alt: label,
        previewSrc: resourceRef.startsWith('data:') ? resourceRef : undefined,
        mediaPath: /^word\/media\//i.test(resourceRef) ? resourceRef : undefined,
        sourceId: resourceRef,
      }
    }

    const imagePlaceholderMatch = line.match(/^\[图片占位:\s*(.*?)\]$/)
    if (imagePlaceholderMatch) {
      const label = imagePlaceholderMatch[1].trim() || 'image'
      return {
        index,
        kind: 'image-placeholder' as const,
        text: label,
        alt: label,
      }
    }

    const formulaMatch = line.match(/^\[公式占位:\s*(.*?)\]$/)
    if (formulaMatch) {
      const latex = formulaMatch[1].trim() || '公式'
      return {
        index,
        kind: 'formula-placeholder' as const,
        text: latex,
        latex,
      }
    }

    const tableMatch = line.match(/^\[表格占位:\s*(\d+)x(\d+)\]$/)
    if (tableMatch) {
      const rows = Number(tableMatch[1])
      const columns = Number(tableMatch[2])
      return {
        index,
        kind: 'table-placeholder' as const,
        text: `表格占位 ${rows}x${columns}`,
        rows,
        columns,
        cells: Array.from({ length: rows }, () => Array.from({ length: columns }, () => '')),
      }
    }

    return {
      index,
      kind: 'paragraph' as const,
      text: line,
    }
  })
}

/**
 * replaceBlockRange — 替换 blocks 数组中指定范围
 * 替换后需重新编号 index
 */
function replaceBlockRange(
  blocks: OoxmlBlockSnapshot[],
  start: number,
  end: number,
  replacement: OoxmlBlockSnapshot[],
): OoxmlBlockSnapshot[] {
  const before = blocks.slice(0, start)
  const after = blocks.slice(end)
  const merged = [...before, ...replacement, ...after]
  return merged.map((block, i) => ({ ...block, index: i }))
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** XML 文本节点转义 — 防止字段值中的 &<>" 破坏 XML 结构 */
function escapeXmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ========================== Trace 工具 ==========================

function createTrace(phase: ResolutionTrace['phase']): ResolutionTrace {
  return {
    timestamp: new Date().toISOString(),
    traceId: `ft-${phase}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    phase,
    steps: [],
  }
}

function addStep(trace: ResolutionTrace, label: string, detail?: string): void {
  trace.steps.push({ label, durationMs: undefined, detail })
}

function fail<T extends { success: boolean; trace: ResolutionTrace; errorCode?: FormalTemplateErrorCode; errorMessage?: string }>(
  trace: ResolutionTrace,
  errorCode: FormalTemplateErrorCode,
  errorMessage: string,
): T {
  trace.error = { code: errorCode, message: errorMessage }
  return { success: false, errorCode, errorMessage, trace } as T
}
