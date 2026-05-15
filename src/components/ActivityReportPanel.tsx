import React, { useState, useEffect, useCallback } from 'react'
import styled from 'styled-components'
import type {
  FileDiff,
  FileChangeRecord,
  FileContentSummary,
  DailyActivityReport,
} from '../types/workspaceActivity'

// ── Styled components ─────────────────────────────────────────────────────────

const Panel = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: #f8fbff;
  overflow: hidden;
`

const PanelHeader = styled.div`
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px 12px;
  border-bottom: 1px solid #dde6f0;
  background: linear-gradient(180deg, #ffffff 0%, #f5f9ff 100%);
`

const PanelTitle = styled.h2`
  margin: 0;
  font-size: 15px;
  font-weight: 800;
  color: #1a3347;
`

const PanelBody = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
`

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`

const Label = styled.label`
  font-size: var(--font-size-xs);
  font-weight: 700;
  color: #4a6278;
  white-space: nowrap;
`

const DateInput = styled.input`
  padding: 4px 8px;
  border: 1px solid #cad6e2;
  border-radius: 6px;
  font-size: var(--font-size-xs);
  color: #1f3447;
  background: #ffffff;
  outline: none;
  &:focus { border-color: #5597d8; }
`

const Btn = styled.button<{ $primary?: boolean; $danger?: boolean; disabled?: boolean }>`
  padding: 5px 14px;
  border-radius: 7px;
  font-size: var(--font-size-xs);
  font-weight: 700;
  cursor: ${({ disabled }) => (disabled ? 'not-allowed' : 'pointer')};
  opacity: ${({ disabled }) => (disabled ? 0.55 : 1)};
  border: none;
  background: ${({ $primary, $danger }) =>
    $danger ? '#e25c5c' : $primary ? '#1f6fd6' : '#eef3f9'};
  color: ${({ $primary, $danger }) => ($primary || $danger ? '#fff' : '#304255')};
  &:hover:not(:disabled) {
    background: ${({ $primary, $danger }) =>
      $danger ? '#c44848' : $primary ? '#1660c0' : '#dce7f3'};
  }
`

const SectionTitle = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #7a8ea2;
  margin-bottom: 6px;
`

const Card = styled.div`
  border: 1px solid #dce5ef;
  border-radius: 10px;
  background: #ffffff;
  padding: 12px 14px;
`

const ErrorBox = styled.div`
  padding: 10px 14px;
  border: 1px solid #f0cccc;
  border-radius: 8px;
  background: #fff6f6;
  color: #b83a3a;
  font-size: var(--font-size-xs);
  line-height: 1.6;
`

const LoadingBox = styled.div`
  padding: 10px 14px;
  font-size: var(--font-size-xs);
  color: #6e8295;
`

const ReportText = styled.div`
  font-size: var(--font-size-sm);
  line-height: 1.75;
  color: #243447;
  white-space: pre-wrap;
  word-break: break-word;
`

const ReportSection = styled.div`
  margin-top: 10px;
`

const ReportSectionTitle = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #7a8ea2;
  margin-bottom: 4px;
`

const ReportSectionBody = styled.div`
  font-size: var(--font-size-sm);
  line-height: 1.7;
  color: #243447;
  white-space: pre-wrap;
  word-break: break-word;
`

const FileList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const FileItem = styled.div<{ $type: string }>`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: ${({ $type }) =>
    $type === 'created' ? '#eef9f1' :
    $type === 'modified' ? '#eef4ff' :
    $type === 'exported' ? '#fff8ea' :
    '#fff1f1'};
  border: 1px solid ${({ $type }) =>
    $type === 'created' ? '#c4e8cc' :
    $type === 'modified' ? '#c4d8f5' :
    $type === 'exported' ? '#f5dfa0' :
    '#f0c0c0'};
`

const FileTag = styled.span<{ $type: string }>`
  flex-shrink: 0;
  display: inline-block;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: var(--font-size-xs);
  font-weight: 700;
  background: ${({ $type }) =>
    $type === 'created' ? '#d3f3db' :
    $type === 'modified' ? '#d3e6fc' :
    $type === 'exported' ? '#fde9b0' :
    '#fdd0d0'};
  color: ${({ $type }) =>
    $type === 'created' ? '#1a6b34' :
    $type === 'modified' ? '#1a4f94' :
    $type === 'exported' ? '#8a5c00' :
    '#8a1a1a'};
`

const FileName = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 700;
  color: #1f3447;
  word-break: break-all;
`

const FileSize = styled.div`
  font-size: var(--font-size-xs);
  color: #8093a6;
`

const SummaryCard = styled(Card)`
  border-left: 3px solid #5597d8;
`

const SummaryFileName = styled.div`
  font-size: var(--font-size-sm);
  font-weight: 800;
  color: #1f3447;
  margin-bottom: 4px;
`

const SummaryTopic = styled.div`
  font-size: var(--font-size-xs);
  color: #5a7a9a;
  margin-bottom: 6px;
`

const SummaryBody = styled.div`
  font-size: var(--font-size-xs);
  line-height: 1.65;
  color: #243447;
`

const TagRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 6px;
`

const Tag = styled.span`
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: var(--font-size-xs);
  font-weight: 700;
  background: #eef3f9;
  color: #405263;
`

const Divider = styled.hr`
  border: none;
  border-top: 1px solid #e3eaf2;
  margin: 4px 0;
`

const InfoBox = styled.div`
  padding: 8px 12px;
  border: 1px solid #d6e4f5;
  border-radius: 8px;
  background: #f0f6ff;
  color: #3a5f82;
  font-size: var(--font-size-xs);
  line-height: 1.6;
`

// ── helper ────────────────────────────────────────────────────────────────────

function todayString(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function changeTypeLabel(ct: string): string {
  if (ct === 'created') return '新建'
  if (ct === 'modified') return '修改'
  if (ct === 'deleted') return '删除'
  if (ct === 'exported') return '导出'
  return ct
}

function workTypeLabel(wt: string): string {
  const map: Record<string, string> = {
    draft: '草稿', formal: '正式文稿', email: '邮件', ppt: 'PPT',
    research: '研究资料', notes: '笔记', other: '其他',
  }
  return map[wt] || wt
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

// ── sub-components ────────────────────────────────────────────────────────────

function FileChangeList({ diff }: { diff: FileDiff }) {
  const all: FileChangeRecord[] = [
    ...diff.created,
    ...diff.modified,
    ...diff.exported,
    ...diff.deleted,
  ]
  const noBaseline = diff.baseDate === null
  return (
    <>
      {noBaseline && (
        <InfoBox style={{ marginBottom: 8 }}>
          ℹ️ 暂无昨日快照，以下文件为今日全量扫描结果（无对比基准）。请先记录一次快照，明日即可查看变更对比。
        </InfoBox>
      )}
      {all.length === 0
        ? <FileList><FileSize>今日无文件变更。</FileSize></FileList>
        : (
          <FileList>
            {all.map((f) => (
              <FileItem key={f.relativePath} $type={f.changeType}>
                <FileTag $type={f.changeType}>{changeTypeLabel(f.changeType)}</FileTag>
                <div style={{ minWidth: 0 }}>
                  <FileName>{f.fileName}</FileName>
                  <FileSize>{f.relativePath} · {formatBytes(f.size)}</FileSize>
                </div>
              </FileItem>
            ))}
          </FileList>
        )
      }
    </>
  )
}

function SummaryList({ summaries }: { summaries: FileContentSummary[] }) {
  if (summaries.length === 0) return <FileSize>无文件分析摘要。</FileSize>
  return (
    <>
      {summaries.map((s) => (
        <SummaryCard key={s.filePath}>
          <SummaryFileName>{s.fileName}</SummaryFileName>
          <SummaryTopic>{s.topic}</SummaryTopic>
          <TagRow>
            <Tag>{changeTypeLabel(s.changeType)}</Tag>
            <Tag>{workTypeLabel(s.workType)}</Tag>
            {s.confidence > 0 && <Tag>置信度 {Math.round(s.confidence * 100)}%</Tag>}
          </TagRow>
          <Divider />
          <SummaryBody>{s.summary}</SummaryBody>
          {s.keyActions.length > 0 && (
            <TagRow>{s.keyActions.map((a, i) => <Tag key={i}>{a}</Tag>)}</TagRow>
          )}
          {s.outputValue && <SummaryBody style={{ color: '#4a7a5a', marginTop: 4 }}>✓ {s.outputValue}</SummaryBody>}
        </SummaryCard>
      ))}
    </>
  )
}

function ReportView({ report }: { report: DailyActivityReport }) {
  const sections = [
    { key: 'overview',         label: '今日概览',     value: report.overview },
    { key: 'mainWork',         label: '主要工作',     value: report.mainWork },
    { key: 'keyOutputs',       label: '关键产出',     value: report.keyOutputs },
    { key: 'comparison',       label: '与昨日对比',   value: report.comparison },
    { key: 'workFocusChange',  label: '工作重心变化', value: report.workFocusChange },
    { key: 'anomalies',        label: '异常/未完成',  value: report.anomalies },
    { key: 'suggestions',      label: '明日建议',     value: report.suggestions },
  ]
  return (
    <Card>
      <ReportText style={{ fontWeight: 700, color: '#1a3347', marginBottom: 6 }}>
        📋 {report.date} 工作日报
        {report.username ? `  —  ${report.username}` : ''}
      </ReportText>
      {sections.map(({ key, label, value }) =>
        value && value.trim() && value !== '无' ? (
          <ReportSection key={key}>
            <ReportSectionTitle>{label}</ReportSectionTitle>
            <ReportSectionBody>{value}</ReportSectionBody>
          </ReportSection>
        ) : null
      )}
      <ReportSection>
        <ReportSectionTitle>生成时间</ReportSectionTitle>
        <ReportSectionBody style={{ color: '#8093a6' }}>
          {new Date(report.generatedAt).toLocaleString('zh-CN')}
        </ReportSectionBody>
      </ReportSection>
    </Card>
  )
}

// ── main component ────────────────────────────────────────────────────────────

interface ActivityReportPanelProps {
  workspacePath: string | null
  username?: string
}

type Phase = 'idle' | 'snapshotting' | 'analyzing' | 'generating' | 'done' | 'error'

export function ActivityReportPanel({ workspacePath, username }: ActivityReportPanelProps) {
  const [date, setDate] = useState(todayString)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [summaries, setSummaries] = useState<FileContentSummary[] | null>(null)
  const [report, setReport] = useState<DailyActivityReport | null>(null)
  const electronAPI = window.electronAPI

  // On mount and when date/workspace changes, try to load an existing report
  useEffect(() => {
    if (!workspacePath || !electronAPI?.activityGetReport) return
    setDiff(null)
    setSummaries(null)
    setReport(null)
    setError(null)
    setPhase('idle')
    electronAPI.activityGetReport({ workspacePath, date })
      .then((res) => {
        if (res.ok && res.report) {
          setReport(res.report)
          setSummaries(res.report.summaries)
          setPhase('done')
        }
      })
      .catch(() => { /* ignore — report not yet generated */ })
  }, [workspacePath, date])  // eslint-disable-line react-hooks/exhaustive-deps

  const handleSnapshot = useCallback(async () => {
    if (!workspacePath || !electronAPI?.activityTakeSnapshot) return
    setPhase('snapshotting')
    setError(null)
    try {
      const res = await electronAPI.activityTakeSnapshot(workspacePath)
      if (!res.ok) { setError(`快照失败：${res.error}`); setPhase('error'); return }
      // Load diff after snapshot
      const diffRes = await electronAPI.activityGetActivity({ workspacePath, date })
      if (diffRes.ok) setDiff(diffRes.diff)
      setPhase('idle')
    } catch (err) {
      setError(String(err))
      setPhase('error')
    }
  }, [workspacePath, date, electronAPI])

  const handleAnalyze = useCallback(async () => {
    if (!workspacePath || !electronAPI?.activityAnalyzeFiles) return
    setPhase('analyzing')
    setError(null)
    try {
      // Take snapshot first to ensure we have today's data
      await electronAPI.activityTakeSnapshot(workspacePath)
      const res = await electronAPI.activityAnalyzeFiles({ workspacePath, date })
      if (!res.ok) { setError(`分析失败：${res.error}`); setPhase('error'); return }
      setSummaries(res.summaries)
      const diffRes = await electronAPI.activityGetActivity({ workspacePath, date })
      if (diffRes.ok) setDiff(diffRes.diff)
      setPhase('idle')
    } catch (err) {
      setError(String(err))
      setPhase('error')
    }
  }, [workspacePath, date, electronAPI])

  const handleGenerate = useCallback(async () => {
    if (!workspacePath || !electronAPI?.activityGenerateReport) return
    setPhase('generating')
    setError(null)
    try {
      const res = await electronAPI.activityGenerateReport({ workspacePath, date, username })
      if (!res.ok) { setError(`日报生成失败：${res.error}`); setPhase('error'); return }
      setReport(res.report)
      setSummaries(res.report.summaries)
      const diffRes = await electronAPI.activityGetActivity({ workspacePath, date })
      if (diffRes.ok) setDiff(diffRes.diff)
      setPhase('done')
    } catch (err) {
      setError(String(err))
      setPhase('error')
    }
  }, [workspacePath, date, username, electronAPI])

  const isLoading = phase === 'snapshotting' || phase === 'analyzing' || phase === 'generating'

  if (!workspacePath) {
    return (
      <Panel>
        <PanelHeader><PanelTitle>工作分析 · 每日日报</PanelTitle></PanelHeader>
        <PanelBody>
          <LoadingBox>请先打开一个工作区。</LoadingBox>
        </PanelBody>
      </Panel>
    )
  }

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>工作分析 · 每日日报</PanelTitle>
      </PanelHeader>
      <PanelBody>
        {/* Controls */}
        <Card>
          <Row>
            <Label>日期</Label>
            <DateInput
              type="date"
              value={date}
              max={todayString()}
              onChange={(e) => setDate(e.target.value)}
              disabled={isLoading}
            />
          </Row>
          <Row style={{ marginTop: 10 }}>
            <Btn onClick={handleSnapshot} disabled={isLoading}>
              📸 记录快照
            </Btn>
            <Btn onClick={handleAnalyze} disabled={isLoading}>
              🔍 分析文件
            </Btn>
            <Btn $primary onClick={handleGenerate} disabled={isLoading}>
              ✨ 生成日报
            </Btn>
          </Row>
          {phase === 'snapshotting' && <LoadingBox>正在记录文件快照…</LoadingBox>}
          {phase === 'analyzing' && <LoadingBox>正在分析文件内容（可能需要 1-2 分钟）…</LoadingBox>}
          {phase === 'generating' && <LoadingBox>正在生成每日日报…</LoadingBox>}
        </Card>

        {error && <ErrorBox>{error}</ErrorBox>}

        {/* Report */}
        {report && <ReportView report={report} />}

        {/* File diff */}
        {diff && (
          <>
            <SectionTitle>文件变更</SectionTitle>
            <FileChangeList diff={diff} />
          </>
        )}

        {/* Per-file summaries */}
        {summaries && summaries.length > 0 && (
          <>
            <SectionTitle>文件内容摘要</SectionTitle>
            <SummaryList summaries={summaries} />
          </>
        )}

        {phase === 'idle' && !report && !diff && (
          <LoadingBox>
            点击「记录快照」保存当前工作区文件状态，点击「分析文件」获取内容摘要，点击「生成日报」通过 AI 生成每日工作日报。
          </LoadingBox>
        )}
      </PanelBody>
    </Panel>
  )
}

export default ActivityReportPanel
