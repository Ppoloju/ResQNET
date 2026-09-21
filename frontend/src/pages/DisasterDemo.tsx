// Dedicated Disaster Mode walkthrough. It uses the real simulator, sitrep,
// and resource APIs, while making the simulation boundary explicit.

import { useState } from 'react';
import { apiFetch, useSession } from '../state/SessionContext';
import { useStatus } from '../state/StatusContext';
import DemoMap, { type DemoMapMarker } from '../components/DemoMap';

interface Snapshot {
  disasterMode: boolean;
  deliveries: Array<{ nodeId: string; status: string }>;
}

interface ResourcePoint {
  id: string;
  kind: string;
  name: string;
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
  const [done, setDone] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState('');
  const [resources, setResources] = useState<ResourcePoint[]>([]);
  const [active, setActive] = useState(false);

  const run = async () => {
    if (!user || !online) return;
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

      const emergencyId = `IQ-DS${Date.now().toString(36).toUpperCase().replace(/[^0-9A-Z]/g, '').slice(-6).padStart(6, '0')}`;
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
        body: JSON.stringify({ kind: 'ROAD', text: 'Demo bulletin: main access road obstructed; use the marked shelter route.', lat: 17.385, lon: 78.4867 }),
      });
      setDone((steps) => new Set(steps).add('bulletin'));

      const nearby = await apiFetch<{ resources: ResourcePoint[] }>('/resources/nearby?lat=17.385&lon=78.4867');
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

  const markers: DemoMapMarker[] = [
    { id: 'A', label: 'A', x: 14, y: 55, tone: 'secondary', detail: 'survivor device' },
    { id: 'B', label: 'B', x: 37, y: 38, tone: 'success', detail: 'community relay' },
    { id: 'C', label: 'C', x: 60, y: 61, tone: 'success', detail: 'community relay' },
    { id: 'GATEWAY', label: 'GW', x: 85, y: 42, tone: 'primary', detail: 'gateway' },
  ];

  return (
    <div className="page disaster-demo-page">
      <div className="banner demo-banner" role="note">
        <strong>Disaster Mode Demo</strong> — simulated radio topology <span className="mono">[P]</span>; real local routing, bulletin, and resource API paths.
      </div>
      <div className="disaster-page-heading">
        <span className="eyebrow">RESQNET / DISASTER WALKTHROUGH</span>
        <h1>Coordinated response demo</h1>
        <span className={`disaster-state ${active ? 'offline' : 'connected'}`}>{active ? 'SIMULATED DISASTER MODE ACTIVE' : 'SIMULATOR IN NORMAL MODE'}</span>
      </div>
      <p className="muted">This walkthrough demonstrates how a community mesh carries a critical SOS, shares a concise human bulletin, and surfaces locally reviewed resources. It does not issue an official public warning.</p>

      {!user && <div className="card"><strong>Sign in required.</strong> The simulator and bulletin APIs are protected so the demo has an accountable owner.</div>}
      {!online && <div className="card"><strong>Backend unavailable.</strong> The demo needs the local gateway connection; the production app still retains its offline SOS outbox.</div>}

      <div className="demo-progress" aria-label={`Disaster demo progress ${done.size} of ${STEPS.length}`}>
        <div className="readiness-bar"><div className="readiness-fill tier-high" style={{ width: `${(done.size / STEPS.length) * 100}%` }} /></div>
        <span className="small dim">{done.size}/{STEPS.length} stages</span>
      </div>
      <div className="row wrap">
        <button className="btn-primary big" type="button" onClick={() => void run()} disabled={running || !user || !online}>{running ? 'Running response…' : '▶ Run Disaster Mode demo'}</button>
        {active && <button className="btn-ghost" type="button" onClick={() => void restore()} disabled={running}>Restore Normal Mode</button>}
      </div>
      {note && <p className="muted mt" role="status">{note}</p>}

      <ol className="demo-steps">
        {STEPS.map(([key, label, hint]) => <li key={key} className={done.has(key) ? 'done' : ''}><span className="step-check" aria-hidden>{done.has(key) ? '✓' : '○'}</span><span className="step-label">{label}</span><span className="step-hint dim small">{hint}</span></li>)}
      </ol>

      <DemoMap title="Community disaster relay" subtitle="Illustrative topology for this simulation. Packet paths and gateway receipts are generated by the mesh engine." markers={markers} paths={[['A', 'B'], ['B', 'C'], ['C', 'GATEWAY']]} />

      {resources.length > 0 && <section className="card"><h2>Resources returned by the demo</h2><ul className="event-list">{resources.slice(0, 5).map((resource) => <li key={resource.id}><strong>{resource.kind}: {resource.name}</strong><span className="dim small"> — {Math.round(resource.distanceM)} m · verified {resource.verifiedAt} · {resource.source}</span></li>)}</ul></section>}
    </div>
  );
}
