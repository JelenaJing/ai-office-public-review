/**
 * Internal mail server constants for AI-Office.
 *
 * TCP connections always go directly to fallbackIp (10.20.5.61), bypassing DNS.
 * logicalHost is sent as TLS SNI so the mail server presents the correct cert
 * and routes to the right virtual host.
 * rejectUnauthorized is false for internal-imap accounts (self-signed cert).
 */
export const INTERNAL_MAIL_CONFIG = {
  domain: 'ai.cuhk.edu.cn',
  /** Sent as TLS SNI — must match the server certificate CN */
  logicalHost: 'mail.ai.cuhk.edu.cn',
  /** Actual TCP connection target — bypasses DNS entirely */
  fallbackIp: '10.20.5.61',
  imap: {
    port: 993,
    secure: true,
  },
  smtp: {
    port: 465,
    secure: true,
    starttls: false,
  },
} as const
