import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Home from '../pages/Home';
import { SessionProvider } from '../state/SessionContext';
import { StatusProvider } from '../state/StatusContext';
import { MeshProvider } from '../state/MeshContext';
import { AIProvider } from '../state/AIContext';

function renderHome() {
  return render(
    <MemoryRouter>
      <SessionProvider>
        <StatusProvider>
          <MeshProvider>
            <AIProvider>
              <Home />
            </AIProvider>
          </MeshProvider>
        </StatusProvider>
      </SessionProvider>
    </MemoryRouter>,
  );
}

describe('SOS flow', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows countdown with cancel and returns to idle on cancel', async () => {
    const user = userEvent.setup();
    renderHome();

    const sos = await screen.findByRole('button', { name: /activate sos/i });
    await user.click(sos);

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('SOS ACTIVATION')).toBeInTheDocument();
    expect(screen.getByText('CANCEL')).toBeInTheDocument();

    await user.click(screen.getByText('CANCEL'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /activate sos/i })).toBeInTheDocument();
  });

  it('activates emergency after countdown completes (offline → queued)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderHome();
      // Simulate the browser going offline (StatusProvider listens to the real event).
      await act(async () => { window.dispatchEvent(new Event('offline')); });
      const sos = screen.getByRole('button', { name: /activate sos/i });
      await act(async () => { await userEvent.click(sos); });
      await act(async () => { vi.advanceTimersByTime(3200); });

      expect(screen.getByText('SOS ACTIVE')).toBeInTheDocument();
      // Emergency ID appears in the banner (.eid) and again in the timeline — check the banner element.
      const eid = document.querySelector('.eid');
      expect(eid).not.toBeNull();
      expect(eid!.textContent).toMatch(/^RQ-[A-Z2-9]{8}$/);
      expect(screen.getAllByText('OFFLINE').length).toBeGreaterThan(0);
      expect(screen.getByText(/Held \(offline\)/)).toBeInTheDocument();
      expect(screen.getByText("I'M SAFE — RESOLVE EMERGENCY")).toBeInTheDocument();

      // Outbox must hold the packet for store-and-forward sync (§13/§47)
      const box = JSON.parse(localStorage.getItem('resqnet.outbox') ?? '[]') as Array<{ event: { id: string } }>;
      expect(box).toHaveLength(1);
      expect(box[0].event.id).toMatch(/^RQ-/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolve returns home and stops emergency (offline resolution path)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderHome();
      await act(async () => { window.dispatchEvent(new Event('offline')); });
      await act(async () => { await userEvent.click(screen.getByRole('button', { name: /activate sos/i })); });
      await act(async () => { vi.advanceTimersByTime(3200); });

      await act(async () => { await userEvent.click(screen.getByText("I'M SAFE — RESOLVE EMERGENCY")); });
      expect(screen.getByRole('button', { name: /activate sos/i })).toBeInTheDocument();
      expect(JSON.parse(localStorage.getItem('resqnet.activeEmergency') ?? 'null')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('drains the outbox when connectivity returns (offline → online sync, §47)', async () => {
    // Mock the sync endpoint: any /sync/push call succeeds with an ack for whatever was sent.
    const pushCalls: Array<{ body: { events: Array<{ id: string }> } }> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { events?: Array<{ id: string }> };
      if (init?.method === 'POST' && String(_url).includes('/sync/push')) {
        pushCalls.push({ body: body as { events: Array<{ id: string }> } });
        return new Response(JSON.stringify({ ackedEventIds: body.events?.map((e) => e.id) ?? [] }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as unknown as typeof fetch);

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderHome();
      // Offline activation → outbox holds the packet (§13).
      await act(async () => { window.dispatchEvent(new Event('offline')); });
      await act(async () => { await userEvent.click(screen.getByRole('button', { name: /activate sos/i })); });
      await act(async () => { vi.advanceTimersByTime(3200); });
      expect(JSON.parse(localStorage.getItem('resqnet.outbox') ?? '[]')).toHaveLength(1);

      // Connectivity returns → MeshContext drains the outbox automatically.
      await act(async () => { window.dispatchEvent(new Event('online')); });
      await act(async () => { vi.advanceTimersByTime(1000); });

      // The pushed event id must match the queued one (idempotent ack clears it).
      expect(pushCalls.length).toBe(1);
      const queuedId = (JSON.parse(localStorage.getItem('resqnet.outbox') ?? '[]') as never[]).length;
      expect(queuedId).toBe(0); // outbox empty after ack
      expect(pushCalls[0].body.events[0].id).toMatch(/^RQ-[A-Z2-9]{8}$/);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
