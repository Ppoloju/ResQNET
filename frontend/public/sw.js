self.addEventListener('push', (event) => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch {
        data = { body: event.data ? event.data.text() : 'Emergency update received.' };
    }
    event.waitUntil(self.registration.showNotification(data.title || 'ResQNET alert', {
        body: data.body || 'A trusted contact has an emergency update.',
        tag: data.emergencyId || 'resqnet-alert',
        data: { emergencyId: data.emergencyId || '' },
        requireInteraction: data.severity === 'CRITICAL',
    }));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(clients.openWindow('/history'));
});