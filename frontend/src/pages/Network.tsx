import { useState } from 'react';
import { BatteryCharging, Bluetooth, Cloud, Info, Radio, ShieldCheck, Smartphone, Wifi, WifiOff } from 'lucide-react';
import { useMesh } from '../state/MeshContext';
import { useStatus } from '../state/StatusContext';
import { useSettings } from '../state/SettingsContext';
import { useTransports } from '../state/TransportContext';
import { useMeshEvents } from '../state/RealtimeContext';

function readable(value: string): string {
  return value.toLowerCase().replaceAll('_', ' ');
}

export default function Network() {
  const { online, backendReachable, battery } = useStatus();
  const { relayConsent, lowPowerMode } = useSettings();
  const { outboxCount } = useMesh();
  const { rows, requestBluetooth, requestingBluetooth } = useTransports();
  const { connected } = useMeshEvents();
  const [note, setNote] = useState('');
  const bluetooth = rows.find((row) => row.name === 'bluetooth');
  const lan = rows.find((row) => row.name === 'local-network');

  async function pairBluetooth() {
    const paired = await requestBluetooth();
    setNote(paired ? 'Bluetooth peer connected for this foreground session.' : 'No Bluetooth peer was connected.');
  }

  return (
    <div className="page network-page">
      <header className="network-page-head">
        <span className="eyebrow">RESQNET / NETWORK</span>
        <h1>Connection status</h1>
        <p className="muted">Only live device and server state appears here. Radio mesh requires the native mobile client.</p>
      </header>

      <section className="network-status-grid" aria-label="Current connection status">
        <article className={`network-status-card ${backendReachable ? 'is-ready' : 'is-muted'}`}>
          {backendReachable ? <Cloud size={22} /> : <WifiOff size={22} />}
          <span>Backend</span>
          <strong>{backendReachable ? 'Reachable' : online ? 'Not reachable' : 'Offline'}</strong>
          <small>{lan?.detail ?? 'Health check pending'}</small>
        </article>
        <article className={`network-status-card ${connected ? 'is-ready' : 'is-muted'}`}>
          <Radio size={22} />
          <span>Live updates</span>
          <strong>{connected ? 'Connected' : 'Reconnecting'}</strong>
          <small>Server-sent events</small>
        </article>
        <article className={`network-status-card ${bluetooth?.availability === 'READY' ? 'is-ready' : 'is-muted'}`}>
          <Bluetooth size={22} />
          <span>Bluetooth</span>
          <strong>{bluetooth ? readable(bluetooth.availability) : 'Checking'}</strong>
          <small>{bluetooth?.detail ?? 'Browser capability check pending'}</small>
        </article>
      </section>

      <section className="network-device-panel">
        <div className="network-panel-heading"><div><span className="eyebrow">THIS DEVICE</span><h2>Relay readiness</h2></div><ShieldCheck size={24} /></div>
        <div className="network-fact-grid">
          <div><BatteryCharging size={17} /><span>Battery</span><strong>{battery == null ? 'Unavailable' : `${battery}%`}</strong></div>
          <div><Wifi size={17} /><span>Internet</span><strong>{online ? 'Available' : 'Offline'}</strong></div>
          <div><Smartphone size={17} /><span>Relay consent</span><strong>{relayConsent ? 'Allowed' : 'Off'}</strong></div>
          <div><Radio size={17} /><span>Power mode</span><strong>{lowPowerMode ? 'Conserving' : 'Normal'}</strong></div>
        </div>
        {outboxCount > 0 && <p className="network-queue" role="status">{outboxCount} emergency item{outboxCount === 1 ? '' : 's'} waiting for a reachable backend.</p>}
        <div className="network-actions">
          <button type="button" className="btn-secondary" disabled={requestingBluetooth || bluetooth?.availability === 'UNSUPPORTED'} onClick={() => void pairBluetooth()}>
            <Bluetooth size={17} /> {requestingBluetooth ? 'Choosing peer…' : 'Connect foreground Bluetooth'}
          </button>
          {note && <span className="muted" role="status">{note}</span>}
        </div>
      </section>

      <section className="network-boundary" aria-label="Network capability boundary">
        <Info size={19} />
        <div>
          <strong>What works here</strong>
          <p className="muted">The PWA can sync through the backend, receive live updates, queue emergencies offline, and connect to one user-selected Bluetooth peer while this tab is open.</p>
          <p className="muted"><strong>What requires Android or iOS</strong>: background advertising, scanning, multi-hop forwarding, boot-persistent SOS, and native push delivery. No simulated nodes are shown as real phones.</p>
        </div>
      </section>
    </div>
  );
}
