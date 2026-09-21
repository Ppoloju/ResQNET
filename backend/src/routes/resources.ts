// Resource mapping API (§13): safe zones / shelters / medical points served
// nearby-first. The dataset is a small reviewed seed (demo region), ranked with
// the same haversine math as Nearby Help. Entries carry verifiedAt + source so
// the UI can show freshness honestly — no live government feed is claimed.

import { Router } from 'express';
import { z } from 'zod';
import type { ResourcePoint } from '@iqoo/shared';
import { rankResources } from '@iqoo/shared';
import type { AuthedRequest } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';

export const resourcesRouter = Router();

/** Reviewed demo dataset (§13 resource mapping). Replace via admin feed [R]. */
const SEED_RESOURCES: ResourcePoint[] = [
  { id: 'res_shelter_1', kind: 'SHELTER', name: 'Govt High School Relief Shelter', lat: 12.9716, lon: 77.5946, capacityNote: '400 people, generator, drinking water', verifiedAt: '2026-09-01', source: 'District disaster plan (demo seed)' },
  { id: 'res_medical_1', kind: 'MEDICAL', name: 'City General Hospital — Emergency Wing', lat: 12.9698, lon: 77.6101, capacityNote: '24/7 trauma + triage', verifiedAt: '2026-09-01', source: 'District disaster plan (demo seed)' },
  { id: 'res_medical_2', kind: 'MEDICAL', name: 'Community Health Centre, Ward 12', lat: 12.9352, lon: 77.6245, capacityNote: 'Daytime only; first aid + stabilisation', verifiedAt: '2026-08-20', source: 'Ward office notice (demo seed)' },
  { id: 'res_police_1', kind: 'POLICE', name: 'Central Police Station', lat: 12.9757, lon: 77.6042, capacityNote: 'Emergency desk and public assistance', verifiedAt: '2026-09-01', source: 'District emergency directory (demo seed)' },
  { id: 'res_police_2', kind: 'POLICE', name: 'Ward 12 Police Outpost', lat: 12.9458, lon: 77.6132, capacityNote: 'Local response and incident reporting', verifiedAt: '2026-08-20', source: 'District emergency directory (demo seed)' },
  { id: 'res_safe_1', kind: 'SAFE_ZONE', name: 'Public Library Assembly Point', lat: 12.9812, lon: 77.6065, capacityNote: 'Open ground, no flood history', verifiedAt: '2026-09-01', source: 'District disaster plan (demo seed)' },
  { id: 'res_water_1', kind: 'WATER', name: 'Municipal Water Tanker Point', lat: 12.9608, lon: 77.5853, capacityNote: 'Refill station, bring containers', verifiedAt: '2026-08-28', source: 'Municipal board (demo seed)' },
  { id: 'res_supplies_1', kind: 'SUPPLIES', name: 'Relief Supply Depot', lat: 12.9903, lon: 77.5902, capacityNote: 'Food kits + blankets, ID required', verifiedAt: '2026-09-01', source: 'District disaster plan (demo seed)' },
];

const nearbySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

const MAX_RELEVANT_DISTANCE_M = 50_000;

/** Nearby resource points, MEDICAL/SHELTER kind-prioritized then by distance. */
resourcesRouter.get('/nearby', requireAuth, (req: AuthedRequest, res) => {
  const parsed = nearbySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation failed', issues: parsed.error.issues });
    return;
  }
  const { lat, lon, limit } = parsed.data;
  const ranked = rankResources(SEED_RESOURCES, lat, lon)
    .filter((resource) => resource.distanceM <= MAX_RELEVANT_DISTANCE_M);
  res.json({
    resources: (limit ? ranked.slice(0, limit) : ranked).map((r) => ({
      ...r,
      // Round for display sanity; raw meters kept for sorting upstream.
      distanceM: Math.round(r.distanceM),
    })),
    note: 'Reviewed seed dataset, limited to points within 50 km — verify locally before relying on any point (§13 honest scope).',
  });
});
