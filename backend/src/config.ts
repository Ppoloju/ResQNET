import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  demoMode: process.env.DEMO_MODE === 'true' || process.env.NODE_ENV === 'demo',
  port: Number(process.env.PORT ?? 4000),
  databasePath: process.env.DATABASE_PATH ?? './data/iqoo.sqlite',
  jwtSecret: required('JWT_SECRET', 'change-me-local-only'),
  msgSigningPepper: required('MSG_SIGNING_PEPPER', 'change-me-local-only'),
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
  rateLimitAuth: Number(process.env.RATE_LIMIT_AUTH ?? 10),
  rateLimitApi: Number(process.env.RATE_LIMIT_API ?? 120),
  syncBatchSize: Number(process.env.SYNC_BATCH_SIZE ?? 50),
  mesh: {
    ttlSeconds: Number(process.env.MESH_TTL_SECONDS ?? 3600),
    maxHops: 8,
    beaconIntervalMs: Number(process.env.MESH_BEACON_INTERVAL_MS ?? 10000),
  },
};
