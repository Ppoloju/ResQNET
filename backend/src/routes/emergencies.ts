import { Router } from 'express';
import { randomUUID, randomInt } from 'node:crypto';
import { z } from 'zod';
import { signPacket } from '@iqoo/shared';
import { db, tx } from '../db.js';
import { config } from '../config.js';
import { audit } from '../middleware/audit.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { logger } from '../logger.js';

export const emergenciesRouter = Router();

const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().min(0).max(100_000).nullable(),
  state: z.enum(['GPS_AVAILABLE', 'NETWORK_LOCATION_AVAILABLE', 'LAST_KNOWN_LOCATION', 'LOCATION_UNAVAILABLE']),
});

const emergencySchema = z.object({
  type: z.enum(['SOS', 'QUICK_HELP', 'CHECK_IN', 'DISASTER_BROADCAST']).default('SOS'),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('HIGH'),
  category: z.string().max(40).optional(),
  message: z.string().max(1024).default(''),
  location: locationSchema,
  battery: z.number().int().min(0).max(100).nullable().optional(),
  requiresMedicalHelp: z.boolean().default(true),
  requiresPoliceHelp: z.boolean().default(false),
  ai: z.object({
    category: z.string(),
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
    confidence: z.number().min(0).max(1),
    recommendedAction: z.string(),
  }).optional(),
});

const deviceIdByUser = (userId: string): string => {
  const row = db.prepare('SELECT id FROM devices WHERE user_id = ? ORDER BY created_at LIMIT 1').get(userId) as
    | { id: string }
    | undefined;
  if (!row) throw new Error('no registered device');
  return row.id;
};

const publicIdByUser = (userId: string): string => {
  const row = db.prepare('SELECT public_id FROM devices WHERE user_id = ? ORDER BY created_at LIMIT 1').get(userId) as
    | { public_id: string }
    | undefined;
  return row?.public_id ?? 'IQOO_NODE_UNKNOWN';
};

function newEmergencyId(): string {
  // IQ-XXXXXXXX (§21 example format)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = 'IQ-';
  for (let i = 0; i < 8; i++) id += alphabet[randomInt(alphabet.length)];
  return id;
}

emergenciesRouter.post('/', requireAuth, async (req: AuthedRequest, res) => {
  const parsed = emergencySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation failed', issues: parsed.error.issues });
    return;
  }
  const input = parsed.data;
  const userId = req.user!.userId;

  try {
    const emergencyId = newEmergencyId();
    const now = new Date().toISOString();
    const networkState = 'ONLINE'; // reaching the backend proves internet is available

    // Authoritative packet, signed server-side with the sender's device secret (§10/§32).
    // Signing happens BEFORE the transaction (WebCrypto HMAC is async; better-sqlite3 tx is sync).
    const deviceId = deviceIdByUser(userId);
    const publicId = publicIdByUser(userId);
    const secret = (db.prepare('SELECT secret FROM devices WHERE id = ?').get(deviceId) as { secret: string }).secret;
    const packet = await signPacket({
      id: `msg_${randomUUID()}`,
      emergencyId,
      senderId: deviceId,
      senderPublicId: publicId,
      type: input.type === 'CHECK_IN' ? 'CHECK_IN' : input.type,
      priority: input.severity === 'CRITICAL' ? 'CRITICAL' : input.severity === 'HIGH' ? 'HIGH' : 'MEDIUM',
      timestamp: Date.now(),
      location: input.location,
      battery: input.battery ?? null,
      message: input.message,
      hopCount: 0,
      ttl: config.mesh.ttlSeconds,
      requiresMedicalHelp: input.requiresMedicalHelp,
      requiresPoliceHelp: input.requiresPoliceHelp,
      ai: input.ai,
    }, secret);

    tx(() => {
      db.prepare(
        `INSERT INTO emergency_events
           (id, user_id, type, status, severity, category, message, lat, lon, location_state,
            location_accuracy_m, battery, network_state, created_at, updated_at)
         VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        emergencyId, userId, input.type, input.severity, input.category ?? null,
        input.message, input.location.latitude, input.location.longitude,
        input.location.state, input.location.accuracyMeters, input.battery ?? null,
        networkState, now, now,
      );

      db.prepare(
        `INSERT INTO emergency_messages
           (id, emergency_id, sender_device_id, type, priority, payload, signature, hop_count, ttl_expires_at, received_via, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'backend', ?)`,
        ).run(
          packet.id, emergencyId, deviceId, packet.type, packet.priority,
          JSON.stringify(packet), packet.signature,
          new Date(packet.timestamp + packet.ttl * 1000).toISOString(), now,
        );
    });

    audit(userId, 'emergency.create', 'emergency_event', emergencyId, { type: input.type, severity: input.severity });
    logger.info({ emergencyId, type: input.type }, 'emergency created');
    res.status(201).json({ emergencyId, status: 'ACTIVE' });
  } catch (err) {
    logger.error({ err }, 'emergency creation failed');
    res.status(500).json({ error: err instanceof Error ? err.message : 'creation failed' });
  }
});

/** Resolve / I'm-safe (§22). Broadcasts a signed RESOLUTION packet. */
emergenciesRouter.post('/:id/resolve', requireAuth, async (req: AuthedRequest, res) => {
  const row = db.prepare('SELECT * FROM emergency_events WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user!.userId) as Record<string, unknown> | undefined;
  if (!row) {
    res.status(404).json({ error: 'emergency not found' });
    return;
  }
  if (row.status !== 'ACTIVE') {
    res.status(409).json({ error: `emergency already ${row.status}` });
    return;
  }
  const now = new Date().toISOString();
  const deviceId = deviceIdByUser(req.user!.userId);
  const secret = (db.prepare('SELECT secret FROM devices WHERE id = ?').get(deviceId) as { secret: string }).secret;

  const packet = await signPacket({
    id: `msg_${randomUUID()}`,
    emergencyId: row.id as string,
    senderId: deviceId,
    senderPublicId: publicIdByUser(req.user!.userId),
    type: 'RESOLUTION',
    priority: 'HIGH',
    timestamp: Date.now(),
    location: {
      latitude: (row.lat as number | null) ?? 0,
      longitude: (row.lon as number | null) ?? 0,
      accuracyMeters: (row.location_accuracy_m as number | null) ?? null,
      state: row.location_state as 'GPS_AVAILABLE' | 'NETWORK_LOCATION_AVAILABLE' | 'LAST_KNOWN_LOCATION' | 'LOCATION_UNAVAILABLE',
    },
    battery: (row.battery as number | null) ?? null,
    message: 'Emergency resolved by user',
    hopCount: 0,
    ttl: config.mesh.ttlSeconds,
    requiresMedicalHelp: false,
    requiresPoliceHelp: false,
  }, secret);

  tx(() => {
    db.prepare(
      `INSERT INTO emergency_messages
         (id, emergency_id, sender_device_id, type, priority, payload, signature, hop_count, ttl_expires_at, received_via, created_at)
       VALUES (?, ?, ?, 'RESOLUTION', 'HIGH', ?, ?, 0, ?, 'backend', ?)`,
    ).run(packet.id, row.id as string, deviceId, JSON.stringify(packet), packet.signature,
      new Date(packet.timestamp + packet.ttl * 1000).toISOString(), now);
    db.prepare(
      `UPDATE emergency_events SET status='RESOLVED', resolved_at=?, resolved_how='USER_SAFE', updated_at=? WHERE id=?`,
    ).run(now, now, row.id as string);
  });

  audit(req.user!.userId, 'emergency.resolve', 'emergency_event', row.id as string);
  res.json({ ok: true, status: 'RESOLVED', resolutionPacketId: packet.id });
});

/** List own emergencies (emergency history / black box seed). */
emergenciesRouter.get('/', requireAuth, (req: AuthedRequest, res) => {
  const rows = db.prepare(
    `SELECT id, type, status, severity, category, message, lat, lon, location_state,
            location_accuracy_m, battery, created_at, resolved_at, resolved_how
     FROM emergency_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
  ).all(req.user!.userId) as Array<Record<string, unknown>>;
  res.json({
    emergencies: rows.map((r) => ({
      id: r.id, type: r.type, status: r.status, severity: r.severity, category: r.category,
      message: r.message,
      location: r.lat != null && r.lon != null ? { latitude: r.lat, longitude: r.lon, state: r.location_state, accuracyMeters: r.location_accuracy_m } : null,
      battery: r.battery, createdAt: r.created_at, resolvedAt: r.resolved_at, resolvedHow: r.resolved_how,
    })),
  });
});

/** Full event detail incl. signed packets — the "Emergency Black Box" (§39). */
emergenciesRouter.get('/:id', requireAuth, (req: AuthedRequest, res) => {
  const event = db.prepare('SELECT * FROM emergency_events WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user!.userId) as Record<string, unknown> | undefined;
  if (!event) {
    res.status(404).json({ error: 'emergency not found' });
    return;
  }
  const packets = db.prepare(
    `SELECT id, type, priority, payload, signature, hop_count, created_at, synced_at
     FROM emergency_messages WHERE emergency_id = ? ORDER BY created_at ASC`,
  ).all(req.params.id) as Array<Record<string, unknown>>;
  res.json({
    emergency: event,
    packets: packets.map((p) => ({
      id: p.id, type: p.type, priority: p.priority,
      payload: JSON.parse(p.payload as string), signature: p.signature,
      hopCount: p.hop_count, createdAt: p.created_at, syncedAt: p.synced_at,
    })),
  });
});
