import React from 'react'
import styled from 'styled-components'
import type { PptSlidePreview } from '../../../contexts/GenerationWorkbenchContext'

// ---- Slide container (always 16:9) --------------------------------

const SlideOuter = styled.div`
  position: relative;
  width: 100%;
  padding-bottom: 56.25%;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 16px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.06);
  background: #fff;
`

const SlideInner = styled.div<{ $bg: string; $fg: string }>`
  position: absolute;
  inset: 0;
  background: ${({ $bg }) => $bg};
  color: ${({ $fg }) => $fg};
  font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`

// ---- Typography helpers -------------------------------------------

const SlideTitle = styled.div<{ $accent: string }>`
  font-size: clamp(11px, 1.8vw, 22px);
  font-weight: 800;
  letter-spacing: 0.01em;
  line-height: 1.3;
  color: ${({ $accent }) => $accent};
  margin-bottom: 0.4em;
`

const SlideSubtitle = styled.div`
  font-size: clamp(8px, 1.1vw, 14px);
  opacity: 0.75;
  line-height: 1.5;
`

const SlideHeading = styled.div<{ $accent: string }>`
  font-size: clamp(10px, 1.5vw, 18px);
  font-weight: 700;
  color: ${({ $accent }) => $accent};
  margin-bottom: 0.5em;
  padding-bottom: 0.25em;
  border-bottom: 2px solid ${({ $accent }) => $accent}55;
`

const SlideBody = styled.div`
  font-size: clamp(7px, 1vw, 12px);
  opacity: 0.8;
  line-height: 1.6;
  margin-bottom: 0.4em;
`

const SlideBullet = styled.div<{ $accent: string }>`
  font-size: clamp(6.5px, 0.9vw, 11px);
  line-height: 1.5;
  padding: 2px 0 2px 1em;
  opacity: 0.9;
  &::before {
    content: '▸';
    margin-right: 0.4em;
    color: ${({ $accent }) => $accent};
    position: absolute;
    margin-left: -1em;
  }
  position: relative;
`

// ---- Layout primitives -------------------------------------------

const SlideContent = styled.div`
  flex: 1;
  padding: clamp(8px, 2%, 24px) clamp(10px, 3%, 36px);
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
`

const TopAccentBar = styled.div<{ $color: string }>`
  height: 4px;
  background: ${({ $color }) => $color};
  flex-shrink: 0;
`

const TwoCol = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  flex: 1;
  overflow: hidden;
`

const ColCard = styled.div<{ $accent: string }>`
  border: 1px solid ${({ $accent }) => $accent}44;
  border-radius: 6px;
  padding: 6px 8px;
  overflow: hidden;
`

const ColLabel = styled.div<{ $accent: string }>`
  font-size: clamp(6px, 0.85vw, 10px);
  font-weight: 700;
  color: ${({ $accent }) => $accent};
  margin-bottom: 4px;
`

const MetricsRow = styled.div`
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  flex: 1;
`

const MetricCard = styled.div<{ $accent: string }>`
  flex: 1;
  min-width: 56px;
  border: 1px solid ${({ $accent }) => $accent}44;
  border-radius: 6px;
  padding: 6px;
  text-align: center;
`

const MetricValue = styled.div<{ $accent: string }>`
  font-size: clamp(10px, 1.5vw, 20px);
  font-weight: 800;
  color: ${({ $accent }) => $accent};
`

const MetricLabel = styled.div`
  font-size: clamp(5.5px, 0.7vw, 9px);
  opacity: 0.7;
  margin-top: 2px;
`

const TimelineRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  overflow: hidden;
`

const TimelineNode = styled.div<{ $accent: string }>`
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: clamp(6px, 0.85vw, 10px);
  &::before {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: ${({ $accent }) => $accent};
    flex-shrink: 0;
    margin-top: 1px;
  }
`

const TocList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  overflow: hidden;
`

const TocItem = styled.div<{ $accent: string }>`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: clamp(7px, 1vw, 12px);
  opacity: 0.9;
  &::before {
    content: '';
    width: 3px;
    height: 1em;
    background: ${({ $accent }) => $accent};
    border-radius: 2px;
    flex-shrink: 0;
  }
`

const ImagePlaceholder = styled.div<{ $accent: string }>`
  background: ${({ $accent }) => $accent}22;
  border: 1px dashed ${({ $accent }) => $accent}66;
  border-radius: 4px;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: clamp(5px, 0.7vw, 9px);
  color: ${({ $accent }) => $accent}99;
  min-height: 32px;
  animation: pulsePlaceholder 1.5s ease-in-out infinite;
  @keyframes pulsePlaceholder {
    0%, 100% { opacity: 0.5; }
    50% { opacity: 1; }
  }
`

const SlideImage = styled.img`
  width: 100%;
  max-height: 38%;
  object-fit: cover;
  border-radius: 4px;
  flex-shrink: 0;
`

const SectionBanner = styled.div<{ $accent: string }>`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${({ $accent }) => $accent}22;
  border-radius: 4px;
  padding: 8px;
`

const LoadingOverlay = styled.div`
  position: absolute;
  inset: 0;
  background: rgba(255,255,255,0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-xs);
  color: #374151;
  letter-spacing: 0.06em;
  backdrop-filter: blur(2px);
`

// ---- Theme helper — always light office PPT style ----------------

interface SlideTheme {
  bg: string
  fg: string
  accent: string
}

function themeFromSkillColor(previewColor: string | undefined): SlideTheme {
  // Always use white background for the live preview (actual template colors show in final PPTX)
  const hex = previewColor ? previewColor.replace('#', '') : '2563eb'
  const accent = hex.length === 6 ? `#${hex}` : '#2563eb'
  return { bg: '#ffffff', fg: '#1e293b', accent }
}

// ---- Per-type renderers -----------------------------------------

function CoverContent({ slide, theme }: { slide: PptSlidePreview; theme: SlideTheme }) {
  return (
    <>
      <TopAccentBar $color={theme.accent} />
      <SlideContent style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
        <SlideTitle $accent={theme.accent} style={{ fontSize: 'clamp(14px, 2.5vw, 30px)', marginBottom: '0.6em' }}>
          {slide.title || slide.heading || '演示标题'}
        </SlideTitle>
        {(slide.subtitle) && (
          <SlideSubtitle>{slide.subtitle}</SlideSubtitle>
        )}
      </SlideContent>
    </>
  )
}

function TocContent({ slide, theme }: { slide: PptSlidePreview; theme: SlideTheme }) {
  return (
    <>
      <TopAccentBar $color={theme.accent} />
      <SlideContent>
        <SlideHeading $accent={theme.accent}>{slide.title || slide.heading || '目录'}</SlideHeading>
        <TocList>
          {(slide.items || []).slice(0, 8).map((item, i) => (
            <TocItem key={i} $accent={theme.accent}>{item}</TocItem>
          ))}
        </TocList>
      </SlideContent>
    </>
  )
}

function SectionContent({ slide, theme }: { slide: PptSlidePreview; theme: SlideTheme }) {
  return (
    <>
      <TopAccentBar $color={theme.accent} />
      <SlideContent style={{ justifyContent: 'center' }}>
        <SectionBanner $accent={theme.accent}>
          <SlideTitle $accent={theme.accent} style={{ textAlign: 'center' }}>
            {slide.heading || slide.title || '章节'}
          </SlideTitle>
        </SectionBanner>
        {slide.subtitle && <SlideSubtitle style={{ textAlign: 'center', marginTop: 6 }}>{slide.subtitle}</SlideSubtitle>}
      </SlideContent>
    </>
  )
}

function ContentContent({ slide, theme }: { slide: PptSlidePreview; theme: SlideTheme }) {
  const hasImage = Boolean(slide.imagePath || slide.imageLoading)
  return (
    <>
      <TopAccentBar $color={theme.accent} />
      <SlideContent style={{ flexDirection: 'row', gap: 8 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <SlideHeading $accent={theme.accent}>{slide.heading || slide.title || '内容'}</SlideHeading>
          {slide.body && <SlideBody>{slide.body}</SlideBody>}
          <div style={{ flex: 1, overflow: 'hidden' }}>
            {(slide.items || []).slice(0, 6).map((item, i) => (
              <SlideBullet key={i} $accent={theme.accent}>{item}</SlideBullet>
            ))}
          </div>
        </div>
        {hasImage && (
          <div style={{ width: '35%', display: 'flex', flexDirection: 'column' }}>
            {slide.imageLoading
              ? <ImagePlaceholder $accent={theme.accent}>图片生成中…</ImagePlaceholder>
              : slide.imagePath
                ? <SlideImage src={`file://${slide.imagePath}`} alt="" />
                : <ImagePlaceholder $accent={theme.accent}>图片</ImagePlaceholder>
            }
          </div>
        )}
      </SlideContent>
    </>
  )
}

function MetricsContent({ slide, theme }: { slide: PptSlidePreview; theme: SlideTheme }) {
  return (
    <>
      <TopAccentBar $color={theme.accent} />
      <SlideContent>
        <SlideHeading $accent={theme.accent}>{slide.heading || slide.title || '核心指标'}</SlideHeading>
        {slide.body && <SlideBody>{slide.body}</SlideBody>}
        <MetricsRow>
          {(slide.metrics || []).slice(0, 4).map((m, i) => (
            <MetricCard key={i} $accent={theme.accent}>
              <MetricValue $accent={theme.accent}>{m.value}</MetricValue>
              <MetricLabel>{m.label}</MetricLabel>
              {m.detail && <MetricLabel style={{ opacity: 0.55 }}>{m.detail}</MetricLabel>}
            </MetricCard>
          ))}
        </MetricsRow>
      </SlideContent>
    </>
  )
}

function ComparisonContent({ slide, theme }: { slide: PptSlidePreview; theme: SlideTheme }) {
  return (
    <>
      <TopAccentBar $color={theme.accent} />
      <SlideContent>
        <SlideHeading $accent={theme.accent}>{slide.heading || '对比'}</SlideHeading>
        <TwoCol>
          <ColCard $accent={theme.accent}>
            <ColLabel $accent={theme.accent}>{slide.leftTitle || '左侧'}</ColLabel>
            {(slide.leftItems || []).slice(0, 4).map((item, i) => (
              <SlideBullet key={i} $accent={theme.accent}>{item}</SlideBullet>
            ))}
          </ColCard>
          <ColCard $accent={theme.accent}>
            <ColLabel $accent={theme.accent}>{slide.rightTitle || '右侧'}</ColLabel>
            {(slide.rightItems || []).slice(0, 4).map((item, i) => (
              <SlideBullet key={i} $accent={theme.accent}>{item}</SlideBullet>
            ))}
          </ColCard>
        </TwoCol>
      </SlideContent>
    </>
  )
}

function TimelineContent({ slide, theme }: { slide: PptSlidePreview; theme: SlideTheme }) {
  return (
    <>
      <TopAccentBar $color={theme.accent} />
      <SlideContent>
        <SlideHeading $accent={theme.accent}>{slide.heading || '时间线'}</SlideHeading>
        <TimelineRow>
          {(slide.timeline || []).slice(0, 5).map((node, i) => (
            <TimelineNode key={i} $accent={theme.accent}>
              <div>
                <div style={{ fontWeight: 700 }}>{node.title}</div>
                {node.detail && <div style={{ opacity: 0.65 }}>{node.detail}</div>}
              </div>
            </TimelineNode>
          ))}
        </TimelineRow>
      </SlideContent>
    </>
  )
}

function SummaryContent({ slide, theme }: { slide: PptSlidePreview; theme: SlideTheme }) {
  return (
    <>
      <TopAccentBar $color={theme.accent} />
      <SlideContent>
        <SlideHeading $accent={theme.accent}>{slide.heading || slide.title || '总结'}</SlideHeading>
        {slide.body && <SlideBody>{slide.body}</SlideBody>}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {(slide.items || []).slice(0, 5).map((item, i) => (
            <SlideBullet key={i} $accent={theme.accent}>{item}</SlideBullet>
          ))}
        </div>
      </SlideContent>
    </>
  )
}

// ---- Main component ---------------------------------------------

interface PptSlidePreviewCanvasProps {
  slide: PptSlidePreview
  skillColor?: string
  isGenerating?: boolean
  style?: React.CSSProperties
}

export default function PptSlidePreviewCanvas({ slide, skillColor, isGenerating, style }: PptSlidePreviewCanvasProps) {
  const theme = themeFromSkillColor(skillColor)

  const renderContent = () => {
    switch (slide.type) {
      case 'cover':          return <CoverContent slide={slide} theme={theme} />
      case 'toc':            return <TocContent slide={slide} theme={theme} />
      case 'section':
      case 'section_divider': return <SectionContent slide={slide} theme={theme} />
      case 'content':
      case 'text_content':   return <ContentContent slide={slide} theme={theme} />
      case 'content_cards':
      case 'cards':          return <MetricsContent slide={slide} theme={theme} />
      case 'metrics':        return <MetricsContent slide={slide} theme={theme} />
      case 'comparison':     return <ComparisonContent slide={slide} theme={theme} />
      case 'timeline':       return <TimelineContent slide={slide} theme={theme} />
      case 'image_text':     return <ContentContent slide={slide} theme={theme} />
      case 'closing':
      case 'summary':        return <SummaryContent slide={slide} theme={theme} />
      default:               return <ContentContent slide={slide} theme={theme} />
    }
  }

  return (
    <SlideOuter style={style}>
      <SlideInner $bg={theme.bg} $fg={theme.fg}>
        {renderContent()}
      </SlideInner>
      {isGenerating && (
        <LoadingOverlay>正在生成…</LoadingOverlay>
      )}
    </SlideOuter>
  )
}
