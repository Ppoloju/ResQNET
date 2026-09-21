// BluetoothTransport prototype [P] (§35, §13-remainder).
// Uses Web Bluetooth (Chrome/Edge only — iOS/Safari have no support; no
// background scanning anywhere). Implements the shared `Transport` interface so
// the CommunicationManager treats it exactly like any other radio.
//
// PROTOTYPE scope (honest):
//  - foreground only, user-picked device via requestDevice(),
//  - one documented Nordic-UART-style service for validated RESQNET/1 frames,
//  - availability() never lies: UNSUPPORTED / PERMISSION_NEEDED / READY / UNAVAILABLE.
// Production path = native mobile client [R] (background BLE, advertising).

import type {
  EmergencyPacket, Transport, TransportAvailability, TransportSentResult, IncomingPacketEvent,
} from '@iqoo/shared';
import { decodeMeshFrame, encodeAckFrame, encodePacketFrame } from '@iqoo/shared';

/** Demo service/characteristic (Nordic UART-style; must match the peer app). */
const SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const TX_CHAR_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // we write packets here
const RX_CHAR_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // we receive packets here

interface WebBluetoothLike {
  requestDevice(options: { filters: Array<{ services?: string[] }>; optionalServices?: string[] }):
    Promise<BluetoothDeviceLike>;
  getDevices?(): Promise<BluetoothDeviceLike[]>;
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

interface BluetoothDeviceLike {
  id: string;
  name?: string;
  gatt?: { connect(): Promise<BluetoothServerLike>; disconnect?(): void };
  addEventListener?(type: 'gattserverdisconnected', listener: () => void): void;
}

type BtWindow = Window & { navigator: Navigator & { bluetooth?: WebBluetoothLike } };

export class WebBluetoothTransport implements Transport {
  readonly name = 'bluetooth' as const;

  private devices = new Map<string, BluetoothDeviceLike>();
  private txChars = new Map<string, BluetoothCharLike>();
  private writeQueues = new Map<string, Promise<void>>();
  private handlers = new Set<(ev: IncomingPacketEvent) => void>();
  private unsupportedReason = 'Web Bluetooth requires Chrome/Edge on desktop or Android';
  private readonly senderPublicId = this.loadSenderPublicId();

  private loadSenderPublicId(): string {
    try {
      const saved = JSON.parse(localStorage.getItem('resqnet.localDevice') ?? 'null') as { publicId?: string } | null;
      if (saved?.publicId) return saved.publicId;
      return `RQ_NODE_${crypto.randomUUID().replace(/-/g, '').slice(0, 4).toUpperCase()}`;
    } catch {
      return 'RQ_NODE_BROWSER';
    }
  }

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
    return this.devices.size > 0 ? 'READY' : 'PERMISSION_NEEDED';
  }

  async statusDetail(): Promise<string> {
    if (!this.api) return this.unsupportedReason;
    if (this.devices.size === 0) return 'Pair a native ResQNET BLE peer; browser tabs cannot advertise as BLE servers [P]';
    const names = [...this.devices.values()].map((device) => device.name ?? device.id.slice(0, 8));
    return `Paired with ${names.join(', ')} [P]`;
  }

  /** Ask the user to pick a peer device (must be called from a user gesture). */
  async requestPermission(): Promise<boolean> {
    const bt = this.api;
    if (!bt) return false;
    try {
      const device = await bt.requestDevice({
        filters: [{ services: [SERVICE_UUID] }],
        optionalServices: [SERVICE_UUID],
      });
      await this.connect(device);
      return true;
    } catch {
      return false; // user cancelled or no device — never fabricated as success
    }
  }

  /** Reconnect to peers already granted by the browser after a page reload. */
  async reconnectGrantedDevices(): Promise<number> {
    const devices = await this.api?.getDevices?.() ?? [];
    let connected = 0;
    for (const device of devices) {
      try {
        await this.connect(device);
        connected++;
      } catch { /* continue with other granted peers */ }
    }
    return connected;
  }

  private async connect(device: BluetoothDeviceLike): Promise<void> {
    if (!device.gatt) return;
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    const tx = await service.getCharacteristic(TX_CHAR_UUID);
    const rx = await service.getCharacteristic(RX_CHAR_UUID);
    this.devices.set(device.id, device);
    this.txChars.set(device.id, tx);
    device.addEventListener?.('gattserverdisconnected', () => {
      this.devices.delete(device.id);
      this.txChars.delete(device.id);
      this.writeQueues.delete(device.id);
    });
    await rx.startNotifications();
    rx.addEventListener('characteristicvaluechanged', (ev) => {
      const view = (ev.target as unknown as { value?: DataView }).value;
      if (!view) return;
      const decoded = decodeMeshFrame(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
      if (!decoded || decoded.frame.frame === 'ack' || !decoded.packet) return;
      void this.writeFrame(device.id, encodeAckFrame(decoded.packet.id, this.senderPublicId, true));
      for (const handler of this.handlers) handler({ packet: decoded.packet, fromPeerId: device.id, signalHint: null });
    });
  }

  async send(peerId: string, packet: EmergencyPacket, timeoutMs = 8000): Promise<TransportSentResult> {
    const targets = peerId === '*' ? [...this.txChars.entries()] : [[peerId, this.txChars.get(peerId)] as const];
    if (targets.length === 0 || targets.some(([, characteristic]) => !characteristic)) throw new Error('no paired peer — call requestPermission first');
    const frame = encodePacketFrame(packet, packet.senderPublicId);
    const outcomes = await Promise.all(targets.map(async ([targetId, characteristic]) => {
      if (!characteristic) return { targetId, acked: false };
      const write = this.writeFrame(targetId, frame, characteristic);
      const acked = await Promise.race([write.then(() => true), new Promise<false>((resolve) => setTimeout(() => resolve(false), timeoutMs))]);
      return { targetId, acked };
    }));
    return { packetId: packet.id, peerId, acked: outcomes.some((outcome) => outcome.acked) };
  }

  private writeFrame(peerId: string, frame: Uint8Array, characteristic = this.txChars.get(peerId)): Promise<void> {
    if (!characteristic) return Promise.reject(new Error(`peer ${peerId} is disconnected`));
    const previous = this.writeQueues.get(peerId) ?? Promise.resolve();
    const next = previous.then(() => {
      const bytes = frame.slice().buffer as ArrayBuffer;
      return characteristic.writeValueWithoutResponse
        ? characteristic.writeValueWithoutResponse(bytes)
        : characteristic.writeValue(bytes);
    });
    this.writeQueues.set(peerId, next.catch(() => undefined));
    return next;
  }

  onPacket(handler: (ev: IncomingPacketEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async stop(): Promise<void> {
    for (const device of this.devices.values()) device.gatt?.disconnect?.();
    this.txChars.clear();
    this.devices.clear();
    this.writeQueues.clear();
    this.handlers.clear();
  }
}
