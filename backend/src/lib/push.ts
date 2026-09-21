import webpush, { type PushSubscription } from 'web-push';
import { config } from '../config.js';
import { db } from '../db.js';
import { logger } from '../logger.js';

const configured = Boolean(config.push.publicKey && config.push.privateKey);
if (configured) webpush.setVapidDetails(config.push.subject, config.push.publicKey, config.push.privateKey);

export function webPushReady(): boolean { return configured; }
export function webPushPublicKey(): string | null { return configured ? config.push.publicKey : null; }

export function saveSubscription(userId: string, subscription: PushSubscription, userAgent?: string): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh,
      auth = excluded.auth, user_agent = excluded.user_agent, updated_at = excluded.updated_at
  `).run(crypto.randomUUID(), userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, userAgent ?? null, now, now);
}

export function removeSubscription(userId: string, endpoint: string): void {
  db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(userId, endpoint);
}

export async function sendWebPush(userId: string, payload: unknown): Promise<boolean> {
  if (!configured) return false;
  const rows = db.prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').all(userId) as Array<{ id: string; endpoint: string; p256dh: string; auth: string }>;
  let delivered = false;
  for (const row of rows) {
    try {
      await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, JSON.stringify(payload));
      delivered = true;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(row.id);
      logger.warn({ userId, subscriptionId: row.id, status }, 'web push delivery failed');
    }
  }
  return delivered;
}