// §13 Situations page: community situation reports (bulletins that propagate via
// the mesh / gateway) plus the disaster resource map (shelters, medical points).
// Honest scope: bulletins are user-contributed and resource points carry a
// verifiedAt + source so nobody mistakes seed data for a live government feed.

import { useCallback, useEffect, useState } from 'react';
import { apiFetch, useSession } from '../state/SessionContext';
import { useStatus } from '../state/StatusContext';
import { SITREP_STALE_MS } from '@iqoo/shared';
import DemoMap, { type DemoMapMarker } from '../components/DemoMap';
import { useHighAccuracyLocation } from '../components/EmergencyMap';

interface Sitrep {
  id: string; kind: string; text: string;
  lat: number | null; lon: number | null;
  createdAt: string; authorId: string;
}
interface ResourcePoint {
  id: string; kind: string; name: string; lat: number; lon: number;
  capacityNote: string | null; verifiedAt: string; source: string; distanceM: number;
}

const KIND_META: Record<string, { icon: string; color: string; label: string }> = {
  HAZARD: { icon: '', color: '#e0a12b', label: 'Hazard' },
  SHELTER: { icon: '', color: '#2fae66', label: 'Shelter' },
  ROAD: { icon: '', color: '#e0a12b', label: 'Road' },
  SUPPLIES: { icon: '', color: '#2e7dd1', label: 'Supplies' },
  RESOLVED: { icon: '', color: '#2fae66', label: 'Resolved' },
};
const RES_META: Record<string, string> = {
  SHELTER: 'Shelter', MEDICAL: 'Medical', SAFE_ZONE: 'Safe zone', WATER: 'Water', SUPPLIES: 'Supplies',
};

export default function Situations() {
  const { user } = useSession();
  const { online } = useStatus();
  const { fix, state: locationState } = useHighAccuracyLocation();
  const [sitreps, setSitreps] = useState<Sitrep[]>([]);
  const [resources, setResources] = useState<ResourcePoint[] | null>(null);
  const [kind, setKind] = useState('HAZARD');
  const [text, setText] = useState('');
  const [shareLoc, setShareLoc] = useState(false);
  const [locNote, setLocNote] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!online) return;
    try {
      const r = await apiFetch<{ sitreps: Sitrep[] }>('/sitreps');
      setSitreps(r.sitreps);
    } catch { /* retried on next poll */ }
  }, [online]);

  const loadResources = useCallback(async (lat: number, lon: number) => {
    try {
      const r = await apiFetch<{ resources: ResourcePoint[] }>(`/resources/nearby?lat=${lat}&lon=${lon}`);
      setResources(r.resources);
    } catch {
      setResources([]);
    }
  }, []);

  useEffect(() => { void load(); const t = setInterval(() => void load(), 20_000); return () => clearInterval(t); }, [load]);

  useEffect(() => {
    if (!fix) return;
    setLocNote(`Live location (±${Math.round(fix.accuracyMeters ?? 0)} m)`);
    void loadResources(fix.latitude, fix.longitude);
  }, [fix, loadResources]);

  const locate = () => {
    if (fix) void loadResources(fix.latitude, fix.longitude);
    else setLocNote(locationState === 'denied' ? 'Location denied — resource map needs a location' : 'Locating…');
  };

  const post = async () => {
    if (!text.trim()) return;
    setPosting(true);
    setError('');
    try {
      await apiFetch('/sitreps', {
        method: 'POST',
        body: JSON.stringify({
          kind, text: text.trim(),
          lat: shareLoc && fix ? fix.latitude : null,
          lon: shareLoc && fix ? fix.longitude : null,
        }),
      });
      setText('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Post failed');
    } finally {
      setPosting(false);
    }
  };

  const now = Date.now();
  return (
    <div className="disaster-page">
      <div className="disaster-page-heading">
        <span className="eyebrow">RESQNET / DISASTER MESH</span>
        <h1>Situations</h1>
        <span className={`disaster-state ${online ? 'connected' : 'offline'}`}>{online ? 'GATEWAY LINK ACTIVE' : 'STORE-FORWARD MODE'}</span>
      </div>
      <p className="muted">
        Community bulletins during a disaster. These propagate like any other mesh packet —
        short, factual, human-written. AI never rewrites them.
      </p>

      {!online && (
        <div className="card" style={{ borderColor: '#e0a12b' }}>
          <strong>Offline.</strong> The feed below is the last loaded copy. New bulletins need connectivity or a mesh gateway — post anyway and it queues.
        </div>
      )}

      <div className="card">
        <h2>Post a bulletin</h2>
        <div className="row wrap" role="radiogroup" aria-label="Bulletin kind">
          {Object.entries(KIND_META).map(([k, m]) => (
            <button
              key={k}
              className="chip"
              style={kind === k ? { borderColor: m.color, color: m.color, fontWeight: 700 } : undefined}
              onClick={() => setKind(k)}
              aria-pressed={kind === k}
            >
              {m.icon} {m.label}
            </button>
          ))}
        </div>
        <textarea
          id="sitrep-text"
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 280))}
          rows={2}
          placeholder="What is happening? (max 280 chars)"
          style={{ width: '100%', marginTop: 8 }}
        />
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6, fontSize: '0.85rem' }}>
          <input type="checkbox" checked={shareLoc} onChange={(e) => setShareLoc(e.target.checked)} />
          Attach my location
        </label>
        {shareLoc && !fix && (
          <button className="btn-ghost" style={{ marginTop: 6 }} onClick={locate}>Get my location</button>
        )}
        {locNote && <p className="muted" style={{ fontSize: '0.8rem', margin: '4px 0 0' }}>{locNote}</p>}
        {error && <p className="error-text">{error}</p>}
        <button className="btn-primary" style={{ marginTop: 8, width: '100%' }} disabled={posting || !text.trim()} onClick={() => void post()}>
          {posting ? 'Posting…' : 'Post bulletin'}
        </button>
        {!user && <p className="muted" style={{ fontSize: '0.8rem', marginTop: 6 }}>Sign in to post — reading works for everyone.</p>}
      </div>

      <div className="card">
        <h2>Live bulletins</h2>
        {sitreps.length === 0 && <p className="muted">No bulletins yet.</p>}
        <ul className="event-list">
          {sitreps.map((s) => {
            const m = KIND_META[s.kind] ?? KIND_META.HAZARD;
            const stale = now - new Date(s.createdAt).getTime() > SITREP_STALE_MS;
            return (
              <li key={s.id}>
                <span className="pill small" style={{ background: m.color, color: '#0b0f14' }}>{m.icon} {m.label}</span>{' '}
                {s.text}
                {s.lat !== null && s.lon !== null && (
                  <span className="dim small mono"> location {s.lat.toFixed(4)}, {s.lon.toFixed(4)}</span>
                )}
                <span className="dim small"> · {new Date(s.createdAt).toLocaleTimeString()}{stale ? ' · STALE' : ''}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="card">
        <h2>Resource map</h2>
        <p className="muted" style={{ margin: '4px 0 8px', fontSize: '0.85rem' }}>
          Shelters, medical points, water. Every point shows when it was verified and by whom —
          verify locally before relying on it.
        </p>
        {!resources && (
          <button className="btn-help" onClick={locate}>Find resources near me</button>
        )}
        {resources && resources.length === 0 && <p className="muted">No resource data available.</p>}
        {resources && resources.length > 0 && (
          <ul className="event-list">
            {resources.map((r) => (
              <li key={r.id}>
                <strong>{RES_META[r.kind] ?? 'Resource'}: {r.name}</strong>
                <div className="dim small">
                  {Math.round(r.distanceM)} m away · capacity: {r.capacityNote ?? 'unknown'}<br />
                  verified {r.verifiedAt} — {r.source}
                </div>
              </li>
            ))}
          </ul>
        )}
        {resources && resources.length > 0 && (
          <DemoMap
            title="Nearby resource overview"
            subtitle="Verified resource points are plotted at their reported coordinates on live OpenStreetMap tiles."
            markers={resources.slice(0, 8).map((resource): DemoMapMarker => ({
              id: resource.id,
              label: resource.kind,
              latitude: resource.lat,
              longitude: resource.lon,
              tone: resource.kind === 'MEDICAL' ? 'primary' : 'tertiary',
              detail: `${Math.round(resource.distanceM)} m`,
            }))}
          />
        )}
      </div>
    </div>
  );
}
