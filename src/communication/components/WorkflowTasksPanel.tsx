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

const AiPreprocessNotice = styled.div`
  font-size: 10px; color: #6366f1; font-style: italic;
  margin-bottom: 8px; padding: 4px 8px;
  background: #f0f0ff; border-radius: 4px;
`

const LinearHandoffBadge = styled.span`
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 10px; font-weight: 600; padding: 1px 7px;
  border-radius: 8px; background: #ebf8ff; color: #2b6cb0;
  border: 1px solid #bee3f8;
`

const LinearHandoffInfo = styled.div`
  font-size: 11px; color: #2d3748; margin-bottom: 8px;
  padding: 8px 10px; background: #f7fafc;
  border-left: 3px solid #4299e1; border-radius: 0 6px 6px 0;
  line-height: 1.6;
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
          {tasks.map((task) => {
            const isResearch = task.category === 'research_progress_submission'
            return (
            <TaskItem key={task.taskId}>
              <TaskSubject>{task.subject || '（无主题）'}</TaskSubject>
              <TaskMeta>
                {task.sender && <span>发件人：{task.sender}</span>}
                {task.priority && (
                  <PriorityBadge $p={task.priority}>{priorityLabel(task.priority)}</PriorityBadge>
                )}
                {task.category && (
                  isResearch
                    ? <LinearHandoffBadge>🔗 Research Progress 顺序交接</LinearHandoffBadge>
                    : <span>{task.category}</span>
                )}
                {task.createTime && <span>{formatCreateTime(task.createTime)}</span>}
              </TaskMeta>
              {isResearch && (
                <LinearHandoffInfo>
                  <div>📋 <strong>事项类型：</strong>Research Progress 提交与导师审批</div>
                  <div>🔗 <strong>流程模式：</strong>点对点顺序交接（学生 → 导师 → 归档）</div>
                  <div>🎓 <strong>当前阶段：</strong>学生准备并提交材料</div>
                  <div>👨‍🏫 <strong>下一处理人：</strong>导师确认签字</div>
                </LinearHandoffInfo>
              )}
              {task.aiSummary && (
                <TaskSummary>{task.aiSummary}</TaskSummary>
              )}
              <AiPreprocessNotice>
                {isResearch
                  ? 'AI 已拆解顺序流程，请按当前阶段完成后再交由下一处理人确认。'
                  : 'AI 已完成预处理，请你做最终确认。'}
              </AiPreprocessNotice>
              <TaskActions>
                <ActionBtn
                  $variant="approve"
                  disabled={completingTaskId === task.taskId}
                  onClick={() => onApprove(task.taskId)}
                >
                  {completingTaskId === task.taskId
                    ? '处理中…'
                    : isResearch ? '✅ 确认已准备/提交' : '✅ 确认签字'}
                </ActionBtn>
                <ActionBtn
                  $variant="reject"
                  disabled={completingTaskId === task.taskId}
                  onClick={() => onReject(task.taskId)}
                >
                  {completingTaskId === task.taskId
                    ? '处理中…'
                    : isResearch ? '↩ 要求补充材料' : '↩ 驳回/要求补充'}
                </ActionBtn>
              </TaskActions>
            </TaskItem>
            )
          })}
        </Body>
      </Card>
    </Overlay>
  )
}
