export function isDirectMode(): boolean {
  return false
}

export async function directContinueWriting(..._args: unknown[]): Promise<void> {
  throw new Error('direct mode is disabled in AI-Office 3.0 local compatibility mode')
}