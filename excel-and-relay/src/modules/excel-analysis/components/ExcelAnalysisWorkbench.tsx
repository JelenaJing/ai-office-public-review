import React, { useCallback, useEffect, useState } from 'react'
import styled from 'styled-components'
import { useWorkspace } from '../../../contexts/WorkspaceContext'
import { useGenerationWorkbench } from '../../../contexts/GenerationWorkbenchContext'
import { toFileUrl } from '../../../shared/url/fileUrlHelper'
import { listPlotDataModels, type PlotDataModelOption } from '../../plot/services/PlotService'

const Shell = styled.div`
  flex: 0 0 auto;
  width: 100%;
  display: flex;
  flex-direction: column;
  background: transparent;
`

const PhaseBanner = styled.div`
  flex-shrink: 0;
  padding: 8px 18px;
  font-size: 12px;
  font-weight: 600;
  color: #42576b;
  background: #eef2f7;
  border-bottom: 1px solid #dde3ec;
`

const Body = styled.div`
  flex: 0 0 auto;
  overflow: visible;
  padding: 14px 18px 10px;
  display: grid;
  gap: 12px;
  align-content: start;
`

const Card = styled.div`
  border: 1px solid rgba(203, 214, 226, 0.95);
  border-radius: 14px;
  background: linear-gradient(180deg, #ffffff 0%, #fafcfe 100%);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  padding: 16px 18px;
  display: grid;
  gap: 12px;
`

const Label = styled.div`
  font-size: 11px;
  font-weight: 800;
  color: #7a8ea2;
  letter-spacing: 0.04em;
`

const FileActionsRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
`

const ModelToggleRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
`

const ModelBtn = styled.button<{ $active?: boolean }>`
  height: 34px;
  padding: 0 16px;
  border-radius: 999px;
  border: 1px solid ${(p) => (p.$active ? '#1f6fd6' : '#c9d6e4')};
  background: ${(p) => (p.$active ? 'linear-gradient(180deg, #e8f2ff 0%, #dbeafe 100%)' : '#fff')};
  color: ${(p) => (p.$active ? '#0c4a9e' : '#334155')};
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
  &:hover:not(:disabled) {
    border-color: #1f6fd6;
    color: #0c4a9e;
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`

const Btn = styled.button`
  height: 34px;
  padding: 0 16px;
  border-radius: 8px;
  border: 1px solid #cad6e2;
  background: #fff;
  color: #304255;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  &:hover:not(:disabled) {
    background: #f5f8fc;
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`

const PrimaryBtn = styled(Btn)`
  border-color: #1f6fd6;
  background: #1f6fd6;
  color: #fff;
  &:hover:not(:disabled) {
    background: #195cb1;
    border-color: #195cb1;
  }
`

const HintLine = styled.div`
  font-size: 12px;
  line-height: 1.5;
  color: #6b7d90;
`

const FilePathLine = styled.div`
  font-size: 13px;
  line-height: 1.45;
  color: #243447;
  word-break: break-all;
`

const TextArea = styled.textarea`
  width: 100%;
  min-height: 100px;
  resize: vertical;
  padding: 10px 12px;
  border: 1px solid #d6e0ea;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.55;
  color: #1f2937;
  box-sizing: border-box;
  outline: none;
  &:focus {
    border-color: #1f6fd6;
  }
`

const ErrorBox = styled.div`
  padding: 12px 14px;
  border-radius: 8px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
  font-size: 13px;
  line-height: 1.5;
`

function isDataFile(p: string): boolean {
  return /\.(csv|xlsx|xls)$/i.test(String(p || ''))
}

export default function ExcelAnalysisWorkbench() {
  const { activeWorkspacePath, refreshTree } = useWorkspace()
  const workbench = useGenerationWorkbench()
  const [sourcePath, setSourcePath] = useState('')
  const [busy, setBusy] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const [plotDataModels, setPlotDataModels] = useState<PlotDataModelOption[]>([])
  const [selectedDataModelId, setSelectedDataModelId] = useState('')

  const canRun = Boolean(activeWorkspacePath && sourcePath && !busy)

  useEffect(() => {
    void listPlotDataModels().then(setPlotDataModels).catch(() => setPlotDataModels([]))
  }, [])

  useEffect(() => {
    const unsub = window.electronAPI?.onExcelAnalysisProgress?.((payload) => {
      const phase = String(payload?.phase || '').trim()
      if (!phase) return
      workbench.setGenerationStatus('running', phase)
    })
    return () => {
      unsub?.()
    }
  }, [workbench])

  const pickFile = useCallback(async () => {
    const fp = await window.electronAPI.openFileDialog()
    if (!fp || !isDataFile(fp)) return
    setSourcePath(fp)
    setLastError(null)
  }, [])

  const runAnalysis = useCallback(async () => {
    if (!activeWorkspacePath || !sourcePath) return
    setBusy(true)
    setLastError(null)
    workbench.clearCurrentResult()
    workbench.setGenerationStatus('running', '正在启动分析…')
    try {
      const raw = await window.electronAPI.excelAnalysisRun({
        workspacePath: activeWorkspacePath,
        sourcePath,
        userRequirement: workbench.generationPrompt,
        dataModelId: selectedDataModelId.trim() || '',
      })
      const ok = Boolean(raw?.ok)
      if (ok) {
        workbench.setGenerationStatus('completed', '分析完成')
        const imgs = (raw as { outputImages?: string[] }).outputImages || []
        if (imgs.length > 0) {
          workbench.setGenerationResult({
            resultChartPaths: imgs,
            resultPreviewUrl: toFileUrl(imgs[0]),
            resultPath: imgs[0],
            resultTitle: imgs.length > 1 ? `数据分析图表（${imgs.length} 张）` : '数据分析图表',
          })
        } else {
          workbench.setGenerationResult({
            resultChartPaths: [],
            resultPreviewUrl: null,
            resultPath: null,
            resultTitle: '数据分析',
          })
        }
        void refreshTree().catch(() => undefined)
      } else {
        const msg = String((raw as { error?: string })?.error || '分析失败')
        workbench.setGenerationStatus('error', msg)
        setLastError(msg)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      workbench.setGenerationStatus('error', msg)
      setLastError(msg)
    } finally {
      setBusy(false)
    }
  }, [activeWorkspacePath, refreshTree, selectedDataModelId, sourcePath, workbench])

  const phaseVisible = busy && workbench.generationStatus.phase === 'running' && Boolean(workbench.generationStatus.message?.trim())

  return (
    <Shell data-testid="excel-analysis-workbench">
      {phaseVisible ? (
        <PhaseBanner role="status" aria-live="polite">{workbench.generationStatus.message}</PhaseBanner>
      ) : null}
      <Body>
        {!activeWorkspacePath ? (
          <Card>
            <Label>提示</Label>
            <HintLine>请先打开或创建工作区。</HintLine>
          </Card>
        ) : null}
        <Card>
          <Label>数据文件</Label>
          <FileActionsRow>
            <Btn type="button" onClick={() => void pickFile()} disabled={busy}>选择文件</Btn>
            <PrimaryBtn type="button" onClick={() => void runAnalysis()} disabled={!canRun}>开始分析</PrimaryBtn>
          </FileActionsRow>
          <Label style={{ marginTop: 2 }}>模型选择</Label>
          <ModelToggleRow role="group" aria-label="模型选择">
            <ModelBtn
              type="button"
              $active={!selectedDataModelId}
              disabled={busy}
              onClick={() => setSelectedDataModelId('')}
            >
              不套用模型
            </ModelBtn>
            {plotDataModels.map((m) => (
              <ModelBtn
                key={m.id}
                type="button"
                $active={selectedDataModelId === m.id}
                disabled={busy}
                onClick={() => setSelectedDataModelId(m.id)}
              >
                {m.label}
              </ModelBtn>
            ))}
          </ModelToggleRow>
          <HintLine>
            {selectedDataModelId
              ? `${plotDataModels.find((x) => x.id === selectedDataModelId)?.description || ''} 若下方「分析需求」为空，将直接使用模型随包内置绘图脚本，不再向大模型索要作图代码；填写需求后则按你的描述重新生成 Python 分析脚本（不复用历史脚本）。`
              : '可选。套用模型时会在分析前预处理表格。'}
          </HintLine>
          <HintLine>支持 Excel（.xlsx / .xls）或 CSV，表头从 A1 开始。</HintLine>
          {sourcePath ? <FilePathLine>{sourcePath}</FilePathLine> : null}
          <Label style={{ marginTop: 4 }}>分析需求（可选）</Label>
          <TextArea
            value={workbench.generationPrompt}
            onChange={(e) => workbench.setGenerationPrompt(e.target.value)}
            placeholder="例如：按地区汇总销售额并画柱状图；或说明要看的指标与维度。"
          />
        </Card>
        {lastError ? (
          <Card>
            <Label>未能完成</Label>
            <ErrorBox>{lastError}</ErrorBox>
          </Card>
        ) : null}
      </Body>
    </Shell>
  )
}
