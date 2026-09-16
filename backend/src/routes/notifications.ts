// Notifications API (§31 Notification entity, §52 step 8): the receiving side
// of family fan-out. Family members / the emergency owner poll or receive via
// SSE, then ack — mirroring the mesh's ACK discipline at the application layer.

import { Router } from 'express';
import { db } from '../db.js';
import { audit } from '../middleware/audit.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';

export const notificationsRouter = Router();

/** My notifications: emergencies where I'm the owner, newest first. */
notificationsRouter.get('/', requireAuth, (req: AuthedRequest, res) => {
  const rows = db.prepare(`
    SELECT n.id, n.emergency_id, n.family_member_id, n.channel, n.delivery_state,
           n.created_at, n.delivered_at,
           e.type AS emergency_type, e.severity, e.status AS emergency_status, e.message
    FROM notifications n JOIN emergency_events e ON e.id = n.emergency_id
    WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT 100
  `).all(req.user!.userId) as Array<Record<string, unknown>>;
  res.json({ notifications: rows });
});

/** Ack a notification as delivered to me (idempotent). */
notificationsRouter.post('/:id/ack', requireAuth, (req: AuthedRequest, res) => {
  const row = db.prepare('SELECT id, user_id, delivery_state FROM notifications WHERE id = ?')
    .get(req.params.id) as { id: string; user_id: string; delivery_state: string } | undefined;
  if (!row) { res.status(404).json({ error: 'notification not found' }); return; }
  if (row.user_id !== req.user!.userId) { res.status(403).json({ error: 'not your notification' }); return; }
  if (row.delivery_state !== 'DELIVERED') {
    db.prepare('UPDATE notifications SET delivery_state = ?, delivered_at = ? WHERE id = ?')
      .run('DELIVERED', new Date().toISOString(), row.id);
    audit(req.user!.userId, 'notification.ack', 'notification', row.id);
  }
  res.json({ ok: true, id: row.id, delivery_state: 'DELIVERED' });
});
