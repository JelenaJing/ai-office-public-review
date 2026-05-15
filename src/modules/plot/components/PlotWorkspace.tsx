import React, { useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'
import { useDocument } from '../../../contexts/DocumentContext'
import { useGenerationWorkbench } from '../../../contexts/GenerationWorkbenchContext'
import { useWorkspace } from '../../../contexts/WorkspaceContext'
import {
  addRealtimePlotBatch,
  addRealtimePlotPoint,
  createRealtimePlotSession,
  deleteRealtimePlotSession,
  generatePlotFromFile,
  getPlotAgentStatus,
  getPlotChartTypes,
  getRealtimePlot,
  getRealtimePlotStatus,
  recommendPlotFromFile,
  type PlotAgentStatus,
  type PlotChartTypeInfo,
  type PlotRecommendationItem,
  type PlotRecommendationResponse,
  type RealtimePlotSessionStatus,
  type RealtimePlotUpdateResponse,
} from '../services/PlotService'
import { toFileUrl as toSharedFileUrl } from '../../../shared/url/fileUrlHelper'

const Wrapper = styled.div`display:flex;flex-direction:column;height:100%;overflow-y:auto;padding:12px 16px 20px;background:#f6f8fb;`
const DropZone = styled.button`width:100%;padding:24px 16px;border:2px dashed #cbd5e1;border-radius:12px;background:#fff;color:#64748b;font-size:var(--font-size-sm);cursor:pointer;text-align:center;line-height:2;transition:border-color .2s,background .2s;&:hover{border-color:#2563eb;background:#eff6ff;color:#1d4ed8;}`
const FilePill = styled.div`display:flex;align-items:center;justify-content:space-between;border:1px solid #d1fae5;border-radius:8px;background:#f0fdf4;padding:8px 12px;font-size:var(--font-size-xs);color:#065f46;`
const FilePillName = styled.span`font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px;`
const RePickBtn = styled.button`border:1px solid #a7f3d0;border-radius:6px;background:#fff;color:#065f46;font-size:var(--font-size-xs);padding:3px 8px;cursor:pointer;flex-shrink:0;&:hover{background:#d1fae5;}`
const AnalyzingBox = styled.div`margin-top:10px;padding:14px 16px;border-radius:10px;background:#eff6ff;border:1px solid #bfdbfe;color:#1d4ed8;font-size:var(--font-size-sm);display:flex;align-items:center;gap:8px;`
const RecommendCard = styled.div`margin-top:10px;border-radius:10px;border:1px solid #dbe3ef;background:#fff;overflow:hidden;`
const RecommendCardHeader = styled.div`padding:12px 14px 10px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between;`
const ChartTypeBadge = styled.div`display:inline-flex;align-items:center;gap:6px;background:linear-gradient(135deg,#0f766e,#2563eb);color:#fff;border-radius:8px;padding:5px 12px;font-size:var(--font-size-sm);font-weight:700;`
const ConfPill = styled.span<{ $level: 'high' | 'mid' | 'low' }>`border-radius:999px;padding:2px 8px;font-size:var(--font-size-xs);font-weight:600;background:${p => p.$level === 'high' ? '#d1fae5' : p.$level === 'mid' ? '#fef9c3' : '#fee2e2'};color:${p => p.$level === 'high' ? '#065f46' : p.$level === 'mid' ? '#854d0e' : '#991b1b'};`
const ReasonText = styled.div`padding:10px 14px;font-size:var(--font-size-xs);color:#475569;line-height:1.7;`
const AltRow = styled.div`padding:6px 14px 12px;display:flex;flex-wrap:wrap;gap:6px;`
const AltBtn = styled.button<{ $active?: boolean }>`border:1px solid ${p => p.$active ? '#2563eb' : '#dbe3ef'};border-radius:999px;background:${p => p.$active ? '#dbeafe' : '#f8fafc'};color:${p => p.$active ? '#1d4ed8' : '#475569'};font-size:var(--font-size-xs);font-weight:600;padding:3px 10px;cursor:pointer;`
const Section = styled.div`margin-top:12px;`
const SectionTitle = styled.div`font-size:var(--font-size-xs);font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;`
const Label = styled.label`font-size:var(--font-size-xs);color:#64748b;display:block;margin-bottom:3px;`
const FieldStack = styled.div`display:flex;flex-direction:column;gap:8px;`
const FieldRow = styled.div`display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;`
const Input = styled.input`width:100%;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:var(--font-size-xs);outline:none;background:#fff;color:#1f2937;box-sizing:border-box;&:focus{border-color:#2563eb;}`
const Select = styled.select`width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-size:var(--font-size-xs);outline:none;background:#fff;color:#1f2937;`
const GenerateBtn = styled.button`margin-top:14px;width:100%;padding:12px 20px;border:none;border-radius:10px;background:linear-gradient(135deg,#0f766e,#2563eb);color:#fff;font-size:14px;font-weight:700;cursor:pointer;letter-spacing:.02em;&:disabled{opacity:.5;cursor:not-allowed;}`
const ChipRow = styled.div`display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;`
const Chip = styled.span`display:inline-flex;align-items:center;border:1px solid #dbe3ef;border-radius:999px;background:#fff;padding:2px 8px;font-size:var(--font-size-xs);color:#475569;`
const TinyBtn = styled.button`border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#1f2937;font-size:var(--font-size-xs);padding:6px 10px;cursor:pointer;`
const StatusBox = styled.div<{ $error?: boolean }>`margin-top:10px;padding:8px 12px;border-radius:8px;border:1px solid ${p => p.$error ? '#fecaca' : '#e2e8f0'};background:${p => p.$error ? '#fef2f2' : '#f8fafc'};color:${p => p.$error ? '#991b1b' : '#64748b'};font-size:var(--font-size-xs);line-height:1.7;`

function toFileUrl(localPath: string): string {
  return toSharedFileUrl(localPath)
}

function sanitizeFileName(value: string): string {
  return String(value || '').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || `plot_${Date.now()}`
}

function stripDataUrlPrefix(value: string): string {
  const match = String(value || '').match(/^data:[^;]+;base64,(.*)$/)
  return match ? match[1] : String(value || '')
}

function pathBaseName(filePath: string): string {
  const normalized = String(filePath || '').split(/[\\/]/).pop() || 'plot'
  return normalized.replace(/\.[^.]+$/, '')
}

function isSupportedDataFile(filePath: string): boolean {
  return /\.(csv|json|xlsx|xls)$/i.test(String(filePath || ''))
}

function normalizePreviewUrl(imageOrPath: string): string {
  if (/^data:image\//.test(imageOrPath)) return imageOrPath
  return toFileUrl(imageOrPath)
}

function parseJsonObject(text: string): Record<string, unknown> {
  const parsed = JSON.parse(text)
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('需要传入单个 JSON 对象，例如 {"x": 1, "y": 2}')
  }
  return parsed as Record<string, unknown>
}

function parseJsonArray(text: string): Array<Record<string, unknown>> {
  const parsed = JSON.parse(text)
  if (!Array.isArray(parsed)) {
    throw new Error('需要传入 JSON 数组，例如 [{"x": 1, "y": 2}]')
  }
  return parsed.filter((item) => item && typeof item === 'object') as Array<Record<string, unknown>>
}

const PlotWorkspace: React.FC = () => {
  const { setStatusMessage } = useDocument()
  const { activeWorkspacePath, refreshTree } = useWorkspace()
  const workbench = useGenerationWorkbench()

  const [activePanel, setActivePanel] = useState<'static' | 'realtime'>('static')
  const [dataFilePath, setDataFilePath] = useState('')
  const [serviceStatus, setServiceStatus] = useState<PlotAgentStatus | null>(null)
  const [chartTypes, setChartTypes] = useState<PlotChartTypeInfo[]>([])
  const [recommendation, setRecommendation] = useState<PlotRecommendationResponse | null>(null)
  const [selectedChartType, setSelectedChartType] = useState('')
  const [mode, setMode] = useState<'smart' | 'manual'>('smart')
  const [style, setStyle] = useState<'publication' | 'default' | 'colorful'>('publication')
  const [xField, setXField] = useState('')
  const [yField, setYField] = useState('')
  const [hueField, setHueField] = useState('')
  const [titleField, setTitleField] = useState('')
  const [xlabelField, setXlabelField] = useState('')
  const [ylabelField, setYlabelField] = useState('')
  const [useLlmRecommend, setUseLlmRecommend] = useState(false)
  const [statusText, setStatusText] = useState('请选择数据文件后开始绘图。')
  const [recommending, setRecommending] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [realtimeChartType, setRealtimeChartType] = useState('line')
  const [realtimeTitle, setRealtimeTitle] = useState('')
  const [realtimeXLabel, setRealtimeXLabel] = useState('')
  const [realtimeYLabel, setRealtimeYLabel] = useState('')
  const [realtimeSessionId, setRealtimeSessionId] = useState('')
  const [realtimeSessionStatus, setRealtimeSessionStatus] = useState<RealtimePlotSessionStatus | null>(null)
  const [realtimePointInput, setRealtimePointInput] = useState('{\n  "x": 1,\n  "y": 2\n}')
  const [realtimeBatchInput, setRealtimeBatchInput] = useState('[\n  { "x": 1, "y": 2 },\n  { "x": 2, "y": 3 },\n  { "x": 3, "y": 5 }\n]')
  const [realtimePreviewUrl, setRealtimePreviewUrl] = useState('')
  const [realtimeImageDataUrl, setRealtimeImageDataUrl] = useState('')
  const [realtimeBusy, setRealtimeBusy] = useState(false)

  useEffect(() => {
    void Promise.all([getPlotAgentStatus(), getPlotChartTypes()])
      .then(([status, types]) => {
        setServiceStatus(status)
        setChartTypes(Array.isArray(types.chart_types) ? types.chart_types : [])
        const firstChartType = Array.isArray(types.chart_types) && types.chart_types[0]
          ? String(types.chart_types[0].chart_type || '')
          : ''
        if (!selectedChartType && firstChartType) setSelectedChartType(firstChartType)
        if (firstChartType && realtimeChartType === 'line' && !chartTypes.length) setRealtimeChartType(firstChartType)
      })
      .catch((error) => {
        setStatusText(error instanceof Error ? error.message : String(error))
      })
  }, [])

  const chartTypeOptions = useMemo(() => {
    const fromTypes = chartTypes.map((item) => item.chart_type)
    const fromRecommendation = (recommendation?.recommendations || []).map((item) => item.chart_type)
    return Array.from(new Set([...fromRecommendation, ...fromTypes])).filter(Boolean)
  }, [chartTypes, recommendation])

  const refreshServiceStatus = async () => {
    try {
      setServiceStatus(await getPlotAgentStatus())
    } catch {
      // ignore
    }
  }

  const handlePickDataFile = async () => {
    const filePath = await window.electronAPI.openFileDialog()
    if (!filePath) return
    if (!isSupportedDataFile(filePath)) {
      setStatusText('当前支持 CSV、JSON、XLSX、XLS 数据文件。')
      setStatusMessage('当前支持 CSV、JSON、XLSX、XLS 数据文件')
      return
    }
    setDataFilePath(filePath)
    setRecommendation(null)
    setSelectedChartType('')
    setMode('smart')
    setXField('')
    setYField('')
    setHueField('')
    setTitleField('')
    setXlabelField('')
    setYlabelField('')
    // Auto-trigger AI recommendation immediately after file selection
    await handleRecommend(filePath)
  }

  const applyRecommendationSelection = (item: PlotRecommendationItem) => {
    setMode('smart')
    setSelectedChartType(item.chart_type)
    const params = item.suggested_parameters || {}
    setXField(typeof params.x === 'string' ? params.x : '')
    setYField(typeof params.y === 'string' ? params.y : '')
    setHueField(typeof params.hue === 'string' ? params.hue : '')
    setTitleField(typeof params.title === 'string' ? params.title : '')
    setXlabelField(typeof params.xlabel === 'string' ? params.xlabel : '')
    setYlabelField(typeof params.ylabel === 'string' ? params.ylabel : '')
  }

  const handleRecommend = async (overrideFilePath?: string) => {
    const path = overrideFilePath || dataFilePath
    if (!path) return
    setRecommending(true)
    setStatusText('正在分析数据并获取图表推荐...')
    setStatusMessage('正在获取绘图推荐...')
    try {
      const result = await recommendPlotFromFile(path, useLlmRecommend)
      setRecommendation(result)
      const firstItem = (result.recommendations || [])[0]
      if (firstItem) applyRecommendationSelection(firstItem)
      else setSelectedChartType(result.recommended_chart)
      setStatusText(`推荐完成，首选图表为 ${result.recommended_chart}`)
      setStatusMessage(`绘图推荐完成: ${result.recommended_chart}`)
      await refreshServiceStatus()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatusText(message)
      setStatusMessage(`绘图推荐失败: ${message}`)
    } finally {
      setRecommending(false)
    }
  }

  /** Push generated image to the main center stage. If workspace is open, also saves to file. */
  const pushPlotToStage = async (imageDataUrl: string, chartType: string, sourceName: string) => {
    if (activeWorkspacePath) {
      const structure = await window.electronAPI.detectProjectStructure(activeWorkspacePath)
      const filename = `${sanitizeFileName(sourceName)}_${chartType}_${Date.now()}.png`
      const base64Data = stripDataUrlPrefix(imageDataUrl)
      const saved = structure?.hasFigures
        ? await window.electronAPI.saveImageToFiguresBase64(activeWorkspacePath, filename, base64Data)
        : await window.electronAPI.saveImageToWorkspace(activeWorkspacePath, filename, base64Data)

      workbench.setGenerationResult({
        resultPreviewUrl: toFileUrl(saved.path),
        resultPath: saved.path,
        resultTitle: `${chartType} 图表 — ${saved.filename}`,
      })
      void refreshTree().catch(() => undefined)
      setStatusText('图表已生成并保存到工作区，可在主区点击「插入编辑器」插入文稿。')
      setStatusMessage('图表已生成，可从主区插入编辑器')
    } else {
      // No workspace: push base64 directly so main stage can display & insert it
      workbench.setGenerationResult({
        resultPreviewUrl: imageDataUrl,
        resultPath: null,
        resultTitle: `${chartType} 图表`,
      })
      setStatusText('图表已生成，可在主区点击「插入编辑器」插入文稿。打开工作区后可保存。')
      setStatusMessage('图表已生成，可从主区插入编辑器')
    }
  }

  const handleGenerate = async () => {
    if (!dataFilePath || !selectedChartType) return
    setGenerating(true)
    setStatusText(`正在生成 ${selectedChartType} 图表...`)
    setStatusMessage(`正在生成 ${selectedChartType} 图表...`)
    try {
      const manualRequested = mode === 'manual' && (xField || yField || hueField)
      const result = await generatePlotFromFile(dataFilePath, selectedChartType, {
        mode: manualRequested ? 'manual' : 'smart',
        x: xField || undefined,
        y: yField || undefined,
        hue: hueField || undefined,
        title: titleField || undefined,
        xlabel: xlabelField || undefined,
        ylabel: ylabelField || undefined,
        style,
      })
      if (!result.success || !result.image) {
        throw new Error(result.message || '图表生成失败')
      }
      await pushPlotToStage(result.image, result.chart_type, pathBaseName(dataFilePath))
      await refreshServiceStatus()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatusText(message)
      setStatusMessage(`图表生成失败: ${message}`)
    } finally {
      setGenerating(false)
    }
  }

  const applyRealtimeUpdate = (result: RealtimePlotUpdateResponse, fallbackChartType: string) => {
    if (result.image) {
      setRealtimeImageDataUrl(result.image)
      setRealtimePreviewUrl(normalizePreviewUrl(result.image))
    }
    setRealtimeSessionStatus(result.status)
    setStatusText(`实时绘图已更新，当前点数 ${result.status.point_count}`)
    setStatusMessage(`实时绘图已更新: ${fallbackChartType}`)
  }

  const handleCreateRealtimeSession = async () => {
    if (!realtimeChartType) return
    setRealtimeBusy(true)
    setStatusText('正在创建实时绘图会话...')
    try {
      const result = await createRealtimePlotSession({
        chartType: realtimeChartType,
        style,
        title: realtimeTitle || undefined,
        xlabel: realtimeXLabel || undefined,
        ylabel: realtimeYLabel || undefined,
      })
      setRealtimeSessionId(result.session_id)
      setRealtimeSessionStatus(result.status)
      setRealtimePreviewUrl('')
      setRealtimeImageDataUrl('')
      setStatusText(`实时绘图会话已创建: ${result.session_id}`)
      setStatusMessage('实时绘图会话已创建')
      await refreshServiceStatus()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatusText(message)
      setStatusMessage(`实时绘图会话创建失败: ${message}`)
    } finally {
      setRealtimeBusy(false)
    }
  }

  const handleRealtimeAddPoint = async () => {
    if (!realtimeSessionId) return
    setRealtimeBusy(true)
    try {
      const result = await addRealtimePlotPoint(realtimeSessionId, parseJsonObject(realtimePointInput))
      applyRealtimeUpdate(result, realtimeChartType)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatusText(message)
      setStatusMessage(`实时单点写入失败: ${message}`)
    } finally {
      setRealtimeBusy(false)
    }
  }

  const handleRealtimeAddBatch = async () => {
    if (!realtimeSessionId) return
    setRealtimeBusy(true)
    try {
      const result = await addRealtimePlotBatch(realtimeSessionId, parseJsonArray(realtimeBatchInput))
      applyRealtimeUpdate(result, realtimeChartType)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatusText(message)
      setStatusMessage(`实时批量写入失败: ${message}`)
    } finally {
      setRealtimeBusy(false)
    }
  }

  const handleRefreshRealtimePlot = async () => {
    if (!realtimeSessionId) return
    setRealtimeBusy(true)
    try {
      const [statusResult, plotResult] = await Promise.all([
        getRealtimePlotStatus(realtimeSessionId),
        getRealtimePlot(realtimeSessionId),
      ])
      setRealtimeSessionStatus(statusResult.status)
      applyRealtimeUpdate(plotResult, realtimeChartType)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatusText(message)
      setStatusMessage(`实时绘图刷新失败: ${message}`)
    } finally {
      setRealtimeBusy(false)
    }
  }

  const handleDeleteRealtimeSession = async () => {
    if (!realtimeSessionId) return
    setRealtimeBusy(true)
    try {
      await deleteRealtimePlotSession(realtimeSessionId)
      setRealtimeSessionId('')
      setRealtimeSessionStatus(null)
      setRealtimePreviewUrl('')
      setRealtimeImageDataUrl('')
      setStatusText('实时绘图会话已删除。')
      setStatusMessage('实时绘图会话已删除')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatusText(message)
      setStatusMessage(`实时绘图会话删除失败: ${message}`)
    } finally {
      setRealtimeBusy(false)
    }
  }

  const handleInsertRealtimePlot = async () => {
    if (!realtimeImageDataUrl) {
      setStatusText('当前还没有可插入的实时图像，请先创建会话并写入数据点。')
      return
    }
    await pushPlotToStage(realtimeImageDataUrl, realtimeChartType || 'realtime', realtimeSessionId || 'realtime_session')
  }

  const confLevel = (confidence: number): 'high' | 'mid' | 'low' =>
    confidence >= 0.75 ? 'high' : confidence >= 0.5 ? 'mid' : 'low'

  const chartEmoji = (type: string) => {
    const map: Record<string, string> = {
      bar: '📊', barh: '📊', line: '📈', scatter: '🔵', pie: '🥧',
      heatmap: '🟥', box: '📦', histogram: '📉', violin: '🎻', area: '📐',
      volcano: '🌋', waterfall: '💧', errorbar: '±️', contour: '〰️',
      streamplot: '🌊', polar: '🔄', radar: '🕸️', circular_bar: '⭕',
      wind_rose: '💨', smith: '📡', hexbin: '🔶', pareto: '📏',
      parallel_coords: '⟶', trellis: '🔲', scatter_3d: '🔵', surface_3d: '🏔️',
      bubble_3d: '🫧', network: '🕸️', wordcloud: '☁️', venn: '🔵',
      candlestick: '🕯️', treemap: '🗂️', funnel: '🔻', sankey: '↔️',
      gauge: '⏱️', bullet: '🎯', rose: '🌹', sunburst: '🌞',
      chord: '🎵', calendar_heatmap: '📅',
    }
    return map[type.toLowerCase()] || '📊'
  }

  const fileBaseName = dataFilePath ? (dataFilePath.split(/[\\/]/).pop() || dataFilePath) : ''
  const isIdle = !dataFilePath && !recommending
  const isAnalyzing = recommending
  const isReady = !!recommendation && !recommending
  const isError = /失败|错误|异常|未找到|不能为空|HTTP/i.test(statusText)

  return (
    <Wrapper>
      {/* ── 文件上传区 ── */}
      {isIdle ? (
        <DropZone onClick={() => void handlePickDataFile()}>
          <div style={{ fontSize: 28, marginBottom: 4 }}>📂</div>
          <div style={{ fontWeight: 600, color: '#334155' }}>点击上传数据文件</div>
          <div style={{ fontSize: 14, marginTop: 4 }}>支持 CSV · XLSX · XLS · JSON</div>
        </DropZone>
      ) : (
        <FilePill>
          <span style={{ fontSize: 16 }}>📄</span>
          <FilePillName title={dataFilePath}>{fileBaseName}</FilePillName>
          <RePickBtn onClick={() => void handlePickDataFile()}>更换文件</RePickBtn>
        </FilePill>
      )}

      {/* ── 分析中 ── */}
      {isAnalyzing ? (
        <AnalyzingBox>
          <span style={{ fontSize: 18 }}>⏳</span>
          <span>AI 正在分析数据结构，推荐最优绘图方案...</span>
        </AnalyzingBox>
      ) : null}

      {/* ── 推荐结果 ── */}
      {isReady && recommendation ? (() => {
        const recs = recommendation.recommendations || []
        const primary = recs[0]
        const alts = recs.slice(1)
        return (
          <RecommendCard>
            {primary ? (
              <RecommendCardHeader>
                <ChartTypeBadge>
                  <span>{chartEmoji(primary.chart_type)}</span>
                  <span>{primary.chart_type}</span>
                </ChartTypeBadge>
                <ConfPill $level={confLevel(primary.confidence)}>
                  置信度 {(primary.confidence * 100).toFixed(0)}%
                </ConfPill>
              </RecommendCardHeader>
            ) : null}
            {primary?.reasoning ? <ReasonText>{primary.reasoning}</ReasonText> : null}
            {alts.length > 0 ? (
              <AltRow>
                <span style={{ fontSize: 14, color: '#94a3b8', marginRight: 4 }}>备选:</span>
                {alts.map((item) => (
                  <AltBtn key={item.chart_type} $active={selectedChartType === item.chart_type} onClick={() => applyRecommendationSelection(item)}>
                    {chartEmoji(item.chart_type)} {item.chart_type}
                  </AltBtn>
                ))}
              </AltRow>
            ) : null}
          </RecommendCard>
        )
      })() : null}

      {/* ── 图表设置 ── */}
      {(isReady || (dataFilePath && !isAnalyzing)) ? (
        <Section>
          <SectionTitle>图表设置</SectionTitle>
          <FieldStack>
            <div>
              <Label>图表标题</Label>
              <Input value={titleField} onChange={(e) => setTitleField(e.target.value)} placeholder="留空由 AI 自动设定" />
            </div>
            <FieldRow>
              <div>
                <Label>X 轴标签</Label>
                <Input value={xlabelField} onChange={(e) => setXlabelField(e.target.value)} placeholder="自动" />
              </div>
              <div>
                <Label>Y 轴标签</Label>
                <Input value={ylabelField} onChange={(e) => setYlabelField(e.target.value)} placeholder="自动" />
              </div>
            </FieldRow>
            <FieldRow>
              <div>
                <Label>图表风格</Label>
                <Select value={style} onChange={(e) => setStyle(e.target.value as 'publication' | 'default' | 'colorful')}>
                  <option value="publication">发布级 (publication)</option>
                  <option value="default">默认 (default)</option>
                  <option value="colorful">彩色 (colorful)</option>
                </Select>
              </div>
              {!isReady ? (
                <div>
                  <Label>图表类型</Label>
                  <Select value={selectedChartType} onChange={(e) => setSelectedChartType(e.target.value)}>
                    <option value="">请选择</option>
                    {chartTypeOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                  </Select>
                </div>
              ) : null}
            </FieldRow>
          </FieldStack>
        </Section>
      ) : null}

      {/* ── 数据字段 (高级, 仅推荐后显示) ── */}
      {isReady && recommendation?.data_analysis?.columns?.length ? (
        <Section>
          <SectionTitle>字段映射（高级）</SectionTitle>
          <FieldRow>
            <div>
              <Label>X 字段</Label>
              <Select value={xField} onChange={(e) => { setMode('manual'); setXField(e.target.value) }}>
                <option value="">智能推断</option>
                {(recommendation.data_analysis.columns || []).map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>
            <div>
              <Label>Y 字段</Label>
              <Select value={yField} onChange={(e) => { setMode('manual'); setYField(e.target.value) }}>
                <option value="">智能推断</option>
                {(recommendation.data_analysis.columns || []).map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>
          </FieldRow>
          <ChipRow>
            {(recommendation.data_analysis.numeric_columns || []).map((c) => <Chip key={`n_${c}`}>数值: {c}</Chip>)}
            {(recommendation.data_analysis.categorical_columns || []).map((c) => <Chip key={`cat_${c}`}>分类: {c}</Chip>)}
          </ChipRow>
        </Section>
      ) : null}

      {/* ── 生成按钮 ── */}
      {(isReady || (dataFilePath && !isAnalyzing)) ? (
        <GenerateBtn onClick={() => void handleGenerate()} disabled={!dataFilePath || !selectedChartType || generating}>
          {generating ? '⏳ 生成中...' : '🎨 生成图表'}
        </GenerateBtn>
      ) : null}

      {/* ── 状态栏 ── */}
      <StatusBox $error={isError}>
        <div>{statusText}</div>
        {serviceStatus ? <div>Plot Agent: {serviceStatus.ready ? '✅ ready' : serviceStatus.running ? '🔄 starting' : '⏸ idle'}</div> : null}
        {serviceStatus?.lastError ? <div>错误: {serviceStatus.lastError}</div> : null}
      </StatusBox>
    </Wrapper>
  )
}

export default PlotWorkspace