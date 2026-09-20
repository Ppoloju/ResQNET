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
