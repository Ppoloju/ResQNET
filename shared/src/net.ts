// Networking helpers shared by client, backend and simulator (§19, §37).

/** Great-circle distance in meters (haversine). Pure function, no dependencies. */
export function haversineMeters(
  aLat: number, aLon: number, bLat: number, bLon: number,
): number {
  const R = 6_371_000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Rough compass bearing label from a → b (for "Nearby Help" lists). */
export function bearingLabel(
  aLat: number, aLon: number, bLat: number, bLon: number,
): string {
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
  return dirs[Math.round(deg / 45) % 8];
}

export interface RelayReadinessInput {
  batteryPercent: number | null;
  /** End-to-end reachability (e.g. /healthz probe), not just navigator.onLine. */
  connected: boolean;
  /** User consent to act as a relay for others (§37). */
  userConsent: boolean;
  /** Foreground/page active — browsers can't network in background anyway. */
  foreground: boolean;
  /** Roles are ranked; relay readiness favors relay-capable roles. */
  role?: 'NORMAL' | 'RELAY' | 'RESPONDER' | 'GATEWAY';
  /**
   * Hardware radio endurance class (iQOO enhancement, §29): a bigger cell +
   * bypass charging mean the device can afford far more relay work per %
   * of battery. Self-reported, never fabricated by the app.
   */
  hardwareTier?: 'standard' | 'large_cell' | 'large_cell_bypass';
}

export interface RelayReadiness {
  /** 0 (won't relay) .. 100 (ideal relay). */
  score: number;
  tier: 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH';
  reason: string;
}

/**
 * Relay Readiness (§37): an honest, privacy-preserving self-assessment.
 * Exposes nothing sensitive to the network — used locally to decide relay behavior
 * and shown to the user to explain WHY their device is/isn't relaying.
 */
export function relayReadiness(input: RelayReadinessInput): RelayReadiness {
  if (!input.userConsent) {
    return { score: 0, tier: 'OFF', reason: 'Relaying turned off in settings' };
  }
  if (!input.foreground) {
    return { score:0, tier: 'OFF', reason: 'App in background (browser limitation)' };
  }
  // Hardware endurance class (iQOO enhancement): a 6000 mAh-class cell with
  // bypass charging can sustain relay duty far below the standard 20% floor
  // before it must conserve for self-preservation.
  const hwTier = input.hardwareTier ?? 'standard';
  const enduranceFloor = hwTier === 'large_cell_bypass' ? 10 : hwTier === 'large_cell' ? 15 : 20;
  if (input.batteryPercent !== null && input.batteryPercent < enduranceFloor) {
    return {
      score: 10,
      tier: 'LOW',
      reason: `Battery below ${enduranceFloor}% — CRITICAL packets only` +
        (hwTier !== 'standard' ? ` (${hwTier === 'large_cell_bypass' ? 'large cell + bypass' : 'large cell'} endurance)` : ''),
    };
  }
  let score = 50;
  const reasons: string[] = [];
  if (input.batteryPercent !== null) {
    if (input.batteryPercent >= 80) { score += 25; reasons.push('strong battery'); }
    else if (input.batteryPercent >= 50) { score += 10; reasons.push('good battery'); }
    else { score += 0; reasons.push('moderate battery'); }
  } else {
    reasons.push('battery unknown');
  }
  if (hwTier !== 'standard') {
    score = Math.min(100, score + (hwTier === 'large_cell_bypass' ? 15 : 10));
    reasons.push(hwTier === 'large_cell_bypass' ? 'large-cell + bypass-charging endurance' : 'large-cell endurance');
  }
  if (input.connected) { score += 15; reasons.push('gateway reachable'); }
  if (input.role === 'GATEWAY' || input.role === 'RESPONDER') { score = Math.min(100, score + 20); reasons.push('responder role'); }
  const tier = score >= 80 ? 'HIGH' : score >= 50 ? 'MEDIUM' : 'LOW';
  return { score: Math.min(100, score), tier, reason: reasons.join(', ') || 'default' };
}
