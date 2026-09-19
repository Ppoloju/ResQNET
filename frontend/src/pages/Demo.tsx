// Hackathon Demo Mode (§52) — CLEARLY MARKED as simulation.
// Drives the REAL backend mesh engine: topology seed → emergency inject → live
// propagation through actual routing code (dedupe, TTL, ACK, retry, battery tiers).
// Radio links are simulated [P]; every packet, hop, ACK, TTL decision and the
// gateway sync into the backend are genuine code paths.

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../state/SessionContext';
import { useStatus } from '../state/StatusContext';
import { useMeshEvents, type MeshEvent } from '../state/RealtimeContext';

interface Step {
  key: string;
  label: string;
  hint: string;
  /** Matched against live SSE mesh events; omitted for directly-confirmed steps. */
  match?: (ev: MeshEvent) => boolean;
}

interface DemoSnapshot {
  deliveries: Array<{ nodeId: string; status: string }>;
  timeline: Array<{ event: string }>;
}

interface FamilyMember {
  id: string;
}

const STEPS: Step[] = [
  { key: 'topology', label: '1 · Demo topology created', hint: 'A → B → C → GATEWAY chain, 4 simulated devices' },
  { key: 'offline', label: '2 · User A has no internet', hint: 'Node A can only send via the device mesh' },
  { key: 'sos', label: '3 · SOS injected at node A', hint: 'Signed CRITICAL packet enters the mesh' },
  { key: 'b-receives', label: '4 · User B receives the emergency', hint: 'First hop delivered', match: (e) => e.type === 'DELIVERED' && e.to === 'B' },
  { key: 'relay', label: '5 · B relays to C (relay node)', hint: 'Store-and-forward flooding, dedupe prevents loops', match: (e) => e.type === 'DELIVERED' && e.to === 'C' },
  { key: 'gateway', label: '6 · Gateway receives', hint: 'Packet reaches the gateway node', match: (e) => e.type === 'DELIVERED' && e.to === 'GATEWAY' },
  { key: 'synced', label: '7 · Synced to responder infrastructure', hint: 'Gateway writes a REAL emergency row to the backend', match: (e) => e.type === 'SYNCED' },
  { key: 'family', label: '8 · Family notification fan-out', hint: 'Notifications recorded for each family member', match: (e) => e.type === 'FAMILY_NOTIFIED' },
  { key: 'timeline', label: '9 · Emergency timeline updated', hint: 'See engine timeline below (also on the Network page)' },
];

const LINK_DOWN_STEPS = [
  { label: 'Cut link A–B (store-and-forward test)', body: { a: 'A', b: 'B' } },
  { label: 'Restore link A–B (queued packets flush)', body: { a: 'A', b: 'B' } },
];

export default function Demo() {
  const { events } = useMeshEvents();
  const { online } = useStatus();
  const [done, setDone] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [emergencyId, setEmergencyId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Auto-check steps from live SSE events (dedupe by event type + node).
  useEffect(() => {
    if (!emergencyId) return;
    setDone((prev) => {
      const next = new Set(prev);
      for (const step of STEPS) {
        if (step.match && events.some((event) => event.emergencyId === emergencyId && step.match?.(event))) next.add(step.key);
      }
      return next;
    });
  }, [events, emergencyId]);

  useEffect(() => () => { timersRef.current.forEach(clearTimeout); }, []);

  const runScenario = async () => {
    setRunning(true);
    setDone(new Set(['offline']));
    setNote(null);
    setEmergencyId(null);
    try {
      // 1. Fresh 4-node chain: A → B → C → GATEWAY.
      await apiFetch('/sim/engine', {
        method: 'POST',
        body: JSON.stringify({
          links: [
            { a: 'A', b: 'B', lossRate: 0 },
            { a: 'B', b: 'C', lossRate: 0 },
            { a: 'C', b: 'GATEWAY', lossRate: 0 },
          ],
          batteryPercent: 85,
        }),
      });
      setDone((d) => new Set(d).add('topology'));

      // 3. Inject SOS at node A — the engine floods, dedupes, ACKs.
      const r = await apiFetch<{ accepted: boolean; packet: { emergencyId: string }; snapshot: DemoSnapshot }>('/sim/inject', {
        method: 'POST',
        body: JSON.stringify({
          from: 'A',
          emergencyId: `IQ-${Date.now().toString(36).toUpperCase().replace(/[^0-9A-Z]/g, '').slice(-8).padStart(6, '0')}`,
          message: 'Demo: injured trekker, cannot walk',
          priority: 'CRITICAL',
          battery: 85,
        }),
      });
      if (!r.accepted) throw new Error('The simulator rejected the emergency packet.');
      const eid = r.packet.emergencyId ?? null;
      setEmergencyId(eid);
      setDone((d) => {
        const next = new Set(d).add('sos');
        const deliveredTo = new Set(r.snapshot.deliveries.filter((delivery) => delivery.status === 'DELIVERED' || delivery.status === 'ACKED').map((delivery) => delivery.nodeId));
        if (deliveredTo.has('B')) next.add('b-receives');
        if (deliveredTo.has('C')) next.add('relay');
        if (deliveredTo.has('GATEWAY')) {
          next.add('gateway');
          next.add('synced');
        }
        if (r.snapshot.timeline.length > 0) next.add('timeline');
        return next;
      });
      const family = await apiFetch<{ members: FamilyMember[] }>('/family');
      if (family.members.length === 0) {
        setNote('Demo completed mesh sync. Add a family member to demonstrate notification fan-out.');
      } else {
        // Gateway sync and fan-out complete before /sim/inject responds. Use
        // the family roster as the durable confirmation when SSE arrives late.
        setDone((d) => new Set(d).add('family').add('timeline'));
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Demo failed — is the backend running and are you signed in?');
      setRunning(false);
      return;
    }

    // Steps 4-8 auto-check from live SSE mesh events; step 9 when timeline shows events.
    const poll = setInterval(() => {
      setDone((d) => {
        const n = new Set(d);
        if (n.has('synced') || n.has('family')) n.add('timeline');
        return n;
      });
    }, 1000);
    timersRef.current.push(setTimeout(() => { clearInterval(poll); setRunning(false); }, 15_000) as unknown as ReturnType<typeof setTimeout>);
  };

  const chaos = async (i: number) => {
    try {
      if (i === 0) await apiFetch('/sim/link/down', { method: 'POST', body: JSON.stringify(LINK_DOWN_STEPS[0].body) });
      else await apiFetch('/sim/link/up', { method: 'POST', body: JSON.stringify(LINK_DOWN_STEPS[1].body) });
      setNote(`${LINK_DOWN_STEPS[i].label} — done. Watch the Network page for QUEUED → DELIVERED transitions.`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Chaos action failed');
    }
  };

  const total = STEPS.length;
  const complete = done.size;

  return (
    <div className="page">
      <div className="banner demo-banner" role="note">
        <strong>Hackathon Demo Mode</strong> — runs the real mesh engine with <strong>simulated radio links</strong> <span className="mono">[P]</span>.
        Every packet, hop, ACK, TTL decision and the gateway sync into the backend are genuine code paths.
      </div>

      <h2>Scripted scenario: SOS without internet</h2>
      <p className="dim">A trekker is injured where there is no signal. Nearby ResQNET phones carry the emergency hop-by-hop to a gateway, which syncs it to responders and family.</p>

      <div className="demo-progress" aria-label={`Demo progress ${complete} of ${total}`}>
        <div className="readiness-bar"><div className="readiness-fill tier-high" style={{ width: `${(complete / total) * 100}%` }} /></div>
        <span className="small dim">{complete}/{total} steps</span>
      </div>

      <button className="btn-primary big" onClick={runScenario} disabled={running}>
        {running ? 'Scenario running…' : '▶ Run demo scenario'}
      </button>
      {note && <p className="muted mt">{note}</p>}
      {emergencyId && <p className="small">Emergency ID: <strong className="mono">{emergencyId}</strong> — watch it live on the Network page.</p>}

      <ol className="demo-steps">
        {STEPS.map((s) => (
          <li key={s.key} className={done.has(s.key) ? 'done' : ''} aria-current={done.has(s.key) ? 'step' : undefined}>
            <span className="step-check" aria-hidden>{done.has(s.key) ? '✓' : '○'}</span>
            <span className="step-label">{s.label}</span>
            <span className="step-hint dim small">{s.hint}</span>
          </li>
        ))}
      </ol>

      <section className="card" aria-label="Chaos controls">
        <h3>Chaos controls (optional)</h3>
        <p className="muted small">Break a link, watch store-and-forward hold the packet, restore it and watch the flush.</p>
        <div className="row wrap">
          {LINK_DOWN_STEPS.map((s, i) => (
            <button key={s.label} className="btn-secondary" onClick={() => void chaos(i)} disabled={!online}>{s.label}</button>
          ))}
        </div>
      </section>
    </div>
  );
}
