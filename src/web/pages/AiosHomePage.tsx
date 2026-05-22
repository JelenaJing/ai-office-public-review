import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { platformApi } from '../../platform'

const APP_ENTRIES = [
  { id: 'writer', name: '文稿助手', icon: '📝' },
  { id: 'ppt', name: 'PPT 生成', icon: '🖼️' },
  { id: 'email', name: '邮件助手', icon: '📧' },
  { id: 'knowledge', name: '知识库', icon: '📚' },
  { id: 'excel', name: '数据分析', icon: '📊' },
  { id: 'image', name: '图像生成', icon: '🎨' },
]

export default function AiosHomePage() {
  const [query, setQuery] = useState('')
  const navigate = useNavigate()
  const user = platformApi.auth.getCurrentUser()

  async function handleLogout() {
    await platformApi.auth.logout()
    navigate('/login')
  }

  function handleAgentSubmit(e: React.FormEvent) {
    e.preventDefault()
    // Phase 1 placeholder — agent dispatch will be wired in phase 2.
    setQuery('')
  }

  return (
    <div style={s.shell}>
      {/* ── Header ── */}
      <header style={s.header}>
        <span style={s.brand}>AIOS</span>
        <div style={s.userBar}>
          <span style={s.userName}>{user?.name ?? user?.email ?? '用户'}</span>
          <button onClick={handleLogout} style={s.logoutBtn}>
            退出
          </button>
        </div>
      </header>

      {/* ── Main ── */}
      <main style={s.main}>
        {/* Agent input */}
        <section style={s.agentSection}>
          <h2 style={s.greeting}>
            你好，{user?.name ?? '同学'}，今天要做什么？
          </h2>
          <form onSubmit={handleAgentSubmit} style={s.agentForm}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="输入指令，让 AI 帮你完成任务…"
              style={s.agentInput}
            />
            <button type="submit" style={s.agentBtn}>
              发送
            </button>
          </form>
        </section>

        {/* Internal app entries */}
        <section>
          <h3 style={s.sectionTitle}>内部应用</h3>
          <div style={s.appsGrid}>
            {APP_ENTRIES.map((app) => (
              <div key={app.id} style={s.appCard}>
                <span style={s.appIcon}>{app.icon}</span>
                <span style={s.appName}>{app.name}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Recent artifacts placeholder */}
        <section style={{ marginTop: 40 }}>
          <h3 style={s.sectionTitle}>最近产物</h3>
          <div style={s.placeholder}>
            <span style={s.placeholderText}>暂无最近产物（即将上线）</span>
          </div>
        </section>
      </main>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  shell: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
    background: '#f7f8fb',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 32px',
    height: 56,
    background: '#fff',
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
  },
  brand: {
    fontSize: 20,
    fontWeight: 700,
    color: '#667eea',
    letterSpacing: 2,
  },
  userBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  userName: {
    fontSize: 14,
    color: '#444',
  },
  logoutBtn: {
    padding: '6px 14px',
    background: 'transparent',
    border: '1.5px solid #e0e0e0',
    borderRadius: 6,
    fontSize: 13,
    color: '#666',
    cursor: 'pointer',
  },
  main: {
    flex: 1,
    width: '100%',
    maxWidth: 960,
    margin: '0 auto',
    padding: '48px 24px',
  },
  agentSection: {
    marginBottom: 48,
  },
  greeting: {
    margin: '0 0 20px',
    fontSize: 26,
    fontWeight: 600,
    color: '#1a1a2e',
  },
  agentForm: {
    display: 'flex',
    gap: 12,
  },
  agentInput: {
    flex: 1,
    padding: '14px 18px',
    border: '1.5px solid #e0e0e0',
    borderRadius: 10,
    fontSize: 15,
    outline: 'none',
    background: '#fff',
    boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
  },
  agentBtn: {
    padding: '14px 28px',
    background: '#667eea',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  sectionTitle: {
    margin: '0 0 16px',
    fontSize: 15,
    fontWeight: 600,
    color: '#555',
  },
  appsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
    gap: 16,
  },
  appCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    padding: '24px 12px',
    background: '#fff',
    borderRadius: 12,
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
    cursor: 'pointer',
  },
  appIcon: {
    fontSize: 28,
  },
  appName: {
    fontSize: 13,
    color: '#333',
    fontWeight: 500,
    textAlign: 'center',
  },
  placeholder: {
    padding: '32px 0',
    textAlign: 'center',
    background: '#fff',
    borderRadius: 12,
    border: '1.5px dashed #e0e0e0',
  },
  placeholderText: {
    color: '#bbb',
    fontSize: 14,
  },
}
