// Resource mapping (§13): AI-tagged safe zones / shelters / medical points for
// Disaster Mode. Honest-scope note: with no live datasets available offline, the
// backend seeds a small reviewed dataset and serves it nearby-first (haversine,
// reusing the same math as the Nearby Help list). Each entry is user-verifiable
// ("verified 2026-09") — the UI shows freshness and source, never a map pin
// pretending to be live government data.

import { haversineMeters } from './net.js';

export type ResourceKind = 'SHELTER' | 'MEDICAL' | 'POLICE' | 'SAFE_ZONE' | 'WATER' | 'SUPPLIES';

export interface ResourcePoint {
  id: string;
  kind: ResourceKind;
  name: string;
  lat: number;
  lon: number;
  /** Free-text capacity/notes shown in the list ("200 people, generator"). */
  capacityNote: string | null;
  /** Human-verifiable freshness — never fabricated as "live". */
  verifiedAt: string;
  source: string;
}

/** Severity ranking for stable list ordering. */
const KIND_ORDER: Record<ResourceKind, number> = {
  MEDICAL: 0, POLICE: 1, SHELTER: 2, SAFE_ZONE: 3, WATER: 4, SUPPLIES: 5,
};

/**
 * Rank resources by distance from the user with a small kind-priority tiebreak
 * (a shelter 10 m farther than a water point still ranks first).
 */
export function rankResources<T extends ResourcePoint>(
  points: T[],
  userLat: number,
  userLon: number,
): Array<T & { distanceM: number }> {
  return points
    .map((p) => ({ ...p, distanceM: haversineMeters(userLat, userLon, p.lat, p.lon) }))
    .sort((a, b) => {
      const k = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
      if (k !== 0) return k;
      return a.distanceM - b.distanceM;
    });
}
