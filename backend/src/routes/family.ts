import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '../db.js';
import { audit } from '../middleware/audit.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { broadcastEvent } from './realtime.js';

export const familyRouter = Router();

const RELATIONS = ['FATHER', 'MOTHER', 'BROTHER', 'SISTER', 'PARTNER', 'FRIEND', 'GUARDIAN', 'OTHER'] as const;
type Relation = (typeof RELATIONS)[number];

const memberSchema = z.object({
  name: z.string().min(1).max(80),
  relation: z.enum(RELATIONS),
  phone: z.string().min(5).max(20),
  iqooAccountId: z.string().max(64).optional(),
  priority: z.number().int().min(1).max(3).default(3),
  trusted: z.boolean().default(false),
});

familyRouter.get('/', requireAuth, (req: AuthedRequest, res) => {
  const rows = db.prepare(
    `SELECT id, name, relation, phone, iqoo_account_id,
      (SELECT u.email FROM users u WHERE u.id = family_members.iqoo_account_id) AS iqoo_email,
      priority, trusted, status, last_seen_at,
      (SELECT ci.lat FROM check_ins ci WHERE ci.user_id = family_members.iqoo_account_id AND ci.lat IS NOT NULL AND ci.lon IS NOT NULL ORDER BY ci.created_at DESC LIMIT 1) AS last_lat,
      (SELECT ci.lon FROM check_ins ci WHERE ci.user_id = family_members.iqoo_account_id AND ci.lat IS NOT NULL AND ci.lon IS NOT NULL ORDER BY ci.created_at DESC LIMIT 1) AS last_lon,
       (SELECT ci.status FROM check_ins ci WHERE ci.user_id = family_members.iqoo_account_id ORDER BY ci.created_at DESC LIMIT 1) AS check_in_status,
       (SELECT ci.created_at FROM check_ins ci WHERE ci.user_id = family_members.iqoo_account_id ORDER BY ci.created_at DESC LIMIT 1) AS last_check_in_at
     FROM family_members WHERE owner_user_id = ? ORDER BY priority ASC, created_at ASC`,
  ).all(req.user!.userId) as Array<Record<string, unknown>>;

  res.json({
    members: rows.map((r) => ({
      id: r.id,
      name: r.name,
      relation: r.relation,
      phone: r.phone,
      iqooAccountId: r.iqoo_account_id,
      iqooEmail: r.iqoo_email ?? null,
      linked: !!r.iqoo_account_id,
      priority: r.priority,
      trusted: !!r.trusted,
      status: r.status,
      lastSeenAt: r.last_seen_at,
      checkInStatus: r.check_in_status ?? null,
      lastCheckInAt: r.last_check_in_at ?? null,
      lastLocation: r.last_lat != null && r.last_lon != null
        ? { latitude: r.last_lat, longitude: r.last_lon }
        : null,
    })),
  });
});

familyRouter.post('/', requireAuth, (req: AuthedRequest, res) => {
  const parsed = memberSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation failed', issues: parsed.error.issues });
    return;
  }
  const m = parsed.data;
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO family_members
       (id, owner_user_id, name, relation, phone, iqoo_account_id, priority, trusted, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'UNKNOWN', ?, ?)`,
  ).run(id, req.user!.userId, m.name, m.relation, m.phone, m.iqooAccountId ?? null, m.priority, m.trusted ? 1 : 0, now, now);
  audit(req.user!.userId, 'family.add', 'family_member', id);
  res.status(201).json({ member: { id, ...m } });
});

familyRouter.put('/:id', requireAuth, (req: AuthedRequest, res) => {
  const parsed = memberSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation failed', issues: parsed.error.issues });
    return;
  }
  const m = parsed.data;
  const row = db.prepare('SELECT id FROM family_members WHERE id = ? AND owner_user_id = ?')
    .get(req.params.id, req.user!.userId) as { id: string } | undefined;
  if (!row) {
    res.status(404).json({ error: 'member not found' });
    return;
  }
  const sets: string[] = [];
  const vals: Array<string | number> = [];
  const map: Record<string, string> = {
    name: 'name', relation: 'relation', phone: 'phone', iqooAccountId: 'iqoo_account_id',
    priority: 'priority', trusted: 'trusted',
  };
  for (const [k, col] of Object.entries(map)) {
    if (m[k as keyof typeof m] !== undefined) {
      sets.push(`${col} = ?`);
      const v = m[k as keyof typeof m];
      vals.push(typeof v === 'boolean' ? (v ? 1 : 0) : String(v));
    }
  }
  if (sets.length > 0) {
    sets.push('updated_at = ?');
    vals.push(new Date().toISOString(), row.id);
    db.prepare(`UPDATE family_members SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    audit(req.user!.userId, 'family.update', 'family_member', row.id);
  }
  res.json({ ok: true });
});

familyRouter.delete('/:id', requireAuth, (req: AuthedRequest, res) => {
  const info = db.prepare('DELETE FROM family_members WHERE id = ? AND owner_user_id = ?')
    .run(req.params.id, req.user!.userId);
  if (info.changes === 0) {
    res.status(404).json({ error: 'member not found' });
    return;
  }
  audit(req.user!.userId, 'family.remove', 'family_member', req.params.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Account linking: connect a family_member row to a ResQNET account by email
// so live check-ins/locations from that account appear in the owner's circle.
// ---------------------------------------------------------------------------

/** Resolve a ResQNET account id from the registered email (for link flows). */
familyRouter.get('/resolve-account', requireAuth, (req: AuthedRequest, res) => {
  const email = String(req.query.email ?? '').trim().toLowerCase();
  if (!email) {
    res.status(400).json({ error: 'email query parameter required' });
    return;
  }
  const user = db.prepare('SELECT id, display_name FROM users WHERE email = ?').get(email) as
    | { id: string; display_name: string }
    | undefined;
  if (!user) {
    res.status(404).json({ error: 'no ResQNET account found for that email' });
    return;
  }
  res.json({ userId: user.id, displayName: user.display_name });
});

/** Link (or re-link) a member to an account id, then pull their latest status. */
familyRouter.post('/:id/link', requireAuth, (req: AuthedRequest, res) => {
  const schema = z.object({ iqooAccountId: z.string().min(1).max(64) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation failed', issues: parsed.error.issues });
    return;
  }
  const row = db.prepare('SELECT id FROM family_members WHERE id = ? AND owner_user_id = ?')
    .get(req.params.id, req.user!.userId) as { id: string } | undefined;
  if (!row) {
    res.status(404).json({ error: 'member not found' });
    return;
  }
  const account = db.prepare('SELECT id FROM users WHERE id = ?').get(parsed.data.iqooAccountId) as
    | { id: string }
    | undefined;
  if (!account) {
    res.status(404).json({ error: 'account not found' });
    return;
  }
  db.prepare('UPDATE family_members SET iqoo_account_id = ?, status = ?, updated_at = ? WHERE id = ?')
    .run(account.id, 'UNKNOWN', new Date().toISOString(), row.id);
  audit(req.user!.userId, 'family.link_account', 'family_member', row.id);

  // Nudge the linked account so fresh check-ins land on every open session.
  broadcastEvent('family_safe_ping', {
    emergencyId: null,
    message: `Family circle updated: ${req.user!.userId === account.id ? 'your own card' : 'a contact'} was linked to your account.`,
    notifiedCount: 1,
    createdAt: new Date().toISOString(),
  });
  res.json({ ok: true, linked: account.id });
});

/** Unlink a member from any account (back to SMS fallback). */
familyRouter.delete('/:id/link', requireAuth, (req: AuthedRequest, res) => {
  const row = db.prepare('SELECT id FROM family_members WHERE id = ? AND owner_user_id = ?')
    .get(req.params.id, req.user!.userId) as { id: string } | undefined;
  if (!row) {
    res.status(404).json({ error: 'member not found' });
    return;
  }
  db.prepare('UPDATE family_members SET iqoo_account_id = NULL, updated_at = ? WHERE id = ?')
    .run(new Date().toISOString(), row.id);
  audit(req.user!.userId, 'family.unlink_account', 'family_member', row.id);
  res.json({ ok: true });
});

/** Force a re-read of every linked member's latest check-in from the DB. */
familyRouter.post('/resync', requireAuth, (req: AuthedRequest, res) => {
  const rows = db.prepare(
    `SELECT fm.id, ci.status, ci.created_at, ci.lat, ci.lon
     FROM family_members fm
     LEFT JOIN check_ins ci ON ci.user_id = fm.iqoo_account_id
     WHERE fm.owner_user_id = ? AND fm.iqoo_account_id IS NOT NULL
     ORDER BY ci.created_at DESC`,
  ).all(req.user!.userId) as Array<{ id: string; status: string | null; created_at: string | null; lat: number | null; lon: number | null }>;
  res.json({ ok: true, linked: rows.length, refreshedAt: new Date().toISOString() });
});
