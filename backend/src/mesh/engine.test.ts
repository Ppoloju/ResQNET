import { describe, it, expect } from 'vitest';
import { MeshEngine, relayAllows } from './engine.js';
import { signPacket, verifySignature, validatePacket, isExpired, canonicalize } from '@iqoo/shared';

const SECRET = 'test-secret-abcdef0123456789';

function makePacket(overrides: Partial<Parameters<typeof signPacket>[0]> = {}) {
  return signPacket({
    id: 'msg_test-0001',
    emergencyId: 'RQ-TEST0001',
    senderId: 'dev-A',
    senderPublicId: 'RQ_NODE_AA',
    type: 'SOS' as const,
    priority: 'CRITICAL' as const,
    timestamp: Date.now(),
    location: { latitude: 17.385, longitude: 78.4867, accuracyMeters: 25, state: 'GPS_AVAILABLE' as const },
    battery: 80,
    message: 'SOS test',
    hopCount: 0,
    ttl: 3600,
    requiresMedicalHelp: true,
    requiresPoliceHelp: false,
    ...overrides,
  }, SECRET);
}

describe('shared crypto + validation (via @iqoo/shared)', () => {
  it('signs and verifies packets (HMAC-SHA256 over canonical JSON)', async () => {
    const p = await makePacket();
    expect(p.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifySignature(p, SECRET)).toBe(true);
    expect(await verifySignature(p, 'wrong-secret')).toBe(false);
  });

  it('detects tampering of any field', async () => {
    const p = await makePacket();
    const tampered = { ...p, message: 'tampered' };
    expect(await verifySignature(tampered, SECRET)).toBe(false);
  });

  it('canonicalize is key-order independent', () => {
    expect(canonicalize({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalize({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it('validates a good packet and rejects bad ones', async () => {
    const good = await makePacket();
    expect(validatePacket(good).valid).toBe(true);

    const bad = { ...good, emergencyId: 'not-an-emergency-id', hopCount: 99, ttl: 99999999 };
    const res = validatePacket(bad);
    expect(res.valid).toBe(false);
    expect(res.issues.map((i) => i.field)).toContain('emergencyId');
  });

  it('rejects packets with future timestamps beyond skew window', async () => {
    const p = await makePacket({ timestamp: Date.now() + 10 * 60_000 });
    const res = validatePacket(p);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.problem.includes('future'))).toBe(true);
  });

  it('expires packets after TTL', async () => {
    const p = await makePacket({ timestamp: Date.now() - 4000 * 1000, ttl: 3600 });
    expect(isExpired(p)).toBe(true);
  });
});

describe('mesh engine — store-and-forward scenarios', () => {
  it('delivers A → B → C → Gateway with dedupe and ACKs (§51 scenario)', async () => {
    const eng = new MeshEngine({ nodeId: 'G', secret: SECRET, defaultTtlSeconds: 3600, maxHops: 8, linkDelayMs: 5, lossRate: 0 });
    eng.addLink('A', 'B');
    eng.addLink('B', 'C');
    eng.addLink('C', 'G');
    const pkt = await makePacket();
    await eng.inject('A', pkt);
    await eng.settle();

    const snap = eng.getSnapshot();
    expect(snap.nodes.find((n) => n.id === 'C')!.seenPackets).toBe(1);
    expect(snap.nodes.find((n) => n.id === 'B')!.seenPackets).toBe(1);
    expect(snap.nodes.find((n) => n.id === 'G')!.seenPackets).toBe(1);
    expect(snap.stats.acked).toBeGreaterThan(0);
  });

  it('suppresses loop floods (duplicate detection)', async () => {
    const eng = new MeshEngine({ nodeId: 'G', secret: SECRET, defaultTtlSeconds: 3600, maxHops: 8, linkDelayMs: 5, lossRate: 0 });
    eng.addLink('A', 'B');
    eng.addLink('B', 'C');
    eng.addLink('A', 'C'); // loop exists
    const pkt = await makePacket();
    await eng.inject('A', pkt);
    await eng.settle();
    for (const n of eng.getSnapshot().nodes) expect(n.seenPackets).toBeLessThanOrEqual(1);
  });

  it('stores packets when link is down and flushes on recovery (delay-tolerant, §42)', async () => {
    const eng = new MeshEngine({ nodeId: 'G', secret: SECRET, defaultTtlSeconds: 3600, maxHops: 8, linkDelayMs: 5, lossRate: 0 });
    eng.addLink('A', 'B');
    eng.addLink('B', 'G');
    eng.setLinkDown('B', 'G');
    const pkt = await makePacket();
    await eng.inject('A', pkt);
    await eng.settle();

    let snap = eng.getSnapshot();
    expect(snap.nodes.find((n) => n.id === 'G')!.seenPackets).toBe(0);
    expect(snap.nodes.find((n) => n.id === 'B')!.queuedPackets).toBe(1);

    eng.setLinkUp('B', 'G'); // recovery
    await eng.settle();
    snap = eng.getSnapshot();
    expect(snap.nodes.find((n) => n.id === 'G')!.seenPackets).toBe(1);
    expect(snap.nodes.find((n) => n.id === 'B')!.queuedPackets).toBe(0);
    expect(snap.timeline.some((e) => e.event === 'OUTBOX_FLUSH')).toBe(true);
  });

  it('blocks relay below 20% battery unless CRITICAL (§29)', () => {
    expect(relayAllows(80, 'LOW')).toBe(true);
    expect(relayAllows(30, 'LOW')).toBe(false);
    expect(relayAllows(30, 'HIGH')).toBe(true);
    expect(relayAllows(10, 'HIGH')).toBe(false);
    expect(relayAllows(10, 'CRITICAL')).toBe(true);
  });

  it('battery tier boundaries are exact: 20/50 edges (§29)', () => {
    // >50 = normal (all priorities)
    for (const p of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const) {
      expect(relayAllows(51, p), `51% ${p}`).toBe(true);
    }
    // 50 = reduced (CRITICAL + HIGH only)
    expect(relayAllows(50, 'CRITICAL')).toBe(true);
    expect(relayAllows(50, 'HIGH')).toBe(true);
    expect(relayAllows(50, 'MEDIUM')).toBe(false);
    expect(relayAllows(50, 'LOW')).toBe(false);
    // 20 = still reduced tier
    expect(relayAllows(20, 'CRITICAL')).toBe(true);
    expect(relayAllows(20, 'HIGH')).toBe(true);
    expect(relayAllows(20, 'MEDIUM')).toBe(false);
    // <20 = CRITICAL only
    expect(relayAllows(19, 'CRITICAL')).toBe(true);
    expect(relayAllows(19, 'HIGH')).toBe(false);
    expect(relayAllows(0, 'CRITICAL')).toBe(true);
    expect(relayAllows(0, 'LOW')).toBe(false);
  });

  it('battery tier actually gates forwarding in the engine (not just the helper)', async () => {
    const eng = new MeshEngine({ nodeId: 'LOW', secret: SECRET, defaultTtlSeconds: 3600, maxHops: 8, linkDelayMs: 5, lossRate: 0 });
    eng.addLink('SRC', 'GATEWAY');
    eng.setBattery('GATEWAY', 30); // reduced tier: MEDIUM must be suppressed
    eng.setRole('GATEWAY', 'GATEWAY');
    const packet = await makePacket({ priority: 'MEDIUM' });
    const r = await eng.inject('SRC', packet);
    expect(r.accepted).toBe(true);
    await eng.settle();
    const snap = eng.getSnapshot();
    // Gateway received (reception never blocked) but did NOT relay MEDIUM.
    expect(snap.nodes.find((n) => n.id === 'GATEWAY')!.seenPackets).toBe(1);
    expect(snap.timeline.some((e) => e.event === 'RELAY_SUPPRESSED_LOW_BATTERY')).toBe(true);
  });

  it('Relay Hero relays full-strength at low battery; others stay tiered (§29 iQOO)', async () => {
    const eng = new MeshEngine({ nodeId: 'HH', secret: SECRET, defaultTtlSeconds: 3600, maxHops: 8, linkDelayMs: 5, lossRate: 0 });
    // Hero at 12% battery would normally be CRITICAL-only; nomination lifts it.
    eng.addLink('SRC', 'HERO');
    eng.addLink('HERO', 'GATEWAY');
    eng.addLink('SRC2', 'OTHER');
    eng.addLink('OTHER', 'GATEWAY');
    eng.setBattery('HERO', 12);
    eng.setBattery('OTHER', 12);
    eng.setRelayHero('HERO');
    const crit = await makePacket({ id: 'msg_hero_crit', emergencyId: 'RQ-HEROC001', priority: 'CRITICAL' });
    await eng.inject('SRC', crit);
    // Same battery on a non-hero node still gates MEDIUM onward relay.
    const medium = await makePacket({ id: 'msg_hero_med', emergencyId: 'RQ-HEROM001', priority: 'MEDIUM' });
    await eng.inject('SRC2', medium);
    await eng.settle();
    const snap = eng.getSnapshot();
    expect(snap.relayHero).toBe('HERO');
    // Hero relayed CRITICAL onward despite 12% battery — GATEWAY received via HERO
    // (status ends ACKED once the hop ACK round-trip completes).
    const heroRelayed = snap.deliveries.some((d) => d.nodeId === 'GATEWAY' && d.via === 'HERO'
      && (d.status === 'DELIVERED' || d.status === 'ACKED'));
    const otherSuppressed = snap.timeline.some((e) => e.nodeId === 'OTHER' && e.event === 'RELAY_SUPPRESSED_LOW_BATTERY');
    expect(heroRelayed).toBe(true);
    expect(otherSuppressed).toBe(true);
    // Release restores normal tiers.
    eng.setRelayHero(null);
    expect(eng.getRelayHero()).toBeNull();
  });

  it('applies hop limit (§11)', async () => {
    const eng = new MeshEngine({ nodeId: 'Z', secret: SECRET, defaultTtlSeconds: 3600, maxHops: 8, linkDelayMs: 5, lossRate: 0 });
    const ids = Array.from({ length: 12 }, (_, i) => `N${i}`);
    for (let i = 0; i < ids.length - 1; i++) eng.addLink(ids[i], ids[i + 1]);
    eng.addLink(ids[ids.length - 1], 'Z');
    const pkt = await makePacket({ ttl: 3600 });
    await eng.inject(ids[0], pkt);
    await eng.settle();
    expect(eng.getSnapshot().nodes.find((n) => n.id === 'Z')!.seenPackets).toBe(0);
  });

  it('retries failed transmissions then stores for later (retry strategy)', async () => {
    const eng = new MeshEngine({ nodeId: 'G2', secret: SECRET, defaultTtlSeconds: 3600, maxHops: 8, linkDelayMs: 5, lossRate: 0, retryDelaysMs: [10, 20, 30] });
    eng.addLink('A', 'B', 1.0); // always "loses" packets
    const pkt = await makePacket({ priority: 'CRITICAL' });
    await eng.inject('A', pkt);
    await eng.settle(2000);
    const snap = eng.getSnapshot();
    expect(snap.nodes.find((n) => n.id === 'A')!.queuedPackets).toBe(1);
    expect(snap.nodes.find((n) => n.id === 'B')!.seenPackets).toBe(0);
  });
});
