import React, { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { RefreshCw, Settings, X, Wifi, WifiOff } from 'lucide-react'

interface WebviewWorkbenchProps {
  urlStorageKey: string
  defaultUrl: string
  connectingText?: string
  errorTitle?: string
  errorDesc?: (url: string) => string
  urlPlaceholder?: string
  /** Show the URL bar and address-edit button. Default: false */
  showUrlBar?: boolean
}

const Shell = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: #f4f7fa;
`

const TopBar = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid #dde4ec;
  background: #ffffff;
  flex-shrink: 0;
  min-height: 40px;
`

const UrlDisplay = styled.div`
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-xs);
  color: #627385;
  background: #f5f8fb;
  border: 1px solid #dde4ec;
  border-radius: 6px;
  padding: 4px 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

const UrlInput = styled.input`
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-xs);
  color: #243447;
  background: #ffffff;
  border: 1px solid #4a90d9;
  border-radius: 6px;
  padding: 4px 10px;
  outline: none;
`

const IconButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid #dde4ec;
  border-radius: 6px;
  background: #ffffff;
  color: #5a7080;
  cursor: pointer;
  flex-shrink: 0;
  &:hover { background: #eef3f9; color: #1f3447; }
`

const StatusBadge = styled.span<{ $connected: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-size-xs);
  font-weight: 700;
  color: ${({ $connected }) => ($connected ? '#157347' : '#a0522d')};
  background: ${({ $connected }) => ($connected ? '#e7f6ec' : '#fff3e0')};
  border: 1px solid ${({ $connected }) => ($connected ? '#b8e4c9' : '#f5d5ab')};
  border-radius: 999px;
  padding: 2px 8px;
  flex-shrink: 0;
`

const WebviewContainer = styled.div`
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
`

const webviewStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  border: 'none',
  display: 'flex',
}

const LoadingOverlay = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #f4f7fa;
  gap: 12px;
`

const LoadingText = styled.p`
  font-size: var(--font-size-sm);
  color: #627385;
  margin: 0;
`

const ErrorOverlay = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #f4f7fa;
  gap: 16px;
  padding: 32px;
`

const ErrorTitle = styled.h3`
  margin: 0;
  font-size: 16px;
  color: #1f3142;
`

const ErrorDesc = styled.p`
  margin: 0;
  font-size: var(--font-size-sm);
  color: #627385;
  text-align: center;
  max-width: 400px;
  line-height: 1.7;
`

const RetryButton = styled.button`
  padding: 8px 20px;
  border: 1px solid #4a90d9;
  border-radius: 8px;
  background: #4a90d9;
  color: #ffffff;
  font-size: var(--font-size-sm);
  cursor: pointer;
  &:hover { background: #3a7fc8; }
`

export default function WebviewWorkbench({
  urlStorageKey,
  defaultUrl,
  connectingText = '正在连接…',
  errorTitle = '无法连接',
  errorDesc,
  urlPlaceholder,
  showUrlBar = false,
}: WebviewWorkbenchProps) {
  const [url, setUrl] = useState<string>(() => {
    return localStorage.getItem(urlStorageKey) || defaultUrl
  })
  const [editingUrl, setEditingUrl] = useState(false)
  const [inputUrl, setInputUrl] = useState(url)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [connected, setConnected] = useState(false)
  const webviewRef = useRef<HTMLElement & {
    reload: () => void
    loadURL: (url: string) => void
    src: string
  }>(null)

  const handleLoad = () => {
    setLoading(false)
    setError(false)
    setConnected(true)
  }

  const handleLoadFail = () => {
    setLoading(false)
    setError(true)
    setConnected(false)
  }

  const handleReload = () => {
    setLoading(true)
    setError(false)
    if (webviewRef.current) {
      webviewRef.current.reload()
    }
  }

  const handleOpenSettings = () => {
    setInputUrl(url)
    setEditingUrl(true)
  }

  const handleConfirmUrl = () => {
    const trimmed = inputUrl.trim()
    if (trimmed) {
      setUrl(trimmed)
      localStorage.setItem(urlStorageKey, trimmed)
      setLoading(true)
      setError(false)
      setConnected(false)
    }
    setEditingUrl(false)
  }

  const handleCancelEdit = () => {
    setEditingUrl(false)
    setInputUrl(url)
  }

  useEffect(() => {
    const el = webviewRef.current
    if (!el) return
    el.addEventListener('did-finish-load', handleLoad)
    el.addEventListener('did-fail-load', handleLoadFail)
    return () => {
      el.removeEventListener('did-finish-load', handleLoad)
      el.removeEventListener('did-fail-load', handleLoadFail)
    }
  })

  const descText = errorDesc
    ? errorDesc(url)
    : `无法访问 ${url}。\n请确认网络连通正常。`

  return (
    <Shell>
      <TopBar>
        <StatusBadge $connected={connected}>
          {connected ? <Wifi size={10} /> : <WifiOff size={10} />}
          {connected ? '已连接' : (loading ? '连接中...' : '未连接')}
        </StatusBadge>

        {editingUrl ? (
          <>
            <UrlInput
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirmUrl()
                if (e.key === 'Escape') handleCancelEdit()
              }}
              autoFocus
              placeholder={urlPlaceholder || `输入地址，例如 ${defaultUrl}`}
            />
            <IconButton type="button" onClick={handleConfirmUrl} title="确认">✓</IconButton>
            <IconButton type="button" onClick={handleCancelEdit} title="取消"><X size={13} /></IconButton>
          </>
        ) : (
          <>
            {showUrlBar && <UrlDisplay title={url}>{url}</UrlDisplay>}
            <IconButton type="button" onClick={handleReload} title="刷新">
              <RefreshCw size={13} />
            </IconButton>
            {showUrlBar && (
              <IconButton type="button" onClick={handleOpenSettings} title="修改地址">
                <Settings size={13} />
              </IconButton>
            )}
          </>
        )}
      </TopBar>

      <WebviewContainer>
        <webview
          ref={webviewRef as React.RefObject<HTMLElement>}
          src={url}
          allowpopups={true}
          style={webviewStyle}
        />

        {loading && !error && (
          <LoadingOverlay>
            <RefreshCw size={24} color="#4a90d9" style={{ animation: 'spin 1s linear infinite' }} />
            <LoadingText>{connectingText}</LoadingText>
            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
          </LoadingOverlay>
        )}

        {error && (
          <ErrorOverlay>
            <WifiOff size={40} color="#c0a070" />
            <ErrorTitle>{errorTitle}</ErrorTitle>
            <ErrorDesc>
              {descText.split('\n').map((line, i) => (
                <React.Fragment key={i}>{line}{i < descText.split('\n').length - 1 && <br />}</React.Fragment>
              ))}
            </ErrorDesc>
            <RetryButton onClick={handleReload}>重新连接</RetryButton>
          </ErrorOverlay>
        )}
      </WebviewContainer>
    </Shell>
  )
}
