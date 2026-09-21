import { useCallback, useEffect, useState } from 'react';
import {
  Activity, CheckCircle2, ChevronUp, CircleHelp, HeartPulse, MessageSquare, Plus, RefreshCw, ShieldCheck, Star, Trash2,
  UserRound, Users, X,
} from 'lucide-react';
import { apiFetch, useSession } from '../state/SessionContext';
import { useStatus } from '../state/StatusContext';
import { queueCheckIn } from '../state/checkInQueue';

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
  const { online } = useStatus();
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', relation: 'FATHER', phone: '', priority: 3, trusted: false });
  const [testing, setTesting] = useState(false);
  const [testNote, setTestNote] = useState('');
  const [testOk, setTestOk] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setError('');
    await apiFetch<{ members: Member[] }>('/family')
      .then((r) => setMembers(r.members))
      .catch((e: Error) => setError(e.message));
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const safeCount = members.filter((member) => member.checkInStatus === 'SAFE').length;

  if (!user) return <div className="card">Sign in to manage your family circle.</div>;

  async function addMember() {
    try {
      await apiFetch('/family', { method: 'POST', body: JSON.stringify(draft) });
      setAdding(false);
      setDraft({ name: '', relation: 'FATHER', phone: '', priority: 3, trusted: false });
      await load();
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
        method: 'POST', body: JSON.stringify({ status: 'SAFE', checkInId: crypto.randomUUID(), note: 'Communication test from Family page' }),
      });
      await apiFetch('/check-ins/family-status');
      setTestOk(true);
      setTestNote(`Test check-in ${r.checkInId.slice(0, 8)}... recorded and readable.`);
      load();
    } catch (e) {
      const queued = queueCheckIn({ status: 'SAFE', note: 'Communication test from Family page' });
      setTestOk(false); setTestNote(`${e instanceof Error ? e.message : 'Offline'} — queued as ${queued.id.slice(0, 8)}...`);
    } finally { setTesting(false); }
  }

  return (
    <div className="page family-page">
      <section className="family-title-row">
        <div>
          <span className="eyebrow">RESQNET / TRUSTED CONTACTS</span>
          <h1>Family circle</h1>
          <p className="muted">Manage emergency contacts and see their latest linked check-in.</p>
        </div>
        <div className="family-node-badge">{members.length} CONTACTS</div>
      </section>

      <section className="family-summary" aria-live="polite">
        <span><CheckCircle2 size={16} /> {safeCount}/{members.length} marked safe</span>
        <span>{members.filter((member) => member.linked).length} linked account{members.filter((member) => member.linked).length === 1 ? '' : 's'}</span>
        <button className="family-icon-action" type="button" aria-label="Refresh family status" title="Refresh family status" onClick={load}><RefreshCw size={18} /></button>
      </section>

      <section className="family-members-section">
        <div className="family-list-heading"><h2><Users size={20} /> Emergency contacts ({members.length})</h2></div>
        {error && <p className="error-text">{error}</p>}
        {members.length === 0 && <div className="card family-empty"><CircleHelp size={24} /><div><strong>No circle nodes yet</strong><p className="muted">Add the people who must know during your emergency.</p></div></div>}
        {members.map((member) => {
          const Icon = iconFor(member.relation);
          const safe = member.checkInStatus === 'SAFE';
          return <article className="family-member-card" key={member.id}>
            <div className="family-member-head"><div className="family-member-identity"><div className="family-member-avatar"><Icon size={21} /><span>{initials(member.name)}</span></div><div><div className="family-member-name"><h3>{member.name}</h3><span>{member.relation}</span>{member.trusted && <Star size={13} fill="currentColor" />}</div><p>{member.linked ? `Last check-in ${timeAgo(member.lastCheckInAt)}` : 'Not linked to a ResQNET account'}</p></div></div><span className={`family-status ${safe ? 'safe' : member.checkInStatus === 'NEEDS_HELP' ? 'danger' : 'waiting'}`}>{safe ? <CheckCircle2 size={15} /> : <Activity size={15} />}{safe ? 'SAFE' : member.checkInStatus || 'WAITING'}</span></div>
            <div className="family-location-row"><span>{member.linked ? 'LINKED RESQNET ACCOUNT' : 'SMS FALLBACK / NOT LINKED'}</span></div>
            <div className="family-telemetry"><div><small>PRIORITY</small><b>P{member.priority}</b></div><div><small>PHONE</small><b>{member.phone}</b></div><div><small>ACCOUNT</small><b>{member.linked ? 'LINKED' : 'SMS'}</b></div></div>
            <div className="family-member-actions"><button type="button" aria-label={`Toggle trusted for ${member.name}`} onClick={() => void update(member.id, { trusted: !member.trusted })}><Star size={16} fill={member.trusted ? 'currentColor' : 'none'} /> {member.trusted ? 'TRUSTED' : 'TRUST'}</button><button type="button" aria-label={`Raise priority for ${member.name}`} onClick={() => void update(member.id, { priority: Math.max(1, member.priority - 1) })}><ChevronUp size={16} /> PRIORITY</button><button className="danger-action" type="button" aria-label={`Remove ${member.name}`} onClick={() => void remove(member.id)}><Trash2 size={16} /> REMOVE</button></div>
          </article>;
        })}
      </section>

      <section className="family-tools-grid">
        <div className="family-tool-card"><div className="family-section-heading"><span><MessageSquare size={16} /> COMMUNICATION CHECK</span><strong>REAL PIPELINE</strong></div><p className="muted">Send a real CHECK_IN event through the same backend path an SOS uses.</p><button className="btn-secondary" type="button" disabled={testing} onClick={() => void testCommunication()}>{testing ? 'Sending...' : 'Send test check-in'}</button>{testNote && <p className={testOk ? 'ok-text' : 'error-text'} role="status">{testNote}</p>}</div>
        <div className="family-tool-card family-add-card"><div><span className="eyebrow">CIRCLE ADMIN</span><h2>Add a trusted node</h2><p className="muted">Invite someone who should receive emergency updates.</p></div><button className="btn-primary" type="button" onClick={() => setAdding((value) => !value)}>{adding ? <X size={18} /> : <Plus size={18} />} {adding ? 'Close form' : 'Add member'}</button></div>
      </section>

      {adding && <section className="card family-form"><h2>New circle node</h2><label htmlFor="fname">Name</label><input id="fname" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Full name" /><div className="grid2"><div><label htmlFor="frel">Relation</label><select id="frel" value={draft.relation} onChange={(e) => setDraft({ ...draft, relation: e.target.value })}>{RELATIONS.map((relation) => <option key={relation} value={relation}>{relation}</option>)}</select></div><div><label htmlFor="fprio">Priority</label><input id="fprio" type="number" min={1} max={9} value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })} /></div></div><label htmlFor="fphone">Phone</label><input id="fphone" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} placeholder="+91 ..." /><label className="family-check-label"><input type="checkbox" checked={draft.trusted} onChange={(e) => setDraft({ ...draft, trusted: e.target.checked })} /> Trusted contact</label><div className="row mt"><button className="btn-primary" type="button" onClick={() => void addMember()} disabled={!draft.name || !draft.phone}>Add node</button><button className="btn-ghost" type="button" onClick={() => setAdding(false)}>Cancel</button></div></section>}

      {!online && <p className="muted small">Offline: changes will retry when the connection returns.</p>}
    </div>
  );
}
