/**
 * InternalChatPanel – Phase 6-A MVP
 *
 * In-app Matrix chat panel displayed in AISidebar "通讯" tab.
 * Layout adapts to 380px width: phone-style navigation
 * (room list → message view).
 */

import React, { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { useMatrixChat } from '../contexts/MatrixChatContext'
import { useInternalAccount } from '../contexts/InternalAccountContext'
import { INTERNAL_ELEMENT_WEB_URL, INTERNAL_CHAT_SERVER_NAME } from '../accountCenterConfig'

/* ---- Styled components ---- */

const Wrap = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #f7f8fb;
`

const Header = styled.div`
  padding: 8px 12px;
  border-bottom: 1px solid #e0e7f0;
  background: #ffffff;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
`

const HeaderId = styled.div`
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-xs);
  color: #627385;
  font-family: monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

const StatusBadge = styled.span<{ $ok?: boolean; $warn?: boolean; $error?: boolean }>`
  font-size: var(--font-size-xs);
  padding: 2px 6px;
  border-radius: 999px;
  font-weight: 700;
  background: ${p =>
    p.$ok ? '#d4edda' : p.$warn ? '#fff3cd' : p.$error ? '#f8d7da' : '#e2e8f0'};
  color: ${p =>
    p.$ok ? '#155724' : p.$warn ? '#856404' : p.$error ? '#721c24' : '#627385'};
`

const TxtBtn = styled.button`
  background: none;
  border: none;
  font-size: var(--font-size-xs);
  color: #0e639c;
  cursor: pointer;
  padding: 0 2px;
  white-space: nowrap;
  &:hover { text-decoration: underline; }
`

const Body = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`

/* ---- Login form ---- */

const LoginWrap = styled.div`
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const LoginTitle = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: #1f3142;
`

const LoginHint = styled.div`
  font-size: var(--font-size-xs);
  color: #627385;
  line-height: 1.5;
`

const Input = styled.input`
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #d0d9e4;
  border-radius: 6px;
  font-size: var(--font-size-sm);
  color: #243447;
  outline: none;
  box-sizing: border-box;
  &:focus { border-color: #0e639c; }
`

const Btn = styled.button<{ $primary?: boolean; $danger?: boolean }>`
  padding: 8px 14px;
  border-radius: 6px;
  font-size: var(--font-size-xs);
  cursor: pointer;
  border: ${p => p.$primary ? 'none' : '1px solid #d0d9e4'};
  background: ${p => p.$primary ? '#0e639c' : p.$danger ? '#e53935' : '#ffffff'};
  color: ${p => p.$primary || p.$danger ? '#ffffff' : '#304255'};
  &:disabled { opacity: 0.55; cursor: not-allowed; }
`

const Row = styled.div`
  display: flex;
  gap: 8px;
`

const ErrBox = styled.div`
  padding: 8px 10px;
  border-radius: 6px;
  background: #fdf0f0;
  border: 1px solid #f5c6cb;
  color: #721c24;
  font-size: var(--font-size-xs);
`

/* ---- Room list ---- */

const RoomListWrap = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: #f7f8fb;
`

const RoomItem = styled.button<{ $active?: boolean }>`
  width: 100%;
  text-align: left;
  padding: 10px 14px;
  border: none;
  background: ${p => p.$active ? '#e8f0fe' : 'transparent'};
  cursor: pointer;
  border-bottom: 1px solid #f0f3f7;
  display: flex;
  flex-direction: column;
  gap: 2px;
  &:hover { background: ${p => p.$active ? '#e8f0fe' : '#eef4ff'}; }
`

const RoomName = styled.div`
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: #243447;
`

const RoomPreview = styled.div`
  font-size: var(--font-size-xs);
  color: #8a9db5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 300px;
`

const RoomMeta = styled.div`
  font-size: var(--font-size-xs);
  color: #a8b7c7;
`

const NewDMArea = styled.div`
  padding: 10px 12px;
  border-top: 1px solid #e0e7f0;
  background: #ffffff;
  flex-shrink: 0;
  display: flex;
  gap: 6px;
`

const EmptyState = styled.div`
  padding: 24px 16px;
  text-align: center;
  color: #8a9db5;
  font-size: var(--font-size-xs);
`

/* ---- Message view ---- */

const RoomHeader = styled.div`
  padding: 8px 12px;
  border-bottom: 1px solid #e0e7f0;
  background: #ffffff;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
`

const BackBtn = styled.button`
  background: none;
  border: none;
  font-size: var(--font-size-sm);
  color: #0e639c;
  cursor: pointer;
  padding: 0;
  &:hover { text-decoration: underline; }
`

const RoomTitle = styled.div`
  flex: 1;
  font-size: var(--font-size-sm);
  font-weight: 700;
  color: #1f3142;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

const MessageListArea = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: #f7f8fb;
`

const MsgItem = styled.div<{ $self?: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: ${p => p.$self ? 'flex-end' : 'flex-start'};
  gap: 2px;
`

const MsgSender = styled.div`
  font-size: var(--font-size-xs);
  color: #8a9db5;
  font-family: monospace;
`

const MsgBubble = styled.div<{ $self?: boolean }>`
  max-width: 82%;
  padding: 7px 12px;
  border-radius: ${p => p.$self ? '16px 4px 16px 16px' : '4px 16px 16px 16px'};
  background: ${p => p.$self ? '#0e639c' : '#ffffff'};
  color: ${p => p.$self ? '#ffffff' : '#243447'};
  font-size: var(--font-size-sm);
  line-height: 1.5;
  border: 1px solid ${p => p.$self ? 'transparent' : '#dde3ec'};
  word-break: break-word;
`

const MsgTime = styled.div`
  font-size: var(--font-size-xs);
  color: #a8b7c7;
`

const SendArea = styled.div`
  padding: 8px 12px;
  border-top: 1px solid #e0e7f0;
  background: #ffffff;
  flex-shrink: 0;
  display: flex;
  gap: 6px;
`

const SendInput = styled.input`
  flex: 1;
  padding: 7px 10px;
  border: 1px solid #d0d9e4;
  border-radius: 6px;
  font-size: var(--font-size-sm);
  outline: none;
  box-sizing: border-box;
  &:focus { border-color: #0e639c; }
`

/* ---- Helpers ---- */

function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  }
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) +
    ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function senderShort(sender: string): string {
  const m = /^@([^:]+):/.exec(sender)
  return m ? m[1] : sender
}

function openElementWeb() {
  if (window.electronAPI?.openExternalUrl) {
    void window.electronAPI.openExternalUrl(INTERNAL_ELEMENT_WEB_URL)
  } else {
    window.open(INTERNAL_ELEMENT_WEB_URL, '_blank', 'noopener')
  }
}

/* ---- Sub-components ---- */

function LoginForm() {
  const { login, error, phase } = useMatrixChat()
  const { state: accountState } = useInternalAccount()
  const [password, setPassword] = useState('')
  const [localErr, setLocalErr] = useState('')
  const loading = phase === 'logging_in'

  const handle = async () => {
    if (!password.trim()) { setLocalErr('请输入密码'); return }
    setLocalErr('')
    try {
      await login(password)
    } catch {
      // error already set in context
    }
  }

  const matrixId = accountState.phase === 'logged_in'
    ? `@${accountState.session.user.username}:${INTERNAL_CHAT_SERVER_NAME}`
    : ''

  const displayErr = localErr || error

  return (
    <LoginWrap>
      <LoginTitle>📡 即时通讯登录</LoginTitle>
      {matrixId && <LoginHint>Matrix ID：{matrixId}</LoginHint>}
      <LoginHint>
        自动登录未成功，请手动输入内部账号密码。
      </LoginHint>
      <Input
        type="password"
        placeholder="内部账号密码（例：12345678）"
        value={password}
        onChange={e => setPassword(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && void handle()}
        disabled={loading}
      />
      {displayErr && <ErrBox>{displayErr}</ErrBox>}
      <Row>
        <Btn $primary onClick={() => void handle()} disabled={loading || !password.trim()}>
          {loading ? '登录中...' : '登录'}
        </Btn>
        <Btn onClick={openElementWeb}>打开 Element Web</Btn>
      </Row>
    </LoginWrap>
  )
}

function RoomList({ onNewDM }: { onNewDM: (userId: string) => void }) {
  const { rooms, currentRoomId, selectRoom, messagesByRoom } = useMatrixChat()
  const [dmInput, setDmInput] = useState('')
  const [dmErr, setDmErr] = useState('')
  const { createDirectRoom } = useMatrixChat()
  const [creating, setCreating] = useState(false)

  const handleNewDM = async () => {
    const target = dmInput.trim()
    if (!target) { setDmErr('请输入 Matrix ID'); return }
    if (!target.startsWith('@')) { setDmErr('Matrix ID 格式：@username:server'); return }
    setDmErr('')
    setCreating(true)
    try {
      await createDirectRoom(target)
      setDmInput('')
      onNewDM(target)
    } catch (err) {
      setDmErr((err as Error).message ?? '创建私聊失败')
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      <RoomListWrap>
        {rooms.length === 0 && (
          <EmptyState>暂无房间。输入 Matrix ID 创建私聊，或前往 Element Web 加入群组。</EmptyState>
        )}
        {rooms.map(room => {
          const msgs = messagesByRoom[room.roomId] ?? []
          const last = msgs[msgs.length - 1]
          return (
            <RoomItem
              key={room.roomId}
              $active={room.roomId === currentRoomId}
              onClick={() => selectRoom(room.roomId)}
            >
              <RoomName>{room.isDirect ? '💬 ' : '🏠 '}{room.name}</RoomName>
              {last && (
                <>
                  <RoomPreview>{senderShort(last.sender)}: {last.body}</RoomPreview>
                  <RoomMeta>{formatTime(last.timestamp)}</RoomMeta>
                </>
              )}
            </RoomItem>
          )
        })}
      </RoomListWrap>

      <NewDMArea>
        <SendInput
          value={dmInput}
          onChange={e => setDmInput(e.target.value)}
          placeholder="@用户:aioffice.cuhksz"
          onKeyDown={e => e.key === 'Enter' && void handleNewDM()}
          disabled={creating}
        />
        <Btn $primary onClick={() => void handleNewDM()} disabled={creating || !dmInput.trim()}>
          {creating ? '...' : '私聊'}
        </Btn>
      </NewDMArea>
      {dmErr && <div style={{ padding: '4px 12px', fontSize: 14, color: '#c0392b' }}>{dmErr}</div>}
    </>
  )
}

function MessageView({ roomId }: { roomId: string }) {
  const { rooms, messagesByRoom, session, selectRoom, sendMessage, syncing, syncError, retrySync } = useMatrixChat()
  const room = rooms.find(r => r.roomId === roomId)
  const messages = messagesByRoom[roomId] ?? []

  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [sendErr, setSendErr] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const handleSend = async () => {
    const trimmed = text.trim()
    if (!trimmed) return
    setSendErr('')
    setSending(true)
    try {
      await sendMessage(trimmed)
      setText('')
    } catch (err) {
      setSendErr((err as Error).message ?? '发送失败')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <RoomHeader>
        <BackBtn onClick={() => selectRoom(null)}>← 返回</BackBtn>
        <RoomTitle>{room?.name ?? roomId}</RoomTitle>
        {syncing && <StatusBadge>同步中</StatusBadge>}
        {syncError && (
          <TxtBtn onClick={retrySync} style={{ color: '#c0392b' }}>重试</TxtBtn>
        )}
      </RoomHeader>

      <MessageListArea>
        {messages.length === 0 && (
          <EmptyState>暂无消息。发送第一条消息开始对话。</EmptyState>
        )}
        {messages.map(msg => {
          const isSelf = msg.sender === session?.userId
          return (
            <MsgItem key={msg.eventId} $self={isSelf}>
              {!isSelf && <MsgSender>{senderShort(msg.sender)}</MsgSender>}
              <MsgBubble $self={isSelf}>{msg.body}</MsgBubble>
              <MsgTime>{formatTime(msg.timestamp)}</MsgTime>
            </MsgItem>
          )
        })}
        {syncError && (
          <ErrBox style={{ fontSize: 14 }}>⚠ {syncError}</ErrBox>
        )}
        <div ref={bottomRef} />
      </MessageListArea>

      <SendArea>
        <SendInput
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="输入消息…"
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && void handleSend()}
          disabled={sending}
        />
        <Btn $primary onClick={() => void handleSend()} disabled={sending || !text.trim()}>
          发送
        </Btn>
      </SendArea>
      {sendErr && <div style={{ padding: '4px 12px', fontSize: 14, color: '#c0392b' }}>{sendErr}</div>}
    </>
  )
}

/* ---- Main export ---- */

export default function InternalChatPanel() {
  const { phase, session, syncing, syncError, logout } = useMatrixChat()

  const matrixId = session?.userId ?? '—'
  const isConnected = phase === 'logged_in'

  const handleLogout = () => void logout()

  return (
    <Wrap>
      {/* ── Header bar ── */}
      <Header>
        <HeaderId title={matrixId}>{matrixId}</HeaderId>
        {phase === 'logged_in' && (
          <StatusBadge $ok>
            {syncing ? '同步中' : '已连接'}
          </StatusBadge>
        )}
        {phase === 'needs_login' && <StatusBadge>未登录</StatusBadge>}
        {phase === 'restoring' && <StatusBadge>自动连接中</StatusBadge>}
        {syncError && <StatusBadge $warn title={syncError}>同步失败</StatusBadge>}
        {isConnected && (
          <TxtBtn onClick={handleLogout}>退出</TxtBtn>
        )}
        <TxtBtn onClick={openElementWeb} title="打开 Element Web">
          Element Web ↗
        </TxtBtn>
      </Header>

      {/* ── Body ── */}
      <Body>
        {(phase === 'idle' || phase === 'restoring') && (
          <EmptyState>正在自动连接即时通讯…</EmptyState>
        )}

        {(phase === 'needs_login' || phase === 'error' || phase === 'logging_in') && (
          <LoginForm />
        )}

        {phase === 'logged_in' && <ChatBody />}
      </Body>
    </Wrap>
  )
}

function ChatBody() {
  const { currentRoomId, selectRoom } = useMatrixChat()

  const handleNewDM = (_userId: string) => {
    // Room selection is handled by createDirectRoom → setCurrentRoomId
  }

  return (
    <>
      {currentRoomId ? (
        <MessageView roomId={currentRoomId} />
      ) : (
        <RoomList onNewDM={handleNewDM} />
      )}
    </>
  )
}
