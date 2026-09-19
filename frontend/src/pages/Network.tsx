// Emergency Message Map (§38) + Relay Readiness (§37) + demo topology (§51).
// Renders mesh propagation from the backend's REAL mesh engine: nodes, roles,
// battery, delivery/ACK state, queued (store-and-forward) packets. The topology
// and deliveries come from /sim/state — what renders here is what the engine did.

import { useCallback, useEffect, useState } from 'react';
import { apiFetch, useSession } from '../state/SessionContext';
import { useStatus } from '../state/StatusContext';
import { useSettings } from '../state/SettingsContext';
import { useTransports } from '../state/TransportContext';
import { useMeshEvents, type MeshEvent } from '../state/RealtimeContext';
import { relayReadiness } from '@iqoo/shared';
import DemoMap, { type DemoMapMarker } from '../components/DemoMap';

interface SimNode {
  id: string;
  battery: number;
  role: 'NORMAL' | 'RELAY' | 'RESPONDER' | 'GATEWAY';
  queuedPackets: number;
  seenPackets: number;
  degree: number;
}
interface Delivery {
  packetId: string;
  nodeId: string;
  status: 'DELIVERED' | 'DUPLICATE' | 'FAILED' | 'EXPIRED' | 'QUEUED' | 'ACKED';
  attempts: number;
  via: string | null;
  ts: number;
}
interface Timeline {
  ts: number;
  nodeId: string;
  event: string;
  detail?: Record<string, unknown>;
}
interface Snapshot {
  nodes: SimNode[];
  deliveries: Delivery[];
  timeline: Timeline[];
  relayHero: string | null;
  stats: { totalNodes: number; totalLinks: number; delivered: number; acked: number; duplicates: number; expired: number };
}

const ROLE_ICON: Record<string, string> = {
  NORMAL: 'N', RELAY: 'R', RESPONDER: 'E', GATEWAY: 'G',
};

export default function Network() {
  const { user } = useSession();
  const { online, battery } = useStatus();
  const { relayConsent, lowPowerMode, criticalThresholdPct, normalThresholdPct, relayHeroMode } = useSettings();
  const { rows: transportRows, requestBluetooth, requestingBluetooth } = useTransports();
  const { events, connected } = useMeshEvents();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(() => {
    apiFetch<Snapshot>('/sim/state')
      .then(setSnap)
      .catch(() => setSnap(null));
  }, []);

  useEffect(() => {
    if (!user) return;
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [user, refresh]);

  // Refresh promptly when live mesh events arrive (SSE).
  const recent = events.length;
  useEffect(() => {
    if (!user) return;
    if (recent > 0) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recent]);

  const seed = async () => {
    setBusy(true);
    setNote(null);
    try {
      // 4-node chain + gateway: A → B → C, A ⇄ GATEWAY (documented demo layout).
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
      setNote('Demo topology ready: A → B → C → GATEWAY. Inject an emergency below, or run the full scenario in Demo Mode.');
      refresh();
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Seed failed');
    } finally {
      setBusy(false);
    }
  };

  const inject = async () => {
    setBusy(true);
    setNote(null);
    try {
      const emergencyId = `IQ-${Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[^A-Z0-9]/g, 'X').padEnd(8, 'X').slice(0, 8)}`;
      const r = await apiFetch<{ accepted: boolean; snapshot: Snapshot }>('/sim/inject', {
        method: 'POST',
        body: JSON.stringify({
          from: 'A',
          emergencyId,
          message: 'Manual inject from Network page (demo packet)',
          priority: 'CRITICAL',
          battery: 85,
        }),
      });
      setSnap(r.snapshot);
      setNote(`Injected ${emergencyId} at node A — flood, ACKs and dedupe below are the engine's real output.`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Inject failed');
    } finally {
      setBusy(false);
    }
  };

  /** Relay Hero (§29 iQOO enhancement): nominate/release a backbone relay node. */
  const toggleHero = async (nodeId: string) => {
    setBusy(true);
    setNote(null);
    try {
      const next = snap?.relayHero === nodeId ? null : nodeId;
      await apiFetch('/sim/relay-hero', {
        method: 'POST',
        body: JSON.stringify({ nodeId: next }),
      });
      setNote(next
        ? `⚡ ${nodeId} nominated as Relay Hero — it now relays at full strength regardless of battery.`
        : `Relay Hero released — all nodes back to battery-tier relay.`);
      refresh();
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Relay Hero toggle failed');
    } finally {
      setBusy(false);
    }
  };

  // Relay Readiness reflects user settings (§37); low-power mode forces the
  // CRITICAL-only tier (§29) by clamping battery below the threshold.
  // Relay Hero (§29 iQOO enhancement): full-strength relay regardless of battery.
  const readiness = relayReadiness({
    batteryPercent: lowPowerMode && !relayHeroMode ? Math.min(battery ?? 0, criticalThresholdPct - 1) : battery,
    connected: online,
    userConsent: relayConsent,
    foreground: true,
    hardwareTier: relayHeroMode ? 'large_cell_bypass' : 'standard',
  });

  if (!user) {
    return (
      <div className="page">
        <h2>Network</h2>
        <p className="dim">Sign in to view the Emergency Message Map — it plots real packet relay from the mesh engine.</p>
      </div>
    );
  }

  return (
    <div className="page">
      <h2>Emergency Message Map</h2>
      <p className="dim">
        Live view of the simulated mesh: nodes, roles, battery-aware relay, delivery and ACK state.
        <span className="mono"> [P: radio links simulated — routing logic is the production code path]</span>
      </p>

      <section className="card" aria-label="Relay readiness">
        <h3>Relay Readiness</h3>
        <div className="readiness-row">
          <div className="readiness-bar" role="meter" aria-valuenow={readiness.score} aria-valuemin={0} aria-valuemax={100} aria-label={`Relay readiness ${readiness.score} of 100`}>
            <div className={`readiness-fill tier-${readiness.tier.toLowerCase()}`} style={{ width: `${readiness.score}%` }} />
          </div>
          <span className={`pill ${readiness.tier === 'HIGH' ? 'on' : readiness.tier === 'OFF' ? 'off' : 'warn'}`}>{readiness.tier}</span>
        </div>
        <p className="dim small">{readiness.reason}{lowPowerMode && ' · low-power mode active'}</p>
      </section>

      <section className="card" aria-label="Transports">
        <h3>Transports</h3>
        {transportRows.map((r) => (
          <div key={r.name} className="row spread" style={{ minHeight: 40, alignItems: 'center' }}>
            <span>{r.name === 'bluetooth' ? 'Bluetooth [P]' : 'LAN/Internet'}</span>
            <span className={`pill small ${r.availability === 'READY' ? 'on' : r.availability === 'PERMISSION_NEEDED' ? 'warn' : 'off'}`}>{r.availability}</span>
          </div>
        ))}
        <button className="btn-secondary" style={{ width: '100%', marginTop: 8 }}
          disabled={requestingBluetooth} onClick={() => void requestBluetooth()}>
          {requestingBluetooth ? 'Waiting for picker…' : 'Pair nearby ResQNET device [P]'}
        </button>
        <p className="dim small">Thresholds: CRITICAL-only below {criticalThresholdPct}% · normal above {normalThresholdPct}% (change in Settings)</p>
      </section>

      <section className="card" aria-label="Simulator controls">
        <h3>Simulator controls</h3>
        <div className="row wrap">
          <button className="btn-secondary" onClick={seed} disabled={busy || !online}>Seed topology (A→B→C→GATEWAY)</button>
          <button className="btn-primary" onClick={inject} disabled={busy || !online}>Inject emergency at A</button>
          <button className="btn-ghost" onClick={refresh} disabled={!online}>Refresh</button>
        </div>
        {note && <p className="muted mt">{note}</p>}
        {!online && <p className="muted mt">Offline — simulator needs the backend connection.</p>}
      </section>

      {snap && (
        <>
          <DemoMap
            title="Live mesh topology"
            subtitle="A temporary local map for the simulated relay chain. No external map key or coordinates are used."
            markers={snap.nodes.map((node, index): DemoMapMarker => ({
              id: node.id,
              label: node.id,
              x: node.id === 'GATEWAY' ? 86 : 18 + index * 22,
              y: node.role === 'GATEWAY' ? 50 : 42 + (index % 2) * 20,
              tone: node.role === 'GATEWAY' ? 'tertiary' : node.role === 'RELAY' ? 'success' : 'secondary',
              detail: `${node.role} / ${node.battery}%`,
            }))}
            paths={snap.nodes.slice(0, -1).map((node, index) => [node.id, snap.nodes[index + 1].id] as [string, string])}
          />
          <section className="card" aria-label="Mesh statistics">
            <h3>Mesh stats</h3>
            <div className="statgrid">
              <div className="stat"><div className="k">Nodes</div><div className="v">{snap.stats.totalNodes}</div></div>
              <div className="stat"><div className="k">Links</div><div className="v">{snap.stats.totalLinks}</div></div>
              <div className="stat"><div className="k">Delivered</div><div className="v">{snap.stats.delivered}</div></div>
              <div className="stat"><div className="k">ACKed</div><div className="v">{snap.stats.acked}</div></div>
              <div className="stat"><div className="k">Duplicates</div><div className="v">{snap.stats.duplicates}</div></div>
              <div className="stat"><div className="k">Expired</div><div className="v">{snap.stats.expired}</div></div>
            </div>
          </section>

          <section className="card" aria-label="Nodes">
            <h3>Nodes</h3>
            <ul className="event-list">
              {snap.nodes.map((n) => (
                <li key={n.id}>
                  <span className="mesh-icon" aria-hidden>{ROLE_ICON[n.role] ?? 'N'}</span>{' '}
                  <strong className="mono">{n.id}</strong>{' '}
                  <span className="pill small">{n.role}</span>{' '}
                  <span className={`pill small ${n.battery > 50 ? 'on' : n.battery > 20 ? 'warn' : 'off'}`}>{n.battery}%</span>{' '}
                  <span className="pill small">sees {n.seenPackets}</span>{' '}
                  {snap.relayHero === n.id && <span className="pill on small">⚡ HERO</span>}
                  {n.queuedPackets > 0 && <span className="pill warn small">⏳ {n.queuedPackets} queued</span>}
                  <span className="dim small"> · {n.degree} link{n.degree === 1 ? '' : 's'}</span>
                  <button
                    className="btn link"
                    style={{ marginLeft: 'auto', fontSize: '0.78rem' }}
                    disabled={busy}
                    onClick={() => void toggleHero(n.id)}
                    aria-label={`${snap.relayHero === n.id ? 'Release' : 'Nominate'} ${n.id} as Relay Hero`}
                  >
                    {snap.relayHero === n.id ? 'release hero' : 'make hero'}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="card" aria-label="Deliveries">
            <h3>Deliveries</h3>
            {snap.deliveries.length === 0 ? <p className="dim">No packets yet.</p> : (
              <ul className="event-list mono small">
                {snap.deliveries.slice(-15).reverse().map((d) => (
                  <li key={`${d.packetId}-${d.nodeId}`}>
                    {d.packetId.slice(0, 12)}… → <strong>{d.nodeId}</strong>{' '}
                    <span className={`pill small ${d.status === 'ACKED' ? 'on' : d.status === 'FAILED' || d.status === 'EXPIRED' ? 'off' : d.status === 'QUEUED' ? 'warn' : ''}`}>{d.status}</span>{' '}
                    {d.via && <span className="dim">via {d.via}</span>}
                    {d.attempts > 0 && <span className="dim"> ({d.attempts} retries)</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card" aria-label="Engine timeline">
            <h3>Engine timeline</h3>
            <ul className="event-list mono small">
              {snap.timeline.slice(-15).reverse().map((t, i) => (
                <li key={i}>
                  <span className="dim">{new Date(t.ts).toLocaleTimeString()}</span>{' '}
                  <strong>{t.nodeId}</strong> {t.event}
                  {t.detail && <span className="dim"> {JSON.stringify(t.detail)}</span>}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <section className="card" aria-label="Live mesh events">
        <h3>Live events {connected ? <span className="pill on">SSE LIVE</span> : <span className="pill off">SSE OFF</span>}</h3>
        {events.length === 0
          ? <p className="dim">Waiting for mesh events… (SSE requires sign-in; inject above to generate traffic)</p>
          : (
            <ul className="event-list mono small">
              {[...events].reverse().slice(0, 15).map((ev, i) => (
                <li key={`${ev.ts}-${i}`}>
                  <span className="dim">{new Date(ev.ts).toLocaleTimeString()}</span>{' '}
                  <strong>{ev.type}</strong> {ev.from} → {ev.to} {ev.hopCount != null && <span className="pill small">hop {ev.hopCount}</span>}
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  );
}
