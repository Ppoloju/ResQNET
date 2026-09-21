import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../state/SessionContext';

type Mode = 'login' | 'register' | 'verify2fa' | 'verifyEmail' | 'forgot' | 'reset';

const TITLES: Record<Mode, string> = {
  login: 'Sign in',
  register: 'Create account',
  verify2fa: 'Enter your code',
  verifyEmail: 'Verify your account',
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
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [code, setCode] = useState('');
  const [pendingId, setPendingId] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const go = (next: Mode, msg = '') => {
    setMode(next);
    setNotice(msg);
    setError('');
    setBusy(false);
    setCode('');
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'login') {
        const result = await login(identifier.trim(), password);
        if (result.twoFactorRequired) {
          setPendingId(identifier.trim());
          const dest = [result.maskedEmail, result.maskedPhone].filter(Boolean).join(' and ');
          go('verify2fa', result.devCode
            ? `Code sent to ${dest || 'your email and phone'}. Local code: ${result.devCode}`
            : `We sent a 6-digit code to ${dest || 'your email and phone'}.`);
          return;
        }
        navigate('/');
        return;
      }
      if (mode === 'register') {
        await register(email.trim(), password, displayName.trim(), phone.trim());
        setPendingId(email.trim());
        go('verifyEmail', 'Account created. Enter the code sent to your email and phone.');
        return;
      }
      if (mode === 'verify2fa') {
        await verify2fa(pendingId, code);
        navigate('/');
        return;
      }
      if (mode === 'verifyEmail') {
        await verifyEmail(pendingId, code);
        navigate('/');
        return;
      }
      if (mode === 'forgot') {
        await forgotPassword(identifier.trim());
        setPendingId(identifier.trim());
        go('reset', 'If that account exists, a code was sent to the email and phone on file.');
        return;
      }
      await resetPassword(pendingId, code, newPassword);
      go('login', 'Password updated. Sign in with the new password.');
      setPassword('');
      setNewPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1>{TITLES[mode]}</h1>
      {notice && <div className="banner warn-banner" role="status">{notice}</div>}

      <form onSubmit={(event) => void submit(event)}>
        {mode === 'register' && (
          <>
            <label htmlFor="displayName">Your name</label>
            <input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your full name" autoComplete="name" required />
            <label htmlFor="email">College email</label>
            <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            <label htmlFor="phone">Mobile number</label>
            <input id="phone" type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)}
              placeholder="10-digit mobile" autoComplete="tel" />
          </>
        )}

        {(mode === 'login' || mode === 'forgot') && (
          <>
            <label htmlFor="identifier">Email or mobile number</label>
            <input id="identifier" required value={identifier} onChange={(e) => setIdentifier(e.target.value)}
              autoComplete="username" placeholder="name@student.gitam.edu or 9000000002" />
          </>
        )}

        {(mode === 'login' || mode === 'register') && (
          <>
            <label htmlFor="password">{mode === 'register' ? 'Password (min 8 chars)' : 'Password'}</label>
            <input id="password" type="password" required minLength={mode === 'register' ? 8 : 1} value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          </>
        )}

        {(mode === 'verify2fa' || mode === 'verifyEmail' || mode === 'reset') && (
          <>
            <label htmlFor="code">6-digit code</label>
            <input id="code" inputMode="numeric" pattern="\d{6}" maxLength={6} required value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} autoComplete="one-time-code" />
          </>
        )}

        {mode === 'reset' && (
          <>
            <label htmlFor="newPassword">New password</label>
            <input id="newPassword" type="password" required minLength={8} value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
          </>
        )}

        {error && <p className="error-text" role="alert">{error}</p>}

        <button className="btn-primary mt" type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in'
            : mode === 'register' ? 'Create account'
            : mode === 'verify2fa' ? 'Verify and sign in'
            : mode === 'verifyEmail' ? 'Verify account'
            : mode === 'forgot' ? 'Send reset code'
            : 'Save new password'}
        </button>
      </form>

      {mode === 'verify2fa' && (
        <p className="mt">
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => {
            setBusy(true);
            resend2fa(pendingId).then(() => setNotice('A new code was sent to email and phone.')).catch((err: unknown) => {
              setError(err instanceof Error ? err.message : 'Could not resend');
            }).finally(() => setBusy(false));
          }}>Resend code</button>
        </p>
      )}

      {mode === 'verifyEmail' && (
        <p className="mt">
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => {
            setBusy(true);
            resendVerification(pendingId).then(() => setNotice('A new code was sent to email and phone.')).catch((err: unknown) => {
              setError(err instanceof Error ? err.message : 'Could not resend');
            }).finally(() => setBusy(false));
          }}>Resend code</button>
        </p>
      )}

      <p className="mt">
        {mode === 'login' && (
          <>
            No account? <button type="button" className="btn-ghost" onClick={() => go('register')}>Register</button>
            {' · '}
            <button type="button" className="btn-ghost" onClick={() => go('forgot')}>Forgot password</button>
          </>
        )}
        {mode !== 'login' && (
          <>Have an account? <button type="button" className="btn-ghost" onClick={() => go('login')}>Sign in</button></>
        )}
      </p>

      <p className="muted">
        Sign in with your GITAM email or mobile number. The same 6-digit code is sent to both
        email and phone for sign-in, password reset, and password change. Team accounts use
        Gitam@2028 — any older password for those accounts is rejected.
      </p>
    </div>
  );
}
