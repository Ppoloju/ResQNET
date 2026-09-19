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

## 🏗️ 3-Mode Architecture

ResQNET operates in three distinct modes, adapting its behavior to the situation:

### 🟢 Normal Mode
- Standard app usage with minimal resource consumption
- Background monitoring of sensors (low power)
- Family circle and emergency profile stored securely
- Periodic relay-readiness checks

### 🔴 Emergency Mode
- Triggered by **SOS button** or **AI detection** (fall, accident, distress signals)
- Device-to-device mesh for multi-hop SOS alerts
- Shares emergency profile + location with trusted contacts
- Prioritizes critical alerts using local AI classification
- Real-time black-box timeline of every action

### 🟠 Disaster Mode
- Activated when multiple emergencies detected in a region or disaster signals identified
- **Community mesh expansion**: devices form a larger ad-hoc network for group coordination
- **Resource mapping**: AI identifies safe zones, shelters, medical aid points from local data
- **Crowdsourced situational awareness**: each device contributes sensor data to build a disaster map
- **Priority routing**: critical alerts (injuries, trapped) get bandwidth priority
- **Offline disaster bulletin**: updates propagate through mesh (e.g., "Bridge collapsed", "Shelter open at school")
- **AI assistant**: guides basic first aid, evacuation steps, connects survivors to nearest responders

## ⚡ Quickstart

```bash
# 1) install everything (npm workspaces: backend, frontend, shared)
npm install

# 2) run backend (http://localhost:4000) and frontend (http://localhost:5173)
npm run dev:backend
npm run dev:frontend   # second terminal

# 3) run all tests (65+ passing: crypto, mesh scenarios, gateway sync, RBAC,
#    field encryption, AI classifier, replay cache, Ed25519 keys, offline sync,
#    profile conflicts, SOS UI incl. offline→online drain)
npm test

# 4) production-like run with Docker
docker compose -f docker/docker-compose.yml up --build
```

Environment: copy `.env.example` to `.env`. Generate secrets with
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

## 📁 Repository Layout

```
ResQNET/
├── backend/    Express + SQLite (node:sqlite) + auth + mesh simulator
├── frontend/   React PWA (SOS, AI assist, family, network map, responders,
│               history/black box, demo mode, missing person, settings)
├── shared/     Packet schema, canonical JSON + HMAC signing, validation rules,
│               on-device AI classifier, geo + relay-readiness helpers
├── database/   schema.sql (v2: 18 tables incl. notifications, responder_acks)
├── docker/     docker-compose.yml + backend.Dockerfile (node:24-alpine)
├── docs/       architecture, api-contract, security, offline-network,
│               ai-architecture, demo
├── idea.html   visual pitch of the complete idea
└── implementation.md  ← live progress tracker (read this first)
```

## 🔥 Core Features (Implemented)

### 1. Emergency Profile
User creates an emergency profile during registration containing essential information:
name, age, blood group, medical conditions, allergies, accessibility needs. Information is
shared during emergency with **consent-gated visibility tiers** (Private / Family /
Responders / Nearby helpers). Medical fields are **AES-256-GCM encrypted at rest**.

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
emergencies, dangerous environments.

### 5. Person-to-Person Communication
Device-to-device relay mechanism:
```
Person in danger → Nearby User → Another User → Emergency Contact/Responder
```
Multi-hop store-and-forward with duplicate detection, TTL + hop limits, per-hop ACKs,
priority-based retries, and battery-aware relay tiers.

### 6. Intelligent Emergency Prioritization
Local AI classifies urgency:
- **CRITICAL**: Accident, severe distress, fire
- **HIGH**: Medical emergency, unsafe situation
- **NORMAL**: Request for assistance

Battery-aware relay: >50% relay all · 20–50% HIGH+ only · <20% CRITICAL-only.
Reception is never blocked.

### 7. Privacy & Security
- Passwords: **Argon2id** (bank-grade hashing)
- Packets: **HMAC-SHA256** signed, ±5 min anti-replay window
- Medical fields: **AES-256-GCM** encrypted at rest, consent-gated
- Public device IDs (`IQOO_NODE_XXXX`) carry zero personal data
- Ed25519 device keys as upgrade path from HMAC
- Light / dark / system theme; phone-first UI with burger nav + 48 px touch targets
- Audit log: append-only, structured, with secret/medical redaction
- Spam protection: duplicate checks, expiry, hop limits, rate limits

## 📊 Honest Status

| Capability | Status |
|---|---|
| SOS core, profile, family, offline queue, sync, packet crypto | **Implemented** |
| Mesh routing logic (dedupe/TTL/ACK/retry/battery) | **Implemented + tested (simulation)** |
| Normal + Emergency modes (derived mode + banner + reason) | **Implemented** |
| Disaster Mode (derivation, priority routing, sitreps, resource map, AI guidance) | **Implemented** |
| Mesh over real radios | **Prototype** — Web Bluetooth foreground only |
| Background BLE, Wi-Fi Direct/Near | **Requires native mobile client** |
| Direct police/hospital integration | **Requires Production Integration** |
| Responder dashboard, demo mode, network map, AI assist | **Implemented** |
| Situations page (community bulletins + nearby resources) | **Implemented** |
| Relay Hero ⚡ (iQOO backbone relay + hardware endurance tiers) | **Implemented [P]** — engine + Settings + Network UI |

## 🐳 Docker (Verified End-to-End)

```bash
docker compose -f docker/docker-compose.yml up -d --build
# → frontend app:  http://localhost:8080   (nginx: SPA + /api proxy + SSE + /healthz)
# → backend API:   http://localhost:4000/healthz
```

Verified: images build on node:24-alpine, stack boots healthy, full demo path runs
inside the container, and the API is reachable same-origin through the frontend
(register → sitrep post → resources nearby all smoke-tested through nginx).
See **docs/deployment.md** for the full guide (env, secrets, production boundary).

## 🛠️ Tech Stack (Free/Open-Source Only)

React 18 · Vite · TypeScript · Express · `node:sqlite` (no native builds) · Argon2id ·
JWT · WebCrypto HMAC · pino · zod · vitest · Docker (node:24-alpine). No paid APIs,
services, models, or hosting anywhere in the dependency tree.

## 📱 Optimized for iQOO

ResQNET is designed to leverage iQOO hardware capabilities:
- **Snapdragon processor**: powers on-device AI classification without cloud dependency
- **Large battery (6000–7600 mAh)**: sustains mesh relay operations for extended emergency scenarios
- **Vapour cooling**: prevents thermal throttling during sustained emergency mesh operations
- **5G + Bluetooth**: dual connectivity for gateway sync and device-to-device mesh

## 🤝 Contributing (For First-Timers)

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
