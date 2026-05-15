import React, { useState } from 'react'
import styled from 'styled-components'
import { useDocument } from '../contexts/DocumentContext'
import { useKnowledge } from '../contexts/KnowledgeContext'
import FullSettingsPanel from './FullSettingsPanel'
import InternalAccountPanel from './InternalAccountPanel'
import type { AppSettings } from '../../electron/main/services/settingsStore'
import { formatBuiltinKeySource, formatProviderLabel } from '../shared/ai/providerCatalog'

const Panel = styled.div`
  width: 380px;
  background: #ffffff;
  border-left: 1px solid #dde3ec;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  min-width: 0;
`

const PanelHeader = styled.div`
  padding: 12px 16px;
  border-bottom: 1px solid #e7edf4;
  background: linear-gradient(135deg, #f9fcff 0%, #eef6ff 100%);
  flex-shrink: 0;
`

const PanelTitle = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: #1f3142;
`

const PanelSubtitle = styled.div`
  font-size: var(--font-size-xs);
  color: #627385;
  margin-top: 2px;
`

const Body = styled.div`
  flex: 1;
  overflow: auto;
  background: #ffffff;
`

const TabBar = styled.div`
  display: flex;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid #e7edf4;
  background: #fafcff;
`

const TabBtn = styled.button<{ $active?: boolean }>`
  border: 1px solid ${p => p.$active ? '#0e639c' : '#d6e0ea'};
  border-radius: 999px;
  background: ${p => p.$active ? '#0e639c' : '#ffffff'};
  color: ${p => p.$active ? '#fff' : '#304255'};
  font-size: var(--font-size-xs);
  padding: 6px 12px;
  cursor: pointer;
`

const StatusBar = styled.div<{ $error?: boolean }>`
  padding: 8px 16px;
  font-size: var(--font-size-xs);
  color: ${p => p.$error ? '#c64b4b' : '#627385'};
  border-top: 1px solid #e7edf4;
  flex-shrink: 0;
  background: #ffffff;
`

const SettingSummary = styled.div`
  padding: 14px 16px;
  border-bottom: 1px solid #e7edf4;
  background: #ffffff;
  display: grid;
  gap: 10px;
`

const SummaryCard = styled.div`
  border: 1px solid #dfe7ef;
  border-radius: 8px;
  padding: 10px 12px;
  background: #fbfdff;
`

const SummaryTitle = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 700;
  color: #1f3142;
  margin-bottom: 6px;
`

const SummaryMeta = styled.div`
  font-size: var(--font-size-xs);
  color: #627385;
  line-height: 1.7;
`

const SummaryValue = styled.span`
  color: #243447;
`

const SummaryTag = styled.span<{ $ok?: boolean; $warn?: boolean }>`
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: var(--font-size-xs);
  font-weight: 700;
  color: ${({ $ok, $warn }) => ($ok ? '#c7ffd9' : $warn ? '#ffe3ad' : '#d9e7ff')};
  background: ${({ $ok, $warn }) => ($ok ? 'rgba(31, 122, 72, 0.28)' : $warn ? 'rgba(122, 91, 31, 0.28)' : 'rgba(33, 76, 128, 0.28)')};
  border: 1px solid ${({ $ok, $warn }) => ($ok ? '#276d49' : $warn ? '#7a5d24' : '#355d8c')};
`

const SummaryRow = styled.div`
  display: flex;
  gap: 8px;
`

const SummaryButton = styled.button<{ $primary?: boolean }>`
  flex: 1;
  border: ${p => p.$primary ? 'none' : '1px solid #d6e0ea'};
  border-radius: 6px;
  background: ${p => p.$primary ? '#0e639c' : '#ffffff'};
  color: ${p => p.$primary ? '#fff' : '#304255'};
  padding: 8px 10px;
  font-size: var(--font-size-xs);
  cursor: pointer;
`

const ActivityHint = styled.div`
  padding: 8px 16px;
  border-bottom: 1px solid #e7edf4;
  background: #fafcff;
  font-size: var(--font-size-xs);
  color: #627385;
`

function maskSecret(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return '未配置'
  if (trimmed.length <= 10) return `${trimmed.slice(0, 3)}***`
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`
}

function describeKey(value: string, useBuiltinKey: boolean, builtinKeyAvailable: boolean, builtinKeySource?: string): string {
  if (useBuiltinKey) {
    return builtinKeyAvailable ? `软件内置默认 Key (${formatBuiltinKeySource(builtinKeySource as any)})` : '当前构建未内置 Key'
  }
  return maskSecret(value)
}

function formatPaperType(type?: string): string {
  const labels: Record<string, string> = {
    review: '综述论文',
    research: '研究论文',
    thesis_research: '学位论文',
  }
  return labels[type || ''] || (type || '未设置')
}

function formatLanguage(language?: string): string {
  return language === 'en' ? 'English' : language === 'zh' ? '中文' : '未设置'
}

const AISidebar: React.FC = () => {
  const { statusMessage } = useDocument()
  const { referenceDocumentIds, templateDocumentId, info } = useKnowledge()
  const [activeTab, setActiveTab] = useState<'settings' | 'account'>('settings')
  const [backendStatus, setBackendStatus] = useState('')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [runtimeHint, setRuntimeHint] = useState('就绪')
  const [testingLlm, setTestingLlm] = useState(false)

  React.useEffect(() => {
    if (!window.electronAPI?.onBackendStatus) return
    window.electronAPI.onBackendStatus((msg: string) => {
      setBackendStatus(msg)
    })
  }, [])

  React.useEffect(() => {
    void window.electronAPI.getSettings().then(setSettings)
  }, [])

  React.useEffect(() => {
    const unsubscribe = window.electronAPI.onAiEvent((payload) => {
      const event = payload as { scope?: string; type?: string; message?: string }
      if (event.type === 'progress' && event.message) {
        setRuntimeHint(event.message)
      } else if (event.type === 'done' && event.scope) {
        const labels: Record<string, string> = { paper: '整篇论文生成完成', image: '图片生成完成', continue: '续写完成', rewrite: '重写完成' }
        setRuntimeHint(labels[event.scope] || 'AI 任务完成')
      } else if (event.type === 'start' && event.scope) {
        const labels: Record<string, string> = { paper: '开始整篇论文生成', image: '开始图片生成', continue: '开始续写', rewrite: '开始重写' }
        setRuntimeHint(labels[event.scope] || 'AI 任务开始')
      }
    })
    const openSidebarTab = (event: Event) => {
      const detail = (event as CustomEvent<{ tab?: string }>).detail
      if (detail?.tab === 'settings') setActiveTab('settings')
      else if (detail?.tab === 'account') setActiveTab('account')
    }
    const handleSettingsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<AppSettings>).detail
      if (detail) setSettings(detail)
    }
    window.addEventListener('open-sidebar-tab', openSidebarTab)
    window.addEventListener('ai-settings-updated', handleSettingsUpdated)
    return () => {
      unsubscribe()
      window.removeEventListener('open-sidebar-tab', openSidebarTab)
      window.removeEventListener('ai-settings-updated', handleSettingsUpdated)
    }
  }, [])

  const refreshSettings = async () => {
    const next = await window.electronAPI.getSettings()
    setSettings(next)
  }

  const runLlmTest = async () => {
    setTestingLlm(true)
    try {
      const result = await window.electronAPI.testLlmConnection()
      setRuntimeHint(`文字模型联通成功: ${result}`)
    } catch (error: any) {
      setRuntimeHint(`文字模型联通失败: ${error?.message || ''}`)
    } finally {
      setTestingLlm(false)
    }
  }

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>AI 设置中心</PanelTitle>
        <PanelSubtitle>集中管理模型、密钥、接口地址与默认写作预设。</PanelSubtitle>
      </PanelHeader>

      <ActivityHint>{runtimeHint}</ActivityHint>
      <TabBar>
        <TabBtn $active={activeTab === 'settings'} onClick={() => setActiveTab('settings')}>设置</TabBtn>
        <TabBtn $active={activeTab === 'account'} onClick={() => setActiveTab('account')}>账号</TabBtn>
      </TabBar>

      <Body>
        {activeTab === 'account' ? (
          <InternalAccountPanel />
        ) : <>
          <SettingSummary>
            <SummaryCard>
              <SummaryTitle>文字模型</SummaryTitle>
              <SummaryMeta>
                <div>供应商: <SummaryValue>{formatProviderLabel(settings?.llm.provider || 'qwen')}</SummaryValue></div>
                <div>模型: <SummaryValue>{settings?.llm.model || 'qwen3.6-plus'}</SummaryValue></div>
                <div>接口: <SummaryValue>{settings?.llm.baseUrl || '未设置'}</SummaryValue></div>
                <div>Key: <SummaryValue>{describeKey(settings?.llm.apiKey || '', Boolean(settings?.llm.useBuiltinKey), Boolean(settings?.llm.builtinKeyAvailable), settings?.llm.builtinKeySource)}</SummaryValue></div>
                <div>来源: <SummaryValue>{settings?.llm.useBuiltinKey ? formatBuiltinKeySource(settings?.llm.builtinKeySource) : '用户自定义 Key'}</SummaryValue></div>
                <div>
                  <SummaryTag $ok={Boolean(settings?.llm.useBuiltinKey && settings?.llm.builtinKeyAvailable)} $warn={Boolean(settings?.llm.useBuiltinKey && !settings?.llm.builtinKeyAvailable)}>
                    {settings?.llm.useBuiltinKey ? (settings?.llm.builtinKeyAvailable ? '内置 Key' : '内置 Key 不可用') : '自定义 Key'}
                  </SummaryTag>
                </div>
              </SummaryMeta>
            </SummaryCard>
            <SummaryCard>
              <SummaryTitle>全局知识库</SummaryTitle>
              <SummaryMeta>
                <div>参考资料: <SummaryValue>{referenceDocumentIds.length}</SummaryValue></div>
                <div>模板文档: <SummaryValue>{templateDocumentId ? '已选定' : '未设置'}</SummaryValue></div>
                <div>更新时间: <SummaryValue>{info?.updatedAt ? new Date(info.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '未初始化'}</SummaryValue></div>
              </SummaryMeta>
            </SummaryCard>
            <SummaryCard>
              <SummaryTitle>默认写作预设</SummaryTitle>
              <SummaryMeta>
                <div>文章类型: <SummaryValue>{formatPaperType(settings?.defaults.paperType || 'review')}</SummaryValue></div>
                <div>写作语言: <SummaryValue>{formatLanguage(settings?.defaults.language || 'zh')}</SummaryValue></div>
                <div>插图模式: <SummaryValue>{settings?.defaults.noImageMode ? '无图模式' : '自动配图'}</SummaryValue></div>
                <div>文献区间: <SummaryValue>{settings?.defaults.yearFrom || '-'} ~ {settings?.defaults.yearTo || '-'}</SummaryValue></div>
                <div>补充说明: <SummaryValue>{settings?.defaults.extraContext?.trim() ? settings.defaults.extraContext : '未设置'}</SummaryValue></div>
              </SummaryMeta>
            </SummaryCard>
            <SummaryCard>
              <SummaryTitle>引用与编辑动作</SummaryTitle>
              <SummaryMeta>
                <div>目标引用数: <SummaryValue>{settings?.defaults.referenceCount || 36}</SummaryValue></div>
                <div>Soft 保底比例: <SummaryValue>{settings?.defaults.referenceSoftFloorPercent ?? 80}%</SummaryValue></div>
                <div>候选池大小: <SummaryValue>{settings?.defaults.referenceCandidatePoolSize || 500}</SummaryValue></div>
                <div>分析窗口: <SummaryValue>{settings?.defaults.referenceAnalysisWindow || 40}</SummaryValue></div>
                <div>续写字数: <SummaryValue>{settings?.defaults.targetWords || 500}</SummaryValue></div>
                <div>续写目标: <SummaryValue>{settings?.defaults.continueGoal || '未设置'}</SummaryValue></div>
                <div>重写要求: <SummaryValue>{settings?.defaults.rewriteRequirements || '未设置'}</SummaryValue></div>
              </SummaryMeta>
            </SummaryCard>
            <SummaryRow>
              <SummaryButton onClick={() => void refreshSettings()}>刷新配置</SummaryButton>
              <SummaryButton $primary onClick={() => void runLlmTest()} disabled={testingLlm}>{testingLlm ? '测试中...' : '测试文字'}</SummaryButton>
            </SummaryRow>
          </SettingSummary>
          <FullSettingsPanel />
        </>}
      </Body>

      <StatusBar
        $error={!!(statusMessage && (statusMessage.includes('失败') || statusMessage.includes('超时') || statusMessage.includes('无法连接')))}
        title={backendStatus || undefined}
      >
        {statusMessage || runtimeHint || backendStatus || 'AI-Office 3.0'}
      </StatusBar>
    </Panel>
  )
}

export default AISidebar