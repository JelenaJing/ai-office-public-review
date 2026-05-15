import sys

# ===== 1. auth/permissions.ts — add 'admin' alias =====
path1 = '/data/darebug/aioffice-unified/account-center/src/auth/permissions.ts'
c1 = open(path1).read()

if "'admin'" not in c1:
    c1 = c1.replace(
        "  | 'super_admin'; // legacy — equivalent to system_admin",
        "  | 'super_admin' // legacy — equivalent to system_admin\n  | 'admin'; // alias for system_admin",
        1
    )
    c1 = c1.replace(
        "  system_admin: [",
        """  admin: [
    'admin.panel.view',
    'chat.view_own',
    'chat.create_room',
    'chat.send_message',
    'chat.upload_attachment',
    'chat.audit.view_tenant',
    'work_report.view_tenant_summary',
    'activity.job_status.view',
    'users.manage',
    'relations.manage',
  ],
  system_admin: [""",
        1
    )
    open(path1, 'w').write(c1)
    print('PATCHED permissions.ts')
else:
    print('SKIP permissions.ts (already has admin)')

# ===== 2. auth/authRoutes.ts — add permissions to login + /me =====
path2 = '/data/darebug/aioffice-unified/account-center/src/auth/authRoutes.ts'
c2 = open(path2).read()

if 'getEffectivePermissions' not in c2:
    c2 = c2.replace(
        "import { signToken } from './jwt';",
        "import { signToken } from './jwt';\nimport { getEffectivePermissions } from './permissions';",
        1
    )
    c2 = c2.replace(
        "      roles: user.roles,\n      status: user.status,",
        "      roles: user.roles,\n      permissions: getEffectivePermissions(user.roles),\n      status: user.status,",
        1
    )
    c2 = c2.replace(
        "    roles: u.roles,\n    status: u.status,",
        "    roles: u.roles,\n    permissions: getEffectivePermissions(u.roles),\n    status: u.status,",
        1
    )
    open(path2, 'w').write(c2)
    print('PATCHED authRoutes.ts')
else:
    print('SKIP authRoutes.ts (already patched)')

# ===== 3. index.ts — register chat + adminChat routes =====
path3 = '/data/darebug/aioffice-unified/account-center/src/index.ts'
c3 = open(path3).read()

if 'chatRouter' not in c3:
    c3 = c3.replace(
        "import adminActivityRouter from './admin/adminActivityRoutes';",
        "import adminActivityRouter from './admin/adminActivityRoutes';\nimport chatRouter from './chat/chatRoutes';\nimport adminChatRouter from './admin/adminChatRoutes';",
        1
    )
    c3 = c3.replace(
        "  app.use('/api/admin/activity', adminActivityRouter);",
        "  app.use('/api/admin/activity', adminActivityRouter);\n  app.use('/api/chat', chatRouter);\n  app.use('/api/admin/chat', adminChatRouter);",
        1
    )
    open(path3, 'w').write(c3)
    print('PATCHED index.ts')
else:
    print('SKIP index.ts (already has chatRouter)')

print('ALL DONE')
