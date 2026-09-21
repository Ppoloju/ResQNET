// Team demo accounts. Forced on every boot so GITAM@2028 is the only password
// that works for these three emails (any older hash is overwritten).

import { randomBytes, randomUUID } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { db, tx } from './db.js';
import { logger } from './logger.js';
import { canonicalPhone } from './lib/phone.js';

export const TEAM_PASSWORD = 'Gitam@2028';

export const TEAM_ACCOUNTS = [
  {
    email: 'ppoloju@student.gitam.edu',
    displayName: 'Poloju Pravalika',
    phoneEnv: 'TEAM_PHONE_PPOLOJU',
    defaultPhone: '+919000000001',
    role: 'admin' as const,
  },
  {
    email: 'vinturi@student.gitam.edu',
    displayName: 'Inturi Vaishnavi',
    phoneEnv: 'TEAM_PHONE_VINTURI',
    defaultPhone: '+919000000002',
    role: 'admin' as const,
  },
  {
    email: 'speesa@student.gitam.edu',
    displayName: 'Peesa Satvika',
    phoneEnv: 'TEAM_PHONE_SPEESA',
    defaultPhone: '+919000000003',
    role: 'admin' as const,
  },
];

function newPublicId(): string {
  return `RQ_NODE_${randomBytes(2).toString('hex').toUpperCase()}`;
}

export async function seedTeamAccounts(): Promise<void> {
  const now = new Date().toISOString();
  const passwordHash = await hash(TEAM_PASSWORD);

  for (const account of TEAM_ACCOUNTS) {
    const phone = canonicalPhone(process.env[account.phoneEnv] || account.defaultPhone);
    const existing = db.prepare('SELECT id, password_hash, phone FROM users WHERE email = ?')
      .get(account.email) as { id: string; password_hash: string; phone: string | null } | undefined;

    if (existing) {
      const passwordOk = await verify(existing.password_hash, TEAM_PASSWORD).catch(() => false);
      const nextHash = passwordOk ? existing.password_hash : passwordHash;
      const phoneTaken = phone
        ? db.prepare('SELECT id FROM users WHERE phone = ? AND id != ?').get(phone, existing.id)
        : undefined;
      tx(() => {
        db.prepare(
          `UPDATE users SET display_name = ?, role = ?, email_verified = 1, two_factor_enabled = 1,
            password_hash = ?, phone = ?, updated_at = ? WHERE id = ?`,
        ).run(account.displayName, account.role, nextHash, phoneTaken ? existing.phone : phone, now, existing.id);
        const profile = db.prepare('SELECT id FROM emergency_profiles WHERE user_id = ?').get(existing.id);
        if (!profile) {
          db.prepare(
            `INSERT INTO emergency_profiles (id, user_id, name, visibility, updated_at)
             VALUES (?, ?, ?, 'PRIVATE', ?)`,
          ).run(randomUUID(), existing.id, account.displayName, now);
        } else {
          db.prepare('UPDATE emergency_profiles SET name = ? WHERE user_id = ?').run(account.displayName, existing.id);
        }
      });
      if (!passwordOk) logger.info({ email: account.email }, 'team account password reset to Gitam@2028');
      continue;
    }

    const phoneTaken = phone
      ? db.prepare('SELECT id FROM users WHERE phone = ?').get(phone)
      : undefined;
    const userId = randomUUID();
    const deviceId = randomUUID();
    tx(() => {
      db.prepare(
        `INSERT INTO users (id, email, phone, display_name, password_hash, role, email_verified, two_factor_enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
      ).run(userId, account.email, phoneTaken ? null : phone, account.displayName, passwordHash, account.role, now, now);
      db.prepare(
        `INSERT INTO emergency_profiles (id, user_id, name, visibility, updated_at)
         VALUES (?, ?, ?, 'PRIVATE', ?)`,
      ).run(randomUUID(), userId, account.displayName, now);
      db.prepare(
        `INSERT INTO devices (id, user_id, name, platform, public_id, secret, created_at)
         VALUES (?, ?, 'primary', 'web', ?, ?, ?)`,
      ).run(deviceId, userId, newPublicId(), randomBytes(32).toString('hex'), now);
    });
    logger.info({ email: account.email, phone: phoneTaken ? null : phone }, 'team account seeded');
  }
}
