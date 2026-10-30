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
import { json as baseJson, ipOf, makeLimiter, updateJSON } from '../lib/util.mjs';

const KEY = 'used';
// v4.25: a drawn word is protected from repeats for 30 days only, then it
// can come up again (the stored value is the time it was drawn)
const TTL_MS = 30 * 24 * 3600 * 1000;
const fresh = (used) => { const now = Date.now(); const out = {}; for (const [k, t] of Object.entries(used)) { if (Number(t) > now - TTL_MS) out[k] = t; } return out; };


// sebességkorlát és gyorsítótár (példányonként; a meleg függvénypéldány újrahasználja)
const limited = makeLimiter();
let listCache = null, listCacheAt = 0;

export default async (req) => {
  const json = (body, status = 200, cache = 'no-store') => baseJson(body, status, cache === 'no-store' ? {} :
    { 'cache-control': cache, 'netlify-cdn-cache-control': 'public, s-maxage=60, stale-while-revalidate=600' });
  if (req.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'forbidden' }, 403);
  const store = getStore({ name: 'picasso-wordused', consistency: 'strong' });
  const read = async () => {
    const v = await store.get(KEY, { type: 'json' }).catch(() => null);
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  };

  if (req.method === 'GET') {
    if (!listCache || Date.now() - listCacheAt > 20000) { listCache = Object.keys(fresh(await read())); listCacheAt = Date.now(); }
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
  // v4.30: conflict-safe read-modify-write (two reports at once no longer overwrite each other)
  const res = await updateJSON(store, KEY, raw => {
    const used = fresh((raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {});   // expired words are dropped here
    if (used[k]) return { write: false, result: 'already' };
    if (Object.keys(used).length > 40000) return { write: false, result: 'full' };
    used[k] = Date.now();
    return { value: used, result: 'ok' };
  });
  if (res === 'already') return json({ ok: true, already: true });
  if (res === 'full') return json({ error: 'full' }, 429);
  listCache = null;
  return json({ ok: true });
};
