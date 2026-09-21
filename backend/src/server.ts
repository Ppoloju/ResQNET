import express from 'express';
import cors from 'cors';
import compression from 'compression';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { logger } from './logger.js';
import { errorHandler } from './middleware/audit.js';
import { authRouter } from './routes/auth.js';
import { profileRouter } from './routes/profile.js';
import { sitrepsRouter } from './routes/sitreps.js';
import { resourcesRouter } from './routes/resources.js';
import { familyRouter } from './routes/family.js';
import { emergenciesRouter } from './routes/emergencies.js';
import { checkinsRouter } from './routes/checkins.js';
import { syncRouter } from './routes/sync.js';
import { simRouter } from './routes/sim.js';
import { broadcastsRouter } from './routes/broadcasts.js';
import { missingRouter } from './routes/missing.js';
import { respondersRouter } from './routes/responders.js';
import { realtimeRouter } from './routes/realtime.js';
import { notificationsRouter } from './routes/notifications.js';
import { aiRouter } from './routes/ai.js';
import { settingsRouter } from './routes/settings.js';
import { startNotificationDeliveryWorker } from './notifications.js';
import { mailerMode } from './lib/mailer.js';
import { smsMode, smsProvider } from './lib/sms.js';
import { seedTeamAccounts } from './seedTeam.js';

const app = express();
app.set('trust proxy', 1);
// gzip would buffer the SSE event stream on browsers — never compress realtime.
app.use(compression({
  filter: (req, res) => {
    if (req.path.includes('/realtime/stream') || req.headers.accept === 'text/event-stream') return false;
    return compression.filter(req, res);
  },
}));
app.use(cors({ origin: config.frontendOrigin, credentials: true }));
app.use(express.json({ limit: '1mb' }));

// Simple per-process request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', finish);
  function finish() {
    logger.info({ method: req.method, url: req.url, status: res.statusCode, ms: Date.now() - start }, 'http');
  }
  next();
});

const healthCheck = (_req: express.Request, res: express.Response) => {
  res.json({
    ok: true,
    env: config.env,
    demoMode: config.demoMode,
    email: mailerMode(),
    sms: smsProvider(),
    emailReady: mailerMode() === 'smtp',
    smsReady: smsMode() === 'live',
  });
};

app.get('/healthz', healthCheck);
app.get('/api/healthz', healthCheck);

app.use('/api/auth', authRouter);
app.use('/api/emergency-profiles', profileRouter);
app.use('/api/family', familyRouter);
app.use('/api/emergencies', emergenciesRouter);
app.use('/api/check-ins', checkinsRouter);
app.use('/api/sync', syncRouter);
app.use('/api/sim', simRouter);
app.use('/api/broadcasts', broadcastsRouter);
app.use('/api/missing-persons', missingRouter);
app.use('/api/responders', respondersRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/ai', aiRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/sitreps', sitrepsRouter);
app.use('/api/resources', resourcesRouter);
app.use('/api/realtime', realtimeRouter);

// Serve idea.html at /idea for convenience (repo-root static, read-only)
app.use(express.static(projectRootDir(), { index: 'idea.html' }));

function projectRootDir(): string {
  // <repo>/backend/dist -> repo root; works for src via tsx too (src/server.js -> ../../).
  const here = fileURLToPath(new URL('.', import.meta.url));
  const root = path.resolve(here, '../../');
  return path.basename(root) === 'backend' ? path.resolve(root, '..') : root;
}

app.use((req, res) => {
  res.status(404).json({ error: 'not found' });
});
app.use(errorHandler);

const server = http.createServer(app);

const PORT = config.port;
const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : '';
const currentFile = path.resolve(fileURLToPath(import.meta.url));

// Keep imports side-effect free so Vitest and embedding callers can use `app`
// without opening a second listener on the development port.
if (entrypoint === currentFile) {
  startNotificationDeliveryWorker();
  void seedTeamAccounts()
    .then(() => logger.info('team accounts ready (Gitam@2028)'))
    .catch((err) => logger.error({ err }, 'team account seed failed'));
  server.listen(PORT, () => {
    logger.info(`ResQNET backend listening on :${PORT} (env=${config.env}, demo=${config.demoMode})`);
  });
}

export { app, server };
