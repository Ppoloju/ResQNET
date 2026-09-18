// Disaster-mode situation reports (§13): bulletins that flow through the mesh
// and sync at the gateway into the same data plane as emergencies. AI tagging
// never rewrites content — routes only validate, store, and broadcast.

import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { AuthedRequest } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db.js';
import { audit } from '../middleware/audit.js';
import { broadcastEvent } from './realtime.js';
import { SITREP_MAX_LEN } from '@iqoo/shared';

export const sitrepsRouter = Router();

const sitrepSchema = z.object({
  kind: z.enum(['HAZARD', 'SHELTER', 'ROAD', 'SUPPLIES', 'RESOLVED']),
  text: z.string().min(1).max(SITREP_MAX_LEN),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lon: z.number().min(-180).max(180).nullable().optional(),
});

/** Post a bulletin (auth; any user can contribute situational awareness, §13). */
sitrepsRouter.post('/', requireAuth, (req: AuthedRequest, res) => {
  const parsed = sitrepSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation failed', issues: parsed.error.issues });
    return;
  }
  const s = parsed.data;
  const id = `sit_${randomUUID()}`;
  const now = new Date().toISOString();
  db.prepare('INSERT INTO sitreps (id, kind, text, lat, lon, author_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, s.kind, s.text.trim(), s.lat ?? null, s.lon ?? null, req.user!.userId, now);
  audit(req.user!.userId, 'sitrep.create', 'sitrep', id, { kind: s.kind });
  broadcastEvent('sitrep', { id, kind: s.kind, text: s.text.trim(), lat: s.lat ?? null, lon: s.lon ?? null, createdAt: now, authorId: req.user!.userId });
  res.status(201).json({ id, createdAt: now });
});

/**
 * List recent bulletins (newest first), optionally filtered by kind.
 * Public by design (§13): disaster bulletins are public safety information —
 * someone without an account must still see "bridge collapsed ahead".
 * Posting stays authenticated.
 */
sitrepsRouter.get('/', (req, res) => {
  const kind = typeof req.query.kind === 'string' ? req.query.kind : null;
  const rows = kind
    ? db.prepare('SELECT * FROM sitreps WHERE kind = ? ORDER BY created_at DESC LIMIT 100').all(kind)
    : db.prepare('SELECT * FROM sitreps ORDER BY created_at DESC LIMIT 100').all();
  res.json({
    sitreps: rows.map((r) => ({
      id: r.id, kind: r.kind, text: r.text, lat: r.lat, lon: r.lon,
      createdAt: r.created_at, authorId: r.author_user_id,
    })),
  });
});
