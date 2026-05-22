export type Platform = 'electron' | 'web'

/**
 * Detects the current runtime environment.
 *
 * Returns 'electron' when the Electron preload script has injected
 * window.electronAPI into the renderer process; otherwise returns 'web'.
 */
export function detectPlatform(): Platform {
  if (
    typeof window !== 'undefined' &&
    (window as unknown as { electronAPI?: unknown }).electronAPI !== undefined
  ) {
    return 'electron'
  }
  return 'web'
}
