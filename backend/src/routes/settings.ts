import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { audit } from '../middleware/audit.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';

export const settingsRouter = Router();

const settingsSchema = z.object({
  relayConsent: z.boolean(), lowPowerMode: z.boolean(), criticalThresholdPct: z.number().int().min(5).max(40),
  relayHeroMode: z.boolean(),
});

const defaults = {
  relayConsent: true, lowPowerMode: false, criticalThresholdPct: 20, relayHeroMode: false,
};

function deviceId(req: AuthedRequest): string | undefined {
  if (req.user?.deviceId) return req.user.deviceId;
  const userId = req.user?.userId;
  if (!userId) return undefined;
  return (db.prepare('SELECT id FROM devices WHERE user_id = ? ORDER BY created_at LIMIT 1').get(userId) as { id: string } | undefined)?.id;
}

function read(device: string) {
  const row = db.prepare('SELECT * FROM device_settings WHERE device_id = ?').get(device) as Record<string, unknown> | undefined;
  if (!row) return defaults;
  return {
    relayConsent: !!row.relay_consent, lowPowerMode: !!row.low_power_mode,
    criticalThresholdPct: row.critical_threshold_pct,
    relayHeroMode: !!row.relay_hero_mode,
  };
}

settingsRouter.get('/', requireAuth, (req: AuthedRequest, res) => {
  const id = deviceId(req);
  if (!id) { res.status(404).json({ error: 'device not found' }); return; }
  res.json({ settings: read(id) });
});

settingsRouter.put('/', requireAuth, (req: AuthedRequest, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation failed', issues: parsed.error.issues }); return; }
  const id = deviceId(req);
  if (!id) { res.status(404).json({ error: 'device not found' }); return; }
  const p = parsed.data;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO device_settings (device_id, relay_consent, low_power_mode, critical_threshold_pct,
      relay_hero_mode, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(device_id) DO UPDATE SET
      relay_consent=excluded.relay_consent, low_power_mode=excluded.low_power_mode,
        critical_threshold_pct=excluded.critical_threshold_pct, relay_hero_mode=excluded.relay_hero_mode, updated_at=excluded.updated_at
      `).run(id, p.relayConsent ? 1 : 0, p.lowPowerMode ? 1 : 0, p.criticalThresholdPct, p.relayHeroMode ? 1 : 0, now);
  audit(req.user!.userId, 'settings.update', 'device_settings', id);
  res.json({ settings: p, updatedAt: now });
});