import React from 'react'

type State = {
  error: Error | null
}

class AppErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Renderer crashed:', error, info)
  }

  render() {
    if (!this.state.error) {
      return this.props.children
    }
    const error = this.state.error
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px',
        background: '#1e1e1e',
        boxSizing: 'border-box',
      }}>
        <div style={{
          width: 'min(760px, 100%)',
          border: '1px solid #4a2f2f',
          borderRadius: '14px',
          background: '#241a1a',
          color: '#f5d7d7',
          padding: '24px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
        }}>
          <h1 style={{ margin: '0 0 10px', fontSize: '22px' }}>应用界面加载失败</h1>
          <p style={{ margin: '0 0 12px', fontSize: '13px', lineHeight: 1.7, color: '#e9c1c1' }}>
            这不是正常状态。请把下面的错误信息发回来，可以继续精确修复。
          </p>
          <pre style={{
            margin: 0,
            padding: '14px',
            borderRadius: '10px',
            background: '#161012',
            color: '#ffd8d8',
            fontSize: '12px',
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: '360px',
            overflow: 'auto',
          }}>{error.stack || error.message}</pre>
        </div>
      </div>
    )
  }
}

export default AppErrorBoundary