// §13 Phase 13 route tests: sitreps (community bulletins) and resources
// (nearby-first disaster resource map). Covers auth, validation, and honesty
// metadata (verifiedAt/source must be present on resource points).

import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';

vi.mock('../db.js', async () => {
  const { createRequire } = await import('node:module');
  const nodeRequire = createRequire(import.meta.url);
  const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(fs.readFileSync(path.resolve(process.cwd(), '../database/schema.sql'), 'utf8'));
  return { db, tx: <T,>(fn: () => T): T => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
});

let app: import('express').Express;

beforeAll(async () => {
  ({ app } = await import('../server.js'));
});

describe('sitreps + resources (§13)', () => {
  let token = '';

  beforeAll(async () => {
    const reg = await request(app).post('/api/auth/register')
      .send({ email: `sit${Date.now()}@test.io`, password: 'Str0ngPass!x', displayName: 'Sitreps Tester' });
    token = reg.body.token;
  });

  it('bulletin reads are public (§13: public safety info); resource reads need auth', async () => {
    await request(app).get('/api/sitreps').expect(200);
    await request(app).get('/api/resources/nearby?lat=12.9&lon=77.6').expect(401);
  });

  it('rejects invalid bulletins (bad kind, oversize text)', async () => {
    await request(app).post('/api/sitreps').set('Authorization', `Bearer ${token}`)
      .send({ kind: 'NOPE', text: 'x' }).expect(400);
    await request(app).post('/api/sitreps').set('Authorization', `Bearer ${token}`)
      .send({ kind: 'HAZARD', text: 'x'.repeat(281) }).expect(400);
  });

  it('posts and lists bulletins, newest first, filterable by kind', async () => {
    await request(app).post('/api/sitreps').set('Authorization', `Bearer ${token}`)
      .send({ kind: 'HAZARD', text: 'Bridge collapsed ahead', lat: 12.9, lon: 77.6 }).expect(201);
    await request(app).post('/api/sitreps').set('Authorization', `Bearer ${token}`)
      .send({ kind: 'SHELTER', text: 'School shelter open' }).expect(201);

    const all = await request(app).get('/api/sitreps').set('Authorization', `Bearer ${token}`).expect(200);
    expect(all.body.sitreps.length).toBeGreaterThanOrEqual(2);
    expect(all.body.sitreps[0].createdAt >= all.body.sitreps[1].createdAt).toBe(true);

    const hazards = await request(app).get('/api/sitreps?kind=HAZARD').set('Authorization', `Bearer ${token}`).expect(200);
    expect(hazards.body.sitreps.every((s: { kind: string }) => s.kind === 'HAZARD')).toBe(true);
    const posted = hazards.body.sitreps.find((s: { text: string }) => s.text === 'Bridge collapsed ahead');
    expect(posted.lat).toBe(12.9);
  });

  it('serves nearby resources ranked with verifiedAt and source (honest scope)', async () => {
    const res = await request(app).get('/api/resources/nearby?lat=12.97&lon=77.59')
      .set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.resources.length).toBeGreaterThan(0);
    for (const r of res.body.resources) {
      expect(r.verifiedAt).toBeTruthy();
      expect(r.source).toBeTruthy();
      expect(typeof r.distanceM).toBe('number');
    }
    expect(res.body.note).toContain('verify');
  });
});
