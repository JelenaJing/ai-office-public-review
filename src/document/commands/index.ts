export type ManuscriptCommandId = 'generate_full_body' | 'rewrite_selection' | 'expand_selection' | 'continue_writing' | 'insert_citation' | 'insert_image'
export type ManuscriptTargetScope = 'whole_document' | 'selection'
export type ManuscriptProfileId = 'freewrite' | 'paper' | 'templateDocument'

export interface ManuscriptCommandPayload extends Record<string, unknown> {
  instruction?: string
  selectionText?: string
  selectionRange?: { from: number; to: number }
  selectionAnchor?: Record<string, unknown>
  autoRun?: boolean
  flow?: string
  targetTabId?: string
}

export interface ManuscriptCommand {
  id: ManuscriptCommandId
  profile: ManuscriptProfileId
  targetScope?: ManuscriptTargetScope
  trigger?: string
  payload: ManuscriptCommandPayload
}

export interface RoutedManuscriptCommand extends ManuscriptCommand {
  executorId: string
  adapterRoute: 'open_composer' | 'rewrite_selection' | 'expand_selection' | 'continue_writing' | 'insert_citation' | 'insert_image'
}

function resolveExecutorId(profile: ManuscriptProfileId): string {
  return `compat:${profile}`
}

function resolveAdapterRoute(command: ManuscriptCommand): RoutedManuscriptCommand['adapterRoute'] {
  if (command.id === 'generate_full_body') return 'open_composer'
  if (command.id === 'rewrite_selection') return 'rewrite_selection'
  if (command.id === 'expand_selection') return 'expand_selection'
  if (command.id === 'continue_writing') return 'continue_writing'
  if (command.id === 'insert_citation') return 'insert_citation'
  return 'insert_image'
}

export function createManuscriptCommand(command: ManuscriptCommand): ManuscriptCommand {
  return command
}

export function routeManuscriptCommand(command: unknown): { ok: true; command: RoutedManuscriptCommand } | { ok: false; error: string } {
  if (!command || typeof command !== 'object') {
    return { ok: false, error: '无效的编辑命令' }
  }

  const candidate = command as Partial<ManuscriptCommand>
  if (!candidate.id) return { ok: false, error: '缺少命令 ID' }
  if (!candidate.profile) return { ok: false, error: '缺少命令 profile' }

  const normalized: ManuscriptCommand = {
    id: candidate.id,
    profile: candidate.profile,
    targetScope: candidate.targetScope || 'whole_document',
    trigger: candidate.trigger || 'unknown',
    payload: (candidate.payload || {}) as ManuscriptCommandPayload,
  }

  return {
    ok: true,
    command: {
      ...normalized,
      executorId: resolveExecutorId(normalized.profile),
      adapterRoute: resolveAdapterRoute(normalized),
    },
  }
}

export function getPrimaryManuscriptCommandLabels(): Record<string, string> {
  return {
    generate_full_body: '全文生成',
    rewrite_selection: '重写选中文本',
    expand_selection: 'AI 扩写',
    continue_writing: 'AI 续写',
    insert_citation: '查找文献并插入',
    insert_image: '生成图片',
  }
}