import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import { AI_DISCLAIMER } from '@iqoo/shared';

vi.mock('../db.js', async () => {
  const { createRequire } = await import('node:module');
  const nodeRequire = createRequire(import.meta.url);
  const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(fs.readFileSync(path.resolve(process.cwd(), '../database/schema.sql'), 'utf8'));
  return {
    db,
    tx: <T,>(fn: () => T): T => {
      db.exec('BEGIN');
      try { const result = fn(); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
});

let app: import('express').Express;
let token = '';

beforeAll(async () => {
  ({ app } = await import('../server.js'));
  const registration = await request(app).post('/api/auth/register').send({
    email: `ai-${Date.now()}@test.io`,
    password: 'Str0ngPass!x',
    displayName: 'AI Tester',
  });
  token = registration.body.token;
}, 30_000);

describe('AI assistance endpoint', () => {
  it('requires authentication', async () => {
    const response = await request(app)
      .post('/api/ai/classify')
      .send({ text: 'There is a fire and heavy smoke' });

    expect(response.status).toBe(401);
  });

  it('classifies an emergency and returns advisory metadata', async () => {
    const response = await request(app)
      .post('/api/ai/classify')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'There is a fire and heavy smoke', battery: 12 });

    expect(response.status).toBe(200);
    expect(response.body.result).toMatchObject({
      category: 'FIRE',
      severity: 'HIGH',
      engine: 'iqoo-rules-v1',
    });
    expect(response.body.result.matched).toContain('fire');
    expect(response.body.disclaimer).toBe(AI_DISCLAIMER);
    expect(response.body.local).toBe(true);
  });

  it('applies the immobility override through the backend contract', async () => {
    const response = await request(app)
      .post('/api/ai/classify')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'I feel dizzy', saysImmobile: true });

    expect(response.status).toBe(200);
    expect(response.body.result).toMatchObject({ category: 'MEDICAL', severity: 'CRITICAL' });
    expect(response.body.result.matched).toContain('immobility-flag');
  });

  it('rejects invalid request fields before classification', async () => {
    const response = await request(app)
      .post('/api/ai/classify')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'x'.repeat(501), battery: 101 });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('validation failed');
    expect(response.body.issues.length).toBeGreaterThanOrEqual(2);
  });

  it('routes Quick Help choices through the shared triage contract', async () => {
    const choices = [
      ['I am lost and need directions', 'OFFLINE_MAP'],
      ['I have severe bleeding and cannot move', 'SOS'],
      ['I need assistance carrying my bag', 'CHAT'],
    ] as const;

    for (const [text, action] of choices) {
      const response = await request(app)
        .post('/api/ai/triage')
        .set('Authorization', `Bearer ${token}`)
        .send({ text });
      expect(response.status).toBe(200);
      expect(response.body.triage.action).toBe(action);
      expect(response.body.triage.engine).toBe('iqoo-rules-v1');
    }
  });
});