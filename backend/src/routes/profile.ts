import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { audit } from '../middleware/audit.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { encryptProfileFields, decryptProfileFields } from '../security/fieldCrypto.js';

export const profileRouter = Router();

const profileSchema = z.object({
  name: z.string().min(1).max(80),
  age: z.number().int().min(0).max(120).optional(),
  gender: z.string().max(20).optional(),
  bloodGroup: z.string().max(8).optional(),
  medicalConditions: z.string().max(2000).optional(),
  allergies: z.string().max(2000).optional(),
  medications: z.string().max(2000).optional(),
  emergencyNotes: z.string().max(2000).optional(),
  phonePrimary: z.string().max(20).optional(),
  phoneSecondary: z.string().max(20).optional(),
  emergencyContactName: z.string().max(80).optional(),
  emergencyContactPhone: z.string().max(20).optional(),
  accessibilityNeeds: z.string().max(500).optional(),
  photo: z.string().max(200_000).optional(), // data URL, size-limited
  visibility: z.enum(['PRIVATE', 'FAMILY', 'RESPONDERS', 'NEARBY_HELPERS']).default('PRIVATE'),
  consentMedicalShare: z.boolean().default(false),
});

/** Fields included when profile is shared beyond PRIVATE (§7, §28) — never the full record. */
function redactForShare(row: Record<string, unknown>) {
  return {
    name: row.name,
    age: row.age,
    gender: row.gender,
    bloodGroup: row.blood_group,
    phonePrimary: row.phone_primary,
    phoneSecondary: row.phone_secondary,
    allergies: row.allergies,
    medicalConditions: row.medical_conditions,
    medications: row.medications,
    emergencyNotes: row.emergency_notes,
    emergencyContactName: row.emergency_contact_name,
    emergencyContactPhone: row.emergency_contact_phone,
    accessibilityNeeds: row.accessibility_needs,
  };
}

profileRouter.get('/me', requireAuth, (req: AuthedRequest, res) => {
  const found = db.prepare('SELECT * FROM emergency_profiles WHERE user_id = ?').get(req.user!.userId) as
    | Record<string, unknown>
    | undefined;
  if (!found) {
    res.status(404).json({ error: 'profile not found' });
    return;
  }
  const row = decryptProfileFields(found);
  res.json({
    profile: {
      id: row.id,
      name: row.name,
      age: row.age,
      gender: row.gender,
      bloodGroup: row.blood_group,
      medicalConditions: row.medical_conditions,
      allergies: row.allergies,
      medications: row.medications,
      emergencyNotes: row.emergency_notes,
      phonePrimary: row.phone_primary,
      phoneSecondary: row.phone_secondary,
      emergencyContactName: row.emergency_contact_name,
      emergencyContactPhone: row.emergency_contact_phone,
      accessibilityNeeds: row.accessibility_needs,
      photo: row.photo,
      visibility: row.visibility,
      consentMedicalShare: !!row.consent_medical_share,
      updatedAt: row.updated_at,
    },
  });
});

profileRouter.put('/me', requireAuth, (req: AuthedRequest, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation failed', issues: parsed.error.issues });
    return;
  }
  const p = parsed.data;
  const userId = req.user!.userId;
  const existing = db.prepare('SELECT id, updated_at FROM emergency_profiles WHERE user_id = ?').get(userId) as
    | { id: string; updated_at: string }
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'profile not found' });
    return;
  }

  // Conflict handling (§47): optimistic concurrency via client-declared baseVersion.
  // If the client sends baseVersion and the row changed since, reject with 409 + the
  // current server state so the client can merge/rebase. Omitted baseVersion =
  // explicit last-writer-wins (documented single-device default).
  const baseVersion = (req.body as { baseVersion?: string } | undefined)?.baseVersion;
  if (typeof baseVersion === 'string' && baseVersion !== existing.updated_at) {
    const current = db.prepare('SELECT updated_at FROM emergency_profiles WHERE user_id = ?').get(userId) as { updated_at: string };
    res.status(409).json({
      error: 'profile changed since your version — refetch, merge, and retry',
      currentUpdatedAt: current.updated_at,
    });
    return;
  }

  const enc = encryptProfileFields({
    medical_conditions: p.medicalConditions ?? null,
    allergies: p.allergies ?? null,
    medications: p.medications ?? null,
    emergency_notes: p.emergencyNotes ?? null,
    photo: p.photo ?? null,
  }) as Record<string, string | null>;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE emergency_profiles SET
       name=?, age=?, gender=?, blood_group=?, medical_conditions=?, allergies=?, medications=?,
       emergency_notes=?, phone_primary=?, phone_secondary=?, emergency_contact_name=?,
       emergency_contact_phone=?, accessibility_needs=?, photo=?, visibility=?, consent_medical_share=?,
       updated_at=?
     WHERE user_id=?`,
  ).run(
    p.name, p.age ?? null, p.gender ?? null, p.bloodGroup ?? null,
    enc.medical_conditions, enc.allergies, enc.medications,
    enc.emergency_notes, p.phonePrimary ?? null, p.phoneSecondary ?? null,
    p.emergencyContactName ?? null, p.emergencyContactPhone ?? null,
    p.accessibilityNeeds ?? null, enc.photo, p.visibility, p.consentMedicalShare ? 1 : 0,
    now, userId,
  );
  audit(userId, 'profile.update', 'emergency_profile', existing.id, { visibility: p.visibility });
  res.json({ ok: true, updatedAt: now }); // client stores as its new baseVersion
});

/**
 * Emergency card (§28): returns the minimal, permitted field set.
 * - PRIVATE: 404 to anyone but owner (route is owner-scoped anyway).
 * - consentMedicalShare=false strips allergies/conditions/medications even for RESPONDERS tier.
 * Sensitive fields are decrypted from their at-rest envelope before redaction.
 */
profileRouter.get('/me/card', requireAuth, (req: AuthedRequest, res) => {
  const found = db.prepare('SELECT * FROM emergency_profiles WHERE user_id = ?').get(req.user!.userId) as
    | Record<string, unknown>
    | undefined;
  if (!found) {
    res.status(404).json({ error: 'profile not found' });
    return;
  }
  const row = decryptProfileFields(found);
  const visibility = row.visibility as string;
  const consent = !!row.consent_medical_share;
  const base = redactForShare(row);
  if (visibility === 'PRIVATE' || !consent) {
    // Owner always sees their own card but medical fields are omitted unless consented.
    const { allergies: _a, medicalConditions: _c, medications: _m, emergencyNotes: _n, ...noMedical } = base;
    res.json({ card: { ...noMedical, visibility, medicalIncluded: false } });
    return;
  }
  res.json({ card: { ...base, visibility, medicalIncluded: true } });
});
