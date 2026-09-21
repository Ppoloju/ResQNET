import { describe, expect, it, beforeEach } from 'vitest';
import {
  applyMedical,
  formatMedicalCardText,
  hasMedicalCard,
  loadMedicalInfo,
  MEDICAL_PROFILE_KEY,
  medicalFromProfile,
  saveMedicalInfo,
  type EmergencyProfilePayload,
} from '../state/medicalProfile';

describe('medical profile', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('formats a scanner-readable medical card payload', () => {
    const text = formatMedicalCardText({
      name: 'Ada Khan',
      age: 34,
      gender: 'Female',
      bloodGroup: 'O+',
      phonePrimary: '+911111111111',
      phoneSecondary: '+922222222222',
      allergies: 'Penicillin',
      medications: 'Insulin',
      medicalConditions: 'Type 1 diabetes',
      emergencyContactName: 'Sam Khan',
      emergencyContactPhone: '+911234567890',
      accessibilityNeeds: 'Wheelchair access',
      emergencyNotes: 'Carry inhaler',
      visibility: 'RESPONDERS',
      consentMedicalShare: true,
    });
    expect(text).toContain('RESQNET MEDICAL CARD');
    expect(text).toContain('Name: Ada Khan');
    expect(text).toContain('Age: 34');
    expect(text).toContain('Gender: Female');
    expect(text).toContain('Blood group: O+');
    expect(text).toContain('Primary phone: +911111111111');
    expect(text).toContain('Secondary phone: +922222222222');
    expect(text).toContain('Allergies: Penicillin');
    expect(text).toContain('Medications: Insulin');
    expect(text).toContain('Conditions: Type 1 diabetes');
    expect(text).toContain('Emergency contact: Sam Khan (+911234567890)');
    expect(text).toContain('Accessibility: Wheelchair access');
    expect(text).toContain('Emergency notes: Carry inhaler');
    expect(text).toContain('Visibility: RESPONDERS');
    expect(text).toContain('Medical sharing consent: GRANTED');
  });

  it('requires a name before a medical card is ready', () => {
    expect(hasMedicalCard({ name: '  ' })).toBe(false);
    expect(hasMedicalCard({ name: 'Ada' })).toBe(true);
  });

  it('persists medical info locally', () => {
    saveMedicalInfo({ name: 'Ada', age: 34, allergies: 'peanuts' });
    expect(JSON.parse(localStorage.getItem(MEDICAL_PROFILE_KEY) ?? '{}').name).toBe('Ada');
    expect(loadMedicalInfo()).toMatchObject({ name: 'Ada', age: 34, allergies: 'peanuts' });
  });

  it('overlays medical fields onto an existing emergency profile', () => {
    const existing: EmergencyProfilePayload = {
      name: 'Old',
      bloodGroup: 'O+',
      phonePrimary: '+911111111111',
      phoneSecondary: '+922222222222',
      visibility: 'FAMILY',
      consentMedicalShare: true,
      emergencyContactName: 'Sam',
      emergencyContactPhone: '+911234567890',
      accessibilityNeeds: 'Wheelchair access',
      emergencyNotes: 'Carry inhaler',
    };
    const next = applyMedical(existing, { name: 'Ada', age: 34, gender: 'Female', medicalConditions: 'Asthma' });
    expect(next.name).toBe('Ada');
    expect(next.age).toBe(34);
    expect(next.bloodGroup).toBe('O+');
    expect(next.emergencyContactName).toBe('Sam');
    expect(medicalFromProfile(next)).toMatchObject({
      medicalConditions: 'Asthma',
      bloodGroup: 'O+',
      phonePrimary: '+911111111111',
      phoneSecondary: '+922222222222',
      emergencyContactPhone: '+911234567890',
      accessibilityNeeds: 'Wheelchair access',
      emergencyNotes: 'Carry inhaler',
      visibility: 'FAMILY',
      consentMedicalShare: true,
    });
  });
});
