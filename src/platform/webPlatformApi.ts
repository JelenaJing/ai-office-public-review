import type { PlatformApi, AuthResult, UserInfo } from './types'

const TOKEN_KEY = 'aios_auth_token'
const USER_KEY = 'aios_auth_user'

function getApiBase(): string {
  const envUrl = (import.meta.env as Record<string, string | undefined>)
    .VITE_API_URL
  return envUrl ?? 'http://localhost:3001'
}

async function apiPost<T>(
  path: string,
  body: unknown,
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`${getApiBase()}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const payload = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error(
      (payload as { message?: string }).message ?? res.statusText,
    )
  }

  return res.json() as Promise<T>
}

/**
 * Web implementation of PlatformApi.
 *
 * Auth uses HTTP calls to the AIOS backend server.
 * Tokens and user info are persisted to localStorage.
 */
export const webPlatformApi: PlatformApi = {
  platform: 'web',

  auth: {
    async login(email: string, password: string): Promise<AuthResult> {
      const result = await apiPost<AuthResult>('/api/auth/login', {
        email,
        password,
      })
      localStorage.setItem(TOKEN_KEY, result.token)
      localStorage.setItem(USER_KEY, JSON.stringify(result.user))
      return result
    },

    async register(
      email: string,
      password: string,
      name: string,
    ): Promise<AuthResult> {
      const result = await apiPost<AuthResult>('/api/auth/register', {
        email,
        password,
        name,
      })
      localStorage.setItem(TOKEN_KEY, result.token)
      localStorage.setItem(USER_KEY, JSON.stringify(result.user))
      return result
    },

    async logout(): Promise<void> {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(USER_KEY)
    },

    getCurrentUser(): UserInfo | null {
      const raw = localStorage.getItem(USER_KEY)
      if (!raw) return null
      try {
        return JSON.parse(raw) as UserInfo
      } catch {
        return null
      }
    },

    getToken(): string | null {
      return localStorage.getItem(TOKEN_KEY)
    },
  },
}
