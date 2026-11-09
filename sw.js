// PIC-ASS-O — service worker (v4.36)
// Egyetlen dolga van: megjeleníti az "új szoba nyílt" push értesítést, és
// koppintásra megnyitja a játékot. Nem gyorsítótáraz és nem nyúl a hálózati
// kérésekhez — a játék mindig a friss változatot tölti be.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {}; }
  const clip = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, n);
  const title = clip(d.title, 80) || 'PIC-ASS-O';
  // csak a saját oldalra mutató cím nyitható meg
  let url = self.registration.scope;
  try { const u = new URL(String(d.url || ''), self.registration.scope); if (u.origin === self.location.origin) url = u.href; } catch (err) {}
  e.waitUntil(self.registration.showNotification(title, {
    body: clip(d.body, 160),
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    tag: 'picasso-room',
    renotify: true,
    data: { url }
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // ha a játék már nyitva van, azt hozzuk előre (játék közben nem navigálunk el;
    // az új szoba a kezdőképernyő szobalistáján úgyis ott van)
    for (const c of all) {
      try { if (new URL(c.url).origin === self.location.origin && 'focus' in c) { await c.focus(); return; } } catch (err) {}
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});
