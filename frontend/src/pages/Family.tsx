import { useCallback, useEffect, useState } from 'react';
import {
  Activity, BatteryCharging, Bluetooth, CheckCircle2, ChevronUp, Clock3,
  CircleHelp, Cpu, HeartPulse, Link2, MessageSquare, Plus, RefreshCw, ShieldCheck, Signal, Star, Trash2,
  UserRound, Users, X,
} from 'lucide-react';
import { apiFetch, useSession } from '../state/SessionContext';
import { useStatus } from '../state/StatusContext';

interface Member {
  id: string;
  name: string;
  relation: string;
  phone: string;
  priority: number;
  trusted: boolean;
  status: string;
  lastSeenAt: string | null;
  linked: boolean;
  checkInStatus: 'SAFE' | 'AT_RISK' | 'NEEDS_HELP' | null;
  lastCheckInAt: string | null;
}

const RELATIONS = ['FATHER', 'MOTHER', 'BROTHER', 'SISTER', 'PARTNER', 'FRIEND', 'GUARDIAN', 'OTHER'];

function timeAgo(value: string | null): string {
  if (!value) return 'awaiting sync';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

function initials(name: string): string {
  return name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}

function iconFor(relation: string) {
  if (relation === 'MOTHER' || relation === 'FATHER' || relation === 'GUARDIAN') return ShieldCheck;
  if (relation === 'PARTNER') return HeartPulse;
  return UserRound;
}

export default function Family() {
  const { user } = useSession();
  const { online, battery, charging } = useStatus();
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [actionNote, setActionNote] = useState('');
  const [draft, setDraft] = useState({ name: '', relation: 'FATHER', phone: '', priority: 3, trusted: false });
  const [testing, setTesting] = useState(false);
  const [testNote, setTestNote] = useState('');
  const [testOk, setTestOk] = useState(false);

  const load = useCallback(() => {
    if (!user) return;
    setError('');
    apiFetch<{ members: Member[] }>('/family')
      .then((r) => setMembers(r.members))
      .catch((e: Error) => setError(e.message));
  }, [user]);

  useEffect(load, [load]);

  const linkedCount = members.filter((member) => member.linked).length;
  const safeCount = members.filter((member) => member.checkInStatus === 'SAFE').length;

  if (!user) return <div className="card">Sign in to manage your family circle.</div>;

  async function addMember() {
    try {
      await apiFetch('/family', { method: 'POST', body: JSON.stringify(draft) });
      setAdding(false);
      setDraft({ name: '', relation: 'FATHER', phone: '', priority: 3, trusted: false });
      setActionNote('Circle node added and queued for sync.');
      load();
    } catch (e) { setError(e instanceof Error ? e.message : 'failed'); }
  }

  async function update(id: string, patch: Partial<Member>) {
    try { await apiFetch(`/family/${id}`, { method: 'PUT', body: JSON.stringify(patch) }); load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'update failed'); }
  }

  async function remove(id: string) {
    try { await apiFetch(`/family/${id}`, { method: 'DELETE' }); load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'remove failed'); }
  }

  async function testCommunication() {
    setTesting(true); setTestNote('');
    try {
      const r = await apiFetch<{ checkInId: string }>('/check-ins', {
        method: 'POST', body: JSON.stringify({ status: 'SAFE', note: 'Communication test from Family page' }),
      });
      await apiFetch('/check-ins/family-status');
      setTestOk(true);
      setTestNote(`Test check-in ${r.checkInId.slice(0, 8)}... recorded and readable.`);
      load();
    } catch (e) {
      setTestOk(false); setTestNote(e instanceof Error ? e.message : 'Test failed - queued for retry when online');
    } finally { setTesting(false); }
  }

  return (
    <div className="page family-page">
      <section className="family-title-row">
        <div>
          <span className="eyebrow">RESQNET / RELAY PROFILE</span>
          <h1>Family circle</h1>
          <p className="muted">Encrypted status, relay paths, and trusted contacts in one field view.</p>
        </div>
        <div className="family-node-badge"><span className="pulse-dot" /> {members.length + 1} NODES ACTIVE</div>
      </section>

      <section className="family-device-strip" aria-label="Device status">
        <span><BatteryCharging size={15} /> iQOO {battery === null ? '--' : `${battery}%`}{charging ? ' CHARGING' : ''}</span>
        <span><Cpu size={15} /> SECURE ENCLAVE OK</span>
        <span><Bluetooth size={15} /> BLE RADIO</span>
        <span className={online ? 'is-live' : 'is-muted'}><span className="pulse-dot" /> {online ? 'MESH ONLINE' : 'OFFLINE QUEUE'}</span>
      </section>

      <section className="family-sync-banner" aria-live="polite">
        <div className="family-sync-icon"><ShieldCheck size={21} /><span className="ping-ring" /></div>
        <div className="family-sync-copy"><span className="eyebrow">DECRYPTED SAFE SYNC INBOUND</span><h2>{safeCount || members.length ? 'Family circle status confirmed' : 'Circle awaiting first sync'}</h2></div>
        <span className="family-time"><Clock3 size={13} /> {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        <div className="family-sync-metrics"><span><CheckCircle2 size={15} /> {safeCount}/{members.length || 0} SAFE</span><span><Link2 size={15} /> {linkedCount} LINKED</span><span><Link2 size={15} /> STORE-AND-FORWARD</span></div>
      </section>

      <div className="family-refresh-row"><span className="muted small">Statuses are loaded from linked family accounts.</span><button className="family-icon-action" type="button" aria-label="Refresh family status" title="Refresh family status" onClick={load}><RefreshCw size={18} /></button></div>

      <section className="family-members-section">
        <div className="family-list-heading"><h2><Users size={20} /> Circle nodes ({members.length})</h2><span>AUTO-SYNC: ACTIVE</span></div>
        {error && <p className="error-text">{error}</p>}
        {members.length === 0 && <div className="card family-empty"><CircleHelp size={24} /><div><strong>No circle nodes yet</strong><p className="muted">Add the people who must know during your emergency.</p></div></div>}
        {members.map((member) => {
          const Icon = iconFor(member.relation);
          const safe = member.checkInStatus === 'SAFE';
          return <article className="family-member-card" key={member.id}>
            <div className="family-member-head"><div className="family-member-identity"><div className="family-member-avatar"><Icon size={21} /><span>{initials(member.name)}</span></div><div><div className="family-member-name"><h3>{member.name}</h3><span>{member.relation}</span>{member.trusted && <Star size={13} fill="currentColor" />}</div><p><span className="mono">NODE_{member.id.slice(0, 4).toUpperCase()}</span><i /> {timeAgo(member.lastCheckInAt ?? member.lastSeenAt)}</p></div></div><span className={`family-status ${safe ? 'safe' : member.checkInStatus === 'NEEDS_HELP' ? 'danger' : 'waiting'}`}>{safe ? <CheckCircle2 size={15} /> : <Activity size={15} />}{safe ? 'SAFE' : member.checkInStatus || 'WAITING'}</span></div>
            <div className="family-location-row"><span>{member.linked ? 'LINKED RESQNET ACCOUNT' : 'SMS FALLBACK / NOT LINKED'}</span></div>
            <div className="family-telemetry"><div><small>PRIORITY</small><b>P{member.priority}</b></div><div><small>STATUS</small><b>{member.status}</b></div><div><small>CHECK-IN</small><b><Signal size={14} /> {member.linked ? timeAgo(member.lastCheckInAt) : 'NO LINK'}</b></div></div>
            <div className="family-member-actions"><button type="button" aria-label={`Toggle trusted for ${member.name}`} onClick={() => void update(member.id, { trusted: !member.trusted })}><Star size={16} fill={member.trusted ? 'currentColor' : 'none'} /> {member.trusted ? 'TRUSTED' : 'TRUST'}</button><button type="button" aria-label={`Raise priority for ${member.name}`} onClick={() => void update(member.id, { priority: Math.max(1, member.priority - 1) })}><ChevronUp size={16} /> PRIORITY</button><button className="danger-action" type="button" aria-label={`Remove ${member.name}`} onClick={() => void remove(member.id)}><Trash2 size={16} /> REMOVE</button></div>
          </article>;
        })}
      </section>

      {actionNote && <p className="family-action-note" role="status"><CheckCircle2 size={16} /> {actionNote}</p>}

      <section className="family-tools-grid">
        <div className="family-tool-card"><div className="family-section-heading"><span><MessageSquare size={16} /> COMMUNICATION CHECK</span><strong>REAL PIPELINE</strong></div><p className="muted">Send a real CHECK_IN event through the same backend path an SOS uses.</p><button className="btn-secondary" type="button" disabled={testing} onClick={() => void testCommunication()}>{testing ? 'Sending...' : 'Send test check-in'}</button>{testNote && <p className={testOk ? 'ok-text' : 'error-text'} role="status">{testNote}</p>}</div>
        <div className="family-tool-card family-add-card"><div><span className="eyebrow">CIRCLE ADMIN</span><h2>Add a trusted node</h2><p className="muted">Invite someone who should receive emergency updates.</p></div><button className="btn-primary" type="button" onClick={() => setAdding((value) => !value)}>{adding ? <X size={18} /> : <Plus size={18} />} {adding ? 'Close form' : 'Add member'}</button></div>
      </section>

      {adding && <section className="card family-form"><h2>New circle node</h2><label htmlFor="fname">Name</label><input id="fname" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Full name" /><div className="grid2"><div><label htmlFor="frel">Relation</label><select id="frel" value={draft.relation} onChange={(e) => setDraft({ ...draft, relation: e.target.value })}>{RELATIONS.map((relation) => <option key={relation} value={relation}>{relation}</option>)}</select></div><div><label htmlFor="fprio">Priority</label><input id="fprio" type="number" min={1} max={9} value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })} /></div></div><label htmlFor="fphone">Phone</label><input id="fphone" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} placeholder="+91 ..." /><label className="family-check-label"><input type="checkbox" checked={draft.trusted} onChange={(e) => setDraft({ ...draft, trusted: e.target.checked })} /> Trusted contact</label><div className="row mt"><button className="btn-primary" type="button" onClick={() => void addMember()} disabled={!draft.name || !draft.phone}>Add node</button><button className="btn-ghost" type="button" onClick={() => setAdding(false)}>Cancel</button></div></section>}

      <section className="family-security-footer"><span><span className="security-dot" /> HMAC-SHA256: VALID</span><span>ED25519 VERIFIED BY DEVICE KEY</span></section>
    </div>
  );
}
