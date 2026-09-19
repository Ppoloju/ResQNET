import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../state/SessionContext';

export default function Login() {
  const { login, register } = useSession();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password, displayName || email.split('@')[0]);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1>{mode === 'login' ? 'Sign in' : 'Create account'}</h1>
      <form onSubmit={submit}>
        {mode === 'register' && (
          <>
            <label htmlFor="displayName">Your name</label>
            <input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Pravalika" autoComplete="name" />
          </>
        )}
        <label htmlFor="email">Email</label>
        <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        <label htmlFor="password">Password (min 8 chars)</label>
        <input id="password" type="password" required minLength={8} value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="btn-primary mt" type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? '…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
      </form>
      <p className="mt">
        {mode === 'login' ? (
          <>No account? <button type="button" className="btn-ghost" onClick={() => setMode('register')}>Register</button></>
        ) : (
          <>Have an account? <button type="button" className="btn-ghost" onClick={() => setMode('login')}>Sign in</button></>
        )}
      </p>
      <p className="muted">
        Passwords are stored as Argon2id hashes. Your device gets a per-device signing key —
        shown once at registration and kept only on this device.
      </p>
    </div>
  );
}
