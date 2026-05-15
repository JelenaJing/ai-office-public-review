/**
 * Client-side permission helpers.
 * Reads `permissions[]` from the InternalAccount session.
 * Falls back to role-based check for legacy users who don't have permissions[] yet.
 */

import { useInternalSession } from '../contexts/InternalAccountContext'

const ROLE_FALLBACK: Record<string, string[]> = {
  admin: [
    'admin.panel.view',
    'chat.audit.view_tenant',
    'work_report.view_tenant_summary',
    'work_report.view_department_summary',
    'work_report.view_subordinate_summary',
    'chat.view_own', 'chat.create_room', 'chat.send_message',
  ],
  super_admin: [
    'admin.panel.view',
    'chat.audit.view_tenant',
    'work_report.view_tenant_summary',
    'work_report.view_department_summary',
    'work_report.view_subordinate_summary',
    'chat.view_own', 'chat.create_room', 'chat.send_message',
  ],
  system_admin: [
    'admin.panel.view',
    'chat.audit.view_tenant',
    'work_report.view_tenant_summary',
    'work_report.view_department_summary',
    'work_report.view_subordinate_summary',
    'chat.view_own', 'chat.create_room', 'chat.send_message',
  ],
  user: ['chat.view_own', 'chat.create_room', 'chat.send_message'],
}

function resolvePermissions(roles: string[], serverPermissions?: string[]): string[] {
  if (serverPermissions && serverPermissions.length > 0) return serverPermissions
  // legacy fallback: union of role-based permissions
  const set = new Set<string>()
  for (const role of roles) {
    for (const p of ROLE_FALLBACK[role] ?? []) set.add(p)
  }
  return Array.from(set)
}

export function useHasPermission(permission: string): boolean {
  const session = useInternalSession()
  if (!session) return false
  const perms = resolvePermissions(session.user.roles, session.user.permissions)
  return perms.includes(permission)
}

export function useHasAnyPermission(permissions: string[]): boolean {
  const session = useInternalSession()
  if (!session) return false
  const perms = resolvePermissions(session.user.roles, session.user.permissions)
  return permissions.some((p) => perms.includes(p))
}

/** Non-hook version for use outside React components */
export function checkPermission(roles: string[], serverPermissions: string[] | undefined, permission: string): boolean {
  const perms = resolvePermissions(roles, serverPermissions)
  return perms.includes(permission)
}
