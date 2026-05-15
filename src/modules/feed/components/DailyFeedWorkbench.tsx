import React, { useCallback, useEffect, useMemo, useState } from 'react'
import styled, { css } from 'styled-components'
import { ChevronLeft } from 'lucide-react'
import { markdownToHtml } from '../../../utils/markdownToHtml'
import {
  editionLabel,
  fetchSciencerelayArticleDetail,
  fetchSciencerelayArticles,
  fetchSciencerelayTopics,
  markdownForEdition,
  pickCoverCaption,
  pickCoverUrl,
  pickListSummary,
  pickListTitle,
  pickTopicLabel,
  type SciencerelayDetailPayload,
  type SciencerelayEdition,
  type SciencerelayListItem,
  type SciencerelayTopicItem,
} from '../services/sciencerelayApi'

const LANG = 'zh'
const LIST_EDITION: SciencerelayEdition = 'middle'
const PAGE_SIZE = 20

/** 列表卡片固定行高：避免 flex 子项被压成细条、封面与标题不可见 */
const LIST_CARD_MIN_H = 156
const LIST_COVER_W = 200

const hideScrollbars = css`
  scrollbar-width: none;
  -ms-overflow-style: none;
  &::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
  }
`

const Shell = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, #f8fbfe 0%, #eef4f9 100%);
`

const DetailBackRow = styled.div`
  flex-shrink: 0;
  padding: 12px 10px 0;
`

const BackBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid #c5d6ea;
  background: #fff;
  color: #1f3447;
  font-size: var(--font-size-xs);
  font-weight: 700;
  cursor: pointer;
  &:hover {
    background: #f0f6fc;
  }
`

/** 列表页整体下移：留白在视口最顶，标签与资讯流间距不变 */
const ListPageBody = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding-top: 18px;
`

const TopicChips = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 0 10px 12px;
  flex-shrink: 0;
`

const Chip = styled.button<{ $active?: boolean }>`
  height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid ${({ $active }) => ($active ? '#1f6fd6' : '#cad6e2')};
  background: ${({ $active }) => ($active ? '#e8f1fc' : '#fff')};
  color: ${({ $active }) => ($active ? '#0f4a8a' : '#42576b')};
  font-size: var(--font-size-xs);
  font-weight: 700;
  cursor: pointer;
  &:hover {
    background: ${({ $active }) => ($active ? '#dceaf9' : '#f5f8fc')};
  }
`

const Scroll = styled.div`
  flex: 1;
  min-height: 0;
  overflow: auto;
  overflow-x: hidden;
  padding: 10px 8px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  align-items: stretch;
  ${hideScrollbars}
`

const ErrorBanner = styled.div`
  margin: 0 8px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid #fecaca;
  background: #fef2f2;
  color: #991b1b;
  font-size: var(--font-size-sm);
  line-height: 1.5;
  display: grid;
  gap: 10px;
`

const RetryBtn = styled.button`
  justify-self: start;
  height: 32px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid #991b1b;
  background: #fff;
  color: #991b1b;
  font-size: var(--font-size-xs);
  font-weight: 700;
  cursor: pointer;
  &:hover {
    background: #fff5f5;
  }
`

const ListCard = styled.button`
  flex-shrink: 0;
  box-sizing: border-box;
  text-align: left;
  margin: 0;
  padding: 0;
  border: 1px solid #dce5ef;
  border-radius: 14px;
  overflow: hidden;
  background: #fff;
  cursor: pointer;
  display: grid;
  grid-template-columns: ${LIST_COVER_W}px minmax(0, 1fr);
  grid-template-rows: ${LIST_CARD_MIN_H}px;
  min-height: ${LIST_CARD_MIN_H}px;
  width: 100%;
  align-items: stretch;
  box-shadow: 0 8px 22px rgba(31, 52, 71, 0.06);
  transition: box-shadow 0.15s ease, border-color 0.15s ease;

  &:hover {
    border-color: #b8cce4;
    box-shadow: 0 12px 28px rgba(31, 52, 71, 0.1);
  }

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
    grid-template-rows: ${LIST_CARD_MIN_H}px auto;
    min-height: calc(${LIST_CARD_MIN_H}px + 120px);
  }
`

const CoverSlot = styled.div`
  position: relative;
  box-sizing: border-box;
  width: 100%;
  height: ${LIST_CARD_MIN_H}px;
  min-height: ${LIST_CARD_MIN_H}px;
  max-height: ${LIST_CARD_MIN_H}px;
  background: #e8eef4;
`

const CoverGradient = styled.div<{ $gradient: string }>`
  box-sizing: border-box;
  width: 100%;
  height: ${LIST_CARD_MIN_H}px;
  min-height: ${LIST_CARD_MIN_H}px;
  background: ${({ $gradient }) => $gradient};
`

/** 详情无封面图时的渐变占位（高度独立于列表小封面） */
const DetailHeroPlaceholder = styled.div<{ $gradient: string }>`
  width: 100%;
  min-height: 200px;
  height: min(36vh, 320px);
  max-height: min(44vh, 400px);
  background: ${({ $gradient }) => $gradient};
`

const CoverImg = styled.img`
  display: block;
  box-sizing: border-box;
  width: 100%;
  height: ${LIST_CARD_MIN_H}px;
  min-height: ${LIST_CARD_MIN_H}px;
  max-height: ${LIST_CARD_MIN_H}px;
  object-fit: cover;
`

const CoverTag = styled.span`
  position: absolute;
  left: 10px;
  bottom: 10px;
  z-index: 1;
  font-size: var(--font-size-xs);
  font-weight: 800;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.9);
  color: #1e3a5f;
  max-width: calc(100% - 20px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const CardBody = styled.div`
  box-sizing: border-box;
  min-width: 0;
  min-height: ${LIST_CARD_MIN_H}px;
  height: ${LIST_CARD_MIN_H}px;
  max-height: ${LIST_CARD_MIN_H}px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  overflow: hidden;

  @media (max-width: 720px) {
    height: auto;
    max-height: none;
    min-height: 120px;
    padding: 14px 16px 16px;
  }
`

const Meta = styled.div`
  flex-shrink: 0;
  font-size: var(--font-size-xs);
  font-weight: 700;
  line-height: 1.35;
  color: #7a8ea2;
  word-break: break-word;
`

const Headline = styled.h2`
  flex: 1;
  margin: 0;
  min-height: 2.8em;
  max-height: 4.2em;
  font-size: 15px;
  font-weight: 800;
  color: #142a3d;
  line-height: 1.4;
  word-break: break-word;
  overflow-wrap: anywhere;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
`

const Deck = styled.p`
  flex-shrink: 0;
  margin: 0;
  min-height: 2.4em;
  max-height: calc(1.55em * 2);
  font-size: var(--font-size-sm);
  line-height: 1.55;
  color: #3d556b;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
  overflow-wrap: anywhere;
`

const LoadMoreWrap = styled.div`
  flex-shrink: 0;
  display: flex;
  justify-content: center;
  padding: 8px 0 4px;
  min-height: 52px;
  align-items: center;
`

const LoadMoreBtn = styled.button`
  height: 40px;
  padding: 0 20px;
  border-radius: 10px;
  border: 1px solid #cad6e2;
  background: #fff;
  color: #304255;
  font-size: var(--font-size-sm);
  font-weight: 700;
  cursor: pointer;
  &:hover:not(:disabled) {
    background: #f5f8fc;
  }
  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`

const DetailScroll = styled.div`
  flex: 1;
  min-height: 0;
  overflow: auto;
  overflow-x: hidden;
  padding: 0 8px 28px;
  ${hideScrollbars}
`

/** 详情顶图：完整显示，在最大宽高内按比例缩放，不裁切 */
const DetailHero = styled.div`
  flex-shrink: 0;
  width: 100%;
  margin: 0;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid #dce5ef;
  background: #e8eef4;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 160px;
`

const DetailHeroImg = styled.img`
  display: block;
  max-width: 100%;
  max-height: min(78vh, 920px);
  width: auto;
  height: auto;
  object-fit: contain;
  object-position: center;
  margin: 0 auto;
`

const DetailMediaFigure = styled.figure`
  margin: 0 0 16px;
  width: 100%;
`

const DetailFigureCaption = styled.figcaption`
  margin: 10px 0 0;
  padding: 10px 12px;
  font-size: var(--font-size-sm);
  line-height: 1.65;
  color: #3d556b;
  background: #f4f7fb;
  border-radius: 10px;
  border: 1px solid #e5edf5;
  word-break: break-word;
  overflow-wrap: anywhere;
`

const EditionRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 14px 10px 0;
`

const EditionChip = styled.button<{ $active?: boolean }>`
  height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid ${({ $active }) => ($active ? '#1f6fd6' : '#cad6e2')};
  background: ${({ $active }) => ($active ? '#e8f1fc' : '#fff')};
  color: ${({ $active }) => ($active ? '#0f4a8a' : '#42576b')};
  font-size: var(--font-size-xs);
  font-weight: 700;
  cursor: pointer;
`

const DetailBlock = styled.article`
  box-sizing: border-box;
  width: 100%;
  max-width: none;
  margin: 8px 0 0;
  padding: 18px clamp(10px, 2.5vw, 22px) 24px;
  border-radius: 14px;
  border: 1px solid #e1e9f1;
  background: #fff;
  box-shadow: 0 10px 28px rgba(31, 52, 71, 0.06);
  min-width: 0;
`

const DetailTitle = styled.h1`
  margin: 0 0 10px;
  font-size: clamp(1.05rem, 2.8vw, 1.35rem);
  font-weight: 800;
  color: #142a3d;
  line-height: 1.35;
  word-break: break-word;
  overflow-wrap: anywhere;
`

const DetailSummary = styled.p`
  margin: 0 0 14px;
  font-size: 14px;
  line-height: 1.75;
  color: #3d556b;
  word-break: break-word;
  overflow-wrap: anywhere;
`

const SubjectsLine = styled.div`
  font-size: var(--font-size-xs);
  line-height: 1.5;
  color: #6b7d90;
  margin-bottom: 12px;
  word-break: break-word;
`

const SourceLink = styled.a`
  display: inline-block;
  margin-bottom: 16px;
  font-size: var(--font-size-sm);
  font-weight: 700;
  color: #1f6fd6;
  word-break: break-all;
  &:hover {
    text-decoration: underline;
  }
`

const MarkdownBody = styled.div`
  font-size: 15px;
  line-height: 1.85;
  color: #2b3f52;
  word-break: break-word;
  overflow-wrap: anywhere;

  & h1, & h2, & h3, & h4 {
    font-weight: 800;
    margin: 1.15em 0 0.45em;
    line-height: 1.35;
    color: #142a3d;
  }
  & h1 { font-size: 1.25rem; }
  & h2 { font-size: 1.12rem; }
  & h3 { font-size: 1.02rem; }
  & p { margin: 0.65em 0; }
  & ul, & ol { margin: 0.65em 0; padding-left: 1.35em; }
  & li { margin: 0.25em 0; }
  /* 顶栏已展示封面，正文不再出图；若 HTML 中仍有残留则隐藏 */
  & img,
  & picture,
  & figure {
    display: none !important;
  }
  & code {
    font-size: 0.88em;
    padding: 0.1em 0.35em;
    border-radius: 4px;
    background: #f0f4f8;
  }
  & pre {
    overflow: auto;
    padding: 12px 14px;
    border-radius: 10px;
    background: #f4f7fb;
    border: 1px solid #e5edf5;
    font-size: var(--font-size-sm);
    line-height: 1.55;
    scrollbar-width: none;
    -ms-overflow-style: none;
    &::-webkit-scrollbar {
      display: none;
      width: 0;
      height: 0;
    }
  }
  & blockquote {
    margin: 0.75em 0;
    padding: 8px 12px;
    border-left: 4px solid #c5d6ea;
    background: #f8fafc;
    color: #3d556b;
  }
  & table {
    display: block;
    max-width: 100%;
    overflow-x: auto;
    border-collapse: collapse;
    font-size: var(--font-size-sm);
  }
  & th, & td {
    border: 1px solid #dde6ef;
    padding: 6px 8px;
  }
`

const DetailLoading = styled.div`
  padding: 24px 10px;
  text-align: center;
  color: #6b7d90;
  font-size: 14px;
`

function topicGradient(topic: string): string {
  const t = topic || '综合'
  let h = 0
  for (let i = 0; i < t.length; i += 1) h = (h * 31 + t.charCodeAt(i)) >>> 0
  const hue1 = h % 360
  const hue2 = (h * 17 + 40) % 360
  return `linear-gradient(145deg, hsl(${hue1}, 42%, 44%) 0%, hsl(${hue2}, 38%, 36%) 100%)`
}

const EDITIONS: SciencerelayEdition[] = ['primary', 'middle', 'university', 'research']

/** 详情正文不再重复展示配图：去掉 Markdown 渲染结果中的图与图容器 */
function stripCommentaryBodyImages(html: string): string {
  if (!html) return ''
  if (typeof DOMParser === 'undefined') {
    return html
      .replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, '')
      .replace(/<picture\b[^>]*>[\s\S]*?<\/picture>/gi, '')
      .replace(/<img\b[^>]*\/?>/gi, '')
  }
  const doc = new DOMParser().parseFromString(`<div data-feed-strip-root>${html}</div>`, 'text/html')
  const root = doc.querySelector('[data-feed-strip-root]')
  if (!root) return html
  root.querySelectorAll('img, picture, figure').forEach((el) => {
    el.remove()
  })
  for (let pass = 0; pass < 3; pass += 1) {
    root.querySelectorAll('p, a').forEach((el) => {
      const txt = (el.textContent || '').replace(/\u00a0/g, ' ').trim()
      if (!txt && el.children.length === 0) el.remove()
    })
  }
  return root.innerHTML
}

function detailTitle(meta: SciencerelayListItem | undefined, fallbackId: string): string {
  if (!meta) return fallbackId
  return pickListTitle(meta)
}

function detailSummary(commentary: SciencerelayDetailPayload['commentary']): string {
  return String(commentary?.oneLineSummary || '').trim()
}

function subjectsZhLine(meta: SciencerelayListItem | undefined): string | null {
  if (!meta) return null
  const zh = meta.subjectsI18n?.zh
  if (Array.isArray(zh) && zh.length) return `关键词：${zh.join('、')}`
  if (Array.isArray(meta.subjects) && meta.subjects.length) return `关键词：${meta.subjects.join('、')}`
  return null
}

export default function DailyFeedWorkbench() {
  const [topics, setTopics] = useState<SciencerelayTopicItem[]>([])
  const [topicKey, setTopicKey] = useState('')
  const [listReloadNonce, setListReloadNonce] = useState(0)
  const [items, setItems] = useState<SciencerelayListItem[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailEdition, setDetailEdition] = useState<SciencerelayEdition>('middle')
  const [detailPayload, setDetailPayload] = useState<SciencerelayDetailPayload | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailRetryNonce, setDetailRetryNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const t = await fetchSciencerelayTopics(LANG)
        if (!cancelled) setTopics(t)
      } catch {
        if (!cancelled) setTopics([])
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    setListLoading(true)
    setListError(null)
    setItems([])
    setHasMore(false)
    void (async () => {
      try {
        const data = await fetchSciencerelayArticles({
          offset: 0,
          limit: PAGE_SIZE,
          lang: LANG,
          topic: topicKey || undefined,
          edition: LIST_EDITION,
        })
        if (cancelled) return
        if (!data?.ok) throw new Error('列表数据异常')
        const batch = data.items || []
        setItems(batch)
        setHasMore(Boolean(data.hasMore))
      } catch (e) {
        if (!cancelled) {
          setListError(e instanceof Error ? e.message : String(e))
          setItems([])
        }
      } finally {
        if (!cancelled) setListLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [topicKey, listReloadNonce])

  const onTopicSelect = useCallback((key: string) => {
    setTopicKey(key)
  }, [])

  const retryList = useCallback(() => {
    setListReloadNonce((n) => n + 1)
  }, [])

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || listLoading) return
    setLoadingMore(true)
    try {
      const data = await fetchSciencerelayArticles({
        offset: items.length,
        limit: PAGE_SIZE,
        lang: LANG,
        topic: topicKey || undefined,
        edition: LIST_EDITION,
      })
      if (!data?.ok) throw new Error('加载更多失败')
      const batch = data.items || []
      setItems((prev) => [...prev, ...batch])
      setHasMore(Boolean(data.hasMore))
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingMore(false)
    }
  }, [hasMore, items.length, listLoading, loadingMore, topicKey])

  useEffect(() => {
    if (!detailId) {
      setDetailPayload(null)
      setDetailError(null)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    setDetailError(null)
    void (async () => {
      try {
        const res = await fetchSciencerelayArticleDetail(detailId, { lang: LANG, edition: detailEdition })
        if (cancelled) return
        if (!res?.ok || !res.item) throw new Error('详情数据异常')
        setDetailPayload(res.item)
      } catch (e) {
        if (!cancelled) {
          setDetailPayload(null)
          setDetailError(e instanceof Error ? e.message : String(e))
        }
      } finally {
        if (!cancelled) setDetailLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [detailId, detailEdition, detailRetryNonce])

  const openDetail = useCallback((id: string) => {
    setDetailId(id)
    setDetailEdition('middle')
    setDetailRetryNonce(0)
  }, [])

  const closeDetail = useCallback(() => {
    setDetailId(null)
    setDetailPayload(null)
    setDetailError(null)
  }, [])

  const meta = detailPayload?.meta as SciencerelayListItem | undefined
  const commentary = detailPayload?.commentary
  const mdRaw = markdownForEdition(commentary, detailEdition)
  const mdHtml = useMemo(() => {
    if (!mdRaw) return ''
    try {
      return stripCommentaryBodyImages(markdownToHtml(mdRaw))
    } catch {
      return ''
    }
  }, [mdRaw])

  const heroUrl = meta ? pickCoverUrl(meta) : null
  const heroCaption = meta ? pickCoverCaption(meta) : ''
  const topicLabel = meta ? pickTopicLabel(meta) : ''

  if (detailId) {
    return (
      <Shell data-testid="daily-feed-workbench-detail">
        <DetailBackRow>
          <BackBtn type="button" onClick={closeDetail}>
            <ChevronLeft size={16} /> 返回列表
          </BackBtn>
        </DetailBackRow>
        <EditionRow>
          {EDITIONS.map((ed) => (
            <EditionChip
              key={ed}
              type="button"
              $active={detailEdition === ed}
              onClick={() => setDetailEdition(ed)}
            >
              {editionLabel(ed)}
            </EditionChip>
          ))}
        </EditionRow>
        <DetailScroll>
          {detailLoading ? (
            <DetailLoading>加载中…</DetailLoading>
          ) : null}
          {detailError ? (
            <ErrorBanner style={{ marginTop: 12 }}>
              {detailError}
              <RetryBtn type="button" onClick={() => setDetailRetryNonce((n) => n + 1)}>重试</RetryBtn>
            </ErrorBanner>
          ) : null}
          {!detailLoading && !detailError && detailPayload ? (
            <DetailBlock>
              <DetailMediaFigure>
                <DetailHero>
                  {heroUrl ? (
                    <DetailHeroImg
                      src={heroUrl}
                      alt={heroCaption || detailTitle(meta, detailId || '')}
                      title={heroCaption || undefined}
                      loading="eager"
                      decoding="async"
                    />
                  ) : (
                    <DetailHeroPlaceholder $gradient={topicGradient(topicLabel)} />
                  )}
                </DetailHero>
                {heroCaption ? (
                  <DetailFigureCaption>{heroCaption}</DetailFigureCaption>
                ) : null}
              </DetailMediaFigure>
              <Meta>
                {String(meta?.publishedDate || '').trim()}
                {topicLabel ? ` · ${topicLabel}` : ''}
              </Meta>
              <DetailTitle>{detailTitle(meta, detailId || '')}</DetailTitle>
              {detailSummary(commentary) ? (
                <DetailSummary>{detailSummary(commentary)}</DetailSummary>
              ) : null}
              {subjectsZhLine(meta) ? (
                <SubjectsLine>{subjectsZhLine(meta)}</SubjectsLine>
              ) : null}
              {detailPayload?.source?.url ? (
                <SourceLink href={String(detailPayload.source.url)} target="_blank" rel="noreferrer">
                  查看原论文页面
                </SourceLink>
              ) : null}
              {mdHtml ? (
                <MarkdownBody dangerouslySetInnerHTML={{ __html: mdHtml }} />
              ) : (
                <DetailSummary style={{ color: '#8a9bae' }}>该学段暂无正文，可切换上方学段或稍后重试。</DetailSummary>
              )}
            </DetailBlock>
          ) : null}
        </DetailScroll>
      </Shell>
    )
  }

  return (
    <Shell data-testid="daily-feed-workbench-list">
      <ListPageBody>
        {topics.length > 0 ? (
          <TopicChips>
            <Chip type="button" $active={topicKey === ''} onClick={() => onTopicSelect('')}>
              全部
            </Chip>
            {topics.map((t) => (
              <Chip
                key={t.key}
                type="button"
                $active={topicKey === t.key}
                onClick={() => onTopicSelect(t.key)}
              >
                {t.label}
                {typeof t.count === 'number' ? ` (${t.count})` : ''}
              </Chip>
            ))}
          </TopicChips>
        ) : null}
        <Scroll>
          {listError ? (
            <ErrorBanner>
              无法加载资讯列表：{listError}
              <RetryBtn type="button" onClick={() => retryList()}>重试</RetryBtn>
            </ErrorBanner>
          ) : null}
          {listLoading && items.length === 0 ? (
            <DetailLoading>加载中…</DetailLoading>
          ) : null}
          {items.map((item) => {
            const title = pickListTitle(item)
            const summary = pickListSummary(item)
            const topic = pickTopicLabel(item)
            const cover = pickCoverUrl(item)
            const coverCap = pickCoverCaption(item)
            return (
              <ListCard key={item.id} type="button" onClick={() => openDetail(item.id)}>
                <CoverSlot>
                  {cover ? (
                    <CoverImg src={cover} alt={coverCap || title} title={coverCap || undefined} loading="lazy" decoding="async" />
                  ) : (
                    <CoverGradient $gradient={topicGradient(topic)} />
                  )}
                  <CoverTag title={topic}>{topic}</CoverTag>
                </CoverSlot>
                <CardBody>
                  <Meta>
                    {String(item.publishedDate || '').trim()}
                    {item.journal ? ` · ${item.journal}` : ''}
                  </Meta>
                  <Headline>{title}</Headline>
                  {summary ? <Deck>{summary}</Deck> : null}
                </CardBody>
              </ListCard>
            )
          })}
          {items.length > 0 && hasMore ? (
            <LoadMoreWrap>
              <LoadMoreBtn type="button" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? '加载中…' : '加载更多'}
              </LoadMoreBtn>
            </LoadMoreWrap>
          ) : null}
        </Scroll>
      </ListPageBody>
    </Shell>
  )
}
