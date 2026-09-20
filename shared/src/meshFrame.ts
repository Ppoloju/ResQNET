import type { EmergencyPacket } from './types.js';
import { validatePacket } from './validate.js';

export const MESH_PROTOCOL_VERSION = 1;
export const MESH_FRAME_PREFIX = 'RESQNET/1';
export const MAX_FRAME_BYTES = 48_000;

export interface MeshFrame {
  protocol: typeof MESH_PROTOCOL_VERSION;
  frame: 'packet' | 'ack';
  senderPublicId: string;
  peerId?: string;
  packet?: EmergencyPacket;
  packetId?: string;
  accepted?: boolean;
}

/** UTF-8 JSON frame used by native BLE characteristic writes and Wi-Fi sockets. */
export function encodePacketFrame(packet: EmergencyPacket, senderPublicId: string): Uint8Array {
  const frame: MeshFrame = {
    protocol: MESH_PROTOCOL_VERSION,
    frame: 'packet',
    senderPublicId,
    packet,
  };
  return encode(frame);
}

export function encodeAckFrame(packetId: string, senderPublicId: string, accepted: boolean): Uint8Array {
  return encode({
    protocol: MESH_PROTOCOL_VERSION,
    frame: 'ack',
    senderPublicId,
    packetId,
    accepted,
  });
}

export function decodeMeshFrame(bytes: Uint8Array): { frame: MeshFrame; packet?: EmergencyPacket } | null {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_FRAME_BYTES) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<MeshFrame>;
    if (parsed.protocol !== MESH_PROTOCOL_VERSION || (parsed.frame !== 'packet' && parsed.frame !== 'ack')) return null;
    if (typeof parsed.senderPublicId !== 'string' || parsed.senderPublicId.length === 0) return null;
    if (parsed.frame === 'ack') {
      if (typeof parsed.packetId !== 'string' || typeof parsed.accepted !== 'boolean') return null;
      return { frame: parsed as MeshFrame };
    }
    const result = validatePacket(parsed.packet);
    if (!result.valid) return null;
    return { frame: parsed as MeshFrame, packet: parsed.packet as EmergencyPacket };
  } catch {
    return null;
  }
}

function encode(frame: MeshFrame): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify(frame));
  if (bytes.byteLength > MAX_FRAME_BYTES) throw new Error('mesh frame exceeds transport budget');
  return bytes;
}
