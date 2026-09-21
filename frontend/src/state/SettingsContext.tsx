// App settings (§29/§37/§59): persisted locally, no account needed.
// Relay thresholds mirror the engine tiers but remain user-configurable per
// §29 ("Make this configurable"); they feed Relay Readiness and the Network UI.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiFetch, useSession } from './SessionContext';

export type ThemePreference = 'system' | 'light' | 'dark';

export interface IqooSettings {
  /** Consent to relay other people's emergency packets (§37). */
  relayConsent: boolean;
  /** Low-power mode: relay only CRITICAL regardless of battery (§29). */
  lowPowerMode: boolean;
  /** Battery below this → CRITICAL-only relay. */
  criticalThresholdPct: number;
  /**
   * Relay Hero (§29 iQOO enhancement): volunteer this device as the mesh's
   * backbone relay. Honest on iQOO-class hardware (large cell + bypass
   * charging can sustain it); other devices should keep this OFF.
   */
  relayHeroMode: boolean;
  /** UI color scheme; 'system' follows the OS preference. */
  theme: ThemePreference;
}

const DEFAULTS: IqooSettings = {
  relayConsent: true,
  lowPowerMode: false,
  criticalThresholdPct: 20,
  relayHeroMode: false,
  theme: 'system',
};

const KEY = 'resqnet.settings';

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
  syncStatus: 'local' | 'syncing' | 'synced' | 'offline';
}

const SettingsContext = createContext<SettingsState>(null as unknown as SettingsState);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const [settings, setSettings] = useState<IqooSettings>(load);
  const [syncStatus, setSyncStatus] = useState<SettingsState['syncStatus']>('local');

  useEffect(() => {
    if (!user) return;
    setSyncStatus('syncing');
    apiFetch<{ settings: Partial<IqooSettings> }>('/settings')
      .then(({ settings: remote }) => { setSettings((current) => ({ ...current, ...remote })); setSyncStatus('synced'); })
      .catch(() => setSyncStatus('offline'));
  }, [user]);

  // Apply the theme to <html data-theme="…"> and follow OS changes while on 'system'.
  useEffect(() => {
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: light)') : null;
    const apply = () => {
      const resolved = settings.theme === 'system'
        ? (mq?.matches ? 'light' : 'dark')
        : settings.theme;
      document.documentElement.dataset.theme = resolved;
    };
    apply();
    mq?.addEventListener?.('change', apply);
    return () => mq?.removeEventListener?.('change', apply);
  }, [settings.theme]);

  const value = useMemo<SettingsState>(() => ({
    ...settings,
    update(patch) {
      setSettings((s) => {
        const next = { ...s, ...patch };
        try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage full */ }
        if (user) {
          const { theme: _theme, ...remote } = next;
          setSyncStatus('syncing');
          void apiFetch('/settings', { method: 'PUT', body: JSON.stringify(remote) })
            .then(() => setSyncStatus('synced'))
            .catch(() => setSyncStatus('offline'));
        }
        return next;
      });
    },
    reset() {
      try { localStorage.removeItem(KEY); } catch { /* ignore */ }
      setSettings(DEFAULTS);
      if (user) {
        const { theme: _theme, ...remote } = DEFAULTS;
        setSyncStatus('syncing');
        void apiFetch('/settings', { method: 'PUT', body: JSON.stringify(remote) })
          .then(() => setSyncStatus('synced'))
          .catch(() => setSyncStatus('offline'));
      }
    },
    syncStatus,
  }), [settings, user, syncStatus]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsState {
  return useContext(SettingsContext);
}
