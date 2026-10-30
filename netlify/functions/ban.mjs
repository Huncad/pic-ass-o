// PIC-ASS-O — kitiltások (v3.85)
// - Akit kirúgnak (vagy megszavaznak) egy szobából, arra a szobára az eszköze ÉS az IP-címe is tiltva lesz.
// - Ha ugyanazt az eszközt/IP-t 24 órán belül LEGALÁBB 2 KÜLÖNBÖZŐ szobából rúgják ki, 7 napra az
//   egész játékból ki van tiltva (eszköz + IP).
// Az IP-t csak a szerver látja, ezért a játék ezt a függvényt hívja:
//   POST {action:"open",  room, dev}                       szobanyitó bejelenti a szobát  -> {hostKey}
//   POST {action:"enter", room, dev}                       belépés előtt ellenőrzés       -> {ok, token} | {banned, scope, until}
//   POST {action:"verify", room, dev, token}               a szobanyitó ellenőrzi a belépőt -> {ok} | {ok:false, reason}
//   POST {action:"kick",  room, hostKey, targetDev}        kirúgás bejelentése            -> {ok, globalBan}
// Ha a szerver nem elérhető, a játék átengedi a belépést (fail-open), hogy ne akadjon el a játék.
import { getStore } from '@netlify/blobs';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { json, makeLimiter, updateJSON } from '../lib/util.mjs';

const DAY = 86400000;
const GLOBAL_BAN_MS = 7 * DAY;     // ennyi ideig tart az egész játékból való kitiltás
const KICK_WINDOW_MS = DAY;        // ennyi időn belül számolódnak a kirúgások
const KICK_ROOMS_LIMIT = 2;        // ennyi KÜLÖNBÖZŐ szobából kirúgva jön a heti tiltás
const ROOM_KEEP_MS = 30 * DAY;     // a szobás tiltás ennyi ideig marad meg
const CACHE_MS = 10000;            // a globális lista rövid memória-gyorsítótára (kevesebb tárolóolvasás)
const PASS_MS = 6 * 3600000;       // a belépési jegy érvényessége

const clean = (s, n) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, n);
const roomKey = r => clean(r, 8).toUpperCase();

// IPv6: a hosszú címből az első 64 bit számít (a vég "privacy" címként változik)
function normIp(ip) {
  ip = String(ip || '').trim();
  if (ip.includes(':')) {
    if (ip.startsWith('::ffff:') && ip.includes('.')) return ip.slice(7);
    const full = ip.split('::');
    let head = full[0].split(':').filter(Boolean);
    if (full.length === 1) head = ip.split(':');
    return head.slice(0, 4).join(':').toLowerCase() + '::/64';
  }
  return ip;
}
function clientIp(req) {
  const h = req.headers.get('x-nf-client-connection-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0];
  return normIp(h);
}

// példányonként megmaradó gyorsítótár és sebességkorlát (a „meleg” függvénypéldány újrahasználja)
let secretCache = null, globalCache = null, globalCacheAt = 0;
const limited = makeLimiter(5000);
const sameStr = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
const asObj = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : null;

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  if (req.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'forbidden' }, 403);
  let b = {};
  try { b = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }

  const store = getStore({ name: 'picasso-bans', consistency: 'strong' });
  const rd = async k => { const v = await store.get(k, { type: 'json' }).catch(() => null); return (v && typeof v === 'object') ? v : null; };
  const now = Date.now();
  const ip = clientIp(req);
  const dev = clean(b.dev, 40);
  const room = roomKey(b.room);

  // titkos kulcs a belépési jegyekhez (egyszer jön létre)
  let secret = secretCache || (await rd('secret')) || null;
  if (!secret || !secret.k) {
    // első indulás: ha két példány egyszerre hozná létre, csak az első írás nyer (v4.30: feltételes írás)
    await store.setJSON('secret', { k: randomBytes(32).toString('hex') }, { onlyIfNew: true }).catch(() => null);
    secret = (await rd('secret')) || secret;
    if (!secret || !secret.k) return json({ error: 'store' }, 503);
  }
  secretCache = secret;
  // az IP-cím nyers formában sehol nem tárolódik és a jegyben sem szerepel: csak egy kulcsos lenyomata
  const ipH = ip ? createHmac('sha256', secret.k).update('ip|' + ip).digest('hex').slice(0, 20) : '';
  const sign = (s, k) => createHmac('sha256', k || secret.k).update(s).digest('hex').slice(0, 32);
  const mkToken = (d, r, i, exp) => { const p = [d, r, i, exp].join('|'); return Buffer.from(p).toString('base64url') + '.' + sign(p); };
  const readToken = (t, k) => {
    try {
      const [p64, sig] = String(t || '').split('.');
      const p = Buffer.from(p64, 'base64url').toString();
      const a = Buffer.from(sig || ''), c = Buffer.from(sign(p, k));
      if (a.length !== c.length || !timingSafeEqual(a, c)) return null;
      const [d, r, i, exp] = p.split('|');
      return { d, r, i, exp: Number(exp) };
    } catch (e) { return null; }
  };

  const tidyG = (raw) => {
    const g = asObj(raw) || { bans: {}, kicks: {} };
    g.bans = asObj(g.bans) || {}; g.kicks = asObj(g.kicks) || {};
    for (const k of Object.keys(g.bans)) if (g.bans[k] <= now) delete g.bans[k];
    for (const k of Object.keys(g.kicks)) {
      g.kicks[k] = (g.kicks[k] || []).filter(x => now - x.t < KICK_WINDOW_MS);
      if (!g.kicks[k].length) delete g.kicks[k];
    }
    return g;
  };
  const getG = async () => {
    if (globalCache && now - globalCacheAt < CACHE_MS) return globalCache;
    const g = tidyG(await rd('global'));
    globalCache = g; globalCacheAt = now;
    return g;
  };
  const globalBanUntil = (g, d, i) => Math.max(d ? (g.bans['d:' + d] || 0) : 0, i ? (g.bans['i:' + i] || 0) : 0);

  // egy IP-címről érkező, szokatlanul sok hívás: megállítjuk (a játék ilyenkor továbbengedi a játékost)
  const lim = { open: [15, 3600000], enter: [60, 600000], verify: [200, 600000], kick: [60, 600000] }[b.action];
  if (!lim) return json({ error: 'action' }, 400);
  if (limited(b.action + '|' + (ipH || 'x'), lim[0], lim[1])) return json({ error: 'slow down' }, 429);

  if (b.action === 'open') {
    if (!dev || !room) return json({ error: 'bad' }, 400);
    const g = await getG();
    const until = globalBanUntil(g, dev, ipH);
    if (until > now) return json({ banned: true, scope: 'global', until });
    if (Math.random() < 0.03) {   // régi szobák takarítása (néha, hogy a tároló ne hízzon)
      try {
        const { blobs } = await store.list({ prefix: 'room:' });
        for (const bl of (blobs || []).slice(0, 60)) {
          const x = await rd(bl.key);
          if (!x || now - (x.created || 0) > ROOM_KEEP_MS) await store.delete(bl.key);
        }
      } catch (e) { /* nem fontos */ }
    }
    const hostKey = randomBytes(16).toString('hex');
    // v4.30: ütközésbiztos — két egyszerre nyitó közül csak az egyik kapja meg a szobát
    const taken = await updateJSON(store, 'room:' + room, ex => {
      const e = asObj(ex);
      if (e && e.hostKey && now - e.created < ROOM_KEEP_MS) return { write: false, result: true };
      return { value: { created: now, hostDev: dev, hostKey, pres: {}, bDev: [], bIp: [] }, result: false };
    });
    if (taken) return json({ error: 'taken' }, 409);
    return json({ ok: true, hostKey, token: mkToken(dev, room, ipH, now + PASS_MS) });
  }

  if (b.action === 'enter') {
    if (!dev || !room) return json({ error: 'bad' }, 400);
    const g = await getG();
    const until = globalBanUntil(g, dev, ipH);
    if (until > now) return json({ banned: true, scope: 'global', until });
    const banned = await updateJSON(store, 'room:' + room, raw => {
      const r = asObj(raw);
      if (!r) return { write: false, result: false };
      if ((r.bDev || []).includes(dev) || (r.bIp || []).includes(ipH)) return { write: false, result: true };
      r.pres = asObj(r.pres) || {};
      const list = Array.isArray(r.pres[dev]) ? r.pres[dev] : [];
      // csak változáskor írunk
      if (list.includes(ipH) || Object.keys(r.pres).length >= 200) return { write: false, result: false };
      list.push(ipH); r.pres[dev] = list.slice(-6);
      return { value: r, result: false };
    }).catch(() => false);
    if (banned) return json({ banned: true, scope: 'room' });
    return json({ ok: true, token: mkToken(dev, room, ipH, now + PASS_MS) });
  }

  if (b.action === 'verify') {
    let t = readToken(b.token);
    if (!t && b.token) {   // lehet, hogy ez a példány régi titkot tart a memóriában: friss olvasás
      const fresh = await rd('secret');
      if (fresh && fresh.k && fresh.k !== secret.k) { secretCache = fresh; t = readToken(b.token, fresh.k); }
    }
    if (!t || t.exp < now || t.r !== room || (dev && t.d !== dev)) return json({ ok: false, reason: 'notoken' });
    const g = await getG();
    if (globalBanUntil(g, t.d, t.i) > now) return json({ ok: false, reason: 'banned' });
    const r = await rd('room:' + room);
    if (r && ((r.bDev || []).includes(t.d) || (r.bIp || []).includes(t.i))) return json({ ok: false, reason: 'banned' });
    return json({ ok: true });
  }

  if (b.action === 'kick') {
    const target = clean(b.targetDev, 40);
    const hostKey = clean(b.hostKey, 40);
    // v4.30: ütközésbiztos írás — két egyszerre érkező kirúgás nem írja felül egymást
    const res = await updateJSON(store, 'room:' + room, raw => {
      const r = asObj(raw);
      if (!r || !r.hostKey || !target || !sameStr(hostKey, r.hostKey)) return { write: false, result: { err: 'unauthorized' } };
      if (target === r.hostDev) return { write: false, result: { err: 'host' } };
      const ips = ((asObj(r.pres) || {})[target] || []).slice(0, 6);
      r.bDev = Array.from(new Set([...(r.bDev || []), target])).slice(-300);
      r.bIp = Array.from(new Set([...(r.bIp || []), ...ips])).slice(-300);
      return { value: r, result: { ips } };
    });
    if (res.err === 'unauthorized') return json({ error: 'unauthorized' }, 401);
    if (res.err) return json({ error: res.err }, 400);
    const ids = ['d:' + target, ...res.ips.map(i => 'i:' + i)];

    const out = await updateJSON(store, 'global', raw => {
      const g = tidyG(raw);
      let globalBan = false;
      for (const id of ids) {
        const arr = g.kicks[id] || (g.kicks[id] = []);
        if (!arr.some(x => x.room === room)) arr.push({ room, t: now });
        if (new Set(arr.map(x => x.room)).size >= KICK_ROOMS_LIMIT) {
          // a tiltás az eszközre ÉS a hozzá látott IP-kre is vonatkozik
          for (const x of ids) g.bans[x] = now + GLOBAL_BAN_MS;
          globalBan = true;
          break;
        }
      }
      // szerverméret-védelem
      const keys = Object.keys(g.kicks);
      if (keys.length > 3000) keys.slice(0, keys.length - 3000).forEach(k => delete g.kicks[k]);
      return { value: g, result: { g, globalBan } };
    });
    globalCache = out.g; globalCacheAt = now;
    return json({ ok: true, globalBan: out.globalBan });
  }

  return json({ error: 'action' }, 400);
};
