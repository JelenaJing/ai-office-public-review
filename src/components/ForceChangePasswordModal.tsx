/**
 * ForceChangePasswordModal
 *
 * 首次登录时（mustChangePassword = true）显示的强制改密模态框。
 * 未完成改密前不允许进入主界面。
 */

import React, { useState, useCallback, useRef, useEffect } from 'react'
import styled, { keyframes } from 'styled-components'
import { useInternalAccount } from '../contexts/InternalAccountContext'

/* ================================================================== */
/*  Styled                                                             */
/* ================================================================== */

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: linear-gradient(135deg, #eef2f8 0%, #f5f8fc 60%, #e8eef7 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif;
`

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
`

const Card = styled.div`
  background: #ffffff;
  border: 1px solid #dde3ec;
  border-radius: 18px;
  box-shadow: 0 6px 32px rgba(30, 50, 90, 0.10);
  padding: 40px 44px 36px;
  width: 420px;
  max-width: calc(100vw - 40px);
  animation: ${fadeIn} 0.25s ease;
`

const Icon = styled.div`
  text-align: center;
  font-size: 36px;
  margin-bottom: 8px;
`

const Title = styled.h2`
  text-align: center;
  font-size: 20px;
  font-weight: 800;
  color: #1a3150;
  margin: 0 0 6px;
`

const Subtitle = styled.p`
  text-align: center;
  font-size: 13px;
  color: #627385;
  margin: 0 0 24px;
  line-height: 1.6;
`

const Field = styled.div`
  margin-bottom: 14px;
`

const Label = styled.label`
  display: block;
  font-size: 12px;
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
  &:disabled { background: #f7f9fc; color: #9eafbf; }
`

const HintBox = styled.div<{ $error?: boolean; $ok?: boolean }>`
  margin-top: 12px;
  padding: 11px 13px;
  border-radius: 10px;
  border: 1px solid ${p => p.$error ? '#f1c5c5' : p.$ok ? '#b7e4c7' : '#f5d28a'};
  background: ${p => p.$error ? '#fff6f6' : p.$ok ? '#f0fff4' : '#fffbf0'};
  color: ${p => p.$error ? '#b33838' : p.$ok ? '#276749' : '#7a5a10'};
  font-size: 12px;
  line-height: 1.6;
`

const SubmitBtn = styled.button`
  width: 100%;
  margin-top: 20px;
  padding: 12px 14px;
  border: none;
  border-radius: 10px;
  background: linear-gradient(135deg, #1a6fd4, #1558b8);
  color: #ffffff;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: opacity 0.15s;
  &:hover:not(:disabled) { opacity: 0.92; }
  &:disabled { opacity: 0.55; cursor: not-allowed; }
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
  @keyframes spin { to { transform: rotate(360deg); } }
`

/* ================================================================== */
/*  Component                                                          */
/* ================================================================== */

export default function ForceChangePasswordModal() {
  const { state, changePassword, completeForcePasswordChange } = useInternalAccount()
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const firstInputRef = useRef<HTMLInputElement>(null)

  const username = state.phase === 'must_change_password' ? state.session.user.username : ''

  useEffect(() => {
    const t = setTimeout(() => firstInputRef.current?.focus(), 80)
    return () => clearTimeout(t)
  }, [])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!oldPw) { setError('请输入当前密码（初始密码：12345678）'); return }
    if (newPw.length < 8) { setError('新密码至少 8 位'); return }
    if (newPw === oldPw) { setError('新密码不能与当前密码相同'); return }
    if (newPw !== confirmPw) { setError('两次输入的新密码不一致'); return }

    setLoading(true)
    try {
      await changePassword(oldPw, newPw)
      setSuccess(true)
      // Enter main interface after short delay
      setTimeout(() => completeForcePasswordChange(), 1200)
    } catch (err) {
      setError(err instanceof Error ? err.message : '修改密码失败，请重试')
    } finally {
      setLoading(false)
    }
  }, [oldPw, newPw, confirmPw, changePassword, completeForcePasswordChange])

  return (
    <Overlay>
      <Card>
        <Icon>🔒</Icon>
        <Title>首次登录，请修改密码</Title>
        <Subtitle>
          账号 <strong>{username}</strong> 初始密码为 <code>12345678</code>，<br />
          请立即设置新密码后进入 AI Office。
        </Subtitle>

        {success ? (
          <HintBox $ok>✅ 密码修改成功，正在进入系统…</HintBox>
        ) : (
          <form onSubmit={handleSubmit} autoComplete="off">
            <Field>
              <Label>当前密码（初始 12345678）</Label>
              <Input
                ref={firstInputRef}
                type="password"
                value={oldPw}
                onChange={e => setOldPw(e.target.value)}
                placeholder="当前密码"
                disabled={loading}
                $error={!!error && !oldPw}
                autoComplete="current-password"
              />
            </Field>
            <Field>
              <Label>新密码（至少 8 位）</Label>
              <Input
                type="password"
                value={newPw}
                onChange={e => setNewPw(e.target.value)}
                placeholder="新密码"
                disabled={loading}
                $error={!!error && newPw.length > 0 && newPw.length < 8}
                autoComplete="new-password"
              />
            </Field>
            <Field>
              <Label>确认新密码</Label>
              <Input
                type="password"
                value={confirmPw}
                onChange={e => setConfirmPw(e.target.value)}
                placeholder="再次输入新密码"
                disabled={loading}
                $error={!!error && !!confirmPw && newPw !== confirmPw}
                autoComplete="new-password"
              />
            </Field>

            {error && <HintBox $error>{error}</HintBox>}
            {!error && (
              <HintBox>⚠️ 修改完成前无法进入 AI Office 主界面</HintBox>
            )}

            <SubmitBtn type="submit" disabled={loading || !oldPw || !newPw || !confirmPw}>
              {loading ? <><Spinner />提交中…</> : '修改密码并进入'}
            </SubmitBtn>
          </form>
        )}
      </Card>
    </Overlay>
  )
}
