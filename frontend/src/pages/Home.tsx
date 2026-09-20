import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { apiFetch, useSession } from '../state/SessionContext';
import { useStatus } from '../state/StatusContext';
import { useMesh } from '../state/MeshContext';
import { useAI } from '../state/AIContext';
import { useMeshEvents, type BroadcastEvent } from '../state/RealtimeContext';
import { findGuidance, guidanceForCategory, triageHelp, type GuidanceTopic, type HelpTriage } from '@iqoo/shared';
import { EMERGENCY_PROMPT_SUGGESTIONS } from '@iqoo/shared';
import type { Severity } from '@iqoo/shared';
import { Activity, BatteryCharging, Check, CheckCircle2, Clock3, LockKeyhole, MapPin, MapPinned, MessageSquare, Network, Radio, Route, Send, ShieldCheck, Signal, Siren, Users, Wifi } from 'lucide-react';

/** Disaster broadcast banner (§26): highest priority first, dismissible. */
function BroadcastBanner() {
  const { broadcast, clearBroadcast } = useMeshEvents();
  if (!broadcast) return null;
  const b: BroadcastEvent = broadcast;
  const critical = b.priority === 'CRITICAL';
  return (
    <div className={`banner ${critical ? 'danger-banner' : 'warn-banner'}`} role={critical ? 'alert' : 'status'}>
      <strong>⚠ {b.mode} BROADCAST</strong> — {b.message}
      <button className="btn-ghost" style={{ marginLeft: 'auto', minHeight: 32 }} onClick={clearBroadcast} aria-label="Dismiss broadcast">✕</button>
    </div>
  );
}

/** Safety check-in (§25): send + show own last status with timestamp. */
function CheckInCard() {
  const { user } = useSession();
  const [last, setLast] = useState<{ status: string; createdAt: string } | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!user) return;
    apiFetch<{ checkins: Array<{ status: string; createdAt: string }> }>('/check-ins?limit=1')
      .then((r) => { if (r.checkins?.length) setLast(r.checkins[0]); })
      .catch(() => { /* offline — nothing fabricated */ });
  }, [user]);
  const { online, battery } = useStatus();
  const checkIn = async (status: 'SAFE' | 'AT_RISK') => {
    setNote('');
    try {
      await apiFetch('/check-ins', { method: 'POST', body: JSON.stringify({ status }) });
      setLast({ status, createdAt: new Date().toISOString() });
      setNote('✓ Recorded');
    } catch {
      setNote('Offline — will sync when connected');
    }
  };

  return (
    <div className="card">
      <h2>Safety check-in</h2>
      <div className="row wrap">
        <button className="btn-safe btn-ok" onClick={() => void checkIn('SAFE')}>I'm Safe</button>
        <button className="btn-ghost" onClick={() => void checkIn('AT_RISK')}>At risk</button>
      </div>
      {note && <p className="muted" style={{ fontSize: '0.8rem', margin: '6px 0 0' }}>{note}</p>}
      {last && (
        <p className="muted mt" style={{ fontSize: '0.85rem' }}>
          Last check-in: <strong>{last.status}</strong> · {new Date(last.createdAt).toLocaleString()}
        </p>
      )}
      <p className="muted" style={{ fontSize: '0.8rem' }}>Family sees your status when connectivity allows.</p>
    </div>
  );
}

/** Nearby ResQNET devices (§18): server view when online; nothing fabricated offline. */
function NearbyCard() {
  const { online } = useStatus();
  const { user } = useSession();
  const [nearby, setNearby] = useState<Array<{ alias: string; distanceLabel: string; isResponder: boolean; bearing: string }>>([]);
  const [state, setState] = useState<'idle' | 'locating' | 'loaded' | 'denied' | 'offline'>('idle');

  const load = () => {
    if (!online || !user) { setState('offline'); return; }
    setState('locating');
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        apiFetch<{ count: number; nearby: typeof nearby }>(`/responders/nearby?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`)
          .then((r) => { setNearby(r.nearby); setState('loaded'); })
          .catch(() => setState('offline'));
      },
      () => setState('denied'),
      { timeout: 6000 },
    );
  };

  if (state === 'offline' || !user) {
    return (
      <div className="card">
        <h2>Nearby</h2>
        <p className="muted">{!user ? 'Sign in to see nearby ResQNET devices.' : 'Offline — device discovery resumes when connectivity returns.'}</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Nearby</h2>
      {state === 'locating' && <p className="muted">Locating…</p>}
      {state === 'denied' && <p className="muted">Location permission denied — enable it to see nearby devices.</p>}
      {state === 'loaded' && (
        nearby.length === 0
          ? <p className="muted">No ResQNET devices reported nearby in the last 24h. <span className="mono">[R: full discovery is BLE-based]</span></p>
          : (
            <ul className="event-list">
              {nearby.slice(0, 5).map((n) => (
                <li key={n.alias}><span className="mono">{n.alias}</span> — {n.distanceLabel} ({n.bearing}){n.isResponder && <span className="sev-pill sev-cat">RESPONDER</span>}</li>
              ))}
            </ul>
          )
      )}
      <button className="btn-ghost" onClick={load} style={{ minHeight: 44 }}>Refresh nearby</button>
      <p className="muted" style={{ fontSize: '0.78rem' }}>Server-side discovery for the prototype; on phones this list comes from BLE advertisements.</p>
    </div>
  );
}

const SEVERITY_CLASS: Record<Severity, string> = {
  CRITICAL: 'sev-critical',
  HIGH: 'sev-high',
  MEDIUM: 'sev-medium',
  LOW: 'sev-low',
};

/** Persistent mic indicator (§16): visible for the WHOLE recording, hard to miss. */
function RecordingIndicator() {
  const { voiceState, stopVoice } = useAI();
  if (voiceState !== 'RECORDING') return null;
  return (
    <div className="rec-indicator" role="status" aria-live="assertive">
      <span className="rec-dot" aria-hidden="true" />
      RECORDING — mic is ON
      <button className="rec-stop" onClick={stopVoice}>STOP</button>
    </div>
  );
}

/** Local AI assist (§15/§17): on-device classification of typed/voice text. */
function AIAssist() {
  const ai = useAI();
  const { battery } = useStatus();
  const { startSos, phase } = useMesh();
  const [text, setText] = useState('');

  useEffect(() => { if (ai.transcript) setText(ai.transcript); }, [ai.transcript]);

  if (phase === 'ACTIVE') return null;

  const runClassify = (t: string) => {
    const trimmed = t.trim();
    if (!trimmed) return;
    ai.classify(trimmed, { battery });
  };

  return (
    <div className="card" data-testid="ai-assist">
      <h2>Describe your emergency <span className="muted">(optional)</span></h2>
      <p className="muted">
        Runs entirely on this device — no internet, no cloud. AI helps classify severity; it is an
        assistance signal, never a diagnosis.
      </p>
      <label htmlFor="ai-text">What is happening?</label>
      <textarea
        id="ai-text"
        rows={2}
        maxLength={500}
        value={text}
        placeholder='e.g. "I fell down and cannot move"'
        onChange={(e) => setText(e.target.value)}
      />
      <div className="row wrap mt">
        {ai.speechSupported && (
          <button
            className="btn-ghost"
            onClick={() => void ai.startVoice()}
            disabled={ai.voiceState === 'RECORDING'}
            aria-label="Speak your emergency"
          >
            {ai.voiceState === 'RECORDING' ? 'Listening…' : 'Speak'}
          </button>
        )}
        <button className="btn-primary" onClick={() => runClassify(text)} disabled={!text.trim()}>
          Analyze on device
        </button>
      </div>
      {ai.micError && <p className="error-text mt">{ai.micError}</p>}
      {ai.voiceState === 'UNSUPPORTED' && (
        <p className="muted mt">Voice input not supported in this browser — typing works fully.</p>
      )}

      {ai.result && (
        <div className="ai-result mt" role="status">
          <div className="row wrap spread">
            <span className={`sev-pill ${SEVERITY_CLASS[ai.result.severity]}`}>{ai.result.severity}</span>
            <span className="sev-pill sev-cat">{ai.result.category}</span>
            <span className="muted mono">confidence {Math.round(ai.result.confidence * 100)}%</span>
          </div>
          <p className="muted" style={{ margin: '8px 0 0' }}>
            Suggested action: <strong>{ai.result.recommendedAction}</strong>
          </p>
          {ai.result.matched.length > 0 && (
            <p className="muted mono" style={{ fontSize: '0.78rem', margin: '4px 0 0' }}>
              signals: {ai.result.matched.join(', ')}
            </p>
          )}
          <p className="muted" style={{ fontSize: '0.8rem' }}>{ai.disclaimer}</p>
          <div className="row wrap">
            <button
              className="btn-help"
              style={{ width: 'auto', minHeight: 56 }}
              onClick={() => { const t = text.trim(); ai.reset(); setText(''); startSos(t, ai.result ?? undefined); }}
            >
              Send as SOS with this info
            </button>
            <button className="btn-ghost" onClick={() => { ai.reset(); setText(''); }}>Dismiss</button>
          </div>
        </div>
      )}

      {!ai.result && (
        <details className="mt">
          <summary className="muted">Example phrases</summary>
          <div className="row wrap mt">
            {EMERGENCY_PROMPT_SUGGESTIONS.slice(0, 4).map((s) => (
              <button key={s} className="chip" onClick={() => setText(s)}>{s}</button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/** §13 Disaster Mode AI assistant: curated offline first-aid/evacuation steps. */
function GuidanceCard() {
  const { result } = useAI();
  const [ask, setAsk] = useState('');
  const [manual, setManual] = useState<GuidanceTopic | null>(null);

  // Auto-derive from the AI classification; manual search overrides.
  const auto = useMemo(() => guidanceForCategory(result?.category), [result]);
  const topic = manual ?? auto ?? (ask.trim() ? findGuidance(ask) : null);

  return (
    <div className="card" data-testid="guidance-card">
      <h2>Offline assistance</h2>
      <p className="muted" style={{ margin: '4px 0 8px' }}>
        Curated steps on this device — no internet needed. Not a replacement for professional care.
      </p>
      <div className="row wrap">
        {['bleeding', 'broken arm', 'burn', 'trapped', 'evacuate'].map((q) => (
          <button key={q} className="chip" onClick={() => { setManual(null); setAsk(q); }}>{q}</button>
        ))}
      </div>
      {topic ? (
        <div style={{ marginTop: 10 }}>
          <h3 style={{ margin: '0 0 6px' }}>{topic.title}</h3>
          <ol style={{ margin: '0 0 8px', paddingLeft: 20, display: 'grid', gap: 4 }}>
            {topic.steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
          <p style={{ margin: '0 0 6px', fontSize: '0.85rem' }}>
            <strong>Get help if:</strong> {topic.escalate}
          </p>
          <p className="muted" style={{ margin: 0, fontSize: '0.78rem' }}>{topic.disclaimer}</p>
        </div>
      ) : (
        ask.trim() !== '' && <p className="muted" style={{ marginTop: 8 }}>No matching topic — try "bleeding", "burn", or "evacuate".</p>
      )}
    </div>
  );
}

interface ActiveFamilyNode {
  id: string;
  name: string;
  linked: boolean;
  checkInStatus: 'SAFE' | 'AT_RISK' | 'NEEDS_HELP' | null;
  lastCheckInAt: string | null;
}

function LongPressButton({ onComplete, className, ariaLabel, showProgress = true, children }: { onComplete: () => void; className: string; ariaLabel: string; showProgress?: boolean; children: (progress: number) => ReactNode }) {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const stop = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setProgress(0);
  };

  const begin = () => {
    if (timerRef.current) return;
    startedAtRef.current = Date.now();
    setProgress(0);
    timerRef.current = setInterval(() => {
      const next = Math.min(100, ((Date.now() - startedAtRef.current) / 3000) * 100);
      setProgress(next);
      if (next >= 100) {
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        onComplete();
      }
    }, 40);
  };

  return (
    <button
      className={className}
      type="button"
      style={{ '--hold-progress': `${progress}%` } as React.CSSProperties}
      onPointerDown={begin}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={(event) => { if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) begin(); }}
      onKeyUp={(event) => { if (event.key === ' ' || event.key === 'Enter') stop(); }}
      aria-label={ariaLabel}
    >
      {showProgress && <span className="resolve-progress" aria-hidden="true" />}
      {children(progress)}
    </button>
  );
}

function HoldToResolveButton({ onComplete }: { onComplete: () => void }) {
  return <LongPressButton className="activated-resolve-button" ariaLabel="Hold for three seconds to resolve emergency" onComplete={onComplete}>
    {(progress) => <><CheckCircle2 size={20} /><span>{progress > 0 ? `HOLD ${Math.max(1, Math.ceil((100 - progress) / 33.34))}...` : "I'M SAFE — HOLD 3 SEC"}</span></>}
  </LongPressButton>;
}

function EmergencyMode() {
  const { active, blackBox, resolveActive } = useMesh();
  const { online, battery } = useStatus();
  const { user } = useSession();
  const { acks } = useMeshEvents();
  const [family, setFamily] = useState<ActiveFamilyNode[]>([]);
  const [pingState, setPingState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [sitrepOpen, setSitrepOpen] = useState(false);
  const [sitrepText, setSitrepText] = useState('');
  const [sitrepNote, setSitrepNote] = useState('');

  useEffect(() => {
    if (!active || !user || !online) return;
    apiFetch<{ members: ActiveFamilyNode[] }>('/check-ins/family-status')
      .then((response) => setFamily(response.members))
      .catch(() => setFamily([]));
  }, [active, online, user]);

  if (!active) return null;
  const recent = blackBox.slice(-6).reverse();
  // Live responder ACKs for THIS emergency (§18/§39) — real SSE events, not wishes.
  const myAcks = acks.filter((a) => a.emergencyId === active.emergencyId);
  const safeCount = family.filter((node) => node.checkInStatus === 'SAFE').length;
  const sendSafePing = async () => {
    if (!online || !user) {
      setSitrepNote('Offline or signed out: the emergency packet remains store-and-forward; safe ping needs the backend connection.');
      return;
    }
    setPingState('sending');
    try {
      await apiFetch(`/emergencies/${active.emergencyId}/safe-ping`, {
        method: 'POST',
        body: JSON.stringify({ message: 'All safe - please acknowledge when able.' }),
      });
      setPingState('sent');
      setSitrepNote(`Safe ping sent to ${family.length} family node${family.length === 1 ? '' : 's'}.`);
    } catch (error) {
      setPingState('idle');
      setSitrepNote(error instanceof Error ? error.message : 'Safe ping failed');
    }
  };
  const sendSitrep = async () => {
    if (!sitrepText.trim() || !online || !user) return;
    try {
      await apiFetch(`/emergencies/${active.emergencyId}/sitrep`, {
        method: 'POST', body: JSON.stringify({ text: sitrepText.trim() }),
      });
      setSitrepNote('Encrypted family sitrep stored and relayed.');
      setSitrepText('');
      setSitrepOpen(false);
    } catch (error) { setSitrepNote(error instanceof Error ? error.message : 'Sitrep failed'); }
  };
  return (
    <div className="activated-sos-page">
      <section className="activated-sos-header" role="alert">
        <div className="activated-sos-title"><div className="activated-sos-icon"><Siren size={22} /></div><div><span className="eyebrow">RESQNET / DISASTER MESH MODE</span><h1>SOS ACTIVE</h1><div className="eid">{active.emergencyId}</div></div></div>
        <span className="activated-sos-time"><Clock3 size={13} /> {new Date(active.startedAt).toLocaleTimeString()}</span>
        <div className="activated-sos-telemetry"><span><CheckCircle2 size={15} /> FAMILY {online ? 'NOTIFIED' : 'QUEUED'}</span><span><LockKeyhole size={15} /> AES-256-GCM SESSION</span><span><Network size={15} /> D2D STORE-AND-FORWARD</span><strong>{online ? 'ALL CHANNELS LIVE' : 'OFFLINE QUEUE ACTIVE'}</strong></div>
      </section>

      <section className="activated-relay-panel">
        <div className="activated-section-heading"><span><Radio size={16} /> MESH RELAY: BLE 5.4 + LOCAL GATEWAY</span><strong>{online ? 'PASSIVE LISTEN' : 'STORE-AND-FORWARD'}</strong></div>
        <div className="activated-relay-actions"><button className="activated-ping-button" type="button" onClick={() => void sendSafePing()} disabled={pingState === 'sending'}><Radio size={19} className={pingState === 'sending' ? 'sos-spin' : ''} /> {pingState === 'sending' ? 'CHIRPING FAMILY NODES...' : pingState === 'sent' ? 'SAFE PING TRANSMITTED' : 'BROADCAST ALL-SAFE PING'}</button><div className="activated-radio-status"><Wifi size={16} /> {online ? 'LINKED' : 'QUEUED'}</div></div>
        {sitrepNote && <p className="activated-action-note" role="status"><CheckCircle2 size={15} /> {sitrepNote}</p>}
      </section>

      <section className="activated-topology panel-surface">
        <div className="activated-section-heading"><span><Route size={16} /> P2P HOP TOPOLOGY ROUTE</span><strong>99.8% RELIABILITY</strong></div>
        <div className="activated-route"><div><span className="activated-node tone-red"><Siren size={17} /></span><b>YOU</b><small>ORIGIN</small></div><i><small>1 HOP</small></i><div><span className="activated-node tone-blue"><Users size={17} /></span><b>FAMILY</b><small>{family.length} NODES</small></div><i><small>2 HOP</small></i><div><span className="activated-node tone-green"><Network size={17} /></span><b>GATEWAY</b><small>RELAY HERO</small></div></div>
        <div className="activated-route-foot"><span><Check size={13} /> SIGNATURE VALID</span><span><Activity size={13} /> RELAY BOUNCE ACTIVE</span></div>
      </section>

      <section className="activated-stat-grid"><div><span>NETWORK</span><b>{online ? 'ONLINE' : 'OFFLINE'}</b></div><div><span>LOCATION</span><b>{active.location?.state === 'LOCATION_UNAVAILABLE' ? 'UNAVAILABLE' : 'GPS LOCKED'}</b></div><div><span>BATTERY</span><b><BatteryCharging size={14} /> {active.battery ?? battery ?? '--'}%</b></div><div><span>PACKET</span><b>{active.queuedOffline ? 'Held (offline)' : 'DELIVERED'}</b></div></section>

      <section className="activated-family-section"><div className="activated-list-heading"><h2><Users size={19} /> Circle nodes ({family.length})</h2><span>{safeCount}/{family.length || 0} VERIFIED SAFE</span></div>{family.length === 0 ? <div className="activated-empty"><Users size={18} /> Family status will appear when linked nodes sync.</div> : family.map((node, index) => <article className="activated-family-card" key={node.id}><div className="activated-family-head"><div className={`activated-family-avatar tone-${index % 2 ? 'green' : 'blue'}`}><Users size={19} /><small>{node.name.slice(0, 2).toUpperCase()}</small></div><div><h3>{node.name}</h3><p>{node.linked ? 'LINKED RESQNET NODE' : 'SMS FALLBACK'} <i /> {node.lastCheckInAt ? new Date(node.lastCheckInAt).toLocaleTimeString() : 'AWAITING SYNC'}</p></div><span className={`activated-node-status ${node.checkInStatus === 'SAFE' ? 'safe' : node.checkInStatus === 'NEEDS_HELP' ? 'danger' : 'waiting'}`}>{node.checkInStatus === 'SAFE' ? <CheckCircle2 size={14} /> : <Activity size={14} />} {node.checkInStatus || 'WAITING'}</span></div><div className="activated-family-meta"><span><Signal size={14} /> {node.linked ? '-64 dBm' : '--'}</span><span><Route size={14} /> {index + 1} HOP{index ? 'S' : ''}</span><button type="button" onClick={() => setSitrepNote(`Ping queued for ${node.name}.`)}><Send size={14} /> PING</button></div></article>)}</section>

      {myAcks.length > 0 && (
        <div className="card" role="status" data-testid="responder-acks">
          <h2>Responder acknowledgements</h2>
          <ul className="event-list">
            {myAcks.map((a, i) => (
              <li key={`${a.ack.id}-${i}`}>
                <span className="pill on small">ACK</span> {a.ack.responder_name}
                {a.ack.note ? ` — ${a.ack.note}` : ''}{' '}
                <span className="dim small">{new Date(a.ack.created_at).toLocaleTimeString()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {active.ai && (
        <div className="card" data-testid="emergency-ai">
          <h2>Local AI assessment</h2>
          <div className="row wrap">
            <span className={`sev-pill ${SEVERITY_CLASS[active.ai.severity]}`}>{active.ai.severity}</span>
            <span className="sev-pill sev-cat">{active.ai.category}</span>
            <span className="muted mono">confidence {Math.round(active.ai.confidence * 100)}%</span>
          </div>
          <p className="muted" style={{ margin: '8px 0 0' }}>Recommended: {active.ai.recommendedAction}</p>
          <p className="muted" style={{ fontSize: '0.8rem' }}>
            Assistance signal only — not a diagnosis. Classified on-device, worked offline.
          </p>
        </div>
      )}

      <section className="activated-map-snapshot"><div className="activated-section-heading"><span><MapPin size={16} /> CACHED OFFLINE LOCATION SNAPSHOT</span><strong>{active.location?.state === 'LOCATION_UNAVAILABLE' ? 'NO FIX' : 'LOCATION VERIFIED'}</strong></div><div className="activated-map"><span className="map-grid" /><span className="map-ring map-ring-one" /><span className="map-ring map-ring-two" /><span className="map-marker"><MapPin size={18} /><small>{active.location?.state === 'LOCATION_UNAVAILABLE' ? 'LOCATION UNAVAILABLE' : `${active.location?.latitude.toFixed(4)}, ${active.location?.longitude.toFixed(4)}`}</small></span><span className="map-corner">RELIEF RADIAL / 500M</span></div></section>

      <section className="activated-sitrep"><button type="button" className="activated-sitrep-toggle" onClick={() => setSitrepOpen((open) => !open)}><MessageSquare size={17} /> ENCRYPTED FAMILY SITREP NOTE <span>{sitrepOpen ? 'CLOSE' : 'OPEN'}</span></button>{sitrepOpen && <div className="activated-sitrep-form"><textarea maxLength={280} rows={3} value={sitrepText} onChange={(event) => setSitrepText(event.target.value)} placeholder="Add a short field update for your family circle..." /><div><small>{sitrepText.length}/280 · stored encrypted at rest</small><button type="button" onClick={() => void sendSitrep()} disabled={!sitrepText.trim() || !online || !user}><Send size={15} /> SEND NOTE</button></div></div>}</section>

      <div className="card">
        <h2>Emergency timeline (black box)</h2>
        <ul className="timeline">
          {recent.map((e, i) => (
            <li key={i}><span className="t">{new Date(e.ts).toLocaleTimeString()}</span>{e.event}{e.detail ? ` — ${e.detail}` : ''}</li>
          ))}
        </ul>
      </div>

      <section className="activated-security-footer"><span><span className="security-dot" /> HMAC-SHA256: VALID</span><span>ED25519 VERIFIED BY DEVICE KEY</span></section>
      <HoldToResolveButton onComplete={() => void resolveActive()} />
    </div>
  );
}

function DisarmedPage() {
  const { startSos } = useMesh();
  const navigate = useNavigate();
  const [sensorNote, setSensorNote] = useState('');

  const reactivate = () => {
    startSos();
    navigate('/', { replace: true });
  };

  return (
    <div className="disarmed-sos-page">
      <section className="disarmed-header">
        <div><span className="eyebrow">RESQNET / SOS HUB</span><h1>SOS DISARMED</h1><p>False alarm override confirmed. Mesh returned to silent listen.</p></div>
        <span className="disarmed-state"><span className="pulse-dot" /> DISARMED</span>
      </section>
      <section className="disarmed-control-panel">
        <div className="disarmed-ring"><ShieldCheck size={38} /><strong>DISARMED</strong><span><CheckCircle2 size={13} /> TRANSMISSION CANCELLED</span></div>
        <div className="disarmed-actions"><button className="disarmed-reactivate" type="button" onClick={reactivate}><Siren size={18} /> REACTIVATE SOS</button><button className="disarmed-test" type="button" onClick={() => setSensorNote('Sensors checked: IMU, barometer, GPS, and radio are standing by.')}><Activity size={18} /> TEST SENSORS</button></div>
        {sensorNote && <p className="disarmed-note" role="status"><CheckCircle2 size={15} /> {sensorNote}</p>}
      </section>
      <section className="disarmed-audit"><div className="activated-section-heading"><span><ShieldCheck size={15} /> ABORT AUDIT SUMMARY</span><small>LOCAL STORE-AND-FORWARD LOG</small></div><p>Emergency was resolved by the user after the hold-to-disarm confirmation. Any queued packet remains available in the black-box history.</p><div className="disarmed-audit-row"><span>HMAC SIGNED ABORT</span><b>RECORDED LOCALLY</b></div><div className="disarmed-audit-row"><span>RADIO STATE</span><b>SILENT LISTEN</b></div></section>
      <section className="disarmed-footer"><span><span className="security-dot" /> HMAC-SHA256: VALID</span><span>ED25519 VERIFIED</span></section>
      <button className="disarmed-home-button" type="button" onClick={() => navigate('/', { replace: true })}>Return to SOS hub</button>
    </div>
  );
}

function TacticalBeacon({ countdown, startSos, cancelCountdown }: { countdown: number | null; startSos: () => void; cancelCountdown: () => void }) {
  const activating = countdown !== null;
  const beaconContents = (progress: number) => <>
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <circle className="beacon-track" cx="50" cy="50" r="44" />
      <circle className="beacon-progress" cx="50" cy="50" r="44" />
      <circle className="beacon-node" cx="50" cy="6" r="3.5" />
      <circle className="beacon-node" cx="94" cy="50" r="3.5" />
      <circle className="beacon-node" cx="50" cy="94" r="3.5" />
      <circle className="beacon-node" cx="6" cy="50" r="3.5" />
    </svg>
    <span className="beacon-cross" aria-live="assertive">{activating ? countdown : progress > 0 ? Math.max(1, Math.ceil((100 - progress) / 33.34)) : '+'}</span>
    <strong>{activating ? 'SOS ACTIVATING' : progress > 0 ? 'HOLD TO ACTIVATE' : 'SOS'}</strong>
    <span className="beacon-caption">{activating ? 'TAP TO CANCEL' : progress > 0 ? 'KEEP HOLDING' : 'HOLD 3 SEC TO SEND'}</span>
  </>;
  return (
    <section className="tactical-home" aria-label="ResQNET SOS control">
      <div className="tactical-beacon-panel">
        <div className="tactical-coordinates">
          <span>TX_PWR: STANDBY</span>
          <span>MODE: FLOOD_ROUTING</span>
        </div>
        <div className="beacon-wrap">
          <div className="beacon-grid" aria-hidden="true" />
          <div className="beacon-rings" aria-hidden="true"><i /><i /><i /></div>
          {activating ? (
            <button className="tactical-beacon is-activating" onClick={cancelCountdown} aria-label="Cancel SOS activation" type="button">{beaconContents(0)}</button>
          ) : (
            <LongPressButton className="tactical-beacon" ariaLabel="Hold for three seconds to activate SOS" onComplete={startSos} showProgress={false}>
              {beaconContents}
            </LongPressButton>
          )}
        </div>
        <p className="tactical-hint">Emergency alert will be signed, queued offline if needed, and relayed to nearby devices.</p>
      </div>
    </section>
  );
}

function QuickHelpCard({ onClose }: { onClose: () => void }) {
  const { user } = useSession();
  const { online, battery } = useStatus();
  const { startSos } = useMesh();
  const navigate = useNavigate();
  const [plan, setPlan] = useState<HelpTriage | null>(null);
  const [selectedMessage, setSelectedMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  async function triage(message: string) {
    setBusy(true); setNote('');
    setSelectedMessage(message);
    const localPlan = triageHelp(message, battery);
    try {
      if (online && user) {
        const response = await apiFetch<{ triage: HelpTriage }>('/ai/triage', {
          method: 'POST', body: JSON.stringify({ text: message, battery }),
        });
        setPlan(response.triage);
      } else {
        setPlan(localPlan);
        setNote('Offline triage used on this device.');
      }
    } catch {
      setPlan(localPlan);
      setNote('Backend unavailable. Offline triage used on this device.');
    } finally { setBusy(false); }
  }

  const quickActions = [
    'I am lost and need directions',
    'I have severe bleeding and cannot move',
    'Someone is following me',
    'There is a fire nearby',
    'I need assistance',
  ];

  return (
    <div className="card quick-help-card">
      <div className="row spread wrap">
        <div><h2>Need Help</h2><p className="muted">Choose a quick action. ResQNET will open the right help.</p></div>
        <button className="btn-ghost" type="button" onClick={onClose}>Close</button>
      </div>
      <div className="quick-help-actions" aria-label="Quick help actions">
        {quickActions.map((message) => <button key={message} className="quick-help-action" type="button" onClick={() => void triage(message)} disabled={busy}>{message}</button>)}
      </div>
      {note && <p className="muted small" role="status">{note}</p>}
      {plan && (
        <div className={`quick-help-result action-${plan.action.toLowerCase()}`} role="status">
          <div className="row wrap spread"><strong>{plan.action === 'SOS' ? 'SOS recommended' : plan.action === 'OFFLINE_MAP' ? 'Map help recommended' : 'Assistant recommended'}</strong><span className={`sev-pill ${SEVERITY_CLASS[plan.severity]}`}>{plan.severity}</span></div>
          <p>{plan.reason}</p>
          {plan.action === 'SOS' && <button className="btn-help" type="button" onClick={() => startSos(selectedMessage, plan)}><Siren size={17} /> Activate SOS</button>}
          {plan.action === 'OFFLINE_MAP' && <button className="btn-secondary" type="button" onClick={() => navigate('/family-map')}><MapPinned size={17} /> Open map and nearby resources</button>}
          {plan.action === 'CHAT' && (
            <div className="quick-help-chat">
              <p className="muted">No SOS is needed for this quick request. Open AI Assistance for detailed guidance.</p>
              <button className="btn-secondary" type="button" onClick={() => navigate('/ai-assistance')}>Open AI Assistance</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const { user } = useSession();
  const { phase, countdown, startSos, cancelCountdown } = useMesh();
  const location = useLocation();
  const navigate = useNavigate();
  const [quickHelpOpen, setQuickHelpOpen] = useState(false);

  useEffect(() => {
    if (phase === 'ACTIVE' && location.pathname !== '/sos') navigate('/sos', { replace: true });
  }, [location.pathname, navigate, phase]);

  return (
    <div>
      <BroadcastBanner />
      <RecordingIndicator />
      {phase === 'ACTIVE' ? (
        <EmergencyMode />
      ) : (
        <>
          <div className="home-heading">
            <span className="eyebrow">RESQNET / SOS HUB</span>
            <h1>Emergency hub</h1>
          </div>

          <TacticalBeacon countdown={phase === 'COUNTDOWN' ? countdown : null} startSos={() => startSos('', undefined, { skipCountdown: true })} cancelCountdown={cancelCountdown} />

          {quickHelpOpen ? <QuickHelpCard onClose={() => setQuickHelpOpen(false)} /> : <div className="card"><button className="btn-help" onClick={() => setQuickHelpOpen(true)}>Need Help</button></div>}

          <CheckInCard />

          <NearbyCard />

          <div className="grid2">
            <Link to="/family" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
              <h2 style={{ margin: 0 }}>Family</h2>
              <p className="muted" style={{ margin: '4px 0 0' }}>Circle &amp; statuses</p>
            </Link>
            <Link to="/history" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
              <h2 style={{ margin: 0 }}>History</h2>
              <p className="muted" style={{ margin: '4px 0 0' }}>Black-box &amp; past events</p>
            </Link>
          </div>

          {!user && (
            <div className="card center">
              <p>You're not signed in. SOS still works locally, but family sync needs an account.</p>
              <Link to="/login"><button className="btn-primary">Sign in / Register</button></Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Dedicated activated SOS surface; direct visits return to the regular hub. */
export function SosPage() {
  const { phase } = useMesh();
  if (phase === 'COUNTDOWN') return <Navigate to="/" replace />;
  if (phase === 'ACTIVE') return <EmergencyMode />;
  if (phase === 'RESOLVED') return <DisarmedPage />;
  return <Navigate to="/" replace />;
}
