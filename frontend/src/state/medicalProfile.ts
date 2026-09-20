/** Local emergency medical identity — works offline; syncs to the server when signed in. */

export const MEDICAL_PROFILE_KEY = 'iqoo.medicalProfile';

export const GENDER_OPTIONS = ['Female', 'Male', 'Non-binary', 'Prefer not to say'] as const;

export interface MedicalInfo {
  name: string;
  age?: number;
  gender?: string;
  bloodGroup?: string;
  phonePrimary?: string;
  phoneSecondary?: string;
  allergies?: string;
  medications?: string;
  medicalConditions?: string;
  emergencyNotes?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  accessibilityNeeds?: string;
  visibility?: EmergencyProfilePayload['visibility'];
  consentMedicalShare?: boolean;
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
    bloodGroup: p.bloodGroup?.trim() || undefined,
    phonePrimary: p.phonePrimary?.trim() || undefined,
    phoneSecondary: p.phoneSecondary?.trim() || undefined,
    allergies: p.allergies?.trim() || undefined,
    medications: p.medications?.trim() || undefined,
    medicalConditions: p.medicalConditions?.trim() || undefined,
    emergencyNotes: p.emergencyNotes?.trim() || undefined,
    emergencyContactName: p.emergencyContactName?.trim() || undefined,
    emergencyContactPhone: p.emergencyContactPhone?.trim() || undefined,
    accessibilityNeeds: p.accessibilityNeeds?.trim() || undefined,
    visibility: p.visibility,
    consentMedicalShare: p.consentMedicalShare,
  };
}

export function medicalFromProfile(p: EmergencyProfilePayload): MedicalInfo {
  return normalizeMedicalInfo({
    name: p.name,
    age: p.age,
    gender: p.gender,
    bloodGroup: p.bloodGroup,
    phonePrimary: p.phonePrimary,
    phoneSecondary: p.phoneSecondary,
    allergies: p.allergies,
    medications: p.medications,
    medicalConditions: p.medicalConditions,
    emergencyNotes: p.emergencyNotes,
    emergencyContactName: p.emergencyContactName,
    emergencyContactPhone: p.emergencyContactPhone,
    accessibilityNeeds: p.accessibilityNeeds,
    visibility: p.visibility,
    consentMedicalShare: p.consentMedicalShare,
  });
}

export function applyMedical(p: EmergencyProfilePayload, m: MedicalInfo): EmergencyProfilePayload {
  const n = normalizeMedicalInfo(m);
  return {
    ...p,
    name: n.name || p.name,
    age: n.age,
    gender: n.gender,
    bloodGroup: field(m, 'bloodGroup') ? n.bloodGroup : p.bloodGroup,
    phonePrimary: field(m, 'phonePrimary') ? n.phonePrimary : p.phonePrimary,
    phoneSecondary: field(m, 'phoneSecondary') ? n.phoneSecondary : p.phoneSecondary,
    allergies: n.allergies,
    medications: n.medications,
    medicalConditions: n.medicalConditions,
    emergencyNotes: field(m, 'emergencyNotes') ? n.emergencyNotes : p.emergencyNotes,
    emergencyContactName: field(m, 'emergencyContactName') ? n.emergencyContactName : p.emergencyContactName,
    emergencyContactPhone: field(m, 'emergencyContactPhone') ? n.emergencyContactPhone : p.emergencyContactPhone,
    accessibilityNeeds: field(m, 'accessibilityNeeds') ? n.accessibilityNeeds : p.accessibilityNeeds,
    visibility: field(m, 'visibility') ? n.visibility! : p.visibility,
    consentMedicalShare: field(m, 'consentMedicalShare') ? n.consentMedicalShare! : p.consentMedicalShare,
  };
}

function field<T extends object, K extends keyof T>(object: T, key: K): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/** Plain-text payload any phone camera / QR scanner can show a responder. */
export function formatMedicalCardText(info: MedicalInfo): string {
  const n = normalizeMedicalInfo(info);
  return [
    'RESQNET MEDICAL CARD',
    `Name: ${n.name || '—'}`,
    n.age != null ? `Age: ${n.age}` : 'Age: —',
    `Gender: ${n.gender || '—'}`,
    `Blood group: ${n.bloodGroup || 'Not listed'}`,
    `Primary phone: ${n.phonePrimary || 'Not listed'}`,
    `Secondary phone: ${n.phoneSecondary || 'Not listed'}`,
    `Allergies: ${n.allergies || 'None listed'}`,
    `Medications: ${n.medications || 'None listed'}`,
    `Conditions: ${n.medicalConditions || 'None listed'}`,
    `Emergency contact: ${n.emergencyContactName || 'Not listed'}${n.emergencyContactPhone ? ` (${n.emergencyContactPhone})` : ''}`,
    `Accessibility: ${n.accessibilityNeeds || 'None listed'}`,
    `Emergency notes: ${n.emergencyNotes || 'None listed'}`,
    `Visibility: ${n.visibility || 'LOCAL ONLY'}`,
    `Medical sharing consent: ${n.consentMedicalShare ? 'GRANTED' : 'NOT GRANTED'}`,
  ].join('\n');
}

export function hasMedicalCard(info: MedicalInfo): boolean {
  return normalizeMedicalInfo(info).name.length > 0;
}
