// Responder Dashboard (§18, Phase 12): live feed of active emergencies for
// responders/gateways, with emergency-card details, location link, and ACK action.
// Data comes from the real /responders/feed endpoint (RBAC: responder|admin).

import { useCallback, useEffect, useState } from 'react';
import { apiFetch, useSession } from '../state/SessionContext';
import { useRealtime } from '../state/RealtimeContext';

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

const sevClass = (s: string) => (s === 'CRITICAL' ? 'off' : s === 'HIGH' ? 'warn' : 'on');

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

  if (!user) return <div className="page"><h2>Responder Dashboard</h2><p className="dim">Sign in to view.</p></div>;
  if (!isResponder) {
    return (
      <div className="page">
        <h2>Responder Dashboard</h2>
        <p className="dim">Your account role is “{user.role}”. Responder accounts (role=responder) see the live emergency feed.
          For the demo, ask an admin to upgrade your role, or use the seeded demo responders.</p>
      </div>
    );
  }

  return (
    <div className="page">
      <h2>Responder Dashboard</h2>
      <p className="dim">Active emergencies, disaster broadcasts, and safety check-ins arriving through the mesh + gateway sync.</p>
      {error && <p className="error" role="alert">{error}</p>}

      <section aria-label="Active emergencies">
        <h3>Active emergencies ({emergencies.length})</h3>
        {loading && <p className="dim">Loading…</p>}
        {!loading && emergencies.length === 0 && <p className="dim">No active emergencies.</p>}
        {emergencies.map((e) => (
          <article className="card emergency-item" key={e.id} aria-label={`Emergency ${e.id}`}>
            <header className="emergency-head">
              <span className={`pill ${sevClass(e.severity)}`}>{e.severity}</span>
              <strong className="mono">{e.id}</strong>
              <span>{e.type}</span>
              {e.category && <span className="pill small">{e.category}</span>}
              <span className="dim small">{new Date(e.created_at).toLocaleTimeString()}</span>
            </header>
            {e.message && <p className="emergency-msg">“{e.message}” — {e.user_name}</p>}
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
            <button
              className="btn secondary"
              onClick={() => acknowledge(e.id)}
              disabled={acked.has(e.id)}
              aria-label={`Acknowledge emergency ${e.id}`}
            >
              {acked.has(e.id) ? '✓ Acknowledged' : 'Acknowledge'}
            </button>
          </article>
        ))}
      </section>

      <section aria-label="Disaster broadcasts">
        <h3>Recent broadcasts</h3>
        {broadcasts.length === 0 && <p className="dim">None.</p>}
        {broadcasts.slice(0, 5).map((b) => (
          <p key={b.id} className="card small">
            <span className={`pill ${sevClass(b.priority)}`}>{b.mode}</span> {b.message}
          </p>
        ))}
      </section>

      <section aria-label="Recent check-ins">
        <h3>Recent check-ins</h3>
        {checkins.length === 0 && <p className="dim">None.</p>}
        <ul className="event-list">
          {checkins.slice(0, 10).map((c) => (
            <li key={c.id}>
              <span className={`pill ${c.status === 'SAFE' ? 'on' : 'warn'}`}>{c.status}</span> {c.user_name}{' '}
              <span className="dim small">{new Date(c.created_at).toLocaleTimeString()}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
