// Offline sync E2E (§47): push is idempotent (replays never duplicate),
// pull returns new packets with a working cursor, ack marks delivery.

import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import { signPacket } from '@iqoo/shared';

vi.mock('../db.js', async () => {
  const { createRequire } = await import('node:module');
  const nodeRequire = createRequire(import.meta.url);
  const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');
  const fs = (await import('node:fs'));
  const path = (await import('node:path'));
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(fs.readFileSync(path.resolve(process.cwd(), '../database/schema.sql'), 'utf8'));
  return { db, tx: <T,>(fn: () => T): T => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
});

let app: import('express').Express;

beforeAll(async () => {
  ({ app } = await import('../server.js'));
});

describe('offline sync (§47 idempotency + pull)', () => {
  let token = '';
  let deviceId = '';

  beforeAll(async () => {
    const reg = await request(app).post('/api/auth/register')
      .send({ email: `sync${Date.now()}@test.io`, password: 'Str0ngPass!x', displayName: 'Sync Tester' });
    token = reg.body.token;
    deviceId = reg.body.device.id;
  });

  const offlineEvent = {
    id: 'IQ-OFFLINE01',
    type: 'SOS',
    severity: 'CRITICAL',
    message: 'created while offline',
    locationState: 'LOCATION_UNAVAILABLE',
    battery: 15,
    createdAt: new Date().toISOString(),
  };

  it('accepts an offline-created emergency via /sync/push', async () => {
    const packet = await signPacket({
      id: 'msg_offline_0001', emergencyId: 'IQ-OFFLINE01', senderId: deviceId,
      senderPublicId: 'IQOO_NODE_TEST', type: 'SOS' as const, priority: 'CRITICAL' as const,
      timestamp: Date.now(), location: { latitude: 0, longitude: 0, accuracyMeters: null, state: 'LOCATION_UNAVAILABLE' as const },
      battery: 15, message: 'created while offline', hopCount: 0, ttl: 3600,
      requiresMedicalHelp: true, requiresPoliceHelp: false,
    }, 'device-secret');

    const res = await request(app).post('/api/sync/push')
      .set('Authorization', `Bearer ${token}`)
      .send({
        events: [offlineEvent],
        packets: [{
          id: packet.id, emergencyId: packet.emergencyId, type: packet.type,
          priority: packet.priority, payload: JSON.stringify(packet),
          signature: packet.signature, hopCount: 0, createdAt: new Date().toISOString(),
        }],
      });
    expect(res.status).toBe(200);
    expect(res.body.eventsAccepted).toBe(1);
    expect(res.body.ackedEventIds).toContain('IQ-OFFLINE01');
  });

  it('replaying the same event does NOT duplicate it (idempotency)', async () => {
    const res = await request(app).post('/api/sync/push')
      .set('Authorization', `Bearer ${token}`)
      .send({ events: [offlineEvent], packets: [] });
    expect(res.status).toBe(200);
    expect(res.body.eventsAccepted).toBe(0); // already stored
    expect(res.body.ackedEventIds).toContain('IQ-OFFLINE01'); // still acked so client clears outbox

    const list = await request(app).get('/api/emergencies').set('Authorization', `Bearer ${token}`);
    const matches = (list.body.emergencies as Array<{ id: string }>).filter((e) => e.id === 'IQ-OFFLINE01');
    expect(matches.length).toBe(1); // exactly one row, ever
  });

  it('pull returns the synced packet with cursor pagination', async () => {
    const first = await request(app).get('/api/sync/pull?limit=1')
      .set('Authorization', `Bearer ${token}`);
    expect(first.status).toBe(200);
    expect(first.body.packets.length).toBe(1);
    expect(first.body.packets[0].emergencyId).toBe('IQ-OFFLINE01');
    expect(first.body.hasMore).toBe(false);
    expect(first.body.nextCursor).toBeTruthy();

    // Pull again from the same cursor: nothing new (cursor advances correctly).
    const again = await request(app).get(`/api/sync/pull?cursor=${encodeURIComponent(first.body.nextCursor)}`)
      .set('Authorization', `Bearer ${token}`);
    expect(again.body.packets.length).toBe(0);
  });

  it('ack marks packets as delivered', async () => {
    const pull = await request(app).get('/api/sync/pull').set('Authorization', `Bearer ${token}`);
    const ids = (pull.body.packets as Array<{ id: string }>).map((p) => p.id);
    const res = await request(app).post('/api/sync/ack')
      .set('Authorization', `Bearer ${token}`)
      .send({ packetIds: ids });
    expect(res.status).toBe(200);
    expect(res.body.acked).toBe(ids.length);
  });

  it('does not expose another user\'s packets through pull', async () => {
    const other = await request(app).post('/api/auth/register')
      .send({ email: `sync-other${Date.now()}@test.io`, password: 'Str0ngPass!x', displayName: 'Other' });
    const created = await request(app).post('/api/emergencies')
      .set('Authorization', `Bearer ${other.body.token}`)
      .send({
        emergencyId: 'IQ-PRIVATE1', type: 'SOS', severity: 'HIGH', message: 'private',
        location: { latitude: 0, longitude: 0, accuracyMeters: null, state: 'LOCATION_UNAVAILABLE' },
      });
    expect(created.status).toBe(201);

    const pulled = await request(app).get('/api/sync/pull').set('Authorization', `Bearer ${token}`);
    expect((pulled.body.packets as Array<{ emergencyId: string }>).some((p) => p.emergencyId === 'IQ-PRIVATE1')).toBe(false);
  });

  it('rejects push with malformed event ids', async () => {
    const res = await request(app).post('/api/sync/push')
      .set('Authorization', `Bearer ${token}`)
      .send({ events: [{ ...offlineEvent, id: 'BAD_ID' }], packets: [] });
    expect(res.status).toBe(400);
  });
});
