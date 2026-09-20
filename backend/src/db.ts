// SQLite via Node's built-in node:sqlite (no native module compile — works on
// Windows dev and Alpine Docker with zero build tooling; §1 free-only constraint).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DATABASE_PATH ?? './data/iqoo.sqlite';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// db.js sits one level below backend/ both in src (backend/src) and dist (backend/dist),
// so repo root is exactly two levels up from this module in both cases.
const schemaPath = path.resolve(__dirname, '../../database/schema.sql');
db.exec(fs.readFileSync(schemaPath, 'utf8'));

// Expand legacy notification rows without losing existing SSE delivery state.
const notificationColumns = db.prepare('PRAGMA table_info(notifications)').all() as Array<{ name: string }>;
if (notificationColumns.length > 0 && !notificationColumns.some((column) => column.name === 'attempts')) {
  db.exec('ALTER TABLE notifications RENAME TO notifications_legacy');
  db.exec(`CREATE TABLE notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    emergency_id TEXT NOT NULL REFERENCES emergency_events(id) ON DELETE CASCADE,
    family_member_id TEXT REFERENCES family_members(id) ON DELETE SET NULL,
    channel TEXT NOT NULL DEFAULT 'MESH' CHECK (channel IN ('MESH','SSE','SMS','PUSH','EMERGENCY_SERVICE')),
    delivery_state TEXT NOT NULL DEFAULT 'PENDING' CHECK (delivery_state IN ('PENDING','SENT','DELIVERED','FAILED')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TEXT,
    provider_error TEXT,
    created_at TEXT NOT NULL,
    delivered_at TEXT
  )`);
  db.exec(`INSERT INTO notifications
    (id, user_id, emergency_id, family_member_id, channel, delivery_state, created_at, delivered_at)
    SELECT id, user_id, emergency_id, family_member_id, channel, delivery_state, created_at, delivered_at
    FROM notifications_legacy`);
  db.exec('DROP TABLE notifications_legacy');
}

// Older development databases may already have the template-only settings
// columns. Add the functional relay columns without requiring data loss.
for (const column of [
  'relay_consent INTEGER NOT NULL DEFAULT 1',
  'low_power_mode INTEGER NOT NULL DEFAULT 0',
  'critical_threshold_pct INTEGER NOT NULL DEFAULT 20',
  'relay_hero_mode INTEGER NOT NULL DEFAULT 0',
]) {
  try { db.exec(`ALTER TABLE device_settings ADD COLUMN ${column}`); } catch { /* already present */ }
}

/**
 * better-sqlite3-style synchronous transaction helper.
 * Runs fn inside BEGIN/COMMIT; rolls back on throw.
 */
export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
