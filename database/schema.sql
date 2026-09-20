-- IQOO database schema v1 (SQLite)
-- Design notes:
--  * emergency_profiles.medical_* stored as encrypted blobs when sensitive encryption is enabled (Phase 10).
--  * messages are transport-agnostic: the full packet JSON is kept for relay decisions and audits.
--  * deliveries tracks per-recipient state to make sync idempotent (unique(emergency_id, recipient_device_id)).

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,                -- uuid
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,                   -- argon2id
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','responder','admin')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id             TEXT PRIMARY KEY,               -- uuid
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  platform       TEXT NOT NULL DEFAULT 'web',    -- web|android|ios
  public_id      TEXT NOT NULL UNIQUE,           -- privacy-conscious BLE alias e.g. IQOO_NODE_A7F3
  secret         TEXT NOT NULL,                  -- hex, used for HMAC message signing
  last_seen_at   TEXT,
  created_at     TEXT NOT NULL,
  UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);

CREATE TABLE IF NOT EXISTS device_settings (
  device_id                    TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  relay_consent                INTEGER NOT NULL DEFAULT 1,
  low_power_mode               INTEGER NOT NULL DEFAULT 0,
  critical_threshold_pct       INTEGER NOT NULL DEFAULT 20,
  relay_hero_mode              INTEGER NOT NULL DEFAULT 0,
  updated_at                   TEXT NOT NULL
);

-- ------------------------------------------------------------
-- Emergency profile (§7). Sensitive medical fields are stored
-- encrypted-at-rest when MSG_SIGNING_PEPPER-derived key present;
-- schema keeps TEXT columns now for the hackathon prototype,
-- Phase 10 moves them to encrypted blobs.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS emergency_profiles (
  id                     TEXT PRIMARY KEY,
  user_id                TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name                   TEXT NOT NULL,
  age                    INTEGER,
  gender                 TEXT,
  blood_group            TEXT,
  medical_conditions     TEXT,    -- free text
  allergies              TEXT,
  medications            TEXT,
  emergency_notes        TEXT,
  phone_primary          TEXT,
  phone_secondary        TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  accessibility_needs    TEXT,
  photo                  TEXT,    -- data URL (small) or backend file path
  visibility             TEXT NOT NULL DEFAULT 'PRIVATE'
    CHECK (visibility IN ('PRIVATE','FAMILY','RESPONDERS','NEARBY_HELPERS')),
  consent_medical_share  INTEGER NOT NULL DEFAULT 0,  -- boolean
  updated_at             TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS family_members (
  id             TEXT PRIMARY KEY,
  owner_user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  relation       TEXT NOT NULL CHECK (relation IN
    ('FATHER','MOTHER','BROTHER','SISTER','PARTNER','FRIEND','GUARDIAN','OTHER')),
  phone          TEXT NOT NULL,
  iqoo_account_id TEXT,
  priority       INTEGER NOT NULL DEFAULT 5,     -- 1 = highest
  trusted        INTEGER NOT NULL DEFAULT 0,     -- boolean
  status         TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (status IN ('UNKNOWN','SAFE','AT_RISK','UNREACHABLE')),
  last_seen_at   TEXT,
  last_lat       REAL,
  last_lon       REAL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_family_owner ON family_members(owner_user_id);

CREATE TABLE IF NOT EXISTS emergency_events (
  id            TEXT PRIMARY KEY,                -- IQ-XXXXXXXX emergency id
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,                   -- SOS | QUICK_HELP | DISASTER_BROADCAST | CHECK_IN
  status        TEXT NOT NULL DEFAULT 'ACTIVE'
                CHECK (status IN ('ACTIVE','RESOLVED','EXPIRED','CANCELLED')),
  severity      TEXT NOT NULL DEFAULT 'HIGH' CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  category      TEXT,                            -- MEDICAL | ACCIDENT | FIRE | ... (AI)
  message       TEXT,
  lat           REAL,
  lon           REAL,
  location_state TEXT NOT NULL DEFAULT 'LOCATION_UNAVAILABLE'
                CHECK (location_state IN ('GPS_AVAILABLE','NETWORK_LOCATION_AVAILABLE','LAST_KNOWN_LOCATION','LOCATION_UNAVAILABLE')),
  location_accuracy_m REAL,
  battery       INTEGER,
  network_state TEXT NOT NULL DEFAULT 'OFFLINE',  -- ONLINE | OFFLINE
  emergency_profile_snapshot TEXT,               -- JSON of profile per visibility at send time
  created_at    TEXT NOT NULL,
  resolved_at   TEXT,
  resolved_how  TEXT CHECK (resolved_how IN ('USER_SAFE','USER_CANCELLED','AUTO_EXPIRED','RESPONDER')),
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_user ON emergency_events(user_id);
CREATE INDEX IF NOT EXISTS idx_events_status ON emergency_events(status);

-- ------------------------------------------------------------
-- Mesh messages. `payload` holds the canonical signed packet JSON.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS emergency_messages (
  id            TEXT PRIMARY KEY,                -- packet id (msg_...)
  emergency_id  TEXT NOT NULL REFERENCES emergency_events(id),
  sender_device_id TEXT NOT NULL,                -- device that authored packet (first hop origin)
  type          TEXT NOT NULL CHECK (type IN ('SOS','QUICK_HELP','RESOLUTION','DISASTER_BROADCAST','CHECK_IN','ACK','HEARTBEAT')),
  priority      TEXT NOT NULL DEFAULT 'HIGH' CHECK (priority IN ('CRITICAL','HIGH','MEDIUM','LOW')),
  payload       TEXT NOT NULL,                   -- canonical packet JSON (signed)
  signature     TEXT NOT NULL,
  hop_count     INTEGER NOT NULL DEFAULT 0,
  ttl_expires_at TEXT NOT NULL,
  received_via  TEXT,                            -- transport that delivered it
  created_at    TEXT NOT NULL,
  synced_at     TEXT,
  UNIQUE(id)
);

CREATE INDEX IF NOT EXISTS idx_messages_emergency ON emergency_messages(emergency_id);
CREATE INDEX IF NOT EXISTS idx_messages_sync ON emergency_messages(synced_at);

-- Short private notes attached to an active emergency. Content is encrypted
-- before storage and is only returned through the owning emergency route.
CREATE TABLE IF NOT EXISTS emergency_sitreps (
  id            TEXT PRIMARY KEY,
  emergency_id  TEXT NOT NULL REFERENCES emergency_events(id) ON DELETE CASCADE,
  author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_encrypted TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_emergency_sitreps_emergency ON emergency_sitreps(emergency_id, created_at DESC);

CREATE TABLE IF NOT EXISTS message_deliveries (
  id                TEXT PRIMARY KEY,
  message_id        TEXT NOT NULL REFERENCES emergency_messages(id) ON DELETE CASCADE,
  recipient_device_id TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','DELIVERED','ACKED','FAILED','EXPIRED')),
  transport         TEXT,
  attempts          INTEGER NOT NULL DEFAULT 0,
  last_attempt_at   TEXT,
  acked_at          TEXT,
  UNIQUE(message_id, recipient_device_id)
);

CREATE TABLE IF NOT EXISTS check_ins (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'SAFE' CHECK (status IN ('SAFE','AT_RISK','NEEDS_HELP')),
  note       TEXT,
  lat        REAL,
  lon        REAL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_checkins_user ON check_ins(user_id);

CREATE TABLE IF NOT EXISTS responders (
  id         TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('POLICE','HOSPITAL','AMBULANCE','FIRE','DISASTER_RESPONSE','VOLUNTEER','COMMUNITY')),
  name       TEXT NOT NULL,
  verified   INTEGER NOT NULL DEFAULT 0,
  contact    TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS responder_locations (
  id            TEXT PRIMARY KEY,
  responder_id  TEXT NOT NULL REFERENCES responders(id) ON DELETE CASCADE,
  lat           REAL NOT NULL,
  lon           REAL NOT NULL,
  source        TEXT NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('GPS','OSM_IMPORT','MANUAL','BACKEND')),
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  actor       TEXT NOT NULL,                     -- userId, deviceId, or 'system'
  action      TEXT NOT NULL,
  entity      TEXT,
  entity_id   TEXT,
  detail      TEXT,                              -- redacted JSON
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(created_at);

-- Emergency media (voice/camera snippets) — consent-gated, retention-limited
CREATE TABLE IF NOT EXISTS emergency_media (
  id           TEXT PRIMARY KEY,
  emergency_id TEXT NOT NULL REFERENCES emergency_events(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('AUDIO','IMAGE','TRANSCRIPT')),
  consent      INTEGER NOT NULL DEFAULT 0,
  data         TEXT,                             -- small base64 payload or file path
  created_at   TEXT NOT NULL
);

-- ------------------------------------------------------------
-- Disaster broadcasts (§26): responder/admin messages that flood
-- the mesh. Expiration is mandatory — no eternal warnings.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS emergency_broadcasts (
  id            TEXT PRIMARY KEY,
  source_user_id TEXT NOT NULL REFERENCES users(id),
  mode          TEXT NOT NULL CHECK (mode IN
    ('EVACUATION','SHELTER','MEDICAL','FIRE','FLOOD','EARTHQUAKE','MISSING_PERSON','GENERAL_WARNING')),
  message       TEXT NOT NULL,
  priority      TEXT NOT NULL DEFAULT 'HIGH' CHECK (priority IN ('CRITICAL','HIGH','MEDIUM','LOW')),
  lat           REAL,
  lon           REAL,
  radius_m      REAL,                            -- geographic relevance where possible
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_broadcasts_active ON emergency_broadcasts(expires_at);

-- Missing person reports (§27): created ONLY by authorized users; no automatic
-- facial recognition ever — matching is human-reviewed.
CREATE TABLE IF NOT EXISTS missing_person_reports (
  id               TEXT PRIMARY KEY,
  reporter_user_id TEXT NOT NULL REFERENCES users(id),
  person_name      TEXT NOT NULL,
  description      TEXT,
  clothing         TEXT,
  photo            TEXT,                        -- small data URL; shared only via explicit alert
  last_seen_at     TEXT NOT NULL,
  last_lat         REAL,
  last_lon         REAL,
  contact_phone    TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','FOUND','CANCELLED')),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_missing_status ON missing_person_reports(status);

-- Responder acknowledgements: proof an emergency reached a responder/gateway (§18).
CREATE TABLE IF NOT EXISTS responder_acks (
  id            TEXT PRIMARY KEY,
  emergency_id  TEXT NOT NULL REFERENCES emergency_events(id) ON DELETE CASCADE,
  responder_user_id TEXT NOT NULL REFERENCES users(id),
  note          TEXT,
  created_at    TEXT NOT NULL,
  UNIQUE(emergency_id, responder_user_id)
);

-- Family notification fan-out (§31 Notification, §52 step 8). SENT = pushed to a
-- signed-in family device via SSE; PENDING = queued for sync/sms bridge [R].
CREATE TABLE IF NOT EXISTS notifications (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  emergency_id  TEXT NOT NULL REFERENCES emergency_events(id) ON DELETE CASCADE,
  family_member_id TEXT REFERENCES family_members(id) ON DELETE SET NULL,
  channel       TEXT NOT NULL DEFAULT 'MESH' CHECK (channel IN ('MESH','SSE','SMS')),
  delivery_state TEXT NOT NULL DEFAULT 'PENDING' CHECK (delivery_state IN ('PENDING','SENT','DELIVERED','FAILED')),
  created_at    TEXT NOT NULL,
  delivered_at  TEXT
);

-- Disaster-mode situation reports (§13): human-written bulletins that flow
-- through the mesh and sync at the gateway. Mirrors shared Sitrep shape.
CREATE TABLE IF NOT EXISTS sitreps (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('HAZARD','SHELTER','ROAD','SUPPLIES','RESOLVED')),
  text        TEXT NOT NULL CHECK (length(text) <= 280),
  lat         REAL,
  lon         REAL,
  author_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sitreps_created ON sitreps(created_at DESC);
