export interface ManuscriptTabState {
  ownerLabel: string | null
  currentArtifactKey: string | null
  acceptedArtifactKey: string | null
  currentCompatHtml: string
  acceptedCompatHtml: string
}

export interface UpdateManuscriptTabStateInput {
  ownerLabel?: string | null
  currentArtifactKey?: string | null
  acceptedArtifactKey?: string | null
  currentCompatHtml?: string
  acceptedCompatHtml?: string
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const normalized = String(value || '').trim()
  return normalized || null
}

function normalizeCompatHtml(value: string | undefined): string | undefined {
  return value === undefined ? undefined : String(value || '')
}

export function createManuscriptTabState(input?: UpdateManuscriptTabStateInput): ManuscriptTabState {
  const currentCompatHtml = normalizeCompatHtml(input?.currentCompatHtml) || ''
  const currentArtifactKey = normalizeOptionalString(input?.currentArtifactKey)
  const acceptedArtifactKey = input?.acceptedArtifactKey !== undefined
    ? normalizeOptionalString(input.acceptedArtifactKey)
    : currentArtifactKey
  const acceptedCompatHtml = normalizeCompatHtml(input?.acceptedCompatHtml)
    ?? (acceptedArtifactKey === currentArtifactKey ? currentCompatHtml : '')

  return {
    ownerLabel: input?.ownerLabel === undefined ? null : normalizeOptionalString(input.ownerLabel),
    currentArtifactKey,
    acceptedArtifactKey,
    currentCompatHtml,
    acceptedCompatHtml,
  }
}

export function updateManuscriptTabState(
  current: ManuscriptTabState | null | undefined,
  input: UpdateManuscriptTabStateInput,
): ManuscriptTabState {
  const previous = current || createManuscriptTabState()
  const nextCurrentArtifactKey = input.currentArtifactKey !== undefined
    ? normalizeOptionalString(input.currentArtifactKey)
    : previous.currentArtifactKey
  const nextAcceptedArtifactKey = input.acceptedArtifactKey !== undefined
    ? normalizeOptionalString(input.acceptedArtifactKey)
    : previous.acceptedArtifactKey
  const nextCurrentCompatHtml = normalizeCompatHtml(input.currentCompatHtml) ?? previous.currentCompatHtml
  let nextAcceptedCompatHtml = normalizeCompatHtml(input.acceptedCompatHtml) ?? previous.acceptedCompatHtml

  if (input.acceptedArtifactKey !== undefined && input.acceptedCompatHtml === undefined && nextAcceptedArtifactKey === nextCurrentArtifactKey) {
    nextAcceptedCompatHtml = nextCurrentCompatHtml
  }

  return {
    ownerLabel: input.ownerLabel === undefined ? previous.ownerLabel : normalizeOptionalString(input.ownerLabel),
    currentArtifactKey: nextCurrentArtifactKey,
    acceptedArtifactKey: nextAcceptedArtifactKey,
    currentCompatHtml: nextCurrentCompatHtml,
    acceptedCompatHtml: nextAcceptedCompatHtml,
  }
}

export function discardManuscriptTabState(current: ManuscriptTabState | null | undefined): ManuscriptTabState {
  const previous = current || createManuscriptTabState()
  return {
    ...previous,
    currentArtifactKey: previous.acceptedArtifactKey,
    currentCompatHtml: previous.acceptedCompatHtml,
  }
}

export function resolveManuscriptTabDirty(state: ManuscriptTabState | null | undefined): boolean {
  if (!state) return false
  return state.currentArtifactKey !== state.acceptedArtifactKey
}

export function projectManuscriptTabShellSnapshot(state: ManuscriptTabState | null | undefined): {
  content: string
  savedContent: string
  dirty: boolean
} {
  const current = state || createManuscriptTabState()
  return {
    content: current.currentCompatHtml,
    savedContent: current.acceptedCompatHtml,
    dirty: resolveManuscriptTabDirty(current),
  }
}