import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, ShieldCheck, Smartphone } from 'lucide-react';
import { apiFetch, useSession } from '../state/SessionContext';
import { TextField } from '../components/ui';

type Mode = 'login' | 'register' | 'verify2fa' | 'verifyEmail' | 'forgot' | 'reset';

const TITLES: Record<Mode, string> = {
  login: 'Welcome back',
  register: 'Create your ResQNET account',
  verify2fa: 'Check your email and phone',
  verifyEmail: 'Confirm your account',
  forgot: 'Reset your password',
  reset: 'Choose a new password',
};

const LEADS: Record<Mode, string> = {
  login: 'Use your email or mobile number. A 6-digit code is sent through every configured delivery channel.',
  register: 'Add an email and mobile number. We show exactly which delivery channels are available.',
  verify2fa: 'Enter the code we sent. It expires in 10 minutes.',
  verifyEmail: 'Enter the code we sent to finish creating the account.',
  forgot: 'We will send a reset code to the email and phone on the account.',
  reset: 'Paste the code, then set a password of at least 8 characters.',
};

interface ChannelStatus {
  email: string;
  sms: string;
  emailReady: boolean;
  smsReady: boolean;
}

function OtpBoxes({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? '');

  function setAt(index: number, char: string) {
    const next = digits.map((d, i) => (i === index ? char : d)).join('').replace(/\D/g, '').slice(0, 6);
    onChange(next);
    if (char && index < 5) refs.current[index + 1]?.focus();
  }

  return (
    <div className="auth-otp" role="group" aria-label="6-digit code">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(el) => { refs.current[index] = el; }}
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          value={digit}
          aria-label={`Digit ${index + 1}`}
          onChange={(event) => setAt(index, event.target.value.replace(/\D/g, '').slice(-1))}
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && !digits[index] && index > 0) {
              refs.current[index - 1]?.focus();
              onChange(digits.map((d, i) => (i === index - 1 ? '' : d)).join(''));
            }
          }}
          onPaste={(event) => {
            event.preventDefault();
            onChange(event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6));
          }}
        />
      ))}
    </div>
  );
}

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
  const [channels, setChannels] = useState<ChannelStatus | null>(null);
  const [lastDelivery, setLastDelivery] = useState<{ email?: boolean; sms?: boolean }>({});

  useEffect(() => {
    apiFetch<ChannelStatus>('/auth/channels').then(setChannels).catch(() => setChannels(null));
  }, []);

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
          setLastDelivery({ email: result.emailSent, sms: result.smsSent });
          const dest = [result.maskedEmail, result.maskedPhone].filter(Boolean).join(' and ');
          go('verify2fa', result.devCode
            ? `Delivery is in console-only mode. Use code ${result.devCode} (also logged on the server). Sent toward ${dest}.`
            : `Code sent to ${dest}.`);
          return;
        }
        navigate('/');
        return;
      }
      if (mode === 'register') {
        const result = await register(email.trim(), password, displayName.trim(), phone.trim());
        setPendingId(email.trim());
        setLastDelivery({ email: result.emailSent, sms: result.smsSent });
        go('verifyEmail', result.devCode
          ? `Account created. Delivery is in console-only mode. Use code ${result.devCode}.`
          : `Account created. Email: ${result.emailSent ? 'sent' : 'unavailable'} · SMS: ${result.smsSent ? 'sent' : 'unavailable'}.`);
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
        go('reset', 'If that account exists, a code was sent to its email and phone.');
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
    <div className="auth-page">
      <section className="auth-card">
        <div className="auth-brand">
          <span className="auth-mark">RQ</span>
          <div>
            <strong>ResQNET</strong>
            <small>Offline emergency network</small>
          </div>
        </div>
        <h1>{TITLES[mode]}</h1>
        <p className="auth-lead">{LEADS[mode]}</p>

        {channels && (
          <div className="auth-channels" aria-live="polite">
            <span className={channels.emailReady ? 'is-on' : 'is-off'}><Mail size={14} /> {channels.emailReady ? 'Email delivery on' : 'Email not configured yet'}</span>
            <span className={channels.smsReady ? 'is-on' : 'is-off'}><Smartphone size={14} /> {channels.smsReady ? 'SMS delivery on' : 'SMS not configured yet'}</span>
          </div>
        )}

        {notice && <div className="banner warn-banner" role="status">{notice}</div>}

        {(mode === 'verify2fa' || mode === 'verifyEmail') && (
          <div className="auth-delivery">
            <span><Mail size={14} /> {lastDelivery.email ? 'Email sent' : 'Email pending'}</span>
            <span><Smartphone size={14} /> {lastDelivery.sms ? 'SMS sent' : 'SMS pending'}</span>
          </div>
        )}

        <form onSubmit={(event) => void submit(event)}>
          {mode === 'register' && (
            <>
              <TextField label="Your name" value={displayName} onChange={setDisplayName} placeholder="Inturi Vaishnavi" autoComplete="name" required />
              <TextField label="College email" type="email" required value={email} onChange={setEmail} autoComplete="email" />
              <TextField label="Mobile number" type="tel" required value={phone} onChange={setPhone}
                placeholder="10-digit Indian mobile" autoComplete="tel" inputMode="tel" />
            </>
          )}

          {(mode === 'login' || mode === 'forgot') && (
            <>
              <TextField label="Email or mobile number" required value={identifier} onChange={setIdentifier} autoComplete="username" />
            </>
          )}

          {(mode === 'login' || mode === 'register') && (
            <>
              <TextField label={mode === 'register' ? 'Password (min 8 characters)' : 'Password'} type="password" required minLength={mode === 'register' ? 8 : 1} value={password}
                onChange={setPassword} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
            </>
          )}

          {(mode === 'verify2fa' || mode === 'verifyEmail' || mode === 'reset') && (
            <>
              <label>6-digit code</label>
              <OtpBoxes value={code} onChange={setCode} />
            </>
          )}

          {mode === 'reset' && (
            <>
              <TextField label="New password" type="password" required minLength={8} value={newPassword}
                onChange={setNewPassword} autoComplete="new-password" />
            </>
          )}

          {error && <p className="error-text" role="alert">{error}</p>}

          <button className="btn-primary auth-submit" type="submit" disabled={busy || ((mode === 'verify2fa' || mode === 'verifyEmail') && code.length !== 6)}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Continue'
              : mode === 'register' ? 'Create account'
              : mode === 'verify2fa' ? 'Verify and enter'
              : mode === 'verifyEmail' ? 'Verify account'
              : mode === 'forgot' ? 'Send reset code'
              : 'Save new password'}
          </button>
        </form>

        {(mode === 'verify2fa' || mode === 'verifyEmail') && (
          <p className="auth-links">
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => {
              setBusy(true);
              const run = mode === 'verify2fa' ? resend2fa(pendingId) : resendVerification(pendingId);
              run.then(() => setNotice('A new code was sent to email and phone.')).catch((err: unknown) => {
                setError(err instanceof Error ? err.message : 'Could not resend');
              }).finally(() => setBusy(false));
            }}>Send a new code</button>
          </p>
        )}

        <p className="auth-links">
          {mode === 'login' ? (
            <>
              <button type="button" className="btn-ghost" onClick={() => go('register')}>Create account</button>
              <button type="button" className="btn-ghost" onClick={() => go('forgot')}>Forgot password</button>
            </>
          ) : (
            <button type="button" className="btn-ghost" onClick={() => go('login')}>Back to sign in</button>
          )}
        </p>

        <p className="auth-foot">
          <ShieldCheck size={14} /> Codes are never printed in the app when real SMTP and SMS keys are set.
        </p>
      </section>
    </div>
  );
}
