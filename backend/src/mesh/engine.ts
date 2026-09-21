// ResQNET Mesh Engine — deterministic store-and-forward simulation core (§13, §42).
// PROTOTYPE/SIMULATION: this models radio links in software so the routing logic
// (dedupe, TTL, hops, ACK, retry, battery tiers) can be tested and demoed without
// physical BLE hardware. Real radios plug into the same interface later.

import type { EmergencyPacket, Priority } from '@iqoo/shared';
import { isExpired, priorityForMode, validatePacket } from '@iqoo/shared';

export interface LinkDef { a: string; b: string; lossRate?: number }

interface SimLink {
  a: string; b: string; lossRate: number; down: boolean;
}

interface SimNode {
  id: string;
  battery: number;           // 0..100
  role: 'NORMAL' | 'RELAY' | 'RESPONDER' | 'GATEWAY';
  outbox: EmergencyPacket[]; // store-and-forward queue (§13)
  seen: Set<string>;         // duplicate detection (§11/§33)
  degree: number;
}

export interface TimelineEvent {
  ts: number;
  nodeId: string;
  event: string;
  detail?: Record<string, unknown>;
}

export interface DeliveryRecord {
  packetId: string;
  nodeId: string;
  status: 'DELIVERED' | 'DUPLICATE' | 'FAILED' | 'EXPIRED' | 'QUEUED' | 'ACKED';
  attempts: number;
  via: string | null;
  ts: number;
}

export interface EngineOptions {
  nodeId: string;
  secret: string;
  defaultTtlSeconds: number;
  maxHops: number;
  linkDelayMs: number;
  lossRate: number;
  /** Exponential-ish backoff per priority retry; overridable for fast tests. */
  retryDelaysMs?: number[];
  onDeliver?: (packet: EmergencyPacket, toNodeId: string, transport: string) => void;
  onExpired?: (packetId: string, atNodeId: string) => void;
}

const DEFAULT_RETRY_DELAYS_MS = [400, 1200, 3000];

/** Battery-aware relay tiers (§29): >50% normal; 20–50% reduced (CRITICAL+HIGH); <20% CRITICAL-only. Reception always allowed, forwarding gated. */
export function relayAllows(battery: number, priority: Priority): boolean {
  if (battery < 20) return priority === 'CRITICAL';
  if (battery <= 50) return priority === 'CRITICAL' || priority === 'HIGH';
  return true;
}

function priorityRetries(p: Priority): number {
  switch (p) {
    case 'CRITICAL': return 3;
    case 'HIGH': return 2;
    default: return 1;
  }
}

/** Priority rank for disaster-mode queueing (§13): lower sends first. */
function priorityRank(p: Priority): number {
  switch (p) {
    case 'CRITICAL': return 0;
    case 'HIGH': return 1;
    case 'MEDIUM': return 2;
    default: return 3;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class MeshEngine {
  readonly nodes = new Map<string, SimNode>();
  private links: SimLink[] = [];
  private deliveries = new Map<string, DeliveryRecord>(); // key packetId:nodeId
  readonly timeline: TimelineEvent[] = [];
  private pending = 0;
  private heroNodeId: string | null = null; // Relay Hero (§29 iQOO enhancement)
  /** Disaster mode (§13): priority queueing + one-notch traffic promotion. */
  disasterMode = false;

  /** §13: enter/leave disaster mode — outbox drains CRITICAL-first while active. */
  setDisasterMode(on: boolean): void {
    this.disasterMode = on;
  }
  private readonly opts: EngineOptions;

  constructor(opts: EngineOptions) {
    this.opts = opts;
    this.ensureNode(opts.nodeId, 'GATEWAY');
  }

  // ---------- topology ----------

  ensureNode(id: string, role: SimNode['role'] = 'NORMAL'): SimNode {
    let n = this.nodes.get(id);
    if (!n) {
      n = { id, battery: 100, role, outbox: [], seen: new Set(), degree: 0 };
      this.nodes.set(id, n);
    }
    return n;
  }

  setBattery(nodeId: string, battery: number): void {
    this.ensureNode(nodeId).battery = Math.max(0, Math.min(100, battery));
  }

  setRole(nodeId: string, role: SimNode['role']): void {
    this.ensureNode(nodeId).role = role;
  }

  /**
   * Relay Hero (§29 iQOO enhancement): nominate one node to relay at full
   * strength regardless of battery. Models an iQOO-class device whose large
   * cell + bypass charging let it volunteer as the mesh's backbone node: it
   * receives everything as usual, but forwards with its REAL reserves while
   * everyone else conserves. Setting null releases the nomination.
   */
  setRelayHero(nodeId: string | null): void {
    this.heroNodeId = nodeId;
    this.log(nodeId ?? 'ENGINE', nodeId ? 'RELAY_HERO_ACTIVATED' : 'RELAY_HERO_RELEASED',
      nodeId ? { nodeId } : {});
  }

  getRelayHero(): string | null {
    return this.heroNodeId;
  }

  hasNode(nodeId: string): boolean {
    return this.nodes.has(nodeId);
  }

  addLink(a: string, b: string, lossRate = this.opts.lossRate): void {
    if (a === b) return;
    if (this.links.some((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))) return;
    this.links.push({ a, b, lossRate, down: false });
    this.ensureNode(a).degree++;
    this.ensureNode(b).degree++;
  }

  setLinkDown(a: string, b: string): void {
    const link = this.findLink(a, b);
    if (link) link.down = true;
  }

  setLinkUp(a: string, b: string): void {
    const link = this.findLink(a, b);
    if (link) {
      link.down = false;
      this.flushOutbox(a);
      this.flushOutbox(b);
    }
  }

  private findLink(a: string, b: string): SimLink | undefined {
    return this.links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));
  }

  private neighborsOf(id: string): Array<{ node: SimNode; link: SimLink }> {
    const out: Array<{ node: SimNode; link: SimLink }> = [];
    for (const l of this.links) {
      if (l.a === id) out.push({ node: this.ensureNode(l.b), link: l });
      else if (l.b === id) out.push({ node: this.ensureNode(l.a), link: l });
    }
    return out;
  }

  // ---------- injection / flooding ----------

  /** Entry point: validate and inject a packet at a node (§36 MessageRouter behavior). */
  async inject(nodeId: string, packet: EmergencyPacket): Promise<{ accepted: boolean; reason?: string; issues?: unknown[] }> {
    const shape = validatePacket(packet);
    if (!shape.valid) {
      this.log(nodeId, 'REJECTED_INVALID', { packetId: packet.id, issues: shape.issues });
      return { accepted: false, reason: 'invalid', issues: shape.issues };
    }
    if (isExpired(packet)) {
      this.log(nodeId, 'REJECTED_EXPIRED', { packetId: packet.id });
      return { accepted: false, reason: 'expired' };
    }
    const node = this.ensureNode(nodeId);
    node.seen.add(packet.id);
    this.record(packet.id, nodeId, 'DELIVERED', null);
    this.log(nodeId, 'EMERGENCY_CREATED', {
      packetId: packet.id, emergencyId: packet.emergencyId, priority: packet.priority,
    });
    this.forwardFrom(node, packet);
    return { accepted: true };
  }

  /** Forward a (validated, unseen-here) packet to all eligible neighbors. */
  private forwardFrom(node: SimNode, packet: EmergencyPacket): void {
    if (isExpired(packet)) {
      this.expire(packet.id, node.id);
      return;
    }
    if (packet.hopCount >= this.opts.maxHops) {
      this.log(node.id, 'HOP_LIMIT_REACHED', { packetId: packet.id, hopCount: packet.hopCount });
      return;
    }
    // §29 battery tiers gate the SENDING node's onward relay — a low-battery
    // device still RECEIVES packets (so SOS always gets through) but does not
    // spend its remaining battery forwarding traffic it cannot afford to.
    // Disaster mode (§13) promotes life-safety traffic one notch first.
    // Relay Hero: the nominated backbone node relays with full reserves (§29 iQOO).
    const batteryForRelay = this.heroNodeId === node.id ? Math.max(node.battery, 60) : node.battery;
    const effectivePriority = this.disasterMode ? priorityForMode(packet.priority, 'DISASTER') : packet.priority;
    if (!relayAllows(batteryForRelay, effectivePriority)) {
      this.log(node.id, 'RELAY_SUPPRESSED_LOW_BATTERY', { packetId: packet.id, battery: node.battery, priority: packet.priority, effectivePriority });
      return;
    }
    for (const { node: neighbor, link } of this.neighborsOf(node.id)) {
      const hopPacket: EmergencyPacket = { ...packet, hopCount: packet.hopCount + 1 };
      void this.transmit(node, neighbor, link, hopPacket, 0);
    }
  }

  /** Single transmission attempt over one link, with retry + store-and-forward. */
  private async transmit(
    from: SimNode,
    to: SimNode,
    link: SimLink,
    packet: EmergencyPacket,
    attempt: number,
  ): Promise<void> {
    this.pending++;
    try {
      await sleep(this.opts.linkDelayMs);
      if (isExpired(packet)) {
        this.expire(packet.id, from.id);
        return;
      }
      if (link.down) {
        // Store-and-forward: keep at sender, flush when link returns (§13/§42).
        if (!from.outbox.some((p) => p.id === packet.id)) {
          this.enqueue(from, packet);
          this.record(packet.id, from.id, 'QUEUED', null);
          this.log(from.id, 'STORED_FOR_FORWARD', { packetId: packet.id, toNeighbor: to.id });
        }
        return;
      }
      const loss = link.lossRate > 0 && Math.random() < link.lossRate;
      if (loss) {
        this.record(packet.id, from.id, 'FAILED', to.id);
        this.log(from.id, 'TRANSMISSION_LOST', { packetId: packet.id, toNeighbor: to.id, attempt });
        const maxRetries = priorityRetries(packet.priority);
        if (attempt < maxRetries) {
          const delays = this.opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
          const backoff = delays[Math.min(attempt, delays.length - 1)];
          await sleep(backoff);
          await this.transmit(from, to, link, packet, attempt + 1);
        } else {
          this.enqueue(from, packet); // give up live retry → store for later
          this.record(packet.id, from.id, 'QUEUED', null);
          this.log(from.id, 'STORED_AFTER_RETRY_EXHAUSTED', { packetId: packet.id, toNeighbor: to.id });
        }
        return;
      }
      this.deliver(to, packet, from);
    } finally {
      this.pending--;
    }
  }

  /** Receive a packet at a node: dedupe, record, ACK back, continue flooding. */
  private deliver(to: SimNode, packet: EmergencyPacket, from: SimNode): void {
    if (to.seen.has(packet.id)) {
      this.record(packet.id, to.id, 'DUPLICATE', from.id);
      this.log(to.id, 'DUPLICATE_IGNORED', { packetId: packet.id });
      return;
    }
    to.seen.add(packet.id);
    this.record(packet.id, to.id, 'DELIVERED', from.id);
    this.log(to.id, 'PACKET_RECEIVED', {
      packetId: packet.id, emergencyId: packet.emergencyId,
      hopCount: packet.hopCount, from: from.id,
    });
    // Disaster mode activation (§13): a disaster broadcast or region-scale
    // hazard packet flips the whole network into priority-queueing.
    if (packet.type === 'DISASTER_BROADCAST' || packet.ai?.category === 'NATURAL_DISASTER' || packet.ai?.category === 'FIRE') {
      if (!this.disasterMode) {
        this.disasterMode = true;
        this.log(to.id, 'DISASTER_MODE_ACTIVATED', { packetId: packet.id, trigger: packet.type });
      }
    }
    this.opts.onDeliver?.(packet, to.id, 'simulated-bluetooth');
    void this.sendAck(from, to, packet);
    this.forwardFrom(to, packet);
  }

  /** One-hop ACK back to the previous hop; origin seeing it means relay confirmed. */
  private async sendAck(from: SimNode, to: SimNode, packet: EmergencyPacket): Promise<void> {
    this.pending++;
    try {
      await sleep(this.opts.linkDelayMs);
      this.log(to.id, 'ACK_SENT', { packetId: packet.id, to: from.id });
      const recKey = `${packet.id}:${from.id}`;
      const rec = this.deliveries.get(recKey);
      if (rec && rec.status === 'DELIVERED') {
        rec.status = 'ACKED';
        rec.ts = Date.now();
      }
      this.log(from.id, 'ACK_RECEIVED', { packetId: packet.id, from: to.id });
    } finally {
      this.pending--;
    }
  }

  /** Store-and-forward flush when a link comes back up (§42). */
  private flushOutbox(nodeId: string): void {
    const node = this.ensureNode(nodeId);
    if (node.outbox.length === 0) return;
    // Disaster mode drains the queue by priority: life-safety first (§13).
    const queued = [...node.outbox].sort(
      (a, b) => priorityRank(a.priority) - priorityRank(b.priority),
    );
    node.outbox = [];
    for (const packet of queued) {
      if (isExpired(packet)) {
        this.expire(packet.id, node.id);
        continue;
      }
      this.log(node.id, 'OUTBOX_FLUSH', { packetId: packet.id, priority: packet.priority });
      this.forwardFrom(node, packet);
    }
  }

  /** Priority-aware enqueue (§13): in disaster mode, the outbox drains CRITICAL-first. */
  private enqueue(node: SimNode, packet: EmergencyPacket): void {
    if (!this.disasterMode) {
      node.outbox.push(packet);
      return;
    }
    const idx = node.outbox.findIndex((p) => priorityRank(p.priority) > priorityRank(packet.priority));
    if (idx === -1) node.outbox.push(packet);
    else node.outbox.splice(idx, 0, packet);
  }

  /** Periodic maintenance: expire queued packets past TTL. */
  sweepExpired(): number {
    let expired = 0;
    for (const node of this.nodes.values()) {
      const still: EmergencyPacket[] = [];
      for (const p of node.outbox) {
        if (isExpired(p)) {
          this.expire(p.id, node.id);
          expired++;
        } else {
          still.push(p);
        }
      }
      node.outbox = still;
    }
    return expired;
  }

  private expire(packetId: string, atNodeId: string): void {
    this.record(packetId, atNodeId, 'EXPIRED', null);
    this.log(atNodeId, 'PACKET_EXPIRED', { packetId });
    this.opts.onExpired?.(packetId, atNodeId);
  }

  // ---------- observation ----------

  private record(packetId: string, nodeId: string, status: DeliveryRecord['status'], via: string | null): void {
    const key = `${packetId}:${nodeId}`;
    const prev = this.deliveries.get(key);
    if (prev && prev.status === 'ACKED') return; // ACKED is terminal
    this.deliveries.set(key, {
      packetId, nodeId, status,
      attempts: (prev?.attempts ?? 0) + (status === 'FAILED' ? 1 : 0),
      via, ts: Date.now(),
    });
  }

  private log(nodeId: string, event: string, detail?: Record<string, unknown>): void {
    this.timeline.push({ ts: Date.now(), nodeId, event, detail });
  }

  /** Resolve automatic roles (§40): gateway > responder > relay(battery+degree) > normal. */
  private effectiveRole(n: SimNode): SimNode['role'] {
    if (n.role !== 'NORMAL') return n.role;
    if (n.battery >= 50 && n.degree >= 2) return 'RELAY';
    return 'NORMAL';
  }

  async settle(timeoutMs = 5000): Promise<void> {
    const start = Date.now();
    while (this.pending > 0 && Date.now() - start < timeoutMs) {
      await sleep(10);
    }
  }

  getSnapshot() {
    return {
      nodes: [...this.nodes.values()].map((n) => ({
        id: n.id,
        battery: n.battery,
        role: this.effectiveRole(n),
        queuedPackets: n.outbox.length,
        seenPackets: n.seen.size,
        degree: n.degree,
      })),
      deliveries: [...this.deliveries.values()],
      timeline: [...this.timeline].sort((a, b) => a.ts - b.ts),
      disasterMode: this.disasterMode,
      relayHero: this.heroNodeId,
      stats: {
        totalNodes: this.nodes.size,
        totalLinks: this.links.length,
        delivered: [...this.deliveries.values()].filter((d) => d.status === 'DELIVERED').length,
        acked: [...this.deliveries.values()].filter((d) => d.status === 'ACKED').length,
        duplicates: [...this.deliveries.values()].filter((d) => d.status === 'DUPLICATE').length,
        expired: [...this.deliveries.values()].filter((d) => d.status === 'EXPIRED').length,
      },
    };
  }

  reset(batteryPercent = 100): void {
    for (const n of this.nodes.values()) {
      n.seen = new Set();
      n.outbox = [];
      n.battery = batteryPercent;
    }
    this.links = [];
    this.deliveries.clear();
    this.timeline.length = 0;
    this.pending = 0;
    this.disasterMode = false;
    this.heroNodeId = null;
    for (const n of this.nodes.values()) n.degree = 0;
  }
}
