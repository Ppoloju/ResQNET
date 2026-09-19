# ResQNET Deployment Guide

## Quick start (development)

```bash
cp .env.example .env            # adjust secrets if you like; defaults work locally
npm install
npm run build -w shared         # @iqoo/shared must be built before backend/frontend
npm run dev -w backend          # API on :4000 (applies database/schema.sql at boot)
npm run dev -w frontend         # app on :5173, /api proxied to :4000 by Vite
```

The Vite dev proxy forwards `/api` to `http://localhost:4000`, so the browser
always talks same-origin — the same contract production nginx provides.

## Full stack (Docker)

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

| Service  | URL                          | Notes |
|----------|------------------------------|-------|
| frontend | http://localhost:8080        | nginx serving the Vite build, proxies `/api` + `/realtime/stream` to the backend |
| backend  | http://localhost:4000        | healthcheck at `/healthz`, container-internal only for the frontend |
| database | volume `iqoo-data`           | SQLite at `/app/data/iqoo.sqlite`, survives restarts |

`docker compose -f docker/docker-compose.yml down` stops everything; the volume
is kept. Add `-v` to wipe data.

## Configuration

All backend config comes from env (see `.env.example`). Minimums for anything
shared beyond your machine:

- `JWT_SECRET`, `MSG_SIGNING_PEPPER` — generate with `openssl rand -hex 32`.
  The compose defaults exist so the stack boots, and are **not** safe.
- `FRONTEND_ORIGIN` — CORS allowlist origin of the deployed frontend.
- Rate limits (`RATE_LIMIT_AUTH`, `RATE_LIMIT_API`) ship tightened for prod.

The frontend build inlines `VITE_API_URL` if set; unset it for same-origin
deployment (recommended — nginx handles routing).

## Health & verification

```bash
curl -s http://localhost:8080/            # frontend serves the SPA
curl -s http://localhost:8080/api/healthz # via nginx → backend
docker compose -f docker/docker-compose.yml ps
```

## Honest production boundary

What ships here is deployable as an integrated prototype. What genuinely
remains for a production rollout is documented, not hidden:

- **Native mobile client** `[R]` — real BLE/Wi-Fi Direct radios need native
  transport implementations; the web app simulates the mesh honestly.
- **SMS / push bridges** `[R]` — notification fan-out is SSE + database rows;
  carrier integration is a documented integration point.
- **HTTPS termination** — put a TLS-terminating proxy in front of nginx.
- **Horizontal scale** — SQLite is single-node by design; the data layer
  isolates writes so swapping in Postgres is a bounded change `[R]`.
