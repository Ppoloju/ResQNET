// Packet validation + anti-abuse rules (§11, §33).
// Every packet entering the router must pass validatePacket.

import type { EmergencyPacket, PacketType, Priority } from './types.js';

export const MAX_HOPS = 8;
export const MAX_TTL_SECONDS = 6 * 3600;
export const PRIORITIES: readonly Priority[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
export const PACKET_TYPES: readonly PacketType[] = [
  'SOS', 'QUICK_HELP', 'RESOLUTION', 'DISASTER_BROADCAST', 'CHECK_IN', 'ACK', 'HEARTBEAT',
];

export interface ValidationIssue {
  field: string;
  problem: string;
}

export function validatePacket(p: unknown): { valid: boolean; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const pkt = p as Partial<EmergencyPacket> | null;

  if (!pkt || typeof pkt !== 'object') {
    return { valid: false, issues: [{ field: '', problem: 'packet is not an object' }] };
  }
  const req = (field: string, ok: boolean, problem: string) => {
    if (!ok) issues.push({ field, problem });
  };

  req('id', typeof pkt.id === 'string' && pkt.id.length >= 8 && pkt.id.length <= 64, 'missing or malformed id');
  req('emergencyId', typeof pkt.emergencyId === 'string' && /^IQ-[0-9A-Z]{6,12}$/.test(pkt.emergencyId), 'emergencyId must match IQ-XXXXXXXX');
  req('senderId', typeof pkt.senderId === 'string' && pkt.senderId.length > 0, 'missing senderId');
  req('senderPublicId', typeof pkt.senderPublicId === 'string' && pkt.senderPublicId.length <= 32, 'missing senderPublicId');
  req('type', PACKET_TYPES.includes(pkt.type as PacketType), 'invalid type');
  req('priority', PRIORITIES.includes(pkt.priority as Priority), 'invalid priority');
  req('timestamp', typeof pkt.timestamp === 'number' && pkt.timestamp > 1_600_000_000_000, 'timestamp out of range');

  // Clock-skew tolerance: reject packets from the far future (> 5 min ahead).
  if (typeof pkt.timestamp === 'number') {
    req('timestamp', pkt.timestamp <= Date.now() + 5 * 60_000, 'timestamp too far in future (replay/skew)');
  }

  req('hopCount', typeof pkt.hopCount === 'number' && pkt.hopCount >= 0 && pkt.hopCount <= MAX_HOPS, `hopCount must be 0..${MAX_HOPS}`);
  req('ttl', typeof pkt.ttl === 'number' && pkt.ttl > 0 && pkt.ttl <= MAX_TTL_SECONDS, 'ttl out of range');
  req('message', typeof pkt.message === 'string' && pkt.message.length <= 1024, 'message missing or > 1024 chars');

  const loc = pkt.location as EmergencyPacket['location'] | undefined;
  req('location', !!loc && typeof loc === 'object' && typeof loc.state === 'string', 'location missing or malformed');
  if (loc && (loc.state === 'GPS_AVAILABLE' || loc.state === 'NETWORK_LOCATION_AVAILABLE')) {
    req('location.latitude', typeof loc.latitude === 'number' && loc.latitude >= -90 && loc.latitude <= 90, 'latitude out of range');
    req('location.longitude', typeof loc.longitude === 'number' && loc.longitude >= -180 && loc.longitude <= 180, 'longitude out of range');
  }

  req('signature', typeof pkt.signature === 'string' && pkt.signature.length === 64, 'signature missing or malformed');
  req('requiresMedicalHelp', typeof pkt.requiresMedicalHelp === 'boolean', 'requiresMedicalHelp must be boolean');
  req('requiresPoliceHelp', typeof pkt.requiresPoliceHelp === 'boolean', 'requiresPoliceHelp must be boolean');

  return { valid: issues.length === 0, issues };
}

/** True when the packet has fully expired (TTL elapsed) — used by router + store-and-forward. */
export function isExpired(p: Pick<EmergencyPacket, 'timestamp' | 'ttl'>, now = Date.now()): boolean {
  return now > p.timestamp + p.ttl * 1000;
}

export function priorityRank(p: Priority): number {
  return PRIORITIES.indexOf(p); // 0 = CRITICAL ... 3 = LOW
}
