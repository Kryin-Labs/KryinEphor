self.addEventListener('push', event => {
  let message = {};
  try { message = event.data?.json() ?? {}; } catch { /* Display a generic alert for malformed payloads. */ }
  event.waitUntil(self.registration.showNotification(message.title || 'New announcement', {
    body: message.body || 'Open Kryin School to read it',
    tag: message.tag,
    icon: '/icons/kryin-192.png',
    data: { url: '/announcements' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/announcements', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
    const current = clients.find(client => new URL(client.url).origin === self.location.origin);
    if (current) { await current.focus(); return current.navigate(target); }
    return self.clients.openWindow(target);
  }));
});
