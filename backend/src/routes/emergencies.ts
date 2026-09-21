import { Router } from 'express';
import { randomUUID, randomInt } from 'node:crypto';
import { z } from 'zod';
import { isExpired, signPacket, validatePacket, verifySignature, type EmergencyPacket } from '@iqoo/shared';
import { db, tx } from '../db.js';
import { config } from '../config.js';
import { audit } from '../middleware/audit.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { logger } from '../logger.js';
import { broadcastEvent } from './realtime.js';
import { encryptIfPresent, decryptIfEncrypted } from '../security/fieldCrypto.js';
import { enqueueEmergencyNotifications } from '../notifications.js';
import { syncEmergencyFromGateway } from '../mesh/gatewaySync.js';

export const emergenciesRouter = Router();

/** Client-local haptic cue; the server never attempts to access device hardware. */
const SOS_VIBRATION_PATTERN_MS = [120, 60, 180] as const;
const DISARMED_VIBRATION_PATTERN_MS = [60, 40, 60] as const;

const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().min(0).max(100_000).nullable(),
  state: z.enum(['GPS_AVAILABLE', 'NETWORK_LOCATION_AVAILABLE', 'LAST_KNOWN_LOCATION', 'LOCATION_UNAVAILABLE']),
});

const emergencySchema = z.object({
  // The device creates this before it knows whether a gateway is reachable.
  // Keeping it on the online path makes an SOS id stable across offline and
  // online delivery, so the resolution packet can always target the same event.
  emergencyId: z.string().regex(/^(?:RQ|IQ)-[0-9A-Z]{6,12}$/).optional(),
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

const safePingSchema = z.object({
  message: z.string().max(280).default('All safe - please acknowledge when able.'),
});

const emergencySitrepSchema = z.object({
  text: z.string().min(1).max(280),
});

const meshIngestSchema = z.object({ packet: z.unknown() });

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
  return row?.public_id ?? 'RQ_NODE_UNKNOWN';
};

function newEmergencyId(): string {
  // RQ-XXXXXXXX (human-quotable emergency reference)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = 'RQ-';
  for (let i = 0; i < 8; i++) id += alphabet[randomInt(alphabet.length)];
  return id;
}

/** Accept a signed packet received from a foreground peer and promote it to the gateway data plane. */
emergenciesRouter.post('/mesh/ingest', requireAuth, async (req: AuthedRequest, res) => {
  const parsed = meshIngestSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'packet is required' }); return; }
  const packet = parsed.data.packet as Partial<EmergencyPacket>;
  const shape = validatePacket(packet);
  if (!shape.valid) { res.status(400).json({ error: 'invalid mesh packet', issues: shape.issues }); return; }
  const validPacket = packet as EmergencyPacket;
  if (isExpired(validPacket)) { res.status(400).json({ error: 'mesh packet expired' }); return; }
  const origin = db.prepare('SELECT id, user_id, secret FROM devices WHERE id = ?')
    .get(validPacket.senderId) as { id: string; user_id: string; secret: string } | undefined;
  if (!origin || !(await verifySignature(validPacket as unknown as { signature: string; [key: string]: unknown }, origin.secret))) {
    res.status(401).json({ error: 'mesh packet signature rejected' });
    return;
  }
  const emergencyId = syncEmergencyFromGateway(validPacket, origin.user_id);
  res.status(202).json({ accepted: true, emergencyId, receivedBy: req.user!.userId });
});

emergenciesRouter.post('/', requireAuth, async (req: AuthedRequest, res) => {
  const parsed = emergencySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation failed', issues: parsed.error.issues });
    return;
  }
  const input = parsed.data;
  const userId = req.user!.userId;

  try {
    const emergencyId = input.emergencyId ?? newEmergencyId();
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
    enqueueEmergencyNotifications({
      emergencyId,
      ownerUserId: userId,
      severity: input.severity,
      message: input.message,
      requiresMedicalHelp: input.requiresMedicalHelp,
      requiresPoliceHelp: input.requiresPoliceHelp,
      includeEmergencyService: true,
    });
    res.status(201).json({
      emergencyId,
      status: 'ACTIVE',
      clientFeedback: { vibrationPatternMs: SOS_VIBRATION_PATTERN_MS },
    });
  } catch (err) {
    // A client-generated id may very rarely collide. Report a usable conflict
    // instead of a generic server failure (and never overwrite an emergency).
    if (err instanceof Error && /UNIQUE constraint failed: emergency_events\.id/.test(err.message)) {
      res.status(409).json({ error: 'emergency id already exists' });
      return;
    }
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
  res.json({
    ok: true,
    status: 'RESOLVED',
    resolutionPacketId: packet.id,
    clientFeedback: { state: 'DISARMED', vibrationPatternMs: DISARMED_VIBRATION_PATTERN_MS },
  });
});

/** Broadcast a safe-ping notification to every family node on an active SOS. */
emergenciesRouter.post('/:id/safe-ping', requireAuth, (req: AuthedRequest, res) => {
  const parsed = safePingSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation failed', issues: parsed.error.issues }); return; }
  const emergency = db.prepare('SELECT id, status FROM emergency_events WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user!.userId) as { id: string; status: string } | undefined;
  if (!emergency) { res.status(404).json({ error: 'emergency not found' }); return; }
  if (emergency.status !== 'ACTIVE') { res.status(409).json({ error: `emergency already ${emergency.status}` }); return; }

  const members = db.prepare('SELECT id FROM family_members WHERE owner_user_id = ? ORDER BY priority ASC')
    .all(req.user!.userId) as Array<{ id: string }>;
  const now = new Date().toISOString();
  enqueueEmergencyNotifications({
    emergencyId: emergency.id,
    ownerUserId: req.user!.userId,
    severity: 'HIGH',
    message: parsed.data.message.trim(),
    includeEmergencyService: false,
  });
  audit(req.user!.userId, 'emergency.safe_ping', 'emergency_event', emergency.id, { notifiedCount: members.length });
  broadcastEvent('family_safe_ping', { emergencyId: emergency.id, message: parsed.data.message.trim(), notifiedCount: members.length, createdAt: now });
  res.json({ ok: true, emergencyId: emergency.id, notifiedCount: members.length, createdAt: now });
});

/** Store a private, encrypted field note for the owning active emergency. */
emergenciesRouter.post('/:id/sitrep', requireAuth, (req: AuthedRequest, res) => {
  const parsed = emergencySitrepSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation failed', issues: parsed.error.issues }); return; }
  const emergency = db.prepare('SELECT id, status FROM emergency_events WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user!.userId) as { id: string; status: string } | undefined;
  if (!emergency) { res.status(404).json({ error: 'emergency not found' }); return; }
  if (emergency.status !== 'ACTIVE') { res.status(409).json({ error: `emergency already ${emergency.status}` }); return; }

  const id = `esit_${randomUUID()}`;
  const now = new Date().toISOString();
  const encrypted = encryptIfPresent(parsed.data.text.trim());
  if (!encrypted) { res.status(400).json({ error: 'sitrep text required' }); return; }
  db.prepare(`INSERT INTO emergency_sitreps (id, emergency_id, author_user_id, note_encrypted, created_at)
              VALUES (?, ?, ?, ?, ?)`)
    .run(id, emergency.id, req.user!.userId, encrypted, now);
  audit(req.user!.userId, 'emergency.sitrep', 'emergency_sitrep', id, { encrypted: true });
  broadcastEvent('emergency_sitrep', { emergencyId: emergency.id, sitrepId: id, createdAt: now });
  res.status(201).json({ id, emergencyId: emergency.id, createdAt: now, encrypted: true });
});

/** Read the owner's emergency notes; plaintext never leaves this owner boundary. */
emergenciesRouter.get('/:id/sitreps', requireAuth, (req: AuthedRequest, res) => {
  const owned = db.prepare('SELECT id FROM emergency_events WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user!.userId) as { id: string } | undefined;
  if (!owned) { res.status(404).json({ error: 'emergency not found' }); return; }
  const rows = db.prepare('SELECT id, note_encrypted, created_at FROM emergency_sitreps WHERE emergency_id = ? ORDER BY created_at DESC')
    .all(owned.id) as Array<{ id: string; note_encrypted: string; created_at: string }>;
  res.json({ sitreps: rows.map((row) => ({ id: row.id, text: decryptIfEncrypted(row.note_encrypted), createdAt: row.created_at })) });
});

/**
 * Public live feed (§18 nearby-helper view): ACTIVE emergencies from the last
 * 2 hours, newest first. Public safety information — emergency id, type,
 * severity, message, coarse location. No user identity, no medical data.
 * Used for initial load; updates arrive via the SSE `emergency` event.
 */
emergenciesRouter.get('/feed/public', (_req, res) => {
  const since = new Date(Date.now() - 2 * 3600_000).toISOString();
  const rows = db.prepare(
    `SELECT id, type, severity, category, message, lat, lon, location_state, location_accuracy_m, created_at
     FROM emergency_events
     WHERE status = 'ACTIVE' AND created_at > ?
     ORDER BY created_at DESC LIMIT 25`,
  ).all(since) as Array<Record<string, unknown>>;
  res.json({
    emergencies: rows.map((r) => ({
      id: r.id,
      type: r.type,
      severity: r.severity,
      category: r.category,
      message: r.message,
      location: (r.lat != null && r.lon != null && r.location_state !== 'LOCATION_UNAVAILABLE')
        ? { latitude: r.lat, longitude: r.lon, accuracyMeters: r.location_accuracy_m }
        : null,
      createdAt: r.created_at,
    })),
  });
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
