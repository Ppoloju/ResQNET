import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '../db.js';
import { audit } from '../middleware/audit.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';

export const familyRouter = Router();

const RELATIONS = ['FATHER', 'MOTHER', 'BROTHER', 'SISTER', 'PARTNER', 'FRIEND', 'GUARDIAN', 'OTHER'] as const;
type Relation = (typeof RELATIONS)[number];

const memberSchema = z.object({
  name: z.string().min(1).max(80),
  relation: z.enum(RELATIONS),
  phone: z.string().min(5).max(20),
  iqooAccountId: z.string().max(64).optional(),
  priority: z.number().int().min(1).max(9).default(5),
  trusted: z.boolean().default(false),
});

familyRouter.get('/', requireAuth, (req: AuthedRequest, res) => {
  const rows = db.prepare(
    `SELECT id, name, relation, phone, iqoo_account_id, priority, trusted, status, last_seen_at, last_lat, last_lon,
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
