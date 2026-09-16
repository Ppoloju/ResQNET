// Live push subscription (InternetTransport receive path, §35).
// Server-Sent Events with the JWT in the query string (EventSource can't set headers).
// Reconnects automatically; exposes the last event of each kind the UI cares about.

import { useEffect, useRef, useState } from 'react';
import { API_BASE } from './SessionContext';

export interface MeshEvent {
  id: string;
  emergencyId: string;
  type: string;
  priority?: string;
  severity?: string;
  from?: string;
  to?: string;
  hopCount?: number;
  ts: number;
}

export interface ResponderAckEvent {
  emergencyId: string;
  ack: { id: string; responder_name: string; created_at: string; note?: string | null };
}

export interface BroadcastEvent {
  id: string;
  mode: string;
  message: string;
  priority: string;
  createdAt: string;
  expiresAt: string;
}

type Handler = (data: unknown) => void;

export function useRealtime(handlers: Record<string, Handler> = {}) {
  const [connected, setConnected] = useState(false);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const token = localStorage.getItem('iqoo.token');
    if (!token) return; // SSE requires auth; logged-out demo devices don't subscribe
    if (typeof EventSource === 'undefined') return; // e.g. jsdom test environment

    const es = new EventSource(`${API_BASE}/realtime/stream?token=${encodeURIComponent(token)}`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false); // EventSource retries automatically

    const mapped: Record<string, EventListener> = {};
    for (const [name, handler] of Object.entries(handlersRef.current)) {
      const listener: EventListener = (ev) => {
        try {
          const msg = ev as MessageEvent;
          handler(JSON.parse(msg.data as string));
        } catch { /* malformed event — skip */ }
      };
      es.addEventListener(name, listener);
      mapped[name] = listener;
    }

    return () => {
      for (const [name, listener] of Object.entries(mapped)) es.removeEventListener(name, listener);
      es.close();
    };
    // Handlers are kept in a ref so identity changes don't tear down the stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { connected };
}

/** App-wide mesh event feed (Network page, black-box enrichment, demo mode). */
export function useMeshEvents() {
  const [events, setEvents] = useState<MeshEvent[]>([]);
  const [acks, setAcks] = useState<ResponderAckEvent[]>([]);
  const [broadcast, setBroadcast] = useState<BroadcastEvent | null>(null);

  const { connected } = useRealtime({
    mesh_event: (data) => setEvents((e) => [...e, data as MeshEvent].slice(-100)),
    responder_ack: (data) => setAcks((a) => [...a, data as ResponderAckEvent].slice(-50)),
    disaster_broadcast: (data) => setBroadcast(data as BroadcastEvent),
  });

  const clearBroadcast = () => setBroadcast(null);
  return { events, acks, broadcast, clearBroadcast, connected };
}
