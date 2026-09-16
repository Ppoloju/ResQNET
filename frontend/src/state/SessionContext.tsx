import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
}

export interface DeviceInfo {
  id: string;
  publicId: string;
  /** Only present right after registration — stored locally, never sent again. */
  secret?: string;
}

interface SessionState {
  user: SessionUser | null;
  device: DeviceInfo | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => void;
}

const SessionContext = createContext<SessionState>(null as unknown as SessionState);

export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

/** Token storage: localStorage is acceptable for the prototype; production plan = HttpOnly cookie + refresh (docs/security.md). */
const TOKEN_KEY = 'iqoo.token';

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined) };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      setLoading(false);
      return;
    }
    apiFetch<{ user: SessionUser }>('/auth/me')
      .then((r) => {
        setUser(r.user);
        try {
          const d = localStorage.getItem('iqoo.device');
          if (d) setDevice(JSON.parse(d) as DeviceInfo);
        } catch { /* ignore corrupt device cache */ }
      })
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo<SessionState>(() => ({
    user,
    device,
    loading,
    async login(email, password) {
      const r = await apiFetch<{ token: string; user: SessionUser; device: DeviceInfo | null }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      localStorage.setItem(TOKEN_KEY, r.token);
      setUser(r.user);
      if (r.device) {
        setDevice(r.device);
        localStorage.setItem('iqoo.device', JSON.stringify(r.device));
      }
    },
    async register(email, password, displayName) {
      const r = await apiFetch<{ token: string; user: SessionUser; device: DeviceInfo }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, displayName }),
      });
      localStorage.setItem(TOKEN_KEY, r.token);
      setUser(r.user);
      setDevice(r.device);
      localStorage.setItem('iqoo.device', JSON.stringify(r.device));
    },
    logout() {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem('iqoo.device');
      setUser(null);
      setDevice(null);
    },
  }), [user, device, loading]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}
