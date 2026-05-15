import type { EmailAccountConfig } from '../../../types/email'

/** Resolve a stable accountId string from an email account config. */
export function resolveEmailAccountId(config: EmailAccountConfig): string {
  return config.user || config.email || 'local-account'
}
