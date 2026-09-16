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
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const speechSupported = voiceState !== 'UNSUPPORTED';

  // Hard cleanup on unmount: never leave a mic open (§16).
  useEffect(() => () => {
    try { recRef.current?.stop(); } catch { /* already stopped */ }
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const stopVoice = useCallback(() => {
    try { recRef.current?.stop(); } catch { /* noop */ }
    recRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setVoiceState((s) => (s === 'RECORDING' ? 'PROCESSING' : s));
  }, []);

  const startVoice = useCallback(async () => {
    if (!speechSupported) return;
    setMicError(null);
    setTranscript('');
    try {
      // 1) Explicit mic permission — the user pressed the button (§16).
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      // 2) Persistent visible indicator becomes active via voiceState=RECORDING.
      setVoiceState('RECORDING');
      const rec = getRecognition();
      if (!rec) {
        // Mic granted but no speech engine — fall back to typed text.
        setVoiceState('UNSUPPORTED');
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        return;
      }
      recRef.current = rec;
      rec.lang = 'en-US';
      rec.interimResults = false;
      rec.continuous = false;
      rec.onresult = (e) => {
        let text = '';
        for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript + ' ';
        setTranscript(text.trim());
      };
      rec.onerror = (e) => {
        setMicError(e.error === 'not-allowed' ? 'Microphone permission denied' : `Voice error: ${e.error}`);
      };
      rec.onend = () => {
        // Auto-stop (§16): indicator clears as soon as processing begins.
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        recRef.current = null;
        setVoiceState((s) => (s === 'RECORDING' ? 'PROCESSING' : s));
      };
      rec.start();
    } catch (err) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setVoiceState('IDLE');
      setMicError(err instanceof Error && err.name === 'NotAllowedError'
        ? 'Microphone permission denied'
        : 'Microphone unavailable');
    }
  }, [speechSupported]);

  const classify = useCallback((
    text: string,
    opts?: { saysImmobile?: boolean; battery?: number | null },
  ): AIResult => {
    const r = classifyFromText({
      text,
      saysImmobile: opts?.saysImmobile,
      battery: opts?.battery ?? null,
    });
    setResult(r);
    setVoiceState((s) => (s === 'PROCESSING' ? 'IDLE' : s));
    return r;
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setTranscript('');
    setVoiceState(getRecognition() ? 'IDLE' : 'UNSUPPORTED');
    setMicError(null);
  }, []);

  const value = useMemo<AIState>(() => ({
    result, disclaimer: AI_DISCLAIMER, voiceState, transcript, micError, speechSupported,
    startVoice, stopVoice, setTranscript, classify, reset,
  }), [result, voiceState, transcript, micError, speechSupported, startVoice, stopVoice, classify, reset]);

  return <AIContext.Provider value={value}>{children}</AIContext.Provider>;
}

export function useAI(): AIState {
  return useContext(AIContext);
}
