// Ed25519 asymmetric signing — the production upgrade path for the HMAC scheme
// (§32, Phase 10). HMAC proves *someone* with the shared secret made the packet;
// Ed25519 proves *this specific device* did, and any peer can verify with the
// public key without holding a secret — the right model for multi-hop mesh,
// where relays must verify packets they cannot be trusted to hold secrets for.
//
// WebCrypto Ed25519 is feature-detected: present in Node >= 18.4 and modern
// browsers (Chrome 113+, Safari 17+). Where absent, callers keep HMAC — no
// behavior breaks, and the UI never claims asymmetric signing it can't do.

export interface Ed25519KeyPair {
  publicKey: JsonWebKey;   // shared with peers / gateway for verification
  privateKey: JsonWebKey;  // device-local, never transmitted
}

/** True when this runtime's WebCrypto supports Ed25519. */
export async function ed25519Supported(): Promise<boolean> {
  try {
    const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    // Clean up the probe keypair immediately.
    void kp;
    return true;
  } catch {
    return false;
  }
}

/** Generate a device identity keypair (exportable JWK for backup/migration). */
export async function generateDeviceKeyPair(): Promise<Ed25519KeyPair> {
  const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const publicKey = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const privateKey = await crypto.subtle.exportKey('jwk', kp.privateKey);
  return { publicKey, privateKey };
}

async function importPrivate(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['sign']);
}

async function importPublic(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['verify']);
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Sign an arbitrary JSON-serializable payload with the device's private key. */
export async function signWithDeviceKey(payload: unknown, privateKeyJwk: JsonWebKey): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, await importPrivate(privateKeyJwk), data);
  return toHex(sig);
}

/** Verify a payload+signature against a peer's public key (64-hex signature). */
export async function verifyWithDeviceKey(payload: unknown, signatureHex: string, publicKeyJwk: JsonWebKey): Promise<boolean> {
  if (!/^[0-9a-f]{128}$/.test(signatureHex)) return false; // Ed25519 sig = 64 bytes
  try {
    return await crypto.subtle.verify(
      { name: 'Ed25519' },
      await importPublic(publicKeyJwk),
      fromHex(signatureHex),
      new TextEncoder().encode(JSON.stringify(payload)),
    );
  } catch {
    return false;
  }
}
