# ResQNET Security Model

## Threats addressed

| Threat | Mitigation | Status |
|---|---|---|
| Credential theft | Argon2id password hashing (never plaintext), generic 401s | ✅ |
| Session abuse | Signed JWTs (HS256), 24h expiry, role claim | ✅ |
| Packet forgery | HMAC-SHA256 over canonical JSON with per-device secret | ✅ |
| Replay | ±5 min clock-skew window + emergency dedupe by id (§33/§47) | ✅ |
| Flooding | TTL ≤ 6h, ≤ 8 hops, duplicate suppression, rate limits (10/min auth, 120/min API) | ✅ |
| Medical data exposure | AES-256-GCM field encryption at rest + consent gate + visibility tiers + log redaction | ✅ |
| Malicious relay | Signature verification and battery-tier relay gating in the simulator; native relay verification remains required | [P/R] |
| Privilege escalation | RBAC (`user`/`responder`/`admin`) enforced per-route | ✅ |
| Privacy leak over radio | Anonymous `RQ_NODE_XXXX` aliases, rotation-ready (§34) | ✅ |
| Tamper evidence | Append-only audit log with per-actor rows | ✅ |

## Keys and secrets

- `JWT_SECRET` — HS256 signing of sessions (required in production).
- `MSG_SIGNING_PEPPER` — server-side packet counter-signature + **derived via
  scrypt (N=16384) into the AES-256-GCM field-encryption key**. Rotation plan:
  re-encrypt on next profile save (envelope is versioned `enc:v1:`); production
  swap: KMS-managed key + dual-read migration window (documented for the
  hackathon as env-managed).
- Device secret — 64 hex chars, returned once at registration, never leaves the
  client again; used for HMAC packet signing.

## Data protection layers

1. **At rest** — sensitive profile columns (`medical_conditions`, `allergies`,
   `medications`, `emergency_notes`, `photo`) are AES-256-GCM ciphertext.
   Legacy plaintext passes through on read and re-encrypts on next save.
2. **In transit** — HTTPS (TLS) in any real deployment; JWT on every call.
3. **In logs** — pino `redact` on password/token/secret/medical paths; the audit
   middleware records *who/what/action*, never medical payloads.
4. **On the wire (mesh)** — the current simulator and browser prototype carry the
  minimum packet fields: id, type, severity, timestamp, coarse location, battery,
  TTL/hops, and an HMAC signature. HMAC authenticates and detects tampering; it does
  **not** encrypt packet contents. Confidential end-to-end radio payloads require a
  key-exchange protocol and native transport integration before physical mesh launch.

## Emergency-card disclosure rules (§28)

`GET /emergency-profiles/me/card` returns only the permitted field set and
honors two independent gates:
- visibility tier (PRIVATE → nobody but owner; RESPONDERS → responder role),
- `consentMedicalShare` boolean (strips allergies/conditions/medications even
  for responders when false).

## What is intentionally NOT claimed

- Real BLE/Wi-Fi-Direct multi-hop forwarding and encryption-in-transit are native-layer
  concerns `[R]`; the browser adapter is foreground-only and single-peer.
- SMS/push family fan-out is a production bridge `[R]` (SSE + DB rows now).
- Facial recognition for missing persons is explicitly **not implemented** —
  matching is human-reviewed by design (§27).
