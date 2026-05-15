/**
 * SkillDevPanel — 开发调试面板
 *
 * 只在开发模式或管理员调试模式下渲染。
 * 显示当前已注册的所有 Skill 列表，并支持手动触发 knowledge.writing.legacy
 * 和 image.generate.legacy 两个最典型的 Skill 用于验证执行链路。
 */
import { useState } from 'react'
import styled from 'styled-components'
import { listSkills } from '../../skills/registry'
import { useSkillRuntime } from '../../hooks/useSkillRuntime'
import type { AiOfficeSkillManifest } from '../../skills/types'

const Panel = styled.div`
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 420px;
  max-height: 70vh;
  overflow-y: auto;
  background: #0d1b2a;
  color: #c8d8e8;
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  font-family: 'Fira Code', 'Consolas', monospace;
  font-size: var(--font-size-xs);
  z-index: 9999;
`

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px 8px;
  background: #1a2d42;
  border-radius: 10px 10px 0 0;
  font-weight: 700;
  font-size: var(--font-size-sm);
  color: #7ab8f5;
  border-bottom: 1px solid #263d57;
`

const Body = styled.div`
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
`

const SkillRow = styled.div`
  padding: 8px 10px;
  background: #162230;
  border-radius: 6px;
  border-left: 3px solid #3a7cbf;
`

const SkillId = styled.div`
  color: #7ab8f5;
  font-weight: 600;
`

const SkillMeta = styled.div`
  color: #8aa3ba;
  margin-top: 2px;
`

const Section = styled.div`
  border-top: 1px solid #263d57;
  padding-top: 10px;
`

const SectionTitle = styled.div`
  color: #7ab8f5;
  font-weight: 700;
  margin-bottom: 8px;
`

const InputRow = styled.div`
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
`

const Input = styled.input`
  flex: 1;
  padding: 5px 8px;
  background: #0d1b2a;
  border: 1px solid #263d57;
  border-radius: 4px;
  color: #c8d8e8;
  font-family: inherit;
  font-size: var(--font-size-xs);
  &::placeholder { color: #4a6a82; }
`

const Btn = styled.button`
  padding: 5px 12px;
  background: #1e5794;
  color: #c8d8e8;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: var(--font-size-xs);
  &:disabled { opacity: 0.5; cursor: not-allowed; }
  &:hover:not(:disabled) { background: #2568ab; }
`

const ResultBox = styled.pre`
  background: #0a1520;
  border-radius: 6px;
  padding: 8px 10px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 160px;
  font-size: var(--font-size-xs);
  color: #8fc9a8;
  margin: 0;
`

const ErrorBox = styled(ResultBox)`
  color: #f07070;
`

interface SkillDevPanelProps {
  onClose?: () => void
}

export default function SkillDevPanel({ onClose }: SkillDevPanelProps) {
  const skills = listSkills()
  const { execute, result, loading, error } = useSkillRuntime()

  const [writingPrompt, setWritingPrompt] = useState('请写一段关于人工智能的简短介绍。')
  const [imagePrompt, setImagePrompt] = useState('一幅宁静的山水画，水墨风格')

  const handleTestWriting = async () => {
    await execute({
      skillId: 'knowledge.writing.legacy',
      input: { instruction: writingPrompt },
      context: {
        onStatus: (msg) => console.log('[SkillDevPanel] status:', msg),
        onDelta: (_delta, acc) => console.log('[SkillDevPanel] delta len:', acc.length),
      },
    })
  }

  const handleTestImage = async () => {
    await execute({
      skillId: 'image.generate.legacy',
      input: { prompt: imagePrompt },
      context: {
        onStatus: (msg) => console.log('[SkillDevPanel] status:', msg),
      },
    })
  }

  return (
    <Panel>
      <Header>
        🧠 Skill Dev Panel ({skills.length} skills)
        {onClose && (
          <Btn style={{ padding: '2px 8px', fontSize: 'var(--font-size-xs)' }} onClick={onClose}>✕</Btn>
        )}
      </Header>
      <Body>
        <div>
          <SectionTitle>已注册 Skills</SectionTitle>
          {skills.map((s) => (
            <SkillRow key={s.manifest.id}>
              <SkillId>{s.manifest.id}</SkillId>
              <SkillMeta>
                [{(s.manifest as AiOfficeSkillManifest).category}] v{s.manifest.version} — {s.manifest.description}
              </SkillMeta>
            </SkillRow>
          ))}
        </div>

        <Section>
          <SectionTitle>测试: knowledge.writing.legacy</SectionTitle>
          <InputRow>
            <Input
              value={writingPrompt}
              onChange={(e) => setWritingPrompt(e.target.value)}
              placeholder="输入写作指令..."
            />
          </InputRow>
          <Btn disabled={loading} onClick={() => void handleTestWriting()}>
            {loading ? '执行中...' : '执行'}
          </Btn>
        </Section>

        <Section>
          <SectionTitle>测试: image.generate.legacy</SectionTitle>
          <InputRow>
            <Input
              value={imagePrompt}
              onChange={(e) => setImagePrompt(e.target.value)}
              placeholder="输入图片描述..."
            />
          </InputRow>
          <Btn disabled={loading} onClick={() => void handleTestImage()}>
            {loading ? '执行中...' : '执行'}
          </Btn>
        </Section>

        {error && (
          <Section>
            <SectionTitle style={{ color: '#f07070' }}>执行错误</SectionTitle>
            <ErrorBox>{error}</ErrorBox>
          </Section>
        )}

        {result && (
          <Section>
            <SectionTitle>执行结果 [{result.status}]</SectionTitle>
            <ResultBox>{JSON.stringify(result, null, 2)}</ResultBox>
          </Section>
        )}
      </Body>
    </Panel>
  )
}
