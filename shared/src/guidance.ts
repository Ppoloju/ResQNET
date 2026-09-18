// Disaster Mode AI assistant (§13): guides basic first aid, evacuation steps,
// or connection to nearby responders — fully offline.
//
// Design constraints (§61 policy, same as the classifier):
//  - Deterministic rules over verified content — never generative, so it cannot
//    hallucinate medical advice.
//  - Every entry carries a disclaimer; guidance is a bridge to professional
//    care, never a replacement.
//  - Zero dependencies, zero network, runs in any JS runtime.

import type { EmergencyCategory } from './types.js';

export interface GuidanceTopic {
  id: string;
  title: string;
  /** Ordered steps the user can follow without training. */
  steps: string[];
  /** When to stop self-treating and seek help. */
  escalate: string;
  disclaimer: string;
}

const STANDARD_DISCLAIMER =
  'AI assistance signal — not medical advice. Professional responders decide treatment.';

/** Curated offline knowledge base — reviewed content, fixed wording. */
export const GUIDANCE_TOPICS: Record<string, GuidanceTopic> = {
  severe_bleeding: {
    id: 'severe_bleeding',
    title: 'Severe bleeding',
    steps: [
      'Press hard directly on the wound with the cleanest cloth available.',
      'Keep pressing continuously — do not lift to peek.',
      'Raise the injured limb above heart level if possible.',
      'If blood soaks through, add layers on top without removing the first.',
      'Keep the person warm and still; have them lie down.',
    ],
    escalate: 'If bleeding does not slow within 10 minutes of firm pressure, treat as life-threatening — get to responders.',
    disclaimer: STANDARD_DISCLAIMER,
  },
  fracture_fall: {
    id: 'fracture_fall',
    title: 'Suspected fracture after a fall',
    steps: [
      'Do not move the injured part; support it in the position found.',
      'Immobilize with padding: a rolled towel, clothing, or a rigid object tied gently.',
      'Check fingers/toes beyond the injury for numbness or color change.',
      'Cold pack (or cold wet cloth) 15 minutes on to reduce swelling.',
      'Do not attempt to straighten or "set" the bone.',
    ],
    escalate: 'Numbness, bluish color, or inability to feel the limb beyond the injury needs urgent care.',
    disclaimer: STANDARD_DISCLAIMER,
  },
  burns: {
    id: 'burns',
    title: 'Burns',
    steps: [
      'Cool the burn under clean running water for at least 10 minutes.',
      'Remove rings/watches near the burn before swelling starts.',
      'Cover loosely with clean, non-fluffy cloth or cling film.',
      'Do NOT apply ice, butter, toothpaste, or ointments.',
      'Do NOT burst blisters.',
    ],
    escalate: 'Burns larger than the person\'s palm, on face/hands/joints, or with white/charred skin need professional care.',
    disclaimer: STANDARD_DISCLAIMER,
  },
  trapped_crush: {
    id: 'trapped_crush',
    title: 'Trapped under debris',
    steps: [
      'Conserve air and energy — shout only when you hear searchers; otherwise bang on a pipe or wall in a pattern of three.',
      'Cover nose and mouth with cloth against dust.',
      'Do not struggle against heavy debris; movement can bring more down.',
      'If you have a phone, keep it on but screen off to save battery; send one IQOO SOS with your location.',
      'Stay near an open space or window where sound carries.',
    ],
    escalate: 'If you can move, go toward light and airflow — but never through smoke-filled or unstable areas.',
    disclaimer: STANDARD_DISCLAIMER,
  },
  evacuation: {
    id: 'evacuation',
    title: 'Evacuation basics',
    steps: [
      'Take your emergency profile (IQOO card works offline) and any essential medication.',
      'Do not use elevators; use stairs.',
      'Stay away from fallen power lines, cracked walls, and water over roads.',
      'Move perpendicular to floodwater flow; 15 cm of moving water can knock you down.',
      'Head for the nearest mapped resource point (see Resource Map) — shelters are marked.',
      'Help only if you do not become a casualty yourself.',
    ],
    escalate: 'If routes are blocked, shelter in place on an upper floor (flood) or doorway (earthquake aftershocks) and signal for help.',
    disclaimer: 'General preparedness guidance — follow official instructions where available.',
  },
};

/** Map an AI category → the most relevant guidance topic. */
export function guidanceForCategory(category: EmergencyCategory | null | undefined): GuidanceTopic | null {
  switch (category) {
    case 'MEDICAL': return GUIDANCE_TOPICS.severe_bleeding;
    case 'ACCIDENT':
    case 'VEHICLE': return GUIDANCE_TOPICS.fracture_fall;
    case 'FIRE': return GUIDANCE_TOPICS.burns;
    case 'NATURAL_DISASTER': return GUIDANCE_TOPICS.trapped_crush;
    default: return null;
  }
}

/** Free-text lookup for the assistant card (e.g. user asks "how do I stop bleeding?"). */
export function findGuidance(text: string): GuidanceTopic | null {
  const t = text.toLowerCase();
  if (/bleed|blood/.test(t)) return GUIDANCE_TOPICS.severe_bleeding;
  if (/fracture|broke|broken|sprain|fell|fall/.test(t)) return GUIDANCE_TOPICS.fracture_fall;
  if (/burn|scald|fire/.test(t)) return GUIDANCE_TOPICS.burns;
  if (/trapped|stuck|debris|rubble|under/.test(t)) return GUIDANCE_TOPICS.trapped_crush;
  if (/evacuate|evacuation|leave|shelter|flood|earthquake/.test(t)) return GUIDANCE_TOPICS.evacuation;
  return null;
}
