// LocalNetworkTransport (§35): the "internet" transport made explicit.
// Talks to an IQOO backend reachable on the same LAN (home wifi, hotspot) via
// REST + SSE. Availability is PROBED, not guessed: navigator.onLine is never
// treated as proof (§44). LAN discovery via mDNS is a native-client capability
// [R]; here the base URL is user-configurable in Settings/through VITE_API_URL.

import type {
  EmergencyPacket, Transport, TransportAvailability, TransportSentResult, IncomingPacketEvent,
} from '@iqoo/shared';

export class LocalNetworkTransport implements Transport {
  readonly name = 'local-network' as const;

  private handlers = new Set<(ev: IncomingPacketEvent) => void>();
  private lastProbeOk: boolean | null = null;
  private lastProbeAt = 0;

  constructor(private baseUrl: string) {}

  setBaseUrl(url: string): void {
    this.baseUrl = url;
    this.lastProbeOk = null;
  }

  /** Real end-to-end probe with a short TTL cache so availability() stays cheap. */
  private async probe(): Promise<boolean> {
    if (this.lastProbeOk !== null && Date.now() - this.lastProbeAt < 10_000) return this.lastProbeOk;
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${this.baseUrl}/healthz`, { signal: controller.signal });
      clearTimeout(t);
      this.lastProbeOk = res.ok;
    } catch {
      this.lastProbeOk = false;
    }
    this.lastProbeAt = Date.now();
    return this.lastProbeOk;
  }

  async availability(): Promise<TransportAvailability> {
    return (await this.probe()) ? 'READY' : 'UNAVAILABLE';
  }

  async statusDetail(): Promise<string> {
    const ok = await this.probe();
    return ok
      ? `IQOO backend reachable at ${this.baseUrl}`
      : `No backend at ${this.baseUrl} — mesh/outbox still work offline`;
  }

  async send(peerId: string, packet: EmergencyPacket, timeoutMs = 8000): Promise<TransportSentResult> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/api/emergencies`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(localStorage.getItem('iqoo.token') ? { authorization: `Bearer ${localStorage.getItem('iqoo.token')}` } : {}),
        },
        body: JSON.stringify({
          type: packet.type === 'QUICK_HELP' ? 'QUICK_HELP' : 'SOS',
          severity: packet.priority,
          message: packet.message,
          location: packet.location,
          battery: packet.battery,
          requiresMedicalHelp: packet.requiresMedicalHelp,
          requiresPoliceHelp: packet.requiresPoliceHelp,
          ai: packet.ai,
        }),
        signal: controller.signal,
      });
      return { packetId: packet.id, peerId: 'backend', acked: res.ok };
    } finally {
      clearTimeout(t);
    }
  }

  onPacket(handler: (ev: IncomingPacketEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async stop(): Promise<void> {
    this.handlers.clear();
  }
}
