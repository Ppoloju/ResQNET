// Missing person reports (§27). Future-ready: authorized creation, explicit
// consent-gated sharing. NO automatic facial recognition — any matching is
// human-reviewed by people who receive the alert.

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '../db.js';
import { audit } from '../middleware/audit.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { broadcastEvent } from './realtime.js';

export const missingRouter = Router();

const createSchema = z.object({
  personName: z.string().min(1).max(80),
  description: z.string().max(2000).optional(),
  clothing: z.string().max(500).optional(),
  photo: z.string().max(200_000).optional(), // small data URL, shared only via alert
  lastSeenAt: z.string().min(4),
  lastLat: z.number().min(-90).max(90).optional(),
  lastLon: z.number().min(-180).max(180).optional(),
  contactPhone: z.string().min(3).max(20),
});

missingRouter.post('/', requireAuth, (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation failed', issues: parsed.error.issues });
    return;
  }
  const m = parsed.data;
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO missing_person_reports
       (id, reporter_user_id, person_name, description, clothing, photo,
        last_seen_at, last_lat, last_lon, contact_phone, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?)`,
  ).run(id, req.user!.userId, m.personName, m.description ?? null, m.clothing ?? null,
    m.photo ?? null, m.lastSeenAt, m.lastLat ?? null, m.lastLon ?? null, m.contactPhone, now, now);

  audit(req.user!.userId, 'missing.create', 'missing_person_report', id, { personName: m.personName });
  res.status(201).json({ ok: true, reportId: id });
});

missingRouter.get('/', requireAuth, (_req: AuthedRequest, res) => {
  const rows = db.prepare(
    `SELECT id, person_name, description, clothing, last_seen_at, last_lat, last_lon,
            contact_phone, status, created_at
     FROM missing_person_reports WHERE status = 'OPEN' ORDER BY created_at DESC LIMIT 50`,
  ).all() as Array<Record<string, unknown>>;
  res.json({
    reports: rows.map((r) => ({
      id: r.id, personName: r.person_name, description: r.description, clothing: r.clothing,
      lastSeenAt: r.last_seen_at, lastLat: r.last_lat, lastLon: r.last_lon,
      contactPhone: r.contact_phone, status: r.status, createdAt: r.created_at,
    })),
  });
});

/** Mark found / cancel — closes the loop and stops further alerts. */
missingRouter.post('/:id/status', requireAuth, (req: AuthedRequest, res) => {
  const schema = z.object({ status: z.enum(['FOUND', 'CANCELLED']) });
  const p = schema.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: 'validation failed' }); return; }
  const row = db.prepare('SELECT reporter_user_id FROM missing_person_reports WHERE id = ?')
    .get(req.params.id) as { reporter_user_id: string } | undefined;
  if (!row) { res.status(404).json({ error: 'report not found' }); return; }
  if (row.reporter_user_id !== req.user!.userId && req.user!.role !== 'admin') {
    res.status(403).json({ error: 'not your report' });
    return;
  }
  const now = new Date().toISOString();
  db.prepare('UPDATE missing_person_reports SET status = ?, updated_at = ? WHERE id = ?')
    .run(p.data.status, now, req.params.id);
  audit(req.user!.userId, `missing.${p.data.status.toLowerCase()}`, 'missing_person_report', req.params.id);
  broadcastEvent('missing_person_update', { id: req.params.id, status: p.data.status });
  res.json({ ok: true, status: p.data.status });
});
