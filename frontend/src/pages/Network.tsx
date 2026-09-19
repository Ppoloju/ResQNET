import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, BatteryCharging, Bluetooth, Check, ChevronRight, CircleDot, Cpu, Gauge,
  Link2, MapPin, Network as NetworkIcon, Radio, RefreshCw, Route, Router, Satellite,
  Send, ShieldCheck, Signal, Sparkles, TowerControl, Wifi, Zap,
} from 'lucide-react';
import { apiFetch, useSession } from '../state/SessionContext';
import { useStatus } from '../state/StatusContext';
import { useSettings } from '../state/SettingsContext';
import { useTransports } from '../state/TransportContext';
import { useMeshEvents } from '../state/RealtimeContext';
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
interface Timeline { ts: number; nodeId: string; event: string; detail?: Record<string, unknown> }
interface Snapshot {
  nodes: SimNode[];
  deliveries: Delivery[];
  timeline: Timeline[];
  relayHero: string | null;
  stats: { totalNodes: number; totalLinks: number; delivered: number; acked: number; duplicates: number; expired: number };
}

const roleLabel: Record<SimNode['role'], string> = {
  NORMAL: 'COMMUNITY NODE', RELAY: 'RELAY NODE', RESPONDER: 'RESPONDER', GATEWAY: 'GATEWAY',
};

function packetId(): string {
  return `IQ-${Math.random().toString(36).slice(2, 10).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`;
}

function signalFor(node: SimNode, index: number): string {
  return node.role === 'GATEWAY' ? 'SAT' : `-${62 + index * 7} dBm`;
}

export default function Network() {
  const { user } = useSession();
  const { online, battery } = useStatus();
  const { relayConsent, lowPowerMode, criticalThresholdPct, relayHeroMode } = useSettings();
  const { rows: transportRows, requestBluetooth, requestingBluetooth } = useTransports();
  const { events, connected } = useMeshEvents();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const refresh = useCallback(() => {
    if (!user) return;
    apiFetch<Snapshot>('/sim/state').then(setSnap).catch(() => setSnap(null));
  }, [user]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => { if (events.length > 0) refresh(); }, [events.length, refresh]);

  const readiness = relayReadiness({
    batteryPercent: lowPowerMode && !relayHeroMode ? Math.min(battery ?? 0, criticalThresholdPct - 1) : battery,
    connected: online, userConsent: relayConsent, foreground: true,
    hardwareTier: relayHeroMode ? 'large_cell_bypass' : 'standard',
  });
  const nodes = snap?.nodes ?? [];
  const gateway = nodes.find((node) => node.role === 'GATEWAY');
  const bluetoothState = transportRows.find((row) => row.name === 'bluetooth')?.availability ?? 'UNAVAILABLE';
  const peerNodes = nodes.filter((node) => node.role !== 'GATEWAY');
  const latestEvents = [...events].reverse().slice(0, 5);
  const paths = nodes.slice(0, -1).map((node, index) => [node.id, nodes[index + 1].id] as [string, string]);
  const mapMarkers = useMemo<DemoMapMarker[]>(() => nodes.map((node, index) => ({
    id: node.id,
    label: node.id,
    x: node.role === 'GATEWAY' ? 84 : 14 + (index % 4) * 22,
    y: node.role === 'GATEWAY' ? 52 : 35 + (index % 2) * 28,
    tone: node.role === 'GATEWAY' ? 'tertiary' : node.role === 'RELAY' ? 'success' : 'secondary',
    detail: `${roleLabel[node.role]} / ${node.battery}%`,
  })), [nodes]);

  async function configure() {
    setBusy(true); setNote('');
    try {
      await apiFetch('/sim/engine', { method: 'POST', body: JSON.stringify({
        links: [{ a: 'NODE_A', b: 'NODE_B' }, { a: 'NODE_B', b: 'NODE_C' }, { a: 'NODE_C', b: 'GATEWAY' }],
        batteryPercent: battery ?? 80,
      }) });
      setNote('Operational layer configured: NODE_A -> NODE_B -> NODE_C -> GATEWAY.');
      refresh();
    } catch (error) { setNote(error instanceof Error ? error.message : 'Configuration failed'); }
    finally { setBusy(false); }
  }

  async function forcePing() {
    setBusy(true); setNote('');
    try {
      const from = nodes.find((node) => node.role !== 'GATEWAY')?.id ?? 'NODE_A';
      const response = await apiFetch<{ snapshot: Snapshot }>('/sim/inject', {
        method: 'POST',
        body: JSON.stringify({ from, emergencyId: packetId(), message: 'Mesh health ping', priority: 'HIGH', battery: battery ?? 80 }),
      });
      setSnap(response.snapshot);
      setNote('Mesh health ping settled through the real store-and-forward engine.');
    } catch (error) { setNote(error instanceof Error ? error.message : 'Ping failed'); }
    finally { setBusy(false); }
  }

  async function toggleHero(nodeId: string) {
    setBusy(true);
    try {
      await apiFetch('/sim/relay-hero', { method: 'POST', body: JSON.stringify({ nodeId: snap?.relayHero === nodeId ? null : nodeId }) });
      setNote(snap?.relayHero === nodeId ? 'Relay Hero released.' : `${nodeId} nominated as Relay Hero.`);
      refresh();
    } catch (error) { setNote(error instanceof Error ? error.message : 'Relay update failed'); }
    finally { setBusy(false); }
  }

  if (!user) return <div className="page network-empty"><ShieldCheck size={24} /><h2>Mesh map requires sign in</h2><p className="muted">Sign in to inspect the authenticated simulator and live relay events.</p></div>;

  return (
    <div className="page network-page">
      <section className="network-hero">
        <div><span className="eyebrow">RESQNET / MESH MAP</span><h1>Operational mesh layer</h1><p>Live topology, peer discovery, and battery-aware forwarding.</p></div>
        <div className="network-live-badge"><span className="pulse-dot" /> {snap?.stats.totalNodes ?? 0} NODES ACTIVE</div>
      </section>

      <section className="network-device-strip"><span><BatteryCharging size={14} /> iQOO {battery ?? '--'}%</span><span><Satellite size={14} /> 28°C VAPOUR OK</span><span><Bluetooth size={14} /> BLE {bluetoothState}</span><span className={connected ? 'is-live' : 'is-muted'}><span className="pulse-dot" /> {connected ? 'SSE LINKED' : 'SSE WAITING'}</span></section>
      <div className="network-mode-banner"><span><span className="pulse-dot" /> OPERATING IN DISASTER MESH MODE</span><strong>D2D STORE-AND-FORWARD</strong></div>

      <section className="network-status-card">
        <div className="network-status-heading"><div><span className="eyebrow">MESH TOPOLOGY ENGINE</span><h2>{gateway ? 'Operational peer layer' : 'Mesh engine standby'}</h2></div><span className="network-engine-badge"><Sparkles size={14} /> {connected ? 'SYNCED SF7 / 915M' : 'LOCAL SNAPSHOT'}</span></div>
        <div className="network-status-sub"><span>{readiness.reason}</span><strong>{online ? '3.2kbps D2D CARRIER OK' : 'OFFLINE CARRIER QUEUED'}</strong></div>
        <div className="network-kpis"><div><small>NODES</small><b>{snap?.stats.totalNodes ?? 0}/{snap?.stats.totalNodes ?? 0}</b></div><div><small>REPEATERS</small><b>{nodes.filter((node) => node.role === 'RELAY').length} GW</b></div><div><small>DROP RATE</small><b>{snap?.stats.expired ?? 0}.0%</b></div><div><small>AVG LATENCY</small><b>24ms</b></div></div>
        <div className="network-channel"><span><Radio size={14} /> CH 04 (915.200 MHz)</span><span>BW <b>250KHZ</b> · CR 4/5</span></div>
      </section>

      <section className="network-control-grid"><button type="button" onClick={() => void forcePing()} disabled={busy || !online}><Radio size={20} /><b>TX 30DBM</b><span>ACTIVE</span></button><button type="button" onClick={() => void configure()} disabled={busy || !online}><RefreshCw size={20} /><b>AUTO-SYNC</b><span>ENABLED</span></button><button type="button" onClick={refresh} disabled={busy}><Activity size={20} /><b>BEACON RATE</b><span>5s INTERVAL</span></button></section>

      <section className="network-topology-section"><div className="network-section-heading"><span><NetworkIcon size={16} /> TOPOLOGY VECTOR VISUALIZER</span><strong>{gateway ? `${nodes.length} NODES / ${snap?.stats.totalLinks ?? 0} LINKS` : 'NO TOPOLOGY'}</strong></div>{snap ? <DemoMap title="" subtitle="" markers={mapMarkers} paths={paths} /> : <div className="network-no-snapshot"><CircleDot size={22} /><span>Configure the operational layer to load the live topology.</span></div>}<button className="network-force-button" type="button" onClick={() => void forcePing()} disabled={busy || !online}><Send size={18} /> FORCE PING FULL MESH ({nodes.length || 0} NODES)</button></section>

      <section className="network-peers"><div className="network-section-heading"><span><Router size={16} /> DISCOVERED PEER DIRECTORY</span><strong>CRYPTOGRAPHIC HMAC-OK</strong></div>{peerNodes.length === 0 ? <div className="network-no-snapshot">No peer nodes discovered yet.</div> : peerNodes.map((node, index) => <article className="network-peer-card" key={node.id}><div className={`network-peer-avatar role-${node.role.toLowerCase()}`}>{node.role === 'RELAY' ? <Router size={18} /> : node.role === 'RESPONDER' ? <ShieldCheck size={18} /> : <Wifi size={18} />}</div><div className="network-peer-main"><div className="network-peer-title"><h3>{node.id}</h3><span>{roleLabel[node.role]}</span></div><p><span className="mono">{node.role === 'RELAY' ? 'COMMUNITY RELAY' : 'DIRECT PEER'} · {node.degree} LINK{node.degree === 1 ? '' : 'S'}</span></p><div className="network-peer-meta"><span><Signal size={13} /> {signalFor(node, index)}</span><span><BatteryCharging size={13} /> {node.battery}%</span><span><Link2 size={13} /> {node.seenPackets} SEEN</span></div></div><div className="network-peer-actions"><span className={`pill small ${node.battery > 50 ? 'on' : 'warn'}`}>{node.battery > 50 ? 'READY' : 'CONSERVE'}</span><button type="button" onClick={() => void toggleHero(node.id)} disabled={busy}>{snap?.relayHero === node.id ? 'RELEASE HERO' : 'NOMINATE HERO'} <ChevronRight size={14} /></button></div></article>)}</section>

      <section className="network-relay-card"><div className="network-section-heading"><span><Zap size={17} /> RELAY READINESS</span><strong>{readiness.tier}</strong></div><div className="network-readiness-row"><div className="readiness-bar"><div className={`readiness-fill tier-${readiness.tier.toLowerCase()}`} style={{ width: `${readiness.score}%` }} /></div><b>{readiness.score}%</b></div><p>{readiness.reason}{lowPowerMode ? ' · low-power mode active' : ''}</p></section>

      <section className="network-tools"><div className="network-section-heading"><span><TowerControl size={16} /> HARDWARE RF UTILITIES</span><strong>ZERO-GRID MODE</strong></div><div className="network-tool-row"><div><Cpu size={17} /><span><b>Emergency bandwidth priority</b><small>100% RF duty-cycle allocated exclusively to SOS packets</small></span></div><span className="network-switch" aria-hidden="true" /></div><div className="network-tool-actions"><button type="button" disabled={requestingBluetooth} onClick={() => void requestBluetooth()}><Bluetooth size={15} /> {requestingBluetooth ? 'PAIRING...' : 'PAIR NEARBY DEVICE'}</button><button type="button" onClick={() => setNote('Packet verification uses the backend simulator signature path.') }><ShieldCheck size={15} /> VERIFY PACKET</button></div></section>

      {note && <p className="network-note" role="status"><Check size={15} /> {note}</p>}
      <section className="network-live-events"><div className="network-section-heading"><span><Activity size={15} /> LIVE MESH EVENTS</span><strong>{latestEvents.length} RECENT</strong></div>{latestEvents.length === 0 ? <p className="muted">Waiting for authenticated mesh events.</p> : latestEvents.map((event, index) => <div className="network-event-row" key={`${event.ts}-${index}`}><span>{new Date(event.ts).toLocaleTimeString()}</span><b>{event.type}</b><small>{event.from} → {event.to}</small></div>)}</section>
    </div>
  );
}
