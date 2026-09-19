import { Router } from 'express';
import { z } from 'zod';
import { isExpired, validatePacket, verifySignature, type EmergencyPacket } from '@iqoo/shared';
import { db, tx } from '../db.js';
import { config } from '../config.js';
import { audit } from '../middleware/audit.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { logger } from '../logger.js';

export const syncRouter = Router();

/**
 * Push offline-created events/messages from the device outbox (§47).
 * Idempotency: emergency id is client-generated (IQ-XXXXXXXX), so re-pushing
 * the same event is a no-op via INSERT OR IGNORE; the response tells the
 * client the authoritative state so the outbox can be safely cleared.
 */
const pushSchema = z.object({
  events: z.array(z.object({
    id: z.string().regex(/^IQ-[0-9A-Z]{6,12}$/),
    type: z.enum(['SOS', 'QUICK_HELP', 'CHECK_IN', 'DISASTER_BROADCAST']),
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
    category: z.string().max(40).optional(),
    message: z.string().max(1024).default(''),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lon: z.number().min(-180).max(180).nullable().optional(),
    locationState: z.enum(['GPS_AVAILABLE', 'NETWORK_LOCATION_AVAILABLE', 'LAST_KNOWN_LOCATION', 'LOCATION_UNAVAILABLE']),
    locationAccuracyM: z.number().min(0).max(100_000).nullable().optional(),
    battery: z.number().int().min(0).max(100).nullable().optional(),
    createdAt: z.string(),
  })).max(500),
  packets: z.array(z.object({
    id: z.string(),
    emergencyId: z.string(),
    type: z.string().max(32),
    priority: z.string().max(16),
    payload: z.string(),
    signature: z.string(),
    hopCount: z.number().int().min(0),
    createdAt: z.string(),
  })).max(1000),
});

syncRouter.post('/push', requireAuth, async (req: AuthedRequest, res) => {
  const parsed = pushSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation failed', issues: parsed.error.issues });
    return;
  }
  const { events, packets } = parsed.data;
  const userId = req.user!.userId;
  let eventsAccepted = 0;
  let packetsAccepted = 0;
  const ackedEventIds: string[] = [];
  const ackedPacketIds: string[] = [];

  // Offline packets are untrusted input. Validate the canonical payload and
  // verify it with the authenticated user's registered device before storing.
  const verifiedPackets: Array<{ input: (typeof packets)[number]; packet: EmergencyPacket }> = [];
  for (const input of packets) {
    let packet: EmergencyPacket;
    try {
      packet = JSON.parse(input.payload) as EmergencyPacket;
    } catch {
      res.status(400).json({ error: 'packet payload is not valid JSON' });
      return;
    }
    const shape = validatePacket(packet);
    if (!shape.valid) {
      res.status(400).json({ error: 'invalid packet', issues: shape.issues });
      return;
    }
    if (packet.id !== input.id || packet.emergencyId !== input.emergencyId || packet.signature !== input.signature
      || packet.hopCount !== input.hopCount || packet.type !== input.type || packet.priority !== input.priority) {
      res.status(400).json({ error: 'packet envelope does not match payload' });
      return;
    }
    if (isExpired(packet)) {
      res.status(400).json({ error: 'packet expired' });
      return;
    }
    const device = db.prepare('SELECT secret FROM devices WHERE id = ? AND user_id = ?')
      .get(packet.senderId, userId) as { secret: string } | undefined;
    if (!device || !(await verifySignature(packet, device.secret))) {
      res.status(403).json({ error: 'packet signature is not valid for this user device' });
      return;
    }
    verifiedPackets.push({ input, packet });
  }

  // Emergency ids are globally unique. Do this ownership check before writing
  // so a guessed id cannot attach a caller's packet to somebody else's event.
  const eventIds = new Set(events.map((e) => e.id));
  for (const emergencyId of new Set([...eventIds, ...verifiedPackets.map((p) => p.input.emergencyId)])) {
    const existing = db.prepare('SELECT user_id FROM emergency_events WHERE id = ?').get(emergencyId) as
      | { user_id: string }
      | undefined;
    if (existing && existing.user_id !== userId) {
      res.status(409).json({ error: 'emergency id belongs to another user' });
      return;
    }
    // A packet must either accompany its new event or refer to one the caller owns.
    if (!existing && !eventIds.has(emergencyId)) {
      res.status(400).json({ error: 'packet references an unknown emergency' });
      return;
    }
  }

  tx(() => {
    for (const e of events) {
      const info = db.prepare(
        `INSERT OR IGNORE INTO emergency_events
           (id, user_id, type, status, severity, category, message, lat, lon, location_state,
            location_accuracy_m, battery, network_state, created_at, updated_at)
         VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?, 'OFFLINE', ?, ?)`,
      ).run(
        e.id, userId, e.type, e.severity, e.category ?? null, e.message,
        e.lat ?? null, e.lon ?? null, e.locationState, e.locationAccuracyM ?? null,
        e.battery ?? null, e.createdAt, e.createdAt,
      );
      if (info.changes > 0) eventsAccepted++;
      ackedEventIds.push(e.id); // idempotent ack regardless — client clears outbox
    }
    for (const { input: p } of verifiedPackets) {
      const info = db.prepare(
        `INSERT OR IGNORE INTO emergency_messages
           (id, emergency_id, sender_device_id, type, priority, payload, signature, hop_count, ttl_expires_at, received_via, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'offline-sync', ?)`,
      ).run(
        p.id, p.emergencyId, req.user!.deviceId ?? 'unknown', p.type, p.priority,
        p.payload, p.signature, p.hopCount,
        new Date(Date.now() + config.mesh.ttlSeconds * 1000).toISOString(), p.createdAt,
      );
      if (info.changes > 0) packetsAccepted++;
      ackedPacketIds.push(p.id);
    }
  });

  if (eventsAccepted > 0 || packetsAccepted > 0) {
    audit(userId, 'sync.push', 'emergency_events', undefined, { eventsAccepted, packetsAccepted });
    logger.info({ userId, eventsAccepted, packetsAccepted }, 'sync push');
  }
  res.json({ ackedEventIds, ackedPacketIds, eventsAccepted, packetsAccepted });
});

/** Pull: batches of packets the client has not yet confirmed (cursor = created_at). */
syncRouter.get('/pull', requireAuth, (req: AuthedRequest, res) => {
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : new Date(0).toISOString();
  const limit = Math.min(Number(req.query.limit ?? config.syncBatchSize ?? 50), 200);
  const rows = db.prepare(
    `SELECT m.id, m.emergency_id, m.type, m.priority, m.payload, m.signature, m.hop_count, m.created_at
     FROM emergency_messages m
     JOIN emergency_events e ON e.id = m.emergency_id
     WHERE e.user_id = ? AND m.created_at > ?
     ORDER BY m.created_at ASC LIMIT ?`,
  ).all(req.user!.userId, cursor, limit + 1) as Array<Record<string, unknown>>;

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  res.json({
    packets: page.map((r) => ({
      id: r.id, emergencyId: r.emergency_id, type: r.type, priority: r.priority,
      payload: JSON.parse(r.payload as string), signature: r.signature,
      hopCount: r.hop_count, createdAt: r.created_at,
    })),
    nextCursor: page.length > 0 ? (page[page.length - 1].created_at as string) : cursor,
    hasMore,
  });
});

/** Mark packets as delivered to this client (ack on pull). */
syncRouter.post('/ack', requireAuth, (req: AuthedRequest, res) => {
  const schema = z.object({ packetIds: z.array(z.string()).max(1000) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation failed' });
    return;
  }
  const now = new Date().toISOString();
  tx(() => {
    for (const pid of parsed.data.packetIds) {
      db.prepare(
        `UPDATE emergency_messages SET synced_at = ? WHERE id = ?
         AND emergency_id IN (SELECT id FROM emergency_events WHERE user_id = ?)`,
      ).run(now, pid, req.user!.userId);
    }
  });
  res.json({ ok: true, acked: parsed.data.packetIds.length });
});
