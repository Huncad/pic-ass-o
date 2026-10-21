// PIC-ASS-O — words already drawn in ANY game (v3.65)
// A word that was the puzzle once is not offered again in any game, until
// every word of a level has been used (the game itself then falls back).
//   GET                            -> { words: ["ajto", ...] } (normalised keys)
//   POST { word, dev }             -> one device reports a finished drawing's word
//   v4.11: a szó csak akkor lesz "elhasznált", ha (1) rajta van a hivatalos
//   szólistán, és (2) legalább 2 KÜLÖNBÖZŐ eszköz jelenti 30 percen belül
//   (a rajzoló és a tippelők is jelentik). Egy IP naponta legfeljebb 200
//   jelentést küldhet — egy támadó így sem tudja kiüríteni a szólistát.
//   POST { action:"reset" } + header x-netlify-token -> admin: start over
import { getStore } from '@netlify/blobs';
import { norm, ipHash, cleanDev, officialWords, dailyQuota } from '../lib/words.mjs';

const KEY = 'used';


// sebességkorlát és gyorsítótár (példányonként; a meleg függvénypéldány újrahasználja)
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  arr.push(now); hits.set(key, arr);
  if (hits.size > 3000) for (const k of hits.keys()) { if (!(hits.get(k) || []).some(t => now - t < windowMs)) hits.delete(k); }
  return arr.length > max;
}
const ipOf = req => req.headers.get('x-nf-client-connection-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0] || 'x';
const PEND = 'pending', QUOTA = 'quota', CONFIRM_MS = 30 * 60 * 1000;
let listCache = null, listCacheAt = 0;

export default async (req) => {
  const json = (body, status = 200, cache = 'no-store') => new Response(JSON.stringify(body), {
    status, headers: Object.assign({ 'content-type': 'application/json', 'cache-control': cache },
      cache === 'no-store' ? {} : { 'netlify-cdn-cache-control': 'public, s-maxage=60, stale-while-revalidate=600' })
  });
  if (req.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'forbidden' }, 403);
  const store = getStore({ name: 'picasso-wordused', consistency: 'strong' });
  const read = async () => {
    const v = await store.get(KEY, { type: 'json' }).catch(() => null);
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  };

  if (req.method === 'GET') {
    if (!listCache || Date.now() - listCacheAt > 20000) { listCache = Object.keys(await read()); listCacheAt = Date.now(); }
    return json({ words: listCache, n: listCache.length }, 200, 'public, max-age=20');
  }
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  if (limited('p|' + ipOf(req), 40, 60000)) return json({ error: 'slow down' }, 429);
  let body = {};
  try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }

  if (body.action === 'reset') {
    const token = req.headers.get('x-netlify-token') || '';
    const site = process.env.SITE_ID;
    if (!token || !site) return json({ error: 'unauthorized' }, 401);
    try {
      const r = await fetch(`https://api.netlify.com/api/v1/sites/${encodeURIComponent(site)}`, { headers: { authorization: 'Bearer ' + token } });
      if (!r.ok) return json({ error: 'unauthorized' }, 401);
    } catch (e) { return json({ error: 'netlify unreachable' }, 502); }
    await store.setJSON(KEY, {});
    listCache = null;
    return json({ ok: true, n: 0 });
  }

  const k = norm(body.word);
  const dev = cleanDev(body.dev);
  if (!k) return json({ error: 'no word' }, 400);
  if (!dev) return json({ error: 'no device' }, 400);
  const official = await officialWords();
  if (!official) return json({ ok: false, skipped: 'wordlist unavailable' }, 503);
  if (!official.has(k)) return json({ ok: false, skipped: 'not an official word' });
  const used = await read();
  if (used[k]) return json({ ok: true, already: true });
  if (Object.keys(used).length > 40000) return json({ error: 'full' }, 429);
  if (!(await dailyQuota(store, QUOTA, ipHash(req), 200))) return json({ error: 'daily limit' }, 429);
  const now = Date.now();
  const pv = await store.get(PEND, { type: 'json' }).catch(() => null);
  const pend = (pv && typeof pv === 'object' && !Array.isArray(pv)) ? pv : {};
  for (const w of Object.keys(pend)) if (now - (pend[w].at || 0) > CONFIRM_MS) delete pend[w];
  const e = pend[k] || { at: now, devs: [] };
  if (!e.devs.includes(dev)) e.devs.push(dev);
  if (e.devs.length >= 2) {
    delete pend[k];
    used[k] = now;
    await store.setJSON(KEY, used);
    listCache = null;
  } else pend[k] = e;
  if (Object.keys(pend).length < 5000) await store.setJSON(PEND, pend);
  return json({ ok: true });
};
