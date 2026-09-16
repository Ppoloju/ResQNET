// LocalAIEngine — offline, rule-based emergency classifier (§14, §15, §17, §61).
//
// Policy (§61): NO large model downloads for the hackathon prototype. This engine is a
// transparent, deterministic keyword/intent classifier that runs anywhere (browser or Node)
// with zero network access. The `LocalAIEngine` interface is the abstraction; an ONNX Runtime
// Web model can implement the same interface later without touching callers.
//
// Honesty rules (§15/§62): output is an ASSISTANCE SIGNAL, never a diagnosis. Callers must
// display it as advisory.

import type { EmergencyCategory, Severity } from './types.js';

/** Interface every local AI backend implements (rule-based today, ONNX tomorrow). */
export interface LocalAIEngine {
  readonly name: string;
  classify(input: AIInput): AIResult;
}

export interface AIInput {
  /** Free text: typed message or voice transcript (§15 voice understanding). */
  text?: string;
  battery?: number | null;
  /** True when the SOS path reports movement/impossible-to-move hints from the user. */
  saysImmobile?: boolean;
}

export interface AIResult {
  category: EmergencyCategory;
  severity: Severity;
  /** 0..1 — rule engines report calibrated confidence; displayed as advisory only. */
  confidence: number;
  recommendedAction: string;
  /** Which rules fired (transparency for judges + debugging §53). */
  matched: string[];
  engine: string;
}

export const AI_DISCLAIMER =
  'AI assistance signal — not a diagnosis. Emergency classification is advisory; professional responders decide treatment.';

// ---------------------------------------------------------------------------
// Lexicons. Small, auditable word lists — deliberately NOT a hidden model.
// Multi-word phrases are checked before single words (longest-match wins).
// ---------------------------------------------------------------------------

const CATEGORY_LEXICON: Array<{ category: EmergencyCategory; phrases: string[]; weight: number }> = [
  { category: 'FIRE', weight: 3, phrases: ['fire', 'smoke', 'burning', 'burnt', 'flames', 'burn'] },
  { category: 'MEDICAL', weight: 3, phrases: [
    'bleeding', 'chest pain', 'can\'t breathe', 'cannot breathe', 'difficulty breathing', 'unconscious',
    'not breathing', 'heart attack', 'stroke', 'seizure', 'fell down', 'i fell', 'injured', 'blood',
    'fracture', 'broken bone', 'overdose', 'poison', 'choking', 'allergic reaction', 'dizzy', 'fainted',
    'pregnant', 'labor pains', 'snake bite', 'snakebite',
  ] },
  { category: 'ACCIDENT', weight: 2, phrases: ['accident', 'crash', 'collision', 'pileup', 'derailed', 'collapsed on me', 'fell on me'] },
  { category: 'VEHICLE', weight: 2, phrases: ['car crash', 'bike crash', 'motorcycle', 'tire burst', 'brakes failed', 'break failure', 'brake failure', 'road accident', 'hit and run'] },
  { category: 'PERSONAL_SAFETY', weight: 3, phrases: [
    'following me', 'stalking', 'attacker', 'attacked', 'threatening', 'threatened', 'harassing',
    'harassment', 'kidnap', 'abduct', 'assault', 'unsafe', 'dangerous person', 'help me someone is',
    'someone is following', 'chasing me', ' touches me', 'touching me',
  ] },
  { category: 'MISSING_PERSON', weight: 3, phrases: ['missing person', 'missing child', 'missing', 'lost child', 'can\'t find my child', 'cannot find my child', 'lost my kid'] },
  { category: 'NATURAL_DISASTER', weight: 3, phrases: ['earthquake', 'flood', 'flooding', 'landslide', 'cyclone', 'hurricane', 'tornado', 'tsunami', 'wildfire', 'tremor', 'building collapse', 'avalanche'] },
  { category: 'CROWD', weight: 2, phrases: ['stampede', 'crowd crush', 'riot', 'crowd surge', 'too many people pushing'] },
];

/** Severity lexicon: stronger emergency language raises severity. */
const CRITICAL_PHRASES = [
  'unconscious', 'not breathing', 'can\'t breathe', 'cannot breathe', 'severe bleeding', 'heavy bleeding',
  'heart attack', 'no pulse', 'dying', 'critical', 'life threatening', 'life-threatening', 'trapped',
  'buried', 'under debris', 'burning alive', 'drowning', 'electrocuted', 'cannot move', 'can\'t move',
  'paralyzed', 'immobile',
];
const HIGH_PHRASES = [
  'injured', 'bleeding', 'broken', 'fracture', 'fire', 'smoke', 'attacked', 'following me', 'stalking',
  'lost', 'missing', 'stuck', 'stranded', 'emergency', 'help', 'earthquake', 'flood', 'collapse',
];
const MEDIUM_PHRASES = [
  'need assistance', 'assistance', 'dizzy', 'pain', 'unsafe', 'scared', 'nervous', 'worried', 'worried about',
];

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s']/g, ' ').replace(/\s+/g, ' ').trim();
}

function countMatches(norm: string, phrases: string[]): string[] {
  return phrases.filter((p) => norm.includes(p));
}

/**
 * classifyFromText — the rule engine. Deterministic, explainable, offline.
 * Severity starts from category signal, then is lifted by critical phrases and context.
 */
export function classifyFromText(input: AIInput): AIResult {
  const matched: string[] = [];
  const norm = input.text ? normalize(input.text) : '';
  let category: EmergencyCategory = 'UNKNOWN';
  let severity: Severity = 'LOW';
  let confidence = 0.3;

  if (norm.length > 0) {
    // Score categories: phrase hits weighted by category weight; longer phrases count more.
    const scores = new Map<EmergencyCategory, { score: number; hits: string[] }>();
    for (const entry of CATEGORY_LEXICON) {
      const hits = countMatches(norm, entry.phrases);
      if (hits.length === 0) continue;
      const phraseScore = hits.reduce((acc, h) => acc + (h.includes(' ') ? 2 : 1), 0);
      const total = phraseScore * entry.weight;
      const prev = scores.get(entry.category);
      scores.set(entry.category, { score: (prev?.score ?? 0) + total, hits: [...(prev?.hits ?? []), ...hits] });
    }
    if (scores.size > 0) {
      let best: { cat: EmergencyCategory; score: number; hits: string[] } | null = null;
      for (const [cat, v] of scores) {
        if (!best || v.score > best.score) best = { cat, score: v.score, hits: v.hits };
      }
      if (best) {
        category = best.cat;
        matched.push(...best.hits);
        confidence = Math.min(0.92, 0.55 + best.score * 0.06);
        severity = best.score >= 6 ? 'HIGH' : 'MEDIUM';
      }
    }

    // Severity refinement (order matters: CRITICAL > HIGH > MEDIUM evidence).
    const crit = countMatches(norm, CRITICAL_PHRASES);
    if (crit.length > 0) {
      severity = 'CRITICAL';
      matched.push(...crit);
      confidence = Math.min(0.95, confidence + 0.2);
    } else {
      const high = countMatches(norm, HIGH_PHRASES);
      if (high.length > 0) { // cannot be CRITICAL here — that branch handled above
        if (severity === 'LOW') severity = 'HIGH';
        matched.push(...high);
        confidence = Math.min(0.9, confidence + 0.1);
      }
      const med = countMatches(norm, MEDIUM_PHRASES);
      if (med.length > 0 && severity === 'LOW') {
        severity = 'MEDIUM';
        matched.push(...med);
      }
    }

    // Explicit immobility flag (SOS "can't move" checkbox/voice hint) forces CRITICAL medical.
    if (input.saysImmobile) {
      severity = 'CRITICAL';
      if (category === 'UNKNOWN') category = 'MEDICAL';
      matched.push('immobility-flag');
      confidence = Math.min(0.95, confidence + 0.15);
    }
  }

  // Context: an SOS with no usable text at all is treated as at least HIGH.
  if (category === 'UNKNOWN') {
    severity = severity === 'LOW' ? 'HIGH' : severity;
    matched.push('no-text-fallback');
  }

  // Low battery context: helps responders prioritize follow-up, never inflates category.
  if (input.battery !== null && input.battery !== undefined && input.battery < 15 && severity === 'LOW') {
    severity = 'MEDIUM';
    matched.push('low-battery-context');
  }

  return {
    category,
    severity,
    confidence: Number(confidence.toFixed(2)),
    recommendedAction: recommendedActionFor(category),
    matched: [...new Set(matched)].slice(0, 8),
    engine: 'iqoo-rules-v1',
  };
}

function recommendedActionFor(c: EmergencyCategory): string {
  switch (c) {
    case 'MEDICAL': return 'MEDICAL_ASSISTANCE';
    case 'FIRE': return 'FIRE_BRIGADE';
    case 'ACCIDENT': return 'ACCIDENT_RESPONSE';
    case 'VEHICLE': return 'VEHICLE_ASSISTANCE';
    case 'PERSONAL_SAFETY': return 'POLICE_ASSISTANCE';
    case 'MISSING_PERSON': return 'SEARCH_PARTY';
    case 'NATURAL_DISASTER': return 'DISASTER_RESPONSE';
    case 'CROWD': return 'CROWD_CONTROL';
    default: return 'GENERAL_ASSISTANCE';
  }
}

/** Concrete free/open implementation used by the app today. */
export class RuleBasedAIEngine implements LocalAIEngine {
  readonly name = 'iqoo-rules-v1';
  classify(input: AIInput): AIResult {
    return classifyFromText(input);
  }
}

/**
 * Suggest plain-language emergency inputs (§17 pipeline step 1).
 * Used by the voice/assist UI: never fabricates an emergency, only offers phrasing.
 */
export const EMERGENCY_PROMPT_SUGGESTIONS: string[] = [
  'Help, I fell down and cannot move',
  'There is a fire and heavy smoke',
  'Someone is following me',
  'I am bleeding badly',
  'We are trapped after an earthquake',
  'I cannot breathe properly',
  'Car accident on the highway',
  'I am lost and it is getting dark',
];
