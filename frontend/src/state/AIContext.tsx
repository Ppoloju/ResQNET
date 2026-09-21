// Local AI integration (§14-§17, §16 privacy-first).
// - Classification is 100% on-device (RuleBasedAIEngine from @iqoo/shared).
// - Microphone NEVER starts without an explicit user press (§16), shows a persistent
//   RECORDING indicator while active, and stops automatically after processing.
// - Web Speech API is used only when the browser provides it; otherwise the user
//   types/edits the transcript — voice is optional, classification works from text.

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import { classifyFromText, AI_DISCLAIMER, type AIResult } from '@iqoo/shared';

interface AIState {
  result: AIResult | null;
  disclaimer: string;
  /** Voice capture state machine (§16: no hidden recording ever). */
  voiceState: 'IDLE' | 'RECORDING' | 'PROCESSING' | 'UNSUPPORTED';
  transcript: string;
  micError: string | null;
  speechSupported: boolean;
  startVoice: () => Promise<void>;
  stopVoice: () => void;
  setTranscript: (t: string) => void;
  classify: (text: string, opts?: { saysImmobile?: boolean; battery?: number | null }) => AIResult;
  reset: () => void;
  /** True when the latest result came from an automatic post-speech analysis. */
  autoAnalyzed: boolean;
  /** UI layer reports the current battery so auto-analysis has full inputs. */
  setBatterySource: (level: number | null) => void;
}

const AIContext = createContext<AIState>(null as unknown as AIState);

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onnomatch?: (() => void) | null;
};

function getRecognition(): SpeechRecognitionLike | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export function AIProvider({ children }: { children: ReactNode }) {
  const [result, setResult] = useState<AIResult | null>(null);
  const [voiceState, setVoiceState] = useState<AIState['voiceState']>(
    getRecognition() ? 'IDLE' : 'UNSUPPORTED',
  );
  const [transcript, setTranscript] = useState('');
  const [micError, setMicError] = useState<string | null>(null);
  const [autoAnalyzed, setAutoAnalyzed] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  // Battery level is injected by the UI layer via setBatterySource so the
  // auto-analysis after speech has the same inputs as a manual one.
  const batteryRef = useRef<number | null>(null);

  const speechSupported = voiceState !== 'UNSUPPORTED';

  // Hard cleanup on unmount: never leave a mic open (§16).
  useEffect(() => () => {
    try { recRef.current?.stop(); } catch { /* already stopped */ }
  }, []);

  const stopVoice = useCallback(() => {
    try { recRef.current?.stop(); } catch { /* noop */ }
    recRef.current = null;
    setVoiceState((s) => (s === 'RECORDING' ? 'IDLE' : s));
  }, []);

  /** Battery is provided by the StatusContext consumer once mounted. */
  const setBatterySource = useCallback((level: number | null) => {
    batteryRef.current = level;
  }, []);

  const startVoice = useCallback(async () => {
    if (!speechSupported) return;
    if (recRef.current) return;
    setMicError(null);
    setTranscript('');
    try {
      const rec = getRecognition();
      if (!rec) {
        setVoiceState('UNSUPPORTED');
        setMicError('Voice input is not supported in this browser');
        return;
      }
      recRef.current = rec;
      rec.lang = 'en-US';
      rec.interimResults = true;
      rec.continuous = false;
      rec.onresult = (e) => {
        let text = '';
        for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript + ' ';
        setTranscript(text.trim());
      };
      rec.onerror = (e) => {
        const message = e.error === 'not-allowed'
          ? 'Microphone permission denied. Allow microphone access and try again.'
          : e.error === 'service-not-allowed'
            ? 'Speech recognition is blocked in this browser or by its privacy settings.'
            : e.error === 'audio-capture'
              ? 'No microphone is available. Check your microphone and try again.'
              : `Voice error: ${e.error}`;
        setMicError(message);
        recRef.current = null;
        setVoiceState('IDLE');
      };
      rec.onend = () => {
        recRef.current = null;
        // Speech finished — analyze the captured words automatically so the
        // user does not have to press "Analyze" after speaking (§15 flow).
        setVoiceState((s) => {
          if (s !== 'RECORDING') return s;
          return 'PROCESSING';
        });
      };
      rec.onnomatch = () => setMicError('No speech was recognized. Try speaking closer to the microphone.');
      setVoiceState('RECORDING');
      rec.start();
    } catch (err) {
      recRef.current = null;
      setVoiceState('IDLE');
      setMicError(err instanceof Error && (err.name === 'NotAllowedError' || err.name === 'SecurityError')
        ? 'Microphone permission was denied or voice input requires a secure connection (HTTPS).' 
        : err instanceof Error ? err.message : 'Microphone unavailable');
    }
  }, [speechSupported]);

  const classify = useCallback((
    text: string,
    opts?: { saysImmobile?: boolean; battery?: number | null; auto?: boolean },
  ): AIResult => {
    const trimmed = text.trim();
    if (!trimmed) {
      // Nothing captured — return to idle without inventing a result.
      setVoiceState((s) => (s === 'PROCESSING' ? 'IDLE' : s));
      setAutoAnalyzed(false);
      return classifyFromText({ text: '', battery: null });
    }
    const r = classifyFromText({
      text: trimmed,
      saysImmobile: opts?.saysImmobile,
      battery: opts?.battery ?? null,
    });
    setResult(r);
    setAutoAnalyzed(!!opts?.auto);
    setVoiceState((s) => (s === 'PROCESSING' ? 'IDLE' : s));
    return r;
  }, []);

  // When speech ends (PROCESSING), run the classifier once on the transcript.
  useEffect(() => {
    if (voiceState !== 'PROCESSING') return;
    const t = setTimeout(() => {
      classify(transcript, { battery: batteryRef.current, auto: true });
    }, 250); // small pause feels like the device "thinking"
    return () => clearTimeout(t);
  }, [voiceState, transcript, classify]);

  const reset = useCallback(() => {
    setResult(null);
    setTranscript('');
    setAutoAnalyzed(false);
    setVoiceState(getRecognition() ? 'IDLE' : 'UNSUPPORTED');
    setMicError(null);
  }, []);

  const value = useMemo<AIState>(() => ({
    result, disclaimer: AI_DISCLAIMER, voiceState, transcript, micError, speechSupported,
    startVoice, stopVoice, setTranscript, classify, reset, autoAnalyzed, setBatterySource,
  }), [result, voiceState, transcript, micError, speechSupported, startVoice, stopVoice, classify, reset, autoAnalyzed, setBatterySource]);

  return <AIContext.Provider value={value}>{children}</AIContext.Provider>;
}

export function useAI(): AIState {
  return useContext(AIContext);
}
