import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { broadcastEvent } from './routes/realtime.js';
import { sendWebPush } from './lib/push.js';

type ExternalChannel = 'SMS' | 'PUSH' | 'EMERGENCY_SERVICE';

interface EmergencyNotificationInput {
  emergencyId: string;
  ownerUserId: string;
  severity: string;
  message: string;
  requiresMedicalHelp?: boolean;
  requiresPoliceHelp?: boolean;
  includeEmergencyService?: boolean;
}

function webhookFor(channel: ExternalChannel): string {
  if (channel === 'SMS') return config.notification.smsWebhookUrl;
  if (channel === 'PUSH') return config.notification.pushWebhookUrl;
  return config.notification.emergencyServiceWebhookUrl;
}

function insertNotification(input: {
  userId: string;
  emergencyId: string;
  familyMemberId?: string;
  channel: 'SSE' | ExternalChannel;
  state: 'PENDING' | 'SENT';
  now: string;
}): string {
  const id = `ntf_${randomUUID()}`;
  db.prepare(`INSERT INTO notifications
    (id, user_id, emergency_id, family_member_id, channel, delivery_state, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, input.userId, input.emergencyId, input.familyMemberId ?? null, input.channel, input.state, input.now);
  return id;
}

/** Queue SSE plus configured external channels without claiming delivery. */
export function enqueueEmergencyNotifications(input: EmergencyNotificationInput): number {
  const members = db.prepare(
    `SELECT id, name, phone, iqoo_account_id FROM family_members
     WHERE owner_user_id = ? ORDER BY priority ASC, created_at ASC`,
  ).all(input.ownerUserId) as Array<{ id: string; name: string; phone: string; iqoo_account_id: string | null }>;
  const now = new Date().toISOString();
  let queued = 0;

  for (const member of members) {
    const recipientUserId = member.iqoo_account_id ?? input.ownerUserId;
    insertNotification({ userId: recipientUserId, emergencyId: input.emergencyId, familyMemberId: member.id, channel: 'SSE', state: 'SENT', now });
    queued += 1;

    if (member.phone) {
      insertNotification({ userId: recipientUserId, emergencyId: input.emergencyId, familyMemberId: member.id, channel: 'SMS', state: 'PENDING', now });
      queued += 1;
    }

    if (member.iqoo_account_id) {
      insertNotification({ userId: recipientUserId, emergencyId: input.emergencyId, familyMemberId: member.id, channel: 'PUSH', state: 'PENDING', now });
      queued += 1;
    }
  }

  if (input.includeEmergencyService && (input.requiresMedicalHelp || input.requiresPoliceHelp)) {
    insertNotification({ userId: input.ownerUserId, emergencyId: input.emergencyId, channel: 'EMERGENCY_SERVICE', state: 'PENDING', now });
    queued += 1;
  }

  if (members.length > 0) {
    broadcastEvent('mesh_event', {
      id: `ntf_${randomUUID()}`, emergencyId: input.emergencyId, type: 'FAMILY_NOTIFIED',
      from: 'BACKEND', to: `FAMILY(${members.length})`, ts: Date.now(),
    });
  }

  void deliverPendingNotifications();
  return queued;
}

async function deliverOne(row: Record<string, unknown>): Promise<void> {
  const channel = row.channel as ExternalChannel;
  const url = webhookFor(channel);
  if (!url) return;

  const notificationId = String(row.id);
  const emergencyId = String(row.emergency_id);
  const userId = String(row.user_id);
  const familyMemberId = typeof row.family_member_id === 'string' ? row.family_member_id : null;
  const attempts = Number(row.attempts ?? 0) + 1;
  const now = new Date().toISOString();
  const member = familyMemberId
    ? db.prepare('SELECT name, phone, iqoo_account_id FROM family_members WHERE id = ?').get(familyMemberId) as { name: string; phone: string; iqoo_account_id: string | null } | undefined
    : undefined;
  const emergency = db.prepare('SELECT severity, message, type FROM emergency_events WHERE id = ?').get(emergencyId) as { severity: string; message: string; type: string } | undefined;

  db.prepare('UPDATE notifications SET attempts = ?, last_attempt_at = ?, provider_error = NULL WHERE id = ?')
    .run(attempts, now, notificationId);

  try {
    if (channel === 'PUSH') {
      const delivered = await sendWebPush(userId, {
        title: emergency?.type === 'SOS' ? 'ResQNET emergency alert' : 'ResQNET family alert',
        body: emergency?.message || `${emergency?.severity ?? 'High'} priority emergency`,
        emergencyId,
        severity: emergency?.severity,
      });
      if (!delivered) throw new Error('no active web-push subscription');
      db.prepare('UPDATE notifications SET delivery_state = ?, delivered_at = ?, provider_error = NULL WHERE id = ?')
        .run('SENT', new Date().toISOString(), notificationId);
      return;
    }
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.notification.webhookToken ? { authorization: `Bearer ${config.notification.webhookToken}` } : {}),
      },
      body: JSON.stringify({
        channel,
        notificationId,
        emergencyId,
        recipient: member ? { name: member.name, phone: member.phone, userId: member.iqoo_account_id } : { userId },
        emergency: emergency ?? null,
      }),
    });
    if (!response.ok) throw new Error(`provider returned HTTP ${response.status}`);
    db.prepare('UPDATE notifications SET delivery_state = ?, delivered_at = ?, provider_error = NULL WHERE id = ?')
      .run('SENT', new Date().toISOString(), notificationId);
  } catch (error) {
    const providerError = error instanceof Error ? error.message : 'provider request failed';
    db.prepare('UPDATE notifications SET delivery_state = ?, provider_error = ? WHERE id = ?')
      .run(attempts >= 5 ? 'FAILED' : 'PENDING', providerError, notificationId);
    logger.warn({ notificationId, channel, attempts, providerError }, 'external notification delivery failed');
  }
}

/** Deliver configured webhooks; absent providers remain visibly PENDING. */
export async function deliverPendingNotifications(): Promise<void> {
  const rows = db.prepare(
    `SELECT * FROM notifications
     WHERE delivery_state = 'PENDING' AND channel IN ('SMS','PUSH','EMERGENCY_SERVICE')
       AND attempts < 5 ORDER BY created_at ASC LIMIT 50`,
  ).all() as Array<Record<string, unknown>>;
  await Promise.all(rows.filter((row) => !!webhookFor(row.channel as ExternalChannel)).map(deliverOne));
}

export function startNotificationDeliveryWorker(): ReturnType<typeof setInterval> {
  return setInterval(() => { void deliverPendingNotifications(); }, 30_000);
}
