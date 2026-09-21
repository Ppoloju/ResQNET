# ResQNET Deployment Guide

## Quick start (development)

```bash
cp .env.example .env            # adjust secrets if you like; defaults work locally
npm install
npm run build -w shared         # @iqoo/shared must be built before backend/frontend
npm run dev -w backend          # API on :4000 (applies database/schema.sql at boot)
npm run dev -w frontend         # app on :5173, /api proxied to :4000 by Vite
```

The Vite dev proxy forwards `/api` to `http://localhost:4000`. In production,
Netlify serves the frontend and `VITE_API_URL` points it at the public API origin.

## Netlify frontend

The root `netlify.toml` builds the shared package and frontend, publishes
`frontend/dist`, and enables the SPA fallback. Configure this Netlify variable:

```text
VITE_API_URL=https://your-api.example.com/api
```

The API must allow the Netlify site origin in `FRONTEND_ORIGIN` and must expose
`/api` plus `/api/realtime/stream` over HTTPS.

## Configuration

All backend config comes from env (see `.env.example`). Minimums for anything
shared beyond your machine:

- `JWT_SECRET`, `MSG_SIGNING_PEPPER` — generate with `openssl rand -hex 32`.
- `FRONTEND_ORIGIN` — CORS allowlist origin of the deployed frontend.
- Rate limits (`RATE_LIMIT_AUTH`, `RATE_LIMIT_API`) ship tightened for prod.

The frontend build inlines `VITE_API_URL`; do not leave it empty for a separate
Netlify/API deployment.

## Health & verification

```bash
curl -s https://your-netlify-site.netlify.app/
curl -s https://your-api.example.com/api/healthz
```

## Honest production boundary

What ships here is deployable as an integrated prototype. What genuinely
remains for a production rollout is documented, not hidden:

- **Native mobile client** `[R]` — real BLE/Wi-Fi Direct radios need native
  transport implementations; the web app simulates the mesh honestly.
- **Email** — configure Gmail SMTP with an app password (`SMTP_HOST=smtp.gmail.com`,
  `SMTP_PORT=587`, `SMTP_SECURE=false`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`).
- **SMS** — configure Fast2SMS with `FAST2SMS_API_KEY`; delivery is attempted through
  the provider and failed deliveries remain visible in the notification queue.
- **Browser push** — generate VAPID keys with `npx web-push generate-vapid-keys` and
  configure `WEB_PUSH_SUBJECT`, `WEB_PUSH_PUBLIC_KEY`, and `WEB_PUSH_PRIVATE_KEY`.
  Users must opt in from Settings over HTTPS. The PWA service worker then receives
  emergency alerts even when the tab is closed.
- **Android FCM** `[R]` — this repository has no Android application module or Firebase
  service-account credentials. Do not claim Android push delivery until a native host
  registers FCM tokens and sends them to a server-side FCM adapter.
- **SMS and emergency-service bridges** — SMS is provider-backed when configured;
  dispatch integration remains a separate authenticated webhook/provider boundary.
- **HTTPS** — use Netlify TLS for the frontend and Railway TLS for the API.
- **Horizontal scale** — SQLite is single-node by design; the data layer
  isolates writes so swapping in Postgres is a bounded change `[R]`.

## Railway deployment

Create a Railway Node service from this repository with Node 24, a persistent volume
mounted at `/app/data`, build command `npm run build -w shared && npm run build -w backend`,
and start command `npm run start -w backend`. Set `NODE_ENV=production`, generated
`JWT_SECRET` and `MSG_SIGNING_PEPPER`, `FRONTEND_ORIGIN`,
`DATABASE_PATH=/app/data/iqoo.sqlite`, Gmail SMTP variables, `FAST2SMS_API_KEY`, and
Web Push VAPID variables in Railway Variables. Never commit provider credentials or
use the console OTP fallback in production.
