/**
 * PersonDirectory — AccountCenter 真实人员目录相关类型
 *
 * 对应 AccountCenter API：
 *   GET /api/people
 *   GET /api/org-units
 *   GET /api/project-groups
 *   GET /api/org-units/:id/members
 *   GET /api/people/:id
 *   GET /api/contacts/email
 *   GET /api/contacts/chat
 */

/* ------------------------------------------------------------------ */
/*  Enumerations                                                       */
/* ------------------------------------------------------------------ */

export type MailboxStatus = 'active' | 'not_created' | 'failed' | 'disabled' | string
export type ChatStatus = 'active' | 'not_created' | 'failed' | 'disabled' | string
export type AccountStatus = 'active' | 'disabled' | 'pending' | string
export type PersonStatus = 'active' | 'inactive' | 'pending' | string

/* ------------------------------------------------------------------ */
/*  Core person models                                                 */
/* ------------------------------------------------------------------ */

export interface PersonProfile {
  personId: string
  name: string
  /** English name */
  enName?: string
  employeeId?: string
  position?: string
  department?: string
  phone?: string
  officeAddress?: string
  sourceEmail?: string
  aiEmail?: string
  status?: PersonStatus
  /** Optional: mailbox status if returned by API */
  mailboxStatus?: MailboxStatus
  /** Optional: chat account status if returned by API */
  chatStatus?: ChatStatus
}

export interface OrgMembership {
  orgUnitId: string
  orgUnitName?: string
  orgUnitEnName?: string
  role?: string
  isPrimary?: boolean
}

export interface ProjectMembership {
  projectGroupId: string
  projectGroupName?: string
  projectGroupEnName?: string
  role?: string
}

export interface AccountIdentity {
  id?: string
  personId?: string
  userId?: string
  username?: string
  loginEmail?: string
  role?: string
  canLogin?: boolean
  status: AccountStatus
  mustChangePassword?: boolean
}

export interface MailIdentity {
  aiEmail?: string
  status: MailboxStatus
  externalId?: string
}

export interface ChatIdentity {
  chatId?: string
  chatUserId?: string
  status: ChatStatus
  externalId?: string
}

/** Full person detail returned by GET /api/people/:personId */
export interface PersonDetail {
  personId: string
  name: string
  enName?: string
  employeeId?: string
  position?: string
  department?: string
  phone?: string
  officeAddress?: string
  sourceEmail?: string
  aiEmail?: string
  status?: PersonStatus
  accountIdentity?: AccountIdentity
  mailIdentity?: MailIdentity
  chatIdentity?: ChatIdentity
  /** Formal org unit memberships */
  formalMemberships?: OrgMembership[]
  /** Project group memberships */
  projectMemberships?: ProjectMembership[]
  /** Raw memberships (all, may overlap above two) */
  memberships?: (OrgMembership | ProjectMembership)[]
}

/* ------------------------------------------------------------------ */
/*  Org unit models                                                    */
/* ------------------------------------------------------------------ */

export interface OrgUnit {
  orgUnitId: string
  name: string
  enName?: string
  type?: string
  parentOrgUnitId?: string
  memberCount?: number
}

export interface OrgUnitMember {
  personId: string
  name: string
  enName?: string
  position?: string
  aiEmail?: string
  mailboxStatus?: MailboxStatus
  chatStatus?: ChatStatus
  isPrimary?: boolean
}

/* ------------------------------------------------------------------ */
/*  Project group models                                               */
/* ------------------------------------------------------------------ */

export interface ProjectGroup {
  projectGroupId: string
  name: string
  enName?: string
  parentCandidate?: string
  memberCount?: number
}

export interface ProjectGroupMember {
  personId: string
  name: string
  enName?: string
  position?: string
  aiEmail?: string
  mailboxStatus?: MailboxStatus
  chatStatus?: ChatStatus
  role?: string
}

/* ------------------------------------------------------------------ */
/*  Contact models (for selectors)                                    */
/* ------------------------------------------------------------------ */

/** Email contact for ComposeModal recipient selector */
export interface EmailContact {
  personId: string
  name: string
  enName?: string
  employeeId?: string
  department?: string
  position?: string
  aiEmail: string
  sourceEmail?: string
  mailboxStatus: MailboxStatus
}

/** Chat contact for internal messaging */
export interface ChatContactAC {
  personId: string
  name: string
  enName?: string
  employeeId?: string
  department?: string
  position?: string
  aiEmail?: string
  chatStatus: ChatStatus
  chatId?: string
  chatUserId?: string
  accountUserId?: string
  username?: string
}

/* ------------------------------------------------------------------ */
/*  Search params                                                      */
/* ------------------------------------------------------------------ */

export interface PeopleSearchParams {
  name?: string
  employeeId?: string
  department?: string
  position?: string
  sourceEmail?: string
  aiEmail?: string
  status?: string
  page?: number
  pageSize?: number
  q?: string
}
