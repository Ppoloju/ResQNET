// Situation reports — disaster-mode bulletins (§13).
//
// Short, human-written status updates ("Bridge collapsed ahead", "Shelter open
// at school") that propagate through the mesh like any other packet and are
// surfaced by devices in DISASTER/EMERGENCY mode. Kind is a fixed enum so the
// UI can group and pin by type. AI tagging only marks stale bulletins — it
// never invents or rewrites content.

export type SitrepKind = 'HAZARD' | 'SHELTER' | 'ROAD' | 'SUPPLIES' | 'RESOLVED';

export interface Sitrep {
  kind: SitrepKind;
  text: string;
  lat: number | null;
  lon: number | null;
  createdAt: number;
  authorId: string;
}

/** Max bulletin text on the wire — mesh bandwidth budget (§13). */
export const SITREP_MAX_LEN = 280;

const KINDS: readonly SitrepKind[] = ['HAZARD', 'SHELTER', 'ROAD', 'SUPPLIES', 'RESOLVED'];

export function validateSitrep(s: unknown): { valid: boolean; problem?: string } {
  const r = s as Partial<Sitrep> | null;
  if (!r || typeof r !== 'object') return { valid: false, problem: 'not an object' };
  if (!KINDS.includes(r.kind as SitrepKind)) return { valid: false, problem: 'invalid kind' };
  if (typeof r.text !== 'string' || r.text.trim().length === 0 || r.text.length > SITREP_MAX_LEN) {
    return { valid: false, problem: `text must be 1..${SITREP_MAX_LEN} chars` };
  }
  if (typeof r.createdAt !== 'number' || r.createdAt <= 1_600_000_000_000) {
    return { valid: false, problem: 'createdAt out of range' };
  }
  if (typeof r.authorId !== 'string' || r.authorId.length === 0) {
    return { valid: false, problem: 'missing authorId' };
  }
  return { valid: true };
}

/** Bulletins older than this are flagged STALE in the UI (still visible). */
export const SITREP_STALE_MS = 6 * 3600_000;

export function isStale(sitrep: Sitrep, now = Date.now()): boolean {
  return now - sitrep.createdAt > SITREP_STALE_MS;
}
