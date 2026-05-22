/**
 * Real IMAP/SMTP email service for AI-Office.
 *
 * Uses:
 *   - imapflow  – IMAP client (receive)
 *   - nodemailer – SMTP client (send)
 *   - mailparser – RFC 5322 message parser
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { ImapFlow } from 'imapflow'
import type { ImapFlowOptions, Logger } from 'imapflow'
import nodemailer from 'nodemailer'
import { simpleParser } from 'mailparser'
import { INTERNAL_MAIL_CONFIG } from './mail/internalMailConfig'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** Structured error codes returned alongside human-readable messages */
export type EmailErrorCode =
  | 'IMAP_CONNECT_FAILED'
  | 'IMAP_AUTH_FAILED'
  | 'SMTP_CONNECT_FAILED'
  | 'SMTP_AUTH_FAILED'
  | 'TLS_HANDSHAKE_FAILED'
  | 'AUTH_FAILED'
  | 'NETWORK_TIMEOUT'
  | 'TLS_CERT_ERROR'
  | 'IMAP_FETCH_FAILED'
  | 'SMTP_SEND_FAILED'
  | 'MIME_PARSE_ERROR'
  | 'UNKNOWN_ERROR'

export interface EmailConnectionErrorDetail {
  code?: string
  command?: string
  responseCode?: number | string
  message: string
}

export interface EmailConnectionCheckResult {
  ok: boolean
  protocol: 'imap' | 'smtp'
  message: string
  error?: EmailConnectionErrorDetail & {
    errorCode?: EmailErrorCode
  }
}

/** Classify a caught error into a structured code for the renderer */
export function classifyEmailError(
  err: unknown,
  context: 'imap' | 'smtp' | 'mime' = 'imap',
): EmailErrorCode {
  if (context === 'smtp') return 'SMTP_SEND_FAILED'
  if (context === 'mime') return 'MIME_PARSE_ERROR'
  const msg = err instanceof Error ? err.message : String(err)
  const nodeCode = (err as NodeJS.ErrnoException).code ?? ''
  if (
    nodeCode === 'CONNECT_TIMEOUT' ||
    nodeCode === 'GREETING_TIMEOUT' ||
    nodeCode === 'ETIMEDOUT' ||
    /timeout|Socket timeout/i.test(msg)
  ) return 'NETWORK_TIMEOUT'
  if (/certificate|self.signed|TLS|SSL ROUTINES/i.test(msg)) return 'TLS_CERT_ERROR'
  if (/Authentication|LOGIN|auth|Login is disabled/i.test(msg)) return 'AUTH_FAILED'
  if (context === 'imap') return 'IMAP_FETCH_FAILED'
  return 'UNKNOWN_ERROR'
}

/** Metadata for a single non-inline email attachment */
export interface EmailAttachmentMeta {
  filename: string
  contentType: string
  size: number
  /** Absolute path to temp file on disk (only for non-inline attachments) */
  tempPath: string
}

export interface EmailAccountConfig {
  /** Email address — used as IMAP/SMTP login username unless `username` is set */
  user: string
  /** Convenience alias for user (email address) */
  email?: string
  /** Password or app-password */
  password: string
  /** Display name shown in outgoing mail "From" header */
  displayName: string
  imapHost: string
  /** 993 = IMAPS (TLS), 143 = STARTTLS */
  imapPort: number
  /** true → wrap socket in TLS immediately (993), false → STARTTLS (143) */
  imapSecure: boolean
  smtpHost: string
  /** 465 = SSL, 587 = STARTTLS */
  smtpPort: number
  /** true → SSL (465), false → STARTTLS/plain (587) */
  smtpSecure: boolean
  /** Override IMAP/SMTP auth username (e.g. for internal servers where login ≠ email) */
  username?: string
  /** 'internal-imap' for self-hosted servers; omitted/empty for public providers */
  providerType?: string
  /** Structured provider type — 'school_cuhk_exchange_imap_smtp' etc. */
  provider?: string
  /**
   * Reference key for credential stored in safeStorage.
   * When set, `password` is empty in the JSON config; the actual password is
   * retrieved at runtime from the OS keychain via CredentialService.
   */
  credentialRef?: string
  /**
   * 'same_as_login' → From address must equal the authenticated account.
   * Prevents sender spoofing for school Exchange accounts.
   */
  fromPolicy?: 'same_as_login'
  /** When true, SMTP STARTTLS negotiation is disabled (nodemailer ignoreTLS) */
  smtpIgnoreTls?: boolean
  /** Explicit STARTTLS preference for SMTP */
  smtpStartTls?: boolean
  /** Disable TLS certificate verification — for dev/test environments with self-signed certs */
  allowSelfSignedCerts?: boolean
  /** AccountCenter user ID — used for user isolation on internal accounts */
  ownerUserId?: string
  /** AccountCenter username — used for debug display */
  ownerUsername?: string
  /** Successful IMAP encryption mode detected during auto-probe ('none' | 'starttls' | 'ssl') */
  imapEncryption?: 'none' | 'starttls' | 'ssl'
  /** Successful SMTP encryption mode detected during auto-probe ('none' | 'starttls' | 'ssl') */
  smtpEncryption?: 'none' | 'starttls' | 'ssl'
  /** Human-readable label */
  label?: string
}

export interface FetchedMail {
  id: string
  from: string
  fromName: string
  to: string
  toName: string
  subject: string
  body: string
  /** Original HTML body with inline CID images resolved to data URIs */
  htmlBody?: string
  timestamp: string
  unread: boolean
  folder: 'inbox' | 'sent' | 'trash' | 'spam'
  /** Non-inline (regular) attachments extracted from the MIME message */
  attachments: EmailAttachmentMeta[]
  /** RFC 2822 Message-ID header value — used for In-Reply-To threading */
  messageId?: string
}

export interface SendEmailOptions {
  from: string
  fromName: string
  to: string
  subject: string
  body: string
  attachments?: { filename: string; path: string }[]
  /** RFC 2822 Message-ID of the mail being replied to, for In-Reply-To header */
  inReplyTo?: string
  /** Space-separated chain of Message-IDs for the References header */
  references?: string
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Replace cid: references in HTML with base64 data URIs.
 * Inline images are attached as MIME parts with a Content-ID header.
 * mailparser exposes them as `parsed.attachments` where `attachment.cid`
 * matches the `cid:` reference in the HTML (without the angle brackets).
 */
function resolveCidImages(
  html: string,
  attachments: Array<{ cid?: string; contentType: string; content: Buffer | Uint8Array }>,
): string {
  if (!attachments.length) return html
  const cidMap = new Map<string, string>()
  for (const att of attachments) {
    if (att.cid && att.content) {
      const buf = Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content)
      cidMap.set(att.cid, `data:${att.contentType};base64,${buf.toString('base64')}`)
    }
  }
  if (!cidMap.size) return html
  // Replace src="cid:XXXX" and src='cid:XXXX'
  return html.replace(/src=["']cid:([^"']+)["']/gi, (_match, cid) => {
    const dataUri = cidMap.get(cid)
    return dataUri ? `src="${dataUri}"` : `src="cid:${cid}"`
  })
}

/**
 * Wrap raw HTML body in a minimal document that resets font and
 * strips scripts/navigation elements.
 */
function wrapEmailHtml(rawHtml: string): string {
  // If it already has <html>, return as-is (after stripping scripts)
  const hasHtmlTag = /<html[\s>]/i.test(rawHtml)
  const stripped = rawHtml
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<link[^>]+rel=["']?stylesheet["']?[^>]*>/gi, (m) => m) // keep stylesheets
  if (hasHtmlTag) return stripped

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { margin: 0; padding: 12px 16px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; line-height: 1.7; color: #2d3748; word-break: break-word; }
  img { max-width: 100%; height: auto; }
  a { color: #3182ce; }
  table { border-collapse: collapse; max-width: 100%; }
</style>
</head>
<body>${stripped}</body>
</html>`
}

/** Try several common sent-folder names (varies by provider) */
const SENT_FOLDER_CANDIDATES = [
  'Sent',
  'Sent Items',
  'Sent Messages',
  '[Gmail]/Sent Mail',
  'INBOX.Sent',
  '已发送',
  'Junk', // fallback — never used, just terminates the search
]

/** Try several common trash-folder names (varies by provider) */
const TRASH_FOLDER_CANDIDATES = [
  'Trash',
  'Deleted Messages',
  'Deleted Items',
  '[Gmail]/Trash',
  'INBOX.Trash',
  '已删除',
  '垃圾箱',
]

const SPAM_FOLDER_CANDIDATES = [
  'Junk',
  'Spam',
  'Junk Email',
  '[Gmail]/Spam',
  'INBOX.Junk',
  '垃圾邮件',
  '垃圾箱',
]

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

type ImapStage =
  | 'prepare'
  | 'connect'
  | 'auth'
  | 'mailbox'
  | 'fetch'
  | 'logout'

interface ImapStageRef {
  current: ImapStage
  connectOkLogged: boolean
  authStartLogged: boolean
  authOkLogged: boolean
}

interface SanitizedImapConfig {
  provider: string
  emailDomain: string
  imapHost: string
  imapPort: number
  imapSecure: boolean
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  requireTLS: boolean
  folder: string
}

/** Translate low-level network errors into user-friendly Chinese messages */
function friendlyErrorMessage(err: unknown, providerType?: string): string {
  const msg = err instanceof Error ? err.message : String(err)
  const code = (err as NodeJS.ErrnoException).code ?? ''

  if (code === 'CONNECT_TIMEOUT') {
    return 'IMAP 建立 TCP/TLS 连接超时。请检查 IMAP host/port/secure 是否正确，尤其不要把 SMTP 服务器或 587/465 端口填到 IMAP 配置中。'
  }
  if (code === 'GREETING_TIMEOUT') {
    return 'IMAP 已建立连接但等待服务器 greeting 超时。请检查 TLS/STARTTLS 配置是否与端口匹配。'
  }
  if (code === 'ENOTFOUND' || msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
    if (providerType === 'internal-imap') {
      return '无法解析邮件服务器域名 mail.ai.cuhk.edu.cn，请检查 DNS 或内网网络配置。'
    }
    return '无法解析邮件服务器域名，请检查服务器地址或网络连接。'
  }
  if (code === 'ETIMEDOUT' || msg.includes('ETIMEDOUT') || msg.includes('Socket timeout')) {
    if (providerType === 'internal-imap') {
      return 'IMAP 连接超时。请检查内部邮件服务器 mail.ai.cuhk.edu.cn:993 是否可访问，以及内网连接是否正常。'
    }
    return (
      'IMAP Socket timeout。当前网络连通时，通常说明连接参数、TLS 配置、认证方式或服务器策略有问题。\n' +
      'Outlook/Office365/学校企业邮箱还可能需要 OAuth2 / Modern Auth，而不是普通密码直连。'
    )
  }
  if (code === 'ECONNREFUSED' || msg.includes('ECONNREFUSED')) {
    if (providerType === 'internal-imap') {
      return '无法连接邮件服务器 mail.ai.cuhk.edu.cn:993，请检查网络、端口或服务器状态。'
    }
    return '连接被拒绝 (ECONNREFUSED)。请检查 IMAP 服务器地址和端口是否正确。'
  }
  if (/certificate|self.?signed|SSL ROUTINES/i.test(msg) || /CERT_|SELF_SIGNED/i.test(code)) {
    return '邮件服务器 TLS 连接失败，请检查证书或安全端口配置。'
  }
  // imapflow returns "Command failed" for IMAP NO/BAD responses — commonly authentication rejection
  if (msg.includes('Command failed') || /\[AUTH\]/i.test(msg) || /AUTHENTICATIONFAILED/i.test(msg)) {
    if (providerType === 'internal-imap') {
      return '邮箱账号或密码认证失败。请确认 mailcow 中已创建 username@ai.cuhk.edu.cn 邮箱账号，并且邮箱密码与 AccountCenter 密码一致。'
    }
    return '认证失败 (Command failed)。请确认用户名和密码/授权码正确。'
  }
  if (msg.includes('Authentication') || msg.includes('LOGIN') || msg.includes('auth') || msg.includes('Login is disabled')) {
    if (providerType === 'internal-imap') {
      return '邮箱账号或密码认证失败。请确认 mailcow 中已创建邮箱账号，并且邮箱密码与 AccountCenter 密码一致。'
    }
    return '认证失败。请确认用户名和密码/授权码正确；Outlook/Office365/学校企业邮箱可能需要 OAuth2 / Modern Auth，而不是普通密码直连。'
  }
  return msg
}

/** Translate SMTP low-level errors into user-friendly Chinese messages */
function friendlySmtpErrorMessage(err: unknown, providerType?: string): string {
  const msg = err instanceof Error ? err.message : String(err)
  const code = (err as NodeJS.ErrnoException).code ?? ''

  if (code === 'ENOTFOUND' || msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
    if (providerType === 'internal-imap') {
      return '无法解析邮件服务器域名 mail.ai.cuhk.edu.cn，请检查 DNS 或内网网络配置。'
    }
    return '无法解析 SMTP 服务器域名，请检查服务器地址或网络连接。'
  }
  if (code === 'ECONNREFUSED' || msg.includes('ECONNREFUSED')) {
    if (providerType === 'internal-imap') {
      return '无法连接邮件服务器 mail.ai.cuhk.edu.cn:465，请检查网络、端口或服务器状态。'
    }
    return '无法连接 SMTP 服务器，请检查服务器地址和端口是否正确。'
  }
  if (code === 'ETIMEDOUT' || msg.includes('ETIMEDOUT') || code === 'ESOCKET' || msg.includes('timeout')) {
    if (providerType === 'internal-imap') {
      return 'SMTP 连接超时。请检查内部邮件服务器 mail.ai.cuhk.edu.cn:465 是否可访问。'
    }
    return 'SMTP 连接超时，请检查网络连接或服务器状态。'
  }
  if (/certificate|self.?signed|SSL ROUTINES/i.test(msg) || /CERT_|SELF_SIGNED/i.test(code)) {
    return '邮件服务器 TLS 连接失败，请检查证书或安全端口配置。'
  }
  if (/auth|535|LOGIN|Invalid login|credentials|Command failed/i.test(msg)) {
    if (providerType === 'internal-imap') {
      return 'SMTP 认证失败。请确认 mailcow 中已创建 username@ai.cuhk.edu.cn 邮箱账号，并且邮箱密码与 AccountCenter 密码一致。'
    }
    return 'SMTP 认证失败。请确认用户名和密码正确。'
  }
  return msg
}

const IMAP_OPTIONS = {
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000,
} as const

/**
 * Build TLS options for IMAP (ImapFlow) or SMTP (nodemailer) connections.
 *
 * For internal-imap accounts we connect directly to mail.ai.cuhk.edu.cn
 * (DNS-resolvable) and disable certificate verification (self-signed internal cert).
 * logicalHost is sent as TLS SNI so the mail server routes to the correct vhost.
 *
 * For other accounts we only skip cert verification when allowSelfSignedCerts
 * is explicitly set (e.g. development environments).
 */
function buildTlsOpts(config: EmailAccountConfig): { tls?: Record<string, unknown> } {
  if (config.providerType === 'internal-imap') {
    return {
      tls: {
        rejectUnauthorized: false,
        servername: INTERNAL_MAIL_CONFIG.logicalHost,
      },
    }
  }
  if (config.provider === 'school_cuhk_exchange_imap_smtp') {
    return {
      tls: {
        rejectUnauthorized: false,
        servername: config.imapHost || config.smtpHost || 'mail.cuhk.edu.cn',
      },
    }
  }
  return config.allowSelfSignedCerts ? { tls: { rejectUnauthorized: false } } : {}
}

/**
 * Create an ImapFlow client with an attached `error` event listener.
 * Without this, any unhandled socket error (e.g. Socket timeout) emitted
 * after the current await completes would crash the Electron main process via
 * Node.js's uncaught EventEmitter error semantics.
 */
function createSafeImapFlow(
  options: ImapFlowOptions,
  config: EmailAccountConfig,
  folder: string,
  stageRef: ImapStageRef,
): LoggedImapFlow {
  const client = new LoggedImapFlow(options, config, folder, stageRef)
  client.on('error', (err: Error) => {
    // Log for diagnostics but do not re-throw — prevents uncaught exception crash
    logImapError(config, folder, 'client:socket-error', err)
  })
  return client
}

function maskUsername(username: string): string {
  const [name, domain] = username.split('@')
  if (!domain) {
    return username.length <= 2 ? '**' : `${username.slice(0, 2)}***`
  }
  const visible = name.length <= 2 ? name.slice(0, 1) : name.slice(0, 2)
  return `${visible}***@${domain}`
}

function extractEmailDomain(address: string): string {
  const normalized = String(address || '').trim().toLowerCase()
  const at = normalized.lastIndexOf('@')
  return at >= 0 ? normalized.slice(at + 1) : ''
}

function is163ProviderConfig(config: EmailAccountConfig): boolean {
  const imapHost = config.imapHost.trim().toLowerCase()
  const smtpHost = config.smtpHost.trim().toLowerCase()
  return imapHost === 'imap.163.com' || smtpHost === 'smtp.163.com' || extractEmailDomain(config.user) === '163.com'
}

function resolveConfiguredSmtpMode(config: EmailAccountConfig): 'ssl' | 'starttls' | 'none' {
  if (config.smtpEncryption) return config.smtpEncryption
  if (config.smtpIgnoreTls) return 'none'
  if (config.smtpSecure) return 'ssl'
  if (config.smtpStartTls || Number(config.smtpPort) === 587) return 'starttls'
  return 'starttls'
}

function createTlsConfigError(message: string): NodeJS.ErrnoException {
  const err = new Error(message) as NodeJS.ErrnoException
  err.code = 'TLS_CONFIG_ERROR'
  return err
}

function validateImapTlsConfig(config: EmailAccountConfig): void {
  const port = Number(config.imapPort)
  if (port === 993 && !config.imapSecure) {
    throw createTlsConfigError('IMAP 993 端口必须使用 implicit SSL/TLS（secure=true），不能走 STARTTLS。')
  }
  if (port === 143 && config.imapSecure) {
    throw createTlsConfigError('IMAP 143 端口应使用 STARTTLS（secure=false），不要配置为 implicit SSL/TLS。')
  }
}

function resolveSmtpSecurity(config: EmailAccountConfig): {
  secure: boolean
  requireTLS: boolean
  ignoreTLS: boolean
  mode: 'ssl' | 'starttls' | 'none'
} {
  const port = Number(config.smtpPort)
  const mode = resolveConfiguredSmtpMode(config)

  if (port === 465) {
    if (!config.smtpSecure || mode === 'starttls') {
      throw createTlsConfigError('SMTP 465 端口必须使用 implicit SSL/TLS（secure=true），不允许走 STARTTLS。')
    }
    return { secure: true, requireTLS: false, ignoreTLS: false, mode: 'ssl' }
  }

  if (port === 587) {
    if (config.smtpSecure || mode === 'ssl' || mode === 'none') {
      throw createTlsConfigError('SMTP 587 端口必须使用 STARTTLS（secure=false 且 requireTLS=true）。')
    }
    return { secure: false, requireTLS: true, ignoreTLS: false, mode: 'starttls' }
  }

  if (mode === 'ssl') return { secure: true, requireTLS: false, ignoreTLS: false, mode }
  if (mode === 'none') return { secure: false, requireTLS: false, ignoreTLS: true, mode }
  return { secure: false, requireTLS: true, ignoreTLS: false, mode: 'starttls' }
}

function resolveAuthUser(config: EmailAccountConfig): string {
  const primaryUser = String(config.user || config.email || '').trim()
  if (is163ProviderConfig(config)) return primaryUser
  return config.username?.trim() || primaryUser
}

function normalizeEmailAccountConfig(config: EmailAccountConfig): EmailAccountConfig {
  const user = String(config.user || config.email || '').trim()
  const username = config.username?.trim()
  return {
    ...config,
    user,
    email: user,
    username: is163ProviderConfig({ ...config, user, email: user }) ? user : (username || undefined),
  }
}

function extractConnectionErrorDetail(err: unknown): EmailConnectionErrorDetail {
  const anyErr = err as NodeJS.ErrnoException & { command?: unknown; responseCode?: unknown }
  return {
    code: typeof anyErr.code === 'string' ? anyErr.code : undefined,
    command: typeof anyErr.command === 'string' ? anyErr.command : undefined,
    responseCode:
      typeof anyErr.responseCode === 'number' || typeof anyErr.responseCode === 'string'
        ? anyErr.responseCode
        : undefined,
    message: err instanceof Error ? err.message : String(err),
  }
}

function isAuthConnectionError(detail: EmailConnectionErrorDetail): boolean {
  return (
    detail.code === 'EAUTH' ||
    detail.responseCode === 535 ||
    /^AUTH\b/i.test(detail.command || '') ||
    /Invalid login|Authentication failed|AUTHENTICATIONFAILED|Login is disabled|Command failed|credentials|EAUTH|\[AUTH\]/i.test(detail.message)
  )
}

function isNetworkConnectionError(detail: EmailConnectionErrorDetail): boolean {
  return (
    detail.code === 'ECONNREFUSED' ||
    detail.code === 'ETIMEDOUT' ||
    detail.code === 'ENOTFOUND' ||
    detail.code === 'CONNECT_TIMEOUT' ||
    detail.code === 'GREETING_TIMEOUT' ||
    /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|timeout|getaddrinfo/i.test(detail.message)
  )
}

function isTlsConnectionError(detail: EmailConnectionErrorDetail): boolean {
  return (
    detail.code === 'TLS_CONFIG_ERROR' ||
    /certificate|self.?signed|TLS|SSL|handshake|wrong version|unable to verify/i.test(detail.message) ||
    /CERT_|SELF_SIGNED/i.test(detail.code || '')
  )
}

function buildConnectionHelpMessage(
  detail: EmailConnectionErrorDetail,
  config: EmailAccountConfig,
): string {
  if (isAuthConnectionError(detail)) {
    if (is163ProviderConfig(config)) {
      return '请确认 163 网页端已开启 IMAP/SMTP 服务，并使用客户端授权码，不是网页登录密码'
    }
    return '认证失败，请确认用户名和授权信息正确'
  }
  if (isNetworkConnectionError(detail)) {
    return '网络或端口不可达'
  }
  if (isTlsConnectionError(detail)) {
    return 'SSL/TLS 配置错误，请检查 465/993 是否使用 secure=true'
  }
  return detail.message
}

function resolveConnectionErrorCode(
  protocol: 'imap' | 'smtp',
  stage: ImapStage | 'auth' | 'connect',
  detail: EmailConnectionErrorDetail,
): EmailErrorCode {
  if (isTlsConnectionError(detail)) return 'TLS_HANDSHAKE_FAILED'
  if (protocol === 'imap') return stage === 'auth' || isAuthConnectionError(detail) ? 'IMAP_AUTH_FAILED' : 'IMAP_CONNECT_FAILED'
  return isAuthConnectionError(detail) ? 'SMTP_AUTH_FAILED' : 'SMTP_CONNECT_FAILED'
}

function buildConnectionResult(
  protocol: 'imap' | 'smtp',
  ok: boolean,
  message: string,
  error?: EmailConnectionCheckResult['error'],
): EmailConnectionCheckResult {
  return { ok, protocol, message, error }
}

function sanitizedImapConfig(config: EmailAccountConfig, folder: string): SanitizedImapConfig {
  const smtpMode = resolveConfiguredSmtpMode(config)
  const requireTLS = smtpMode === 'starttls' || (!config.smtpSecure && Number(config.smtpPort) === 587 && !config.smtpIgnoreTls)
  return {
    provider: config.provider || config.providerType || 'unknown',
    emailDomain: extractEmailDomain(config.user),
    imapHost: config.imapHost,
    imapPort: config.imapPort,
    imapSecure: config.imapSecure,
    smtpHost: config.smtpHost,
    smtpPort: config.smtpPort,
    smtpSecure: config.smtpSecure,
    requireTLS,
    folder,
  }
}

function logImapStage(
  config: EmailAccountConfig,
  folder: string,
  stage: string,
  extra?: Record<string, unknown>,
): void {
  console.info('[EmailService:IMAP]', {
    stage,
    ...sanitizedImapConfig(config, folder),
    ...(extra ?? {}),
  })
}

function logImapError(
  config: EmailAccountConfig,
  folder: string,
  stage: string,
  err: unknown,
  extra?: Record<string, unknown>,
): void {
  console.error('[EmailService:IMAP]', {
    stage,
    ...sanitizedImapConfig(config, folder),
    error: extractConnectionErrorDetail(err),
    ...(extra ?? {}),
  })
}

function logSmtpStage(
  config: EmailAccountConfig,
  stage: string,
  extra?: Record<string, unknown>,
): void {
  console.info('[EmailService:SMTP]', {
    stage,
    ...sanitizedImapConfig(config, 'SMTP'),
    ...(extra ?? {}),
  })
}

function logSmtpError(
  config: EmailAccountConfig,
  stage: string,
  err: unknown,
  extra?: Record<string, unknown>,
): void {
  console.error('[EmailService:SMTP]', {
    stage,
    ...sanitizedImapConfig(config, 'SMTP'),
    error: extractConnectionErrorDetail(err),
    ...(extra ?? {}),
  })
}

function assertImapConfigNotSmtp(config: EmailAccountConfig, folder: string): void {
  // For internal self-hosted servers, IMAP and SMTP commonly share the same hostname — skip that check
  // School CUHK Exchange uses mail.cuhk.edu.cn for both IMAP:143 and SMTP:587 — also skip
  const isInternal = config.providerType === 'internal-imap' || config.provider === 'school_cuhk_exchange_imap_smtp'
  const imapHost = config.imapHost.trim().toLowerCase()
  const smtpHost = config.smtpHost.trim().toLowerCase()
  const problems: string[] = []

  if (!isInternal && imapHost === smtpHost) problems.push('IMAP host 与 SMTP host 完全相同')
  if (imapHost.includes('smtp')) problems.push('IMAP host 看起来是 SMTP 服务器')
  if ([25, 465, 587].includes(Number(config.imapPort))) problems.push(`IMAP port=${config.imapPort} 看起来是 SMTP 端口`)

  if (problems.length) {
    const message = `疑似混用了 SMTP 与 IMAP 配置：${problems.join('；')}。请将 IMAP 设置为收信服务器，例如 Outlook/Office365 通常为 outlook.office365.com:993 secure=true。`
    logImapError(config, folder, 'prepare:config-error', new Error(message), {
      smtpHost: config.smtpHost,
      smtpPort: config.smtpPort,
    })
    throw new Error(message)
  }

  logImapStage(config, folder, 'prepare:config-ok', {
    smtpHost: config.smtpHost,
    smtpPort: config.smtpPort,
  })
}

function createImapLogger(
  config: EmailAccountConfig,
  folder: string,
  stageRef: ImapStageRef,
): Logger {
  const observe = (obj: any) => {
    if (obj?.src === 'connection' && typeof obj.msg === 'string' && obj.msg.includes('Established')) {
      stageRef.connectOkLogged = true
      logImapStage(config, folder, 'connect:ok', {
        tlsAuthorized: obj.authorized,
        tlsVersion: obj.version,
      })
    }
  }

  return {
    debug: observe,
    info: observe,
    warn: observe,
    error: (obj: any) => {
      const err = obj?.err ?? obj?.error ?? obj
      logImapError(config, folder, `${stageRef.current}:imapflow-error`, err)
    },
  }
}

const authenticateViaImapFlow = (
  ImapFlow.prototype as unknown as {
    authenticate(this: ImapFlow): Promise<unknown>
  }
).authenticate

class LoggedImapFlow extends ImapFlow {
  constructor(
    options: ImapFlowOptions,
    private readonly emailConfig: EmailAccountConfig,
    private readonly folderForLog: string,
    private readonly stageRef: ImapStageRef,
  ) {
    super(options)
  }

  async authenticate(): Promise<unknown> {
    this.stageRef.current = 'auth'
    this.stageRef.authStartLogged = true
    logImapStage(this.emailConfig, this.folderForLog, 'auth:start')
    const result = await authenticateViaImapFlow.call(this)
    this.stageRef.authOkLogged = true
    logImapStage(this.emailConfig, this.folderForLog, 'auth:ok')
    return result
  }
}

/* ------------------------------------------------------------------ */
/*  Attachment helpers                                                 */
/* ------------------------------------------------------------------ */

/** Strip characters that are invalid in Windows/Linux filenames */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/^\.+/, '_')
    .slice(0, 200)
    .trim() || 'attachment'
}

/**
 * Returns true if the attachment should be treated as a downloadable file
 * rather than an inline image referenced by a CID src in the HTML body.
 */
function isRegularAttachment(att: {
  cid?: string
  related?: boolean
  contentDisposition?: string
  filename?: string
}): boolean {
  if (att.cid || att.related) return false
  if (att.contentDisposition === 'inline' && !att.filename) return false
  return att.contentDisposition === 'attachment' || Boolean(att.filename)
}

/* ------------------------------------------------------------------ */
/*  EmailService                                                       */
/* ------------------------------------------------------------------ */

export class EmailService {
  private readonly configPath: string
  private readonly attachmentsDir: string

  constructor(userDataPath: string) {
    this.configPath = path.join(userDataPath, 'email-account.json')
    this.attachmentsDir = path.join(userDataPath, 'email-attachments')
  }

  /** Returns the root directory used to cache attachment temp files */
  getAttachmentsDir(): string {
    return this.attachmentsDir
  }

  /** Remove all cached attachment temp files (call on account clear) */
  async clearAttachmentsCache(): Promise<void> {
    try {
      await fs.rm(this.attachmentsDir, { recursive: true, force: true })
    } catch {
      // ignore – dir may not exist yet
    }
  }

  /* ---------- config persistence ---------- */

  async loadConfig(): Promise<EmailAccountConfig | null> {
    try {
      const raw = await fs.readFile(this.configPath, 'utf-8')
      return JSON.parse(raw) as EmailAccountConfig
    } catch {
      return null
    }
  }

  async saveConfig(config: EmailAccountConfig): Promise<void> {
    await fs.mkdir(path.dirname(this.configPath), { recursive: true })
    await fs.writeFile(this.configPath, JSON.stringify(normalizeEmailAccountConfig(config), null, 2), 'utf-8')
  }

  async clearConfig(): Promise<void> {
    try { await fs.unlink(this.configPath) } catch { /* already gone */ }
  }

  /* ---------- connection test ---------- */

  async testConnection(config: EmailAccountConfig): Promise<EmailConnectionCheckResult> {
    const normalizedConfig = normalizeEmailAccountConfig(config)
    const folderForLog = 'INBOX'
    const stageRef: ImapStageRef = {
      current: 'prepare',
      connectOkLogged: false,
      authStartLogged: false,
      authOkLogged: false,
    }
    try {
      validateImapTlsConfig(normalizedConfig)
      assertImapConfigNotSmtp(normalizedConfig, folderForLog)
    } catch (err) {
      const detail = extractConnectionErrorDetail(err)
      const errorCode = resolveConnectionErrorCode('imap', 'connect', detail)
      logImapError(normalizedConfig, folderForLog, 'prepare:failed', err)
      return buildConnectionResult('imap', false, buildConnectionHelpMessage(detail, normalizedConfig), { ...detail, errorCode })
    }

    // Pre-flight: empty password gives confusing ImapFlow error — catch it early
    if (!normalizedConfig.password) {
      const msg = normalizedConfig.providerType === 'internal-imap'
        ? '内部邮箱未配置密码，请输入该内部账号的邮箱密码后重试。'
        : '未配置邮箱密码，请填写密码后重试。'
      return buildConnectionResult('imap', false, msg, { message: msg, errorCode: 'IMAP_AUTH_FAILED' })
    }

    const authUser = resolveAuthUser(normalizedConfig)
    const tlsOpts = buildTlsOpts(normalizedConfig)
    const client = createSafeImapFlow({
      host: normalizedConfig.providerType === 'internal-imap' ? INTERNAL_MAIL_CONFIG.fallbackIp : normalizedConfig.imapHost,
      port: normalizedConfig.imapPort,
      secure: normalizedConfig.imapSecure,
      auth: { user: authUser, pass: normalizedConfig.password },
      logger: createImapLogger(normalizedConfig, folderForLog, stageRef),
      ...tlsOpts,
      ...IMAP_OPTIONS,
    }, normalizedConfig, folderForLog, stageRef)
    try {
      stageRef.current = 'connect'
      logImapStage(normalizedConfig, folderForLog, 'connect:start')
      await client.connect()
      if (!stageRef.connectOkLogged) logImapStage(normalizedConfig, folderForLog, 'connect:ok')
      if (!stageRef.authStartLogged) logImapStage(normalizedConfig, folderForLog, 'auth:start')
      if (!stageRef.authOkLogged) logImapStage(normalizedConfig, folderForLog, 'auth:ok')
      await client.logout()
      return buildConnectionResult('imap', true, '连接成功')
    } catch (err) {
      const detail = extractConnectionErrorDetail(err)
      const errorCode = resolveConnectionErrorCode('imap', stageRef.current, detail)
      logImapError(normalizedConfig, folderForLog, `${stageRef.current}:failed`, err)
      return buildConnectionResult('imap', false, buildConnectionHelpMessage(detail, normalizedConfig), { ...detail, errorCode })
    }
  }

  async testSmtpConnection(config: EmailAccountConfig): Promise<EmailConnectionCheckResult> {
    const normalizedConfig = normalizeEmailAccountConfig(config)
    if (!normalizedConfig.password) {
      const msg = normalizedConfig.providerType === 'internal-imap'
        ? '内部邮箱未配置密码，请输入该内部账号的邮箱密码后重试。'
        : '未配置邮箱密码，请填写密码后重试。'
      return buildConnectionResult('smtp', false, msg, { message: msg, errorCode: 'SMTP_AUTH_FAILED' })
    }

    let smtpSecurity: ReturnType<typeof resolveSmtpSecurity>
    try {
      smtpSecurity = resolveSmtpSecurity(normalizedConfig)
    } catch (err) {
      const detail = extractConnectionErrorDetail(err)
      const errorCode = resolveConnectionErrorCode('smtp', 'connect', detail)
      logSmtpError(normalizedConfig, 'prepare:failed', err)
      return buildConnectionResult('smtp', false, buildConnectionHelpMessage(detail, normalizedConfig), { ...detail, errorCode })
    }

    const authUser = resolveAuthUser(normalizedConfig)
    logSmtpStage(normalizedConfig, 'connect:start', {
      authUser: maskUsername(authUser),
    })
    const transporter = nodemailer.createTransport({
      host: normalizedConfig.providerType === 'internal-imap' ? INTERNAL_MAIL_CONFIG.fallbackIp : normalizedConfig.smtpHost,
      port: normalizedConfig.smtpPort,
      secure: smtpSecurity.secure,
      auth: { user: authUser, pass: normalizedConfig.password },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      ...(smtpSecurity.ignoreTLS ? { ignoreTLS: true } : {}),
      ...(smtpSecurity.requireTLS ? { requireTLS: true } : {}),
      ...buildTlsOpts(normalizedConfig),
    })
    try {
      await transporter.verify()
      logSmtpStage(normalizedConfig, 'connect:ok', {
        authUser: maskUsername(authUser),
      })
      return buildConnectionResult('smtp', true, '连接成功')
    } catch (err) {
      const detail = extractConnectionErrorDetail(err)
      const errorCode = resolveConnectionErrorCode('smtp', isAuthConnectionError(detail) ? 'auth' : 'connect', detail)
      logSmtpError(normalizedConfig, isAuthConnectionError(detail) ? 'auth:failed' : 'connect:failed', err, {
        authUser: maskUsername(authUser),
      })
      return buildConnectionResult('smtp', false, buildConnectionHelpMessage(detail, normalizedConfig), { ...detail, errorCode })
    }
  }

  /* ---------- fetch ---------- */

  async fetchInbox(config: EmailAccountConfig, limit = 50): Promise<FetchedMail[]> {
    return this._fetchFolder(config, ['INBOX'], 'inbox', limit)
  }

  async fetchSent(config: EmailAccountConfig, limit = 50): Promise<FetchedMail[]> {
    return this._fetchFolder(config, SENT_FOLDER_CANDIDATES, 'sent', limit)
  }

  async fetchTrash(config: EmailAccountConfig, limit = 50): Promise<FetchedMail[]> {
    return this._fetchFolder(config, TRASH_FOLDER_CANDIDATES, 'trash', limit)
  }

  async fetchSpam(config: EmailAccountConfig, limit = 50): Promise<FetchedMail[]> {
    return this._fetchFolder(config, SPAM_FOLDER_CANDIDATES, 'spam', limit)
  }

  private async _fetchFolder(
    config: EmailAccountConfig,
    folderCandidates: string[],
    folderType: 'inbox' | 'sent' | 'trash' | 'spam',
    limit: number,
  ): Promise<FetchedMail[]> {
    const folderForLog = folderCandidates.join('|')
    const stageRef: ImapStageRef = {
      current: 'prepare',
      connectOkLogged: false,
      authStartLogged: false,
      authOkLogged: false,
    }

    logImapStage(config, folderForLog, 'prepare', {
      folderType,
      limit,
      timeouts: IMAP_OPTIONS,
    })

    try {
      assertImapConfigNotSmtp(config, folderForLog)
    } catch (err) {
      throw new Error(`[IMAP prepare] ${friendlyErrorMessage(err, config.providerType)}`)
    }

    // Pre-flight: empty password gives confusing ImapFlow error — catch it early
    if (!config.password) {
      const msg = config.providerType === 'internal-imap'
        ? '内部邮箱未配置密码，请输入该内部账号的邮箱密码后重试。'
        : '未配置邮箱密码，请填写密码后重试。'
      throw new Error(`[IMAP auth] ${msg}`)
    }

    const authUser = resolveAuthUser(config)
    const tlsOpts = buildTlsOpts(config)
    const client = createSafeImapFlow({
      host: config.providerType === 'internal-imap' ? INTERNAL_MAIL_CONFIG.fallbackIp : config.imapHost,
      port: config.imapPort,
      secure: config.imapSecure,
      auth: { user: authUser, pass: config.password },
      logger: createImapLogger(config, folderForLog, stageRef),
      ...tlsOpts,
      ...IMAP_OPTIONS,
    }, config, folderForLog, stageRef)

    try {
      stageRef.current = 'connect'
      logImapStage(config, folderForLog, 'connect:start')
      await client.connect()
      if (!stageRef.connectOkLogged) logImapStage(config, folderForLog, 'connect:ok')
      if (!stageRef.authStartLogged) logImapStage(config, folderForLog, 'auth:start')
      if (!stageRef.authOkLogged) logImapStage(config, folderForLog, 'auth:ok')
    } catch (err) {
      logImapError(config, folderForLog, `${stageRef.current}:failed`, err)
      throw new Error(`[IMAP ${stageRef.current}] ${friendlyErrorMessage(err, config.providerType)}`)
    }

    try {
      let resolvedCandidates = [...folderCandidates]
      if (folderType !== 'inbox') {
        try {
          const folders = await client.list()
          const specialUseFlag = folderType === 'sent'
            ? '\\Sent'
            : folderType === 'trash'
              ? '\\Trash'
              : '\\Junk'
          const specialUseFolder = folders.find((folder) =>
            (folder as unknown as Record<string, unknown>).specialUse === specialUseFlag
            || (folder.flags instanceof Set && folder.flags.has(specialUseFlag)),
          )
          const lowerPathMap = new Map(folders.map((folder) => [folder.path.toLowerCase(), folder.path] as const))
          const matchedCandidates = folderCandidates
            .map((candidate) => lowerPathMap.get(candidate.toLowerCase()))
            .filter((candidate): candidate is string => Boolean(candidate))
          resolvedCandidates = [
            ...(specialUseFolder ? [specialUseFolder.path] : []),
            ...matchedCandidates,
            ...folderCandidates,
          ].filter((candidate, index, list) => list.indexOf(candidate) === index)
        } catch {
          // LIST is best-effort only; fall back to the static candidates below.
        }
      }

      let opened = false
      let openedFolder = ''
      for (const folder of resolvedCandidates) {
        try {
          stageRef.current = 'mailbox'
          logImapStage(config, folder, 'mailbox:start')
          await client.mailboxOpen(folder, { readOnly: true })
          logImapStage(config, folder, 'mailbox:ok', {
            exists: client.mailbox ? client.mailbox.exists : undefined,
          })
          opened = true
          openedFolder = folder
          break
        } catch (err) {
          logImapError(config, folder, 'mailbox:failed', err)
          continue
        }
      }

      if (!opened) return []

      const mailbox = client.mailbox
      if (!mailbox || mailbox.exists === 0) {
        stageRef.current = 'fetch'
        logImapStage(config, openedFolder || folderForLog, 'fetch:start', {
          range: '(empty)',
          limit,
          mailboxExists: mailbox ? mailbox.exists : 0,
        })
        logImapStage(config, openedFolder || folderForLog, 'fetch:ok', { count: 0 })
        return []
      }

      const start = Math.max(1, mailbox.exists - limit + 1)
      const range = `${start}:${mailbox.exists}`

      const mails: FetchedMail[] = []

      stageRef.current = 'fetch'
      logImapStage(config, openedFolder || folderForLog, 'fetch:start', {
        range,
        limit,
        mailboxExists: mailbox.exists,
      })

      for await (const message of client.fetch(range, {
        envelope: true,
        source: true,
        flags: true,
        uid: true,
      })) {
        try {
          const parsed = await simpleParser(message.source as unknown as Buffer)
          const envelope = message.envelope
          if (!envelope) continue
          const fromAddr = envelope.from?.[0]
          const toAddr = envelope.to?.[0]
          const flags = message.flags ?? new Set<string>()
          const body = parsed.text
            || (parsed.html ? htmlToText(String(parsed.html)) : '')
            || ''

          // Resolve inline CID images → base64 data URIs, then wrap in full doc
          let htmlBody: string | undefined
          if (parsed.html) {
            const resolved = resolveCidImages(
              String(parsed.html),
              (parsed.attachments ?? []) as Array<{ cid?: string; contentType: string; content: Buffer | Uint8Array }>,
            )
            htmlBody = wrapEmailHtml(resolved)
          }

          // Extract non-inline attachments and save to per-mail temp directory
          const mailId = `${folderType}-${message.uid}`
          const attachments: EmailAttachmentMeta[] = []
          const rawAtts = parsed.attachments ?? []
          for (let i = 0; i < rawAtts.length; i++) {
            const att = rawAtts[i]
            if (!isRegularAttachment(att)) continue
            if (!att.content || att.content.length === 0) continue
            try {
              const filename = sanitizeFilename(att.filename || `attachment-${i}`)
              const content = Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content)
              const size = att.size ?? content.length
              const tempDir = path.join(this.attachmentsDir, mailId)
              const tempPath = path.join(tempDir, `${i}_${filename}`)
              await fs.mkdir(tempDir, { recursive: true })
              await fs.writeFile(tempPath, content)
              attachments.push({
                filename: att.filename || `attachment-${i}`,
                contentType: att.contentType || 'application/octet-stream',
                size,
                tempPath,
              })
            } catch (attErr) {
              console.warn('[EmailService] attachment save skipped:', {
                mailId, index: i, err: attErr instanceof Error ? attErr.message : String(attErr),
              })
            }
          }

          mails.push({
            id: mailId,
            from: fromAddr?.address || '',
            fromName: fromAddr?.name || fromAddr?.address || '',
            to: toAddr?.address || '',
            toName: toAddr?.name || toAddr?.address || '',
            subject: envelope.subject || '(无主题)',
            body: body.trim(),
            htmlBody,
            timestamp: (envelope.date ?? new Date()).toISOString(),
            unread: !flags.has('\\Seen'),
            folder: folderType,
            attachments,
            messageId: parsed.messageId ?? (envelope.messageId as string | undefined),
          })
        } catch {
          // skip malformed individual messages
        }
      }

      logImapStage(config, openedFolder || folderForLog, 'fetch:ok', {
        count: mails.length,
      })
      return mails.reverse() // newest first
    } catch (err) {
      logImapError(config, folderForLog, `${stageRef.current}:failed`, err)
      throw new Error(`[IMAP ${stageRef.current}] ${friendlyErrorMessage(err)}`)
    } finally {
      stageRef.current = 'logout'
      try {
        await client.logout()
      } catch (err) {
        logImapError(config, folderForLog, 'logout:failed', err)
      }
    }
  }

  /* ---------- send ---------- */

  async sendEmail(config: EmailAccountConfig, options: SendEmailOptions): Promise<void> {
    const authUser = resolveAuthUser(config)
    const smtpSecurity = resolveSmtpSecurity(config)
    const fromAddr = (options.from || config.user || authUser).trim()
    const transporter = nodemailer.createTransport({
      host: config.providerType === 'internal-imap' ? INTERNAL_MAIL_CONFIG.fallbackIp : config.smtpHost,
      port: config.smtpPort,
      secure: smtpSecurity.secure,
      auth: { user: authUser, pass: config.password },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      ...(smtpSecurity.ignoreTLS ? { ignoreTLS: true } : {}),
      ...(smtpSecurity.requireTLS ? { requireTLS: true } : {}),
      ...buildTlsOpts(config),
    })

    const fromDisplay = options.fromName ? `"${options.fromName}" <${fromAddr}>` : fromAddr
    const mailOpts: Record<string, unknown> = {
      from: fromDisplay,
      sender: fromAddr,
      replyTo: fromAddr,
      to: options.to,
      subject: options.subject,
      text: options.body,
      attachments: options.attachments?.map((a) => ({ filename: a.filename, path: a.path })),
    }
    if (options.inReplyTo) mailOpts.inReplyTo = options.inReplyTo
    if (options.references) mailOpts.references = options.references

    await transporter.sendMail(mailOpts as Parameters<typeof transporter.sendMail>[0])
  }

  /**
   * Build a minimal RFC 2822 raw MIME message from send options.
   * Used to append a copy to the IMAP Sent folder after SMTP send.
   */
  buildRawMimeMessage(options: SendEmailOptions): Buffer {
    const senderDomain = (options.from || 'localhost').includes('@')
      ? (options.from || 'localhost').split('@')[1]
      : 'localhost'
    const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@${senderDomain}>`
    const dateStr = new Date().toUTCString()
    // Base64-encode non-ASCII subject
    const subjectEncoded = /[^\x00-\x7F]/.test(options.subject)
      ? `=?UTF-8?B?${Buffer.from(options.subject, 'utf-8').toString('base64')}?=`
      : options.subject
    const lines: string[] = [
      `Date: ${dateStr}`,
      `From: "${options.fromName}" <${options.from}>`,
      `To: ${options.to}`,
      `Subject: ${subjectEncoded}`,
      `Message-ID: ${messageId}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/plain; charset=UTF-8`,
      `Content-Transfer-Encoding: 8bit`,
    ]
    if (options.inReplyTo) lines.push(`In-Reply-To: ${options.inReplyTo}`)
    if (options.references) lines.push(`References: ${options.references}`)
    lines.push('') // blank line between headers and body
    lines.push(options.body)
    return Buffer.from(lines.join('\r\n'), 'utf-8')
  }

  /**
   * Append a raw RFC 2822 message to the IMAP Sent folder.
   * Tries special-use \Sent first, then common name candidates.
   * Non-fatal: caller should catch and surface a warning to the user.
   */
  async appendToSent(config: EmailAccountConfig, rawMessage: Buffer): Promise<void> {
    const stageRef: ImapStageRef = {
      current: 'prepare',
      connectOkLogged: false,
      authStartLogged: false,
      authOkLogged: false,
    }
    const authUser = resolveAuthUser(config)
    const tlsOpts = buildTlsOpts(config)
    const client = createSafeImapFlow({
      host: config.providerType === 'internal-imap' ? INTERNAL_MAIL_CONFIG.fallbackIp : config.imapHost,
      port: config.imapPort,
      secure: config.imapSecure,
      auth: { user: authUser, pass: config.password },
      logger: createImapLogger(config, 'Sent', stageRef),
      ...tlsOpts,
      ...IMAP_OPTIONS,
    }, config, 'Sent', stageRef)

    try {
      stageRef.current = 'connect'
      await client.connect()

      // Discover Sent folder: prefer special-use \Sent, then name candidates
      let sentFolder = ''
      try {
        const folders = await client.list()
        for (const f of folders) {
          if (
            (f as unknown as Record<string, unknown>).specialUse === '\\Sent' ||
            (f.flags instanceof Set && f.flags.has('\\Sent'))
          ) {
            sentFolder = f.path
            break
          }
        }
        if (!sentFolder) {
          const nameSet = new Set(folders.map((f) => f.path))
          for (const candidate of SENT_FOLDER_CANDIDATES.filter((c) => c !== 'Junk')) {
            if (nameSet.has(candidate)) { sentFolder = candidate; break }
          }
        }
      } catch { /* fallback to first candidate */ }

      if (!sentFolder) sentFolder = 'Sent'

      stageRef.current = 'mailbox'
      await client.append(sentFolder, rawMessage, ['\\Seen'])
      logImapStage(config, sentFolder, 'append:ok', { size: rawMessage.length })
    } finally {
      try { await client.logout() } catch { /* ignore */ }
    }
  }

  /* ---------- delete (move to trash) ---------- */

  async moveMessageToTrash(
    config: EmailAccountConfig,
    mailId: string,
    sourceFolder: 'inbox' | 'sent',
  ): Promise<void> {
    // Extract UID from mailId (format: "inbox-1234" or "sent-1234")
    const uidMatch = mailId.match(/^\w+-(\d+)$/)
    const uid = uidMatch ? uidMatch[1] : null
    if (!uid) throw new Error(`无效的邮件 ID: ${mailId}`)

    const sourceFolderCandidates = sourceFolder === 'inbox' ? ['INBOX'] : SENT_FOLDER_CANDIDATES
    const stageRef: ImapStageRef = {
      current: 'prepare',
      connectOkLogged: false,
      authStartLogged: false,
      authOkLogged: false,
    }

    const authUser = resolveAuthUser(config)
    const tlsOpts = buildTlsOpts(config)
    const client = createSafeImapFlow({
      host: config.providerType === 'internal-imap' ? INTERNAL_MAIL_CONFIG.fallbackIp : config.imapHost,
      port: config.imapPort,
      secure: config.imapSecure,
      auth: { user: authUser, pass: config.password },
      logger: createImapLogger(config, 'trash', stageRef),
      ...tlsOpts,
      ...IMAP_OPTIONS,
    }, config, 'trash', stageRef)

    try {
      stageRef.current = 'connect'
      await client.connect()

      // Open source folder (writable)
      stageRef.current = 'mailbox'
      let openedFolder = ''
      for (const folder of sourceFolderCandidates) {
        try {
          await client.mailboxOpen(folder, { readOnly: false })
          openedFolder = folder
          break
        } catch {
          continue
        }
      }
      if (!openedFolder) throw new Error('无法打开源邮件夹，邮件删除失败')

      // Discover trash folder via IMAP LIST (special-use \Trash first, then name fallback)
      stageRef.current = 'fetch'
      let trashFolder = ''
      try {
        const folders = await client.list()
        for (const f of folders) {
          if (
            (f as unknown as Record<string, unknown>).specialUse === '\\Trash' ||
            (f.flags instanceof Set && f.flags.has('\\Trash'))
          ) {
            trashFolder = f.path
            break
          }
        }
        if (!trashFolder) {
          const nameSet = new Set(folders.map((f) => f.path))
          for (const candidate of TRASH_FOLDER_CANDIDATES) {
            if (nameSet.has(candidate)) { trashFolder = candidate; break }
          }
        }
      } catch {
        // list() failed — proceed without a specific trash folder
      }

      // Move message to trash (or flag \Deleted as last resort)
      try {
        if (trashFolder) {
          await (client as unknown as {
            messageMove(range: string, dest: string, opts: { uid: boolean }): Promise<unknown>
          }).messageMove(uid, trashFolder, { uid: true })
        } else {
          await (client as unknown as {
            messageFlagsAdd(range: string, flags: string[], opts: { uid: boolean }): Promise<unknown>
          }).messageFlagsAdd(uid, ['\\Deleted'], { uid: true })
        }
      } catch {
        // Fallback: copy to trash + flag deleted
        if (trashFolder) {
          try {
            await (client as unknown as {
              messageCopy(range: string, dest: string, opts: { uid: boolean }): Promise<unknown>
            }).messageCopy(uid, trashFolder, { uid: true })
            await (client as unknown as {
              messageFlagsAdd(range: string, flags: string[], opts: { uid: boolean }): Promise<unknown>
            }).messageFlagsAdd(uid, ['\\Deleted'], { uid: true })
          } catch (fallbackErr) {
            throw new Error(`删除邮件失败：${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`)
          }
        } else {
          throw new Error('删除邮件失败：服务器不支持 MOVE 且未找到回收站文件夹')
        }
      }
    } finally {
      stageRef.current = 'logout'
      try { await client.logout() } catch { /* ignore */ }
    }
  }

  async restoreMessageToInbox(
    config: EmailAccountConfig,
    mailId: string,
    sourceFolder: 'trash' | 'spam',
  ): Promise<void> {
    const uidMatch = mailId.match(/^\w+-(\d+)$/)
    const uid = uidMatch ? uidMatch[1] : null
    if (!uid) throw new Error(`无效的邮件 ID: ${mailId}`)

    const sourceFolderCandidates = sourceFolder === 'spam' ? SPAM_FOLDER_CANDIDATES : TRASH_FOLDER_CANDIDATES
    const stageRef: ImapStageRef = {
      current: 'prepare',
      connectOkLogged: false,
      authStartLogged: false,
      authOkLogged: false,
    }
    const authUser = resolveAuthUser(config)
    const tlsOpts = buildTlsOpts(config)
    const client = createSafeImapFlow({
      host: config.providerType === 'internal-imap' ? INTERNAL_MAIL_CONFIG.fallbackIp : config.imapHost,
      port: config.imapPort,
      secure: config.imapSecure,
      auth: { user: authUser, pass: config.password },
      logger: createImapLogger(config, 'restore', stageRef),
      ...tlsOpts,
      ...IMAP_OPTIONS,
    }, config, 'restore', stageRef)

    try {
      stageRef.current = 'connect'
      await client.connect()

      stageRef.current = 'mailbox'
      let openedFolder = ''
      for (const folder of sourceFolderCandidates) {
        try {
          await client.mailboxOpen(folder, { readOnly: false })
          openedFolder = folder
          break
        } catch {
          continue
        }
      }
      if (!openedFolder) throw new Error('无法打开可恢复邮件夹')

      try {
        await (client as unknown as {
          messageMove(range: string, dest: string, opts: { uid: boolean }): Promise<unknown>
        }).messageMove(uid, 'INBOX', { uid: true })
      } catch {
        await (client as unknown as {
          messageCopy(range: string, dest: string, opts: { uid: boolean }): Promise<unknown>
          messageFlagsAdd(range: string, flags: string[], opts: { uid: boolean }): Promise<unknown>
        }).messageCopy(uid, 'INBOX', { uid: true })
        await (client as unknown as {
          messageFlagsAdd(range: string, flags: string[], opts: { uid: boolean }): Promise<unknown>
        }).messageFlagsAdd(uid, ['\\Deleted'], { uid: true })
      }
    } finally {
      stageRef.current = 'logout'
      try { await client.logout() } catch { /* ignore */ }
    }
  }

  /* ---------- school Exchange auto-probe ---------- */

  /**
   * Probe CUHK Exchange (or any IMAP+SMTP server) with multiple encryption modes
   * to find the first working combination.
   *
   * IMAP probe order: STARTTLS → none → SSL
   * SMTP probe order: STARTTLS → none → SSL
   *
   * Uses rejectUnauthorized:false during probing so TLS cert issues do not mask
   * auth/connectivity problems.  The saved config should use normal cert validation.
   */
  async autoProbeSchoolExchange(params: {
    email: string
    password: string
    imapHost: string
    imapPort: number
    smtpHost: string
    smtpPort: number
  }): Promise<{
    ok: boolean
    imapEncryption?: 'starttls' | 'none' | 'ssl'
    smtpEncryption?: 'starttls' | 'none' | 'ssl'
    probeResults: Array<{ protocol: 'imap' | 'smtp'; mode: 'starttls' | 'none' | 'ssl'; ok: boolean; message: string }>
  }> {
    if (!params.password) {
      return { ok: false, probeResults: [{ protocol: 'imap', mode: 'starttls', ok: false, message: '密码不能为空，请先填写密码再测试连接。' }] }
    }

    const probeResults: Array<{ protocol: 'imap' | 'smtp'; mode: 'starttls' | 'none' | 'ssl'; ok: boolean; message: string }> = []

    // Build a minimal dummy config for the logger helpers
    const baseConfig: EmailAccountConfig = {
      user: params.email,
      password: '',  // never logged
      displayName: '',
      imapHost: params.imapHost,
      imapPort: params.imapPort,
      imapSecure: false,
      smtpHost: params.smtpHost,
      smtpPort: params.smtpPort,
      smtpSecure: false,
      provider: 'school_cuhk_exchange_imap_smtp',
    }

    const PROBE_TIMEOUT = { connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 10000 }

    // --- IMAP probes ---
    let imapEncryption: 'starttls' | 'none' | 'ssl' | undefined
    for (const mode of ['starttls', 'none', 'ssl'] as const) {
      const secure = mode === 'ssl'
      const stageRef: ImapStageRef = { current: 'connect', connectOkLogged: false, authStartLogged: false, authOkLogged: false }
      const probeConfig = { ...baseConfig, imapSecure: secure }
      const client = createSafeImapFlow({
        host: params.imapHost,
        port: params.imapPort,
        secure,
        auth: { user: params.email, pass: params.password },
        logger: createImapLogger(probeConfig, `PROBE-IMAP-${mode}`, stageRef),
        tls: { rejectUnauthorized: false },
        ...PROBE_TIMEOUT,
      }, probeConfig, `PROBE-IMAP-${mode}`, stageRef)
      try {
        await client.connect()
        await client.logout()
        probeResults.push({ protocol: 'imap', mode, ok: true, message: `IMAP ${mode.toUpperCase()} 连接成功` })
        if (!imapEncryption) imapEncryption = mode
      } catch (err) {
        probeResults.push({ protocol: 'imap', mode, ok: false, message: friendlyErrorMessage(err, 'school_cuhk_exchange_imap_smtp') })
      }
    }

    // --- SMTP probes ---
    let smtpEncryption: 'starttls' | 'none' | 'ssl' | undefined
    for (const mode of ['starttls', 'none', 'ssl'] as const) {
      const secure = mode === 'ssl'
      const ignoreTLS = mode === 'none'
      const requireTLS = mode === 'starttls'
      try {
        const transporter = nodemailer.createTransport({
          host: params.smtpHost,
          port: params.smtpPort,
          secure,
          auth: { user: params.email, pass: params.password },
          ...(ignoreTLS ? { ignoreTLS: true } : {}),
          ...(requireTLS ? { requireTLS: true } : {}),
          connectionTimeout: 8000,
          greetingTimeout: 8000,
          socketTimeout: 10000,
          tls: { rejectUnauthorized: false },
        })
        await transporter.verify()
        probeResults.push({ protocol: 'smtp', mode, ok: true, message: `SMTP ${mode.toUpperCase()} 连接成功` })
        if (!smtpEncryption) smtpEncryption = mode
      } catch (err) {
        probeResults.push({ protocol: 'smtp', mode, ok: false, message: friendlySmtpErrorMessage(err, 'school_cuhk_exchange_imap_smtp') })
      }
    }

    const ok = Boolean(imapEncryption && smtpEncryption)
    return { ok, imapEncryption, smtpEncryption, probeResults }
  }
}
