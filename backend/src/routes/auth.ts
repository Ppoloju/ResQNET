import { Router } from 'express';
import { randomBytes, randomUUID, randomInt } from 'node:crypto';
import { z } from 'zod';
import { hash, verify } from '@node-rs/argon2';
import jwt from 'jsonwebtoken';
import { db, tx } from '../db.js';
import { config } from '../config.js';
import { audit } from '../middleware/audit.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { logger } from '../logger.js';

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(80),
  phone: z.string().max(20).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function issueToken(userId: string, role: string, deviceId?: string): string {
  return jwt.sign({ sub: userId, role, deviceId }, config.jwtSecret, { expiresIn: '30d' });
}

/** Privacy-conscious BLE alias (§34): no personal info in advertisements. */
function newPublicId(): string {
  return `IQOO_NODE_${randomBytes(2).toString('hex').toUpperCase()}`;
}

authRouter.post('/register', authLimiter, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation failed', issues: parsed.error.issues });
    return;
  }
  const { email, password, displayName, phone } = parsed.data;

  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (exists) {
    res.status(409).json({ error: 'email already registered' });
    return;
  }

  const userId = randomUUID();
  const now = new Date().toISOString();
  const passwordHash = await hash(password); // argon2id default params

  const deviceId = randomUUID();
  const deviceSecret = randomBytes(32).toString('hex');
  const publicId = newPublicId();

  tx(() => {
    db.prepare(
      `INSERT INTO users (id, email, phone, display_name, password_hash, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'user', ?, ?)`,
    ).run(userId, email.toLowerCase(), phone ?? null, displayName, passwordHash, now, now);

    // Profile stub — onboarding collects the rest (Phase 2).
    db.prepare(
      `INSERT INTO emergency_profiles (id, user_id, name, visibility, updated_at)
       VALUES (?, ?, ?, 'PRIVATE', ?)`,
    ).run(randomUUID(), userId, displayName, now);

    db.prepare(
      `INSERT INTO devices (id, user_id, name, platform, public_id, secret, created_at)
       VALUES (?, ?, 'primary', 'web', ?, ?, ?)`,
    ).run(deviceId, userId, publicId, deviceSecret, now);
  });

  audit(userId, 'auth.register', 'user', userId);
  const token = issueToken(userId, 'user', deviceId);
  res.status(201).json({
    token,
    user: { id: userId, email, displayName, role: 'user' },
    device: { id: deviceId, publicId, secret: deviceSecret }, // secret shown once; client stores in IndexedDB
  });
});

authRouter.post('/login', authLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation failed' });
    return;
  }
  const { email, password } = parsed.data;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as
    | { id: string; password_hash: string; role: string; display_name: string }
    | undefined;

  if (!user || !(await verify(user.password_hash, password))) {
    audit(user?.id ?? 'unknown', 'auth.login.failed', 'user', user?.id);
    res.status(401).json({ error: 'invalid credentials' });
    return;
  }

  const device = db.prepare(
    'SELECT id, public_id FROM devices WHERE user_id = ? ORDER BY created_at LIMIT 1',
  ).get(user.id) as { id: string; public_id: string } | undefined;

  audit(user.id, 'auth.login', 'user', user.id);
  const token = issueToken(user.id, user.role, device?.id);
  res.json({
    token,
    user: { id: user.id, email: email.toLowerCase(), displayName: user.display_name, role: user.role },
    device: device ? { id: device.id, publicId: device.public_id } : null,
  });
});

/** Register an additional device; returns its signing secret exactly once. */
authRouter.post('/devices', requireAuth, (req: AuthedRequest, res) => {
  const schema = z.object({ name: z.string().min(1).max(40), platform: z.enum(['web', 'android', 'ios']).default('web') });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation failed' });
    return;
  }
  const userId = req.user!.userId;
  const now = new Date().toISOString();
  const deviceId = randomUUID();
  const secret = randomBytes(32).toString('hex');
  const publicId = newPublicId();

  db.prepare(
    `INSERT INTO devices (id, user_id, name, platform, public_id, secret, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(deviceId, userId, parsed.data.name, parsed.data.platform, publicId, secret, now);

  audit(userId, 'device.register', 'device', deviceId);
  logger.info({ deviceId, publicId }, 'device registered');
  res.status(201).json({ device: { id: deviceId, publicId, secret } });
});

authRouter.get('/me', requireAuth, (req: AuthedRequest, res) => {
  const user = db.prepare('SELECT id, email, display_name, role FROM users WHERE id = ?').get(req.user!.userId) as
    | { id: string; email: string; display_name: string; role: string }
    | undefined;
  if (!user) {
    res.status(404).json({ error: 'user not found' });
    return;
  }
  res.json({ user: { id: user.id, email: user.email, displayName: user.display_name, role: user.role } });
});
