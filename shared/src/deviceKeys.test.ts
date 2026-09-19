import { describe, it, expect } from 'vitest';
import {
  ed25519Supported, generateDeviceKeyPair, signWithDeviceKey, verifyWithDeviceKey,
} from './deviceKeys.js';

// Ed25519 lives in WebCrypto on Node >= 18.4 and modern browsers. The skip
// guard runs at test time (not module load) so the suite exercises the full
// path wherever Ed25519 exists and skips honestly where it doesn't.
describe('Ed25519 device keys (§32 production upgrade path)', () => {
  it('detects Ed25519 support truthfully', async () => {
    expect(typeof await ed25519Supported()).toBe('boolean');
  });

  it('signs and verifies a payload roundtrip', async (t) => {
    if (!(await ed25519Supported())) t.skip();
    const { publicKey, privateKey } = await generateDeviceKeyPair();
    const payload = { id: 'msg_x', emergencyId: 'RQ-TEST0001', ts: 123 };
    const sig = await signWithDeviceKey(payload, privateKey);
    expect(sig).toMatch(/^[0-9a-f]{128}$/);
    await expect(verifyWithDeviceKey(payload, sig, publicKey)).resolves.toBe(true);
  });

  it('rejects a tampered payload', async (t) => {
    if (!(await ed25519Supported())) t.skip();
    const { publicKey, privateKey } = await generateDeviceKeyPair();
    const sig = await signWithDeviceKey({ n: 1 }, privateKey);
    await expect(verifyWithDeviceKey({ n: 2 }, sig, publicKey)).resolves.toBe(false);
  });

  it('rejects a signature from a different key', async (t) => {
    if (!(await ed25519Supported())) t.skip();
    const a = await generateDeviceKeyPair();
    const b = await generateDeviceKeyPair();
    const sig = await signWithDeviceKey({ n: 1 }, a.privateKey);
    await expect(verifyWithDeviceKey({ n: 1 }, sig, b.publicKey)).resolves.toBe(false);
  });

  it('rejects malformed signatures without throwing', async () => {
    const { publicKey } = await generateDeviceKeyPair();
    await expect(verifyWithDeviceKey({ n: 1 }, 'deadbeef', publicKey)).resolves.toBe(false);
    await expect(verifyWithDeviceKey({ n: 1 }, 'zz'.repeat(64), publicKey)).resolves.toBe(false);
  });
});
