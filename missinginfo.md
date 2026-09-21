# ResQNET Missing Information

## Missing / Incomplete

### 1. Real phone-to-phone mesh

**Status:** Requires native mobile integration.

The web PWA does not provide a production mesh between phones. Web Bluetooth is foreground-only and single-peer. The application does not currently provide:

- [ ] Native Android/iOS transport client
- [ ] Background BLE advertising
- [ ] Background BLE scanning
- [ ] Persistent packet forwarding
- [ ] Wi-Fi Direct or Wi-Fi Aware
- [ ] Boot-persistent SOS monitoring
- [ ] A 100-device relay network
- [x] Shared native mesh frame protocol and Android/iOS transport boundary

The deterministic mesh engine proves routing behavior in simulation, but real radio forwarding requires a native Android/iOS client.

References: `implementation.md`, `docs/offline-network.md`

### 2. SMS, push, and emergency-service integrations

**Status:** Delivery infrastructure implemented; provider integrations still required.

Family notifications use database rows and Server-Sent Events, with queued external delivery through configured webhooks. The following provider-specific integrations are still missing:

- [ ] SMS delivery
- [ ] Mobile push notifications
- [ ] Police or ambulance dispatch integration
- [ ] Hospital integration
- [ ] Government emergency-service feeds
- [x] Backend delivery queue, retry state, audit fields, and webhook adapters

References: `docs/deployment.md`, `docs/architecture.md`

### 3. Offline check-ins are not actually queued

**Status:** Implemented.

The Home and Family pages show offline retry language, but safety check-ins call the backend directly. When the request fails offline, the check-in is not added to the SOS outbox or a dedicated retry queue.

Required improvement:

- [x] Store failed check-ins locally
- [x] Retry check-ins when connectivity returns
- [x] Deduplicate check-in submissions
- [x] Show queued and synced states clearly

Affected areas:

- `frontend/src/pages/Home.tsx`
- `frontend/src/pages/Family.tsx`

### 4. Medical ID is incomplete

**Status:** Partially implemented.

The backend profile supports more fields than the Medical ID card and QR payload currently display. Missing from the quick Medical ID include:

- [x] Blood group
- [x] Emergency contacts
- [x] Accessibility needs
- [x] Emergency notes
- [x] Consent and visibility status

The current Medical ID mainly includes name, age, gender, allergies, medications, and conditions.

Affected areas:

- `frontend/src/state/medicalProfile.ts`
- `frontend/src/components/MedicalCard.tsx`
- `frontend/src/pages/Profile.tsx`

### 5. Unsafe production secret fallbacks

**Status:** Development fallback retained; production validation implemented.

The backend uses `change-me-local-only` as a fallback for `JWT_SECRET` and `MSG_SIGNING_PEPPER`. Production startup should fail if secure secrets are not provided instead of silently using development credentials.

Required improvement:

- [x] Allow development fallbacks only in development
- [x] Fail production startup when secrets are missing
- [x] Validate minimum secret length
- [x] Add safe startup diagnostics without printing secret values

Affected area:

- `backend/src/config.ts`

### 6. Connectivity status is not fully end-to-end

**Status:** Backend probing implemented.

The global status bar relies on `navigator.onLine`. That value only describes the operating system network state and does not guarantee that the backend is reachable.

Required improvement:

- [x] Probe `/healthz` periodically
- [x] Distinguish internet availability from backend reachability
- [x] Show stale, offline, and syncing states separately
- [x] Avoid claiming ONLINE when the API cannot be reached

Affected area:

- `frontend/src/state/StatusContext.tsx`

### 7. Sensor-based disaster detection

**Status:** Not implemented in the web application.

The application does not currently provide native sensor fusion for:

- [ ] Fall detection
- [ ] Accelerometer or gyroscope events
- [ ] Smoke detection
- [ ] Noise or crowd detection
- [ ] Background distress monitoring
- [ ] Device thermal or environmental sensors

The current AI implementation is deterministic text and optional voice classification. Native sensor monitoring remains a production integration.

Reference: `docs/ai-architecture.md`

### 8. Live emergency resource data

**Status:** Demo-only dataset.

Hospitals, police stations, shelters, safe zones, water points, and supplies come from a reviewed seed dataset. The application does not currently consume live government or emergency-service feeds.

Required improvement:

- [ ] Live hospital data feed
- [ ] Live police data feed
- [ ] Live shelter and aid-point data feed
- [ ] Government or emergency-service resource integration

Affected areas:

- `backend/src/routes/resources.ts`
- `frontend/src/pages/FamilyMap.tsx`

### 9. End-to-end packet encryption

**Status:** Not implemented for physical mesh transport.

HMAC provides integrity and sender authentication, but it does not encrypt packet contents. Confidential radio payloads need a key exchange and native transport encryption layer.

Required improvement:

- [ ] Key exchange for mesh peers
- [ ] Encrypted packet payloads over physical mesh transports
- [ ] Native transport encryption integration

Reference: `docs/security.md`

### 10. Production deployment hardening

**Status:** Documented but not complete.

Before production deployment, the application still needs:

- [ ] HTTPS/TLS termination
- [ ] Secure production secrets
- [ ] Key rotation and secret management
- [ ] Horizontal scaling beyond SQLite single-node storage
- [ ] Operational monitoring and alerting
- [ ] Backup and recovery procedures
- [ ] Production database migration strategy

Reference: `docs/deployment.md`

## Already Implemented

The following areas are implemented and tested:

- [x] SOS activation and resolution
- [x] Offline emergency outbox and reconnect sync
- [x] Emergency profile CRUD
- [x] Medical-field encryption at rest
- [x] Family circle management
- [x] Responder dashboard and acknowledgements
- [x] Simulated mesh routing with deduplication, TTL, ACKs, retries, and battery tiers
- [x] Local AI triage and first-aid guidance
- [x] Disaster broadcasts and community bulletins
- [x] Family map with OpenStreetMap and resource markers
- [x] Missing-person reports with human-reviewed matching
- [x] Server-Sent Events realtime updates
- [x] History and emergency black-box timeline
- [x] Netlify frontend deployment packaging

## Priority Order

- [ ] 1. Native mobile transport for background BLE and Wi-Fi Direct
- [x] 2. Real offline queue for check-ins and other non-SOS actions
- [ ] 3. Production secret validation and HTTPS deployment
- [ ] 4. SMS and push notification bridges
- [x] 5. Complete Medical ID fields and disclosure controls
- [x] 6. Backend health probing in the global connectivity indicator
- [ ] 7. Live emergency-resource feeds
- [ ] 8. Native sensor fusion
- [ ] 9. End-to-end mesh payload encryption
- [ ] 10. Horizontal scaling and operational hardening
