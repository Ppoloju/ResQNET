# ResQNET Demo Guide

## What the demo shows (§52, §63)

**Story:** a trekker is injured where there is no signal. Nearby ResQNET phones
relay the emergency hop-by-hop until it reaches a gateway, which syncs it to
responder infrastructure and notifies family. When connectivity exists, the
same data lands in the backend dashboard.

**Honesty label:** Demo Mode runs the real mesh engine with **simulated radio
links** `[P]` — every packet, signature check, dedupe, ACK, retry, TTL decision
and the gateway's database write are genuine code paths. Nothing is faked
except the Bluetooth hardware itself.

## Run it

```bash
# from repo root
npm install
npm run build            # shared → backend → frontend
npm run dev:backend      # terminal 1 (http://localhost:4000)
npm run dev:frontend     # terminal 2 (http://localhost:5173)
```

For deployment, publish the frontend through Netlify and run the persistent backend
as a separate Node service as described in `docs/deployment.md`.

## Scripted walkthrough (5 minutes)

1. Open the app → **register** a user (this is the "family owner").
2. Add 1–2 family members on the **Family** page (enables step 8's fan-out).
3. Go to **More → Demo Mode** — the banner states clearly that radio links are
   simulated `[P]`.
4. Press **▶ Run demo scenario**. The 9 steps auto-check as live SSE events
   arrive:
   1. topology A→B→C→GATEWAY created
   2. node A has no internet (mesh-only path)
   3. CRITICAL SOS signed and injected at A
   4. B receives (first hop) ✓ *live event*
   5. B relays to C (dedupe prevents loops) ✓ *live event*
   6. gateway receives ✓ *live event*
   7. **real emergency row written to the backend** ✓ *SYNCED event*
   8. family notifications recorded ✓ *FAMILY_NOTIFIED event*
   9. engine timeline updated
5. Open **Network** → watch mesh stats, node roles/batteries, deliveries and
   the engine timeline; try **Chaos controls** on the Demo page (cut A–B →
   packets queue → restore → flush).
6. Sign in as a responder (seed via `POST /api/responders/seed`, or ask an
   admin) → **Responders** dashboard shows the emergency with the
   consent-gated medical card snapshot; press **Acknowledge** — the ACK
   appears for the owner via SSE.
7. Trigger a **real SOS from Home** (offline: turn off wifi first) → see the
   outbox queue, then come back online and watch it sync (History page).

## Judge Q&A

- **Is the Bluetooth real?** No — `[P]` simulated links. The routing layer
  (dedupe/TTL/ACK/retry/battery tiers/store-and-forward) is the production
  code path and is fully unit-tested. Real BLE needs a native client `[R]`.
- **Does it call the police?** No. ResQNET augments emergency response and
  synchronizes with responder infrastructure when a gateway is available; it
  never replaces 100/112/911.
- **Where does medical data go?** Encrypted at rest (AES-256-GCM), only shared
  per visibility tier + consent, redacted in logs, shown to responders only on
  the dashboard with consent granted.
- **What if two devices relay the same packet?** Duplicate suppression —
  demonstrated in the engine timeline and asserted in tests.
- **What happens offline?** Everything: SOS, AI classification, black-box
  timeline, outbox. Sync is idempotent on reconnect.
