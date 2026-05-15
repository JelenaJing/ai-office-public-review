import type { CSSProperties } from 'react'
import styled from 'styled-components'
import type { DocumentPreviewState } from '../../../hooks/useDocumentPreview'
import { DEFAULT_PAPER_TEMPLATE_ID, getPaperTemplate, type PaperTemplateId } from '../../../utils/paperTemplates'

const StateBox = styled.div<{ $tone?: 'default' | 'error' | 'warning' }>`
  border-radius: 16px;
  border: 1px solid ${({ $tone }) => ($tone === 'error' ? '#efc7c7' : $tone === 'warning' ? '#ead9b8' : '#d6e0ea')};
  background: ${({ $tone }) => ($tone === 'error' ? '#fff2f2' : $tone === 'warning' ? '#fff9ef' : '#f8fbfe')};
  padding: 16px;
  height: 100%;
  min-height: 0;
  display: grid;
  align-content: start;
  gap: 8px;
`

const InlineState = styled.div`
  width: 100%;
  min-width: 0;
  min-height: 0;
  padding: 4px 2px;
  font-size: var(--font-size-sm);
  line-height: 1.75;
  color: #6a7d91;
`

const StateTitle = styled.div`
  font-size: var(--font-size-sm);
  font-weight: 800;
  color: #1f3447;
`

const StateText = styled.div`
  font-size: var(--font-size-sm);
  line-height: 1.75;
  color: #5f7487;
  white-space: pre-wrap;
  word-break: break-word;
`

const HtmlViewport = styled.div`
  border-radius: 16px;
  border: 1px solid #dfe8f1;
  background: linear-gradient(180deg, #f4f7fb 0%, #eef3f8 100%);
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: auto;
  padding: 16px;
`

const HtmlPage = styled.div<{ $templateId: PaperTemplateId }>`
  ${({ $templateId }) => {
    const template = getPaperTemplate($templateId)
    const defaultFontSizePx = parseFloat(template.fontSize) || 15
    return `
      max-width: 900px;
      margin: 0 auto;
      background: #ffffff;
      box-shadow: 0 14px 38px rgba(20, 40, 62, 0.08);
      border-radius: 12px;
      padding: var(--doc-preview-page-padding, ${template.pagePadding});
      position: relative;
      min-height: 100%;
      color: #222;

      .doc-preview-content {
        position: relative;
        z-index: 1;
        font-family: var(--doc-preview-font-family, ${template.fontFamily});
        font-size: var(--doc-preview-font-size, ${template.fontSize});
        line-height: var(--doc-preview-line-height, ${template.lineHeight});
        letter-spacing: 0.02em;
      }

      .doc-preview-content h1 {
        font-size: 28px;
        font-weight: 700;
        margin: 36px 0 20px;
        text-align: center;
        letter-spacing: 0.04em;
      }

      .doc-preview-content h2 {
        font-size: 21px;
        font-weight: 700;
        margin: 24px 0 12px;
        padding-bottom: 6px;
        border-bottom: 1px solid #eee;
        text-align: var(--doc-preview-heading-align, ${template.headingAlign === 'center' ? 'center' : 'left'});
      }

      .doc-preview-content h3 {
        font-size: 17px;
        font-weight: 600;
        margin: 18px 0 8px;
      }

      .doc-preview-content p {
        margin: var(--doc-preview-paragraph-spacing, ${template.paragraphSpacing}) 0;
        text-align: justify;
        text-indent: var(--doc-preview-text-indent, ${template.textIndent});
        line-height: var(--doc-preview-line-height, ${template.lineHeight});
      }

      .doc-preview-content [data-semantic-role="paper-title"] {
        margin-top: ${$templateId === 'academic-en' ? '72px' : '48px'};
        margin-bottom: 12px;
        font-size: 30px;
        line-height: 1.4;
        text-align: center;
      }

      .doc-preview-content [data-semantic-role="abstract-heading"] {
        margin-top: 28px;
        border-bottom: none;
        font-size: 18px;
        font-weight: 700;
        text-align: center;
      }

      .doc-preview-content [data-semantic-role="abstract-body"] {
        text-indent: 0;
        font-size: calc(var(--doc-preview-font-size-px, ${defaultFontSizePx}px) - 1px);
        line-height: 1.75;
        margin-bottom: 4px;
      }

      .doc-preview-content [data-semantic-role="keywords-heading"] {
        border-bottom: none;
        font-size: 16px;
        font-weight: 700;
        text-align: left;
        margin-top: 12px;
        margin-bottom: 8px;
      }

      .doc-preview-content [data-semantic-role="keywords-body"] {
        text-indent: 0;
        font-size: calc(var(--doc-preview-font-size-px, ${defaultFontSizePx}px) - 1px);
        line-height: 1.75;
        margin-bottom: 8px;
      }

      .doc-preview-content [data-semantic-role="section-heading"],
      .doc-preview-content [data-semantic-role="references-heading"] {
        border-bottom: 1px solid #eee;
        font-size: 21px;
      }

      .doc-preview-content [data-semantic-role="reference-item"] {
        text-indent: 0;
        line-height: 1.8;
      }

      .doc-preview-content blockquote {
        border-left: 2px solid #d9dee8;
        padding: 8px 14px;
        margin: 14px 0;
        border-radius: 0 4px 4px 0;
        background: #fafbfe;
        color: #616975;
        font-size: 14px;
        line-height: 1.7;
      }

      .doc-preview-content ul,
      .doc-preview-content ol {
        padding-left: 24px;
      }

      .doc-preview-content li {
        margin: 4px 0;
      }

      .doc-preview-content li > p {
        text-indent: 0;
      }

      .doc-preview-content img {
        max-width: 100%;
        border-radius: 4px;
        margin: 12px 0;
      }

      .doc-preview-content figure {
        margin: 16px 0;
        text-align: center;
      }

      .doc-preview-content figcaption {
        font-size: var(--font-size-xs);
        color: #666;
        margin-top: 6px;
        line-height: 1.6;
      }

      .doc-preview-content table {
        width: 100%;
        border-collapse: collapse;
        margin: 14px 0;
      }

      .doc-preview-content th,
      .doc-preview-content td {
        border: 1px solid #e0e0e0;
        padding: 8px 12px;
        text-align: left;
      }

      .doc-preview-content th {
        background: #f0f2f8;
        font-weight: 600;
        color: #444;
      }

      .doc-preview-content .formula-node {
        cursor: default;
        user-select: none;
      }

      .doc-preview-content .formula-inline {
        display: inline-block;
        padding: 0 3px;
        margin: 0 1px;
        border-radius: 4px;
        background: rgba(14, 99, 156, 0.08);
        vertical-align: middle;
      }

      .doc-preview-content .formula-block {
        display: flex;
        justify-content: center;
        margin: 10px 0;
        padding: 6px 10px;
        border-radius: 6px;
        background: #f8fafd;
        border: 1px solid #e8edf3;
        overflow-x: auto;
      }

      .doc-preview-content .katex {
        font-size: 1.02em;
      }
    `
  }}
`

const PageHeaderPreview = styled.div`
  position: absolute;
  top: 18px;
  left: 40px;
  right: 40px;
  min-height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 16px 8px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.28);
  color: #64748b;
  font-size: var(--font-size-xs);
  line-height: 1.45;
  white-space: pre-wrap;
  text-align: center;
  pointer-events: none;
  z-index: 1;
`

const PageFooterPreview = styled.div`
  position: absolute;
  left: 40px;
  right: 40px;
  bottom: 14px;
  min-height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 16px 0;
  border-top: 1px solid rgba(148, 163, 184, 0.28);
  color: #64748b;
  font-size: var(--font-size-xs);
  line-height: 1.45;
  white-space: pre-wrap;
  text-align: center;
  pointer-events: none;
  z-index: 1;
`

const PageWatermarkPreview = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px;
  color: rgba(148, 163, 184, 0.22);
  font-size: clamp(56px, 9vw, 96px);
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  transform: rotate(-24deg);
  text-align: center;
  white-space: pre-wrap;
  pointer-events: none;
  user-select: none;
  z-index: 0;
`

const PlainTextBox = styled.div`
  border-radius: 16px;
  border: 1px solid #dfe8f1;
  background: #ffffff;
  padding: 16px;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: auto;
  font-size: var(--font-size-sm);
  line-height: 1.9;
  color: #203245;
  white-space: pre-wrap;
`

const MetaHint = styled.div`
  font-size: var(--font-size-xs);
  line-height: 1.7;
  color: #6e8295;
`

type Props = {
  preview: DocumentPreviewState
  idleMessage: string
  loadingMessage?: string
  testId?: string
}

function parseCssBoxShorthand(value: string | undefined, fallback: string): [string, string, string, string] {
  const parts = String(value || fallback).trim().split(/\s+/).filter(Boolean)
  if (parts.length === 1) return [parts[0], parts[0], parts[0], parts[0]]
  if (parts.length === 2) return [parts[0], parts[1], parts[0], parts[1]]
  if (parts.length === 3) return [parts[0], parts[1], parts[2], parts[1]]
  if (parts.length >= 4) return [parts[0], parts[1], parts[2], parts[3]]
  return ['40px', '60px', '80px', '60px']
}

function buildPreviewPagePadding(basePadding: string | undefined, hasHeader: boolean, hasFooter: boolean, fallback: string): string {
  const [top, right, bottom, left] = parseCssBoxShorthand(basePadding, fallback)
  return `${hasHeader ? `calc(${top} + 34px)` : top} ${right} ${hasFooter ? `calc(${bottom} + 30px)` : bottom} ${left}`
}

export default function ReadonlyDocumentPreview({ preview, idleMessage, loadingMessage = '正在读取文稿预览...', testId }: Props) {
  if (preview.kind === 'idle') {
    return (
      <InlineState data-testid={testId}>{idleMessage}</InlineState>
    )
  }

  if (preview.kind === 'loading') {
    return (
      <InlineState data-testid={testId}>{loadingMessage}</InlineState>
    )
  }

  if (preview.kind === 'error') {
    return (
      <StateBox $tone="error" data-testid={testId}>
        <StateTitle>文稿预览读取失败</StateTitle>
        <StateText>{preview.message}</StateText>
        {preview.detail ? <MetaHint>{preview.detail}</MetaHint> : null}
      </StateBox>
    )
  }

  if (preview.kind === 'empty') {
    return (
      <InlineState data-testid={testId}>{preview.message}</InlineState>
    )
  }

  if (preview.contentType === 'plain-text') {
    return (
      <div data-testid={testId}>
        <PlainTextBox>{preview.plainText}</PlainTextBox>
        <MetaHint>当前预览已回退为纯文本模式，因为没有可直接渲染的 HTML 内容。</MetaHint>
      </div>
    )
  }

  const templateId = preview.renderState?.paperTemplateId || DEFAULT_PAPER_TEMPLATE_ID
  const templateDefinition = getPaperTemplate(templateId)
  const shell = preview.renderState?.shell
  const bodyStyle = preview.renderState?.bodyStyle
  const showPageHeader = Boolean(shell?.hasHeader || String(shell?.headerText || '').trim())
  const showPageFooter = Boolean(shell?.hasFooter || String(shell?.footerText || '').trim())
  const showPageWatermark = Boolean(String(shell?.watermarkText || '').trim())
  const pagePadding = buildPreviewPagePadding(bodyStyle?.pagePadding, showPageHeader, showPageFooter, templateDefinition.pagePadding)
  const fontSizePx = parseFloat(bodyStyle?.fontSize || templateDefinition.fontSize) || parseFloat(templateDefinition.fontSize) || 15
  const pageStyle = {
    '--doc-preview-page-padding': pagePadding,
    '--doc-preview-font-family': bodyStyle?.fontFamily || templateDefinition.fontFamily,
    '--doc-preview-font-size': bodyStyle?.fontSize || templateDefinition.fontSize,
    '--doc-preview-font-size-px': `${fontSizePx}px`,
    '--doc-preview-line-height': bodyStyle?.lineHeight || templateDefinition.lineHeight,
    '--doc-preview-text-indent': bodyStyle?.textIndent || templateDefinition.textIndent,
    '--doc-preview-paragraph-spacing': bodyStyle?.paragraphSpacing || templateDefinition.paragraphSpacing,
    '--doc-preview-heading-align': bodyStyle?.headingAlign || (templateDefinition.headingAlign === 'center' ? 'center' : 'left'),
  } as CSSProperties

  return (
    <HtmlViewport data-testid={testId}>
      <HtmlPage $templateId={templateId} style={pageStyle}>
        {showPageWatermark && shell?.watermarkText ? <PageWatermarkPreview>{shell.watermarkText}</PageWatermarkPreview> : null}
        {showPageHeader ? <PageHeaderPreview>{shell?.headerText || ''}</PageHeaderPreview> : null}
        <div className="doc-preview-content" dangerouslySetInnerHTML={{ __html: preview.contentHtml || '<p></p>' }} />
        {showPageFooter ? <PageFooterPreview>{shell?.footerText || ''}</PageFooterPreview> : null}
      </HtmlPage>
    </HtmlViewport>
  )
}