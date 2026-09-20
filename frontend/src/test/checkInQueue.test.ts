import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { drainCheckIns, queueCheckIn, queuedCheckInCount } from '../state/checkInQueue';

const fetchMock = vi.fn();

describe('offline check-in queue', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('queues and drains a check-in exactly once', async () => {
    const queued = queueCheckIn({ status: 'SAFE', note: 'offline' });
    expect(queuedCheckInCount()).toBe(1);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 201 }));
    expect(await drainCheckIns()).toBe(1);
    expect(queuedCheckInCount()).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/check-ins'), expect.objectContaining({ method: 'POST' }));
  });

  it('keeps failed items queued', async () => {
    queueCheckIn({ status: 'AT_RISK' });
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(await drainCheckIns()).toBe(0);
    expect(queuedCheckInCount()).toBe(1);
  });
});
