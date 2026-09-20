import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '../db.js';
import { audit } from '../middleware/audit.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';

export const checkinsRouter = Router();

const checkinSchema = z.object({
  checkInId: z.string().uuid().optional(),
  createdAt: z.string().datetime().optional(),
  status: z.enum(['SAFE', 'AT_RISK', 'NEEDS_HELP']).default('SAFE'),
  note: z.string().max(500).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
});

checkinsRouter.post('/', requireAuth, (req: AuthedRequest, res) => {
  const parsed = checkinSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation failed', issues: parsed.error.issues });
    return;
  }
  const c = parsed.data;
  const id = c.checkInId ?? randomUUID();
  db.prepare(
    'INSERT OR IGNORE INTO check_ins (id, user_id, status, note, lat, lon, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, req.user!.userId, c.status, c.note ?? null, c.lat ?? null, c.lon ?? null, c.createdAt ?? new Date().toISOString());
  audit(req.user!.userId, 'checkin.create', 'check_in', id, { status: c.status });
  res.status(201).json({ ok: true, checkInId: id, status: c.status });
});

/** My recent check-ins (newest first) — used by the Home status view. */
checkinsRouter.get('/', requireAuth, (req: AuthedRequest, res) => {
  const limit = Math.min(Number(req.query.limit ?? 20) || 20, 100);
  const rows = db.prepare(
    'SELECT id, status, note, created_at FROM check_ins WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
  ).all(req.user!.userId, limit) as Array<Record<string, unknown>>;
  res.json({
    checkins: rows.map((r) => ({
      id: r.id, status: r.status, note: r.note, createdAt: r.created_at,
    })),
  });
});

/** Latest check-in per family member's linked IQOO account (§25). */
checkinsRouter.get('/family-status', requireAuth, (req: AuthedRequest, res) => {
  const members = db.prepare(
    `SELECT id, name, iqoo_account_id FROM family_members WHERE owner_user_id = ? ORDER BY priority ASC`,
  ).all(req.user!.userId) as Array<{ id: string; name: string; iqoo_account_id: string | null }>;

  const latest = db.prepare(
    `SELECT status, lat, lon, created_at FROM check_ins WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
  );

  res.json({
    members: members.map((m) => {
      const row = m.iqoo_account_id
        ? (latest.get(m.iqoo_account_id) as { status: string; lat: number | null; lon: number | null; created_at: string } | undefined)
        : undefined;
      return {
        id: m.id,
        name: m.name,
        linked: !!m.iqoo_account_id,
        checkInStatus: row?.status ?? null,
        lastCheckInAt: row?.created_at ?? null,
        lastLocation: row?.lat != null && row?.lon != null ? { latitude: row.lat, longitude: row.lon } : null,
      };
    }),
  });
});
