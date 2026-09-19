// Realtime push over Server-Sent Events (§5 remainder: InternetTransport live layer).
// Free, dependency-free, unidirectional (server → client) — exactly what emergency
// status pushes need. Mesh/broadcast events are fanned out to all connected clients.

import type { Request, Response } from 'express';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { logger } from '../logger.js';

export const realtimeRouter = Router();

type Client = (event: string, data: unknown) => void;
const clients = new Set<Client>();

/** Fan-out to every connected SSE client; safe to call from any route. */
export function broadcastEvent(event: string, data: unknown): void {
  for (const send of clients) {
    try { send(event, data); } catch { /* dropped client; cleaned up on close */ }
  }
}

/** Connected-client count (used by /auth/me/live and logs). */
export function clientCount(): number {
  return clients.size;
}

realtimeRouter.get('/stream', (req: Request, res: Response) => {
  // Live emergency feed — public safety information, so the stream is open to
  // every device (a phone with no account must still SEE emergencies).
  // EventSource cannot set headers — accept the JWT as ?token= when present
  // (documented in docs/api-contract.md); identity-gated events stay auth-only.
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7)
    : typeof req.query.token === 'string' ? req.query.token : undefined;
  if (token) {
    try { jwt.verify(token, config.jwtSecret); } catch {
      res.status(401).json({ error: 'invalid or expired token' });
      return;
    }
  }
  res.set({
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.flushHeaders?.();

  const send: Client = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  clients.add(send);
  send('hello', { ok: true, ts: Date.now() });

  // Comment lines as heartbeat — keeps proxies from idling the connection out.
  const heartbeat = setInterval(() => res.write(`: ping ${Date.now()}\n\n`), 15_000);
  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(send);
    logger.info({ clients: clients.size }, 'sse client disconnected');
  });
  logger.info({ clients: clients.size }, 'sse client connected');
});
