import React, { useState } from 'react'
import styled from 'styled-components'
import FullSettingsPanel from '../components/FullSettingsPanel'
const Shell = styled.div`
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
  background: #f4f7fb;
`

const Sidebar = styled.nav`
  width: 180px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border-right: 1px solid #e0e8f2;
  padding: 20px 0 12px;
`

const SidebarTitle = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 700;
  color: #1f3142;
  padding: 0 16px 12px;
  border-bottom: 1px solid #e7edf4;
  margin-bottom: 8px;
`

const NavItem = styled.button<{ $active?: boolean }>`
  width: 100%;
  text-align: left;
  padding: 9px 18px;
  border: none;
  background: ${p => p.$active ? '#eef4ff' : 'transparent'};
  color: ${p => p.$active ? '#1a5fb4' : '#304255'};
  font-size: var(--font-size-xs);
  font-weight: ${p => p.$active ? '600' : '400'};
  cursor: pointer;
  border-left: ${p => p.$active ? '3px solid #1a5fb4' : '3px solid transparent'};
  transition: background 0.12s;

  &:hover {
    background: ${p => p.$active ? '#eef4ff' : '#f5f8ff'};
  }
`

const Content = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 24px 28px;
  min-width: 0;
`

const PageTitle = styled.h1`
  font-size: 20px;
  font-weight: 700;
  color: #1f3142;
  margin: 0 0 4px;
`

const PageSubtitle = styled.p`
  font-size: var(--font-size-xs);
  color: #627385;
  margin: 0 0 24px;
`

type SettingsCategory = 'ai' | 'display' | 'skills' | 'about'

const SCALE_OPTIONS: { label: string; value: string }[] = [
  { label: '100%（默认）', value: '1' },
  { label: '110%', value: '1.1' },
  { label: '125%', value: '1.25' },
  { label: '150%', value: '1.5' },
]

const ScaleGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin-top: 16px;
`

const ScaleOption = styled.button<{ $selected: boolean }>`
  padding: 14px 18px;
  border: 2px solid ${p => p.$selected ? '#1a5fb4' : '#dde3ec'};
  border-radius: 10px;
  background: ${p => p.$selected ? '#eef4ff' : '#ffffff'};
  color: ${p => p.$selected ? '#1a5fb4' : '#304255'};
  font-size: 14px;
  font-weight: ${p => p.$selected ? '700' : '400'};
  cursor: pointer;
  text-align: left;
  transition: border-color 0.13s, background 0.13s;
  &:hover {
    border-color: ${p => p.$selected ? '#1a5fb4' : '#96b8dc'};
    background: ${p => p.$selected ? '#eef4ff' : '#f5f9ff'};
  }
`

const ScaleHint = styled.p`
  font-size: var(--font-size-xs);
  color: #627385;
  margin: 12px 0 0;
`

function DisplayScaleSection() {
  const stored = localStorage.getItem('aioffice.displayScale') ?? '1'
  const [scale, setScale] = React.useState(stored)

  function applyScale(value: string) {
    setScale(value)
    localStorage.setItem('aioffice.displayScale', value)
    document.documentElement.style.zoom = value
  }

  return (
    <>
      <PageTitle>显示与缩放</PageTitle>
      <PageSubtitle>调整整体界面缩放比例，适合高分辨率屏幕或大屏全屏使用。</PageSubtitle>
      <ScaleGrid>
        {SCALE_OPTIONS.map(opt => (
          <ScaleOption
            key={opt.value}
            $selected={scale === opt.value}
            onClick={() => applyScale(opt.value)}
          >
            {opt.label}
          </ScaleOption>
        ))}
      </ScaleGrid>
      <ScaleHint>缩放设置立即生效，重启应用后仍保持。</ScaleHint>
    </>
  )
}

function SkillsSection() {
  return (
    <>
      <PageTitle>Skill 管理中心</PageTitle>
      <PageSubtitle>Skill 商店、已购 Skill 包、下载、安装和启用状态已移到左侧侧边栏的 Skill 中心。</PageSubtitle>
      <div style={{
        padding: '16px 18px',
        background: '#f0f6ff',
        border: '1px solid #c5d9f5',
        borderRadius: 10,
        fontSize: 14,
        color: '#1a3a5c',
        lineHeight: 1.7,
      }}>
        请点击左侧侧边栏的 <strong>🧩 Skill 中心</strong> 入口，管理已购 Skill 包、下载 .aoskin 文件、打开 Skill 商店。
      </div>
    </>
  )
}

export default function SettingsView() {
  const [category, setCategory] = useState<SettingsCategory>('ai')

  return (
    <Shell>
      <Sidebar>
        <SidebarTitle>设置</SidebarTitle>
        <NavItem $active={category === 'ai'} onClick={() => setCategory('ai')}>AI 与服务配置</NavItem>
        <NavItem $active={category === 'display'} onClick={() => setCategory('display')}>显示与缩放</NavItem>
        <NavItem $active={category === 'skills'} onClick={() => setCategory('skills')}>Skill 管理中心</NavItem>
        <NavItem $active={category === 'about'} onClick={() => setCategory('about')}>关于</NavItem>
      </Sidebar>
      <Content>
        {category === 'ai' && (
          <>
            <PageTitle>AI 与服务配置</PageTitle>
            <PageSubtitle>配置 AI 模型、API 密钥、图片生成服务和邮件服务。</PageSubtitle>
            <FullSettingsPanel />
          </>
        )}
        {category === 'display' && <DisplayScaleSection />}
        {category === 'skills' && <SkillsSection />}
        {category === 'about' && (
          <>
            <PageTitle>关于 AI-Office</PageTitle>
            <PageSubtitle>版本信息与系统状态。</PageSubtitle>
            <div style={{ fontSize: 14, color: '#304255', lineHeight: 1.8 }}>
              <div>AI-Office <strong>3.0</strong></div>
              <div style={{ marginTop: 8, color: '#627385' }}>
                基于 Electron + React 构建的智能办公平台。
              </div>
            </div>
          </>
        )}
      </Content>
    </Shell>
  )
}
