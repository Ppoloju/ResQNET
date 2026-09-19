import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export interface SessionUser {
  id: string;
  email: string;
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
}

interface SessionState {
  user: SessionUser | null;
  device: DeviceInfo | null;
  loading: boolean;
  /** Step 1: password check. Resolves with whether a 2FA code is now required. */
  login: (email: string, password: string) => Promise<LoginResult>;
  /** Step 2: consume the emailed 6-digit code and open the session. */
  verify2fa: (email: string, code: string) => Promise<void>;
  resend2fa: (email: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  verifyEmail: (email: string, code: string) => Promise<void>;
  resendVerification: (email: string) => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  resetPassword: (email: string, code: string, newPassword: string) => Promise<void>;
  sendChangeCode: () => Promise<void>;
  changePassword: (currentPassword: string, code: string, newPassword: string) => Promise<void>;
  logout: () => void;
}

const SessionContext = createContext<SessionState>(null as unknown as SessionState);

export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

/** Token storage: localStorage is acceptable for the prototype; production plan = HttpOnly cookie + refresh (docs/security.md). */
const TOKEN_KEY = 'resqnet.token';

function persistSession(r: { token: string; user: SessionUser; device?: DeviceInfo | null; withSecret?: boolean }) {
  localStorage.setItem(TOKEN_KEY, r.token);
  if (r.device) {
    localStorage.setItem('resqnet.device', JSON.stringify(r.device));
  }
}

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
          const d = localStorage.getItem('resqnet.device');
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
      const r = await apiFetch<{ token?: string; twoFactorRequired?: boolean; email?: string; user?: SessionUser; device?: DeviceInfo | null }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (r.twoFactorRequired) {
        return { ok: true, twoFactorRequired: true, maskedEmail: r.email };
      }
      if (!r.token || !r.user) throw new Error('login failed');
      persistSession({ token: r.token, user: r.user, device: r.device });
      setUser(r.user);
      if (r.device) setDevice(r.device);
      return { ok: true };
    },
    async verify2fa(email, code) {
      const r = await apiFetch<{ token: string; user: SessionUser; device: DeviceInfo | null }>('/auth/login/verify-2fa', {
        method: 'POST',
        body: JSON.stringify({ email, code }),
      });
      persistSession({ token: r.token, user: r.user, device: r.device });
      setUser(r.user);
      if (r.device) setDevice(r.device);
    },
    async resend2fa(email) {
      await apiFetch('/auth/login/resend-2fa', { method: 'POST', body: JSON.stringify({ email }) });
    },
    async register(email, password, displayName) {
      const r = await apiFetch<{ token: string; user: SessionUser; device: DeviceInfo }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, displayName }),
      });
      persistSession({ token: r.token, user: r.user, device: r.device });
      setUser(r.user);
      setDevice(r.device);
    },
    async verifyEmail(email, code) {
      await apiFetch('/auth/verify-email', { method: 'POST', body: JSON.stringify({ email, code }) });
      setUser((u) => (u ? { ...u, emailVerified: true } : u));
    },
    async resendVerification(email) {
      await apiFetch('/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email }) });
    },
    async forgotPassword(email) {
      await apiFetch('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
    },
    async resetPassword(email, code, newPassword) {
      await apiFetch('/auth/reset-password', { method: 'POST', body: JSON.stringify({ email, code, newPassword }) });
    },
    async sendChangeCode() {
      await apiFetch('/auth/send-change-code', { method: 'POST', body: '{}' });
    },
    async changePassword(currentPassword, code, newPassword) {
      await apiFetch('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, code, newPassword }) });
    },
    logout() {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem('resqnet.device');
      setUser(null);
      setDevice(null);
    },
  }), [user, device, loading]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}
