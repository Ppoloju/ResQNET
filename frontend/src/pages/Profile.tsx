import { useEffect, useState } from 'react';
import { apiFetch, useSession } from '../state/SessionContext';
import MedicalCard from '../components/MedicalCard';
import { medicalFromProfile, saveMedicalInfo, type EmergencyProfilePayload } from '../state/medicalProfile';

type ProfileData = EmergencyProfilePayload;

const VISIBILITY_HELP: Record<ProfileData['visibility'], string> = {
  PRIVATE: 'Only you. Nothing is shared, even during SOS.',
  FAMILY: 'Shared with your family circle during emergencies.',
  RESPONDERS: 'Shared with verified responders at emergency gateways.',
  NEARBY_HELPERS: 'Shared with nearby ResQNET helpers during an active SOS.',
};

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

  if (!user) return <div className="card">Sign in to manage your emergency profile.</div>;
  if (error) return <div className="card error-text">{error}</div>;
  if (!p) return <div className="card">Loading profile…</div>;

  const set = (k: keyof ProfileData) => (e: { target: { value: string } }) => {
    // HTML number inputs still emit strings. Preserve an empty field as
    // undefined and send a number to the API's strict profile schema.
    const value = k === 'age' && e.target.value !== '' ? Number(e.target.value)
      : k === 'age' ? undefined
        : e.target.value;
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
    <div>
      <h1>Emergency Profile</h1>
      <div className="card">
        <label htmlFor="pname">Name</label>
        <input id="pname" value={p.name} onChange={set('name')} />

        <div className="grid2">
          <div>
            <label htmlFor="page">Age</label>
            <input id="page" type="number" min={0} max={120} value={p.age ?? ''} onChange={set('age')} />
          </div>
          <div>
            <label htmlFor="pgender">Gender</label>
            <input id="pgender" value={p.gender ?? ''} onChange={set('gender')} />
          </div>
          <div>
            <label htmlFor="pblood">Blood group</label>
            <input id="pblood" value={p.bloodGroup ?? ''} onChange={set('bloodGroup')} placeholder="O+" />
          </div>
          <div>
            <label htmlFor="pphone">Phone</label>
            <input id="pphone" value={p.phonePrimary ?? ''} onChange={set('phonePrimary')} />
          </div>
          <div>
            <label htmlFor="pphone2">Secondary phone</label>
            <input id="pphone2" value={p.phoneSecondary ?? ''} onChange={set('phoneSecondary')} />
          </div>
        </div>

        <label htmlFor="pconditions">Medical conditions</label>
        <textarea id="pconditions" rows={2} value={p.medicalConditions ?? ''} onChange={set('medicalConditions')} />
        <label htmlFor="pallergies">Allergies</label>
        <textarea id="pallergies" rows={2} value={p.allergies ?? ''} onChange={set('allergies')} />
        <label htmlFor="pmeds">Current medications</label>
        <textarea id="pmeds" rows={2} value={p.medications ?? ''} onChange={set('medications')} />
        <label htmlFor="pnotes">Emergency notes</label>
        <textarea id="pnotes" rows={2} value={p.emergencyNotes ?? ''} onChange={set('emergencyNotes')} />
        <label htmlFor="paccess">Accessibility requirements</label>
        <textarea id="paccess" rows={2} value={p.accessibilityNeeds ?? ''} onChange={set('accessibilityNeeds')} />

        <div className="grid2">
          <div>
            <label htmlFor="pecname">Emergency contact name</label>
            <input id="pecname" value={p.emergencyContactName ?? ''} onChange={set('emergencyContactName')} />
          </div>
          <div>
            <label htmlFor="pecphone">Emergency contact phone</label>
            <input id="pecphone" value={p.emergencyContactPhone ?? ''} onChange={set('emergencyContactPhone')} />
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Emergency Profile Visibility</h2>
        <label htmlFor="pvis">Who may see this profile during an emergency?</label>
        <select id="pvis" value={p.visibility} onChange={set('visibility')}>
          <option value="PRIVATE">Private</option>
          <option value="FAMILY">Family only</option>
          <option value="RESPONDERS">Emergency responders</option>
          <option value="NEARBY_HELPERS">Nearby helpers during SOS</option>
        </select>
        <p className="muted">{VISIBILITY_HELP[p.visibility]}</p>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            style={{ width: 20, height: 20 }}
            checked={p.consentMedicalShare}
            onChange={(e) => setP({ ...p, consentMedicalShare: e.target.checked })}
          />
          Include medical details (allergies, conditions, medications) when shared
        </label>
        {!p.consentMedicalShare && (
          <p className="muted">Medical details stay on this device unless you consent above.</p>
        )}
      </div>

      <div className="card">
        <h2>Medical card</h2>
        <p className="muted">Show this card or QR to medical responders. The QR encodes your details as text so it works without internet.</p>
        <MedicalCard info={medicalFromProfile(p)} />
      </div>

      <button className="btn-primary" style={{ width: '100%' }} onClick={() => void save()}>
        Save profile
      </button>
      {status && <p className={status.endsWith('✓') ? 'ok-text' : 'error-text'}>{status}</p>}
    </div>
  );
}
