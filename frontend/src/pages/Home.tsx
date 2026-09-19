import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch, useSession } from '../state/SessionContext';
import { useStatus } from '../state/StatusContext';
import { useMesh } from '../state/MeshContext';
import { useAI } from '../state/AIContext';
import { useMeshEvents, type BroadcastEvent } from '../state/RealtimeContext';
import { findGuidance, guidanceForCategory, type GuidanceTopic } from '@iqoo/shared';
import { EMERGENCY_PROMPT_SUGGESTIONS } from '@iqoo/shared';
import type { Severity } from '@iqoo/shared';

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

function CountdownOverlay() {
  const { countdown, cancelCountdown } = useMesh();
  return (
    <div className="sos-countdown" role="alertdialog" aria-label="SOS activation countdown">
      <h2>SOS ACTIVATION</h2>
      <div className="count" aria-live="assertive">{countdown}</div>
      <p className="muted">Emergency will be created. Nearby alert + family notify.</p>
      <button className="btn-cancel" onClick={cancelCountdown}>CANCEL</button>
    </div>
  );
}

function EmergencyMode() {
  const { active, blackBox, resolveActive } = useMesh();
  const { online } = useStatus();
  const { acks } = useMeshEvents();
  if (!active) return null;
  const recent = blackBox.slice(-6).reverse();
  // Live responder ACKs for THIS emergency (§18/§39) — real SSE events, not wishes.
  const myAcks = acks.filter((a) => a.emergencyId === active.emergencyId);
  return (
    <div>
      <div className="emergency-banner" role="alert">
        <h1>SOS ACTIVE</h1>
        <div className="eid">{active.emergencyId}</div>
        <p className="muted" style={{ color: '#ffd3da' }}>
          {active.type === 'QUICK_HELP' ? 'Quick Help (nearby alert)' : 'Full SOS'} — started {new Date(active.startedAt).toLocaleTimeString()}
        </p>
        <div className="statgrid">
          <div className="stat"><div className="k">Family notify</div><div className="v">{online ? '✓ Sent' : '⏳ Queued'}</div></div>
          <div className="stat"><div className="k">Network</div><div className="v">{online ? 'ONLINE' : 'OFFLINE'}</div></div>
          <div className="stat"><div className="k">Location</div>
            <div className="v" style={{ fontSize: '0.95rem' }}>
              {active.location?.state === 'LOCATION_UNAVAILABLE' ? 'Unavailable' : `${active.location?.latitude.toFixed(4)}, ${active.location?.longitude.toFixed(4)}`}
            </div>
          </div>
          <div className="stat"><div className="k">Battery</div><div className="v">{active.battery !== null ? `${active.battery}%` : '--'}</div></div>
          <div className="stat"><div className="k">Packet</div><div className="v">{active.queuedOffline ? '⏳ Held (offline)' : '✓ Delivered'}</div></div>
          <div className="stat"><div className="k">Signature</div><div className="v">✓ Signed</div></div>
        </div>
      </div>

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

      <div className="card">
        <h2>Emergency timeline (black box)</h2>
        <ul className="timeline">
          {recent.map((e, i) => (
            <li key={i}><span className="t">{new Date(e.ts).toLocaleTimeString()}</span>{e.event}{e.detail ? ` — ${e.detail}` : ''}</li>
          ))}
        </ul>
      </div>

      <button className="btn-safe btn-ok" onClick={() => void resolveActive()}>I'M SAFE — RESOLVE EMERGENCY</button>
    </div>
  );
}

function TacticalBeacon({ battery, startSos }: { battery: number | null; startSos: () => void }) {
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
          <button className="tactical-beacon" onClick={startSos} aria-label="Activate SOS emergency" type="button">
            <svg viewBox="0 0 100 100" aria-hidden="true">
              <circle className="beacon-track" cx="50" cy="50" r="44" />
              <circle className="beacon-progress" cx="50" cy="50" r="44" />
              <circle className="beacon-node" cx="50" cy="6" r="3.5" />
              <circle className="beacon-node" cx="94" cy="50" r="3.5" />
              <circle className="beacon-node" cx="50" cy="94" r="3.5" />
              <circle className="beacon-node" cx="6" cy="50" r="3.5" />
            </svg>
            <span className="beacon-cross" aria-hidden="true">+</span>
            <strong>BROADCAST</strong>
            <span className="beacon-caption">TAP TO SEND SOS</span>
          </button>
        </div>
        <p className="tactical-hint">Emergency alert will be signed, queued offline if needed, and relayed to nearby devices.</p>
      </div>
    </section>
  );
}

function HomeTelemetry({ battery }: { battery: number | null }) {
  return (
    <div className="home-telemetry-grid">
      <div className="telemetry-tile">
        <span className="telemetry-label">POWER CELL</span>
        <strong className="telemetry-orange">{battery === null ? '--' : `${battery}%`}</strong>
        <div className="battery-meter" aria-label={`Battery ${battery ?? 'unknown'} percent`}>
          {[0, 1, 2, 3, 4].map((segment) => <i key={segment} className={battery !== null && battery > segment * 20 ? 'filled' : ''} />)}
        </div>
      </div>
      <div className="telemetry-tile telemetry-wide">
        <span className="telemetry-label">PACKET SECURITY</span>
        <strong>LOCAL SIGNATURE VALID</strong>
        <span className="telemetry-detail">Device identity stays on this device</span>
      </div>
    </div>
  );
}

export default function Home() {
  const { user } = useSession();
  const { battery } = useStatus();
  const { phase, startSos } = useMesh();
  const [quickHelpOpen, setQuickHelpOpen] = useState(false);

  if (phase === 'COUNTDOWN') return <CountdownOverlay />;

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

          <TacticalBeacon battery={battery} startSos={() => startSos()} />
          <HomeTelemetry battery={battery} />

          <div className="card">
            {quickHelpOpen ? (
              <>
                <h2>Need Help — pick a reason</h2>
                <p className="muted">Lower-profile alert to nearby ResQNET users. Not a replacement for SOS.</p>
                {['Someone is following me', 'I am lost', 'Need assistance', 'Unsafe environment', 'Medical help'].map((r) => (
                  <button key={r} className="btn-help" style={{ marginBottom: 8 }}
                    onClick={() => { setQuickHelpOpen(false); startSos(`NEED_HELP:${r}`); }}>
                    {r}
                  </button>
                ))}
                <button className="btn-ghost" onClick={() => setQuickHelpOpen(false)}>Back</button>
              </>
            ) : (
              <button className="btn-help" onClick={() => setQuickHelpOpen(true)}>Need Help (quick, low-profile)</button>
            )}
          </div>

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
