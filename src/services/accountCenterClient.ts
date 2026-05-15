/**
 * AccountCenter API 客户端
 *
 * 注意：
 * - 不打印 token / 密码到日志
 * - 网络错误包含地址信息（方便排查），但不包含凭据
 */

import { ACCOUNT_CENTER_URL } from '../accountCenterConfig'
import type { InternalAccountUser, ServiceBinding } from '../types/internalAccount'
import type {
  PersonProfile,
  PersonDetail,
  OrgMembership,
  OrgUnit,
  OrgUnitMember,
  ProjectGroup,
  ProjectGroupMember,
  EmailContact,
  ChatContactAC,
  PeopleSearchParams,
  MailboxStatus,
  ChatStatus,
} from '../types/personDirectory'

/* ---------- 内部工具 ---------- */

function serverLabel(): string {
  try {
    return new URL(ACCOUNT_CENTER_URL).host
  } catch {
    return ACCOUNT_CENTER_URL
  }
}

/** fetch + AbortController timeout wrapper */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw Object.assign(new Error(`请求超时（${timeoutMs / 1000}s），无法连接 AccountCenter：${serverLabel()}`), { code: 'REQUEST_TIMEOUT' })
    }
    throw new Error(`无法连接内部账号中心：${serverLabel()}`)
  } finally {
    clearTimeout(timer)
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  timeoutMs = 10000,
): Promise<T> {
  const url = `${ACCOUNT_CENTER_URL}${path}`
  const response = await fetchWithTimeout(
    url,
    {
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      ...options,
    },
    timeoutMs,
  )

  if (!response.ok) {
    let errorBody: { message?: string; error?: string } = {}
    try {
      errorBody = await response.json()
    } catch {
      // ignore parse failure
    }
    const msg = errorBody.message || errorBody.error || response.statusText
    if (response.status === 401) {
      const isLoginEndpoint = path === '/api/auth/login'
      if (!isLoginEndpoint && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('account:session-expired'))
      }
      throw new Error(isLoginEndpoint ? '用户名或密码错误' : '登录已过期，请重新登录')
    }
    if (response.status === 403) throw new Error(msg || '该内部账号已被禁用，请联系管理员')
    throw new Error(msg || `请求失败 (${response.status})`)
  }

  return response.json() as Promise<T>
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

/* ---------- 公开 API ---------- */

export interface LoginResult {
  token: string
  user: InternalAccountUser
}

/** 登录 AccountCenter，返回 token 和用户信息 */
export async function login(username: string, password: string): Promise<LoginResult> {
  return request<LoginResult>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

/** 使用 token 验证当前用户 */
export async function me(token: string): Promise<InternalAccountUser> {
  return request<InternalAccountUser>('/api/auth/me', {
    headers: authHeaders(token),
  })
}

/** 修改密码 */
export async function changePassword(
  token: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await request<unknown>('/api/auth/change-password', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ oldPassword: currentPassword, newPassword }),
  })
}

export interface UserBindings {
  mail?: ServiceBinding
  matrix?: ServiceBinding
  office?: ServiceBinding
}

/** Normalize a single raw binding object from snake_case → camelCase */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeServiceBinding(raw: any): ServiceBinding {
  return {
    service: raw.service,
    status: raw.status ?? 'unknown',
    syncStatus: raw.syncStatus ?? raw.sync_status ?? undefined,
    externalId: raw.externalId ?? raw.external_id ?? undefined,
    metadata: raw.metadata ?? undefined,
    createdAt: raw.createdAt ?? raw.created_at ?? undefined,
    updatedAt: raw.updatedAt ?? raw.updated_at ?? undefined,
  }
}

function parseBindingsList(raw: unknown): UserBindings {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawAny = raw as any
  const list: unknown[] = Array.isArray(rawAny?.bindings)
    ? rawAny.bindings
    : Array.isArray(raw)
    ? (raw as unknown[])
    : []

  const result: UserBindings = {}
  for (const item of list) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = normalizeServiceBinding(item as any)
    if (!b?.service) continue
    if (b.service === 'mail' || b.service === 'mailcow') result.mail = b
    else if (b.service === 'matrix') result.matrix = b
    else if (b.service === 'office') result.office = b
  }
  return result
}

/**
 * 读取服务绑定状态（8秒超时）
 *
 * 优先调用 /api/auth/me/bindings（普通用户可用），
 * 如果返回 404 则 fallback 到 /api/users/:id/bindings（管理员接口）。
 * 403 → 明确提示无权限，不 fallback。
 */
/* ---------- 通讯录 ---------- */

/** 内部通讯录联系人 */
export interface Contact {
  id: string
  username: string
  displayName?: string
  email: string
  departmentId?: string | null
  roles?: string[]
  status: 'active' | 'disabled'
}

/**
 * 获取内部通讯录联系人列表（8s 超时）
 * 优先调用 /api/contacts；fallback 到 /api/chat/contacts
 */
export async function getContacts(token: string): Promise<Contact[]> {
  const TIMEOUT = 8000
  const headers = authHeaders(token)

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = await request<any>('/api/contacts', { headers }, TIMEOUT)
    const list: unknown[] = Array.isArray(raw) ? raw : Array.isArray(raw?.contacts) ? raw.contacts : []
    return list.filter(Boolean).map((c) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const item = c as any
      return {
        id: String(item.id ?? item.userId ?? item.username ?? ''),
        username: String(item.username ?? ''),
        displayName: item.displayName ?? item.display_name ?? item.name ?? undefined,
        email: String(item.email ?? ''),
        departmentId: item.departmentId ?? item.department_id ?? null,
        roles: Array.isArray(item.roles) ? item.roles : [],
        status: (item.status === 'disabled' ? 'disabled' : 'active') as 'active' | 'disabled',
      }
    }).filter((c) => c.email)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const code = (err as { code?: string }).code
    if (code === 'REQUEST_TIMEOUT' || msg.includes('无法连接')) throw err
    if (msg.includes('过期') || msg.includes('用户名或密码错误')) throw err
    // /api/contacts may not exist — fallback to chat contacts
  }

  // Fallback: GET /api/chat/contacts
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = await request<any>('/api/chat/contacts', { headers }, TIMEOUT)
  const list: unknown[] = Array.isArray(raw) ? raw : Array.isArray(raw?.contacts) ? raw.contacts : []
  return list.filter(Boolean).map((c) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const item = c as any
    return {
      id: String(item.id ?? item.userId ?? item.username ?? ''),
      username: String(item.username ?? ''),
      displayName: item.displayName ?? item.display_name ?? item.name ?? undefined,
      email: String(item.email ?? ''),
      departmentId: item.departmentId ?? item.department_id ?? null,
      roles: Array.isArray(item.roles) ? item.roles : [],
      status: (item.status === 'disabled' ? 'disabled' : 'active') as 'active' | 'disabled',
    }
  }).filter((c) => c.email)
}

export async function getBindings(token: string, userId: string): Promise<UserBindings> {
  const TIMEOUT = 8000
  const headers = authHeaders(token)

  // Try the self-service endpoint first
  try {
    const raw = await request<unknown>('/api/auth/me/bindings', { headers }, TIMEOUT)
    return parseBindingsList(raw)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const code = (err as { code?: string }).code

    // Timeout or network error — surface immediately, don't bother fallback
    if (code === 'REQUEST_TIMEOUT' || msg.includes('无法连接')) throw err

    // 401: token invalid
    if (msg.includes('用户名或密码错误')) {
      throw new Error('登录已失效，请重新登录')
    }

    // 403: permission denied — don't silently fall through
    if (msg.includes('被禁用') || msg.includes('403')) {
      throw new Error('当前账号无权读取服务绑定（403）')
    }

    // 404 / other: endpoint may not exist — try fallback
  }

  // Fallback: admin endpoint
  try {
    const raw = await request<unknown>(
      `/api/users/${encodeURIComponent(userId)}/bindings`,
      { headers },
      TIMEOUT,
    )
    return parseBindingsList(raw)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const code = (err as { code?: string }).code

    if (code === 'REQUEST_TIMEOUT') {
      throw new Error('服务绑定状态读取超时，请检查 AccountCenter 是否可访问')
    }
    if (msg.includes('无法连接')) throw err
    if (msg.includes('用户名或密码错误')) throw new Error('登录已失效，请重新登录')
    if (msg.includes('被禁用') || msg.includes('403')) {
      throw new Error('当前账号无权读取服务绑定')
    }
    throw new Error(`服务绑定读取失败：${msg}`)
  }
}

/* ========================================================================== */
/*  人员目录 API（AccountCenter 真实人员）                                     */
/* ========================================================================== */

const DIRECTORY_TIMEOUT = 12000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safePeopleList(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw as unknown[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = raw as any
  return Array.isArray(r?.data) ? r.data
    : Array.isArray(r?.people) ? r.people
    : Array.isArray(r?.items) ? r.items
    : []
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizePerson(r: any): PersonProfile {
  return {
    personId: String(r.personId ?? r.person_id ?? r.id ?? ''),
    name: String(r.nameCn ?? r.name_cn ?? r.displayNameCn ?? r.name ?? r.displayName ?? r.display_name ?? ''),
    enName: r.nameEn ?? r.name_en ?? r.displayNameEn ?? r.enName ?? r.en_name ?? r.englishName ?? undefined,
    employeeId: r.employeeId ?? r.employee_id ?? undefined,
    position: r.positionCn ?? r.position_cn ?? r.position ?? r.jobTitle ?? r.job_title ?? undefined,
    department: r.department ?? r.departmentName ?? r.department_name ?? undefined,
    phone: r.phone ?? r.officePhone ?? r.office_phone ?? undefined,
    officeAddress: r.officeAddress ?? r.office_address ?? undefined,
    sourceEmail: r.sourceEmail ?? r.source_email ?? undefined,
    aiEmail: r.aiEmail ?? r.ai_email ?? undefined,
    status: r.status ?? undefined,
  }
}

/**
 * 搜索人员 GET /api/people
 * 不包含 testuser/mock 用户（由服务端保证，客户端也做兜底过滤）
 */
export async function getPeople(
  token: string,
  params?: PeopleSearchParams,
): Promise<PersonProfile[]> {
  const qs = new URLSearchParams()
  if (params?.name) qs.set('name', params.name)
  if (params?.employeeId) qs.set('employeeId', params.employeeId)
  if (params?.department) qs.set('department', params.department)
  if (params?.position) qs.set('position', params.position)
  if (params?.sourceEmail) qs.set('sourceEmail', params.sourceEmail)
  if (params?.aiEmail) qs.set('aiEmail', params.aiEmail)
  if (params?.status) qs.set('status', params.status)
  if (params?.q) qs.set('q', params.q)
  if (params?.page != null) qs.set('page', String(params.page))
  if (params?.pageSize != null) qs.set('pageSize', String(params.pageSize))
  const query = qs.toString() ? `?${qs.toString()}` : ''
  const raw = await request<unknown>(`/api/people${query}`, { headers: authHeaders(token) }, DIRECTORY_TIMEOUT)
  return safePeopleList(raw)
    .map(normalizePerson)
    .filter((p) => p.personId && !isTestUser(p))
}

/** 读取正式组织单位（不含 project_group）GET /api/org-units */
export async function getOrgUnits(token: string): Promise<OrgUnit[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = await request<any>('/api/org-units', { headers: authHeaders(token) }, DIRECTORY_TIMEOUT)
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : Array.isArray(raw?.orgUnits) ? raw.orgUnits : []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (list as any[]).map((r): OrgUnit => ({
    orgUnitId: String(r.orgUnitId ?? r.org_unit_id ?? r.id ?? ''),
    name: String(r.nameCn ?? r.name_cn ?? r.name ?? r.displayName ?? r.display_name ?? ''),
    enName: r.nameEn ?? r.name_en ?? r.enName ?? r.en_name ?? undefined,
    type: r.type ?? r.unitType ?? r.unit_type ?? undefined,
    parentOrgUnitId: r.parentOrgUnitId ?? r.parent_org_unit_id ?? undefined,
    memberCount: typeof r.memberCount === 'number' ? r.memberCount
      : typeof r.member_count === 'number' ? r.member_count
      : typeof r.membersCount === 'number' ? r.membersCount
      : undefined,
  })).filter((u) => u.orgUnitId)
}

/** 读取项目组（单独入口，不混入部门目录）GET /api/project-groups */
export async function getProjectGroups(token: string): Promise<ProjectGroup[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = await request<any>('/api/project-groups', { headers: authHeaders(token) }, DIRECTORY_TIMEOUT)
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : Array.isArray(raw?.projectGroups) ? raw.projectGroups : []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (list as any[]).map((r): ProjectGroup => ({
    projectGroupId: String(r.projectGroupId ?? r.project_group_id ?? r.id ?? ''),
    name: String(r.nameCn ?? r.name_cn ?? r.name ?? r.displayName ?? r.display_name ?? ''),
    enName: r.nameEn ?? r.name_en ?? r.enName ?? r.en_name ?? undefined,
    parentCandidate: r.parentCandidate ?? r.parent_candidate ?? undefined,
    memberCount: typeof r.memberCount === 'number' ? r.memberCount
      : typeof r.member_count === 'number' ? r.member_count
      : undefined,
  })).filter((g) => g.projectGroupId)
}

/** 读取某个正式组织单位的成员 GET /api/org-units/:orgUnitId/members */
export async function getOrgUnitMembers(token: string, orgUnitId: string): Promise<OrgUnitMember[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = await request<any>(
    `/api/org-units/${encodeURIComponent(orgUnitId)}/members`,
    { headers: authHeaders(token) },
    DIRECTORY_TIMEOUT,
  )
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : Array.isArray(raw?.members) ? raw.members : []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (list as any[]).map((r): OrgUnitMember => ({
    personId: String(r.personId ?? r.person_id ?? r.id ?? ''),
    name: String(r.nameCn ?? r.name_cn ?? r.displayNameCn ?? r.name ?? r.displayName ?? r.display_name ?? ''),
    enName: r.nameEn ?? r.name_en ?? r.displayNameEn ?? r.enName ?? r.en_name ?? undefined,
    position: r.positionCn ?? r.position_cn ?? r.position ?? r.jobTitle ?? r.job_title ?? undefined,
    aiEmail: r.aiEmail ?? r.ai_email ?? undefined,
    mailboxStatus: (r.mailboxStatus ?? r.mailbox_status ?? r.mailStatus ?? 'not_created') as MailboxStatus,
    chatStatus: (r.chatStatus ?? r.chat_status ?? 'not_created') as ChatStatus,
    isPrimary: r.isPrimary ?? r.is_primary ?? false,
  })).filter((m) => m.personId)
}

/** 读取项目组成员 GET /api/project-groups/:projectGroupId/members */
export async function getProjectGroupMembers(token: string, projectGroupId: string): Promise<ProjectGroupMember[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = await request<any>(
    `/api/project-groups/${encodeURIComponent(projectGroupId)}/members`,
    { headers: authHeaders(token) },
    DIRECTORY_TIMEOUT,
  )
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : Array.isArray(raw?.members) ? raw.members : []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (list as any[]).map((r): ProjectGroupMember => ({
    personId: String(r.personId ?? r.person_id ?? r.id ?? ''),
    name: String(r.nameCn ?? r.name_cn ?? r.displayNameCn ?? r.name ?? r.displayName ?? r.display_name ?? ''),
    enName: r.nameEn ?? r.name_en ?? r.displayNameEn ?? r.enName ?? r.en_name ?? undefined,
    position: r.positionCn ?? r.position_cn ?? r.position ?? r.jobTitle ?? r.job_title ?? undefined,
    aiEmail: r.aiEmail ?? r.ai_email ?? undefined,
    mailboxStatus: (r.mailboxStatus ?? r.mailbox_status ?? 'not_created') as MailboxStatus,
    chatStatus: (r.chatStatus ?? r.chat_status ?? 'not_created') as ChatStatus,
    role: r.role ?? undefined,
  })).filter((m) => m.personId)
}

/** 读取人员详情 GET /api/people/:personId */
export async function getPersonDetail(token: string, personId: string): Promise<PersonDetail> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = await request<any>(
    `/api/people/${encodeURIComponent(personId)}`,
    { headers: authHeaders(token) },
    DIRECTORY_TIMEOUT,
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = raw as any
  const profile = r.personProfile ?? r.person_profile ?? r
  const accountIdentity = r.accountIdentity ?? r.account_identity
  const mailIdentity = r.mailIdentity ?? r.mail_identity
  const chatIdentity = r.chatIdentity ?? r.chat_identity

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const normMembership = (m: any) => ({
    orgUnitId: String(m.orgUnitId ?? m.org_unit_id ?? m.id ?? ''),
    orgUnitName: m.orgUnitName ?? m.org_unit_name ?? m.name ?? undefined,
    orgUnitEnName: m.orgUnitEnName ?? m.org_unit_en_name ?? m.enName ?? undefined,
    role: m.role ?? undefined,
    isPrimary: m.isPrimary ?? m.is_primary ?? false,
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const normProjectMembership = (m: any) => ({
    projectGroupId: String(m.projectGroupId ?? m.project_group_id ?? m.id ?? ''),
    projectGroupName: m.projectGroupName ?? m.project_group_name ?? m.name ?? undefined,
    projectGroupEnName: m.projectGroupEnName ?? m.en_name ?? undefined,
    role: m.role ?? undefined,
  })

  const formalMemberships = Array.isArray(r.formalMemberships) ? r.formalMemberships.map(normMembership)
    : Array.isArray(r.formal_memberships) ? r.formal_memberships.map(normMembership)
    : []

  const projectMemberships = Array.isArray(r.projectMemberships) ? r.projectMemberships.map(normProjectMembership)
    : Array.isArray(r.project_memberships) ? r.project_memberships.map(normProjectMembership)
    : []

  const primaryMembership = formalMemberships.find((m: OrgMembership) => m.isPrimary) ?? formalMemberships[0]

  return {
    personId: String(profile.personId ?? profile.person_id ?? profile.id ?? r.personId ?? r.person_id ?? r.id ?? ''),
    name: String(profile.nameCn ?? profile.name_cn ?? profile.displayNameCn ?? profile.display_name_cn ?? profile.name ?? profile.displayName ?? profile.display_name ?? ''),
    enName: profile.nameEn ?? profile.name_en ?? profile.displayNameEn ?? profile.display_name_en ?? profile.enName ?? profile.en_name ?? undefined,
    employeeId: profile.employeeId ?? profile.employee_id ?? undefined,
    position: profile.positionCn ?? profile.position_cn ?? profile.position ?? profile.jobTitle ?? profile.job_title ?? primaryMembership?.role ?? undefined,
    department: profile.department ?? profile.departmentName ?? profile.department_name ?? primaryMembership?.orgUnitName ?? undefined,
    phone: profile.phone ?? profile.telephone ?? profile.officePhone ?? undefined,
    officeAddress: profile.officeAddress ?? profile.office_address ?? undefined,
    sourceEmail: profile.sourceEmail ?? profile.source_email ?? undefined,
    aiEmail: profile.aiEmail ?? profile.ai_email ?? mailIdentity?.aiEmail ?? mailIdentity?.ai_email ?? undefined,
    status: profile.status ?? r.status ?? undefined,
    accountIdentity: accountIdentity
      ? {
          id: accountIdentity.id != null ? String(accountIdentity.id) : undefined,
          personId: accountIdentity.personId ?? accountIdentity.person_id ?? undefined,
          userId: accountIdentity.userId ?? accountIdentity.user_id ?? undefined,
          username: accountIdentity.username ?? undefined,
          loginEmail: accountIdentity.loginEmail ?? accountIdentity.login_email ?? undefined,
          role: accountIdentity.role ?? undefined,
          canLogin: accountIdentity.canLogin ?? accountIdentity.can_login ?? undefined,
          status: accountIdentity.status ?? 'unknown',
          mustChangePassword: accountIdentity.mustChangePassword ?? accountIdentity.must_change_password ?? undefined,
        }
      : undefined,
    mailIdentity: mailIdentity
      ? {
          aiEmail: mailIdentity.aiEmail ?? mailIdentity.ai_email ?? undefined,
          status: mailIdentity.status ?? mailIdentity.mailboxStatus ?? mailIdentity.mailbox_status ?? 'not_created',
          externalId: mailIdentity.externalId ?? mailIdentity.external_id ?? undefined,
        }
      : undefined,
    chatIdentity: chatIdentity
      ? {
          chatId: chatIdentity.chatId ?? chatIdentity.chat_id ?? chatIdentity.chatUserId ?? chatIdentity.chat_user_id ?? undefined,
          chatUserId: chatIdentity.chatUserId ?? chatIdentity.chat_user_id ?? chatIdentity.chatId ?? chatIdentity.chat_id ?? undefined,
          status: chatIdentity.status ?? 'not_created',
          externalId: chatIdentity.externalId ?? chatIdentity.external_id ?? undefined,
        }
      : undefined,
    formalMemberships,
    projectMemberships,
    memberships: Array.isArray(r.memberships) ? r.memberships : undefined,
  }
}

/**
 * 邮件收件人列表 GET /api/contacts/email
 * 默认使用 aiEmail；aiEmail 缺失的不作为正式收件人
 */
export async function getEmailContacts(token: string): Promise<EmailContact[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = await request<any>('/api/contacts/email', { headers: authHeaders(token) }, DIRECTORY_TIMEOUT)
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : Array.isArray(raw?.contacts) ? raw.contacts : []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (list as any[])
    .map((r): EmailContact => ({
      personId: String(r.personId ?? r.person_id ?? r.id ?? ''),
      name: String(r.nameCn ?? r.name_cn ?? r.displayNameCn ?? r.name ?? r.displayName ?? r.display_name ?? ''),
      enName: r.nameEn ?? r.name_en ?? r.displayNameEn ?? r.enName ?? r.en_name ?? undefined,
      employeeId: r.employeeId ?? r.employee_id ?? undefined,
      department: r.department ?? r.departmentName ?? r.department_name ?? undefined,
      position: r.positionCn ?? r.position_cn ?? r.position ?? r.jobTitle ?? undefined,
      aiEmail: String(r.aiEmail ?? r.ai_email ?? ''),
      sourceEmail: r.sourceEmail ?? r.source_email ?? undefined,
      mailboxStatus: (r.mailboxStatus ?? r.mailbox_status ?? r.status ?? 'not_created') as MailboxStatus,
    }))
    .filter((c) => c.personId && c.aiEmail && !isTestUser(c))
}

/**
 * 内部通讯联系人 GET /api/contacts/chat
 * chatStatus=active 的人可以发起消息
 */
export async function getChatContactsAC(token: string): Promise<ChatContactAC[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = await request<any>('/api/contacts/chat', { headers: authHeaders(token) }, DIRECTORY_TIMEOUT)
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : Array.isArray(raw?.contacts) ? raw.contacts : []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (list as any[])
    .map((r): ChatContactAC => ({
      personId: String(r.personId ?? r.person_id ?? r.id ?? ''),
      name: String(r.nameCn ?? r.name_cn ?? r.displayNameCn ?? r.display_name_cn ?? r.name ?? r.displayName ?? r.display_name ?? ''),
      enName: r.nameEn ?? r.name_en ?? r.displayNameEn ?? r.display_name_en ?? r.enName ?? r.en_name ?? undefined,
      employeeId: r.employeeId ?? r.employee_id ?? undefined,
      department: r.department ?? r.departmentName ?? r.department_name ?? r.departmentCn ?? r.department_cn ?? undefined,
      position: r.positionCn ?? r.position_cn ?? r.position ?? r.jobTitle ?? r.job_title ?? undefined,
      aiEmail: r.aiEmail ?? r.ai_email ?? undefined,
      chatStatus: (r.chatStatus ?? r.chat_status ?? r.status ?? 'not_created') as ChatStatus,
      chatId: r.chatId ?? r.chat_id ?? r.chatUserId ?? r.chat_user_id ?? r.externalId ?? r.external_id ?? undefined,
      chatUserId: r.chatUserId ?? r.chat_user_id ?? r.chatId ?? r.chat_id ?? undefined,
      accountUserId: r.accountUserId ?? r.account_user_id ?? r.userId ?? r.user_id ?? undefined,
      username: r.username ?? undefined,
    }))
    .filter((c) => c.personId && !isTestDisabledUser(c))
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const TEST_USER_PATTERNS = /^(testuser|test_user|mockuser|mock_user|test\d+)/i

/** Filter out testuser/mock users from production contacts */
function isTestUser(p: { name?: string; aiEmail?: string; personId?: string }): boolean {
  if (p.personId && TEST_USER_PATTERNS.test(p.personId)) return true
  if (p.aiEmail && TEST_USER_PATTERNS.test(p.aiEmail.split('@')[0])) return true
  if (p.name && TEST_USER_PATTERNS.test(p.name)) return true
  return false
}

/** Filter disabled and test users from chat contacts */
function isTestDisabledUser(c: ChatContactAC): boolean {
  if (isTestUser(c)) return true
  if (c.chatStatus === 'disabled') return true
  return false
}

/* Re-export new types so callers can import from accountCenterClient */
export type {
  PersonProfile,
  PersonDetail,
  OrgUnit,
  OrgUnitMember,
  ProjectGroup,
  ProjectGroupMember,
  EmailContact,
  ChatContactAC,
  PeopleSearchParams,
  MailboxStatus,
  ChatStatus,
  OrgMembership,
  ProjectMembership,
} from '../types/personDirectory'
