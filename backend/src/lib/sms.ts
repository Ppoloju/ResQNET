// OTP SMS. Tries Twilio, Fast2SMS, 2Factor, Textbelt, then webhook.
// Console fallback is only used when no provider key is set.

import { config } from '../config.js';
import { logger } from '../logger.js';
import { digitsOnly } from './phone.js';

export type SmsProvider = 'twilio' | 'fast2sms' | 'twofactor' | 'textbelt' | 'webhook' | 'console';

export function smsProvider(): SmsProvider {
  if (config.sms.twilioSid && config.sms.twilioToken && config.sms.twilioFrom) return 'twilio';
  if (config.sms.fast2smsKey) return 'fast2sms';
  if (config.sms.twoFactorKey) return 'twofactor';
  if (config.sms.textbeltKey) return 'textbelt';
  if (config.notification.smsWebhookUrl) return 'webhook';
  return 'console';
}

export function smsMode(): 'live' | 'console' {
  return smsProvider() === 'console' ? 'console' : 'live';
}

function indiaNumber(to: string): string {
  const digits = digitsOnly(to);
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  return digits.slice(-10);
}

function e164(to: string): string {
  const digits = digitsOnly(to);
  if (digits.length === 10) return `+91${digits}`;
  if (digits.startsWith('91') && digits.length === 12) return `+${digits}`;
  return to.startsWith('+') ? to : `+${digits}`;
}

export async function sendOtpSms(to: string, code: string, purpose: string): Promise<void> {
  const body = `ResQNET code ${code}. Valid 10 min. Do not share it.`;
  const provider = smsProvider();

  if (provider === 'twilio') {
    const auth = Buffer.from(`${config.sms.twilioSid}:${config.sms.twilioToken}`).toString('base64');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.sms.twilioSid}/Messages.json`, {
      method: 'POST',
      headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: e164(to), From: config.sms.twilioFrom, Body: body }),
    });
    if (!res.ok) throw new Error(`Twilio SMS HTTP ${res.status}`);
    logger.info({ to, purpose, provider }, 'otp sms sent');
    return;
  }

  if (provider === 'fast2sms') {
    const url = new URL('https://www.fast2sms.com/dev/bulkV2');
    url.searchParams.set('authorization', config.sms.fast2smsKey);
    url.searchParams.set('route', 'otp');
    url.searchParams.set('variables_values', code.replace(/\D/g, '').slice(0, 6) || '000000');
    url.searchParams.set('numbers', indiaNumber(to));
    url.searchParams.set('flash', '0');
    const res = await fetch(url, { method: 'GET' });
    const json = await res.json().catch(() => ({})) as { return?: boolean; message?: string };
    if (!res.ok || json.return === false) throw new Error(`Fast2SMS: ${json.message ?? res.status}`);
    logger.info({ to, purpose, provider }, 'otp sms sent');
    return;
  }

  if (provider === 'twofactor') {
    const phone = e164(to).replace('+', '');
    const otp = code.replace(/\D/g, '').slice(0, 6) || '000000';
    const res = await fetch(`https://2factor.in/API/V1/${config.sms.twoFactorKey}/SMS/${phone}/${otp}/OTP`);
    const json = await res.json().catch(() => ({})) as { Status?: string; Details?: string };
    if (!res.ok || json.Status === 'Error') throw new Error(`2Factor: ${json.Details ?? res.status}`);
    logger.info({ to, purpose, provider }, 'otp sms sent');
    return;
  }

  if (provider === 'textbelt') {
    const res = await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: e164(to), message: body, key: config.sms.textbeltKey }),
    });
    const json = await res.json().catch(() => ({})) as { success?: boolean; error?: string };
    if (!json.success) throw new Error(`Textbelt: ${json.error ?? res.status}`);
    logger.info({ to, purpose, provider }, 'otp sms sent');
    return;
  }

  if (provider === 'webhook') {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (config.notification.webhookToken) headers.authorization = `Bearer ${config.notification.webhookToken}`;
    const res = await fetch(config.notification.smsWebhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ channel: 'SMS', to: e164(to), body, purpose, code }),
    });
    if (!res.ok) throw new Error(`SMS webhook HTTP ${res.status}`);
    logger.info({ to, purpose, provider }, 'otp sms sent');
    return;
  }

  logger.warn({ to, purpose, code }, 'SMS not configured — printing OTP to console (DEV ONLY)');
}
