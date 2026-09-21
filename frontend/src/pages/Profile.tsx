import { useEffect, useState } from 'react';
import { Save, Eye, HeartPulse, QrCode, UserRound } from 'lucide-react';
import { apiFetch, useSession } from '../state/SessionContext';
import MedicalCard from '../components/MedicalCard';
import { medicalFromProfile, saveMedicalInfo, type EmergencyProfilePayload } from '../state/medicalProfile';
import {
  Card, CardHeader, PageHeader, TextField, NumberField, SelectField, TextAreaField, CheckboxField, ActionButton,
} from '../components/ui';

type ProfileData = EmergencyProfilePayload;

const VISIBILITY_HELP: Record<ProfileData['visibility'], string> = {
  PRIVATE: 'Only you. Nothing is shared, even during SOS.',
  FAMILY: 'Shared with your family circle during emergencies.',
  RESPONDERS: 'Shared with verified responders at emergency gateways.',
  NEARBY_HELPERS: 'Shared with nearby ResQNET helpers during an active SOS.',
};

const GENDERS = ['', 'FEMALE', 'MALE', 'OTHER', 'PREFER_NOT_TO_SAY'] as const;

export default function Profile() {
  const { user } = useSession();
  const [p, setP] = useState<ProfileData | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    apiFetch<{ profile: ProfileData }>('/emergency-profiles/me')
      .then((r) => setP(r.profile))
      .catch((e: Error) => setError(e.message));
  }, [user]);

  if (!user) return <div className="page"><Card>Sign in to manage your emergency profile.</Card></div>;
  if (error) return <div className="page"><Card><p className="error-text">{error}</p></Card></div>;
  if (!p) return <div className="page"><Card>Loading profile…</Card></div>;

  const set = (k: keyof ProfileData) => (value: string) => {
    setP({ ...p, [k]: value } as ProfileData);
  };

  async function save() {
    if (!p) return;
    setStatus('');
    try {
      await apiFetch('/emergency-profiles/me', { method: 'PUT', body: JSON.stringify(p) });
      saveMedicalInfo(medicalFromProfile(p));
      setStatus('Saved ✓');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Could not save profile');
    }
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="RESQNET / PROFILE"
        title="Emergency profile"
        subtitle="Responders see these details according to the visibility you choose."
        badge={p.consentMedicalShare ? 'MEDICAL SHARING ON' : 'MEDICAL PRIVATE'}
        badgeTone={p.consentMedicalShare ? 'safe' : 'neutral'}
      />

      <Card>
        <CardHeader icon={<UserRound size={17} />} title="Identity & contact" />
        <div className="rq-modal-body">
          <TextField label="Name" value={p.name} onChange={set('name')} />
          <div className="grid2">
            <NumberField label="Age" value={p.age} min={0} max={120} onChange={(age) => setP({ ...p, age })} />
            <SelectField
              label="Gender"
              value={p.gender ?? ''}
              onChange={(gender) => setP({ ...p, gender: gender || undefined })}
              options={GENDERS.map((g) => ({ value: g, label: g || 'Select' }))}
            />
            <TextField label="Blood group" value={p.bloodGroup ?? ''} onChange={set('bloodGroup')} placeholder="O+" />
            <TextField label="Phone" inputMode="tel" value={p.phonePrimary ?? ''} onChange={set('phonePrimary')} />
            <TextField label="Secondary phone" inputMode="tel" value={p.phoneSecondary ?? ''} onChange={set('phoneSecondary')} />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader icon={<HeartPulse size={17} />} title="Medical details" subtitle="Encrypted at rest (AES-256-GCM)." />
        <div className="rq-modal-body">
          <TextAreaField label="Medical conditions" rows={2} value={p.medicalConditions ?? ''} onChange={set('medicalConditions')} />
          <TextAreaField label="Allergies" rows={2} value={p.allergies ?? ''} onChange={set('allergies')} />
          <TextAreaField label="Current medications" rows={2} value={p.medications ?? ''} onChange={set('medications')} />
          <TextAreaField label="Emergency notes" rows={2} value={p.emergencyNotes ?? ''} onChange={set('emergencyNotes')} />
          <TextAreaField label="Accessibility requirements" rows={2} value={p.accessibilityNeeds ?? ''} onChange={set('accessibilityNeeds')} />
          <div className="grid2">
            <TextField label="Emergency contact name" value={p.emergencyContactName ?? ''} onChange={set('emergencyContactName')} />
            <TextField label="Emergency contact phone" inputMode="tel" value={p.emergencyContactPhone ?? ''} onChange={set('emergencyContactPhone')} />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader icon={<Eye size={17} />} title="Visibility" subtitle={VISIBILITY_HELP[p.visibility]} />
        <SelectField
          label="Who may see this profile during an emergency?"
          value={p.visibility}
          onChange={(visibility) => setP({ ...p, visibility })}
          options={[
            { value: 'PRIVATE', label: 'Private' },
            { value: 'FAMILY', label: 'Family only' },
            { value: 'RESPONDERS', label: 'Emergency responders' },
            { value: 'NEARBY_HELPERS', label: 'Nearby helpers during SOS' },
          ]}
        />
        <CheckboxField
          label="Include medical details (allergies, conditions, medications) when shared"
          checked={p.consentMedicalShare}
          onChange={(consentMedicalShare) => setP({ ...p, consentMedicalShare })}
        />
        {!p.consentMedicalShare && (
          <p className="muted">Medical details stay on this device unless you consent above.</p>
        )}
      </Card>

      <Card>
        <CardHeader icon={<QrCode size={17} />} title="Medical card" subtitle="Show this card or QR to medical responders. The QR encodes your details as text so it works without internet." />
        <MedicalCard info={medicalFromProfile(p)} />
      </Card>

      <ActionButton variant="primary" full onClick={() => void save()}>
        <Save size={17} /> Save profile
      </ActionButton>
      {status && <p className={status.endsWith('✓') ? 'ok-text' : 'error-text'}>{status}</p>}
    </div>
  );
}
