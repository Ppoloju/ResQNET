// Dedicated Disaster Mode walkthrough. It uses the real simulator, sitrep,
// and resource APIs, while making the simulation boundary explicit.

import { useState } from 'react';
import { Play, RotateCcw } from 'lucide-react';
import { apiFetch, useSession } from '../state/SessionContext';
import { useStatus } from '../state/StatusContext';
import DemoMap, { type DemoMapMarker } from '../components/DemoMap';
import { useHighAccuracyLocation } from '../components/EmergencyMap';
import { Card, CardHeader, PageHeader, ActionButton, StatusPill, EmptyState } from '../components/ui';

interface Snapshot {
  disasterMode: boolean;
  deliveries: Array<{ nodeId: string; status: string }>;
}

interface ResourcePoint {
  id: string;
  kind: string;
  name: string;
  lat: number;
  lon: number;
  distanceM: number;
  verifiedAt: string;
  source: string;
}

const STEPS = [
  ['topology', 'Mesh prepared', 'Four simulated nodes form a community relay chain.'],
  ['activated', 'Disaster Mode activated', 'The simulator prioritizes life-safety traffic.'],
  ['routed', 'Critical SOS routed', 'A trapped-person SOS crosses the mesh to the gateway.'],
  ['bulletin', 'Situation bulletin shared', 'A human-written road hazard is added to the common picture.'],
  ['resources', 'Resources ranked nearby', 'Shelter and medical points are returned with source and verification date.'],
] as const;

export default function DisasterDemo() {
  const { user } = useSession();
  const { online } = useStatus();
  const { fix, state: locationState } = useHighAccuracyLocation();
  const [done, setDone] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState('');
  const [resources, setResources] = useState<ResourcePoint[]>([]);
  const [active, setActive] = useState(false);

  const run = async () => {
    if (!user || !online || !fix) {
      setNote('Allow location access before starting Disaster Mode so resources are requested near you.');
      return;
    }
    setRunning(true);
    setDone(new Set());
    setResources([]);
    setNote('');
    try {
      await apiFetch('/sim/engine', {
        method: 'POST',
        body: JSON.stringify({
          links: [{ a: 'A', b: 'B', lossRate: 0 }, { a: 'B', b: 'C', lossRate: 0 }, { a: 'C', b: 'GATEWAY', lossRate: 0 }],
          batteryPercent: 78,
        }),
      });
      setDone(new Set(['topology']));

      const mode = await apiFetch<{ enabled: boolean }>('/sim/disaster-mode', {
        method: 'POST', body: JSON.stringify({ enabled: true }),
      });
      if (!mode.enabled) throw new Error('Simulator did not enter Disaster Mode.');
      setActive(true);
      setDone((steps) => new Set(steps).add('activated'));

      const emergencyId = `RQ-DS${Date.now().toString(36).toUpperCase().replace(/[^0-9A-Z]/g, '').slice(-6).padStart(6, '0')}`;
      const injected = await apiFetch<{ accepted: boolean; snapshot: Snapshot }>('/sim/inject', {
        method: 'POST',
        body: JSON.stringify({
          from: 'A', emergencyId, priority: 'CRITICAL', battery: 78,
          message: 'Disaster demo: person trapped; urgent medical rescue required.',
        }),
      });
      const reachedGateway = injected.accepted && injected.snapshot.deliveries.some((d) => d.nodeId === 'GATEWAY' && (d.status === 'DELIVERED' || d.status === 'ACKED'));
      if (!reachedGateway) throw new Error('Critical SOS did not reach the simulated gateway.');
      setDone((steps) => new Set(steps).add('routed'));

      await apiFetch('/sitreps', {
        method: 'POST',
        body: JSON.stringify({ kind: 'ROAD', text: 'Demo bulletin: main access road obstructed; use the marked shelter route.', lat: fix.latitude, lon: fix.longitude }),
      });
      setDone((steps) => new Set(steps).add('bulletin'));

      const nearby = await apiFetch<{ resources: ResourcePoint[] }>(`/resources/nearby?lat=${fix.latitude}&lon=${fix.longitude}&limit=20`);
      setResources(nearby.resources);
      setDone((steps) => new Set(steps).add('resources'));
      setNote('Disaster walkthrough complete. The radio topology is simulated; bulletins and resource records use the real application APIs.');
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Disaster demo failed. Confirm that you are signed in and the backend is running.');
    } finally {
      setRunning(false);
    }
  };

  const restore = async () => {
    try {
      await apiFetch('/sim/disaster-mode', { method: 'POST', body: JSON.stringify({ enabled: false }) });
      setActive(false);
      setNote('Simulator restored to Normal Mode. The demo bulletin remains in the shared feed as an auditable record.');
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Could not restore the simulator.');
    }
  };

  const markers: DemoMapMarker[] = fix ? [
    { id: 'A', label: 'A', latitude: fix.latitude, longitude: fix.longitude, tone: 'secondary', detail: 'survivor device' },
    { id: 'B', label: 'B', latitude: fix.latitude + 0.006, longitude: fix.longitude + 0.004, tone: 'success', detail: 'community relay' },
    { id: 'C', label: 'C', latitude: fix.latitude - 0.004, longitude: fix.longitude + 0.009, tone: 'success', detail: 'community relay' },
    { id: 'GATEWAY', label: 'GW', latitude: fix.latitude + 0.002, longitude: fix.longitude + 0.015, tone: 'primary', detail: 'gateway' },
  ] : [];

  return (
    <div className="page">
      <PageHeader
        eyebrow="RESQNET / DISASTER WALKTHROUGH [P]"
        title="Coordinated response demo"
        subtitle="How a community mesh carries a critical SOS, shares a concise human bulletin, and surfaces locally reviewed resources. Simulated radio topology; real routing, bulletin, and resource API paths. It does not issue an official public warning."
        badge={active ? 'DISASTER MODE ACTIVE' : 'SIMULATOR NORMAL'}
        badgeTone={active ? 'danger' : 'safe'}
      />

      {!user && <Card><EmptyState icon={<Play size={18} />} title="Sign in required" hint="The simulator and bulletin APIs are protected so the demo has an accountable owner." /></Card>}
      {!online && <Card><EmptyState icon={<Play size={18} />} title="Backend unavailable" hint="The demo needs the local gateway connection; the production app still retains its offline SOS outbox." /></Card>}

      <div className="demo-progress" aria-label={`Disaster demo progress ${done.size} of ${STEPS.length}`}>
        <div className="readiness-bar"><div className="readiness-fill tier-high" style={{ width: `${(done.size / STEPS.length) * 100}%` }} /></div>
        <span className="small dim">{done.size}/{STEPS.length} stages</span>
      </div>
      <div className="row wrap">
        <ActionButton variant="primary" onClick={() => void run()} disabled={running || !user || !online || !fix}>
          <Play size={17} /> {running ? 'Running response…' : 'Run Disaster Mode demo'}
        </ActionButton>
        {active && <ActionButton variant="ghost" onClick={() => void restore()} disabled={running}><RotateCcw size={16} /> Restore Normal Mode</ActionButton>}
      </div>
      {!fix && <p className="muted small" role="status">{locationState === 'denied' ? 'Location permission denied. Enable GPS to map nearby resources.' : 'Waiting for a live GPS fix before loading the disaster map…'}</p>}
      {note && <p className="muted mt" role="status">{note}</p>}

      <Card>
        <CardHeader icon={<Play size={17} />} title="Walkthrough stages" />
        <ol className="demo-steps">
          {STEPS.map(([key, label, hint]) => <li key={key} className={done.has(key) ? 'done' : ''}><span className="step-check" aria-hidden>{done.has(key) ? '✓' : '○'}</span><span className="step-label">{label}</span><span className="step-hint dim small">{hint}</span></li>)}
        </ol>
      </Card>

      <DemoMap title="Community disaster relay" subtitle="Illustrative topology for this simulation. Packet paths and gateway receipts are generated by the mesh engine." markers={markers} paths={[['A', 'B'], ['B', 'C'], ['C', 'GATEWAY']]} />

      {resources.length > 0 && <>
        <DemoMap
          title="Nearby disaster resources"
          subtitle="Resource markers use the reported coordinates and are filtered to the area around your live location."
          markers={resources.slice(0, 12).map((resource): DemoMapMarker => ({ id: resource.id, label: resource.kind, latitude: resource.lat, longitude: resource.lon, tone: resource.kind === 'MEDICAL' ? 'primary' : 'tertiary', detail: `${resource.name} · ${Math.round(resource.distanceM)} m` }))}
          userLocation={fix}
        />
        <Card>
          <CardHeader icon={<StatusPill tone="info" />} title="Resources returned by the demo" />
          <div className="rq-mini-list">
            {resources.slice(0, 5).map((resource) => (
              <div className="rq-mini-row" key={resource.id}>
                <span className="rq-mini-main">
                  <strong>{resource.kind}: {resource.name}</strong>
                  <small>{Math.round(resource.distanceM)} m · verified {resource.verifiedAt} · {resource.source}</small>
                </span>
              </div>
            ))}
          </div>
        </Card>
      </>}
    </div>
  );
}
