import { Router } from 'express';
import { createHash, randomBytes, randomUUID, randomInt } from 'node:crypto';
import { z } from 'zod';
import { Algorithm, hash, verify } from '@node-rs/argon2';
import jwt from 'jsonwebtoken';
import { db, tx } from '../db.js';
import { config } from '../config.js';
import { audit } from '../middleware/audit.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { logger } from '../logger.js';
import { sendVerificationCode, sendPasswordChangedNotice, mailerMode } from '../lib/mailer.js';
import { sendOtpSms, smsMode, smsProvider } from '../lib/sms.js';
import { canonicalPhone, looksLikeEmail, maskEmail, maskPhone, phoneTail } from '../lib/phone.js';

export const authRouter = Router();

const PASSWORD_HASH_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
} as const;

authRouter.get('/channels', (_req, res) => {
  res.json({
    email: mailerMode(),
    sms: smsProvider(),
    emailReady: mailerMode() === 'smtp',
    smsReady: smsMode() === 'live',
  });
});

const phoneSchema = z.string().trim().min(10).max(20).refine((value) => canonicalPhone(value) !== null, 'invalid phone');

const registerSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(8).max(128),
  displayName: z.string().trim().min(1).max(80),
  phone: phoneSchema,
});

const loginSchema = z.object({
  identifier: z.string().trim().min(3).max(200).optional(),
  email: z.string().trim().optional(),
  password: z.string().min(1),
}).refine((value) => !!(value.identifier || value.email), { message: 'identifier required' });

const codeSchema = z.object({
  identifier: z.string().trim().min(3).max(200).optional(),
  email: z.string().trim().optional(),
  code: z.string().regex(/^\d{6}$/),
}).refine((value) => !!(value.identifier || value.email), { message: 'identifier required' });

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
  phone: string | null;
  password_hash: string;
  role: string;
  display_name: string;
  email_verified: number;
  two_factor_enabled: number;
}

const getUserById = (id: string): UserRow | undefined =>
  db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;

async function issueOtp(user: { id: string; email: string; phone: string | null }, purpose: CodePurpose): Promise<{
  code: string | null;
  emailSent: boolean;
  smsSent: boolean;
}> {
  const code = newCode();
  const now = new Date();
  const expires = new Date(now.getTime() + 10 * 60_000).toISOString();
  db.prepare(
    `INSERT INTO email_codes (id, user_id, purpose, code_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), user.id, purpose, sha256(code), expires, now.toISOString());

  let emailSent = false;
  let smsSent = false;
  try {
    await sendVerificationCode(user.email, code, purpose);
    emailSent = true;
  } catch (err) {
    logger.error({ err }, 'otp email failed');
  }
  if (user.phone) {
    try {
      await sendOtpSms(user.phone, code, purpose);
      smsSent = true;
    } catch (err) {
      logger.error({ err }, 'otp sms failed');
    }
  }
  audit(user.id, `auth.code.issued.${purpose}`, 'user', user.id);
  const echo = mailerMode() === 'console' || smsMode() === 'console';
  return { code: echo ? code : null, emailSent, smsSent };
}

function otpPayload(sent: { code: string | null; emailSent: boolean; smsSent: boolean }, user: UserRow) {
  return {
    emailSent: sent.emailSent,
    smsSent: sent.smsSent,
    email: maskEmail(user.email),
    phone: user.phone ? maskPhone(user.phone) : null,
    ...(sent.code ? { devCode: sent.code } : {}),
  };
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

function findUserByIdentifier(raw: string): UserRow | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  if (looksLikeEmail(value)) return findUserByEmail(value);
  const phone = canonicalPhone(value);
  if (phone) {
    const exact = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone) as UserRow | undefined;
    if (exact) return exact;
  }
  const tail = phoneTail(value);
  if (tail.length < 10) return undefined;
  return db.prepare(
    `SELECT * FROM users WHERE phone IS NOT NULL AND substr(replace(phone, '+', ''), -10) = ?`,
  ).get(tail) as UserRow | undefined;
}

function loginKey(body: { identifier?: string; email?: string }): string {
  return (body.identifier ?? body.email ?? '').trim();
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
  const { email, password, displayName } = parsed.data;
  const phone = canonicalPhone(parsed.data.phone)!;

  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (exists) {
    res.status(409).json({ error: 'email already registered' });
    return;
  }
  const phoneTaken = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
  if (phoneTaken) {
    res.status(409).json({ error: 'phone already registered' });
    return;
  }

  const userId = randomUUID();
  const now = new Date().toISOString();
  const passwordHash = await hash(password, PASSWORD_HASH_OPTIONS);

  const deviceId = randomUUID();
  const deviceSecret = randomBytes(32).toString('hex');
  const publicId = newPublicId();

  tx(() => {
    db.prepare(
      `INSERT INTO users (id, email, phone, display_name, password_hash, role, email_verified, two_factor_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'user', 0, 1, ?, ?)`,
    ).run(userId, email.toLowerCase(), phone, displayName, passwordHash, now, now);

    db.prepare(
      `INSERT INTO emergency_profiles (id, user_id, name, visibility, updated_at)
       VALUES (?, ?, ?, 'PRIVATE', ?)`,
    ).run(randomUUID(), userId, displayName, now);

    db.prepare(
      `INSERT INTO devices (id, user_id, name, platform, public_id, secret, created_at)
       VALUES (?, ?, 'primary', 'web', ?, ?, ?)`,
    ).run(deviceId, userId, publicId, deviceSecret, now);
  });

  const otp = await issueOtp({ id: userId, email: email.toLowerCase(), phone }, 'VERIFY_ACCOUNT');
  audit(userId, 'auth.register', 'user', userId);
  const token = issueToken(userId, 'user', deviceId);
  res.status(201).json({
    token,
    user: { id: userId, email: email.toLowerCase(), phone, displayName, role: 'user' },
    device: { id: deviceId, publicId, secret: deviceSecret },
    ...otpPayload(otp, { id: userId, email: email.toLowerCase(), phone, password_hash: '', role: 'user', display_name: displayName, email_verified: 0, two_factor_enabled: 1 }),
  });
});

authRouter.post('/login', authLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation failed' });
    return;
  }
  const { password } = parsed.data;
  const user = findUserByIdentifier(loginKey(parsed.data));

  if (!user || !(await verify(user.password_hash, password))) {
    audit(user?.id ?? 'unknown', 'auth.login.failed', 'user', user?.id);
    res.status(401).json({ error: 'invalid credentials' });
    return;
  }

  if (user.two_factor_enabled) {
    const otp = await issueOtp(user, 'LOGIN_2FA');
    const delivered = otp.emailSent || otp.smsSent;
    audit(user.id, 'auth.login.2fa.challenge', 'user', user.id);
    res.status(delivered ? 200 : 503).json({
      twoFactorRequired: true,
      ...otpPayload(otp, user),
    });
    return;
  }

  const device = ensurePrimaryDevice(user.id);
  audit(user.id, 'auth.login', 'user', user.id);
  const token = issueToken(user.id, user.role, device.id);
  res.json({
    token,
    emailVerified: !!user.email_verified,
    user: { id: user.id, email: user.email, phone: user.phone, displayName: user.display_name, role: user.role },
    device: { id: device.id, publicId: device.publicId },
  });
});

authRouter.post('/login/verify-2fa', authLimiter, async (req, res) => {
  const parsed = codeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation failed', issues: parsed.error.issues });
    return;
  }
  const user = findUserByIdentifier(loginKey(parsed.data));
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
    user: { id: user.id, email: user.email, phone: user.phone, displayName: user.display_name, role: user.role, emailVerified: !!user.email_verified },
    device: { id: device.id, publicId: device.publicId },
  });
});

authRouter.post('/login/resend-2fa', authLimiter, async (req, res) => {
  const schema = z.object({
    identifier: z.string().trim().min(3).optional(),
    email: z.string().trim().optional(),
  }).refine((value) => !!(value.identifier || value.email), { message: 'identifier required' });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation failed' });
    return;
  }
  const user = findUserByIdentifier(loginKey(parsed.data));
  if (!user || !user.two_factor_enabled) {
    res.json({ ok: true });
    return;
  }
  const last = db.prepare(
    `SELECT created_at FROM email_codes WHERE user_id = ? AND purpose = 'LOGIN_2FA' ORDER BY created_at DESC LIMIT 1`,
  ).get(user.id) as { created_at: string } | undefined;
  if (last && Date.now() - Date.parse(last.created_at) < config.emailCodeResendSeconds * 1000) {
    res.status(429).json({ error: 'please wait before requesting another code' });
    return;
  }
  const otp = await issueOtp(user, 'LOGIN_2FA');
  if (!otp.emailSent && !otp.smsSent) {
    res.status(503).json({ error: 'code delivery unavailable, try again later' });
    return;
  }
  res.json({ ok: true, ...otpPayload(otp, user) });
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
  const user = findUserByIdentifier(loginKey(parsed.data));
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
  const schema = z.object({
    identifier: z.string().trim().min(3).optional(),
    email: z.string().trim().optional(),
  }).refine((value) => !!(value.identifier || value.email), { message: 'identifier required' });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation failed' });
    return;
  }
  const user = findUserByIdentifier(loginKey(parsed.data));
  if (user && !user.email_verified) {
    const otp = await issueOtp(user, 'VERIFY_ACCOUNT');
    if (!otp.emailSent && !otp.smsSent) {
      res.status(503).json({ error: 'code delivery unavailable, try again later' });
      return;
    }
    res.json({ ok: true, ...otpPayload(otp, user) });
    return;
  }
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Password reset (signed out): email code → set new password → notice email.
// ---------------------------------------------------------------------------

authRouter.post('/forgot-password', authLimiter, async (req, res) => {
  const schema = z.object({
    identifier: z.string().trim().min(3).optional(),
    email: z.string().trim().optional(),
  }).refine((value) => !!(value.identifier || value.email), { message: 'identifier required' });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation failed' });
    return;
  }
  const user = findUserByIdentifier(loginKey(parsed.data));
  if (user) {
    await issueOtp(user, 'PASSWORD_RESET');
  }
  res.json({ ok: true });
});

authRouter.post('/reset-password', authLimiter, async (req, res) => {
  const schema = z.object({
    identifier: z.string().trim().min(3).optional(),
    email: z.string().trim().optional(),
    code: z.string().regex(/^\d{6}$/),
    newPassword: z.string().min(8).max(128),
  }).refine((value) => !!(value.identifier || value.email), { message: 'identifier required' });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation failed', issues: parsed.error.issues });
    return;
  }
  const user = findUserByIdentifier(loginKey(parsed.data));
  if (!user || !consumeEmailCode(user.id, 'PASSWORD_RESET', parsed.data.code)) {
    res.status(401).json({ error: 'invalid or expired code' });
    return;
  }
  const now = new Date().toISOString();
  const passwordHash = await hash(parsed.data.newPassword, PASSWORD_HASH_OPTIONS);
  tx(() => {
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, now, user.id);
    db.prepare('DELETE FROM email_codes WHERE user_id = ?').run(user.id);
  });
  try {
    await sendPasswordChangedNotice(user.email, now, 'RESET');
    if (user.phone) await sendOtpSms(user.phone, 'Your ResQNET password was reset.', 'PASSWORD_CHANGED');
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
  const passwordHash = await hash(parsed.data.newPassword, PASSWORD_HASH_OPTIONS);
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, now, user.id);
  try {
    await sendPasswordChangedNotice(user.email, now, 'CHANGE');
    if (user.phone) await sendOtpSms(user.phone, 'Your ResQNET password was changed.', 'PASSWORD_CHANGED');
  } catch (err) {
    logger.error({ err }, 'password-changed notice failed');
  }
  audit(user.id, 'auth.password.change', 'user', user.id);
  res.json({ ok: true });
});

/** Email a code for the in-app password change (reuses the PASSWORD_RESET purpose). */
authRouter.post('/send-change-code', requireAuth, async (req: AuthedRequest, res) => {
  const user = getUserById(req.user!.userId);
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
  const otp = await issueOtp(user, 'PASSWORD_RESET');
  if (!otp.emailSent && !otp.smsSent) {
    res.status(503).json({ error: 'code delivery unavailable, try again later' });
    return;
  }
  res.json({ ok: true, ...otpPayload(otp, user) });
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
  const user = db.prepare('SELECT id, email, phone, display_name, role, email_verified FROM users WHERE id = ?').get(req.user!.userId) as
    | { id: string; email: string; phone: string | null; display_name: string; role: string; email_verified: number }
    | undefined;
  if (!user) {
    res.status(404).json({ error: 'user not found' });
    return;
  }
  res.json({ user: { id: user.id, email: user.email, phone: user.phone, displayName: user.display_name, role: user.role, emailVerified: !!user.email_verified } });
});
