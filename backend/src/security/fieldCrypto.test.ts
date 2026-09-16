import { describe, it, expect } from 'vitest';
import {
  isEncrypted, encryptIfPresent, decryptIfEncrypted,
  encryptProfileFields, decryptProfileFields,
} from './fieldCrypto.js';

describe('field-level encryption (Phase 10)', () => {
  it('encrypts and decrypts a field roundtrip', () => {
    const enc = encryptIfPresent('penicillin allergy');
    expect(enc).not.toBeNull();
    expect(isEncrypted(enc!)).toBe(true);
    expect(enc).not.toContain('penicillin');
    expect(decryptIfEncrypted(enc)).toBe('penicillin allergy');
  });

  it('is idempotent — already-encrypted values are not double-encrypted', () => {
    const once = encryptIfPresent('secret');
    const twice = encryptIfPresent(once);
    expect(twice).toBe(once);
  });

  it('passes through legacy plaintext on decrypt (migration-friendly)', () => {
    expect(decryptIfEncrypted('plain old value')).toBe('plain old value');
    expect(decryptIfEncrypted('')).toBeNull();
    expect(decryptIfEncrypted(null)).toBeNull();
  });

  it('fails closed on tampered ciphertext', () => {
    const enc = encryptIfPresent('sensitive medical note')!;
    const [iv, tag, ct] = enc.slice('enc:v1:'.length).split(':');
    const tamperedCt = Buffer.from(ct!, 'base64');
    tamperedCt[0] ^= 0xff;
    const bad = `enc:v1:${iv}:${tag}:${tamperedCt.toString('base64')}`;
    expect(decryptIfEncrypted(bad)).toBeNull();
  });

  it('encrypts profile fields and decrypts them back', () => {
    const row = {
      medical_conditions: 'asthma',
      allergies: 'peanuts',
      medications: 'albuterol',
      emergency_notes: 'keep calm',
      photo: 'data:image/png;base64,AAAA',
      name: 'Alice', // non-sensitive — must remain untouched
    };
    const enc = encryptProfileFields(row);
    expect(isEncrypted(enc.medical_conditions as string)).toBe(true);
    expect(enc.name).toBe('Alice');

    const dec = decryptProfileFields(enc);
    expect(dec.medical_conditions).toBe('asthma');
    expect(dec.allergies).toBe('peanuts');
    expect(dec.medications).toBe('albuterol');
    expect(dec.photo).toBe('data:image/png;base64,AAAA');
  });

  it('returns a NEW decrypted copy — the input row is never mutated', () => {
    // Regression: the /me and /me/card routes originally discarded this return
    // value and served raw ciphertext to clients. Guards both the copy contract
    // and the correct read pattern.
    const row = { allergies: 'peanuts' };
    const enc = encryptProfileFields(row);
    const dec = decryptProfileFields(enc);
    expect(dec).not.toBe(enc);
    expect(dec.allergies).toBe('peanuts');
    expect(isEncrypted(enc.allergies as string)).toBe(true);
  });
});
