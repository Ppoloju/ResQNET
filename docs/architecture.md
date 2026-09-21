# ResQNET Architecture

## System overview

```text
+---------------------------------------------------------------+
|                        CLIENTS                                 |
|   React PWA (mobile-first)          Responder Dashboard        |
|   - SOS / Quick Help / Check-In     - live emergency feed      |
|   - Local AI (on-device)            - ACK + medical card       |
|   - Outbox (store-and-forward)      - broadcast issuing        |
+---------------------|-----------------------------------------+
                      | HTTPS (JWT)  +  SSE (realtime push)
+---------------------v-----------------------------------------+
|                       BACKEND (Express)                        |
|  auth · profiles · family · emergencies · check-ins · sync     |
|  responders · broadcasts · missing-persons · simulator · SSE   |
|  MeshEngine (deterministic sim)  ---  GatewaySync (real write) |
+---------------------|-----------------------------------------+
                      | node:sqlite (WAL, FK on)
+---------------------v-----------------------------------------+
|             DATABASE: database/schema.sql (16 tables)          |
+----------------------------------------------------------------+
```

## Monorepo layout

| Workspace        | Purpose                                                        |
|------------------|----------------------------------------------------------------|
| `shared/`        | Packet types, canonical-JSON HMAC signing, validation, local AI classifier, geo helpers — one implementation used by client AND server |
| `backend/`       | Express API, node:sqlite persistence, mesh engine + simulator, SSE hub, field encryption |
| `frontend/`      | React PWA: Home, Profile, Family, Network map, Responders, History, Demo |
| `database/`      | `schema.sql` — single source of truth, applied on backend boot |
| `netlify.toml`   | Netlify frontend build, publish directory, and SPA fallback    |

## Core flows

### 1. SOS (online)
1. User holds SOS → 3-2-1 countdown → activate.
2. On-device: anonymous identity `RQ_NODE_XXXX` (§34), geolocation (graceful
   `LOCATION_UNAVAILABLE` fallback), battery read (null if API absent — never fabricated).
3. Packet built (`EmergencyPacket`), signed HMAC-SHA256 with the device secret,
   validated against shared rules (TTL ≤ 6h, ≤ 8 hops, ±5 min clock skew).
4. `POST /api/emergencies` → server re-verifies, stores event + signed packet,
   audit-logs (redacted), SSE `mesh_event` fan-out.

### 2. SOS (offline)
Same packet → **outbox** (localStorage). UI switches to Emergency Mode with
black-box timeline. On reconnect the Sync Manager pushes idempotently (§47);
`/api/sync/push` accepts replays without duplicating events.

### 3. Simulated mesh (demo + tests)
`MeshEngine` (backend/src/mesh/engine.ts) models radio links in software:
flooding, duplicate detection, per-hop ACK, priority retry with backoff,
TTL expiry, battery-aware relay tiers (<20% CRITICAL-only), link-down
store-and-forward, chaos controls (link flap, node death, battery drain).
Radio links are simulated **[P]**; the routing logic is production code.

### 4. Gateway sync (the honest §52 bridge)
When a packet reaches the GATEWAY node, `gatewaySync.ts` writes a REAL
emergency row + signed message (`received_via: mesh:N-hops`) into the same
tables a production gateway would use, then fans out one notification row per
family member (SSE now, SMS/push bridge documented **[R]**).

## Design decisions

- **node:sqlite over better-sqlite3** — zero native compilation (Windows dev
  boxes without VS Build Tools, Alpine containers). Node ≥ 22 required.
- **Shared packet code** — client and server validate/sign identically; a
  tampered packet is rejected anywhere in its journey.
- **SSE over WebSockets** — one-way is sufficient, survives proxies, no extra deps.
- **Field encryption (AES-256-GCM)** — medical columns are ciphertext at rest;
  keys derived from `MSG_SIGNING_PEPPER` via scrypt; fail-closed decrypt.
- **No fabricated data** — battery/network states show "unknown" when the
  browser can't provide them; simulator pages are labeled `[P]` in-app.

## Extension points

- `CommunicationManager` interface in shared — BluetoothTransport `[R]` (native
  module), WifiDirectTransport `[R]`, LocalNetworkTransport, InternetTransport
  (implemented: REST + SSE).
- `LocalAIEngine` interface — `RuleBasedAIEngine` ships now; a quantized
  on-device model (e.g. Gemini Nano / MediaPipe) can drop in without UI changes.
