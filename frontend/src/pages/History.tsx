// Emergency History + Black Box (§39): past emergencies with expandable
// per-emergency timeline. When online and signed-in, history comes from the
// backend; offline it degrades to the local outbox — the app stays usable (§30).

import { useEffect, useState } from 'react';
import { apiFetch, useSession } from '../state/SessionContext';
import type { BlackBoxEntry } from '../state/MeshContext';

interface EmergencyRecord {
  id: string;
  type: string;
  status: string;
  severity: string;
  category?: string | null;
  message?: string | null;
  location_state: string;
  battery?: number | null;
  created_at: string;
  resolved_at?: string | null;
  resolved_how?: string | null;
}

export default function History() {
  const { user } = useSession();
  const [records, setRecords] = useState<EmergencyRecord[]>([]);
  const [outbox, setOutbox] = useState<Array<Record<string, unknown>>>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [blackBox, setBlackBox] = useState<BlackBoxEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('iqoo.blackbox');
      if (raw) setBlackBox(JSON.parse(raw) as BlackBoxEntry[]);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    // Local outbox always visible (offline-first, §30).
    try {
      const raw = localStorage.getItem('iqoo.outbox');
      if (raw) setOutbox(JSON.parse(raw) as Array<Record<string, unknown>>);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    apiFetch<{ emergencies: EmergencyRecord[] }>('/emergencies?limit=50')
      .then((r) => setRecords(r.emergencies ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load history'))
      .finally(() => setLoading(false));
  }, [user]);

  const fmt = (ts: number | string) => new Date(ts).toLocaleString();

  return (
    <div className="page">
      <h2>Emergency History</h2>

      {outbox.length > 0 && (
        <section className="card" aria-label="Pending offline emergency queue">
          <h3>⏳ Queued for sync ({outbox.length})</h3>
          <p className="dim small">These emergencies were created offline and will sync automatically when a connection is available.</p>
          <ul className="event-list">
            {outbox.map((o, i) => {
              const ev = (o.event ?? {}) as Record<string, unknown>;
              return (
                <li key={i}>
                  <span className="pill warn small">{String(ev.type ?? 'EMERGENCY')}</span>{' '}
                  <span className="mono">{String(ev.id ?? '—')}</span>{' '}
                  <span className="dim small">{ev.createdAt ? fmt(String(ev.createdAt)) : ''}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {loading && <p className="dim">Loading…</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {!user && <p className="dim">Sign in to see server-side history. Queued offline emergencies show above even without an account.</p>}

      {user && (
        <section aria-label="Past emergencies">
          <h3>Past emergencies</h3>
          {records.length === 0 && !loading && <p className="dim">No emergencies recorded.</p>}
          {records.map((r) => (
            <article className="card" key={r.id}>
              <header className="emergency-head">
                <button
                  className="btn link"
                  onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                  aria-expanded={expanded === r.id}
                  aria-controls={`timeline-${r.id}`}
                >
                  {expanded === r.id ? '▾' : '▸'} <strong className="mono">{r.id}</strong>
                </button>
                <span className={`pill ${r.severity === 'CRITICAL' ? 'off' : r.severity === 'HIGH' ? 'warn' : 'on'}`}>{r.severity}</span>
                <span>{r.type}</span>
                <span className={`pill ${r.status === 'ACTIVE' ? 'off' : r.status === 'RESOLVED' ? 'on' : ''}`}>{r.status}</span>
              </header>
              {r.message && <p className="small dim">“{r.message}”</p>}
              <p className="small dim">
                {fmt(r.created_at)}
                {r.category && <> · AI: {r.category}</>}
                {r.resolved_how && <> · resolved: {r.resolved_how}</>}
              </p>
              {expanded === r.id && (
                <div id={`timeline-${r.id}`} className="timeline-box">
                  <h4 className="small">Timeline (black box)</h4>
                  <ul className="event-list mono small">
                    {blackBox.length === 0 && <li className="dim">No timeline recorded on this device.</li>}
                    {blackBox.map((e, i) => (
                      <li key={i}><span className="dim">{new Date(e.ts).toLocaleTimeString()}</span> <strong>{e.event}</strong> {e.detail}</li>
                    ))}
                  </ul>
                </div>
              )}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
