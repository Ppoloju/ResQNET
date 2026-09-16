# ResQNET Implementation Tracker

**Project:** ResQNET — Offline AI Emergency Network
**Constraint:** 100% free/open-source stack. No paid APIs, hosting, models, or SDKs.
**Working mode:** feature-by-feature; this file is updated after every feature.

## Status Legend

- [ ] Not Started
- [~] In Progress
- [x] Completed
- [!] Blocked
- [P] Prototype/Simulation
- [R] Requires Production Integration

---

# Phase 0 — Project Audit & Architecture Decision

## Audit findings (2026-09-14)

- Project folder `IQOO/` was **empty** (only `.freebuff/` metadata). Nothing existed to preserve.
- Environment: Node v24.12.0, npm 11.6.2, Docker CLI 29.4.3 (daemon not running), Git 2.52 (Windows/Git Bash).
- There is no legacy architecture to protect; the roadmap below defines it.

## Stack decision (free-only, technically defensible)

| Layer | Choice | Reason |
|---|---|---|
| Frontend | React 18 + Vite 5 + TypeScript, **PWA** (installable, manifest, standalone display) | Free, fast, one codebase for dashboard + phone. |
| Backend | Node.js + Express + TypeScript | Free, ubiquitous, hackathon-friendly. |
| Backend DB | **SQLite via `node:sqlite`** (Node built-in, zero native deps) | No node-gyp/Visual Studio needed on Windows dev; no native build in Docker. Free, file-based, WAL mode. |
| Local (device) storage | `localStorage` (outbox, identity, active emergency) | Browser-native, offline, free. IndexedDB upgrade path when media blobs land. |
| Auth | Argon2id (`@node-rs/argon2`), HS256 JWT (free), per-device token | No paid auth service. |
| Signing | **HMAC-SHA256 over canonical JSON** via WebCrypto (identical code client+server) | Works in every modern browser and Node; Ed25519 noted as production upgrade. |
| Mesh simulation | `MeshEngine` (deterministic, in-process) + `/api/sim/*` endpoints | §51: proves routing logic without physical radios; clearly labeled SIMULATION. |
| Local AI | `LocalAIEngine` interface planned; rule-based classifier first (§61: no big model downloads) | ONNX Runtime Web = upgrade path. |
| Location | Geolocation API with accuracy-honest states (§20) | Browser GPS; `LOCATION_UNAVAILABLE` when it fails. |
| Docker | `docker compose` (node:24-alpine multi-stage) | `node:sqlite` requires Node ≥ 22.5 → base image is 24. |

## Mobile vs Web reality (§60, decided up front)

The frontend is a web PWA. Browser Bluetooth cannot do background BLE mesh; iOS/Safari has no Web Bluetooth at all. Therefore:

- Web PWA = dashboard, demo, SOS core (works logged-out + offline), responder view, foreground BLE where supported → `[P]`.
- `MeshEngine` + simulator prove mesh logic end-to-end in tests — labeled **simulation**, never claimed as real radios.
- React Native / Android native client is the production path for background BLE, Wi-Fi Direct/Nearby, boot-persistent SOS → `[R]`. The transport abstraction is designed so a native transport drops in without core changes.

## Known platform limitations (honest, §6)

- Web Bluetooth: no background scanning, single-connection GATT, no iOS.
- `navigator.onLine` reflects the OS network stack, not end-to-end reachability.
- Location indoors: packets carry `LOCATION_UNAVAILABLE`/`LAST_KNOWN` + accuracy; never fake precision.
- Bluetooth cannot reach services outside radio range; gateways are explicit relays, not magic (§62).
- Browser SOS works while the tab/page is open; true background SOS requires the native client `[R]`.

---

# Phase 0 — Audit checklist

- [x] Existing architecture audited (folder was empty; decision recorded)
- [x] Dependencies audited (none existed)
- [x] Docker audited (CLI present; daemon off; compose config validated)
- [x] Database audited (none; SQLite chosen, schema v1 written)

# Phase 1 — Foundation

- [x] Monorepo structure (frontend/ backend/ shared/ database/ docker/)
- [x] Environment configuration (.env.example with LOCAL/DEV/DEMO/PRODUCTION guidance)
- [x] Docker (compose + multi-stage Dockerfile; node:24-alpine; daemon-off on dev machine — build pending daemon start)
- [x] Database (SQLite schema v1: users, devices, emergency_profiles, family_members, emergency_events, emergency_messages, message_deliveries, check_ins, responders, responder_locations, audit_log, emergency_media)
- [x] Authentication (register/login, Argon2id, JWT, per-device secrets shown once)
- [x] Logging (pino, structured, secret + medical redaction)
- [x] Backend health, error middleware, request logging, RBAC helper, rate limits
- [x] Shared core (packet schema, validation, TTL/hop rules, canonical JSON, HMAC sign/verify)
- [x] Frontend shell (status bar with real `online`/Battery API, footer nav, 4 screens, PWA manifest)
- [x] SOS core on device (3-2-1 countdown with cancel, geolocation w/ accuracy, battery snapshot, signed packet, offline outbox, crash-safe restore, resolve flow, black-box timeline)
- [x] Anonymous device identity (SOS works logged-out; public ID carries no personal info)

**Status:** Complete
**Implementation:** Everything above; backend boots (`/healthz` + register/login verified via curl), `npm run build` green for all three workspaces.
**Files changed:** package.json, .gitignore, .env.example, database/schema.sql, docker/*, backend/**, frontend/**, shared/**, README.md, idea.html, implementation.md
**Tests:** 25 passing (22 backend: crypto/validation/mesh scenarios/API smoke incl. sim demo path; 3 frontend: SOS countdown/cancel, offline activation → outbox, resolve)
**Known limitations:** BLE/real radio transports not yet started (Phase 5 remainder); local AI not yet started (Phase 6); responder dashboard not yet (Phase 7); medical fields not yet encrypted-at-rest (Phase 10); Docker image build pending Docker daemon.
**Next step:** Phase 2-3 polish (profile/family sync from PWA is done vs server), then Phase 5 remainder: WebBluetoothTransport `[P]` + LocalNetworkTransport (same-LAN HTTP), then Phase 6 local AI.

# Phase 2 — Emergency Profile

- [x] Profile CRUD (server: GET/PUT `/api/emergency-profiles/me`, validated)
- [x] UI editor (Profile screen: all §7 fields incl. accessibility needs)
- [x] Privacy settings (PRIVATE/FAMILY/RESPONDERS/NEARBY_HELPERS, default PRIVATE, consent gate for medical fields)
- [x] Emergency Card preview (owner-controlled disclosure; medical only with consent)
- [x] Server-side `/me/card` endpoint honoring consent
- [x] Medical fields encrypted-at-rest (AES-256-GCM envelope `enc:v1:`, scrypt-derived key; fail-closed decrypt; legacy plaintext re-encrypts on save)

# Phase 3 — Family Circle

- [x] Add member (name, relation, phone, priority 1-9, trusted flag)
- [x] Edit member (priority ▲, trusted ★ toggle)
- [x] Remove member
- [x] Priority ordering (server sorts by priority)
- [x] Family status / last-seen via check-ins (Family page shows per-member SAFE/AT_RISK/NEEDS_HELP pill + timestamp for linked accounts; SMS path `[R]` labeled in UI)
- [x] Test communication button — round-trip through the real pipeline (real CHECK_IN POST → family-status readback), SMS path honestly labeled `[R]`

# Phase 4 — SOS

- [x] Countdown (3-2-1) with cancel, aria-live, alertdialog role
- [x] Emergency ID generation (IQ-XXXXXXXX, unambiguous alphabet)
- [x] Location capture with honest state + accuracy
- [x] Battery capture (Battery API; null when unavailable — never fabricated)
- [x] Signed emergency packet (HMAC-SHA256, canonical JSON)
- [x] Emergency Mode screen (ID, location, battery, delivery state, timeline)
- [x] Resolve emergency (I'm Safe → resolution path, offline-safe)
- [x] Crash-safe restore of active emergency (localStorage)
- [x] Family notification on SOS (gateway-sync fan-out writes notification rows; SSE delivery; `/api/notifications` list + ack API; SMS/push bridge `[R]`)

# Phase 5 — Communication

- [x] Store-and-forward outbox on device (localStorage, drained on `online` + 30s interval)
- [x] MessageRouter-equivalent rules in shared validator (dedupe/TTL/hops/priority handled at engine + validator)
- [x] TTL + hop limit (validator: ≤8 hops, ≤6h TTL; engine enforces at forwarding)
- [x] Duplicate detection (engine seen-sets)
- [x] ACK flow (per-hop, recorded in engine)
- [x] Retry strategy (priority-based attempts: CRITICAL 3 / HIGH 2 / other 1, backoff)
- [x] Battery-aware relay tiers (§29: <20% CRITICAL-only; <50% ≥HIGH; configurable)
- [x] Deterministic MeshEngine + `/api/sim/*` (engine/inject/state/verify/link-down/link-up/battery/sweep)
- [x] WebBluetoothTransport `[P]` (foreground GATT via Nordic-UART-style service; implements shared `Transport` interface; feature-detected, honest availability states; iOS/unsupported browsers degrade cleanly)
- [x] CommunicationManager + Transport interfaces in shared (`shared/src/transport.ts`); TransportProvider wires them app-wide
- [x] LocalNetworkTransport (same-LAN backend via configurable URL, real `/healthz` probing with TTL cache — never trusts `navigator.onLine`)
- [ ] Wi-Fi Direct / Wi-Fi Aware `[R]` (needs native client)
- [x] InternetTransport SSE live push (`/api/realtime/stream`, JWT via header or `?token=` for EventSource)
- [x] Delivery status UI in Emergency Mode (queued/delivered state + live responder ACK cards via SSE for the active emergency)

# Phase 6 — Local AI

- [x] LocalAIEngine abstraction (`shared/src/ai.ts`: interface + `RuleBasedAIEngine`)
- [x] Rule-based emergency classifier (offline keyword/intent → category × severity; confidence band; recommended action; matched-signal transparency)
- [x] Voice → transcript → classification `[P]` (Web Speech where available; typed input full fallback; never uploads)
- [x] Mic consent + persistent RECORDING indicator with STOP (§16); camera capture behind explicit consent in Missing Person `[P]` (press-to-start, live preview, capped resolution for mesh budget, hard cleanup)
- [x] Permission handling (graceful denial message; feature detection for unsupported browsers)
- [x] AI result attached to emergency packet (`packet.ai`) and shown in Emergency Mode
- [x] Prompt suggestions for voice UX; deterministic + unit-tested (8 shared tests)

# Phase 7 — Emergency Network

- [x] Simulated nodes/roles in MeshEngine (NORMAL/RELAY/RESPONDER/GATEWAY auto-roles §40)
- [x] Nearby users list UI (Home card → `/responders/nearby` haversine; server view `[R]` BLE on phones)
- [x] Gateway ingest of simulated packets into REAL backend tables (`gatewaySync.ts`; idempotent by emergency id; `received_via: mesh:N-hops`)
- [x] Responder dashboard UI (live feed, consent-gated medical card snapshot, OSM location link, ACK action, SSE auto-refresh)
- [x] Network visualization (§38: stats, nodes with roles/battery/queue state, deliveries, engine timeline, live SSE events)
- [x] Family notification fan-out (§52 step 8: one notification row per member; SSE now, SMS/push bridge `[R]`)
- [x] Responder ACK flow (unique per responder, broadcast via SSE, retrievable)

# Phase 8 — Advanced Features

- [x] Quick Help (low-profile nearby alert with reason categories; distinct from SOS)
- [x] Safety Check-In UI (I'm Safe + At-risk buttons, own last-status with timestamp via GET /check-ins, per-member family statuses on Family page)
- [x] Disaster Broadcast (responder/admin issue/cancel, TTL-mandatory, SSE banner on all clients, active list on Home)
- [x] Missing Person mode backend (authorized creation, status, sightings; NO automatic facial recognition — human-reviewed by design)
- [x] Emergency Black Box (timeline in Emergency Mode + persisted `iqoo.blackbox` + History screen with expandable per-emergency timeline + offline outbox view)
- [x] Battery-aware routing tiers (engine-level + **user-configurable thresholds in Settings** with live tier preview; low-power mode toggle)
- [x] Relay Readiness score (§37: `shared/src/net.ts` + `/sim/relay-readiness` + Network page meter with reason + consent toggle in More)
- [x] Delay-tolerant behavior (store → link recovers → flush; tested)
- [x] Missing Person UI (create with photo/clothing/location, open reports list, human-reviewed matching notice)

# Phase 9 — Sync

- [x] Offline queue (outbox in localStorage)
- [x] Sync manager (drain on reconnect + interval)
- [x] Idempotency (server INSERT OR IGNORE; acked ids clear outbox exactly-once)
- [x] Conflict handling — optimistic concurrency on profile: client sends `baseVersion`, stale writes get 409 + current server version; omitted baseVersion = explicit last-writer-wins; response returns the new version (tested)
- [x] Backend → device pull on reconnect (client consumes `/sync/pull` with persisted cursor, dedupes seen-packets, black-box logs received packets)
- [x] End-to-end reconnect test (sync.test.ts: push → idempotent replay → exactly-one row; pull + cursor; ack; malformed rejection)

# Phase 10 — Security

- [x] Argon2id password hashing (never plaintext)
- [x] JWT + per-device tokens
- [x] HMAC packet signing + verification (shared code both sides)
- [x] Replay hardening (timestamp skew window ±5min + `ReplayCache` nonce cache: bounded LRU with TTL, wired into gateway sync, unit-tested incl. TTL expiry and memory bound)
- [x] Rate limiting (auth 10/min, API 120/min; configurable)
- [x] Audit log (append-only table + middleware writer, redacted)
- [x] Role-based access (user/responder/admin; responder-feed guarded)
- [x] Input validation everywhere (zod schemas)
- [x] PII hygiene (public device IDs carry no personal data §34; log redaction)
- [x] Medical-field encryption-at-rest (AES-256-GCM envelope; decrypt-on-read for owner/consented card only)
- [x] Ed25519 identity keys (`shared/src/deviceKeys.ts`: feature-detected WebCrypto Ed25519 — generate/import JWK, sign, verify; runtime-guarded tests incl. tamper + wrong-key + malformed rejection; HMAC remains the fallback where unsupported)

# Phase 11 — Testing

- [x] Backend unit tests (auth, crypto, packet schema, mesh engine)
- [x] Frontend component tests (SOS countdown, offline activation, resolve)
- [x] Network simulation tests (A→B→C→G relay, dedupe, TTL, retry, ACK, link-down/recovery)
- [x] Gateway sync + responders + broadcasts integration suite (8 tests: real DB write, idempotency, family fan-out, RBAC 403s, ACK dedupe, nearby sort, broadcast RBAC, E2E sim flood→gateway→DB)
- [x] Field-encryption tests (roundtrip, idempotency, tamper fail-closed, profile codec)
- [x] AI classifier tests (8: categories, severity ladders, immobility, battery-context, determinism)
- [x] Battery-tier boundary tests (20%/50% edges exact; engine-level forwarding gate verified — fixed real bug: low-battery devices previously could not RECEIVE packets, now reception is never blocked and only onward relay is gated per §29)
- [x] E2E offline flow test (API-level: sync.test.ts offline→push→idempotent; browser-level: sos.test.tsx offline→online→outbox drained with fetch-mocked sync ack)

# Phase 12 — Hackathon Demo

- [x] Simulation endpoints for demo path (`/api/sim/engine|inject|state|verify|link/*|battery|sweep`)
- [x] Demo path proven in tests (A→B→C→Gateway with ACKs and dedupe → real DB row)
- [x] Demo Mode UI (§52 scripted 9-step scenario runner with live SSE-checked milestones + chaos controls)
- [x] Responder dashboard UI (RBAC-gated; feed + ACK + broadcasts + check-ins)
- [x] Network visualization (§38)
- [x] Emergency history / black box screen (server records + offline outbox + persisted timeline)
- [x] docs/ (architecture.md, api-contract.md, security.md, offline-network.md, ai-architecture.md, demo.md)
- [x] Demo instructions (docs/demo.md)
- [x] Settings page (§29/§37: relay consent, low-power mode, scan interval, battery thresholds, transport status + pairing, reset)
- [x] Final README (refreshed with full feature set, 65-test count, verified Docker path)
- [x] Docker image build verification — **DONE 2026-09-15**: image builds (node:24-alpine), compose stack boots healthy, live E2E inside the container: register → topology → inject → 3-hop flood → gateway → `IQ-DOCKERE1` row with `received_via: mesh:3-hops` in the persisted volume. Fixed Dockerfile bug found during verification: `shared/dist` was not shipped to the runtime layer (ERR_MODULE_NOT_FOUND) and WORKDIR did not match the schema path.

# Phase 13 — 3-Mode Architecture

- [ ] Normal Mode: Standard app usage with minimal resource consumption, background monitoring of sensors (low power), family circle and emergency profile stored securely
- [ ] Emergency Mode: Triggered by SOS button or AI detection (fall, accident, distress signals), device-to-device Bluetooth mesh for multi-hop alerts, shares emergency profile + location with trusted contacts, prioritizes critical alerts using local AI classification
- [ ] Disaster Mode: Activated when multiple emergencies are detected in a region or disaster signals (earthquake, flood, fire) are identified
- [ ] Disaster Mode - Community mesh expansion: Devices form a larger ad-hoc network for group coordination
- [ ] Disaster Mode - Resource mapping: AI identifies safe zones, shelters, medical aid points from local data
- [ ] Disaster Mode - Crowdsourced situational awareness: Each device contributes sensor data (smoke, noise, GPS movement) to build a disaster map
- [ ] Disaster Mode - Priority routing: Critical alerts (injuries, trapped individuals) are given bandwidth priority
- [ ] Disaster Mode - Offline disaster bulletin: Updates propagate through mesh (e.g., “Bridge collapsed ahead”, “Shelter open at school”)
- [ ] Disaster Mode - AI assistant: Guides basic first aid, evacuation steps, or connects survivors to nearest responders

---

## Blocker log

(none — Docker daemon resolved 2026-09-16: Desktop started, image rebuilt with the shared/dist fix, compose stack verified live end-to-end)

## Changelog

- 2026-09-16 — App brought up live: Docker compose backend running healthy (volume-persisted DB), frontend dev server on :5173, E2E smoke test through register→profile. Smoke test exposed and fixed a real decrypt-at-rest bug: `/emergency-profiles/me` and `/me/card` discarded `decryptProfileFields`'s returned copy and served raw ciphertext for allergies/medications/medical_conditions/notes/photo — routes now decrypt before responding (verified: plaintext readback over the API while storage stays `enc:v1:...`); regression test added for the copy contract. Also fixed the frontend crash-on-load from a missing `AIProvider` in main.tsx (dropped during an earlier main.tsx rewrite) and updated the blocker log. 66 tests passing (13 shared, 49 backend, 4 frontend); typecheck + builds green; live UI verified (AI classifier returns CRITICAL/MEDICAL on-device in the running app).
- 2026-09-15 (5) — Final phases closed: Docker VERIFIED end-to-end (found + fixed a real Dockerfile bug: shared/dist missing from runtime layer; image rebuild + compose boot + container E2E with persisted volume row); profile optimistic concurrency via baseVersion (409 + server version on stale writes; LWW documented as explicit default; tested); Ed25519 device-key signing as the feature-detected production upgrade path (roundtrip/tamper/wrong-key/malformed tests — also fixed a test-ordering bug: module-load-time skip flag never saw the beforeAll result); check-ins list endpoint + Home status view + At-risk button; README refreshed. 65 tests passing (13 shared, 48 backend, 4 frontend); typecheck + builds green. Every implementable phase is now complete; remaining items are honestly labeled [R] (native client, SMS/push, Wi-Fi Direct, responder integration) or environment-dependent.
- 2026-09-15 (4) — Final feature sweep: notifications API (list + idempotent ack) mounted at `/api/notifications`; Emergency Mode shows live responder ACK cards for the active emergency via SSE; LocalNetworkTransport completes the §35 transport set (probed availability, TTL-cached health check); Family page 'test communication' button exercises the real check-in pipeline round-trip; Missing Person gains consent-first camera capture `[P]` (press-to-start preview, resolution-capped JPEG to respect the 150 KB mesh budget, hard stream cleanup on stop/unmount); frontend test added for offline→online outbox drain with fetch-mocked sync ack. 58 tests passing (8 shared, 46 backend, 4 frontend); typecheck + builds green; boot smoke test verified the new endpoint.
- 2026-09-15 (3) — Remaining phases + tidiness: shared `ReplayCache` (nonce cache §33) wired into gateway sync — test found and fixed a prune-timing flaw (replay check now reads the entry's own timestamp, correct regardless of lazy-prune schedule); `CommunicationManager` + `Transport` interfaces in shared (§35) with `WebBluetoothTransport [P]` (foreground GATT, feature detection, honest availability) and TransportProvider; Settings page + SettingsContext (relay consent, low-power mode, scan interval, configurable battery thresholds with live tier preview, transport status/pairing); More page slimmed to navigation; Network page shows per-transport status and threshold summary; removed dead `CreateSosArgs` type; main.tsx provider nesting cleaned. 57 tests passing (8 shared, 46 backend, 3 frontend); typecheck + build green across all workspaces; boot smoke test verified. Docker image build remains environment-blocked (daemon off) — compose config validated.
- 2026-09-15 (2) — Cleanup + Phase 3/8/9/11 completion: removed build artifacts and smoke-test DB from tree; Family page shows live check-in statuses (§25); Missing Person UI page (§27, human-reviewed matching); client pull-on-reconnect with cursor + dedupe (§47 receive path); battery-tier boundary tests caught and FIXED a real §29 bug (low-battery devices were blocked from receiving; now only onward relay is gated, matching the spec's 'reception always allowed'); sync E2E suite (idempotent replay → exactly-one row, cursor pagination, ack). 53 tests passing (8 shared, 42 backend, 3 frontend); all workspaces typecheck + build clean.
- 2026-09-15 — Phases 6/7/8/10/12 core completed. Local AI (rule-based, on-device, voice + typed, consent-first, packet-attached); SSE realtime hub (JWT via header/query); medical-field AES-256-GCM encryption-at-rest; responders API (nearby haversine, RBAC feed, ACKs, seed); disaster broadcasts with TTL + SSE banner; missing-persons backend (no facial recognition by design); gateway sync bridge — simulated mesh packets reaching GATEWAY write REAL emergency rows + signed messages + family notification fan-out (idempotent); frontend: Network page (stats/nodes/deliveries/timeline/Relay Readiness meter), Responder dashboard, History with persisted black box + offline outbox, Demo Mode (9-step scenario, live SSE milestones, chaos controls), broadcast banner, Nearby card, More page with relay-consent toggle. 46 tests passing (8 shared, 35 backend, 3 frontend); all workspaces typecheck + build; live smoke test verified inject→3 hops→gateway→DB row. Honest fixes: `/feed`+`/ack` now require auth before role check; notifications table added; black box persisted to localStorage.
- 2026-09-14 — Phase 0 audit complete; stack decided (free-only). Phase 1 complete: monorepo, SQLite schema v1, auth (Argon2id/JWT/devices), profile + family APIs, SOS core (countdown, geolocation, battery, signed packets, offline outbox, resolve, black box), shared packet core (canonical JSON + HMAC), deterministic MeshEngine with store-and-forward/dedupe/TTL/ACK/retry/battery tiers, `/api/sim` demo endpoints, PWA shell with real status bar. 25 tests passing; all workspaces build. Notable environment adaptation: replaced better-sqlite3 with Node built-in `node:sqlite` (native compile unavailable on this Windows machine without VS build tools — keeps the free-tooling constraint honest).
