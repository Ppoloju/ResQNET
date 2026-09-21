import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export interface SessionUser {
  id: string;
  email: string;
  phone?: string | null;
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
const USER_KEY = 'iqoo.sessionUser';
const DEVICE_KEY = 'iqoo.device';

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined) };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((body as { error?: string }).error ?? `HTTP ${res.status}`, res.status);
  return body as T;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const cachedUser = localStorage.getItem(USER_KEY);
      const cachedDevice = localStorage.getItem(DEVICE_KEY);
      if (cachedUser) setUser(JSON.parse(cachedUser) as SessionUser);
      if (cachedDevice) setDevice(JSON.parse(cachedDevice) as DeviceInfo);
    } catch {
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(DEVICE_KEY);
    }

    if (!localStorage.getItem(TOKEN_KEY)) {
      setLoading(false);
      return;
    }
    apiFetch<{ user: SessionUser }>('/auth/me')
      .then((r) => {
        setUser(r.user);
        localStorage.setItem(USER_KEY, JSON.stringify(r.user));
        try {
          const d = localStorage.getItem(DEVICE_KEY);
          if (d) setDevice(JSON.parse(d) as DeviceInfo);
        } catch { /* ignore corrupt device cache */ }
      })
      .catch((error: unknown) => {
        // A network outage must not sign the user out. Only an explicit auth
        // rejection means the persisted session is no longer valid.
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
          localStorage.removeItem(DEVICE_KEY);
          setUser(null);
          setDevice(null);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo<SessionState>(() => ({
    user,
    device,
    loading,
    async login(email, password) {
      const r = await apiFetch<{ token: string; user: SessionUser; device: DeviceInfo | null }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password }),
      });
      localStorage.setItem(TOKEN_KEY, r.token);
      setUser(r.user);
      localStorage.setItem(USER_KEY, JSON.stringify(r.user));
      if (r.device) {
        setDevice(r.device);
        localStorage.setItem(DEVICE_KEY, JSON.stringify(r.device));
      } else {
        setDevice(null);
        localStorage.removeItem(DEVICE_KEY);
      }
    },
    async register(email, password, displayName) {
      const r = await apiFetch<{ token: string; user: SessionUser; device: DeviceInfo }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password, displayName: displayName.trim() }),
      });
      localStorage.setItem(TOKEN_KEY, r.token);
      setUser(r.user);
      setDevice(r.device);
      localStorage.setItem(USER_KEY, JSON.stringify(r.user));
      localStorage.setItem(DEVICE_KEY, JSON.stringify(r.device));
    },
    logout() {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(DEVICE_KEY);
      setUser(null);
      setDevice(null);
    },
  }), [user, device, loading]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}
