/**
 * AI 续写面板 — 从原项目迁移，仅替换调用层
 */
import React, { useRef, useState } from 'react'
import styled from 'styled-components'
import { useDocument } from '../../../contexts/DocumentContext'
import { useLanguage } from '../../../contexts/LanguageContext'
import { continueWriting } from '../services/ContinueWritingService'
import { isDirectMode, directContinueWriting } from '../../../services/AIClientFactory'
import { runDiagnostic } from '../../../services/BackendDiagnostic'

const Section = styled.div`
  padding: 12px 16px;
  border-bottom: 1px solid #f0f0f0;
`

const SectionTitle = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: #555;
  margin-bottom: 8px;
`

const TextArea = styled.textarea`
  width: 100%;
  min-height: 80px;
  border: 1px solid #ddd;
  border-radius: 6px;
  padding: 10px;
  font-size: 14px;
  font-family: inherit;
  resize: vertical;
  outline: none;
  &:focus { border-color: #667eea; }
`

const Btn = styled.button<{ $primary?: boolean }>`
  width: 100%;
  padding: 10px 16px;
  border: ${p => (p.$primary ? 'none' : '1px solid #ddd')};
  border-radius: 6px;
  background: ${p => (p.$primary ? 'linear-gradient(135deg, #667eea, #764ba2)' : '#fff')};
  color: ${p => (p.$primary ? '#fff' : '#333')};
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  &:hover { opacity: 0.85; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`

const Row = styled.div`
  display: flex;
  gap: 8px;
  margin-top: 8px;
`

const Label = styled.label`
  font-size: var(--font-size-xs);
  color: #666;
  display: block;
  margin-bottom: 4px;
`

const Input = styled.input`
  width: 100%;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
  outline: none;
  &:focus { border-color: #667eea; }
`

const StreamBox = styled.div`
  flex: 1;
  min-height: 120px;
  max-height: 300px;
  overflow-y: auto;
  padding: 12px 16px;
  font-size: 14px;
  line-height: 1.7;
  color: #333;
  white-space: pre-wrap;
  word-break: break-word;
`

const ContinueWritingPanel: React.FC = () => {
  const { markdown, setMarkdown, isGenerating, setIsGenerating, setStatusMessage } = useDocument()
  const { language } = useLanguage()
  const [writingGoal, setWritingGoal] = useState('')
  const [targetWords, setTargetWords] = useState(450)
  const [streamText, setStreamText] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const handleAutodiagnose = async (errorMsg: string) => {
    if (errorMsg.includes('无法连接') || errorMsg.includes('网络错误')) {
      setStatusMessage(errorMsg + ' (自动诊断中...)')
      const result = await runDiagnostic()
      setStatusMessage(result.success ? '模型接口可用，请重试' : '诊断完成: ' + result.summary)
    }
  }

  const handleContinueWrite = async () => {
    if (isGenerating) return
    const plainText = markdown.replace(/<[^>]+>/g, '')
    if (plainText.trim().length < 10) {
      setStatusMessage('请先输入一些内容再续写')
      return
    }
    setIsGenerating(true)
    setStreamText('')
    setStatusMessage('正在续写...')
    const controller = new AbortController()
    abortRef.current = controller
    try {
      if (isDirectMode()) {
        await directContinueWriting()
      } else {
        await continueWriting(
          { draftText: plainText, writingGoal: writingGoal || '自动补全', targetWords, language },
          {
            onDelta: (_d, acc) => setStreamText(acc),
            onComplete: (result) => {
              setStreamText(result.continuedText)
              setStatusMessage('续写完成')
              setIsGenerating(false)
            },
            onError: (err) => {
              setStatusMessage('续写失败: ' + err)
              setIsGenerating(false)
              void handleAutodiagnose(err)
            },
            onStatus: (msg) => setStatusMessage(msg),
          },
          controller.signal,
        )
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error))
      setIsGenerating(false)
    }
  }

  const handleStop = () => {
    abortRef.current?.abort()
    setIsGenerating(false)
    setStatusMessage('已停止')
  }

  const handleInsert = () => {
    if (!streamText) return
    setMarkdown(markdown + '\n' + streamText)
    setStreamText('')
    setStatusMessage('已插入到文档')
  }

  return (
    <>
      <Section>
        <SectionTitle>AI 续写</SectionTitle>
        <Label>续写目标</Label>
        <TextArea value={writingGoal} onChange={(e) => setWritingGoal(e.target.value)} placeholder="如：补全实验结果和结论部分" />
        <Row>
          <div style={{ flex: 1 }}>
            <Label>字数</Label>
            <Input type="number" min={80} max={3000} value={targetWords} onChange={(e) => setTargetWords(Number(e.target.value))} />
          </div>
        </Row>
        <Row>
          {isGenerating ? <Btn onClick={handleStop}>⏹ 停止</Btn> : <Btn $primary onClick={handleContinueWrite}>▶ 开始续写</Btn>}
        </Row>
      </Section>
      <StreamBox>{streamText || <span style={{ color: '#bbb' }}>AI 续写的内容将在此处实时显示...</span>}</StreamBox>
      {streamText && !isGenerating && (
        <Section>
          <Btn $primary onClick={handleInsert}>📝 插入到文档</Btn>
        </Section>
      )}
    </>
  )
}

export default ContinueWritingPanel