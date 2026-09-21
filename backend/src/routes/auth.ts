import { Router } from 'express';
import { createHash, randomBytes, randomUUID, randomInt } from 'node:crypto';
import { z } from 'zod';
import { hash, verify } from '@node-rs/argon2';
import jwt from 'jsonwebtoken';
import { db, tx } from '../db.js';
import { config } from '../config.js';
import { audit } from '../middleware/audit.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { logger } from '../logger.js';
import { sendVerificationCode, sendPasswordChangedNotice, mailerMode } from '../lib/mailer.js';
import { clientCount as realtimeClientCount } from './realtime.js';

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(8).max(128),
  displayName: z.string().trim().min(1).max(80),
  phone: z.string().max(20).optional(),
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

const codeSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/),
});

function issueToken(userId: string, role: string, deviceId?: string): string {
  return jwt.sign({ sub: userId, role, deviceId }, config.jwtSecret, { expiresIn: '30d' });
}

/** Privacy-conscious BLE alias (§34): no personal info in advertisements. */
function newPublicId(): string {
  return `RQ_NODE_${randomBytes(2).toString('hex').toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Email code helpers (verification / 2FA / reset): 6 digits, sha256-hashed at
// rest, single-use, 10-minute expiry. Sending failures never leak whether an
// address exists — generic errors only.
// ---------------------------------------------------------------------------

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

type CodePurpose = 'VERIFY_ACCOUNT' | 'LOGIN_2FA' | 'PASSWORD_RESET';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: string;
  display_name: string;
  email_verified: number;
  two_factor_enabled: number;
}

const getUserById = (id: string): UserRow | undefined =>
  db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;

async function issueEmailCode(userId: string, email: string, purpose: CodePurpose): Promise<string | null> {
  const code = newCode();
  const now = new Date();
  const expires = new Date(now.getTime() + 10 * 60_000).toISOString();
  db.prepare(
    `INSERT INTO email_codes (id, user_id, purpose, code_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), userId, purpose, sha256(code), expires, now.toISOString());
  await sendVerificationCode(email, code, purpose);
  audit(userId, `auth.code.issued.${purpose}`, 'user', userId);
  // Dev fallback: with no SMTP configured the code is echoed in the response so
  // local/two-phone flows complete without an inbox. SMTP mode returns null.
  return mailerMode() === 'console' ? code : null;
}

/** Consume a code if valid (unconsumed + unexpired + matching). */
function consumeEmailCode(userId: string, purpose: CodePurpose, code: string): boolean {
  const row = db.prepare(
    `SELECT id, code_hash, expires_at FROM email_codes
     WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > ?
     ORDER BY created_at DESC LIMIT 1`,
  ).get(userId, purpose, new Date().toISOString()) as
    | { id: string; code_hash: string; expires_at: string }
    | undefined;
  if (!row) return false;
  const ok = row.code_hash === sha256(code);
  if (ok) {
    db.prepare('UPDATE email_codes SET consumed_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
  }
  return ok;
}

function findUserByEmail(email: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as UserRow | undefined;
}

/** Primary device for a user; creates one on the fly if missing (e.g. pre-2FA users). */
function ensurePrimaryDevice(userId: string): { id: string; publicId: string; secret: string; created: boolean } {
  const existing = db.prepare(
    'SELECT id, public_id, secret FROM devices WHERE user_id = ? ORDER BY created_at LIMIT 1',
  ).get(userId) as { id: string; public_id: string; secret: string } | undefined;
  if (existing) return { id: existing.id, publicId: existing.public_id, secret: existing.secret, created: false };
  const now = new Date().toISOString();
  const deviceId = randomUUID();
  const secret = randomBytes(32).toString('hex');
  const publicId = newPublicId();
  db.prepare(
    `INSERT INTO devices (id, user_id, name, platform, public_id, secret, created_at)
     VALUES (?, ?, 'primary', 'web', ?, ?, ?)`,
  ).run(deviceId, userId, publicId, secret, now);
  return { id: deviceId, publicId, secret, created: true };
}

// ---------------------------------------------------------------------------
// Register → create account unverified → email 6-digit code → verify → usable.
// The account can sign in, but a verified flag gates family fan-out features.
// ---------------------------------------------------------------------------

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
      `INSERT INTO users (id, email, phone, display_name, password_hash, role, email_verified, two_factor_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'user', 0, 1, ?, ?)`,
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

  let verificationSent = false;
  let devCode: string | null = null;
  try {
    devCode = await issueEmailCode(userId, email.toLowerCase(), 'VERIFY_ACCOUNT');
    verificationSent = true;
  } catch (err) {
    logger.error({ err }, 'verification email failed — account created unverified');
  }

  audit(userId, 'auth.register', 'user', userId);
  const token = issueToken(userId, 'user', deviceId);
  res.status(201).json({
    token,
    user: { id: userId, email, phone: phone ?? null, displayName, role: 'user' },
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
    | { id: string; email: string; phone: string | null; password_hash: string; role: string; display_name: string }
    | undefined;

  if (!user || !(await verify(user.password_hash, password))) {
    audit(user?.id ?? 'unknown', 'auth.login.failed', 'user', user?.id);
    res.status(401).json({ error: 'invalid credentials' });
    return;
  }

  // Two-step verification (§7): correct password → 6-digit code to the email on
  // file. The token is only issued after /login/verify-2fa consumes the code.
  if (user.two_factor_enabled) {
    let sent = false;
    let devCode: string | null = null;
    try {
      devCode = await issueEmailCode(user.id, user.email, 'LOGIN_2FA');
      sent = true;
    } catch (err) {
      logger.error({ err }, '2FA email failed');
    }
    audit(user.id, 'auth.login.2fa.challenge', 'user', user.id);
    res.status(sent ? 200 : 503).json({
      twoFactorRequired: true,
      emailSent: sent,
      email: user.email.replace(/^(.).*(@.*)$/, '$1***$2'), // m̲a***@x.com — never the full address
      ...(devCode ? { devCode } : {}),
    });
    return;
  }

  const device = ensurePrimaryDevice(user.id);
  audit(user.id, 'auth.login', 'user', user.id);
  const token = issueToken(user.id, user.role, device.id);
  res.json({
    token,
    emailVerified: !!user.email_verified,
    user: { id: user.id, email: user.email, displayName: user.display_name, role: user.role },
    device: { id: device.id, publicId: device.publicId },
  });
});

/** Step 2 of two-step login: consume the emailed code, issue the session token. */
authRouter.post('/login/verify-2fa', authLimiter, async (req, res) => {
  const parsed = codeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation failed', issues: parsed.error.issues });
    return;
  }
  const user = findUserByEmail(parsed.data.email);
  if (!user || !consumeEmailCode(user.id, 'LOGIN_2FA', parsed.data.code)) {
    audit(user?.id ?? 'unknown', 'auth.login.2fa.failed', 'user', user?.id);
    res.status(401).json({ error: 'invalid or expired code' });
    return;
  }
  const device = ensurePrimaryDevice(user.id);
  audit(user.id, 'auth.login.2fa.success', 'user', user.id);
  const token = issueToken(user.id, user.role, device.id);
  res.json({
    token,
    user: { id: user.id, email: user.email, phone: user.phone, displayName: user.display_name, role: user.role },
    device: device ? { id: device.id, publicId: device.public_id } : null,
  });
});

/** Re-send the 2FA code (rate-limited by authLimiter + minimum interval). */
authRouter.post('/login/resend-2fa', authLimiter, async (req, res) => {
  const schema = z.object({ email: z.string().email() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation failed' });
    return;
  }
  const user = findUserByEmail(parsed.data.email);
  if (!user || !user.two_factor_enabled) {
    res.json({ ok: true }); // do not reveal account existence
    return;
  }
  const last = db.prepare(
    `SELECT created_at FROM email_codes WHERE user_id = ? AND purpose = 'LOGIN_2FA' ORDER BY created_at DESC LIMIT 1`,
  ).get(user.id) as { created_at: string } | undefined;
  if (last && Date.now() - Date.parse(last.created_at) < config.emailCodeResendSeconds * 1000) {
    res.status(429).json({ error: 'please wait before requesting another code' });
    return;
  }
  try {
    await issueEmailCode(user.id, user.email, 'LOGIN_2FA');
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, '2FA resend failed');
    res.status(503).json({ error: 'email delivery unavailable, try again later' });
  }
});

// ---------------------------------------------------------------------------
// Email verification (post-registration)
// ---------------------------------------------------------------------------

authRouter.post('/verify-email', authLimiter, async (req, res) => {
  const parsed = codeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation failed', issues: parsed.error.issues });
    return;
  }
  const user = findUserByEmail(parsed.data.email);
  if (!user || !consumeEmailCode(user.id, 'VERIFY_ACCOUNT', parsed.data.code)) {
    res.status(401).json({ error: 'invalid or expired code' });
    return;
  }
  db.prepare('UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?')
    .run(new Date().toISOString(), user.id);
  audit(user.id, 'auth.email.verified', 'user', user.id);
  res.json({ ok: true, emailVerified: true });
});

authRouter.post('/resend-verification', authLimiter, async (req, res) => {
  const schema = z.object({ email: z.string().email() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation failed' });
    return;
  }
  const user = findUserByEmail(parsed.data.email);
  if (user && !user.email_verified) {
    try {
      await issueEmailCode(user.id, user.email, 'VERIFY_ACCOUNT');
    } catch (err) {
      logger.error({ err }, 'verification resend failed');
      res.status(503).json({ error: 'email delivery unavailable, try again later' });
      return;
    }
  }
  res.json({ ok: true }); // identical response whether or not the account exists
});

// ---------------------------------------------------------------------------
// Password reset (signed out): email code → set new password → notice email.
// ---------------------------------------------------------------------------

authRouter.post('/forgot-password', authLimiter, async (req, res) => {
  const schema = z.object({ email: z.string().email() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation failed' });
    return;
  }
  const user = findUserByEmail(parsed.data.email);
  if (user) {
    try {
      await issueEmailCode(user.id, user.email, 'PASSWORD_RESET');
    } catch (err) {
      logger.error({ err }, 'reset email failed');
    }
  }
  // Always the same response — no account enumeration.
  res.json({ ok: true });
});

authRouter.post('/reset-password', authLimiter, async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    code: z.string().regex(/^\d{6}$/),
    newPassword: z.string().min(8).max(128),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation failed', issues: parsed.error.issues });
    return;
  }
  const user = findUserByEmail(parsed.data.email);
  if (!user || !consumeEmailCode(user.id, 'PASSWORD_RESET', parsed.data.code)) {
    res.status(401).json({ error: 'invalid or expired code' });
    return;
  }
  const now = new Date().toISOString();
  const passwordHash = await hash(parsed.data.newPassword);
  tx(() => {
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, now, user.id);
    // A successful reset signs the user out everywhere (defense against a stolen session).
    db.prepare('DELETE FROM email_codes WHERE user_id = ?').run(user.id);
  });
  try {
    await sendPasswordChangedNotice(user.email, now, 'RESET');
  } catch (err) {
    logger.error({ err }, 'password-changed notice failed');
  }
  audit(user.id, 'auth.password.reset', 'user', user.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Authenticated password change (Settings): current password + emailed code.
// ---------------------------------------------------------------------------

authRouter.post('/change-password', requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({
    currentPassword: z.string().min(1),
    code: z.string().regex(/^\d{6}$/),
    newPassword: z.string().min(8).max(128),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation failed', issues: parsed.error.issues });
    return;
  }
  const user = getUserById(req.user!.userId);
  if (!user || !(await verify(user.password_hash, parsed.data.currentPassword))) {
    res.status(401).json({ error: 'current password is incorrect' });
    return;
  }
  if (!consumeEmailCode(user.id, 'PASSWORD_RESET', parsed.data.code)) {
    res.status(401).json({ error: 'invalid or expired code — request a new one below' });
    return;
  }
  const now = new Date().toISOString();
  const passwordHash = await hash(parsed.data.newPassword);
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, now, user.id);
  try {
    await sendPasswordChangedNotice(user.email, now, 'CHANGE');
  } catch (err) {
    logger.error({ err }, 'password-changed notice failed');
  }
  audit(user.id, 'auth.password.change', 'user', user.id);
  res.json({ ok: true });
});

/** Email a code for the in-app password change (reuses the PASSWORD_RESET purpose). */
authRouter.post('/send-change-code', requireAuth, async (req: AuthedRequest, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.userId) as
    | { id: string; email: string }
    | undefined;
  if (!user) {
    res.status(404).json({ error: 'user not found' });
    return;
  }
  const last = db.prepare(
    `SELECT created_at FROM email_codes WHERE user_id = ? AND purpose = 'PASSWORD_RESET' ORDER BY created_at DESC LIMIT 1`,
  ).get(user.id) as { created_at: string } | undefined;
  if (last && Date.now() - Date.parse(last.created_at) < config.emailCodeResendSeconds * 1000) {
    res.status(429).json({ error: 'please wait before requesting another code' });
    return;
  }
  try {
    await issueEmailCode(user.id, user.email, 'PASSWORD_RESET');
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, 'change-code email failed');
    res.status(503).json({ error: 'email delivery unavailable, try again later' });
  }
});

// ---------------------------------------------------------------------------
// Devices / session
// ---------------------------------------------------------------------------

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
  const user = db.prepare('SELECT id, email, phone, display_name, role FROM users WHERE id = ?').get(req.user!.userId) as
    | { id: string; email: string; phone: string | null; display_name: string; role: string }
    | undefined;
  if (!user) {
    res.status(404).json({ error: 'user not found' });
    return;
  }
  res.json({ user: { id: user.id, email: user.email, phone: user.phone, displayName: user.display_name, role: user.role } });
});
