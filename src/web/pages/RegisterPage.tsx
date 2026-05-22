import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { platformApi } from '../../platform'

export default function RegisterPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirm) {
      setError('两次输入的密码不一致')
      return
    }
    if (password.length < 8) {
      setError('密码至少 8 位')
      return
    }
    setLoading(true)
    try {
      await platformApi.auth.register(email, password, name)
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <h1 style={s.logo}>AIOS</h1>
        <p style={s.subtitle}>创建账号</p>

        <form onSubmit={handleSubmit} style={s.form}>
          <input
            type="text"
            placeholder="姓名"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoComplete="name"
            style={s.input}
          />
          <input
            type="email"
            placeholder="邮箱"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            style={s.input}
          />
          <input
            type="password"
            placeholder="密码（至少 8 位）"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
            style={s.input}
          />
          <input
            type="password"
            placeholder="确认密码"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            autoComplete="new-password"
            style={s.input}
          />
          {error && <p style={s.error}>{error}</p>}
          <button type="submit" disabled={loading} style={s.btn}>
            {loading ? '注册中…' : '注册'}
          </button>
        </form>

        <p style={s.footer}>
          已有账号？{' '}
          <Link to="/login" style={s.link}>
            立即登录
          </Link>
        </p>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  },
  card: {
    background: '#fff',
    borderRadius: 16,
    padding: '40px 48px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
    width: 380,
    maxWidth: '90vw',
  },
  logo: {
    margin: 0,
    fontSize: 32,
    fontWeight: 700,
    color: '#1a1a2e',
    textAlign: 'center',
    letterSpacing: 2,
  },
  subtitle: {
    margin: '6px 0 32px',
    color: '#888',
    textAlign: 'center',
    fontSize: 13,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  input: {
    padding: '12px 16px',
    border: '1.5px solid #e0e0e0',
    borderRadius: 8,
    fontSize: 15,
    outline: 'none',
  },
  btn: {
    marginTop: 4,
    padding: '13px 0',
    background: '#667eea',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
  },
  error: {
    margin: 0,
    color: '#e74c3c',
    fontSize: 13,
  },
  footer: {
    marginTop: 20,
    textAlign: 'center',
    fontSize: 14,
    color: '#666',
  },
  link: {
    color: '#667eea',
    textDecoration: 'none',
    fontWeight: 500,
  },
}
