import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Bluetooth, CheckCircle2, ChevronRight, Copy, RadioTower, RotateCcw, ShieldCheck, Smartphone, UserRound } from 'lucide-react';
import { useSettings, type ThemePreference } from '../state/SettingsContext';
import { useTransports } from '../state/TransportContext';
import { useStatus } from '../state/StatusContext';
import { apiFetch, useSession } from '../state/SessionContext';
import MedicalCard from '../components/MedicalCard';
import { applyMedical, GENDER_OPTIONS, loadMedicalInfo, medicalFromProfile, saveMedicalInfo, type EmergencyProfilePayload, type MedicalInfo } from '../state/medicalProfile';

const AV_LABEL: Record<string, string> = { UNSUPPORTED: 'not available', PERMISSION_NEEDED: 'permission needed', READY: 'ready', UNAVAILABLE: 'unavailable' };

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <button className={`hardware-toggle ${checked ? 'is-on' : ''}`} type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}><span /></button>;
}

function Row({ icon, title, detail, children }: { icon: ReactNode; title: string; detail?: string; children: ReactNode }) {
  return <div className="hardware-row"><div className="hardware-row-icon">{icon}</div><div className="hardware-row-copy"><strong>{title}</strong>{detail && <span>{detail}</span>}</div>{children}</div>;
}

function Section({ icon, title, badge, children }: { icon: ReactNode; title: string; badge?: string; children: ReactNode }) {
  return <section className="hardware-section"><div className="hardware-section-title"><span className="hardware-section-icon">{icon}</span><h2>{title}</h2>{badge && <span className="hardware-badge">{badge}</span>}</div>{children}</section>;
}

function tierFor(battery: number | null, settings: ReturnType<typeof useSettings>) {
  if (!settings.relayConsent) return 'OFF';
  if (settings.relayHeroMode) return 'NORMAL';
  if (settings.lowPowerMode || (battery !== null && battery < settings.criticalThresholdPct)) return 'CRITICAL-ONLY';
  return 'NORMAL';
}

export default function Settings() {
  const settings = useSettings();
  const { user, device, logout } = useSession();
  const { rows, requestingBluetooth, requestBluetooth } = useTransports();
  const { battery } = useStatus();
  const [medical, setMedical] = useState<MedicalInfo>(loadMedicalInfo);
  const [remoteProfile, setRemoteProfile] = useState<EmergencyProfilePayload | null>(null);
  const [medicalStatus, setMedicalStatus] = useState('');
  const [savingMedical, setSavingMedical] = useState(false);

  useEffect(() => {
    const local = loadMedicalInfo();
    setMedical(!local.name && user?.displayName ? { ...local, name: user.displayName } : local);
    if (!user) { setRemoteProfile(null); return; }
    apiFetch<{ profile: EmergencyProfilePayload }>('/emergency-profiles/me').then((response) => {
      setRemoteProfile(response.profile);
      setMedical(medicalFromProfile(response.profile));
    }).catch(() => undefined);
  }, [user]);

  function updateMedical<K extends keyof MedicalInfo>(key: K, value: MedicalInfo[K]) {
    setMedical((current) => ({ ...current, [key]: value }));
  }

  async function saveMedical() {
    setMedicalStatus('');
    if (!medical.name.trim()) { setMedicalStatus('Add a name before saving.'); return; }
    setSavingMedical(true);
    try {
      saveMedicalInfo(medical);
      if (user) {
        const base = remoteProfile ?? { name: medical.name, visibility: 'PRIVATE' as const, consentMedicalShare: false };
        const payload = applyMedical(base, medical);
        await apiFetch('/emergency-profiles/me', { method: 'PUT', body: JSON.stringify(payload) });
        setRemoteProfile(payload);
      }
      setMedicalStatus(user ? 'Saved to account' : 'Saved on this device');
    } catch (error) { setMedicalStatus(error instanceof Error ? error.message : 'Could not save'); }
    finally { setSavingMedical(false); }
  }

  const update = <K extends keyof typeof settings>(key: K, value: (typeof settings)[K]) => settings.update({ [key]: value } as Partial<typeof settings>);
  const bluetooth = rows.find((row) => row.name === 'bluetooth');
  const syncLabel = settings.syncStatus === 'synced' ? 'BACKEND SYNCED' : settings.syncStatus === 'syncing' ? 'SYNCING...' : settings.syncStatus === 'offline' ? 'LOCAL / OFFLINE' : 'LOCAL MODE';

  return <div className="hardware-settings">
    <header className="hardware-header"><Link to="/" className="hardware-back" aria-label="Back to home"><ArrowLeft size={20} /></Link><div><h1>Settings<br />Hardware</h1><span>RESQNET DEVICE CONTROLS</span></div><div className={`hardware-sync settings-sync-${settings.syncStatus}`}><CheckCircle2 size={16} /><small>{syncLabel}</small></div></header>

    <Section icon={<UserRound size={17} />} title="Operator & Device" badge={user ? 'SIGNED IN' : 'LOCAL MODE'}><div className="operator-grid"><div><small>OPERATOR</small><strong>{user?.displayName ?? 'LOCAL OPERATOR'}</strong><span>{user?.role?.toUpperCase() ?? 'EMERGENCY PROFILE STORED LOCALLY'}</span></div><div className="hardware-fingerprint"><small>DEVICE ID</small><code>{device?.publicId ?? 'LOCAL DEVICE'}</code><button type="button" disabled={!device?.publicId} onClick={() => void navigator.clipboard?.writeText(device?.publicId ?? '')}><Copy size={13} /> COPY</button></div></div>{user && <button className="hardware-signout" type="button" onClick={logout}>Sign out</button>}</Section>

    <Section icon={<RadioTower size={17} />} title="Relay Policy" badge={`${battery ?? '--'}% / ${tierFor(battery, settings)}`}><Row icon={<ShieldCheck size={15} />} title="Relay emergency packets" detail="Allow this device to forward nearby alerts"><Toggle checked={settings.relayConsent} onChange={(value) => update('relayConsent', value)} label="Relay emergency packets" /></Row><Row icon={<ShieldCheck size={15} />} title="Low-power relay mode" detail="Forward only CRITICAL alerts"><Toggle checked={settings.lowPowerMode} onChange={(value) => update('lowPowerMode', value)} label="Low-power relay mode" /></Row><Row icon={<Smartphone size={15} />} title="Relay Hero mode" detail="Use this device as a full-strength mesh backbone"><Toggle checked={settings.relayHeroMode} onChange={(value) => update('relayHeroMode', value)} label="Relay Hero mode" /></Row><label className="hardware-range"><span>CRITICAL-ONLY BELOW <b>{settings.criticalThresholdPct}%</b></span><input type="range" min="5" max="40" step="5" value={settings.criticalThresholdPct} onChange={(event) => update('criticalThresholdPct', Number(event.target.value))} /></label><p className="hardware-scale">The Network page uses these values for its live relay-readiness calculation.</p></Section>

    <Section icon={<Bluetooth size={17} />} title="Radio Transport" badge={AV_LABEL[bluetooth?.availability ?? 'UNAVAILABLE']}><div className="hardware-transport"><strong>Bluetooth LE</strong><span>{bluetooth?.detail ?? AV_LABEL[bluetooth?.availability ?? 'UNAVAILABLE']}</span><button type="button" disabled={requestingBluetooth} onClick={() => void requestBluetooth()}>{requestingBluetooth ? 'PAIRING' : 'PAIR DEVICE'}</button></div><p className="hardware-scale">Bluetooth pairing is foreground-only in this browser. LAN availability is shown in Network.</p></Section>

    <Section icon={<UserRound size={17} />} title="Medical Profile" badge={medical.name ? 'READY' : 'INCOMPLETE'}><div className="medical-mini-grid"><div><small>NAME</small><strong>{medical.name || 'NOT SET'}</strong></div><div><small>ALLERGIES</small><strong>{medical.allergies || 'NONE RECORDED'}</strong></div></div><details className="medical-details"><summary>Edit medical profile <ChevronRight size={15} /></summary><label htmlFor="med-name">Name</label><input id="med-name" value={medical.name} onChange={(event) => updateMedical('name', event.target.value)} /><div className="grid2"><div><label htmlFor="med-age">Age</label><input id="med-age" type="number" min={0} max={120} value={medical.age ?? ''} onChange={(event) => updateMedical('age', event.target.value ? Number(event.target.value) : undefined)} /></div><div><label htmlFor="med-gender">Gender</label><select id="med-gender" value={medical.gender ?? ''} onChange={(event) => updateMedical('gender', event.target.value || undefined)}><option value="">Select</option>{GENDER_OPTIONS.map((gender) => <option key={gender} value={gender}>{gender}</option>)}</select></div><div><label htmlFor="med-blood">Blood group</label><input id="med-blood" value={medical.bloodGroup ?? ''} onChange={(event) => updateMedical('bloodGroup', event.target.value)} placeholder="O+" /></div><div><label htmlFor="med-contact-name">Emergency contact</label><input id="med-contact-name" value={medical.emergencyContactName ?? ''} onChange={(event) => updateMedical('emergencyContactName', event.target.value)} /></div><div><label htmlFor="med-contact-phone">Contact phone</label><input id="med-contact-phone" value={medical.emergencyContactPhone ?? ''} onChange={(event) => updateMedical('emergencyContactPhone', event.target.value)} /></div></div><label htmlFor="med-allergies">Allergies</label><textarea id="med-allergies" rows={2} value={medical.allergies ?? ''} onChange={(event) => updateMedical('allergies', event.target.value)} /><label htmlFor="med-medications">Medications</label><textarea id="med-medications" rows={2} value={medical.medications ?? ''} onChange={(event) => updateMedical('medications', event.target.value)} /><label htmlFor="med-conditions">Medical conditions</label><textarea id="med-conditions" rows={2} value={medical.medicalConditions ?? ''} onChange={(event) => updateMedical('medicalConditions', event.target.value)} /><label htmlFor="med-accessibility">Accessibility needs</label><textarea id="med-accessibility" rows={2} value={medical.accessibilityNeeds ?? ''} onChange={(event) => updateMedical('accessibilityNeeds', event.target.value)} /><label htmlFor="med-notes">Emergency notes</label><textarea id="med-notes" rows={2} value={medical.emergencyNotes ?? ''} onChange={(event) => updateMedical('emergencyNotes', event.target.value)} /><button className="btn-primary" type="button" disabled={savingMedical} onClick={() => void saveMedical()}>{savingMedical ? 'Saving...' : 'Save medical profile'}</button>{medicalStatus && <p className="ok-text">{medicalStatus}</p>}<MedicalCard info={medical} /></details></Section>

    <section className="hardware-footer-controls"><div><small>APPEARANCE</small>{(['system', 'light', 'dark'] as ThemePreference[]).map((theme) => <button key={theme} className={settings.theme === theme ? 'active' : ''} type="button" onClick={() => settings.update({ theme })}>{theme}</button>)}</div><button className="hardware-reset" type="button" onClick={settings.reset}><RotateCcw size={14} /> Reset relay settings</button></section>
  </div>;
}
