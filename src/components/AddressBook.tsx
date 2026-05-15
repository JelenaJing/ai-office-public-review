/**
 * AddressBook — AI Office 通讯录
 *
 * 结构：
 *   顶部：搜索框
 *   左侧导航：最近会话 | 通讯录（全部人员 / 按部门 / 项目组 / 已开通邮箱 / 已开通内部通讯）
 *   右侧：列表 + 人员详情卡片
 *
 * 数据来源：AccountCenter 真实人员
 *   - testuser/mock 用户不显示
 *   - administrator 可显示（由服务端保留）
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import styled from 'styled-components'
import { useInternalSession } from '../contexts/InternalAccountContext'
import * as ac from '../services/accountCenterClient'
import type {
  PersonProfile,
  PersonDetail,
  OrgUnit,
  OrgUnitMember,
  ProjectGroup,
  ProjectGroupMember,
  EmailContact,
  ChatContactAC,
} from '../types/personDirectory'

/* ================================================================== */
/*  Types                                                             */
/* ================================================================== */

type NavSection =
  | 'recent'
  | 'all'
  | 'by-dept'
  | 'projects'
  | 'has-email'
  | 'has-chat'

/* ================================================================== */
/*  Styled                                                             */
/* ================================================================== */

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #f7f8fb;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif;
`

const SearchBar = styled.div`
  padding: 10px 14px 8px;
  border-bottom: 1px solid #e5eaf0;
  background: #ffffff;
  flex-shrink: 0;
`

const SearchInput = styled.input`
  width: 100%;
  box-sizing: border-box;
  padding: 9px 12px;
  border: 1.5px solid #d6e0ea;
  border-radius: 10px;
  font-size: 13px;
  color: #1f3142;
  background: #f9fbfd;
  outline: none;
  transition: border-color 0.15s;
  &:focus { border-color: #4a90d9; background: #fff; }
  &::placeholder { color: #b0bec5; }
`

const Body = styled.div`
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
`

const NavPane = styled.div`
  width: 140px;
  border-right: 1px solid #e5eaf0;
  background: #ffffff;
  flex-shrink: 0;
  overflow-y: auto;
  padding: 8px 0;
`

const NavGroup = styled.div`
  margin-bottom: 4px;
`

const NavGroupLabel = styled.div`
  padding: 8px 12px 4px;
  font-size: 11px;
  font-weight: 700;
  color: #9faebd;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`

const NavItem = styled.button<{ $active?: boolean }>`
  display: block;
  width: 100%;
  text-align: left;
  padding: 7px 12px;
  font-size: 12px;
  color: ${p => p.$active ? '#1558b8' : '#304255'};
  background: ${p => p.$active ? '#e8f0fe' : 'transparent'};
  border: none;
  border-left: 3px solid ${p => p.$active ? '#1558b8' : 'transparent'};
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  &:hover { background: ${p => p.$active ? '#e8f0fe' : '#f4f7fa'}; }
`

const ContentPane = styled.div`
  flex: 1;
  display: flex;
  min-width: 0;
  overflow: hidden;
`

const ListPane = styled.div`
  width: 260px;
  border-right: 1px solid #e5eaf0;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  overflow: hidden;
`

const ListHeader = styled.div`
  padding: 10px 12px 6px;
  border-bottom: 1px solid #eef1f5;
  flex-shrink: 0;
`

const ListTitle = styled.div`
  font-size: 12px;
  font-weight: 700;
  color: #627385;
`

const ListScroll = styled.div`
  flex: 1;
  overflow-y: auto;
  min-height: 0;
`

const ListItem = styled.div<{ $active?: boolean }>`
  padding: 9px 12px;
  cursor: pointer;
  border-bottom: 1px solid #f0f4f8;
  background: ${p => p.$active ? '#e8f0fe' : 'transparent'};
  &:hover { background: ${p => p.$active ? '#e8f0fe' : '#f4f8fe'}; }
`

const ItemName = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: #1a202c;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

const ItemSub = styled.div`
  font-size: 11px;
  color: #718096;
  margin-top: 1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

const ItemBadge = styled.span<{ $ok?: boolean; $warn?: boolean; $disabled?: boolean }>`
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 999px;
  font-weight: 700;
  margin-left: 4px;
  background: ${p => p.$ok ? '#d4edda' : p.$warn ? '#fff3cd' : p.$disabled ? '#f0f0f0' : '#f0f0f0'};
  color: ${p => p.$ok ? '#155724' : p.$warn ? '#856404' : p.$disabled ? '#999' : '#666'};
`

const DetailPane = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  background: #f7f8fb;
  min-width: 0;
`

const DetailCard = styled.div`
  background: #ffffff;
  border: 1px solid #e5eaf0;
  border-radius: 14px;
  padding: 20px 22px;
  box-shadow: 0 2px 8px rgba(15,25,40,0.06);
`

const DetailName = styled.div`
  font-size: 18px;
  font-weight: 800;
  color: #1a3150;
  margin-bottom: 2px;
`

const DetailEnName = styled.div`
  font-size: 13px;
  color: #718096;
  margin-bottom: 12px;
`

const DetailSection = styled.div`
  margin-top: 14px;
  border-top: 1px solid #eef1f5;
  padding-top: 12px;
`

const DetailSectionTitle = styled.div`
  font-size: 11px;
  font-weight: 700;
  color: #9faebd;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
`

const DetailField = styled.div`
  display: flex;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 13px;
`

const DetailLabel = styled.span`
  color: #718096;
  flex-shrink: 0;
  width: 90px;
`

const DetailValue = styled.span`
  color: #1a202c;
  word-break: break-all;
`

const StatusChip = styled.span<{ $status?: string }>`
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  font-weight: 700;
  background: ${p =>
    p.$status === 'active' ? '#d4edda'
    : p.$status === 'not_created' ? '#fff3cd'
    : p.$status === 'failed' || p.$status === 'disabled' ? '#f8d7da'
    : '#e2e8f0'};
  color: ${p =>
    p.$status === 'active' ? '#155724'
    : p.$status === 'not_created' ? '#856404'
    : p.$status === 'failed' || p.$status === 'disabled' ? '#721c24'
    : '#627385'};
`

const EmptyState = styled.div`
  padding: 40px 20px;
  text-align: center;
  color: #9faebd;
  font-size: 13px;
  line-height: 1.8;
`

const ErrorState = styled.div`
  padding: 20px;
  background: #fff6f6;
  border: 1px solid #f1c5c5;
  border-radius: 10px;
  color: #b33838;
  font-size: 13px;
  margin: 12px;
  line-height: 1.6;
`

const LoadingState = styled.div`
  padding: 20px;
  text-align: center;
  color: #9faebd;
  font-size: 13px;
`

const MemberRow = styled.div<{ $active?: boolean }>`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  cursor: pointer;
  border-bottom: 1px solid #f0f4f8;
  background: ${p => p.$active ? '#e8f0fe' : 'transparent'};
  &:hover { background: ${p => p.$active ? '#e8f0fe' : '#f4f8fe'}; }
`

const MemberAvatar = styled.div`
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
`

const MemberInfo = styled.div`
  flex: 1;
  min-width: 0;
`

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */

function getInitials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  if (/[\u4e00-\u9fff]/.test(trimmed)) {
    return trimmed.slice(-2)
  }
  const words = trimmed.split(/\s+/)
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase()
  return trimmed.slice(0, 2).toUpperCase()
}

function statusLabel(status?: string): string {
  if (!status) return '未知'
  if (status === 'active') return '已开通'
  if (status === 'not_created') return '未创建'
  if (status === 'disabled') return '已禁用'
  if (status === 'failed') return '创建失败'
  return status
}

function matchQuery(q: string, ...fields: (string | undefined)[]): boolean {
  if (!q.trim()) return true
  const lower = q.toLowerCase()
  return fields.some((f) => f && f.toLowerCase().includes(lower))
}

/* ================================================================== */
/*  Sub-components                                                     */
/* ================================================================== */

function PersonDetailView({ personId, token }: { personId: string; token: string }) {
  const [detail, setDetail] = useState<PersonDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!personId) return
    setLoading(true)
    setError(null)
    ac.getPersonDetail(token, personId)
      .then(setDetail)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [personId, token])

  if (loading) return <LoadingState>加载中…</LoadingState>
  if (error) return <ErrorState>无法加载人员详情：{error}</ErrorState>
  if (!detail) return null

  const primaryFormal = detail.formalMemberships?.find((m) => m.isPrimary)
    ?? detail.formalMemberships?.[0]

  const mailStatus = detail.mailIdentity?.status ?? 'not_created'
  const chatStatus = detail.chatIdentity?.status ?? 'not_created'
  const accountStatus = detail.accountIdentity?.status ?? 'unknown'

  return (
    <DetailCard>
      <DetailName>{detail.name}</DetailName>
      {detail.enName && <DetailEnName>{detail.enName}</DetailEnName>}

      <DetailField>
        <DetailLabel>工号</DetailLabel>
        <DetailValue>{detail.employeeId || '—'}</DetailValue>
      </DetailField>
      <DetailField>
        <DetailLabel>职位</DetailLabel>
        <DetailValue>{detail.position || '—'}</DetailValue>
      </DetailField>
      {primaryFormal && (
        <DetailField>
          <DetailLabel>主要单位</DetailLabel>
          <DetailValue>{primaryFormal.orgUnitName || primaryFormal.orgUnitId}</DetailValue>
        </DetailField>
      )}
      <DetailField>
        <DetailLabel>办公电话</DetailLabel>
        <DetailValue>{detail.phone || '—'}</DetailValue>
      </DetailField>
      <DetailField>
        <DetailLabel>办公地址</DetailLabel>
        <DetailValue>{detail.officeAddress || '—'}</DetailValue>
      </DetailField>

      <DetailSection>
        <DetailSectionTitle>正式所属单位</DetailSectionTitle>
        {(!detail.formalMemberships || detail.formalMemberships.length === 0) ? (
          <DetailValue style={{ fontSize: 13, color: '#9faebd' }}>暂无记录</DetailValue>
        ) : (
          detail.formalMemberships.map((m, i) => (
            <DetailField key={i}>
              <DetailLabel>{m.isPrimary ? '主要单位' : '所属单位'}</DetailLabel>
              <DetailValue>{m.orgUnitName || m.orgUnitId}{m.role ? ` · ${m.role}` : ''}</DetailValue>
            </DetailField>
          ))
        )}
      </DetailSection>

      {detail.projectMemberships && detail.projectMemberships.length > 0 && (
        <DetailSection>
          <DetailSectionTitle>项目归属</DetailSectionTitle>
          {detail.projectMemberships.map((m, i) => (
            <DetailField key={i}>
              <DetailLabel>项目组</DetailLabel>
              <DetailValue>{m.projectGroupName || m.projectGroupId}{m.role ? ` · ${m.role}` : ''}</DetailValue>
            </DetailField>
          ))}
        </DetailSection>
      )}

      <DetailSection>
        <DetailSectionTitle>邮箱信息</DetailSectionTitle>
        <DetailField>
          <DetailLabel>AI Office 邮箱</DetailLabel>
          <DetailValue>
            {detail.aiEmail || detail.mailIdentity?.aiEmail || '—'}
            {' '}<StatusChip $status={mailStatus}>{statusLabel(mailStatus)}</StatusChip>
          </DetailValue>
        </DetailField>
        <DetailField>
          <DetailLabel>原办公邮箱</DetailLabel>
          <DetailValue>{detail.sourceEmail || '—'}</DetailValue>
        </DetailField>
      </DetailSection>

      <DetailSection>
        <DetailSectionTitle>账号状态</DetailSectionTitle>
        <DetailField>
          <DetailLabel>登录账号</DetailLabel>
          <DetailValue><StatusChip $status={accountStatus}>{statusLabel(accountStatus)}</StatusChip></DetailValue>
        </DetailField>
        <DetailField>
          <DetailLabel>内部通讯</DetailLabel>
          <DetailValue><StatusChip $status={chatStatus}>{statusLabel(chatStatus)}</StatusChip></DetailValue>
        </DetailField>
        <DetailField>
          <DetailLabel>邮箱</DetailLabel>
          <DetailValue><StatusChip $status={mailStatus}>{statusLabel(mailStatus)}</StatusChip></DetailValue>
        </DetailField>
      </DetailSection>
    </DetailCard>
  )
}

/* ================================================================== */
/*  Main Component                                                     */
/* ================================================================== */

export default function AddressBook() {
  const session = useInternalSession()
  const token = session?.token ?? ''

  const [navSection, setNavSection] = useState<NavSection>('all')
  const [query, setQuery] = useState('')
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null)
  const [selectedOrgUnitId, setSelectedOrgUnitId] = useState<string | null>(null)
  const [selectedProjectGroupId, setSelectedProjectGroupId] = useState<string | null>(null)

  // Data
  const [people, setPeople] = useState<PersonProfile[]>([])
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([])
  const [projectGroups, setProjectGroups] = useState<ProjectGroup[]>([])
  const [orgMembers, setOrgMembers] = useState<OrgUnitMember[]>([])
  const [projectMembers, setProjectMembers] = useState<ProjectGroupMember[]>([])
  const [emailContacts, setEmailContacts] = useState<EmailContact[]>([])
  const [chatContacts, setChatContacts] = useState<ChatContactAC[]>([])

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [membersLoading, setMembersLoading] = useState(false)

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* ---- Load data by section ---- */
  useEffect(() => {
    if (!token) return
    setError(null)

    if (navSection === 'all') {
      setLoading(true)
      ac.getPeople(token, { pageSize: 500 })
        .then(setPeople)
        .catch((err) => setError(err instanceof Error ? err.message : '无法连接账号中心，请检查 AccountCenter 服务状态。'))
        .finally(() => setLoading(false))
    } else if (navSection === 'by-dept') {
      setLoading(true)
      ac.getOrgUnits(token)
        .then(setOrgUnits)
        .catch((err) => setError(err instanceof Error ? err.message : '无法连接账号中心，请检查 AccountCenter 服务状态。'))
        .finally(() => setLoading(false))
    } else if (navSection === 'projects') {
      setLoading(true)
      ac.getProjectGroups(token)
        .then(setProjectGroups)
        .catch((err) => setError(err instanceof Error ? err.message : '无法连接账号中心，请检查 AccountCenter 服务状态。'))
        .finally(() => setLoading(false))
    } else if (navSection === 'has-email') {
      setLoading(true)
      ac.getEmailContacts(token)
        .then(setEmailContacts)
        .catch((err) => setError(err instanceof Error ? err.message : '无法连接账号中心，请检查 AccountCenter 服务状态。'))
        .finally(() => setLoading(false))
    } else if (navSection === 'has-chat') {
      setLoading(true)
      ac.getChatContactsAC(token)
        .then(setChatContacts)
        .catch((err) => setError(err instanceof Error ? err.message : '无法连接账号中心，请检查 AccountCenter 服务状态。'))
        .finally(() => setLoading(false))
    }
  }, [navSection, token])

  /* ---- Load org unit members ---- */
  useEffect(() => {
    if (!token || !selectedOrgUnitId) return
    setMembersLoading(true)
    setOrgMembers([])
    ac.getOrgUnitMembers(token, selectedOrgUnitId)
      .then(setOrgMembers)
      .catch(() => setOrgMembers([]))
      .finally(() => setMembersLoading(false))
  }, [selectedOrgUnitId, token])

  /* ---- Load project group members ---- */
  useEffect(() => {
    if (!token || !selectedProjectGroupId) return
    setMembersLoading(true)
    setProjectMembers([])
    ac.getProjectGroupMembers(token, selectedProjectGroupId)
      .then(setProjectMembers)
      .catch(() => setProjectMembers([]))
      .finally(() => setMembersLoading(false))
  }, [selectedProjectGroupId, token])

  /* ---- Debounced search ---- */
  const handleQueryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setQuery(val)
    if (navSection === 'all' && token && val.trim().length >= 1) {
      if (searchTimer.current) clearTimeout(searchTimer.current)
      searchTimer.current = setTimeout(() => {
        ac.getPeople(token, { q: val.trim(), pageSize: 200 })
          .then(setPeople)
          .catch(() => {/* ignore search errors */})
      }, 350)
    }
  }, [navSection, token])

  /* ---- Filtered lists ---- */
  const filteredPeople = useMemo(() =>
    people.filter((p) => matchQuery(query, p.name, p.enName, p.department, p.position, p.aiEmail, p.employeeId)),
    [people, query])

  const filteredOrgUnits = useMemo(() =>
    orgUnits.filter((u) => matchQuery(query, u.name, u.enName)),
    [orgUnits, query])

  const filteredProjectGroups = useMemo(() =>
    projectGroups.filter((g) => matchQuery(query, g.name, g.enName, g.parentCandidate)),
    [projectGroups, query])

  const filteredEmailContacts = useMemo(() =>
    emailContacts.filter((c) => matchQuery(query, c.name, c.enName, c.aiEmail, c.department, c.position, c.employeeId, c.sourceEmail)),
    [emailContacts, query])

  const filteredChatContacts = useMemo(() =>
    chatContacts.filter((c) => matchQuery(query, c.name, c.enName, c.department, c.position, c.employeeId, c.aiEmail)),
    [chatContacts, query])

  const filteredOrgMembers = useMemo(() =>
    orgMembers.filter((m) => matchQuery(query, m.name, m.enName, m.position, m.aiEmail)),
    [orgMembers, query])

  const filteredProjectMembers = useMemo(() =>
    projectMembers.filter((m) => matchQuery(query, m.name, m.enName, m.position, m.aiEmail)),
    [projectMembers, query])

  /* ---- Render list content ---- */
  const renderListContent = () => {
    if (!token) {
      return <EmptyState>请先登录账号中心</EmptyState>
    }
    if (loading) return <LoadingState>加载中…</LoadingState>
    if (error) return <ErrorState>{error}</ErrorState>

    if (navSection === 'by-dept') {
      if (filteredOrgUnits.length === 0) return <EmptyState>暂无通讯录数据，请先在 AccountCenter 导入人员。</EmptyState>
      return (
        <>
          {filteredOrgUnits.map((unit) => (
            <ListItem
              key={unit.orgUnitId}
              $active={selectedOrgUnitId === unit.orgUnitId}
              onClick={() => {
                setSelectedOrgUnitId(unit.orgUnitId)
                setSelectedPersonId(null)
                setSelectedProjectGroupId(null)
              }}
            >
              <ItemName>{unit.name}</ItemName>
              <ItemSub>
                {unit.enName || ''}
                {unit.memberCount != null ? ` · ${unit.memberCount} 人` : ''}
              </ItemSub>
            </ListItem>
          ))}
        </>
      )
    }

    if (navSection === 'projects') {
      if (filteredProjectGroups.length === 0) return <EmptyState>暂无项目组数据</EmptyState>
      return (
        <>
          {filteredProjectGroups.map((g) => (
            <ListItem
              key={g.projectGroupId}
              $active={selectedProjectGroupId === g.projectGroupId}
              onClick={() => {
                setSelectedProjectGroupId(g.projectGroupId)
                setSelectedPersonId(null)
                setSelectedOrgUnitId(null)
              }}
            >
              <ItemName>{g.name}</ItemName>
              <ItemSub>
                {g.enName || ''}
                {g.parentCandidate ? ` · ${g.parentCandidate}` : ''}
                {g.memberCount != null ? ` · ${g.memberCount} 人` : ''}
              </ItemSub>
            </ListItem>
          ))}
        </>
      )
    }

    if (navSection === 'has-email') {
      if (filteredEmailContacts.length === 0) return <EmptyState>暂无已开通邮箱的人员</EmptyState>
      return (
        <>
          {filteredEmailContacts.map((c) => (
            <MemberRow
              key={c.personId}
              $active={selectedPersonId === c.personId}
              onClick={() => setSelectedPersonId(c.personId)}
            >
              <MemberAvatar>{getInitials(c.name)}</MemberAvatar>
              <MemberInfo>
                <ItemName>{c.name}{c.enName ? <span style={{ fontWeight: 400, color: '#718096' }}> {c.enName}</span> : null}</ItemName>
                <ItemSub>
                  {c.aiEmail}
                  <ItemBadge $ok={c.mailboxStatus === 'active'} $warn={c.mailboxStatus === 'not_created'} $disabled={c.mailboxStatus === 'disabled' || c.mailboxStatus === 'failed'}>
                    {statusLabel(c.mailboxStatus)}
                  </ItemBadge>
                </ItemSub>
              </MemberInfo>
            </MemberRow>
          ))}
        </>
      )
    }

    if (navSection === 'has-chat') {
      if (filteredChatContacts.length === 0) return <EmptyState>暂无已开通内部通讯的人员</EmptyState>
      return (
        <>
          {filteredChatContacts.map((c) => (
            <MemberRow
              key={c.personId}
              $active={selectedPersonId === c.personId}
              onClick={() => setSelectedPersonId(c.personId)}
            >
              <MemberAvatar>{getInitials(c.name)}</MemberAvatar>
              <MemberInfo>
                <ItemName>{c.name}{c.enName ? <span style={{ fontWeight: 400, color: '#718096' }}> {c.enName}</span> : null}</ItemName>
                <ItemSub>
                  {c.department || c.position || ''}
                  <ItemBadge $ok={c.chatStatus === 'active'} $warn={c.chatStatus === 'not_created'}>
                    {statusLabel(c.chatStatus)}
                  </ItemBadge>
                </ItemSub>
              </MemberInfo>
            </MemberRow>
          ))}
        </>
      )
    }

    // Default: all people
    if (filteredPeople.length === 0) return <EmptyState>暂无通讯录数据，请先在 AccountCenter 导入人员。</EmptyState>
    return (
      <>
        {filteredPeople.map((p) => (
          <MemberRow
            key={p.personId}
            $active={selectedPersonId === p.personId}
            onClick={() => setSelectedPersonId(p.personId)}
          >
            <MemberAvatar>{getInitials(p.name)}</MemberAvatar>
            <MemberInfo>
              <ItemName>{p.name}{p.enName ? <span style={{ fontWeight: 400, color: '#718096' }}> {p.enName}</span> : null}</ItemName>
              <ItemSub>{p.department ? `${p.department}` : ''}{p.position ? ` · ${p.position}` : ''}</ItemSub>
            </MemberInfo>
          </MemberRow>
        ))}
      </>
    )
  }

  /* ---- Render right pane (detail or members) ---- */
  const renderDetailOrMembers = () => {
    if (navSection === 'by-dept' && selectedOrgUnitId) {
      const unit = orgUnits.find((u) => u.orgUnitId === selectedOrgUnitId)
      return (
        <DetailPane>
          {unit && (
            <DetailCard style={{ marginBottom: 14 }}>
              <DetailName>{unit.name}</DetailName>
              {unit.enName && <DetailEnName>{unit.enName}</DetailEnName>}
              <DetailField><DetailLabel>成员数量</DetailLabel><DetailValue>{unit.memberCount ?? filteredOrgMembers.length} 人</DetailValue></DetailField>
            </DetailCard>
          )}
          {membersLoading ? (
            <LoadingState>加载成员中…</LoadingState>
          ) : filteredOrgMembers.length === 0 ? (
            <EmptyState>该组织单位暂无成员</EmptyState>
          ) : (
            filteredOrgMembers.map((m) => (
              <div
                key={m.personId}
                style={{
                  background: selectedPersonId === m.personId ? '#e8f0fe' : '#fff',
                  border: '1px solid #e5eaf0',
                  borderRadius: 10,
                  padding: '10px 14px',
                  marginBottom: 8,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
                onClick={() => setSelectedPersonId(m.personId)}
              >
                <MemberAvatar>{getInitials(m.name)}</MemberAvatar>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1a202c' }}>
                    {m.name}{m.enName ? <span style={{ fontWeight: 400, color: '#718096' }}> {m.enName}</span> : null}
                  </div>
                  <div style={{ fontSize: 11, color: '#718096', marginTop: 2 }}>
                    {m.position || ''}
                    {m.aiEmail ? ` · ${m.aiEmail}` : ''}
                  </div>
                </div>
                <div>
                  <ItemBadge $ok={m.mailboxStatus === 'active'} $warn={m.mailboxStatus === 'not_created'}>
                    邮箱 {statusLabel(m.mailboxStatus)}
                  </ItemBadge>
                  <ItemBadge $ok={m.chatStatus === 'active'} $warn={m.chatStatus === 'not_created'} style={{ marginLeft: 4 }}>
                    通讯 {statusLabel(m.chatStatus)}
                  </ItemBadge>
                </div>
              </div>
            ))
          )}
          {selectedPersonId && (
            <div style={{ marginTop: 16 }}>
              <DetailSectionTitle style={{ marginBottom: 8, color: '#9faebd', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>人员详情</DetailSectionTitle>
              <PersonDetailView personId={selectedPersonId} token={token} />
            </div>
          )}
        </DetailPane>
      )
    }

    if (navSection === 'projects' && selectedProjectGroupId) {
      const group = projectGroups.find((g) => g.projectGroupId === selectedProjectGroupId)
      return (
        <DetailPane>
          {group && (
            <DetailCard style={{ marginBottom: 14 }}>
              <DetailName>{group.name}</DetailName>
              {group.enName && <DetailEnName>{group.enName}</DetailEnName>}
              {group.parentCandidate && <DetailField><DetailLabel>上级候选</DetailLabel><DetailValue>{group.parentCandidate}</DetailValue></DetailField>}
              <DetailField><DetailLabel>成员数量</DetailLabel><DetailValue>{group.memberCount ?? filteredProjectMembers.length} 人</DetailValue></DetailField>
            </DetailCard>
          )}
          {membersLoading ? (
            <LoadingState>加载成员中…</LoadingState>
          ) : filteredProjectMembers.length === 0 ? (
            <EmptyState>该项目组暂无成员</EmptyState>
          ) : (
            filteredProjectMembers.map((m) => (
              <div
                key={m.personId}
                style={{
                  background: selectedPersonId === m.personId ? '#e8f0fe' : '#fff',
                  border: '1px solid #e5eaf0',
                  borderRadius: 10,
                  padding: '10px 14px',
                  marginBottom: 8,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
                onClick={() => setSelectedPersonId(m.personId)}
              >
                <MemberAvatar>{getInitials(m.name)}</MemberAvatar>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1a202c' }}>
                    {m.name}{m.enName ? <span style={{ fontWeight: 400, color: '#718096' }}> {m.enName}</span> : null}
                  </div>
                  <div style={{ fontSize: 11, color: '#718096', marginTop: 2 }}>
                    {m.position || ''}{m.role ? ` · ${m.role}` : ''}
                  </div>
                </div>
              </div>
            ))
          )}
          {selectedPersonId && (
            <div style={{ marginTop: 16 }}>
              <PersonDetailView personId={selectedPersonId} token={token} />
            </div>
          )}
        </DetailPane>
      )
    }

    if (selectedPersonId) {
      return (
        <DetailPane>
          <PersonDetailView personId={selectedPersonId} token={token} />
        </DetailPane>
      )
    }

    return (
      <DetailPane>
        <EmptyState>点击左侧人员或组织单位查看详情</EmptyState>
      </DetailPane>
    )
  }

  return (
    <Wrap>
      <SearchBar>
        <SearchInput
          placeholder="搜索姓名 / 部门 / 职位 / 邮箱 / 工号"
          value={query}
          onChange={handleQueryChange}
        />
      </SearchBar>

      <Body>
        <NavPane>
          <NavGroup>
            <NavGroupLabel>通讯录</NavGroupLabel>
            <NavItem $active={navSection === 'all'} onClick={() => { setNavSection('all'); setSelectedPersonId(null); setSelectedOrgUnitId(null); setSelectedProjectGroupId(null) }}>
              全部人员
            </NavItem>
            <NavItem $active={navSection === 'by-dept'} onClick={() => { setNavSection('by-dept'); setSelectedPersonId(null); }}>
              按部门
            </NavItem>
            <NavItem $active={navSection === 'projects'} onClick={() => { setNavSection('projects'); setSelectedPersonId(null); }}>
              项目组
            </NavItem>
            <NavItem $active={navSection === 'has-email'} onClick={() => { setNavSection('has-email'); setSelectedPersonId(null); }}>
              已开通邮箱
            </NavItem>
            <NavItem $active={navSection === 'has-chat'} onClick={() => { setNavSection('has-chat'); setSelectedPersonId(null); }}>
              已开通通讯
            </NavItem>
          </NavGroup>
        </NavPane>

        <ContentPane>
          {/* Left list pane (hidden for by-dept and projects when showing detail pane full width) */}
          {(navSection !== 'by-dept' && navSection !== 'projects') && (
            <ListPane>
              <ListHeader>
                <ListTitle>
                  {navSection === 'all' && `全部人员 (${filteredPeople.length})`}
                  {navSection === 'has-email' && `已开通邮箱 (${filteredEmailContacts.length})`}
                  {navSection === 'has-chat' && `已开通内部通讯 (${filteredChatContacts.length})`}
                  {navSection === 'recent' && '最近会话'}
                </ListTitle>
              </ListHeader>
              <ListScroll>
                {renderListContent()}
              </ListScroll>
            </ListPane>
          )}

          {(navSection === 'by-dept' || navSection === 'projects') && (
            <ListPane>
              <ListHeader>
                <ListTitle>
                  {navSection === 'by-dept' && `组织单位 (${filteredOrgUnits.length})`}
                  {navSection === 'projects' && `项目组 (${filteredProjectGroups.length})`}
                </ListTitle>
              </ListHeader>
              <ListScroll>
                {renderListContent()}
              </ListScroll>
            </ListPane>
          )}

          {renderDetailOrMembers()}
        </ContentPane>
      </Body>
    </Wrap>
  )
}
