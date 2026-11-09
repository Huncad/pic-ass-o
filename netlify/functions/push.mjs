// PIC-ASS-O — push értesítés új szobáról: feliratkozás (v4.36)
//   GET                                   -> { key, count }  (nyilvános küldőkulcs)
//   POST { action:"subscribe", sub }      -> a böngésző push-feliratkozásának mentése
//   POST { action:"unsubscribe", endpoint } -> törlés
// Magát az értesítést a subscribe függvény küldi ki, amikor egy nyilvános szoba
// megnyílását a játékszerver listájából ellenőrizte (lásd ott: "notify").
import { json, ipOf, makeLimiter } from '../lib/util.mjs';
import { pushStore, getVapid, countPush, addPush, removePush, cleanSubscription, subId } from '../lib/push.mjs';

const limited = makeLimiter();

export default async (req) => {
  const ip = ipOf(req);
  const store = pushStore();
  if (req.method === 'GET') {
    if (limited('g|' + ip, 60, 600000)) return json({ error: 'slow down' }, 429);
    const v = await getVapid(store);
    return json({ key: v.publicKey, count: await countPush(store) });
  }
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  if (req.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'forbidden' }, 403);
  if (limited('p|' + ip, 20, 600000)) return json({ error: 'slow down' }, 429);
  let body = {};
  try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  if (body.action === 'subscribe') {
    const sub = cleanSubscription(body.sub);
    if (!sub) return json({ error: 'bad subscription' }, 400);
    const r = await addPush(sub, store);
    if (r && r.error) return json({ error: r.error }, 409);
    return json({ ok: true });
  }
  if (body.action === 'unsubscribe') {
    const endpoint = String(body.endpoint || '').slice(0, 1000);
    if (!endpoint) return json({ error: 'bad endpoint' }, 400);
    await removePush(subId(endpoint), store);
    return json({ ok: true });
  }
  return json({ error: 'unknown action' }, 400);
};
