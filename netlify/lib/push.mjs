// PIC-ASS-O — push értesítés új szobáról (v4.36)
// A telepített alkalmazás / böngésző kérésre feliratkozik; a feliratkozás egy
// véletlen, a böngésző push-szolgáltatójánál (Google, Mozilla, Apple, Microsoft)
// élő cím és két titkosító kulcs — név, e-mail cím vagy IP-cím nem tartozik hozzá.
// A küldéshez kellő (VAPID) kulcspár az első használatkor jön létre, és a
// Netlify Blobs tárolóban marad: nem kell hozzá környezeti változót beállítani.
import { getStore } from '@netlify/blobs';
import { createHash } from 'node:crypto';
import { updateJSON } from './util.mjs';

export const MAX_PUSH_SUBS = 1000;
const SUBS_KEY = 'subs', VAPID_KEY = 'vapid';
const SUBJECT = 'mailto:picasso.ertesito@gmail.com';
// csak a böngészők ismert push-szolgáltatóinak címe fogadható el — így a
// függvényt nem lehet rávenni, hogy tetszőleges címre küldjön kérést
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^[a-z0-9-]+\.push\.apple\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/];

const asObj = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
const b64u = s => typeof s === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(s);
export const pushStore = () => getStore({ name: 'picasso-push', consistency: 'strong' });
export const subId = endpoint => createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 32);

/** Ellenőrzött feliratkozás, vagy null. */
export function cleanSubscription(raw) {
  const s = asObj(raw), k = asObj(s.keys);
  const endpoint = String(s.endpoint || '');
  if (endpoint.length > 1000) return null;
  let u; try { u = new URL(endpoint); } catch (e) { return null; }
  if (u.protocol !== 'https:' || u.port || u.username || u.password) return null;
  if (!PUSH_HOSTS.some(re => re.test(u.hostname))) return null;
  if (!b64u(k.p256dh) || !b64u(k.auth)) return null;
  return { endpoint, keys: { p256dh: k.p256dh, auth: k.auth } };
}

let webpushMod = null;
async function webpush() { if (!webpushMod) { const m = await import('web-push'); webpushMod = m.default || m; } return webpushMod; }

/** A küldő kulcspár (első használatkor létrejön). */
export async function getVapid(store = pushStore()) {
  const cur = await store.get(VAPID_KEY, { type: 'json' }).catch(() => null);
  if (cur && b64u(cur.publicKey) && b64u(cur.privateKey)) return cur;
  const fresh = (await webpush()).generateVAPIDKeys();
  return updateJSON(store, VAPID_KEY, raw => {
    const d = asObj(raw);
    if (b64u(d.publicKey) && b64u(d.privateKey)) return { write: false, result: d };   // közben más már létrehozta
    const v = { publicKey: fresh.publicKey, privateKey: fresh.privateKey, at: Date.now() };
    return { value: v, result: v };
  });
}

export async function countPush(store = pushStore()) {
  const d = asObj(await store.get(SUBS_KEY, { type: 'json' }).catch(() => null));
  return Object.keys(asObj(d.subs)).length;
}
export async function addPush(sub, store = pushStore()) {
  return updateJSON(store, SUBS_KEY, raw => {
    const d = asObj(raw); d.subs = asObj(d.subs);
    const id = subId(sub.endpoint);
    if (!d.subs[id] && Object.keys(d.subs).length >= MAX_PUSH_SUBS) return { write: false, result: { error: 'full' } };
    d.subs[id] = { e: sub.endpoint, p: sub.keys.p256dh, a: sub.keys.auth, at: Date.now() };
    return { value: d, result: { ok: true, count: Object.keys(d.subs).length } };
  });
}
export async function removePush(ids, store = pushStore()) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  if (!list.length) return { ok: true };
  return updateJSON(store, SUBS_KEY, raw => {
    const d = asObj(raw); d.subs = asObj(d.subs);
    let n = 0;
    for (const id of list) if (d.subs[id]) { delete d.subs[id]; n++; }
    return n ? { value: d, result: { ok: true, removed: n } } : { write: false, result: { ok: true, removed: 0 } };
  });
}

/**
 * Értesítés minden feliratkozott eszköznek (kivéve `skipId`-t: a szobát nyitó eszközt).
 * A megszűnt feliratkozásokat (404 / 410) törli. Időkorlátos, hogy a függvény ne fusson ki.
 */
export async function sendPushToAll(payload, { skipId = '', budgetMs = 6000, store = pushStore() } = {}) {
  const d = asObj(await store.get(SUBS_KEY, { type: 'json' }).catch(() => null));
  const entries = Object.entries(asObj(d.subs)).filter(([id]) => id !== skipId);
  if (!entries.length) return { sent: 0, failed: 0, removed: 0 };
  const wp = await webpush();
  const vapid = await getVapid(store);
  const body = JSON.stringify(payload);
  const opts = { vapidDetails: { subject: SUBJECT, publicKey: vapid.publicKey, privateKey: vapid.privateKey }, TTL: 900, urgency: 'high', timeout: 4000 };
  const deadline = Date.now() + budgetMs;
  let sent = 0, failed = 0; const gone = [];
  for (let i = 0; i < entries.length && Date.now() < deadline; i += 25) {
    await Promise.all(entries.slice(i, i + 25).map(async ([id, s]) => {
      try {
        await wp.sendNotification({ endpoint: s.e, keys: { p256dh: s.p, auth: s.a } }, body, opts);
        sent++;
      } catch (e) {
        failed++;
        if (e && (e.statusCode === 404 || e.statusCode === 410)) gone.push(id);
      }
    }));
  }
  if (gone.length) await removePush(gone, store).catch(() => {});
  return { sent, failed, removed: gone.length };
}
