// OTP SMS for login / reset / password-change. Uses the same webhook adapter
// as family SMS when SMS_WEBHOOK_URL is set; otherwise logs to the console
// (local/demo only — never claimed as carrier delivery).

import { config } from '../config.js';
import { logger } from '../logger.js';

export function smsMode(): 'webhook' | 'console' {
  return config.notification.smsWebhookUrl ? 'webhook' : 'console';
}

export async function sendOtpSms(to: string, code: string, purpose: string): Promise<void> {
  const body = `ResQNET code ${code} (valid 10 min). Do not share it. [${purpose}]`;
  const url = config.notification.smsWebhookUrl;
  if (url) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (config.notification.webhookToken) headers.authorization = `Bearer ${config.notification.webhookToken}`;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ channel: 'SMS', to, body, purpose, code }),
    });
    if (!res.ok) throw new Error(`SMS webhook HTTP ${res.status}`);
    logger.info({ to, purpose }, 'otp sms sent');
    return;
  }
  logger.warn({ to, purpose, code }, 'SMS webhook not configured — printing OTP to console (DEV ONLY)');
}
