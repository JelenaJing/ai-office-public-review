import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styled, { css, keyframes } from 'styled-components'
import { renderPdfPages, type PdfPageImage } from '../../../utils/pdfRenderer'
import { useWorkspace } from '../../../contexts/WorkspaceContext'
import { loadWorkspaceData, saveWorkspaceData } from '../../../stores/featureSessionStore'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface HomeworkQuestion {
  number: string
  text: string
  type: string
  sourceIndex: number
  options?: string[]
}

interface HomeworkAnswer {
  questionNumber: string
  answer: string
  status: 'pending' | 'generating' | 'done' | 'error'
}

type WorkbenchStage = 'upload' | 'extracting' | 'answering'

/* ------------------------------------------------------------------ */
/*  Animations                                                         */
/* ------------------------------------------------------------------ */

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.45; }
`

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
`

/* ------------------------------------------------------------------ */
/*  Styled components                                                  */
/* ------------------------------------------------------------------ */

const Shell = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: #f4f7fa;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
`

const TopBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px 12px;
  border-bottom: 1px solid #dde4ec;
  background: #fff;
  flex-shrink: 0;
`

const TopTitle = styled.span`
  font-size: 15px;
  font-weight: 700;
  color: #1a202c;
`

const TopActions = styled.div`
  display: flex;
  gap: 8px;
`

const ActionBtn = styled.button<{ $primary?: boolean }>`
  padding: 6px 14px;
  border-radius: 6px;
  font-size: var(--font-size-sm);
  font-weight: 600;
  cursor: pointer;
  border: 1px solid ${({ $primary }) => ($primary ? '#3182ce' : '#c5d0db')};
  background: ${({ $primary }) => ($primary ? '#3182ce' : '#fff')};
  color: ${({ $primary }) => ($primary ? '#fff' : '#4a5568')};
  transition: background 0.12s, border-color 0.12s;
  &:hover {
    background: ${({ $primary }) => ($primary ? '#2b6cb0' : '#edf2f7')};
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`

const ContentArea = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px;
`

/* ---------- Upload stage ---------- */

const UploadZone = styled.div<{ $dragOver?: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  min-height: 260px;
  max-width: 520px;
  margin: 40px auto;
  padding: 40px 32px;
  border: 2px dashed ${({ $dragOver }) => ($dragOver ? '#3182ce' : '#c5d0db')};
  border-radius: 14px;
  background: ${({ $dragOver }) => ($dragOver ? '#ebf4ff' : '#fff')};
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
  &:hover {
    border-color: #3182ce;
    background: #f7fbff;
  }
`

const UploadIcon = styled.div`
  font-size: 42px;
  line-height: 1;
  opacity: 0.55;
`

const UploadTitle = styled.div`
  font-size: 15px;
  font-weight: 600;
  color: #2d3748;
`

const UploadHint = styled.div`
  font-size: var(--font-size-sm);
  color: #718096;
  text-align: center;
  line-height: 1.5;
`

/* ---------- Extracting stage ---------- */

const ExtractingBox = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  margin: 60px auto;
  animation: ${pulse} 1.8s infinite;
  color: #4a5568;
`

/* ---------- Question cards ---------- */

const QuestionsGrid = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 820px;
  margin: 0 auto;
`

const QuestionCard = styled.div<{ $status: string }>`
  background: #fff;
  border-radius: 10px;
  border: 1px solid #e2e8f0;
  overflow: hidden;
  animation: ${fadeIn} 0.25s ease-out;
  ${({ $status }) =>
    $status === 'generating' &&
    css`
      border-color: #63b3ed;
      box-shadow: 0 0 0 2px rgba(99, 179, 237, 0.18);
    `}
  ${({ $status }) =>
    $status === 'done' &&
    css`
      border-color: #68d391;
    `}
  ${({ $status }) =>
    $status === 'error' &&
    css`
      border-color: #fc8181;
    `}
`

const CardHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid #edf2f7;
  background: #fafcfe;
`

const QuestionNumber = styled.span`
  font-size: var(--font-size-sm);
  font-weight: 700;
  color: #2b6cb0;
  background: #ebf4ff;
  padding: 2px 8px;
  border-radius: 4px;
  flex-shrink: 0;
`

const QuestionType = styled.span`
  font-size: var(--font-size-xs);
  color: #718096;
  background: #edf2f7;
  padding: 2px 7px;
  border-radius: 4px;
`

const StatusBadge = styled.span<{ $status: string }>`
  margin-left: auto;
  font-size: var(--font-size-xs);
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
  ${({ $status }) => {
    switch ($status) {
      case 'pending':
        return css`background: #edf2f7; color: #718096;`
      case 'generating':
        return css`background: #bee3f8; color: #2b6cb0; animation: ${pulse} 1.2s infinite;`
      case 'done':
        return css`background: #c6f6d5; color: #276749;`
      case 'error':
        return css`background: #fed7d7; color: #9b2c2c;`
      default:
        return ''
    }
  }}
`

const CardBody = styled.div`
  padding: 14px 16px;
`

const QuestionText = styled.div`
  font-size: 14px;
  line-height: 1.65;
  color: #2d3748;
  white-space: pre-wrap;
  word-break: break-word;
`

const OptionsList = styled.ul`
  list-style: none;
  padding: 6px 0 0 4px;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
`

const OptionItem = styled.li`
  font-size: var(--font-size-sm);
  color: #4a5568;
  line-height: 1.55;
`

const AnswerSection = styled.div`
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed #e2e8f0;
`

const AnswerLabel = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 700;
  color: #38a169;
  margin-bottom: 6px;
`

const AnswerContent = styled.div`
  font-size: 14px;
  line-height: 1.7;
  color: #2d3748;
  white-space: pre-wrap;
  word-break: break-word;
`

/* ---------- Summary bar ---------- */

const SummaryBar = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 20px;
  border-top: 1px solid #dde4ec;
  background: #fff;
  flex-shrink: 0;
  font-size: var(--font-size-sm);
  color: #4a5568;
`

const ProgressText = styled.span`
  font-weight: 600;
  color: #2b6cb0;
`

/* ================================================================== */
/*  Component                                                          */
/* ================================================================== */

const HomeworkWorkbench: React.FC = () => {
  const { activeWorkspacePath } = useWorkspace()
  const [stage, setStage] = useState<WorkbenchStage>(() => {
    // Don't try to restore at this point — workspace path isn't available yet.
    return 'upload'
  })
  const [sourceFileName, setSourceFileName] = useState('')
  const [questions, setQuestions] = useState<HomeworkQuestion[]>([])
  const [answers, setAnswers] = useState<Record<string, HomeworkAnswer>>({})
  const [dragOver, setDragOver] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [extractProgress, setExtractProgress] = useState<{ current: number; total: number } | null>(null)
  const [answeringQuestion, setAnsweringQuestion] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const aiEventDisposeRef = useRef<(() => void) | null>(null)

  // Restore persisted homework state when workspace is available.
  const restoredRef = useRef(false)
  useEffect(() => {
    if (!activeWorkspacePath || restoredRef.current) return
    restoredRef.current = true
    type Saved = { stage?: WorkbenchStage; sourceFileName?: string; questions?: HomeworkQuestion[]; answers?: Record<string, HomeworkAnswer> }
    const saved = loadWorkspaceData<Saved>(activeWorkspacePath, 'homeworkState')
    if (!saved) return
    if (saved.questions && saved.questions.length > 0) {
      setQuestions(saved.questions)
      // Normalize any stuck 'generating' answers back to 'error' on restore
      if (saved.answers) {
        const restored = Object.fromEntries(
          Object.entries(saved.answers).map(([k, v]) => [k, { ...v, status: v.status === 'generating' ? ('error' as const) : v.status }]),
        )
        setAnswers(restored)
      }
      if (saved.sourceFileName) setSourceFileName(saved.sourceFileName)
      // Restore stage but never restore 'extracting' — that's a transient state
      if (saved.stage === 'answering') setStage('answering')
    }
  }, [activeWorkspacePath])

  // Persist key state to localStorage whenever it changes.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!activeWorkspacePath || !restoredRef.current) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveWorkspaceData(activeWorkspacePath, 'homeworkState', { stage, sourceFileName, questions, answers })
    }, 1000)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [activeWorkspacePath, stage, sourceFileName, questions, answers])

  /* ---- helpers ---- */

  const statusLabel = useCallback((s: string) => {
    switch (s) {
      case 'pending': return '等待中'
      case 'generating': return '生成中...'
      case 'done': return '已完成'
      case 'error': return '出错'
      default: return s
    }
  }, [])

  const doneCount = useMemo(
    () => Object.values(answers).filter((a) => a.status === 'done').length,
    [answers],
  )

  /* ---- subscribe to streaming events ---- */

  useEffect(() => {
    aiEventDisposeRef.current = window.electronAPI.onAiEvent((payload: unknown) => {
      const ev = payload as Record<string, unknown>
      if (ev.type === 'homework:extractProgress') {
        setExtractProgress({ current: Number(ev.current), total: Number(ev.total) })
      }
      if (ev.type === 'homework:answerChunk') {
        const qn = String(ev.questionNumber)
        setAnswers((prev) => ({
          ...prev,
          [qn]: { questionNumber: qn, answer: String(ev.accumulated ?? ''), status: 'generating' },
        }))
      }
      if (ev.type === 'homework:answerProgress') {
        const qn = String(ev.questionNumber)
        const status = String(ev.status) as HomeworkAnswer['status']
        setAnswers((prev) => ({
          ...prev,
          [qn]: { questionNumber: qn, answer: String(ev.accumulated ?? prev[qn]?.answer ?? ''), status },
        }))
      }
    })
    return () => { aiEventDisposeRef.current?.() }
  }, [])

  /* ---- file handling ---- */

  const processFile = useCallback(async (file: File) => {
    setErrorMsg('')
    setExtractProgress(null)
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    setSourceFileName(file.name)

    if (ext === 'pdf') {
      setStage('extracting')
      try {
        const arrayBuffer = await file.arrayBuffer()
        // 800px is sufficient for text recognition and keeps base64 payload manageable
        const pageImages = await renderPdfPages(arrayBuffer, 800)
        const MAX_PAGES = 10
        const truncated = pageImages.length > MAX_PAGES
        const usedPages = pageImages.slice(0, MAX_PAGES)
        const pageInputs = usedPages.map((p) => ({
          pageNumber: p.pageNumber,
          base64: p.dataUrl.replace(/^data:[^;]+;base64,/, ''),
          mediaType: 'image/png',
        }))
        const result = await window.electronAPI.homeworkExtractQuestions({ type: 'pdf', pageImages: pageInputs })
        const qs: HomeworkQuestion[] = Array.isArray(result) ? result : (result as { questions: HomeworkQuestion[] }).questions ?? []
        setQuestions(qs)
        setAnswers(Object.fromEntries(qs.map((q) => [q.number, { questionNumber: q.number, answer: '', status: 'pending' as const }])))
        setStage(qs.length > 0 ? 'answering' : 'upload')
        if (qs.length === 0) setErrorMsg('未能从 PDF 中识别出任何题目，请确认文件内容。')
        else if (truncated) setErrorMsg(`PDF 共 ${pageImages.length} 页，仅分析前 ${MAX_PAGES} 页（已识别到题目）。`)
      } catch (err) {
        setStage('upload')
        setErrorMsg(`PDF 解析失败: ${err instanceof Error ? err.message : String(err)}`)
      }
    } else if (ext === 'docx') {
      setStage('extracting')
      try {
        // For DOCX we need the file path — in Electron we can get it from the File object
        const filePath = (file as unknown as { path?: string }).path
        if (!filePath) {
          throw new Error('无法获取文件路径，请确保在 Electron 环境中运行。')
        }
        const result = await window.electronAPI.homeworkExtractQuestions({ type: 'docx', filePath })
        const qs: HomeworkQuestion[] = Array.isArray(result) ? result : (result as { questions: HomeworkQuestion[] }).questions ?? []
        setQuestions(qs)
        setAnswers(Object.fromEntries(qs.map((q) => [q.number, { questionNumber: q.number, answer: '', status: 'pending' as const }])))
        setStage(qs.length > 0 ? 'answering' : 'upload')
        if (qs.length === 0) setErrorMsg('未能从 DOCX 中识别出任何题目，请确认文件内容。')
      } catch (err) {
        setStage('upload')
        setErrorMsg(`DOCX 解析失败: ${err instanceof Error ? err.message : String(err)}`)
      }
    } else {
      setErrorMsg('仅支持 PDF 和 DOCX 格式的作业文件。')
    }
  }, [])

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) void processFile(file)
    e.target.value = ''
  }, [processFile])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) void processFile(file)
  }, [processFile])

  /* ---- answer generation ---- */

  /** Strip common Markdown formatting symbols for clean plain-text display. */
  const cleanAnswerText = useCallback((text: string): string => {
    return text
      .replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')  // code blocks: keep content
      .replace(/`([^`]+)`/g, '$1')                  // inline code
      .replace(/^#{1,6}\s+/gm, '')                  // headings
      .replace(/\*\*([^*]+)\*\*/g, '$1')            // bold
      .replace(/\*([^*\n]+)\*/g, '$1')              // italic
      .replace(/^>\s*/gm, '')                        // blockquotes
      .replace(/^[-*+]\s+/gm, '• ')                 // unordered lists → bullet
      .replace(/^[-_*]{3,}\s*$/gm, '─────────────') // horizontal rules
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')      // links
      .replace(/\n{3,}/g, '\n\n')                    // collapse extra blank lines
      .trim()
  }, [])

  const answerSingle = useCallback(async (question: HomeworkQuestion) => {
    if (answeringQuestion !== null) return
    setAnsweringQuestion(question.number)
    setAnswers((prev) => ({
      ...prev,
      [question.number]: { questionNumber: question.number, answer: '', status: 'generating' },
    }))
    try {
      const result = await window.electronAPI.homeworkGenerateAnswer(question)
      setAnswers((prev) => ({
        ...prev,
        [question.number]: { questionNumber: question.number, answer: String(result), status: 'done' },
      }))
    } catch (err) {
      setAnswers((prev) => ({
        ...prev,
        [question.number]: {
          questionNumber: question.number,
          answer: `生成失败: ${err instanceof Error ? err.message : String(err)}`,
          status: 'error',
        },
      }))
    } finally {
      setAnsweringQuestion(null)
    }
  }, [answeringQuestion])

  /* ---- export ---- */

  const handleExportMarkdown = useCallback(async () => {
    const results = questions.map((q) => ({
      question: q,
      answer: answers[q.number] ?? { questionNumber: q.number, answer: '', status: 'pending' },
    }))
    try {
      const md = await window.electronAPI.homeworkExportMarkdown({ results, title: sourceFileName })
      // Copy to clipboard
      await navigator.clipboard.writeText(md)
      alert('Markdown 已复制到剪贴板')
    } catch {
      alert('导出失败，请重试。')
    }
  }, [questions, answers, sourceFileName])

  /* ---- reset ---- */

  const handleReset = useCallback(() => {
    setStage('upload')
    setQuestions([])
    setAnswers({})
    setSourceFileName('')
    setErrorMsg('')
    setExtractProgress(null)
    setAnsweringQuestion(null)
    // Clear persisted state so next mount starts fresh
    if (activeWorkspacePath) {
      saveWorkspaceData(activeWorkspacePath, 'homeworkState', null)
    }
  }, [activeWorkspacePath])

  /* ------------------------------------------------------------------ */
  /*  Render                                                             */
  /* ------------------------------------------------------------------ */

  return (
    <Shell>
      {/* Top bar */}
      <TopBar>
        <TopTitle>
          {stage === 'upload' ? '作业解答' : `作业解答 — ${sourceFileName}`}
        </TopTitle>
        <TopActions>
          {stage !== 'upload' && (
            <ActionBtn onClick={handleReset}>重新上传</ActionBtn>
          )}
          {(stage === 'answering') && doneCount > 0 && (
            <ActionBtn onClick={handleExportMarkdown}>导出 Markdown</ActionBtn>
          )}
        </TopActions>
      </TopBar>

      {/* Upload stage */}
      {stage === 'upload' && (
        <ContentArea>
          <UploadZone
            $dragOver={dragOver}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <UploadIcon>📄</UploadIcon>
            <UploadTitle>上传作业文件</UploadTitle>
            <UploadHint>
              支持 PDF / DOCX 格式<br />
              拖拽文件到此处，或点击选择文件
            </UploadHint>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx"
              style={{ display: 'none' }}
              onChange={onFileChange}
            />
          </UploadZone>
          {errorMsg && (
            <div style={{ textAlign: 'center', color: '#e53e3e', marginTop: 12, fontSize: 14 }}>
              {errorMsg}
            </div>
          )}
        </ContentArea>
      )}

      {/* Extracting stage */}
      {stage === 'extracting' && (
        <ContentArea>
          <ExtractingBox>
            <div style={{ fontSize: 28 }}>🔍</div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>正在解析作业文件...</div>
            {extractProgress
              ? <div style={{ fontSize: 14, color: '#718096' }}>AI 正在识别第 {extractProgress.current} / {extractProgress.total} 页</div>
              : <div style={{ fontSize: 14, color: '#718096' }}>AI 正在识别题目，请稍候</div>
            }
          </ExtractingBox>
        </ContentArea>
      )}

      {/* Questions & answers */}
      {(stage === 'answering') && (
        <>
          <ContentArea>
            <QuestionsGrid>
              {questions.map((q) => {
                const ans = answers[q.number]
                const isThisGenerating = answeringQuestion === q.number
                const canAnswer = ans?.status !== 'generating' && answeringQuestion === null
                return (
                  <QuestionCard key={q.number} $status={ans?.status ?? 'pending'}>
                    <CardHeader>
                      <QuestionNumber>第 {q.number} 题</QuestionNumber>
                      <QuestionType>{q.type}</QuestionType>
                      <StatusBadge $status={ans?.status ?? 'pending'}>
                        {statusLabel(ans?.status ?? 'pending')}
                      </StatusBadge>
                      {(ans?.status === 'pending' || ans?.status === 'error' || ans?.status === 'done') && (
                        <ActionBtn
                          $primary={ans?.status !== 'done'}
                          style={{ marginLeft: 'auto', padding: '3px 10px', fontSize: 14 }}
                          onClick={() => void answerSingle(q)}
                          disabled={!canAnswer}
                        >
                          {ans?.status === 'done' ? '重新解答' : '解答此题'}
                        </ActionBtn>
                      )}
                    </CardHeader>
                    <CardBody>
                      <QuestionText>{q.text}</QuestionText>
                      {q.options && q.options.length > 0 && (
                        <OptionsList>
                          {q.options.map((opt, i) => (
                            <OptionItem key={i}>{opt}</OptionItem>
                          ))}
                        </OptionsList>
                      )}
                      {isThisGenerating && !ans?.answer && (
                        <AnswerSection>
                          <AnswerLabel>AI 解答</AnswerLabel>
                          <AnswerContent style={{ color: '#a0aec0' }}>正在生成...</AnswerContent>
                        </AnswerSection>
                      )}
                      {ans && ans.answer && (
                        <AnswerSection>
                          <AnswerLabel>AI 解答</AnswerLabel>
                          <AnswerContent>{cleanAnswerText(ans.answer)}</AnswerContent>
                        </AnswerSection>
                      )}
                    </CardBody>
                  </QuestionCard>
                )
              })}
            </QuestionsGrid>
          </ContentArea>
          <SummaryBar>
            <span>共 {questions.length} 题</span>
            <ProgressText>{doneCount} / {questions.length} 已完成</ProgressText>
            {doneCount === questions.length && questions.length > 0 && (
              <span style={{ color: '#38a169', fontWeight: 600 }}>全部完成 🎉</span>
            )}
            {answeringQuestion !== null && (
              <span style={{ color: '#3182ce', fontSize: 14 }}>正在解答第 {answeringQuestion} 题...</span>
            )}
          </SummaryBar>
        </>
      )}
    </Shell>
  )
}

export default HomeworkWorkbench
