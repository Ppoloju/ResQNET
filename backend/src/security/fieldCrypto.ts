// Field-level encryption-at-rest for sensitive profile data (§7, §32, Phase 10).
//
// AES-256-GCM envelope per field. Key is derived from MSG_SIGNING_PEPPER via scrypt
// (N=16384) — no extra secrets to configure; documented in docs/security.md as an
// env-managed key with a KMS/migration path for production.
//
// Storage format: "enc:v1:<iv_b64>:<tag_b64>:<ciphertext_b64>"
// Plaintext values without the prefix decrypt transparently (migration-friendly),
// so existing rows keep working and old data re-encrypts on next save.

import { createCipheriv, createDecipheriv, scryptSync, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';
const SENSITIVE_FIELDS = [
  'medical_conditions', 'allergies', 'medications', 'emergency_notes', 'photo',
] as const;

export type SensitiveField = (typeof SENSITIVE_FIELDS)[number];

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (!cachedKey) {
    const pepper = process.env.MSG_SIGNING_PEPPER ?? 'change-me-local-only';
    cachedKey = scryptSync(pepper, 'iqoo-field-encryption-v1', 32);
  }
  return cachedKey;
}

function encryptField(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${PREFIX}${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}

function decryptField(stored: string): string | null {
  if (!stored.startsWith(PREFIX)) return null; // legacy plaintext
  try {
    const [ivB64, tagB64, ctB64] = stored.slice(PREFIX.length).split(':');
    const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null; // wrong key or corrupted — fail closed, never throw into route
  }
}

/** True when the stored value is envelope-encrypted. */
export function isEncrypted(stored: string | null | undefined): boolean {
  return typeof stored === 'string' && stored.startsWith(PREFIX);
}

/** Encrypt a sensitive field if it has content. */
export function encryptIfPresent(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length === 0) return null;
  if (isEncrypted(value)) return value; // already encrypted — idempotent
  return encryptField(value);
}

/** Decrypt a sensitive field; returns null when undecryptable (fail closed). */
export function decryptIfEncrypted(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value.length === 0) return null;
  if (!isEncrypted(value)) return value; // legacy plaintext passes through
  return decryptField(value);
}

/**
 * Field-encryption codec for emergency_profiles rows.
 * encryptProfileFields on write, decryptProfileFields on read — medical data
 * never touches the database as plaintext (§32).
 */
export function encryptProfileFields(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  for (const f of SENSITIVE_FIELDS) {
    if (typeof out[f] === 'string' && (out[f] as string).length > 0) {
      out[f] = encryptIfPresent(out[f] as string);
    }
  }
  return out;
}

export function decryptProfileFields(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  for (const f of SENSITIVE_FIELDS) {
    if (typeof out[f] === 'string' && (out[f] as string).length > 0) {
      out[f] = decryptIfEncrypted(out[f] as string);
    }
  }
  return out;
}
