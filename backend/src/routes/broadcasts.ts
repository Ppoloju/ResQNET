// Disaster broadcast system (§26): responder/admin-issued warnings that flood
// the mesh and reach every connected client via SSE. Expiration is mandatory.

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '../db.js';
import { engine } from './sim.js';
import { audit } from '../middleware/audit.js';
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth.js';
import { broadcastEvent } from './realtime.js';

export const broadcastsRouter = Router();

const createSchema = z.object({
  mode: z.enum(['EVACUATION', 'SHELTER', 'MEDICAL', 'FIRE', 'FLOOD', 'EARTHQUAKE', 'MISSING_PERSON', 'GENERAL_WARNING']),
  message: z.string().min(1).max(1024),
  priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).default('HIGH'),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  radiusM: z.number().min(0).max(500_000).optional(),
  ttlMinutes: z.number().int().min(5).max(1440).default(120),
});

/** Issue a broadcast (responder/admin only, §32 RBAC). */
broadcastsRouter.post('/', requireAuth, requireRole('responder', 'admin'), (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation failed', issues: parsed.error.issues });
    return;
  }
  const b = parsed.data;
  const id = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + b.ttlMinutes * 60_000).toISOString();

  db.prepare(
    `INSERT INTO emergency_broadcasts
       (id, source_user_id, mode, message, priority, lat, lon, radius_m, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, req.user!.userId, b.mode, b.message, b.priority, b.lat ?? null, b.lon ?? null,
    b.radiusM ?? null, now.toISOString(), expiresAt);

  audit(req.user!.userId, 'broadcast.create', 'emergency_broadcast', id, { mode: b.mode, priority: b.priority });

  // §13: a CRITICAL disaster broadcast puts the mesh into disaster mode —
  // outbox becomes priority-queued (SOS/SITREP first) until it is cancelled.
  if (b.priority === 'CRITICAL') {
    engine.setDisasterMode(true);
  }
  const payload = {
    id, mode: b.mode, message: b.message, priority: b.priority,
    lat: b.lat ?? null, lon: b.lon ?? null, radiusM: b.radiusM ?? null,
    createdAt: now.toISOString(), expiresAt,
  };
  broadcastEvent('disaster_broadcast', payload);
  res.status(201).json({ ok: true, broadcast: payload });
});

/** Active broadcasts visible to any signed-in user (used on Home/banner). */
broadcastsRouter.get('/', requireAuth, (_req: AuthedRequest, res) => {
  const now = new Date().toISOString();
  const rows = db.prepare(
    `SELECT id, mode, message, priority, lat, lon, radius_m, created_at, expires_at
     FROM emergency_broadcasts WHERE expires_at > ? ORDER BY created_at DESC LIMIT 50`,
  ).all(now) as Array<Record<string, unknown>>;
  res.json({
    broadcasts: rows.map((r) => ({
      id: r.id, mode: r.mode, message: r.message, priority: r.priority,
      lat: r.lat, lon: r.lon, radiusM: r.radius_m, createdAt: r.created_at, expiresAt: r.expires_at,
    })),
  });
});

/** Cancel a broadcast I issued (admin can cancel any). */
broadcastsRouter.post('/:id/cancel', requireAuth, requireRole('responder', 'admin'), (req: AuthedRequest, res) => {
  const row = db.prepare('SELECT * FROM emergency_broadcasts WHERE id = ?').get(req.params.id) as
    | { id: string; source_user_id: string; expires_at: string } | undefined;
  if (!row) { res.status(404).json({ error: 'broadcast not found' }); return; }
  if (req.user!.role !== 'admin' && row.source_user_id !== req.user!.userId) {
    res.status(403).json({ error: 'not your broadcast' });
    return;
  }
  db.prepare('UPDATE emergency_broadcasts SET expires_at = ? WHERE id = ?')
    .run(new Date().toISOString(), req.params.id); // expire now
  audit(req.user!.userId, 'broadcast.cancel', 'emergency_broadcast', req.params.id);
  // If a CRITICAL broadcast ends early, re-evaluate: only leave disaster mode
  // when no other active CRITICAL broadcast exists.
  const stillCritical = db.prepare(
    "SELECT COUNT(*) AS n FROM emergency_broadcasts WHERE priority = 'CRITICAL' AND expires_at > ?",
  ).get(new Date().toISOString()) as { n: number };
  if (stillCritical.n === 0) engine.setDisasterMode(false);
  broadcastEvent('broadcast_cancelled', { id: req.params.id });
  res.json({ ok: true });
});
