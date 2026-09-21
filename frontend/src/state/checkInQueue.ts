import { apiFetch } from './SessionContext';

export interface QueuedCheckIn {
  id: string;
  status: 'SAFE' | 'AT_RISK' | 'NEEDS_HELP';
  note?: string;
  createdAt: string;
}

const KEY = 'iqoo.checkInOutbox';

function read(): QueuedCheckIn[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed as QueuedCheckIn[] : [];
  } catch { return []; }
}

function write(items: QueuedCheckIn[]): void {
  localStorage.setItem(KEY, JSON.stringify(items));
}

export function queueCheckIn(item: Omit<QueuedCheckIn, 'id' | 'createdAt'>): QueuedCheckIn {
  const queued = { ...item, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
  write([...read(), queued]);
  return queued;
}

export function queuedCheckInCount(): number {
  return read().length;
}

export async function drainCheckIns(): Promise<number> {
  const pending = read();
  if (pending.length === 0) return 0;
  const remaining: QueuedCheckIn[] = [];
  let synced = 0;
  for (const item of pending) {
    try {
      await apiFetch('/check-ins', { method: 'POST', body: JSON.stringify({
        checkInId: item.id, status: item.status, note: item.note, createdAt: item.createdAt,
      }) });
      synced += 1;
    } catch { remaining.push(item); }
  }
  write(remaining);
  return synced;
}
