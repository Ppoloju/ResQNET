import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

interface StatusState {
  online: boolean;
  battery: number | null;
  charging: boolean | null;
}

const StatusContext = createContext<StatusState>({ online: navigator.onLine, battery: null, charging: null });

/**
 * Real connectivity + power state (§44, §29).
 * navigator.onLine reflects the OS network stack (not end-to-end reachability);
 * the backend /healthz probe refines it while online.
 */
export function StatusProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StatusState>({
    online: navigator.onLine,
    battery: null,
    charging: null,
  });

  useEffect(() => {
    const onOnline = () => setState((s) => ({ ...s, online: true }));
    const onOffline = () => setState((s) => ({ ...s, online: false }));
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    let batteryInterval: ReturnType<typeof setInterval> | undefined;
    type BatteryLike = { level: number; charging: boolean; addEventListener?: (t: string, cb: () => void) => void };
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
    if (nav.getBattery) {
      nav.getBattery().then((b) => {
        const update = () => setState((s) => ({ ...s, battery: Math.round(b.level * 100), charging: b.charging }));
        update();
        b.addEventListener?.('levelchange', update);
        b.addEventListener?.('chargingchange', update);
      }).catch(() => { /* battery API unavailable (Firefox/Safari) — battery stays null */ });
    } else {
      // No Battery API: surface null so the UI never fabricates a value.
      batteryInterval = undefined;
    }
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      if (batteryInterval) clearInterval(batteryInterval);
    };
  }, []);

  return <StatusContext.Provider value={state}>{children}</StatusContext.Provider>;
}

export function useStatus(): StatusState {
  return useContext(StatusContext);
}
