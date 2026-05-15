export type UnsavedDialogDecision = 'save' | 'discard' | 'cancel'
export type AppCloseResolution = 'close' | 'cancel'

interface HandlePendingAppCloseRequestOptions {
  hasUnsavedChanges: boolean
  promptForUnsavedChanges: () => Promise<UnsavedDialogDecision>
  discardUnsavedChanges: () => void
  resolveCloseRequest: (resolution: AppCloseResolution) => Promise<void> | void
}

export async function handlePendingAppCloseRequest(options: HandlePendingAppCloseRequestOptions): Promise<AppCloseResolution> {
  if (!options.hasUnsavedChanges) {
    await options.resolveCloseRequest('close')
    return 'close'
  }

  const decision = await options.promptForUnsavedChanges()
  if (decision === 'discard') {
    options.discardUnsavedChanges()
  }

  const resolution: AppCloseResolution = decision === 'cancel' ? 'cancel' : 'close'
  await options.resolveCloseRequest(resolution)
  return resolution
}