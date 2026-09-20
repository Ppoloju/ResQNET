/** Local emergency medical identity — works offline; syncs to the server when signed in. */

export const MEDICAL_PROFILE_KEY = 'iqoo.medicalProfile';

export const GENDER_OPTIONS = ['Female', 'Male', 'Non-binary', 'Prefer not to say'] as const;

export interface MedicalInfo {
  name: string;
  age?: number;
  gender?: string;
  allergies?: string;
  medications?: string;
  medicalConditions?: string;
}

export interface EmergencyProfilePayload {
  name: string;
  age?: number;
  gender?: string;
  bloodGroup?: string;
  medicalConditions?: string;
  allergies?: string;
  medications?: string;
  emergencyNotes?: string;
  phonePrimary?: string;
  phoneSecondary?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  accessibilityNeeds?: string;
  visibility: 'PRIVATE' | 'FAMILY' | 'RESPONDERS' | 'NEARBY_HELPERS';
  consentMedicalShare: boolean;
}

export const EMPTY_MEDICAL: MedicalInfo = { name: '' };

export function loadMedicalInfo(): MedicalInfo {
  try {
    const raw = localStorage.getItem(MEDICAL_PROFILE_KEY);
    if (!raw) return { ...EMPTY_MEDICAL };
    const parsed = JSON.parse(raw) as Partial<MedicalInfo>;
    return normalizeMedicalInfo(parsed);
  } catch {
    return { ...EMPTY_MEDICAL };
  }
}

export function saveMedicalInfo(info: MedicalInfo): void {
  localStorage.setItem(MEDICAL_PROFILE_KEY, JSON.stringify(normalizeMedicalInfo(info)));
}

export function normalizeMedicalInfo(p: Partial<MedicalInfo>): MedicalInfo {
  const age = typeof p.age === 'number' && Number.isFinite(p.age) ? Math.max(0, Math.min(120, Math.trunc(p.age))) : undefined;
  return {
    name: (p.name ?? '').trim(),
    age,
    gender: p.gender?.trim() || undefined,
    allergies: p.allergies?.trim() || undefined,
    medications: p.medications?.trim() || undefined,
    medicalConditions: p.medicalConditions?.trim() || undefined,
  };
}

export function medicalFromProfile(p: EmergencyProfilePayload): MedicalInfo {
  return normalizeMedicalInfo({
    name: p.name,
    age: p.age,
    gender: p.gender,
    allergies: p.allergies,
    medications: p.medications,
    medicalConditions: p.medicalConditions,
  });
}

export function applyMedical(p: EmergencyProfilePayload, m: MedicalInfo): EmergencyProfilePayload {
  const n = normalizeMedicalInfo(m);
  return {
    ...p,
    name: n.name || p.name,
    age: n.age,
    gender: n.gender,
    allergies: n.allergies,
    medications: n.medications,
    medicalConditions: n.medicalConditions,
  };
}

/** Plain-text payload any phone camera / QR scanner can show a responder. */
export function formatMedicalCardText(info: MedicalInfo): string {
  const n = normalizeMedicalInfo(info);
  return [
    'RESQNET MEDICAL CARD',
    `Name: ${n.name || '—'}`,
    n.age != null ? `Age: ${n.age}` : 'Age: —',
    `Gender: ${n.gender || '—'}`,
    `Allergies: ${n.allergies || 'None listed'}`,
    `Medications: ${n.medications || 'None listed'}`,
    `Conditions: ${n.medicalConditions || 'None listed'}`,
  ].join('\n');
}

export function hasMedicalCard(info: MedicalInfo): boolean {
  return normalizeMedicalInfo(info).name.length > 0;
}
