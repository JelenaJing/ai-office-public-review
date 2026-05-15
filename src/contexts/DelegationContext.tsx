/**
 * DelegationContext — AI 托管（下班托管）状态管理
 *
 * 管理员工的 AI 托管状态：
 * - 开启/关闭托管
 * - 上传今日工作快照
 * - 托管状态持久化
 * - 待审核自动回复队列
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type {
  DelegationState,
  PendingAutoReply,
  UserPresenceStatus,
  WorkReportUploadPayload,
} from '../types/delegation'

// ─── Context shape ─────────────────────────────────────────────────────────

export interface DelegationContextValue {
  /** Current delegation state from backend */
  delegationState: DelegationState | null
  /** Whether user is currently in AI delegation mode */
  isActive: boolean
  /** Current presence status */
  presenceStatus: UserPresenceStatus
  /** Whether the delegation enable flow is running */
  isEnabling: boolean
  /** Whether the delegation disable flow is running */
  isDisabling: boolean
  /** Number of pending auto-replies awaiting review */
  pendingReplyCount: number
  /** Pending auto-replies list */
  pendingReplies: PendingAutoReply[]
  /** Last error from delegation operations */
  lastError: string | null
  /**
   * Enable AI delegation. Uploads current workspace snapshot and sets
   * the user presence status to "ai_delegated".
   */
  enableDelegation: (workspacePath: string | null) => Promise<void>
  /** Disable AI delegation and restore online status. */
  disableDelegation: () => Promise<void>
  /** Refresh delegation status from backend. */
  refreshStatus: () => Promise<void>
  /** Refresh pending replies list. */
  refreshPendingReplies: () => Promise<void>
  /** Clear last error */
  clearError: () => void
}

// ─── Context ────────────────────────────────────────────────────────────────

const DelegationContext = createContext<DelegationContextValue | null>(null)

export function useDelegation(): DelegationContextValue {
  const ctx = useContext(DelegationContext)
  if (!ctx) throw new Error('useDelegation must be used inside DelegationProvider')
  return ctx
}

// ─── Provider ───────────────────────────────────────────────────────────────

interface DelegationProviderProps {
  children: ReactNode
  /** Current logged-in user ID */
  userId: string | null
  /** Current username */
  username: string | null
  /** Current workspace path (for snapshot) */
  activeWorkspacePath: string | null
}

export function DelegationProvider({
  children,
  userId,
  username,
  activeWorkspacePath,
}: DelegationProviderProps) {
  const [delegationState, setDelegationState] = useState<DelegationState | null>(null)
  const [isEnabling, setIsEnabling] = useState(false)
  const [isDisabling, setIsDisabling] = useState(false)
  const [pendingReplies, setPendingReplies] = useState<PendingAutoReply[]>([])
  const [lastError, setLastError] = useState<string | null>(null)

  const api = typeof window !== 'undefined' ? window.electronAPI : undefined

  // Load initial status
  const refreshStatus = useCallback(async () => {
    if (!api?.delegationGetStatus) return
    try {
      const result = await api.delegationGetStatus()
      if (result.ok) {
        setDelegationState(result.state)
      }
    } catch {
      // Ignore — delegation is optional
    }
  }, [api])

  const refreshPendingReplies = useCallback(async () => {
    if (!api?.delegationGetPendingReplies) return
    try {
      const result = await api.delegationGetPendingReplies()
      if (result.ok) {
        setPendingReplies(result.replies.filter((r) => r.status === 'pending_review'))
      }
    } catch {
      // Ignore
    }
  }, [api])

  // Load on mount and when userId changes
  useEffect(() => {
    if (!userId) {
      setDelegationState(null)
      setPendingReplies([])
      return
    }
    void refreshStatus()
    void refreshPendingReplies()
  }, [userId, refreshStatus, refreshPendingReplies])

  // Poll for pending replies when in ai_delegated mode
  useEffect(() => {
    if (delegationState?.status !== 'ai_delegated') return
    const interval = setInterval(() => {
      void refreshPendingReplies()
    }, 30_000)
    return () => clearInterval(interval)
  }, [delegationState?.status, refreshPendingReplies])

  const enableDelegation = useCallback(async (workspacePath: string | null) => {
    if (!userId || !api?.delegationEnable) {
      setLastError('请先登录账号')
      return
    }
    setIsEnabling(true)
    setLastError(null)
    try {
      // 1. Take a workspace snapshot (best-effort)
      if (workspacePath && api.activityTakeSnapshot) {
        await api.activityTakeSnapshot(workspacePath).catch(() => undefined)
      }

      // 2. Collect and upload today's activity data
      if (workspacePath && api.activityGetActivity && api.delegationUploadWorkReport) {
        try {
          const today = new Date().toISOString().split('T')[0]
          const activityResult = await api.activityGetActivity({
            workspacePath,
            date: today,
          })
          const fileSummaries = activityResult.ok
            ? [
                ...activityResult.diff.created,
                ...activityResult.diff.modified,
                ...activityResult.diff.deleted,
              ].map((f) => ({
                fileName: f.fileName,
                changeType: f.changeType as 'created' | 'modified' | 'deleted',
                topic: '',
                summary: `${f.changeType} — ${f.relativePath}`,
                workType: 'other',
              }))
            : []

          const uploadPayload: WorkReportUploadPayload = {
            userId,
            date: today,
            fileSummaries,
            emailActivity: { received: 0, sent: 0, drafts: 0, threadSummaries: [] },
            chatActivity: { messagesSent: 0, messagesReceived: 0, conversationCount: 0 },
            aiUsage: { totalRequests: 0, modes: [], tasksCompleted: 0 },
            workspacePath,
          }
          await api.delegationUploadWorkReport(uploadPayload).catch(() => undefined)
        } catch {
          // Activity upload failure should not block delegation enable
        }
      }

      // 3. Enable delegation on backend
      const result = await api.delegationEnable({
        userId,
        workspacePath: workspacePath ?? '',
        policyId: 'default',
      })
      if (result.ok) {
        setDelegationState(result.state)
      } else {
        setLastError(result.error || '开启托管失败')
      }
    } catch (err) {
      setLastError(err instanceof Error ? err.message : '开启托管失败')
    } finally {
      setIsEnabling(false)
    }
  }, [userId, api, activeWorkspacePath])

  const disableDelegation = useCallback(async () => {
    if (!userId || !api?.delegationDisable) return
    setIsDisabling(true)
    setLastError(null)
    try {
      const result = await api.delegationDisable({ userId })
      if (result.ok) {
        setDelegationState(result.state)
      } else {
        setLastError(result.error || '关闭托管失败')
      }
    } catch (err) {
      setLastError(err instanceof Error ? err.message : '关闭托管失败')
    } finally {
      setIsDisabling(false)
    }
  }, [userId, api])

  const clearError = useCallback(() => setLastError(null), [])

  const isActive = delegationState?.status === 'ai_delegated'
  const presenceStatus: UserPresenceStatus = delegationState?.status ?? 'online'

  const value = useMemo<DelegationContextValue>(
    () => ({
      delegationState,
      isActive,
      presenceStatus,
      isEnabling,
      isDisabling,
      pendingReplyCount: pendingReplies.length,
      pendingReplies,
      lastError,
      enableDelegation,
      disableDelegation,
      refreshStatus,
      refreshPendingReplies,
      clearError,
    }),
    [
      delegationState,
      isActive,
      presenceStatus,
      isEnabling,
      isDisabling,
      pendingReplies,
      lastError,
      enableDelegation,
      disableDelegation,
      refreshStatus,
      refreshPendingReplies,
      clearError,
    ],
  )

  return (
    <DelegationContext.Provider value={value}>
      {children}
    </DelegationContext.Provider>
  )
}
