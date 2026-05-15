const DEFAULT_BACKEND_URL = 'local://electron-main'

const viteEnv = (import.meta as unknown as { env?: Record<string, string | boolean | undefined> }).env

function readBooleanEnv(value: string | boolean | undefined, defaultValue: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return defaultValue

  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return defaultValue
}

export const DISABLE_FORCE_PASSWORD_CHANGE = readBooleanEnv(
  viteEnv?.VITE_DISABLE_FORCE_PASSWORD_CHANGE,
  true,
)

/**
 * 演示开关：是否允许所有登录用户互相查看/生成日报。
 * 默认 true（演示模式）。正式环境设为 false 可恢复原有权限逻辑。
 * 对应环境变量：VITE_ALLOW_ALL_WORK_REPORTS
 */
export const ALLOW_ALL_WORK_REPORTS = readBooleanEnv(
  viteEnv?.VITE_ALLOW_ALL_WORK_REPORTS,
  true,
)

export function isForcePasswordChangeRequired(user: { mustChangePassword?: boolean }): boolean {
  return Boolean(user.mustChangePassword) && !DISABLE_FORCE_PASSWORD_CHANGE
}

export function getBackendUrl(): string {
  return localStorage.getItem('ai_writer_backend_url') || DEFAULT_BACKEND_URL
}

export function setBackendUrl(url: string) {
  localStorage.setItem('ai_writer_backend_url', url || DEFAULT_BACKEND_URL)
}

export function getExperimentalPaperBackendUrl(): string {
  return getBackendUrl()
}
