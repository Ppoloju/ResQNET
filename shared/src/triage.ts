import { classifyFromText, type AIResult } from './ai.js';
import type { EmergencyCategory, Severity } from './types.js';

export type HelpAction = 'OFFLINE_MAP' | 'SOS' | 'CHAT';

export interface HelpTriage extends AIResult {
  action: HelpAction;
  reason: string;
}

const SOS_CATEGORIES: EmergencyCategory[] = [
  'MEDICAL', 'FIRE', 'ACCIDENT', 'VEHICLE', 'NATURAL_DISASTER', 'CROWD', 'PERSONAL_SAFETY',
];

function isAtLeastHigh(severity: Severity): boolean {
  return severity === 'HIGH' || severity === 'CRITICAL';
}

/** Decide what the Quick Help button should open. Deterministic and shared by browser/server. */
export function triageHelp(text: string, battery?: number | null): HelpTriage {
  const result = classifyFromText({ text, battery });
  const normalized = text.toLowerCase().trim();
  const asksForDirections = /\b(lost|find my way|directions|navigate|where am i|stranded)\b/.test(normalized);

  if (asksForDirections && result.category !== 'PERSONAL_SAFETY' && result.severity !== 'CRITICAL') {
    return { ...result, action: 'OFFLINE_MAP', reason: 'This sounds like a navigation or lost-person need. Open the offline map and nearby resources first.' };
  }

  if (isAtLeastHigh(result.severity) && SOS_CATEGORIES.includes(result.category)) {
    return { ...result, action: 'SOS', reason: 'The description contains a high-risk emergency signal. SOS should be activated.' };
  }

  return { ...result, action: 'CHAT', reason: 'This does not require an immediate SOS. Open the local assistance chat for next steps.' };
}
