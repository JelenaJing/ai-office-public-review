/**
 * CredentialService — secure password storage using Electron safeStorage.
 *
 * Passwords are AES-256 encrypted by the OS keychain (Windows DPAPI / macOS
 * Keychain / Linux libsecret) and stored as binary files in userData.
 * The plaintext password NEVER appears in JSON config files or logs.
 *
 * Usage:
 *   const svc = new CredentialService(app.getPath('userData'))
 *   await svc.saveCredential('user@example.com', 'secret')
 *   const pw = await svc.getCredential('user@example.com')
 *   await svc.deleteCredential('user@example.com')
 */
import { safeStorage } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'

export class CredentialService {
  private readonly credDir: string

  constructor(userDataPath: string) {
    this.credDir = path.join(userDataPath, 'email-credentials')
  }

  /** Derive a safe filename from the credential reference (e.g. an email address). */
  private refToFilename(ref: string): string {
    return `cred-${ref.replace(/[^a-zA-Z0-9@._-]/g, '_')}.bin`
  }

  private credPath(ref: string): string {
    return path.join(this.credDir, this.refToFilename(ref))
  }

  /** Encrypt and persist a credential. */
  async saveCredential(ref: string, password: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('系统加密不可用，无法安全存储密码（需要 Windows DPAPI / macOS Keychain / Linux libsecret）。')
    }
    const encrypted = safeStorage.encryptString(password)
    await fs.mkdir(this.credDir, { recursive: true })
    await fs.writeFile(this.credPath(ref), encrypted)
  }

  /** Decrypt and return a stored credential, or null if not found. */
  async getCredential(ref: string): Promise<string | null> {
    if (!safeStorage.isEncryptionAvailable()) return null
    try {
      const buf = await fs.readFile(this.credPath(ref))
      return safeStorage.decryptString(buf)
    } catch {
      return null
    }
  }

  /** Delete a stored credential (no-op if it doesn't exist). */
  async deleteCredential(ref: string): Promise<void> {
    try {
      await fs.unlink(this.credPath(ref))
    } catch {
      // ignore – file may not exist
    }
  }
}
