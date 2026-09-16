// App settings (§29/§37/§59): persisted locally, no account needed.
// Relay thresholds mirror the engine tiers but remain user-configurable per
// §29 ("Make this configurable"); they feed Relay Readiness and the Network UI.

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export interface IqooSettings {
  /** Consent to relay other people's emergency packets (§37). */
  relayConsent: boolean;
  /** Low-power mode: relay only CRITICAL regardless of battery (§29). */
  lowPowerMode: boolean;
  /** BLE/discovery scan interval in seconds (prototype knob [P]). */
  scanIntervalSec: number;
  /** Battery below this → CRITICAL-only relay. */
  criticalThresholdPct: number;
  /** Battery at/above this → normal relay. Between → reduced. */
  normalThresholdPct: number;
}

const DEFAULTS: IqooSettings = {
  relayConsent: true,
  lowPowerMode: false,
  scanIntervalSec: 30,
  criticalThresholdPct: 20,
  normalThresholdPct: 50,
};

const KEY = 'iqoo.settings';

function load(): IqooSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<IqooSettings>) };
  } catch {
    return DEFAULTS;
  }
}

interface SettingsState extends IqooSettings {
  update: (patch: Partial<IqooSettings>) => void;
  reset: () => void;
}

const SettingsContext = createContext<SettingsState>(null as unknown as SettingsState);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<IqooSettings>(load);

  const value = useMemo<SettingsState>(() => ({
    ...settings,
    update(patch) {
      setSettings((s) => {
        const next = { ...s, ...patch };
        try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage full */ }
        return next;
      });
    },
    reset() {
      try { localStorage.removeItem(KEY); } catch { /* ignore */ }
      setSettings(DEFAULTS);
    },
  }), [settings]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsState {
  return useContext(SettingsContext);
}
