// 3-Mode Architecture (§13, Phase 13): Normal → Emergency → Disaster.
//
// The mode is a derived view of observable facts, never a hidden global toggle:
//  - Normal    — no active SOS, no disaster signals.
//  - Emergency — this device (or a family/gateway emergency) has an active SOS,
//                or a CRITICAL/HIGH emergency broadcast is circulating nearby.
//  - Disaster  — a DISASTER_BROADCAST is active (official/seeded declaration), or
//                enough distinct emergencies cluster in time+space to indicate a
//                region-scale event (crowd-sourced detection, §13).
//
// Deriving keeps three honest properties: the mode survives restarts (recomputed
// from persisted facts), it can never get stuck (transitions are pure functions),
// and the UI can always explain WHY the mode changed.

import type { EmergencyCategory, Priority } from './types.js';

export type AppMode = 'NORMAL' | 'EMERGENCY' | 'DISASTER';

export interface ModeInput {
  /** An SOS / QUICK_HELP is actively open on this device or its family circle. */
  activeEmergency: boolean;
  /** A DISASTER_BROADCAST (from gateway/officials) is active. */
  disasterBroadcast: boolean;
  /** Distinct recent emergencies near the device (crowd-sourced detection). */
  nearbyEmergencyIds: string[];
  /** Window for cluster detection (ms). Default 30 min. */
  clusterWindowMs?: number;
}

export interface ModeDecision {
  mode: AppMode;
  reason: string;
}

export const DEFAULT_CLUSTER_WINDOW_MS = 30 * 60_000;
/** N distinct emergencies within the window ⇒ region-scale event (§13). */
export const DISASTER_CLUSTER_THRESHOLD = 5;

export function deriveMode(input: ModeInput): ModeDecision {
  if (input.disasterBroadcast) {
    return { mode: 'DISASTER', reason: 'Disaster broadcast active for this region' };
  }
  const window = input.clusterWindowMs ?? DEFAULT_CLUSTER_WINDOW_MS;
  // Cluster membership is time-agnostic here: the caller passes only *current*
  // ids (older ones fall out as they age out of its sliding window).
  if (input.nearbyEmergencyIds.length >= DISASTER_CLUSTER_THRESHOLD) {
    return {
      mode: 'DISASTER',
      reason: `${input.nearbyEmergencyIds.length} distinct emergencies within ${Math.round(window / 60_000)} min — region-scale event`,
    };
  }
  if (input.activeEmergency) {
    return { mode: 'EMERGENCY', reason: 'Emergency in progress (SOS active)' };
  }
  return { mode: 'NORMAL', reason: 'No active emergency' };
}

/** True when the category is a region-scale hazard that should raise cluster weight (§13). */
export function isDisasterCategory(category: EmergencyCategory | null | undefined): boolean {
  return category === 'NATURAL_DISASTER' || category === 'FIRE';
}

/**
 * Priority a packet should carry under the current mode (§13 priority routing).
 * Disaster mode promotes life-safety traffic one notch; CRITICAL never degrades.
 */
export function priorityForMode(base: Priority, mode: AppMode): Priority {
  if (mode !== 'DISASTER' || base === 'CRITICAL') return base;
  return base === 'HIGH' ? 'CRITICAL' : base === 'MEDIUM' ? 'HIGH' : 'MEDIUM';
}
