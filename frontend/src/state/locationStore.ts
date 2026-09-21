// Tiny module-level store of the latest high-accuracy GPS fix.
//
// The Home map watches the device GPS continuously (watchPosition). When SOS
// activates we reuse the freshest fix (< 15 s) so the emergency packet carries
// the exact current position instantly instead of waiting for a new lock, with
// the classic getCurrentPosition path as fallback. Set only from real device
// fixes — nothing here is ever fabricated.

export interface StoredFix {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  ts: number;
}

let latest: StoredFix | null = null;

export function setLatestFix(fix: Omit<StoredFix, 'ts'>): void {
  latest = { ...fix, ts: Date.now() };
}

export function getLatestFix(maxAgeMs = 15_000): StoredFix | null {
  if (!latest) return null;
  return Date.now() - latest.ts <= maxAgeMs ? latest : null;
}
