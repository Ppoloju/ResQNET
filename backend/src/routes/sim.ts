import { Router } from 'express';
import { z } from 'zod';
import { signPacket, verifySignature, validatePacket, isExpired, relayReadiness } from '@iqoo/shared';
import { MeshEngine } from '../mesh/engine.js';
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { broadcastEvent } from './realtime.js';
import { syncEmergencyFromGateway } from '../mesh/gatewaySync.js';

export const simRouter = Router();

// One shared engine instance per process (demo/simulation only — NOT real radios).
const engine = new MeshEngine({
  nodeId: 'SIM_GW',
  secret: config.msgSigningPepper,
  defaultTtlSeconds: config.mesh.ttlSeconds,
  maxHops: config.mesh.maxHops,
  linkDelayMs: 150,
  lossRate: 0.05,
  onDeliver: (packet, toNodeId, transport) => {
    broadcastEvent('mesh_delivery', {
      packetId: packet.id, emergencyId: packet.emergencyId, toNodeId, transport,
      hopCount: packet.hopCount, ts: Date.now(),
    });
    // Unified feed for the frontend Emergency Message Map (§38).
    broadcastEvent('mesh_event', {
      id: packet.id, emergencyId: packet.emergencyId, type: 'DELIVERED',
      from: 'MESH', to: toNodeId, hopCount: packet.hopCount, priority: packet.priority, ts: Date.now(),
    });
    // Gateway receipt enters the REAL data plane (§42/§52 step 7-8).
    if (toNodeId === 'GATEWAY') {
      syncEmergencyFromGateway(packet);
    }
    logger.info({ packetId: packet.id, emergencyId: packet.emergencyId, toNodeId, transport }, 'SIM delivery');
  },
  onExpired: (packetId) => {
    broadcastEvent('mesh_expired', { packetId, ts: Date.now() });
    logger.info({ packetId }, 'SIM packet expired');
  },
});

const engineSchema = z.object({
  links: z.array(z.object({
    a: z.string().min(1),
    b: z.string().min(1),
    lossRate: z.number().min(0).max(1).optional(),
  })).min(1),
  batteryPercent: z.number().min(0).max(100).default(80),
});

const injectSchema = z.object({
  from: z.string().min(1),
  emergencyId: z.string().regex(/^IQ-[0-9A-Z]{6,12}$/),
  message: z.string().max(1024).default('SOS from simulator'),
  priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).default('CRITICAL'),
  location: z.object({
    latitude: z.number(),
    longitude: z.number(),
    accuracyMeters: z.number().nullable().default(25),
    state: z.enum(['GPS_AVAILABLE', 'NETWORK_LOCATION_AVAILABLE', 'LAST_KNOWN_LOCATION', 'LOCATION_UNAVAILABLE']),
  }).default({ latitude: 17.385, longitude: 78.4867, accuracyMeters: 25, state: 'GPS_AVAILABLE' }),
  battery: z.number().int().min(0).max(100).default(80),
  requiresMedicalHelp: z.boolean().default(true),
  requiresPoliceHelp: z.boolean().default(false),
});

/** Configure topology + battery, reset engine state. DEMO/SIMULATION endpoint. */
simRouter.post('/engine', requireAuth, (req: AuthedRequest, res) => {
  const parsed = engineSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation failed', issues: parsed.error.issues });
    return;
  }
  const { links, batteryPercent } = parsed.data;
  engine.reset(batteryPercent);
  for (const l of links) engine.addLink(l.a, l.b, l.lossRate);
  broadcastEvent('sim_topology', { nodes: engine.nodes.size, links: links.length });
  res.json({ ok: true, nodes: engine.nodes.size });
});

/** Inject an emergency at a node; the mesh engine floods it deterministically. */
simRouter.post('/inject', requireAuth, async (req: AuthedRequest, res) => {
  const parsed = injectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation failed', issues: parsed.error.issues });
    return;
  }
  const input = parsed.data;
  const packet = await signPacket({
    id: `msg_${crypto.randomUUID()}`,
    emergencyId: input.emergencyId,
    senderId: `sim_${input.from}`,
    senderPublicId: `IQOO_NODE_${input.from}`,
    type: 'SOS' as const,
    priority: input.priority,
    timestamp: Date.now(),
    location: input.location,
    battery: input.battery,
    message: input.message,
    hopCount: 0,
    ttl: config.mesh.ttlSeconds,
    requiresMedicalHelp: input.requiresMedicalHelp,
    requiresPoliceHelp: input.requiresPoliceHelp,
  }, config.msgSigningPepper);

  const result = await engine.inject(input.from, packet);
  // Deterministic demo behavior: settle the flood before responding so callers
  // immediately observe deliveries/acks/timeline.
  await engine.settle();
  broadcastEvent('mesh_event', {
    id: packet.id, emergencyId: input.emergencyId, type: 'ORIGINATED',
    from: input.from, to: input.from, hopCount: 0, priority: packet.priority, ts: Date.now(),
  });
  broadcastEvent('sim_injected', { from: input.from, emergencyId: input.emergencyId, accepted: result.accepted });
  res.json({ packet, ...result, snapshot: engine.getSnapshot() });
});

/** Full observation: nodes, deliveries, timeline. */
simRouter.get('/state', requireAuth, (_req, res) => {
  res.json(engine.getSnapshot());
});

// ---- Chaos controls: link flapping + node death + battery drain (§51, §11) ----

const linkSchema = z.object({ a: z.string().min(1), b: z.string().min(1) });
const batterySchema = z.object({ nodeId: z.string().min(1), battery: z.number().min(0).max(100) });

simRouter.post('/link/down', requireAuth, (req: AuthedRequest, res) => {
  const p = linkSchema.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: 'validation failed' }); return; }
  engine.setLinkDown(p.data.a, p.data.b);
  broadcastEvent('sim_link', { a: p.data.a, b: p.data.b, up: false });
  res.json({ ok: true });
});

simRouter.post('/link/up', requireAuth, (req: AuthedRequest, res) => {
  const p = linkSchema.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: 'validation failed' }); return; }
  engine.setLinkUp(p.data.a, p.data.b);
  broadcastEvent('sim_link', { a: p.data.a, b: p.data.b, up: true });
  res.json({ ok: true });
});

simRouter.post('/battery', requireAuth, (req: AuthedRequest, res) => {
  const p = batterySchema.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: 'validation failed' }); return; }
  engine.setBattery(p.data.nodeId, p.data.battery);
  res.json({ ok: true });
});

simRouter.post('/sweep', requireAuth, (_req, res) => {
  res.json({ expired: engine.sweepExpired() });
});

/** Relay Readiness self-report (§37): explain WHY a device would/wouldn't relay. */
simRouter.post('/relay-readiness', requireAuth, (req: AuthedRequest, res) => {
  const schema = z.object({
    batteryPercent: z.number().min(0).max(100).nullable().default(null),
    userConsent: z.boolean().default(true),
    foreground: z.boolean().default(true),
    role: z.enum(['NORMAL', 'RELAY', 'RESPONDER', 'GATEWAY']).default('NORMAL'),
  });
  const p = schema.safeParse({ ...req.body, connected: true });
  if (!p.success) { res.status(400).json({ error: 'validation failed', issues: p.error.issues }); return; }
  res.json(relayReadiness({ ...p.data, connected: true }));
});

/** Verify any packet client-side style (used by demo to prove signature checking). */
simRouter.post('/verify', requireAuth, (req: AuthedRequest, res) => {
  const ok = verifySignature(req.body, config.msgSigningPepper);
  const shape = validatePacket(req.body);
  const expired = shape.valid ? isExpired(req.body as { timestamp: number; ttl: number }) : null;
  res.json({ signatureValid: ok, schemaValid: shape.valid, issues: shape.issues, expired });
});

/** Responder-role demo endpoint (RBAC check, §32). */
simRouter.get('/responder-feed', requireAuth, requireRole('responder', 'admin'), (_req, res) => {
  res.json(engine.getSnapshot());
});
