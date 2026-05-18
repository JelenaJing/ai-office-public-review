/**
 * workflowClient.ts
 * Unified client for all Flowable workflow API calls.
 * All fetch calls to the workflow backend go through here — never directly in components.
 */

const WORKFLOW_BASE_URL =
  (import.meta.env.VITE_WORKFLOW_BASE_URL as string | undefined) || 'http://localhost:4080'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StartEmailWorkflowInput {
  sourceType: 'email'
  emailId: string
  threadId: string
  subject: string
  sender: string
  requesterId: string
  assignee: string
  priority: 'urgent' | 'important' | 'normal'
  category: string
  aiSummary: string
  attachmentIds: string[]
  workspaceId: string
}

export interface StartEmailWorkflowResult {
  processInstanceId: string
  status: string
}

export interface WorkflowTask {
  taskId: string
  taskName: string
  processInstanceId: string
  businessKey: string | null
  assignee: string
  subject: string | null
  sender: string | null
  priority: string | null
  category: string | null
  aiSummary: string | null
  createTime: string | null
}

export interface CompleteWorkflowTaskInput {
  decision: 'approve' | 'reject'
  comment: string
  operatorId: string
}

export interface CompleteWorkflowTaskResult {
  taskId: string
  status: string
  decision: string
}

export interface WorkflowInstance {
  processInstanceId: string
  businessKey: string | null
  processDefinitionKey: string | null
  status: 'active' | 'completed'
  startTime?: string | null
  endTime?: string | null
  variables?: Record<string, unknown>
  error?: string
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${WORKFLOW_BASE_URL}${path}`
  let res: Response
  try {
    res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      ...init,
    })
  } catch (networkErr) {
    throw new Error(`Flowable 服务不可用，请先启动 aioffice-workflow-service。（${String(networkErr)}）`)
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { message?: string; error?: string }
      msg = body.message || body.error || msg
    } catch {
      // ignore parse error, keep HTTP status message
    }
    throw new Error(`Workflow API error: ${msg}`)
  }
  return res.json() as Promise<T>
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** GET /api/workflows/health */
export async function checkWorkflowHealth(): Promise<{ status: string; service: string }> {
  return apiRequest('/api/workflows/health')
}

/** POST /api/workflows/email/start */
export async function startEmailWorkflow(
  input: StartEmailWorkflowInput,
): Promise<StartEmailWorkflowResult> {
  return apiRequest('/api/workflows/email/start', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/** GET /api/workflows/tasks/my?assignee={assignee} */
export async function getMyWorkflowTasks(assignee: string): Promise<WorkflowTask[]> {
  return apiRequest(`/api/workflows/tasks/my?assignee=${encodeURIComponent(assignee)}`)
}

/** POST /api/workflows/tasks/{taskId}/complete */
export async function completeWorkflowTask(
  taskId: string,
  input: CompleteWorkflowTaskInput,
): Promise<CompleteWorkflowTaskResult> {
  return apiRequest(`/api/workflows/tasks/${encodeURIComponent(taskId)}/complete`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/** GET /api/workflows/instances/{processInstanceId} */
export async function getWorkflowInstance(processInstanceId: string): Promise<WorkflowInstance> {
  return apiRequest(`/api/workflows/instances/${encodeURIComponent(processInstanceId)}`)
}
