import { useEffect, useMemo, useState } from 'react';
import { useMesh } from '../state/MeshContext';
import { useAI } from '../state/AIContext';
import { useStatus } from '../state/StatusContext';
import { findGuidance, guidanceForCategory, EMERGENCY_PROMPT_SUGGESTIONS, type GuidanceTopic, type Severity } from '@iqoo/shared';

const SEVERITY_CLASS: Record<Severity, string> = {
  CRITICAL: 'sev-critical',
  HIGH: 'sev-high',
  MEDIUM: 'sev-medium',
  LOW: 'sev-low',
};

const TOPICS = ['bleeding', 'broken arm', 'burn', 'trapped', 'evacuate'];

function Waveform() {
  return <div className="ai-waveform" aria-hidden="true">{[3, 5, 7, 4, 8, 6, 4, 7, 5, 3, 6, 8, 4, 6].map((height, index) => <i key={index} style={{ height: `${height * 4}px` }} />)}</div>;
}

function Classifier() {
  const ai = useAI();
  const { battery } = useStatus();
  const { startSos } = useMesh();
  const [text, setText] = useState('');

  useEffect(() => {
    if (ai.transcript) setText(ai.transcript);
  }, [ai.transcript]);

  const analyze = () => {
    const trimmed = text.trim();
    if (trimmed) ai.classify(trimmed, { battery });
  };

  return (
    <>
      <section className="ai-engine-banner">
        <div>
          <span className="ai-live-dot" /> LOCAL RULE ENGINE ACTIVE / OFFLINE
        </div>
        <span>NO CLOUD UPLOAD</span>
        <div className="ai-engine-detail"><span>Deterministic emergency classifier</span><strong>TEXT + OPTIONAL VOICE</strong></div>
      </section>

      <section className="card ai-audio-card" aria-label="Optional voice input">
        <div className="ai-section-heading">
          <div>
            <span className="eyebrow">OPTIONAL VOICE INPUT</span>
            <p>Speak a description for local classification</p>
          </div>
          {ai.speechSupported && <button className="btn-secondary ai-action-button" type="button" onClick={() => void ai.startVoice()} disabled={ai.voiceState === 'RECORDING'}>{ai.voiceState === 'RECORDING' ? 'ACTIVE' : 'START'}</button>}
        </div>
        <Waveform />
        <div className="ai-local-note">Microphone starts only after you press START. Audio is not uploaded or stored.</div>
      </section>

      <section className="card ai-transcript-card" data-testid="ai-assistance-classifier">
        <div className="ai-transcript-heading">
          <span className="eyebrow">LIVE SPEECH TRANSCRIPTION</span>
          <span className="ai-streaming">{ai.voiceState === 'RECORDING' ? 'STREAMING' : 'READY'}</span>
        </div>
        <label htmlFor="ai-assistance-text">Emergency description</label>
        <textarea
          id="ai-assistance-text"
          rows={4}
          maxLength={500}
          value={text}
          placeholder="Describe the emergency in your own words"
          onChange={(e) => setText(e.target.value)}
        />
        <div className="ai-classifier-box">
          <div className="ai-transcript-heading">
            <span className="telemetry-label">DIAGNOSTIC CLASSIFIER</span>
            {ai.result && <span className="ai-priority">PRIORITY {ai.result.severity}</span>}
          </div>
          {ai.result ? (
            <>
              <div className="ai-result-title"><strong>{ai.result.category}</strong><span>{Math.round(ai.result.confidence * 100)}%<small> CONF</small></span></div>
              <p className="ai-dispatch-note">Suggested action: {ai.result.recommendedAction}</p>
            </>
          ) : (
            <p className="muted">Waiting for an emergency description.</p>
          )}
        </div>
        <div className="row wrap mt">
          <button className="btn-primary" type="button" onClick={analyze} disabled={!text.trim()}>Analyze on device</button>
          {ai.result && <button className="btn-help" type="button" onClick={() => startSos(text.trim(), ai.result ?? undefined)}>Broadcast triage update via mesh</button>}
          {ai.result && <button className="btn-ghost" type="button" onClick={() => { ai.reset(); setText(''); }}>Clear</button>}
        </div>
        {ai.micError && <p className="error-text mt">{ai.micError}</p>}
        {ai.voiceState === 'UNSUPPORTED' && <p className="muted mt">Voice input is not supported in this browser. Typing works normally.</p>}
        {!ai.result && <details className="mt"><summary className="muted">Use an example</summary><div className="row wrap mt">{EMERGENCY_PROMPT_SUGGESTIONS.slice(0, 5).map((item) => <button key={item} className="chip" type="button" onClick={() => setText(item)}>{item}</button>)}</div></details>}
      </section>
    </>
  );
}

function ProtocolCard({ topic, index }: { topic: GuidanceTopic; index: number }) {
  return (
    <article className="protocol-card">
      <div className={`protocol-visual protocol-visual-${index}`}>
        <span>STEP {String(index + 1).padStart(2, '0')} / FIELD PROTOCOL</span>
        <div className="protocol-grid" aria-hidden="true" />
      </div>
      <div className="protocol-content">
        <div className="ai-section-heading"><h3>{topic.title}</h3><span className="protocol-severity">{index === 0 ? 'CRITICAL HOLD' : 'ACTIVE PROTOCOL'}</span></div>
        <ol>{topic.steps.map((step, stepIndex) => <li key={stepIndex}>{step}</li>)}</ol>
        <p><strong>Escalate:</strong> {topic.escalate}</p>
        <p className="muted small">{topic.disclaimer}</p>
      </div>
    </article>
  );
}

function Guidance() {
  const { result } = useAI();
  const [query, setQuery] = useState('');
  const [manual, setManual] = useState<GuidanceTopic | null>(null);
  const automatic = useMemo(() => guidanceForCategory(result?.category), [result]);
  const topic = manual ?? automatic ?? (query.trim() ? findGuidance(query) : null);

  return (
    <section className="ai-protocols" data-testid="ai-guidance">
      <div className="ai-protocol-heading"><span className="eyebrow">STEP-BY-STEP TACTICAL PROTOCOL</span><span>OFFLINE PROTOCOL / EM-302</span></div>
      <div className="row wrap ai-topic-switcher">{TOPICS.map((item) => <button key={item} className={`chip ${query === item ? 'active' : ''}`} type="button" onClick={() => { setManual(null); setQuery(item); }}>{item}</button>)}</div>
      {topic ? <ProtocolCard topic={topic} index={TOPICS.indexOf(query) >= 0 ? TOPICS.indexOf(query) : 0} /> : <div className="card ai-empty-protocol">Choose an emergency type to load offline first-aid instructions.</div>}
    </section>
  );
}

export default function AIAssistance() {
  return (
    <div className="page ai-assistance-page">
      <div className="ai-page-intro">
        <span className="eyebrow">RESQNET / AI TRIAGE</span>
        <h1>AI assistance</h1>
        <p className="muted">Private, offline-first classification and tactical first-aid guidance.</p>
      </div>
      <Classifier />
      <Guidance />
    </div>
  );
}
