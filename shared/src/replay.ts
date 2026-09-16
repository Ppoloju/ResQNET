// Replay protection (§32/§33): a bounded, time-aware cache of recently seen
// packet ids. Mesh nodes and the gateway both call `claimAndCheck` before
// accepting a packet; a replayed id within the TTL window is rejected.
//
// Design: simple Map-based LRU with periodic pruning — no dependencies, O(1)
// ops, memory bounded by maxEntries so a malicious peer cannot grow it without
// limit. The packet id is the nonce (msg_<uuid>); the ±5-min timestamp skew
// check in validate.ts plus this cache closes the replay window.

export class ReplayCache {
  private seen = new Map<string, number>(); // id -> first-seen ts (ms)
  private lastPrune = 0;

  constructor(
    private readonly ttlMs: number = 6 * 60 * 60 * 1000, // match MAX_TTL
    private readonly maxEntries: number = 10_000,
  ) {}

  /** Prune expired entries; runs at most once per pruneInterval to keep ops cheap. */
  private prune(now: number, force = false): void {
    if (!force && now - this.lastPrune < 60_000) return;
    this.lastPrune = now;
    for (const [id, ts] of this.seen) {
      if (now - ts > this.ttlMs) this.seen.delete(id);
    }
  }

  /**
   * Returns true (and records the id) when the packet is NEW;
   * returns false when it is a replay within the TTL window.
   * Checks the entry's own timestamp — correct regardless of prune timing.
   */
  claimAndCheck(packetId: string, now: number = Date.now()): boolean {
    this.prune(now);
    const firstSeen = this.seen.get(packetId);
    if (firstSeen !== undefined) {
      if (now - firstSeen <= this.ttlMs) return false; // live replay
      this.seen.delete(packetId); // expired — allow re-claim
    }
    this.seen.set(packetId, now);
    // Hard memory bound: evict oldest insertion when oversized.
    if (this.seen.size > this.maxEntries) {
      const oldest = this.seen.keys().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    return true;
  }

  /** Test/ops helper. */
  get size(): number { return this.seen.size; }

  reset(): void { this.seen.clear(); this.lastPrune = 0; }
}
