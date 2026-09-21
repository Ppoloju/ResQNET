import { apiFetch } from './SessionContext';

interface PushConfig { ready: boolean; publicKey: string | null }

function decodeBase64Url(value: string): ArrayBuffer {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer as ArrayBuffer;
}

export async function enableWebPush(): Promise<string> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !window.isSecureContext) {
    throw new Error('Web Push requires a supported browser over HTTPS.');
  }
  const config = await apiFetch<PushConfig>('/notifications/push/config');
  if (!config.ready || !config.publicKey) throw new Error('Web Push is not configured on the server yet.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');
  const registration = await navigator.serviceWorker.register('/sw.js');
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeBase64Url(config.publicKey),
  });
  await apiFetch('/notifications/push/subscribe', { method: 'POST', body: JSON.stringify(subscription.toJSON()) });
  return 'Browser push notifications are enabled on this device.';
}

export async function disableWebPush(): Promise<string> {
  const registration = await navigator.serviceWorker.getRegistration('/sw.js');
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return 'Browser push notifications were already disabled.';
  await apiFetch('/notifications/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint: subscription.endpoint }) });
  await subscription.unsubscribe();
  return 'Browser push notifications are disabled on this device.';
}
