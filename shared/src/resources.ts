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

/** Kind ranking is only a tie-breaker after geographic distance. */
const KIND_ORDER: Record<ResourceKind, number> = {
  MEDICAL: 0, POLICE: 1, SHELTER: 2, SAFE_ZONE: 3, WATER: 4, SUPPLIES: 5,
};

/**
 * Rank resources by geographic distance from the user. Kind is only a stable
 * tie-breaker so a farther hospital never displaces a nearer resource.
 */
export function rankResources<T extends ResourcePoint>(
  points: T[],
  userLat: number,
  userLon: number,
): Array<T & { distanceM: number }> {
  return points
    .map((p) => ({ ...p, distanceM: haversineMeters(userLat, userLon, p.lat, p.lon) }))
    .sort((a, b) => {
      const distance = a.distanceM - b.distanceM;
      if (Math.abs(distance) > 1) return distance;
      const k = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
      if (k !== 0) return k;
      return a.distanceM - b.distanceM;
    });
}
