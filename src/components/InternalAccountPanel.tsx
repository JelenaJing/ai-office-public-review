/**
 * InternalAccountPanel
 *
 * 轻量内部账号状态区，嵌入到 FullSettingsPanel 中。
 * 包含：登录/登出、用户信息、服务绑定状态、内部邮箱配置提示、内部通讯入口。
 */

import React, { useState, useCallback } from 'react'
import styled from 'styled-components'
import { useInternalAccount } from '../contexts/InternalAccountContext'
import type { ServiceBinding } from '../types/internalAccount'
import type { EmailAccountConfig } from '../types/email'
import {
  INTERNAL_MAIL_WEB_URL,
  INTERNAL_MAIL_HOST,
  INTERNAL_IMAP_PORT,
  INTERNAL_SMTP_PORT,
} from '../accountCenterConfig'

/* ================================================================== */
/*  Styled primitives (matching FullSettingsPanel aesthetics)          */
/* ================================================================== */

const Section = styled.section`
  border: 1px solid #dde3ec;
  border-radius: 12px;
  background: #ffffff;
  overflow: hidden;
`

const SectionHeader = styled.div`
  padding: 12px 14px;
  border-bottom: 1px solid #e7edf4;
  background: #f8fbff;
`

const SectionTitle = styled.div`
  font-size: var(--font-size-sm);
  font-weight: 700;
  color: #1f3142;
`

const SectionBody = styled.div`
  padding: 14px;
`

const Field = styled.div`
  margin-top: 10px;
`

const Label = styled.label`
  font-size: var(--font-size-xs);
  color: #627385;
  display: block;
  margin-bottom: 6px;
`

const Input = styled.input`
  width: 100%;
  padding: 9px 10px;
  border: 1px solid #d6e0ea;
  border-radius: 8px;
  font-size: var(--font-size-sm);
  outline: none;
  color: #304255;
  background: #ffffff;
  box-sizing: border-box;
`

const Btn = styled.button<{ $primary?: boolean; $danger?: boolean }>`
  width: 100%;
  margin-top: 10px;
  padding: 10px 14px;
  border: ${p => (p.$primary || p.$danger ? 'none' : '1px solid #d6e0ea')};
  border-radius: 8px;
  background: ${p => p.$danger ? '#c64b4b' : p.$primary ? '#0e639c' : '#ffffff'};
  color: ${p => (p.$primary || p.$danger) ? '#fff' : '#304255'};
  font-size: var(--font-size-sm);
  font-weight: 600;
  cursor: pointer;
  &:disabled { opacity: 0.6; cursor: not-allowed; }
`

const SmallBtn = styled.button<{ $primary?: boolean }>`
  padding: 7px 14px;
  border: ${p => (p.$primary ? 'none' : '1px solid #d6e0ea')};
  border-radius: 8px;
  background: ${p => (p.$primary ? '#0e639c' : '#ffffff')};
  color: ${p => (p.$primary ? '#fff' : '#304255')};
  font-size: var(--font-size-xs);
  font-weight: 600;
  cursor: pointer;
  &:disabled { opacity: 0.6; cursor: not-allowed; }
`

const StatusBox = styled.div<{ $error?: boolean; $warn?: boolean; $ok?: boolean }>`
  padding: 10px 12px;
  border-radius: 8px;
  margin-top: 10px;
  border: 1px solid ${p => p.$error ? '#f1c5c5' : p.$warn ? '#f5ddb0' : p.$ok ? '#b3dfc3' : '#cfe0ef'};
  background: ${p => p.$error ? '#fff6f6' : p.$warn ? '#fffbf2' : p.$ok ? '#f2fbf5' : '#f5fbff'};
  color: ${p => p.$error ? '#b33838' : p.$warn ? '#7a5a10' : p.$ok ? '#1a6336' : '#2a5f8f'};
  font-size: var(--font-size-xs);
  line-height: 1.6;
`

const InfoRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 0;
  border-bottom: 1px solid #f0f4f8;
  font-size: var(--font-size-xs);
  color: #304255;
  &:last-child { border-bottom: none; }
`

const InfoLabel = styled.span`
  color: #627385;
  flex-shrink: 0;
`

const InfoValue = styled.span`
  color: #1f3142;
  font-weight: 600;
  word-break: break-all;
  text-align: right;
`

const BindingBadge = styled.span<{ $ok?: boolean; $warn?: boolean }>`
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: var(--font-size-xs);
  font-weight: 700;
  background: ${p => p.$ok ? '#e7f6ec' : p.$warn ? '#fff4e0' : '#f4f4f4'};
  color: ${p => p.$ok ? '#125f36' : p.$warn ? '#7a5a10' : '#627385'};
`

const Row = styled.div`
  display: flex;
  gap: 8px;
  margin-top: 10px;
  align-items: center;
`

/* ================================================================== */
/*  Helpers                                                           */
/* ================================================================== */

function bindingLabel(binding?: ServiceBinding): React.ReactNode {
  if (!binding) {
    return <BindingBadge>未创建</BindingBadge>
  }
  const isOk = binding.status === 'active'
  const syncStr = binding.syncStatus ?? '—'
  const isSynced = binding.syncStatus === 'synced'
  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      <BindingBadge $ok={isOk} $warn={!isOk}>{binding.status}</BindingBadge>
      <BindingBadge $ok={isSynced} $warn={!isSynced && !!binding.syncStatus}>{syncStr}</BindingBadge>
    </span>
  )
}

/* ================================================================== */
/*  Sub-panels                                                        */
/* ================================================================== */

/** 登录表单 */
function LoginForm() {
  const { state, login } = useInternalAccount()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const loading = state.phase === 'loading'

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      await login(username.trim(), password)
    },
    [login, username, password],
  )

  return (
    <form onSubmit={handleSubmit}>
      {state.phase === 'error' && (
        <StatusBox $error>{state.message}</StatusBox>
      )}
      <Field>
        <Label>用户名</Label>
        <Input
          type="text"
          autoComplete="username"
          value={username}
          onChange={e => setUsername(e.target.value)}
          placeholder="输入内部账号用户名"
          disabled={loading}
        />
      </Field>
      <Field>
        <Label>密码</Label>
        <Input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="输入密码"
          disabled={loading}
        />
      </Field>
      <div style={{ fontSize: 14, color: '#8a9db5', marginTop: 8 }}>
        登录后将自动配置内部邮箱和内部通讯。
      </div>
      <Btn $primary type="submit" disabled={loading || !username || !password}>
        {loading ? '登录中...' : '登录内部账号'}
      </Btn>
    </form>
  )
}

/** 用户信息 + 服务绑定 */
function AccountInfo() {
  const { state, logout, loadBindings } = useInternalAccount()
  const [refreshing, setRefreshing] = useState(false)

  if (state.phase !== 'logged_in') return null
  const { user, bindings, bindingsPhase, bindingsError } = state.session

  const handleRefreshBindings = async () => {
    setRefreshing(true)
    try {
      await loadBindings()
    } catch {
      // error is stored in session.bindingsError — UI reads from there
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <>
      {user.mustChangePassword && (
        <StatusBox $warn>⚠ 请尽快修改初始密码</StatusBox>
      )}

      {/* 用户信息 */}
      <div style={{ marginTop: 10 }}>
        <InfoRow><InfoLabel>用户名</InfoLabel><InfoValue>{user.username}</InfoValue></InfoRow>
        <InfoRow><InfoLabel>显示名</InfoLabel><InfoValue>{user.displayName}</InfoValue></InfoRow>
        <InfoRow><InfoLabel>邮箱</InfoLabel><InfoValue>{user.email}</InfoValue></InfoRow>
        <InfoRow>
          <InfoLabel>角色</InfoLabel>
          <InfoValue>{(user.roles || []).join(', ') || '-'}</InfoValue>
        </InfoRow>
        <InfoRow>
          <InfoLabel>AccountCenter 状态</InfoLabel>
          <InfoValue>
            <BindingBadge $ok={user.status === 'active'} $warn={user.status !== 'active'}>
              {user.status}
            </BindingBadge>
          </InfoValue>
        </InfoRow>
      </div>

      {/* 服务绑定 */}
      <div style={{ marginTop: 12 }}>
        {bindingsPhase === 'loading' || !bindingsPhase ? (
          <StatusBox>正在读取服务绑定...</StatusBox>
        ) : bindingsPhase === 'error' ? (
          <StatusBox $warn>{bindingsError || '服务绑定状态读取失败'}</StatusBox>
        ) : bindings ? (
          <>
            <InfoRow><InfoLabel>mail</InfoLabel><InfoValue>{bindingLabel(bindings.mail)}</InfoValue></InfoRow>
            <InfoRow><InfoLabel>office</InfoLabel><InfoValue>{bindingLabel(bindings.office)}</InfoValue></InfoRow>
          </>
        ) : (
          <StatusBox $warn>服务绑定状态不可用</StatusBox>
        )}
        <Row>
          <SmallBtn type="button" onClick={handleRefreshBindings} disabled={refreshing || bindingsPhase === 'loading'}>
            {refreshing ? '刷新中...' : '刷新绑定状态'}
          </SmallBtn>
        </Row>
      </div>

      <Btn $danger type="button" onClick={logout} style={{ marginTop: 12 }}>
        退出登录
      </Btn>
    </>
  )
}

/** 内部邮箱配置 — 自动应用状态展示 */
function InternalMailSection() {
  const { state, applyEmailConfig, getSessionPassword } = useInternalAccount()
  const [retrying, setRetrying] = useState(false)
  const [imapResult, setImapResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [smtpResult, setSmtpResult] = useState<{ ok: boolean; message: string } | null>(null)

  if (state.phase !== 'logged_in') return null
  const { user, emailAutoStatus, emailAutoError } = state.session

  const handleRetry = useCallback(async () => {
    setRetrying(true)
    setImapResult(null)
    setSmtpResult(null)
    try {
      await applyEmailConfig()

      const pw = getSessionPassword()
      if (pw) {
        const config: EmailAccountConfig = {
          providerType: 'internal-imap',
          label: '内部邮箱',
          user: user.email,
          email: user.email,
          username: user.email,
          password: pw,
          imapHost: INTERNAL_MAIL_HOST,
          imapPort: INTERNAL_IMAP_PORT,
          imapSecure: true,
          smtpHost: INTERNAL_MAIL_HOST,
          smtpPort: INTERNAL_SMTP_PORT,
          smtpSecure: true,
          smtpStartTls: false,
          allowSelfSignedCerts: true,
        } as unknown as EmailAccountConfig
        const [imap, smtp] = await Promise.all([
          window.electronAPI.emailTestConnection(config),
          window.electronAPI.emailTestSmtp(config),
        ])
        setImapResult(imap)
        setSmtpResult(smtp)
      } else {
        setImapResult({ ok: false, message: '会话密码不可用，请重新登录后测试' })
        setSmtpResult({ ok: false, message: '会话密码不可用，请重新登录后测试' })
      }
    } catch (err) {
      setImapResult({ ok: false, message: err instanceof Error ? err.message : '重新应用失败' })
    } finally {
      setRetrying(false)
    }
  }, [applyEmailConfig, getSessionPassword, user])

  return (
    <Section style={{ marginTop: 14 }}>
      <SectionHeader>
        <SectionTitle>📧 内部邮箱</SectionTitle>
      </SectionHeader>
      <SectionBody>
        <InfoRow><InfoLabel>邮箱地址</InfoLabel><InfoValue>{user.email}</InfoValue></InfoRow>
        <InfoRow><InfoLabel>IMAP</InfoLabel><InfoValue>{INTERNAL_MAIL_HOST}:993 (SSL)</InfoValue></InfoRow>
        <InfoRow><InfoLabel>SMTP</InfoLabel><InfoValue>{INTERNAL_MAIL_HOST}:465 (SSL)</InfoValue></InfoRow>
        <InfoRow>
          <InfoLabel>Webmail</InfoLabel>
          <InfoValue>
            <a href={INTERNAL_MAIL_WEB_URL} target="_blank" rel="noopener noreferrer" style={{ color: '#0e639c' }}>
              打开 SOGo
            </a>
          </InfoValue>
        </InfoRow>

        {imapResult || smtpResult ? (
          <>
            {imapResult && (
              <StatusBox $ok={imapResult.ok} $error={!imapResult.ok} style={{ marginTop: 10 }}>
                IMAP: {imapResult.ok ? '✓ 连接成功' : '✗ ' + imapResult.message}
              </StatusBox>
            )}
            {smtpResult && (
              <StatusBox $ok={smtpResult.ok} $error={!smtpResult.ok} style={{ marginTop: 4 }}>
                SMTP: {smtpResult.ok ? '✓ 连接成功' : '✗ ' + smtpResult.message}
              </StatusBox>
            )}
          </>
        ) : emailAutoStatus === 'applying' ? (
          <StatusBox style={{ marginTop: 10 }}>正在自动配置内部邮箱...</StatusBox>
        ) : emailAutoStatus === 'applied' ? (
          <StatusBox $ok style={{ marginTop: 10 }}>✓ 内部邮箱已自动配置</StatusBox>
        ) : emailAutoStatus === 'error' ? (
          <StatusBox $error style={{ marginTop: 10 }}>
            邮箱自动配置失败：{emailAutoError || '未知错误'}
          </StatusBox>
        ) : null}

        {retrying && (
          <div style={{ fontSize: 14, color: '#8a9db5', marginTop: 8 }}>正在重新应用并测试连接...</div>
        )}
        {emailAutoStatus !== 'applying' && !retrying && (
          <SmallBtn
            type="button"
            onClick={() => void handleRetry()}
            disabled={retrying}
            style={{ marginTop: 8 }}
          >
            {emailAutoStatus === 'applied' || imapResult ? '重新应用并测试连接' : '应用内部邮箱配置'}
          </SmallBtn>
        )}
        <div style={{ fontSize: 14, color: '#8a9db5', marginTop: 6 }}>
          邮箱 SMTP/IMAP 密码使用邮箱初始密码（与 AccountCenter 登录密码独立管理，修改登录密码不影响邮箱连接）。
        </div>
      </SectionBody>
    </Section>
  )
}

/** 内部通讯入口 — AccountCenter Chat（新主线） */
function InternalChatSection() {
  const { state } = useInternalAccount()

  if (state.phase !== 'logged_in') return null

  return (
    <Section style={{ marginTop: 14 }}>
      <SectionHeader>
        <SectionTitle>💬 内部通讯</SectionTitle>
      </SectionHeader>
      <SectionBody>
        <div style={{ fontSize: 14, color: '#627385', lineHeight: 1.6, marginBottom: 10 }}>
          支持单聊与群聊，基于 AccountCenter Chat 服务。
        </div>
        <Btn
          $primary
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('open-chat-window'))}
        >
          打开内部通讯
        </Btn>
      </SectionBody>
    </Section>
  )
}

/* ================================================================== */
/*  Main export                                                       */
/* ================================================================== */

export default function InternalAccountPanel() {
  const { state } = useInternalAccount()
  const isLoggedIn = state.phase === 'logged_in'

  return (
    <>
      <Section>
        <SectionHeader>
          <SectionTitle>🔐 内部账号（AccountCenter）</SectionTitle>
        </SectionHeader>
        <SectionBody>
          {isLoggedIn ? <AccountInfo /> : <LoginForm />}
        </SectionBody>
      </Section>

      {isLoggedIn && (
        <>
          <InternalMailSection />
          <InternalChatSection />
        </>
      )}
    </>
  )
}
