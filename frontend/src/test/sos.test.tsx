import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, act, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Home, { SosPage } from '../pages/Home';
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
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/sos" element={<SosPage />} />
              </Routes>
            </AIProvider>
          </MeshProvider>
        </StatusProvider>
      </SessionProvider>
    </MemoryRouter>,
  );
}

async function hold(button: HTMLElement, durationMs = 3100) {
  fireEvent.pointerDown(button);
  await act(async () => { vi.advanceTimersByTime(durationMs); });
  fireEvent.pointerUp(button);
}

describe('SOS flow', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.dispatchEvent(new Event('online'));
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'vibrate');
  });

  it('requires a three-second hold before activating SOS', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderHome();
      const sos = await screen.findByRole('button', { name: /hold for three seconds to activate sos/i });
      fireEvent.pointerDown(sos);
      await act(async () => { vi.advanceTimersByTime(400); });
      expect(screen.getByText('HOLD TO ACTIVATE')).toBeInTheDocument();
      fireEvent.pointerUp(sos);
      expect(screen.getByRole('button', { name: /hold for three seconds to activate sos/i })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('activates after the three-second hold (offline -> queued)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
    try {
      renderHome();
      await act(async () => { window.dispatchEvent(new Event('offline')); });
      await hold(screen.getByRole('button', { name: /hold for three seconds to activate sos/i }));

      expect(screen.getByText('SOS ACTIVE')).toBeInTheDocument();
      expect(vibrate).toHaveBeenCalledWith([120, 60, 180]);
      const eid = document.querySelector('.eid');
      expect(eid?.textContent).toMatch(/^RQ-[A-Z2-9]{8}$/);
      expect(screen.getAllByText('OFFLINE').length).toBeGreaterThan(0);
      expect(screen.getByText(/Held \(offline\)/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /hold for three seconds to resolve/i })).toBeInTheDocument();

      const box = JSON.parse(localStorage.getItem('resqnet.outbox') ?? '[]') as Array<{ event: { id: string } }>;
      expect(box).toHaveLength(1);
      expect(box[0].event.id).toMatch(/^RQ-/);
    } finally {
      Reflect.deleteProperty(navigator, 'vibrate');
      vi.useRealTimers();
    }
  });

  it('resolves after a three-second hold and returns home (offline resolution path)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderHome();
      await act(async () => { window.dispatchEvent(new Event('offline')); });
      await hold(screen.getByRole('button', { name: /hold for three seconds to activate sos/i }));
      await hold(screen.getByRole('button', { name: /hold for three seconds to resolve/i }));

      expect(screen.getByText('SOS DISARMED')).toBeInTheDocument();
      await act(async () => { await Promise.resolve(); });
      expect(screen.getByRole('button', { name: /return to sos hub/i })).toBeInTheDocument();
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /return to sos hub/i })); });
      expect(screen.getByRole('button', { name: /hold for three seconds to activate sos/i })).toBeInTheDocument();
      expect(JSON.parse(localStorage.getItem('resqnet.activeEmergency') ?? 'null')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('drains the outbox when connectivity returns (offline -> online sync)', async () => {
    const pushCalls: Array<{ body: { events: Array<{ id: string }> } }> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { events?: Array<{ id: string }> };
      if (init?.method === 'POST' && String(_url).includes('/sync/push')) {
        pushCalls.push({ body: body as { events: Array<{ id: string }> } });
        return new Response(JSON.stringify({ ackedEventIds: body.events?.map((event) => event.id) ?? [] }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as unknown as typeof fetch);

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
      renderHome();
      await act(async () => { window.dispatchEvent(new Event('offline')); });
      await hold(screen.getByRole('button', { name: /hold for three seconds to activate sos/i }));
      await act(async () => { await Promise.resolve(); });
      expect(JSON.parse(localStorage.getItem('resqnet.outbox') ?? '[]')).toHaveLength(1);

      await act(async () => { window.dispatchEvent(new Event('online')); });
      await act(async () => { vi.advanceTimersByTime(1000); });
      expect(pushCalls.length).toBe(1);
      expect(JSON.parse(localStorage.getItem('resqnet.outbox') ?? '[]')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
