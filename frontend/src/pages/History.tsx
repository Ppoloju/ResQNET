// Emergency History + Black Box (§39): past emergencies with expandable
// per-emergency timeline. When online and signed-in, history comes from the
// backend; offline it degrades to the local outbox — the app stays usable (§30).

import { useEffect, useState } from 'react';
import { History as HistoryIcon, Clock3, Hourglass, Archive } from 'lucide-react';
import { apiFetch, useSession } from '../state/SessionContext';
import type { BlackBoxEntry } from '../state/MeshContext';
import { Card, CardHeader, PageHeader, EmptyState, MiniRow, StatusPill } from '../components/ui';

interface EmergencyRecord {
  id: string;
  type: string;
  status: string;
  severity: string;
  category?: string | null;
  message?: string | null;
  location?: { state: string } | null;
  battery?: number | null;
  createdAt: string;
  resolvedAt?: string | null;
  resolvedHow?: string | null;
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
      const raw = localStorage.getItem('resqnet.blackbox');
      if (raw) setBlackBox(JSON.parse(raw) as BlackBoxEntry[]);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    // Local outbox always visible (offline-first, §30).
    try {
      const raw = localStorage.getItem('resqnet.outbox');
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

  return (
    <div className="page">
      <PageHeader
        eyebrow="RESQNET / BLACK BOX"
        title="Emergency history"
        subtitle="Past emergencies with the on-device timeline for each activation."
        badge={user ? `${records.length} RECORD${records.length === 1 ? '' : 'S'}` : 'LOCAL ONLY'}
        badgeTone={user ? 'info' : 'waiting'}
      />

      {outbox.length > 0 && (
        <Card>
          <CardHeader icon={<Hourglass size={17} />} title={`Queued for sync (${outbox.length})`} subtitle="Created offline — they sync automatically when a connection is available." />
          <div className="rq-mini-list">
            {outbox.map((o, i) => {
              const ev = (o.event ?? {}) as Record<string, unknown>;
              return (
                <MiniRow
                  key={i}
                  icon={<Hourglass size={13} />}
                  title={String(ev.type ?? 'EMERGENCY')}
                  meta={`${String(ev.id ?? '—')}${ev.createdAt ? ` · ${new Date(String(ev.createdAt)).toLocaleString()}` : ''}`}
                  pill={<StatusPill tone="waiting">QUEUED</StatusPill>}
                />
              );
            })}
          </div>
        </Card>
      )}

      {loading && <p className="dim">Loading…</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
      {!user && (
        <Card>
          <EmptyState icon={<HistoryIcon size={20} />} title="Sign in to see server-side history" hint="Queued offline emergencies show above even without an account." />
        </Card>
      )}

      {user && (
        <Card>
          <CardHeader icon={<Archive size={17} />} title="Past emergencies" subtitle={records.length === 0 && !loading ? 'No emergencies recorded.' : 'Tap an entry to expand its black-box timeline.'} />
          {records.map((r) => (
            <div className="rq-mini-list" key={r.id} style={{ marginBottom: 6 }}>
              <MiniRow
                icon={<Clock3 size={13} />}
                title={`${r.type} · ${r.severity}`}
                meta={`${new Date(r.createdAt).toLocaleString()} · ${r.id}${r.message ? ` · “${r.message}”` : ''}`}
                onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                pill={<StatusPill tone={r.status === 'RESOLVED' ? 'safe' : r.status === 'ACTIVE' ? 'danger' : 'waiting'}>{r.status}</StatusPill>}
              />
              {expanded === r.id && (
                <div className="timeline-box" style={{ padding: '8px 10px' }}>
                  <h4 className="small" style={{ marginTop: 0 }}>Timeline (black box)</h4>
                  <ul className="event-list mono small">
                    {blackBox.length === 0 && <li className="dim">No timeline recorded on this device.</li>}
                    {blackBox.map((e, i) => (
                      <li key={i}><span className="dim">{new Date(e.ts).toLocaleTimeString()}</span> <strong>{e.event}</strong> {e.detail}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
