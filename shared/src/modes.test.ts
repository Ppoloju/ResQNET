// §13 Phase 13 unit tests: mode derivation, priority routing, guidance lookup,
// resource ranking, and sitrep validation — the offline logic that needs no IO.

import { describe, it, expect } from 'vitest';
import { deriveMode, priorityForMode, isDisasterCategory, DISASTER_CLUSTER_THRESHOLD } from './modes.js';
import { findGuidance, guidanceForCategory, GUIDANCE_TOPICS } from './guidance.js';
import { rankResources, type ResourcePoint } from './resources.js';
import { validateSitrep, isStale, SITREP_MAX_LEN, SITREP_STALE_MS } from './sitrep.js';
import type { EmergencyCategory } from './types.js';

describe('mode derivation (§13)', () => {
  it('is NORMAL when nothing is happening', () => {
    const d = deriveMode({ activeEmergency: false, disasterBroadcast: false, nearbyEmergencyIds: [] });
    expect(d.mode).toBe('NORMAL');
    expect(d.reason).toBeTruthy();
  });

  it('is EMERGENCY on an active SOS alone', () => {
    const d = deriveMode({ activeEmergency: true, disasterBroadcast: false, nearbyEmergencyIds: [] });
    expect(d.mode).toBe('EMERGENCY');
  });

  it('is DISASTER on an official broadcast even without emergencies', () => {
    const d = deriveMode({ activeEmergency: false, disasterBroadcast: true, nearbyEmergencyIds: [] });
    expect(d.mode).toBe('DISASTER');
  });

  it('rises to DISASTER from crowd-sourced clustering only at threshold', () => {
    const ids = Array.from({ length: DISASTER_CLUSTER_THRESHOLD - 1 }, (_, i) => `IQ-C${i}`);
    expect(deriveMode({ activeEmergency: true, disasterBroadcast: false, nearbyEmergencyIds: ids }).mode).toBe('EMERGENCY');
    ids.push('IQ-CLUSTER');
    const d = deriveMode({ activeEmergency: false, disasterBroadcast: false, nearbyEmergencyIds: ids });
    expect(d.mode).toBe('DISASTER');
    expect(d.reason).toContain('distinct emergencies');
  });
});

describe('priority routing under modes (§13)', () => {
  it('promotes life-safety traffic in DISASTER mode one notch', () => {
    expect(priorityForMode('MEDIUM', 'DISASTER')).toBe('HIGH');
    expect(priorityForMode('HIGH', 'DISASTER')).toBe('CRITICAL');
  });

  it('never changes priorities outside disaster mode', () => {
    expect(priorityForMode('MEDIUM', 'NORMAL')).toBe('MEDIUM');
    expect(priorityForMode('HIGH', 'EMERGENCY')).toBe('HIGH');
  });

  it('never degrades CRITICAL', () => {
    expect(priorityForMode('CRITICAL', 'NORMAL')).toBe('CRITICAL');
    expect(priorityForMode('CRITICAL', 'DISASTER')).toBe('CRITICAL');
  });
});

describe('disaster categories', () => {
  it('flags NATURAL_DISASTER and FIRE as region-scale', () => {
    expect(isDisasterCategory('NATURAL_DISASTER')).toBe(true);
    expect(isDisasterCategory('FIRE')).toBe(true);
    expect(isDisasterCategory('MEDICAL')).toBe(false);
    expect(isDisasterCategory(null)).toBe(false);
  });
});

describe('guidance lookup (§13 offline assistant)', () => {
  it('matches free text to the right topic', () => {
    expect(findGuidance('the wound is bleeding a lot')?.id).toBe('severe_bleeding');
    expect(findGuidance('I think I broke my arm')?.id).toBe('fracture_fall');
    expect(findGuidance('there is a small fire in the kitchen')?.id).toBe('burns');
    expect(findGuidance('how do I evacuate the building')?.id).toBe('evacuation');
    expect(findGuidance('the weather is nice')).toBeNull();
  });

  it('maps AI categories to topics', () => {
    expect(guidanceForCategory('MEDICAL')?.id).toBe('severe_bleeding');
    expect(guidanceForCategory('FIRE')?.id).toBe('burns');
    const nonMedical: EmergencyCategory = 'PERSONAL_SAFETY';
    expect(guidanceForCategory(nonMedical)).toBeNull();
  });

  it('every topic carries steps, escalation and an honest disclaimer (honesty policy)', () => {
    for (const topic of Object.values(GUIDANCE_TOPICS)) {
      expect(topic.steps.length).toBeGreaterThan(0);
      expect(topic.escalate.length).toBeGreaterThan(0);
      // Medical topics carry the standard disclaimer; non-medical ones (evacuation)
      // carry their own honest "not a replacement" wording.
      expect(topic.disclaimer.length).toBeGreaterThan(20);
    }
  });
});

describe('resource ranking (§13)', () => {
  const points: ResourcePoint[] = [
    { id: 'a', kind: 'WATER', name: 'Water', lat: 12.9716, lon: 77.5946, capacityNote: null, verifiedAt: '2026-09', source: 'seed' },
    { id: 'b', kind: 'SHELTER', name: 'Shelter', lat: 12.9800, lon: 77.6000, capacityNote: null, verifiedAt: '2026-09', source: 'seed' },
    { id: 'c', kind: 'MEDICAL', name: 'Medical', lat: 13.0000, lon: 77.7000, capacityNote: null, verifiedAt: '2026-09', source: 'seed' },
  ];

    it('ranks by distance first, then kind for ties', () => {
    const ranked = rankResources(points, 12.9716, 77.5946);
    // MEDICAL first, then SHELTER, then WATER (kind order), distance as tiebreak.
      // The nearest resource wins regardless of category; kind only stabilizes ties.
      expect(ranked.map((r) => r.id)).toEqual(['a', 'b', 'c']);
      expect(ranked[0].distanceM).toBeCloseTo(0, 0);
  });
});

describe('sitrep validation (§13)', () => {
  const valid = {
    kind: 'HAZARD' as const, text: 'Bridge collapsed ahead', lat: 12.9, lon: 77.6,
    createdAt: Date.now(), authorId: 'usr_1',
  };

  it('accepts a valid bulletin', () => {
    expect(validateSitrep(valid).valid).toBe(true);
  });

  it('rejects bad kind, empty text, oversize text, bad timestamps', () => {
    expect(validateSitrep({ ...valid, kind: 'NOPE' }).valid).toBe(false);
    expect(validateSitrep({ ...valid, text: '  ' }).valid).toBe(false);
    expect(validateSitrep({ ...valid, text: 'x'.repeat(SITREP_MAX_LEN + 1) }).valid).toBe(false);
    expect(validateSitrep({ ...valid, createdAt: 1_000 }).valid).toBe(false);
    expect(validateSitrep(null).valid).toBe(false);
  });

  it('marks bulletins stale after the window', () => {
    expect(isStale(valid)).toBe(false);
    expect(isStale({ ...valid, createdAt: Date.now() - SITREP_STALE_MS - 1 })).toBe(true);
  });
});
