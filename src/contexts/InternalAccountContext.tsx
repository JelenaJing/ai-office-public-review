/**
 * InternalAccountContext
 *
 * 管理 AccountCenter 登录态：
 * - 启动时从主进程安全存储恢复 token 并验证
 * - 验证失败则清理
 * - 提供 login / logout / loadBindings / applyEmailConfig 方法
 *
 * Token 存储位置：主进程文件 internal-account-token.json（userData 目录）
 * TODO(phase6): 迁移到 Electron safeStorage（主进程加密存储）
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import * as client from '../services/accountCenterClient'
import type {
  InternalAccountSession,
  InternalAccountState,
  InternalAccountSessionSource,
  InternalAccountUser,
} from '../types/internalAccount'
import { setAmbientUserId, setAmbientToken, flushPendingActivities } from '../services/workActivityLog'
import {
  INTERNAL_MAIL_HOST,
  INTERNAL_IMAP_PORT,
  INTERNAL_SMTP_PORT,
  INTERNAL_MAIL_WEB_URL,
} from '../accountCenterConfig'
import { isForcePasswordChangeRequired } from '../config'

/* ---- legacy localStorage key — migrate once then clear ---- */
const LEGACY_TOKEN_KEY = 'ai_office_internal_token'
const FORCE_PASSWORD_CHANGE_STORAGE_KEYS = [
  'mustChangePassword',
  'requirePasswordChange',
  'forceChangePassword',
  'firstLogin',
  'pendingPasswordChange',
]

const electronAPI = () =>
  typeof window !== 'undefined'
    ? (window as typeof window & { electronAPI?: typeof window['electronAPI'] }).electronAPI
    : undefined

async function readStoredToken(): Promise<string | null> {
  const api = electronAPI()
  if (api?.internalAccountGetToken) {
    // Migrate legacy localStorage token once: write to main process first, delete only on success
    const legacy = (() => {
      try { return localStorage.getItem(LEGACY_TOKEN_KEY) || null } catch { return null }
    })()
    if (legacy) {
      try {
        await api.internalAccountSetToken(legacy)
        // Only remove after confirmed write — preserves token if write fails
        try { localStorage.removeItem(LEGACY_TOKEN_KEY) } catch { /* ignore */ }
      } catch {
        // Write failed: keep localStorage token so next startup can retry migration
        console.warn('[InternalAccount] token migration to main process failed; will retry on next launch')
      }
    }
    const res = await api.internalAccountGetToken()
    return res?.token ?? null
  }
  // fallback for non-Electron (should not happen in production)
  try { return localStorage.getItem(LEGACY_TOKEN_KEY) || null } catch { return null }
}

async function storeToken(token: string): Promise<void> {
  const api = electronAPI()
  if (api?.internalAccountSetToken) {
    await api.internalAccountSetToken(token)
  } else {
    try { localStorage.setItem(LEGACY_TOKEN_KEY, token) } catch { /* ignore */ }
  }
}

async function readStoredSession(): Promise<InternalAccountSession | null> {
  const api = electronAPI()
  if (!api?.internalAccountGetSession) return null
  const res = await api.internalAccountGetSession()
  return (res?.session ?? null) as InternalAccountSession | null
}

async function storeSession(session: InternalAccountSession): Promise<void> {
  const api = electronAPI()
  if (!api?.internalAccountSetSession) return
  const res = await api.internalAccountSetSession(session)
  if (!res?.ok) throw new Error(res?.error ?? '会话写入失败')
}

async function clearStoredToken(): Promise<void> {
  const api = electronAPI()
  if (api?.internalAccountClearToken) {
    await api.internalAccountClearToken()
  }
  try { localStorage.removeItem(LEGACY_TOKEN_KEY) } catch { /* ignore */ }
}

async function clearStoredSession(): Promise<void> {
  const api = electronAPI()
  if (api?.internalAccountClearSession) {
    await api.internalAccountClearSession()
  }
}

function clearForcePasswordChangeStorage(): void {
  for (const key of FORCE_PASSWORD_CHANGE_STORAGE_KEYS) {
    try {
      localStorage.removeItem(key)
      sessionStorage.removeItem(key)
    } catch (err) {
      console.warn(`[InternalAccount] failed to clear password-change flag "${key}"`, err)
    }
  }
}

/* ---- standalone email-config helper (no React deps, safe to call from callbacks) ---- */

/**
 * Builds and writes the internal email account config to the system.
 * The password comes from the caller (in-memory only, never logged).
 *
 * TODO(phase6+): migrate password storage to Electron safeStorage instead of
 *   writing it to email-account.json.
 */
async function applyEmailConfigToSystem(
  user: InternalAccountUser,
  password: string,
): Promise<void> {
  const config = {
    providerType: 'internal-imap',
    label: '内部邮箱',
    user: user.email,
    email: user.email,
    username: user.email,
    displayName: user.displayName || user.username,
    password, // written to email-account.json — see TODO above
    // Owner metadata for user-isolation validation
    ownerUserId: user.id,
    ownerUsername: user.username,
    imapHost: INTERNAL_MAIL_HOST,
    imapPort: INTERNAL_IMAP_PORT,
    imapSecure: true,
    smtpHost: INTERNAL_MAIL_HOST,
    smtpPort: INTERNAL_SMTP_PORT,
    smtpSecure: true,
    smtpStartTls: false,
    webmailUrl: INTERNAL_MAIL_WEB_URL,
    allowSelfSignedCerts: true,
  }
  const api = electronAPI()
  if (api?.internalAccountApplyEmailConfig) {
    const res = await api.internalAccountApplyEmailConfig(config as import('../types/email').EmailAccountConfig)
    if (!res.ok) throw new Error(res.error ?? '邮箱配置写入失败')
  } else if (api?.emailSaveAccount) {
    await api.emailSaveAccount(config)
  } else {
    throw new Error('无法访问邮件配置接口')
  }
}

/* ---- context shape ---- */

interface InternalAccountContextValue {
  state: InternalAccountState
  /** 执行登录；password 仅在内存中短暂存在，不落盘不打日志 */
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  /** 重新拉取 service_bindings（不影响登录态） */
  loadBindings: () => Promise<void>
  /** 修改密码 */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  /** 强制改密完成后，从 must_change_password 切换到 logged_in */
  completeForcePasswordChange: () => void
  /** 一键应用内部邮箱配置（使用登录时暂存的 password，不持久化明文密码） */
  applyEmailConfig: () => Promise<void>
  /** 返回当前会话内存中暂存的密码；不打日志；重启后为 null */
  getSessionPassword: () => string | null
}

const InternalAccountContext = createContext<InternalAccountContextValue | null>(null)

export function InternalAccountProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<InternalAccountState>({ phase: 'restoring' })

  const buildSession = useCallback((
    source: InternalAccountSessionSource,
    token: string,
    user: InternalAccountUser,
    extra: Partial<InternalAccountSession> = {},
  ): InternalAccountSession => ({
    source,
    token,
    user,
    ...extra,
  }), [])

  // Keep ambient userId + token in sync so deeply-nested components (e.g. EditorPanel)
  // can log and sync work activities without threading auth props.
  useEffect(() => {
    if (state.phase === 'logged_in' || state.phase === 'must_change_password') {
      const userId = state.session.user?.id ?? null
      const token = state.session.token ?? null
      setAmbientUserId(userId)
      setAmbientToken(token)
      // Notify main process of the current user identity for work activity logging
      if (userId) {
        void electronAPI()?.activitySetIdentity?.({ userId, username: state.session.user?.username })
      }
      // Flush any locally-pending activity entries to the server on login/restore
      if (token && state.phase === 'logged_in') {
        void flushPendingActivities(token)
      }
    } else {
      setAmbientUserId(null)
      setAmbientToken(null)
    }
  }, [state])

  /**
   * AccountCenter session password (in-memory only, never logged, never persisted).
   * Used for changePassword API calls. Cleared on logout.
   */
  const passwordRef = useRef<string | null>(null)

  /**
   * Mailcow SMTP/IMAP password — separate from AccountCenter password.
   * Set to the login password on first login. NOT updated when AccountCenter
   * password changes, because mailcow maintains its own separate credential
   * and does NOT sync with AccountCenter password changes.
   * Cleared on logout.
   */
  const mailboxPasswordRef = useRef<string | null>(null)

  /** Guards against concurrent login calls (e.g. rapid double-click). */
  const loginInProgressRef = useRef(false)

  /** Returns the mailcow SMTP/IMAP password (separate from AccountCenter login password). */
  const getSessionPassword = useCallback((): string | null => {
    return mailboxPasswordRef.current
  }, [])

  /* ---- 启动时恢复 token ---- */
  useEffect(() => {
    Promise.all([readStoredSession(), readStoredToken()]).then(([storedSession, storedToken]) => {
      if (storedSession?.source === 'mailbox-fallback') {
        clearForcePasswordChangeStorage()
        setState({ phase: 'logged_in', session: storedSession })
        return
      }

      const token = storedSession?.token || storedToken
      if (!token) {
        setState({ phase: 'idle' })
        return
      }

      client
        .me(token)
        .then((user) => {
          clearForcePasswordChangeStorage()
          const restoredSession = buildSession('account-center', token, user, { bindingsPhase: 'loading' })
          setState({ phase: 'logged_in', session: restoredSession })
          void storeSession(restoredSession).catch(() => {/* ignore */})
          return client.getBindings(token, user.id).then(
            (bindings) => {
              setState((prev) =>
                prev.phase === 'logged_in'
                  ? { phase: 'logged_in', session: { ...prev.session, bindings, bindingsPhase: 'success' } }
                  : prev,
              )
            },
            (err) => {
              const bindingsError = err instanceof Error ? err.message : '服务绑定状态读取失败'
              setState((prev) =>
                prev.phase === 'logged_in'
                  ? { phase: 'logged_in', session: { ...prev.session, bindingsPhase: 'error', bindingsError } }
                  : prev,
              )
            },
          )
        })
        .catch(() => {
          clearStoredToken().catch(() => {/* ignore */})
          clearStoredSession().catch(() => {/* ignore */})
          setState({ phase: 'idle' })
        })
    }).catch(() => {
      setState({ phase: 'idle' })
    })
  }, [buildSession])

  /* ---- 会话过期监听 (401 from any authenticated request) ---- */
  useEffect(() => {
    const handler = () => {
      setState((prev) => {
        // Only react when currently logged in — ignore during startup restore
        if (prev.phase !== 'logged_in') return prev
        passwordRef.current = null
        mailboxPasswordRef.current = null
        clearStoredToken().catch(() => {/* ignore */})
        clearStoredSession().catch(() => {/* ignore */})
        return { phase: 'error', message: '登录已过期，请重新登录。' }
      })
    }
    window.addEventListener('account:session-expired', handler)
    return () => window.removeEventListener('account:session-expired', handler)
  }, [])

  /* ---- login ---- */
  const login = useCallback(async (username: string, password: string) => {
    if (loginInProgressRef.current) {
      console.warn('[InternalAccount] login already in progress — duplicate call suppressed')
      return
    }
    loginInProgressRef.current = true
    const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    console.log(`[InternalAccount] login start requestId=${requestId} user=${username}`)
    setState({ phase: 'loading' })
    try {
      const { token, user } = await client.login(username, password)

      if (user.status === 'disabled') {
        setState({ phase: 'error', message: '该内部账号已被禁用，请联系管理员' })
        return
      }

      // Store password in memory only — not logged, not persisted
      passwordRef.current = password
      // Mailcow SMTP/IMAP uses the login password as initial credential.
      // NOT updated on AccountCenter password change — mailcow has separate credentials.
      mailboxPasswordRef.current = password

      await storeToken(token)

      clearForcePasswordChangeStorage()

      const baseSession = buildSession('account-center', token, user, { bindingsPhase: 'loading' })

      // If force password change is enabled and required, gate the user in the force-change phase
      if (isForcePasswordChangeRequired(user)) {
        await storeSession(baseSession)
        setState({ phase: 'must_change_password', session: baseSession })
        return
      }

      const activeSession = { ...baseSession, emailAutoStatus: 'applying' as const }
      await storeSession(activeSession)
      setState({ phase: 'logged_in', session: activeSession })

      // Auto-apply email config in background (non-blocking)
      ;(async () => {
        try {
          await applyEmailConfigToSystem(user, password)
          setState((prev) =>
            prev.phase === 'logged_in'
              ? { phase: 'logged_in', session: { ...prev.session, emailAutoStatus: 'applied' } }
              : prev,
          )
        } catch (err) {
          const emailAutoError = err instanceof Error ? err.message : '邮箱配置写入失败'
          setState((prev) =>
            prev.phase === 'logged_in'
              ? { phase: 'logged_in', session: { ...prev.session, emailAutoStatus: 'error', emailAutoError } }
              : prev,
          )
        }
      })()

      client.getBindings(token, user.id).then(
        (bindings) => {
          setState((prev) =>
            prev.phase === 'logged_in'
              ? { phase: 'logged_in', session: { ...prev.session, bindings, bindingsPhase: 'success' } }
              : prev,
          )
        },
        (err) => {
          const bindingsError = err instanceof Error ? err.message : '服务绑定状态读取失败'
          setState((prev) =>
            prev.phase === 'logged_in'
              ? { phase: 'logged_in', session: { ...prev.session, bindingsPhase: 'error', bindingsError } }
              : prev,
          )
        },
      )
    } catch (err) {
      const accountError = err instanceof Error ? err.message : String(err)
      try {
        const api = electronAPI()
        if (!api?.internalAccountLoginMailbox) {
          setState({ phase: 'error', message: accountError })
          return
        }
        const mailboxResult = await api.internalAccountLoginMailbox({ usernameOrEmail: username, password })
        if (mailboxResult?.ok && mailboxResult.session) {
          const fallbackSession = mailboxResult.session as InternalAccountSession
          passwordRef.current = password
          mailboxPasswordRef.current = password
          await clearStoredToken()
          await storeSession(fallbackSession)
          setState({ phase: 'logged_in', session: fallbackSession })
          return
        }
        const mailboxError = mailboxResult?.error || '邮箱连接失败'
        setState({ phase: 'error', message: `${accountError}；${mailboxError}` })
      } catch (fallbackErr) {
        const fallbackMessage = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
        setState({ phase: 'error', message: `${accountError}；${fallbackMessage}` })
      }
    } finally {
      loginInProgressRef.current = false
    }
  }, [buildSession])

  /* ---- logout ---- */
  const logout = useCallback(() => {
    passwordRef.current = null // clear in-memory password
    mailboxPasswordRef.current = null
    clearStoredToken().catch(() => {/* ignore */})
    clearStoredSession().catch(() => {/* ignore */})
    setState({ phase: 'idle' })
  }, [])

  /* ---- loadBindings ---- */
  const loadBindings = useCallback(async () => {
    if (state.phase !== 'logged_in') return
    if (state.session.source === 'mailbox-fallback' || !state.session.token) {
      setState((prev) =>
        prev.phase === 'logged_in'
          ? { phase: 'logged_in', session: { ...prev.session, bindingsPhase: 'success', bindingsError: undefined } }
          : prev,
      )
      return
    }
    const { token, user } = state.session
    setState((prev) =>
      prev.phase === 'logged_in'
        ? { phase: 'logged_in', session: { ...prev.session, bindingsPhase: 'loading', bindingsError: undefined } }
        : prev,
    )
    try {
      const bindings = await client.getBindings(token, user.id)
      setState((prev) =>
        prev.phase === 'logged_in'
          ? { phase: 'logged_in', session: { ...prev.session, bindings, bindingsPhase: 'success', bindingsError: undefined } }
          : prev,
      )
    } catch (err) {
      const bindingsError = err instanceof Error ? err.message : '服务绑定状态读取失败'
      setState((prev) =>
        prev.phase === 'logged_in'
          ? { phase: 'logged_in', session: { ...prev.session, bindingsPhase: 'error', bindingsError } }
          : prev,
      )
      throw err // re-throw so caller (UI refresh button) can catch and handle
    }
  }, [state])

  /* ---- changePassword ---- */
  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      if (state.phase !== 'logged_in' && state.phase !== 'must_change_password') throw new Error('未登录')
      if (state.session.source === 'mailbox-fallback' || !state.session.token) {
        throw new Error('当前为邮箱登录模式，不支持修改内部账号密码')
      }
      await client.changePassword(state.session.token, currentPassword, newPassword)
      // Update AccountCenter session password — used for future changePassword calls.
      // mailboxPasswordRef is NOT updated: mailcow SMTP/IMAP has separate credentials
      // that are NOT synced with AccountCenter password changes.
      passwordRef.current = newPassword
      setState((prev) => {
        if (prev.phase !== 'logged_in' && prev.phase !== 'must_change_password') return prev
        return {
          phase: 'logged_in',
          session: {
            ...prev.session,
            user: { ...prev.session.user, mustChangePassword: false },
            // Do NOT set emailAutoStatus: 'applying' here — email config is already set
            // with the correct mailcow password from initial login.
          },
        }
      })
    },
    [state],
  )

  /* ---- completeForcePasswordChange ---- */
  const completeForcePasswordChange = useCallback(() => {
    setState((prev) => {
      if (prev.phase !== 'must_change_password') return prev
      return {
        phase: 'logged_in',
        session: {
          ...prev.session,
          user: { ...prev.session.user, mustChangePassword: false },
          emailAutoStatus: 'applying' as const,
        },
      }
    })
    // Apply email config in background after entering main app.
    // Use mailboxPasswordRef (initial login password) — NOT passwordRef (AccountCenter password).
    // Mailcow SMTP/IMAP credentials are separate from AccountCenter and don't change.
    setTimeout(() => {
      const pw = mailboxPasswordRef.current
      if (!pw) return
      setState((prev) => {
        if (prev.phase !== 'logged_in') return prev
        void applyEmailConfigToSystem(prev.session.user, pw).then(
          () => setState((p) => p.phase === 'logged_in' ? { ...p, session: { ...p.session, emailAutoStatus: 'applied' } } : p),
          () => setState((p) => p.phase === 'logged_in' ? { ...p, session: { ...p.session, emailAutoStatus: 'error' } } : p),
        )
        return prev
      })
    }, 100)
  }, [])

  /* ---- applyEmailConfig ---- */
  // Uses the in-memory passwordRef — no password arg needed.
  // On restart passwordRef is null; if user needs to re-apply, they must re-login.
  // TODO(phase6+): migrate to Electron safeStorage so password isn't written to disk.
  const applyEmailConfig = useCallback(async () => {
    if (state.phase !== 'logged_in') throw new Error('未登录')
    if (state.session.source === 'mailbox-fallback') {
      throw new Error('当前已使用学校邮箱登录，无需重新应用内部邮箱配置')
    }
    // Uses mailboxPasswordRef (initial mailcow SMTP/IMAP password), not the AccountCenter
    // session password. On restart mailboxPasswordRef is null; user must re-login to re-apply.
    const pw = mailboxPasswordRef.current
    if (!pw) throw new Error('请重新登录内部账号以更新邮箱配置')
    const { user } = state.session
    setState((prev) =>
      prev.phase === 'logged_in'
        ? { phase: 'logged_in', session: { ...prev.session, emailAutoStatus: 'applying' } }
        : prev,
    )
    try {
      await applyEmailConfigToSystem(user, pw)
      setState((prev) =>
        prev.phase === 'logged_in'
          ? { phase: 'logged_in', session: { ...prev.session, emailAutoStatus: 'applied' } }
          : prev,
      )
    } catch (err) {
      const emailAutoError = err instanceof Error ? err.message : '邮箱配置写入失败'
      setState((prev) =>
        prev.phase === 'logged_in'
          ? { phase: 'logged_in', session: { ...prev.session, emailAutoStatus: 'error', emailAutoError } }
          : prev,
      )
      throw err
    }
  }, [state])

  return (
    <InternalAccountContext.Provider
      value={{ state, login, logout, loadBindings, changePassword, completeForcePasswordChange, applyEmailConfig, getSessionPassword }}
    >
      {children}
    </InternalAccountContext.Provider>
  )
}

export function useInternalAccount(): InternalAccountContextValue {
  const ctx = useContext(InternalAccountContext)
  if (!ctx) throw new Error('useInternalAccount must be used within InternalAccountProvider')
  return ctx
}

/** 方便组件访问当前已登录 session，未登录时返回 null */
export function useInternalSession(): InternalAccountSession | null {
  const { state } = useInternalAccount()
  return (state.phase === 'logged_in' || state.phase === 'must_change_password') ? state.session : null
}

/** 当前已登录用户是否拥有管理员角色（admin 或 super_admin） */
export function useIsAdmin(): boolean {
  const session = useInternalSession()
  if (!session) return false
  const roles = session.user.roles ?? []
  // Check server-provided permissions first (more accurate)
  if (session.user.permissions && session.user.permissions.length > 0) {
    return session.user.permissions.includes('admin.panel.view')
  }
  // Fallback to role check for legacy users without permissions field
  return roles.some((r) => r === 'admin' || r === 'super_admin' || r === 'system_admin')
}

/** 当前已登录用户是否有查看工作日报的权限（管理层专属） */
export function useHasWorkReportPermission(): boolean {
  const session = useInternalSession()
  if (!session) return false
  const perms = session.user.permissions ?? []
  if (
    perms.includes('work_report.view_subordinate_summary') ||
    perms.includes('work_report.view_department_summary') ||
    perms.includes('work_report.view_tenant_summary')
  ) return true
  // Fallback: admin roles also get access
  const roles = session.user.roles ?? []
  return roles.some((r) => r === 'admin' || r === 'super_admin' || r === 'system_admin')
}
