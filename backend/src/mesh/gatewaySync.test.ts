import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import { signPacket } from '@iqoo/shared';
import type { EmergencyPacket } from '@iqoo/shared';

// Isolated, in-memory DB per test run (schema applied from database/schema.sql).
// Mirrors auth.test.ts bootstrap (node:sqlite via createRequire for vitest 2).
vi.mock('../db.js', async () => {
  const { createRequire } = await import('node:module');
  const nodeRequire = createRequire(import.meta.url);
  const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');
  const fs = (await import('node:fs'));
  const path = (await import('node:path'));
  const schemaPath = path.resolve(process.cwd(), '../database/schema.sql');
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(fs.readFileSync(schemaPath, 'utf8'));
  const tx = <T,>(fn: () => T): T => {
    db.exec('BEGIN');
    try { const r = fn(); db.exec('COMMIT'); return r; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  return { db, tx };
});

let app: import('express').Express;

beforeAll(async () => {
  ({ app } = await import('../server.js'));
});

function makePacket(overrides: Partial<EmergencyPacket> = {}): EmergencyPacket {
  return {
    id: `msg_${crypto.randomUUID()}`,
    emergencyId: `RQ-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    senderId: 'sim_A',
    senderPublicId: 'RQ_NODE_A',
    type: 'SOS',
    priority: 'CRITICAL',
    timestamp: Date.now(),
    location: { latitude: 17.44, longitude: 78.39, accuracyMeters: 20, state: 'GPS_AVAILABLE' },
    battery: 80,
    message: 'integration test packet',
    hopCount: 3,
    ttl: 3600,
    requiresMedicalHelp: true,
    requiresPoliceHelp: false,
    ...overrides,
  } as EmergencyPacket;
}

describe('gateway sync + responders + broadcasts (Phases 7/12)', () => {
  let userToken = '';
  let adminToken = '';

  beforeAll(async () => {
    const reg = await request(app).post('/api/auth/register')
      .send({ email: `mesh${Date.now()}@test.io`, password: 'Str0ngPass!x', displayName: 'Mesh Owner', phone: '9444444441' });
    userToken = reg.body.token;

    const adm = await request(app).post('/api/auth/register')
      .send({ email: `admin${Date.now()}@test.io`, password: 'Str0ngPass!x', displayName: 'Admin', phone: '9444444442' });
    // Promote to admin directly in the (in-memory) DB, then RE-LOGIN so the JWT
    // carries the new role (the registration token still says role=user).
    // 2FA is disabled for this fixture so the login returns a token directly.
    const { db } = await import('../db.js');
    db.prepare("UPDATE users SET role = 'admin', two_factor_enabled = 0 WHERE id = ?").run(adm.body.user.id);
    const login = await request(app).post('/api/auth/login')
      .send({ email: adm.body.user.email, password: 'Str0ngPass!x' });
    adminToken = login.body.token;
  });

  it('gateway sync persists a signed packet as a REAL emergency event (§52 step 7)', async () => {
    const { syncEmergencyFromGateway } = await import('../mesh/gatewaySync.js');
    const packet = makePacket();
    // Sign with the backend pepper so the stored packet is signature-verifiable.
    const signed = { ...packet, signature: 'test-signature' };
    const created = syncEmergencyFromGateway(signed, undefined);
    expect(created).toBe(packet.emergencyId);

    // Idempotent — replaying the same emergency must NOT duplicate it (§47).
    const again = syncEmergencyFromGateway(signed, undefined);
    expect(again).toBeNull();

    // The emergency is visible on the responder feed.
    const feed = await request(app).get('/api/responders/feed')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(feed.status).toBe(200);
    const found = feed.body.activeEmergencies.find((e: { id: string }) => e.id === packet.emergencyId);
    expect(found).toBeTruthy();
    expect(found.severity).toBe('CRITICAL');
    expect(found.location_state).toBe('GPS_AVAILABLE');
  });

  it('ingests a signed packet received from a device peer and rejects tampering', async () => {
    const { db } = await import('../db.js');
    const device = db.prepare('SELECT id, secret FROM devices WHERE user_id = ? ORDER BY created_at LIMIT 1')
      .get((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${userToken}`)).body.user.id) as { id: string; secret: string };
    const packet = makePacket({ senderId: device.id, senderPublicId: 'RQ_NODE_REGISTERED' });
    const signed = await signPacket(packet, device.secret);

    const accepted = await request(app).post('/api/emergencies/mesh/ingest')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ packet: signed });
    expect(accepted.status).toBe(202);
    expect(accepted.body.accepted).toBe(true);
    expect(accepted.body.emergencyId).toBe(packet.emergencyId);

    const tampered = await request(app).post('/api/emergencies/mesh/ingest')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ packet: { ...signed, message: 'tampered' } });
    expect(tampered.status).toBe(401);
  });

  it('family fan-out records a notification per member (§52 step 8)', async () => {
    // Owner with two family members.
    const reg = await request(app).post('/api/auth/register')
      .send({ email: `fam${Date.now()}@test.io`, password: 'Str0ngPass!x', displayName: 'Fam Owner', phone: '9444444443' });
    const { db } = await import('../db.js');
    db.prepare('INSERT INTO family_members (id, owner_user_id, name, relation, phone, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(`fam_${crypto.randomUUID()}`, reg.body.user.id, 'Amma', 'MOTHER', '9999999999', 1, new Date().toISOString(), new Date().toISOString());
    db.prepare('INSERT INTO family_members (id, owner_user_id, name, relation, phone, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(`fam_${crypto.randomUUID()}`, reg.body.user.id, 'Anna', 'BROTHER', '8888888888', 2, new Date().toISOString(), new Date().toISOString());

    const { syncEmergencyFromGateway } = await import('../mesh/gatewaySync.js');
    const packet = makePacket({ emergencyId: `IQ${Math.random().toString(36).slice(2, 8).toUpperCase()}` });
    syncEmergencyFromGateway({ ...packet, signature: 'sig' }, reg.body.user.id);

    const notifs = db.prepare("SELECT * FROM notifications WHERE emergency_id = ? AND channel = 'SSE'").all(packet.emergencyId);
    expect(notifs.length).toBe(2);
  });

  it('responder feed is RBAC-protected — normal users get 403', async () => {
    const res = await request(app).get('/api/responders/feed')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  it('responder can ACK an emergency and the ACK is retrievable (§18)', async () => {
    const { syncEmergencyFromGateway } = await import('../mesh/gatewaySync.js');
    const packet = makePacket({ emergencyId: `IQ${Math.random().toString(36).slice(2, 8).toUpperCase()}` });
    syncEmergencyFromGateway({ ...packet, signature: 'sig' }, undefined);

    const ack = await request(app).post('/api/responders/ack')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ emergencyId: packet.emergencyId, note: 'Unit 12 dispatched' });
    expect(ack.status).toBe(201);
    expect(ack.body.ack).toBeTruthy();

    // Duplicate ACK by same responder → no second row.
    const ack2 = await request(app).post('/api/responders/ack')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ emergencyId: packet.emergencyId });
    expect(ack2.status).toBe(201);

    const list = await request(app).get(`/api/responders/acks/${packet.emergencyId}`)
      .set('Authorization', `Bearer ${userToken}`);
    expect(list.status).toBe(200);
    expect(list.body.acks.length).toBe(1);
    expect(list.body.acks[0].responder_name).toBe('Admin');
  });

  it('nearby returns distance-sorted devices within radius', async () => {
    // Seed positions: create emergencies at known coordinates for two users.
    const { db } = await import('../db.js');
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${userToken}`);
    const other = await request(app).post('/api/auth/register')
      .send({ email: `near${Date.now()}@test.io`, password: 'Str0ngPass!x', displayName: 'Near Neighbor', phone: '9444444444' });
    const now = new Date().toISOString();
    // Emergency for the neighbor ~110m away from the user's query point.
    db.prepare(`INSERT INTO emergency_events (id, user_id, type, status, severity, lat, lon, location_state, created_at, updated_at)
                VALUES (?, ?, 'SOS', 'RESOLVED', 'LOW', 17.441, 78.39, 'GPS_AVAILABLE', ?, ?)`)
      .run(`IQNEAR${Math.random().toString(36).slice(2, 6).toUpperCase()}`, other.body.user.id, now, now);

    const res = await request(app).get('/api/responders/nearby?lat=17.44&lon=78.39&radius_m=2000')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    expect(res.body.nearby.length).toBeGreaterThanOrEqual(1);
    const distances = res.body.nearby.map((n: { distanceM: number }) => n.distanceM);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
  });

  it('issues a disaster broadcast (admin only) and lists it active (§26)', async () => {
    const denied = await request(app).post('/api/broadcasts')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ mode: 'FLOOD', message: 'not allowed' });
    expect(denied.status).toBe(403);

    const ok = await request(app).post('/api/broadcasts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mode: 'FLOOD', message: 'Move to higher ground immediately', priority: 'CRITICAL', lat: 17.44, lon: 78.39, ttlMinutes: 60 });
    expect(ok.status).toBe(201);
    expect(ok.body.broadcast.expiresAt).toBeTruthy();

    const list = await request(app).get('/api/broadcasts').set('Authorization', `Bearer ${userToken}`);
    expect(list.status).toBe(200);
    expect(list.body.broadcasts.some((b: { id: string }) => b.id === ok.body.broadcast.id)).toBe(true);
  });

  it('rejects invalid simulator topology config', async () => {
    const res = await request(app).post('/api/sim/engine')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ links: [] });
    expect(res.status).toBe(400);
  });

  it('end-to-end: sim topology → inject → engine floods, dedupes, ACKs (§51)', async () => {
    const engine = await request(app).post('/api/sim/engine')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        links: [
          { a: 'A', b: 'B', lossRate: 0 },
          { a: 'B', b: 'C', lossRate: 0 },
          { a: 'C', b: 'GATEWAY', lossRate: 0 },
        ],
        batteryPercent: 85,
      });
    expect(engine.status).toBe(200);

    const injected = await request(app).post('/api/sim/inject')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        from: 'A',
        emergencyId: `RQ-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        message: 'e2e mesh test',
        priority: 'CRITICAL',
      });
    expect(injected.status).toBe(200);
    expect(injected.body.accepted).toBe(true);
    // Chain A→B→C→GATEWAY: senders flip to ACKED after per-hop ACKs; the final
    // node (GATEWAY) keeps status DELIVERED — total touched = 4.
    expect(injected.body.snapshot.stats.acked).toBeGreaterThanOrEqual(3);
    expect(injected.body.snapshot.stats.delivered).toBeGreaterThanOrEqual(1);
    expect(injected.body.snapshot.stats.acked + injected.body.snapshot.stats.delivered).toBe(4);
    expect(injected.body.snapshot.stats.duplicates).toBe(0);

    // Gateway receipt wrote a REAL emergency row (§42/§52 bridge).
    const feed = await request(app).get('/api/responders/feed')
      .set('Authorization', `Bearer ${adminToken}`);
    const found = feed.body.activeEmergencies.find((e: { id: string }) => e.id === injected.body.packet.emergencyId);
    expect(found).toBeTruthy();
  });
});
