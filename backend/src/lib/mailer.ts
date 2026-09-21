// Email delivery for account security (verification codes, 2FA login codes,
// password reset / change confirmations).
//
// Free-only policy (§1): nodemailer over any SMTP the operator supplies
// (Gmail app-password, Mailtrap, Resend SMTP…). When SMTP is NOT configured
// the mailer logs the full message to the server console — codes remain
// obtainable in local dev, and the API response says "email sent" only when
// it truly was (or dev-fallback is on), never fabricated elsewhere.

import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';
import { logger } from '../logger.js';

let transporter: Transporter | null = null;
if (config.smtp.host) {
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
}

export function mailerMode(): 'smtp' | 'console' {
  return transporter ? 'smtp' : 'console';
}

const BRAND = 'ResQNET';

function shell(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Segoe UI,Arial,sans-serif;padding:24px">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e3e8ee">
    <div style="background:#b3001b;padding:18px 24px">
      <span style="color:#fff;font-size:20px;font-weight:700;letter-spacing:1px">${BRAND}</span>
      <span style="color:#ffd3da;font-size:12px;display:block;margin-top:2px">Offline AI Emergency Network</span>
    </div>
    <div style="padding:24px">
      <h2 style="margin:0 0 12px;color:#16202b;font-size:18px">${title}</h2>
      ${bodyHtml}
      <p style="margin-top:20px;color:#8a95a1;font-size:12px">
        If you did not request this, ignore this email — your account stays protected.
        Never share this code with anyone; ${BRAND} staff will never ask for it.
      </p>
    </div>
  </div></body></html>`;
}

async function send(to: string, subject: string, title: string, bodyHtml: string): Promise<void> {
  if (transporter) {
    await transporter.sendMail({ from: config.smtp.from, to, subject, html: shell(title, bodyHtml) });
    logger.info({ to, subject }, 'email sent');
    return;
  }
  // Dev fallback: print the mail so local flows work without SMTP credentials.
  logger.warn({ to, subject, title }, 'SMTP not configured — printing email to console (DEV ONLY)');
  logger.warn(`--- EMAIL (dev console) ---\nTo: ${to}\nSubject: ${subject}\n${bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}\n---------------------------`);
}

export async function sendVerificationCode(to: string, code: string, purpose: 'VERIFY_ACCOUNT' | 'LOGIN_2FA' | 'PASSWORD_RESET'): Promise<void> {
  const subjects: Record<typeof purpose, string> = {
    VERIFY_ACCOUNT: `${BRAND} — verify your email`,
    LOGIN_2FA: `${BRAND} — your sign-in code`,
    PASSWORD_RESET: `${BRAND} — reset your password`,
  };
  const titles: Record<typeof purpose, string> = {
    VERIFY_ACCOUNT: 'Verify your email address',
    LOGIN_2FA: 'Two-step verification',
    PASSWORD_RESET: 'Reset your password',
  };
  const leads: Record<typeof purpose, string> = {
    VERIFY_ACCOUNT: 'Enter this 6-digit code in the app to activate your account:',
    LOGIN_2FA: 'Enter this 6-digit code to complete signing in:',
    PASSWORD_RESET: 'Enter this 6-digit code to set a new password:',
  };
  await send(to, subjects[purpose], titles[purpose], `
    <p style="color:#3c4854;font-size:14px">${leads[purpose]}</p>
    <div style="font-size:32px;font-weight:700;letter-spacing:10px;color:#b3001b;background:#faf5f5;
      border:1px dashed #d9a0a8;border-radius:10px;padding:14px 0;text-align:center;margin:14px 0">${code}</div>
    <p style="color:#8a95a1;font-size:12px">This code expires in 10 minutes and can be used once.</p>`);
}

export async function sendPasswordChangedNotice(to: string, whenIso: string, source: 'RESET' | 'CHANGE'): Promise<void> {
  const when = new Date(whenIso).toUTCString();
  await send(to, `${BRAND} — your password was changed`, 'Password changed',
    `<p style="color:#3c4854;font-size:14px">Your ${BRAND} account password was
     ${source === 'RESET' ? 'reset using an email code' : 'changed from Settings'} on ${when}.</p>
     <p style="color:#3c4854;font-size:14px">If this was you, no action is needed. If you did
     <b>not</b> do this, reset your password immediately from the app's sign-in screen.</p>`);
}
