/**
 * WorkflowTasksPanel.tsx
 * Lightweight slide-in panel showing Flowable pending tasks for approver-001.
 * Keeps all workflow UI out of the 4000-line CommunicationWorkbench.
 */
import React from 'react'
import styled from 'styled-components'
import type { WorkflowTask } from '../../services/workflowClient'

// ─── Styled components ────────────────────────────────────────────────────────

const Overlay = styled.div`
  position: fixed; inset: 0; z-index: 900;
  background: rgba(0,0,0,0.25);
  display: flex; align-items: flex-start; justify-content: flex-end;
`

const Card = styled.div`
  width: 480px; max-width: 95vw; height: 100%; max-height: 100vh;
  background: #fff; box-shadow: -4px 0 24px rgba(0,0,0,0.12);
  display: flex; flex-direction: column; overflow: hidden;
`

const Header = styled.div`
  padding: 18px 20px 14px;
  border-bottom: 1px solid #e2e8f0;
  display: flex; align-items: center; justify-content: space-between;
  flex-shrink: 0;
`

const Title = styled.div`
  font-size: 15px; font-weight: 700; color: #1a202c;
  display: flex; align-items: center; gap: 6px;
`

const Body = styled.div`flex: 1; overflow-y: auto; padding: 10px 14px;`

const TaskItem = styled.div`
  padding: 12px 14px; border-radius: 8px; margin-bottom: 8px;
  background: #f7fafc; border: 1px solid #e2e8f0;
`

const TaskSubject = styled.div`
  font-size: 13px; font-weight: 700; color: #1a202c; margin-bottom: 4px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`

const TaskMeta = styled.div`
  font-size: 11px; color: #718096; margin-bottom: 6px;
  display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
`

const TaskSummary = styled.div`
  font-size: 11px; color: #4a5568; margin-bottom: 8px; line-height: 1.55;
`

const TaskActions = styled.div`display: flex; gap: 6px;`

const ActionBtn = styled.button<{ $variant: 'approve' | 'reject' | 'neutral' }>`
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 12px; border-radius: 6px; border: none;
  font-size: 11px; font-weight: 600; cursor: pointer; transition: all 0.13s;
  &:disabled { opacity: 0.5; cursor: not-allowed; }
  ${({ $variant }) => {
    if ($variant === 'approve') return 'background:#c6f6d5;color:#276749;&:hover:not(:disabled){background:#9ae6b4;}'
    if ($variant === 'reject')  return 'background:#fed7d7;color:#c53030;&:hover:not(:disabled){background:#feb2b2;}'
    return 'background:#edf2f7;color:#4a5568;&:hover:not(:disabled){background:#e2e8f0;}'
  }}
`

const PriorityBadge = styled.span<{ $p?: string | null }>`
  display: inline-flex; align-items: center;
  padding: 1px 7px; border-radius: 8px; font-size: 11px; font-weight: 600;
  ${({ $p }) => {
    if ($p === 'urgent')    return 'background:#fff5f5;color:#c53030;border:1px solid #fc8181;'
    if ($p === 'important') return 'background:#fffaf0;color:#c05621;border:1px solid #fbd38d;'
    return 'background:#f0fff4;color:#276749;border:1px solid #9ae6b4;'
  }}
`

const StatusMsg = styled.div<{ $variant?: 'error' | 'info' }>`
  font-size: 12px; padding: 6px 0;
  color: ${({ $variant }) => $variant === 'error' ? '#c53030' : '#718096'};
`

// ─── Component ────────────────────────────────────────────────────────────────

interface WorkflowTasksPanelProps {
  tasks: WorkflowTask[]
  loading: boolean
  error: string | null
  completingTaskId: string | null
  onClose: () => void
  onRefresh: () => void
  onApprove: (taskId: string) => void
  onReject: (taskId: string) => void
}

function formatCreateTime(raw: string | null): string {
  if (!raw) return ''
  try {
    return new Date(raw).toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return raw
  }
}

function priorityLabel(p: string | null): string {
  if (p === 'urgent') return '紧急'
  if (p === 'important') return '重要'
  return '普通'
}

export default function WorkflowTasksPanel({
  tasks,
  loading,
  error,
  completingTaskId,
  onClose,
  onRefresh,
  onApprove,
  onReject,
}: WorkflowTasksPanelProps) {
  return (
    <Overlay onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <Card>
        <Header>
          <Title>📋 流程待办</Title>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <ActionBtn $variant="neutral" onClick={onRefresh} disabled={loading}>
              {loading ? '刷新中…' : '🔄 刷新'}
            </ActionBtn>
            <ActionBtn $variant="neutral" onClick={onClose}>✕ 关闭</ActionBtn>
          </div>
        </Header>

        <Body>
          {error && (
            <StatusMsg $variant="error">⚠ {error}</StatusMsg>
          )}
          {loading && tasks.length === 0 && (
            <StatusMsg>加载中…</StatusMsg>
          )}
          {!loading && !error && tasks.length === 0 && (
            <StatusMsg>暂无待办任务</StatusMsg>
          )}
          {tasks.map((task) => (
            <TaskItem key={task.taskId}>
              <TaskSubject>{task.subject || '（无主题）'}</TaskSubject>
              <TaskMeta>
                {task.sender && <span>发件人：{task.sender}</span>}
                {task.priority && (
                  <PriorityBadge $p={task.priority}>{priorityLabel(task.priority)}</PriorityBadge>
                )}
                {task.category && <span>{task.category}</span>}
                {task.createTime && <span>{formatCreateTime(task.createTime)}</span>}
              </TaskMeta>
              {task.aiSummary && (
                <TaskSummary>{task.aiSummary}</TaskSummary>
              )}
              <TaskActions>
                <ActionBtn
                  $variant="approve"
                  disabled={completingTaskId === task.taskId}
                  onClick={() => onApprove(task.taskId)}
                >
                  {completingTaskId === task.taskId ? '处理中…' : '✔ 通过'}
                </ActionBtn>
                <ActionBtn
                  $variant="reject"
                  disabled={completingTaskId === task.taskId}
                  onClick={() => onReject(task.taskId)}
                >
                  {completingTaskId === task.taskId ? '处理中…' : '✕ 驳回'}
                </ActionBtn>
              </TaskActions>
            </TaskItem>
          ))}
        </Body>
      </Card>
    </Overlay>
  )
}
