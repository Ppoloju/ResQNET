// CommunicationManager transport abstraction (§35).
// The app never depends on one radio: routing code speaks to a Transport;
// implementations plug in. InternetTransport is REST+SSE (implemented);
// BluetoothTransport ships as a foreground-capable prototype [P]; Wi-Fi
// Direct needs a native client [R].

import type { EmergencyPacket } from './types.js';

/** How a transport reports its runtime availability (never fabricated). */
export type TransportAvailability =
  | 'UNSUPPORTED'      // API absent from this platform (e.g. iOS Web Bluetooth)
  | 'PERMISSION_NEEDED' // API exists, user has not granted access yet
  | 'READY'            // usable now
  | 'UNAVAILABLE';     // granted but radio/hardware not usable right now

export interface TransportSentResult {
  packetId: string;
  peerId: string;
  /** true when the peer ACKed within the transport's own window. */
  acked: boolean;
}

export interface IncomingPacketEvent {
  packet: EmergencyPacket;
  fromPeerId: string;
  /** RSSI-ish signal hint when the transport provides one; null otherwise. */
  signalHint: number | null;
}

/**
 * One radio link. Implementations own discovery, connections, framing and
 * their own retry/ACK at the link layer; the router above them stays
 * transport-agnostic (§36).
 */
export interface Transport {
  readonly name: 'bluetooth' | 'wifi-direct' | 'local-network' | 'internet';
  availability(): Promise<TransportAvailability>;
  /** Human-readable explanation for UI display (why unavailable, etc.). */
  statusDetail(): Promise<string>;
  /** Best-effort send to a specific peer; resolves when link-layer ACK arrives or times out. */
  send(peerId: string, packet: EmergencyPacket, timeoutMs?: number): Promise<TransportSentResult>;
  /** Subscribe to packets arriving over this transport. Returns an unsubscribe fn. */
  onPacket(handler: (ev: IncomingPacketEvent) => void): () => void;
  /** Release radios/connections. */
  stop(): Promise<void>;
}

/**
 * CommunicationManager (§35): owns the set of transports, picks the best
 * available one for a send, and fans incoming packets up to the router.
 */
export class CommunicationManager {
  private transports: Transport[] = [];
  private handlers = new Set<(ev: IncomingPacketEvent) => void>();
  private unsubs: Array<() => void> = [];

  register(t: Transport): void {
    // Dedupe by name: React StrictMode double-mounts providers in dev, which
    // used to register the same transport twice (duplicate status rows AND
    // packets fanned out to handlers two times).
    if (this.transports.some((x) => x.name === t.name)) return;
    this.transports.push(t);
    this.unsubs.push(t.onPacket((ev) => {
      for (const h of this.handlers) h(ev);
    }));
  }

  /** All transports with their current availability (for the Network page). */
  async availability(): Promise<Array<{ name: Transport['name']; availability: TransportAvailability; detail: string }>> {
    return Promise.all(this.transports.map(async (t) => ({
      name: t.name,
      availability: await t.availability(),
      detail: await t.statusDetail(),
    })));
  }

  /**
   * Send via the first READY transport that supports the peer; falls through
   * to the next transport when one is unavailable. Returns per-transport
   * outcomes — the caller decides what "delivered" means (any ACK suffices).
   */
  async broadcast(packet: EmergencyPacket, timeoutMs = 8000): Promise<TransportSentResult[]> {
    const results: TransportSentResult[] = [];
    for (const t of this.transports) {
      const av = await t.availability();
      if (av !== 'READY') continue;
      try {
        results.push(await t.send('*', packet, timeoutMs));
      } catch {
        // transport-level failure — next transport tries; packet also lives in the outbox
      }
    }
    return results;
  }

  onPacket(handler: (ev: IncomingPacketEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async stop(): Promise<void> {
    // Clear registries SYNCHRONOUSLY before awaiting: React StrictMode unmount
    // → remount races the async teardown, and a late clear would wipe transports
    // registered by the remount (leaving the manager silently empty).
    const toStop = this.transports;
    this.transports = [];
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.handlers.clear();
    await Promise.all(toStop.map((t) => t.stop().catch(() => { /* already down */ })));
  }
}
