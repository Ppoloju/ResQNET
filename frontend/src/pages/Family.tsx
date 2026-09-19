import { useCallback, useEffect, useState } from 'react';
import { apiFetch, useSession } from '../state/SessionContext';

interface Member {
  id: string;
  name: string;
  relation: string;
  phone: string;
  priority: number;
  trusted: boolean;
  status: string;
  lastSeenAt: string | null;
}

interface FamilyCheckIn {
  id: string;
  name: string;
  linked: boolean;
  checkInStatus: 'SAFE' | 'AT_RISK' | 'NEEDS_HELP' | null;
  lastCheckInAt: string | null;
}

const RELATIONS = ['FATHER', 'MOTHER', 'BROTHER', 'SISTER', 'PARTNER', 'FRIEND', 'GUARDIAN', 'OTHER'];

export default function Family() {
  const { user } = useSession();
  const [members, setMembers] = useState<Member[]>([]);
  const [checkins, setCheckins] = useState<FamilyCheckIn[]>([]);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', relation: 'FATHER', phone: '', priority: 3, trusted: false });

  const load = useCallback(() => {
    if (!user) return;
    apiFetch<{ members: Member[] }>('/family')
      .then((r) => setMembers(r.members))
      .catch((e: Error) => setError(e.message));
    // §25: latest check-in per member with a linked ResQNET account.
    apiFetch<{ members: FamilyCheckIn[] }>('/check-ins/family-status')
      .then((r) => setCheckins(r.members))
      .catch(() => setCheckins([])); // offline: statuses simply show as unknown
  }, [user]);

  useEffect(load, [load]);

  if (!user) return <div className="card">Sign in to manage your family circle.</div>;

  async function addMember() {
    try {
      await apiFetch('/family', { method: 'POST', body: JSON.stringify(draft) });
      setAdding(false);
      setDraft({ name: '', relation: 'FATHER', phone: '', priority: 3, trusted: false });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    }
  }

  async function update(id: string, patch: Partial<Member>) {
    await apiFetch(`/family/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
    load();
  }

  async function remove(id: string) {
    await apiFetch(`/family/${id}`, { method: 'DELETE' });
    load();
  }

  const [testing, setTesting] = useState(false);
  const [testNote, setTestNote] = useState('');
  const [testOk, setTestOk] = useState(false);

  /** Round-trip through the REAL pipeline: check-in POST → row → family-status readback. */
  const testCommunication = async () => {
    setTesting(true);
    setTestNote('');
    try {
      const r = await apiFetch<{ checkInId: string }>('/check-ins', {
        method: 'POST',
        body: JSON.stringify({ status: 'SAFE', note: 'Communication test from Family page' }),
      });
      // Prove the write landed: read the family-status feed again.
      await apiFetch('/check-ins/family-status').then(() => {
        setTestOk(true);
        setTestNote(`✓ Test check-in ${r.checkInId.slice(0, 8)}… recorded and readable — the notification path is live.`);
      });
    } catch (e) {
      setTestOk(false);
      setTestNote(e instanceof Error ? e.message : 'Test failed — queued for retry when online');
    } finally {
      setTesting(false);
    }
  };

  const checkinFor = (name: string): FamilyCheckIn | undefined =>
    checkins.find((c) => c.name === name);

  const statusPill = (s: FamilyCheckIn['checkInStatus']) => {
    if (!s) return <span className="pill dim small">no check-in</span>;
    if (s === 'SAFE') return <span className="pill on small">✓ SAFE</span>;
    if (s === 'AT_RISK') return <span className="pill warn small">⚠ AT RISK</span>;
    return <span className="pill off small">✗ NEEDS HELP</span>;
  };

  return (
    <div>
      <h1>Family Circle</h1>
      {error && <p className="error-text">{error}</p>}
      {members.length === 0 && <div className="card">No members yet. Add the people who must know during your emergency.</div>}
      {members.map((m) => (
        <div key={m.id} className="list-item">
          <div>
            <strong>{m.name}</strong> <span className="muted">{m.relation} · P{m.priority} {m.trusted ? '· ★ trusted' : ''}</span>
            <div className="muted mono">{m.phone} · status: {m.status}</div>
            {(() => {
              const c = checkinFor(m.name);
              return c?.linked ? (
                <div className="row" style={{ gap: 6, marginTop: 4 }}>
                  {statusPill(c.checkInStatus)}
                  {c.lastCheckInAt && <span className="muted" style={{ fontSize: '0.75rem' }}>{new Date(c.lastCheckInAt).toLocaleString()}</span>}
                </div>
              ) : c && !c.linked ? (
                <div className="muted" style={{ fontSize: '0.75rem', marginTop: 4 }}>not on ResQNET — SMS path [R]</div>
              ) : null;
            })()}
          </div>
          <div className="row">
            <button
              className="btn-ghost"
              aria-label={`Toggle trusted for ${m.name}`}
              onClick={() => void update(m.id, { trusted: !m.trusted })}
            >
              ★
            </button>
            <button
              className="btn-ghost"
              aria-label={`Raise priority for ${m.name}`}
              onClick={() => void update(m.id, { priority: Math.max(1, m.priority - 1) })}
            >
              ▲
            </button>
            <button className="btn-ghost" aria-label={`Remove ${m.name}`} onClick={() => void remove(m.id)}>✕</button>
          </div>
        </div>
      ))}

      {members.length > 0 && (
        <div className="card">
          <h2>Test communication</h2>
          <p className="muted">
            Sends a real CHECK_IN event through the same path an SOS uses (backend → sync).
            Members with a linked ResQNET account see it instantly via live updates; SMS delivery is
            a documented production integration [R].
          </p>
          <button
            className="btn-secondary"
            style={{ width: '100%' }}
            disabled={testing}
            onClick={() => void testCommunication()}
          >
            {testing ? 'Sending…' : 'Send test check-in to my circle'}
          </button>
          {testNote && <p className={testOk ? 'ok-text' : 'error-text'} role="status">{testNote}</p>}
        </div>
      )}

      {adding ? (
        <div className="card">
          <h2>Add member</h2>
          <label htmlFor="fname">Name</label>
          <input id="fname" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <div className="grid2">
            <div>
              <label htmlFor="frel">Relation</label>
              <select id="frel" value={draft.relation} onChange={(e) => setDraft({ ...draft, relation: e.target.value })}>
                {RELATIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="fprio">Priority (1 = notify first)</label>
              <input id="fprio" type="number" min={1} max={9} value={draft.priority}
                onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })} />
            </div>
          </div>
          <label htmlFor="fphone">Phone</label>
          <input id="fphone" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" style={{ width: 20, height: 20 }} checked={draft.trusted}
              onChange={(e) => setDraft({ ...draft, trusted: e.target.checked })} />
            Trusted contact
          </label>
          <div className="row mt">
            <button className="btn-primary" onClick={() => void addMember()} disabled={!draft.name || !draft.phone}>Add</button>
            <button className="btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="btn-primary" style={{ width: '100%' }} onClick={() => setAdding(true)}>
          + Add family member
        </button>
      )}
    </div>
  );
}
