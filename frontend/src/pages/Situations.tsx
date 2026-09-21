// §13 Situations page: community situation reports (bulletins that propagate via
// the mesh / gateway) plus the disaster resource map (shelters, medical points).
// Honest scope: bulletins are user-contributed and resource points carry a
// verifiedAt + source so nobody mistakes seed data for a live government feed.

import { useCallback, useEffect, useState } from 'react';
import { Megaphone, MapPinned, ListChecks } from 'lucide-react';
import { apiFetch, useSession } from '../state/SessionContext';
import { useStatus } from '../state/StatusContext';
import { SITREP_STALE_MS } from '@iqoo/shared';
import DemoMap, { type DemoMapMarker } from '../components/DemoMap';
import { useHighAccuracyLocation } from '../components/EmergencyMap';
import { Card, CardHeader, PageHeader, Chip, TextAreaField, ActionButton } from '../components/ui';

interface Sitrep {
  id: string; kind: string; text: string;
  lat: number | null; lon: number | null;
  createdAt: string; authorId: string;
}
interface ResourcePoint {
  id: string; kind: string; name: string; lat: number; lon: number;
  capacityNote: string | null; verifiedAt: string; source: string; distanceM: number;
}

const KINDS = ['HAZARD', 'SHELTER', 'ROAD', 'SUPPLIES', 'RESOLVED'] as const;
const KIND_LABEL: Record<string, string> = {
  HAZARD: 'Hazard', SHELTER: 'Shelter', ROAD: 'Road', SUPPLIES: 'Supplies', RESOLVED: 'Resolved',
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
  const [kind, setKind] = useState<(typeof KINDS)[number]>('HAZARD');
  const [text, setText] = useState('');
  const [shareLoc, setShareLoc] = useState(false);
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
    if (fix) void loadResources(fix.latitude, fix.longitude);
  }, [fix, loadResources]);

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
    <div className="page">
      <PageHeader
        eyebrow="RESQNET / DISASTER MESH"
        title="Situations"
        subtitle="Community bulletins during a disaster — short, factual, human-written. AI never rewrites them."
        badge={online ? 'GATEWAY LINK ACTIVE' : 'STORE-FORWARD MODE'}
        badgeTone={online ? 'safe' : 'waiting'}
      />

      {!online && (
        <Card>
          <strong>Offline.</strong> The feed below is the last loaded copy. New bulletins need connectivity or a mesh gateway — post anyway and it queues.
        </Card>
      )}

      <Card>
        <CardHeader icon={<Megaphone size={17} />} title="Post a bulletin" />
        <div className="row wrap" role="radiogroup" aria-label="Bulletin kind">
          {KINDS.map((k) => (
            <Chip key={k} active={kind === k} onClick={() => setKind(k)}>{KIND_LABEL[k]}</Chip>
          ))}
        </div>
        <TextAreaField label="What is happening?" value={text} onChange={(v) => setText(v.slice(0, 280))} rows={2} maxLength={280} placeholder="Max 280 characters" />
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.85rem' }}>
          <input type="checkbox" checked={shareLoc} onChange={(e) => setShareLoc(e.target.checked)} />
          Attach my location{fix ? ` (±${Math.round(fix.accuracyMeters ?? 0)} m)` : ''}
        </label>
        {shareLoc && !fix && (
          <p className="muted small" style={{ margin: 0 }}>
            {locationState === 'denied' ? 'Location denied — the bulletin posts without coordinates.' : 'Waiting for a location fix…'}
          </p>
        )}
        {error && <p className="error-text">{error}</p>}
        <ActionButton variant="primary" full onClick={() => void post()} disabled={posting || !text.trim()}>
          {posting ? 'Posting…' : 'Post bulletin'}
        </ActionButton>
        {!user && <p className="muted small" style={{ margin: 0 }}>Sign in to post — reading works for everyone.</p>}
      </Card>

      <Card>
        <CardHeader icon={<ListChecks size={17} />} title="Live bulletins" subtitle={sitreps.length === 0 ? 'No bulletins yet.' : `${sitreps.length} report${sitreps.length === 1 ? '' : 's'} in the feed`} />
        {sitreps.map((s) => {
          const stale = now - new Date(s.createdAt).getTime() > SITREP_STALE_MS;
          return (
            <div className="rq-mini-list" key={s.id} style={{ marginBottom: 6 }}>
              <div className="rq-mini-row">
                <span className="rq-mini-main">
                  <strong>{KIND_LABEL[s.kind] ?? s.kind}</strong>
                  <small>{s.text}</small>
                  <small>
                    {s.lat !== null && s.lon !== null && <>location {s.lat.toFixed(4)}, {s.lon.toFixed(4)} · </>}
                    {new Date(s.createdAt).toLocaleTimeString()}{stale ? ' · STALE' : ''}
                  </small>
                </span>
              </div>
            </div>
          );
        })}
      </Card>

      <Card>
        <CardHeader
          icon={<MapPinned size={17} />}
          title="Resource map"
          subtitle="Shelters, medical points, water — every point shows when it was verified and by whom."
          actions={resources === null
            ? <ActionButton variant="help" onClick={() => { if (fix) void loadResources(fix.latitude, fix.longitude); }}>Find resources near me</ActionButton>
            : undefined}
        />
        {resources && resources.length === 0 && <p className="muted">No resource data available.</p>}
        {resources && resources.length > 0 && (
          <>
            <div className="rq-mini-list" style={{ marginBottom: 10 }}>
              {resources.slice(0, 6).map((r) => (
                <div className="rq-mini-row" key={r.id}>
                  <span className="rq-mini-main">
                    <strong>{RES_META[r.kind] ?? 'Resource'}: {r.name}</strong>
                    <small>{Math.round(r.distanceM)} m away · capacity: {r.capacityNote ?? 'unknown'}</small>
                    <small>verified {r.verifiedAt} — {r.source}</small>
                  </span>
                </div>
              ))}
            </div>
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
          </>
        )}
      </Card>
    </div>
  );
}
