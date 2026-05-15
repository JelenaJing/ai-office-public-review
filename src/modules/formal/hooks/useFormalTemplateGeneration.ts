// vNext freeze: this hook is the current template-document front-end orchestrator.
// Commit write-back stays in the formal template task service and is intentionally frozen.
import { useCallback, useMemo } from 'react'
import { useFormalTemplateSession } from '../contexts/FormalTemplateSessionContext'
import { useGenerationWorkbench } from '../../../contexts/GenerationWorkbenchContext'
import { useKnowledge } from '../../../contexts/KnowledgeContext'
import { useWorkspace } from '../../../contexts/WorkspaceContext'
import type { DocumentArtifact, DocumentPatch } from '../../../document/core'
import {
  createTemplateDocumentArtifactContext,
  prepareTemplateDocumentEditCommit,
} from '../../../document/commands/bridges/templateDocumentRewriteBridge'
import { attachTemplateDocumentArtifact } from '../../../document/profiles/templateDocument/orchestrator/templateDocumentOrchestrator'
import { runWritingAssistant } from '../../writing/services/WritingAssistantService'
import type { FieldValue, FormalTemplateErrorCode, PreviewRegionCandidate, RenderResult, TemplateProfile } from '../../../types/templateGeneration'

export const FORMAL_TEMPLATE_INITIAL_STATUS_MESSAGE = '请在底部输入框里描述生成要求。中间区域只负责展示结果预览、打开和下载入口。'

export const FORMAL_TEMPLATE_COMPOSER_PLACEHOLDER = '请输入生成需求，例如：以当前模板生成一份给杭州市政府的贺信，时间写 2026 年 4 月，主题围绕浙江人工智能产业发展，语气正式庄重。'

type FormalTemplateGenerateResult = {
  success: true
  result: RenderResult
} | {
  success: false
  errorMessage: string
}

type FormalTemplateDocumentEditCommitResult = {
  success: true
  result: RenderResult
  committedPatches: DocumentPatch[]
  affectedFieldIds: string[]
  affectedRegionIds: string[]
} | {
  success: false
  errorMessage: string
}

type FormalTemplateRewriteCommitResult = FormalTemplateDocumentEditCommitResult

function buildInitialFieldValues(profile: TemplateProfile): FieldValue[] {
  return profile.fields.map((field) => ({
    fieldId: field.fieldId,
    value: field.defaultText,
    userOverride: false,
    confirmed: false,
  }))
}

function buildGenerationInstruction(templateTitle: string, userInstruction: string): string {
  return [
    `请基于正式模板《${templateTitle}》生成最终文稿。`,
    '必须保留模板固定壳层、固定格式和不可编辑区域，只改写允许生成的正文区域与允许替换的字段。',
    '输出内容必须是可直接发出的正式文稿，不要解释流程，不要暴露模板机制。',
    `用户需求：${userInstruction.trim()}`,
  ].join('\n')
}

function getResponseErrorMessage(errorMessage: string | undefined, fallback: string): string {
  return errorMessage?.trim() || fallback
}

function isShellValidationError(errorCode?: FormalTemplateErrorCode): boolean {
  return errorCode === 'FT_SHELL_INTEGRITY_VIOLATED'
}

function extractJsonPayload(text: string): string {
  const trimmed = String(text || '').trim()
  if (!trimmed) return ''
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1].trim() : trimmed
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start >= 0 && end > start) return candidate.slice(start, end + 1)
  return candidate
}

function extractUserDemandSegment(text: string): string {
  const normalized = String(text || '').trim()
  if (!normalized) return ''
  const matched = normalized.match(/用户需求[:：]\s*([\s\S]*)$/)
  return matched?.[1]?.trim() || normalized
}

function captureInstructionValue(source: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const matched = source.match(pattern)
    if (matched?.[1]) return matched[1].trim()
  }
  return ''
}

function isCongratulationSemanticPriorityProfile(profile: TemplateProfile): boolean {
  const labels = new Set(profile.fields.map((field) => field.label))
  return labels.has('收件人') && labels.has('主题') && labels.has('发信单位')
}

function matchCongratulationRecipient(text: string): string {
  return captureInstructionValue(text, [
    /recipient\s*[:=：]\s*([^\n,，。；]{2,80})/i,
    /(?:收件人|收函单位|称谓)\s*[:=：]\s*([^\n,，。；]{2,80})/u,
    /(?:给|致|向)([^，。；\n]{2,80}?)(?:的)?贺信/u,
  ]).replace(/[：:]+$/g, '').trim()
}

function matchCongratulationDate(text: string): string {
  return captureInstructionValue(text, [
    /date\s*[:=：]\s*([^\n,，。；]{4,40})/i,
    /(?:日期|时间)\s*[:=：]\s*([^\n,，。；]{4,40})/u,
    /(?:时间写|日期写)(?:成|为|写|用)?\s*([^\n,，。；]{4,40})/u,
  ])
    .replace(/\s*年\s*/g, '年')
    .replace(/\s*月\s*/g, '月')
    .replace(/\s*日\s*/g, '日')
    .trim()
}

function matchCongratulationTheme(text: string): string {
  return captureInstructionValue(text, [
    /theme\s*[:=：]\s*([^\n,，。；]{2,80})/i,
    /主题\s*[:=：]\s*([^\n,，。；]{2,80})/u,
    /(?:主题(?:围绕|为|是)?|围绕|聚焦|关于)([^，。；\n]{2,80})/u,
  ]).replace(/[，。；]+$/g, '').trim()
}

function matchCongratulationTone(text: string): string {
  return captureInstructionValue(text, [
    /tone\s*[:=：]\s*([^\n,，。；]{2,40})/i,
    /(?:语气|风格)\s*[:=：]\s*([^\n,，。；]{2,40})/u,
    /(?:语气|风格)(?:写|为|是|用)?\s*([^，。；\n]{2,40})/u,
  ]).replace(/[，。；]+$/g, '').trim()
}

function matchCongratulationSender(text: string): string {
  return captureInstructionValue(text, [
    /sender\s*[:=：]\s*([^\n,，。；]{2,80})/i,
    /(?:发信单位|落款(?:单位)?|署名)\s*[:=：]\s*([^\n,，。；]{2,80})/u,
    /(?:发信单位|落款(?:单位)?|署名)(?:写|为|是|用)?\s*([^，。；\n]{2,80})/u,
  ]).replace(/[，。；]+$/g, '').trim()
}

function matchCongratulationOptionalContext(text: string): string {
  return captureInstructionValue(text, [
    /(?:optional[_\s-]?context|补充背景)\s*[:=：]\s*([^\n]+)/i,
  ]).replace(/[；。]+$/g, '').trim()
}

function buildFieldExtractionInstruction(profile: TemplateProfile, templateTitle: string, userInstruction: string, templatePreviewText: string): string {
  const hideTemplateBodyFacts = isCongratulationSemanticPriorityProfile(profile)
  const fieldLines = profile.fields.map((field) => (
    `- fieldId=${field.fieldId}; label=${field.label}; required=${field.required ? 'yes' : 'no'}; default=${field.defaultText || '空'}`
  )).join('\n')

  return [
    '你是正式模板字段抽取专家。',
    '任务：把用户需求中的明确信息映射到模板字段。',
    '规则：',
    '1. 只能提取需求中明确给出的信息；无法确定时输出空字符串，不要编造。',
    '2. 保持原始称谓、机构名、日期和电话号码表达。',
    '3. 只输出 JSON，不要附加解释。',
    '4. JSON 结构固定为：{"fields":[{"fieldId":"...","value":"..."}]}。',
    hideTemplateBodyFacts ? '5. 当前模板处于语义优先模式：模板原正文只可用于识别文种和版式，不可把模板中的机构名、学校名、地名、历史事件当成待填写事实。' : '',
    `模板标题：${templateTitle}`,
    !hideTemplateBodyFacts && templatePreviewText ? `模板预览：${templatePreviewText}` : '',
    '字段清单：',
    fieldLines,
    '用户需求：',
    userInstruction.trim(),
  ].filter(Boolean).join('\n')
}

function matchProvince(text: string): string {
  const provinces = [
    '北京市', '天津市', '上海市', '重庆市', '河北省', '山西省', '辽宁省', '吉林省', '黑龙江省', '江苏省', '浙江省', '安徽省',
    '福建省', '江西省', '山东省', '河南省', '湖北省', '湖南省', '广东省', '海南省', '四川省', '贵州省', '云南省', '陕西省',
    '甘肃省', '青海省', '台湾省', '内蒙古自治区', '广西壮族自治区', '西藏自治区', '宁夏回族自治区', '新疆维吾尔自治区', '香港特别行政区', '澳门特别行政区',
  ]
  const direct = provinces.find((item) => text.includes(item))
  if (direct) return direct
  const shortMap: Record<string, string> = {
    北京: '北京市', 天津: '天津市', 上海: '上海市', 重庆: '重庆市', 河北: '河北省', 山西: '山西省', 辽宁: '辽宁省', 吉林: '吉林省', 黑龙江: '黑龙江省',
    江苏: '江苏省', 浙江: '浙江省', 安徽: '安徽省', 福建: '福建省', 江西: '江西省', 山东: '山东省', 河南: '河南省', 湖北: '湖北省', 湖南: '湖南省',
    广东: '广东省', 海南: '海南省', 四川: '四川省', 贵州: '贵州省', 云南: '云南省', 陕西: '陕西省', 甘肃: '甘肃省', 青海: '青海省', 内蒙古: '内蒙古自治区',
    广西: '广西壮族自治区', 西藏: '西藏自治区', 宁夏: '宁夏回族自治区', 新疆: '新疆维吾尔自治区', 香港: '香港特别行政区', 澳门: '澳门特别行政区',
  }
  const shortKey = Object.keys(shortMap).find((item) => text.includes(item))
  return shortKey ? shortMap[shortKey] : ''
}

function applyHeuristicFieldValues(profile: TemplateProfile, userInstruction: string, initialValues: FieldValue[]): FieldValue[] {
  const text = extractUserDemandSegment(userInstruction)
  if (!text) return initialValues

  const inferredByLabel = new Map<string, string>()
  const recipientMatch = text.match(/(?:给|致|向|拜访|前往|到)([^，。；\n]{2,40}(?:招生办公室|教育考试院|教育考试中心|教育厅|招生考试院|办公室|学院|学校|政府))/)
  const visitorMatch = text.match(/(?:由|安排|拟由|我校由)([^，。；\n]{2,50}(?:一行\d*人|等一行\d*人|等))/)
  const timeMatch = text.match(/((?:\d{4}年)?\d{1,2}月\d{1,2}日(?:（[^）]+）)?(?:上午|下午|晚上|中午)?(?:[^，。；\n]{0,12})?)/)
  const contactPersonMatch = text.match(/联系人[:：]?\s*([^，。；\n\s]{2,20})/)
  const phoneMatch = text.match(/(?:联系电话|电话|手机)[:：]?\s*([0-9+＋\-*\s]{7,24})/)
  const letterDateMatch = text.match(/(?:发函日期|日期)[:：]?\s*([^，。；\n]{4,30})/)
  const congratulationRecipient = matchCongratulationRecipient(text)
  const congratulationDate = matchCongratulationDate(text)
  const congratulationTheme = matchCongratulationTheme(text)
  const congratulationTone = matchCongratulationTone(text)
  const congratulationSender = matchCongratulationSender(text)
  const congratulationOptionalContext = matchCongratulationOptionalContext(text)
  const province = matchProvince(text)

  if (recipientMatch?.[1]) inferredByLabel.set('收函单位', recipientMatch[1].trim())
  if (province) inferredByLabel.set('目标省份', province)
  if (visitorMatch?.[1]) inferredByLabel.set('来访人员说明', visitorMatch[1].trim())
  if (timeMatch?.[1]) inferredByLabel.set('拜访时间', timeMatch[1].trim())
  if (contactPersonMatch?.[1]) inferredByLabel.set('联系人', contactPersonMatch[1].trim())
  if (phoneMatch?.[1]) inferredByLabel.set('联系电话', phoneMatch[1].trim())
  if (letterDateMatch?.[1]) inferredByLabel.set('发函日期', letterDateMatch[1].trim())
  if (congratulationRecipient) inferredByLabel.set('收件人', congratulationRecipient)
  if (congratulationDate) inferredByLabel.set('日期', congratulationDate)
  if (congratulationTheme) inferredByLabel.set('主题', congratulationTheme)
  if (congratulationTone) inferredByLabel.set('语气', congratulationTone)
  if (congratulationSender) inferredByLabel.set('发信单位', congratulationSender)
  if (congratulationOptionalContext) inferredByLabel.set('补充背景', congratulationOptionalContext)

  return initialValues.map((fieldValue) => {
    const schema = profile.fields.find((field) => field.fieldId === fieldValue.fieldId)
    const inferredValue = schema ? inferredByLabel.get(schema.label) : undefined
    if (!inferredValue) return fieldValue
    return {
      ...fieldValue,
      value: inferredValue,
      userOverride: true,
      confirmed: true,
    }
  })
}

function applyAssistantFieldValues(profile: TemplateProfile, currentValues: FieldValue[], assistantText: string): FieldValue[] {
  const payload = JSON.parse(extractJsonPayload(assistantText)) as { fields?: Array<{ fieldId?: string; label?: string; value?: string }> }
  const items = Array.isArray(payload.fields) ? payload.fields : []
  const byFieldId = new Map(items.map((item) => [String(item.fieldId || '').trim(), String(item.value || '').trim()]))
  const byLabel = new Map(items.map((item) => [String(item.label || '').trim(), String(item.value || '').trim()]))

  return currentValues.map((fieldValue) => {
    const schema = profile.fields.find((field) => field.fieldId === fieldValue.fieldId)
    const nextValue = byFieldId.get(fieldValue.fieldId) || (schema ? byLabel.get(schema.label) : '') || ''
    if (!nextValue.trim()) return fieldValue
    return {
      ...fieldValue,
      value: nextValue.trim(),
      userOverride: true,
      confirmed: true,
    }
  })
}

async function resolveAutoFieldValues(profile: TemplateProfile, templateTitle: string, templatePreviewText: string, userInstruction: string, setStatusMessage: (value: string) => void): Promise<FieldValue[]> {
  const heuristicValues = applyHeuristicFieldValues(profile, userInstruction, buildInitialFieldValues(profile))
  const hideTemplateBodyFacts = isCongratulationSemanticPriorityProfile(profile)
  try {
    setStatusMessage('正在理解你的需求，并整理模板里要填写的信息...')
    let assistantText = ''
    await runWritingAssistant({
      instruction: buildFieldExtractionInstruction(profile, templateTitle, userInstruction, templatePreviewText),
      language: 'zh',
      extraContext: hideTemplateBodyFacts ? undefined : templatePreviewText || undefined,
    }, {
      onDelta: () => undefined,
      onComplete: async (result) => {
        assistantText = result.text
      },
      onError: (error) => {
        throw new Error(error)
      },
      onStatus: (message) => setStatusMessage(message || '正在理解你的需求，并整理模板里要填写的信息...'),
    })
    return applyAssistantFieldValues(profile, heuristicValues, assistantText)
  } catch {
    return heuristicValues
  }
}

function normalizePreviewCandidates(candidates?: PreviewRegionCandidate[], candidate?: PreviewRegionCandidate): PreviewRegionCandidate[] {
  if (Array.isArray(candidates) && candidates.length > 0) return candidates
  return candidate ? [candidate] : []
}

function getOutputTitle(outputPath: string): string {
  const normalized = String(outputPath || '').replace(/\\/g, '/').trim()
  if (!normalized) return ''
  const lastSlashIndex = normalized.lastIndexOf('/')
  return lastSlashIndex >= 0 ? normalized.slice(lastSlashIndex + 1) : normalized
}

export function useFormalTemplateGeneration() {
  const { activeWorkspacePath } = useWorkspace()
  const { documents, templateDocumentId, referenceDocumentIds } = useKnowledge()
  const workbench = useGenerationWorkbench()
  const selectedKnowledgeBaseIds = workbench.sessions['document']?.selectedKnowledgeBaseIds || []
  const {
    phase,
    profile,
    commitResult,
    resetSession,
    setPhase,
    setProfile,
    setFieldValues,
    setPreviewPlan,
    setPreviewCandidate,
    setCommitResult,
    setErrorMessage,
    setStatusMessage,
    lastInstruction,
    setLastInstruction,
  } = useFormalTemplateSession()

  const templateDocument = useMemo(
    () => documents.find((item) => item.id === templateDocumentId) || null,
    [documents, templateDocumentId],
  )

  const selectedReferenceDocumentIds = useMemo(
    () => referenceDocumentIds.filter((documentId) => documentId !== templateDocumentId),
    [referenceDocumentIds, templateDocumentId],
  )

  const isBusy = phase === 'analyzing' || phase === 'confirming' || phase === 'previewing' || phase === 'committing'

  const syncDocumentResultMirror = useCallback((input: {
    instruction?: string
    phase: 'running' | 'completed' | 'error'
    message: string
    result?: RenderResult | null
    documentArtifact?: DocumentArtifact | null
  }) => {
    const now = new Date().toISOString()
    const outputPath = input.result?.outputPath || null
    const nextDocumentArtifact = input.documentArtifact !== undefined
      ? input.documentArtifact
      : (input.result?.documentArtifact || null)
    // Document-mode workbench result is the manuscript JSON runtime owner.
    // FormalTemplateSessionContext keeps commit metadata and workflow state.
    workbench.setModeSession('document', (session) => ({
      ...session,
      generationPrompt: input.instruction ?? session.generationPrompt,
      generationStatus: {
        phase: input.phase,
        message: input.message,
        updatedAt: now,
      },
      resultAssetId: outputPath,
      resultType: outputPath ? 'docx' : null,
      resultPath: outputPath,
      resultTitle: outputPath ? (getOutputTitle(outputPath) || session.resultTitle) : '',
      documentArtifact: nextDocumentArtifact,
      resultPreviewText: '',
      resultPreviewUrl: null,
      lastUpdatedAt: now,
    }))
  }, [workbench])

  const generateDocument = useCallback(async (userInstruction: string): Promise<FormalTemplateGenerateResult> => {
    const trimmedInstruction = userInstruction.trim()

    resetSession()
    setLastInstruction(trimmedInstruction)
    setStatusMessage(FORMAL_TEMPLATE_INITIAL_STATUS_MESSAGE)
    syncDocumentResultMirror({
      instruction: trimmedInstruction,
      phase: 'running',
      message: '正在生成正式文稿...',
      result: null,
    })

    if (!trimmedInstruction) {
      const message = '请先在底部输入框里描述本次正式文稿需求。'
      setPhase('error')
      setErrorMessage(message)
      setStatusMessage(message)
      syncDocumentResultMirror({ instruction: trimmedInstruction, phase: 'error', message, result: null })
      return { success: false, errorMessage: message }
    }

    if (!templateDocumentId) {
      const message = '请先在左侧资源管理器里选择模板文档。'
      setPhase('error')
      setErrorMessage(message)
      setStatusMessage('还没有选择模板，请先在左侧资源管理器完成这一步。')
      syncDocumentResultMirror({ instruction: trimmedInstruction, phase: 'error', message, result: null })
      return { success: false, errorMessage: message }
    }

    if (templateDocument && templateDocument.sourceType !== 'doc' && templateDocument.sourceType !== 'docx') {
      const message = '正式模板当前只支持 DOC / DOCX 作为模板，请重新选择模板文档。'
      setPhase('error')
      setErrorMessage(message)
      setStatusMessage(message)
      syncDocumentResultMirror({ instruction: trimmedInstruction, phase: 'error', message, result: null })
      return { success: false, errorMessage: message }
    }

    if (!activeWorkspacePath) {
      const message = '请先打开一个工作区，用来保存本次生成的文稿。'
      setPhase('error')
      setErrorMessage(message)
      setStatusMessage('还没有打开工作区，暂时无法开始生成。')
      syncDocumentResultMirror({ instruction: trimmedInstruction, phase: 'error', message, result: null })
      return { success: false, errorMessage: message }
    }

    setStatusMessage('正在读取模板，并确认可以自动填写的内容...')
    setPhase('analyzing')
    setErrorMessage(null)

    try {
      const analyzeResponse = await window.electronAPI.analyzeFormalTemplate({
        knowledgeDocumentId: templateDocumentId,
        sampleDocumentIds: [],
        workspacePath: activeWorkspacePath,
      })

      if (!analyzeResponse.success || !analyzeResponse.profile) {
        const message = getResponseErrorMessage(analyzeResponse.errorMessage, '正式模板分析失败。')
        setPhase('error')
        setErrorMessage(message)
        setStatusMessage('模板暂时无法读取，请稍后重试或更换模板。')
        syncDocumentResultMirror({ instruction: trimmedInstruction, phase: 'error', message, result: null })
        return { success: false, errorMessage: message }
      }

      const profile = analyzeResponse.profile
      setProfile(profile)

      setPhase('confirming')
      const autoFieldValues = await resolveAutoFieldValues(
        profile,
        profile.title || templateDocument?.title || '当前模板',
        templateDocument?.previewText || '',
        trimmedInstruction,
        setStatusMessage,
      )
      setFieldValues(autoFieldValues)

      setPhase('previewing')
      setStatusMessage('正在根据你的要求起草文稿...')
      const generationInstruction = buildGenerationInstruction(profile.title || templateDocument?.title || '当前模板', trimmedInstruction)
      const previewResponse = await window.electronAPI.previewFormalTemplateTask({
        profileId: profile.profileId,
        workCopyPath: profile.workCopyPath,
        instruction: generationInstruction,
        referenceDocumentIds: selectedReferenceDocumentIds,
        sampleDocumentIds: [],
        fieldValues: autoFieldValues,
        retrievalMode: 'auto',
        knowledgeBaseIds: selectedKnowledgeBaseIds,
      })

      if (!previewResponse.success || !previewResponse.plan) {
        const message = getResponseErrorMessage(previewResponse.errorMessage, '正式模板生成预演失败。')
        setPhase('error')
        setErrorMessage(message)
        setStatusMessage('这次起草没有完成，请调整需求后重试。')
        syncDocumentResultMirror({ instruction: trimmedInstruction, phase: 'error', message, result: null })
        return { success: false, errorMessage: message }
      }

      const previewCandidates = normalizePreviewCandidates(previewResponse.regionCandidates, previewResponse.regionCandidate)
      if (previewResponse.plan.regionPlans.length > 0 && previewCandidates.length === 0) {
        const message = '正式模板预演没有产出任何可写区域候选，请更换模板或稍后重试。'
        setPhase('error')
        setErrorMessage(message)
        setStatusMessage('模板已经识别成功，但正文区域没有成功起草出来。')
        syncDocumentResultMirror({ instruction: trimmedInstruction, phase: 'error', message, result: null })
        return { success: false, errorMessage: message }
      }

      setPreviewPlan(previewResponse.plan)
      setPreviewCandidate(previewCandidates[0] || null)

      const requiredPendingLabels = previewResponse.plan.pendingFieldIds
        .map((fieldId) => profile.fields.find((field) => field.fieldId === fieldId))
        .filter((field) => Boolean(field?.required))
        .map((field) => field?.label || '')
        .filter(Boolean)

      if (requiredPendingLabels.length > 0) {
        const message = `需求里还缺少关键信息：${requiredPendingLabels.join('、')}。请补充后重新生成。`
        setPhase('error')
        setErrorMessage(message)
        setStatusMessage('还缺少几项关键信息，请补充后再试一次。')
        syncDocumentResultMirror({ instruction: trimmedInstruction, phase: 'error', message, result: null })
        return { success: false, errorMessage: message }
      }

      setPhase('committing')
      setStatusMessage('正在整理版式并生成最终文稿...')
      const commitResponse = await window.electronAPI.commitFormalTemplateTask({
        profileId: profile.profileId,
        workCopyPath: profile.workCopyPath,
        instruction: generationInstruction,
        fieldValues: autoFieldValues,
        regionPatches: previewCandidates.map((candidate) => ({
          regionId: candidate.regionId,
          finalText: candidate.candidateText,
          finalParagraphs: candidate.candidateParagraphs,
        })),
      })

      if (!commitResponse.success || !commitResponse.result) {
        const validationFailed = isShellValidationError(commitResponse.errorCode)
        const message = validationFailed
          ? `模板壳层校验失败：${getResponseErrorMessage(commitResponse.errorMessage, '输出结果未通过校验。')}`
          : getResponseErrorMessage(commitResponse.errorMessage, '文稿写回失败。')
        setPhase('error')
        setErrorMessage(message)
        setStatusMessage('生成过程中断了，文稿还没有准备好。')
        syncDocumentResultMirror({ instruction: trimmedInstruction, phase: 'error', message, result: null })
        return { success: false, errorMessage: message }
      }

      if (!commitResponse.result.allCommitted || !commitResponse.result.shellValidation.passed) {
        const message = commitResponse.result.shellValidation.errorMessage || '模板壳层校验未通过，本次生成未生效。'
        setPhase('error')
        setErrorMessage(message)
        setStatusMessage('文稿未能顺利生成，请稍后再试。')
        syncDocumentResultMirror({ instruction: trimmedInstruction, phase: 'error', message, result: null })
        return { success: false, errorMessage: message }
      }

      const committedResult = attachTemplateDocumentArtifact(commitResponse.result, {
        artifactId: `templateDocument:${profile.profileId}:commit`,
        templateDocumentId: templateDocumentId || profile.knowledgeDocumentId,
        templateTitle: templateDocument?.title || profile.title,
        fieldLabels: Object.fromEntries(profile.fields.map((field) => [field.fieldId, field.label || field.fieldId])),
        regionLabels: Object.fromEntries(profile.regions.map((region) => [region.regionId, region.label || region.regionId])),
        routingPlan: profile.routingPlan,
      })

      setCommitResult(committedResult)
      setPhase('completed')
      setStatusMessage('文稿已准备好，可以在中间区域预览、打开或下载。')
      syncDocumentResultMirror({
        instruction: trimmedInstruction,
        phase: 'completed',
        message: '正式文稿已生成，可在右侧预览与导出。',
        result: committedResult,
      })
      return { success: true, result: committedResult }
    } catch (error) {
      const message = error instanceof Error ? error.message : '正式模板生成失败。'
      setPhase('error')
      setErrorMessage(message)
      setStatusMessage('这次生成没有完成，请调整需求后重试。')
      syncDocumentResultMirror({ instruction: trimmedInstruction, phase: 'error', message, result: null })
      return { success: false, errorMessage: message }
    }
  }, [
    activeWorkspacePath,
    resetSession,
    selectedReferenceDocumentIds,
    syncDocumentResultMirror,
    setCommitResult,
    setErrorMessage,
    setFieldValues,
    setLastInstruction,
    setPhase,
    setPreviewCandidate,
    setPreviewPlan,
    setProfile,
    setStatusMessage,
    templateDocument?.previewText,
    templateDocument?.title,
    templateDocumentId,
  ])

  const commitDocumentEdit = useCallback(async (
    patches: DocumentPatch[],
    options?: {
      pendingStatusMessage?: string
      successStatusMessage?: string
      successMirrorMessage?: string
      genericFailureMessage?: string
      shellValidationFailureMessage?: string
    },
  ): Promise<FormalTemplateDocumentEditCommitResult> => {
    const sourceArtifact = workbench.sessions.document.documentArtifact || commitResult?.documentArtifact || null
    const prepareResult = prepareTemplateDocumentEditCommit({
      commitResult,
      sourceArtifact,
      profile,
      instruction: lastInstruction || undefined,
      patches,
    })

    if (!prepareResult.ok) {
      setStatusMessage(prepareResult.error)
      return {
        success: false,
        errorMessage: prepareResult.error,
      }
    }

    setPhase('committing')
    setErrorMessage(null)
    setStatusMessage(options?.pendingStatusMessage || '正在把当前修改提交到正式模板结果...')

    try {
      const commitResponse = await window.electronAPI.commitFormalTemplateTask(prepareResult.value.commitRequest)

      if (!commitResponse.success || !commitResponse.result) {
        const validationFailed = isShellValidationError(commitResponse.errorCode)
        const message = validationFailed
          ? `模板壳层校验失败：${getResponseErrorMessage(commitResponse.errorMessage, '输出结果未通过校验。')}`
          : getResponseErrorMessage(commitResponse.errorMessage, options?.genericFailureMessage || '文稿修改提交失败。')
        setPhase('error')
        setErrorMessage(message)
        setStatusMessage(message)
        syncDocumentResultMirror({
          instruction: lastInstruction || undefined,
          phase: 'error',
          message,
          result: commitResult,
          documentArtifact: sourceArtifact,
        })
        return {
          success: false,
          errorMessage: message,
        }
      }

      if (!commitResponse.result.allCommitted || !commitResponse.result.shellValidation.passed) {
        const message = commitResponse.result.shellValidation.errorMessage || options?.shellValidationFailureMessage || '模板壳层校验未通过，本次文稿修改未生效。'
        setPhase('error')
        setErrorMessage(message)
        setStatusMessage(message)
        syncDocumentResultMirror({
          instruction: lastInstruction || undefined,
          phase: 'error',
          message,
          result: commitResult,
          documentArtifact: sourceArtifact,
        })
        return {
          success: false,
          errorMessage: message,
        }
      }

      const artifactContext = createTemplateDocumentArtifactContext({
        commitResult: commitResponse.result,
        profile,
        templateDocumentId: templateDocumentId || undefined,
        templateTitle: templateDocument?.title,
      })
      const committedPatches = [...prepareResult.value.patchedArtifact.patches]
      const committedResult = attachTemplateDocumentArtifact(commitResponse.result, {
        ...artifactContext,
        patches: committedPatches,
        documentOverride: prepareResult.value.patchedArtifact.document,
      })

      setCommitResult(committedResult)
      setPhase('completed')
      setStatusMessage(options?.successStatusMessage || '文稿修改已提交为正式结果。')
      syncDocumentResultMirror({
        instruction: lastInstruction || undefined,
        phase: 'completed',
        message: options?.successMirrorMessage || '文稿修改已提交为正式结果。',
        result: committedResult,
      })

      return {
        success: true,
        result: committedResult,
        committedPatches,
        affectedFieldIds: prepareResult.value.affectedFieldIds,
        affectedRegionIds: prepareResult.value.affectedRegionIds,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : (options?.genericFailureMessage || '文稿修改提交失败。')
      setPhase('error')
      setErrorMessage(message)
      setStatusMessage(message)
      syncDocumentResultMirror({
        instruction: lastInstruction || undefined,
        phase: 'error',
        message,
        result: commitResult,
        documentArtifact: sourceArtifact,
      })
      return {
        success: false,
        errorMessage: message,
      }
    }
  }, [
    commitResult,
    lastInstruction,
    profile,
    setCommitResult,
    setErrorMessage,
    setPhase,
    setStatusMessage,
    syncDocumentResultMirror,
    templateDocument?.title,
    templateDocumentId,
    workbench.sessions.document.documentArtifact,
  ])

  const commitRewriteBlock = useCallback(async (patches: DocumentPatch[]): Promise<FormalTemplateRewriteCommitResult> => {
    return commitDocumentEdit(
      patches.filter((patch): patch is Extract<DocumentPatch, { type: 'replace_block' }> => patch.type === 'replace_block'),
      {
        pendingStatusMessage: '正在把当前段落改写提交到正式模板结果...',
        successStatusMessage: '段落改写已提交为正式结果。',
        successMirrorMessage: '段落改写已提交为正式结果。',
        genericFailureMessage: '段落改写提交失败。',
        shellValidationFailureMessage: '模板壳层校验未通过，本次段落改写未生效。',
      },
    )
  }, [commitDocumentEdit])

  return {
    templateDocument,
    isBusy,
    generateDocument,
    commitDocumentEdit,
    commitRewriteBlock,
  }
}