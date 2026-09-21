// Gateway sync (§42/§52): when a simulated packet reaches the GATEWAY node in the
// demo mesh, it enters the REAL backend — same tables, same signed-packet storage,
// same family fan-out a production gateway would perform. This is the honest
// "emergency reaches responder infrastructure" step: simulated radio, real data plane.

import { randomUUID } from 'node:crypto';
import type { EmergencyPacket } from '@iqoo/shared';
import { ReplayCache } from '@iqoo/shared';
import { db, tx } from '../db.js';
import { logger } from '../logger.js';
import { broadcastEvent } from '../routes/realtime.js';
import { enqueueEmergencyNotifications } from '../notifications.js';

// Gateway-level replay rejection (§32/§33): a packet id accepted once is never
// accepted again within the TTL window, even if signature+TTL are both valid.
const replayCache = new ReplayCache();

/**
 * System gateway identity: the pseudo-user that owns gateway-synced emergencies
 * when the packet's origin is an anonymous mesh node (no account, §34).
 */
function ensureGatewayUser(): string {
  const existing = db.prepare("SELECT id FROM users WHERE email = 'gateway@iqoo.system'").get() as { id: string } | undefined;
  if (existing) return existing.id;
  const id = `usr_gateway_${randomUUID()}`;
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO users (id, email, display_name, password_hash, role, created_at, updated_at)
              VALUES (?, 'gateway@iqoo.system', 'IQOO Gateway System', 'seed-no-login', 'responder', ?, ?)`)
    .run(id, now, now);
  return id;
}

/**
 * Persist a gateway-received packet as a real emergency event.
 * Idempotent: an emergencyId that already exists is not duplicated (§47).
 * ownerUserId: optional account to attribute the emergency to (enables family
 * fan-out); defaults to the gateway system user for anonymous mesh packets.
 * Returns the emergency id when created, null when it already existed.
 */
export function syncEmergencyFromGateway(packet: EmergencyPacket, ownerUserId?: string): string | null {
  const existing = db.prepare('SELECT id FROM emergency_events WHERE id = ?').get(packet.emergencyId) as { id: string } | undefined;
  if (existing) return null;
  // Replay guard: same packet id arriving again (from a different relay path) is dropped.
  if (!replayCache.claimAndCheck(packet.id)) {
    logger.warn({ packetId: packet.id, emergencyId: packet.emergencyId }, 'gateway rejected replayed packet');
    return null;
  }

  const gatewayUserId = (ownerUserId && db.prepare('SELECT id FROM users WHERE id = ?').get(ownerUserId) as { id: string } | undefined)
    ? ownerUserId!
    : ensureGatewayUser();

  // The gateway stores the packet under a synthetic "gateway" device — mesh packets
  // may originate from anonymous sim nodes with no user account.
  const gatewayDeviceId = 'dev_gateway_sim';
  const dev = db.prepare('SELECT id FROM devices WHERE id = ?').get(gatewayDeviceId);
  if (!dev) {
    db.prepare(`INSERT INTO devices (id, user_id, name, platform, public_id, secret, created_at)
                VALUES (?, ?, 'Demo Gateway (simulated)', 'web', 'RQ_NODE_GW', ?, ?)`)
      .run(gatewayDeviceId, ensureGatewayUser(), randomUUID().replace(/-/g, ''), new Date().toISOString());
  }

  const now = new Date().toISOString();
  const severity = packet.priority === 'CRITICAL' ? 'CRITICAL' : packet.priority === 'HIGH' ? 'HIGH' : packet.priority === 'MEDIUM' ? 'MEDIUM' : 'LOW';
  const emergencyId = packet.emergencyId;

  tx(() => {
    db.prepare(`INSERT INTO emergency_events
        (id, user_id, type, status, severity, category, message, lat, lon, location_state,
         location_accuracy_m, battery, network_state, emergency_profile_snapshot, created_at, updated_at)
      VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?, 'ONLINE', ?, ?, ?)`)
      .run(
        emergencyId,
        gatewayUserId,
        packet.type === 'SOS' ? 'SOS' : packet.type === 'QUICK_HELP' ? 'QUICK_HELP' : 'SOS',
        severity,
        packet.ai?.category ?? null,
        packet.message ?? null,
        packet.location.latitude, packet.location.longitude,
        packet.location.state, packet.location.accuracyMeters,
        packet.battery ?? null,
        JSON.stringify({ gatewayReceived: true, simulated: true, note: 'Received via demo mesh gateway' }),
        now, now,
      );

    db.prepare(`INSERT INTO emergency_messages
        (id, emergency_id, sender_device_id, type, priority, payload, signature, hop_count, ttl_expires_at, received_via, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        packet.id, emergencyId, gatewayDeviceId, packet.type, packet.priority,
        JSON.stringify(packet), packet.signature,
        packet.hopCount, new Date(packet.timestamp + packet.ttl * 1000).toISOString(),
        `mesh:${packet.hopCount}-hops`, now,
      );
  });

  logger.info({ emergencyId, hops: packet.hopCount }, 'gateway synced simulated emergency');
  broadcastEvent('mesh_event', {
    id: packet.id, emergencyId, type: 'SYNCED', from: 'GATEWAY', to: 'BACKEND', ts: Date.now(),
  });
  enqueueEmergencyNotifications({
    emergencyId,
    ownerUserId: gatewayUserId,
    severity,
    message: packet.message ?? 'Emergency received through the mesh gateway',
    requiresMedicalHelp: packet.requiresMedicalHelp,
    requiresPoliceHelp: packet.requiresPoliceHelp,
    includeEmergencyService: true,
  });
  return emergencyId;
}
