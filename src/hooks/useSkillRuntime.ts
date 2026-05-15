/**
 * useSkillRuntime — React hook wrapping the Skill execution engine
 *
 * Usage:
 *   const { execute, result, loading, error } = useSkillRuntime()
 *   await execute({ skillId: 'image.generate.default', input: { prompt: '...' }, context: {} })
 */
import { useCallback, useState } from 'react'
import { executeSkill } from '../skills/runtime'
import type { SkillExecutionRequest, SkillExecutionResult } from '../skills/types'
import { useWorkspace } from '../contexts/WorkspaceContext'

export interface UseSkillRuntimeReturn {
  execute: (request: SkillExecutionRequest) => Promise<SkillExecutionResult>
  result: SkillExecutionResult | null
  loading: boolean
  error: string | null
  reset: () => void
}

export function useSkillRuntime(): UseSkillRuntimeReturn {
  const { activeWorkspacePath } = useWorkspace()
  const [result, setResult] = useState<SkillExecutionResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const execute = useCallback(
    async (request: SkillExecutionRequest): Promise<SkillExecutionResult> => {
      setLoading(true)
      setError(null)

      // Auto-inject workspacePath if not provided
      const enrichedRequest: SkillExecutionRequest = {
        ...request,
        context: {
          workspacePath: activeWorkspacePath ?? undefined,
          ...request.context,
        },
      }

      const res = await executeSkill(enrichedRequest)
      setResult(res)
      if (res.status === 'failed') {
        setError(res.error?.message ?? '执行失败')
      }
      setLoading(false)
      return res
    },
    [activeWorkspacePath],
  )

  const reset = useCallback(() => {
    setResult(null)
    setError(null)
    setLoading(false)
  }, [])

  return { execute, result, loading, error, reset }
}
