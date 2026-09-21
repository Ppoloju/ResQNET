import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });
dotenv.config({ path: path.resolve(here, '../.env') });
dotenv.config();

const WEAK_SECRETS = new Set(['change-me-local-only', 'change-me-in-production']);

function secret(name: string, localFallback: string): string {
  const value = process.env[name];
  const env = process.env.NODE_ENV ?? 'development';
  if (!value) {
    if (env === 'production') throw new Error(`Missing required production secret: ${name}`);
    return localFallback;
  }
  if (env === 'production' && (value.length < 32 || WEAK_SECRETS.has(value))) {
    throw new Error(`${name} must be a unique secret of at least 32 characters in production`);
  }
  return value;
}

function corsOrigins(): string | string[] {
  const raw = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173,http://localhost:8080';
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (list.includes('*')) return '*';
  return list.length === 1 ? list[0]! : list;
}

function portFromEnv(): number {
  const n = Number(process.env.PORT);
  return Number.isFinite(n) && n > 0 ? n : 4000; // PORT=0/empty/garbage → default
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  demoMode: process.env.DEMO_MODE === 'true' || process.env.NODE_ENV === 'demo',
  port: portFromEnv(),
  databasePath: process.env.DATABASE_PATH ?? './data/iqoo.sqlite',
  jwtSecret: secret('JWT_SECRET', 'change-me-local-only'),
  msgSigningPepper: secret('MSG_SIGNING_PEPPER', 'change-me-local-only'),
  frontendOrigin: corsOrigins(),
  rateLimitAuth: Number(process.env.RATE_LIMIT_AUTH ?? 10),
  rateLimitApi: Number(process.env.RATE_LIMIT_API ?? 120),
  syncBatchSize: Number(process.env.SYNC_BATCH_SIZE ?? 50),
  notification: {
    smsWebhookUrl: process.env.SMS_WEBHOOK_URL ?? '',
    pushWebhookUrl: process.env.PUSH_WEBHOOK_URL ?? '',
    emergencyServiceWebhookUrl: process.env.EMERGENCY_SERVICE_WEBHOOK_URL ?? '',
    webhookToken: process.env.NOTIFICATION_WEBHOOK_TOKEN ?? '',
  },
  push: {
    subject: process.env.WEB_PUSH_SUBJECT ?? 'mailto:ops@resqnet.app',
    publicKey: process.env.WEB_PUSH_PUBLIC_KEY ?? '',
    privateKey: process.env.WEB_PUSH_PRIVATE_KEY ?? '',
  },
  sms: {
    twilioSid: process.env.TWILIO_ACCOUNT_SID ?? '',
    twilioToken: process.env.TWILIO_AUTH_TOKEN ?? '',
    twilioFrom: process.env.TWILIO_FROM ?? '',
    fast2smsKey: process.env.FAST2SMS_API_KEY ?? '',
    twoFactorKey: process.env.TWOFACTOR_API_KEY ?? '',
    textbeltKey: process.env.TEXTBELT_KEY ?? '',
  },
  mesh: {
    ttlSeconds: Number(process.env.MESH_TTL_SECONDS ?? 3600),
    maxHops: 8,
    beaconIntervalMs: Number(process.env.MESH_BEACON_INTERVAL_MS ?? 10000),
  },
  // SMTP for account-security email (verification codes, 2FA, reset). Unset host
  // → dev console fallback (mailer logs codes; tests mock the mailer).
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? 'ResQNET <no-reply@resqnet.app>',
  },
  // Resend a 2FA/verify code at most this often (seconds).
  emailCodeResendSeconds: Number(process.env.EMAIL_CODE_RESEND_SECONDS ?? 45),
};
