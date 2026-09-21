import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../state/SessionContext';

type Mode = 'login' | 'register' | 'verify2fa' | 'verifyEmail' | 'forgot' | 'reset';

const TITLES: Record<Mode, string> = {
  login: 'Sign in',
  register: 'Create account',
  verify2fa: 'Two-step verification',
  verifyEmail: 'Verify your email',
  forgot: 'Forgot password',
  reset: 'Set a new password',
};

export default function Login() {
  const {
    login, verify2fa, resend2fa, register,
    verifyEmail, resendVerification, forgotPassword, resetPassword,
  } = useSession();
  const navigate = useNavigate();

  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [code, setCode] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const go = (m: Mode, msg = '') => { setMode(m); setNotice(msg); setError(''); setBusy(false); };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const normalizedEmail = email.trim();
      if (mode === 'login') await login(normalizedEmail, password);
      else await register(normalizedEmail, password, displayName.trim() || normalizedEmail.split('@')[0]);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  }

  function switchMode(nextMode: 'login' | 'register') {
    setMode(nextMode);
    setError('');
  }

  return (
    <div>
      <h1>{TITLES[mode]}</h1>

      {notice && <div className="banner warn-banner" role="status">{notice}</div>}

      <form onSubmit={submit}>
        {(mode === 'login' || mode === 'register' || mode === 'forgot') && (
          <>
            {mode === 'register' && (
              <>
                <label htmlFor="displayName">Your name</label>
                <input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Pravalika" autoComplete="name" />
              </>
            )}
            <label htmlFor="email">Email</label>
            <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </>
        )}

        {(mode === 'login' || mode === 'register') && (
          <>
            <label htmlFor="password">{mode === 'login' ? 'Password' : 'Password (min 8 chars)'}</label>
            <input id="password" type="password" required minLength={8} value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          </>
        )}
        <label htmlFor="email">Email</label>
        <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        <label htmlFor="password">{mode === 'register' ? 'Password (min 8 chars)' : 'Password'}</label>
        <input id="password" type="password" required minLength={mode === 'register' ? 8 : 1} value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
        {error && <p className="error-text" role="alert">{error}</p>}

        <button className="btn-primary mt" type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? '…' : mode === 'login' ? 'Sign in'
            : mode === 'register' ? 'Create account'
            : mode === 'verify2fa' ? 'Verify & sign in'
            : mode === 'verifyEmail' ? 'Verify email'
            : mode === 'forgot' ? 'Email me a reset code'
            : 'Set new password'}
        </button>
      </form>

      <p className="mt">
        {mode === 'login' ? (
          <>No account? <button type="button" className="btn-ghost" onClick={() => switchMode('register')}>Register</button></>
        ) : (
          <>Have an account? <button type="button" className="btn-ghost" onClick={() => switchMode('login')}>Sign in</button></>
        )}
      </p>

      <p className="muted">
        Passwords are stored as Argon2id hashes on the ResQNET backend. Two-step verification emails a
        6-digit code every sign-in — nobody can enter your account with the password alone. Your device
        gets a per-device signing key, shown once and kept only on this device.
      </p>
    </div>
  );
}
