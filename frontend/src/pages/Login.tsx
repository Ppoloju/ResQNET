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
      if (mode === 'login') {
        const r = await login(email.trim().toLowerCase(), password);
        if (r.twoFactorRequired) {
          setPendingEmail(email.trim().toLowerCase());
          setCode('');
          go('verify2fa', `We emailed a 6-digit code to ${r.maskedEmail ?? 'your email'}. It expires in 10 minutes.`);
          return;
        }
        navigate('/');
      } else if (mode === 'register') {
        await register(email.trim().toLowerCase(), password, displayName.trim() || email.split('@')[0]);
        setPendingEmail(email.trim().toLowerCase());
        setCode('');
        go('verifyEmail', 'Account created. Check your email for the 6-digit verification code.');
      } else if (mode === 'verify2fa') {
        await verify2fa(pendingEmail, code.trim());
        navigate('/');
      } else if (mode === 'verifyEmail') {
        await verifyEmail(pendingEmail, code.trim());
        setNotice('Email verified — everything is unlocked.');
        navigate('/');
      } else if (mode === 'forgot') {
        await forgotPassword(email.trim().toLowerCase());
        setPendingEmail(email.trim().toLowerCase());
        setCode('');
        setNewPassword('');
        go('reset', 'If that address has an account, a reset code is on its way.');
      } else if (mode === 'reset') {
        if (newPassword.length < 8) { setError('Password must be at least 8 characters.'); setBusy(false); return; }
        await resetPassword(pendingEmail, code.trim(), newPassword);
        go('login', 'Password updated. Sign in with your new password.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  }

  const codeEntry = (
    <>
      <label htmlFor="code">6-digit code from your email</label>
      <input
        id="code"
        inputMode="numeric"
        pattern="\d{6}"
        maxLength={6}
        required
        autoComplete="one-time-code"
        className="code-input"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        placeholder="••••••"
      />
    </>
  );

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

        {mode === 'verify2fa' && codeEntry}
        {mode === 'verifyEmail' && codeEntry}
        {mode === 'reset' && <>{codeEntry}
          <label htmlFor="newPassword">New password (min 8 chars)</label>
          <input id="newPassword" type="password" required minLength={8} value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
        </>}

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
        {mode === 'login' && (
          <>
            No account? <button className="btn-ghost" onClick={() => go('register')}>Register</button>
            {' · '}
            <button className="btn-ghost" onClick={() => go('forgot')}>Forgot password?</button>
          </>
        )}
        {(mode === 'register' || mode === 'verifyEmail') && (
          <button className="btn-ghost" onClick={() => go('login')}>Back to sign in</button>
        )}
        {mode === 'verify2fa' && (
          <button
            className="btn-ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true); setError('');
              try { await resend2fa(pendingEmail); setNotice('A new code is on its way.'); }
              catch (err) { setError(err instanceof Error ? err.message : 'Could not resend.'); }
              finally { setBusy(false); }
            }}
          >
            Resend code
          </button>
        )}
        {mode === 'verifyEmail' && (
          <button
            className="btn-ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true); setError('');
              try { await resendVerification(pendingEmail); setNotice('A new code is on its way.'); }
              catch (err) { setError(err instanceof Error ? err.message : 'Could not resend.'); }
              finally { setBusy(false); }
            }}
          >
            Resend code
          </button>
        )}
        {mode === 'reset' && (
          <button className="btn-ghost" onClick={() => go('forgot')}>Request a new code</button>
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
