import 'dotenv/config';

function secret(name: string, localFallback: string): string {
  const value = process.env[name];
  const env = process.env.NODE_ENV ?? 'development';
  if (!value) {
    if (env === 'production') throw new Error(`Missing required production secret: ${name}`);
    return localFallback;
  }
  if (env === 'production' && value.length < 32) throw new Error(`${name} must be at least 32 characters in production`);
  return value;
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  demoMode: process.env.DEMO_MODE === 'true' || process.env.NODE_ENV === 'demo',
  port: Number(process.env.PORT ?? 4000),
  databasePath: process.env.DATABASE_PATH ?? './data/iqoo.sqlite',
  jwtSecret: secret('JWT_SECRET', 'change-me-local-only'),
  msgSigningPepper: secret('MSG_SIGNING_PEPPER', 'change-me-local-only'),
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
  rateLimitAuth: Number(process.env.RATE_LIMIT_AUTH ?? 10),
  rateLimitApi: Number(process.env.RATE_LIMIT_API ?? 120),
  syncBatchSize: Number(process.env.SYNC_BATCH_SIZE ?? 50),
  notification: {
    smsWebhookUrl: process.env.SMS_WEBHOOK_URL ?? '',
    pushWebhookUrl: process.env.PUSH_WEBHOOK_URL ?? '',
    emergencyServiceWebhookUrl: process.env.EMERGENCY_SERVICE_WEBHOOK_URL ?? '',
    webhookToken: process.env.NOTIFICATION_WEBHOOK_TOKEN ?? '',
  },
  mesh: {
    ttlSeconds: Number(process.env.MESH_TTL_SECONDS ?? 3600),
    maxHops: 8,
    beaconIntervalMs: Number(process.env.MESH_BEACON_INTERVAL_MS ?? 10000),
  },
};
