import { describe, expect, it } from 'vitest';
import { decodeMeshFrame, encodeAckFrame, encodePacketFrame } from './meshFrame.js';
import type { EmergencyPacket } from './types.js';

const packet: EmergencyPacket = {
  id: 'msg_native_01', emergencyId: 'IQ-ABCDEFGH', senderId: 'device-a', senderPublicId: 'IQOO_NODE_AAAA',
  type: 'SOS', priority: 'CRITICAL', timestamp: Date.now(),
  location: { latitude: 17.4, longitude: 78.5, accuracyMeters: 20, state: 'GPS_AVAILABLE' },
  battery: 80, message: 'help', hopCount: 0, ttl: 3600,
  requiresMedicalHelp: true, requiresPoliceHelp: true, signature: 'a'.repeat(64),
};

describe('native mesh frames', () => {
  it('round-trips a validated packet frame', () => {
    const decoded = decodeMeshFrame(encodePacketFrame(packet, packet.senderPublicId));
    expect(decoded?.packet).toEqual(packet);
  });

  it('rejects malformed packets before routing', () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ protocol: 1, frame: 'packet', senderPublicId: 'peer', packet: { ...packet, signature: 'bad' } }));
    expect(decodeMeshFrame(bytes)).toBeNull();
  });

  it('round-trips link acknowledgements', () => {
    const decoded = decodeMeshFrame(encodeAckFrame(packet.id, 'IQOO_NODE_BBBB', true));
    expect(decoded?.frame).toMatchObject({ frame: 'ack', packetId: packet.id, accepted: true });
  });
});