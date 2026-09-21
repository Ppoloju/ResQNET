// Responder Dashboard (§18, Phase 12): live feed of active emergencies for
// responders/gateways, with emergency-card details, location link, and ACK action.
// Data comes from the real /responders/feed endpoint (RBAC: responder|admin).

import { useCallback, useEffect, useState } from 'react';
import { Siren, Radio, CheckCircle2 } from 'lucide-react';
import { apiFetch, useSession } from '../state/SessionContext';
import { useRealtime } from '../state/RealtimeContext';
import { Card, CardHeader, PageHeader, StatusPill, ActionButton, EmptyState, MiniRow } from '../components/ui';

interface FeedEmergency {
  id: string;
  type: string;
  status: string;
  severity: string;
  category?: string | null;
  message?: string | null;
  lat?: number | null;
  lon?: number | null;
  location_state: string;
  battery?: number | null;
  created_at: string;
  user_name: string;
  snapshot?: {
    name?: string; age?: number; blood_group?: string;
    allergies?: string | null; medical_conditions?: string | null; medications?: string | null;
    emergency_contact?: string;
  } | null;
}

interface FeedBroadcast { id: string; mode: string; message: string; priority: string; issued_at?: string; createdAt?: string }
interface FeedCheckin { id: string; status: string; message?: string | null; created_at: string; user_name: string }

function mapsUrl(lat?: number | null, lon?: number | null): string | null {
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;
}

const SEVERITY_TONE: Record<string, 'danger' | 'waiting' | 'safe'> = {
  CRITICAL: 'danger', HIGH: 'waiting', MEDIUM: 'info', LOW: 'safe',
} as never;

export default function Responders() {
  const { user } = useSession();
  const [emergencies, setEmergencies] = useState<FeedEmergency[]>([]);
  const [broadcasts, setBroadcasts] = useState<FeedBroadcast[]>([]);
  const [checkins, setCheckins] = useState<FeedCheckin[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [acked, setAcked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    apiFetch<{ activeEmergencies: FeedEmergency[]; broadcasts: FeedBroadcast[]; recentCheckins: FeedCheckin[] }>('/responders/feed')
      .then((r) => {
        setEmergencies(r.activeEmergencies ?? []);
        setBroadcasts(r.broadcasts ?? []);
        setCheckins(r.recentCheckins ?? []);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load feed'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // New mesh_event pushes refresh the feed (debounced — floods settle in one render).
  const [dirty, setDirty] = useState(false);
  useRealtime({
    mesh_event: () => setDirty(true),
    responder_ack: () => setDirty(true),
  });
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => { setDirty(false); load(); }, 500);
    return () => clearTimeout(t);
  }, [dirty, load]);

  const acknowledge = async (emergencyId: string) => {
    try {
      await apiFetch('/responders/ack', { method: 'POST', body: JSON.stringify({ emergencyId }) });
      setAcked((s) => new Set(s).add(emergencyId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ACK failed');
    }
  };

  const isResponder = user?.role === 'responder' || user?.role === 'admin';

  if (!user) return <div className="page"><Card><EmptyState icon={<Siren size={20} />} title="Sign in to view the responder dashboard" /></Card></div>;
  if (!isResponder) {
    return (
      <div className="page">
        <PageHeader eyebrow="RESQNET / RESPONDERS" title="Responder dashboard" />
        <Card>
          <EmptyState
            icon={<Siren size={20} />}
            title={`Your account role is “${user.role}”`}
            hint="Responder accounts (role=responder) see the live emergency feed. For the demo, ask an admin to upgrade your role, or use the seeded demo responders."
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="RESQNET / RESPONDERS"
        title="Responder dashboard"
        subtitle="Active emergencies, disaster broadcasts, and safety check-ins arriving through the mesh + gateway sync."
        badge={loading ? 'LOADING…' : `${emergencies.length} ACTIVE`}
        badgeTone={emergencies.length > 0 ? 'danger' : 'safe'}
      />
      {error && <p className="error-text" role="alert">{error}</p>}

      <Card>
        <CardHeader icon={<Siren size={17} />} title={`Active emergencies (${emergencies.length})`} />
        {!loading && emergencies.length === 0 && <EmptyState icon={<Siren size={18} />} title="No active emergencies" />}
        {emergencies.map((e) => (
          <article className="emergency-item rq-card" key={e.id} aria-label={`Emergency ${e.id}`} style={{ marginBottom: 10 }}>
            <header className="emergency-head">
              <StatusPill tone={SEVERITY_TONE[e.severity] ?? 'waiting'}>{e.severity}</StatusPill>
              <strong className="mono small">{e.id}</strong>
              <span className="small">{e.type}</span>
              {e.category && <span className="pill small">{e.category}</span>}
              <span className="dim small">{new Date(e.created_at).toLocaleTimeString()}</span>
            </header>
            {e.message && <p className="emergency-msg small">“{e.message}” — {e.user_name}</p>}
            <dl className="emergency-meta small">
              <dt>Location</dt><dd>{e.location_state}{e.lat != null && e.lon != null && (
                <> (<a href={mapsUrl(e.lat, e.lon)!} target="_blank" rel="noreferrer">{e.lat.toFixed(5)}, {e.lon.toFixed(5)} ↗</a>)</>
              )}</dd>
              <dt>Battery</dt><dd>{e.battery != null ? `${e.battery}%` : 'unknown'}</dd>
              {e.snapshot?.blood_group && <><dt>Blood</dt><dd>{e.snapshot.blood_group}</dd></>}
              {e.snapshot?.allergies && <><dt>Allergies</dt><dd>{e.snapshot.allergies}</dd></>}
              {e.snapshot?.medical_conditions && <><dt>Conditions</dt><dd>{e.snapshot.medical_conditions}</dd></>}
              {e.snapshot?.medications && <><dt>Medications</dt><dd>{e.snapshot.medications}</dd></>}
              {e.snapshot?.emergency_contact && <><dt>Contact</dt><dd>{e.snapshot.emergency_contact}</dd></>}
            </dl>
            <ActionButton
              variant="secondary"
              onClick={() => acknowledge(e.id)}
              disabled={acked.has(e.id)}
              ariaLabel={`Acknowledge emergency ${e.id}`}
            >
              <CheckCircle2 size={16} /> {acked.has(e.id) ? 'Acknowledged' : 'Acknowledge'}
            </ActionButton>
          </article>
        ))}
      </Card>

      <Card>
        <CardHeader icon={<Radio size={17} />} title="Recent broadcasts" subtitle={broadcasts.length === 0 ? 'None.' : undefined} />
        {broadcasts.slice(0, 5).map((b) => (
          <div className="rq-mini-list" key={b.id} style={{ marginBottom: 6 }}>
            <MiniRow
              icon={<Radio size={14} />}
              title={b.mode}
              meta={b.message}
              pill={<StatusPill tone={b.priority === 'CRITICAL' ? 'danger' : 'waiting'}>{b.priority}</StatusPill>}
            />
          </div>
        ))}
      </Card>

      <Card>
        <CardHeader icon={<CheckCircle2 size={17} />} title="Recent check-ins" subtitle={checkins.length === 0 ? 'None.' : undefined} />
        <div className="rq-mini-list">
          {checkins.slice(0, 10).map((c) => (
            <MiniRow
              key={c.id}
              icon={<CheckCircle2 size={14} />}
              title={c.user_name}
              meta={new Date(c.created_at).toLocaleTimeString()}
              pill={<StatusPill tone={c.status === 'SAFE' ? 'safe' : 'waiting'}>{c.status}</StatusPill>}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}
