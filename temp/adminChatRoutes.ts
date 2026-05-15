import { Router } from 'express';
import type { Response } from 'express';
import { requireAuth, requireAnyPermission } from '../auth/authMiddleware';
import type { AuthRequest } from '../auth/authMiddleware';
import { pool } from '../db/pool';
import { canViewChatConversation, loadViewerContext } from '../chat/chatService';

const router = Router();
router.use(requireAuth);

const auditGuard = requireAnyPermission(
  'chat.audit.view_subordinate',
  'chat.audit.view_department',
  'chat.audit.view_tenant',
);

// ─── GET /api/admin/chat/conversations ──────────────────────────────────────
router.get('/conversations', auditGuard, async (req: AuthRequest, res: Response): Promise<void> => {
  const viewer = await loadViewerContext(req.user!.id);
  if (!viewer) { res.status(401).json({ error: 'User not found' }); return; }

  const { userId, dateFrom, dateTo, page = '1', pageSize = '20' } = req.query;
  const limit = Math.min(parseInt(pageSize as string, 10), 100);
  const offset = (parseInt(page as string, 10) - 1) * limit;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (userId) { params.push(userId); conditions.push(`EXISTS (SELECT 1 FROM chat_conversation_members mx WHERE mx.conversation_id = c.id AND mx.user_id = $${params.length})`); }
  if (dateFrom) { params.push(dateFrom); conditions.push(`c.created_at >= $${params.length}`); }
  if (dateTo) { params.push(dateTo + 'T23:59:59'); conditions.push(`c.created_at <= $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit, offset);

  const { rows } = await pool.query(
    `SELECT c.id, c.conversation_type, c.title, c.created_at, c.updated_at,
            u.username AS created_by_username,
            (SELECT COUNT(*) FROM chat_messages msg WHERE msg.conversation_id = c.id AND msg.deleted_at IS NULL) AS message_count,
            (SELECT json_agg(json_build_object('userId', mem.user_id, 'username', usr.username, 'role', mem.role))
             FROM chat_conversation_members mem JOIN users usr ON usr.id = mem.user_id
             WHERE mem.conversation_id = c.id) AS members
       FROM chat_conversations c
       JOIN users u ON u.id = c.created_by
       ${where}
       ORDER BY c.updated_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const allowed = (await Promise.all(rows.map(async (conv) => {
    const check = await canViewChatConversation(viewer, conv.id);
    return check.allowed ? conv : null;
  }))).filter(Boolean);

  res.json(allowed);
});

// ─── GET /api/admin/chat/conversations/:id/messages ─────────────────────────
router.get('/conversations/:id/messages', auditGuard, async (req: AuthRequest, res: Response): Promise<void> => {
  const viewer = await loadViewerContext(req.user!.id);
  if (!viewer) { res.status(401).json({ error: 'User not found' }); return; }

  const { allowed } = await canViewChatConversation(viewer, req.params.id);
  if (!allowed) { res.status(403).json({ error: '无权限查看该聊天记录' }); return; }

  const limit = Math.min(parseInt((req.query.limit ?? '100') as string, 10), 500);
  const before = req.query.before as string | undefined;
  const params: unknown[] = [req.params.id, limit];
  const beforeClause = before ? ` AND m.created_at < $3` : '';
  if (before) params.push(before);

  const { rows } = await pool.query(
    `SELECT m.id, m.conversation_id, m.sender_id, u.username AS sender_username,
            m.message_type, m.body, m.attachment_id, m.created_at,
            a.file_name, a.mime_type, a.size_bytes
       FROM chat_messages m
       JOIN users u ON u.id = m.sender_id
       LEFT JOIN chat_attachments a ON a.id = m.attachment_id
      WHERE m.conversation_id = $1 AND m.deleted_at IS NULL${beforeClause}
      ORDER BY m.created_at ASC LIMIT $2`,
    params,
  );
  res.json(rows);
});

// ─── GET /api/admin/chat/users/:userId/conversations ────────────────────────
router.get('/users/:userId/conversations', auditGuard, async (req: AuthRequest, res: Response): Promise<void> => {
  const viewer = await loadViewerContext(req.user!.id);
  if (!viewer) { res.status(401).json({ error: 'User not found' }); return; }

  const { rows } = await pool.query(
    `SELECT c.id, c.conversation_type, c.title, c.created_at, c.updated_at,
            (SELECT COUNT(*) FROM chat_messages msg WHERE msg.conversation_id = c.id AND msg.deleted_at IS NULL) AS message_count
       FROM chat_conversations c
       JOIN chat_conversation_members m ON m.conversation_id = c.id
      WHERE m.user_id = $1
      ORDER BY c.updated_at DESC`,
    [req.params.userId],
  );

  const allowed = (await Promise.all(rows.map(async (conv) => {
    const check = await canViewChatConversation(viewer, conv.id);
    return check.allowed ? conv : null;
  }))).filter(Boolean);

  res.json(allowed);
});

// ─── GET /api/admin/chat/search ─────────────────────────────────────────────
router.get('/search', auditGuard, async (req: AuthRequest, res: Response): Promise<void> => {
  const viewer = await loadViewerContext(req.user!.id);
  if (!viewer) { res.status(401).json({ error: 'User not found' }); return; }

  const { q, userId, dateFrom, dateTo } = req.query;
  if (!q) { res.status(400).json({ error: 'q required' }); return; }

  const conditions: string[] = [`m.body ILIKE $1`, `m.deleted_at IS NULL`];
  const params: unknown[] = [`%${q}%`];

  if (userId) { params.push(userId); conditions.push(`m.sender_id = $${params.length}`); }
  if (dateFrom) { params.push(dateFrom); conditions.push(`m.created_at >= $${params.length}`); }
  if (dateTo) { params.push(dateTo + 'T23:59:59'); conditions.push(`m.created_at <= $${params.length}`); }
  params.push(50);

  const { rows } = await pool.query(
    `SELECT m.id, m.conversation_id, m.sender_id, u.username AS sender_username,
            m.message_type, m.body, m.created_at
       FROM chat_messages m
       JOIN users u ON u.id = m.sender_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY m.created_at DESC LIMIT $${params.length}`,
    params,
  );

  const allowed = (await Promise.all(rows.map(async (msg) => {
    const check = await canViewChatConversation(viewer, msg.conversation_id);
    return check.allowed ? msg : null;
  }))).filter(Boolean);

  res.json(allowed);
});

export default router;
