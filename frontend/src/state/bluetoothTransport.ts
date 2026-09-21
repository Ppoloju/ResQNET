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
import { decodeMeshFrame, encodePacketFrame } from '@iqoo/shared';

/** Demo service/characteristic (Nordic UART-style; must match the peer app). */
const SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const TX_CHAR_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // we write packets here
const RX_CHAR_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // we receive packets here

interface WebBluetoothLike {
  requestDevice(options: { filters: Array<{ services?: string[] }>; optionalServices?: string[] }):
    Promise<{ id: string; name?: string; gatt?: { connect(): Promise<BluetoothServerLike>; disconnect?(): void } }>;
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
type BluetoothDeviceLike = Awaited<ReturnType<WebBluetoothLike['requestDevice']>>;

export class WebBluetoothTransport implements Transport {
  readonly name = 'bluetooth' as const;

  private devices = new Map<string, BluetoothDeviceLike>();
  private txChars = new Map<string, BluetoothCharLike>();
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
    return this.devices.size > 0 ? 'READY' : 'PERMISSION_NEEDED';
  }

  async statusDetail(): Promise<string> {
    if (!this.api) return this.unsupportedReason;
    if (this.devices.size === 0) return 'Ready to pair — choose a nearby ResQNET device (foreground only) [P]';
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

  private async connect(device: BluetoothDeviceLike): Promise<void> {
    if (!device.gatt) return;
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    const tx = await service.getCharacteristic(TX_CHAR_UUID);
    const rx = await service.getCharacteristic(RX_CHAR_UUID);
    this.devices.set(device.id, device);
    this.txChars.set(device.id, tx);
    await rx.startNotifications();
    rx.addEventListener('characteristicvaluechanged', (ev) => {
      const view = (ev.target as unknown as { value?: DataView }).value;
      if (!view) return;
      const decoded = decodeMeshFrame(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
      if (!decoded?.packet) return;
      for (const handler of this.handlers) handler({ packet: decoded.packet, fromPeerId: device.id, signalHint: null });
    });
  }

  async send(peerId: string, packet: EmergencyPacket, timeoutMs = 8000): Promise<TransportSentResult> {
    const targets = peerId === '*' ? [...this.txChars.entries()] : [[peerId, this.txChars.get(peerId)] as const];
    if (targets.length === 0 || targets.some(([, characteristic]) => !characteristic)) throw new Error('no paired peer — call requestPermission first');
    const frame = encodePacketFrame(packet, packet.senderPublicId);
    const outcomes = await Promise.all(targets.map(async ([targetId, characteristic]) => {
      if (!characteristic) return { targetId, acked: false };
      const write = characteristic!.writeValueWithoutResponse
        ? characteristic.writeValueWithoutResponse(frame as unknown as BufferSource)
        : characteristic.writeValue(frame as unknown as BufferSource);
      const acked = await Promise.race([write.then(() => true), new Promise<false>((resolve) => setTimeout(() => resolve(false), timeoutMs))]);
      return { targetId, acked };
    }));
    return { packetId: packet.id, peerId, acked: outcomes.some((outcome) => outcome.acked) };
  }

  onPacket(handler: (ev: IncomingPacketEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async stop(): Promise<void> {
    for (const device of this.devices.values()) device.gatt?.disconnect?.();
    this.txChars.clear();
    this.devices.clear();
    this.handlers.clear();
  }
}
