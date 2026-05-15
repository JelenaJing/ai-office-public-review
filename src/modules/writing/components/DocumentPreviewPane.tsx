import React from 'react'
import styled from 'styled-components'

const PreviewShell = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(circle at top, rgba(230, 238, 248, 0.96), rgba(241, 245, 249, 0.92) 42%, rgba(232, 238, 244, 0.96)),
    linear-gradient(180deg, #eef3f8 0%, #e7edf4 100%);
`

const PreviewHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(150, 166, 184, 0.28);
  background: rgba(255, 255, 255, 0.74);
  backdrop-filter: blur(12px);
`

const PreviewMeta = styled.div`
  min-width: 0;
`

const PreviewTitle = styled.div`
  font-size: 15px;
  font-weight: 700;
  color: #213142;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

const PreviewHint = styled.div`
  margin-top: 4px;
  font-size: var(--font-size-xs);
  color: #5f7082;
`

const PreviewAction = styled.button`
  height: 34px;
  padding: 0 14px;
  border: 1px solid #c5d2df;
  border-radius: 999px;
  background: #ffffff;
  color: #284154;
  font-size: var(--font-size-xs);
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;

  &:hover {
    border-color: #9cb4c9;
    background: #f8fbff;
  }
`

const PreviewViewport = styled.div`
  flex: 1;
  min-height: 0;
  padding: 20px;

  @media (max-width: 768px) {
    padding: 12px;
  }
`

const PreviewFrame = styled.iframe`
  display: block;
  width: 100%;
  height: 100%;
  min-height: 520px;
  border: 1px solid rgba(164, 178, 196, 0.36);
  border-radius: 18px;
  background: #ffffff;
  box-shadow: 0 26px 60px rgba(36, 52, 71, 0.12);
`

interface DocumentPreviewPaneProps {
  fileName: string
  source?: string
  sourceDoc?: string
  hint?: string
  actionLabel?: string
  onOpenExternal?: () => void
}

export default function DocumentPreviewPane({ fileName, source, sourceDoc, hint, actionLabel, onOpenExternal }: DocumentPreviewPaneProps) {
  return (
    <PreviewShell>
      <PreviewHeader>
        <PreviewMeta>
          <PreviewTitle>{fileName}</PreviewTitle>
          <PreviewHint>{hint || '当前文件以只读模式内嵌预览。'}</PreviewHint>
        </PreviewMeta>
        {onOpenExternal ? <PreviewAction onClick={onOpenExternal}>{actionLabel || '用系统程序打开'}</PreviewAction> : null}
      </PreviewHeader>
      <PreviewViewport>
        <PreviewFrame src={source} srcDoc={sourceDoc} title={fileName} />
      </PreviewViewport>
    </PreviewShell>
  )
}