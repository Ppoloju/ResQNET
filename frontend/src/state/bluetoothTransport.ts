// BluetoothTransport prototype [P] (§35, §13-remainder).
// Uses Web Bluetooth (Chrome/Edge only — iOS/Safari have no support; no
// background scanning anywhere). Implements the shared `Transport` interface so
// the CommunicationManager treats it exactly like any other radio.
//
// PROTOTYPE scope (honest):
//  - foreground only, user-picked device via requestDevice(),
//  - one documented Nordic-UART-style service for JSON packet frames,
//  - availability() never lies: UNSUPPORTED / PERMISSION_NEEDED / READY / UNAVAILABLE.
// Production path = native mobile client [R] (background BLE, advertising).

import type {
  EmergencyPacket, Transport, TransportAvailability, TransportSentResult, IncomingPacketEvent,
} from '@iqoo/shared';

/** Demo service/characteristic (Nordic UART-style; must match the peer app). */
const SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const TX_CHAR_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // we write packets here
const RX_CHAR_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // we receive packets here

interface WebBluetoothLike {
  requestDevice(options: { filters: Array<{ services?: string[] }>; optionalServices?: string[] }):
    Promise<{ id: string; name?: string; gatt?: { connect(): Promise<BluetoothServerLike> } }>;
  addEventListener(type: 'availabilitychanged', listener: () => void): void;
}
interface BluetoothServerLike {
  getPrimaryService(s: string): Promise<{ getCharacteristic(c: string): Promise<BluetoothCharLike> }>;
}
interface BluetoothCharLike {
  writeValue(value: BufferSource): Promise<void>;
  writeValueWithoutResponse?(value: BufferSource): Promise<void>;
  startNotifications(): Promise<BluetoothCharLike>;
  addEventListener(type: 'characteristicvaluechanged', listener: (ev: Event) => void): void;
}

type BtWindow = Window & { navigator: Navigator & { bluetooth?: WebBluetoothLike } };

export class WebBluetoothTransport implements Transport {
  readonly name = 'bluetooth' as const;

  private device: Awaited<ReturnType<WebBluetoothLike['requestDevice']>> | null = null;
  private txChar: BluetoothCharLike | null = null;
  private handlers = new Set<(ev: IncomingPacketEvent) => void>();
  private unsupportedReason = 'Web Bluetooth requires Chrome/Edge on desktop or Android';

  private get api(): WebBluetoothLike | undefined {
    return (window as unknown as BtWindow).navigator.bluetooth;
  }

  async availability(): Promise<TransportAvailability> {
    const bt = this.api;
    if (!bt) return 'UNSUPPORTED';
    try {
      const hasRadio = await (bt as unknown as { getAvailability?: () => Promise<boolean> }).getAvailability?.();
      if (hasRadio === false) return 'UNAVAILABLE';
    } catch { /* probe optional */ }
    return this.device ? 'READY' : 'PERMISSION_NEEDED';
  }

  async statusDetail(): Promise<string> {
    if (!this.api) return this.unsupportedReason;
    if (!this.device) return 'Ready to pair — tap to choose a nearby ResQNET device (foreground only) [P]';
    return `Paired with ${this.device.name ?? this.device.id.slice(0, 8)} [P]`;
  }

  /** Ask the user to pick a peer device (must be called from a user gesture). */
  async requestPermission(): Promise<boolean> {
    const bt = this.api;
    if (!bt) return false;
    try {
      this.device = await bt.requestDevice({
        filters: [{ services: [SERVICE_UUID] }],
        optionalServices: [SERVICE_UUID],
      });
      await this.connect();
      return true;
    } catch {
      return false; // user cancelled or no device — never fabricated as success
    }
  }

  private async connect(): Promise<void> {
    if (!this.device?.gatt) return;
    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    const tx = await service.getCharacteristic(TX_CHAR_UUID);
    const rx = await service.getCharacteristic(RX_CHAR_UUID);
    this.txChar = tx;
    await rx.startNotifications();
    rx.addEventListener('characteristicvaluechanged', (ev) => {
      const view = (ev.target as unknown as { value?: DataView }).value;
      if (!view) return;
      try {
        const text = new TextDecoder().decode(view);
        const packet = JSON.parse(text) as EmergencyPacket;
        for (const h of this.handlers) h({ packet, fromPeerId: this.device?.id ?? 'unknown', signalHint: null });
      } catch { /* malformed frame — drop */ }
    });
  }

  async send(peerId: string, packet: EmergencyPacket, timeoutMs = 8000): Promise<TransportSentResult> {
    if (!this.txChar) throw new Error('no paired peer — call requestPermission first');
    // Frames are small JSON; larger payloads are the outbox's job, not the radio's.
    const bytes = new TextEncoder().encode(JSON.stringify(packet));
    const write = this.txChar.writeValueWithoutResponse
      ? this.txChar.writeValueWithoutResponse(bytes)
      : this.txChar.writeValue(bytes);
    // Link-level ACK: resolved true here when write succeeds (GATT write = link ack [P]);
    // application ACKs flow back as packets over RX.
    const acked = await Promise.race([write.then(() => true), new Promise<false>((r) => setTimeout(() => r(false), timeoutMs))]);
    return { packetId: packet.id, peerId, acked };
  }

  onPacket(handler: (ev: IncomingPacketEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async stop(): Promise<void> {
    this.txChar = null;
    this.device = null;
    this.handlers.clear();
  }
}
