import React, { useEffect, useState } from 'react'
import styled from 'styled-components'
import type { AppSettings, ImageProvider, LlmProvider } from '../../electron/main/services/settingsStore'
import {
  formatBuiltinKeySource,
  formatProviderLabel,
  ACTIVE_IMAGE_PROVIDER,
  ACTIVE_LLM_PROVIDER,
  getImageProviderPreset,
  getLlmProviderPreset,
  LLM_PROVIDER_PRESETS,
  supportsBuiltinImageProvider,
  supportsBuiltinLlmProvider,
  type BuiltinKeySource,
} from '../shared/ai/providerCatalog'
import { FALLBACK_TOOL_SETTINGS, syncToolSettingsToLocalStorage, type ToolSettings } from '../utils/aiToolSettings'

const Panel = styled.div`
  display: grid;
  gap: 14px;
  padding: 16px;
  color: #304255;
`

const Section = styled.section`
  border: 1px solid #dde3ec;
  border-radius: 12px;
  background: #ffffff;
  overflow: hidden;
`

const SectionHeader = styled.div`
  padding: 12px 14px;
  border-bottom: 1px solid #e7edf4;
  background: #f8fbff;
`

const SectionTitle = styled.div`
  font-size: var(--font-size-sm);
  font-weight: 700;
  color: #1f3142;
`

const SectionDesc = styled.div`
  margin-top: 4px;
  font-size: var(--font-size-xs);
  color: #627385;
  line-height: 1.6;
`

const SectionBody = styled.div`
  padding: 14px;
`

const Label = styled.label`
  font-size: var(--font-size-xs);
  color: #627385;
  display: block;
  margin-bottom: 6px;
`

const Input = styled.input`
  width: 100%;
  padding: 9px 10px;
  border: 1px solid #d6e0ea;
  border-radius: 8px;
  font-size: var(--font-size-sm);
  outline: none;
  color: #304255;
  background: #ffffff;
`

const TextArea = styled.textarea`
  width: 100%;
  min-height: 82px;
  padding: 9px 10px;
  border: 1px solid #d6e0ea;
  border-radius: 8px;
  font-size: var(--font-size-sm);
  outline: none;
  color: #304255;
  background: #ffffff;
  resize: vertical;
`

const SmallSelect = styled.select`
  width: 100%;
  padding: 9px 10px;
  border: 1px solid #d6e0ea;
  border-radius: 8px;
  font-size: var(--font-size-sm);
  outline: none;
  color: #304255;
  background: #ffffff;
`

const Field = styled.div`
  margin-top: 10px;
`

const Row = styled.div`
  display: flex;
  gap: 10px;
  margin-top: 10px;
`

const Col = styled.div`
  flex: 1;
`

const Btn = styled.button<{ $primary?: boolean }>`
  width: 100%;
  padding: 10px 14px;
  border: ${p => (p.$primary ? 'none' : '1px solid #d6e0ea')};
  border-radius: 8px;
  background: ${p => (p.$primary ? '#0e639c' : '#ffffff')};
  color: ${p => (p.$primary ? '#fff' : '#304255')};
  font-size: var(--font-size-sm);
  font-weight: 600;
  cursor: pointer;
  &:disabled { opacity: 0.6; cursor: not-allowed; }
`

const Hint = styled.div`
  margin-top: 8px;
  font-size: var(--font-size-xs);
  color: #627385;
  line-height: 1.6;
`

const ToggleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid #dce5ef;
  border-radius: 8px;
  background: #f8fbff;
  margin-top: 10px;
`

const ToggleMeta = styled.div`
  flex: 1;
`

const ToggleTitle = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 700;
  color: #1f3142;
`

const ToggleDesc = styled.div`
  margin-top: 4px;
  font-size: var(--font-size-xs);
  color: #627385;
  line-height: 1.5;
`

const ToggleButton = styled.button<{ $active?: boolean }>`
  border: 1px solid ${p => (p.$active ? '#0e639c' : '#d6e0ea')};
  border-radius: 999px;
  background: ${p => (p.$active ? '#0e639c' : '#ffffff')};
  color: ${p => (p.$active ? '#fff' : '#304255')};
  padding: 8px 12px;
  font-size: var(--font-size-xs);
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
`

const StatusBox = styled.div<{ $error?: boolean }>`
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid ${p => (p.$error ? '#f1c5c5' : '#cfe0ef')};
  background: ${p => (p.$error ? '#fff6f6' : '#f5fbff')};
  color: ${p => (p.$error ? '#b33838' : '#2a5f8f')};
  font-size: var(--font-size-xs);
  line-height: 1.6;
`

const FullSettingsPanel: React.FC = () => {
  const lockedImagePreset = getImageProviderPreset(ACTIVE_IMAGE_PROVIDER)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testingText, setTestingText] = useState(false)
  const [testingImage, setTestingImage] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [statusError, setStatusError] = useState(false)
  const [llmProvider, setLlmProvider] = useState<LlmProvider>('qwen')
  const [llmApiKey, setLlmApiKey] = useState('')
  const [llmUseBuiltinKey, setLlmUseBuiltinKey] = useState(true)
  const [llmBuiltinAvailable, setLlmBuiltinAvailable] = useState(false)
  const [llmBuiltinSource, setLlmBuiltinSource] = useState<BuiltinKeySource>('none')
  const [llmModel, setLlmModel] = useState('')
  const [llmBaseUrl, setLlmBaseUrl] = useState('')
  const [imageProvider, setImageProvider] = useState<ImageProvider>('nanobanana')
  const [imageApiKey, setImageApiKey] = useState('')
  const [imageUseBuiltinKey, setImageUseBuiltinKey] = useState(true)
  const [imageBuiltinAvailable, setImageBuiltinAvailable] = useState(false)
  const [imageBuiltinSource, setImageBuiltinSource] = useState<BuiltinKeySource>('none')
  const [imageModel, setImageModel] = useState('')
  const [imageEndpoint, setImageEndpoint] = useState('')
  const [rewriteLanguage, setRewriteLanguage] = useState(FALLBACK_TOOL_SETTINGS.rewriteLanguage)
  const [rewriteRequirements, setRewriteRequirements] = useState(FALLBACK_TOOL_SETTINGS.rewriteRequirements)
  const [refTopic, setRefTopic] = useState(FALLBACK_TOOL_SETTINGS.refTopic)
  const [refYearFrom, setRefYearFrom] = useState(FALLBACK_TOOL_SETTINGS.refYearFrom)
  const [refYearTo, setRefYearTo] = useState(FALLBACK_TOOL_SETTINGS.refYearTo)
  const [refTargetCount, setRefTargetCount] = useState(FALLBACK_TOOL_SETTINGS.refTargetCount)
  const [refSoftFloorPercent, setRefSoftFloorPercent] = useState(FALLBACK_TOOL_SETTINGS.refSoftFloorPercent)
  const [refCandidatePoolSize, setRefCandidatePoolSize] = useState(FALLBACK_TOOL_SETTINGS.refCandidatePoolSize)
  const [refAnalysisWindow, setRefAnalysisWindow] = useState(FALLBACK_TOOL_SETTINGS.refAnalysisWindow)
  const [continueGoal, setContinueGoal] = useState(FALLBACK_TOOL_SETTINGS.continueGoal)
  const [continueWords, setContinueWords] = useState(FALLBACK_TOOL_SETTINGS.continueWords)
  const [imageAspectRatio, setImageAspectRatio] = useState(FALLBACK_TOOL_SETTINGS.imageAspectRatio)
  const [genLanguage, setGenLanguage] = useState(FALLBACK_TOOL_SETTINGS.genLanguage)
  const [genPaperType, setGenPaperType] = useState(FALLBACK_TOOL_SETTINGS.genPaperType)
  const [genNoImageMode, setGenNoImageMode] = useState(FALLBACK_TOOL_SETTINGS.genNoImageMode)
  const [genCitationMode, setGenCitationMode] = useState<ToolSettings['genCitationMode']>(FALLBACK_TOOL_SETTINGS.genCitationMode)
  const [genYearFrom, setGenYearFrom] = useState(FALLBACK_TOOL_SETTINGS.genYearFrom)
  const [genYearTo, setGenYearTo] = useState(FALLBACK_TOOL_SETTINGS.genYearTo)
  const [genExtraContext, setGenExtraContext] = useState(FALLBACK_TOOL_SETTINGS.genExtraContext)

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const settings = await window.electronAPI.getSettings()
        const savedLlmProvider = settings.llm.provider
        const savedLlmPreset = getLlmProviderPreset(savedLlmProvider)
        setLlmProvider(savedLlmProvider)
        setLlmApiKey(settings.llm.apiKey)
        const llmBuiltinAvail = settings.llm.builtinKeyAvailable
        setLlmBuiltinAvailable(llmBuiltinAvail)
        // 若内置 Key 不可用，自动切换到自定义 Key 模式，避免用户启动后功能直接失败
        const llmUseBuiltin = llmBuiltinAvail ? settings.llm.useBuiltinKey : false
        setLlmUseBuiltinKey(llmUseBuiltin)
        setLlmBuiltinSource(
          settings.llm.builtinKeySource !== 'none' ? settings.llm.builtinKeySource : 'environment',
        )
        setLlmModel(settings.llm.model || savedLlmPreset.defaultModel)
        setLlmBaseUrl(settings.llm.baseUrl || savedLlmPreset.defaultBaseUrl)
        setImageProvider(lockedImagePreset.id)
        setImageApiKey(settings.image.provider === lockedImagePreset.id ? settings.image.apiKey : '')
        setImageUseBuiltinKey(settings.image.provider === lockedImagePreset.id ? settings.image.useBuiltinKey : true)
        setImageBuiltinAvailable(settings.image.provider === lockedImagePreset.id ? settings.image.builtinKeyAvailable : true)
        setImageBuiltinSource(
          settings.image.provider === lockedImagePreset.id && settings.image.builtinKeySource !== 'none'
            ? settings.image.builtinKeySource
            : 'environment',
        )
        setImageModel(lockedImagePreset.defaultModel)
        setImageEndpoint(lockedImagePreset.defaultEndpoint)
        setRewriteRequirements(settings.defaults.rewriteRequirements)
        setRefTopic(settings.defaults.referenceTopic)
        setRefYearFrom(settings.defaults.referenceYearFrom)
        setRefYearTo(settings.defaults.referenceYearTo)
        setRefTargetCount(settings.defaults.referenceCount)
        setRefSoftFloorPercent(settings.defaults.referenceSoftFloorPercent)
        setRefCandidatePoolSize(settings.defaults.referenceCandidatePoolSize)
        setRefAnalysisWindow(settings.defaults.referenceAnalysisWindow)
        setContinueGoal(settings.defaults.continueGoal)
        setContinueWords(settings.defaults.targetWords)
        setImageAspectRatio(settings.defaults.imageAspectRatio)
        setGenLanguage(settings.defaults.language)
        setGenPaperType(settings.defaults.paperType)
        setGenNoImageMode(settings.defaults.noImageMode)
        setGenCitationMode(localStorage.getItem('ai_tool_gen_citation_mode') === 'inline' ? 'inline' : FALLBACK_TOOL_SETTINGS.genCitationMode)
        setGenYearFrom(settings.defaults.yearFrom)
        setGenYearTo(settings.defaults.yearTo)
        setGenExtraContext(settings.defaults.extraContext)
        syncToolSettingsToLocalStorage(settings)
      } finally {
        setLoading(false)
      }
    }
    void bootstrap()
  }, [])

  const handleSaveToolSettings = async (): Promise<boolean> => {
    setSaving(true)
    setStatusMessage('')
    setStatusError(false)
    try {
      const nextSettings = await window.electronAPI.saveSettings({
        llm: {
          provider: llmProvider,
          apiKey: llmUseBuiltinKey ? '' : llmApiKey.trim(),
          useBuiltinKey: llmUseBuiltinKey,
          builtinKeyAvailable: llmBuiltinAvailable,
          builtinKeySource: llmUseBuiltinKey ? llmBuiltinSource : 'none',
          model: llmModel.trim() || getLlmProviderPreset(llmProvider).defaultModel,
          baseUrl: llmBaseUrl.trim() || getLlmProviderPreset(llmProvider).defaultBaseUrl,
        },
        image: {
          provider: lockedImagePreset.id,
          apiKey: imageUseBuiltinKey ? '' : imageApiKey.trim(),
          useBuiltinKey: imageUseBuiltinKey,
          builtinKeyAvailable: imageBuiltinAvailable,
          builtinKeySource: imageUseBuiltinKey ? imageBuiltinSource : 'none',
          model: lockedImagePreset.defaultModel,
          endpoint: lockedImagePreset.defaultEndpoint,
        },
        defaults: {
          language: genLanguage as AppSettings['defaults']['language'],
          paperType: genPaperType as AppSettings['defaults']['paperType'],
          noImageMode: genNoImageMode,
          yearFrom: genYearFrom.trim(),
          yearTo: genYearTo.trim(),
          extraContext: genExtraContext.trim(),
          continueGoal: continueGoal.trim(),
          targetWords: Math.max(80, Math.min(10000, Number(continueWords) || FALLBACK_TOOL_SETTINGS.continueWords)),
          rewriteRequirements: rewriteRequirements.trim(),
          referenceTopic: refTopic.trim(),
          referenceYearFrom: refYearFrom.trim(),
          referenceYearTo: refYearTo.trim(),
          referenceCount: Math.max(1, Math.min(80, Number(refTargetCount) || FALLBACK_TOOL_SETTINGS.refTargetCount)),
          referenceSoftFloorPercent: Math.max(0, Math.min(100, Number(refSoftFloorPercent) || 0)),
          referenceCandidatePoolSize: Math.max(20, Math.min(1000, Number(refCandidatePoolSize) || FALLBACK_TOOL_SETTINGS.refCandidatePoolSize)),
          referenceAnalysisWindow: Math.max(5, Math.min(120, Number(refAnalysisWindow) || FALLBACK_TOOL_SETTINGS.refAnalysisWindow)),
          livePreview: true,
          imageAspectRatio: imageAspectRatio as AppSettings['defaults']['imageAspectRatio'],
        },
      })
      setLlmProvider(nextSettings.llm.provider)
      setLlmApiKey(nextSettings.llm.apiKey)
      setLlmUseBuiltinKey(nextSettings.llm.useBuiltinKey)
      setLlmBuiltinAvailable(nextSettings.llm.builtinKeyAvailable)
      setLlmBuiltinSource(nextSettings.llm.builtinKeySource)
      setLlmModel(nextSettings.llm.model)
      setLlmBaseUrl(nextSettings.llm.baseUrl)
      setImageApiKey(nextSettings.image.apiKey)
      setImageUseBuiltinKey(nextSettings.image.useBuiltinKey)
      setImageBuiltinAvailable(nextSettings.image.builtinKeyAvailable)
      setImageBuiltinSource(nextSettings.image.builtinKeySource)
      syncToolSettingsToLocalStorage(nextSettings)
      localStorage.setItem('ai_tool_rewrite_language', rewriteLanguage)
      localStorage.setItem('ai_tool_gen_citation_mode', genCitationMode)
      setStatusMessage('设置已保存，后续文字生成、图片生成、文献检索和续写将按这些预设执行。')
      window.dispatchEvent(new CustomEvent('ai-settings-updated', { detail: nextSettings }))
      return true
    } catch (error) {
      setStatusError(true)
      setStatusMessage(error instanceof Error ? error.message : String(error))
      return false
    } finally {
      setSaving(false)
    }
  }

  const handleTestText = async () => {
    setTestingText(true)
    setStatusMessage('')
    setStatusError(false)
    try {
      const saveSucceeded = await handleSaveToolSettings()
      if (!saveSucceeded) {
        return
      }
      const result = await window.electronAPI.testLlmConnection()
      setStatusMessage(`文字模型连通成功: ${result}`)
    } catch (error) {
      setStatusError(true)
      setStatusMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setTestingText(false)
    }
  }

  const handleTestImage = async () => {
    setTestingImage(true)
    setStatusMessage('')
    setStatusError(false)
    try {
      const saveSucceeded = await handleSaveToolSettings()
      if (!saveSucceeded) {
        return
      }
      const result = await window.electronAPI.testImageConnection()
      setStatusMessage(`图片模型连通成功: ${result}`)
    } catch (error) {
      setStatusError(true)
      setStatusMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setTestingImage(false)
    }
  }

  if (loading) {
    return <Panel><StatusBox>正在加载设置...</StatusBox></Panel>
  }

  const handleLlmProviderChange = (newProvider: LlmProvider) => {
    const preset = getLlmProviderPreset(newProvider)
    setLlmProvider(newProvider)
    setLlmModel(preset.defaultModel)
    setLlmBaseUrl(preset.defaultBaseUrl)
    setLlmApiKey('')
    // 乐观估计：支持内置 Key 的供应商先保持可用，保存后后端返回真实结果
    const canBuiltin = supportsBuiltinLlmProvider(newProvider)
    setLlmBuiltinAvailable(canBuiltin)
    setLlmUseBuiltinKey(canBuiltin)
  }

  const llmBuiltinSupported = supportsBuiltinLlmProvider(llmProvider) && llmBuiltinAvailable
  const imageBuiltinSupported = supportsBuiltinImageProvider(imageProvider) && imageBuiltinAvailable

  return (
    <Panel>
      {statusMessage && <StatusBox $error={statusError}>{statusMessage}</StatusBox>}

      <Section>
        <SectionHeader>
          <SectionTitle>文字模型设置</SectionTitle>
          <SectionDesc>选择 AI 供应商并填写对应的 API Key；内置 Key 可用时无需填写。</SectionDesc>
        </SectionHeader>
        <SectionBody>
          <Field>
            <Label>供应商</Label>
            <SmallSelect value={llmProvider} onChange={(e) => handleLlmProviderChange(e.target.value as LlmProvider)}>
              {(Object.values(LLM_PROVIDER_PRESETS) as typeof LLM_PROVIDER_PRESETS[keyof typeof LLM_PROVIDER_PRESETS][]).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}{p.builtinKeySupported ? ' ✦' : ''}
                </option>
              ))}
            </SmallSelect>
            <Hint style={{ marginTop: 4 }}>✦ 标注的供应商支持软件内置 Key（学校 / 平台提供），无需自备 Key。</Hint>
          </Field>
          <Field>
            <Label>模型名</Label>
            <Input
              type="text"
              value={llmModel}
              onChange={(e) => setLlmModel(e.target.value)}
              placeholder={getLlmProviderPreset(llmProvider).defaultModel}
            />
          </Field>
          <Field>
            <Label>接口地址 (Base URL)</Label>
            <Input
              type="text"
              value={llmBaseUrl}
              onChange={(e) => setLlmBaseUrl(e.target.value)}
              placeholder={getLlmProviderPreset(llmProvider).defaultBaseUrl}
            />
          </Field>
          <ToggleRow>
            <ToggleMeta>
              <ToggleTitle>内置默认 Key</ToggleTitle>
              <ToggleDesc>
                {llmBuiltinSupported
                  ? `当前供应商支持软件内置 Key，界面不会显示其明文。当前来源：${formatBuiltinKeySource(llmBuiltinSource)}。`
                  : supportsBuiltinLlmProvider(llmProvider)
                    ? `当前构建里没有可用的内置 ${formatProviderLabel(llmProvider)} Key，请改用你自己的 Key。`
                    : '当前供应商不支持软件内置默认 Key，请填写自己的 Key。'}
              </ToggleDesc>
            </ToggleMeta>
            <ToggleButton
              type="button"
              $active={llmUseBuiltinKey}
              disabled={!llmBuiltinSupported}
              onClick={() => setLlmUseBuiltinKey((current) => (llmBuiltinSupported ? !current : current))}
            >
              {llmUseBuiltinKey ? '使用内置 Key' : '使用自定义 Key'}
            </ToggleButton>
          </ToggleRow>
          <Field>
            <Label>API Key</Label>
            <Input
              type="password"
              value={llmUseBuiltinKey ? '' : llmApiKey}
              disabled={llmUseBuiltinKey}
              onChange={(e) => setLlmApiKey(e.target.value)}
              placeholder={llmUseBuiltinKey ? '当前使用软件内置默认 Key，明文不会显示' : '输入文字模型 API Key'}
            />
          </Field>
          <Row>
            <Btn onClick={() => void handleTestText()} disabled={testingText}>{testingText ? '检测中...' : '检测文字模型'}</Btn>
          </Row>
        </SectionBody>
      </Section>

      <Section>
        <SectionHeader>
          <SectionTitle>图片模型设置</SectionTitle>
          <SectionDesc>当前版本固定为 {lockedImagePreset.label} 默认链路，暂不开放图片供应商切换。</SectionDesc>
        </SectionHeader>
        <SectionBody>
          <Hint>当前固定供应商：{lockedImagePreset.label}；模型：{lockedImagePreset.defaultModel}；接口：{lockedImagePreset.defaultEndpoint}。</Hint>
          <ToggleRow>
            <ToggleMeta>
              <ToggleTitle>内置默认 Key</ToggleTitle>
              <ToggleDesc>
                {imageBuiltinSupported
                  ? `当前供应商支持软件内置 Key，界面不会显示其明文。当前来源：${formatBuiltinKeySource(imageBuiltinSource)}。`
                  : imageProvider === 'nanobanana'
                    ? `当前构建里没有可用的内置 ${lockedImagePreset.label} Key，请改用你自己的 Key。`
                    : `只有 ${lockedImagePreset.label} 供应商支持软件内置默认 Key。`}
              </ToggleDesc>
            </ToggleMeta>
            <ToggleButton
              type="button"
              $active={imageUseBuiltinKey}
              disabled={!imageBuiltinSupported}
              onClick={() => setImageUseBuiltinKey((current) => (imageBuiltinSupported ? !current : current))}
            >
              {imageUseBuiltinKey ? '使用内置 Key' : '使用自定义 Key'}
            </ToggleButton>
          </ToggleRow>
          <Field>
            <Label>API Key</Label>
            <Input
              type="password"
              value={imageUseBuiltinKey ? '' : imageApiKey}
              disabled={imageUseBuiltinKey}
              onChange={(e) => setImageApiKey(e.target.value)}
              placeholder={imageUseBuiltinKey ? '当前使用软件内置默认 Key，明文不会显示' : '输入图片模型 API Key'}
            />
          </Field>
          <Field>
            <Label>默认图片比例</Label>
            <SmallSelect value={imageAspectRatio} onChange={(e) => setImageAspectRatio(e.target.value)}>
              <option value="1:1">1:1</option>
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
              <option value="4:3">4:3</option>
              <option value="3:4">3:4</option>
              <option value="auto">自动</option>
            </SmallSelect>
          </Field>
          <Row>
            <Btn onClick={() => void handleTestImage()} disabled={testingImage}>{testingImage ? '检测中...' : '检测图片模型'}</Btn>
          </Row>
        </SectionBody>
      </Section>

      <Section>
        <SectionHeader>
          <SectionTitle>论文与文献预设</SectionTitle>
          <SectionDesc>设置默认论文类型、写作语言、文献年份范围，以及候选池、分析窗口和最终引用目标。</SectionDesc>
        </SectionHeader>
        <SectionBody>
          <Row>
            <Col>
              <Label>默认文章类型</Label>
              <SmallSelect value={genPaperType} onChange={(e) => setGenPaperType(e.target.value)}>
                <option value="review">综述论文</option>
                <option value="research">研究论文</option>
                <option value="thesis_research">学位论文</option>
              </SmallSelect>
            </Col>
            <Col>
              <Label>默认写作语言</Label>
              <SmallSelect value={genLanguage} onChange={(e) => setGenLanguage(e.target.value)}>
                <option value="zh">中文</option>
                <option value="en">English</option>
              </SmallSelect>
            </Col>
          </Row>
          <ToggleRow>
            <ToggleMeta>
              <ToggleTitle>默认无图模式</ToggleTitle>
              <ToggleDesc>开启后，按当前预设发起的整篇生成会跳过自动配图；关闭后允许正文里自动插图。</ToggleDesc>
            </ToggleMeta>
            <ToggleButton
              type="button"
              $active={!genNoImageMode}
              onClick={() => setGenNoImageMode((current) => !current)}
            >
              {genNoImageMode ? '无图模式' : '自动配图'}
            </ToggleButton>
          </ToggleRow>
          <Field>
            <Label>默认引用策略</Label>
            <SmallSelect value={genCitationMode} onChange={(e) => setGenCitationMode(e.target.value as ToolSettings['genCitationMode'])}>
              <option value="deferred">先写后引</option>
              <option value="inline">边写边引</option>
            </SmallSelect>
          </Field>
          <Row>
            <Col>
              <Label>整篇生成文献起始年份</Label>
              <Input value={genYearFrom} onChange={(e) => setGenYearFrom(e.target.value)} placeholder="如 2021" />
            </Col>
            <Col>
              <Label>整篇生成文献截止年份</Label>
              <Input value={genYearTo} onChange={(e) => setGenYearTo(e.target.value)} placeholder="如 2026" />
            </Col>
          </Row>
          <Field>
            <Label>默认引文检索主题</Label>
            <Input value={refTopic} onChange={(e) => setRefTopic(e.target.value)} placeholder="为空时使用当前选中文本检索" />
          </Field>
          <Row>
            <Col>
              <Label>引文检索起始年份</Label>
              <Input value={refYearFrom} onChange={(e) => setRefYearFrom(e.target.value)} placeholder="如 2018" />
            </Col>
            <Col>
              <Label>引文检索截止年份</Label>
              <Input value={refYearTo} onChange={(e) => setRefYearTo(e.target.value)} placeholder="如 2026" />
            </Col>
          </Row>
          <Row>
            <Col>
              <Label>最终目标引用条数</Label>
              <Input type="number" min={1} max={80} value={refTargetCount} onChange={(e) => setRefTargetCount(Number(e.target.value) || FALLBACK_TOOL_SETTINGS.refTargetCount)} />
            </Col>
            <Col>
              <Label>Soft 模式最低达成比例</Label>
              <Input type="number" min={0} max={100} value={refSoftFloorPercent} onChange={(e) => setRefSoftFloorPercent(Number(e.target.value) || 0)} />
            </Col>
          </Row>
          <Field>
            <Hint>仅在 soft 模式下生效。比如目标 40、比例 80%，则系统会尽量保证最终不少于 32 条唯一参考文献，同时仍保持“相关性优先、不强行凑满”的策略。</Hint>
          </Field>
          <Row>
            <Col>
              <Label>候选池检索条数</Label>
              <Input type="number" min={20} max={1000} value={refCandidatePoolSize} onChange={(e) => setRefCandidatePoolSize(Number(e.target.value) || FALLBACK_TOOL_SETTINGS.refCandidatePoolSize)} />
            </Col>
            <Col>
              <Label>每轮引用分析窗口</Label>
              <Input type="number" min={5} max={120} value={refAnalysisWindow} onChange={(e) => setRefAnalysisWindow(Number(e.target.value) || FALLBACK_TOOL_SETTINGS.refAnalysisWindow)} />
            </Col>
          </Row>
          <Field>
            <Hint>候选池只检索一次；正文每轮只从其中抽取这个窗口大小的文献喂给引用分析，避免全文生成明显变慢。</Hint>
          </Field>
          <Field>
            <Label>补充说明</Label>
            <TextArea value={genExtraContext} onChange={(e) => setGenExtraContext(e.target.value)} placeholder="例如：强调临床应用、必须包含方法比较、限制引用近五年文献" />
          </Field>
        </SectionBody>
      </Section>

      <Section>
        <SectionHeader>
          <SectionTitle>续写与重写预设</SectionTitle>
          <SectionDesc>统一设置续写字数、续写目标和重写要求，编辑器右键动作会直接读取这些配置。</SectionDesc>
        </SectionHeader>
        <SectionBody>
          <Field>
            <Label>续写目标</Label>
            <Input value={continueGoal} onChange={(e) => setContinueGoal(e.target.value)} placeholder="如：补全方法与讨论部分" />
          </Field>
          <Field>
            <Label>默认续写字数</Label>
            <Input type="number" min={80} max={10000} value={continueWords} onChange={(e) => setContinueWords(Number(e.target.value) || FALLBACK_TOOL_SETTINGS.continueWords)} />
          </Field>
          <Field>
            <Label>重写语言</Label>
            <SmallSelect value={rewriteLanguage} onChange={(e) => setRewriteLanguage(e.target.value)}>
              <option value="auto">自动保持原文语言</option>
              <option value="zh">中文</option>
              <option value="en">English</option>
            </SmallSelect>
          </Field>
          <Field>
            <Label>重写要求</Label>
            <TextArea value={rewriteRequirements} onChange={(e) => setRewriteRequirements(e.target.value)} placeholder="如：保留术语，增强逻辑衔接，避免口语化表达" />
          </Field>
          <Hint>这里保存的是默认预设。真正生成时，底部终端输入的任务主题会覆盖当前任务的主题描述。</Hint>
        </SectionBody>
      </Section>

      <Row>
        <Btn $primary onClick={() => void handleSaveToolSettings()} disabled={saving}>{saving ? '保存中...' : '保存全部设置'}</Btn>
      </Row>

      <div style={{ marginTop: 14, textAlign: 'center' }}>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('open-sidebar-tab', { detail: { tab: 'account' } }))}
          style={{ background: 'none', border: 'none', color: '#0e639c', fontSize: 14, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
        >
          内部账号设置 →
        </button>
      </div>
    </Panel>
  )
}

export default FullSettingsPanel