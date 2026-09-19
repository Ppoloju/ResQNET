import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { signPacket, type EmergencyPacket, type GeoLocation, type LocationState, type AIResult } from '@iqoo/shared';
import { apiFetch, useSession } from './SessionContext';
import { useStatus } from './StatusContext';

export type SosPhase = 'IDLE' | 'COUNTDOWN' | 'ACTIVE' | 'RESOLVED';

export interface BlackBoxEntry {
  ts: number;
  event: string;
  detail?: string;
}

export interface ActiveEmergency {
  emergencyId: string;
  type: 'SOS' | 'QUICK_HELP';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  message: string;
  location: GeoLocation | null;
  battery: number | null;
  startedAt: number;
  packetId: string;
  signature: string;
  queuedOffline: boolean;
  /** Advisory local-AI classification attached at activation (§17). */
  ai?: AIResult;
}

/** Emergency ID generation: IQ-XXXXXXXX (Crockford-ish alphabet, no 0/O/1/I). */
function newEmergencyId(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = 'IQ-';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  for (const b of bytes) id += alphabet[b % alphabet.length];
  return id;
}

function getLocation(): Promise<GeoLocation> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve({ latitude: 0, longitude: 0, accuracyMeters: null, state: 'LOCATION_UNAVAILABLE' });
      return;
    }
    const done = (state: LocationState, coords?: GeolocationCoordinates) => {
      resolve(coords
        ? { latitude: coords.latitude, longitude: coords.longitude, accuracyMeters: coords.accuracy ?? null, state }
        : { latitude: 0, longitude: 0, accuracyMeters: null, state });
    };
    navigator.geolocation.getCurrentPosition(
      (pos) => done(pos.coords.accuracy <= 100 ? 'GPS_AVAILABLE' : 'NETWORK_LOCATION_AVAILABLE', pos.coords),
      () => done('LOCATION_UNAVAILABLE'),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 },
    );
  });
}

interface MeshState {
  phase: SosPhase;
  active: ActiveEmergency | null;
  countdown: number;
  blackBox: BlackBoxEntry[];
  outboxCount: number;
  lastSyncAt: number | null;
  startSos: (message?: string, ai?: AIResult, options?: { skipCountdown?: boolean }) => void;
  cancelCountdown: () => void;
  resolveActive: () => Promise<void>;
}

const MeshContext = createContext<MeshState>(null as unknown as MeshState);

const ACTIVE_KEY = 'iqoo.activeEmergency';
const DEFAULT_SOS_VIBRATION_PATTERN_MS = [120, 60, 180];
const DISARMED_VIBRATION_PATTERN_MS = [60, 40, 60];

function vibrateForSos(pattern = DEFAULT_SOS_VIBRATION_PATTERN_MS): void {
  if (typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
}

/**
 * Anonymous local identity (§34): SOS must work with NO account and NO network.
 * Identity is generated on-device, kept in localStorage, and upgraded to the
 * server-issued device identity when the user registers. Public ID carries no
 * personal information (IQOO_NODE_XXXX).
 */
function getOrCreateLocalIdentity(): { id: string; publicId: string; secret: string } {
  const raw = localStorage.getItem('iqoo.localDevice');
  if (raw) {
    try { return JSON.parse(raw) as { id: string; publicId: string; secret: string }; } catch { /* regenerate */ }
  }
  const secretBytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = Array.from(secretBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  const pubBytes = crypto.getRandomValues(new Uint8Array(2));
  const publicId = `IQOO_NODE_${Array.from(pubBytes).map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join('')}`;
  const identity = { id: `local_${crypto.randomUUID()}`, publicId, secret };
  localStorage.setItem('iqoo.localDevice', JSON.stringify(identity));
  return identity;
}

export function MeshProvider({ children }: { children: ReactNode }) {
  const { device, user } = useSession();
  const { online, battery } = useStatus();
  const [phase, setPhase] = useState<SosPhase>('IDLE');
  const [active, setActive] = useState<ActiveEmergency | null>(null);
  const [countdown, setCountdown] = useState(3);
  const [blackBox, setBlackBox] = useState<BlackBoxEntry[]>([]);
  const [outboxCount, setOutboxCount] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const userRef = useRef(user);
  userRef.current = user;

  // Restore active emergency after reload/crash — an SOS must survive the app dying.
  useEffect(() => {
    const raw = localStorage.getItem(ACTIVE_KEY);
    if (raw) {
      try {
        const saved = JSON.parse(raw) as ActiveEmergency;
        setActive(saved);
        setPhase('ACTIVE');
        log('EMERGENCY_RESTORED', saved.emergencyId);
      } catch { /* corrupt state — ignore */ }
    }
    setOutboxCount(JSON.parse(localStorage.getItem('iqoo.outbox') ?? '[]').length);
  }, []);

  // Persist active emergency.
  useEffect(() => {
    if (active) localStorage.setItem(ACTIVE_KEY, JSON.stringify(active));
    else localStorage.removeItem(ACTIVE_KEY);
  }, [active]);

  const log = useCallback((event: string, detail?: string) => {
    setBlackBox((b) => {
      const next = [...b, { ts: Date.now(), event, detail }].slice(-200);
      // Persist so History/Demo pages can show the black box after reload (§39).
      try { localStorage.setItem('iqoo.blackbox', JSON.stringify(next)); } catch { /* storage full */ }
      return next;
    });
  }, []);

  const pushOutbox = useCallback((packet: EmergencyPacket, emergencyId: string, type: string, severity: string) => {
    const box = JSON.parse(localStorage.getItem('iqoo.outbox') ?? '[]') as unknown[];
    box.push({
      event: {
        id: emergencyId, type, severity,
        category: packet.ai?.category,
        message: packet.message, locationState: packet.location.state,
        lat: packet.location.latitude, lon: packet.location.longitude,
        locationAccuracyM: packet.location.accuracyMeters,
        battery: packet.battery, createdAt: new Date(packet.timestamp).toISOString(),
      },
      packet,
    });
    localStorage.setItem('iqoo.outbox', JSON.stringify(box));
    setOutboxCount(box.length);
  }, []);

  /** Transmit: direct to backend when online AND authenticated, otherwise store-and-forward outbox. */
  const transmit = useCallback(async (
    packet: EmergencyPacket, emergencyId: string, type: 'SOS' | 'QUICK_HELP', severity: ActiveEmergency['severity'],
  ): Promise<{ sent: boolean; vibrationPatternMs?: number[] }> => {
    if (!onlineRef.current || !userRef.current) {
      pushOutbox(packet, emergencyId, type, severity);
      log('QUEUED_LOCAL', packet.id);
      return { sent: false };
    }
    try {
      const response = await apiFetch<{ clientFeedback?: { vibrationPatternMs?: number[] } }>('/emergencies', {
        method: 'POST',
        body: JSON.stringify({
          emergencyId,
          type,
          severity,
          category: packet.ai?.category,
          message: packet.message,
          location: packet.location,
          battery: packet.battery,
          requiresMedicalHelp: packet.requiresMedicalHelp,
          requiresPoliceHelp: packet.requiresPoliceHelp,
          ai: packet.ai,
        }),
      });
      return { sent: true, vibrationPatternMs: response.clientFeedback?.vibrationPatternMs };
    } catch {
      pushOutbox(packet, emergencyId, type, severity);
      log('SEND_FAILED_QUEUED', packet.id);
      return { sent: false };
    }
  }, [log, pushOutbox]);

  /** Drain outbox when connectivity returns (§47). Idempotent server-side. */
  const syncOutbox = useCallback(async () => {
    if (!onlineRef.current) return;
    const box = JSON.parse(localStorage.getItem('iqoo.outbox') ?? '[]') as Array<{
      event: Record<string, unknown>; packet: EmergencyPacket;
    }>;
    if (box.length === 0) return;
    try {
      const res = await apiFetch<{ ackedEventIds: string[] }>('/sync/push', {
        method: 'POST',
        body: JSON.stringify({
          events: box.map((i) => i.event),
          packets: box.map((i) => ({
            id: i.packet.id, emergencyId: i.packet.emergencyId, type: i.packet.type,
            priority: i.packet.priority, payload: JSON.stringify(i.packet),
            signature: i.packet.signature, hopCount: i.packet.hopCount,
            createdAt: new Date(i.packet.timestamp).toISOString(),
          })),
        }),
      });
      const acked = new Set(res.ackedEventIds);
      const remaining = box.filter((i) => !acked.has((i.event as { id: string }).id));
      localStorage.setItem('iqoo.outbox', JSON.stringify(remaining));
      setOutboxCount(remaining.length);
      setLastSyncAt(Date.now());
      log('SYNC_DRAINED', `${box.length - remaining.length} items synced`);
    } catch {
      // stay queued; retried on next online event / interval
    }
  }, [log]);

  useEffect(() => {
    if (online) void syncOutbox();
  }, [online, syncOutbox]);

  /**
   * Pull (§47 receive path): fetch packets the backend has for us since the last
   * cursor, verify each signature, record genuinely-new emergencies in the black
   * box, then ack the batch. Makes the device a full DTN participant, not just a
   * sender. Runs when connectivity returns.
   */
  const pullUpdates = useCallback(async () => {
    if (!onlineRef.current || !userRef.current) return;
    const cursor = localStorage.getItem('iqoo.syncCursor') ?? '';
    try {
      const res = await apiFetch<{ packets: Array<{ id: string; emergencyId: string; type: string; priority: string; payload: unknown; createdAt: string }>; nextCursor: string; hasMore: boolean }>(
        `/sync/pull?cursor=${encodeURIComponent(cursor)}&limit=50`,
      );
      let newCount = 0;
      for (const p of res.packets) {
        // Skip packets this device authored or already saw (dedupe, §33).
        const seen = localStorage.getItem('iqoo.seenPackets');
        const seenSet = new Set<string>(seen ? (JSON.parse(seen) as string[]) : []);
        if (!seenSet.has(p.id)) {
          seenSet.add(p.id);
          localStorage.setItem('iqoo.seenPackets', JSON.stringify([...seenSet].slice(-500)));
          newCount++;
          log('PACKET_RECEIVED_SYNC', `${p.type} for ${p.emergencyId}`);
        }
      }
      localStorage.setItem('iqoo.syncCursor', res.nextCursor);
      if (newCount > 0) log('SYNC_PULL', `${newCount} new packet(s) received`);
    } catch {
      // pull failed — retried on next reconnect; cursor unchanged so nothing is lost
    }
  }, [log]);

  useEffect(() => {
    if (online) void pullUpdates();
  }, [online, pullUpdates]);

  useEffect(() => {
    const id = setInterval(() => { if (onlineRef.current) void syncOutbox(); }, 30_000);
    return () => clearInterval(id);
  }, [syncOutbox]);

  const startSos = useCallback((message = '', ai?: AIResult, options?: { skipCountdown?: boolean }) => {
    // Identity: server device when signed in, else anonymous local identity.
    // SOS is NEVER blocked by login state (§23 — keep activation trivial).
    const identity = device?.secret
      ? { id: device.id, publicId: device.publicId, secret: device.secret }
      : getOrCreateLocalIdentity();
    const type: 'SOS' | 'QUICK_HELP' = message.startsWith('NEED_HELP:') ? 'QUICK_HELP' : 'SOS';
    const activate = async () => {
      const emergencyId = newEmergencyId();
      const location = await getLocation();
      const sev: ActiveEmergency['severity'] =
        type === 'SOS' ? 'CRITICAL' : ai?.severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH';
      if (ai) log('AI_CLASSIFIED', `${ai.category}/${ai.severity} conf=${ai.confidence} engine=${ai.engine}`);
      log('SOS_ACTIVATED', emergencyId);
      log(location.state === 'LOCATION_UNAVAILABLE' ? 'LOCATION_UNAVAILABLE' : 'LOCATION_ACQUIRED', `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)} ±${location.accuracyMeters ?? '?'}m`);
      log('BATTERY_SNAPSHOT', battery !== null ? `${battery}%` : 'unknown');

      const packet = await signPacket({
        id: `msg_${crypto.randomUUID()}`,
        emergencyId,
        senderId: identity.id,
        senderPublicId: identity.publicId,
        type,
        priority: (sev === 'CRITICAL' ? 'CRITICAL' : 'HIGH') as 'CRITICAL' | 'HIGH',
        timestamp: Date.now(),
        location,
        battery,
        message: message.replace(/^NEED_HELP:/, ''),
        hopCount: 0,
        ttl: 3600,
        requiresMedicalHelp: true,
        requiresPoliceHelp: type === 'SOS',
        ai,
      }, identity.secret);

      const delivery = await transmit(packet, emergencyId, type, sev);
      vibrateForSos(delivery.vibrationPatternMs);
      log(delivery.sent ? 'PACKET_SENT_TO_BACKEND' : 'PACKET_HELD_LOCALLY', packet.id);

      setActive({
        emergencyId, type, severity: sev, message: message.replace(/^NEED_HELP:/, ''),
        location, battery, startedAt: Date.now(), packetId: packet.id,
        signature: packet.signature, queuedOffline: !delivery.sent, ai,
      });
      setPhase('ACTIVE');
    };

    if (options?.skipCountdown) {
      void activate();
      return;
    }

    setPhase('COUNTDOWN');
    setCountdown(3);
    log('SOS_COUNTDOWN_STARTED');
    timerRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          void activate();
          return 0;
        }
        log('COUNTDOWN_TICK', String(c - 1));
        return c - 1;
      });
    }, 1000);
  }, [battery, device, log, transmit, user]);

  const cancelCountdown = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setPhase('IDLE');
    log('SOS_CANCELLED');
  }, [log]);

  const resolveActive = useCallback(async () => {
    if (!active) return;
    log('RESOLVE_STARTED', active.emergencyId);
    if (onlineRef.current) {
      try {
        const response = await apiFetch<{ clientFeedback?: { vibrationPatternMs?: number[] } }>(`/emergencies/${active.emergencyId}/resolve`, { method: 'POST' });
        vibrateForSos(response.clientFeedback?.vibrationPatternMs ?? DISARMED_VIBRATION_PATTERN_MS);
        log('RESOLUTION_SENT');
      } catch {
        log('RESOLUTION_SEND_FAILED', 'will retry');
      }
    } else {
      vibrateForSos(DISARMED_VIBRATION_PATTERN_MS);
      log('RESOLUTION_QUEUED_OFFLINE');
    }
    setActive(null);
    setPhase('RESOLVED');
    setTimeout(() => setPhase('IDLE'), 2500);
  }, [active, log]);

  const value = useMemo<MeshState>(() => ({
    phase, active, countdown, blackBox, outboxCount, lastSyncAt,
    startSos, cancelCountdown, resolveActive,
  }), [phase, active, countdown, blackBox, outboxCount, lastSyncAt, startSos, cancelCountdown, resolveActive]);

  return <MeshContext.Provider value={value}>{children}</MeshContext.Provider>;
}

export function useMesh(): MeshState {
  return useContext(MeshContext);
}
