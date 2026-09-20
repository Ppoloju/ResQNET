# IQOO API Contract

Base URL: `/api` · Auth: `Authorization: Bearer <JWT>` (register/login/device).
All bodies JSON. Errors: `{ "error": string, "issues"?: [...] }`.

## auth
| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/auth/register` | `{email, password, displayName, phone?}` | → 201 `{token, user{id,email,phone,displayName,role}, device{id, publicId, secret}}` — secret shown ONCE |
| POST | `/auth/login` | `{email, password}` | → `{token, user{id,email,phone,displayName,role}, device?}` |
| POST | `/auth/devices` | `{name}` | register additional device |
| GET | `/auth/me` | — | current user `{id,email,phone,displayName,role}` |

## ai assistance
| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/ai/classify` | `{text, battery?, saysImmobile?}` | Authenticated deterministic offline rule-engine fallback; does not persist text or call a cloud model |

## emergency-profiles
| Method | Path | Notes |
|---|---|---|
| GET | `/emergency-profiles/me` | full own profile (medical fields decrypted server-side) |
| PUT | `/emergency-profiles/me` | upsert; medical fields encrypted at rest (AES-256-GCM) |
| GET | `/emergency-profiles/me/card` | §28 emergency card: minimal permitted fields, consent-gated |

Visibility tiers: `PRIVATE | FAMILY | RESPONDERS | NEARBY_HELPERS`.
`consentMedicalShare=false` strips allergies/conditions/medications even for responders.

## family
`GET /family` · `POST /family` · `PUT /family/:id` · `DELETE /family/:id`
Fields: `name, relation(FATHER…OTHER), phone, priority(1=highest), trusted, iqooAccountId?`.
`GET /family` also returns `linked`, `checkInStatus`, `lastCheckInAt`, and the latest
coordinate-bearing `lastLocation` for the linked account.

## emergencies
| Method | Path | Notes |
|---|---|---|
| POST | `/emergencies` | `{type: SOS\|QUICK_HELP, severity, category?, message?, location{latitude,longitude,accuracyMeters,state}, battery?, requiresMedicalHelp, requiresPoliceHelp, ai?}` → 201 `{emergencyId: "IQ-XXXXXXXX", clientFeedback:{vibrationPatternMs:[120,60,180]}}`; vibration is executed locally by the client |
| POST | `/emergencies/:id/safe-ping` | Owner of an active emergency broadcasts an all-safe family notification; → `{notifiedCount, createdAt}` and SSE `family_safe_ping` |
| POST | `/emergencies/:id/sitrep` | Owner-only `{text}` (≤280 chars), encrypted at rest; → `{id, encrypted:true, createdAt}` and SSE metadata event |
| GET | `/emergencies/:id/sitreps` | Owner-only decrypted notes for the emergency |
| POST | `/emergencies/:id/resolve` | signed RESOLUTION packet; `resolvedHow: USER_SAFE\|USER_CANCELLED\|RESPONDER`; → `{status:"RESOLVED", clientFeedback:{state:"DISARMED", vibrationPatternMs:[60,40,60]}}` |
| GET | `/emergencies?limit=` | own history |

## check-ins
`POST /check-ins` `{status: SAFE|AT_RISK|NEEDS_HELP, note?, lat?, lon?}` ·
`GET /check-ins/family-status` — latest per linked family member.

## sync (offline-first, §47)
| Method | Path | Notes |
|---|---|---|
| POST | `/sync/push` | `{events: [...], packets: [...]}` idempotent — replays never duplicate |
| GET | `/sync/pull?cursor=&limit=` | delta since the `created_at` cursor |
| POST | `/sync/ack` | mark delivery states |

## responders (§18, RBAC)
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/responders/nearby?lat&lon&radius_m=` | user | distance-sorted, ≤50, haversine — server view; BLE on phones `[R]` |
| GET | `/responders/feed` | responder/admin | active emergencies (profile snapshot redacted), broadcasts, check-ins |
| POST | `/responders/ack` | responder/admin | `{emergencyId, note?}`; unique per responder |
| GET | `/responders/acks/:emergencyId` | user | ACK list |
| POST | `/responders/seed` | user | demo responders (dev) |

## broadcasts (§26) — responder/admin
`POST /broadcasts` `{mode, message, priority?, lat?, lon?, radiusM?, ttlMinutes(5-1440)}` ·
`GET /broadcasts` (any user; only unexpired) · `POST /broadcasts/:id/cancel`.

## missing-persons (§27)
`POST /missing-persons` (authorized) `{personName, description?, clothing?, lastSeenAt, lastLat?, lastLon?, contactPhone, photo?}` — consent + legal controls; **no automatic facial recognition, ever**.
`GET /missing-persons` (open reports) · `POST /missing-persons/:id/status` `{status: FOUND|CANCELLED}`.

## resources
`GET /resources/nearby?lat=&lon=&limit=` — verified demo resource points ranked nearby;
includes `MEDICAL` hospitals, `POLICE` stations, shelters, safe zones, water, and supplies.
The dataset is explicitly seed/demo data, not a live government feed.

## sitreps
`POST /sitreps` (authenticated) `{kind, text, lat?, lon?}` · `GET /sitreps` (public,
newest first; optional `kind` filter). Public reads are intentional so safety bulletins
remain visible without an account.

## simulator (§51) — demo only
`POST /sim/engine` `{links:[{a,b,lossRate?}], batteryPercent}` (resets topology) ·
`POST /sim/inject` `{from, emergencyId: /^IQ-[0-9A-Z]{6,12}$/, message?, priority?, battery?}` — settles the flood before responding ·
`GET /sim/state` → `{nodes, deliveries, timeline, stats}` ·
`POST /sim/link/down` `/sim/link/up` `{a,b}` · `POST /sim/battery` `{nodeId,battery}` ·
`POST /sim/sweep` · `POST /sim/relay-readiness` (§37) · `POST /sim/verify` (signature check).

## realtime (SSE)
`GET /realtime/stream?token=<JWT>` (EventSource can't set headers).
Events: `hello`, `mesh_event` (`{id, emergencyId, type: ORIGINATED|DELIVERED|SYNCED|FAMILY_NOTIFIED, from, to, hopCount?, priority?, ts}`),
`mesh_delivery`, `mesh_expired`, `responder_ack`, `disaster_broadcast`, `broadcast_cancelled`,
`missing_person_update`, `sim_topology`, `sim_injected`, `sim_link`.

## Rate limits
auth: 10/min/IP · api: 120/min/IP. 429 → `{error: "too many auth attempts, slow down"}`.
