/**
 * ComposeModal — 新建邮件弹窗
 *
 * 功能：
 * - RecipientsInput: 通讯录搜索 + chips + 手动输入 + 粘贴多地址
 * - CC / BCC 支持（默认折叠）
 * - 附件：通过 Electron dialog 选择，显示列表 + 大小 + 删除
 * - 发送带附件邮件
 * - 邮箱格式校验、重复去重、大小限制
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import styled from 'styled-components'
import { useEmail, type ComposePayload } from '../contexts/EmailContext'
import { useInternalAccount } from '../../../contexts/InternalAccountContext'
import * as accountCenterClient from '../../../services/accountCenterClient'
import type { EmailContact } from '../../../services/accountCenterClient'
import { generateBulkEmailDrafts } from '../services/bulkEmailDraftService'
import type { BulkEmailDraft, BulkEmailRecipient } from '../../../types/email'

/* ================================================================== */
/*  Constants                                                          */
/* ================================================================== */

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024   // 25 MB per file
const MAX_TOTAL_BYTES = 50 * 1024 * 1024         // 50 MB total
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/* ================================================================== */
/*  Styles                                                             */
/* ================================================================== */

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(15, 25, 40, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3000;
`

const Modal = styled.div`
  background: #ffffff;
  border-radius: 14px;
  box-shadow: 0 8px 48px rgba(15, 25, 40, 0.18);
  width: 640px;
  max-width: calc(100vw - 40px);
  max-height: calc(100vh - 80px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif;
`

const ModalHeader = styled.div`
  padding: 16px 20px 14px;
  border-bottom: 1px solid #eaeff5;
  display: flex;
  align-items: center;
  justify-content: space-between;
`

const ModalTitle = styled.h2`
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: #1a202c;
`

const HeaderLeft = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`

const ModeTabs = styled.div`
  display: inline-flex;
  padding: 3px;
  border-radius: 9px;
  background: #eef3f8;
  gap: 3px;
`

const ModeTab = styled.button<{ $active?: boolean }>`
  border: none;
  border-radius: 7px;
  padding: 5px 12px;
  font-size: var(--font-size-xs);
  font-weight: 700;
  cursor: pointer;
  color: ${p => p.$active ? '#174ea6' : '#718096'};
  background: ${p => p.$active ? '#ffffff' : 'transparent'};
  box-shadow: ${p => p.$active ? '0 1px 4px rgba(15, 25, 40, 0.12)' : 'none'};
`

const CloseBtn = styled.button`
  width: 28px;
  height: 28px;
  border: none;
  background: #f0f4f8;
  border-radius: 6px;
  cursor: pointer;
  font-size: 15px;
  color: #627385;
  display: flex;
  align-items: center;
  justify-content: center;
  &:hover { background: #e2e8f0; }
`

const ModalBody = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 0;
`

const FieldRow = styled.div`
  display: flex;
  align-items: flex-start;
  min-height: 38px;
  border-bottom: 1px solid #eaeff5;
  padding: 6px 14px 6px 16px;
  gap: 8px;
`

const FieldLabel = styled.label`
  flex-shrink: 0;
  width: 44px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: #718096;
  padding-top: 8px;
`

const FieldContent = styled.div`
  flex: 1;
  min-width: 0;
`

const FieldToggle = styled.button`
  flex-shrink: 0;
  border: none;
  background: none;
  font-size: var(--font-size-xs);
  color: #718096;
  cursor: pointer;
  padding: 8px 0 0;
  &:hover { color: #2d3748; }
`

const BulkOptions = styled.div`
  padding: 10px 16px;
  border-bottom: 1px solid #eaeff5;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: #fbfdff;
`

const BulkModeRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
`

const BulkModeBtn = styled.button<{ $active?: boolean }>`
  border: 1px solid ${p => p.$active ? '#90cdf4' : '#dde4ec'};
  background: ${p => p.$active ? '#ebf8ff' : '#ffffff'};
  color: ${p => p.$active ? '#1a5fb4' : '#4a5f73'};
  border-radius: 8px;
  padding: 6px 12px;
  font-size: var(--font-size-xs);
  font-weight: 700;
  cursor: pointer;
`

const BulkHint = styled.div`
  font-size: var(--font-size-xs);
  color: #718096;
  line-height: 1.5;
`

const BulkToolbar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
`

const BulkSelect = styled.select`
  border: 1px solid #cbd5e0;
  border-radius: 8px;
  padding: 6px 10px;
  font-size: var(--font-size-xs);
  color: #2d3748;
  background: #ffffff;
`

const SmallActionBtn = styled.button`
  border: 1px solid #b7d6f5;
  border-radius: 8px;
  background: #ebf3fd;
  color: #2b6cb0;
  padding: 6px 10px;
  font-size: var(--font-size-xs);
  font-weight: 700;
  cursor: pointer;
  &:hover:not(:disabled) { background: #d9ebff; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`

/* Chips + input row */
const RecipientsContainer = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  padding: 4px 0;
  cursor: text;
  position: relative;
`

const Chip = styled.span<{ $status?: string }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: ${p => p.$status === 'not_created' ? '#fff8e6' : p.$status === 'failed' || p.$status === 'disabled' ? '#fde8e8' : '#e8f0fe'};
  border: 1px solid ${p => p.$status === 'not_created' ? '#f5c842' : p.$status === 'failed' || p.$status === 'disabled' ? '#f7b2b2' : '#c5d8fc'};
  border-radius: 100px;
  padding: 2px 8px 2px 10px;
  font-size: var(--font-size-xs);
  color: ${p => p.$status === 'not_created' ? '#856404' : p.$status === 'failed' || p.$status === 'disabled' ? '#721c24' : '#1a56c4'};
  max-width: 280px;
`

const ChipText = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const ChipRemove = styled.button`
  width: 14px;
  height: 14px;
  border: none;
  background: none;
  color: #4a72c4;
  cursor: pointer;
  font-size: var(--font-size-sm);
  padding: 0;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  &:hover { color: #c53030; }
`

const RecipientInput = styled.input`
  border: none;
  outline: none;
  font-size: var(--font-size-sm);
  color: #2d3748;
  min-width: 120px;
  flex: 1;
  background: transparent;
  padding: 4px 0;
  &::placeholder { color: #b0bec5; }
`

/* Contact dropdown */
const DropdownWrapper = styled.div`
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  width: 340px;
  max-height: 240px;
  overflow-y: auto;
  background: #ffffff;
  border: 1px solid #dde4ec;
  border-radius: 10px;
  box-shadow: 0 4px 20px rgba(15, 25, 40, 0.12);
  z-index: 200;
`

const DropdownItem = styled.div<{ $focused?: boolean }>`
  padding: 8px 12px;
  cursor: pointer;
  background: ${p => p.$focused ? '#eaf2fb' : 'transparent'};
  border-bottom: 1px solid #f0f4f8;
  &:last-child { border-bottom: none; }
  &:hover { background: #eaf2fb; }
`

const DropdownName = styled.div`
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: #1a202c;
`

const DropdownEmail = styled.div`
  font-size: var(--font-size-xs);
  color: #718096;
  margin-top: 1px;
`

const DropdownEmpty = styled.div`
  padding: 12px;
  font-size: var(--font-size-xs);
  color: #9faebd;
  text-align: center;
`

/* Subject / body */
const SubjectInput = styled.input`
  width: 100%;
  border: none;
  outline: none;
  font-size: 14px;
  color: #1a202c;
  padding: 8px 0;
  background: transparent;
  &::placeholder { color: #b0bec5; }
  box-sizing: border-box;
`

const BodyTextarea = styled.textarea`
  width: 100%;
  min-height: 180px;
  border: none;
  outline: none;
  font-size: var(--font-size-sm);
  color: #2d3748;
  line-height: 1.7;
  resize: vertical;
  padding: 12px 0 0;
  background: transparent;
  box-sizing: border-box;
  &::placeholder { color: #b0bec5; }
`

const BodyRow = styled.div`
  padding: 4px 14px 12px 16px;
`

const BulkDraftPanel = styled.div`
  border-top: 1px solid #eaeff5;
  padding: 12px 16px;
  background: #f8fbff;
`

const BulkDraftHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  font-size: var(--font-size-xs);
  color: #4a5f73;
  font-weight: 700;
`

const BulkDraftList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`

const BulkDraftCard = styled.div`
  border: 1px solid #dde4ec;
  background: #ffffff;
  border-radius: 10px;
  padding: 10px;
`

const BulkDraftMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  font-size: var(--font-size-xs);
  color: #718096;
`

const BulkDraftStatus = styled.span<{ $status: BulkEmailDraft['status'] }>`
  font-weight: 700;
  color: ${p => p.$status === 'sent' ? '#2f855a' : p.$status === 'failed' ? '#c53030' : p.$status === 'sending' ? '#2b6cb0' : '#718096'};
`

const BulkDraftSubject = styled.input`
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #dde4ec;
  border-radius: 8px;
  padding: 7px 9px;
  font-size: var(--font-size-xs);
  color: #1a202c;
  margin-bottom: 8px;
`

const BulkDraftBody = styled.textarea`
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #dde4ec;
  border-radius: 8px;
  padding: 8px 9px;
  min-height: 120px;
  resize: vertical;
  font-size: var(--font-size-xs);
  line-height: 1.6;
  color: #2d3748;
`

/* Attachments */
const AttachmentsArea = styled.div`
  padding: 10px 16px;
  border-top: 1px solid #eaeff5;
`

const AttachBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px dashed #b0bec5;
  border-radius: 8px;
  background: #f8fbff;
  color: #4a6180;
  font-size: var(--font-size-xs);
  padding: 6px 12px;
  cursor: pointer;
  &:hover { background: #eaf2fb; border-color: #7ab0e0; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`

const AttachList = styled.div`
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const AttachItem = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  background: #f4f7fa;
  border: 1px solid #dde4ec;
  border-radius: 8px;
  padding: 6px 10px;
`

const AttachIcon = styled.span`
  font-size: 16px;
  flex-shrink: 0;
`

const AttachName = styled.span`
  flex: 1;
  font-size: var(--font-size-xs);
  color: #1a202c;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const AttachSize = styled.span`
  font-size: var(--font-size-xs);
  color: #9faebd;
  flex-shrink: 0;
`

const AttachRemove = styled.button`
  width: 20px;
  height: 20px;
  border: none;
  background: none;
  color: #9faebd;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  &:hover { background: #fce8e8; color: #c53030; }
`

/* Footer */
const ModalFooter = styled.div`
  padding: 12px 16px;
  border-top: 1px solid #eaeff5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`

const FooterLeft = styled.div`
  flex: 1;
  font-size: var(--font-size-xs);
  color: #e53e3e;
  min-width: 0;
`

const FooterRight = styled.div`
  display: flex;
  gap: 8px;
`

const CancelBtn = styled.button`
  border: 1px solid #dde4ec;
  background: #fff;
  color: #4a5f73;
  border-radius: 8px;
  padding: 8px 18px;
  font-size: var(--font-size-sm);
  cursor: pointer;
  &:hover { background: #f4f7fa; }
`

const SendBtn = styled.button`
  border: none;
  background: linear-gradient(135deg, #1a6fd4, #1558b8);
  color: #fff;
  border-radius: 8px;
  padding: 8px 22px;
  font-size: var(--font-size-sm);
  font-weight: 700;
  cursor: pointer;
  &:hover:not(:disabled) { opacity: 0.9; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function getAttachIcon(mimeType: string, fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  if (mimeType.startsWith('image/')) return '🖼️'
  if (ext === 'pdf') return '📕'
  if (ext === 'docx' || ext === 'doc') return '📝'
  if (ext === 'xlsx' || ext === 'xls') return '📊'
  if (ext === 'pptx' || ext === 'ppt') return '📋'
  if (ext === 'zip') return '🗜️'
  return '📄'
}

function chipLabel(contact: RecipientEntry) {
  if (contact.displayName) return `${contact.displayName} <${contact.email}>`
  return contact.email
}

/** mailboxStatus badge for dropdown */
function MailboxBadge({ status }: { status?: string }) {
  if (!status || status === 'active') return null
  if (status === 'not_created')
    return <span style={{ marginLeft: 6, fontSize: 10, color: '#856404', background: '#fff3cd', padding: '1px 5px', borderRadius: 4, fontWeight: 700 }}>邮箱未创建</span>
  if (status === 'failed')
    return <span style={{ marginLeft: 6, fontSize: 10, color: '#721c24', background: '#f8d7da', padding: '1px 5px', borderRadius: 4, fontWeight: 700 }}>创建失败</span>
  if (status === 'disabled')
    return <span style={{ marginLeft: 6, fontSize: 10, color: '#721c24', background: '#f8d7da', padding: '1px 5px', borderRadius: 4, fontWeight: 700 }}>已禁用</span>
  return null
}

function isSelectable(c: EmailContact): boolean {
  return !!c.aiEmail && c.mailboxStatus === 'active'
}

/** Returns a human-readable status description for error messages */
function mailboxStatusText(status?: string): string {
  if (status === 'not_created') return 'AI 邮箱尚未创建'
  if (status === 'failed') return 'AI 邮箱创建失败'
  if (status === 'disabled') return 'AI 邮箱已禁用'
  return 'AI 邮箱状态未知'
}

function bulkDraftStatusText(status: BulkEmailDraft['status']): string {
  if (status === 'ready') return '已编辑'
  if (status === 'sending') return '发送中'
  if (status === 'sent') return '已发送'
  if (status === 'failed') return '失败'
  return '草稿'
}

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */

interface RecipientEntry {
  email: string
  displayName?: string
  personId?: string
  department?: string
  position?: string
  mailboxStatus?: string
  /** true when added from the contacts directory — mailboxStatus check applies */
  fromDirectory?: boolean
}

interface AttachmentEntry {
  fileName: string
  filePath: string
  mimeType: string
  sizeBytes: number
}

/* ================================================================== */
/*  RecipientsInput                                                    */
/* ================================================================== */

interface RecipientsInputProps {
  recipients: RecipientEntry[]
  onAdd: (entry: RecipientEntry) => void
  onRemove: (email: string) => void
  contacts: EmailContact[]
  contactsError: string | null
  placeholder?: string
  autoFocus?: boolean
}

function RecipientsInput({
  recipients,
  onAdd,
  onRemove,
  contacts,
  contactsError,
  placeholder = '输入姓名或邮箱',
  autoFocus,
}: RecipientsInputProps) {
  const [query, setQuery] = useState('')
  const [showDrop, setShowDrop] = useState(false)
  const [focusedIdx, setFocusedIdx] = useState(-1)
  const [inputError, setInputError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const existingEmails = new Set(recipients.map((r) => r.email.toLowerCase()))

  const filtered = query.trim()
    ? contacts.filter((c) => {
        // Exclude contacts whose aiEmail is already added
        if (existingEmails.has(c.aiEmail.toLowerCase())) return false
        const q = query.toLowerCase()
        return (
          c.aiEmail.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          (c.enName ?? '').toLowerCase().includes(q) ||
          (c.employeeId ?? '').toLowerCase().includes(q) ||
          (c.department ?? '').toLowerCase().includes(q) ||
          (c.position ?? '').toLowerCase().includes(q) ||
          (c.sourceEmail ?? '').toLowerCase().includes(q)
        )
      }).slice(0, 12)
    : []

  const commitEmail = useCallback((value: string) => {
    const parts = value.split(/[,;]+/).map((s) => s.trim()).filter(Boolean)
    let hasError = false
    for (const part of parts) {
      if (!EMAIL_REGEX.test(part)) {
        setInputError(`"${part}" 邮箱格式不正确`)
        hasError = true
        continue
      }
      // Cross-check against contacts list: if this email matches a known contact
      // that is not active, block it — prevents bypassing mailboxStatus via manual input
      const matchedContact = contacts.find((c) => c.aiEmail.toLowerCase() === part.toLowerCase())
      if (matchedContact && !isSelectable(matchedContact)) {
        setInputError(mailboxStatusText(matchedContact.mailboxStatus) + `（${matchedContact.name || part}）`)
        hasError = true
        continue
      }
      if (!existingEmails.has(part.toLowerCase())) {
        onAdd({
          email: part,
          displayName: matchedContact?.name,
          personId: matchedContact?.personId,
          department: matchedContact?.department,
          position: matchedContact?.position,
          mailboxStatus: matchedContact?.mailboxStatus,
          fromDirectory: !!matchedContact,
        })
      }
    }
    if (!hasError) setInputError(null)
    setQuery('')
    setShowDrop(false)
  }, [onAdd, existingEmails, contacts])

  const selectContact = useCallback((c: EmailContact) => {
    if (!isSelectable(c)) {
      setInputError(mailboxStatusText(c.mailboxStatus) + `（${c.name || c.aiEmail}）`)
      return
    }
    if (!existingEmails.has(c.aiEmail.toLowerCase())) {
      onAdd({ email: c.aiEmail, displayName: c.name, personId: c.personId, department: c.department, position: c.position, mailboxStatus: c.mailboxStatus, fromDirectory: true })
    }
    setQuery('')
    setShowDrop(false)
    setFocusedIdx(-1)
    inputRef.current?.focus()
  }, [onAdd, existingEmails])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === ',') {
      e.preventDefault()
      if (focusedIdx >= 0 && filtered[focusedIdx]) {
        selectContact(filtered[focusedIdx])
      } else if (query.trim()) {
        commitEmail(query.trim())
      }
    } else if (e.key === 'Tab') {
      if (query.trim()) {
        e.preventDefault()
        if (focusedIdx >= 0 && filtered[focusedIdx]) {
          selectContact(filtered[focusedIdx])
        } else {
          commitEmail(query.trim())
        }
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusedIdx((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusedIdx((i) => Math.max(i - 1, -1))
    } else if (e.key === 'Backspace' && !query && recipients.length > 0) {
      onRemove(recipients[recipients.length - 1].email)
    } else if (e.key === 'Escape') {
      setShowDrop(false)
      setFocusedIdx(-1)
    }
  }, [query, filtered, focusedIdx, selectContact, commitEmail, recipients, onRemove])

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text')
    if (text.includes(',') || text.includes(';') || text.includes('\n')) {
      e.preventDefault()
      commitEmail(text.replace(/\n/g, ','))
    }
  }, [commitEmail])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDrop(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <RecipientsContainer
      ref={containerRef}
      onClick={() => inputRef.current?.focus()}
    >
      {recipients.map((r) => (
        <Chip key={r.email} title={r.email} $status={r.fromDirectory ? r.mailboxStatus : undefined}>
          <ChipText>
            {chipLabel(r)}
            {r.fromDirectory && r.mailboxStatus && r.mailboxStatus !== 'active' && (
              <span style={{ marginLeft: 4, opacity: 0.8 }}>⚠</span>
            )}
          </ChipText>
          <ChipRemove
            type="button"
            onClick={(e) => { e.stopPropagation(); onRemove(r.email) }}
            title={`移除 ${r.email}`}
          >×</ChipRemove>
        </Chip>
      ))}
      <RecipientInput
        ref={inputRef}
        autoFocus={autoFocus}
        value={query}
        placeholder={recipients.length === 0 ? placeholder : ''}
        onChange={(e) => {
          setQuery(e.target.value)
          setShowDrop(true)
          setFocusedIdx(-1)
          setInputError(null)
        }}
        onFocus={() => { if (query || contacts.length > 0) setShowDrop(true) }}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onBlur={() => {
          // Slight delay to allow dropdown click to register
          setTimeout(() => {
            setShowDrop(false)
            if (query.trim()) commitEmail(query.trim())
          }, 150)
        }}
      />
      {inputError && (
        <div style={{ width: '100%', fontSize: 14, color: '#e53e3e', paddingTop: 2 }}>{inputError}</div>
      )}
      {showDrop && (filtered.length > 0 || contactsError) && (
        <DropdownWrapper>
          {contactsError ? (
            <DropdownEmpty style={{ color: '#e53e3e' }}>⚠ {contactsError}</DropdownEmpty>
          ) : filtered.length === 0 ? (
            <DropdownEmpty>暂无匹配联系人</DropdownEmpty>
          ) : (
            filtered.map((c, i) => (
              <DropdownItem
                key={c.personId}
                $focused={focusedIdx === i}
                onMouseDown={() => selectContact(c)}
                style={{ opacity: isSelectable(c) ? 1 : 0.55, cursor: isSelectable(c) ? 'pointer' : 'not-allowed' }}
                title={!isSelectable(c) ? mailboxStatusText(c.mailboxStatus) : undefined}
              >
                <DropdownName>
                  {c.name}
                  {c.enName ? <span style={{ fontWeight: 400, color: '#9faebd', marginLeft: 4 }}>{c.enName}</span> : null}
                  <MailboxBadge status={c.mailboxStatus} />
                </DropdownName>
                <DropdownEmail>
                  {c.aiEmail}
                  {c.department ? <span style={{ color: '#b0bec5', marginLeft: 6 }}>{c.department}</span> : null}
                </DropdownEmail>
              </DropdownItem>
            ))
          )}
        </DropdownWrapper>
      )}
    </RecipientsContainer>
  )
}

/* ================================================================== */
/*  ComposeModal                                                       */
/* ================================================================== */

export interface ComposeModalProps {
  onClose: () => void
  /** Pre-populate To field with these recipients */
  initialTo?: RecipientEntry[]
  initialSubject?: string
  initialBody?: string
  initialAttachments?: AttachmentEntry[]
  variant?: 'compose' | 'forward'
}

export default function ComposeModal({
  onClose,
  initialTo,
  initialSubject = '',
  initialBody = '',
  initialAttachments = [],
  variant = 'compose',
}: ComposeModalProps) {
  const { sendBlank, accountConfig } = useEmail()
  const { state } = useInternalAccount()

  const token = state.phase === 'logged_in' ? state.session.token : null

  // Contacts state — use real email contacts from AccountCenter
  const [contacts, setContacts] = useState<EmailContact[]>([])
  const [contactsError, setContactsError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    accountCenterClient.getEmailContacts(token).then((list) => {
      setContacts(list)
      setContactsError(null)
    }).catch((err) => {
      setContactsError('通讯录加载失败，请检查账号中心连接')
      console.warn('[ComposeModal] getEmailContacts failed:', err)
    })
  }, [token])

  const departments = useMemo(() => {
    const names = new Set<string>()
    for (const c of contacts) {
      const dept = c.department?.trim()
      if (dept && isSelectable(c)) names.add(dept)
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
  }, [contacts])

  // Recipient state
  const [toList, setToList] = useState<RecipientEntry[]>(initialTo ?? [])
  const [ccList, setCcList] = useState<RecipientEntry[]>([])
  const [bccList, setBccList] = useState<RecipientEntry[]>([])
  const [showCc, setShowCc] = useState(false)
  const [showBcc, setShowBcc] = useState(false)
  const [composeMode, setComposeMode] = useState<'single' | 'bulk'>('single')
  const [bulkMode, setBulkMode] = useState<'same' | 'ai'>('same')
  const [selectedDepartment, setSelectedDepartment] = useState('')
  const allowBulkMode = variant !== 'forward'

  // Subject / body
  const [subject, setSubject] = useState(initialSubject)
  const [body, setBody] = useState(initialBody)
  const [bulkGoal, setBulkGoal] = useState('')
  const [bulkDrafts, setBulkDrafts] = useState<BulkEmailDraft[]>([])

  // Attachments
  const [attachments, setAttachments] = useState<AttachmentEntry[]>(initialAttachments)

  // Sending state
  const [sending, setSending] = useState(false)
  const [generatingBulkDrafts, setGeneratingBulkDrafts] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /* ---- Recipient helpers ---- */
  const addTo = useCallback((e: RecipientEntry) => {
    setToList((prev) => prev.find((x) => (e.personId && x.personId === e.personId) || x.email.toLowerCase() === e.email.toLowerCase()) ? prev : [...prev, e])
  }, [])
  const removeFrom = useCallback((email: string) => {
    setToList((prev) => prev.filter((x) => x.email.toLowerCase() !== email.toLowerCase()))
  }, [])
  const addCc = useCallback((e: RecipientEntry) => {
    setCcList((prev) => prev.find((x) => (e.personId && x.personId === e.personId) || x.email.toLowerCase() === e.email.toLowerCase()) ? prev : [...prev, e])
  }, [])
  const removeCc = useCallback((email: string) => {
    setCcList((prev) => prev.filter((x) => x.email.toLowerCase() !== email.toLowerCase()))
  }, [])
  const addBcc = useCallback((e: RecipientEntry) => {
    setBccList((prev) => prev.find((x) => (e.personId && x.personId === e.personId) || x.email.toLowerCase() === e.email.toLowerCase()) ? prev : [...prev, e])
  }, [])
  const removeBcc = useCallback((email: string) => {
    setBccList((prev) => prev.filter((x) => x.email.toLowerCase() !== email.toLowerCase()))
  }, [])

  const addDepartmentRecipients = useCallback(() => {
    if (!selectedDepartment) return
    const members = contacts.filter((c) => c.department === selectedDepartment && isSelectable(c))
    setToList((prev) => {
      const existing = new Set(prev.map((r) => r.email.toLowerCase()))
      const next = [...prev]
      for (const c of members) {
        if (!existing.has(c.aiEmail.toLowerCase())) {
          next.push({
            email: c.aiEmail,
            displayName: c.name,
            personId: c.personId,
            department: c.department,
            position: c.position,
            mailboxStatus: c.mailboxStatus,
            fromDirectory: true,
          })
          existing.add(c.aiEmail.toLowerCase())
        }
      }
      return next
    })
    setError(null)
  }, [contacts, selectedDepartment])

  const resolveBulkRecipients = useCallback((): BulkEmailRecipient[] => {
    return toList.map((r) => {
      const matched = contacts.find((c) =>
        (r.personId && c.personId === r.personId) ||
        c.aiEmail.toLowerCase() === r.email.toLowerCase(),
      )
      return {
        id: r.personId || matched?.personId || r.email,
        name: r.displayName || matched?.name || r.email,
        email: r.email,
        department: r.department || matched?.department,
        position: r.position || matched?.position,
      }
    })
  }, [contacts, toList])

  /* ---- Attachment helpers ---- */
  const handleSelectAttachments = useCallback(async () => {
    const result = await window.electronAPI.emailSelectAttachments()
    if (!result.ok || !result.files?.length) return
    for (const file of result.files) {
      if (file.sizeBytes > MAX_ATTACHMENT_BYTES) {
        setError(`文件 "${file.fileName}" 超过单个附件大小限制（25MB）`)
        return
      }
    }
    setAttachments((prev) => {
      const next = [...prev]
      for (const file of result.files!) {
        if (!next.find((a) => a.filePath === file.filePath)) {
          next.push(file)
        }
      }
      const total = next.reduce((s, a) => s + a.sizeBytes, 0)
      if (total > MAX_TOTAL_BYTES) {
        setError('附件总大小超过限制（50MB），请删除部分附件后再添加')
        return prev
      }
      setError(null)
      return next
    })
  }, [])

  const removeAttachment = useCallback((filePath: string) => {
    setAttachments((prev) => prev.filter((a) => a.filePath !== filePath))
    setError(null)
  }, [])

  /* ---- Validation ---- */
  const totalAttachBytes = attachments.reduce((s, a) => s + a.sizeBytes, 0)
  const hasBlockedRecipients = [...toList, ...ccList, ...bccList].some(
    r => r.fromDirectory && r.mailboxStatus && r.mailboxStatus !== 'active'
  )
  const bulkAiSendableDrafts = bulkDrafts.filter((d) => d.status !== 'sent' && d.status !== 'sending')
  const canSend = composeMode === 'bulk' && bulkMode === 'ai'
    ? bulkAiSendableDrafts.length > 0 && !sending && !generatingBulkDrafts && totalAttachBytes <= MAX_TOTAL_BYTES && !hasBlockedRecipients
    : toList.length > 0 && !sending && totalAttachBytes <= MAX_TOTAL_BYTES && !hasBlockedRecipients

  const handleGenerateBulkDrafts = useCallback(async () => {
    if (toList.length === 0) { setError('请至少添加一个群发收件人。'); return }
    if (!bulkGoal.trim()) { setError('请输入 AI 个性化群发目标。'); return }
    const blocked = toList.filter(r => r.fromDirectory && r.mailboxStatus && r.mailboxStatus !== 'active')
    if (blocked.length > 0) {
      setError(`以下收件人无法生成正式群发草稿：${blocked.map((r) => r.displayName || r.email).join('、')}`)
      return
    }
    setGeneratingBulkDrafts(true)
    setError(null)
    try {
      const senderName = state.phase === 'logged_in'
        ? (state.session.user.displayName || state.session.user.username)
        : accountConfig?.displayName
      const senderEmail = accountConfig?.email || accountConfig?.user
      const drafts = await generateBulkEmailDrafts({
        objective: bulkGoal,
        suggestedSubject: subject,
        recipients: resolveBulkRecipients(),
        senderName,
        senderEmail,
      })
      setBulkDrafts(drafts)
    } catch (err) {
      setError(`群发草稿生成失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setGeneratingBulkDrafts(false)
    }
  }, [accountConfig, bulkGoal, resolveBulkRecipients, state, subject, toList])

  const updateBulkDraft = useCallback((id: string, patch: Partial<Pick<BulkEmailDraft, 'subject' | 'body'>>) => {
    setBulkDrafts((prev) => prev.map((draft) => (
      draft.id === id
        ? { ...draft, ...patch, status: draft.status === 'sent' || draft.status === 'sending' ? draft.status : 'ready', error: undefined }
        : draft
    )))
  }, [])

  /* ---- Send ---- */
  const handleSend = useCallback(async () => {
    if (toList.length === 0) { setError('请至少添加一个收件人。'); return }

    // Pre-send mailboxStatus validation for directory contacts
    const allRecipients = [...toList, ...ccList, ...bccList]
    const blocked = allRecipients.filter(r => r.fromDirectory && r.mailboxStatus && r.mailboxStatus !== 'active')
    if (blocked.length > 0) {
      const lines = blocked.map(r => {
        const label = r.displayName || r.email
        return `${label}（${mailboxStatusText(r.mailboxStatus)}）`
      })
      setError(`以下收件人无法发送邮件：${lines.join('、')}`)
      return
    }

    // All emails should already be validated via commitEmail, but double-check
    for (const r of allRecipients) {
      if (!EMAIL_REGEX.test(r.email)) {
        setError(`邮箱地址格式不正确：${r.email}`)
        return
      }
    }
    if (totalAttachBytes > MAX_TOTAL_BYTES) {
      setError('附件总大小超过限制（50MB），请删除部分附件后重试。')
      return
    }

    if (composeMode === 'bulk' && bulkMode === 'same') {
      setSending(true)
      setError(null)
      try {
        for (const recipient of toList) {
          await sendBlank({
            to: [recipient.email],
            subject: subject.trim(),
            body,
            attachments,
          })
        }
        onClose()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(`群发邮件发送失败：${msg}`)
      } finally {
        setSending(false)
      }
      return
    }

    if (composeMode === 'bulk' && bulkMode === 'ai') {
      const targets = bulkDrafts.filter((draft) => draft.status !== 'sent')
      if (targets.length === 0) { setError('请先生成并确认群发草稿。'); return }
      setSending(true)
      setError(null)
      let failedCount = 0
      for (const draft of targets) {
        if (!draft.subject.trim() || !draft.body.trim()) {
          setBulkDrafts((prev) => prev.map((item) => item.id === draft.id ? { ...item, status: 'failed', error: '主题或正文为空' } : item))
          failedCount += 1
          continue
        }
        setBulkDrafts((prev) => prev.map((item) => item.id === draft.id ? { ...item, status: 'sending', error: undefined } : item))
        try {
          await sendBlank({
            to: [draft.recipient.email],
            subject: draft.subject.trim(),
            body: draft.body,
            attachments,
          })
          setBulkDrafts((prev) => prev.map((item) => item.id === draft.id ? { ...item, status: 'sent', error: undefined } : item))
        } catch (err) {
          failedCount += 1
          const msg = err instanceof Error ? err.message : String(err)
          setBulkDrafts((prev) => prev.map((item) => item.id === draft.id ? { ...item, status: 'failed', error: msg } : item))
        }
      }
      setSending(false)
      if (failedCount > 0) {
        setError(`群发完成，但有 ${failedCount} 封发送失败，请检查草稿状态后重试。`)
      } else {
        onClose()
      }
      return
    }

    const payload: ComposePayload = {
      to: toList.map((r) => r.email),
      cc: ccList.map((r) => r.email),
      bcc: bccList.map((r) => r.email),
      subject: subject.trim(),
      body,
      attachments,
    }

    setSending(true)
    setError(null)
    try {
      await sendBlank(payload)
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('认证失败') || msg.includes('AUTH') || msg.includes('username or password')) {
        setError('邮箱账号或密码认证失败，请检查内部邮箱配置。')
      } else {
        setError(`邮件发送失败：${msg}`)
      }
    } finally {
      setSending(false)
    }
  }, [toList, ccList, bccList, subject, body, attachments, totalAttachBytes, composeMode, bulkMode, bulkDrafts, sendBlank, onClose])

  /* ---- Keyboard dismiss ---- */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <Overlay onClick={onClose}>
        <Modal onClick={(e) => e.stopPropagation()}>
          <ModalHeader>
          <HeaderLeft>
            <ModalTitle>{variant === 'forward' ? '转发邮件' : '新建邮件'}</ModalTitle>
            {allowBulkMode && (
              <ModeTabs>
                <ModeTab type="button" $active={composeMode === 'single'} onClick={() => setComposeMode('single')}>
                  普通邮件
                </ModeTab>
                <ModeTab type="button" $active={composeMode === 'bulk'} onClick={() => setComposeMode('bulk')}>
                  群发邮件
                </ModeTab>
              </ModeTabs>
            )}
          </HeaderLeft>
          <CloseBtn type="button" onClick={onClose} title="关闭">✕</CloseBtn>
        </ModalHeader>

        <ModalBody>
          {composeMode === 'bulk' && (
            <BulkOptions>
              <BulkModeRow>
                <BulkModeBtn type="button" $active={bulkMode === 'same'} onClick={() => setBulkMode('same')}>
                  同一正文群发
                </BulkModeBtn>
                <BulkModeBtn type="button" $active={bulkMode === 'ai'} onClick={() => setBulkMode('ai')}>
                  AI 个性化群发
                </BulkModeBtn>
              </BulkModeRow>
              <BulkHint>
                群发会为每位收件人单独发送一封邮件，不会把多人合并到同一个 To，也不会默认使用 BCC。
              </BulkHint>
              {departments.length > 0 && (
                <BulkToolbar>
                  <BulkSelect value={selectedDepartment} onChange={(e) => setSelectedDepartment(e.target.value)}>
                    <option value="">按部门选择联系人</option>
                    {departments.map((dept) => <option key={dept} value={dept}>{dept}</option>)}
                  </BulkSelect>
                  <SmallActionBtn type="button" onClick={addDepartmentRecipients} disabled={!selectedDepartment}>
                    添加部门联系人
                  </SmallActionBtn>
                </BulkToolbar>
              )}
            </BulkOptions>
          )}

          {/* To */}
          <FieldRow>
            <FieldLabel>收件人</FieldLabel>
            <FieldContent>
              <RecipientsInput
                recipients={toList}
                onAdd={addTo}
                onRemove={removeFrom}
                contacts={contacts}
                contactsError={contactsError}
                placeholder="搜索联系人或输入邮箱"
                autoFocus
              />
            </FieldContent>
            {composeMode === 'single' && (
              <>
                <FieldToggle type="button" onClick={() => { setShowCc((v) => !v); setShowBcc(false) }}>
                  {showCc ? '隐藏抄送' : '抄送'}
                </FieldToggle>
                <FieldToggle type="button" onClick={() => { setShowBcc((v) => !v); setShowCc(false) }}>
                  {showBcc ? '隐藏密送' : '密送'}
                </FieldToggle>
              </>
            )}
          </FieldRow>

          {/* CC */}
          {composeMode === 'single' && showCc && (
            <FieldRow>
              <FieldLabel>抄送</FieldLabel>
              <FieldContent>
                <RecipientsInput
                  recipients={ccList}
                  onAdd={addCc}
                  onRemove={removeCc}
                  contacts={contacts}
                  contactsError={contactsError}
                  placeholder="搜索联系人或输入邮箱"
                />
              </FieldContent>
            </FieldRow>
          )}

          {/* BCC */}
          {composeMode === 'single' && showBcc && (
            <FieldRow>
              <FieldLabel>密送</FieldLabel>
              <FieldContent>
                <RecipientsInput
                  recipients={bccList}
                  onAdd={addBcc}
                  onRemove={removeBcc}
                  contacts={contacts}
                  contactsError={contactsError}
                  placeholder="搜索联系人或输入邮箱"
                />
              </FieldContent>
            </FieldRow>
          )}

          {/* Subject */}
          <FieldRow>
            <FieldLabel>主题</FieldLabel>
            <FieldContent>
              <SubjectInput
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="邮件主题"
              />
            </FieldContent>
          </FieldRow>

          {/* Body */}
          <BodyRow>
            <BodyTextarea
              value={composeMode === 'bulk' && bulkMode === 'ai' ? bulkGoal : body}
              onChange={(e) => {
                if (composeMode === 'bulk' && bulkMode === 'ai') setBulkGoal(e.target.value)
                else setBody(e.target.value)
              }}
              placeholder={composeMode === 'bulk' && bulkMode === 'ai'
                ? '输入群发目标，例如：给招生办所有老师发一封邀请参加 AI Office 宣讲会的邮件'
                : '正文内容...'}
            />
            {composeMode === 'bulk' && bulkMode === 'ai' && (
              <BulkToolbar style={{ marginTop: 10 }}>
                <SmallActionBtn type="button" onClick={handleGenerateBulkDrafts} disabled={generatingBulkDrafts || toList.length === 0 || !bulkGoal.trim()}>
                  {generatingBulkDrafts ? '生成中...' : '生成个性化草稿'}
                </SmallActionBtn>
                <BulkHint>AI 只生成逐封草稿，必须由你预览、编辑并点击确认后才会发送。</BulkHint>
              </BulkToolbar>
            )}
          </BodyRow>

          {composeMode === 'bulk' && bulkMode === 'ai' && bulkDrafts.length > 0 && (
            <BulkDraftPanel>
              <BulkDraftHeader>
                <span>逐封预览与编辑（{bulkDrafts.length}）</span>
                <span>{bulkDrafts.filter((draft) => draft.status === 'sent').length} 封已发送</span>
              </BulkDraftHeader>
              <BulkDraftList>
                {bulkDrafts.map((draft) => (
                  <BulkDraftCard key={draft.id}>
                    <BulkDraftMeta>
                      <span>
                        {draft.recipient.name} &lt;{draft.recipient.email}&gt;
                        {draft.recipient.department ? ` · ${draft.recipient.department}` : ''}
                        {draft.recipient.position ? ` · ${draft.recipient.position}` : ''}
                      </span>
                      <BulkDraftStatus $status={draft.status}>
                        {bulkDraftStatusText(draft.status)}
                        {draft.error ? `：${draft.error}` : ''}
                      </BulkDraftStatus>
                    </BulkDraftMeta>
                    <BulkDraftSubject
                      value={draft.subject}
                      onChange={(e) => updateBulkDraft(draft.id, { subject: e.target.value })}
                      disabled={draft.status === 'sending' || draft.status === 'sent'}
                      placeholder="邮件主题"
                    />
                    <BulkDraftBody
                      value={draft.body}
                      onChange={(e) => updateBulkDraft(draft.id, { body: e.target.value })}
                      disabled={draft.status === 'sending' || draft.status === 'sent'}
                      placeholder="邮件正文"
                    />
                  </BulkDraftCard>
                ))}
              </BulkDraftList>
            </BulkDraftPanel>
          )}
        </ModalBody>

        {/* Attachments */}
        <AttachmentsArea>
          <AttachBtn type="button" onClick={handleSelectAttachments} disabled={sending}>
            📎 添加附件
          </AttachBtn>
          {attachments.length > 0 && (
            <AttachList>
              {attachments.map((a) => (
                <AttachItem key={a.filePath}>
                  <AttachIcon>{getAttachIcon(a.mimeType, a.fileName)}</AttachIcon>
                  <AttachName title={a.fileName}>{a.fileName}</AttachName>
                  <AttachSize>{formatBytes(a.sizeBytes)}</AttachSize>
                  <AttachRemove type="button" onClick={() => removeAttachment(a.filePath)} title="移除附件">✕</AttachRemove>
                </AttachItem>
              ))}
              <div style={{ fontSize: 14, color: '#9faebd', marginTop: 2 }}>
                共 {attachments.length} 个附件，{formatBytes(totalAttachBytes)}
                {totalAttachBytes > MAX_TOTAL_BYTES && (
                  <span style={{ color: '#e53e3e', marginLeft: 8 }}>⚠ 超过 50MB 限制</span>
                )}
              </div>
            </AttachList>
          )}
        </AttachmentsArea>

        <ModalFooter>
          <FooterLeft>
            {error}
            {!error && hasBlockedRecipients && (
              <span style={{ color: '#856404' }}>
                ⚠ 部分收件人的 AI 邮箱不可用，无法发送。
              </span>
            )}
          </FooterLeft>
          <FooterRight>
            <CancelBtn type="button" onClick={onClose} disabled={sending}>取消</CancelBtn>
            <SendBtn
              type="button"
              onClick={handleSend}
              disabled={!canSend}
              title={hasBlockedRecipients ? '部分收件人邮箱不可用，无法发送' : undefined}
            >
              {sending
                ? '发送中...'
                : composeMode === 'bulk'
                  ? (bulkMode === 'ai' ? '确认批量发送' : '逐封群发')
                  : '发送'}
            </SendBtn>
          </FooterRight>
        </ModalFooter>
      </Modal>
    </Overlay>
  )
}
