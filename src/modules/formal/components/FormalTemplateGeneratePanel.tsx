import { useMemo, useState } from 'react'
import styled from 'styled-components'
import { runWritingAssistant } from '../../writing/services/WritingAssistantService'
import { useFormalTemplateSession, type FormalTemplateSessionPhase } from '../contexts/FormalTemplateSessionContext'
import { useKnowledge } from '../../../contexts/KnowledgeContext'
import { useWorkspace } from '../../../contexts/WorkspaceContext'
import { useWorkspaceMode } from '../../../contexts/WorkspaceModeContext'
import { useDocumentPreview } from '../../../hooks/useDocumentPreview'
import type { FieldValue, FormalTemplateErrorCode, TemplateProfile } from '../../../types/templateGeneration'
import ReadonlyDocumentPreview from '../../writing/components/ReadonlyDocumentPreview'

const PanelShell = styled.div`
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  align-items: stretch;
  justify-content: center;
  padding: 28px;
  overflow: auto;
  background:
    radial-gradient(circle at top left, rgba(175, 214, 255, 0.6), transparent 34%),
    radial-gradient(circle at bottom right, rgba(236, 203, 169, 0.34), transparent 28%),
    linear-gradient(180deg, #f6fbff 0%, #eef3f8 100%);
`

const Stage = styled.div`
  width: min(980px, 100%);
  display: grid;
  gap: 18px;
`

const HeroCard = styled.section`
  position: relative;
  overflow: hidden;
  border-radius: 24px;
  padding: 28px;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(246, 249, 252, 0.92));
  border: 1px solid #d8e4ee;
  box-shadow: 0 24px 56px rgba(24, 49, 74, 0.09);
  display: grid;
  gap: 20px;

  &::after {
    content: '';
    position: absolute;
    inset: auto -40px -60px auto;
    width: 220px;
    height: 220px;
    border-radius: 999px;
    background: radial-gradient(circle, rgba(213, 171, 122, 0.16) 0%, rgba(213, 171, 122, 0) 72%);
    pointer-events: none;
  }
`

const HeroTop = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
`

const HeroIntro = styled.div`
  display: grid;
  gap: 10px;
`

const Eyebrow = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #9a5f34;
`

const Title = styled.h2`
  margin: 0;
  font-size: 30px;
  line-height: 1.15;
  color: #193146;
`

const Description = styled.p`
  margin: 0;
  max-width: 700px;
  font-size: 14px;
  line-height: 1.8;
  color: #597085;
`

const StatusPill = styled.div<{ $phase: FormalTemplateSessionPhase }>`
  min-height: 36px;
  padding: 0 14px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-xs);
  font-weight: 800;
  color: ${({ $phase }) => ($phase === 'error' ? '#a03131' : '#21415f')};
  background: ${({ $phase }) => ($phase === 'error' ? '#feeaea' : '#edf5fc')};
  border: 1px solid ${({ $phase }) => ($phase === 'error' ? '#efc7c7' : '#d8e6f2')};
`

const TemplateSummary = styled.div`
  border-radius: 18px;
  border: 1px solid #dfe8f1;
  background: rgba(248, 251, 255, 0.88);
  padding: 18px;
  display: grid;
  gap: 12px;
`

const SummaryLabel = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #6b7f93;
`

const SummaryTitle = styled.div`
  font-size: 22px;
  font-weight: 800;
  color: #1f354a;
  line-height: 1.35;
  word-break: break-word;
`

const SummaryMetaRow = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
`

const MetaChip = styled.span`
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  background: #f0f5fa;
  border: 1px solid #dce7f1;
  color: #567088;
  font-size: var(--font-size-xs);
  font-weight: 700;
`

const Layout = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.9fr);
  gap: 18px;

  @media (max-width: 940px) {
    grid-template-columns: minmax(0, 1fr);
  }
`

const Card = styled.section`
  border-radius: 22px;
  border: 1px solid #dbe6ef;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 16px 40px rgba(23, 43, 66, 0.06);
  padding: 22px;
  display: grid;
  gap: 16px;
`

const CardTitle = styled.h3`
  margin: 0;
  font-size: 17px;
  color: #1f3447;
`

const CardDescription = styled.p`
  margin: 0;
  font-size: var(--font-size-sm);
  line-height: 1.7;
  color: #64788c;
`

const RequestInput = styled.textarea`
  width: 100%;
  min-height: 240px;
  border-radius: 18px;
  border: 1px solid #d3dfeb;
  background: linear-gradient(180deg, #ffffff 0%, #fbfdff 100%);
  padding: 16px 18px;
  font-size: 14px;
  line-height: 1.8;
  color: #1e3448;
  resize: vertical;
  outline: none;

  &:focus {
    border-color: #2f74d0;
    box-shadow: 0 0 0 3px rgba(47, 116, 208, 0.12);
  }
`

const ActionRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
`

const PrimaryButton = styled.button`
  min-width: 164px;
  height: 48px;
  padding: 0 18px;
  border: none;
  border-radius: 14px;
  background: linear-gradient(135deg, #185fb6 0%, #2d86de 100%);
  color: #ffffff;
  font-size: 15px;
  font-weight: 800;
  cursor: pointer;
  box-shadow: 0 12px 28px rgba(34, 103, 184, 0.22);

  &:hover:not(:disabled) {
    filter: brightness(0.98);
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
    box-shadow: none;
  }
`

const SecondaryButton = styled.button`
  min-width: 112px;
  height: 40px;
  padding: 0 14px;
  border-radius: 12px;
  border: 1px solid #cfdce8;
  background: #ffffff;
  color: #30485f;
  font-size: var(--font-size-sm);
  font-weight: 700;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: #f4f8fb;
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`

const HintText = styled.div`
  font-size: var(--font-size-xs);
  line-height: 1.7;
  color: #6e8295;
`

const ResultStateBox = styled.div<{ $tone?: 'default' | 'error' | 'success' }>`
  border-radius: 16px;
  padding: 16px;
  border: 1px solid ${({ $tone }) => ($tone === 'error' ? '#f0c8c8' : $tone === 'success' ? '#cae6d6' : '#d8e5f0')};
  background: ${({ $tone }) => ($tone === 'error' ? '#fff2f2' : $tone === 'success' ? '#f1fbf4' : '#f8fbff')};
  display: grid;
  gap: 8px;
`

const ResultTitle = styled.div`
  font-size: 14px;
  font-weight: 800;
  color: #203447;
`

const ResultText = styled.div`
  font-size: var(--font-size-sm);
  line-height: 1.75;
  color: #556b80;
  white-space: pre-wrap;
  word-break: break-word;
`

const PreviewBox = styled.div`
  border-radius: 16px;
  border: 1px solid #dfe8f1;
  background: #ffffff;
  padding: 16px;
  min-height: 240px;
  max-height: 420px;
  overflow: auto;
  font-size: var(--font-size-sm);
  line-height: 1.9;
  color: #203245;
  white-space: pre-wrap;
`

const EmptyState = styled.div`
  border-radius: 16px;
  border: 1px dashed #d6e0ea;
  background: #f8fbfe;
  padding: 16px;
  font-size: var(--font-size-sm);
  line-height: 1.7;
  color: #6b7d8f;
`

const ButtonRow = styled.div`
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
`

const Footer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
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
  idle: '待生成',
  analyzing: '读取模板',
  confirming: '整理信息',
  previewing: '起草内容',
  committing: '生成文稿',
  completed: '已就绪',
  error: '需重试',
}

const INITIAL_STATUS_MESSAGE = '选好模板后，直接描述收函对象、来访安排和联系人，我会生成一份可继续检查和下载的正式文稿。'

type MinimalErrorStep = 'analyze' | 'preview' | 'commit'

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

function getFileName(value: string): string {
  const normalized = String(value || '').replace(/\\/g, '/').trim()
  const lastSlashIndex = normalized.lastIndexOf('/')
  return lastSlashIndex >= 0 ? normalized.slice(lastSlashIndex + 1) : normalized
}

function getParentPath(value: string): string {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/\/+$/g, '').trim()
  const lastSlashIndex = normalized.lastIndexOf('/')
  return lastSlashIndex > 0 ? normalized.slice(0, lastSlashIndex) : normalized
}

function normalizePreviewText(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 18)
    .join('\n\n')
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

function buildFieldExtractionInstruction(profile: TemplateProfile, templateTitle: string, userInstruction: string, templatePreviewText: string): string {
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
    `模板标题：${templateTitle}`,
    templatePreviewText ? `模板预览：${templatePreviewText}` : '',
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
  return Object.keys(shortMap).find((item) => text.includes(item)) ? shortMap[Object.keys(shortMap).find((item) => text.includes(item)) as string] : ''
}

function applyHeuristicFieldValues(profile: TemplateProfile, userInstruction: string, initialValues: FieldValue[]): FieldValue[] {
  const text = String(userInstruction || '').trim()
  if (!text) return initialValues

  const inferredByLabel = new Map<string, string>()
  const recipientMatch = text.match(/(?:给|致|向|拜访|前往|到)([^，。；\n]{2,40}(?:招生办公室|教育考试院|教育考试中心|教育厅|招生考试院|办公室|学院|学校))/)
  const visitorMatch = text.match(/(?:由|安排|拟由|我校由)([^，。；\n]{2,50}(?:一行\d*人|等一行\d*人|等))/)
  const timeMatch = text.match(/((?:\d{4}年)?\d{1,2}月\d{1,2}日(?:（[^）]+）)?(?:上午|下午|晚上|中午)?(?:[^，。；\n]{0,12})?)/)
  const contactPersonMatch = text.match(/联系人[:：]?\s*([^，。；\n\s]{2,20})/)
  const phoneMatch = text.match(/(?:联系电话|电话|手机)[:：]?\s*([0-9+＋\-*\s]{7,24})/)
  const letterDateMatch = text.match(/(?:发函日期|日期)[:：]?\s*([^，。；\n]{4,30})/)
  const province = matchProvince(text)

  if (recipientMatch?.[1]) inferredByLabel.set('收函单位', recipientMatch[1].trim())
  if (province) inferredByLabel.set('目标省份', province)
  if (visitorMatch?.[1]) inferredByLabel.set('来访人员说明', visitorMatch[1].trim())
  if (timeMatch?.[1]) inferredByLabel.set('拜访时间', timeMatch[1].trim())
  if (contactPersonMatch?.[1]) inferredByLabel.set('联系人', contactPersonMatch[1].trim())
  if (phoneMatch?.[1]) inferredByLabel.set('联系电话', phoneMatch[1].trim())
  if (letterDateMatch?.[1]) inferredByLabel.set('发函日期', letterDateMatch[1].trim())

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
  try {
    setStatusMessage('正在理解你的需求，并整理模板里要填写的信息...')
    let assistantText = ''
    await runWritingAssistant({
      instruction: buildFieldExtractionInstruction(profile, templateTitle, userInstruction, templatePreviewText),
      language: 'zh',
      extraContext: templatePreviewText || undefined,
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

export default function FormalTemplateGeneratePanel() {
  const { enterFreeMode } = useWorkspaceMode()
  const { activeWorkspaceName, activeWorkspacePath } = useWorkspace()
  const { documents, templateDocumentId, referenceDocumentIds } = useKnowledge()
  const {
    phase,
    commitResult,
    errorMessage,
    statusMessage,
    lastInstruction,
  } = useFormalTemplateSession()
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null)
  const [downloadedPath, setDownloadedPath] = useState<string | null>(null)

  const templateDocument = useMemo(
    () => documents.find((item) => item.id === templateDocumentId) || null,
    [documents, templateDocumentId],
  )

  const phaseLabel = PHASE_LABELS[phase]
  const outputDirectoryPath = commitResult ? getParentPath(commitResult.outputPath) : ''
  const documentPreview = useDocumentPreview(commitResult?.outputPath)
  const effectiveStatusMessage = errorMessage || statusMessage || INITIAL_STATUS_MESSAGE
  const resultTitle = commitResult
    ? '文稿已准备好'
    : phase === 'error'
      ? '生成未完成'
      : phase === 'idle'
        ? '等待输入需求'
        : '正在生成文稿'

  const handleOpenPath = async (targetPath: string, successMessage: string, failurePrefix: string) => {
    const normalizedPath = targetPath.trim()
    if (!normalizedPath) {
      setDownloadMessage(failurePrefix)
      return
    }
    const opened = await window.electronAPI.openExternalFile(normalizedPath)
    setDownloadMessage(opened.success ? successMessage : `${failurePrefix}${opened.error ? `：${opened.error}` : ''}`)
  }

  const handleDownload = async () => {
    if (!commitResult?.outputPath) {
      setDownloadMessage('请先完成生成，再下载文稿。')
      return
    }

    const defaultName = getFileName(commitResult.outputPath) || '正式模板输出.docx'
    const chosenPath = await window.electronAPI.saveFileDialog(defaultName)
    if (!chosenPath) return
    const finalPath = /\.[^.]+$/.test(chosenPath) ? chosenPath : `${chosenPath}.docx`

    try {
      const copied = await window.electronAPI.copyFileToPath(commitResult.outputPath, finalPath)
      setDownloadedPath(copied.path)
      setDownloadMessage(`文稿已保存到 ${copied.path}`)
    } catch (error) {
      setDownloadMessage(error instanceof Error ? `下载失败：${error.message}` : '下载失败。')
    }
  }

  return (
    <PanelShell data-workspace-mode="formal-template" data-testid="formal-template-generate-panel">
      <Stage>
        <HeroCard>
          <HeroTop>
            <HeroIntro>
              <Eyebrow>Legacy Surface</Eyebrow>
              <Title>正式模板结果面板（遗留兼容）</Title>
              <Description>
                这个面板保留用于观察 commitResult、预览输出与导出入口，不再代表正常 templateDocument 前台。当前正式入口已经收口到下方对话框里的统一生成主链。
              </Description>
            </HeroIntro>
            <StatusPill $phase={phase} data-testid="formal-template-phase-pill">{phaseLabel}</StatusPill>
          </HeroTop>

          <TemplateSummary data-testid="formal-template-template-summary">
            <SummaryLabel>当前模板</SummaryLabel>
            <SummaryTitle data-testid="formal-template-template-title">{templateDocument?.title || '还没有指定模板'}</SummaryTitle>
            <SummaryMetaRow>
              <MetaChip>{templateDocument?.sourceType?.toUpperCase() || 'DOC / DOCX'}</MetaChip>
              <MetaChip>{activeWorkspaceName || '未打开工作区'}</MetaChip>
              <MetaChip>{commitResult?.outputPath ? getFileName(commitResult.outputPath) : '生成后会自动保存到当前工作区'}</MetaChip>
            </SummaryMetaRow>
          </TemplateSummary>
        </HeroCard>

        <Layout>
          <Card>
            <div>
              <CardTitle>本次生成状态</CardTitle>
              <CardDescription>
                这是残留结果面板，不再承载正式发送入口；它只读取统一主链已经产出的状态和结果，供兼容观察与导出使用。
              </CardDescription>
            </div>

            <ResultStateBox $tone={phase === 'error' ? 'error' : commitResult ? 'success' : 'default'} data-testid="formal-template-result-state">
              <ResultTitle>{resultTitle}</ResultTitle>
              <ResultText>{effectiveStatusMessage}</ResultText>
            </ResultStateBox>

            {lastInstruction ? (
              <ResultStateBox data-testid="formal-template-request-summary">
                <ResultTitle>最近一次需求</ResultTitle>
                <ResultText>{lastInstruction}</ResultText>
              </ResultStateBox>
            ) : (
              <EmptyState>请在底部输入框中描述生成需求，例如收函对象、时间、主题、语气和联系人。发送后，这里会同步展示本次请求与结果状态。</EmptyState>
            )}

            {commitResult ? (
              <ResultStateBox $tone="success" data-testid="formal-template-output-summary">
                <ResultTitle>输出信息</ResultTitle>
                <ResultText>
                  文稿文件：{getFileName(commitResult.outputPath)}
                  {'\n'}保存位置：{getParentPath(commitResult.outputPath) || commitResult.outputPath}
                  {'\n'}当前结果已经可以打开、预览或下载。
                </ResultText>
              </ResultStateBox>
            ) : null}

            <HintText>
              {templateDocumentId && activeWorkspacePath
                ? '发送动作已经移到下方对话框；这里仅保留结果查看与导出，不再承担主前台职责。'
                : '请先在左侧确认模板，并保证当前工作区已经打开。'}
            </HintText>
          </Card>

          <Card>
            <div>
              <CardTitle>预览与导出</CardTitle>
              <CardDescription>
                文稿生成后，这里会展示正文预览，并提供打开、下载和定位输出目录的入口。
              </CardDescription>
            </div>

            <ReadonlyDocumentPreview
              preview={documentPreview}
              idleMessage="生成完成后，这里会展示正文预览，方便你先检查内容是否合适，再决定是否下载。"
              loadingMessage="正在读取文稿预览..."
              testId="formal-template-preview-box"
            />

            <ButtonRow>
              <SecondaryButton type="button" onClick={() => void handleOpenPath(commitResult?.outputPath || '', '已打开生成文稿。', '打开生成文稿失败')} disabled={!commitResult?.outputPath} data-testid="formal-template-open-button">
                打开文稿
              </SecondaryButton>
              <SecondaryButton type="button" onClick={() => void handleDownload()} disabled={!commitResult?.outputPath} data-testid="formal-template-download-button">
                下载文稿
              </SecondaryButton>
              <SecondaryButton type="button" onClick={() => void handleOpenPath(outputDirectoryPath, '已打开输出目录。', '打开输出目录失败')} disabled={!commitResult?.outputPath} data-testid="formal-template-open-directory-button">
                打开目录
              </SecondaryButton>
              {downloadedPath ? (
                <SecondaryButton type="button" onClick={() => void handleOpenPath(downloadedPath, '已打开下载结果。', '打开下载结果失败')} data-testid="formal-template-open-downloaded-button">
                  打开下载结果
                </SecondaryButton>
              ) : null}
            </ButtonRow>

            {downloadMessage ? <HintText data-testid="formal-template-download-message">{downloadMessage}</HintText> : null}
          </Card>
        </Layout>

        <Footer>
          <HintText>
            该面板仅为遗留兼容结果视图；正常 templateDocument 生成与结果 owner 已经收口到统一主链。
          </HintText>
          <BackButton type="button" onClick={enterFreeMode} data-testid="formal-template-back-button">返回自由写作</BackButton>
        </Footer>
      </Stage>
    </PanelShell>
  )
}