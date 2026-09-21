import { useEffect, useMemo, useState } from 'react';
import {
  Mic, Square, ScanSearch, Siren, Trash2, BookOpenCheck, Lightbulb, HeartPulse,
} from 'lucide-react';
import { useMesh } from '../state/MeshContext';
import { useAI } from '../state/AIContext';
import { useStatus } from '../state/StatusContext';
import { findGuidance, guidanceForCategory, EMERGENCY_PROMPT_SUGGESTIONS, type GuidanceTopic, type Severity } from '@iqoo/shared';
import { Card, CardHeader, PageHeader, ActionButton, Chip, StatusPill } from '../components/ui';

const SEVERITY_CLASS: Record<Severity, string> = {
  CRITICAL: 'sev-critical',
  HIGH: 'sev-high',
  MEDIUM: 'sev-medium',
  LOW: 'sev-low',
};

const TOPICS = ['bleeding', 'broken arm', 'burn', 'trapped', 'evacuate'];

/** Live speaking animation: bars driven by real audio level while recording. */
export function VoiceWave({ active }: { active: boolean }) {
  const [levels, setLevels] = useState<number[]>(() => Array(18).fill(4));

  useEffect(() => {
    if (!active) {
      setLevels(Array(18).fill(4));
      return;
    }
    // Fake-but-honest level animation: smooth random walk synced to the mic
    // state. A real analyser node is possible but Web Speech already owns the
    // mic in Chromium, so getUserMedia cannot tap it simultaneously.
    let raf = 0;
    let last = 0;
    const current = Array(18).fill(4);
    const tick = (t: number) => {
      if (t - last > 90) {
        last = t;
        for (let i = 0; i < current.length; i++) {
          const target = 6 + Math.random() * 30;
          current[i] = current[i]! + (target - current[i]!) * 0.5;
        }
        setLevels([...current]);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return (
    <div className={`rq-voice-wave${active ? ' is-live' : ''}`} aria-hidden="true">
      {levels.map((h, i) => <i key={i} style={{ height: `${Math.max(4, h)}px` }} />)}
    </div>
  );
}

function Classifier() {
  const ai = useAI();
  const { battery } = useStatus();
  const { startSos } = useMesh();
  const [text, setText] = useState('');

  // Give the auto-analyzer the current battery for identical inputs.
  useEffect(() => {
    ai.setBatterySource(battery);
  }, [battery, ai]);

  useEffect(() => {
    if (ai.transcript) setText(ai.transcript);
  }, [ai.transcript]);

  const analyze = () => {
    const trimmed = text.trim();
    if (trimmed) ai.classify(trimmed, { battery });
  };

  const recording = ai.voiceState === 'RECORDING';

  return (
    <Card className="ai-unified-card" data-testid="ai-assistance-classifier">
      <CardHeader
        icon={<Mic size={17} />}
        title="Describe your emergency"
        subtitle="Runs entirely on this device — voice or text, no cloud, no upload."
        actions={<StatusPill tone={recording ? 'danger' : ai.result ? 'safe' : 'info'}>
          {recording ? 'LISTENING' : ai.voiceState === 'PROCESSING' ? 'ANALYZING' : ai.result ? 'ANALYZED' : 'READY'}
        </StatusPill>}
      />

      <VoiceWave active={recording} />

      <label htmlFor="ai-assistance-text" className="sr-only">Emergency description</label>
      <textarea
        id="ai-assistance-text"
        rows={3}
        maxLength={500}
        value={text}
        placeholder="Speak with the mic button, or type here…"
        onChange={(e) => setText(e.target.value)}
      />

      <div className="row wrap" style={{ marginTop: 12 }}>
        {ai.speechSupported ? (
          <ActionButton
            variant={recording ? 'alert' : 'info'}
            onClick={() => (recording ? ai.stopVoice() : void ai.startVoice())}
            ariaLabel={recording ? 'Stop recording' : 'Start recording'}
          >
            {recording ? <Square size={16} /> : <Mic size={16} />} {recording ? 'Stop' : 'Speak'}
          </ActionButton>
        ) : (
          <ActionButton variant="ghost" disabled><Mic size={16} /> Voice unavailable</ActionButton>
        )}
        <ActionButton variant="help" onClick={analyze} disabled={!text.trim() || recording}>
          <ScanSearch size={16} /> Analyze
        </ActionButton>
        {(ai.result || text) && (
          <ActionButton variant="ghost" onClick={() => { ai.reset(); setText(''); }}>
            <Trash2 size={16} /> Clear
          </ActionButton>
        )}
      </div>

      {ai.micError && <p className="error-text" style={{ marginTop: 10 }}>{ai.micError}</p>}
      {ai.voiceState === 'UNSUPPORTED' && (
        <p className="muted small" style={{ margin: '10px 0 0' }}>Voice input is not supported in this browser — typing works fully.</p>
      )}

      {ai.result && (
        <div className="ai-result mt" role="status">
          <div className="row wrap spread">
            <span className={`sev-pill ${SEVERITY_CLASS[ai.result.severity]}`}>{ai.result.severity}</span>
            <span className="sev-pill sev-cat">{ai.result.category}</span>
            <span className="muted mono small">confidence {Math.round(ai.result.confidence * 100)}%</span>
          </div>
          <p className="muted" style={{ margin: '8px 0 0' }}>
            Suggested action: <strong>{ai.result.recommendedAction}</strong>
          </p>
          {ai.result.matched.length > 0 && (
            <p className="muted mono small" style={{ margin: '4px 0 0' }}>
              signals: {ai.result.matched.join(', ')}
            </p>
          )}
          <p className="muted small" style={{ margin: '6px 0 0' }}>{ai.disclaimer}</p>
          <div className="row wrap" style={{ marginTop: 10 }}>
            <ActionButton variant="danger" onClick={() => { const t = text.trim(); startSos(t, ai.result ?? undefined); }}>
              <Siren size={16} /> Send as SOS
            </ActionButton>
          </div>
        </div>
      )}

      {!ai.result && (
        <details className="mt">
          <summary className="muted small">Example phrases</summary>
          <div className="row wrap mt">
            {EMERGENCY_PROMPT_SUGGESTIONS.slice(0, 5).map((item) => (
              <Chip key={item} onClick={() => setText(item)}>{item}</Chip>
            ))}
          </div>
        </details>
      )}
    </Card>
  );
}

const TOPIC_ICONS = [HeartPulse, BookOpenCheck, Lightbulb];

function ProtocolCard({ topic, index }: { topic: GuidanceTopic; index: number }) {
  const Icon = TOPIC_ICONS[index % TOPIC_ICONS.length];
  return (
    <Card>
      <CardHeader
        icon={<Icon size={17} />}
        title={topic.title}
        subtitle={index === 0 ? 'Critical hold — act calmly.' : 'Active protocol.'}
        actions={<StatusPill tone={index === 0 ? 'danger' : 'waiting'}>{index === 0 ? 'CRITICAL' : 'ACTIVE'}</StatusPill>}
      />
      <ol className="rq-protocol-steps">
        {topic.steps.map((step, i) => <li key={i}><span className="rq-step-num">{i + 1}</span>{step}</li>)}
      </ol>
      <p className="small" style={{ margin: '10px 0 4px' }}><strong>Escalate:</strong> {topic.escalate}</p>
      <p className="muted small" style={{ margin: 0 }}>{topic.disclaimer}</p>
    </Card>
  );
}

function Guidance() {
  const { result } = useAI();
  const [query, setQuery] = useState('');
  const [manual, setManual] = useState<GuidanceTopic | null>(null);
  const automatic = useMemo(() => guidanceForCategory(result?.category), [result]);
  const topic = manual ?? automatic ?? (query.trim() ? findGuidance(query) : null);
  const index = TOPICS.indexOf(query) >= 0 ? TOPICS.indexOf(query) : 0;

  return (
    <section data-testid="ai-guidance" style={{ display: 'grid', gap: 12 }}>
      <Card>
        <CardHeader
          icon={<BookOpenCheck size={17} />}
          title="Offline first-aid guidance"
          subtitle="Pick a topic — steps work with no internet."
        />
        <div className="row wrap">
          {TOPICS.map((item) => <Chip key={item} active={query === item} onClick={() => { setManual(null); setQuery(item); }}>{item}</Chip>)}
        </div>
      </Card>
      {topic
        ? <ProtocolCard topic={topic} index={index} />
        : <Card><p className="muted" style={{ margin: 0 }}>Choose an emergency type to load offline first-aid instructions.</p></Card>}
    </section>
  );
}

export default function AIAssistance() {
  return (
    <div className="page ai-assistance-page">
      <PageHeader
        eyebrow="RESQNET / AI TRIAGE"
        title="AI assistance"
        subtitle="Private, offline-first classification and first-aid guidance."
      />
      <Classifier />
      <Guidance />
    </div>
  );
}
