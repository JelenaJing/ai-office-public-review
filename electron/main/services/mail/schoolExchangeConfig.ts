/**
 * CUHK School Exchange server constants.
 *
 * Applies ONLY to @cuhk.edu.cn (faculty/staff).
 * Does NOT apply to @link.cuhk.edu.cn (students — separate Microsoft 365 system).
 *
 * Source: ITSO confirmation, June 2025.
 */

export type SchoolEncryptionMode = 'starttls' | 'none' | 'ssl'

export const SCHOOL_CUHK_EXCHANGE_CONFIG = {
  domain: 'cuhk.edu.cn',
  /** Applies ONLY to this suffix; @link.cuhk.edu.cn is a different system */
  emailSuffix: '@cuhk.edu.cn',
  host: 'mail.cuhk.edu.cn',
  imap: {
    port: 143,
    /** Probe order recommended by ITSO */
    probeOrder: ['starttls', 'none', 'ssl'] as SchoolEncryptionMode[],
  },
  smtp: {
    port: 587,
    /** Probe order recommended by ITSO */
    probeOrder: ['starttls', 'none', 'ssl'] as SchoolEncryptionMode[],
  },
  /** Username is always the full email address for Exchange */
  usernamePolicy: 'full_email' as const,
  /** Sender must equal the authenticated account — no spoofing */
  fromPolicy: 'same_as_login' as const,
} as const
