import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

// Isolated, in-memory DB per test run (schema applied from database/schema.sql).
// NOTE: node:sqlite is loaded via createRequire because vitest 2's resolver predates it.
vi.mock('../db.js', async () => {
  const { createRequire } = await import('node:module');
  const nodeRequire = createRequire(import.meta.url);
  const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');
  const fs = (await import('node:fs'));
  const path = (await import('node:path'));
  // cwd is backend/ (vitest) — repo root is one level up; then database/schema.sql.
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
}, 30_000);

describe('auth + API smoke', () => {
  let token = '';
  const email = `u${Date.now()}@test.io`;

  it('registers a user and returns device secret once', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'Str0ngPass!x', displayName: 'Test User' });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.device.publicId).toMatch(/^IQOO_NODE_[0-9A-F]{4}$/);
    expect(res.body.device.secret).toHaveLength(64);
    token = res.body.token;
  });

  it('rejects duplicate registration', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'Str0ngPass!x', displayName: 'Test User' });
    expect(res.status).toBe(409);
  });

  it('logs in with valid credentials only', async () => {
    const ok = await request(app).post('/api/auth/login')
      .send({ email, password: 'Str0ngPass!x' });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();

    const bad = await request(app).post('/api/auth/login')
      .send({ email, password: 'wrong' });
    expect(bad.status).toBe(401);
  });

  it('normalizes auth input and rejects blank display names', async () => {
    const normalized = await request(app).post('/api/auth/register')
      .send({ email: '  spaced-user@test.io  ', password: 'Str0ngPass!x', displayName: '  Spaced User  ' });
    expect(normalized.status).toBe(201);
    expect(normalized.body.user.email).toBe('spaced-user@test.io');
    expect(normalized.body.user.displayName).toBe('Spaced User');

    const login = await request(app).post('/api/auth/login')
      .send({ email: '  spaced-user@test.io  ', password: 'Str0ngPass!x' });
    expect(login.status).toBe(200);

    const blankName = await request(app).post('/api/auth/register')
      .send({ email: 'blank-name@test.io', password: 'Str0ngPass!x', displayName: '   ' });
    expect(blankName.status).toBe(400);
  });

  it('protects endpoints without token', async () => {
    const res = await request(app).get('/api/emergency-profiles/me');
    expect(res.status).toBe(401);
  });

  it('updates and reads the emergency profile', async () => {
    const put = await request(app).put('/api/emergency-profiles/me')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Test User', age: 30, bloodGroup: 'O+',
        allergies: 'peanuts', visibility: 'RESPONDERS', consentMedicalShare: true,
      });
    expect(put.status).toBe(200);

    const get = await request(app).get('/api/emergency-profiles/me')
      .set('Authorization', `Bearer ${token}`);
    expect(get.status).toBe(200);
    expect(get.body.profile.bloodGroup).toBe('O+');
    expect(get.body.profile.visibility).toBe('RESPONDERS');
  });

  it('persists device hardware settings', async () => {
    const initial = await request(app).get('/api/settings').set('Authorization', `Bearer ${token}`);
    expect(initial.status).toBe(200);
    expect(initial.body.settings.relayConsent).toBe(true);

    const updated = { ...initial.body.settings, relayConsent: false, criticalThresholdPct: 25 };
    const put = await request(app).put('/api/settings')
      .set('Authorization', `Bearer ${token}`)
      .send(updated);
    expect(put.status).toBe(200);

    const reread = await request(app).get('/api/settings').set('Authorization', `Bearer ${token}`);
    expect(reread.body.settings.relayConsent).toBe(false);
    expect(reread.body.settings.criticalThresholdPct).toBe(25);
  });

  it('accepts an offline check-in retry without duplicating it', async () => {
    const checkInId = '11111111-1111-4111-8111-111111111111';
    const payload = { checkInId, status: 'SAFE', note: 'queued', createdAt: new Date().toISOString() };
    const first = await request(app).post('/api/check-ins').set('Authorization', `Bearer ${token}`).send(payload);
    const second = await request(app).post('/api/check-ins').set('Authorization', `Bearer ${token}`).send(payload);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const { db } = await import('../db.js');
    const count = db.prepare('SELECT COUNT(*) AS count FROM check_ins WHERE id = ?').get(checkInId) as { count: number };
    expect(count.count).toBe(1);
  });

  it('creates an emergency with a server-signed packet (§10)', async () => {
    const res = await request(app).post('/api/emergencies')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'SOS', severity: 'CRITICAL', message: 'help',
        location: { latitude: 17.4, longitude: 78.5, accuracyMeters: 20, state: 'GPS_AVAILABLE' },
        battery: 55,
      });
    expect(res.status).toBe(201);
    const id = res.body.emergencyId as string;
    expect(id).toMatch(/^IQ-/);
    expect(res.body.clientFeedback.vibrationPatternMs).toEqual([120, 60, 180]);

    const detail = await request(app).get(`/api/emergencies/${id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.packets.length).toBe(1);
    expect(detail.body.packets[0].signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it('preserves a device-generated emergency id so it can be resolved', async () => {
    const id = 'IQ-ONLINE01';
    const created = await request(app).post('/api/emergencies')
      .set('Authorization', `Bearer ${token}`)
      .send({
        emergencyId: id, type: 'SOS', severity: 'HIGH', message: 'stable id',
        location: { latitude: 0, longitude: 0, accuracyMeters: null, state: 'LOCATION_UNAVAILABLE' },
      });
    expect(created.status).toBe(201);
    expect(created.body.emergencyId).toBe(id);

    const resolved = await request(app).post(`/api/emergencies/${id}/resolve`)
      .set('Authorization', `Bearer ${token}`);
    expect(resolved.status).toBe(200);
  });

  it('resolves an emergency and records resolution packet', async () => {
    const created = await request(app).post('/api/emergencies')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'SOS', severity: 'HIGH', message: 'test resolve',
        location: { latitude: 0, longitude: 0, accuracyMeters: null, state: 'LOCATION_UNAVAILABLE' },
      });
    const id = created.body.emergencyId as string;

    const res = await request(app).post(`/api/emergencies/${id}/resolve`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('RESOLVED');
    expect(res.body.clientFeedback).toEqual({ state: 'DISARMED', vibrationPatternMs: [60, 40, 60] });

    const again = await request(app).post(`/api/emergencies/${id}/resolve`)
      .set('Authorization', `Bearer ${token}`);
    expect(again.status).toBe(409);
  });

  it('pushes offline events idempotently (§47)', async () => {
    const body = {
      events: [{
        id: 'IQ-OFFLINE1', type: 'SOS' as const, severity: 'CRITICAL' as const, message: 'offline',
        locationState: 'LOCATION_UNAVAILABLE' as const, createdAt: new Date().toISOString(),
      }],
      packets: [{
        id: 'msg_offline-1', emergencyId: 'IQ-OFFLINE1', type: 'SOS', priority: 'CRITICAL',
        payload: JSON.stringify({ id: 'msg_offline-1' }), signature: 'f'.repeat(64),
        hopCount: 0, createdAt: new Date().toISOString(),
      }],
    };
    const first = await request(app).post('/api/sync/push').set('Authorization', `Bearer ${token}`).send(body);
    expect(first.status).toBe(200);
    expect(first.body.eventsAccepted).toBe(1);

    const second = await request(app).post('/api/sync/push').set('Authorization', `Bearer ${token}`).send(body);
    expect(second.status).toBe(200);
    expect(second.body.eventsAccepted).toBe(0); // idempotent
    expect(second.body.ackedEventIds).toContain('IQ-OFFLINE1');
  });

  it('enforces profile conflict handling via baseVersion (§47)', async () => {
    // Read current version.
    const before = await request(app).get('/api/emergency-profiles/me').set('Authorization', `Bearer ${token}`);
    expect(before.status).toBe(200);
    const v0 = before.body.profile.updatedAt;

    // Update WITH a stale baseVersion → 409 + current server version.
    const stale = await request(app).put('/api/emergency-profiles/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Stale Writer', baseVersion: '2000-01-01T00:00:00.000Z' });
    expect(stale.status).toBe(409);
    expect(stale.body.currentUpdatedAt).toBeTruthy();

    // Update WITHOUT baseVersion → explicit last-writer-wins, succeeds.
    const lww = await request(app).put('/api/emergency-profiles/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test User' });
    expect(lww.status).toBe(200);
    expect(lww.body.updatedAt).toBeTruthy();

    // Update WITH the fresh baseVersion → succeeds and returns the new version.
    const ok = await request(app).put('/api/emergency-profiles/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test User', baseVersion: lww.body.updatedAt });
    expect(ok.status).toBe(200);
    expect(ok.body.updatedAt).not.toBe(lww.body.updatedAt);
  });

  it('lists own check-ins newest-first (Home status view)', async () => {
    await request(app).post('/api/check-ins').set('Authorization', `Bearer ${token}`)
      .send({ status: 'SAFE' });
    const list = await request(app).get('/api/check-ins?limit=5').set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.checkins.length).toBeGreaterThanOrEqual(1);
    const times = list.body.checkins.map((c: { createdAt: string }) => c.createdAt);
    expect([...times].sort().reverse()).toEqual(times); // newest first
  });

  it('records a safety check-in and reports family status', async () => {
    const res = await request(app).post('/api/check-ins')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'SAFE', note: 'home safe' });
    expect(res.status).toBe(201);

    const fam = await request(app).get('/api/check-ins/family-status')
      .set('Authorization', `Bearer ${token}`);
    expect(fam.status).toBe(200);
    expect(Array.isArray(fam.body.members)).toBe(true);
  });

  it('runs the simulation engine end-to-end (§52 demo path)', async () => {
    const cfg = await request(app).post('/api/sim/engine')
      .set('Authorization', `Bearer ${token}`)
      .send({
        links: [
          { a: 'A', b: 'B' }, { a: 'B', b: 'C' }, { a: 'C', b: 'GW' },
        ],
        batteryPercent: 80,
      });
    expect(cfg.status).toBe(200);

    const inject = await request(app).post('/api/sim/inject')
      .set('Authorization', `Bearer ${token}`)
      .send({ from: 'A', emergencyId: 'IQ-SIM00001', message: 'sim SOS', priority: 'CRITICAL', battery: 70 });
    expect(inject.status).toBe(200);
    expect(inject.body.packet.signature).toMatch(/^[0-9a-f]{64}$/);

    const state = await request(app).get('/api/sim/state').set('Authorization', `Bearer ${token}`);
    expect(state.status).toBe(200);
    const gw = state.body.nodes.find((n: { id: string }) => n.id === 'GW');
    expect(gw.seenPackets).toBe(1);
    expect(state.body.stats.acked).toBeGreaterThan(0);
  });

  it('toggles Disaster Mode for the protected simulator walkthrough', async () => {
    const enabled = await request(app).post('/api/sim/disaster-mode')
      .set('Authorization', `Bearer ${token}`).send({ enabled: true });
    expect(enabled.status).toBe(200);
    expect(enabled.body.enabled).toBe(true);

    const disabled = await request(app).post('/api/sim/disaster-mode')
      .set('Authorization', `Bearer ${token}`).send({ enabled: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.enabled).toBe(false);
  });

  it('broadcasts a safe ping and stores an encrypted emergency sitrep', async () => {
    const member = await request(app).post('/api/family')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Family Node', relation: 'FRIEND', phone: '+911234567890', priority: 1, trusted: true });
    expect(member.status).toBe(201);

    const family = await request(app).get('/api/family').set('Authorization', `Bearer ${token}`);
    expect(family.status).toBe(200);
    expect(family.body.members[0]).toMatchObject({ linked: false, checkInStatus: null, lastCheckInAt: null });

    const created = await request(app).post('/api/emergencies')
      .set('Authorization', `Bearer ${token}`)
      .send({
        emergencyId: 'IQ-ACTIVE01', type: 'SOS', severity: 'CRITICAL', message: 'active test',
        location: { latitude: 0, longitude: 0, accuracyMeters: null, state: 'LOCATION_UNAVAILABLE' },
      });
    expect(created.status).toBe(201);

    const ping = await request(app).post('/api/emergencies/IQ-ACTIVE01/safe-ping')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'All safe - acknowledge when able.' });
    expect(ping.status).toBe(200);
    expect(ping.body.notifiedCount).toBe(1);

    const sitrep = await request(app).post('/api/emergencies/IQ-ACTIVE01/sitrep')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'At the east shelter entrance.' });
    expect(sitrep.status).toBe(201);
    expect(sitrep.body.encrypted).toBe(true);

    const notes = await request(app).get('/api/emergencies/IQ-ACTIVE01/sitreps')
      .set('Authorization', `Bearer ${token}`);
    expect(notes.status).toBe(200);
    expect(notes.body.sitreps[0].text).toBe('At the east shelter entrance.');
  });
});
