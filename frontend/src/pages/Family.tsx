import { useCallback, useEffect, useState } from 'react';
import {
  Activity, ChevronUp, CircleHelp, HeartPulse, Link2, MessageSquare, Plus, ShieldCheck, Star, Trash2,
  UserRound, Users, X,
} from 'lucide-react';
import { apiFetch, useSession } from '../state/SessionContext';
import { useStatus } from '../state/StatusContext';
import { queueCheckIn } from '../state/checkInQueue';
import {
  Card, CardHeader, Modal, TextField, SelectField, StatusPill, toneForStatus, EmptyState, ActionButton, CheckboxField,
} from '../components/ui';

interface Member {
  id: string;
  name: string;
  relation: string;
  phone: string;
  iqooAccountId: string | null;
  iqooEmail?: string | null;
  priority: number;
  trusted: boolean;
  status: string;
  lastSeenAt: string | null;
  linked: boolean;
  checkInStatus: 'SAFE' | 'AT_RISK' | 'NEEDS_HELP' | null;
  lastCheckInAt: string | null;
}

const RELATIONS = ['FATHER', 'MOTHER', 'BROTHER', 'SISTER', 'PARTNER', 'FRIEND', 'GUARDIAN', 'OTHER'] as const;

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

const EMPTY_DRAFT = { name: '', relation: '', phone: '', iqooAccountId: '', priority: 3, trusted: false };

export default function Family() {
  const { user } = useSession();
  const { online } = useStatus();
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [testing, setTesting] = useState(false);
  const [testNote, setTestNote] = useState('');
  const [testOk, setTestOk] = useState(false);
  const [linkTarget, setLinkTarget] = useState<Member | null>(null);
  const [linkEmail, setLinkEmail] = useState('');
  const [linkNote, setLinkNote] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    setError('');
    await apiFetch<{ members: Member[] }>('/family')
      .then((r) => setMembers(r.members))
      .catch((e: Error) => setError(e.message));
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  if (!user) return <div className="card">Sign in to manage your family circle.</div>;

  async function addMember() {
    try {
      await apiFetch('/family', { method: 'POST', body: JSON.stringify({ ...draft, iqooAccountId: draft.iqooAccountId.trim() || undefined }) });
      setAdding(false);
      setDraft(EMPTY_DRAFT);
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

  async function unlink(id: string) {
    try {
      await apiFetch(`/family/${id}/link`, { method: 'DELETE' });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'unlink failed'); }
  }

  function openLink(member: Member) {
    setLinkTarget(member);
    setLinkEmail(member.iqooEmail ?? '');
    setLinkNote('');
  }

  async function saveLink() {
    if (!linkTarget) return;
    const email = linkEmail.trim().toLowerCase();
    try {
      // Resolve the account id from the backend, then link + resync in one call.
      const lookup = await apiFetch<{ userId: string }>(`/family/resolve-account?email=${encodeURIComponent(email)}`);
      await apiFetch(`/family/${linkTarget.id}/link`, {
        method: 'POST',
        body: JSON.stringify({ iqooAccountId: lookup.userId }),
      });
      setLinkNote('');
      setLinkTarget(null);
      await load();
    } catch (e) {
      setLinkNote(e instanceof Error ? e.message : 'Could not link this account');
    }
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

      <section className="family-members-section">
        <div className="family-list-heading"><h2><Users size={20} /> Emergency contacts ({members.length})</h2></div>
        {error && <p className="error-text">{error}</p>}
        {members.length === 0 && (
          <Card>
            <EmptyState icon={<CircleHelp size={24} />} title="No circle nodes yet" hint="Add the people who must know during your emergency." />
          </Card>
        )}
        {members.map((member) => {
          const Icon = iconFor(member.relation);
          return <article className="family-member-card" key={member.id}>
            <div className="family-member-head">
              <div className="family-member-identity">
                <div className="family-member-avatar"><Icon size={21} /><span>{initials(member.name)}</span></div>
                <div>
                  <div className="family-member-name"><h3>{member.name}</h3><span>{member.relation}</span>{member.trusted && <Star size={13} fill="currentColor" />}</div>
                  <p>{member.linked ? `Last check-in ${timeAgo(member.lastCheckInAt)}` : 'Not linked to a ResQNET account'}</p>
                </div>
              </div>
              <StatusPill tone={toneForStatus(member.checkInStatus)}>{member.checkInStatus ?? 'WAITING'}</StatusPill>
            </div>
            <div className="family-location-row">
              <span>{member.linked ? `LINKED · ${member.iqooAccountId}` : 'SMS FALLBACK / NOT LINKED'}</span>
            </div>
            <div className="family-telemetry">
              <div><small>PRIORITY</small><b>P{member.priority}</b></div>
              <div><small>PHONE</small><b>{member.phone}</b></div>
              <div><small>ACCOUNT</small><b>{member.linked ? 'LINKED' : 'SMS'}</b></div>
            </div>
            <div className="family-member-actions">
              <button type="button" aria-label={`Toggle trusted for ${member.name}`} onClick={() => void update(member.id, { trusted: !member.trusted })}><Star size={16} fill={member.trusted ? 'currentColor' : 'none'} /> {member.trusted ? 'TRUSTED' : 'TRUST'}</button>
              <button type="button" aria-label={`Raise priority for ${member.name}`} onClick={() => void update(member.id, { priority: Math.max(1, member.priority - 1) })}><ChevronUp size={16} /> PRIORITY</button>
              <button type="button" aria-label={`Link ResQNET account for ${member.name}`} onClick={() => openLink(member)}><Link2 size={16} /> {member.linked ? 'EDIT LINK' : 'LINK ACCOUNT'}</button>
              {member.linked && <button type="button" aria-label={`Unlink account for ${member.name}`} onClick={() => void unlink(member.id)}><X size={16} /> UNLINK</button>}
              <button className="danger-action" type="button" aria-label={`Remove ${member.name}`} onClick={() => void remove(member.id)}><Trash2 size={16} /> REMOVE</button>
            </div>
          </article>;
        })}
      </section>

      <section className="family-tools-grid">
        <div className="family-tool-card"><div className="family-section-heading"><span><MessageSquare size={16} /> COMMUNICATION CHECK</span><strong>REAL PIPELINE</strong></div><p className="muted">Send a real CHECK_IN event through the same backend path an SOS uses.</p><button className="btn-secondary" type="button" disabled={testing} onClick={() => void testCommunication()}>{testing ? 'Sending...' : 'Send test check-in'}</button>{testNote && <p className={testOk ? 'ok-text' : 'error-text'} role="status">{testNote}</p>}</div>
        <div className="family-tool-card family-add-card"><div><span className="eyebrow">CIRCLE ADMIN</span><h2>Add a trusted node</h2><p className="muted">Invite someone who should receive emergency updates.</p></div><button className="btn-primary" type="button" onClick={() => setAdding((value) => !value)}>{adding ? <X size={18} /> : <Plus size={18} />} {adding ? 'Close form' : 'Add member'}</button></div>
      </section>

      {adding && (
        <Card>
          <CardHeader icon={<Plus size={17} />} title="New circle node" subtitle="Their email links their ResQNET account so live status flows in." />
          <div className="rq-modal-body" style={{ display: 'grid', gap: 12 }}>
            <TextField label="Name" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} placeholder="Full name" />
            <div className="grid2">
              <SelectField label="Relation" value={draft.relation} onChange={(relation) => setDraft({ ...draft, relation })} options={[{ value: '', label: 'Choose relation' }, ...RELATIONS.map((r) => ({ value: r, label: r }))]} />
              <SelectField label="Priority" value={String(draft.priority)} onChange={(value) => setDraft({ ...draft, priority: Number(value) })} options={[{ value: '1', label: '1 - Highest' }, { value: '2', label: '2 - High' }, { value: '3', label: '3 - Standard' }]} />
            </div>
            <TextField label="Phone for messages" value={draft.phone} onChange={(phone) => setDraft({ ...draft, phone })} placeholder="+91 ..." inputMode="tel" />
            <TextField
              label="ResQNET account email (optional)"
              hint="Exactly the email they registered with — their live check-ins then appear here."
              value={draft.iqooAccountId}
              onChange={(iqooAccountId) => setDraft({ ...draft, iqooAccountId })}
              placeholder="family@student.gitam.edu"
              inputMode="email"
            />
            <CheckboxField label="Trusted contact" checked={draft.trusted} onChange={(trusted) => setDraft({ ...draft, trusted })} />
            <div className="row mt">
              <ActionButton variant="primary" onClick={() => void addMember()} disabled={!draft.name.trim() || !draft.relation || !draft.phone.trim()}>Add node</ActionButton>
              <ActionButton variant="ghost" onClick={() => setAdding(false)}>Cancel</ActionButton>
            </div>
          </div>
        </Card>
      )}

      <Modal
        open={linkTarget !== null}
        onClose={() => setLinkTarget(null)}
        title={linkTarget ? `Link account — ${linkTarget.name}` : 'Link account'}
        subtitle="Enter the email their ResQNET account was registered with."
      >
        <TextField label="Account email" value={linkEmail} onChange={setLinkEmail} inputMode="email" placeholder="family@student.gitam.edu" />
        {linkNote && <p className="error-text" role="alert">{linkNote}</p>}
        <div className="row wrap">
          <ActionButton variant="primary" onClick={() => void saveLink()} disabled={!linkEmail.trim()}>Link & sync now</ActionButton>
          <ActionButton variant="ghost" onClick={() => setLinkTarget(null)}>Cancel</ActionButton>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          Linking stores their account id on this contact and immediately pulls their latest check-in and location from the database.
        </p>
      </Modal>

      {!online && <p className="muted small">Offline: changes will retry when the connection returns.</p>}
    </div>
  );
}
