# IQOO Offline Network

## Delay-tolerant networking (§42) as the central concept

```text
Device unavailable           → packet stored at sender (outbox / sim node outbox)
Link restored / node appears → store-and-forward flush
Hop by hop                   → dedupe + ACK + TTL + priority retries
Gateway reached              → REAL backend write (gatewaySync)
Connectivity returns         → offline outbox syncs idempotently
```

A message is never dropped just because the network is down — it waits.

## Packet lifecycle

1. **Create** — client builds `EmergencyPacket` (id, type, severity, timestamp,
   location, battery, TTL, hopCount, requiresMedicalHelp/police, optional AI
   result), signs it (HMAC-SHA256 canonical JSON).
2. **Validate** — shared `validatePacket`: schema, TTL ≤ 6 h, hops ≤ 8,
   timestamp skew ≤ ±5 min, location sanity.
3. **Transmit** — online+authed: `POST /emergencies`; else local outbox.
4. **Relay (simulated links [P], real logic)** — MeshEngine floods to
   neighbors: dedupe (`seen` set), per-hop ACK back, priority-based retries
   (CRITICAL 3, HIGH 2, else 1) with exponential backoff, hop-limit stop.
5. **Store-and-forward** — link down → packet queued at sender
   (`STORED_FOR_FORWARD`), flushed on link-up (`OUTBOX_FLUSH`).
6. **Expire** — TTL check on every hop and sweep; expired packets removed.
7. **Gateway** — reaches GATEWAY → real DB row + family notification fan-out.

## Battery-aware relay tiers (§29, configurable via env)

| Battery | Behavior |
|---|---|
| > 50 % | normal relay (all priorities) |
| 20–50 % | reduced relay (CRITICAL + HIGH only) |
| < 20 % | CRITICAL-only; reception never blocked |

Implementation: `relayAllows(battery, priority)` in the engine; UI mirrors the
same rules in Relay Readiness.

## Relay Readiness (§37)

A local, privacy-preserving self-assessment (`shared/src/net.ts`): consent,
foreground state, battery, gateway reachability → 0-100 score + tier + a
human-readable reason. Exposed to the user on the Network page and used to
decide relay behavior. Nothing sensitive is transmitted.

## Transports (§35)

```text
CommunicationManager (shared interface)
 ├── InternetTransport      ✅ REST + SSE (implemented)
 ├── LocalNetworkTransport  ✅ via backend/simulator (same API shape)
 ├── BluetoothTransport     [P] simulated in MeshEngine; [R] native BLE needed
 └── WifiDirectTransport    [R] requires OS-level support (native module)
```

The application never depends on one transport: routing decisions read from
the packet (priority, TTL) and device context (battery, consent), not from a
specific radio.

## Anti-spam summary (§33)

TTL + hop limit + duplicate suppression + signature verification at every hop +
priority gating + rate limits + invalid-packet rejection (`REJECTED_INVALID`,
`REJECTED_EXPIRED` timeline events). A malicious device cannot keep a packet
alive past its TTL, cannot replay old ones past the skew window, and cannot
flood beyond per-IP/per-route rate limits on the gateway path.
