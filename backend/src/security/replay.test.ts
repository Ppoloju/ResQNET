import { describe, it, expect } from 'vitest';
import { ReplayCache } from '@iqoo/shared';

describe('replay protection cache (§32/§33)', () => {
  it('accepts a new packet id exactly once', () => {
    const c = new ReplayCache();
    expect(c.claimAndCheck('msg_a')).toBe(true);
    expect(c.claimAndCheck('msg_a')).toBe(false); // replay
    expect(c.claimAndCheck('msg_b')).toBe(true);
  });

  it('expires entries after the TTL window', () => {
    const ttl = 1000;
    const c = new ReplayCache(ttl);
    const t0 = 1_000_000;
    expect(c.claimAndCheck('msg_x', t0)).toBe(true);
    expect(c.claimAndCheck('msg_x', t0 + 500)).toBe(false); // inside window
    expect(c.claimAndCheck('msg_x', t0 + ttl + 1)).toBe(true); // window passed
  });

  it('is bounded in memory (evicts oldest when oversized)', () => {
    const c = new ReplayCache(60_000, 100);
    for (let i = 0; i < 150; i++) c.claimAndCheck(`msg_${i}`, 1_000_000 + i);
    expect(c.size).toBeLessThanOrEqual(100);
  });

  it('reset clears all state', () => {
    const c = new ReplayCache();
    c.claimAndCheck('msg_z');
    c.reset();
    expect(c.claimAndCheck('msg_z')).toBe(true);
  });
});
