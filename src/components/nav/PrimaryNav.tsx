import styled from 'styled-components'
import React from 'react'
import { Briefcase, BookOpen, Heart, FolderOpen, Settings, User, Home, MessageCircle, Puzzle } from 'lucide-react'
import { PRODUCT_FEATURES } from '../../config/productFeatures'

// 'workspace' is kept for internal use (tool launch state), but is not a nav item
export type PrimarySection = 'home' | 'work' | 'study' | 'life' | 'resource' | 'chat' | 'contacts' | 'workspace' | 'settings' | 'account' | 'skill-center' | 'calendar'

interface PrimaryNavProps {
  section: PrimarySection
  onNavigate: (section: PrimarySection) => void
  username?: string | null
}

interface NavItemDef {
  section: PrimarySection
  label: string
  title: string
  icon: React.ComponentType<{ size?: number }>
  featureKey: keyof typeof PRODUCT_FEATURES
}

/** 主导航项定义 — 通过 PRODUCT_FEATURES 统一控制是否渲染，不要直接删除此数组中的条目 */
const TOP_NAV_ITEM_DEFS: NavItemDef[] = [
  { section: 'home',        label: '首页', title: '首页',      icon: Home,          featureKey: 'home' },
  { section: 'work',        label: '工作', title: '工作',      icon: Briefcase,     featureKey: 'work' },
  { section: 'study',       label: '学习', title: '学习',      icon: BookOpen,      featureKey: 'learning' },
  { section: 'life',        label: '生活', title: '生活',      icon: Heart,         featureKey: 'life' },
  { section: 'resource',    label: '资源', title: '资源',      icon: FolderOpen,    featureKey: 'resources' },
  { section: 'skill-center',label: 'Skill',title: 'Skill 中心',icon: Puzzle,        featureKey: 'skills' },
  { section: 'chat',        label: '通讯', title: '通讯',      icon: MessageCircle, featureKey: 'communication' },
]

const ENABLED_TOP_NAV_ITEMS = TOP_NAV_ITEM_DEFS.filter(item => PRODUCT_FEATURES[item.featureKey])

const NavShell = styled.nav`
  width: 84px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, #1a2840 0%, #1e3252 100%);
  border-right: 1px solid #14213a;
  overflow: hidden;
`

const NavTop = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 6px 0;
  gap: 2px;
`

const NavBottom = styled.div`
  display: flex;
  flex-direction: column;
  padding: 6px 0 12px;
  gap: 2px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
`

const NavItem = styled.button<{ $active?: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  width: 100%;
  min-height: 70px;
  padding: 12px 4px;
  border: none;
  border-radius: 0;
  background: ${p => p.$active ? 'rgba(31, 111, 214, 0.85)' : 'transparent'};
  color: ${p => p.$active ? '#ffffff' : 'rgba(200, 215, 235, 0.78)'};
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  position: relative;

  &:hover {
    background: ${p => p.$active ? 'rgba(31, 111, 214, 0.9)' : 'rgba(255, 255, 255, 0.08)'};
    color: ${p => p.$active ? '#ffffff' : '#d8e8f5'};
  }

  &::before {
    content: '';
    display: ${p => p.$active ? 'block' : 'none'};
    position: absolute;
    left: 0;
    top: 20%;
    bottom: 20%;
    width: 3px;
    border-radius: 0 3px 3px 0;
    background: #5badff;
  }
`

const NavLabel = styled.span`
  font-size: var(--font-size-sm);
  font-weight: 500;
  line-height: 1;
  letter-spacing: 0.01em;
`

const AppTitle = styled.div`
  padding: 14px 0 10px;
  text-align: center;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: rgba(180, 200, 225, 0.5);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
`

export default function PrimaryNav({ section, onNavigate, username }: PrimaryNavProps) {
  return (
    <NavShell>
      <AppTitle>AI·OFFICE</AppTitle>
      <NavTop>
        {ENABLED_TOP_NAV_ITEMS.map(({ section: s, label, title, icon: Icon }) => (
          <NavItem key={s} $active={section === s} onClick={() => onNavigate(s)} title={title}>
            <Icon size={22} />
            <NavLabel>{label}</NavLabel>
          </NavItem>
        ))}
      </NavTop>
      <NavBottom>
        <NavItem $active={section === 'settings'} onClick={() => onNavigate('settings')} title="设置">
          <Settings size={22} />
          <NavLabel>设置</NavLabel>
        </NavItem>
        <NavItem $active={section === 'account'} onClick={() => onNavigate('account')} title={username || '账号'}>
          <User size={22} />
          <NavLabel>{username ? username.slice(0, 3) : '账号'}</NavLabel>
        </NavItem>
      </NavBottom>
    </NavShell>
  )
}
