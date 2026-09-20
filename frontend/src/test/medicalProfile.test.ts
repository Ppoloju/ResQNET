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
      allergies: 'Penicillin',
      medications: 'Insulin',
      medicalConditions: 'Type 1 diabetes',
    });
    expect(text).toContain('RESQNET MEDICAL CARD');
    expect(text).toContain('Name: Ada Khan');
    expect(text).toContain('Age: 34');
    expect(text).toContain('Gender: Female');
    expect(text).toContain('Allergies: Penicillin');
    expect(text).toContain('Medications: Insulin');
    expect(text).toContain('Conditions: Type 1 diabetes');
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
      visibility: 'FAMILY',
      consentMedicalShare: true,
      emergencyContactName: 'Sam',
    };
    const next = applyMedical(existing, { name: 'Ada', age: 34, gender: 'Female', medicalConditions: 'Asthma' });
    expect(next.name).toBe('Ada');
    expect(next.age).toBe(34);
    expect(next.bloodGroup).toBe('O+');
    expect(next.emergencyContactName).toBe('Sam');
    expect(medicalFromProfile(next).medicalConditions).toBe('Asthma');
  });
});
