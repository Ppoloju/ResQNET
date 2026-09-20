// Settings (§29/§37/§45): large touch targets, plain language, honest labels.
// Every control maps to real behavior: relay tiers feed the engine-consistent
// readiness meter, low-power mode forces CRITICAL-only, scan interval is a
// documented prototype knob.

import { useEffect, useState } from 'react';
import { useSettings, type ThemePreference } from '../state/SettingsContext';
import { useTransports } from '../state/TransportContext';
import { useStatus } from '../state/StatusContext';
import { apiFetch, useSession } from '../state/SessionContext';
import MedicalCard from '../components/MedicalCard';
import {
  applyMedical,
  GENDER_OPTIONS,
  loadMedicalInfo,
  medicalFromProfile,
  saveMedicalInfo,
  type EmergencyProfilePayload,
  type MedicalInfo,
} from '../state/medicalProfile';
import { Mail, LogOut, Phone, ShieldCheck, Smartphone, UserRound } from 'lucide-react';

const AV_LABEL: Record<string, string> = {
  UNSUPPORTED: 'not available in this browser',
  PERMISSION_NEEDED: 'needs your permission',
  READY: 'ready',
  UNAVAILABLE: 'unavailable right now',
};

function tierFor(battery: number | null, s: ReturnType<typeof useSettings>): 'CRITICAL-ONLY' | 'REDUCED' | 'NORMAL' | 'OFF' {
  if (!s.relayConsent) return 'OFF';
  if (s.relayHeroMode) return 'NORMAL'; // Relay Hero relays at full strength (§29 iQOO)
  if (s.lowPowerMode) return 'CRITICAL-ONLY';
  if (battery === null) return 'NORMAL';
  if (battery < s.criticalThresholdPct) return 'CRITICAL-ONLY';
  if (battery <= s.normalThresholdPct) return 'REDUCED';
  return 'NORMAL';
}

export default function Settings() {
  const s = useSettings();
  const { user, device, logout } = useSession();
  const { rows, requestingBluetooth, requestBluetooth } = useTransports();
  const { battery } = useStatus();
  const [medical, setMedical] = useState<MedicalInfo>(loadMedicalInfo);
  const [remoteProfile, setRemoteProfile] = useState<EmergencyProfilePayload | null>(null);
  const [medicalStatus, setMedicalStatus] = useState('');
  const [savingMedical, setSavingMedical] = useState(false);

  const currentTier = tierFor(battery, s);

  useEffect(() => {
    const local = loadMedicalInfo();
    if (!local.name && user?.displayName) {
      setMedical({ ...local, name: user.displayName });
    } else {
      setMedical(local);
    }
    if (!user) {
      setRemoteProfile(null);
      return;
    }
    apiFetch<{ profile: EmergencyProfilePayload }>('/emergency-profiles/me')
      .then((r) => {
        setRemoteProfile(r.profile);
        setMedical(medicalFromProfile(r.profile));
      })
      .catch(() => {
        /* stay on local copy when offline or unsigned profile */
      });
  }, [user]);

  function setMedicalField<K extends keyof MedicalInfo>(key: K, value: MedicalInfo[K]) {
    setMedical((m) => ({ ...m, [key]: value }));
  }

  async function saveUserInformation() {
    setMedicalStatus('');
    if (!medical.name.trim()) {
      setMedicalStatus('Add a name before saving.');
      return;
    }
    setSavingMedical(true);
    try {
      saveMedicalInfo(medical);
      if (user) {
        const base: EmergencyProfilePayload = remoteProfile ?? {
          name: medical.name,
          visibility: 'PRIVATE',
          consentMedicalShare: false,
        };
        const payload = applyMedical(base, medical);
        await apiFetch('/emergency-profiles/me', { method: 'PUT', body: JSON.stringify(payload) });
        setRemoteProfile(payload);
        setMedicalStatus('User information saved ✓');
      } else {
        setMedicalStatus('Saved on this device ✓');
      }
    } catch (e) {
      setMedicalStatus(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSavingMedical(false);
    }
  }

  const THEMES: Array<{ value: ThemePreference; label: string; icon: string }> = [
    { value: 'system', label: 'System', icon: '' },
    { value: 'light', label: 'Light', icon: '☀️' },
    { value: 'dark', label: 'Dark', icon: '' },
  ];

  return (
    <div>
      <h1>Settings</h1>

      <div className="card settings-account-card">
        <div className="settings-account-heading">
          <div className="settings-account-avatar"><UserRound size={22} /></div>
          <div>
            <span className="eyebrow">ACCOUNT INFORMATION</span>
            <h2>{user?.displayName ?? 'Local device user'}</h2>
          </div>
          <span className="pill on"><ShieldCheck size={13} /> {user ? 'SIGNED IN' : 'LOCAL MODE'}</span>
        </div>
        {user ? (
          <div className="settings-account-grid">
            <div><Mail size={15} /><span><small>EMAIL</small><strong>{user.email}</strong></span></div>
            <div><Phone size={15} /><span><small>PHONE</small><strong>{user.phone || 'Not provided'}</strong></span></div>
            <div><ShieldCheck size={15} /><span><small>ROLE</small><strong>{user.role.toUpperCase()}</strong></span></div>
            <div><Smartphone size={15} /><span><small>DEVICE</small><strong>{device?.publicId || 'Local device'}</strong></span></div>
          </div>
        ) : (
          <p className="muted">SOS works locally. Sign in to sync family, profile, and emergency history.</p>
        )}
        {user && <button className="btn-ghost settings-signout" type="button" onClick={logout}><LogOut size={16} /> Sign out</button>}
      </div>

      <div className="card">
        <h2>User information</h2>
        <p className="muted">Used on your medical ID card. Saved on this device{user ? ' and synced to your account when online' : ''}.</p>
        <label htmlFor="med-name">Name</label>
        <input id="med-name" type="text" autoComplete="name" value={medical.name} onChange={(e) => setMedicalField('name', e.target.value)} />
        <div className="grid2">
          <div>
            <label htmlFor="med-age">Age</label>
            <input
              id="med-age"
              type="number"
              min={0}
              max={120}
              inputMode="numeric"
              value={medical.age ?? ''}
              onChange={(e) => setMedicalField('age', e.target.value === '' ? undefined : Number(e.target.value))}
            />
          </div>
          <div>
            <label htmlFor="med-gender">Gender</label>
            <select id="med-gender" value={medical.gender ?? ''} onChange={(e) => setMedicalField('gender', e.target.value || undefined)}>
              <option value="">Select</option>
              {medical.gender && !(GENDER_OPTIONS as readonly string[]).includes(medical.gender) && (
                <option value={medical.gender}>{medical.gender}</option>
              )}
              {GENDER_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        </div>
        <label htmlFor="med-allergies">Allergies</label>
        <textarea id="med-allergies" rows={2} placeholder="e.g. penicillin, peanuts" value={medical.allergies ?? ''} onChange={(e) => setMedicalField('allergies', e.target.value)} />
        <label htmlFor="med-meds">Medications</label>
        <textarea id="med-meds" rows={2} placeholder="e.g. insulin, inhaler" value={medical.medications ?? ''} onChange={(e) => setMedicalField('medications', e.target.value)} />
        <label htmlFor="med-conditions">Medical conditions</label>
        <textarea id="med-conditions" rows={2} placeholder="e.g. asthma, diabetes" value={medical.medicalConditions ?? ''} onChange={(e) => setMedicalField('medicalConditions', e.target.value)} />
        <button className="btn-primary" type="button" style={{ width: '100%', marginTop: 14 }} disabled={savingMedical} onClick={() => void saveUserInformation()}>
          {savingMedical ? 'Saving…' : 'Save user information'}
        </button>
        {medicalStatus && <p className={medicalStatus.includes('✓') ? 'ok-text' : 'error-text'}>{medicalStatus}</p>}
      </div>

      <div className="card">
        <h2>Medical card</h2>
        <p className="muted">Show this card or the QR code to medical responders.</p>
        <MedicalCard info={medical} />
      </div>

      <div className="card">
        <h2>Appearance</h2>
        <label htmlFor="theme-select">Color theme</label>
        <div className="row wrap" role="radiogroup" aria-label="Color theme">
          {THEMES.map((t) => (
            <button
              key={t.value}
              className="chip"
              style={s.theme === t.value ? { borderColor: 'var(--red)', color: 'var(--red-soft)', fontWeight: 700 } : undefined}
              onClick={() => s.update({ theme: t.value })}
              aria-pressed={s.theme === t.value}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Light mode helps screen readability in bright sun; dark saves OLED battery at night.
        </p>
      </div>

      <div className="card">
        <h2>Relaying</h2>
        <label className="row spread" style={{ alignItems: 'center', gap: 8, minHeight: 48 }}>
          <span>Relay emergency packets for nearby people</span>
          <input type="checkbox" style={{ width: 24, height: 24 }} checked={s.relayConsent}
            onChange={(e) => s.update({ relayConsent: e.target.checked })} aria-label="Relay consent" />
        </label>
        <label className="row spread" style={{ alignItems: 'center', gap: 8, minHeight: 48 }}>
          <span>Low-power mode (relay only CRITICAL alerts)</span>
          <input type="checkbox" style={{ width: 24, height: 24 }} checked={s.lowPowerMode}
            onChange={(e) => s.update({ lowPowerMode: e.target.checked })} aria-label="Low power mode" />
        </label>
        <label className="row spread" style={{ alignItems: 'center', gap: 8, minHeight: 48 }}>
          <span>
            Relay Hero mode <span className="muted small">(ResQNET flagships [P])</span><br />
            <span className="muted" style={{ fontSize: '0.8rem', fontWeight: 400 }}>
              Volunteer as the mesh backbone: relay everything even on low battery —
              built for large-cell + bypass-charging hardware.
            </span>
          </span>
          <input type="checkbox" style={{ width: 24, height: 24 }} checked={s.relayHeroMode}
            onChange={(e) => s.update({ relayHeroMode: e.target.checked })} aria-label="Relay Hero mode" />
        </label>

        <label htmlFor="scan-interval">Discovery scan interval: {s.scanIntervalSec}s <span className="muted">(prototype knob [P])</span></label>
        <input id="scan-interval" type="range" min={10} max={120} step={5} value={s.scanIntervalSec}
          onChange={(e) => s.update({ scanIntervalSec: Number(e.target.value) })}
          style={{ width: '100%' }} aria-valuemin={10} aria-valuemax={120} aria-valuenow={s.scanIntervalSec} />

        <label htmlFor="crit-thresh">CRITICAL-only below: {s.criticalThresholdPct}% battery</label>
        <input id="crit-thresh" type="range" min={5} max={40} step={5} value={s.criticalThresholdPct}
          onChange={(e) => s.update({ criticalThresholdPct: Math.min(Number(e.target.value), s.normalThresholdPct - 10) })}
          style={{ width: '100%' }} />

        <label htmlFor="norm-thresh">Normal relay above: {s.normalThresholdPct}% battery</label>
        <input id="norm-thresh" type="range" min={50} max={90} step={5} value={s.normalThresholdPct}
          onChange={(e) => s.update({ normalThresholdPct: Math.max(Number(e.target.value), s.criticalThresholdPct + 10) })}
          style={{ width: '100%' }} />

        <p className="muted mt" data-testid="current-tier">
          At your current battery ({battery === null ? 'unknown' : `${battery}%`}) this device would relay:
          {' '}<strong>{currentTier}</strong>
        </p>
        <button className="btn-ghost" onClick={s.reset}>Reset to defaults</button>
      </div>

      <div className="card">
        <h2>Transports</h2>
        {rows.map((r) => (
          <div key={r.name} className="row spread" style={{ minHeight: 44, alignItems: 'center' }}>
            <span>{r.name === 'bluetooth' ? 'Bluetooth [P]' : 'LAN/Internet'}</span>
            <span className={`pill small ${r.availability === 'READY' ? 'on' : r.availability === 'PERMISSION_NEEDED' ? 'warn' : 'off'}`}>
              {AV_LABEL[r.availability]}
            </span>
          </div>
        ))}
        <p className="muted" style={{ fontSize: '0.8rem' }}>{rows.find((r) => r.name === 'bluetooth')?.detail}</p>
        <button
          className="btn-secondary"
          style={{ width: '100%' }}
          disabled={requestingBluetooth}
          onClick={() => void requestBluetooth()}
        >
          {requestingBluetooth ? 'Waiting for picker…' : 'Pair a nearby ResQNET device [P]'}
        </button>
      </div>

      <div className="card">
        <h2>About</h2>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          ResQNET is a hackathon prototype. Mesh links are simulated unless a real radio is
          active (<span className="mono">[P]</span> labels mark prototypes). ResQNET augments
          emergency response — it never replaces 100/112/911.
        </p>
      </div>
    </div>
  );
}
