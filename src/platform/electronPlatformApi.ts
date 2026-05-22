import type { PlatformApi, AuthResult, UserInfo } from './types'

type ElectronApiShape = {
  internalAccountGetToken?: () => Promise<string | null>
  internalAccountClearToken?: () => Promise<void>
  [key: string]: unknown
}

function getElectronApi(): ElectronApiShape {
  return (window as unknown as { electronAPI: ElectronApiShape }).electronAPI
}

/**
 * Electron implementation of PlatformApi.
 *
 * Auth delegates to the existing internalAccount IPC handlers where available.
 * Registration is not supported in Electron (accounts are managed externally).
 */
export const electronPlatformApi: PlatformApi = {
  platform: 'electron',

  auth: {
    async login(email: string, _password: string): Promise<AuthResult> {
      const api = getElectronApi()
      const token =
        typeof api.internalAccountGetToken === 'function'
          ? await api.internalAccountGetToken()
          : null
      return {
        token: token ?? 'electron-session',
        user: { id: 'electron-user', email, name: 'Local User' },
      }
    },

    async register(
      _email: string,
      _password: string,
      _name: string,
    ): Promise<AuthResult> {
      throw new Error('Registration is not supported in Electron mode.')
    },

    async logout(): Promise<void> {
      const api = getElectronApi()
      if (typeof api.internalAccountClearToken === 'function') {
        await api.internalAccountClearToken()
      }
    },

    getCurrentUser(): UserInfo | null {
      // Electron manages its own session via internalAccount; return null here.
      return null
    },

    getToken(): string | null {
      return null
    },
  },
}
