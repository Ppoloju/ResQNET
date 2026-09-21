import { describe, it, expect, beforeAll, vi } from 'vitest';
import { hash } from '@node-rs/argon2';

vi.mock('./db.js', async () => {
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

describe('team account seed', () => {
  beforeAll(async () => {
    const { db } = await import('./db.js');
    const now = new Date().toISOString();
    const oldHash = await hash('OldPass!old1');
    db.prepare(
      `INSERT INTO users (id, email, phone, display_name, password_hash, role, email_verified, two_factor_enabled, created_at, updated_at)
       VALUES ('u-old', 'vinturi@student.gitam.edu', '+919000000099', 'Wrong Name', ?, 'user', 0, 1, ?, ?)`,
    ).run(oldHash, now, now);
    const { seedTeamAccounts } = await import('./seedTeam.js');
    await seedTeamAccounts();
  }, 30_000);

  it('creates GITAM team accounts and overwrites any other password', async () => {
    const { db } = await import('./db.js');
    const { verify } = await import('@node-rs/argon2');
    const { TEAM_PASSWORD } = await import('./seedTeam.js');
    const rows = db.prepare(
      `SELECT email, display_name, phone, role, email_verified, password_hash FROM users
       WHERE email LIKE '%@student.gitam.edu' ORDER BY email`,
    ).all() as Array<{ email: string; display_name: string; phone: string; role: string; email_verified: number; password_hash: string }>;
    expect(rows.map((row) => row.email)).toEqual([
      'ppoloju@student.gitam.edu',
      'speesa@student.gitam.edu',
      'vinturi@student.gitam.edu',
    ]);
    expect(rows.find((row) => row.email.startsWith('vinturi'))?.display_name).toBe('Inturi Vaishnavi');
    expect(rows.find((row) => row.email.startsWith('ppoloju'))?.display_name).toBe('Poloju Pravalika');
    for (const row of rows) {
      expect(row.role).toBe('admin');
      expect(row.email_verified).toBe(1);
      expect(await verify(row.password_hash, TEAM_PASSWORD)).toBe(true);
      expect(await verify(row.password_hash, 'OldPass!old1')).toBe(false);
    }
  });
});
