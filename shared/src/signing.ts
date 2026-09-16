// Canonical serialization + HMAC-SHA256 signing (§11, §32).
// Uses WebCrypto (available in all modern browsers and Node >= 20) so the exact
// same code runs on client and server — no platform fork.

export interface SignablePacket {
  signature: string;
  [key: string]: unknown;
}

/** Stable key order canonical JSON so both sides hash identical bytes. */
export function canonicalize(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(canonicalize).join(',')}]`;
  const entries = Object.entries(obj as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
  return `{${entries.join(',')}}`;
}

// Return type is inferred from crypto.subtle (DOM lib in browsers, @types/node in Node) —
// no explicit annotation avoids lib-mismatch between the two contexts.
async function importKey(secret: string) {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Hex HMAC-SHA256 of the canonical JSON with `signature` field excluded. */
export async function computeSignature(packet: Omit<SignablePacket, 'signature'>, secret: string): Promise<string> {
  const { signature: _ignored, ...rest } = packet;
  const data = new TextEncoder().encode(canonicalize(rest));
  const key = await importKey(secret);
  const mac = await crypto.subtle.sign('HMAC', key, data);
  return toHex(mac);
}

export async function signPacket<T extends Omit<SignablePacket, 'signature'>>(
  packet: T,
  secret: string,
): Promise<T & { signature: string }> {
  const signature = await computeSignature(packet, secret);
  return { ...packet, signature };
}

export async function verifySignature(packet: SignablePacket, secret: string): Promise<boolean> {
  const claimed = packet.signature;
  if (typeof claimed !== 'string' || claimed.length !== 64) return false;
  const expected = await computeSignature(packet, secret);
  // Constant-time-ish compare (lengths equal, XOR accumulate).
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= claimed.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
