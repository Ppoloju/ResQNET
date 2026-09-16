// Responder network routes (§18, Phase 7 + Phase 12 responder dashboard).
//  * GET  /nearby      — other users around the caller (haversine, shared/src/net.ts) [R: real proximity uses BLE/OS]
//  * GET  /feed        — active emergencies + recent broadcasts + check-ins for the responder dashboard
//  * POST /ack         — responder acknowledges an emergency (stored + broadcast)
//  * GET  /acks/:emergencyId — acks for one emergency (owner + responders)
//  * POST /seed        — dev/demo only: creates deterministic demo responders (role='responder')

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { audit } from '../middleware/audit.js';
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth.js';
import { broadcastEvent } from './realtime.js';
import { haversineMeters, bearingLabel } from '@iqoo/shared';

export const respondersRouter = Router();

function distanceLabel(m: number | null): string {
  if (m == null) return 'unknown distance';
  if (m < 1000) return `${Math.round(m)} m away`;
  return `${(m / 1000).toFixed(1)} km away`;
}

// ---------------------------------------------------------------- nearby
respondersRouter.get('/nearby', requireAuth, (req: AuthedRequest, res) => {
  const { lat, lon, radius_m: radiusParam } = req.query as Record<string, string | undefined>;
  const userId = req.user!.userId;
  const radius = Math.min(Math.max(Number(radiusParam ?? 2000), 50), 50000);
  if (lat == null || lon == null || Number.isNaN(Number(lat)) || Number.isNaN(Number(lon))) {
    return res.status(400).json({ error: 'lat and lon query params required' });
  }
  const meLat = Number(lat), meLon = Number(lon);

  // Other registered users with recent known positions (last 24h), excluding me.
  // [R] On phones this list comes from BLE scan results; server-side it's the sync database.
  const rows = db.prepare(`
    SELECT u.id, u.display_name, u.role, d.public_id, d.last_seen_at,
           MAX(COALESCE(e.lat, c.lat)) AS lat, MAX(COALESCE(e.lon, c.lon)) AS lon
    FROM users u
    JOIN devices d ON d.user_id = u.id
    LEFT JOIN emergency_events e ON e.user_id = u.id AND e.created_at > datetime('now', '-24 hours')
    LEFT JOIN check_ins c ON c.user_id = u.id AND c.created_at > datetime('now', '-24 hours')
    WHERE u.id != ?
    GROUP BY u.id
  `).all(userId) as Array<{
    id: string; display_name: string; role: string; public_id: string;
    last_seen_at: string | null; lat: number | null; lon: number | null;
  }>;

  const nearby = rows
    .filter((r) => r.lat != null && r.lon != null)
    .map((r) => ({
      id: r.id,
      alias: r.public_id,
      name: r.role === 'responder' ? `${r.display_name} (responder)` : undefined,
      isResponder: r.role === 'responder',
      distanceM: Math.round(haversineMeters(meLat, meLon, r.lat!, r.lon!)),
      bearing: bearingLabel(meLat, meLon, r.lat!, r.lon!),
      lastSeenAt: r.last_seen_at,
    }))
    .filter((r) => r.distanceM <= radius)
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, 50)
    .map((r) => ({ ...r, distanceLabel: distanceLabel(r.distanceM) }));

  res.json({ count: nearby.length, nearby, note: 'Server-side discovery. On-device discovery uses BLE advertisements [R].' });
});

// ---------------------------------------------------------------- dashboard feed
respondersRouter.get('/feed', requireAuth, requireRole('responder', 'admin'), (_req: AuthedRequest, res) => {
  const emergencies = db.prepare(`
    SELECT e.id, e.type, e.status, e.severity, e.category, e.message,
           e.lat, e.lon, e.location_state, e.battery, e.created_at,
           u.display_name AS user_name, e.emergency_profile_snapshot
    FROM emergency_events e JOIN users u ON u.id = e.user_id
    WHERE e.status = 'ACTIVE'
    ORDER BY
      CASE e.severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
      e.created_at DESC
    LIMIT 100
  `).all() as Array<Record<string, unknown>>;

  const broadcasts = db.prepare(`
    SELECT b.id, b.mode AS type, b.message AS title, b.message AS body, b.priority AS severity, b.created_at AS issued_at
    FROM emergency_broadcasts b ORDER BY b.created_at DESC LIMIT 20
  `).all();

  const checkins = db.prepare(`
    SELECT c.id, c.status, c.note AS message, c.lat, c.lon, c.created_at, u.display_name AS user_name
    FROM check_ins c JOIN users u ON u.id = c.user_id
    ORDER BY c.created_at DESC LIMIT 50
  `).all() as Array<Record<string, unknown>>;

  // Profile snapshot is stored as plaintext JSON at send time; strip sensitive fields for feed.
  const feed = emergencies.map((e) => {
    const out: Record<string, unknown> = { ...e, snapshot: null as Record<string, unknown> | null };
    const raw = out.emergency_profile_snapshot;
    delete out.emergency_profile_snapshot;
    if (typeof raw === 'string' && raw) {
      try {
        const snap = JSON.parse(raw) as Record<string, unknown>;
        out.snapshot = {
          name: snap.name, age: snap.age, blood_group: snap.blood_group,
          allergies: snap.allergies, medical_conditions: snap.medical_conditions,
          medications: snap.medications, emergency_contact: snap.emergency_contact_name
            ? `${snap.emergency_contact_name} ${snap.emergency_contact_phone ?? ''}`.trim() : undefined,
        };
      } catch { /* ignore malformed snapshot */ }
    }
    delete out.emergency_profile_snapshot;
    return out;
  });

  res.json({ activeEmergencies: feed, broadcasts, recentCheckins: checkins });
});

// ---------------------------------------------------------------- ack
respondersRouter.post('/ack', requireAuth, requireRole('responder', 'admin'), (req: AuthedRequest, res) => {
  const { emergencyId, note } = (req.body ?? {}) as { emergencyId?: string; note?: string };
  if (!emergencyId) return res.status(400).json({ error: 'emergencyId required' });
  const auth = (req as AuthedRequest).user;
  const event = db.prepare('SELECT id, user_id FROM emergency_events WHERE id = ?').get(emergencyId) as { id: string; user_id: string } | undefined;
  if (!event) return res.status(404).json({ error: 'Emergency not found' });
  const userId = req.user!.userId;

  const ackId = `ack_${randomUUID()}`;
  db.prepare(`INSERT OR IGNORE INTO responder_acks (id, emergency_id, responder_user_id, note, created_at)
              VALUES (?, ?, ?, ?, ?)`)
    .run(ackId, emergencyId, userId, note?.slice(0, 500) ?? null, new Date().toISOString());

  const ack = db.prepare(`
    SELECT a.id, a.emergency_id, a.created_at, a.note, u.display_name AS responder_name
    FROM responder_acks a JOIN users u ON u.id = a.responder_user_id WHERE a.id = ?
  `).get(ackId) as Record<string, unknown> | undefined;

  broadcastEvent('responder_ack', { emergencyId, ack });
  res.status(201).json({ ack, emergency_owner_notified: event.user_id !== userId });
});

respondersRouter.get('/acks/:emergencyId', requireAuth, (req: AuthedRequest, res) => {
  const rows = db.prepare(`
    SELECT a.id, a.emergency_id, a.note, a.created_at, u.display_name AS responder_name
    FROM responder_acks a JOIN users u ON u.id = a.responder_user_id
    WHERE a.emergency_id = ? ORDER BY a.created_at ASC
  `).all(req.params.emergencyId);
  res.json({ acks: rows });
});

// ---------------------------------------------------------------- demo seed (dev only)
respondersRouter.post('/seed', requireAuth, (req: AuthedRequest, res) => {
  const { lat, lon } = (req.body ?? {}) as { lat?: number; lon?: number };
  const userId = req.user!.userId;
  const created: string[] = [];
  const demo = [
    { email: 'station-9@iqoo.demo', name: 'Fire Station 9' },
    { email: 'amb-12@iqoo.demo', name: 'Ambulance 12' },
    { email: 'rescue-hq@iqoo.demo', name: 'Rescue HQ Gateway' },
  ];
  const now = new Date().toISOString();
  for (const d of demo) {
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(d.email) as { id: string } | undefined;
    if (existing) { created.push(existing.id); continue; }
    const uid = `usr_${randomUUID()}`;
    db.prepare(`INSERT INTO users (id, email, display_name, password_hash, role, created_at, updated_at)
                VALUES (?, ?, ?, 'seed-no-login', 'responder', ?, ?)`)
      .run(uid, d.email, d.name, now, now);
    db.prepare(`INSERT INTO devices (id, user_id, name, platform, public_id, secret, last_seen_at, created_at)
                VALUES (?, ?, ?, 'web', ?, ?, ?, ?)`)
      .run(`dev_${randomUUID()}`, uid, `${d.name} console`, `IQOO_NODE_${randomUUID().slice(0, 4).toUpperCase()}`,
           randomUUID().replace(/-/g, ''), now, now);
    created.push(uid);
  }
  res.json({ seeded: created.length, responderIds: created,
    note: lat != null && lon != null ? 'Responders seeded; they appear in /nearby within radius when their positions are known [R].' : 'Responders seeded.' });
});
