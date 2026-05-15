import React, { useEffect, useRef } from 'react'
import styled from 'styled-components'
import type { PptSlidePreview } from '../../../contexts/GenerationWorkbenchContext'

// ---- Styled components — Light Directory Style ------------------

const Nav = styled.div`
  width: 180px;
  min-width: 160px;
  flex-shrink: 0;
  overflow-y: auto;
  overflow-x: hidden;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 6px;
  border-right: 1px solid #e5e7eb;

  &::-webkit-scrollbar { width: 4px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 2px; }
`

const NavModeBadge = styled.div<{ $mode: 'source' | 'retemplated' | 'structure' }>`
  margin: 0 2px 6px;
  padding: 5px 8px;
  border-radius: 8px;
  font-size: var(--font-size-xs);
  font-weight: 700;
  text-align: center;
  ${({ $mode }) => {
    if ($mode === 'source') return 'background: #eef2ff; color: #3730a3; border: 1px solid #c7d2fe;'
    if ($mode === 'retemplated') return 'background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0;'
    return 'background: #f3f4f6; color: #4b5563; border: 1px solid #e5e7eb;'
  }}
`

const DirItem = styled.div<{ $active: boolean; $loading?: boolean }>`
  display: flex;
  align-items: flex-start;
  gap: 7px;
  padding: 7px 8px;
  border-radius: 6px;
  cursor: pointer;
  border: 1.5px solid ${({ $active }) => $active ? '#3b82f6' : 'transparent'};
  background: ${({ $active }) => $active ? '#eff6ff' : 'transparent'};
  transition: background 0.12s, border-color 0.12s;

  &:hover {
    background: ${({ $active }) => $active ? '#eff6ff' : '#f3f4f6'};
    border-color: ${({ $active }) => $active ? '#3b82f6' : '#e5e7eb'};
  }

  ${({ $loading }) => $loading && `
    animation: pulse 1.2s ease-in-out infinite;
    @keyframes pulse { 0%,100% { opacity: 0.6; } 50% { opacity: 1; } }
  `}
`

const PageNum = styled.div<{ $active: boolean }>`
  font-size: var(--font-size-xs);
  font-weight: 700;
  color: ${({ $active }) => $active ? '#3b82f6' : '#9ca3af'};
  min-width: 16px;
  flex-shrink: 0;
  padding-top: 1px;
  line-height: 1;
  text-align: center;
`

const DirContent = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
`

const DirTitle = styled.div<{ $active: boolean }>`
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: ${({ $active }) => $active ? '#1d4ed8' : '#374151'};
  line-height: 1.35;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  word-break: break-all;
`

const IntentBadge = styled.div<{ $intent: string }>`
  font-size: 9px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 10px;
  align-self: flex-start;
  ${({ $intent }) => {
    switch ($intent) {
      case 'cover':          return 'background: #fef3c7; color: #92400e;'
      case 'toc':            return 'background: #e0e7ff; color: #3730a3;'
      case 'section':
      case 'section_divider': return 'background: #f0fdf4; color: #166534;'
      case 'content_cards':
      case 'cards':          return 'background: #fff7ed; color: #9a3412;'
      case 'image_text':     return 'background: #fdf4ff; color: #7e22ce;'
      case 'closing':
      case 'summary':        return 'background: #ecfeff; color: #155e75;'
      default:               return 'background: #f3f4f6; color: #6b7280;'
    }
  }}
`

const GeneratingDot = styled.div`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #f59e0b;
  animation: blink 1s ease-in-out infinite;
  flex-shrink: 0;
  margin-top: 4px;
  @keyframes blink { 0%,100% { opacity: 0.3; } 50% { opacity: 1; } }
`

// ---- Helpers ----

function getIntentLabel(type: string): string {
  switch (type) {
    case 'cover':           return '封面'
    case 'toc':             return '目录'
    case 'section':
    case 'section_divider': return '章节'
    case 'content':
    case 'text_content':    return '内容'
    case 'cards':
    case 'content_cards':   return '卡片'
    case 'image_text':      return '图文'
    case 'metrics':         return '指标'
    case 'comparison':      return '对比'
    case 'timeline':        return '时间线'
    case 'closing':
    case 'summary':         return '总结'
    default:                return '通用'
  }
}

// ---- Props ----

interface PptSlideNavigatorProps {
  slides: PptSlidePreview[]
  activeIndex: number
  skillColor?: string
  generatingIndex?: number
  previewMode?: 'source' | 'retemplated' | 'structure'
  onSelectSlide: (index: number) => void
}

export default function PptSlideNavigator({
  slides,
  activeIndex,
  generatingIndex,
  previewMode = 'structure',
  onSelectSlide,
}: PptSlideNavigatorProps) {
  const activeRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeIndex])

  if (slides.length === 0) {
    return (
      <Nav>
        <div style={{ fontSize: 14, color: '#9ca3af', textAlign: 'center', marginTop: 24 }}>
          暂无幻灯片
        </div>
      </Nav>
    )
  }

  return (
    <Nav>
      <NavModeBadge $mode={previewMode}>
        {previewMode === 'source' ? '原版 PPT 预览' : previewMode === 'retemplated' ? '套模板预览' : '结构预览'}
      </NavModeBadge>
      {slides.map((slide, i) => {
        const isActive = i === activeIndex
        const isGen = generatingIndex !== undefined && i === generatingIndex
        const displayTitle = slide.title || slide.heading || `第 ${i + 1} 页`

        return (
          <DirItem
            key={i}
            $active={isActive}
            $loading={isGen}
            ref={isActive ? (el => { activeRef.current = el }) : undefined}
            onClick={() => onSelectSlide(i)}
          >
            <PageNum $active={isActive}>{i + 1}</PageNum>
            <DirContent>
              {slide.imagePath ? (
                <img
                  src={`file://${slide.imagePath}`}
                  alt={`slide ${i + 1}`}
                  style={{ width: '100%', borderRadius: 3, marginBottom: 3, display: 'block', border: '1px solid #e5e7eb' }}
                />
              ) : null}
              <DirTitle $active={isActive}>{displayTitle}</DirTitle>
              <IntentBadge $intent={slide.type}>{getIntentLabel(slide.type)}</IntentBadge>
            </DirContent>
            {isGen && <GeneratingDot />}
          </DirItem>
        )
      })}
    </Nav>
  )
}
