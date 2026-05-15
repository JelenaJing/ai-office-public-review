/**
 * LoginGate — 全屏登录页
 *
 * 应用启动时，如果未登录或 session 过期则显示此页。
 * 登录成功后由 App.tsx 根据 state.phase 自动切换到主工作区。
 * 浅色办公风格，居中卡片，与 AI Office 主界面一致。
 */

import React, { useState, useCallback, useEffect, useRef } from 'react'
import styled, { keyframes } from 'styled-components'
import { useInternalAccount } from '../contexts/InternalAccountContext'

/* ================================================================== */
/*  Styled components                                                  */
/* ================================================================== */

const Screen = styled.div`
  position: fixed;
  inset: 0;
  background: linear-gradient(135deg, #eef2f8 0%, #f5f8fc 60%, #e8eef7 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', sans-serif;
  overflow: hidden;
`

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
`

const Card = styled.div`
  background: #ffffff;
  border: 1px solid #dde3ec;
  border-radius: 18px;
  box-shadow: 0 6px 32px rgba(30, 50, 90, 0.10), 0 1px 4px rgba(30, 50, 90, 0.06);
  padding: 44px 44px 36px;
  width: 400px;
  max-width: calc(100vw - 40px);
  animation: ${fadeIn} 0.25s ease;
`

const Brand = styled.div`
  text-align: center;
  margin-bottom: 28px;
`

const BrandTitle = styled.div`
  font-size: 26px;
  font-weight: 800;
  color: #1a3150;
  letter-spacing: -0.5px;
  margin-bottom: 6px;
`

const BrandSubtitle = styled.div`
  font-size: var(--font-size-sm);
  color: #627385;
`

const Field = styled.div`
  margin-top: 14px;
`

const Label = styled.label`
  display: block;
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: #4a5f73;
  margin-bottom: 6px;
`

const Input = styled.input<{ $error?: boolean }>`
  width: 100%;
  padding: 11px 13px;
  border: 1.5px solid ${p => p.$error ? '#e07070' : '#d6e0ea'};
  border-radius: 10px;
  font-size: 14px;
  outline: none;
  color: #1f3142;
  background: #ffffff;
  box-sizing: border-box;
  transition: border-color 0.15s;

  &:focus {
    border-color: ${p => p.$error ? '#e07070' : '#4a90d9'};
    box-shadow: 0 0 0 3px ${p => p.$error ? 'rgba(224,112,112,0.12)' : 'rgba(74,144,217,0.12)'};
  }

  &:disabled {
    background: #f7f9fc;
    color: #9eafbf;
  }
`

const LoginBtn = styled.button`
  width: 100%;
  margin-top: 22px;
  padding: 12px 14px;
  border: none;
  border-radius: 10px;
  background: linear-gradient(135deg, #1a6fd4, #1558b8);
  color: #ffffff;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  letter-spacing: 0.3px;
  transition: opacity 0.15s, transform 0.1s;

  &:hover:not(:disabled) {
    opacity: 0.92;
  }

  &:active:not(:disabled) {
    transform: scale(0.99);
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`

const ErrorBox = styled.div<{ $warn?: boolean }>`
  margin-top: 14px;
  padding: 11px 13px;
  border-radius: 10px;
  border: 1px solid ${p => p.$warn ? '#f5c94a' : '#f1c5c5'};
  background: ${p => p.$warn ? '#fffdf0' : '#fff6f6'};
  color: ${p => p.$warn ? '#7a5a10' : '#b33838'};
  font-size: var(--font-size-xs);
  line-height: 1.6;
`

const Footer = styled.div`
  margin-top: 20px;
  text-align: center;
  font-size: var(--font-size-xs);
  color: #9eafbf;
`

const Spinner = styled.span`
  display: inline-block;
  width: 14px;
  height: 14px;
  margin-right: 8px;
  border: 2px solid rgba(255,255,255,0.5);
  border-top-color: #fff;
  border-radius: 50%;
  vertical-align: middle;
  animation: spin 0.7s linear infinite;

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
`

/* ================================================================== */
/*  Component                                                          */
/* ================================================================== */

export default function LoginGate() {
  const { state, login } = useInternalAccount()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const usernameRef = useRef<HTMLInputElement>(null)

  const submitting = state.phase === 'loading'
  const errorMsg = state.phase === 'error' ? state.message : null
  const isExpiredMsg = !!errorMsg?.includes('登录已过期')

  // Auto-focus username field when shown
  useEffect(() => {
    const t = setTimeout(() => usernameRef.current?.focus(), 100)
    return () => clearTimeout(t)
  }, [])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!username.trim() || !password || submitting) return
      const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      console.log(`[LoginGate] submit requestId=${requestId} user=${username.trim()}`)
      await login(username.trim(), password)
    },
    [login, username, password, submitting],
  )

  return (
    <Screen>
      <Card>
        <Brand>
          <BrandTitle>AI Office</BrandTitle>
          <BrandSubtitle>登录内部账号后继续使用</BrandSubtitle>
        </Brand>

        {isExpiredMsg && (
          <ErrorBox $warn style={{ marginTop: 0, marginBottom: 4 }}>
            ⏱ {errorMsg}
          </ErrorBox>
        )}

        <form onSubmit={handleSubmit} autoComplete="on">
          <Field>
            <Label htmlFor="lg-username">AI Office 邮箱</Label>
            <Input
              id="lg-username"
              ref={usernameRef}
              type="text"
              autoComplete="username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="请输入 AI Office 邮箱（aiEmail）"
              disabled={submitting}
              $error={!!errorMsg && !isExpiredMsg}
            />
          </Field>
          <Field>
            <Label htmlFor="lg-password">密码</Label>
            <Input
              id="lg-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="输入密码"
              disabled={submitting}
              $error={!!errorMsg && !isExpiredMsg}
            />
          </Field>

          {errorMsg && !isExpiredMsg && (
            <ErrorBox>{errorMsg}</ErrorBox>
          )}

          <LoginBtn type="submit" disabled={submitting || !username.trim() || !password}>
            {submitting ? (
              <><Spinner />验证中...</>
            ) : '登录'}
          </LoginBtn>
        </form>

        <Footer>AI Office 3.0 · AccountCenter 内部账号</Footer>
      </Card>
    </Screen>
  )
}
