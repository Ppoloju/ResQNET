# ResQNET — Offline AI Emergency Mesh Network

> **iQOO Hackathon 2026** | No Internet Emergency Mode Application

When an emergency strikes, communication becomes the biggest barrier to getting help.
Network outages, poor connectivity during disasters, or remote locations can prevent
people from reaching emergency services or their families.

**ResQNET** is an offline-first, AI-powered emergency communication application that keeps
people connected and coordinated even when internet and cellular networks are unavailable.
It creates a device-to-device emergency network, allowing users to communicate with nearby
devices without depending on traditional network infrastructure.

> **What ResQNET is NOT:** It does not magically contact police or hospitals outside radio
> range. ResQNET propagates emergency information through nearby participating devices and
> synchronizes with responder infrastructure when a communication gateway becomes available.
> It augments emergency response; it does not replace official emergency services.

## 3-Mode Architecture

ResQNET operates in three distinct modes, adapting its behavior to the situation:

### Normal Mode
- Standard app usage with minimal resource consumption
- Secure family circle and emergency profile storage
- Periodic relay-readiness checks

### Emergency Mode
- Triggered by **SOS button** or **AI detection** (fall, accident, distress signals)
- Device-to-device mesh for multi-hop SOS alerts
- Shares emergency profile + location with trusted contacts
- Prioritizes critical alerts using local AI classification
- Real-time black-box timeline of every action

### Disaster Mode
- Activated when multiple emergencies detected in a region or disaster signals identified
- **Community mesh expansion**: devices form a larger ad-hoc network for group coordination
- **Resource mapping**: nearby hospitals, police stations, shelters, safe zones, water, and supply points from reviewed local data
- **Crowdsourced situational awareness**: community bulletins and location-tagged reports are supported; sensor fusion requires native hardware
- **Priority routing**: critical alerts (injuries, trapped) get bandwidth priority
- **Offline disaster bulletin**: updates propagate through mesh (e.g., "Bridge collapsed", "Shelter open at school")
- **AI assistant**: guides basic first aid and evacuation steps; emergency-service feeds remain a production integration

## Quickstart

```bash
# 1) install everything (npm workspaces: backend, frontend, shared)
npm install

# 2) run backend (http://localhost:4000) and frontend (http://localhost:5173)
npm run dev:backend
npm run dev:frontend   # second terminal

# 3) run all tests (current counts are recorded in implementation.md: crypto, mesh scenarios, gateway sync, RBAC,
#    field encryption, AI classifier, replay cache, Ed25519 keys, offline sync,
#    profile conflicts, SOS UI incl. offline→online drain)
npm test

# 4) build the Netlify frontend
npm run build -w shared && npm run build -w frontend
```

Environment: copy `.env.example` to `.env`. Generate backend secrets with
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

## Repository Layout

```
ResQNET/
├── backend/    Express + SQLite (node:sqlite) + auth + mesh simulator
├── frontend/   React PWA (SOS, AI assist, family, live family map, network map,
│               responders, history/black box, demo mode, missing person, settings)
├── shared/     Packet schema, canonical JSON + HMAC signing, validation rules,
│               on-device AI classifier/triage, geo + relay-readiness helpers
├── database/   schema.sql (v2: 18 tables incl. notifications, responder_acks)
├── netlify.toml  Netlify build, SPA fallback, and frontend publish directory
├── docs/       architecture, api-contract, security, offline-network,
│               ai-architecture, demo
├── idea.html   visual pitch of the complete idea
└── implementation.md  ← live progress tracker (read this first)
```

## Core Features (Implemented)

### 0. Accounts with Two-Step Email Verification
Register with email + password (Argon2id-hashed in the backend SQLite DB) → a 6-digit code
is emailed to verify the address → every sign-in requires a second emailed code (2FA).
Password reset (forgot-password) and in-app password change both arrive by email code, and
every password change triggers a confirmation email. Any SMTP provider works via env vars
(`SMTP_HOST/PORT/USER/PASS/FROM`); with SMTP unset (local dev) codes are echoed as
`devCode` and printed in the server console — never fabricated elsewhere.

### 0.5 Live Map + Real-Time Emergency Feed
Home shows a real map (Leaflet + OpenStreetMap tiles, free, no API key): your exact GPS
(`watchPosition`, ±meters accuracy circle) plus every other active emergency as a live
marker. Emergency creation, ACKs and resolutions fan out over SSE to ALL devices
instantly — phones without accounts see the public safety feed too. The initial feed
loads from `GET /api/emergencies/feed/public`; after that everything arrives in real time.

### 1. Emergency Profile
User creates an emergency profile during registration containing essential information:
name, age, blood group, medical conditions, allergies, accessibility needs. Information is
shared during emergency with **consent-gated visibility tiers** (Private / Family /
Responders / Nearby helpers). Medical fields are **AES-256-GCM encrypted at rest**.

### 2. Family Circle
Users create a family circle with contacts stored with name, relationship, phone, emergency
priority (1-3, with 1 highest), and trusted-contact status. During an emergency, the system
prioritizes these contacts for notification. Live check-in statuses (SAFE / AT RISK / NEEDS HELP)
are available for linked accounts.

### 3. SOS Button
The central emergency feature with 3-2-1 countdown and cancel. When activated:
- Application immediately enters emergency mode
- GPS location + battery snapshot captured with honest accuracy
- Emergency packet signed with HMAC-SHA256 (tamper-proof)
- Nearby devices discovered and alerts relayed hop-by-hop
- Works **without an account** using anonymous on-device identity
- Offline outbox with automatic sync on reconnect

### 4. Local AI Emergency Detection
On-device rule-based classifier: typed or voice-transcribed description → category ×
severity × confidence × recommended action. Fully offline, consent-first mic with
persistent RECORDING indicator. AI identifies: accidents, distress signals, fire, medical
emergencies, dangerous environments. Voice recognition depends on browser support.

### 5. Quick Help Triage and Family Map
Need Help uses fixed quick actions rather than duplicating the full AI Assistance page:
lost/navigation requests open the live Family Map, high-risk medical or safety requests
recommend SOS, and general assistance opens the dedicated AI guidance page. The Family Map
uses Leaflet/OpenStreetMap tiles, live device geolocation, backend-linked family check-ins,
and nearby resource pins ranked by distance. Hospitals, police stations, shelters, and aid
points can open in Google Maps. OpenStreetMap tiles require connectivity; family/resource
data remains sourced from the ResQNET backend.

### 6. Person-to-Person Communication
Device-to-device relay mechanism:
```
Person in danger → Nearby User → Another User → Emergency Contact/Responder
```
Multi-hop store-and-forward with duplicate detection, TTL + hop limits, per-hop ACKs,
priority-based retries, and battery-aware relay tiers. The routing behavior is fully
implemented and tested in the deterministic mesh simulator. The browser PWA's Bluetooth
adapter is a foreground prototype: Web Bluetooth permits a user-selected GATT connection,
but does not provide background advertising/scanning or a 100-device relay network. True
person-to-person multi-hop over Bluetooth requires a native Android/iOS transport with
advertising, discovery, peer sessions, packet forwarding, and persistent relay service.

### 7. Intelligent Emergency Prioritization
Local AI classifies urgency:
- **CRITICAL**: Accident, severe distress, fire
- **HIGH**: Medical emergency, unsafe situation
- **NORMAL**: Request for assistance

Battery-aware relay: >50% relay all · 20–50% HIGH+ only · <20% CRITICAL-only.
Reception is never blocked.

### 8. Privacy & Security
- Passwords: **Argon2id** (bank-grade hashing)
- Packets: **HMAC-SHA256** signed, ±5 min anti-replay window
- Medical fields: **AES-256-GCM** encrypted at rest, consent-gated
- Public device IDs (`RQ_NODE_XXXX`) carry zero personal data
- Ed25519 device keys as upgrade path from HMAC
- Light / dark / system theme; phone-first UI with burger nav + 48 px touch targets
- Audit log: append-only, structured, with secret/medical redaction
- Spam protection: duplicate checks, expiry, hop limits, rate limits

## Honest Status

| Capability | Status |
|---|---|
| SOS core, profile, family, offline queue, sync, packet crypto | **Implemented** |
| Mesh routing logic (dedupe/TTL/ACK/retry/battery) | **Implemented + tested (simulation)** |
| Normal + Emergency modes (derived mode + banner + reason) | **Implemented** |
| Disaster Mode (derivation, priority routing, sitreps, resource map, AI guidance) | **Implemented** |
| Quick Help triage (map / SOS / AI guidance routing) | **Implemented + tested** |
| Family Map (Leaflet/OpenStreetMap, live location, family/resource pins) | **Implemented** — resource data is reviewed seed data, not a live government feed |
| Mesh over real radios | **Prototype** — Web Bluetooth foreground single-peer link; no real 100-node relay |
| Background BLE, Wi-Fi Direct/Near | **Requires native mobile client** |
| Confidential end-to-end packet encryption | **Requires key exchange/native transport integration**; current HMAC is integrity/authentication, not encryption |
| Direct police/hospital integration | **Requires Production Integration** |
| Responder dashboard, demo mode, network map, AI assist | **Implemented** |
| Situations page (community bulletins + nearby resources) | **Implemented** |
| Relay Hero (iQOO backbone relay + hardware endurance tiers) | **Implemented [P]** — engine + Settings + Network UI |

## Netlify + API deployment

Netlify deploys the Vite PWA from `frontend/dist` using `netlify.toml`. Set the
Netlify environment variable `VITE_API_URL` to the public HTTPS URL of the separately
deployed Express backend, for example `https://api.example.com/api`.

The backend requires a persistent filesystem for SQLite, long-lived SSE connections,
and Node's `node:sqlite`; deploy it as a persistent Node service (Railway is the
selected target) with `DATABASE_PATH=/app/data/iqoo.sqlite` or an equivalent persistent
volume. Netlify Functions are not a drop-in replacement for this backend because they
do not provide the required persistent SQLite process or reliable long-lived SSE path.
See **docs/deployment.md** for the complete Netlify/Railway variable and provider guide.

## Tech Stack (Free/Open-Source Only)

React 18 · Vite · TypeScript · Express · `node:sqlite` · Argon2id · JWT · WebCrypto HMAC ·
Leaflet/OpenStreetMap · pino · zod · vitest · Netlify + Railway deployment. No paid APIs,
services, models, or hosting anywhere in the dependency tree.

## Optimized for iQOO

ResQNET is designed to leverage iQOO hardware capabilities:
- **Snapdragon processor**: powers on-device AI classification without cloud dependency
- **Large battery (6000–7600 mAh)**: sustains mesh relay operations for extended emergency scenarios
- **Vapour cooling**: prevents thermal throttling during sustained emergency mesh operations
- **5G + Bluetooth**: dual connectivity for gateway sync and device-to-device mesh

## Contributing (For First-Timers)

We welcome contributions! If this is your first time contributing to an open-source project, follow these steps:

### 1. Create a Branch
Always create a new branch for your work. Don't commit directly to `main`.
```bash
# Make sure you have the latest code
git pull origin main

# Create and switch to a new branch (name it after what you're doing)
git checkout -b feature/disaster-mode
# or for a bug fix:
git checkout -b fix/login-crash
```

### 2. Write Good Commit Messages
We follow **Conventional Commits**. This means your commit messages should start with a specific keyword:
- `feat`: A new feature (e.g., `feat: add AI first-aid assistant`)
- `fix`: A bug fix (e.g., `fix: resolve crash when offline`)
- `docs`: Documentation updates (e.g., `docs: update readme instructions`)
- `style`: Formatting, missing semi-colons, etc.
- `refactor`: Code changes that don't add features or fix bugs

**Example of a good commit:**
```bash
git commit -m "feat(mesh): add disaster mode routing logic"
```

### 3. Create a Pull Request (PR)
Once you're done coding and testing:
```bash
# Push your branch to GitHub
git push origin your-branch-name
```
Then, go to the GitHub repository in your browser. You'll see a green **"Compare & pull request"** button. Click it, describe what you changed, and submit your PR!

---

*Built for [iQOO Hackathon 2026](https://iqoo.reskilll.com/) — because when the network dies, the people around you are the network.*
