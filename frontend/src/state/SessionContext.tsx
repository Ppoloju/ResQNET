import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export interface SessionUser {
  id: string;
  email: string;
  phone?: string | null;
  displayName: string;
  role: string;
  emailVerified?: boolean;
}

export interface DeviceInfo {
  id: string;
  publicId: string;
  /** Only present right after registration — stored locally, never sent again. */
  secret?: string;
}

export interface LoginResult {
  ok: boolean;
  twoFactorRequired?: boolean;
  maskedEmail?: string;
  maskedPhone?: string | null;
  devCode?: string;
}

interface SessionState {
  user: SessionUser | null;
  device: DeviceInfo | null;
  loading: boolean;
  /** Step 1: password check. Resolves with whether a 2FA code is now required. */
  login: (identifier: string, password: string) => Promise<LoginResult>;
  /** Step 2: consume the emailed/SMS 6-digit code and open the session. */
  verify2fa: (identifier: string, code: string) => Promise<void>;
  resend2fa: (identifier: string) => Promise<void>;
  register: (email: string, password: string, displayName: string, phone: string) => Promise<void>;
  verifyEmail: (identifier: string, code: string) => Promise<void>;
  resendVerification: (identifier: string) => Promise<void>;
  forgotPassword: (identifier: string) => Promise<void>;
  resetPassword: (identifier: string, code: string, newPassword: string) => Promise<void>;
  sendChangeCode: () => Promise<void>;
  changePassword: (currentPassword: string, code: string, newPassword: string) => Promise<void>;
  logout: () => void;
}

const SessionContext = createContext<SessionState>(null as unknown as SessionState);

export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

/** Token storage: localStorage is acceptable for the prototype; production plan = HttpOnly cookie + refresh (docs/security.md). */
const TOKEN_KEY = 'resqnet.token';
const USER_KEY = 'resqnet.sessionUser';
const DEVICE_KEY = 'resqnet.device';

function persistSession(session: { token: string; user: SessionUser; device: DeviceInfo | null }): void {
  localStorage.setItem(TOKEN_KEY, session.token);
  localStorage.setItem(USER_KEY, JSON.stringify(session.user));
  if (session.device) localStorage.setItem(DEVICE_KEY, JSON.stringify(session.device));
  else localStorage.removeItem(DEVICE_KEY);
}

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
    async login(identifier, password) {
      const r = await apiFetch<{ token?: string; twoFactorRequired?: boolean; email?: string; phone?: string | null; devCode?: string; user?: SessionUser; device?: DeviceInfo | null }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: identifier.trim(), email: identifier.trim(), password }),
      });
      if (!r.token || !r.user) {
        return {
          ok: true,
          twoFactorRequired: !!r.twoFactorRequired,
          maskedEmail: r.email,
          maskedPhone: r.phone,
          devCode: r.devCode,
        };
      }
      persistSession({ token: r.token, user: r.user, device: r.device ?? null });
      setUser(r.user);
      setDevice(r.device ?? null);
      return { ok: true, twoFactorRequired: false };
    },
    async verify2fa(identifier, code) {
      const r = await apiFetch<{ token: string; user: SessionUser; device: DeviceInfo | null }>('/auth/login/verify-2fa', {
        method: 'POST',
        body: JSON.stringify({ identifier, email: identifier, code }),
      });
      persistSession({ token: r.token, user: r.user, device: r.device });
      setUser(r.user);
      if (r.device) setDevice(r.device);
    },
    async resend2fa(identifier) {
      await apiFetch('/auth/login/resend-2fa', { method: 'POST', body: JSON.stringify({ identifier, email: identifier }) });
    },
    async register(email, password, displayName, phone) {
      const r = await apiFetch<{ token: string; user: SessionUser; device: DeviceInfo }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password, displayName: displayName.trim(), phone: phone.trim() }),
      });
      persistSession({ token: r.token, user: r.user, device: r.device });
      setUser(r.user);
      setDevice(r.device);
    },
    async verifyEmail(identifier, code) {
      await apiFetch('/auth/verify-email', { method: 'POST', body: JSON.stringify({ identifier, email: identifier, code }) });
      setUser((current) => current ? { ...current, emailVerified: true } : current);
    },
    async resendVerification(identifier) {
      await apiFetch('/auth/resend-verification', { method: 'POST', body: JSON.stringify({ identifier, email: identifier }) });
    },
    async forgotPassword(identifier) {
      await apiFetch('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ identifier, email: identifier }) });
    },
    async resetPassword(identifier, code, newPassword) {
      await apiFetch('/auth/reset-password', { method: 'POST', body: JSON.stringify({ identifier, email: identifier, code, newPassword }) });
    },
    async sendChangeCode() {
      await apiFetch('/auth/send-change-code', { method: 'POST' });
    },
    async changePassword(currentPassword, code, newPassword) {
      await apiFetch('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, code, newPassword }) });
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
