// PIC-ASS-O — words already drawn in ANY game (v3.65)
// A word that was the puzzle once is not offered again in any game, until
// every word of a level has been used (the game itself then falls back).
//   GET                            -> { words: ["ajto", ...] } (normalised keys)
//   POST { word } + header x-picasso-secret -> CSAK a saját játékszerver (v4.12):
//        a szerver akkor küldi, ha egy szobában legalább 2 játékos jelezte
//        ugyanazt a lerajzolt szót. Böngészőből érkező jelzést nem fogad el.
//        A szónak rajta kell lennie a hivatalos szólistán.
//   POST { action:"reset" } + header x-netlify-token -> admin: start over
import { getStore } from '@netlify/blobs';
import { norm, officialWords, fromGameServer } from '../lib/words.mjs';
import { isAdminRequest } from '../lib/adminauth.mjs';

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
  const trusted = fromGameServer(req);
  if (!trusted && limited('p|' + ipOf(req), 40, 60000)) return json({ error: 'slow down' }, 429);
  let body = {};
  try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }

  if (body.action === 'reset') {
    if (!(await isAdminRequest(req))) return json({ error: 'unauthorized' }, 401);   // v4.19
    await store.setJSON(KEY, {});
    listCache = null;
    return json({ ok: true, n: 0 });
  }

  if (!trusted) return json({ error: 'forbidden', why: 'csak a játékszerver jelezhet' }, 403);
  const k = norm(body.word);
  if (!k) return json({ error: 'no word' }, 400);
  const official = await officialWords();
  if (!official) return json({ ok: false, skipped: 'wordlist unavailable' }, 503);
  if (!official.has(k)) return json({ ok: false, skipped: 'not an official word' });
  const used = await read();
  if (used[k]) return json({ ok: true, already: true });
  if (Object.keys(used).length > 40000) return json({ error: 'full' }, 429);
  used[k] = Date.now();
  await store.setJSON(KEY, used);
  listCache = null;
  return json({ ok: true });
};
