/**
 * MockChatProvider — returns static seed chat threads for Phase 2 UI validation.
 *
 * All thread/message IDs are prefixed with "chat:" to prevent collisions with
 * email threads in CommunicationContext.
 *
 * Replace with a real InternalChatProvider in Phase 3 (WebSocket/HTTP).
 */
import type { CommunicationThread, CommunicationMessage } from '../types'

/** Prefix used for all chat thread/message IDs. */
export const CHAT_THREAD_PREFIX = 'chat:'

function chatMsg(
  id: string,
  threadId: string,
  from: string,
  fromName: string,
  body: string,
  timestamp: string,
  isIncoming: boolean,
  extra?: Partial<CommunicationMessage>,
): CommunicationMessage {
  return {
    id,
    threadId,
    from,
    fromName,
    body,
    timestamp,
    isIncoming,
    attachments: [],
    providerType: 'chat',
    ...extra,
  }
}

export function getMockChatThreads(): CommunicationThread[] {
  const base = new Date('2026-04-30T09:00:00+08:00')
  const t = (h: number, m = 0) =>
    new Date(base.getTime() + h * 3_600_000 + m * 60_000).toISOString()

  /* ── Thread 1: 张三 — research seminar follow-up ── */
  const t1Messages: CommunicationMessage[] = [
    chatMsg('chat:mc1-1', 'chat:mock-chat-001', 'zhangsan@sds.cuhksz.edu.cn', '张三',
      '王老师，您好！关于上周研讨会的会议纪要，我已经整理完了，请问方便 review 一下吗？',
      t(0, 10), true),
    chatMsg('chat:mc1-2', 'chat:mock-chat-001', 'wangming@cuhksz.edu.cn', '王明',
      '好的，发过来吧。',
      t(0, 25), false),
    chatMsg('chat:mc1-3', 'chat:mock-chat-001', 'zhangsan@sds.cuhksz.edu.cn', '张三',
      '已发到您邮箱了，另外想请问一下，下周的组会时间是否有调整？',
      t(1, 5), true),
  ]
  const thread1: CommunicationThread = {
    id: 'chat:mock-chat-001',
    providerType: 'chat',
    subject: '张三（数据科学学院）',
    participants: ['zhangsan@sds.cuhksz.edu.cn', 'wangming@cuhksz.edu.cn'],
    participantNames: ['张三', '王明'],
    unread: true,
    hasAttachments: false,
    replied: false,
    messages: t1Messages,
    lastMessage: t1Messages[t1Messages.length - 1],
  }

  /* ── Thread 2: 李四 — expense reimbursement (has image attachment) ── */
  const t2Messages: CommunicationMessage[] = [
    chatMsg('chat:mc2-1', 'chat:mock-chat-002', 'lisi@research.cuhksz.edu.cn', '李四',
      '王老师，提醒一下，您的报销申请还差一份采购合同扫描件，请尽快补充。截止时间是本周五下午5点。',
      t(2, 0), true),
    chatMsg('chat:mc2-2', 'chat:mock-chat-002', 'lisi@research.cuhksz.edu.cn', '李四',
      '[图片：报销流程说明.png]',
      t(2, 1), true, {
        attachments: [{
          id: 'chat:mc2-img1',
          filename: '报销流程说明.png',
          contentType: 'image/png',
          size: 124_000,
        }],
      }),
  ]
  const thread2: CommunicationThread = {
    id: 'chat:mock-chat-002',
    providerType: 'chat',
    subject: '李四（科研财务）',
    participants: ['lisi@research.cuhksz.edu.cn', 'wangming@cuhksz.edu.cn'],
    participantNames: ['李四', '王明'],
    unread: true,
    hasAttachments: true,
    replied: false,
    messages: t2Messages,
    lastMessage: t2Messages[t2Messages.length - 1],
  }

  /* ── Thread 3: 陈薇 — graduate school (already replied) ── */
  const t3Messages: CommunicationMessage[] = [
    chatMsg('chat:mc3-1', 'chat:mock-chat-003', 'chenwei@gs.cuhksz.edu.cn', '陈薇',
      '王老师，中期考核材料收集截止日期临近，请通知您名下研究生尽快提交。',
      t(3, 0), true),
    chatMsg('chat:mc3-2', 'chat:mock-chat-003', 'wangming@cuhksz.edu.cn', '王明',
      '好的，我已通知各位同学，请放心。',
      t(3, 15), false),
  ]
  const thread3: CommunicationThread = {
    id: 'chat:mock-chat-003',
    providerType: 'chat',
    subject: '陈薇（研究生院）',
    participants: ['chenwei@gs.cuhksz.edu.cn', 'wangming@cuhksz.edu.cn'],
    participantNames: ['陈薇', '王明'],
    unread: false,
    hasAttachments: false,
    replied: true,
    messages: t3Messages,
    lastMessage: t3Messages[t3Messages.length - 1],
  }

  return [thread1, thread2, thread3]
}
